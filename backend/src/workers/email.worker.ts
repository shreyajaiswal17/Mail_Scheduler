import "dotenv/config";
import { Worker, DelayedError, UnrecoverableError } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { decryptPassword } from "../lib/encryption";
import { reserveSendingSlot } from "../services/rate-limiter.service";
import { reconcileDatabaseToQueue } from "../services/outbox-reconciler.service";
import { indexEmailJob } from "../services/elasticsearch.service";
import { notifySenderHourlyLimit, notifyCampaignHourlyLimit } from "../services/slack.service";

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);
const LEASE_TIMEOUT_MS = 5 * 60 * 1000;

function isPermanentSmtpError(error: any): boolean {
  if (!error) return false;

  const responseCode =
    error.responseCode ||
    (typeof error.response === "string" ? parseInt(error.response.slice(0, 3), 10) : undefined);

  if (responseCode && responseCode >= 400 && responseCode < 500) {
    return false;
  }

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

  if (responseCode && responseCode >= 500 && responseCode < 600) {
    return true;
  }

  if (error.code === "EAUTH") {
    if (responseCode && responseCode >= 400 && responseCode < 500) {
      return false;
    }
    if (responseCode && responseCode >= 500) {
      return true;
    }
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

  if (error.code === "EENVELOPE") {
    if (responseCode && responseCode >= 400 && responseCode < 500) {
      return false;
    }
    return true;
  }

  return false;
}

export const emailWorker = new Worker(
  "email-sending",
  async (job, token) => {
    const emailId = job.data.emailId;

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
      const current = await prisma.emailJob.findUnique({
        where: { id: emailId },
        select: {
          status: true,
          messageId: true,
          updatedAt: true,
          leaseExpiresAt: true,
        },
      });

      if (!current) {
        console.warn(
          `[Claim Guard] Job ${emailId} not in DB. Discarding queue job.`
        );
        return { message: "Orphaned job discarded" };
      }

      if (current.status === "SENT") {
        return { message: "Email already sent", messageId: current.messageId };
      }

      if (current.status === "FAILED" || current.status === "NEEDS_REVIEW") {
        return { message: `Job already terminal: ${current.status}` };
      }

      if (current.status === "PROCESSING") {
        const remainingLeaseMs = Math.max(
          5000,
          (current.leaseExpiresAt?.getTime() ||
            current.updatedAt.getTime() + LEASE_TIMEOUT_MS) -
            Date.now() +
            1000
        );

        await job.moveToDelayed(Date.now() + remainingLeaseMs, token);
        throw new DelayedError();
      }

      await job.moveToDelayed(Date.now() + 5000, token);
      throw new DelayedError();
    }

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
      indexEmailJob(email.id).catch(() => {});
      throw new UnrecoverableError(configError);
    }

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

      if (reservation.reason === "SENDER_HOURLY_LIMIT") {
        notifySenderHourlyLimit({
          userId: sender.userId,
          senderId: sender.id,
          senderEmail: sender.email,
          senderName: sender.name,
          hourlyLimit: reservation.senderHourlyLimit || 0,
          nextEligibleTime,
        }).catch((err) => {
          console.warn("[Slack Worker Alert] Non-fatal sender alert error:", err?.message || err);
        });
      } else if (reservation.reason === "CAMPAIGN_HOURLY_LIMIT" && email.campaignId) {
        notifyCampaignHourlyLimit({
          userId: email.campaign?.userId || sender.userId,
          campaignId: email.campaignId,
          campaignName: email.campaign?.subject,
          senderId: sender.id,
          senderEmail: sender.email,
          senderName: sender.name,
          hourlyLimit: reservation.campaignHourlyLimit || email.campaign?.hourlyLimit || 0,
          nextEligibleTime,
        }).catch((err) => {
          console.warn("[Slack Worker Alert] Non-fatal campaign alert error:", err?.message || err);
        });
      }

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
      indexEmailJob(email.id).catch(() => {});

      await job.moveToDelayed(nextEligibleTime, token);
      throw new DelayedError();
    }

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
      indexEmailJob(email.id).catch(() => {});

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
        indexEmailJob(email.id).catch(() => {});

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
        indexEmailJob(email.id).catch(() => {});

        throw error;
      }

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
      indexEmailJob(email.id).catch(() => {});

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
  if (error instanceof DelayedError || error.name === "DelayedError") {
    return;
  }
  console.error(`Job ${job?.id} failed:`, error.message);
});

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

reconcileDatabaseToQueue()
  .then((report) => {
    console.log(
      `[Worker Boot] Database-to-queue reconciliation complete: Dispatched=${report.dispatchedOutboxCount}, Reclaimed=${report.reclaimedProcessingCount}, NeedsReview=${report.ambiguousCount}, Reconciled=${report.reconciledJobCount}`
    );
  })
  .catch((err) => {
    console.error("[Worker Boot] Error during startup reconciliation:", err);
  });
