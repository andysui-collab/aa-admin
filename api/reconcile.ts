// The "Reconcile now" button: runs the reconciliation, saves the result, then goes back to the page.

import { checkAccess } from "../src/auth.js";
import { buildReport } from "../src/report.js";
import { toSnapshot } from "../src/snapshot.js";
import { saveSnapshot } from "../src/store.js";

export async function POST(request: Request): Promise<Response> {
  const denied = checkAccess(request);
  if (denied) return denied;
  try {
    await saveSnapshot(toSnapshot(await buildReport()));
    return new Response(null, { status: 303, headers: { Location: "/" } });
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(null, { status: 303, headers: { Location: `/?error=${encodeURIComponent(message)}` } });
  }
}
