import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getApiErrorMessage } from "../services/apiClient";
import {
  getMyListings,
  getInquiryUnreadSummary,
  markListingSold,
  removeListing,
  releaseListingReservation,
  reserveListing,
} from "../services/listingService";
import { getListingRemovalAction } from "../services/listingRemoval";

const TABS = [
  { id: "all", label: "All", status: "ALL", countKey: "all" },
  { id: "active", label: "Active", status: "PUBLISHED", countKey: "active" },
  { id: "drafts", label: "Drafts", status: "DRAFT", countKey: "drafts" },
  { id: "reserved", label: "Reserved", status: "RESERVED", countKey: "reserved" },
  { id: "sold", label: "Sold", status: "SOLD", countKey: "sold" },
  { id: "suspended", label: "Suspended", status: "SUSPENDED", countKey: "other" },
  { id: "archive", label: "Removed archive", status: "REMOVED", countKey: "archive" },
];

const PRIMARY_TILES = [
  { id: "active", label: "Active", countKey: "active", dot: "active" },
  { id: "drafts", label: "Drafts", countKey: "drafts", dot: "drafts" },
  { id: "reserved", label: "Reserved", countKey: "reserved", dot: "reserved" },
  { id: "archive", label: "Removed", countKey: "archive", dot: "removed" },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date unavailable" : dateFormatter.format(date);
}

function StatusBadge({ status }) {
  const label = status ? status.replaceAll("_", " ").toLowerCase() : "unknown";
  return <span className={`workspace-status workspace-status--${status?.toLowerCase() || "unknown"}`}>{label}</span>;
}

function SignInPrompt() {
  return (
    <section className="workspace-state">
      <h1>Sign in to manage your listings</h1>
      <p className="muted">Your seller workspace is available after you sign in.</p>
      <Link className="button" to="/login">Sign in</Link>
    </section>
  );
}

export default function MyListings() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState("all");
  const [result, setResult] = useState({ status: "idle", items: [], meta: null });
  const [pageError, setPageError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingListingId, setPendingListingId] = useState(null);
  const [unreadSummary, setUnreadSummary] = useState(null);
  const listingsRequestSequence = useRef(0);

  const loadListings = useCallback(async (requestedPage = page) => {
    const requestSequence = ++listingsRequestSequence.current;
    setResult({ status: "loading", items: [], meta: null });
    setPageError("");
    try {
      const selectedTab = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];
      const data = await getMyListings({ page: requestedPage, pageSize: 50, status: selectedTab.status });
      if (requestSequence !== listingsRequestSequence.current) return;
      setResult({ status: "success", ...data });
    } catch (error) {
      if (requestSequence !== listingsRequestSequence.current) return;
      setResult((current) => ({ ...current, status: "error" }));
      setPageError(getApiErrorMessage(error));
    }
  }, [activeTab, page]);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) {
      loadListings(page);
      getInquiryUnreadSummary().then(setUnreadSummary).catch(() => setUnreadSummary(null));
    }
  }, [isAuthLoading, isAuthenticated, loadListings, page]);

  const handleListingAction = async (listing, action, successMessage) => {
    if (pendingListingId === listing.id) return;
    setPendingListingId(listing.id);
    setMessage("");
    setPageError("");
    try {
      await action(listing.id);
      setMessage(successMessage);
      await loadListings(page);
    } catch (error) {
      setPageError(getApiErrorMessage(error));
    } finally {
      setPendingListingId(null);
    }
  };

  const handleListingRemoval = (listing) => {
    const removal = getListingRemovalAction(listing.status);
    if (!removal || pendingListingId === listing.id) return;
    if (!window.confirm(removal.confirmation)) return;
    return handleListingAction(listing, removeListing, removal.successMessage);
  };

  const tabCounts = result.meta?.statusCounts ?? {};
  const visibleListings = useMemo(() => result.items, [result.items]);

  const handlePrimaryTileClick = (tileId) => {
    setPage(1);
    setActiveTab((current) => current === tileId ? "all" : tileId);
  };

  if (isAuthLoading) {
    return <div className="page-shell"><p className="muted" role="status">Checking your sign-in status…</p></div>;
  }
  if (!isAuthenticated) return <div className="page-shell"><SignInPrompt /></div>;

  const totalPages = Number(result.meta?.totalPages) || 1;
  const currentTab = TABS.find((tab) => tab.id === activeTab) ?? TABS[0];

  return (
    <div className="page-shell workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Seller workspace</p>
          <h1>Seller Inventory</h1>
          <p className="muted">Manage your products, monitor buyer interest and respond to conversations.</p>
        </div>
        <Link to="/post-item" className="button button--small">Sell an item</Link>
      </div>
      {unreadSummary?.seller && <p className="workspace-unread-summary" role="status"><strong>Unread buyer activity:</strong> {unreadSummary.seller.threads} conversation{unreadSummary.seller.threads === 1 ? "" : "s"} · {unreadSummary.seller.messages} message{unreadSummary.seller.messages === 1 ? "" : "s"}</p>}

      {message && <p className="preview-note" role="status">{message}</p>}
      {pageError && <p className="form-alert" role="alert">{pageError}</p>}
      {result.status === "loading" && <p className="muted" role="status">Loading your listings…</p>}
      {result.status === "error" && (
        <button className="button button--secondary" type="button" onClick={() => loadListings(page)}>Try again</button>
      )}

      {result.status === "success" && (
        <>
          <section className="seller-status-tiles" aria-label="Primary inventory status filters">
            {PRIMARY_TILES.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className={`seller-status-tile${activeTab === tile.id ? " seller-status-tile--active" : ""}`}
                aria-pressed={activeTab === tile.id}
                onClick={() => handlePrimaryTileClick(tile.id)}
              >
                <span className={`seller-status-tile__dot seller-status-tile__dot--${tile.dot}`} aria-hidden="true" />
                <span className="seller-status-tile__label">{tile.label}</span>
                <strong className="seller-status-tile__count">{tabCounts[tile.countKey] ?? 0}</strong>
              </button>
            ))}
          </section>
          <div className="inventory-tabs" role="tablist" aria-label="Listing inventory status">
            {TABS.map((tab) => (
              <button
                className={`inventory-tab${activeTab === tab.id ? " inventory-tab--active" : ""}`}
                id={`inventory-tab-${tab.id}`}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls="inventory-panel"
                onClick={() => {
                  setPage(1);
                  setActiveTab(tab.id);
                }}
              >
                {tab.label} <span>{tabCounts[tab.countKey] ?? 0}</span>
              </button>
            ))}
          </div>

          <section id="inventory-panel" role="tabpanel" aria-labelledby={`inventory-tab-${currentTab.id}`}>
            {result.status === "success" && visibleListings.length === 0 ? (
              <section className="workspace-state">
                {tabCounts.all === 0 && tabCounts.archive === 0 ? (
                  <>
                    <h2>No listings yet</h2>
                    <p className="muted">Items you post will appear here, including their current status.</p>
                    <Link className="button" to="/post-item">Post your first item</Link>
                  </>
                ) : (
                  <>
                    <h2>{activeTab === "all" ? "No current listings" : `No ${currentTab.label.toLowerCase()} listings on this page`}</h2>
                    <p className="muted">{activeTab === "all" && tabCounts.archive > 0
                      ? `${tabCounts.archive} removed listing${tabCounts.archive === 1 ? " is" : "s are"} available in the Removed archive.`
                      : "Try another inventory status filter."}</p>
                  </>
                )}
              </section>
            ) : (
              <div className="workspace-list">
                {visibleListings.map((listing) => {
                  const removal = getListingRemovalAction(listing.status);
                  return (
                    <article className="workspace-listing" key={listing.id}>
                      {listing.imageUrl
                        ? <img className="workspace-listing__image" src={listing.imageUrl} alt={listing.title} />
                        : <div className="workspace-listing__image workspace-listing__image--empty" aria-label="No listing image available">No image</div>}
                      <div className="workspace-listing__content">
                        <div className="workspace-listing__heading">
                          <div>
                            <p className="eyebrow">{listing.category} · {listing.condition || "Condition unavailable"}</p>
                            <h2>{listing.title}</h2>
                          </div>
                          <StatusBadge status={listing.status} />
                        </div>
                        <p className="workspace-listing__price">KSh {listing.price.toLocaleString()}</p>
                        <p className="muted">{listing.location || "Location unavailable"}{listing.createdAt ? ` · Posted ${formatDate(listing.createdAt)}` : ""}</p>

                        <div className="listing-inquiry-metrics" aria-label={`Inquiry activity for ${listing.title}`}>
                          <Link className="listing-inquiry-metrics__link" to={`/messages?filter=selling&listingId=${encodeURIComponent(listing.id)}`}>
                            <strong>{listing.inquiryCount ?? 0}</strong> {listing.inquiryCount === 1 ? "inquiry" : "inquiries"}
                          </Link>
                          <span className={listing.unreadInquiryCount > 0 ? "listing-inquiry-metrics__unread" : ""}>
                            <strong>{listing.unreadInquiryCount ?? 0}</strong> unread {listing.unreadInquiryCount === 1 ? "conversation" : "conversations"}
                          </span>
                          <Link className="button button--secondary button--small" to={`/messages?filter=selling&listingId=${encodeURIComponent(listing.id)}`}>Open Messages</Link>
                        </div>

                        <div className="workspace-actions">
                          {listing.status === "PUBLISHED" && <Link className="button button--quiet" to={`/listing/${encodeURIComponent(listing.id)}`}>View listing</Link>}
                          {listing.status === "DRAFT" && (
                            <Link className="button button--quiet" to={`/post-item?edit=${encodeURIComponent(listing.id)}`}>Edit draft</Link>
                          )}
                          {removal && (
                            <button
                              className="button button--secondary"
                              type="button"
                              disabled={pendingListingId === listing.id}
                              onClick={() => handleListingRemoval(listing)}
                            >
                              {pendingListingId === listing.id ? "Removing…" : removal.label}
                            </button>
                          )}
                          {listing.status === "PUBLISHED" && <>
                            <Link className="button button--quiet" to={`/post-item?edit=${encodeURIComponent(listing.id)}`}>Edit listing</Link>
                            <button className="button button--quiet" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, reserveListing, "Listing reserved.")}>Reserve</button>
                            <button className="button button--secondary" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, markListingSold, "Listing marked as sold.")}>Mark as sold</button>
                          </>}
                          {listing.status === "RESERVED" && <>
                            <button className="button button--quiet" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, releaseListingReservation, "Reservation released.")}>Release reservation</button>
                            <button className="button button--secondary" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, markListingSold, "Listing marked as sold.")}>Mark as sold</button>
                          </>}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          {totalPages > 1 && (
            <nav className="workspace-pagination" aria-label="Listings pages">
              <button className="button button--secondary" type="button" disabled={page <= 1 || result.status === "loading"} onClick={() => setPage((current) => current - 1)}>Previous</button>
              <span>Page {result.meta.page || page} of {totalPages}</span>
              <button className="button button--secondary" type="button" disabled={page >= totalPages || result.status === "loading"} onClick={() => setPage((current) => current + 1)}>Next</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
