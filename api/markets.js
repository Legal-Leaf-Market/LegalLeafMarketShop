/* api/markets.js — THE ONLY THING THAT DIFFERS BETWEEN CITIES.
 *
 * The requirement this file exists to satisfy, stated by the owner and worth
 * quoting because it is unusually absolute: every city must be identical, "zero
 * zero zero" differences. One core, called with a market, never a copy per town.
 *
 * So the split is:
 *
 *   THIS FILE   what is true about a place -- its name, its shops, their urls.
 *   EVERYTHING  the reading, merging, ranking, rendering. Identical for all.
 *
 * If a behaviour ever needs to differ between two cities, it belongs here as
 * DATA, never there as a branch. A single `if (market === "detroit")` anywhere
 * in the codebase is the moment this stops being one product and starts being
 * several, and it will not be visible in any test -- the other cities keep
 * passing.
 *
 * ---------------------------------------------------------------------------
 * HOW A STORE ENTRY IS ALLOWED TO COME INTO EXISTENCE.
 *
 * Coldwater's seven were each read off the shop's own page source, one at a
 * time, and that is why they are trustworthy. A statewide roster cannot be built
 * that way, but the standard does not move: NOTHING IN HERE IS INVENTED.
 *
 *   confirmed  someone read it off the shop's own page or the state licence
 *              list. Only a confirmed entry may ever go `enabled:true`.
 *   candidate  a name and a url from a public directory, not yet verified. It
 *              is a lead. It is never fetched on the live path and never shown.
 *   dead       checked and wrong -- closed, moved, or never existed. KEPT, with
 *              its reason, because deleting it invites the next sweep to
 *              rediscover it and re-add it.
 *
 * `platform:""` means nobody has looked yet. It does NOT mean "none" -- that is
 * a finding, and api/coldwater.js already distinguishes them.
 *
 * The whole point of the three states is that a directory listing and a verified
 * shop must never be indistinguishable in the data, because they are completely
 * different things to a shopper standing in a car park.
 * ---------------------------------------------------------------------------
 */

/* THE PAYOUT IS THE STORE COUNT, and it is the only per-city number worth
 * trusting. Michigan pays every municipality $54,017.10 per licensed retail
 * store and microbusiness (FY2025, Treasury, published Feb 2026), so a city's
 * cheque divided by that figure IS its shop count -- computed by the state, for
 * its own reasons, with no incentive to inflate.
 *
 * Directory sites are not usable for this and should not be cited: asked for
 * Detroit in one sitting they returned 35, 155 and 13. They count different
 * things (cannabis-adjacent businesses, claimed listings, active licences) and
 * none of them says which.
 */
const PER_LICENCE_USD = 54017.10;
const storesFromPayout = usd => (usd > 0 ? Math.round(usd / PER_LICENCE_USD) : null);

/* --------------------------------------------------------------- markets --- */
/* `slug` is the url and the storage namespace. `label` is what a shopper reads.
   `market` is the string the page prints. Everything else is evidence. */
const MARKETS = {
  coldwater: {
    slug: "coldwater", label: "Coldwater", market: "Coldwater, MI",
    county: "Branch",
    /* The pilot. Seven shops, six platforms, every one read off its own page. */
    status: "live",
    /* THE GEOGRAPHIC HOOK, and it is data because it is editorial. "at I-69 exit
       13" is true of Coldwater and meaningless everywhere else, and the moment it
       is written into the generator it is a per-city branch in the one place that
       must not have any. Empty is fine -- the description reads correctly without
       it. */
    blurb: "at I-69 exit 13",
    note: "The template town. Unusually fragmented for its size, which is why it "
        + "forced six adapters out of seven shops and left the platform work "
        + "close to done for everywhere else.",
  },

  /* ------------------------------------------------------------ the three --- */
  /* Chosen as the three largest CITY markets rather than the three highest
     grossing municipalities. New Buffalo and Monroe out-sell all three on
     border traffic, but they are small towns whose customers are mostly from
     Indiana and Ohio -- a price-comparison site for a place people drive THROUGH
     is a different product from one for a place people live. */
  /* ALL THREE COUNTS ARE THE STATE'S NOW, and two of them moved when they
     stopped being a directory's. Detroit and Grand Rapids were both `null` here
     because nothing trustworthy had been read; ONE_CORE.md carried "~16" for
     Grand Rapids off a directory, and the real figure is 27. Each is checked
     against the reported payout rather than taken on its own:

       Detroit       61 x $54,017.10 = $3,295,043.10   reported "$3.3 million"
       Grand Rapids  27 x $54,017.10 = $1,458,461.70   reported "nearly $1.46m"
       Lansing       26 x $54,017.10 = $1,404,444.60   reported "$1.4 million"

     Which also reorders them: Grand Rapids is the second market, not the third,
     and by one shop. Worth knowing before deciding what to build second. */
  detroit: {
    slug: "detroit", label: "Detroit", market: "Detroit, MI",
    county: "Wayne",
    /* LIVE, and the bar it had to clear is stated above: `target` and `queued`
       must not be served because "a city with no CONFIRMED shops would render
       an empty shelf under a real place name". Detroit has nine, each read off
       its own page by the discovery sweep, so the page has a real roster, a
       real store strip and a real set of shops to route somebody to.

       WHAT IT DOES NOT HAVE YET IS PRICES. None of the nine is `enabled` --
       seven are Dutchie, which walls a server -- so /api/market?town=detroit
       falls back to the demo fixture, and the page says so in its own banner
       ("No Detroit dispensary is connected to this page yet ... not any real
       shop's prices"). That is the state the pilot launched in and it is the
       honest one: placeholder rows that ANNOUNCE themselves, never invented
       prices against a named business. The operator's bookmarklet is what
       turns it real, and /coldwater-collect?market=detroit now builds one.

       IN sitemap.xml FROM DAY ONE, which was a judgement call and is the
       owner's. `live` means the page is served; the sitemap is an invitation to
       INDEX it, and until a shop is captured what gets indexed is a real place
       name over a placeholder grid. The argument against was that it ranks for
       "detroit dispensary prices" while showing sample rows; the argument for,
       which won, is that owning the url early is worth more than waiting and
       the page is not pretending -- its banner says "No Detroit dispensary is
       connected to this page yet ... not any real shop's prices."

       WHAT THAT MAKES LOAD BEARING: the banner. It is the only thing standing
       between an indexed page and a shopper reading placeholder prices as this
       city's. test-detroit-live.mjs asserts it is present, names Detroit, and
       never names the pilot -- treat those three as the condition of the
       sitemap entry rather than as ordinary assertions. */
    status: "live",
    /* Largest city in the state and the largest retail market in it. Licensed
       late and then heavily, after its first ordinance was struck down, so the
       shops are newer and more concentrated than the count suggests -- 33 shops
       in 2023 against 61 now, nearly doubling in two years. */
    payoutUSD: 3295043.10, stores: 61,
    /* MEASURED 17 Aug 2026, and it confirms what this note predicted before
       there was any Detroit data. The first discovery sweep read nine shops'
       own pages: SEVEN OF NINE ARE DUTCHIE, which answers a server-side request
       with a Cloudflare challenge. So the manual lane is not a fallback here,
       it is the main road, and the headless lane will report most of this city
       as walled rather than harvest it. Nine confirmed against 61 licensed --
       the gap is what a seed list from public search can reach, not an estimate
       of the city. */
    note: "Biggest and most competitive. Dutchie dominates -- 7 of the first 9 "
        + "shops read -- so the manual lane carries more of it than anywhere else.",
  },
  grandrapids: {
    slug: "grandrapids", label: "Grand Rapids", market: "Grand Rapids, MI",
    county: "Kent",
    /* LIVE ON THE SAME TERMS DETROIT WENT LIVE, which are worth restating
       because "live" here does not mean "has prices". It means the page
       generates and the shelf resolves; with no capture yet it serves the demo
       fixture behind a banner that NAMES Grand Rapids and says so. That banner
       is load bearing, exactly as it is for Detroit -- it is the only thing
       between a placeholder catalogue and a real place name.
       Deliberately NOT in sitemap.xml yet: indexing a demo shelf is a separate
       decision from publishing the page, and Detroit's entry went in only
       because the owner asked for it explicitly. */
    status: "live",
    payoutUSD: 1458461.70, stores: 27,
    note: "Second city, west Michigan hub, no competing border market nearby -- "
        + "and on the state's own count it is the second market by shop number "
        + "too, one ahead of Lansing rather than eleven behind it. "
        + "EIGHT OF THE 27 ARE ON THE ROSTER, from one round of public search; "
        + "the gap is work remaining rather than a claim about the city. Three "
        + "of the eight are chains this roster already carries in another town "
        + "(House of Dank, Exclusive) or twice over here (Skymint), which is "
        + "the first time a shared host has had to name two shops -- see the "
        + "directory projection in api/coldwater-ingest.js.",
  },
  lansing: {
    slug: "lansing", label: "Lansing", market: "Lansing, MI",
    county: "Ingham",
    status: "target",
    /* East Lansing is a SEPARATE municipality with its own payout and its own
       six shops, and merging the two would be the Coldwater/Monroe mistake at
       closer range. */
    payoutUSD: 1404444.60, stores: 26,
    note: "Capital, dense, and a college town -- which makes it the least like "
        + "the pilot of the three and the best test of whether the shelf reads "
        + "the same for a different kind of shopper.",
  },

  /* Already fanned out for Lume, not yet worked. Kept so the registry is one
     list rather than two. */
  monroe:     { slug: "monroe", label: "Monroe", market: "Monroe, MI", county: "Monroe", status: "queued" },
  /* `urlSlug` is how OTHER PEOPLE spell this place in a path, which is not always
     how we key it. New Buffalo is one word to us and hyphenated to Lume. It lives
     here because the alternative is a ternary in the store builder -- which is
     exactly what test-one-core.mjs caught on its first run, written the day
     before by the person who then wrote the guard. */
  /* THE FIRST MARKET WHOSE ROSTER WAS MEASURED BEFORE IT WAS WRITTEN.
     Detroit and Grand Rapids were seeded from public search and are waiting on
     a sweep to confirm them. New Buffalo went the other way round, because the
     container it was added from has no route to the open web at all: the egress
     gateway answers 403 to CONNECT for every host. So discover-market.yml ran
     first, on a runner, and every platform in the roster is a reading.

     LIVE ON EXACTLY DETROIT'S TERMS, which are worth restating because "live"
     here does not mean "has prices". It means the page generates and the shelf
     resolves. Three shops are confirmed and none is connected, so /api/market
     serves the demo fixture behind a banner that NAMES New Buffalo and says so.
     That banner is the load-bearing part, as it is for Detroit and Grand
     Rapids: it is the only thing between a placeholder catalogue and a real
     place name.

     WHAT THE SWEEP MEASURED, 2026-09-07: 935 products came back from Lume on a
     plain server GET, which is the largest single catalogue this project has
     ever read in one request and the reason this town was worth doing. It is
     NOT enabled, and the gap between those two sentences is the whole caution:
     Lume picks the store SERVER-SIDE from a cookie, so 935 products with no
     cookie are 935 products from whichever store Lume defaults to. fromLume()
     refuses to return anything unless the payload names the expected town, so
     the failure mode is no rows rather than Coldwater's prices under this
     heading -- but the cookie is still the one thing standing between this
     market and real data.

     NOT IN sitemap.xml. Detroit's entry went in because the owner asked for it
     explicitly; indexing a demo shelf is a separate decision from publishing
     the page, and nobody has made it for this town.

     NO STORE COUNT. The other three live markets each derive one from the
     state's own cheque. New Buffalo's payout is in the Treasury FY2025 PDF and
     michigan.gov is among the hosts this container cannot reach, so the figure
     is absent rather than estimated. MICHIGAN_EXPANSION.md §7 lists that PDF as
     the open gap already.

     THE BOUNDARY QUESTION IS OPEN AND IS THE OWNER'S. The City of New Buffalo
     and New Buffalo Township are two municipalities with two councils and two
     lines in the Treasury distribution, and the Red Arrow Highway trade sits in
     the Township. This registry's own precedent is emphatic and consistent --
     Detroit excludes Hamtramck, Grand Rapids excludes its ring, Lansing
     excludes East Lansing "at closer range" -- so this market is the CITY until
     somebody decides otherwise, and that decision belongs here as data rather
     than being settled implicitly by which shops happen to confirm. It is
     closer here than anywhere else on this list: the cityOnPage guard cannot
     tell the two apart, because a Township shop's page genuinely does say New
     Buffalo. See data/newbuffalo-seeds.txt.

     WHY THIS MARKET, given the note above argues the other way. That note calls
     New Buffalo "a place people drive THROUGH" and therefore a different
     product; MICHIGAN_EXPANSION.md §6 tier 3 argues border towns first, because
     "out-of-state traffic is already price-shopping before it drives". Both are
     in this repo and they disagree. The owner asked for this one on 2026-09-07,
     which settles it. api/coldwater.js has the size: #1 city in the state,
     $45.9M in Jan-Feb 2026 alone. */
  newbuffalo: {
    slug: "newbuffalo", urlSlug: "new-buffalo", label: "New Buffalo",
    market: "New Buffalo, MI", county: "Berrien",
    status: "live",
    /* Editorial, and true of this place only: the reason it out-sells cities
       twenty times its size. Empty is fine; the description reads without it. */
    blurb: "at the Indiana line on I-94",
    note: "Michigan's #1 market by sales and a border town, not a city -- most "
        + "of its trade drives up from Indiana and is comparing before it "
        + "leaves. Three shops confirmed by the sweep, none connected. Lume "
        + "answered a plain GET with 935 products, the largest catalogue this "
        + "project has read in one request, and is still enabled:false because "
        + "no cookie means no proof of which store they belong to. The other "
        + "two are render-needed when asked for products, so one shop in three "
        + "is an adapter shop here and the rest are the headless or operator "
        + "lane.",
  },
  morenci:    { slug: "morenci", label: "Morenci", market: "Morenci, MI", county: "Lenawee", status: "queued" },
  petersburg: { slug: "petersburg", label: "Petersburg", market: "Petersburg, MI", county: "Monroe", status: "queued" },
};

const DEFAULT_MARKET = "coldwater";

function marketKey(v) {
  const k = String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z]/g, "");
  return Object.prototype.hasOwnProperty.call(MARKETS, k) ? k : DEFAULT_MARKET;
}
function marketOf(v) { return MARKETS[marketKey(v)]; }

/* The spelling a third party uses in a url. Defaults to our own key, so a market
   only declares it when somebody else disagrees with us. */
function urlSlugOf(v) { const m = marketOf(v); return (m && m.urlSlug) || (m && m.slug) || DEFAULT_MARKET; }

/* Every market that is ready to be served. `target` and `queued` are research
   states and must not appear as a page -- a city with no confirmed shops would
   render an empty shelf under a real place name, which is worse than a 404. */
function liveMarkets() {
  return Object.values(MARKETS).filter(m => m.status === "live");
}

export {
  MARKETS, DEFAULT_MARKET, marketKey, marketOf, urlSlugOf, liveMarkets,
  PER_LICENCE_USD, storesFromPayout,
};
