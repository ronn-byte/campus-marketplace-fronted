import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import { getApiErrorMessage } from "../services/apiClient";
import { createListingInquiry, getListingById } from "../services/listingService";

export default function ListingDetails() {
  const { id } = useParams();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [state, setState] = useState({ status: "loading" });
  const [message, setMessage] = useState("");
  const [inquiryState, setInquiryState] = useState({ status: "idle" });

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });

    getListingById(id)
      .then((listing) => {
        if (active) setState({ status: "found", listing });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          status: error.response?.status === 404 ? "unavailable" : "error",
          message: error.response?.status === 404
            ? "This listing was not found or is no longer available."
            : getApiErrorMessage(error),
        });
      });

    return () => {
      active = false;
    };
  }, [id]);

  const handleInquirySubmit = async (event) => {
    event.preventDefault();
    setInquiryState({ status: "submitting" });

    try {
      await createListingInquiry(id, message);
      setMessage("");
      setInquiryState({
        status: "success",
        message: "Your inquiry has been sent to the seller.",
      });
    } catch (error) {
      setInquiryState({
        status: "error",
        message: getApiErrorMessage(error),
      });
    }
  };

  if (state.status === "loading") {
    return (
      <div className="page-shell listing-detail">
        <Link className="text-link" to="/">← Back to listings</Link>
        <p className="muted" role="status">Loading listing…</p>
      </div>
    );
  }

  if (state.status === "unavailable") {
    return (
      <div className="page-shell listing-detail">
        <Link className="text-link" to="/">← Back to listings</Link>
        <section role="status">
          <h1>Listing unavailable</h1>
          <p className="muted">{state.message}</p>
        </section>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="page-shell listing-detail">
        <Link className="text-link" to="/">← Back to listings</Link>
        <section role="alert">
          <h1>Unable to load listing</h1>
          <p className="muted">{state.message}</p>
        </section>
      </div>
    );
  }

  const { listing } = state;

  return (
    <div className="page-shell listing-detail">
      <Link className="text-link" to="/">← Back to listings</Link>
      <div className="listing-detail__grid">
        <img src={listing.imageUrl} alt={listing.title} className="listing-detail__image" />
        <section>
          <p className="eyebrow">{listing.category} · {listing.condition}</p>
          <h1>{listing.title}</h1>
          <strong className="listing-detail__price">KSh {listing.price.toLocaleString()}</strong>
          <p className="muted">{listing.description}</p>
          <p className="listing-detail__location">Meet around {listing.location}</p>
          <div className="listing-detail__seller"><span className="avatar">MS</span><span><strong>{listing.seller.name}</strong><small>{listing.seller.verified ? "Verified student" : "Student seller"}</small></span></div>
          {isAuthLoading ? (
            <p className="muted" role="status">Checking your sign-in status…</p>
          ) : isAuthenticated ? (
            <form onSubmit={handleInquirySubmit}>
              {inquiryState.status === "success" && (
                <p className="preview-note" role="status">{inquiryState.message}</p>
              )}
              {inquiryState.status === "error" && (
                <p className="form-alert" role="alert">{inquiryState.message}</p>
              )}
              <div className="field">
                <label htmlFor="listing-inquiry-message">Message to the seller</label>
                <textarea
                  id="listing-inquiry-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  minLength={1}
                  maxLength={2000}
                  required
                  disabled={inquiryState.status === "submitting"}
                />
              </div>
              <Button type="submit" disabled={inquiryState.status === "submitting"}>
                {inquiryState.status === "submitting" ? "Sending…" : "Send inquiry"}
              </Button>
            </form>
          ) : (
            <div>
              <p className="muted">Sign in to ask the seller about this listing.</p>
              <Link className="text-link" to="/login">Log in to send an inquiry</Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
