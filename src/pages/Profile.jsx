import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Button from "../components/Button";
import { useAuth } from "../hooks/useAuth";
import apiClient, { getApiErrorMessage } from "../services/apiClient";

const emptyForm = {
  nickname: "",
  phoneNumber: "",
  yearOfStudy: "",
  course: "",
  bio: "",
};

export default function Profile() {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id;
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verification, setVerification] = useState(null);
  const [verificationLoading, setVerificationLoading] = useState(true);
  const [verificationError, setVerificationError] = useState("");
  const [verificationReload, setVerificationReload] = useState(0);

  const initials = useMemo(() => {
    const source = user?.email?.trim() || "MU";
    return source
      .split("@")[0]
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "MU";
  }, [user]);

  useEffect(() => {
    let isMounted = true;

    if (authLoading) return () => {
      isMounted = false;
    };
    if (!userId) {
      setLoading(false);
      return () => {
        isMounted = false;
      };
    }

    async function loadProfile() {
      try {
        const { data } = await apiClient.get("/profile");
        if (!isMounted) return;
        setForm({
          nickname: data.profile?.nickname ?? "",
          phoneNumber: data.profile?.phoneNumber ?? "",
          yearOfStudy: data.profile?.yearOfStudy ?? "",
          course: data.profile?.course ?? "",
          bio: data.profile?.bio ?? "",
        });
      } catch (loadError) {
        if (!isMounted) return;
        setError(getApiErrorMessage(loadError, "session"));
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [authLoading, userId]);

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
        if (isMounted) {
          setVerificationError(getApiErrorMessage(loadError, "session"));
        }
      } finally {
        if (isMounted) setVerificationLoading(false);
      }
    }

    loadVerification();
    return () => {
      isMounted = false;
    };
  }, [authLoading, userId, verificationReload]);

  if (authLoading || (user && loading)) {
    return (
      <div className="page-shell">
        <div className="profile-loading" aria-live="polite">Loading your profile...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-shell">
        <div className="profile-empty-state">
          <h1>Sign in to view your profile</h1>
          <p className="muted">Your account details and profile settings are available after you log in.</p>
          <Link to="/login" className="button">Log in</Link>
        </div>
      </div>
    );
  }

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    if (error) setError("");
    if (success) setSuccess("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSuccess("");
    setError("");
    setSaving(true);

    try {
      const payload = {
        nickname: form.nickname.trim() || undefined,
        phoneNumber: form.phoneNumber.trim() || undefined,
        yearOfStudy: form.yearOfStudy === "" ? undefined : Number(form.yearOfStudy),
        course: form.course.trim() || undefined,
        bio: form.bio.trim() || undefined,
      };

      const { data } = await apiClient.patch("/profile", payload);
      setForm({
        nickname: data.profile?.nickname ?? "",
        phoneNumber: data.profile?.phoneNumber ?? "",
        yearOfStudy: data.profile?.yearOfStudy ?? "",
        course: data.profile?.course ?? "",
        bio: data.profile?.bio ?? "",
      });
      setSuccess("Your profile has been updated.");
    } catch (submitError) {
      setError(getApiErrorMessage(submitError, "request"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell profile-page">
      <div className="profile-layout">
        <aside className="profile-sidebar">
          <div className="profile-avatar" aria-label="Profile avatar">{initials}</div>
          <h1>{form.nickname || user.email.split("@")[0]}</h1>
          <p className="muted">{user.email}</p>
          <div className="profile-flag">
            <strong>Account</strong>
            <span>Protected details stay private and are managed by the platform.</span>
          </div>
          <section className={`verification-card${verification?.status ? ` verification-card--${verification.status.toLowerCase()}` : ""}`} aria-labelledby="student-verification-heading">
            <p className="eyebrow">Student verification</p>
            {verificationLoading ? (
              <p className="muted" aria-live="polite">Checking your student verification status...</p>
            ) : verificationError ? (
              <>
                <h2 id="student-verification-heading">Status unavailable</h2>
                <p className="muted">{verificationError}</p>
                <Button type="button" variant="secondary" onClick={() => setVerificationReload((current) => current + 1)}>Try again</Button>
              </>
            ) : verification?.status === "APPROVED" ? (
              <>
                <h2 id="student-verification-heading"><span className="verification-card__icon" aria-hidden="true">✓</span> Verified student</h2>
                <p>Your student verification lets you create listings and sell on MUT Market.</p>
              </>
            ) : verification?.status === "PENDING" ? (
              <>
                <h2 id="student-verification-heading">Verification pending</h2>
                <p>Your student verification is being reviewed. No need to submit another request while it is pending. You can keep browsing and buying in the meantime.</p>
              </>
            ) : verification?.status === "REJECTED" ? (
              <>
                <h2 id="student-verification-heading">Verification needs attention</h2>
                <p>You can review your details and submit a new request where supported. Browsing and buying are still available.</p>
                <Link to="/verify-student" className="button">Continue verification</Link>
              </>
            ) : (
              <>
                <h2 id="student-verification-heading">Verify your student account</h2>
                <p>You're welcome here. When you're ready to sell, verification helps keep MUT Market trusted and allows you to create listings and sell items.</p>
                <Link to="/verify-student" className="button">Verify student account</Link>
              </>
            )}
          </section>
        </aside>

        <section className="profile-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Profile</p>
              <h2>Public details</h2>
            </div>
          </div>

          {error && <div className="form-alert" role="alert">{error}</div>}
          {success && <div className="form-success" role="status">{success}</div>}

          <form onSubmit={handleSubmit} className="profile-form">
            <div className="field">
              <label htmlFor="nickname">Nickname</label>
              <input id="nickname" name="nickname" value={form.nickname} onChange={handleChange} maxLength={60} placeholder="How would you like to be known?" />
            </div>

            <div className="field-grid">
              <div className="field">
                <label htmlFor="phoneNumber">Phone number</label>
                <input id="phoneNumber" name="phoneNumber" value={form.phoneNumber} onChange={handleChange} maxLength={25} placeholder="+254700000000" />
              </div>

              <div className="field">
                <label htmlFor="yearOfStudy">Year of study</label>
                <input id="yearOfStudy" name="yearOfStudy" type="number" min="1" max="12" value={form.yearOfStudy} onChange={handleChange} placeholder="1" />
              </div>
            </div>

            <div className="field">
              <label htmlFor="course">Course or program</label>
              <input id="course" name="course" value={form.course} onChange={handleChange} maxLength={120} placeholder="Computer Science" />
            </div>

            <div className="field">
              <label htmlFor="bio">Bio</label>
              <textarea id="bio" name="bio" value={form.bio} onChange={handleChange} rows="4" maxLength={500} placeholder="Tell the campus community a bit about you." />
            </div>

            <div className="profile-actions">
              <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save profile"}</Button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
