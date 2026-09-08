import { z } from "zod";

export const searchEmailQuerySchema = z.object({
  q: z.string().trim().max(500).optional(),
  query: z.string().trim().max(500).optional(),
  status: z
    .enum(["SCHEDULED", "PROCESSING", "SENT", "FAILED", "RATE_LIMITED", "NEEDS_REVIEW"])
    .optional(),
  senderId: z.string().uuid().optional(),
  sender: z.string().trim().optional(),
  startDate: z.string().datetime().optional(),
  from: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  dateField: z.enum(["scheduledAt", "sentAt", "createdAt"]).default("scheduledAt"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["scheduledAt", "sentAt", "createdAt"]).default("scheduledAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export type SearchEmailQueryInput = z.input<typeof searchEmailQuerySchema>;
export type SearchEmailQueryParsed = z.output<typeof searchEmailQuerySchema>;

export interface SafeEmailResult {
  id: string;
  campaignId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  nextEligibleAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailSearchResponse {
  emails: SafeEmailResult[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
