import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Leave.css";

const LEAVE_TYPE_OPTIONS = ["annual", "sick", "unpaid", "other"];
const LEAVE_TYPE_LABEL = {
  annual: "Annual",
  sick: "Sick",
  unpaid: "Unpaid",
  other: "Other",
};

const STATUS_OPTIONS = ["pending", "approved", "declined", "cancelled"];
const STATUS_LABEL = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
  cancelled: "Cancelled",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const emptyRequestForm = {
  staff_id: "",
  leave_type: "annual",
  start_date: "",
  end_date: "",
  reason: "",
};

// Theme colors used for the pixel-snow flakes (kept in sync with Leave.css)
const SNOW_COLORS = ["#7c3aed", "#3b82f6", "#14b8a6", "#e7e9ef"];

/**
 * Self-contained animated "pixel snow" background.
 * Pure canvas + React, no external imports or libraries.
 * Blocky, chunky flakes drift diagonally, snapped to a coarse pixel grid,
 * rendered behind all page content (fixed, z-index 0).
 */
function PixelSnowBackground({
  pixelResolution = 200,
  density = 0.3,
  speed = 1.25,
  direction = 125,
  minFlakeSize = 1.25,
  brightness = 1,
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const flakesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pixelSize = 4;

    const dirRad = (direction * Math.PI) / 180;
    const windX = Math.cos(dirRad);
    const windY = Math.sin(dirRad);

    const hexToRgb = (hex) => {
      const bigint = parseInt(hex.replace("#", ""), 16);
      return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
    };

    const initFlakes = () => {
      const area = width * height;
      const baseCount = Math.round((area / 6000) * density * 3);
      const count = Math.max(40, Math.min(baseCount, 260));
      const flakes = [];
      for (let i = 0; i < count; i++) {
        const depth = 0.3 + Math.random() * 0.7;
        flakes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          depth,
          size: Math.max(pixelSize, minFlakeSize * pixelSize * depth * 0.5),
          color: hexToRgb(SNOW_COLORS[Math.floor(Math.random() * SNOW_COLORS.length)]),
          alpha: 0.35 + depth * 0.5,
        });
      }
      flakesRef.current = flakes;
    };

    const resize = () => {
      const rect = canvas.parentElement.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      pixelSize = Math.max(2, Math.round(width / pixelResolution));
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      initFlakes();
    };

    let lastTime = performance.now();

    const draw = (time) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      ctx.clearRect(0, 0, width, height);

      const flakes = flakesRef.current;
      for (let i = 0; i < flakes.length; i++) {
        const f = flakes[i];
        const velocity = speed * 26 * f.depth * dt;
        f.x += windX * velocity;
        f.y += windY * velocity + speed * 8 * f.depth * dt;

        if (f.x > width + f.size) f.x = -f.size;
        if (f.x < -f.size) f.x = width + f.size;
        if (f.y > height + f.size) f.y = -f.size;
        if (f.y < -f.size) f.y = width > 0 ? -f.size : -f.size;

        // Snap to coarse pixel grid for the blocky "PixelSnow" look
        const snappedX = Math.floor(f.x / pixelSize) * pixelSize;
        const snappedY = Math.floor(f.y / pixelSize) * pixelSize;
        const snappedSize = Math.max(pixelSize, Math.round(f.size / pixelSize) * pixelSize);

        const a = f.alpha * brightness;
        ctx.fillStyle = `rgba(${f.color.r}, ${f.color.g}, ${f.color.b}, ${a})`;
        ctx.fillRect(snappedX, snappedY, snappedSize, snappedSize);
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    resize();
    window.addEventListener("resize", resize);
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [pixelResolution, density, speed, direction, minFlakeSize, brightness]);

  return (
    <div className="lv-snow-bg" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}

function toDateOnly(d) {
  return d.toISOString().slice(0, 10);
}

// Inclusive day count between two YYYY-MM-DD strings.
function daysBetween(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  const diff = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
  return diff > 0 ? diff : 0;
}

export default function Leave({ business, appUser }) {
  const [tab, setTab] = useState("requests"); // requests | calendar
  const [mounted, setMounted] = useState(false);

  // ---- staff (for the request form + calendar labels) ----
  const [staff, setStaff] = useState([]);

  // ---- requests state ----
  const [requests, setRequests] = useState([]);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestForm, setRequestForm] = useState(emptyRequestForm);
  const [savingRequest, setSavingRequest] = useState(false);
  const [requestFormError, setRequestFormError] = useState("");
  const [confirmCancelId, setConfirmCancelId] = useState(null);

  const [selectedRequest, setSelectedRequest] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewNote, setReviewNote] = useState("");

  // ---- calendar state ----
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month is 0-indexed
  });
  const [calendarRequests, setCalendarRequests] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(true);

  const [toast, setToast] = useState(null);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  // ---- loaders ----
  const loadStaff = useCallback(async () => {
    const { data, error } = await supabase
      .from("staff")
      .select("id, full_name, employment_status")
      .eq("business_id", business.id)
      .eq("employment_status", "active")
      .order("full_name", { ascending: true });
    if (!error) setStaff(data || []);
  }, [business.id]);

  const loadRequests = useCallback(async () => {
    setRequestsLoading(true);
    const { data, error } = await supabase
      .from("leave_requests")
      .select("*, staff(full_name)")
      .eq("business_id", business.id)
      .order("start_date", { ascending: false });
    if (!error) setRequests(data || []);
    setRequestsLoading(false);
  }, [business.id]);

  useEffect(() => {
    loadStaff();
    loadRequests();
  }, [loadStaff, loadRequests]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ---- calendar loader (approved leave overlapping the visible month) ----
  const loadCalendarRequests = useCallback(async () => {
    setCalendarLoading(true);
    const monthStart = toDateOnly(new Date(calendarMonth.year, calendarMonth.month, 1));
    const monthEnd = toDateOnly(new Date(calendarMonth.year, calendarMonth.month + 1, 0));

    const { data, error } = await supabase
      .from("leave_requests")
      .select("*, staff(full_name)")
      .eq("business_id", business.id)
      .eq("status", "approved")
      .lte("start_date", monthEnd)
      .gte("end_date", monthStart);

    if (!error) setCalendarRequests(data || []);
    setCalendarLoading(false);
  }, [business.id, calendarMonth]);

  useEffect(() => {
    if (tab === "calendar") loadCalendarRequests();
  }, [tab, loadCalendarRequests]);

  function staffName(id) {
    return staff.find((s) => s.id === id)?.full_name || "—";
  }

  // ---- derived: requests ----
  const filteredRequests = useMemo(() => {
    let list = [...requests];
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => (r.staff?.full_name || "").toLowerCase().includes(q));
    }
    return list;
  }, [requests, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const counts = { all: requests.length };
    STATUS_OPTIONS.forEach((s) => {
      counts[s] = requests.filter((r) => r.status === s).length;
    });
    return counts;
  }, [requests]);

  const pendingCount = statusCounts.pending || 0;

  const approvedDaysThisYear = useMemo(() => {
    const currentYear = new Date().getFullYear();
    return requests
      .filter((r) => r.status === "approved" && new Date(r.start_date).getFullYear() === currentYear)
      .reduce((sum, r) => sum + Number(r.days_count || 0), 0);
  }, [requests]);

  // ---- request form ----
  function openAddRequest() {
    setRequestForm({ ...emptyRequestForm, staff_id: staff[0]?.id || "" });
    setRequestFormError("");
    setShowRequestModal(true);
  }

  const requestFormDays = useMemo(
    () => daysBetween(requestForm.start_date, requestForm.end_date),
    [requestForm.start_date, requestForm.end_date]
  );

  async function handleSaveRequest(e) {
    e.preventDefault();

    if (!requestForm.staff_id) {
      setRequestFormError("Choose a staff member.");
      return;
    }
    if (!requestForm.start_date || !requestForm.end_date) {
      setRequestFormError("Start and end date are both required.");
      return;
    }
    if (requestForm.end_date < requestForm.start_date) {
      setRequestFormError("End date can't be before the start date.");
      return;
    }

    setSavingRequest(true);
    setRequestFormError("");

    const { error } = await supabase.from("leave_requests").insert({
      business_id: business.id,
      staff_id: requestForm.staff_id,
      leave_type: requestForm.leave_type,
      start_date: requestForm.start_date,
      end_date: requestForm.end_date,
      days_count: requestFormDays,
      status: "pending",
      reason: requestForm.reason.trim() || null,
    });

    setSavingRequest(false);

    if (error) {
      setRequestFormError(error.message);
      return;
    }

    setShowRequestModal(false);
    showToast("Leave request submitted");
    loadRequests();
  }

  async function handleCancelRequest(id) {
    const { error } = await supabase
      .from("leave_requests")
      .update({ status: "cancelled" })
      .eq("id", id);
    setConfirmCancelId(null);
    if (!error) {
      showToast("Leave request cancelled");
      loadRequests();
      if (selectedRequest?.id === id) setSelectedRequest(null);
    }
  }

  // ---- review (approve / decline) ----
  function openRequestDetail(request) {
    setSelectedRequest(request);
    setReviewNote("");
  }

  async function handleReview(newStatus) {
    if (!selectedRequest) return;
    setReviewing(true);

    const { error } = await supabase
      .from("leave_requests")
      .update({
        status: newStatus,
        reviewed_by: appUser?.id || null,
        reviewed_at: new Date().toISOString(),
        review_note: reviewNote.trim() || null,
      })
      .eq("id", selectedRequest.id);

    setReviewing(false);

    if (!error) {
      showToast(newStatus === "approved" ? "Leave approved" : "Leave declined");
      setSelectedRequest({ ...selectedRequest, status: newStatus });
      loadRequests();
    }
  }

  // ---- calendar helpers ----
  function goToPrevMonth() {
    setCalendarMonth((prev) => {
      const month = prev.month === 0 ? 11 : prev.month - 1;
      const year = prev.month === 0 ? prev.year - 1 : prev.year;
      return { year, month };
    });
  }

  function goToNextMonth() {
    setCalendarMonth((prev) => {
      const month = prev.month === 11 ? 0 : prev.month + 1;
      const year = prev.month === 11 ? prev.year + 1 : prev.year;
      return { year, month };
    });
  }

  function goToToday() {
    const now = new Date();
    setCalendarMonth({ year: now.getFullYear(), month: now.getMonth() });
  }

  // Builds a 6x7 grid of dates (including leading/trailing days from
  // adjacent months) for the currently viewed month.
  const calendarGrid = useMemo(() => {
    const firstOfMonth = new Date(calendarMonth.year, calendarMonth.month, 1);
    const startOffset = firstOfMonth.getDay(); // 0 = Sunday
    const gridStart = new Date(calendarMonth.year, calendarMonth.month, 1 - startOffset);

    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    return days;
  }, [calendarMonth]);

  // Approved staff-off entries per YYYY-MM-DD, for quick lookup while rendering the grid.
  const leaveByDate = useMemo(() => {
    const map = {};
    calendarRequests.forEach((r) => {
      const start = new Date(r.start_date + "T00:00:00");
      const end = new Date(r.end_date + "T00:00:00");
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const key = toDateOnly(d);
        if (!map[key]) map[key] = [];
        map[key].push(r);
      }
    });
    return map;
  }, [calendarRequests]);

  const todayStr = toDateOnly(new Date());

  return (
    <div className="lv-page">
      <PixelSnowBackground
        pixelResolution={200}
        density={0.3}
        speed={1.25}
        direction={125}
        minFlakeSize={1.25}
        brightness={1}
      />

      <div className="lv-body">
        <div className={`lv-header ${mounted ? "lv-in" : ""}`}>
          <div>
            <p className="lv-eyebrow">HR</p>
            <h1 className="lv-heading">Leave Management</h1>
          </div>
          <div className="lv-header-actions">
            <button className="lv-add-btn" onClick={openAddRequest} disabled={staff.length === 0}>
              + Request leave
            </button>
          </div>
        </div>

        <div className={`lv-stats ${mounted ? "lv-in" : ""}`}>
          <div className="lv-stat-card">
            <p className="lv-stat-label">Active staff</p>
            <p className="lv-stat-value">{staff.length}</p>
          </div>
          <div className="lv-stat-card">
            <p className="lv-stat-label">Pending requests</p>
            <p className="lv-stat-value">{pendingCount}</p>
          </div>
          <div className="lv-stat-card">
            <p className="lv-stat-label">Approved days (this year)</p>
            <p className="lv-stat-value">{approvedDaysThisYear}</p>
          </div>
        </div>

        <div className={`lv-tabs ${mounted ? "lv-in" : ""}`}>
          <button
            className={`lv-tab-btn ${tab === "requests" ? "lv-tab-btn--active" : ""}`}
            onClick={() => setTab("requests")}
          >
            Requests
          </button>
          <button
            className={`lv-tab-btn ${tab === "calendar" ? "lv-tab-btn--active" : ""}`}
            onClick={() => setTab("calendar")}
          >
            Calendar
          </button>
        </div>

        {tab === "requests" ? (
          <>
            {!requestsLoading && requests.length === 0 ? (
              <div className="lv-empty">
                {staff.length === 0 ? (
                  <>Add a staff member first, then submit their first leave request.</>
                ) : (
                  <>
                    No leave requests yet.{" "}
                    <button className="lv-inline-link" onClick={openAddRequest}>
                      Request leave
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="lv-toolbar">
                  <div className="lv-filters">
                    <button
                      className={`lv-filter-btn ${statusFilter === "all" ? "lv-filter-btn--active" : ""}`}
                      onClick={() => setStatusFilter("all")}
                    >
                      All <span className="lv-filter-count">{statusCounts.all}</span>
                    </button>
                    {STATUS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        className={`lv-filter-btn ${statusFilter === s ? "lv-filter-btn--active" : ""}`}
                        onClick={() => setStatusFilter(s)}
                      >
                        {STATUS_LABEL[s]} <span className="lv-filter-count">{statusCounts[s]}</span>
                      </button>
                    ))}
                  </div>

                  <div className="lv-toolbar-right">
                    <div className="lv-search">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        placeholder="Search staff..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="lv-table-wrap">
                  {requestsLoading ? (
                    <div className="lv-skeleton">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="lv-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                  ) : (
                    <table className="lv-table">
                      <thead>
                        <tr>
                          <th>Staff</th>
                          <th>Type</th>
                          <th>Dates</th>
                          <th>Days</th>
                          <th>Status</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRequests.map((r, i) => (
                          <tr
                            key={r.id}
                            className="lv-row"
                            style={{ animationDelay: `${i * 0.03}s` }}
                            onClick={() => openRequestDetail(r)}
                          >
                            <td className="lv-name-cell">{r.staff?.full_name || staffName(r.staff_id)}</td>
                            <td className="lv-muted">{LEAVE_TYPE_LABEL[r.leave_type] || r.leave_type}</td>
                            <td className="lv-muted">
                              {r.start_date} → {r.end_date}
                            </td>
                            <td className="lv-muted">{r.days_count}</td>
                            <td>
                              <span className={`lv-status lv-status--${r.status}`}>{STATUS_LABEL[r.status]}</span>
                            </td>
                            <td className="lv-actions-cell" onClick={(e) => e.stopPropagation()}>
                              {["pending", "approved"].includes(r.status) &&
                                (confirmCancelId === r.id ? (
                                  <div className="lv-confirm-row">
                                    Cancel?
                                    <button className="lv-confirm-yes" onClick={() => handleCancelRequest(r.id)}>
                                      Yes
                                    </button>
                                    <button className="lv-confirm-no" onClick={() => setConfirmCancelId(null)}>
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    className="lv-action-btn lv-action-btn--danger"
                                    onClick={() => setConfirmCancelId(r.id)}
                                  >
                                    Cancel
                                  </button>
                                ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="lv-calendar-wrap">
            <div className="lv-calendar-toolbar">
              <div className="lv-calendar-nav">
                <button className="lv-cal-nav-btn" onClick={goToPrevMonth} aria-label="Previous month">
                  ‹
                </button>
                <span className="lv-calendar-title">
                  {MONTH_NAMES[calendarMonth.month]} {calendarMonth.year}
                </span>
                <button className="lv-cal-nav-btn" onClick={goToNextMonth} aria-label="Next month">
                  ›
                </button>
              </div>
              <button className="lv-today-btn" onClick={goToToday}>
                Today
              </button>
            </div>

            {calendarLoading ? (
              <div className="lv-skeleton">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="lv-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                ))}
              </div>
            ) : (
              <>
                <div className="lv-calendar-grid lv-calendar-grid--labels">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d} className="lv-calendar-day-label">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="lv-calendar-grid">
                  {calendarGrid.map((d, i) => {
                    const key = toDateOnly(d);
                    const inMonth = d.getMonth() === calendarMonth.month;
                    const isToday = key === todayStr;
                    const entries = leaveByDate[key] || [];
                    return (
                      <div
                        key={i}
                        className={`lv-calendar-cell ${inMonth ? "" : "lv-calendar-cell--out"} ${
                          isToday ? "lv-calendar-cell--today" : ""
                        }`}
                      >
                        <span className="lv-calendar-date">{d.getDate()}</span>
                        {entries.length > 0 && (
                          <div className="lv-calendar-entries">
                            {entries.slice(0, 3).map((r) => (
                              <span key={r.id} className="lv-calendar-chip" title={r.staff?.full_name}>
                                {(r.staff?.full_name || "—").split(" ")[0]}
                              </span>
                            ))}
                            {entries.length > 3 && (
                              <span className="lv-calendar-chip lv-calendar-chip--more">
                                +{entries.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* New leave request modal */}
      {showRequestModal && (
        <div className="lv-modal-overlay" onClick={() => setShowRequestModal(false)}>
          <div className="lv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Request leave</h2>
            <form onSubmit={handleSaveRequest}>
              <label className="lv-label">Staff member</label>
              <select
                className="lv-select"
                value={requestForm.staff_id}
                onChange={(e) => setRequestForm({ ...requestForm, staff_id: e.target.value })}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </select>

              <label className="lv-label">Leave type</label>
              <select
                className="lv-select"
                value={requestForm.leave_type}
                onChange={(e) => setRequestForm({ ...requestForm, leave_type: e.target.value })}
              >
                {LEAVE_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>
                    {LEAVE_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>

              <div className="lv-row-2">
                <div>
                  <label className="lv-label">Start date</label>
                  <input
                    type="date"
                    className="lv-input"
                    value={requestForm.start_date}
                    onChange={(e) => setRequestForm({ ...requestForm, start_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="lv-label">End date</label>
                  <input
                    type="date"
                    className="lv-input"
                    value={requestForm.end_date}
                    onChange={(e) => setRequestForm({ ...requestForm, end_date: e.target.value })}
                  />
                </div>
              </div>

              <label className="lv-label">Reason (optional)</label>
              <textarea
                className="lv-textarea"
                rows={2}
                value={requestForm.reason}
                onChange={(e) => setRequestForm({ ...requestForm, reason: e.target.value })}
              />

              <div className="lv-days-preview">
                {requestFormDays > 0
                  ? `${requestFormDays} day${requestFormDays === 1 ? "" : "s"}`
                  : "Choose a date range"}
              </div>

              {requestFormError && <p className="lv-error">{requestFormError}</p>}

              <div className="lv-modal-actions">
                <button type="button" className="lv-cancel-btn" onClick={() => setShowRequestModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="lv-add-btn" disabled={savingRequest}>
                  {savingRequest ? <span className="lv-spinner" /> : "Submit request"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Request detail / review drawer */}
      {selectedRequest && (
        <div className="lv-drawer-overlay" onClick={() => setSelectedRequest(null)}>
          <div className="lv-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="lv-drawer-close" onClick={() => setSelectedRequest(null)}>
              ×
            </button>
            <h2>{selectedRequest.staff?.full_name || staffName(selectedRequest.staff_id)}</h2>
            <p className="lv-drawer-sub">
              {LEAVE_TYPE_LABEL[selectedRequest.leave_type] || selectedRequest.leave_type} leave
            </p>

            <div className="lv-meta-grid">
              <div className="lv-meta-item">
                <p className="lv-meta-label">Status</p>
                <p className="lv-meta-value">{STATUS_LABEL[selectedRequest.status]}</p>
              </div>
              <div className="lv-meta-item">
                <p className="lv-meta-label">Days</p>
                <p className="lv-meta-value">{selectedRequest.days_count}</p>
              </div>
              <div className="lv-meta-item">
                <p className="lv-meta-label">Start</p>
                <p className="lv-meta-value">{selectedRequest.start_date}</p>
              </div>
              <div className="lv-meta-item">
                <p className="lv-meta-label">End</p>
                <p className="lv-meta-value">{selectedRequest.end_date}</p>
              </div>
            </div>

            {selectedRequest.reason && (
              <>
                <div className="lv-section-title">Reason</div>
                <p className="lv-reason-text">{selectedRequest.reason}</p>
              </>
            )}

            {selectedRequest.status !== "pending" && selectedRequest.review_note && (
              <>
                <div className="lv-section-title">Review note</div>
                <p className="lv-reason-text">{selectedRequest.review_note}</p>
              </>
            )}

            {selectedRequest.status === "pending" && (
              <>
                <div className="lv-section-title">Review</div>
                <textarea
                  className="lv-textarea"
                  rows={2}
                  placeholder="Optional note (visible to the staff member)"
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                />
                <div className="lv-drawer-actions">
                  <button
                    className="lv-cancel-btn"
                    onClick={() => handleReview("declined")}
                    disabled={reviewing}
                  >
                    {reviewing ? <span className="lv-spinner" /> : "Decline"}
                  </button>
                  <button
                    className="lv-add-btn"
                    onClick={() => handleReview("approved")}
                    disabled={reviewing}
                  >
                    {reviewing ? <span className="lv-spinner" /> : "Approve"}
                  </button>
                </div>
              </>
            )}

            {["pending", "approved"].includes(selectedRequest.status) && (
              <div className="lv-drawer-actions">
                <button
                  className="lv-action-btn lv-action-btn--danger lv-cancel-full-width"
                  onClick={() => handleCancelRequest(selectedRequest.id)}
                >
                  Cancel request
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="lv-toast lv-toast--success">{toast}</div>}
    </div>
  );
}