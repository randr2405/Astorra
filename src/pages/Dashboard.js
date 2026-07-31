import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { auth } from "../lib/firebase";
import NotificationBell from "../components/NotificationBell";
import "./Dashboard.css";

const allModules = [
  { key: "customers", name: "Customers", desc: "One record per customer, feeding everything else", initial: "C" },
  { key: "quotes", name: "Quotes", desc: "Send a quote, know the moment it's viewed", initial: "Q" },
  { key: "invoices", name: "Invoices", desc: "Convert quotes to invoices, track what's paid", initial: "I" },
  { key: "inventory", name: "Inventory", desc: "Stock levels that stay accurate on their own", initial: "S" },
  { key: "staff", name: "Staff / HR", desc: "Records and basics, without a separate system", initial: "H" },
  { key: "bookings", name: "Bookings", desc: "Scheduling that updates the whole business", initial: "B" },
  { key: "documents", name: "Documents", desc: "Secure file storage for contracts and paperwork", initial: "D" },
];

function Dashboard({ business, appUser }) {
  const navigate = useNavigate();
  const installed = business?.installed_modules || [];

  const handleModuleClick = (mod, active) => {
    if (active) {
      navigate(`/dashboard/${mod.key}`);
    }
  };

  return (
    <div className="dash">
      <nav className="dash-nav">
        <div className="dash-nav-inner">
          <span className="dash-wordmark">ASTORRA</span>
          <div className="dash-nav-right">
            <span className="dash-business">{business?.name}</span>
            <NotificationBell business={business} />
            <button className="dash-logout" onClick={() => signOut(auth)}>
              Log out
            </button>
          </div>
        </div>
      </nav>

      <div className="dash-body">
        <p className="dash-eyebrow">Dashboard</p>
        <h1 className="dash-heading">Welcome back, {business?.name}</h1>
        <p className="dash-sub">Everything your business runs on, in one place.</p>

        <p className="dash-section-label">Your modules</p>
        <div className="module-grid">
          {allModules.map((mod) => {
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