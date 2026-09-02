import { useState, useEffect, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { capModulesToPlan } from "../lib/plans";
import "./Onboarding.css";

const checklistOptions = [
  { key: "quotes", label: "We send quotes to customers", icon: "📄" },
  { key: "jobs", label: "We manage jobs or projects for customers", icon: "🛠️" },
  { key: "invoices", label: "We invoice customers", icon: "🧾" },
  { key: "expenses", label: "We log business expenses", icon: "💳" },
  { key: "bookings", label: "We manage bookings or scheduling", icon: "📅" },
  { key: "stock", label: "We track stock or inventory", icon: "📦" },
  { key: "staff", label: "We manage staff records", icon: "🧑‍🤝‍🧑" },
];

const DEFAULT_PLAN = "free";

function mapAnswersToModules(answers) {
  const modules = new Set();

  if (answers.quotes) {
    modules.add("quotes");
    modules.add("customers");
  }
  if (answers.jobs) {
    modules.add("jobs");
  }
  if (answers.invoices) {
    modules.add("invoices");
    modules.add("customers");
  }
  if (answers.expenses) {
    modules.add("expenses");
  }
  if (answers.bookings) {
    modules.add("bookings");
  }
  if (answers.stock) {
    modules.add("inventory");
  }
  if (answers.staff) {
    modules.add("staff");
  }

  return Array.from(modules);
}

const STEPS = ["details", "workflow", "review"];

function Onboarding({ firebaseUser, onComplete }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [direction, setDirection] = useState("forward");
  const [businessName, setBusinessName] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [answers, setAnswers] = useState({
    quotes: false,
    jobs: false,
    invoices: false,
    expenses: false,
    bookings: false,
    stock: false,
    staff: false,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleAnswer = (key) => {
    setAnswers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectedCount = Object.values(answers).filter(Boolean).length;

  const goNext = () => {
    setError("");
    if (stepIndex === 0 && !businessName.trim()) {
      setError("Give your workspace a name before we continue.");
      return;
    }
    setDirection("forward");
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const goBack = () => {
    setError("");
    setDirection("back");
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    // Every business starts on the Free plan. Upgrading (and any module
    // count above the plan cap) happens later via Billing/Marketplace.
    const installedModules = capModulesToPlan(mapAnswersToModules(answers), DEFAULT_PLAN);

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        name: businessName,
        team_size: teamSize,
        plan: DEFAULT_PLAN,
        installed_modules: installedModules,
        created_by: firebaseUser.uid,
      })
      .select()
      .single();

    if (businessError) {
      setSubmitting(false);
      return setError(businessError.message);
    }

    // NOTE: intentionally not chaining .select().single() onto this insert.
    // Chaining a select onto an insert makes PostgREST insert the row AND
    // then read it back (including the joined businesses(*) data), and that
    // read-back is subject to SELECT policies, not the INSERT policy. That
    // was producing an RLS error that looked like it came from the insert
    // itself. Doing a plain insert avoids that read-back entirely.
    const { error: userError } = await supabase.from("users").insert({
      firebase_uid: firebaseUser.uid,
      business_id: business.id,
      email: firebaseUser.email,
      role: "owner",
    });

    if (userError) {
      setSubmitting(false);
      return setError(userError.message);
    }

    // Build the userRow shape locally from data we already have, since we
    // no longer fetch it back from Supabase as part of the insert.
    const userRow = {
      firebase_uid: firebaseUser.uid,
      business_id: business.id,
      email: firebaseUser.email,
      role: "owner",
      businesses: business,
    };

    onComplete(business, userRow);
  };

  return (
    <div className="onboard-page">
      <div className="onboard-atmosphere" aria-hidden="true">
        <div className="onboard-grain" />
        <div className="onboard-orb onboard-orb--one" />
        <div className="onboard-orb onboard-orb--two" />
        <svg className="onboard-plot" viewBox="0 0 400 400" aria-hidden="true">
          <polyline
            points="0,320 40,300 80,260 120,270 160,190 200,210 240,120 280,150 320,60 360,90 400,20"
            fill="none"
          />
        </svg>
      </div>

      <div className={`onboard-shell ${mounted ? "is-mounted" : ""}`}>
        <aside className="onboard-rail">
          <div className="onboard-rail-mark">◆</div>
          <ol className="onboard-rail-steps">
            <li className={stepIndex >= 0 ? "is-active" : ""}>
              <span className="onboard-rail-index">01</span>
              <span>Your business</span>
            </li>
            <li className={stepIndex >= 1 ? "is-active" : ""}>
              <span className="onboard-rail-index">02</span>
              <span>Daily workflow</span>
            </li>
            <li className={stepIndex >= 2 ? "is-active" : ""}>
              <span className="onboard-rail-index">03</span>
              <span>Launch</span>
            </li>
          </ol>
          <p className="onboard-rail-note">
            Nothing here is permanent — every module can be changed later from Settings.
          </p>
        </aside>

        <div className="onboard-card" key={stepIndex} ref={cardRef}>
          <form onSubmit={handleSubmit} className={`onboard-step onboard-step--${direction}`}>
            {stepIndex === 0 && (
              <div className="onboard-panel">
                <p className="onboard-eyebrow">Step 01 — Foundations</p>
                <h1 className="onboard-heading">
                  Let's name the <span>workspace</span> you're building.
                </h1>
                <p className="onboard-sub">
                  This is what your team will see every time they sign in.
                </p>

                <label className="onboard-label" htmlFor="businessName">
                  Business name
                </label>
                <input
                  id="businessName"
                  className="onboard-input"
                  placeholder="e.g. Coastal Electrical Services"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  autoFocus
                  required
                />

                <label className="onboard-label" htmlFor="teamSize">
                  Team size
                </label>
                <input
                  id="teamSize"
                  className="onboard-input"
                  placeholder="e.g. 1-5"
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                />

                {error && <p className="onboard-error">{error}</p>}

                <button type="button" className="onboard-cta" onClick={goNext}>
                  Continue
                  <span className="onboard-cta-arrow">→</span>
                </button>
              </div>
            )}

            {stepIndex === 1 && (
              <div className="onboard-panel">
                <p className="onboard-eyebrow">Step 02 — Workflow</p>
                <h1 className="onboard-heading">
                  What does your business <span>do day to day?</span>
                </h1>
                <p className="onboard-sub">
                  Pick everything that applies — we'll switch these modules on for you.
                </p>

                <div className="onboard-checklist">
                  {checklistOptions.map((opt, idx) => (
                    <label
                      className={`onboard-check ${answers[opt.key] ? "is-checked" : ""}`}
                      key={opt.key}
                      style={{ "--delay": `${idx * 45}ms` }}
                    >
                      <input
                        type="checkbox"
                        checked={answers[opt.key]}
                        onChange={() => toggleAnswer(opt.key)}
                      />
                      <span className="onboard-check-icon">{opt.icon}</span>
                      <span className="onboard-check-label">{opt.label}</span>
                      <span className="onboard-check-mark">✓</span>
                    </label>
                  ))}
                </div>

                <p className="onboard-count">
                  {selectedCount === 0
                    ? "No worries — you can always add modules later."
                    : `${selectedCount} module${selectedCount > 1 ? "s" : ""} selected`}
                </p>

                <div className="onboard-nav-row">
                  <button type="button" className="onboard-ghost" onClick={goBack}>
                    ← Back
                  </button>
                  <button type="button" className="onboard-cta" onClick={goNext}>
                    Continue
                    <span className="onboard-cta-arrow">→</span>
                  </button>
                </div>
              </div>
            )}

            {stepIndex === 2 && (
              <div className="onboard-panel">
                <p className="onboard-eyebrow">Step 03 — Launch</p>
                <h1 className="onboard-heading">
                  <span>{businessName || "Your workspace"}</span> is ready to go.
                </h1>
                <p className="onboard-sub">
                  Here's what we're setting up — you can change any of it later.
                </p>

                <div className="onboard-summary">
                  <div className="onboard-summary-row">
                    <span className="onboard-summary-key">Business</span>
                    <span className="onboard-summary-val">{businessName || "—"}</span>
                  </div>
                  <div className="onboard-summary-row">
                    <span className="onboard-summary-key">Team size</span>
                    <span className="onboard-summary-val">{teamSize || "Not specified"}</span>
                  </div>
                  <div className="onboard-summary-row">
                    <span className="onboard-summary-key">Plan</span>
                    <span className="onboard-summary-val onboard-plan-pill">Free</span>
                  </div>
                  <div className="onboard-summary-row onboard-summary-row--modules">
                    <span className="onboard-summary-key">Modules</span>
                    <div className="onboard-tag-group">
                      {selectedCount === 0 ? (
                        <span className="onboard-summary-val">None yet</span>
                      ) : (
                        checklistOptions
                          .filter((opt) => answers[opt.key])
                          .map((opt) => (
                            <span className="onboard-tag" key={opt.key}>
                              {opt.icon} {opt.label.replace("We ", "")}
                            </span>
                          ))
                      )}
                    </div>
                  </div>
                </div>

                {error && <p className="onboard-error">{error}</p>}

                <div className="onboard-nav-row">
                  <button type="button" className="onboard-ghost" onClick={goBack}>
                    ← Back
                  </button>
                  <button type="submit" className="onboard-cta onboard-cta--final" disabled={submitting}>
                    {submitting ? (
                      <>
                        <span className="onboard-spinner" />
                        Setting up...
                      </>
                    ) : (
                      <>
                        Create my workspace
                        <span className="onboard-cta-arrow">→</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}

export default Onboarding;