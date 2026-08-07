import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import NotificationBell from "./NotificationBell";
import "./AppNav.css";

function AppNav({ business, showBack = true }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => location.pathname === path;

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <div className="app-nav-left">
          {showBack && (
            <button className="app-nav-back" onClick={() => navigate("/dashboard")}>
              ← Dashboard
            </button>
          )}
          <span className="app-nav-wordmark">ASTORRA</span>
        </div>

        <div className="app-nav-links">
          <button
            className={`app-nav-link ${isActive("/dashboard/ai-builder") ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/dashboard/ai-builder")}
          >
            AI Builder
          </button>
          <button
            className={`app-nav-link ${isActive("/dashboard/marketplace") ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/dashboard/marketplace")}
          >
            Marketplace
          </button>
          <button
            className={`app-nav-link ${isActive("/dashboard/billing") ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/dashboard/billing")}
          >
            Billing
          </button>
          <button
            className={`app-nav-link ${isActive("/dashboard/team") ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/dashboard/team")}
          >
            Team
          </button>
          <button
            className={`app-nav-link ${isActive("/dashboard/settings") ? "app-nav-link--active" : ""}`}
            onClick={() => navigate("/dashboard/settings")}
          >
            Settings
          </button>
        </div>

        <div className="app-nav-right">
          {business?.name && <span className="app-nav-business">{business.name}</span>}
          <NotificationBell business={business} />
          <button className="app-nav-logout" onClick={() => signOut(auth)}>
            Log out
          </button>
        </div>
      </div>
    </nav>
  );
}

export default AppNav;