// GET /functions/v1/payfast-invoice-checkout?token=<public_token>
//
// Builds signed PayFast fields for a ONCE-OFF payment against a single
// invoice, looked up by its public_token — not business_id/plan like
// payfast-checkout, since the person paying here is the business's
// customer, not an Astorra account holder. No Firebase/Supabase auth
// required or possible; safety comes from the token being an unguessable
// uuid and get_invoice_for_checkout only ever returning one row per exact
// match (see invoice_payments_harden_rls.sql).
//
// Mirrors payfast-checkout.ts's conventions exactly: same shared signing
// module, same SITE_URL env var, same "JSON fields back to the calling
// React app, which builds and submits the real form" pattern (Supabase's
// edge runtime can't serve an HTML auto-submit page directly).
//
// Unlike payfast-checkout, this is a once-off payment — no
// subscription_type/recurring_amount/frequency/cycles fields.

import { createClient } from "npm:@supabase/supabase-js@2";
import { generateSignature, PAYFAST_HOST } from "../_shared/payfast.ts";

const MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID")!;
const MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SITE_URL = Deno.env.get("SITE_URL")!; // e.g. https://app.astorra.co.za
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return new Response("Missing token.", { status: 400 });
  }

  const { data: invoiceRows, error: rpcError } = await supabase
    .rpc("get_invoice_for_checkout", { p_token: token });

  if (rpcError) {
    return new Response(rpcError.message, { status: 500 });
  }

  const invoice = invoiceRows?.[0];

  if (!invoice) {
    return new Response("Invoice not found.", { status: 404 });
  }

  if (invoice.status === "paid") {
    return new Response("This invoice has already been paid.", { status: 409 });
  }

  // m_payment_id carries the public_token through PayFast and back via the
  // ITN, mirroring how payfast-checkout encodes businessId/plan into its
  // own m_payment_id — so payfast-invoice-notify can look the invoice back
  // up the same safe way, without trusting anything else in the callback.
  const mPaymentId = `${token}:${Date.now()}`;

  // Order matters here — it must match the order used when generating the
  // signature, per PayFast's documented field order. No subscription
  // fields: this is a once-off payment, not a recurring plan.
  const orderedEntries: [string, string][] = [
    ["merchant_id", MERCHANT_ID],
    ["merchant_key", MERCHANT_KEY],
    ["return_url", `${SITE_URL}/pay/${token}?payment=success`],
    ["cancel_url", `${SITE_URL}/pay/${token}?payment=cancelled`],
    ["notify_url", `${SUPABASE_URL}/functions/v1/payfast-invoice-notify`],
    ["m_payment_id", mPaymentId],
    ["amount", Number(invoice.total).toFixed(2)],
    ["item_name", `Invoice ${invoice.invoice_number}`],
    ["item_description", `Payment for invoice ${invoice.invoice_number}`],
    ["custom_str1", token],
  ];

  const signature = generateSignature(orderedEntries, PASSPHRASE);

  const fields = Object.fromEntries(orderedEntries.filter(([, v]) => v !== ""));
  fields.signature = signature;

  return new Response(
    JSON.stringify({
      action: `https://${PAYFAST_HOST}/eng/process`,
      fields,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
});