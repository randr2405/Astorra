import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Renderer, Camera, Program, Mesh, Plane, Texture } from "ogl";
import * as XLSX from "xlsx";
import { supabase } from "../lib/supabaseClient";
import AppNav from "../components/AppNav";
import "./Expenses.css";

// ---------------------------------------------------------------------
// GridDistortion — inlined here (no separate component file) so this
// page has zero local imports beyond libraries already in the app.
// Built on "ogl", which is already a project dependency — no new
// packages required.
// ---------------------------------------------------------------------
const distortionVertexShader = `
attribute vec3 position;
attribute vec2 uv;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const distortionFragmentShader = `
precision highp float;
uniform sampler2D uDataTexture;
uniform sampler2D uTexture;
varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  vec4 offsetSample = texture2D(uDataTexture, vUv);
  vec2 offset = (offsetSample.rg - 0.5) * 2.0;
  gl_FragColor = texture2D(uTexture, uv - 0.02 * offset);
}`;

function GridDistortion({ grid = 15, mouse = 0.1, strength = 0.15, relaxation = 0.9, imageSrc, className = "" }) {
  const containerRef = useRef(null);
  const animationIdRef = useRef(null);
  const resizeObserverRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;

    const renderer = new Renderer({ alpha: true, dpr: Math.min(window.devicePixelRatio || 1, 2) });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    container.innerHTML = "";
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.style.display = "block";
    container.appendChild(gl.canvas);

    const camera = new Camera(gl, { near: 0.01, far: 1000 });
    camera.position.z = 2;

    const size = grid;

    // Float accumulator for smooth physics, byte buffer for GPU upload
    // (unsigned-byte textures avoid needing a float-texture extension).
    const values = new Float32Array(2 * size * size);
    for (let i = 0; i < size * size; i++) {
      values[i * 2] = Math.random() * 40 - 20;
      values[i * 2 + 1] = Math.random() * 40 - 20;
    }
    const texData = new Uint8Array(4 * size * size);
    texData.fill(255, 0, texData.length); // alpha channel etc, overwritten below

    const dataTexture = new Texture(gl, {
      image: texData,
      width: size,
      height: size,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      generateMipmaps: false,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
      flipY: false,
    });

    const texture = new Texture(gl, { generateMipmaps: false, flipY: true });
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      texture.image = img;
      handleResize();
    };
    img.src = imageSrc;

    const geometry = new Plane(gl, { width: 1, height: 1, widthSegments: size - 1, heightSegments: size - 1 });

    const program = new Program(gl, {
      vertex: distortionVertexShader,
      fragment: distortionFragmentShader,
      uniforms: {
        uTexture: { value: texture },
        uDataTexture: { value: dataTexture },
      },
      transparent: true,
      cullFace: false,
    });

    const mesh = new Mesh(gl, { geometry, program });

    const handleResize = () => {
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      if (width === 0 || height === 0) return;

      renderer.setSize(width, height);

      const containerAspect = width / height;
      mesh.scale.set(containerAspect, 1, 1);

      const frustumHeight = 1;
      const frustumWidth = frustumHeight * containerAspect;
      camera.orthographic({
        left: -frustumWidth / 2,
        right: frustumWidth / 2,
        top: frustumHeight / 2,
        bottom: -frustumHeight / 2,
        near: 0.01,
        far: 1000,
      });
    };

    if (window.ResizeObserver) {
      const resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(container);
      resizeObserverRef.current = resizeObserver;
    } else {
      window.addEventListener("resize", handleResize);
    }

    const mouseState = { x: 0, y: 0, prevX: 0, prevY: 0, vX: 0, vY: 0 };

    const handleMouseMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1 - (e.clientY - rect.top) / rect.height;
      mouseState.vX = x - mouseState.prevX;
      mouseState.vY = y - mouseState.prevY;
      Object.assign(mouseState, { x, y, prevX: x, prevY: y });
    };

    const handleMouseLeave = () => {
      Object.assign(mouseState, { x: 0, y: 0, prevX: 0, prevY: 0, vX: 0, vY: 0 });
    };

    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("mouseleave", handleMouseLeave);

    handleResize();

    const animate = () => {
      animationIdRef.current = requestAnimationFrame(animate);

      for (let i = 0; i < size * size; i++) {
        values[i * 2] *= relaxation;
        values[i * 2 + 1] *= relaxation;
      }

      const gridMouseX = size * mouseState.x;
      const gridMouseY = size * mouseState.y;
      const maxDist = size * mouse;

      for (let i = 0; i < size; i++) {
        for (let j = 0; j < size; j++) {
          const distSq = Math.pow(gridMouseX - i, 2) + Math.pow(gridMouseY - j, 2);
          if (distSq < maxDist * maxDist) {
            const index = i + size * j;
            const power = Math.min(maxDist / Math.sqrt(distSq), 10);
            values[index * 2] += strength * 100 * mouseState.vX * power;
            values[index * 2 + 1] -= strength * 100 * mouseState.vY * power;
          }
        }
      }

      for (let i = 0; i < size * size; i++) {
        const r = Math.max(-125, Math.min(125, values[i * 2]));
        const g = Math.max(-125, Math.min(125, values[i * 2 + 1]));
        texData[i * 4] = Math.round((r / 125) * 127 + 128);
        texData[i * 4 + 1] = Math.round((g / 125) * 127 + 128);
        texData[i * 4 + 2] = 128;
        texData[i * 4 + 3] = 255;
      }
      dataTexture.needsUpdate = true;

      renderer.render({ scene: mesh, camera });
    };

    animate();

    return () => {
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
      }

      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect();
      } else {
        window.removeEventListener("resize", handleResize);
      }

      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("mouseleave", handleMouseLeave);

      const loseContextExt = gl.getExtension("WEBGL_lose_context");
      if (loseContextExt) loseContextExt.loseContext();

      if (container.contains(gl.canvas)) {
        container.removeChild(gl.canvas);
      }
    };
  }, [grid, mouse, strength, relaxation, imageSrc]);

  return (
    <div
      ref={containerRef}
      className={`distortion-container ${className}`}
      style={{
        width: "100%",
        height: "100%",
        minWidth: "0",
        minHeight: "0",
      }}
    />
  );
}

const currency = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });

const CATEGORIES = [
  { key: "general", label: "General" },
  { key: "supplies", label: "Supplies" },
  { key: "travel", label: "Travel" },
  { key: "rent", label: "Rent" },
  { key: "utilities", label: "Utilities" },
  { key: "equipment", label: "Equipment" },
  { key: "other", label: "Other" },
];

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

const RANGE_OPTIONS = [
  { key: "all", label: "All time" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom range" },
];

const emptyForm = {
  id: null,
  category: "general",
  customCategory: "",
  vendor: "",
  description: "",
  amount: "",
  vat_amount: "",
  expense_date: new Date().toISOString().slice(0, 10),
  receipt_path: null,
  is_recurring: false,
  recurring_frequency: "monthly",
};

function formatDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-ZA", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Returns [start, end] (inclusive, YYYY-MM-DD strings) for a given range key.
function resolveRangeBounds(rangeKey, customStart, customEnd) {
  const now = new Date();

  if (rangeKey === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
  }
  if (rangeKey === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
  }
  if (rangeKey === "custom") {
    return [customStart || null, customEnd || null];
  }
  return [null, null]; // all time
}

function Expenses({ business }) {
  const [expenses, setExpenses] = useState([]);
  const [paidInvoicesTotal, setPaidInvoicesTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortBy, setSortBy] = useState("date_desc");

  const [rangeKey, setRangeKey] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [receiptFile, setReceiptFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [selectedIds, setSelectedIds] = useState([]);
  const [receiptUrlCache, setReceiptUrlCache] = useState({});

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const [{ data: expenseData }, { data: invoiceData }] = await Promise.all([
      supabase
        .from("expenses")
        .select("*")
        .eq("business_id", business.id)
        .order("expense_date", { ascending: false }),
      supabase
        .from("invoices")
        .select("total")
        .eq("business_id", business.id)
        .eq("status", "paid"),
    ]);

    setExpenses(expenseData || []);
    setPaidInvoicesTotal((invoiceData || []).reduce((sum, i) => sum + Number(i.total || 0), 0));
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---------- Date range bounds ----------
  const [rangeStart, rangeEnd] = useMemo(
    () => resolveRangeBounds(rangeKey, customStart, customEnd),
    [rangeKey, customStart, customEnd]
  );

  const inRange = useCallback(
    (dateStr) => {
      if (!dateStr) return rangeKey === "all";
      if (rangeStart && dateStr < rangeStart) return false;
      if (rangeEnd && dateStr > rangeEnd) return false;
      return true;
    },
    [rangeStart, rangeEnd, rangeKey]
  );

  // ---------- Stats (respect the date range, not search/category) ----------
  const rangedExpenses = useMemo(
    () => expenses.filter((e) => inRange(e.expense_date)),
    [expenses, inRange]
  );

  const stats = useMemo(() => {
    const totalExpenses = rangedExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalVat = rangedExpenses.reduce((sum, e) => sum + Number(e.vat_amount || 0), 0);
    const netProfit = paidInvoicesTotal - totalExpenses;
    const thisMonthKey = new Date().toISOString().slice(0, 7);
    const thisMonthExpenses = expenses
      .filter((e) => (e.expense_date || "").startsWith(thisMonthKey))
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    return { totalExpenses, totalVat, netProfit, thisMonthExpenses };
  }, [rangedExpenses, expenses, paidInvoicesTotal]);

  // ---------- Filter + sort (search, category, and date range together) ----------
  const visibleExpenses = useMemo(() => {
    let list = rangedExpenses.slice();

    if (categoryFilter !== "all") {
      list = list.filter((e) => e.category === categoryFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (e) =>
          (e.vendor || "").toLowerCase().includes(q) ||
          (e.description || "").toLowerCase().includes(q)
      );
    }

    switch (sortBy) {
      case "date_asc":
        list.sort((a, b) => (a.expense_date || "").localeCompare(b.expense_date || ""));
        break;
      case "amount_desc":
        list.sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
        break;
      case "amount_asc":
        list.sort((a, b) => Number(a.amount || 0) - Number(b.amount || 0));
        break;
      default: // date_desc
        list.sort((a, b) => (b.expense_date || "").localeCompare(a.expense_date || ""));
    }

    return list;
  }, [rangedExpenses, categoryFilter, search, sortBy]);

  // ---------- Modal handlers ----------
  const openAddModal = () => {
    setForm(emptyForm);
    setReceiptFile(null);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (expense) => {
    const isKnownCategory = CATEGORIES.some((c) => c.key === expense.category);
    setForm({
      id: expense.id,
      category: isKnownCategory ? expense.category : "other",
      customCategory: isKnownCategory ? "" : expense.category,
      vendor: expense.vendor || "",
      description: expense.description || "",
      amount: expense.amount ?? "",
      vat_amount: expense.vat_amount ?? "",
      expense_date: expense.expense_date || new Date().toISOString().slice(0, 10),
      receipt_path: expense.receipt_path || null,
      is_recurring: expense.is_recurring || false,
      recurring_frequency: expense.recurring_frequency || "monthly",
    });
    setReceiptFile(null);
    setError("");
    setModalOpen(true);
  };

  // Duplicate: opens the Add form pre-filled from an existing expense, but
  // as a new record (no id, no receipt carried over, today's date, and
  // never carries the recurring flag — duplicating a recurring template
  // shouldn't silently create a second auto-generator).
  const openDuplicateModal = (expense) => {
    const isKnownCategory = CATEGORIES.some((c) => c.key === expense.category);
    setForm({
      id: null,
      category: isKnownCategory ? expense.category : "other",
      customCategory: isKnownCategory ? "" : expense.category,
      vendor: expense.vendor || "",
      description: expense.description || "",
      amount: expense.amount ?? "",
      vat_amount: expense.vat_amount ?? "",
      expense_date: new Date().toISOString().slice(0, 10),
      receipt_path: null,
      is_recurring: false,
      recurring_frequency: "monthly",
    });
    setReceiptFile(null);
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setForm(emptyForm);
    setReceiptFile(null);
    setError("");
  };

  const handleSave = async () => {
    setError("");

    const resolvedCategory =
      form.category === "other" ? form.customCategory.trim() : form.category;

    if (!resolvedCategory) {
      setError("Please choose a category, or enter one for \"Other\".");
      return;
    }
    if (!form.amount || Number(form.amount) <= 0) {
      setError("Please enter an amount greater than 0.");
      return;
    }

    setSaving(true);

    let receiptPath = form.receipt_path;

    try {
      if (receiptFile) {
        const ext = receiptFile.name.split(".").pop();
        const path = `${business.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("expense-receipts")
          .upload(path, receiptFile, { upsert: false });

        if (uploadError) throw uploadError;
        receiptPath = path;
      }

      // recurring_next_run is the day after this expense's date, on the
      // chosen cadence — the daily cron job picks it up once that date
      // arrives and pushes it forward again from there.
      const nextRun = form.is_recurring
        ? (() => {
            const d = new Date(form.expense_date + "T00:00:00");
            if (form.recurring_frequency === "weekly") d.setDate(d.getDate() + 7);
            else d.setMonth(d.getMonth() + 1);
            return d.toISOString().slice(0, 10);
          })()
        : null;

      const payload = {
        business_id: business.id,
        category: resolvedCategory,
        vendor: form.vendor.trim() || null,
        description: form.description.trim() || null,
        amount: Number(form.amount),
        vat_amount: form.vat_amount ? Number(form.vat_amount) : 0,
        expense_date: form.expense_date,
        receipt_path: receiptPath,
        is_recurring: form.is_recurring,
        recurring_frequency: form.is_recurring ? form.recurring_frequency : null,
        recurring_next_run: nextRun,
      };

      if (form.id) {
        const { error: updateError } = await supabase
          .from("expenses")
          .update(payload)
          .eq("id", form.id)
          .eq("business_id", business.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase.from("expenses").insert(payload);
        if (insertError) throw insertError;
      }

      closeModal();
      fetchAll();
    } catch (err) {
      setError(err.message || "Something went wrong saving this expense.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (expense) => {
    if (!window.confirm("Delete this expense? This can't be undone.")) return;

    if (expense.receipt_path) {
      await supabase.storage.from("expense-receipts").remove([expense.receipt_path]);
    }
    await supabase.from("expenses").delete().eq("id", expense.id).eq("business_id", business.id);
    fetchAll();
  };

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} expense${selectedIds.length === 1 ? "" : "s"}? This can't be undone.`)) return;

    const toDelete = expenses.filter((e) => selectedIds.includes(e.id));
    const paths = toDelete.filter((e) => e.receipt_path).map((e) => e.receipt_path);
    if (paths.length) {
      await supabase.storage.from("expense-receipts").remove(paths);
    }
    await supabase.from("expenses").delete().in("id", selectedIds).eq("business_id", business.id);
    setSelectedIds([]);
    fetchAll();
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === visibleExpenses.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(visibleExpenses.map((e) => e.id));
    }
  };

  const viewReceipt = async (expense) => {
    if (!expense.receipt_path) return;

    if (receiptUrlCache[expense.id]) {
      window.open(receiptUrlCache[expense.id], "_blank", "noopener,noreferrer");
      return;
    }

    const { data, error: signError } = await supabase.storage
      .from("expense-receipts")
      .createSignedUrl(expense.receipt_path, 300);

    if (signError || !data?.signedUrl) return;

    setReceiptUrlCache((prev) => ({ ...prev, [expense.id]: data.signedUrl }));
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const exportCsv = () => {
    const rows = visibleExpenses.map((e) => ({
      Date: e.expense_date || "",
      Category: CATEGORY_LABELS[e.category] || e.category,
      Vendor: e.vendor || "",
      Description: e.description || "",
      Amount: Number(e.amount || 0),
      VAT: Number(e.vat_amount || 0),
      Recurring: e.is_recurring ? `Yes (${e.recurring_frequency})` : "No",
      "Has receipt": e.receipt_path ? "Yes" : "No",
    }));

    const worksheet = XLSX.utils.json_to_sheet(rows);
    worksheet["!cols"] = [
      { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 30 },
      { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Expenses");

    const rangeLabel = RANGE_OPTIONS.find((r) => r.key === rangeKey)?.label.replace(/\s+/g, "-") || "all-time";
    const dateStamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `expenses-${rangeLabel}-${dateStamp}.xlsx`);
  };

  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
    setRangeKey("all");
    setCustomStart("");
    setCustomEnd("");
  };

  const hasActiveFilters =
    search.trim() !== "" || categoryFilter !== "all" || rangeKey !== "all";

  return (
    <div className="exp-page">
      {/* Ambient distortion background, sits fixed behind everything.
          A navy/purple gradient overlay (in CSS) keeps it on-theme. */}
      <div className="exp-bg" aria-hidden="true">
        <GridDistortion
          imageSrc="https://picsum.photos/1920/1080?grayscale"
          grid={10}
          mouse={0.25}
          strength={0.15}
          relaxation={0.9}
          className="exp-bg-distortion"
        />
        <div className="exp-bg-overlay" />
      </div>

      <div className="exp-content">
        <AppNav business={business} />

        <div className="exp-body">
          <div className="exp-header">
            <div>
              <p className="exp-eyebrow">Expenses</p>
              <h1 className="exp-heading">What you're spending</h1>
            </div>
            <div className="exp-header-actions">
              <button className="exp-secondary-btn" onClick={exportCsv} disabled={visibleExpenses.length === 0}>
                Export
              </button>
              <button className="exp-add-btn" onClick={openAddModal}>
                + Add expense
              </button>
            </div>
          </div>

          <div className="exp-stats">
            <div className="exp-stat-card">
              <p className="exp-stat-label">Total income (paid)</p>
              <p className="exp-stat-value">{currency.format(paidInvoicesTotal)}</p>
            </div>
            <div className="exp-stat-card">
              <p className="exp-stat-label">
                {rangeKey === "all" ? "Total expenses" : "Expenses (selected range)"}
              </p>
              <p className="exp-stat-value">{currency.format(stats.totalExpenses)}</p>
            </div>
            <div className={`exp-stat-card ${stats.netProfit < 0 ? "exp-stat-card--warn" : "exp-stat-card--positive"}`}>
              <p className="exp-stat-label">Net profit</p>
              <p className="exp-stat-value">{currency.format(stats.netProfit)}</p>
            </div>
            <div className="exp-stat-card">
              <p className="exp-stat-label">This month</p>
              <p className="exp-stat-value">{currency.format(stats.thisMonthExpenses)}</p>
            </div>
          </div>

          <div className="exp-toolbar">
            <div className="exp-search-wrap">
              <svg className="exp-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="exp-search-input"
                placeholder="Search vendor or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <select className="exp-select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {CATEGORIES.filter((c) => c.key !== "other").map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
              <option value="other">Other</option>
            </select>

            <select className="exp-select" value={rangeKey} onChange={(e) => setRangeKey(e.target.value)}>
              {RANGE_OPTIONS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>

            {rangeKey === "custom" && (
              <>
                <input
                  className="exp-select exp-date-input"
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <span className="exp-range-sep">to</span>
                <input
                  className="exp-select exp-date-input"
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </>
            )}

            <select className="exp-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Highest amount</option>
              <option value="amount_asc">Lowest amount</option>
            </select>

            {hasActiveFilters && (
              <button className="exp-clear-filters" onClick={clearFilters}>
                Clear filters
              </button>
            )}
          </div>

          {selectedIds.length > 0 && (
            <div className="exp-bulkbar">
              <span className="exp-bulkbar-count">
                {selectedIds.length} selected
              </span>
              <div className="exp-bulkbar-actions">
                <button className="exp-action-btn exp-action-btn--danger" onClick={handleBulkDelete}>
                  Delete selected
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="exp-skeleton">
              {[0, 1, 2, 3, 4].map((i) => (
                <div className="exp-skeleton-row" key={i} style={{ animationDelay: `${i * 0.05}s` }} />
              ))}
            </div>
          ) : visibleExpenses.length === 0 ? (
            <div className="exp-empty">
              <p>{expenses.length === 0 ? "No expenses logged yet." : "No expenses match your filters."}</p>
              <p className="exp-empty-sub">
                {expenses.length === 0
                  ? "Add your first expense to start tracking what you spend."
                  : "Try adjusting your search, category, or date range."}
              </p>
            </div>
          ) : (
            <div className="exp-table-wrap">
              <table className="exp-table">
                <thead>
                  <tr>
                    <th className="exp-th-check">
                      <input
                        type="checkbox"
                        checked={selectedIds.length === visibleExpenses.length && visibleExpenses.length > 0}
                        onChange={toggleSelectAll}
                      />
                    </th>
                    <th>Date</th>
                    <th>Category</th>
                    <th>Vendor</th>
                    <th>Description</th>
                    <th>Amount</th>
                    <th>Receipt</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleExpenses.map((e, i) => (
                    <tr className="exp-row" key={e.id} style={{ animationDelay: `${Math.min(i, 8) * 0.03}s` }}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(e.id)}
                          onChange={() => toggleSelect(e.id)}
                        />
                      </td>
                      <td>{formatDate(e.expense_date)}</td>
                      <td>
                        <span className="exp-category-pill">
                          {CATEGORY_LABELS[e.category] || e.category}
                        </span>
                        {e.is_recurring && (
                          <span className="exp-recurring-pill" title={`Repeats ${e.recurring_frequency}`}>
                            ↻ {e.recurring_frequency === "weekly" ? "Weekly" : "Monthly"}
                          </span>
                        )}
                      </td>
                      <td className="exp-muted">{e.vendor || "—"}</td>
                      <td className="exp-muted">{e.description || "—"}</td>
                      <td className="exp-name-cell">{currency.format(e.amount)}</td>
                      <td>
                        {e.receipt_path ? (
                          <button className="exp-link" onClick={() => viewReceipt(e)}>
                            View
                          </button>
                        ) : (
                          <span className="exp-muted">—</span>
                        )}
                      </td>
                      <td className="exp-actions-cell">
                        <button className="exp-action-btn" onClick={() => openDuplicateModal(e)}>
                          Duplicate
                        </button>
                        <button className="exp-action-btn" onClick={() => openEditModal(e)}>
                          Edit
                        </button>
                        <button className="exp-action-btn exp-action-btn--danger" onClick={() => handleDelete(e)}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {modalOpen && (
          <div className="exp-modal-overlay" onClick={closeModal}>
            <div className="exp-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{form.id ? "Edit expense" : "Add expense"}</h2>

              {error && <p className="exp-error">{error}</p>}

              <label className="exp-label">Category</label>
              <select
                className="exp-input exp-input--select"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>

              {form.category === "other" && (
                <>
                  <label className="exp-label">Custom category</label>
                  <input
                    className="exp-input"
                    placeholder="e.g. Software subscriptions"
                    value={form.customCategory}
                    onChange={(e) => setForm({ ...form, customCategory: e.target.value })}
                  />
                </>
              )}

              <div className="exp-input-row">
                <div>
                  <label className="exp-label">Amount (R)</label>
                  <input
                    className="exp-input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  />
                </div>
                <div>
                  <label className="exp-label">VAT (R, optional)</label>
                  <input
                    className="exp-input"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={form.vat_amount}
                    onChange={(e) => setForm({ ...form, vat_amount: e.target.value })}
                  />
                </div>
              </div>

              <label className="exp-label">Vendor</label>
              <input
                className="exp-input"
                placeholder="e.g. Builders Warehouse"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
              />

              <label className="exp-label">Description</label>
              <input
                className="exp-input"
                placeholder="What was this for?"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />

              <label className="exp-label">Date</label>
              <input
                className="exp-input"
                type="date"
                value={form.expense_date}
                onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              />

              <label className="exp-label">Receipt (optional)</label>
              <input
                className="exp-input"
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
              />
              {form.receipt_path && !receiptFile && (
                <p className="exp-existing-receipt">A receipt is already attached. Choose a new file to replace it.</p>
              )}

              <label className="exp-recurring-toggle">
                <input
                  type="checkbox"
                  checked={form.is_recurring}
                  onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })}
                />
                <span>This expense repeats</span>
              </label>

              {form.is_recurring && (
                <>
                  <label className="exp-label">Repeats</label>
                  <select
                    className="exp-input exp-input--select"
                    value={form.recurring_frequency}
                    onChange={(e) => setForm({ ...form, recurring_frequency: e.target.value })}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="weekly">Weekly</option>
                  </select>
                </>
              )}

              <div className="exp-modal-actions">
                <button className="exp-cancel-btn" onClick={closeModal} disabled={saving}>
                  Cancel
                </button>
                <button className="exp-add-btn" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving..." : form.id ? "Save changes" : "Add expense"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Expenses;