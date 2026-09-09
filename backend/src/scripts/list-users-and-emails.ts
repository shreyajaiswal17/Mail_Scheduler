import "dotenv/config";
import { prisma } from "../lib/prisma";
import { esClient, ELASTICSEARCH_INDEX } from "../services/elasticsearch.service";

async function main() {
  const users = await prisma.user.findMany({
    include: {
      senders: true,
      campaigns: {
        include: {
          emails: true,
        },
      },
    },
  });

  console.log(`Found ${users.length} users in DB:`);
  for (const u of users) {
    console.log(`User ID: ${u.id} | Email: ${u.email} | GoogleId: ${u.googleId}`);
    console.log(`  Senders: ${u.senders.length}`);
    const emailCount = u.campaigns.reduce((acc, c) => acc + c.emails.length, 0);
    console.log(`  Emails in DB: ${emailCount}`);
  }

  const esResult = await esClient.search({
    index: ELASTICSEARCH_INDEX,
    size: 20,
    query: { match_all: {} },
  });

  console.log(`Elasticsearch total hits: ${typeof esResult.hits.total === "number" ? esResult.hits.total : esResult.hits.total?.value}`);
  if (esResult.hits.hits.length > 0) {
    console.log("Sample ES doc userId:", (esResult.hits.hits[0]._source as any)?.userId);
    console.log("Sample ES doc status:", (esResult.hits.hits[0]._source as any)?.status);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
