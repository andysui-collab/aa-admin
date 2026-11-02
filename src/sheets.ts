// Reads the Clients tab of the master sheet via its public CSV export link.
// Lessons delivered = column O (Total Maths) + column P (Total English). When a student
// switches tutors, lessons with the previous tutor are added to these counts by hand.

import { MASTER_CLIENTS_GID, MASTER_SHEET_ID } from "./config.js";

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
  const url = `https://docs.google.com/spreadsheets/d/${MASTER_SHEET_ID}/export?format=csv&gid=${MASTER_CLIENTS_GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't read the Clients tab: ${res.status}`);
  const rows = parseCsv(await res.text());

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
