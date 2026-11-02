// Low-friction protection for the website. Open https://<site>/?key=<SITE_PASSWORD> once (bookmark it):
// the site saves a cookie so that browser stays signed in for a year. Anyone without the key gets nothing.

const COOKIE = "aa_admin_key";

const cookieValue = (request: Request) =>
  request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);

// Returns the response to send instead of the page, or null if the visitor is allowed in.
export function checkAccess(request: Request): Response | null {
  const password = process.env.SITE_PASSWORD;
  if (!password) return new Response("SITE_PASSWORD isn't set in Vercel, so the site is locked.", { status: 503 });

  const url = new URL(request.url);
  if (url.searchParams.get("key") === password) {
    // Remember this browser, then reload without the key in the address bar.
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `${COOKIE}=${encodeURIComponent(password)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }
  if (cookieValue(request) === encodeURIComponent(password)) return null;
  return new Response("Not found", { status: 404 });
}
