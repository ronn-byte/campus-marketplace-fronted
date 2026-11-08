export function beginInboxRefresh(current) {
  return {
    ...current,
    // Keep an already-rendered inbox mounted while refreshing its data.
    status: current.items.length > 0 ? "success" : "loading",
  };
}

export function failInboxRefresh(current) {
  return {
    ...current,
    // A refresh failure should not discard the inbox or selected conversation.
    status: current.items.length > 0 ? "success" : "error",
  };
}

export function getSelectedInquiryFilter(filter) {
  // Read receipts remove the active thread from the unread-only result set.
  // The inbox endpoint still scopes this lookup to the authenticated user.
  return filter === "unread" ? "all" : filter;
}

export function shouldSkipInboxLoad({ force, selectedInquiryId, selectedIsLoaded, loadedScope, scope }) {
  return !force && Boolean(selectedInquiryId) && selectedIsLoaded && loadedScope === scope;
}
