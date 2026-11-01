// Reads the master sheet and every tutor's tracker via their public CSV export links.

import { MASTER_CLIENTS_GID, MASTER_SHEET_ID } from "./config.js";

export interface Lesson {
  tutor: string;
  date: string; // YYYY-MM-DD
  student: string;
  subject: string; // "Maths" or "English"
  hours: number;
  parentName: string;
  parentEmail: string; // lowercased, may be empty
}

export interface Client {
  studentName: string;
  studentEmail: string;
  parentName: string;
  parentEmail: string;
  totalMaths: string;
  totalEnglish: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}

const csvUrl = (sheetId: string, gid: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

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

// dd/mm/yyyy -> yyyy-mm-dd
function toIsoDate(ddmmyyyy: string): string | null {
  const m = ddmmyyyy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

export async function fetchClients(): Promise<Client[]> {
  const rows = parseCsv(await fetchText(csvUrl(MASTER_SHEET_ID, MASTER_CLIENTS_GID)));
  return rows.slice(1).filter((r) => r[1]?.trim() || r[4]?.trim()).map((r) => ({
    studentName: r[1].trim(),
    studentEmail: r[2].trim().toLowerCase(),
    parentName: r[3].trim(),
    parentEmail: r[4].trim().toLowerCase(),
    totalMaths: r[14].trim(),
    totalEnglish: r[15].trim(),
  }));
}

async function fetchTutors(): Promise<{ name: string; sheetId: string }[]> {
  const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Tutors`;
  const rows = parseCsv(await fetchText(url));
  return rows.slice(1).flatMap((r) => {
    const sheetId = r[4]?.match(/\/d\/([^/]+)/)?.[1];
    return sheetId ? [{ name: r[1].trim() || r[0].trim(), sheetId }] : [];
  });
}

// Finds the gid of the "Sessions" tab from the sheet's public HTML view.
async function findSessionsGid(sheetId: string): Promise<string> {
  const html = await fetchText(`https://docs.google.com/spreadsheets/d/${sheetId}/htmlview`);
  const gid = html.match(/name: "Sessions", pageUrl: "[^"]*gid=(\d+)/)?.[1];
  if (!gid) throw new Error(`No "Sessions" tab found in tutor sheet ${sheetId}`);
  return gid;
}

export interface LessonIssue {
  tutor: string;
  row: string;
  problem: string;
}

export async function fetchLessons(): Promise<{ lessons: Lesson[]; issues: LessonIssue[] }> {
  const tutors = await fetchTutors();
  const lessons: Lesson[] = [];
  const issues: LessonIssue[] = [];
  const today = new Date().toISOString().slice(0, 10);

  await Promise.all(tutors.map(async (tutor) => {
    const rows = parseCsv(await fetchText(csvUrl(tutor.sheetId, await findSessionsGid(tutor.sheetId))));
    const headerIdx = rows.findIndex((r) => r[0]?.startsWith("Date"));
    for (const r of rows.slice(headerIdx + 1)) {
      if (!r[0]?.trim()) continue;
      const label = `${r[0]} ${r[1]} ${r[2]}`;
      const date = toIsoDate(r[0]);
      const hours = parseFloat(r[3]);
      if (!date) { issues.push({ tutor: tutor.name, row: label, problem: "unreadable date" }); continue; }
      if (date > today) issues.push({ tutor: tutor.name, row: label, problem: "date is in the future" });
      if (!(hours > 0)) issues.push({ tutor: tutor.name, row: label, problem: "missing lesson length, assumed 1 hr" });
      if (!r[9]?.trim()) issues.push({ tutor: tutor.name, row: label, problem: "missing parent email" });
      lessons.push({
        tutor: tutor.name,
        date,
        student: r[1].trim(),
        // Tutors log "Maths Methods", "General Maths" etc. - all count as Maths.
        subject: /math/i.test(r[2]) ? "Maths" : r[2].trim(),
        hours: hours > 0 ? hours : 1,
        parentName: (r[8] ?? "").trim(),
        parentEmail: (r[9] ?? "").trim().toLowerCase(),
      });
    }
  }));
  return { lessons, issues };
}
