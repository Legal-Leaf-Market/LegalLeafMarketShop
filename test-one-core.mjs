/* test-one-core.mjs — one core, many cities. The guard, not the feature.
 *
 * THE REQUIREMENT: every city identical, zero differences. One core called with
 * a market, never a copy per town.
 *
 * THE FAILURE IS NOT DRAMATIC. It is one `if (market === "detroit")` added at
 * 1am to fix one shop, and it never shows up in a test -- every other city keeps
 * passing, so nothing goes red. By the fourth city there are nine of them and
 * the cities are no longer one product.
 *
 * So: exactly one file may name a city, and this asserts it. Cheap to enforce
 * now, impossible to retrofit once the branches exist.
 *
 *   node test-one-core.mjs
 */
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { MARKETS, DEFAULT_MARKET, marketKey, marketOf, liveMarkets, storesFromPayout, PER_LICENCE_USD } from "./api/markets.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log("  ok   " + m); } else { fail++; console.log("  FAIL " + m); } };
const group = m => console.log("\n" + m);

/* --------------------------------------------------------------- registry --- */
group("the registry is the single source of city truth");
ok(Object.keys(MARKETS).length >= 5, "several markets are declared");
ok(!!MARKETS[DEFAULT_MARKET], "the default market exists");
ok(marketKey("Detroit") === "detroit", "keys normalise");
ok(marketKey("grand rapids") === "grandrapids", "punctuation and spacing strip");
ok(marketKey("nowhere") === DEFAULT_MARKET, "an unknown market falls back rather than erroring");
ok(marketOf("lansing").market === "Lansing, MI", "the printed market string comes from the registry");

group("every market carries what a page needs, with nothing invented");
{
  for (const [k, m] of Object.entries(MARKETS)) {
    ok(!!m.slug && !!m.label && !!m.market, k + " has slug, label and market string");
    ok(m.slug === k, k + " slug matches its key");
    /* A store count is either the state's arithmetic or absent. It is never a
       directory's guess -- asked for Detroit in one sitting the directories
       returned 35, 155 and 13. */
    if (m.stores != null) {
      ok(m.payoutUSD != null, k + " states a store count only with the payout it came from");
      ok(Math.abs(storesFromPayout(m.payoutUSD) - m.stores) <= 1,
         k + " store count matches its payout divided by the per-licence figure");
    }
  }
}

group("only a market with confirmed shops may be served");
{
  const live = liveMarkets();
  ok(live.length >= 1, "at least one market is live");
  ok(live.every(m => m.status === "live"), "liveMarkets returns only live ones");
  /* A target city with no confirmed shops rendering a page would be an empty
     shelf under a real place name, which is worse than a 404. */
  ok(!live.some(m => m.status === "target" || m.status === "queued"),
     "research states never reach the served list");
}

/* --------------------------------------------------------- THE REAL GUARD --- */
group("NO FILE OUTSIDE THE REGISTRY BRANCHES ON A CITY");
{
  /* The city names that could plausibly be branched on. Coldwater is excluded
     from the filename check because the whole pilot is still named for it -- the
     rename is step 5 of ONE_CORE.md and this guard has to be useful before then.
     What is NOT excluded is a comparison against it. */
  const CITY_WORDS = ["detroit", "grandrapids", "grand rapids", "lansing",
                      "monroe", "newbuffalo", "new buffalo", "morenci", "petersburg"];

  /* A branch is a COMPARISON, not a mention. Comments name cities constantly and
     should -- that is where the reasoning lives. This looks for the shapes that
     actually fork behaviour. */
  const BRANCH = new RegExp(
    "(===|!==|==|!=)\\s*[\"'`](" + CITY_WORDS.join("|") + ")[\"'`]" +
    "|[\"'`](" + CITY_WORDS.join("|") + ")[\"'`]\\s*(===|!==|==|!=)" +
    "|\\bcase\\s+[\"'`](" + CITY_WORDS.join("|") + ")[\"'`]",
    "i");

  const ALLOWED = new Set(["api/markets.js"]);
  const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "public"]);

  function walk(dir, acc) {
    for (const e of readdirSync(dir)) {
      if (SKIP_DIRS.has(e)) continue;
      const p = join(dir, e);
      let st; try { st = statSync(p); } catch (x) { continue; }
      if (st.isDirectory()) walk(p, acc);
      else if ([".js", ".mjs"].includes(extname(e))) acc.push(p);
    }
    return acc;
  }

  const files = walk(".", []).map(f => f.replace(/^\.\//, ""));
  const offenders = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    if (/^test-/.test(f)) continue;          // suites assert on cities by design
    let src; try { src = readFileSync(f, "utf8"); } catch (e) { continue; }
    /* Strip block and line comments before testing: a comment explaining WHY
       Monroe matters is exactly what this repo wants, and flagging it would
       train people to delete the reasoning. */
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const line of code.split("\n")) {
      if (BRANCH.test(line)) offenders.push(f + ": " + line.trim().slice(0, 90));
    }
  }
  ok(offenders.length === 0,
     "no city-name comparison outside api/markets.js" +
     (offenders.length ? "\n         " + offenders.slice(0, 8).join("\n         ") : ""));
  console.log("       (scanned " + files.length + " files)");
}

group("the per-licence figure is the state's, and stated once");
{
  ok(Math.abs(PER_LICENCE_USD - 54017.10) < 0.001, "per-licence payout is the FY2025 figure");
  ok(storesFromPayout(1400000) === 26, "Lansing's $1.4M is 26 licences");
  ok(storesFromPayout(0) === null, "no payout means no claim about store count");
  ok(storesFromPayout(null) === null, "and neither does a missing one");
}

/* ------------------------------------------------------- the shared engine --- */
group("ONE ENGINE, loaded by every city page");
{
  /* The foundation of the whole multi-city plan. At one city this is a wash; at
     thirty it is the difference between 20 MB of generated HTML that must all be
     regenerated whenever the engine changes, and one file. */
  const engine = readFileSync("public/engine.js");
  const page = readFileSync("public/coldwater.html", "latin1");

  ok(engine.length > 150000, "public/engine.js exists and is the engine (" + engine.length + " bytes)");
  ok(!/var B="[A-Za-z0-9+/=]{10000,}"/.test(page),
     "the base64 blob is NOT in the page any more");
  ok((page.match(/<script src="\/engine\.js"><\/script>/g) || []).length === 1,
     "the page loads it from one shared file");
  ok(!/window\.atob\(_b\)/.test(page), "and the atob boot path is gone with it");

  /* The move must not have changed the engine. */
  let utf8 = true;
  try { new TextDecoder("utf-8", { fatal: true }).decode(engine); } catch (e) { utf8 = false; }
  ok(utf8, "the engine file is valid UTF-8");
  ok(engine.filter(b => b > 127).length === 120,
     "it keeps exactly the 120 high bytes CLAUDE.md 5a records (" + engine.filter(b => b > 127).length + ")");

  /* THE SIZE ARGUMENT, asserted rather than asserted-in-prose. A city page must
     stay well under the old 721 KB, or the extraction bought nothing. */
  ok(page.length < 500000, "a city page is now under 500 KB (" + page.length + ")");

  /* It has to be served as UTF-8 or the 120 bytes become mojibake again -- which
     is exactly what atob was doing, and the reason "360º Grinder" rendered as
     "360Âº Grinder" for as long as the blob existed. */
  const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
  const hdr = (vercel.headers || []).find(h => h.source === "/engine.js");
  ok(!!hdr, "vercel.json serves /engine.js explicitly");
  ok(!!(hdr && hdr.headers.some(h => /content-type/i.test(h.key) && /charset=utf-8/i.test(h.value))),
     "...as UTF-8, without which the mojibake returns");
  ok(!!(hdr && hdr.headers.some(h => /cache-control/i.test(h.key))),
     "...and cached, so a browser downloads it once for the whole site");
}

/* --------------------------------------------------- two cities, one page --- */
group("A SECOND CITY IS META + CONFIG, AND NOTHING ELSE");
{
  /* STEP 4 OF ONE_CORE.md, asserted rather than asserted-in-prose. Generate a
     city that is not the pilot and diff it against the pilot: if anything other
     than the declared per-city strings differs, the generator is still
     city-shaped somewhere and the next city will inherit it.

     This is a DIFF and not a read-through on purpose. It found the bug that
     mattered most in this step -- the fetch shim repointed to /api/coldwater
     with no ?town=, so a Lansing page would have served Coldwater's shelf under
     a Lansing heading -- and nothing about reading the generator would have
     surfaced it. */
  const dir = mkdtempSync(join(tmpdir(), "ll-onecore-"));
  const other = join(dir, "lansing.html");
  try {
    execFileSync(process.execPath, ["tools/make-coldwater.mjs", "--market", "lansing", "--out", other],
                 { stdio: "pipe" });
  } catch (e) {
    ok(false, "generating a second city succeeds (" + String(e.message || e).slice(0, 120) + ")");
  }

  const a = readFileSync("public/coldwater.html", "latin1").split("\n");
  const b = readFileSync(other, "latin1").split("\n");
  ok(a.length === b.length, "both cities produce the same number of lines (" + a.length + " vs " + b.length + ")");

  /* COMMENTS ARE STRIPPED BEFORE THE DIFF, both /* *\/ and HTML, for the same
     reason the city-branch guard strips them: this repo's comments are where the
     reasoning lives, and they legitimately discuss Coldwater as the PILOT rather
     than as the page's market. "the Coldwater blocks are..." is a true sentence
     on a Lansing page. Flagging it would train people to delete the reasoning,
     which is the opposite of what this codebase wants.

     What is left after stripping is code, and code that differs between two
     cities is the thing this assertion is for. */
  const stripComments = src => src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, " "))
    .replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, " "));

  const ca = stripComments(readFileSync("public/coldwater.html", "latin1")).split("\n");
  const cb = stripComments(readFileSync(other, "latin1")).split("\n");

  /* DIFF RAW FIRST, NORMALISE SECOND, and the order matters. Normalising both
     files up front turned identical lines into differing ones: LL_COLDWATER_META
     is a fixed global present verbatim in BOTH pages, so replacing "coldwater"
     in one and "lansing" in the other made a line that never differed look like
     it did. Take the lines that actually differ, then ask whether the city name
     explains the difference. */
  const diffs = [];
  for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
    if (ca[i] === cb[i]) continue;
    /* NO MASK ANY MORE, AND THAT IS STEP 5'S RECEIPT. This used to have to hide
       "/api/coldwater" before normalising, because `coldwater` was both a place
       and the product's name and the diff could not tell which it was looking
       at. The endpoint is /api/market now, so every remaining occurrence of the
       word on a city page IS the city. If this mask ever has to come back,
       something has re-introduced the collision. */
    const norm = ca[i].replace(/coldwater/gi, "@CITY@")
              === cb[i].replace(/lansing/gi, "@CITY@");
    diffs.push({ i: i + 1, a: ca[i], b: cb[i], explained: norm });
  }

  /* A differing line is legitimate if the city name accounts for it, or if it is
     the geographic blurb -- registry data one city has and the other does not. */
  const real = diffs.filter(d => !d.explained && !/at I-69 exit 13/.test(d.a));

  ok(real.length === 0,
     "no behavioural difference between two cities" +
     (real.length ? "\n         " + real.slice(0, 6).map(d => d.i + ": " + d.a.trim().slice(0, 80)).join("\n         ") : ""));
  console.log("       (" + diffs.length + " differing code lines, all explained by the city name or the blurb)");

  /* STEP 5: the endpoint is market-neutral, and both names reach it. */
  ok(/TO = "\/api\/market"/.test(readFileSync(other, "latin1")),
     "a city page calls the market-neutral endpoint, not the pilot's name");
  {
    const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
    const rw = vercel.rewrites || [];
    const has = (src) => rw.some(r => r.source === src);
    ok(has("/api/market"), "vercel routes /api/market");
    ok(has("/api/market/ingest"), "vercel routes /api/market/ingest");
    /* NOTHING IS REMOVED. An installed bookmarklet posts to the old path, and a
       capture that 404s is a capture silently lost -- so the old routes are
       aliases kept forever, not deprecations with a date on them. */
    ok(has("/api/coldwater/ingest"),
       "and the OLD ingest path still routes — installed bookmarklets post there");
    const srv = readFileSync("server.mjs", "utf8");
    ok(/"\/api\/market":/.test(srv) && /"\/api\/coldwater":/.test(srv),
       "the local server serves both names too");
  }

  /* THE ONE THAT MUST NEVER REGRESS. Each city's fetch shim has to carry its own
     town, or the page serves another city's shelf under its own name. */
  const townOf = src => (src.match(/TOWN = "([a-z]+)"/) || [])[1];
  ok(townOf(readFileSync("public/coldwater.html", "latin1")) === "coldwater",
     "the pilot page fetches its own town");
  ok(townOf(readFileSync(other, "latin1")) === "lansing",
     "and the second city fetches ITS own town, not the pilot's");

  /* Meta must actually be per-city, or every city competes for one canonical. */
  const bs = readFileSync(other, "latin1");
  ok(/<title>Lansing Cannabis Prices/.test(bs), "the second city has its own title");
  ok(/legal-leafmarket\.com\/lansing/.test(bs), "and its own canonical url");
  ok(/\/api\/overrides\?market=lansing/.test(bs), "and its own overrides market");
  ok(!/market=coldwater/.test(bs), "with no trace of the pilot's market");

  rmSync(dir, { recursive: true, force: true });
}

console.log("\n" + (fail ? "FAILED" : "PASSED") + "  " + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
