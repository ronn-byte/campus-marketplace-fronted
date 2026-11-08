import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ListingCard from "./ListingCard.jsx";
import { getListings } from "../services/listingService.js";

export default function CategorySection({ category }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const trackRef = useRef(null);
  const slug = category.slug || category.id;

  useEffect(() => {
    let active = true;
    getListings({ categoryId: category.id, page: 1, pageSize: 8, sort: "newest" })
      .then((result) => {
        if (active) setItems(result.items);
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [category.id]);

  const scroll = (direction) => {
    if (!trackRef.current) return;
    trackRef.current.scrollBy({
      left: direction * trackRef.current.clientWidth * 0.8,
      behavior: "smooth",
    });
  };

  return (
    <section className="category-section" aria-labelledby={`category-${category.id}`}>
      <div className="section-heading category-section__heading">
        <div>
          <p className="eyebrow">Explore the marketplace</p>
          <h2 id={`category-${category.id}`}><Link className="category-section__title" to={`/category/${encodeURIComponent(slug)}`}>{category.name}</Link></h2>
        </div>
        <div className="category-section__actions">
          {items.length > 2 && (
            <div className="category-carousel-controls" aria-label={`${category.name} carousel controls`}>
              <button type="button" aria-label={`Scroll ${category.name} products left`} onClick={() => scroll(-1)}>‹</button>
              <button type="button" aria-label={`Scroll ${category.name} products right`} onClick={() => scroll(1)}>›</button>
            </div>
          )}
          <Link className="category-see-all" to={`/category/${encodeURIComponent(slug)}`}>See all</Link>
        </div>
      </div>
      {loading ? <p className="muted" role="status">Loading {category.name.toLowerCase()}…</p> : null}
      {!loading && failed ? <p className="muted" role="alert">We could not load these listings. Please try again later.</p> : null}
      {!loading && !failed && items.length === 0 ? <p className="muted category-section__empty">No listings in this category yet.</p> : null}
      {!loading && !failed && items.length > 0 && (
        <div className="category-carousel" ref={trackRef} aria-label={`${category.name} listings`}>
          {items.map((item) => <ListingCard key={item.id} listing={item} />)}
        </div>
      )}
    </section>
  );
}
