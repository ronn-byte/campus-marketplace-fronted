import { Link, useParams } from "react-router-dom";
import Button from "../components/Button";
import { previewListings } from "../services/listingService";

export default function ListingDetails() {
  const { id } = useParams();
  const listing = previewListings.find((item) => item.id === id) || previewListings[0];

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
          <Button type="button">Contact seller</Button>
          <p className="preview-note">This detail view is using preview data until the listings API is connected. Contacting a seller will require the backend messaging service.</p>
        </section>
      </div>
    </div>
  );
}
