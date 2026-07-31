import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./NotificationBell.css";

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function NotificationBell({ business }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    if (!business?.id) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (!error) setNotifications(data || []);
  }, [business?.id]);

  useEffect(() => {
    fetchNotifications();

    if (!business?.id) return;

    const channel = supabase
      .channel(`notifications-${business.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `business_id=eq.${business.id}`,
        },
        (payload) => {
          setNotifications((prev) => [payload.new, ...prev].slice(0, 10));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [business?.id, fetchNotifications]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const handleBellClick = () => {
    setOpen((prev) => !prev);
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));

    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
  };

  const handleViewAll = () => {
    setOpen(false);
    navigate("/dashboard/notifications");
  };

  return (
    <div className="bell-wrap" ref={wrapRef}>
      <button className="bell-btn" onClick={handleBellClick} aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 2C10.34 2 9 3.34 9 5V5.29C6.72 6.12 5 8.32 5 11V16L3 18V19H21V18L19 16V11C19 8.32 17.28 6.12 15 5.29V5C15 3.34 13.66 2 12 2Z"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M9.5 21C9.5 22.1 10.62 23 12 23C13.38 23 14.5 22.1 14.5 21"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {unreadCount > 0 && <span className="bell-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
      </button>

      {open && (
        <div className="bell-dropdown">
          <div className="bell-dropdown-header">
            <span>Notifications</span>
            {unreadCount > 0 && (
              <button className="bell-mark-read" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="bell-list">
            {notifications.length === 0 ? (
              <p className="bell-empty">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <div className={`bell-item ${n.is_read ? "" : "bell-item--unread"}`} key={n.id}>
                  <p className="bell-message">{n.message}</p>
                  <span className="bell-time">{timeAgo(n.created_at)}</span>
                </div>
              ))
            )}
          </div>

          <button className="bell-view-all" onClick={handleViewAll}>
            View all
          </button>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;