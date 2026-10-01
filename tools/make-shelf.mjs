/* tools/make-shelf.mjs — a satellite shelf, generated from public/index.html.
 *
 *   node tools/make-shelf.mjs --shelf devices
 *   node tools/make-shelf.mjs --all
 *
 * WHAT THIS REPLACES. /consumables, /devices and /international were three
 * hand-written pages of ~120KB each that fetched /api/products and then
 * rendered their own cards, their own store and category filters, their own
 * sort, their own cart drawer and their own checkout link. None of the engine.
 * So every improvement to the shelf -- the three rails, the card flip, the
 * full-screen photo viewer, the sentences on the back, the price-per-gram
 * ranking, the eight gear buckets -- stopped at `/` and never reached them.
 * Four copies of storeCheckoutUrl() is what this repo does when a rule gets
 * restated instead of shared; these pages were four copies of a whole SITE.
 *
 * THE SLICE IS THE ONLY DIFFERENCE, and it lives in api/shelves.js. Same shape
 * as tools/make-coldwater.mjs and the same argument as ONE_CORE.md: a page that
 * differs from `/` by one predicate should be `/` plus one predicate.
 *
 * HOW THE SLICE IS APPLIED. A fetch shim repoints /api/products to
 * /api/products?shelf=<slug> before the engine asks, exactly as cw-endpoint
 * repoints it to /api/coldwater on a city page. The engine never learns it is
 * on a shelf; it is handed a smaller catalogue and behaves identically. That
 * also means the page stops downloading ~7MB to hide most of it.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. The cart. `/` and these pages share
 * localStorage["ll_cart"] and say "Add to Legal-Leaf Cart", and they check out
 * at the vendor -- which is the OPPOSITE of a city page, where there is no cart
 * and the wording is "Add to Shopping List". Generating these from index.html
 * inherits the hemp behaviour for free, which is the correct half of that
 * divergence; tools/make-coldwater.mjs is where the other half is asserted.
 *
 * ENCODING, per CLAUDE.md §5a. Read and written as ISO-8859-1 both ways, and
 * the non-ASCII inventory and CRLF count of the result are asserted against the
 * source. The base64 engine line is never touched -- it is not even in
 * index.html any more, which loads /engine.js.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { SHELVES, shelfFor } from "../api/shelves.js";

const ENC = "latin1";                    // Node's name for ISO-8859-1, byte-preserving
const SRC = "public/index.html";

const arg = name => {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : null;
};
const ALL = process.argv.includes("--all");
const CHECK = process.argv.includes("--check");

const wanted = ALL ? SHELVES : [shelfFor(arg("shelf") || "")].filter(Boolean);
if (!wanted.length) {
  console.error("usage: node tools/make-shelf.mjs --shelf <" +
                SHELVES.map(s => s.slug).join("|") + "> | --all");
  process.exit(2);
}

const src = readFileSync(SRC, ENC);
if (src.charCodeAt(0) === 0xFEFF) { console.error("FAIL: source carries a BOM"); process.exit(1); }
const nonAscii = s => { let n = 0; for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 127) n++; return n; };
const crlf = s => (s.match(/\r\n/g) || []).length;
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let bad = 0;
for (const shelf of wanted) {
  const out = build(shelf);
  const checks = verify(shelf, out);
  const failed = checks.filter(c => !c[1]);
  for (const [name, okv, note] of checks) {
    console.log((okv ? "  ok    " : "  FAIL  ") + name + (note ? "   (" + note + ")" : ""));
  }
  if (failed.length) { bad += failed.length; console.error(`${failed.length} check(s) failed for ${shelf.slug} — not writing.`); continue; }
  if (CHECK) { console.log(`(--check) ${shelf.slug} would be ${out.length} bytes`); continue; }
  writeFileSync("public/" + shelf.slug + ".html", out, ENC);
  console.log(`wrote public/${shelf.slug}.html — ${out.length} bytes\n`);
}
process.exit(bad ? 1 : 0);

/* ------------------------------------------------------------------ build --- */

function build(shelf) {
  const lines = src.split("\n");

  /* THE SHIM GOES IN <head> AND BEFORE ANY CALLER. public/js/feed-meta.js also
     wraps fetch, and it is loaded high in index.html's head -- so this must be
     installed AFTER it in source order to wrap it, exactly the way cw-endpoint
     wraps feed-meta on a city page. Then feed-meta's tap sees the repointed URL,
     which still begins /api/products, and publishes LL_META off the sliced
     catalogue: the rails get this shelf's stores, brands and category pool
     rather than the whole site's, which is what makes their counts honest. */
  const headIdx = lines.findIndex(l => l.trim() === "</head>");
  if (headIdx < 0) { console.error("FAIL: no standalone </head>"); process.exit(1); }
  lines.splice(headIdx, 0, shim(shelf));

  let out = lines.join("\n");

  /* ---- what the page says it is ----------------------------------------- */
  out = replaceOnce(out, /<title>[\s\S]*?<\/title>/, `<title>${esc(shelf.title)}</title>`, "title");
  out = replaceOnce(out, /<meta name="description" content="[^"]*"\s*\/?>/,
                    `<meta name="description" content="${esc(shelf.description)}"/>`, "meta description");
  /* Canonical must move or three pages declare themselves to be the homepage,
     which is the one SEO mistake that costs all of them at once. */
  out = replaceOnce(out, /<link rel="canonical" href="[^"]*"\s*\/?>/,
                    `<link rel="canonical" href="https://legal-leafmarket.com/${shelf.slug}"/>`, "canonical");
  return out;
}

function replaceOnce(s, re, to, what) {
  const m = s.match(re);
  if (!m) { console.error("FAIL: could not find the " + what); process.exit(1); }
  return s.slice(0, m.index) + to + s.slice(m.index + m[0].length);
}

function shim(shelf) {
  return `<script id="ll-shelf">
/* THIS PAGE IS ONE SLICE OF /api/products, and nothing else differs.
   Generated by tools/make-shelf.mjs from public/index.html -- do not edit this
   file, edit the source and regenerate. The slice is declared in
   api/shelves.js and applied SERVER-SIDE: the shim below only rewrites the url.

   WHY A SHIM RATHER THAN A CLIENT FILTER. The engine's product list is
   closure-scoped inside the blob (CLAUDE.md section 5), so there is nothing to
   filter after the fact -- and filtering behind the engine's back would leave
   its own facet counts describing a catalogue the shopper cannot see, which is
   the failure every rail is written to avoid. Repointing the request means the
   engine, the rails, the filters and the counts are all looking at the same
   thing. It is also ~7MB smaller.

   INSTALLED AFTER public/js/feed-meta.js so it WRAPS it: feed-meta's tap fires
   on the repointed url (still /api/products...), so LL_META is built from this
   shelf's rows and the rails count this shelf's stores and brands. Installed
   before the engine, which is why this is a plain script in <head>. */
(function(){
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  var SHELF = ${JSON.stringify(shelf.slug)};
  window.LL_SHELF = { slug: SHELF, label: ${JSON.stringify(shelf.label)} };
  var real = window.fetch;
  function repoint(u){
    if (typeof u !== "string") return null;
    var s = u;
    if (s.indexOf(location.origin) === 0) s = s.slice(location.origin.length);
    if (s.indexOf("/api/products") !== 0) return null;
    if (s.indexOf("shelf=") > -1) return null;          // already ours
    return s + (s.indexOf("?") > -1 ? "&" : "?") + "shelf=" + encodeURIComponent(SHELF);
  }
  window.fetch = function(input, init){
    try {
      if (typeof input === "string") {
        var s = repoint(input);
        if (s) return real.call(this, s, init);
      } else if (input && typeof input.url === "string") {
        var r = repoint(input.url);
        /* A Request is immutable, so it is rebuilt rather than mutated -- and
           only the fields that matter here, because copying a Request wholesale
           drags a consumed body along with it. */
        if (r) return real.call(this, new Request(r, input));
      }
    } catch (e) {}
    return real.call(this, input, init);
  };
})();
</script>
<script id="ll-shelf-head">
/* The heading, replaced rather than rebuilt: the engine's own hero markup is
   what index.html ships and this only changes the words in it. Runs on
   DOMContentLoaded because the h1 is in the static markup, not the engine's. */
(function(){
  function paint(){
    var h = document.querySelector("h1.bigtitle");
    if (h) h.innerHTML = ${JSON.stringify(shelf.heading)};
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
})();
</script>`;
}

/* Where the engine starts, whichever form it is in: the inline base64 blob
   that index.html ships, or the extracted file a city page loads. */
function engineAt(out) {
  const tag = out.indexOf('src="/engine.js"');
  if (tag > -1) return tag;
  return out.indexOf('var B="');
}

/* ----------------------------------------------------------------- verify --- */

function verify(shelf, out) {
  const inShim = out.slice(out.indexOf('id="ll-shelf"'), out.indexOf("</script>", out.indexOf('id="ll-shelf"')));
  return [
    /* THE ENCODING RULES OF CLAUDE.md §5a, asserted rather than trusted. A
       re-encode that mangles the meta tags is invisible in a diff, which is
       exactly why commit 238420e shipped mojibake to production undetected. */
    ["non-ASCII inventory matches the source", nonAscii(out) === nonAscii(src),
      nonAscii(out) + " vs " + nonAscii(src)],
    ["CRLF count matches the source", crlf(out) === crlf(src), crlf(out) + " vs " + crlf(src)],
    ["no BOM was introduced", out.charCodeAt(0) !== 0xFEFF, ""],

    ["the shelf shim is present once", (out.match(/id="ll-shelf"/g) || []).length === 1, ""],
    ["...and names this shelf", inShim.includes(JSON.stringify(shelf.slug)), shelf.slug],
    /* The ordering that makes the rails count this shelf rather than the site:
       feed-meta.js taps fetch first, so the shim must be installed after it. */
    ["...after feed-meta.js, so it wraps it rather than being wrapped",
      out.indexOf('src="/js/feed-meta.js"') > -1 &&
      out.indexOf('src="/js/feed-meta.js"') < out.indexOf('id="ll-shelf"'), ""],
    /* index.html still boots the engine from its inline base64 blob -- it is
       tools/make-coldwater.mjs that swaps that for <script src="/engine.js">,
       and a shelf is generated from the SOURCE, so the blob comes with it. The
       ordering that matters is the same either way: the shim must be installed
       before whatever asks for the feed. */
    ["...and before the engine, which asks on boot",
      out.indexOf('id="ll-shelf"') < engineAt(out), "shim " + out.indexOf('id="ll-shelf"') + " < engine " + engineAt(out)],
    /* THE THIRD WRAPPER, and it goes at the bottom of the stack. feed-cache.js
       answers this same path from the last visit's catalogue, and it is keyed on
       the full URL precisely because a shelf slice and the whole shelf differ
       only by the query this shim adds. Installed the other way round it would
       sit above feed-meta and the rails would count a catalogue that is not on
       screen; see its header. Asserted here because this file is where the
       ordering is easiest to break by accident. */
    ["feed-cache.js is under feed-meta.js, which is under this shim",
      out.indexOf('src="/js/feed-cache.js"') > -1 &&
      out.indexOf('src="/js/feed-cache.js"') < out.indexOf('src="/js/feed-meta.js"'), ""],

    ["the title is this shelf's", out.includes("<title>" + esc(shelf.title) + "</title>"), ""],
    ["the canonical points at this shelf, not the homepage",
      out.includes('href="https://legal-leafmarket.com/' + shelf.slug + '"'), ""],
    ["...and no second canonical survives", (out.match(/rel="canonical"/g) || []).length === 1, ""],
    ["the heading is this shelf's", out.includes(JSON.stringify(shelf.heading)), shelf.heading],

    /* THE DIVERGENCE, ASSERTED FROM THIS SIDE. A city page says "Add to
       Shopping List" and has no checkout; a hemp shelf keeps the cart. These
       pages are generated from index.html, so they inherit it -- and this check
       is what notices if a future edit to the source takes it away. */
    ["the Legal-Leaf cart is inherited, not replaced", /Add to Legal-Leaf Cart/.test(out), ""],
    /* SCOPED TO THE MARKUP, NOT THE FILE. index.html's ll-cart-label block
       argues about "Add to Shopping List" BY NAME in a comment explaining why
       the wording differs on a city page -- so a whole-file search goes red
       against the prose describing the very divergence it is asserting. Same
       trap as the /library check and the shelf-defaults block. The honest
       question is whether any city-page block travelled here. */
    ["...and this is not a city page", !/id="cw-[a-z-]+"/.test(out), ""],

    /* Everything the satellites could not have. Cheap to assert and each one is
       a feature that used to stop at `/`. */
    ["the engine comes with it", engineAt(out) > 0, "at " + engineAt(out)],
    ["the three rails come with it", out.includes('src="/js/rails.js"'), ""],
    ["the photo viewer too", out.includes('src="/js/photo-view.js"'), ""],
    ["and the gear buckets", out.includes('src="/js/gear-categories.js"'), ""],
  ];
}
