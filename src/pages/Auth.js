import { useState } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import "./Auth.css";

const friendlyAuthError = (code) => {
  switch (code) {
    case "auth/email-already-in-use":
      return "An account with this email already exists. Try logging in instead.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/weak-password":
      return "Your password should be at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid email address.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your connection and try again.";
    case "auth/popup-closed-by-user":
      return "";
    default:
      return "Something went wrong. Please try again.";
  }
};

function Auth() {
  const [mode, setMode] = useState("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const switchMode = (nextMode) => {
    setMode(nextMode);
    setError("");
    setResetSent(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      if (mode === "signup") {
        await createUserWithEmailAndPassword(auth, email, password);
      } else if (mode === "login") {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await sendPasswordResetEmail(auth, email);
        setResetSent(true);
      }
    } catch (err) {
      const message = friendlyAuthError(err.code);
      if (message) setError(message);
    }

    setSubmitting(false);
  };

  const handleGoogleSignIn = async () => {
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err) {
      const message = friendlyAuthError(err.code);
      if (message) setError(message);
    }
  };

  const heading =
    mode === "signup" ? "Create your account" : mode === "login" ? "Log in" : "Reset your password";

  return (
    <div className="auth-page">
      <div className="auth-card" key={mode}>
        <p className="auth-wordmark">ASTORRA</p>
        <p className="auth-slogan">One platform. Your way.</p>

        <h2 className="auth-heading">{heading}</h2>

        {mode === "reset" && !resetSent && (
          <p className="auth-reset-hint">
            Enter the email on your account and we'll send you a link to reset your password.
          </p>
        )}

        {resetSent ? (
          <p className="auth-reset-sent">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your
            inbox.
          </p>
        ) : (
          <form onSubmit={handleSubmit}>
            <input
              className="auth-input"
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {mode !== "reset" && (
              <input
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}

            {error && <p className="auth-error">{error}</p>}

            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting
                ? "Please wait..."
                : mode === "signup"
                ? "Sign up"
                : mode === "login"
                ? "Log in"
                : "Send reset link"}
            </button>
          </form>
        )}

        {mode !== "reset" && (
          <>
            <div className="auth-divider">or</div>

            <button onClick={handleGoogleSignIn} className="auth-google">
              Continue with Google
            </button>
          </>
        )}

        <p className="auth-switch">
          {mode === "signup" && (
            <>
              Already have an account?{" "}
              <button className="auth-switch-btn" onClick={() => switchMode("login")}>
                Log in
              </button>
            </>
          )}
          {mode === "login" && (
            <>
              Don't have an account?{" "}
              <button className="auth-switch-btn" onClick={() => switchMode("signup")}>
                Sign up
              </button>
              <br />
              <button className="auth-switch-btn auth-forgot-btn" onClick={() => switchMode("reset")}>
                Forgot password?
              </button>
            </>
          )}
          {mode === "reset" && (
            <button className="auth-switch-btn" onClick={() => switchMode("login")}>
              Back to log in
            </button>
          )}
        </p>
      </div>
    </div>
  );
}

export default Auth;