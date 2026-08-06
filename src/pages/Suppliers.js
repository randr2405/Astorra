import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Suppliers.css";

const PO_STATUS_OPTIONS = ["draft", "ordered", "partially_received", "received", "cancelled", "overdue"];
const PO_STATUS_LABEL = {
  draft: "Draft",
  ordered: "Ordered",
  partially_received: "Partially received",
  received: "Received",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

const emptySupplierForm = { name: "", contact_name: "", email: "", phone: "", notes: "" };

const emptyPoForm = {
  supplier_id: "",
  expected_date: "",
  notes: "",
  line_items: [{ description: "", quantity_ordered: "1", unit_cost: "" }],
};

export default function Suppliers({ business }) {
  const [tab, setTab] = useState("suppliers"); // suppliers | orders
  const [mounted, setMounted] = useState(false);

  // ---- suppliers state ----
  const [suppliers, setSuppliers] = useState([]);
  const [suppliersLoading, setSuppliersLoading] = useState(true);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [supplierForm, setSupplierForm] = useState(emptySupplierForm);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierFormError, setSupplierFormError] = useState("");
  const [confirmDeleteSupplierId, setConfirmDeleteSupplierId] = useState(null);

  // ---- purchase orders state ----
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [orderStatusFilter, setOrderStatusFilter] = useState("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [showPoModal, setShowPoModal] = useState(false);
  const [poForm, setPoForm] = useState(emptyPoForm);
  const [savingPo, setSavingPo] = useState(false);
  const [poFormError, setPoFormError] = useState("");
  const [confirmDeletePoId, setConfirmDeletePoId] = useState(null);
  const [selectedPo, setSelectedPo] = useState(null);
  const [selectedPoLines, setSelectedPoLines] = useState([]);
  const [poDetailLoading, setPoDetailLoading] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const [toast, setToast] = useState(null);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  // ---- loaders ----
  const loadSuppliers = useCallback(async () => {
    setSuppliersLoading(true);
    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("business_id", business.id)
      .order("name", { ascending: true });
    if (!error) setSuppliers(data || []);
    setSuppliersLoading(false);
  }, [business.id]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    const { data, error } = await supabase
      .from("purchase_orders")
      .select("*, suppliers(name)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });
    if (!error) setOrders(data || []);
    setOrdersLoading(false);
  }, [business.id]);

  useEffect(() => {
    loadSuppliers();
    loadOrders();
  }, [loadSuppliers, loadOrders]);

  useEffect(() => {
    setMounted(true);
  }, []);

  function supplierName(id) {
    return suppliers.find((s) => s.id === id)?.name || "—";
  }

  function isPoOverdue(po) {
    return (
      po.expected_date &&
      !["received", "cancelled"].includes(po.status) &&
      new Date(po.expected_date) < new Date(new Date().toDateString())
    );
  }

  // ---- derived: suppliers ----
  const filteredSuppliers = useMemo(() => {
    let list = [...suppliers];
    if (supplierSearch.trim()) {
      const q = supplierSearch.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.contact_name || "").toLowerCase().includes(q) ||
          (s.email || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [suppliers, supplierSearch]);

  const orderCountBySupplier = useMemo(() => {
    const counts = {};
    orders.forEach((o) => {
      counts[o.supplier_id] = (counts[o.supplier_id] || 0) + 1;
    });
    return counts;
  }, [orders]);

  // ---- derived: orders ----
  const filteredOrders = useMemo(() => {
    let list = [...orders];
    if (orderStatusFilter !== "all") {
      list = list.filter((o) => o.status === orderStatusFilter);
    }
    if (orderSearch.trim()) {
      const q = orderSearch.trim().toLowerCase();
      list = list.filter(
        (o) =>
          o.po_number.toLowerCase().includes(q) ||
          (o.suppliers?.name || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [orders, orderStatusFilter, orderSearch]);

  const orderStatusCounts = useMemo(() => {
    const counts = { all: orders.length };
    PO_STATUS_OPTIONS.forEach((s) => {
      counts[s] = orders.filter((o) => o.status === s).length;
    });
    return counts;
  }, [orders]);

  const outstandingTotal = useMemo(
    () =>
      orders
        .filter((o) => !["received", "cancelled"].includes(o.status))
        .reduce((sum, o) => sum + Number(o.total || 0), 0),
    [orders]
  );

  // ---- supplier CRUD ----
  function openAddSupplier() {
    setEditingSupplier(null);
    setSupplierForm(emptySupplierForm);
    setSupplierFormError("");
    setShowSupplierModal(true);
  }

  function openEditSupplier(supplier) {
    setEditingSupplier(supplier);
    setSupplierForm({
      name: supplier.name || "",
      contact_name: supplier.contact_name || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      notes: supplier.notes || "",
    });
    setSupplierFormError("");
    setShowSupplierModal(true);
  }

  async function handleSaveSupplier(e) {
    e.preventDefault();
    if (!supplierForm.name.trim()) {
      setSupplierFormError("Supplier name is required.");
      return;
    }
    setSavingSupplier(true);
    setSupplierFormError("");

    const payload = {
      business_id: business.id,
      name: supplierForm.name.trim(),
      contact_name: supplierForm.contact_name.trim() || null,
      email: supplierForm.email.trim() || null,
      phone: supplierForm.phone.trim() || null,
      notes: supplierForm.notes.trim() || null,
    };

    let error;
    if (editingSupplier) {
      ({ error } = await supabase.from("suppliers").update(payload).eq("id", editingSupplier.id));
    } else {
      ({ error } = await supabase.from("suppliers").insert(payload));
    }

    setSavingSupplier(false);
    if (error) {
      setSupplierFormError(error.message);
      return;
    }
    setShowSupplierModal(false);
    showToast(editingSupplier ? "Supplier updated" : "Supplier added");
    loadSuppliers();
  }

  async function handleDeleteSupplier(id) {
    const { error } = await supabase.from("suppliers").delete().eq("id", id);
    setConfirmDeleteSupplierId(null);
    if (!error) {
      showToast("Supplier removed");
      loadSuppliers();
    }
  }

  // ---- purchase order CRUD ----
  function openAddPo() {
    setPoForm({ ...emptyPoForm, supplier_id: suppliers[0]?.id || "" });
    setPoFormError("");
    setShowPoModal(true);
  }

  function updateLineItem(index, field, value) {
    setPoForm((prev) => {
      const line_items = [...prev.line_items];
      line_items[index] = { ...line_items[index], [field]: value };
      return { ...prev, line_items };
    });
  }

  function addLineItem() {
    setPoForm((prev) => ({
      ...prev,
      line_items: [...prev.line_items, { description: "", quantity_ordered: "1", unit_cost: "" }],
    }));
  }

  function removeLineItem(index) {
    setPoForm((prev) => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== index),
    }));
  }

  const poFormTotal = useMemo(() => {
    return poForm.line_items.reduce((sum, li) => {
      const qty = Number(li.quantity_ordered) || 0;
      const cost = Number(li.unit_cost) || 0;
      return sum + qty * cost;
    }, 0);
  }, [poForm.line_items]);

  async function handleSavePo(e) {
    e.preventDefault();

    if (!poForm.supplier_id) {
      setPoFormError("Choose a supplier.");
      return;
    }
    const validLines = poForm.line_items.filter((li) => li.description.trim());
    if (validLines.length === 0) {
      setPoFormError("Add at least one line item.");
      return;
    }

    setSavingPo(true);
    setPoFormError("");

    const { data: nextNumber, error: numError } = await supabase.rpc("get_next_number", {
      p_business_id: business.id,
      p_counter_key: "purchase_order",
    });

    if (numError) {
      setSavingPo(false);
      setPoFormError(numError.message);
      return;
    }

    const { data: po, error: poError } = await supabase
      .from("purchase_orders")
      .insert({
        business_id: business.id,
        supplier_id: poForm.supplier_id,
        po_number: `PO-${String(nextNumber).padStart(4, "0")}`,
        status: "ordered",
        total: poFormTotal,
        expected_date: poForm.expected_date || null,
        notes: poForm.notes.trim() || null,
      })
      .select()
      .single();

    if (poError) {
      setSavingPo(false);
      setPoFormError(poError.message);
      return;
    }

    const lineRows = validLines.map((li) => ({
      purchase_order_id: po.id,
      description: li.description.trim(),
      quantity_ordered: Number(li.quantity_ordered) || 1,
      unit_cost: Number(li.unit_cost) || 0,
    }));

    const { error: linesError } = await supabase.from("purchase_order_line_items").insert(lineRows);

    setSavingPo(false);

    if (linesError) {
      setPoFormError(linesError.message);
      return;
    }

    setShowPoModal(false);
    showToast("Purchase order created");
    loadOrders();
  }

  async function handleDeletePo(id) {
    const { error } = await supabase.from("purchase_orders").delete().eq("id", id);
    setConfirmDeletePoId(null);
    if (!error) {
      showToast("Purchase order removed");
      loadOrders();
      if (selectedPo?.id === id) setSelectedPo(null);
    }
  }

  async function openPoDetail(po) {
    setSelectedPo(po);
    setPoDetailLoading(true);
    const { data } = await supabase
      .from("purchase_order_line_items")
      .select("*")
      .eq("purchase_order_id", po.id);
    setSelectedPoLines(data || []);
    setPoDetailLoading(false);
  }

  async function handleCancelPo() {
    if (!selectedPo) return;
    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: "cancelled" })
      .eq("id", selectedPo.id);
    if (!error) {
      showToast("Purchase order cancelled");
      setSelectedPo({ ...selectedPo, status: "cancelled" });
      loadOrders();
    }
  }

  // Marks every line item fully received, bumps matching inventory_items
  // quantities, and flips the PO to received.
  async function handleMarkReceived() {
    if (!selectedPo) return;
    setReceiving(true);

    for (const line of selectedPoLines) {
      const remaining = Number(line.quantity_ordered) - Number(line.quantity_received);
      if (remaining <= 0) continue;

      await supabase
        .from("purchase_order_line_items")
        .update({ quantity_received: line.quantity_ordered })
        .eq("id", line.id);

      if (line.inventory_item_id) {
        const { data: item } = await supabase
          .from("inventory_items")
          .select("quantity")
          .eq("id", line.inventory_item_id)
          .maybeSingle();
        if (item) {
          await supabase
            .from("inventory_items")
            .update({ quantity: Number(item.quantity) + remaining })
            .eq("id", line.inventory_item_id);
        }
      }
    }

    const { error } = await supabase
      .from("purchase_orders")
      .update({ status: "received", received_at: new Date().toISOString() })
      .eq("id", selectedPo.id);

    setReceiving(false);

    if (!error) {
      showToast("Marked as received");
      setSelectedPo({ ...selectedPo, status: "received" });
      loadOrders();
      openPoDetail({ ...selectedPo, status: "received" });
    }
  }

  return (
    <div className="sup-page">
      <div className="sup-body">
        <div className={`sup-header ${mounted ? "sup-in" : ""}`}>
          <div>
            <p className="sup-eyebrow">Finance</p>
            <h1 className="sup-heading">Purchase Orders / Suppliers</h1>
          </div>
          <div className="sup-header-actions">
            {tab === "suppliers" ? (
              <button className="sup-add-btn" onClick={openAddSupplier}>
                + Add supplier
              </button>
            ) : (
              <button className="sup-add-btn" onClick={openAddPo} disabled={suppliers.length === 0}>
                + New purchase order
              </button>
            )}
          </div>
        </div>

        <div className={`sup-stats ${mounted ? "sup-in" : ""}`}>
          <div className="sup-stat-card">
            <p className="sup-stat-label">Suppliers</p>
            <p className="sup-stat-value">{suppliers.length}</p>
          </div>
          <div className="sup-stat-card">
            <p className="sup-stat-label">Open purchase orders</p>
            <p className="sup-stat-value">
              {orders.filter((o) => !["received", "cancelled"].includes(o.status)).length}
            </p>
          </div>
          <div className="sup-stat-card">
            <p className="sup-stat-label">Outstanding value</p>
            <p className="sup-stat-value">R{outstandingTotal.toFixed(2)}</p>
          </div>
        </div>

        <div className={`sup-tabs ${mounted ? "sup-in" : ""}`}>
          <button
            className={`sup-tab-btn ${tab === "suppliers" ? "sup-tab-btn--active" : ""}`}
            onClick={() => setTab("suppliers")}
          >
            Suppliers
          </button>
          <button
            className={`sup-tab-btn ${tab === "orders" ? "sup-tab-btn--active" : ""}`}
            onClick={() => setTab("orders")}
          >
            Purchase orders
          </button>
        </div>

        {tab === "suppliers" ? (
          <>
            {!suppliersLoading && suppliers.length === 0 ? (
              <div className="sup-empty">
                No suppliers yet.{" "}
                <button className="sup-inline-link" onClick={openAddSupplier}>
                  Add your first one
                </button>
              </div>
            ) : (
              <>
                <div className="sup-toolbar">
                  <div className="sup-search-wrap">
                    <svg
                      className="sup-search-icon"
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      className="sup-search-input"
                      placeholder="Search suppliers..."
                      value={supplierSearch}
                      onChange={(e) => setSupplierSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="sup-table-wrap">
                  {suppliersLoading ? (
                    <div className="sup-skeleton">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="sup-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                  ) : (
                    <table className="sup-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Contact</th>
                          <th>Email</th>
                          <th>Phone</th>
                          <th>Purchase orders</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSuppliers.map((s, i) => (
                          <tr key={s.id} className="sup-row" style={{ animationDelay: `${i * 0.03}s` }}>
                            <td className="sup-name-cell">{s.name}</td>
                            <td className="sup-muted">{s.contact_name || "—"}</td>
                            <td className="sup-muted">{s.email || "—"}</td>
                            <td className="sup-muted">{s.phone || "—"}</td>
                            <td className="sup-muted">{orderCountBySupplier[s.id] || 0}</td>
                            <td className="sup-actions-cell">
                              {confirmDeleteSupplierId === s.id ? (
                                <div className="sup-confirm-row">
                                  Delete?
                                  <button className="sup-confirm-yes" onClick={() => handleDeleteSupplier(s.id)}>
                                    Yes
                                  </button>
                                  <button
                                    className="sup-confirm-no"
                                    onClick={() => setConfirmDeleteSupplierId(null)}
                                  >
                                    No
                                  </button>
                                </div>
                              ) : (
                                <>
                                  <button className="sup-action-btn" onClick={() => openEditSupplier(s)}>
                                    Edit
                                  </button>
                                  <button
                                    className="sup-action-btn sup-action-btn--danger"
                                    onClick={() => setConfirmDeleteSupplierId(s.id)}
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
          </>
        ) : (
          <>
            {!ordersLoading && orders.length === 0 ? (
              <div className="sup-empty">
                {suppliers.length === 0 ? (
                  <>
                    Add a supplier first, then create your first purchase order.
                  </>
                ) : (
                  <>
                    No purchase orders yet.{" "}
                    <button className="sup-inline-link" onClick={openAddPo}>
                      Create one
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="sup-toolbar">
                  <div className="sup-filters">
                    <button
                      className={`sup-filter-btn ${orderStatusFilter === "all" ? "sup-filter-btn--active" : ""}`}
                      onClick={() => setOrderStatusFilter("all")}
                    >
                      All <span className="sup-filter-count">{orderStatusCounts.all}</span>
                    </button>
                    {PO_STATUS_OPTIONS.map((s) => (
                      <button
                        key={s}
                        className={`sup-filter-btn ${orderStatusFilter === s ? "sup-filter-btn--active" : ""}`}
                        onClick={() => setOrderStatusFilter(s)}
                      >
                        {PO_STATUS_LABEL[s]} <span className="sup-filter-count">{orderStatusCounts[s]}</span>
                      </button>
                    ))}
                  </div>

                  <div className="sup-toolbar-right">
                    <div className="sup-search-wrap">
                      <svg
                        className="sup-search-icon"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        className="sup-search-input"
                        placeholder="Search PO # or supplier..."
                        value={orderSearch}
                        onChange={(e) => setOrderSearch(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="sup-table-wrap">
                  {ordersLoading ? (
                    <div className="sup-skeleton">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="sup-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                  ) : (
                    <table className="sup-table">
                      <thead>
                        <tr>
                          <th>PO #</th>
                          <th>Supplier</th>
                          <th>Status</th>
                          <th>Expected</th>
                          <th>Total</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOrders.map((po, i) => (
                          <tr
                            key={po.id}
                            className="sup-row"
                            style={{ animationDelay: `${i * 0.03}s` }}
                            onClick={() => openPoDetail(po)}
                          >
                            <td className="sup-name-cell">{po.po_number}</td>
                            <td className="sup-muted">{po.suppliers?.name || supplierName(po.supplier_id)}</td>
                            <td>
                              <span className={`sup-status sup-status--${po.status}`}>
                                {PO_STATUS_LABEL[po.status]}
                              </span>
                            </td>
                            <td className={isPoOverdue(po) ? "sup-overdue-cell" : "sup-muted"}>
                              {po.expected_date || "—"}
                            </td>
                            <td className="sup-muted">R{Number(po.total).toFixed(2)}</td>
                            <td className="sup-actions-cell" onClick={(e) => e.stopPropagation()}>
                              {confirmDeletePoId === po.id ? (
                                <div className="sup-confirm-row">
                                  Delete?
                                  <button className="sup-confirm-yes" onClick={() => handleDeletePo(po.id)}>
                                    Yes
                                  </button>
                                  <button className="sup-confirm-no" onClick={() => setConfirmDeletePoId(null)}>
                                    No
                                  </button>
                                </div>
                              ) : (
                                <button
                                  className="sup-action-btn sup-action-btn--danger"
                                  onClick={() => setConfirmDeletePoId(po.id)}
                                >
                                  Delete
                                </button>
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
          </>
        )}
      </div>

      {/* Add / edit supplier modal */}
      {showSupplierModal && (
        <div className="sup-modal-overlay" onClick={() => setShowSupplierModal(false)}>
          <div className="sup-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingSupplier ? "Edit supplier" : "Add supplier"}</h2>
            <form onSubmit={handleSaveSupplier}>
              <label className="sup-label">Name</label>
              <input
                className="sup-input"
                value={supplierForm.name}
                onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })}
                placeholder="e.g. Coastal Timber Supplies"
              />

              <div className="sup-input-row">
                <div>
                  <label className="sup-label">Contact name</label>
                  <input
                    className="sup-input"
                    value={supplierForm.contact_name}
                    onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="sup-label">Phone</label>
                  <input
                    className="sup-input"
                    value={supplierForm.phone}
                    onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })}
                  />
                </div>
              </div>

              <label className="sup-label">Email</label>
              <input
                className="sup-input"
                type="email"
                value={supplierForm.email}
                onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
              />

              <label className="sup-label">Notes</label>
              <textarea
                className="sup-input"
                rows={3}
                value={supplierForm.notes}
                onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })}
              />

              {supplierFormError && <p className="sup-error">{supplierFormError}</p>}

              <div className="sup-modal-actions">
                <button type="button" className="sup-cancel-btn" onClick={() => setShowSupplierModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="sup-add-btn" disabled={savingSupplier}>
                  {savingSupplier ? (
                    <span className="sup-spinner" />
                  ) : editingSupplier ? (
                    "Save changes"
                  ) : (
                    "Add supplier"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New purchase order modal */}
      {showPoModal && (
        <div className="sup-modal-overlay" onClick={() => setShowPoModal(false)}>
          <div className="sup-modal sup-modal--wide" onClick={(e) => e.stopPropagation()}>
            <h2>New purchase order</h2>
            <form onSubmit={handleSavePo}>
              <div className="sup-input-row">
                <div>
                  <label className="sup-label">Supplier</label>
                  <select
                    className="sup-input sup-input--select"
                    value={poForm.supplier_id}
                    onChange={(e) => setPoForm({ ...poForm, supplier_id: e.target.value })}
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="sup-label">Expected date</label>
                  <input
                    type="date"
                    className="sup-input"
                    value={poForm.expected_date}
                    onChange={(e) => setPoForm({ ...poForm, expected_date: e.target.value })}
                  />
                </div>
              </div>

              <label className="sup-label">Line items</label>
              <div className="sup-line-items">
                {poForm.line_items.map((li, i) => (
                  <div className="sup-line-item-row" key={i}>
                    <input
                      className="sup-input sup-line-desc"
                      placeholder="Item description"
                      value={li.description}
                      onChange={(e) => updateLineItem(i, "description", e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      className="sup-input sup-line-qty"
                      placeholder="Qty"
                      value={li.quantity_ordered}
                      onChange={(e) => updateLineItem(i, "quantity_ordered", e.target.value)}
                    />
                    <input
                      type="number"
                      step="0.01"
                      className="sup-input sup-line-cost"
                      placeholder="Unit cost (R)"
                      value={li.unit_cost}
                      onChange={(e) => updateLineItem(i, "unit_cost", e.target.value)}
                    />
                    <button
                      type="button"
                      className="sup-line-remove"
                      onClick={() => removeLineItem(i)}
                      disabled={poForm.line_items.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" className="sup-add-row-btn" onClick={addLineItem}>
                + Add line item
              </button>

              <label className="sup-label">Notes</label>
              <textarea
                className="sup-input"
                rows={2}
                value={poForm.notes}
                onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
              />

              <div className="sup-po-total">Total: R{poFormTotal.toFixed(2)}</div>

              {poFormError && <p className="sup-error">{poFormError}</p>}

              <div className="sup-modal-actions">
                <button type="button" className="sup-cancel-btn" onClick={() => setShowPoModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="sup-add-btn" disabled={savingPo}>
                  {savingPo ? <span className="sup-spinner" /> : "Create purchase order"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO detail drawer */}
      {selectedPo && (
        <div className="sup-drawer-overlay" onClick={() => setSelectedPo(null)}>
          <div className="sup-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="sup-drawer-close" onClick={() => setSelectedPo(null)}>
              ×
            </button>
            <h2>{selectedPo.po_number}</h2>
            <p className="sup-drawer-sub">
              {selectedPo.suppliers?.name || supplierName(selectedPo.supplier_id)}
            </p>

            <div className="sup-meta-grid">
              <div className="sup-meta-item">
                <p className="sup-meta-label">Status</p>
                <p className="sup-meta-value">{PO_STATUS_LABEL[selectedPo.status]}</p>
              </div>
              <div className="sup-meta-item">
                <p className="sup-meta-label">Expected</p>
                <p className="sup-meta-value">{selectedPo.expected_date || "—"}</p>
              </div>
              <div className="sup-meta-item">
                <p className="sup-meta-label">Total</p>
                <p className="sup-meta-value">R{Number(selectedPo.total).toFixed(2)}</p>
              </div>
            </div>

            <div className="sup-section-title">Line items</div>

            {poDetailLoading ? (
              <p className="sup-log-empty">Loading...</p>
            ) : (
              <div className="sup-po-lines">
                {selectedPoLines.map((line) => (
                  <div key={line.id} className="sup-po-line">
                    <div className="sup-po-line-top">
                      <span>{line.description}</span>
                      <span className="sup-muted">
                        {line.quantity_received}/{line.quantity_ordered} received
                      </span>
                    </div>
                    <span className="sup-muted">R{Number(line.unit_cost).toFixed(2)} each</span>
                  </div>
                ))}
              </div>
            )}

            {!["received", "cancelled"].includes(selectedPo.status) && (
              <div className="sup-drawer-actions">
                <button className="sup-cancel-btn" onClick={handleCancelPo}>
                  Cancel order
                </button>
                <button className="sup-add-btn" onClick={handleMarkReceived} disabled={receiving}>
                  {receiving ? <span className="sup-spinner" /> : "Mark as received"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="sup-toast sup-toast--success">{toast}</div>}
    </div>
  );
}