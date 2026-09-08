import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export interface EmailJobData {
  emailId: string;
}

export const emailQueue = new Queue<EmailJobData>("email-sending", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});
