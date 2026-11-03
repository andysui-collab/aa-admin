// Reads the master sheet and tutor trackers via their public CSV export links.
// - Clients tab: all-time lessons delivered = column O (Total Maths) + column P (Total English).
//   When a student switches tutors, lessons with the previous tutor are added to these by hand.
// - Each tutor's "Sessions" tab (listed in the Tutors tab, column E): one dated row per lesson,
//   used for the date-range views; and "Students" tab: each student's Status (ACTIVE/PAUSED/CANCELLED).

import { MASTER_CLIENTS_GID, MASTER_SHEET_ID, TIMEZONE } from "./config.js";

export interface Client {
  row: number; // sheet row number, for finding it again
  studentName: string;
  studentEmail: string;
  parentName: string;
  parentEmail: string; // lowercased, may be empty
  maths: number;
  english: number;
}

export interface ClientIssue {
  row: number;
  student: string;
  problem: string;
}

// Small RFC 4180 CSV parser (handles quoted fields with commas and newlines).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export async function fetchClients(): Promise<{ clients: Client[]; issues: ClientIssue[] }> {
  const rows = parseCsv(await fetchText(csvUrl(MASTER_SHEET_ID, MASTER_CLIENTS_GID)));

  const clients: Client[] = [];
  const issues: ClientIssue[] = [];
  rows.forEach((r, i) => {
    if (i === 0 || !(r[1]?.trim() || r[4]?.trim())) return;
    const row = i + 1;
    const student = r[1].trim();
    const count = (cell: string | undefined, column: string) => {
      const value = (cell ?? "").trim();
      if (!value) return 0;
      const n = Number(value);
      if (Number.isNaN(n)) { issues.push({ row, student, problem: `column ${column} isn't a number: "${value}"` }); return 0; }
      return n;
    };
    const client: Client = {
      row,
      studentName: student,
      studentEmail: (r[2] ?? "").trim().toLowerCase(),
      parentName: (r[3] ?? "").trim(),
      parentEmail: (r[4] ?? "").trim().toLowerCase(),
      maths: count(r[14], "O"),
      english: count(r[15], "P"),
    };
    if (!client.parentEmail) issues.push({ row, student, problem: "missing parent email" });
    clients.push(client);
  });
  return { clients, issues };
}

export interface Lesson {
  tutor: string;
  date: string; // YYYY-MM-DD
  student: string;
  subject: string; // "Maths" or "English"
  hours: number;
  parentEmail: string; // lowercased, may be empty
}

export interface LessonIssue {
  tutor: string;
  row: string;
  problem: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read ${url}: ${res.status}`);
  return res.text();
}

const csvUrl = (sheetId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

// dd/mm/yyyy -> yyyy-mm-dd
function toIsoDate(ddmmyyyy: string): string | null {
  const m = ddmmyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

async function fetchTutors(): Promise<{ name: string; sheetId: string }[]> {
  const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Tutors`;
  return parseCsv(await fetchText(url)).slice(1).flatMap((r) => {
    const sheetId = r[4]?.match(/\/d\/([^/]+)/)?.[1];
    return sheetId ? [{ name: r[1]?.trim() || r[0].trim(), sheetId }] : [];
  });
}

// Finds a tab's gid from the sheet's public HTML view.
function findTabGid(html: string, sheetId: string, tabName: string): string {
  const gid = html.match(new RegExp(`name: "${tabName}", pageUrl: "[^"]*gid=(\\d+)`))?.[1];
  if (!gid) throw new Error(`No "${tabName}" tab found in tutor sheet ${sheetId}`);
  return gid;
}

// Index of the column whose header starts with `label` (case-insensitive), or `fallback` if not found.
function column(header: string[], label: string, fallback: number): number {
  const i = header.findIndex((h) => h.trim().toLowerCase().startsWith(label.toLowerCase()));
  return i >= 0 ? i : fallback;
}

export type StatusValue = "ACTIVE" | "PAUSED" | "CANCELLED" | "";

// One row of a tutor's Students tab. A row covers the subject(s) that tutor teaches the student.
export interface StudentStatus {
  tutor: string;
  student: string;
  parentEmail: string; // lowercased, may be empty
  subjects: string[]; // "Maths" and/or "English"; empty if it can't be worked out
  status: StatusValue;
}

// "General Maths", "Maths Methods" -> Maths; "QLD English", "Advanced English" -> English.
function subjectsIn(text: string): string[] {
  return [/math/i.test(text) ? "Maths" : "", /english/i.test(text) ? "English" : ""].filter(Boolean);
}

// Reads every tutor's Sessions tab (dated lessons) and Students tab (statuses). Columns are found by
// their header names, so moving or adding columns in the tutor template doesn't break this.
export async function fetchTutorSheets(): Promise<{ lessons: Lesson[]; statuses: StudentStatus[]; issues: LessonIssue[] }> {
  const tutors = await fetchTutors();
  const lessons: Lesson[] = [];
  const statuses: StudentStatus[] = [];
  const issues: LessonIssue[] = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());

  await Promise.all(tutors.map(async (tutor) => {
    let sessionRows: string[][], studentRows: string[][];
    try {
      const html = await fetchText(`https://docs.google.com/spreadsheets/d/${tutor.sheetId}/htmlview`);
      [sessionRows, studentRows] = await Promise.all(["Sessions", "Students"].map(async (tab) =>
        parseCsv(await fetchText(csvUrl(tutor.sheetId, findTabGid(html, tutor.sheetId, tab))))));
    } catch (err) {
      issues.push({ tutor: tutor.name, row: "whole sheet", problem: err instanceof Error ? err.message : String(err) });
      return;
    }

    // Sessions: header row starts with "Date"
    const sh = sessionRows.findIndex((r) => r[0]?.startsWith("Date"));
    const sHeader = sessionRows[sh] ?? [];
    const col = {
      date: column(sHeader, "Date", 0), student: column(sHeader, "Student Name", 1), subject: column(sHeader, "Subject", 2),
      hours: column(sHeader, "Lesson Length", 3), email: column(sHeader, "Parent Email", 9),
    };
    const tutorLessons: Lesson[] = [];
    for (const r of sessionRows.slice(sh + 1)) {
      if (!r[col.date]?.trim()) continue;
      const label = `${r[col.date]} ${r[col.student]} ${r[col.subject]}`;
      const date = toIsoDate(r[col.date]);
      const hours = parseFloat(r[col.hours]);
      if (!date) { issues.push({ tutor: tutor.name, row: label, problem: "unreadable date" }); continue; }
      if (date > today) issues.push({ tutor: tutor.name, row: label, problem: "date is in the future" });
      if (!(hours > 0)) issues.push({ tutor: tutor.name, row: label, problem: "missing lesson length, assumed 1 hr" });
      tutorLessons.push({
        tutor: tutor.name,
        date,
        student: (r[col.student] ?? "").trim(),
        // Tutors log "Maths Methods", "General Maths" etc. - all count as Maths.
        subject: /math/i.test(r[col.subject] ?? "") ? "Maths" : (r[col.subject] ?? "").trim(),
        hours: hours > 0 ? hours : 1,
        parentEmail: (r[col.email] ?? "").trim().toLowerCase(),
      });
    }
    lessons.push(...tutorLessons);

    // Students: header row contains "Student Name"; Status is in the column headed "Status" (column A)
    const th = studentRows.findIndex((r) => r.some((c) => c.trim() === "Student Name"));
    if (th < 0) { issues.push({ tutor: tutor.name, row: "Students tab", problem: "no \"Student Name\" header found" }); return; }
    const tHeader = studentRows[th];
    const scol = {
      status: tHeader.findIndex((h) => h.trim() === "Status"), name: column(tHeader, "Student Name", 1),
      email: column(tHeader, "Parent Email", 5), subjects: column(tHeader, "Subjects", 7),
    };
    for (const r of studentRows.slice(th + 1)) {
      const student = (r[scol.name] ?? "").trim();
      if (!student) continue;
      const raw = scol.status >= 0 ? (r[scol.status] ?? "").trim().toUpperCase() : "";
      const status: StatusValue = raw === "ACTIVE" || raw === "PAUSED" || raw === "CANCELLED" ? raw : "";
      // Subject from the Subjects column, else from what this tutor has logged for the student
      let subjects = subjectsIn(r[scol.subjects] ?? "");
      if (!subjects.length) {
        const logged = tutorLessons.filter((l) => l.student.toLowerCase() === student.toLowerCase()).map((l) => l.subject);
        subjects = subjectsIn(logged.join(" "));
      }
      statuses.push({ tutor: tutor.name, student, parentEmail: (r[scol.email] ?? "").trim().toLowerCase(), subjects, status });
    }
  }));
  return { lessons, statuses, issues };
}
