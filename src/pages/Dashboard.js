import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Documents.css";

const UNCATEGORIZED = "Uncategorized";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

function formatBytes(bytes) {
  if (!bytes) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function extOf(name) {
  const parts = (name || "").split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function isImageFile(doc) {
  if (doc.mime_type) return doc.mime_type.startsWith("image/");
  return ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(extOf(doc.name));
}

function isPdfFile(doc) {
  if (doc.mime_type) return doc.mime_type === "application/pdf";
  return extOf(doc.name) === "pdf";
}

function fileTypeMeta(doc) {
  const ext = extOf(doc.name);
  if (isImageFile(doc)) return { label: "IMG", className: "doc-type--img" };
  if (isPdfFile(doc)) return { label: "PDF", className: "doc-type--pdf" };
  if (["doc", "docx"].includes(ext)) return { label: "DOC", className: "doc-type--doc" };
  if (["xls", "xlsx", "csv"].includes(ext)) return { label: "XLS", className: "doc-type--xls" };
  if (["ppt", "pptx"].includes(ext)) return { label: "PPT", className: "doc-type--ppt" };
  if (["zip", "rar", "7z"].includes(ext)) return { label: "ZIP", className: "doc-type--zip" };
  return { label: ext ? ext.slice(0, 4).toUpperCase() : "FILE", className: "doc-type--generic" };
}

function Documents({ business, appUser }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // { done, total }
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);

  // Search / filter / sort
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sortKey, setSortKey] = useState("created_at");
  const [sortDir, setSortDir] = useState("desc");

  // Edit modal
  const [editingDoc, setEditingDoc] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", category: "", description: "" });
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Preview modal
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fileInputRef = useRef(null);

  const fetchDocuments = useCallback(async () => {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from("documents")
      .select("*")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false });

    if (!fetchError) setDocuments(data || []);
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const uploadFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setError("");

    const tooLarge = files.filter((f) => f.size > MAX_FILE_BYTES);
    const validFiles = files.filter((f) => f.size <= MAX_FILE_BYTES);

    if (tooLarge.length > 0) {
      setError(
        `${tooLarge.length} file${tooLarge.length > 1 ? "s were" : " was"} skipped for exceeding 20MB: ${tooLarge
          .map((f) => f.name)
          .join(", ")}`
      );
    }

    if (validFiles.length === 0) return;

    setUploading(true);
    setUploadProgress({ done: 0, total: validFiles.length });

    let uploadedCount = 0;

    for (const file of validFiles) {
      const filePath = `${business.id}/${Date.now()}-${file.name}`;

      const { error: uploadError } = await supabase.storage.from("documents").upload(filePath, file);

      if (uploadError) {
        setError((prev) => (prev ? `${prev} · ${file.name}: ${uploadError.message}` : `${file.name}: ${uploadError.message}`));
        setUploadProgress((prev) => ({ ...prev, done: prev.done + 1 }));
        continue;
      }

      const { error: insertError } = await supabase.from("documents").insert({
        business_id: business.id,
        name: file.name,
        storage_path: filePath,
        size_bytes: file.size,
        mime_type: file.type || null,
      });

      if (insertError) {
        setError((prev) => (prev ? `${prev} · ${file.name}: ${insertError.message}` : `${file.name}: ${insertError.message}`));
      } else {
        uploadedCount += 1;
      }

      setUploadProgress((prev) => ({ ...prev, done: prev.done + 1 }));
    }

    if (uploadedCount > 0) {
      notify(
        business.id,
        appUser?.id,
        uploadedCount === 1
          ? `"${validFiles[0].name}" was uploaded to Documents.`
          : `${uploadedCount} files were uploaded to Documents.`
      );
    }

    setUploading(false);
    setUploadProgress(null);
    fetchDocuments();
  };

  const handleFileSelect = async (e) => {
    await uploadFiles(e.target.files);
    e.target.value = "";
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragActive(false);
    await uploadFiles(e.dataTransfer.files);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragActive(false);
  };

  const handleDownload = async (doc) => {
    const { data, error: downloadError } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60);

    if (downloadError) {
      return setError(downloadError.message);
    }

    window.open(data.signedUrl, "_blank");
  };

  const handleDelete = async (doc) => {
    if (!window.confirm(`Delete "${doc.name}"? This can't be undone.`)) return;

    const { error: storageError } = await supabase.storage.from("documents").remove([doc.storage_path]);

    if (storageError) return setError(storageError.message);

    const { error: deleteError } = await supabase.from("documents").delete().eq("id", doc.id);

    if (!deleteError) fetchDocuments();
  };

  // ---------- Edit (category / description / display name) ----------
  const openEdit = (doc) => {
    setEditingDoc(doc);
    setEditForm({
      name: doc.name || "",
      category: doc.category || "",
      description: doc.description || "",
    });
    setEditError("");
  };

  const closeEdit = () => {
    setEditingDoc(null);
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      setEditError("Enter a file name.");
      return;
    }
    setSavingEdit(true);
    setEditError("");

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        name: editForm.name.trim(),
        category: editForm.category.trim() || null,
        description: editForm.description.trim() || null,
      })
      .eq("id", editingDoc.id);

    setSavingEdit(false);

    if (updateError) {
      setEditError(updateError.message);
      return;
    }

    closeEdit();
    fetchDocuments();
  };

  // ---------- Preview ----------
  const canPreview = (doc) => isImageFile(doc) || isPdfFile(doc);

  const openPreview = async (doc) => {
    setPreviewDoc(doc);
    setPreviewUrl(null);
    setPreviewLoading(true);

    const { data, error: previewError } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 300);

    setPreviewLoading(false);

    if (previewError) {
      setError(previewError.message);
      setPreviewDoc(null);
      return;
    }

    setPreviewUrl(data.signedUrl);
  };

  const closePreview = () => {
    setPreviewDoc(null);
    setPreviewUrl(null);
  };

  // ---------- Derived: categories, filtering, sorting ----------
  const categories = useMemo(() => {
    const set = new Set();
    documents.forEach((d) => set.add(d.category?.trim() || UNCATEGORIZED));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [documents]);

  const filteredDocuments = useMemo(() => {
    const q = search.trim().toLowerCase();
    let result = documents.filter((d) => {
      const docCategory = d.category?.trim() || UNCATEGORIZED;
      if (categoryFilter !== "all" && docCategory !== categoryFilter) return false;
      if (q && !d.name?.toLowerCase().includes(q)) return false;
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
        case "size_bytes":
          av = a.size_bytes || 0;
          bv = b.size_bytes || 0;
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
  }, [documents, search, categoryFilter, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIndicator = (key) => {
    if (sortKey !== key) return null;
    return <span className={`doc-sort-arrow ${sortDir}`}>▲</span>;
  };

  const hasActiveFilters = search.trim() || categoryFilter !== "all";
  const clearFilters = () => {
    setSearch("");
    setCategoryFilter("all");
  };

  return (
    <div className="doc-page">
      <AppNav business={business} />

      <div className="doc-body">
        <div className="doc-header">
          <div>
            <p className="doc-eyebrow">Documents</p>
            <h1 className="doc-heading">Your files</h1>
          </div>
          <button
            className="doc-add-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? uploadProgress
                ? `Uploading ${uploadProgress.done}/${uploadProgress.total}...`
                : "Uploading..."
              : "+ Upload files"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="doc-hidden-input"
            onChange={handleFileSelect}
            disabled={uploading}
          />
        </div>

        <div
          className={`doc-dropzone ${dragActive ? "doc-dropzone--active" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="doc-dropzone-icon">
            <path
              d="M12 16V4M12 4l-4 4M12 4l4 4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <p className="doc-dropzone-text">
            {dragActive ? "Drop files to upload" : "Drag files here, or click to browse"}
          </p>
          <p className="doc-dropzone-sub">Multiple files supported · 20MB max per file</p>
        </div>

        {error && (
          <p className="doc-error doc-error--banner">
            {error}
            <button className="doc-banner-dismiss" onClick={() => setError("")}>
              ×
            </button>
          </p>
        )}

        <div className="doc-toolbar">
          <div className="doc-search-wrap">
            <svg className="doc-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              className="doc-search-input"
              placeholder="Search by filename..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="doc-select"
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

          {hasActiveFilters && (
            <button className="doc-clear-filters" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </div>

        {loading ? (
          <div className="doc-skeleton">
            {[0, 1, 2, 3].map((i) => (
              <div className="doc-skeleton-row" key={i} style={{ animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="doc-empty">
            <p>No documents yet.</p>
            <p className="doc-empty-sub">Drag a file above or click to upload your first one.</p>
          </div>
        ) : filteredDocuments.length === 0 ? (
          <div className="doc-empty">
            <p>No documents match your filters.</p>
            <button className="doc-clear-filters" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        ) : (
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="doc-th-sortable" onClick={() => toggleSort("name")}>
                    Name {sortIndicator("name")}
                  </th>
                  <th>Category</th>
                  <th className="doc-th-sortable" onClick={() => toggleSort("size_bytes")}>
                    Size {sortIndicator("size_bytes")}
                  </th>
                  <th className="doc-th-sortable" onClick={() => toggleSort("created_at")}>
                    Uploaded {sortIndicator("created_at")}
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc, idx) => {
                  const type = fileTypeMeta(doc);
                  return (
                    <tr
                      key={doc.id}
                      className="doc-row"
                      style={{ animationDelay: `${Math.min(idx, 12) * 0.03}s` }}
                    >
                      <td>
                        <span className={`doc-type-badge ${type.className}`}>{type.label}</span>
                      </td>
                      <td className="doc-name-cell">
                        {doc.name}
                        {doc.description && <p className="doc-description">{doc.description}</p>}
                      </td>
                      <td>
                        <span className="doc-category-pill">{doc.category?.trim() || UNCATEGORIZED}</span>
                      </td>
                      <td className="doc-muted">{formatBytes(doc.size_bytes)}</td>
                      <td className="doc-muted">{new Date(doc.created_at).toLocaleDateString("en-ZA")}</td>
                      <td>
                        <div className="doc-actions-cell">
                          {canPreview(doc) && (
                            <button className="doc-action-btn" onClick={() => openPreview(doc)}>
                              Preview
                            </button>
                          )}
                          <button className="doc-action-btn" onClick={() => handleDownload(doc)}>
                            Download
                          </button>
                          <button className="doc-action-btn" onClick={() => openEdit(doc)}>
                            Edit
                          </button>
                          <button
                            className="doc-action-btn doc-action-btn--danger"
                            onClick={() => handleDelete(doc)}
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

      {editingDoc && (
        <div className="doc-modal-overlay" onClick={closeEdit}>
          <div className="doc-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Edit document</h2>
            <form onSubmit={saveEdit}>
              <label className="doc-label">File name</label>
              <input
                className="doc-input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                required
              />

              <label className="doc-label">Category</label>
              <input
                className="doc-input"
                placeholder="e.g. Contracts, Invoices, HR"
                value={editForm.category}
                onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                list="doc-category-options"
              />
              <datalist id="doc-category-options">
                {categories
                  .filter((c) => c !== UNCATEGORIZED)
                  .map((c) => (
                    <option key={c} value={c} />
                  ))}
              </datalist>

              <label className="doc-label">Description / notes</label>
              <textarea
                className="doc-input doc-textarea"
                placeholder="Optional notes about this file"
                rows={3}
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              />

              {editError && <p className="doc-error">{editError}</p>}

              <div className="doc-modal-actions">
                <button type="button" className="doc-cancel-btn" onClick={closeEdit}>
                  Cancel
                </button>
                <button type="submit" className="doc-add-btn" disabled={savingEdit}>
                  {savingEdit ? "Saving..." : "Save changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {previewDoc && (
        <div className="doc-preview-overlay" onClick={closePreview}>
          <div className="doc-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="doc-preview-header">
              <p className="doc-preview-title">{previewDoc.name}</p>
              <div className="doc-preview-header-actions">
                <button className="doc-action-btn" onClick={() => handleDownload(previewDoc)}>
                  Download
                </button>
                <button className="doc-preview-close" onClick={closePreview} aria-label="Close preview">
                  ×
                </button>
              </div>
            </div>
            <div className="doc-preview-body">
              {previewLoading ? (
                <p className="doc-muted">Loading preview...</p>
              ) : previewUrl ? (
                isImageFile(previewDoc) ? (
                  <img className="doc-preview-image" src={previewUrl} alt={previewDoc.name} />
                ) : (
                  <iframe className="doc-preview-iframe" src={previewUrl} title={previewDoc.name} />
                )
              ) : (
                <p className="doc-muted">Couldn't load preview.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Documents;