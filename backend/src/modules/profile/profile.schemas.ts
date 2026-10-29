import { z } from "zod";

const normalizeOptionalText = (maxLength: number) =>
  z.union([z.string().trim().max(maxLength), z.null()]).optional().transform((value) =>
    typeof value === "string" ? (value.length > 0 ? value : null) : value,
  );

const normalizePhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return value;
  if (value.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length === 10) return `+254${digits.slice(1)}`;
  return `+${digits}`;
};

const phoneNumberSchema = z.union([
  z.literal(""),
  z.string().trim().regex(/^\+?[0-9\s()-]{7,20}$/)
    .refine((value) => value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15)
    .transform(normalizePhone),
  z.null(),
]).optional().transform((value) => value === "" ? null : value);

const whatsappNumberSchema = phoneNumberSchema;

export const profileUpdateSchema = z
  .object({
    nickname: normalizeOptionalText(60),
    phoneNumber: phoneNumberSchema,
    whatsappNumber: whatsappNumberSchema,
    yearOfStudy: z.coerce.number().int().min(1).max(12).optional(),
    course: normalizeOptionalText(120),
    bio: normalizeOptionalText(500),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one profile field must be provided.",
  });

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
