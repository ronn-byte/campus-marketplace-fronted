import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import apiClient, { getApiErrorMessage } from "../services/apiClient";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { classifyApiError } from "../services/apiErrors";
import { runWithLoading } from "../services/asyncOperation";

export default function VerifyStudent() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const { showFeedback, setBlockingLabel } = useFeedback();
  const [method, setMethod] = useState("UNIVERSITY_EMAIL");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [verification, setVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
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
          <p className="muted">Student verification is available as a trust feature. Confirm your account email to sell; student approval is not currently required.</p>
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
    if (saving) return;
    await runWithLoading(async () => {
      setError("");
      try {
        const { data } = await apiClient.post("/verification", {
          method,
          registrationNumber: registrationNumber.trim(),
        });
        setVerification(data);
        showFeedback({
          type: "success",
          title: method === "UNIVERSITY_EMAIL" ? "Check your student inbox" : "Request submitted",
          message: method === "UNIVERSITY_EMAIL"
            ? "We sent a verification link to the MUT student email address associated with your registration number."
            : "Your student verification request has been submitted for review.",
          action: { label: "Back to profile", to: "/profile" },
        });
      } catch (submitError) {
        const result = classifyApiError(submitError);
        if (result.kind === "validation") setError(result.message);
        else showFeedback({ type: "error", ...result });
      }
    }, (loadingNow) => {
      setSaving(loadingNow);
      setBlockingLabel(loadingNow ? "Submitting student verification…" : "");
    });
  };

  const status = verification?.status;
  const canSubmit = status !== "PENDING" && status !== "APPROVED";

  return (
    <div className="page-shell form-page">
      <section className="form-card verification-workflow" aria-labelledby="verification-heading">
        <p className="eyebrow">Student verification</p>
        <h1 id="verification-heading">Verify your student account</h1>
        <p className="muted">Student verification remains available as a trust feature. Email confirmation is currently required to sell, while student approval is optional.</p>

        {error && <div className="form-alert" role="alert">{error}</div>}

        {error && !verification ? (
          <div className="verification-notice">
            <p>We couldn't load your student verification status. Please try again before submitting a request.</p>
            <Button type="button" variant="secondary" onClick={() => setReload((current) => current + 1)}>Try again</Button>
          </div>
        ) : status === "APPROVED" ? (
          <div className="verification-notice verification-notice--approved">
            <h2>Verified student</h2>
            <p>Your student verification is complete. Email confirmation is still required before selling.</p>
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
                {saving ? <><InlineSpinner label="Submitting verification…" announce={false} /> Submitting…</> : status === "REJECTED" ? "Resubmit verification" : "Submit verification"}
              </Button>
            </form>
          </>
        )}

        <p className="form-footer"><Link className="text-link" to="/profile">Back to profile</Link></p>
      </section>
    </div>
  );
}
