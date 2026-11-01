// npm run failed-payments
// Lists payments that failed in the last 24 hours. Prints nothing if there were none.
// (Sending the SMS comes next; for now this prints the message that would be sent.)

import { stripeListAll } from "../stripe.js";
import { localDate } from "../billing.js";

const since = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
const charges = await stripeListAll<any>("charges", { "created[gte]": since, "expand[]": "data.customer" });
const failed = charges.filter((c) => c.status === "failed");

if (failed.length) {
  const lines = failed.map((c) => {
    const who = c.customer?.name || c.customer?.email || c.billing_details?.email || "Unknown customer";
    const reason = c.outcome?.seller_message || c.failure_message || "no reason given";
    return `• ${who}: $${(c.amount / 100).toFixed(2)} (${reason})`;
  });
  console.log(`${failed.length} failed payment${failed.length > 1 ? "s" : ""} in the last 24h (to ${localDate(Date.now() / 1000)}):\n${lines.join("\n")}`);
}
