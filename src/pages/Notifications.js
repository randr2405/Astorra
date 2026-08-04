import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import AppNav from "../components/AppNav";
import "./Notifications.css";

const UNDO_WINDOW_MS = 5000;

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function formatFullDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Buckets a notification's created_at into one of four groups, based on
// calendar-day distance from today (not a rolling 24h/7-day window).
function bucketFor(iso) {
  const created = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diffDays = Math.round((today - created) / 86400000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Earlier this week";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

// Infers a notification "type" from its message text so we can show a
// colored icon without needing a schema change. Falls back to a generic
// bell for anything that doesn't match a known pattern.
function typeFor(message) {
  const m = message.toLowerCase();
  if (m.includes("overdue")) {
    return { key: "invoice", label: "Invoice", className: "notif-type--invoice" };
  }
  if (m.startsWith("reminder:") || m.includes("coming up")) {
    return { key: "booking", label: "Booking", className: "notif-type--booking" };
  }
  if (m.includes("uploaded to documents")) {
    return { key: "document", label: "Document", className: "notif-type--document" };
  }
  if (m.includes("ai builder installed")) {
    return { key: "ai", label: "AI Builder", className: "notif-type--ai" };
  }
  return { key: "general", label: "Update", className: "notif-type--general" };
}

const TYPE_ICONS = {
  invoice: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 3h9l3 3v15H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  booking: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  document: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  general: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 4a5 5 0 00-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 16h14l-1.4-2.1a2.7 2.7 0 01-.6-1.7V9a5 5 0 00-5-5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 18a2.5 2.5 0 005 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

function Notifications({ business }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());

  // Pending "undo" deletions: id -> { notification, timerId }. The item
  // is already removed from the visible list; if the timer fires without
  // being cancelled, the delete actually commits to the DB.
  const pendingDeletesRef = useRef(new Map());
  const [toast, setToast] = useState(null); // { message, onUndo }

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

  // Realtime: keep the list live without needing a manual refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`notifications-${business.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `business_id=eq.${business.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? payload.new : n)));
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [business.id]);

  // Clean up any in-flight undo timers if the component unmounts.
  useEffect(() => {
    return () => {
      pendingDeletesRef.current.forEach(({ timerId }) => clearTimeout(timerId));
      pendingDeletesRef.current.clear();
    };
  }, []);

  const handleMarkRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
  };

  const dismissToast = () => setToast(null);

  // ---------- Undo-able delete (single + bulk share this) ----------
  const commitDelete = async (ids) => {
    ids.forEach((id) => pendingDeletesRef.current.delete(id));
    await supabase.from("notifications").delete().in("id", ids);
  };

  const scheduleDelete = (items, message) => {
    const ids = items.map((n) => n.id);

    // Remove from view immediately.
    setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    const timerId = setTimeout(() => {
      commitDelete(ids);
      setToast((current) => (current?.ids?.join() === ids.join() ? null : current));
    }, UNDO_WINDOW_MS);

    items.forEach((n) => pendingDeletesRef.current.set(n.id, { notification: n, timerId }));

    setToast({
      ids,
      message,
      onUndo: () => {
        ids.forEach((id) => {
          const pending = pendingDeletesRef.current.get(id);
          if (pending) {
            clearTimeout(pending.timerId);
            pendingDeletesRef.current.delete(id);
          }
        });
        setNotifications((prev) => {
          const restored = items.filter((n) => !prev.some((p) => p.id === n.id));
          return [...prev, ...restored].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });
        setToast(null);
      },
    });
  };

  const handleDelete = (n) => {
    scheduleDelete([n], "Notification deleted");
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    scheduleDelete([...notifications], `${notifications.length} notification${notifications.length === 1 ? "" : "s"} cleared`);
  };

  const handleBulkDelete = () => {
    const items = notifications.filter((n) => selected.has(n.id));
    if (items.length === 0) return;
    scheduleDelete(items, `${items.length} notification${items.length === 1 ? "" : "s"} deleted`);
  };

  const handleBulkMarkRead = async () => {
    const ids = notifications.filter((n) => selected.has(n.id) && !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
  };

  // ---------- Selection ----------
  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // ---------- Derived: filter, search, group ----------
  const filtered = useMemo(() => {
    let result = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((n) => n.message.toLowerCase().includes(q));
    return result;
  }, [notifications, filter, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((n) => {
      const bucket = bucketFor(n.created_at);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket).push(n);
    });
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b) }));
  }, [filtered]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const allVisibleSelected = filtered.length > 0 && filtered.every((n) => selected.has(n.id));

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach((n) => next.delete(n.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((n) => next.add(n.id));
      return next;
    });
  };

  return (
    <div className="notif-page">
      <AppNav business={business} />

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

        <div className="notif-toolbar">
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

          <div className="notif-search-wrap">
            <svg className="notif-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="notif-search-input"
              placeholder="Search notifications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="notif-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
        </div>

        {filtered.length > 0 && (
          <div className="notif-select-bar">
            <label className="notif-checkbox-wrap">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
              <span className="notif-checkbox" />
              <span className="notif-select-label">
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </label>

            {selected.size > 0 && (
              <div className="notif-select-actions">
                <button className="notif-action-btn" onClick={handleBulkMarkRead}>
                  Mark read
                </button>
                <button className="notif-action-btn notif-action-btn--danger" onClick={handleBulkDelete}>
                  Delete
                </button>
                <button className="notif-action-btn notif-action-btn--ghost" onClick={clearSelection}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="notif-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="notif-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="notif-empty">
            {search
              ? "No notifications match your search."
              : filter === "unread"
              ? "No unread notifications."
              : "No notifications yet."}
          </div>
        ) : (
          <div className="notif-groups">
            {grouped.map(({ bucket, items }) => (
              <div className="notif-group" key={bucket}>
                <p className="notif-group-label">{bucket}</p>
                <div className="notif-list">
                  {items.map((n, idx) => {
                    const type = typeFor(n.message);
                    const isSelected = selected.has(n.id);
                    return (
                      <div
                        className={`notif-item ${n.is_read ? "" : "notif-item--unread"} ${isSelected ? "notif-item--selected" : ""}`}
                        key={n.id}
                        style={{ animationDelay: `${Math.min(idx, 10) * 0.03}s` }}
                      >
                        <label className="notif-checkbox-wrap notif-item-checkbox">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(n.id)} />
                          <span className="notif-checkbox" />
                        </label>

                        <div className={`notif-type-icon ${type.className}`} title={type.label}>
                          {TYPE_ICONS[type.key]}
                        </div>

                        <div className="notif-item-main">
                          <p className="notif-item-message">{n.message}</p>
                          <span className="notif-item-time" title={formatFullDateTime(n.created_at)}>
                            {formatTime(n.created_at)}
                          </span>
                        </div>

                        <div className="notif-item-actions">
                          {!n.is_read && (
                            <button className="notif-item-btn" onClick={() => handleMarkRead(n.id)}>
                              Mark read
                            </button>
                          )}
                          <button
                            className="notif-item-btn notif-item-btn--danger"
                            onClick={() => handleDelete(n)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="notif-toast">
          <span>{toast.message}</span>
          <button className="notif-toast-undo" onClick={toast.onUndo}>
            Undo
          </button>
          <button className="notif-toast-close" onClick={dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default Notifications;