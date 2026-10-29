import { useState } from "react";
import { Link } from "react-router-dom";

const conditionLabels = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  USED: "Used",
};

export default function ListingCard({ listing }) {
  const imageUrl = listing.imageUrl;
  const [failedImageUrl, setFailedImageUrl] = useState(null);
  const imageFailed = failedImageUrl === imageUrl;
  const condition = conditionLabels[listing.condition] ?? listing.condition ?? "Condition unavailable";
  const seller = listing.seller ?? { name: "MUT student", verified: false };

  return (
    <article className="listing-card">
      <div className="listing-card__image-wrap">
        {imageUrl && !imageFailed ? (
          <img
            className="listing-card__image"
            src={imageUrl}
            alt={listing.title ? `${listing.title} listing photo` : "Listing photo"}
            loading="lazy"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : (
          <div className="listing-card__image-fallback" role="img" aria-label="Listing photo unavailable">
            <svg viewBox="0 0 32 32" aria-hidden="true"><rect x="4" y="6" width="24" height="20" rx="3" /><circle cx="12" cy="13" r="2" /><path d="m6 23 7-6 4 4 4-4 5 5" /></svg>
            <span>Photo unavailable</span>
          </div>
        )}
        <button className="icon-button listing-card__favorite" type="button" aria-label={`Save ${listing.title}`}>
          ♡
        </button>
      </div>
      <div className="listing-card__body">
        <div className="listing-card__meta">
          <span className="listing-card__category">{listing.category || "Category unavailable"}</span>
          <span className="listing-card__condition">{condition}</span>
        </div>
        <h3>{listing.title}</h3>
        <p className="listing-card__description">{listing.description}</p>
        <p className="listing-card__location">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>
          <span>{listing.location ? `Pickup: ${listing.location}` : "Location unavailable"}</span>
        </p>
        <div className="listing-card__footer">
          <div className="listing-card__seller-price">
            <strong>KSh {Number(listing.price ?? 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}</strong>
            <span className="seller-line">
              {seller.id ? <Link to={`/sellers/${seller.id}`} state={{ from: "/", listingId: listing.id }} onClick={(event) => event.stopPropagation()}>{seller.name || "MUT Market seller"}</Link> : (seller.name || "MUT Market seller")}
              {seller.verified === true && <span className="listing-card__verified"><span aria-hidden="true">✓</span> Verified</span>}
            </span>
          </div>
          <Link to={`/listing/${listing.id}`} className="button button--quiet">View</Link>
        </div>
      </div>
    </article>
  );
}
