import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { MODULE_CATALOG, getModuleLimit } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Marketplace.css";

const CATEGORIES = ["All", "Sales", "Finance", "Operations", "HR"];
const CONFETTI_COLORS = ["#7c3aed", "#3b82f6", "#14b8a6", "#f59e0b", "#fdfdfe"];

function ConfettiBurst({ x, y, onDone }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = ((360 / 18) * i + (Math.random() * 20 - 10)) * (Math.PI / 180);
        const distance = 60 + Math.random() * 50;
        return {
          id: i,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance + 24,
          size: 5 + Math.random() * 4,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          rotate: Math.random() * 360,
          delay: Math.random() * 60,
          shape: Math.random() > 0.5 ? "50%" : "2px",
        };
      }),
    []
  );

  useEffect(() => {
    const t = setTimeout(onDone, 750);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="mkt-confetti-root" style={{ left: x, top: y }}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="mkt-confetti-piece"
          style={{
            "--dx": `${p.dx}px`,
            "--dy": `${p.dy}px`,
            "--rotate": `${p.rotate}deg`,
            "--delay": `${p.delay}ms`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape,
          }}
        />
      ))}
    </div>
  );
}

function Marketplace({ business, appUser, onBusinessUpdate }) {
  const navigate = useNavigate();
  const [installed, setInstalled] = useState(business?.installed_modules || []);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [pendingRemoveKey, setPendingRemoveKey] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [confetti, setConfetti] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;
  const pctFilled = limit === Infinity ? 0 : Math.min(100, (installed.length / limit) * 100);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep local `installed` in sync if the business prop changes from
  // elsewhere (e.g. AI Builder installing modules, then navigating here).
  useEffect(() => {
    setInstalled(business?.installed_modules || []);
  }, [business?.installed_modules]);

  const handleInstall = async (mod, e) => {
    setError("");
    if (atCap) {
      setError(`Your ${plan} plan includes up to ${limit} modules. Upgrade to install more.`);
      return;
    }

    // Capture position BEFORE the await — the event object may not
    // survive the async gap depending on your React version.
    let burstPos = null;
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      burstPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    setBusyKey(mod.key);

    const { data, error: rpcError } = await supabase.rpc("install_module", {
      p_business_id: business.id,
      p_module_key: mod.key,
      p_limit: limit,
    });

    setBusyKey(null);

    if (rpcError) {
      if (rpcError.message.includes("MODULE_LIMIT_REACHED")) {
        setError(`Your ${plan} plan includes up to ${limit} modules. Upgrade to install more.`);
      } else {
        setError(rpcError.message);
      }
      return;
    }

    setInstalled(data.installed_modules);
    if (onBusinessUpdate) onBusinessUpdate(data);

    if (burstPos) {
      setConfetti({ key: Date.now(), ...burstPos });
    }
    setToast({ type: "success", text: `${mod.name} installed` });
    notify(business.id, appUser?.id, `"${mod.name}" module was installed.`);
  };

  const handleUninstall = async (mod) => {
    setPendingRemoveKey(null);
    setError("");
    setBusyKey(mod.key);

    const { data, error: rpcError } = await supabase.rpc("uninstall_module", {
      p_business_id: business.id,
      p_module_key: mod.key,
    });

    setBusyKey(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setInstalled(data.installed_modules);
    if (onBusinessUpdate) onBusinessUpdate(data);

    setToast({ type: "neutral", text: `${mod.name} removed` });
    notify(business.id, appUser?.id, `"${mod.name}" module was removed.`);
  };

  const filteredModules = useMemo(() => {
    let mods = category === "All" ? MODULE_CATALOG : MODULE_CATALOG.filter((m) => m.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      mods = mods.filter(
        (m) => m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
    }
    return mods;
  }, [category, query]);

  return (
    <div className="mkt-page">
      <AppNav business={business} />

      <div className="mkt-body">
        <div className={`mkt-header ${loaded ? "mkt-in" : ""}`}>
          <div>
            <p className="mkt-eyebrow">Marketplace</p>
            <h1 className="mkt-heading">Add what your business needs</h1>
            <p className="mkt-sub">
              {installed.length} of {limit === Infinity ? "unlimited" : limit} modules installed on
              your {plan.charAt(0).toUpperCase() + plan.slice(1)} plan.
            </p>
            {limit !== Infinity && (
              <div
                className="mkt-progress-track"
                role="progressbar"
                aria-valuenow={installed.length}
                aria-valuemin={0}
                aria-valuemax={limit}
              >
                <div
                  className={`mkt-progress-fill ${atCap ? "mkt-progress-fill--full" : ""}`}
                  style={{ width: `${pctFilled}%` }}
                />
              </div>
            )}
          </div>
          <button className="mkt-upgrade-btn" onClick={() => navigate("/dashboard/billing")}>
            Manage plan
          </button>
        </div>

        {atCap && limit !== Infinity && (
          <div className="mkt-cap-banner mkt-in">
            You've reached your plan's module limit.{" "}
            <button className="mkt-inline-link" onClick={() => navigate("/dashboard/billing")}>
              Upgrade your plan
            </button>{" "}
            to install more.
          </div>
        )}

        {error && <p className="mkt-error mkt-in">{error}</p>}

        <div className={`mkt-toolbar ${loaded ? "mkt-in" : ""}`}>
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

          <div className="mkt-search">
            <svg className="mkt-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search modules..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="mkt-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
        </div>

        {filteredModules.length === 0 ? (
          <div className="mkt-empty mkt-in">
            <div className="mkt-empty-icon">?</div>
            <h3>No modules match that search</h3>
            <p>Try a different keyword or browse another category.</p>
            <button
              className="mkt-inline-link"
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mkt-grid">
            {filteredModules.map((mod, i) => {
              const isInstalled = installed.includes(mod.key);
              const isBusy = busyKey === mod.key;
              const confirmingRemove = pendingRemoveKey === mod.key;
              return (
                <div
                  className={`mkt-card ${isInstalled ? "mkt-card--installed" : ""} ${loaded ? "mkt-in" : ""}`}
                  key={mod.key}
                  style={{ transitionDelay: loaded ? `${Math.min(i, 9) * 40}ms` : "0ms" }}
                >
                  {isInstalled && <span className="mkt-installed-badge">Installed</span>}
                  <div className="mkt-card-top">
                    <div className="mkt-icon">{mod.initial}</div>
                    <span className="mkt-category-tag">{mod.category}</span>
                  </div>
                  <h3>{mod.name}</h3>
                  <p>{mod.desc}</p>
                  <div className="mkt-card-actions">
                    {isInstalled ? (
                      confirmingRemove ? (
                        <div className="mkt-confirm-row">
                          <span>Remove module?</span>
                          <button
                            className="mkt-confirm-yes"
                            onClick={() => handleUninstall(mod)}
                            disabled={isBusy}
                          >
                            {isBusy ? "..." : "Yes"}
                          </button>
                          <button className="mkt-confirm-no" onClick={() => setPendingRemoveKey(null)}>
                            No
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="mkt-open-btn"
                            onClick={() => navigate(`/dashboard/${mod.route}`)}
                          >
                            Open
                          </button>
                          <button
                            className="mkt-uninstall-btn"
                            onClick={() => setPendingRemoveKey(mod.key)}
                            disabled={isBusy}
                          >
                            Remove
                          </button>
                        </>
                      )
                    ) : (
                      <button
                        className={`mkt-install-btn ${isBusy ? "mkt-install-btn--busy" : ""}`}
                        onClick={(e) => handleInstall(mod, e)}
                        disabled={isBusy || atCap}
                      >
                        {isBusy ? <span className="mkt-spinner" /> : "Install"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={`mkt-footnote ${loaded ? "mkt-in" : ""}`}>
          <strong>Need something custom?</strong> Describe what your business does and Astorra's
          AI Builder will recommend the right modules — coming soon. In the meantime,{" "}
          <a href="mailto:info@rragencies.co.za">get in touch</a> for a custom scope.
        </div>
      </div>

      {confetti && (
        <ConfettiBurst
          key={confetti.key}
          x={confetti.x}
          y={confetti.y}
          onDone={() => setConfetti(null)}
        />
      )}

      {toast && (
        <div className={`mkt-toast mkt-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "—"} {toast.text}
        </div>
      )}
    </div>
  );
}

export default Marketplace;