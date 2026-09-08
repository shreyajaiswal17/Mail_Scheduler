import { Router } from "express";
import {
  initiateGoogleAuth,
  handleGoogleCallback,
  getCurrentUser,
  logout,
  emailLogin,
} from "../controllers/auth.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

// 1. Google OAuth entrypoint
router.get("/google", initiateGoogleAuth);

// 2. Google OAuth callback endpoint
router.get("/google/callback", handleGoogleCallback);

// 3. Email/password login endpoint
router.post("/login", emailLogin);

// 4. Authenticated session check
router.get("/me", requireAuth, getCurrentUser);

// 5. Logout endpoint
router.post("/logout", logout);

export default router;
