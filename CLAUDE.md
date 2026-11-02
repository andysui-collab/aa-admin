# aa-admin

Internal admin tooling for the tutoring business. The owner is new to coding: explain changes in plain language and keep code simple.

## What's here
- **Website** (Vercel): `api/index.ts` serves the reconciliation report at `/`, built fresh on each visit and protected by `SITE_PASSWORD`. `api/failed-payments.ts` runs daily (cron in `vercel.json`) and POSTs failed payments from the last 24h to the n8n webhook in `N8N_WEBHOOK_URL`, which texts the owner. Quiet days send nothing.
- Vercel environment variables: `STRIPE_API_KEY` (restricted, read-only), `SITE_PASSWORD`, `CRON_SECRET`, `N8N_WEBHOOK_URL`.
- `npm run reconcile`: same report locally. Writes `out/report.html`, `out/billing-events.csv`, `out/matches.csv`.
- `npm run failed-payments`: prints failed payments from the last 24h. Prints nothing if there were none.

## How it works
- `src/config.ts`: business rules (start date, hours per plan, tolerance). Plan names in Stripe are inconsistent: always reason in **hours per week**, and use `PRICE_HOURS` overrides when a product's name is misleading.
- `src/sheets.ts`: reads the master sheet's Clients tab through its public CSV export link. Lessons delivered = column O (maths) + P (English); 1 lesson = 1 hour. The owner adds lessons from a previous tutor to these counts by hand, so only totals matter, not dates.
- `src/billing.ts`: Stripe → billing events in hours (paid invoices, refunds, credit notes, balance adjustments).
- `src/match.ts`: Clients rows (grouped by parent email) → Stripe customers. Order: confirmed matches in the master sheet's "Stripe Links" tab (`STRIPE_LINKS_GID`; falls back to `data/stripe-links.csv`), then exact email, then name *suggestions* (never used automatically).
- `src/accounts.ts`: totals per account. Net billed = billed − refunded/credited; balance = net billed − delivered. Positive = paid for lessons not yet had.
- `src/report.ts` builds the report; `src/html.ts` renders it (shared by the CLI and the website).

## Rules
- Stripe access is **read-only**. Never write to Stripe or the sheets.
- `out/` and `data/` contain children's and parents' personal data. They are gitignored; never commit them or publish them anywhere.
- In the Claude cloud environment the network proxy adds the Stripe key. Elsewhere, set `STRIPE_API_KEY`. Node's fetch needs `NODE_USE_ENV_PROXY=1` here (already in the npm scripts).
- Run `npm run typecheck` after changes.
