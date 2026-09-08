import { Response } from "express";
import nodemailer from "nodemailer";
import { prisma } from "../lib/prisma";
import { encryptPassword } from "../lib/encryption";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

export const addSender = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const { email, name, smtpHost, smtpPort, smtpUser, smtpPassword } = req.body;

    if (!email || !smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      res.status(400).json({ message: "All SMTP fields are required" });
      return;
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: Number(smtpPort),
      secure: Number(smtpPort) === 465,
      auth: {
        user: smtpUser,
        pass: smtpPassword,
      },
    });

    await transporter.verify();

    const sender = await prisma.sender.upsert({
      where: {
        userId_email: {
          userId,
          email,
        },
      },
      update: {
        name,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        smtpPasswordEnc: encryptPassword(smtpPassword),
        isActive: true,
      },
      create: {
        userId,
        email,
        name,
        smtpHost,
        smtpPort: Number(smtpPort),
        smtpUser,
        smtpPasswordEnc: encryptPassword(smtpPassword),
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        isActive: true,
        createdAt: true,
      },
    });

    res.status(201).json({
      message: "Sender configured successfully",
      sender,
    });
  } catch (error) {
    console.error("Failed to add sender:", error);

    res.status(500).json({
      message: "Unable to configure sender. Check your SMTP credentials.",
    });
  }
};

export const getSenders = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const senders = await prisma.sender.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        name: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ senders });
  } catch (error) {
    console.error("Failed to fetch senders:", error);

    res.status(500).json({
      message: "Unable to fetch senders",
    });
  }
};