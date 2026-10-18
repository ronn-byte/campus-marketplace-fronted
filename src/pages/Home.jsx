import { useEffect, useState } from "react";
import ListingCard from "../components/ListingCard";
import { getListingCategories, getListings } from "../services/listingService";

const emptyFilters = {
  q: "",
  categoryId: "",
  minPrice: "",
  maxPrice: "",
  condition: "",
  location: "",
  sort: "newest",
};
const MAX_PUBLIC_LISTING_PAGE = 2_001;

function Home() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    getListingCategories().then((result) => {
      if (active) setCategories(result);
    }).catch(() => {
      if (active) setCategories([]);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const params = { page, pageSize: 20, ...appliedFilters };
    Object.keys(params).forEach((key) => {
      if (params[key] === "") delete params[key];
    });
    setLoading(true);
    setLoadError(false);
    getListings(params)
      .then((result) => {
        if (!active) return;
        setItems(result.items);
        setMeta(result.meta);
      })
      .catch(() => {
        if (!active) return;
        setItems([]);
        setMeta(null);
        setLoadError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [page, appliedFilters]);

  const updateFilter = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  const applyFilters = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters({ ...filters });
  };

  const clearFilters = () => {
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setPage(1);
  };

  const canGoBack = page > 1;
  const canGoForward = meta ? page < meta.totalPages : false;

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
        <form className="home-filters" role="search" onSubmit={applyFilters}>
          <label className="home-filters__keyword">Search listings
            <input name="q" type="search" maxLength="120" value={filters.q} onChange={updateFilter} placeholder="Search titles and descriptions" />
          </label>
          <div className="home-filters__grid">
            <label>Category
              <select name="categoryId" value={filters.categoryId} onChange={updateFilter}>
                <option value="">All categories</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>Minimum price
              <input name="minPrice" type="number" min="0" step="0.01" value={filters.minPrice} onChange={updateFilter} />
            </label>
            <label>Maximum price
              <input name="maxPrice" type="number" min="0" step="0.01" value={filters.maxPrice} onChange={updateFilter} />
            </label>
            <label>Condition
              <select name="condition" value={filters.condition} onChange={updateFilter}>
                <option value="">Any condition</option>
                <option value="NEW">New</option><option value="LIKE_NEW">Like new</option>
                <option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="USED">Used</option>
              </select>
            </label>
            <label>Location
              <input name="location" type="search" maxLength="120" value={filters.location} onChange={updateFilter} placeholder="Campus or area" />
            </label>
            <label>Sort by
              <select name="sort" value={filters.sort} onChange={updateFilter}>
                <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
              </select>
            </label>
          </div>
          <div className="home-filters__actions">
            <button className="button button--small" type="submit" disabled={loading}>Search</button>
            <button className="button button--small button--secondary" type="button" onClick={clearFilters} disabled={loading}>Clear filters</button>
          </div>
        </form>
        <section aria-labelledby="categories-heading">
          <div className="section-heading"><h2 id="categories-heading">Browse by category</h2></div>
          <div className="category-row">
            <button type="button" className={`category-chip ${!appliedFilters.categoryId ? "category-chip--active" : ""}`} onClick={() => { setFilters((current) => ({ ...current, categoryId: "" })); setAppliedFilters((current) => ({ ...current, categoryId: "" })); setPage(1); }}>All</button>
            {categories.map((category) => <button key={category.id} type="button" className={`category-chip ${appliedFilters.categoryId === category.id ? "category-chip--active" : ""}`} onClick={() => { setFilters((current) => ({ ...current, categoryId: category.id })); setAppliedFilters((current) => ({ ...current, categoryId: category.id })); setPage(1); }}>{category.name}</button>)}
          </div>
        </section>

        <section id="recent-listings" aria-labelledby="listings-heading">
          <div className="section-heading">
            <div><p className="eyebrow">Fresh around MUT</p><h2 id="listings-heading">Recent listings</h2></div>
            <span className="muted">{meta?.total ?? 0} items</span>
          </div>
          {loadError
            ? <p className="muted" role="alert">We could not load listings. Check your connection and try again.
                <button className="button button--small" type="button" onClick={() => setAppliedFilters({ ...appliedFilters })}>Retry</button>
              </p>
            : loading
              ? <p className="muted" role="status" aria-live="polite">Loading listings...</p>
              : items.length > 0
                ? <div className="listing-grid">{items.map((item) => <ListingCard key={item.id} listing={item} />)}</div>
                : <p className="muted">No listings match these filters. Try changing or clearing them.</p>}
          <nav className="workspace-pagination" aria-label="Listing pages">
            <button className="button button--small button--secondary" type="button" disabled={loading || !canGoBack} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span>Page {page}{meta?.totalPages ? ` of ${meta.totalPages}` : ""}</span>
            <button className="button button--small button--secondary" type="button" disabled={loading || !canGoForward || page >= MAX_PUBLIC_LISTING_PAGE} onClick={() => setPage((value) => value + 1)}>Next</button>
          </nav>
        </section>
      </div>
    </div>
  );
}

export default Home;
