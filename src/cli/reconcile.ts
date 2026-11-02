// npm run reconcile
// Pulls Stripe + tutor sheets and writes a reconciliation report to out/ (gitignored: contains personal data).

import { mkdirSync, writeFileSync } from "node:fs";
import { fetchBilling } from "../billing.js";
import { START_DATE } from "../config.js";
import { buildAccounts, today } from "../ledger.js";
import { groupFamilies, matchFamilies, OVERRIDES_PATH, readIgnored } from "../match.js";
import { fetchClients, fetchLessons } from "../sheets.js";

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
const mdCell = (v: unknown) => String(v ?? "").replace(/\|/g, "/");
const mdTable = (header: string[], rows: unknown[][]) =>
  [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map(mdCell).join(" | ")} |`)].join("\n");
const fmtH = (h: number) => (h > 0 ? `+${h}` : `${h}`);

console.log("Fetching tutor sheets, master sheet and Stripe...");
const [{ lessons, issues }, clients, { customers, events }] = await Promise.all([fetchLessons(), fetchClients(), fetchBilling()]);
const recentLessons = lessons.filter((l) => l.date >= START_DATE);
console.log(`  ${recentLessons.length} lessons, ${clients.length} clients, ${customers.size} Stripe customers, ${events.length} billing events`);

const billedCustomerIds = new Set(events.filter((e) => e.amount > 0).map((e) => e.customerId));
const families = groupFamilies(recentLessons, clients);
const matches = matchFamilies(families, customers, billedCustomerIds);
const accounts = buildAccounts(matches, customers, events);

const matchedCustomerIds = new Set(matches.flatMap((m) => m.customerIds));
const ignored = readIgnored();
const billedButUnmatched = [...billedCustomerIds]
  .filter((id) => !matchedCustomerIds.has(id) && !ignored.has(id))
  .map((id) => customers.get(id)!);
const billedSummary = (id: string) => {
  const billed = events.filter((e) => e.customerId === id && e.amount > 0);
  const dates = billed.map((e) => e.date).sort();
  return [billed.reduce((s, e) => s + (e.hours ?? 0), 0), `$${billed.reduce((s, e) => s + e.amount, 0).toFixed(0)}`, dates[0], dates.at(-1)];
};
const liveButUnmatched = billedButUnmatched.filter((c) => c.weeklyPlanHours > 0);

mkdirSync("out", { recursive: true });

// --- matches.csv: review this, then copy corrections into data/overrides.csv
writeFileSync("out/matches.csv", toCsv([
  ["family_key", "parent", "students", "tutors", "lessons", "method", "stripe_customer_ids", "stripe_names", "suggested_customer_id", "suggested_name", "suggested_email", "score"],
  ...matches.map((m) => [
    m.family.key, m.family.parentName, [...m.family.students].join("; "), [...m.family.tutors].join("; "), m.family.lessons.length,
    m.method, m.customerIds.join(";"), m.customerIds.map((id) => customers.get(id)?.name).join("; "),
    m.suggestion?.customer.id, m.suggestion?.customer.name, m.suggestion?.customer.email, m.suggestion?.score.toFixed(2),
  ]),
]));

// --- ledger.csv: every family's week-by-week ledger
writeFileSync("out/ledger.csv", toCsv([
  ["account", "week", "billed_hours", "billed_$", "refunded_credited_hours", "refunded_credited_$", "delivered_hours", "running_balance_hours"],
  ...accounts.flatMap((a) => a.weeks.map((w) => [
    a.customers.map((c) => c.name || c.email).join(" / "), w.week, w.billedHours, w.billedAmount.toFixed(2),
    w.creditedHours, w.creditedAmount.toFixed(2), w.deliveredHours, w.balance,
  ])),
]));

// --- summary.md
const flagged = accounts.filter((a) => a.status !== "OK").sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
const accountRow = (a: (typeof accounts)[number]) => [
  a.status, a.customers.map((c) => c.name || c.email).join(" / "),
  [...new Set(a.families.flatMap((f) => [...f.students]))].join(", "),
  a.weeklyPlanHours || "none live",
  a.billedHours, a.creditedHours, a.deliveredHours, `**${fmtH(a.balance)}**`,
  a.pricePerHour ? `$${(a.balance * a.pricePerHour).toFixed(0)}` : "?",
  a.unconvertedAmount ? `$${a.unconvertedAmount}` : "",
  a.lastLesson, a.lastBilled,
];
const accountHeader = ["Status", "Stripe customer", "Students", "Plan hrs/wk", "Billed", "Refunded", "Delivered", "Balance (hrs)", "≈ $", "Needs review $", "Last lesson", "Last billed"];
const count = (method: string) => matches.filter((m) => m.method === method).length;

const summary = `# Billing reconciliation — ${today()}

Period: ${START_DATE} to today. Hours billed (Stripe) vs hours delivered (tutor sheets).
**Positive balance** = family paid for lessons they haven't had. **Negative** = lessons not yet paid for.
Balances within ±1 week of the family's plan are treated as normal billing/lesson timing.

## Overview
- Families in tutor sheets: **${families.length}** — matched by email: ${count("email")}, by override: ${count("override")}, name suggestions to confirm: ${count("suggested")}, no match: ${count("none")}
- Accounts reconciled: **${accounts.length}** — OK: ${accounts.length - flagged.length}, **flagged: ${flagged.length}**
- Stripe customers billed in period with no matched lessons: **${billedButUnmatched.length}** (${liveButUnmatched.length} still have a live subscription)
- Data issues in tutor sheets: **${issues.length}**

## Flagged accounts
${flagged.length ? mdTable(accountHeader, flagged.map(accountRow)) : "None."}

## Live subscriptions with no lessons matched
These are being billed but we can't find their lessons — either a matching gap (fix in \`${OVERRIDES_PATH}\`) or genuinely no lessons.

${mdTable(["Customer", "Email", "Plan hrs/wk", "Hours billed", "$ billed", "First billed", "Last billed"],
  liveButUnmatched.map((c) => [c.name, c.email, c.weeklyPlanHours, ...billedSummary(c.id)]))}

## Families with lessons but no Stripe match
${mdTable(["Family key", "Parent", "Students", "Lessons", "Suggested match", "Score"],
  matches.filter((m) => !m.customerIds.length).map((m) => [
    m.family.key, m.family.parentName, [...m.family.students].join(", "), m.family.lessons.length,
    m.suggestion ? `${m.suggestion.customer.name} <${m.suggestion.customer.email}> (${m.suggestion.customer.id})` : "—",
    m.suggestion?.score.toFixed(2) ?? "",
  ]))}

## Tutor sheet data issues
${issues.length ? mdTable(["Tutor", "Row", "Problem"], issues.map((i) => [i.tutor, i.row, i.problem])) : "None."}

## All accounts
${mdTable(accountHeader, [...accounts].sort((a, b) => b.balance - a.balance).map(accountRow))}
`;
writeFileSync("out/summary.md", summary);

console.log(`\nAccounts: ${accounts.length}, flagged: ${flagged.length}, unmatched families: ${count("none") + count("suggested")}, billed-but-unmatched customers: ${billedButUnmatched.length}`);
console.log("Wrote out/summary.md, out/ledger.csv, out/matches.csv");
