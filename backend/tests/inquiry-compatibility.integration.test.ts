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
const { env } = await import("../src/config/env.js");
const { buildApp } = await import("../src/app/app.js");
const { createSession } = await import("../src/modules/auth/auth.service.js");
const { createOpaqueToken, hashPassword, hashToken } = await import("../src/modules/auth/auth.utils.js");
const app = buildApp();

const actorIds: string[] = [];
const listingIds: string[] = [];
let categoryId: string;
let emailSequence = 0;

async function createActor() {
  const email = `legacy-inquiry-${Date.now()}-${++emailSequence}@example.test`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hashPassword("legacy-inquiry-test-password"),
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      studentProfile: {
        create: {
          displayName: "Legacy Inquiry Test Student",
          verificationStatus: VerificationStatus.APPROVED,
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

before(async () => {
  await app.ready();
  const category = await prisma.category.create({
    data: {
      name: `Legacy inquiry test category ${Date.now()}`,
      slug: `legacy-inquiry-test-${Date.now()}`,
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

test("legacy inquiry routes keep working and seller replies fail with an explicit 503", async (t) => {
  const [schema] = await prisma.$queryRaw<Array<{
    hasMessageTable: boolean;
    hasLegacyMessageColumn: boolean;
  }>>`
    SELECT
      to_regclass('listing_inquiry_messages') IS NOT NULL AS "hasMessageTable",
      EXISTS (
        SELECT 1
        FROM pg_attribute
        WHERE "attrelid" = to_regclass('listing_inquiries')
          AND "attname" = 'message'
          AND "attnum" > 0
          AND NOT "attisdropped"
      ) AS "hasLegacyMessageColumn"
  `;

  if (!schema?.hasLegacyMessageColumn || schema.hasMessageTable) {
    t.skip("The disposable database is not in the legacy inquiry schema state.");
    return;
  }

  const seller = await createActor();
  const buyer = await createActor();
  const unrelated = await createActor();
  const listing = await prisma.listing.create({
    data: {
      sellerId: seller.user.id,
      categoryId,
      title: "Legacy inquiry compatibility listing",
      description: "A listing used to verify legacy inquiry compatibility.",
      price: 10,
      condition: "GOOD",
      location: "Campus",
      status: ListingStatus.PUBLISHED,
    },
  });
  listingIds.push(listing.id);

  const initialMessage = "Is this listing still available?";
  const created = await app.inject({
    method: "POST",
    url: `/api/v1/listings/${listing.id}/inquiries`,
    headers: authHeaders(buyer.sessionToken),
    payload: { message: initialMessage },
  });
  assert.equal(created.statusCode, 201, JSON.stringify(created.json()));
  assert.equal(created.json().inquiry.message, initialMessage);

  const inquiry = await prisma.listingInquiry.findFirstOrThrow({
    where: { listingId: listing.id, buyerId: buyer.user.id },
  });
  const buyerList = await app.inject({
    method: "GET",
    url: "/api/v1/inquiries/me?page=1&pageSize=10",
    headers: authHeaders(buyer.sessionToken),
  });
  assert.equal(buyerList.statusCode, 200, JSON.stringify(buyerList.json()));
  assert.equal(buyerList.json().inquiries[0]?.message, initialMessage);

  const sellerList = await app.inject({
    method: "GET",
    url: `/api/v1/listings/${listing.id}/inquiries`,
    headers: authHeaders(seller.sessionToken),
  });
  assert.equal(sellerList.statusCode, 200, JSON.stringify(sellerList.json()));
  assert.equal(sellerList.json().inquiries[0]?.message, initialMessage);

  const threadUrl = `/api/v1/listings/${listing.id}/inquiries/${inquiry.id}/messages`;
  const buyerThread = await app.inject({
    method: "GET",
    url: threadUrl,
    headers: authHeaders(buyer.sessionToken),
  });
  assert.equal(buyerThread.statusCode, 200, JSON.stringify(buyerThread.json()));
  assert.equal(buyerThread.json().thread.messages.length, 1);
  assert.equal(buyerThread.json().thread.messages[0]?.content, initialMessage);
  assert.equal(buyerThread.json().thread.messages[0]?.sender, "BUYER");

  const nonParticipantRead = await app.inject({
    method: "GET",
    url: threadUrl,
    headers: authHeaders(unrelated.sessionToken),
  });
  assert.equal(nonParticipantRead.statusCode, 404);
  const nonParticipantSend = await app.inject({
    method: "POST",
    url: threadUrl,
    headers: authHeaders(unrelated.sessionToken),
    payload: { content: "This user is not part of the conversation." },
  });
  assert.equal(nonParticipantSend.statusCode, 404);

  const sellerReply = await app.inject({
    method: "POST",
    url: threadUrl,
    headers: authHeaders(seller.sessionToken),
    payload: { content: "Yes, it is still available." },
  });
  assert.equal(sellerReply.statusCode, 503, JSON.stringify(sellerReply.json()));
  assert.equal(sellerReply.json().error.code, "INQUIRY_MESSAGING_UNAVAILABLE");
});
