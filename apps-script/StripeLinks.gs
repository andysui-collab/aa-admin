// Add this as its own file in the master sheet's Apps Script project (Extensions -> Apps Script -> + -> Script,
// name it StripeLinks); it sits alongside existing files like Code.gs without changing them. It lets the aa-admin app add rows
// to the "Stripe Links" tab (and nothing else). Setup steps are at the bottom of this file.
//
// The app sends: { secret, familyKey, customerIds, note }
//   familyKey   = parent email from the Clients tab, or "ignore"
//   customerIds = Stripe customer ID(s), several separated by ";"

const STRIPE_LINKS_TAB = "Stripe Links";

function doPost(e) {
  const secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return stripeLinksReply_({ ok: false, error: "Request wasn't valid JSON" });
  }
  if (!secret || body.secret !== secret) return stripeLinksReply_({ ok: false, error: "Wrong secret" });

  const familyKey = String(body.familyKey || "").trim().toLowerCase();
  const customerIds = String(body.customerIds || "").trim();
  const note = String(body.note || "").trim();
  if (!familyKey) return stripeLinksReply_({ ok: false, error: "Missing family (parent email)" });
  if (!/^(cus_[A-Za-z0-9]+|guest:\S+)(;(cus_[A-Za-z0-9]+|guest:\S+))*$/.test(customerIds)) {
    return stripeLinksReply_({ ok: false, error: "Customer ID should look like cus_..." });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActive().getSheetByName(STRIPE_LINKS_TAB);
    if (!sheet) return stripeLinksReply_({ ok: false, error: 'No tab called "' + STRIPE_LINKS_TAB + '"' });
    const stamp = "Confirmed in app " + Utilities.formatDate(new Date(), "Australia/Melbourne", "d MMM yyyy");
    const rows = sheet.getDataRange().getValues();
    // A family that already has a row gets it replaced, and an ignore that already exists is skipped,
    // so pressing a button twice never adds duplicate rows.
    for (let i = 1; i < rows.length; i++) {
      const rowKey = String(rows[i][0]).trim().toLowerCase();
      if (familyKey === "ignore" && rowKey === "ignore" && String(rows[i][1]).trim() === customerIds) {
        return stripeLinksReply_({ ok: true, updated: false });
      }
      if (familyKey !== "ignore" && rowKey === familyKey) {
        sheet.getRange(i + 1, 2, 1, 2).setValues([[customerIds, note ? note + " - " + stamp : stamp]]);
        return stripeLinksReply_({ ok: true, updated: true });
      }
    }
    sheet.appendRow([familyKey, customerIds, note ? note + " - " + stamp : stamp]);
    return stripeLinksReply_({ ok: true, updated: false });
  } finally {
    lock.releaseLock();
  }
}

function stripeLinksReply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// SETUP
// 1. Open the master sheet -> Extensions -> Apps Script -> + next to Files -> Script -> name it StripeLinks.
//    Paste this file in and save. (Only one doPost may exist per project: if another file has one, combine them.)
// 2. Project Settings (gear icon) -> Script Properties -> Add property: SECRET = a long random string.
// 3. Deploy -> New deployment -> type "Web app". Execute as: Me. Who has access: Anyone. Deploy, authorise.
// 4. Copy the Web app URL. In Vercel add APPS_SCRIPT_URL (that URL) and APPS_SCRIPT_SECRET (same SECRET), then redeploy.
// If you edit this script later: Deploy -> Manage deployments -> edit -> Version: New version (keeps the same URL).
