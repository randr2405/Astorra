import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Customers.css";

function Customers({ business }) {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("customers")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setCustomers(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchCustomers();
  }, [fetchCustomers]);

  const openAddModal = () => {
    setEditingCustomer(null);
    setForm({ name: "", email: "", phone: "", notes: "" });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      notes: customer.notes || "",
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingCustomer(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    if (editingCustomer) {
      const { error: updateError } = await supabase
        .from("customers")
        .update({
          name: form.name,
          email: form.email,
          phone: form.phone,
          notes: form.notes,
        })
        .eq("id", editingCustomer.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase.from("customers").insert({
        business_id: business.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }
    }

    setSaving(false);
    closeModal();
    fetchCustomers();
  };

  const handleDelete = async (customer) => {
    if (!window.confirm(`Delete ${customer.name}? This can't be undone.`)) return;

    const { error: deleteError } = await supabase
      .from("customers")
      .delete()
      .eq("id", customer.id);

    if (!deleteError) fetchCustomers();
  };

  return (
    <div className="cust-page">
      <nav className="cust-nav">
        <div className="cust-nav-inner">
          <button className="cust-back" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <span className="cust-wordmark">ASTORRA</span>
        </div>
      </nav>

      <div className="cust-body">
        <div className="cust-header">
          <div>
            <p className="cust-eyebrow">Customers</p>
            <h1 className="cust-heading">Your customer records</h1>
          </div>
          <button className="cust-add-btn" onClick={openAddModal}>
            + Add customer
          </button>
        </div>

        {loading ? (
          <p className="cust-muted">Loading...</p>
        ) : customers.length === 0 ? (
          <div className="cust-empty">
            No customers yet. Add your first one to get started.
          </div>
        ) : (
          <div className="cust-table-wrap">
            <table className="cust-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {customers.map((c) => (
                  <tr key={c.id}>
                    <td className="cust-name-cell">{c.name}</td>
                    <td className={c.email ? "" : "cust-muted"}>{c.email || "—"}</td>
                    <td className={c.phone ? "" : "cust-muted"}>{c.phone || "—"}</td>
                    <td>
                      <div className="cust-actions-cell">
                        <button className="cust-action-btn" onClick={() => openEditModal(c)}>
                          Edit
                        </button>
                        <button
                          className="cust-action-btn cust-action-btn--danger"
                          onClick={() => handleDelete(c)}
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
        <div className="cust-modal-overlay" onClick={closeModal}>
          <div className="cust-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCustomer ? "Edit customer" : "Add customer"}</h2>
            <form onSubmit={handleSave}>
              <label className="cust-label">Name</label>
              <input
                className="cust-input"
                placeholder="Customer name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />

              <label className="cust-label">Email</label>
              <input
                className="cust-input"
                type="email"
                placeholder="customer@email.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />

              <label className="cust-label">Phone</label>
              <input
                className="cust-input"
                placeholder="081 234 5678"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />

              <label className="cust-label">Notes</label>
              <textarea
                className="cust-input"
                rows={3}
                placeholder="Optional notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />

              {error && <p className="cust-error">{error}</p>}

              <div className="cust-modal-actions">
                <button type="button" className="cust-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="cust-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingCustomer ? "Save changes" : "Add customer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Customers;