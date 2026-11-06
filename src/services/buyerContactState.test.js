import assert from "node:assert/strict";
import test from "node:test";
import {
  getBuyerContactContextKey,
  getVisibleBuyerContact,
  isCurrentBuyerContactRequest,
} from "./buyerContactState.js";

const successfulContact = (contextKey) => ({
  contextKey,
  status: "success",
  phoneNumber: "+254700000001",
  whatsappNumber: "+254700000002",
  error: "",
});

const makeKey = (overrides = {}) => getBuyerContactContextKey({
  isAuthenticated: true,
  isAuthLoading: false,
  userId: "seller-a",
  inquiryId: "inquiry-a",
  participantId: "buyer-a",
  ...overrides,
});

test("buyer contacts disappear immediately when authentication ends", () => {
  const oldKey = makeKey();
  const signedOutKey = makeKey({ isAuthenticated: false, userId: undefined });
  assert.equal(signedOutKey, null);
  assert.deepEqual(getVisibleBuyerContact(successfulContact(oldKey), signedOutKey), {
    status: "idle", phoneNumber: null, whatsappNumber: null, error: "",
  });
});

test("buyer contacts are hidden when the authenticated user changes", () => {
  const oldKey = makeKey();
  const newKey = makeKey({ userId: "seller-b" });
  assert.notEqual(oldKey, newKey);
  assert.deepEqual(getVisibleBuyerContact(successfulContact(oldKey), newKey), {
    status: "loading", phoneNumber: null, whatsappNumber: null, error: "",
  });
});

test("switching inquiry or participant hides the previous contact while loading", () => {
  const oldKey = makeKey();
  for (const newKey of [
    makeKey({ inquiryId: "inquiry-b", participantId: "buyer-b" }),
    makeKey({ participantId: "buyer-b" }),
  ]) {
    assert.deepEqual(getVisibleBuyerContact(successfulContact(oldKey), newKey), {
      status: "loading", phoneNumber: null, whatsappNumber: null, error: "",
    });
  }
});

test("a delayed request cannot update contact state after account or inquiry changes", () => {
  const originalKey = makeKey();
  const nextKey = makeKey({ userId: "seller-b", inquiryId: "inquiry-b", participantId: "buyer-b" });
  assert.equal(isCurrentBuyerContactRequest({
    requestId: 1,
    requestContextKey: originalKey,
    currentRequestId: 2,
    currentContextKey: nextKey,
  }), false);
});

test("failed contact requests expose no previously loaded details", () => {
  const contextKey = makeKey();
  const failedContact = {
    contextKey,
    status: "error",
    phoneNumber: null,
    whatsappNumber: null,
    error: "Request failed.",
  };
  assert.deepEqual(getVisibleBuyerContact(failedContact, contextKey), failedContact);
});

test("the current authorized inquiry contact remains visible after loading", () => {
  const contextKey = makeKey();
  assert.deepEqual(getVisibleBuyerContact(successfulContact(contextKey), contextKey), successfulContact(contextKey));
});
