import { prisma } from "../lib/prisma";
import { emailQueue } from "../queues/email.queue";

const LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface ReconciliationReport {
  dispatchedOutboxCount: number;
  reclaimedProcessingCount: number;
  ambiguousCount: number;
  reconciledJobCount: number;
}

/**
 * Dispatches a batch of PENDING outbox events to BullMQ using stable job IDs.
 * Strictly guarantees that SENT emails are NEVER re-enqueued.
 */
export async function dispatchOutboxBatch(
  outboxEventIds?: string[]
): Promise<number> {
  const whereClause: any = { status: "PENDING" };
  if (outboxEventIds && outboxEventIds.length > 0) {
    whereClause.id = { in: outboxEventIds };
  }

  const pendingEvents = await prisma.outboxEvent.findMany({
    where: whereClause,
    take: 500,
    orderBy: { createdAt: "asc" },
  });

  if (pendingEvents.length === 0) {
    return 0;
  }

  const jobIds = pendingEvents.map((e) => e.jobId);
  const emailJobs = await prisma.emailJob.findMany({
    where: { id: { in: jobIds } },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      nextEligibleAt: true,
      messageId: true,
    },
  });

  const emailJobMap = new Map(emailJobs.map((j) => [j.id, j]));

  const jobsToEnqueue: Array<{
    name: string;
    data: { emailId: string };
    opts: { jobId: string; delay: number };
  }> = [];

  const dispatchedEventIds: string[] = [];
  const failedEventIds: string[] = [];

  const now = Date.now();

  for (const event of pendingEvents) {
    const job = emailJobMap.get(event.jobId);

    if (!job) {
      // Record not found in EmailJob table; mark outbox as failed
      failedEventIds.push(event.id);
      continue;
    }

    if (job.status === "SENT" || job.messageId) {
      // Email was already confirmed sent!
      // [SAFETY GUARANTEE]: NEVER blindly re-enqueue SENT emails.
      dispatchedEventIds.push(event.id);
      continue;
    }

    if (job.status === "FAILED" || job.status === "NEEDS_REVIEW") {
      failedEventIds.push(event.id);
      continue;
    }

    // Status is SCHEDULED, RATE_LIMITED, or PROCESSING
    const effectiveScheduleTime = (job.nextEligibleAt || job.scheduledAt).getTime();
    const delay = Math.max(0, effectiveScheduleTime - now);

    jobsToEnqueue.push({
      name: "send-email",
      data: { emailId: job.id },
      opts: {
        jobId: job.id, // Stable BullMQ job ID matching EmailJob.id
        delay,
      },
    });

    dispatchedEventIds.push(event.id);
  }

  // 1. Dispatch to BullMQ atomically in bulk
  if (jobsToEnqueue.length > 0) {
    await emailQueue.addBulk(jobsToEnqueue);
  }

  // 2. Mark Outbox Events as DISPATCHED in PostgreSQL
  if (dispatchedEventIds.length > 0) {
    await prisma.outboxEvent.updateMany({
      where: { id: { in: dispatchedEventIds } },
      data: {
        status: "DISPATCHED",
        updatedAt: new Date(),
      },
    });
  }

  if (failedEventIds.length > 0) {
    await prisma.outboxEvent.updateMany({
      where: { id: { in: failedEventIds } },
      data: {
        status: "FAILED",
        updatedAt: new Date(),
      },
    });
  }

  return jobsToEnqueue.length;
}

/**
 * Reconciles database state with BullMQ without using cron.
 *
 * Runs during:
 * 1. Server / Worker boot (startup reconciliation)
 * 2. Scheduling request lifecycle (opportunistic reconciliation)
 * 3. BullMQ queue drain lifecycle events (debounced via Redis lock)
 *
 * Conservative Policy:
 * - Stale PROCESSING with messageId -> Resolved to SENT.
 * - Stale PROCESSING with smtpAttemptStartedAt == null -> Definitely never called SMTP; reclaimed to SCHEDULED.
 * - Stale PROCESSING with smtpAttemptStartedAt != null & messageId == null -> Ambiguous delivery outcome;
 *   marked as NEEDS_REVIEW to prevent automatic duplicate resend.
 */
export async function reconcileDatabaseToQueue(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    dispatchedOutboxCount: 0,
    reclaimedProcessingCount: 0,
    ambiguousCount: 0,
    reconciledJobCount: 0,
  };

  try {
    // 1. Dispatch any orphaned PENDING OutboxEvent records
    report.dispatchedOutboxCount = await dispatchOutboxBatch();

    // 2. Safe Stale Lease Recovery:
    // Find jobs stuck in PROCESSING where lease has expired
    const now = new Date();
    const staleThreshold = new Date(Date.now() - LEASE_TIMEOUT_MS);

    const staleJobs = await prisma.emailJob.findMany({
      where: {
        status: "PROCESSING",
        OR: [
          { leaseExpiresAt: { lt: now } },
          { updatedAt: { lt: staleThreshold } },
        ],
      },
      select: {
        id: true,
        messageId: true,
        sentAt: true,
        scheduledAt: true,
        nextEligibleAt: true,
        smtpAttemptStartedAt: true,
      },
      take: 100,
    });

    if (staleJobs.length > 0) {
      const jobsToReenqueue: Array<{
        name: string;
        data: { emailId: string };
        opts: { jobId: string; delay: number };
      }> = [];

      for (const stale of staleJobs) {
        // Case 1: Send completed and captured messageId before crashing
        if (stale.messageId || stale.sentAt) {
          console.log(
            `[Reconciler] Resolving stale job ${stale.id} to SENT (messageId: ${stale.messageId})`
          );
          await prisma.emailJob.update({
            where: { id: stale.id },
            data: {
              status: "SENT",
              claimToken: null,
              leaseExpiresAt: null,
              updatedAt: new Date(),
            },
          });
          continue;
        }

        // Case 2: Process crashed BEFORE initiating SMTP dispatch
        // smtpAttemptStartedAt is null -> It is 100% certain SMTP was never called.
        if (!stale.smtpAttemptStartedAt) {
          console.log(
            `[Reconciler] Reclaiming stale job ${stale.id} (never reached SMTP). Resetting to SCHEDULED.`
          );

          await prisma.emailJob.update({
            where: { id: stale.id },
            data: {
              status: "SCHEDULED",
              claimToken: null,
              leaseExpiresAt: null,
              nextEligibleAt: new Date(),
              updatedAt: new Date(),
            },
          });

          jobsToReenqueue.push({
            name: "send-email",
            data: { emailId: stale.id },
            opts: {
              jobId: stale.id,
              delay: 0,
            },
          });
          report.reclaimedProcessingCount++;
          continue;
        }

        // Case 3: Process crashed AFTER initiating SMTP dispatch (smtpAttemptStartedAt is set)
        // Outcome is AMBIGUOUS: SMTP may have delivered the email before crash.
        // [CONSERVATIVE POLICY]: DO NOT automatically resend! Mark as NEEDS_REVIEW.
        console.warn(
          `[Conservative Crash Recovery] Job ${stale.id} initiated SMTP at ${stale.smtpAttemptStartedAt.toISOString()} but worker crashed before messageId confirmation. Marking NEEDS_REVIEW to prevent duplicate sends.`
        );

        await prisma.emailJob.update({
          where: { id: stale.id },
          data: {
            status: "NEEDS_REVIEW",
            claimToken: null,
            leaseExpiresAt: null,
            errorMessage: `Ambiguous delivery: Worker crashed after SMTP dispatch started at ${stale.smtpAttemptStartedAt.toISOString()}. Outcome unknown. Manual review required to avoid duplicate send.`,
            updatedAt: new Date(),
          },
        });
        report.ambiguousCount++;
      }

      if (jobsToReenqueue.length > 0) {
        await emailQueue.addBulk(jobsToReenqueue);
      }
    }

    // 3. Reconcile unenqueued SCHEDULED/RATE_LIMITED jobs
    const unenqueued = await prisma.emailJob.findMany({
      where: {
        status: { in: ["SCHEDULED", "RATE_LIMITED"] },
      },
      take: 100,
      orderBy: { scheduledAt: "asc" },
    });

    if (unenqueued.length > 0) {
      const unenqueuedIds = unenqueued.map((j) => j.id);
      const existingOutbox = await prisma.outboxEvent.findMany({
        where: { jobId: { in: unenqueuedIds } },
        select: { jobId: true, status: true },
      });
      const outboxJobIds = new Set(existingOutbox.map((o) => o.jobId));

      const missingJobs = unenqueued.filter((j) => !outboxJobIds.has(j.id));
      if (missingJobs.length > 0) {
        const jobsToEnqueue = missingJobs.map((j) => ({
          name: "send-email",
          data: { emailId: j.id },
          opts: {
            jobId: j.id,
            delay: Math.max(0, (j.nextEligibleAt || j.scheduledAt).getTime() - Date.now()),
          },
        }));

        await emailQueue.addBulk(jobsToEnqueue);

        // Create OutboxEvent records as DISPATCHED for audit trail
        await prisma.outboxEvent.createMany({
          data: missingJobs.map((j) => ({
            jobId: j.id,
            status: "DISPATCHED",
            payload: { emailId: j.id },
          })),
          skipDuplicates: true,
        });

        report.reconciledJobCount += missingJobs.length;
      }
    }
  } catch (error) {
    console.error("[Reconciler] Error during database-to-queue reconciliation:", error);
  }

  return report;
}

/**
 * Administrative resolution utility for ambiguous jobs in NEEDS_REVIEW status.
 *
 * @param emailId The EmailJob ID in NEEDS_REVIEW status.
 * @param resolution 'MARK_SENT' if recipient confirmed receipt, or 'FORCE_RESEND' if confirmed unreceived.
 * @param adminMessageId Optional SMTP message ID if verified via mail server logs.
 */
export async function resolveAmbiguousEmail(
  emailId: string,
  resolution: "MARK_SENT" | "FORCE_RESEND",
  adminMessageId?: string
): Promise<{ success: boolean; message: string }> {
  const email = await prisma.emailJob.findUnique({ where: { id: emailId } });
  if (!email) {
    throw new Error(`EmailJob ${emailId} not found`);
  }
  if (email.status !== "NEEDS_REVIEW") {
    throw new Error(`EmailJob ${emailId} is in status ${email.status}, not NEEDS_REVIEW`);
  }

  if (resolution === "MARK_SENT") {
    await prisma.emailJob.update({
      where: { id: emailId },
      data: {
        status: "SENT",
        sentAt: email.sentAt || new Date(),
        messageId: adminMessageId || "MANUALLY_CONFIRMED_SENT",
        errorMessage: "Resolved manually as SENT by admin",
        claimToken: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      },
    });
    return { success: true, message: `Email ${emailId} manually confirmed as SENT` };
  }

  if (resolution === "FORCE_RESEND") {
    await prisma.emailJob.update({
      where: { id: emailId },
      data: {
        status: "SCHEDULED",
        smtpAttemptStartedAt: null,
        claimToken: null,
        leaseExpiresAt: null,
        nextEligibleAt: new Date(),
        errorMessage: "Manually force-rescheduled for resend by admin",
        updatedAt: new Date(),
      },
    });

    await emailQueue.add(
      "send-email",
      { emailId: email.id },
      { jobId: email.id, delay: 0 }
    );

    return {
      success: true,
      message: `Email ${emailId} manually force-rescheduled and dispatched to BullMQ`,
    };
  }

  throw new Error(`Invalid resolution action: ${resolution}`);
}

