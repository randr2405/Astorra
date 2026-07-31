import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./Inventory.css";

function Inventory({ business }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState({ name: "", sku: "", quantity: "", unit_cost: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setItems(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const openAddModal = () => {
    setEditingItem(null);
    setForm({ name: "", sku: "", quantity: "", unit_cost: "" });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setForm({
      name: item.name || "",
      sku: item.sku || "",
      quantity: item.quantity,
      unit_cost: item.unit_cost ?? "",
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Enter an item name.");
    if (form.quantity === "" || isNaN(Number(form.quantity)) || Number(form.quantity) < 0) {
      return setError("Enter a valid quantity.");
    }

    setSaving(true);

    const payload = {
      name: form.name,
      sku: form.sku || null,
      quantity: Number(form.quantity),
      unit_cost: form.unit_cost === "" ? null : Number(form.unit_cost),
    };

    if (editingItem) {
      const { error: updateError } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", editingItem.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase.from("inventory_items").insert({
        business_id: business.id,
        ...payload,
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }
    }

    setSaving(false);
    closeModal();
    fetchItems();
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete ${item.name}? This can't be undone.`)) return;

    const { error: deleteError } = await supabase
      .from("inventory_items")
      .delete()
      .eq("id", item.id);

    if (!deleteError) fetchItems();
  };

  return (
    <div className="inven-page">
      <nav className="inven-nav">
        <div className="inven-nav-inner">
          <button className="inven-back" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <span className="inven-wordmark">ASTORRA</span>
        </div>
      </nav>

      <div className="inven-body">
        <div className="inven-header">
          <div>
            <p className="inven-eyebrow">Inventory</p>
            <h1 className="inven-heading">Your stock</h1>
          </div>
          <button className="inven-add-btn" onClick={openAddModal}>
            + Add item
          </button>
        </div>

        {loading ? (
          <p className="inven-muted">Loading...</p>
        ) : items.length === 0 ? (
          <div className="inven-empty">
            No inventory items yet. Add your first one to get started.
          </div>
        ) : (
          <div className="inven-table-wrap">
            <table className="inven-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>SKU</th>
                  <th>Quantity</th>
                  <th>Unit cost</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="inven-name-cell">{it.name}</td>
                    <td className={it.sku ? "" : "inven-muted"}>{it.sku || "—"}</td>
                    <td>{Number(it.quantity)}</td>
                    <td className={it.unit_cost != null ? "" : "inven-muted"}>
                      {it.unit_cost != null ? `R${Number(it.unit_cost).toFixed(2)}` : "—"}
                    </td>
                    <td>
                      <div className="inven-actions-cell">
                        <button className="inven-action-btn" onClick={() => openEditModal(it)}>
                          Edit
                        </button>
                        <button
                          className="inven-action-btn inven-action-btn--danger"
                          onClick={() => handleDelete(it)}
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
        <div className="inven-modal-overlay" onClick={closeModal}>
          <div className="inven-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingItem ? "Edit item" : "Add item"}</h2>
            <form onSubmit={handleSave}>
              <label className="inven-label">Name</label>
              <input
                className="inven-input"
                placeholder="Item name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />

              <label className="inven-label">SKU</label>
              <input
                className="inven-input"
                placeholder="Optional SKU"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
              />

              <label className="inven-label">Quantity</label>
              <input
                className="inven-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              />

              <label className="inven-label">Unit cost (R)</label>
              <input
                className="inven-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.unit_cost}
                onChange={(e) => setForm({ ...form, unit_cost: e.target.value })}
              />

              {error && <p className="inven-error">{error}</p>}

              <div className="inven-modal-actions">
                <button type="button" className="inven-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="inven-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingItem ? "Save changes" : "Add item"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Inventory;