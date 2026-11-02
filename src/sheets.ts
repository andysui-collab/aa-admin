// Reads the master sheet and tutor trackers via their public CSV export links.
// - Clients tab: all-time lessons delivered = column O (Total Maths) + column P (Total English).
//   When a student switches tutors, lessons with the previous tutor are added to these by hand.
// - Each tutor's "Sessions" tab (listed in the Tutors tab, column E): one dated row per lesson,
//   used for the date-range views.

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

// Finds the gid of the "Sessions" tab from the sheet's public HTML view.
async function findSessionsGid(sheetId: string): Promise<string> {
  const html = await fetchText(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  const gid = html.match(/name: "Sessions", pageUrl: "[^"]*gid=(\d+)/)?.[1];
  if (!gid) throw new Error(`No "Sessions" tab found in tutor sheet ${sheetId}`);
  return gid;
}

// Tutor "Sessions" columns: A date (dd/mm/yyyy), B student, C subject, D hours, ..., J parent email.
export async function fetchLessons(): Promise<{ lessons: Lesson[]; issues: LessonIssue[] }> {
  const tutors = await fetchTutors();
  const lessons: Lesson[] = [];
  const issues: LessonIssue[] = [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(new Date());

  await Promise.all(tutors.map(async (tutor) => {
    let rows: string[][];
    try {
      rows = parseCsv(await fetchText(csvUrl(tutor.sheetId, await findSessionsGid(tutor.sheetId))));
    } catch (err) {
      issues.push({ tutor: tutor.name, row: "whole sheet", problem: err instanceof Error ? err.message : String(err) });
      return;
    }
    const headerIdx = rows.findIndex((r) => r[0]?.startsWith("Date"));
    for (const r of rows.slice(headerIdx + 1)) {
      if (!r[0]?.trim()) continue;
      const label = `${r[0]} ${r[1]} ${r[2]}`;
      const date = toIsoDate(r[0]);
      const hours = parseFloat(r[3]);
      if (!date) { issues.push({ tutor: tutor.name, row: label, problem: "unreadable date" }); continue; }
      if (date > today) issues.push({ tutor: tutor.name, row: label, problem: "date is in the future" });
      if (!(hours > 0)) issues.push({ tutor: tutor.name, row: label, problem: "missing lesson length, assumed 1 hr" });
      lessons.push({
        tutor: tutor.name,
        date,
        student: (r[1] ?? "").trim(),
        // Tutors log "Maths Methods", "General Maths" etc. - all count as Maths.
        subject: /math/i.test(r[2] ?? "") ? "Maths" : (r[2] ?? "").trim(),
        hours: hours > 0 ? hours : 1,
        parentEmail: (r[9] ?? "").trim().toLowerCase(),
      });
    }
  }));
  return { lessons, issues };
}
