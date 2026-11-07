import assert from "node:assert/strict";
import test from "node:test";
import { profileUpdateSchema } from "../src/modules/profile/profile.schemas.js";

test("profile updates validate seller-public contacts separately from buyer-private contacts", () => {
  const parsed = profileUpdateSchema.parse({
    phoneNumber: "+254700000001",
    whatsappNumber: "+254700000002",
    sellerPublicPhoneNumber: "0712345678",
    sellerPublicWhatsappNumber: "+254700000004",
  });

  assert.equal(parsed.phoneNumber, "+254700000001");
  assert.equal(parsed.whatsappNumber, "+254700000002");
  assert.equal(parsed.sellerPublicPhoneNumber, "+254712345678");
  assert.equal(parsed.sellerPublicWhatsappNumber, "+254700000004");
});

test("profile updates reject malformed seller-public contact fields", () => {
  const parsed = profileUpdateSchema.safeParse({ sellerPublicPhoneNumber: "not-a-phone" });
  assert.equal(parsed.success, false);
});
