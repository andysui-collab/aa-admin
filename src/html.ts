// Renders the report as a single self-contained HTML page (no external files).

import type { Account } from "./accounts.js";
import { START_DATE, TIMEZONE } from "./config.js";
import { accountName, accountStudents, familyLessons, type Report } from "./report.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const hrs = (n: number) => (Math.round(n * 100) / 100).toString();
const signed = (n: number) => (n > 0 ? `+${hrs(n)}` : hrs(n));
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

const STATUS_CLASS: Record<Account["status"], string> = {
  "Overbilled": "over",
  "Underbilled": "under",
  "Prepaid program": "prepaid",
  "No lessons in Clients tab": "blank",
  "OK": "ok",
};

function accountRows(accounts: Account[]): string {
  return accounts.map((a, i) => {
    const dollars = a.pricePerHour ? money(a.balance * a.pricePerHour) : "?";
    const events = [...a.events].sort((x, y) => x.date.localeCompare(y.date)).map((e) => `
      <tr><td>${esc(e.date)}</td><td>${esc(e.kind)}</td><td>${esc(e.description)}</td>
      <td class="num">${money(e.amount)}</td><td class="num">${e.hours === null ? "<em>needs review</em>" : hrs(e.hours)}</td></tr>`).join("");
    const lessons = a.families.flatMap((f) => f.clients).map((c) =>
      `${esc(c.studentName)}: ${c.maths} maths + ${c.english} English (Clients row ${c.row})`).join("<br>");
    return `
    <tr class="account" data-target="d${i}" tabindex="0">
      <td><span class="chip ${STATUS_CLASS[a.status]}">${esc(a.status)}</span></td>
      <td><strong>${esc(accountStudents(a))}</strong><div class="sub">${esc(accountName(a))}</div></td>
      <td class="num">${hrs(a.billedHours)}</td>
      <td class="num">${hrs(a.creditedHours)}</td>
      <td class="num strong">${hrs(a.netBilledHours)}</td>
      <td class="num">${hrs(a.deliveredHours)}</td>
      <td class="num strong">${signed(a.balance)}</td>
      <td class="num">${dollars}</td>
    </tr>
    <tr class="detail" id="d${i}" hidden><td colspan="8">
      <p><strong>Lessons delivered:</strong><br>${lessons}</p>
      <p><strong>Plan:</strong> ${a.weeklyPlanHours ? `${hrs(a.weeklyPlanHours)} hrs/week` : "no live subscription"}
        ${a.unconvertedAmount ? ` · <strong>${money(a.unconvertedAmount)}</strong> couldn't be converted to hours` : ""}</p>
      <div class="scroll"><table class="events"><thead><tr><th>Date</th><th>Type</th><th>Stripe item</th><th class="num">$</th><th class="num">Hours</th></tr></thead>
      <tbody>${events}</tbody></table></div>
    </td></tr>`;
  }).join("");
}

function accountTable(accounts: Account[]): string {
  if (!accounts.length) return `<p class="empty">None.</p>`;
  return `<div class="scroll"><table>
    <thead><tr><th>Status</th><th>Family</th><th class="num">Billed</th><th class="num">Refunded</th>
    <th class="num">Net billed</th><th class="num">Delivered</th><th class="num">Balance (hrs)</th><th class="num">≈ $</th></tr></thead>
    <tbody>${accountRows(accounts)}</tbody></table></div>`;
}

function simpleTable(header: string[], rows: unknown[][]): string {
  if (!rows.length) return `<p class="empty">None.</p>`;
  return `<div class="scroll"><table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderReport(report: Report): string {
  const generated = new Date().toLocaleString("en-AU", { timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short" });
  const ok = report.accounts.filter((a) => a.status === "OK").sort((a, b) => b.balance - a.balance);
  const countOf = (status: Account["status"]) => report.accounts.filter((a) => a.status === status).length;
  const stat = (label: string, value: number, cls = "") => `<div class="stat ${cls}"><div class="value">${value}</div><div class="label">${esc(label)}</div></div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Billing Reconciliation</title>
<style>
:root { --bg:#f7f7f5; --card:#fff; --text:#1d1d1b; --muted:#6b6b66; --line:#e4e4df;
  --ok:#1f7a4d; --ok-bg:#e3f3ea; --over:#9a5b00; --over-bg:#fdf0d9; --under:#b42318; --under-bg:#fde7e5;
  --prepaid:#1d5fa8; --prepaid-bg:#e2eefb; --blank:#5c5c57; --blank-bg:#ecece8; }
@media (prefers-color-scheme: dark) { :root { --bg:#141413; --card:#1e1e1c; --text:#ecece8; --muted:#a3a39c; --line:#33332f;
  --ok:#6fd3a0; --ok-bg:#163526; --over:#f2b65a; --over-bg:#3a2a10; --under:#f59a90; --under-bg:#3d1a17;
  --prepaid:#8cbcf2; --prepaid-bg:#152a42; --blank:#c2c2bb; --blank-bg:#2b2b28; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:24px; margin:0 0 4px; } h2 { font-size:18px; margin:32px 0 6px; }
.lede, .sub, .hint { color:var(--muted); } .sub { font-size:13px; } .hint { margin:0 0 10px; font-size:14px; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; margin:20px 0; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.stat .value { font-size:26px; font-weight:650; } .stat .label { color:var(--muted); font-size:13px; }
.stat.over .value { color:var(--over); } .stat.under .value { color:var(--under); } .stat.prepaid .value { color:var(--prepaid); }
.scroll { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:10px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th, td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:600; white-space:nowrap; }
tbody tr:last-child td { border-bottom:none; }
.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; } .strong { font-weight:650; }
tr.account { cursor:pointer; } tr.account:hover, tr.account:focus { background:var(--bg); outline:none; }
tr.detail > td { background:var(--bg); } tr.detail p { margin:4px 0 10px; }
table.events { font-size:13px; } table.events td, table.events th { padding:6px 10px; }
.chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
.chip.ok { color:var(--ok); background:var(--ok-bg); } .chip.over { color:var(--over); background:var(--over-bg); }
.chip.under { color:var(--under); background:var(--under-bg); } .chip.prepaid { color:var(--prepaid); background:var(--prepaid-bg); }
.chip.blank { color:var(--blank); background:var(--blank-bg); }
.empty { color:var(--muted); }
</style></head>
<body><main>
<h1>Billing reconciliation</h1>
<p class="lede">Net billed (hours billed in Stripe since ${esc(START_DATE)}, less refunds and credits) vs lessons delivered (Clients tab, maths + English).
Positive balance = paid for lessons not yet had. Updated ${esc(generated)}.</p>

<div class="stats">
  ${stat("Families reconciled", report.accounts.length)}
  ${stat("Overbilled", countOf("Overbilled"), "over")}
  ${stat("Underbilled", countOf("Underbilled"), "under")}
  ${stat("Prepaid program", countOf("Prepaid program"), "prepaid")}
  ${stat("No lessons in Clients tab", countOf("No lessons in Clients tab"))}
</div>

<h2>Needs attention</h2>
<p class="hint">Balances within one week of a family's plan are normal billing timing and aren't listed here. Tap a family to see every Stripe item.</p>
${accountTable(report.flagged)}

<h2>Live subscriptions with no Clients row</h2>
<p class="hint">Being billed but not linked to the Clients tab. Add the match to the Stripe Links tab, or they may not be onboarded yet.</p>
${simpleTable(["Stripe customer", "Email", "Plan hrs/wk", "Hours billed", "$ billed", "First billed", "Last billed"],
  report.unmatchedLiveCustomers.map((u) => [u.customer.name, u.customer.email, u.customer.weeklyPlanHours, hrs(u.hoursBilled), money(u.amountBilled), u.firstBilled, u.lastBilled]))}

<h2>Clients with no Stripe customer</h2>
${simpleTable(["Parent email", "Parent", "Students", "Lessons", "Possible match"],
  report.unmatchedClients.map((m) => [m.family.key, m.family.parentName, m.family.clients.map((c) => c.studentName).join(", "), familyLessons(m),
    m.suggestion ? `${m.suggestion.customer.name} <${m.suggestion.customer.email}> ${m.suggestion.customer.id}` : "—"]))}

${report.issues.length ? `<h2>Clients tab issues</h2>${simpleTable(["Row", "Student", "Problem"], report.issues.map((i) => [i.row, i.student, i.problem]))}` : ""}

<h2>All OK (${ok.length})</h2>
${accountTable(ok)}
</main>
<script>
document.querySelectorAll("tr.account").forEach((row) => {
  const toggle = () => { const d = document.getElementById(row.dataset.target); d.hidden = !d.hidden; };
  row.addEventListener("click", toggle);
  row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
});
</script>
</body></html>`;
}
