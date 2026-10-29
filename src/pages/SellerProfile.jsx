import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import apiClient, { getApiErrorMessage } from "../services/apiClient";
import { getListingById } from "../services/listingService";
import {
  buildWhatsAppUrl,
  getListingIdFromNavigationState,
  isValidListingId,
  isValidWhatsAppNumber,
  normalizeWhatsAppNumber,
} from "../services/whatsapp";

export default function SellerProfile() {
  const { sellerId } = useParams();
  const location = useLocation();
  const backPath = location.state?.from || "/";
  const listingId = getListingIdFromNavigationState(location.state);
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;
    const listingRequest = isValidListingId(listingId)
      ? getListingById(listingId).catch(() => null)
      : Promise.resolve(null);

    Promise.all([
      apiClient.get(`/sellers/${encodeURIComponent(sellerId)}`),
      listingRequest,
    ])
      .then(([{ data }, listing]) => {
        if (!active) return;
        const listingContext = listing?.seller?.id === sellerId && listing.id === listingId
          ? { id: listing.id, title: listing.title }
          : null;
        setState({ status: "found", profile: data.profile, listing: listingContext });
      })
      .catch((error) => {
        if (!active) return;
        setState({ status: error.response?.status === 404 ? "missing" : "error", message: getApiErrorMessage(error) });
      });
    return () => { active = false; };
  }, [listingId, sellerId]);

  if (state.status === "loading") return <div className="page-shell"><p role="status">Loading seller profile...</p></div>;
  if (state.status !== "found") return <div className="page-shell"><Link className="text-link" to={backPath}>← Back to listing</Link><h1>{state.status === "missing" ? "Seller unavailable" : "Unable to load profile"}</h1><p role="alert">{state.message}</p></div>;

  const { profile } = state;
  const phone = normalizeWhatsAppNumber(profile.phoneNumber);
  const whatsapp = normalizeWhatsAppNumber(profile.whatsappNumber);
  const whatsappUrl = buildWhatsAppUrl({ phoneNumber: whatsapp, listing: state.listing });
  return (
    <div className="page-shell seller-profile">
      <Link className="text-link" to={backPath}>← Back to listing</Link>
      <section className="profile-card seller-profile__card">
        {profile.avatarUrl && <img className="seller-profile__avatar" src={profile.avatarUrl} alt="" />}
        <p className="eyebrow">Seller profile</p>
        <h1>{profile.name}</h1>
        {profile.description && <p className="seller-profile__description">{profile.description}</p>}
        <div className="seller-profile__contacts">
          {isValidWhatsAppNumber(phone) && <a className="button button--secondary" href={`tel:+${phone}`}>Call seller</a>}
          {whatsappUrl && <a className="button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>}
          {!isValidWhatsAppNumber(phone) && !whatsappUrl && <p className="muted">This seller has not added public contact details.</p>}
        </div>
      </section>
    </div>
  );
}
