import { Router } from "express";
import { requireAuth } from "../middlewares/auth.middleware";
import { searchEmailsController } from "../controllers/email-search.controller";

const router = Router();

router.get("/", requireAuth, searchEmailsController);
router.get("/search", requireAuth, searchEmailsController);

export default router;
