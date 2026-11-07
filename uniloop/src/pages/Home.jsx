import React, { useState } from "react";
import UniversityCard from "../components/UniversityCard.jsx";
import universities from "../data/universities.js";

const navigation = [
  { href: "#top", label: "Home" },
  { href: "#universities", label: "Universities" },
  { href: "#about", label: "About" },
];

function Brand({ footer = false }) {
  return (
    <a className="brand" href="#top" aria-label="UniLoop home">
      <span className="brand__symbol" aria-hidden="true">
        <svg viewBox="0 0 36 36" fill="none">
          <path
            d="M11 12.5a8 8 0 0 1 13.66-5.66l2.01 2.01M25 23.5a8 8 0 0 1-13.66 5.66l-2.01-2.01M7.5 9.5v5h5M28.5 26.5v-5h-5"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="brand__word">UniLoop</span>
      {footer && <span className="brand__descriptor">Kenya Universities Junction</span>}
    </a>
  );
}

function ArrowIcon() {
  return <span aria-hidden="true">↗</span>;
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="site-header" id="top">
      <div className="page-shell site-header__inner">
        <Brand />
        <button
          className="menu-toggle"
          type="button"
          aria-controls="primary-navigation"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span />
          <span />
        </button>
        <nav
          className={`primary-nav${menuOpen ? " primary-nav--open" : ""}`}
          id="primary-navigation"
          aria-label="Main navigation"
        >
          {navigation.map((item) => (
            <a
              className="primary-nav__link"
              href={item.href}
              key={item.href}
              onClick={() => setMenuOpen(false)}
            >
              {item.label}
            </a>
          ))}
          <a
            className="button button--nav"
            href="#universities"
            onClick={() => setMenuOpen(false)}
          >
            Explore universities
            <span aria-hidden="true">↓</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="page-shell hero__layout">
        <div className="hero__copy">
          <p className="eyebrow hero__eyebrow">
            <span className="status-dot" aria-hidden="true" />
            A new home for campus life
          </p>
          <h1 id="hero-title">Kenya Universities Junction</h1>
          <p className="hero__lead">
            One connected space for discovering university communities, campus
            opportunities, and student platforms across Kenya.
          </p>
          <div className="hero__actions">
            <a className="button" href="#universities">
              Explore Universities
              <span aria-hidden="true">↓</span>
            </a>
            <a className="hero__text-link" href="#about">
              Get to know UniLoop
            </a>
          </div>
          <p className="hero__note">Starting with Murang’a University of Technology</p>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="hero-art__ring hero-art__ring--outer" />
          <div className="hero-art__ring hero-art__ring--middle" />
          <div className="hero-art__ring hero-art__ring--inner" />
          <span className="hero-art__center">
            <svg viewBox="0 0 36 36" fill="none">
              <path
                d="M11 12.5a8 8 0 0 1 13.66-5.66l2.01 2.01M25 23.5a8 8 0 0 1-13.66 5.66l-2.01-2.01M7.5 9.5v5h5M28.5 26.5v-5h-5"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="hero-art__label hero-art__label--top">Discover</span>
          <span className="hero-art__label hero-art__label--right">Connect</span>
          <span className="hero-art__label hero-art__label--bottom">Explore</span>
          <span className="hero-art__label hero-art__label--left">Belong</span>
          <span className="hero-art__spark hero-art__spark--one" />
          <span className="hero-art__spark hero-art__spark--two" />
        </div>
      </div>
      <div className="hero__rule" />
    </section>
  );
}

function Universities() {
  return (
    <section className="section universities" id="universities" aria-labelledby="universities-title">
      <div className="page-shell">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Find your community</p>
            <h2 id="universities-title">A place to start</h2>
          </div>
          <p className="section-heading__aside">
            University communities, one connection at a time.
          </p>
        </div>
        <div className="university-grid">
          {universities.map((university) => (
            <UniversityCard key={university.id} university={university} />
          ))}
          <div className="coming-card">
            <span className="coming-card__plus" aria-hidden="true">+</span>
            <p className="eyebrow">More communities ahead</p>
            <p>We’re building a wider view of university life across Kenya.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function MarketFeature() {
  return (
    <section className="market-section" id="mut-market" aria-labelledby="market-title">
      <div className="page-shell market-panel">
        <div className="market-panel__copy">
          <p className="eyebrow market-panel__eyebrow">Already at MUT</p>
          <h2 id="market-title">Campus finds, over at MUT Market.</h2>
          <p>
            MUT Market is an existing, independent marketplace for the campus
            community. Visit it to browse listings and connect with sellers.
          </p>
          <a
            className="button button--light"
            href="https://mutmarket.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
          >
            Explore MUT Market
            <ArrowIcon />
          </a>
        </div>
        <div className="market-panel__mark" aria-hidden="true">
          <span className="market-panel__orbit" />
          <span className="market-panel__monogram">M</span>
          <span className="market-panel__caption">A separate campus marketplace</span>
        </div>
      </div>
    </section>
  );
}

function About() {
  return (
    <section className="section about" id="about" aria-labelledby="about-title">
      <div className="page-shell about__layout">
        <p className="eyebrow">The idea behind UniLoop</p>
        <div>
          <h2 id="about-title">University life, easier to find.</h2>
          <p>
            UniLoop is a place to discover university communities and the
            campus-related digital resources around them. We’re starting with
            MUT, while keeping independent services like MUT Market their own.
          </p>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="site-footer">
      <div className="page-shell site-footer__main">
        <div>
          <Brand footer />
          <p className="site-footer__note">
            Discover what connects university communities.
          </p>
        </div>
        <nav className="footer-nav" aria-label="Footer navigation">
          {navigation.map((item) => (
            <a href={item.href} key={item.href}>{item.label}</a>
          ))}
          <a href="#universities">Explore universities</a>
          <a
            href="https://mutmarket.up.railway.app/"
            target="_blank"
            rel="noopener noreferrer"
          >
            MUT Market
            <ArrowIcon />
          </a>
        </nav>
      </div>
      <div className="page-shell site-footer__bottom">
        <span>© {new Date().getFullYear()} UniLoop</span>
        <span>Kenya Universities Junction</span>
      </div>
    </footer>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <Header />
      <main id="main-content">
        <Hero />
        <Universities />
        <MarketFeature />
        <About />
      </main>
      <Footer />
    </>
  );
}
