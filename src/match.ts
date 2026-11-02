// Links families in the Clients tab to Stripe customers.
// 1. Manual overrides in data/overrides.csv win.
// 2. Otherwise an exact email match (parent or student email) is trusted.
// 3. Otherwise the closest name match is *suggested* for a human to confirm, and left out of the totals.

import { existsSync, readFileSync } from "node:fs";
import type { Customer } from "./billing.js";
import { parseCsv, type Client } from "./sheets.js";

export const OVERRIDES_PATH = "data/overrides.csv";
export const IGNORED_PATH = "data/ignored-customers.csv";

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

function readCsvFile(path: string): string[][] {
  return existsSync(path) ? parseCsv(readFileSync(path, "utf8")).slice(1).filter((r) => r[0]?.trim()) : [];
}

// data/overrides.csv: family_key,stripe_customer_ids (several separated by ";", or "none")
function readOverrides(): Map<string, string[]> {
  return new Map(readCsvFile(OVERRIDES_PATH).map(([key, ids]) => [
    key.trim(),
    ids?.trim() === "none" ? [] : (ids ?? "").split(";").map((s) => s.trim()).filter(Boolean),
  ]));
}

// data/ignored-customers.csv: customer_id,note. These customers are left out of the report.
export function readIgnored(): Set<string> {
  return new Set(readCsvFile(IGNORED_PATH).map((r) => r[0].trim()));
}

export function matchFamilies(families: Family[], customers: Map<string, Customer>, billedCustomerIds: Set<string>): Match[] {
  const overrides = readOverrides();
  const ignored = readIgnored();
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
