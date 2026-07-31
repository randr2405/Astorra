import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Staff.css";

function Staff({ business, appUser }) {
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState(null);
  const [form, setForm] = useState({
    full_name: "",
    position: "",
    email: "",
    phone: "",
    start_date: "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

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
    setForm({ full_name: "", position: "", email: "", phone: "", start_date: "" });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (member) => {
    setEditingStaff(member);
    setForm({
      full_name: member.full_name || "",
      position: member.position || "",
      email: member.email || "",
      phone: member.phone || "",
      start_date: member.start_date || "",
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

    setSaving(true);

    const payload = {
      full_name: form.full_name,
      position: form.position || null,
      email: form.email || null,
      phone: form.phone || null,
      start_date: form.start_date || null,
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

  return (
    <div className="staff-page">
      <AppNav business={business} />

      <div className="staff-body">
        <div className="staff-header">
          <div>
            <p className="staff-eyebrow">Staff / HR</p>
            <h1 className="staff-heading">Your team</h1>
          </div>
          <button className="staff-add-btn" onClick={openAddModal}>
            + Add staff member
          </button>
        </div>

        {loading ? (
          <p className="staff-muted">Loading...</p>
        ) : staff.length === 0 ? (
          <div className="staff-empty">
            No staff records yet. Add your first one to get started.
          </div>
        ) : (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Start date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {staff.map((m) => (
                  <tr key={m.id}>
                    <td className="staff-name-cell">{m.full_name}</td>
                    <td className={m.position ? "" : "staff-muted"}>{m.position || "—"}</td>
                    <td className={m.email ? "" : "staff-muted"}>{m.email || "—"}</td>
                    <td className={m.phone ? "" : "staff-muted"}>{m.phone || "—"}</td>
                    <td className={m.start_date ? "" : "staff-muted"}>
                      {m.start_date || "—"}
                    </td>
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
                ))}
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

              <label className="staff-label">Position</label>
              <input
                className="staff-input"
                placeholder="e.g. Machine operator"
                value={form.position}
                onChange={(e) => setForm({ ...form, position: e.target.value })}
              />

              <label className="staff-label">Email</label>
              <input
                className="staff-input"
                type="email"
                placeholder="staff@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />

              <label className="staff-label">Phone</label>
              <input
                className="staff-input"
                placeholder="081 234 5678"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />

              <label className="staff-label">Start date</label>
              <input
                className="staff-input"
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />

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