import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getApiErrorMessage } from "../services/apiClient";
import { getBuyerInquiryListingState } from "../services/buyerInquiryListing.js";
import { getInquiryUnreadSummary, getMyInquiries } from "../services/listingService";

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormatter.format(date);
};

export default function MyInquiries() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
  const [result, setResult] = useState({ status: "idle", items: [], meta: null });
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
  const sequence = useRef(0);

  const loadInquiries = useCallback(async () => {
    const requestId = ++sequence.current;
    setResult((current) => ({ ...current, status: "loading" }));
    setError("");
    try {
      const data = await getMyInquiries({ page, pageSize: 20 });
      if (sequence.current === requestId) setResult({ status: "success", ...data });
    } catch (requestError) {
      if (sequence.current !== requestId) return;
      setResult({ status: "error", items: [], meta: null });
      setError(getApiErrorMessage(requestError));
    }
  }, [page]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await getInquiryUnreadSummary());
      setSummaryError("");
    } catch (requestError) {
      setSummaryError(getApiErrorMessage(requestError));
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && !isAuthLoading) {
      void loadInquiries();
      void loadSummary();
    }
  }, [isAuthenticated, isAuthLoading, loadInquiries, loadSummary]);

  if (isAuthLoading) return <div className="page-shell"><p className="muted" role="status">Checking your sign-in status…</p></div>;
  if (!isAuthenticated) {
    return <div className="page-shell"><section className="workspace-state"><h1>Sign in to view My Inquiries</h1><p className="muted">Your buyer inquiry history is available after you sign in.</p><Link className="button" to="/login">Sign in</Link></section></div>;
  }

  const items = result.items || [];
  const buyerUnread = summary?.buyer;
  const totalPages = Math.max(1, Number(result.meta?.totalPages) || 1);

  return (
    <div className="page-shell workspace-page">
      <div className="workspace-heading">
        <div><p className="eyebrow">Buyer workspace</p><h1>My Inquiries</h1><p className="muted">Conversations you started with sellers.</p></div>
        <Link to="/" className="button button--small">Explore listings</Link>
      </div>
      {buyerUnread && <p className="workspace-unread-summary" role="status"><strong>Unread seller replies:</strong> {buyerUnread.threads} conversation{buyerUnread.threads === 1 ? "" : "s"} · {buyerUnread.messages} message{buyerUnread.messages === 1 ? "" : "s"}</p>}
      {summaryError && <p className="form-alert" role="alert">Unread reply totals could not be refreshed: {summaryError}</p>}
      {error && <p className="form-alert" role="alert">{error}</p>}
      {result.status === "loading" && <p className="muted" role="status">Loading your inquiries…</p>}
      {result.status === "error" && <button className="button button--secondary" type="button" onClick={() => void loadInquiries()}>Try again</button>}
      {result.status === "success" && items.length === 0 && <section className="workspace-state"><h2>No inquiries yet</h2><p className="muted">When you contact a seller, the conversation will appear here.</p><Link className="button" to="/">Explore listings</Link></section>}
      {result.status === "success" && items.length > 0 && <>
        <section className="workspace-inquiry-list" aria-label="Your inquiries">
          {items.map((inquiry) => {
            const listing = inquiry.listing;
            const listingState = getBuyerInquiryListingState(listing);
            const messagesParams = new URLSearchParams({ filter: "buying", inquiryId: inquiry.id });
            if (listing?.id) messagesParams.set("listingId", listing.id);
            return <article className="workspace-buyer-inquiry" key={inquiry.id}>
              {listing?.imageUrl ? <img className="workspace-buyer-inquiry__image" src={listing.imageUrl} alt={listing.title || "Listing"} /> : <div className="workspace-buyer-inquiry__image workspace-listing__image--empty">No image</div>}
              <div className="workspace-buyer-inquiry__content">
                <div className="workspace-listing__heading"><div><p className="eyebrow">{listing?.category || "Marketplace listing"}{listing?.status ? ` · ${listing.status.toLowerCase()}` : ""}</p><h2>{listing?.title || "Listing details unavailable"}</h2></div><span className="workspace-status">{inquiry.status?.toLowerCase() || "open"}</span></div>
                <p className="muted">Seller: {inquiry.seller?.name || "Campus Marketplace seller"}</p>
                {inquiry.seller?.id && <Link className="text-link" to={`/sellers/${encodeURIComponent(inquiry.seller.id)}`}>View seller profile</Link>}
                <p className="muted">Started {formatDate(inquiry.createdAt)} · Latest activity {formatDate(inquiry.latestMessageAt || inquiry.updatedAt)}</p>
                <p className={inquiry.sellerHasReplied ? "inquiry-reply-status inquiry-reply-status--replied" : "inquiry-reply-status"}>{inquiry.sellerHasReplied ? "Seller has replied" : "Waiting for seller reply"}</p>
                {inquiry.unreadMessageCount > 0 && <span className="workspace-unread-badge" aria-label={`${inquiry.unreadMessageCount} unread seller messages`}>{inquiry.unreadMessageCount} unread seller message{inquiry.unreadMessageCount === 1 ? "" : "s"}</span>}
                {listingState.href
                  ? <Link className="text-link" to={listingState.href}>View listing</Link>
                  : <p className="workspace-unavailable" role="status">{listingState.message}</p>}
                <p className="workspace-inquiry__message">{inquiry.latestMessage || inquiry.message || "No messages yet."}</p>
                <div className="workspace-actions"><Link className="button button--secondary" to={`/messages?${messagesParams.toString()}`}>Open in Messages</Link></div>
              </div>
            </article>;
          })}
        </section>
        {totalPages > 1 && <nav className="workspace-pagination" aria-label="My Inquiries pages"><button className="button button--secondary" type="button" disabled={page <= 1 || result.status === "loading"} onClick={() => { const next = new URLSearchParams(searchParams); next.set("page", String(page - 1)); next.delete("inquiryId"); setSearchParams(next); }}>Previous</button><span>Page {result.meta.page || page} of {totalPages}</span><button className="button button--secondary" type="button" disabled={page >= totalPages || result.status === "loading"} onClick={() => { const next = new URLSearchParams(searchParams); next.set("page", String(page + 1)); next.delete("inquiryId"); setSearchParams(next); }}>Next</button></nav>}
      </>}
    </div>
  );
}
