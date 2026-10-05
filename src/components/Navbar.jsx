import { useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import apiClient from "../services/apiClient";

export default function Navbar() {
  const navigate = useNavigate();
  const { isAuthenticated, user, setUser } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const handleDocumentClick = (event) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  const initials = useMemo(() => {
    const source = user?.email?.trim() || "MU";
    return source
      .split("@")[0]
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "MU";
  }, [user]);

  const handleLogout = async () => {
    try {
      await apiClient.post("/auth/logout");
    } finally {
      setUser(null);
      setMenuOpen(false);
      navigate("/");
    }
  };

  return (
    <nav className="site-nav" aria-label="Main navigation">
      <div className="site-nav__inner">
        <Link to="/" className="brand" aria-label="MUT Market home">
          <span className="brand__mark">M</span>
          <span><strong>MUT</strong> Market</span>
        </Link>
        <div className="site-nav__links">
          <NavLink to="/" end className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>Explore</NavLink>
          <NavLink to="/post-item" className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>Sell an item</NavLink>
          {isAuthenticated && <>
            <NavLink to="/my-listings" className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>My Listings</NavLink>
            <NavLink to="/my-inquiries" className={({ isActive }) => isActive ? "nav-link nav-link--active" : "nav-link"}>My Inquiries</NavLink>
          </>}
        </div>
        <div className="site-nav__actions">
          {!isAuthenticated && <>
            <Link to="/login" className="nav-link">Log in</Link>
            <Link to="/register" className="button button--small">Join MUT Market</Link>
          </>}

          {isAuthenticated && (
            <div className="profile-menu" ref={menuRef}>
              <button type="button" className="profile-menu__trigger" onClick={() => setMenuOpen((open) => !open)} aria-label="Open profile menu" aria-expanded={menuOpen}>
                <span className="avatar">{initials}</span>
              </button>

              {menuOpen && (
                <div className="profile-menu__panel" role="menu">
                  <Link to="/profile" className="profile-menu__item" onClick={() => setMenuOpen(false)}>My Profile</Link>
                  <Link to="/my-listings" className="profile-menu__item" onClick={() => setMenuOpen(false)}>My Listings</Link>
                  <Link to="/my-inquiries" className="profile-menu__item" onClick={() => setMenuOpen(false)}>My Inquiries</Link>
                  <Link to="/profile" className="profile-menu__item" onClick={() => setMenuOpen(false)}>Settings</Link>
                  <button type="button" className="profile-menu__action" onClick={handleLogout}>Log out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
