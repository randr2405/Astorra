import { supabase } from "./supabaseClient";

const PREFIXES = { quote: "Q-", invoice: "INV-" };

export async function generateNumber(businessId, counterKey) {
  const { data, error } = await supabase.rpc("get_next_number", {
    p_business_id: businessId,
    p_counter_key: counterKey,
  });

  if (error) throw error;

  return `${PREFIXES[counterKey]}${String(data).padStart(4, "0")}`;
}