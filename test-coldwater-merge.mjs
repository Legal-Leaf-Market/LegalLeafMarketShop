/* test-coldwater-merge.mjs — pins WHAT TRUMPS WHAT and WHAT COLOURS WHAT.
 *
 * Every rule here fails SILENTLY when it breaks. A wrong precedence does not
 * throw, it publishes a plausible price from the wrong lane; a destructive
 * merge does not throw, it shows a shorter shelf that looks freshly updated.
 * So these are the assertions, not the code's behaviour on a happy path.
 *
 *   node test-coldwater-merge.mjs
 */
import {
  mergeProducts, rowKey, sourceRank, laneOf, sanitiseColour, present, freshnessOf,
} from "./api/coldwater-merge.js";

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error("  FAIL " + msg); } };
const group = m => console.log("\n" + m);

/* Minimal product shape: enough keys for the atomic groups to bite. */
const P = (o) => ({
  storeKey: "shopA", name: o.name || "Blue Dream", brand: o.brand || "",
  batch: o.batch || "", image: o.image || "", description: o.description || "",
  category: o.category || "", type: o.type || "", coa: o.coa || "",
  sizes: o.sizes, startsAt: o.startsAt, perG: o.perG, inStock: o.inStock,
  potency: o.potency, lab: o.lab,
  ...o,
});

/* ------------------------------------------------------------------ rank --- */
group("rank ladder");
ok(sourceRank("manual") > sourceRank("headless"), "manual outranks headless");
ok(sourceRank("manual") > sourceRank("feed"), "manual outranks merchant feed (owner requirement)");
ok(sourceRank("headless") > sourceRank("adapter"), "headless outranks adapter");
ok(sourceRank("adapter") > sourceRank("aggregator"), "adapter outranks licensed feed");
ok(sourceRank("aggregator") > sourceRank("demo"), "any real source outranks demo fixture");
ok(sourceRank("wat") < sourceRank("aggregator"), "an UNDECLARED source ranks below every real lane");
ok(sourceRank("wat") > sourceRank("demo"), "...but still above the demo fixture");

group("lane defaulting — stored captures must not lose rank");
ok(laneOf(undefined) === "manual", "absent lane defaults to manual");
ok(laneOf("") === "manual", "empty lane defaults to manual");
ok(laneOf("collector") === "manual", "legacy 'collector' aliases to manual");
ok(laneOf("HEADLESS") === "headless", "lane is case-insensitive");

/* -------------------------------------------------------------- non-destr --- */
group("a higher lane never deletes rows it did not see");
{
  const harvest = [P({ name: "Blue Dream" }), P({ name: "Gelato" }), P({ name: "Wedding Cake" })];
  const hand = [P({ name: "Blue Dream", perG: 7.5, sizes: [["3.5g", 26, 3.5]] })];
  const out = mergeProducts([
    { source: "headless", products: harvest },
    { source: "manual", products: hand },
  ]);
  ok(out.length === 3, "3 rows survive a 1-row manual capture (got " + out.length + ")");
  const bd = out.find(p => p.name === "Blue Dream");
  ok(bd.perG === 7.5, "the manual price wins on the row it did cover");
  ok(!!out.find(p => p.name === "Gelato"), "Gelato is NOT deleted by a capture that missed it");
}

group("order of the layers array cannot change the outcome");
{
  const a = [P({ name: "Blue Dream", perG: 9.0, sizes: [["3.5g", 31, 3.5]] })];
  const b = [P({ name: "Blue Dream", perG: 7.5, sizes: [["3.5g", 26, 3.5]] })];
  const fwd = mergeProducts([{ source: "headless", products: a }, { source: "manual", products: b }]);
  const rev = mergeProducts([{ source: "manual", products: b }, { source: "headless", products: a }]);
  ok(fwd[0].perG === 7.5 && rev[0].perG === 7.5, "manual wins regardless of array order");
}

/* ------------------------------------------------------------ field merge --- */
group("higher rank wins PER FIELD, not per row");
{
  const rich = [P({ name: "Blue Dream", image: "https://cdn/x.jpg", description: "long text", coa: "https://coa/1.pdf" })];
  const thin = [P({ name: "Blue Dream", perG: 7.5, sizes: [["3.5g", 26, 3.5]] })];
  const out = mergeProducts([
    { source: "headless", products: rich },
    { source: "manual", products: thin },
  ]);
  ok(out[0].image === "https://cdn/x.jpg", "manual with no image does NOT blank the harvest's image");
  ok(out[0].description === "long text", "description survives from the lower lane");
  ok(out[0].coa === "https://coa/1.pdf", "COA survives from the lower lane");
  ok(out[0].perG === 7.5, "manual still wins the field it stated");
  ok(out[0].fieldSource.image === "headless", "provenance records who supplied the image");
  ok(out[0].fieldSource.perG === "manual", "provenance records who supplied the price");
}

group("false and 0 are answers, not silence");
{
  const up = [P({ name: "Blue Dream", sizes: [["3.5g", 26, 3.5]], inStock: true })];
  const gone = [P({ name: "Blue Dream", sizes: [["3.5g", 26, 3.5]], inStock: false })];
  const out = mergeProducts([
    { source: "headless", products: up },
    { source: "manual", products: gone },
  ]);
  ok(out[0].inStock === false, "manual inStock:false beats a stale in-stock (not treated as absent)");
}

/* ---------------------------------------------------------------- atomic --- */
group("the pricing block is atomic — sizes and its derived fields travel together");
{
  const harvest = [P({ name: "Blue Dream", sizes: [["1g", 12, 1], ["28g", 180, 28]], startsAt: 12, perG: 6.43 })];
  /* Manual saw only the eighth, at a sale price. If perG came from one lane and
     sizes from the other, the card would show 6.43/g over rows that cannot
     produce it -- and the engine RANKS on perG. */
  const hand = [P({ name: "Blue Dream", sizes: [["3.5g", 20, 3.5]], startsAt: 20, perG: 5.71 })];
  const out = mergeProducts([
    { source: "headless", products: harvest },
    { source: "manual", products: hand },
  ]);
  ok(out[0].perG === 5.71, "perG comes from the winning lane");
  ok(out[0].sizes.length === 1, "sizes come from the SAME lane as perG");
  ok(out[0].startsAt === 20, "startsAt comes from that lane too");
  ok(out[0].fieldSource.sizes === out[0].fieldSource.perG, "sizes and perG always share a source");
}

group("a lane with no sizes contributes nothing to the pricing block");
{
  const priced = [P({ name: "Blue Dream", sizes: [["3.5g", 26, 3.5]], perG: 7.43, startsAt: 26 })];
  /* A colour-only manual note with no pricing must not blank the price. */
  const noPrice = [P({ name: "Blue Dream", type: "Hybrid" })];
  const out = mergeProducts([
    { source: "headless", products: priced },
    { source: "manual", products: noPrice },
  ]);
  ok(out[0].perG === 7.43, "price survives a manual row that stated no sizes");
  ok(out[0].sizes.length === 1, "sizes survive too");
  ok(out[0].type === "Hybrid", "the manual row's own field still applies");
}

/* ------------------------------------------------------------------ join --- */
group("the join — batch tag first, then normalised name");
{
  ok(rowKey({ storeKey: "a", batch: "1A40", name: "X" }) === rowKey({ storeKey: "a", batch: "1a40", name: "Y" }),
     "same batch tag at same store is the same jar even under different names");
  ok(rowKey({ storeKey: "a", name: "Blue Dream" }) !== rowKey({ storeKey: "b", name: "Blue Dream" }),
     "same name at DIFFERENT stores is never merged");
  ok(rowKey({ storeKey: "a", name: "Blue  Dream!" }) === rowKey({ storeKey: "a", name: "blue dream" }),
     "punctuation and spacing normalise");
}

group("a product read by two lanes lists ONCE (the old splice's job)");
{
  const out = mergeProducts([
    { source: "adapter", products: [P({ name: "Blue Dream", perG: 9 })] },
    { source: "manual", products: [P({ name: "Blue Dream", perG: 7 })] },
  ]);
  ok(out.length === 1, "no double listing at two prices (got " + out.length + ")");
  ok(out[0].perG === 7, "and the surviving price is the operator's");
}

group("size is NOT part of the join");
{
  const out = mergeProducts([
    { source: "headless", products: [P({ name: "Blue Dream", sizes: [["1g", 12, 1], ["28g", 180, 28]] })] },
    { source: "manual", products: [P({ name: "Blue Dream", sizes: [["3.5g", 20, 3.5]] })] },
  ]);
  ok(out.length === 1, "one product, not one per size read");
}

/* ---------------------------------------------------------------- colour --- */
group("colour — the human layer that nothing overwrites");
{
  const key = rowKey(P({ name: "Blue Dream" }));
  const book = {}; book[key] = { note: "last two jars on the shelf", onShelf: true, observedDeal: "B2G1 in store only" };
  const out = mergeProducts(
    [{ source: "headless", products: [P({ name: "Blue Dream", image: "https://cdn/x.jpg", perG: 7 })] }],
    { colour: book }
  );
  ok(out[0].colour && out[0].colour.note === "last two jars on the shelf", "colour attaches to the row");
  ok(out[0].colour.onShelf === true, "observed shelf state survives");
  ok(out[0].image === "https://cdn/x.jpg", "colour does not disturb the scraped fields");
}

group("colour survives a FULLY populated automated row (the owner's requirement)");
{
  const key = rowKey(P({ name: "Blue Dream" }));
  const book = {}; book[key] = { note: "budtender says this is moving", staffPick: true };
  const full = P({
    name: "Blue Dream", image: "i", description: "d", category: "Flower", type: "Hybrid",
    coa: "c", sizes: [["3.5g", 26, 3.5]], perG: 7.43, startsAt: 26, potency: 24, lab: { totalThc: 24 },
  });
  const out = mergeProducts([{ source: "feed", products: [full] }], { colour: book });
  ok(out[0].colour.note === "budtender says this is moving", "colour present even when every field is filled");
  ok(out[0].colour.staffPick === true, "staff pick survives a complete merchant feed");
}

group("colour sanitiser drops unknown fields and caps length");
{
  const c = sanitiseColour({ note: "x".repeat(999), staffPick: true, price: 1, evil: "<script>" });
  ok(c.note.length === 400, "long note is capped at 400");
  ok(c.staffPick === true, "known field kept");
  ok(c.price === undefined && c.evil === undefined, "unknown fields are NOT carried through");
  ok(sanitiseColour({}) === null, "an empty colour record is null, not {}");
  ok(sanitiseColour(null) === null, "null in, null out");
}

/* -------------------------------------------------------------- presence --- */
group("presence");
ok(present(false) === true && present(0) === true, "false and 0 are present");
ok(present("") === false && present("  ") === false, "empty and whitespace strings are absent");
ok(present([]) === false && present([1]) === true, "empty array absent, non-empty present");
ok(present(null) === false && present(undefined) === false, "null and undefined absent");

/* ------------------------------------------------------------------ demo --- */
group("any real reading displaces the demo fixture");
{
  const out = mergeProducts([
    { source: "demo", products: [P({ name: "Blue Dream", perG: 99, store: "Sample Shop A" })] },
    { source: "aggregator", products: [P({ name: "Blue Dream", perG: 7, store: "Real Shop" })] },
  ]);
  ok(out[0].perG === 7, "the lowest real lane still beats the fixture");
}


/* ------------------------------------------------------------- freshness --- */
const NOW = Date.parse("2026-08-16T12:00:00Z");
const daysAgo = d => new Date(NOW - d * 86400000).toISOString();

group("freshness policy is per lane");
{
  ok(freshnessOf(daysAgo(2), "adapter", NOW).expired === false, "adapter not yet expired at 2d (policy is 3d)");
  ok(freshnessOf(daysAgo(4), "adapter", NOW).expired === true, "adapter expired at 4d");
  ok(freshnessOf(daysAgo(2), "adapter", NOW).stale === true, "adapter is stale at 2d");
  ok(freshnessOf(daysAgo(0.5), "adapter", NOW).stale === false, "adapter fresh at 12h");
  ok(freshnessOf(daysAgo(5), "manual", NOW).stale === false, "manual still fresh at 5d (a person has a job)");
  ok(freshnessOf(daysAgo(12), "manual", NOW).stale === true, "manual stale at 12d");
  ok(freshnessOf(daysAgo(12), "manual", NOW).expired === false, "manual NOT expired at 12d");
  ok(freshnessOf(daysAgo(31), "manual", NOW).expired === true, "manual expires at 30d — finite on purpose");
  ok(freshnessOf(daysAgo(3), "headless", NOW).stale === true, "headless stale at 3d (nightly run missed)");
}

group("an undated record is stale but NOT expired");
{
  const f = freshnessOf("", "manual", NOW);
  ok(f.undated === true, "flagged undated");
  ok(f.stale === true, "ranks low");
  ok(f.expired === false, "but the operator's back catalogue is not deleted on a technicality");
}

group("an undeclared lane gets the STRICTEST policy, not the loosest");
ok(freshnessOf(daysAgo(4), "mystery", NOW).expired === true, "unknown lane expires at 3d");

group("STALE DATA MUST NOT WIN ON PRICE — the ranking trap");
{
  /* Prices fall, so the stale row is the CHEAPER row, and the engine ranks on
     perG. Left alone it sorts to the top and is the first thing a shopper sees. */
  const oldHand = [P({ name: "Blue Dream", sizes: [["3.5g", 20, 3.5]], startsAt: 20, perG: 5.71 })];
  const freshBot = [P({ name: "Blue Dream", sizes: [["3.5g", 30, 3.5]], startsAt: 30, perG: 8.57 })];
  const out = mergeProducts([
    { source: "manual", products: oldHand, capturedAt: daysAgo(20) },
    { source: "headless", products: freshBot, capturedAt: daysAgo(0.2) },
  ], { now: NOW });
  ok(out.length === 1, "one row");
  ok(out[0].perG === 8.57, "LAST NIGHT'S harvest wins over a 20-day-old hand price");
  ok(out[0].priceLane === "headless", "and the row says which lane priced it");
  ok(out[0].stale === false, "the surviving price is not stale");
}

group("...but a FRESH manual capture still outranks a fresh harvest");
{
  const hand = [P({ name: "Blue Dream", sizes: [["3.5g", 20, 3.5]], perG: 5.71 })];
  const bot = [P({ name: "Blue Dream", sizes: [["3.5g", 30, 3.5]], perG: 8.57 })];
  const out = mergeProducts([
    { source: "manual", products: hand, capturedAt: daysAgo(1) },
    { source: "headless", products: bot, capturedAt: daysAgo(0.2) },
  ], { now: NOW });
  ok(out[0].perG === 5.71, "rank still decides when both lanes are current");
  ok(out[0].priceLane === "manual", "operator on top");
}

group("stale lanes keep their order relative to each other");
{
  const staleHand = [P({ name: "Blue Dream", sizes: [["3.5g", 20, 3.5]], perG: 5.71 })];
  const staleBot = [P({ name: "Blue Dream", sizes: [["3.5g", 30, 3.5]], perG: 8.57 })];
  const out = mergeProducts([
    { source: "headless", products: staleBot, capturedAt: daysAgo(4) },
    { source: "manual", products: staleHand, capturedAt: daysAgo(15) },
  ], { now: NOW });
  ok(out[0].perG === 5.71, "stale manual still beats stale headless");
  ok(out[0].stale === true, "and the row is flagged stale");
  ok(out[0].ageDays === 15, "carrying the price's real age");
}

group("expired lanes are GONE, not sorted last");
{
  const out = mergeProducts([
    { source: "manual", products: [P({ name: "Ancient", perG: 1, sizes: [["3.5g", 4, 3.5]] })], capturedAt: daysAgo(45) },
    { source: "headless", products: [P({ name: "Current", perG: 9, sizes: [["3.5g", 31, 3.5]] })], capturedAt: daysAgo(0.2) },
  ], { now: NOW });
  ok(out.length === 1, "the 45-day-old lane contributes no rows at all");
  ok(out[0].name === "Current", "only the live row survives");
}

group("an expired lane cannot leak a single FIELD either");
{
  const out = mergeProducts([
    { source: "manual", products: [P({ name: "Blue Dream", description: "month old note", image: "old.jpg" })], capturedAt: daysAgo(45) },
    { source: "headless", products: [P({ name: "Blue Dream", perG: 9, sizes: [["3.5g", 31, 3.5]] })], capturedAt: daysAgo(0.2) },
  ], { now: NOW });
  ok(out[0].description === "", "no description bleeds through from an expired capture");
  ok(out[0].image === "", "nor an image");
}

group("adapter rows carry no timestamp and must not be demoted for it");
{
  /* Produced during the request itself; there is nothing to stamp. Treating
     that as undated would invert the ladder on every single sweep. */
  const out = mergeProducts([
    { source: "adapter", products: [P({ name: "Blue Dream", perG: 9, sizes: [["3.5g", 31, 3.5]] })] },
    { source: "demo", products: [P({ name: "Blue Dream", perG: 99, sizes: [["3.5g", 99, 3.5]] })] },
  ], { now: NOW });
  ok(out[0].perG === 9, "a timestampless adapter layer still outranks demo");
  ok(out[0].stale === false, "and is not marked stale");
}

group("as-of reflects the PRICE's age, not the row's newest field");
{
  const out = mergeProducts([
    { source: "headless", products: [P({ name: "Blue Dream", sizes: [["3.5g", 31, 3.5]], perG: 9 })], capturedAt: daysAgo(3) },
    { source: "manual", products: [P({ name: "Blue Dream", description: "fresh note" })], capturedAt: daysAgo(0.1) },
  ], { now: NOW });
  ok(out[0].description === "fresh note", "the fresh note lands");
  ok(out[0].ageDays === 3, "but as-of is the PRICE's age, which is what misleads");
  ok(out[0].priceLane === "headless", "priced by the harvest");
}

console.log("\n" + (fail ? "FAILED" : "PASSED") + "  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
