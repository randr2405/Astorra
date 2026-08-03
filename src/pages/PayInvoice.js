import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./PayInvoice.css";

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function PayInvoice() {
  const { token } = useParams();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const fetchInvoice = useCallback(async () => {
    const { data, error: rpcError } = await supabase
      .rpc("get_invoice_by_token", { p_token: token })
      .maybeSingle();

    if (rpcError || !data) {
      setNotFound(true);
      setLoading(false);
      return null;
    }

    setInvoice(data);
    setLoading(false);
    return data;
  }, [token]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  if (loading) {
    return (
      <div className="pay-page">
        <div className="pay-body">
          <p className="pay-muted">Loading invoice...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="pay-page">
        <div className="pay-body">
          <div className="pay-card">
            <p className="pay-eyebrow">Invoice</p>
            <h1 className="pay-heading">We couldn't find this invoice</h1>
            <p className="pay-sub">
              The payment link may be incorrect or the invoice may have been removed. Please
              check the link in your email, or contact the business directly.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const dueDate = formatDueDate(invoice.due_date);
  const isPaid = invoice.status === "paid";
  const hasBankingDetails = !!(invoice.bank_account_number && invoice.bank_name);

  return (
    <div className="pay-page">
      <div className="pay-body">
        <p className="pay-wordmark">ASTORRA</p>

        <div className="pay-card">
          <p className="pay-eyebrow">{invoice.business_name}</p>
          <h1 className="pay-heading">Invoice {invoice.invoice_number}</h1>
          {invoice.customer_name && (
            <p className="pay-sub">Billed to {invoice.customer_name}</p>
          )}

          {isPaid && <p className="pay-status pay-status--paid">✓ This invoice has been paid.</p>}

          <div className="pay-line-items">
            {(invoice.line_items || []).map((item, i) => (
              <div className="pay-line-item" key={i}>
                <div className="pay-line-item-desc">
                  <span>{item.description}</span>
                  <span className="pay-muted">
                    {item.quantity} × R{Number(item.unit_price).toFixed(2)}
                  </span>
                </div>
                <span className="pay-line-item-total">
                  R{(Number(item.quantity) * Number(item.unit_price)).toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          <div className="pay-total-row">
            <span>Total due</span>
            <span className="pay-total-amount">R{Number(invoice.total).toFixed(2)}</span>
          </div>

          {dueDate && !isPaid && (
            <p className="pay-due-date">Due {dueDate}</p>
          )}

          {!isPaid && (
            <div className="pay-bank-details">
              <p className="pay-bank-details-heading">Payment details</p>
              {hasBankingDetails ? (
                <>
                  <div className="pay-bank-row">
                    <span className="pay-muted">Bank</span>
                    <span>{invoice.bank_name}</span>
                  </div>
                  <div className="pay-bank-row">
                    <span className="pay-muted">Account holder</span>
                    <span>{invoice.bank_account_holder}</span>
                  </div>
                  <div className="pay-bank-row">
                    <span className="pay-muted">Account number</span>
                    <span>{invoice.bank_account_number}</span>
                  </div>
                  {invoice.bank_branch_code && (
                    <div className="pay-bank-row">
                      <span className="pay-muted">Branch code</span>
                      <span>{invoice.bank_branch_code}</span>
                    </div>
                  )}
                  {invoice.bank_account_type && (
                    <div className="pay-bank-row">
                      <span className="pay-muted">Account type</span>
                      <span>{invoice.bank_account_type}</span>
                    </div>
                  )}
                  <p className="pay-bank-reference">
                    {invoice.bank_payment_reference_note ||
                      `Please use "${invoice.invoice_number}" as your payment reference.`}
                  </p>
                </>
              ) : (
                <p className="pay-sub">
                  This business hasn't added their payment details yet. Please contact them
                  directly to arrange payment.
                </p>
              )}
            </div>
          )}
        </div>

        <p className="pay-footnote">Please allow 1–2 business days for EFT payments to reflect.</p>
      </div>
    </div>
  );
}

export default PayInvoice;