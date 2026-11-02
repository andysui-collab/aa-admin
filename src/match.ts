// Links families in the tutor sheets to Stripe customers.
// 1. Manual overrides in data/overrides.csv win.
// 2. Otherwise an exact email match (parent or student email from the sheets) is trusted.
// 3. Otherwise the closest name match is *suggested* for a human to confirm, and left out of the ledger.

import { existsSync, readFileSync } from "node:fs";
import type { Customer } from "./billing.js";
import { parseCsv, type Client, type Lesson } from "./sheets.js";

export const OVERRIDES_PATH = "data/overrides.csv";

export interface Family {
  key: string;
  parentName: string;
  parentEmail: string;
  students: Set<string>;
  tutors: Set<string>;
  lessons: Lesson[];
  candidateEmails: Set<string>;
}

export interface Match {
  family: Family;
  customerIds: string[]; // used in the ledger; empty unless confirmed
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

export function groupFamilies(lessons: Lesson[], clients: Client[]): Family[] {
  const families = new Map<string, Family>();
  // Rows with a parent email first, so rows missing one can join the same student's family.
  const sorted = [...lessons].sort((a, b) => Number(!a.parentEmail) - Number(!b.parentEmail));
  for (const lesson of sorted) {
    let key = lesson.parentEmail;
    if (!key) {
      const sameStudent = [...families.values()].filter((f) =>
        [...f.students].some((s) => firstName(s) === firstName(lesson.student)));
      const sameTutor = sameStudent.filter((f) => f.tutors.has(lesson.tutor));
      const found = sameTutor.length === 1 ? sameTutor[0] : sameStudent.length === 1 ? sameStudent[0] : undefined;
      key = found?.key ?? `no-email:${firstName(lesson.parentName)}|${firstName(lesson.student)}`;
    }
    let family = families.get(key);
    if (!family) {
      family = {
        key, parentName: lesson.parentName, parentEmail: lesson.parentEmail,
        students: new Set(), tutors: new Set(), lessons: [], candidateEmails: new Set(),
      };
      families.set(key, family);
    }
    family.students.add(lesson.student);
    family.tutors.add(lesson.tutor);
    family.lessons.push(lesson);
  }

  // Pull in extra emails from the master sheet (the Stripe account may use the student's email).
  for (const family of families.values()) {
    if (family.parentEmail) family.candidateEmails.add(family.parentEmail);
    for (const client of clients) {
      const sameParentEmail = family.parentEmail && client.parentEmail === family.parentEmail;
      const sameNames = [...family.students].some((s) => firstName(s) === firstName(client.studentName)) &&
        firstName(family.parentName) === firstName(client.parentName);
      if (sameParentEmail || sameNames) {
        for (const email of [client.parentEmail, client.studentEmail]) if (email) family.candidateEmails.add(email);
        if (!family.parentName) family.parentName = client.parentName;
      }
    }
  }
  return [...families.values()];
}

// Stripe customers to leave out of the report entirely (data/ignored-customers.csv: customer_id,note).
export const IGNORED_PATH = "data/ignored-customers.csv";
export function readIgnored(): Set<string> {
  if (!existsSync(IGNORED_PATH)) return new Set();
  return new Set(parseCsv(readFileSync(IGNORED_PATH, "utf8")).slice(1).map((r) => r[0]?.trim()).filter(Boolean));
}

function readOverrides(): Map<string, string[]> {
  const overrides = new Map<string, string[]>();
  if (!existsSync(OVERRIDES_PATH)) return overrides;
  for (const [key, ids] of parseCsv(readFileSync(OVERRIDES_PATH, "utf8")).slice(1)) {
    if (!key?.trim()) continue;
    overrides.set(key.trim(), ids?.trim() === "none" ? [] : (ids ?? "").split(";").map((s) => s.trim()).filter(Boolean));
  }
  return overrides;
}

export function matchFamilies(families: Family[], customers: Map<string, Customer>, billedCustomerIds: Set<string>): Match[] {
  const overrides = readOverrides();
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
  const unclaimed = [...customers.values()].filter((c) => billedCustomerIds.has(c.id) && !claimed.has(c.id));
  for (const match of matches) {
    if (match.method !== "none") continue;
    const { family } = match;
    let best: { customer: Customer; score: number } | undefined;
    for (const customer of unclaimed) {
      const local = customer.email.split("@")[0];
      const score = Math.max(
        similarity(customer.name, family.parentName),
        similarity(local, family.parentEmail.split("@")[0] ?? ""),
        ...[...family.students].map((s) => similarity(customer.name, s)),
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
