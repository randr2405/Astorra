import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import jsPDF from "jspdf";
import { gsap } from "gsap";
import "./Payroll.css";

const RUN_STATUS_OPTIONS = ["draft", "processed", "paid"];
const RUN_STATUS_LABEL = {
  draft: "Draft",
  processed: "Processed",
  paid: "Paid",
};

// ----------------------------------------------------------------------
// DotGrid — inlined here so this page has zero local component imports
// beyond libraries in package.json. Requires "gsap".
// ----------------------------------------------------------------------
const dotGridThrottle = (func, limit) => {
  let lastCall = 0;
  return function (...args) {
    const now = performance.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      func.apply(this, args);
    }
  };
};

function dotGridHexToRgb(hex) {
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return { r: 0, g: 0, b: 0 };
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
}

function DotGrid({
  dotSize = 16,
  gap = 32,
  baseColor = "#5227FF",
  activeColor = "#5227FF",
  proximity = 150,
  speedTrigger = 100,
  shockRadius = 250,
  shockStrength = 5,
  maxSpeed = 5000,
  resistance = 750,
  returnDuration = 1.5,
  className = "",
  style,
}) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const dotsRef = useRef([]);
  const pointerRef = useRef({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastTime: 0,
    lastX: 0,
    lastY: 0,
  });

  const baseRgb = useMemo(() => dotGridHexToRgb(baseColor), [baseColor]);
  const activeRgb = useMemo(() => dotGridHexToRgb(activeColor), [activeColor]);

  const circlePath = useMemo(() => {
    if (typeof window === "undefined" || !window.Path2D) return null;
    const p = new window.Path2D();
    p.arc(0, 0, dotSize / 2, 0, Math.PI * 2);
    return p;
  }, [dotSize]);

  const buildGrid = useCallback(() => {
    const wrap = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const { width, height } = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.scale(dpr, dpr);

    const cols = Math.floor((width + gap) / (dotSize + gap));
    const rows = Math.floor((height + gap) / (dotSize + gap));
    const cell = dotSize + gap;

    const gridW = cell * cols - gap;
    const gridH = cell * rows - gap;

    const extraX = width - gridW;
    const extraY = height - gridH;

    const startX = extraX / 2 + dotSize / 2;
    const startY = extraY / 2 + dotSize / 2;

    const dots = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = startX + x * cell;
        const cy = startY + y * cell;
        dots.push({ cx, cy, xOffset: 0, yOffset: 0, _inertiaApplied: false });
      }
    }
    dotsRef.current = dots;
  }, [dotSize, gap]);

  useEffect(() => {
    if (!circlePath) return;

    let rafId;
    const proxSq = proximity * proximity;

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const { x: px, y: py } = pointerRef.current;

      for (const dot of dotsRef.current) {
        const ox = dot.cx + dot.xOffset;
        const oy = dot.cy + dot.yOffset;
        const dx = dot.cx - px;
        const dy = dot.cy - py;
        const dsq = dx * dx + dy * dy;

        let style = baseColor;
        if (dsq <= proxSq) {
          const dist = Math.sqrt(dsq);
          const t = 1 - dist / proximity;
          const r = Math.round(baseRgb.r + (activeRgb.r - baseRgb.r) * t);
          const g = Math.round(baseRgb.g + (activeRgb.g - baseRgb.g) * t);
          const b = Math.round(baseRgb.b + (activeRgb.b - baseRgb.b) * t);
          style = `rgb(${r},${g},${b})`;
        }

        ctx.save();
        ctx.translate(ox, oy);
        ctx.fillStyle = style;
        ctx.fill(circlePath);
        ctx.restore();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(rafId);
  }, [proximity, baseColor, activeRgb, baseRgb, circlePath]);

  useEffect(() => {
    buildGrid();
    let ro = null;
    if ("ResizeObserver" in window) {
      ro = new ResizeObserver(buildGrid);
      wrapperRef.current && ro.observe(wrapperRef.current);
    } else {
      window.addEventListener("resize", buildGrid);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener("resize", buildGrid);
    };
  }, [buildGrid]);

  useEffect(() => {
    const onMove = (e) => {
      const now = performance.now();
      const pr = pointerRef.current;
      const dt = pr.lastTime ? now - pr.lastTime : 16;
      const dx = e.clientX - pr.lastX;
      const dy = e.clientY - pr.lastY;
      let vx = (dx / dt) * 1000;
      let vy = (dy / dt) * 1000;
      let speed = Math.hypot(vx, vy);
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        vx *= scale;
        vy *= scale;
        speed = maxSpeed;
      }
      pr.lastTime = now;
      pr.lastX = e.clientX;
      pr.lastY = e.clientY;
      pr.vx = vx;
      pr.vy = vy;
      pr.speed = speed;

      const rect = canvasRef.current.getBoundingClientRect();
      pr.x = e.clientX - rect.left;
      pr.y = e.clientY - rect.top;

      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - pr.x, dot.cy - pr.y);
        if (speed > speedTrigger && dist < proximity && !dot._inertiaApplied) {
          dot._inertiaApplied = true;
          gsap.killTweensOf(dot);
          const pushX = dot.cx - pr.x + vx * 0.005;
          const pushY = dot.cy - pr.y + vy * 0.005;
          gsap.to(dot, {
            xOffset: pushX,
            yOffset: pushY,
            duration: Math.min(resistance / 1000, 0.6),
            ease: "power2.out",
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: returnDuration,
                ease: "elastic.out(1,0.75)",
              });
              dot._inertiaApplied = false;
            },
          });
        }
      }
    };

    const onClick = (e) => {
      const rect = canvasRef.current.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      for (const dot of dotsRef.current) {
        const dist = Math.hypot(dot.cx - cx, dot.cy - cy);
        if (dist < shockRadius && !dot._inertiaApplied) {
          dot._inertiaApplied = true;
          gsap.killTweensOf(dot);
          const falloff = Math.max(0, 1 - dist / shockRadius);
          const pushX = (dot.cx - cx) * shockStrength * falloff;
          const pushY = (dot.cy - cy) * shockStrength * falloff;
          gsap.to(dot, {
            xOffset: pushX,
            yOffset: pushY,
            duration: Math.min(resistance / 1000, 0.6),
            ease: "power2.out",
            onComplete: () => {
              gsap.to(dot, {
                xOffset: 0,
                yOffset: 0,
                duration: returnDuration,
                ease: "elastic.out(1,0.75)",
              });
              dot._inertiaApplied = false;
            },
          });
        }
      }
    };

    const throttledMove = dotGridThrottle(onMove, 50);
    window.addEventListener("mousemove", throttledMove, { passive: true });
    window.addEventListener("click", onClick);

    return () => {
      window.removeEventListener("mousemove", throttledMove);
      window.removeEventListener("click", onClick);
    };
  }, [maxSpeed, speedTrigger, proximity, resistance, returnDuration, shockRadius, shockStrength]);

  return (
    <section className={`pay-dot-grid ${className}`} style={style}>
      <div ref={wrapperRef} className="pay-dot-grid__wrap">
        <canvas ref={canvasRef} className="pay-dot-grid__canvas" />
      </div>
    </section>
  );
}

// ----------------------------------------------------------------------
// PAYE / UIF calculation — SIMPLIFIED APPROXIMATION.
//
// Tax brackets, the primary rebate, and the UIF ceiling are loaded from
// the `tax_tables` table (most recent row with effective_from <= today),
// rather than hardcoded here — see the tax_tables migration. This does
// NOT account for medical aid tax credits, retirement annuity deductions,
// secondary/tertiary rebates (65+/75+), or any other adjustments to
// taxable income. It's a reasonable estimate for a small business's own
// payroll, not a substitute for a payroll professional or accountant.
// ----------------------------------------------------------------------

// Average working days used to derive a daily rate for unpaid-leave
// deductions on salaried staff. 21.67 = 260 working days / 12 months.
const AVG_MONTHLY_WORKING_DAYS = 21.67;
const AVG_WEEKLY_WORKING_DAYS = 5;

function periodsPerYear(frequency) {
  return frequency === "weekly" ? 52 : 12;
}

// taxTable.brackets stores the top bracket's upTo as null (JSON has no
// Infinity) — normalise it back to Infinity here so bracket lookup works
// the same way it always did.
function normaliseBrackets(brackets) {
  return brackets.map((b) => ({
    ...b,
    upTo: b.upTo === null || b.upTo === undefined ? Infinity : b.upTo,
  }));
}

function calculatePAYEForPeriod(grossForPeriod, frequency, taxTable) {
  const periods = periodsPerYear(frequency);
  const annualGross = grossForPeriod * periods;
  const brackets = normaliseBrackets(taxTable.brackets);
  const bracket = brackets.find((b) => annualGross <= b.upTo);
  const annualTax = Math.max(
    0,
    bracket.base + (annualGross - bracket.above) * bracket.rate - Number(taxTable.primary_rebate_annual)
  );
  return annualTax / periods;
}

function calculateUIFForPeriod(grossForPeriod, frequency, taxTable) {
  const periods = periodsPerYear(frequency);
  const uifRate = Number(taxTable.uif_rate);
  const ceilingForPeriod = (Number(taxTable.uif_ceiling_monthly) * 12) / periods;
  const base = Math.min(grossForPeriod, ceilingForPeriod);
  return { employee: base * uifRate, employer: base * uifRate };
}

// Computes a full payslip preview for one staff member.
//   - hoursWorked: only used for hourly staff
//   - daysAbsent: unpaid leave days, only applied to salaried staff —
//     proportionally reduces base pay before tax
//   - bonusTotal: sum of one-off additions (bonus/commission/overtime),
//     added to gross AFTER the absence deduction, and is taxable
function computePayslip(staffMember, hoursWorked, daysAbsent, bonusTotal, taxTable) {
  const frequency = staffMember.pay_frequency || "monthly";
  const rate = Number(staffMember.pay_rate) || 0;

  let basePay =
    staffMember.employment_type === "hourly" ? rate * (Number(hoursWorked) || 0) : rate;

  let absenceDeduction = 0;
  const absentDays = Number(daysAbsent) || 0;
  if (staffMember.employment_type !== "hourly" && absentDays > 0) {
    const workingDays = frequency === "weekly" ? AVG_WEEKLY_WORKING_DAYS : AVG_MONTHLY_WORKING_DAYS;
    const dailyRate = rate / workingDays;
    absenceDeduction = dailyRate * absentDays;
    basePay = Math.max(0, basePay - absenceDeduction);
  }

  const bonus = Number(bonusTotal) || 0;
  const taxableGross = basePay + bonus;

  const paye = calculatePAYEForPeriod(taxableGross, frequency, taxTable);
  const uif = calculateUIFForPeriod(taxableGross, frequency, taxTable);
  const netPay = taxableGross - paye - uif.employee;

  return {
    gross_pay: taxableGross,
    base_pay: basePay,
    absence_deduction: absenceDeduction,
    bonus_total: bonus,
    days_absent: absentDays,
    paye,
    uif_employee: uif.employee,
    uif_employer: uif.employer,
    other_deductions: 0,
    net_pay: netPay,
  };
}

function makeLocalId() {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const emptyCreateForm = {
  period_start: "",
  period_end: "",
  pay_date: "",
  notes: "",
};

export default function Payroll({ business }) {
  const [mounted, setMounted] = useState(false);

  const [payRuns, setPayRuns] = useState([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  const [staff, setStaff] = useState([]);

  // Current statutory tax table (brackets, rebate, UIF ceiling), loaded
  // from tax_tables. Pay-run creation/editing is disabled until this is
  // loaded, and an error banner shows if no row could be found at all.
  const [taxTable, setTaxTable] = useState(null);
  const [taxTableLoading, setTaxTableLoading] = useState(true);
  const [taxTableError, setTaxTableError] = useState("");

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingRunId, setEditingRunId] = useState(null);
  const [createForm, setCreateForm] = useState(emptyCreateForm);
  const [includedStaffIds, setIncludedStaffIds] = useState([]);
  const [hoursByStaffId, setHoursByStaffId] = useState({});
  const [daysAbsentByStaffId, setDaysAbsentByStaffId] = useState({});
  const [bonusItemsByStaffId, setBonusItemsByStaffId] = useState({});
  const [savingRun, setSavingRun] = useState(false);
  const [createFormError, setCreateFormError] = useState("");
  const [confirmDeleteRunId, setConfirmDeleteRunId] = useState(null);

  const [selectedRun, setSelectedRun] = useState(null);
  const [selectedPayslips, setSelectedPayslips] = useState([]);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [markingPaid, setMarkingPaid] = useState(false);
  const [loggingExpense, setLoggingExpense] = useState(false);
  const [exportingPayslipId, setExportingPayslipId] = useState(null);
  const [exportingAll, setExportingAll] = useState(false);

  const [toast, setToast] = useState(null);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  // ---- loaders ----
  const loadPayRuns = useCallback(async () => {
    setRunsLoading(true);
    const { data, error } = await supabase
      .from("pay_runs")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });
    if (!error) setPayRuns(data || []);
    setRunsLoading(false);
  }, [business.id]);

  const loadStaff = useCallback(async () => {
    const { data, error } = await supabase
      .from("staff")
      .select("*")
      .eq("business_id", business.id)
      .eq("employment_status", "active")
      .order("full_name", { ascending: true });
    if (!error) setStaff(data || []);
  }, [business.id]);

  // Most recent tax table whose effective_from is on or before today. If
  // effective_to is set and in the past, it's excluded too, so a stale
  // superseded row can never be picked up even if ordering ever changes.
  const loadTaxTable = useCallback(async () => {
    setTaxTableLoading(true);
    setTaxTableError("");
    const today = new Date().toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("tax_tables")
      .select("*")
      .lte("effective_from", today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      setTaxTableError("Couldn't load the current tax table. Please try again.");
    } else if (!data) {
      setTaxTableError("No tax table found for the current date. Payroll calculations are unavailable until one is added.");
    } else {
      setTaxTable(data);
    }
    setTaxTableLoading(false);
  }, []);

  useEffect(() => {
    loadPayRuns();
    loadStaff();
    loadTaxTable();
  }, [loadPayRuns, loadStaff, loadTaxTable]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const payableStaff = useMemo(
    () => staff.filter((s) => s.pay_rate !== null && s.pay_rate !== undefined && s.pay_rate !== ""),
    [staff]
  );

  // ---- derived: pay runs ----
  const filteredRuns = useMemo(() => {
    let list = [...payRuns];
    if (statusFilter !== "all") {
      list = list.filter((r) => r.status === statusFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((r) => r.run_number.toLowerCase().includes(q));
    }
    return list;
  }, [payRuns, statusFilter, search]);

  const statusCounts = useMemo(() => {
    const counts = { all: payRuns.length };
    RUN_STATUS_OPTIONS.forEach((s) => {
      counts[s] = payRuns.filter((r) => r.status === s).length;
    });
    return counts;
  }, [payRuns]);

  const totalPaidYtd = useMemo(
    () =>
      payRuns
        .filter((r) => r.status === "paid")
        .reduce((sum, r) => sum + Number(r.total_net || 0), 0),
    [payRuns]
  );

  const openDraftCount = useMemo(
    () => payRuns.filter((r) => r.status !== "paid").length,
    [payRuns]
  );

  // ---- create / edit pay run ----
  function resetStaffFormState() {
    setHoursByStaffId({});
    setDaysAbsentByStaffId({});
    setBonusItemsByStaffId({});
  }

  function openCreateRun() {
    if (!taxTable) return;

    const today = new Date();
    const periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const periodEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    setIsEditMode(false);
    setEditingRunId(null);
    setCreateForm({
      period_start: periodStart.toISOString().slice(0, 10),
      period_end: periodEnd.toISOString().slice(0, 10),
      pay_date: periodEnd.toISOString().slice(0, 10),
      notes: "",
    });
    setIncludedStaffIds(payableStaff.map((s) => s.id));
    resetStaffFormState();
    setCreateFormError("");
    setShowCreateModal(true);
  }

  async function openEditRun(run) {
    if (run.status !== "draft" || !taxTable) return;

    setIsEditMode(true);
    setEditingRunId(run.id);
    setCreateForm({
      period_start: run.period_start,
      period_end: run.period_end,
      pay_date: run.pay_date,
      notes: run.notes || "",
    });
    setCreateFormError("");
    setShowCreateModal(true);

    const { data, error } = await supabase
      .from("payslips")
      .select("*, payslip_line_items(*)")
      .eq("pay_run_id", run.id);

    if (error) {
      showToast(error.message);
      return;
    }

    const ids = [];
    const hours = {};
    const absent = {};
    const bonus = {};

    (data || []).forEach((p) => {
      ids.push(p.staff_id);
      if (p.hours_worked !== null && p.hours_worked !== undefined) {
        hours[p.staff_id] = String(p.hours_worked);
      }
      if (Number(p.days_absent) > 0) {
        absent[p.staff_id] = String(p.days_absent);
      }
      bonus[p.staff_id] = (p.payslip_line_items || []).map((li) => ({
        id: li.id,
        description: li.description,
        amount: String(li.amount),
      }));
    });

    setIncludedStaffIds(ids);
    setHoursByStaffId(hours);
    setDaysAbsentByStaffId(absent);
    setBonusItemsByStaffId(bonus);
  }

  function closeCreateModal() {
    setShowCreateModal(false);
    setIsEditMode(false);
    setEditingRunId(null);
  }

  function toggleIncludedStaff(staffId) {
    setIncludedStaffIds((prev) =>
      prev.includes(staffId) ? prev.filter((id) => id !== staffId) : [...prev, staffId]
    );
  }

  function updateHours(staffId, value) {
    setHoursByStaffId((prev) => ({ ...prev, [staffId]: value }));
  }

  function updateDaysAbsent(staffId, value) {
    setDaysAbsentByStaffId((prev) => ({ ...prev, [staffId]: value }));
  }

  function addBonusItem(staffId) {
    setBonusItemsByStaffId((prev) => {
      const items = prev[staffId] || [];
      return { ...prev, [staffId]: [...items, { id: makeLocalId(), description: "", amount: "" }] };
    });
  }

  function updateBonusItem(staffId, itemId, field, value) {
    setBonusItemsByStaffId((prev) => ({
      ...prev,
      [staffId]: (prev[staffId] || []).map((it) => (it.id === itemId ? { ...it, [field]: value } : it)),
    }));
  }

  function removeBonusItem(staffId, itemId) {
    setBonusItemsByStaffId((prev) => ({
      ...prev,
      [staffId]: (prev[staffId] || []).filter((it) => it.id !== itemId),
    }));
  }

  const previewPayslips = useMemo(() => {
    if (!taxTable) return [];
    return payableStaff
      .filter((s) => includedStaffIds.includes(s.id))
      .map((s) => {
        const bonusItems = bonusItemsByStaffId[s.id] || [];
        const bonusTotal = bonusItems.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);
        return {
          staff: s,
          bonusItems,
          ...computePayslip(s, hoursByStaffId[s.id], daysAbsentByStaffId[s.id], bonusTotal, taxTable),
        };
      });
  }, [payableStaff, includedStaffIds, hoursByStaffId, daysAbsentByStaffId, bonusItemsByStaffId, taxTable]);

  const previewTotals = useMemo(() => {
    return previewPayslips.reduce(
      (acc, p) => ({
        gross: acc.gross + p.gross_pay,
        deductions: acc.deductions + p.paye + p.uif_employee + p.other_deductions,
        net: acc.net + p.net_pay,
      }),
      { gross: 0, deductions: 0, net: 0 }
    );
  }, [previewPayslips]);

  // Builds payslip rows (without pay_run_id) plus a parallel line-items
  // list keyed by staff_id, ready to insert once payslip ids are known.
  function buildPayslipInsertRows(payRunId) {
    const payslipRows = previewPayslips.map((p) => ({
      pay_run_id: payRunId,
      staff_id: p.staff.id,
      gross_pay: p.gross_pay,
      paye: p.paye,
      uif_employee: p.uif_employee,
      uif_employer: p.uif_employer,
      other_deductions: p.other_deductions,
      net_pay: p.net_pay,
      hours_worked: p.staff.employment_type === "hourly" ? Number(hoursByStaffId[p.staff.id]) || 0 : null,
      days_absent: p.days_absent || 0,
    }));
    return payslipRows;
  }

  async function insertLineItemsForPayslips(insertedPayslips) {
    const lineItemRows = [];
    insertedPayslips.forEach((row) => {
      const preview = previewPayslips.find((p) => p.staff.id === row.staff_id);
      (preview?.bonusItems || []).forEach((it) => {
        const amount = Number(it.amount);
        if (it.description.trim() && amount > 0) {
          lineItemRows.push({
            payslip_id: row.id,
            description: it.description.trim(),
            amount,
          });
        }
      });
    });
    if (lineItemRows.length === 0) return { error: null };
    const { error } = await supabase.from("payslip_line_items").insert(lineItemRows);
    return { error };
  }

  async function handleSaveRun(e) {
    e.preventDefault();

    if (!taxTable) {
      setCreateFormError("Tax table not loaded yet — please wait a moment and try again.");
      return;
    }
    if (!createForm.period_start || !createForm.period_end || !createForm.pay_date) {
      setCreateFormError("Period start, period end, and pay date are all required.");
      return;
    }
    if (previewPayslips.length === 0) {
      setCreateFormError("Include at least one staff member.");
      return;
    }

    setSavingRun(true);
    setCreateFormError("");

    if (isEditMode) {
      const { error: updateError } = await supabase
        .from("pay_runs")
        .update({
          period_start: createForm.period_start,
          period_end: createForm.period_end,
          pay_date: createForm.pay_date,
          notes: createForm.notes.trim() || null,
          total_gross: previewTotals.gross,
          total_deductions: previewTotals.deductions,
          total_net: previewTotals.net,
        })
        .eq("id", editingRunId);

      if (updateError) {
        setSavingRun(false);
        setCreateFormError(updateError.message);
        return;
      }

      // Draft-only edit: simplest safe approach is to replace all
      // payslips (and their line items, via cascade) for this run.
      const { error: deleteError } = await supabase
        .from("payslips")
        .delete()
        .eq("pay_run_id", editingRunId);

      if (deleteError) {
        setSavingRun(false);
        setCreateFormError(deleteError.message);
        return;
      }

      const { data: insertedPayslips, error: insertError } = await supabase
        .from("payslips")
        .insert(buildPayslipInsertRows(editingRunId))
        .select();

      if (insertError) {
        setSavingRun(false);
        setCreateFormError(insertError.message);
        return;
      }

      const { error: liError } = await insertLineItemsForPayslips(insertedPayslips);
      setSavingRun(false);

      if (liError) {
        setCreateFormError(liError.message);
        return;
      }

      closeCreateModal();
      showToast("Pay run updated");
      loadPayRuns();
      if (selectedRun?.id === editingRunId) {
        openRunDetail({ ...selectedRun, ...createForm });
      }
      return;
    }

    // ---- create flow ----
    const { data: nextNumber, error: numError } = await supabase.rpc("get_next_number", {
      p_business_id: business.id,
      p_counter_key: "pay_run",
    });

    if (numError) {
      setSavingRun(false);
      setCreateFormError(numError.message);
      return;
    }

    const { data: run, error: runError } = await supabase
      .from("pay_runs")
      .insert({
        business_id: business.id,
        run_number: `PR-${String(nextNumber).padStart(4, "0")}`,
        period_start: createForm.period_start,
        period_end: createForm.period_end,
        pay_date: createForm.pay_date,
        status: "draft",
        total_gross: previewTotals.gross,
        total_deductions: previewTotals.deductions,
        total_net: previewTotals.net,
        notes: createForm.notes.trim() || null,
      })
      .select()
      .single();

    if (runError) {
      setSavingRun(false);
      setCreateFormError(runError.message);
      return;
    }

    const { data: insertedPayslips, error: payslipsError } = await supabase
      .from("payslips")
      .insert(buildPayslipInsertRows(run.id))
      .select();

    if (payslipsError) {
      setSavingRun(false);
      setCreateFormError(payslipsError.message);
      return;
    }

    const { error: liError } = await insertLineItemsForPayslips(insertedPayslips);
    setSavingRun(false);

    if (liError) {
      setCreateFormError(liError.message);
      return;
    }

    closeCreateModal();
    showToast("Pay run created");
    loadPayRuns();
  }

  async function handleDeleteRun(id) {
    const { error } = await supabase.from("pay_runs").delete().eq("id", id);
    setConfirmDeleteRunId(null);
    if (!error) {
      showToast("Pay run removed");
      loadPayRuns();
      if (selectedRun?.id === id) setSelectedRun(null);
    }
  }

  async function openRunDetail(run) {
    setSelectedRun(run);
    setRunDetailLoading(true);
    const { data } = await supabase
      .from("payslips")
      .select("*, staff(full_name, employment_type), payslip_line_items(*)")
      .eq("pay_run_id", run.id);
    setSelectedPayslips(data || []);
    setRunDetailLoading(false);
  }

  async function handleProcessRun() {
    if (!selectedRun) return;
    setProcessing(true);
    const { error } = await supabase
      .from("pay_runs")
      .update({ status: "processed" })
      .eq("id", selectedRun.id);
    setProcessing(false);
    if (!error) {
      showToast("Pay run marked as processed");
      setSelectedRun({ ...selectedRun, status: "processed" });
      loadPayRuns();
    }
  }

  async function handleMarkPaid() {
    if (!selectedRun) return;
    setMarkingPaid(true);
    const { error } = await supabase
      .from("pay_runs")
      .update({ status: "paid" })
      .eq("id", selectedRun.id);
    setMarkingPaid(false);
    if (!error) {
      showToast("Pay run marked as paid");
      setSelectedRun({ ...selectedRun, status: "paid" });
      loadPayRuns();
    }
  }

  // Logs the pay run's total cost (net pay + employer UIF contribution)
  // to Expenses under category "payroll", and stamps pay_runs.expense_id
  // so it can't be logged twice — same guard pattern as Suppliers' POs.
  async function handleLogToExpenses() {
    if (!selectedRun || selectedRun.expense_id) return;
    setLoggingExpense(true);

    const employerUifTotal = selectedPayslips.reduce((sum, p) => sum + Number(p.uif_employer || 0), 0);
    const totalCost = Number(selectedRun.total_net) + employerUifTotal;

    const { data: expense, error: expenseError } = await supabase
      .from("expenses")
      .insert({
        business_id: business.id,
        category: "payroll",
        vendor: "Payroll",
        description: `Pay run ${selectedRun.run_number} (${selectedRun.period_start} to ${selectedRun.period_end})`,
        amount: totalCost,
        expense_date: selectedRun.pay_date,
      })
      .select()
      .single();

    if (expenseError) {
      setLoggingExpense(false);
      showToast(expenseError.message);
      return;
    }

    const { error: runError } = await supabase
      .from("pay_runs")
      .update({ expense_id: expense.id })
      .eq("id", selectedRun.id);

    setLoggingExpense(false);

    if (runError) {
      showToast(runError.message);
      return;
    }

    showToast("Logged to Expenses");
    setSelectedRun({ ...selectedRun, expense_id: expense.id });
    loadPayRuns();
  }

  // Draws one payslip's content into a jsPDF doc, starting at the given
  // y offset. Shared by the single-payslip download and the "download
  // all" combined PDF so both stay in sync.
  function drawPayslipContent(doc, payslip) {
    const marginX = 48;
    let y = 56;

    const bonusItems = payslip.payslip_line_items || [];
    const bonusTotal = bonusItems.reduce((sum, li) => sum + Number(li.amount || 0), 0);
    const basePay = Number(payslip.gross_pay) - bonusTotal;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text(business.name || "Payslip", marginX, y);

    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    y += 26;
    doc.text(`Payslip — ${selectedRun.run_number}`, marginX, y);

    y += 20;
    doc.text(`Period: ${selectedRun.period_start} to ${selectedRun.period_end}`, marginX, y);

    y += 34;
    doc.setFont("helvetica", "bold");
    doc.text("Employee", marginX, y);
    doc.setFont("helvetica", "normal");
    doc.text(`Pay date: ${selectedRun.pay_date}`, 340, y);

    y += 16;
    doc.text(payslip.staff?.full_name || "—", marginX, y);
    if (Number(payslip.days_absent) > 0) {
      y += 16;
      doc.setFontSize(10);
      doc.text(`Unpaid leave: ${payslip.days_absent} day(s)`, marginX, y);
      doc.setFontSize(11);
    }

    y += 34;
    doc.setFont("helvetica", "bold");
    doc.text("Description", marginX, y);
    doc.text("Amount", 520, y, { align: "right" });
    doc.setLineWidth(0.5);
    doc.line(marginX, y + 6, 520, y + 6);

    doc.setFont("helvetica", "normal");
    y += 22;

    const rows = [["Base pay", basePay]];
    bonusItems.forEach((li) => rows.push([li.description, Number(li.amount)]));
    rows.push(["PAYE", -Number(payslip.paye)]);
    rows.push(["UIF (employee)", -Number(payslip.uif_employee)]);
    if (Number(payslip.other_deductions) > 0) {
      rows.push(["Other deductions", -Number(payslip.other_deductions)]);
    }

    rows.forEach(([label, amount]) => {
      doc.text(label, marginX, y);
      doc.text(`R${amount.toFixed(2)}`, 520, y, { align: "right" });
      y += 20;
    });

    y += 10;
    doc.line(marginX, y, 520, y);
    y += 24;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(`Net pay: R${Number(payslip.net_pay).toFixed(2)}`, 520, y, { align: "right" });
  }

  function handleDownloadPayslip(payslip) {
    setExportingPayslipId(payslip.id);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      drawPayslipContent(doc, payslip);
      doc.save(`${selectedRun.run_number}-${(payslip.staff?.full_name || "payslip").replace(/\s+/g, "_")}.pdf`);
    } finally {
      setExportingPayslipId(null);
    }
  }

  function handleDownloadAllPayslips() {
    if (!selectedRun || selectedPayslips.length === 0) return;
    setExportingAll(true);
    try {
      const doc = new jsPDF({ unit: "pt", format: "a4" });
      selectedPayslips.forEach((payslip, i) => {
        if (i > 0) doc.addPage();
        drawPayslipContent(doc, payslip);
      });
      doc.save(`${selectedRun.run_number}-all-payslips.pdf`);
    } finally {
      setExportingAll(false);
    }
  }

  return (
    <div className="pay-page">
      {/* Ambient dot-grid background, sits fixed behind everything. A
          navy/purple/blue gradient overlay (in CSS) keeps it dim and
          on-theme, matching the rest of the app's ambient backgrounds. */}
      <div className="pay-bg" aria-hidden="true">
        <DotGrid
          dotSize={5}
          gap={15}
          baseColor="#242032"
          activeColor="#7C3AED"
          proximity={120}
          shockRadius={250}
          shockStrength={5}
          resistance={750}
          returnDuration={1.5}
          className="pay-bg-dotgrid"
        />
        <div className="pay-bg-overlay" />
      </div>

      <div className="pay-content">
        <div className="pay-body">
          <div className={`pay-header ${mounted ? "pay-in" : ""}`}>
            <div>
              <p className="pay-eyebrow">Finance</p>
              <h1 className="pay-heading">Payroll</h1>
            </div>
            <div className="pay-header-actions">
              <button
                className="pay-add-btn"
                onClick={openCreateRun}
                disabled={payableStaff.length === 0 || !taxTable}
                title={!taxTable ? "Waiting for tax table to load..." : ""}
              >
                + New pay run
              </button>
            </div>
          </div>

          {taxTableLoading && (
            <p className="pay-muted" style={{ marginBottom: 16 }}>
              Loading current tax table...
            </p>
          )}

          {!taxTableLoading && taxTableError && (
            <div className="pay-empty" style={{ marginBottom: 24 }}>
              {taxTableError}
            </div>
          )}

          {!taxTableLoading && taxTable && (
            <p className="pay-muted" style={{ marginBottom: 16 }}>
              Using tax year {taxTable.tax_year} brackets.
            </p>
          )}

          <div className={`pay-stats ${mounted ? "pay-in" : ""}`}>
            <div className="pay-stat-card">
              <p className="pay-stat-label">Staff on payroll</p>
              <p className="pay-stat-value">{payableStaff.length}</p>
            </div>
            <div className="pay-stat-card">
              <p className="pay-stat-label">Open pay runs</p>
              <p className="pay-stat-value">{openDraftCount}</p>
            </div>
            <div className="pay-stat-card">
              <p className="pay-stat-label">Total paid (YTD)</p>
              <p className="pay-stat-value">R{totalPaidYtd.toFixed(2)}</p>
            </div>
          </div>

          {!runsLoading && payableStaff.length === 0 ? (
            <div className="pay-empty">
              No staff are set up for payroll yet. Add an employment type and pay rate to a staff
              member in the Staff module to include them here.
            </div>
          ) : !runsLoading && payRuns.length === 0 ? (
            <div className="pay-empty">
              No pay runs yet.{" "}
              <button className="pay-inline-link" onClick={openCreateRun} disabled={!taxTable}>
                Create your first one
              </button>
            </div>
          ) : (
            <>
              <div className="pay-toolbar">
                <div className="pay-filters">
                  <button
                    className={`pay-filter-btn ${statusFilter === "all" ? "pay-filter-btn--active" : ""}`}
                    onClick={() => setStatusFilter("all")}
                  >
                    All <span className="pay-filter-count">{statusCounts.all}</span>
                  </button>
                  {RUN_STATUS_OPTIONS.map((s) => (
                    <button
                      key={s}
                      className={`pay-filter-btn ${statusFilter === s ? "pay-filter-btn--active" : ""}`}
                      onClick={() => setStatusFilter(s)}
                    >
                      {RUN_STATUS_LABEL[s]} <span className="pay-filter-count">{statusCounts[s]}</span>
                    </button>
                  ))}
                </div>

                <div className="pay-toolbar-right">
                  <div className="pay-search-wrap">
                    <svg
                      className="pay-search-icon"
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
                      className="pay-search-input"
                      placeholder="Search run #..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="pay-table-wrap">
                {runsLoading ? (
                  <div className="pay-skeleton">
                    {[...Array(4)].map((_, i) => (
                      <div key={i} className="pay-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                    ))}
                  </div>
                ) : (
                  <table className="pay-table">
                    <thead>
                      <tr>
                        <th>Run #</th>
                        <th>Period</th>
                        <th>Pay date</th>
                        <th>Status</th>
                        <th>Net total</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((run, i) => (
                        <tr
                          key={run.id}
                          className="pay-row"
                          style={{ animationDelay: `${i * 0.03}s` }}
                          onClick={() => openRunDetail(run)}
                        >
                          <td className="pay-name-cell">{run.run_number}</td>
                          <td className="pay-muted">
                            {run.period_start} – {run.period_end}
                          </td>
                          <td className="pay-muted">{run.pay_date}</td>
                          <td>
                            <span className={`pay-status pay-status--${run.status}`}>
                              {RUN_STATUS_LABEL[run.status]}
                            </span>
                          </td>
                          <td className="pay-muted">R{Number(run.total_net).toFixed(2)}</td>
                          <td className="pay-actions-cell" onClick={(e) => e.stopPropagation()}>
                            {confirmDeleteRunId === run.id ? (
                              <div className="pay-confirm-row">
                                Delete?
                                <button className="pay-confirm-yes" onClick={() => handleDeleteRun(run.id)}>
                                  Yes
                                </button>
                                <button className="pay-confirm-no" onClick={() => setConfirmDeleteRunId(null)}>
                                  No
                                </button>
                              </div>
                            ) : (
                              <>
                                {run.status === "draft" && (
                                  <button
                                    className="pay-action-btn"
                                    onClick={() => openEditRun(run)}
                                    disabled={!taxTable}
                                  >
                                    Edit
                                  </button>
                                )}
                                <button
                                  className="pay-action-btn pay-action-btn--danger"
                                  onClick={() => setConfirmDeleteRunId(run.id)}
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
        </div>

        {/* New / edit pay run modal */}
        {showCreateModal && (
          <div className="pay-modal-overlay" onClick={closeCreateModal}>
            <div className="pay-modal pay-modal--wide" onClick={(e) => e.stopPropagation()}>
              <h2>{isEditMode ? "Edit pay run" : "New pay run"}</h2>
              <form onSubmit={handleSaveRun}>
                <div className="pay-input-row pay-input-row--three">
                  <div>
                    <label className="pay-label">Period start</label>
                    <input
                      type="date"
                      className="pay-input"
                      value={createForm.period_start}
                      onChange={(e) => setCreateForm({ ...createForm, period_start: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="pay-label">Period end</label>
                    <input
                      type="date"
                      className="pay-input"
                      value={createForm.period_end}
                      onChange={(e) => setCreateForm({ ...createForm, period_end: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="pay-label">Pay date</label>
                    <input
                      type="date"
                      className="pay-input"
                      value={createForm.pay_date}
                      onChange={(e) => setCreateForm({ ...createForm, pay_date: e.target.value })}
                    />
                  </div>
                </div>

                <label className="pay-label">Staff included</label>
                <div className="pay-staff-list">
                  {payableStaff.map((s) => {
                    const included = includedStaffIds.includes(s.id);
                    const isHourly = s.employment_type === "hourly";
                    const bonusItems = bonusItemsByStaffId[s.id] || [];
                    return (
                      <div className="pay-staff-row-wrap" key={s.id}>
                        <div className="pay-staff-row">
                          <label className="pay-staff-checkbox">
                            <input
                              type="checkbox"
                              checked={included}
                              onChange={() => toggleIncludedStaff(s.id)}
                            />
                            <span className="pay-staff-name">{s.full_name}</span>
                            <span className="pay-staff-meta">
                              {isHourly ? "Hourly" : "Salaried"} · R{Number(s.pay_rate).toFixed(2)}
                              {isHourly ? "/hr" : ` / ${s.pay_frequency || "monthly"}`}
                            </span>
                          </label>
                          {included && isHourly && (
                            <input
                              type="number"
                              step="0.1"
                              min="0"
                              className="pay-input pay-hours-input"
                              placeholder="Hours"
                              value={hoursByStaffId[s.id] || ""}
                              onChange={(e) => updateHours(s.id, e.target.value)}
                            />
                          )}
                          {included && !isHourly && (
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              className="pay-input pay-days-absent-input"
                              placeholder="Days absent"
                              value={daysAbsentByStaffId[s.id] || ""}
                              onChange={(e) => updateDaysAbsent(s.id, e.target.value)}
                            />
                          )}
                        </div>

                        {included && (
                          <div className="pay-bonus-section">
                            {bonusItems.map((item) => (
                              <div className="pay-bonus-row" key={item.id}>
                                <input
                                  className="pay-input pay-bonus-desc"
                                  placeholder="Bonus / overtime description"
                                  value={item.description}
                                  onChange={(e) => updateBonusItem(s.id, item.id, "description", e.target.value)}
                                />
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="pay-input pay-bonus-amount"
                                  placeholder="Amount"
                                  value={item.amount}
                                  onChange={(e) => updateBonusItem(s.id, item.id, "amount", e.target.value)}
                                />
                                <button
                                  type="button"
                                  className="pay-bonus-remove"
                                  onClick={() => removeBonusItem(s.id, item.id)}
                                  aria-label="Remove line item"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <button type="button" className="pay-bonus-add" onClick={() => addBonusItem(s.id)}>
                              + Add bonus / overtime
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <label className="pay-label">Notes</label>
                <textarea
                  className="pay-input"
                  rows={2}
                  value={createForm.notes}
                  onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                />

                <div className="pay-preview">
                  <div className="pay-preview-row">
                    <span>Gross</span>
                    <span>R{previewTotals.gross.toFixed(2)}</span>
                  </div>
                  <div className="pay-preview-row">
                    <span>Deductions (PAYE + UIF)</span>
                    <span>-R{previewTotals.deductions.toFixed(2)}</span>
                  </div>
                  <div className="pay-preview-row pay-preview-row--total">
                    <span>Net pay</span>
                    <span>R{previewTotals.net.toFixed(2)}</span>
                  </div>
                </div>

                {createFormError && <p className="pay-error">{createFormError}</p>}

                <div className="pay-modal-actions">
                  <button type="button" className="pay-cancel-btn" onClick={closeCreateModal}>
                    Cancel
                  </button>
                  <button type="submit" className="pay-add-btn" disabled={savingRun || !taxTable}>
                    {savingRun ? (
                      <span className="pay-spinner" />
                    ) : isEditMode ? (
                      "Save changes"
                    ) : (
                      "Create pay run"
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Pay run detail drawer */}
        {selectedRun && (
          <div className="pay-drawer-overlay" onClick={() => setSelectedRun(null)}>
            <div className="pay-drawer" onClick={(e) => e.stopPropagation()}>
              <button className="pay-drawer-close" onClick={() => setSelectedRun(null)}>
                ×
              </button>
              <h2>{selectedRun.run_number}</h2>
              <p className="pay-drawer-sub">
                {selectedRun.period_start} – {selectedRun.period_end}
              </p>

              <div className="pay-meta-grid">
                <div className="pay-meta-item">
                  <p className="pay-meta-label">Status</p>
                  <p className="pay-meta-value">{RUN_STATUS_LABEL[selectedRun.status]}</p>
                </div>
                <div className="pay-meta-item">
                  <p className="pay-meta-label">Pay date</p>
                  <p className="pay-meta-value">{selectedRun.pay_date}</p>
                </div>
                <div className="pay-meta-item">
                  <p className="pay-meta-label">Net total</p>
                  <p className="pay-meta-value">R{Number(selectedRun.total_net).toFixed(2)}</p>
                </div>
              </div>

              {selectedRun.status === "draft" && (
                <button
                  className="pay-action-btn pay-edit-run-btn"
                  onClick={() => openEditRun(selectedRun)}
                  disabled={!taxTable}
                >
                  Edit this pay run
                </button>
              )}

              <div className="pay-section-header">
                <div className="pay-section-title">Payslips</div>
                {selectedPayslips.length > 0 && (
                  <button
                    className="pay-download-all-btn"
                    onClick={handleDownloadAllPayslips}
                    disabled={exportingAll}
                  >
                    {exportingAll ? <span className="pay-spinner" /> : "Download all (PDF)"}
                  </button>
                )}
              </div>

              {runDetailLoading ? (
                <p className="pay-log-empty">Loading...</p>
              ) : (
                <div className="pay-payslips">
                  {selectedPayslips.map((p) => {
                    const bonusItems = p.payslip_line_items || [];
                    const bonusTotal = bonusItems.reduce((sum, li) => sum + Number(li.amount || 0), 0);
                    return (
                      <div key={p.id} className="pay-payslip">
                        <div className="pay-payslip-top">
                          <span>{p.staff?.full_name || "—"}</span>
                          <span className="pay-muted">R{Number(p.net_pay).toFixed(2)} net</span>
                        </div>
                        <div className="pay-payslip-meta">
                          <span className="pay-muted">Gross R{Number(p.gross_pay).toFixed(2)}</span>
                          <span className="pay-muted">PAYE R{Number(p.paye).toFixed(2)}</span>
                          <span className="pay-muted">UIF R{Number(p.uif_employee).toFixed(2)}</span>
                          {Number(p.days_absent) > 0 && (
                            <span className="pay-badge pay-badge--absent">{p.days_absent} day(s) absent</span>
                          )}
                          {bonusTotal > 0 && (
                            <span className="pay-badge pay-badge--bonus">+R{bonusTotal.toFixed(2)} bonus/OT</span>
                          )}
                        </div>
                        {bonusItems.length > 0 && (
                          <div className="pay-payslip-line-items">
                            {bonusItems.map((li) => (
                              <div className="pay-payslip-line-item" key={li.id}>
                                <span>{li.description}</span>
                                <span>R{Number(li.amount).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <button
                          className="pay-payslip-download"
                          onClick={() => handleDownloadPayslip(p)}
                          disabled={exportingPayslipId === p.id}
                        >
                          {exportingPayslipId === p.id ? <span className="pay-spinner" /> : "Download PDF"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {selectedRun.status === "paid" && (
                <div className="pay-drawer-actions">
                  <button
                    className="pay-add-btn"
                    onClick={handleLogToExpenses}
                    disabled={loggingExpense || Boolean(selectedRun.expense_id)}
                  >
                    {loggingExpense ? (
                      <span className="pay-spinner" />
                    ) : selectedRun.expense_id ? (
                      "Logged to Expenses"
                    ) : (
                      "Log to Expenses"
                    )}
                  </button>
                </div>
              )}

              {selectedRun.status === "draft" && (
                <div className="pay-drawer-actions">
                  <button className="pay-add-btn" onClick={handleProcessRun} disabled={processing}>
                    {processing ? <span className="pay-spinner" /> : "Mark as processed"}
                  </button>
                </div>
              )}

              {selectedRun.status === "processed" && (
                <div className="pay-drawer-actions">
                  <button className="pay-add-btn" onClick={handleMarkPaid} disabled={markingPaid}>
                    {markingPaid ? <span className="pay-spinner" /> : "Mark as paid"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {toast && <div className="pay-toast pay-toast--success">{toast}</div>}
      </div>
    </div>
  );
}