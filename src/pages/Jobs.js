import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import "./Jobs.css";

const STATUS_OPTIONS = [
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "on_hold", label: "On hold" },
  { value: "completed", label: "Completed" },
  { value: "invoiced", label: "Invoiced" },
  { value: "cancelled", label: "Cancelled" },
  { value: "overdue", label: "Overdue" },
];

const EMPTY_FORM = {
  title: "",
  customer_id: "",
  quote_id: "",
  assigned_staff_id: "",
  start_date: "",
  due_date: "",
  notes: "",
  status: "not_started",
};

function taskProgress(tasks) {
  if (!tasks || tasks.length === 0) return null;
  const done = tasks.filter((t) => t.is_done).length;
  return { done, total: tasks.length };
}

/* ---------------------------------------------------------------- */
/* Animated background (ShapeGrid, retuned to the navy/purple/blue/  */
/* teal theme). Kept self-contained in this file.                    */
/* ---------------------------------------------------------------- */

function JobsBackground({
  direction = "diagonal",
  speed = 0.4,
  squareSize = 42,
  shape = "square",
  hoverTrailAmount = 6,
}) {
  const canvasRef = useRef(null);
  const requestRef = useRef(null);
  const gridOffset = useRef({ x: 0, y: 0 });
  const hoveredSquare = useRef(null);
  const trailCells = useRef([]);
  const cellOpacities = useRef(new Map());

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    const borderColor = "rgba(124, 58, 237, 0.16)"; // faint purple grid lines
    const hoverFillColor = "rgba(20, 184, 166, 0.22)"; // teal hover fill

    const isHex = shape === "hexagon";
    const isTri = shape === "triangle";
    const hexHoriz = squareSize * 1.5;
    const hexVert = squareSize * Math.sqrt(3);

    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };

    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    const drawHex = (cx, cy, size) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const vx = cx + size * Math.cos(angle);
        const vy = cy + size * Math.sin(angle);
        if (i === 0) ctx.moveTo(vx, vy);
        else ctx.lineTo(vx, vy);
      }
      ctx.closePath();
    };

    const drawCircle = (cx, cy, size) => {
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.closePath();
    };

    const drawTriangle = (cx, cy, size, flip) => {
      ctx.beginPath();
      if (flip) {
        ctx.moveTo(cx, cy + size / 2);
        ctx.lineTo(cx + size / 2, cy - size / 2);
        ctx.lineTo(cx - size / 2, cy - size / 2);
      } else {
        ctx.moveTo(cx, cy - size / 2);
        ctx.lineTo(cx + size / 2, cy + size / 2);
        ctx.lineTo(cx - size / 2, cy + size / 2);
      }
      ctx.closePath();
    };

    const drawGrid = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (isHex) {
        const colShift = Math.floor(gridOffset.current.x / hexHoriz);
        const offsetX = ((gridOffset.current.x % hexHoriz) + hexHoriz) % hexHoriz;
        const offsetY = ((gridOffset.current.y % hexVert) + hexVert) % hexVert;
        const cols = Math.ceil(canvas.width / hexHoriz) + 3;
        const rows = Math.ceil(canvas.height / hexVert) + 3;

        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * hexHoriz + offsetX;
            const cy = row * hexVert + ((col + colShift) % 2 !== 0 ? hexVert / 2 : 0) + offsetY;
            const cellKey = `${col},${row}`;
            const alpha = cellOpacities.current.get(cellKey);
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawHex(cx, cy, squareSize);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawHex(cx, cy, squareSize);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else if (isTri) {
        const halfW = squareSize / 2;
        const colShift = Math.floor(gridOffset.current.x / halfW);
        const rowShift = Math.floor(gridOffset.current.y / squareSize);
        const offsetX = ((gridOffset.current.x % halfW) + halfW) % halfW;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(canvas.width / halfW) + 4;
        const rows = Math.ceil(canvas.height / squareSize) + 4;

        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * halfW + offsetX;
            const cy = row * squareSize + squareSize / 2 + offsetY;
            const flip = ((col + colShift + row + rowShift) % 2 + 2) % 2 !== 0;
            const cellKey = `${col},${row}`;
            const alpha = cellOpacities.current.get(cellKey);
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawTriangle(cx, cy, squareSize, flip);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawTriangle(cx, cy, squareSize, flip);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else if (shape === "circle") {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(canvas.width / squareSize) + 3;
        const rows = Math.ceil(canvas.height / squareSize) + 3;

        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const cx = col * squareSize + squareSize / 2 + offsetX;
            const cy = row * squareSize + squareSize / 2 + offsetY;
            const cellKey = `${col},${row}`;
            const alpha = cellOpacities.current.get(cellKey);
            if (alpha) {
              ctx.globalAlpha = alpha;
              drawCircle(cx, cy, squareSize);
              ctx.fillStyle = hoverFillColor;
              ctx.fill();
              ctx.globalAlpha = 1;
            }
            drawCircle(cx, cy, squareSize);
            ctx.strokeStyle = borderColor;
            ctx.stroke();
          }
        }
      } else {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const cols = Math.ceil(canvas.width / squareSize) + 3;
        const rows = Math.ceil(canvas.height / squareSize) + 3;

        for (let col = -2; col < cols; col++) {
          for (let row = -2; row < rows; row++) {
            const sx = col * squareSize + offsetX;
            const sy = row * squareSize + offsetY;
            const cellKey = `${col},${row}`;
            const alpha = cellOpacities.current.get(cellKey);
            if (alpha) {
              ctx.globalAlpha = alpha;
              ctx.fillStyle = hoverFillColor;
              ctx.fillRect(sx, sy, squareSize, squareSize);
              ctx.globalAlpha = 1;
            }
            ctx.strokeStyle = borderColor;
            ctx.strokeRect(sx, sy, squareSize, squareSize);
          }
        }
      }

      const gradient = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        0,
        canvas.width / 2,
        canvas.height / 2,
        Math.sqrt(canvas.width ** 2 + canvas.height ** 2) / 2
      );
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, "rgba(11, 15, 26, 0.5)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };

    const updateCellOpacities = () => {
      const targets = new Map();
      if (hoveredSquare.current) {
        targets.set(`${hoveredSquare.current.x},${hoveredSquare.current.y}`, 1);
      }
      if (hoverTrailAmount > 0) {
        for (let i = 0; i < trailCells.current.length; i++) {
          const t = trailCells.current[i];
          const key = `${t.x},${t.y}`;
          if (!targets.has(key)) {
            targets.set(key, (trailCells.current.length - i) / (trailCells.current.length + 1));
          }
        }
      }
      for (const [key] of targets) {
        if (!cellOpacities.current.has(key)) cellOpacities.current.set(key, 0);
      }
      for (const [key, opacity] of cellOpacities.current) {
        const target = targets.get(key) || 0;
        const next = opacity + (target - opacity) * 0.15;
        if (next < 0.005) cellOpacities.current.delete(key);
        else cellOpacities.current.set(key, next);
      }
    };

    const updateAnimation = () => {
      const effectiveSpeed = Math.max(speed, 0.1);
      const wrapX = isHex ? hexHoriz * 2 : squareSize;
      const wrapY = isHex ? hexVert : isTri ? squareSize * 2 : squareSize;

      switch (direction) {
        case "right":
          gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
          break;
        case "left":
          gridOffset.current.x = (gridOffset.current.x + effectiveSpeed + wrapX) % wrapX;
          break;
        case "up":
          gridOffset.current.y = (gridOffset.current.y + effectiveSpeed + wrapY) % wrapY;
          break;
        case "down":
          gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
          break;
        case "diagonal":
          gridOffset.current.x = (gridOffset.current.x - effectiveSpeed + wrapX) % wrapX;
          gridOffset.current.y = (gridOffset.current.y - effectiveSpeed + wrapY) % wrapY;
          break;
        default:
          break;
      }

      updateCellOpacities();
      drawGrid();
      requestRef.current = requestAnimationFrame(updateAnimation);
    };

    const handleMouseMove = (event) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      let col, row;

      if (isHex) {
        const colShift = Math.floor(gridOffset.current.x / hexHoriz);
        const offsetX = ((gridOffset.current.x % hexHoriz) + hexHoriz) % hexHoriz;
        const offsetY = ((gridOffset.current.y % hexVert) + hexVert) % hexVert;
        const adjustedX = mouseX - offsetX;
        const adjustedY = mouseY - offsetY;
        col = Math.round(adjustedX / hexHoriz);
        const rowOffset = (col + colShift) % 2 !== 0 ? hexVert / 2 : 0;
        row = Math.round((adjustedY - rowOffset) / hexVert);
      } else if (isTri) {
        const halfW = squareSize / 2;
        const offsetX = ((gridOffset.current.x % halfW) + halfW) % halfW;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const adjustedX = mouseX - offsetX;
        const adjustedY = mouseY - offsetY;
        col = Math.round(adjustedX / halfW);
        row = Math.floor(adjustedY / squareSize);
      } else if (shape === "circle") {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const adjustedX = mouseX - offsetX;
        const adjustedY = mouseY - offsetY;
        col = Math.round(adjustedX / squareSize);
        row = Math.round(adjustedY / squareSize);
      } else {
        const offsetX = ((gridOffset.current.x % squareSize) + squareSize) % squareSize;
        const offsetY = ((gridOffset.current.y % squareSize) + squareSize) % squareSize;
        const adjustedX = mouseX - offsetX;
        const adjustedY = mouseY - offsetY;
        col = Math.floor(adjustedX / squareSize);
        row = Math.floor(adjustedY / squareSize);
      }

      if (!hoveredSquare.current || hoveredSquare.current.x !== col || hoveredSquare.current.y !== row) {
        if (hoveredSquare.current && hoverTrailAmount > 0) {
          trailCells.current.unshift({ ...hoveredSquare.current });
          if (trailCells.current.length > hoverTrailAmount) trailCells.current.length = hoverTrailAmount;
        }
        hoveredSquare.current = { x: col, y: row };
      }
    };

    const handleMouseLeave = () => {
      if (hoveredSquare.current && hoverTrailAmount > 0) {
        trailCells.current.unshift({ ...hoveredSquare.current });
        if (trailCells.current.length > hoverTrailAmount) trailCells.current.length = hoverTrailAmount;
      }
      hoveredSquare.current = null;
    };

    canvas.addEventListener("mousemove", handleMouseMove);
    canvas.addEventListener("mouseleave", handleMouseLeave);

    let isVisible = false;
    let isPageVisible = !document.hidden;

    const tryStart = () => {
      if (isVisible && isPageVisible && !requestRef.current) {
        requestRef.current = requestAnimationFrame(updateAnimation);
      }
    };
    const tryStop = () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        isVisible ? tryStart() : tryStop();
      },
      { threshold: 0 }
    );
    io.observe(canvas);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? tryStart() : tryStop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryStart();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      tryStop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("mousemove", handleMouseMove);
      canvas.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [direction, speed, squareSize, shape, hoverTrailAmount]);

  return <canvas ref={canvasRef} className="job-bg-canvas" aria-hidden="true" />;
}

/* ---------------------------------------------------------------- */

export default function Jobs({ business, appUser }) {
  const [jobs, setJobs] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [acceptedQuotes, setAcceptedQuotes] = useState([]);
  const [creatorsById, setCreatorsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);

  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("due_date_asc");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [tasks, setTasks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toast, setToast] = useState(null);
  const [dragIndex, setDragIndex] = useState(null);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const loadJobs = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from("jobs")
      .select("*, customers(name), staff(full_name), job_tasks(id, is_done)")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError && data) {
      setJobs(data);

      // Resolve created_by user IDs to emails for the "by ..." sub-line.
      const creatorIds = Array.from(
        new Set(data.map((j) => j.created_by).filter(Boolean))
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

  useEffect(() => {
    loadJobs();
    supabase.from("customers").select("id, name").eq("business_id", business.id).order("name")
      .then(({ data }) => setCustomers(data || []));
    supabase.from("staff").select("id, full_name").eq("business_id", business.id).order("full_name")
      .then(({ data }) => setStaff(data || []));
    supabase.from("quotes").select("id, quote_number, customer_id").eq("business_id", business.id).eq("status", "accepted")
      .then(({ data }) => setAcceptedQuotes(data || []));
  }, [business.id, loadJobs]);

  useEffect(() => {
    if (!loading) requestAnimationFrame(() => setRevealed(true));
  }, [loading]);

  const openAddModal = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setTasks([]);
    setError("");
    setModalOpen(true);
  };

  const openEditModal = async (job) => {
    setEditingId(job.id);
    setForm({
      title: job.title || "",
      customer_id: job.customer_id || "",
      quote_id: job.quote_id || "",
      assigned_staff_id: job.assigned_staff_id || "",
      start_date: job.start_date || "",
      due_date: job.due_date || "",
      notes: job.notes || "",
      status: job.status || "not_started",
    });
    setError("");
    const { data } = await supabase
      .from("job_tasks")
      .select("*")
      .eq("job_id", job.id)
      .order("sort_order", { ascending: true });
    setTasks(data || []);
    setModalOpen(true);
  };

  // When an accepted quote is picked, auto-fill the customer to match —
  // mirrors how Invoices pre-fills customer from a converted quote.
  const handleQuoteChange = (quoteId) => {
    const quote = acceptedQuotes.find((q) => q.id === quoteId);
    setForm((f) => ({
      ...f,
      quote_id: quoteId,
      customer_id: quote ? quote.customer_id : f.customer_id,
    }));
  };

  const addTaskRow = () => {
    setTasks((t) => [...t, { id: `new-${Date.now()}`, description: "", is_done: false, sort_order: t.length, _new: true }]);
  };
  const updateTaskRow = (idx, patch) => {
    setTasks((t) => t.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
  };
  const removeTaskRow = (idx) => {
    setTasks((t) => t.filter((_, i) => i !== idx));
  };

  // Drag-to-reorder: live-reorders `tasks` as the dragged row passes over
  // another row. sort_order is derived from array index on save, so no
  // separate reorder step is needed there.
  const handleTaskDragStart = (idx) => setDragIndex(idx);
  const handleTaskDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === idx) return;
    setTasks((t) => {
      const copy = [...t];
      const [moved] = copy.splice(dragIndex, 1);
      copy.splice(idx, 0, moved);
      return copy;
    });
    setDragIndex(idx);
  };
  const handleTaskDragEnd = () => setDragIndex(null);

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError("Job title is required.");
      return;
    }
    setSaving(true);
    setError("");

    try {
      let jobId = editingId;

      if (editingId) {
        const { error: updateError } = await supabase
          .from("jobs")
          .update({
            title: form.title.trim(),
            customer_id: form.customer_id || null,
            quote_id: form.quote_id || null,
            assigned_staff_id: form.assigned_staff_id || null,
            start_date: form.start_date || null,
            due_date: form.due_date || null,
            notes: form.notes || null,
            status: form.status,
          })
          .eq("id", editingId);
        if (updateError) throw updateError;
      } else {
        const { data: numberData, error: numberError } = await supabase.rpc("get_next_number", {
          p_business_id: business.id,
          p_counter_key: "job",
        });
        if (numberError) throw numberError;

        const { data: inserted, error: insertError } = await supabase
          .from("jobs")
          .insert({
            business_id: business.id,
            job_number: `JOB-${String(numberData).padStart(4, "0")}`,
            title: form.title.trim(),
            customer_id: form.customer_id || null,
            quote_id: form.quote_id || null,
            assigned_staff_id: form.assigned_staff_id || null,
            start_date: form.start_date || null,
            due_date: form.due_date || null,
            notes: form.notes || null,
            status: form.status,
            created_by: appUser?.id,
          })
          .select()
          .single();
        if (insertError) throw insertError;
        jobId = inserted.id;
      }

      // Sync tasks: delete removed ones, update existing, insert new ones.
      const existingIds = tasks.filter((t) => !t._new).map((t) => t.id);
      if (editingId) {
        await supabase
          .from("job_tasks")
          .delete()
          .eq("job_id", jobId)
          .not("id", "in", `(${existingIds.length ? existingIds.join(",") : "00000000-0000-0000-0000-000000000000"})`);
      }
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        if (!t.description.trim()) continue;
        if (t._new) {
          await supabase.from("job_tasks").insert({
            job_id: jobId,
            description: t.description.trim(),
            is_done: t.is_done,
            sort_order: i,
          });
        } else {
          await supabase
            .from("job_tasks")
            .update({ description: t.description.trim(), is_done: t.is_done, sort_order: i })
            .eq("id", t.id);
        }
      }

      showToast(editingId ? "Job updated" : "Job created");
      setModalOpen(false);
      loadJobs();
    } catch (err) {
      setError(err.message || "Something went wrong saving this job.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    const { error: deleteError } = await supabase.from("jobs").delete().eq("id", id);
    if (!deleteError) {
      showToast("Job deleted");
      setJobs((prev) => prev.filter((j) => j.id !== id));
    }
    setConfirmDeleteId(null);
  };

  const filteredJobs = jobs
    .filter((j) => statusFilter === "all" || j.status === statusFilter)
    .filter((j) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        j.title?.toLowerCase().includes(q) ||
        j.job_number?.toLowerCase().includes(q) ||
        j.customers?.name?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "due_date_asc") return (a.due_date || "9999") > (b.due_date || "9999") ? 1 : -1;
      if (sortBy === "due_date_desc") return (a.due_date || "0000") < (b.due_date || "0000") ? 1 : -1;
      if (sortBy === "newest") return new Date(b.created_at) - new Date(a.created_at);
      if (sortBy === "title") return (a.title || "").localeCompare(b.title || "");
      return 0;
    });

  const statusCounts = STATUS_OPTIONS.reduce((acc, s) => {
    acc[s.value] = jobs.filter((j) => j.status === s.value).length;
    return acc;
  }, {});

  return (
    <div className="job-page">
      <JobsBackground direction="diagonal" speed={0.4} squareSize={42} shape="square" hoverTrailAmount={6} />

      <div className="job-body">
        <div className={`job-header ${revealed ? "job-in" : ""}`}>
          <div>
            <p className="job-eyebrow">Sales</p>
            <h1 className="job-heading">Jobs</h1>
          </div>
          <button className="job-add-btn" onClick={openAddModal}>+ New Job</button>
        </div>

        {loading ? (
          <div className="job-table-wrap">
            <div className="job-skeleton">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="job-skeleton-row" style={{ animationDelay: `${i * 0.08}s` }} />
              ))}
            </div>
          </div>
        ) : jobs.length === 0 ? (
          <div className={`job-empty ${revealed ? "job-in" : ""}`}>
            No jobs yet.{" "}
            <button className="job-inline-link" onClick={openAddModal}>Create your first job</button>
          </div>
        ) : (
          <>
            <div className={`job-toolbar ${revealed ? "job-in" : ""}`}>
              <div className="job-filters">
                <button
                  className={`job-filter-btn ${statusFilter === "all" ? "job-filter-btn--active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All <span className="job-filter-count">{jobs.length}</span>
                </button>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    className={`job-filter-btn ${statusFilter === s.value ? "job-filter-btn--active" : ""}`}
                    onClick={() => setStatusFilter(s.value)}
                  >
                    {s.label} <span className="job-filter-count">{statusCounts[s.value] || 0}</span>
                  </button>
                ))}
              </div>
              <div className="job-toolbar-right">
                <div className="job-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    placeholder="Search jobs..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="job-search-clear" onClick={() => setSearch("")}>×</button>
                  )}
                </div>
                <select className="job-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="due_date_asc">Due date (soonest)</option>
                  <option value="due_date_desc">Due date (latest)</option>
                  <option value="newest">Newest first</option>
                  <option value="title">Title (A–Z)</option>
                </select>
              </div>
            </div>

            <div className={`job-table-wrap ${revealed ? "job-in" : ""}`}>
              <table className="job-table">
                <thead>
                  <tr>
                    <th>Job</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Assigned</th>
                    <th>Due</th>
                    <th>Progress</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((job, idx) => {
                    const progress = taskProgress(job.job_tasks);
                    return (
                      <tr key={job.id} className="job-row" style={{ animationDelay: `${Math.min(idx, 8) * 0.04}s` }}>
                        <td>
                          <div className="job-name-cell">{job.title}</div>
                          <div className="job-muted">
                            {job.job_number}
                            {job.created_by && creatorsById[job.created_by] && (
                              <span className="job-created-by"> · by {creatorsById[job.created_by]}</span>
                            )}
                          </div>
                        </td>
                        <td className="job-muted">{job.customers?.name || "—"}</td>
                        <td>
                          <span className={`job-status job-status--${job.status}`}>
                            {STATUS_OPTIONS.find((s) => s.value === job.status)?.label || job.status}
                          </span>
                        </td>
                        <td className="job-muted">{job.staff?.full_name || "Unassigned"}</td>
                        <td className="job-muted">{job.due_date || "—"}</td>
                        <td className="job-progress-cell">
                          {progress ? `${progress.done}/${progress.total}` : "—"}
                        </td>
                        <td>
                          {confirmDeleteId === job.id ? (
                            <div className="job-confirm-row">
                              Delete this job?
                              <button className="job-confirm-yes" onClick={() => handleDelete(job.id)}>Yes</button>
                              <button className="job-confirm-no" onClick={() => setConfirmDeleteId(null)}>No</button>
                            </div>
                          ) : (
                            <div className="job-actions-cell">
                              <button className="job-action-btn" onClick={() => openEditModal(job)}>Edit</button>
                              <button
                                className="job-action-btn job-action-btn--danger"
                                onClick={() => setConfirmDeleteId(job.id)}
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {modalOpen && (
        <div className="job-modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="job-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingId ? "Edit Job" : "New Job"}</h2>

            {error && <p className="job-error">{error}</p>}

            <label className="job-label">Title</label>
            <input
              className="job-input"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Kitchen renovation — Smith residence"
            />

            <div className="job-row-2">
              <div>
                <label className="job-label">From accepted quote</label>
                <select className="job-select" value={form.quote_id} onChange={(e) => handleQuoteChange(e.target.value)}>
                  <option value="">— None —</option>
                  {acceptedQuotes.map((q) => (
                    <option key={q.id} value={q.id}>{q.quote_number}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="job-label">Customer</label>
                <select
                  className="job-select"
                  value={form.customer_id}
                  onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}
                >
                  <option value="">— None —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="job-row-2">
              <div>
                <label className="job-label">Assigned to</label>
                <select
                  className="job-select"
                  value={form.assigned_staff_id}
                  onChange={(e) => setForm((f) => ({ ...f, assigned_staff_id: e.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>{s.full_name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="job-label">Status</label>
                <select
                  className="job-select"
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="job-row-2">
              <div>
                <label className="job-label">Start date</label>
                <input
                  type="date"
                  className="job-input"
                  value={form.start_date}
                  onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div>
                <label className="job-label">Due date</label>
                <input
                  type="date"
                  className="job-input"
                  value={form.due_date}
                  onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                />
              </div>
            </div>

            <label className="job-label">Notes</label>
            <textarea
              className="job-textarea"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Any details worth keeping on record for this job..."
            />

            <div className="job-items-label">
              <label className="job-label" style={{ margin: 0 }}>Tasks</label>
              <button className="job-add-row-btn" onClick={addTaskRow}>+ Add task</button>
            </div>
            {tasks.map((t, idx) => (
              <div
                key={t.id}
                className={`job-task-row ${t.is_done ? "job-task-row--done" : ""} ${dragIndex === idx ? "job-task-row--dragging" : ""}`}
                draggable
                onDragStart={() => handleTaskDragStart(idx)}
                onDragOver={(e) => handleTaskDragOver(e, idx)}
                onDragEnd={handleTaskDragEnd}
              >
                <span className="job-task-drag-handle" title="Drag to reorder">
                  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor">
                    <circle cx="2" cy="2" r="1.5" /><circle cx="8" cy="2" r="1.5" />
                    <circle cx="2" cy="8" r="1.5" /><circle cx="8" cy="8" r="1.5" />
                    <circle cx="2" cy="14" r="1.5" /><circle cx="8" cy="14" r="1.5" />
                  </svg>
                </span>
                <input
                  type="checkbox"
                  className="job-task-checkbox"
                  checked={t.is_done}
                  onChange={(e) => updateTaskRow(idx, { is_done: e.target.checked })}
                />
                <input
                  className="job-input"
                  value={t.description}
                  onChange={(e) => updateTaskRow(idx, { description: e.target.value })}
                  placeholder="Task description"
                />
                <button className="job-remove-row-btn" onClick={() => removeTaskRow(idx)}>×</button>
              </div>
            ))}
            {tasks.length > 0 && (
              <div className="job-progress-summary">
                <span>Progress</span>
                <strong>{tasks.filter((t) => t.is_done).length}/{tasks.length} done</strong>
              </div>
            )}

            <div className="job-modal-actions">
              <button className="job-cancel-btn" onClick={() => setModalOpen(false)}>Cancel</button>
              <button className="job-add-btn" onClick={handleSave} disabled={saving}>
                {saving ? <span className="job-spinner" /> : editingId ? "Save Changes" : "Create Job"}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="job-toast job-toast--success">{toast}</div>}
    </div>
  );
}