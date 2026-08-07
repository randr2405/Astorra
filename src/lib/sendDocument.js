import { supabase } from "./supabaseClient";

export async function sendDocumentEmail({ type, number, toEmail, toName, pdfBase64, businessName, publicToken }) {
  const { data, error } = await supabase.functions.invoke("send-document", {
    body: {
      type,
      number,
      toEmail,
      toName,
      pdfBase64,
      businessName,
      publicToken,
    },
  });

  if (error) throw error;

  // The edge function returns a 4xx/5xx body as `data` rather than
  // throwing (supabase-js doesn't throw on non-2xx for functions.invoke
  // by default), so an auth/ownership rejection would otherwise look
  // like a successful send. Surface it as a real error instead.
  if (data?.error) {
    throw new Error(typeof data.error === "string" ? data.error : "Failed to send document.");
  }

  return data;
}