import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { PLANS, PLAN_DETAILS, getModuleLimit, capModulesToPlan } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Billing.css";

function Billing({ business, appUser, onBusinessUpdate }) {
  const [switchingTo, setSwitchingTo] = useState(null);
  const [error, setError] = useState("");

  const currentPlan = business?.plan || "free";
  const installed = business?.installed_modules || [];

  const handleSwitchPlan = async (planKey) => {
    if (planKey === currentPlan) return;
    setError("");

    const newLimit = getModuleLimit(planKey);
    const isDowngrade = newLimit < installed.length;

    if (isDowngrade) {
      const excess = installed.length - newLimit;
      const proceed = window.confirm(
        `The ${PLAN_DETAILS[planKey].name} plan only includes ${newLimit} modules. ` +
          `You currently have ${installed.length} installed, so ${excess} will be removed ` +
          `(your data stays intact — you can reinstall or upgrade later). Continue?`
      );
      if (!proceed) return;
    }

    setSwitchingTo(planKey);

    // NOTE: this updates the plan directly. Once PayFast is wired in, this
    // should instead kick off a subscription/checkout flow and only update
    // `plan` after PayFast confirms the payment via webhook.
    const nextModules = isDowngrade ? capModulesToPlan(installed, planKey) : installed;

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ plan: planKey, installed_modules: nextModules })
      .eq("id", business.id)
      .select()
      .single();

    setSwitchingTo(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    notify(business.id, appUser?.id, `Plan changed to ${PLAN_DETAILS[planKey].name}.`);
  };

  return (
    <div className="bill-page">
      <AppNav business={business} />

      <div className="bill-body">
        <p className="bill-eyebrow">Billing</p>
        <h1 className="bill-heading">Your plan</h1>
        <p className="bill-sub">
          Pay for what you use, and grow when you're ready. You're currently on the{" "}
          <strong>{PLAN_DETAILS[currentPlan].name}</strong> plan with {installed.length} module
          {installed.length === 1 ? "" : "s"} installed.
        </p>

        {error && <p className="bill-error">{error}</p>}

        <div className="bill-grid">
          {PLANS.map((planKey) => {
            const details = PLAN_DETAILS[planKey];
            const isCurrent = planKey === currentPlan;
            const isBusy = switchingTo === planKey;
            return (
              <div className={`bill-card ${isCurrent ? "bill-card--current" : ""}`} key={planKey}>
                {isCurrent && <span className="bill-badge">Current plan</span>}
                <h3>{details.name}</h3>
                <div className="bill-amount">
                  <span className="bill-price">{details.price}</span>
                  <span className="bill-cadence">{details.cadence}</span>
                </div>
                <p className="bill-modules">
                  {getModuleLimit(planKey) === Infinity
                    ? "Unlimited modules"
                    : `Up to ${getModuleLimit(planKey)} modules`}
                </p>
                <p className="bill-ai">{details.ai}</p>
                <p className="bill-extra">{details.extraModulePrice}</p>
                <button
                  className={isCurrent ? "bill-btn bill-btn--disabled" : "bill-btn"}
                  onClick={() => handleSwitchPlan(planKey)}
                  disabled={isCurrent || isBusy}
                >
                  {isCurrent ? "Current plan" : isBusy ? "Switching..." : "Switch plan"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="bill-footnote">
          <strong>Need something custom?</strong> For requirements beyond the standard modules,
          Astorra builds fully custom software too — <a href="mailto:info@rragencies.co.za">get in touch</a> to scope it.
        </div>
      </div>
    </div>
  );
}

export default Billing;