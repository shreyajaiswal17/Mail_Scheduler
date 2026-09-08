import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  initiateSlackOAuth,
  handleSlackCallback,
  getSlackStatus,
  disconnectSlackController,
} from "../controllers/slack.controller";

const router = Router();

router.get("/connect", requireAuth, initiateSlackOAuth);
router.get("/callback", handleSlackCallback);
router.get("/status", requireAuth, getSlackStatus);
router.post("/disconnect", requireAuth, disconnectSlackController);
router.delete("/disconnect", requireAuth, disconnectSlackController);

export default router;
