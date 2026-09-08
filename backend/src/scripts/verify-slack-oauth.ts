import "dotenv/config";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import {
  generateSlackOAuthState,
  buildSlackAuthorizeUrl,
  validateAndConsumeSlackState,
  saveSlackConnection,
  getSlackConnectionStatus,
  disconnectSlack,
  getDecryptedBotToken,
} from "../services/slack.service";

async function runSlackVerification() {
  console.log("=== 1. Locate or Create Test User ===");
  let testUser = await prisma.user.findFirst();
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        googleId: `test-slack-google-${Date.now()}`,
        name: "Slack Tester",
        email: `slack-tester-${Date.now()}@example.com`,
      },
    });
  }
  const userId = testUser.id;
  console.log(`Using user ID: ${userId} (${testUser.email})`);

  console.log("\n=== 2. Test Cryptographic State & CSRF Protection ===");
  const state = await generateSlackOAuthState(userId);
  console.log(`Generated state (hex): ${state} (length: ${state.length})`);
  if (state.length !== 64) {
    throw new Error("FAILED: State is not 64 hex characters (32 bytes)!");
  }

  const redisKey = `slack:oauth:state:${state}`;
  const storedUser = await redis.get(redisKey);
  const ttl = await redis.ttl(redisKey);
  console.log(`Redis stored userId: ${storedUser}, TTL: ${ttl}s`);
  if (storedUser !== userId || ttl <= 0 || ttl > 600) {
    throw new Error("FAILED: State was not correctly stored in Redis with short-lived TTL!");
  }

  const authUrl = buildSlackAuthorizeUrl(state);
  console.log(`Constructed Slack Authorize URL: ${authUrl}`);
  if (!authUrl.includes("client_id=") || !authUrl.includes(`state=${state}`)) {
    throw new Error("FAILED: Authorize URL missing required query parameters!");
  }

  const forgedState = "forged-csrf-state-attempt";
  const forgedResult = await validateAndConsumeSlackState(forgedState);
  if (forgedResult !== null) {
    throw new Error("FAILED: Forged state was accepted!");
  }
  console.log("SUCCESS: Forged CSRF state rejected as null.");

  const validConsumedUser = await validateAndConsumeSlackState(state);
  if (validConsumedUser !== userId) {
    throw new Error("FAILED: Valid state did not return the correct user ID!");
  }
  console.log("SUCCESS: Valid state verified and consumed for user.");

  const replayResult = await validateAndConsumeSlackState(state);
  if (replayResult !== null) {
    throw new Error("FAILED: Replay attack accepted consumed state!");
  }
  console.log("SUCCESS: State is strictly single-use (replay rejected).");

  console.log("\n=== 3. Test Encrypted Token Storage & Reconnecting ===");
  const rawBotToken = "xoxb-test-real-slack-bot-token-987654321";
  const mockOAuthPayload = {
    ok: true,
    team: { id: "T08TESTWKSP", name: "Reachinbox Engineering" },
    bot_user_id: "U08BOTUSER1",
    access_token: rawBotToken,
    scope: "chat:write,channels:read",
  };

  await saveSlackConnection(userId, mockOAuthPayload);
  const dbRecord = await prisma.slackConnection.findUnique({ where: { userId } });
  if (!dbRecord) {
    throw new Error("FAILED: SlackConnection record not found in PostgreSQL!");
  }

  console.log(`Database teamName: ${dbRecord.teamName}, teamId: ${dbRecord.teamId}`);
  console.log(`Stored accessToken in DB (encrypted): ${dbRecord.accessToken.substring(0, 30)}...`);

  if (dbRecord.accessToken.includes("xoxb-")) {
    throw new Error("SECURITY FAILURE: Plaintext bot token found in database!");
  }
  console.log("SUCCESS: Token is encrypted using AES-256-GCM in PostgreSQL.");

  const decryptedToken = await getDecryptedBotToken(userId);
  if (decryptedToken !== rawBotToken) {
    throw new Error("FAILED: Decrypted token does not match original token!");
  }
  console.log("SUCCESS: Token successfully decrypted with existing encryption utility.");

  const updatedPayload = {
    ok: true,
    team: { id: "T09UPDATED", name: "Acme Corp Worldwide" },
    bot_user_id: "U09BOTNEW",
    access_token: "xoxb-updated-token-111222333",
    scope: "chat:write,channels:read,groups:read",
  };

  await saveSlackConnection(userId, updatedPayload);
  const updatedDb = await prisma.slackConnection.findUnique({ where: { userId } });
  if (updatedDb?.teamName !== "Acme Corp Worldwide" || updatedDb?.teamId !== "T09UPDATED") {
    throw new Error("FAILED: Reconnecting to new workspace did not update correctly!");
  }
  console.log("SUCCESS: Reconnecting and workspace switching verified.");

  console.log("\n=== 4. Test Status Retrieval & Token Leak Prevention ===");
  const status = await getSlackConnectionStatus(userId);
  console.log("Status API output:", JSON.stringify(status, null, 2));

  if (!status.connected || status.teamName !== "Acme Corp Worldwide") {
    throw new Error("FAILED: Status did not return connected state or team details!");
  }
  if ((status as any).accessToken || (status as any).token) {
    throw new Error("SECURITY FAILURE: Token exposed in status response!");
  }
  console.log("SUCCESS: Status endpoint returns workspace details without exposing tokens.");

  console.log("\n=== 5. Test Live HTTP API Endpoints ===");
  const JWT_SECRET = process.env.JWT_SECRET || "mail_scheduler_jwt_secret_change_in_production";
  const userToken = jwt.sign(
    { userId, email: testUser.email },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const serverUrl = "http://127.0.0.1:5000";

  const connectRes = await fetch(`${serverUrl}/api/slack/connect`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const connectJson = await connectRes.json();
  console.log(`GET /api/slack/connect status: ${connectRes.status}, URL: ${connectJson.url?.substring(0, 50)}...`);
  if (connectRes.status !== 200 || !connectJson.url || !connectJson.state) {
    throw new Error("FAILED: /api/slack/connect failed to return authorization URL!");
  }

  const statusRes = await fetch(`${serverUrl}/api/slack/status`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const statusJson = await statusRes.json();
  console.log(`GET /api/slack/status status: ${statusRes.status}, Connected: ${statusJson.connected}`);
  if (statusRes.status !== 200 || !statusJson.connected) {
    throw new Error("FAILED: /api/slack/status did not return 200 with connection details!");
  }

  const deniedRes = await fetch(`${serverUrl}/api/slack/callback?error=access_denied&error_description=The+user+cancelled+authorization`);
  const deniedJson = await deniedRes.json();
  console.log(`GET /api/slack/callback (denied) status: ${deniedRes.status}, Error: ${deniedJson.error}`);
  if (deniedRes.status !== 400 || deniedJson.error !== "OAuth Authorization Denied") {
    throw new Error("FAILED: Denied authorization was not handled gracefully!");
  }

  const invalidRes = await fetch(`${serverUrl}/api/slack/callback?code=fake_code&state=fake_state`);
  const invalidJson = await invalidRes.json();
  console.log(`GET /api/slack/callback (invalid state) status: ${invalidRes.status}, Error: ${invalidJson.error}`);
  if (invalidRes.status !== 400 || invalidJson.error !== "Invalid State") {
    throw new Error("FAILED: Callback with forged state was not rejected!");
  }

  console.log("\n=== 6. Test Disconnection ===");
  const disconnectRes = await fetch(`${serverUrl}/api/slack/disconnect`, {
    method: "POST",
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const disconnectJson = await disconnectRes.json();
  console.log(`POST /api/slack/disconnect status: ${disconnectRes.status}, Response:`, disconnectJson);
  if (disconnectRes.status !== 200 || !disconnectJson.success) {
    throw new Error("FAILED: Disconnect endpoint did not return success!");
  }

  const postDisconnectStatus = await getSlackConnectionStatus(userId);
  console.log("Post-disconnect status:", postDisconnectStatus);
  if (postDisconnectStatus.connected !== false) {
    throw new Error("FAILED: User is still marked as connected after disconnect!");
  }
  console.log("SUCCESS: Disconnection verified in PostgreSQL.");

  console.log("\n==================================================================");
  console.log("ALL SLACK OAUTH VERIFICATIONS PASSED!");
  console.log("==================================================================");

  await prisma.$disconnect();
}

runSlackVerification().catch((err) => {
  console.error("Slack OAuth Verification failed:", err);
  process.exit(1);
});
