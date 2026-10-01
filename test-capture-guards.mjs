/* The hemp capture path, against the shapes the Coldwater side already guards. */
import { gramsOf, isNonConsumable } from "./api/coldwater.js";
let f=0; const ok=(n,c,x="")=>{console.log((c?"  ok   ":"  FAIL ")+n+(x?"   ("+x+")":""));if(!c)f++};
console.log("\nhemp capture path — the guards it was missing\n");
/* A capture taken before the pound rules stored 0 for these. */
ok("a stale QP capture is repaired from its label", gramsOf("QP") === 112, String(gramsOf("QP")));
ok("and a stale pound capture too", gramsOf("1 LB") === 448, String(gramsOf("1 LB")));
ok("a label with no weight still yields nothing", gramsOf("One Size") === 0);
ok("gear is recognised so its weight can be zeroed",
   isNonConsumable("710 Cleaner", "Accessories") === true, String(isNonConsumable("710 Cleaner","Accessories")));
ok("and real flower is not", isNonConsumable("Blue Dream Small Buds", "Flower") === false);
/* The bound the hemp shelf had no version of. */
const bound = (p,g) => { const v = p/g; return (v < 0.25 || v > 1000) ? null : Math.round(v*100)/100; };
ok("a four-cent eighth is suppressed, not published", bound(10, 224) === null, String(bound(10,224)));
ok("a $180 QP read correctly is published", bound(180, 112) === 1.61, String(bound(180,112)));
/* THE BOUND CANNOT CATCH THIS, and that is why gramsOf's ORDERING is the real
   fix rather than the guard. Read "quarter pound" as a quarter OUNCE and $180
   publishes at $25.71/g -- wrong by 16x, and comfortably inside 0.25-1000. A
   sanity bound catches arithmetic that is absurd; it cannot catch arithmetic
   that is merely false. Pinned so nobody later mistakes the guard for cover. */
ok("a $180 QP misread as 7g slips through the bound, so the parser must be right",
   bound(180, 7) === 25.71, String(bound(180, 7)));
ok("which the pound rules now prevent at the source", gramsOf("quarter pound") === 112);

/* ------------------------------------------------------------------
   THE CAPTURE ROSTER IS DERIVED NOW, SO ASK THE ENDPOINT, NOT THE SOURCE.

   /coldwater-collect asks api/coldwater-ingest.js which shops to offer, and for
   the national feed that answer used to be a hardcoded string of nine keys --
   a twin of the enabled keys in api/products.js, kept in step by discipline.
   It drifted in exactly one direction twice (DSquared, then Binoid): a shop
   left products.js and stayed on the install page, where an operator captured a
   menu nothing would ever read, and the capture stored perfectly and was never
   seen. This file existed to hold the two lists together.

   The list is read from products.js now, so that drift is structurally
   impossible rather than merely tested for -- which means the useful question
   changed. A regex over the source can no longer answer it, and would go green
   against a broken derivation returning nothing at all. So the handler is
   DRIVEN and its actual answer is asserted.
   ------------------------------------------------------------------ */
import { STORES } from "./api/products.js";
import { readFileSync as _rf } from "node:fs";

const ingestSrc = _rf("api/coldwater-ingest.js", "utf8");
ok("the roster is derived from the store list, not restated",
   /await import\("\.\/products\.js"\)/.test(ingestSrc) &&
   !/"thcasmallbuds,thca4cheap/.test(ingestSrc));

const ing = await import("./api/coldwater-ingest.js");
let body = null;
const res = { setHeader() {}, status() { return res; }, send(v) { body = v; return res; },
              json(v) { body = JSON.stringify(v); return res; }, end(v) { body = v; return res; } };
await ing.default({ method: "GET", query: { market: "llm" } }, res);
let offered = [];
try { offered = Object.keys(JSON.parse(body) || {}); } catch { /* reported below */ }
/* The endpoint wraps its map; find whichever key holds it rather than assuming
   a shape, so this asserts the roster and not the envelope. */
if (offered.length && !offered.includes("hipuffy")) {
  const j = JSON.parse(body);
  for (const k of offered) if (j[k] && typeof j[k] === "object" && j[k].hipuffy !== undefined) offered = Object.keys(j[k]);
}
ok("the endpoint answered with a roster at all", offered.length > 0,
   offered.length + " shops: " + offered.slice(0, 4).join(", "));

const live = new Set(STORES.filter(s => s.enabled !== false).map(s => s.key));
const offRoster = offered.filter(k => !live.has(k));
ok("every shop the install page offers is one the feed will read",
   offRoster.length === 0, offRoster.join(", "));
ok("Binoid is delisted in the store list", STORES.some(s => s.key === "binoid" && s.enabled === false));
ok("...and is no longer offered for capture", !offered.includes("binoid"));
/* The counter-case: a delisting must not empty the roster. */
ok("the roster still offers the shops that remain", offered.length >= 8, offered.length + " shops");
/* AND THE GEAR SHOPS ARE ON IT NOW, which is a reversal. They were held off on
   the argument that "an accessory catalogue is scraped, not captured" -- until
   Hitoki and YLLVAPE were both captured deliberately and both vanished. The
   deciding fact is that api/products.js already merges captures for EVERY
   enabled store, so those captures are read whatever this list says; keeping
   gear off it only hid the screen an operator checks to confirm the capture
   landed. */
ok("...including the gear shops that were reported",
   offered.includes("hitoki") && offered.includes("yllvape"),
   offered.filter(k => ["hitoki", "yllvape", "grasscity"].includes(k)).join(", "));

console.log("\n" + (f ? "FAILED: " + f + " assertion(s)" : "All assertions passed.") + "\n");
process.exit(f ? 1 : 0);
