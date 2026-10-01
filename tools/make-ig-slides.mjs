/* tools/make-ig-slides.mjs — render the Instagram carousel slides in HEMP_LAW_IG_CONTENT.md
 * as 1080x1350 PNGs.
 *
 *   node tools/make-ig-slides.mjs              # lists the posts it knows
 *   node tools/make-ig-slides.mjs post1        # -> out/ig/post1/post1-slide-N.png
 *   node tools/make-ig-slides.mjs post2 build  # same, under build/
 *
 * WHY A GENERATOR AND NOT SEVEN IMAGE FILES. The slides state vote counts and
 * dates, and the whole point of the pack is that those move weekly -- the House
 * had not voted when this was written, so slides carrying "November 12 is still
 * the law" become WRONG rather than merely stale the moment it does. Committing
 * only PNGs would mean rebuilding the design to change a numeral. The copy is
 * data in public/js/ig-slides-data.js, so a changed vote is a one-line edit and a
 * re-run, and the seven slides cannot drift apart from each other while it
 * happens. That file is SHARED with public/ig-studio.html, which edits and exports
 * the same slides in a browser -- read its header before moving anything into
 * here, since a second copy of the copy is the failure it exists to prevent.
 *
 * THE BROWSER COMES FROM chrome-path.mjs, NOT FROM A LITERAL. That file exists
 * because five suites had `/opt/pw-browsers/chromium-1194/...` baked in and would
 * break silently on a build bump; do not reintroduce the literal here.
 *
 * FONTS ARE SYSTEM FONTS AND THAT IS A CONSTRAINT, NOT A CHOICE. The proxies in
 * the containers this repo is edited from refuse fonts.googleapis.com -- the same
 * refusal test-coldwater.mjs blocks at the network layer (CLAUDE.md section 10).
 * A webfont <link> here would not fail loudly, it would silently fall back mid-
 * render and change every line break in the deck. Liberation Sans is Arial-metric
 * and present in both this container and GitHub's runner. If a licensed display
 * face is ever added to the repo, embed it as a data: URI rather than a URL.
 *
 * DASHES ARE NOT INTERCHANGEABLE AND BOTH KINDS ARE DELIBERATE HERE. A vote count
 * is a range and takes an en dash (90&#8211;6, 61&#8211;32); a compound modifier
 * takes a hyphen (Senate-passed, R-NC). The first cut of these slides set both as
 * en dashes, which no test can catch and which reads as a typo at 96px.
 *
 * PROPORTIONS ARE DRAWN TRUE. Post 2's comparison slide puts 0.4 mg beside 5 mg at
 * real scale, so the ban's bar is 8% of the other's. That sliver IS the argument;
 * a minimum-width bar or a broken axis would be a nicer picture of a weaker claim,
 * and this is a slide about a number being unreasonable.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import chromePath from "./chrome-path.mjs";
/* Copy and styling are SHARED with public/ig-studio.html -- see the header of
   that file for why they are not restated here. */
import { W, H, CSS, POSTS } from "../public/js/ig-slides-data.js";

function page(slide, i, total) {
  const dots = Array.from({ length: total }, (_, j) =>
    `<span class="dot${j === i ? " on" : ""}"></span>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="slide">
  <div class="eyebrow">${slide.eyebrow}</div>
  <div class="body-area">${slide.body}</div>
  <div class="foot">
    <span class="handle">@legal_leaf_market</span>
    <span class="dots">${dots}</span>
    <span>${i + 1} / ${total}</span>
  </div>
</div></body></html>`;
}

const key = process.argv[2];
const outRoot = process.argv[3] || "out/ig";

if (!key || !POSTS[key]) {
  console.error(
    (key ? `Unknown post "${key}".\n\n` : "Render one post's carousel to PNG.\n\n") +
    "Usage: node tools/make-ig-slides.mjs <post> [outDir]\n\nKnown posts:\n" +
    Object.entries(POSTS).map(([k, p]) => `  ${k}  ${p.title} (${p.slides.length} slides)`).join("\n"));
  process.exit(key ? 2 : 0);
}

const post = POSTS[key];
const dir = resolve(outRoot, key);
mkdirSync(dir, { recursive: true });
const chrome = chromePath();

post.slides.forEach((slide, i) => {
  const n = i + 1;
  const html = resolve(dir, `${key}-slide-${n}.html`);
  const png = resolve(dir, `${key}-slide-${n}.png`);
  writeFileSync(html, page(slide, i, post.slides.length), "utf8");
  const r = spawnSync(chrome, [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=1", `--window-size=${W},${H}`,
    `--screenshot=${png}`, `file://${html}`,
  ], { stdio: "ignore" });
  if (r.status !== 0) { console.error(`slide ${n}: chrome exited ${r.status}`); process.exit(1); }
  console.log(`  ${png}`);
});

console.log(`\n${post.slides.length} slides for ${key} (${post.title}) at ${W}x${H}.`);
