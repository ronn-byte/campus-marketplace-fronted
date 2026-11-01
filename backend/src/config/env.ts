import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(5000),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  CORS_ORIGIN: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1).default("cm_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 30).default(24 * 30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  EMAIL_PROVIDER: z.enum(["smtp", "resend"]).default("resend"),
  RESEND_API_KEY: z.string().min(1).optional(),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  SMTP_SECURE: z.enum(["true", "false"]).optional(),
  SMTP_USER: z.string().email().optional(),
  SMTP_PASS: z.string().min(1).optional(),
  EMAIL_FROM: z.string().email(),
  APP_URL: z.string().url(),
  UPLOAD_ROOT: z.string().min(1).default("uploads"),
  UPLOAD_BASE_URL: z.string().url().optional(),
  STUDENT_DATA_ENCRYPTION_KEY: z.string().base64().optional(),
}).superRefine((value, context) => {
  if (value.EMAIL_PROVIDER === "resend" && !value.RESEND_API_KEY) {
    context.addIssue({
      code: "custom",
      path: ["RESEND_API_KEY"],
      message: "is required when EMAIL_PROVIDER is resend",
    });
  }

  if (value.EMAIL_PROVIDER === "smtp") {
    const smtpRequirements: Array<[keyof typeof value, unknown]> = [
      ["SMTP_HOST", value.SMTP_HOST],
      ["SMTP_PORT", value.SMTP_PORT],
      ["SMTP_SECURE", value.SMTP_SECURE],
      ["SMTP_USER", value.SMTP_USER],
      ["SMTP_PASS", value.SMTP_PASS],
    ];

    for (const [field, fieldValue] of smtpRequirements) {
      if (fieldValue === undefined) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `is required when EMAIL_PROVIDER is smtp`,
        });
      }
    }

    if (
      value.SMTP_USER &&
      value.EMAIL_FROM &&
      value.SMTP_USER.toLowerCase() !== value.EMAIL_FROM.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["EMAIL_FROM"],
        message: "must match SMTP_USER for Gmail SMTP",
      });
    }
  }

  if (value.NODE_ENV !== "production") return;

  const key = value.STUDENT_DATA_ENCRYPTION_KEY;
  if (!key) {
    context.addIssue({
      code: "custom",
      path: ["STUDENT_DATA_ENCRYPTION_KEY"],
      message: "is required in production",
    });
    return;
  }

  if (Buffer.from(key, "base64").length !== 32) {
    context.addIssue({
      code: "custom",
      path: ["STUDENT_DATA_ENCRYPTION_KEY"],
      message: "must decode to exactly 32 bytes in production",
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid backend environment configuration: ${details}`);
}

export const env = parsed.data;
