import "dotenv/config";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { emailQueue } from "../queues/email.queue";
import {
  notifySenderHourlyLimit,
  notifyCampaignHourlyLimit,
  retryPendingSlackNotifications,
  deliverSlackNotification,
  setSlackNotificationChannel,
} from "../services/slack.service";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runControlledVerification() {
  console.log("=== Mail Scheduler: Development Verification Script ===");
  console.log("Suite: Real-Worker, Slack Notifications, and Outbox Recovery Verification\n");

  const user = await prisma.user.findFirst({
    where: { email: "codex1712@gmail.com" },
    include: {
      slackConnection: true,
      senders: {
        where: { isActive: true, smtpHost: { not: null } },
      },
    },
  });

  if (!user) {
    throw new Error("User codex1712@gmail.com not found");
  }
  if (!user.slackConnection) {
    throw new Error("User does not have an active Slack connection in PostgreSQL");
  }

  const activeSender = user.senders[0];
  if (!activeSender) {
    throw new Error("User does not have an active sender with SMTP config");
  }

  const originalChannelId = user.slackConnection.channelId || "C0C0761S84B";
  const originalChannelName = user.slackConnection.channelName || "mail-scheduler-alerts";

  console.log(`[Setup] User: ${user.name} (${user.email}) [ID: ${user.id}]`);
  console.log(`[Setup] Connected Slack Workspace: ${user.slackConnection.teamName} (${user.slackConnection.teamId})`);
  console.log(`[Setup] Active Channel: #${originalChannelName} (${originalChannelId})`);
  console.log(`[Setup] Active Sender: ${activeSender.name} (${activeSender.email})`);

  const initialOutboxCount = await prisma.slackNotificationOutbox.count({
    where: { userId: user.id },
  });
  console.log(`[Setup] Current Slack Outbox Count: ${initialOutboxCount}\n`);

  let testCampaignId: string | null = null;
  const testJobIds: string[] = [];
  const outboxIdsToDelete: string[] = [];
  let isolatedSenderId: string | null = null;

  try {
    console.log("--- PART 1: Real-Worker Integration Test (Campaign Hourly Limit & Delayed Queueing) ---");
    console.log("Description: Enqueues 3 email jobs into BullMQ with campaign hourlyLimit=1.");
    console.log("Verifies live worker dispatches 1 email, delays remaining 2, and produces durable Slack alert.\n");

    const testCampaign = await prisma.emailCampaign.create({
      data: {
        userId: user.id,
        senderId: activeSender.id,
        subject: `E2E Worker Verification Campaign [${Date.now()}]`,
        body: "Controlled test body for hourly-limit worker flow",
        startTime: new Date(),
        delayMs: 1000,
        hourlyLimit: 1,
      },
    });
    testCampaignId = testCampaign.id;
    console.log(`[Part 1] Created test campaign ${testCampaign.id} with hourlyLimit = 1, delayMs = 1000`);

    const emailJob1 = await prisma.emailJob.create({
      data: {
        campaignId: testCampaign.id,
        senderId: activeSender.id,
        recipientEmail: "worker-verify-1@example.com",
        subject: "Test Email 1 (Should Send)",
        body: "Email 1 body",
        scheduledAt: new Date(),
        status: "SCHEDULED",
      },
    });
    testJobIds.push(emailJob1.id);

    const emailJob2 = await prisma.emailJob.create({
      data: {
        campaignId: testCampaign.id,
        senderId: activeSender.id,
        recipientEmail: "worker-verify-2@example.com",
        subject: "Test Email 2 (Should Rate Limit & Trigger Slack Alert)",
        body: "Email 2 body",
        scheduledAt: new Date(),
        status: "SCHEDULED",
      },
    });
    testJobIds.push(emailJob2.id);

    const emailJob3 = await prisma.emailJob.create({
      data: {
        campaignId: testCampaign.id,
        senderId: activeSender.id,
        recipientEmail: "worker-verify-3@example.com",
        subject: "Test Email 3 (Should Rate Limit & Deduplicate Slack Alert)",
        body: "Email 3 body",
        scheduledAt: new Date(),
        status: "SCHEDULED",
      },
    });
    testJobIds.push(emailJob3.id);

    console.log(`[Part 1] Created 3 email jobs in DB: ${emailJob1.id}, ${emailJob2.id}, ${emailJob3.id}`);
    console.log(`[Part 1] Enqueuing jobs into BullMQ 'email-sending' queue...`);
    await emailQueue.add("send-email", { emailId: emailJob1.id }, { jobId: emailJob1.id });
    await emailQueue.add("send-email", { emailId: emailJob2.id }, { jobId: emailJob2.id });
    await emailQueue.add("send-email", { emailId: emailJob3.id }, { jobId: emailJob3.id });

    console.log(`[Part 1] Waiting for real worker to process jobs (polling up to 25s)...`);
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      const j1 = await prisma.emailJob.findUnique({ where: { id: emailJob1.id } });
      const j2 = await prisma.emailJob.findUnique({ where: { id: emailJob2.id } });
      const j3 = await prisma.emailJob.findUnique({ where: { id: emailJob3.id } });

      const remainingScheduled = [j1, j2, j3].filter(
        (j) => j?.status === "SCHEDULED" || j?.status === "PROCESSING"
      ).length;

      if (remainingScheduled === 0) {
        console.log(`[Part 1] All 3 jobs reached terminal/delayed status at ${i + 1}s`);
        break;
      }
    }

    const finalJ1 = await prisma.emailJob.findUnique({ where: { id: emailJob1.id } });
    const finalJ2 = await prisma.emailJob.findUnique({ where: { id: emailJob2.id } });
    const finalJ3 = await prisma.emailJob.findUnique({ where: { id: emailJob3.id } });

    const allJobs = [finalJ1, finalJ2, finalJ3].filter(Boolean);
    const sentJobs = allJobs.filter((j) => j?.status === "SENT");
    const rateLimitedJobs = allJobs.filter((j) => j?.status === "RATE_LIMITED");

    console.log(`[Part 1 Results] SENT: ${sentJobs.length}, RATE_LIMITED: ${rateLimitedJobs.length}`);
    for (const j of allJobs) {
      console.log(`  - Job ${j?.id}: status=${j?.status}, messageId=${j?.messageId || "none"}, error=${j?.errorMessage || "none"}`);
    }

    if (sentJobs.length !== 1) {
      throw new Error(`Expected exactly 1 job to be SENT, got ${sentJobs.length}`);
    }
    if (rateLimitedJobs.length !== 2) {
      throw new Error(`Expected exactly 2 jobs to be RATE_LIMITED, got ${rateLimitedJobs.length}`);
    }

    for (const rj of rateLimitedJobs) {
      if (!rj?.errorMessage?.includes("CAMPAIGN_HOURLY_LIMIT")) {
        throw new Error(`Expected rate-limited job to have reason CAMPAIGN_HOURLY_LIMIT, got: ${rj?.errorMessage}`);
      }
    }

    console.log("Worker correctly allowed 1 email and delayed remaining 2 with CAMPAIGN_HOURLY_LIMIT");

    console.log(`\n[Part 1 Slack Check] Querying SlackNotificationOutbox for campaign ${testCampaign.id}...`);
    await sleep(3000);

    const campaignOutboxRecords = await prisma.slackNotificationOutbox.findMany({
      where: {
        userId: user.id,
        eventType: "CAMPAIGN_HOURLY_LIMIT",
        createdAt: { gte: testCampaign.createdAt },
      },
      orderBy: { createdAt: "desc" },
    });

    outboxIdsToDelete.push(...campaignOutboxRecords.map((r) => r.id));

    console.log(`[Part 1 Slack Check] Found ${campaignOutboxRecords.length} campaign limit outbox record(s):`);
    for (const rec of campaignOutboxRecords) {
      console.log(`  - ID: ${rec.id} | EventType: ${rec.eventType} | Status: ${rec.status} | Channel: ${rec.channelId} | Attempts: ${rec.attempts}`);
    }

    if (campaignOutboxRecords.length !== 1) {
      throw new Error(`Expected exactly 1 campaign limit outbox record (deduplicated), found ${campaignOutboxRecords.length}`);
    }

    const outboxRecord = campaignOutboxRecords[0];
    if (outboxRecord.status !== "DISPATCHED") {
      console.warn(`[Part 1 Slack Check] Outbox status is ${outboxRecord.status}, attempting immediate dispatch check...`);
      const delivered = await deliverSlackNotification(outboxRecord.id);
      if (!delivered) {
        throw new Error(`Failed to deliver campaign limit outbox record: ${outboxRecord.lastError}`);
      }
    }

    console.log("Worker triggered durable Slack outbox record with eventType = CAMPAIGN_HOURLY_LIMIT, delivered with status = DISPATCHED");
    console.log("Deduplication verified: Job 3 in the same hourly window did not generate duplicate Slack alert\n");

    console.log("--- PART 2: Direct Service Test (Deduplication & Quota Separation) ---");
    console.log("Description: Tests notifySenderHourlyLimit and notifyCampaignHourlyLimit directly.");
    console.log("Uses isolated test identifiers so active sender production quotas are never affected.\n");

    isolatedSenderId = `test-isolated-sender-${Date.now()}`;
    const isolatedSenderEmail = `test-isolated-${Date.now()}@example.com`;
    const senderTestTime = Date.now() + 60 * 60 * 1000;

    const senderAlert1 = await notifySenderHourlyLimit({
      userId: user.id,
      senderId: isolatedSenderId,
      senderEmail: isolatedSenderEmail,
      senderName: "Isolated Test Sender",
      hourlyLimit: 50,
      nextEligibleTime: senderTestTime,
    });
    console.log(`[Part 2] First SENDER_HOURLY_LIMIT trigger:`, senderAlert1);

    const senderAlert2 = await notifySenderHourlyLimit({
      userId: user.id,
      senderId: isolatedSenderId,
      senderEmail: isolatedSenderEmail,
      senderName: "Isolated Test Sender",
      hourlyLimit: 50,
      nextEligibleTime: senderTestTime,
    });
    console.log(`[Part 2] Second SENDER_HOURLY_LIMIT trigger (Expect DEDUPLICATED):`, senderAlert2);

    if (senderAlert2.reason !== "DEDUPLICATED") {
      throw new Error(`Expected SENDER_HOURLY_LIMIT to deduplicate, got ${senderAlert2.reason}`);
    }

    const campaignAlertAnother = await notifyCampaignHourlyLimit({
      userId: user.id,
      campaignId: "distinct-campaign-" + Date.now(),
      campaignName: "Distinct Campaign Check",
      senderId: isolatedSenderId,
      senderEmail: isolatedSenderEmail,
      senderName: "Isolated Test Sender",
      hourlyLimit: 10,
      nextEligibleTime: senderTestTime,
    });
    console.log(`[Part 2] notifyCampaignHourlyLimit for distinct campaign:`, campaignAlertAnother);
    if (!campaignAlertAnother.dispatched) {
      throw new Error("Campaign alert was incorrectly blocked by sender limit dedup");
    }
    console.log("Global sender limits and campaign limits maintain independent deduplication keys and eventTypes\n");

    console.log("--- PART 3: Simulated Failure & Retry Test (Outbox Recovery Sweep) ---");
    console.log("Description: Injects simulated transient Slack API error into outbox.");
    console.log("Verifies retryPendingSlackNotifications processes and successfully delivers overdue items.\n");

    const tempOutbox = await prisma.slackNotificationOutbox.create({
      data: {
        userId: user.id,
        channelId: originalChannelId,
        eventType: "CAMPAIGN_HOURLY_LIMIT",
        payload: {
          text: "Temporary failure recovery verification test",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Outbox Recovery Test:* Transient failure successfully recovered via retry sweep.",
              },
            },
          ],
        },
        status: "PENDING",
        attempts: 1,
        maxAttempts: 3,
        lastError: "Simulated temporary Slack network timeout",
        nextAttemptAt: new Date(Date.now() - 5000),
      },
    });
    outboxIdsToDelete.push(tempOutbox.id);
    console.log(`[Part 3] Created PENDING outbox record with simulated past-due nextAttemptAt: ${tempOutbox.id}`);

    const processedCount = await retryPendingSlackNotifications();
    console.log(`[Part 3] retryPendingSlackNotifications processed ${processedCount} pending record(s)`);

    const recoveredOutbox = await prisma.slackNotificationOutbox.findUnique({
      where: { id: tempOutbox.id },
    });
    console.log(`[Part 3] Recovered record status: ${recoveredOutbox?.status} (attempts: ${recoveredOutbox?.attempts})`);

    if (recoveredOutbox?.status !== "DISPATCHED") {
      throw new Error(`Expected temporary failure outbox to be DISPATCHED, got ${recoveredOutbox?.status}`);
    }
    console.log("Outbox retry mechanism successfully recovers from temporary delivery failures\n");

    console.log("--- PART 4: Direct Service Test (Dynamic Channel & Disconnect Safety) ---");
    console.log("Description: Directly tests deliverSlackNotification and setSlackNotificationChannel.");
    console.log("Verifies channel overrides and graceful handling of missing connections.\n");

    const staleChannelOutbox = await prisma.slackNotificationOutbox.create({
      data: {
        userId: user.id,
        channelId: "C_STALE_OLD_CHANNEL",
        eventType: "CAMPAIGN_HOURLY_LIMIT",
        payload: {
          text: "Dynamic channel update verification",
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: "*Dynamic Channel Verification:* Successfully routed to latest configured channel.",
              },
            },
          ],
        },
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      },
    });
    outboxIdsToDelete.push(staleChannelOutbox.id);

    console.log(`[Part 4a] Delivering outbox record with stale channel ID...`);
    const dynamicDelivered = await deliverSlackNotification(staleChannelOutbox.id);
    if (!dynamicDelivered) {
      throw new Error("Failed to dynamically deliver outbox record with stale channel ID");
    }

    const updatedChannelOutbox = await prisma.slackNotificationOutbox.findUnique({
      where: { id: staleChannelOutbox.id },
    });
    console.log(`[Part 4a] Result channelId: ${updatedChannelOutbox?.channelId} (Status: ${updatedChannelOutbox?.status})`);
    if (updatedChannelOutbox?.channelId !== originalChannelId || updatedChannelOutbox?.status !== "DISPATCHED") {
      throw new Error(`Expected outbox to update channelId to ${originalChannelId} and be DISPATCHED`);
    }

    console.log(`[Part 4b] Testing setSlackNotificationChannel service API with '${originalChannelName}'...`);
    const setChannelRes = await setSlackNotificationChannel(user.id, originalChannelName);
    console.log(`[Part 4b] setSlackNotificationChannel response:`, setChannelRes);
    if (setChannelRes.channelId !== originalChannelId) {
      throw new Error(`Expected setSlackNotificationChannel to return ${originalChannelId}`);
    }

    console.log(`[Part 4c] Verifying graceful disconnect safety (non-existent user connection)...`);
    const disconnectedOutbox = await prisma.slackNotificationOutbox.create({
      data: {
        userId: "non-existent-user-" + Date.now(),
        channelId: originalChannelId,
        eventType: "CAMPAIGN_HOURLY_LIMIT",
        payload: { text: "Disconnect test" },
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      },
    });
    outboxIdsToDelete.push(disconnectedOutbox.id);

    const deliverRes = await deliverSlackNotification(disconnectedOutbox.id);
    const disconnectedFinal = await prisma.slackNotificationOutbox.findUnique({
      where: { id: disconnectedOutbox.id },
    });
    console.log(`[Part 4c] Disconnected delivery result: ${deliverRes} | Status: ${disconnectedFinal?.status} | Error: "${disconnectedFinal?.lastError}"`);

    if (disconnectedFinal?.status !== "FAILED" || !disconnectedFinal.lastError?.includes("disconnected")) {
      throw new Error(`Expected FAILED with disconnected message, got: ${disconnectedFinal?.lastError}`);
    }
    console.log("Channel updates take effect dynamically and disconnects fail gracefully\n");

    console.log("Verification suite completed successfully: all worker, service, and recovery assertions passed.");
  } finally {
    console.log("\n--- CLEANUP ---");
    console.log("[Cleanup] Performing safe cleanup of development test artifacts...");

    let canSafelyDeleteJobs = true;
    for (const jobId of testJobIds) {
      try {
        const qJob = await emailQueue.getJob(jobId);
        if (qJob) {
          const state = await qJob.getState();
          if (state === "active") {
            canSafelyDeleteJobs = false;
            console.warn(`[Cleanup] BullMQ job ${jobId} is currently active. Retaining DB record to prevent worker errors.`);
          } else {
            await qJob.remove();
            console.log(`[Cleanup] Removed ${state} BullMQ job ${jobId} from queue.`);
          }
        } else {
          console.log(`[Cleanup] BullMQ job ${jobId} is already completed/absent.`);
        }
      } catch (queueErr: any) {
        canSafelyDeleteJobs = false;
        console.warn(`[Cleanup] Error inspecting BullMQ job ${jobId}:`, queueErr?.message || queueErr);
      }
    }

    if (canSafelyDeleteJobs && testJobIds.length > 0) {
      await prisma.emailJob.deleteMany({
        where: { id: { in: testJobIds } },
      });
      console.log(`[Cleanup] Safely deleted ${testJobIds.length} test email records from PostgreSQL.`);
    } else if (!canSafelyDeleteJobs) {
      console.warn("[Cleanup] Skipped database email record deletion because BullMQ job removal could not be confirmed.");
    }

    if (canSafelyDeleteJobs && testCampaignId) {
      await prisma.emailCampaign.delete({
        where: { id: testCampaignId },
      }).catch(() => {});
      console.log(`[Cleanup] Deleted test campaign ${testCampaignId}.`);
    }

    if (isolatedSenderId) {
      const part2Outbox = await prisma.slackNotificationOutbox.findMany({
        where: { senderId: isolatedSenderId },
        select: { id: true },
      });
      outboxIdsToDelete.push(...part2Outbox.map((r) => r.id));
    }

    const uniqueOutboxIds = [...new Set(outboxIdsToDelete)].filter(Boolean);
    if (uniqueOutboxIds.length > 0) {
      await prisma.slackNotificationOutbox.deleteMany({
        where: { id: { in: uniqueOutboxIds } },
      });
      console.log(`[Cleanup] Deleted ${uniqueOutboxIds.length} test Slack outbox records.`);
    }

    const windowStartMs = Math.floor(Date.now() / (60 * 60 * 1000)) * (60 * 60 * 1000);
    const keysToClean: string[] = [];
    if (testCampaignId) {
      keysToClean.push(
        `ratelimit:campaign:${testCampaignId}:last_send`,
        `ratelimit:campaign:${testCampaignId}:hourly:${windowStartMs}`,
        `slack:dedup:${user.id}:campaign:${testCampaignId}:${windowStartMs}`
      );
    }
    if (isolatedSenderId) {
      keysToClean.push(
        `slack:dedup:${user.id}:sender:${isolatedSenderId}:${windowStartMs}`
      );
    }
    if (keysToClean.length > 0) {
      await redis.del(...keysToClean).catch(() => {});
    }

    console.log("[Cleanup] Safe cleanup finished; existing scheduled jobs and active sender quotas were untouched.\n");

    await prisma.$disconnect();
    redis.disconnect();
  }
}

runControlledVerification()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("VERIFICATION TEST FAILED:", err);
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(1);
  });
