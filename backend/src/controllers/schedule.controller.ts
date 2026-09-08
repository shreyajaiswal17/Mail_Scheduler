import { Response } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { scheduleSchema } from "../validators/schedule.validator";
import { emailQueue } from "../queues/email.queue";

export const scheduleEmails = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const parsed = scheduleSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        message: "Invalid scheduling request",
        errors: parsed.error.flatten(),
      });
      return;
    }

    const {
      senderId,
      subject,
      body,
      recipients,
      startTime,
      delayMs,
      hourlyLimit,
    } = parsed.data;

    const sender = await prisma.sender.findFirst({
      where: {
        id: senderId,
        userId,
        isActive: true,
      },
    });

    if (!sender || !sender.smtpPasswordEnc) {
      res.status(400).json({
        message: "Select a configured SMTP sender",
      });
      return;
    }

    const uniqueRecipients = [
      ...new Set(recipients.map((email) => email.trim().toLowerCase())),
    ];

    const start = new Date(startTime);

    const campaign = await prisma.emailCampaign.create({
      data: {
        userId,
        senderId,
        subject,
        body,
        startTime: start,
        delayMs,
        hourlyLimit,
        emails: {
          create: uniqueRecipients.map((recipientEmail, index) => ({
            senderId,
            recipientEmail,
            subject,
            body,
            scheduledAt: new Date(start.getTime() + index * delayMs),
            status: "SCHEDULED",
          })),
        },
      },
      include: {
        emails: {
          select: {
            id: true,
            recipientEmail: true,
            scheduledAt: true,
            status: true,
          },
        },
      },
    });

    await emailQueue.addBulk(
      campaign.emails.map((email) => ({
        name: "send-email",
        data: {
          emailId: email.id,
        },
        opts: {
          jobId: email.id,
          delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
        },
      }))
    );

    res.status(201).json({
      message: "Emails scheduled successfully",
      campaignId: campaign.id,
      totalEmails: campaign.emails.length,
      emails: campaign.emails,
    });
  } catch (error) {
    console.error("Failed to schedule emails:", error);

    res.status(500).json({
      message: "Unable to schedule emails",
    });
  }
};
