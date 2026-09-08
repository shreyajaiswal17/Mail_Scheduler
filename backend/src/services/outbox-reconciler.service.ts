import { prisma } from "../lib/prisma";
import { emailQueue } from "../queues/email.queue";
import { reconcileElasticsearch, indexEmailJob } from "./elasticsearch.service";

const LEASE_TIMEOUT_MS = 5 * 60 * 1000;

export interface ReconciliationReport {
  dispatchedOutboxCount: number;
  reclaimedProcessingCount: number;
  ambiguousCount: number;
  reconciledJobCount: number;
  elasticsearchSynced?: number;
  elasticsearchBackfilled?: number;
}

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
      failedEventIds.push(event.id);
      continue;
    }

    if (job.status === "SENT" || job.messageId) {
      dispatchedEventIds.push(event.id);
      continue;
    }

    if (job.status === "FAILED" || job.status === "NEEDS_REVIEW") {
      failedEventIds.push(event.id);
      continue;
    }

    const effectiveScheduleTime = (job.nextEligibleAt || job.scheduledAt).getTime();
    const delay = Math.max(0, effectiveScheduleTime - now);

    jobsToEnqueue.push({
      name: "send-email",
      data: { emailId: job.id },
      opts: {
        jobId: job.id,
        delay,
      },
    });

    dispatchedEventIds.push(event.id);
  }

  if (jobsToEnqueue.length > 0) {
    await emailQueue.addBulk(jobsToEnqueue);
  }

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

export async function reconcileDatabaseToQueue(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    dispatchedOutboxCount: 0,
    reclaimedProcessingCount: 0,
    ambiguousCount: 0,
    reconciledJobCount: 0,
  };

  try {
    report.dispatchedOutboxCount = await dispatchOutboxBatch();

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

        console.warn(
          `[Crash Recovery] Job ${stale.id} initiated SMTP at ${stale.smtpAttemptStartedAt.toISOString()} but worker crashed before confirmation. Marking NEEDS_REVIEW.`
        );

        await prisma.emailJob.update({
          where: { id: stale.id },
          data: {
            status: "NEEDS_REVIEW",
            claimToken: null,
            leaseExpiresAt: null,
            errorMessage: `Worker crashed after SMTP dispatch started at ${stale.smtpAttemptStartedAt.toISOString()}. Manual review required.`,
            updatedAt: new Date(),
          },
        });
        report.ambiguousCount++;
      }

      if (jobsToReenqueue.length > 0) {
        await emailQueue.addBulk(jobsToReenqueue);
      }
    }

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

    try {
      const esReport = await reconcileElasticsearch();
      report.elasticsearchSynced = esReport.syncedOutbox + esReport.syncedRedis;
      report.elasticsearchBackfilled = esReport.backfilled;
    } catch (esErr: any) {
      console.warn("[Reconciler] Non-blocking ES reconciliation error:", esErr.message);
    }

    try {
      const { retryPendingSlackNotifications } = await import("./slack.service");
      await retryPendingSlackNotifications();
    } catch (slackRetryErr: any) {
      console.warn("[Reconciler] Non-blocking Slack outbox retry error:", slackRetryErr?.message || slackRetryErr);
    }
  } catch (error) {
    console.error("[Reconciler] Error during database-to-queue reconciliation:", error);
  }

  return report;
}

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
    indexEmailJob(emailId).catch(() => {});
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
    indexEmailJob(emailId).catch(() => {});

    return {
      success: true,
      message: `Email ${emailId} manually force-rescheduled and dispatched to BullMQ`,
    };
  }

  throw new Error(`Invalid resolution action: ${resolution}`);
}
