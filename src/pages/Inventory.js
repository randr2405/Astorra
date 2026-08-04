import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Inventory.css";

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const UNCATEGORIZED = "Uncategorized";

function Inventory({ business, appUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form, setForm] = useState({
    name: "",
    sku: "",
    category: "",
    quantity: "",
    unit_cost: "",
    low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Search / filter / sort
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Bulk selection
  const [selected, setSelected] = useState(() => new Set());

  // Row-level quick-adjust in-flight state (for disabling buttons per row)
  const [adjusting, setAdjusting] = useState(() => new Set());

  // Import
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [importSummary, setImportSummary] = useState(null);

  // Toast-ish inline banner for row changes (lightweight, non-blocking)
  const [flashRowId, setFlashRowId] = useState(null);

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
    setForm({
      name: "",
      sku: "",
      category: "",
      quantity: "",
      unit_cost: "",
      low_stock_threshold: DEFAULT_LOW_STOCK_THRESHOLD,
    });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setForm({
      name: item.name || "",
      sku: item.sku || "",
      category: item.category || "",
      quantity: item.quantity,
      unit_cost: item.unit_cost ?? "",
      low_stock_threshold: item.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD,
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
    if (
      form.low_stock_threshold === "" ||
      isNaN(Number(form.low_stock_threshold)) ||
      Number(form.low_stock_threshold) < 0
    ) {
      return setError("Enter a valid low-stock threshold.");
    }

    setSaving(true);

    const newQuantity = Number(form.quantity);
    const threshold = Number(form.low_stock_threshold);
    const payload = {
      name: form.name,
      sku: form.sku || null,
      category: form.category.trim() || null,
      quantity: newQuantity,
      unit_cost: form.unit_cost === "" ? null : Number(form.unit_cost),
      low_stock_threshold: threshold,
    };

    if (editingItem) {
      const prevThreshold = Number(editingItem.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
      const wasAboveThreshold = Number(editingItem.quantity) > prevThreshold;
      const nowAtOrBelowThreshold = newQuantity <= threshold;

      const { error: updateError } = await supabase
        .from("inventory_items")
        .update(payload)
        .eq("id", editingItem.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }

      // Only notify the moment stock crosses into low territory, not on
      // every save while it stays low, to avoid spamming notifications.
      if (wasAboveThreshold && nowAtOrBelowThreshold) {
        notify(
          business.id,
          appUser?.id,
          `"${form.name}" is running low (${newQuantity} left, threshold ${threshold}).`
        );
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

      notify(business.id, appUser?.id, `New inventory item "${form.name}" was added.`);

      if (newQuantity <= threshold) {
        notify(
          business.id,
          appUser?.id,
          `"${form.name}" is starting off low on stock (${newQuantity} left, threshold ${threshold}).`
        );
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

  // ---------- Quick +/- stock adjust ----------
  const quickAdjust = async (item, delta) => {
    const nextQty = Number(item.quantity) + delta;
    if (nextQty < 0) return;

    setAdjusting((prev) => new Set(prev).add(item.id));

    const threshold = Number(item.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
    const wasAboveThreshold = Number(item.quantity) > threshold;
    const nowAtOrBelowThreshold = nextQty <= threshold;

    // Optimistic update
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? { ...it, quantity: nextQty } : it))
    );
    setFlashRowId(item.id);
    window.setTimeout(() => setFlashRowId((id) => (id === item.id ? null : id)), 500);

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ quantity: nextQty })
      .eq("id", item.id);

    if (updateError) {
      // revert on failure
      setItems((prev) =>
        prev.map((it) => (it.id === item.id ? { ...it, quantity: item.quantity } : it))
      );
    } else if (wasAboveThreshold && nowAtOrBelowThreshold) {
      notify(
        business.id,
        appUser?.id,
        `"${item.name}" is running low (${nextQty} left, threshold ${threshold}).`
      );
    }

    setAdjusting((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
  };

  // ---------- Derived: categories, filtering, sorting ----------
  const categories = useMemo(() => {
    const set = new Set();
    items.forEach((it) => set.add(it.category?.trim() || UNCATEGORIZED));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = items.filter((it) => {
      const threshold = Number(it.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
      const isLow = Number(it.quantity) <= threshold;
      const itemCategory = it.category?.trim() || UNCATEGORIZED;

      if (lowStockOnly && !isLow) return false;
      if (categoryFilter !== "all" && itemCategory !== categoryFilter) return false;
      if (q) {
        const inName = it.name?.toLowerCase().includes(q);
        const inSku = it.sku?.toLowerCase().includes(q);
        if (!inName && !inSku) return false;
      }
      return true;
    });

    const dir = sortDir === "asc" ? 1 : -1;
    result = [...result].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case "name":
          av = (a.name || "").toLowerCase();
          bv = (b.name || "").toLowerCase();
          break;
        case "quantity":
          av = Number(a.quantity);
          bv = Number(b.quantity);
          break;
        case "unit_cost":
          av = a.unit_cost != null ? Number(a.unit_cost) : -1;
          bv = b.unit_cost != null ? Number(b.unit_cost) : -1;
          break;
        case "category":
          av = (a.category || UNCATEGORIZED).toLowerCase();
          bv = (b.category || UNCATEGORIZED).toLowerCase();
          break;
        default:
          av = a.created_at;
          bv = b.created_at;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });

    return result;
  }, [items, search, lowStockOnly, categoryFilter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // ---------- Stats ----------
  const stats = useMemo(() => {
    const totalItems = items.length;
    const totalValue = items.reduce(
      (sum, it) => sum + Number(it.quantity || 0) * Number(it.unit_cost || 0),
      0
    );
    const lowCount = items.filter(
      (it) => Number(it.quantity) <= Number(it.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD)
    ).length;
    return { totalItems, totalValue, lowCount };
  }, [items]);

  // ---------- Bulk selection ----------
  const allVisibleSelected =
    filteredItems.length > 0 && filteredItems.every((it) => selected.has(it.id));

  const toggleSelectAll = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filteredItems.forEach((it) => next.delete(it.id));
        return next;
      }
      const next = new Set(prev);
      filteredItems.forEach((it) => next.add(it.id));
      return next;
    });
  };

  const toggleSelectRow = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const bulkDelete = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} item${ids.length > 1 ? "s" : ""}? This can't be undone.`))
      return;

    const { error: deleteError } = await supabase.from("inventory_items").delete().in("id", ids);
    if (!deleteError) {
      clearSelection();
      fetchItems();
    }
  };

  const bulkSetThreshold = async () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const value = window.prompt("Set low-stock threshold for selected items:", "5");
    if (value === null) return;
    const threshold = Number(value);
    if (isNaN(threshold) || threshold < 0) {
      window.alert("Enter a valid, non-negative number.");
      return;
    }

    const { error: updateError } = await supabase
      .from("inventory_items")
      .update({ low_stock_threshold: threshold })
      .in("id", ids);

    if (!updateError) {
      clearSelection();
      fetchItems();
    }
  };

  const exportRows = (rows, filenamePrefix) => {
    const data = rows.map((it) => ({
      Name: it.name,
      SKU: it.sku || "",
      Category: it.category || "",
      Quantity: Number(it.quantity),
      "Low-stock threshold": Number(it.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD),
      "Unit cost": it.unit_cost != null ? Number(it.unit_cost) : "",
    }));
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Inventory");
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `${filenamePrefix}-${stamp}.xlsx`);
  };

  const bulkExport = () => {
    const ids = selected;
    const rows = items.filter((it) => ids.has(it.id));
    if (rows.length === 0) return;
    exportRows(rows, "inventory-selection");
  };

  const exportAll = () => {
    if (filteredItems.length === 0) return;
    exportRows(filteredItems, "inventory");
  };

  // ---------- Bulk import ----------
  const triggerImport = () => fileInputRef.current?.click();

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImporting(true);
    setImportSummary(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      const toInsert = [];
      let skipped = 0;

      rows.forEach((row) => {
        const name = String(row.Name ?? row.name ?? "").trim();
        const quantityRaw = row.Quantity ?? row.quantity ?? row.Qty ?? row.qty;
        const quantity = Number(quantityRaw);

        if (!name || isNaN(quantity) || quantity < 0) {
          skipped += 1;
          return;
        }

        const thresholdRaw =
          row["Low-stock threshold"] ?? row.low_stock_threshold ?? row.Threshold ?? row.threshold;
        const threshold = thresholdRaw !== "" && !isNaN(Number(thresholdRaw))
          ? Number(thresholdRaw)
          : DEFAULT_LOW_STOCK_THRESHOLD;

        const unitCostRaw = row["Unit cost"] ?? row.unit_cost ?? row.Cost ?? row.cost;
        const unitCost = unitCostRaw !== "" && !isNaN(Number(unitCostRaw)) ? Number(unitCostRaw) : null;

        toInsert.push({
          business_id: business.id,
          name,
          sku: String(row.SKU ?? row.sku ?? "").trim() || null,
          category: String(row.Category ?? row.category ?? "").trim() || null,
          quantity,
          unit_cost: unitCost,
          low_stock_threshold: threshold,
        });
      });

      if (toInsert.length === 0) {
        setImportSummary({ ok: 0, skipped, error: "No valid rows found. Check the Name and Quantity columns." });
        setImporting(false);
        return;
      }

      const { error: insertError } = await supabase.from("inventory_items").insert(toInsert);

      if (insertError) {
        setImportSummary({ ok: 0, skipped, error: insertError.message });
      } else {
        setImportSummary({ ok: toInsert.length, skipped, error: null });
        notify(
          business.id,
          appUser?.id,
          `Imported ${toInsert.length} inventory item${toInsert.length > 1 ? "s" : ""} from file.`
        );
        fetchItems();
      }
    } catch (err) {
      setImportSummary({ ok: 0, skipped: 0, error: "Couldn't read that file. Use a .csv or .xlsx export." });
    }

    setImporting(false);
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return null;
    return <span className={`inven-sort-arrow ${sortDir}`}>▲</span>;
  };

  const hasActiveFilters = search.trim() || lowStockOnly || categoryFilter !== "all";

  return (
    <div className="inven-page">
      <AppNav business={business} />

      <div className="inven-body">
        <div className="inven-header">
          <div>
            <p className="inven-eyebrow">Inventory</p>
            <h1 className="inven-heading">Your stock</h1>
          </div>
          <div className="inven-header-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="inven-hidden-input"
              onChange={handleImportFile}
            />
            <button className="inven-secondary-btn" onClick={triggerImport} disabled={importing}>
              {importing ? "Importing..." : "Import file"}
            </button>
            <button className="inven-secondary-btn" onClick={exportAll} disabled={filteredItems.length === 0}>
              Export
            </button>
            <button className="inven-add-btn" onClick={openAddModal}>
              + Add item
            </button>
          </div>
        </div>

        {importSummary && (
          <div className={`inven-import-banner ${importSummary.error ? "inven-import-banner--error" : ""}`}>
            {importSummary.error
              ? importSummary.error
              : `Imported ${importSummary.ok} item${importSummary.ok !== 1 ? "s" : ""}${
                  importSummary.skipped ? `, skipped ${importSummary.skipped} invalid row${importSummary.skipped !== 1 ? "s" : ""}` : ""
                }.`}
            <button className="inven-banner-dismiss" onClick={() => setImportSummary(null)}>
              ×
            </button>
          </div>
        )}

        <div className="inven-stats">
          <div className="inven-stat-card">
            <p className="inven-stat-label">Items tracked</p>
            <p className="inven-stat-value">{stats.totalItems}</p>
          </div>
          <div className="inven-stat-card">
            <p className="inven-stat-label">Stock value</p>
            <p className="inven-stat-value">R{stats.totalValue.toFixed(2)}</p>
          </div>
          <div className={`inven-stat-card ${stats.lowCount > 0 ? "inven-stat-card--warn" : ""}`}>
            <p className="inven-stat-label">Low stock</p>
            <p className="inven-stat-value">{stats.lowCount}</p>
          </div>
        </div>

        <div className="inven-toolbar">
          <div className="inven-search-wrap">
            <svg className="inven-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="inven-search-input"
              placeholder="Search by name or SKU..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="inven-select"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <label className="inven-toggle">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => setLowStockOnly(e.target.checked)}
            />
            <span className="inven-toggle-track">
              <span className="inven-toggle-thumb" />
            </span>
            Low stock only
          </label>

          {hasActiveFilters && (
            <button
              className="inven-clear-filters"
              onClick={() => {
                setSearch("");
                setLowStockOnly(false);
                setCategoryFilter("all");
              }}
            >
              Clear filters
            </button>
          )}
        </div>

        {selected.size > 0 && (
          <div className="inven-bulkbar">
            <span className="inven-bulkbar-count">{selected.size} selected</span>
            <div className="inven-bulkbar-actions">
              <button className="inven-action-btn" onClick={bulkSetThreshold}>
                Set threshold
              </button>
              <button className="inven-action-btn" onClick={bulkExport}>
                Export selected
              </button>
              <button className="inven-action-btn inven-action-btn--danger" onClick={bulkDelete}>
                Delete
              </button>
              <button className="inven-action-btn" onClick={clearSelection}>
                Clear
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="inven-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="inven-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="inven-empty">
            <p>No inventory items yet.</p>
            <p className="inven-empty-sub">Add your first item, or import a spreadsheet to get started.</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="inven-empty">
            <p>No items match your filters.</p>
            <button className="inven-clear-filters" onClick={() => {
              setSearch("");
              setLowStockOnly(false);
              setCategoryFilter("all");
            }}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="inven-table-wrap">
            <table className="inven-table">
              <thead>
                <tr>
                  <th className="inven-th-check">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAll}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="inven-th-sortable" onClick={() => toggleSort("name")}>
                    Name {sortIndicator("name")}
                  </th>
                  <th>SKU</th>
                  <th className="inven-th-sortable" onClick={() => toggleSort("category")}>
                    Category {sortIndicator("category")}
                  </th>
                  <th className="inven-th-sortable" onClick={() => toggleSort("quantity")}>
                    Quantity {sortIndicator("quantity")}
                  </th>
                  <th>Low-stock at</th>
                  <th className="inven-th-sortable" onClick={() => toggleSort("unit_cost")}>
                    Unit cost {sortIndicator("unit_cost")}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((it, idx) => {
                  const threshold = Number(it.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD);
                  const isLow = Number(it.quantity) <= threshold;
                  const isAdjusting = adjusting.has(it.id);
                  return (
                    <tr
                      key={it.id}
                      className={`inven-row ${flashRowId === it.id ? "inven-row--flash" : ""}`}
                      style={{ animationDelay: `${Math.min(idx, 12) * 0.03}s` }}
                    >
                      <td className="inven-th-check">
                        <input
                          type="checkbox"
                          checked={selected.has(it.id)}
                          onChange={() => toggleSelectRow(it.id)}
                          aria-label={`Select ${it.name}`}
                        />
                      </td>
                      <td className="inven-name-cell">{it.name}</td>
                      <td className={it.sku ? "" : "inven-muted"}>{it.sku || "—"}</td>
                      <td>
                        <span className="inven-category-pill">{it.category?.trim() || UNCATEGORIZED}</span>
                      </td>
                      <td>
                        <div className="inven-qty-cell">
                          <button
                            className="inven-stepper-btn"
                            onClick={() => quickAdjust(it, -1)}
                            disabled={isAdjusting || Number(it.quantity) <= 0}
                            aria-label={`Decrease ${it.name} quantity`}
                          >
                            −
                          </button>
                          <span className={`inven-qty-value ${isLow ? "inven-qty-low" : ""}`}>
                            {Number(it.quantity)}
                          </span>
                          <button
                            className="inven-stepper-btn"
                            onClick={() => quickAdjust(it, 1)}
                            disabled={isAdjusting}
                            aria-label={`Increase ${it.name} quantity`}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="inven-muted">{threshold}</td>
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
                  );
                })}
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

              <div className="inven-input-row">
                <div>
                  <label className="inven-label">SKU</label>
                  <input
                    className="inven-input"
                    placeholder="Optional SKU"
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                  />
                </div>
                <div>
                  <label className="inven-label">Category</label>
                  <input
                    className="inven-input"
                    placeholder="Optional category"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    list="inven-category-options"
                  />
                  <datalist id="inven-category-options">
                    {categories
                      .filter((c) => c !== UNCATEGORIZED)
                      .map((c) => (
                        <option key={c} value={c} />
                      ))}
                  </datalist>
                </div>
              </div>

              <div className="inven-input-row">
                <div>
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
                </div>
                <div>
                  <label className="inven-label">Low-stock threshold</label>
                  <input
                    className="inven-input"
                    type="number"
                    min="0"
                    step="1"
                    placeholder="5"
                    value={form.low_stock_threshold}
                    onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                  />
                </div>
              </div>

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