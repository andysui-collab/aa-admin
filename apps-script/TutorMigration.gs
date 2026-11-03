// One-off move of every tutor sheet to the new template (the layout of the reference tutor's sheet),
// plus the matching fix to the master sheet's Clients O/P formulas. Lives in the master sheet's
// Apps Script project. Run the functions in this order, from the function menu:
//
//   1. previewMigration    Changes nothing. Writes every planned change to a "Migration Preview" tab.
//   2. migrateTestSheet    Backs up, then migrates only MIG.TEST_TUTOR's sheet and its O/P formulas. Check it.
//   3. migrateAllSheets    Backs up, then migrates every remaining sheet and O/P formula, and installs the
//                          Status triggers. If it stops at Google's 6-minute limit, run it again: finished
//                          sheets are skipped.
//
// Before any sheet is changed, a copy of it is saved in a Drive folder called "Tutor sheet backups".

const MIG = {
  REFERENCE_TUTOR: "Jianzhi",
  TEST_TUTOR: "Darcy",
  PREVIEW_TAB: "Migration Preview",
  BACKUP_FOLDER: "Tutor sheet backups",
  FIRST_STUDENT_ROW: 4,
  MIN_FORMULA_ROW: 103, // Students formulas are filled down to at least this row (100 students)
  ACTIVE_WITHIN_DAYS: 28, // students with a lesson this recently get Status ACTIVE when a sheet is migrated
  STATUS_OPTIONS: ["ACTIVE", "PAUSED", "CANCELLED"],
  STATE_PATTERN: /\((VCE|HSC|QCE|WACE|SACE|TCE)\)|Victoria|New South Wales|Queensland|Western Australia|South Australia|Tasmania/i,
  TRIGGER_HANDLER: "tutorStudentsOnEdit",
};

function previewMigration() { migRun_({ apply: false, only: null }); }
function migrateTestSheet() { migRun_({ apply: true, only: MIG.TEST_TUTOR }); }
function migrateAllSheets() { migRun_({ apply: true, only: null }); }

// ---------------------------------------------------------------------------------------------------

function migRun_(options) {
  const master = SpreadsheetApp.getActive();
  const props = PropertiesService.getScriptProperties();
  const tutors = migTutors_(master);
  const ref = tutors.find((t) => t.name === MIG.REFERENCE_TUTOR);
  if (!ref) throw new Error("Reference tutor " + MIG.REFERENCE_TUTOR + " isn't in the Tutors tab");
  const refSS = SpreadsheetApp.openById(ref.id);
  const reference = {
    students: refSS.getSheetByName("Students"),
    sessionsFormulas: refSS.getSheetByName("Sessions").getRange("G6:J6").getFormulas()[0],
  };
  const clientsIndex = migClientsIndex_(master);
  const report = [["Sheet", "Layout found", "Change"]];
  const migratedRows = new Set(); // Tutors-tab rows whose sheet is in the new layout after this run
  const started = Date.now();

  for (const tutor of tutors) {
    if (options.only && tutor.name !== options.only) {
      // Sheets not touched in this run still count as "new layout" if they already are.
      if (migSheetLayout_(tutor) === "NEW") migratedRows.add(tutor.row);
      continue;
    }
    if (options.apply && props.getProperty("migrated:" + tutor.id)) {
      report.push([tutor.name, "", "Already migrated in an earlier run, skipped"]);
      migratedRows.add(tutor.row);
      continue;
    }
    if (options.apply && Date.now() - started > 4.5 * 60 * 1000) {
      report.push([tutor.name, "", "Not done yet: close to Google's time limit. Run migrateAllSheets again."]);
      continue;
    }
    try {
      const lines = migSheet_(tutor, reference, clientsIndex, options.apply);
      lines.layout.forEach((line) => report.push([tutor.name, lines.found, line]));
      if (lines.found !== "UNKNOWN") migratedRows.add(tutor.row);
      if (options.apply) {
        migInstallTrigger_(tutor);
        props.setProperty("migrated:" + tutor.id, new Date().toISOString());
      }
    } catch (err) {
      report.push([tutor.name, "", "ERROR: " + err.message + " (nothing after this point was changed in this sheet)"]);
    }
  }

  // Clients O/P formulas: only for tutors whose sheets are now in the new layout
  if (options.apply) migBackup_(master.getId(), "Master sheet");
  migFixClientFormulas_(master, tutors, migratedRows, options.apply).forEach((line) => report.push(["MASTER Clients", "", line]));

  // Write the report (the preview tab is also updated after a real run, as a log)
  let tab = master.getSheetByName(MIG.PREVIEW_TAB);
  if (tab) tab.clear(); else tab = master.insertSheet(MIG.PREVIEW_TAB);
  report.splice(1, 0, ["", "", (options.apply ? "APPLIED " : "PREVIEW ONLY, nothing changed. ") + new Date().toString()]);
  tab.getRange(1, 1, report.length, 3).setValues(report.map((r) => r.map((c) => String(c).slice(0, 45000))));
  tab.setFrozenRows(1);
  tab.setColumnWidth(3, 900);
}

// Tutors tab: row 1 title, row 2 headers, tutors from row 3. Column B first name, column E tracker link.
function migTutors_(master) {
  const values = master.getSheetByName("Tutors").getDataRange().getValues();
  const tutors = [];
  for (let i = 2; i < values.length; i++) {
    const match = String(values[i][4]).match(/\/d\/([a-zA-Z0-9_-]+)/);
    const name = String(values[i][1] || values[i][0]).trim();
    if (match && name) tutors.push({ row: i + 1, name: name, id: match[1] });
  }
  return tutors;
}

function migLayoutOf_(header) {
  const h = header.map((v) => String(v).trim());
  if (h[1] === "Student Name" && h[3] === "State" && h[4] === "Parent Name") return "NEW";
  if (h[1] === "Student Name" && h[3] === "Parent Name" && h[4] === "State") return "NEW_SWAPPED";
  if (h[0] === "Student Name" && h[2] === "State" && h[3] === "Parent Name") return "OLD_STATE";
  if (h[0] === "Student Name" && h[1] === "Year Level" && h[2] === "Parent Name") return "OLDEST";
  return "UNKNOWN";
}

function migSheetLayout_(tutor) {
  const students = SpreadsheetApp.openById(tutor.id).getSheetByName("Students");
  return students ? migLayoutOf_(migHeader_(students)) : "UNKNOWN";
}

// Row 3 of a Students tab (up to 14 columns; works on narrower sheets too)
function migHeader_(students) {
  return students.getRange(3, 1, 1, Math.min(14, students.getMaxColumns())).getValues()[0];
}

// Clients tab lookups for filling in State: by parent email, then by student first name
function migClientsIndex_(master) {
  const values = master.getSheetByName("Clients").getDataRange().getValues();
  const byEmail = {}, byFirstName = {};
  for (let i = 1; i < values.length; i++) {
    const curriculum = String(values[i][7]).trim(); // column H
    if (!curriculum) continue;
    const email = String(values[i][4]).trim().toLowerCase();
    const first = String(values[i][1]).trim().split(/\s+/)[0].toLowerCase();
    if (email) byEmail[email] = curriculum;
    if (first) byFirstName[first] = byFirstName[first] === undefined ? curriculum : null; // null = ambiguous
  }
  return { byEmail: byEmail, byFirstName: byFirstName };
}

// Migrates (or, with apply=false, only describes) one tutor sheet.
function migSheet_(tutor, reference, clientsIndex, apply) {
  const ss = SpreadsheetApp.openById(tutor.id);
  const students = ss.getSheetByName("Students");
  const sessions = ss.getSheetByName("Sessions");
  if (!students || !sessions) return { found: "UNKNOWN", layout: ["Missing Students or Sessions tab: skipped"] };
  const found = migLayoutOf_(migHeader_(students));
  const lines = [];
  if (found === "UNKNOWN") return { found: found, layout: ["Students headers don't match any known layout: skipped, nothing changed"] };
  const isReference = tutor.name === MIG.REFERENCE_TUTOR;

  // Read everything needed before changing anything
  const lastRow = students.getLastRow();
  const before = students.getRange(1, 1, Math.max(lastRow, 3), students.getMaxColumns()).getValues();
  const nameCol = found === "OLD_STATE" || found === "OLDEST" ? 0 : 1;
  const studentRows = [];
  for (let r = MIG.FIRST_STUDENT_ROW - 1; r < before.length; r++) {
    if (String(before[r][nameCol]).trim()) studentRows.push(r + 1);
  }
  const lastStudentRow = studentRows.length ? studentRows[studentRows.length - 1] : MIG.FIRST_STUDENT_ROW;
  const formulaLastRow = Math.max(MIG.MIN_FORMULA_ROW, lastStudentRow);

  // Rows typed in a different layout than the rest of the sheet (seen in Sara's sheet)
  const shifted = [];
  if (found === "OLDEST") {
    studentRows.forEach((row) => {
      const r = before[row - 1];
      if (MIG.STATE_PATTERN.test(String(r[2]))) shifted.push({ row: row, values: r.slice(0, 8) }); // Name, Year, State, Parent, Email, Phone, Subjects, Tutor
    });
  }

  // Last lesson per student, for the starting Status
  const sessionValues = sessions.getRange(6, 1, Math.max(sessions.getLastRow() - 5, 1), 2).getValues();
  const lastLesson = {};
  sessionValues.forEach((r) => {
    if (!(r[0] instanceof Date) || !String(r[1]).trim()) return;
    const key = String(r[1]).trim();
    if (!lastLesson[key] || r[0] > lastLesson[key]) lastLesson[key] = r[0];
  });
  const activeSince = new Date(Date.now() - MIG.ACTIVE_WITHIN_DAYS * 24 * 3600 * 1000);

  // ---- Describe the plan
  if (found === "NEW_SWAPPED") lines.push("Swap Students columns D and E back so D = State and E = Parent Name (fixes Sessions 'Parent Name' showing states)");
  if (found === "OLD_STATE") lines.push("Insert Status column at A (everything moves one column right)");
  if (found === "OLDEST") lines.push("Insert Status column at A and State column at D (everything else moves right)");
  shifted.forEach((s) => lines.push("Fix row " + s.row + " (" + s.values[0] + "): it was typed one column out of place; put each value back in its column"));
  if (!isReference) lines.push("Copy rows 1–3 (instructions and headers) and column widths from " + MIG.REFERENCE_TUTOR + "'s sheet");
  lines.push("Students J4:N" + formulaLastRow + ": one formula per row, same as the reference; Most Recent Session fixed to show 'No sessions yet' instead of 0 and formatted as a date");
  lines.push("Sessions G6:J6: the reference's whole-column formulas (G7:J" + sessions.getMaxRows() + " cleared first so they can fill down)");
  lines.push("Status column: ACTIVE / PAUSED / CANCELLED dropdown and colours" + (found === "NEW" ? " (re-applied)" : ""));

  // Starting Status for students with none yet
  const statusPlan = [];
  studentRows.forEach((row) => {
    const name = String(before[row - 1][nameCol]).trim();
    const existing = nameCol === 1 ? String(before[row - 1][0]).trim() : "";
    if (existing) return;
    const last = lastLesson[name];
    statusPlan.push({ row: row, name: name, status: last && last >= activeSince ? "ACTIVE" : "" ,
      last: last ? Utilities.formatDate(last, "Australia/Melbourne", "d MMM yyyy") : "never" });
  });
  statusPlan.forEach((s) => lines.push("Status for " + s.name + ": " + (s.status || "left blank for you to choose (last lesson " + s.last + ")")));

  // State for students with none yet (oldest layout has no State column at all)
  const statePlan = [];
  studentRows.forEach((row) => {
    const r = before[row - 1];
    const shiftedRow = shifted.find((s) => s.row === row);
    let state = "", parentEmail = "", name = "";
    if (found === "OLDEST") { name = r[0]; parentEmail = shiftedRow ? r[4] : r[3]; state = shiftedRow ? r[2] : ""; }
    else if (found === "OLD_STATE") { name = r[0]; state = r[2]; parentEmail = r[4]; }
    else if (found === "NEW") { name = r[1]; state = r[3]; parentEmail = r[5]; }
    else { name = r[1]; state = r[4]; parentEmail = r[5]; } // NEW_SWAPPED: state currently in E
    if (String(state).trim()) return;
    const email = String(parentEmail).trim().toLowerCase();
    const first = String(name).trim().split(/\s+/)[0].toLowerCase();
    const fill = clientsIndex.byEmail[email] || clientsIndex.byFirstName[first] || "";
    statePlan.push({ row: row, name: String(name).trim(), state: fill });
  });
  statePlan.forEach((s) => lines.push("State for " + s.name + ": " + (s.state ? s.state + " (from Clients tab)" : "not found in Clients tab, left blank")));

  if (!apply) return { found: found, layout: lines };

  // ---- Apply
  migBackup_(tutor.id, tutor.name);

  if (found === "NEW_SWAPPED") {
    const range = students.getRange(3, 4, Math.max(lastRow - 2, 1), 2);
    range.setValues(range.getValues().map((pair) => [pair[1], pair[0]]));
  }
  if (found === "OLD_STATE" || found === "OLDEST") students.insertColumnBefore(1);
  if (found === "OLDEST") students.insertColumnBefore(4);
  shifted.forEach((s) => students.getRange(s.row, 2, 1, 8).setValues([s.values]));
  if (students.getMaxColumns() < 14) students.insertColumnsAfter(students.getMaxColumns(), 14 - students.getMaxColumns());

  if (students.getMaxRows() < formulaLastRow) students.insertRowsAfter(students.getMaxRows(), formulaLastRow - students.getMaxRows());

  // Rows 1–3 and column widths from the reference
  if (!isReference) {
    const refTop = reference.students.getRange("A1:N3");
    const top = students.getRange("A1:N3");
    students.getRange(1, 1, 3, students.getMaxColumns()).breakApart();
    students.getRange(1, 1, 2, students.getMaxColumns()).clearContent();
    top.setValues(refTop.getValues());
    top.setBackgrounds(refTop.getBackgrounds());
    top.setFontColors(refTop.getFontColors());
    top.setFontWeights(refTop.getFontWeights());
    top.setFontSizes(refTop.getFontSizes());
    top.setFontFamilies(refTop.getFontFamilies());
    top.setWraps(refTop.getWraps());
    top.setHorizontalAlignments(refTop.getHorizontalAlignments());
    top.setVerticalAlignments(refTop.getVerticalAlignments());
    refTop.getMergedRanges().forEach((m) => students.getRange(m.getA1Notation()).merge());
    for (let r = 1; r <= 3; r++) students.setRowHeight(r, reference.students.getRowHeight(r));
    for (let c = 1; c <= 14; c++) students.setColumnWidth(c, reference.students.getColumnWidth(c));
    students.setFrozenRows(3);
  }

  // Students formulas J:N, one per row
  students.getRange(MIG.FIRST_STUDENT_ROW, 10, students.getMaxRows() - MIG.FIRST_STUDENT_ROW + 1, 5).clearContent();
  const formulas = [];
  for (let r = MIG.FIRST_STUDENT_ROW; r <= formulaLastRow; r++) {
    formulas.push([
      '=IF(B' + r + '="","",COUNTIFS(Sessions!$B:$B,B' + r + ',Sessions!$C:$C,"*Maths*"))',
      '=IF(B' + r + '="","",COUNTIFS(Sessions!$B:$B,B' + r + ',Sessions!$C:$C,"*English*"))',
      '=IF(B' + r + '="","",COUNTIF(Sessions!$B:$B,B' + r + ')-J' + r + '-K' + r + ')',
      '=IF(B' + r + '="","",COUNTIF(Sessions!$B:$B,B' + r + '))',
      '=IF(B' + r + '="","",IF(COUNTIF(Sessions!$B:$B,B' + r + ')=0,"No sessions yet",MAXIFS(Sessions!$A:$A,Sessions!$B:$B,B' + r + ')))',
    ]);
  }
  const formulaRange = students.getRange(MIG.FIRST_STUDENT_ROW, 10, formulas.length, 5);
  formulaRange.setFormulas(formulas);
  students.getRange(MIG.FIRST_STUDENT_ROW, 10, formulas.length, 4).setNumberFormat("0");
  students.getRange(MIG.FIRST_STUDENT_ROW, 14, formulas.length, 1).setNumberFormat("dd/mm/yyyy");

  // Status and State values
  statusPlan.forEach((s) => { if (s.status) students.getRange(s.row, 1).setValue(s.status); });
  statePlan.forEach((s) => { if (s.state) students.getRange(s.row, 4).setValue(s.state); });

  // Status dropdown and colours
  const statusRange = students.getRange(MIG.FIRST_STUDENT_ROW, 1, students.getMaxRows() - MIG.FIRST_STUDENT_ROW + 1, 1);
  statusRange.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MIG.STATUS_OPTIONS, true).setAllowInvalid(false).build());
  migStatusColours_(students);

  // Sessions G:J formulas, and the student dropdown in column B pointing at the new Name column
  sessions.getRange(6, 7, sessions.getMaxRows() - 5, 4).clearContent();
  sessions.getRange("G6:J6").setFormulas([reference.sessionsFormulas]);
  const dropdown = sessions.getRange("B6").getDataValidation();
  if (dropdown && dropdown.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    const args = dropdown.getCriteriaValues();
    const rule = dropdown.copy().withCriteria(SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE,
      [students.getRange("B" + MIG.FIRST_STUDENT_ROW + ":B" + formulaLastRow), args[1]]).build();
    sessions.getRange(6, 2, sessions.getMaxRows() - 5, 1).setDataValidation(rule);
  }

  SpreadsheetApp.flush();
  lines.push("DONE");
  return { found: found, layout: lines };
}

// Clients tab: point O (Maths) and P (English) formulas at the new layout's columns. Only cells that contain a
// formula are touched; typed numbers are left alone, and "+7"-style manual additions are kept as they are.
function migFixClientFormulas_(master, tutors, migratedRows, apply) {
  const clients = master.getSheetByName("Clients");
  const lastRow = clients.getLastRow();
  const range = clients.getRange(2, 1, lastRow - 1, 16);
  const values = range.getValues();
  const formulas = range.getFormulas();
  const tutorByRow = {};
  tutors.forEach((t) => { tutorByRow[t.row] = t.name; });
  const lines = [];
  const pattern = /IMPORTRANGE\((Tutors!E(\d+)|#REF!)\s*,\s*"Students![A-Z]+:[A-Z]+"\s*\)\s*,\s*(\d+)/;
  const firstName = (s) => String(s).trim().split(/\s+/)[0].toLowerCase().replace(/^jeff$/, "jianzhi");

  for (let i = 0; i < values.length; i++) {
    const rowNumber = i + 2;
    const student = String(values[i][1]).trim();
    const namedTutors = (String(values[i][12]) + "," + String(values[i][13])).split(",").map(firstName).filter(Boolean);
    [[14, "O", "Students!F:J", 5], [15, "P", "Students!F:K", 6]].forEach(([col, letter, newRange, expectedIndex]) => {
      const formula = formulas[i][col];
      if (!formula) return;
      const m = formula.match(pattern);
      if (!m) { lines.push(letter + rowNumber + " " + student + ": formula not in the expected shape, left alone: " + formula); return; }
      if (Number(m[3]) !== expectedIndex) { lines.push(letter + rowNumber + " " + student + ": unexpected column number " + m[3] + ", left alone"); return; }
      let tutorRow = m[2] ? Number(m[2]) : null;
      let updated = formula;
      if (!tutorRow) {
        // #REF!: borrow the other subject's tutor if this student has a single tutor for both
        const other = formulas[i][col === 14 ? 15 : 14].match(pattern);
        if (other && other[2] && new Set(namedTutors).size === 1) {
          tutorRow = Number(other[2]);
          updated = updated.replace("#REF!", "Tutors!E" + tutorRow);
        } else {
          lines.push(letter + rowNumber + " " + student + ": broken tutor reference (#REF!) and the tutor can't be worked out safely, left alone");
          return;
        }
      }
      if (!migratedRows.has(tutorRow)) return; // that tutor's sheet isn't in the new layout yet
      updated = updated.replace(/"Students![A-Z]+:[A-Z]+"/, '"' + newRange + '"');
      const tutorName = (tutorByRow[tutorRow] || "?").toLowerCase();
      if (namedTutors.length && namedTutors.indexOf(tutorName) === -1) {
        lines.push(letter + rowNumber + " " + student + ": note, formula reads " + tutorByRow[tutorRow] + "'s sheet but columns M/N name " + namedTutors.join(" & ") + " (not changed by this, just flagged)");
      }
      if (updated === formula) return;
      lines.push(letter + rowNumber + " " + student + ": " + formula + "  →  " + updated);
      if (apply) clients.getRange(rowNumber, col + 1).setFormula(updated);
    });
  }
  if (!lines.length) lines.push("No O/P formulas needed changing");
  return lines;
}

function migBackup_(fileId, label) {
  const folders = DriveApp.getFoldersByName(MIG.BACKUP_FOLDER);
  const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(MIG.BACKUP_FOLDER);
  const stamp = Utilities.formatDate(new Date(), "Australia/Melbourne", "yyyy-MM-dd HH:mm");
  DriveApp.getFileById(fileId).makeCopy(label + " backup " + stamp, folder);
}

// One onEdit trigger per tutor sheet, all running tutorStudentsOnEdit from this project.
function migInstallTrigger_(tutor) {
  const exists = ScriptApp.getProjectTriggers().some((t) =>
    t.getHandlerFunction() === MIG.TRIGGER_HANDLER && t.getTriggerSourceId() === tutor.id);
  if (!exists) ScriptApp.newTrigger(MIG.TRIGGER_HANDLER).forSpreadsheet(tutor.id).onEdit().create();
}

// Same behaviour as the Status script in the tutor sheets: when a student name is entered in column B
// (row 4 down), give column A the ACTIVE / PAUSED / CANCELLED dropdown and default it to ACTIVE.
function tutorStudentsOnEdit(e) {
  if (!e || !e.range) return;
  const range = e.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== "Students") return;
  if (range.getColumn() > 2 || range.getLastColumn() < 2) return;
  const startRow = Math.max(range.getRow(), MIG.FIRST_STUDENT_ROW);
  const endRow = range.getLastRow();
  if (endRow < startRow) return;
  const numRows = endRow - startRow + 1;
  const names = sheet.getRange(startRow, 2, numRows, 1).getValues();
  const statuses = sheet.getRange(startRow, 1, numRows, 1).getValues();
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(MIG.STATUS_OPTIONS, true).setAllowInvalid(false).build();
  for (let i = 0; i < numRows; i++) {
    if (String(names[i][0]).trim() === "") continue;
    const cell = sheet.getRange(startRow + i, 1);
    cell.setDataValidation(rule);
    if (statuses[i][0] === "" || statuses[i][0] === null) cell.setValue("ACTIVE");
  }
}

// Same as setupStatusColours, for any Students tab.
function migStatusColours_(sheet) {
  const numRows = Math.max(sheet.getMaxRows() - MIG.FIRST_STUDENT_ROW + 1, 1);
  const range = sheet.getRange(MIG.FIRST_STUDENT_ROW, 1, numRows, 1);
  const rules = sheet.getConditionalFormatRules().filter((r) => {
    const rs = r.getRanges();
    return !(rs.length === 1 && rs[0].getColumn() === 1 && rs[0].getNumColumns() === 1 && rs[0].getRow() === MIG.FIRST_STUDENT_ROW);
  });
  rules.push(
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("ACTIVE").setBackground("#b7e1cd").setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("PAUSED").setBackground("#fff2cc").setRanges([range]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("CANCELLED").setBackground("#f4c7c3").setRanges([range]).build()
  );
  sheet.setConditionalFormatRules(rules);
}
