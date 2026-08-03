// Shared PayFast helpers: signature generation (outgoing requests) and
// signature verification (incoming ITN webhook), plus the plan -> price map.
//
// PayFast quirk that trips people up: the signature is built from params
// IN THE ORDER THEY ARE SENT (not alphabetical), skipping any empty values
// and skipping "signature" itself. Values must be URL-encoded PHP-style
// (spaces become "+", not "%20"), then the passphrase is appended as its
// own "&passphrase=..." pair, and the whole string is MD5-hashed.
//
// IMPORTANT ASYMMETRY: that "skip empty values" rule only applies to
// OUTGOING requests we build ourselves (checkout), where we simply never
// include a field we don't want to send. It does NOT apply to verifying
// an INCOMING ITN payload — PayFast includes every field it sends, even
// empty ones (e.g. custom_str3=, custom_int1=, name_last=), in its own
// signature calculation. If we filter those out before re-hashing, our
// signature won't match PayFast's, even with the correct passphrase.
// See verifyItnSignature() below, which intentionally does NOT filter.

import { createHash } from "node:crypto";

export const PAYFAST_HOST = Deno.env.get("PAYFAST_SANDBOX") === "true"
  ? "sandbox.payfast.co.za"
  : "www.payfast.co.za";

export const PLAN_PRICES: Record<string, number> = {
  starter: 249,
  professional: 799,
  enterprise: 1499,
  // "free" is intentionally excluded — it never goes through PayFast.
};

export const PLAN_FREQUENCY = 3; // PayFast code for "monthly"
export const PLAN_CYCLES = 0; // 0 = bill indefinitely until cancelled

function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/%20/g, "+")
    .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Builds the PayFast signature from an ordered list of [key, value] pairs,
 * for OUTGOING requests we construct ourselves (e.g. checkout).
 *
 * Filters out empty/undefined/null values, because we control exactly
 * which fields we send and simply omit anything blank rather than
 * sending it as an empty string. Pass entries in the exact order PayFast
 * should see them.
 */
export function generateSignature(
  orderedEntries: [string, string][],
  passphrase: string
): string {
  const parts = orderedEntries
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${phpUrlEncode(String(v).trim())}`);

  let queryString = parts.join("&");
  if (passphrase) {
    queryString += `&passphrase=${phpUrlEncode(passphrase)}`;
  }

  return createHash("md5").update(queryString).digest("hex");
}

/**
 * Verifies an incoming ITN payload's signature against what we'd compute
 * ourselves, using the *order fields arrived in the POST body*.
 *
 * Unlike generateSignature() above, this does NOT filter out empty
 * values — PayFast's own signature includes every field it sent, blank
 * or not, so we must mirror that exactly to get a matching hash.
 */
export function verifyItnSignature(
  bodyEntries: [string, string][],
  passphrase: string
): boolean {
  const receivedSignature = bodyEntries.find(([k]) => k === "signature")?.[1];
  if (!receivedSignature) return false;

  const entriesWithoutSignature = bodyEntries.filter(([k]) => k !== "signature");

  const parts = entriesWithoutSignature.map(([k, v]) => `${k}=${phpUrlEncode(String(v))}`);
  let queryString = parts.join("&");
  if (passphrase) {
    queryString += `&passphrase=${phpUrlEncode(passphrase)}`;
  }
  const expected = createHash("md5").update(queryString).digest("hex");

  return expected === receivedSignature;
}

/**
 * Server-to-server confirmation with PayFast, required in addition to the
 * signature check — PayFast recommends never trusting an ITN on signature
 * alone, since the request itself could still be replayed or spoofed if
 * the passphrase ever leaked. This asks PayFast directly "did you send this".
 */
export async function confirmWithPayFast(rawBody: string): Promise<boolean> {
  try {
    const response = await fetch(`https://${PAYFAST_HOST}/eng/query/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: rawBody,
    });
    const text = await response.text();
    return text.trim() === "VALID";
  } catch {
    return false;
  }
}