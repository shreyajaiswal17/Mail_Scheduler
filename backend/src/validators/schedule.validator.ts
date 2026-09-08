import { z } from "zod";

export const scheduleSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().trim().min(1).max(255),
  body: z.string().trim().min(1),
  recipients: z.array(z.email()).min(1).max(10000),
  startTime: z.iso.datetime({ offset: true }),
  delayMs: z.number().int().min(0),
  hourlyLimit: z.number().int().positive(),
  idempotencyKey: z.string().trim().min(1).max(255).optional(),
});

export type ScheduleInput = z.infer<typeof scheduleSchema>;
