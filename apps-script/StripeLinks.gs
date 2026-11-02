// Paste this into the master sheet: Extensions → Apps Script. It lets the aa-admin app add rows
// to the "Stripe Links" tab (and nothing else). Setup steps are at the bottom of this file.
//
// The app sends: { secret, familyKey, customerIds, note }
//   familyKey   = parent email from the Clients tab, or "ignore"
//   customerIds = Stripe customer ID(s), several separated by ";"

const TAB_NAME = "Stripe Links";

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: "Request wasn't valid JSON" });
  }
  if (!secret || body.secret !== secret) return reply({ ok: false, error: "Wrong secret" });

  const familyKey = String(body.familyKey || "").trim().toLowerCase();
  const customerIds = String(body.customerIds || "").trim();
  const note = String(body.note || "").trim();
  if (!familyKey) return reply({ ok: false, error: "Missing family (parent email)" });
  if (!/^(cus_[A-Za-z0-9]+|guest:\S+)(;(cus_[A-Za-z0-9]+|guest:\S+))*$/.test(customerIds)) {
    return reply({ ok: false, error: "Customer ID should look like cus_..." });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(TAB_NAME);
    if (!sheet) return reply({ ok: false, error: 'No tab called "' + TAB_NAME + '"' });
    const stamp = "Confirmed in app " + Utilities.formatDate(new Date(), "Australia/Melbourne", "d MMM yyyy");
    const rows = sheet.getDataRange().getValues();
    // A family that already has a row gets it replaced, and an ignore that already exists is skipped,
    // so pressing a button twice never adds duplicate rows.
    for (let i = 1; i < rows.length; i++) {
      const rowKey = String(rows[i][0]).trim().toLowerCase();
      if (familyKey === "ignore" && rowKey === "ignore" && String(rows[i][1]).trim() === customerIds) {
        return reply({ ok: true, updated: false });
      }
      if (familyKey !== "ignore" && rowKey === familyKey) {
        sheet.getRange(i + 1, 2, 1, 2).setValues([[customerIds, note ? note + " · " + stamp : stamp]]);
        return reply({ ok: true, updated: true });
      }
    }
    sheet.appendRow([familyKey, customerIds, note ? note + " · " + stamp : stamp]);
    return reply({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// SETUP
// 1. Open the master sheet → Extensions → Apps Script. Replace the editor's contents with this file. Save.
// 2. Project Settings (gear icon) → Script Properties → Add property: SECRET = a long random string.
// 3. Deploy → New deployment → type "Web app". Execute as: Me. Who has access: Anyone. Deploy, authorise.
// 4. Copy the Web app URL. In Vercel add APPS_SCRIPT_URL (that URL) and APPS_SCRIPT_SECRET (same SECRET), then redeploy.
// If you edit this script later: Deploy → Manage deployments → edit → Version: New version (keeps the same URL).
