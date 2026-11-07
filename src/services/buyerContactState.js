const EMPTY_BUYER_CONTACT = Object.freeze({
  status: "idle",
  phoneNumber: null,
  whatsappNumber: null,
  error: "",
});

export function getBuyerContactContextKey({
  isAuthenticated,
  isAuthLoading,
  userId,
  inquiryId,
  participantId,
}) {
  if (!isAuthenticated || isAuthLoading || !userId || !inquiryId || !participantId) return null;
  return JSON.stringify([userId, inquiryId, participantId]);
}

export function getVisibleBuyerContact(contact, contextKey) {
  if (!contextKey) return EMPTY_BUYER_CONTACT;
  if (contact.contextKey !== contextKey) {
    return { ...EMPTY_BUYER_CONTACT, status: "loading" };
  }
  return contact;
}

export function isCurrentBuyerContactRequest({
  requestId,
  requestContextKey,
  currentRequestId,
  currentContextKey,
}) {
  return requestId === currentRequestId && requestContextKey === currentContextKey;
}
