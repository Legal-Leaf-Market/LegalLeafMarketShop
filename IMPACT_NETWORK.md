# Impact.com marketplace — what is actually in it for the five sites

Analysis of the Impact marketplace export pulled 11 Aug 2026 (`impact_marketplace_brands.csv`,
10,325 brand programs). Scored with `tools/impact-scan.mjs`, then hand-verified row by row.

**The network is huge. The value in it is not evenly spread, and it is close to the
opposite of what the site line-up would predict.** Legal-Leaf and Nicotia — the two
flagship sites — are the two Impact serves worst. Herbal Leaf, Kawaii Katz and Gear Avail
are where this export pays.

| Site | Merchants worth an application | Best rate found | Verdict |
|---|---|---|---|
| **HLM** Herbal Leaf | **62** | 25% (Encha Matcha, RE Botanicals, Purest Mushrooms) | **Best fit of the five.** Tea + botanicals is a first-class Impact vertical |
| **LLM** Legal-Leaf | 111 scored, but see §3 | 40% (Healthworx CBD) | Deep in CBD, **empty in THCA**; hardware is the real win |
| **KK** Kawaii Katz | 35 | 25% (MAAKE Beauty) | Good, and the JP snack-box cluster is a genuine category |
| **GA** Gear Avail | 26 | 30% (Martinic Audio) | Real supply, low rates — music gear pays 2–10%, not 15% |
| **NM** Nicotia | **5** | 10% (Buitrago Cigars) | **Effectively nothing.** See §6 — this is a policy wall, not a gap |

---

## 1. What the file is

`id, name, domain, landingPage, category, state, payoutLabel, payoutValue` — 10,325 rows,
134 categories. Every row is `state: NOT_APPLIED`, so this is the "brands you could apply
to" catalogue, not an account state.

- **7,977 distinct domains for 10,325 rows.** 1,275 domains carry more than one program.
- **984 rows are "- Creator" programs** — a separate, usually better-paying program for the
  same advertiser (§2).
- **644 rows are Amazon-seller listings routed through ArtemisAds** and carry
  `www.ArtemisAds.com` as their domain rather than the brand's own. The `domain` column is
  evidence, not identity — `Mustela USA` is listed on `babobotanicals.com`, and `Stasis` on
  `takethesis.com` while its landing page is `takestasis.com`.
- Rate distribution: median **10%**, mean 11.6%. 5,123 rows at 10%+, 2,388 at 15%+,
  1,155 at 20%+. 1,399 rows pay a flat fee instead of a percentage; 366 show 0% or blank.

**A 0% row is not a free program.** `EYCE`, `Higher Standards`, `DaVinci` and
`Marley Natural` all show `0%` — the rate is set per partner after approval. Treat 0% as
"rate unpublished", never as "no commission".

## 2. Apply to the Creator program, not the standard one

This is the single highest-value mechanical finding in the file. Where an advertiser runs
both, the Creator program frequently pays more for the same sale:

| Brand | Standard | Creator | Site |
|---|---|---|---|
| cbdMD | 25% | **30%** | LLM |
| PAX | 5%–15% | **15% flat** | LLM |
| Wooden Spoon Herbs | 5% | **20%** | HLM |
| Guitar Center | 5% | **10%** | GA |
| Sonos | 3% | **10%** | GA |
| Music & Arts | 5% | **10%** | GA |
| Lazarus Naturals | 2%–15% | **15% flat** | LLM |
| Smoke Inn | 4% | **10%** | NM |

The pattern holds widely enough to be a default: **before applying to anything in this
file, search the export for the same domain and take the best-paying program.** Sorting by
`domain` surfaces these in one pass.

Read `payoutLabel` too — it changes what the rate means. Tea For Guys' two programs are
both 15%, but one is `Online Sale` and the other is **`Recurring Sales`**, which pays on
repeat orders. For a consumable, that is the one worth having.

---

## 3. LLM — Legal-Leaf Market

**The shape of this is important: Impact has plenty of CBD and no THCA.** Every
cannabinoid brand in the file is a federally-uncontroversial CBD/wellness brand.
There is no THCA flower, no delta-8 flower, nothing that competes on price-per-gram, and
nothing that replaces what the THCA King delisting cost. Searching the whole export for
`thca` returns zero merchants.

So Impact does not restock the shelf. What it does offer is **hardware**, which is a real
gap on `/devices` today:

### Tier 1 — hardware, apply now

| Brand | Rate | id | Why |
|---|---|---|---|
| **Smoke Cartel** | **7%–15%** | 26924 | Full online headshop — glass, grinders, rigs. Direct `/devices` overlap |
| **PAX — Creator** | **15%** | 52569 | Dry-herb vaporizers, the anchor brand of the category |
| **Stundenglass** | 15% | 15452 | Premium gravity bongs. Note `payoutLabel` is `CA Online Sale` — check territory |
| EYCE | rate unpublished | 16300 | Silicone bongs/rigs |
| Higher Standards | rate unpublished | 12394 | Premium accessories |
| DaVinci | rate unpublished | 15561 | Dry-herb vaporizers |
| Marley Natural | rate unpublished | 15828 | Glass and accessories |

### Tier 2 — cannabinoid, if the compliance answer is yes

| Brand | Rate | id |
|---|---|---|
| Healthworx CBD | **40%** | (`hwxcbd.com`) |
| Slumber (CBN) | 20%–40% | `slumbercbn.com` |
| cbdMD — Creator | **30%** | 43864 |
| Innovative Extracts | 30% | 14789 |
| NuLeaf Naturals | 10%–50% | (`nuleafnaturals.com`) |
| FAB CBD | 5%–30% | 26923 |
| Hometown Hero | 15% | 15399 |
| Koi CBD — Creator | 20% | 47285 |
| Cornbread Hemp | 20% | 13034 |
| Lazarus Naturals — Creator | 15% | 42405 |
| Extract Labs | 15% | 11956 |

**The gate is not the rate, it is whether they will approve a THCA-selling publisher.** A
mainstream CBD advertiser on Impact is often contractually barred from partners marketing
intoxicating hemp. That is an application outcome, not something a score can predict —
apply and find out, but do not plan revenue on it.

## 4. HLM — Herbal Leaf Market

**You were right about Tea For Guys, and right about the network for this site.** Tea and
botanicals map onto Impact's `Food & Drink` / `Organic & Eco-Friendly` vocabulary better
than anything else the family sells. 62 merchants, 14 of them at 20%+.

### Tea For Guys — verdict

| id | Program | Label | Rate |
|---|---|---|---|
| 40494 | Tea For Guys | **Recurring Sales** | 15% |
| 44574 | Tea For Guys — Product Reviews | Online Sale | 15% |

`teaforguys.com`, categories `Flowers, Gifts, Food & Drink / Food & Drink / Diet &
Nutrition`. **Apply to 40494** — same rate, but it pays on repeat orders, and tea is
bought repeatedly. 44574 is a content/review placement, worth having as a second program
if they allow both, not instead.

### Tier 1

| Brand | Rate | Note |
|---|---|---|
| **Tea For Guys** | 15% recurring | above |
| **Encha Matcha** | **25%** | Organic ceremonial matcha |
| **RE Botanicals** | **25%** | Organic hemp + herbal apothecary |
| **Purest Mushrooms** | **25%** | Functional mushroom |
| **Wooden Spoon Herbs — Creator** | **20%** | Small-batch herbal — squarely the HLM story |
| West China Tea | 15% | Traditional Chinese loose leaf |
| Balls Deep Tea Company | 15% | |
| St. Francis Herb Farm | 15% | Herbal tinctures |
| VYNEHERB | 15% | |
| Silver Lining Herbs | 15% | |
| SuperFeast | 10%–15% | Tonic herbs + mushrooms |
| Goldthread Tonics | 15% | Herbal tonics |
| Yum Matcha | 20% | |
| Botanic Choice | 8%–15% | Broad herbal catalogue |

### The one to act on first

**`Charlotte's Web — Creator`, id 44451, 10%.** Charlotte's Web is *already an HLM vendor*
(`lib/hlm.ts` line 46) and that handoff is untracked today. This is not a new store — it is
the existing one, with attribution attached. Cheapest revenue in the entire export.

Also present and worth a look for the tea shelf: The Republic of Tea (4%), Upton Tea
Imports (4%), Bird & Blend (2%–5%), Tea Sparrow (5%), TWG Tea (5%–6%), Herbaly (2%–3%).
Rates are low because established tea houses pay low — the 15–25% names above are better
business.

## 5. KK — Kawaii Katz

35 merchants. The standout is a category KK does not currently carry at all: **Japanese
snack/merch subscription boxes**, which pay a flat fee per subscriber rather than a
percentage.

| Brand | Payout | id |
|---|---|---|
| TokyoTreat | **$10.00 / subscription** | 31561 |
| Sakuraco | **$10.00 / subscription** | 31764 |
| yumeTwins | **$10.00 / subscription** | 31763 |
| Japan Crate | **$10.00** | 22343 |
| TokyoTreat Mini Mart | USD5–15 + 10% | 31766 |
| Sakuraco Mini Mart | USD5–15 | 32955 |
| Bokksu | 5% | 17070 |
| Bokksu Market | 5% | 14750 |

Note yumeTwins is *literally* a kawaii merch box — the closest thing in the whole export to
KK's own catalogue.

Others worth applying to: **STYLEVANA 15%** (44246, J-beauty/K-beauty), **tokyo-tiger.com
15%** (34526), MAAKE Beauty 25%, Tokyocanvas 15%, DOKODEMO 3% (23563, Japanese online
store), Yankee Toy Box 20%, Redbubble 2% (11754), Displate 5% (42639).

Benchmark: KK's current vendors pay 10–25% (`lib/data.ts`). A flat $10 per subscription
beats a 15% commission on any order under ~$67, so the box programs are worth more than
their lack of a percentage suggests.

### 5a. Apparel — and the two site-side constraints that decide it

Searched on request, 11 Aug 2026. **There is no dedicated kawaii apparel vendor in this
export.** Hot Topic, BoxLunch, Dolls Kill, YesStyle, Blippo, Smoko, Sanrio, Miniso, Pop
Mart, Jellycat, Squishable, Build-A-Bear, Killstar and Cakeworthy return **zero rows**
between them. Of 2,358 apparel-category rows, 36 carry any kawaii signal by name at all.

More usefully, fit here is **not** decided by aesthetic. Two constraints in KK's own code
decide it first, and both rule out brands that look like perfect matches:

1. **The content filter blocks most of the vocabulary.** `UNSAFE_TERMS` in
   `catalog-shared.ts` blocks `cosplay` outright, plus `crop top`, `mini skirt`,
   `tube top`, `halter top`, `off-shoulder`, `backless`, `strapless`, `low-rise`,
   `tight fit` and `form fitting` — which is most of Y2K/harajuku womenswear. A
   perfectly on-theme kawaii fashion brand passes the taste test and then arrives as an
   almost-empty shelf. **Fit tracks garment TYPE, not style:** graphic tees, hoodies,
   loungewear and socks never trip it; dresses and fashion-forward womenswear do.
2. **`/api/catalog` reads Shopify `products.json` and nothing else.** This disqualifies
   the two best catalogue matches in the entire file — **TeePublic** (2%, id 9550) and
   **Redbubble** (2%, id 11754) — whose anime/kawaii graphic-tee catalogues are enormous
   and neither of which is Shopify. Approval would buy a tracked link and no shelf.

Four were applied for, all publishing 15%. They shipped in `KawaiiKatz#4`, and the
per-vendor counts below are **measured** off a preview deploy via `/api/catalog?debug`,
not estimated:

| Vendor | id | Rate | Fetched | |
|---|---|---|---|---|
| Sydney Sock Project | 52445 | 15% | **428** | Shopify, live |
| Vix Socks | 55649 | 15% | **38** | Shopify, live |
| Tokyo Tiger | 34526 | 15% | **0** | nothing comes back |
| Tokyocanvas | 38358 | 15% | **0** | nothing comes back |

**This is §8's "approval is not listing" trap, caught in the act — and worse than that
entry describes.** Both zeroes report `ok: true`: the fetch did not throw, it just
returned no catalogue. Nothing errors and nothing logs, so a store on the wrong platform
— or a domain merely spelled wrong — is indistinguishable from a shop that is small.
Half of a hand-picked shortlist failed this way. **Run `?debug` and read the per-vendor
count before believing any vendor addition worked.**

On-theme but gutted by constraint 1, listed so nobody re-finds them and thinks they were
missed: ModCloth (10%, id 39714) is the closest aesthetic match among fashion brands —
whimsical, retro, kitschy — but it is dresses and womenswear. Same for Retro Stage (10%,
17325), Cider (3%, 26213) and SHEIN (1–15%, 41181).

**A classifier bug surfaced by all this, worth knowing because it was never
apparel-specific.** `categorize()` matches substrings in listed order with the apparel
rule eleventh, so "Toddler T-Shirt" filed under `learning` (on `toddler`) and "Youth Tee
Ramen Bowl" under `kitchen` (on `bowl`). It was already happening to the existing shop:
Kore Kawaii's "Boba Tea Cat Cup T-Shirt" was in Kitchen & Lunch and "Shiba Inu Ramen
T-Shirt" in Snacks & Drinks. Fixed in the same PR. The fix was validated by A/B-ing both
classifiers over all 2,079 products in the live payload — **not** the 30-row seed list,
which missed the whole thing, and which also hid that the first cut of the fix was
dragging 56 Plushible Snugibles out of Plushies.

## 6. NM — Nicotia Market

**Five candidates in 10,325 rows, and that is the finding.**

| Brand | Rate | id |
|---|---|---|
| Buitrago Cigars | 10% | 47676 |
| Smoke Inn — Creator | 10% | 37318 |
| GotPouches.com | 15% | 54165 |
| ZenxVape | 1%–25% | 54952 |
| Vape.co.uk | 4% (UK) | 30370 |
| Northwoods Humidors | 3.5% | 26046 |

Not one of Nicotia's 20 current stores is in this network — no Nicokick, no Black Buffalo,
no EightVape, no Vaporesso, no Snus O'Clock. Searching the export for `nicotine` returns
one real merchant.

**This is a network policy wall, not a sourcing failure.** Mainstream affiliate networks
restrict tobacco and nicotine advertisers, so nicotine brands run their own in-house
programs — which is exactly how Nicotia's registry was built in the first place. Do not
spend time mining Impact for NM. The current direct-to-merchant approach is the right one
and there is no shortcut here.

`GotPouches.com` at 15% is the one genuinely new name worth an application.

## 7. GA — Gear Avail

26 merchants, and the honest headline is that **music gear pays badly**. This is a
low-margin retail category and the rates show it.

| Brand | Rate | id |
|---|---|---|
| **Martinic Audio** | **30%** | 4482 (software instruments — software pays, hardware doesn't) |
| **Donner Music** | **15%** | 43895 |
| **DistroKid** | **15%** | 20946 (artist services, not gear) |
| **EPZ Audio** | 15% | 55421 |
| **KLH Audio** | 15% | 40383 |
| Guitar Center — Creator | 10% | 27480 |
| Music & Arts — Creator | 10% | 53772 |
| Universal Audio | 10% | 39245 |
| Sonos — Creator | 10% | 45281 |
| Zager Guitars | 10% | 23170 |
| HILS Guitars America | 10% | 27593 |
| Spitfire Audio | 8% | 51129 |
| Native Instruments | 6% | 29910 |
| Plugin Alliance | 6% | 30401 |
| iZotope | 6% | 30400 |
| American Musical Supply | 5% | 47665 |
| Musician's Friend | 5% | 14291 |
| Positive Grid | 5% | 15549 |
| Fender | 2%–4% | 33985 |
| Elgato | 2% | 13666 |

**Andertons is not in this file.** Zero rows. That approval came from somewhere else
(Awin or direct), so it is additive to everything here rather than a duplicate.

The structural point: **software and services outpay hardware roughly 3:1** in this
vertical — Martinic 30%, DistroKid 15%, Spitfire 8%, Plugin Alliance 6% against Fender at
2–4%. If GA is to be built around Impact supply, plugins/sample libraries/artist services
should carry the margin and the instrument retailers should carry the traffic.

---

## 8. Traps in this export

1. **Apply to the Creator variant** (§2) — same advertiser, often double the rate.
2. **Read `payoutLabel`, not just `payoutValue`.** `Recurring Sales` ≠ `Online Sale`
   ≠ `Trial Signup` ≠ `Online Lead`. Guitar Center's `$0.00` row is a lead-gen program for
   their lessons business, not a broken listing.
3. **0% / blank means "rate unpublished"**, not free.
4. **`domain` is unreliable** — 644 ArtemisAds rows, plus brands listed on a sibling's
   domain. Confirm on the landing page before writing a store entry.
5. **Territory is in the label, not a column.** `CA Online Sale` (Stundenglass),
   `Stylevana-AU`, `Online sale-EU` (Donner), Naturecan's per-country rows. This family
   publishes one national price per product, and §"CBD Hemp Direct" in `CLAUDE.md` already
   documents what a geo-restricted merchant does to that promise.
6. **Applying is not listing.** Everything in `STORES` still needs a lawful public
   catalogue endpoint to scrape (`CLAUDE.md` §7). An Impact approval supplies a tracked
   link and a commission — it does not supply a feed. For merchants with no readable
   catalogue, the honest options are a hand-authored page (`greekglass.html`) or nothing.
   **§5a is this trap measured rather than asserted:** two of four hand-picked vendors
   returned no catalogue at all, and both reported success while doing it. Budget for
   roughly half a shortlist being unlistable, and verify per vendor before believing
   otherwise.

## 9. Rerunning this

```
node tools/impact-scan.mjs <export.csv>              # top 20 per site
node tools/impact-scan.mjs <export.csv> --site HLM   # one site
node tools/impact-scan.mjs <export.csv> --csv out/   # full ranked CSVs
```

Zero dependencies. Rows marked `*` are merchants the site already carries.

**What the scanner cannot do, and why the lists above were hand-checked on top of it.**
It scores names, domains and Impact's category vocabulary. It therefore finds "Tea For
Guys" and misses "PAX" — a vaporizer brand whose name says nothing about the product.
Every Tier 1 entry above came from a curated pass over brands known to matter to each
vertical, verified against the export by id. If you re-export, run both: the scanner for
recall, a read-through of the 20%+ rows for the names it cannot know.
