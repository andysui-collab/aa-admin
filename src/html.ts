// Renders a saved reconciliation as a single self-contained HTML page (no external files).
// Filtering, searching and sorting happen in the browser, using the data embedded in the page.

import { DATED_WEEKS, START_DATE, TIMEZONE, TOLERANCE_WEEKS } from "./config.js";
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

export function renderPage(saved: Snapshot | null, { canReconcile, error }: PageOptions): string {
  // A result saved by an older version of the app lacks the date-range fields: ask for a fresh reconcile.
  const outdated = saved !== null && !saved.asOf;
  const snapshot = outdated ? null : saved;
  const reconciled = saved
    ? new Date(saved.reconciledAt).toLocaleString("en-AU", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
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
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin:16px 0 12px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:10px 14px; text-align:left; cursor:pointer; }
.stat[aria-pressed="true"] { outline:2px solid var(--text); outline-offset:-1px; }
.stat .value { font-size:24px; font-weight:650; display:block; } .stat .label { color:var(--muted); font-size:13px; }
.stat.over .value { color:var(--over); } .stat.under .value { color:var(--under); } .stat.prepaid .value { color:var(--prepaid); } .stat.ok .value { color:var(--ok); }
.periods { display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin:20px 0 4px; }
.segmented { display:inline-flex; flex-wrap:wrap; background:var(--card); border:1px solid var(--line); border-radius:9px; padding:3px; gap:2px; }
.segmented button { border:0; background:none; padding:7px 12px; border-radius:7px; cursor:pointer; color:var(--muted); font-weight:500; }
.segmented button[aria-pressed="true"] { background:var(--accent); color:var(--accent-text); }
@media (max-width:520px) { .segmented { display:grid; grid-template-columns:1fr 1fr; width:100%; } }
.custom { display:flex; flex-wrap:wrap; gap:8px; } .custom label { display:flex; gap:6px; align-items:center; font-size:14px; color:var(--muted); }
.custom input { background:var(--card); border:1px solid var(--line); border-radius:8px; padding:6px 8px; color:var(--text); }
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
${error ? `<div class="error">Something went wrong: ${esc(error)}</div>` : ""}
${snapshot ? `
<div class="periods" id="periods">
  <div class="segmented" role="group" aria-label="Period">
    <button type="button" data-period="all">All time</button><button type="button" data-period="2w">Past 2 weeks</button><button type="button" data-period="4w">Past 4 weeks</button><button type="button" data-period="custom">Custom dates</button>
  </div>
  <div class="custom" id="custom" hidden>
    <label>From <input type="date" id="from" min="${esc(snapshot.datedFrom)}" max="${esc(snapshot.asOf)}"></label>
    <label>To <input type="date" id="to" min="${esc(snapshot.datedFrom)}" max="${esc(snapshot.asOf)}"></label>
  </div>
</div>
<p class="lede" id="lede"></p>
<p class="lede">Positive balance = paid for lessons not yet had. Balances within one week of a family's plan count as normal billing timing (OK).
Date ranges cover the ${DATED_WEEKS} weeks up to the last reconcile (${esc(snapshot.datedFrom)} to ${esc(snapshot.asOf)}).</p>
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
<div class="scroll"><table id="accounts" data-tolerance-weeks="${TOLERANCE_WEEKS}" data-start-date="${esc(START_DATE)}" data-as-of="${esc(snapshot.asOf)}" data-dated-from="${esc(snapshot.datedFrom)}">
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
${simpleTable(["Stripe customer", "Email", "Customer ID", "Plan hrs/wk", "Hours billed", "$ billed", "First billed", "Last billed"],
  snapshot.unmatchedLive.map((u) => [u.name, u.email, u.id, u.planHours, u.hoursBilled, money(u.amountBilled), u.firstBilled, u.lastBilled]))}

<h2>Clients with no Stripe customer</h2>
<p class="hint">To confirm a suggested match, copy its row into the Stripe Links tab (column A, column B).</p>
${snapshot.unmatchedClients.length ? `<div class="scroll"><table><thead><tr><th>Students</th><th>Parent</th><th>Lessons</th><th>Suggested match</th><th>Stripe Links row</th></tr></thead><tbody>
  ${snapshot.unmatchedClients.map((c) => `<tr><td>${esc(c.students)}</td><td>${esc(c.parent)}<div class="sub">${esc(c.parentEmail)}</div></td><td>${c.lessons}</td>
    <td>${c.suggestion ? `${esc(c.suggestion.name)}<div class="sub">${esc(c.suggestion.email)}</div>` : "—"}</td>
    <td>${c.suggestion ? `<code>${esc(c.parentEmail)}</code> <code>${esc(c.suggestion.id)}</code>` : "—"}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="empty">None.</p>`}

${snapshot.unlinkedLessons.length ? `<h2>Tutor-sheet lessons not linked to a family</h2>
<p class="hint">These lessons aren't in any date-range view: their parent email and student name don't match a reconciled family in the Clients tab.</p>
${simpleTable(["Date", "Student", "Subject", "Tutor", "Hours", "Parent email"], snapshot.unlinkedLessons.map((l) => [l.date, l.student, l.subject, l.tutor, l.hours, l.parentEmail || "—"]))}` : ""}

${snapshot.lessonIssues.length ? `<h2>Tutor sheet issues</h2>${simpleTable(["Tutor", "Row", "Problem"], snapshot.lessonIssues.map((i) => [i.tutor, i.row, i.problem]))}` : ""}

${snapshot.issues.length ? `<h2>Clients tab issues</h2>${simpleTable(["Row", "Student", "Problem"], snapshot.issues.map((i) => [i.row, i.student, i.problem]))}` : ""}
` : `<p class="empty" style="margin-top:24px">${outdated
  ? "The app has been updated since the last reconciliation. Press <strong>Reconcile now</strong> to refresh it."
  : "No reconciliation saved yet. Press <strong>Reconcile now</strong> to run the first one."}</p>`}
</main>
<script type="application/json" id="data">${data}</script>
<script>
(() => {
  const form = document.getElementById("reconcile-form");
  if (form) form.addEventListener("submit", () => {
    const btn = document.getElementById("reconcile-btn");
    btn.disabled = true; btn.textContent = "Reconciling… (about 20 seconds)";
  });

  const table = document.getElementById("accounts");
  if (!table) return;
  const accounts = JSON.parse(document.getElementById("data").textContent);
  const TOLERANCE_WEEKS = Number(table.dataset.toleranceWeeks);
  const STATUSES = [
    ["attention", "Needs attention", ""], ["Overbilled", "Overbilled", "over"], ["Underbilled", "Underbilled", "under"],
    ["Prepaid program", "Prepaid program", "prepaid"], ["No lessons in Clients tab", "No lessons in Clients tab", ""],
    ["OK", "OK", "ok"], ["all", "All families", ""],
  ];
  const CHIP = { "Overbilled": "over", "Underbilled": "under", "Prepaid program": "prepaid", "No lessons in Clients tab": "blank", "OK": "ok" };
  const state = { period: "all", from: "", to: "", status: "attention", search: "", sort: "gap", dir: -1 };

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const round = (n) => Math.round(n * 100) / 100;
  const hrs = (n) => String(round(n));
  const signed = (n) => (n > 0 ? "+" : "") + hrs(n);
  const money = (n) => n === null ? "?" : (n < 0 ? "−" : "") + "$" + Math.abs(n).toLocaleString("en-AU", { maximumFractionDigits: 0 });
  const matchesStatus = (a, s) => s === "all" || (s === "attention" ? a.status !== "OK" : a.status === s);

  // Dates are YYYY-MM-DD strings in Melbourne time, so they compare correctly as text.
  // Periods are counted back from the reconcile date (the newest data saved), within the saved window.
  const AS_OF = table.dataset.asOf, DATED_FROM = table.dataset.datedFrom;
  const today = () => AS_OF;
  const clamp = (iso) => iso < DATED_FROM ? DATED_FROM : iso > AS_OF ? AS_OF : iso;
  const addDays = (iso, days) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const prettyDate = (iso) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-AU", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  function range() {
    if (state.period === "2w") return [addDays(today(), -13), today()];
    if (state.period === "4w") return [addDays(today(), -27), today()];
    if (state.period === "custom" && state.from && state.to) return [state.from, state.to];
    return null; // all time
  }

  // All time: the saved totals (Clients tab O + P). A date range: Stripe items and tutor-sheet lessons dated
  // within the range (inclusive), with the same OK tolerance of one week of the family's plan.
  function view(a) {
    const r = range();
    if (!r) return { ...a, shownEvents: a.events, shownLessons: null };
    const [from, to] = r;
    const inRange = (x) => x.date >= from && x.date <= to;
    const shownEvents = a.events.filter(inRange);
    const shownLessons = a.dated.filter(inRange);
    const isCredit = (e) => e.kind === "refund" || e.kind === "credit";
    const sum = (list) => round(list.reduce((s, x) => s + (x.hours ?? 0), 0));
    const billed = sum(shownEvents.filter((e) => !isCredit(e)));
    const refunded = sum(shownEvents.filter(isCredit));
    const netBilled = round(billed + refunded);
    const delivered = sum(shownLessons);
    const balance = round(netBilled - delivered);
    const tolerance = Math.max(a.planHours, 1) * TOLERANCE_WEEKS;
    // Prepaid program families paid upfront, so their periods don't line up with billing.
    const status = Math.abs(balance) <= tolerance ? "OK" : a.hasProgram ? "Prepaid program" : balance > 0 ? "Overbilled" : "Underbilled";
    return {
      ...a, billed, refunded, netBilled, delivered, balance, status, shownEvents, shownLessons,
      dollars: a.pricePerHour ? Math.round(balance * a.pricePerHour) : null,
    };
  }

  // Period buttons and custom dates.
  const periods = document.getElementById("periods");
  const custom = document.getElementById("custom");
  const fromInput = document.getElementById("from"), toInput = document.getElementById("to");
  periods.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-period]");
    if (!btn) return;
    state.period = btn.dataset.period;
    if (state.period === "custom" && !state.from) {
      state.from = fromInput.value = addDays(today(), -13);
      state.to = toInput.value = today();
    }
    render();
  });
  [fromInput, toInput].forEach((input) => input.addEventListener("change", () => {
    state.from = fromInput.value = clamp(fromInput.value || DATED_FROM);
    state.to = toInput.value = clamp(toInput.value || AS_OF);
    if (state.from && state.to && state.from > state.to) [state.from, state.to] = [state.to, state.from];
    render();
  }));

  // Status cards double as filters.
  const stats = document.getElementById("stats");
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
    const lessons = a.shownLessons === null
      ? "<p><strong>Lessons delivered (Clients tab):</strong><br>" +
        a.lessons.map((l) => esc(l.student) + ": " + l.maths + " maths + " + l.english + " English (row " + l.row + ")").join("<br>") + "</p>"
      : "<p><strong>Lessons in this period (tutor sheets):</strong></p>" + (a.shownLessons.length
        ? '<div class="scroll"><table class="events"><thead><tr><th>Date</th><th>Student</th><th>Subject</th><th>Tutor</th><th class="num">Hours</th></tr></thead><tbody>' +
          a.shownLessons.map((l) => "<tr><td>" + esc(l.date) + "</td><td>" + esc(l.student) + "</td><td>" + esc(l.subject) + "</td><td>" + esc(l.tutor) +
            '</td><td class="num">' + hrs(l.hours) + "</td></tr>").join("") + "</tbody></table></div>"
        : '<p class="empty">None.</p>');
    const events = a.shownEvents.length
      ? '<div class="scroll"><table class="events"><thead><tr><th>Date</th><th>Type</th><th>Stripe item</th><th class="num">$</th><th class="num">Hours</th></tr></thead><tbody>' +
        a.shownEvents.map((e) => "<tr><td>" + esc(e.date) + "</td><td>" + esc(e.kind) + "</td><td>" + esc(e.description) +
          '</td><td class="num">' + money(e.amount) + '</td><td class="num">' + (e.hours === null ? "<em>needs review</em>" : hrs(e.hours)) + "</td></tr>").join("") +
        "</tbody></table></div>"
      : '<p class="empty">None.</p>';
    return lessons +
      "<p><strong>Parent email:</strong> " + esc(a.parentEmails || "—") + " · <strong>Stripe:</strong> " + esc(a.stripeNames) + "</p>" +
      "<p><strong>Plan:</strong> " + (a.planHours ? hrs(a.planHours) + " hrs/week" : "no live subscription") +
      (a.unconverted ? " · <strong>" + money(a.unconverted) + "</strong> couldn't be converted to hours" : "") + "</p>" +
      "<p><strong>Stripe items" + (a.shownLessons === null ? "" : " in this period") + ":</strong></p>" + events;
  };

  function render() {
    const r = range();
    const views = accounts.map(view);
    // The "No lessons in Clients tab" status only exists in the all-time view.
    const statuses = STATUSES.filter(([key]) => r === null || key !== "No lessons in Clients tab");
    if (!statuses.some(([key]) => key === state.status)) state.status = "attention";

    periods.querySelectorAll("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === state.period)));
    custom.hidden = state.period !== "custom";
    document.getElementById("lede").innerHTML = r === null
      ? "<strong>All time:</strong> net billed (hours billed in Stripe since " + esc(table.dataset.startDate) +
        ", less refunds and credits) vs lessons delivered (Clients tab, maths + English)."
      : "<strong>" + esc(prettyDate(r[0])) + " – " + esc(prettyDate(r[1])) + ":</strong> Stripe billing, refunds and credits dated in this period vs lessons in the tutor sheets dated in this period. " +
        "Weekly billing is dated by the week it pays for; refunds by the day they were issued.";

    stats.innerHTML = statuses.map(([key, label, cls]) =>
      '<button class="stat ' + cls + '" data-status="' + esc(key) + '" aria-pressed="' + (key === state.status) + '"><span class="value">' +
      views.filter((a) => matchesStatus(a, key)).length + '</span><span class="label">' + esc(label) + "</span></button>").join("");

    const rows = views
      .filter((a) => matchesStatus(a, state.status))
      .filter((a) => !state.search || (a.students + " " + a.stripeNames + " " + a.parentEmails).toLowerCase().includes(state.search))
      .sort(compare);
    table.querySelector("tbody").innerHTML = rows.length ? rows.map((a) =>
      '<tr class="account" tabindex="0">' +
      '<td><span class="chip ' + CHIP[a.status] + '">' + esc(a.status) + "</span></td>" +
      "<td><strong>" + esc(a.students) + '</strong><div class="sub">' + esc(a.stripeNames) + "</div></td>" +
      '<td class="num">' + hrs(a.billed) + '</td><td class="num">' + hrs(a.refunded) + '</td>' +
      '<td class="num strong">' + hrs(a.netBilled) + '</td><td class="num">' + hrs(a.delivered) + '</td>' +
      '<td class="num strong">' + signed(a.balance) + '</td><td class="num">' + money(a.dollars) + "</td>" +
      "<td>" + esc(a.lastBilled || "—") + "</td></tr>" +
      '<tr class="detail" hidden><td colspan="9">' + detail(a) + "</td></tr>").join("")
      : '<tr><td colspan="9" class="empty">No families match.</td></tr>';
    document.getElementById("count").textContent = rows.length + " of " + accounts.length + " families";
    table.querySelectorAll("th[data-sort]").forEach((th) => {
      th.querySelector(".arrow").textContent = th.dataset.sort === state.sort ? (state.dir === 1 ? " ▲" : " ▼") : "";
    });
  }

  // Tap a family to see the lessons and Stripe items behind its numbers.
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
