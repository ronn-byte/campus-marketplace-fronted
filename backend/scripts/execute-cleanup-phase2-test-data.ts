
import "./test-database.ts";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXPECTED_DATABASE = "campus_marketplace_test";
const EXPECTED_USER_COUNT = 29;
const RUN_START = new Date("2026-10-17T13:44:00.000Z");
const RUN_END = new Date("2026-10-17T13:47:00.000Z");

const emailFilter = {
  startsWith: "phase2-verification-",
  endsWith: "@example.test",
};

function assertCount(
  label: string,
  actual: number,
  expected: number,
): void {
  if (actual !== expected) {
    throw new Error(
      `STOP: ${label} expected ${expected}, found ${actual}. Transaction will roll back.`,
    );
  }
}

async function main() {
  const report = await prisma.$transaction(
    async (tx) => {
      // 1. Verify the database inside the transaction.
      const identity = await tx.$queryRaw<
        Array<{ database_name: string; server_address: string | null }>
      >`
        SELECT
          current_database() AS database_name,
          inet_server_addr()::text AS server_address
      `;

      console.log(
        "DATABASE_IDENTITY:",
        JSON.stringify(identity, null, 2),
      );

      if (
        identity.length !== 1 ||
        identity[0].database_name !== EXPECTED_DATABASE
      ) {
        throw new Error("STOP: unexpected database identity.");
      }

      // 2. Re-identify the exact audited users.
      const users = await tx.user.findMany({
        where: {
          email: emailFilter,
          createdAt: {
            gte: RUN_START,
            lt: RUN_END,
          },
        },
        select: { id: true, email: true },
        orderBy: { createdAt: "asc" },
      });

      assertCount("Audited users", users.length, EXPECTED_USER_COUNT);

      const userIds = users.map((user) => user.id);
      const userIdSet = new Set(userIds);

      const studentProfiles = await tx.studentProfile.findMany({
        where: { userId: { in: userIds } },
        select: { id: true, userId: true },
      });

      assertCount("Student profiles", studentProfiles.length, 22);

      const studentProfileIds = studentProfiles.map((p) => p.id);

      // 3. Re-identify verification records, including reviewer links.
      const verifications = await tx.verification.findMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { reviewedById: { in: userIds } },
            { studentProfileId: { in: studentProfileIds } },
          ],
        },
        select: {
          id: true,
          userId: true,
          reviewedById: true,
          studentProfileId: true,
        },
      });

      assertCount("Verification records", verifications.length, 22);

      const verificationIds = verifications.map((v) => v.id);
      const verificationIdSet = new Set(verificationIds);

      // 4. Revalidate every audited count before deleting anything.
      const [
        listingCount,
        imageCount,
        inquiryCount,
        emailTokens,
        resetTokenCount,
        sessionCount,
        profileCount,
      ] = await Promise.all([
        tx.listing.count({ where: { sellerId: { in: userIds } } }),

        tx.listingImage.count({
          where: { listing: { sellerId: { in: userIds } } },
        }),

        tx.listingInquiry.count({
          where: {
            OR: [
              { buyerId: { in: userIds } },
              { listing: { sellerId: { in: userIds } } },
            ],
          },
        }),

        tx.emailVerificationToken.findMany({
          where: { userId: { in: userIds } },
          select: {
            id: true,
            userId: true,
            verificationId: true,
          },
        }),

        tx.passwordResetToken.count({
          where: { userId: { in: userIds } },
        }),

        tx.session.count({ where: { userId: { in: userIds } } }),

        tx.profile.count({ where: { userId: { in: userIds } } }),
      ]);

      assertCount("Listings", listingCount, 19);
      assertCount("Listing images", imageCount, 0);
      assertCount("Listing inquiries", inquiryCount, 0);
      assertCount("Email verification tokens", emailTokens.length, 2);
      assertCount("Password-reset tokens", resetTokenCount, 0);
      assertCount("Sessions", sessionCount, 29);
      assertCount("General profiles", profileCount, 0);

      // Do not delete a token linked to a verification outside this set.
      const tokensWithExternalVerification = emailTokens.filter(
        (token) =>
          token.verificationId !== null &&
          !verificationIdSet.has(token.verificationId),
      );

      if (tokensWithExternalVerification.length > 0) {
        throw new Error(
          "STOP: test-user email tokens reference verifications outside the audited set.",
        );
      }

      // 5. Refuse cleanup if any external records depend on test records.
      const [
        externalReviewerReferences,
        externalStudentProfileReferences,
        externalInquiryBuyers,
        externalListingOwners,
        externalVerificationTokens,
      ] = await Promise.all([
        tx.verification.count({
          where: {
            reviewedById: { in: userIds },
            userId: { notIn: userIds },
          },
        }),

        tx.verification.count({
          where: {
            studentProfileId: { in: studentProfileIds },
            userId: { notIn: userIds },
          },
        }),

        tx.listingInquiry.count({
          where: {
            listing: { sellerId: { in: userIds } },
            buyerId: { notIn: userIds },
          },
        }),

        tx.listingInquiry.count({
          where: {
            buyerId: { in: userIds },
            listing: { sellerId: { notIn: userIds } },
          },
        }),

        tx.emailVerificationToken.count({
          where: {
            verificationId: { in: verificationIds },
            userId: { notIn: userIds },
          },
        }),
      ]);

      const blockers = {
        externalReviewerReferences,
        externalStudentProfileReferences,
        externalInquiryBuyers,
        externalListingOwners,
        externalVerificationTokens,
        tokensWithExternalVerification:
          tokensWithExternalVerification.length,
      };

      if (Object.values(blockers).some((count) => count !== 0)) {
        throw new Error(
          `STOP: external relationships detected: ${JSON.stringify(blockers)}`,
        );
      }

      // 6. Delete only the audited records, in foreign-key-safe order.
      const deleted = {
        emailVerificationTokens:
          await tx.emailVerificationToken.deleteMany({
            where: {
              OR: [
                { userId: { in: userIds } },
                { verificationId: { in: verificationIds } },
              ],
            },
          }),

        inquiries: await tx.listingInquiry.deleteMany({
          where: {
            OR: [
              { buyerId: { in: userIds } },
              { listing: { sellerId: { in: userIds } } },
            ],
          },
        }),

        listingImages: await tx.listingImage.deleteMany({
          where: { listing: { sellerId: { in: userIds } } },
        }),

        listings: await tx.listing.deleteMany({
          where: { sellerId: { in: userIds } },
        }),

        verifications: await tx.verification.deleteMany({
          where: { id: { in: verificationIds } },
        }),

        studentProfiles: await tx.studentProfile.deleteMany({
          where: { userId: { in: userIds } },
        }),

        passwordResetTokens: await tx.passwordResetToken.deleteMany({
          where: { userId: { in: userIds } },
        }),

        sessions: await tx.session.deleteMany({
          where: { userId: { in: userIds } },
        }),

        profiles: await tx.profile.deleteMany({
          where: { userId: { in: userIds } },
        }),

        users: await tx.user.deleteMany({
          where: { id: { in: userIds } },
        }),
      };

      // 7. Verify that every deletion count matches the audit.
      const expectedDeleted = {
        emailVerificationTokens: 2,
        inquiries: 0,
        listingImages: 0,
        listings: 19,
        verifications: 22,
        studentProfiles: 22,
        passwordResetTokens: 0,
        sessions: 29,
        profiles: 0,
        users: 29,
      };

      for (const key of Object.keys(expectedDeleted) as Array<
        keyof typeof expectedDeleted
      >) {
        assertCount(
          `Deleted ${key}`,
          deleted[key].count,
          expectedDeleted[key],
        );
      }

      // 8. Confirm no matching test accounts remain before commit.
      const remainingUsers = await tx.user.count({
        where: {
          email: emailFilter,
          createdAt: {
            gte: RUN_START,
            lt: RUN_END,
          },
        },
      });

      assertCount("Remaining audited users", remainingUsers, 0);

      return {
        database: EXPECTED_DATABASE,
        transaction: "Serializable",
        deleted: Object.fromEntries(
          Object.entries(deleted).map(([key, value]) => [
            key,
            value.count,
          ]),
        ),
        remainingAuditedUsers: remainingUsers,
        externalReferences: blockers,
      };
    },
    {
      isolationLevel: "Serializable",
      maxWait: 10_000,
      timeout: 30_000,
    },
  );

  console.log(
    "CLEANUP_COMMITTED:",
    JSON.stringify(report, null, 2),
  );
}

main()
  .catch((error: unknown) => {
    console.error(
      "CLEANUP ABORTED. If the transaction started, its changes were rolled back.",
      error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
