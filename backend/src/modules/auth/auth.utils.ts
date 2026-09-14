import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function addHours(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

export function addMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60 * 1000);
}
