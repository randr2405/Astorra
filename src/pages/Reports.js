import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import { supabase } from "../lib/supabaseClient";
import AppNav from "../components/AppNav";
import "./Reports.css";

// ---------- GradientBlinds background (inlined, no separate file) ----------

const MAX_COLORS = 8;
const hexToRGB = (hex) => {
  const c = hex.replace("#", "").padEnd(6, "0");
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return [r, g, b];
};
const prepStops = (stops) => {
  const base = (stops && stops.length ? stops : ["#FF9FFC", "#5227FF"]).slice(0, MAX_COLORS);
  if (base.length === 1) base.push(base[0]);
  while (base.length < MAX_COLORS) base.push(base[base.length - 1]);
  const arr = [];
  for (let i = 0; i < MAX_COLORS; i++) arr.push(hexToRGB(base[i]));
  const count = Math.max(2, Math.min(MAX_COLORS, stops?.length ?? 2));
  return { arr, count };
};

function GradientBlinds({
  className,
  dpr,
  paused = false,
  gradientColors,
  angle = 0,
  noise = 0.3,
  blindCount = 16,
  blindMinWidth = 60,
  mouseDampening = 0.15,
  mirrorGradient = false,
  spotlightRadius = 0.5,
  spotlightSoftness = 1,
  spotlightOpacity = 1,
  distortAmount = 0,
  shineDirection = "left",
  mixBlendMode = "lighten",
}) {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const programRef = useRef(null);
  const meshRef = useRef(null);
  const geometryRef = useRef(null);
  const rendererRef = useRef(null);
  const mouseTargetRef = useRef([0, 0]);
  const lastTimeRef = useRef(0);
  const firstResizeRef = useRef(true);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      dpr: dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
      alpha: true,
      antialias: true,
    });
    rendererRef.current = renderer;
    const gl = renderer.gl;
    const canvas = gl.canvas;

    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

    const fragment = `
#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform float uAngle;
uniform float uNoise;
uniform float uBlindCount;
uniform float uSpotlightRadius;
uniform float uSpotlightSoftness;
uniform float uSpotlightOpacity;
uniform float uMirror;
uniform float uDistort;
uniform float uShineFlip;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

varying vec2 vUv;

float rand(vec2 co){
  return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
}

vec2 rotate2D(vec2 p, float a){
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec3 getGradientColor(float t){
  float tt = clamp(t, 0.0, 1.0);
  int count = uColorCount;
  if (count < 2) count = 2;
  float scaled = tt * float(count - 1);
  float seg = floor(scaled);
  float f = fract(scaled);

  if (seg < 1.0) return mix(uColor0, uColor1, f);
  if (seg < 2.0 && count > 2) return mix(uColor1, uColor2, f);
  if (seg < 3.0 && count > 3) return mix(uColor2, uColor3, f);
  if (seg < 4.0 && count > 4) return mix(uColor3, uColor4, f);
  if (seg < 5.0 && count > 5) return mix(uColor4, uColor5, f);
  if (seg < 6.0 && count > 6) return mix(uColor5, uColor6, f);
  if (seg < 7.0 && count > 7) return mix(uColor6, uColor7, f);
  if (count > 7) return uColor7;
  if (count > 6) return uColor6;
  if (count > 5) return uColor5;
  if (count > 4) return uColor4;
  if (count > 3) return uColor3;
  if (count > 2) return uColor2;
  return uColor1;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv0 = fragCoord.xy / iResolution.xy;

    float aspect = iResolution.x / iResolution.y;
    vec2 p = uv0 * 2.0 - 1.0;
    p.x *= aspect;
    vec2 pr = rotate2D(p, uAngle);
    pr.x /= aspect;
    vec2 uv = pr * 0.5 + 0.5;

    vec2 uvMod = uv;
    if (uDistort > 0.0) {
      float a = uvMod.y * 6.0;
      float b = uvMod.x * 6.0;
      float w = 0.01 * uDistort;
      uvMod.x += sin(a) * w;
      uvMod.y += cos(b) * w;
    }
    float t = uvMod.x;
    if (uMirror > 0.5) {
      t = 1.0 - abs(1.0 - 2.0 * fract(t));
    }
    vec3 base = getGradientColor(t);

    vec2 offset = vec2(iMouse.x/iResolution.x, iMouse.y/iResolution.y);
  float d = length(uv0 - offset);
  float r = max(uSpotlightRadius, 1e-4);
  float dn = d / r;
  float spot = (1.0 - 2.0 * pow(dn, uSpotlightSoftness)) * uSpotlightOpacity;
  vec3 cir = vec3(spot);
  float stripe = fract(uvMod.x * max(uBlindCount, 1.0));
  if (uShineFlip > 0.5) stripe = 1.0 - stripe;
    vec3 ran = vec3(stripe);

    vec3 col = cir + base - ran;
    col += (rand(gl_FragCoord.xy + iTime) - 0.5) * uNoise;

    fragColor = vec4(col, 1.0);
}

void main() {
    vec4 color;
    mainImage(color, vUv * iResolution.xy);
    gl_FragColor = color;
}
`;

    const { arr: colorArr, count: colorCount } = prepStops(gradientColors);
    const uniforms = {
      iResolution: {
        value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1],
      },
      iMouse: { value: [0, 0] },
      iTime: { value: 0 },
      uAngle: { value: (angle * Math.PI) / 180 },
      uNoise: { value: noise },
      uBlindCount: { value: Math.max(1, blindCount) },
      uSpotlightRadius: { value: spotlightRadius },
      uSpotlightSoftness: { value: spotlightSoftness },
      uSpotlightOpacity: { value: spotlightOpacity },
      uMirror: { value: mirrorGradient ? 1 : 0 },
      uDistort: { value: distortAmount },
      uShineFlip: { value: shineDirection === "right" ? 1 : 0 },
      uColor0: { value: colorArr[0] },
      uColor1: { value: colorArr[1] },
      uColor2: { value: colorArr[2] },
      uColor3: { value: colorArr[3] },
      uColor4: { value: colorArr[4] },
      uColor5: { value: colorArr[5] },
      uColor6: { value: colorArr[6] },
      uColor7: { value: colorArr[7] },
      uColorCount: { value: colorCount },
    };

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms,
    });
    programRef.current = program;

    const geometry = new Triangle(gl);
    geometryRef.current = geometry;
    const mesh = new Mesh(gl, { geometry, program });
    meshRef.current = mesh;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height);
      uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];

      if (blindMinWidth && blindMinWidth > 0) {
        const maxByMinWidth = Math.max(1, Math.floor(rect.width / blindMinWidth));

        const effective = blindCount ? Math.min(blindCount, maxByMinWidth) : maxByMinWidth;
        uniforms.uBlindCount.value = Math.max(1, effective);
      } else {
        uniforms.uBlindCount.value = Math.max(1, blindCount);
      }

      if (firstResizeRef.current) {
        firstResizeRef.current = false;
        const cx = gl.drawingBufferWidth / 2;
        const cy = gl.drawingBufferHeight / 2;
        uniforms.iMouse.value = [cx, cy];
        mouseTargetRef.current = [cx, cy];
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const onPointerMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const scale = renderer.dpr || 1;
      const x = (e.clientX - rect.left) * scale;
      const y = (rect.height - (e.clientY - rect.top)) * scale;
      mouseTargetRef.current = [x, y];
      if (mouseDampening <= 0) {
        uniforms.iMouse.value = [x, y];
      }
    };
    canvas.addEventListener("pointermove", onPointerMove);

    const loop = (t) => {
      rafRef.current = requestAnimationFrame(loop);
      uniforms.iTime.value = t * 0.001;
      if (mouseDampening > 0) {
        if (!lastTimeRef.current) lastTimeRef.current = t;
        const dt = (t - lastTimeRef.current) / 1000;
        lastTimeRef.current = t;
        const tau = Math.max(1e-4, mouseDampening);
        let factor = 1 - Math.exp(-dt / tau);
        if (factor > 1) factor = 1;
        const target = mouseTargetRef.current;
        const cur = uniforms.iMouse.value;
        cur[0] += (target[0] - cur[0]) * factor;
        cur[1] += (target[1] - cur[1]) * factor;
      } else {
        lastTimeRef.current = t;
      }
      if (!paused && programRef.current && meshRef.current) {
        try {
          renderer.render({ scene: meshRef.current });
        } catch (e) {
          console.error(e);
        }
      }
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      canvas.removeEventListener("pointermove", onPointerMove);
      ro.disconnect();
      if (canvas.parentElement === container) {
        container.removeChild(canvas);
      }
      const callIfFn = (obj, key) => {
        if (obj && typeof obj[key] === "function") {
          obj[key].call(obj);
        }
      };
      callIfFn(programRef.current, "remove");
      callIfFn(geometryRef.current, "remove");
      callIfFn(meshRef.current, "remove");
      callIfFn(rendererRef.current, "destroy");
      programRef.current = null;
      geometryRef.current = null;
      meshRef.current = null;
      rendererRef.current = null;
    };
  }, [
    dpr,
    paused,
    gradientColors,
    angle,
    noise,
    blindCount,
    blindMinWidth,
    mouseDampening,
    mirrorGradient,
    spotlightRadius,
    spotlightSoftness,
    spotlightOpacity,
    distortAmount,
    shineDirection,
  ]);

  return (
    <div
      ref={containerRef}
      className={`gradient-blinds-container ${className || ""}`}
      style={{
        ...(mixBlendMode && {
          mixBlendMode: mixBlendMode,
        }),
      }}
    />
  );
}

const currency = new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" });
const shortCurrency = (n) => {
  if (n >= 1000000) return `R${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `R${(n / 1000).toFixed(1)}k`;
  return `R${Math.round(n)}`;
};

// Aging buckets for overdue invoices, in days past due_date.
const AGING_BUCKETS = [
  { key: "0-30", label: "0–30 days", min: 0, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "90+", label: "90+ days", min: 91, max: Infinity },
];

function daysPastDue(dueDate) {
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.floor((today - due) / 86400000);
}

// Builds the last `count` calendar months as {key: "2026-01", label: "Jan"} ascending,
// ending with the current month. Used to bucket invoices/staff by month without
// depending on there being any data in every month.
function lastNMonths(count) {
  const months = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-ZA", { month: "short" });
    months.push({ key, label });
  }
  return months;
}

function monthKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---------- Small inline chart primitives (no chart library dependency) ----------

function BarChart({ data, valueFormatter = (v) => v, height = 180 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="rep-barchart" style={{ height }}>
      {data.map((d) => {
        const pct = Math.max(2, Math.round((d.value / max) * 100));
        return (
          <div className="rep-bar-col" key={d.key}>
            <div className="rep-bar-track">
              <div
                className="rep-bar-fill"
                style={{ height: `${pct}%` }}
                title={valueFormatter(d.value)}
              />
            </div>
            <span className="rep-bar-value">{d.value > 0 ? valueFormatter(d.value) : ""}</span>
            <span className="rep-bar-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ data, valueFormatter = (v) => v, height = 140 }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 560;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = i * stepX;
    const y = height - (d.value / max) * (height - 24) - 4;
    return { x, y, ...d };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1]?.x || 0},${height} L0,${height} Z`;

  return (
    <div className="rep-linechart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="rep-linechart-svg">
        <path d={areaD} className="rep-linechart-area" />
        <path d={pathD} className="rep-linechart-line" fill="none" />
        {points.map((p) => (
          <circle key={p.key} cx={p.x} cy={p.y} r="3.5" className="rep-linechart-dot">
            <title>{`${p.label}: ${valueFormatter(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="rep-linechart-labels">
        {data.map((d) => (
          <span key={d.key}>{d.label}</span>
        ))}
      </div>
    </div>
  );
}

function Reports({ business }) {
  const [invoices, setInvoices] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState(6); // months shown in the time-series charts

  const fetchAll = useCallback(async () => {
    setLoading(true);

    const [{ data: invoicesData }, { data: quotesData }, { data: staffData }] = await Promise.all([
      supabase
        .from("invoices")
        .select("id, customer_id, status, total, due_date, created_at, customers(name)")
        .eq("business_id", business.id),
      supabase
        .from("quotes")
        .select("id, status, total, created_at")
        .eq("business_id", business.id),
      supabase
        .from("staff")
        .select("id, employment_status, created_at")
        .eq("business_id", business.id),
    ]);

    setInvoices(invoicesData || []);
    setQuotes(quotesData || []);
    setStaff(staffData || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // ---------- Top-line stats ----------
  const stats = useMemo(() => {
    const totalRevenue = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const outstanding = invoices
      .filter((i) => i.status !== "paid")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const overdueTotal = invoices
      .filter((i) => i.status === "overdue")
      .reduce((sum, i) => sum + Number(i.total || 0), 0);
    const quoteWinRate = (() => {
      const decided = quotes.filter((q) => q.status === "accepted" || q.status === "declined");
      if (decided.length === 0) return null;
      const accepted = decided.filter((q) => q.status === "accepted").length;
      return Math.round((accepted / decided.length) * 100);
    })();
    const activeStaff = staff.filter((s) => (s.employment_status || "active") === "active").length;

    return { totalRevenue, outstanding, overdueTotal, quoteWinRate, activeStaff };
  }, [invoices, quotes, staff]);

  // ---------- Revenue over time (paid invoices, by month) ----------
  const revenueByMonth = useMemo(() => {
    const months = lastNMonths(range);
    const totals = Object.fromEntries(months.map((m) => [m.key, 0]));
    invoices
      .filter((i) => i.status === "paid")
      .forEach((i) => {
        const key = monthKey(i.created_at);
        if (key in totals) totals[key] += Number(i.total || 0);
      });
    return months.map((m) => ({ key: m.key, label: m.label, value: totals[m.key] }));
  }, [invoices, range]);

  // ---------- Top customers by total invoiced ----------
  const topCustomers = useMemo(() => {
    const byCustomer = {};
    invoices.forEach((i) => {
      if (!i.customer_id) return;
      const name = i.customers?.name || "Unknown customer";
      if (!byCustomer[i.customer_id]) {
        byCustomer[i.customer_id] = { name, total: 0, count: 0, outstanding: 0 };
      }
      byCustomer[i.customer_id].total += Number(i.total || 0);
      byCustomer[i.customer_id].count += 1;
      if (i.status !== "paid") byCustomer[i.customer_id].outstanding += Number(i.total || 0);
    });
    return Object.values(byCustomer)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [invoices]);

  // ---------- Overdue aging ----------
  const agingBuckets = useMemo(() => {
    const buckets = Object.fromEntries(AGING_BUCKETS.map((b) => [b.key, { total: 0, count: 0 }]));
    invoices
      .filter((i) => i.status === "overdue" && i.due_date)
      .forEach((i) => {
        const days = daysPastDue(i.due_date);
        const bucket = AGING_BUCKETS.find((b) => days >= b.min && days <= b.max);
        if (bucket) {
          buckets[bucket.key].total += Number(i.total || 0);
          buckets[bucket.key].count += 1;
        }
      });
    return AGING_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      value: buckets[b.key].total,
      count: buckets[b.key].count,
    }));
  }, [invoices]);

  // ---------- Staff headcount trend (cumulative, by month) ----------
  const headcountTrend = useMemo(() => {
    const months = lastNMonths(range);
    return months.map((m) => {
      // Count everyone whose start-of-record (created_at) falls on or before
      // the end of this month — a running headcount, not new-hires-per-month.
      const [y, mo] = m.key.split("-").map(Number);
      const monthEnd = new Date(y, mo, 0, 23, 59, 59);
      const count = staff.filter((s) => new Date(s.created_at) <= monthEnd).length;
      return { key: m.key, label: m.label, value: count };
    });
  }, [staff, range]);

  const hasAnyData = invoices.length > 0 || quotes.length > 0 || staff.length > 0;

  return (
    <div className="rep-page">
      <div className="rep-bg">
        <GradientBlinds
          gradientColors={["#7c3aed", "#3b82f6", "#14b8a6"]}
          angle={20}
          noise={0.5}
          blindCount={16}
          blindMinWidth={60}
          spotlightRadius={0.5}
          spotlightSoftness={1}
          spotlightOpacity={1}
          mouseDampening={0.15}
          distortAmount={0}
          shineDirection="left"
          mixBlendMode="lighten"
        />
      </div>

      <AppNav business={business} />

      <div className="rep-body">
        <div className="rep-header">
          <div>
            <p className="rep-eyebrow">Reports</p>
            <h1 className="rep-heading">How your business is doing</h1>
          </div>
          <div className="rep-range-toggle">
            {[3, 6, 12].map((n) => (
              <button
                key={n}
                className={`rep-range-btn ${range === n ? "rep-range-btn--active" : ""}`}
                onClick={() => setRange(n)}
              >
                {n} mo
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="rep-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="rep-skeleton-card" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : !hasAnyData ? (
          <div className="rep-empty">
            <p>No data yet.</p>
            <p className="rep-empty-sub">
              Once you've sent a few quotes or invoices, this page will fill in with your revenue,
              top customers, and overdue tracking automatically.
            </p>
          </div>
        ) : (
          <>
            <div className="rep-stats">
              <div className="rep-stat-card">
                <p className="rep-stat-label">Revenue (paid)</p>
                <p className="rep-stat-value">{currency.format(stats.totalRevenue)}</p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Outstanding</p>
                <p className="rep-stat-value">{currency.format(stats.outstanding)}</p>
              </div>
              <div className={`rep-stat-card ${stats.overdueTotal > 0 ? "rep-stat-card--warn" : ""}`}>
                <p className="rep-stat-label">Overdue</p>
                <p className="rep-stat-value">{currency.format(stats.overdueTotal)}</p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Quote win rate</p>
                <p className="rep-stat-value">
                  {stats.quoteWinRate === null ? "—" : `${stats.quoteWinRate}%`}
                </p>
              </div>
              <div className="rep-stat-card">
                <p className="rep-stat-label">Active staff</p>
                <p className="rep-stat-value">{stats.activeStaff}</p>
              </div>
            </div>

            <div className="rep-grid">
              <div className="rep-panel rep-panel--wide">
                <h2 className="rep-panel-title">Revenue over time</h2>
                <p className="rep-panel-sub">Paid invoices, by month</p>
                <BarChart data={revenueByMonth} valueFormatter={shortCurrency} />
              </div>

              <div className="rep-panel">
                <h2 className="rep-panel-title">Top customers</h2>
                <p className="rep-panel-sub">By total invoiced</p>
                {topCustomers.length === 0 ? (
                  <p className="rep-panel-empty">No invoiced customers yet.</p>
                ) : (
                  <div className="rep-top-customers">
                    {topCustomers.map((c, i) => (
                      <div className="rep-top-customer-row" key={c.name + i}>
                        <span className="rep-top-customer-rank">{i + 1}</span>
                        <div className="rep-top-customer-main">
                          <span className="rep-top-customer-name">{c.name}</span>
                          <span className="rep-top-customer-sub">
                            {c.count} invoice{c.count === 1 ? "" : "s"}
                            {c.outstanding > 0 && ` · ${currency.format(c.outstanding)} outstanding`}
                          </span>
                        </div>
                        <span className="rep-top-customer-total">{currency.format(c.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rep-panel">
                <h2 className="rep-panel-title">Overdue aging</h2>
                <p className="rep-panel-sub">How late your unpaid invoices are</p>
                {stats.overdueTotal === 0 ? (
                  <p className="rep-panel-empty">Nothing overdue right now.</p>
                ) : (
                  <div className="rep-aging-list">
                    {agingBuckets.map((b) => (
                      <div className="rep-aging-row" key={b.key}>
                        <span className="rep-aging-label">{b.label}</span>
                        <div className="rep-aging-track">
                          <div
                            className="rep-aging-fill"
                            style={{
                              width: `${
                                stats.overdueTotal > 0
                                  ? Math.max(2, Math.round((b.value / stats.overdueTotal) * 100))
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <span className="rep-aging-value">
                          {b.value > 0 ? currency.format(b.value) : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rep-panel rep-panel--wide">
                <h2 className="rep-panel-title">Staff headcount</h2>
                <p className="rep-panel-sub">Active team size, by month</p>
                {staff.length === 0 ? (
                  <p className="rep-panel-empty">No staff records yet.</p>
                ) : (
                  <LineChart data={headcountTrend} valueFormatter={(v) => `${v}`} />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default Reports;