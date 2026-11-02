// npm run reconcile
// Runs the same reconciliation as the website's button and saves it to out/ (gitignored: contains personal data):
//   out/report.html          the report page
//   out/matches.csv          which Clients rows were linked to which Stripe customers, and how
//   out/billing-events.csv   every Stripe item behind each family's billed hours

import { mkdirSync, writeFileSync } from "node:fs";
import { renderPage } from "../html.js";
import { toSnapshot } from "../snapshot.js";
import { accountName, accountStudents, buildReport, familyLessons } from "../report.js";

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

console.log("Fetching Clients tab and Stripe...");
const report = await buildReport();

mkdirSync("out", { recursive: true });
writeFileSync("out/report.html", renderPage(toSnapshot(report), { canReconcile: false }));

writeFileSync("out/matches.csv", toCsv([
  ["family_key", "parent", "students", "lessons_delivered", "method", "stripe_customer_ids", "suggested_customer_id", "suggested_name", "suggested_email", "score"],
  ...report.matches.map((m) => [
    m.family.key, m.family.parentName, m.family.clients.map((c) => c.studentName).join("; "), familyLessons(m),
    m.method, m.customerIds.join(";"),
    m.suggestion?.customer.id, m.suggestion?.customer.name, m.suggestion?.customer.email, m.suggestion?.score.toFixed(2),
  ]),
]));

writeFileSync("out/billing-events.csv", toCsv([
  ["account", "students", "date", "kind", "description", "amount_$", "hours"],
  ...report.accounts.flatMap((a) => [...a.events].sort((x, y) => x.date.localeCompare(y.date)).map((e) => [
    accountName(a), accountStudents(a), e.date, e.kind, e.description, e.amount.toFixed(2), e.hours ?? "needs review",
  ])),
]));

console.log(`Families reconciled: ${report.accounts.length}, needing attention: ${report.flagged.length}, ` +
  `clients with no Stripe match: ${report.unmatchedClients.length}, live subscriptions with no client: ${report.unmatchedLiveCustomers.length}`);
console.log("Wrote out/report.html, out/matches.csv, out/billing-events.csv");
