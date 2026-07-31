import { useNavigate } from "react-router-dom";
import AppNav from "../components/AppNav";
import { MODULE_CATALOG, PLAN_DETAILS, getModuleLimit } from "../lib/plans";
import "./Dashboard.css";

function Dashboard({ business, appUser }) {
  const navigate = useNavigate();
  const installed = business?.installed_modules || [];
  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);

  const handleModuleClick = (mod, active) => {
    if (active) {
      navigate(`/dashboard/${mod.route}`);
    } else {
      navigate("/dashboard/marketplace");
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
          <span>
            {PLAN_DETAILS[plan].name} plan · {installed.length} of{" "}
            {limit === Infinity ? "unlimited" : limit} modules installed
          </span>
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
          {MODULE_CATALOG.map((mod) => {
            const active = installed.includes(mod.key);
            return (
              <div className="mod-card" key={mod.key} onClick={() => handleModuleClick(mod, active)}>
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