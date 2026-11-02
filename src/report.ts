// Builds the reconciliation report. Used by both the command line (npm run reconcile) and the website.

import { buildAccounts, type Account } from "./accounts.js";
import { fetchBilling, type BillingEvent, type Customer } from "./billing.js";
import { groupFamilies, loadLinks, matchFamilies, type Match } from "./match.js";
import { fetchClients, type ClientIssue } from "./sheets.js";

export interface UnmatchedCustomer {
  customer: Customer;
  hoursBilled: number;
  amountBilled: number;
  firstBilled: string;
  lastBilled: string;
}

export interface Report {
  accounts: Account[];
  flagged: Account[]; // not OK, biggest balance first
  matches: Match[];
  unmatchedClients: Match[];
  unmatchedLiveCustomers: UnmatchedCustomer[]; // live subscription, but no Clients row linked
  unmatchedCustomerCount: number; // billed in period (live or not), no Clients row linked
  issues: ClientIssue[];
  events: BillingEvent[];
}

export const accountName = (a: Account) => [...new Set(a.customers.map((c) => c.name.trim() || c.email))].join(" / ");
export const accountStudents = (a: Account) => a.families.flatMap((f) => f.clients.map((c) => c.studentName)).join(", ");
export const familyLessons = (m: Match) => m.family.clients.reduce((s, c) => s + c.maths + c.english, 0);

export async function buildReport(): Promise<Report> {
  const [{ clients, issues }, { customers, events }, links] = await Promise.all([fetchClients(), fetchBilling(), loadLinks()]);

  const billedCustomerIds = new Set(events.filter((e) => e.amount > 0).map((e) => e.customerId));
  const matches = matchFamilies(groupFamilies(clients), customers, billedCustomerIds, links);
  const accounts = buildAccounts(matches, customers, events);

  const matchedCustomerIds = new Set(matches.flatMap((m) => m.customerIds));
  const unmatchedCustomerIds = [...billedCustomerIds].filter((id) => !matchedCustomerIds.has(id) && !links.ignored.has(id));
  const unmatchedLiveCustomers = unmatchedCustomerIds
    .map((id) => customers.get(id)!)
    .filter((c) => c.weeklyPlanHours > 0)
    .map((customer) => {
      const billed = events.filter((e) => e.customerId === customer.id && e.amount > 0);
      const dates = billed.map((e) => e.date).sort();
      return {
        customer,
        hoursBilled: billed.reduce((s, e) => s + (e.hours ?? 0), 0),
        amountBilled: billed.reduce((s, e) => s + e.amount, 0),
        firstBilled: dates[0],
        lastBilled: dates[dates.length - 1],
      };
    });

  return {
    accounts,
    flagged: accounts.filter((a) => a.status !== "OK").sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    matches,
    unmatchedClients: matches.filter((m) => !m.customerIds.length),
    unmatchedLiveCustomers,
    unmatchedCustomerCount: unmatchedCustomerIds.length,
    issues,
    events,
  };
}
