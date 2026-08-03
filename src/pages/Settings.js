import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Settings.css";

function Settings({ business, appUser, onBusinessUpdate }) {
  const [form, setForm] = useState({
    bank_name: business?.bank_name || "",
    bank_account_holder: business?.bank_account_holder || "",
    bank_account_number: business?.bank_account_number || "",
    bank_branch_code: business?.bank_branch_code || "",
    bank_account_type: business?.bank_account_type || "",
    bank_payment_reference_note: business?.bank_payment_reference_note || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const handleChange = (field) => (e) => {
    setForm((prev) => ({ ...prev, [field]: e.target.value }));
    setSaved(false);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);

    // Empty strings stored as null so PayInvoice's hasBankingDetails
    // check (!!bank_account_number && !!bank_name) behaves correctly
    // rather than treating "" as present.
    const payload = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, value.trim() === "" ? null : value.trim()])
    );

    const { data, error: updateError } = await supabase
      .from("businesses")
      .update(payload)
      .eq("id", business.id)
      .select()
      .single();

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    if (onBusinessUpdate) onBusinessUpdate(data);
    notify(business.id, appUser?.id, "Banking details updated.");
    setSaved(true);
  };

  return (
    <div className="set-page">
      <AppNav business={business} />

      <div className="set-body">
        <p className="set-eyebrow">Settings</p>
        <h1 className="set-heading">Business details</h1>
        <p className="set-sub">
          These banking details appear on the payment page your customers see when they pay an
          invoice online.
        </p>

        {error && <p className="set-error">{error}</p>}
        {saved && <p className="set-success">Saved.</p>}

        <form className="set-card" onSubmit={handleSave}>
          <p className="set-card-heading">Payment details</p>

          <div className="set-field">
            <label htmlFor="bank_name">Bank</label>
            <input
              id="bank_name"
              type="text"
              value={form.bank_name}
              onChange={handleChange("bank_name")}
              placeholder="e.g. FNB"
            />
          </div>

          <div className="set-field">
            <label htmlFor="bank_account_holder">Account holder</label>
            <input
              id="bank_account_holder"
              type="text"
              value={form.bank_account_holder}
              onChange={handleChange("bank_account_holder")}
              placeholder="e.g. Astorra (Pty) Ltd"
            />
          </div>

          <div className="set-field">
            <label htmlFor="bank_account_number">Account number</label>
            <input
              id="bank_account_number"
              type="text"
              value={form.bank_account_number}
              onChange={handleChange("bank_account_number")}
            />
          </div>

          <div className="set-row">
            <div className="set-field">
              <label htmlFor="bank_branch_code">Branch code</label>
              <input
                id="bank_branch_code"
                type="text"
                value={form.bank_branch_code}
                onChange={handleChange("bank_branch_code")}
              />
            </div>

            <div className="set-field">
              <label htmlFor="bank_account_type">Account type</label>
              <input
                id="bank_account_type"
                type="text"
                value={form.bank_account_type}
                onChange={handleChange("bank_account_type")}
                placeholder="e.g. Cheque"
              />
            </div>
          </div>

          <div className="set-field">
            <label htmlFor="bank_payment_reference_note">Payment reference note</label>
            <textarea
              id="bank_payment_reference_note"
              rows={3}
              value={form.bank_payment_reference_note}
              onChange={handleChange("bank_payment_reference_note")}
              placeholder='Leave blank to default to: Please use "[invoice number]" as your payment reference.'
            />
          </div>

          <button type="submit" className="set-btn" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Settings;