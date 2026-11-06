import assert from "node:assert/strict";
import test from "node:test";
import apiClient from "./apiClient.js";
import {
  getInquiryInbox,
  getUnreadInquiryCounts,
  INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT,
  markInquiryMessagesRead,
  sendInquiryMessage,
  subscribeToInquiryUnreadSummary,
} from "./listingService.js";

const originalWindow = globalThis.window;
globalThis.window = new EventTarget();

test.after(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

test("unread navbar count uses inquiry threads rather than message totals", () => {
  assert.deepEqual(
    getUnreadInquiryCounts({
      buyer: { threads: 1, messages: 2 },
      seller: { threads: 0, messages: 0 },
    }),
    { threads: 1, messages: 2 },
  );
});

test("unread navbar count combines distinct buyer and seller threads", () => {
  assert.deepEqual(
    getUnreadInquiryCounts({
      buyer: { threads: 2, messages: 5 },
      seller: { threads: 3, messages: 4 },
    }),
    { threads: 5, messages: 9 },
  );
});

test("unread navbar count safely handles no summary", () => {
  assert.deepEqual(getUnreadInquiryCounts(null), { threads: 0, messages: 0 });
});

test("unified inbox requests preserve filters and cursor pagination", async () => {
  const previousGet = apiClient.get;
  let request;
  apiClient.get = async (url, options) => {
    request = { url, params: options.params };
    return { data: { items: [{ id: "inquiry-1" }], page: { pageSize: 10, hasMore: true, nextCursor: "next-page" } } };
  };
  try {
    const page = await getInquiryInbox({ filter: "selling", pageSize: 10, cursor: "cursor-1", listingId: "listing-1", inquiryId: "inquiry-1" });
    assert.deepEqual(request, {
      url: "/inquiries/inbox",
      params: { filter: "selling", pageSize: 10, cursor: "cursor-1", listingId: "listing-1", inquiryId: "inquiry-1" },
    });
    assert.deepEqual(page, { items: [{ id: "inquiry-1" }], page: { pageSize: 10, hasMore: true, nextCursor: "next-page" } });
  } finally {
    apiClient.get = previousGet;
  }
});

test("logged-out Navbar subscription clears counts without requesting a summary", () => {
  const previousGet = apiClient.get;
  let requests = 0;
  let currentSummary = { buyer: { threads: 1, messages: 2 } };
  apiClient.get = async () => {
    requests += 1;
    return { data: { summary: {} } };
  };

  try {
    const unsubscribe = subscribeToInquiryUnreadSummary(false, (summary) => {
      currentSummary = summary;
    });
    assert.equal(currentSummary, null);
    assert.equal(requests, 0);
    unsubscribe();
  } finally {
    apiClient.get = previousGet;
  }
});

test("authenticated Navbar subscription displays unread summary and clears it on API failure", async () => {
  const previousGet = apiClient.get;
  const summaries = [];
  let requests = 0;
  apiClient.get = async () => {
    requests += 1;
    if (requests > 1) throw new Error("request failed");
    return {
      data: {
        summary: {
          buyer: { threads: 1, messages: 2 },
          seller: { threads: 0, messages: 0 },
        },
      },
    };
  };

  try {
    const unsubscribe = subscribeToInquiryUnreadSummary(true, (summary) => summaries.push(summary));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    assert.deepEqual(getUnreadInquiryCounts(summaries[0]), { threads: 1, messages: 2 });

    window.dispatchEvent(new Event(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT));
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    assert.equal(summaries.at(-1), null);
    unsubscribe();
  } finally {
    apiClient.get = previousGet;
  }
});

test("Navbar ignores an older unread-summary response that arrives last", async () => {
  const previousGet = apiClient.get;
  const summaries = [];
  const pending = [];
  apiClient.get = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));

  try {
    const unsubscribe = subscribeToInquiryUnreadSummary(true, (summary) => summaries.push(summary));
    window.dispatchEvent(new Event(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT));
    assert.equal(pending.length, 2);

    pending[1].resolve({
      data: { summary: { buyer: { threads: 2, messages: 3 }, seller: { threads: 0, messages: 0 } } },
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    pending[0].resolve({
      data: { summary: { buyer: { threads: 1, messages: 8 }, seller: { threads: 0, messages: 0 } } },
    });
    await new Promise((resolve) => globalThis.setTimeout(resolve, 0));

    assert.equal(summaries.length, 1);
    assert.deepEqual(getUnreadInquiryCounts(summaries[0]), { threads: 2, messages: 3 });
    unsubscribe();
  } finally {
    apiClient.get = previousGet;
  }
});

test("successful send and read operations each trigger an unread-summary refresh", async () => {
  const previousGet = apiClient.get;
  const previousPost = apiClient.post;
  let refreshes = 0;
  const handleRefresh = () => { refreshes += 1; };
  apiClient.get = async () => ({ data: { summary: { buyer: { threads: 0, messages: 0 }, seller: { threads: 0, messages: 0 } } } });
  apiClient.post = async () => ({ data: {} });
  window.addEventListener(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT, handleRefresh);

  try {
    await sendInquiryMessage("listing", "inquiry", "reply");
    await markInquiryMessagesRead("listing", "inquiry");
    assert.equal(refreshes, 2);
  } finally {
    window.removeEventListener(INQUIRY_UNREAD_SUMMARY_UPDATED_EVENT, handleRefresh);
    apiClient.get = previousGet;
    apiClient.post = previousPost;
  }
});
