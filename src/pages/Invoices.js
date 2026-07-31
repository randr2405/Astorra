import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { generateNumber } from "../lib/numbering";
import { notify } from "../lib/notifications";
import { generateInvoicePdf, downloadPdf, pdfToBase64 } from "../lib/pdfGenerator";
import { sendDocumentEmail } from "../lib/sendDocument";
import AppNav from "../components/AppNav";
import "./Invoices.css";

const STATUSES = ["unpaid", "paid", "overdue"];
const SEND_COOLDOWN_MS = 30000;

function emptyLineItem() {
  return { description: "", quantity: 1, unit_price: 0 };
}

function calcTotal(items) {
  return items.reduce(
    (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
    0
  );
}

function Invoices({ business, appUser }) {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [form, setForm] = useState({ customer_id: "", status: "unpaid" });
  const [lineItems, setLineItems] = useState([emptyLineItem()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [cooldownIds, setCooldownIds] = useState({});
  const cooldownTimers = useRef({});

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

  useEffect(() => {
    const timers = cooldownTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const openAddModal = () => {
    setEditingInvoice(null);
    setForm({ customer_id: "", status: "unpaid" });
    setLineItems([emptyLineItem()]);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = async (invoice) => {
    setEditingInvoice(invoice);
    setForm({ customer_id: invoice.customer_id || "", status: invoice.status });
    setError("");

    const { data: items } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoice.id);

    setLineItems(
      items && items.length > 0
        ? items.map((i) => ({
            id: i.id,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
          }))
        : [emptyLineItem()]
    );
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingInvoice(null);
  };

  const updateLineItem = (index, field, value) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  const addLineItem = () => setLineItems((prev) => [...prev, emptyLineItem()]);

  const removeLineItem = (index) => {
    setLineItems((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");

    if (!form.customer_id) return setError("Please select a customer.");
    if (lineItems.every((i) => !i.description.trim())) {
      return setError("Add at least one line item.");
    }

    setSaving(true);
    const total = calcTotal(lineItems);
    const cleanItems = lineItems.filter((i) => i.description.trim());

    if (editingInvoice) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ customer_id: form.customer_id, status: form.status, total })
        .eq("id", editingInvoice.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }

      await supabase.from("invoice_line_items").delete().eq("invoice_id", editingInvoice.id);

      const { error: itemsError } = await supabase.from("invoice_line_items").insert(
        cleanItems.map((i) => ({
          invoice_id: editingInvoice.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      );

      if (itemsError) {
        setSaving(false);
        return setError(itemsError.message);
      }
    } else {
      let invoiceNumber;
      try {
        invoiceNumber = await generateNumber(business.id, "invoice");
      } catch (numError) {
        setSaving(false);
        return setError(numError.message);
      }

      const { data: inserted, error: insertError } = await supabase
        .from("invoices")
        .insert({
          business_id: business.id,
          customer_id: form.customer_id,
          quote_id: null,
          invoice_number: invoiceNumber,
          status: form.status,
          total,
        })
        .select()
        .single();

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }

      const { error: itemsError } = await supabase.from("invoice_line_items").insert(
        cleanItems.map((i) => ({
          invoice_id: inserted.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      );

      if (itemsError) {
        setSaving(false);
        return setError(itemsError.message);
      }

      notify(business.id, appUser?.id, `Invoice ${invoiceNumber} was created.`);
    }

    setSaving(false);
    closeModal();
    fetchInvoices();
  };

  const handleDelete = async (invoice) => {
    if (!window.confirm(`Delete invoice ${invoice.invoice_number}? This can't be undone.`)) return;
    const { error: deleteError } = await supabase.from("invoices").delete().eq("id", invoice.id);
    if (!deleteError) {
      notify(business.id, appUser?.id, `Invoice ${invoice.invoice_number} was deleted.`);
      fetchInvoices();
    }
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

  const handleDownload = async (invoice) => {
    const { data: items } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoice.id);

    const customer = customers.find((c) => c.id === invoice.customer_id);
    const doc = generateInvoicePdf(invoice, customer, items || [], business);
    downloadPdf(doc, `invoice-${invoice.invoice_number}.pdf`);
  };

  const startCooldown = (id) => {
    setCooldownIds((prev) => ({ ...prev, [id]: true }));
    cooldownTimers.current[id] = setTimeout(() => {
      setCooldownIds((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      delete cooldownTimers.current[id];
    }, SEND_COOLDOWN_MS);
  };

  const handleSend = async (invoice) => {
    if (sendingId === invoice.id || cooldownIds[invoice.id]) return;

    const { data: fullCustomer } = await supabase
      .from("customers")
      .select("name, email")
      .eq("id", invoice.customer_id)
      .single();

    if (!fullCustomer?.email) {
      window.alert("This customer has no email address on file.");
      return;
    }

    setSendingId(invoice.id);

    try {
      const { data: items } = await supabase
        .from("invoice_line_items")
        .select("*")
        .eq("invoice_id", invoice.id);

      const doc = generateInvoicePdf(invoice, fullCustomer, items || [], business);
      const pdfBase64 = pdfToBase64(doc);

      await sendDocumentEmail({
        type: "invoice",
        number: invoice.invoice_number,
        toEmail: fullCustomer.email,
        toName: fullCustomer.name,
        pdfBase64,
        businessName: business.name,
      });

      notify(business.id, appUser?.id, `Invoice ${invoice.invoice_number} was emailed to ${fullCustomer.name}.`);
      window.alert("Invoice sent.");
    } catch (err) {
      window.alert(`Failed to send: ${err.message}`);
    } finally {
      setSendingId(null);
      startCooldown(invoice.id);
    }
  };

  const modalTotal = calcTotal(lineItems);

  const sendLabel = (id) => {
    if (sendingId === id) return "Sending...";
    if (cooldownIds[id]) return "Sent";
    return "Send";
  };

  return (
    <div className="inv-page">
      <AppNav business={business} />

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
                        <button className="inv-action-btn" onClick={() => handleDownload(inv)}>
                          Download
                        </button>
                        <button
                          className="inv-action-btn"
                          onClick={() => handleSend(inv)}
                          disabled={sendingId === inv.id || !!cooldownIds[inv.id]}
                          title={cooldownIds[inv.id] ? "Sent — you can send again shortly" : ""}
                        >
                          {sendLabel(inv.id)}
                        </button>
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
              <div className="inv-row-2">
                <div>
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
                </div>
                <div>
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
                </div>
              </div>

              <div className="inv-items-label">
                <label className="inv-label" style={{ margin: 0 }}>
                  Line items
                </label>
                <button type="button" className="inv-add-row-btn" onClick={addLineItem}>
                  + Add row
                </button>
              </div>

              {lineItems.map((item, index) => (
                <div className="inv-line-item" key={item.id || index}>
                  <input
                    className="inv-input"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  />
                  <input
                    className="inv-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                  />
                  <input
                    className="inv-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit price"
                    value={item.unit_price}
                    onChange={(e) => updateLineItem(index, "unit_price", e.target.value)}
                  />
                  <button
                    type="button"
                    className="inv-remove-row-btn"
                    onClick={() => removeLineItem(index)}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="inv-total-row">
                Total: <strong>R{modalTotal.toFixed(2)}</strong>
              </div>

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