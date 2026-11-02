# aa-admin

Internal admin tooling for the tutoring business. The owner is new to coding: explain changes in plain language and keep code simple.

## What's here
- `npm run reconcile`: compares total lesson hours billed in Stripe with total lessons delivered (Clients tab columns O + P). Writes `out/summary.md`, `out/billing-events.csv`, `out/matches.csv`.
- `npm run failed-payments`: lists Stripe payments that failed in the last 24h. Prints nothing if there were none.

## How it works
- `src/config.ts`: business rules (start date, hours per plan, tolerance). Plan names in Stripe are inconsistent: always reason in **hours per week**, and use `PRICE_HOURS` overrides when a product's name is misleading.
- `src/sheets.ts`: reads the master sheet's Clients tab through its public CSV export link. Lessons delivered = column O (maths) + P (English); 1 lesson = 1 hour. The owner adds lessons from a previous tutor to these counts by hand, so only totals matter, not dates.
- `src/billing.ts`: Stripe → billing events in hours (paid invoices, refunds, credit notes, balance adjustments).
- `src/match.ts`: Clients rows (grouped by parent email) → Stripe customers. Order: `data/overrides.csv`, then exact email, then name *suggestions* (never used automatically).
- `src/accounts.ts`: totals per account: billed − refunded/credited − delivered. Positive = paid for lessons not yet had.

## Rules
- Stripe access is **read-only**. Never write to Stripe or the sheets.
- `out/` and `data/` contain children's and parents' personal data. They are gitignored; never commit them or publish them anywhere.
- In the Claude cloud environment the network proxy adds the Stripe key. Elsewhere, set `STRIPE_API_KEY`. Node's fetch needs `NODE_USE_ENV_PROXY=1` here (already in the npm scripts).
- Run `npm run typecheck` after changes.
