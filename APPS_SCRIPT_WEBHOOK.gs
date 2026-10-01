/**
 * OPTIONAL — keep your existing Google Sheet CRM after moving the site to Vercel.
 *
 * Your code.html already has llSubscribe(json) that upserts a member into the
 * "Members CRM" sheet. To let Vercel's /api/subscribe forward signups to it:
 *
 * 1) In your Apps Script project, add this doPost() (it just calls your llSubscribe).
 * 2) Deploy > New deployment > type "Web app" > Execute as: Me,
 *    Who has access: "Anyone" > Deploy. Copy the /exec URL.
 * 3) In Vercel: Project > Settings > Environment Variables >
 *      LL_CRM_WEBHOOK = <that /exec url>
 *    (and optionally LL_EVENTS_WEBHOOK = same url if you also want events;
 *     then branch on e.parameter or the JSON "name" field).
 *
 * Now every signup captured on the Vercel site lands in your Google Sheet,
 * exactly like before — no data migration needed.
 */
function doPost(e) {
  try {
    var body = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var out = llSubscribe(body);            // reuse the function already in your project
    return ContentService
      .createTextOutput(out || JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
