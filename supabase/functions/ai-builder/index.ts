import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors lib/plans.js MODULE_CATALOG — keep in sync when modules change.
const MODULE_CATALOG = [
  { key: "customers", name: "Customers", desc: "One record per customer, feeding everything else" },
  { key: "quotes", name: "Quotes", desc: "Create and send quotes to customers" },
  { key: "invoices", name: "Invoices", desc: "Convert quotes to invoices, track what's paid" },
  { key: "inventory", name: "Inventory", desc: "Track stock levels and items" },
  { key: "staff", name: "Staff / HR", desc: "Manage staff records and basic HR info" },
  { key: "bookings", name: "Bookings", desc: "Manage customer bookings and scheduling" },
  { key: "documents", name: "Documents", desc: "Secure file storage for contracts and paperwork" },
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    // Confirms the caller is a real authenticated user tied to a business,
    // the same way every table's RLS does. Rejects if not.
    const { data: businessId, error: authError } = await supabase.rpc("auth_business_id");
    if (authError || !businessId) {
      return new Response(JSON.stringify({ error: "Not authorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { description, installed_modules = [] } = await req.json();

    if (!description || !description.trim()) {
      return new Response(JSON.stringify({ error: "Description is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const availableModules = MODULE_CATALOG.filter((m) => !installed_modules.includes(m.key));

    if (availableModules.length === 0) {
      return new Response(
        JSON.stringify({ modules: [], reasoning: "You already have every available module installed." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are Astorra's AI Builder. A small business owner describes a problem or need in plain language, and you recommend which modules from the catalog below solve it. Only recommend from this exact list of available module keys — never invent new ones:

${availableModules.map((m) => `- ${m.key}: ${m.name} — ${m.desc}`).join("\n")}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"modules": ["key1", "key2"], "reasoning": "One or two plain-language sentences explaining why these modules solve the stated problem."}

If nothing in the catalog genuinely fits, return {"modules": [], "reasoning": "..."} explaining why, in the same problem-first, plain-language voice — never hyped, never vague.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: description.trim() }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      console.error("Claude API error:", errText);
      return new Response(JSON.stringify({ error: "AI recommendation failed. Please try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content?.find((b) => b.type === "text")?.text ?? "";

    let parsed;
    try {
      const cleaned = rawText.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse Claude response:", rawText);
      return new Response(JSON.stringify({ error: "Couldn't understand the AI response. Please try again." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Never trust the model's keys blindly — filter to only what's real
    // and actually available, in case it hallucinates or re-suggests
    // something already installed.
    const validKeys = new Set(availableModules.map((m) => m.key));
    const safeModules = Array.isArray(parsed.modules)
      ? parsed.modules.filter((k) => validKeys.has(k))
      : [];

    return new Response(JSON.stringify({ modules: safeModules, reasoning: parsed.reasoning || "" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("ai-builder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});