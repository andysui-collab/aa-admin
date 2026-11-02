// Saves and loads the last reconciliation in Upstash Redis (added to the project from Vercel's
// Storage tab, which sets KV_REST_API_URL and KV_REST_API_TOKEN automatically).

import type { Snapshot } from "./snapshot.js";

const KEY = "aa-admin:last-reconciliation";

function connection() {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("No database connected: add Upstash Redis to this project in Vercel's Storage tab.");
  return { url, token };
}

async function redis(command: string[]): Promise<unknown> {
  const { url, token } = connection();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  if (!res.ok) throw new Error(`Database request failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { result: unknown }).result;
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  const value = await redis(["GET", KEY]);
  return typeof value === "string" ? (JSON.parse(value) as Snapshot) : null;
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  await redis(["SET", KEY, JSON.stringify(snapshot)]);
}
