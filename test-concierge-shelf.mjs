/* test-concierge-shelf.mjs — the budtender knows which shelf the shopper is on.
 *
 * REPORTED AS "still failing", with a screenshot whose URL bar is the whole bug:
 * legal-leafmarket.com/consumables, four blue bongs pinned, banner reading
 *
 *     Blue Bongs - Four Styles -- showing 0 of 4
 *     could not place: Chill - Matte Baby Blue Bong, ... -- ask me about them by name
 *
 * and the chat saying "the rest are deeper in the shelf than I can page to".
 *
 * NONE OF THAT WAS TRUE, AND THE PREVIOUS FIX MADE IT WORSE BY BEING CONFIDENT.
 * api/shelves.js slices /consumables to the complement of `cannabinoid ===
 * "Accessory"`, so those four bongs could not be on that grid at ANY depth. The
 * sweep only ever sees cards, so it cannot tell "absent" from "further down" --
 * and it reported the one thing it could, which sent the shopper off to search by
 * hand for something that was never going to be there. A wrong diagnosis is worse
 * than a missing one.
 *
 * So the answer travels with the pin. api/concierge.js stamps each pinned item
 * with the shelves it belongs to, and the page compares that against its own
 * window.LL_SHELF -- which tools/make-shelf.mjs has published on every generated
 * slice all along.
 *
 * THREE CLAIMS, AND THE THIRD IS THE ONE THAT KEEPS THE OTHER TWO HONEST:
 *
 *   1. On a slice, an off-shelf pin says where the thing IS and offers the move,
 *      and leaves the shelf the shopper is on alone -- no filters cleared, no
 *      search typed, nothing hidden. `here: 0, away: 4` in the diagnostic is what
 *      separates "this page cannot hold them" from "I did not page far enough";
 *      the click count beside it is an anchor rather than a discriminator, since
 *      a needle that matches nothing also leaves nothing to click.
 *   2. The move carries the set: land on /devices and the four are pinned there.
 *   3. NOTHING CHANGES ON `/` OR ON A SHELF THAT CAN HOLD THE THING. The
 *      homepage has no LL_SHELF, so nothing is ever off-shelf and the old sweep
 *      runs exactly as before; a mixed pin on /consumables still places the
 *      flower. Without those, this whole feature could be replaced by "always
 *      say it is on another shelf" and every other assertion would still pass.
 *
 * Verified against the unfixed code: with the shelf split removed the suite
 * reports `showing 0 of 4` and `could not place`, which is the live screenshot.
 *
 *     node test-concierge-shelf.mjs
 */
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const PORT = 3551, CDP = 9669;
const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, n = 120) { for (let i = 0; i < n; i++) { try { return await fn() } catch { await wait(250) } } throw new Error("timeout") }

/* ------------------------------------------------------------------ *
 * 1. The server half, driven directly                                 *
 * ------------------------------------------------------------------ */

const { _internals } = await import("./api/concierge.js");
const { shelvesOf, runTool } = _internals;
const { shelfFor } = await import("./api/shelves.js");
const { heatOf } = await import("./api/heat.js");

console.log("\nWhat shelf is a thing on\n");

const gear = (i, name) => {
  const p = { id: "g" + i, name, store: "Chill Steel Pipes", storeKey: "chill", domain: "e.test",
    platform: "shopify", cannabinoid: "Accessory", category: "Bongs & Rigs", type: "", strain: "",
    image: "/favicon.svg", gallery: [], url: "https://e.test/g" + i, brand: "Chill", brandKey: "chill",
    description: "Glass.", inStock: true, startsAt: 60 + i, sale: 60 + i, ship: 0, badges: [], intl: false,
    sizes: [["One Size", 60 + i, 0, "g" + i + "a", true, "https://e.test/g" + i, "", 0]] };
  p.heat = heatOf(p); return p;
};
const bud = (i, name) => {
  const p = { id: "f" + i, name, store: "Black Tie", storeKey: "blacktiecbd", domain: "e.test",
    platform: "shopify", cannabinoid: "THCa", category: "THCA Flower", type: "Indica", strain: name,
    image: "/favicon.svg", gallery: [], url: "https://e.test/f" + i, brand: "BT", brandKey: "bt",
    description: "Flower.", inStock: true, startsAt: 30 + i, sale: 30 + i, ship: 0, badges: [], intl: false,
    potency: 24, perG: 1.2 + i / 100,
    sizes: [["28g", 30 + i, 0, "f" + i + "a", true, "https://e.test/f" + i, "", 28]] };
  p.heat = heatOf(p); return p;
};

const BONGS = [
  gear(1, "Chill - Mix & Match Series - Matte Baby Blue Bong"),
  gear(2, "Chill - Limited Edition - Blue Ombre Bong"),
  gear(3, "Chill - Limited Edition - Steel Blue Rubberized Bong"),
  gear(4, "Queen Blue Glass Beaker Bong"),
];
const BUDS = [bud(1, "Durban Poison"), bud(2, "Blue Dream")];

/* THE STRUCTURAL CLAIM THIS WHOLE SUITE RESTS ON. If a bong were ever on
   /consumables the live report would have been a depth bug after all, and every
   assertion below would be measuring the wrong thing. */
const bongShelves = shelvesOf(BONGS[0]);
ok("a bong is NOT on the consumables shelf", !bongShelves.includes("consumables"), JSON.stringify(bongShelves));
ok("...it is on devices", bongShelves.includes("devices"), JSON.stringify(bongShelves));
ok("...and on combustion, since you light it", bongShelves.includes("combustion"), JSON.stringify(bongShelves));
const budShelves = shelvesOf(BUDS[0]);
ok("flower IS on consumables", budShelves.includes("consumables"), JSON.stringify(budShelves));
ok("...and on neither heat shelf, because it is not a device",
   !budShelves.includes("combustion") && !budShelves.includes("vaporizers"), JSON.stringify(budShelves));

/* THE REAL pin_products HANDLER, not a restatement of it. */
const CAT = [...BONGS, ...BUDS];
const ctxOn = (slug) => ({ products: CAT, actions: [], shelf: shelfFor(slug) });

const cCons = ctxOn("consumables");
const rCons = await runTool("pin_products", { ids: BONGS.map((p) => p.id), title: "Blue bongs" }, cCons);
const itemsCons = cCons.actions[0].items;
ok("the pin action stamps the shelves each listing lives on",
   itemsCons.every((i) => Array.isArray(i.shelves) && i.shelves.includes("devices")), JSON.stringify(itemsCons[0]));
ok("the tool result tells the model all four are off this shelf",
   rCons.offShelf && rCons.offShelf.length === 4 && rCons.currentShelf === "consumables",
   JSON.stringify((rCons.offShelf || []).length));
ok("...and names the shelf they are on", /Devices & Misc/.test(rCons.note), rCons.note.slice(-140));
/* THE SENTENCE THAT MUST NOT BE PRODUCED. "We do not carry it" is the one a
   shopper acts on by leaving. */
ok("...and forbids saying they are unavailable", /never say they are/i.test(rCons.note));

const cDev = ctxOn("devices");
await runTool("pin_products", { ids: BONGS.map((p) => p.id), title: "Blue bongs" }, cDev);
const rDev = await runTool("pin_products", { ids: BONGS.map((p) => p.id), title: "Blue bongs" }, cDev);
ok("on the shelf they DO live on, nothing is off-shelf", !rDev.offShelf, JSON.stringify(rDev.offShelf || null));

const cHome = { products: CAT, actions: [], shelf: null };
const rHome = await runTool("pin_products", { ids: BONGS.map((p) => p.id), title: "Blue bongs" }, cHome);
ok("and on `/`, where there is no shelf, nothing is off-shelf either", !rHome.offShelf);

/* THE PROMPT HAS TO CARRY IT TOO, or the model keeps recommending blind. */
const sysCons = _internals.systemFor("budtender", false, { updated: "x", stores: [] }, shelfFor("consumables"));
ok("the system prompt names the shelf the shopper is on", /CONSUMABLES SHELF \(\/consumables\)/.test(sysCons));
ok("...says what it does not hold", /no bongs, pipes, grinders/i.test(sysCons));
ok("...and still tells it to search the whole catalogue",
   /entire catalogue regardless/.test(sysCons) && /Never tell someone we do not sell/.test(sysCons));
const sysHome = _internals.systemFor("budtender", false, { updated: "x", stores: [] }, null);
ok("on `/` the prompt says nothing about shelves at all", !/SHELF \(\//.test(sysHome));

/* ------------------------------------------------------------------ *
 * 2. The page half, in real Chromium                                  *
 * ------------------------------------------------------------------ */

/* FILLER SO THE GRID PAGES. Without it the whole catalogue renders at once,
   there is no `.loadmore`, and "the sweep did not walk the shelf" would be true
   for the wrong reason. */
const FILLER = Array.from({ length: 60 }, (_, i) => bud(100 + i, "Filler Strain " + i));
const ALL = [...BONGS, ...BUDS, ...FILLER];
const FEED = (rows) => ({
  meta: { updated: new Date(0).toISOString(), total: rows.length,
          stores: [{ name: "Chill Steel Pipes", count: 4 }, { name: "Black Tie", count: rows.length - 4 }] },
  products: rows,
});

const sse = (items, title) => [
  "event: text\ndata: " + JSON.stringify({ text: "Pinned those." }),
  "event: action\ndata: " + JSON.stringify({ tool: "pin_products", title,
    items: items.map((p) => ({ id: p.id, name: p.name, store: p.store, shelves: shelvesOf(p) })) }),
  "event: done\ndata: " + JSON.stringify({ stopReason: "end_turn", register: "budtender" }),
].join("\n\n") + "\n\n";

/* WHAT THE CHAT ASKS FOR, chosen per request so one browser run can drive the
   off-shelf case, the mixed case and the homepage control. */
let SCRIPT = sse(BONGS, "Blue Bongs - Four Styles");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const srv = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/api/concierge") {
    if ((req.method || "GET").toUpperCase() === "POST") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
      return res.end(SCRIPT);
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ reads: "calm", picks: [] }));
  }
  if (/products|market|coldwater/.test(u.pathname)) {
    /* THE SLICE IS SERVED, exactly as api/products.js serves it. Without this the
       bongs would be on the /consumables grid and this suite would be vacuous --
       it would pass against the bug. */
    const sh = shelfFor(u.searchParams.get("shelf") || "");
    const rows = sh ? ALL.filter((p) => sh.test(p)) : ALL;
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(FEED(rows)));
  }
  if (u.pathname.startsWith("/api/")) {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ p: {} }));
  }
  const f = u.pathname === "/" ? "index.html" : u.pathname.replace(/^\//, "");
  for (const c of [f, f + ".html"]) {
    try { const b = await readFile(join("public", c));
      res.writeHead(200, { "content-type": MIME[extname(c)] || "application/octet-stream", "cache-control": "no-store" });
      return res.end(b); } catch {}
  }
  res.writeHead(404).end("no");
});
await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));

const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_llconcshelf" });
const t = await until(async () => { const j = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); const p = j.find((x) => x.type === "page"); if (!p) throw 0; return p });
const s = new globalThis.WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => s.addEventListener("open", r));
let id = 0; const pend = new Map(); const errs = [];
s.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); s.send(JSON.stringify({ id: i, method, params })) });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
await send("Network.setBlockedURLs", { urls: ["*fonts.googleapis.com*", "*fonts.gstatic.com*", "*bigcartel.com*"] });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

async function goto(path) {
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}${path}` });
  await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)) > 0) return true; throw 0 }, 120);
  await wait(1200);
}
async function ask(text) {
  await ev(`(function(){ var f=document.querySelector('.llc-fab'); if(f) f.click(); })()`);
  await wait(500);
  await ev(`(function(){ var t=document.getElementById('llcIn'); if(t) t.value=${JSON.stringify(text)};
    var g=document.getElementById('llcGo'); if(g) g.click(); })()`);
  await wait(2500);
}
const barText = () => ev(`(document.getElementById("ll-pinbar")||{}).textContent || ""`);
const chatText = () => ev(`[].slice.call(document.querySelectorAll("#llcBody .llc-note")).map(function(n){return n.textContent}).join(" | ")`);

await goto("/");
await ev(`localStorage.setItem('ll_age_ok','1'); localStorage.setItem('ll_conc_reg','budtender')`);

/* ---------- the reported case ---------- */

console.log("\nFour bongs pinned while standing on /consumables\n");
await goto("/consumables");

const slug = await ev(`(window.LL_SHELF||{}).slug || ""`);
ok("the page knows it is a slice", slug === "consumables", JSON.stringify(slug));
const gearOnGrid = await ev(`document.querySelectorAll('#grid .card[data-pid^="g"]').length`);
ok("...and the slice really excludes the bongs, so this is not a vacuous run",
   gearOnGrid === 0, "gear cards on grid: " + gearOnGrid);
ok("the grid pages, so a sweep would have had somewhere to go",
   (await ev(`!!document.querySelector('#grid > .loadmore')`)) === true);

await ask("show me four blue bongs");
const bar1 = await barText();
const sweep1 = JSON.parse((await ev(`JSON.stringify(window.LL_pinLast||null)`)) || "null");
console.log("  sweep: " + JSON.stringify(sweep1));
console.log("  bar:   " + JSON.stringify(String(bar1).slice(0, 160)));

ok("the banner no longer claims 0 of 4", !/showing 0 of 4/.test(bar1), JSON.stringify(String(bar1).slice(0, 90)));
ok("...it says they are not on this shelf", /not on this shelf/.test(bar1));
ok("...counts them", /4 of these are not stocked on Consumables/.test(bar1), JSON.stringify(String(bar1).slice(0, 140)));
ok("...and names where they are", /they live on Devices & Misc/.test(bar1));
ok("it does not tell the shopper to go and search by name", !/could not place/.test(bar1));

/* THE PROOF IT IS A DIFFERENT DIAGNOSIS AND NOT A DIFFERENT SENTENCE. The old
   banner and the new one are both produced with `found: 0`; only the click count
   says whether the page understood why. */
ok("the sweep did not page the shelf at all", !!sweep1 && sweep1.clicks === 0, JSON.stringify(sweep1));
ok("...because it knew none of the four could be here",
   !!sweep1 && sweep1.here === 0 && sweep1.away === 4, JSON.stringify(sweep1));

/* AND THE SHELF THEY ARE ON IS LEFT ALONE. The first version hid the grid and cleared the
   shopper's filters even when nothing pinned could be here, so the banner explaining that their
   bongs were on another page sat over an EMPTY SHOP. Nothing to find here means nothing to do
   here. */
const stillShopping = await ev(`[].slice.call(document.querySelectorAll("#grid > .card"))
  .filter(function(c){ return getComputedStyle(c).display !== "none"; }).length`);
ok("the consumables shelf is still shopable underneath the banner", stillShopping > 0, String(stillShopping));
ok("...and their search box was not typed into for a search that could not land",
   (await ev(`(document.getElementById("q")||{}).value || ""`)) === "");

const chat1 = await chatText();
ok("and the chat stops blaming depth", !/deeper in the shelf/.test(chat1), JSON.stringify(String(chat1).slice(0, 140)));
ok("...it names the shelf instead", /on Devices & Misc/.test(chat1), JSON.stringify(String(chat1).slice(0, 160)));

/* ---------- the move carries the set ---------- */

console.log("\nOpening the shelf they are on\n");
const btn = await ev(`(function(){ var b=document.querySelector("#ll-pinbar .ll-pingo");
  return b ? b.textContent : ""; })()`);
ok("the bar offers the move", btn === "Open Devices & Misc", JSON.stringify(btn));

await ev(`document.querySelector("#ll-pinbar .ll-pingo").click()`);
await until(async () => { if (/\/devices$/.test(await ev(`location.pathname`))) return true; throw 0 }, 60);
await until(async () => { if ((await ev(`document.querySelectorAll('#grid .card[data-pid]').length`)) > 0) return true; throw 0 }, 120);
await until(async () => { if (await ev(`!!document.getElementById("ll-pinbar")`)) return true; throw 0 }, 80);

const bar2 = await barText();
const sweep2 = JSON.parse((await ev(`JSON.stringify(window.LL_pinLast||null)`)) || "null");
console.log("  bar:   " + JSON.stringify(String(bar2).slice(0, 140)));
ok("we landed on the devices shelf", (await ev(`(window.LL_SHELF||{}).slug`)) === "devices");
ok("...with all four still pinned", /showing 4 of 4/.test(bar2), JSON.stringify(String(bar2).slice(0, 120)));
ok("...and nothing off-shelf there", !!sweep2 && sweep2.away === 0, JSON.stringify(sweep2));
const vis2 = await ev(`[].slice.call(document.querySelectorAll("#grid > .card"))
  .filter(function(c){ return getComputedStyle(c).display !== "none"; }).length`);
ok("...four cards on screen and nothing else", vis2 === 4, String(vis2));
const carried = await chatText();
ok("the chat says where they came from", /Brought these over from Consumables/.test(carried),
   JSON.stringify(String(carried).slice(0, 140)));

/* A HANDOFF THAT SURVIVES ITS OWN USE would re-pin on every later visit to this
   shelf -- a pin nobody asked for and nobody can trace. */
ok("the handoff is consumed, not left behind",
   (await ev(`sessionStorage.getItem("ll_pin_handoff")`)) == null);

/* ---------- the controls ---------- */

console.log("\nAnd nothing changed where nothing was wrong\n");

SCRIPT = sse([BONGS[0], BONGS[1], BUDS[0], BUDS[1]], "Mixed set");
await goto("/consumables");
await ask("two bongs and two strains");
const bar3 = await barText();
const sweep3 = JSON.parse((await ev(`JSON.stringify(window.LL_pinLast||null)`)) || "null");
console.log("  bar:   " + JSON.stringify(String(bar3).slice(0, 160)));
ok("a mixed pin still places what this shelf DOES hold", /showing 2 of 2/.test(bar3),
   JSON.stringify(String(bar3).slice(0, 120)));
ok("...and reports the other two rather than counting them as failures",
   /2 of these are not stocked on Consumables/.test(bar3) && !/could not place/.test(bar3));
ok("...and it did have to page for the flower", !!sweep3 && sweep3.here === 2, JSON.stringify(sweep3));

/* A REPAINT MUST NOT TAKE THE PIN WITH IT. This is how the mixed case failed before the observer
   existed, and it failed invisibly: LL_pinLast still reported `found 2` while the grid held
   `html.ll-pinned` over nothing marked -- an empty shop, and no number anywhere said so. Forced
   here by re-rendering the grid the way the engine does. */
await ev(`(function(){ var g=document.getElementById("grid"); var h=g.innerHTML; g.innerHTML=""; g.innerHTML=h; })()`);
await wait(600);
const bar3b = await barText();
const back = await ev(`[].slice.call(document.querySelectorAll("#grid > .card"))
  .filter(function(c){ return getComputedStyle(c).display !== "none"; }).length`);
ok("a repaint under the pin puts the banner back", /showing 2 of 2/.test(bar3b), JSON.stringify(String(bar3b).slice(0, 90)));
ok("...and the cards with it, rather than leaving an empty shop", back === 2, String(back));
ok("...and it says it was a re-apply, not a fresh pin",
   (await ev(`(window.LL_pinLast||{}).reapply`)) === true);

SCRIPT = sse(BONGS, "Blue Bongs - Four Styles");
await goto("/");
ok("the homepage is not a slice", (await ev(`typeof window.LL_SHELF`)) === "undefined");
await ask("show me four blue bongs");
const bar4 = await barText();
const sweep4 = JSON.parse((await ev(`JSON.stringify(window.LL_pinLast||null)`)) || "null");
console.log("  bar:   " + JSON.stringify(String(bar4).slice(0, 140)));
ok("on `/` all four pin exactly as before", /showing 4 of 4/.test(bar4), JSON.stringify(String(bar4).slice(0, 120)));
ok("...nothing is called off-shelf", !!sweep4 && sweep4.away === 0 && !/not stocked/.test(bar4), JSON.stringify(sweep4));
ok("...and no move is offered", (await ev(`!!document.querySelector("#ll-pinbar .ll-pingo")`)) === false);

ok("no page exceptions", errs.length === 0, errs.slice(0, 2).join(" | "));

s.close(); ch.kill(); srv.close();
console.log(fails.length ? `\n${fails.length} FAILED: ${fails.join(", ")}` : "\nall good");
process.exit(fails.length ? 1 : 0);
