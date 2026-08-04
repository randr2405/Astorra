import { useState, useRef } from "react";
import { supabase } from "../lib/supabaseClient";
import { notify } from "../lib/notifications";
import AppNav from "../components/AppNav";
import "./Settings.css";

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