import { useEffect, useRef } from "react";

export default function BlockingOverlay({ label }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    panelRef.current?.focus();
    const keepFocus = (event) => {
      if (event.key === "Tab") event.preventDefault();
    };
    document.addEventListener("keydown", keepFocus);
    return () => {
      document.removeEventListener("keydown", keepFocus);
      previousFocus?.focus?.();
    };
  }, []);

  return (
    <div className="blocking-overlay">
      <div ref={panelRef} className="blocking-overlay__card" role="dialog" aria-modal="true" aria-busy="true" aria-labelledby="blocking-label" tabIndex={-1}>
        <span className="blocking-overlay__spinner" aria-hidden="true" />
        <p id="blocking-label">{label}</p>
      </div>
    </div>
  );
}
