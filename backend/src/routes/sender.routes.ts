import { Router } from "express";
import { addSender, getSenders } from "../controllers/sender.controller";
import { requireAuth } from "../middlewares/auth.middleware";

const router = Router();

router.post("/", requireAuth, addSender);
router.get("/", requireAuth, getSenders);

export default router;
