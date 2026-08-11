import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import { supabase } from "../lib/supabaseClient";
import "./JoinTeam.css";

function JoinTeam() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [firebaseUser, setFirebaseUser] = useState(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [loadingPreview, setLoadingPreview] = useState(true);

  const [mode, setMode] = useState("signup"); // signup | signin
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authSubmitting, setAuthSubmitting] = useState(false);

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user);
      setCheckingAuth(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const loadPreview = async () => {
      setLoadingPreview(true);
      setPreviewError("");

      const { data, error } = await supabase.rpc("get_invite_preview", { p_token: token });

      if (error || !data || data.length === 0) {
        setPreviewError("This invite link isn't valid.");
      } else {
        const row = data[0];
        if (row.status !== "pending") {
          setPreviewError("This invite has already been used or revoked.");
        } else {
          setPreview(row);
          setEmail(row.email || "");
        }
      }
      setLoadingPreview(false);
    };

    if (token) loadPreview();
  }, [token]);

  const handleEmailAuth = async (e) => {
    e.preventDefault();
    setAuthError("");
    setAuthSubmitting(true);
    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setAuthError(err.message.replace("Firebase: ", ""));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleGoogleAuth = async () => {
    setAuthError("");
    setAuthSubmitting(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setAuthError(err.message.replace("Firebase: ", ""));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleAcceptInvite = async () => {
    setAcceptError("");
    setAccepting(true);
    try {
      const { error } = await supabase.rpc("accept_staff_invite", { p_token: token });
      if (error) throw error;
      // Full reload (not React Router's navigate) so App.js remounts and
      // re-fetches the user/business row from Supabase. Without this, App's
      // in-memory `business` state is stale (it was fetched before
      // accept_staff_invite linked this user), and the /dashboard route
      // would incorrectly redirect to /onboarding.
      window.location.href = "/dashboard";
    } catch (err) {
      setAcceptError(
        err.message?.includes("USER_ALREADY_EXISTS")
          ? "This account is already linked to a business."
          : err.message?.includes("INVITE_NOT_FOUND_OR_USED")
          ? "This invite has already been used or revoked."
          : "Something went wrong accepting the invite. Please try again."
      );
    } finally {
      setAccepting(false);
    }
  };

  if (loadingPreview || checkingAuth) {
    return (
      <div className="jt-page">
        <div className="jt-card">
          <div className="jt-spinner jt-spinner--lg" />
        </div>
      </div>
    );
  }

  if (previewError) {
    return (
      <div className="jt-page">
        <div className="jt-card jt-card--center">
          <div className="jt-icon jt-icon--error">!</div>
          <h2>Invite unavailable</h2>
          <p className="jt-muted">{previewError}</p>
          <button className="jt-btn jt-btn--ghost" onClick={() => navigate("/")}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  const roleLabel = preview.role.charAt(0).toUpperCase() + preview.role.slice(1);

  return (
    <div className="jt-page">
      <div className="jt-card">
        <span className="jt-wordmark">ASTORRA</span>

        <div className="jt-invite-summary">
          <p className="jt-eyebrow">You've been invited</p>
          <h1>
            Join <strong>{preview.business_name}</strong>
          </h1>
          <p className="jt-muted">
            You'll have <strong>{roleLabel}</strong> access to their Astorra dashboard.
          </p>
        </div>

        {firebaseUser ? (
          <div className="jt-accept-block">
            <p className="jt-muted">
              Signed in as <strong>{firebaseUser.email}</strong>
            </p>
            {acceptError && <p className="jt-error">{acceptError}</p>}
            <button className="jt-btn jt-btn--primary" onClick={handleAcceptInvite} disabled={accepting}>
              {accepting ? <span className="jt-spinner" /> : `Accept invite & join ${preview.business_name}`}
            </button>
          </div>
        ) : (
          <div className="jt-auth-block">
            <div className="jt-tab-row">
              <button
                className={`jt-tab ${mode === "signup" ? "jt-tab--active" : ""}`}
                onClick={() => setMode("signup")}
                type="button"
              >
                Create account
              </button>
              <button
                className={`jt-tab ${mode === "signin" ? "jt-tab--active" : ""}`}
                onClick={() => setMode("signin")}
                type="button"
              >
                Log in
              </button>
            </div>

            <form onSubmit={handleEmailAuth}>
              <label className="jt-label" htmlFor="jt-email">
                Email
              </label>
              <input
                id="jt-email"
                type="email"
                className="jt-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />

              <label className="jt-label" htmlFor="jt-password">
                Password
              </label>
              <input
                id="jt-password"
                type="password"
                className="jt-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
              />

              {authError && <p className="jt-error">{authError}</p>}

              <button className="jt-btn jt-btn--primary" type="submit" disabled={authSubmitting}>
                {authSubmitting ? (
                  <span className="jt-spinner" />
                ) : mode === "signup" ? (
                  "Create account & continue"
                ) : (
                  "Log in & continue"
                )}
              </button>
            </form>

            <div className="jt-divider">
              <span>or</span>
            </div>

            <button className="jt-btn jt-btn--google" onClick={handleGoogleAuth} disabled={authSubmitting}>
              Continue with Google
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default JoinTeam;