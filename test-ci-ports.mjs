/* NO TWO BROWSER SUITES MAY CLAIM THE SAME PORT.

   THIS WAS FREE UNTIL IT WASN'T. While every browser suite ran as its own
   matrix job, each got a whole runner to itself, so two suites hardcoding CDP
   9341 could never meet. Thirteen of them collided on eight ports and nothing
   ever noticed -- there was nothing to notice.

   BATCHING MADE IT FATAL. Running the suites sequentially inside one job puts
   them on one machine, and the second suite to want 9341 either attaches to the
   first one's dying Chromium or fails to listen. Neither reads as a port
   problem: what you get is a suite that reports zero rows, or one that hangs on
   a target that will never appear, or -- worst -- one that quietly drives the
   PREVIOUS suite's browser and passes. This repo has already been misled once
   by a suite that produced no output at all for exactly this reason.

   SO THE CHEAPEST FIX IS ALSO THE WRONG ONE. Renumbering the thirteen takes a
   minute and lasts until somebody copies an existing suite as a template for a
   new one, which is how every one of these ports was chosen in the first place.
   The guard is what makes the renumbering stay true.

   It reads the suite list out of the workflow rather than globbing, so a suite
   that is in CI is checked and one that is not cannot fail the build for a
   collision that cannot happen. Two failure modes are asserted separately: a
   duplicate port, and a suite the scanner could not read a port out of at all
   -- because a silent zero-port suite would let a real collision through while
   the guard reported success.

     node test-ci-ports.mjs
*/
import { readFileSync, readdirSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };

const YML = ".github/workflows/tests.yml";
const yml = readFileSync(YML, "utf8");

/* THE SHARD LISTS ARE THE SUITE LIST NOW. There is no separate roster to drift
   from -- a browser suite runs if and only if it is named in a shard. */
const shardLists = [...yml.matchAll(/suites:\s*>-?\s*\n((?:\s+test-[a-z0-9-]+\.mjs[ \t]*\n)+)/g)]
  .map(m => [...m[1].matchAll(/test-[a-z0-9-]+\.mjs/g)].map(x => x[0]));
ok("the workflow declares browser shards", shardLists.length >= 2, shardLists.length + " shards");
const suites = shardLists.flat();
ok("they name browser suites", suites.length >= 20, suites.length + " entries");

/* A suite in two shards runs twice and is billed twice -- the exact waste this
   change was made to remove, reintroduced by a copy-paste nobody would see. */
const seen = new Map();
for (const s of suites) seen.set(s, (seen.get(s) || 0) + 1);
const twice = [...seen].filter(([, n]) => n > 1).map(([s]) => s);
ok("no suite is sharded twice", twice.length === 0, twice.join(", ") || seen.size + " distinct");

/* AND NO BROWSER SUITE MAY BE IN NO SHARD, which is the condition this whole
   workflow exists to end and the one sharding makes easy to cause: adding a
   suite used to mean adding a matrix line, and now it means finding the right
   shard, which is one step further from obvious.

   A browser suite is identified by what it actually does -- reach for
   tools/chrome-path.mjs -- rather than by a second hand-kept list. This repo has
   been bitten twice by hand-kept twins (the capture roster, the collector's
   ported readers), so the rule is derived from the file itself. */
const onDisk = readdirSync(".").filter(f => /^test-[a-z0-9-]+\.mjs$/.test(f));
const browserFiles = onDisk.filter(f => {
  const src = readFileSync(f, "utf8");
  /* IT MUST IMPORT THE RESOLVER AND CALL IT. Testing for the STRING
     "chrome-path.mjs" flagged this very file and test-chrome-path.mjs, neither
     of which starts a browser -- one only argues about the resolver in a
     comment and the other tests it. That is the prose trap this repo keeps
     walking into, here inside the guard written to stop a different one. */
  return /^import[^\n]*chrome-path\.mjs/m.test(src) && /launchChrome\s*\(/.test(src);
});
ok("browser suites are identifiable by what they import", browserFiles.length >= 20,
   browserFiles.length + " import chrome-path");
const orphans = browserFiles.filter(f => !seen.has(f));
ok("every browser suite on disk is in a shard", orphans.length === 0,
   orphans.join(", ") || browserFiles.length + " placed");
/* And nothing sharded has gone missing from disk. */
const ghosts = suites.filter(f => !onDisk.includes(f));
ok("every sharded suite exists", ghosts.length === 0, ghosts.join(", ") || "all present");

/* ANY ALL-CAPS IDENTIFIER WHOSE NAME MENTIONS A PORT, and the first numeric
   literal bound to it. Deliberately loose: these files spell it PORT, CDP,
   CDP_PORT, SITE_PORT, SHOP_PORT and PORT2, some behind a process.env default
   (`Number(process.env.PORT) || 3141`), and a tighter pattern silently skipped
   the suites that spell it plain `PORT` -- which is most of them. A scanner
   that misses a suite reports "no collisions" about a file it never read. */
const portsOf = src => {
  const out = new Set();
  for (const m of src.matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*([^;,\n]+)/g)) {
    if (!/PORT|CDP/.test(m[1])) continue;
    const lit = (m[2].match(/\b(\d{4,5})\b/) || [])[1];
    if (lit) out.add(Number(lit));
  }
  return [...out].sort((a, b) => a - b);
};

const claim = new Map();      // port -> [suite, ...]
const silent = [];            // suites no port could be read from
for (const s of [...new Set(suites)]) {
  let src;
  try { src = readFileSync(s, "utf8"); } catch { continue; }
  const ports = portsOf(src);
  if (!ports.length) { silent.push(s); continue; }
  for (const p of ports) {
    if (!claim.has(p)) claim.set(p, []);
    claim.get(p).push(s);
  }
}

/* A suite with no readable port is not a pass. It might genuinely open none, or
   it might compute one in a way this scanner cannot see -- and the second is a
   collision the guard would report as clean. Either way somebody has to look,
   so it is named rather than skipped. */
ok("every browser suite declares a port the scanner can read",
   silent.length === 0, silent.length ? silent.join(", ") : seen.size + " read");

const dupes = [...claim].filter(([, who]) => who.length > 1).sort((a, b) => a[0] - b[0]);
ok("no port is claimed by more than one suite", dupes.length === 0,
   dupes.length ? dupes.map(([p, who]) => p + ": " + who.join(" + ")).join(" | ")
                : claim.size + " distinct ports across " + seen.size + " suites");

console.log(`\n${fails.length ? "FAILED: " + fails.join(", ") : "All CI port checks passed."}`);
process.exit(fails.length ? 1 : 0);
