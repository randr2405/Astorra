import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { generateNumber } from "../lib/numbering";
import { notify } from "../lib/notifications";
import "./Invoices.css";

const STATUSES = ["unpaid", "paid", "overdue"];

function Invoices({ business, appUser }) {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [form, setForm] = useState({ customer_id: "", status: "unpaid", total: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("invoices")
      .select("*, customers(name), quotes(quote_number)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setInvoices(data || []);
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
    fetchInvoices();
    fetchCustomers();
  }, [fetchInvoices, fetchCustomers]);

  const openAddModal = () => {
    setEditingInvoice(null);
    setForm({ customer_id: "", status: "unpaid", total: "" });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (invoice) => {
    setEditingInvoice(invoice);
    setForm({
      customer_id: invoice.customer_id || "",
      status: invoice.status,
      total: invoice.total,
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingInvoice(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.customer_id) return setError("Please select a customer.");
    if (form.total === "" || isNaN(Number(form.total)) || Number(form.total) < 0) {
      return setError("Enter a valid total.");
    }

    setSaving(true);

    if (editingInvoice) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update({
          customer_id: form.customer_id,
          status: form.status,
          total: Number(form.total),
        })
        .eq("id", editingInvoice.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }
    } else {
      let invoiceNumber;
      try {
        invoiceNumber = await generateNumber(business.id, "invoice");
      } catch (numError) {
        setSaving(false);
        return setError(numError.message);
      }

      const { error: insertError } = await supabase.from("invoices").insert({
        business_id: business.id,
        customer_id: form.customer_id,
        quote_id: null,
        invoice_number: invoiceNumber,
        status: form.status,
        total: Number(form.total),
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }
    }

    setSaving(false);
    closeModal();
    fetchInvoices();
  };

  const handleDelete = async (invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This can't be undone.`)) return;
    const { error: deleteError } = await supabase.from("invoices").delete().eq("id", invoice.id);
    if (!deleteError) fetchInvoices();
  };

  const handleMarkPaid = async (invoice) => {
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", invoice.id);
    if (!updateError) {
      notify(business.id, appUser?.id, `Invoice ${invoice.invoice_number} was marked as paid.`);
      fetchInvoices();
    }
  };

  return (
    <div className="inv-page">
      <nav className="inv-nav">
        <div className="inv-nav-inner">
          <button className="inv-back" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <span className="inv-wordmark">ASTORRA</span>
        </div>
      </nav>

      <div className="inv-body">
        <div className="inv-header">
          <div>
            <p className="inv-eyebrow">Invoices</p>
            <h1 className="inv-heading">Your invoices</h1>
          </div>
          <button
            className="inv-add-btn"
            onClick={openAddModal}
            disabled={customers.length === 0}
            title={customers.length === 0 ? "Add a customer first" : ""}
          >
            + New invoice
          </button>
        </div>

        {customers.length === 0 && (
          <div className="inv-empty" style={{ marginBottom: 24 }}>
            You need at least one customer before creating an invoice.
          </div>
        )}

        {loading ? (
          <p className="inv-muted">Loading...</p>
        ) : invoices.length === 0 ? (
          <div className="inv-empty">
            No invoices yet. Create one directly or convert an accepted quote.
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Quote #</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td className="inv-name-cell">{inv.invoice_number}</td>
                    <td className={inv.quotes?.quote_number ? "" : "inv-muted"}>
                      {inv.quotes?.quote_number || "—"}
                    </td>
                    <td className={inv.customers?.name ? "" : "inv-muted"}>
                      {inv.customers?.name || "—"}
                    </td>
                    <td>
                      <span className={`inv-status inv-status--${inv.status}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="inv-total-cell">R{Number(inv.total).toFixed(2)}</td>
                    <td>
                      <div className="inv-actions-cell">
                        {inv.status !== "paid" && (
                          <button
                            className="inv-action-btn"
                            onClick={() => handleMarkPaid(inv)}
                          >
                            Mark paid
                          </button>
                        )}
                        <button className="inv-action-btn" onClick={() => openEditModal(inv)}>
                          Edit
                        </button>
                        <button
                          className="inv-action-btn inv-action-btn--danger"
                          onClick={() => handleDelete(inv)}
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
        <div className="inv-modal-overlay" onClick={closeModal}>
          <div className="inv-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingInvoice ? `Edit ${editingInvoice.invoice_number}` : "New invoice"}</h2>
            <form onSubmit={handleSave}>
              <label className="inv-label">Customer</label>
              <select
                className="inv-select"
                value={form.customer_id}
                onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
              >
                <option value="">Select a customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <label className="inv-label">Status</label>
              <select
                className="inv-select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>

              <label className="inv-label">Total (R)</label>
              <input
                className="inv-input"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
              />

              {error && <p className="inv-error">{error}</p>}

              <div className="inv-modal-actions">
                <button type="button" className="inv-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="inv-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingInvoice ? "Save changes" : "Create invoice"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Invoices;