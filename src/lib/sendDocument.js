import { supabase } from "./supabaseClient";

export async function sendDocumentEmail({ type, number, toEmail, toName, pdfBase64, businessName }) {
  const { data: sessionData } = await supabase.auth.getSession();

  const { data, error } = await supabase.functions.invoke("send-document", {
    body: {
      type,
      number,
      toEmail,
      toName,
      pdfBase64,
      businessName,
    },
  });

  if (error) throw error;
  return data;
}