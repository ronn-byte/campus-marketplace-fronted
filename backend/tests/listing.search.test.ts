import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import {
  AccountStatus,
  ListingCondition,
  ListingStatus,
  Role,
  VerificationStatus,
} from "@prisma/client";

import "../scripts/test-database.js";

process.env.RESEND_API_KEY ??= "test-key";
process.env.EMAIL_FROM ??= "noreply@campus-marketplace.test";
process.env.APP_URL ??= "http://localhost:3000";
process.env.CORS_ORIGIN ??= "http://localhost:5173";
process.env.STUDENT_DATA_ENCRYPTION_KEY ??= Buffer.alloc(32).toString("base64");

const { prisma } = await import("../src/lib/prisma.js");
const { buildApp } = await import("../src/app/app.js");
const app = buildApp();
let categoryId: string;
let secondCategoryId: string;
let inactiveCategoryId: string;
const actorIds: string[] = [];
const listingIds: string[] = [];

async function createSeller(verificationStatus: VerificationStatus, emailVerified = true) {
  const user = await prisma.user.create({
    data: {
      email: `phase-a-search-${Date.now()}-${actorIds.length}@example.test`,
      passwordHash: "not-used-by-search-tests",
      role: Role.STUDENT,
      accountStatus: AccountStatus.ACTIVE,
      emailVerifiedAt: emailVerified ? new Date() : null,
      studentProfile: { create: { displayName: "Search Test Seller", verificationStatus } },
    },
  });
  actorIds.push(user.id);
  return user;
}

async function addListing(sellerId: string, input: {
  title: string;
  description: string;
  price: number;
  condition: ListingCondition;
  location: string;
  categoryId?: string;
  status?: ListingStatus;
  createdAt?: Date;
}) {
  const listing = await prisma.listing.create({
    data: {
      sellerId,
      categoryId: input.categoryId ?? categoryId,
      title: input.title,
      description: input.description,
      price: input.price,
      condition: input.condition,
      location: input.location,
      status: input.status ?? ListingStatus.PUBLISHED,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  listingIds.push(listing.id);
  return listing;
}

async function fetchListings(query = "") {
  return app.inject({ method: "GET", url: `/api/v1/listings${query}` });
}

before(async () => {
  await app.ready();
  const categories = await Promise.all([
    prisma.category.create({ data: { name: `Phase A Books ${Date.now()}`, slug: `phase-a-books-${Date.now()}` } }),
    prisma.category.create({ data: { name: `Phase A Tools ${Date.now()}`, slug: `phase-a-tools-${Date.now()}` } }),
    prisma.category.create({ data: { name: `Phase A Inactive ${Date.now()}`, slug: `phase-a-inactive-${Date.now()}`, isActive: false } }),
  ]);
  [categoryId, secondCategoryId, inactiveCategoryId] = categories.map(({ id }) => id);
  const seller = await createSeller(VerificationStatus.APPROVED);
  const unverifiedSeller = await createSeller(VerificationStatus.PENDING, false);
  await Promise.all([
    addListing(seller.id, { title: "Green Physics Textbook", description: "First year mechanics notes", price: 100, condition: ListingCondition.GOOD, location: "North Campus" }),
    addListing(seller.id, { title: "Green Study Chair", description: "Clean chair", price: 200, condition: ListingCondition.USED, location: "South Campus", categoryId: secondCategoryId }),
    addListing(seller.id, { title: "Red Phone", description: "Green phone case included", price: 50, condition: ListingCondition.NEW, location: "North Campus" }),
    addListing(seller.id, { title: "Hidden Draft Physics", description: "Green draft", price: 100, condition: ListingCondition.GOOD, location: "North Campus", status: ListingStatus.DRAFT }),
    addListing(unverifiedSeller.id, { title: "Hidden Unverified Physics", description: "Green listing", price: 100, condition: ListingCondition.GOOD, location: "North Campus" }),
    addListing(seller.id, { title: "Hidden Inactive Category", description: "Green listing", price: 100, condition: ListingCondition.GOOD, location: "North Campus", categoryId: inactiveCategoryId }),
  ]);
});

after(async () => {
  if (listingIds.length) {
    await prisma.listingInquiry.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listingImage.deleteMany({ where: { listingId: { in: listingIds } } });
    await prisma.listing.deleteMany({ where: { id: { in: listingIds } } });
  }
  if (actorIds.length) {
    await prisma.session.deleteMany({ where: { userId: { in: actorIds } } });
    await prisma.studentProfile.deleteMany({ where: { userId: { in: actorIds } } });
    await prisma.user.deleteMany({ where: { id: { in: actorIds } } });
  }
  const categories = [categoryId, secondCategoryId, inactiveCategoryId].filter(Boolean);
  if (categories.length) await prisma.category.deleteMany({ where: { id: { in: categories } } });
  await app.close();
});

test("public listing search supports individual and combined filters without bypassing eligibility", async () => {
  const cases: Array<[string, string[]]> = [
    ["?q=physics", ["Green Physics Textbook"]],
    [`?categoryId=${secondCategoryId}`, ["Green Study Chair"]],
    ["?minPrice=90&maxPrice=110", ["Green Physics Textbook"]],
    ["?condition=USED", ["Green Study Chair"]],
    ["?location=north", ["Green Physics Textbook", "Red Phone"]],
    [`?q=green&categoryId=${categoryId}&minPrice=90&maxPrice=110&condition=GOOD&location=north`, ["Green Physics Textbook"]],
  ];

  for (const [query, expectedTitles] of cases) {
    const response = await fetchListings(query);
    assert.equal(response.statusCode, 200, query);
    const actualTitles = response.json().items.map((item: { title: string }) => item.title).sort();
    assert.deepEqual(actualTitles, expectedTitles.sort(), query);
  }

  const broadSearch = await fetchListings("?q=physics");
  const titles = broadSearch.json().items.map((item: { title: string }) => item.title);
  assert.deepEqual(titles.sort(), ["Green Physics Textbook"]);
  assert.equal(broadSearch.json().items[0]?.seller.verified, true);
});

test("public listing sorting and pagination use filtered results", async () => {
  const ascending = await fetchListings("?q=green&sort=price_asc");
  assert.deepEqual(ascending.json().items.map((item: { title: string }) => item.title), ["Red Phone", "Green Physics Textbook", "Green Study Chair"]);

  const descendingPage = await fetchListings("?q=green&sort=price_desc&page=2&pageSize=1");
  assert.equal(descendingPage.json().items.length, 1);
  assert.equal(descendingPage.json().items[0].title, "Green Physics Textbook");
  assert.deepEqual(descendingPage.json().meta, { page: 2, pageSize: 1, total: 3, totalPages: 3 });

  const defaultOrder = await fetchListings("?q=green");
  assert.equal(defaultOrder.json().meta.pageSize, 20);
  assert.equal(defaultOrder.json().meta.page, 1);
  const orderedAt = defaultOrder.json().items.map((item: { createdAt: string }) => Date.parse(item.createdAt));
  assert.ok(orderedAt[0] >= orderedAt[1], "default feed order remains newest first");
});

test("all public listing sorts are deterministic across tied sort values and page boundaries", async () => {
  const seller = await createSeller(VerificationStatus.APPROVED);
  const sameTimestamp = new Date("2025-01-02T03:04:05.000Z");
  const tiedListings = await Promise.all([
    addListing(seller.id, { title: "Stable tie A", description: "Stable tie fixture", price: 75, condition: ListingCondition.GOOD, location: "Campus", createdAt: sameTimestamp }),
    addListing(seller.id, { title: "Stable tie B", description: "Stable tie fixture", price: 75, condition: ListingCondition.GOOD, location: "Campus", createdAt: sameTimestamp }),
    addListing(seller.id, { title: "Stable tie C", description: "Stable tie fixture", price: 75, condition: ListingCondition.GOOD, location: "Campus", createdAt: sameTimestamp }),
  ]);
  const expectedIds = tiedListings.map(({ id }) => id).sort();

  for (const sort of ["newest", "price_asc", "price_desc"]) {
    const observedIds: string[] = [];
    for (let page = 1; page <= tiedListings.length; page += 1) {
      const query = `?q=Stable%20tie&sort=${sort}&page=${page}&pageSize=1`;
      const first = await fetchListings(query);
      const repeated = await fetchListings(query);
      assert.equal(first.statusCode, 200, `${sort} page ${page}`);
      const firstId = first.json().items[0]?.id as string | undefined;
      assert.equal(repeated.json().items[0]?.id, firstId, `${sort} page ${page} is stable across requests`);
      assert.ok(firstId);
      observedIds.push(firstId);
    }
    assert.deepEqual(observedIds, expectedIds, `${sort} returns stable unique pages`);
  }
});

test("public listing endpoint rejects invalid query parameters before querying", async () => {
  for (const query of ["?sort=rating", "?minPrice=200&maxPrice=100", "?page=0", "?page=1e100", "?page=2002", "?condition=UNKNOWN", "?extra=value"]) {
    const response = await fetchListings(query);
    assert.equal(response.statusCode, 422, query);
    assert.equal(response.json().error.code, "VALIDATION_ERROR");
  }
});
