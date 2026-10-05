import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingStatus,
  VerificationStatus,
} from "@prisma/client";

process.env.NODE_ENV = "test";
process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
process.env.DATABASE_URL ??= "postgresql://localhost:5432/campus_marketplace_test";
process.env.STUDENT_DATA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");

const { prisma } = await import("../src/lib/prisma.js");
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");
const app = buildApp();

type ActorOptions = {
  accountStatus?: AccountStatus;
  verificationStatus?: VerificationStatus;
};

const actorIds: string[] = [];
const listingIds: string[] = [];
let categoryId: string;
let emailSequence = 0;

async function createActor(options: ActorOptions = {}) {
  const email = `phase2-inquiry-${Date.now()}-${++emailSequence}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("phase2-inquiry-test-password"),
      accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
      studentProfile: {
        create: {
          displayName: "Inquiry Test Student",
          verificationStatus:
            options.verificationStatus ?? VerificationStatus.PENDING,
        },
      },
    },
    include: { studentProfile: true },
  });
  actorIds.push(user.id);

  const sessionToken = createOpaqueToken();
  await createSession(user.id, hashToken(sessionToken), {});
  return { user, sessionToken };
}

function authHeaders(sessionToken: string) {
  return { cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}` };
}

async function createListing(
  sellerId: string,
  status: ListingStatus = ListingStatus.PUBLISHED,
) {
  const listing = await prisma.listing.create({
    data: {
      sellerId,
      categoryId,
      title: "Inquiry test listing",
      description: "A listing used to test inquiry behavior.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
      status,
    },
  });
  listingIds.push(listing.id);
  return listing;
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectObjectKeys(nested),
  ]);
}

before(async () => {
  await app.ready();
  const category = await prisma.category.create({
    data: {
      name: `Inquiry test category ${Date.now()}`,
      slug: `inquiry-test-${Date.now()}`,
    },
  });
  categoryId = category.id;
});

after(async () => {
  await prisma.listingInquiry.deleteMany({
    where: {
      OR: [
        { listingId: { in: listingIds } },
        { buyerId: { in: actorIds } },
      ],
    },
  });
  if (listingIds.length > 0) {
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (actorIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: actorIds } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: actorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
  }
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await app.close();
});

test("listing inquiry creation enforces authentication and session identity", async (t) => {
  const seller = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const unverifiedBuyer = await createActor();
  const verifiedBuyer = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const listing = await createListing(seller.user.id);
  const url = `/api/v1/listings/${listing.id}/inquiries`;

  await t.test("unauthenticated creation is rejected", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      payload: { message: "Is this available?" },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("authenticated unverified student can create an inquiry", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(unverifiedBuyer.sessionToken),
      payload: { message: "  Is this still available?  " },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().inquiry.message, "Is this still available?");
    assert.equal(response.json().inquiry.status, "OPEN");
    const saved = await prisma.listingInquiry.findFirst({
      where: { listingId: listing.id },
    });
    assert.equal(saved?.buyerId, unverifiedBuyer.user.id);
  });

  await t.test("authenticated verified student can create an inquiry", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(verifiedBuyer.sessionToken),
      payload: { message: "I am interested." },
    });
    assert.equal(response.statusCode, 201);
    const saved = await prisma.listingInquiry.findFirst({
      where: { listingId: listing.id, buyerId: verifiedBuyer.user.id },
    });
    assert.ok(saved);
  });

  await t.test("repeat inquiries are allowed", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(unverifiedBuyer.sessionToken),
      payload: { message: "Following up." },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(
      await prisma.listingInquiry.count({
        where: { listingId: listing.id, buyerId: unverifiedBuyer.user.id },
      }),
      2,
    );
  });

  await t.test("buyerId cannot be supplied to impersonate another account", async () => {
    const beforeCount = await prisma.listingInquiry.count({
      where: { listingId: listing.id },
    });
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(unverifiedBuyer.sessionToken),
      payload: { message: "Hello", buyerId: verifiedBuyer.user.id },
    });
    assert.equal(response.statusCode, 422);
    assert.equal(
      await prisma.listingInquiry.count({ where: { listingId: listing.id } }),
      beforeCount,
    );
  });

  await t.test("protected status, timestamp, and seller identity fields are rejected", async () => {
    for (const payload of [
      { message: "Hello", status: "CLOSED" },
      { message: "Hello", sellerId: verifiedBuyer.user.id },
      { message: "Hello", createdAt: new Date().toISOString() },
      { message: "Hello", updatedAt: new Date().toISOString() },
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: authHeaders(unverifiedBuyer.sessionToken),
        payload,
      });
      assert.equal(response.statusCode, 422);
    }
  });

  await t.test("invalid and oversized messages are rejected", async () => {
    for (const payload of [
      { message: "" },
      { message: "    " },
      { message: 42 },
      { message: "x".repeat(2001) },
      [],
    ]) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: authHeaders(unverifiedBuyer.sessionToken),
        payload,
      });
      assert.equal(response.statusCode, 422);
    }
  });
});

test("listing inquiry creation rejects blocked accounts and unavailable listings", async (t) => {
  const activeBuyer = await createActor();
  const seller = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });

  await t.test("suspended and disabled accounts cannot create inquiries", async () => {
    const listing = await createListing(seller.user.id);
    for (const accountStatus of [
      AccountStatus.SUSPENDED,
      AccountStatus.DISABLED,
    ]) {
      const blockedBuyer = await createActor({ accountStatus });
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/listings/${listing.id}/inquiries`,
        headers: authHeaders(blockedBuyer.sessionToken),
        payload: { message: "Is this available?" },
      });
      assert.equal(response.statusCode, 401);
    }
  });

  await t.test("nonexistent listing cannot receive an inquiry", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/listings/00000000-0000-4000-8000-000000000000/inquiries",
      headers: authHeaders(activeBuyer.sessionToken),
      payload: { message: "Is this available?" },
    });
    assert.equal(response.statusCode, 404);
    assert.equal(response.json().error.code, "LISTING_NOT_FOUND");
  });

  for (const status of [
    ListingStatus.DRAFT,
    ListingStatus.SUSPENDED,
    ListingStatus.REMOVED,
    ListingStatus.RESERVED,
    ListingStatus.SOLD,
  ]) {
    await t.test(`${status} listing cannot receive an inquiry`, async () => {
      const listing = await createListing(seller.user.id, status);
      const response = await app.inject({
        method: "POST",
        url: `/api/v1/listings/${listing.id}/inquiries`,
        headers: authHeaders(activeBuyer.sessionToken),
        payload: { message: "Is this available?" },
      });
      assert.equal(response.statusCode, 404);
      assert.equal(response.json().error.code, "LISTING_NOT_FOUND");
      assert.equal(
        await prisma.listingInquiry.count({ where: { listingId: listing.id } }),
        0,
      );
    });
  }
});

test("listing inquiry retrieval is authenticated, owner-only, and returns safe buyer profiles", async (t) => {
  const seller = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const buyer = await createActor();
  const otherStudent = await createActor();
  const listing = await createListing(seller.user.id);

  await app.inject({
    method: "POST",
    url: `/api/v1/listings/${listing.id}/inquiries`,
    headers: authHeaders(buyer.sessionToken),
    payload: { message: "Could I pick this up tomorrow?" },
  });

  await t.test("unauthenticated retrieval is rejected", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}/inquiries`,
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("another student cannot retrieve the inquiries", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}/inquiries?sellerId=${seller.user.id}`,
      headers: authHeaders(otherStudent.sessionToken),
    });
    assert.equal(response.statusCode, 403);
  });

  await t.test("the owner receives inquiries with only safe buyer profile fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}/inquiries`,
      headers: authHeaders(seller.sessionToken),
    });
    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.inquiries.length, 1);
    assert.equal(body.inquiries[0].message, "Could I pick this up tomorrow?");
    assert.equal(body.inquiries[0].status, "OPEN");
    assert.deepEqual(Object.keys(body.inquiries[0].buyer).sort(), [
      "name",
      "verified",
    ]);
    assert.equal(body.inquiries[0].buyer.name, "Inquiry Test Student");
    assert.equal(body.inquiries[0].buyer.verified, false);

    const keys = collectObjectKeys(body);
    for (const sensitiveField of [
      "id",
      "buyerId",
      "sellerId",
      "email",
      "passwordHash",
      "sessions",
      "sessionHash",
      "verificationTokens",
      "registrationNumberHash",
      "registrationNumberCiphertext",
    ]) {
      assert.equal(keys.includes(sensitiveField), false, sensitiveField);
    }
  });

  await t.test("public listing seller DTO remains limited to safe display fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}`,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.json().listing.seller).sort(), [
      "name",
      "verified",
    ]);
  });
});
