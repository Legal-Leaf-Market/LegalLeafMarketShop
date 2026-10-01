/* test-coldwater-colour.mjs — the operator's own layer, written and read back.
 *
 * The merge semantics for colour were built first and pinned in
 * test-coldwater-merge.mjs. This is the other half: there was no way to WRITE
 * any, so the layer that outranks everything was one nothing could put anything
 * into. That is the kind of gap a passing suite hides -- every colour assertion
 * was true and the feature was unreachable.
 *
 * Three things here fail silently if they break:
 *   - colour stored inside a collection is wiped by the next harvest of that
 *     collection, worst on the shops harvested most often
 *   - a perishable claim ("out of the ounce") outliving its truth
 *   - a note that cannot be taken back
 *
 *   node test-coldwater-colour.mjs
 */
import { createServer } from "node:http";
import { ageColour, rowKey, sanitiseColour, COLOUR_PERISH_DAYS } from "./api/coldwater-merge.js";

const PORT = 3496;
const TOKEN = "test-token-not-a-real-secret";
process.env.LL_ADMIN_TOKEN = TOKEN;

const fails = [];
const ok = (c, m) => { if (c) console.log("  ok   " + m); else { fails.push(m); console.log("  FAIL " + m); } };
const group = m => console.log("\n" + m);

const ingest = (await import("./api/coldwater-ingest.js")).default;
const { readIngest } = await import("./api/coldwater-ingest.js");

const srv = createServer((req, res) => {
  const shim = {
    status: c => ({ send: b => { res.writeHead(c, { "content-type": "application/json" }); res.end(b); } }),
    setHeader: (k, v) => res.setHeader(k, v),
  };
  return ingest(req, shim);
});
await new Promise(r => srv.listen(PORT, r));

const post = body => fetch(`http://127.0.0.1:${PORT}/api/coldwater/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ll-admin-token": TOKEN },
  body: JSON.stringify(body),
}).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

/* Every fixture row carries a url: #162 rejects a captured row without one,
   because a dead link is a shopper clicking through to nothing. */
const PRODUCTS = [
  { name: "Blue Dream", brand: "Drip", url: "https://shop.example/products/blue-dream", sizes: [{ label: "3.5g", price: 26 }] },
  { name: "Gelato", brand: "Drip", url: "https://shop.example/products/gelato", sizes: [{ label: "3.5g", price: 30 }] },
];

/* ------------------------------------------------------------- write path --- */
group("a colour-only post needs no products");
{
  const r = await post({
    storeKey: "cshop", market: "coldwater",
    colour: [{ name: "Blue Dream", brand: "Drip", note: "last two jars", onShelf: true }],
  });
  ok(r.status === 200, "accepted without a products array (got " + r.status + ")");
  ok(r.json && r.json.colourWritten === 1, "one observation written");
  ok(!(r.json && r.json.error), "no error about missing products");
}

group("it reads back out, keyed the same way the merge joins");
{
  const rec = await readIngest("cshop", "coldwater");
  const k = rowKey({ storeKey: "cshop", brand: "Drip", name: "Blue Dream" });
  ok(!!(rec && rec.colour), "colour comes back from readIngest");
  ok(!!(rec && rec.colour && rec.colour[k]), "under the merge's own rowKey");
  ok(rec.colour[k].note === "last two jars", "the note survived");
  ok(rec.colour[k].onShelf === true, "the shelf observation survived");
  ok(typeof rec.colour[k].seenAt === "string" && rec.colour[k].seenAt.length > 10,
     "seenAt was stamped server-side");
}

/* --------------------------------------------------------------- survival --- */
group("COLOUR OUTLIVES THE ROWS IT ANNOTATES");
{
  /* The whole point of storing it at store level. A harvest replaces a
     collection wholesale; if colour lived in one it would be wiped nightly, and
     hardest on the shops that are read most often. */
  await post({ storeKey: "cshop", market: "coldwater", collection: "headless", lane: "headless", products: PRODUCTS });
  const rec = await readIngest("cshop", "coldwater");
  const k = rowKey({ storeKey: "cshop", brand: "Drip", name: "Blue Dream" });
  ok(!!(rec && rec.colour && rec.colour[k]), "colour survives a full harvest of the store");
  ok(rec.colour[k].note === "last two jars", "...with the note intact");
  ok(rec.products.length === 2, "and the harvested rows are there too");

  await post({ storeKey: "cshop", market: "coldwater", collection: "headless", lane: "headless", products: [PRODUCTS[0]] });
  const rec2 = await readIngest("cshop", "coldwater");
  ok(!!(rec2 && rec2.colour && rec2.colour[k]), "survives a SECOND harvest that replaced the collection");
}

/* ----------------------------------------------------------------- delete --- */
group("a note can be taken back");
{
  const r = await post({ storeKey: "cshop", market: "coldwater", colour: [{ name: "Blue Dream", brand: "Drip" }] });
  ok(r.status === 200, "an empty observation is accepted");
  const rec = await readIngest("cshop", "coldwater");
  const k = rowKey({ storeKey: "cshop", brand: "Drip", name: "Blue Dream" });
  ok(!(rec && rec.colour && rec.colour[k]), "and deletes the entry — the top lane must be correctable");
}

/* ------------------------------------------------------------- guardrails --- */
group("an observation with no identity is refused");
{
  const before = await readIngest("cshop", "coldwater");
  const beforeN = Object.keys((before && before.colour) || {}).length;
  const r = await post({ storeKey: "cshop", market: "coldwater", colour: [{ note: "everything is great" }] });
  const after = await readIngest("cshop", "coldwater");
  const afterN = Object.keys((after && after.colour) || {}).length;
  ok(afterN === beforeN, "a note with no name and no batch paints nothing");
  ok(!(r.json && r.json.colourWritten), "and is not counted as written");
}

group("unknown fields never reach storage");
{
  await post({ storeKey: "cshop2", market: "coldwater",
    colour: [{ name: "Zkittlez", note: "good", price: 1, inStock: false, evil: "<script>" }] });
  const rec = await readIngest("cshop2", "coldwater");
  const k = rowKey({ storeKey: "cshop2", name: "Zkittlez" });
  const c = rec && rec.colour && rec.colour[k];
  ok(!!c && c.note === "good", "the known field lands");
  ok(c && c.price === undefined && c.evil === undefined, "unknown fields are dropped");
  ok(c && c.inStock === undefined, "and an engine field cannot be shadowed by an observation");
}

/* ----------------------------------------------------------------- ageing --- */
group("perishable claims perish; durable ones do not");
{
  const NOW = Date.parse("2026-08-16T12:00:00Z");
  const daysAgo = d => new Date(NOW - d * 86400000).toISOString();

  const fresh = ageColour({ note: "n", onShelf: true, observedDeal: "B2G1", staffPick: true, seenAt: daysAgo(1) }, NOW);
  ok(fresh.onShelf === true && fresh.observedDeal === "B2G1", "inside the window everything shows");

  const old = ageColour({ note: "n", onShelf: true, observedDeal: "B2G1", staffPick: true, seenAt: daysAgo(COLOUR_PERISH_DAYS + 1) }, NOW);
  ok(old.onShelf === undefined, "an old 'on the shelf' is dropped — it is a claim about now");
  ok(old.observedDeal === undefined, "so is an old in-store deal");
  ok(old.note === "n", "but the note stays");
  ok(old.staffPick === true, "and so does the staff pick");

  ok(ageColour({ onShelf: true, seenAt: daysAgo(99) }, NOW) === null,
     "a record whose only content perished returns null rather than an empty stamp");
  const undated = ageColour({ note: "n", onShelf: true }, NOW);
  ok(undated.note === "n" && undated.onShelf === undefined,
     "an UNDATED claim is not trusted, but its durable half still comes through");
}

group("sanitiseColour");
ok(sanitiseColour({ note: "x".repeat(999) }).note.length === 400, "long notes are capped");
ok(sanitiseColour({}) === null, "empty in, null out");

console.log("");
srv.close();
if (fails.length) { console.log(`FAILED — ${fails.length} assertion(s)\n`); process.exit(1); }
console.log("All assertions passed.\n");
process.exit(0);
