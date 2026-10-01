/* Proves public/ig-studio.html edits and exports the same slides the CLI renders.
 *
 * THE CENTRAL ASSERTION IS BYTE EQUALITY between the document the studio feeds its
 * preview iframe and the .html the CLI writes to disk for the same slide. Both
 * import public/js/ig-slides-data.js, but each builds the surrounding markup in its
 * own file -- one writing to disk, one to an iframe, neither able to import the
 * other's runtime. That is the one genuine twin here, so it is the one pinned. A
 * suite that only checked "the page renders seven slides" would pass happily while
 * the studio drew a deck nobody could reproduce from the repo.
 *
 * The rest guards the export path, which fails SILENTLY by nature: an SVG
 * foreignObject carrying markup that is not well-formed XML never fires onload, so
 * a broken slide looks like a slow one.
 */
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";
import { POSTS } from "./public/js/ig-slides-data.js";

process.env.LL_NO_STORE_FETCH = "1";
const CHROME = chromePath();
const PORT = 3489, CDP = 9378;
const OUT = "/tmp/_igstudio_cli";
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* The CLI's own output, produced by the real tool rather than described here. */
rmSync(OUT, { recursive: true, force: true });
const cli = spawnSync(process.execPath, ["tools/make-ig-slides.mjs", "post1", OUT], { encoding: "utf8" });
if (cli.status !== 0) { console.error("the CLI renderer failed, so there is nothing to compare against:\n" + cli.stderr); process.exit(1); }

const srv = spawn(process.execPath, ["server.mjs"], { env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_igs" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find(x => x.type === "page"); if (!p) throw 0; return p; });
await until(() => fetch(`http://127.0.0.1:${PORT}/ig-studio`).then(r => { if (!r.ok) throw 0; return r }));

const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const p = new Map(); const errs = [];
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id) }
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; p.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
const evp = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
/* The proxies here refuse Google Fonts and a render-blocking link stalls ~13s,
   which reads as the page being broken. Same two lines every browser suite wants. */
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*"] });
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/ig-studio` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
/* CLEAR THE DRAFT BEFORE ASSERTING ANYTHING. The chrome profile at --user-data-dir
   outlives the run, and this page persists edits to localStorage on purpose -- so a
   previous run's typing is still there on the next one, and the byte-equality check
   fails against copy this suite itself wrote. The first draft of this file did
   exactly that, which is the same trap test-collector-remix.mjs documents for the
   collector's 18-hour batch. */
await ev(`localStorage.removeItem('ll_ig_studio')`);
await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/ig-studio` });
await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0 });
await until(async () => { if (await ev(`!!window.__IG_STUDIO__`)) return true; throw 0 });
ok("the suite starts from a clean draft, not a previous run's",
  await ev(`!localStorage.getItem('ll_ig_studio')`));

console.log("\nthe page stands up");
ok("the module loaded and exposed its seam", await ev(`!!window.__IG_STUDIO__`));
ok("no uncaught exception on load", errs.length === 0, errs[0] || "");
/* Counted from the data module rather than written as a literal: a hardcoded 3
   failed the moment posts 4 and 5 landed, which is the suite complaining about
   the deck growing rather than about anything being wrong. */
ok("every post in the shared data is offered",
  await ev(`document.querySelectorAll('#post option').length`) === Object.keys(POSTS).length,
  `${Object.keys(POSTS).length} posts`);
ok("post1 rendered a row per slide", await ev(`document.querySelectorAll('.slide-row').length`) === 7);
ok("each row previews in its own iframe",
  await ev(`[...document.querySelectorAll('.slide-row iframe')].every(f=>(f.srcdoc||'').includes('class="slide"'))`));

console.log("\nthe studio and the CLI draw the SAME document");
for (const i of [0, 3, 6]) {
  const fromCli = readFileSync(`${OUT}/post1/post1-slide-${i + 1}.html`, "utf8");
  const fromPage = await ev(`window.__IG_STUDIO__.slideDoc('post1',${i})`);
  ok(`slide ${i + 1} is byte-identical to the CLI's file`, fromPage === fromCli,
    fromPage === fromCli ? `${fromCli.length} bytes` : "the two renderers have drifted");
}

console.log("\nexport produces a real PNG at full size");
const png = await evp(`(async()=>{
  const b = await window.__IG_STUDIO__.slideToPng('post1',0);
  const u = new Uint8Array(await b.arrayBuffer());
  return [u.length, Array.from(u.slice(0,8)).join(','), b.type].join('|');
})()`);
const [bytes, magic, mime] = String(png).split("|");
ok("the blob is a PNG by magic number", magic === "137,80,78,71,13,10,26,10", magic);
ok("it is image/png", mime === "image/png", mime);
ok("and it is not a blank stub", Number(bytes) > 8000, `${bytes} bytes`);

/* A slide is 1080x1350; read it back out of the IHDR rather than trusting the canvas. */
const dims = await evp(`(async()=>{
  const b = await window.__IG_STUDIO__.slideToPng('post1',0);
  const u = new Uint8Array(await b.arrayBuffer());
  const dv = new DataView(u.buffer);
  return dv.getUint32(16)+'x'+dv.getUint32(20);
})()`);
ok("the exported PNG is 1080x1350", dims === "1080x1350", dims);

console.log("\nthe exported pixels are actually the deck's pixels");
/* THIS IS THE ASSERTION THAT WAS MISSING, and its absence shipped three unreadable
   slides. The old checks -- 1080x1350, PNG magic, byte count -- all passed against
   an export whose every h1 was BLACK ON BLACK, because colour and font-family sat
   on body{} and the SVG foreignObject the exporter builds has no <body> for that
   rule to match. Byte count cannot see it: black text on a dark ground still
   compresses to half a megabyte. So this counts light pixels, which is the
   cheapest thing that distinguishes a legible slide from a dark rectangle. */
const light = await evp(`(async()=>{
  const b = await window.__IG_STUDIO__.slideToPng('post1', 0);   // slide 1 is an h1 headline
  const bmp = await createImageBitmap(b);
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] > 200 && d[i+2] > 200) n++;
  return n;
})()`);
ok("the headline is drawn in light type, not inherited black",
  Number(light) > 5000, `${light} light pixels`);

console.log("\nmarkup a model reaches for does not arrive in browser colours");
/* The reset zeroes margin and padding and never COLOUR, so every element the browser
   ships with a colour of its own kept it: <a> link-blue, <mark> black on yellow,
   button/input black on white. Hand-written slides never used those, which is why it
   went unseen -- but a DRAFT is HTML written by a model, and a model reaches for <a>
   to carry a source and <mark> to emphasise. Reported from a real slide as "black and
   therefore unreadable". Asserted on computed colour rather than pixels because the
   failure is per-element and a pixel count cannot say WHICH element went dark. */
const inks = await evp(`(async()=>{
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;left:-9999px;width:1080px;height:1350px';
  document.body.appendChild(f);
  f.srcdoc = window.__IG_STUDIO__.slideDoc('post1', 0).replace(
    '</div></div>',
    '<p><a href="#">a</a> <mark>mark</mark> <code>code</code> <button>b</button>' +
    '<input value="i"><em>em</em></p></div></div>');
  await new Promise(r => f.onload = r);
  const d = f.contentDocument, out = {};
  for (const sel of ['a','code','button','input','em','p']) {
    const el = d.querySelector('.slide ' + sel);
    out[sel] = el ? getComputedStyle(el).color : 'missing';
  }
  const m = d.querySelector('.slide mark');
  out.markInk = getComputedStyle(m).color; out.markBg = getComputedStyle(m).backgroundColor;
  f.remove();
  return JSON.stringify(out);
})()`);
const ink = JSON.parse(String(inks));
/* Compared against the PARENT's colour, not a constant. These sit inside a <p>, which
   the deck sets to its muted ink -- so inheriting correctly means matching the <p>,
   and asserting a fixed #eaf3ec failed against code that was right. The property is
   "takes its colour from context", which is what inherit means and what the browser
   defaults break. */
for (const el of ["a", "code", "button", "input", "em"]) {
  ok(`<${el}> inherits its colour instead of the browser's`, ink[el] === ink.p,
    `${el}: ${ink[el]} vs parent ${ink.p}`);
}
ok("and that colour is one of the deck's own",
  ink.p === "rgb(159, 182, 166)", ink.p);
/* mark keeps a real highlight rather than being flattened -- it MEANS highlighted --
   so it is checked for being the deck's own pairing, not for matching body ink. */
ok("<mark> is a brand highlight, not black on yellow",
  ink.markInk === "rgb(11, 18, 13)" && ink.markBg === "rgb(240, 185, 60)",
  `${ink.markInk} on ${ink.markBg}`);

console.log("\nsloppy copy is repaired the same way the CLI's browser repairs it");
/* The export path parses as HTML before serialising as XML, so an unclosed tag is
   CLOSED rather than rejected -- which is exactly what Chromium does to the same
   string when the CLI screenshots it. That agreement is the point: a studio that
   refused markup the CLI happily renders would send somebody hunting a bug that
   only exists in one of the two. The onerror path stays as a backstop for whatever
   this parse cannot repair; it is not the common case and must not be relied on to
   catch typos. */
const sloppy = await evp(`(async()=>{
  const ta = document.querySelector('.slide-row textarea');
  ta.value = '<div class="num">unclosed';
  ta.dispatchEvent(new Event('input'));
  try {
    const b = await window.__IG_STUDIO__.slideToPng(document.querySelector('#post').value, 0);
    const u = new Uint8Array(await b.arrayBuffer());
    const dv = new DataView(u.buffer);
    return 'exported ' + dv.getUint32(16) + 'x' + dv.getUint32(20) + ' ' + u.length;
  } catch (e) { return 'rejected: ' + e.message; }
})()`);
ok("an unclosed tag is repaired and still exports at full size",
  String(sloppy).startsWith("exported 1080x1350"), String(sloppy).slice(0, 60));
ok("the raw text is kept verbatim in the document, repair happening only at export",
  (await ev(`window.__IG_STUDIO__.slideDoc('post1',0)`)).includes('<div class="num">unclosed'));

console.log("\nnon-ASCII is encoded at the door, so the data file stays ASCII");
const enc = await ev(`(()=>{
  const ta = document.querySelector('.slide-row textarea');
  ta.value = '<p>Budd\\u2019s line \\u2014 verbatim</p>';   // smart quote + em dash, as pasted
  ta.dispatchEvent(new Event('input'));
  return JSON.parse(localStorage.getItem('ll_ig_studio')).post1[0].body;
})()`);
ok("a pasted smart quote and em dash are stored as entities",
  enc === "<p>Budd&#8217;s line &#8212; verbatim</p>", enc);
ok("nothing above ASCII survives into the stored copy", !/[^\x00-\x7F]/.test(String(enc)));

console.log("\nedits are persisted, and only the edited field");
const persisted = await ev(`(()=>{ const e=JSON.parse(localStorage.getItem('ll_ig_studio')||'{}');
  return JSON.stringify(Object.keys(e.post1?.[0]||{})); })()`);
ok("only the field that was typed in is stored", persisted === '["body"]', persisted);
ok("an untouched slide keeps following the repo",
  await ev(`!JSON.parse(localStorage.getItem('ll_ig_studio')||'{}').post1?.[1]`));

srv.kill(); ch.kill(); rmSync(OUT, { recursive: true, force: true });
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nAll assertions passed.");
process.exit(fails.length ? 1 : 0);
