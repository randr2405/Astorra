import { supabase } from "./supabaseClient";

export async function notify(businessId, userId, message) {
  if (!businessId) return;
  const { error } = await supabase.from("notifications").insert({
    business_id: businessId,
    user_id: userId || null,
    message,
  });
  if (error) {
    console.error("notify() failed:", error.message);
  }
}