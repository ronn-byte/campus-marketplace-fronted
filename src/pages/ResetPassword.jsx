import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState({
    loading: false,
    message: "",
    error: "",
  });

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!token) {
      setStatus({
        loading: false,
        message: "",
        error: "This password reset link is missing its token.",
      });
      return;
    }

    if (password !== confirmPassword) {
      setStatus({
        loading: false,
        message: "",
        error: "Passwords do not match.",
      });
      return;
    }

    setStatus({ loading: true, message: "", error: "" });

    try {
      await apiClient.post("/auth/reset-password", {
        token,
        password,
      });

      setStatus({
        loading: false,
        message: "Your password has been reset successfully. You can now log in.",
        error: "",
      });

      setTimeout(() => {
        navigate("/login");
      }, 1500);
    } catch (error) {
      setStatus({
        loading: false,
        message: "",
        error: getApiErrorMessage(error),
      });
    }
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

        {status.error && (
          <div className="form-alert" role="alert">
            {status.error}
          </div>
        )}

        {status.message && (
          <div className="preview-note" role="status">
            {status.message}
          </div>
        )}

        {!status.message && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="new-password">New password</label>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <div className="field">
              <label htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>

            <Button type="submit" disabled={status.loading}>
              {status.loading ? "Resetting..." : "Reset password"}
            </Button>
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