import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingStatus,
  Role,
  VerificationStatus,
} from "@prisma/client";

import "../scripts/test-database.js";

process.env.EMAIL_PROVIDER = "resend";
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
process.env.STUDENT_DATA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");

const { prisma } = await import("../src/lib/prisma.js");
const { createListingObjectKey } = await import("../src/lib/storage.js");
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");
const app = buildApp();

type ActorOptions = {
  role?: Role;
  accountStatus?: AccountStatus;
  verificationStatus?: VerificationStatus;
  emailVerified?: boolean;
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
      role: options.role ?? Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
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
  const actor = options.accountStatus && options.accountStatus !== AccountStatus.ACTIVE
    ? await prisma.user.update({ where: { id: user.id }, data: { accountStatus: options.accountStatus }, include: { studentProfile: true } })
    : user;
  return { user: actor, sessionToken };
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

async function createTestInquiry(input: {
  listingId: string;
  buyerId: string;
  message: string;
  status?: "OPEN" | "RESPONDED" | "CLOSED";
}) {
  const inquiry = await prisma.listingInquiry.create({
    data: {
      listingId: input.listingId,
      buyerId: input.buyerId,
      status: input.status ?? "OPEN",
    },
  });
  await prisma.listingInquiryMessage.create({
    data: {
      inquiryId: inquiry.id,
      sender: "BUYER",
      content: input.message,
      sequence: 1,
      readAt: inquiry.createdAt,
    },
  });
  return inquiry;
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [
    key,
    ...collectObjectKeys(nested),
  ]);
}

function getSafeResponseDiagnostics(response: { statusCode: number; json: () => unknown }) {
  const body = response.json() as { error?: { code?: unknown; message?: unknown } };
  const code = typeof body.error?.code === "string" ? body.error.code : null;
  const message = typeof body.error?.message === "string" ? body.error.message : "";

  return {
    status: response.statusCode,
    applicationErrorCode: code && !/^P\d{4}$/.test(code) ? code : null,
    prismaErrorCode: code?.match(/^P\d{4}$/)?.[0] ?? message.match(/\bP\d{4}\b/)?.[0] ?? null,
  };
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
    await prisma.listingImage.deleteMany({ where: { listingId: { in: listingIds } } });
  }
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
  const pendingBuyer = await createActor();
  const administratorBuyer = await createActor({ role: Role.ADMINISTRATOR });
  const unconfirmedBuyer = await createActor({ emailVerified: false });
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

  await t.test("listing owner cannot inquire about their own published listing", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(seller.sessionToken),
      payload: { message: "I am interested in my own listing." },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "FORBIDDEN");
    assert.equal(
      await prisma.listingInquiry.count({ where: { listingId: listing.id } }),
      0,
    );
  });

  await t.test("an email-verified buyer without student verification can create an inquiry", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(pendingBuyer.sessionToken),
      payload: { message: "  Is this still available?  " },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().inquiry.message, "Is this still available?");
    assert.equal(response.json().inquiry.status, "OPEN");
    const saved = await prisma.listingInquiry.findFirst({
      where: { listingId: listing.id },
    });
    assert.equal(saved?.buyerId, pendingBuyer.user.id);
  });

  await t.test("an active email-verified account can inquire regardless of role", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(administratorBuyer.sessionToken),
      payload: { message: "Can I arrange a viewing?" },
    });
    assert.equal(response.statusCode, 201);
    const saved = await prisma.listingInquiry.findFirst({
      where: { listingId: listing.id, buyerId: administratorBuyer.user.id },
    });
    assert.ok(saved);
  });

  await t.test("an unverified email cannot create an inquiry", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(unconfirmedBuyer.sessionToken),
      payload: { message: "I am interested." },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "EMAIL_VERIFICATION_REQUIRED");
  });

  await t.test("a different eligible buyer can create an inquiry", async () => {
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
    assert.equal(saved.buyerId, verifiedBuyer.user.id);
  });

  await t.test("repeat inquiries are allowed", async () => {
    const response = await app.inject({
      method: "POST",
      url,
      headers: authHeaders(pendingBuyer.sessionToken),
      payload: { message: "Following up." },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(
      await prisma.listingInquiry.count({
        where: { listingId: listing.id, buyerId: pendingBuyer.user.id },
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
      headers: authHeaders(pendingBuyer.sessionToken),
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
        headers: authHeaders(pendingBuyer.sessionToken),
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
        headers: authHeaders(pendingBuyer.sessionToken),
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
      "id",
      "name",
      "verified",
    ]);
    assert.equal(body.inquiries[0].buyer.name, "Inquiry Test Student");
    assert.equal(body.inquiries[0].buyer.verified, false);

    const keys = collectObjectKeys(body);
    for (const sensitiveField of [
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
    assert.ok(body.inquiries[0].id);
  });

  await t.test("public listing details only report ownership to the signed-in owner", async () => {
    const ownerResponse = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}`,
      headers: authHeaders(seller.sessionToken),
    });
    assert.equal(ownerResponse.statusCode, 200);
    assert.equal(ownerResponse.json().listing.isOwner, true);

    const otherUserResponse = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}`,
      headers: authHeaders(otherStudent.sessionToken),
    });
    assert.equal(otherUserResponse.statusCode, 200);
    assert.equal(otherUserResponse.json().listing.isOwner, false);
  });

  await t.test("public listing seller DTO remains limited to safe display fields", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/listings/${listing.id}`,
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(Object.keys(response.json().listing.seller).sort(), [
      "avatarUrl",
      "id",
      "name",
      "verified",
    ]);
  });
});

test("seller listing retrieval and buyer inquiry retrieval respect ownership and pagination", async (t) => {
  const sellerA = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const sellerB = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const buyerA = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const buyerB = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const administratorBuyer = await createActor({ role: Role.ADMINISTRATOR });
  const unconfirmedBuyer = await createActor({ emailVerified: false });

  const draft = await createListing(sellerA.user.id, ListingStatus.DRAFT);
  const published = await createListing(sellerA.user.id, ListingStatus.PUBLISHED);
  await createListing(sellerA.user.id, ListingStatus.RESERVED);
  const sold = await createListing(sellerA.user.id, ListingStatus.SOLD);
  await createListing(sellerA.user.id, ListingStatus.SUSPENDED);
  await createListing(sellerA.user.id, ListingStatus.REMOVED);

  const firstPublishedInquiry = await createTestInquiry({
    listingId: published.id,
    buyerId: buyerA.user.id,
    message: "Need to know if it is still available.",
  });
  const previewImageKey = createListingObjectKey(published.id, "image/png");
  await prisma.listingImage.create({
    data: {
      listingId: published.id,
      objectKey: previewImageKey,
      sortOrder: 0,
      processingStatus: "READY",
    },
  });

  await prisma.listingInquiryMessage.create({
    data: {
      inquiryId: firstPublishedInquiry.id,
      sender: "SELLER",
      content: "Yes, it is still available.",
      sequence: 2,
    },
  });

  await createTestInquiry({
    listingId: sold.id,
    buyerId: buyerA.user.id,
    message: "Historical inquiry after sale.",
    status: "CLOSED",
  });

  await createTestInquiry({
    listingId: published.id,
    buyerId: administratorBuyer.user.id,
    message: "Administrator-role buyer inquiry.",
  });

  await t.test("seller listing retrieval is authenticated and scoped to request.user.id", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/listings/me" });
    assert.equal(unauthenticated.statusCode, 401);

    const ownListings = await app.inject({
      method: "GET",
      url: "/api/v1/listings/me?page=1&pageSize=3",
      headers: authHeaders(sellerA.sessionToken),
    });
    assert.equal(ownListings.statusCode, 200);
    assert.equal(ownListings.json().meta.page, 1);
    assert.equal(ownListings.json().meta.pageSize, 3);
    assert.equal(ownListings.json().items.length, 3);
    assert.equal(ownListings.json().items.every((item: { status: string }) => item.status), true);

    const listingCounts = await app.inject({
      method: "GET",
      url: "/api/v1/listings/me?page=1&pageSize=10",
      headers: authHeaders(sellerA.sessionToken),
    });
    assert.equal(listingCounts.statusCode, 200);
    const listingCountsById = new Map<string, number>(
      listingCounts.json().items.map((item: { id: string; inquiryCount: number }) => [
        item.id,
        item.inquiryCount,
      ] as const),
    );
    assert.equal(listingCountsById.get(published.id), 2);
    assert.equal(listingCountsById.get(sold.id), 1);
    assert.equal(listingCountsById.get(draft.id), 0);
    assert.equal(
      Object.keys(listingCounts.json().items.find((item: { id: string }) => item.id === published.id) ?? {})
        .includes("inquiries"),
      false,
    );

    const forbiddenQuery = await app.inject({
      method: "GET",
      url: `/api/v1/listings/me?sellerId=${sellerB.user.id}`,
      headers: authHeaders(sellerA.sessionToken),
    });
    assert.equal(forbiddenQuery.statusCode, 422);
    assert.equal(forbiddenQuery.json().error.code, "VALIDATION_ERROR");
  });

  await t.test("buyer inquiry retrieval is authenticated and scoped to request.user.id", async () => {
    const unauthenticated = await app.inject({ method: "GET", url: "/api/v1/inquiries/me" });
    assert.equal(unauthenticated.statusCode, 401);

    const unverifiedEmail = await app.inject({
      method: "GET",
      url: "/api/v1/inquiries/me",
      headers: authHeaders(unconfirmedBuyer.sessionToken),
    });
    assert.equal(unverifiedEmail.statusCode, 403);
    assert.equal(unverifiedEmail.json().error.code, "EMAIL_VERIFICATION_REQUIRED");

    const ownInquiries = await app.inject({
      method: "GET",
      url: "/api/v1/inquiries/me?page=1&pageSize=10",
      headers: authHeaders(buyerA.sessionToken),
    });
    assert.equal(ownInquiries.statusCode, 200);
    assert.equal(ownInquiries.json().inquiries.length, 2);
    assert.equal(ownInquiries.json().meta.total, 2);
    assert.ok(ownInquiries.json().inquiries.every((item: { listing: { id: string } }) => item.listing.id));
    const preview = ownInquiries.json().inquiries.find(
      (item: { id: string }) => item.id === firstPublishedInquiry.id,
    );
    assert.equal(preview.listing.images.length, 1);
    assert.equal(preview.listing.images[0].sortOrder, 0);
    assert.equal(typeof preview.listing.images[0].url, "string");
    assert.equal(preview.listing.images[0].objectKey, undefined);

    const queryOverride = await app.inject({
      method: "GET",
      url: `/api/v1/inquiries/me?buyerId=${buyerB.user.id}`,
      headers: authHeaders(buyerA.sessionToken),
    });
    assert.equal(queryOverride.statusCode, 422);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/inquiries/me",
      headers: authHeaders(buyerB.sessionToken),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().inquiries.length, 0);

    const otherRoleInquiries = await app.inject({
      method: "GET",
      url: "/api/v1/inquiries/me",
      headers: authHeaders(administratorBuyer.sessionToken),
    });
    assert.equal(otherRoleInquiries.statusCode, 200);
    assert.equal(otherRoleInquiries.json().inquiries.length, 1);
  });
});

test("seller inquiry status transitions and lifecycle interactions are enforced", async (t) => {
  const seller = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const unconfirmedEmailSeller = await createActor({
    emailVerified: false,
    verificationStatus: VerificationStatus.APPROVED,
  });
  const buyer = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const listing = await createListing(seller.user.id, ListingStatus.PUBLISHED);

  const inquiry = await createTestInquiry({
    listingId: listing.id,
    buyerId: buyer.user.id,
    message: "Can you confirm availability?",
  });

  await t.test("seller with unconfirmed email cannot update inquiry status", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}`,
      headers: authHeaders(unconfirmedEmailSeller.sessionToken),
      payload: { status: "RESPONDED" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_EMAIL_UNVERIFIED");
  });

  await t.test("valid seller transitions succeed", async () => {
    const responded = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}`,
      headers: authHeaders(seller.sessionToken),
      payload: { status: "RESPONDED" },
    });
    assert.equal(responded.statusCode, 200);
    assert.equal(responded.json().inquiry.status, "RESPONDED");

    const closed = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}`,
      headers: authHeaders(seller.sessionToken),
      payload: { status: "CLOSED" },
    });
    assert.equal(closed.statusCode, 200);
    assert.equal(closed.json().inquiry.status, "CLOSED");
  });

  await t.test("illegal transitions are rejected", async () => {
    const repeatedClosed = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}`,
      headers: authHeaders(seller.sessionToken),
      payload: { status: "CLOSED" },
    });
    assert.equal(repeatedClosed.statusCode, 409);

    const respondedInquiry = await createTestInquiry({
      listingId: listing.id,
      buyerId: buyer.user.id,
      message: "Another inquiry.",
      status: "RESPONDED",
    });

    const reopened = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${respondedInquiry.id}`,
      headers: authHeaders(seller.sessionToken),
      payload: { status: "OPEN" },
    });
    assert.equal(reopened.statusCode, 422);

    const invalidResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/listings/${listing.id}/inquiries/${respondedInquiry.id}`,
      headers: authHeaders(seller.sessionToken),
      payload: { status: "RESPONDED" },
    });
    assert.equal(invalidResponse.statusCode, 409);
  });

  await t.test("listing lifecycle does not delete inquiry rows", async () => {
    const lifecycleBuyer = await createActor({ verificationStatus: VerificationStatus.APPROVED });
    const lifecycleSeller = await createActor({ verificationStatus: VerificationStatus.APPROVED });
    const lifecycleListing = await createListing(lifecycleSeller.user.id, ListingStatus.PUBLISHED);
    const lifecycleInquiry = await createTestInquiry({
      listingId: lifecycleListing.id,
      buyerId: lifecycleBuyer.user.id,
      message: "Prior inquiry.",
    });

    for (const nextStatus of [ListingStatus.RESERVED, ListingStatus.SOLD, ListingStatus.REMOVED]) {
      await prisma.listing.update({
        where: { id: lifecycleListing.id },
        data: { status: nextStatus },
      });
      const buyerResponse = await app.inject({
        method: "GET",
        url: "/api/v1/inquiries/me",
        headers: authHeaders(lifecycleBuyer.sessionToken),
      });
      assert.equal(buyerResponse.statusCode, 200);
      assert.ok(buyerResponse.json().inquiries.some((inquiry: { id: string }) => inquiry.id === lifecycleInquiry.id));

      const sellerResponse = await app.inject({
        method: "GET",
        url: `/api/v1/listings/${lifecycleListing.id}/inquiries`,
        headers: authHeaders(lifecycleSeller.sessionToken),
      });
      assert.equal(sellerResponse.statusCode, 200);
      assert.ok(sellerResponse.json().inquiries.some((inquiry: { id: string }) => inquiry.id === lifecycleInquiry.id));
    }
  });
});

test("inquiry conversations enforce participant access, read state, and sender caps", async () => {
  const seller = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const buyer = await createActor();
  const unrelated = await createActor();
  const listing = await createListing(seller.user.id);
  const created = await app.inject({
    method: "POST",
    url: `/api/v1/listings/${listing.id}/inquiries`,
    headers: authHeaders(buyer.sessionToken),
    payload: { message: "Is this still available?" },
  });
  assert.equal(created.statusCode, 201);

  const inquiry = await prisma.listingInquiry.findFirstOrThrow({
    where: { listingId: listing.id, buyerId: buyer.user.id },
  });
  const initialMessage = await prisma.listingInquiryMessage.findFirstOrThrow({
    where: { inquiryId: inquiry.id, sequence: 1 },
  });
  // Mirror migration backfill: legacy read state is unknown, so the sentinel
  // readAt=createdAt must remain unread to the seller until they open it.
  await prisma.listingInquiryMessage.update({
    where: { id: initialMessage.id },
    data: { readAt: initialMessage.createdAt },
  });
  const threadUrl = `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}/messages`;
  const readUrl = `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}/read`;

  const unauthenticated = await app.inject({ method: "GET", url: threadUrl });
  assert.equal(unauthenticated.statusCode, 401);

  const unrelatedRead = await app.inject({
    method: "GET",
    url: threadUrl,
    headers: authHeaders(unrelated.sessionToken),
  });
  assert.equal(unrelatedRead.statusCode, 404);

  const unrelatedSend = await app.inject({
    method: "POST",
    url: threadUrl,
    headers: authHeaders(unrelated.sessionToken),
    payload: { content: "Unauthorized message." },
  });
  assert.equal(unrelatedSend.statusCode, 404);

  const unrelatedMarkRead = await app.inject({
    method: "POST",
    url: readUrl,
    headers: authHeaders(unrelated.sessionToken),
  });
  assert.equal(unrelatedMarkRead.statusCode, 404);

  const buyerThread = await app.inject({
    method: "GET",
    url: threadUrl,
    headers: authHeaders(buyer.sessionToken),
  });
  assert.equal(buyerThread.statusCode, 200);
  assert.equal(buyerThread.json().thread.viewerRole, "BUYER");
  assert.equal(buyerThread.json().thread.messages.length, 1);
  assert.equal(buyerThread.json().thread.messages[0].sender, "BUYER");
  assert.equal(buyerThread.json().thread.messageAllowance.sent, 1);
  assert.equal(buyerThread.json().thread.messageAllowance.remaining, 2);

  const buyerUnreadBeforeReply = await app.inject({
    method: "GET",
    url: "/api/v1/inquiries/unread-summary",
    headers: authHeaders(buyer.sessionToken),
  });
  assert.deepEqual(buyerUnreadBeforeReply.json().summary.buyer, { threads: 0, messages: 0 });

  const initialUnread = await app.inject({
    method: "GET",
    url: "/api/v1/inquiries/unread-summary",
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(initialUnread.statusCode, 200, JSON.stringify(getSafeResponseDiagnostics(initialUnread)));
  assert.deepEqual(initialUnread.json().summary.seller, { threads: 1, messages: 1 });
  const sellerThreadBeforeRead = await app.inject({
    method: "GET",
    url: threadUrl,
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(sellerThreadBeforeRead.statusCode, 200);
  assert.equal(sellerThreadBeforeRead.json().thread.unreadMessageCount, 1);

  const sellerRead = await app.inject({
    method: "POST",
    url: readUrl,
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(sellerRead.statusCode, 200);
  assert.equal(sellerRead.json().updatedCount, 1);
  const readInitialMessage = await prisma.listingInquiryMessage.findUniqueOrThrow({
    where: { id: initialMessage.id },
    select: { createdAt: true, readAt: true },
  });
  assert.ok(readInitialMessage.readAt);
  assert.ok(readInitialMessage.readAt.getTime() > readInitialMessage.createdAt.getTime());

  const sellerUnreadAfterRead = await app.inject({
    method: "GET",
    url: "/api/v1/inquiries/unread-summary",
    headers: authHeaders(seller.sessionToken),
  });
  assert.deepEqual(sellerUnreadAfterRead.json().summary.seller, { threads: 0, messages: 0 });

  for (const payload of [
    { content: "" },
    { content: "   " },
    { content: "x".repeat(2001) },
    { content: "Valid text", sender: "BUYER" },
  ]) {
    const invalidMessage = await app.inject({
      method: "POST",
      url: threadUrl,
      headers: authHeaders(seller.sessionToken),
      payload,
    });
    assert.equal(invalidMessage.statusCode, 422);
  }

  const sellerReplies = await Promise.all(
    Array.from({ length: 4 }, (_, index) => app.inject({
      method: "POST",
      url: threadUrl,
      headers: authHeaders(seller.sessionToken),
      payload: { content: `Seller reply ${index + 1}` },
    })),
  );
  const persistedSellerMessageCount = await prisma.listingInquiryMessage.count({
    where: { inquiryId: inquiry.id, sender: "SELLER" },
  });
  const sellerReplyDiagnostics = sellerReplies.map((response) => {
    return getSafeResponseDiagnostics(response);
  });
  const concurrencyDiagnostics = JSON.stringify({
    responses: sellerReplyDiagnostics,
    persistedSellerMessageCount,
  });
  assert.equal(sellerReplies.filter((response) => response.statusCode === 201).length, 3, concurrencyDiagnostics);
  assert.equal(sellerReplies.filter((response) => response.statusCode === 409).length, 1, concurrencyDiagnostics);
  assert.ok(sellerReplies.some((response) => response.json().error?.code === "INQUIRY_MESSAGE_LIMIT_REACHED"));
  assert.equal(persistedSellerMessageCount, 3, concurrencyDiagnostics);

  const responded = await prisma.listingInquiry.findUniqueOrThrow({
    where: { id: inquiry.id },
    select: { status: true },
  });
  assert.equal(responded.status, "RESPONDED");

  const buyerUnread = await app.inject({
    method: "GET",
    url: "/api/v1/inquiries/unread-summary",
    headers: authHeaders(buyer.sessionToken),
  });
  assert.deepEqual(buyerUnread.json().summary.buyer, { threads: 1, messages: 3 });

  const buyerRead = await app.inject({
    method: "POST",
    url: readUrl,
    headers: authHeaders(buyer.sessionToken),
  });
  assert.equal(buyerRead.statusCode, 200);
  assert.equal(buyerRead.json().updatedCount, 3);

  const buyerReplies = await Promise.all([
    app.inject({
      method: "POST",
      url: threadUrl,
      headers: authHeaders(buyer.sessionToken),
      payload: { content: "Buyer follow-up one" },
    }),
    app.inject({
      method: "POST",
      url: threadUrl,
      headers: authHeaders(buyer.sessionToken),
      payload: { content: "Buyer follow-up two" },
    }),
  ]);
  assert.ok(buyerReplies.every((response) => response.statusCode === 201));

  const buyerLimit = await app.inject({
    method: "POST",
    url: threadUrl,
    headers: authHeaders(buyer.sessionToken),
    payload: { content: "Buyer follow-up three" },
  });
  assert.equal(buyerLimit.statusCode, 409);
  assert.equal(buyerLimit.json().error.code, "INQUIRY_MESSAGE_LIMIT_REACHED");

  const closed = await app.inject({
    method: "PATCH",
    url: `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}`,
    headers: authHeaders(seller.sessionToken),
    payload: { status: "CLOSED" },
  });
  assert.equal(closed.statusCode, 200);

  const closedThreadSend = await app.inject({
    method: "POST",
    url: threadUrl,
    headers: authHeaders(seller.sessionToken),
    payload: { content: "This must not be sent." },
  });
  assert.equal(closedThreadSend.statusCode, 409);
  assert.equal(closedThreadSend.json().error.code, "INQUIRY_CLOSED");
});

test("withdrawing a published listing preserves history and blocks public access", async () => {
  const seller = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const buyer = await createActor({ verificationStatus: VerificationStatus.APPROVED });
  const listing = await createListing(seller.user.id, ListingStatus.PUBLISHED);
  const objectKey = createListingObjectKey(listing.id, "image/png");
  await prisma.listingImage.create({
    data: {
      listingId: listing.id,
      objectKey,
      sortOrder: 0,
      processingStatus: "READY",
    },
  });

  const inquiryUrl = `/api/v1/listings/${listing.id}/inquiries`;
  const createdInquiry = await app.inject({
    method: "POST",
    url: inquiryUrl,
    headers: authHeaders(buyer.sessionToken),
    payload: { message: "Please let me know if this is available." },
  });
  assert.equal(createdInquiry.statusCode, 201);

  const removal = await app.inject({
    method: "DELETE",
    url: `/api/v1/listings/${listing.id}`,
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(removal.statusCode, 200);
  assert.equal(removal.json().listing.status, ListingStatus.REMOVED);

  assert.equal(
    await prisma.listingImage.count({ where: { listingId: listing.id } }),
    1,
  );
  assert.equal(
    await prisma.listingInquiry.count({ where: { listingId: listing.id } }),
    1,
  );

  const feed = await app.inject({
    method: "GET",
    url: "/api/v1/listings?page=1&pageSize=20",
  });
  assert.equal(feed.statusCode, 200);
  assert.equal(
    feed.json().items.some((item: { id: string }) => item.id === listing.id),
    false,
  );

  const detail = await app.inject({
    method: "GET",
    url: `/api/v1/listings/${listing.id}`,
  });
  assert.equal(detail.statusCode, 404);

  const newInquiry = await app.inject({
    method: "POST",
    url: inquiryUrl,
    headers: authHeaders(buyer.sessionToken),
    payload: { message: "A new inquiry after withdrawal." },
  });
  assert.equal(newInquiry.statusCode, 404);
  assert.equal(
    await prisma.listingInquiry.count({ where: { listingId: listing.id } }),
    1,
  );
});
