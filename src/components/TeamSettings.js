import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import "./TeamSettings.css";

// Must match REACT_APP_SUPABASE_URL's project ref — Edge Functions live at
// <SUPABASE_URL>/functions/v1/<function-name>.
const FUNCTIONS_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

const STAFF_SEAT_PRICE = 79; // R79 once-off per staff member, matches payfast-checkout

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
        .from("staff_invites")
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

  // Every staff member beyond the owner costs a once-off R79 fee, paid via
  // PayFast. The invite itself isn't created here at all — it only gets
  // created by payfast-notify once the payment actually confirms, so
  // there's no "unpaid ghost invite" state to manage client-side.
  const handleStartSeatCheckout = async (e) => {
    e.preventDefault();
    setInviteError("");

    if (!inviteEmail) {
      setInviteError("Please enter an email address.");
      return;
    }

    const alreadyStaff = staff.some((m) => m.email?.toLowerCase() === inviteEmail.toLowerCase());
    const alreadyInvited = invites.some((i) => i.email?.toLowerCase() === inviteEmail.toLowerCase());

    if (alreadyStaff) {
      setInviteError("This person is already on your team.");
      return;
    }
    if (alreadyInvited) {
      setInviteError("This email already has a pending invite.");
      return;
    }

    setInviteSubmitting(true);

    try {
      const params = new URLSearchParams({
        business_id: business.id,
        type: "seat",
        invite_email: inviteEmail,
        invite_role: inviteRole,
      });

      const response = await fetch(`${FUNCTIONS_URL}/payfast-checkout?${params.toString()}`);

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
      // Browser navigates away to PayFast here, so no need to reset
      // inviteSubmitting — the component unmounts.
    } catch (err) {
      setInviteSubmitting(false);
      setInviteError(`Could not start checkout: ${err.message}`);
    }
  };

  const handleRevoke = async (inviteId) => {
    setRevokingId(inviteId);
    try {
      const { error: updateError } = await supabase
        .from("staff_invites")
        .update({ status: "revoked" })
        .eq("id", inviteId);

      if (updateError) throw updateError;
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
          <p className="ts-subtitle">
            Manage who has access to your Astorra dashboard. Adding a staff member is a once-off
            R{STAFF_SEAT_PRICE} fee, paid via PayFast.
          </p>
        </div>
        <button className="ts-btn ts-btn--primary" onClick={() => setShowInviteForm((v) => !v)}>
          {showInviteForm ? "Cancel" : "Invite staff"}
        </button>
      </div>

      {error && <p className="ts-error">{error}</p>}

      {showInviteForm && (
        <form className="ts-invite-form" onSubmit={handleStartSeatCheckout}>
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
                <option value="hr">HR</option>
                <option value="finance">Finance</option>
                <option value="reception">Reception</option>
              </select>
            </div>
          </div>

          {inviteError && <p className="ts-error">{inviteError}</p>}

          <button className="ts-btn ts-btn--primary" type="submit" disabled={inviteSubmitting}>
            {inviteSubmitting ? <span className="ts-spinner" /> : `Pay R${STAFF_SEAT_PRICE} & send invite`}
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