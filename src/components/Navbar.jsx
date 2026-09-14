import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Navbar() {
  const { isAuthenticated } = useAuth();

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
        </div>
        <div className="site-nav__actions">
          {isAuthenticated ? <Link to="/" className="avatar" aria-label="Open your profile">MS</Link> : <>
            <Link to="/login" className="nav-link">Log in</Link>
            <Link to="/register" className="button button--small">Join MUT Market</Link>
          </>}
        </div>
      </div>
    </nav>
  );
}
