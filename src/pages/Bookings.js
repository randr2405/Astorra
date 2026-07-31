import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Bookings.css";

const STATUSES = ["confirmed", "cancelled", "completed"];

function toDateKey(iso) {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function formatDateHeading(dateKey) {
  const d = new Date(dateKey + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function formatTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function emptyForm() {
  return { title: "", customer_id: "", starts_at: "", ends_at: "", status: "confirmed" };
}

function Bookings({ business, appUser }) {
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("upcoming"); // upcoming | past | all

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("bookings")
      .select("*, customers(name)")
      .eq("business_id", business.id)
      .order("starts_at", { ascending: true });

    if (!fetchError) setBookings(data || []);
    setLoading(false);
  }, [business.id]);

  const fetchCustomers = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name")
      .eq("business_id", business.id)
      .order("name", { ascending: true });
    setCustomers(data || []);
  }, [business.id]);

  useEffect(() => {
    fetchBookings();
    fetchCustomers();
  }, [fetchBookings, fetchCustomers]);

  const openAddModal = () => {
    setEditingBooking(null);
    setForm(emptyForm());
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (booking) => {
    setEditingBooking(booking);
    setForm({
      title: booking.title || "",
      customer_id: booking.customer_id || "",
      starts_at: toLocalInputValue(booking.starts_at),
      ends_at: toLocalInputValue(booking.ends_at),
      status: booking.status,
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingBooking(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.title.trim()) return setError("Enter a title for the booking.");
    if (!form.starts_at) return setError("Set a start date and time.");
    if (form.ends_at && new Date(form.ends_at) < new Date(form.starts_at)) {
      return setError("End time can't be before the start time.");
    }

    setSaving(true);

    const payload = {
      title: form.title,
      customer_id: form.customer_id || null,
      starts_at: new Date(form.starts_at).toISOString(),
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      status: form.status,
    };

    if (editingBooking) {
      const rescheduled =
        payload.starts_at !== new Date(editingBooking.starts_at).toISOString() ||
        (payload.ends_at || null) !==
          (editingBooking.ends_at ? new Date(editingBooking.ends_at).toISOString() : null);

      const { error: updateError } = await supabase
        .from("bookings")
        .update(payload)
        .eq("id", editingBooking.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }

      if (rescheduled) {
        notify(business.id, appUser?.id, `Booking "${form.title}" was rescheduled.`);
      }
    } else {
      const { error: insertError } = await supabase.from("bookings").insert({
        business_id: business.id,
        ...payload,
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }

      notify(business.id, appUser?.id, `New booking "${form.title}" was scheduled.`);
    }

    setSaving(false);
    closeModal();
    fetchBookings();
  };

  const handleDelete = async (booking) => {
    if (!window.confirm(`Delete "${booking.title}"? This can't be undone.`)) return;

    const { error: deleteError } = await supabase.from("bookings").delete().eq("id", booking.id);

    if (!deleteError) {
      notify(business.id, appUser?.id, `Booking "${booking.title}" was deleted.`);
      fetchBookings();
    }
  };

  const handleCancel = async (booking) => {
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", booking.id);
    if (!updateError) {
      notify(business.id, appUser?.id, `Booking "${booking.title}" was cancelled.`);
      fetchBookings();
    }
  };

  const filteredBookings = useMemo(() => {
    const now = new Date();
    if (filter === "upcoming") return bookings.filter((b) => new Date(b.starts_at) >= now);
    if (filter === "past") return bookings.filter((b) => new Date(b.starts_at) < now);
    return bookings;
  }, [bookings, filter]);

  const groupedByDate = useMemo(() => {
    const groups = {};
    filteredBookings.forEach((b) => {
      const key = toDateKey(b.starts_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    return Object.entries(groups).sort(([a], [b]) =>
      filter === "past" ? b.localeCompare(a) : a.localeCompare(b)
    );
  }, [filteredBookings, filter]);

  return (
    <div className="book-page">
      <AppNav business={business} />

      <div className="book-body">
        <div className="book-header">
          <div>
            <p className="book-eyebrow">Bookings</p>
            <h1 className="book-heading">Your schedule</h1>
          </div>
          <button className="book-add-btn" onClick={openAddModal}>
            + New booking
          </button>
        </div>

        <div className="book-filters">
          {["upcoming", "past", "all"].map((f) => (
            <button
              key={f}
              className={`book-filter-btn ${filter === f ? "book-filter-btn--active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="book-muted">Loading...</p>
        ) : groupedByDate.length === 0 ? (
          <div className="book-empty">
            {filter === "upcoming"
              ? "No upcoming bookings. Create one to get started."
              : filter === "past"
              ? "No past bookings yet."
              : "No bookings yet. Create your first one to get started."}
          </div>
        ) : (
          <div className="book-agenda">
            {groupedByDate.map(([dateKey, items]) => (
              <div className="book-day-group" key={dateKey}>
                <p className="book-day-heading">{formatDateHeading(dateKey)}</p>
                <div className="book-day-list">
                  {items.map((b) => (
                    <div className="book-card" key={b.id}>
                      <div className="book-card-time">
                        <span>{formatTime(b.starts_at)}</span>
                        {b.ends_at && <span className="book-muted">– {formatTime(b.ends_at)}</span>}
                      </div>
                      <div className="book-card-main">
                        <p className="book-card-title">{b.title}</p>
                        <p className={b.customers?.name ? "book-card-customer" : "book-card-customer book-muted"}>
                          {b.customers?.name || "No customer linked"}
                        </p>
                      </div>
                      <span className={`book-status book-status--${b.status}`}>{b.status}</span>
                      <div className="book-card-actions">
                        {b.status === "confirmed" && (
                          <button className="book-action-btn" onClick={() => handleCancel(b)}>
                            Cancel
                          </button>
                        )}
                        <button className="book-action-btn" onClick={() => openEditModal(b)}>
                          Edit
                        </button>
                        <button
                          className="book-action-btn book-action-btn--danger"
                          onClick={() => handleDelete(b)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="book-modal-overlay" onClick={closeModal}>
          <div className="book-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingBooking ? "Edit booking" : "New booking"}</h2>
            <form onSubmit={handleSave}>
              <label className="book-label">Title</label>
              <input
                className="book-input"
                placeholder="e.g. Site visit, Fitting, Consultation"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
              />

              <label className="book-label">Customer (optional)</label>
              <select
                className="book-select"
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              >
                <option value="">No customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <div className="book-row-2">
                <div>
                  <label className="book-label">Starts</label>
                  <input
                    className="book-input"
                    type="datetime-local"
                    value={form.starts_at}
                    onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <label className="book-label">Ends (optional)</label>
                  <input
                    className="book-input"
                    type="datetime-local"
                    value={form.ends_at}
                    onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                  />
                </div>
              </div>

              <label className="book-label">Status</label>
              <select
                className="book-select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>

              {error && <p className="book-error">{error}</p>}

              <div className="book-modal-actions">
                <button type="button" className="book-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="book-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingBooking ? "Save changes" : "Create booking"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Bookings;