import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import { Renderer, Program, Mesh, Color, Triangle } from "ogl";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Inventory.css";

const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const UNCATEGORIZED = "Uncategorized";

// ---------------------------------------------------------------------------
// Inlined "FaultyTerminal" shader background (previously its own component
// file). Kept in this file so Inventory.js / Inventory.css are the only two
// files involved. Colour tint is set to match the app's navy/purple/blue/teal
// scheme and rendered at low brightness/opacity so it reads as a subtle
// backdrop rather than the loud original effect.
// ---------------------------------------------------------------------------

const FAULTY_TERMINAL_VERTEX = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FAULTY_TERMINAL_FRAGMENT = `
precision mediump float;

varying vec2 vUv;

uniform float iTime;
uniform vec3  iResolution;
uniform float uScale;

uniform vec2  uGridMul;
uniform float uDigitSize;
uniform float uScanlineIntensity;
uniform float uGlitchAmount;
uniform float uFlickerAmount;
uniform float uNoiseAmp;
uniform float uChromaticAberration;
uniform float uDither;
uniform float uCurvature;
uniform vec3  uTint;
uniform vec2  uMouse;
uniform float uMouseStrength;
uniform float uUseMouse;
uniform float uPageLoadProgress;
uniform float uUsePageLoadAnimation;
uniform float uBrightness;

float time;

float hash21(vec2 p){
  p = fract(p * 234.56);
  p += dot(p, p + 34.56);
  return fract(p.x * p.y);
}

float noise(vec2 p)
{
  return sin(p.x * 10.0) * sin(p.y * (3.0 + sin(time * 0.090909))) + 0.2;
}

mat2 rotate(float angle)
{
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

float fbm(vec2 p)
{
  p *= 1.1;
  float f = 0.0;
  float amp = 0.5 * uNoiseAmp;

  mat2 modify0 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify0 * p * 2.0;
  amp *= 0.454545;

  mat2 modify1 = rotate(time * 0.02);
  f += amp * noise(p);
  p = modify1 * p * 2.0;
  amp *= 0.454545;

  mat2 modify2 = rotate(time * 0.08);
  f += amp * noise(p);

  return f;
}

float pattern(vec2 p, out vec2 q, out vec2 r) {
  vec2 offset1 = vec2(1.0);
  vec2 offset0 = vec2(0.0);
  mat2 rot01 = rotate(0.1 * time);
  mat2 rot1 = rotate(0.1);

  q = vec2(fbm(p + offset1), fbm(rot01 * p + offset1));
  r = vec2(fbm(rot1 * q + offset0), fbm(q + offset0));
  return fbm(p + r);
}

float digit(vec2 p){
    vec2 grid = uGridMul * 15.0;
    vec2 s = floor(p * grid) / grid;
    p = p * grid;
    vec2 q, r;
    float intensity = pattern(s * 0.1, q, r) * 1.3 - 0.03;

    if(uUseMouse > 0.5){
        vec2 mouseWorld = uMouse * uScale;
        float distToMouse = distance(s, mouseWorld);
        float mouseInfluence = exp(-distToMouse * 8.0) * uMouseStrength * 10.0;
        intensity += mouseInfluence;

        float ripple = sin(distToMouse * 20.0 - iTime * 5.0) * 0.1 * mouseInfluence;
        intensity += ripple;
    }

    if(uUsePageLoadAnimation > 0.5){
        float cellRandom = fract(sin(dot(s, vec2(12.9898, 78.233))) * 43758.5453);
        float cellDelay = cellRandom * 0.8;
        float cellProgress = clamp((uPageLoadProgress - cellDelay) / 0.2, 0.0, 1.0);

        float fadeAlpha = smoothstep(0.0, 1.0, cellProgress);
        intensity *= fadeAlpha;
    }

    p = fract(p);
    p *= uDigitSize;

    float px5 = p.x * 5.0;
    float py5 = (1.0 - p.y) * 5.0;
    float x = fract(px5);
    float y = fract(py5);

    float i = floor(py5) - 2.0;
    float j = floor(px5) - 2.0;
    float n = i * i + j * j;
    float f = n * 0.0625;

    float isOn = step(0.1, intensity - f);
    float brightness = isOn * (0.2 + y * 0.8) * (0.75 + x * 0.25);

    return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0) * brightness;
}

float onOff(float a, float b, float c)
{
  return step(c, sin(iTime + a * cos(iTime * b))) * uFlickerAmount;
}

float displace(vec2 look)
{
    float y = look.y - mod(iTime * 0.25, 1.0);
    float window = 1.0 / (1.0 + 50.0 * y * y);
    return sin(look.y * 20.0 + iTime) * 0.0125 * onOff(4.0, 2.0, 0.8) * (1.0 + cos(iTime * 60.0)) * window;
}

vec3 getColor(vec2 p){

    float bar = step(mod(p.y + time * 20.0, 1.0), 0.2) * 0.4 + 1.0;
    bar *= uScanlineIntensity;

    float displacement = displace(p);
    p.x += displacement;

    if (uGlitchAmount != 1.0) {
      float extra = displacement * (uGlitchAmount - 1.0);
      p.x += extra;
    }

    float middle = digit(p);

    const float off = 0.002;
    float sum = digit(p + vec2(-off, -off)) + digit(p + vec2(0.0, -off)) + digit(p + vec2(off, -off)) +
                digit(p + vec2(-off, 0.0)) + digit(p + vec2(0.0, 0.0)) + digit(p + vec2(off, 0.0)) +
                digit(p + vec2(-off, off)) + digit(p + vec2(0.0, off)) + digit(p + vec2(off, off));

    vec3 baseColor = vec3(0.9) * middle + sum * 0.1 * vec3(1.0) * bar;
    return baseColor;
}

vec2 barrel(vec2 uv){
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= 1.0 + uCurvature * r2;
  return c * 0.5 + 0.5;
}

void main() {
    time = iTime * 0.333333;
    vec2 uv = vUv;

    if(uCurvature != 0.0){
      uv = barrel(uv);
    }

    vec2 p = uv * uScale;
    vec3 col = getColor(p);

    if(uChromaticAberration != 0.0){
      vec2 ca = vec2(uChromaticAberration) / iResolution.xy;
      col.r = getColor(p + ca).r;
      col.b = getColor(p - ca).b;
    }

    col *= uTint;
    col *= uBrightness;

    if(uDither > 0.0){
      float rnd = hash21(gl_FragCoord.xy);
      col += (rnd - 0.5) * (uDither * 0.003922);
    }

    gl_FragColor = vec4(col, 1.0);
}
`;

function faultyTerminalHexToRgb(hex) {
  let h = hex.replace("#", "").trim();
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const num = parseInt(h.slice(0, 6), 16);
  return [((num >> 16) & 255) / 255, ((num >> 8) & 255) / 255, (num & 255) / 255];
}

// Tinted purple-blue to match the Inventory page's navy/purple/blue/teal
// palette (see --purple / --blue in Inventory.css), dialed down so the table
// stays fully legible on top of it.
function InventoryFaultyTerminalBackground({
  scale = 1.6,
  gridMul = [2, 1],
  digitSize = 1.5,
  timeScale = 0.25,
  pause = false,
  scanlineIntensity = 0.2,
  glitchAmount = 1,
  flickerAmount = 0.6,
  noiseAmp = 1,
  chromaticAberration = 0,
  dither = 0,
  curvature = 0.15,
  tint = "#7c3aed",
  mouseReact = true,
  mouseStrength = 0.15,
  pageLoadAnimation = true,
  brightness = 0.35,
}) {
  const containerRef = useRef(null);
  const programRef = useRef(null);
  const rendererRef = useRef(null);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });
  const smoothMouseRef = useRef({ x: 0.5, y: 0.5 });
  const frozenTimeRef = useRef(0);
  const rafRef = useRef(0);
  const loadAnimationStartRef = useRef(0);
  const timeOffsetRef = useRef(Math.random() * 100);

  const dpr = useMemo(() => Math.min(window.devicePixelRatio || 1, 2), []);
  const tintVec = useMemo(() => faultyTerminalHexToRgb(tint), [tint]);
  const ditherValue = useMemo(
    () => (typeof dither === "boolean" ? (dither ? 1 : 0) : dither),
    [dither]
  );

  const handleMouseMove = useCallback((e) => {
    const ctn = containerRef.current;
    if (!ctn) return;
    const rect = ctn.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    mouseRef.current = { x, y };
  }, []);

  useEffect(() => {
    const ctn = containerRef.current;
    if (!ctn) return;

    const renderer = new Renderer({ dpr, alpha: true });
    rendererRef.current = renderer;
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);

    const geometry = new Triangle(gl);

    const program = new Program(gl, {
      vertex: FAULTY_TERMINAL_VERTEX,
      fragment: FAULTY_TERMINAL_FRAGMENT,
      uniforms: {
        iTime: { value: 0 },
        iResolution: {
          value: new Color(gl.canvas.width, gl.canvas.height, gl.canvas.width / gl.canvas.height),
        },
        uScale: { value: scale },
        uGridMul: { value: new Float32Array(gridMul) },
        uDigitSize: { value: digitSize },
        uScanlineIntensity: { value: scanlineIntensity },
        uGlitchAmount: { value: glitchAmount },
        uFlickerAmount: { value: flickerAmount },
        uNoiseAmp: { value: noiseAmp },
        uChromaticAberration: { value: chromaticAberration },
        uDither: { value: ditherValue },
        uCurvature: { value: curvature },
        uTint: { value: new Color(tintVec[0], tintVec[1], tintVec[2]) },
        uMouse: { value: new Float32Array([smoothMouseRef.current.x, smoothMouseRef.current.y]) },
        uMouseStrength: { value: mouseStrength },
        uUseMouse: { value: mouseReact ? 1 : 0 },
        uPageLoadProgress: { value: pageLoadAnimation ? 0 : 1 },
        uUsePageLoadAnimation: { value: pageLoadAnimation ? 1 : 0 },
        uBrightness: { value: brightness },
      },
    });
    programRef.current = program;

    const mesh = new Mesh(gl, { geometry, program });

    function resize() {
      if (!ctn || !renderer) return;
      renderer.setSize(ctn.offsetWidth, ctn.offsetHeight);
      program.uniforms.iResolution.value = new Color(
        gl.canvas.width,
        gl.canvas.height,
        gl.canvas.width / gl.canvas.height
      );
    }

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(ctn);
    resize();

    const update = (t) => {
      rafRef.current = requestAnimationFrame(update);

      if (pageLoadAnimation && loadAnimationStartRef.current === 0) {
        loadAnimationStartRef.current = t;
      }

      if (!pause) {
        const elapsed = (t * 0.001 + timeOffsetRef.current) * timeScale;
        program.uniforms.iTime.value = elapsed;
        frozenTimeRef.current = elapsed;
      } else {
        program.uniforms.iTime.value = frozenTimeRef.current;
      }

      if (pageLoadAnimation && loadAnimationStartRef.current > 0) {
        const animationDuration = 2000;
        const animationElapsed = t - loadAnimationStartRef.current;
        const progress = Math.min(animationElapsed / animationDuration, 1);
        program.uniforms.uPageLoadProgress.value = progress;
      }

      if (mouseReact) {
        const dampingFactor = 0.08;
        const smoothMouse = smoothMouseRef.current;
        const mouse = mouseRef.current;
        smoothMouse.x += (mouse.x - smoothMouse.x) * dampingFactor;
        smoothMouse.y += (mouse.y - smoothMouse.y) * dampingFactor;

        const mouseUniform = program.uniforms.uMouse.value;
        mouseUniform[0] = smoothMouse.x;
        mouseUniform[1] = smoothMouse.y;
      }

      renderer.render({ scene: mesh });
    };
    rafRef.current = requestAnimationFrame(update);
    ctn.appendChild(gl.canvas);

    if (mouseReact) ctn.addEventListener("mousemove", handleMouseMove);

    return () => {
      cancelAnimationFrame(rafRef.current);
      resizeObserver.disconnect();
      if (mouseReact) ctn.removeEventListener("mousemove", handleMouseMove);
      if (gl.canvas.parentElement === ctn) ctn.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      loadAnimationStartRef.current = 0;
      timeOffsetRef.current = Math.random() * 100;
    };
  }, [
    dpr,
    pause,
    timeScale,
    scale,
    gridMul,
    digitSize,
    scanlineIntensity,
    glitchAmount,
    flickerAmount,
    noiseAmp,
    chromaticAberration,
    ditherValue,
    curvature,
    tintVec,
    mouseReact,
    mouseStrength,
    pageLoadAnimation,
    brightness,
    handleMouseMove,
  ]);

  return <div ref={containerRef} className="inven-faulty-terminal-bg" aria-hidden="true" />;
}

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
      <InventoryFaultyTerminalBackground />

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