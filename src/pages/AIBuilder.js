import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { getModule, getModuleLimit, getAiAccess } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./AIBuilder.css";

function AIBuilder({ business, appUser, onBusinessUpdate }) {
  const navigate = useNavigate();
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { mode, modules, reasoning, answer }
  const [installing, setInstalling] = useState(false);
  const [credits, setCredits] = useState(null); // { used, limit, resetAt }
  const [textareaFocused, setTextareaFocused] = useState(false);

  // Mount-in reveal animation (matches the rest of the app's .xxx-in pattern)
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30);
    return () => clearTimeout(t);
  }, []);

  const installed = business?.installed_modules || [];
  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;

  // AI access tier — separate from the overall module cap. Free has no
  // access at all (this page shouldn't even be reachable for Free, see
  // the route guard in App.js, but we double-check here too). Starter is
  // capped very low, Professional gets a business-level cap, Enterprise
  // is unlimited. monthlyCredits (shown once we hear back from the
  // server) caps how many AI Builder requests can be made per month.
  const aiAccess = getAiAccess(plan);
  const recCap = aiAccess.maxRecommendations;
  const noAiAccess = aiAccess.level === "none";

  // Same lazy-reset handling as Billing.js: the actual DB rollover only
  // happens when the ai-builder function runs, so if the reset date has
  // already passed but no request has been made yet this month, treat
  // usage as 0 rather than showing a stale number from last month.
  const creditsLimit = aiAccess.monthlyCredits;
  const businessResetAt = business?.ai_credits_reset_at ? new Date(business.ai_credits_reset_at) : null;
  const isPastReset = businessResetAt ? new Date() >= businessResetAt : false;
  const businessCreditsUsed = isPastReset ? 0 : business?.ai_credits_used ?? 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim() || noAiAccess) return;

    setError("");
    setResult(null);
    setLoading(true);

    const { data, error: fnError } = await supabase.functions.invoke("ai-builder", {
      body: { description: description.trim(), installed_modules: installed },
    });

    setLoading(false);

    // The edge function returns a 402-style error payload (still delivered
    // as `data`, since supabase-js doesn't throw on non-2xx by default for
    // functions.invoke — it surfaces the body either way) when out of
    // monthly credits. Surface credits info either way if present so the
    // "X of Y requests left" display stays accurate.
    if (data?.credits_used !== undefined) {
      setCredits({ used: data.credits_used, limit: data.credits_limit, resetAt: data.credits_reset_at });
    }

    if (fnError || data?.error) {
      setError(data?.error || fnError?.message || "Something went wrong. Please try again.");
      return;
    }

    setResult(data);
  };

  const handleInstallAll = async () => {
    if (!result?.modules?.length) return;

    // Cap by whichever is smaller: remaining room under the plan's overall
    // module limit, or the plan's AI-recommendation cap for this request.
    const roomByPlan = limit - installed.length;
    const room = Math.min(roomByPlan, recCap);

    if (room <= 0) {
      if (roomByPlan <= 0) {
        setError(`Your ${plan} plan is at its module limit. Upgrade to install more.`);
      } else {
        setError(`Your ${plan} plan's AI Builder can install up to ${recCap} module${recCap === 1 ? "" : "s"} per request. Upgrade for a higher limit.`);
      }
      return;
    }

    setInstalling(true);
    const toInstall = result.modules.slice(0, room);

    const { data, error: rpcError } = await supabase.rpc("install_modules", {
      p_business_id: business.id,
      p_module_keys: toInstall,
      p_limit: limit,
    });

    setInstalling(false);

    if (rpcError) {
      if (rpcError.message.includes("NOT_AUTHORIZED")) {
        setError("You don't have permission to modify this business.");
      } else {
        setError(rpcError.message);
      }
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);

    // The RPC silently stops adding once the plan cap is hit, so compare
    // what we asked for against what actually landed to know if anything
    // got dropped (e.g. another tab/install landed in between).
    const actuallyInstalled = toInstall.filter((k) => data.installed_modules.includes(k));
    const names = actuallyInstalled.map((k) => getModule(k)?.name || k).join(", ");

    if (actuallyInstalled.length > 0) {
      notify(business.id, appUser?.id, `AI Builder installed: ${names}.`);
    }

    if (actuallyInstalled.length < result.modules.length) {
      setError(
        `Installed ${actuallyInstalled.length} of ${result.modules.length} recommended modules — ` +
          (room === roomByPlan
            ? `your plan is now at its module limit.`
            : `your ${plan} plan's AI Builder limit is ${recCap} module${recCap === 1 ? "" : "s"} per request.`)
      );
    } else {
      navigate("/dashboard");
    }
  };

  // Free (or any plan with no AI access) shouldn't really reach this page —
  // App.js's route guard redirects away — but render a safe fallback here
  // too in case this component is ever reached directly.
  if (noAiAccess) {
    return (
      <div className="aib-page">
        <AppNav business={business} />
        <div className="aib-body">
          <div className={`aib-hero ${mounted ? "aib-in" : ""}`}>
            <div className="aib-badge">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="3.4" stroke="#fff" strokeWidth="1.8" />
              </svg>
            </div>
            <p className="aib-eyebrow">AI Builder</p>
            <h1 className="aib-heading">AI Builder isn't included on your plan</h1>
            <p className="aib-sub">
              Upgrade to Starter or above to get AI-powered module recommendations and business insights.
            </p>
            <button className="aib-install-btn" onClick={() => navigate("/dashboard/billing")}>
              View plans
            </button>
          </div>
        </div>
      </div>
    );
  }

  const creditsUsedDisplay = credits?.used ?? businessCreditsUsed;
  const creditsLimitDisplay = credits?.limit ?? creditsLimit;
  const creditsResetDisplay = credits?.resetAt ? new Date(credits.resetAt) : businessResetAt;
  const outOfCredits =
    creditsLimitDisplay !== undefined &&
    creditsLimitDisplay !== Infinity &&
    creditsUsedDisplay !== undefined &&
    creditsUsedDisplay >= creditsLimitDisplay;

  const hasFiniteCredits = creditsLimitDisplay > 0 && creditsLimitDisplay !== Infinity;
  const creditsPct = hasFiniteCredits
    ? Math.min(100, Math.round((creditsUsedDisplay / creditsLimitDisplay) * 100))
    : 0;
  const creditsRunningLow = hasFiniteCredits && creditsUsedDisplay / creditsLimitDisplay >= 0.75;

  return (
    <div className="aib-page">
      <AppNav business={business} />

      <div className="aib-body">
        <div className={`aib-hero ${mounted ? "aib-in" : ""}`}>
          <div className="aib-badge">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                stroke="#fff"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
              <circle cx="12" cy="12" r="3.4" stroke="#fff" strokeWidth="1.8" />
            </svg>
          </div>
          <p className="aib-eyebrow">AI Builder</p>
          <h1 className="aib-heading">Describe your problem, or ask about your business.</h1>
          <p className="aib-sub">
            Tell us what your business does and we'll recommend modules — or ask a question about
            your business (like "how many customers do we have") and we'll answer using your actual
            data.
          </p>
          <p className="aib-meta">
            Your {PLAN_NAME_FALLBACK(plan)} plan can install up to{" "}
            {recCap === Infinity ? "unlimited modules" : `${recCap} module${recCap === 1 ? "" : "s"}`} per
            AI Builder request.
          </p>

          {creditsLimitDisplay > 0 && (
            <div className="aib-credits-wrap">
              <p className="aib-meta" style={{ margin: 0 }}>
                {creditsLimitDisplay === Infinity
                  ? "Unlimited AI Builder requests this month."
                  : `${Math.max(creditsLimitDisplay - creditsUsedDisplay, 0)} of ${creditsLimitDisplay} AI Builder requests left this month${
                      creditsResetDisplay
                        ? ` (resets ${creditsResetDisplay.toLocaleDateString(undefined, { day: "numeric", month: "short" })})`
                        : ""
                    }.`}
              </p>
              {hasFiniteCredits && (
                <div className="aib-credits-bar">
                  <div
                    className={`aib-credits-fill ${creditsRunningLow ? "aib-credits-fill--warn" : ""}`}
                    style={{ "--fill": `${creditsPct}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`aib-form-wrap ${mounted ? "aib-in" : ""}`}>
          <form className="aib-form" onSubmit={handleSubmit}>
            <div className={`aib-textarea-wrap ${textareaFocused ? "aib-textarea-wrap--focus" : ""}`}>
              <textarea
                className="aib-textarea"
                rows={4}
                placeholder="e.g. We hire out equipment and need to track who has what — or ask: how many quotes did we send this month?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => setTextareaFocused(true)}
                onBlur={() => setTextareaFocused(false)}
              />
            </div>

            <div className="aib-form-footer">
              <span className="aib-char-count">{description.length > 0 ? `${description.length} characters` : ""}</span>
              <button type="submit" className="aib-submit" disabled={loading || !description.trim() || outOfCredits}>
                {loading && <span className="aib-spinner" />}
                {loading ? "Thinking..." : "Ask AI Builder"}
              </button>
            </div>
          </form>

          {loading && (
            <div className="aib-thinking">
              <span className="aib-thinking-dots">
                <span />
                <span />
                <span />
              </span>
              Looking at your business and working out the best answer...
            </div>
          )}

          {outOfCredits && (
            <p className="aib-cap-notice" style={{ marginTop: 18 }}>
              You've used all your AI Builder requests for this month.{" "}
              <button className="aib-inline-link" onClick={() => navigate("/dashboard/billing")}>
                Upgrade
              </button>{" "}
              for more, or wait until your credits reset.
            </p>
          )}

          {error && (
            <p className="aib-error">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
                <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {error}
            </p>
          )}
        </div>

        {result?.mode === "analysis" && (
          <div className="aib-result aib-in">
            <p className="aib-result-kicker">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
              </svg>
              Answer
            </p>
            <p className="aib-reasoning">{result.answer}</p>
          </div>
        )}

        {result?.mode === "modules" && (
          <div className="aib-result aib-in">
            {result.modules.length === 0 ? (
              <>
                <p className="aib-result-kicker">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  Recommendation
                </p>
                <p className="aib-reasoning">{result.reasoning}</p>
              </>
            ) : (
              <>
                <p className="aib-result-kicker">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path
                      d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                    />
                    <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  Recommended for you
                </p>
                <p className="aib-reasoning">{result.reasoning}</p>

                <div className="aib-module-list">
                  {result.modules.map((key, idx) => {
                    const mod = getModule(key);
                    if (!mod) return null;
                    return (
                      <div className="aib-module-card" key={key} style={{ animationDelay: `${idx * 0.06}s` }}>
                        <div className="aib-module-icon">{mod.initial}</div>
                        <div>
                          <h3>{mod.name}</h3>
                          <p>{mod.desc}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {atCap ? (
                  <p className="aib-cap-notice">
                    Your {plan} plan is at its module limit.{" "}
                    <button className="aib-inline-link" onClick={() => navigate("/dashboard/billing")}>
                      Upgrade
                    </button>{" "}
                    to install these.
                  </p>
                ) : (
                  <button className="aib-install-btn" onClick={handleInstallAll} disabled={installing}>
                    {installing && <span className="aib-spinner" />}
                    {installing ? "Installing..." : `Install ${result.modules.length > 1 ? "these modules" : "this module"}`}
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Small local helper just for display text — capitalizes the plan key.
function PLAN_NAME_FALLBACK(plan) {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export default AIBuilder;