import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import jsPDF from "jspdf";
import "./Suppliers.css";

/* ------------------------------------------------------------------ */
/* Waves background (embedded — no external import)                   */
/* ------------------------------------------------------------------ */

class Grad {
  constructor(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  dot2(x, y) {
    return this.x * x + this.y * y;
  }
}

class Noise {
  constructor(seed = 0) {
    this.grad3 = [
      new Grad(1, 1, 0),
      new Grad(-1, 1, 0),
      new Grad(1, -1, 0),
      new Grad(-1, -1, 0),
      new Grad(1, 0, 1),
      new Grad(-1, 0, 1),
      new Grad(1, 0, -1),
      new Grad(-1, 0, -1),
      new Grad(0, 1, 1),
      new Grad(0, -1, 1),
      new Grad(0, 1, -1),
      new Grad(0, -1, -1)
    ];
    this.p = [
      151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240,
      21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88,
      237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83,
      111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1, 216,
      80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186,
      3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58,
      17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
      129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
      238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
      184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128,
      195, 78, 66, 215, 61, 156, 180
    ];
    this.perm = new Array(512);
    this.gradP = new Array(512);
    this.seed(seed);
  }
  seed(seed) {
    if (seed > 0 && seed < 1) seed *= 65536;
    seed = Math.floor(seed);
    if (seed < 256) seed |= seed << 8;
    for (let i = 0; i < 256; i++) {
      let v = i & 1 ? this.p[i] ^ (seed & 255) : this.p[i] ^ ((seed >> 8) & 255);
      this.perm[i] = this.perm[i + 256] = v;
      this.gradP[i] = this.gradP[i + 256] = this.grad3[v % 12];
    }
  }
  fade(t) {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }
  lerp(a, b, t) {
    return (1 - t) * a + t * b;
  }
  perlin2(x, y) {
    let X = Math.floor(x),
      Y = Math.floor(y);
    x -= X;
    y -= Y;
    X &= 255;
    Y &= 255;
    const n00 = this.gradP[X + this.perm[Y]].dot2(x, y);
    const n01 = this.gradP[X + this.perm[Y + 1]].dot2(x, y - 1);
    const n10 = this.gradP[X + 1 + this.perm[Y]].dot2(x - 1, y);
    const n11 = this.gradP[X + 1 + this.perm[Y + 1]].dot2(x - 1, y - 1);
    const u = this.fade(x);
    return this.lerp(this.lerp(n00, n10, u), this.lerp(n01, n11, u), this.fade(y));
  }
}

function Waves({
  lineColor = "black",
  backgroundColor = "transparent",
  waveSpeedX = 0.0125,
  waveSpeedY = 0.005,
  waveAmpX = 32,
  waveAmpY = 16,
  xGap = 10,
  yGap = 32,
  friction = 0.925,
  tension = 0.005,
  maxCursorMove = 100,
  style = {},
  className = ""
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const boundingRef = useRef({ width: 0, height: 0, left: 0, top: 0 });
  const noiseRef = useRef(new Noise(Math.random()));
  const linesRef = useRef([]);
  const mouseRef = useRef({
    x: -10,
    y: 0,
    lx: 0,
    ly: 0,
    sx: 0,
    sy: 0,
    v: 0,
    vs: 0,
    a: 0,
    set: false
  });
  const configRef = useRef({
    lineColor,
    waveSpeedX,
    waveSpeedY,
    waveAmpX,
    waveAmpY,
    friction,
    tension,
    maxCursorMove,
    xGap,
    yGap
  });
  const frameIdRef = useRef(null);

  useEffect(() => {
    configRef.current = {
      lineColor,
      waveSpeedX,
      waveSpeedY,
      waveAmpX,
      waveAmpY,
      friction,
      tension,
      maxCursorMove,
      xGap,
      yGap
    };
  }, [lineColor, waveSpeedX, waveSpeedY, waveAmpX, waveAmpY, friction, tension, maxCursorMove, xGap, yGap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    ctxRef.current = canvas.getContext("2d");

    function setSize() {
      boundingRef.current = container.getBoundingClientRect();
      canvas.width = boundingRef.current.width;
      canvas.height = boundingRef.current.height;
    }

    function setLines() {
      const { width, height } = boundingRef.current;
      linesRef.current = [];
      const oWidth = width + 200,
        oHeight = height + 30;
      const { xGap, yGap } = configRef.current;
      const totalLines = Math.ceil(oWidth / xGap);
      const totalPoints = Math.ceil(oHeight / yGap);
      const xStart = (width - xGap * totalLines) / 2;
      const yStart = (height - yGap * totalPoints) / 2;
      for (let i = 0; i <= totalLines; i++) {
        const pts = [];
        for (let j = 0; j <= totalPoints; j++) {
          pts.push({
            x: xStart + xGap * i,
            y: yStart + yGap * j,
            wave: { x: 0, y: 0 },
            cursor: { x: 0, y: 0, vx: 0, vy: 0 }
          });
        }
        linesRef.current.push(pts);
      }
    }

    function movePoints(time) {
      const lines = linesRef.current,
        mouse = mouseRef.current,
        noise = noiseRef.current;
      const { waveSpeedX, waveSpeedY, waveAmpX, waveAmpY, friction, tension, maxCursorMove } = configRef.current;
      lines.forEach(pts => {
        pts.forEach(p => {
          const move = noise.perlin2((p.x + time * waveSpeedX) * 0.002, (p.y + time * waveSpeedY) * 0.0015) * 12;
          p.wave.x = Math.cos(move) * waveAmpX;
          p.wave.y = Math.sin(move) * waveAmpY;

          const dx = p.x - mouse.sx,
            dy = p.y - mouse.sy;
          const dist = Math.hypot(dx, dy),
            l = Math.max(175, mouse.vs);
          if (dist < l) {
            const s = 1 - dist / l;
            const f = Math.cos(dist * 0.001) * s;
            p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00065;
            p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00065;
          }

          p.cursor.vx += (0 - p.cursor.x) * tension;
          p.cursor.vy += (0 - p.cursor.y) * tension;
          p.cursor.vx *= friction;
          p.cursor.vy *= friction;
          p.cursor.x += p.cursor.vx * 2;
          p.cursor.y += p.cursor.vy * 2;
          p.cursor.x = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.x));
          p.cursor.y = Math.min(maxCursorMove, Math.max(-maxCursorMove, p.cursor.y));
        });
      });
    }

    function moved(point, withCursor = true) {
      const x = point.x + point.wave.x + (withCursor ? point.cursor.x : 0);
      const y = point.y + point.wave.y + (withCursor ? point.cursor.y : 0);
      return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    }

    function drawLines() {
      const { width, height } = boundingRef.current;
      const ctx = ctxRef.current;
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      ctx.strokeStyle = configRef.current.lineColor;
      linesRef.current.forEach(points => {
        let p1 = moved(points[0], false);
        ctx.moveTo(p1.x, p1.y);
        points.forEach((p, idx) => {
          const isLast = idx === points.length - 1;
          p1 = moved(p, !isLast);
          const p2 = moved(points[idx + 1] || points[points.length - 1], !isLast);
          ctx.lineTo(p1.x, p1.y);
          if (isLast) ctx.moveTo(p2.x, p2.y);
        });
      });
      ctx.stroke();
    }

    function tick(t) {
      const mouse = mouseRef.current;
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      const dx = mouse.x - mouse.lx,
        dy = mouse.y - mouse.ly;
      const d = Math.hypot(dx, dy);
      mouse.v = d;
      mouse.vs += (d - mouse.vs) * 0.1;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);
      container.style.setProperty("--x", `${mouse.sx}px`);
      container.style.setProperty("--y", `${mouse.sy}px`);

      movePoints(t);
      drawLines();
      frameIdRef.current = requestAnimationFrame(tick);
    }

    function onResize() {
      setSize();
      setLines();
    }
    function onMouseMove(e) {
      updateMouse(e.clientX, e.clientY);
    }
    function onTouchMove(e) {
      const touch = e.touches[0];
      updateMouse(touch.clientX, touch.clientY);
    }
    function updateMouse(x, y) {
      const mouse = mouseRef.current,
        b = boundingRef.current;
      mouse.x = x - b.left;
      mouse.y = y - b.top;
      if (!mouse.set) {
        mouse.sx = mouse.x;
        mouse.sy = mouse.y;
        mouse.lx = mouse.x;
        mouse.ly = mouse.y;
        mouse.set = true;
      }
    }

    setSize();
    setLines();
    frameIdRef.current = requestAnimationFrame(tick);
    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      cancelAnimationFrame(frameIdRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`waves ${className}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        margin: 0,
        padding: 0,
        width: "100%",
        height: "100%",
        overflow: "hidden",
        backgroundColor,
        ...style
      }}
    >
      <canvas ref={canvasRef} className="waves-canvas" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Suppliers page                                                      */
/* ------------------------------------------------------------------ */

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
  const [loggingExpense, setLoggingExpense] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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

  // Pre-fills the PO form from an already-received order's supplier +
  // line items, for repeat stock orders. Closes the detail drawer so
  // the create modal is the only thing on screen.
  function openReorder(po, lines) {
    setPoForm({
      supplier_id: po.supplier_id || "",
      expected_date: "",
      notes: "",
      line_items: lines.length
        ? lines.map((l) => ({
            description: l.description,
            quantity_ordered: String(l.quantity_ordered),
            unit_cost: String(l.unit_cost),
          }))
        : [{ description: "", quantity_ordered: "1", unit_cost: "" }],
    });
    setPoFormError("");
    setSelectedPo(null);
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
      const updated = { ...selectedPo, status: "received" };
      setSelectedPo(updated);
      loadOrders();
      openPoDetail(updated);
    }
  }

  // Logs a received PO to Expenses (category "supplies", vendor = the
  // supplier's name) and stamps purchase_orders.expense_id so it can't
  // be logged twice. Mirrors the shape expenses already expects.
  async function handleLogToExpenses() {
    if (!selectedPo || selectedPo.expense_id) return;
    setLoggingExpense(true);

    const supplierLabel = selectedPo.suppliers?.name || supplierName(selectedPo.supplier_id);

    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .insert({
        business_id: business.id,
        category: "supplies",
        vendor: supplierLabel,
        description: `Purchase order ${selectedPo.po_number}`,
        amount: selectedPo.total,
        expense_date: new Date().toISOString().slice(0, 10),
      })
      .select()
      .single();

    if (expenseError) {
      setLoggingExpense(false);
      showToast(expenseError.message);
      return;
    }

    const { error: poError } = await supabase
      .from("purchase_orders")
      .update({ expense_id: expense.id })
      .eq("id", selectedPo.id);

    setLoggingExpense(false);

    if (poError) {
      showToast(poError.message);
      return;
    }

    showToast("Logged to Expenses");
    setSelectedPo({ ...selectedPo, expense_id: expense.id });
    loadOrders();
  }

  function handleDownloadPdf() {
    if (!selectedPo) return;
    setExportingPdf(true);

    try {
      const supplierLabel = selectedPo.suppliers?.name || supplierName(selectedPo.supplier_id);
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      const marginX = 48;
      let y = 56;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text(business.name || "Purchase Order", marginX, y);

      doc.setFontSize(11);
      doc.setFont("helvetica", "normal");
      y += 26;
      doc.text(`Purchase Order ${selectedPo.po_number}`, marginX, y);

      y += 34;
      doc.setFont("helvetica", "bold");
      doc.text("Supplier", marginX, y);
      doc.setFont("helvetica", "normal");
      doc.text(`Status: ${PO_STATUS_LABEL[selectedPo.status] || selectedPo.status}`, 340, y);

      y += 16;
      doc.text(supplierLabel, marginX, y);
      doc.text(`Expected: ${selectedPo.expected_date || "—"}`, 340, y);

      y += 34;
      doc.setFont("helvetica", "bold");
      doc.text("Description", marginX, y);
      doc.text("Qty", 330, y, { align: "right" });
      doc.text("Unit cost", 420, y, { align: "right" });
      doc.text("Line total", 520, y, { align: "right" });
      doc.setLineWidth(0.5);
      doc.line(marginX, y + 6, 520, y + 6);

      doc.setFont("helvetica", "normal");
      y += 22;

      selectedPoLines.forEach((line) => {
        const qty = Number(line.quantity_ordered);
        const cost = Number(line.unit_cost);
        const lineTotal = qty * cost;

        doc.text(String(line.description), marginX, y, { maxWidth: 260 });
        doc.text(String(qty), 330, y, { align: "right" });
        doc.text(`R${cost.toFixed(2)}`, 420, y, { align: "right" });
        doc.text(`R${lineTotal.toFixed(2)}`, 520, y, { align: "right" });
        y += 20;
      });

      y += 10;
      doc.line(marginX, y, 520, y);
      y += 24;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text(`Total: R${Number(selectedPo.total).toFixed(2)}`, 520, y, { align: "right" });

      if (selectedPo.notes) {
        y += 40;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        doc.text("Notes", marginX, y);
        y += 16;
        doc.setFont("helvetica", "normal");
        doc.text(String(selectedPo.notes), marginX, y, { maxWidth: 472 });
      }

      doc.save(`${selectedPo.po_number}.pdf`);
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <div className="sup-page">
      <div className="sup-bg">
        <Waves
          lineColor="rgba(231, 233, 239, 0.16)"
          backgroundColor="transparent"
          waveSpeedX={0.0125}
          waveSpeedY={0.01}
          waveAmpX={40}
          waveAmpY={20}
          friction={0.9}
          tension={0.01}
          maxCursorMove={120}
          xGap={12}
          yGap={36}
        />
      </div>

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
                  <>Add a supplier first, then create your first purchase order.</>
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

      {/* New purchase order modal (also used for Reorder, pre-filled) */}
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

            {/* Utility actions — always available once there's a real PO to act on */}
            <div className="sup-drawer-actions">
              <button
                className="sup-secondary-btn"
                onClick={handleDownloadPdf}
                disabled={exportingPdf || poDetailLoading}
              >
                {exportingPdf ? <span className="sup-spinner" /> : "Download PDF"}
              </button>
              {selectedPo.status === "received" && (
                <button
                  className="sup-secondary-btn"
                  onClick={() => openReorder(selectedPo, selectedPoLines)}
                  disabled={poDetailLoading}
                >
                  Reorder
                </button>
              )}
            </div>

            {selectedPo.status === "received" && (
              <div className="sup-drawer-actions">
                <button
                  className="sup-add-btn"
                  onClick={handleLogToExpenses}
                  disabled={loggingExpense || Boolean(selectedPo.expense_id)}
                >
                  {loggingExpense ? (
                    <span className="sup-spinner" />
                  ) : selectedPo.expense_id ? (
                    "Logged to Expenses"
                  ) : (
                    "Log to Expenses"
                  )}
                </button>
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