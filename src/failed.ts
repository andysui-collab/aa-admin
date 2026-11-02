// Finds Stripe payments that failed in the last 24 hours.

import { localDate } from "./billing.js";
import { stripeListAll } from "./stripe.js";

export interface FailedPayment {
  customer: string;
  email: string;
  amount: number; // dollars
  reason: string;
  date: string;
}

export async function findFailedPayments(): Promise<FailedPayment[]> {
  const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
  const charges = await stripeListAll<any>("charges", { "created[gte]": since, "expand[]": "data.customer" });
  return charges.filter((c) => c.status === "failed").map((c) => ({
    customer: c.customer?.name || c.billing_details?.name || c.customer?.email || "Unknown customer",
    email: c.customer?.email || c.billing_details?.email || "",
    amount: c.amount / 100,
    reason: c.outcome?.seller_message || c.failure_message || "no reason given",
    date: localDate(c.created),
  }));
}

// A short text message, ready to send as an SMS or WhatsApp.
export function failedPaymentsMessage(failed: FailedPayment[]): string {
  const lines = failed.map((f) => `• ${f.customer}: $${f.amount.toFixed(2)} (${f.reason})`);
  return `${failed.length} failed payment${failed.length > 1 ? "s" : ""} in the last 24h:\n${lines.join("\n")}`;
}
