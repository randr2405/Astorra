import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM_EMAIL = Deno.env.get("SEND_FROM_EMAIL") || "onboarding@resend.dev";
const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { type, number, toEmail, toName, pdfBase64, businessName, publicToken } = await req.json();

    if (!toEmail || !pdfBase64 || !number) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const label = type === "invoice" ? "Invoice" : "Quote";
    const subject = `${label} ${number} from ${businessName || "your supplier"}`;
    const filename = `${type}-${number}.pdf`;

    // Only invoices carry a public_token — quotes have nothing to pay yet.
    const payUrl = type === "invoice" && publicToken
      ? `${SITE_URL}/pay/${publicToken}`
      : null;

    const payButtonHtml = payUrl
      ? `
        <div style="margin: 24px 0;">
          <a href="${payUrl}"
             style="background-color:#185fa5;color:#ffffff;padding:12px 24px;
                    border-radius:6px;text-decoration:none;font-family:sans-serif;
                    font-weight:600;display:inline-block;">
            Pay Now
          </a>
        </div>
      `
      : "";

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
          ${payButtonHtml}
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
      return new Response(JSON.stringify({ error: emailData }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, id: emailData.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});