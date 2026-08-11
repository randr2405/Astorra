import { useState, useRef, useEffect } from "react";
import {
  Clock,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Settings.css";

/* ------------------------------------------------------------------ */
/* FloatingLines — inlined background shader (no external import)      */
/* ------------------------------------------------------------------ */

const flVertexShader = `
precision highp float;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const flFragmentShader = `
precision highp float;

uniform float iTime;
uniform vec3  iResolution;
uniform float animationSpeed;

uniform bool enableTop;
uniform bool enableMiddle;
uniform bool enableBottom;

uniform int topLineCount;
uniform int middleLineCount;
uniform int bottomLineCount;

uniform float topLineDistance;
uniform float middleLineDistance;
uniform float bottomLineDistance;

uniform vec3 topWavePosition;
uniform vec3 middleWavePosition;
uniform vec3 bottomWavePosition;

uniform vec2 iMouse;
uniform bool interactive;
uniform float bendRadius;
uniform float bendStrength;
uniform float bendInfluence;

uniform bool parallax;
uniform float parallaxStrength;
uniform vec2 parallaxOffset;

uniform vec3 lineGradient[8];
uniform int lineGradientCount;

const vec3 BLACK = vec3(0.0);
const vec3 PINK  = vec3(233.0, 71.0, 245.0) / 255.0;
const vec3 BLUE  = vec3(47.0,  75.0, 162.0) / 255.0;

mat2 rotate(float r) {
  return mat2(cos(r), sin(r), -sin(r), cos(r));
}

vec3 background_color(vec2 uv) {
  vec3 col = vec3(0.0);

  float y = sin(uv.x - 0.2) * 0.3 - 0.1;
  float m = uv.y - y;

  col += mix(BLUE, BLACK, smoothstep(0.0, 1.0, abs(m)));
  col += mix(PINK, BLACK, smoothstep(0.0, 1.0, abs(m - 0.8)));
  return col * 0.5;
}

vec3 getLineColor(float t, vec3 baseColor) {
  if (lineGradientCount <= 0) {
    return baseColor;
  }

  vec3 gradientColor;
  
  if (lineGradientCount == 1) {
    gradientColor = lineGradient[0];
  } else {
    float clampedT = clamp(t, 0.0, 0.9999);
    float scaled = clampedT * float(lineGradientCount - 1);
    int idx = int(floor(scaled));
    float f = fract(scaled);
    int idx2 = min(idx + 1, lineGradientCount - 1);

    vec3 c1 = lineGradient[idx];
    vec3 c2 = lineGradient[idx2];
    
    gradientColor = mix(c1, c2, f);
  }
  
  return gradientColor * 0.5;
}

  float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {
  float time = iTime * animationSpeed;

  float x_offset   = offset;
  float x_movement = time * 0.1;
  float amp        = sin(offset + time * 0.2) * 0.3;
  float y          = sin(uv.x + x_offset + x_movement) * amp;

  if (shouldBend) {
    vec2 d = screenUv - mouseUv;
    float influence = exp(-dot(d, d) * bendRadius); // radial falloff around cursor
    float bendOffset = (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;
    y += bendOffset;
  }

  float m = uv.y - y;
  return 0.0175 / max(abs(m) + 0.01, 1e-3) + 0.01;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 baseUv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
  baseUv.y *= -1.0;
  
  if (parallax) {
    baseUv += parallaxOffset;
  }

  vec3 col = vec3(0.0);

  vec3 b = lineGradientCount > 0 ? vec3(0.0) : background_color(baseUv);

  vec2 mouseUv = vec2(0.0);
  if (interactive) {
    mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
    mouseUv.y *= -1.0;
  }
  
  if (enableBottom) {
    for (int i = 0; i < bottomLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(bottomLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(
        ruv + vec2(bottomLineDistance * fi + bottomWavePosition.x, bottomWavePosition.y),
        1.5 + 0.2 * fi,
        baseUv,
        mouseUv,
        interactive
      ) * 0.2;
    }
  }

  if (enableMiddle) {
    for (int i = 0; i < middleLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(middleLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = middleWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      col += lineCol * wave(
        ruv + vec2(middleLineDistance * fi + middleWavePosition.x, middleWavePosition.y),
        2.0 + 0.15 * fi,
        baseUv,
        mouseUv,
        interactive
      );
    }
  }

  if (enableTop) {
    for (int i = 0; i < topLineCount; ++i) {
      float fi = float(i);
      float t = fi / max(float(topLineCount - 1), 1.0);
      vec3 lineCol = getLineColor(t, b);
      
      float angle = topWavePosition.z * log(length(baseUv) + 1.0);
      vec2 ruv = baseUv * rotate(angle);
      ruv.x *= -1.0;
      col += lineCol * wave(
        ruv + vec2(topLineDistance * fi + topWavePosition.x, topWavePosition.y),
        1.0 + 0.2 * fi,
        baseUv,
        mouseUv,
        interactive
      ) * 0.1;
    }
  }

  fragColor = vec4(col, 1.0);
}

void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

const FL_MAX_GRADIENT_STOPS = 8;

function flHexToVec3(hex) {
  let value = hex.trim();

  if (value.startsWith("#")) {
    value = value.slice(1);
  }

  let r = 255;
  let g = 255;
  let b = 255;

  if (value.length === 3) {
    r = parseInt(value[0] + value[0], 16);
    g = parseInt(value[1] + value[1], 16);
    b = parseInt(value[2] + value[2], 16);
  } else if (value.length === 6) {
    r = parseInt(value.slice(0, 2), 16);
    g = parseInt(value.slice(2, 4), 16);
    b = parseInt(value.slice(4, 6), 16);
  }

  return new Vector3(r / 255, g / 255, b / 255);
}

function FloatingLines({
  linesGradient,
  enabledWaves = ["top", "middle", "bottom"],
  lineCount = [6],
  lineDistance = [5],
  topWavePosition,
  middleWavePosition,
  bottomWavePosition = { x: 2.0, y: -0.7, rotate: -1 },
  animationSpeed = 1,
  interactive = true,
  bendRadius = 5.0,
  bendStrength = -0.5,
  mouseDamping = 0.05,
  parallax = true,
  parallaxStrength = 0.2,
  mixBlendMode = "screen",
  className,
}) {
  const containerRef = useRef(null);
  const targetMouseRef = useRef(new Vector2(-1000, -1000));
  const currentMouseRef = useRef(new Vector2(-1000, -1000));
  const targetInfluenceRef = useRef(0);
  const currentInfluenceRef = useRef(0);
  const targetParallaxRef = useRef(new Vector2(0, 0));
  const currentParallaxRef = useRef(new Vector2(0, 0));

  const getLineCount = (waveType) => {
    if (typeof lineCount === "number") return lineCount;
    if (!enabledWaves.includes(waveType)) return 0;
    const index = enabledWaves.indexOf(waveType);
    return lineCount[index] ?? 6;
  };

  const getLineDistance = (waveType) => {
    if (typeof lineDistance === "number") return lineDistance;
    if (!enabledWaves.includes(waveType)) return 0.1;
    const index = enabledWaves.indexOf(waveType);
    return lineDistance[index] ?? 0.1;
  };

  const topLineCount = enabledWaves.includes("top") ? getLineCount("top") : 0;
  const middleLineCount = enabledWaves.includes("middle") ? getLineCount("middle") : 0;
  const bottomLineCount = enabledWaves.includes("bottom") ? getLineCount("bottom") : 0;

  const topLineDistance = enabledWaves.includes("top") ? getLineDistance("top") * 0.01 : 0.01;
  const middleLineDistance = enabledWaves.includes("middle") ? getLineDistance("middle") * 0.01 : 0.01;
  const bottomLineDistance = enabledWaves.includes("bottom") ? getLineDistance("bottom") * 0.01 : 0.01;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let active = true;

    const scene = new Scene();

    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: new Vector3(1, 1, 1) },
      animationSpeed: { value: animationSpeed },

      enableTop: { value: enabledWaves.includes("top") },
      enableMiddle: { value: enabledWaves.includes("middle") },
      enableBottom: { value: enabledWaves.includes("bottom") },

      topLineCount: { value: topLineCount },
      middleLineCount: { value: middleLineCount },
      bottomLineCount: { value: bottomLineCount },

      topLineDistance: { value: topLineDistance },
      middleLineDistance: { value: middleLineDistance },
      bottomLineDistance: { value: bottomLineDistance },

      topWavePosition: {
        value: new Vector3(topWavePosition?.x ?? 10.0, topWavePosition?.y ?? 0.5, topWavePosition?.rotate ?? -0.4),
      },
      middleWavePosition: {
        value: new Vector3(
          middleWavePosition?.x ?? 5.0,
          middleWavePosition?.y ?? 0.0,
          middleWavePosition?.rotate ?? 0.2
        ),
      },
      bottomWavePosition: {
        value: new Vector3(
          bottomWavePosition?.x ?? 2.0,
          bottomWavePosition?.y ?? -0.7,
          bottomWavePosition?.rotate ?? 0.4
        ),
      },

      iMouse: { value: new Vector2(-1000, -1000) },
      interactive: { value: interactive },
      bendRadius: { value: bendRadius },
      bendStrength: { value: bendStrength },
      bendInfluence: { value: 0 },

      parallax: { value: parallax },
      parallaxStrength: { value: parallaxStrength },
      parallaxOffset: { value: new Vector2(0, 0) },

      lineGradient: {
        value: Array.from({ length: FL_MAX_GRADIENT_STOPS }, () => new Vector3(1, 1, 1)),
      },
      lineGradientCount: { value: 0 },
    };

    if (linesGradient && linesGradient.length > 0) {
      const stops = linesGradient.slice(0, FL_MAX_GRADIENT_STOPS);
      uniforms.lineGradientCount.value = stops.length;

      stops.forEach((hex, i) => {
        const color = flHexToVec3(hex);
        uniforms.lineGradient.value[i].set(color.x, color.y, color.z);
      });
    }

    const material = new ShaderMaterial({
      uniforms,
      vertexShader: flVertexShader,
      fragmentShader: flFragmentShader,
    });

    const geometry = new PlaneGeometry(2, 2);
    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    const clock = new Clock();

    const setSize = () => {
      if (!active) return;
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;

      renderer.setSize(width, height, false);

      const canvasWidth = renderer.domElement.width;
      const canvasHeight = renderer.domElement.height;
      uniforms.iResolution.value.set(canvasWidth, canvasHeight, 1);
    };

    setSize();

    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (!active) return;
            setSize();
          })
        : null;

    if (ro) ro.observe(container);

    const handlePointerMove = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const dpr = renderer.getPixelRatio();

      targetMouseRef.current.set(x * dpr, (rect.height - y) * dpr);
      targetInfluenceRef.current = 1.0;

      if (parallax) {
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        const offsetX = (x - centerX) / rect.width;
        const offsetY = -(y - centerY) / rect.height;
        targetParallaxRef.current.set(offsetX * parallaxStrength, offsetY * parallaxStrength);
      }
    };

    const handlePointerLeave = () => {
      targetInfluenceRef.current = 0.0;
    };

    if (interactive) {
      renderer.domElement.addEventListener("pointermove", handlePointerMove);
      renderer.domElement.addEventListener("pointerleave", handlePointerLeave);
    }

    let raf = 0;
    const renderLoop = () => {
      if (!active) return;

      uniforms.iTime.value = clock.getElapsedTime();

      if (interactive) {
        currentMouseRef.current.lerp(targetMouseRef.current, mouseDamping);
        uniforms.iMouse.value.copy(currentMouseRef.current);

        currentInfluenceRef.current += (targetInfluenceRef.current - currentInfluenceRef.current) * mouseDamping;
        uniforms.bendInfluence.value = currentInfluenceRef.current;
      }

      if (parallax) {
        currentParallaxRef.current.lerp(targetParallaxRef.current, mouseDamping);
        uniforms.parallaxOffset.value.copy(currentParallaxRef.current);
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(renderLoop);
    };
    renderLoop();

    return () => {
      active = false;

      cancelAnimationFrame(raf);

      if (ro) ro.disconnect();

      if (interactive) {
        renderer.domElement.removeEventListener("pointermove", handlePointerMove);
        renderer.domElement.removeEventListener("pointerleave", handlePointerLeave);
      }

      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      if (renderer.domElement.parentElement) {
        renderer.domElement.parentElement.removeChild(renderer.domElement);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    linesGradient,
    enabledWaves,
    lineCount,
    lineDistance,
    topWavePosition,
    middleWavePosition,
    bottomWavePosition,
    animationSpeed,
    interactive,
    bendRadius,
    bendStrength,
    mouseDamping,
    parallax,
    parallaxStrength,
  ]);

  return (
    <div
      ref={containerRef}
      className={`set-floatinglines-canvas ${className || ""}`}
      style={{
        mixBlendMode: mixBlendMode,
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

function Settings({ business, appUser, onBusinessUpdate }) {
  const [profileForm, setProfileForm] = useState({
    name: business?.name || "",
    email: business?.email || "",
    phone: business?.phone || "",
    address: business?.address || "",
    registration_number: business?.registration_number || "",
    vat_number: business?.vat_number || "",
  });
  const [bankForm, setBankForm] = useState({
    bank_name: business?.bank_name || "",
    bank_account_holder: business?.bank_account_holder || "",
    bank_account_number: business?.bank_account_number || "",
    bank_branch_code: business?.bank_branch_code || "",
    bank_account_type: business?.bank_account_type || "",
    bank_payment_reference_note: business?.bank_payment_reference_note || "",
  });

  const [profileDirty, setProfileDirty] = useState(false);
  const [bankDirty, setBankDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState(null);
  const [loaded, setLoaded] = useState(false);

  const fileInputRef = useRef(null);

  useState(() => {
    const t = setTimeout(() => setLoaded(true), 60);
    return () => clearTimeout(t);
  });

  const showToast = (text, type = "success") => {
    setToast({ text, type, key: Date.now() });
    setTimeout(() => setToast(null), 2600);
  };

  const handleProfileChange = (field) => (e) => {
    setProfileForm((prev) => ({ ...prev, [field]: e.target.value }));
    setProfileDirty(true);
  };

  const handleBankChange = (field) => (e) => {
    setBankForm((prev) => ({ ...prev, [field]: e.target.value }));
    setBankDirty(true);
  };

  // Empty strings stored as null so downstream checks like
  // PayInvoice's hasBankingDetails (!!bank_account_number && !!bank_name)
  // behave correctly rather than treating "" as present.
  const cleanPayload = (form) =>
    Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim() === "" ? null : value.trim()])
    );

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSavingProfile(true);
    setError("");

    const payload = cleanPayload(profileForm);

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update(payload)
      .eq("id", business.id)
      .select()
      .single();

    setSavingProfile(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    notify(business.id, appUser?.id, "Business profile updated.");
    setProfileDirty(false);
    showToast("Business profile saved");
  };

  const handleSaveBank = async (e) => {
    e.preventDefault();
    setSavingBank(true);
    setError("");

    const payload = cleanPayload(bankForm);

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update(payload)
      .eq("id", business.id)
      .select()
      .single();

    setSavingBank(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    notify(business.id, appUser?.id, "Banking details updated.");
    setBankDirty(false);
    showToast("Banking details saved");
  };

  const handleLogoPick = () => {
    fileInputRef.current?.click();
  };

  const handleLogoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Logo must be an image file.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setError("Logo must be under 2MB.");
      return;
    }

    setError("");
    setUploadingLogo(true);

    const ext = file.name.split(".").pop();
    const path = `${business.id}/logo.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("business-logos")
      .upload(path, file, { upsert: true });

    if (uploadError) {
      setUploadingLogo(false);
      setError(uploadError.message);
      return;
    }

    const { data: urlData } = supabase.storage.from("business-logos").getPublicUrl(path);
    const logoUrl = `${urlData.publicUrl}?t=${Date.now()}`; // cache-bust so the new logo shows immediately

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update({ logo_url: logoUrl })
      .eq("id", business.id)
      .select()
      .single();

    setUploadingLogo(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    showToast("Logo updated");
  };

  const initials = (profileForm.name || business?.name || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");

  return (
    <div className="set-page">
      {/* Animated background — subtle wash within the existing purple/blue/teal palette */}
      <div className="set-bg-layer">
        <FloatingLines
          enabledWaves={["top", "middle", "bottom"]}
          lineCount={5}
          lineDistance={8}
          bendRadius={8}
          bendStrength={-1}
          interactive
          parallax
          parallaxStrength={0.08}
          animationSpeed={0.5}
          linesGradient={["#7c3aed", "#3b82f6", "#14b8a6"]}
        />
      </div>

      <AppNav business={business} />

      <div className="set-body">
        <div className={loaded ? "set-in" : ""}>
          <p className="set-eyebrow">Settings</p>
          <h1 className="set-heading">Business details</h1>
          <p className="set-sub">
            Manage your business profile and the banking details your customers see when they pay
            an invoice online.
          </p>
        </div>

        {error && <p className="set-error set-in">{error}</p>}

        {/* Business profile */}
        <form
          className={`set-card ${loaded ? "set-in" : ""}`}
          onSubmit={handleSaveProfile}
        >
          <div className="set-card-header">
            <div>
              <p className="set-card-heading">Business profile</p>
              <p className="set-card-sub">Shown on invoices, quotes, and the customer payment page.</p>
            </div>
          </div>

          <div className="set-logo-row">
            <div className="set-logo-preview">
              {business?.logo_url ? (
                <img src={business.logo_url} alt="Business logo" />
              ) : (
                <span>{initials || "?"}</span>
              )}
              {uploadingLogo && (
                <div className="set-logo-overlay">
                  <span className="set-spinner" />
                </div>
              )}
            </div>
            <div>
              <button type="button" className="set-secondary-btn" onClick={handleLogoPick} disabled={uploadingLogo}>
                {business?.logo_url ? "Change logo" : "Upload logo"}
              </button>
              <p className="set-hint">PNG or JPG, up to 2MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{ display: "none" }}
              />
            </div>
          </div>

          <div className="set-field">
            <label htmlFor="name">Business name</label>
            <input
              id="name"
              type="text"
              value={profileForm.name}
              onChange={handleProfileChange("name")}
              placeholder="e.g. R&R Agencies"
            />
          </div>

          <div className="set-row">
            <div className="set-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={profileForm.email}
                onChange={handleProfileChange("email")}
                placeholder="hello@yourbusiness.co.za"
              />
            </div>
            <div className="set-field">
              <label htmlFor="phone">Phone</label>
              <input
                id="phone"
                type="tel"
                value={profileForm.phone}
                onChange={handleProfileChange("phone")}
                placeholder="e.g. 031 123 4567"
              />
            </div>
          </div>

          <div className="set-field">
            <label htmlFor="address">Business address</label>
            <textarea
              id="address"
              rows={2}
              value={profileForm.address}
              onChange={handleProfileChange("address")}
              placeholder="Street, suburb, city, postal code"
            />
          </div>

          <div className="set-row">
            <div className="set-field">
              <label htmlFor="registration_number">Registration number</label>
              <input
                id="registration_number"
                type="text"
                value={profileForm.registration_number}
                onChange={handleProfileChange("registration_number")}
                placeholder="Optional"
              />
            </div>
            <div className="set-field">
              <label htmlFor="vat_number">VAT number</label>
              <input
                id="vat_number"
                type="text"
                value={profileForm.vat_number}
                onChange={handleProfileChange("vat_number")}
                placeholder="Optional"
              />
            </div>
          </div>

          <div className="set-card-footer">
            {profileDirty && !savingProfile && <span className="set-unsaved">Unsaved changes</span>}
            <button type="submit" className="set-btn" disabled={savingProfile || !profileDirty}>
              {savingProfile ? <span className="set-spinner" /> : "Save changes"}
            </button>
          </div>
        </form>

        {/* Payment details */}
        <form
          className={`set-card ${loaded ? "set-in" : ""}`}
          onSubmit={handleSaveBank}
          style={{ transitionDelay: loaded ? "60ms" : "0ms" }}
        >
          <div className="set-card-header">
            <div>
              <p className="set-card-heading">Payment details</p>
              <p className="set-card-sub">
                These appear on the payment page your customers see when they pay an invoice
                online.
              </p>
            </div>
          </div>

          <div className="set-field">
            <label htmlFor="bank_name">Bank</label>
            <input
              id="bank_name"
              type="text"
              value={bankForm.bank_name}
              onChange={handleBankChange("bank_name")}
              placeholder="e.g. FNB"
            />
          </div>

          <div className="set-field">
            <label htmlFor="bank_account_holder">Account holder</label>
            <input
              id="bank_account_holder"
              type="text"
              value={bankForm.bank_account_holder}
              onChange={handleBankChange("bank_account_holder")}
              placeholder="e.g. Astorra (Pty) Ltd"
            />
          </div>

          <div className="set-field">
            <label htmlFor="bank_account_number">Account number</label>
            <input
              id="bank_account_number"
              type="text"
              value={bankForm.bank_account_number}
              onChange={handleBankChange("bank_account_number")}
            />
          </div>

          <div className="set-row">
            <div className="set-field">
              <label htmlFor="bank_branch_code">Branch code</label>
              <input
                id="bank_branch_code"
                type="text"
                value={bankForm.bank_branch_code}
                onChange={handleBankChange("bank_branch_code")}
              />
            </div>

            <div className="set-field">
              <label htmlFor="bank_account_type">Account type</label>
              <input
                id="bank_account_type"
                type="text"
                value={bankForm.bank_account_type}
                onChange={handleBankChange("bank_account_type")}
                placeholder="e.g. Cheque"
              />
            </div>
          </div>

          <div className="set-field">
            <label htmlFor="bank_payment_reference_note">Payment reference note</label>
            <textarea
              id="bank_payment_reference_note"
              rows={3}
              value={bankForm.bank_payment_reference_note}
              onChange={handleBankChange("bank_payment_reference_note")}
              placeholder='Leave blank to default to: Please use "[invoice number]" as your payment reference.'
            />
          </div>

          <div className="set-card-footer">
            {bankDirty && !savingBank && <span className="set-unsaved">Unsaved changes</span>}
            <button type="submit" className="set-btn" disabled={savingBank || !bankDirty}>
              {savingBank ? <span className="set-spinner" /> : "Save changes"}
            </button>
          </div>
        </form>
      </div>

      {toast && (
        <div className={`set-toast set-toast--${toast.type}`} key={toast.key}>
          ✓ {toast.text}
        </div>
      )}
    </div>
  );
}

export default Settings;