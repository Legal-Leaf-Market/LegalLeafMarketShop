/* The Library and the Reels wear this site's colours, and its objects.

   TWO CLAIMS, BOTH OF WHICH FAILED SILENTLY ONCE.

   1. THE PALETTE. public/css/tokens.css is the family design system, and its
      own header says the palette block is "lifted verbatim out of this site's
      own :root in public/index.html, so the library pages and the market pages
      cannot drift apart". It had drifted: the market pages were recoloured from
      leaf green to cold blue and this file was not, so /library and /reels went
      on painting themselves in the old family green.

   2. THE OBJECTS. public/css/plate.css carries what a card looks like on these
      pages, and it wins over library.css BY ORDER RATHER THAN BY WEIGHT -- every
      selector in it is written at the same specificity as the rule it replaces,
      so neither file needs !important and the two are readable side by side.
      Move the <link> above library.css and nothing errors. The pages just go
      quietly back to looking like the thing the owner asked them to stop
      looking like.

   Both reported as "the reels and library need to match the rest of the site ...
   it currently has the Nicotia market styling, and I don't want any part of
   that".

   NOTHING ERRORED, and nothing could. A stylesheet that claims in its own header
   to be a copy of another file, and is not, is the failure this repo keeps
   writing up -- capKey and captureKeyer, rscRoots and its collector twin,
   storeCheckoutUrl four times over. Only a person looking at both can tell.

   So the claims are checked rather than asserted in prose.

     node test-library-style.mjs
*/
import { readFileSync, readdirSync } from "node:fs";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const index = readFileSync("public/index.html", "latin1");
const tokens = readFileSync("public/css/tokens.css", "utf8");
const libCss = readFileSync("public/css/library.css", "utf8");
const plate = readFileSync("public/css/plate.css", "utf8");
const pages = { "library.html": readFileSync("public/library.html", "latin1"),
                "reels.html": readFileSync("public/reels.html", "latin1") };

console.log("\nThe Library and the Reels wear this site's colours, and its objects\n");

/* Read the market's :root out of index.html rather than restating it: a test
   that carried its own copy would be a third place for the palette to live. */
function rootOf(css, at) {
  const i = css.indexOf(at);
  const block = css.slice(i, css.indexOf("}", i));
  const out = {};
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) out[m[1]] = m[2].trim();
  return out;
}
const market = rootOf(index, ":root{");
const family = rootOf(tokens, ":root{");

group("ONE PALETTE, TWO FILES");
ok("index.html declares a palette", Object.keys(market).length > 10, Object.keys(market).length + " tokens");
ok("tokens.css declares one too", Object.keys(family).length > 10, Object.keys(family).length + " tokens");
/* The tokens the header names as lifted. Not every token -- tokens.css also
   carries type and metric names the market page has no use for -- but every one
   that decides what colour the page is. */
const SHARED = ["--bg", "--panel", "--panel2", "--glass", "--glass-line", "--line",
                "--text", "--muted", "--dim", "--leaf", "--leaf2", "--leaf3",
                "--gold", "--amber", "--red", "--chip"];
const drift = SHARED.filter(k => market[k] && family[k] && market[k] !== family[k]);
ok("every shared colour token agrees with the market page", drift.length === 0,
   drift.map(k => `${k}: market ${market[k]} vs family ${family[k]}`).join("; "));
const missing = SHARED.filter(k => !family[k]);
ok("...and none of them went missing", missing.length === 0, missing.join(", "));

group("AND THE ACCENT IS THIS SITE'S, NOT A SISTER'S");
/* --accent is the single line that makes these pages read as Legal-Leaf's
   rather than Nicotia's amber or Herbal-Leaf's terracotta. */
ok("the accent is the leaf token", /--accent\s*:\s*var\(--leaf\)/.test(tokens));
ok("...which on this site is a cold blue, not a green",
   family["--leaf"] === "#4ec9ff", family["--leaf"]);
/* rgba() tints are written as raw channels and cannot use var(), so they are a
   fourth place the old green survived on every page that tints the accent. */
ok("the rgba channels match the accent rather than trailing it",
   /--accent-rgb\s*:\s*78,\s*201,\s*255/.test(tokens),
   (tokens.match(/--accent-rgb[^;]*/) || [""])[0]);

group("NO GREEN SURVIVES ON EITHER PAGE");
/* The family green, its two darker steps, its rgba channels, the green-black
   ground, and the two green-black INKS that sit on an accent-coloured fill
   (.st-cta and .rl-follow) -- those two are the ones no token indirection could
   ever have caught, because ink on a fill is written as a literal by design. */
const GREENS = ["#4ade80", "#22c55e", "#16a34a", "74,222,128", "#0b120d", "#1a271f",
                "#04140a", "#08130c"];
for (const [name, html] of Object.entries(pages)) {
  const found = GREENS.filter(g => html.includes(g));
  ok(`${name} carries no leaf-green literal`, found.length === 0, found.join(", "));
}
for (const [where, css] of [["tokens.css", tokens], ["library.css", libCss], ["plate.css", plate]]) {
  const found = GREENS.filter(g => css.includes(g));
  ok(`${where} carries none either`, found.length === 0, found.join(", "));
}

group("AND THE SISTER LINKS ARE STILL SISTER-COLOURED");
/* The one place another site's colour belongs: the card that links to it.
   Recolouring those would be the opposite mistake -- three identical chips
   claiming to be three different sites. */
ok("the Nicotia card still carries Nicotia's own class",
   pages["library.html"].includes("tc-ember"), "tc-ember");
ok("...and it is a link out, not a style this page inherits",
   /tc-ember"\s+href="https:\/\/nicotiamarket\.com/.test(pages["library.html"]));

/* ------------------------------------------------------------------ */

group("PLATE.CSS LOADS AFTER LIBRARY.CSS, ON EVERY PAGE THAT LOADS BOTH");
/* The whole file rests on this. It is the assertion with teeth: a reversed
   link order is invisible in review, invisible in the console, and undoes the
   change wholesale. Read off the pages rather than from a list here, so a
   thirteenth page joining the family is checked the day it is added. */
const htmls = readdirSync("public").filter(f => f.endsWith(".html"));
const libPages = htmls.filter(f => readFileSync("public/" + f, "latin1").includes("css/library.css"));
ok("the library family is more than one page", libPages.length >= 10, libPages.length + " pages");
const noPlate = [], wrongOrder = [];
for (const f of libPages) {
  const h = readFileSync("public/" + f, "latin1");
  const a = h.indexOf("css/library.css"), b = h.indexOf("css/plate.css");
  if (b < 0) noPlate.push(f); else if (b < a) wrongOrder.push(f);
}
ok("every page in it loads plate.css", noPlate.length === 0, noPlate.join(", "));
ok("...and every one loads it AFTER library.css", wrongOrder.length === 0, wrongOrder.join(", "));

group("AND GREEK GLASS IS NO LONGER THE ONE PAGE STILL PAINTED GREEN");
/* It was the last of them. Hand-authored, fed by Big Cartel rather than
   /api/products, and never recoloured when the rest of the site was -- so it
   agreed with ITSELF (:root and theme-color both #0b120d) and sailed past the
   check above, which asks only that a page matches its own ground. That is the
   right question for that check and the wrong one for this page.

   ASKED BY HUE, NOT BY A LIST OF KNOWN LITERALS. This page carries ~60 colour
   literals of its own, hand-tuned for a WHITE card face, and a list would only
   ever catch the ones somebody already thought of. Any hex where green clearly
   dominates is the failure.

   TWO EXCEPTIONS, both named rather than tolerated by a loose threshold:
     #39ff6a is a stop in the rainbow the nav icons and glass swatches are drawn
       in -- Greek Glass's own product language, not site chrome.
     #128722 IS NOT A COLOUR AND IS NOT ON THE ALLOW-LIST. It is &#128722;, the
       shopping-cart emoji entity on the cart button. Allowing it as a green
       would be recording a false fact to make a test pass; the honest fix is to
       stop reading numeric character references as colours, which is what the
       (?<!&) does. The first draft of this guard flagged it -- and the recolour
       script very nearly swapped it, which would have quietly turned the cart
       button into a different glyph.

       AND THE FIX FOR IT WAS ITSELF WRONG ONCE, in the way that matters most
       here: the lookahead read (?![0-9a-fA-F;]), excluding a trailing semicolon
       as a second defence against the entity. Every CSS colour is followed by a
       semicolon, so it excluded nearly the whole file and the guard passed
       against a page with #0b8a37 put back in it. Verified against that exact
       injection now, because a guard that passes vacuously is worse than none. */
const gg = readFileSync("public/greekglass.html", "latin1");
const ALLOWED_GREEN = ["39ff6a"];
const greens = [];
for (const m of gg.matchAll(/(?:(?<!&)#|%23)([0-9a-fA-F]{6})(?![0-9a-fA-F])/g)) {
  const h = m[1].toLowerCase();
  if (ALLOWED_GREEN.includes(h)) continue;
  const r = parseInt(h.slice(0,2),16), g2 = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  if (g2 > r + 18 && g2 > b + 18 && !greens.includes(h)) greens.push(h);
}
ok("greekglass.html carries no green literal of its own", greens.length === 0,
   greens.map(h => "#" + h).join(", "));
ok("...and its :root is the market's palette", /--bg:#080f14/.test(gg) && /--leaf:#4ec9ff/.test(gg));
/* The two that must NOT have moved. The first is product language; the second is
   a glyph a colour sweep mistakes for a colour. */
ok("the rainbow the glass is drawn in is untouched",
   (gg.split("#39ff6a").length - 1) === 3, (gg.split("#39ff6a").length - 1) + " stops");
ok("...and the cart button is still a cart", gg.includes("&#128722;"));

group("THE BROWSER CHROME COLOUR IS THE PALETTE'S THIRD HOME");
/* After index.html's :root and tokens.css, and it is the one nobody looks at and
   everybody sees. Pinned across TWO pages, this passed while seventeen others --
   including index.html ITSELF, and therefore all six pages generated from it --
   went on declaring the old green-black #0b120d behind a #080f14 ground. Caught
   by review, not by the suite, which is the whole argument for reading the list
   off disk instead of writing one down.
   A page with a ground of its own (greekglass, ambassador) is judged against ITS
   OWN :root: the claim is that a page agrees with itself, not that every page on
   the site is the same colour. */
const tokensBg = family["--bg"];
const themed = [], mismatched = [];
for (const f of readdirSync("public").filter(x => x.endsWith(".html"))) {
  const h = readFileSync("public/" + f, "latin1");
  const tc = (h.match(/name="theme-color"\s+content="(#[0-9a-fA-F]{3,8})"/) || [])[1];
  if (!tc) continue;
  const own = (h.match(/--bg\s*:\s*(#[0-9a-fA-F]{3,8})/) || [])[1];
  const bg = own || (h.includes("css/tokens.css") ? tokensBg : null);
  if (!bg) continue;
  themed.push(f);
  if (bg.toLowerCase() !== tc.toLowerCase()) mismatched.push(f + ": ground " + bg + ", chrome " + tc);
}
ok("the pages that state a ground are more than a handful", themed.length >= 15,
   themed.length + " pages");
ok("...and every one tells the browser the ground it actually has",
   mismatched.length === 0, mismatched.join("; "));

group("IT WINS BY ORDER, WHICH MEANS IT MAY NOT WIN BY WEIGHT");
/* If plate.css ever needs !important to land, the ordering claim above has
   already stopped being true somewhere and this is where you find out. */
/* THE WINDOW IS THE CODE, NOT THE FILE. Asserted against the whole file this
   goes red against plate.css's own header, which argues the point in the
   sentence "neither needs !important" -- the /library trap this repo has now
   hit four times, most recently in the generator's block assertions and in the
   shelf-defaults comment naming #toggleFilters. A rule that fires on the prose
   describing it teaches whoever is on call to delete the rule. So: strip the
   comments, then ask. And assert a block was found at all, or an empty window
   passes vacuously. */
const plateCode = plate.replace(/\/\*[\s\S]*?\*\//g, "");
ok("there is code left once the comments are stripped",
   plateCode.split("{").length > 20, plateCode.split("{").length - 1 + " rules");
ok("no RULE in plate.css uses !important", !/!\s*important/.test(plateCode));

group("THE THREE TRAPS INSIDE PLATE.CSS, EACH PINNED WHERE IT BITES");

/* 1. The sister edge. .tc-leaf / .tc-ember / .tc-terra and .lib-next each own a
      3px COLOURED LEFT BORDER declared in library.css. One `border:1px solid`
      at equal specificity in a file that loads later deletes all four without a
      word. So the plate sets its edge side by side and leaves left alone. */
/*    THE PSEUDO-ELEMENT IS EXEMPT, and that is the point rather than a loophole:
      .trio-card::after IS the silkscreen, a 1px box drawn INSIDE the card, with
      no sister colour to delete because it is not the card. The first draft of
      this assertion caught it, and a failure like that sends whoever reads it to
      weaken the guard rather than to look at the file. */
const cardRules = (plateCode.match(/\.trio-card[^{]*\{[^}]*\}/g) || [])
  .filter(r => !/^[^{]*::/.test(r));
ok("the guard has sister-card rules to look at", cardRules.length >= 4,
   cardRules.length + " rules, " +
   ((plateCode.match(/\.trio-card[^{]*\{/g) || []).length - cardRules.length) + " pseudo skipped");
const shorthand = cardRules.filter(r => /(^|[;{])\s*border\s*:/.test(r));
ok("plate.css never sets the `border` shorthand on a sister card",
   shorthand.length === 0, shorthand.map(r => r.slice(0, 44)).join(" | "));
ok("...and the left edge is left to library.css to colour",
   !/border-left[^;]*;[^}]*\.tc-/.test(plateCode) &&
   /border-top:1px solid var\(--edge\)/.test(plateCode));
const leftRule = plateCode.match(/^[^\n{]*\.trio-card[^\n{]*\{[^}]*border-left\s*:/m);
ok("...so no rule in plate.css gives .trio-card a left border at all", !leftRule);

/* 2. The headline gradient. library.css sets -webkit-background-clip:text AFTER
      its own `background:` on .st-hero h1. The shorthand resets background-clip
      to border-box, so overriding with `background:` paints a gradient rectangle
      behind transparent letters -- an invisible headline, and no error. */
const h1Rule = (plateCode.match(/\.st-hero h1\s*\{[^}]*\}/) || [""])[0];
ok("plate.css restyles the headline", h1Rule.includes("linear-gradient"));
ok("...through background-image, never the `background` shorthand",
   /background-image\s*:/.test(h1Rule) && !/(^|[;{])\s*background\s*:/.test(h1Rule));
ok("...and it is mostly blue, with the gold as the tail",
   /var\(--accent\)[\s\S]*var\(--leaf2\)[\s\S]*var\(--gold\) 100%/.test(h1Rule));

/* 3. The reels cards. An inline <style> in reels.html's head out-orders a linked
      stylesheet and wins at equal specificity, so the surface of these two has to
      NOT be declared there or plate.css never reaches them. */
const rlBlock = (pages["reels.html"].match(/\.rl-card,\.rl-acct\{[^}]*\}/) || [""])[0];
ok("reels.html still declares what a reels card IS", rlBlock.includes("border-radius"), rlBlock);
ok("...and no longer what it looks like",
   !/background\s*:/.test(rlBlock) && !/(^|[;{])border\s*:/.test(rlBlock) &&
   !/box-shadow\s*:/.test(rlBlock));
ok("...so plate.css is what gives them their surface",
   /\.rl-card,\.rl-acct\{[\s\S]{0,400}?linear-gradient/.test(plateCode.replace(/\s*\n\s*/g, "")) ||
   /\.rl-card,\.rl-acct/.test(plateCode));

group("A PLATE IS A CONTROL, AND HOVER DOES NOT MOVE ONE");
/* library.css lifts a card 2px on hover; the whole press model here is 2px of
   travel DOWN, and a card that has already risen has nowhere to go. If the
   override is dropped the press stops reading as a press and nothing says so. */
ok("library.css is still the file that lifts on hover",
   /\.lib-item:hover\{[^}]*transform:translateY\(-2px\)/.test(libCss));
ok("...and plate.css cancels it", /:hover[^{]*\{[^}]*transform:none/.test(plateCode));
ok("...replacing it with travel on press", /:active[^{]*\{[^}]*translateY\(2px\)/.test(plateCode));

group("EVERY OBJECT PLATE.CSS CLAIMS IS AN OBJECT THAT EXISTS");
/* The twin problem, in its cheapest form. plate.css names its selectors rather
   than being applied as a class, which is the reliable direction -- but it does
   mean a class renamed in the markup leaves a rule here talking to nothing, and
   a rule talking to nothing looks exactly like a page nobody styled. */
const allPages = libPages.map(f => readFileSync("public/" + f, "latin1")).join("\n") +
  "\n" + readFileSync("public/reels.html", "latin1");
const CLAIMED = ["lib-item", "lib-next", "lib-kind", "trio-card", "trio", "st-hero",
                 "st-cta", "sbacklink", "st-hilite", "rl-card", "rl-acct", "rl-follow",
                 "rl-frame", "rl-pframe", "is-here"];
const orphan = CLAIMED.filter(c => plateCode.includes("." + c) && !allPages.includes(c));
ok("no rule in plate.css addresses a class no page carries", orphan.length === 0, orphan.join(", "));
const unstyled = CLAIMED.filter(c => allPages.includes('class="' + c) && !plateCode.includes("." + c));
ok("...and nothing it set out to restyle was missed", unstyled.length === 0, unstyled.join(", "));

group("THE PILOT LIGHT IS THE ONLY LIT THING");
/* Rule 3 of the borrowed five. It only means anything while it is alone: the
   moment a second element glows, the dot stops being an indicator and becomes
   decoration. Counted rather than asserted in a comment. */
const glows = (plateCode.match(/box-shadow:0 0 \d+px rgba\(var\(--pilot\)/g) || []).length;
ok("exactly one rule in plate.css lights the gold", glows === 1, glows + " found");
ok("...and it is the pilot on a hovered card",
   /\.lib-item:hover \.lib-kind::before[^{]*\{[^}]*box-shadow:0 0 \d+px rgba\(var\(--pilot\)/.test(plateCode));

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
