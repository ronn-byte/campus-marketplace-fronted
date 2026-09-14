#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: Reset account password
 * 
 * Usage: npx tsx dev-reset-password.ts <email> <new_password>
 * 
 * SECURITY: Only works in development mode (NODE_ENV=development).
 * This bypasses the reset token mechanism and should NEVER exist in production.
 */

import { PrismaClient } from "@prisma/client";
import { env } from "./src/config/env.js";
import { hashPassword } from "./src/modules/auth/auth.utils.js";

if (env.NODE_ENV !== "development") {
  console.error("ERROR: This script only runs in development mode.");
  process.exitCode = 1;
  process.exit(1);
}

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: npx tsx dev-reset-password.ts <email> <new_password>");
  process.exitCode = 1;
  process.exit(1);
}

if (password.length < 12) {
  console.error("ERROR: Password must be at least 12 characters.");
  process.exitCode = 1;
  process.exit(1);
}

async function reset() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`ERROR: User not found: ${email}`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    console.log(`✓ Password reset for: ${email}`);
    console.log(`✓ Password length: ${password.length} characters`);
  } catch (error) {
    console.error("ERROR: Failed to reset password:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

reset();
