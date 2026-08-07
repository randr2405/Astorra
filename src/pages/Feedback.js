import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Feedback.css";

const TYPES = [
  { value: "recommendation", label: "Recommendation" },
  { value: "bug", label: "Bug report" },
  { value: "general", label: "General feedback" },
];

function Feedback() {
  const navigate = useNavigate();
  const [type, setType] = useState("recommendation");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!message.trim()) {
      setError("Let us know what's on your mind before sending.");
      return;
    }

    setSubmitting(true);
    try {
      const { error: insertError } = await supabase.from("feedback").insert({
        type,
        name: name.trim() || null,
        email: email.trim() || null,
        message: message.trim(),
      });

      if (insertError) throw insertError;

      setSubmitted(true);
    } catch (err) {
      setError(
        err?.message?.includes("feedback")
          ? "We couldn't reach the feedback service. Please try again shortly."
          : err?.message || "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fb-page">
      <nav className="fb-nav">
        <div className="fb-nav-inner">
          <span className="fb-wordmark" onClick={() => navigate("/")}>
            ASTORRA
          </span>
          <div className="fb-nav-actions">
            <button className="fb-link-btn" onClick={() => navigate("/auth")}>
              Log in
            </button>
            <button className="fb-cta-btn" onClick={() => navigate("/auth")}>
              Get started
            </button>
          </div>
        </div>
      </nav>

      <div className="fb-body">
        <p className="fb-eyebrow">Feedback &amp; recommendations</p>
        <h1 className="fb-heading">Help shape what Astorra builds next.</h1>
        <p className="fb-sub">
          Tell us what's working, what isn't, or what module you wish existed.
          Every submission goes straight to the team building it.
        </p>

        {submitted ? (
          <div className="fb-success">
            <div className="fb-success-icon">✓</div>
            <h3>Thanks — that's in.</h3>
            <p>We read every submission. If you left an email, we may follow up.</p>
            <button className="fb-cancel-btn" onClick={() => navigate("/")}>
              Back to home
            </button>
          </div>
        ) : (
          <form className="fb-card" onSubmit={handleSubmit}>
            <div className="fb-type-row">
              {TYPES.map((t) => (
                <button
                  type="button"
                  key={t.value}
                  className={`fb-type-btn ${type === t.value ? "fb-type-btn--active" : ""}`}
                  onClick={() => setType(t.value)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <label className="fb-label" htmlFor="fb-name">
              Name (optional)
            </label>
            <input
              id="fb-name"
              className="fb-input"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label className="fb-label" htmlFor="fb-email">
              Email (optional, if you'd like a reply)
            </label>
            <input
              id="fb-email"
              type="email"
              className="fb-input"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="fb-label" htmlFor="fb-message">
              Your message
            </label>
            <textarea
              id="fb-message"
              className="fb-input fb-textarea"
              placeholder="What would make Astorra better for your business?"
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            {error && <p className="fb-error">{error}</p>}

            <button className="fb-submit-btn" type="submit" disabled={submitting}>
              {submitting ? <span className="fb-spinner" /> : "Send feedback"}
            </button>
          </form>
        )}
      </div>

      <footer className="fb-footer">
        <div className="fb-footer-inner">
          <span className="fb-wordmark fb-wordmark-small" onClick={() => navigate("/")}>
            ASTORRA
          </span>
          <div className="fb-footer-meta">
            <span>Owned and operated by R&amp;R Agencies</span>
            <span>info@rragencies.co.za · 081 336 5266</span>
          </div>
          <div className="fb-footer-links">
            <button className="fb-footer-link-btn" onClick={() => navigate("/privacy")}>
              Privacy Policy
            </button>
            <span className="fb-footer-link-sep">·</span>
            <button className="fb-footer-link-btn" onClick={() => navigate("/terms")}>
              Terms of Service
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Feedback;