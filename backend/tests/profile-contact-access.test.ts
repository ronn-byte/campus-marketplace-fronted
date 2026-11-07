import assert from "node:assert/strict";
import test from "node:test";
import { InquiryMessageSender } from "@prisma/client";
import { getProfileContactAccess, getVisibleProfileContactFields } from "../src/modules/profile/profile-contact-access.js";

test("profile contact visibility requires persisted seller ownership or the exact seller inquiry", async (t) => {
  await t.test("keeps authenticated seller profile contacts visible for listing owners", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: true,
      hasInquiryId: false,
      inquiryBuyerMatchesProfile: false,
    }), "SELLER_PUBLIC");
  });

  await t.test("denies authenticated buyer profiles without inquiry history", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: false,
      hasInquiryId: false,
      inquiryBuyerMatchesProfile: false,
    }), null);
  });

  await t.test("denies anonymous visitors even for seller profiles", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: false,
      targetOwnsListing: true,
      hasInquiryId: false,
      inquiryBuyerMatchesProfile: false,
    }), null);
  });

  await t.test("allows the authenticated seller only for the matching inquiry buyer", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: false,
      hasInquiryId: true,
      inquiryViewerRole: InquiryMessageSender.SELLER,
      inquiryBuyerMatchesProfile: true,
    }), "BUYER_PRIVATE");
  });

  await t.test("denies a buyer using their own valid inquiry", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: false,
      hasInquiryId: true,
      inquiryViewerRole: InquiryMessageSender.BUYER,
      inquiryBuyerMatchesProfile: true,
    }), null);
  });

  await t.test("denies other participants and unrelated viewers", () => {
    for (const inquiryViewerRole of [undefined, InquiryMessageSender.SELLER]) {
      assert.equal(getProfileContactAccess({
        isAuthenticated: true,
        targetOwnsListing: false,
        hasInquiryId: true,
        inquiryViewerRole,
        inquiryBuyerMatchesProfile: false,
      }), null);
    }
  });

  await t.test("does not fall back to general seller visibility for an invalid inquiry", () => {
    assert.equal(getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: true,
      hasInquiryId: true,
      inquiryViewerRole: InquiryMessageSender.BUYER,
      inquiryBuyerMatchesProfile: true,
    }), null);
  });

  await t.test("keeps a dual-role user's private contact out of the general seller profile path", () => {
    const access = getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: true,
      hasInquiryId: false,
      inquiryBuyerMatchesProfile: false,
    });
    assert.equal(access, "SELLER_PUBLIC");
    assert.deepEqual(getVisibleProfileContactFields(access, {
      sellerPublicPhoneNumber: "+254700000001",
      sellerPublicWhatsappNumber: "+254700000002",
      buyerPrivatePhoneNumber: "+254700000003",
      buyerPrivateWhatsappNumber: "+254700000004",
    }), {
      sellerPublicPhoneNumber: "+254700000001",
      sellerPublicWhatsappNumber: "+254700000002",
      buyerPrivatePhoneNumber: null,
      buyerPrivateWhatsappNumber: null,
    });
  });

  await t.test("returns buyer-private contacts only to the exact inquiry seller", () => {
    const access = getProfileContactAccess({
      isAuthenticated: true,
      targetOwnsListing: false,
      hasInquiryId: true,
      inquiryViewerRole: InquiryMessageSender.SELLER,
      inquiryBuyerMatchesProfile: true,
    });
    assert.deepEqual(getVisibleProfileContactFields(access, {
      sellerPublicPhoneNumber: "+254700000001",
      sellerPublicWhatsappNumber: "+254700000002",
      buyerPrivatePhoneNumber: "+254700000003",
      buyerPrivateWhatsappNumber: "+254700000004",
    }), {
      sellerPublicPhoneNumber: null,
      sellerPublicWhatsappNumber: null,
      buyerPrivatePhoneNumber: "+254700000003",
      buyerPrivateWhatsappNumber: "+254700000004",
    });
  });
});
