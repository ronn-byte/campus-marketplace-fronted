import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

export default function VerifyStudent() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const [method, setMethod] = useState("UNIVERSITY_EMAIL");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (authLoading || !userId) return undefined;
    let isMounted = true;

    async function loadVerification() {
      setLoading(true);
      setError("");
      try {
        const { data } = await apiClient.get("/verification/me");
        if (isMounted) setVerification(data);
      } catch (loadError) {
        if (isMounted) setError(getApiErrorMessage(loadError, "session"));
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadVerification();
    return () => {
      isMounted = false;
    };
  }, [authLoading, userId, reload]);

  if (authLoading || !user) {
    return (
      <div className="page-shell">
        <section className="form-card verification-workflow">
          <h1>Sign in to verify your student account</h1>
          <p className="muted">Student verification is optional for browsing and buying, and is needed when you want to sell.</p>
          <Link to="/login" className="button">Log in</Link>
        </section>
      </div>
    );
  }

  if (loading) {
    return <div className="page-shell"><div className="profile-loading" aria-live="polite">Checking your student verification status...</div></div>;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);

    try {
      const { data } = await apiClient.post("/verification", {
        method,
        registrationNumber: registrationNumber.trim(),
      });
      setVerification(data);
      setMessage(method === "UNIVERSITY_EMAIL"
        ? "We sent a verification link to the MUT student email address associated with your registration number."
        : "Your student verification request has been submitted for review.");
    } catch (submitError) {
      setError(getApiErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  };

  const status = verification?.status;
  const canSubmit = status !== "PENDING" && status !== "APPROVED";

  return (
    <div className="page-shell form-page">
      <section className="form-card verification-workflow" aria-labelledby="verification-heading">
        <p className="eyebrow">Student verification</p>
        <h1 id="verification-heading">Verify your student account</h1>
        <p className="muted">Verification is only needed when you're ready to create listings and sell. You can continue browsing, buying, and contacting sellers without it.</p>

        {error && <div className="form-alert" role="alert">{error}</div>}
        {message && <div className="form-success" role="status">{message}</div>}

        {error && !verification ? (
          <div className="verification-notice">
            <p>We couldn't load your student verification status. Please try again before submitting a request.</p>
            <Button type="button" variant="secondary" onClick={() => setReload((current) => current + 1)}>Try again</Button>
          </div>
        ) : status === "APPROVED" ? (
          <div className="verification-notice verification-notice--approved">
            <h2>Verified student</h2>
            <p>Your student verification is complete. You can create listings and sell on MUT Market.</p>
          </div>
        ) : status === "PENDING" ? (
          <div className="verification-notice">
            <h2>Verification pending</h2>
            <p>Your student verification is being reviewed. There is no need to submit another request.</p>
          </div>
        ) : (
          <>
            {status === "REJECTED" && (
              <div className="verification-notice verification-notice--attention">
                <h2>Verification needs attention</h2>
                <p>Review your details and submit a new request where supported. Internal review details are not shown here.</p>
              </div>
            )}
            <form onSubmit={handleSubmit} className="verification-form">
              <div className="field">
                <label htmlFor="verificationMethod">Verification method</label>
                <select id="verificationMethod" value={method} onChange={(event) => setMethod(event.target.value)}>
                  <option value="UNIVERSITY_EMAIL">University email</option>
                  <option value="MANUAL_STUDENT">Manual student review</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="registrationNumber">Registration number</label>
                <input
                  id="registrationNumber"
                  type="text"
                  value={registrationNumber}
                  onChange={(event) => setRegistrationNumber(event.target.value)}
                  autoComplete="off"
                  pattern="[A-Za-z0-9/ -]+"
                  minLength="4"
                  maxLength="40"
                  required
                />
                <span className="muted">
                  {method === "UNIVERSITY_EMAIL"
                    ? "We'll email a verification link to the MUT student email address associated with this number."
                    : "Your details will be sent privately for student verification review."}
                </span>
              </div>
              <Button type="submit" disabled={saving || !canSubmit}>
                {saving ? "Submitting..." : status === "REJECTED" ? "Resubmit verification" : "Submit verification"}
              </Button>
            </form>
          </>
        )}

        <p className="form-footer"><Link className="text-link" to="/profile">Back to profile</Link></p>
      </section>
    </div>
  );
}
