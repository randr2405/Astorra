import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Renderer, Program, Mesh, Triangle } from "ogl";
import astorraLogo from "../assets/astorra-logo.png";
import "./Landing.css";

/* ------------------------------------------------------------------ */
/* Topography background (inlined — no separate file/import needed)   */
/* ------------------------------------------------------------------ */

const hexToRgb = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [1, 1, 1];
  return [
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255,
  ];
};

const colorModeToFloat = (mode) => {
  if (mode === "uniform") return 1.0;
  if (mode === "alternating") return 2.0;
  return 0.0;
};

const topoVertex = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const topoFragment = `#version 300 es
precision highp float;
uniform vec2 iResolution;
uniform float iTime;
uniform float uMorphAmount;
uniform float uBands;
uniform float uThickness;
uniform float uScale;
uniform float uPixelSize;
uniform float uGlow;
uniform float uColorMode;
uniform float uContrast;
uniform float uBrightness;
uniform float uFillBands;
uniform float uOpacity;
uniform vec3 uLow;
uniform vec3 uMid;
uniform vec3 uHigh;
uniform vec2 uMouse;
uniform float uMouseEnabled;
uniform float uMouseRadius;
uniform float uMouseStrength;
uniform float uMouseActive;
uniform float uGrain;
uniform float uGrainIntensity;
uniform vec4 uCtrlA;
uniform vec4 uCtrlB;
uniform vec4 uCtrlC;
uniform vec4 uCtrlD;
out vec4 fragColor;

float bez(float t, vec4 c) {
  float w = 6.2831853 * t;
  return 0.5 * (c.x * sin(w) + c.y * cos(w) + c.z * sin(2.0 * w) + c.w * cos(2.0 * w));
}

float field(vec2 uv) {
  vec2 a = vec2(bez(uv.x, uCtrlA), bez(uv.x, uCtrlB));
  vec2 b = vec2(bez(uv.y, uCtrlC), bez(uv.y, uCtrlD));
  return distance(a, b);
}

vec3 elevationColor(float e) {
  vec3 c = mix(uLow, uMid, smoothstep(0.0, 0.5, e));
  c = mix(c, uHigh, smoothstep(0.5, 1.0, e));
  return c;
}

void main() {
  vec2 res = iResolution.xy;
  vec2 uv = gl_FragCoord.xy / res;

  vec2 suv = (uv - 0.5) / max(uScale, 0.001) + 0.5;

  vec2 sampleUv = suv;
  if (uPixelSize > 1.0) {
    vec2 px = res / uPixelSize;
    sampleUv = (floor(suv * px) + 0.5) / px;
  }

  float fv = field(sampleUv);

  if (uMouseEnabled > 0.5) {
    vec2 d = uv - uMouse;
    d.x *= res.x / max(res.y, 1.0);
    float r = max(uMouseRadius, 0.001);
    float bump = exp(-dot(d, d) / (r * r)) * uMouseStrength * uMouseActive;
    fv += bump;
  }

  float f = fv * uBands;
  float frac = fract(f);
  float lineDist = min(frac, 1.0 - frac);

  float aa = fwidth(f) + 0.0001;
  float mask = 1.0 - smoothstep(uThickness - aa, uThickness + aa, lineDist);

  float glowR = uThickness + uGlow * 0.5 + aa;
  float glow = (1.0 - smoothstep(uThickness, glowR, lineDist)) * step(0.0001, uGlow);

  float elev = clamp(fv / (uMorphAmount * 2.5 + 0.001), 0.0, 1.0);

  vec3 lineCol;
  if (uColorMode < 0.5) {
    lineCol = elevationColor(elev);
  } else if (uColorMode < 1.5) {
    lineCol = uMid;
  } else {
    float parity = mod(floor(f), 2.0);
    lineCol = mix(uMid, uHigh, parity);
  }

  float coverage = clamp(mask + glow * 0.55, 0.0, 1.0);
  coverage = pow(coverage, max(uContrast, 0.001));

  vec3 outColor = lineCol;
  float outAlpha = coverage;

  if (uFillBands > 0.5) {
    vec3 fillCol = elevationColor(elev);
    float fillA = 0.1 * elev;
    outColor = mix(fillCol, lineCol, coverage);
    outAlpha = clamp(coverage + fillA, 0.0, 1.0);
  }

  if (uGrain > 0.5) {
    float g = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + iTime) * 43758.5453);
    outAlpha += (g - 0.5) * uGrainIntensity;
  }

  outColor *= uBrightness;
  outColor = clamp(outColor, 0.0, 1.0);

  float a = clamp(outAlpha, 0.0, 1.0) * uOpacity;
  fragColor = vec4(outColor * a, a);
}
`;

const topoCtxMap = new WeakMap();

const TOPO_CTRL_INDICES = [
  [1, -2, 3, -4],
  [9, -8, 7, -6],
  [5, 2, 5, -5],
  [-1, -3, 8, 9],
];

function Topography({
  lowColor = "#5227FF",
  midColor = "#FF9FFC",
  highColor = "#FFFFFF",
  speed = 0.35,
  morphAmount = 3.0,
  morphSpeed = 0.05,
  bands = 2.0,
  thickness = 0.01,
  scale = 1.0,
  pixelSize = 1.0,
  glow = 0.5,
  colorMode = "elevation",
  contrast = 3.0,
  brightness = 1.0,
  fillBands = false,
  opacity = 1.0,
  grain = true,
  grainIntensity = 0.05,
  mouseInteraction = true,
  mouseRadius = 0.3,
  mouseStrength = 0.4,
  className = "",
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new Renderer({
      webgl: 2,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      dpr: Math.min(window.devicePixelRatio || 1, 2),
    });

    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    const canvas = gl.canvas;
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    container.appendChild(canvas);

    const geometry = new Triangle(gl);
    const program = new Program(gl, {
      vertex: topoVertex,
      fragment: topoFragment,
      uniforms: {
        iTime: { value: 0 },
        iResolution: { value: new Float32Array([1, 1]) },
        uSpeed: { value: 0.35 },
        uMorphAmount: { value: 3.0 },
        uMorphSpeed: { value: 0.05 },
        uBands: { value: 2.0 },
        uThickness: { value: 0.01 },
        uScale: { value: 1.0 },
        uPixelSize: { value: 1.0 },
        uGlow: { value: 0.5 },
        uColorMode: { value: 0.0 },
        uContrast: { value: 3.0 },
        uBrightness: { value: 1.0 },
        uFillBands: { value: 0.0 },
        uOpacity: { value: 1.0 },
        uGrain: { value: 1.0 },
        uGrainIntensity: { value: 0.05 },
        uLow: { value: new Float32Array([1, 1, 1]) },
        uMid: { value: new Float32Array([1, 1, 1]) },
        uHigh: { value: new Float32Array([1, 1, 1]) },
        uMouse: { value: new Float32Array([0.5, 0.5]) },
        uMouseEnabled: { value: 1.0 },
        uMouseRadius: { value: 0.3 },
        uMouseStrength: { value: 0.4 },
        uMouseActive: { value: 0.0 },
        uCtrlA: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlB: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlC: { value: new Float32Array([0, 0, 0, 0]) },
        uCtrlD: { value: new Float32Array([0, 0, 0, 0]) },
      },
    });

    const mesh = new Mesh(gl, { geometry, program });
    topoCtxMap.set(container, { renderer, program, mesh });

    const setSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      renderer.setSize(w, h);
      const res = program.uniforms.iResolution.value;
      res[0] = gl.drawingBufferWidth;
      res[1] = gl.drawingBufferHeight;
      renderer.render({ scene: mesh });
    };

    const ro = new ResizeObserver(setSize);
    ro.observe(container);
    setSize();

    const currentMouse = [0.5, 0.5];
    const targetMouse = [0.5, 0.5];
    let mouseActive = 0;
    let mouseActiveTarget = 0;

    const onMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      targetMouse[0] = (e.clientX - rect.left) / rect.width;
      targetMouse[1] = 1.0 - (e.clientY - rect.top) / rect.height;
      mouseActiveTarget = 1;
    };
    const onMouseLeave = () => {
      mouseActiveTarget = 0;
    };
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseleave", onMouseLeave);

    const ctrlArrays = [
      program.uniforms.uCtrlA.value,
      program.uniforms.uCtrlB.value,
      program.uniforms.uCtrlC.value,
      program.uniforms.uCtrlD.value,
    ];

    let raf = 0;
    let isVisible = true;
    let isPageVisible = !document.hidden;
    const t0 = performance.now();

    const loop = (t) => {
      const time = (t - t0) * 0.001;
      const u = program.uniforms;
      u.iTime.value = time;

      const ma = u.uMorphAmount.value;
      const sp = u.uSpeed.value;
      const msp = u.uMorphSpeed.value;
      for (let g = 0; g < 4; g++) {
        const arr = ctrlArrays[g];
        const idx = TOPO_CTRL_INDICES[g];
        for (let j = 0; j < 4; j++) {
          const i = idx[j];
          arr[j] = ma * Math.sin(time * sp * Math.sin(i * msp) + i);
        }
      }

      currentMouse[0] += 0.05 * (targetMouse[0] - currentMouse[0]);
      currentMouse[1] += 0.05 * (targetMouse[1] - currentMouse[1]);
      u.uMouse.value[0] = currentMouse[0];
      u.uMouse.value[1] = currentMouse[1];

      mouseActive += 0.05 * (mouseActiveTarget - mouseActive);
      u.uMouseActive.value = mouseActive;

      renderer.render({ scene: mesh });
      raf = requestAnimationFrame(loop);
    };

    const tryStart = () => {
      if (isVisible && isPageVisible && raf === 0) raf = requestAnimationFrame(loop);
    };
    const tryStop = () => {
      if (raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        isVisible ? tryStart() : tryStop();
      },
      { threshold: 0 }
    );
    io.observe(container);

    const onVisibility = () => {
      isPageVisible = !document.hidden;
      isPageVisible ? tryStart() : tryStop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryStart();

    return () => {
      tryStop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mouseleave", onMouseLeave);
      topoCtxMap.delete(container);
      try {
        container.removeChild(canvas);
      } catch {}
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ctx = topoCtxMap.get(container);
    if (!ctx) return;
    const { program } = ctx;
    const u = program.uniforms;

    u.uSpeed.value = speed;
    u.uMorphAmount.value = morphAmount;
    u.uMorphSpeed.value = morphSpeed;
    u.uBands.value = bands;
    u.uThickness.value = thickness;
    u.uScale.value = scale;
    u.uPixelSize.value = pixelSize;
    u.uGlow.value = glow;
    u.uColorMode.value = colorModeToFloat(colorMode);
    u.uContrast.value = contrast;
    u.uBrightness.value = brightness;
    u.uFillBands.value = fillBands ? 1.0 : 0.0;
    u.uOpacity.value = opacity;
    u.uGrain.value = grain ? 1.0 : 0.0;
    u.uGrainIntensity.value = grainIntensity;
    u.uLow.value = new Float32Array(hexToRgb(lowColor));
    u.uMid.value = new Float32Array(hexToRgb(midColor));
    u.uHigh.value = new Float32Array(hexToRgb(highColor));
    u.uMouseEnabled.value = mouseInteraction ? 1.0 : 0.0;
    u.uMouseRadius.value = mouseRadius;
    u.uMouseStrength.value = mouseStrength;
  }, [
    lowColor,
    midColor,
    highColor,
    speed,
    morphAmount,
    morphSpeed,
    bands,
    thickness,
    scale,
    pixelSize,
    glow,
    colorMode,
    contrast,
    brightness,
    fillBands,
    opacity,
    grain,
    grainIntensity,
    mouseInteraction,
    mouseRadius,
    mouseStrength,
  ]);

  return (
    <div
      ref={containerRef}
      className={`topography-container ${className}`.trim()}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

function useScrollReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useHeroParallax() {
  const heroRef = useRef(null);

  useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;

    const handleMove = (e) => {
      const rect = hero.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      hero.style.setProperty("--mx", x.toFixed(3));
      hero.style.setProperty("--my", y.toFixed(3));
    };

    hero.addEventListener("mousemove", handleMove);
    return () => hero.removeEventListener("mousemove", handleMove);
  }, []);

  return heroRef;
}

function useTilt() {
  const handleMove = (e) => {
    const card = e.currentTarget;
    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--rx", (-y * 8).toFixed(2));
    card.style.setProperty("--ry", (x * 8).toFixed(2));
    card.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
    card.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
  };

  const handleLeave = (e) => {
    const card = e.currentTarget;
    card.style.setProperty("--rx", 0);
    card.style.setProperty("--ry", 0);
  };

  return { onMouseMove: handleMove, onMouseLeave: handleLeave };
}

function Counter({ value, label }) {
  const ref = useRef(null);
  const [display, setDisplay] = useState(value.startsWith("<") || isNaN(parseInt(value)) ? value : "0");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const numeric = parseInt(value.replace(/[^0-9]/g, ""), 10);
    const prefix = value.match(/^[^0-9]*/)[0];
    const suffix = value.match(/[^0-9]*$/)[0];

    if (isNaN(numeric)) {
      setDisplay(value);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            let start = 0;
            const duration = 1200;
            const startTime = performance.now();

            const tick = (now) => {
              const progress = Math.min((now - startTime) / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              start = Math.round(eased * numeric);
              setDisplay(`${prefix}${start}${suffix}`);
              if (progress < 1) requestAnimationFrame(tick);
            };

            requestAnimationFrame(tick);
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.4 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <div className="stat reveal" ref={ref}>
      <span className="stat-value">{display}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

const modules = [
  { name: "Customers", desc: "One record per customer, feeding everything else" },
  { name: "Quotes", desc: "Create and send quotes to customers, ready to convert" },
  { name: "Invoices", desc: "Convert quotes to invoices, track what's paid" },
  { name: "Inventory", desc: "Stock levels that stay accurate on their own" },
  { name: "Staff / HR", desc: "Records and basics, without a separate system" },
  { name: "Bookings", desc: "Scheduling that updates the whole business" },
];

const steps = [
  {
    n: "01",
    title: "Tell us about your business",
    body: "A few guided questions — team size, and what you do day to day. No form with forty fields.",
  },
  {
    n: "02",
    title: "Astorra builds your workspace",
    body: "Your answers install exactly the modules you need. Nothing you'll never open.",
  },
  {
    n: "03",
    title: "One dashboard, everything in view",
    body: "Customers, quotes, invoices, bookings — in one place, not five different logins.",
  },
  {
    n: "04",
    title: "It grows as you describe it",
    body: "Need something new? Describe the problem in plain language and the right modules get installed.",
  },
];

const tiers = [
  { name: "Free", price: "R0", cadence: "/pm", modules: "Up to 2 modules", ai: "Not included", highlight: false },
  { name: "Starter", price: "R249", cadence: "/pm", modules: "Up to 5 modules", ai: "Basic AI included", highlight: false },
  { name: "Professional", price: "R799", cadence: "/pm", modules: "Up to 10 modules", ai: "Full AI included", highlight: true },
  { name: "Enterprise", price: "R1,499", cadence: "/pm", modules: "Unlimited modules", ai: "Full AI included", highlight: false },
];

const stats = [
  { value: "5", label: "core modules ready on day one" },
  { value: "<10", label: "minutes from sign-up to working workspace" },
  { value: "1", label: "dashboard instead of five logins" },
  { value: "24/7", label: "your business, always in view" },
];

function Landing() {
  const navigate = useNavigate();
  useScrollReveal();
  const heroRef = useHeroParallax();
  const tilt = useTilt();

  return (
    <div className="landing">
      <Helmet>
        <title>Astorra | Business Management Software for South African SMEs</title>
        <meta
          name="description"
          content="Astorra brings customers, quotes, invoices, inventory, staff and bookings into one connected workspace built for South African small businesses. Free tier available."
        />
        <link rel="canonical" href="https://www.astorra.co.za/" />
      </Helmet>
      <nav className="nav">
        <div className="nav-inner">
          <img src={astorraLogo} alt="Astorra" className="nav-logo" />
          <div className="nav-actions">
            <button className="link-btn" onClick={() => navigate("/feedback")}>
              Feedback
            </button>
            <button className="link-btn" onClick={() => navigate("/auth")}>
              Log in
            </button>
            <button className="cta-btn cta-btn--small" onClick={() => navigate("/auth")}>
              Get started
            </button>
          </div>
        </div>
      </nav>

      <header className="hero" ref={heroRef}>
        <div className="hero-topography" aria-hidden="true">
          <Topography
            lowColor="#5227FF"
            midColor="#FF9FFC"
            highColor="#FFFFFF"
            speed={0.35}
            morphAmount={3}
            morphSpeed={0.05}
            bands={2}
            thickness={0.01}
            scale={2}
            pixelSize={1}
            glow={0.5}
            colorMode="elevation"
            contrast={3}
            brightness={1}
            fillBands={false}
            opacity={1}
            grain
            grainIntensity={0.05}
            mouseInteraction
            mouseRadius={0.3}
            mouseStrength={0.4}
          />
        </div>
        <div className="hero-spotlight" aria-hidden="true"></div>
        <div className="hero-content">
          <p className="slogan slogan-reveal">One platform. Your way.</p>
          <p className="eyebrow eyebrow-reveal">For businesses running on spreadsheets and WhatsApp</p>
          <h1 className="headline-reveal">
            Your business, running
            <br />
            as one connected system.
          </h1>
          <p className="hero-sub sub-reveal">
            Astorra brings customers, quotes, invoices, stock, staff and bookings
            into a single workspace that adapts to how you already operate.
          </p>
          <div className="hero-actions actions-reveal">
            <button className="cta-btn cta-btn--large cta-magnetic" onClick={() => navigate("/auth")}>
              Get started free
            </button>
            <span className="hero-note">Free tier available. No card required. Live in under 10 minutes.</span>
          </div>
        </div>
      </header>

      <section className="stats-strip">
        <div className="section-inner stats-inner">
          {stats.map((s) => (
            <Counter key={s.label} value={s.value} label={s.label} />
          ))}
        </div>
      </section>

      <section className="section problem">
        <div className="section-inner problem-grid reveal">
          <div>
            <h2>You didn't start a business to manage five apps.</h2>
            <p className="body-text">
              A quote lives in one place. The invoice lives in another. Stock is
              on a spreadsheet, staff details in a folder, and half of it is
              still tracked over WhatsApp. None of it talks to each other, so
              you're the one carrying it all in your head.
            </p>
          </div>
          <div className="problem-list">
            <div className="problem-item">
              <span className="dot dot-purple" />
              Disconnected tools that don't share data
            </div>
            <div className="problem-item">
              <span className="dot dot-blue" />
              Manual work that should update itself
            </div>
            <div className="problem-item">
              <span className="dot dot-teal" />
              No single view of how the business is actually doing
            </div>
          </div>
        </div>
      </section>

      <section className="section how">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">How it works</p>
          <h2 className="center reveal">From sign-up to a working business, in minutes.</h2>
          <div className="steps">
            {steps.map((s, i) => (
              <div className="step reveal" style={{ transitionDelay: `${i * 90}ms` }} key={s.n}>
                <span className="step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section modules">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">Core modules</p>
          <h2 className="center reveal">Install what you need. Skip what you don't.</h2>
          <div className="module-grid">
            {modules.map((m, i) => (
              <div
                className="module-card reveal tilt-card"
                style={{ transitionDelay: `${i * 70}ms` }}
                key={m.name}
                {...tilt}
              >
                <div className="tilt-glow"></div>
                <h3>{m.name}</h3>
                <p>{m.desc}</p>
              </div>
            ))}
          </div>
          <p className="modules-footnote">
            Plus a marketplace of more, and an AI Builder that installs the right
            ones just by describing your problem in plain language.
          </p>
        </div>
      </section>

      <section className="section pricing">
        <div className="section-inner">
          <p className="eyebrow eyebrow-center reveal">Pricing</p>
          <h2 className="center reveal">Pay for what you use. Grow when you're ready.</h2>
          <div className="pricing-grid">
            {tiers.map((t, i) => (
              <div
                className={`pricing-card reveal tilt-card ${t.highlight ? "pricing-card--highlight" : ""}`}
                style={{ transitionDelay: `${i * 70}ms` }}
                key={t.name}
                {...tilt}
              >
                <div className="tilt-glow"></div>
                {t.highlight && <span className="pricing-badge">Most popular</span>}
                <h3>{t.name}</h3>
                <div className="pricing-amount">
                  <span className="pricing-price">{t.price}</span>
                  <span className="pricing-cadence">{t.cadence}</span>
                </div>
                <p className="pricing-modules">{t.modules}</p>
                <p className="pricing-ai">{t.ai}</p>
                <button
                  className={t.highlight ? "cta-btn cta-btn--small" : "cta-btn cta-btn--ghost"}
                  onClick={() => navigate("/auth")}
                >
                  Get started
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section closing">
        <div className="closing-glow" aria-hidden="true"></div>
        <div className="section-inner closing-inner reveal">
          <p className="eyebrow eyebrow-center">Ready when you are</p>
          <h2>One platform. Your way.</h2>
          <p className="hero-sub">
            Answer a few questions and see the workspace Astorra builds for
            your business — free, and ready before your coffee's cold.
          </p>
          <button className="cta-btn cta-btn--large cta-magnetic" onClick={() => navigate("/auth")}>
            Get started free
          </button>
          <span className="hero-note">No card required. Cancel anytime.</span>
        </div>
      </section>

      <footer className="footer">
        <div className="section-inner footer-inner">
          <img src={astorraLogo} alt="Astorra" className="nav-logo nav-logo--footer" />
          <div className="footer-meta">
            <span>Owned and operated by R&amp;R Agencies</span>
            <span>info@rragencies.co.za · 081 336 5266</span>
          </div>
          <div className="footer-links">
            <button className="footer-link-btn" onClick={() => navigate("/feedback")}>
              Feedback
            </button>
            <span className="footer-link-sep">·</span>
            <button className="footer-link-btn" onClick={() => navigate("/privacy")}>
              Privacy Policy
            </button>
            <span className="footer-link-sep">·</span>
            <button className="footer-link-btn" onClick={() => navigate("/terms")}>
              Terms of Service
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default Landing;