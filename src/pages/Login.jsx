import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const navigate = useNavigate();
  const { setUser } = useAuth();
  const [form, setForm] = useState({ identifier: "", password: "" });
  const [status, setStatus] = useState({ loading: false, error: "" });

  const updateField = (event) => setForm({ ...form, [event.target.name]: event.target.value });

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "" });

    try {
      await apiClient.post("/auth/login", form);
      const { data } = await apiClient.get("/auth/session");
      setUser(data.user || null);
      navigate("/");
    } catch (error) {
      setStatus({ loading: false, error: getApiErrorMessage(error) });
    }
  };

  return (
    <div className="page-shell form-page">
      <section className="form-intro">
        <p className="eyebrow">Welcome back</p>
        <h1>Your campus, a little closer.</h1>
        <p className="muted">Sign in to keep up with listings, conversations, and the people trading around MUT.</p>
      </section>
      <section className="form-card" aria-labelledby="login-heading">
        <h2 id="login-heading">Log in to MUT Market</h2>
        <p className="form-card__intro">Use your account details to continue.</p>
        {status.error && <div className="form-alert" role="alert">{status.error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label htmlFor="identifier">Email or username</label>
            <input id="identifier" name="identifier" type="text" value={form.identifier} onChange={updateField} autoComplete="username" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" value={form.password} onChange={updateField} autoComplete="current-password" required />
          </div>
          <div className="section-heading"><span /> <Link className="text-link" to="/forgot-password">Forgot password?</Link></div>
          <Button type="submit" disabled={status.loading}>{status.loading ? "Signing you in..." : "Log in"}</Button>
        </form>
        <p className="form-footer">New to MUT Market? <Link className="text-link" to="/register">Create an account</Link></p>
      </section>
    </div>
  );
}
