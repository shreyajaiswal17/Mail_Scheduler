import "dotenv/config";
import { Worker, DelayedError, UnrecoverableError } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { decryptPassword } from "../lib/encryption";
import { reserveSendingSlot } from "../services/rate-limiter.service";
import { reconcileDatabaseToQueue } from "../services/outbox-reconciler.service";

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);
const LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute lease timeout for stale crash recovery

/**
 * Classifies SMTP and transport errors into permanent vs temporary.
 *
 * RFC 5321 & SMTP Conventions:
 * - 4xx response codes: Transient / Temporary failures (e.g., 421 service unavailable, 450 mailbox busy, 451 local error, 452 storage full, 454 temporary auth failure). Always retry.
 * - 5xx response codes: Permanent failures (e.g., 550 mailbox not found, 551 user not local, 553 invalid address, 535 invalid credentials).
 * - Network errors: ECONNRESET, ETIMEDOUT, ESOCKETTIMEDOUT, ECONNREFUSED, ENOTFOUND, EPIPE, EAI_AGAIN, ENETUNREACH are transient network issues.
 * - EAUTH: Not all authentication errors are permanent (e.g. 454 temporary auth failures, server busy, or network resets during auth). It is permanent ONLY when confirmed with a 5xx response code or explicit credential rejection.
 */
function isPermanentSmtpError(error: any): boolean {
  if (!error) return false;

  // 1. Check SMTP response code (e.g. error.responseCode or numeric prefix of error.response)
  const responseCode =
    error.responseCode ||
    (typeof error.response === "string" ? parseInt(error.response.slice(0, 3), 10) : undefined);

  // Any explicit 4xx code is transient by RFC 5321 specification
  if (responseCode && responseCode >= 400 && responseCode < 500) {
    return false;
  }

  // Network and socket-level errors are always transient
  const transientNetworkCodes = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ESOCKETTIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EPIPE",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "EBUSY",
  ]);

  if (error.code && transientNetworkCodes.has(error.code)) {
    return false;
  }

  // Explicit 5xx SMTP error codes are permanent (e.g. 550, 553, 535)
  if (responseCode && responseCode >= 500 && responseCode < 600) {
    return true;
  }

  // EAUTH is permanent only if accompanied by a 5xx code or when it's an explicit credential failure
  if (error.code === "EAUTH") {
    // If responseCode is 4xx, it's temporary (e.g. 454)
    if (responseCode && responseCode >= 400 && responseCode < 500) {
      return false;
    }
    // If responseCode is 535 or other 5xx, it's permanent
    if (responseCode && responseCode >= 500) {
      return true;
    }
    // If no responseCode, check if error message indicates invalid credentials vs network/timeout
    const msg = (error.message || "").toLowerCase();
    if (
      msg.includes("timeout") ||
      msg.includes("reset") ||
      msg.includes("try again") ||
      msg.includes("busy")
    ) {
      return false;
    }
    return true;
  }

  // EENVELOPE with 5xx or invalid recipient address format
  if (error.code === "EENVELOPE") {
    if (responseCode && responseCode >= 400 && responseCode < 500) {
      return false;
    }
    return true;
  }

  // Default: treat unknown errors as temporary/retryable so BullMQ retries before giving up
  return false;
}

export const emailWorker = new Worker(
  "email-sending",
  async (job, token) => {
    const emailId = job.data.emailId;

    // 1. Database-Backed Atomic Claim / Fenced Lease
    // Uses a unique claimToken and leaseExpiresAt so stale workers cannot overwrite newer worker results.
    const claimToken = crypto.randomUUID();
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_TIMEOUT_MS);

    const claim = await prisma.emailJob.updateMany({
      where: {
        id: emailId,
        OR: [
          { status: { in: ["SCHEDULED", "RATE_LIMITED"] } },
          {
            status: "PROCESSING",
            leaseExpiresAt: { lt: now },
          },
        ],
      },
      data: {
        status: "PROCESSING",
        claimToken,
        leaseExpiresAt,
        updatedAt: now,
      },
    });

    if (claim.count === 0) {
      // Lease acquisition failed — inspect state to log clearly
      const current = await prisma.emailJob.findUnique({
        where: { id: emailId },
        select: {
          status: true,
          messageId: true,
          updatedAt: true,
          leaseExpiresAt: true,
        },
      });

      // 1. If record does not exist in database, discard orphaned BullMQ job
      if (!current) {
        console.warn(
          `[Claim Guard] Job ${emailId} record does not exist in database. Discarding orphaned queue job.`
        );
        return { message: "Orphaned job discarded (not found in database)" };
      }

      if (current.status === "SENT") {
        console.log(
          `[Claim Guard] Job ${emailId} already SENT (Message ID: ${current.messageId}). Skipping duplicate execution.`
        );
        return { message: "Email already sent", messageId: current.messageId };
      }

      if (current.status === "FAILED" || current.status === "NEEDS_REVIEW") {
        console.log(
          `[Claim Guard] Job ${emailId} is in status ${current.status}. Skipping duplicate execution.`
        );
        return { message: `Job already in terminal status ${current.status}` };
      }

      if (current.status === "PROCESSING") {
        // Another worker is actively holding the lease, OR a previous worker crashed
        // and the lease has not expired yet. Delay until lease expiration to avoid dropping job.
        const remainingLeaseMs = Math.max(
          5000,
          (current.leaseExpiresAt?.getTime() ||
            current.updatedAt.getTime() + LEASE_TIMEOUT_MS) -
            Date.now() +
            1000
        );

        console.log(
          `[Claim Guard] Job ${emailId} is actively leased. Rescheduling in ${remainingLeaseMs}ms to avoid dropping job.`
        );

        await job.moveToDelayed(Date.now() + remainingLeaseMs, token);
        throw new DelayedError();
      }

      // If status is SCHEDULED or RATE_LIMITED, a concurrent worker updated it; delay briefly to re-attempt claim
      console.log(
        `[Claim Guard] Job ${emailId} claim missed (status: ${current.status}). Retrying in 5s...`
      );
      await job.moveToDelayed(Date.now() + 5000, token);
      throw new DelayedError();
    }

    // 2. Fetch full email job with sender and campaign
    const email = await prisma.emailJob.findUnique({
      where: { id: emailId },
      include: {
        sender: true,
        campaign: true,
      },
    });

    if (!email) {
      throw new UnrecoverableError(`Email record ${emailId} not found in database`);
    }

    const sender = email.sender;

    if (
      !sender.isActive ||
      !sender.smtpHost ||
      !sender.smtpPort ||
      !sender.smtpUser ||
      !sender.smtpPasswordEnc
    ) {
      const configError = "Sender SMTP configuration is incomplete or inactive";
      await prisma.emailJob.updateMany({
        where: { id: email.id, claimToken },
        data: {
          status: "FAILED",
          claimToken: null,
          leaseExpiresAt: null,
          errorMessage: configError,
          updatedAt: new Date(),
        },
      });
      throw new UnrecoverableError(configError);
    }

    // 3. Distributed Redis Rate Limiter Check (Dual-Tier: Sender Global + Campaign Specific)
    const reservation = await reserveSendingSlot({
      senderId: sender.id,
      campaignId: email.campaignId,
      campaignDelayMs: email.campaign?.delayMs,
      campaignHourlyLimit: email.campaign?.hourlyLimit,
    });

    if (!reservation.allowed) {
      const nextEligibleTime = Date.now() + reservation.retryAfterMs;

      console.log(
        `[Rate Limiter] Sender ${sender.email} rate-limited (${reservation.reason}). Delaying job ${job.id} for ${reservation.retryAfterMs}ms (until ${new Date(nextEligibleTime).toISOString()}).`
      );

      // Release lease back to RATE_LIMITED so future workers can claim it when eligible
      // Preserve original scheduledAt intact, update nextEligibleAt to the rate-limited time
      await prisma.emailJob.updateMany({
        where: { id: email.id, claimToken },
        data: {
          status: "RATE_LIMITED",
          claimToken: null,
          leaseExpiresAt: null,
          nextEligibleAt: new Date(nextEligibleTime),
          errorMessage: `Rate limited (${reservation.reason}). Rescheduled for ${new Date(nextEligibleTime).toISOString()}`,
          updatedAt: new Date(),
        },
      });

      // Move job back to BullMQ delayed state without consuming retry attempts
      await job.moveToDelayed(nextEligibleTime, token);
      throw new DelayedError();
    }

    // 4. Pre-SMTP Send Stamp
    // Confirms that this worker is actively starting SMTP transmission.
    // If the process crashes after this point without writing messageId, delivery outcome is AMBIGUOUS.
    const preStamp = await prisma.emailJob.updateMany({
      where: { id: email.id, claimToken },
      data: {
        smtpAttemptStartedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    if (preStamp.count === 0) {
      console.warn(
        `[Worker] Pre-SMTP stamp failed for job ${email.id}. Lease was reclaimed by another worker! Aborting.`
      );
      return { message: "Lease lost before SMTP dispatch" };
    }

    // 5. Send Email via Nodemailer SMTP Transport
    try {
      const transporter = nodemailer.createTransport({
        host: sender.smtpHost,
        port: sender.smtpPort,
        secure: sender.smtpPort === 465,
        auth: {
          user: sender.smtpUser,
          pass: decryptPassword(sender.smtpPasswordEnc),
        },
      });

      const info = await transporter.sendMail({
        from: sender.email,
        to: email.recipientEmail,
        subject: email.subject,
        text: email.body,
      });

      // 6. Confirm delivery in PostgreSQL fenced by claimToken
      const updateResult = await prisma.emailJob.updateMany({
        where: { id: email.id, claimToken },
        data: {
          status: "SENT",
          sentAt: new Date(),
          messageId: info.messageId,
          errorMessage: null,
          claimToken: null,
          leaseExpiresAt: null,
          attempts: { increment: 1 },
          updatedAt: new Date(),
        },
      });

      if (updateResult.count === 0) {
        console.warn(
          `[Worker] Fencing conflict: Email ${email.id} was accepted by SMTP (Message ID: ${info.messageId}), but lease was reclaimed by another worker!`
        );
      }

      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[Worker] Email sent to ${email.recipientEmail}. Message ID: ${info.messageId}`);
      if (previewUrl) {
        console.log(`[Worker] Preview URL: ${previewUrl}`);
      }

      return {
        messageId: info.messageId,
        previewUrl,
      };
    } catch (error: any) {
      const isPermanent = isPermanentSmtpError(error);
      const maxAttempts = job.opts.attempts || 3;
      const currentAttempt = job.attemptsMade + 1;
      const isFinalAttempt = currentAttempt >= maxAttempts;

      if (isPermanent) {
        console.error(
          `[Worker] Permanent SMTP failure for ${email.recipientEmail}:`,
          error.message
        );

        await prisma.emailJob.updateMany({
          where: { id: email.id, claimToken },
          data: {
            status: "FAILED",
            claimToken: null,
            leaseExpiresAt: null,
            attempts: { increment: 1 },
            errorMessage: `Permanent SMTP failure (${error.code || error.responseCode || "5xx"}): ${error.message}`,
            updatedAt: new Date(),
          },
        });

        throw new UnrecoverableError(error.message);
      }

      if (isFinalAttempt) {
        console.error(
          `[Worker] Final attempt ${currentAttempt}/${maxAttempts} failed for ${email.recipientEmail}:`,
          error.message
        );

        await prisma.emailJob.updateMany({
          where: { id: email.id, claimToken },
          data: {
            status: "FAILED",
            claimToken: null,
            leaseExpiresAt: null,
            attempts: { increment: 1 },
            errorMessage: `Exhausted all ${maxAttempts} retries. Final error: ${error.message}`,
            updatedAt: new Date(),
          },
        });

        throw error;
      }

      // Temporary failure with retries remaining:
      // DO NOT mark as FAILED! Reset status to SCHEDULED so BullMQ backoff retry can re-claim and process it.
      console.warn(
        `[Worker] Temporary failure on attempt ${currentAttempt}/${maxAttempts} for ${email.recipientEmail}: ${error.message}. Retrying via BullMQ backoff...`
      );

      await prisma.emailJob.updateMany({
        where: { id: email.id, claimToken },
        data: {
          status: "SCHEDULED",
          claimToken: null,
          leaseExpiresAt: null,
          nextEligibleAt: new Date(Date.now() + 5000),
          attempts: { increment: 1 },
          errorMessage: `Attempt ${currentAttempt}/${maxAttempts} failed: ${error.message}. Retrying via BullMQ backoff...`,
          updatedAt: new Date(),
        },
      });

      throw error;
    }
  },
  {
    connection: redis,
    concurrency,
  }
);

emailWorker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

emailWorker.on("failed", (job, error) => {
  // Do not log DelayedError as a failure since it represents a clean reschedule
  if (error instanceof DelayedError || error.name === "DelayedError") {
    return;
  }
  console.error(`Job ${job?.id} failed:`, error.message);
});

// Debounced queue drained listener using atomic Redis lock (30s TTL)
emailWorker.on("drained", async () => {
  try {
    const acquired = await redis.set("reconciler:drain:lock", "1", "EX", 30, "NX");
    if (!acquired) {
      return;
    }
    console.log("[Worker Queue Drained] Lock acquired. Running reconciliation...");
    await reconcileDatabaseToQueue();
  } catch (err) {
    console.error("[Worker Queue Drained] Error during drain reconciliation:", err);
  }
});

console.log(`Email worker started with concurrency ${concurrency}`);

// Non-cron startup reconciliation
reconcileDatabaseToQueue()
  .then((report) => {
    console.log(
      `[Worker Boot] Database-to-queue reconciliation complete: Dispatched=${report.dispatchedOutboxCount}, Reclaimed=${report.reclaimedProcessingCount}, NeedsReview=${report.ambiguousCount}, Reconciled=${report.reconciledJobCount}`
    );
  })
  .catch((err) => {
    console.error("[Worker Boot] Error during startup reconciliation:", err);
  });


