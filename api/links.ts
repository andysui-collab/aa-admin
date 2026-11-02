// The "Confirm" and "Ignore" buttons: adds a row to the Stripe Links tab through the Apps Script
// web app attached to the master sheet (apps-script/StripeLinks.gs). Only that tab is ever written.

import { checkAccess } from "../src/auth.js";

const CUSTOMER_IDS = /^(cus_[A-Za-z0-9]+|guest:\S+)(;(cus_[A-Za-z0-9]+|guest:\S+))*$/;

export async function POST(request: Request): Promise<Response> {
  const denied = checkAccess(request);
  if (denied) return denied;

  const url = process.env.APPS_SCRIPT_URL;
  const secret = process.env.APPS_SCRIPT_SECRET;
  if (!url || !secret) return Response.json({ ok: false, error: "APPS_SCRIPT_URL / APPS_SCRIPT_SECRET aren't set in Vercel." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { familyKey?: string; customerIds?: string; note?: string };
  const familyKey = String(body.familyKey ?? "").trim().toLowerCase();
  const customerIds = String(body.customerIds ?? "").trim();
  if (!familyKey || !CUSTOMER_IDS.test(customerIds)) {
    return Response.json({ ok: false, error: "Needs a parent email (or \"ignore\") and a Stripe customer ID like cus_..." }, { status: 400 });
  }

  // Apps Script answers with a redirect to the result, which fetch follows automatically.
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, familyKey, customerIds, note: String(body.note ?? "").slice(0, 200) }),
  });
  const result = await res.json().catch(() => ({ ok: false, error: `Apps Script returned ${res.status}` }));
  return Response.json(result, { status: result.ok ? 200 : 502 });
}
