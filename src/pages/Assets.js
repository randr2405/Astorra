/* eslint-disable react/no-unknown-property */
import { useState, useEffect, useCallback, useMemo, useRef, forwardRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, wrapEffect } from "@react-three/postprocessing";
import { Effect } from "postprocessing";
import * as THREE from "three";
import { supabase } from "../lib/supabaseClient";
import "./Assets.css";

const STATUS_OPTIONS = ["in_use", "in_storage", "maintenance", "retired"];
const STATUS_LABEL = {
  in_use: "In use",
  in_storage: "In storage",
  maintenance: "Maintenance",
  retired: "Retired",
};

const emptyForm = {
  name: "",
  category: "",
  serial_number: "",
  status: "in_use",
  assigned_staff_id: "",
  location: "",
  purchase_date: "",
  purchase_cost: "",
  next_maintenance_due: "",
  notes: "",
};

// ---------------------------------------------------------------------------
// Inlined "Dither" shader background (previously its own component + css
// file). Kept in this file so Assets.js / Assets.css are the only two files
// involved. Wave colour is set to the app's purple (--purple: #7c3aed) so it
// matches the navy/purple/blue/teal scheme instead of the original grey.
// ---------------------------------------------------------------------------

const ditherWaveVertexShader = `
precision highp float;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 modelPosition = modelMatrix * vec4(position, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;
  gl_Position = projectionMatrix * viewPosition;
}
`;

const ditherWaveFragmentShader = `
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289(vec4 x) { return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
vec2 fade(vec2 t) { return t*t*t*(t*(t*6.0-15.0)+10.0); }

float cnoise(vec2 P) {
  vec4 Pi = floor(P.xyxy) + vec4(0.0,0.0,1.0,1.0);
  vec4 Pf = fract(P.xyxy) - vec4(0.0,0.0,1.0,1.0);
  Pi = mod289(Pi);
  vec4 ix = Pi.xzxz;
  vec4 iy = Pi.yyww;
  vec4 fx = Pf.xzxz;
  vec4 fy = Pf.yyww;
  vec4 i = permute(permute(ix) + iy);
  vec4 gx = fract(i * (1.0/41.0)) * 2.0 - 1.0;
  vec4 gy = abs(gx) - 0.5;
  vec4 tx = floor(gx + 0.5);
  gx = gx - tx;
  vec2 g00 = vec2(gx.x, gy.x);
  vec2 g10 = vec2(gx.y, gy.y);
  vec2 g01 = vec2(gx.z, gy.z);
  vec2 g11 = vec2(gx.w, gy.w);
  vec4 norm = taylorInvSqrt(vec4(dot(g00,g00), dot(g01,g01), dot(g10,g10), dot(g11,g11)));
  g00 *= norm.x; g01 *= norm.y; g10 *= norm.z; g11 *= norm.w;
  float n00 = dot(g00, vec2(fx.x, fy.x));
  float n10 = dot(g10, vec2(fx.y, fy.y));
  float n01 = dot(g01, vec2(fx.z, fy.z));
  float n11 = dot(g11, vec2(fx.w, fy.w));
  vec2 fade_xy = fade(Pf.xy);
  vec2 n_x = mix(vec2(n00, n01), vec2(n10, n11), fade_xy.x);
  return 2.3 * mix(n_x.x, n_x.y, fade_xy.y);
}

const int OCTAVES = 4;
float fbm(vec2 p) {
  float value = 0.0;
  float amp = 1.0;
  float freq = waveFrequency;
  for (int i = 0; i < OCTAVES; i++) {
    value += amp * abs(cnoise(p));
    p *= freq;
    amp *= waveAmplitude;
  }
  return value;
}

float pattern(vec2 p) {
  vec2 p2 = p - time * waveSpeed;
  return fbm(p + fbm(p2));
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  uv -= 0.5;
  uv.x *= resolution.x / resolution.y;
  float f = pattern(uv);
  if (enableMouseInteraction == 1) {
    vec2 mouseNDC = (mousePos / resolution - 0.5) * vec2(1.0, -1.0);
    mouseNDC.x *= resolution.x / resolution.y;
    float dist = length(uv - mouseNDC);
    float effect = 1.0 - smoothstep(0.0, mouseRadius, dist);
    f -= 0.5 * effect;
  }
  vec3 col = mix(vec3(0.0), waveColor, f);
  gl_FragColor = vec4(col, 1.0);
}
`;

const ditherFragmentShader = `
precision highp float;
uniform float colorNum;
uniform float pixelSize;
const float bayerMatrix8x8[64] = float[64](
  0.0/64.0, 48.0/64.0, 12.0/64.0, 60.0/64.0,  3.0/64.0, 51.0/64.0, 15.0/64.0, 63.0/64.0,
  32.0/64.0,16.0/64.0, 44.0/64.0, 28.0/64.0, 35.0/64.0,19.0/64.0, 47.0/64.0, 31.0/64.0,
  8.0/64.0, 56.0/64.0,  4.0/64.0, 52.0/64.0, 11.0/64.0,59.0/64.0,  7.0/64.0, 55.0/64.0,
  40.0/64.0,24.0/64.0, 36.0/64.0, 20.0/64.0, 43.0/64.0,27.0/64.0, 39.0/64.0, 23.0/64.0,
  2.0/64.0, 50.0/64.0, 14.0/64.0, 62.0/64.0,  1.0/64.0,49.0/64.0, 13.0/64.0, 61.0/64.0,
  34.0/64.0,18.0/64.0, 46.0/64.0, 30.0/64.0, 33.0/64.0,17.0/64.0, 45.0/64.0, 29.0/64.0,
  10.0/64.0,58.0/64.0,  6.0/64.0, 54.0/64.0,  9.0/64.0,57.0/64.0,  5.0/64.0, 53.0/64.0,
  42.0/64.0,26.0/64.0, 38.0/64.0, 22.0/64.0, 41.0/64.0,25.0/64.0, 37.0/64.0, 21.0/64.0
);

vec3 dither(vec2 uv, vec3 color) {
  vec2 scaledCoord = floor(uv * resolution / pixelSize);
  int x = int(mod(scaledCoord.x, 8.0));
  int y = int(mod(scaledCoord.y, 8.0));
  float threshold = bayerMatrix8x8[y * 8 + x] - 0.25;
  float step = 1.0 / (colorNum - 1.0);
  color += threshold * step;
  float bias = 0.2;
  color = clamp(color - bias, 0.0, 1.0);
  return floor(color * (colorNum - 1.0) + 0.5) / (colorNum - 1.0);
}

void mainImage(in vec4 inputColor, in vec2 uv, out vec4 outputColor) {
  vec2 normalizedPixelSize = pixelSize / resolution;
  vec2 uvPixel = normalizedPixelSize * floor(uv / normalizedPixelSize);
  vec4 color = texture2D(inputBuffer, uvPixel);
  color.rgb = dither(uv, color.rgb);
  outputColor = color;
}
`;

class AssetsRetroEffectImpl extends Effect {
  constructor() {
    const uniforms = new Map([
      ["colorNum", new THREE.Uniform(4.0)],
      ["pixelSize", new THREE.Uniform(2.0)],
    ]);
    super("AssetsRetroEffect", ditherFragmentShader, { uniforms });
    this.uniforms = uniforms;
  }
  set colorNum(v) {
    this.uniforms.get("colorNum").value = v;
  }
  get colorNum() {
    return this.uniforms.get("colorNum").value;
  }
  set pixelSize(v) {
    this.uniforms.get("pixelSize").value = v;
  }
  get pixelSize() {
    return this.uniforms.get("pixelSize").value;
  }
}

const AssetsWrappedRetro = wrapEffect(AssetsRetroEffectImpl);

const AssetsRetroEffect = forwardRef((props, ref) => {
  const { colorNum, pixelSize } = props;
  return <AssetsWrappedRetro ref={ref} colorNum={colorNum} pixelSize={pixelSize} />;
});
AssetsRetroEffect.displayName = "AssetsRetroEffect";

function AssetsDitheredWaves({
  waveSpeed,
  waveFrequency,
  waveAmplitude,
  waveColor,
  colorNum,
  pixelSize,
  disableAnimation,
  enableMouseInteraction,
  mouseRadius,
}) {
  const mesh = useRef(null);
  const mouseRef = useRef(new THREE.Vector2());
  const { viewport, size, gl } = useThree();

  const waveUniformsRef = useRef({
    time: new THREE.Uniform(0),
    resolution: new THREE.Uniform(new THREE.Vector2(0, 0)),
    waveSpeed: new THREE.Uniform(waveSpeed),
    waveFrequency: new THREE.Uniform(waveFrequency),
    waveAmplitude: new THREE.Uniform(waveAmplitude),
    waveColor: new THREE.Uniform(new THREE.Color(...waveColor)),
    mousePos: new THREE.Uniform(new THREE.Vector2(0, 0)),
    enableMouseInteraction: new THREE.Uniform(enableMouseInteraction ? 1 : 0),
    mouseRadius: new THREE.Uniform(mouseRadius),
  });

  useEffect(() => {
    const dpr = gl.getPixelRatio();
    const w = Math.floor(size.width * dpr),
      h = Math.floor(size.height * dpr);
    const res = waveUniformsRef.current.resolution.value;
    if (res.x !== w || res.y !== h) {
      res.set(w, h);
    }
  }, [size, gl]);

  const prevColor = useRef([...waveColor]);
  useFrame(({ clock }) => {
    const u = waveUniformsRef.current;

    if (!disableAnimation) {
      u.time.value = clock.getElapsedTime();
    }

    if (u.waveSpeed.value !== waveSpeed) u.waveSpeed.value = waveSpeed;
    if (u.waveFrequency.value !== waveFrequency) u.waveFrequency.value = waveFrequency;
    if (u.waveAmplitude.value !== waveAmplitude) u.waveAmplitude.value = waveAmplitude;

    if (!prevColor.current.every((v, i) => v === waveColor[i])) {
      u.waveColor.value.set(...waveColor);
      prevColor.current = [...waveColor];
    }

    u.enableMouseInteraction.value = enableMouseInteraction ? 1 : 0;
    u.mouseRadius.value = mouseRadius;

    if (enableMouseInteraction) {
      u.mousePos.value.copy(mouseRef.current);
    }
  });

  const handlePointerMove = (e) => {
    if (!enableMouseInteraction) return;
    const rect = gl.domElement.getBoundingClientRect();
    const dpr = gl.getPixelRatio();
    mouseRef.current.set((e.clientX - rect.left) * dpr, (e.clientY - rect.top) * dpr);
  };

  return (
    <>
      <mesh ref={mesh} scale={[viewport.width, viewport.height, 1]}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          vertexShader={ditherWaveVertexShader}
          fragmentShader={ditherWaveFragmentShader}
          uniforms={waveUniformsRef.current}
        />
      </mesh>

      <EffectComposer>
        <AssetsRetroEffect colorNum={colorNum} pixelSize={pixelSize} />
      </EffectComposer>

      <mesh
        onPointerMove={handlePointerMove}
        position={[0, 0, 0.01]}
        scale={[viewport.width, viewport.height, 1]}
        visible={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </>
  );
}

// Purple/blue wave tint pulled from the page palette (--purple #7c3aed mixed
// toward --blue #3b82f6) instead of the original flat grey, so the effect
// reads as part of the navy/purple/blue/teal scheme.
function AssetsDitherBackground({
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  waveColor = [0.35, 0.25, 0.65],
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = true,
  mouseRadius = 0.3,
}) {
  return (
    <Canvas
      className="ast-dither-container"
      camera={{ position: [0, 0, 6] }}
      dpr={1}
      gl={{ antialias: true, preserveDrawingBuffer: true }}
    >
      <AssetsDitheredWaves
        waveSpeed={waveSpeed}
        waveFrequency={waveFrequency}
        waveAmplitude={waveAmplitude}
        waveColor={waveColor}
        colorNum={colorNum}
        pixelSize={pixelSize}
        disableAnimation={disableAnimation}
        enableMouseInteraction={enableMouseInteraction}
        mouseRadius={mouseRadius}
      />
    </Canvas>
  );
}

export default function Assets({ business }) {
  const [assets, setAssets] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name_asc");

  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const [selectedAsset, setSelectedAsset] = useState(null);
  const [maintenanceLog, setMaintenanceLog] = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [newLogEntry, setNewLogEntry] = useState({ description: "", cost: "", performed_at: "" });
  const [savingLog, setSavingLog] = useState(false);

  const [toast, setToast] = useState(null);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("assets")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!error) setAssets(data || []);
    setLoading(false);
  }, [business.id]);

  const loadStaff = useCallback(async () => {
    const { data } = await supabase
      .from("staff")
      .select("id, full_name")
      .eq("business_id", business.id)
      .order("full_name", { ascending: true });
    setStaffList(data || []);
  }, [business.id]);

  useEffect(() => {
    loadAssets();
    loadStaff();
  }, [loadAssets, loadStaff]);

  useEffect(() => {
    setMounted(true);
  }, []);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  function staffName(id) {
    return staffList.find((s) => s.id === id)?.full_name || "—";
  }

  function isOverdue(asset) {
    return (
      asset.next_maintenance_due &&
      asset.status !== "retired" &&
      new Date(asset.next_maintenance_due) < new Date(new Date().toDateString())
    );
  }

  const filteredAssets = useMemo(() => {
    let list = [...assets];

    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          (a.category || "").toLowerCase().includes(q) ||
          (a.serial_number || "").toLowerCase().includes(q) ||
          (a.location || "").toLowerCase().includes(q)
      );
    }

    switch (sortBy) {
      case "name_asc":
        list.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case "name_desc":
        list.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case "maintenance_due":
        list.sort((a, b) => {
          if (!a.next_maintenance_due) return 1;
          if (!b.next_maintenance_due) return -1;
          return new Date(a.next_maintenance_due) - new Date(b.next_maintenance_due);
        });
        break;
      case "newest":
        list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        break;
      default:
        break;
    }

    return list;
  }, [assets, search, statusFilter, sortBy]);

  const statusCounts = useMemo(() => {
    const counts = { all: assets.length };
    STATUS_OPTIONS.forEach((s) => {
      counts[s] = assets.filter((a) => a.status === s).length;
    });
    return counts;
  }, [assets]);

  function openAddModal() {
    setEditingAsset(null);
    setForm(emptyForm);
    setFormError("");
    setShowModal(true);
  }

  function openEditModal(asset) {
    setEditingAsset(asset);
    setForm({
      name: asset.name || "",
      category: asset.category || "",
      serial_number: asset.serial_number || "",
      status: asset.status || "in_use",
      assigned_staff_id: asset.assigned_staff_id || "",
      location: asset.location || "",
      purchase_date: asset.purchase_date || "",
      purchase_cost: asset.purchase_cost ?? "",
      next_maintenance_due: asset.next_maintenance_due || "",
      notes: asset.notes || "",
    });
    setFormError("");
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!form.name.trim()) {
      setFormError("Asset name is required.");
      return;
    }

    setSaving(true);
    setFormError("");

    const payload = {
      business_id: business.id,
      name: form.name.trim(),
      category: form.category.trim() || null,
      serial_number: form.serial_number.trim() || null,
      status: form.status,
      assigned_staff_id: form.assigned_staff_id || null,
      location: form.location.trim() || null,
      purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost === "" ? null : Number(form.purchase_cost),
      next_maintenance_due: form.next_maintenance_due || null,
      notes: form.notes.trim() || null,
    };

    let error;
    if (editingAsset) {
      ({ error } = await supabase.from("assets").update(payload).eq("id", editingAsset.id));
    } else {
      ({ error } = await supabase.from("assets").insert(payload));
    }

    setSaving(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setShowModal(false);
    showToast(editingAsset ? "Asset updated" : "Asset added");
    loadAssets();
  }

  async function handleDelete(id) {
    const { error } = await supabase.from("assets").delete().eq("id", id);
    setConfirmDeleteId(null);
    if (!error) {
      showToast("Asset removed");
      loadAssets();
      if (selectedAsset?.id === id) setSelectedAsset(null);
    }
  }

  async function openDetail(asset) {
    setSelectedAsset(asset);
    setNewLogEntry({ description: "", cost: "", performed_at: "" });
    setLogLoading(true);
    const { data } = await supabase
      .from("asset_maintenance_log")
      .select("*")
      .eq("asset_id", asset.id)
      .order("performed_at", { ascending: false });
    setMaintenanceLog(data || []);
    setLogLoading(false);
  }

  async function handleAddLogEntry(e) {
    e.preventDefault();
    if (!newLogEntry.description.trim()) return;

    setSavingLog(true);
    const { error } = await supabase.from("asset_maintenance_log").insert({
      asset_id: selectedAsset.id,
      description: newLogEntry.description.trim(),
      cost: newLogEntry.cost === "" ? null : Number(newLogEntry.cost),
      performed_at: newLogEntry.performed_at || new Date().toISOString().slice(0, 10),
    });
    setSavingLog(false);

    if (!error) {
      setNewLogEntry({ description: "", cost: "", performed_at: "" });
      const { data } = await supabase
        .from("asset_maintenance_log")
        .select("*")
        .eq("asset_id", selectedAsset.id)
        .order("performed_at", { ascending: false });
      setMaintenanceLog(data || []);
      showToast("Maintenance logged");
    }
  }

  return (
    <div className="ast-page">
      <div className="ast-dither-bg">
        <AssetsDitherBackground
          waveColor={[0.35, 0.25, 0.65]}
          disableAnimation={false}
          enableMouseInteraction
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.3}
          waveFrequency={3}
          waveSpeed={0.05}
        />
      </div>

      <div className="ast-body">
        <div className={`ast-header ${mounted ? "ast-in" : ""}`}>
          <div>
            <p className="ast-eyebrow">Operations</p>
            <h1 className="ast-heading">Assets</h1>
          </div>
          <button className="ast-add-btn" onClick={openAddModal}>
            + Add asset
          </button>
        </div>

        {!loading && assets.length === 0 ? (
          <div className={`ast-empty ${mounted ? "ast-in" : ""}`}>
            No assets yet.{" "}
            <button className="ast-inline-link" onClick={openAddModal}>
              Add your first one
            </button>
          </div>
        ) : (
          <>
            <div className={`ast-toolbar ${mounted ? "ast-in" : ""}`}>
              <div className="ast-filters">
                <button
                  className={`ast-filter-btn ${statusFilter === "all" ? "ast-filter-btn--active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All <span className="ast-filter-count">{statusCounts.all}</span>
                </button>
                {STATUS_OPTIONS.map((s) => (
                  <button
                    key={s}
                    className={`ast-filter-btn ${statusFilter === s ? "ast-filter-btn--active" : ""}`}
                    onClick={() => setStatusFilter(s)}
                  >
                    {STATUS_LABEL[s]} <span className="ast-filter-count">{statusCounts[s]}</span>
                  </button>
                ))}
              </div>

              <div className="ast-toolbar-right">
                <div className="ast-search">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <input
                    placeholder="Search assets..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button className="ast-search-clear" onClick={() => setSearch("")}>
                      ×
                    </button>
                  )}
                </div>
                <select className="ast-sort-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="name_asc">Name A–Z</option>
                  <option value="name_desc">Name Z–A</option>
                  <option value="maintenance_due">Maintenance due soonest</option>
                  <option value="newest">Newest first</option>
                </select>
              </div>
            </div>

            <div className={`ast-table-wrap ${mounted ? "ast-in" : ""}`}>
              {loading ? (
                <div className="ast-skeleton">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="ast-skeleton-row" style={{ animationDelay: `${i * 0.06}s` }} />
                  ))}
                </div>
              ) : (
                <table className="ast-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Category</th>
                      <th>Assigned to</th>
                      <th>Status</th>
                      <th>Next maintenance</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAssets.map((asset, i) => (
                      <tr
                        key={asset.id}
                        className="ast-row"
                        style={{ animationDelay: `${i * 0.03}s` }}
                        onClick={() => openDetail(asset)}
                      >
                        <td className="ast-name-cell">{asset.name}</td>
                        <td className="ast-muted">{asset.category || "—"}</td>
                        <td className="ast-muted">{staffName(asset.assigned_staff_id)}</td>
                        <td>
                          <span className={`ast-status ast-status--${asset.status}`}>
                            {STATUS_LABEL[asset.status]}
                          </span>
                        </td>
                        <td className={isOverdue(asset) ? "ast-overdue-cell" : "ast-muted"}>
                          {asset.next_maintenance_due || "—"}
                        </td>
                        <td className="ast-actions-cell" onClick={(e) => e.stopPropagation()}>
                          {confirmDeleteId === asset.id ? (
                            <div className="ast-confirm-row">
                              Delete?
                              <button className="ast-confirm-yes" onClick={() => handleDelete(asset.id)}>
                                Yes
                              </button>
                              <button className="ast-confirm-no" onClick={() => setConfirmDeleteId(null)}>
                                No
                              </button>
                            </div>
                          ) : (
                            <>
                              <button className="ast-action-btn" onClick={() => openEditModal(asset)}>
                                Edit
                              </button>
                              <button
                                className="ast-action-btn ast-action-btn--danger"
                                onClick={() => setConfirmDeleteId(asset.id)}
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

      {/* Add / edit modal */}
      {showModal && (
        <div className="ast-modal-overlay" onClick={() => setShowModal(false)}>
          <div className="ast-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{editingAsset ? "Edit asset" : "Add asset"}</h2>
            <form onSubmit={handleSave}>
              <label className="ast-label">Name</label>
              <input
                className="ast-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Bosch angle grinder"
              />

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Category</label>
                  <input
                    className="ast-input"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="e.g. Tool"
                  />
                </div>
                <div>
                  <label className="ast-label">Serial number</label>
                  <input
                    className="ast-input"
                    value={form.serial_number}
                    onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  />
                </div>
              </div>

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Status</label>
                  <select
                    className="ast-select"
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="ast-label">Assigned to</label>
                  <select
                    className="ast-select"
                    value={form.assigned_staff_id}
                    onChange={(e) => setForm({ ...form, assigned_staff_id: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="ast-label">Location</label>
              <input
                className="ast-input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="e.g. Main warehouse"
              />

              <div className="ast-row-2">
                <div>
                  <label className="ast-label">Purchase date</label>
                  <input
                    type="date"
                    className="ast-input"
                    value={form.purchase_date}
                    onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="ast-label">Purchase cost</label>
                  <input
                    type="number"
                    step="0.01"
                    className="ast-input"
                    value={form.purchase_cost}
                    onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                    placeholder="R"
                  />
                </div>
              </div>

              <label className="ast-label">Next maintenance due</label>
              <input
                type="date"
                className="ast-input"
                value={form.next_maintenance_due}
                onChange={(e) => setForm({ ...form, next_maintenance_due: e.target.value })}
              />

              <label className="ast-label">Notes</label>
              <textarea
                className="ast-textarea"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />

              {formError && <p className="ast-error">{formError}</p>}

              <div className="ast-modal-actions">
                <button type="button" className="ast-cancel-btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="ast-add-btn" disabled={saving}>
                  {saving ? <span className="ast-spinner" /> : editingAsset ? "Save changes" : "Add asset"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail drawer */}
      {selectedAsset && (
        <div className="ast-drawer-overlay" onClick={() => setSelectedAsset(null)}>
          <div className="ast-drawer" onClick={(e) => e.stopPropagation()}>
            <button className="ast-drawer-close" onClick={() => setSelectedAsset(null)}>
              ×
            </button>
            <h2>{selectedAsset.name}</h2>
            <p className="ast-drawer-sub">{selectedAsset.category || "Uncategorized"}</p>

            <div className="ast-meta-grid">
              <div className="ast-meta-item">
                <p className="ast-meta-label">Status</p>
                <p className="ast-meta-value">{STATUS_LABEL[selectedAsset.status]}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Assigned to</p>
                <p className="ast-meta-value">{staffName(selectedAsset.assigned_staff_id)}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Location</p>
                <p className="ast-meta-value">{selectedAsset.location || "—"}</p>
              </div>
              <div className="ast-meta-item">
                <p className="ast-meta-label">Next maintenance</p>
                <p className="ast-meta-value">{selectedAsset.next_maintenance_due || "—"}</p>
              </div>
            </div>

            <div className="ast-section-title">Maintenance log</div>

            <form onSubmit={handleAddLogEntry} style={{ marginBottom: 18 }}>
              <input
                className="ast-input"
                placeholder="What was done..."
                value={newLogEntry.description}
                onChange={(e) => setNewLogEntry({ ...newLogEntry, description: e.target.value })}
              />
              <div className="ast-row-2">
                <input
                  type="date"
                  className="ast-input"
                  value={newLogEntry.performed_at}
                  onChange={(e) => setNewLogEntry({ ...newLogEntry, performed_at: e.target.value })}
                />
                <input
                  type="number"
                  step="0.01"
                  className="ast-input"
                  placeholder="Cost (R)"
                  value={newLogEntry.cost}
                  onChange={(e) => setNewLogEntry({ ...newLogEntry, cost: e.target.value })}
                />
              </div>
              <button type="submit" className="ast-add-row-btn" disabled={savingLog}>
                {savingLog ? <span className="ast-spinner" /> : "+ Log entry"}
              </button>
            </form>

            <div className="ast-log-list">
              {logLoading ? (
                <p className="ast-log-empty">Loading...</p>
              ) : maintenanceLog.length === 0 ? (
                <p className="ast-log-empty">No maintenance logged yet.</p>
              ) : (
                maintenanceLog.map((entry) => (
                  <div key={entry.id} className="ast-log-item">
                    <div className="ast-log-item-top">
                      <span className="ast-log-desc">{entry.description}</span>
                      <span className="ast-log-date">{entry.performed_at}</span>
                    </div>
                    {entry.cost != null && <span className="ast-log-cost">R{Number(entry.cost).toFixed(2)}</span>}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className="ast-toast ast-toast--success">{toast}</div>}
    </div>
  );
}