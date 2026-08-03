import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../lib/supabaseClient";
import "./PayInvoice.css";

const FUNCTIONS_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1`;

// Same problem Billing.js has with subscription payments: the browser
// redirect back here can land before PayFast's separate, asynchronous ITN
// has actually reached payfast-invoice-notify and flipped the invoice to
// paid. So on `?payment=success` we poll for a short window until the
// status changes, rather than trusting the redirect alone.
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 30; // ~90 seconds total

function formatDueDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
}

function PayInvoice() {
  const { token } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollAttempts = useRef(0);

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

  useEffect(() => {
    if (searchParams.get("payment") !== "success") return;

    setPolling(true);
    setPollTimedOut(false);
    pollAttempts.current = 0;

    const interval = setInterval(async () => {
      pollAttempts.current += 1;

      const updated = await fetchInvoice();

      if (updated && updated.status === "paid") {
        setPolling(false);
        clearInterval(interval);
        setSearchParams({}, { replace: true });
        return;
      }

      if (pollAttempts.current >= POLL_MAX_ATTEMPTS) {
        setPolling(false);
        setPollTimedOut(true);
        clearInterval(interval);
        setSearchParams({}, { replace: true });
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleManualRefresh = async () => {
    await fetchInvoice();
    setPollTimedOut(false);
  };

  const handlePay = async () => {
    setError("");
    setRedirecting(true);

    try {
      const response = await fetch(`${FUNCTIONS_URL}/payfast-invoice-checkout?token=${token}`);

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `Checkout setup failed (${response.status})`);
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
      setRedirecting(false);
      setError(`Could not start payment: ${err.message}`);
    }
  };

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

          {polling && (
            <p className="pay-status pay-status--polling">
              Confirming your payment with PayFast — this can take a minute or so...
            </p>
          )}

          {pollTimedOut && !isPaid && (
            <p className="pay-status pay-status--warn">
              Still waiting to hear back from PayFast.{" "}
              <button className="pay-inline-link" onClick={handleManualRefresh}>
                Check again
              </button>
            </p>
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

          {error && <p className="pay-error">{error}</p>}

          {!isPaid && (
            <button className="pay-btn" onClick={handlePay} disabled={redirecting || polling}>
              {redirecting ? "Redirecting to PayFast..." : "Pay with PayFast"}
            </button>
          )}
        </div>

        <p className="pay-footnote">Payments are processed securely by PayFast.</p>
      </div>
    </div>
  );
}

export default PayInvoice;