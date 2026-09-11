import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getOAuth2Client, getGoogleClientId } from "../config/google";
import { getJwtSecret } from "../config/jwt";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../middlewares/auth.middleware";

const FRONTEND_URL = (
  process.env.FRONTEND_URL && process.env.FRONTEND_URL.trim() !== ""
    ? process.env.FRONTEND_URL.trim().replace(/\/+$/, "")
    : process.env.NODE_ENV === "production" || process.env.RENDER
      ? "https://mail-scheduler-wheat.vercel.app"
      : "http://localhost:5173"
);

export const initiateGoogleAuth = (req: Request, res: Response): void => {
  try {
    const oauth2Client = getOAuth2Client();

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      res.redirect(
        `${FRONTEND_URL}?error=${encodeURIComponent(
          "Google OAuth credentials missing: Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env"
        )}`
      );
      return;
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
        "openid",
      ],
    });

    res.redirect(authUrl);
  } catch (error: any) {
    console.error("Error generating Google Auth URL:", error);
    res.status(500).json({ error: "Failed to initiate Google authentication" });
  }
};

export const handleGoogleCallback = async (req: Request, res: Response): Promise<void> => {
  const { code, error } = req.query;

  if (error) {
    console.error("Google OAuth error response:", error);
    res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent(String(error))}`);
    return;
  }

  if (!code || typeof code !== "string") {
    res.redirect(`${FRONTEND_URL}?error=${encodeURIComponent("Authorization code missing")}`);
    return;
  }

  try {
    const oauth2Client = getOAuth2Client();

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    if (!tokens.id_token) {
      throw new Error("No ID token returned from Google");
    }

    const ticket = await oauth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: getGoogleClientId(),
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.sub || !payload.email) {
      throw new Error("Failed to extract valid user profile from Google token");
    }

    const googleId = payload.sub;
    const email = payload.email;
    const name = payload.name || email.split("@")[0];
    const avatar = payload.picture || null;

    const user = await prisma.user.upsert({
      where: { googleId },
      update: {
        name,
        avatar,
        email,
      },
      create: {
        googleId,
        name,
        email,
        avatar,
      },
    });

    await prisma.sender.upsert({
      where: {
        userId_email: {
          userId: user.id,
          email: user.email,
        },
      },
      update: {
        name: user.name,
        isActive: true,
      },
      create: {
        userId: user.id,
        email: user.email,
        name: user.name,
        isActive: true,
      },
    });

    const sessionToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", sessionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.redirect(`${FRONTEND_URL}/dashboard?token=${encodeURIComponent(sessionToken)}`);
  } catch (err: any) {
    console.error("Google Auth Callback Failed:", err?.message || err);
    res.redirect(
      `${FRONTEND_URL}?error=${encodeURIComponent(err?.message || "Authentication failed")}`
    );
  }
};

export const getCurrentUser = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    res.status(200).json({
      status: "ok",
      user: req.user,
    });
  } catch (error: any) {
    console.error("getCurrentUser error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const logout = (req: Request, res: Response): void => {
  const isProduction = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  });

  res.status(200).json({
    status: "ok",
    message: "Logged out successfully",
  });
};

export const emailLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      res.status(400).json({ error: "Please enter a valid email address" });
      return;
    }

    if (!password || typeof password !== "string" || password.length < 1) {
      res.status(400).json({ error: "Please enter your password" });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const name = cleanEmail.split("@")[0];

    let user = await prisma.user.findUnique({
      where: { email: cleanEmail },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: cleanEmail,
          name: name.charAt(0).toUpperCase() + name.slice(1),
          googleId: `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
      });

      await prisma.sender.upsert({
        where: {
          userId_email: {
            userId: user.id,
            email: user.email,
          },
        },
        update: { isActive: true },
        create: {
          userId: user.id,
          email: user.email,
          name: user.name,
          isActive: true,
        },
      });
    }

    const sessionToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
      },
      getJwtSecret(),
      { expiresIn: "7d" }
    );

    const isProduction = process.env.NODE_ENV === "production";

    res.cookie("token", sessionToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      status: "ok",
      token: sessionToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
      },
    });
  } catch (err: any) {
    console.error("Email login failed:", err?.message || err);
    res.status(500).json({ error: "Login failed. Please try again." });
  }
};
