import { Client } from "@elastic/elasticsearch";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";

const rawUrl = process.env.ELASTICSEARCH_URL || "http://127.0.0.1:9200";
const ELASTICSEARCH_URL = rawUrl.replace("localhost", "127.0.0.1");
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

// Mark search outbox entry as PENDING in PostgreSQL (durable intent)
export async function markSearchOutboxPending(emailId: string): Promise<void> {
  try {
    await prisma.searchOutbox.upsert({
      where: { emailId },
      create: { emailId, status: "PENDING" },
      update: { status: "PENDING", updatedAt: new Date() },
    });
  } catch (error: any) {
    console.warn(`[SearchOutbox] Failed to mark ${emailId} as PENDING:`, error.message);
  }
}

// Mark search outbox entries as DISPATCHED in PostgreSQL
export async function markSearchOutboxDispatched(emailIds: string[]): Promise<void> {
  if (!emailIds || emailIds.length === 0) return;
  try {
    await prisma.searchOutbox.updateMany({
      where: { emailId: { in: emailIds } },
      data: { status: "DISPATCHED", updatedAt: new Date() },
    });
  } catch (error: any) {
    console.warn(`[SearchOutbox] Failed to mark ${emailIds.length} items as DISPATCHED:`, error.message);
  }
}

// Index single EmailJob record with external versioning and durable intent
export async function indexEmailJob(emailId: string): Promise<boolean> {
  // 1. Record durable intent in PostgreSQL first
  await markSearchOutboxPending(emailId);

  try {
    const email = await prisma.emailJob.findUnique({
      where: { id: emailId },
      include: { campaign: { select: { userId: true } } },
    });

    if (!email) {
      return false;
    }

    const doc = toElasticEmailDoc(email);
    const version = new Date(email.updatedAt).getTime();

    // Use external_gte versioning to prevent older indexing updates from overwriting newer DB state
    try {
      await esClient.index({
        index: ELASTICSEARCH_INDEX,
        id: email.id,
        document: doc,
        version,
        version_type: "external_gte",
      });
    } catch (indexError: any) {
      const statusCode = indexError.statusCode || indexError.meta?.statusCode;
      // HTTP 409 means Elasticsearch already has a newer or equal state; treat as satisfied
      if (statusCode !== 409) {
        throw indexError;
      }
    }

    // Mark as dispatched in PostgreSQL outbox and drain from Redis dirty queue
    await markSearchOutboxDispatched([email.id]);
    await redis.srem(REDIS_DIRTY_KEY, emailId).catch(() => {});
    return true;
  } catch (error: any) {
    console.warn(`[Elasticsearch] Indexing failed for ${emailId}: ${error.message}. Durable SearchOutbox will reconcile.`);
    await redis.sadd(REDIS_DIRTY_KEY, emailId).catch(() => {});
    return false;
  }
}

// Bulk index a batch of EmailJobs with external_gte versioning and durable intent
export async function indexEmailJobsBatch(emailIds: string[]): Promise<number> {
  if (!emailIds || emailIds.length === 0) return 0;

  try {
    const emails = await prisma.emailJob.findMany({
      where: { id: { in: emailIds } },
      include: { campaign: { select: { userId: true } } },
    });

    if (emails.length === 0) return 0;

    const operations = emails.flatMap((email) => [
      {
        index: {
          _index: ELASTICSEARCH_INDEX,
          _id: email.id,
          version: new Date(email.updatedAt).getTime(),
          version_type: "external_gte",
        },
      },
      toElasticEmailDoc(email),
    ]);

    const response = await esClient.bulk({ operations, refresh: false });
    const successfullyIndexedIds: string[] = [];
    const failedIds: string[] = [];

    response.items.forEach((item, index) => {
      const action = item.index;
      if (!action) return;

      const emailId = action._id || emails[index]?.id;
      // Success (200/201) or 409 version conflict (already at or ahead of this version)
      if (action.status < 400 || action.status === 409) {
        if (emailId) successfullyIndexedIds.push(emailId);
      } else {
        if (emailId) failedIds.push(emailId);
      }
    });

    if (successfullyIndexedIds.length > 0) {
      await markSearchOutboxDispatched(successfullyIndexedIds);
      await redis.srem(REDIS_DIRTY_KEY, ...successfullyIndexedIds).catch(() => {});
    }

    if (failedIds.length > 0) {
      await redis.sadd(REDIS_DIRTY_KEY, ...failedIds).catch(() => {});
    }

    return successfullyIndexedIds.length;
  } catch (error: any) {
    console.warn(`[Elasticsearch] Batch index error for ${emailIds.length} emails: ${error.message}. Durable SearchOutbox will reconcile.`);
    await redis.sadd(REDIS_DIRTY_KEY, ...emailIds).catch(() => {});
    return 0;
  }
}

// Reconcile durable SearchOutbox records and Redis dirty queue without cron
export async function reconcileElasticsearch(): Promise<{ syncedOutbox: number; syncedRedis: number; backfilled: number }> {
  let syncedOutbox = 0;
  let syncedRedis = 0;
  let backfilled = 0;

  try {
    const isAlive = await esClient.ping().catch(() => false);
    if (!isAlive) {
      console.warn("[Elasticsearch] Ping failed during reconciliation. Skipping until reachable.");
      return { syncedOutbox, syncedRedis, backfilled };
    }

    await initEmailIndex();

    // 1. Drain durable PostgreSQL SearchOutbox records (handles ES or Redis restarts)
    const pendingOutbox = await prisma.searchOutbox.findMany({
      where: { status: "PENDING" },
      take: 200,
      orderBy: { updatedAt: "asc" },
      select: { emailId: true },
    });

    if (pendingOutbox.length > 0) {
      const ids = pendingOutbox.map((o) => o.emailId);
      syncedOutbox = await indexEmailJobsBatch(ids);
      console.log(`[SearchOutbox Reconciler] Synced ${syncedOutbox}/${ids.length} pending durable outbox records.`);
    }

    // 2. Drain in-memory Redis dirty keys if any
    const dirtyIds = await redis.smembers(REDIS_DIRTY_KEY).catch(() => [] as string[]);
    if (dirtyIds.length > 0) {
      syncedRedis = await indexEmailJobsBatch(dirtyIds);
      if (syncedRedis > 0) {
        console.log(`[Elasticsearch Reconciler] Synced ${syncedRedis}/${dirtyIds.length} pending Redis dirty records.`);
      }
    }
  } catch (error: any) {
    console.error("[Elasticsearch Reconciler] Error during reconciliation:", error.message);
  }

  return { syncedOutbox, syncedRedis, backfilled };
}

// Bounded cursor-based backfill for existing records without relying on count equality
export async function backfillEmailsCursor(
  cursor?: string,
  limit = 200
): Promise<{ nextCursor: string | null; count: number }> {
  const batch = await prisma.emailJob.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: { id: "asc" },
    include: { campaign: { select: { userId: true } } },
  });

  if (batch.length === 0) {
    return { nextCursor: null, count: 0 };
  }

  await indexEmailJobsBatch(batch.map((e) => e.id));
  const nextCursor = batch.length === limit ? batch[batch.length - 1].id : null;
  return { nextCursor, count: batch.length };
}

// Full bounded cursor-based sweep across all EmailJobs
export async function backfillAllEmails(batchSize = 200): Promise<number> {
  let totalIndexed = 0;
  let cursor: string | undefined = undefined;

  try {
    await initEmailIndex();

    while (true) {
      const result = await backfillEmailsCursor(cursor, batchSize);
      totalIndexed += result.count;
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    await esClient.indices.refresh({ index: ELASTICSEARCH_INDEX });
    console.log(`[Elasticsearch Backfill] Cursor sweep completed: ${totalIndexed} emails synchronized with external_gte.`);
  } catch (error: any) {
    console.error("[Elasticsearch Backfill] Failed during backfill:", error.message);
  }

  return totalIndexed;
}
