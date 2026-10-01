/* tools/harvest-guards.mjs — what may reach the shelf unattended.
 *
 * WHY GUARDS AT ALL, AND WHY THEY ARE THE INTERESTING PART OF THIS LANE.
 * Every capture failure this project has had was a capture that SUCCEEDED and
 * was wrong: 170 rows that were really 118, 697 rows of nav copy published as
 * products, one shop's entire menu filed under another shop's name. None of
 * them threw. None of them looked wrong from the panel, and two of them sat on
 * the live shelf for weeks. A scheduled lane that only checks for exceptions
 * publishes all of them, on a timer, at night, when nobody is looking.
 *
 * So the rule here is: a row count is not a result. A capture has to survive a
 * set of questions about its SHAPE before it is allowed to replace what is
 * already published.
 *
 * SEPARATE MODULE ON PURPOSE. tools/harvest-coldwater.mjs runs its work at
 * import time (top-level await, then a browser), so a suite that imported it to
 * test the guards would launch Chromium and start hitting real dispensaries.
 * These are the only decisions in the lane that can be checked with no browser
 * and no network, which is exactly why they are the ones that must be.
 *
 * A guard that cries wolf is worse than no guard: it teaches whoever is on call
 * to pass the override, and the override disables every OTHER guard too. So the
 * split between `problems` (block the send) and `warnings` (say it, publish
 * anyway) is deliberate and each entry below argues for its side.
 */

/* ------------------------------------------------------------- shop policy ---
 *
 * PER SHOP, BECAUSE THE SAME NUMBER MEANS DIFFERENT THINGS AT DIFFERENT SHOPS.
 * A 30-row capture is a healthy small menu at one store and a truncated scan at
 * another. `expectMin` is a floor set from what the shop has actually produced,
 * placed ABOVE any historical bad number so a repeat of that bad number is a
 * failure rather than a quiet re-publish.
 *
 * Keys match api/coldwater.js STORES. A shop with no entry gets the defaults,
 * which are deliberately permissive -- an unknown shop should not be blocked by
 * a floor nobody measured.
 */
export const SHOP_POLICY = {
  lume: {
    /* A CHAIN, AND THIS IS THE WORST FAILURE AVAILABLE HERE. Lume runs ~38
       Michigan stores on one origin and /shop/all is whichever store the
       profile last selected. Capturing Monroe and publishing it as Coldwater is
       plausible, silent, and found by a shopper standing in the wrong town. */
    expectMin: 200,
    expectText: /coldwater/i,
  },
  sapura: {
    /* Measured 692 across 7 pages on 2026-08-17; the shelf held 698. The floor
       sits well under both so a normal day's drift is not a failure, and well
       over 98 -- the number a single unpaged autoScan returns -- so a pager
       regression is. */
    expectMin: 300,
  },
  exclusive: {
    /* THE PRINTED-TEXT LAYER IS REFUSED HERE, and this is the guard that would
       have stopped 697 rows of `Name Z - A`, `SPECIAL OFFER` and `MARKET`. It
       is a per-shop decision rather than a global one because for some shops
       printed text is genuinely all there is (a closed shadow root), and it is
       an honest last resort -- it just cannot tell a product from a sort
       dropdown, so it must not run unattended where a better layer exists. */
    expectMin: 100,
    refuseVia: ["printed text"],
  },
  greentree: {
    /* Jane virtualises, so one harvest sees one screenful. 29 rows is the
       historical truncation; the floor is above it on purpose. */
    expectMin: 60,
  },
  dude: { expectMin: 40 },
  herbology: { expectMin: 100 },
  banzen: { expectMin: 200 },
};

const DEFAULTS = { expectMin: 1, refuseVia: [], requireDistinctUrlRatio: null };

export function policyFor(key) {
  return { ...DEFAULTS, ...(SHOP_POLICY[key] || {}) };
}

const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

/* ------------------------------------------------------------------ guards ---
 *
 * rows  — what the collector's batchList() returned
 * diag  — what the collector's diag() returned (via, shopSays, notAListing…)
 * seen  — { storeKey: Set<normalised product name> } for shops already captured
 *         in THIS run, which is what makes the cross-shop check possible
 */
export function guards(shop, rows, diag, seen) {
  const p = policyFor(shop.key);
  const problems = [];
  const warnings = [];
  const n = rows.length;
  diag = diag || {};
  seen = seen || {};

  /* 1 · TOO FEW ROWS. The commonest real failure by far, and the one that looks
     most like success: a menu that had not finished mounting reads as a shop
     with a small catalogue. */
  if (n < p.expectMin) {
    problems.push(
      `only ${n} rows, expected at least ${p.expectMin} — the menu probably did not finish mounting or paging`
    );
  }

  /* 2 · DISTINCT URLS, and a WARNING by default. The restraint matters. A low
     ratio means two different things depending on which layer answered:
     Dutchie's React props carry no per-product link at all, so a perfectly good
     700-row capture scores ONE distinct url, and Banzen's rows link to brand
     pages so a real menu scores one url per brand. Blocking on the ratio alone
     would refuse both of those every night and teach whoever is on call to pass
     --force, which disables everything else here. Promote it per shop with
     requireDistinctUrlRatio where a listing genuinely should carry links. */
  const urls = new Set(rows.map((r) => String(r.url || "").split("#")[0].split("?")[0]).filter(Boolean));
  const ratio = n ? urls.size / n : 0;
  const floor = p.requireDistinctUrlRatio;
  if (n >= 20 && ratio < (floor ?? 0.5)) {
    const msg =
      `${urls.size} distinct urls across ${n} rows (${Math.round(ratio * 100)}%)` +
      (floor
        ? ` — below this shop's floor of ${Math.round(floor * 100)}%`
        : ` — normal for React/DOM layers, furniture if unexpected`);
    (floor ? problems : warnings).push(msg);
  }

  /* 3 · A REFUSED LAYER. See SHOP_POLICY.exclusive. */
  if (p.refuseVia.length && diag.via && p.refuseVia.some((v) => String(diag.via).includes(v))) {
    problems.push(
      `read via "${diag.via}", which this shop refuses unattended — capture the underlying menu instead`
    );
  }

  /* 4 · THE COLLECTOR'S OWN VERDICT, CARRIED THROUGH rather than recomputed. It
     already decided this while it had the page in front of it. */
  if (diag.notAListing) {
    warnings.push(`collector flagged notAListing (${diag.rowsWithLink} distinct links)`);
  }

  /* 5 · MORE ROWS THAN THE SHOP PUBLISHES. When a feed states its own total,
     that number wins outright: extra rows are menu links or a recommendations
     rail collected as products. More than the catalogue is a bug, never a win. */
  /* TWO NAMES FOR THE PLATFORM'S OWN NUMBER, and this guard has to honour both.
     `shopSays` is set when a product FEED answered and describes the whole
     store; `pageSays` is the category's declared total_count for the view being
     captured. Either is the shop counting its own stock, which is what makes
     this check worth more than anything inferred — and reading only the first
     meant a category page could publish more rows than it declares with nothing
     noticing. */
  const declared = diag.shopSays != null ? diag.shopSays : (diag.pageSays != null ? diag.pageSays : null);
  if (declared != null && n > declared) {
    problems.push(
      `${n} rows but the shop publishes ${declared} — ${n - declared} of these are not products`
    );
  }

  /* 5b · FAR FEWER ROWS THAN THE PAGE ITSELF DECLARES. The collector reads the
     category's own `total_count` where the platform publishes one, which turns
     a row count into a fraction — and a fraction is the only way to tell a
     small category from a truncated scan of a large one. Banzen's Infused
     Preroll page states 235 and a single unscrolled harvest returns 13.

     BLOCKING, because a capture REPLACES the collection it names: publishing 13
     of 235 does not add a partial menu, it deletes the other 222. Same reasoning
     as the more-rows-than-published guard above, in the other direction. The
     threshold is deliberately generous — a menu legitimately drifts against its
     own count between page loads — so this only fires on a real truncation. */
  if (diag.pageSays > 0 && n < diag.pageSays * 0.6) {
    problems.push(
      `${n} rows but the page says it holds ${diag.pageSays} — a truncated scan would replace the collection with a fraction of it`
    );
  }

  /* 6 · ONE SHOP'S MENU UNDER ANOTHER SHOP'S KEY, caught generically. This is
     the Sapura/Exclusive bug (693 shared rows) in its general form, and it is
     the only guard here that could have caught it: both captures were
     internally perfect and every other check passes on both. Nothing else in
     the pipeline compares two shops to each other. */
  const mine = new Set(rows.map((r) => norm(r.name)).filter(Boolean));
  for (const [otherKey, otherNames] of Object.entries(seen)) {
    if (otherKey === shop.key || !otherNames || !otherNames.size || !mine.size) continue;
    let shared = 0;
    for (const nm of mine) if (otherNames.has(nm)) shared++;
    const overlap = shared / Math.min(mine.size, otherNames.size);
    if (overlap > 0.6) {
      problems.push(
        `${Math.round(overlap * 100)}% of these product names are also in "${otherKey}" — one of the two is on the wrong shelf`
      );
    }
  }

  /* 7 · WEIGHT COVERAGE, a warning. A store with no weights computes no
     price-per-gram, so no ranking and no best-$/g badge -- which is the site's
     whole proposition missing for that shop. Worth saying every run rather than
     discovering it on the shelf, but it is a data-quality fact about the shop
     rather than evidence the capture is wrong. */
  const withGrams = rows.filter((r) => (r.sizes || []).some((s) => s && s.grams > 0)).length;
  const withImage = rows.filter((r) => r.image).length;
  if (n >= 20 && withGrams / n < 0.2) {
    warnings.push(
      `only ${Math.round((withGrams / n) * 100)}% of rows carry a weight — price-per-gram will not compute for this shop`
    );
  }

  return {
    problems,
    warnings,
    ok: problems.length === 0,
    stats: {
      rows: n,
      distinctUrls: urls.size,
      withGrams,
      withImage,
      pctGrams: n ? Math.round((withGrams / n) * 100) : 0,
      pctImage: n ? Math.round((withImage / n) * 100) : 0,
      via: diag.via || "(none)",
    },
  };
}

/* The name set a later shop in the same run is compared against (guard 6). */
export function nameSet(rows) {
  return new Set((rows || []).map((r) => norm(r.name)).filter(Boolean));
}
