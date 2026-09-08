import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma";

export interface AuthenticatedUser {
  id: string;
  googleId: string;
  email: string;
  name: string;
  avatar?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

const JWT_SECRET = process.env.JWT_SECRET || "mail_scheduler_jwt_secret_change_in_production";

export const requireAuth = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // 1. Check Authorization header
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.split(" ")[1];
    }

    // 2. Fallback to cookie
    if (!token && req.cookies && req.cookies.token) {
      token = req.cookies.token;
    }

    if (!token) {
      res.status(401).json({
        error: "Unauthorized",
        message: "No authentication token provided",
      });
      return;
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET) as {
      userId: string;
      email: string;
    };

    if (!decoded || !decoded.userId) {
      res.status(401).json({
        error: "Unauthorized",
        message: "Invalid token payload",
      });
      return;
    }

    // Lookup user in database
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        googleId: true,
        email: true,
        name: true,
        avatar: true,
      },
    });

    if (!user) {
      res.status(401).json({
        error: "Unauthorized",
        message: "User account not found",
      });
      return;
    }

    req.user = user;
    next();
  } catch (error: any) {
    console.error("Auth Middleware Error:", error?.message || error);
    res.status(401).json({
      error: "Unauthorized",
      message: "Token is invalid or expired",
    });
  }
};
