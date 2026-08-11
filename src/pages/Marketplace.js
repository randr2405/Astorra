import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import * as THREE from "three";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { MODULE_CATALOG, getModuleLimit, isAlwaysOnModule } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Marketplace.css";

const CATEGORIES = ["All", "Sales", "Finance", "Operations", "HR"];
const CONFETTI_COLORS = ["#7c3aed", "#3b82f6", "#14b8a6", "#f59e0b", "#fdfdfe"];
const MAX_COLORS = 8;

/* ------------------------------------------------------------------ */
/* ColorBends — inlined background shader (no external import)         */
/* ------------------------------------------------------------------ */

const colorBendsFrag = `
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  vec2 toward = (uPointer - rp);
  q += toward * uMouseInfluence * 0.2;

    for (int j = 0; j < 5; j++) {
      if (j >= uIterations - 1) break;
      vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
      q += (rr - q) * 0.15;
    }

    vec3 col = vec3(0.0);
    float a = 1.0;

    if (uColorCount > 0) {
      vec2 s = q;
      vec3 sumCol = vec3(0.0);
      float cover = 0.0;
      for (int i = 0; i < MAX_COLORS; ++i) {
            if (i >= uColorCount) break;
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3);
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
            float m = mix(m0, m1, kMix);
            float w = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
            sumCol += uColors[i] * w;
            cover = max(cover, w);
      }
      col = clamp(sumCol, 0.0, 1.0);
      a = uTransparent > 0 ? cover : 1.0;
    } else {
        vec2 s = q;
        for (int k = 0; k < 3; ++k) {
            s -= 0.01;
            vec2 r = sin(1.5 * (s.yx * uFrequency) + 2.0 * cos(s * uFrequency));
            float m0 = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float kBelow = clamp(uWarpStrength, 0.0, 1.0);
            float kMix = pow(kBelow, 0.3);
            float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
            vec2 disp = (r - s) * kBelow;
            vec2 warped = s + disp * gain;
            float m1 = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(k)) / 4.0);
            float m = mix(m0, m1, kMix);
            col[k] = 1.0 - exp(-uBandWidth / exp(uBandWidth * m));
        }
        a = uTransparent > 0 ? max(max(col.r, col.g), col.b) : 1.0;
    }

    col *= uIntensity;

    if (uNoise > 0.0001) {
      float n = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
      col += (n - 0.5) * uNoise;
      col = clamp(col, 0.0, 1.0);
    }

    vec3 rgb = (uTransparent > 0) ? col * a : col;
    gl_FragColor = vec4(rgb, a);
}
`;

const colorBendsVert = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 1.0);
}
`;

function ColorBends({
  className,
  style,
  rotation = 90,
  speed = 0.2,
  colors = [],
  transparent = true,
  autoRotate = 0,
  scale = 1,
  frequency = 1,
  warpStrength = 1,
  mouseInfluence = 1,
  parallax = 0.5,
  noise = 0.15,
  iterations = 1,
  intensity = 1.5,
  bandWidth = 6,
}) {
  const containerRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(null);
  const materialRef = useRef(null);
  const resizeObserverRef = useRef(null);
  const rotationRef = useRef(rotation);
  const autoRotateRef = useRef(autoRotate);
  const pointerTargetRef = useRef(new THREE.Vector2(0, 0));
  const pointerCurrentRef = useRef(new THREE.Vector2(0, 0));
  const pointerSmoothRef = useRef(8);

  useEffect(() => {
    const container = containerRef.current;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const geometry = new THREE.PlaneGeometry(2, 2);
    const uColorsArray = Array.from({ length: MAX_COLORS }, () => new THREE.Vector3(0, 0, 0));
    const material = new THREE.ShaderMaterial({
      vertexShader: colorBendsVert,
      fragmentShader: colorBendsFrag,
      uniforms: {
        uCanvas: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uSpeed: { value: speed },
        uRot: { value: new THREE.Vector2(1, 0) },
        uColorCount: { value: 0 },
        uColors: { value: uColorsArray },
        uTransparent: { value: transparent ? 1 : 0 },
        uScale: { value: scale },
        uFrequency: { value: frequency },
        uWarpStrength: { value: warpStrength },
        uPointer: { value: new THREE.Vector2(0, 0) },
        uMouseInfluence: { value: mouseInfluence },
        uParallax: { value: parallax },
        uNoise: { value: noise },
        uIterations: { value: iterations },
        uIntensity: { value: intensity },
        uBandWidth: { value: bandWidth },
      },
      premultipliedAlpha: true,
      transparent: true,
    });
    materialRef.current = material;

    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: "high-performance",
      alpha: true,
    });
    rendererRef.current = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, transparent ? 0 : 1);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const clock = new THREE.Clock();

    const handleResize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      material.uniforms.uCanvas.value.set(w, h);
    };

    handleResize();

    if ("ResizeObserver" in window) {
      const ro = new ResizeObserver(handleResize);
      ro.observe(container);
      resizeObserverRef.current = ro;
    } else {
      window.addEventListener("resize", handleResize);
    }

    const loop = () => {
      const dt = clock.getDelta();
      const elapsed = clock.elapsedTime;
      material.uniforms.uTime.value = elapsed;

      const deg = (rotationRef.current % 360) + autoRotateRef.current * elapsed;
      const rad = (deg * Math.PI) / 180;
      const c = Math.cos(rad);
      const s = Math.sin(rad);
      material.uniforms.uRot.value.set(c, s);

      const cur = pointerCurrentRef.current;
      const tgt = pointerTargetRef.current;
      const amt = Math.min(1, dt * pointerSmoothRef.current);
      cur.lerp(tgt, amt);
      material.uniforms.uPointer.value.copy(cur);
      renderer.render(scene, camera);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (resizeObserverRef.current) resizeObserverRef.current.disconnect();
      else window.removeEventListener("resize", handleResize);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement && renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bandWidth, frequency, intensity, iterations, mouseInfluence, noise, parallax, scale, speed, transparent, warpStrength]);

  useEffect(() => {
    const material = materialRef.current;
    const renderer = rendererRef.current;
    if (!material) return;

    rotationRef.current = rotation;
    autoRotateRef.current = autoRotate;
    material.uniforms.uSpeed.value = speed;
    material.uniforms.uScale.value = scale;
    material.uniforms.uFrequency.value = frequency;
    material.uniforms.uWarpStrength.value = warpStrength;
    material.uniforms.uMouseInfluence.value = mouseInfluence;
    material.uniforms.uParallax.value = parallax;
    material.uniforms.uNoise.value = noise;
    material.uniforms.uIterations.value = iterations;
    material.uniforms.uIntensity.value = intensity;
    material.uniforms.uBandWidth.value = bandWidth;

    const toVec3 = (hex) => {
      const h = hex.replace("#", "").trim();
      const v =
        h.length === 3
          ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
          : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
      return new THREE.Vector3(v[0] / 255, v[1] / 255, v[2] / 255);
    };

    const arr = (colors || []).filter(Boolean).slice(0, MAX_COLORS).map(toVec3);
    for (let i = 0; i < MAX_COLORS; i++) {
      const vec = material.uniforms.uColors.value[i];
      if (i < arr.length) vec.copy(arr[i]);
      else vec.set(0, 0, 0);
    }
    material.uniforms.uColorCount.value = arr.length;

    material.uniforms.uTransparent.value = transparent ? 1 : 0;
    if (renderer) renderer.setClearColor(0x000000, transparent ? 0 : 1);
  }, [
    rotation,
    autoRotate,
    speed,
    scale,
    frequency,
    warpStrength,
    mouseInfluence,
    parallax,
    noise,
    iterations,
    intensity,
    bandWidth,
    colors,
    transparent,
  ]);

  useEffect(() => {
    const material = materialRef.current;
    const container = containerRef.current;
    if (!material || !container) return;

    const handlePointerMove = (e) => {
      const rect = container.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
      const y = -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1);
      pointerTargetRef.current.set(x, y);
    };

    container.addEventListener("pointermove", handlePointerMove);
    return () => {
      container.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  return <div ref={containerRef} className={`mkt-colorbends-canvas ${className || ""}`} style={style} />;
}

/* ------------------------------------------------------------------ */
/* Confetti                                                            */
/* ------------------------------------------------------------------ */

function ConfettiBurst({ x, y, onDone }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => {
        const angle = ((360 / 18) * i + (Math.random() * 20 - 10)) * (Math.PI / 180);
        const distance = 60 + Math.random() * 50;
        return {
          id: i,
          dx: Math.cos(angle) * distance,
          dy: Math.sin(angle) * distance + 24,
          size: 5 + Math.random() * 4,
          color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          rotate: Math.random() * 360,
          delay: Math.random() * 60,
          shape: Math.random() > 0.5 ? "50%" : "2px",
        };
      }),
    []
  );

  useEffect(() => {
    const t = setTimeout(onDone, 750);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="mkt-confetti-root" style={{ left: x, top: y }}>
      {pieces.map((p) => (
        <span
          key={p.id}
          className="mkt-confetti-piece"
          style={{
            "--dx": `${p.dx}px`,
            "--dy": `${p.dy}px`,
            "--rotate": `${p.rotate}deg`,
            "--delay": `${p.delay}ms`,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: p.shape,
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Marketplace                                                         */
/* ------------------------------------------------------------------ */

function Marketplace({ business, appUser, onBusinessUpdate }) {
  const navigate = useNavigate();
  const [installed, setInstalled] = useState(business?.installed_modules || []);
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [busyKey, setBusyKey] = useState(null);
  const [pendingRemoveKey, setPendingRemoveKey] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [confetti, setConfetti] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const plan = business?.plan || "free";
  const limit = getModuleLimit(plan);
  const atCap = installed.length >= limit;
  const pctFilled = limit === Infinity ? 0 : Math.min(100, (installed.length / limit) * 100);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Keep local `installed` in sync if the business prop changes from
  // elsewhere (e.g. AI Builder installing modules, then navigating here).
  useEffect(() => {
    setInstalled(business?.installed_modules || []);
  }, [business?.installed_modules]);

  const handleInstall = async (mod, e) => {
    setError("");
    if (atCap) {
      setError(`Your ${plan} plan includes up to ${limit} modules. Upgrade to install more.`);
      return;
    }

    // Capture position BEFORE the await — the event object may not
    // survive the async gap depending on your React version.
    let burstPos = null;
    if (e) {
      const rect = e.currentTarget.getBoundingClientRect();
      burstPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    setBusyKey(mod.key);

    const { data, error: rpcError } = await supabase.rpc("install_module", {
      p_business_id: business.id,
      p_module_key: mod.key,
      p_limit: limit,
    });

    setBusyKey(null);

    if (rpcError) {
      if (rpcError.message.includes("MODULE_LIMIT_REACHED")) {
        setError(`Your ${plan} plan includes up to ${limit} modules. Upgrade to install more.`);
      } else {
        setError(rpcError.message);
      }
      return;
    }

    setInstalled(data.installed_modules);
    if (onBusinessUpdate) onBusinessUpdate(data);

    if (burstPos) {
      setConfetti({ key: Date.now(), ...burstPos });
    }
    setToast({ type: "success", text: `${mod.name} installed` });
    notify(business.id, appUser?.id, `"${mod.name}" module was installed.`);
  };

  const handleUninstall = async (mod) => {
    setPendingRemoveKey(null);
    setError("");
    setBusyKey(mod.key);

    const { data, error: rpcError } = await supabase.rpc("uninstall_module", {
      p_business_id: business.id,
      p_module_key: mod.key,
    });

    setBusyKey(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setInstalled(data.installed_modules);
    if (onBusinessUpdate) onBusinessUpdate(data);

    setToast({ type: "neutral", text: `${mod.name} removed` });
    notify(business.id, appUser?.id, `"${mod.name}" module was removed.`);
  };

  const filteredModules = useMemo(() => {
    let mods = category === "All" ? MODULE_CATALOG : MODULE_CATALOG.filter((m) => m.category === category);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      mods = mods.filter(
        (m) => m.name.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
    }
    return mods;
  }, [category, query]);

  return (
    <div className="mkt-page">
      {/* Animated background — kept within the existing purple/blue/teal palette */}
      <div className="mkt-bg-layer">
        <ColorBends
          colors={["#7c3aed", "#3b82f6", "#14b8a6"]}
          rotation={90}
          speed={0.2}
          scale={1}
          frequency={1}
          warpStrength={1}
          mouseInfluence={1}
          noise={0.15}
          parallax={0.5}
          iterations={1}
          intensity={1.5}
          bandWidth={6}
          transparent
          autoRotate={0}
        />
      </div>

      <AppNav business={business} />

      <div className="mkt-body">
        <div className={`mkt-header ${loaded ? "mkt-in" : ""}`}>
          <div>
            <p className="mkt-eyebrow">Marketplace</p>
            <h1 className="mkt-heading">Add what your business needs</h1>
            <p className="mkt-sub">
              {installed.length} of {limit === Infinity ? "unlimited" : limit} modules installed on
              your {plan.charAt(0).toUpperCase() + plan.slice(1)} plan.
            </p>
            {limit !== Infinity && (
              <div
                className="mkt-progress-track"
                role="progressbar"
                aria-valuenow={installed.length}
                aria-valuemin={0}
                aria-valuemax={limit}
              >
                <div
                  className={`mkt-progress-fill ${atCap ? "mkt-progress-fill--full" : ""}`}
                  style={{ width: `${pctFilled}%` }}
                />
              </div>
            )}
          </div>
          <button className="mkt-upgrade-btn" onClick={() => navigate("/dashboard/billing")}>
            Manage plan
          </button>
        </div>

        {atCap && limit !== Infinity && (
          <div className="mkt-cap-banner mkt-in">
            You've reached your plan's module limit.{" "}
            <button className="mkt-inline-link" onClick={() => navigate("/dashboard/billing")}>
              Upgrade your plan
            </button>{" "}
            to install more.
          </div>
        )}

        {error && <p className="mkt-error mkt-in">{error}</p>}

        <div className={`mkt-toolbar ${loaded ? "mkt-in" : ""}`}>
          <div className="mkt-filters">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                className={`mkt-filter-btn ${category === c ? "mkt-filter-btn--active" : ""}`}
                onClick={() => setCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>

          <div className="mkt-search">
            <svg className="mkt-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.3-4.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              placeholder="Search modules..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button className="mkt-search-clear" onClick={() => setQuery("")} aria-label="Clear search">
                ×
              </button>
            )}
          </div>
        </div>

        {filteredModules.length === 0 ? (
          <div className="mkt-empty mkt-in">
            <div className="mkt-empty-icon">?</div>
            <h3>No modules match that search</h3>
            <p>Try a different keyword or browse another category.</p>
            <button
              className="mkt-inline-link"
              onClick={() => {
                setQuery("");
                setCategory("All");
              }}
            >
              Clear filters
            </button>
          </div>
        ) : (
          <div className="mkt-grid">
            {filteredModules.map((mod, i) => {
              // alwaysOn modules (Reports, Documents) are installed on every
              // plan by default and never cost a module slot — treat them as
              // installed even if installed_modules doesn't literally contain
              // the key (e.g. a business created before an alwaysOn module
              // existed, or before its onboarding backfill ran).
              const alwaysOn = isAlwaysOnModule(mod.key);
              const isInstalled = installed.includes(mod.key) || alwaysOn;
              const isBusy = busyKey === mod.key;
              const confirmingRemove = pendingRemoveKey === mod.key;
              return (
                <div
                  className={`mkt-card ${isInstalled ? "mkt-card--installed" : ""} ${loaded ? "mkt-in" : ""}`}
                  key={mod.key}
                  style={{ transitionDelay: loaded ? `${Math.min(i, 9) * 40}ms` : "0ms" }}
                >
                  {isInstalled && (
                    <span className="mkt-installed-badge">
                      {alwaysOn ? "Included" : "Installed"}
                    </span>
                  )}
                  <div className="mkt-card-top">
                    <div className="mkt-icon">{mod.initial}</div>
                    <span className="mkt-category-tag">{mod.category}</span>
                  </div>
                  <h3>{mod.name}</h3>
                  <p>{mod.desc}</p>
                  <div className="mkt-card-actions">
                    {isInstalled ? (
                      alwaysOn ? (
                        // Always-on modules ship with every plan and can't be
                        // removed, so there's nothing to confirm — just let
                        // the business jump straight in.
                        <button
                          className="mkt-open-btn"
                          onClick={() => navigate(`/dashboard/${mod.route}`)}
                        >
                          Open
                        </button>
                      ) : confirmingRemove ? (
                        <div className="mkt-confirm-row">
                          <span>Remove module?</span>
                          <button
                            className="mkt-confirm-yes"
                            onClick={() => handleUninstall(mod)}
                            disabled={isBusy}
                          >
                            {isBusy ? "..." : "Yes"}
                          </button>
                          <button className="mkt-confirm-no" onClick={() => setPendingRemoveKey(null)}>
                            No
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="mkt-open-btn"
                            onClick={() => navigate(`/dashboard/${mod.route}`)}
                          >
                            Open
                          </button>
                          <button
                            className="mkt-uninstall-btn"
                            onClick={() => setPendingRemoveKey(mod.key)}
                            disabled={isBusy}
                          >
                            Remove
                          </button>
                        </>
                      )
                    ) : (
                      <button
                        className={`mkt-install-btn ${isBusy ? "mkt-install-btn--busy" : ""}`}
                        onClick={(e) => handleInstall(mod, e)}
                        disabled={isBusy || atCap}
                      >
                        {isBusy ? <span className="mkt-spinner" /> : "Install"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={`mkt-footnote ${loaded ? "mkt-in" : ""}`}>
          <strong>Need something custom?</strong> Describe what your business does and Astorra's
          AI Builder will recommend the right modules — coming soon. In the meantime,{" "}
          <a href="mailto:info@rragencies.co.za">get in touch</a> for a custom scope.
        </div>
      </div>

      {confetti && (
        <ConfettiBurst
          key={confetti.key}
          x={confetti.x}
          y={confetti.y}
          onDone={() => setConfetti(null)}
        />
      )}

      {toast && (
        <div className={`mkt-toast mkt-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "—"} {toast.text}
        </div>
      )}
    </div>
  );
}

export default Marketplace;