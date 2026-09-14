#!/usr/bin/env node
/**
 * DEVELOPMENT ONLY: Complete test workflow for auth
 * 
 * This script:
 * 1. Creates a moderator account (if not exists)
 * 2. Lists pending verifications
 * 3. Approves a specific verification
 * 4. Returns login credentials for testing
 * 
 * Usage: npx tsx dev-test-workflow.ts [action] [args...]
 * 
 * Actions:
 *   create-moderator <email> <password>
 *   list-pending
 *   approve <verification-id> <moderator-id>
 *   test-login <email> <password>
 */

import { PrismaClient, VerificationStatus, AccountStatus } from "@prisma/client";
import { env } from "./src/config/env.js";
import { hashPassword, verifyPassword, createOpaqueToken, hashToken } from "./src/modules/auth/auth.utils.js";
import { authenticate, createSession } from "./src/modules/auth/auth.service.js";

if (env.NODE_ENV !== "development") {
  console.error("ERROR: This script only runs in development mode.");
  process.exitCode = 1;
  process.exit(1);
}

const [action, ...args] = process.argv.slice(2);

const prisma = new PrismaClient();

async function createModerator(email: string, password: string) {
  if (password.length < 12) {
    console.error("ERROR: Password must be at least 12 characters.");
    return;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✓ Moderator already exists: ${email}`);
    return existing.id;
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
    select: { id: true, email: true },
  });

  console.log(`✓ Created moderator: ${moderator.email}`);
  return moderator.id;
}

async function listPending() {
  const verifications = await prisma.verification.findMany({
    where: { status: "PENDING" },
    include: {
      user: { select: { email: true, accountStatus: true } },
      studentProfile: { select: { displayName: true } },
    },
  });

  if (verifications.length === 0) {
    console.log("No pending verifications.");
    return;
  }

  console.log(`\n${verifications.length} pending verification(s):\n`);
  verifications.forEach((v, i) => {
    console.log(`[${i + 1}] ID: ${v.id}`);
    console.log(`    Email: ${v.user.email}`);
    console.log(`    Name: ${v.studentProfile?.displayName || "N/A"}`);
    console.log(`    Method: ${v.method}`);
    console.log(`    Status: ${v.user.accountStatus}`);
    console.log("");
  });
}

async function approveFn(verificationId: string, moderatorId: string) {
  const verification = await prisma.verification.findUnique({
    where: { id: verificationId },
    include: { user: { select: { email: true } } },
  });

  if (!verification) {
    console.error(`ERROR: Verification not found: ${verificationId}`);
    return;
  }

  if (verification.status !== "PENDING") {
    console.error(`ERROR: Verification already reviewed: ${verification.status}`);
    return;
  }

  const result = await prisma.$transaction([
    prisma.verification.update({
      where: { id: verificationId },
      data: {
        status: VerificationStatus.APPROVED,
        reviewedById: moderatorId,
        reviewedAt: new Date(),
        reason: "Development test approval",
      },
    }),
    prisma.studentProfile.update({
      where: { userId: verification.userId },
      data: { verificationStatus: VerificationStatus.APPROVED },
    }),
    prisma.user.update({
      where: { id: verification.userId },
      data: { accountStatus: AccountStatus.ACTIVE },
    }),
  ]);

  console.log(`✓ Approved verification for: ${verification.user.email}`);
  console.log(`  Account status is now: ACTIVE`);
}

async function testLogin(email: string, password: string) {
  console.log(`\nTesting login for: ${email}`);

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, accountStatus: true },
  });

  if (!user) {
    console.error("ERROR: User not found");
    return;
  }

  console.log(`  Account Status: ${user.accountStatus}`);

  if (user.accountStatus !== "ACTIVE") {
    console.error("  ✗ Login will FAIL: Account is not ACTIVE");
    return;
  }

  try {
    const { user: authenticatedUser } = await authenticate({
      email,
      identifier: email,
      password,
    });

    console.log(`  ✓ Authentication successful`);
    console.log(`  ✓ User ID: ${authenticatedUser.id}`);

    // Create session
    const rawSession = createOpaqueToken();
    await createSession(user.id, hashToken(rawSession), {
      ipAddress: "127.0.0.1",
      userAgent: "dev-test-workflow",
    });

    console.log(`  ✓ Session created`);
    console.log(`\n✓ Full login workflow successful!`);
  } catch (error) {
    console.error(`  ✗ Login failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  try {
    switch (action) {
      case "create-moderator":
        if (!args[0] || !args[1]) {
          console.error("Usage: create-moderator <email> <password>");
          break;
        }
        await createModerator(args[0], args[1]);
        break;

      case "list-pending":
        await listPending();
        break;

      case "approve":
        if (!args[0] || !args[1]) {
          console.error("Usage: approve <verification-id> <moderator-id>");
          break;
        }
        await approveFn(args[0], args[1]);
        break;

      case "test-login":
        if (!args[0] || !args[1]) {
          console.error("Usage: test-login <email> <password>");
          break;
        }
        await testLogin(args[0], args[1]);
        break;

      default:
        console.log("DEVELOPMENT TEST WORKFLOW");
        console.log("");
        console.log("Usage: npx tsx dev-test-workflow.ts <action> [args...]");
        console.log("");
        console.log("Actions:");
        console.log("  create-moderator <email> <password>");
        console.log("  list-pending");
        console.log("  approve <verification-id> <moderator-id>");
        console.log("  test-login <email> <password>");
        break;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
