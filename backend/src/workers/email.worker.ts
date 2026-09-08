import "dotenv/config";
import { Worker } from "bullmq";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { redis } from "../lib/redis";
import { decryptPassword } from "../lib/encryption";

const concurrency = Number(process.env.WORKER_CONCURRENCY || 5);

const worker = new Worker(
  "email-sending",
  async (job) => {
    const email = await prisma.emailJob.findUnique({
      where: { id: job.data.emailId },
      include: { sender: true },
    });

    if (!email) {
      throw new Error("Email record not found");
    }

    if (email.status === "SENT") {
      return { message: "Email already sent" };
    }

    const sender = email.sender;

    if (
      !sender.isActive ||
      !sender.smtpHost ||
      !sender.smtpPort ||
      !sender.smtpUser ||
      !sender.smtpPasswordEnc
    ) {
      throw new Error("Sender SMTP configuration is incomplete");
    }

    await prisma.emailJob.update({
      where: { id: email.id },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
      },
    });

    try {
      const transporter = nodemailer.createTransport({
        host: sender.smtpHost,
        port: sender.smtpPort,
        secure: sender.smtpPort === 465,
        auth: {
          user: sender.smtpUser,
          pass: decryptPassword(sender.smtpPasswordEnc),
        },
      });

      const info = await transporter.sendMail({
        from: sender.email,
        to: email.recipientEmail,
        subject: email.subject,
        text: email.body,
      });

      await prisma.emailJob.update({
        where: { id: email.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          messageId: info.messageId,
          errorMessage: null,
        },
      });

      console.log(`Email sent: ${email.recipientEmail}`);

      return {
        messageId: info.messageId,
        previewUrl: nodemailer.getTestMessageUrl(info),
      };
    } catch (error) {
      await prisma.emailJob.update({
        where: { id: email.id },
        data: {
          status: "FAILED",
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        },
      });

      throw error;
    }
  },
  {
    connection: redis,
    concurrency,
  }
);

worker.on("completed", (job) => {
  console.log(`Job ${job.id} completed`);
});

worker.on("failed", (job, error) => {
  console.error(`Job ${job?.id} failed:`, error.message);
});

console.log(`Email worker started with concurrency ${concurrency}`);
