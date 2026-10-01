/* test-market-add.mjs — STEP 6. Adding a city, and what it is allowed to cost.
 *
 * ONE_CORE.md section 5 states the sixth step and its own pass mark:
 *
 *   "Add the first new city -- which by then should be an entry in
 *    api/markets.js and a store list, and nothing else. Step 6 is the test of
 *    the whole exercise. If adding Detroit needs any file other than
 *    api/markets.js and its store data, one of steps 2-5 was not finished."
 *
 * IT FAILED THAT TEST ON ITS FIRST RUN, in six places, and every one of them
 * was silent. This suite is what the failures were found with, so it stays as
 * the regression guard for each:
 *
 *   1. TWO TOWN REGISTRIES. api/coldwater.js kept its own five-town map beside
 *      the eight in api/markets.js, and resolved anything missing from its copy
 *      to the default. Measured: ?town=lansing, ?town=detroit and
 *      ?town=grandrapids all returned COLDWATER's shelf. A registered market,
 *      spelled correctly, silently served somebody else's prices -- the exact
 *      failure the town scoping was built to prevent, arriving through the
 *      resolver, which is the one route fromLume()'s expectLocation guard
 *      cannot see. It could not go red anywhere, because falling back IS the
 *      right answer for a mistyped ?town= and two registries leave no way to
 *      tell a typo from a city nobody told you about.
 *   2. THE ROSTER LIVED IN THE READER. Adding a shop meant editing the
 *      3,145-line file that holds the scrapers, the classifier and the merge --
 *      which is precisely the pressure that puts a per-city branch somewhere it
 *      looks at home.
 *   3. THE DEMO BANNER ASKED ABOUT THE PILOT. It fetched a bare /api/coldwater
 *      with no ?town=, so a second city with no shops would have shown
 *      placeholder products under a real place name with no warning at all --
 *      the banner reads the pilot's meta.demo, sees a connected shop, and stays
 *      quiet. The worst of the six.
 *   4. COLOUR WROTE TO THE PILOT. The admin panel posted market:"coldwater" as
 *      a literal. Colour outranks every automated lane and is never overwritten,
 *      so an observation made on another city's page did not land in the wrong
 *      namespace temporarily -- it attached permanently to a Coldwater card.
 *   5. ONE CART FOR EVERY CITY. The trip key was a flat "ll_cw:ll_cart", so two
 *      towns' jars merged into one shopping route.
 *   6. THE TRIP PAGE WAS THE PILOT'S, in twenty places -- including a Google
 *      Maps link that appended ", Coldwater, MI" to every address, which on a
 *      second city routes a shopper ninety miles the wrong way.
 *
 * WHAT THIS SUITE DOES THAT test-one-core.mjs DOES NOT. That one asserts no
 * file BRANCHES on a city. This one adds a city that does not exist, in the two
 * data files and nowhere else, and drives the whole chain against it. A codebase
 * can pass the branch guard and still be impossible to add a city to.
 *
 *   node test-market-add.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKETS } from "./api/markets.js";
import { STORES, TOWNS, townKey, DEFAULT_TOWN } from "./api/market-stores.js";


process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
let pass = 0, fail = 0;
const ok = (c, m, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else   { fail++; console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

/* ------------------------------------------------------------ one registry --- */
group("THERE IS ONE REGISTRY, AND EVERY MARKET IN IT RESOLVES TO ITSELF");
{
  /* The bug in its exact shape. These three are registered markets with no shop
     wired to them yet, which is the state every city is in on the day it is
     added -- so this is not an edge case, it is the normal path. */
  for (const slug of ["lansing", "detroit", "grandrapids"]) {
    ok(townKey(slug) === slug,
       "?town=" + slug + " resolves to " + slug + ", not the pilot", townKey(slug));
  }
  for (const slug of Object.keys(MARKETS)) {
    ok(townKey(slug) === slug, "every registered market resolves to itself: " + slug);
  }
  /* The fallback is still the fallback, and it has to be -- ?town= is a url
     somebody can mistype, and the default shelf beats a blank page. What
     changed is only that a REGISTERED name is no longer treated as a typo. */
  ok(townKey("nowhere-at-all") === DEFAULT_TOWN, "an unregistered name still falls back");
  ok(townKey("") === DEFAULT_TOWN, "and so does an empty one");
  ok(townKey("new-buffalo") === "newbuffalo", "punctuation still strips");

  ok(TOWNS === MARKETS,
     "the reader's town map IS the registry object, not a copy of it");

  /* A copy cannot be kept in step by discipline. Assert nobody has made one. */
  const files = ["api/coldwater.js", "api/coldwater-ingest.js", "api/coldwater-merge.js",
                 "api/overrides.js", "api/market-stores.js"];
  const dupes = [];
  for (const f of files) {
    const code = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    /* A second registry looks like a map literal with two or more town keys in
       it. api/markets.js is excluded by not being in the list. */
    for (const m of code.matchAll(/=\s*\{([^{}]*)\}/g)) {
      const hits = Object.keys(MARKETS).filter(k => new RegExp("(^|\\W)" + k + "\\s*:").test(m[1]));
      if (hits.length >= 2) dupes.push(f + ": " + hits.join(",") + " in one literal");
    }
  }
  ok(dupes.length === 0, "no file rebuilds the registry as its own map literal",
     dupes.slice(0, 3).join(" | "));

  /* A SHORT LIST IS WORSE THAN A LONG ONE, and this guard used to miss it.
     api/coldwater-ingest.js carried `const MARKETS = { coldwater: 1, llm: 1 }`
     and silently defaulted everything else to coldwater -- so a capture posted
     for Detroit was written to Coldwater's namespace, to a key Coldwater's own
     feed never reads. Stored perfectly, invisible on both shelves, ok:true.
     The check above wanted TWO market names in one literal to call it a
     registry, and this had one, so it slipped through while looking exactly
     like the bug it was written for.
     The real tell is not how many cities a map lists. It is a fallback to a
     city name that is not the registry's own resolver. */
  const fallbacks = [];
  /* `files` already excludes api/markets.js by not listing it -- that file is
     where a default city BELONGS. */
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const line of code.split("\n")) {
      /* ANY city name used as a VALUE -- `|| "coldwater"`, `? x : "coldwater"`,
         `market: "coldwater"`. The first draft of this guard looked only for
         `?` and `||` immediately before the string, and the bug it was written
         for used a ternary ELSE, so it passed against the exact line it exists
         to catch. A line that IS calling the resolver is exempt, and so is the
         registry's own file (not in `files`). */
      if (!/(\?|\|\||:|=)\s*["'`]coldwater["'`]/.test(line)) continue;
      if (/marketKey|DEFAULT_MARKET|DEFAULT_TOWN/.test(line)) continue;
      /* `(st.town || "coldwater")` is reading a ROW's own town with the
         documented default for a row that predates the field, not resolving a
         requested market. */
      if (/\.town\s*\|\|/.test(line)) continue;
      fallbacks.push(f + ": " + line.trim().slice(0, 80));
    }
  }
  ok(fallbacks.length === 0,
     "no file falls back to a city name instead of asking the registry" +
     (fallbacks.length ? "\n         " + fallbacks.slice(0, 6).join("\n         ") : ""));
}

/* ------------------------------------------------------ a market with no shops --- */
group("A REGISTERED MARKET WITH NO SHOPS SAYS SO RATHER THAN SERVING THE PILOT");
{
  const mod = await import("./api/coldwater.js");
  const run = async town => {
    let body = null;
    const res = {
      setHeader() {}, status() { return res; },
      send(v) { body = v; return res; }, json(v) { body = JSON.stringify(v); return res; },
      end(v) { body = v; return res; },
    };
    await mod.default({ query: town == null ? {} : { town } }, res);
    return JSON.parse(body);
  };

  const pilot = await run(undefined);
  ok(pilot.meta.town === DEFAULT_TOWN, "no parameter is still the pilot", pilot.meta.town);

  const lan = await run("lansing");
  ok(lan.meta.town === "lansing", "?town=lansing answers as Lansing", lan.meta.town);
  ok(lan.meta.market === "Lansing, MI", "and prints Lansing's market string", lan.meta.market);
  /* THE ONE THAT MATTERS. Placeholder rows are fine; placeholder rows presented
     as a real shop's prices are not, and that is what the old fallback did. */
  ok(lan.meta.demo === true, "it is flagged as the demo fixture, not a live shelf");
  const pilotShops = STORES.filter(s => (s.town || DEFAULT_TOWN) === DEFAULT_TOWN).map(s => s.name);
  const named = JSON.stringify(lan.meta.stores || []);
  const leaked = pilotShops.filter(n => named.includes(n));
  ok(leaked.length === 0, "and names none of the pilot's shops", leaked.join(","));
  const bodies = JSON.stringify(lan.products || []);
  ok(!/Willowbrook/.test(bodies), "nor any of the pilot's products");
}

/* ---------------------------------------------------- the roster, per city --- */
group("THE CAPTURE STATUS ENDPOINT REPORTS ON THE CITY IT WAS ASKED ABOUT");
{
  /* THE THIRD REGISTRY HAD A YOUNGER SIBLING, one class down. api/markets.js
     is the list of TOWNS; api/market-stores.js is the list of SHOPS. Fixing the
     first left GET /api/market/ingest with Coldwater's seven shop keys
     hardcoded as the default for every city market, so asked about Detroit it
     reported on Coldwater's shops, found nothing under any of them -- correctly,
     they are not Detroit's -- and returned 200 with a well-formed map of nulls.

     WHAT THAT LOOKED LIKE, which is the reason this section exists: the install
     page decides each row's state from that map, so /coldwater-collect?market=
     detroit showed all nine Detroit shops reading "not connected" while the
     shelf behind it served 2,461 of their rows -- House of Dank at 1,880 and
     Ascend at 460. The one screen an operator checks to find out whether a
     capture landed said, confidently and in the same words it uses for a shop
     nobody has ever visited, that it had not.

     Driven against Detroit rather than the invented city below, because this is
     the roster-shaped half of the question and Detroit is the city that has a
     roster and is not the pilot. */
  const mod = await import("./api/coldwater-ingest.js");
  const run = async query => {
    let body = null;
    const res = {
      setHeader() {}, status() { return res; },
      send(v) { body = v; return res; }, json(v) { body = JSON.stringify(v); return res; },
      end(v) { body = v; return res; },
    };
    await mod.default({ method: "GET", query }, res);
    return JSON.parse(body);
  };

  const det = await run({ market: "detroit" });
  const asked = Object.keys(det.stores || {});
  const detKeys = STORES.filter(s => s.town === "detroit").map(s => s.key);
  const pilotKeys = STORES.filter(s => (s.town || DEFAULT_TOWN) === DEFAULT_TOWN).map(s => s.key);

  ok(detKeys.length > 0, "Detroit has shops to report on at all", detKeys.length + " shops");
  const missing = detKeys.filter(k => !asked.includes(k));
  ok(missing.length === 0, "?market=detroit reports on every Detroit shop", missing.join(","));
  /* The bug in one line. Every one of these was in the response, all null. */
  const leaked = pilotKeys.filter(k => asked.includes(k));
  ok(leaked.length === 0, "and on none of the pilot's", leaked.join(","));

  const pil = await run({});
  const pilAsked = Object.keys(pil.stores || {});
  ok(pilotKeys.every(k => pilAsked.includes(k)),
     "no market parameter still reports on the pilot's shops", pilAsked.length + " keys");
  ok(!detKeys.some(k => pilAsked.includes(k)), "and not on Detroit's");

  /* An explicit ?stores= must still win, because this endpoint is also how you
     look for a capture stored under a key that is NOT on any roster -- the case
     a roster-derived default is structurally unable to show you. */
  const odd = await run({ market: "detroit", stores: "typo-shop" });
  ok(Object.keys(odd.stores || {}).join(",") === "typo-shop",
     "an explicit ?stores= overrides the roster", Object.keys(odd.stores || {}).join(","));

  /* And the general form, so the next city inherits the fix rather than the
     bug: no api/ file may carry a run of the pilot's shop keys as a literal. */
  const pilotRun = pilotKeys.slice(0, 3).join(",");
  const offenders = [];
  for (const f of ["api/coldwater.js", "api/coldwater-ingest.js", "api/coldwater-merge.js",
                   "api/overrides.js"]) {
    const code = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    if (code.includes(pilotRun)) offenders.push(f);
  }
  ok(offenders.length === 0,
     "no reader hardcodes the pilot's roster as a list", offenders.join(","));
}

/* ------------------------------------------- the capture round trip, per city --- */
group("A CAPTURE POSTED FOR A CITY REACHES THAT CITY'S SHELF, AND ONLY IT");
{
  /* THE THIRD PATH, AND THE ONE THAT SHOWED. The market travels through three
     places and each had to learn it separately: the POST that namespaces a
     capture, the status GET the install page reads, and THIS -- the read the
     shelf itself does. That last one called readIngestMany(keys) with no market
     at all, so it resolved through the same default a mistyped ?town= takes and
     every city page read the PILOT's capture namespace.

     WHAT IT LOOKED LIKE, and why it is worth a round trip rather than a unit
     test: the shelf did not go empty. Detroit's roster keys DO have rows under
     coldwater -- the captures taken before the write path was namespaced -- so
     /detroit served a frozen pre-fix snapshot, House of Dank at 1,869 and
     Ascend at 454, unchanged all evening, while four fresh captures totalling
     2,714 rows sat in ll:detroit:ingest: and never appeared. The install page
     passes ?market= and listed all four. Two screens, both confident, reading
     two different stores. Only a post-then-read catches that; asserting the
     argument exists would have passed against the frozen snapshot too. */
  const ing = await import("./api/coldwater-ingest.js");
  const cw  = await import("./api/coldwater.js");
  const call = async (mod, req) => {
    let body = null;
    const res = {
      setHeader() {}, status() { return res; },
      send(v) { body = v; return res; }, json(v) { body = JSON.stringify(v); return res; },
      end(v) { body = v; return res; },
    };
    await mod.default(req, res);
    return JSON.parse(body);
  };

  process.env.LL_ADMIN_TOKEN = "test-token";
  const post = (market, storeKey, n) => call(ing, {
    method: "POST", query: {}, headers: { "x-ll-admin-token": "test-token" },
    body: {
      market, storeKey, collection: "flower",
      products: Array.from({ length: n }, (_, i) => ({
        name: "Roundtrip Strain " + i,
        url: "https://example.test/" + storeKey + "/p" + i,
        sizes: [{ label: "3.5g", price: 30 + i, grams: 3.5 }],
      })),
    },
  });

  const wrote = await post("detroit", "hod-detroit", 7);
  ok(wrote.stored === 7, "the capture stores", String(wrote.stored));
  ok(wrote.onRoster === true, "under a key on Detroit's roster");

  const det = await call(cw, { query: { town: "detroit" } });
  const detNames = (det.products || []).map(p => p.name);
  ok(detNames.some(n => /Roundtrip Strain/.test(n)),
     "it is on DETROIT's shelf", detNames.length + " products");
  ok(det.meta.demo === false,
     "...so the page is serving real menus rather than the sample catalogue", String(det.meta.demo));
  ok((det.meta.stores || []).some(x => x.name === "House of Dank"),
     "and the shop is named in the feed's own store list",
     JSON.stringify((det.meta.stores || []).map(x => x.name)));

  /* THE OTHER HALF. A read that silently defaults is only half-caught by
     "the right city sees it" -- the pilot must not. */
  const pil = await call(cw, { query: {} });
  ok(!(pil.products || []).some(p => /Roundtrip Strain/.test(p.name)),
     "and it is NOT on the pilot's", (pil.products || []).length + " products");
  ok(!(pil.meta.stores || []).some(x => x.name === "House of Dank"),
     "nor is Detroit's shop named on the pilot's feed");
}

/* ------------------------------------------------- ADDING A CITY, FOR REAL --- */
group("ADDING A CITY TOUCHES THE TWO DATA FILES AND NOTHING ELSE");
{
  /* The proof is done on a COPY of api/, because the claim is about which files
     have to change and the honest way to demonstrate that is to change only
     those and watch the rest work untouched. Imports inside api/ are relative,
     so a copied directory is a working one. */
  const dir = mkdtempSync(join(tmpdir(), "ll-add-city-"));
  try {
    mkdirSync(join(dir, "api"));
    cpSync("api", join(dir, "api"), { recursive: true });

    /* A city that does not exist, so nothing can accidentally already know it.
       Two shops, one of which is enabled but unreachable -- the state a real
       new city arrives in. */
    const SLUG = "zzztestville";
    const mk = readFileSync(join(dir, "api/markets.js"), "utf8").replace(
      /^const DEFAULT_MARKET =/m,
      `MARKETS.${SLUG} = { slug: "${SLUG}", label: "Zzztestville", ` +
      `market: "Zzztestville, MI", county: "Nowhere", status: "live" };\n\n` +
      "const DEFAULT_MARKET =");
    writeFileSync(join(dir, "api/markets.js"), mk);

    /* Rows go in the way a person would add them: inside the STORES literal,
       above the Lume fan-out spread that closes it. */
    const st0 = readFileSync(join(dir, "api/market-stores.js"), "utf8");
    const anchor = "  ...LUME_TOWNS.map(lumeStore),";
    if (st0.indexOf(anchor) < 0) throw new Error("roster anchor moved; update this test");
    const st = st0.replace(anchor,
      `  { key:"zzz-one", name:"Zzz One", town:"${SLUG}", addr:"1 Nowhere Rd", phone:"",\n` +
      `    site:"https://example.invalid/one", area:"", platform:"none", enabled:false },\n` +
      `  { key:"zzz-two", name:"Zzz Two", town:"${SLUG}", addr:"2 Nowhere Rd", phone:"",\n` +
      `    site:"https://example.invalid/two", area:"", platform:"none", enabled:false },\n` +
      anchor);
    writeFileSync(join(dir, "api/market-stores.js"), st);

    const reg = await import(join(dir, "api/markets.js"));
    const shp = await import(join(dir, "api/market-stores.js"));
    ok(reg.marketKey(SLUG) === SLUG, "the new city resolves in the registry");
    ok(reg.marketOf(SLUG).market === "Zzztestville, MI", "and prints its own market string");
    ok(reg.liveMarkets().some(m => m.slug === SLUG), "and is servable");
    ok(shp.STORES.filter(s => s.town === SLUG).length === 2,
       "its two shops are on the roster", shp.STORES.filter(s => s.town === SLUG).length);

    /* THE PILOT IS UNTOUCHED. A new city that changes an existing one is the
       other half of the same failure. */
    ok(shp.STORES.filter(s => (s.town || "coldwater") === "coldwater").length ===
       STORES.filter(s => (s.town || DEFAULT_TOWN) === DEFAULT_TOWN).length,
       "the pilot's roster is exactly as it was");

    /* The feed, unmodified, serves the new city from the copied registry. */
    const feed = await import(join(dir, "api/coldwater.js"));
    let body = null;
    const res = { setHeader() {}, status() { return res; }, send(v) { body = v; return res; },
                  json(v) { body = JSON.stringify(v); return res; }, end(v) { body = v; return res; } };
    /* ?debug, because the roster is the diagnostic half of the payload and the
       roster is what a new city is FOR. */
    await feed.default({ query: { town: SLUG, debug: "1" } }, res);
    const j = JSON.parse(body);
    ok(j.meta.town === SLUG, "the feed answers as the new city", j.meta.town);
    ok(j.meta.market === "Zzztestville, MI", "with its own printed market");
    ok((j.roster || []).length === 2, "and its own roster", (j.roster || []).length);
    ok((j.roster || []).every(r => /^zzz-/.test(r.key)),
       "carrying none of the pilot's shops",
       (j.roster || []).map(r => r.key).join(","));
    ok(j.connected === 0,
       "and its own connected count rather than the pilot's", String(j.connected));

    /* AND THE FILES THAT DID NOT CHANGE, DID NOT CHANGE. This is the assertion
       ONE_CORE.md actually asks for -- everything in api/ except the two data
       files must be byte-identical to what is committed. */
    const changed = [];
    for (const f of ["coldwater.js", "coldwater-ingest.js", "coldwater-merge.js",
                     "overrides.js", "neon.js"]) {
      const a = readFileSync(join("api", f));
      const b = readFileSync(join(dir, "api", f));
      if (!a.equals(b)) changed.push(f);
    }
    ok(changed.length === 0,
       "every other api/ file is byte-identical to the committed one",
       changed.join(",") || "5 files compared");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------------------------------------------------- and no routing entry --- */
group("A CITY PAGE NEEDS NO ROUTING ENTRY, IN EITHER OF THE TWO ROUTING FILES");
{
  /* CLAUDE.md section 3 says routing lives in two files that must stay in sync,
     which is true and is why this was worth checking rather than assuming. The
     answer is that a PAGE needs neither: cleanUrls resolves /x to x.html on
     Vercel, and serveStatic() resolves it the same way locally. The dozen
     "/x": "/x.html" rewrites already in both files never fire -- server.mjs
     says so in its own comment beside /p/theloudpack, which is the one rewrite
     that did fire and was broken by exactly this. */
  const vj = JSON.parse(readFileSync("vercel.json", "utf8"));
  ok(vj.cleanUrls === true, "vercel serves clean urls, so /<city> finds <city>.html");

  const srv = readFileSync("server.mjs", "utf8");
  ok(/tryFiles\s*=\s*extname\(file\)\s*\?\s*\[file\]\s*:\s*\[file \+ "\.html"/.test(srv),
     "and the local preview resolves an extensionless path to .html itself");

  /* Prove it rather than reading it: serve a page that has no entry in either
     file and check it answers. */
  const probe = "zzz-routing-probe";
  ok(!new RegExp('"/' + probe + '"').test(srv), "the probe path is in no local rewrite");
  ok(!new RegExp('"/' + probe + '"').test(readFileSync("vercel.json", "utf8")),
     "and in no vercel rewrite");
  writeFileSync("public/" + probe + ".html", "<!doctype html><title>probe</title>ROUTING-OK\n");
  let out = "";
  try {
    out = execFileSync(process.execPath, ["-e", `
      const { spawn } = require("node:child_process");
      const p = spawn(process.execPath, ["server.mjs"], { stdio: ["ignore","pipe","pipe"] });
      let done = false;
      const tryIt = async () => {
        for (let i = 0; i < 60; i++) {
          try {
            const r = await fetch("http://127.0.0.1:3000/${probe}");
            const t = await r.text();
            console.log(r.status + " " + (t.includes("ROUTING-OK") ? "HIT" : "MISS"));
            done = true; break;
          } catch (e) { await new Promise(s => setTimeout(s, 150)); }
        }
        if (!done) console.log("000 NOSERVER");
        p.kill("SIGKILL"); process.exit(0);
      };
      tryIt();
    `], { encoding: "utf8", timeout: 30000, cwd: process.cwd() }).trim();
  } catch (e) { out = "spawn failed: " + String(e.message || e).slice(0, 80); }
  ok(/^200 HIT/.test(out),
     "a page with no rewrite anywhere is served at its clean url", out);
  rmSync("public/" + probe + ".html", { force: true });
}

/* --------------------------------------------- the generated page is its own --- */
group("A GENERATED CITY PAGE CARRIES ITS OWN TOWN EVERYWHERE IT MATTERS");
{
  const dir = mkdtempSync(join(tmpdir(), "ll-city-page-"));
  const out = join(dir, "lansing.html");
  let built = true;
  try {
    execFileSync(process.execPath, ["tools/make-coldwater.mjs", "--market", "lansing", "--out", out],
                 { stdio: "pipe", timeout: 180000 });
  } catch (e) { built = false; }
  ok(built, "a second city generates");

  if (built) {
    const s = readFileSync(out, "latin1");

    /* Each of these is one of the six failures above, in its fixed form. */
    ok(/TOWN = "lansing"/.test(s), "the feed shim asks for its own town");
    ok(/fetch\("\/api\/market\?town=lansing"/.test(s),
       "the sample-catalogue banner asks about its own town");
    ok(/No Lansing dispensary is connected/.test(s),
       "and names its own town when it fires");
    ok(!/No Coldwater dispensary/.test(s), "and never the pilot's");
    ok(/market: "lansing"/.test(s), "colour is written into its own market");
    ok(!/market: "coldwater"/.test(s), "and never into the pilot's");
    ok(/fetch\("\/api\/market\/ingest"/.test(s),
       "colour posts to the market-neutral ingest route");
    ok(/"ll_cw:lansing:ll_cart"/.test(s), "the trip key carries its own town");
    ok(!/"ll_cw:ll_cart"/.test(s), "and is not the flat shared one");
    ok(/trip\?market=lansing/.test(s), "the trip link carries its own town");
    ok(/label: "Lansing"/.test(s), "and it publishes its own context for that page");
    ok(/\/api\/overrides\?market=lansing/.test(s), "overrides are its own");

    /* The lift that makes the namespacing safe without a per-city case. */
    ok(/var NS = "ll_cw:lansing:", OLD = "ll_cw:"/.test(s),
       "the flat key is lifted once rather than special-cased for the pilot");

    /* And the whole point: the pilot's own page says the same things about
       itself. If either side had a literal in it, only one would. */
    const p = readFileSync("public/coldwater.html", "latin1");
    ok(/TOWN = "coldwater"/.test(p) && /"ll_cw:coldwater:ll_cart"/.test(p) &&
       /fetch\("\/api\/market\?town=coldwater"/.test(p) && /market: "coldwater"/.test(p),
       "the pilot page carries its own town in all four of the same places");
  }
  rmSync(dir, { recursive: true, force: true });
}

/* -------------------------------------------------- the shared trip page --- */
group("THE SHARED TRIP PAGE RESOLVES A TOWN INSTEAD OF NAMING ONE");
{
  const L = readFileSync("public/trip.html", "utf8");
  ok(/market=\(\[a-z0-9-\]\+\)/.test(L), "it reads ?market= from its own url");
  ok(/ll_cw:ctx/.test(L), "falling back to the context the city page published");
  ok(/"ll_cw:" \+ CTX\.slug \+ ":ll_cart"/.test(L), "and builds the trip key from it");
  /* THE ONE THAT WAS NOT COSMETIC. */
  ok(/CTX\.market \? ", " \+ CTX\.market : ""/.test(L),
     "the maps link appends the resolved market, not a hardcoded town");
  ok(!/", Coldwater, MI"/.test(L), "and never the pilot's");
  ok(/fetch\("\/api\/market"/.test(L), "it reads the market-neutral feed");

  /* Every remaining mention of the pilot in this file must be a comment. Code
     that names a town here is a fork of a page that is shared by every city. */
  const code = L.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
                .replace(/<!--[\s\S]*?-->/g, "");
  const named = code.split("\n").filter(l => /coldwater/i.test(l))
                    .filter(l => !/trip/i.test(l));   /* its own path */
  ok(named.length === 0, "no live line on the trip page names a city",
     named.slice(0, 3).map(l => l.trim().slice(0, 60)).join(" | "));
}

console.log("\n" + (fail ? "FAILED" : "PASSED") + "  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
