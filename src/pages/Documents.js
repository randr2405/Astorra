import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import "./Documents.css";

function formatBytes(bytes) {
  if (!bytes) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function Documents({ business, appUser }) {
  const navigate = useNavigate();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

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

  const handleFileSelect = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setError("");

    if (file.size > 20 * 1024 * 1024) {
      return setError("File is too large. Max size is 20MB.");
    }

    setUploading(true);

    const filePath = `${business.id}/${Date.now()}-${file.name}`;

    const { error: uploadError } = await supabase.storage
      .from("documents")
      .upload(filePath, file);

    if (uploadError) {
      setUploading(false);
      return setError(uploadError.message);
    }

    const { error: insertError } = await supabase.from("documents").insert({
      business_id: business.id,
      name: file.name,
      storage_path: filePath,
      size_bytes: file.size,
    });

    if (insertError) {
      setUploading(false);
      return setError(insertError.message);
    }

    notify(business.id, appUser?.id, `"${file.name}" was uploaded to Documents.`);

    setUploading(false);
    e.target.value = "";
    fetchDocuments();
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

    const { error: storageError } = await supabase.storage
      .from("documents")
      .remove([doc.storage_path]);

    if (storageError) return setError(storageError.message);

    const { error: deleteError } = await supabase
      .from("documents")
      .delete()
      .eq("id", doc.id);

    if (!deleteError) fetchDocuments();
  };

  return (
    <div className="doc-page">
      <nav className="doc-nav">
        <div className="doc-nav-inner">
          <button className="doc-back" onClick={() => navigate("/dashboard")}>
            ← Dashboard
          </button>
          <span className="doc-wordmark">ASTORRA</span>
        </div>
      </nav>

      <div className="doc-body">
        <div className="doc-header">
          <div>
            <p className="doc-eyebrow">Documents</p>
            <h1 className="doc-heading">Your files</h1>
          </div>
          <label className="doc-add-btn">
            {uploading ? "Uploading..." : "+ Upload file"}
            <input
              type="file"
              onChange={handleFileSelect}
              disabled={uploading}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {error && <p className="doc-error">{error}</p>}

        {loading ? (
          <p className="doc-muted">Loading...</p>
        ) : documents.length === 0 ? (
          <div className="doc-empty">No documents yet. Upload your first one to get started.</div>
        ) : (
          <div className="doc-table-wrap">
            <table className="doc-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="doc-name-cell">{doc.name}</td>
                    <td className="doc-muted">{formatBytes(doc.size_bytes)}</td>
                    <td className="doc-muted">
                      {new Date(doc.created_at).toLocaleDateString("en-ZA")}
                    </td>
                    <td>
                      <div className="doc-actions-cell">
                        <button className="doc-action-btn" onClick={() => handleDownload(doc)}>
                          Download
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Documents;