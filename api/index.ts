// The website's only page: the reconciliation report, built fresh on every visit.

import { checkAccess } from "../src/auth.js";
import { renderReport } from "../src/html.js";
import { buildReport } from "../src/report.js";

export async function GET(request: Request): Promise<Response> {
  const denied = checkAccess(request);
  if (denied) return denied;
  const html = renderReport(await buildReport());
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
