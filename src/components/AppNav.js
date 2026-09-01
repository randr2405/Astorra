import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import NotificationBell from "./NotificationBell";
import astorraLogo from "../assets/astorra-logo.png";
import "./AppNav.css";

function AppNav({ business, showBack = true }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path;

  const goTo = (path) => {
    navigate(path);
    setMenuOpen(false);
  };

  const navItems = [
    { path: "/dashboard/ai-builder", label: "AI Builder" },
    { path: "/dashboard/marketplace", label: "Marketplace" },
    { path: "/dashboard/billing", label: "Billing" },
    { path: "/dashboard/team", label: "Team" },
    { path: "/dashboard/settings", label: "Settings" },
  ];

  return (
    <nav className="app-nav">
      <div className="app-nav-inner">
        <div className="app-nav-left">
          {showBack && (
            <button className="app-nav-back" onClick={() => navigate("/dashboard")}>
              ← Dashboard
            </button>
          )}
          <img
            src={astorraLogo}
            alt="Astorra"
            className="app-nav-logo"
            onClick={() => navigate("/dashboard")}
          />
        </div>

        <div className="app-nav-links">
          {navItems.map((item) => (
            <button
              key={item.path}
              className={`app-nav-link ${isActive(item.path) ? "app-nav-link--active" : ""}`}
              onClick={() => navigate(item.path)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="app-nav-right">
          {business?.name && <span className="app-nav-business">{business.name}</span>}
          <NotificationBell business={business} />
          <button className="app-nav-logout" onClick={() => signOut(auth)}>
            Log out
          </button>
          <button
            className={`app-nav-burger ${menuOpen ? "app-nav-burger--open" : ""}`}
            aria-label="Toggle menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="app-nav-mobile-menu">
          {navItems.map((item) => (
            <button
              key={item.path}
              className={`app-nav-mobile-link ${isActive(item.path) ? "app-nav-mobile-link--active" : ""}`}
              onClick={() => goTo(item.path)}
            >
              {item.label}
            </button>
          ))}
          {business?.name && (
            <div className="app-nav-mobile-business">{business.name}</div>
          )}
        </div>
      )}
    </nav>
  );
}

export default AppNav;