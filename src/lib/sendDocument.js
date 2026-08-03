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
  return data;
}