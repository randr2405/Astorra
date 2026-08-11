import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Renderer, Triangle, Program, Mesh } from "ogl";
import { supabase } from "../lib/supabaseClient";
import AppNav from "../components/AppNav";
import "./Notifications.css";

const UNDO_WINDOW_MS = 5000;

/* ------------------------------------------------------------------ */
/* Prism — inlined background shader (no external import)              */
/* ------------------------------------------------------------------ */

const Prism = ({
  height = 3.5,
  baseWidth = 5.5,
  animationType = "rotate",
  glow = 1,
  offset = { x: 0, y: 0 },
  noise = 0,
  transparent = true,
  scale = 3.6,
  hueShift = 0,
  colorFrequency = 1,
  hoverStrength = 2,
  inertia = 0.05,
  bloom = 1,
  suspendWhenOffscreen = false,
  timeScale = 0.5,
}) => {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const H = Math.max(0.001, height);
    const BW = Math.max(0.001, baseWidth);
    const BASE_HALF = BW * 0.5;
    const GLOW = Math.max(0.0, glow);
    const NOISE = Math.max(0.0, noise);
    const offX = offset?.x ?? 0;
    const offY = offset?.y ?? 0;
    const SAT = transparent ? 1.5 : 1;
    const SCALE = Math.max(0.001, scale);
    const HUE = hueShift || 0;
    const CFREQ = Math.max(0.0, colorFrequency || 1);
    const BLOOM = Math.max(0.0, bloom || 1);
    const RSX = 1;
    const RSY = 1;
    const RSZ = 1;
    const TS = Math.max(0, timeScale || 1);
    const HOVSTR = Math.max(0, hoverStrength || 1);
    const INERT = Math.max(0, Math.min(1, inertia || 0.12));

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const renderer = new Renderer({
      dpr,
      alpha: transparent,
      antialias: false,
    });
    const gl = renderer.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    Object.assign(gl.canvas.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block",
    });
    container.appendChild(gl.canvas);

    const vertex = /* glsl */ `
      attribute vec2 position;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `;

    const fragment = /* glsl */ `
      precision highp float;

      uniform vec2  iResolution;
      uniform float iTime;

      uniform float uHeight;
      uniform float uBaseHalf;
      uniform mat3  uRot;
      uniform int   uUseBaseWobble;
      uniform float uGlow;
      uniform vec2  uOffsetPx;
      uniform float uNoise;
      uniform float uSaturation;
      uniform float uScale;
      uniform float uHueShift;
      uniform float uColorFreq;
      uniform float uBloom;
      uniform float uCenterShift;
      uniform float uInvBaseHalf;
      uniform float uInvHeight;
      uniform float uMinAxis;
      uniform float uPxScale;
      uniform float uTimeScale;

      vec4 tanh4(vec4 x){
        vec4 e2x = exp(2.0*x);
        return (e2x - 1.0) / (e2x + 1.0);
      }

      float rand(vec2 co){
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453123);
      }

      float sdOctaAnisoInv(vec3 p){
        vec3 q = vec3(abs(p.x) * uInvBaseHalf, abs(p.y) * uInvHeight, abs(p.z) * uInvBaseHalf);
        float m = q.x + q.y + q.z - 1.0;
        return m * uMinAxis * 0.5773502691896258;
      }

      float sdPyramidUpInv(vec3 p){
        float oct = sdOctaAnisoInv(p);
        float halfSpace = -p.y;
        return max(oct, halfSpace);
      }

      mat3 hueRotation(float a){
        float c = cos(a), s = sin(a);
        mat3 W = mat3(
          0.299, 0.587, 0.114,
          0.299, 0.587, 0.114,
          0.299, 0.587, 0.114
        );
        mat3 U = mat3(
           0.701, -0.587, -0.114,
          -0.299,  0.413, -0.114,
          -0.300, -0.588,  0.886
        );
        mat3 V = mat3(
           0.168, -0.331,  0.500,
           0.328,  0.035, -0.500,
          -0.497,  0.296,  0.201
        );
        return W + U * c + V * s;
      }

      void main(){
        vec2 f = (gl_FragCoord.xy - 0.5 * iResolution.xy - uOffsetPx) * uPxScale;

        float z = 5.0;
        float d = 0.0;

        vec3 p;
        vec4 o = vec4(0.0);

        float centerShift = uCenterShift;
        float cf = uColorFreq;

        mat2 wob = mat2(1.0);
        if (uUseBaseWobble == 1) {
          float t = iTime * uTimeScale;
          float c0 = cos(t + 0.0);
          float c1 = cos(t + 33.0);
          float c2 = cos(t + 11.0);
          wob = mat2(c0, c1, c2, c0);
        }

        const int STEPS = 100;
        for (int i = 0; i < STEPS; i++) {
          p = vec3(f, z);
          p.xz = p.xz * wob;
          p = uRot * p;
          vec3 q = p;
          q.y += centerShift;
          d = 0.1 + 0.2 * abs(sdPyramidUpInv(q));
          z -= d;
          o += (sin((p.y + z) * cf + vec4(0.0, 1.0, 2.0, 3.0)) + 1.0) / d;
        }

        o = tanh4(o * o * (uGlow * uBloom) / 1e5);

        vec3 col = o.rgb;
        float n = rand(gl_FragCoord.xy + vec2(iTime));
        col += (n - 0.5) * uNoise;
        col = clamp(col, 0.0, 1.0);

        float L = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = clamp(mix(vec3(L), col, uSaturation), 0.0, 1.0);

        if(abs(uHueShift) > 0.0001){
          col = clamp(hueRotation(uHueShift) * col, 0.0, 1.0);
        }

        gl_FragColor = vec4(col, o.a);
      }
    `;

    const geometry = new Triangle(gl);
    const iResBuf = new Float32Array(2);
    const offsetPxBuf = new Float32Array(2);

    const program = new Program(gl, {
      vertex,
      fragment,
      uniforms: {
        iResolution: { value: iResBuf },
        iTime: { value: 0 },
        uHeight: { value: H },
        uBaseHalf: { value: BASE_HALF },
        uUseBaseWobble: { value: 1 },
        uRot: { value: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) },
        uGlow: { value: GLOW },
        uOffsetPx: { value: offsetPxBuf },
        uNoise: { value: NOISE },
        uSaturation: { value: SAT },
        uScale: { value: SCALE },
        uHueShift: { value: HUE },
        uColorFreq: { value: CFREQ },
        uBloom: { value: BLOOM },
        uCenterShift: { value: H * 0.25 },
        uInvBaseHalf: { value: 1 / BASE_HALF },
        uInvHeight: { value: 1 / H },
        uMinAxis: { value: Math.min(BASE_HALF, H) },
        uPxScale: {
          value: 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE),
        },
        uTimeScale: { value: TS },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      iResBuf[0] = gl.drawingBufferWidth;
      iResBuf[1] = gl.drawingBufferHeight;
      offsetPxBuf[0] = offX * dpr;
      offsetPxBuf[1] = offY * dpr;
      program.uniforms.uPxScale.value = 1 / ((gl.drawingBufferHeight || 1) * 0.1 * SCALE);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    const rotBuf = new Float32Array(9);
    const setMat3FromEuler = (yawY, pitchX, rollZ, out) => {
      const cy = Math.cos(yawY),
        sy = Math.sin(yawY);
      const cx = Math.cos(pitchX),
        sx = Math.sin(pitchX);
      const cz = Math.cos(rollZ),
        sz = Math.sin(rollZ);
      const r00 = cy * cz + sy * sx * sz;
      const r01 = -cy * sz + sy * sx * cz;
      const r02 = sy * cx;

      const r10 = cx * sz;
      const r11 = cx * cz;
      const r12 = -sx;

      const r20 = -sy * cz + cy * sx * sz;
      const r21 = sy * sz + cy * sx * cz;
      const r22 = cy * cx;

      out[0] = r00;
      out[1] = r10;
      out[2] = r20;
      out[3] = r01;
      out[4] = r11;
      out[5] = r21;
      out[6] = r02;
      out[7] = r12;
      out[8] = r22;
      return out;
    };

    const NOISE_IS_ZERO = NOISE < 1e-6;
    let raf = 0;
    const t0 = performance.now();
    const startRAF = () => {
      if (raf) return;
      raf = requestAnimationFrame(render);
    };
    const stopRAF = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const rnd = () => Math.random();
    const wX = (0.3 + rnd() * 0.6) * RSX;
    const wY = (0.2 + rnd() * 0.7) * RSY;
    const wZ = (0.1 + rnd() * 0.5) * RSZ;
    const phX = rnd() * Math.PI * 2;
    const phZ = rnd() * Math.PI * 2;

    let yaw = 0,
      pitch = 0,
      roll = 0;
    let targetYaw = 0,
      targetPitch = 0;
    const lerp = (a, b, t) => a + (b - a) * t;

    const pointer = { x: 0, y: 0, inside: true };
    const onMove = (e) => {
      const ww = Math.max(1, window.innerWidth);
      const wh = Math.max(1, window.innerHeight);
      const cx = ww * 0.5;
      const cy = wh * 0.5;
      const nx = (e.clientX - cx) / (ww * 0.5);
      const ny = (e.clientY - cy) / (wh * 0.5);
      pointer.x = Math.max(-1, Math.min(1, nx));
      pointer.y = Math.max(-1, Math.min(1, ny));
      pointer.inside = true;
    };
    const onLeave = () => {
      pointer.inside = false;
    };
    const onBlur = () => {
      pointer.inside = false;
    };

    let onPointerMove = null;
    if (animationType === "hover") {
      onPointerMove = (e) => {
        onMove(e);
        startRAF();
      };
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("mouseleave", onLeave);
      window.addEventListener("blur", onBlur);
      program.uniforms.uUseBaseWobble.value = 0;
    } else if (animationType === "3drotate") {
      program.uniforms.uUseBaseWobble.value = 0;
    } else {
      program.uniforms.uUseBaseWobble.value = 1;
    }

    const render = (t) => {
      const time = (t - t0) * 0.001;
      program.uniforms.iTime.value = time;

      let continueRAF = true;

      if (animationType === "hover") {
        const maxPitch = 0.6 * HOVSTR;
        const maxYaw = 0.6 * HOVSTR;
        targetYaw = (pointer.inside ? -pointer.x : 0) * maxYaw;
        targetPitch = (pointer.inside ? pointer.y : 0) * maxPitch;
        const prevYaw = yaw;
        const prevPitch = pitch;
        const prevRoll = roll;
        yaw = lerp(prevYaw, targetYaw, INERT);
        pitch = lerp(prevPitch, targetPitch, INERT);
        roll = lerp(prevRoll, 0, 0.1);
        program.uniforms.uRot.value = setMat3FromEuler(yaw, pitch, roll, rotBuf);

        if (NOISE_IS_ZERO) {
          const settled =
            Math.abs(yaw - targetYaw) < 1e-4 && Math.abs(pitch - targetPitch) < 1e-4 && Math.abs(roll) < 1e-4;
          if (settled) continueRAF = false;
        }
      } else if (animationType === "3drotate") {
        const tScaled = time * TS;
        yaw = tScaled * wY;
        pitch = Math.sin(tScaled * wX + phX) * 0.6;
        roll = Math.sin(tScaled * wZ + phZ) * 0.5;
        program.uniforms.uRot.value = setMat3FromEuler(yaw, pitch, roll, rotBuf);
        if (TS < 1e-6) continueRAF = false;
      } else {
        rotBuf[0] = 1;
        rotBuf[1] = 0;
        rotBuf[2] = 0;
        rotBuf[3] = 0;
        rotBuf[4] = 1;
        rotBuf[5] = 0;
        rotBuf[6] = 0;
        rotBuf[7] = 0;
        rotBuf[8] = 1;
        program.uniforms.uRot.value = rotBuf;
        if (TS < 1e-6) continueRAF = false;
      }

      renderer.render({ scene: mesh });
      if (continueRAF) {
        raf = requestAnimationFrame(render);
      } else {
        raf = 0;
      }
    };

    if (suspendWhenOffscreen) {
      const io = new IntersectionObserver((entries) => {
        const vis = entries.some((e) => e.isIntersecting);
        if (vis) startRAF();
        else stopRAF();
      });
      io.observe(container);
      startRAF();
      container.__prismIO = io;
    } else {
      startRAF();
    }

    return () => {
      stopRAF();
      ro.disconnect();
      if (animationType === "hover") {
        if (onPointerMove) window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("mouseleave", onLeave);
        window.removeEventListener("blur", onBlur);
      }
      if (suspendWhenOffscreen) {
        const io = container.__prismIO;
        if (io) io.disconnect();
        delete container.__prismIO;
      }
      if (gl.canvas.parentElement === container) container.removeChild(gl.canvas);
    };
  }, [
    height,
    baseWidth,
    animationType,
    glow,
    noise,
    offset?.x,
    offset?.y,
    scale,
    transparent,
    hueShift,
    colorFrequency,
    timeScale,
    hoverStrength,
    inertia,
    bloom,
    suspendWhenOffscreen,
  ]);

  return <div className="notif-prism-canvas" ref={containerRef} />;
};

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

function formatFullDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function startOfDay(d) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

// Buckets a notification's created_at into one of four groups, based on
// calendar-day distance from today (not a rolling 24h/7-day window).
function bucketFor(iso) {
  const created = startOfDay(new Date(iso));
  const today = startOfDay(new Date());
  const diffDays = Math.round((today - created) / 86400000);

  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Earlier this week";
  return "Older";
}

const BUCKET_ORDER = ["Today", "Yesterday", "Earlier this week", "Older"];

// Infers a notification "type" from its message text so we can show a
// colored icon without needing a schema change. Falls back to a generic
// bell for anything that doesn't match a known pattern.
function typeFor(message) {
  const m = message.toLowerCase();
  if (m.includes("overdue")) {
    return { key: "invoice", label: "Invoice", className: "notif-type--invoice" };
  }
  if (m.startsWith("reminder:") || m.includes("coming up")) {
    return { key: "booking", label: "Booking", className: "notif-type--booking" };
  }
  if (m.includes("uploaded to documents")) {
    return { key: "document", label: "Document", className: "notif-type--document" };
  }
  if (m.includes("ai builder installed")) {
    return { key: "ai", label: "AI Builder", className: "notif-type--ai" };
  }
  return { key: "general", label: "Update", className: "notif-type--general" };
}

const TYPE_ICONS = {
  invoice: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 3h9l3 3v15H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 9h6M9 13h6M9 17h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  booking: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  document: (
    <svg viewBox="0 0 24 24" fill="none">
      <path d="M6 3h8l4 4v14H6z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  ),
  ai: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  general: (
    <svg viewBox="0 0 24 24" fill="none">
      <path
        d="M12 4a5 5 0 00-5 5v3.2c0 .6-.2 1.2-.6 1.7L5 16h14l-1.4-2.1a2.7 2.7 0 01-.6-1.7V9a5 5 0 00-5-5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 18a2.5 2.5 0 005 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

function Notifications({ business }) {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all | unread
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(() => new Set());

  // Pending "undo" deletions: id -> { notification, timerId }. The item
  // is already removed from the visible list; if the timer fires without
  // being cancelled, the delete actually commits to the DB.
  const pendingDeletesRef = useRef(new Map());
  const [toast, setToast] = useState(null); // { message, onUndo }

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!error) setNotifications(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Realtime: keep the list live without needing a manual refresh.
  //
  // supabase-js caches channels by topic name. If a channel with this same
  // name already exists and is already subscribed (e.g. React 18 StrictMode
  // double-invoking effects in dev, or a remount before the previous
  // cleanup finished), calling `.channel()` again returns that *existing,
  // already-subscribed* channel — and calling `.on()` on an
  // already-subscribed channel throws synchronously, which crashes the
  // whole render tree. Guard against that by removing any stale channel
  // with the same topic before creating a fresh one.
  useEffect(() => {
    const channelName = `notifications-${business.id}`;
    const topic = `realtime:${channelName}`;

    const existing = supabase.getChannels().find((c) => c.topic === topic);
    if (existing) {
      supabase.removeChannel(existing);
    }

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `business_id=eq.${business.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setNotifications((prev) => {
              if (prev.some((n) => n.id === payload.new.id)) return prev;
              return [payload.new, ...prev];
            });
          } else if (payload.eventType === "UPDATE") {
            setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? payload.new : n)));
          } else if (payload.eventType === "DELETE") {
            setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [business.id]);

  // Clean up any in-flight undo timers if the component unmounts.
  useEffect(() => {
    const pendingDeletes = pendingDeletesRef.current;
    return () => {
      pendingDeletes.forEach(({ timerId }) => clearTimeout(timerId));
      pendingDeletes.clear();
    };
  }, []);

  const handleMarkRead = async (id) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
  };

  const handleMarkAllRead = async () => {
    const unreadIds = notifications.filter((n) => !n.is_read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    await supabase.from("notifications").update({ is_read: true }).in("id", unreadIds);
  };

  const dismissToast = () => setToast(null);

  // ---------- Undo-able delete (single + bulk share this) ----------
  const commitDelete = async (ids) => {
    ids.forEach((id) => pendingDeletesRef.current.delete(id));
    await supabase.from("notifications").delete().in("id", ids);
  };

  const scheduleDelete = (items, message) => {
    const ids = items.map((n) => n.id);

    // Remove from view immediately.
    setNotifications((prev) => prev.filter((n) => !ids.includes(n.id)));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    const timerId = setTimeout(() => {
      commitDelete(ids);
      setToast((current) => (current?.ids?.join() === ids.join() ? null : current));
    }, UNDO_WINDOW_MS);

    items.forEach((n) => pendingDeletesRef.current.set(n.id, { notification: n, timerId }));

    setToast({
      ids,
      message,
      onUndo: () => {
        ids.forEach((id) => {
          const pending = pendingDeletesRef.current.get(id);
          if (pending) {
            clearTimeout(pending.timerId);
            pendingDeletesRef.current.delete(id);
          }
        });
        setNotifications((prev) => {
          const restored = items.filter((n) => !prev.some((p) => p.id === n.id));
          return [...prev, ...restored].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        });
        setToast(null);
      },
    });
  };

  const handleDelete = (n) => {
    scheduleDelete([n], "Notification deleted");
  };

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    scheduleDelete([...notifications], `${notifications.length} notification${notifications.length === 1 ? "" : "s"} cleared`);
  };

  const handleBulkDelete = () => {
    const items = notifications.filter((n) => selected.has(n.id));
    if (items.length === 0) return;
    scheduleDelete(items, `${items.length} notification${items.length === 1 ? "" : "s"} deleted`);
  };

  const handleBulkMarkRead = async () => {
    const ids = notifications.filter((n) => selected.has(n.id) && !n.is_read).map((n) => n.id);
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, is_read: true } : n)));
    await supabase.from("notifications").update({ is_read: true }).in("id", ids);
  };

  // ---------- Selection ----------
  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  // ---------- Derived: filter, search, group ----------
  const filtered = useMemo(() => {
    let result = filter === "unread" ? notifications.filter((n) => !n.is_read) : notifications;
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((n) => n.message.toLowerCase().includes(q));
    return result;
  }, [notifications, filter, search]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((n) => {
      const bucket = bucketFor(n.created_at);
      if (!map.has(bucket)) map.set(bucket, []);
      map.get(bucket).push(n);
    });
    return BUCKET_ORDER.filter((b) => map.has(b)).map((b) => ({ bucket: b, items: map.get(b) }));
  }, [filtered]);

  const unreadCount = notifications.filter((n) => !n.is_read).length;
  const allVisibleSelected = filtered.length > 0 && filtered.every((n) => selected.has(n.id));

  const toggleSelectAllVisible = () => {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        filtered.forEach((n) => next.delete(n.id));
        return next;
      }
      const next = new Set(prev);
      filtered.forEach((n) => next.add(n.id));
      return next;
    });
  };

  return (
    <div className="notif-page">
      <div className="notif-bg-layer">
        <Prism
          animationType="rotate"
          timeScale={0.35}
          height={3.5}
          baseWidth={5.5}
          scale={3.6}
          hueShift={0.55}
          colorFrequency={1}
          noise={0}
          glow={1}
        />
      </div>

      <AppNav business={business} />

      <div className="notif-body">
        <div className="notif-header">
          <div>
            <p className="notif-eyebrow">Notifications</p>
            <h1 className="notif-heading">All notifications</h1>
          </div>
          <div className="notif-header-actions">
            {unreadCount > 0 && (
              <button className="notif-action-btn" onClick={handleMarkAllRead}>
                Mark all read
              </button>
            )}
            {notifications.length > 0 && (
              <button className="notif-action-btn notif-action-btn--danger" onClick={handleClearAll}>
                Clear all
              </button>
            )}
          </div>
        </div>

        <div className="notif-toolbar">
          <div className="notif-filters">
            <button
              className={`notif-filter-btn ${filter === "all" ? "notif-filter-btn--active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            <button
              className={`notif-filter-btn ${filter === "unread" ? "notif-filter-btn--active" : ""}`}
              onClick={() => setFilter("unread")}
            >
              Unread {unreadCount > 0 && `(${unreadCount})`}
            </button>
          </div>

          <div className="notif-search-wrap">
            <svg className="notif-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="notif-search-input"
              placeholder="Search notifications..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button className="notif-search-clear" onClick={() => setSearch("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
        </div>

        {filtered.length > 0 && (
          <div className="notif-select-bar">
            <label className="notif-checkbox-wrap">
              <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAllVisible} />
              <span className="notif-checkbox" />
              <span className="notif-select-label">
                {selected.size > 0 ? `${selected.size} selected` : "Select all"}
              </span>
            </label>

            {selected.size > 0 && (
              <div className="notif-select-actions">
                <button className="notif-action-btn" onClick={handleBulkMarkRead}>
                  Mark read
                </button>
                <button className="notif-action-btn notif-action-btn--danger" onClick={handleBulkDelete}>
                  Delete
                </button>
                <button className="notif-action-btn notif-action-btn--ghost" onClick={clearSelection}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="notif-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="notif-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="notif-empty">
            {search
              ? "No notifications match your search."
              : filter === "unread"
              ? "No unread notifications."
              : "No notifications yet."}
          </div>
        ) : (
          <div className="notif-groups">
            {grouped.map(({ bucket, items }) => (
              <div className="notif-group" key={bucket}>
                <p className="notif-group-label">{bucket}</p>
                <div className="notif-list">
                  {items.map((n, idx) => {
                    const type = typeFor(n.message);
                    const isSelected = selected.has(n.id);
                    return (
                      <div
                        className={`notif-item ${n.is_read ? "" : "notif-item--unread"} ${isSelected ? "notif-item--selected" : ""}`}
                        key={n.id}
                        style={{ animationDelay: `${Math.min(idx, 10) * 0.03}s` }}
                      >
                        <label className="notif-checkbox-wrap notif-item-checkbox">
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(n.id)} />
                          <span className="notif-checkbox" />
                        </label>

                        <div className={`notif-type-icon ${type.className}`} title={type.label}>
                          {TYPE_ICONS[type.key]}
                        </div>

                        <div className="notif-item-main">
                          <p className="notif-item-message">{n.message}</p>
                          <span className="notif-item-time" title={formatFullDateTime(n.created_at)}>
                            {formatTime(n.created_at)}
                          </span>
                        </div>

                        <div className="notif-item-actions">
                          {!n.is_read && (
                            <button className="notif-item-btn" onClick={() => handleMarkRead(n.id)}>
                              Mark read
                            </button>
                          )}
                          <button
                            className="notif-item-btn notif-item-btn--danger"
                            onClick={() => handleDelete(n)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="notif-toast">
          <span>{toast.message}</span>
          <button className="notif-toast-undo" onClick={toast.onUndo}>
            Undo
          </button>
          <button className="notif-toast-close" onClick={dismissToast} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
    </div>
  );
}

export default Notifications;