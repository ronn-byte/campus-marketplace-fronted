import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { getApiErrorMessage } from "../services/apiClient";
import { getMyInquiries } from "../services/listingService";

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

export default function MyInquiries() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ status: "idle", items: [], meta: null });
  const [errorMessage, setErrorMessage] = useState("");

  const loadInquiries = useCallback(async (requestedPage = page) => {
    setResult((current) => ({ ...current, status: "loading" }));
    setErrorMessage("");
    try {
      const data = await getMyInquiries({ page: requestedPage });
      setResult({ status: "success", ...data });
    } catch (error) {
      setResult((current) => ({ ...current, status: "error" }));
      setErrorMessage(getApiErrorMessage(error));
    }
  }, [page]);

  useEffect(() => {
    if (!isAuthLoading && isAuthenticated) loadInquiries(page);
  }, [isAuthLoading, isAuthenticated, loadInquiries, page]);

  if (isAuthLoading) {
    return <div className="page-shell"><p className="muted" role="status">Checking your sign-in status…</p></div>;
  }
  if (!isAuthenticated) {
    return (
      <div className="page-shell">
        <section className="workspace-state">
          <h1>Sign in to see your inquiries</h1>
          <p className="muted">Your inquiry history is available after you sign in.</p>
          <Link className="button" to="/login">Sign in</Link>
        </section>
      </div>
    );
  }

  const totalPages = Number(result.meta?.totalPages) || 1;

  return (
    <div className="page-shell workspace-page">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Buyer workspace</p>
          <h1>My Inquiries</h1>
          <p className="muted">Keep track of the messages you have sent to sellers.</p>
        </div>
        <Link to="/" className="button button--small">Explore listings</Link>
      </div>
      {errorMessage && <p className="form-alert" role="alert">{errorMessage}</p>}
      {result.status === "loading" && <p className="muted" role="status">Loading your inquiries…</p>}
      {result.status === "error" && (
        <button className="button button--secondary" type="button" onClick={() => loadInquiries(page)}>Try again</button>
      )}
      {result.status === "success" && result.items.length === 0 && (
        <section className="workspace-state">
          <h2>No inquiries yet</h2>
          <p className="muted">When you contact a seller, your inquiry and its status will be listed here.</p>
          <Link className="button" to="/">Explore listings</Link>
        </section>
      )}
      {result.status === "success" && result.items.length > 0 && (
        <>
          <div className="workspace-inquiry-list">
            {result.items.map((inquiry) => {
              const listing = inquiry.listing;
              const isAvailable = listing?.status === "PUBLISHED";
              return (
                <article className="workspace-buyer-inquiry" key={inquiry.id}>
                  {listing?.imageUrl
                    ? <img className="workspace-buyer-inquiry__image" src={listing.imageUrl} alt={listing.title || "Listing"} />
                    : <div className="workspace-buyer-inquiry__image workspace-listing__image--empty" aria-label="No listing image available">No image</div>}
                  <div className="workspace-buyer-inquiry__content">
                    <div className="workspace-listing__heading">
                      <div>
                        <p className="eyebrow">{listing?.category || "Marketplace listing"}{listing?.status ? ` · ${listing.status.toLowerCase()}` : ""}</p>
                        <h2>{listing?.title || "Listing details unavailable"}</h2>
                      </div>
                      <StatusBadge status={inquiry.status} />
                    </div>
                    <p className="muted">Sent {formatDate(inquiry.createdAt)}</p>
                    <p className="workspace-inquiry__message">{inquiry.message}</p>
                    {listing?.status === "SOLD" || listing?.status === "REMOVED" ? (
                      <p className="workspace-unavailable" role="status">This listing is {listing.status.toLowerCase()}; your inquiry history is still available.</p>
                    ) : isAvailable ? (
                      <Link className="text-link" to={`/listing/${encodeURIComponent(listing.id)}`}>View listing</Link>
                    ) : (
                      <p className="workspace-unavailable" role="status">This listing is not currently available to view.</p>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {totalPages > 1 && (
            <nav className="workspace-pagination" aria-label="Inquiry pages">
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
