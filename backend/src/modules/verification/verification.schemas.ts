import { z } from "zod";

export const verificationIdParams = z.object({ id: z.string().uuid() }).strict();

export const submitVerificationSchema = z.object({
  method: z.enum(["UNIVERSITY_EMAIL", "MANUAL_STUDENT"]),
  registrationNumber: z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9/\-]+$/),
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().trim().email().max(320).optional(),
}).strict().refine((value) => {
  if (value.method !== "UNIVERSITY_EMAIL") return true;
  return Boolean(value.email);
}, {
  message: "A valid MUT student email is required for university email verification.",
  path: ["email"],
});

export const verificationReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();
