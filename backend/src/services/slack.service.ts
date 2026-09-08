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
