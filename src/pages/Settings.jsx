import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function Settings() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const [verification, setVerification] = useState(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const [verificationReload, setVerificationReload] = useState(0);
  const [resending, setResending] = useState(false);
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (authLoading || !userId) return undefined;
    let isMounted = true;

    async function loadVerification() {
      setVerificationLoading(true);
      setVerificationError("");
      try {
        const { data } = await apiClient.get("/verification/me");
        if (isMounted) setVerification(data);
      } catch (loadError) {
        if (isMounted) setVerificationError(getApiErrorMessage(loadError, "session"));
      } finally {
        if (isMounted) setVerificationLoading(false);
      }
    }

    loadVerification();
    return () => {
      isMounted = false;
    };
  }, [authLoading, userId, verificationReload]);

  if (authLoading) {
    return <div className="page-shell"><div className="profile-loading" aria-live="polite">Loading your account settings...</div></div>;
  }

  if (!user) {
    return (
      <div className="page-shell">
        <div className="profile-empty-state">
          <h1>Sign in to manage your settings</h1>
          <p className="muted">Account security and student verification settings are available after you log in.</p>
          <Link to="/login" className="button">Log in</Link>
        </div>
      </div>
    );
  }

  const handleResendVerification = async () => {
    setResending(true);
    setEmailMessage("");
    setEmailError("");

    try {
      await apiClient.post("/auth/resend-verification", { email: user.email });
      setEmailMessage("If your account is eligible, a verification email will be sent shortly.");
    } catch (error) {
      setEmailError(getApiErrorMessage(error));
    } finally {
      setResending(false);
    }
  };

  const studentStatus = verification?.status;
  const studentStatusLabel = {
    APPROVED: "Verified student",
    PENDING: "Pending review",
    REJECTED: "Needs attention",
  }[studentStatus] || "Not verified";

  return (
    <div className="page-shell settings-page">
      <header className="settings-heading">
        <p className="eyebrow">Account</p>
        <h1>Settings</h1>
        <p className="muted">Manage account security and the student verification that supports a trusted campus marketplace.</p>
      </header>

      <div className="settings-grid">
        <section className="settings-card" aria-labelledby="security-heading">
          <p className="eyebrow">Sign-in and security</p>
          <h2 id="security-heading">Account security</h2>
          <div className="settings-detail">
            <span>Email address</span>
            <strong>{user.email}</strong>
          </div>
          <div className="settings-detail">
            <span>Email status</span>
            <strong>{user.emailVerifiedAt ? "Verified" : "Not verified"}</strong>
          </div>

          {!user.emailVerifiedAt && (
            <div className="settings-actions">
              <Button type="button" variant="secondary" onClick={handleResendVerification} disabled={resending}>
                {resending ? "Sending..." : "Resend verification email"}
              </Button>
              {emailMessage && <p className="form-success" role="status">{emailMessage}</p>}
              {emailError && <p className="form-alert" role="alert">{emailError}</p>}
            </div>
          )}

          <div className="settings-link-row">
            <div>
              <strong>Password</strong>
              <p className="muted">Use the secure recovery flow to choose a new password.</p>
            </div>
            <Link className="button button--secondary" to="/forgot-password">Reset password</Link>
          </div>
        </section>

        <section className="settings-card" aria-labelledby="student-settings-heading">
          <p className="eyebrow">Campus marketplace</p>
          <h2 id="student-settings-heading">Student verification</h2>
          {verificationLoading ? (
            <p className="muted" aria-live="polite">Checking your verification status...</p>
          ) : verificationError ? (
            <>
              <p className="form-alert" role="alert">{verificationError}</p>
              <Button type="button" variant="secondary" onClick={() => setVerificationReload((current) => current + 1)}>Try again</Button>
            </>
          ) : (
            <>
              <div className="settings-detail">
                <span>Verification status</span>
                <strong>{studentStatusLabel}</strong>
              </div>
              <p className="muted">
                {studentStatus === "APPROVED"
                  ? "Your verified student account can create listings and sell on MUT Market."
                  : studentStatus === "PENDING"
                    ? "Your request is being reviewed. You can continue browsing and buying while you wait."
                    : "Verification is optional for browsing and buying, and is required when you want to sell."}
              </p>
              {studentStatus !== "APPROVED" && studentStatus !== "PENDING" && (
                <Link to="/verify-student" className="button">
                  {studentStatus === "REJECTED" ? "Review verification" : "Verify student account"}
                </Link>
              )}
            </>
          )}
        </section>

        <section className="settings-card settings-card--profile" aria-labelledby="profile-settings-heading">
          <div>
            <p className="eyebrow">Public information</p>
            <h2 id="profile-settings-heading">Marketplace profile</h2>
            <p className="muted">Update the name, course, and details other campus members see on your profile.</p>
          </div>
          <Link to="/profile" className="button button--secondary">Edit profile</Link>
        </section>
      </div>
    </div>
  );
}
