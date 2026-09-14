import { z } from "zod";

export const verificationIdParams = z.object({ id: z.string().uuid() }).strict();
export const verificationReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();
