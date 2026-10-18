export default function InlineSpinner({ label, className = "", announce = true }) {
  return (
    <span className={`inline-spinner ${className}`.trim()} {...(announce ? { role: "status", "aria-live": "polite" } : { "aria-hidden": "true" })}>
      <span className="inline-spinner__ring" aria-hidden="true" />
      {announce && <span className="sr-only">{label}</span>}
    </span>
  );
}
