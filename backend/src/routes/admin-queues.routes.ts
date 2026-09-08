import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "../queues/email.queue";
import { requireAuth, requireAdmin } from "../middlewares/auth.middleware";

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter,
  options: {
    uiConfig: {
      boardTitle: "Mail Scheduler Queues",
    },
  },
});

const router = Router();

// Protect dashboard, static assets, internal APIs, and administrative actions
router.use(requireAuth);
router.use(requireAdmin);
router.use("/", serverAdapter.getRouter());

export default router;
