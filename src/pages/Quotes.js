import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Renderer, Program, Mesh, Triangle } from "ogl";
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

/* ---------------------------------------------------------------- */
/* Animated background (LiquidChrome shader, retuned to the navy/    */
/* purple/blue/teal theme). Kept self-contained in this file.        */
/* ---------------------------------------------------------------- */

function QuotesBackground({
  baseColor = [0.055, 0.06, 0.11], // navy tint instead of default grey
  speed = 0.22,
  amplitude = 0.22,
  frequencyX = 2.6,
  frequencyY = 2.6,
  interactive = true,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const renderer = new Renderer({ antialias: true, alpha: true });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const vertexShader = `
      attribute vec2 position;
      attribute vec2 uv;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragmentShader = `
      precision highp float;
      uniform float uTime;
      uniform vec3 uResolution;
      uniform vec3 uBaseColor;
      uniform float uAmplitude;
      uniform float uFrequencyX;
      uniform float uFrequencyY;
      uniform vec2 uMouse;
      uniform vec3 uTint2;
      uniform vec3 uTint3;
      varying vec2 vUv;

      vec4 renderImage(vec2 uvCoord) {
          vec2 fragCoord = uvCoord * uResolution.xy;
          vec2 uv = (2.0 * fragCoord - uResolution.xy) / min(uResolution.x, uResolution.y);

          for (float i = 1.0; i < 10.0; i++){
              uv.x += uAmplitude / i * cos(i * uFrequencyX * uv.y + uTime + uMouse.x * 3.14159);
              uv.y += uAmplitude / i * cos(i * uFrequencyY * uv.x + uTime + uMouse.y * 3.14159);
          }

          vec2 diff = (uvCoord - uMouse);
          float dist = length(diff);
          float falloff = exp(-dist * 20.0);
          float ripple = sin(10.0 * dist - uTime * 2.0) * 0.03;
          uv += (diff / (dist + 0.0001)) * ripple * falloff;

          float mixer = abs(sin(uTime - uv.y - uv.x));
          vec3 baseCol = uBaseColor / mixer;

          // Blend toward purple/teal accents so it reads as "our" theme
          vec3 accent = mix(uTint2, uTint3, 0.5 + 0.5 * sin(uv.x * 1.3 + uTime * 0.4));
          vec3 color = mix(baseCol, accent, clamp(0.18 + 0.12 * sin(uTime * 0.6 + uv.y), 0.0, 0.4));

          return vec4(color, 1.0);
      }

      void main() {
          vec4 col = vec4(0.0);
          int samples = 0;
          for (int i = -1; i <= 1; i++){
              for (int j = -1; j <= 1; j++){
                  vec2 offset = vec2(float(i), float(j)) * (1.0 / min(uResolution.x, uResolution.y));
                  col += renderImage(vUv + offset);
                  samples++;
              }
          }
          gl_FragColor = col / float(samples);
      }
    `;

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uResolution: {
          value: new Float32Array([gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height]),
        },
        uBaseColor: { value: new Float32Array(baseColor) },
        uAmplitude: { value: amplitude },
        uFrequencyX: { value: frequencyX },
        uFrequencyY: { value: frequencyY },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uTint2: { value: new Float32Array([0.486, 0.227, 0.929]) }, // #7c3aed purple
        uTint3: { value: new Float32Array([0.078, 0.722, 0.651]) }, // #14b8a6 teal
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    function resize() {
      renderer.setSize(container.offsetWidth, container.offsetHeight);
      const resUniform = program.uniforms.uResolution.value;
      resUniform[0] = gl.canvas.width;
      resUniform[1] = gl.canvas.height;
      resUniform[2] = gl.canvas.width / gl.canvas.height;
    }
    window.addEventListener("resize", resize);
    resize();

    function handleMouseMove(event) {
      const rect = container.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = 1 - (event.clientY - rect.top) / rect.height;
      const mouseUniform = program.uniforms.uMouse.value;
      mouseUniform[0] = x;
      mouseUniform[1] = y;
    }

    function handleTouchMove(event) {
      if (event.touches.length > 0) {
        const touch = event.touches[0];
        const rect = container.getBoundingClientRect();
        const x = (touch.clientX - rect.left) / rect.width;
        const y = 1 - (touch.clientY - rect.top) / rect.height;
        const mouseUniform = program.uniforms.uMouse.value;
        mouseUniform[0] = x;
        mouseUniform[1] = y;
      }
    }

    if (interactive) {
      container.addEventListener("mousemove", handleMouseMove);
      container.addEventListener("touchmove", handleTouchMove);
    }

    let animationId;
    function update(t) {
      animationId = requestAnimationFrame(update);
      program.uniforms.uTime.value = t * 0.001 * speed;
      renderer.render({ scene: mesh });
    }
    animationId = requestAnimationFrame(update);

    gl.canvas.className = "quo-bg-canvas";
    container.appendChild(gl.canvas);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      if (interactive) {
        container.removeEventListener("mousemove", handleMouseMove);
        container.removeEventListener("touchmove", handleTouchMove);
      }
      if (gl.canvas.parentElement) {
        gl.canvas.parentElement.removeChild(gl.canvas);
      }
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [baseColor, speed, amplitude, frequencyX, frequencyY, interactive]);

  return <div ref={containerRef} className="quo-bg-container" aria-hidden="true" />;
}

/* ---------------------------------------------------------------- */

function Quotes({ business, appUser }) {
  const navigate = useNavigate();
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [creatorsById, setCreatorsById] = useState({});
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

    if (!fetchError) {
      setQuotes(data || []);

      // Resolve created_by user IDs to emails for the "by ..." sub-line.
      const creatorIds = Array.from(
        new Set((data || []).map((q) => q.created_by).filter(Boolean))
      );
      if (creatorIds.length > 0) {
        const { data: creatorUsers } = await supabase
          .from("users")
          .select("id, email")
          .in("id", creatorIds);
        const map = {};
        (creatorUsers || []).forEach((u) => {
          map[u.id] = u.email;
        });
        setCreatorsById(map);
      } else {
        setCreatorsById({});
      }
    }
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
          created_by: appUser?.id,
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
          created_by: appUser?.id,
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
      created_by: appUser?.id,
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
      <QuotesBackground interactive />
      <AppNav business={business} />

      <div className="quo-body">
        <div className="quo-block">
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
                      <td className="quo-name-cell" data-label="Quote #">
                        {q.quote_number}
                        {q.created_by && creatorsById[q.created_by] && (
                          <span className="quo-created-by">by {creatorsById[q.created_by]}</span>
                        )}
                      </td>
                      <td className={q.customers?.name ? "" : "quo-muted"} data-label="Customer">
                        {q.customers?.name || "—"}
                      </td>
                      <td data-label="Status">
                        <span className={`quo-status quo-status--${q.status}`}>{q.status}</span>
                      </td>
                      <td className="quo-total-cell" data-label="Total">R{Number(q.total).toFixed(2)}</td>
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

              {/* Column headers for the line item grid — hidden on narrow
                  screens where the grid collapses to a stacked card layout,
                  since placeholders inside each input take over that job. */}
              <div className="quo-line-item-headers" aria-hidden="true">
                <span>Description</span>
                <span>Qty</span>
                <span>Unit price</span>
                <span>Total</span>
                <span></span>
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