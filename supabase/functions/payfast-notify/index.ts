// POST /functions/v1/payfast-notify
//
// PayFast's server calls this directly (server-to-server) after a payment
// succeeds, and again on every future recurring charge. This is the ONLY
// place a business's plan should actually change — never trust the
// checkout redirect alone, since a browser round-trip can be interrupted
// or spoofed.
//
// Must respond fast with a 200, and PayFast expects no particular body.

import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyItnSignature, confirmWithPayFast } from "../_shared/payfast.ts";

const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// Mirrors src/lib/plans.js — kept in sync manually since edge functions
// can't import from the React app's src/ directory.
const PLAN_LIMITS: Record<string, number> = {
  free: 2,
  starter: 5,
  professional: 10,
  enterprise: Infinity,
};

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
    console.error("PayFast ITN: signature mismatch", data.m_payment_id);
    return new Response("Invalid signature", { status: 400 });
  }

  // 2. Server-to-server confirmation with PayFast itself
  const confirmed = await confirmWithPayFast(rawBody);
  if (!confirmed) {
    console.error("PayFast ITN: could not confirm with PayFast", data.m_payment_id);
    return new Response("Could not confirm", { status: 400 });
  }

  const businessId = data.custom_str1;
  const plan = data.custom_str2;
  const status = data.payment_status; // "COMPLETE", "FAILED", "CANCELLED", etc.
  const pfPaymentId = data.pf_payment_id;
  const token = data.token || null; // subscription token, used for later cancellation
  const amount = data.amount_gross || data.amount || "0";

  if (!businessId || !plan) {
    console.error("PayFast ITN: missing custom_str1/custom_str2", data);
    return new Response("Missing business/plan reference", { status: 400 });
  }

  // 3. Idempotency — PayFast can and will retry ITNs. If we've already
  // recorded this pf_payment_id, just acknowledge and stop.
  const { data: existing } = await supabase
    .from("subscription_payments")
    .select("id")
    .eq("pf_payment_id", pfPaymentId)
    .maybeSingle();

  if (existing) {
    return new Response("OK", { status: 200 });
  }

  await supabase.from("subscription_payments").insert({
    business_id: businessId,
    plan,
    pf_payment_id: pfPaymentId,
    token,
    amount: Number(amount),
    status,
    raw_payload: data,
  });

  if (status === "COMPLETE") {
    console.log("PayFast ITN: looking up business with id:", JSON.stringify(businessId));

    const { data: business, error: selectError } = await supabase
      .from("businesses")
      .select("installed_modules")
      .eq("id", businessId)
      .single();

    if (selectError) {
      console.error("PayFast ITN: businesses select failed for", businessId, selectError);
    } else {
      console.log("PayFast ITN: businesses select succeeded, found row:", JSON.stringify(business));
    }

    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
    const installed = business?.installed_modules || [];
    const cappedModules = limit === Infinity ? installed : installed.slice(0, limit);

    const { data: updatedRows, error: updateError } = await supabase
      .from("businesses")
      .update({
        plan,
        installed_modules: cappedModules,
        payfast_token: token,
        subscription_status: "active",
      })
      .eq("id", businessId)
      .select();

    if (updateError) {
      console.error("PayFast ITN: businesses update failed for", businessId, updateError);
    } else if (!updatedRows || updatedRows.length === 0) {
      console.error(
        "PayFast ITN: update matched ZERO rows for businessId:",
        businessId,
        "— this id does not exist in businesses, or RLS/service-role is silently blocking the write"
      );
    } else {
      console.log("PayFast ITN: businesses updated successfully for", businessId, "new plan:", plan, "rows affected:", updatedRows.length);
    }

    await supabase.from("notifications").insert({
      business_id: businessId,
      user_id: null,
      message: `Payment received — your plan is now ${plan.charAt(0).toUpperCase() + plan.slice(1)}.`,
    });
  } else if (status === "FAILED" || status === "CANCELLED") {
    await supabase
      .from("businesses")
      .update({ subscription_status: status.toLowerCase() })
      .eq("id", businessId);

    await supabase.from("notifications").insert({
      business_id: businessId,
      user_id: null,
      message: `Your PayFast payment for the ${plan} plan was ${status.toLowerCase()}.`,
    });
  }

  return new Response("OK", { status: 200 });
});