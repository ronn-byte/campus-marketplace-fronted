import { z } from "zod";

const normalizeOptionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .optional()
    .transform((value) => {
      if (typeof value !== "string") return value;
      return value.length > 0 ? value : undefined;
    });

const phoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s()-]{7,20}$/)
  .optional()
  .transform((value) => {
    if (typeof value !== "string") return value;
    const normalized = value.replace(/[\s()-]/g, "").replace(/^\+/, "");
    return normalized.length >= 7 && normalized.length <= 15 ? `+${normalized}` : value;
  });

export const profileUpdateSchema = z
  .object({
    nickname: normalizeOptionalText(60),
    phoneNumber: phoneNumberSchema,
    yearOfStudy: z.coerce.number().int().min(1).max(12).optional(),
    course: normalizeOptionalText(120),
    bio: normalizeOptionalText(500),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field must be provided.",
  });

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
