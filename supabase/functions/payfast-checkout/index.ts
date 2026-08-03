// GET /functions/v1/payfast-checkout?business_id=...&plan=starter
//
// Called by redirecting the browser here (window.location.href = ...) from
// Billing.js. Returns an HTML page that immediately auto-submits a hidden
// form to PayFast's hosted checkout — the browser ends up on PayFast's own
// domain to enter card details, so this app never touches card data.
//
// IMPORTANT: this function does NOT change the business's plan. The plan
// only changes once payfast-notify receives and verifies a real payment.

import { createClient } from "npm:@supabase/supabase-js@2";
import { generateSignature, PLAN_PRICES, PLAN_FREQUENCY, PLAN_CYCLES, PAYFAST_HOST } from "../_shared/payfast.ts";

const MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID")!;
const MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SITE_URL = Deno.env.get("SITE_URL")!; // e.g. https://app.astorra.co.za
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function htmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  const plan = url.searchParams.get("plan");

  if (!businessId || !plan) {
    return new Response("Missing business_id or plan.", { status: 400 });
  }

  const price = PLAN_PRICES[plan];
  if (!price) {
    return new Response(`"${plan}" is not a paid plan.`, { status: 400 });
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    return new Response("Business not found.", { status: 404 });
  }

  const { data: owner } = await supabase
    .from("users")
    .select("email")
    .eq("business_id", businessId)
    .eq("role", "owner")
    .maybeSingle();

  const billingEmail = owner?.email || "";
  const mPaymentId = `${businessId}:${plan}:${Date.now()}`;

  // Order matters here — it must match the order used when generating the
  // signature, and PayFast's own documented field order for subscriptions.
  const orderedEntries: [string, string][] = [
    ["merchant_id", MERCHANT_ID],
    ["merchant_key", MERCHANT_KEY],
    ["return_url", `${SITE_URL}/dashboard/billing?payment=success`],
    ["cancel_url", `${SITE_URL}/dashboard/billing?payment=cancelled`],
    ["notify_url", `${SUPABASE_URL}/functions/v1/payfast-notify`],
    ["name_first", business.name || "Business"],
    ["email_address", billingEmail],
    ["m_payment_id", mPaymentId],
    ["amount", price.toFixed(2)],
    ["item_name", `Astorra ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan`],
    ["item_description", `Monthly subscription to the Astorra ${plan} plan`],
    ["custom_str1", businessId],
    ["custom_str2", plan],
    ["subscription_type", "1"],
    ["recurring_amount", price.toFixed(2)],
    ["frequency", String(PLAN_FREQUENCY)],
    ["cycles", String(PLAN_CYCLES)],
  ];

  const signature = generateSignature(orderedEntries, PASSPHRASE);

  const inputs = orderedEntries
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${htmlEscape(v)}" />`)
    .join("\n");

  const html = `<!DOCTYPE html>
<html>
  <head>
    <title>Continue to PayFast</title>
    <style>
      body { font-family: sans-serif; text-align: center; padding-top: 100px; }
      button {
        padding: 16px 32px; font-size: 17px; cursor: pointer;
        background: #7C3AED; color: white; border: none; border-radius: 8px;
      }
      p { color: #444; margin-bottom: 24px; }
    </style>
  </head>
  <body>
    <p>Click below to securely complete payment on PayFast.</p>
    <form action="https://${PAYFAST_HOST}/eng/process" method="post">
      ${inputs}
      <input type="hidden" name="signature" value="${signature}" />
      <button type="submit">Continue to PayFast</button>
    </form>
  </body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html" } });
});