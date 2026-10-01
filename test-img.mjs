/* test-img.mjs — the image proxy's allowlist.
 *
 * THE ONLY THING THAT REALLY MATTERS HERE IS THAT IT IS NOT AN OPEN PROXY. An
 * endpoint that fetches any url a stranger names is an SSRF hole and a
 * bandwidth piñata -- it can be pointed at cloud metadata, at private
 * addresses, or simply used to serve somebody else's traffic on our bill.
 *
 * So the refusals are pinned harder than the admissions, and the two attacks
 * that beat a naive allowlist have their own cases: SUFFIX MATCHING
 * (evil-lookah.com ends in a permitted string) and DOMAIN-IN-SUBDOMAIN
 * (lookah.com.evil.net starts with one).
 *
 * The allowlist is DERIVED FROM STORES rather than hand-kept, because a
 * hand-kept twin of the store roster is what this repo has been bitten by
 * twice -- the collector directory and the capture roster. That is asserted
 * too: add a shop and its images are allowed with it.
 *
 *     node test-img.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import { hostOk, parse, allowed } from "./api/img.js";
import { STORES } from "./api/products.js";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const allows = u => !parse(u).err;
const why = u => parse(u).err || "";

console.log("\nThe image proxy\n");

group("IT IS NOT AN OPEN PROXY");
/* The two that beat a naive allowlist. Both are one character of regex away
   from passing, and both are how this kind of endpoint actually gets abused. */
ok("a suffix match is refused (evil-lookah.com)", !allows("https://evil-lookah.com/x.jpg"), why("https://evil-lookah.com/x.jpg"));
ok("a domain-in-subdomain is refused (lookah.com.evil.net)", !allows("https://lookah.com.evil.net/x.jpg"));
ok("cloud metadata is refused", !allows("https://169.254.169.254/latest/meta-data/"));
ok("localhost is refused", !allows("https://localhost/x.jpg"));
ok("a private address is refused", !allows("https://10.0.0.1/x.jpg"));
ok("an unlisted host is refused", !allows("https://example.com/x.jpg"));
ok("plain http is refused", !allows("http://www.lookah.com/x.jpg"), why("http://www.lookah.com/x.jpg"));
ok("the file scheme is refused", !allows("file:///etc/passwd"));
ok("an empty url is refused", !allows(""));
ok("a malformed url is refused", !allows("not a url"));

group("...AND IT DOES ALLOW WHAT WE ALREADY PUBLISH");
/* The counter-case, or an allowlist that refuses everything would pass the
   block above and break every photo on the site. */
ok("a listed shop's own host", allows("https://www.lookah.com/cdn/x/y.jpg"));
ok("...its apex/www twin", allows("https://lookah.com/cdn/x.jpg"));
ok("...and a subdomain of it", allows("https://images.lookah.com/x.jpg"));
ok("a platform CDN we already serve from", allows("https://cdn.shopify.com/s/files/1/x.jpg"));

group("THE ALLOWLIST IS DERIVED FROM STORES, NOT HAND-KEPT");
/* The failure this guards against is the one the collector directory and the
   capture roster both had: a second list that drifts silently. Adding a shop
   must add its images with it, with no second edit. */
const live = STORES.filter(s => s && s.domain && s.enabled !== false);
ok("every enabled shop's domain is allowed",
   live.every(s => hostOk(String(s.domain).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))),
   live.filter(s => !hostOk(String(s.domain).toLowerCase())).map(s => s.key).join(",") || "all " + live.length);
ok("...including the ones added tonight", hostOk("vapor.com") && hostOk("lookah.com"));
ok("the set is not trivially everything", !hostOk("github.com") && !hostOk("google.com"));
ok("...and is a real size", allowed().size >= STORES.length, allowed().size + " hosts");

/* ------------------------------------------------------------------ *
 * AND THE FEED'S HALF: which shops get routed through it              *
 * ------------------------------------------------------------------ */
group("THE FEED ROUTES ONLY THE SHOPS THAT NEED IT");
const { readFileSync: rf } = await import("node:fs");
const psrc = rf("api/products.js", "utf8");
/* The shipped helper, executed rather than restated. */
const a = psrc.indexOf("function proxied(u){"), b = psrc.indexOf("export default async function handler");
ok("the proxy helper could be located in the feed", a >= 0 && b > a);
const F = new Function("STORES", psrc.slice(a, b) + "; return { proxied, proxyPhoto };")(STORES);

ok("an https url is routed", F.proxied("https://www.lookah.com/cdn/x.jpg").startsWith("/api/img?u="));
ok("...and round-trips exactly", decodeURIComponent(F.proxied("https://www.lookah.com/cdn/x.jpg").slice(11)) === "https://www.lookah.com/cdn/x.jpg");
ok("an already-proxied url is left alone", F.proxied("/api/img?u=already") === "/api/img?u=already");
ok("a protocol-relative url is left alone", F.proxied("//x.test/a.jpg") === "//x.test/a.jpg");
ok("an empty value is left alone", F.proxied("") === "");

/* OPT-IN PER SHOP. Proxying all ~4,900 Shopify-CDN rows would put every photo
   on the site through one serverless function to fix somebody else's problem. */
const flagged = STORES.filter(s => s && s.proxyImages).map(s => s.key);
ok("at least one shop is flagged", flagged.length >= 1, flagged.join(",") || "(none)");
ok("...and it is not most of them", flagged.length < STORES.length / 2, flagged.length + " of " + STORES.length);

const lk = { storeKey: flagged[0], image: "https://www.lookah.com/a.jpg",
  gallery: ["https://www.lookah.com/b.jpg"],
  sizes: [["One Size", 10, 0, "v", true, "https://www.lookah.com/p", "https://www.lookah.com/c.jpg", 0]] };
F.proxyPhoto(lk);
ok("a flagged shop's card image is routed", lk.image.startsWith("/api/img?u="));
ok("...its gallery too", lk.gallery[0].startsWith("/api/img?u="));
/* Slot 6 is the per-variant swatch the engine reads for the size dropdown --
   fixing the card and not the swatch would look like a partial fix and be one. */
ok("...and the per-variant swatch in row slot 6", String(lk.sizes[0][6]).startsWith("/api/img?u="));
/* SLOT 5 IS THE ROW'S OWN URL, not a photo. The engine hands it to the browser
   as an address when a grouped card builds a cart link, so routing it through
   an image proxy would send a shopper to a picture instead of a shop. */
ok("...but NOT slot 5, which is the row's product url", lk.sizes[0][5] === "https://www.lookah.com/p");

const gc = { storeKey: "grasscity", image: "https://cdn.shopify.com/x.jpg", gallery: [], sizes: [] };
F.proxyPhoto(gc);
ok("an unflagged shop is untouched", gc.image === "https://cdn.shopify.com/x.jpg");

console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);
