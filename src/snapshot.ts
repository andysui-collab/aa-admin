// A saved reconciliation result: plain data (no Maps/Sets) so it can be stored as JSON
// and shown later without re-running the reconciliation.

import type { Account } from "./accounts.js";
import type { BillingEvent } from "./billing.js";
import type { ClientIssue, Lesson, LessonIssue } from "./sheets.js";
import { accountName, accountStudents, familyLessons, type Report } from "./report.js";

export interface AccountRow {
  status: Account["status"];
  students: string;
  stripeNames: string;
  parentEmails: string;
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
  events: Pick<BillingEvent, "date" | "kind" | "description" | "amount" | "hours">[];
}

export interface Snapshot {
  reconciledAt: string; // ISO timestamp
  accounts: AccountRow[];
  unmatchedLive: { name: string; email: string; planHours: number; hoursBilled: number; amountBilled: number; firstBilled: string; lastBilled: string }[];
  unmatchedClients: { parentEmail: string; parent: string; students: string; lessons: number; suggestion: { name: string; email: string; id: string } | null }[];
  issues: ClientIssue[];
  unlinkedLessons: Pick<Lesson, "date" | "hours" | "tutor" | "student" | "subject" | "parentEmail">[];
  lessonIssues: LessonIssue[];
}

export function toSnapshot(report: Report): Snapshot {
  return {
    reconciledAt: new Date().toISOString(),
    accounts: report.accounts.map((a) => ({
      status: a.status,
      students: accountStudents(a),
      stripeNames: accountName(a),
      parentEmails: a.families.map((f) => f.parentEmail).filter(Boolean).join(", "),
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
      dated: (report.lessonsByAccount.get(a) ?? []).sort((x, y) => x.date.localeCompare(y.date))
        .map(({ date, hours, tutor, student, subject }) => ({ date, hours, tutor, student, subject })),
      lessons: a.families.flatMap((f) => f.clients).map((c) => ({ student: c.studentName, maths: c.maths, english: c.english, row: c.row })),
      events: [...a.events].sort((x, y) => x.date.localeCompare(y.date))
        .map(({ date, kind, description, amount, hours }) => ({ date, kind, description, amount, hours })),
    })),
    unmatchedLive: report.unmatchedLiveCustomers.map((u) => ({
      name: u.customer.name, email: u.customer.email, planHours: u.customer.weeklyPlanHours,
      hoursBilled: u.hoursBilled, amountBilled: u.amountBilled, firstBilled: u.firstBilled, lastBilled: u.lastBilled,
    })),
    unmatchedClients: report.unmatchedClients.map((m) => ({
      parentEmail: m.family.key,
      parent: m.family.parentName,
      students: m.family.clients.map((c) => c.studentName).join(", "),
      lessons: familyLessons(m),
      suggestion: m.suggestion ? { name: m.suggestion.customer.name, email: m.suggestion.customer.email, id: m.suggestion.customer.id } : null,
    })),
    issues: report.issues,
    unlinkedLessons: report.unlinkedLessons.map(({ date, hours, tutor, student, subject, parentEmail }) => ({ date, hours, tutor, student, subject, parentEmail })),
    lessonIssues: report.lessonIssues,
  };
}
