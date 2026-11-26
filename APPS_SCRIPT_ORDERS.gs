/**
 * Legal-Leaf Market order log (Google Apps Script, bound to the
 * "Legal-Leaf Market Orders" Google Sheet in jacobkennedy.47201@gmail.com).
 *
 * Every order placed at legalleafmarket.shop/shop is POSTed here as JSON by
 * api/order.js (LL_ORDER_WEBHOOK). This adds a row to the Orders tab and emails
 * a copy to NOTIFY. Payment is cash at delivery, so the sheet is also the sales
 * record: set Status to Delivered when you hand an order over and get paid, and
 * the "Sales tax" tab totals delivered sales and the 7% tax collected by month.
 *
 * Deployed as: Deploy > New deployment > Web app, Execute as: Me,
 * Who has access: Anyone. The /exec URL goes in Netlify as LL_ORDER_WEBHOOK.
 * After editing this code: Deploy > Manage deployments > edit > New version,
 * so the same /exec URL keeps working.
 *
 * It answers {ok:true} only once the row is written. api/order.js counts the
 * order as received only on that answer, because Apps Script replies 200 even
 * when the script throws.
 */
var NOTIFY = 'jacobkennedy.47201@gmail.com';
var HEADERS = ['Placed', 'Order', 'Status', 'Name', 'Phone', 'Email', 'Address', 'Items',
  'Subtotal', 'Delivery', 'Tax (7%)', 'Total', 'Payment', 'ID check', 'Channel', 'Notes'];
var STATUSES = ['New', 'Confirmed', 'Delivered', 'Cancelled'];

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var o = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (o.type !== 'order' || !o.number) return reply({ ok: false, error: 'not an order' });
    lock.waitLock(20000);
    var sheet = setup().orders;
    var c = o.customer || {};
    var a = o.address || {};
    var address = [a.line1, a.line2, a.city, (a.state || '') + ' ' + (a.zip || '')]
      .filter(function (x) { return x && String(x).trim(); }).join(', ');
    var items = (o.lines || []).map(function (l) {
      var opt = l.option && l.option !== 'Default Title' ? ' (' + l.option + ')' : '';
      return l.qty + ' x ' + l.title + opt + '  $' + money(l.total) + (l.ageRestricted ? '  [21+]' : '');
    }).join('\n');
    var channel = (o.channel || 'web') + (o.partner ? ': ' + o.partner : '');
    sheet.appendRow([new Date(o.placed || Date.now()), o.number, 'New', c.name || '',
      "'" + (c.phone || ''), c.email || '', address, items,
      Number(o.subtotal) || 0, Number(o.delivery) || 0, Number(o.tax) || 0, Number(o.total) || 0,
      'Cash at delivery', o.ageRestricted ? 'YES - 21+ items, check photo ID' : 'Check photo ID',
      channel, o.notes || '']);
    SpreadsheetApp.flush();
    lock.releaseLock();

    var body = [
      'New order ' + o.number + ' (' + channel + ')',
      '',
      (c.name || '') + '  |  ' + (c.phone || '') + '  |  ' + (c.email || ''),
      address,
      '',
      items,
      '',
      'Subtotal  $' + money(o.subtotal),
      'Delivery  $' + money(o.delivery),
      'Tax (7%)  $' + money(o.tax),
      'Total     $' + money(o.total) + '   CASH at delivery',
      o.notes ? '\nNotes: ' + o.notes : '',
      '',
      o.ageRestricted ? 'Has 21+ items: check a valid photo ID before handing over.' : 'Check a valid photo ID (21+) at the door.',
      '',
      'Order sheet: ' + SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    ].join('\n');
    try {
      MailApp.sendEmail({ to: NOTIFY, replyTo: c.email || NOTIFY,
        subject: 'New order ' + o.number + ': $' + money(o.total) + ' cash', body: body });
    } catch (mailErr) {
      // The row is written, which is what counts. A failed email is not a lost order.
    }
    return reply({ ok: true, number: o.number });
  } catch (err) {
    try { lock.releaseLock(); } catch (x) {}
    return reply({ ok: false, error: String(err) });
  }
}

/* Opening the /exec URL in a browser runs this: it builds the tabs if they are
   missing and says the log is up. It never shows order data. */
function doGet() {
  setup();
  return reply({ ok: true, service: 'Legal-Leaf Market order log' });
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var orders = ss.getSheetByName('Orders');
  if (!orders) {
    var first = ss.getSheets()[0];
    orders = first.getLastRow() === 0 ? first.setName('Orders') : ss.insertSheet('Orders', 0);
  }
  if (orders.getLastRow() === 0) {
    orders.appendRow(HEADERS);
    orders.setFrozenRows(1);
    orders.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#2C4A33').setFontColor('#ffffff');
    orders.getRange('A2:A').setNumberFormat('yyyy-mm-dd h:mm am/pm');
    orders.getRange('I2:L').setNumberFormat('$#,##0.00');
    orders.getRange('H2:H').setWrap(true);
    orders.getRange('C2:C').setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
    orders.setColumnWidth(7, 260);
    orders.setColumnWidth(8, 320);
  }
  var tax = ss.getSheetByName('Sales tax');
  if (!tax) {
    tax = ss.insertSheet('Sales tax');
    tax.getRange('A1').setValue('Delivered orders only (set Status to Delivered once paid). Indiana sales tax is 7%.');
    tax.getRange('A3').setFormula(
      '=IFERROR(QUERY(Orders!A2:L, "select year(A), month(A)+1, count(B), sum(I), sum(J), sum(K), sum(L) ' +
      'where C = \'Delivered\' group by year(A), month(A)+1 order by year(A), month(A)+1 ' +
      'label year(A) \'Year\', month(A)+1 \'Month\', count(B) \'Orders\', sum(I) \'Sales\', ' +
      'sum(J) \'Delivery fees\', sum(K) \'Tax collected\', sum(L) \'Cash taken\'", 0), "No delivered orders yet")');
    tax.getRange('D4:G').setNumberFormat('$#,##0.00');
    tax.setColumnWidth(1, 90);
  }
  return { orders: orders, tax: tax };
}

function money(n) { return (Number(n) || 0).toFixed(2); }

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
