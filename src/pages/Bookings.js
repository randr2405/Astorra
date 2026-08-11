import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Bookings.css";

const STATUSES = ["confirmed", "cancelled", "completed"];
const DEFAULT_CONFLICT_DURATION_MIN = 60;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Theme colors used by the grid-scan background (kept in sync with Bookings.css)
const GRID_LINE_COLOR = "#2b3352";
const SCAN_COLOR_A = "#7c3aed";
const SCAN_COLOR_B = "#14b8a6";

/**
 * Self-contained "grid scan" background: a perspective grid converging to a
 * vanishing point, with a glowing scan-band that pulses up and down through
 * it. Pure canvas + React, no external imports or libraries.
 * Renders behind all page content (fixed, z-index 0).
 */
function GridScanBackground({
  lineThickness = 1,
  gridScale = 0.1,
  scanOpacity = 0.4,
  glowIntensity = 0.6,
  jitter = 0.1,
  scanSoftness = 2,
  scanDuration = 3.5,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    const hexToRgb = (hex) => {
      const bigint = parseInt(hex.replace("#", ""), 16);
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    };
    const lineRgb = hexToRgb(GRID_LINE_COLOR);
    const scanRgbA = hexToRgb(SCAN_COLOR_A);
    const scanRgbB = hexToRgb(SCAN_COLOR_B);

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    let lastTime = performance.now();
    let elapsed = 0;

    const draw = (time) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;
      elapsed += dt;

      ctx.clearRect(0, 0, width, height);

      const horizonY = height * 0.42;
      const vanishX = width * 0.5;
      const cellSize = Math.max(28, gridScale * Math.min(width, height) * 2.4);

      ctx.save();
      ctx.strokeStyle = `rgba(${lineRgb.r}, ${lineRgb.g}, ${lineRgb.b}, 0.55)`;
      ctx.lineWidth = lineThickness;

      // Horizontal lines below the horizon, spaced with perspective (denser near horizon)
      const rows = 26;
      for (let i = 1; i <= rows; i++) {
        const t = i / rows;
        const y = horizonY + Math.pow(t, 2.2) * (height - horizonY);
        const fade = 1 - t * 0.85;
        if (fade <= 0.02) continue;
        const jx = jitter > 0 ? Math.sin(elapsed * 0.6 + i) * jitter * 4 : 0;
        ctx.globalAlpha = fade;
        ctx.beginPath();
        ctx.moveTo(0, y + jx);
        ctx.lineTo(width, y + jx);
        ctx.stroke();
      }

      // Converging vertical lines from the horizon fanning down to the base
      const cols = Math.ceil(width / cellSize) + 6;
      const baseSpacing = width / (cols - 1);
      for (let i = 0; i < cols; i++) {
        const baseX = i * baseSpacing - baseSpacing * 3;
        const t = Math.min(1, Math.abs(baseX - vanishX) / (width * 0.9));
        const fade = 1 - t * 0.7;
        ctx.globalAlpha = Math.max(0, fade) * 0.7;
        ctx.beginPath();
        ctx.moveTo(vanishX, horizonY);
        ctx.lineTo(baseX, height);
        ctx.stroke();
      }
      ctx.restore();

      // Scanning glow band sweeping down through the grid (ping-pong)
      const cycle = scanDuration * 2;
      const tCycle = (elapsed % cycle) / scanDuration;
      const phase = tCycle <= 1 ? tCycle : 2 - tCycle;
      const scanY = horizonY + phase * (height - horizonY);

      const bandHeight = Math.max(18, 40 * scanSoftness * 0.5);
      const mixT = (Math.sin(elapsed * 0.5) + 1) / 2;
      const r = scanRgbA.r + (scanRgbB.r - scanRgbA.r) * mixT;
      const g = scanRgbA.g + (scanRgbB.g - scanRgbA.g) * mixT;
      const b = scanRgbA.b + (scanRgbB.b - scanRgbA.b) * mixT;

      ctx.save();
      const grad = ctx.createLinearGradient(0, scanY - bandHeight, 0, scanY + bandHeight);
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${scanOpacity})`);
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, scanY - bandHeight, width, bandHeight * 2);

      // Bright core line with glow (bloom-ish, via layered strokes)
      const glowLayers = Math.max(1, Math.round(glowIntensity * 6));
      for (let i = glowLayers; i >= 1; i--) {
        ctx.globalAlpha = (glowIntensity / glowLayers) * 0.5;
        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 1)`;
        ctx.lineWidth = i * 2.2;
        ctx.beginPath();
        ctx.moveTo(0, scanY);
        ctx.lineTo(width, scanY);
        ctx.stroke();
      }
      ctx.restore();

      rafRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [lineThickness, gridScale, scanOpacity, glowIntensity, jitter, scanSoftness, scanDuration]);

  return (
    <div className="book-grid-bg" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

function toDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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

function formatDuration(startsAt, endsAt) {
  if (!endsAt) return null;
  const mins = Math.round((new Date(endsAt) - new Date(startsAt)) / 60000);
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function startOfWeekMonday(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date, n) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function isSameDay(a, b) {
  return toDateKey(a) === toDateKey(b);
}

function emptyForm() {
  return {
    title: "",
    customer_id: "",
    assigned_staff_id: "",
    starts_at: "",
    ends_at: "",
    status: "confirmed",
  };
}

function Bookings({ business, appUser }) {
  const [bookings, setBookings] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState("upcoming"); // upcoming | past | all (agenda view only)

  // Calendar
  const [view, setView] = useState("month"); // month | week | agenda
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(null); // dateKey string or null

  // Search / filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [staffFilter, setStaffFilter] = useState("all");

  // Bulk selection (agenda + day panel)
  const [selected, setSelected] = useState(() => new Set());

  const fetchBookings = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("bookings")
      .select("*, customers(name), staff:assigned_staff_id(full_name)")
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

  const fetchStaff = useCallback(async () => {
    const { data } = await supabase
      .from("staff")
      .select("id, full_name")
      .eq("business_id", business.id)
      .order("full_name", { ascending: true });
    setStaffList(data || []);
  }, [business.id]);

  useEffect(() => {
    fetchBookings();
    fetchCustomers();
    fetchStaff();
  }, [fetchBookings, fetchCustomers, fetchStaff]);

  const openAddModal = (prefillDateKey) => {
    setEditingBooking(null);
    const form0 = emptyForm();
    if (prefillDateKey) form0.starts_at = `${prefillDateKey}T09:00`;
    setForm(form0);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (booking) => {
    setEditingBooking(booking);
    setForm({
      title: booking.title || "",
      customer_id: booking.customer_id || "",
      assigned_staff_id: booking.assigned_staff_id || "",
      starts_at: toLocalInputValue(booking.starts_at),
      ends_at: toLocalInputValue(booking.ends_at),
      status: booking.status,
    });
    setError("");
    setModalOpen(true);
  };

  const openDuplicateModal = (booking) => {
    setEditingBooking(null);
    setForm({
      title: booking.title ? `${booking.title} (copy)` : "",
      customer_id: booking.customer_id || "",
      assigned_staff_id: booking.assigned_staff_id || "",
      starts_at: toLocalInputValue(booking.starts_at),
      ends_at: toLocalInputValue(booking.ends_at),
      status: "confirmed",
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingBooking(null);
  };

  // ---------- Conflict detection ----------
  const findConflicts = (candidateStartIso, candidateEndIso, staffId, excludeId) => {
    const candStart = new Date(candidateStartIso).getTime();
    const candEnd = candidateEndIso
      ? new Date(candidateEndIso).getTime()
      : candStart + DEFAULT_CONFLICT_DURATION_MIN * 60000;

    return bookings.filter((b) => {
      if (b.id === excludeId) return false;
      if (b.status === "cancelled") return false;
      if (staffId && b.assigned_staff_id !== staffId) return false;
      if (!staffId && b.assigned_staff_id) return false;

      const bStart = new Date(b.starts_at).getTime();
      const bEnd = b.ends_at
        ? new Date(b.ends_at).getTime()
        : bStart + DEFAULT_CONFLICT_DURATION_MIN * 60000;

      return candStart < bEnd && bStart < candEnd;
    });
  };

  const liveConflicts = useMemo(() => {
    if (!form.starts_at) return [];
    const startIso = new Date(form.starts_at).toISOString();
    const endIso = form.ends_at ? new Date(form.ends_at).toISOString() : null;
    return findConflicts(startIso, endIso, form.assigned_staff_id || null, editingBooking?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.starts_at, form.ends_at, form.assigned_staff_id, bookings, editingBooking]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.title.trim()) return setError("Enter a title for the booking.");
    if (!form.starts_at) return setError("Set a start date and time.");
    if (form.ends_at && new Date(form.ends_at) < new Date(form.starts_at)) {
      return setError("End time can't be before the start time.");
    }

    if (liveConflicts.length > 0) {
      const names = liveConflicts.map((c) => `"${c.title}"`).join(", ");
      const proceed = window.confirm(
        `This overlaps with ${names} at the same time. Continue anyway?`
      );
      if (!proceed) return;
    }

    setSaving(true);

    const payload = {
      title: form.title,
      customer_id: form.customer_id || null,
      assigned_staff_id: form.assigned_staff_id || null,
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

  // ---------- Filtering (search / status / customer / staff) ----------
  const filteredBookings = useMemo(() => {
    const q = search.trim().toLowerCase();
    return bookings.filter((b) => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (customerFilter !== "all" && b.customer_id !== customerFilter) return false;
      if (staffFilter !== "all" && b.assigned_staff_id !== staffFilter) return false;
      if (q) {
        const inTitle = b.title?.toLowerCase().includes(q);
        const inCustomer = b.customers?.name?.toLowerCase().includes(q);
        if (!inTitle && !inCustomer) return false;
      }
      return true;
    });
  }, [bookings, search, statusFilter, customerFilter, staffFilter]);

  const agendaBookings = useMemo(() => {
    const now = new Date();
    if (filter === "upcoming") return filteredBookings.filter((b) => new Date(b.starts_at) >= now);
    if (filter === "past") return filteredBookings.filter((b) => new Date(b.starts_at) < now);
    return filteredBookings;
  }, [filteredBookings, filter]);

  const groupedByDate = useMemo(() => {
    const groups = {};
    agendaBookings.forEach((b) => {
      const key = toDateKey(b.starts_at);
      if (!groups[key]) groups[key] = [];
      groups[key].push(b);
    });
    return Object.entries(groups).sort(([a], [b]) =>
      filter === "past" ? b.localeCompare(a) : a.localeCompare(b)
    );
  }, [agendaBookings, filter]);

  const eventsByDay = useMemo(() => {
    const map = {};
    filteredBookings.forEach((b) => {
      const key = toDateKey(b.starts_at);
      if (!map[key]) map[key] = [];
      map[key].push(b);
    });
    Object.values(map).forEach((list) => list.sort((a, c) => new Date(a.starts_at) - new Date(c.starts_at)));
    return map;
  }, [filteredBookings]);

  // ---------- Calendar grids ----------
  const monthGridDays = useMemo(() => {
    const firstOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
    const gridStart = startOfWeekMonday(firstOfMonth);
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(currentDate);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [currentDate]);

  const monthLabel = currentDate.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });
  const weekLabel = `${weekDays[0].toLocaleDateString("en-ZA", { day: "numeric", month: "short" })} – ${weekDays[6].toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}`;

  const goToday = () => {
    const now = new Date();
    setCurrentDate(now);
    setSelectedDay(toDateKey(now));
  };

  const goPrev = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, -1));
    else if (view === "week") setCurrentDate((d) => addDays(d, -7));
  };

  const goNext = () => {
    if (view === "month") setCurrentDate((d) => addMonths(d, 1));
    else if (view === "week") setCurrentDate((d) => addDays(d, 7));
  };

  // ---------- Stats (real "this week", independent of nav) ----------
  const stats = useMemo(() => {
    const now = new Date();
    const weekStart = startOfWeekMonday(now);
    const weekEnd = addDays(weekStart, 7);
    const thisWeek = bookings.filter((b) => {
      const t = new Date(b.starts_at);
      return t >= weekStart && t < weekEnd;
    });
    return {
      thisWeek: thisWeek.length,
      confirmed: bookings.filter((b) => b.status === "confirmed").length,
      cancelled: bookings.filter((b) => b.status === "cancelled").length,
    };
  }, [bookings]);

  // ---------- Bulk selection ----------
  const toggleSelectRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  const bulkCancel = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .in("id", ids);
    if (!updateError) {
      notify(business.id, appUser?.id, `${ids.length} booking${ids.length > 1 ? "s" : ""} cancelled.`);
      clearSelection();
      fetchBookings();
    }
  };

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} booking${ids.length > 1 ? "s" : ""}? This can't be undone.`))
      return;
    const { error: deleteError } = await supabase.from("bookings").delete().in("id", ids);
    if (!deleteError) {
      clearSelection();
      fetchBookings();
    }
  };

  const bulkExport = () => {
    const rows = bookings.filter((b) => selected.has(b.id));
    if (rows.length === 0) return;
    const data = rows.map((b) => ({
      Title: b.title,
      Customer: b.customers?.name || "",
      Staff: b.staff?.full_name || "",
      Status: b.status,
      Starts: new Date(b.starts_at).toLocaleString("en-ZA"),
      Ends: b.ends_at ? new Date(b.ends_at).toLocaleString("en-ZA") : "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Bookings");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `bookings-selection-${stamp}.xlsx`);
  };

  const hasActiveFilters =
    search.trim() || statusFilter !== "all" || customerFilter !== "all" || staffFilter !== "all";

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setCustomerFilter("all");
    setStaffFilter("all");
  };

  // ---------- Shared card renderer ----------
  const renderCard = (b) => {
    const duration = formatDuration(b.starts_at, b.ends_at);
    return (
      <div className="book-card" key={b.id}>
        <input
          type="checkbox"
          className="book-card-check"
          checked={selected.has(b.id)}
          onChange={() => toggleSelectRow(b.id)}
          aria-label={`Select ${b.title}`}
        />
        <div className="book-card-time">
          <span>{formatTime(b.starts_at)}</span>
          {b.ends_at && <span className="book-muted">– {formatTime(b.ends_at)}</span>}
          {duration && <span className="book-duration">{duration}</span>}
        </div>
        <div className="book-card-main">
          <p className="book-card-title">{b.title}</p>
          <p className={b.customers?.name ? "book-card-customer" : "book-card-customer book-muted"}>
            {b.customers?.name || "No customer linked"}
            {b.staff?.full_name && <span className="book-card-staff"> · {b.staff.full_name}</span>}
          </p>
        </div>
        <span className={`book-status book-status--${b.status}`}>{b.status}</span>
        <div className="book-card-actions">
          {b.status === "confirmed" && (
            <button className="book-action-btn" onClick={() => handleCancel(b)}>
              Cancel
            </button>
          )}
          <button className="book-action-btn" onClick={() => openDuplicateModal(b)}>
            Duplicate
          </button>
          <button className="book-action-btn" onClick={() => openEditModal(b)}>
            Edit
          </button>
          <button className="book-action-btn book-action-btn--danger" onClick={() => handleDelete(b)}>
            Delete
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="book-page">
      <GridScanBackground
        lineThickness={1}
        gridScale={0.1}
        scanOpacity={0.4}
        glowIntensity={0.6}
        jitter={0.1}
        scanSoftness={2}
        scanDuration={3.5}
      />

      <AppNav business={business} />

      <div className="book-body">
        <div className="book-header">
          <div>
            <p className="book-eyebrow">Bookings</p>
            <h1 className="book-heading">Your schedule</h1>
          </div>
          <button className="book-add-btn" onClick={() => openAddModal()}>
            + New booking
          </button>
        </div>

        <div className="book-stats">
          <div className="book-stat-card">
            <p className="book-stat-label">This week</p>
            <p className="book-stat-value">{stats.thisWeek}</p>
          </div>
          <div className="book-stat-card">
            <p className="book-stat-label">Confirmed</p>
            <p className="book-stat-value">{stats.confirmed}</p>
          </div>
          <div className="book-stat-card">
            <p className="book-stat-label">Cancelled</p>
            <p className="book-stat-value">{stats.cancelled}</p>
          </div>
        </div>

        <div className="book-toolbar">
          <div className="book-search-wrap">
            <svg className="book-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="book-search-input"
              placeholder="Search by title or customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select className="book-select-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <select className="book-select-sm" value={customerFilter} onChange={(e) => setCustomerFilter(e.target.value)}>
            <option value="all">All customers</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select className="book-select-sm" value={staffFilter} onChange={(e) => setStaffFilter(e.target.value)}>
            <option value="all">All staff</option>
            {staffList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button className="book-clear-filters" onClick={clearAllFilters}>
              Clear filters
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="book-bulkbar">
            <span className="book-bulkbar-count">{selected.size} selected</span>
            <div className="book-bulkbar-actions">
              <button className="book-action-btn" onClick={bulkCancel}>
                Cancel selected
              </button>
              <button className="book-action-btn" onClick={bulkExport}>
                Export selected
              </button>
              <button className="book-action-btn book-action-btn--danger" onClick={bulkDelete}>
                Delete
              </button>
              <button className="book-action-btn" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </div>
        )}

        <div className="book-view-bar">
          <div className="book-view-tabs">
            {["month", "week", "agenda"].map((v) => (
              <button
                key={v}
                className={`book-view-tab ${view === v ? "book-view-tab--active" : ""}`}
                onClick={() => setView(v)}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>

          {view !== "agenda" ? (
            <div className="book-nav-controls">
              <button className="book-nav-btn" onClick={goPrev} aria-label="Previous">
                ‹
              </button>
              <button className="book-today-btn" onClick={goToday}>
                Today
              </button>
              <button className="book-nav-btn" onClick={goNext} aria-label="Next">
                ›
              </button>
              <span className="book-nav-label">{view === "month" ? monthLabel : weekLabel}</span>
            </div>
          ) : (
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
          )}
        </div>

        {loading ? (
          <div className="book-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="book-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : (
          <>
            {view === "month" && (
              <div className="book-month-grid">
                {WEEKDAY_LABELS.map((label) => (
                  <div className="book-month-weekday" key={label}>
                    {label}
                  </div>
                ))}
                {monthGridDays.map((day) => {
                  const key = toDateKey(day);
                  const inMonth = day.getMonth() === currentDate.getMonth();
                  const isToday = isSameDay(day, new Date());
                  const dayEvents = eventsByDay[key] || [];
                  const isSelected = selectedDay === key;
                  return (
                    <button
                      key={key}
                      className={`book-month-cell ${inMonth ? "" : "book-month-cell--outside"} ${
                        isToday ? "book-month-cell--today" : ""
                      } ${isSelected ? "book-month-cell--selected" : ""}`}
                      onClick={() => setSelectedDay(isSelected ? null : key)}
                    >
                      <span className="book-month-daynum">{day.getDate()}</span>
                      <div className="book-month-events">
                        {dayEvents.slice(0, 3).map((ev) => (
                          <span key={ev.id} className={`book-month-pill book-month-pill--${ev.status}`}>
                            {formatTime(ev.starts_at)} {ev.title}
                          </span>
                        ))}
                        {dayEvents.length > 3 && (
                          <span className="book-month-more">+{dayEvents.length - 3} more</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {view === "week" && (
              <div className="book-week-grid">
                {weekDays.map((day) => {
                  const key = toDateKey(day);
                  const isToday = isSameDay(day, new Date());
                  const dayEvents = eventsByDay[key] || [];
                  return (
                    <div className={`book-week-col ${isToday ? "book-week-col--today" : ""}`} key={key}>
                      <button className="book-week-colhead" onClick={() => setSelectedDay(key)}>
                        <span className="book-week-colday">
                          {day.toLocaleDateString("en-ZA", { weekday: "short" })}
                        </span>
                        <span className="book-week-colnum">{day.getDate()}</span>
                      </button>
                      <div className="book-week-events">
                        {dayEvents.length === 0 ? (
                          <p className="book-week-empty">—</p>
                        ) : (
                          dayEvents.map((ev) => (
                            <button
                              key={ev.id}
                              className={`book-week-pill book-week-pill--${ev.status}`}
                              onClick={() => openEditModal(ev)}
                            >
                              <span className="book-week-pilltime">{formatTime(ev.starts_at)}</span>
                              <span className="book-week-pilltitle">{ev.title}</span>
                            </button>
                          ))
                        )}
                      </div>
                      <button className="book-week-addbtn" onClick={() => openAddModal(key)}>
                        +
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {(view === "month" || view === "week") && selectedDay && (
              <div className="book-day-panel">
                <div className="book-day-panel-header">
                  <p className="book-day-heading">{formatDateHeading(selectedDay)}</p>
                  <div className="book-day-panel-actions">
                    <button className="book-action-btn" onClick={() => openAddModal(selectedDay)}>
                      + Add here
                    </button>
                    <button className="book-action-btn" onClick={() => setSelectedDay(null)}>
                      Close
                    </button>
                  </div>
                </div>
                {(eventsByDay[selectedDay] || []).length === 0 ? (
                  <div className="book-empty">No bookings this day.</div>
                ) : (
                  <div className="book-day-list">
                    {(eventsByDay[selectedDay] || []).map((b) => renderCard(b))}
                  </div>
                )}
              </div>
            )}

            {view === "agenda" &&
              (groupedByDate.length === 0 ? (
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
                      <div className="book-day-list">{items.map((b) => renderCard(b))}</div>
                    </div>
                  ))}
                </div>
              ))}
          </>
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

              <div className="book-row-2">
                <div>
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
                </div>
                <div>
                  <label className="book-label">Staff (optional)</label>
                  <select
                    className="book-select"
                    value={form.assigned_staff_id}
                    onChange={(e) => setForm({ ...form, assigned_staff_id: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

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

              {liveConflicts.length > 0 && (
                <p className="book-conflict-warning">
                  Overlaps with {liveConflicts.map((c) => `"${c.title}"`).join(", ")} at this time.
                </p>
              )}

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