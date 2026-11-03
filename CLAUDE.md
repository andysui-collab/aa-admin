# aa-admin

Internal admin tooling for the tutoring business. The owner is new to coding: explain changes in plain language and keep code simple.

## What's here
- **Website** (Vercel): `api/index.ts` shows the last saved reconciliation at `/` (loads instantly; period selection, filtering (billing status, student status), sorting and search run in the browser from the saved data). All time = Clients tab O+P vs all billing; date ranges (within the `DATED_WEEKS` = 12 weeks before the last reconcile) = tutor-sheet lessons vs Stripe items dated in the range. The "Reconcile now" button POSTs to `api/reconcile.ts`, which re-runs it and saves the result in Upstash Redis (`src/store.ts`; `KV_REST_API_URL`/`KV_REST_API_TOKEN` are set by Vercel's Storage integration). Protected by a bookmark link: `/?key=<SITE_PASSWORD>` sets a cookie for a year; everyone else gets a 404. `api/failed-payments.ts` runs daily (cron in `vercel.json`) and POSTs failed payments from the last 24h to the n8n webhook in `N8N_WEBHOOK_URL`, which texts the owner. Quiet days send nothing.
- Vercel environment variables: `STRIPE_API_KEY` (restricted, read-only), `SITE_PASSWORD`, `CRON_SECRET`, `N8N_WEBHOOK_URL`, `APPS_SCRIPT_URL`, `APPS_SCRIPT_SECRET`.
- `npm run reconcile`: same report locally. Writes `out/report.html`, `out/billing-events.csv`, `out/matches.csv`.
- `npm run failed-payments`: prints failed payments from the last 24h. Prints nothing if there were none.

## How it works
- `src/config.ts`: business rules (start date, hours per plan, tolerance). Plan names in Stripe are inconsistent: always reason in **hours per week**, and use `PRICE_HOURS` overrides when a product's name is misleading.
- `src/sheets.ts`: reads, through public CSV export links, (1) the master sheet's Clients tab: all-time lessons delivered = column O (maths) + P (English), 1 lesson = 1 hour; the owner adds lessons from a previous tutor to these by hand; and (2) every tutor's `Sessions` tab (listed in the Tutors tab, column E): dated lesson rows used for the date-range views (past 2/4 weeks, custom). and (3) every tutor's `Students` tab: Status (ACTIVE/PAUSED/CANCELLED/blank) per student, subject (from the Subjects column, else from logged lessons) and tutor. Tutor-sheet columns are found by header name, not position. `src/report.ts` links tutor-sheet rows to families by parent email, then exact full name, then (only for rows with no parent email) unique first name.
- `src/billing.ts`: Stripe → billing events in hours (paid invoices, refunds, credit notes, balance adjustments).
- `src/match.ts`: Clients rows (grouped by parent email) → Stripe customers. A family's customers = exact email matches (parent or student email) PLUS any customer IDs in its row of the master sheet's "Stripe Links" tab (`STRIPE_LINKS_GID`; falls back to `data/stripe-links.csv`); a row of `none` means no customer. Name *suggestions* are never used automatically. A parent may have several Stripe customers (new subscription under another name/email): the Link/Confirm buttons ADD to a family's row, never replace it (`api/links.ts` merges with the existing row). Stripe Links rows are keyed by the Clients parent email, so if that email changes the row is orphaned; the page lists orphaned rows and all unlinked billed customers (live and earlier) so they can be re-linked.
- `src/accounts.ts`: totals per account. Net billed = billed − refunded/credited; balance = net billed − delivered. Positive = paid for lessons not yet had.
- `src/report.ts` builds the report; `src/snapshot.ts` turns it into plain JSON for saving; `src/html.ts` renders a snapshot (shared by the CLI and the website).

## Master sheet Apps Script (`apps-script/`, pasted into the master sheet's project by the owner)
- `StripeLinks.gs`: web app behind the Confirm/Ignore buttons.
- `TemplateCheck.gs`: read-only inventory of every tutor sheet and the Clients O/P formulas → "Template Check" tab.
- `TutorMigration.gs`: one-off move of all tutor sheets to the new Students layout (Status, Name, Year, State, Parent Name, Parent Email, Phone, Subjects, Tutor, Maths, English, Other, Total, Most Recent), Clients O/P → `Students!F:J`/`F:K`, and per-sheet onEdit triggers (`tutorStudentsOnEdit`). Preview first; backs up each file to Drive before changing it.

## Rules
- Stripe access is **read-only**. Never write to Stripe. The only sheet write is adding/replacing rows in the Stripe Links tab, via the Apps Script web app in `apps-script/StripeLinks.gs` (bound to the master sheet, checks a shared secret), called by `api/links.ts` for the Confirm/Ignore buttons.
- `out/` and `data/` contain children's and parents' personal data. They are gitignored; never commit them or publish them anywhere.
- In the Claude cloud environment the network proxy adds the Stripe key. Elsewhere, set `STRIPE_API_KEY`. Node's fetch needs `NODE_USE_ENV_PROXY=1` here (already in the npm scripts).
- Run `npm run typecheck` after changes.
