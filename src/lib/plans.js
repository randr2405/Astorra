// Single source of truth for plan limits and the installable module catalog.
// Onboarding, Dashboard, and Marketplace all read from here so they can't drift.

export const PLANS = ["free", "starter", "professional", "enterprise"];

export const PLAN_LIMITS = {
  free: 2,
  starter: 5,
  professional: 10,
  enterprise: Infinity,
};

export const PLAN_DETAILS = {
  free: { name: "Free", price: "R0", cadence: "/pm", ai: "Not included", extraModulePrice: "R49 / module / pm" },
  starter: { name: "Starter", price: "R249", cadence: "/pm", ai: "Limited AI (5 requests/mo)", extraModulePrice: "R39 / module / pm" },
  professional: { name: "Professional", price: "R799", cadence: "/pm", ai: "Business AI (30 requests/mo)", extraModulePrice: "R79 / module / pm (premium AI only)" },
  enterprise: { name: "Enterprise", price: "R1,499", cadence: "/pm", ai: "Unlimited AI", extraModulePrice: "R79 / module / pm (premium AI only)" },
};

// AI Builder access per plan.
// - maxRecommendations caps how many modules can be installed in a single
//   AI Builder request (separate from PLAN_LIMITS, the total module cap).
// - monthlyCredits caps how many AI Builder *requests* (calls to Claude)
//   a business gets per calendar month, enforced server-side in the
//   ai-builder edge function (see supabase/functions/ai-builder/index.ts —
//   this map is mirrored there since edge functions can't import from src/).
export const AI_ACCESS = {
  free: { level: "none", maxRecommendations: 0, monthlyCredits: 0 },
  starter: { level: "limited", maxRecommendations: 2, monthlyCredits: 5 },
  professional: { level: "business", maxRecommendations: 5, monthlyCredits: 30 },
  enterprise: { level: "unlimited", maxRecommendations: Infinity, monthlyCredits: Infinity },
};

// Core installable modules (MVP scope). Category groupings mirror the
// marketplace structure described in the brand doc (Sales, HR, Operations,
// Finance, AI, Communication) so new modules can slot in later.
export const MODULE_CATALOG = [
  { key: "customers", name: "Customers", desc: "One record per customer, feeding everything else", initial: "C", category: "Sales", route: "customers" },
  { key: "quotes", name: "Quotes", desc: "Create and send quotes to customers, ready to convert", initial: "Q", category: "Sales", route: "quotes" },
  { key: "invoices", name: "Invoices", desc: "Convert quotes to invoices, track what's paid", initial: "I", category: "Finance", route: "invoices" },
  { key: "inventory", name: "Inventory", desc: "Stock levels that stay accurate on their own", initial: "S", category: "Operations", route: "inventory" },
  { key: "staff", name: "Staff / HR", desc: "Records and basics, without a separate system", initial: "H", category: "HR", route: "staff" },
  { key: "bookings", name: "Bookings", desc: "Scheduling that updates the whole business", initial: "B", category: "Operations", route: "bookings" },
  { key: "documents", name: "Documents", desc: "Secure file storage for contracts and paperwork", initial: "D", category: "Operations", route: "documents" },
];

export function getModuleLimit(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

export function capModulesToPlan(modules, plan) {
  const limit = getModuleLimit(plan);
  return modules.slice(0, limit);
}

export function getModule(key) {
  return MODULE_CATALOG.find((m) => m.key === key);
}

export function getAiAccess(plan) {
  return AI_ACCESS[plan] ?? AI_ACCESS.free;
}

export function hasAiAccess(plan) {
  return getAiAccess(plan).level !== "none";
}