import assert from "node:assert/strict";
import test from "node:test";
import { getBuyerInquiryListingState } from "./buyerInquiryListing.js";

test("published buyer inquiry listings have an encoded listing link", () => {
  assert.deepEqual(getBuyerInquiryListingState({ id: "item/a", status: "PUBLISHED" }), {
    href: "/listing/item%2Fa",
    message: null,
  });
});

test("sold and removed buyer inquiry listings explain that history remains available", () => {
  for (const status of ["SOLD", "REMOVED"]) {
    assert.deepEqual(getBuyerInquiryListingState({ id: "listing-1", status }), {
      href: null,
      message: `This listing is ${status.toLowerCase()}; your inquiry history is still available.`,
    });
  }
});

test("missing, suspended, and other unavailable listings do not get active links", () => {
  for (const listing of [undefined, {}, { id: "listing-1", status: "SUSPENDED" }]) {
    assert.deepEqual(getBuyerInquiryListingState(listing), {
      href: null,
      message: "This listing is not currently available to view.",
    });
  }
});
