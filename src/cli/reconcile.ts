// npm run reconcile
// Compares total hours billed in Stripe with total lessons delivered (Clients tab, columns O + P)
// and writes a report to out/ (gitignored: contains personal data).

import { mkdirSync, writeFileSync } from "node:fs";
import { buildAccounts, today, type Account } from "../accounts.js";
import { fetchBilling } from "../billing.js";
import { START_DATE } from "../config.js";
import { groupFamilies, matchFamilies, OVERRIDES_PATH, readIgnored } from "../match.js";
import { fetchClients } from "../sheets.js";

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const mdCell = (v: unknown) => String(v ?? "").replace(/\|/g, "/");
const mdTable = (header: string[], rows: unknown[][]) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");
const fmtH = (h: number) => (h > 0 ? `+${h}` : `${h}`);
const accountName = (a: Account) => [...new Set(a.customers.map((c) => c.name.trim() || c.email))].join(" / ");
const students = (a: Account) => a.families.flatMap((f) => f.clients.map((c) => c.studentName)).join(", ");

console.log("Fetching Clients tab and Stripe...");
const [{ clients, issues }, { customers, events }] = await Promise.all([fetchClients(), fetchBilling()]);
console.log(`  ${clients.length} clients, ${customers.size} Stripe customers, ${events.length} billing events`);

const billedCustomerIds = new Set(events.filter((e) => e.amount > 0).map((e) => e.customerId));
const families = groupFamilies(clients);
const matches = matchFamilies(families, customers, billedCustomerIds);
const accounts = buildAccounts(matches, customers, events);

const ignored = readIgnored();
const matchedCustomerIds = new Set(matches.flatMap((m) => m.customerIds));
const billedButUnmatched = [...billedCustomerIds]
  .filter((id) => !matchedCustomerIds.has(id) && !ignored.has(id))
  .map((id) => customers.get(id)!);
const billedSummary = (id: string) => {
  const billed = events.filter((e) => e.customerId === id && e.amount > 0);
  const dates = billed.map((e) => e.date).sort();
  return [billed.reduce((s, e) => s + (e.hours ?? 0), 0), `$${billed.reduce((s, e) => s + e.amount, 0).toFixed(0)}`, dates[0], dates.at(-1)];
};

mkdirSync("out", { recursive: true });

// --- matches.csv: review this, then copy corrections into data/overrides.csv
writeFileSync("out/matches.csv", toCsv([
  ["family_key", "parent", "students", "lessons_delivered", "method", "stripe_customer_ids", "stripe_names", "suggested_customer_id", "suggested_name", "suggested_email", "score"],
  ...matches.map((m) => [
    m.family.key, m.family.parentName, m.family.clients.map((c) => c.studentName).join("; "),
    m.family.clients.reduce((s, c) => s + c.maths + c.english, 0),
    m.method, m.customerIds.join(";"), m.customerIds.map((id) => customers.get(id)?.name).join("; "),
    m.suggestion?.customer.id, m.suggestion?.customer.name, m.suggestion?.customer.email, m.suggestion?.score.toFixed(2),
  ]),
]));

// --- billing-events.csv: every Stripe item behind each family's billed total, for checking
writeFileSync("out/billing-events.csv", toCsv([
  ["account", "students", "date", "kind", "description", "amount_$", "hours"],
  ...accounts.flatMap((a) => [...a.events].sort((x, y) => x.date.localeCompare(y.date)).map((e) => [
    accountName(a), students(a), e.date, e.kind, e.description, e.amount.toFixed(2), e.hours ?? "needs review",
  ])),
]));

// --- summary.md
const flagged = accounts.filter((a) => a.status !== "OK").sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
const accountRow = (a: Account) => [
  a.status, accountName(a), students(a), a.weeklyPlanHours || "none live",
  a.billedHours, a.creditedHours, a.deliveredHours, `**${fmtH(a.balance)}**`,
  a.pricePerHour ? `$${(a.balance * a.pricePerHour).toFixed(0)}` : "?",
  a.unconvertedAmount ? `$${a.unconvertedAmount}` : "",
  a.lastBilled,
];
const accountHeader = ["Status", "Stripe customer", "Students", "Plan hrs/wk", "Billed", "Refunded", "Delivered", "Balance (hrs)", "≈ $", "Needs review $", "Last billed"];
const count = (method: string) => matches.filter((m) => m.method === method).length;
const liveButUnmatched = billedButUnmatched.filter((c) => c.weeklyPlanHours > 0);

const summary = `# Billing reconciliation — ${today()}

Total hours billed in Stripe since ${START_DATE} vs total lessons delivered (Clients tab, maths + English; 1 lesson = 1 hour).
**Positive balance** = family paid for lessons they haven't had. **Negative** = lessons not yet paid for.
Balances within ±1 week of the family's plan are treated as normal billing/lesson timing.

## Overview
- Families in Clients tab: **${families.length}** — matched by email: ${count("email")}, by override: ${count("override")}, name suggestions to confirm: ${count("suggested")}, no match: ${count("none")}
- Accounts reconciled: **${accounts.length}** — OK: ${accounts.length - flagged.length}, **flagged: ${flagged.length}**
- Stripe customers billed in period with no matched client: **${billedButUnmatched.length}** (${liveButUnmatched.length} still have a live subscription)
- Clients tab issues: **${issues.length}**

## Flagged accounts
${flagged.length ? mdTable(accountHeader, flagged.map(accountRow)) : "None."}

## Live subscriptions with no client matched
Being billed, but not linked to a row in the Clients tab: either a matching gap (fix in \`${OVERRIDES_PATH}\`) or not yet onboarded.

${mdTable(["Customer", "Email", "Plan hrs/wk", "Hours billed", "$ billed", "First billed", "Last billed"],
  liveButUnmatched.map((c) => [c.name, c.email, c.weeklyPlanHours, ...billedSummary(c.id)]))}

## Clients with no Stripe match
${mdTable(["Family key", "Parent", "Students", "Lessons", "Suggested match", "Score"],
  matches.filter((m) => !m.customerIds.length).map((m) => [
    m.family.key, m.family.parentName, m.family.clients.map((c) => c.studentName).join(", "),
    m.family.clients.reduce((s, c) => s + c.maths + c.english, 0),
    m.suggestion ? `${m.suggestion.customer.name} <${m.suggestion.customer.email}> (${m.suggestion.customer.id})` : "—",
    m.suggestion?.score.toFixed(2) ?? "",
  ]))}

## Clients tab issues
${issues.length ? mdTable(["Row", "Student", "Problem"], issues.map((i) => [i.row, i.student, i.problem])) : "None."}

## All accounts
${mdTable(accountHeader, [...accounts].sort((a, b) => b.balance - a.balance).map(accountRow))}
`;
writeFileSync("out/summary.md", summary);

console.log(`\nAccounts: ${accounts.length}, flagged: ${flagged.length}, unmatched clients: ${count("none") + count("suggested")}, billed-but-unmatched customers: ${billedButUnmatched.length}`);
console.log("Wrote out/summary.md, out/billing-events.csv, out/matches.csv");
