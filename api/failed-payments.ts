// Runs once a day (see vercel.json). If any payment failed in the last 24 hours, sends the
// details to the n8n webhook in N8N_WEBHOOK_URL, which forwards it as an SMS/WhatsApp.
// Quiet days send nothing.

import { failedPaymentsMessage, findFailedPayments } from "../src/failed.js";

export async function GET(request: Request): Promise<Response> {
  // Vercel sends this header on scheduled runs, so nobody else can trigger it.
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const failed = await findFailedPayments();
  if (!failed.length) return Response.json({ failed: 0, sent: false });

  const webhook = process.env.N8N_WEBHOOK_URL;
  if (!webhook) throw new Error("N8N_WEBHOOK_URL isn't set, so the failed payment alert couldn't be sent");
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ count: failed.length, message: failedPaymentsMessage(failed), payments: failed }),
  });
  if (!res.ok) throw new Error(`n8n webhook returned ${res.status}`);
  return Response.json({ failed: failed.length, sent: true });
}
