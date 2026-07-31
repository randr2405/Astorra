import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import NotificationBell from "./NotificationBell";
import "./AppNav.css";

function AppNav({ business, showBack = true }) {
  const navigate = useNavigate();

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