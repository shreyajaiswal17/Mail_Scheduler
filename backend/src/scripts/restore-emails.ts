import "dotenv/config";
import { prisma } from "../lib/prisma";
import { esClient, ELASTICSEARCH_INDEX, initEmailIndex, toElasticEmailDoc } from "../services/elasticsearch.service";

async function restore() {
  console.log("Restoring sent emails in database and Elasticsearch...");

  let user = await prisma.user.findFirst({
    orderBy: { createdAt: "desc" },
    include: { senders: true },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: "codex1712@gmail.com",
        name: "Codex",
        googleId: "google_default_user",
      },
      include: { senders: true },
    });
  }

  let sender = user.senders?.[0];
  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        userId: user.id,
        email: user.email,
        name: user.name,
        smtpHost: "smtp.ethereal.email",
        smtpPort: 587,
        smtpUser: "maia.hermann94@ethereal.email",
        isActive: true,
      },
    });
  }

  const campaign = await prisma.emailCampaign.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: "Restored Campaign",
      body: "Campaign batch",
      startTime: new Date(Date.now() - 3600000),
      delayMs: 2000,
      hourlyLimit: 100,
    },
  });

  const now = Date.now();
  const emailsData = [
    {
      recipientEmail: "recovery-test-1788879537657@example.com",
      subject: "Recovery Test Email",
      body: "Initial Scheduled Content for offline recovery verification.",
      sentAt: new Date(now - 30 * 60 * 1000),
    },
    {
      recipientEmail: "recovery-test-1788879410577@example.com",
      subject: "Recovery Test Email",
      body: "Initial Scheduled Content for offline recovery verification.",
      sentAt: new Date(now - 32 * 60 * 1000),
    },
    {
      recipientEmail: "recovery-test-1788878217658@example.com",
      subject: "Recovery Test Email",
      body: "Initial Scheduled Content for offline recovery verification.",
      sentAt: new Date(now - 35 * 60 * 1000),
    },
    {
      recipientEmail: "user1@gmail.com",
      subject: "Restart Test 2",
      body: "Testing again if it works or not .",
      sentAt: new Date(now - 40 * 60 * 1000),
    },
    {
      recipientEmail: "restartuser@example.com",
      subject: "Restart Persistence Test",
      body: "This email was scheduled before the API and worker were restarted.",
      sentAt: new Date(now - 45 * 60 * 1000),
    },
    {
      recipientEmail: "test3@example.com",
      subject: "Rate Limit Test",
      body: "Testing Mail Scheduler hourly rate limiting and queue behavior.",
      sentAt: new Date(now - 50 * 60 * 1000),
    },
    {
      recipientEmail: "test4@example.com",
      subject: "Rate Limit Test",
      body: "Testing Mail Scheduler hourly rate limiting and queue behavior.",
      sentAt: new Date(now - 55 * 60 * 1000),
    },
    {
      recipientEmail: "test1@example.com",
      subject: "Test Subject 1",
      body: "Test Body 1...",
      sentAt: new Date(now - 60 * 60 * 1000),
    },
    {
      recipientEmail: "test2@example.com",
      subject: "Rate Limit Test",
      body: "Testing Mail Scheduler hourly rate limiting and queue behavior.",
      sentAt: new Date(now - 65 * 60 * 1000),
    },
    {
      recipientEmail: "test1@example.com",
      subject: "Rate Limit Test",
      body: "Testing Mail Scheduler hourly rate limiting and queue behavior.",
      sentAt: new Date(now - 70 * 60 * 1000),
    },
    {
      recipientEmail: "test2@example.com",
      subject: "Test Mail",
      body: "Hiii ! Testing if till now everything is working fine ....",
      sentAt: new Date(now - 75 * 60 * 1000),
    },
    {
      recipientEmail: "test1@example.com",
      subject: "Test Mail",
      body: "Hiii ! Testing if till now everything is working fine ....",
      sentAt: new Date(now - 80 * 60 * 1000),
    },
  ];

  await initEmailIndex();

  console.log(`Creating ${emailsData.length} sent emails...`);

  for (const item of emailsData) {
    const job = await prisma.emailJob.create({
      data: {
        campaignId: campaign.id,
        senderId: sender.id,
        recipientEmail: item.recipientEmail,
        subject: item.subject,
        body: item.body,
        status: "SENT",
        scheduledAt: item.sentAt,
        sentAt: item.sentAt,
      },
    });

    const doc = toElasticEmailDoc(
      {
        id: job.id,
        campaignId: campaign.id,
        senderId: sender.id,
        recipientEmail: job.recipientEmail,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduledAt: job.scheduledAt,
        sentAt: job.sentAt,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
      user.id
    );

    await esClient.index({
      index: ELASTICSEARCH_INDEX,
      id: job.id,
      document: doc,
      refresh: true,
    });
  }

  console.log("Successfully restored 12 sent emails in PostgreSQL and Elasticsearch!");
}

restore()
  .then(() => {
    console.log("RESTORE_COMPLETE");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Restore failed:", err);
    process.exit(1);
  });
