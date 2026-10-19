import assert from "node:assert/strict";
import test from "node:test";
import {
  createListingSchema,
  listPublicListingsQuerySchema,
  MAX_LISTING_PRICE,
  MAX_PUBLIC_LISTING_PAGE,
  MAX_PUBLIC_LISTING_OFFSET,
} from "../src/modules/listings/listing.schemas.js";

test("listing prices stay within the database decimal range", () => {
  const payload = {
    categoryId: "550e8400-e29b-41d4-a716-446655440000",
    title: "Desk lamp",
    description: "Working condition.",
    price: MAX_LISTING_PRICE,
    condition: "GOOD",
    location: "Campus",
  };
  assert.equal(createListingSchema.safeParse(payload).success, true);
  assert.equal(createListingSchema.safeParse({ ...payload, price: MAX_LISTING_PRICE + 0.01 }).success, false);
  assert.equal(createListingSchema.safeParse({ ...payload, price: -0.01 }).success, false);
});

test("public listing query accepts normalized filters and preserves pagination defaults", () => {
  assert.deepEqual(listPublicListingsQuerySchema.parse({}), {
    page: 1,
    pageSize: 20,
    sort: "newest",
  });
  assert.equal(listPublicListingsQuerySchema.parse({ page: "1" }).page, 1);
  const maximumPage = listPublicListingsQuerySchema.parse({ page: String(MAX_PUBLIC_LISTING_PAGE), pageSize: "50" });
  assert.equal(maximumPage.page, 2_001);
  assert.equal((maximumPage.page - 1) * maximumPage.pageSize, MAX_PUBLIC_LISTING_OFFSET);

  const query = listPublicListingsQuerySchema.parse({
    q: "  physics  ",
    categoryId: "550e8400-e29b-41d4-a716-446655440000",
    minPrice: "10.50",
    maxPrice: "100",
    condition: "USED",
    location: "  north campus ",
    sort: "price_asc",
  });
  assert.equal(query.q, "physics");
  assert.equal(query.location, "north campus");
  assert.equal(query.minPrice, 10.5);
  assert.equal(query.maxPrice, 100);
  assert.equal(query.sort, "price_asc");
});

test("public listing query rejects malformed pagination, filters, and price ranges", () => {
  const invalidQueries = [
    { page: "0" },
    { page: "1.5" },
    { page: "1e100" },
    { page: String(MAX_PUBLIC_LISTING_PAGE + 1) },
    { pageSize: "51" },
    { pageSize: "many" },
    { categoryId: "not-a-uuid" },
    { minPrice: "-1" },
    { minPrice: "150", maxPrice: "20" },
    { condition: "WORN" },
    { sort: "random" },
    { unsupported: "x" },
  ];
  for (const query of invalidQueries) {
    assert.equal(listPublicListingsQuerySchema.safeParse(query).success, false);
  }
});
