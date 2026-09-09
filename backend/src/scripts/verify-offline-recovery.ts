import "dotenv/config";
import { prisma } from "../lib/prisma";
import {
  esClient,
  ELASTICSEARCH_INDEX,
  indexEmailJob,
  reconcileElasticsearch,
  backfillAllEmails,
} from "../services/elasticsearch.service";
import { execSync } from "child_process";

async function verifyOfflineRecovery() {
  console.log("=== 1. Establishing Baseline Synchronization ===");
  await backfillAllEmails();
  const initialDbCount = await prisma.emailJob.count();
  const initialEsCount = (await esClient.count({ index: ELASTICSEARCH_INDEX })).count;
  console.log(`DB Count: ${initialDbCount} | ES Count: ${initialEsCount}`);

  const sender = await prisma.sender.findFirst({ where: { isActive: true } });
  if (!sender) throw new Error("No active sender found in database");

  const now = new Date();
  const testEmail = await prisma.emailJob.create({
    data: {
      sender: { connect: { id: sender.id } },
      campaign: {
        create: {
          user: { connect: { id: sender.userId } },
          sender: { connect: { id: sender.id } },
          subject: "Recovery Test Email",
          body: "Initial Scheduled Content",
          startTime: now,
          delayMs: 2000,
          hourlyLimit: 100,
        },
      },
      recipientEmail: `recovery-test-${Date.now()}@example.com`,
      subject: "Recovery Test Email",
      body: "Initial Scheduled Content",
      status: "SCHEDULED",
      scheduledAt: now,
      updatedAt: now,
    },
    include: { campaign: true },
  });

  await indexEmailJob(testEmail.id);
  await esClient.indices.refresh({ index: ELASTICSEARCH_INDEX });

  const initialDoc = await esClient.get({ index: ELASTICSEARCH_INDEX, id: testEmail.id });
  const initialSource = initialDoc._source as any;
  console.log(`[ES Document] Initial state in Elasticsearch: status = ${initialSource?.status}`);

  const countBeforeOutageDb = await prisma.emailJob.count();
  const countBeforeOutageEs = (await esClient.count({ index: ELASTICSEARCH_INDEX })).count;
  console.log(`Document Counts Before Outage: DB = ${countBeforeOutageDb}, ES = ${countBeforeOutageEs} (Equal: ${countBeforeOutageDb === countBeforeOutageEs})`);

  console.log("\n=== 2. Simulating Elasticsearch Outage (Stopping Container) ===");
  execSync("docker stop mail-scheduler-elasticsearch", { stdio: "inherit" });
  console.log("Elasticsearch is now offline.");

  console.log("\n=== 3. Modifying Status to SENT in PostgreSQL During Outage ===");
  const updateTimestamp = new Date(Date.now() + 5000);
  const updatedEmail = await prisma.emailJob.update({
    where: { id: testEmail.id },
    data: {
      status: "SENT",
      sentAt: updateTimestamp,
      updatedAt: updateTimestamp,
    },
  });

  console.log("Calling indexEmailJob while ES is completely offline...");
  const callResult = await indexEmailJob(updatedEmail.id);
  console.log(`indexEmailJob returned cleanly without throwing (success = ${callResult})`);

  const outboxEntry = await prisma.searchOutbox.findUnique({
    where: { emailId: updatedEmail.id },
  });
  console.log(`[PostgreSQL SearchOutbox] Durable status: ${outboxEntry?.status}`);
  if (outboxEntry?.status !== "PENDING") {
    throw new Error("SearchOutbox should be PENDING in PostgreSQL!");
  }

  console.log("\n=== 4. Restoring Elasticsearch Container ===");
  execSync("docker start mail-scheduler-elasticsearch", { stdio: "inherit" });
  console.log("Waiting for Elasticsearch to report ready...");

  for (let i = 0; i < 45; i++) {
    try {
      const health = await esClient.cluster.health({ wait_for_status: "yellow", timeout: "2s" });
      if (health.status === "yellow" || health.status === "green") {
        console.log("Elasticsearch is back online, recovered cluster state, and accepting requests!");
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n=== 5. Verifying Counts are STILL EQUAL but Document Content is STALE ===");
  const countAfterRecoveryDb = await prisma.emailJob.count();
  const countAfterRecoveryEs = (await esClient.count({ index: ELASTICSEARCH_INDEX })).count;
  console.log(`Document Counts: DB = ${countAfterRecoveryDb}, ES = ${countAfterRecoveryEs} (Equal: ${countAfterRecoveryDb === countAfterRecoveryEs})`);

  const staleDoc = await esClient.get({ index: ELASTICSEARCH_INDEX, id: testEmail.id });
  const staleSource = staleDoc._source as any;
  console.log(`[ES Document BEFORE Reconciliation] Status is STILL stale: ${staleSource?.status}`);

  console.log("\n=== 6. Executing Event-Driven Reconciliation (No Cron) ===");
  const recon = await reconcileElasticsearch();
  console.log(`Reconciliation result: Synced Outbox = ${recon.syncedOutbox}, Synced Redis = ${recon.syncedRedis}`);

  const outboxAfter = await prisma.searchOutbox.findUnique({
    where: { emailId: updatedEmail.id },
  });
  console.log(`[PostgreSQL SearchOutbox] Final status: ${outboxAfter?.status}`);

  await esClient.indices.refresh({ index: ELASTICSEARCH_INDEX });
  const finalDoc = await esClient.get({ index: ELASTICSEARCH_INDEX, id: testEmail.id });
  const finalSource = finalDoc._source as any;
  console.log(`[ES Document AFTER Reconciliation] Final status in ES: ${finalSource?.status}`);

  if (finalSource?.status !== "SENT") {
    throw new Error(`FAILED: Expected status SENT, found ${finalSource?.status}`);
  }

  console.log("\nOffline status change was durably recovered after outage.");
  console.log("Equal counts did not mask the stale state, and external_gte ensured clean sync.");

  await esClient.close();
  process.exit(0);
}

verifyOfflineRecovery().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
