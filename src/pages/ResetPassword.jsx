import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import PasswordInput from "../components/PasswordInput";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { classifyApiError } from "../services/apiErrors";
import { runWithLoading } from "../services/asyncOperation";
import apiClient from "../services/apiClient";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const { showFeedback, setBlockingLabel } = useFeedback();
  const [status, setStatus] = useState({
    loading: false,
    message: "",
    error: "",
  });

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status.loading) return;

    if (!token) {
      setStatus({
        loading: false,
        message: "",
        error: "This password reset link is missing its token. Request a new link.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setConfirmError("Your passwords do not match.");
      return;
    }

    if (status.loading) return;
    setConfirmError("");
    await runWithLoading(async () => {
      setStatus((current) => ({ ...current, error: "" }));
      try {
        await apiClient.post("/auth/reset-password", { token, password });
        setStatus((current) => ({ ...current, message: "done" }));
        showFeedback({ type: "success", title: "Password reset complete", message: "Your password has been reset. You can now sign in with your new password.", action: { label: "Continue to login", onAction: () => navigate("/login") } });
      } catch (error) {
        const result = classifyApiError(error, "reset-password");
        if (result.kind === "validation") setStatus((current) => ({ ...current, error: result.message }));
        else showFeedback({ type: "error", ...result });
      }
    }, (loading) => {
      setStatus((current) => ({ ...current, loading }));
      setBlockingLabel(loading ? "Resetting password…" : "");
    });
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro">
        <p className="eyebrow">Account recovery</p>
        <h1>Choose a new password.</h1>
        <p className="muted">
          Create a new password for your Campus Market account.
        </p>
      </section>

      <section className="form-card" aria-labelledby="reset-heading">
        <h2 id="reset-heading">Reset your password</h2>
        <p className="form-card__intro">
          Enter your new password below.
        </p>

        {status.error && <div className="form-alert" role="alert">{status.error}</div>}

        {status.message === "done" && (
          <div className="verification-notice verification-notice--approved" role="status">
            <h2>Password reset complete</h2>
            <p>Your new password is ready to use.</p>
            <Link className="button" to="/login">Continue to login</Link>
          </div>
        )}

        {status.message !== "done" && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="new-password">New password</label>

              <PasswordInput id="new-password" name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={status.loading} />
            </div>

            <div className="field">
              <label htmlFor="confirm-password">
                Confirm new password
              </label>

              <PasswordInput id="confirm-password" name="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required disabled={status.loading} aria-describedby={confirmError ? "confirm-password-error" : undefined} />
              {confirmError && <span id="confirm-password-error" className="field-error" role="alert">{confirmError}</span>}
            </div>

            <Button type="submit" disabled={status.loading}>{status.loading ? <><InlineSpinner label="Resetting password…" announce={false} /> Resetting password…</> : "Reset password"}</Button>
          </form>
        )}

        <p className="form-footer">
          <Link className="text-link" to="/login">
            Back to log in
          </Link>
        </p>
      </section>
    </div>
  );
}
