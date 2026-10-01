/* test-collector-directory.mjs — one bookmarklet, every city.
 *
 * ASKED AS "is there one single bookmarklet code? it really should be an all
 * encompassing one." It was one FILE and several LINKS: the market was baked
 * into the bookmarklet's own url (?market=detroit), so an operator needed one
 * per city and clicking last night's wrote a capture into last night's
 * namespace. Silent, because nothing on a shop's page says which one you
 * clicked -- and a capture in the wrong namespace stores perfectly, returns
 * ok:true, and never appears. Six bugs of that exact family shipped in one
 * evening before this one was noticed.
 *
 * AND guessStore() WAS A HAND-WRITTEN TWIN of api/market-stores.js. At sixteen
 * shops that was fragile. Detroit alone has ~61 licences and Grand Rapids 27,
 * so it was about to make adding a shop a CODE change in a project whose whole
 * premise is that adding a shop is data.
 *
 * Both answered by one fact: the directory carries each store's TOWN, so
 * identifying the shop identifies the market. The shop wins over the
 * parameter, because a shop cannot be wrong about which city it is in.
 *
 *   node test-collector-directory.mjs
 */
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";
const ing = await import("./api/coldwater-ingest.js");

const SHOP = 3241, OURS = 3242, CDP = 9641;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, n = 100) => {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch { await wait(250); } }
  throw new Error("timeout");
};
let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};

const COLLECTOR = readFileSync("public/coldwater-collector.js", "utf8");

/* Our own origin, serving the real directory out of the real handler -- so the
   fixture cannot drift from api/market-stores.js, which is the whole claim. */
const oursSrv = createServer(async (req, res) => {
  if (req.url.startsWith("/api/market/ingest")) {
    let body = null;
    const r = {
      setHeader() {}, status() { return r; },
      send(v) { body = v; return r; }, json(v) { body = JSON.stringify(v); return r; },
      end(v) { body = v; return r; },
    };
    const q = Object.fromEntries(new URL(req.url, "http://x").searchParams);
    await ing.default({ method: "GET", query: q }, r);
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    return res.end(body);
  }
  if (req.url.startsWith("/coldwater-collector.js")) {
    res.writeHead(200, { "content-type": "text/javascript", "access-control-allow-origin": "*" });
    return res.end(COLLECTOR);
  }
  res.writeHead(404); res.end("no");
}).listen(OURS);

/* A menu, on whatever host the test asks for. Host is faked with the Host
   header via CDP's request interception? No -- simpler and more honest: the
   collector reads location.hostname, so each case navigates to a path on this
   server and the DIRECTORY is matched against a host we control by rewriting
   what the collector sees. That would be testing a stub. So instead the shop
   server answers on 127.0.0.1 and each case OVERRIDES the directory's hosts to
   include 127.0.0.1, keyed by path slug -- which exercises the real matcher
   (shared host + slug), the harder of the two paths. */
const menu = slug => `<!doctype html><html><head><title>${slug}</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { products: [
  { id: "a", name: "Alpha " + slug, url: "https://" + slug + ".test/product/a", variants: [{ option: "3.5g", price: 30 }] },
  { id: "b", name: "Beta " + slug,  url: "https://" + slug + ".test/product/b", variants: [{ option: "3.5g", price: 31 }] },
  { id: "c", name: "Gamma " + slug, url: "https://" + slug + ".test/product/c", variants: [{ option: "3.5g", price: 32 }] },
] } } })}</script><div>menu</div></body></html>`;

const shopSrv = createServer((req, res) => {
  const slug = (req.url.split("/").filter(Boolean)[0] || "x").split("?")[0];
  res.writeHead(200, { "content-type": "text/html" }); res.end(menu(slug));
}).listen(SHOP);

/* LAUNCHED THROUGH THE SHARED HELPER, which waits long enough for a cold
   start on a loaded runner and keeps the browser's stderr. Spawning here
   with stdio "ignore" and a 15s poll is what produced "Chromium did not
   start" on a machine whose Chrome answered --version perfectly. */
const { proc: ch } = await launchChrome(CDP, [], { userDataDir: "/tmp/_lldir" });

const tgt = await until(() => fetch(`http://127.0.0.1:${CDP}/json`).then(r => r.json()).then(t => {
  const p = t.find(x => x.type === "page"); if (!p) throw 0; return p;
}));
const s = new globalThis.WebSocket(tgt.webSocketDebuggerUrl);
await new Promise(r => s.addEventListener("open", r));
let id = 0; const waiting = new Map();
s.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; waiting.set(i, res); s.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => (await send("Runtime.evaluate", { expression: x, returnByValue: true })).result?.result?.value;
await send("Runtime.enable"); await send("Page.enable");

console.log("\nOne bookmarklet, every city\n");

console.log("== the directory is built from the roster, not from a table ==");
{
  let body = null;
  const r = { setHeader() {}, status() { return r; }, send(v) { body = v; return r; },
              json(v) { body = JSON.stringify(v); return r; }, end(v) { body = v; return r; } };
  await ing.default({ method: "GET", query: { directory: "1" } }, r);
  const d = JSON.parse(body);
  const { STORES } = await import("./api/market-stores.js");
  /* TWO ROSTERS, ONE DIRECTORY, and the second one is why Hitoki's capture
     vanished. The collector derives the market from this response and falls back
     to "coldwater" for a key it cannot find, so a national mail-order shop's
     capture was written into a Michigan town's namespace -- stored perfectly and
     read by nothing, on either surface. The hemp shops live in api/products.js
     and carry town "llm"; the cities live in api/market-stores.js. */
  const { STORES: HEMP } = await import("./api/products.js");
  const live = HEMP.filter(x => x.enabled !== false && x.domain);
  ok("every city store on the roster is in it",
     STORES.every(x => d.stores.some(y => y.key === x.key)),
     d.stores.length + " entries, " + STORES.length + " city stores");
  ok("...and every enabled hemp shop too, under the llm market",
     live.every(x => d.stores.some(y => y.key === x.key && y.town === "llm")),
     live.filter(x => !d.stores.some(y => y.key === x.key)).map(x => x.key).join(",") || live.length + " shops");
  /* A DELISTED SHOP MUST NOT BE OFFERED, for the reason Binoid and DSquared came
     off the capture roster: nothing reads their captures. */
  ok("...but not a delisted one",
     HEMP.filter(x => x.enabled === false).every(x => !d.stores.some(y => y.key === x.key)),
     HEMP.filter(x => x.enabled === false).map(x => x.key).join(",") || "none disabled");
  ok("each one carries its town", d.stores.every(x => x.town), "");
  /* THE HOST IS THE IDENTITY, so a hemp shop has to be findable by it -- that is
     the whole mechanism the market derivation rides on. */
  ok("...and a hemp shop is findable by its own host",
     d.stores.some(x => x.key === "hitoki" && x.hosts.includes("hitoki.com")),
     JSON.stringify(d.stores.find(x => x.key === "hitoki") || null));
  /* THE AMBIGUITY RULE IS PER HOST, and getting that wrong cost a good slug in
     both directions. Lume's towns all sit on lume.com and every menu path
     contains "all", so "all" named five shops at once -- the Sapura/Exclusive
     failure with a confident face, and it must go. But counting globally ALSO
     binned "coldwater-mi-dispensary", the one thing telling Lume's five towns
     apart, because Banzen's own site happens to carry the same path on its own
     domain. Different hosts; never in competition. Slugs are only ever read
     when a host is shared, so a shared host is the only place a collision can
     mislead anyone. */
  const perHost = {};
  for (const st of d.stores) for (const h of st.shared) {
    const seen = (perHost[h] = perHost[h] || {});
    for (const g of st.slugs) seen[g] = (seen[g] || 0) + 1;
  }
  const clashes = Object.entries(perHost).flatMap(([h, m]) =>
    Object.entries(m).filter(([, n]) => n > 1).map(([g]) => h + ":" + g));
  ok("no two shops on one host claim the same slug", clashes.length === 0, clashes.join(", "));
  ok("...so 'all' is gone from the host that shares it",
     !Object.values(perHost).some(m => m.all), JSON.stringify(Object.keys(perHost)));
  /* The other direction, which a global count got wrong: a slug two stores on
     DIFFERENT hosts happen to share is not ambiguous and must survive. */
  const dupAcross = d.stores.filter(x => x.slugs.includes("coldwater-mi-dispensary")).map(x => x.key);
  ok("a slug shared across different hosts is kept by both",
     dupAcross.length === 2, dupAcross.join(","));
  const lume = d.stores.filter(x => x.hosts.includes("lume.com"));
  ok("a host several shops share is marked shared", lume.length > 1 && lume.every(x => x.shared.includes("lume.com")),
     lume.length + " on lume.com");
  ok("...and each still has its own distinguishing slug",
     lume.every(x => x.slugs.length === 1), JSON.stringify(lume.map(x => x.slugs)));
}

/* The real matcher, driven in the browser. Each case rewrites only the HOSTS in
   the fetched directory (to this test's host) and leaves keys, towns and slugs
   exactly as api/market-stores.js produced them -- so what is being tested is
   the matching and the town lookup, not a fixture's idea of either. */
const drive = async (path, param) => {
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/${path}` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
  await ev(`localStorage.clear(); sessionStorage.clear(); true`);
  await ev(`(function(){
    var real = window.fetch;
    window.fetch = function(u, o){
      if (String(u).indexOf("directory=1") >= 0) {
        return real("http://127.0.0.1:${OURS}/api/market/ingest?directory=1").then(function(r){
          return r.json();
        }).then(function(j){
          for (var i=0;i<j.stores.length;i++) j.stores[i].hosts = ["127.0.0.1"];
          for (var i=0;i<j.stores.length;i++) j.stores[i].shared = ["127.0.0.1"];
          return { json: function(){ return Promise.resolve(j); } };
        });
      }
      return real(u, o);
    };
    window.__LL_COLLECTOR_SRC__ = "http://127.0.0.1:${OURS}/coldwater-collector.js${param ? "?market=" + param : ""}";
    return true;
  })()`);
  await send("Runtime.evaluate", { expression: COLLECTOR });
  await wait(3000);
  return {
    store: await ev(`(document.getElementById("ll-store")||{}).value`),
    panel: String(await ev(`(document.getElementById("ll-collector")||document.body).innerText`)),
  };
};

/* A VARIANT THAT NAMES EXACTLY ONE SHOP. drive() above rewrites EVERY host to
   this test's, which makes every host shared and hands the decision to the
   slugs -- right for the Lume cases it was written for, and useless for a shop
   with no slug at all. Here only the shop under test gets this host, so the
   host alone is the identity, which is how a single-shop domain really works. */
const driveOnly = async (key) => {
  await send("Page.navigate", { url: `http://127.0.0.1:${SHOP}/shop` });
  await until(async () => { if (await ev(`document.readyState==='complete'`)) return true; throw 0; });
  await ev(`localStorage.clear(); sessionStorage.clear(); true`);
  await ev(`(function(){
    var real = window.fetch;
    window.fetch = function(u, o){
      if (String(u).indexOf("directory=1") >= 0) {
        return real("http://127.0.0.1:${OURS}/api/market/ingest?directory=1")
          .then(function(r){ return r.json(); })
          .then(function(j){
            for (var i=0;i<j.stores.length;i++) {
              var m = j.stores[i].key === ${JSON.stringify(key)};
              j.stores[i].hosts = [m ? "127.0.0.1" : "elsewhere.invalid"];
              j.stores[i].shared = [];
            }
            return { json: function(){ return Promise.resolve(j); } };
          });
      }
      return real(u, o);
    };
    window.__LL_COLLECTOR_SRC__ = "http://127.0.0.1:${OURS}/coldwater-collector.js";
    return true;
  })()`);
  await send("Runtime.evaluate", { expression: COLLECTOR });
  await wait(3000);
  return {
    store: await ev(`(document.getElementById("ll-store")||{}).value`),
    panel: String(await ev(`(document.getElementById("ll-collector")||document.body).innerText`)),
  };
};

console.log("\n== a hemp shop names the market that actually reads it ==");
/* THE REPORTED BUG, END TO END. "hitoki read the site great, but then didn't
   successfully push back to llm or the collect page", and again for YLLVAPE.
   The read was never the problem: both returned full catalogues. marketFor()
   could not find them, so the market fell back to "coldwater" and the capture
   was written into a Michigan town's namespace, where /api/products (market
   "llm") never looks and /coldwater has no such shop. */
{
  const r = await driveOnly("hitoki");
  ok("the hemp shop is identified by its own host", r.store === "hitoki", r.store);
  ok("...and the panel names llm, not the pilot city",
     /\bllm\b/.test(r.panel) && !/\bcoldwater\b/i.test(r.panel.split("Collection")[0]),
     r.panel.replace(/\s+/g, " ").slice(0, 120));
}

console.log("\n== the shop names its own city, with no market in the link ==");
{
  const r = await drive("coldwater-mi-dispensary/menu", "");
  ok("the Coldwater shop is identified by its slug", r.store === "lume", r.store);
  ok("...and the panel names Coldwater", /\bcoldwater\b/i.test(r.panel), r.panel.replace(/\s+/g, " ").slice(0, 90));
}
{
  const r = await drive("monroe-mi-dispensary/menu", "");
  ok("the SAME bookmarklet identifies the Monroe shop", r.store === "lume-monroe", r.store);
  ok("...and the panel names Monroe, not the pilot",
     /\bmonroe\b/i.test(r.panel) && !/&mdash; coldwater/i.test(r.panel),
     r.panel.replace(/\s+/g, " ").slice(0, 90));
}

console.log("\n== a stale bookmarklet from another city does not win ==");
{
  /* THE BUG THIS ENDS. Yesterday's Detroit bookmarklet, clicked on a Monroe
     shop, used to post market:"detroit" -- storing perfectly into a namespace
     Monroe's shelf never reads. */
  const r = await drive("monroe-mi-dispensary/menu", "detroit");
  ok("the shop still wins", r.store === "lume-monroe", r.store);
  ok("...and the disagreement is said out loud, not resolved in silence",
     /bookmarklet says detroit/i.test(r.panel) && /shop wins/i.test(r.panel),
     r.panel.replace(/\s+/g, " ").slice(0, 130));
}

console.log("\n== an unregistered shop says so rather than guessing ==");
{
  const r = await drive("some-shop-nobody-added/menu", "");
  ok("no store key is invented", !r.store, "'" + r.store + "'");
  ok("...and the panel warns it would be stored where nothing reads it",
     /not a shop on any roster/i.test(r.panel), r.panel.replace(/\s+/g, " ").slice(0, 110));
}

s.close(); ch.kill(); shopSrv.close(); oursSrv.close();
console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
