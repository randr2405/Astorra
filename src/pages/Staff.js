import { useState, useEffect, useCallback, useMemo } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Staff.css";

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "on_leave", label: "On leave" },
  { value: "terminated", label: "Terminated" },
];

const EMPLOYMENT_TYPE_OPTIONS = [
  { value: "salaried", label: "Salaried" },
  { value: "hourly", label: "Hourly" },
];

const PAY_FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "weekly", label: "Weekly" },
];

const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));
const EMPLOYMENT_TYPE_LABEL = Object.fromEntries(EMPLOYMENT_TYPE_OPTIONS.map((s) => [s.value, s.label]));
const UNASSIGNED = "Unassigned";

function formatTenure(startDate) {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return null;
  const now = new Date();
  let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  if (months < 0) return null;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (years === 0 && remMonths === 0) return "New";
  const parts = [];
  if (years > 0) parts.push(`${years} yr`);
  if (remMonths > 0) parts.push(`${remMonths} mo`);
  return parts.join(" ");
}

function isNewHire(startDate) {
  if (!startDate) return false;
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return false;
  const now = new Date();
  return start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth();
}

function formatPayRate(member) {
  if (member.pay_rate === null || member.pay_rate === undefined || member.pay_rate === "") return null;
  const amount = `R${Number(member.pay_rate).toFixed(2)}`;
  return member.employment_type === "hourly" ? `${amount}/hr` : `${amount} / ${member.pay_frequency || "monthly"}`;
}

function Staff({ business, appUser }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [form, setForm] = useState({
    full_name: "",
    position: "",
    department: "",
    employee_number: "",
    employment_status: "active",
    email: "",
    phone: "",
    start_date: "",
    emergency_contact_name: "",
    emergency_contact_phone: "",
    employment_type: "salaried",
    pay_rate: "",
    pay_frequency: "monthly",
    tax_number: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Search / filter / sort
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Bulk selection
  const [selected, setSelected] = useState(() => new Set());

  const fetchStaff = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setStaff(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  const openAddModal = () => {
    setEditingStaff(null);
    setForm({
      full_name: "",
      position: "",
      department: "",
      employee_number: "",
      employment_status: "active",
      email: "",
      phone: "",
      start_date: "",
      emergency_contact_name: "",
      emergency_contact_phone: "",
      employment_type: "salaried",
      pay_rate: "",
      pay_frequency: "monthly",
      tax_number: "",
    });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (member) => {
    setEditingStaff(member);
    setForm({
      full_name: member.full_name || "",
      position: member.position || "",
      department: member.department || "",
      employee_number: member.employee_number || "",
      employment_status: member.employment_status || "active",
      email: member.email || "",
      phone: member.phone || "",
      start_date: member.start_date || "",
      emergency_contact_name: member.emergency_contact_name || "",
      emergency_contact_phone: member.emergency_contact_phone || "",
      employment_type: member.employment_type || "salaried",
      pay_rate: member.pay_rate === null || member.pay_rate === undefined ? "" : String(member.pay_rate),
      pay_frequency: member.pay_frequency || "monthly",
      tax_number: member.tax_number || "",
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingStaff(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.full_name.trim()) return setError("Enter a full name.");
    if (form.pay_rate !== "" && (isNaN(Number(form.pay_rate)) || Number(form.pay_rate) < 0)) {
      return setError("Pay rate must be a positive number.");
    }

    setSaving(true);

    const payload = {
      full_name: form.full_name,
      position: form.position || null,
      department: form.department.trim() || null,
      employee_number: form.employee_number.trim() || null,
      employment_status: form.employment_status || "active",
      email: form.email || null,
      phone: form.phone || null,
      start_date: form.start_date || null,
      emergency_contact_name: form.emergency_contact_name.trim() || null,
      emergency_contact_phone: form.emergency_contact_phone.trim() || null,
      employment_type: form.employment_type || "salaried",
      pay_rate: form.pay_rate === "" ? null : Number(form.pay_rate),
      pay_frequency: form.pay_frequency || "monthly",
      tax_number: form.tax_number.trim() || null,
    };

    if (editingStaff) {
      const { error: updateError } = await supabase
        .from("staff")
        .update(payload)
        .eq("id", editingStaff.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }

      if (editingStaff.employment_status !== payload.employment_status) {
        notify(
          business.id,
          appUser?.id,
          `${form.full_name}'s status changed to "${STATUS_LABEL[payload.employment_status]}".`
        );
      }
    } else {
      const { error: insertError } = await supabase.from("staff").insert({
        business_id: business.id,
        ...payload,
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }

      notify(business.id, appUser?.id, `${form.full_name} was added to the team.`);
    }

    setSaving(false);
    closeModal();
    fetchStaff();
  };

  const handleDelete = async (member) => {
    if (!window.confirm(`Remove ${member.full_name}? This can't be undone.`)) return;

    const { error: deleteError } = await supabase.from("staff").delete().eq("id", member.id);

    if (!deleteError) fetchStaff();
  };

  // ---------- Derived: positions, filtering, sorting ----------
  const positions = useMemo(() => {
    const set = new Set();
    staff.forEach((m) => set.add(m.position?.trim() || UNASSIGNED));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [staff]);

  const filteredStaff = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = staff.filter((m) => {
      const memberPosition = m.position?.trim() || UNASSIGNED;
      const memberStatus = m.employment_status || "active";

      if (positionFilter !== "all" && memberPosition !== positionFilter) return false;
      if (statusFilter !== "all" && memberStatus !== statusFilter) return false;
      if (q) {
        const inName = m.full_name?.toLowerCase().includes(q);
        const inEmail = m.email?.toLowerCase().includes(q);
        const inPhone = m.phone?.toLowerCase().includes(q);
        if (!inName && !inEmail && !inPhone) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "name":
          av = (a.full_name || "").toLowerCase();
          bv = (b.full_name || "").toLowerCase();
          break;
        case "position":
          av = (a.position || UNASSIGNED).toLowerCase();
          bv = (b.position || UNASSIGNED).toLowerCase();
          break;
        case "start_date":
          av = a.start_date || "";
          bv = b.start_date || "";
          break;
        default:
          av = a.created_at;
          bv = b.created_at;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return result;
  }, [staff, search, positionFilter, statusFilter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // ---------- Stats ----------
  const stats = useMemo(() => {
    const total = staff.length;
    const active = staff.filter((m) => (m.employment_status || "active") === "active").length;
    const newHires = staff.filter((m) => isNewHire(m.start_date)).length;
    return { total, active, newHires };
  }, [staff]);

  // ---------- Bulk selection ----------
  const allVisibleSelected =
    filteredStaff.length > 0 && filteredStaff.every((m) => selected.has(m.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredStaff.forEach((m) => next.delete(m.id));
        return next;
      }
      const next = new Set(prev);
      filteredStaff.forEach((m) => next.add(m.id));
      return next;
    });
  };

  const toggleSelectRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !window.confirm(`Remove ${ids.length} staff member${ids.length > 1 ? "s" : ""}? This can't be undone.`)
    )
      return;

    const { error: deleteError } = await supabase.from("staff").delete().in("id", ids);
    if (!deleteError) {
      clearSelection();
      fetchStaff();
    }
  };

  const bulkSetStatus = async (status) => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;

    const { error: updateError } = await supabase
      .from("staff")
      .update({ employment_status: status })
      .in("id", ids);

    if (!updateError) {
      notify(
        business.id,
        appUser?.id,
        `${ids.length} staff member${ids.length > 1 ? "s" : ""} set to "${STATUS_LABEL[status]}".`
      );
      clearSelection();
      fetchStaff();
    }
  };

  const exportRows = (rows, filenamePrefix) => {
    const data = rows.map((m) => ({
      "Full name": m.full_name,
      "Employee #": m.employee_number || "",
      Position: m.position || "",
      Department: m.department || "",
      Status: STATUS_LABEL[m.employment_status || "active"],
      Email: m.email || "",
      Phone: m.phone || "",
      "Start date": m.start_date || "",
      "Emergency contact": m.emergency_contact_name || "",
      "Emergency phone": m.emergency_contact_phone || "",
      "Employment type": EMPLOYMENT_TYPE_LABEL[m.employment_type || "salaried"],
      "Pay rate": m.pay_rate ?? "",
      "Pay frequency": m.pay_frequency || "",
      "Tax number": m.tax_number || "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Staff");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `${filenamePrefix}-${stamp}.xlsx`);
  };

  const bulkExport = () => {
    const rows = staff.filter((m) => selected.has(m.id));
    if (rows.length === 0) return;
    exportRows(rows, "staff-selection");
  };

  const exportAll = () => {
    if (filteredStaff.length === 0) return;
    exportRows(filteredStaff, "staff");
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return null;
    return <span className={`staff-sort-arrow ${sortDir}`}>▲</span>;
  };

  const hasActiveFilters = search.trim() || positionFilter !== "all" || statusFilter !== "all";

  return (
    <div className="staff-page">
      <AppNav business={business} />

      <div className="staff-body">
        <div className="staff-header">
          <div>
            <p className="staff-eyebrow">Staff / HR</p>
            <h1 className="staff-heading">Your team</h1>
          </div>
          <div className="staff-header-actions">
            <button className="staff-secondary-btn" onClick={exportAll} disabled={filteredStaff.length === 0}>
              Export
            </button>
            <button className="staff-add-btn" onClick={openAddModal}>
              + Add staff member
            </button>
          </div>
        </div>

        <div className="staff-stats">
          <div className="staff-stat-card">
            <p className="staff-stat-label">Headcount</p>
            <p className="staff-stat-value">{stats.total}</p>
          </div>
          <div className="staff-stat-card">
            <p className="staff-stat-label">Active</p>
            <p className="staff-stat-value">{stats.active}</p>
          </div>
          <div className="staff-stat-card">
            <p className="staff-stat-label">New this month</p>
            <p className="staff-stat-value">{stats.newHires}</p>
          </div>
        </div>

        <div className="staff-toolbar">
          <div className="staff-search-wrap">
            <svg className="staff-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="staff-search-input"
              placeholder="Search by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="staff-select"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
          >
            <option value="all">All positions</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            className="staff-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {hasActiveFilters && (
            <button
              className="staff-clear-filters"
              onClick={() => {
                setSearch("");
                setPositionFilter("all");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="staff-bulkbar">
            <span className="staff-bulkbar-count">{selected.size} selected</span>
            <div className="staff-bulkbar-actions">
              {STATUS_OPTIONS.map((s) => (
                <button key={s.value} className="staff-action-btn" onClick={() => bulkSetStatus(s.value)}>
                  Set {s.label}
                </button>
              ))}
              <button className="staff-action-btn" onClick={bulkExport}>
                Export selected
              </button>
              <button className="staff-action-btn staff-action-btn--danger" onClick={bulkDelete}>
                Delete
              </button>
              <button className="staff-action-btn" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="staff-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="staff-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : staff.length === 0 ? (
          <div className="staff-empty">
            <p>No staff records yet.</p>
            <p className="staff-empty-sub">Add your first team member to get started.</p>
          </div>
        ) : filteredStaff.length === 0 ? (
          <div className="staff-empty">
            <p>No staff match your filters.</p>
            <button
              className="staff-clear-filters"
              onClick={() => {
                setSearch("");
                setPositionFilter("all");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th className="staff-th-check">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="staff-th-sortable" onClick={() => toggleSort("name")}>
                    Name {sortIndicator("name")}
                  </th>
                  <th className="staff-th-sortable" onClick={() => toggleSort("position")}>
                    Position {sortIndicator("position")}
                  </th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Pay rate</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th className="staff-th-sortable" onClick={() => toggleSort("start_date")}>
                    Start date {sortIndicator("start_date")}
                  </th>
                  <th>Tenure</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredStaff.map((m, idx) => {
                  const status = m.employment_status || "active";
                  const tenure = formatTenure(m.start_date);
                  const payRate = formatPayRate(m);
                  return (
                    <tr
                      key={m.id}
                      className="staff-row"
                      style={{ animationDelay: `${Math.min(idx, 12) * 0.03}s` }}
                    >
                      <td className="staff-th-check">
                        <input
                          type="checkbox"
                          checked={selected.has(m.id)}
                          onChange={() => toggleSelectRow(m.id)}
                          aria-label={`Select ${m.full_name}`}
                        />
                      </td>
                      <td className="staff-name-cell">
                        {m.full_name}
                        {m.employee_number && (
                          <span className="staff-emp-number"> #{m.employee_number}</span>
                        )}
                      </td>
                      <td className={m.position ? "" : "staff-muted"}>{m.position || "—"}</td>
                      <td className={m.department ? "" : "staff-muted"}>{m.department || "—"}</td>
                      <td>
                        <span className={`staff-status-pill staff-status-pill--${status}`}>
                          {STATUS_LABEL[status]}
                        </span>
                      </td>
                      <td className={payRate ? "" : "staff-muted"}>{payRate || "Not set"}</td>
                      <td className={m.email ? "" : "staff-muted"}>
                        {m.email ? (
                          <a className="staff-link" href={`mailto:${m.email}`}>
                            {m.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={m.phone ? "" : "staff-muted"}>
                        {m.phone ? (
                          <a className="staff-link" href={`tel:${m.phone}`}>
                            {m.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={m.start_date ? "" : "staff-muted"}>{m.start_date || "—"}</td>
                      <td className={tenure ? "" : "staff-muted"}>{tenure || "—"}</td>
                      <td>
                        <div className="staff-actions-cell">
                          <button className="staff-action-btn" onClick={() => openEditModal(m)}>
                            Edit
                          </button>
                          <button
                            className="staff-action-btn staff-action-btn--danger"
                            onClick={() => handleDelete(m)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="staff-modal-overlay" onClick={closeModal}>
          <div className="staff-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingStaff ? "Edit staff member" : "Add staff member"}</h2>
            <form onSubmit={handleSave}>
              <label className="staff-label">Full name</label>
              <input
                className="staff-input"
                placeholder="Full name"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
              />

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Position</label>
                  <input
                    className="staff-input"
                    placeholder="e.g. Machine operator"
                    value={form.position}
                    onChange={(e) => setForm({ ...form, position: e.target.value })}
                  />
                </div>
                <div>
                  <label className="staff-label">Department</label>
                  <input
                    className="staff-input"
                    placeholder="e.g. Dispatch"
                    value={form.department}
                    onChange={(e) => setForm({ ...form, department: e.target.value })}
                    list="staff-department-options"
                  />
                  <datalist id="staff-department-options">
                    {Array.from(new Set(staff.map((m) => m.department?.trim()).filter(Boolean))).map(
                      (d) => (
                        <option key={d} value={d} />
                      )
                    )}
                  </datalist>
                </div>
              </div>

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Employee #</label>
                  <input
                    className="staff-input"
                    placeholder="Optional"
                    value={form.employee_number}
                    onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
                  />
                </div>
                <div>
                  <label className="staff-label">Status</label>
                  <select
                    className="staff-input staff-input--select"
                    value={form.employment_status}
                    onChange={(e) => setForm({ ...form, employment_status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="staff-label">Email</label>
              <input
                className="staff-input"
                type="email"
                placeholder="staff@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Phone</label>
                  <input
                    className="staff-input"
                    placeholder="081 234 5678"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="staff-label">Start date</label>
                  <input
                    className="staff-input"
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  />
                </div>
              </div>

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Emergency contact</label>
                  <input
                    className="staff-input"
                    placeholder="Name"
                    value={form.emergency_contact_name}
                    onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="staff-label">Emergency phone</label>
                  <input
                    className="staff-input"
                    placeholder="081 234 5678"
                    value={form.emergency_contact_phone}
                    onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })}
                  />
                </div>
              </div>

              <div className="staff-section-divider">
                <span>Payroll</span>
              </div>
              <p className="staff-section-hint">
                Set a pay rate to include this person in Payroll pay runs. Leave blank if they
                aren't paid through Payroll.
              </p>

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Employment type</label>
                  <select
                    className="staff-input staff-input--select"
                    value={form.employment_type}
                    onChange={(e) => setForm({ ...form, employment_type: e.target.value })}
                  >
                    {EMPLOYMENT_TYPE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="staff-label">
                    Pay rate {form.employment_type === "hourly" ? "(per hour)" : `(per ${form.pay_frequency})`}
                  </label>
                  <input
                    className="staff-input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 12500.00"
                    value={form.pay_rate}
                    onChange={(e) => setForm({ ...form, pay_rate: e.target.value })}
                  />
                </div>
              </div>

              <div className="staff-input-row">
                <div>
                  <label className="staff-label">Pay frequency</label>
                  <select
                    className="staff-input staff-input--select"
                    value={form.pay_frequency}
                    onChange={(e) => setForm({ ...form, pay_frequency: e.target.value })}
                    disabled={form.employment_type === "hourly"}
                  >
                    {PAY_FREQUENCY_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="staff-label">Tax number</label>
                  <input
                    className="staff-input"
                    placeholder="SARS income tax ref (optional)"
                    value={form.tax_number}
                    onChange={(e) => setForm({ ...form, tax_number: e.target.value })}
                  />
                </div>
              </div>

              {error && <p className="staff-error">{error}</p>}

              <div className="staff-modal-actions">
                <button type="button" className="staff-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="staff-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingStaff ? "Save changes" : "Add staff member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Staff;