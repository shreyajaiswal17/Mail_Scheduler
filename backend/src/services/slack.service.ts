import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { encryptToken, decryptToken } from "../lib/encryption";

const SLACK_OAUTH_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_OAUTH_ACCESS_URL = "https://slack.com/api/oauth.v2.access";
const SLACK_AUTH_REVOKE_URL = "https://slack.com/api/auth.revoke";
const STATE_TTL_SECONDS = 600;

export async function generateSlackOAuthState(userId: string): Promise<string> {
  const state = crypto.randomBytes(32).toString("hex");
  await redis.set(`slack:oauth:state:${state}`, userId, "EX", STATE_TTL_SECONDS);
  return state;
}

export function buildSlackAuthorizeUrl(state: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  const redirectUri = process.env.SLACK_REDIRECT_URI;
  const scopes = process.env.SLACK_BOT_SCOPES || "chat:write,channels:read,groups:read";

  if (!clientId || !redirectUri) {
    throw new Error("Missing SLACK_CLIENT_ID or SLACK_REDIRECT_URI configuration");
  }

  const params = new URLSearchParams({
    client_id: clientId,
    scope: scopes,
    redirect_uri: redirectUri,
    state,
  });

  return `${SLACK_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export async function validateAndConsumeSlackState(state: string): Promise<string | null> {
  if (!state) return null;
  const key = `slack:oauth:state:${state}`;
  const userId = await redis.get(key);
  if (userId) {
    await redis.del(key);
  }
  return userId;
}

export async function exchangeSlackCode(code: string): Promise<any> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const redirectUri = process.env.SLACK_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Missing Slack OAuth environment variables");
  }

  const formData = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(SLACK_OAUTH_ACCESS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Failed to exchange authorization code with Slack");
  }

  return data;
}

export async function saveSlackConnection(userId: string, oauthData: any): Promise<any> {
  const teamId = oauthData.team?.id || oauthData.team_id || "";
  const teamName = oauthData.team?.name || oauthData.team_name || null;
  const botUserId = oauthData.bot_user_id || null;
  const accessToken = oauthData.access_token;
  const scope = oauthData.scope || null;
  const channelId = oauthData.incoming_webhook?.channel_id || null;

  if (!accessToken) {
    throw new Error("No access_token returned by Slack OAuth");
  }

  const encryptedToken = encryptToken(accessToken);

  return await prisma.slackConnection.upsert({
    where: { userId },
    create: {
      userId,
      teamId,
      teamName,
      botUserId,
      accessToken: encryptedToken,
      scope,
      channelId,
      connectedAt: new Date(),
      updatedAt: new Date(),
    },
    update: {
      teamId,
      teamName,
      botUserId,
      accessToken: encryptedToken,
      scope,
      channelId,
      connectedAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

const SLACK_CHAT_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const SLACK_CONVERSATIONS_LIST_URL = "https://slack.com/api/conversations.list";
const SLACK_CONVERSATIONS_JOIN_URL = "https://slack.com/api/conversations.join";

export interface HourlyLimitAlertData {
  userId: string;
  senderId: string;
  senderEmail: string;
  senderName?: string | null;
  hourlyLimit: number;
  nextEligibleTime: number;
}

export interface CampaignHourlyLimitAlertData {
  userId: string;
  campaignId: string;
  campaignName?: string | null;
  senderId: string;
  senderEmail: string;
  senderName?: string | null;
  hourlyLimit: number;
  nextEligibleTime: number;
}

export async function getSlackConnectionStatus(userId: string): Promise<any> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return { connected: false };
  }

  return {
    connected: true,
    teamId: connection.teamId,
    teamName: connection.teamName,
    botUserId: connection.botUserId,
    channelId: connection.channelId,
    channelName: connection.channelName,
    scope: connection.scope,
    connectedAt: connection.connectedAt,
    updatedAt: connection.updatedAt,
  };
}

export async function disconnectSlack(userId: string): Promise<boolean> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return false;
  }

  try {
    const rawToken = decryptToken(connection.accessToken);
    await fetch(SLACK_AUTH_REVOKE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${rawToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  } catch (err: any) {
    console.warn("[Slack Service] Failed to revoke Slack token during disconnect:", err?.message || err);
  }

  await prisma.slackConnection.delete({
    where: { userId },
  });

  return true;
}

export async function getDecryptedBotToken(userId: string): Promise<string | null> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
  });

  if (!connection) {
    return null;
  }

  return decryptToken(connection.accessToken);
}

export async function listSlackChannels(userId: string): Promise<Array<{ id: string; name: string; is_private: boolean; is_member: boolean }>> {
  const token = await getDecryptedBotToken(userId);
  if (!token) {
    throw new Error("Slack workspace is not connected");
  }

  const response = await fetch(`${SLACK_CONVERSATIONS_LIST_URL}?types=public_channel,private_channel&exclude_archived=true&limit=200`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || "Failed to fetch Slack channels from API");
  }

  return (data.channels || []).map((ch: any) => ({
    id: ch.id,
    name: ch.name,
    is_private: Boolean(ch.is_private),
    is_member: Boolean(ch.is_member),
  }));
}

export async function setSlackNotificationChannel(
  userId: string,
  channelInput: string
): Promise<{ channelId: string; channelName: string; isMember?: boolean }> {
  const token = await getDecryptedBotToken(userId);
  if (!token) {
    throw new Error("Slack workspace is not connected");
  }

  const channels = await listSlackChannels(userId);
  const cleanInput = channelInput.replace(/^#/, "").trim().toLowerCase();

  const matched = channels.find(
    (c) => c.id === channelInput.trim() || c.name.toLowerCase() === cleanInput
  );

  let targetChannelId: string;
  let targetChannelName: string;

  if (matched) {
    targetChannelId = matched.id;
    targetChannelName = matched.name;

    if (!matched.is_member) {
      try {
        const joinRes = await fetch(SLACK_CONVERSATIONS_JOIN_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ channel: targetChannelId }),
        });
        const joinData = await joinRes.json();
        if (!joinData.ok) {
          console.warn(
            `[Slack] Auto-join for channel ${targetChannelId} returned ok=false (${joinData.error || "failed"}). Bot must be invited manually to the channel.`
          );
        } else {
          matched.is_member = true;
        }
      } catch (joinErr) {
        console.warn(`[Slack] Auto-join for channel ${targetChannelId} non-fatal warning:`, joinErr);
      }
    }
  } else if (/^[A-Z0-9]{8,12}$/.test(channelInput.trim())) {
    targetChannelId = channelInput.trim();
    targetChannelName = "channel";
  } else {
    throw new Error(`Channel "${channelInput}" not found in your connected Slack workspace`);
  }

  await prisma.slackConnection.update({
    where: { userId },
    data: {
      channelId: targetChannelId,
      channelName: targetChannelName,
      updatedAt: new Date(),
    },
  });

  return {
    channelId: targetChannelId,
    channelName: targetChannelName,
    isMember: Boolean(matched?.is_member),
  };
}

export async function postSlackMessage(
  userId: string,
  channelId: string,
  text: string,
  blocks?: any[]
): Promise<{ ok: boolean; ts?: string; channel?: string; error?: string }> {
  const token = await getDecryptedBotToken(userId);
  if (!token) {
    throw new Error("Slack workspace is not connected");
  }

  const payload: any = {
    channel: channelId,
    text,
  };
  if (blocks && blocks.length > 0) {
    payload.blocks = blocks;
  }

  const res = await fetch(SLACK_CHAT_POST_MESSAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) {
    return { ok: false, error: data.error || "Slack chat.postMessage failed" };
  }

  return { ok: true, ts: data.ts, channel: data.channel };
}

export async function deliverSlackNotification(outboxId: string): Promise<boolean> {
  const record = await prisma.slackNotificationOutbox.findUnique({
    where: { id: outboxId },
  });

  if (!record || record.status === "DISPATCHED") {
    return true;
  }

  try {
    const payload = record.payload as any;

    const connection = await prisma.slackConnection.findUnique({
      where: { userId: record.userId },
    });

    if (!connection) {
      await prisma.slackNotificationOutbox.update({
        where: { id: outboxId },
        data: {
          status: "FAILED",
          lastError: "Slack workspace was disconnected",
          updatedAt: new Date(),
        },
      });
      return false;
    }

    const targetChannelId = connection.channelId || record.channelId;

    const result = await postSlackMessage(
      record.userId,
      targetChannelId,
      payload.text || "Mail Scheduler Notification",
      payload.blocks
    );

    if (result.ok) {
      await prisma.slackNotificationOutbox.update({
        where: { id: outboxId },
        data: {
          status: "DISPATCHED",
          channelId: targetChannelId,
          attempts: record.attempts + 1,
          updatedAt: new Date(),
        },
      });
      return true;
    }

    throw new Error(result.error || "Failed to post message");
  } catch (err: any) {
    const nextAttempts = record.attempts + 1;
    const isExhausted = nextAttempts >= record.maxAttempts;
    const backoffMs = Math.pow(3, nextAttempts) * 3000;

    await prisma.slackNotificationOutbox.update({
      where: { id: outboxId },
      data: {
        attempts: nextAttempts,
        status: isExhausted ? "FAILED" : "PENDING",
        lastError: err?.message || String(err),
        nextAttemptAt: new Date(Date.now() + backoffMs),
        updatedAt: new Date(),
      },
    });

    console.warn(
      `[Slack Outbox] Delivery attempt ${nextAttempts}/${record.maxAttempts} failed for ${outboxId}:`,
      err?.message || err
    );
    return false;
  }
}

export async function sendSlackTestNotification(userId: string): Promise<{ success: boolean; channel: string; ts?: string }> {
  const connection = await prisma.slackConnection.findUnique({
    where: { userId },
  });

  if (!connection || !connection.channelId) {
    throw new Error("No notification channel configured. Please select and save a Slack channel first.");
  }

  const channelDisplay = connection.channelName ? `#${connection.channelName}` : connection.channelId;
  const timestamp = new Date().toLocaleTimeString("en-US", { timeZone: "UTC", timeZoneName: "short" });

  const text = `Mail Scheduler Test Alert: Notification system connected to ${channelDisplay}!`;
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Mail Scheduler Notification Test",
        emoji: false,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Success!* Your Slack integration is active.\nRate-limit and dispatch alerts for your mail campaigns will be posted to this channel.`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `*Channel:* ${channelDisplay} | *Workspace:* ${connection.teamName || connection.teamId} | *Timestamp:* ${timestamp}`,
        },
      ],
    },
  ];

  const outbox = await prisma.slackNotificationOutbox.create({
    data: {
      userId,
      channelId: connection.channelId,
      eventType: "TEST",
      payload: { text, blocks },
      status: "PENDING",
      attempts: 0,
      maxAttempts: 3,
      nextAttemptAt: new Date(),
    },
  });

  const delivered = await deliverSlackNotification(outbox.id);
  if (!delivered) {
    const updatedOutbox = await prisma.slackNotificationOutbox.findUnique({
      where: { id: outbox.id },
    });
    const slackError = updatedOutbox?.lastError;
    if (slackError === "not_in_channel") {
      throw new Error(
        `The Mail Scheduler bot is not in ${channelDisplay}. In Slack, please open ${channelDisplay} and invite the bot by typing "/invite @Mail Scheduler" (or adding the Mail Scheduler app), then try again.`
      );
    }
    throw new Error(
      `Failed to deliver test notification to ${channelDisplay} (${slackError || "dispatch failed"}). Please verify bot permissions and channel membership.`
    );
  }

  return { success: true, channel: channelDisplay };
}

export async function notifySenderHourlyLimit(
  data: HourlyLimitAlertData
): Promise<{ dispatched: boolean; reason?: string }> {
  try {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const windowStartMs = Math.floor(Date.now() / ONE_HOUR_MS) * ONE_HOUR_MS;
    const dedupKey = `slack:dedup:${data.userId}:sender:${data.senderId}:${windowStartMs}`;

    const acquired = await redis.set(dedupKey, "1", "EX", 7200, "NX");
    if (!acquired) {
      return { dispatched: false, reason: "DEDUPLICATED" };
    }

    const connection = await prisma.slackConnection.findUnique({
      where: { userId: data.userId },
    });

    if (!connection || !connection.channelId) {
      return { dispatched: false, reason: "SLACK_NOT_CONNECTED_OR_NO_CHANNEL" };
    }

    const senderDisplay = data.senderName
      ? `${data.senderName} (${data.senderEmail})`
      : data.senderEmail;
    const nextTimeStr = new Date(data.nextEligibleTime).toUTCString();

    const text = `Global hourly sending limit reached for sender ${senderDisplay}. Limit: ${data.hourlyLimit}/hr. Next eligible dispatch: ${nextTimeStr}.`;
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Sender Global Hourly Limit Reached",
          emoji: false,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Sender:*\n${senderDisplay}`,
          },
          {
            type: "mrkdwn",
            text: `*Global Hourly Limit:*\n${data.hourlyLimit} emails / hr`,
          },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Dispatch Status:*\nPaused until quota resets`,
          },
          {
            type: "mrkdwn",
            text: `*Next Eligible Window:*\n${nextTimeStr}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "All campaigns using this sender are paused until the next hourly window opens. Pending emails remain safely queued.",
          },
        ],
      },
    ];

    const outbox = await prisma.slackNotificationOutbox.create({
      data: {
        userId: data.userId,
        senderId: data.senderId,
        channelId: connection.channelId,
        eventType: "SENDER_HOURLY_LIMIT",
        payload: {
          limitType: "SENDER_HOURLY_LIMIT",
          senderEmail: data.senderEmail,
          senderName: data.senderName,
          hourlyLimit: data.hourlyLimit,
          nextEligibleTime: data.nextEligibleTime,
          text,
          blocks,
        },
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      },
    });

    deliverSlackNotification(outbox.id).catch((err) => {
      console.warn("[Slack] Outbox immediate delivery error for sender alert:", err?.message || err);
    });

    return { dispatched: true };
  } catch (err: any) {
    console.error("[Slack Service] Unexpected error in notifySenderHourlyLimit:", err?.message || err);
    return { dispatched: false, reason: err?.message || "ERROR" };
  }
}

export async function notifyCampaignHourlyLimit(
  data: CampaignHourlyLimitAlertData
): Promise<{ dispatched: boolean; reason?: string }> {
  try {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const windowStartMs = Math.floor(Date.now() / ONE_HOUR_MS) * ONE_HOUR_MS;
    const dedupKey = `slack:dedup:${data.userId}:campaign:${data.campaignId}:${windowStartMs}`;

    const acquired = await redis.set(dedupKey, "1", "EX", 7200, "NX");
    if (!acquired) {
      return { dispatched: false, reason: "DEDUPLICATED" };
    }

    const connection = await prisma.slackConnection.findUnique({
      where: { userId: data.userId },
    });

    if (!connection || !connection.channelId) {
      return { dispatched: false, reason: "SLACK_NOT_CONNECTED_OR_NO_CHANNEL" };
    }

    const campaignDisplay = data.campaignName
      ? `${data.campaignName}`
      : `Campaign (${data.campaignId.slice(0, 8)})`;
    const senderDisplay = data.senderName
      ? `${data.senderName} (${data.senderEmail})`
      : data.senderEmail;
    const nextTimeStr = new Date(data.nextEligibleTime).toUTCString();

    const text = `Hourly sending limit reached for campaign "${campaignDisplay}". Limit: ${data.hourlyLimit}/hr. Next eligible dispatch: ${nextTimeStr}.`;
    const blocks = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Campaign Hourly Sending Limit Reached",
          emoji: false,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Campaign:*\n${campaignDisplay}`,
          },
          {
            type: "mrkdwn",
            text: `*Campaign Limit:*\n${data.hourlyLimit} emails / hr`,
          },
        ],
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Assigned Sender:*\n${senderDisplay}`,
          },
          {
            type: "mrkdwn",
            text: `*Next Eligible Window:*\n${nextTimeStr}`,
          },
        ],
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Campaign dispatch paused until the next hourly window. Global sender quota and other campaigns remain unaffected.",
          },
        ],
      },
    ];

    const outbox = await prisma.slackNotificationOutbox.create({
      data: {
        userId: data.userId,
        senderId: data.senderId,
        channelId: connection.channelId,
        eventType: "CAMPAIGN_HOURLY_LIMIT",
        payload: {
          limitType: "CAMPAIGN_HOURLY_LIMIT",
          campaignId: data.campaignId,
          campaignName: data.campaignName,
          senderEmail: data.senderEmail,
          senderName: data.senderName,
          hourlyLimit: data.hourlyLimit,
          nextEligibleTime: data.nextEligibleTime,
          text,
          blocks,
        },
        status: "PENDING",
        attempts: 0,
        maxAttempts: 3,
        nextAttemptAt: new Date(),
      },
    });

    deliverSlackNotification(outbox.id).catch((err) => {
      console.warn("[Slack] Outbox immediate delivery error for campaign alert:", err?.message || err);
    });

    return { dispatched: true };
  } catch (err: any) {
    console.error("[Slack Service] Unexpected error in notifyCampaignHourlyLimit:", err?.message || err);
    return { dispatched: false, reason: err?.message || "ERROR" };
  }
}

export async function retryPendingSlackNotifications(): Promise<number> {
  const pending = await prisma.slackNotificationOutbox.findMany({
    where: {
      status: "PENDING",
      nextAttemptAt: { lte: new Date() },
    },
    take: 20,
    orderBy: { nextAttemptAt: "asc" },
  });

  let processed = 0;
  for (const item of pending) {
    const success = await deliverSlackNotification(item.id);
    if (success) processed++;
  }
  return processed;
}
