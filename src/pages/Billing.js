import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Effect, EffectComposer, EffectPass, RenderPass } from "postprocessing";
import * as THREE from "three";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import { PLANS, PLAN_DETAILS, getModuleLimit, capModulesToPlan, getAiAccess } from "../lib/plans";
import AppNav from "../components/AppNav";
import "./Billing.css";

// Must match REACT_APP_SUPABASE_URL's project ref — Edge Functions live at
// <SUPABASE_URL>/functions/v1/<function-name>.
const FUNCTIONS_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

// After a PayFast redirect back to this page, the browser round-trip and
// PayFast's separate, asynchronous ITN webhook race each other — the
// redirect often lands here before payfast-notify has actually processed
// the payment and updated the business's plan. So on `?payment=success`
// we poll for a short window until the plan changes, rather than trusting
// whatever `business` prop we were mounted with.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90 seconds total — PayFast sandbox ITN delivery can be slow

/* ------------------------------------------------------------------ */
/* PixelBlast — inlined background shader (no external import)         */
/* ------------------------------------------------------------------ */

const createTouchTexture = () => {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D context not available");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.Texture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const trail = [];
  let last = null;
  const maxAge = 64;
  let radius = 0.1 * size;
  const speed = 1 / maxAge;
  const clear = () => {
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  const drawPoint = (p) => {
    const pos = { x: p.x * size, y: (1 - p.y) * size };
    let intensity = 1;
    const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);
    const easeOutQuad = (t) => -t * (t - 2);
    if (p.age < maxAge * 0.3) intensity = easeOutSine(p.age / (maxAge * 0.3));
    else intensity = easeOutQuad(1 - (p.age - maxAge * 0.3) / (maxAge * 0.7)) || 0;
    intensity *= p.force;
    const color = `${((p.vx + 1) / 2) * 255}, ${((p.vy + 1) / 2) * 255}, ${intensity * 255}`;
    const offset = size * 5;
    ctx.shadowOffsetX = offset;
    ctx.shadowOffsetY = offset;
    ctx.shadowBlur = radius;
    ctx.shadowColor = `rgba(${color},${0.22 * intensity})`;
    ctx.beginPath();
    ctx.fillStyle = "rgba(255,0,0,1)";
    ctx.arc(pos.x - offset, pos.y - offset, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  const addTouch = (norm) => {
    let force = 0;
    let vx = 0;
    let vy = 0;
    if (last) {
      const dx = norm.x - last.x;
      const dy = norm.y - last.y;
      if (dx === 0 && dy === 0) return;
      const dd = dx * dx + dy * dy;
      const d = Math.sqrt(dd);
      vx = dx / (d || 1);
      vy = dy / (d || 1);
      force = Math.min(dd * 10000, 1);
    }
    last = { x: norm.x, y: norm.y };
    trail.push({ x: norm.x, y: norm.y, age: 0, force, vx, vy });
  };
  const update = () => {
    clear();
    for (let i = trail.length - 1; i >= 0; i--) {
      const point = trail[i];
      const f = point.force * speed * (1 - point.age / maxAge);
      point.x += point.vx * f;
      point.y += point.vy * f;
      point.age++;
      if (point.age > maxAge) trail.splice(i, 1);
    }
    for (let i = 0; i < trail.length; i++) drawPoint(trail[i]);
    texture.needsUpdate = true;
  };
  return {
    canvas,
    texture,
    addTouch,
    update,
    set radiusScale(v) {
      radius = 0.1 * size * v;
    },
    get radiusScale() {
      return radius / (0.1 * size);
    },
    size,
  };
};

const createLiquidEffect = (texture, opts) => {
  const fragment = `
    uniform sampler2D uTexture;
    uniform float uStrength;
    uniform float uTime;
    uniform float uFreq;

    void mainUv(inout vec2 uv) {
      vec4 tex = texture2D(uTexture, uv);
      float vx = tex.r * 2.0 - 1.0;
      float vy = tex.g * 2.0 - 1.0;
      float intensity = tex.b;

      float wave = 0.5 + 0.5 * sin(uTime * uFreq + intensity * 6.2831853);

      float amt = uStrength * intensity * wave;

      uv += vec2(vx, vy) * amt;
    }
    `;
  return new Effect("LiquidEffect", fragment, {
    uniforms: new Map([
      ["uTexture", new THREE.Uniform(texture)],
      ["uStrength", new THREE.Uniform(opts?.strength ?? 0.025)],
      ["uTime", new THREE.Uniform(0)],
      ["uFreq", new THREE.Uniform(opts?.freq ?? 4.5)],
    ]),
  });
};

const SHAPE_MAP = {
  square: 0,
  circle: 1,
  triangle: 2,
  diamond: 3,
};

const PB_VERTEX_SRC = `
void main() {
  gl_Position = vec4(position, 1.0);
}
`;

const PB_FRAGMENT_SRC = `
precision highp float;

uniform vec3  uColor;
uniform vec2  uResolution;
uniform float uTime;
uniform float uPixelSize;
uniform float uScale;
uniform float uDensity;
uniform float uPixelJitter;
uniform int   uEnableRipples;
uniform float uRippleSpeed;
uniform float uRippleThickness;
uniform float uRippleIntensity;
uniform float uEdgeFade;

uniform int   uShapeType;
const int SHAPE_SQUARE   = 0;
const int SHAPE_CIRCLE   = 1;
const int SHAPE_TRIANGLE = 2;
const int SHAPE_DIAMOND  = 3;

const int   MAX_CLICKS = 10;

uniform vec2  uClickPos  [MAX_CLICKS];
uniform float uClickTimes[MAX_CLICKS];

out vec4 fragColor;

float Bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x / 2. + a.y * a.y * .75);
}
#define Bayer4(a) (Bayer2(.5*(a))*0.25 + Bayer2(a))
#define Bayer8(a) (Bayer4(.5*(a))*0.25 + Bayer2(a))

#define FBM_OCTAVES     5
#define FBM_LACUNARITY  1.25
#define FBM_GAIN        1.0

float hash11(float n){ return fract(sin(n)*43758.5453); }

float vnoise(vec3 p){
  vec3 ip = floor(p);
  vec3 fp = fract(p);
  float n000 = hash11(dot(ip + vec3(0.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n100 = hash11(dot(ip + vec3(1.0,0.0,0.0), vec3(1.0,57.0,113.0)));
  float n010 = hash11(dot(ip + vec3(0.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n110 = hash11(dot(ip + vec3(1.0,1.0,0.0), vec3(1.0,57.0,113.0)));
  float n001 = hash11(dot(ip + vec3(0.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n101 = hash11(dot(ip + vec3(1.0,0.0,1.0), vec3(1.0,57.0,113.0)));
  float n011 = hash11(dot(ip + vec3(0.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  float n111 = hash11(dot(ip + vec3(1.0,1.0,1.0), vec3(1.0,57.0,113.0)));
  vec3 w = fp*fp*fp*(fp*(fp*6.0-15.0)+10.0);
  float x00 = mix(n000, n100, w.x);
  float x10 = mix(n010, n110, w.x);
  float x01 = mix(n001, n101, w.x);
  float x11 = mix(n011, n111, w.x);
  float y0  = mix(x00, x10, w.y);
  float y1  = mix(x01, x11, w.y);
  return mix(y0, y1, w.z) * 2.0 - 1.0;
}

float fbm2(vec2 uv, float t){
  vec3 p = vec3(uv * uScale, t);
  float amp = 1.0;
  float freq = 1.0;
  float sum = 1.0;
  for (int i = 0; i < FBM_OCTAVES; ++i){
    sum  += amp * vnoise(p * freq);
    freq *= FBM_LACUNARITY;
    amp  *= FBM_GAIN;
  }
  return sum * 0.5 + 0.5;
}

float maskCircle(vec2 p, float cov){
  float r = sqrt(cov) * .25;
  float d = length(p - 0.5) - r;
  float aa = 0.5 * fwidth(d);
  return cov * (1.0 - smoothstep(-aa, aa, d * 2.0));
}

float maskTriangle(vec2 p, vec2 id, float cov){
  bool flip = mod(id.x + id.y, 2.0) > 0.5;
  if (flip) p.x = 1.0 - p.x;
  float r = sqrt(cov);
  float d  = p.y - r*(1.0 - p.x);
  float aa = fwidth(d);
  return cov * clamp(0.5 - d/aa, 0.0, 1.0);
}

float maskDiamond(vec2 p, float cov){
  float r = sqrt(cov) * 0.564;
  return step(abs(p.x - 0.49) + abs(p.y - 0.49), r);
}

void main(){
  float pixelSize = uPixelSize;
  vec2 fragCoord = gl_FragCoord.xy - uResolution * .5;
  float aspectRatio = uResolution.x / uResolution.y;

  vec2 pixelId = floor(fragCoord / pixelSize);
  vec2 pixelUV = fract(fragCoord / pixelSize);

  float cellPixelSize = 8.0 * pixelSize;
  vec2 cellId = floor(fragCoord / cellPixelSize);
  vec2 cellCoord = cellId * cellPixelSize;
  vec2 uv = cellCoord / uResolution * vec2(aspectRatio, 1.0);

  float base = fbm2(uv, uTime * 0.05);
  base = base * 0.5 - 0.65;

  float feed = base + (uDensity - 0.5) * 0.3;

  float speed     = uRippleSpeed;
  float thickness = uRippleThickness;
  const float dampT     = 1.0;
  const float dampR     = 10.0;

  if (uEnableRipples == 1) {
    for (int i = 0; i < MAX_CLICKS; ++i){
      vec2 pos = uClickPos[i];
      if (pos.x < 0.0) continue;
      float cellPixelSize = 8.0 * pixelSize;
      vec2 cuv = (((pos - uResolution * .5 - cellPixelSize * .5) / (uResolution))) * vec2(aspectRatio, 1.0);
      float t = max(uTime - uClickTimes[i], 0.0);
      float r = distance(uv, cuv);
      float waveR = speed * t;
      float ring  = exp(-pow((r - waveR) / thickness, 2.0));
      float atten = exp(-dampT * t) * exp(-dampR * r);
      feed = max(feed, ring * atten * uRippleIntensity);
    }
  }

  float bayer = Bayer8(fragCoord / uPixelSize) - 0.5;
  float bw = step(0.5, feed + bayer);

  float h = fract(sin(dot(floor(fragCoord / uPixelSize), vec2(127.1, 311.7))) * 43758.5453);
  float jitterScale = 1.0 + (h - 0.5) * uPixelJitter;
  float coverage = bw * jitterScale;
  float M;
  if      (uShapeType == SHAPE_CIRCLE)   M = maskCircle (pixelUV, coverage);
  else if (uShapeType == SHAPE_TRIANGLE) M = maskTriangle(pixelUV, pixelId, coverage);
  else if (uShapeType == SHAPE_DIAMOND)  M = maskDiamond(pixelUV, coverage);
  else                                   M = coverage;

  if (uEdgeFade > 0.0) {
    vec2 norm = gl_FragCoord.xy / uResolution;
    float edge = min(min(norm.x, norm.y), min(1.0 - norm.x, 1.0 - norm.y));
    float fade = smoothstep(0.0, uEdgeFade, edge);
    M *= fade;
  }

  vec3 color = uColor;

  // sRGB gamma correction - convert linear to sRGB for accurate color output
  vec3 srgbColor = mix(
    color * 12.92,
    1.055 * pow(color, vec3(1.0 / 2.4)) - 0.055,
    step(0.0031308, color)
  );

  fragColor = vec4(srgbColor, M);
}
`;

const PB_MAX_CLICKS = 10;

const PixelBlast = ({
  variant = "square",
  pixelSize = 3,
  color = "#7c3aed",
  className,
  style,
  antialias = true,
  patternScale = 2,
  patternDensity = 1,
  liquid = false,
  liquidStrength = 0.1,
  liquidRadius = 1,
  pixelSizeJitter = 0,
  enableRipples = true,
  rippleIntensityScale = 1,
  rippleThickness = 0.1,
  rippleSpeed = 0.3,
  liquidWobbleSpeed = 4.5,
  autoPauseOffscreen = true,
  speed = 0.5,
  transparent = true,
  edgeFade = 0.5,
  noiseAmount = 0,
}) => {
  const containerRef = useRef(null);
  const visibilityRef = useRef({ visible: true });
  const speedRef = useRef(speed);

  const threeRef = useRef(null);
  const prevConfigRef = useRef(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    speedRef.current = speed;
    const needsReinitKeys = ["antialias", "liquid", "noiseAmount"];
    const cfg = { antialias, liquid, noiseAmount };
    let mustReinit = false;
    if (!threeRef.current) mustReinit = true;
    else if (prevConfigRef.current) {
      for (const k of needsReinitKeys)
        if (prevConfigRef.current[k] !== cfg[k]) {
          mustReinit = true;
          break;
        }
    }
    if (mustReinit) {
      if (threeRef.current) {
        const t = threeRef.current;
        t.resizeObserver?.disconnect();
        cancelAnimationFrame(t.raf);
        t.quad?.geometry.dispose();
        t.material.dispose();
        t.composer?.dispose();
        t.renderer.dispose();
        t.renderer.forceContextLoss();
        if (t.renderer.domElement.parentElement === container) container.removeChild(t.renderer.domElement);
        threeRef.current = null;
      }
      const canvas = document.createElement("canvas");
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      container.appendChild(renderer.domElement);
      if (transparent) renderer.setClearAlpha(0);
      else renderer.setClearColor(0x000000, 1);
      const uniforms = {
        uResolution: { value: new THREE.Vector2(0, 0) },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(color) },
        uClickPos: {
          value: Array.from({ length: PB_MAX_CLICKS }, () => new THREE.Vector2(-1, -1)),
        },
        uClickTimes: { value: new Float32Array(PB_MAX_CLICKS) },
        uShapeType: { value: SHAPE_MAP[variant] ?? 0 },
        uPixelSize: { value: pixelSize * renderer.getPixelRatio() },
        uScale: { value: patternScale },
        uDensity: { value: patternDensity },
        uPixelJitter: { value: pixelSizeJitter },
        uEnableRipples: { value: enableRipples ? 1 : 0 },
        uRippleSpeed: { value: rippleSpeed },
        uRippleThickness: { value: rippleThickness },
        uRippleIntensity: { value: rippleIntensityScale },
        uEdgeFade: { value: edgeFade },
      };
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const material = new THREE.ShaderMaterial({
        vertexShader: PB_VERTEX_SRC,
        fragmentShader: PB_FRAGMENT_SRC,
        uniforms,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        glslVersion: THREE.GLSL3,
      });
      const quadGeom = new THREE.PlaneGeometry(2, 2);
      const quad = new THREE.Mesh(quadGeom, material);
      scene.add(quad);
      const clock = new THREE.Clock();
      const setSize = () => {
        const w = container.clientWidth || 1;
        const h = container.clientHeight || 1;
        renderer.setSize(w, h, false);
        uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
        if (threeRef.current?.composer)
          threeRef.current.composer.setSize(renderer.domElement.width, renderer.domElement.height);
        uniforms.uPixelSize.value = pixelSize * renderer.getPixelRatio();
      };
      setSize();
      const ro = new ResizeObserver(setSize);
      ro.observe(container);
      const randomFloat = () => {
        if (typeof window !== "undefined" && window.crypto?.getRandomValues) {
          const u32 = new Uint32Array(1);
          window.crypto.getRandomValues(u32);
          return u32[0] / 0xffffffff;
        }
        return Math.random();
      };
      const timeOffset = randomFloat() * 1000;
      let composer;
      let touch;
      let liquidEffect;
      if (liquid) {
        touch = createTouchTexture();
        touch.radiusScale = liquidRadius;
        composer = new EffectComposer(renderer);
        const renderPass = new RenderPass(scene, camera);
        liquidEffect = createLiquidEffect(touch.texture, {
          strength: liquidStrength,
          freq: liquidWobbleSpeed,
        });
        const effectPass = new EffectPass(camera, liquidEffect);
        effectPass.renderToScreen = true;
        composer.addPass(renderPass);
        composer.addPass(effectPass);
      }
      if (noiseAmount > 0) {
        if (!composer) {
          composer = new EffectComposer(renderer);
          composer.addPass(new RenderPass(scene, camera));
        }
        const noiseEffect = new Effect(
          "NoiseEffect",
          `uniform float uTime; uniform float uAmount; float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);} void mainUv(inout vec2 uv){} void mainImage(const in vec4 inputColor,const in vec2 uv,out vec4 outputColor){ float n=hash(floor(uv*vec2(1920.0,1080.0))+floor(uTime*60.0)); float g=(n-0.5)*uAmount; outputColor=inputColor+vec4(vec3(g),0.0);} `,
          {
            uniforms: new Map([
              ["uTime", new THREE.Uniform(0)],
              ["uAmount", new THREE.Uniform(noiseAmount)],
            ]),
          }
        );
        const noisePass = new EffectPass(camera, noiseEffect);
        noisePass.renderToScreen = true;
        if (composer && composer.passes.length > 0) composer.passes.forEach((p) => (p.renderToScreen = false));
        composer.addPass(noisePass);
      }
      if (composer) composer.setSize(renderer.domElement.width, renderer.domElement.height);
      const mapToPixels = (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const scaleX = renderer.domElement.width / rect.width;
        const scaleY = renderer.domElement.height / rect.height;
        const fx = (e.clientX - rect.left) * scaleX;
        const fy = (rect.height - (e.clientY - rect.top)) * scaleY;
        return {
          fx,
          fy,
          w: renderer.domElement.width,
          h: renderer.domElement.height,
        };
      };
      const onPointerDown = (e) => {
        const { fx, fy } = mapToPixels(e);
        const ix = threeRef.current?.clickIx ?? 0;
        uniforms.uClickPos.value[ix].set(fx, fy);
        uniforms.uClickTimes.value[ix] = uniforms.uTime.value;
        if (threeRef.current) threeRef.current.clickIx = (ix + 1) % PB_MAX_CLICKS;
      };
      const onPointerMove = (e) => {
        if (!touch) return;
        const { fx, fy, w, h } = mapToPixels(e);
        touch.addTouch({ x: fx / w, y: fy / h });
      };
      renderer.domElement.addEventListener("pointerdown", onPointerDown, {
        passive: true,
      });
      renderer.domElement.addEventListener("pointermove", onPointerMove, {
        passive: true,
      });
      let raf = 0;
      const animate = () => {
        if (autoPauseOffscreen && !visibilityRef.current.visible) {
          raf = requestAnimationFrame(animate);
          return;
        }
        uniforms.uTime.value = timeOffset + clock.getElapsedTime() * speedRef.current;
        if (liquidEffect) liquidEffect.uniforms.get("uTime").value = uniforms.uTime.value;
        if (composer) {
          if (touch) touch.update();
          composer.passes.forEach((p) => {
            const effs = p.effects;
            if (effs)
              effs.forEach((eff) => {
                const u = eff.uniforms?.get("uTime");
                if (u) u.value = uniforms.uTime.value;
              });
          });
          composer.render();
        } else renderer.render(scene, camera);
        raf = requestAnimationFrame(animate);
      };
      raf = requestAnimationFrame(animate);
      threeRef.current = {
        renderer,
        scene,
        camera,
        material,
        clock,
        clickIx: 0,
        uniforms,
        resizeObserver: ro,
        raf,
        quad,
        timeOffset,
        composer,
        touch,
        liquidEffect,
      };
    } else {
      const t = threeRef.current;
      t.uniforms.uShapeType.value = SHAPE_MAP[variant] ?? 0;
      t.uniforms.uPixelSize.value = pixelSize * t.renderer.getPixelRatio();
      t.uniforms.uColor.value.set(color);
      t.uniforms.uScale.value = patternScale;
      t.uniforms.uDensity.value = patternDensity;
      t.uniforms.uPixelJitter.value = pixelSizeJitter;
      t.uniforms.uEnableRipples.value = enableRipples ? 1 : 0;
      t.uniforms.uRippleIntensity.value = rippleIntensityScale;
      t.uniforms.uRippleThickness.value = rippleThickness;
      t.uniforms.uRippleSpeed.value = rippleSpeed;
      t.uniforms.uEdgeFade.value = edgeFade;
      if (transparent) t.renderer.setClearAlpha(0);
      else t.renderer.setClearColor(0x000000, 1);
      if (t.liquidEffect) {
        const uStrength = t.liquidEffect;
        if (uStrength) uStrength.value = liquidStrength;
        const uFreq = t.liquidEffect.uniforms.get("uFreq");
        if (uFreq) uFreq.value = liquidWobbleSpeed;
      }
      if (t.touch) t.touch.radiusScale = liquidRadius;
    }
    prevConfigRef.current = cfg;
    return () => {
      if (threeRef.current && mustReinit) return;
      if (!threeRef.current) return;
      const t = threeRef.current;
      t.resizeObserver?.disconnect();
      cancelAnimationFrame(t.raf);
      t.quad?.geometry.dispose();
      t.material.dispose();
      t.composer?.dispose();
      t.renderer.dispose();
      t.renderer.forceContextLoss();
      if (t.renderer.domElement.parentElement === container) container.removeChild(t.renderer.domElement);
      threeRef.current = null;
    };
  }, [
    antialias,
    liquid,
    noiseAmount,
    pixelSize,
    patternScale,
    patternDensity,
    enableRipples,
    rippleIntensityScale,
    rippleThickness,
    rippleSpeed,
    pixelSizeJitter,
    edgeFade,
    transparent,
    liquidStrength,
    liquidRadius,
    liquidWobbleSpeed,
    autoPauseOffscreen,
    variant,
    color,
    speed,
  ]);

  return (
    <div
      ref={containerRef}
      className={`mkt-pixelblast-canvas ${className ?? ""}`}
      style={style}
      aria-label="Billing page background"
    />
  );
};

/* ------------------------------------------------------------------ */
/* Billing                                                              */
/* ------------------------------------------------------------------ */

function Billing({ business, appUser, onBusinessUpdate }) {
  const [switchingTo, setSwitchingTo] = useState(null);
  const [error, setError] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const pollAttempts = useRef(0);

  const [pendingDowngrade, setPendingDowngrade] = useState(null); // planKey awaiting confirmation
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const currentPlan = business?.plan || "free";
  const installed = business?.installed_modules || [];

  // AI credit usage. The monthly rollover is only actually applied inside
  // the ai-builder edge function when a request is made — so if a
  // business hasn't called AI Builder yet this month, ai_credits_used in
  // the database may still reflect last month's count. We account for
  // that here client-side so the number shown is never misleadingly
  // stale, even before their next AI Builder request triggers the real
  // reset in the database.
  const aiAccess = getAiAccess(currentPlan);
  const creditsLimit = aiAccess.monthlyCredits;
  const resetAt = business?.ai_credits_reset_at ? new Date(business.ai_credits_reset_at) : null;
  const isPastReset = resetAt ? new Date() >= resetAt : false;
  const rawCreditsUsed = business?.ai_credits_used ?? 0;
  const creditsUsed = isPastReset ? 0 : rawCreditsUsed;
  const creditsRemaining = creditsLimit === Infinity ? Infinity : Math.max(creditsLimit - creditsUsed, 0);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (searchParams.get("payment") !== "success" || !business?.id) return;

    setPolling(true);
    setPollTimedOut(false);
    pollAttempts.current = 0;

    const interval = setInterval(async () => {
      pollAttempts.current += 1;

      const { data, error: pollError } = await supabase
        .from("businesses")
        .select("*")
        .eq("id", business.id)
        .single();

      if (!pollError && data && data.plan !== currentPlan) {
        // Plan changed — the ITN has landed. Update state and stop polling.
        if (onBusinessUpdate) onBusinessUpdate(data);
        setPolling(false);
        clearInterval(interval);
        setToast({ type: "success", text: `You're now on the ${PLAN_DETAILS[data.plan].name} plan` });
        // Clean the query param so refreshing doesn't re-trigger polling.
        setSearchParams({}, { replace: true });
        return;
      }

      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        // Gave up — the payment may still be processing on PayFast's side.
        // Stop polling so we don't hammer the database forever, but let
        // the person know explicitly rather than going silent.
        setPolling(false);
        setPollTimedOut(true);
        clearInterval(interval);
        setSearchParams({}, { replace: true });
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, business?.id]);

  const handleManualRefresh = async () => {
    const { data, error: refreshError } = await supabase
      .from("businesses")
      .select("*")
      .eq("id", business.id)
      .single();

    if (!refreshError && data) {
      if (onBusinessUpdate) onBusinessUpdate(data);
      setPollTimedOut(false);
    }
  };

  const switchToFree = async () => {
    setSwitchingTo("free");
    setPendingDowngrade(null);

    if (business.payfast_token) {
      const { error: cancelError } = await supabase.functions.invoke("payfast-cancel", {
        body: { business_id: business.id },
      });
      if (cancelError) {
        setSwitchingTo(null);
        return setError(`Could not cancel your active subscription: ${cancelError.message}`);
      }
    }

    const newLimit = getModuleLimit("free");
    const isDowngrade = newLimit < installed.length;
    const nextModules = isDowngrade ? capModulesToPlan(installed, "free") : installed;
    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ plan: "free", installed_modules: nextModules })
      .eq("id", business.id)
      .select()
      .single();

    setSwitchingTo(null);

    if (updateError) {
      return setError(updateError.message);
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    setToast({ type: "neutral", text: `Switched to ${PLAN_DETAILS.free.name}` });
    notify(business.id, appUser?.id, `Plan changed to ${PLAN_DETAILS.free.name}.`);
  };

  const startPaidCheckout = async (planKey) => {
    // Paid plans go through PayFast. The plan does NOT change here — it
    // only changes once payfast-notify confirms the payment server-side.
    //
    // Supabase's edge runtime forces a sandboxed CSP + text/plain on every
    // function response, so it can't serve an HTML auto-submit page itself.
    // Instead the function returns the signed fields as JSON, and we build
    // and submit the actual form to PayFast from here.
    setSwitchingTo(planKey);
    setError("");

    try {
      const response = await fetch(
        `${FUNCTIONS_URL}/payfast-checkout?business_id=${business.id}&plan=${planKey}`
      );

      if (!response.ok) {
        throw new Error(`Checkout setup failed (${response.status})`);
      }

      const { action, fields } = await response.json();

      const form = document.createElement("form");
      form.method = "POST";
      form.action = action;

      Object.entries(fields).forEach(([key, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      form.submit();
    } catch (err) {
      setSwitchingTo(null);
      setError(`Could not start checkout: ${err.message}`);
    }
  };

  const handleSwitchPlan = (planKey) => {
    if (planKey === currentPlan) return;
    setError("");

    const newLimit = getModuleLimit(planKey);
    const isDowngrade = newLimit < installed.length;

    if (isDowngrade) {
      setPendingDowngrade(planKey);
      return;
    }

    if (planKey === "free") {
      switchToFree();
    } else {
      startPaidCheckout(planKey);
    }
  };

  const confirmDowngrade = () => {
    if (pendingDowngrade === "free") {
      switchToFree();
    } else if (pendingDowngrade) {
      startPaidCheckout(pendingDowngrade);
    }
  };

  return (
    <div className="bill-page">
      {/* Animated background — subtle wash within the existing purple/blue/teal palette */}
      <div className="bill-bg-layer">
        <PixelBlast
          variant="square"
          pixelSize={4}
          color="#7c3aed"
          patternScale={2}
          patternDensity={1}
          pixelSizeJitter={0}
          enableRipples
          rippleSpeed={0.4}
          rippleThickness={0.12}
          rippleIntensityScale={1.5}
          liquid={false}
          liquidStrength={0.12}
          liquidRadius={1.2}
          liquidWobbleSpeed={5}
          speed={0.5}
          edgeFade={0.25}
          transparent
        />
      </div>

      <AppNav business={business} />

      <div className="bill-body">
        <div className={loaded ? "bill-in" : ""}>
          <p className="bill-eyebrow">Billing</p>
          <h1 className="bill-heading">Your plan</h1>
          <p className="bill-sub">
            Pay for what you use, and grow when you're ready. You're currently on the{" "}
            <strong>{PLAN_DETAILS[currentPlan].name}</strong> plan with {installed.length} module
            {installed.length === 1 ? "" : "s"} installed.
          </p>
        </div>

        {creditsLimit > 0 && (
          <p className={`bill-sub bill-credits ${loaded ? "bill-in" : ""}`}>
            {creditsLimit === Infinity ? (
              "Unlimited AI Builder requests this month."
            ) : (
              <>
                <strong>{creditsRemaining}</strong> of {creditsLimit} AI Builder request
                {creditsLimit === 1 ? "" : "s"} left this month
                {resetAt && !isPastReset && (
                  <>
                    {" "}
                    — resets{" "}
                    {resetAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </>
                )}
                .
              </>
            )}
          </p>
        )}

        {polling && (
          <p className="bill-status bill-status--info mkt-in bill-in">
            <span className="bill-status-dot" />
            Confirming your payment with PayFast — this can take a minute or so...
          </p>
        )}

        {pollTimedOut && (
          <p className="bill-status bill-status--warn bill-in">
            Still waiting to hear back from PayFast about your payment.{" "}
            <button className="bill-inline-link" onClick={handleManualRefresh}>
              Check again
            </button>
          </p>
        )}

        {business?.subscription_status === "failed" && (
          <p className="bill-error bill-in">
            Your last payment didn't go through. Please switch your plan again to retry.
          </p>
        )}

        {error && <p className="bill-error bill-in">{error}</p>}

        <div className="bill-grid">
          {PLANS.map((planKey, i) => {
            const details = PLAN_DETAILS[planKey];
            const isCurrent = planKey === currentPlan;
            const isBusy = switchingTo === planKey;
            const isConfirming = pendingDowngrade === planKey;
            return (
              <div
                className={`bill-card ${isCurrent ? "bill-card--current" : ""} ${loaded ? "bill-in" : ""}`}
                key={planKey}
                style={{ transitionDelay: loaded ? `${i * 50}ms` : "0ms" }}
              >
                {isCurrent && <span className="bill-badge">Current plan</span>}
                <h3>{details.name}</h3>
                <div className="bill-amount">
                  <span className="bill-price">{details.price}</span>
                  <span className="bill-cadence">{details.cadence}</span>
                </div>
                <p className="bill-modules">
                  {getModuleLimit(planKey) === Infinity
                    ? "Unlimited modules"
                    : `Up to ${getModuleLimit(planKey)} modules`}
                </p>
                <p className="bill-ai">{details.ai}</p>
                <p className="bill-extra">{details.extraModulePrice}</p>

                {isConfirming ? (
                  <div className="bill-confirm">
                    <p>
                      The {details.name} plan includes {getModuleLimit(planKey)} module
                      {getModuleLimit(planKey) === 1 ? "" : "s"}. You have {installed.length} installed
                      — {installed.length - getModuleLimit(planKey)} will be removed (your data stays
                      intact).
                    </p>
                    <div className="bill-confirm-actions">
                      <button className="bill-confirm-yes" onClick={confirmDowngrade} disabled={isBusy}>
                        {isBusy ? "Working..." : "Continue"}
                      </button>
                      <button
                        className="bill-confirm-no"
                        onClick={() => setPendingDowngrade(null)}
                        disabled={isBusy}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className={isCurrent ? "bill-btn bill-btn--disabled" : "bill-btn"}
                    onClick={() => handleSwitchPlan(planKey)}
                    disabled={isCurrent || isBusy}
                  >
                    {isCurrent ? (
                      "Current plan"
                    ) : isBusy ? (
                      <span className="bill-spinner" />
                    ) : (
                      "Switch plan"
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className={`bill-footnote ${loaded ? "bill-in" : ""}`}>
          <strong>Need something custom?</strong> For requirements beyond the standard modules,
          Astorra builds fully custom software too — <a href="mailto:info@rragencies.co.za">get in touch</a> to scope it.
        </div>
      </div>

      {toast && (
        <div className={`bill-toast bill-toast--${toast.type}`}>
          {toast.type === "success" ? "✓" : "—"} {toast.text}
        </div>
      )}
    </div>
  );
}

export default Billing;