import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import InquiryConversation from "../components/InquiryConversation.jsx";
import { useAuth } from "../hooks/useAuth";
import apiClient, { getApiErrorMessage } from "../services/apiClient";
import { getInquiryInbox, getInquiryUnreadSummary, updateListingInquiryStatus } from "../services/listingService";
import { buildWhatsAppUrl, isValidWhatsAppNumber, normalizeWhatsAppNumber } from "../services/whatsapp";
import { getBuyerContactContextKey, getVisibleBuyerContact, isCurrentBuyerContactRequest } from "../services/buyerContactState.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "buying", label: "Buying" },
  { id: "selling", label: "Selling" },
  { id: "unread", label: "Unread" },
];
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormatter.format(date);
};

export default function Messages() {
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = FILTERS.some(({ id }) => id === searchParams.get("filter")) ? searchParams.get("filter") : "all";
  const listingId = searchParams.get("listingId") || "";
  const selectedInquiryId = searchParams.get("inquiryId") || "";
  const [result, setResult] = useState({ status: "idle", items: [], page: null });
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [buyerContact, setBuyerContact] = useState({ contextKey: null, status: "idle", phoneNumber: null, whatsappNumber: null, error: "" });
  const buyerContactRequestId = useRef(0);
  const buyerContactContextKeyRef = useRef(null);
  const sequence = useRef(0);
  const nextCursor = useRef(null);
  const itemById = useMemo(() => new Map(result.items.map((item) => [item.id, item])), [result.items]);
  const selected = itemById.get(selectedInquiryId);
  const selectedContext = selected?.context;
  const selectedId = selected?.id;
  const selectedParticipantId = selected?.otherParticipant?.id;
  const buyerContactContextKey = getBuyerContactContextKey({
    isAuthenticated,
    isAuthLoading,
    userId: user?.id,
    inquiryId: selectedContext === "SELLING" ? selectedId : undefined,
    participantId: selectedContext === "SELLING" ? selectedParticipantId : undefined,
  });
  // Update synchronously during render so a pending response from the prior
  // account or inquiry is stale before passive effect cleanup runs.
  buyerContactContextKeyRef.current = buyerContactContextKey;
  const visibleBuyerContact = getVisibleBuyerContact(buyerContact, buyerContactContextKey);

  useEffect(() => {
    const requestId = ++buyerContactRequestId.current;
    let active = true;
    if (!buyerContactContextKey) {
      setBuyerContact({ contextKey: null, status: "idle", phoneNumber: null, whatsappNumber: null, error: "" });
      return () => {
        active = false;
        if (buyerContactRequestId.current === requestId) buyerContactRequestId.current += 1;
      };
    }

    setBuyerContact({ contextKey: buyerContactContextKey, status: "loading", phoneNumber: null, whatsappNumber: null, error: "" });
    apiClient.get(`/sellers/${encodeURIComponent(selectedParticipantId)}`, {
      params: { inquiryId: selectedId },
    }).then(({ data }) => {
      if (!active || !isCurrentBuyerContactRequest({
        requestId,
        requestContextKey: buyerContactContextKey,
        currentRequestId: buyerContactRequestId.current,
        currentContextKey: buyerContactContextKeyRef.current,
      })) return;
      setBuyerContact({
        contextKey: buyerContactContextKey,
        status: "success",
        phoneNumber: data.profile?.buyerPrivatePhoneNumber ?? null,
        whatsappNumber: data.profile?.buyerPrivateWhatsappNumber ?? null,
        error: "",
      });
    }).catch((requestError) => {
      if (!active || !isCurrentBuyerContactRequest({
        requestId,
        requestContextKey: buyerContactContextKey,
        currentRequestId: buyerContactRequestId.current,
        currentContextKey: buyerContactContextKeyRef.current,
      })) return;
      setBuyerContact({ contextKey: buyerContactContextKey, status: "error", phoneNumber: null, whatsappNumber: null, error: getApiErrorMessage(requestError) });
    });

    return () => {
      active = false;
      if (buyerContactRequestId.current === requestId) buyerContactRequestId.current += 1;
    };
  }, [buyerContactContextKey, selectedId, selectedParticipantId]);

  const load = useCallback(async ({ append = false } = {}) => {
    const requestId = ++sequence.current;
    setResult((current) => ({ ...current, status: "loading" }));
    setError("");
    try {
      if (!append) nextCursor.current = null;
      const page = await getInquiryInbox({ filter, listingId: listingId || undefined, pageSize: 20, cursor: append ? nextCursor.current || undefined : undefined });
      if (sequence.current !== requestId) return;
      nextCursor.current = page.page.nextCursor;
      let pageItems = page.items;
      if (!append && selectedInquiryId && !pageItems.some((item) => item.id === selectedInquiryId)) {
        const selectedPage = await getInquiryInbox({
          filter,
          listingId: listingId || undefined,
          inquiryId: selectedInquiryId,
          pageSize: 1,
        });
        if (sequence.current !== requestId) return;
        pageItems = [...pageItems, ...selectedPage.items];
      }
      setResult((current) => ({ status: "success", items: append ? [...current.items, ...pageItems] : pageItems, page: page.page }));
    } catch (requestError) {
      if (sequence.current !== requestId) return;
      setResult((current) => ({ ...current, status: "error" }));
      setError(getApiErrorMessage(requestError));
    }
  }, [filter, listingId, selectedInquiryId]);

  const loadSummary = useCallback(async () => {
    try { setSummary(await getInquiryUnreadSummary()); setSummaryError(""); }
    catch (requestError) { setSummaryError(getApiErrorMessage(requestError)); }
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      void load();
      void loadSummary();
    }
  }, [isAuthenticated, isAuthLoading, filter, listingId, selectedInquiryId, load, loadSummary]);

  const selectFilter = (nextFilter) => {
    const next = new URLSearchParams(searchParams);
    next.set("filter", nextFilter);
    next.delete("inquiryId");
    setSearchParams(next);
  };

  const selectInquiry = (inquiryId) => {
    const next = new URLSearchParams(searchParams);
    if (selectedInquiryId === inquiryId) next.delete("inquiryId");
    else next.set("inquiryId", inquiryId);
    setSearchParams(next);
  };

  const updateSelectedInquiryStatus = async (status) => {
    if (!selected || selected.context !== "SELLING" || isUpdatingStatus) return;
    setIsUpdatingStatus(true);
    setStatusError("");
    try {
      const inquiry = await updateListingInquiryStatus(selected.listing.id, selected.id, status);
      setResult((current) => ({
        ...current,
        items: current.items.map((item) => item.id === selected.id
          ? { ...item, inquiryStatus: inquiry?.status ?? status }
          : item),
      }));
      void load();
    } catch (requestError) {
      setStatusError(getApiErrorMessage(requestError));
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  if (isAuthLoading) return <div className="page-shell"><p className="muted" role="status">Checking your sign-in status…</p></div>;
  if (!isAuthenticated) return <div className="page-shell"><section className="workspace-state"><h1>Sign in to view Messages</h1><p className="muted">Your conversations are available after you sign in.</p><Link className="button" to="/login">Sign in</Link></section></div>;

  const unread = summary ? { threads: (summary.buyer?.threads || 0) + (summary.seller?.threads || 0), messages: (summary.buyer?.messages || 0) + (summary.seller?.messages || 0) } : null;
  const items = result.items;

  return <div className="page-shell workspace-page messages-page">
    <div className="workspace-heading"><div><p className="eyebrow">Your conversations</p><h1>Messages</h1><p className="muted">Buying and selling conversations in one inbox.</p></div></div>
    {unread && <p className="workspace-unread-summary" role="status"><strong>Unread activity:</strong> {unread.threads} conversations · {unread.messages} messages</p>}
    {summaryError && <p className="form-alert" role="alert">Unread totals could not be refreshed: {summaryError}</p>}
    <div className="message-inbox-toolbar"><div className="message-filters" role="tablist" aria-label="Conversation filters">{FILTERS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={`message-filter${filter === item.id ? " message-filter--active" : ""}`} onClick={() => selectFilter(item.id)}>{item.label}</button>)}</div>{listingId && <button type="button" className="message-clear-listing-filter" onClick={() => { const next = new URLSearchParams(searchParams); next.delete("listingId"); next.delete("inquiryId"); setSearchParams(next); }}>Clear listing filter</button>}</div>
    {listingId && <p className="muted">Showing conversations for the selected listing.</p>}
    {error && <p className="form-alert" role="alert">{error}</p>}
    {result.status === "loading" && <p className="muted" role="status">Loading conversations…</p>}
    {result.status === "error" && <button className="button button--secondary" type="button" onClick={() => void load()}>Try again</button>}
    {result.status === "success" && items.length === 0 && <section className="workspace-state"><h2>{filter === "unread" ? "No unread conversations" : "No conversations yet"}</h2><p className="muted">Conversations you start or receive will appear here.</p>{listingId && <button className="button button--secondary" type="button" onClick={() => { const next = new URLSearchParams(searchParams); next.delete("listingId"); setSearchParams(next); }}>Show all conversations</button>}</section>}
    {result.status === "success" && items.length > 0 && <div className="message-inbox-layout">
      <section className="message-thread-list" aria-label="Conversations">{items.map((item) => <button key={item.id} type="button" onClick={() => selectInquiry(item.id)} className={`message-thread-card${item.id === selectedInquiryId ? " message-thread-card--selected" : ""}${item.hasUnreadMessages ? " message-thread-card--unread" : ""}`} aria-current={item.id === selectedInquiryId ? "true" : undefined}>
        <span className={`message-thread-card__direction message-thread-card__direction--${item.context.toLowerCase()}`}>{item.context === "BUYING" ? "Buying" : "Selling"}</span>
        <strong>{item.otherParticipant?.displayName || "MUT Market participant"}</strong>
        <span className="message-thread-card__listing">{item.listing?.title || "Listing unavailable"}</span>
        <span className="message-thread-card__preview">{item.latestMessagePreview || "No messages yet."}</span>
        <time dateTime={item.latestMessageAt}>{formatDate(item.latestMessageAt)}</time>
        {item.unreadMessageCount > 0 && <span className="message-thread-card__unread" aria-label={`${item.unreadMessageCount} unread messages`} title={`${item.unreadMessageCount} unread messages`} />}
        {item.unreadMessageCount > 0 && <span className="workspace-unread-badge">{item.unreadMessageCount} unread</span>}
      </button>)}
      {result.page?.hasMore && <button className="button button--secondary" type="button" disabled={result.status === "loading"} onClick={() => void load({ append: true })}>Load more conversations</button>}</section>
      <section className="message-thread-detail" aria-label="Selected conversation">{selected ? <>
        <header className="message-thread-detail__header"><div><p className="eyebrow">{selected.context === "BUYING" ? "Buying" : "Selling"} · {selected.otherParticipant?.displayName || "MUT Market participant"}</p><h2>{selected.listing?.title || "Listing unavailable"}</h2></div><div className="workspace-actions">{selected.context === "SELLING" && selected.otherParticipant?.id && <Link className="text-link" to={`/sellers/${encodeURIComponent(selected.otherParticipant.id)}?inquiryId=${encodeURIComponent(selected.id)}`}>View buyer profile</Link>}{selected.listing?.id && <Link className="text-link" to={`/listing/${encodeURIComponent(selected.listing.id)}`}>View listing</Link>}</div></header>
        {selected.context === "SELLING" && selected.inquiryStatus !== "CLOSED" && <div className="workspace-actions" aria-label="Inquiry status actions">
          {selected.inquiryStatus === "OPEN" && <button className="button button--quiet" type="button" disabled={isUpdatingStatus} onClick={() => void updateSelectedInquiryStatus("RESPONDED")}>{isUpdatingStatus ? "Updating…" : "Mark responded"}</button>}
          <button className="button button--secondary" type="button" disabled={isUpdatingStatus} onClick={() => void updateSelectedInquiryStatus("CLOSED")}>{isUpdatingStatus ? "Updating…" : "Close inquiry"}</button>
        </div>}
        {statusError && <p className="form-alert" role="alert">Inquiry status could not be updated: {statusError}</p>}
        {selected.context === "SELLING" && <section className="message-buyer-contact" aria-label="Buyer contact details">
          <h3>Buyer contact for this inquiry</h3>
          {visibleBuyerContact.status === "loading" && <p role="status">Loading buyer contact details...</p>}
          {visibleBuyerContact.status === "error" && <p className="form-alert" role="alert">Buyer contact details could not be loaded: {visibleBuyerContact.error}</p>}
          {visibleBuyerContact.status === "success" && (() => {
            const phone = normalizeWhatsAppNumber(visibleBuyerContact.phoneNumber);
            const whatsapp = normalizeWhatsAppNumber(visibleBuyerContact.whatsappNumber);
            const whatsappUrl = buildWhatsAppUrl({ phoneNumber: whatsapp, listing: selected.listing });
            return isValidWhatsAppNumber(phone) || whatsappUrl
              ? <div className="workspace-actions">
                {isValidWhatsAppNumber(phone) && <a className="button button--secondary" href={`tel:+${phone}`}>Call buyer</a>}
                {whatsappUrl && <a className="button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Message buyer on WhatsApp</a>}
              </div>
              : <p className="muted">The buyer has not added contact details.</p>;
          })()}
        </section>}
        <InquiryConversation key={selected.id} listingId={selected.listing.id} inquiryId={selected.id} onThreadUpdated={() => { void Promise.all([load(), loadSummary()]); }} />
      </> : <div className="message-thread-placeholder"><h2>Select a conversation</h2><p className="muted">Choose a conversation to read and reply.</p></div>}</section>
    </div>}
  </div>;
}
