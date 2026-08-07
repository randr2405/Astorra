import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import "./TeamSettings.css";

function TeamSettings({ business, appUser }) {
  const [staff, setStaff] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const [revokingId, setRevokingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");

    const [staffRes, invitesRes] = await Promise.all([
      supabase
        .from("users")
        .select("*")
        .eq("business_id", business.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("invites")
        .select("*")
        .eq("business_id", business.id)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
    ]);

    if (staffRes.error || invitesRes.error) {
      setError("Couldn't load team data. Please refresh and try again.");
    } else {
      setStaff(staffRes.data || []);
      setInvites(invitesRes.data || []);
    }
    setLoading(false);
  }, [business.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateInvite = async (e) => {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviteSubmitting(true);

    try {
      const { data: token, error: rpcError } = await supabase.rpc("create_staff_invite", {
        p_email: inviteEmail,
        p_role: inviteRole,
      });

      if (rpcError) throw rpcError;

      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      const { error: fnError } = await supabase.functions.invoke("send-staff-invite", {
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          toEmail: inviteEmail,
          businessName: business.name,
          role: inviteRole,
          inviteToken: token,
        },
      });

      if (fnError) {
        setInviteSuccess(
          "Invite created, but the email couldn't be sent. Copy the link below and share it manually."
        );
      } else {
        setInviteSuccess("Invite sent!");
      }

      setInviteEmail("");
      setInviteRole("staff");
      await loadData();
    } catch (err) {
      setInviteError(
        err.message?.includes("already")
          ? "This email already has a pending invite or is already on your team."
          : "Something went wrong creating the invite. Please try again."
      );
    } finally {
      setInviteSubmitting(false);
    }
  };

  const handleRevoke = async (inviteId) => {
    setRevokingId(inviteId);
    try {
      const { error: rpcError } = await supabase.rpc("revoke_staff_invite", {
        p_invite_id: inviteId,
      });
      if (rpcError) throw rpcError;
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    } catch {
      setError("Couldn't revoke that invite. Please try again.");
    } finally {
      setRevokingId(null);
    }
  };

  if (loading) {
    return (
      <div className="ts-section">
        <div className="ts-spinner ts-spinner--lg" />
      </div>
    );
  }

  return (
    <div className="ts-section">
      <div className="ts-header">
        <div>
          <h2 className="ts-title">Team</h2>
          <p className="ts-subtitle">Manage who has access to your Astorra dashboard.</p>
        </div>
        <button className="ts-btn ts-btn--primary" onClick={() => setShowInviteForm((v) => !v)}>
          {showInviteForm ? "Cancel" : "Invite staff"}
        </button>
      </div>

      {error && <p className="ts-error">{error}</p>}

      {showInviteForm && (
        <form className="ts-invite-form" onSubmit={handleCreateInvite}>
          <div className="ts-form-row">
            <div className="ts-form-field">
              <label className="ts-label" htmlFor="ts-email">
                Email
              </label>
              <input
                id="ts-email"
                type="email"
                className="ts-input"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="ts-form-field ts-form-field--narrow">
              <label className="ts-label" htmlFor="ts-role">
                Role
              </label>
              <select
                id="ts-role"
                className="ts-input"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                <option value="staff">Staff</option>
                <option value="manager">Manager</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          {inviteError && <p className="ts-error">{inviteError}</p>}
          {inviteSuccess && <p className="ts-success">{inviteSuccess}</p>}

          <button className="ts-btn ts-btn--primary" type="submit" disabled={inviteSubmitting}>
            {inviteSubmitting ? <span className="ts-spinner" /> : "Send invite"}
          </button>
        </form>
      )}

      <div className="ts-list-block">
        <h3 className="ts-list-heading">Current staff ({staff.length})</h3>
        <div className="ts-list">
          {staff.map((member) => (
            <div className="ts-row" key={member.id}>
              <div className="ts-row-main">
                <span className="ts-row-name">
                  {member.email}
                  {member.id === appUser?.id && <span className="ts-badge ts-badge--you">You</span>}
                </span>
                <span className="ts-row-sub">{member.role}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="ts-list-block">
        <h3 className="ts-list-heading">Pending invites ({invites.length})</h3>
        {invites.length === 0 ? (
          <p className="ts-muted">No pending invites.</p>
        ) : (
          <div className="ts-list">
            {invites.map((invite) => (
              <div className="ts-row" key={invite.id}>
                <div className="ts-row-main">
                  <span className="ts-row-name">{invite.email}</span>
                  <span className="ts-row-sub">{invite.role}</span>
                </div>
                <button
                  className="ts-btn ts-btn--ghost ts-btn--sm"
                  onClick={() => handleRevoke(invite.id)}
                  disabled={revokingId === invite.id}
                >
                  {revokingId === invite.id ? <span className="ts-spinner" /> : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default TeamSettings;