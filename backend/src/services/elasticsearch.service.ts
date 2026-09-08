import { Client } from "@elastic/elasticsearch";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const ELASTICSEARCH_URL = process.env.ELASTICSEARCH_URL || "http://localhost:9200";
export const ELASTICSEARCH_INDEX = process.env.ELASTICSEARCH_INDEX || "mail-scheduler-emails";
const REDIS_DIRTY_KEY = "es:dirty_email_ids";

export const esClient = new Client({
  node: ELASTICSEARCH_URL,
  maxRetries: 3,
  requestTimeout: 10000,
});

export interface ElasticEmailDoc {
  id: string;
  userId: string;
  campaignId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  nextEligibleAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// Sanitizer strictly picks only search/filter metadata; never includes credentials or secrets
export function toElasticEmailDoc(email: any, userId?: string): ElasticEmailDoc {
  return {
    id: email.id,
    userId: userId || email.campaign?.userId || "",
    campaignId: email.campaignId,
    senderId: email.senderId,
    recipientEmail: email.recipientEmail,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt instanceof Date ? email.scheduledAt.toISOString() : email.scheduledAt,
    nextEligibleAt: email.nextEligibleAt ? (email.nextEligibleAt instanceof Date ? email.nextEligibleAt.toISOString() : email.nextEligibleAt) : null,
    sentAt: email.sentAt ? (email.sentAt instanceof Date ? email.sentAt.toISOString() : email.sentAt) : null,
    createdAt: email.createdAt instanceof Date ? email.createdAt.toISOString() : email.createdAt,
    updatedAt: email.updatedAt instanceof Date ? email.updatedAt.toISOString() : email.updatedAt,
  };
}

// Ensure index exists with text search and exact keyword filters
export async function initEmailIndex(): Promise<void> {
  try {
    const exists = await esClient.indices.exists({ index: ELASTICSEARCH_INDEX });
    if (!exists) {
      await esClient.indices.create({
        index: ELASTICSEARCH_INDEX,
        mappings: {
          properties: {
            id: { type: "keyword" },
            userId: { type: "keyword" },
            campaignId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipientEmail: {
              type: "keyword",
              fields: {
                text: { type: "text" },
              },
            },
            subject: {
              type: "text",
              fields: {
                keyword: { type: "keyword", ignore_above: 256 },
              },
            },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            nextEligibleAt: { type: "date" },
            sentAt: { type: "date" },
            createdAt: { type: "date" },
            updatedAt: { type: "date" },
          },
        },
      });
      console.log(`[Elasticsearch] Initialized index ${ELASTICSEARCH_INDEX} with schema mappings`);
    }
  } catch (error: any) {
    console.warn(`[Elasticsearch] Could not initialize index ${ELASTICSEARCH_INDEX}:`, error.message);
  }
}

// Index single EmailJob record with outage safety
export async function indexEmailJob(emailId: string): Promise<boolean> {
  try {
    const email = await prisma.emailJob.findUnique({
      where: { id: emailId },
      include: { campaign: { select: { userId: true } } },
    });

    if (!email) {
      return false;
    }

    const doc = toElasticEmailDoc(email);
    await esClient.index({
      index: ELASTICSEARCH_INDEX,
      id: email.id,
      document: doc,
    });

    // Successfully indexed: remove from dirty set if previously queued
    await redis.srem(REDIS_DIRTY_KEY, emailId).catch(() => {});
    return true;
  } catch (error: any) {
    console.warn(`[Elasticsearch] Indexing failed for ${emailId}: ${error.message}. Queuing for reconciliation.`);
    await redis.sadd(REDIS_DIRTY_KEY, emailId).catch(() => {});
    return false;
  }
}

// Bulk index a batch of EmailJobs with outage safety
export async function indexEmailJobsBatch(emailIds: string[]): Promise<number> {
  if (!emailIds || emailIds.length === 0) return 0;

  try {
    const emails = await prisma.emailJob.findMany({
      where: { id: { in: emailIds } },
      include: { campaign: { select: { userId: true } } },
    });

    if (emails.length === 0) return 0;

    const operations = emails.flatMap((email) => [
      { index: { _index: ELASTICSEARCH_INDEX, _id: email.id } },
      toElasticEmailDoc(email),
    ]);

    const response = await esClient.bulk({ operations, refresh: false });
    if (response.errors) {
      const failedIds: string[] = [];
      response.items.forEach((item) => {
        const action = item.index;
        if (action && action.error && action._id) {
          failedIds.push(action._id);
        }
      });
      if (failedIds.length > 0) {
        await redis.sadd(REDIS_DIRTY_KEY, ...failedIds).catch(() => {});
      }
      return emails.length - failedIds.length;
    }

    // Clean from dirty set
    await redis.srem(REDIS_DIRTY_KEY, ...emailIds).catch(() => {});
    return emails.length;
  } catch (error: any) {
    console.warn(`[Elasticsearch] Batch index error for ${emailIds.length} emails: ${error.message}. Queuing.`);
    await redis.sadd(REDIS_DIRTY_KEY, ...emailIds).catch(() => {});
    return 0;
  }
}

// Reconcile dirty queue and backfill missing records without cron
export async function reconcileElasticsearch(): Promise<{ syncedDirty: number; backfilled: number }> {
  let syncedDirty = 0;
  let backfilled = 0;

  try {
    const isAlive = await esClient.ping().catch(() => false);
    if (!isAlive) {
      console.warn("[Elasticsearch] Ping failed during reconciliation. Skipping until reachable.");
      return { syncedDirty, backfilled };
    }

    await initEmailIndex();

    // 1. Drain pending dirty email IDs from Redis
    const dirtyIds = await redis.smembers(REDIS_DIRTY_KEY).catch(() => [] as string[]);
    if (dirtyIds.length > 0) {
      syncedDirty = await indexEmailJobsBatch(dirtyIds);
      console.log(`[Elasticsearch Reconciler] Synced ${syncedDirty}/${dirtyIds.length} pending dirty records.`);
    }

    // 2. Check if DB has unindexed emails
    const dbCount = await prisma.emailJob.count();
    const esCountResponse = await esClient.count({ index: ELASTICSEARCH_INDEX }).catch(() => ({ count: 0 }));
    const esCount = esCountResponse.count;

    if (esCount < dbCount) {
      console.log(`[Elasticsearch Reconciler] Document discrepancy detected (ES: ${esCount}, DB: ${dbCount}). Running backfill.`);
      backfilled = await backfillAllEmails();
    }
  } catch (error: any) {
    console.error("[Elasticsearch Reconciler] Error during reconciliation:", error.message);
  }

  return { syncedDirty, backfilled };
}

// Backfill all EmailJobs from PostgreSQL to Elasticsearch in batches
export async function backfillAllEmails(batchSize = 200): Promise<number> {
  let totalIndexed = 0;
  let skip = 0;

  try {
    await initEmailIndex();

    while (true) {
      const batch = await prisma.emailJob.findMany({
        skip,
        take: batchSize,
        orderBy: { createdAt: "asc" },
        include: { campaign: { select: { userId: true } } },
      });

      if (batch.length === 0) break;

      const operations = batch.flatMap((email) => [
        { index: { _index: ELASTICSEARCH_INDEX, _id: email.id } },
        toElasticEmailDoc(email),
      ]);

      await esClient.bulk({ operations, refresh: false });
      totalIndexed += batch.length;
      skip += batch.length;
    }

    await esClient.indices.refresh({ index: ELASTICSEARCH_INDEX });
    console.log(`[Elasticsearch Backfill] Successfully backfilled ${totalIndexed} emails from PostgreSQL.`);
  } catch (error: any) {
    console.error("[Elasticsearch Backfill] Failed during backfill:", error.message);
  }

  return totalIndexed;
}
