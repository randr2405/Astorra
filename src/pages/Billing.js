import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { PLANS, PLAN_DETAILS, getModuleLimit, capModulesToPlan } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Billing.css";

// Must match REACT_APP_SUPABASE_URL's project ref — Edge Functions live at
// <SUPABASE_URL>/functions/v1/<function-name>.
const FUNCTIONS_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

// After a PayFast redirect back to this page, the browser round-trip and
// PayFast's separate, asynchronous ITN webhook race each other — the
// redirect often lands here before payfast-notify has actually processed
// the payment and updated the business's plan. So on `?payment=success`
// we poll for a short window until the plan changes, rather than trusting
// whatever `business` prop we were mounted with.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90 seconds total — PayFast sandbox ITN delivery can be slow

function Billing({ business, appUser, onBusinessUpdate }) {
  const [switchingTo, setSwitchingTo] = useState(null);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const pollAttempts = useRef(0);

  const currentPlan = business?.plan || "free";
  const installed = business?.installed_modules || [];

  useEffect(() => {
    if (searchParams.get("payment") !== "success" || !business?.id) return;

    setPolling(true);
    setPollTimedOut(false);
    pollAttempts.current = 0;

    const interval = setInterval(async () => {
      pollAttempts.current += 1;

      const { data, error: pollError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", business.id)
        .single();

      if (!pollError && data && data.plan !== currentPlan) {
        // Plan changed — the ITN has landed. Update state and stop polling.
        if (onBusinessUpdate) onBusinessUpdate(data);
        setPolling(false);
        clearInterval(interval);
        // Clean the query param so refreshing doesn't re-trigger polling.
        setSearchParams({}, { replace: true });
        return;
      }

      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        // Gave up — the payment may still be processing on PayFast's side.
        // Stop polling so we don't hammer the database forever, but let
        // the person know explicitly rather than going silent.
        setPolling(false);
        setPollTimedOut(true);
        clearInterval(interval);
        setSearchParams({}, { replace: true });
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, business?.id]);

  const handleManualRefresh = async () => {
    const { data, error: refreshError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", business.id)
      .single();

    if (!refreshError && data) {
      if (onBusinessUpdate) onBusinessUpdate(data);
      setPollTimedOut(false);
    }
  };

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

    // Free is the only plan with no PayFast step — switch straight away,
    // and cancel any existing recurring subscription so billing stops.
    if (planKey === "free") {
      setSwitchingTo(planKey);

      if (business.payfast_token) {
        const { error: cancelError } = await supabase.functions.invoke("payfast-cancel", {
          body: { business_id: business.id },
        });
        if (cancelError) {
          setSwitchingTo(null);
          return setError(`Could not cancel your active subscription: ${cancelError.message}`);
        }
      }

      const nextModules = isDowngrade ? capModulesToPlan(installed, planKey) : installed;
      const { data, error: updateError } = await supabase
        .from("businesses")
        .update({ plan: "free", installed_modules: nextModules })
        .eq("id", business.id)
        .select()
        .single();

      setSwitchingTo(null);

      if (updateError) {
        return setError(updateError.message);
      }

      if (onBusinessUpdate) onBusinessUpdate(data);
      notify(business.id, appUser?.id, `Plan changed to ${PLAN_DETAILS.free.name}.`);
      return;
    }

    // Paid plans go through PayFast. The plan does NOT change here — it
    // only changes once payfast-notify confirms the payment server-side.
    //
    // Supabase's edge runtime forces a sandboxed CSP + text/plain on every
    // function response, so it can't serve an HTML auto-submit page itself.
    // Instead the function returns the signed fields as JSON, and we build
    // and submit the actual form to PayFast from here.
    setSwitchingTo(planKey);
    setError("");

    try {
      const response = await fetch(
        `${FUNCTIONS_URL}/payfast-checkout?business_id=${business.id}&plan=${planKey}`
      );

      if (!response.ok) {
        throw new Error(`Checkout setup failed (${response.status})`);
      }

      const { action, fields } = await response.json();

      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;

      Object.entries(fields).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setSwitchingTo(null);
      setError(`Could not start checkout: ${err.message}`);
    }
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

        {polling && (
          <p className="bill-sub" style={{ color: "#14b8a6" }}>
            Confirming your payment with PayFast — this can take a minute or so...
          </p>
        )}

        {pollTimedOut && (
          <p className="bill-sub" style={{ color: "#f59e0b" }}>
            Still waiting to hear back from PayFast about your payment.{" "}
            <button
              onClick={handleManualRefresh}
              style={{
                background: "none",
                border: "none",
                color: "#3b82f6",
                textDecoration: "underline",
                cursor: "pointer",
                padding: 0,
                font: "inherit",
              }}
            >
              Check again
            </button>
          </p>
        )}

        {business?.subscription_status === "failed" && (
          <p className="bill-error">
            Your last payment didn't go through. Please switch your plan again to retry.
          </p>
        )}

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
                  {isCurrent ? "Current plan" : isBusy ? "Redirecting..." : "Switch plan"}
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