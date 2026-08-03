// POST /functions/v1/payfast-invoice-notify
//
// PayFast's server calls this directly (server-to-server) after a once-off
// invoice payment succeeds. Mirrors payfast-notify.ts's verification and
// idempotency pattern exactly — this is the ONLY place an invoice's status
// should actually flip to "paid", never the checkout return_url redirect
// alone, since that browser round-trip can be interrupted or spoofed.
//
// Unlike payfast-notify (which updates businesses.plan for a subscription),
// this updates a single invoice's status and records the payment. There is
// no recurring token to store — invoice payments are once-off.
//
// Must respond fast with a 200, and PayFast expects no particular body.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyItnSignature, confirmWithPayFast } from "../_shared/payfast.ts";

const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();
  const params = new URLSearchParams(rawBody);
  const bodyEntries: [string, string][] = Array.from(params.entries());
  const data = Object.fromEntries(bodyEntries);

  // 1. Signature check
  if (!verifyItnSignature(bodyEntries, PASSPHRASE)) {
    console.error("PayFast invoice ITN: signature mismatch", data.m_payment_id);
    return new Response("Invalid signature", { status: 400 });
  }

  // 2. Server-to-server confirmation with PayFast itself
  const confirmed = await confirmWithPayFast(rawBody);
  if (!confirmed) {
    console.error("PayFast invoice ITN: could not confirm with PayFast", data.m_payment_id);
    return new Response("Could not confirm", { status: 400 });
  }

  // custom_str1 carries the invoice's public_token, set in
  // payfast-invoice-checkout — never trust invoice/business ids directly
  // out of the ITN body, always resolve back through the token.
  const token = data.custom_str1;
  const status = data.payment_status; // "COMPLETE", "FAILED", "CANCELLED", etc.
  const pfPaymentId = data.pf_payment_id;
  const amount = data.amount_gross || data.amount || "0";

  if (!token) {
    console.error("PayFast invoice ITN: missing custom_str1 (token)", data);
    return new Response("Missing invoice reference", { status: 400 });
  }

  // Service-role key bypasses RLS entirely, so this can look the invoice
  // up directly by public_token here — no need to go through the anon-safe
  // RPCs used by the public pay page/checkout function.
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("id, business_id, invoice_number, status")
    .eq("public_token", token)
    .maybeSingle();

  if (invoiceError) {
    console.error("PayFast invoice ITN: invoice lookup failed for token", token, invoiceError);
    return new Response("Invoice lookup failed", { status: 500 });
  }

  if (!invoice) {
    console.error("PayFast invoice ITN: no invoice found for token", token);
    return new Response("Invoice not found", { status: 404 });
  }

  // 3. Idempotency — PayFast can and will retry ITNs. If we've already
  // recorded this pf_payment_id, just acknowledge and stop.
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("payfast_payment_id", pfPaymentId)
    .maybeSingle();

  if (existing) {
    return new Response("OK", { status: 200 });
  }

  await supabase.from("payments").insert({
    business_id: invoice.business_id,
    invoice_id: invoice.id,
    amount: Number(amount),
    payfast_reference: data.pf_payment_id,
    payfast_payment_id: pfPaymentId,
    status: status === "COMPLETE" ? "complete" : status.toLowerCase(),
    paid_at: status === "COMPLETE" ? new Date().toISOString() : null,
  });

  if (status === "COMPLETE") {
    // Already paid? Don't re-flip status or re-notify on a retried ITN
    // that lands after the invoice was already marked paid some other way
    // (e.g. manually via "Mark paid" in the dashboard).
    if (invoice.status !== "paid") {
      const { error: updateError } = await supabase
        .from("invoices")
        .update({ status: "paid" })
        .eq("id", invoice.id);

      if (updateError) {
        console.error("PayFast invoice ITN: invoice update failed for", invoice.id, updateError);
      }

      await supabase.from("notifications").insert({
        business_id: invoice.business_id,
        user_id: null,
        message: `Invoice ${invoice.invoice_number} was paid via PayFast.`,
      });
    }
  } else if (status === "FAILED" || status === "CANCELLED") {
    await supabase.from("notifications").insert({
      business_id: invoice.business_id,
      user_id: null,
      message: `A PayFast payment for invoice ${invoice.invoice_number} was ${status.toLowerCase()}.`,
    });
  }

  return new Response("OK", { status: 200 });
});