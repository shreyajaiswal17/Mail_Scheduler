import "dotenv/config";
import { prisma } from "../lib/prisma";
import { esClient, ELASTICSEARCH_INDEX, toElasticEmailDoc } from "../services/elasticsearch.service";

async function main() {
  const targetUser = await prisma.user.findUnique({
    where: { email: "codex1712@gmail.com" },
    include: { senders: true },
  });

  if (!targetUser) {
    throw new Error("Target user codex1712@gmail.com not found!");
  }

  console.log("Target user found:", targetUser.id, targetUser.email);

  let sender = targetUser.senders.find((s) => s.isActive) || targetUser.senders[0];
  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        userId: targetUser.id,
        email: targetUser.email,
        name: targetUser.name,
        smtpHost: "smtp.ethereal.email",
        smtpPort: 587,
        smtpUser: "maia.hermann94@ethereal.email",
        isActive: true,
      },
    });
  }

  await prisma.emailCampaign.updateMany({
    data: {
      userId: targetUser.id,
      senderId: sender.id,
    },
  });

  await prisma.emailJob.updateMany({
    data: {
      senderId: sender.id,
      status: "SENT",
    },
  });

  const jobs = await prisma.emailJob.findMany({
    include: { campaign: true },
  });

  console.log(`Re-indexing ${jobs.length} emails in Elasticsearch for user ${targetUser.email}...`);

  for (const job of jobs) {
    const doc = toElasticEmailDoc(job, targetUser.id);
    await esClient.index({
      index: ELASTICSEARCH_INDEX,
      id: job.id,
      document: doc,
      refresh: true,
    });
  }

  console.log("Successfully assigned all sent emails to codex1712@gmail.com and updated Elasticsearch!");
}

main()
  .then(() => {
    console.log("COMPLETE");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
