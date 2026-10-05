import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingStatus,
  Role,
  VerificationMethod,
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
const { resend } = await import("../src/lib/email.js");
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { authenticate, createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");
const { expectedMutStudentEmail, isExpectedMutStudentEmail } = await import("../src/modules/verification/verification.utils.js");
const { submitVerification, verifyUniversityEmailToken } = await import("../src/modules/verification/verification.service.js");
const { AppError } = await import("../src/app/errors.js");
const app = buildApp();

type ActorOptions = {
  role?: Role;
  hasProfile?: boolean;
  verificationStatus?: VerificationStatus;
  accountStatus?: AccountStatus;
};

const actorIds: string[] = [];
let categoryId: string;
let emailSequence = 0;

async function createActor(options: ActorOptions = {}) {
  const email = `phase2-verification-${Date.now()}-${++emailSequence}@example.test`;
  const password = "phase2-test-password-123";
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword(password),
      role: options.role ?? Role.STUDENT,
      accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
    },
  });
  actorIds.push(user.id);

  let verificationId: string | undefined;
  if (options.hasProfile !== false) {
    const profile = await prisma.studentProfile.create({
      data: {
        userId: user.id,
        displayName: "Phase 2 Test Student",
        verificationStatus: options.verificationStatus ?? VerificationStatus.PENDING,
      },
    });

    if (options.verificationStatus) {
      const verification = await prisma.verification.create({
        data: {
          userId: user.id,
          studentProfileId: profile.id,
          method: VerificationMethod.MANUAL_STUDENT,
          status: options.verificationStatus,
        },
      });
      verificationId = verification.id;
    }
  }

  const sessionToken = createOpaqueToken();
  await createSession(user.id, hashToken(sessionToken), {});
  return { user, email, password, sessionToken, verificationId };
}

function authHeaders(sessionToken: string) {
  return { cookie: `${env.SESSION_COOKIE_NAME}=${sessionToken}` };
}

function createListingPayload() {
  return {
    categoryId,
    title: "Test listing",
    description: "A listing used to test the seller authorization boundary.",
    price: 10,
    condition: "GOOD",
    location: "Campus",
  };
}

function collectObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectObjectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, nested]) => [key, ...collectObjectKeys(nested)]);
}

async function createDraftListing(sellerId: string) {
  return prisma.listing.create({
    data: {
      sellerId,
      categoryId,
      title: "Draft for authorization test",
      description: "A listing used to test the seller authorization boundary.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
    },
  });
}

before(async () => {
  await app.ready();
  const category = await prisma.category.create({
    data: {
      name: `Phase 2 test category ${Date.now()}`,
      slug: `phase2-test-${Date.now()}`,
    },
  });
  categoryId = category.id;
});

after(async () => {
  if (actorIds.length > 0) {
    const ids = actorIds;
    await prisma.listing.deleteMany({ where: { sellerId: { in: ids } } });
    await prisma.emailVerificationToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.verification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await app.close();
});

test("seller authorization is enforced by listing services for each verification state", async (t) => {
  await t.test("unverified users can log in and use normal authenticated routes, but cannot sell", async () => {
    const actor = await createActor({ hasProfile: false });
    const login = await authenticate({
      email: actor.email,
      identifier: undefined,
      password: actor.password,
    });
    assert.equal(login.user.email, actor.email);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(me.statusCode, 200);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload: createListingPayload(),
    });
    assert.equal(create.statusCode, 403);
    assert.equal(create.json().error.code, "SELLER_VERIFICATION_REQUIRED");

    const draft = await createDraftListing(actor.user.id);
    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${draft.id}/publish`,
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(publish.statusCode, 403);
    assert.equal(publish.json().error.code, "SELLER_VERIFICATION_REQUIRED");
  });

  for (const status of [VerificationStatus.PENDING, VerificationStatus.REJECTED]) {
    await t.test(`${status} users cannot create or publish listings`, async () => {
      const actor = await createActor({ verificationStatus: status });
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/listings",
        headers: authHeaders(actor.sessionToken),
        payload: createListingPayload(),
      });
      assert.equal(create.statusCode, 403);
      assert.equal(create.json().error.code, "SELLER_VERIFICATION_REQUIRED");

      const draft = await createDraftListing(actor.user.id);
      const publish = await app.inject({
        method: "POST",
        url: `/api/v1/listings/${draft.id}/publish`,
        headers: authHeaders(actor.sessionToken),
      });
      assert.equal(publish.statusCode, 403);
      assert.equal(publish.json().error.code, "SELLER_VERIFICATION_REQUIRED");
    });
  }

  await t.test("APPROVED users can create and publish listings", async () => {
    const actor = await createActor({ verificationStatus: VerificationStatus.APPROVED });
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload: createListingPayload(),
    });
    assert.equal(create.statusCode, 201);
    const listingId = create.json().listing.id as string;

    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/publish`,
      headers: authHeaders(actor.sessionToken),
      payload: { status: ListingStatus.SOLD },
    });
    assert.equal(publish.statusCode, 200);
    assert.equal(publish.json().listing.status, ListingStatus.PUBLISHED);

    const republish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/publish`,
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(republish.statusCode, 409);

    const anotherSeller = await createActor({
      verificationStatus: VerificationStatus.APPROVED,
    });
    const anotherDraft = await createDraftListing(actor.user.id);
    const nonOwnerPublish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${anotherDraft.id}/publish`,
      headers: authHeaders(anotherSeller.sessionToken),
    });
    assert.equal(nonOwnerPublish.statusCode, 403);

    const status = await app.inject({
      method: "GET",
      url: "/api/v1/verification/me",
      headers: authHeaders(actor.sessionToken),
    });
    assert.deepEqual(Object.keys(status.json()).sort(), ["maySell", "method", "status", "verified"]);
    assert.equal(status.json().maySell, true);
    assert.equal(status.json().status, "APPROVED");

    const authMe = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal("studentProfile" in authMe.json().user, false);
    assert.equal("verificationStatus" in authMe.json().user, false);
    assert.equal(status.json().maySell, true);

    const publicListings = await app.inject({
      method: "GET",
      url: "/api/v1/listings",
    });
    const publicKeys = collectObjectKeys(publicListings.json());
    for (const forbiddenField of [
      "registrationNumber",
      "registrationNumberCiphertext",
      "registrationNumberHash",
      "universityEmail",
      "verificationToken",
      "reviewedBy",
      "reason",
      "documentPath",
      "documentUrl",
    ]) {
      assert.equal(publicKeys.includes(forbiddenField), false);
    }
  });
});

test("public listing route returns published listings without authentication", async () => {
  const seller = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const listingByStatus = new Map<ListingStatus, string>();

  for (const status of Object.values(ListingStatus)) {
    const draft = await createDraftListing(seller.user.id);
    listingByStatus.set(status, draft.id);
    if (status !== ListingStatus.DRAFT) {
      await prisma.listing.update({
        where: { id: draft.id },
        data: { status },
      });
    }
  }

  const response = await app.inject({
    method: "GET",
    url: "/api/v1/listings",
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  const returnedIds = new Set(body.items.map((listing: { id: string }) => listing.id));
  assert.equal(returnedIds.has(listingByStatus.get(ListingStatus.PUBLISHED)), true);
  for (const [status, id] of listingByStatus) {
    if (status !== ListingStatus.PUBLISHED) {
      assert.equal(returnedIds.has(id), false, `${status} listing must not be public`);
    }
  }
  assert.deepEqual(body.items, body.listings);
  assert.equal(body.meta.page, 1);
});

test("public listing detail only returns published listings and safe seller fields", async () => {
  const seller = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const listingByStatus = new Map<ListingStatus, string>();

  for (const status of Object.values(ListingStatus)) {
    const listing = await createDraftListing(seller.user.id);
    listingByStatus.set(status, listing.id);
    if (status !== ListingStatus.DRAFT) {
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status },
      });
    }
  }

  const responses = new Map<ListingStatus, Awaited<ReturnType<typeof app.inject>>>();
  for (const [status, id] of listingByStatus) {
    responses.set(status, await app.inject({
      method: "GET",
      url: `/api/v1/listings/${id}`,
    }));
  }

  const published = responses.get(ListingStatus.PUBLISHED);
  assert.equal(published?.statusCode, 200);
  const body = published?.json();
  assert.equal(body.listing.status, ListingStatus.PUBLISHED);
  assert.deepEqual(Object.keys(body.listing.seller).sort(), ["name", "verified"]);
  assert.equal(body.listing.seller.name, "Phase 2 Test Student");
  assert.equal(body.listing.seller.verified, true);

  for (const [status, response] of responses) {
    if (status === ListingStatus.PUBLISHED) continue;
    assert.equal(response.statusCode, 404, `${status} listing must not be public`);
    assert.equal(response.json().error.code, "LISTING_NOT_FOUND");
    assert.deepEqual(response.json(), {
      error: {
        code: "LISTING_NOT_FOUND",
        message: "Listing not found or is no longer available.",
      },
    });
  }

  const nonexistent = await app.inject({
    method: "GET",
    url: "/api/v1/listings/00000000-0000-4000-8000-000000000000",
  });
  assert.equal(nonexistent.statusCode, 404);
  assert.deepEqual(nonexistent.json(), responses.get(ListingStatus.DRAFT)?.json());
});

test("listing updates require a verified active owner and reject protected fields", async (t) => {
  const verifiedOwner = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const listing = await createDraftListing(verifiedOwner.user.id);
  const updateUrl = `/api/v1/listings/${listing.id}`;

  await t.test("unauthenticated update is denied", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: updateUrl,
      payload: { title: "Updated title" },
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("unverified update is denied", async () => {
    const unverified = await createActor({ hasProfile: false });
    const response = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(unverified.sessionToken),
      payload: { title: "Updated title" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_VERIFICATION_REQUIRED");
  });

  for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
    await t.test(`${accountStatus} account update is denied`, async () => {
      const suspended = await createActor({
        accountStatus,
        verificationStatus: VerificationStatus.APPROVED,
      });
      const response = await app.inject({
        method: "PATCH",
        url: updateUrl,
        headers: authHeaders(suspended.sessionToken),
        payload: { title: "Updated title" },
      });
      assert.equal(response.statusCode, 401);
    });
  }

  await t.test("verified owner can update editable fields without changing status", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(verifiedOwner.sessionToken),
      payload: { title: "Updated title", price: 25 },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().listing.title, "Updated title");
    assert.equal(response.json().listing.price, "25");
    assert.equal(response.json().listing.status, ListingStatus.DRAFT);
    assert.equal("sellerId" in response.json().listing, false);
    const persisted = await prisma.listing.findUnique({ where: { id: listing.id } });
    assert.equal(persisted?.sellerId, verifiedOwner.user.id);
  });

  await t.test("another verified student cannot update the listing", async () => {
    const otherSeller = await createActor({
      verificationStatus: VerificationStatus.APPROVED,
    });
    const response = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(otherSeller.sessionToken),
      payload: { title: "Not allowed" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "FORBIDDEN");
  });

  await t.test("client-supplied ownership and protected fields are rejected", async () => {
    for (const payload of [
      { title: "Spoofed owner", sellerId: verifiedOwner.user.id },
      { title: "Spoofed owner", sellerId: "00000000-0000-4000-8000-000000000000" },
      { status: ListingStatus.PUBLISHED },
      { id: "00000000-0000-4000-8000-000000000000" },
      { publishedAt: new Date().toISOString() },
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: updateUrl,
        headers: authHeaders(verifiedOwner.sessionToken),
        payload,
      });
      assert.equal(response.statusCode, 422);
      assert.equal(response.json().error.code, "VALIDATION_ERROR");
    }

    const persisted = await prisma.listing.findUnique({ where: { id: listing.id } });
    assert.equal(persisted?.sellerId, verifiedOwner.user.id);
    assert.equal(persisted?.status, ListingStatus.DRAFT);
  });

  await t.test("invalid editable fields are rejected", async () => {
    for (const payload of [
      { title: "" },
      { price: -1 },
      { condition: "BROKEN" },
      { categoryId: "not-a-uuid" },
      {},
    ]) {
      const response = await app.inject({
        method: "PATCH",
        url: updateUrl,
        headers: authHeaders(verifiedOwner.sessionToken),
        payload,
      });
      assert.equal(response.statusCode, 422);
    }
  });

  await t.test("only the existing draft-to-published transition is supported", async () => {
    const publish = await app.inject({
      method: "POST",
      url: `${updateUrl}/publish`,
      headers: authHeaders(verifiedOwner.sessionToken),
    });
    assert.equal(publish.statusCode, 200);
    assert.equal(publish.json().listing.status, ListingStatus.PUBLISHED);

    const republish = await app.inject({
      method: "POST",
      url: `${updateUrl}/publish`,
      headers: authHeaders(verifiedOwner.sessionToken),
    });
    assert.equal(republish.statusCode, 409);

    const unsupportedTransition = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(verifiedOwner.sessionToken),
      payload: { status: ListingStatus.RESERVED },
    });
    assert.equal(unsupportedTransition.statusCode, 422);
  });
});

test("listing removal requires a verified active owner and uses soft removal", async (t) => {
  const owner = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });
  const listing = await createDraftListing(owner.user.id);
  const removeUrl = `/api/v1/listings/${listing.id}`;

  await t.test("unauthenticated removal is denied", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: removeUrl,
    });
    assert.equal(response.statusCode, 401);
  });

  await t.test("unverified seller removal is denied", async () => {
    const unverified = await createActor({ hasProfile: false });
    const response = await app.inject({
      method: "DELETE",
      url: removeUrl,
      headers: authHeaders(unverified.sessionToken),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_VERIFICATION_REQUIRED");
  });

  for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
    await t.test(`${accountStatus} account removal is denied`, async () => {
      const inactiveSeller = await createActor({
        accountStatus,
        verificationStatus: VerificationStatus.APPROVED,
      });
      const response = await app.inject({
        method: "DELETE",
        url: removeUrl,
        headers: authHeaders(inactiveSeller.sessionToken),
      });
      assert.equal(response.statusCode, 401);
    });
  }

  await t.test("another verified student cannot remove the listing", async () => {
    const otherSeller = await createActor({
      verificationStatus: VerificationStatus.APPROVED,
    });
    const response = await app.inject({
      method: "DELETE",
      url: removeUrl,
      headers: authHeaders(otherSeller.sessionToken),
      payload: { sellerId: owner.user.id },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "FORBIDDEN");
    assert.equal(
      (await prisma.listing.findUnique({ where: { id: listing.id } }))?.status,
      ListingStatus.DRAFT,
    );
  });

  await t.test("owner removal marks the listing REMOVED without deleting it", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: removeUrl,
      headers: authHeaders(owner.sessionToken),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().listing.status, ListingStatus.REMOVED);

    const persisted = await prisma.listing.findUnique({ where: { id: listing.id } });
    assert.ok(persisted);
    assert.equal(persisted.status, ListingStatus.REMOVED);

    const repeatedRemoval = await app.inject({
      method: "DELETE",
      url: removeUrl,
      headers: authHeaders(owner.sessionToken),
    });
    assert.equal(repeatedRemoval.statusCode, 409);
  });
});

test("listing creation requires an active, verified student session", async (t) => {
  const payload = createListingPayload();

  const unauthenticated = await app.inject({
    method: "POST",
    url: "/api/v1/listings",
    payload,
  });
  assert.equal(unauthenticated.statusCode, 401);

  for (const accountStatus of [AccountStatus.SUSPENDED, AccountStatus.DISABLED]) {
    await t.test(`${accountStatus} account cannot create a listing`, async () => {
      const actor = await createActor({
        accountStatus,
        verificationStatus: VerificationStatus.APPROVED,
      });
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/listings",
        headers: authHeaders(actor.sessionToken),
        payload,
      });
      assert.equal(response.statusCode, 401);
    });
  }

  await t.test("approved non-student account cannot create a listing", async () => {
    const actor = await createActor({
      role: Role.ADMINISTRATOR,
      verificationStatus: VerificationStatus.APPROVED,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload,
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_VERIFICATION_REQUIRED");
  });
});

test("listing creation rejects malformed fields and client-supplied ownership", async () => {
  const actor = await createActor({
    verificationStatus: VerificationStatus.APPROVED,
  });

  for (const payload of [
    { ...createListingPayload(), title: "" },
    { ...createListingPayload(), sellerId: actor.user.id },
    { ...createListingPayload(), categoryId: "not-a-uuid" },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload,
    });
    assert.equal(response.statusCode, 422);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  }
});

test("client-supplied seller or verification claims cannot bypass authorization", async () => {
  const actor = await createActor({ hasProfile: false });
  const fakeClaims = {
    verified: true,
    isSeller: true,
    verificationStatus: "APPROVED",
    role: "ADMINISTRATOR",
  };
  const create = await app.inject({
    method: "POST",
    url: "/api/v1/listings",
    headers: authHeaders(actor.sessionToken),
    payload: { ...createListingPayload(), ...fakeClaims },
  });
  assert.notEqual(create.statusCode, 201);

  const draft = await createDraftListing(actor.user.id);
  const publish = await app.inject({
    method: "POST",
    url: `/api/v1/listings/${draft.id}/publish`,
    headers: authHeaders(actor.sessionToken),
    payload: fakeClaims,
  });
  assert.equal(publish.statusCode, 403);
  assert.equal(publish.json().error.code, "SELLER_VERIFICATION_REQUIRED");
});

test("manual verification reviews require moderator/admin authorization and forbid self-review", async (t) => {
  const student = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const studentReview = await app.inject({
    method: "POST",
    url: `/api/v1/moderation/verifications/${student.verificationId}/review`,
    headers: authHeaders(student.sessionToken),
    payload: { status: "APPROVED", reason: "Attempted self approval." },
  });
  assert.equal(studentReview.statusCode, 403);

  const moderator = await createActor({ role: Role.MODERATOR, hasProfile: false });
  const moderatorTarget = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const moderatorApproval = await app.inject({
    method: "POST",
    url: `/api/v1/moderation/verifications/${moderatorTarget.verificationId}/review`,
    headers: authHeaders(moderator.sessionToken),
    payload: { status: "APPROVED", reason: "Reviewed by moderator." },
  });
  assert.equal(moderatorApproval.statusCode, 200);

  const administrator = await createActor({ role: Role.ADMINISTRATOR, hasProfile: false });
  const adminTarget = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const adminApproval = await app.inject({
    method: "POST",
    url: `/api/v1/moderation/verifications/${adminTarget.verificationId}/review`,
    headers: authHeaders(administrator.sessionToken),
    payload: { status: "REJECTED", reason: "Reviewed by administrator." },
  });
  assert.equal(adminApproval.statusCode, 200);

  const ownPending = await createActor({ role: Role.MODERATOR, verificationStatus: VerificationStatus.PENDING });
  const selfReview = await app.inject({
    method: "POST",
    url: `/api/v1/moderation/verifications/${ownPending.verificationId}/review`,
    headers: authHeaders(ownPending.sessionToken),
    payload: { status: "APPROVED", reason: "Attempted self approval." },
  });
  assert.equal(selfReview.statusCode, 403);
});

test("university email verification proves the expected registration-number mailbox", async () => {
  const actor = await createActor();
  const messages: Array<{ to: string; html: string }> = [];
  const originalSend = resend.emails.send;
  resend.emails.send = async (payload) => {
    messages.push({
      to: Array.isArray(payload.to) ? payload.to[0] : payload.to,
      html: typeof payload.html === "string" ? payload.html : "",
    });
    return { data: { id: "test-email-id" }, error: null } as never;
  };

  try {
    assert.equal(expectedMutStudentEmail("sc201/3038/2023"), "sc20130382023@student.mut.ac.ke");
    assert.equal(isExpectedMutStudentEmail("sc201/3038/2023", "anything@student.mut.ac.ke"), false);
    assert.equal(isExpectedMutStudentEmail("sc201 / 3038 / 2023", "SC20130382023@STUDENT.MUT.AC.KE"), true);

    await assert.rejects(
      () => submitVerification(actor.user.id, {
        method: VerificationMethod.UNIVERSITY_EMAIL,
        registrationNumber: "sc201/3038/2023",
        email: "anything@student.mut.ac.ke",
      }),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_STUDENT_EMAIL",
    );
    assert.equal(messages.length, 0);

    await submitVerification(actor.user.id, {
      method: VerificationMethod.UNIVERSITY_EMAIL,
      registrationNumber: "sc201 / 3038 / 2023",
      email: "SC20130382023@STUDENT.MUT.AC.KE",
    });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, "sc20130382023@student.mut.ac.ke");
    const encodedToken = messages[0].html.match(/token=([^&"]+)/)?.[1];
    assert.ok(encodedToken);
    const token = decodeURIComponent(encodedToken);

    const accountToken = createOpaqueToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: actor.user.id,
        tokenHash: hashToken(accountToken),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await assert.rejects(
      () => verifyUniversityEmailToken(accountToken),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_VERIFICATION_TOKEN",
    );
    const { verifyEmail } = await import("../src/modules/auth/auth.service.js");
    await verifyEmail(accountToken);

    await assert.rejects(
      () => verifyEmail(token),
      (error: unknown) => error instanceof AppError && error.code === "INVALID_VERIFICATION_TOKEN",
    );

    const verifiedByEmail = await app.inject({
      method: "POST",
      url: "/api/v1/verification/verify-email",
      payload: { token },
    });
    assert.equal(verifiedByEmail.statusCode, 204);
    assert.equal(verifiedByEmail.body, "");
    const state = await prisma.studentProfile.findUnique({
      where: { userId: actor.user.id },
      select: { verificationStatus: true, registrationNumberCiphertext: true },
    });
    assert.equal(state?.verificationStatus, VerificationStatus.APPROVED);
    assert.notEqual(state?.registrationNumberCiphertext, "sc20130382023");
  } finally {
    resend.emails.send = originalSend;
  }
});
