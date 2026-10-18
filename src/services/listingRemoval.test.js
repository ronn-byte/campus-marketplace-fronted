import assert from "node:assert/strict";
import test from "node:test";

import { getListingRemovalAction } from "./listingRemoval.js";

test("draft removal asks for confirmation and explains retained data", () => {
  const action = getListingRemovalAction("DRAFT");

  assert.equal(action?.label, "Discard draft");
  assert.match(action?.confirmation || "", /saved images will be retained/i);
  assert.equal(action?.successMessage, "Draft discarded.");
});

test("published removal warns that new inquiries stop while history is retained", () => {
  const action = getListingRemovalAction("PUBLISHED");

  assert.equal(action?.label, "Withdraw listing");
  assert.match(action?.confirmation || "", /no longer be able to view it or send new inquiries/i);
  assert.match(action?.confirmation || "", /existing inquiries and saved images will be retained/i);
});

test("sold, removed, and other statuses have no seller removal action", () => {
  for (const status of ["SOLD", "REMOVED", "RESERVED", "SUSPENDED"]) {
    assert.equal(getListingRemovalAction(status), null);
  }
});
