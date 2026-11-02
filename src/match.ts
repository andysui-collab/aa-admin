// Links families in the Clients tab to Stripe customers.
// 1. Confirmed matches in the "Stripe Links" tab win.
// 2. Otherwise an exact email match (parent or student email) is trusted.
// 3. Otherwise the closest name match is *suggested* for a human to confirm, and left out of the totals.

import { existsSync, readFileSync } from "node:fs";
import type { Customer } from "./billing.js";
import { MASTER_SHEET_ID, STRIPE_LINKS_GID } from "./config.js";
import { parseCsv, type Client } from "./sheets.js";

// Confirmed matches live in the "Stripe Links" tab of the master sheet (or data/stripe-links.csv
// until that tab exists). Columns: family_key, stripe_customer_ids, note.
//   family_key = the parent email from the Clients tab; stripe_customer_ids = one or more, separated by ";"
//   (or "none"). A row with family_key "ignore" leaves those Stripe customers out of the report.
export const LOCAL_LINKS_PATH = "data/stripe-links.csv";

export interface Links {
  overrides: Map<string, string[]>;
  ignored: Set<string>;
}

export async function loadLinks(): Promise<Links> {
  let rows: string[][] = [];
  if (STRIPE_LINKS_GID) {
    const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/export?format=csv&gid=${STRIPE_LINKS_GID}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Couldn't read the Stripe Links tab: ${res.status}`);
    rows = parseCsv(await res.text());
  } else if (existsSync(LOCAL_LINKS_PATH)) {
    rows = parseCsv(readFileSync(LOCAL_LINKS_PATH, "utf8"));
  }
  const links: Links = { overrides: new Map(), ignored: new Set() };
  for (const [key = "", ids = ""] of rows.slice(1)) {
    const customerIds = ids.trim() === "none" ? [] : ids.split(";").map((s) => s.trim()).filter(Boolean);
    if (key.trim().toLowerCase() === "ignore") customerIds.forEach((id) => links.ignored.add(id));
    else if (key.trim()) links.overrides.set(key.trim().toLowerCase(), customerIds);
  }
  return links;
}

// Siblings with the same parent email are one family.
export interface Family {
  key: string; // parent email, or "no-email:<student first name>" when it's missing
  parentName: string;
  parentEmail: string;
  clients: Client[];
  candidateEmails: Set<string>;
}

export interface Match {
  family: Family;
  customerIds: string[]; // used in the totals; empty unless confirmed
  method: "override" | "email" | "suggested" | "none";
  suggestion?: { customer: Customer; score: number };
}

const firstName = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// Dice coefficient on letter pairs: 1 = identical, 0 = nothing in common.
function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const n = normalize(s);
    return Array.from({ length: Math.max(n.length - 1, 0) }, (_, i) => n.slice(i, i + 2));
  };
  const pa = pairs(a), pb = pairs(b);
  if (!pa.length || !pb.length) return 0;
  const pool = [...pb];
  let shared = 0;
  for (const p of pa) {
    const i = pool.indexOf(p);
    if (i >= 0) { shared++; pool.splice(i, 1); }
  }
  return (2 * shared) / (pa.length + pb.length);
}

export function groupFamilies(clients: Client[]): Family[] {
  const families = new Map<string, Family>();
  for (const client of clients) {
    const key = client.parentEmail || `no-email:${firstName(client.studentName)}`;
    let family = families.get(key);
    if (!family) {
      family = { key, parentName: client.parentName, parentEmail: client.parentEmail, clients: [], candidateEmails: new Set() };
      families.set(key, family);
    }
    family.clients.push(client);
    for (const email of [client.parentEmail, client.studentEmail]) if (email) family.candidateEmails.add(email);
  }
  return [...families.values()];
}

export function matchFamilies(
  families: Family[], customers: Map<string, Customer>, billedCustomerIds: Set<string>, { overrides, ignored }: Links,
): Match[] {
  const byEmail = new Map<string, Customer[]>();
  for (const c of customers.values()) {
    if (c.email) byEmail.set(c.email, [...(byEmail.get(c.email) ?? []), c]);
  }

  const matches: Match[] = families.map((family) => {
    const override = overrides.get(family.key);
    if (override) return { family, customerIds: override, method: "override" };
    const byEmailMatch = [...family.candidateEmails].flatMap((e) => byEmail.get(e) ?? []);
    if (byEmailMatch.length) return { family, customerIds: [...new Set(byEmailMatch.map((c) => c.id))], method: "email" };
    return { family, customerIds: [], method: "none" };
  });

  // Suggest names only among billed customers that nobody has claimed yet.
  const claimed = new Set(matches.flatMap((m) => m.customerIds));
  const unclaimed = [...customers.values()].filter((c) => billedCustomerIds.has(c.id) && !claimed.has(c.id) && !ignored.has(c.id));
  for (const match of matches) {
    if (match.method !== "none") continue;
    const { family } = match;
    let best: { customer: Customer; score: number } | undefined;
    for (const customer of unclaimed) {
      const local = customer.email.split("@")[0];
      const score = Math.max(
        similarity(customer.name, family.parentName),
        ...[...family.candidateEmails].map((e) => similarity(local, e.split("@")[0])),
        ...family.clients.map((c) => similarity(customer.name, c.studentName)),
      );
      if (!best || score > best.score) best = { customer, score };
    }
    if (best && best.score >= 0.5) {
      match.method = "suggested";
      match.suggestion = best;
    }
  }
  return matches;
}
