import { useEffect, useState } from "react";
import ListingCard from "../components/ListingCard";
import { getListings, previewListings } from "../services/listingService";

function Home() {
  const [items, setItems] = useState([]);
  const [activeCategory, setActiveCategory] = useState("All");
  const [isPreview, setIsPreview] = useState(false);
  const categories = ["All", "Books", "Electronics", "Furniture", "Fashion", "Services"];

  useEffect(() => {
    getListings()
      .then(setItems)
      .catch(() => {
        setItems(previewListings);
        setIsPreview(true);
      });
  }, []);

  const visibleItems = activeCategory === "All" ? items : items.filter((item) => item.category === activeCategory);

  return (
    <div className="page-shell">
      <section className="home-hero">
        <div className="home-hero__copy">
          <p className="eyebrow">MUT students, buying and selling</p>
          <h1>Find it around campus.</h1>
          <p>Discover useful things from people in your university community, without the noise of a general marketplace.</p>
          <div className="search-bar" role="search">
            <span aria-hidden="true">⌕</span>
            <input type="search" aria-label="Search listings" placeholder="Search products, services and sellers..." />
            <button className="button button--small" type="button">Search</button>
          </div>
        </div>
        <aside className="hero-note">
          <strong>Trade close. Spend less.</strong>
          <p>Meet around familiar campus locations and keep student-to-student commerce simple.</p>
        </aside>
      </section>

      <section aria-labelledby="categories-heading">
        <div className="section-heading"><h2 id="categories-heading">Browse by category</h2></div>
        <div className="category-row">
          {categories.map((category) => <button key={category} type="button" className={`category-chip ${activeCategory === category ? "category-chip--active" : ""}`} onClick={() => setActiveCategory(category)}>{category}</button>)}
        </div>
      </section>

      <section aria-labelledby="listings-heading">
        <div className="section-heading">
          <div><p className="eyebrow">Fresh around MUT</p><h2 id="listings-heading">Recent listings</h2></div>
          <span className="muted">{visibleItems.length} items</span>
        </div>
        {isPreview && <p className="preview-note">We could not load current listings, so you are viewing temporary preview listings. These are not real inventory.</p>}
        {visibleItems.length > 0 ? <div className="listing-grid">{visibleItems.map((item) => <ListingCard key={item.id} listing={item} />)}</div> : <p className="muted">No listings in this category yet.</p>}
      </section>
    </div>
  );
}

export default Home;
