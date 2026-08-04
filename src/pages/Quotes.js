import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { generateNumber } from "../lib/numbering";
import { notify } from "../lib/notifications";
import { generateQuotePdf, downloadPdf, pdfToBase64 } from "../lib/pdfGenerator";
import { sendDocumentEmail } from "../lib/sendDocument";
import AppNav from "../components/AppNav";
import "./Quotes.css";

const STATUSES = ["draft", "sent", "accepted", "declined"];
const STATUS_FILTERS = ["all", ...STATUSES];
const SEND_COOLDOWN_MS = 30000;

const SORT_OPTIONS = [
  { key: "recent", label: "Most recent" },
  { key: "total_desc", label: "Highest total" },
  { key: "total_asc", label: "Lowest total" },
  { key: "customer_asc", label: "Customer (A–Z)" },
];

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
  const [loaded, setLoaded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState(null);
  const [form, setForm] = useState({ customer_id: "", status: "draft" });
  const [lineItems, setLineItems] = useState([emptyLineItem()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [duplicatingId, setDuplicatingId] = useState(null);
  const [cooldownIds, setCooldownIds] = useState({});
  const cooldownTimers = useRef({});

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState("recent");
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [toast, setToast] = useState(null);

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
    if (!loading) {
      const t = setTimeout(() => setLoaded(true), 40);
      return () => clearTimeout(t);
    }
  }, [loading]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const timers = cooldownTimers.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const visibleQuotes = useMemo(() => {
    let list = quotes;

    if (statusFilter !== "all") {
      list = list.filter((q) => q.status === statusFilter);
    }

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (quote) =>
          quote.quote_number?.toLowerCase().includes(q) ||
          quote.customers?.name?.toLowerCase().includes(q)
      );
    }

    const copy = [...list];
    switch (sortKey) {
      case "total_desc":
        return copy.sort((a, b) => Number(b.total) - Number(a.total));
      case "total_asc":
        return copy.sort((a, b) => Number(a.total) - Number(b.total));
      case "customer_asc":
        return copy.sort((a, b) => (a.customers?.name || "").localeCompare(b.customers?.name || ""));
      default:
        return copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }, [quotes, query, statusFilter, sortKey]);

  const statusCounts = useMemo(() => {
    const counts = { all: quotes.length };
    STATUSES.forEach((s) => (counts[s] = 0));
    quotes.forEach((q) => {
      if (counts[q.status] !== undefined) counts[q.status] += 1;
    });
    return counts;
  }, [quotes]);

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

      setToast({ type: "success", text: `Quote ${editingQuote.quote_number} updated` });
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
      setToast({ type: "success", text: `Quote ${quoteNumber} created` });
    }

    setSaving(false);
    closeModal();
    fetchQuotes();
  };

  const handleDelete = async (quote) => {
    setPendingDeleteId(null);
    const { error: deleteError } = await supabase.from("quotes").delete().eq("id", quote.id);
    if (!deleteError) {
      notify(business.id, appUser?.id, `Quote ${quote.quote_number} was deleted.`);
      setToast({ type: "neutral", text: `Quote ${quote.quote_number} deleted` });
      fetchQuotes();
    }
  };

  const handleDuplicate = async (quote) => {
    setDuplicatingId(quote.id);

    try {
      const { data: items } = await supabase
        .from("quote_line_items")
        .select("description, quantity, unit_price")
        .eq("quote_id", quote.id);

      const quoteNumber = await generateNumber(business.id, "quote");

      const { data: inserted, error: insertError } = await supabase
        .from("quotes")
        .insert({
          business_id: business.id,
          customer_id: quote.customer_id,
          quote_number: quoteNumber,
          status: "draft",
          total: quote.total,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      if (items && items.length > 0) {
        const { error: itemsError } = await supabase.from("quote_line_items").insert(
          items.map((i) => ({
            quote_id: inserted.id,
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price,
          }))
        );
        if (itemsError) throw itemsError;
      }

      notify(business.id, appUser?.id, `Quote ${quoteNumber} was created from a duplicate of ${quote.quote_number}.`);
      setToast({ type: "success", text: `Duplicated as ${quoteNumber}` });
      fetchQuotes();
    } catch (err) {
      window.alert(`Failed to duplicate: ${err.message}`);
    } finally {
      setDuplicatingId(null);
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
      setToast({ type: "success", text: `Sent to ${fullCustomer.name}` });
    } catch (err) {
      window.alert(`Failed to send: ${err.message}`);
    } finally {
      setSendingId(null);
      startCooldown(quote.id);
    }
  };

  const modalTotal = calcTotal(lineItems);

  const sendLabel = (id) => {
    if (sendingId === id) return <span className="quo-spinner" />;
    if (cooldownIds[id]) return "Sent";
    return "Send";
  };

  return (
    <div className="quo-page">
      <AppNav business={business} />

      <div className="quo-body">
        <div className={`quo-header ${loaded ? "quo-in" : ""}`}>
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
          <div className="quo-empty quo-in" style={{ marginBottom: 24 }}>
            You need at least one customer before creating a quote.
          </div>
        )}

        {quotes.length > 0 && (
          <div className={`quo-toolbar ${loaded ? "quo-in" : ""}`}>
            <div className="quo-filters">
              {STATUS_FILTERS.map((s) => (
                <button
                  key={s}
                  className={`quo-filter-btn ${statusFilter === s ? "quo-filter-btn--active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                  <span className="quo-filter-count">{statusCounts[s] ?? 0}</span>
                </button>
              ))}
            </div>

            <div className="quo-toolbar-right">
              <div className="quo-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  type="text"
                  placeholder="Search quote # or customer..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                {query && (
                  <button className="quo-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                    ×
                  </button>
                )}
              </div>

              <select className="quo-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {loading ? (
          <div className="quo-table-wrap quo-in">
            <div className="quo-skeleton">
              {[...Array(4)].map((_, i) => (
                <div className="quo-skeleton-row" key={i} style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          </div>
        ) : quotes.length === 0 ? (
          <div className="quo-empty quo-in">No quotes yet. Create your first one to get started.</div>
        ) : visibleQuotes.length === 0 ? (
          <div className="quo-empty quo-in">
            <p style={{ margin: "0 0 12px" }}>No quotes match your filters.</p>
            <button
              className="quo-inline-link"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className={`quo-table-wrap ${loaded ? "quo-in" : ""}`}>
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
                {visibleQuotes.map((q, i) => (
                  <tr
                    key={q.id}
                    className="quo-row"
                    style={{ animationDelay: loaded ? `${Math.min(i, 12) * 35}ms` : "0ms" }}
                  >
                    <td className="quo-name-cell">{q.quote_number}</td>
                    <td className={q.customers?.name ? "" : "quo-muted"}>
                      {q.customers?.name || "—"}
                    </td>
                    <td>
                      <span className={`quo-status quo-status--${q.status}`}>{q.status}</span>
                    </td>
                    <td className="quo-total-cell">R{Number(q.total).toFixed(2)}</td>
                    <td>
                      {pendingDeleteId === q.id ? (
                        <div className="quo-confirm-row">
                          <span>Delete {q.quote_number}?</span>
                          <button className="quo-confirm-yes" onClick={() => handleDelete(q)}>
                            Yes
                          </button>
                          <button className="quo-confirm-no" onClick={() => setPendingDeleteId(null)}>
                            No
                          </button>
                        </div>
                      ) : (
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
                          <button
                            className="quo-action-btn"
                            onClick={() => handleDuplicate(q)}
                            disabled={duplicatingId === q.id}
                            title="Duplicate this quote"
                          >
                            {duplicatingId === q.id ? <span className="quo-spinner" /> : "Duplicate"}
                          </button>
                          <button className="quo-action-btn" onClick={() => openEditModal(q)}>
                            Edit
                          </button>
                          <button
                            className="quo-action-btn quo-action-btn--danger"
                            onClick={() => setPendingDeleteId(q.id)}
                          >
                            Delete
                          </button>
                        </div>
                      )}
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

              {lineItems.map((item, index) => {
                const lineTotal = (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);
                return (
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
                    <span className="quo-line-total" title="Line total">
                      R{lineTotal.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      className="quo-remove-row-btn"
                      onClick={() => removeLineItem(index)}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

              <div className="quo-total-row">
                Total: <strong>R{modalTotal.toFixed(2)}</strong>
              </div>

              {error && <p className="quo-error">{error}</p>}

              <div className="quo-modal-actions">
                <button type="button" className="quo-cancel-btn" onClick={closeModal}>
                  Cancel
                </button>
                <button type="submit" className="quo-add-btn" disabled={saving}>
                  {saving ? <span className="quo-spinner" /> : editingQuote ? "Save changes" : "Create quote"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast && (
        <div className={`quo-toast quo-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "—"} {toast.text}
        </div>
      )}
    </div>
  );
}

export default Quotes;