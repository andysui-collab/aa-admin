// Minimal read-only Stripe client.
// In the Claude cloud environment the network proxy adds the API key automatically.
// Anywhere else (e.g. Vercel), set STRIPE_API_KEY to a restricted read-only key.

const BASE = "https://api.stripe.com/v1/";

type Params = Record<string, string | number | string[]>;

export async function stripeGet<T = any>(path: string, params: Params = {}): Promise<T> {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
  }
  const headers: Record<string, string> = {};
  if (process.env.STRIPE_API_KEY) headers.Authorization = `Bearer ${process.env.STRIPE_API_KEY}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Stripe GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Follows Stripe's cursor pagination until every item is fetched.
export async function stripeListAll<T extends { id: string }>(path: string, params: Params = {}): Promise<T[]> {
  const items: T[] = [];
  let startingAfter: string | undefined;
  while (true) {
    const page = await stripeGet<{ data: T[]; has_more: boolean }>(path, {
      ...params,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    items.push(...page.data);
    if (!page.has_more) return items;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

export const toUnix = (isoDate: string) => Math.floor(new Date(isoDate + "T00:00:00Z").getTime() / 1000);
