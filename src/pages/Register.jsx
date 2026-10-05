import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: "", email: "", password: "", verificationMethod: "UNIVERSITY_EMAIL", registrationNumber: "" });
  const [status, setStatus] = useState({ loading: false, error: "", message: "" });

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "", message: "" });

    try {
      await apiClient.post("/auth/register", form);
      const message = form.verificationMethod === "UNIVERSITY_EMAIL"
        ? "Account created. Check your email and MUT student inbox to complete verification."
        : "Account created. Check your email; student verification is pending moderator review.";
      navigate("/login", { state: { message } });
    } catch (error) {
      setStatus({ loading: false, error: getApiErrorMessage(error), message: "" });
    }
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro">
        <p className="eyebrow">Made for MUT</p>
        <h1>Good finds, close by.</h1>
        <p className="muted">Create a student account to discover useful things, sell what you no longer need, and trade with more context.</p>
      </section>
      <section className="form-card" aria-labelledby="register-heading">
        <h2 id="register-heading">Create your account</h2>
        <p className="form-card__intro">Start with the details you want to use around campus.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        {status.message && <div className="preview-note" role="status">{status.message}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" type="text" value={form.displayName} onChange={updateField} autoComplete="name" maxLength="80" required /></div>
          <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" required /></div>
          <div className="field"><label htmlFor="verificationMethod">How would you like to verify your student status?</label><select id="verificationMethod" name="verificationMethod" value={form.verificationMethod} onChange={updateField} required><option value="UNIVERSITY_EMAIL">University email</option><option value="MANUAL_STUDENT">Student verification</option></select></div>
          <div className="field"><label htmlFor="registrationNumber">Registration number</label><input id="registrationNumber" name="registrationNumber" type="text" value={form.registrationNumber} onChange={updateField} autoComplete="off" pattern="[A-Za-z0-9/ -]+" minLength="4" maxLength="40" required /><span className="muted">{form.verificationMethod === "UNIVERSITY_EMAIL" ? "We'll send a verification link to the MUT student email address associated with this number." : "This is sent privately for moderator review and is never shown publicly."}</span></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="12" required /><span className="muted">Use at least 12 characters.</span></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? "Creating your account..." : "Create account"}</Button>
        </form>
        <p className="form-footer">Already have an account? <Link className="text-link" to="/login">Log in</Link></p>
      </section>
    </div>
  );
}
