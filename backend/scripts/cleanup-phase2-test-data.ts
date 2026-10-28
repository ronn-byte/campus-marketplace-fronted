
import "./test-database.ts";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED_DATABASE = "campus_marketplace_test";
const EXPECTED_USER_COUNT = 29;
const TEST_EMAIL_PREFIX = "phase2-verification-";
const TEST_EMAIL_SUFFIX = "@example.test";

// Limit the cleanup candidates to the audited test run.
const RUN_START = new Date("2026-10-17T13:44:00.000Z");
const RUN_END = new Date("2026-10-17T13:47:00.000Z");

async function main() {
  const identity = await prisma.$queryRaw<
    Array<{ database_name: string; server_address: string | null }>
  >`
    SELECT
      current_database() AS database_name,
      inet_server_addr()::text AS server_address
  `;

  console.log("DATABASE_IDENTITY:", JSON.stringify(identity, null, 2));

  if (
    identity.length !== 1 ||
    identity[0].database_name !== EXPECTED_DATABASE
  ) {
    throw new Error("STOP: unexpected database identity.");
  }

  const users = await prisma.user.findMany({
    where: {
      email: {
        startsWith: TEST_EMAIL_PREFIX,
        endsWith: TEST_EMAIL_SUFFIX,
      },
      createdAt: {
        gte: RUN_START,
        lt: RUN_END,
      },
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (users.length !== EXPECTED_USER_COUNT) {
    throw new Error(
      `STOP: expected ${EXPECTED_USER_COUNT} audited users, found ${users.length}. No changes made.`,
    );
  }

  const userIds = users.map((user) => user.id);

  const [
    listings,
    inquiries,
    studentProfiles,
    verifications,
  ] = await Promise.all([
    prisma.listing.findMany({
      where: { sellerId: { in: userIds } },
      select: { id: true, sellerId: true, title: true, status: true },
    }),

    prisma.listingInquiry.findMany({
      where: {
        OR: [
          { buyerId: { in: userIds } },
          { listing: { sellerId: { in: userIds } } },
        ],
      },
      select: { id: true, buyerId: true, listingId: true },
    }),

    prisma.studentProfile.findMany({
      where: { userId: { in: userIds } },
      select: { id: true, userId: true },
    }),

    prisma.verification.findMany({
      where: {
        OR: [
          { userId: { in: userIds } },
          { reviewedById: { in: userIds } },
          { studentProfile: { userId: { in: userIds } } },
        ],
      },
      select: {
        id: true,
        userId: true,
        reviewedById: true,
        studentProfileId: true,
      },
    }),
  ]);

  const verificationIds = verifications.map((v) => v.id);
  const studentProfileIds = studentProfiles.map((p) => p.id);

  const [
    externalReviewerReferences,
    externalStudentProfileReferences,
    externalInquiryBuyers,
    externalVerificationTokens,
    listingImageCount,
    emailTokenCount,
    passwordResetTokenCount,
    sessionCount,
    profileCount,
  ] = await Promise.all([
    prisma.verification.findMany({
      where: {
        reviewedById: { in: userIds },
        userId: { notIn: userIds },
      },
      select: { id: true, userId: true, reviewedById: true },
    }),

    prisma.verification.findMany({
      where: {
        studentProfileId: { in: studentProfileIds },
        userId: { notIn: userIds },
      },
      select: { id: true, userId: true, studentProfileId: true },
    }),

    prisma.listingInquiry.findMany({
      where: {
        listing: { sellerId: { in: userIds } },
        buyerId: { notIn: userIds },
      },
      select: { id: true, buyerId: true, listingId: true },
    }),

    prisma.emailVerificationToken.findMany({
      where: {
        verificationId: { in: verificationIds },
        userId: { notIn: userIds },
      },
      select: { id: true, userId: true, verificationId: true },
    }),

    prisma.listingImage.count({
      where: { listing: { sellerId: { in: userIds } } },
    }),

    prisma.emailVerificationToken.count({
      where: { userId: { in: userIds } },
    }),

    prisma.passwordResetToken.count({
      where: { userId: { in: userIds } },
    }),

    prisma.session.count({
      where: { userId: { in: userIds } },
    }),

    prisma.profile.count({
      where: { userId: { in: userIds } },
    }),
  ]);

  const blockers = {
    externalReviewerReferences: externalReviewerReferences.length,
    externalStudentProfileReferences:
      externalStudentProfileReferences.length,
    externalInquiryBuyers: externalInquiryBuyers.length,
    externalVerificationTokens: externalVerificationTokens.length,
  };

  const blocked = Object.values(blockers).some((count) => count > 0);

  console.log(
    JSON.stringify(
      {
        mode: "DRY RUN ONLY - NO DATA WILL BE DELETED",
        safety: {
          databaseVerified: true,
          expectedUserCountVerified: true,
          userCount: users.length,
          runWindowUtc: {
            startInclusive: RUN_START.toISOString(),
            endExclusive: RUN_END.toISOString(),
          },
          externalReferences: blockers,
          cleanupPlanSafeToReview: !blocked,
        },
        counts: {
          users: users.length,
          listings: listings.length,
          listingImages: listingImageCount,
          inquiries: inquiries.length,
          studentProfiles: studentProfiles.length,
          verifications: verifications.length,
          emailVerificationTokens: emailTokenCount,
          passwordResetTokens: passwordResetTokenCount,
          sessions: sessionCount,
          profiles: profileCount,
        },
        users,
        listings,
        inquiries,
        verifications,
        externalReviewerReferences,
        externalStudentProfileReferences,
        externalInquiryBuyers,
        externalVerificationTokens,
      },
      null,
      2,
    ),
  );

  if (blocked) {
    throw new Error(
      "STOP: external relationships exist. Do not clean up until reviewed.",
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error("DRY-RUN FAILED:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
