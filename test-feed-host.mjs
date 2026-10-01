/* test-feed-host.mjs — which host api/feed.js asks for the catalogue.
 *
 * THE BUG THIS EXISTS FOR IS THE QUIETEST KIND: a wrong host here cannot fail
 * loudly, because the thing that answers it replies 200.
 *
 * This project runs Vercel SSO protection at `all_except_custom_domains`, so
 * every *.vercel.app host -- previews AND the generated production alias --
 * answers an anonymous request with a redirect to vercel.com/sso-api. fetch
 * follows it, gets 200 HTML, `r.ok` is true, and `data.products` is undefined.
 * The only symptom is "catalogue returned no products" from a catalogue with
 * 5,950 products in it.
 *
 * A SCHEDULED INVOCATION IS THE ONE CALLER THAT ARRIVES ON SUCH A HOST, so the
 * nightly price recorder failed every night while every visitor-facing caller
 * of the same function worked perfectly -- they arrive on the custom domain.
 * It was diagnosed as a schedule problem, then a timeout, before anyone looked
 * at the host.
 *
 * THE COUNTER-CASES ARE PINNED AS HARD AS THE REFUSAL. api/feed.js is shared by
 * the concierge, the kit builder and the share pages; a fix that pinned the
 * production domain unconditionally would break local development silently, in
 * the same read-200-get-nothing way.
 *
 *     node test-feed-host.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
import { siteHost } from "./api/feed.js";
import { readFileSync } from "node:fs";

const fails = [];
const ok = (n, c, x = "") => { console.log(`${c ? "  PASS" : "  FAIL"}  ${n}${x ? "   (" + x + ")" : ""}`); if (!c) fails.push(n); };
const group = m => console.log("\n" + m);
const H = (h, fwd) => ({ headers: fwd ? { host: h, "x-forwarded-host": fwd } : { host: h } });

/* A clean slate: these are read at call time, and the suite sets them itself. */
for (const k of ["LL_SITE_HOST", "LL_SITE", "VERCEL_PROJECT_PRODUCTION_URL"]) delete process.env[k];

console.log("\nWhich host the catalogue is read from\n");

group("A PROTECTED HOST IS REFUSED AS AN ADDRESS, NEVER AS A CALLER");
ok("the generated production alias is not asked",
   siteHost(H("legal-leaf.vercel.app")) === "legal-leafmarket.com", siteHost(H("legal-leaf.vercel.app")));
ok("...nor an immutable deployment url",
   siteHost(H("legal-leaf-ni7o0dg88-legal-leaf.vercel.app")) === "legal-leafmarket.com");
ok("...nor one that arrived via x-forwarded-host",
   siteHost(H("whatever", "legal-leaf-abc123-legal-leaf.vercel.app")) === "legal-leafmarket.com");
ok("...and the match is anchored, so a real domain ending in those words is fine",
   siteHost(H("not-vercel-app.com")) === "not-vercel-app.com", siteHost(H("not-vercel-app.com")));
ok("...case does not get past it", siteHost(H("Legal-Leaf.Vercel.App")) === "legal-leafmarket.com");

group("EVERY OTHER CALLER IS STILL HONOURED");
/* api/feed.js is shared with the concierge, the kit builder and the share
   pages. Pinning production unconditionally would break local development in
   exactly the same silent way -- a dev server reading the live site. */
ok("the custom domain", siteHost(H("legal-leafmarket.com")) === "legal-leafmarket.com");
ok("a www host", siteHost(H("www.legal-leafmarket.com")) === "www.legal-leafmarket.com");
ok("localhost keeps its port", siteHost(H("localhost:3000")) === "localhost:3000");
ok("...and so does 127.0.0.1", siteHost(H("127.0.0.1:8787")) === "127.0.0.1:8787");
ok("x-forwarded-host wins over host, as before", siteHost(H("a.internal", "legal-leafmarket.com")) === "legal-leafmarket.com");

group("THE FALLBACK LADDER");
ok("no request at all lands on the public domain", siteHost(null) === "legal-leafmarket.com");
ok("...and so does an empty header bag", siteHost({ headers: {} }) === "legal-leafmarket.com");
process.env.VERCEL_PROJECT_PRODUCTION_URL = "legal-leafmarket.com";
ok("the platform's own answer is preferred to the hardcoded one",
   siteHost(H("legal-leaf.vercel.app")) === "legal-leafmarket.com");
process.env.VERCEL_PROJECT_PRODUCTION_URL = "example.org";
ok("...and it really is read rather than coincidentally equal",
   siteHost(H("legal-leaf.vercel.app")) === "example.org", siteHost(H("legal-leaf.vercel.app")));
delete process.env.VERCEL_PROJECT_PRODUCTION_URL;

group("AN EXPLICIT OVERRIDE WINS, AND IS FORGIVING ABOUT SHAPE");
/* LL_SITE already exists in this repo as a full URL (the Actions workflow's own
   variable), so a scheme and a trailing path must not become part of a host. */
process.env.LL_SITE = "https://staging.example.com/";
ok("a full url is reduced to its host", siteHost(H("legal-leafmarket.com")) === "staging.example.com", siteHost(H("legal-leafmarket.com")));
process.env.LL_SITE = "  http://staging.example.com/api/products  ";
ok("...whitespace and a path too", siteHost(null) === "staging.example.com", siteHost(null));
process.env.LL_SITE_HOST = "pinned.example.com";
ok("LL_SITE_HOST outranks LL_SITE", siteHost(null) === "pinned.example.com", siteHost(null));
delete process.env.LL_SITE_HOST; process.env.LL_SITE = "";
ok("an empty override is not an override", siteHost(H("legal-leafmarket.com")) === "legal-leafmarket.com");
delete process.env.LL_SITE;

group("THE MESSAGE NAMES THE HOST");
/* Both failure strings used to describe the feed and not the address, which is
   what sent two separate diagnoses to the wrong file. */
const src = readFileSync("api/feed.js", "utf8");
ok("the empty-catalogue error says where it asked", /catalogue returned no products from \$\{host\}/.test(src));
ok("...and so does the http one", /HTTP \$\{r\.status\} from \$\{host\}/.test(src));

console.log(fails.length ? `\nFAILED: ${fails.join(" | ")}\n` : `\nAll good.\n`);
process.exit(fails.length ? 1 : 0);
