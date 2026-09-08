import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import {
  initiateSlackOAuth,
  handleSlackCallback,
  getSlackStatus,
  disconnectSlackController,
  getSlackChannelsController,
  setSlackChannelController,
  sendSlackTestNotificationController,
} from "../controllers/slack.controller";

const router = Router();

router.get("/connect", requireAuth, initiateSlackOAuth);
router.get("/callback", handleSlackCallback);
router.get("/status", requireAuth, getSlackStatus);
router.get("/channels", requireAuth, getSlackChannelsController);
router.post("/channel", requireAuth, setSlackChannelController);
router.post("/test-notification", requireAuth, sendSlackTestNotificationController);
router.post("/disconnect", requireAuth, disconnectSlackController);
router.delete("/disconnect", requireAuth, disconnectSlackController);

export default router;

