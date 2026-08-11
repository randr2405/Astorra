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

// Staff seats are NOT plan-tiered — every staff member beyond the owner
// costs a flat once-off R79 fee via PayFast, regardless of plan. See
// TeamSettings.js and supabase/functions/payfast-checkout|notify. Kept
// here as the single source of truth for that price so the UI copy and
// any future plan-comparison page can reference it without hardcoding.
export const STAFF_SEAT_PRICE = 79;

// Core installable modules (MVP scope). Category groupings mirror the
// marketplace structure described in the brand doc (Sales, HR, Operations,
// Finance, AI, Communication) so new modules can slot in later.
//
// alwaysOn modules are installed on every plan by default, free of charge,
// and are excluded from the plan's module cap (see capModulesToPlan below).
// Documents and Reports both use this — neither requires the business to
// "spend" one of their plan's module slots to have them.
export const MODULE_CATALOG = [
  { key: "customers", name: "Customers", desc: "One record per customer, feeding everything else", initial: "C", category: "Sales", route: "customers" },
  { key: "quotes", name: "Quotes", desc: "Create and send quotes to customers, ready to convert", initial: "Q", category: "Sales", route: "quotes" },
  { key: "jobs", name: "Jobs", desc: "Track the actual work between an accepted quote and getting paid", initial: "J", category: "Sales", route: "jobs" },
  { key: "invoices", name: "Invoices", desc: "Convert quotes to invoices, track what's paid", initial: "I", category: "Finance", route: "invoices" },
  { key: "expenses", name: "Expenses", desc: "Log what you spend, attach receipts, see profit at a glance", initial: "E", category: "Finance", route: "expenses" },
  { key: "suppliers", name: "Purchase Orders / Suppliers", desc: "Track what you owe suppliers, order due dates, and goods received", initial: "P", category: "Finance", route: "suppliers" },
  { key: "payroll", name: "Payroll", desc: "Run payroll, calculate PAYE/UIF automatically, and generate payslips", initial: "$", category: "Finance", route: "payroll" },
  { key: "inventory", name: "Inventory", desc: "Stock levels that stay accurate on their own", initial: "S", category: "Operations", route: "inventory" },
  { key: "assets", name: "Assets", desc: "Track equipment and gear — who has it, where it is, when it needs servicing", initial: "A", category: "Operations", route: "assets" },
  { key: "staff", name: "Staff / HR", desc: "Records and basics, without a separate system", initial: "H", category: "HR", route: "staff" },
  { key: "leave", name: "Leave Management", desc: "Staff request leave, you approve it, and it feeds Payroll automatically", initial: "L", category: "HR", route: "leave" },
  { key: "bookings", name: "Bookings", desc: "Scheduling that updates the whole business", initial: "B", category: "Operations", route: "bookings" },
  { key: "reports", name: "Reports", desc: "Revenue, top customers, and overdue tracking at a glance", initial: "R", category: "Operations", route: "reports", alwaysOn: true },
  { key: "documents", name: "Documents", desc: "Secure file storage for contracts and paperwork", initial: "D", category: "Operations", route: "documents", alwaysOn: true },
];

export function getModuleLimit(plan) {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

// Always-on modules (Reports, Documents) never count against the plan's
// module cap — a business can have every alwaysOn module installed AND
// still install up to their full plan limit of everything else.
export function getAlwaysOnModules() {
  return MODULE_CATALOG.filter((m) => m.alwaysOn);
}

export function isAlwaysOnModule(key) {
  return Boolean(getModule(key)?.alwaysOn);
}

// Caps a list of module keys/objects to the plan's limit, but only counts
// modules that aren't alwaysOn against that limit. AlwaysOn modules are
// always included in the returned list, regardless of the cap.
export function capModulesToPlan(modules, plan) {
  const limit = getModuleLimit(plan);

  const isAlwaysOn = (m) => (typeof m === "string" ? isAlwaysOnModule(m) : Boolean(m.alwaysOn));

  const alwaysOnInList = modules.filter(isAlwaysOn);
  const capped = modules.filter((m) => !isAlwaysOn(m));

  return [...alwaysOnInList, ...capped.slice(0, limit)];
}

export function getModule(key) {
  return MODULE_CATALOG.find((m) => m.key === key);
}

export function getAiAccess(plan) {
  return AI_ACCESS[plan] ?? AI_ACCESS.free;
}

export function hasAiAccess(plan) {
  return getAiAccess(plan).level !== "none";
}mmit  