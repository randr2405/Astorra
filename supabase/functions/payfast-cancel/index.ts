// POST /functions/v1/payfast-cancel   body: { business_id }
//
// Called from Billing.js when a business downgrades to Free. Cancels the
// recurring subscription on PayFast's side using their Subscriptions API,
// then clears the local subscription state.
//
// NOTE: PayFast's Subscriptions API uses a different, header-based
// signature scheme than the checkout/ITN flow (see PayFast's "API" docs,
// not the "Payments"/ITN docs). Test this against the sandbox
// (https://api.payfast.co.za, or the sandbox host if PAYFAST_SANDBOX=true)
// before relying on it in production — signature and header requirements
// have changed before and are worth re-checking against PayFast's current
// docs at build time.

import { createClient } from "npm:@supabase/supabase-js@2";
import { createHash } from "node:crypto";

const MERCHANT_ID = Deno.env.get("PAYFAST_MERCHANT_ID")!;
const PASSPHRASE = Deno.env.get("PAYFAST_PASSPHRASE")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const API_HOST = Deno.env.get("PAYFAST_SANDBOX") === "true"
  ? "api.sandbox.payfast.co.za"
  : "api.payfast.co.za";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

function apiSignature(timestamp: string): string {
  const queryString = `merchant-id=${MERCHANT_ID}&timestamp=${encodeURIComponent(timestamp)}&passphrase=${encodeURIComponent(PASSPHRASE)}`;
  return createHash("md5").update(queryString).digest("hex");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { business_id } = await req.json();
  if (!business_id) {
    return new Response("Missing business_id", { status: 400 });
  }

  const { data: business, error } = await supabase
    .from("businesses")
    .select("payfast_token")
    .eq("id", business_id)
    .single();

  if (error || !business) {
    return new Response("Business not found", { status: 404 });
  }

  // Nothing to cancel — e.g. a business that's been on Free since signup.
  if (!business.payfast_token) {
    return new Response(JSON.stringify({ cancelled: false, reason: "no_active_subscription" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const timestamp = new Date().toISOString();
  const signature = apiSignature(timestamp);

  const pfResponse = await fetch(
    `https://${API_HOST}/subscriptions/${business.payfast_token}/cancel`,
    {
      method: "PUT",
      headers: {
        "merchant-id": MERCHANT_ID,
        version: "v1",
        timestamp,
        signature,
      },
    }
  );

  if (!pfResponse.ok) {
    const body = await pfResponse.text();
    console.error("PayFast cancel failed:", pfResponse.status, body);
    return new Response(JSON.stringify({ cancelled: false, error: body }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  await supabase
    .from("businesses")
    .update({ payfast_token: null, subscription_status: "cancelled" })
    .eq("id", business_id);

  await supabase.from("notifications").insert({
    business_id,
    user_id: null,
    message: "Your PayFast subscription was cancelled.",
  });

  return new Response(JSON.stringify({ cancelled: true }), {
    headers: { "Content-Type": "application/json" },
  });
});