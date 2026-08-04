import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { PLANS, PLAN_DETAILS, getModuleLimit, capModulesToPlan, getAiAccess } from "../lib/plans";
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

  const [pendingDowngrade, setPendingDowngrade] = useState(null); // planKey awaiting confirmation
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const currentPlan = business?.plan || "free";
  const installed = business?.installed_modules || [];

  // AI credit usage. The monthly rollover is only actually applied inside
  // the ai-builder edge function when a request is made — so if a
  // business hasn't called AI Builder yet this month, ai_credits_used in
  // the database may still reflect last month's count. We account for
  // that here client-side so the number shown is never misleadingly
  // stale, even before their next AI Builder request triggers the real
  // reset in the database.
  const aiAccess = getAiAccess(currentPlan);
  const creditsLimit = aiAccess.monthlyCredits;
  const resetAt = business?.ai_credits_reset_at ? new Date(business.ai_credits_reset_at) : null;
  const isPastReset = resetAt ? new Date() >= resetAt : false;
  const rawCreditsUsed = business?.ai_credits_used ?? 0;
  const creditsUsed = isPastReset ? 0 : rawCreditsUsed;
  const creditsRemaining = creditsLimit === Infinity ? Infinity : Math.max(creditsLimit - creditsUsed, 0);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

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
        setToast({ type: "success", text: `You're now on the ${PLAN_DETAILS[data.plan].name} plan` });
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

  const switchToFree = async () => {
    setSwitchingTo("free");
    setPendingDowngrade(null);

    if (business.payfast_token) {
      const { error: cancelError } = await supabase.functions.invoke("payfast-cancel", {
        body: { business_id: business.id },
      });
      if (cancelError) {
        setSwitchingTo(null);
        return setError(`Could not cancel your active subscription: ${cancelError.message}`);
      }
    }

    const newLimit = getModuleLimit("free");
    const isDowngrade = newLimit < installed.length;
    const nextModules = isDowngrade ? capModulesToPlan(installed, "free") : installed;
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
    setToast({ type: "neutral", text: `Switched to ${PLAN_DETAILS.free.name}` });
    notify(business.id, appUser?.id, `Plan changed to ${PLAN_DETAILS.free.name}.`);
  };

  const startPaidCheckout = async (planKey) => {
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

  const handleSwitchPlan = (planKey) => {
    if (planKey === currentPlan) return;
    setError("");

    const newLimit = getModuleLimit(planKey);
    const isDowngrade = newLimit < installed.length;

    if (isDowngrade) {
      setPendingDowngrade(planKey);
      return;
    }

    if (planKey === "free") {
      switchToFree();
    } else {
      startPaidCheckout(planKey);
    }
  };

  const confirmDowngrade = () => {
    if (pendingDowngrade === "free") {
      switchToFree();
    } else if (pendingDowngrade) {
      startPaidCheckout(pendingDowngrade);
    }
  };

  return (
    <div className="bill-page">
      <AppNav business={business} />

      <div className="bill-body">
        <div className={loaded ? "bill-in" : ""}>
          <p className="bill-eyebrow">Billing</p>
          <h1 className="bill-heading">Your plan</h1>
          <p className="bill-sub">
            Pay for what you use, and grow when you're ready. You're currently on the{" "}
            <strong>{PLAN_DETAILS[currentPlan].name}</strong> plan with {installed.length} module
            {installed.length === 1 ? "" : "s"} installed.
          </p>
        </div>

        {creditsLimit > 0 && (
          <p className={`bill-sub bill-credits ${loaded ? "bill-in" : ""}`}>
            {creditsLimit === Infinity ? (
              "Unlimited AI Builder requests this month."
            ) : (
              <>
                <strong>{creditsRemaining}</strong> of {creditsLimit} AI Builder request
                {creditsLimit === 1 ? "" : "s"} left this month
                {resetAt && !isPastReset && (
                  <>
                    {" "}
                    — resets{" "}
                    {resetAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </>
                )}
                .
              </>
            )}
          </p>
        )}

        {polling && (
          <p className="bill-status bill-status--info mkt-in bill-in">
            <span className="bill-status-dot" />
            Confirming your payment with PayFast — this can take a minute or so...
          </p>
        )}

        {pollTimedOut && (
          <p className="bill-status bill-status--warn bill-in">
            Still waiting to hear back from PayFast about your payment.{" "}
            <button className="bill-inline-link" onClick={handleManualRefresh}>
              Check again
            </button>
          </p>
        )}

        {business?.subscription_status === "failed" && (
          <p className="bill-error bill-in">
            Your last payment didn't go through. Please switch your plan again to retry.
          </p>
        )}

        {error && <p className="bill-error bill-in">{error}</p>}

        <div className="bill-grid">
          {PLANS.map((planKey, i) => {
            const details = PLAN_DETAILS[planKey];
            const isCurrent = planKey === currentPlan;
            const isBusy = switchingTo === planKey;
            const isConfirming = pendingDowngrade === planKey;
            return (
              <div
                className={`bill-card ${isCurrent ? "bill-card--current" : ""} ${loaded ? "bill-in" : ""}`}
                key={planKey}
                style={{ transitionDelay: loaded ? `${i * 50}ms` : "0ms" }}
              >
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

                {isConfirming ? (
                  <div className="bill-confirm">
                    <p>
                      The {details.name} plan includes {getModuleLimit(planKey)} module
                      {getModuleLimit(planKey) === 1 ? "" : "s"}. You have {installed.length} installed
                      — {installed.length - getModuleLimit(planKey)} will be removed (your data stays
                      intact).
                    </p>
                    <div className="bill-confirm-actions">
                      <button className="bill-confirm-yes" onClick={confirmDowngrade} disabled={isBusy}>
                        {isBusy ? "Working..." : "Continue"}
                      </button>
                      <button
                        className="bill-confirm-no"
                        onClick={() => setPendingDowngrade(null)}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={isCurrent ? "bill-btn bill-btn--disabled" : "bill-btn"}
                    onClick={() => handleSwitchPlan(planKey)}
                    disabled={isCurrent || isBusy}
                  >
                    {isCurrent ? (
                      "Current plan"
                    ) : isBusy ? (
                      <span className="bill-spinner" />
                    ) : (
                      "Switch plan"
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className={`bill-footnote ${loaded ? "bill-in" : ""}`}>
          <strong>Need something custom?</strong> For requirements beyond the standard modules,
          Astorra builds fully custom software too — <a href="mailto:info@rragencies.co.za">get in touch</a> to scope it.
        </div>
      </div>

      {toast && (
        <div className={`bill-toast bill-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "—"} {toast.text}
        </div>
      )}
    </div>
  );
}

export default Billing;