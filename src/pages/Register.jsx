import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [status, setStatus] = useState({ loading: false, error: "" });

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "" });

    try {
      await apiClient.post("/auth/register", form);
      navigate("/login");
    } catch (error) {
      setStatus({ loading: false, error: getApiErrorMessage(error) });
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
        <form onSubmit={handleSubmit}>
          <div className="field"><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" type="text" value={form.displayName} onChange={updateField} autoComplete="name" maxLength="80" required /></div>
          <div className="field"><label htmlFor="email">University email</label><input id="email" name="email" type="email" value={form.email} onChange={updateField} autoComplete="email" required /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" value={form.password} onChange={updateField} autoComplete="new-password" minLength="12" required /><span className="muted">Use at least 12 characters.</span></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? "Creating your account..." : "Create account"}</Button>
        </form>
        <p className="form-footer">Already have an account? <Link className="text-link" to="/login">Log in</Link></p>
      </section>
    </div>
  );
}
