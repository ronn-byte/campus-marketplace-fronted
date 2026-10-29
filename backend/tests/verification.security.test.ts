import { randomInt, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingStatus,
  Role,
  VerificationMethod,
  VerificationStatus,
} from "@prisma/client";
import { MAX_LISTING_PRICE } from "../src/modules/listings/listing.schemas.js";

import "../scripts/test-database.js";

process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
process.env.STUDENT_DATA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");

const { createListingObjectKey } = await import("../src/lib/storage.js");
const { deleteListingImageFiles } = await import("../src/lib/storage.js");
const { addListingImages, removeListingImage } = await import("../src/modules/listings/listing.service.js");
const sharp = (await import("sharp")).default;
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
  emailVerified?: boolean;
  profileComplete?: boolean;
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
      emailVerifiedAt: options.emailVerified === false ? null : new Date(),
      ...(options.profileComplete === false
        ? {}
        : { profile: { create: { nickname: "Phase 2 Seller", course: "Computer Science" } } }),
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

async function createReadyListingImage(listingId: string) {
  return prisma.listingImage.create({
    data: {
      listingId,
      objectKey: createListingObjectKey(listingId, "image/png"),
      sortOrder: 0,
      processingStatus: "READY",
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

    await prisma.listingInquiry.deleteMany({
      where: {
        OR: [
          { buyerId: { in: ids } },
          { listing: { sellerId: { in: ids } } },
        ],
      },
    });

    await prisma.listingImage.deleteMany({
      where: {
        listing: {
          sellerId: { in: ids },
        },
      },
    });

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

test("email verification and account eligibility govern seller authorization", async (t) => {
  await t.test("unverified users can log in and browse, but cannot sell", async () => {
    const actor = await createActor({ hasProfile: false, emailVerified: false });
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

    const browse = await app.inject({ method: "GET", url: "/api/v1/listings" });
    assert.equal(browse.statusCode, 200);

    const create = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload: createListingPayload(),
    });
    assert.equal(create.statusCode, 403);
    assert.equal(create.json().error.code, "SELLER_EMAIL_UNVERIFIED");

    const draft = await createDraftListing(actor.user.id);
    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${draft.id}/publish`,
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(publish.statusCode, 403);
    assert.equal(publish.json().error.code, "SELLER_EMAIL_UNVERIFIED");
  });

  for (const status of [VerificationStatus.PENDING, VerificationStatus.REJECTED]) {
    await t.test(`${status} users can create and publish listings after email and profile completion`, async () => {
      const actor = await createActor({ verificationStatus: status });
      const create = await app.inject({
        method: "POST",
        url: "/api/v1/listings",
        headers: authHeaders(actor.sessionToken),
        payload: createListingPayload(),
      });
      assert.equal(create.statusCode, 201);
      const listingId = create.json().listing.id as string;
      await createReadyListingImage(listingId);
      const publish = await app.inject({
        method: "POST",
        url: `/api/v1/listings/${listingId}/publish`,
        headers: authHeaders(actor.sessionToken),
      });
      assert.equal(publish.statusCode, 200);
      assert.equal(publish.json().listing.status, ListingStatus.PUBLISHED);
    });
  }

  await t.test("APPROVED student status is reported but does not gate email-verified selling", async () => {
    const actor = await createActor({ verificationStatus: VerificationStatus.APPROVED });
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload: createListingPayload(),
    });
    assert.equal(create.statusCode, 201);
    const listingId = create.json().listing.id as string;


    const publishWithoutImage = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/publish`,
      headers: authHeaders(actor.sessionToken),
      payload: { status: ListingStatus.SOLD },
    });

    assert.equal(publishWithoutImage.statusCode, 422);
    assert.equal(
      publishWithoutImage.json().error.code,
      "LISTING_IMAGE_REQUIRED",
    );

    await createReadyListingImage(listingId);

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
    assert.equal(status.statusCode, 200, JSON.stringify(status.json()));
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

test("verification status distinguishes an account with no student verification request", async () => {
  const actor = await createActor({ hasProfile: false });
  const response = await app.inject({
    method: "GET",
    url: "/api/v1/verification/me",
    headers: authHeaders(actor.sessionToken),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, null);
  assert.equal(response.json().verified, false);
  assert.equal(response.json().maySell, true);
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

  if (response.statusCode !== 200) {
  console.error("PUBLIC LISTINGS FAILURE:", {
    statusCode: response.statusCode,
    body: response.body,
  });
}

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
  assert.deepEqual(Object.keys(body.listing.seller).sort(), ["avatarUrl", "id", "name", "verified"]);
  assert.equal(body.listing.seller.name, "Phase 2 Seller");
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

test("public listing eligibility and active-category filtering are enforced", async () => {
  const eligible = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const unverified = await createActor({ emailVerified: false });
  const suspended = await createActor({ accountStatus: AccountStatus.SUSPENDED });
  const disabled = await createActor({ accountStatus: AccountStatus.DISABLED });
  const administrator = await createActor({ role: Role.ADMINISTRATOR });
  const visible = await prisma.listing.create({ data: { sellerId: eligible.user.id, ...createListingPayload(), status: ListingStatus.PUBLISHED } });
  const visibleNonStudent = await prisma.listing.create({ data: { sellerId: administrator.user.id, ...createListingPayload(), status: ListingStatus.PUBLISHED } });
  const hidden = await Promise.all([unverified, suspended, disabled].map((actor) =>
    prisma.listing.create({ data: { sellerId: actor.user.id, ...createListingPayload(), status: ListingStatus.PUBLISHED } }),
  ));

  const feed = await app.inject({ method: "GET", url: "/api/v1/listings" });
  assert.equal(feed.statusCode, 200);
  const ids = new Set(feed.json().items.map((item: { id: string }) => item.id));
  assert.equal(ids.has(visible.id), true);
  assert.equal(ids.has(visibleNonStudent.id), true);
  for (const listing of hidden) {
    assert.equal(ids.has(listing.id), false);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/listings/${listing.id}` })).statusCode, 404);
  }

  await prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });
  try {
    const inactiveFeed = await app.inject({ method: "GET", url: "/api/v1/listings" });
    assert.equal(inactiveFeed.statusCode, 200);
    assert.equal(new Set(inactiveFeed.json().items.map((item: { id: string }) => item.id)).has(visible.id), false);
    assert.equal((await app.inject({ method: "GET", url: `/api/v1/listings/${visible.id}` })).statusCode, 404);
  } finally {
    await prisma.category.update({ where: { id: categoryId }, data: { isActive: true } });
  }
});

test("listing image upload retries are idempotent and reject changed content", async () => {
  const seller = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const listing = await createDraftListing(seller.user.id);
  const batchId = randomUUID();
  const makeImage = (color: string) => sharp({ create: { width: 2, height: 2, channels: 4, background: color } }).png().toBuffer();
  const originalBuffer = await makeImage("red");
  let objectKeys: string[] = [];
  try {
    const [first, retry] = await Promise.all([
      addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer: originalBuffer }], batchId),
      addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer: originalBuffer }], batchId),
    ]);
    assert.equal(first.length, 1);
    assert.equal(retry.length, 1);
    assert.equal(first[0]?.id, retry[0]?.id);
    assert.equal(await prisma.listingImage.count({ where: { listingId: listing.id } }), 1);
    const changedBuffer = await makeImage("blue");
    await assert.rejects(
      () => addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer: changedBuffer }], batchId),
      (error: unknown) => error instanceof AppError && error.code === "UPLOAD_RETRY_MISMATCH",
    );
    assert.equal(await prisma.listingImage.count({ where: { listingId: listing.id } }), 1);
    objectKeys = (await prisma.listingImage.findMany({ where: { listingId: listing.id }, select: { objectKey: true } })).map((image) => image.objectKey);
  } finally {
    if (objectKeys.length) await deleteListingImageFiles(objectKeys);
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

test("post-commit image readback failure preserves committed file and row", async () => {
  const seller = await createActor();
  const listing = await createDraftListing(seller.user.id);
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: "purple" } }).png().toBuffer();
  const delegate = prisma.listingImage as unknown as { findMany: typeof prisma.listingImage.findMany };
  const originalFindMany = delegate.findMany;
  try {
    delegate.findMany = async () => { throw new Error("simulated post-commit readback failure"); };
    await assert.rejects(() => addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer }], randomUUID()), /simulated post-commit readback failure/);
  } finally {
    delegate.findMany = originalFindMany;
  }
  const persisted = await prisma.listingImage.findFirst({ where: { listingId: listing.id }, select: { objectKey: true } });
  try {
    assert.ok(persisted);
    await readFile(path.resolve(process.cwd(), "uploads", ...persisted.objectKey.split("/")));
  } finally {
    if (persisted) await deleteListingImageFiles([persisted.objectKey]);
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

function describeSettledOutcome(outcome: PromiseSettledResult<unknown> | undefined): string {
  try {
    if (!outcome) return "no result";
    if (outcome.status === "fulfilled") return "fulfilled";

    const reason: unknown = outcome.reason;
    if (reason !== null && (typeof reason === "object" || typeof reason === "function")) {
      const readField = (field: string): unknown => {
        try {
          return Reflect.get(reason, field);
        } catch {
          return undefined;
        }
      };
      const formatField = (field: string, fallback: string): string => {
        const value = readField(field);
        if (value === undefined) return fallback;
        try {
          return String(value);
        } catch {
          return "<unprintable>";
        }
      };

      const name = formatField("name", "object");
      const message = formatField("message", "<no message>");
      const codeValue = readField("code");
      const code = codeValue === undefined ? "" : `, code=${formatField("code", "<unprintable>")}`;
      return `rejected: ${name}: ${message}${code}`;
    }

    try {
      return `rejected: ${typeof reason}: ${String(reason)}`;
    } catch {
      return `rejected: ${typeof reason}: <unprintable>`;
    }
  } catch {
    return "rejected: <diagnostic formatting failed>";
  }
}

test("concurrent image uploads respect the listing image cap", async () => {
  const seller = await createActor();
  const listing = await createDraftListing(seller.user.id);
  await prisma.listingImage.createMany({ data: Array.from({ length: 7 }, (_, sortOrder) => ({
    listingId: listing.id, objectKey: createListingObjectKey(listing.id, "image/png"), sortOrder, processingStatus: "READY" as const,
  })) });
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: "green" } }).png().toBuffer();
  try {
    const outcomes = await Promise.allSettled([
      addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer }], randomUUID()),
      addListingImages(listing.id, seller.user.id, [{ mimetype: "image/png", buffer }], randomUUID()),
    ]);
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
      `Expected one upload to succeed; outcomes: ${outcomes.map(describeSettledOutcome).join(" | ")}`,
    );
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    assert.ok(
      rejected && rejected.status === "rejected",
      `Expected one rejected upload; outcomes: ${outcomes.map(describeSettledOutcome).join(" | ")}`,
    );
    assert.ok(rejected.reason instanceof AppError, describeSettledOutcome(rejected));
    assert.equal(rejected.reason.code, "VALIDATION_ERROR", describeSettledOutcome(rejected));
    assert.equal(await prisma.listingImage.count({ where: { listingId: listing.id } }), 8);
  } finally {
    const images = await prisma.listingImage.findMany({ where: { listingId: listing.id }, select: { objectKey: true } });
    await deleteListingImageFiles(images.map((image) => image.objectKey));
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

test("image removal preserves ownership, soft history, files, and active ordering", async () => {
  const owner = await createActor();
  const other = await createActor();
  const unverified = await createActor({ emailVerified: false });
  const listing = await createDraftListing(owner.user.id);
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: "orange" } }).png().toBuffer();
  const objectKeys: string[] = [];
  try {
    const [first] = await addListingImages(listing.id, owner.user.id, [{ mimetype: "image/png", buffer }], randomUUID());
    const [second] = await addListingImages(listing.id, owner.user.id, [{ mimetype: "image/png", buffer }], randomUUID());
    assert.ok(first && second);
    objectKeys.push(first.objectKey, second.objectKey);
    await assert.rejects(() => addListingImages(listing.id, unverified.user.id, [{ mimetype: "image/png", buffer }], randomUUID()),
      (error: unknown) => error instanceof AppError && error.code === "SELLER_EMAIL_UNVERIFIED");
    const uploadDenied = await app.inject({
      method: "POST", url: `/api/v1/listings/${listing.id}/images`, headers: authHeaders(unverified.sessionToken),
    });
    assert.equal(uploadDenied.statusCode, 403);
    assert.equal(uploadDenied.json().error.code, "SELLER_EMAIL_UNVERIFIED");
    const publish = await app.inject({ method: "POST", url: `/api/v1/listings/${listing.id}/publish`, headers: authHeaders(owner.sessionToken) });
    assert.equal(publish.statusCode, 200);
    const imageUrl = `/api/v1/listings/${listing.id}/images/${first.id}`;
    assert.equal((await app.inject({ method: "DELETE", url: imageUrl, headers: authHeaders(other.sessionToken) })).statusCode, 403);
    const denied = await app.inject({ method: "DELETE", url: imageUrl, headers: authHeaders(unverified.sessionToken) });
    assert.equal(denied.statusCode, 403);
    assert.equal(denied.json().error.code, "SELLER_EMAIL_UNVERIFIED");
    assert.equal((await app.inject({ method: "DELETE", url: imageUrl, headers: authHeaders(owner.sessionToken) })).statusCode, 200);
    const historical = await prisma.listingImage.findUnique({ where: { id: first.id }, select: { removedAt: true, objectKey: true } });
    assert.ok(historical?.removedAt);
    await readFile(path.resolve(process.cwd(), "uploads", ...first.objectKey.split("/")));
    const edit = await app.inject({ method: "GET", url: `/api/v1/listings/${listing.id}/edit`, headers: authHeaders(owner.sessionToken) });
    assert.deepEqual(edit.json().listing.images.map((image: { id: string }) => image.id), [second.id]);
    const publicDetail = await app.inject({ method: "GET", url: `/api/v1/listings/${listing.id}` });
    assert.deepEqual(publicDetail.json().listing.images.map((image: { id: string }) => image.id), [second.id]);
    const publicFeed = await app.inject({ method: "GET", url: `/api/v1/listings?categoryId=${categoryId}` });
    assert.deepEqual(publicFeed.json().items.find((item: { id: string }) => item.id === listing.id)?.images.map((image: { id: string }) => image.id), [second.id]);
    const sellerFeed = await app.inject({ method: "GET", url: "/api/v1/listings/me", headers: authHeaders(owner.sessionToken) });
    assert.deepEqual(sellerFeed.json().items.find((item: { id: string }) => item.id === listing.id)?.images.map((image: { id: string }) => image.id), [second.id]);
    const [third] = await addListingImages(listing.id, owner.user.id, [{ mimetype: "image/png", buffer }], randomUUID());
    assert.ok(third);
    objectKeys.push(third.objectKey);
    const rows = await prisma.listingImage.findMany({ where: { listingId: listing.id }, orderBy: { sortOrder: "asc" }, select: { sortOrder: true, removedAt: true } });
    assert.deepEqual(rows.map((image) => image.sortOrder), [0, 1, 2]);
    assert.equal(rows.filter((image) => image.removedAt === null).length, 2);
    assert.equal(rows.length, 3);
  } finally {
    await deleteListingImageFiles(objectKeys);
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

test("concurrent image removal and upload preserve image-count and sort invariants", async () => {
  const owner = await createActor();
  const listing = await createDraftListing(owner.user.id);
  const seeded = await prisma.listingImage.createManyAndReturn({ data: Array.from({ length: 8 }, (_, sortOrder) => ({
    listingId: listing.id, objectKey: createListingObjectKey(listing.id, "image/png"), sortOrder, processingStatus: "READY" as const,
  })) });
  const buffer = await sharp({ create: { width: 2, height: 2, channels: 4, background: "teal" } }).png().toBuffer();
  try {
    const outcomes = await Promise.allSettled([
      removeListingImage(listing.id, seeded[0]!.id, owner.user.id),
      addListingImages(listing.id, owner.user.id, [{ mimetype: "image/png", buffer }], randomUUID()),
    ]);
    assert.equal(
      outcomes[0]?.status,
      "fulfilled",
      `Image removal outcome: ${describeSettledOutcome(outcomes[0])}`,
    );
    if (outcomes[1]?.status === "rejected") {
      assert.ok(outcomes[1].reason instanceof AppError, describeSettledOutcome(outcomes[1]));
      assert.equal(outcomes[1].reason.code, "VALIDATION_ERROR", describeSettledOutcome(outcomes[1]));
    }
    const rows = await prisma.listingImage.findMany({ where: { listingId: listing.id }, orderBy: { sortOrder: "asc" }, select: { objectKey: true, sortOrder: true, removedAt: true } });
    assert.ok(rows.filter((image) => image.removedAt === null).length <= 8);
    assert.equal(new Set(rows.map((image) => image.sortOrder)).size, rows.length);
    await deleteListingImageFiles(rows.map((image) => image.objectKey));
  } finally {
    await prisma.listingImage.deleteMany({ where: { listingId: listing.id } });
    await prisma.listing.delete({ where: { id: listing.id } });
  }
});

test("listing updates require an email-verified active owner and reject protected fields", async (t) => {
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

  await t.test("unverified email update is denied", async () => {
    const unverified = await createActor({ hasProfile: false, emailVerified: false });
    const response = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(unverified.sessionToken),
      payload: { title: "Updated title" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_EMAIL_UNVERIFIED");
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

  await t.test("email-verified owner can update editable fields without changing status", async () => {
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

  await t.test("another email-verified student cannot update the listing", async () => {
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
      { price: MAX_LISTING_PRICE + 0.01 },
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

  const statusImage = await createReadyListingImage(listing.id);
  await t.test("only the existing draft-to-published transition is supported", async () => {
    const publish = await app.inject({
      method: "POST",
      url: `${updateUrl}/publish`,
      headers: authHeaders(verifiedOwner.sessionToken),
    });
    assert.equal(
      publish.statusCode,
      200,
      `Publish response status=${publish.statusCode}, body=${publish.body}`,
    );
    assert.equal(publish.json().listing.status, ListingStatus.PUBLISHED);

    const republish = await app.inject({
      method: "POST",
      url: `${updateUrl}/publish`,
      headers: authHeaders(verifiedOwner.sessionToken),
    });
    assert.equal(republish.statusCode, 409);

    const restrictedEdit = await app.inject({
      method: "PATCH", url: updateUrl, headers: authHeaders(verifiedOwner.sessionToken),
      payload: { title: "Cannot change published title" },
    });
    assert.equal(restrictedEdit.statusCode, 422);
    assert.equal(restrictedEdit.json().error.code, "PUBLISHED_LISTING_FIELDS_RESTRICTED");
    const publishedEdit = await app.inject({
      method: "PATCH", url: updateUrl, headers: authHeaders(verifiedOwner.sessionToken),
      payload: { price: 35, description: "Updated public description." },
    });
    assert.equal(publishedEdit.statusCode, 200);
    assert.equal(publishedEdit.json().listing.status, ListingStatus.PUBLISHED);
    assert.equal(publishedEdit.json().listing.price, "35");
    assert.equal(publishedEdit.json().listing.description, "Updated public description.");
    const publicEdit = await app.inject({ method: "GET", url: `/api/v1/listings/${listing.id}` });
    assert.equal(publicEdit.json().listing.price, "35");
    assert.equal(publicEdit.json().listing.description, "Updated public description.");
    const feedEdit = await app.inject({ method: "GET", url: `/api/v1/listings?categoryId=${categoryId}` });
    const editedFeedListing = feedEdit.json().items.find((item: { id: string }) => item.id === listing.id);
    assert.equal(editedFeedListing.price, "35");
    assert.equal(editedFeedListing.description, "Updated public description.");

    const unverifiedEmailOwner = await createActor({ emailVerified: false });
    const unverifiedPublishedEdit = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(unverifiedEmailOwner.sessionToken),
      payload: { price: 40 },
    });
    assert.equal(unverifiedPublishedEdit.statusCode, 403);
    assert.equal(unverifiedPublishedEdit.json().error.code, "SELLER_EMAIL_UNVERIFIED");
    assert.equal((await prisma.listing.findUnique({ where: { id: listing.id } }))?.price.toString(), "35");

    const unsupportedTransition = await app.inject({
      method: "PATCH",
      url: updateUrl,
      headers: authHeaders(verifiedOwner.sessionToken),
      payload: { status: ListingStatus.RESERVED },
    });
    assert.equal(unsupportedTransition.statusCode, 422);

    for (const status of [ListingStatus.RESERVED, ListingStatus.SOLD, ListingStatus.SUSPENDED, ListingStatus.REMOVED]) {
      await prisma.listing.update({ where: { id: listing.id }, data: { status } });
      const deniedEdit = await app.inject({ method: "PATCH", url: updateUrl, headers: authHeaders(verifiedOwner.sessionToken), payload: { price: 36 } });
      assert.equal(deniedEdit.statusCode, 409, `${status} listing must not be editable`);
      const deniedImageRemoval = await app.inject({ method: "DELETE", url: `/api/v1/listings/${listing.id}/images/${statusImage.id}`, headers: authHeaders(verifiedOwner.sessionToken) });
      assert.equal(deniedImageRemoval.statusCode, 409, `${status} listing images must not be editable`);
    }
  });
});

test("listing removal requires an email-verified active owner and uses soft removal", async (t) => {
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

  await t.test("unverified email seller removal is denied", async () => {
    const unverified = await createActor({ hasProfile: false, emailVerified: false });
    const response = await app.inject({
      method: "DELETE",
      url: removeUrl,
      headers: authHeaders(unverified.sessionToken),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, "SELLER_EMAIL_UNVERIFIED");
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

  await t.test("another email-verified student cannot remove the listing", async () => {
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

test("listing removal preserves image history and rejects concurrent or invalid transitions", async (t) => {
  const owner = await createActor({ verificationStatus: VerificationStatus.REJECTED });
  const listing = await createDraftListing(owner.user.id);
  const image = await createReadyListingImage(listing.id);
  const removeUrl = `/api/v1/listings/${listing.id}`;

  await t.test("concurrent owner requests remove an eligible draft only once", async () => {
    const responses = await Promise.all([
      app.inject({ method: "DELETE", url: removeUrl, headers: authHeaders(owner.sessionToken) }),
      app.inject({ method: "DELETE", url: removeUrl, headers: authHeaders(owner.sessionToken) }),
    ]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 409]);
    const persisted = await prisma.listing.findUnique({ where: { id: listing.id } });
    assert.equal(persisted?.status, ListingStatus.REMOVED);
  });

  const persistedImage = await prisma.listingImage.findUnique({ where: { id: image.id } });
  assert.ok(persistedImage);
  assert.equal(persistedImage.removedAt, null);

  const published = await createDraftListing(owner.user.id);
  await prisma.listing.update({ where: { id: published.id }, data: { status: ListingStatus.PUBLISHED } });
  const publishedImage = await createReadyListingImage(published.id);
  const withdrawn = await app.inject({ method: "DELETE", url: `/api/v1/listings/${published.id}`, headers: authHeaders(owner.sessionToken) });
  assert.equal(withdrawn.statusCode, 200);
  assert.equal(withdrawn.json().listing.status, ListingStatus.REMOVED);
  assert.equal((await prisma.listingImage.findUnique({ where: { id: publishedImage.id } }))?.removedAt, null);

  for (const status of [ListingStatus.RESERVED, ListingStatus.SUSPENDED]) {
    await t.test(`owner cannot remove a ${status} listing`, async () => {
      const blocked = await createDraftListing(owner.user.id);
      await prisma.listing.update({ where: { id: blocked.id }, data: { status } });
      const blockedImage = await createReadyListingImage(blocked.id);
      const response = await app.inject({ method: "DELETE", url: `/api/v1/listings/${blocked.id}`, headers: authHeaders(owner.sessionToken) });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().error.code, "INVALID_LISTING_STATUS");
      assert.equal((await prisma.listing.findUnique({ where: { id: blocked.id } }))?.status, status);
      assert.equal((await prisma.listingImage.findUnique({ where: { id: blockedImage.id } }))?.removedAt, null);
    });
  }
});

test("listing creation requires an active, email-verified account", async (t) => {
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

  await t.test("active email-verified account can sell regardless of role", async () => {
    const actor = await createActor({
      role: Role.ADMINISTRATOR,
      hasProfile: false,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/listings",
      headers: authHeaders(actor.sessionToken),
      payload,
    });
    assert.equal(response.statusCode, 201, JSON.stringify(response.json()));
    const listingId = response.json().listing.id as string;
    await createReadyListingImage(listingId);
    const publish = await app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/publish`,
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(publish.statusCode, 200, JSON.stringify(publish.json()));
    assert.equal(publish.json().listing.status, ListingStatus.PUBLISHED);

    const verificationState = await app.inject({
      method: "GET",
      url: "/api/v1/verification/me",
      headers: authHeaders(actor.sessionToken),
    });
    assert.equal(verificationState.json().maySell, true);
  });
});

test("draft creation retries are idempotent and reject changed payloads", async () => {
  const actor = await createActor({ verificationStatus: VerificationStatus.PENDING });
  const creationKey = randomUUID();
  const headers = { ...authHeaders(actor.sessionToken), "Idempotency-Key": creationKey };
  const payload = createListingPayload();
  const [first, retry] = await Promise.all([
    app.inject({ method: "POST", url: "/api/v1/listings", headers, payload }),
    app.inject({ method: "POST", url: "/api/v1/listings", headers, payload }),
  ]);
  assert.equal(first.statusCode, 201);
  assert.equal(retry.statusCode, 201);
  assert.equal(first.json().listing.id, retry.json().listing.id);
  const changedRetry = await app.inject({
    method: "POST", url: "/api/v1/listings", headers, payload: { ...payload, title: "Changed retry" },
  });
  assert.equal(changedRetry.statusCode, 409);
  assert.equal(changedRetry.json().error.code, "LISTING_CREATION_RETRY_MISMATCH");
  assert.equal(await prisma.listing.count({ where: { sellerId: actor.user.id, creationKey } }), 1);
  assert.equal("creationKey" in first.json().listing, false);
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
  const actor = await createActor({ hasProfile: false, emailVerified: false });
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
  assert.equal(publish.json().error.code, "SELLER_EMAIL_UNVERIFIED");
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

  const registrationNumber =
    `sc201/${String(randomInt(0, 10_000)).padStart(4, "0")}/${String(randomInt(0, 10_000)).padStart(4, "0")}`;

  const expectedEmail = expectedMutStudentEmail(registrationNumber);
  const spacedRegistrationNumber =
    `${registrationNumber.slice(0, 5)} / ${registrationNumber.slice(6, 10)} / ${registrationNumber.slice(11)}`;

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
    assert.equal(expectedMutStudentEmail(registrationNumber), expectedEmail);

    assert.equal(
      isExpectedMutStudentEmail(registrationNumber, "anything@student.mut.ac.ke"),
      false,
    );

    assert.equal(
      isExpectedMutStudentEmail(
        spacedRegistrationNumber,
        expectedEmail.toUpperCase(),
      ),
      true,
    );

    await assert.rejects(
      () =>
        submitVerification(actor.user.id, {
          method: VerificationMethod.UNIVERSITY_EMAIL,
          registrationNumber,
          email: "anything@student.mut.ac.ke",
        }),
      (error: unknown) =>
        error instanceof AppError && error.code === "INVALID_STUDENT_EMAIL",
    );

    assert.equal(messages.length, 0);

    await submitVerification(actor.user.id, {
      method: VerificationMethod.UNIVERSITY_EMAIL,
      registrationNumber: spacedRegistrationNumber,
      email: expectedEmail.toUpperCase(),
    });

    assert.equal(messages.length, 1);
    assert.equal(messages[0].to, expectedEmail);

    await assert.rejects(
      () =>
        submitVerification(actor.user.id, {
          method: VerificationMethod.MANUAL_STUDENT,
          registrationNumber: spacedRegistrationNumber,
        }),
      (error: unknown) =>
        error instanceof AppError && error.code === "VERIFICATION_PENDING",
    );

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
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "INVALID_VERIFICATION_TOKEN",
    );

    const { verifyEmail } = await import("../src/modules/auth/auth.service.js");
    await verifyEmail(accountToken);

    await assert.rejects(
      () => verifyEmail(token),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === "INVALID_VERIFICATION_TOKEN",
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
      select: {
        verificationStatus: true,
        registrationNumberCiphertext: true,
      },
    });

    assert.equal(state?.verificationStatus, VerificationStatus.APPROVED);
    assert.notEqual(
      state?.registrationNumberCiphertext,
      registrationNumber.replace(/\D/g, ""),
    );
  } finally {
    resend.emails.send = originalSend;
  }
});
