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
  { key: "customers", name: "Customers", desc: "One record per customer, feeding everything else", table: "customers" },
  { key: "quotes", name: "Quotes", desc: "Create and send quotes to customers", table: "quotes" },
  { key: "invoices", name: "Invoices", desc: "Convert quotes to invoices, track what's paid", table: "invoices" },
  { key: "inventory", name: "Inventory", desc: "Track stock levels and items", table: "inventory_items" },
  { key: "staff", name: "Staff / HR", desc: "Manage staff records and basic HR info", table: "staff" },
  { key: "bookings", name: "Bookings", desc: "Manage customer bookings and scheduling", table: "bookings" },
  { key: "documents", name: "Documents", desc: "Secure file storage for contracts and paperwork", table: "documents" },
];

// Mirrors lib/plans.js AI_ACCESS.monthlyCredits — kept in sync manually
// since edge functions can't import from the React app's src/ directory.
const MONTHLY_CREDITS: Record<string, number> = {
  free: 0,
  starter: 5,
  professional: 30,
  enterprise: Infinity,
};

function nextMonthBoundary(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
}

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

    // ------------------------------------------------------------------
    // 1. Load the business row (plan + credit tracking columns).
    // ------------------------------------------------------------------
    const { data: business, error: businessError } = await supabase
      .from("businesses")
      .select("id, name, industry, team_size, plan, installed_modules, ai_credits_used, ai_credits_reset_at")
      .eq("id", businessId)
      .single();

    if (businessError || !business) {
      console.error("ai-builder: could not load business", businessId, businessError);
      return new Response(JSON.stringify({ error: "Could not load business" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const plan = business.plan || "free";
    const monthlyLimit = MONTHLY_CREDITS[plan] ?? MONTHLY_CREDITS.free;

    // ------------------------------------------------------------------
    // 2. Roll the monthly counter over if we're past the reset date.
    // ------------------------------------------------------------------
    let creditsUsed = business.ai_credits_used ?? 0;
    let resetAt = business.ai_credits_reset_at ? new Date(business.ai_credits_reset_at) : new Date(0);

    if (new Date() >= resetAt) {
      creditsUsed = 0;
      resetAt = new Date(nextMonthBoundary());

      await supabase
        .from("businesses")
        .update({ ai_credits_used: 0, ai_credits_reset_at: resetAt.toISOString() })
        .eq("id", businessId);
    }

    // ------------------------------------------------------------------
    // 3. Block the request if this business is out of credits for the
    //    month. Free plan (monthlyLimit 0) always falls here.
    // ------------------------------------------------------------------
    if (monthlyLimit !== Infinity && creditsUsed >= monthlyLimit) {
      return new Response(
        JSON.stringify({
          error: `You've used all ${monthlyLimit} AI Builder requests included in your ${plan} plan this month. Upgrade for more, or wait until your credits reset.`,
          credits_used: creditsUsed,
          credits_limit: monthlyLimit,
          credits_reset_at: resetAt.toISOString(),
        }),
        {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ------------------------------------------------------------------
    // 4. Spend one credit up front. If the AI call fails later, the credit
    //    is still spent — this matches how most AI-credit systems work
    //    (the cost is the call itself, not just a successful outcome) and
    //    keeps this simple and race-condition-resistant (increment now,
    //    rather than trying to decide post-hoc whether to charge).
    // ------------------------------------------------------------------
    const newCreditsUsed = creditsUsed + 1;
    await supabase
      .from("businesses")
      .update({ ai_credits_used: newCreditsUsed })
      .eq("id", businessId);

    // ------------------------------------------------------------------
    // 5. Gather real business context so the AI can answer questions
    //    about the business itself, not just recommend modules. Only
    //    query tables for modules the business actually has installed —
    //    querying an uninstalled module's table is unnecessary and those
    //    tables may be empty/irrelevant anyway.
    // ------------------------------------------------------------------
    const installedSet = new Set(installed_modules);
    const statsLines: string[] = [];

    for (const mod of MODULE_CATALOG) {
      if (!installedSet.has(mod.key)) continue;
      const { count, error: countError } = await supabase
        .from(mod.table)
        .select("*", { count: "exact", head: true })
        .eq("business_id", businessId);

      if (!countError && typeof count === "number") {
        statsLines.push(`- ${mod.name}: ${count} record${count === 1 ? "" : "s"}`);
      }
    }

    const businessContext = `Business name: ${business.name || "Unknown"}
Industry: ${business.industry || "Not specified"}
Team size: ${business.team_size || "Not specified"}
Plan: ${plan}
Installed modules: ${installed_modules.length ? installed_modules.join(", ") : "None"}
${statsLines.length ? "Current data:\n" + statsLines.join("\n") : "No data recorded yet in installed modules."}`;

    const availableModules = MODULE_CATALOG.filter((m) => !installedSet.has(m.key));

    // ------------------------------------------------------------------
    // 6. Build the prompt. Claude decides whether this is a module
    //    recommendation request or a question about the business itself,
    //    and responds in the matching shape.
    // ------------------------------------------------------------------
    const systemPrompt = `You are Astorra's AI Builder, an assistant for a small business owner using the Astorra business management platform.

You have two jobs, and you decide which one applies based on what the person says:

1. MODULE RECOMMENDATION MODE — if they describe a business problem or need that could be solved by installing one of Astorra's modules, recommend from this exact list of available (not-yet-installed) module keys. Never invent new ones.
${availableModules.length ? availableModules.map((m) => `- ${m.key}: ${m.name} — ${m.desc}`).join("\n") : "(All modules are already installed — there is nothing left to recommend.)"}

2. BUSINESS ANALYSIS MODE — if they ask a question about their own business (e.g. "how many customers do we have", "what's our biggest gap", "how is my business doing", "what should I focus on"), answer using the real business context below. Be specific and grounded in the actual numbers given — never invent data that isn't in the context.

Business context:
${businessContext}

Respond with ONLY valid JSON, no markdown fences, no preamble, in this exact shape:
{"mode": "modules" or "analysis", "modules": ["key1", "key2"], "reasoning": "One or two plain-language sentences.", "answer": "Only used in analysis mode — a direct, specific answer to their question using the business context above."}

In "modules" mode, leave "answer" as an empty string. In "analysis" mode, leave "modules" as an empty array and put your response in "answer" — "reasoning" can restate the same thing briefly or be left empty. Never hyped, never vague — plain, direct, problem-first language.`;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
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
      ? parsed.modules.filter((k: string) => validKeys.has(k))
      : [];

    const mode = parsed.mode === "analysis" ? "analysis" : "modules";

    return new Response(
      JSON.stringify({
        mode,
        modules: mode === "modules" ? safeModules : [],
        reasoning: parsed.reasoning || "",
        answer: mode === "analysis" ? parsed.answer || "" : "",
        credits_used: newCreditsUsed,
        credits_limit: monthlyLimit,
        credits_reset_at: resetAt.toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("ai-builder error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});