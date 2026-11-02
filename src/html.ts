// Renders a saved reconciliation as a single self-contained HTML page (no external files).
// Filtering, searching and sorting happen in the browser, using the data embedded in the page.

import { START_DATE, TIMEZONE } from "./config.js";
import type { Snapshot } from "./snapshot.js";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;

function simpleTable(header: string[], rows: unknown[][]): string {
  if (!rows.length) return `<p class="empty">None.</p>`;
  return `<div class="scroll"><table><thead><tr>${header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export interface PageOptions {
  canReconcile: boolean; // false when viewing a local file (no server to run the reconciliation)
  error?: string;
}

export function renderPage(snapshot: Snapshot | null, { canReconcile, error }: PageOptions): string {
  const reconciled = snapshot
    ? new Date(snapshot.reconciledAt).toLocaleString("en-AU", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
    : null;
  // Embedded as JSON for the browser script; "<" is escaped so the data can't close the <script> tag.
  const data = JSON.stringify(snapshot?.accounts ?? []).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Billing Reconciliation</title>
<style>
:root { --bg:#f7f7f5; --card:#fff; --text:#1d1d1b; --muted:#6b6b66; --line:#e4e4df; --accent:#1d1d1b; --accent-text:#fff;
  --ok:#1f7a4d; --ok-bg:#e3f3ea; --over:#9a5b00; --over-bg:#fdf0d9; --under:#b42318; --under-bg:#fde7e5;
  --prepaid:#1d5fa8; --prepaid-bg:#e2eefb; --blank:#5c5c57; --blank-bg:#ecece8; --error-bg:#fde7e5; }
@media (prefers-color-scheme: dark) { :root { --bg:#141413; --card:#1e1e1c; --text:#ecece8; --muted:#a3a39c; --line:#33332f;
  --accent:#ecece8; --accent-text:#141413;
  --ok:#6fd3a0; --ok-bg:#163526; --over:#f2b65a; --over-bg:#3a2a10; --under:#f59a90; --under-bg:#3d1a17;
  --prepaid:#8cbcf2; --prepaid-bg:#152a42; --blank:#c2c2bb; --blank-bg:#2b2b28; --error-bg:#3d1a17; } }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
main { max-width:1100px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:24px; margin:0; } h2 { font-size:18px; margin:32px 0 6px; }
.header { display:flex; flex-wrap:wrap; gap:12px; justify-content:space-between; align-items:center; }
.lede, .sub, .hint, .when { color:var(--muted); } .sub { font-size:13px; } .hint { margin:0 0 10px; font-size:14px; }
.lede { margin:8px 0 0; font-size:14px; } .when { font-size:14px; margin-top:2px; }
.reconcile { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
button, select, input { font:inherit; color:inherit; }
.btn { background:var(--accent); color:var(--accent-text); border:0; border-radius:8px; padding:10px 16px; font-weight:600; cursor:pointer; }
.btn:disabled { opacity:.6; cursor:wait; }
.error { background:var(--error-bg); color:var(--under); border-radius:8px; padding:10px 14px; margin:16px 0 0; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:20px 0 12px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; text-align:left; cursor:pointer; }
.stat[aria-pressed="true"] { outline:2px solid var(--text); outline-offset:-1px; }
.stat .value { font-size:24px; font-weight:650; display:block; } .stat .label { color:var(--muted); font-size:13px; }
.stat.over .value { color:var(--over); } .stat.under .value { color:var(--under); } .stat.prepaid .value { color:var(--prepaid); } .stat.ok .value { color:var(--ok); }
.toolbar { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 10px; }
.toolbar input, .toolbar select { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:8px 10px; min-width:0; }
.toolbar input { flex:1 1 220px; } .toolbar select { flex:0 1 auto; }
.scroll { overflow-x:auto; background:var(--card); border:1px solid var(--line); border-radius:10px; }
table { width:100%; border-collapse:collapse; font-size:14px; }
th, td { padding:9px 12px; text-align:left; border-bottom:1px solid var(--line); vertical-align:top; }
th { font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); font-weight:600; white-space:nowrap; }
th[data-sort] { cursor:pointer; user-select:none; } th[data-sort]:hover { color:var(--text); }
th .arrow { display:inline-block; width:1em; }
tbody tr:last-child td { border-bottom:none; }
.num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; } .strong { font-weight:650; }
tr.account { cursor:pointer; } tr.account:hover, tr.account:focus { background:var(--bg); outline:none; }
tr.detail > td { background:var(--bg); } tr.detail p { margin:4px 0 10px; }
table.events { font-size:13px; } table.events td, table.events th { padding:6px 10px; }
.chip { display:inline-block; padding:2px 8px; border-radius:999px; font-size:12px; font-weight:600; white-space:nowrap; }
.chip.ok { color:var(--ok); background:var(--ok-bg); } .chip.over { color:var(--over); background:var(--over-bg); }
.chip.under { color:var(--under); background:var(--under-bg); } .chip.prepaid { color:var(--prepaid); background:var(--prepaid-bg); }
.chip.blank { color:var(--blank); background:var(--blank-bg); }
.empty { color:var(--muted); } .count { color:var(--muted); font-size:14px; margin:0 0 8px; }
code { font-size:13px; background:var(--bg); padding:1px 4px; border-radius:4px; }
</style></head>
<body><main>
<div class="header">
  <div><h1>Billing reconciliation</h1>
  <div class="when">${reconciled ? `Last reconciled: <strong>${esc(reconciled)}</strong>` : "Not reconciled yet"}</div></div>
  ${canReconcile ? `<form class="reconcile" method="post" action="/api/reconcile" id="reconcile-form">
    <button class="btn" type="submit" id="reconcile-btn">Reconcile now</button>
  </form>` : ""}
</div>
${error ? `<div class="error">Reconciliation failed: ${esc(error)}</div>` : ""}
<p class="lede">Net billed (hours billed in Stripe since ${esc(START_DATE)}, less refunds and credits) vs lessons delivered (Clients tab, maths + English).
Positive balance = paid for lessons not yet had. Balances within one week of a family's plan count as normal billing timing (OK).</p>

${snapshot ? `
<div class="stats" id="stats"></div>
<div class="toolbar">
  <input type="search" id="search" placeholder="Search student, parent or email" aria-label="Search">
  <select id="sort" aria-label="Sort by">
    <option value="gap">Biggest difference first</option>
    <option value="" hidden>Sorted by column</option>
    <option value="balance-desc">Balance: most overbilled first</option>
    <option value="balance-asc">Balance: most underbilled first</option>
    <option value="dollars-desc">≈ $: highest first</option>
    <option value="students-asc">Student: A–Z</option>
    <option value="netBilled-desc">Net billed: highest first</option>
    <option value="delivered-desc">Delivered: highest first</option>
    <option value="lastBilled-desc">Last billed: most recent first</option>
    <option value="lastBilled-asc">Last billed: oldest first</option>
  </select>
</div>
<p class="count" id="count"></p>
<div class="scroll"><table id="accounts">
  <thead><tr>
    <th data-sort="status">Status<span class="arrow"></span></th>
    <th data-sort="students">Family<span class="arrow"></span></th>
    <th class="num" data-sort="billed">Billed<span class="arrow"></span></th>
    <th class="num" data-sort="refunded">Refunded<span class="arrow"></span></th>
    <th class="num" data-sort="netBilled">Net billed<span class="arrow"></span></th>
    <th class="num" data-sort="delivered">Delivered<span class="arrow"></span></th>
    <th class="num" data-sort="balance">Balance (hrs)<span class="arrow"></span></th>
    <th class="num" data-sort="dollars">≈ $<span class="arrow"></span></th>
    <th data-sort="lastBilled">Last billed<span class="arrow"></span></th>
  </tr></thead>
  <tbody></tbody>
</table></div>

<h2>Live subscriptions with no Clients row</h2>
<p class="hint">Being billed but not linked to the Clients tab. Add the match to the Stripe Links tab, or they may not be onboarded yet.</p>
${simpleTable(["Stripe customer", "Email", "Plan hrs/wk", "Hours billed", "$ billed", "First billed", "Last billed"],
  snapshot.unmatchedLive.map((u) => [u.name, u.email, u.planHours, u.hoursBilled, money(u.amountBilled), u.firstBilled, u.lastBilled]))}

<h2>Clients with no Stripe customer</h2>
<p class="hint">To confirm a suggested match, copy its row into the Stripe Links tab (column A, column B).</p>
${snapshot.unmatchedClients.length ? `<div class="scroll"><table><thead><tr><th>Students</th><th>Parent</th><th>Lessons</th><th>Suggested match</th><th>Stripe Links row</th></tr></thead><tbody>
  ${snapshot.unmatchedClients.map((c) => `<tr><td>${esc(c.students)}</td><td>${esc(c.parent)}<div class="sub">${esc(c.parentEmail)}</div></td><td>${c.lessons}</td>
    <td>${c.suggestion ? `${esc(c.suggestion.name)}<div class="sub">${esc(c.suggestion.email)}</div>` : "—"}</td>
    <td>${c.suggestion ? `<code>${esc(c.parentEmail)}</code> <code>${esc(c.suggestion.id)}</code>` : "—"}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="empty">None.</p>`}

${snapshot.issues.length ? `<h2>Clients tab issues</h2>${simpleTable(["Row", "Student", "Problem"], snapshot.issues.map((i) => [i.row, i.student, i.problem]))}` : ""}
` : `<p class="empty" style="margin-top:24px">No reconciliation saved yet. Press <strong>Reconcile now</strong> to run the first one.</p>`}
</main>
<script type="application/json" id="data">${data}</script>
<script>
(() => {
  const form = document.getElementById("reconcile-form");
  if (form) form.addEventListener("submit", () => {
    const btn = document.getElementById("reconcile-btn");
    btn.disabled = true; btn.textContent = "Reconciling… (about 15 seconds)";
  });

  const table = document.getElementById("accounts");
  if (!table) return;
  const accounts = JSON.parse(document.getElementById("data").textContent);
  const STATUSES = [
    ["attention", "Needs attention", ""], ["Overbilled", "Overbilled", "over"], ["Underbilled", "Underbilled", "under"],
    ["Prepaid program", "Prepaid program", "prepaid"], ["No lessons in Clients tab", "No lessons in Clients tab", ""],
    ["OK", "OK", "ok"], ["all", "All families", ""],
  ];
  const CHIP = { "Overbilled": "over", "Underbilled": "under", "Prepaid program": "prepaid", "No lessons in Clients tab": "blank", "OK": "ok" };
  const state = { status: "attention", search: "", sort: "gap", dir: -1 };

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const hrs = (n) => String(Math.round(n * 100) / 100);
  const signed = (n) => (n > 0 ? "+" : "") + hrs(n);
  const money = (n) => n === null ? "?" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });
  const matchesStatus = (a, s) => s === "all" || (s === "attention" ? a.status !== "OK" : a.status === s);

  // Status cards double as filters.
  const stats = document.getElementById("stats");
  stats.innerHTML = STATUSES.map(([key, label, cls]) =>
    '<button class="stat ' + cls + '" data-status="' + esc(key) + '"><span class="value">' +
    accounts.filter((a) => matchesStatus(a, key)).length + '</span><span class="label">' + esc(label) + "</span></button>").join("");
  stats.addEventListener("click", (e) => {
    const card = e.target.closest("[data-status]");
    if (card) { state.status = card.dataset.status; render(); }
  });

  document.getElementById("search").addEventListener("input", (e) => { state.search = e.target.value.trim().toLowerCase(); render(); });
  const sortSelect = document.getElementById("sort");
  sortSelect.addEventListener("change", () => {
    const [key, dir] = sortSelect.value.split("-");
    state.sort = key; state.dir = dir === "asc" ? 1 : -1; render();
  });
  // Clicking a column header sorts by it; clicking again flips the direction.
  table.querySelector("thead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.dataset.sort;
    state.dir = state.sort === key ? -state.dir : (key === "students" || key === "status" ? 1 : -1);
    state.sort = key;
    const option = [...sortSelect.options].find((o) => o.value === key + "-" + (state.dir === 1 ? "asc" : "desc"));
    sortSelect.value = option ? option.value : "";
    render();
  });

  const sortValue = (a) => state.sort === "gap" ? Math.abs(a.balance) : a[state.sort] ?? (state.dir === 1 ? Infinity : -Infinity);
  const compare = (x, y) => {
    const a = sortValue(x), b = sortValue(y);
    return (typeof a === "string" ? a.localeCompare(b) : a - b) * state.dir;
  };

  const detail = (a) => {
    const lessons = a.lessons.map((l) => esc(l.student) + ": " + l.maths + " maths + " + l.english + " English (Clients row " + l.row + ")").join("<br>");
    const events = a.events.map((e) => "<tr><td>" + esc(e.date) + "</td><td>" + esc(e.kind) + "</td><td>" + esc(e.description) +
      '</td><td class="num">' + money(e.amount) + '</td><td class="num">' + (e.hours === null ? "<em>needs review</em>" : hrs(e.hours)) + "</td></tr>").join("");
    return "<p><strong>Lessons delivered:</strong><br>" + lessons + "</p>" +
      "<p><strong>Parent email:</strong> " + esc(a.parentEmails || "—") + " · <strong>Stripe:</strong> " + esc(a.stripeNames) + "</p>" +
      "<p><strong>Plan:</strong> " + (a.planHours ? hrs(a.planHours) + " hrs/week" : "no live subscription") +
      (a.unconverted ? " · <strong>" + money(a.unconverted) + "</strong> couldn't be converted to hours" : "") + "</p>" +
      '<div class="scroll"><table class="events"><thead><tr><th>Date</th><th>Type</th><th>Stripe item</th><th class="num">$</th><th class="num">Hours</th></tr></thead><tbody>' +
      events + "</tbody></table></div>";
  };

  function render() {
    const rows = accounts
      .filter((a) => matchesStatus(a, state.status))
      .filter((a) => !state.search || (a.students + " " + a.stripeNames + " " + a.parentEmails).toLowerCase().includes(state.search))
      .sort(compare);
    table.querySelector("tbody").innerHTML = rows.length ? rows.map((a, i) =>
      '<tr class="account" data-i="' + i + '" tabindex="0">' +
      '<td><span class="chip ' + CHIP[a.status] + '">' + esc(a.status) + "</span></td>" +
      "<td><strong>" + esc(a.students) + '</strong><div class="sub">' + esc(a.stripeNames) + "</div></td>" +
      '<td class="num">' + hrs(a.billed) + '</td><td class="num">' + hrs(a.refunded) + '</td>' +
      '<td class="num strong">' + hrs(a.netBilled) + '</td><td class="num">' + hrs(a.delivered) + '</td>' +
      '<td class="num strong">' + signed(a.balance) + '</td><td class="num">' + money(a.dollars) + "</td>" +
      "<td>" + esc(a.lastBilled || "—") + "</td></tr>" +
      '<tr class="detail" hidden><td colspan="9">' + detail(a) + "</td></tr>").join("")
      : '<tr><td colspan="9" class="empty">No families match.</td></tr>';
    document.getElementById("count").textContent = rows.length + " of " + accounts.length + " families";
    stats.querySelectorAll("[data-status]").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.status === state.status)));
    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.querySelector(".arrow").textContent = th.dataset.sort === state.sort ? (state.dir === 1 ? " ▲" : " ▼") : "";
    });
  }

  // Tap a family to see every Stripe item behind its numbers.
  table.querySelector("tbody").addEventListener("click", (e) => {
    const row = e.target.closest("tr.account");
    if (row) row.nextElementSibling.hidden = !row.nextElementSibling.hidden;
  });
  table.querySelector("tbody").addEventListener("keydown", (e) => {
    const row = e.target.closest("tr.account");
    if (row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); row.nextElementSibling.hidden = !row.nextElementSibling.hidden; }
  });

  render();
})();
</script>
</body></html>`;
}
