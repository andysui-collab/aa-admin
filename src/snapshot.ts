// A saved reconciliation result: plain data (no Maps/Sets) so it can be stored as JSON
// and shown later without re-running the reconciliation.

import type { Account } from "./accounts.js";
import type { BillingEvent } from "./billing.js";
import { DATED_WEEKS, TIMEZONE } from "./config.js";
import type { ClientIssue, Lesson, LessonIssue, StudentStatus } from "./sheets.js";
import { accountName, accountStudents, familyLessons, type Report } from "./report.js";

export interface AccountRow {
  status: Account["status"];
  students: string;
  stripeNames: string;
  parentEmails: string;
  familyKey: string; // Stripe Links key (parent email) used when linking another customer to this family
  customers: { id: string; name: string; email: string; planHours: number }[];
  billed: number;
  refunded: number; // negative
  netBilled: number;
  delivered: number;
  balance: number;
  dollars: number | null; // balance in dollars at this family's price per hour
  pricePerHour: number | null;
  planHours: number;
  unconverted: number;
  lastBilled: string | null;
  hasProgram: boolean;
  lessons: { student: string; maths: number; english: number; row: number }[]; // Clients tab totals
  dated: Pick<Lesson, "date" | "hours" | "tutor" | "student" | "subject">[]; // tutor-sheet lessons, for date ranges
  statuses: StatusRow[]; // one per student, subject and tutor (from the tutors' Students tabs)
  events: Pick<BillingEvent, "date" | "kind" | "description" | "amount" | "hours">[];
}

export interface StatusRow {
  student: string;
  subject: string; // "Maths", "English" or "Unknown subject"
  tutor: string;
  status: StudentStatus["status"]; // "" = no status selected
}

// A Students-tab row covering both subjects becomes two status rows, one per subject.
const statusRows = (list: StudentStatus[]): StatusRow[] =>
  list.flatMap((s) => (s.subjects.length ? s.subjects : ["Unknown subject"]).map((subject) =>
    ({ student: s.student, subject, tutor: s.tutor, status: s.status })))
    .sort((a, b) => a.student.localeCompare(b.student) || a.subject.localeCompare(b.subject));

export interface UnmatchedRow { id: string; name: string; email: string; planHours: number; hoursBilled: number; amountBilled: number; firstBilled: string; lastBilled: string }

const unmatchedRow = (u: Report["unmatchedLiveCustomers"][number]): UnmatchedRow => ({
  id: u.customer.id, name: u.customer.name, email: u.customer.email, planHours: u.customer.weeklyPlanHours,
  hoursBilled: u.hoursBilled, amountBilled: u.amountBilled, firstBilled: u.firstBilled, lastBilled: u.lastBilled,
});

export interface Snapshot {
  reconciledAt: string; // ISO timestamp
  asOf: string; // reconcile date, YYYY-MM-DD in local time
  datedFrom: string; // first day covered by the date-range views (DATED_WEEKS back from asOf)
  accounts: AccountRow[];
  unmatchedLive: UnmatchedRow[]; // billed, live subscription, not linked to a family
  unmatchedOther: UnmatchedRow[]; // billed in the period, no live subscription, not linked to a family
  orphanLinks: { key: string; customers: string }[]; // Stripe Links rows that match no family any more
  unmatchedClients: { parentEmail: string; parent: string; students: string; lessons: number; suggestion: { name: string; email: string; id: string } | null }[];
  issues: ClientIssue[];
  unlinkedLessons: Pick<Lesson, "date" | "hours" | "tutor" | "student" | "subject" | "parentEmail">[];
  unlinkedStatuses: StatusRow[]; // Students-tab rows not linked to a reconciled family
  lessonIssues: LessonIssue[];
}

export function toSnapshot(report: Report): Snapshot {
  const now = new Date();
  const asOf = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
  const start = new Date(asOf + "T00:00:00Z");
  start.setUTCDate(start.getUTCDate() - (DATED_WEEKS * 7 - 1));
  const datedFrom = start.toISOString().slice(0, 10);
  const inWindow = (l: { date: string }) => l.date >= datedFrom && l.date <= asOf;

  return {
    reconciledAt: now.toISOString(),
    asOf,
    datedFrom,
    accounts: report.accounts.map((a) => ({
      status: a.status,
      students: accountStudents(a),
      stripeNames: accountName(a),
      parentEmails: a.families.map((f) => f.parentEmail).filter(Boolean).join(", "),
      familyKey: a.families[0].key,
      customers: a.customers.map((c) => ({ id: c.id, name: c.name, email: c.email, planHours: c.weeklyPlanHours })),
      billed: a.billedHours,
      refunded: a.creditedHours,
      netBilled: a.netBilledHours,
      delivered: a.deliveredHours,
      balance: a.balance,
      dollars: a.pricePerHour ? Math.round(a.balance * a.pricePerHour) : null,
      pricePerHour: a.pricePerHour,
      planHours: a.weeklyPlanHours,
      unconverted: a.unconvertedAmount,
      lastBilled: a.lastBilled,
      hasProgram: a.hasProgram,
      dated: (report.lessonsByAccount.get(a) ?? []).filter(inWindow).sort((x, y) => x.date.localeCompare(y.date))
        .map(({ date, hours, tutor, student, subject }) => ({ date, hours, tutor, student, subject })),
      statuses: statusRows(report.statusesByAccount.get(a) ?? []),
      lessons: a.families.flatMap((f) => f.clients).map((c) => ({ student: c.studentName, maths: c.maths, english: c.english, row: c.row })),
      events: [...a.events].sort((x, y) => x.date.localeCompare(y.date))
        .map(({ date, kind, description, amount, hours }) => ({ date, kind, description, amount, hours })),
    })),
    unmatchedLive: report.unmatchedLiveCustomers.map(unmatchedRow),
    unmatchedOther: report.unmatchedOtherCustomers.map(unmatchedRow),
    orphanLinks: report.orphanLinks.map((o) => ({ key: o.key, customers: o.customerIds.join(", ") })),
    unmatchedClients: report.unmatchedClients.map((m) => ({
      parentEmail: m.family.key,
      parent: m.family.parentName,
      students: m.family.clients.map((c) => c.studentName).join(", "),
      lessons: familyLessons(m),
      suggestion: m.suggestion ? { name: m.suggestion.customer.name, email: m.suggestion.customer.email, id: m.suggestion.customer.id } : null,
    })),
    issues: report.issues,
    unlinkedLessons: report.unlinkedLessons.filter(inWindow).map(({ date, hours, tutor, student, subject, parentEmail }) => ({ date, hours, tutor, student, subject, parentEmail })),
    unlinkedStatuses: statusRows(report.unlinkedStatuses),
    lessonIssues: report.lessonIssues,
  };
}
