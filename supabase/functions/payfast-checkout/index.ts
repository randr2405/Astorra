// GET /functions/v1/payfast-checkout?business_id=...&plan=starter
// GET /functions/v1/payfast-checkout?business_id=...&type=seat&invite_email=...&invite_role=staff
//
// Called by redirecting the browser here (window.location.href = ...) from
// Billing.js (plan checkout) or TeamSettings.js (staff seat checkout).
// Returns the signed PayFast fields as JSON; the calling React app builds
// and submits the actual form to PayFast's hosted checkout.
//
// IMPORTANT: this function does NOT change the business's plan or create
// any staff invite. Both only happen once payfast-notify receives and
// verifies a real payment.

import { createClient } from "npm:@supabase/supabase-js@2";
import { generateSignature, PLAN_PRICES, PLAN_FREQUENCY, PLAN_CYCLES, PAYFAST_HOST } from "../_shared/payfast.ts";

const MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID")!;
const MERCHANT_KEY = Deno.env.get("PAYFAST_MERCHANT_KEY")!;
const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SITE_URL = Deno.env.get("SITE_URL")!; // e.g. https://app.astorra.co.za
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Flat once-off fee for every additional staff seat, regardless of plan.
// Not in PLAN_PRICES since it's not a recurring subscription amount.
const STAFF_SEAT_PRICE = 79.0;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const businessId = url.searchParams.get("business_id");
  const type = url.searchParams.get("type"); // "seat" | null (null = plan checkout)

  if (!businessId) {
    return new Response("Missing business_id.", { status: 400 });
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

  // ----------------------------------------------------------------
  // Staff seat checkout (once-off, no subscription fields)
  // ----------------------------------------------------------------
  if (type === "seat") {
    const inviteEmail = url.searchParams.get("invite_email");
    const inviteRole = url.searchParams.get("invite_role") || "staff";

    if (!inviteEmail) {
      return new Response("Missing invite_email.", { status: 400 });
    }

    const mPaymentId = `${businessId}:seat:${Date.now()}`;

    const orderedEntries: [string, string][] = [
      ["merchant_id", MERCHANT_ID],
      ["merchant_key", MERCHANT_KEY],
      ["return_url", `${SITE_URL}/dashboard/team?payment=success`],
      ["cancel_url", `${SITE_URL}/dashboard/team?payment=cancelled`],
      ["notify_url", `${SUPABASE_URL}/functions/v1/payfast-notify`],
      ["name_first", business.name || "Business"],
      ["email_address", billingEmail],
      ["m_payment_id", mPaymentId],
      ["amount", STAFF_SEAT_PRICE.toFixed(2)],
      ["item_name", "Astorra additional staff seat"],
      ["item_description", `Once-off fee to add ${inviteEmail} as ${inviteRole} on Astorra`],
      ["custom_str1", businessId],
      ["custom_str2", "seat"],
      ["custom_str3", inviteEmail],
      ["custom_str4", inviteRole],
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
  }

  // ----------------------------------------------------------------
  // Plan checkout (existing behaviour, unchanged)
  // ----------------------------------------------------------------
  const plan = url.searchParams.get("plan");

  if (!plan) {
    return new Response("Missing plan.", { status: 400 });
  }

  const price = PLAN_PRICES[plan];
  if (!price) {
    return new Response(`"${plan}" is not a paid plan.`, { status: 400 });
  }

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