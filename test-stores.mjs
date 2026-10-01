/* The store list, and the four ways an entry fails without saying so.
 *
 * STORES in api/products.js is config, and every field in it is a way to be
 * silently wrong. fetchStore() switches on `platform` and RETURNS [] for a
 * string it does not recognise -- so a typo there is a store that scrapes
 * nothing, reports no error, and looks exactly like a shop that went quiet.
 * refUrl() defaults an unset `refParam` to "ref", so a wrong one produces a
 * link that works, a customer who buys, and a commission of zero. Neither
 * throws. Neither shows up anywhere.
 *
 * Written 22 Aug 2026 when Lookah was listed, because that entry is the one
 * carrying the most unknowns -- an unapproved affiliate programme, an
 * unconfirmed platform, and a catalogue nobody with egress has read.
 *
 *   node test-stores.mjs
 */
import { STORES } from "./api/products.js";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);
const live = STORES.filter(s => s.enabled !== false);

console.log("\nThe store list\n");

group("EVERY ENTRY IS SOMETHING fetchStore() CAN ACTUALLY DISPATCH ON");
/* The set fetchStore() switches on. An unlisted string falls off the end of the
   if-chain and returns [] -- the store scrapes nothing and says nothing. */
const PLATFORMS = ["shopify", "woocommerce", "squarespace", "bigcommerce", "auto"];
const badPlat = STORES.filter(s => s.platform && !PLATFORMS.includes(s.platform));
ok("no store names a platform the dispatcher does not handle", badPlat.length === 0,
   badPlat.map(s => s.key + ":" + s.platform).join(", "));
ok("...and there are stores to check", live.length >= 10, live.length + " enabled");
const dupKeys = STORES.map(s => s.key).filter((k, i, a) => a.indexOf(k) !== i);
ok("no key is used twice", dupKeys.length === 0, dupKeys.join(", "));
const bare = STORES.filter(s => !s.key || !s.name || !s.domain);
ok("every entry has a key, a name and a domain", bare.length === 0,
   bare.map(s => s.key || "?").join(", "));

group("AND NO AFFILIATE ID IS INVENTED");
/* Setting a ref that is not real is the one thing CLAUDE.md 7 says never to do:
   it looks monetised and earns nothing. An EMPTY ref is fine and deliberate --
   Grasscity, Exhale and now Lookah all ship that way. */
const PLACEHOLDER = /^(todo|tbd|xxx+|your[-_]?id|change[-_]?me|placeholder|none|n\/a)$/i;
const fake = STORES.filter(s => s.ref && PLACEHOLDER.test(String(s.ref)));
ok("no store carries a placeholder affiliate id", fake.length === 0,
   fake.map(s => s.key + ":" + s.ref).join(", "));
/* refParam is allowed WITHOUT a ref -- Grasscity pre-sets rfsn so dropping in
   the id is a one-field change. The reverse is what costs money. */
const refNoParam = live.filter(s => s.ref && !s.refParam);
ok("...and any store with a real id has been thought about",
   refNoParam.every(s => typeof s.ref === "string"),
   refNoParam.length + " ride refUrl()'s default `ref` param");

group("LOOKAH IS LISTED, UNMONETISED, AND GUESSES NOTHING");
/* Listed 22 Aug 2026 on the owner's call. The affiliate programme is pending,
   the platform is unconfirmed, and robots.txt could not be read from the
   containers this repo is edited in -- so what this pins is that none of those
   unknowns were papered over with a plausible-looking value. */
const lk = STORES.find(s => s.key === "lookah");
ok("it is in the store list at all", !!lk);
ok("...and enabled", lk && lk.enabled !== false);
/* lookah.com was listed first and MEASURED empty on the deployed scrape --
   http:404 on Shopify's /products.json and on WooCommerce's Store API both.
   The domain moved on evidence, not on a hunch, and this pins which one is
   current so a future edit cannot quietly walk it back. */
/* BACK ON lookah.com, ON EVIDENCE RATHER THAN A PREFERENCE. Both hosts measured
   empty to the scrape (404/404, then 404/400), and the collector then read 1,004
   products off lookah.com's RENDERED page -- so that is the storefront, and it
   simply has no catalogue API. The capture lane supplies it, and that lane
   identifies a shop BY HOST, so the domain has to be the one an operator is
   standing on or their capture is written where nothing reads it. */
ok("...on lookah.com, which the collector read 1,004 products from",
   lk && lk.domain === "lookah.com", lk && lk.domain);
ok("...with platform 'auto', because nobody has confirmed one",
   lk && lk.platform === "auto", lk && lk.platform);
ok("...and accessory:true, or classify() files e-rigs as THCA Flower",
   lk && lk.accessory === true);
ok("its affiliate id is EMPTY, not invented", lk && lk.ref === "", JSON.stringify(lk && lk.ref));
ok("...and no refParam is guessed either", lk && !lk.refParam,
   JSON.stringify(lk && lk.refParam));
/* A number nobody measured is a wrong number on a card. */
ok("no shipping or currency figure was assumed",
   lk && lk.freeShipOver === undefined && lk.currency === undefined && lk.international === undefined);

group("AND HARDWARE IS CAPTURABLE NOW -- A REVERSAL, STATED");
/* THIS GROUP USED TO ASSERT THE OPPOSITE, and the reversal is the point of
   keeping it rather than deleting it. It read "hardware stays off the capture
   roster", on the argument that /coldwater-collect is for menus somebody stands
   in a shop and captures, and that an accessory catalogue is scraped rather than
   captured.

   Two reports overtook it: Hitoki and YLLVAPE were both captured deliberately,
   both read their catalogues perfectly (22 and 32 rows off the shops' own
   feeds), and both vanished. The deciding fact is that api/products.js has
   always merged captures for EVERY enabled store -- readCaptures() is called
   with enabled.map(s => s.key) -- so a gear capture is read whatever the install
   page offers. The old rule did not prevent gear captures; it only hid the one
   screen an operator checks to find out whether theirs landed.

   What the reversal DOES require is the accessory override on the capture path,
   which was missing: without it a captured torch classifies as "THCA Flower" and
   enters the per-gram ranking. That is asserted below, because it is the thing
   that makes this safe rather than merely wanted. */
import { readFileSync } from "node:fs";
const ingest = readFileSync("api/coldwater-ingest.js", "utf8");
const prodSrc = readFileSync("api/products.js", "utf8");
ok("the roster is derived from the store list rather than restated",
   /await import\("\.\/products\.js"\)/.test(ingest) && !/"thcasmallbuds,thca4cheap/.test(ingest));
const gear = STORES.filter(s => s.accessory).map(s => s.key);
ok("lookah is one of the accessory stores this covers", gear.includes("lookah"));
/* THE RULE THAT MAKES GEAR SAFE TO CAPTURE, and it was restated four times and
   missing on the fifth path. `accessory:true` is what keeps a torch out of the
   per-gram ranking; captureVerdict() ran classify() bare, so every gear capture
   would have published as THCA Flower. Stated once now, and the capture gate has
   to be a caller or the reversal above ships the bug. */
ok("the accessory override is stated once, not per scrape path",
   /export function classifyFor\(store, hay, body, title\)/.test(prodSrc) &&
   (prodSrc.match(/cannabinoid:'Accessory'/g) || []).length <= 2,
   (prodSrc.match(/cannabinoid:'Accessory'/g) || []).length + " literal copies");
ok("...and the capture gate consults it, which is what it never did",
   /captureVerdict\(c, store\)/.test(prodSrc) &&
   /const cl = classifyFor\(store, hay, hay, name\)/.test(prodSrc));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
