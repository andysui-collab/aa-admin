// Builds the reconciliation report. Used by both the command line (npm run reconcile) and the website.

import { buildAccounts, type Account } from "./accounts.js";
import { fetchBilling, type BillingEvent, type Customer } from "./billing.js";
import { groupFamilies, loadLinks, matchFamilies, type Match } from "./match.js";
import { fetchClients, fetchTutorSheets, type ClientIssue, type Lesson, type LessonIssue, type StudentStatus } from "./sheets.js";

export interface UnmatchedCustomer {
  customer: Customer;
  hoursBilled: number;
  amountBilled: number;
  firstBilled: string;
  lastBilled: string;
}

export interface Report {
  accounts: Account[];
  flagged: Account[]; // not OK, biggest balance first
  matches: Match[];
  unmatchedClients: Match[];
  unmatchedLiveCustomers: UnmatchedCustomer[]; // live subscription, but no Clients row linked
  unmatchedCustomerCount: number; // billed in period (live or not), no Clients row linked
  issues: ClientIssue[];
  events: BillingEvent[];
  lessonsByAccount: Map<Account, Lesson[]>; // dated lessons from the tutor sheets
  unlinkedLessons: Lesson[]; // tutor-sheet lessons we couldn't link to a reconciled family
  statusesByAccount: Map<Account, StudentStatus[]>; // Students-tab rows (status per tutor and subject)
  unlinkedStatuses: StudentStatus[];
  lessonIssues: LessonIssue[];
}

export const accountName = (a: Account) => [...new Set(a.customers.map((c) => c.name.trim() || c.email))].join(" / ");
export const accountStudents = (a: Account) => a.families.flatMap((f) => f.clients.map((c) => c.studentName)).join(", ");
export const familyLessons = (m: Match) => m.family.clients.reduce((s, c) => s + c.maths + c.english, 0);

export async function buildReport(): Promise<Report> {
  const [{ clients, issues }, { customers, events }, links, { lessons, statuses, issues: lessonIssues }] =
    await Promise.all([fetchClients(), fetchBilling(), loadLinks(), fetchTutorSheets()]);

  const billedCustomerIds = new Set(events.filter((e) => e.amount > 0).map((e) => e.customerId));
  const matches = matchFamilies(groupFamilies(clients), customers, billedCustomerIds, links);
  const accounts = buildAccounts(matches, customers, events);

  const matchedCustomerIds = new Set(matches.flatMap((m) => m.customerIds));
  const unmatchedCustomerIds = [...billedCustomerIds].filter((id) => !matchedCustomerIds.has(id) && !links.ignored.has(id));
  const unmatchedLiveCustomers = unmatchedCustomerIds
    .map((id) => customers.get(id)!)
    .filter((c) => c.weeklyPlanHours > 0)
    .map((customer) => {
      const billed = events.filter((e) => e.customerId === customer.id && e.amount > 0);
      const dates = billed.map((e) => e.date).sort();
      return {
        customer,
        hoursBilled: billed.reduce((s, e) => s + (e.hours ?? 0), 0),
        amountBilled: billed.reduce((s, e) => s + e.amount, 0),
        firstBilled: dates[0],
        lastBilled: dates[dates.length - 1],
      };
    });

  const linkToAccount = accountLinker(accounts);
  const lessonsByAccount = new Map<Account, Lesson[]>(accounts.map((a) => [a, []]));
  const statusesByAccount = new Map<Account, StudentStatus[]>(accounts.map((a) => [a, []]));
  const unlinkedLessons: Lesson[] = [];
  const unlinkedStatuses: StudentStatus[] = [];
  for (const lesson of lessons) {
    const account = linkToAccount(lesson.parentEmail, lesson.student);
    if (account) lessonsByAccount.get(account)!.push(lesson); else unlinkedLessons.push(lesson);
  }
  for (const status of statuses) {
    const account = linkToAccount(status.parentEmail, status.student);
    if (account) statusesByAccount.get(account)!.push(status); else unlinkedStatuses.push(status);
  }

  return {
    accounts,
    flagged: accounts.filter((a) => a.status !== "OK").sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)),
    matches,
    unmatchedClients: matches.filter((m) => !m.customerIds.length),
    unmatchedLiveCustomers,
    unmatchedCustomerCount: unmatchedCustomerIds.length,
    issues,
    events,
    lessonsByAccount,
    unlinkedLessons,
    statusesByAccount,
    unlinkedStatuses,
    lessonIssues,
  };
}

const firstName = (s: string) => s.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

// Tutor-sheet rows (lessons, statuses) -> accounts, in order of trust:
//   1. parent email matches the family's parent or student email
//   2. the student's full name matches exactly one family
//   3. only for rows with no parent email at all: the student's first name matches exactly one family
// A row whose email matches no family isn't guessed by first name (e.g. a student removed from the Clients tab
// who shares a first name with someone else).
function accountLinker(accounts: Account[]) {
  const byEmail = new Map<string, Account>();
  const byFullName = new Map<string, Set<Account>>();
  const byFirstName = new Map<string, Set<Account>>();
  const add = (map: Map<string, Set<Account>>, key: string, account: Account) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key)!.add(account);
  };
  for (const account of accounts) {
    for (const family of account.families) {
      for (const email of family.candidateEmails) byEmail.set(email, account);
      for (const client of family.clients) {
        add(byFullName, client.studentName.trim().toLowerCase().replace(/\s+/g, " "), account);
        add(byFirstName, firstName(client.studentName), account);
      }
    }
  }
  const unique = (set?: Set<Account>) => (set?.size === 1 ? [...set][0] : undefined);
  return (parentEmail: string, student: string): Account | undefined =>
    byEmail.get(parentEmail) ??
    unique(byFullName.get(student.trim().toLowerCase().replace(/\s+/g, " "))) ??
    (parentEmail ? undefined : unique(byFirstName.get(firstName(student))));
}
