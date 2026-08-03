import { useNavigate } from "react-router-dom";
import AppNav from "../components/AppNav";
import { MODULE_CATALOG, PLAN_DETAILS, getModuleLimit } from "../lib/plans";
import "./Dashboard.css";

function Dashboard({ business, appUser }) {
  const navigate = useNavigate();
  const installed = business?.installed_modules || [];
  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const limitIsFinite = limit !== Infinity;
  const fillPercent = limitIsFinite
    ? Math.min(100, Math.round((installed.length / limit) * 100))
    : Math.min(100, Math.round((installed.length / MODULE_CATALOG.length) * 100));

  const handleModuleClick = (mod, active) => {
    if (active) {
      navigate(`/dashboard/${mod.route}`);
    } else {
      navigate("/dashboard/marketplace");
    }
  };

  const handleModuleKeyDown = (e, mod, active) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleModuleClick(mod, active);
    }
  };

  return (
    <div className="dash">
      <AppNav business={business} showBack={false} />

      <div className="dash-body">
        <p className="dash-eyebrow">Dashboard</p>
        <h1 className="dash-heading">Welcome back, {business?.name}</h1>
        <p className="dash-sub">Everything your business runs on, in one place.</p>

        <div className="dash-plan-strip">
          <div className="dash-plan-info">
            <span>
              <span className="dash-plan-badge">{PLAN_DETAILS[plan].name}</span>
              {installed.length} of {limitIsFinite ? limit : "unlimited"} modules installed
            </span>
            <div className="dash-plan-bar">
              <div
                className="dash-plan-bar-fill"
                style={{ "--fill": `${fillPercent}%` }}
              />
            </div>
          </div>
          <div className="dash-plan-actions">
            <button className="dash-plan-link" onClick={() => navigate("/dashboard/marketplace")}>
              Browse marketplace
            </button>
            <button className="dash-plan-link" onClick={() => navigate("/dashboard/billing")}>
              Manage billing
            </button>
          </div>
        </div>

        <p className="dash-section-label">Your modules</p>
        <div className="module-grid">
          {MODULE_CATALOG.map((mod, index) => {
            const active = installed.includes(mod.key);
            return (
              <div
                className="mod-card"
                key={mod.key}
                role="button"
                tabIndex={0}
                style={{ animationDelay: `${0.25 + index * 0.05}s` }}
                onClick={() => handleModuleClick(mod, active)}
                onKeyDown={(e) => handleModuleKeyDown(e, mod, active)}
              >
                <span className={`mod-status ${active ? "mod-status--active" : "mod-status--locked"}`}>
                  {active ? "Active" : "Locked"}
                </span>
                <div className="mod-icon">{mod.initial}</div>
                <h3>{mod.name}</h3>
                <p>{mod.desc}</p>
              </div>
            );
          })}
        </div>

        <div className="dash-footnote">
          <strong>More modules coming soon.</strong> Browse the marketplace or describe what
          you need and the AI Builder will set it up.
        </div>
      </div>
    </div>
  );
}

export default Dashboard;