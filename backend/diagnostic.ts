#!/usr/bin/env node
/**
 * Safe diagnostic script to inspect account states without exposing sensitive data
 * Usage: npx tsx diagnostic.ts [email_filter]
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const emailFilter = process.argv[2];

  console.log("\n=== ACCOUNT STATE DIAGNOSTIC ===\n");

  try {
    // List all users (safe fields only)
    const users = await prisma.user.findMany({
      where: emailFilter ? { email: { contains: emailFilter } } : undefined,
      select: {
        id: true,
        email: true,
        role: true,
        accountStatus: true,
        emailVerifiedAt: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "desc" },
    });

    if (users.length === 0) {
      console.log("No users found.");
      if (emailFilter) {
        console.log(`(Searched for email containing: "${emailFilter}")`);
      }
      return;
    }

    console.log(`Found ${users.length} user(s):\n`);

    for (const user of users) {
      console.log(`Email: ${user.email}`);
      console.log(`  ID: ${user.id}`);
      console.log(`  Role: ${user.role}`);
      console.log(`  Account Status: ${user.accountStatus}`);
      console.log(`  Email Verified: ${user.emailVerifiedAt ? "Yes" : "No"}`);
      console.log(`  Created: ${user.createdAt.toISOString()}`);
      console.log(`  Updated: ${user.updatedAt.toISOString()}`);

      // Check StudentProfile
      const profile = await prisma.studentProfile.findUnique({
        where: { userId: user.id },
        select: { id: true, displayName: true, verificationStatus: true, createdAt: true },
      });
      if (profile) {
        console.log(`  Student Profile: ${profile.displayName}`);
        console.log(`    Verification Status: ${profile.verificationStatus}`);
        console.log(`    Created: ${profile.createdAt.toISOString()}`);
      }

      // Check Verification records
      const verifications = await prisma.verification.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          method: true,
          status: true,
          reason: true,
          createdAt: true,
          reviewedAt: true,
        },
      });
      if (verifications.length > 0) {
        console.log(`  Verifications (${verifications.length}):`);
        for (const v of verifications) {
          console.log(`    Method: ${v.method}, Status: ${v.status}`);
          if (v.reason) console.log(`    Reason: ${v.reason}`);
          console.log(`    Created: ${v.createdAt.toISOString()}`);
          if (v.reviewedAt) console.log(`    Reviewed: ${v.reviewedAt.toISOString()}`);
        }
      }

      // Check Sessions
      const sessions = await prisma.session.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          lastUsedAt: true,
        },
      });
      if (sessions.length > 0) {
        console.log(`  Sessions (${sessions.length}):`);
        for (const s of sessions) {
          const isActive = !s.revokedAt && s.expiresAt > new Date();
          console.log(`    Status: ${isActive ? "ACTIVE" : "INACTIVE"}`);
          console.log(`    Created: ${s.createdAt.toISOString()}`);
          if (s.lastUsedAt) console.log(`    Last Used: ${s.lastUsedAt.toISOString()}`);
          if (s.revokedAt) console.log(`    Revoked: ${s.revokedAt.toISOString()}`);
        }
      }

      // Check if has verification tokens pending
      const emailTokens = await prisma.emailVerificationToken.findMany({
        where: { userId: user.id },
        select: { expiresAt: true, consumedAt: true, createdAt: true },
      });
      if (emailTokens.length > 0) {
        console.log(`  Email Verification Tokens: ${emailTokens.length}`);
        for (const t of emailTokens) {
          const isPending = !t.consumedAt && t.expiresAt > new Date();
          console.log(`    Status: ${isPending ? "PENDING" : "EXPIRED/CONSUMED"}`);
          console.log(`    Created: ${t.createdAt.toISOString()}`);
        }
      }

      console.log("");
    }
  } catch (error) {
    console.error("Error querying database:", error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main();
