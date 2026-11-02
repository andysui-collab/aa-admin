// The website's page: shows the last saved reconciliation (it doesn't re-run it; see api/reconcile.ts).

import { checkAccess } from "../src/auth.js";
import { renderPage } from "../src/html.js";
import { loadSnapshot } from "../src/store.js";

export async function GET(request: Request): Promise<Response> {
  const denied = checkAccess(request);
  if (denied) return denied;
  const error = new URL(request.url).searchParams.get("error") ?? undefined;
  const html = renderPage(await loadSnapshot(), { canReconcile: true, error });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
