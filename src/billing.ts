// Turns Stripe invoices, refunds and credits into "billing events" measured in lesson hours.

import { NAME_RULES, ONE_OFF_PAYMENT_HOURS, PRICE_HOURS, PROGRAM_DOLLARS_PER_HOUR, START_DATE, TIMEZONE, TRIAL_COUNTS_AS_BILLED } from "./config.js";
import { stripeGet, stripeListAll, toUnix } from "./stripe.js";

export interface Customer {
  id: string;
  name: string;
  email: string;
  weeklyPlanHours: number; // from live subscriptions; 0 if none
}

export interface BillingEvent {
  customerId: string;
  date: string; // YYYY-MM-DD, local time
  kind: "subscription" | "trial" | "one-off" | "proration" | "refund" | "credit";
  description: string;
  amount: number; // dollars; negative for refunds and credits
  hours: number | null; // negative for refunds and credits; null = couldn't convert to hours
}

export const localDate = (unix: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date(unix * 1000));

export function hoursPerUnit(priceId: string | undefined, name: string): number | null {
  if (priceId && priceId in PRICE_HOURS) return PRICE_HOURS[priceId];
  for (const [pattern, hours] of NAME_RULES) if (pattern.test(name)) return hours;
  return null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

export async function fetchBilling(): Promise<{ customers: Map<string, Customer>; events: BillingEvent[] }> {
  const since = { "created[gte]": toUnix(START_DATE) };
  const [prices, rawCustomers, subscriptions, invoices, charges, refunds, creditNotes] = await Promise.all([
    stripeListAll<any>("prices", { "expand[]": "data.product" }),
    stripeListAll<any>("customers"),
    stripeListAll<any>("subscriptions", { status: "all" }),
    stripeListAll<any>("invoices", { status: "paid", ...since }),
    stripeListAll<any>("charges", since),
    stripeListAll<any>("refunds", { "expand[]": "data.charge", ...since }),
    stripeListAll<any>("credit_notes", since),
  ]);

  const productName = new Map<string, string>(prices.map((p) => [p.id, p.product?.name ?? p.nickname ?? ""]));

  const customers = new Map<string, Customer>(rawCustomers.map((c) => [c.id, {
    id: c.id,
    name: c.name ?? "",
    email: (c.email ?? "").toLowerCase(),
    weeklyPlanHours: 0,
  }]));

  for (const sub of subscriptions) {
    if (!["active", "trialing", "past_due"].includes(sub.status)) continue;
    const customer = customers.get(sub.customer);
    if (!customer) continue;
    for (const item of sub.items.data) {
      const perUnit = hoursPerUnit(item.price.id, productName.get(item.price.id) ?? "");
      customer.weeklyPlanHours += (perUnit ?? 0) * (item.quantity ?? 1);
    }
  }

  const events: BillingEvent[] = [];

  for (const invoice of invoices) {
    let lines = invoice.lines.data;
    if (invoice.lines.has_more) lines = await stripeListAll<any>(`invoices/${invoice.id}/lines`);
    for (const line of lines) {
      const priceId: string | undefined = line.price?.id ?? line.pricing?.price_details?.price;
      const name = (priceId && productName.get(priceId)) || line.description || "";
      const quantity = line.quantity ?? 1;
      const isSubscription = line.type === "subscription" || !!line.subscription;
      const isProration = line.proration || line.parent?.subscription_item_details?.proration;
      const isTrial = /^trial period/i.test(line.description ?? "");
      const perUnit = hoursPerUnit(priceId, name);
      const programRate = PROGRAM_DOLLARS_PER_HOUR.find(([pattern]) => pattern.test(name))?.[1];

      let kind: BillingEvent["kind"] = isSubscription ? "subscription" : "one-off";
      let hours = programRate ? line.amount / 100 / programRate : perUnit === null ? null : perUnit * quantity;
      if (isProration) { kind = "proration"; hours = null; }
      else if (isTrial) { kind = "trial"; if (!TRIAL_COUNTS_AS_BILLED) hours = 0; }
      // A $0 one-off line (e.g. a waived item) that isn't a trial doesn't count as a lesson.
      if (line.amount === 0 && !isTrial) continue;

      events.push({
        customerId: invoice.customer,
        date: localDate(isSubscription && line.period?.start ? line.period.start : invoice.created),
        kind,
        description: line.description || name,
        amount: line.amount / 100,
        hours,
      });
    }
  }

  // Payments with no invoice (payment links) often have no Stripe customer either,
  // so we use the customer with the same email, or a stand-in "guest" customer.
  const byEmail = new Map([...customers.values()].filter((c) => c.email).map((c) => [c.email, c.id]));
  const customerIdForCharge = (charge: any): string | undefined => {
    if (typeof charge.customer === "string") return charge.customer;
    const email = (charge.billing_details?.email ?? charge.receipt_email ?? "").toLowerCase();
    if (!email) return undefined;
    if (byEmail.has(email)) return byEmail.get(email);
    const id = `guest:${email}`;
    if (!customers.has(id)) customers.set(id, { id, name: charge.billing_details?.name ?? "", email, weeklyPlanHours: 0 });
    return id;
  };

  for (const charge of charges) {
    if (charge.status !== "succeeded" || charge.invoice) continue;
    const customerId = customerIdForCharge(charge);
    if (!customerId) continue;
    const description = charge.description || "Payment without invoice";
    const fromDescription = description.match(/(\d+(?:\.\d+)?)\s*(?:\w+\s+)?(?:sessions?|lessons?|hours?)/i)?.[1];
    events.push({
      customerId,
      date: localDate(charge.created),
      kind: "one-off",
      description,
      amount: charge.amount / 100,
      hours: fromDescription ? Number(fromDescription) : ONE_OFF_PAYMENT_HOURS[charge.amount / 100] ?? null,
    });
  }

  // Refund hours are filled in later using each family's own price per hour.
  for (const refund of refunds) {
    const customerId = refund.status === "succeeded" && refund.charge ? customerIdForCharge(refund.charge) : undefined;
    if (!customerId) continue;
    events.push({
      customerId,
      date: localDate(refund.created),
      kind: "refund",
      description: refund.reason ? `Refund (${refund.reason})` : "Refund",
      amount: -refund.amount / 100,
      hours: null,
    });
  }

  for (const note of creditNotes) {
    if (note.status === "void") continue;
    // The refunded part of a credit note already appears in the refunds list above.
    const credited = note.refund_amount != null
      ? (note.credit_amount ?? 0) + (note.out_of_band_amount ?? 0)
      : note.refund ? 0 : note.total;
    if (!credited) continue;
    events.push({
      customerId: note.customer,
      date: localDate(note.created),
      kind: "credit",
      description: `Credit note ${note.number ?? note.id}`,
      amount: -credited / 100,
      hours: null,
    });
  }

  // Manual balance credits (Customer > Balance > Adjust) for customers billed in the period.
  const billedCustomerIds = [...new Set(invoices.map((i) => i.customer as string))];
  await mapLimit(billedCustomerIds, 8, async (customerId) => {
    const txns = await stripeGet<{ data: any[] }>(`customers/${customerId}/balance_transactions`, { limit: 100 });
    for (const txn of txns.data) {
      if (txn.type !== "adjustment" || txn.created < toUnix(START_DATE)) continue;
      events.push({
        customerId,
        date: localDate(txn.created),
        kind: "credit",
        description: txn.description ? `Balance adjustment: ${txn.description}` : "Balance adjustment",
        amount: txn.amount / 100, // negative amount = credit given to the customer
        hours: null,
      });
    }
  });

  return { customers, events };
}
