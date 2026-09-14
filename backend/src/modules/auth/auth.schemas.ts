import { z } from "zod";
import { VerificationMethod } from "@prisma/client";

const email = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const password = z.string().min(12).max(128);
const verificationMethod = z.nativeEnum(VerificationMethod);
const registrationNumber = z.string().trim().min(4).max(40).regex(/^[A-Za-z0-9/-]+$/, "Registration number format is invalid.");

export const registerSchema = z.object({
  email,
  password,
  displayName: z.string().trim().min(1).max(80),
  verificationMethod,
  registrationNumber: registrationNumber.optional(),
}).strict().superRefine((value, context) => {
  if (value.verificationMethod === "MANUAL_STUDENT" && !value.registrationNumber) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["registrationNumber"], message: "Registration number is required for student verification." });
  }
});

export const loginSchema = z.object({
  email: email.optional(),
  identifier: email.optional(),
  password: z.string().min(1).max(128),
}).strict().refine((value) => Boolean(value.email || value.identifier), {
  message: "Email is required.",
  path: ["email"],
});

export const tokenSchema = z.object({ token: z.string().min(32).max(256) }).strict();
export const forgotPasswordSchema = z.object({ email }).strict();
export const resetPasswordSchema = z.object({ token: z.string().min(32).max(256), password }).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: password }).strict();
export const verificationReviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reason: z.string().trim().min(1).max(1000),
}).strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerificationMethodInput = z.infer<typeof verificationMethod>;
