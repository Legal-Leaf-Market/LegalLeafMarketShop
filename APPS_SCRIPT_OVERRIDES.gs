/**
 * ============================================================================
 * SHARED ADMIN OVERRIDES via Google Apps Script  (Option B)
 * ============================================================================
 *
 * Lets the Legal-Leaf admin console publish category / image / price overrides so EVERY
 * visitor sees them, using the Apps Script + Google Sheet you already run instead of
 * adding a Redis service.
 *
 * Vercel's /api/overrides talks to this script:
 *   READ   GET  <exec-url>?fn=getOverrides
 *          -> { version, updated, cat:{...}, fields:{...} }
 *   WRITE  POST <exec-url>   body: { fn:"setOverrides", token:"...", batch:{...} }
 *          -> { ok:true, cat:N, fields:N }
 *
 * The JSON is stored in a hidden tab of your spreadsheet, split across rows so it can grow
 * past a single cell's 50,000-character limit. You can open that tab any time to see or
 * hand-fix exactly what is published.
 *
 * ----------------------------------------------------------------------------
 * WHICH SPREADSHEET? A BRAND NEW, EMPTY ONE. (Recommended.)
 * ----------------------------------------------------------------------------
 * This does NOT need your CRM sheet or any existing data. It only needs somewhere to park
 * one small JSON blob. Creating a fresh spreadsheet is the recommended path because it
 * gives you a fresh Apps Script project too, which means NO chance of colliding with the
 * doPost that APPS_SCRIPT_WEBHOOK.gs may already have defined for llSubscribe — that
 * collision is the single most likely way this setup goes wrong.
 *
 * Go to https://sheets.new , call it something like "Legal-Leaf Admin Overrides", and
 * that is the spreadsheet. Nothing needs to be in it; the script creates its own tab.
 *
 * (Reusing the CRM spreadsheet also works and keeps everything in one place. If you do,
 * read step 4 carefully.)
 *
 * ----------------------------------------------------------------------------
 * SETUP — six steps, roughly five minutes
 * ----------------------------------------------------------------------------
 *
 * 1. Create the spreadsheet (above), then open its script editor:
 *      Extensions > Apps Script.
 *    Opening it this way BINDS the script to that sheet, which is what lets
 *    SpreadsheetApp.getActiveSpreadsheet() work and why LL_SHEET_ID can stay empty.
 *
 * 2. Delete the empty `function myFunction() {}` it starts you with, and paste this whole
 *    file in. (If you are reusing an existing project instead: File > New > Script, name
 *    it `overrides`, and paste it there.)
 *
 * 3. Set LL_SHARED_SECRET below to a long random string. Keep it handy — the SAME value
 *    goes into Vercel as LL_ADMIN_TOKEN in step 6. Anything works; longer is better.
 *
 *      Only if the script is NOT bound to a spreadsheet (you opened script.google.com
 *      directly rather than Extensions > Apps Script): set LL_SHEET_ID to the long string
 *      in the sheet's URL between /d/ and /edit. On the recommended path, leave it ''.
 *
 * 4. ONLY IF YOU REUSED AN EXISTING PROJECT: check for a doPost collision.
 *    Apps Script allows only ONE doPost across the whole project. If APPS_SCRIPT_WEBHOOK.gs
 *    already gave you one for llSubscribe, you will get "doPost is already defined" and
 *    NEITHER will work. Fix: delete the doPost at the bottom of this file, and add two lines
 *    to your existing doPost so it routes override calls here. See ROUTING at the bottom.
 *    On a brand new spreadsheet there is no existing doPost, so skip this entirely.
 *
 * 5. Deploy > New deployment > gear icon > Web app
 *      Description:      overrides
 *      Execute as:       Me
 *      Who has access:   Anyone            <-- required; Vercel is anonymous to Google
 *    Deploy, approve the permissions prompt, then COPY THE /exec URL.
 *
 *    Re-deploying later: Deploy > Manage deployments > pencil > Version: New version.
 *    Editing the code alone does NOT update the live Web App.
 *
 * 6. In Vercel > your project > Settings > Environment Variables, add BOTH:
 *      LL_OVERRIDES_WEBHOOK = the /exec url from step 5
 *      LL_ADMIN_TOKEN       = the same string as LL_SHARED_SECRET
 *    Then REDEPLOY. Environment variables only take effect on a new deployment.
 *
 * Verify: open https://legal-leafmarket.com/api/overrides in a browser. You want
 *   "storage": "webhook"   and   "writes": "enabled"
 * If it still says NOT CONFIGURED, the redeploy in step 6 has not happened yet.
 *
 * ----------------------------------------------------------------------------
 * SECURITY
 * ----------------------------------------------------------------------------
 * "Who has access: Anyone" means anyone who learns the /exec url can POST to it. That is
 * why writes are checked against LL_SHARED_SECRET here as well as at the Vercel route --
 * two independent gates. Reads are deliberately open: the override data is public, every
 * visitor to the site fetches it.
 *
 * Do NOT reuse the admin console PIN (5824) as the secret. That PIN is visible in the
 * site's page source and is only a speed bump.
 */

/** A long random string. MUST match Vercel's LL_ADMIN_TOKEN. */
var LL_SHARED_SECRET = 'CHANGE-ME-to-a-long-random-string';

/** Only needed if this script is NOT bound to your spreadsheet. Else leave ''. */
var LL_SHEET_ID = '';

/** Hidden tab that holds the JSON. Created automatically. */
var LL_OV_TAB = 'LL_Overrides';

/** Chars per row. Well under the 50,000-per-cell limit, so long payloads just use more rows. */
var LL_OV_CHUNK = 40000;

/* -------------------------------------------------------------------------- */

function llOvSheet_() {
  var ss = LL_SHEET_ID
    ? SpreadsheetApp.openById(LL_SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No spreadsheet. Set LL_SHEET_ID, or open the script via Extensions > Apps Script.');
  }
  var sh = ss.getSheetByName(LL_OV_TAB);
  if (!sh) {
    sh = ss.insertSheet(LL_OV_TAB);
    sh.getRange(1, 1).setValue('{}');
    try { sh.hideSheet(); } catch (e) {}   // harmless if it is the only sheet
  }
  return sh;
}

function llOvRead_() {
  var sh = llOvSheet_();
  var last = sh.getLastRow();
  if (last < 1) return '{}';
  var vals = sh.getRange(1, 1, last, 1).getValues();
  var s = '';
  for (var i = 0; i < vals.length; i++) s += String(vals[i][0] || '');
  return s || '{}';
}

function llOvWrite_(str) {
  var sh = llOvSheet_();
  sh.clearContents();
  var rows = [];
  for (var i = 0; i < str.length; i += LL_OV_CHUNK) rows.push([str.substring(i, i + LL_OV_CHUNK)]);
  if (!rows.length) rows = [['{}']];
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
}

function llJson_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** Read the published overrides. Public by design. */
function llGetOverrides() {
  try {
    var raw = llOvRead_();
    var b = JSON.parse(raw || '{}');
    return {
      version: 1,
      updated: b.updated || 0,
      cat: b.cat || {},
      fields: b.fields || {}
    };
  } catch (e) {
    return { version: 1, updated: 0, cat: {}, fields: {}, error: String(e) };
  }
}

/** Save the published overrides. Requires the shared secret. */
function llSetOverrides(payload) {
  try {
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'no payload' };
    if (String(payload.token || '') !== String(LL_SHARED_SECRET)) {
      return { ok: false, error: 'bad shared secret' };
    }
    if (LL_SHARED_SECRET === 'CHANGE-ME-to-a-long-random-string') {
      return { ok: false, error: 'LL_SHARED_SECRET is still the placeholder — set it (step 3)' };
    }
    var batch = payload.batch || {};
    var clean = {
      version: 1,
      updated: Date.now(),
      cat: (batch.cat && typeof batch.cat === 'object') ? batch.cat : {},
      fields: (batch.fields && typeof batch.fields === 'object') ? batch.fields : {}
    };
    // Serialize writes: two admins publishing at once could otherwise interleave rows and
    // leave a half-written JSON blob that fails to parse for every visitor.
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try { llOvWrite_(JSON.stringify(clean)); } finally { lock.releaseLock(); }
    return {
      ok: true,
      cat: Object.keys(clean.cat).length,
      fields: Object.keys(clean.fields).length,
      updated: clean.updated
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Router used by BOTH entry points, so the logic lives in one place.
 * Returns null when the request is not for the overrides feature, which lets an existing
 * doPost fall through to its own handling (see ROUTING below).
 */
function llOverridesRoute(e) {
  var fn = '';
  var payload = null;
  if (e && e.parameter && e.parameter.fn) fn = String(e.parameter.fn);
  if (e && e.postData && e.postData.contents) {
    try {
      payload = JSON.parse(e.postData.contents);
      if (payload && payload.fn) fn = String(payload.fn);
    } catch (err) { /* not our JSON */ }
  }
  if (fn === 'getOverrides') return llGetOverrides();
  if (fn === 'setOverrides') return llSetOverrides(payload);
  return null;
}

/* ============================ ENTRY POINTS ============================ */

function doGet(e) {
  var out = llOverridesRoute(e);
  if (out) return llJson_(out);
  // Not an overrides call. Keep this harmless so a browser visit shows something sane.
  return llJson_({ ok: true, hint: 'append ?fn=getOverrides' });
}

/**
 * DELETE THIS FUNCTION if your project already defines doPost (e.g. from
 * APPS_SCRIPT_WEBHOOK.gs). Apps Script permits only one, and a duplicate breaks BOTH.
 */
function doPost(e) {
  var out = llOverridesRoute(e);
  if (out) return llJson_(out);
  return llJson_({ ok: false, error: 'unknown fn' });
}

/* ============================== ROUTING ==============================
 *
 * If you ALREADY have a doPost for llSubscribe, delete the doPost above and add the two
 * marked lines to your existing one. Overrides get handled first; everything else behaves
 * exactly as it does today.
 *
 *   function doPost(e) {
 *     var ov = llOverridesRoute(e);                 // <-- add
 *     if (ov) return llJson_(ov);                   // <-- add
 *     try {
 *       var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
 *       var out = llSubscribe(body);
 *       return ContentService.createTextOutput(out || JSON.stringify({ ok: true }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     } catch (err) {
 *       return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
 *         .setMimeType(ContentService.MimeType.JSON);
 *     }
 *   }
 *
 * Same for doGet if you already have one.
 *
 * ============================ TEST IT HERE ============================
 *
 * Run llSelfTest from the Apps Script editor (select it, press Run) to confirm the tab,
 * the secret and the round-trip all work — before involving Vercel at all. Check
 * View > Logs for the result.
 */
function llSelfTest() {
  var log = [];
  try {
    log.push('sheet tab: ' + llOvSheet_().getName());
    var before = llGetOverrides();
    log.push('current: ' + Object.keys(before.cat).length + ' cat, ' + Object.keys(before.fields).length + ' fields');

    var bad = llSetOverrides({ token: 'definitely-wrong', batch: { cat: {} } });
    log.push('wrong secret rejected: ' + (bad.ok === false) + ' (' + bad.error + ')');

    var probe = { cat: { '__selftest__': { cat: 'Edibles', name: 'self test' } }, fields: {} };
    var w = llSetOverrides({ token: LL_SHARED_SECRET, batch: probe });
    log.push('write with real secret: ok=' + w.ok + ' error=' + (w.error || '-'));

    var rd = llGetOverrides();
    log.push('read back: ' + (rd.cat && rd.cat.__selftest__ ? 'FOUND probe' : 'PROBE MISSING'));

    // restore whatever was there before, so the self-test leaves no trace
    llSetOverrides({ token: LL_SHARED_SECRET, batch: { cat: before.cat, fields: before.fields } });
    log.push('restored original: ' + Object.keys(llGetOverrides().cat).length + ' cat');
    log.push('RESULT: ' + (w.ok && rd.cat.__selftest__ ? 'PASS' : 'FAIL'));
  } catch (e) {
    log.push('THREW: ' + e);
  }
  Logger.log(log.join('\n'));
  return log.join('\n');
}
