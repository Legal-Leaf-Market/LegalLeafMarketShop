/* test-ingest-partial-drop.mjs — 1,378 in the batch, 14 on the shelf.
 *
 * REPORTED AS "it scraped everything perfectly and then only sent 14". The
 * collector panel said 1,378 products in the batch. Send returned, in the same
 * green it uses for a complete capture, "Sent. 14 products into deals". 1,364
 * rows were gone, no number named them, and nothing said why.
 *
 * TWO INDEPENDENT FAULTS, and each one alone was enough to produce it.
 *
 * 1. THE COLLECTOR FABRICATED URLS NOTHING COULD RESOLVE. Its product-url line
 *    handled exactly one relative form -- `charAt(0) === "/"` -- so
 *    "products/tear-gas-9", "./x" and a bare slug all travelled unresolved.
 *    They pass for links on the way out: they are distinct strings, so the
 *    distinct-url guard counts them and the batch looks healthy. Then the
 *    endpoint requires ^https?: and bins every one.
 *
 * 2. THE ENDPOINT DROPPED THEM ON THE SUCCESS PATH, IN SILENCE. Every
 *    diagnostic it had -- the per-condition counts, the sentence naming the
 *    rule -- lived inside the 400 branch, which fires only when EVERY row
 *    fails. A 99% loss took the 200. So the one capture failure this project
 *    cannot see is the one where most of it works, which is also the only kind
 *    that reaches the shelf looking finished.
 *
 * The numbers here are the reported ones on purpose: 1,378 sent, 14 stored.
 *
 *   node test-ingest-partial-drop.mjs
 */
process.env.LL_NO_STORE_FETCH = "1";
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
delete process.env.DATABASE_URL;
process.env.LL_ADMIN_TOKEN = "test-token";

const mod = await import("./api/coldwater-ingest.js");

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const post = async body => {
  let out = null, code = 0;
  const res = {
    setHeader() {}, status(c) { code = c; return res; },
    send(v) { out = v; return res; }, json(v) { out = JSON.stringify(v); return res; },
    end(v) { out = v; return res; },
  };
  await mod.default({ method: "POST", query: {}, headers: { "x-ll-admin-token": "test-token" }, body }, res);
  return { code, j: JSON.parse(out) };
};

const row = (i, url) => ({
  name: "Strain " + i, url,
  sizes: [{ label: "3.5g", price: 30 + (i % 20), grams: 3.5 }],
});

/* ------------------------------------------------------------------------- */
group("THE REPORTED CAPTURE: 1,378 sent, 14 with a resolvable url");
{
  const products = [];
  for (let i = 0; i < 14; i++) products.push(row(i, "https://kingofbudz.com/product/s" + i));
  /* The 1,364 the collector used to send unresolved -- a path with no leading
     slash is the exact form its old `charAt(0) === "/"` test walked past. */
  for (let i = 14; i < 1378; i++) products.push(row(i, "michigan/detroit/product/s" + i));

  const r = await post({ storeKey: "kingofbudz-detroit", market: "detroit", collection: "deals", products });
  ok("the post still succeeds -- the good rows are not thrown away", r.code === 200, "http " + r.code);
  ok("14 stored, which is the number that was reported", r.j.stored === 14, String(r.j.stored));

  /* THE FIX. Every one of these was absent from the 200 before. */
  ok("and it now says how many were SENT", r.j.received === 1378, String(r.j.received));
  ok("...how many were dropped", r.j.dropped === 1364, String(r.j.dropped));
  ok("...and which condition dropped them", /no product url/i.test(r.j.why || ""),
     String(r.j.why || "").slice(0, 120));
  ok("...naming a relative path as not being one",
     /bare slug or a relative path/i.test(r.j.why || ""));
  ok("the per-condition census travels too",
     r.j.withName === 1378 && r.j.withPrice === 1378 && r.j.withUrl === 14,
     `name ${r.j.withName} price ${r.j.withPrice} url ${r.j.withUrl}`);
  /* The note is what the panel prints, and it used to read "Stored. 1
     collection for this shop" -- a sentence with no bad news in it at all. */
  /* THE NOTE USED TO BE A TERNARY CHAIN, so whichever fact came first won and
     the others were never printed: this capture is both 99% dropped AND held in
     memory only, and it reported the memory. Both are separately capable of
     keeping a capture off the shelf, so both are said, worst first. */
  ok("the note names the loss", /1364 OF 1378 ROWS WERE DROPPED/.test(r.j.note || ""),
     String(r.j.note || "").slice(0, 90));
  ok("...and does not lose the other warning to it",
     /memory only/.test(r.j.note || ""), String(r.j.note || "").slice(-80));
}

group("A CLEAN CAPTURE IS STILL CLEAN, and says nothing alarming");
{
  const products = [];
  for (let i = 0; i < 40; i++) products.push(row(i, "https://kingofbudz.com/product/s" + i));
  const r = await post({ storeKey: "kingofbudz-detroit", market: "detroit", collection: "flower", products });
  ok("everything is stored", r.j.stored === 40, String(r.j.stored));
  ok("dropped is zero", r.j.dropped === 0, String(r.j.dropped));
  /* undefined rather than a sentence: the panel keys its amber on `why`, so a
     reason present on a clean capture would paint every success as a warning. */
  ok("and no reason is offered, so a good capture cannot read as a bad one",
     r.j.why === undefined, String(r.j.why));
  /* No backend is attached in a suite, so the memory caveat is legitimately
     present -- what must NOT be there is a drop warning. */
  ok("the note carries no drop warning", !/DROPPED/.test(r.j.note || ""), String(r.j.note || "").slice(0, 60));
}

group("EVERY ROW FAILING STILL 400s, with the same sentence");
{
  const products = [];
  for (let i = 0; i < 9; i++) products.push(row(i, "product/s" + i));
  const r = await post({ storeKey: "kingofbudz-detroit", market: "detroit", collection: "junk", products });
  ok("nothing usable is a 400, not a 200 storing zero", r.code === 400, "http " + r.code);
  ok("it counts what it received", r.j.received === 9, String(r.j.received));
  ok("and names the url rule, the same way the 200 does",
     /no product url/i.test(r.j.why || ""), String(r.j.why || "").slice(0, 110));
  ok("...with the per-condition counts intact",
     r.j.withName === 9 && r.j.withPrice === 9 && r.j.withUrl === 0,
     `name ${r.j.withName} price ${r.j.withPrice} url ${r.j.withUrl}`);
}

group("THE OTHER TWO CONDITIONS ARE NAMED APART, not lumped as 'bad rows'");
{
  const products = [
    { name: "Good", url: "https://kingofbudz.com/product/a", sizes: [{ label: "1g", price: 10, grams: 1 }] },
    { name: "",     url: "https://kingofbudz.com/product/b", sizes: [{ label: "1g", price: 10, grams: 1 }] },
    { name: "NoPrice", url: "https://kingofbudz.com/product/c", sizes: [{ label: "1g", grams: 1 }] },
  ];
  const r = await post({ storeKey: "kingofbudz-detroit", market: "detroit", collection: "mixed", products });
  ok("only the good row lands", r.j.stored === 1, String(r.j.stored));
  ok("the nameless one is counted as nameless", /1 had no name/.test(r.j.why || ""),
     String(r.j.why || "").slice(0, 140));
  ok("the priceless one as priceless", /1 had no size carrying a price/.test(r.j.why || ""));
  /* All three urls were fine here, so the url clause must NOT appear -- a
     reason that lists every rule every time is a reason nobody reads. */
  ok("and the url rule is not mentioned, because no row failed it",
     !/no product url/i.test(r.j.why || ""), String(r.j.why || "").slice(0, 140));
}

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
