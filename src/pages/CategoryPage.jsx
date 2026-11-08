import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import ListingCard from "../components/ListingCard.jsx";
import { getListingCategories, getListings } from "../services/listingService.js";

const initialFilters = {
  q: "",
  minPrice: "",
  maxPrice: "",
  condition: "",
  location: "",
  sort: "newest",
};

const maxPage = 2_001;

export default function CategoryPage() {
  const { slug } = useParams();
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesFailed, setCategoriesFailed] = useState(false);
  const [categoriesRetry, setCategoriesRetry] = useState(0);
  const [filters, setFilters] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setCategoriesLoading(true);
    setCategoriesFailed(false);
    getListingCategories()
      .then((result) => { if (active) setCategories(result); })
      .catch(() => { if (active) setCategoriesFailed(true); })
      .finally(() => { if (active) setCategoriesLoading(false); });
    return () => { active = false; };
  }, [categoriesRetry]);

  const category = useMemo(
    () => categories.find((item) => (item.slug || item.id) === slug),
    [categories, slug],
  );
  const categoryResolved = !categoriesLoading && !categoriesFailed;

  useEffect(() => {
    if (!category) return undefined;
    let active = true;
    const params = { page, pageSize: 20, categoryId: category.id, ...filters };
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
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [category, page, filters, retry]);

  if (categoryResolved && !category) return <Navigate to="/" replace />;

  const updateDraft = (event) => {
    const { name, value } = event.target;
    setDraft((current) => ({ ...current, [name]: value }));
    setFilterError("");
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const minRaw = draft.minPrice.trim();
    const maxRaw = draft.maxPrice.trim();
    const min = minRaw === "" ? undefined : Number(minRaw);
    const max = maxRaw === "" ? undefined : Number(maxRaw);
    if ((min !== undefined && (!Number.isFinite(min) || min < 0)) ||
        (max !== undefined && (!Number.isFinite(max) || max < 0))) {
      setFilterError("Enter valid, non-negative prices.");
      return;
    }
    if (min !== undefined && max !== undefined && min > max) {
      setFilterError("Minimum price must be less than or equal to maximum price.");
      return;
    }
    setFilters({ ...draft, q: draft.q.trim(), minPrice: minRaw, maxPrice: maxRaw });
    setPage(1);
    setFilterError("");
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setDraft(initialFilters);
    setPage(1);
    setFilterError("");
  };

  if (categoriesFailed) {
    return (
      <div className="page-shell category-page">
        <p className="muted" role="alert">We could not load categories. Check your connection and try again.</p>
        <button className="button button--small" type="button" onClick={() => setCategoriesRetry((value) => value + 1)}>Retry</button>
      </div>
    );
  }

  if (categoriesLoading || !category) {
    return <div className="page-shell category-page"><p className="muted" role="status">Loading category…</p></div>;
  }

  const canGoForward = meta ? page < meta.totalPages : false;

  return (
    <div className="page-shell category-page">
      <nav className="category-breadcrumb" aria-label="Breadcrumb">
        <Link to="/">Explore</Link><span aria-hidden="true">/</span><span aria-current="page">{category.name}</span>
      </nav>
      <header className="category-page__header">
        <p className="eyebrow">Campus Marketplace</p>
        <h1>{category.name}</h1>
        <p>Browse available {category.name.toLowerCase()} listings from the MUT community.</p>
      </header>

      <form className="category-filter-form" role="search" onSubmit={applyFilters}>
        <label className="category-filter-form__search">
          <span>Search in {category.name}</span>
          <input type="search" name="q" maxLength="120" value={draft.q} onChange={updateDraft} placeholder="Search titles and descriptions" />
        </label>
        <label>Sort by
          <select name="sort" value={draft.sort} onChange={updateDraft}>
            <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
          </select>
        </label>
        <label>Condition
          <select name="condition" value={draft.condition} onChange={updateDraft}>
            <option value="">Any condition</option><option value="NEW">New</option><option value="LIKE_NEW">Like new</option><option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="USED">Used</option>
          </select>
        </label>
        <label>Location
          <input type="search" name="location" maxLength="120" value={draft.location} onChange={updateDraft} placeholder="Campus area" />
        </label>
        <label>Min price (KSh)
          <input type="number" name="minPrice" min="0" step="0.01" inputMode="decimal" value={draft.minPrice} onChange={updateDraft} />
        </label>
        <label>Max price (KSh)
          <input type="number" name="maxPrice" min="0" step="0.01" inputMode="decimal" value={draft.maxPrice} onChange={updateDraft} />
        </label>
        <div className="category-filter-form__actions">
          <button className="button button--small" type="submit" disabled={loading}>Apply</button>
          <button className="button button--small button--secondary" type="button" onClick={clearFilters}>Clear</button>
        </div>
        {filterError ? <p className="category-filter-form__error" role="alert">{filterError}</p> : null}
      </form>

      <section className="category-results" aria-labelledby="category-results-heading">
        <div className="section-heading">
          <div><p className="eyebrow">{meta?.total ?? 0} listings</p><h2 id="category-results-heading">All {category.name}</h2></div>
        </div>
        {loadError ? (
          <p className="muted" role="alert">We could not load listings. Check your connection and try again. <button className="button button--small" type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p>
        ) : loading ? (
          <p className="muted" role="status" aria-live="polite">Loading listings…</p>
        ) : items.length ? (
          <div className="category-product-grid">{items.map((item) => <ListingCard key={item.id} listing={item} />)}</div>
        ) : (
          <p className="muted category-page__empty">No listings match these filters in {category.name}. Try changing your search or filters.</p>
        )}
        <nav className="workspace-pagination" aria-label="Category listing pages">
          <button className="button button--small button--secondary" type="button" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
          <span>Page {page}{meta?.totalPages ? ` of ${meta.totalPages}` : ""}</span>
          <button className="button button--small button--secondary" type="button" disabled={loading || !canGoForward || page >= maxPage} onClick={() => setPage((value) => value + 1)}>Next</button>
        </nav>
      </section>
    </div>
  );
}
