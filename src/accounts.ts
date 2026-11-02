// Totals per family account.
// Balance (hours) = net billed (billed - refunded/credited) - delivered (Clients tab maths + English, 1 lesson = 1 hour).
//   positive = family has paid for lessons they haven't had (overbilled / prepaid)
//   negative = family has had lessons they haven't paid for (underbilled)

import { TIMEZONE, TOLERANCE_WEEKS } from "./config.js";
import type { BillingEvent, Customer } from "./billing.js";
import type { Family, Match } from "./match.js";

export interface Account {
  customers: Customer[];
  families: Family[];
  events: BillingEvent[];
  weeklyPlanHours: number;
  pricePerHour: number | null;
  billedHours: number;
  creditedHours: number; // refunds and credits, as a negative number
  netBilledHours: number; // billed - refunded/credited: the number to compare with lessons delivered
  deliveredHours: number;
  balance: number;
  unconvertedAmount: number; // dollars we couldn't turn into hours
  status: "OK" | "Overbilled" | "Prepaid program" | "Underbilled" | "No lessons in Clients tab";
  hasProgram: boolean; // paid for a prepaid program/package at some point
  lastBilled: string | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildAccounts(matches: Match[], customers: Map<string, Customer>, events: BillingEvent[]): Account[] {
  // Families sharing a Stripe customer become one account.
  const accountOf = new Map<string, Account>();
  const accounts: Account[] = [];
  for (const match of matches) {
    if (!match.customerIds.length) continue;
    let account = match.customerIds.map((id) => accountOf.get(id)).find(Boolean);
    if (!account) {
      account = { customers: [], families: [], events: [] } as unknown as Account;
      accounts.push(account);
    }
    account.families.push(match.family);
    for (const id of match.customerIds) {
      const customer = customers.get(id);
      if (customer && !accountOf.has(id)) { account.customers.push(customer); accountOf.set(id, account); }
    }
  }
  for (const event of events) accountOf.get(event.customerId)?.events.push(event);

  for (const account of accounts) {
    const { events } = account;
    account.weeklyPlanHours = account.customers.reduce((sum, c) => sum + c.weeklyPlanHours, 0);

    // Price per hour from this family's own subscription payments, to convert refunds into hours.
    const paid = events.filter((e) => e.kind === "subscription" && e.hours && e.amount > 0);
    const paidHours = paid.reduce((s, e) => s + (e.hours ?? 0), 0);
    account.pricePerHour = paidHours ? paid.reduce((s, e) => s + e.amount, 0) / paidHours : null;
    for (const e of events) {
      if ((e.kind === "refund" || e.kind === "credit") && account.pricePerHour) e.hours = round(e.amount / account.pricePerHour);
    }

    const sumHours = (list: BillingEvent[]) => round(list.reduce((s, e) => s + (e.hours ?? 0), 0));
    const isCredit = (e: BillingEvent) => e.kind === "refund" || e.kind === "credit";
    account.billedHours = sumHours(events.filter((e) => !isCredit(e)));
    account.creditedHours = sumHours(events.filter(isCredit));
    account.netBilledHours = round(account.billedHours + account.creditedHours);
    account.deliveredHours = account.families.flatMap((f) => f.clients).reduce((s, c) => s + c.maths + c.english, 0);
    account.balance = round(account.netBilledHours - account.deliveredHours);
    account.unconvertedAmount = round(events.filter((e) => e.hours === null).reduce((s, e) => s + e.amount, 0));

    // Billing and lessons fall on different days, so a gap within one week of the plan is normal timing.
    // Any single payment of $1,000+ is treated as a prepaid program/package.
    const tolerance = Math.max(account.weeklyPlanHours, 1) * TOLERANCE_WEEKS;
    const hasProgram = account.hasProgram = events.some((e) => /transformation|package/i.test(e.description) || e.amount >= 1000);
    // Blank maths/English counts usually mean the Clients tab hasn't been filled in, not overbilling.
    account.status = account.deliveredHours === 0 && account.billedHours > 0 ? "No lessons in Clients tab"
      : account.balance > tolerance ? (hasProgram ? "Prepaid program" : "Overbilled")
      : account.balance < -tolerance ? "Underbilled" : "OK";
    account.lastBilled = events.filter((e) => e.amount > 0).map((e) => e.date).sort().at(-1) ?? null;
  }
  return accounts;
}

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
