import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import apiClient from "../services/apiClient";

function VerifyEmail() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const isUniversityVerification = location.pathname === "/verify-university-email";

  const [status, setStatus] = useState("verifying");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const token = searchParams.get("token");

    if (!token) {
      setStatus("error");
      setMessage("The verification link is missing its token.");
      return;
    }

    async function verify() {
      try {
        const endpoint = isUniversityVerification
          ? "/verification/verify-email"
          : "/auth/verify-email";
        await apiClient.post(endpoint, { token });

        setStatus("success");
        setMessage(isUniversityVerification
          ? "Your MUT student email is verified. Student verification is approved."
          : "Your email has been verified successfully.");
      } catch (error) {
        setStatus("error");

        const backendMessage =
          error.response?.data?.error?.message ||
          "The verification link is invalid or has expired.";

        setMessage(backendMessage);
      }
    }

    verify();
  }, [isUniversityVerification, searchParams]);

  return (
    <main style={styles.container}>
      <section style={styles.card}>
        {status === "verifying" && (
          <>
            <h1>Verifying your email...</h1>
            <p>
              Please wait while we verify your Campus Market account.
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <h1>Email verified ✓</h1>
            <p>{message}</p>

            <Link to="/login" style={styles.button}>
              Continue to login
            </Link>
          </>
        )}

        {status === "error" && (
          <>
            <h1>Verification failed</h1>
            <p>{message}</p>

            <Link to="/login" style={styles.button}>
              Back to login
            </Link>
          </>
        )}
      </section>
    </main>
  );
}

const styles = {
  container: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },

  card: {
    width: "100%",
    maxWidth: "500px",
    padding: "40px",
    borderRadius: "12px",
    textAlign: "center",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
  },

  button: {
    display: "inline-block",
    marginTop: "20px",
    padding: "12px 20px",
    borderRadius: "8px",
    textDecoration: "none",
    background: "#111827",
    color: "#ffffff",
  },
};

export default VerifyEmail;