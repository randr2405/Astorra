import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { generateNumber } from "../lib/numbering";
import { notify } from "../lib/notifications";
import { generateQuotePdf, downloadPdf, pdfToBase64 } from "../lib/pdfGenerator";
import { sendDocumentEmail } from "../lib/sendDocument";
import AppNav from "../components/AppNav";
import "./Quotes.css";

const STATUSES = ["draft", "sent", "accepted", "declined"];
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

function Quotes({ business, appUser }) {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [form, setForm] = useState({ customer_id: "", status: "draft" });
  const [lineItems, setLineItems] = useState([emptyLineItem()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [cooldownIds, setCooldownIds] = useState({});
  const cooldownTimers = useRef({});

  const fetchQuotes = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("quotes")
      .select("*, customers(name)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setQuotes(data || []);
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
    fetchQuotes();
    fetchCustomers();
  }, [fetchQuotes, fetchCustomers]);

  useEffect(() => {
    const timers = cooldownTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const openAddModal = () => {
    setEditingQuote(null);
    setForm({ customer_id: "", status: "draft" });
    setLineItems([emptyLineItem()]);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = async (quote) => {
    setEditingQuote(quote);
    setForm({ customer_id: quote.customer_id || "", status: quote.status });
    setError("");

    const { data: items } = await supabase
      .from("quote_line_items")
      .select("*")
      .eq("quote_id", quote.id);

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
    setEditingQuote(null);
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

    if (editingQuote) {
      const { error: updateError } = await supabase
        .from("quotes")
        .update({ customer_id: form.customer_id, status: form.status, total })
        .eq("id", editingQuote.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }

      if (form.status !== editingQuote.status) {
        if (form.status === "sent") {
          notify(business.id, appUser?.id, `Quote ${editingQuote.quote_number} was sent.`);
        }
        if (form.status === "accepted") {
          notify(business.id, appUser?.id, `Quote ${editingQuote.quote_number} was accepted.`);
        }
        if (form.status === "declined") {
          notify(business.id, appUser?.id, `Quote ${editingQuote.quote_number} was declined.`);
        }
      }

      await supabase.from("quote_line_items").delete().eq("quote_id", editingQuote.id);

      const { error: itemsError } = await supabase.from("quote_line_items").insert(
        cleanItems.map((i) => ({
          quote_id: editingQuote.id,
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
      let quoteNumber;
      try {
        quoteNumber = await generateNumber(business.id, "quote");
      } catch (numError) {
        setSaving(false);
        return setError(numError.message);
      }

      const { data: inserted, error: insertError } = await supabase
        .from("quotes")
        .insert({
          business_id: business.id,
          customer_id: form.customer_id,
          quote_number: quoteNumber,
          status: form.status,
          total,
        })
        .select()
        .single();

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }

      const { error: itemsError } = await supabase.from("quote_line_items").insert(
        cleanItems.map((i) => ({
          quote_id: inserted.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      );

      if (itemsError) {
        setSaving(false);
        return setError(itemsError.message);
      }

      notify(business.id, appUser?.id, `Quote ${quoteNumber} was created.`);
    }

    setSaving(false);
    closeModal();
    fetchQuotes();
  };

  const handleDelete = async (quote) => {
    if (!window.confirm(`Delete quote ${quote.quote_number}? This can't be undone.`)) return;
    const { error: deleteError } = await supabase.from("quotes").delete().eq("id", quote.id);
    if (!deleteError) {
      notify(business.id, appUser?.id, `Quote ${quote.quote_number} was deleted.`);
      fetchQuotes();
    }
  };

  const handleConvertToInvoice = async (quote) => {
    if (!window.confirm(`Convert ${quote.quote_number} to an invoice?`)) return;

    let invoiceNumber;
    try {
      invoiceNumber = await generateNumber(business.id, "invoice");
    } catch (numError) {
      window.alert(numError.message);
      return;
    }

    const { error: convertError } = await supabase.from("invoices").insert({
      business_id: business.id,
      customer_id: quote.customer_id,
      quote_id: quote.id,
      invoice_number: invoiceNumber,
      status: "unpaid",
      total: quote.total,
    });

    if (!convertError) {
      notify(business.id, appUser?.id, `Quote ${quote.quote_number} was converted to invoice ${invoiceNumber}.`);
      navigate("/dashboard/invoices");
    }
  };

  const handleDownload = async (quote) => {
    const { data: items } = await supabase
      .from("quote_line_items")
      .select("*")
      .eq("quote_id", quote.id);

    const customer = customers.find((c) => c.id === quote.customer_id);
    const doc = generateQuotePdf(quote, customer, items || [], business);
    downloadPdf(doc, `quote-${quote.quote_number}.pdf`);
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

  const handleSend = async (quote) => {
    if (sendingId === quote.id || cooldownIds[quote.id]) return;

    const { data: fullCustomer } = await supabase
      .from("customers")
      .select("name, email")
      .eq("id", quote.customer_id)
      .single();

    if (!fullCustomer?.email) {
      window.alert("This customer has no email address on file.");
      return;
    }

    setSendingId(quote.id);

    try {
      const { data: items } = await supabase
        .from("quote_line_items")
        .select("*")
        .eq("quote_id", quote.id);

      const doc = generateQuotePdf(quote, fullCustomer, items || [], business);
      const pdfBase64 = pdfToBase64(doc);

      await sendDocumentEmail({
        type: "quote",
        number: quote.quote_number,
        toEmail: fullCustomer.email,
        toName: fullCustomer.name,
        pdfBase64,
        businessName: business.name,
      });

      if (quote.status === "draft") {
        await supabase.from("quotes").update({ status: "sent" }).eq("id", quote.id);
        fetchQuotes();
      }

      notify(business.id, appUser?.id, `Quote ${quote.quote_number} was emailed to ${fullCustomer.name}.`);
      window.alert("Quote sent.");
    } catch (err) {
      window.alert(`Failed to send: ${err.message}`);
    } finally {
      setSendingId(null);
      startCooldown(quote.id);
    }
  };

  const modalTotal = calcTotal(lineItems);

  const sendLabel = (id) => {
    if (sendingId === id) return "Sending...";
    if (cooldownIds[id]) return "Sent";
    return "Send";
  };

  return (
    <div className="quo-page">
      <AppNav business={business} />

      <div className="quo-body">
        <div className="quo-header">
          <div>
            <p className="quo-eyebrow">Quotes</p>
            <h1 className="quo-heading">Your quotes</h1>
          </div>
          <button
            className="quo-add-btn"
            onClick={openAddModal}
            disabled={customers.length === 0}
            title={customers.length === 0 ? "Add a customer first" : ""}
          >
            + New quote
          </button>
        </div>

        {customers.length === 0 && (
          <div className="quo-empty" style={{ marginBottom: 24 }}>
            You need at least one customer before creating a quote.
          </div>
        )}

        {loading ? (
          <p className="quo-muted">Loading...</p>
        ) : quotes.length === 0 ? (
          <div className="quo-empty">No quotes yet. Create your first one to get started.</div>
        ) : (
          <div className="quo-table-wrap">
            <table className="quo-table">
              <thead>
                <tr>
                  <th>Quote #</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map((q) => (
                  <tr key={q.id}>
                    <td className="quo-name-cell">{q.quote_number}</td>
                    <td className={q.customers?.name ? "" : "quo-muted"}>
                      {q.customers?.name || "—"}
                    </td>
                    <td>
                      <span className={`quo-status quo-status--${q.status}`}>{q.status}</span>
                    </td>
                    <td className="quo-total-cell">R{Number(q.total).toFixed(2)}</td>
                    <td>
                      <div className="quo-actions-cell">
                        {q.status === "accepted" && (
                          <button
                            className="quo-action-btn"
                            onClick={() => handleConvertToInvoice(q)}
                          >
                            Convert
                          </button>
                        )}
                        <button className="quo-action-btn" onClick={() => handleDownload(q)}>
                          Download
                        </button>
                        <button
                          className="quo-action-btn"
                          onClick={() => handleSend(q)}
                          disabled={sendingId === q.id || !!cooldownIds[q.id]}
                          title={cooldownIds[q.id] ? "Sent — you can send again shortly" : ""}
                        >
                          {sendLabel(q.id)}
                        </button>
                        <button className="quo-action-btn" onClick={() => openEditModal(q)}>
                          Edit
                        </button>
                        <button
                          className="quo-action-btn quo-action-btn--danger"
                          onClick={() => handleDelete(q)}
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
        <div className="quo-modal-overlay" onClick={closeModal}>
          <div className="quo-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingQuote ? `Edit ${editingQuote.quote_number}` : "New quote"}</h2>
            <form onSubmit={handleSave}>
              <div className="quo-row-2">
                <div>
                  <label className="quo-label">Customer</label>
                  <select
                    className="quo-select"
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
                  <label className="quo-label">Status</label>
                  <select
                    className="quo-select"
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

              <div className="quo-items-label">
                <label className="quo-label" style={{ margin: 0 }}>
                  Line items
                </label>
                <button type="button" className="quo-add-row-btn" onClick={addLineItem}>
                  + Add row
                </button>
              </div>

              {lineItems.map((item, index) => (
                <div className="quo-line-item" key={item.id || index}>
                  <input
                    className="quo-input"
                    placeholder="Description"
                    value={item.description}
                    onChange={(e) => updateLineItem(index, "description", e.target.value)}
                  />
                  <input
                    className="quo-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Qty"
                    value={item.quantity}
                    onChange={(e) => updateLineItem(index, "quantity", e.target.value)}
                  />
                  <input
                    className="quo-input"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Unit price"
                    value={item.unit_price}
                    onChange={(e) => updateLineItem(index, "unit_price", e.target.value)}
                  />
                  <button
                    type="button"
                    className="quo-remove-row-btn"
                    onClick={() => removeLineItem(index)}
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="quo-total-row">
                Total: <strong>R{modalTotal.toFixed(2)}</strong>
              </div>

              {error && <p className="quo-error">{error}</p>}

              <div className="quo-modal-actions">
                <button type="button" className="quo-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="quo-add-btn" disabled={saving}>
                  {saving ? "Saving..." : editingQuote ? "Save changes" : "Create quote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Quotes;