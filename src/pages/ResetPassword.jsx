import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import Button from "../components/Button";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

function EyeIcon({ visible }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
      <path d="M9.9 5.2A11 11 0 0121 12a11.7 11.7 0 01-4.2 4.8M6.2 6.2A12 12 0 003 12a11 11 0 0018 0" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.5-7 9.5-7 9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function StatusIcon({ success }) {
  return success ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6m0 3h.01" />
    </svg>
  );
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
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
      setStatus({
        loading: false,
        message: "",
        error: "Your passwords do not match. Please try again.",
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

      setTimeout(() => navigate("/login"), 2000);
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
          <div className="reset-status reset-status--error" role="alert">
            <span className="reset-status__icon">
              <StatusIcon success={false} />
            </span>
            <span>{status.error}</span>
          </div>
        )}

        {status.message && (
          <div className="reset-success" role="status" aria-live="polite">
            <span className="reset-success__icon">
              <StatusIcon success />
            </span>
            <h3>Password reset complete</h3>
            <p>{status.message}</p>
            <p className="reset-redirect">
              Redirecting you to log in…
            </p>
          </div>
        )}

        {!status.message && (
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label htmlFor="new-password">New password</label>

              <div className="password-input-wrap">
                <input
                  id="new-password"
                  name="new-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={status.loading}
                />

                <button
                  type="button"
                  className="password-visibility"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  disabled={status.loading}
                >
                  <EyeIcon visible={showPassword} />
                </button>
              </div>
            </div>

            <div className="field">
              <label htmlFor="confirm-password">
                Confirm new password
              </label>

              <div className="password-input-wrap">
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(event) =>
                    setConfirmPassword(event.target.value)
                  }
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={status.loading}
                />

                <button
                  type="button"
                  className="password-visibility"
                  onClick={() =>
                    setShowConfirmPassword((visible) => !visible)
                  }
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirmation password"
                      : "Show confirmation password"
                  }
                  aria-pressed={showConfirmPassword}
                  disabled={status.loading}
                >
                  <EyeIcon visible={showConfirmPassword} />
                </button>
              </div>
            </div>

            <Button type="submit" disabled={status.loading}>
              {status.loading ? (
                <span className="reset-button-loading">
                  <span className="reset-spinner" aria-hidden="true" />
                  Resetting password…
                </span>
              ) : (
                "Reset password"
              )}
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
