import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import PasswordInput from "../components/PasswordInput";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { classifyApiError } from "../services/apiErrors";
import { runWithLoading } from "../services/asyncOperation";
import apiClient from "../services/apiClient";
import { passwordsMatch, registrationPayload } from "../services/registrationForm";

export default function Register() {
  const navigate = useNavigate();
  const { showFeedback, setBlockingLabel } = useFeedback();
  const [form, setForm] = useState({ displayName: "", email: "", password: "", confirmPassword: "" });
  const [status, setStatus] = useState({ loading: false, error: "" });
  const passwordConfirmationMatches = passwordsMatch(form.password, form.confirmPassword);
  const showPasswordMismatch = form.confirmPassword.length > 0 && !passwordConfirmationMatches;

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (status.loading || !passwordConfirmationMatches) return;
    await runWithLoading(async () => {
      setStatus((current) => ({ ...current, error: "" }));
      try {
        await apiClient.post("/auth/register", registrationPayload(form));
        showFeedback({ type: "success", title: "Account created", message: "Your account is ready. You can log in now; confirm your email to protect sensitive actions.", action: { label: "Continue to login", onAction: () => navigate("/login") } });
      } catch (error) {
        const result = classifyApiError(error, "register");
        if (result.kind === "validation") setStatus((current) => ({ ...current, error: result.message }));
        else showFeedback({ type: "error", ...result });
      }
    }, (loading) => {
      setStatus((current) => ({ ...current, loading }));
      setBlockingLabel(loading ? "Creating your account…" : "");
    });
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro">
        <p className="eyebrow">Campus Marketplace</p>
        <h1>Good finds, close by.</h1>
        <p className="muted">Create an account to discover useful things, sell what you no longer need, and trade with your community.</p>
      </section>
      <section className="form-card" aria-labelledby="register-heading">
        <h2 id="register-heading">Create your account</h2>
        <p className="form-card__intro">Start with the details you want to use around campus.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="displayName">Full name</label><input id="displayName" name="displayName" type="text" value={form.displayName} onChange={updateField} autoComplete="name" maxLength="80" required /></div>
          <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" required /></div>
          <div className="field"><label htmlFor="password">Password</label><PasswordInput id="password" name="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="12" required /><span className="muted">Use at least 12 characters.</span></div>
          <div className="field"><label htmlFor="confirmPassword">Confirm password</label><PasswordInput id="confirmPassword" name="confirmPassword" value={form.confirmPassword} onChange={updateField} autoComplete="new-password" minLength="12" required aria-invalid={showPasswordMismatch} aria-describedby={showPasswordMismatch ? "password-mismatch" : undefined} />{showPasswordMismatch && <span id="password-mismatch" className="form-alert" role="alert">Passwords do not match.</span>}</div>
          <Button type="submit" disabled={status.loading || !passwordConfirmationMatches}>{status.loading ? <><InlineSpinner label="Creating your account…" announce={false} /> Creating your account…</> : "Create account"}</Button>
        </form>
        <p className="form-footer">Already have an account? <Link className="text-link" to="/login">Log in</Link></p>
      </section>
    </div>
  );
}
