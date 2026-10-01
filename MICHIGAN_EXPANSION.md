# Michigan, statewide — how big is it actually

Research written 2026-08-16, in answer to "how many towns and dispensary locations are we
talking about?" **Status: research. Nothing built.** No code changes accompany this file.

The headline is two numbers, and then a third that changes what they mean.

---

## 1. The two numbers

**~234 towns. ~840–870 storefronts.**

Precisely, from Michigan Treasury's FY2025 adult-use marijuana distribution (published
24 Feb 2026, paid out March 2026):

| | count |
|---|---|
| Cities hosting at least one licensed retail store or microbusiness | **114** |
| Villages | **39** |
| Townships | **81** |
| **Municipalities, total** | **234** |
| Tribes | 4 |
| **Jurisdictions receiving a per-store payment** | **238** |
| Counties receiving a payment | 75 |
| **Licensed retail stores + microbusinesses that qualified** | **868** |
| Paid per license, to the municipality *and* again to the county | $54,017.10 |

That is the cleanest census that exists of *where the stores are*, and it exists for a
reason unrelated to us: the state pays out per store, so it has to count them per town.

**The store count from the regulator, which is the number to actually plan against:**

- **836 licensed retailers, June 2026** (CRA), down from **845 in June 2025**.
- 851 adult-use retailers + 107 medical provisioning centers, September 2025 (CRA) — the
  all-time peak.
- 868 stores + microbusinesses qualified for the FY2025 payout, which spans the year and so
  counts stores that have since closed.

Call it **~836 open storefronts across ~234 municipalities** — an average of **3.6 shops per
town**, which is almost exactly the Coldwater number. Coldwater's seven is a *large* town for
this market, not a small one. Roughly **74% of Michigan's ~1,856 municipalities have opted
out entirely** and will never have a shop to read.

---

## 2. The third number, and it points the other way

**The Michigan market is contracting, and 2026 is the year it started showing up in the
store count.**

- Adult-use sales **$3.17B in 2025**, down from $3.27B in 2024 (−3.1%).
- **H1 2026 ≈ $1.48B, down 5.3%** year over year.
- Average retail ounce **$58.20 in Dec 2025**, down from $69.20 a year earlier. (`MI_AVG_OZ
  = 58.18` in `api/coldwater.js` is this figure and is roughly current.)
- **550+ dispensaries and cultivators have closed** since sales began in Dec 2019.
- A **24% wholesale tax** took effect and is being blamed for closures — Higher Love shut
  five of its nine UP stores; a repeal push is live in the legislature.

None of this argues against the expansion. Three of them argue *for* it: falling prices, a
new tax landing unevenly on retailers, and stores closing are exactly the conditions under
which a shopper starts comparing on price, and nobody in this market publishes that
comparison. What it does argue against is **treating the store list as a fixed target you
finish**. A statewide shelf is not a project with an end date; ~1 store per month is closing
statewide on net, and a comparison site showing a shop that shut is worse than one that never
listed it.

---

## 3. Why "how many towns" turns out to be the wrong unit

This is the thing the Coldwater build already taught us, and it is worth restating because
the statewide numbers make it much sharper.

`api/coldwater.js` opens with the finding: **seven shops, six platforms.** Lume on its own
Next.js, Green Tree on Jane, Sapura and Exclusive on Dutchie, The Dude Abides on Flowhub,
Herbology on Cannavate, Banzen on Tymber/Blaze. There is no single integration to write for
one town of seven shops.

If that ratio held statewide, 836 shops would mean ~700 platforms and the project would be
impossible. **It does not hold** — the tail consolidates hard onto the same handful of
platforms Coldwater already forced us to identify. Coldwater is unusually fragmented for its
size, which was bad luck for the pilot and is good news for the expansion: **the platform
work is very close to done.** Six adapters is roughly the whole state.

So the unit of work is not the town and it is not the store. **It is the platform, and after
that the chain.** A town is a configuration line, exactly as the `OTHER TOWNS` note in
`api/coldwater.js` already suspected.

**The one that is easy to get backwards:** the two platforms with the largest share are the
two that are walled. Dutchie (6,500+ dispensaries in the US and Canada) and Jane both answer
a *server-side* request with a Cloudflare challenge — measured, repeatedly, in this repo.
That is not an obstacle to route around, and this project will not try. It is the reason
`public/coldwater-collector.js` exists at all, and it means the statewide split is not
"how many platforms" but **"how many stores are server-readable, and how many need a human
with a browser."** Those two halves have completely different costs, and everything below
turns on the ratio between them.

---

## 4. The chain axis, which is where the leverage is

A chain runs one platform across every store it owns. So one adapter, correctly written,
does not buy one store — it buys the whole chain, in every town it trades in, at once.

| Chain | MI locations | Platform | Status here |
|---|---|---|---|
| **Lume** | **38** | own Next.js, server-rendered `__NEXT_DATA__` | **adapter built and tested** (`test-coldwater-lume.mjs`); needs a store cookie |
| Skymint | ~20 | — | not investigated |
| JARS | ~20 | — | not investigated |
| House of Dank | 12 | — | not investigated |
| | **~90** | | |

**~90 stores, about 11% of the state, sit behind four chains** — and the largest of the four
already has a finished, tested adapter sitting in this repo. Lume's 38 stores are 38
different towns' worth of coverage from a component that is *already written*, and per
`api/coldwater.js` those towns include **New Buffalo and Monroe, the #1 and #2 markets in
Michigan** — both of which dwarf Coldwater.

That is the single highest-value thing on this list and it is nearly free. The Lume adapter's
one open question is the `storeCookie` that selects which store the server renders, and
`fromLume()` already refuses to return anything unless the payload names the expected town —
so the failure mode of getting it wrong is "no rows", not "Monroe's prices under a Coldwater
heading". The mechanism to fan one adapter across 38 towns is a loop over a store list.

---

## 5. The manual arithmetic, stated plainly

You said you can handle the manual updating, and I believe you — but the number deserves to
be on the page rather than discovered in month two, because the shape of the problem changes
completely depending on which half of the state a shop falls in.

For a shop that needs the browser collector, one capture is realistically **90 seconds to 2
minutes**: open the menu, wait for it to render, click the bookmarklet, confirm the send.

- **836 shops × 2 min ≈ 28 hours** for one complete statewide pass.
- Michigan menus and prices change **daily**. A weekly refresh is the loosest cadence at
  which a price comparison is still honestly a price comparison.
- At a sustainable ~25 captures/hour, **one person sustains roughly 40–60 shops at weekly
  freshness**, or ~150 at monthly.

So: **manual capture alone covers about 5–7% of Michigan.** That is not a reason not to do
it — it is the reason the split in §3 is the whole ballgame. Every store moved from the
collector column to the server-adapter column costs zero minutes per week forever.

The honest framing: **the collector is how you enter a town, not how you hold one.** It is
also the only thing that works for the walled Dutchie and Jane stores, which is why it can
never be retired.

**The staleness rule this creates, which the site does not currently enforce:** a captured
shop needs a visible "as of" and needs to drop off the shelf when its capture ages out. The
current `/api/coldwater` merges captures fresh on every request and caches only the scrape —
correct, and it means a capture appears immediately — but nothing ages a capture *out*. With
seven shops you remember. With two hundred you do not, and the failure is a shopper driving
to a price that was true three weeks ago. That is a real gap and it is prerequisite to
scaling past one town, not a follow-up.

---

## 6. What this suggests, concretely

Not "the whole state." Three tiers, in this order:

1. **Lume's 38 towns.** Finish the cookie, loop the adapter over the store list. Zero manual
   effort per week, includes the #1 and #2 markets in Michigan, and the code is written. This
   is the largest single jump available and it is mostly configuration.
2. **The other three chains, ~50 stores.** Read each one's platform off its own page source
   the way Coldwater's seven were read. Some will land on adapters that already exist.
3. **Hand-picked independents, by market rather than by proximity.** Border towns first —
   New Buffalo and Monroe are border markets for a reason, and out-of-state traffic is
   already price-shopping before it drives. This is where the collector's 40–60 shop budget
   should be spent, not on covering a town exhaustively.

The thing to *avoid* is completing towns. A town is only complete for about a week, and the
value of the 6th shop in Coldwater is far below the value of the 1st shop in Monroe.

---

## 7. What I could not verify, and how to close it

Two gaps, and one of them is easy to close from a machine with normal network access:

- **The per-town license counts.** They exist, in one authoritative place: the Treasury
  FY2025 distribution PDF, which lists every municipality with its license count (that is how
  the $54,017.10 × N payment is computed). **`michigan.gov` is refused by the egress proxy in
  the containers this repo is edited from**, so I could not pull the table. Any browser can.
  That PDF is the definitive answer to "which towns, and how many in each", and it is worth
  having as a CSV in this repo, because it also ranks the state by market for tier 3 above.
- **Per-city counts from directory aggregators are not usable and should not be cited.** They
  disagree by an order of magnitude — Detroit came back as both 155 and 35, Bay City as 60,
  12 and 1, across four sites, in the same search. They are counting different things
  (cannabis-adjacent businesses, claimed listings, active licenses) and none of them says
  which. The Treasury table is the only clean source; everything else here that is
  town-specific comes from CRA or Treasury for that reason.
- **The platform mix statewide is inferred, not measured.** §3's claim that six adapters
  covers most of the state is an extrapolation from a seven-shop sample. The way to measure
  it is the way Coldwater's was measured — read the page source — and `?dissect` already does
  exactly this. Running it over the top ~50 stores by market would turn §3 from a reasonable
  assumption into a number, and it is the check to run before committing to any of §6.

---

## Sources

- Michigan Dept. of Treasury, *FY 2025 Adult-Use Marijuana Distributions* (24 Feb 2026) —
  234 municipalities / 4 tribes / 75 counties, 868 licensed stores + microbusinesses,
  $54,017.10 per license.
- Michigan LARA press release, *Nearly $94 Million in Adult-Use Marijuana Payments for Fiscal
  Year 2025* (3 Mar 2026) — 114 cities, 39 villages, 81 townships, 313 entities total.
- Michigan Cannabis Regulatory Agency monthly statistical reports — 836 retailers June 2026
  vs 845 June 2025; 851 adult-use retailers + 107 provisioning centers Sept 2025; average
  ounce $58.20 Dec 2025.
- MJBizDaily / Detroit Metro Times, 2026 — 24% wholesale tax, closures, 550+ businesses
  closed since Dec 2019, H1 2026 sales −5.3%.
- Chain location counts from each operator's own store-locator pages, Aug 2026.
- `api/coldwater.js` — the seven-shops-six-platforms finding, the Dutchie and Jane walls, the
  New Buffalo / Monroe market note, `MI_AVG_OZ`.

---

# Part II — the option space, and the one rule that spans all of it

Added 2026-08-16. Part I answered "how big is it". This is "how could it be collected",
laid out so the options can be compared rather than argued.

## 8. The rule that comes first, because it constrains every option

**The operator's own browser capture is never retired, never skipped, and always layers on
top — even when an automated source has already filled every field.**

That is a requirement, not an optimisation, and it survives no matter which options below get
built. Two reasons it has to be stated as a rule rather than left to emerge:

- **It is the only route to the walled stores.** Dutchie and Jane answer a server-side request
  with a challenge (§3). Every automated option below is blind there, permanently. If the
  manual path ever becomes the fallback that automation retires, the shelf loses those shops.
- **A human sees what no reader can.** Whether the case is actually stocked, what the budtender
  says is moving, an in-store-only deal, a handwritten sign. None of that is in any DOM. This
  is the "top level colour", and it is worth *more* at 100% automated coverage, not less,
  because it is then the only thing the automation cannot supply.

### 8a. Two places the current code breaks that rule

**Store level — `api/coldwater.js:1426`.** A capture replaces that store's scraped rows:

```js
for (let i = products.length - 1; i >= 0; i--) if (products[i].storeKey === s.key) products.splice(i, 1);
products.push(...mapped);
```

The comment gives the correct reason — "a shop read both ways would appear twice at two
prices" — and with exactly one capture source, replacement was the right call. With a second
automated source posting to the same store it becomes destructive: a thin manual capture (the
DOM layer, or a scroll that stopped early) deletes a rich harvest and the shelf goes backwards.
Manual would be "on top" by demolition.

**Collection level — `readIngest` in `api/coldwater-ingest.js:329`.** Collections already exist
per store, each with its own `source` label, which is exactly the seam a second collector needs.
But the merge is keyed on lowercased product name and "later collections win", where later means
`Object.keys()` order — **storage insertion order, not authority**. Whether manual beats headless
would depend on which was written first.

### 8b. The spec that fixes both

**Declare rank; never infer it from order.**

```
rank 0  adapter        server-side fetch, api/
rank 1  headless       injected collector, scheduled
rank 2  manual         operator's own browser        <- always highest, always
```

Three rules, and the third is the one that matters:

1. **Merge at the row, not the store.** Join on the **batch tag** where present — the repo
   already establishes it as the durable key ("names drift, prices change and SKUs are per-shop
   while a tag is the package") — falling back to normalised name + size via `labStrainKey()`.
2. **Higher rank wins per FIELD, not per row.** A manual capture that carries a price and a deal
   but no image does not blank the image a harvest supplied.
3. **A higher rank NEVER deletes a row it simply did not see.** Only a fresh capture *from the
   same source* replaces that source's previous rows for the store. This is what makes "always
   on top" additive rather than destructive, and it preserves the original anti-duplication
   guarantee, because the row-level join is what stops the double listing — not the splice.

**Plus a colour layer that automation has no field for**: shelf-observed deal, stocked/not,
staff note, photo-from-the-case. Rank 2 only, never overwritten, rendered even when every
scraped field is full. This is the part that must stay valuable at full automation.

---

## 9. Every option, so they can be triangulated

Reach figures are estimates extrapolated from the seven-shop Coldwater sample (§3) and are
the thing §7 says to measure before committing. They are not measurements.

| # | Option | Reach (of ~836) | Runs where | Cash cost | Freshness | Walled stores? | Build |
|---|---|---|---|---|---|---|---|
| **A** | **Manual bookmarklet** *(built)* | 40–60/wk | operator browser | $0 | as captured | **yes — only option that is** | done |
| **B** | **Server adapters** in `api/` *(Lume built)* | ~150–250 | Vercel | $0 | per cron | no | ~1 wk/platform |
| **C1** | **Headless + injected collector**, own box | ~400–550 | your machine | $0 | nightly | no | days |
| **C2** | same, cheap VPS | ~400–550 | $5–20/mo VPS | low | nightly | no | days + ops |
| **C3** | same, **GitHub Actions** cron | ~400–550 | GH runners | $0 within free tier | nightly | no | days, **no hardware** |
| **C4** | same, hosted browser (Browserless/Browserbase) | ~400–550 | vendor | $50–200/mo | nightly | no | days |
| **D** | **Merchant-authorised feed** — ask the shop | any that say yes | n/a | $0 | theirs | **yes** | per conversation |
| **E** | **Platform partner API** (Dutchie/Jane/Flowhub) | very large | Vercel | varies | live | **yes** | BD-gated |
| **F** | **Licensed aggregator** (Weedmaps/Leafly/Headset/BDSA) | most of state | Vercel | $$$–$$$$ | theirs | **yes** | days + licence review |
| **G** | **Public state data** (CRA roster, Treasury table) | roster only | Vercel | $0 | monthly | n/a (no prices) | ~1 day |
| **H** | **Shopper-submitted prices** | long tail | site | $0 | crowd | **yes** | ~1 wk + moderation |

### Notes that decide between them

- **C3 is the sleeper.** A scheduled GitHub Actions workflow runs Playwright on someone else's
  hardware, free within the tier, with no VPS to keep alive and no home machine that has to stay
  awake. It posts to `/api/coldwater/ingest` exactly like the bookmarklet does, so **the deployed
  site needs no change at all** and the zero-dependency rule (§1, §11) is never touched — the
  browser lives in CI, not in `api/`. This is the cheapest path to the biggest reach.
- **B vs C is not either/or, and B is not obsolete.** A server adapter is one cheap HTTP call;
  headless is ~10–20s of browser. Where a store is server-readable (Lume's `__NEXT_DATA__`, the
  Dude Abides' 960 KB storefront) the adapter is strictly better and should stay. Headless is for
  what fetch cannot render — and its real prize is that it needs **no per-platform work**, so it
  covers the unknown tail without anyone identifying Tymber's or Cannavate's product call.
- **D is the only honest route to Dutchie and Jane, and chains make it cheap.** One conversation
  with Lume is 38 stores; Skymint ~20; JARS ~20. A merchant asking their own platform for their
  own feed is not a bypass of anything. This is also the highest-leverage *non-engineering* option
  on the table and it costs nothing but email.
- **F needs its licence read before anything is built.** Aggregator terms commonly forbid exactly
  what this site does — republishing their prices as a comparison. Cheap to check, expensive to
  discover late.
- **G buys no prices but fixes §7's gap**: the CRA licensee roster and the Treasury per-town table
  give the authoritative store list and market ranking that tiering depends on. Small, and it
  unblocks targeting.
- **What is off the table, and why it is not a judgement call:** stealth headless, TLS/fingerprint
  spoofing, and CAPTCHA solvers against the challenged platforms. Plain headless does not quietly
  work there — being detected is what the challenge is *for* — so this is not declining a working
  technique, it is declining the evasion layer that would be required to make it work. That is the
  standing rule in CLAUDE.md, and it is what keeps the collector's own argument true: nothing is
  bypassed because nothing was denied, the page was served.

### Two combinations worth costing

- **Cheapest credible statewide:** G (roster) + C3 (headless on Actions) + B (keep Lume, add
  adapters only where fetch already works) + A (manual, permanently, aimed at the walled shops).
  Cash cost ≈ $0. Reach ≈ 600–700 of 836, with the remainder human-covered at your 40–60/wk.
- **Fastest to broad coverage:** F (licensed feed) for the base layer + A on top for colour.
  Buys the whole state at once and skips every adapter, but is a real recurring bill and the
  licence may forbid the one thing the site is for. Worth one afternoon of reading before it is
  ruled in or out.

**Prerequisite to all of them, and it is not optional:** §5's architecture inversion. Today
`/api/coldwater` scrapes on request and does one sequential `readIngest()` per store per request.
That is fine at seven stores and breaks at any of the reaches above, whichever option supplies
them. Sweep on a schedule, write rows to storage, serve the page from one read.

---

# Part III — agile, statewide, quiet

Decision recorded 2026-08-16: **not grassroots.** Not town-by-town, not visible growth, not
local presence built one market at a time. Build coverage quietly across the state and arrive
already statewide. Part II's ladder is what makes that possible, and it is now built
(`api/coldwater-merge.js`, `test-coldwater-merge.mjs`).

## 10. What the shift actually changes

**It inverts which lane carries volume, and the ladder already encodes that.** Grassroots meant
manual-first: the operator enters a town, captures its shops, moves on. Statewide-quiet means
automation-first, and the operator's lane becomes two much more valuable things:

- the **only** lane that reaches the walled Dutchie and Jane stores, and
- the **colour** on top of everything the machines fill in.

That is exactly the ladder in §8b, which is why the decision needs no redesign. `manual` stays
at the top of the rank order — not because it supplies the most rows, but because when it
speaks it is speaking about the shelf this morning.

## 11. The one distinction to keep straight

Two different things both get called "silent", and only one of them is on the table.

**Quiet go-to-market — fine, and this architecture suits it.** Not announcing the roadmap, not
pre-launching town by town, not telegraphing which markets are next. Nothing about the code
cares, and there is nothing to defend.

**Unattributed reading — not on the table, and it is the practical answer as much as the
principled one.** `api/coldwater.js` sends a descriptive User-Agent carrying a contact URL
"so anyone who wants us to stop can find us without having to guess", keeps one request per
store per refresh with spacing, caches so real traffic almost never reaches a shop, and gives
every store an `enabled` kill switch that is "the first thing to flip if a shop asks". Those
courtesies are what make a statewide read survivable rather than a week from an IP ban — the
file says so in its own header. Stripping them to be less visible would convert a defensible
read into a covert one *and* remove the thing keeping it alive at volume. Going quiet to the
market is a strategy; going quiet to the merchants is how this ends early.

So: same UA, same spacing, same kill switch, at 836 stores as at 7. Scale is a reason to hold
those tighter, not looser.

## 12. The risk this trade creates, and it is a real one

**Grassroots was self-correcting and quiet-statewide is not.** Entering one town at a time
means local shoppers catch a wrong price fast and loudly. Arriving statewide overnight means
nobody is watching any particular market, and the failure mode is uniform presentation of
non-uniform freshness: 400 stores harvested last night sitting beside 400 last touched three
weeks ago, rendered identically, with the stale ones ranking *better* because their prices are
older and therefore lower.

That makes two items from Part I stop being follow-ups:

1. **Capture expiry.** Rows age off the shelf on a per-store clock. Nothing currently expires a
   capture; at seven shops the operator remembered, at 836 nobody can.
2. **Visible freshness, per store, on the card.** Not a global "Live" stamp — a per-store "as
   of", because under this strategy the variance between stores is the whole risk.

Both are cheap. Neither is optional once the shelf is statewide, and the ranking interaction is
the part that makes them urgent rather than tidy: stale data does not merely sit there, it wins.
