import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: [] });

const EXPECTED_TARGET = {
  host: "campus-marketplace-db.postgres.database.azure.com",
  port: "5432",
  database: "campus_marketplace_dev",
  sslmode: "require",
} as const;

const EXPECTED_LISTING_IDS = [
  "9f82fba2-175e-4428-a933-148f6c52afb7",
  "a43d1257-8e69-47d2-b66b-fa6a255736a3",
  "e2b08b54-0403-4710-a175-30b97c15c611",
  "08bce098-d522-48bc-ae12-8559df313e72",
  "c756469f-0d0b-4f32-b53c-33d0ca0d73b7",
  "83dbf296-8a37-41aa-81ee-ff55559c5815",
  "9e027550-da96-467d-828e-cfcda16643df",
  "624f587f-d4b7-4baa-b750-87db4ef178d8",
  "8f3fbaa4-ee54-411f-a748-d0aba806554a",
  "894baa4e-586b-4582-9984-9cecab813535",
  "5f8ae846-bd97-4446-a3c4-33786de16efe",
  "1bd615ed-a055-42b9-909e-32a82177a449",
  "37eeaf6b-e032-4050-8536-a05c0dc15e9a",
  "e6daaff3-a426-4ad0-962b-1855c45b067a",
  "c359d990-eaeb-49a3-a97a-be1cd841a9f6",
  "276fe4cc-29a2-45d0-81ba-92bbb8254dc7",
  "b127b7dc-f559-4310-9791-24ecd3a5bec5",
  "e252f430-0342-4875-be78-ed125c4f53fe",
  "4c13287e-310a-4e77-aff7-58ff164c94d0",
  "fd7ab4d1-1042-432b-a9a7-7ab1bacd28d5",
  "f07fa8c4-764b-4b4d-936c-5c2f9277ce04",
  "75293363-cb78-447b-9a5f-ced7ee962c96",
  "952341ac-c959-456a-9a41-bded34ae364b",
  "847fdaf1-adee-40d3-ab40-ca55328854f6",
  "2a9428c5-4c01-4d22-99f6-d18cf9c36ada",
  "4ad011b2-6d4c-47f7-9298-ed794796f5d8",
  "1a0be55d-68c0-48f9-9e10-d758d1723d88",
  "39a98f8d-99a9-4056-bba1-3c1a6ddf657d",
  "411972c8-0f13-445e-8641-61352b625df6",
].sort();

const EXPECTED_FOREIGN_KEYS = [
  "public.listing_images|public.listings|RESTRICT",
  "public.listing_inquiries|public.listings|RESTRICT",
  "public.listing_inquiry_messages|public.listing_inquiries|CASCADE",
].sort();

const isExecuteMode =
  process.argv.includes("--execute") &&
  process.argv.includes("--confirm-production-listing-reset=29");

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`STOP: ${message}`);
}

function getVerifiedTarget() {
  const raw = process.env.DATABASE_URL;
  assert(Boolean(raw), "DATABASE_URL is missing.");

  let parsed: URL;
  try {
    parsed = new URL(raw as string);
  } catch {
    throw new Error("STOP: DATABASE_URL is not a valid URL.");
  }

  const target = {
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: decodeURIComponent(parsed.pathname.replace(/^\/+|\/+$/g, "")),
    sslmode: parsed.searchParams.get("sslmode") ?? "",
  };

  assert(
    target.host === EXPECTED_TARGET.host &&
      target.port === EXPECTED_TARGET.port &&
      target.database === EXPECTED_TARGET.database &&
      target.sslmode === EXPECTED_TARGET.sslmode,
    "DATABASE_URL target does not match the approved production database.",
  );

  return target;
}

function uuidList(ids: string[]) {
  // Cast every bound string parameter to uuid before PostgreSQL comparison.
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

async function getListingIds(tx: Prisma.TransactionClient, lock: boolean) {
  const lockClause = lock ? Prisma.sql`FOR UPDATE` : Prisma.empty;
  return tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"::text AS "id"
    FROM "public"."listings"
    ORDER BY "id"
    ${lockClause}
  `;
}

async function getForeignKeys(tx: Prisma.TransactionClient) {
  return tx.$queryRaw<
    Array<{
      childSchema: string;
      childTable: string;
      parentSchema: string;
      parentTable: string;
      action: string;
    }>
  >`
    SELECT
      child_schema.nspname AS "childSchema",
      child.relname AS "childTable",
      parent_schema.nspname AS "parentSchema",
      parent.relname AS "parentTable",
      CASE constraint_row.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
        ELSE 'UNKNOWN'
      END AS "action"
    FROM pg_constraint AS constraint_row
    JOIN pg_class AS child ON child.oid = constraint_row.conrelid
    JOIN pg_namespace AS child_schema ON child_schema.oid = child.relnamespace
    JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
    JOIN pg_namespace AS parent_schema ON parent_schema.oid = parent.relnamespace
    WHERE constraint_row.contype = 'f'
      AND parent.relname IN (
        'listings',
        'listing_inquiries',
        'listing_images',
        'listing_inquiry_messages'
      )
      AND child_schema.nspname <> 'information_schema'
      AND child_schema.nspname !~ '^pg_'
      AND parent_schema.nspname <> 'information_schema'
      AND parent_schema.nspname !~ '^pg_'
    ORDER BY parent_schema.nspname, parent.relname,
             child_schema.nspname, child.relname
  `;
}

async function getCounts(tx: Prisma.TransactionClient) {
  const [
    listings,
    listingImages,
    listingInquiries,
    listingInquiryMessages,
    users,
    profiles,
    studentProfiles,
    sessions,
    emailVerificationTokens,
    passwordResetTokens,
    verifications,
  ] = await Promise.all([
    tx.listing.count(),
    tx.listingImage.count(),
    tx.listingInquiry.count(),
    tx.listingInquiryMessage.count(),
    tx.user.count(),
    tx.profile.count(),
    tx.studentProfile.count(),
    tx.session.count(),
    tx.emailVerificationToken.count(),
    tx.passwordResetToken.count(),
    tx.verification.count(),
  ]);

  return {
    listings,
    listingImages,
    listingInquiries,
    listingInquiryMessages,
    users,
    profiles,
    studentProfiles,
    sessions,
    emailVerificationTokens,
    passwordResetTokens,
    verifications,
  };
}

async function getProtectedState(tx: Prisma.TransactionClient) {
  const [userStates, studentVerificationStates, verificationStates] =
    await Promise.all([
      tx.$queryRaw<
        Array<{
          role: string;
          accountStatus: string;
          emailVerified: boolean;
          count: number;
        }>
      >`
        SELECT
          "role"::text AS "role",
          "accountStatus"::text AS "accountStatus",
          ("emailVerifiedAt" IS NOT NULL) AS "emailVerified",
          count(*)::int AS "count"
        FROM "public"."users"
        GROUP BY "role", "accountStatus", ("emailVerifiedAt" IS NOT NULL)
        ORDER BY "role", "accountStatus", "emailVerified"
      `,
      tx.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT "verificationStatus"::text AS "status", count(*)::int AS "count"
        FROM "public"."student_profiles"
        GROUP BY "verificationStatus"
        ORDER BY "verificationStatus"
      `,
      tx.$queryRaw<Array<{ status: string; count: number }>>`
        SELECT "status"::text AS "status", count(*)::int AS "count"
        FROM "public"."verifications"
        GROUP BY "status"
        ORDER BY "status"
      `,
    ]);

  return { userStates, studentVerificationStates, verificationStates };
}

async function getListingOwnedCounts(
  tx: Prisma.TransactionClient,
  ids: string[],
) {
  const inIds = uuidList(ids);
  const [listings, images, inquiries, messages] = await Promise.all([
    tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS "count"
      FROM "public"."listings"
      WHERE "id" IN (${inIds})
    `),
    tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS "count"
      FROM "public"."listing_images"
      WHERE "listingId" IN (${inIds})
    `),
    tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS "count"
      FROM "public"."listing_inquiries"
      WHERE "listingId" IN (${inIds})
    `),
    tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS "count"
      FROM "public"."listing_inquiry_messages" AS message
      WHERE message."inquiryId" IN (
        SELECT inquiry."id"
        FROM "public"."listing_inquiries" AS inquiry
        WHERE inquiry."listingId" IN (${inIds})
      )
    `),
  ]);

  return {
    listings: listings[0].count,
    images: images[0].count,
    inquiries: inquiries[0].count,
    messages: messages[0].count,
  };
}

function assertSameIds(actualIds: string[]) {
  const actual = [...actualIds].sort();
  assert(
    actual.length === EXPECTED_LISTING_IDS.length &&
      actual.every((id, index) => id === EXPECTED_LISTING_IDS[index]),
    "The current listing IDs do not exactly match the approved 29-ID set.",
  );
}

async function main() {
  const target = getVerifiedTarget();

  const result = await prisma.$transaction(
    async (tx) => {
      const identity = await tx.$queryRaw<
        Array<{ database: string; schema: string }>
      >`SELECT current_database() AS "database", current_schema() AS "schema"`;
      assert(
        identity.length === 1 &&
          identity[0].database === EXPECTED_TARGET.database &&
          identity[0].schema === "public",
        "The connected database identity does not match the approved target.",
      );

      const listingRows = await getListingIds(tx, isExecuteMode);
      const listingIds = listingRows.map(({ id }) => id);
      assertSameIds(listingIds);

      const foreignKeys = await getForeignKeys(tx);
      const actualForeignKeys = foreignKeys
        .map(
          ({ childSchema, childTable, parentSchema, parentTable, action }) =>
            `${childSchema}.${childTable}|${parentSchema}.${parentTable}|${action}`,
        )
        .sort();
      assert(
        JSON.stringify(actualForeignKeys) ===
          JSON.stringify(EXPECTED_FOREIGN_KEYS),
        "The listing foreign-key graph differs from the audited graph.",
      );

      const [before, protectedBefore, ownedBefore] = await Promise.all([
        getCounts(tx),
        getProtectedState(tx),
        getListingOwnedCounts(tx, EXPECTED_LISTING_IDS),
      ]);
      assert(
        before.listings === 29 && ownedBefore.listings === 29,
        "Expected exactly 29 listings matching the approved ID set.",
      );

      if (!isExecuteMode) {
        return {
          mode: "READ_ONLY_VALIDATION",
          listingCount: listingIds.length,
          foreignKeys: actualForeignKeys,
          before,
          protectedStateSnapshotCaptured: true,
          listingOwnedCounts: ownedBefore,
          deletionsExecuted: false,
        };
      }

      const inIds = uuidList(EXPECTED_LISTING_IDS);
      const deletedMessages = await tx.$executeRaw(Prisma.sql`
        DELETE FROM "public"."listing_inquiry_messages"
        WHERE "inquiryId" IN (
          SELECT inquiry."id"
          FROM "public"."listing_inquiries" AS inquiry
          WHERE inquiry."listingId" IN (${inIds})
        )
      `);
      const deletedImages = await tx.$executeRaw(Prisma.sql`
        DELETE FROM "public"."listing_images"
        WHERE "listingId" IN (${inIds})
      `);
      const deletedInquiries = await tx.$executeRaw(Prisma.sql`
        DELETE FROM "public"."listing_inquiries"
        WHERE "listingId" IN (${inIds})
      `);
      const deletedListings = await tx.$executeRaw(Prisma.sql`
        DELETE FROM "public"."listings"
        WHERE "id" IN (${inIds})
      `);

      assert(
        deletedMessages === ownedBefore.messages &&
          deletedImages === ownedBefore.images &&
          deletedInquiries === ownedBefore.inquiries &&
          deletedListings === 29,
        "Deletion counts differed from the pre-deletion audit; transaction will roll back.",
      );

      const [after, protectedAfter] = await Promise.all([
        getCounts(tx),
        getProtectedState(tx),
      ]);
      assert(
        after.listings === 0 &&
          after.listingImages === before.listingImages - ownedBefore.images &&
          after.listingInquiries ===
            before.listingInquiries - ownedBefore.inquiries &&
          after.listingInquiryMessages ===
            before.listingInquiryMessages - ownedBefore.messages,
        "Listing-owned records remain or unrelated listing records changed; transaction will roll back.",
      );
      assert(
        JSON.stringify(after) ===
          JSON.stringify({
            ...before,
            listings: 0,
            listingImages: before.listingImages - ownedBefore.images,
            listingInquiries: before.listingInquiries - ownedBefore.inquiries,
            listingInquiryMessages:
              before.listingInquiryMessages - ownedBefore.messages,
          }) &&
          JSON.stringify(protectedAfter) === JSON.stringify(protectedBefore),
        "Protected or unrelated record counts changed; transaction will roll back.",
      );

      return {
        mode: "CLEANUP_TRANSACTION",
        listingCount: listingIds.length,
        before,
        listingOwnedCounts: ownedBefore,
        deleted: {
          listingInquiryMessages: deletedMessages,
          listingImages: deletedImages,
          listingInquiries: deletedInquiries,
          listings: deletedListings,
        },
        after,
        protectedStateVerified: true,
      };
    },
    { isolationLevel: "Serializable", timeout: 60_000, maxWait: 10_000 },
  );

  console.log(
    JSON.stringify(
      {
        target,
        executionAuthorizedByFlags: isExecuteMode,
        ...result,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure.";
    console.error("PRODUCTION LISTING CLEANUP STOPPED:", message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
