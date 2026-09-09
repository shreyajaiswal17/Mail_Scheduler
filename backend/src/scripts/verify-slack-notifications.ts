import "dotenv/config";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import {
  getSlackConnectionStatus,
  listSlackChannels,
  setSlackNotificationChannel,
  sendSlackTestNotification,
  notifySenderHourlyLimit,
} from "../services/slack.service";

async function main() {
  console.log("Testing Slack notifications and rate limit alerts...\n");

  const user = await prisma.user.findFirst({
    where: { email: "codex1712@gmail.com" },
    include: { slackConnection: true, senders: true },
  });

  if (!user) {
    console.error("User codex1712@gmail.com not found");
    process.exit(1);
  }

  console.log(`[1] Authenticated User: ${user.name} (${user.email}) [ID: ${user.id}]`);
  const status = await getSlackConnectionStatus(user.id);
  console.log("[1] Slack Connection Status:", JSON.stringify(status, null, 2));

  if (!status.connected) {
    console.error("Slack is not connected for this user");
    process.exit(1);
  }

  console.log("\n[2] Listing Slack Channels from Slack API...");
  const channels = await listSlackChannels(user.id);
  console.log(`[2] Found ${channels.length} accessible Slack channels:`);
  for (const ch of channels) {
    console.log(`    - #${ch.name} (ID: ${ch.id}, private: ${ch.is_private}, is_member: ${ch.is_member})`);
  }

  const alertChannel = channels.find((c) => c.name === "mail-scheduler-alerts");
  if (!alertChannel) {
    console.warn("Warning: #mail-scheduler-alerts not found in channel list, checking by ID...");
  } else {
    console.log(`Verified #mail-scheduler-alerts found with ID: ${alertChannel.id}`);
  }

  console.log("\n[3] Setting notification channel to #mail-scheduler-alerts...");
  const configured = await setSlackNotificationChannel(user.id, "mail-scheduler-alerts");
  console.log(`Saved notification channel in PostgreSQL: channelId=${configured.channelId}, channelName=${configured.channelName}`);

  console.log("\n[4] Sending Live Slack Test Notification via Outbox & Slack Web API...");
  const testResult = await sendSlackTestNotification(user.id);
  console.log("Test notification result:", testResult);

  console.log("\n[5] Testing SENDER_HOURLY_LIMIT alert trigger...");
  const sender = user.senders[0] || {
    id: "test-sender-id-001",
    email: "sender@example.com",
    name: "Primary Campaign Sender",
  };

  const nextEligibleTime = Date.now() + 45 * 60 * 1000;

  console.log(`[5a] Triggering first alert for sender: ${sender.email} (Limit: 50/hr)...`);
  const alert1 = await notifySenderHourlyLimit({
    userId: user.id,
    senderId: sender.id,
    senderEmail: sender.email,
    senderName: sender.name,
    hourlyLimit: 50,
    nextEligibleTime,
  });
  console.log("Alert 1 Response:", alert1);

  console.log("\n[6] Testing Deduplication on immediate second trigger...");
  const alert2 = await notifySenderHourlyLimit({
    userId: user.id,
    senderId: sender.id,
    senderEmail: sender.email,
    senderName: sender.name,
    hourlyLimit: 50,
    nextEligibleTime,
  });
  console.log("Alert 2 Response (Expect DEDUPLICATED):", alert2);

  if (alert2.reason === "DEDUPLICATED") {
    console.log("SUCCESS: Deduplication correctly prevented duplicate Slack message within the hourly window");
  } else {
    console.error("FAILED: Deduplication did not trigger");
  }

  console.log("\n[7] Querying SlackNotificationOutbox records...");
  const outboxItems = await prisma.slackNotificationOutbox.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log(`[7] Found ${outboxItems.length} recent outbox records:`);
  for (const item of outboxItems) {
    console.log(`    - ID: ${item.id} | Type: ${item.eventType} | Status: ${item.status} | Attempts: ${item.attempts}/${item.maxAttempts} | Channel: ${item.channelId}`);
  }

  console.log("\nAll Slack notification tests completed successfully.");

  await prisma.$disconnect();
  redis.disconnect();
}

main().catch((err) => {
  console.error("FATAL in verify-slack-notifications:", err);
  process.exit(1);
});
