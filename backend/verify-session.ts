#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: Verify session state for a test account
 * 
 * Usage: npx tsx verify-session.ts
 * 
 * Inspects sessions for ronnykiprop05@gmail.com (test account).
 */

import { PrismaClient } from "@prisma/client";
import { env } from "./src/config/env.js";

if (env.NODE_ENV !== "development") {
  console.error("ERROR: This script only runs in development mode.");
  process.exitCode = 1;
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  const sessions = await prisma.session.findMany({
    where: { user: { email: "ronnykiprop05@gmail.com" } },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  console.log("Sessions for ronnykiprop05@gmail.com:");
  sessions.forEach((s) => {
    const isActive = !s.revokedAt && s.expiresAt > new Date();
    console.log("  Status:", isActive ? "ACTIVE" : "INACTIVE");
    console.log("  Created:", s.createdAt.toISOString());
    console.log("  Expires:", s.expiresAt.toISOString());
    if (s.revokedAt) console.log("  Revoked:", s.revokedAt.toISOString());
  });

  await prisma.$disconnect();
}

main();
