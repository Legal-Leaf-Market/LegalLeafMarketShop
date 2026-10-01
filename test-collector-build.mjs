/* Which collector am I running?

   THE SELF-CONTAINED BOOKMARKLET IS THE ONLY BUILD DUTCHIE WILL RUN, because a
   shop with a strict script-src refuses the cross-origin <script src> the
   loading bookmarklet injects -- silently, since a blocked script fires no
   error event, which is why it reads as "the bookmarklet will not launch".

   And that build carries the whole collector inside its URL, so it is a
   SNAPSHOT frozen on the day it was dragged. An operator on a shop that was
   fixed weeks ago gets the old reader, the old numbers, and reports them as a
   reader bug. That is exactly what happened: The Dude Abides came back at five
   products long after the tier-table fix, and nothing on screen could say "you
   are running an old reader". Reading a build by what is MISSING from a
   diagnostic is an inference nobody should have to make twice.

   So there are now three places the build appears, and this suite exists
   because they are three copies of one fact:

     1. BUILD inside public/coldwater-collector.js -- the answer
     2. public/collector-build.txt -- what a running collector fetches to
        compare itself against
     3. the install page, which reads (1) out of the file it already fetched

   (2) drifting from (1) is the failure mode with teeth: every collector would
   announce itself stale, or none would, and both look like the feature working.

     node test-collector-build.mjs
*/
import { readFileSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const src = readFileSync("public/coldwater-collector.js", "utf8");
const page = readFileSync("public/coldwater-collect.html", "utf8");
const txt = readFileSync("public/collector-build.txt", "utf8").trim();

console.log("\nWhich collector am I running\n");

group("ONE FACT, THREE PLACES");
const m = src.match(/var BUILD = "([^"]+)"/);
ok("the collector states a build", !!m, m && m[1]);
const BUILD = m ? m[1] : "";
/* The one with teeth: a mismatch makes every collector announce itself stale,
   or none of them, and both look exactly like the feature working. */
ok("collector-build.txt is that same string", txt === BUILD, txt + " vs " + BUILD);
ok("...and nothing else, so a stray line cannot become a version",
   /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[a-z0-9-]+$/.test(txt), JSON.stringify(txt));
/* The install page must never hardcode it -- that would be a fourth copy, and
   the one an operator actually reads. */
ok("the install page reads the build out of the file rather than restating it",
   /var BUILD = "\(\[\^"\]\+\)"/.test(page) || /BUILD = "\(\[\^"\]\+\)"/.test(page),
   "regex present");
ok("...and no build string is typed into the page",
   !new RegExp(BUILD.replace(/[.\-]/g, "\\$&")).test(page.replace(/collector-build/g, "")),
   "no literal " + BUILD);

group("THE COLLECTOR ASKS WHETHER IT IS CURRENT");
ok("it fetches the published build", /collector-build\.txt/.test(src));
/* It must ask the origin the bookmarklet came FROM, not the shop it is running
   on -- the whole point is that a bookmark outlives the page it is used on. */
ok("...from the origin that served it, not from the shop",
   /__LL_COLLECTOR_SRC__/.test(src) && /new URL\(src, location\.href\)\.origin/.test(src));
ok("...and says so where a human is looking, not only in the diagnostics",
   /This bookmark is a snapshot/.test(src) && /re-drag/i.test(src));
ok("...in the warning colour, because it changes what the numbers mean",
   /color:#f0b93c">This bookmark is a snapshot/.test(src));

group("AND IT CANNOT BREAK A CAPTURE");
/* A shop with a strict connect-src refuses this request -- The Dude Abides
   does. That refusal is not an error, it means the check is unavailable. */
const fn = src.slice(src.indexOf("function checkBuild"), src.indexOf("function checkBuild") + 1200);
ok("the check was located", fn.length > 300, fn.length + " chars");
ok("a refused request is swallowed rather than reported",
   /\.catch\(function \(\) \{\}\)/.test(fn) && /try \{/.test(fn));
ok("...and nothing waits on it", !/await/.test(fn));
ok("it is asked once, not once per redraw", /drawFound\.__asked/.test(src));
/* Same build means silence. A check that announced itself every time would be
   noise, and noise is how a real warning gets ignored. */
ok("an up-to-date collector says nothing at all",
   /if \(!t \|\| t === BUILD\) return;/.test(fn));

group("THE INSTALL PAGE MAKES THE COMPARISON POSSIBLE");
ok("it prints the current build where the bookmark is dragged", /id="curbuild"/.test(page));
ok("...and says plainly that the bookmark is a snapshot",
   /This bookmark is a snapshot/.test(page));
ok("...and what to do about it", /re-drag/i.test(page));
/* The sentence that turns a number into a diagnosis. */
ok("...and why a stale one is not obvious",
   /does not fail; it returns a smaller menu/.test(page));

group("THE BUILD MOVED, so a re-drag is verifiable");
/* If the string did not change, re-dragging proves nothing: the panel would
   read the same before and after. */
ok("this change bumped it", BUILD !== "2026-08-17.listing-guard", BUILD);

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
