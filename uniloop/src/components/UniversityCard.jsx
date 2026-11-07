import React from "react";

export default function UniversityCard({ university }) {
  return (
    <article className="university-card">
      <div className="university-card__art" aria-hidden="true">
        <span className="university-card__orbit university-card__orbit--outer" />
        <span className="university-card__orbit university-card__orbit--inner" />
        <span className="university-card__initials">MUT</span>
        <span className="university-card__spark university-card__spark--one" />
        <span className="university-card__spark university-card__spark--two" />
      </div>
      <div className="university-card__content">
        <p className="eyebrow">{university.location}</p>
        <h3>{university.name}</h3>
        <p className="university-card__description">{university.description}</p>
        <a
          className="text-link"
          href={university.href}
          target="_blank"
          rel="noopener noreferrer"
        >
          {university.linkLabel}
          <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
