import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Notifications.css";

function formatDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Notifications({ business }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!error) setNotifications(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkRead = async (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
  };

  const handleDelete = async (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from("notifications").delete().eq("id", id);
  };

  const handleClearAll = async () => {
    if (!window.confirm("Clear all notifications? This can't be undone.")) return;
    const ids = notifications.map((n) => n.id);
    setNotifications([]);
    if (ids.length > 0) {
      await supabase.from("notifications").delete().in("id", ids);
    }
  };

  const filtered = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="notif-page">
      <nav className="notif-nav">
        <div className="notif-nav-inner">
          <button className="notif-back" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <span className="notif-wordmark">ASTORRA</span>
        </div>
      </nav>

      <div className="notif-body">
        <div className="notif-header">
          <div>
            <p className="notif-eyebrow">Notifications</p>
            <h1 className="notif-heading">All notifications</h1>
          </div>
          <div className="notif-header-actions">
            {unreadCount > 0 && (
              <button className="notif-action-btn" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button className="notif-action-btn notif-action-btn--danger" onClick={handleClearAll}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="notif-filters">
          <button
            className={`notif-filter-btn ${filter === "all" ? "notif-filter-btn--active" : ""}`}
            onClick={() => setFilter("all")}
          >
            All
          </button>
          <button
            className={`notif-filter-btn ${filter === "unread" ? "notif-filter-btn--active" : ""}`}
            onClick={() => setFilter("unread")}
          >
            Unread {unreadCount > 0 && `(${unreadCount})`}
          </button>
        </div>

        {loading ? (
          <p className="notif-muted">Loading...</p>
        ) : filtered.length === 0 ? (
          <div className="notif-empty">
            {filter === "unread" ? "No unread notifications." : "No notifications yet."}
          </div>
        ) : (
          <div className="notif-list">
            {filtered.map((n) => (
              <div className={`notif-item ${n.is_read ? "" : "notif-item--unread"}`} key={n.id}>
                <div className="notif-item-main">
                  <p className="notif-item-message">{n.message}</p>
                  <span className="notif-item-time">{formatDateTime(n.created_at)}</span>
                </div>
                <div className="notif-item-actions">
                  {!n.is_read && (
                    <button className="notif-item-btn" onClick={() => handleMarkRead(n.id)}>
                      Mark read
                    </button>
                  )}
                  <button
                    className="notif-item-btn notif-item-btn--danger"
                    onClick={() => handleDelete(n.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Notifications;