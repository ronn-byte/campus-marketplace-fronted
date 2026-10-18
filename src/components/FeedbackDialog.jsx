import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

function FeedbackIcon({ type }) {
  return type === "success" ? (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" />
      <path d="m14 24 7 7 14-15" />
    </svg>
  ) : (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="21" />
      <path d="M24 14v12m0 8h.01" />
    </svg>
  );
}

export default function FeedbackDialog({ feedback, onDismiss }) {
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!feedback) return undefined;
    previousFocusRef.current = document.activeElement;
    closeRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape" && feedback.dismissible !== false) {
        event.preventDefault();
        onDismiss();
      }
      if (event.key !== "Tab") return;
      const items = dialogRef.current?.querySelectorAll("button:not(:disabled), a[href]");
      if (!items?.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus?.();
    };
  }, [feedback, onDismiss]);

  if (!feedback) return null;
  const success = feedback.type === "success";
  const action = feedback.action || (feedback.actionLabel
    ? { label: feedback.actionLabel, to: feedback.actionTo }
    : null);

  const handleAction = () => {
    onDismiss();
    feedback.onAction?.();
  };

  return (
    <div className="feedback-scrim" onMouseDown={(event) => {
      if (event.target === event.currentTarget && feedback.dismissible !== false) onDismiss();
    }}>
      <section
        ref={dialogRef}
        className="feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-title"
        aria-describedby="feedback-message"
        tabIndex={-1}
      >
        {feedback.dismissible !== false && (
          <button ref={closeRef} type="button" className="feedback-dialog__close" onClick={onDismiss} aria-label="Close message">×</button>
        )}
        <span className={`feedback-dialog__icon feedback-dialog__icon--${success ? "success" : "error"}`}>
          <FeedbackIcon type={feedback.type} />
        </span>
        <h2 id="feedback-title">{feedback.title}</h2>
        <p id="feedback-message">{feedback.message}</p>
        <div className="feedback-dialog__actions">
          {action?.to ? (
            <Link className="button" to={action.to} onClick={onDismiss}>{action.label}</Link>
          ) : action?.label ? (
            <button className="button" type="button" onClick={handleAction}>{action.label}</button>
          ) : null}
          {feedback.dismissible !== false && (
            <button className="button button--secondary" type="button" onClick={onDismiss}>{feedback.cancelLabel || "Close"}</button>
          )}
        </div>
      </section>
    </div>
  );
}
