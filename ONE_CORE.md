# One core, many cities — the architecture, before any of it is built

Written 2026-08-17, from a single requirement: **every city is identical. Zero
differences.** One core, called with a market, never a copy per town.

This is a plan. Nothing in it is built yet. It exists so the first city after
Coldwater does not quietly become a second codebase.

---

## 1. The rule, and the thing that will break it

> If a behaviour needs to differ between two cities, it is **data**. If it is
> written as a branch, it is a fork.

The failure is not dramatic. It is one `if (market === "detroit")` added at 1am
to fix one shop, and it will never show up in a test — every other city keeps
passing. By the fourth city there are nine of them and the cities are no longer
the same product.

So the codebase gets exactly two places where cities may differ — `api/markets.js`
for what a place *is* and `api/market-stores.js` for what is *in* it — and two
tests: one asserting no other file names a city, and one that adds a city and
watches everything else stay byte-identical.

**This is cheap to enforce and impossible to retrofit**, which is why it goes in
before the second city rather than after the third.

---

## 2. Where it stands today

Already true, from the Coldwater build:

| piece | state |
|---|---|
| `api/coldwater.js` | town-scoped via `?town=`, per-town cache, market string derived |
| `api/coldwater-ingest.js` | market-namespaced storage |
| `api/overrides.js` | market-namespaced |
| `api/coldwater-merge.js` | market-agnostic already — lanes, freshness, colour |
| `api/markets.js` | the registry — what a place IS |
| `api/market-stores.js` | the roster — what is IN it |
| `tools/harvest-coldwater.mjs` | takes a roster; not city-aware, does not need to be |

Not yet true:

- **the page.** `public/coldwater.html` is a 695 KB generated artifact with the
  town's name baked into its title, description and copy. Three cities the same
  way is three copies of a 695 KB file, and every engine change regenerates all
  of them. That is the thing this document is mostly about.
- **the name.** Everything is called `coldwater` — the route, the endpoint, the
  storage prefix. That is a rename, not a redesign, but it is a large diff and it
  should happen once, deliberately, rather than gradually.

---

## 3. The page: three options, and why the third one wins

### A. One page, city resolved at runtime

`/detroit`, `/lansing` and `/coldwater` all rewrite to one `public/market.html`,
which reads its city from `location.pathname` and fetches
`/api/market?town=<city>`.

- **for:** literally one file. Zero duplication, zero regeneration.
- **against:** **the title and meta description are set by JavaScript.** This
  site's entire traffic model is somebody searching "coldwater dispensary
  prices". A page whose `<title>` is filled in after load competes badly for
  exactly the queries it exists to win, and every city shares one canonical url
  in the eyes of anything that does not run scripts.

Rejected on SEO, which for this product is not a detail.

### B. One generator, N generated pages (what Coldwater does today, times N)

- **for:** per-city `<title>`, meta, canonical and JSON-LD are all static and
  correct. One template, so the code is genuinely one core.
- **against:** N × 695 KB of generated HTML in the repo, all of which must be
  regenerated together whenever the engine changes. At three cities that is
  2 MB; at thirty it is 20 MB and a `git diff` nobody can read.

### C. One generator, N *thin* pages, one shared engine — **recommended**

The 695 KB is not the page. It is the base64 engine blob, ~250 KB of it, plus the
additive blocks. Move the blob to **one** `public/engine.js` that every city page
loads, and a city page becomes a few KB: its own `<title>`, meta, JSON-LD, a
one-line market config, and a script tag.

- per-city static meta, so option A's problem does not arise
- one copy of the engine, so option B's problem does not arise
- an engine change touches **one file**, not thirty
- the additive blocks (`cw-freshness`, `cw-colour`, the rails, the THC relabel)
  move to one shared `public/market.js` alongside it

**The risk, stated plainly:** this moves the base64 blob, which CLAUDE.md §5 and
§11 say is the most fragile thing in the repo. But it is a *move*, not an edit —
the same bytes, relocated — and the generator already asserts blob md5 and length
on every run. Extend that to assert the extracted file's md5 equals the blob's,
and the operation is verifiable rather than hopeful. Do it once, with the assert
written first.

**Second-order benefit worth having:** thirty city pages currently mean a browser
downloading 250 KB of identical engine per city visited. One shared, cached
`engine.js` is downloaded once for the whole site.

---

## 4. The rename

`coldwater` is a place, and it is currently also the name of the product. That
was right for one town and is wrong for thirty.

| now | after |
|---|---|
| `/api/coldwater` | `/api/market` |
| `/api/coldwater/ingest` | `/api/market/ingest` |
| `api/coldwater-merge.js` | `api/market-merge.js` |
| `/coldwater-list` | `/trip` |
| `ll:coldwater:ingest:<store>` | unchanged |
| `/coldwater` | unchanged |

**`/coldwater-list` moved and `/coldwater` did not, and the two cases are the
argument for each other.** The city page is the whole traffic model — indexed,
linked, searched for by name — so it keeps its path forever. The trip page is
`noindex, nofollow`, in no sitemap and in no nav; nothing can point at it but a
homescreen shortcut, which a 308 covers. It is also the one page genuinely
**shared** by every city, so naming it after one town was the collision this
section exists to remove rather than an instance of the url being worth keeping.

**The storage prefix does not move, and that is deliberate.** Every capture the
operator has taken lives under `ll:coldwater:ingest:*`. Renaming the key orphans
all of it silently — the shelf comes up empty and looks like it was never
configured, which is exactly the failure mode `api/overrides.js` avoided by
keeping `llm` on its original key. A prefix is a storage detail; it does not have
to read nicely.

**`/coldwater` also does not move**, for the same reason in public: it is the url
that is indexed and linked. New cities get `/<city>`; Coldwater keeps its path
and gains `/coldwater` as an alias of the market slug.

Old API routes stay as thin redirects to the new ones. The bookmarklet in the
operator's browser posts to `/api/coldwater/ingest` and will keep doing so until
it is reinstalled, and a capture that 404s is a capture that is silently lost.

---

## 5. The order to do it in

1. **`api/markets.js`** — the registry. *(done)*
2. **The no-branches test.** Assert no file outside `api/markets.js` contains a
   city name. *(done — caught one on its first run)*
3. **Extract the engine** to `public/engine.js` with an md5 assert. *(done — the
   page went 721,871 → 449,016 bytes, and it turned out to fix a live mojibake
   bug: `atob` returns latin1, so the engine's UTF-8 characters had been
   rendering as `360Âº Grinder` for as long as the blob existed)*
4. **Parameterise the generator** so a city page is meta + config, and diff two
   cities to prove it. *(done — `--market lansing` emits a second city, and
   `test-one-core.mjs` asserts the only differing code lines are the city name
   and the geographic blurb)*

   **The diff is the deliverable, not the thinning.** Generating Lansing and
   comparing it against Coldwater immediately found the bug that mattered most:
   the fetch shim repointed to `/api/coldwater` with **no `?town=`**, so a
   Lansing page would have served Coldwater's shelf under a Lansing heading —
   the exact failure the town scoping exists to prevent, arriving in the new
   architecture by a route the scoping never sees. Nothing about reading the
   generator would have surfaced it.

   Two false positives in that diff are worth keeping in mind, because both are
   the same naming collision: `LL_COLDWATER_META` is a fixed global identical on
   every city page, and `/api/coldwater` is the shared endpoint. Normalising the
   word "coldwater" turns both into differences that do not exist. The test
   masks the endpoint and diffs raw before normalising — and **step 5 removes
   the ambiguity entirely**, which is the strongest argument for doing it.
5. **Rename** the routes, with aliases. *(done for the routes — `/api/market`
   and `/api/market/ingest` are canonical, `/api/coldwater*` are kept forever as
   aliases, and the generated page calls the neutral name. The receipt is that
   `test-one-core.mjs` no longer needs its endpoint mask: every remaining
   "coldwater" in a city page's code is now the city.)*

   **Deliberately NOT done: the file renames.** `api/coldwater-merge.js` and its
   siblings keep their names for now. They are internal, no caller outside the
   repo depends on them, and renaming three files plus every import at the same
   time as changing the routes would put two kinds of risk in one diff. The
   routes were the half that mattered, because they are the half that removes
   the naming collision from the pages.
6. **Add the first new city** — which by then should be an entry in
   `api/markets.js` and a store list, and nothing else. *(done — and it failed
   its own test on the first run, in six places, every one of them silent.
   `node test-market-add.mjs`, 60 assertions, is what found them and is now the
   guard for each.)*

Step 6 is the test of the whole exercise. If adding Detroit needs any file other
than `api/markets.js` and its store data, one of steps 2–5 was not finished.

### What step 6 found

**It is a different question from step 2's**, and that is the point of running
it. Step 2 asserts no file *branches* on a city. Step 6 adds a city that does
not exist, in the data files and nowhere else, and drives the whole chain
against it — because **a codebase can pass the branch guard and still be
impossible to add a city to.** All six of these did.

1. **Two town registries, already drifted.** `api/coldwater.js` kept its own
   five-town map beside the eight in `api/markets.js`, and its resolver fell
   back to the default for anything missing from its copy. Measured before the
   fix:

   ```
   ?town=lansing     -> coldwater
   ?town=detroit     -> coldwater
   ?town=grandrapids -> coldwater
   ```

   Registered markets, spelled correctly, silently serving the pilot's shelf —
   the exact failure the town scoping was built to prevent, arriving through the
   *resolver*, which is the one route `fromLume()`'s `expectLocation` guard
   cannot see. **It could not have failed loudly**, because falling back IS the
   right answer for a mistyped `?town=`, and with two registries there is no way
   to tell a typo from a city nobody told you about. One registry is the fix;
   there is no version of two that is safe.

2. **The roster lived in the reader.** Adding a shop meant editing the
   3,145-line file that holds the scrapers, the classifier and the merge. That
   is the pressure that puts a per-city branch somewhere it looks at home, so
   the rows moved to `api/market-stores.js` — byte-identical, 106 lines.

3. **The sample-catalogue banner asked about the pilot.** It fetched a bare
   `/api/coldwater` with no `?town=`. The fetch shim never sees it (it repoints
   `/api/products`, and this was already an `/api/` path), so a second city with
   no shops would have shown placeholder products under a real place name **with
   no warning at all** — the banner reads the pilot's `meta.demo`, sees a
   connected shop and stays quiet. The worst of the six.

4. **Colour wrote into the pilot's namespace.** The admin panel posted
   `market:"coldwater"` as a literal. Colour outranks every automated lane and is
   never overwritten, so an observation made on another city's page would not
   have landed in the wrong place temporarily — it would have attached
   *permanently* to a Coldwater card.

5. **One cart for every city.** The trip key was a flat `ll_cw:ll_cart`, so two
   towns' jars merged into one shopping route. It carries the town now, with a
   one-time lift of the flat key so the pilot's existing list is not orphaned —
   run by every city, which is what keeps it from being a per-city case.

6. **The trip page was the pilot's, in twenty places** — including a Maps link
   that appended `", Coldwater, MI"` to every address. On a second city that
   routes a shopper ninety miles the wrong way. It resolves its market at
   runtime now (the opposite of §3's decision for the city pages, and for the
   stated reason: it is `noindex` and nobody searches for their own shopping
   list).

**What it also settled, by measurement rather than by reading:** a city page
needs **no routing entry in either file**. `cleanUrls: true` serves
`public/<city>.html` at `/<city>` on Vercel, and `serveStatic()` resolves an
extensionless path to `.html` locally. The dozen `"/x": "/x.html"` rewrites in
both files never fire — `server.mjs` says so itself, in the comment beside
`/p/theloudpack`, which is the one rewrite that *did* fire and was broken by
exactly this. The suite proves it by serving a page that has no entry anywhere
and asserting a 200.

---

## 6. The three cities

Chosen as the largest **city** markets, not the highest grossing municipalities.
New Buffalo and Monroe out-sell all three on border traffic, but they are small
towns serving Indiana and Ohio drivers — a comparison site for a place people
drive *through* is a different product from one for a place people live.

| city | county | stores | payout ÷ $54,017.10 |
|---|---|---|---|
| **Detroit** | Wayne | **61** | $3,295,043.10 — reported as "$3.3 million" |
| **Grand Rapids** | Kent | **27** | $1,458,461.70 — reported as "nearly $1.46 million" |
| **Lansing** | Ingham | **26** | $1,404,444.60 — reported as "$1.4 million" |

**All three are the state's own arithmetic now**, and two of them moved when they
stopped being a directory's. Michigan pays each municipality $54,017.10 per
licensed store, so a city's cheque divided by that figure is its shop count —
computed by the state, for its own reasons, with no incentive to inflate. Each
row above is checked against the reported payout rather than taken on its own.

**Which reorders them.** This table used to carry "~16" for Grand Rapids off a
directory, putting it eleven behind Lansing. It is 27, one *ahead*. Detroit had
33 shops in 2023 and has 61 now — it nearly doubled in two years.

**Directory sites remain unusable for this.** Asked for Detroit in one sitting
they returned 35, 155 and 13; asked again while this table was being corrected,
49 and 13. They count different things and none of them says which.

### And a fourth, which is none of those things (2026-09-07)

**New Buffalo is live at the owner's request**, and it is the counter-example to
the paragraph that opens this section rather than an addition to the table. It
is a border town of a couple of thousand people that out-sells every city above
it, and the argument against building it is written right there: a comparison
site for a place people drive *through* is a different product. The argument for
is in MICHIGAN_EXPANSION.md §6, and it is the one that carried: traffic coming up
I-94 from Indiana is already price-shopping before it leaves.

**No row in the table above, deliberately.** Every figure in it is the state's
own arithmetic on a payout, and New Buffalo's payout line is in the Treasury
FY2025 PDF that §7 of MICHIGAN_EXPANSION.md still lists as the open gap:
`michigan.gov` is refused by the egress proxy in the containers this repo is
edited from. An estimated store count in a table whose entire point is that it
is *not* estimated would be worse than a blank.

**It is also the first city whose roster was measured before it was written.**
Detroit and Grand Rapids were seeded from public search and confirmed later; the
container New Buffalo was added from has no route to the open web at all, so
`discover-market.yml` ran first and every platform in `api/market-stores.js` for
this town is a reading rather than a guess. Three shops confirmed of ten leads,
and Lume answered a plain server GET with **935 products** -- the largest single
catalogue this project has read in one request, and still `enabled:false`
because without the store cookie there is no proof which store they belong to.

**And the boundary trap here is the worst on the list**, which is saying
something given the two below. **New Buffalo Township is a separate municipality
from the City of New Buffalo**, with its own council, its own opt-in and its own
Treasury line, and much of the Red Arrow Highway trade sits in it. Unlike
Hamtramck or East Lansing, the shop's own page does not settle it: a Township
shop genuinely *is* in New Buffalo as far as its address, its marketing and
`discover-market.mjs`'s cityOnPage guard are concerned. Nothing short of the
street address against the municipal line answers it. The market is the CITY
until somebody decides otherwise in `api/markets.js`, where that decision belongs
as data.

**East Lansing is a separate municipality** with its own payout and its own six
shops. Merging it into Lansing would be the Coldwater/Monroe mistake at closer
range — and **Detroit has that trap twice over and worse**: Hamtramck and
Highland Park are separate cities *entirely surrounded by Detroit*, with their
own councils, ordinances, licences and Treasury lines. A shop there has a Detroit
mailing address and appears under "Detroit" on every directory. Pleasantrees is
the case that proves it: the menu platform's own slug is `pleasantrees-detroit`
and the shop is in Hamtramck. Nothing short of the shop's own page settles it,
which is exactly what `discover-market.mjs` checks.

---

## 7. What the store discovery can and cannot do

`tools/discover-market.mjs` is built and takes a seed list of urls, de-duplicates
by **host** (a chain's location page and its menu page are one shop), fetches
each, and classifies:

- **confirmed** — its page was read AND names the city. A platform signature
  proves it is a dispensary; only the city name proves it is *this city's*. That
  guard is `fromLume()`'s `expectLocation` moved one layer earlier.
- **candidate** — a lead. Never fetched on the live path, never shown.
- **dead** — fetched and wrong, kept **with its reason** so the next sweep does
  not rediscover and re-add it.

A challenged host is recorded as challenged and handed to the operator's browser,
the same split the harvester makes.

**It refuses to promote anything it could not reach**, which is why it produces
nothing useful from this container — egress is blocked, so every candidate stays
a candidate. It says so on its first line rather than leaving a wall of failures
to imply it. Run it from a machine with normal network access:

```
node tools/discover-market.mjs --market lansing --seeds lansing.txt --probe --out data/lansing.json
```

The seed list is the input this cannot invent. Three ways to get one, cheapest
first: the CRA's own licensee list (authoritative, has addresses), a directory
export, or the operator pasting what they find. **Nothing reaches
`api/markets.js` unverified** — that standard is what makes the Coldwater seven
worth trusting, and it does not move because the roster got bigger.
