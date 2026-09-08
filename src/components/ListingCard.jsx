import { Link } from "react-router-dom";
import Button from "./Button";

export default function ListingCard({ listing }) {
  return (
    <article className="listing-card">
      <div className="listing-card__image-wrap">
        <img className="listing-card__image" src={listing.imageUrl} alt={listing.title} loading="lazy" />
        <span className="badge">{listing.category}</span>
        <button className="icon-button listing-card__favorite" type="button" aria-label={`Save ${listing.title}`}>
          ♡
        </button>
      </div>
      <div className="listing-card__body">
        <div className="listing-card__meta">
          <span>{listing.condition}</span>
          <span>{listing.location}</span>
        </div>
        <h3>{listing.title}</h3>
        <p className="listing-card__description">{listing.description}</p>
        <div className="listing-card__footer">
          <div>
            <strong>KSh {listing.price.toLocaleString()}</strong>
            <span className="seller-line">{listing.seller.name}{listing.seller.verified ? " · Verified" : ""}</span>
          </div>
          <Link to={`/listing/${listing.id}`} className="button button--quiet">View</Link>
        </div>
      </div>
    </article>
  );
}
