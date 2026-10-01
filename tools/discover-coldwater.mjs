/* tools/discover-coldwater.mjs — work out which menu platform each Coldwater
 * dispensary runs and pull the id api/coldwater.js needs, then print the exact
 * config lines to paste into its STORES table.
 *
 * RUN THIS FROM A NORMAL MACHINE. The containers this repo is edited from have
 * dutchie.com, iheartjane.com, weedmaps.com and every shop domain refused at the
 * egress proxy, which is why STORES ships with no endpoints in it.
 *
 *     node tools/discover-coldwater.mjs
 *     node tools/discover-coldwater.mjs --json
 *
 * It reads each shop's own public menu page once, the way a browser would, and
 * looks for the platform's fingerprint. It writes nothing and orders nothing.
 * One request per shop, spaced, with a contact-bearing User-Agent.
 *
 * If a shop comes back `unknown`, do not guess. Open its menu in a browser with
 * devtools on the Network tab, find the XHR that returns the products, and read
 * the id out of the request. That is five minutes and it is correct; a guessed
 * id silently returns someone else's catalogue.
 */
import { STORES } from "../api/coldwater.js";

const UA = "LegalLeafMarket/1.0 (+https://legal-leafmarket.com/coldwater; price comparison; contact via site)";
const JSON_OUT = process.argv.includes("--json");
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function grab(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "user-agent": UA, accept: "text/html,*/*" } });
    return { ok: r.ok, status: r.status, url: r.url, html: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, url, html: "", err: String((e && e.message) || e) };
  } finally { clearTimeout(t); }
}

/* Fingerprints, most specific first. Each returns {platform, id, evidence}. */
const PROBES = [
  { name: "dutchie", test: h => /dutchie\.com|dutchie-plus|dtche%5B|dtche\[/i.test(h),
    id: h => {
      for (const re of [
        /"dispensaryId"\s*:\s*"([a-f0-9]{24})"/i,
        /dispensary[_-]?id["'=:\s]+([a-f0-9]{24})/i,
        /dutchie\.com\/embedded-menu\/([a-z0-9-]+)/i,
        /embedded-menu\/([a-z0-9-]+)/i,
      ]) { const m = h.match(re); if (m) return m[1]; }
      return null;
    } },
  { name: "jane", test: h => /iheartjane\.com|jane-frame|janeAppStoreId/i.test(h),
    id: h => {
      for (const re of [
        /store[_-]?id["'=:\s]+(\d{3,7})/i,
        /iheartjane\.com\/(?:embed\/)?stores\/(\d{3,7})/i,
        /jane[^"']{0,20}store[^"']{0,10}["'](\d{3,7})["']/i,
      ]) { const m = h.match(re); if (m) return m[1]; }
      return null;
    } },
  { name: "weedmaps", test: h => /weedmaps\.com\/embed|wm-embed/i.test(h), id: () => null },
  { name: "tymber",   test: h => /tymber|getpassio/i.test(h),               id: () => null },
  { name: "meadow",   test: h => /getmeadow\.com/i.test(h),                 id: () => null },
  { name: "dispense", test: h => /dispenseapp\.com/i.test(h),               id: () => null },
];

const results = [];

for (let i = 0; i < STORES.length; i++) {
  const s = STORES[i];
  if (i) await sleep(1200);

  if (!s.site) { results.push({ key: s.key, name: s.name, platform: "unknown", note: "no site url in STORES" }); continue; }

  const r = await grab(s.site);
  if (!r.ok) { results.push({ key: s.key, name: s.name, platform: "unreachable", note: r.err || ("http " + r.status) }); continue; }

  const hit = PROBES.find(p => p.test(r.html));
  if (!hit) { results.push({ key: s.key, name: s.name, platform: "unknown", note: "no fingerprint; inspect the Network tab" }); continue; }

  const id = hit.id(r.html);
  results.push({
    key: s.key, name: s.name, platform: hit.name, id,
    note: id ? "id found in page source" : "platform identified, id NOT in page source — read it off the menu XHR",
    landed: r.url !== s.site ? r.url : undefined,
  });
}

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log("\nColdwater menu discovery\n" + "=".repeat(58));
for (const r of results) {
  console.log(`\n  ${r.name}`);
  console.log(`    platform : ${r.platform}${r.id ? "" : "   <- needs the id"}`);
  if (r.id) console.log(`    id       : ${r.id}`);
  if (r.landed) console.log(`    landed   : ${r.landed}`);
  console.log(`    note     : ${r.note}`);
}

const ready = results.filter(r => r.id && (r.platform === "dutchie" || r.platform === "jane"));
console.log("\n" + "=".repeat(58));
if (!ready.length) {
  console.log("\nNothing auto-resolved. That is normal — most of these menus load their\n" +
              "products by XHR after the page renders, so the id is not in the HTML.\n" +
              "Open each menu, devtools > Network, filter XHR, find the products response,\n" +
              "and read the id out of the request URL or body.\n");
} else {
  console.log("\nPaste into STORES in api/coldwater.js, and flip enabled to true only for\n" +
              "the shops you actually want live:\n");
  for (const r of ready) {
    const idField = r.platform === "dutchie" ? `dispensaryId:"${r.id}"` : `storeId:"${r.id}"`;
    console.log(`  // ${r.name}`);
    console.log(`  platform:"${r.platform}", ${idField}, enabled:true,`);
  }
  console.log("\nThen: node --check api/coldwater.js && npm run dev, and hit");
  console.log("  http://localhost:3000/api/coldwater?debug\n");
}
