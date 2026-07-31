import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Onboarding.css";

const checklistOptions = [
  { key: "quotes", label: "We send quotes to customers" },
  { key: "invoices", label: "We invoice customers" },
  { key: "bookings", label: "We manage bookings or scheduling" },
  { key: "stock", label: "We track stock or inventory" },
  { key: "staff", label: "We manage staff records" },
  { key: "documents", label: "We manage documents or paperwork" },
];

const PLAN_LIMITS = {
  free: 2,
  starter: 5,
  professional: 10,
  enterprise: Infinity,
};

function capModulesToPlan(modules, plan) {
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  return modules.slice(0, limit);
}

function mapAnswersToModules(answers) {
  const modules = new Set();

  if (answers.quotes) {
    modules.add("quotes");
    modules.add("customers");
  }
  if (answers.invoices) {
    modules.add("invoices");
    modules.add("customers");
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
  if (answers.documents) {
    modules.add("documents");
  }

  return Array.from(modules);
}

function Onboarding({ firebaseUser, onComplete }) {
  const [businessName, setBusinessName] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [answers, setAnswers] = useState({
    quotes: false,
    invoices: false,
    bookings: false,
    stock: false,
    staff: false,
    documents: false,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const toggleAnswer = (key) => {
    setAnswers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const installedModules = capModulesToPlan(mapAnswersToModules(answers), "free");

    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .insert({
        name: businessName,
        team_size: teamSize,
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
      <div className="onboard-card">
        <p className="onboard-eyebrow">Step 1 of 1</p>
        <h1 className="onboard-heading">Tell us about your business</h1>
        <p className="onboard-sub">A couple of quick questions, then your workspace is ready.</p>

        <form onSubmit={handleSubmit}>
          <label className="onboard-label" htmlFor="businessName">
            Business name
          </label>
          <input
            id="businessName"
            className="onboard-input"
            placeholder="e.g. Coastal Electrical Services"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
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

          <label className="onboard-label">What does your business do day to day?</label>
          <div className="onboard-checklist">
            {checklistOptions.map((opt) => (
              <label className="onboard-check" key={opt.key}>
                <input
                  type="checkbox"
                  checked={answers[opt.key]}
                  onChange={() => toggleAnswer(opt.key)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>

          {error && <p className="onboard-error">{error}</p>}

          <button type="submit" className="onboard-submit" disabled={submitting}>
            {submitting ? "Setting up..." : "Create my workspace"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Onboarding;