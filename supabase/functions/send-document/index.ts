import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("SEND_FROM_EMAIL") || "onboarding@resend.dev";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // ---- Reject unauthenticated callers ----
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    // Astorra uses Firebase as a third-party auth provider for Supabase —
    // there's no matching row in auth.users, so supabase.auth.getUser()
    // always fails here. Supabase's own gateway already verifies the JWT
    // signature before this function runs, so it's safe to decode the
    // payload directly rather than re-validating it.
    const token = authHeader.replace("Bearer ", "");
    let sub: string | undefined;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      sub = payload.sub;
    } catch {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }

    if (!sub) {
      return jsonResponse({ error: "Invalid or expired session" }, 401);
    }

    // Confirm this Firebase-authenticated caller actually belongs to a
    // business in Astorra — not just that they have *some* valid token.
    const { data: appUser } = await supabase
      .from("users")
      .select("business_id")
      .eq("firebase_uid", sub)
      .maybeSingle();

    if (!appUser?.business_id) {
      return jsonResponse({ error: "No business found for this account" }, 403);
    }

    const { type, number, toEmail, toName, pdfBase64, businessName } = await req.json();

    if (!toEmail || !pdfBase64 || !number) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const label = type === "invoice" ? "Invoice" : "Quote";
    const subject = `${label} ${number} from ${businessName || "your supplier"}`;
    const filename = `${type}-${number}.pdf`;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [toEmail],
        subject,
        html: `
          <p>Hi ${toName || ""},</p>
          <p>Please find attached ${label.toLowerCase()} ${number} from ${businessName || "us"}.</p>
        `,
        attachments: [
          {
            filename,
            content: pdfBase64,
          },
        ],
      }),
    });

    const emailData = await emailRes.json();

    if (!emailRes.ok) {
      console.error("Resend error:", JSON.stringify(emailData));
      return jsonResponse({ error: emailData }, 502);
    }

    return jsonResponse({ success: true, id: emailData.id }, 200);
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
});