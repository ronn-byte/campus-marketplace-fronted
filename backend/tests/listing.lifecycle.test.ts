import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingStatus,
  Role,
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
  role?: Role;
  accountStatus?: AccountStatus;
  verificationStatus?: VerificationStatus;
};

const actorIds: string[] = [];
const listingIds: string[] = [];
let categoryId: string;
let emailSequence = 0;

async function createActor(options: ActorOptions = {}) {
  const email = `phase2-lifecycle-${Date.now()}-${++emailSequence}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("phase2-lifecycle-test-password"),
      role: options.role ?? Role.STUDENT,
      accountStatus: options.accountStatus ?? AccountStatus.ACTIVE,
      studentProfile: {
        create: {
          displayName: "Lifecycle Test Student",
          verificationStatus:
            options.verificationStatus ?? VerificationStatus.APPROVED,
        },
      },
    },
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
      title: "Lifecycle test listing",
      description: "A listing used to test lifecycle transitions.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
      status,
    },
  });
  listingIds.push(listing.id);
  return listing;
}

async function postAction(
  path: string,
  listingId: string,
  sessionToken?: string,
) {
  return app.inject({
    method: "POST",
    url: `/api/v1/listings/${listingId}/${path}`,
    ...(sessionToken ? { headers: authHeaders(sessionToken) } : {}),
    payload: {
      sellerId: "request-body-must-not-determine-ownership",
      userId: "request-body-must-not-determine-ownership",
    },
  });
}

before(async () => {
  await app.ready();
  const category = await prisma.category.create({
    data: {
      name: `Lifecycle test category ${Date.now()}`,
      slug: `lifecycle-test-${Date.now()}`,
    },
  });
  categoryId = category.id;
});

after(async () => {
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

test("listing lifecycle actions require an authorized owner", async () => {
  const owner = await createActor();
  const listing = await createListing(owner.user.id);

  const unauthenticated = await postAction("reserve", listing.id);
  assert.equal(unauthenticated.statusCode, 401);

  const unverified = await createActor({
    verificationStatus: VerificationStatus.PENDING,
  });
  const unverifiedResponse = await postAction(
    "reserve",
    listing.id,
    unverified.sessionToken,
  );
  assert.equal(unverifiedResponse.statusCode, 403);

  const inactive = await createActor({
    accountStatus: AccountStatus.SUSPENDED,
  });
  const inactiveResponse = await postAction(
    "reserve",
    listing.id,
    inactive.sessionToken,
  );
  assert.equal(inactiveResponse.statusCode, 401);

  const nonOwner = await createActor();
  const nonOwnerResponse = await postAction(
    "reserve",
    listing.id,
    nonOwner.sessionToken,
  );
  assert.equal(nonOwnerResponse.statusCode, 403);

  const response = await postAction("reserve", listing.id, owner.sessionToken);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().listing.status, ListingStatus.RESERVED);

  const administrator = await createActor({ role: Role.ADMINISTRATOR });
  const disallowedRoleResponse = await postAction(
    "sold",
    listing.id,
    administrator.sessionToken,
  );
  assert.equal(disallowedRoleResponse.statusCode, 403);
});

test("PUBLISHED listings can be reserved only once", async (t) => {
  const seller = await createActor();
  const published = await createListing(seller.user.id);

  await t.test("first reservation succeeds", async () => {
    const response = await postAction("reserve", published.id, seller.sessionToken);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().listing.status, ListingStatus.RESERVED);
    assert.equal(
      (await prisma.listing.findUnique({ where: { id: published.id } }))?.soldAt,
      null,
    );
  });

  await t.test("a second reservation is rejected", async () => {
    const response = await postAction("reserve", published.id, seller.sessionToken);
    assert.equal(response.statusCode, 409);
  });
});

test("reservation rejects DRAFT, SOLD, REMOVED, and SUSPENDED listings", async () => {
  const seller = await createActor();
  for (const status of [
    ListingStatus.DRAFT,
    ListingStatus.SOLD,
    ListingStatus.REMOVED,
    ListingStatus.SUSPENDED,
  ]) {
    const listing = await createListing(seller.user.id, status);
    const response = await postAction("reserve", listing.id, seller.sessionToken);
    assert.equal(response.statusCode, 409, `expected ${status} reservation rejection`);
    assert.equal(
      (await prisma.listing.findUnique({ where: { id: listing.id } }))?.status,
      status,
    );
  }
});

test("PUBLISHED listings can be sold directly and only once", async () => {
  const seller = await createActor();
  const listing = await createListing(seller.user.id);

  const response = await postAction("sold", listing.id, seller.sessionToken);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().listing.status, ListingStatus.SOLD);

  const persisted = await prisma.listing.findUnique({ where: { id: listing.id } });
  assert.ok(persisted?.soldAt);

  const repeatedSale = await postAction("sold", listing.id, seller.sessionToken);
  assert.equal(repeatedSale.statusCode, 409);
});

test("RESERVED listings can be sold and receive soldAt", async () => {
  const seller = await createActor();
  const listing = await createListing(seller.user.id, ListingStatus.RESERVED);

  const response = await postAction("sold", listing.id, seller.sessionToken);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().listing.status, ListingStatus.SOLD);
  assert.ok(
    (await prisma.listing.findUnique({ where: { id: listing.id } }))?.soldAt,
  );
});

test("RESERVED listings can be released back to PUBLISHED", async () => {
  const seller = await createActor();
  const listing = await createListing(seller.user.id, ListingStatus.RESERVED);

  const response = await postAction(
    "release-reservation",
    listing.id,
    seller.sessionToken,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().listing.status, ListingStatus.PUBLISHED);
  assert.equal(
    (await prisma.listing.findUnique({ where: { id: listing.id } }))?.soldAt,
    null,
  );
});

test("invalid lifecycle states are rejected by the server", async () => {
  const seller = await createActor();
  for (const status of [
    ListingStatus.DRAFT,
    ListingStatus.SOLD,
    ListingStatus.REMOVED,
    ListingStatus.SUSPENDED,
  ]) {
    const listing = await createListing(seller.user.id, status);
    const sold = await postAction("sold", listing.id, seller.sessionToken);
    assert.equal(sold.statusCode, 409, `expected ${status} sale rejection`);
  }

  const published = await createListing(seller.user.id, ListingStatus.PUBLISHED);
  for (const status of [
    ListingStatus.DRAFT,
    ListingStatus.PUBLISHED,
    ListingStatus.SOLD,
    ListingStatus.REMOVED,
    ListingStatus.SUSPENDED,
  ]) {
    const listing =
      status === ListingStatus.PUBLISHED
        ? published
        : await createListing(seller.user.id, status);
    const release = await postAction(
      "release-reservation",
      listing.id,
      seller.sessionToken,
    );
    assert.equal(release.statusCode, 409, `expected ${status} release rejection`);
  }
});

test("seller removal cannot overwrite a SOLD listing", async () => {
  const seller = await createActor();
  const listing = await createListing(seller.user.id, ListingStatus.SOLD);

  const response = await app.inject({
    method: "DELETE",
    url: `/api/v1/listings/${listing.id}`,
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(response.statusCode, 409);
  assert.equal(
    (await prisma.listing.findUnique({ where: { id: listing.id } }))?.status,
    ListingStatus.SOLD,
  );
});
