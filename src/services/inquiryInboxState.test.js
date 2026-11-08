import assert from "node:assert/strict";
import test from "node:test";
import {
  beginInboxRefresh,
  failInboxRefresh,
  getSelectedInquiryFilter,
  shouldSkipInboxLoad,
} from "./inquiryInboxState.js";

const thread = { id: "inquiry-1", unreadMessageCount: 1 };

test("background inbox refresh keeps the populated conversation layout mounted", () => {
  const success = { status: "success", items: [thread], page: null };
  const beforeRefresh = success.status === "success" && success.items.length > 0;

  const refreshing = beginInboxRefresh(success);
  const duringRefresh = refreshing.status === "success" && refreshing.items.length > 0;

  assert.equal(beforeRefresh, true);
  assert.equal(duringRefresh, true);
  assert.equal(refreshing.items, success.items);
});

test("initial inbox load still shows its blocking loading state", () => {
  assert.deepEqual(beginInboxRefresh({ status: "idle", items: [], page: null }), {
    status: "loading",
    items: [],
    page: null,
  });
});

test("failed background refresh keeps the active conversation rendered", () => {
  const current = { status: "success", items: [thread], page: null };
  const failed = failInboxRefresh(current);

  assert.equal(failed.status, "success");
  assert.equal(failed.items[0], thread);
});

test("failed initial inbox load exposes the retryable error state", () => {
  assert.equal(failInboxRefresh({ status: "loading", items: [], page: null }).status, "error");
});

test("selected threads remain queryable after read receipts remove them from unread results", () => {
  assert.equal(getSelectedInquiryFilter("unread"), "all");
  assert.equal(getSelectedInquiryFilter("buying"), "buying");
  assert.equal(getSelectedInquiryFilter("selling"), "selling");
  assert.equal(getSelectedInquiryFilter("all"), "all");
});

test("opening a thread already in the current inbox skips the duplicate selection refresh", () => {
  const options = {
    force: false,
    selectedInquiryId: thread.id,
    selectedIsLoaded: true,
    loadedScope: '["all",""]',
    scope: '["all",""]',
  };

  assert.equal(shouldSkipInboxLoad(options), true);
  assert.equal(shouldSkipInboxLoad({ ...options, force: true }), false);
  assert.equal(shouldSkipInboxLoad({ ...options, scope: '["unread",""]' }), false);
  assert.equal(shouldSkipInboxLoad({ ...options, selectedIsLoaded: false }), false);
});
