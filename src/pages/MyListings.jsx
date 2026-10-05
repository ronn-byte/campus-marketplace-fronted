import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getApiErrorMessage } from "../services/apiClient";
import {
  getListingInquiries,
  getMyListings,
  markListingSold,
  releaseListingReservation,
  reserveListing,
  updateListingInquiryStatus,
} from "../services/listingService";
import { useAuth } from "../hooks/useAuth";

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

function InquiryPanel({ listingId, data, onStatusChange, pendingInquiryId }) {
  if (data?.status === "loading") {
    return <p className="muted" role="status">Loading inquiries…</p>;
  }
  if (data?.status === "error") {
    return <p className="form-alert" role="alert">{data.message}</p>;
  }
  if (!data || data.items.length === 0) {
    return <p className="muted">There are no inquiries for this listing yet.</p>;
  }

  return (
    <div className="workspace-inquiry-list">
      {data.items.map((inquiry) => (
        <article className="workspace-inquiry" key={inquiry.id}>
          <div className="workspace-inquiry__heading">
            <div>
              <strong>{inquiry.buyer?.name || "MUT student"}</strong>
              <p className="muted">{inquiry.buyer?.verified ? "Verified student" : "Student buyer"} · {formatDate(inquiry.createdAt)}</p>
            </div>
            <StatusBadge status={inquiry.status} />
          </div>
          <p className="workspace-inquiry__message">{inquiry.message}</p>
          {inquiry.status === "OPEN" && (
            <div className="workspace-actions">
              <button className="button button--quiet" type="button" disabled={pendingInquiryId === inquiry.id} onClick={() => onStatusChange(listingId, inquiry.id, "RESPONDED")}>
                {pendingInquiryId === inquiry.id ? "Updating…" : "Mark responded"}
              </button>
              <button className="button button--secondary" type="button" disabled={pendingInquiryId === inquiry.id} onClick={() => onStatusChange(listingId, inquiry.id, "CLOSED")}>Close</button>
            </div>
          )}
          {inquiry.status === "RESPONDED" && (
            <button className="button button--secondary" type="button" disabled={pendingInquiryId === inquiry.id} onClick={() => onStatusChange(listingId, inquiry.id, "CLOSED")}>
              {pendingInquiryId === inquiry.id ? "Updating…" : "Close inquiry"}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

export default function MyListings() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ status: "idle", items: [], meta: null });
  const [pageError, setPageError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingListingId, setPendingListingId] = useState(null);
  const [pendingInquiryId, setPendingInquiryId] = useState(null);
  const [expandedListingId, setExpandedListingId] = useState(null);
  const [inquiriesByListing, setInquiriesByListing] = useState({});

  const loadListings = useCallback(async (requestedPage = page) => {
    setResult((current) => ({ ...current, status: "loading" }));
    setPageError("");
    try {
      const data = await getMyListings({ page: requestedPage });
      setResult({ status: "success", ...data });
    } catch (error) {
      setResult((current) => ({ ...current, status: "error" }));
      setPageError(getApiErrorMessage(error));
    }
  }, [page]);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) loadListings(page);
  }, [isAuthLoading, isAuthenticated, loadListings, page]);

  const handleListingAction = async (listing, action, successMessage) => {
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

  const openInquiries = async (listingId) => {
    if (expandedListingId === listingId) {
      setExpandedListingId(null);
      return;
    }
    setExpandedListingId(listingId);
    setInquiriesByListing((current) => ({
      ...current,
      [listingId]: { status: "loading", items: [] },
    }));
    try {
      const inquiries = await getListingInquiries(listingId);
      setInquiriesByListing((current) => ({
        ...current,
        [listingId]: { status: "success", items: inquiries },
      }));
    } catch (error) {
      setInquiriesByListing((current) => ({
        ...current,
        [listingId]: { status: "error", message: getApiErrorMessage(error), items: [] },
      }));
    }
  };

  const handleInquiryStatus = async (listingId, inquiryId, status) => {
    setPendingInquiryId(inquiryId);
    setMessage("");
    try {
      await updateListingInquiryStatus(listingId, inquiryId, status);
    } catch (error) {
      setInquiriesByListing((current) => ({
        ...current,
        [listingId]: {
          status: "error",
          message: getApiErrorMessage(error),
          items: current[listingId]?.items || [],
        },
      }));
      setPendingInquiryId(null);
      return;
    }

    setMessage("Inquiry status updated.");
    try {
      const inquiries = await getListingInquiries(listingId);
      setInquiriesByListing((current) => ({
        ...current,
        [listingId]: { status: "success", items: inquiries },
      }));
    } catch (error) {
      setInquiriesByListing((current) => ({
        ...current,
        [listingId]: {
          status: "success",
          items: current[listingId]?.items || [],
        },
      }));
      setPageError(`Inquiry updated, but the list could not be refreshed. ${getApiErrorMessage(error)}`);
    } finally {
      setPendingInquiryId(null);
    }
  };

  if (isAuthLoading) {
    return <div className="page-shell"><p className="muted" role="status">Checking your sign-in status…</p></div>;
  }
  if (!isAuthenticated) {
    return <div className="page-shell"><SignInPrompt /></div>;
  }

  const totalPages = Number(result.meta?.totalPages) || 1;

  return (
    <div className="page-shell workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Seller workspace</p>
          <h1>My Listings</h1>
          <p className="muted">Manage your items and follow up on buyer inquiries.</p>
        </div>
        <Link to="/post-item" className="button button--small">Sell an item</Link>
      </div>
      {message && <p className="preview-note" role="status">{message}</p>}
      {pageError && <p className="form-alert" role="alert">{pageError}</p>}
      {result.status === "loading" && <p className="muted" role="status">Loading your listings…</p>}
      {result.status === "error" && (
        <button className="button button--secondary" type="button" onClick={() => loadListings(page)}>Try again</button>
      )}
      {result.status === "success" && result.items.length === 0 && (
        <section className="workspace-state">
          <h2>No listings yet</h2>
          <p className="muted">Items you post will appear here, including their current status.</p>
          <Link className="button" to="/post-item">Post your first item</Link>
        </section>
      )}
      {result.status === "success" && result.items.length > 0 && (
        <>
          <div className="workspace-list">
            {result.items.map((listing) => (
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
                  <div className="workspace-actions">
                    {listing.status === "PUBLISHED" && <>
                      <button className="button button--quiet" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, reserveListing, "Listing reserved.")}>{pendingListingId === listing.id ? "Updating…" : "Reserve"}</button>
                      <button className="button button--secondary" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, markListingSold, "Listing marked as sold.")}>{pendingListingId === listing.id ? "Updating…" : "Mark as sold"}</button>
                    </>}
                    {listing.status === "RESERVED" && <>
                      <button className="button button--quiet" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, releaseListingReservation, "Reservation released.")}>{pendingListingId === listing.id ? "Updating…" : "Release reservation"}</button>
                      <button className="button button--secondary" type="button" disabled={pendingListingId === listing.id} onClick={() => handleListingAction(listing, markListingSold, "Listing marked as sold.")}>{pendingListingId === listing.id ? "Updating…" : "Mark as sold"}</button>
                    </>}
                    <button className="button button--secondary" type="button" aria-expanded={expandedListingId === listing.id} onClick={() => openInquiries(listing.id)}>
                      {expandedListingId === listing.id ? "Hide inquiries" : "View inquiries"}
                    </button>
                  </div>
                  {expandedListingId === listing.id && (
                    <section className="workspace-inquiries" aria-label={`Inquiries for ${listing.title}`}>
                      <h3>Buyer inquiries</h3>
                      <InquiryPanel
                        listingId={listing.id}
                        data={inquiriesByListing[listing.id]}
                        onStatusChange={handleInquiryStatus}
                        pendingInquiryId={pendingInquiryId}
                      />
                    </section>
                  )}
                </div>
              </article>
            ))}
          </div>
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
