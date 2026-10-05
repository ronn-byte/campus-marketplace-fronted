import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Button from "../components/Button";
import { getApiErrorMessage } from "../services/apiClient";
import { getListingById } from "../services/listingService";

export default function ListingDetails() {
  const { id } = useParams();
  const [state, setState] = useState({ status: "loading" });

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
          <Button type="button" disabled>Contact seller</Button>
          <p className="preview-note">Contacting sellers is not available yet.</p>
        </section>
      </div>
    </div>
  );
}
