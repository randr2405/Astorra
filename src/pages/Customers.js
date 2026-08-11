import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Customers.css";

const currency = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const dateFmt = (d) => (d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "—");

const SORT_OPTIONS = [
  { key: "recent", label: "Most recent" },
  { key: "name_asc", label: "Name (A–Z)" },
  { key: "name_desc", label: "Name (Z–A)" },
  { key: "invoiced_desc", label: "Highest invoiced" },
  { key: "outstanding_desc", label: "Highest outstanding" },
];

const STATUS_STYLES = {
  paid: "cust-badge--good",
  accepted: "cust-badge--good",
  unpaid: "cust-badge--warn",
  sent: "cust-badge--warn",
  draft: "cust-badge--muted",
  overdue: "cust-badge--bad",
  declined: "cust-badge--bad",
};

/* ---------------------------------------------------------------- */
/* Animated background (Balatro shader, retuned to the navy/purple/  */
/* blue/teal theme). Kept self-contained so everything lives in      */
/* this one file.                                                    */
/* ---------------------------------------------------------------- */

function hexToVec4(hex) {
  let hexStr = hex.replace("#", "");
  let r = 0,
    g = 0,
    b = 0,
    a = 1;
  if (hexStr.length === 6) {
    r = parseInt(hexStr.slice(0, 2), 16) / 255;
    g = parseInt(hexStr.slice(2, 4), 16) / 255;
    b = parseInt(hexStr.slice(4, 6), 16) / 255;
  } else if (hexStr.length === 8) {
    r = parseInt(hexStr.slice(0, 2), 16) / 255;
    g = parseInt(hexStr.slice(2, 4), 16) / 255;
    b = parseInt(hexStr.slice(4, 6), 16) / 255;
    a = parseInt(hexStr.slice(6, 8), 16) / 255;
  }
  return [r, g, b, a];
}

const bgVertexShader = `
attribute vec2 uv;
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0, 1);
}
`;

const bgFragmentShader = `
precision highp float;

#define PI 3.14159265359

uniform float iTime;
uniform vec3 iResolution;
uniform float uSpinRotation;
uniform float uSpinSpeed;
uniform vec2 uOffset;
uniform vec4 uColor1;
uniform vec4 uColor2;
uniform vec4 uColor3;
uniform float uContrast;
uniform float uLighting;
uniform float uSpinAmount;
uniform float uPixelFilter;
uniform float uSpinEase;
uniform bool uIsRotate;
uniform vec2 uMouse;

varying vec2 vUv;

vec4 effect(vec2 screenSize, vec2 screen_coords) {
    float pixel_size = length(screenSize.xy) / uPixelFilter;
    vec2 uv = (floor(screen_coords.xy * (1.0 / pixel_size)) * pixel_size - 0.5 * screenSize.xy) / length(screenSize.xy) - uOffset;
    float uv_len = length(uv);

    float speed = (uSpinRotation * uSpinEase * 0.2);
    if(uIsRotate){
       speed = iTime * speed;
    }
    speed += 302.2;

    float mouseInfluence = (uMouse.x * 2.0 - 1.0);
    speed += mouseInfluence * 0.1;

    float new_pixel_angle = atan(uv.y, uv.x) + speed - uSpinEase * 20.0 * (uSpinAmount * uv_len + (1.0 - uSpinAmount));
    vec2 mid = (screenSize.xy / length(screenSize.xy)) / 2.0;
    uv = (vec2(uv_len * cos(new_pixel_angle) + mid.x, uv_len * sin(new_pixel_angle) + mid.y) - mid);

    uv *= 30.0;
    float baseSpeed = iTime * uSpinSpeed;
    speed = baseSpeed + mouseInfluence * 2.0;

    vec2 uv2 = vec2(uv.x + uv.y);

    for(int i = 0; i < 5; i++) {
        uv2 += sin(max(uv.x, uv.y)) + uv;
        uv += 0.5 * vec2(
            cos(5.1123314 + 0.353 * uv2.y + speed * 0.131121),
            sin(uv2.x - 0.113 * speed)
        );
        uv -= cos(uv.x + uv.y) - sin(uv.x * 0.711 - uv.y);
    }

    float contrast_mod = (0.25 * uContrast + 0.5 * uSpinAmount + 1.2);
    float paint_res = min(2.0, max(0.0, length(uv) * 0.035 * contrast_mod));
    float c1p = max(0.0, 1.0 - contrast_mod * abs(1.0 - paint_res));
    float c2p = max(0.0, 1.0 - contrast_mod * abs(paint_res));
    float c3p = 1.0 - min(1.0, c1p + c2p);
    float light = (uLighting - 0.2) * max(c1p * 5.0 - 4.0, 0.0) + uLighting * max(c2p * 5.0 - 4.0, 0.0);

    return (0.3 / uContrast) * uColor1 + (1.0 - 0.3 / uContrast) * (uColor1 * c1p + uColor2 * c2p + vec4(c3p * uColor3.rgb, c3p * uColor1.a)) + light;
}

void main() {
    vec2 uv = vUv * iResolution.xy;
    gl_FragColor = effect(iResolution.xy, uv);
}
`;

function CustomersBackground({
  spinRotation = -1.4,
  spinSpeed = 3.2,
  offset = [0.0, 0.0],
  color1 = "#0b0f1a", // navy base
  color2 = "#7c3aed", // purple
  color3 = "#14b8a6", // teal
  contrast = 3.0,
  lighting = 0.35,
  spinAmount = 0.22,
  pixelFilter = 900.0,
  spinEase = 1.0,
  isRotate = false,
  mouseInteraction = true,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const renderer = new Renderer({ alpha: true });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    let program;

    function resize() {
      renderer.setSize(container.offsetWidth, container.offsetHeight);
      if (program) {
        program.uniforms.iResolution.value = [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height];
      }
    }
    window.addEventListener("resize", resize);
    resize();

    const geometry = new Triangle(gl);
    program = new Program(gl, {
      vertex: bgVertexShader,
      fragment: bgFragmentShader,
      uniforms: {
        iTime: { value: 0 },
        iResolution: {
          value: [gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height],
        },
        uSpinRotation: { value: spinRotation },
        uSpinSpeed: { value: spinSpeed },
        uOffset: { value: offset },
        uColor1: { value: hexToVec4(color1) },
        uColor2: { value: hexToVec4(color2) },
        uColor3: { value: hexToVec4(color3) },
        uContrast: { value: contrast },
        uLighting: { value: lighting },
        uSpinAmount: { value: spinAmount },
        uPixelFilter: { value: pixelFilter },
        uSpinEase: { value: spinEase },
        uIsRotate: { value: isRotate },
        uMouse: { value: [0.5, 0.5] },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    let animationFrameId;

    function update(time) {
      animationFrameId = requestAnimationFrame(update);
      program.uniforms.iTime.value = time * 0.001;
      renderer.render({ scene: mesh });
    }
    animationFrameId = requestAnimationFrame(update);

    gl.canvas.className = "cust-bg-canvas";
    container.appendChild(gl.canvas);

    function handleMouseMove(e) {
      if (!mouseInteraction) return;
      const rect = container.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = 1.0 - (e.clientY - rect.top) / rect.height;
      program.uniforms.uMouse.value = [x, y];
    }
    container.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener("resize", resize);
      container.removeEventListener("mousemove", handleMouseMove);
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [
    spinRotation,
    spinSpeed,
    offset,
    color1,
    color2,
    color3,
    contrast,
    lighting,
    spinAmount,
    pixelFilter,
    spinEase,
    isRotate,
    mouseInteraction,
  ]);

  return <div ref={containerRef} className="cust-bg-container" aria-hidden="true" />;
}

/* ---------------------------------------------------------------- */

function Customers({ business, appUser }) {
  const [customers, setCustomers] = useState([]);
  const [invoicesByCustomer, setInvoicesByCustomer] = useState({});
  const [quotesByCustomer, setQuotesByCustomer] = useState({});
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("recent");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState({ name: "", email: "", phone: "", notes: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  const [drawerCustomer, setDrawerCustomer] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const [{ data: customersData }, { data: invoicesData }, { data: quotesData }] = await Promise.all([
      supabase.from("customers").select("*").eq("business_id", business.id).order("created_at", { ascending: false }),
      supabase.from("invoices").select("id, customer_id, invoice_number, status, total, due_date, created_at").eq("business_id", business.id),
      supabase.from("quotes").select("id, customer_id, quote_number, status, total, created_at").eq("business_id", business.id),
    ]);

    const invGroups = {};
    (invoicesData || []).forEach((inv) => {
      if (!inv.customer_id) return;
      (invGroups[inv.customer_id] ||= []).push(inv);
    });

    const qGroups = {};
    (quotesData || []).forEach((q) => {
      if (!q.customer_id) return;
      (qGroups[q.customer_id] ||= []).push(q);
    });

    setCustomers(customersData || []);
    setInvoicesByCustomer(invGroups);
    setQuotesByCustomer(qGroups);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!loading) {
      const t = setTimeout(() => setLoaded(true), 40);
      return () => clearTimeout(t);
    }
  }, [loading]);

  // Keep the open drawer's data in sync after edits/refetches.
  useEffect(() => {
    if (!drawerCustomer) return;
    const fresh = customers.find((c) => c.id === drawerCustomer.id);
    if (fresh) setDrawerCustomer(fresh);
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  const financials = useMemo(() => {
    const map = {};
    customers.forEach((c) => {
      const invoices = invoicesByCustomer[c.id] || [];
      const quotes = quotesByCustomer[c.id] || [];
      const totalInvoiced = invoices.reduce((sum, i) => sum + Number(i.total || 0), 0);
      const outstanding = invoices
        .filter((i) => i.status === "unpaid" || i.status === "overdue")
        .reduce((sum, i) => sum + Number(i.total || 0), 0);
      map[c.id] = {
        totalInvoiced,
        outstanding,
        invoicesCount: invoices.length,
        quotesCount: quotes.length,
      };
    });
    return map;
  }, [customers, invoicesByCustomer, quotesByCustomer]);

  const visibleCustomers = useMemo(() => {
    let list = customers;

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q)
      );
    }

    const withFinancials = list.map((c) => ({ ...c, _f: financials[c.id] || { totalInvoiced: 0, outstanding: 0, quotesCount: 0 } }));

    switch (sortKey) {
      case "name_asc":
        return withFinancials.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      case "name_desc":
        return withFinancials.sort((a, b) => (b.name || "").localeCompare(a.name || ""));
      case "invoiced_desc":
        return withFinancials.sort((a, b) => b._f.totalInvoiced - a._f.totalInvoiced);
      case "outstanding_desc":
        return withFinancials.sort((a, b) => b._f.outstanding - a._f.outstanding);
      default:
        return withFinancials.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  }, [customers, query, sortKey, financials]);

  const openAddModal = () => {
    setEditingCustomer(null);
    setForm({ name: "", email: "", phone: "", notes: "" });
    setError("");
    setModalOpen(true);
  };

  const openEditModal = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name || "",
      email: customer.email || "",
      phone: customer.phone || "",
      notes: customer.notes || "",
    });
    setError("");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingCustomer(null);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setError("");
    setSaving(true);

    if (editingCustomer) {
      const { error: updateError } = await supabase
        .from("customers")
        .update({ name: form.name, email: form.email, phone: form.phone, notes: form.notes })
        .eq("id", editingCustomer.id);

      if (updateError) {
        setSaving(false);
        return setError(updateError.message);
      }
    } else {
      const { error: insertError } = await supabase.from("customers").insert({
        business_id: business.id,
        name: form.name,
        email: form.email,
        phone: form.phone,
        notes: form.notes,
      });

      if (insertError) {
        setSaving(false);
        return setError(insertError.message);
      }

      notify(business.id, appUser?.id, `New customer "${form.name}" was added.`);
    }

    setSaving(false);
    closeModal();
    fetchAll();
  };

  const handleDelete = async (customer) => {
    setPendingDeleteId(null);
    const { error: deleteError } = await supabase.from("customers").delete().eq("id", customer.id);
    if (!deleteError) {
      if (drawerCustomer?.id === customer.id) setDrawerCustomer(null);
      fetchAll();
    }
  };

  return (
    <div className="cust-page">
      <CustomersBackground isRotate={false} mouseInteraction />
      <div className="cust-page-overlay" />

      <div className="cust-page-content">
        <AppNav business={business} />

        <div className="cust-body">
          <div className={`cust-header ${loaded ? "cust-in" : ""}`}>
            <div>
              <p className="cust-eyebrow">Customers</p>
              <h1 className="cust-heading">Your customer records</h1>
            </div>
            <button className="cust-add-btn" onClick={openAddModal}>
              + Add customer
            </button>
          </div>

          <div className={`cust-toolbar ${loaded ? "cust-in" : ""}`}>
            <div className="cust-search">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                placeholder="Search by name, email, or phone..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="cust-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                  ×
                </button>
              )}
            </div>

            <div className="cust-sort">
              <label htmlFor="cust-sort-select">Sort</label>
              <select id="cust-sort-select" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loading ? (
            <div className="cust-table-wrap cust-in mkt-in">
              <div className="cust-skeleton">
                {[...Array(4)].map((_, i) => (
                  <div className="cust-skeleton-row" key={i} style={{ animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </div>
          ) : customers.length === 0 ? (
            <div className="cust-empty cust-in">
              <div className="cust-empty-icon">+</div>
              <h3>No customers yet</h3>
              <p>Add your first customer to start tracking quotes and invoices for them.</p>
              <button className="cust-add-btn" onClick={openAddModal}>
                + Add customer
              </button>
            </div>
          ) : visibleCustomers.length === 0 ? (
            <div className="cust-empty cust-in">
              <div className="cust-empty-icon">?</div>
              <h3>No matches for "{query}"</h3>
              <p>Try a different name, email, or phone number.</p>
              <button className="cust-inline-link" onClick={() => setQuery("")}>
                Clear search
              </button>
            </div>
          ) : (
            <div className={`cust-table-wrap ${loaded ? "cust-in" : ""}`}>
              <table className="cust-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Contact</th>
                    <th>Invoiced</th>
                    <th>Outstanding</th>
                    <th>Quotes</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCustomers.map((c, i) => (
                    <tr
                      key={c.id}
                      className="cust-row"
                      style={{ animationDelay: loaded ? `${Math.min(i, 12) * 35}ms` : "0ms" }}
                      onClick={() => setDrawerCustomer(c)}
                    >
                      <td className="cust-name-cell">{c.name}</td>
                      <td>
                        <div className="cust-contact-cell">
                          <span className={c.email ? "" : "cust-muted"}>{c.email || "—"}</span>
                          <span className={c.phone ? "cust-contact-sub" : "cust-muted cust-contact-sub"}>
                            {c.phone || "No phone"}
                          </span>
                        </div>
                      </td>
                      <td className={c._f.totalInvoiced ? "cust-amount" : "cust-muted"}>
                        {c._f.totalInvoiced ? currency.format(c._f.totalInvoiced) : "—"}
                      </td>
                      <td>
                        {c._f.outstanding > 0 ? (
                          <span className="cust-badge cust-badge--warn">{currency.format(c._f.outstanding)}</span>
                        ) : (
                          <span className="cust-muted">—</span>
                        )}
                      </td>
                      <td className={c._f.quotesCount ? "" : "cust-muted"}>{c._f.quotesCount || "—"}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {pendingDeleteId === c.id ? (
                          <div className="cust-confirm-row">
                            <button className="cust-confirm-yes" onClick={() => handleDelete(c)}>
                              Delete
                            </button>
                            <button className="cust-confirm-no" onClick={() => setPendingDeleteId(null)}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="cust-actions-cell">
                            <button className="cust-action-btn" onClick={() => openEditModal(c)}>
                              Edit
                            </button>
                            <button
                              className="cust-action-btn cust-action-btn--danger"
                              onClick={() => setPendingDeleteId(c.id)}
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

        {/* Add / edit modal */}
        {modalOpen && (
          <div className="cust-modal-overlay" onClick={closeModal}>
            <div className="cust-modal" onClick={(e) => e.stopPropagation()}>
              <h2>{editingCustomer ? "Edit customer" : "Add customer"}</h2>
              <form onSubmit={handleSave}>
                <label className="cust-label">Name</label>
                <input
                  className="cust-input"
                  placeholder="Customer name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                />

                <label className="cust-label">Email</label>
                <input
                  className="cust-input"
                  type="email"
                  placeholder="customer@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />

                <label className="cust-label">Phone</label>
                <input
                  className="cust-input"
                  placeholder="081 234 5678"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />

                <label className="cust-label">Notes</label>
                <textarea
                  className="cust-input"
                  rows={3}
                  placeholder="Optional notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />

                {error && <p className="cust-error">{error}</p>}

                <div className="cust-modal-actions">
                  <button type="button" className="cust-cancel-btn" onClick={closeModal}>
                    Cancel
                  </button>
                  <button type="submit" className="cust-add-btn" disabled={saving}>
                    {saving ? <span className="cust-spinner" /> : editingCustomer ? "Save changes" : "Add customer"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Detail drawer */}
        {drawerCustomer && (
          <div className="cust-drawer-overlay" onClick={() => setDrawerCustomer(null)}>
            <div className="cust-drawer" onClick={(e) => e.stopPropagation()}>
              <div className="cust-drawer-header">
                <div className="cust-drawer-avatar">
                  {(drawerCustomer.name || "?")
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((w) => w[0]?.toUpperCase())
                    .join("")}
                </div>
                <div>
                  <h2>{drawerCustomer.name}</h2>
                  <p>
                    {drawerCustomer.email || "No email"} · {drawerCustomer.phone || "No phone"}
                  </p>
                </div>
                <button className="cust-drawer-close" onClick={() => setDrawerCustomer(null)} aria-label="Close">
                  ×
                </button>
              </div>

              <div className="cust-stat-row">
                <div className="cust-stat-card">
                  <span className="cust-stat-label">Total invoiced</span>
                  <span className="cust-stat-value">
                    {currency.format(financials[drawerCustomer.id]?.totalInvoiced || 0)}
                  </span>
                </div>
                <div className="cust-stat-card">
                  <span className="cust-stat-label">Outstanding</span>
                  <span
                    className={`cust-stat-value ${
                      financials[drawerCustomer.id]?.outstanding > 0 ? "cust-stat-value--warn" : ""
                    }`}
                  >
                    {currency.format(financials[drawerCustomer.id]?.outstanding || 0)}
                  </span>
                </div>
                <div className="cust-stat-card">
                  <span className="cust-stat-label">Quotes</span>
                  <span className="cust-stat-value">{financials[drawerCustomer.id]?.quotesCount || 0}</span>
                </div>
              </div>

              {drawerCustomer.notes && (
                <div className="cust-drawer-notes">
                  <p className="cust-drawer-section-title">Notes</p>
                  <p>{drawerCustomer.notes}</p>
                </div>
              )}

              <div className="cust-drawer-section">
                <p className="cust-drawer-section-title">Invoices</p>
                {(invoicesByCustomer[drawerCustomer.id] || []).length === 0 ? (
                  <p className="cust-drawer-empty">No invoices for this customer yet.</p>
                ) : (
                  <ul className="cust-drawer-list">
                    {(invoicesByCustomer[drawerCustomer.id] || [])
                      .slice()
                      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                      .map((inv) => (
                        <li key={inv.id}>
                          <div>
                            <span className="cust-drawer-list-title">{inv.invoice_number}</span>
                            <span className="cust-drawer-list-sub">Due {dateFmt(inv.due_date)}</span>
                          </div>
                          <div className="cust-drawer-list-right">
                            <span className={`cust-badge ${STATUS_STYLES[inv.status] || "cust-badge--muted"}`}>
                              {inv.status}
                            </span>
                            <span className="cust-drawer-list-amount">{currency.format(inv.total || 0)}</span>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="cust-drawer-section">
                <p className="cust-drawer-section-title">Quotes</p>
                {(quotesByCustomer[drawerCustomer.id] || []).length === 0 ? (
                  <p className="cust-drawer-empty">No quotes for this customer yet.</p>
                ) : (
                  <ul className="cust-drawer-list">
                    {(quotesByCustomer[drawerCustomer.id] || [])
                      .slice()
                      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                      .map((q) => (
                        <li key={q.id}>
                          <div>
                            <span className="cust-drawer-list-title">{q.quote_number}</span>
                            <span className="cust-drawer-list-sub">{dateFmt(q.created_at)}</span>
                          </div>
                          <div className="cust-drawer-list-right">
                            <span className={`cust-badge ${STATUS_STYLES[q.status] || "cust-badge--muted"}`}>
                              {q.status}
                            </span>
                            <span className="cust-drawer-list-amount">{currency.format(q.total || 0)}</span>
                          </div>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <div className="cust-drawer-footer">
                <button
                  className="cust-cancel-btn"
                  onClick={() => {
                    const c = drawerCustomer;
                    setDrawerCustomer(null);
                    openEditModal(c);
                  }}
                >
                  Edit customer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default Customers;