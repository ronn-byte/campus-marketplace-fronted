import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { classifyApiError } from "../services/apiErrors";
import { runWithLoading } from "../services/asyncOperation";
import apiClient from "../services/apiClient";

export default function ForgotPassword() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const { showFeedback, setBlockingLabel } = useFeedback();
  const [status, setStatus] = useState({ loading: false, error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (status.loading) return;
    await runWithLoading(async () => {
      setStatus((current) => ({ ...current, error: "" }));
      try {
        await apiClient.post("/auth/forgot-password", { email });
        showFeedback({
          type: "success",
          title: "Check your inbox",
          message: "If an account matches that email, recovery instructions will be sent shortly.",
          action: { label: "Back to login", onAction: () => navigate("/login") },
        });
      } catch (error) {
        const result = classifyApiError(error);
        if (result.kind === "validation") setStatus((current) => ({ ...current, error: result.message }));
        else showFeedback({ type: "error", ...result });
      }
    }, (loading) => {
      setStatus((current) => ({ ...current, loading }));
      setBlockingLabel(loading ? "Sending recovery request…" : "");
    });
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro"><p className="eyebrow">Account recovery</p><h1>Get back to trading.</h1><p className="muted">We keep recovery responses general so account existence stays private.</p></section>
      <section className="form-card" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading">Reset your password</h2>
        <p className="form-card__intro">Enter the email connected to your account.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="recovery-email">Email address</label><input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? <><InlineSpinner label="Sending recovery request…" announce={false} /> Sending…</> : "Send recovery link"}</Button>
        </form>
        <p className="form-footer"><Link className="text-link" to="/login">Back to log in</Link></p>
      </section>
    </div>
  );
}
