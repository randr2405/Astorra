import { useState } from "react";
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
  const [result, setResult] = useState(null); // { modules: [...], reasoning }
  const [installing, setInstalling] = useState(false);

  const installed = business?.installed_modules || [];
  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;

  // AI access tier — separate from the overall module cap. Free has no
  // access at all (this page shouldn't even be reachable for Free, see
  // the route guard in App.js, but we double-check here too). Starter is
  // capped very low, Professional gets a business-level cap, Enterprise
  // is unlimited.
  const aiAccess = getAiAccess(plan);
  const recCap = aiAccess.maxRecommendations;
  const noAiAccess = aiAccess.level === "none";

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

    if (fnError || data?.error) {
      setError(data?.error || fnError.message || "Something went wrong. Please try again.");
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
    const nextModules = [...installed, ...toInstall];

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ installed_modules: nextModules })
      .eq("id", business.id)
      .select()
      .single();

    setInstalling(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);

    const names = toInstall.map((k) => getModule(k)?.name || k).join(", ");
    notify(business.id, appUser?.id, `AI Builder installed: ${names}.`);

    if (toInstall.length < result.modules.length) {
      setError(
        `Installed ${toInstall.length} of ${result.modules.length} recommended modules — ` +
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
          <p className="aib-eyebrow">AI Builder</p>
          <h1 className="aib-heading">AI Builder isn't included on your plan</h1>
          <p className="aib-sub">
            Upgrade to Starter or above to get AI-powered module recommendations.
          </p>
          <button className="aib-install-btn" onClick={() => navigate("/dashboard/billing")}>
            View plans
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="aib-page">
      <AppNav business={business} />

      <div className="aib-body">
        <p className="aib-eyebrow">AI Builder</p>
        <h1 className="aib-heading">Describe your problem. We'll set it up.</h1>
        <p className="aib-sub">
          Tell us what your business does, in your own words — no need to know which modules
          exist.
        </p>
        <p className="aib-sub" style={{ fontSize: "12.5px", opacity: 0.75 }}>
          Your {PLAN_NAME_FALLBACK(plan)} plan can install up to{" "}
          {recCap === Infinity ? "unlimited modules" : `${recCap} module${recCap === 1 ? "" : "s"}`} per
          AI Builder request.
        </p>

        <form className="aib-form" onSubmit={handleSubmit}>
          <textarea
            className="aib-textarea"
            rows={4}
            placeholder="e.g. We hire out equipment and need to track who has what"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <button type="submit" className="aib-submit" disabled={loading || !description.trim()}>
            {loading ? "Thinking..." : "Get recommendations"}
          </button>
        </form>

        {error && <p className="aib-error">{error}</p>}

        {result && (
          <div className="aib-result">
            {result.modules.length === 0 ? (
              <p className="aib-reasoning">{result.reasoning}</p>
            ) : (
              <>
                <p className="aib-reasoning">{result.reasoning}</p>

                <div className="aib-module-list">
                  {result.modules.map((key) => {
                    const mod = getModule(key);
                    if (!mod) return null;
                    return (
                      <div className="aib-module-card" key={key}>
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