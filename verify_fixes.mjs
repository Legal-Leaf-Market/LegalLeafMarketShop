// Boot-verification per CLAUDE.md 5a: load the real pages in a real browser.
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:3000';
const results = [];
const ok = (name, cond, extra='') => { results.push(`${cond?'PASS':'FAIL'}  ${name}${extra?'  ('+extra+')':''}`); if(!cond) process.exitCode = 1; };

// Fixture: 150 fake products for the satellite pages (api/products may not be
// reachable from this sandbox; the shape mirrors api/products.js output).
const fixture = { products: Array.from({length:150}, (_,i)=>({
  id:'fx'+i, name:'Fixture Product '+i, store: i%3? 'Store A':'Store B', storeKey:'sa',
  domain:'store-a.example.com', platform:'shopify', category: i%4? 'Concentrate':'Vape',
  group:'cons', sale: 10+i%20, startsAt: 15+i%20, ship: 8.99,
  image: i===5 ? 'https://127.0.0.1:1/broken.png' : (i%7===0 ? '' : 'data:image/gif;base64,R0lGODlhAQABAAAAACw='),
  sizes: [['7 Grams', 10+i%20, 7, null, i%11!==0]], inStock: i%11!==0,
  coupon:'JACOBKENNEDY', url:'https://store-a.example.com/products/x'+i, cur:'USD'
}))};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: '+e.message));
page.on('console', m => { if (m.type()==='error') errors.push('console: '+m.text()); });

// ---------- homepage ----------
await page.goto(BASE+'/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(2500);
ok('index: engine booted (LL_admin object)', await page.evaluate(() => typeof window.LL_admin === 'object'));
ok('index: deal cards rendered', await page.evaluate(() => document.querySelectorAll('.card,.scard,[class*=card]').length > 5));
const foot = await page.evaluate(() => (document.querySelector('footer')||{}).innerText || '');
ok('index: footer has affiliate disclosure', /Affiliate disclosure/i.test(foot));
ok('index: footer links sisters', /Herbal Leaf Market/.test(foot) && /Nicotia Market/.test(foot));
ok('index: no mojibake U+FFFD', await page.evaluate(() => !document.body.innerHTML.includes('�')));

// checkout-gate skip flow: add first product, open cart, click checkout -> modal -> skip
const addClicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Add to Legal-Leaf Cart/.test(x.textContent) && !x.disabled);
  if (!b) return false; b.click(); return true;
});
ok('index: add-to-cart clicked', addClicked);
await page.waitForTimeout(400);
ok('index: cart has item', await page.evaluate(() => JSON.parse(localStorage.getItem('ll_cart')||'[]').length === 1));
await page.evaluate(() => { const c=[...document.querySelectorAll('button')].find(x=>/Cart/.test(x.textContent)); c && c.click(); });
await page.waitForTimeout(400);
const gateOpened = await page.evaluate(() => {
  const go = document.querySelector('a.checkout[href]'); if (!go) return 'no-checkout-link';
  go.click();
  const m = document.getElementById('authModal');
  return m && m.classList.contains('open') ? 'modal-open' : 'no-modal';
});
ok('index: checkout intercepted by auth modal', gateOpened === 'modal-open', gateOpened);
const skipVisible = await page.evaluate(() => {
  const r = document.getElementById('authSkipRow');
  return !!r && r.style.display !== 'none' && !!document.getElementById('authSkip');
});
ok('index: skip link visible in checkout context', skipVisible);
// clicking skip re-fires the checkout link -> expect a popup (new tab)
const popupP = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
await page.evaluate(() => document.getElementById('authSkip').click());
const popup = await popupP;
ok('index: skip proceeds to store checkout (popup opened)', !!popup, popup ? await popup.url().slice(0,60) : 'none');
if (popup) await popup.close();
ok('index: skip persisted for session', await page.evaluate(() => sessionStorage.getItem('ll_gate_skip') === '1'));
ok('index: modal closed after skip', await page.evaluate(() => !document.getElementById('authModal').classList.contains('open')));
// watchlist path must still gate: bell click while logged out should NOT be affected by skip (bells aren't gated) — instead verify login button still opens modal
await page.evaluate(() => { const lb=document.getElementById('loginBtn'); lb && lb.click(); });
await page.waitForTimeout(200);
ok('index: login modal still available (skip only affects gate)', await page.evaluate(() => document.getElementById('authModal').classList.contains('open')));
await page.evaluate(() => document.getElementById('authX').click());

// ---------- satellite page with fixture ----------
const page2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page2.on('pageerror', e => errors.push('sat pageerror: '+e.message));
page2.on('console', m => { if (m.type()==='error' && !/broken\.png|ERR_/.test(m.text())) errors.push('sat console: '+m.text()); });
await page2.route('**/api/products*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
await page2.goto(BASE+'/consumables', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page2.waitForTimeout(2000);

const satState = await page2.evaluate(() => ({
  cards: document.querySelectorAll('.scard').length,
  sentinel: !!document.querySelector('.rsentinel'),
  count: (document.getElementById('ggCount')||{}).textContent || '',
  footer: (document.querySelector('footer.llfoot')||{}).innerText || ''
}));
ok('sat: progressive render capped first paint', satState.cards > 0 && satState.cards <= 96, `cards=${satState.cards}`);
ok('sat: sentinel present', satState.sentinel);
ok('sat: count reflects FULL set', /1[0-9]{2}/.test(satState.count), satState.count.trim());
ok('sat: footer present w/ disclosure', /Affiliate disclosure/.test(satState.footer));
ok('sat: footer links sisters', /Herbal Leaf Market/.test(satState.footer) && /Nicotia Market/.test(satState.footer));

// scroll to load more chunks
await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page2.waitForTimeout(900);
await page2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page2.waitForTimeout(900);
const after = await page2.evaluate(() => document.querySelectorAll('.scard').length);
ok('sat: more cards mounted on scroll', after > satState.cards, `now=${after}`);

// image fallback: the broken-src card swaps to .sph placeholder
await page2.waitForTimeout(1500);
const phState = await page2.evaluate(() => {
  const phs = document.querySelectorAll('.spic .sph').length;
  const broken = [...document.images].filter(i => i.complete && i.naturalWidth===0 && i.src.includes('broken')).length;
  return { phs, broken };
});
ok('sat: no-image + broken-image cards show styled placeholder', phState.phs >= 1, `sph=${phState.phs} brokenLeft=${phState.broken}`);

// filter interaction still works with progressive renderer
await page2.evaluate(() => { const s=document.getElementById('fCat'); if(s&&s.options.length>1){ s.value=s.options[1].value; s.dispatchEvent(new Event('change')); } });
await page2.waitForTimeout(500);
ok('sat: filter re-render works', await page2.evaluate(() => document.querySelectorAll('.scard').length > 0));

// ---------- other satellites + greekglass: boot & footer ----------
for (const p of ['/devices', '/international', '/greekglass']) {
  const pg = await browser.newPage();
  pg.on('pageerror', e => errors.push(p+' pageerror: '+e.message));
  if (p !== '/greekglass') await pg.route('**/api/products*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
  await pg.goto(BASE+p, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pg.waitForTimeout(1500);
  ok(`${p}: footer present`, await pg.evaluate(() => /Affiliate disclosure/.test((document.querySelector('footer.llfoot')||{}).innerText || '')));
  await pg.close();
}

ok('no unexpected page errors', errors.length === 0, errors.slice(0,4).join(' | '));
console.log('\n===== VERIFICATION =====');
for (const r of results) console.log(r);
await browser.close();
