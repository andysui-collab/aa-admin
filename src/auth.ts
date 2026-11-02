// Simple password protection for the website (the browser shows a username/password box;
// any username works, the password must match SITE_PASSWORD in Vercel's environment variables).

export function isAuthorized(request: Request): boolean {
  const password = process.env.SITE_PASSWORD;
  if (!password) return false; // no password configured = locked, never open
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
  return decoded.slice(decoded.indexOf(":") + 1) === password;
}

export const passwordRequired = () =>
  new Response("Password required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="aa-admin", charset="UTF-8"' } });
