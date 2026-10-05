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
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email(),
  APP_URL: z.string().url(),
  UPLOAD_ROOT: z.string().min(1).default("uploads"),
  UPLOAD_BASE_URL: z.string().url().optional(),
  STUDENT_DATA_ENCRYPTION_KEY: z.string().base64().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  throw new Error(`Invalid backend environment configuration: ${details}`);
}

export const env = parsed.data;
