// Combines billing events and lessons into one running balance per family account.
// Balance (hours) = billed - refunded/credited - delivered.
//   positive = family has paid for lessons they haven't had (overbilled / prepaid)
//   negative = family has had lessons they haven't paid for (underbilled)

import { TIMEZONE, TOLERANCE_WEEKS } from "./config.js";
import type { BillingEvent, Customer } from "./billing.js";
import type { Family, Match } from "./match.js";
import type { Lesson } from "./sheets.js";

export interface WeekRow {
  week: string; // Monday, YYYY-MM-DD
  billedHours: number;
  billedAmount: number;
  creditedHours: number; // refunds and credits, as a negative number
  creditedAmount: number;
  deliveredHours: number;
  balance: number; // running balance at end of week
}

export interface Account {
  customers: Customer[];
  families: Family[];
  events: BillingEvent[];
  lessons: Lesson[];
  weeks: WeekRow[];
  weeklyPlanHours: number;
  pricePerHour: number | null;
  billedHours: number;
  creditedHours: number;
  deliveredHours: number;
  balance: number;
  unconvertedAmount: number; // dollars we couldn't turn into hours
  status: "OK" | "Overbilled" | "Prepaid program" | "Underbilled";
  lastLesson: string | null;
  lastBilled: string | null;
}

export function mondayOf(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

const round = (n: number) => Math.round(n * 100) / 100;

export function buildAccounts(matches: Match[], customers: Map<string, Customer>, events: BillingEvent[]): Account[] {
  // Families sharing a Stripe customer (e.g. siblings) become one account.
  const accountOf = new Map<string, Account>();
  const accounts: Account[] = [];
  for (const match of matches) {
    if (!match.customerIds.length) continue;
    let account = match.customerIds.map((id) => accountOf.get(id)).find(Boolean);
    if (!account) {
      account = { customers: [], families: [], events: [], lessons: [] } as unknown as Account;
      accounts.push(account);
    }
    account.families.push(match.family);
    account.lessons.push(...match.family.lessons);
    for (const id of match.customerIds) {
      const customer = customers.get(id);
      if (customer && !accountOf.has(id)) { account.customers.push(customer); accountOf.set(id, account); }
    }
  }
  for (const event of events) accountOf.get(event.customerId)?.events.push(event);

  for (const account of accounts) {
    const { events, lessons } = account;
    account.weeklyPlanHours = account.customers.reduce((sum, c) => sum + c.weeklyPlanHours, 0);

    // Price per hour from this family's own subscription payments, to convert refunds into hours.
    const paid = events.filter((e) => e.kind === "subscription" && e.hours && e.amount > 0);
    const paidHours = paid.reduce((s, e) => s + (e.hours ?? 0), 0);
    account.pricePerHour = paidHours ? paid.reduce((s, e) => s + e.amount, 0) / paidHours : null;
    for (const e of events) {
      if ((e.kind === "refund" || e.kind === "credit") && account.pricePerHour) e.hours = round(e.amount / account.pricePerHour);
    }

    const byWeek = new Map<string, WeekRow>();
    const week = (date: string) => {
      const key = mondayOf(date);
      if (!byWeek.has(key)) byWeek.set(key, {
        week: key, billedHours: 0, billedAmount: 0, creditedHours: 0, creditedAmount: 0, deliveredHours: 0, balance: 0,
      });
      return byWeek.get(key)!;
    };
    account.unconvertedAmount = 0;
    for (const e of events) {
      const row = week(e.date);
      if (e.hours === null) { account.unconvertedAmount += e.amount; continue; }
      if (e.kind === "refund" || e.kind === "credit") { row.creditedHours += e.hours; row.creditedAmount += e.amount; }
      else { row.billedHours += e.hours; row.billedAmount += e.amount; }
    }
    for (const l of lessons) week(l.date).deliveredHours += l.hours;

    let running = 0;
    account.weeks = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
    for (const row of account.weeks) {
      running += row.billedHours + row.creditedHours - row.deliveredHours;
      row.balance = round(running);
    }

    account.billedHours = round(account.weeks.reduce((s, w) => s + w.billedHours, 0));
    account.creditedHours = round(account.weeks.reduce((s, w) => s + w.creditedHours, 0));
    account.deliveredHours = round(account.weeks.reduce((s, w) => s + w.deliveredHours, 0));
    account.balance = round(running);
    account.unconvertedAmount = round(account.unconvertedAmount);

    const tolerance = Math.max(account.weeklyPlanHours, 1) * TOLERANCE_WEEKS;
    // Hours left on a prepaid program/package aren't overbilling, but still worth seeing.
    // Any single payment of $1,000+ is treated as a package.
    const hasProgram = events.some((e) => /transformation|package/i.test(e.description) || e.amount >= 1000);
    account.status = account.balance > tolerance ? (hasProgram ? "Prepaid program" : "Overbilled")
      : account.balance < -tolerance ? "Underbilled" : "OK";
    account.lastLesson = lessons.map((l) => l.date).sort().at(-1) ?? null;
    account.lastBilled = events.filter((e) => e.amount > 0).map((e) => e.date).sort().at(-1) ?? null;
  }
  return accounts;
}

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());
