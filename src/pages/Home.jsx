import { useEffect, useRef, useState } from "react";
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

const emptyFilterDraft = {
  categoryId: "",
  minPrice: "",
  maxPrice: "",
  condition: "",
  location: "",
  sort: "newest",
};

const MAX_PUBLIC_LISTING_PAGE = 2_001;
const conditionLabels = {
  NEW: "New",
  LIKE_NEW: "Like new",
  GOOD: "Good",
  FAIR: "Fair",
  USED: "Used",
};

function filterCount(filters) {
  return [
    filters.categoryId,
    filters.minPrice || filters.maxPrice,
    filters.condition,
    filters.location,
    filters.sort !== "newest",
  ].filter(Boolean).length;
}

function formatPrice(value) {
  return `KSh ${Number(value).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}

function Home() {
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [searchInput, setSearchInput] = useState("");
  const [filterDraft, setFilterDraft] = useState(emptyFilterDraft);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterError, setFilterError] = useState("");
  const [page, setPage] = useState(1);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const filterPanelRef = useRef(null);
  const filterButtonRef = useRef(null);

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

  useEffect(() => {
    if (!filterOpen) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (
        !filterPanelRef.current?.contains(event.target) &&
        !filterButtonRef.current?.contains(event.target)
      ) {
        setFilterOpen(false);
      }
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setFilterOpen(false);
        filterButtonRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filterOpen]);

  const applySearch = (event) => {
    event.preventDefault();
    setPage(1);
    setAppliedFilters((current) => ({ ...current, q: searchInput.trim() }));
  };

  const toggleFilterPanel = () => {
    if (filterOpen) {
      setFilterOpen(false);
      return;
    }

    setFilterDraft({
      categoryId: appliedFilters.categoryId,
      minPrice: appliedFilters.minPrice,
      maxPrice: appliedFilters.maxPrice,
      condition: appliedFilters.condition,
      location: appliedFilters.location,
      sort: appliedFilters.sort,
    });
    setFilterError("");
    setFilterOpen(true);
  };

  const updateFilterDraft = (event) => {
    const { name, value } = event.target;
    setFilterDraft((current) => ({ ...current, [name]: value }));
    setFilterError("");
  };

  const applyFilters = (event) => {
    event.preventDefault();
    const minRaw = filterDraft.minPrice.trim();
    const maxRaw = filterDraft.maxPrice.trim();
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

    setPage(1);
    setAppliedFilters((current) => ({
      ...current,
      ...filterDraft,
      q: searchInput.trim(),
      minPrice: minRaw,
      maxPrice: maxRaw,
    }));
    setFilterOpen(false);
    setFilterError("");
  };

  const clearFilters = () => {
    setSearchInput("");
    setFilterDraft(emptyFilterDraft);
    setAppliedFilters(emptyFilters);
    setFilterError("");
    setFilterOpen(false);
    setPage(1);
  };

  const removeAppliedFilter = (key) => {
    const updates = key === "price"
      ? { minPrice: "", maxPrice: "" }
      : { [key]: key === "sort" ? "newest" : "" };
    setAppliedFilters((current) => ({ ...current, ...updates }));
    setFilterDraft((current) => ({ ...current, ...updates }));
    if (key === "q") setSearchInput("");
    setPage(1);
  };

  const selectCategory = (categoryId) => {
    setAppliedFilters((current) => ({ ...current, categoryId }));
    setFilterDraft((current) => ({ ...current, categoryId }));
    setPage(1);
  };

  const activeChips = [];
  if (appliedFilters.q) activeChips.push({ key: "q", label: `Search: ${appliedFilters.q}` });
  if (appliedFilters.categoryId) {
    const category = categories.find((item) => item.id === appliedFilters.categoryId);
    activeChips.push({ key: "categoryId", label: `Category: ${category?.name ?? "Selected"}` });
  }
  if (appliedFilters.minPrice || appliedFilters.maxPrice) {
    const range = appliedFilters.minPrice && appliedFilters.maxPrice
      ? `${formatPrice(appliedFilters.minPrice)} – ${formatPrice(appliedFilters.maxPrice)}`
      : appliedFilters.minPrice
        ? `From ${formatPrice(appliedFilters.minPrice)}`
        : `Up to ${formatPrice(appliedFilters.maxPrice)}`;
    activeChips.push({ key: "price", label: `Price: ${range}` });
  }
  if (appliedFilters.condition) {
    activeChips.push({ key: "condition", label: `Condition: ${conditionLabels[appliedFilters.condition] ?? appliedFilters.condition}` });
  }
  if (appliedFilters.location) activeChips.push({ key: "location", label: `Location: ${appliedFilters.location}` });
  if (appliedFilters.sort !== "newest") {
    const sortLabel = appliedFilters.sort === "price_asc" ? "Price: low to high" : "Price: high to low";
    activeChips.push({ key: "sort", label: `Sort: ${sortLabel}` });
  }

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

      <div className="page-shell home-page__content">
        <div className="home-discovery">
          <form className="home-search" role="search" onSubmit={applySearch}>
            <label className="sr-only" htmlFor="listing-search">Search item titles and descriptions</label>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></svg>
            <input
              id="listing-search"
              type="search"
              maxLength="120"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search item titles and descriptions"
            />
            <button className="button button--small" type="submit" disabled={loading}>Search</button>
          </form>

          <div className="home-filter-anchor">
            <button
              ref={filterButtonRef}
              className="button button--secondary home-filter-toggle"
              type="button"
              aria-expanded={filterOpen}
              aria-controls="listing-filter-panel"
              onClick={toggleFilterPanel}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10m-7 6h4" /></svg>
              Filters{filterCount(appliedFilters) > 0 ? <span className="home-filter-count">{filterCount(appliedFilters)}</span> : null}
            </button>

            {filterOpen && (
              <form
                id="listing-filter-panel"
                ref={filterPanelRef}
                className="home-filter-panel"
                aria-labelledby="filter-panel-heading"
                onSubmit={applyFilters}
              >
                <div className="home-filter-panel__heading">
                  <div><h2 id="filter-panel-heading">Filters</h2><p>Choose what matters, then apply.</p></div>
                  <button className="home-filter-panel__close" type="button" aria-label="Close filters without applying" onClick={() => { setFilterOpen(false); filterButtonRef.current?.focus(); }}>×</button>
                </div>
                <div className="home-filter-panel__grid">
                  <label>Category
                    <select name="categoryId" value={filterDraft.categoryId} onChange={updateFilterDraft}>
                      <option value="">All categories</option>
                      {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                    </select>
                  </label>
                  <fieldset className="home-price-range">
                    <legend>Price range (KSh)</legend>
                    <label>Minimum price
                      <input name="minPrice" type="number" min="0" step="0.01" inputMode="decimal" value={filterDraft.minPrice} onChange={updateFilterDraft} />
                    </label>
                    <label>Maximum price
                      <input name="maxPrice" type="number" min="0" step="0.01" inputMode="decimal" value={filterDraft.maxPrice} onChange={updateFilterDraft} />
                    </label>
                  </fieldset>
                  <label>Condition
                    <select name="condition" value={filterDraft.condition} onChange={updateFilterDraft}>
                      <option value="">Any condition</option>
                      <option value="NEW">New</option><option value="LIKE_NEW">Like new</option>
                      <option value="GOOD">Good</option><option value="FAIR">Fair</option><option value="USED">Used</option>
                    </select>
                  </label>
                  <label>Location
                    <input name="location" type="search" maxLength="120" value={filterDraft.location} onChange={updateFilterDraft} placeholder="Enter a campus area" />
                  </label>
                  <label>Sort by
                    <select name="sort" value={filterDraft.sort} onChange={updateFilterDraft}>
                      <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option>
                    </select>
                  </label>
                </div>
                {filterError && <p className="home-filter-error" role="alert">{filterError}</p>}
                <div className="home-filter-panel__actions">
                  <button className="button button--small" type="submit" disabled={loading}>Apply filters</button>
                  <button className="button button--small button--secondary" type="button" onClick={clearFilters}>Clear all</button>
                </div>
              </form>
            )}
          </div>

          {activeChips.length > 0 && (
            <div className="home-active-filters" aria-label="Active search and filters">
              {activeChips.map((chip) => (
                <button key={chip.key} type="button" className="home-filter-chip" aria-label={`Remove filter ${chip.label}`} onClick={() => removeAppliedFilter(chip.key)}>
                  <span>{chip.label}</span><span aria-hidden="true">×</span><span className="sr-only">Remove {chip.label}</span>
                </button>
              ))}
              <button className="home-clear-link" type="button" onClick={clearFilters}>Clear all</button>
            </div>
          )}
        </div>

        <section className="home-categories" aria-labelledby="categories-heading">
          <div className="section-heading"><h2 id="categories-heading">Browse categories</h2></div>
          <div className="category-row" aria-label="Filter by category">
            <button type="button" aria-pressed={!appliedFilters.categoryId} className={`category-chip ${!appliedFilters.categoryId ? "category-chip--active" : ""}`} onClick={() => selectCategory("")}>All</button>
            {categories.map((category) => <button key={category.id} type="button" aria-pressed={appliedFilters.categoryId === category.id} className={`category-chip ${appliedFilters.categoryId === category.id ? "category-chip--active" : ""}`} onClick={() => selectCategory(category.id)}>{category.name}</button>)}
          </div>
        </section>

        <section id="recent-listings" aria-labelledby="listings-heading">
          <div className="section-heading">
            <div><p className="eyebrow">Fresh around MUT</p><h2 id="listings-heading">Recent listings</h2></div>
            <span className="muted">{meta?.total ?? 0} items</span>
          </div>
          {loadError
            ? <p className="muted home-listings-error" role="alert">We could not load listings. Check your connection and try again.
                <button className="button button--small" type="button" onClick={() => setAppliedFilters((current) => ({ ...current }))}>Retry</button>
              </p>
            : loading
              ? <p className="muted" role="status" aria-live="polite">Loading listings...</p>
              : items.length > 0
                ? <div className="listing-grid">{items.map((item) => <ListingCard key={item.id} listing={item} />)}</div>
                : <p className="muted home-empty-state">No listings match these filters. Try removing a filter or searching a different term.</p>}
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
