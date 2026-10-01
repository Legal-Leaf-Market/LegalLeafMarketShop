# Budtender Concierge — Build Plan

An AI buyer's agent embedded in legal-leafmarket.com. Talks to visitors about what they
want, teaches them something true, and assembles a multi-store cart.

Status: **v1 built, not yet validated against traffic**. Written 2026-08-07. Updated 2026-08-11.

> **What changed on 2026-08-11.** Two things this document called future work are done, and one
> paragraph in it was already stale when it was written down.
>
> - **v0 (COA mining) is complete**, not "in progress". `api/coa-data.js` holds **1,220 parsed
>   records**, 1,178 of them with a measured `thca` **and** `totalThc`, plus a 0–100 `trust` score
>   and the `flags` that explain every deduction. The decarb argument this whole plan rests on is
>   therefore available to query today rather than after a mining project. Section 3 has been
>   corrected.
> - **v1 is built**, server and client: `api/concierge.js` plus an additive `ll-concierge` block on
>   `/`, with `test-concierge.mjs` (92 assertions) and `test-concierge-browser.mjs` (23, in real
>   Chromium over the DevTools protocol, no Playwright dependency) beside them. It is read-only, as
>   Section 4 said it would be if the cart handle blocked — it still does.
> - **The cost model in Section 6 was measured and one of its assumptions was wrong.** Prompt caching
>   is worth ~30% here, not the 5–10× this document feared, because the prefix is small — the COA
>   corpus is queried through tools rather than stuffed into the prompt. That reopens the provider
>   question in Section 8 in the owner's favour.
> - **The voice is now a parameter, not a constant.** That is a direct consequence of reading
>   lume.garden (see `LUME_INTEGRATION.md`): the same tool loop serves the stoner-register budtender
>   this document specifies and a calm sommelier register aimed at the wellness-curious and
>   first-timers, who that register will never reach. Deciding it now cost nothing; discovering it
>   after v1 would have been a rewrite.
> - **Lume's other borrowed idea is the cost model.** Lume answers its first question with
>   arithmetic and only then reaches for its server. `GET /api/concierge?mood=` does the same over
>   real priced inventory: a shopper who taps a mood chip gets a priced, sourced pick for **zero
>   model tokens**, and the model is only invoked when they ask something a sort cannot answer.

---

## 1. What makes this different

Cuddles.ai and every dispensary bot is a chat layer over **one store's menu**. This one sits
on top of a **cross-store, price-normalized catalog** — 6,352 products from 16 stores with
`perG` already computed. That lets it answer a question no dispensary bot structurally can:

> "Cheapest indoor indica-leaning flower over 24%, at least 28g, free shipping, COA I can read."

The site already has a **multi-store cart** (`public/index.html:1236`, "Build here · checkout
at each store"). So the bot's deliverable is a assembled basket, optimized across stores on
price-per-gram *plus* shipping — not a product recommendation.

**Success metric: cart adds.** Once the user hits checkout they leave through an affiliate
link and are out of scope. `/api/track` already logs outbound clicks from the cart
(`index.html:1592`).

---

## 2. Decisions locked

| Question | Decision |
|---|---|
| Which site first | Legal-Leaf (richest catalog, most engaged audience) |
| Scope | Add to the Legal-Leaf cart only. No checkout, no payments, no fulfillment. |
| Voice | Stoner register + skeptical teaching. Speaks the dialect, never repeats the myths. |
| Access | Open to anonymous visitors. Account is an upsell, not a toll booth. |
| Strain data | Built from our own COA corpus. **Not** scraped from Leafly/Reddit. |
| Model | Build on the best model available; add cost routing when volume justifies it. |

---

## 3. The data problem, and the answer

The catalog has `type` (indica/sativa/hybrid), `grow`, and a regex-scraped `potency`. It has
**no terpene data at all**. Measured live on 2026-08-07:

```
6,352  products total
1,230  coa references -> 1,071 UNIQUE files
  516  with parsed potency
```

Concentrated in a handful of stores: Puffy THCa 1,053 refs, THCA Small Buds 126, Binoid 21,
THCA4Cheap 20, Grasscity 10.

**The COA corpus is the strain database.** It beats a scraped Leafly dump on every axis:
measured numbers instead of user-voted vibe tags, attached to products we can actually sell
(no name-matching problem), legally ours to use, and not copyable without redoing the work.

### What the COAs actually contain — verified 2026-08-07

Sampled four labs. **All files are PNG/JPG images — zero PDFs.** COA detection is a filename
regex on product gallery images (`products.js:16`), so there are false positives: Grasscity's
10 are "char**coa**l filters."

Four labs seen — PharmLabs San Diego (Puffy), FESA Labs (Small Buds), Badger Labs
(THCA4Cheap), and a CBD lab cert (Binoid). ~~Every one is cannabinoid-only. No terpene panel
on any of them.~~

> **WRONG, corrected 2026-08-11.** That sentence, and "**no terpene data at all**" in the paragraph
> above it, were both false — and they were false in the expensive direction, because every surface
> downstream believed them. `api/coa-blacktie.js` holds **`terps` and `totalTerps` on 37 records**
> plus a **`safety` panel on 39**, parsed from Black Tie's FESA *full-panel* PDFs. And since
> `attachLab()` assigns the whole record (`p.lab = d`), they have been **riding `/api/products` in
> production, unused, the entire time**: measured on a live pull, **36 products carry a terpene panel,
> 24 of them in stock**.
>
> Real analytes, real percentages, named lab, dated sample — ß-Myrcene, α-Humulene, Nerolidol,
> δ-Limonene, Linalool, Camphene, Fenchol, 3-Carene, with a `totalTerps` between about 2.0 and 3.2.
>
> The sampling was the flaw, not the parsing: four labs were inspected and the conclusion was
> generalised to the corpus. The concierge's prompt then told the model *"this catalogue has no
> terpene data at all"*, which would have had it deny data it was holding. Fixed, and
> `test-lineage-terps.mjs` now asserts the panels survive into the projection so the claim cannot
> regress to "we have none" a third time.
>
> What remains true: the OTHER labs' page-1 images are cannabinoid-only, so the page-2 retrieval
> below is still the route to terpenes for the rest of the catalogue.

Two are explicitly "Page 1 of 4" / "Page 1 of 5" — the remaining pages
aren't linked as images, and that's likely where terpenes and safety detail live. They carry
QR codes and lab sample IDs, so lab-portal retrieval is a later avenue.

Extractable from page 1, reliably:

- THCa %, Δ9-THC %, **Total THC %**, Total Cannabinoids %
- Minor cannabinoids — CBG, CBGA, CBN, CBC, CBD, CBDA, CBDV, THCV, Δ8
- Lab name, sample ID, batch, test date, matrix (Plant vs Concentrate)
- Safety panel pass/fail where present (FESA includes pesticides / mycotoxins / heavy metals /
  microbial)

**The Total THC number is the prize.** Vendors advertise THCa; the real post-decarb figure is
lower. 9 LB Hammer: 33.07% THCa → **29.26% Total THC**. Apple Jacks: 27.85% → **24.69%**. The
bot showing that math against a real lab report is the entire skeptical-teaching thesis,
backed by data no competitor has assembled.

### COA trust score — a product this data enables

We found a product titled "Dank Toad" whose attached COA is for "**Dank Flamingo**." That's
either a mis-attached report or a reused image. Either way it's detectable, and it generalizes
into a per-product trust signal: does a COA exist, does the strain name match, how old is the
test, did safety pass, does advertised potency match the lab number. Nobody else has that.

### The three layers

**Layer 1 landed, 2026-08-11.** `api/coa-data.js` is the generated dataset: 1,220 products keyed by
the same id `api/products.js` emits, carrying `thca`, `totalThc`, `d9`, `cbd`, `total`, `lab`,
`sample`, `tested`, `matrix`, `minors`, a 0–100 `trust`, and `flags`. `attachLab()` hangs it on each
product as `p.lab`, and **it rides `/api/products` in the JSON**, which is why `api/concierge.js`
imports no COA module at all: a second reader of the corpus is a second copy of the trust rules to
drift out of sync, and this catalogue has paid that bill twice already.

The flag histogram over the corpus is the part worth knowing, because each flag is a teaching moment
the concierge can use rather than a defect to hide: `coa_page_1_only` 794, `coa_stale` 495,
**`advertised_potency_off` 235** (the store's own claim disagrees with the store's own sheet),
`coa_name_mismatch` 67 (the Dank Toad / Dank Flamingo problem, generalized and counted),
`coa_strain_unverifiable` 18, `safety_not_pass` 3. Trust lands 483 at 90+, 617 at 70–89, 113 at
50–69, 7 below 50.

1. **Parsed COAs** — real cannabinoid percentages + trust signals per product. Fixes the
   potency gap with measured numbers instead of a regex.
2. **Model knowledge** — lineage, chemovar facts, terpene pharmacology. Written, not scraped.
   ~~Since the COAs carry no terpene data, this is the only terpene source until lab-portal
   retrieval lands.~~

   **Reshaped 2026-08-11, and split in two, because the two halves are different kinds of claim.**

   **Lineage is now extracted, not written.** `parseLineage()` in `api/products.js` reads the parents
   out of the vendor's own product description — a string the scraper *already fetches* for
   `isOffcut()` and `coaFromBody()`, so this needed no new crawl and no new egress. It records
   `{parents, stated, source:'vendor-description'}`, keeping the verbatim clause so a reader can check
   it against the vendor's page. This matters because the catalogue has no head to write a strain
   table through: 1,219 distinct flower strain keys, **79% of them appearing exactly once**, covering
   58% of flower products. Writing the top 250 by hand would reach 41%; the breeders' own copy scales
   where a hand-written table cannot.

   Deliberately conservative: a labelled prefix (`Lineage:` / `Genetics:` / `Parents:`) or an explicit
   "cross of A and B". A bare `A x B` is **not** matched, because product copy is full of quantities
   ("10 grams (2 x 5 gram bags)", "(3x) 1 Gram"), and a comma terminates the capture rather than
   separating parents — which drops `Genetics: Gelato 41, Zkittlez` to a miss. Every one of those is a
   deliberate miss: **inventing a lineage is worse than missing one.**

   **Terpenes are NOT inferred from it, and must not be.** A cross's chemistry is not its parents'
   average — breeders select phenotypes precisely for what the parents lacked — so a predicted profile
   would be an assertion built on an assertion, printed beside a Total THC read off a real sheet. The
   concierge may name the parents and say what *those* are commonly reported to taste like, framed as
   lineage; it may never present that as this product's profile. The rail is in the prompt and
   asserted by test.
3. **User-reported effects** — the bot asks "how'd that hit you?" and logs it against the
   specific lot. Over months this becomes proprietary data Leafly structurally cannot have.

---

## 4. Architecture

No framework, no build step — same constraints as the rest of the repo (CLAUDE.md §1).

### Server: `api/concierge.js`

Zero-dependency Vercel function. Streams SSE. Tool-calling loop over the catalog — **not**
RAG. Stuffing 6,352 products into context every turn would be absurd; the model calls a
search tool and gets back a compact projection of the top ~12 matches.

Tools:

| Tool | Does |
|---|---|
| `search_catalog(filters)` | Query the same fields `api/products.js` emits. Returns compact rows. |
| `get_product(id)` | Full detail incl. parsed COA data |
| `compare(ids[])` | Side-by-side on price/g, potency, terps, shipping |
| `strain_lookup(name)` | The knowledge pack |
| `set_site_filters(...)` | Returns a client action — the bot drives the real grid |
| `add_to_cart(id, size)` | The money tool |
| `save_preference(...)` | Post-v1 |
| `create_alert(...)` | Post-v1 |

**Built 2026-08-11, and what differs from the table above.** Four tools ship, all read-only:
`search_catalog`, `get_product`, `compare`, `set_site_filters`.

- **`add_to_cart` is absent, not stubbed.** The cart handle is still missing (the open problem
  below), and a cart tool that cannot write is worse than no cart tool: the model would promise an
  add that never happened.
- **`strain_lookup` is not built, and the knowledge pack it reads does not exist yet.** What replaced
  it in v1 is the COA corpus, which is measured rather than written — see the note under Section 3.
  The pack is still the right idea for lineage and chemovar facts; it is just no longer the only
  thing standing between the bot and a useful answer.
- **`compare` does not return terpenes** as the table says it would. There are none to return
  (Section 3), so the prompt is told that explicitly and told to say so when asked.
- **Two model settings are load-bearing rather than tuned**, both documented at the top of the file.
  Thinking stays **on**: with it disabled this model occasionally writes a tool call into its visible
  text, where the turn completes with no error and the call silently never runs — in an agentic loop
  that bogus text then poisons every later turn. And the prompt-cache breakpoint sits on the last
  system block so the tool schemas cache with it; the suite asserts the system prompt and tool list
  are **byte-identical** across turns, because a timestamp interpolated into either one costs ~10x
  with nothing anywhere showing it went wrong.

  **Corrected 2026-08-11: `effort: 'low'` was named as the cost lever here and it is not one.**
  `output_config.effort` **errors** on Haiku 4.5, the model this now runs by default, so sending it
  unconditionally was a 400 on every turn of the cheap tier — the same mistake made twice, since
  Groq's `reasoning_effort` is model-gated in the same way. It is opt-in via `LL_ANTHROPIC_EFFORT`
  for whoever moves up a tier. The levers that work on every tier are `max_tokens` (dropped 4096 →
  **1024**, because reservation-based quotas bill the ceiling against your rate limit whether the
  tokens are used or not — a real 429 in production named the numbers) and `SEARCH_LIMIT`, since
  input outweighs output ~85:1 here and the tool results *are* the input. **And the cache breakpoint
  does nothing on Haiku:** the minimum cacheable prefix is 4,096 tokens there against 512 on Opus 5,
  and this prefix is ~1,455, so the entry is silently never created. It stays because it costs
  nothing and starts working the moment the model moves up. Check `usage.cache_read_input_tokens`
  before believing any savings figure.

- **One stock test, imported (2026-08-11).** This file asked `p.inStock !== false` in three places —
  the mood pool, `runSearch`, and `row()` — while the comment over `loadCatalogue` claimed "the
  concierge can never disagree with the grid about what is in stock". It did: that test ignores the
  size rows, so a listing whose flag says true while every row is sold out passed the filter and was
  then **asserted to the model** as `inStock: true`. Reported as "it grabbed me two out of stocks it
  said was in stock". `anyInStock()` is now exported from `api/products.js` and imported here, so
  there is one answer to "is this buyable" rather than a second copy free to drift — the failure this
  repo keeps paying for (four copies of `storeCheckoutUrl()`, `_OV_FIELDS` in two places).

  **The product is the wrong unit for it, though, exactly as in the trim case (CLAUDE.md §7).** A
  listing can be live with its *ounce* gone, and the ounce is both the row people ask for and the row
  that sells out first. So `detail()` now carries each row's own `inStock` from size-row slot 4 and a
  prompt rail tells the model not to offer a sold-out row. Two different questions — "show the card"
  and "offer this size" — and only the second is where the money is.

  What sharing the feed has **never** bought is agreement with the *store*. The in-instance cache is
  5 minutes, the CDN's copy 10, the scraper's own 30 beyond that: "in stock" here can be three
  quarters of an hour old. That is a rail, not a bug to fix — the prompt dates its availability claims
  and points at the merchant's page as the authority — and it is the honest answer to the third
  symptom in that same report, where the feed was right when it was read and wrong by the time it was
  quoted.
- **It fails closed**, the same posture as `POST /api/overrides` without `LL_ADMIN_TOKEN`: no
  `ANTHROPIC_API_KEY` means `POST` returns 501. The `GET` mood path keeps working, because a
  deterministic sort needs no key — an unconfigured deploy still has a working front door and cannot
  be billed by a stranger.
- **Rate limit and turn caps are in from day one** per Section 6: 12 POSTs per IP per minute, 24
  messages of history, 6 tool rounds. The IP map is per-warm-instance and therefore not a real quota
  — it is the runaway-bill backstop that section asks for, and it says so in the code rather than
  implying more.
- **`GET /api/concierge?mood=` is the zero-token path** described in the header note. It scores real
  inventory on indica/sativa leaning, measured potency where a sheet exists, price per gram against
  today's shelf, and grade — and unlike Lume's `localMatch()` it is **not clamped to a floor**, so it
  can return a low score and mean it. A recommendation surface that cannot say "nothing here fits"
  is the engine-level version of ranking by commission.

**Routing went in both files, per CLAUDE.md §3.** Vercel serves `api/*.js` without a rewrite, but
`server.mjs` keeps a hardcoded API map, so a function added to only one of them works in production
and 404s in the popped-out preview. `vercel.json` also sets `maxDuration: 60` for this function: six
tool rounds will not fit in the default ceiling, and the failure mode is a truncated stream that
reads exactly like the model finishing.

### Client: additive `<script>` in `index.html`

Per CLAUDE.md §5 the base64 engine blob is **never hand-edited**. The widget goes in as a
separate additive block, same pattern as the mobile filter sidebar.

**Open problem:** the cart's logic lives inside the blob and nothing is exposed on `window`
(`window.LL` only has `track`; `window.LLAccount` only auth). There is no callable handle for
`add_to_cart` yet. Either find one inside the engine and expose it via a thin shim, or do a
decode/edit/re-encode with every trap in CLAUDE.md §5a. **Resolve before building v1's cart
write.** If it blocks, v1 ships read-only (search + explain + `set_site_filters`).

**It blocked, so v1 shipped read-only.** The server emits five SSE event types so the widget never has
to know the provider's wire format — `text` (a delta to append), `tool` (a call being made, for a
"checking the catalogue…" affordance), `action` (a `set_site_filters` instruction for the page), and
`error` / `done`. A provider change is then a change to `api/concierge.js` alone, which is what makes
the provider question below cheap to answer.

**Client built 2026-08-11: an additive block on `/`.** `ll-concierge-style` / `ll-concierge` appended
to `public/index.html`, same pattern as `ll-trim-label` and `ll-checkout-fix`. A standalone
`/budtender` page was the alternative and lost on two counts: `set_site_filters` would have had no
grid to drive, so that tool would have been dormant, and a page with product cards on it would have
needed a second card renderer — the same duplication that gave this repo four copies of
`storeCheckoutUrl()`.

- **Register is chosen once, on first open**, via a one-tap "Straight talk / Take it slow" gate rather
  than a default plus a toggle. The composer stays hidden until it is answered, so nobody types into
  an unset voice, and the answer is a signal about who is actually arriving. Persisted in
  `localStorage.ll_conc_reg`; switchable from the header afterwards.
- **The filter controls are read from the live DOM, never assumed.** `#fType` and `#fCannabinoid`
  ship static options, but `#fCategory`, `#fStore`, `#fSort`, `#fMinThc` and `#fMinQty` are populated
  by the engine at runtime. So each select is matched against its live options and anything unmatched
  is *reported to the shopper as unapplied* rather than dropped. That is also why the server's
  `set_site_filters` no longer returns `{applied:true}` — it cannot know, and an earlier draft would
  have had the model tell someone their grid was filtered when it was not.
- **Outbound clicks carry `src:'concierge'`** through `LL.track`, which is the thing v1's whole
  measurement depends on.
- **The blob was not touched.** Asserted rather than assumed, per CLAUDE.md §5a: the `var B="..."`
  line's md5 and length are unchanged, the file's non-ASCII inventory is still exactly 69 bytes, CRLF
  is still 0, no BOM, and `git diff --stat` is 495 insertions and zero deletions in one hunk at the
  tail.

### Knowledge pack

Cached in the system prompt. Needs to be large enough to be worth caching — note the minimum
cacheable prefix differs by model tier, and the cheapest tiers have the highest minimum.
Cover the ~150–250 strain names that actually appear in the catalog, not a 5,000-strain dump.

### What it knows, and what it does not remember

**Written down 2026-08-11 because it was asked as three questions and the honest answer to two of
them is no.** The distinction is between *reference* and *memory*, and v1 has a lot of the first and
none of the second.

**Reference it has, fresh on every turn:**

- The **live catalogue** through the tools — every product, price, size row, per-gram figure and
  stock flag `/api/products` publishes, at most an hour stale. Read on demand, never stuffed into
  context.
- The **COA corpus** — parsed lab records with measured Total THC against advertised THCa, trust
  scores and flags, safety panels, and measured terpenes where a full panel was published. This is
  the part nothing else selling this stuff has.
- **Vendor-stated lineage** on the products that carry it — parents quoted from the merchant's own
  description, marked as a claim rather than a measurement.
- The **rails** — decarb arithmetic, what a trust flag means, no ranking by commission, no medical
  claims, availability is dated not asserted.

**Memory it does not have:**

- **Every conversation is a cold start.** There is no store of past chats. Within one conversation it
  sees the history *the browser sends back*, which is why it can follow a thread — and that is the
  entire extent of it. Close the tab and it is a stranger again.
- **It does not learn the site.** Nothing feeds outcomes back into the prompt. It will not notice
  that the ounce everyone asks for keeps selling out, or that one store's sheets keep failing trust,
  unless a human reads that and writes it into the prompt or the code.
- **It does not learn a customer.** `save_preference` and `create_alert` are in the tool table above
  as post-v1 and are **not built**; there is no per-visitor profile. The only per-visitor state is
  `localStorage.ll_conc_reg`, the register chosen on first open, and it never reaches the model as
  history.
- `/api/track` records outbound clicks with `src:'concierge'`, which is the measurement v1 depends
  on — but it is a sink. Nothing reads it back into a turn.

**What "getting to know the site better" would actually take**, in the order it is worth doing:

1. **The knowledge pack above** — the cheapest real gain, and static. Strain facts for the names that
   actually appear in the catalogue, written once, cached in the prefix. It makes the bot better at
   the questions the feed cannot answer, without any storage at all.
2. **A digest of the site's own history in the prefix** — what sold, what went out of stock, which
   stores' sheets came back clean, refreshed on a schedule rather than per turn. Site-level memory,
   no per-person data, and it is a text file, not a database.
3. **Per-visitor preferences**, and only then. It needs storage (KV, alongside the overrides store),
   it needs a real answer about what is retained and for how long, and it is the only one of the three
   that turns a shopping assistant into something holding a record of what a named person buys. The
   cheap version — carry preferences in the browser and let the visitor clear them — gets most of the
   benefit and keeps that record off our side.

Note the caching interaction, because it inverts the usual instinct: a **bigger** static prefix is
what makes caching engage at all on Haiku (4,096-token minimum, current prefix ~1,455), so item 1 is
plausibly cost-*neutral* or better despite adding tokens. Measure `cache_read_input_tokens` rather
than assuming it either way.

---

## 5. Voice

Chill, honest, teaches without lecturing, always ends on an action. Speaks the industry
dialect fluently — never corrects someone for saying "indica" — but never repeats a claim
that isn't supported.

Non-negotiables inside the voice:

- **Experience language only. Never treatment claims.** Hemp/THCa sites draw FDA warning
  letters for exactly this. The cart is on our domain, so this rail is ours, not the
  merchants'.
- **21+ gate stays enforced.**
- Rigorous where it counts: THCa→THC decarb math, edible onset and dosing, tolerance, drug
  tests. Being the one bot that tells the truth here is the differentiator.

---

## 6. Cost

Measured against current pricing for an ~8-exchange session (~14 model round trips) with the
knowledge pack cached:

| Model | Per conversation | @ 10 convos/day |
|---|---|---|
| Cheapest tier | ~$0.07 | ~$21/mo |
| Mid tier | ~$0.21 | ~$63/mo |
| Top tier | ~$0.35 | ~$105/mo |
| Cheap default + escalation | ~$0.12 | ~$36/mo |

Prompt caching is what makes this work — cache reads are ~10% of input price, so the
knowledge pack gets re-read ~14×/conversation for pennies.

**The metric that decides viability is cost ÷ conversion rate = cost per conversion**, which
has to clear the affiliate commission. Not a constraint at current volume; will be later.

### Measured 2026-08-11, and it corrects the premise above

The table's shape survives but one assumption in this section does not. Measured against the prompt
`api/concierge.js` actually sends:

```
system prompt            ~865 tok
tool schemas             ~590 tok
CACHEABLE PREFIX       ~1,455 tok
one search_catalog result ~628 tok    one get_product result ~117 tok
per 8-exchange session  ~39,000 input tok  = 52% cached prefix / 48% volatile tail
```

**The prefix is small, so prompt caching is worth ~30% here — not the 5–10× this document feared.**
That fear was written assuming a large stuffed knowledge pack; what got built queries the COA corpus
through tools instead, which is cheaper *and* fresher but moves the bulk of the input cost into tool
results, which sit after the cache breakpoint and are re-sent as history on every later turn.

Two consequences:

- **The knowledge pack is no longer a caching problem.** Its old constraint — "needs to be large
  enough to be worth caching" — is gone; the cacheable minimum on this model is 512 tokens and the
  prefix already clears it three times over. Write the pack when it earns its place on quality, not
  to hit a caching floor.
- **A cheap-per-token provider is a bigger lever than caching.** On raw price an open-weight tier
  lands roughly an order of magnitude below the current model for this workload. See the provider
  question in §8 — the reason not to switch outright is tool-calling reliability, not cost.

**Rate limit by IP and cap turns per session from day one** — not for cost, but so nobody
finds the endpoint and runs up a bill.

---

## 7. Stages

**v0 — COA mining. DONE.** 1,220 records in `api/coa-data.js`, 1,178 with measured THCa and Total
THC, plus trust and flags. **No terpenes** — not one sampled lab published a panel, so the "parse
cannabinoids + terpenes" goal was half-achievable and the half that wasn't is now a documented
constraint rather than an open task (Section 3).

**v1 — Read-only concierge. DONE (server + client).** `api/concierge.js` + `test-concierge.mjs`.
Search, explain, compare, `set_site_filters`, plus the zero-token mood path, and the widget on `/`.
No memory, no alerts, no cart write.

*The measurement this stage exists for has not produced a number yet.* The plumbing is now in — the
widget stamps `src:'concierge'` on every outbound click through `LL.track` — but "whether chat
sessions produce more outbound clicks than grid sessions" needs traffic and a live feed, neither of
which exists in the container this was built in. **Built is not validated.** Do not let the code
existing read as the question being answered.

**v2 — Cart assembly.** `add_to_cart` plus cross-store basket optimization ("split across two
stores saves $6 but costs a second shipment").

**v3 — Retention.** Memory tied to accounts, price-drop and restock alerts (the return
mechanic), shareable strain-report pages as an SEO surface and IG link-in-bio destination.

---

## 8. Open questions

1. Cart handle inside the engine blob — **still open, still blocking v2.** v1 shipped read-only
   because of it.
2. Affiliate commission per order — **still open.** Decides how aggressive model routing needs to be.
   Less urgent than it was: the zero-token mood path means the cheapest sessions cost nothing at all,
   so cost-per-conversion is now dominated by how many visitors chat rather than by the per-turn rate.
3. ~~Which provider~~ — **decided 2026-08-11.** Built on Claude (`claude-opus-5`) over raw `fetch`,
   since CLAUDE.md §1 makes zero dependencies an invariant and pulling in an SDK would be the first
   entry in an empty `dependencies`. Prompt caching is confirmed present and is wired with the
   breakpoint on the last system block, so the cost model in Section 6 holds rather than being 5–10x
   worse. **The cannabis-content-policy question is NOT answered** — the eight hard questions have
   not been run, because doing so costs real tokens against a key this environment does not have.
   What is built instead is the handling: a refusal arrives as HTTP 200 with `stop_reason: "refusal"`,
   which the server turns into an explicit `error` event rather than an empty turn, and server-side
   fallback is opted into by category rather than pinned to a substitute model. Run the eight
   questions before launch; the failure mode is now visible instead of blank.

   **Reopened 2026-08-11 as a routing question, at the owner's prompting: add Groq as a cheap tier.**
   The instinct is right about the money — see the measurement in §6; on raw price an open-weight tier
   is roughly an order of magnitude below the current model here, and the caching argument that would
   have counted against it turns out to be worth only ~30%. Three things gate it, none of them cost:

   - **This is a multi-round tool-calling loop, and that is where weaker models degrade.** Worse, the
     silent failure this file already guards against — a tool call written into visible text instead
     of a `tool_use` block, so the call never runs and no error is raised — is an edge case on the
     current model and a *baseline* behaviour on weaker ones. The server would stream it to the
     shopper as a normal answer.
   - **`test-concierge.mjs` cannot tell a good provider from a bad one.** It stubs the upstream API,
     which is right for pinning our own framing and useless for judging a model. A provider swap could
     quietly get worse at searching and all 92 assertions would still pass. **Build the eval harness
     before the seam, not after** — a fixed set of catalogue questions with known-correct answers,
     scored on whether the right tool was called with the right arguments and whether the decarb
     arithmetic came out right.
   - **The decarb teaching is the product.** A model that fumbles THCa × 0.877, or drifts into
     treatment language, breaks the one rail that is legally ours rather than the merchants'. Cheap
     tokens do not help if the answer needs correcting.

   So: **router, not replacement** — which is what this section's own "cheap default + escalation" row
   already costed. Cheap tier for shallow turns, the strong model for anything reasoning over lab
   data. The seam is small because the client never sees provider wire format: `anthropicBody()` and
   `streamTurn()` are the only provider-specific functions in the file, and everything else — tools,
   projections, registers, rails, rate limiting, the mood matcher — is already neutral.

   Groq's current prices are deliberately **not** written down here: egress to `groq.com` is refused
   from the container this was measured in, so they would be from memory. Take them from the console
   and plug them into the arithmetic in §6.

   **The seam is built (2026-08-11): `api/llm.js`, with `test-providers.mjs` (63 assertions).** The
   Groq adapter is complete and untested against the live API — `api.groq.com:443` is denied by the
   egress policy of every container this has been developed in, so it has only ever been driven with
   hand-built frames. **Treat it as unexercised code until someone runs it with a real key.**

   What the seam settled, and why it is not just a second request builder: **the two providers
   disagree about the shape of conversation history**, and history is replayed in full on every turn,
   so a translation bug corrupts a conversation rather than failing a request. Tool results are one
   message holding all of them on the Anthropic path and *one message each* on the OpenAI/Groq path;
   tool arguments are an object on one and a **JSON string** on the other. Neither disagreement
   throws. So the conversation is stored once in a neutral shape that neither provider owns
   (`{role:'user',text}` / `{role:'assistant',text,calls}` / `{role:'tool',results}`) and each provider
   *renders* it outbound — one direction, nothing to keep in sync, unlike the two lossy directions a
   translator would need.

   Three findings from Groq's API reference worth keeping:

   - **No `cache_control`.** There is no breakpoint to place and no documented discount. `cached_tokens`
     appears in usage on the Responses API, so prefix caching may happen automatically, but the
     Anthropic cost model does not port and `test-providers.mjs` asserts the string never appears in a
     Groq body so a future edit cannot copy it across.
   - **No structural refusal signal.** A declined answer arrives as prose with `finish_reason: "stop"`,
     indistinguishable from a real answer at the wire layer — where the Anthropic path gives
     `stop_reason: "refusal"` plus a category. One more reason the eval harness matters more than the
     wire format.
   - **`disable_tool_validation` defaults false**, so Groq does check a called tool exists in
     `request.tools`. Useful, but it does not catch the failure that actually worries this file — a
     tool call written as prose instead of a structured call. Nothing at the API layer can.

   **Still not built: the eval harness**, which is the actual gate. Routing is currently "whichever
   provider has a key, Anthropic first" — that is a placeholder, not the policy this section argues
   for, and `api/concierge.js` says so in a comment where someone might mistake it.
4. ~~COA format spread~~ — **answered by v0.** Four labs across the corpus, all page-1 images with no
   text layer, which is why 794 records carry `coa_page_1_only` and safety testing is unverified on
   most of them. Terpene panels: none.
5. **New: state-level shipping.** The concierge is the first surface on this site that *can* ask where
   someone is before quoting a price, which makes the gap CLAUDE.md flags — no state-restriction
   mechanism anywhere in the codebase — addressable here for the first time. The prompt currently
   tells it to factor location in when volunteered and to flag shipping as worth checking rather than
   promise delivery. That is a mitigation, not a fix; the fix is per-store shipping rules in
   `api/products.js` that every surface can read.
