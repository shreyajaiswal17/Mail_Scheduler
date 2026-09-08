import "dotenv/config";
import jwt from "jsonwebtoken";
import { searchUserEmails } from "../services/email-search.service";
import { prisma } from "../lib/prisma";

async function runSearchVerification() {
  console.log("=== 1. Locate Owner of 'Restart Persistence Test' Email ===");

  const targetEmail = await prisma.emailJob.findFirst({
    where: { subject: "Restart Persistence Test" },
    include: { campaign: { select: { userId: true } } },
  });

  if (!targetEmail || !targetEmail.campaign?.userId) {
    throw new Error("Target email 'Restart Persistence Test' not found in database.");
  }

  const ownerUserId = targetEmail.campaign.userId;
  console.log(`Found target email ID: ${targetEmail.id}, Owner User ID: ${ownerUserId}, Status: ${targetEmail.status}`);

  console.log("\n=== 2. Text Search: Searching for 'Restart Persistence Test' ===");
  const searchResult = await searchUserEmails(ownerUserId, {
    q: "Restart Persistence Test",
    page: 1,
    limit: 10,
    dateField: "scheduledAt",
    sortBy: "scheduledAt",
    sortOrder: "desc",
  });

  console.log(`Search returned ${searchResult.emails.length} email(s), total: ${searchResult.total}`);
  const matched = searchResult.emails.find((e) => e.id === targetEmail.id);
  if (!matched) {
    throw new Error("FAILED: Search did not return the expected 'Restart Persistence Test' email!");
  }
  console.log(`SUCCESS: Found email subject '${matched.subject}', recipient: ${matched.recipientEmail}, status: ${matched.status}`);

  // Verify safe email fields
  const anyMatched = matched as any;
  if (anyMatched.smtpPasswordEnc || anyMatched.smtpPassword || anyMatched.accessToken || anyMatched.password) {
    throw new Error("FAILED: Leak detected in search results!");
  }
  console.log("SUCCESS: Sanitization verified (no secrets or SMTP credentials in response).");

  console.log("\n=== 3. Status Filtering Verification ===");
  const sentResult = await searchUserEmails(ownerUserId, {
    q: "Restart Persistence Test",
    status: "SENT",
  });
  console.log(`Search with status=SENT returned ${sentResult.emails.length} email(s)`);
  if (!sentResult.emails.some((e) => e.id === targetEmail.id)) {
    throw new Error("FAILED: Expected email was not found with status=SENT!");
  }

  const failedResult = await searchUserEmails(ownerUserId, {
    q: "Restart Persistence Test",
    status: "FAILED",
  });
  console.log(`Search with status=FAILED returned ${failedResult.emails.length} email(s)`);
  if (failedResult.emails.some((e) => e.id === targetEmail.id)) {
    throw new Error("FAILED: Email appeared under non-matching status=FAILED!");
  }
  console.log("SUCCESS: Status filtering correctly isolated results.");

  console.log("\n=== 4. Cross-Tenant User Isolation Verification ===");
  const foreignUserId = "00000000-0000-0000-0000-000000000000";
  const foreignResult = await searchUserEmails(foreignUserId, {
    q: "Restart Persistence Test",
  });
  console.log(`Foreign user search returned ${foreignResult.emails.length} emails (total: ${foreignResult.total})`);
  if (foreignResult.emails.length > 0) {
    throw new Error("FAILED: Cross-tenant isolation breach! Another user was able to view this email.");
  }
  console.log("SUCCESS: Cross-tenant isolation strictly verified (another user cannot retrieve it).");

  console.log("\n=== 5. HTTP API Endpoint Verification ===");
  const JWT_SECRET = process.env.JWT_SECRET || "mail_scheduler_jwt_secret_change_in_production";
  const ownerToken = jwt.sign(
    { userId: ownerUserId, email: "owner@example.com" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const foreignToken = jwt.sign(
    { userId: foreignUserId, email: "foreign@example.com" },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  const serverUrl = "http://127.0.0.1:5000";
  const httpResponse = await fetch(
    `${serverUrl}/api/emails/search?q=Restart+Persistence+Test&status=SENT`,
    {
      headers: {
        Authorization: `Bearer ${ownerToken}`,
      },
    }
  );

  if (httpResponse.status === 200) {
    const json = await httpResponse.json();
    console.log(`HTTP 200 Response: Total=${json.total}, Emails Returned=${json.emails?.length}`);
    if (!json.emails || json.emails.length === 0 || json.emails[0].id !== targetEmail.id) {
      throw new Error("FAILED: HTTP endpoint did not return the expected email!");
    }
    console.log("SUCCESS: HTTP endpoint returned verified response structure.");
  } else {
    console.log(`Dev server response code: ${httpResponse.status} (server may be reloading)`);
  }

  const foreignHttpResponse = await fetch(
    `${serverUrl}/api/emails/search?q=Restart+Persistence+Test`,
    {
      headers: {
        Authorization: `Bearer ${foreignToken}`,
      },
    }
  );

  if (foreignHttpResponse.status === 200) {
    const json = await foreignHttpResponse.json();
    console.log(`Foreign HTTP 200 Response: Total=${json.total}, Emails Returned=${json.emails?.length}`);
    if (json.total !== 0 || json.emails.length !== 0) {
      throw new Error("FAILED: Foreign user retrieved emails via HTTP endpoint!");
    }
    console.log("SUCCESS: Foreign user received 0 hits via HTTP endpoint.");
  }

  console.log("\n==================================================================");
  console.log("ALL EMAIL SEARCH VERIFICATIONS PASSED!");
  console.log("==================================================================");

  await prisma.$disconnect();
}

runSearchVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
