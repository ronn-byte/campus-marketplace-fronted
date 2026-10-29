import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhatsAppUrl,
  getListingIdFromNavigationState,
  isValidListingId,
  isValidWhatsAppNumber,
} from "./whatsapp.js";

const listingId = "8f3fbaa4-ee54-411f-a748-d0aba806554a";

test("recovers listing context from the seller navigation back path", () => {
  assert.equal(
    getListingIdFromNavigationState({ from: `/listing/${listingId}` }),
    listingId,
  );
  assert.equal(getListingIdFromNavigationState({ from: "/listing/not-a-uuid" }), null);
  assert.equal(getListingIdFromNavigationState({ from: "/" }), null);
});

test("prefers a valid listing ID over a conflicting navigation back path", () => {
  const otherListingId = "11111111-1111-4111-8111-111111111111";

  assert.equal(
    getListingIdFromNavigationState({
      listingId,
      from: `/listing/${otherListingId}`,
    }),
    listingId,
  );
  assert.equal(
    getListingIdFromNavigationState({
      listingId: "not-a-uuid",
      from: `/listing/${otherListingId}`,
    }),
    otherListingId,
  );
});

test("ignores malformed percent-encoded listing paths", () => {
  assert.equal(
    getListingIdFromNavigationState({ from: "/listing/%E0%A4%A" }),
    null,
  );
});

test("builds an encoded listing inquiry with the canonical public URL", () => {
  const url = new URL(buildWhatsAppUrl({
    phoneNumber: "+254 712-345-678",
    listing: { id: listingId, title: "C++ notes & résumé — 2026" },
    origin: "https://mutmarket.up.railway.app",
  }));

  assert.equal(url.pathname, "/254712345678");
  assert.match(url.searchParams.get("text"), /C\+\+ notes & résumé — 2026/);
  assert.match(url.searchParams.get("text"), /https:\/\/mutmarket\.up\.railway\.app\/listing\/8f3fbaa4-ee54-411f-a748-d0aba806554a/);
  assert.match(url.searchParams.get("text"), /confirm whether it is still available/);
});

test("uses the existing digits-only contact formatting and a general inquiry without context", () => {
  const url = new URL(buildWhatsAppUrl({ phoneNumber: "(0712) 345 678", origin: "https://mutmarket.example" }));

  assert.equal(url.pathname, "/0712345678");
  assert.match(url.searchParams.get("text"), /one of your listings/);
  assert.doesNotMatch(url.searchParams.get("text"), /Item link:/);
  assert.equal(buildWhatsAppUrl({ phoneNumber: "071234", listing: { id: listingId, title: "Unavailable" }, origin: "https://mutmarket.example" }), null);
});

test("rejects invalid listing context without creating a misleading link", () => {
  assert.equal(isValidListingId("not-a-listing-id"), false);
  assert.equal(isValidListingId(listingId), true);

  const url = new URL(buildWhatsAppUrl({
    phoneNumber: "0712345678",
    listing: { id: "not-a-listing-id", title: "Stale title" },
    origin: "https://mutmarket.example",
  }));
  assert.doesNotMatch(url.searchParams.get("text"), /Item link:/);
  assert.equal(isValidWhatsAppNumber("0712345678"), true);
});
