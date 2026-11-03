// READ-ONLY check of every tutor sheet (from the master sheet's Tutors tab, column E) and of the
// master sheet's Clients tab O/P formulas, before moving tutor sheets to the new template.
// It changes nothing in any tutor sheet. Its only write is a "Template Check" tab in this master sheet.
//
// How to run: add this as its own file in the master sheet's Apps Script project (+ next to Files ->
// Script -> TemplateCheck), save, choose checkTutorTemplates in the function menu at the top, press Run,
// and allow access when Google asks. It takes about a minute.

const TEMPLATE_CHECK_TAB = "Template Check";

function checkTutorTemplates() {
  const master = SpreadsheetApp.getActive();
  const out = [["Sheet", "Tab", "What", "Detail"]];
  const add = (sheet, tab, what, detail) =>
    out.push([sheet, tab, what, detail === undefined ? "" : String(detail).slice(0, 45000)]);

  // --- Tutor sheets listed in the Tutors tab
  const tutorRows = master.getSheetByName("Tutors").getDataRange().getValues().slice(1);
  for (const row of tutorRows) {
    const name = String(row[1] || row[0]).trim();
    const match = String(row[4]).match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (!name || !match) continue;
    let ss;
    try {
      ss = SpreadsheetApp.openById(match[1]);
    } catch (err) {
      add(name, "", "ERROR opening sheet", err.message);
      continue;
    }
    add(name, "", "Tabs", ss.getSheets().map((s) => s.getName()).join(", "));
    add(name, "", "Named ranges", ss.getNamedRanges().map((n) => n.getName() + "=" + n.getRange().getA1Notation()).join("; ") || "none");
    templateCheckTab_(ss.getSheetByName("Students"), 3, 4, name, "Students", add);
    templateCheckTab_(ss.getSheetByName("Sessions"), 5, 6, name, "Sessions", add);
  }

  // --- Master sheet: Clients tab, columns M to P for every row (formula if there is one, otherwise the typed value)
  const clients = master.getSheetByName("Clients");
  const lastRow = clients.getLastRow();
  add("MASTER", "Clients", "Row 1 headers", JSON.stringify(clients.getRange(1, 1, 1, clients.getLastColumn()).getValues()[0]));
  const range = clients.getRange(2, 1, lastRow - 1, 16);
  const values = range.getValues();
  const formulas = range.getFormulas();
  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][1]).trim() && !String(values[i][4]).trim()) continue;
    const cell = (c) => formulas[i][c] ? "FORMULA " + formulas[i][c] : "VALUE " + JSON.stringify(values[i][c]);
    add("MASTER", "Clients", "Row " + (i + 2) + " " + String(values[i][1]).trim(),
      "M: " + JSON.stringify(values[i][12]) + " | N: " + JSON.stringify(values[i][13]) + " | O: " + cell(14) + " | P: " + cell(15));
  }
  add("MASTER", "", "This project's triggers", ScriptApp.getProjectTriggers().map((t) => t.getHandlerFunction() + "/" + t.getEventType()).join(", ") || "none");

  // --- Write the findings
  let tab = master.getSheetByName(TEMPLATE_CHECK_TAB);
  if (tab) tab.clear(); else tab = master.insertSheet(TEMPLATE_CHECK_TAB);
  tab.getRange(1, 1, out.length, 4).setValues(out);
  tab.setFrozenRows(1);
  Logger.log("Done: " + (out.length - 1) + " findings written to the \"" + TEMPLATE_CHECK_TAB + "\" tab. Nothing else was changed.");
}

function templateCheckTab_(sheet, headerRow, firstDataRow, name, tabName, add) {
  if (!sheet) { add(name, tabName, "MISSING TAB"); return; }
  const lastRow = sheet.getLastRow();
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  add(name, tabName, "Size", "last row " + lastRow + ", last column " + templateCheckCol_(lastCol) + ", frozen rows " + sheet.getFrozenRows());
  add(name, tabName, "A1 text", sheet.getRange("A1").getValue());
  add(name, tabName, "Header row " + headerRow, JSON.stringify(sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0]));
  add(name, tabName, "Formulas in row " + firstDataRow, JSON.stringify(templateCheckNonEmpty_(sheet.getRange(firstDataRow, 1, 1, lastCol).getFormulas()[0])));
  if (lastRow > firstDataRow) {
    const range = sheet.getRange(firstDataRow + 1, 1, lastRow - firstDataRow, lastCol);
    const formulas = range.getFormulas();
    const values = range.getValues();
    const formulaCount = {}, typedCount = {};
    for (let r = 0; r < formulas.length; r++) {
      for (let c = 0; c < lastCol; c++) {
        const col = templateCheckCol_(c + 1);
        if (formulas[r][c]) formulaCount[col] = (formulaCount[col] || 0) + 1;
        else if (String(values[r][c]).trim() !== "") typedCount[col] = (typedCount[col] || 0) + 1;
      }
    }
    add(name, tabName, "Rows below " + firstDataRow + ": cells with a formula, per column", JSON.stringify(formulaCount));
    add(name, tabName, "Rows below " + firstDataRow + ": cells with a typed value, per column", JSON.stringify(typedCount));
    // A sample of formulas further down, to see whether they were copied down row by row
    add(name, tabName, "Formulas in row " + (firstDataRow + 1), JSON.stringify(templateCheckNonEmpty_(formulas[0])));
  }
  // Dropdowns and other data validation in the first data row
  const rules = sheet.getRange(firstDataRow, 1, 1, lastCol).getDataValidations()[0];
  const described = {};
  rules.forEach((rule, c) => {
    if (!rule) return;
    const args = rule.getCriteriaValues().map((v) => (v && v.getA1Notation) ? v.getSheet().getName() + "!" + v.getA1Notation() : JSON.stringify(v));
    described[templateCheckCol_(c + 1)] = rule.getCriteriaType() + " " + args.join(" ");
  });
  add(name, tabName, "Data validation in row " + firstDataRow, JSON.stringify(described));
  add(name, tabName, "Conditional format rules", sheet.getConditionalFormatRules().map((r) => r.getRanges().map((x) => x.getA1Notation()).join("+")).join("; ") || "none");
  const protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE).map((p) => p.getRange().getA1Notation())
    .concat(sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET).length ? ["whole tab"] : []);
  add(name, tabName, "Protected ranges", protections.join(", ") || "none");
  add(name, tabName, "Number formats in row " + firstDataRow, JSON.stringify(templateCheckNonEmpty_(sheet.getRange(firstDataRow, 1, 1, lastCol).getNumberFormats()[0])));
}

// {A: "...", C: "..."} for the non-empty entries of a row
function templateCheckNonEmpty_(row) {
  const result = {};
  row.forEach((v, c) => { if (String(v) !== "" && String(v) !== "General") result[templateCheckCol_(c + 1)] = v; });
  return result;
}

function templateCheckCol_(n) {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
