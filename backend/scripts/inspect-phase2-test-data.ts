
import "./test-database.ts";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const databaseIdentity = await prisma.$queryRaw<
    Array<{ database_name: string; server_address: string | null }>
  >`
    SELECT
      current_database() AS database_name,
      inet_server_addr()::text AS server_address
  `;

  console.log(
    "DATABASE_IDENTITY:",
    JSON.stringify(databaseIdentity, null, 2),
  );

  const users = await prisma.user.findMany({
    where: {
      email: {
        startsWith: "phase2-verification-",
        endsWith: "@example.test",
      },
    },
    select: {
      id: true,
      email: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const ids = users.map((user) => user.id);

  const [
    listings,
    inquiries,
    verifications,
    imageCount,
    emailTokens,
    passwordTokenCount,
    sessionCount,
    studentProfileCount,
    profileCount,
  ] = await Promise.all([
    prisma.listing.findMany({
      where: { sellerId: { in: ids } },
      select: {
        id: true,
        sellerId: true,
        title: true,
        status: true,
        _count: {
          select: { images: true, inquiries: true },
        },
      },
    }),

    prisma.listingInquiry.findMany({
      where: {
        OR: [
          { buyerId: { in: ids } },
          { listing: { sellerId: { in: ids } } },
        ],
      },
      select: {
        id: true,
        buyerId: true,
        listingId: true,
      },
    }),

    prisma.verification.findMany({
      where: {
        OR: [
          { userId: { in: ids } },
          { reviewedById: { in: ids } },
        ],
      },
      select: {
        id: true,
        userId: true,
        reviewedById: true,
        studentProfileId: true,
      },
    }),

    prisma.listingImage.count({
      where: { listing: { sellerId: { in: ids } } },
    }),

    prisma.emailVerificationToken.findMany({
      where: { userId: { in: ids } },
      select: {
        id: true,
        userId: true,
        verificationId: true,
        purpose: true,
      },
    }),

    prisma.passwordResetToken.count({
      where: { userId: { in: ids } },
    }),

    prisma.session.count({
      where: { userId: { in: ids } },
    }),

    prisma.studentProfile.count({
      where: { userId: { in: ids } },
    }),

    prisma.profile.count({
      where: { userId: { in: ids } },
    }),
  ]);

  console.log(
    JSON.stringify(
      {
        audit: {
          matchingUsers: users.length,
          listings: listings.length,
          listingImages: imageCount,
          inquiries: inquiries.length,
          verificationRecords: verifications.length,
          emailVerificationTokens: emailTokens.length,
          passwordResetTokens: passwordTokenCount,
          sessions: sessionCount,
          studentProfiles: studentProfileCount,
          profiles: profileCount,
        },
        users,
        listings,
        inquiries,
        verifications,
        emailTokens,
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
