import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

const digits = (value) => typeof value === "string" ? value.replace(/\D/g, "") : "";

export default function SellerProfile() {
  const { sellerId } = useParams();
  const location = useLocation();
  const backPath = location.state?.from || "/";
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let active = true;
    apiClient.get(`/sellers/${encodeURIComponent(sellerId)}`)
      .then(({ data }) => { if (active) setState({ status: "found", profile: data.profile }); })
      .catch((error) => {
        if (!active) return;
        setState({ status: error.response?.status === 404 ? "missing" : "error", message: getApiErrorMessage(error) });
      });
    return () => { active = false; };
  }, [sellerId]);

  if (state.status === "loading") return <div className="page-shell"><p role="status">Loading seller profile...</p></div>;
  if (state.status !== "found") return <div className="page-shell"><Link className="text-link" to={backPath}>← Back to listing</Link><h1>{state.status === "missing" ? "Seller unavailable" : "Unable to load profile"}</h1><p role="alert">{state.message}</p></div>;

  const { profile } = state;
  const phone = digits(profile.phoneNumber);
  const whatsapp = digits(profile.whatsappNumber);
  const validContact = (value) => value.length >= 7 && value.length <= 15;
  return (
    <div className="page-shell seller-profile">
      <Link className="text-link" to={backPath}>← Back to listing</Link>
      <section className="profile-card seller-profile__card">
        {profile.avatarUrl && <img className="seller-profile__avatar" src={profile.avatarUrl} alt="" />}
        <p className="eyebrow">Seller profile</p>
        <h1>{profile.name}</h1>
        {profile.description && <p className="seller-profile__description">{profile.description}</p>}
        <div className="seller-profile__contacts">
          {validContact(phone) && <a className="button button--secondary" href={`tel:+${phone}`}>Call seller</a>}
          {validContact(whatsapp) && <a className="button" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">Message on WhatsApp</a>}
          {!validContact(phone) && !validContact(whatsapp) && <p className="muted">This seller has not added public contact details.</p>}
        </div>
      </section>
    </div>
  );
}
