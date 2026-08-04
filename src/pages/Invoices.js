import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import { generateNumber } from "../lib/numbering";
import { notify } from "../lib/notifications";
import { generateInvoicePdf, downloadPdf, pdfToBase64 } from "../lib/pdfGenerator";
import { sendDocumentEmail } from "../lib/sendDocument";
import AppNav from "../components/AppNav";
import "./Invoices.css";

const STATUSES = ["unpaid", "paid", "overdue"];
const SEND_COOLDOWN_MS = 30000;
const ATTACHMENT_BUCKET = "invoice-attachments";

function emptyLineItem() {
  return { description: "", quantity: 1, unit_price: 0 };
}

function calcTotal(items) {
  return items.reduce(
    (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
    0
  );
}

function formatDueDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function isPastDue(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

function toCsvValue(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows, filename) {
  const csv = rows.map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

let toastIdSeq = 0;

function Invoices({ business, appUser }) {
  const [invoices, setInvoices] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
  const [form, setForm] = useState({ customer_id: "", status: "unpaid", due_date: "" });
  const [lineItems, setLineItems] = useState([emptyLineItem()]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState(null);
  const [cooldownIds, setCooldownIds] = useState({});
  const cooldownTimers = useRef({});

  // search / filter / sort
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortField, setSortField] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // attachments
  const [attachments, setAttachments] = useState([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const fileInputRef = useRef(null);

  // toasts
  const [toasts, setToasts] = useState([]);

  const pushToast = useCallback((message, variant = "success") => {
    const id = ++toastIdSeq;
    setToasts((prev) => [...prev, { id, message, variant, leaving: false }]);
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    }, 3200);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("invoices")
      .select("*, customers(name, email), quotes(quote_number), invoice_attachments(id)")
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

  // ---------- filtering / sorting ----------
  const filteredInvoices = useMemo(() => {
    let rows = [...invoices];
    const term = searchTerm.trim().toLowerCase();

    if (term) {
      rows = rows.filter((inv) => {
        return (
          inv.invoice_number?.toLowerCase().includes(term) ||
          inv.customers?.name?.toLowerCase().includes(term) ||
          inv.quotes?.quote_number?.toLowerCase().includes(term)
        );
      });
    }

    if (statusFilter !== "all") {
      rows = rows.filter((inv) => inv.status === statusFilter);
    }

    if (dateFrom) {
      rows = rows.filter((inv) => inv.due_date && inv.due_date >= dateFrom);
    }
    if (dateTo) {
      rows = rows.filter((inv) => inv.due_date && inv.due_date <= dateTo);
    }

    rows.sort((a, b) => {
      let av, bv;
      switch (sortField) {
        case "invoice_number":
          av = a.invoice_number || "";
          bv = b.invoice_number || "";
          break;
        case "customer":
          av = a.customers?.name || "";
          bv = b.customers?.name || "";
          break;
        case "status":
          av = a.status || "";
          bv = b.status || "";
          break;
        case "due_date":
          av = a.due_date || "";
          bv = b.due_date || "";
          break;
        case "total":
          av = Number(a.total) || 0;
          bv = Number(b.total) || 0;
          break;
        default:
          av = a.created_at || "";
          bv = b.created_at || "";
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });

    return rows;
  }, [invoices, searchTerm, statusFilter, dateFrom, dateTo, sortField, sortDir]);

  const hasActiveFilters =
    searchTerm || statusFilter !== "all" || dateFrom || dateTo;

  const clearFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const toggleSort = (field) => {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  const sortArrow = (field) =>
    sortField === field ? (sortDir === "asc" ? "▲" : "▼") : "";

  // ---------- stats ----------
  const stats = useMemo(() => {
    const total = invoices.reduce((s, i) => s + Number(i.total || 0), 0);
    const outstanding = invoices
      .filter((i) => i.status !== "paid")
      .reduce((s, i) => s + Number(i.total || 0), 0);
    const overdue = invoices.filter(
      (i) => i.status !== "paid" && isPastDue(i.due_date)
    );
    const overdueTotal = overdue.reduce((s, i) => s + Number(i.total || 0), 0);
    const paidCount = invoices.filter((i) => i.status === "paid").length;
    return {
      total,
      outstanding,
      overdueCount: overdue.length,
      overdueTotal,
      paidCount,
      totalCount: invoices.length,
    };
  }, [invoices]);

  // ---------- selection ----------
  const allVisibleSelected =
    filteredInvoices.length > 0 &&
    filteredInvoices.every((inv) => selectedIds.has(inv.id));

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredInvoices.forEach((inv) => next.delete(inv.id));
        return next;
      }
      const next = new Set(prev);
      filteredInvoices.forEach((inv) => next.add(inv.id));
      return next;
    });
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // ---------- modal ----------
  const openAddModal = () => {
    setEditingInvoice(null);
    setForm({ customer_id: "", status: "unpaid", due_date: "" });
    setLineItems([emptyLineItem()]);
    setAttachments([]);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = async (invoice) => {
    setEditingInvoice(invoice);
    setForm({
      customer_id: invoice.customer_id || "",
      status: invoice.status,
      due_date: invoice.due_date || "",
    });
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

    const { data: files } = await supabase
      .from("invoice_attachments")
      .select("*")
      .eq("invoice_id", invoice.id)
      .order("uploaded_at", { ascending: false });
    setAttachments(files || []);

    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingInvoice(null);
    setAttachments([]);
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
        .update({
          customer_id: form.customer_id,
          status: form.status,
          due_date: form.due_date || null,
          total,
        })
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
      pushToast(`Invoice ${editingInvoice.invoice_number} updated.`);
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
          due_date: form.due_date || null,
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
      pushToast(`Invoice ${invoiceNumber} created.`);
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
      pushToast(`Invoice ${invoice.invoice_number} deleted.`);
      clearSelection();
      fetchInvoices();
    } else {
      pushToast(`Failed to delete: ${deleteError.message}`, "error");
    }
  };

  const handleMarkPaid = async (invoice) => {
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ status: "paid" })
      .eq("id", invoice.id);
    if (!updateError) {
      notify(business.id, appUser?.id, `Invoice ${invoice.invoice_number} was marked as paid.`);
      pushToast(`Invoice ${invoice.invoice_number} marked as paid.`);
      fetchInvoices();
    } else {
      pushToast(`Failed: ${updateError.message}`, "error");
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
        publicToken: invoice.public_token,
      });

      notify(business.id, appUser?.id, `Invoice ${invoice.invoice_number} was emailed to ${fullCustomer.name}.`);
      pushToast(`Invoice ${invoice.invoice_number} sent to ${fullCustomer.name}.`);
    } catch (err) {
      pushToast(`Failed to send: ${err.message}`, "error");
    } finally {
      setSendingId(null);
      startCooldown(invoice.id);
    }
  };

  // ---------- duplicate ----------
  const handleDuplicate = async (invoice) => {
    const { data: items } = await supabase
      .from("invoice_line_items")
      .select("*")
      .eq("invoice_id", invoice.id);

    let invoiceNumber;
    try {
      invoiceNumber = await generateNumber(business.id, "invoice");
    } catch (numError) {
      pushToast(`Couldn't duplicate: ${numError.message}`, "error");
      return;
    }

    const { data: inserted, error: insertError } = await supabase
      .from("invoices")
      .insert({
        business_id: business.id,
        customer_id: invoice.customer_id,
        quote_id: null,
        invoice_number: invoiceNumber,
        status: "unpaid",
        due_date: null,
        total: invoice.total,
      })
      .select()
      .single();

    if (insertError) {
      pushToast(`Couldn't duplicate: ${insertError.message}`, "error");
      return;
    }

    if (items && items.length > 0) {
      const { error: itemsError } = await supabase.from("invoice_line_items").insert(
        items.map((i) => ({
          invoice_id: inserted.id,
          description: i.description,
          quantity: i.quantity,
          unit_price: i.unit_price,
        }))
      );
      if (itemsError) {
        pushToast(`Duplicated, but line items failed: ${itemsError.message}`, "error");
        fetchInvoices();
        return;
      }
    }

    pushToast(`Duplicated as ${invoiceNumber} (draft, unpaid).`);
    notify(business.id, appUser?.id, `Invoice ${invoiceNumber} was created as a duplicate of ${invoice.invoice_number}.`);
    fetchInvoices();
  };

  // ---------- attachments ----------
  const handleUploadAttachment = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !editingInvoice) return;

    setUploadingAttachment(true);
    const path = `${business.id}/${editingInvoice.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, file);

    if (uploadError) {
      pushToast(`Upload failed: ${uploadError.message}`, "error");
      setUploadingAttachment(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const { data: row, error: insertError } = await supabase
      .from("invoice_attachments")
      .insert({
        invoice_id: editingInvoice.id,
        file_name: file.name,
        file_path: path,
      })
      .select()
      .single();

    if (insertError) {
      pushToast(`Upload saved but record failed: ${insertError.message}`, "error");
    } else {
      setAttachments((prev) => [row, ...prev]);
      pushToast("Attachment uploaded.");
    }

    setUploadingAttachment(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const getAttachmentUrl = (filePath) => {
    const { data } = supabase.storage.from(ATTACHMENT_BUCKET).getPublicUrl(filePath);
    return data?.publicUrl;
  };

  const handleRemoveAttachment = async (attachment) => {
    if (!window.confirm(`Remove ${attachment.file_name}?`)) return;
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.file_path]);
    const { error: deleteError } = await supabase
      .from("invoice_attachments")
      .delete()
      .eq("id", attachment.id);
    if (!deleteError) {
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id));
      pushToast("Attachment removed.");
    }
  };

  // ---------- bulk actions ----------
  const selectedInvoices = useMemo(
    () => invoices.filter((inv) => selectedIds.has(inv.id)),
    [invoices, selectedIds]
  );

  const handleBulkMarkPaid = async () => {
    setBulkBusy(true);
    const ids = Array.from(selectedIds);
    const { error: updateError } = await supabase
      .from("invoices")
      .update({ status: "paid" })
      .in("id", ids);
    setBulkBusy(false);
    if (!updateError) {
      pushToast(`${ids.length} invoice${ids.length === 1 ? "" : "s"} marked as paid.`);
      notify(business.id, appUser?.id, `${ids.length} invoices were marked as paid.`);
      clearSelection();
      fetchInvoices();
    } else {
      pushToast(`Bulk update failed: ${updateError.message}`, "error");
    }
  };

  const handleBulkExport = () => {
    const rows = [
      ["Invoice #", "Quote #", "Customer", "Status", "Due Date", "Total"],
      ...selectedInvoices.map((inv) => [
        inv.invoice_number,
        inv.quotes?.quote_number || "",
        inv.customers?.name || "",
        inv.status,
        inv.due_date || "",
        Number(inv.total).toFixed(2),
      ]),
    ];
    downloadCsv(rows, `invoices-export-${new Date().toISOString().slice(0, 10)}.csv`);
    pushToast(`Exported ${selectedInvoices.length} invoice${selectedInvoices.length === 1 ? "" : "s"}.`);
  };

  const handleBulkSend = async () => {
    setBulkBusy(true);
    let sent = 0;
    let failed = 0;

    for (const invoice of selectedInvoices) {
      if (cooldownIds[invoice.id]) continue;
      const { data: fullCustomer } = await supabase
        .from("customers")
        .select("name, email")
        .eq("id", invoice.customer_id)
        .single();

      if (!fullCustomer?.email) {
        failed++;
        continue;
      }

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
          publicToken: invoice.public_token,
        });
        sent++;
        startCooldown(invoice.id);
      } catch {
        failed++;
      }
    }

    setBulkBusy(false);
    pushToast(
      `Sent ${sent} invoice${sent === 1 ? "" : "s"}${failed ? `, ${failed} failed` : ""}.`,
      failed ? "error" : "success"
    );
    clearSelection();
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    if (!window.confirm(`Delete ${ids.length} invoice${ids.length === 1 ? "" : "s"}? This can't be undone.`)) return;
    setBulkBusy(true);
    const { error: deleteError } = await supabase.from("invoices").delete().in("id", ids);
    setBulkBusy(false);
    if (!deleteError) {
      pushToast(`${ids.length} invoice${ids.length === 1 ? "" : "s"} deleted.`);
      notify(business.id, appUser?.id, `${ids.length} invoices were deleted.`);
      clearSelection();
      fetchInvoices();
    } else {
      pushToast(`Bulk delete failed: ${deleteError.message}`, "error");
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

        {!loading && invoices.length > 0 && (
          <div className="inv-stats">
            <div className="inv-stat-card inv-stat-card--total">
              <p className="inv-stat-label">Total invoiced</p>
              <p className="inv-stat-value">R{stats.total.toFixed(2)}</p>
              <p className="inv-stat-sub">{stats.totalCount} invoices</p>
            </div>
            <div className="inv-stat-card inv-stat-card--outstanding">
              <p className="inv-stat-label">Outstanding</p>
              <p className="inv-stat-value">R{stats.outstanding.toFixed(2)}</p>
              <p className="inv-stat-sub">Unpaid + overdue</p>
            </div>
            <div className="inv-stat-card inv-stat-card--overdue">
              <p className="inv-stat-label">Overdue</p>
              <p className="inv-stat-value">R{stats.overdueTotal.toFixed(2)}</p>
              <p className="inv-stat-sub">{stats.overdueCount} invoices</p>
            </div>
            <div className="inv-stat-card inv-stat-card--paid">
              <p className="inv-stat-label">Paid</p>
              <p className="inv-stat-value">{stats.paidCount}</p>
              <p className="inv-stat-sub">of {stats.totalCount} invoices</p>
            </div>
          </div>
        )}

        {!loading && invoices.length > 0 && (
          <div className="inv-toolbar">
            <div className="inv-search-wrap">
              <span className="inv-search-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
              </span>
              <input
                className="inv-search-input"
                placeholder="Search invoice #, customer, quote #..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="inv-filter-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <input
              className="inv-filter-select"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              title="Due date from"
            />
            <input
              className="inv-filter-select"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              title="Due date to"
            />
            {hasActiveFilters && (
              <button className="inv-clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}

        {selectedIds.size > 0 && (
          <div className="inv-bulk-bar">
            <span className="inv-bulk-count">
              {selectedIds.size} selected
            </span>
            <div className="inv-bulk-actions">
              <button className="inv-bulk-btn" onClick={handleBulkMarkPaid} disabled={bulkBusy}>
                Mark paid
              </button>
              <button className="inv-bulk-btn" onClick={handleBulkSend} disabled={bulkBusy}>
                Send
              </button>
              <button className="inv-bulk-btn" onClick={handleBulkExport} disabled={bulkBusy}>
                Export CSV
              </button>
              <button className="inv-bulk-btn inv-bulk-btn--danger" onClick={handleBulkDelete} disabled={bulkBusy}>
                Delete
              </button>
              <button className="inv-bulk-btn" onClick={clearSelection} disabled={bulkBusy}>
                Clear
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="inv-muted">Loading...</p>
        ) : invoices.length === 0 ? (
          <div className="inv-empty">
            No invoices yet. Create one directly or convert an accepted quote.
          </div>
        ) : filteredInvoices.length === 0 ? (
          <div className="inv-empty">
            No invoices match your filters.
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th className="inv-th-checkbox">
                    <input
                      type="checkbox"
                      className="inv-checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                    />
                  </th>
                  <th className="inv-th-sortable" onClick={() => toggleSort("invoice_number")}>
                    Invoice # <span className="inv-sort-arrow">{sortArrow("invoice_number")}</span>
                  </th>
                  <th>Quote #</th>
                  <th className="inv-th-sortable" onClick={() => toggleSort("customer")}>
                    Customer <span className="inv-sort-arrow">{sortArrow("customer")}</span>
                  </th>
                  <th className="inv-th-sortable" onClick={() => toggleSort("status")}>
                    Status <span className="inv-sort-arrow">{sortArrow("status")}</span>
                  </th>
                  <th className="inv-th-sortable" onClick={() => toggleSort("due_date")}>
                    Due date <span className="inv-sort-arrow">{sortArrow("due_date")}</span>
                  </th>
                  <th className="inv-th-sortable" onClick={() => toggleSort("total")}>
                    Total <span className="inv-sort-arrow">{sortArrow("total")}</span>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((inv, idx) => (
                  <tr
                    key={inv.id}
                    className={selectedIds.has(inv.id) ? "inv-row-selected" : ""}
                    style={{ animationDelay: `${Math.min(idx * 0.02, 0.3)}s` }}
                  >
                    <td>
                      <input
                        type="checkbox"
                        className="inv-checkbox"
                        checked={selectedIds.has(inv.id)}
                        onChange={() => toggleSelectOne(inv.id)}
                      />
                    </td>
                    <td className="inv-name-cell">
                      {inv.invoice_number}
                      {inv.invoice_attachments?.length > 0 && (
                        <span className="inv-attach-badge" title={`${inv.invoice_attachments.length} attachment(s)`}>
                          📎{inv.invoice_attachments.length}
                        </span>
                      )}
                    </td>
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
                    <td
                      className={
                        inv.status !== "paid" && isPastDue(inv.due_date)
                          ? "inv-due-overdue"
                          : inv.due_date
                          ? ""
                          : "inv-muted"
                      }
                    >
                      {formatDueDate(inv.due_date)}
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
                        <button className="inv-action-btn" onClick={() => handleDuplicate(inv)}>
                          Duplicate
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

              <label className="inv-label">Due date (optional)</label>
              <input
                className="inv-input"
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              />

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

              {editingInvoice && (
                <div className="inv-attach-section">
                  <label className="inv-label">Attachments (proof of payment, etc.)</label>
                  {attachments.length > 0 && (
                    <div className="inv-attach-list">
                      {attachments.map((att) => (
                        <div className="inv-attach-item" key={att.id}>
                          <a href={getAttachmentUrl(att.file_path)} target="_blank" rel="noreferrer">
                            📎 {att.file_name}
                          </a>
                          <button
                            type="button"
                            className="inv-attach-remove"
                            onClick={() => handleRemoveAttachment(att)}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: "none" }}
                    onChange={handleUploadAttachment}
                  />
                  <button
                    type="button"
                    className="inv-attach-upload-btn"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingAttachment}
                  >
                    {uploadingAttachment ? "Uploading..." : "+ Upload file"}
                  </button>
                </div>
              )}

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

      <div className="inv-toast-stack">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`inv-toast${t.variant === "error" ? " inv-toast--error" : ""}${t.leaving ? " inv-toast--leaving" : ""}`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default Invoices;