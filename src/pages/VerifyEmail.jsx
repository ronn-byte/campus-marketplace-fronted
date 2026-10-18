import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import InlineSpinner from "../components/InlineSpinner";
import { useFeedback } from "../hooks/useFeedback";
import { classifyApiError } from "../services/apiErrors";
import { runWithLoading } from "../services/asyncOperation";
import apiClient from "../services/apiClient";

export default function VerifyEmail() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isUniversityVerification = location.pathname === "/verify-university-email";
  const token = searchParams.get("token");
  const requestPromise = useRef(null);
  const requestToken = useRef(token);
  const { setBlockingLabel } = useFeedback();
  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("The verification link is missing its token.");
      return undefined;
    }

    if (requestToken.current !== token) {
      requestToken.current = token;
      requestPromise.current = null;
    }

    let active = true;
    if (!requestPromise.current) {
      requestPromise.current = runWithLoading(async () => {
        try {
          const endpoint = isUniversityVerification
            ? "/verification/verify-email"
            : "/auth/verify-email";
          await apiClient.post(endpoint, { token });
          return {
            status: "success",
            message: isUniversityVerification
              ? "Your MUT student email is verified. Student verification is approved."
              : "Your email has been verified successfully.",
          };
        } catch (error) {
          return { status: "error", message: classifyApiError(error, "verify-email").message };
        }
      }, (loading) => setBlockingLabel(loading ? "Verifying your email…" : ""));
    }

    requestPromise.current.then((result) => {
      if (!active) return;
      setStatus(result.status);
      setMessage(result.message);
    });
    return () => { active = false; };
  }, [isUniversityVerification, token, setBlockingLabel]);

  return (
    <div className="page-shell verification-result-page">
      <section className="form-card verification-result" aria-labelledby="email-verification-heading">
        <p className="eyebrow">Account security</p>
        {status === "verifying" && (
          <>
            <h1 id="email-verification-heading">Verifying your email</h1>
            <p className="muted" role="status">Please wait while we verify your MUT Market account.</p>
            <InlineSpinner label="Verifying your email…" announce={false} />
          </>
        )}
        {status === "success" && (
          <>
            <span className="verification-result__icon verification-result__icon--success" aria-hidden="true">✓</span>
            <h1 id="email-verification-heading">Email verified</h1>
            <p className="muted" role="status">{message}</p>
            <Link to="/login" className="button">Continue to login</Link>
          </>
        )}
        {status === "error" && (
          <>
            <span className="verification-result__icon verification-result__icon--error" aria-hidden="true">!</span>
            <h1 id="email-verification-heading">Verification failed</h1>
            <p className="form-alert" role="alert">{message}</p>
            <Link to="/login" className="button">Back to login</Link>
          </>
        )}
      </section>
    </div>
  );
}
