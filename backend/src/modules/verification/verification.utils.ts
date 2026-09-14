import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../app/errors.js";

function encryptionKey(): Buffer {
  const value = env.STUDENT_DATA_ENCRYPTION_KEY;
  if (!value) throw new AppError(503, "VERIFICATION_STORAGE_UNAVAILABLE", "Student verification is temporarily unavailable.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new AppError(503, "VERIFICATION_STORAGE_UNAVAILABLE", "Student verification is temporarily unavailable.");
  return key;
}

export function normalizeRegistrationNumber(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function registrationNumberHash(value: string): string {
  return createHash("sha256").update(normalizeRegistrationNumber(value)).digest("hex");
}

export function encryptRegistrationNumber(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalizeRegistrationNumber(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptRegistrationNumber(value: string): string {
  const [ivValue, tagValue, encryptedValue] = value.split(".");
  if (!ivValue || !tagValue || !encryptedValue) throw new AppError(500, "VERIFICATION_DATA_INVALID", "Verification data could not be read.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}
