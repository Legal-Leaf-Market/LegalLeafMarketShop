/**
 * APPS_SCRIPT_ANALYTICS.gs
 * ---------------------------------------------------------------------------
 * The owned copy of the analytics data. Optional, and independent of GA4.
 *
 * Deploy this as a Web App and put its /exec URL in the ANALYTICS_WEBHOOK env
 * var on all four Vercel projects. Every batch that /api/track receives then
 * gets appended to a Google Sheet you own outright: no sampling, no reporting
 * window, no retention policy, no vendor who can change the rules. Point
 * Looker Studio at the sheet (it connects to Sheets natively and free) and you
 * have dashboards without paying anyone.
 *
 * This is the answer to "what if Google turns GA4 off, or the account goes
 * sideways". GA4 is the good dashboard; this is the copy that cannot be taken
 * away. Running both costs nothing extra because /api/track already fans out.
 *
 * SETUP
 *   1. sheets.new, then Extensions > Apps Script, and paste this in.
 *   2. Set TOKEN below to any long random string.
 *   3. Deploy > New deployment > Web app.
 *        Execute as:        Me
 *        Who has access:    Anyone
 *      "Anyone" is required because Vercel's function calls it unauthenticated.
 *      TOKEN is what actually guards it, which is why an empty TOKEN refuses
 *      to accept anything rather than defaulting to open.
 *   4. Copy the /exec URL. In each Vercel project set:
 *        ANALYTICS_WEBHOOK = https://script.google.com/macros/s/AKfy.../exec?t=TOKEN
 *
 * Re-deploying after an edit needs Deploy > Manage deployments > edit > New
 * version, or the /exec URL keeps serving the old code. This catches everyone
 * at least once.
 */

var TOKEN = '';                  // set this before deploying
var SHEET = 'Events';
var MAX_ROWS = 400000;           // a Sheet caps at 10M cells; 22 columns fits well inside

var COLUMNS = [
  'at', 'site', 'event', 'path', 'visitor', 'session',
  'store', 'product', 'price', 'query', 'value',
  'country', 'region', 'city', 'device', 'referrer_host',
  'utm_source', 'utm_medium', 'utm_campaign', 'ga_ok', 'ua', 'raw'
];

function doPost(e) {
  if (!TOKEN) return json({ ok: false, error: 'token not configured' });
  if (!e || !e.parameter || e.parameter.t !== TOKEN) return json({ ok: false, error: 'unauthorized' });

  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ ok: false, error: 'bad json' }); }

  var events = body.events || [];
  if (!events.length) return json({ ok: true, rows: 0 });

  /* Two Vercel functions can land in the same millisecond and both read the
     same last-row index, which silently overwrites one batch with the other.
     The lock is the whole reason this is not a three-line script. */
  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (err) { return json({ ok: false, error: 'busy' }); }

  try {
    var sh = sheet();
    var rows = events.map(function (ev) { return row(body, ev); });
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, COLUMNS.length).setValues(rows);
    trim(sh);
    return json({ ok: true, rows: rows.length });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/**
 * A small read API, so a dashboard or a cron can pull numbers without opening
 * the sheet. /exec?t=TOKEN&days=7
 */
function doGet(e) {
  if (!TOKEN || !e || !e.parameter || e.parameter.t !== TOKEN) return json({ ok: false, error: 'unauthorized' });
  return json(summary(Number(e.parameter.days || 7)));
}

function row(body, ev) {
  var p = ev.props || {};
  return [
    new Date(ev.ts || Date.now()),
    body.site || p.site || '',
    ev.name || '',
    p.path || '',
    body.visitor || p.visitor_id || '',
    body.session || p.session_id || '',
    p.store || '',
    p.product || '',
    p.price || '',
    p.query || p.search_term || '',
    p.value || p.cart_value || p.seconds || p.percent || '',
    body.country || '',
    body.region || '',
    body.city || '',
    p.device || '',
    p.referrer_host || '',
    p.utm_source || '',
    p.utm_medium || '',
    p.utm_campaign || '',
    body.ga_ok === false ? 'blocked' : body.ga_ok === true ? 'ok' : '',
    (body.ua || '').slice(0, 180),
    /* Everything the columns above did not capture. Columns are for pivoting;
       this is so a question nobody thought of in advance is still answerable
       six months later. */
    JSON.stringify(p).slice(0, 2000)
  ];
}

function sheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET);
  if (!sh) {
    sh = ss.insertSheet(SHEET);
    sh.appendRow(COLUMNS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sh;
}

/* Oldest rows go first. A sheet that hits the cell limit stops accepting
   writes entirely, which would lose new data to protect old data: exactly
   backwards for analytics. */
function trim(sh) {
  var over = sh.getLastRow() - MAX_ROWS;
  if (over > 0) sh.deleteRows(2, over);
}

/**
 * Rollup for the last N days. Runs over the sheet in one read because
 * getValues() per row is the classic way to make an Apps Script time out.
 */
function summary(days) {
  var sh = sheet();
  var last = sh.getLastRow();
  if (last < 2) return { ok: true, days: days, events: 0 };

  var since = new Date(Date.now() - days * 864e5);
  var data = sh.getRange(2, 1, last - 1, COLUMNS.length).getValues();

  var out = {
    ok: true, days: days, events: 0,
    sessions: {}, visitors: {},
    bySite: {}, byEvent: {}, byStore: {}, byPath: {}, bySource: {},
    blocked: 0
  };

  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    if (!(r[0] instanceof Date) || r[0] < since) continue;
    out.events++;
    if (r[5]) out.sessions[r[5]] = 1;
    if (r[4]) out.visitors[r[4]] = 1;
    if (r[19] === 'blocked') out.blocked++;
    bump(out.bySite, r[1]);
    bump(out.byEvent, r[2]);
    bump(out.byPath, r[3]);
    if (r[2] === 'affiliate_click') bump(out.byStore, r[6]);
    bump(out.bySource, r[16] || r[15] || 'direct');
  }

  out.sessions = Object.keys(out.sessions).length;
  out.visitors = Object.keys(out.visitors).length;
  out.byPath = top(out.byPath, 25);
  out.bySource = top(out.bySource, 15);
  return out;
}

function bump(o, k) { if (k !== '' && k != null) o[k] = (o[k] || 0) + 1; }

function top(o, n) {
  return Object.keys(o).sort(function (a, b) { return o[b] - o[a]; })
    .slice(0, n).reduce(function (acc, k) { acc[k] = o[k]; return acc; }, {});
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
