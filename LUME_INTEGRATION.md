# Lume × Legal-Leaf — what an integration would actually be

Assessment written 2026-08-11 from `lume.garden`'s own page source. **Status: assessment.
Nothing built.** Ships with one runnable probe (`lume-overlap.mjs`, §5) because exactly one
number decides whether the biggest of the three options is a feature or a decoration, and that
number has never been measured.

---

## 1. What Lume is, read off its source rather than its pitch

One HTML file, 3.0 MB, no build step — the same architecture as this repo, arrived at
independently. A 21+ age gate (`localStorage.lume_age_ok`), an install prompt, a Web-Audio
"breath" synthesised on every tap, a 1.4 MB hero video inlined twice as base64 (MP4 for iOS,
WebM elsewhere), and a Gentle Mode for seniors and first-timers that swaps type size, motion and
mood labels.

**It already has a backend, and it is not in this repo.** Its client talks to `/api` on its own
domain: `/auth/*`, `/me`, `/match`, `/menu-match`, `/sessions`, `/notes`, `/insights`,
`/billing/{plans,checkout,portal}`, bearer token in `localStorage.lume_token`. Nothing here can
see that server, and this assessment does not assume anything about it beyond the call shapes
the client makes.

**Its data model is 24 strains.** The `STRAINS` array in the page is the offline fallback its
client uses when its own API is unreachable: `slug, name, type, terpene, moods[], flavors[],
effect, note, pairing`. Four moods (Unwind, Elevate, Focus, Drift off), four terpenes (Myrcene,
Limonene, Caryophyllene, Terpinolene), six flavors, three types. Canonical strains, all of them
— Blue Dream, OG Kush, GDP, Northern Lights, Gelato.

**Its matching is arithmetic, not a model.** `localMatch()` starts at 59, adds 15 if the mood is
the strain's primary and 9 if merely listed, 6 per flavor overlap, subtracts 7 for no overlap,
nudges on experience and Gentle Mode, then clamps to 73–97. It presents as a "fit score"; it is
a sort with a floor. Worth knowing before treating the score as something to join on — the
ranking is meaningful, the number is furniture.

**It monetises by subscription:** 7 days free with no card, then $8.99/month, $59.99/year, or
$79/year as a Founding Member locked for life.

**It has no purchase surface at all.** There is no price, no store, no outbound product link
anywhere in the file. Its "Find it near me" section says the quiet part out loud:

> "From inspiration, to the shelf. Paste any dispensary menu… so the right match is the one you
> can actually buy."

The shelf is the user's problem. They have to already be holding a menu.

---

## 2. Why the two fit, in one sentence each

- **Lume** turns a mood into a strain, and stops. No inventory, no price, no way to buy.
- **Legal-Leaf** turns a product title into a price per gram and an affiliate link, and has
  nothing to say about how anything feels. Measured: `grep -oiE 'mood|effect|terpene'` over
  `public/index.html` returns **one** hit, for "effect", in prose.

So each one is the half the other is missing, and they meet on the strain name.

**The join key is already written, and already hardened against the way this join fails.**
`labStrainKey()` (`api/products.js:1137`) plus `LAB_NOISE` — forty-odd grade and size tokens —
exists because a token it misses splits one strain into two keys. That is precisely what a naive
`name.includes()` join hits on its first row: "Blue Dream THCA Flower Indoor 1oz" and "Premium
Blue Dream Smalls 14g" are one strain to a shopper and two strings to a computer. Anything built
here uses that function; it does not restate the regex (§5).

And the two monetisations do not collide. Lume keeps the subscription, this site keeps the
commission, and the shopper gets the thing neither product delivers alone.

---

## 3. Three integrations, cheapest first

### A. Lume's match result gets a "buy this" strip from `/api/products` — recommended

The smallest change with the clearest payoff on both sides. A Lume match currently ends at a
strain name and a ritual; it would end at *"Blue Dream, $4.10/g at THCA Small Buds, lab-tested,
ships free over $75"* with the affiliate-stamped `url` behind it. Lume's own promise becomes
literally true, and every match becomes a possible commission here.

`/api/products` is a public GET, CDN-cached `s-maxage=600, stale-while-revalidate=3600`, so a
prototype needs no new server code at all — except for two things that do have to be built:

1. **CORS does not exist on this site.** Measured today: zero `Access-Control-*` headers
   anywhere in `api/` or `vercel.json`. A browser on `lume.garden` cannot read
   `legal-leafmarket.com/api/products` at all. This is the one hard blocker, and it is small:
   an allow-origin for the Lume origin on a read-only endpoint.
2. **Don't hand a phone the whole feed.** ~6,352 products with galleries is megabytes to
   download so that Lume can use one row. The right shape is a projection —
   `/api/strains?name=blue-dream` or a whole pre-keyed `strain → cheapest rows` map — computed
   from the same cached feed the way `api/share.js` already does for `/p/pick`, not a second
   scrape.

**Decide who counts the conversion before it ships, not after.** `/api/track` already exists and
forwards to `LL_EVENTS_WEBHOOK`; stamp `src:'lume'` on the outbound event from day one, or this
becomes an argument in three months that no data can settle.

### B. Legal-Leaf grows a mood entry point of its own

Four chips — Unwind / Elevate / Focus / Drift off — or a `/mood` page, filtering the grid by
mood instead of by price. It is a genuinely new front door for a site whose every existing
entry point assumes the shopper already knows what a strain is, and it is an SEO surface
("thca flower for sleep") the current grid cannot rank for.

**The gate is coverage, and coverage is unmeasured.** Lume's library is 24 canonical strains.
This catalogue is dominated by novel THCa crosses — John Truffolta, Apple Jacks, 9 LB Hammer,
Dank Toad, Candy Paint are all real rows named in `products.js` and `BUDTENDER_PLAN.md`. If Lume
speaks for forty products out of six thousand, a mood page is a page that mostly says "nothing
matches". Run `lume-overlap.mjs` (§5) before building anything here. If the number is thin, the
conclusion is not "don't" — it is that the vocabulary has to be **written for the strains we
actually sell**, which is `BUDTENDER_PLAN.md` §3's layer 2 ("model knowledge, written, not
scraped") arriving by a different road.

Whatever ships, it ships as an additive `<style>`/`<script>` pair, the way `ll-trim-label` and
`ll-checkout-fix` did. The blob is not edited for this (CLAUDE.md §5).

### C. Lume becomes the second register of the Budtender Concierge — the strategic one

`BUDTENDER_PLAN.md` already specifies an AI buyer's agent over this catalogue: a tool-calling
loop (`search_catalog`, `get_product`, `compare`, `strain_lookup`, `set_site_filters`,
`add_to_cart`), voice locked as "stoner register + skeptical teaching", metric = cart adds. Lume
is the same machine wearing the opposite voice: premium sommelier, calm, mood → effect → context
→ intensity → ritual, aimed at the wellness-curious and first-timers that register will never
reach.

Two observations that should change how the concierge gets built:

- **The register belongs in a parameter, not in the prompt.** One tool loop over one catalogue,
  two system prompts and two skins. Deciding that now costs nothing; discovering it after v1 is
  a rewrite.
- **Lume's journal and the plan's "user-reported effects" layer are the same dataset, currently
  scheduled to be built twice.** `BUDTENDER_PLAN.md` §3 layer 3 wants the bot to ask "how'd that
  hit you?" and log it against the lot; Lume's §9.1 tasting journal already logs sessions and
  builds a tolerance curve, and it is the retention hook the subscription rests on. Two products
  collecting the same proprietary data in two schemas is the expensive mistake here.

One caution in the other direction: `BUDTENDER_PLAN.md` §3 states the COA corpus is
**cannabinoid-only — no terpene panel on any of the four labs sampled**. Lume has a terpene for
every strain. It is tempting to read that as Lume filling the gap. It does not (§4.3).

---

## 4. What will bite

1. **CORS.** None today, anywhere. Blocks A outright until added.
2. **Coverage is unmeasured** and may be thin. §5 exists to answer it.
3. **Asserted vibe next to measured chemistry is the one thing this site cannot afford.** Lume
   assigns one terpene per strain with no lab behind it — a vibe schema, and fine for what Lume
   does. This site's whole credibility position is the opposite: `LAB_TESTED_STORES` is "an
   explicit, evidence-gated list, not a vibe", COA sheets get demoted to store-level when one
   sheet backs several strains, and the pitch is showing 33.07% THCa resolving to 29.26% Total
   THC off a real report. Printing an asserted Myrcene beside a parsed Total THC on the same
   card silently launders one into the other. If mood language ships here, provenance ships
   with it, visibly.
4. **Geography.** Lume's framing is local and dispensary — "find it near me", "where legal".
   This site is national mail-order hemp: CBD Hemp Direct ships nothing to CA, NV, OR or the
   territories, with THCa additionally barred from AR, ID, MN, RI, and CLAUDE.md is explicit
   that **no state-restriction mechanism exists in this codebase**. A mood surface aimed
   squarely at newcomers makes that gap worse than the price grid does, because a newcomer has
   no idea the question exists. This is already an open problem here; mood is not what creates
   it, but mood is what makes it visible to the least-equipped visitor.
5. **The compliance rails already agree — keep it that way.** Lume's own embedded brand system
   prohibits medical claims; `BUDTENDER_PLAN.md` §5 has the identical rail for FDA reasons.
   Mood and effect language sits one step closer to that line than price-per-gram does, and the
   cart is on our domain, so the rail is ours.
6. **Two age gates, two storage keys** (`lume_age_ok` here, this site's own there). A
   cross-domain hand-off must not land someone in the grid having passed neither.
7. **Two products, two domains, two owners of the metric.** See A.

---

## 5. The measurement to take first — `lume-overlap.mjs`

```
node lume-overlap.mjs                          # live feed
node lume-overlap.mjs --feed ./products.json    # a saved response, offline
node lume-overlap.mjs --json                    # for diffing over time
```

It prints the ceiling and the work: how many flower products in the live catalogue carry a
strain Lume has an opinion about, per-strain stock and cheapest price per gram, and — the more
useful half — **the biggest strains the catalogue sells that Lume has no entry for**, ranked,
which is the vocabulary a mood page would need written.

Three things about it worth knowing before trusting the output:

- **It does not define its own normaliser.** It reads `LAB_NOISE` out of `api/products.js` at
  runtime and rebuilds the repo's own key from it, so it cannot drift from the catalogue the way
  the four copies of `storeCheckoutUrl()` drifted from each other. If that declaration is ever
  reshaped, the probe fails loudly and asks to be repointed rather than quietly measuring with a
  stale regex.
- **Aliases are the only name-bridging done**, and deliberately few: GG4 / Original Glue /
  Gorilla Glue, GSC, GDP, AK-47, Do-Si-Dos and a handful more. A strain reading 0 may be absent
  or may be sold here under a name the list does not know. Bare `glue` is excluded on purpose.
- **Non-flower is excluded.** A grinder named Zkittlez is not mood inventory.

The dark list prints *normalised* keys, so it shows what the join sees, artefacts included —
"9 LB Hammer" arrives as `9 hammer` because `LAB_NOISE` eats `lb` as a size token. That is the
catalogue's own key, not a bug in the probe, and it is the string any join would have to match.

**It has never been run against the live feed.** Egress to `legal-leafmarket.com` is refused by
the proxy in the container this was written in, the same limitation recorded for the TribeTokes
and Dogwood entries in `api/products.js`. It has only been exercised against a synthetic feed
shaped like a real one, which proves it runs and bridges the aliases; the coverage percentage
that run printed is a property of the fixture and means nothing about the real catalogue. **Run
it before quoting a number from this document.**

---

## 6. Recommendation

**Do A.** It is small, reversible, needs one new header plus one projection endpoint, makes
Lume's central promise true, and turns Lume's subscription funnel into commission here without
either product giving anything up. Stamp `src:'lume'` on the outbound click from the first
commit.

**Gate B on the probe.** The idea is good and the front door is real; the vocabulary may have to
be written rather than imported, and the probe says which.

**C is the actual prize, but it is the concierge project, not a Lume integration.** The decision
worth making today is cheap and structural: build the concierge with the register as a
parameter, and settle on one session-log schema so Lume's journal and the concierge's
effect-reporting are one dataset instead of two.
