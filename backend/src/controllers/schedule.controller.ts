import { Response } from "express";
import crypto from "crypto";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";
import { scheduleSchema } from "../validators/schedule.validator";
import {
  dispatchOutboxBatch,
  reconcileDatabaseToQueue,
} from "../services/outbox-reconciler.service";
import { indexEmailJobsBatch } from "../services/elasticsearch.service";

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

    const headerKey =
      (req.headers["idempotency-key"] as string) ||
      (req.headers["x-idempotency-key"] as string);
    const idempotencyKey =
      (headerKey || parsed.data.idempotencyKey || "").trim() || null;

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
    ].sort();

    const start = new Date(startTime);

    const canonicalPayload = JSON.stringify({
      senderId,
      subject,
      body,
      startTime: start.toISOString(),
      delayMs,
      hourlyLimit,
      recipients: uniqueRecipients,
    });
    const payloadHash = crypto
      .createHash("sha256")
      .update(canonicalPayload)
      .digest("hex");

    if (idempotencyKey) {
      const existingCampaign = await prisma.emailCampaign.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey,
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
            orderBy: { scheduledAt: "asc" },
          },
        },
      });

      if (existingCampaign) {
        const isMatch =
          existingCampaign.payloadHash === payloadHash ||
          (existingCampaign.senderId === senderId &&
            existingCampaign.subject === subject &&
            existingCampaign.body === body &&
            existingCampaign.delayMs === delayMs &&
            existingCampaign.hourlyLimit === hourlyLimit &&
            Math.abs(existingCampaign.startTime.getTime() - start.getTime()) < 1000);

        if (!isMatch) {
          res.status(409).json({
            message:
              "Idempotency key conflict: This key was previously used with a different request payload",
          });
          return;
        }

        await dispatchOutboxBatch();

        res.status(200).json({
          message: "Emails scheduled successfully",
          campaignId: existingCampaign.id,
          totalEmails: existingCampaign.emails.length,
          emails: existingCampaign.emails,
          idempotent: true,
        });
        return;
      }
    }

    const campaign = await prisma.$transaction(async (tx) => {
      const newCampaign = await tx.emailCampaign.create({
        data: {
          userId,
          senderId,
          idempotencyKey,
          payloadHash,
          subject,
          body,
          startTime: start,
          delayMs,
          hourlyLimit,
          emails: {
            create: uniqueRecipients.map((recipientEmail, index) => {
              const scheduledAt = new Date(start.getTime() + index * delayMs);
              return {
                senderId,
                recipientEmail,
                subject,
                body,
                scheduledAt,
                nextEligibleAt: scheduledAt,
                status: "SCHEDULED",
              };
            }),
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
            orderBy: { scheduledAt: "asc" },
          },
        },
      });

      await tx.outboxEvent.createMany({
        data: newCampaign.emails.map((email) => ({
          eventType: "SEND_EMAIL",
          jobId: email.id,
          payload: {
            emailId: email.id,
            campaignId: newCampaign.id,
          },
          status: "PENDING",
        })),
      });

      await tx.searchOutbox.createMany({
        data: newCampaign.emails.map((email) => ({
          emailId: email.id,
          status: "PENDING",
        })),
        skipDuplicates: true,
      });

      return newCampaign;
    });

    await dispatchOutboxBatch();

    indexEmailJobsBatch(campaign.emails.map((e) => e.id)).catch((err) =>
      console.warn("[Schedule Controller] Non-blocking ES indexing error:", err.message)
    );

    reconcileDatabaseToQueue().catch((err) =>
      console.error("[Schedule Controller] Background reconciliation error:", err)
    );

    res.status(201).json({
      message: "Emails scheduled successfully",
      campaignId: campaign.id,
      totalEmails: campaign.emails.length,
      emails: campaign.emails,
    });
  } catch (error: any) {
    if (
      error.code === "P2002" &&
      req.user?.id &&
      (req.headers["idempotency-key"] || req.body?.idempotencyKey)
    ) {
      try {
        const idempotencyKey = (
          (req.headers["idempotency-key"] as string) ||
          (req.headers["x-idempotency-key"] as string) ||
          req.body.idempotencyKey ||
          ""
        ).trim();

        const existing = await prisma.emailCampaign.findUnique({
          where: {
            userId_idempotencyKey: {
              userId: req.user.id,
              idempotencyKey,
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

        if (existing) {
          res.status(200).json({
            message: "Emails scheduled successfully",
            campaignId: existing.id,
            totalEmails: existing.emails.length,
            emails: existing.emails,
            idempotent: true,
          });
          return;
        }
      } catch (innerErr) {
        console.error("Failed to resolve concurrent idempotency race:", innerErr);
      }
    }

    console.error("Failed to schedule emails:", error);

    res.status(500).json({
      message: "Unable to schedule emails",
    });
  }
};
