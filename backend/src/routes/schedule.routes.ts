import { Router } from "express";
import { scheduleEmails } from "../controllers/schedule.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", requireAuth, scheduleEmails);

export default router;
