#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: Bootstrap a moderator account
 * 
 * Usage: npx tsx dev-bootstrap-moderator.ts <email> <password>
 * 
 * Example:
 *   npx tsx dev-bootstrap-moderator.ts moderator@example.com "secure-password-min-12-chars"
 * 
 * Only works in development environment (NODE_ENV=development).
 * This is a manual setup tool, not a production feature.
 */

import { PrismaClient } from "@prisma/client";
import { env } from "./src/config/env.js";
import { hashPassword } from "./src/modules/auth/auth.utils.js";

if (env.NODE_ENV !== "development") {
  console.error("ERROR: This script only runs in development mode.");
  console.error(`Current NODE_ENV: ${env.NODE_ENV}`);
  process.exitCode = 1;
  process.exit(1);
}

const [email, password] = process.argv.slice(2);

if (!email || !password) {
  console.error("Usage: npx tsx dev-bootstrap-moderator.ts <email> <password>");
  console.error("Both email and password are required.");
  process.exitCode = 1;
  process.exit(1);
}

if (password.length < 12) {
  console.error("ERROR: Password must be at least 12 characters.");
  process.exitCode = 1;
  process.exit(1);
}

async function bootstrap() {
  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.error(`ERROR: Account with email "${email}" already exists.`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    const moderator = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: "MODERATOR",
        accountStatus: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
      select: { id: true, email: true, role: true, accountStatus: true },
    });

    console.log("✓ Moderator account created successfully");
    console.log(`  Email: ${moderator.email}`);
    console.log(`  Role: ${moderator.role}`);
    console.log(`  Account Status: ${moderator.accountStatus}`);
    console.log("");
    console.log("This account can now review student verifications via:");
    console.log("  GET  /api/v1/moderation/verifications");
    console.log("  POST /api/v1/moderation/verifications/:id/review");
  } catch (error) {
    console.error("ERROR: Failed to create moderator account:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

bootstrap();
