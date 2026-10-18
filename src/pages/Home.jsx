import { useEffect, useState } from "react";
import ListingCard from "../components/ListingCard";
import { getListings } from "../services/listingService";

function Home() {
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [loadError, setLoadError] = useState(false);
  const categories = ["All", "Books", "Electronics", "Furniture", "Fashion", "Services"];

  useEffect(() => {
    getListings()
      .then(setItems)
      .catch(() => {
        setItems([]);
        setLoadError(true);
      });
  }, []);

  const visibleItems = activeCategory === "All" ? items : items.filter((item) => item.category === activeCategory);

  return (
    <div className="home-page">
      <section className="home-explore-hero" aria-labelledby="explore-welcome-heading">
        <div className="home-explore-hero__overlay">
          <div className="home-explore-hero__inner">
            <p className="home-explore-hero__eyebrow">Murang&apos;a University of Technology</p>
            <h1 id="explore-welcome-heading">Welcome to MUT Market</h1>
            <p>Find useful things, share what you no longer need, and trade with your university community.</p>
            <div className="home-explore-hero__actions">
              <a className="button home-explore-hero__primary" href="#recent-listings">Browse recent listings</a>
              <a className="home-explore-hero__secondary" href="#categories-heading">Explore categories</a>
            </div>
          </div>
        </div>
      </section>

      <div className="page-shell">
        <div className="search-bar home-search" role="search">
          <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m15.5 15.5 5 5" /></svg>
          <input type="search" aria-label="Search listings" placeholder="Search products, services and sellers..." />
          <button className="button button--small" type="button">Search</button>
        </div>
        <section aria-labelledby="categories-heading">
          <div className="section-heading"><h2 id="categories-heading">Browse by category</h2></div>
          <div className="category-row">
            {categories.map((category) => <button key={category} type="button" className={`category-chip ${activeCategory === category ? "category-chip--active" : ""}`} onClick={() => setActiveCategory(category)}>{category}</button>)}
          </div>
        </section>

        <section id="recent-listings" aria-labelledby="listings-heading">
          <div className="section-heading">
            <div><p className="eyebrow">Fresh around MUT</p><h2 id="listings-heading">Recent listings</h2></div>
            <span className="muted">{visibleItems.length} items</span>
          </div>
          {loadError
            ? <p className="muted" role="status">We could not load current listings. Please refresh to try again.</p>
            : visibleItems.length > 0
              ? <div className="listing-grid">{visibleItems.map((item) => <ListingCard key={item.id} listing={item} />)}</div>
              : <p className="muted">No listings in this category yet.</p>}
        </section>
      </div>
    </div>
  );
}

export default Home;
