import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Assets.css";

const STATUS_OPTIONS = ["in_use", "in_storage", "maintenance", "retired"];
const STATUS_LABEL = {
  in_use: "In use",
  in_storage: "In storage",
  maintenance: "Maintenance",
  retired: "Retired",
};

const emptyForm = {
  name: "",
  category: "",
  serial_number: "",
  status: "in_use",
  assigned_staff_id: "",
  location: "",
  purchase_date: "",
  purchase_cost: "",
  next_maintenance_due: "",
  notes: "",
};

export default function Assets({ business }) {
  const [assets, setAssets] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");

  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [selectedAsset, setSelectedAsset] = useState(null);
  const [maintenanceLog, setMaintenanceLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [newLogEntry, setNewLogEntry] = useState({ description: "", cost: "", performed_at: "" });
  const [savingLog, setSavingLog] = useState(false);

  const [toast, setToast] = useState(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!error) setAssets(data || []);
    setLoading(false);
  }, [business.id]);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase
      .from("staff")
      .select("id, full_name")
      .eq("business_id", business.id)
      .order("full_name", { ascending: true });
    setStaffList(data || []);
  }, [business.id]);

  useEffect(() => {
    loadAssets();
    loadStaff();
  }, [loadAssets, loadStaff]);

  useEffect(() => {
    setMounted(true);
  }, []);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  function staffName(id) {
    return staffList.find((s) => s.id === id)?.full_name || "—";
  }

  function isOverdue(asset) {
    return (
      asset.next_maintenance_due &&
      asset.status !== "retired" &&
      new Date(asset.next_maintenance_due) < new Date(new Date().toDateString())
    );
  }

  const filteredAssets = useMemo(() => {
    let list = [...assets];

    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.category || "").toLowerCase().includes(q) ||
          (a.serial_number || "").toLowerCase().includes(q) ||
          (a.location || "").toLowerCase().includes(q)
      );
    }

    switch (sortBy) {
      case "name_asc":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        list.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "maintenance_due":
        list.sort((a, b) => {
          if (!a.next_maintenance_due) return 1;
          if (!b.next_maintenance_due) return -1;
          return new Date(a.next_maintenance_due) - new Date(b.next_maintenance_due);
        });
        break;
      case "newest":
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
      default:
        break;
    }

    return list;
  }, [assets, search, statusFilter, sortBy]);

  const statusCounts = useMemo(() => {
    const counts = { all: assets.length };
    STATUS_OPTIONS.forEach((s) => {
      counts[s] = assets.filter((a) => a.status === s).length;
    });
    return counts;
  }, [assets]);

  function openAddModal() {
    setEditingAsset(null);
    setForm(emptyForm);
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(asset) {
    setEditingAsset(asset);
    setForm({
      name: asset.name || "",
      category: asset.category || "",
      serial_number: asset.serial_number || "",
      status: asset.status || "in_use",
      assigned_staff_id: asset.assigned_staff_id || "",
      location: asset.location || "",
      purchase_date: asset.purchase_date || "",
      purchase_cost: asset.purchase_cost ?? "",
      next_maintenance_due: asset.next_maintenance_due || "",
      notes: asset.notes || "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Asset name is required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload = {
      business_id: business.id,
      name: form.name.trim(),
      category: form.category.trim() || null,
      serial_number: form.serial_number.trim() || null,
      status: form.status,
      assigned_staff_id: form.assigned_staff_id || null,
      location: form.location.trim() || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
      next_maintenance_due: form.next_maintenance_due || null,
      notes: form.notes.trim() || null,
    };

    let error;
    if (editingAsset) {
      ({ error } = await supabase.from("assets").update(payload).eq("id", editingAsset.id));
    } else {
      ({ error } = await supabase.from("assets").insert(payload));
    }

    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setShowModal(false);
    showToast(editingAsset ? "Asset updated" : "Asset added");
    loadAssets();
  }

  async function handleDelete(id) {
    const { error } = await supabase.from("assets").delete().eq("id", id);
    setConfirmDeleteId(null);
    if (!error) {
      showToast("Asset removed");
      loadAssets();
      if (selectedAsset?.id === id) setSelectedAsset(null);
    }
  }

  async function openDetail(asset) {
    setSelectedAsset(asset);
    setNewLogEntry({ description: "", cost: "", performed_at: "" });
    setLogLoading(true);
    const { data } = await supabase
      .from("asset_maintenance_log")
      .select("*")
      .eq("asset_id", asset.id)
      .order("performed_at", { ascending: false });
    setMaintenanceLog(data || []);
    setLogLoading(false);
  }

  async function handleAddLogEntry(e) {
    e.preventDefault();
    if (!newLogEntry.description.trim()) return;

    setSavingLog(true);
    const { error } = await supabase.from("asset_maintenance_log").insert({
      asset_id: selectedAsset.id,
      description: newLogEntry.description.trim(),
      cost: newLogEntry.cost === "" ? null : Number(newLogEntry.cost),
      performed_at: newLogEntry.performed_at || new Date().toISOString().slice(0, 10),
    });
    setSavingLog(false);

    if (!error) {
      setNewLogEntry({ description: "", cost: "", performed_at: "" });
      const { data } = await supabase
        .from("asset_maintenance_log")
        .select("*")
        .eq("asset_id", selectedAsset.id)
        .order("performed_at", { ascending: false });
      setMaintenanceLog(data || []);
      showToast("Maintenance logged");
    }
  }

  return (
    <div className="ast-page">
      <div className="ast-body">
        <div className={`ast-header ${mounted ? "ast-in" : ""}`}>
          <div>
            <p className="ast-eyebrow">Operations</p>
            <h1 className="ast-heading">Assets</h1>
          </div>
          <button className="ast-add-btn" onClick={openAddModal}>
            + Add asset
          </button>
        </div>

        {!loading && assets.length === 0 ? (
          <div className={`ast-empty ${mounted ? "ast-in" : ""}`}>
            No assets yet.{" "}
            <button className="ast-inline-link" onClick={openAddModal}>
              Add your first one
            </button>
          </div>
        ) : (
          <>
            <div className={`ast-toolbar ${mounted ? "ast-in" : ""}`}>
              <div className="ast-filters">
                <button
                  className={`ast-filter-btn ${statusFilter === "all" ? "ast-filter-btn--active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All <span className="ast-filter-count">{statusCounts.all}</span>
                </button>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`ast-filter-btn ${statusFilter === s ? "ast-filter-btn--active" : ""}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {STATUS_LABEL[s]} <span className="ast-filter-count">{statusCounts[s]}</span>
                  </button>
                ))}
              </div>

              <div className="ast-toolbar-right">
                <div className="ast-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    placeholder="Search assets..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="ast-search-clear" onClick={() => setSearch("")}>
                      ×
                    </button>
                  )}
                </div>
                <select className="ast-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name_asc">Name A–Z</option>
                  <option value="name_desc">Name Z–A</option>
                  <option value="maintenance_due">Maintenance due soonest</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
            </div>

            <div className={`ast-table-wrap ${mounted ? "ast-in" : ""}`}>
              {loading ? (
                <div className="ast-skeleton">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="ast-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                  ))}
                </div>
              ) : (
                <table className="ast-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Assigned to</th>
                      <th>Status</th>
                      <th>Next maintenance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset, i) => (
                      <tr
                        key={asset.id}
                        className="ast-row"
                        style={{ animationDelay: `${i * 0.03}s` }}
                        onClick={() => openDetail(asset)}
                      >
                        <td className="ast-name-cell">{asset.name}</td>
                        <td className="ast-muted">{asset.category || "—"}</td>
                        <td className="ast-muted">{staffName(asset.assigned_staff_id)}</td>
                        <td>
                          <span className={`ast-status ast-status--${asset.status}`}>
                            {STATUS_LABEL[asset.status]}
                          </span>
                        </td>
                        <td className={isOverdue(asset) ? "ast-overdue-cell" : "ast-muted"}>
                          {asset.next_maintenance_due || "—"}
                        </td>
                        <td className="ast-actions-cell" onClick={(e) => e.stopPropagation()}>
                          {confirmDeleteId === asset.id ? (
                            <div className="ast-confirm-row">
                              Delete?
                              <button className="ast-confirm-yes" onClick={() => handleDelete(asset.id)}>
                                Yes
                              </button>
                              <button className="ast-confirm-no" onClick={() => setConfirmDeleteId(null)}>
                                No
                              </button>
                            </div>
                          ) : (
                            <>
                              <button className="ast-action-btn" onClick={() => openEditModal(asset)}>
                                Edit
                              </button>
                              <button
                                className="ast-action-btn ast-action-btn--danger"
                                onClick={() => setConfirmDeleteId(asset.id)}
                              >
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>

      {/* Add / edit modal */}
      {showModal && (
        <div className="ast-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="ast-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingAsset ? "Edit asset" : "Add asset"}</h2>
            <form onSubmit={handleSave}>
              <label className="ast-label">Name</label>
              <input
                className="ast-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bosch angle grinder"
              />

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Category</label>
                  <input
                    className="ast-input"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="e.g. Tool"
                  />
                </div>
                <div>
                  <label className="ast-label">Serial number</label>
                  <input
                    className="ast-input"
                    value={form.serial_number}
                    onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  />
                </div>
              </div>

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Status</label>
                  <select
                    className="ast-select"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ast-label">Assigned to</label>
                  <select
                    className="ast-select"
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

              <label className="ast-label">Location</label>
              <input
                className="ast-input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Main warehouse"
              />

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Purchase date</label>
                  <input
                    type="date"
                    className="ast-input"
                    value={form.purchase_date}
                    onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="ast-label">Purchase cost</label>
                  <input
                    type="number"
                    step="0.01"
                    className="ast-input"
                    value={form.purchase_cost}
                    onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                    placeholder="R"
                  />
                </div>
              </div>

              <label className="ast-label">Next maintenance due</label>
              <input
                type="date"
                className="ast-input"
                value={form.next_maintenance_due}
                onChange={(e) => setForm({ ...form, next_maintenance_due: e.target.value })}
              />

              <label className="ast-label">Notes</label>
              <textarea
                className="ast-textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />

              {formError && <p className="ast-error">{formError}</p>}

              <div className="ast-modal-actions">
                <button type="button" className="ast-cancel-btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="ast-add-btn" disabled={saving}>
                  {saving ? <span className="ast-spinner" /> : editingAsset ? "Save changes" : "Add asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedAsset && (
        <div className="ast-drawer-overlay" onClick={() => setSelectedAsset(null)}>
          <div className="ast-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="ast-drawer-close" onClick={() => setSelectedAsset(null)}>
              ×
            </button>
            <h2>{selectedAsset.name}</h2>
            <p className="ast-drawer-sub">{selectedAsset.category || "Uncategorized"}</p>

            <div className="ast-meta-grid">
              <div className="ast-meta-item">
                <p className="ast-meta-label">Status</p>
                <p className="ast-meta-value">{STATUS_LABEL[selectedAsset.status]}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Assigned to</p>
                <p className="ast-meta-value">{staffName(selectedAsset.assigned_staff_id)}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Location</p>
                <p className="ast-meta-value">{selectedAsset.location || "—"}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Next maintenance</p>
                <p className="ast-meta-value">{selectedAsset.next_maintenance_due || "—"}</p>
              </div>
            </div>

            <div className="ast-section-title">Maintenance log</div>

            <form onSubmit={handleAddLogEntry} style={{ marginBottom: 18 }}>
              <input
                className="ast-input"
                placeholder="What was done..."
                value={newLogEntry.description}
                onChange={(e) => setNewLogEntry({ ...newLogEntry, description: e.target.value })}
              />
              <div className="ast-row-2">
                <input
                  type="date"
                  className="ast-input"
                  value={newLogEntry.performed_at}
                  onChange={(e) => setNewLogEntry({ ...newLogEntry, performed_at: e.target.value })}
                />
                <input
                  type="number"
                  step="0.01"
                  className="ast-input"
                  placeholder="Cost (R)"
                  value={newLogEntry.cost}
                  onChange={(e) => setNewLogEntry({ ...newLogEntry, cost: e.target.value })}
                />
              </div>
              <button type="submit" className="ast-add-row-btn" disabled={savingLog}>
                {savingLog ? <span className="ast-spinner" /> : "+ Log entry"}
              </button>
            </form>

            <div className="ast-log-list">
              {logLoading ? (
                <p className="ast-log-empty">Loading...</p>
              ) : maintenanceLog.length === 0 ? (
                <p className="ast-log-empty">No maintenance logged yet.</p>
              ) : (
                maintenanceLog.map((entry) => (
                  <div key={entry.id} className="ast-log-item">
                    <div className="ast-log-item-top">
                      <span className="ast-log-desc">{entry.description}</span>
                      <span className="ast-log-date">{entry.performed_at}</span>
                    </div>
                    {entry.cost != null && <span className="ast-log-cost">R{Number(entry.cost).toFixed(2)}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="ast-toast ast-toast--success">{toast}</div>}
    </div>
  );
}