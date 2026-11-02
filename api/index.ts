// The website's page: shows the last saved reconciliation (it doesn't re-run it; see api/reconcile.ts).

import { checkAccess } from "../src/auth.js";
import { renderPage } from "../src/html.js";
import { loadSnapshot } from "../src/store.js";

export async function GET(request: Request): Promise<Response> {
  const denied = checkAccess(request);
  if (denied) return denied;
  let error = new URL(request.url).searchParams.get("error") ?? undefined;
  let snapshot = null;
  try {
    snapshot = await loadSnapshot();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const html = renderPage(snapshot, { canReconcile: true, error });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
