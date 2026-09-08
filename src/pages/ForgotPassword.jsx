import { useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState({ loading: false, message: "", error: "" });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, message: "", error: "" });

    try {
      await apiClient.post("/auth/password-reset/request", { email });
      setStatus({ loading: false, message: "If an account matches that email, recovery instructions will be sent shortly.", error: "" });
    } catch (error) {
      setStatus({ loading: false, message: "", error: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro"><p className="eyebrow">Account recovery</p><h1>Get back to trading.</h1><p className="muted">We keep recovery responses general so account existence stays private.</p></section>
      <section className="form-card" aria-labelledby="recovery-heading">
        <h2 id="recovery-heading">Reset your password</h2>
        <p className="form-card__intro">Enter the email connected to your account.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        {status.message && <div className="preview-note" role="status">{status.message}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="recovery-email">Email address</label><input id="recovery-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? "Sending..." : "Send recovery link"}</Button>
        </form>
        <p className="form-footer"><Link className="text-link" to="/login">Back to log in</Link></p>
      </section>
    </div>
  );
}
