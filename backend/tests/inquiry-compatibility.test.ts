import assert from "node:assert/strict";
import test from "node:test";

import { getInquiryPersistenceMode } from "../src/modules/listings/inquiry-compatibility.js";

test("inquiry persistence selects the compatible schema or fails closed", () => {
  assert.equal(
    getInquiryPersistenceMode({
      hasMessageTable: false,
      hasLegacyMessageColumn: true,
    }),
    "legacy",
  );
  assert.equal(
    getInquiryPersistenceMode({
      hasMessageTable: true,
      hasLegacyMessageColumn: true,
    }),
    "legacy",
  );
  assert.equal(
    getInquiryPersistenceMode({
      hasMessageTable: true,
      hasLegacyMessageColumn: false,
    }),
    "messaging",
  );
  assert.equal(
    getInquiryPersistenceMode({
      hasMessageTable: false,
      hasLegacyMessageColumn: false,
    }),
    "unavailable",
  );
});
