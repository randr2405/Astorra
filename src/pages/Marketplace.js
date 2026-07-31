import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { MODULE_CATALOG, getModuleLimit } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Marketplace.css";

const CATEGORIES = ["All", "Sales", "Finance", "Operations", "HR"];

function Marketplace({ business, appUser, onBusinessUpdate }) {
  const navigate = useNavigate();
  const [installed, setInstalled] = useState(business?.installed_modules || []);
  const [category, setCategory] = useState("All");
  const [busyKey, setBusyKey] = useState(null);
  const [error, setError] = useState("");

  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;

  const persistModules = async (nextModules) => {
    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ installed_modules: nextModules })
      .eq("id", business.id)
      .select()
      .single();

    if (updateError) {
      setError(updateError.message);
      return false;
    }

    setInstalled(nextModules);
    if (onBusinessUpdate) onBusinessUpdate(data);
    return true;
  };

  const handleInstall = async (mod) => {
    setError("");
    if (atCap) {
      setError(`Your ${plan} plan includes up to ${limit} modules. Upgrade to install more.`);
      return;
    }

    setBusyKey(mod.key);
    const next = [...installed, mod.key];
    const ok = await persistModules(next);
    setBusyKey(null);

    if (ok) {
      notify(business.id, appUser?.id, `"${mod.name}" module was installed.`);
    }
  };

  const handleUninstall = async (mod) => {
    if (!window.confirm(`Remove the ${mod.name} module? Your data stays intact, but you'll lose access until you reinstall it.`)) {
      return;
    }

    setError("");
    setBusyKey(mod.key);
    const next = installed.filter((k) => k !== mod.key);
    const ok = await persistModules(next);
    setBusyKey(null);

    if (ok) {
      notify(business.id, appUser?.id, `"${mod.name}" module was removed.`);
    }
  };

  const filteredModules =
    category === "All" ? MODULE_CATALOG : MODULE_CATALOG.filter((m) => m.category === category);

  return (
    <div className="mkt-page">
      <AppNav business={business} />

      <div className="mkt-body">
        <div className="mkt-header">
          <div>
            <p className="mkt-eyebrow">Marketplace</p>
            <h1 className="mkt-heading">Add what your business needs</h1>
            <p className="mkt-sub">
              {installed.length} of {limit === Infinity ? "unlimited" : limit} modules installed on
              your {plan.charAt(0).toUpperCase() + plan.slice(1)} plan.
            </p>
          </div>
          <button className="mkt-upgrade-btn" onClick={() => navigate("/dashboard/billing")}>
            Manage plan
          </button>
        </div>

        {atCap && limit !== Infinity && (
          <div className="mkt-cap-banner">
            You've reached your plan's module limit.{" "}
            <button className="mkt-inline-link" onClick={() => navigate("/dashboard/billing")}>
              Upgrade your plan
            </button>{" "}
            to install more.
          </div>
        )}

        {error && <p className="mkt-error">{error}</p>}

        <div className="mkt-filters">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={`mkt-filter-btn ${category === c ? "mkt-filter-btn--active" : ""}`}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mkt-grid">
          {filteredModules.map((mod) => {
            const isInstalled = installed.includes(mod.key);
            const isBusy = busyKey === mod.key;
            return (
              <div className="mkt-card" key={mod.key}>
                <div className="mkt-card-top">
                  <div className="mkt-icon">{mod.initial}</div>
                  <span className="mkt-category-tag">{mod.category}</span>
                </div>
                <h3>{mod.name}</h3>
                <p>{mod.desc}</p>
                <div className="mkt-card-actions">
                  {isInstalled ? (
                    <>
                      <button
                        className="mkt-open-btn"
                        onClick={() => navigate(`/dashboard/${mod.route}`)}
                      >
                        Open
                      </button>
                      <button
                        className="mkt-uninstall-btn"
                        onClick={() => handleUninstall(mod)}
                        disabled={isBusy}
                      >
                        {isBusy ? "..." : "Remove"}
                      </button>
                    </>
                  ) : (
                    <button
                      className="mkt-install-btn"
                      onClick={() => handleInstall(mod)}
                      disabled={isBusy || atCap}
                    >
                      {isBusy ? "Installing..." : "Install"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mkt-footnote">
          <strong>Need something custom?</strong> Describe what your business does and Astorra's
          AI Builder will recommend the right modules — coming soon. In the meantime,{" "}
          <a href="mailto:info@rragencies.co.za">get in touch</a> for a custom scope.
        </div>
      </div>
    </div>
  );
}

export default Marketplace;