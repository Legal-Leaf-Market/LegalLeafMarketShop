/* api/market-stores.js — THE ROSTER. The second of the two files a new city
 * touches, and the only other one.
 *
 * IT WAS SPLIT OUT BECAUSE STEP 6 FAILED ITS OWN TEST. ONE_CORE.md §5 says the
 * sixth step is adding a city, and that "if adding Detroit needs any file other
 * than api/markets.js and its store data, one of steps 2-5 was not finished".
 * Adding Detroit needed api/coldwater.js -- a 3,145-line file holding the
 * scrapers, the classifier, the merge and the render projection -- because both
 * the town registry and the shop rows lived inside it. Editing the reader to add
 * a place is precisely the pressure that turns one product into several: the
 * `if (market === "detroit")` this project has already caught once (§ lumeStore
 * below) arrives in a file where it looks at home.
 *
 * So the split is now three ways, and it is worth stating which is which:
 *
 *   api/markets.js        WHAT A PLACE IS -- name, county, slug, status.
 *   api/market-stores.js  WHAT IS IN IT -- the shops, their urls, their wiring.
 *   everything else       WHAT WE DO WITH IT -- identical for every city.
 *
 * THERE WAS ALSO A SECOND REGISTRY IN HERE, AND IT HAD ALREADY DRIFTED.
 * api/coldwater.js kept its own TOWNS map of five towns while api/markets.js
 * held eight, and the resolver fell back to the default for anything missing
 * from its own copy. Measured before the fix:
 *
 *     ?town=lansing      -> coldwater
 *     ?town=detroit      -> coldwater
 *     ?town=grandrapids  -> coldwater
 *
 * A real market, registered, resolving silently to somebody else's shelf. That
 * is the exact failure the town scoping was built to prevent -- one town's
 * prices under another town's heading -- arriving through the resolver rather
 * than through an adapter, which is the one route fromLume()'s expectLocation
 * guard cannot see. It could not fail loudly because falling back IS the
 * documented behaviour for a mistyped `?town=`; the resolver had no way to tell
 * a typo from a city it had not been told about.
 *
 * The registry is api/markets.js. There is no other one. A market that exists
 * but has no shops now resolves to itself and serves the demo fixture, which
 * says "no store is connected yet" in the meta and on the page -- an honest
 * empty answer instead of a confident wrong one.
 */

import { MARKETS, DEFAULT_MARKET, marketKey, marketOf, urlSlugOf } from "./markets.js";

/* Kept under their old names because api/coldwater.js and its suite read them,
   and because "town" is what the query parameter is called. They are the
   registry's functions; nothing here decides anything about a place. */
const TOWNS = MARKETS;
const DEFAULT_TOWN = DEFAULT_MARKET;
const townKey = marketKey;

/* LUME'S FAN-OUT, and what is real here versus what is waiting on the operator.
 *
 * REAL: the adapter (fromLume), its test against a saved page, the store-page URL
 * pattern -- www.lume.com/stores/<town>-mi-dispensary, which the diag table already
 * uses verbatim for Coldwater, Monroe and New Buffalo -- and the expectLocation
 * guard that refuses to return anything unless the payload names the town asked for.
 *
 * NOT REAL, AND NOT INVENTED HERE:
 *   - `storeCookie`. Lume picks the store SERVER-SIDE from a cookie, so without it
 *     every one of these reads whatever default store Lume serves. That is why they
 *     are all `enabled:false`: an entry that cannot identify its own store must not
 *     be on the live path. One cookie value, pasted in, switches the lot on.
 *   - Street addresses. They are not derivable from a town name and this file does
 *     not publish invented facts about a named business, so `addr` stays empty until
 *     somebody reads it off Lume's own page.
 *   - The other ~33 towns. Four are seeded because this repo already has evidence
 *     for them in its own diag table and notes; the rest come from lume.com/locations
 *     and are a data-entry job, not a code change. Add a markets.js entry and a name
 *     to LUME_TOWNS.
 *
 * So this is the MECHANISM finished and the DATA outstanding, which is the honest
 * split -- and the failure mode of getting the cookie wrong is "no rows" rather than
 * one town's prices under another's name.
 */
function lumeStore(town) {
  const t = marketOf(town);
  /* THE SPELLING IS DATA, NOT A CONDITION. This was `town === "newbuffalo" ?
     "new-buffalo" : town`, which test-one-core.mjs flagged on its first run --
     a per-city branch is how a shared codebase quietly becomes several, and it
     would never have gone red because every other town kept passing. */
  const slug = urlSlugOf(town);
  return {
    key: "lume-" + town, name: "Lume Cannabis", town,
    addr: "", phone: "",
    site: "https://www.lume.com/stores/" + slug + "-mi-dispensary",
    area: "",
    platform: "lume", menuUrl: "https://www.lume.com/shop/all",
    expectLocation: t.label,
    storeCookie: "", enabled: false,
  };
}
const LUME_TOWNS = ["monroe", "newbuffalo", "morenci", "petersburg"];

/* --------------------------------------------------------------- stores --- */
/* Identity is public-listing fact. Menu wiring is blank until discovered.
   platform: 'dutchie' | 'jane' | 'none'   (none = identity only, not fetched) */
const STORES = [
  /* Lume runs its own Next.js storefront and SERVER-RENDERS the whole Coldwater
     catalogue into __NEXT_DATA__ -- 952 products in one page, no third-party API
     and nothing to reverse. It is also the richest feed in this project: exact
     percentTHC/percentCBD, price in cents, packagedDate, and batchName, which is
     the Metrc package tag and therefore the join key to a lab result.

     The store is chosen SERVER-SIDE from a cookie (initialState.storeSelection
     came back "Coldwater" on a URL of plain /shop/all). Set storeCookie to
     whatever their store selector writes; without it Lume serves some default
     store and every price would be right for the wrong town. fromLume() refuses
     to return anything unless the payload says Coldwater, for exactly that
     reason. */
  { key:"lume",       name:"Lume Cannabis",        addr:"351 S Willowbrook Rd",       phone:"(517) 924-3020",
    site:"https://www.lume.com/stores/coldwater-mi-dispensary", area:"Exit 13",
    platform:"lume", menuUrl:"https://www.lume.com/shop/all", expectLocation:"Coldwater",
    storeCookie:"", enabled:false },
  /* Sapura Coldwater. The id is not a guess: their own page source declares it
     twice, once as the Dutchie embed script
     (dutchie.com/api/v2/embedded-menu/6226401db296a22c98dfb676.js) and once in
     the Surfside retail config beside it, which names the platform explicitly:
       window.surfRetailOverrides = { platform:'dutchie', storeId:'6226401db...' }
     The page it came from is titled "Coldwater Menu", so this is the Coldwater
     store and not the Lansing one -- Sapura runs both, and they are separate
     ids. Get that wrong and the site publishes Lansing's prices under a
     Coldwater heading, which is worse than publishing nothing. */
  /* SECOND ROUTE IN, and the reason this entry is now `woo` and not `dutchie`.
     Their /adult-use page is a 47 KB shell -- no price, brand, strain or THC
     string anywhere in it -- because the Dutchie embed renders client-side, and
     Dutchie answers a server-side request with a Cloudflare challenge. Dead end.
     But the same page declares WordPress 7.0.2 + WooCommerce 10.9.4, exposes
     /wp-json/, and ships woo-variation-swatches with the variable-product
     templates. That is a first-party catalogue on their own domain with a public
     Store API in front of it, and it is the shape this repo already reads for
     four hemp stores.
     Expect accessories and apparel rather than flower: plant sales run through
     the licensed POS that Dutchie fronts. Worth having, not the same as the menu.
     The Dutchie id stays recorded because it is correct and the wall may not be
     permanent. */
  { key:"sapura",     name:"Sapura",               addr:"355 S Willowbrook Rd",       phone:"(517) 924-0094",
    site:"https://sapuralife.com/coldwater-weed-dispensary/", area:"Exit 13",
    platform:"woo", wooBase:"https://sapuralife.com",
    dispensaryId:"6226401db296a22c98dfb676",
    /* OFF, and this is a latency decision rather than a change of conclusion.
       Their Woo endpoint answers in ~3.3s and always answers []. Every cache
       miss therefore spent three seconds proving something already proven,
       while the page sat showing whatever it had. Probing belongs in ?diag,
       which exists now; the live path should only call stores that can return
       rows. Flip back the day Sapura publishes a catalogue. */
    enabled:false },
  /* Flowhub white-label storefront. The subdomain names the site: "willow" is
     Willowbrook Rd, so this is the Coldwater shop and not their Sturgis or
     Constantine ones. Adapter not written yet; ids recorded so the next person
     does not have to re-read the page. */
  { key:"dude",       name:"The Dude Abides",      addr:"398 N Willowbrook Rd Ste D", phone:"(517) 459-9333",
    site:"https://www.rollingwiththedude.com/coldwater", area:"Exit 13",
    /* ON, via the generic reader. Their API origin is Cloudflare-challenged, but
       their STOREFRONT answers a plain server GET with 200 and 960,540 bytes of
       server-rendered menu -- measured. The page is served, so read the page.
       That distinction is the whole lesson of this file: a platform's API being
       shut does not mean its storefront is. */
    platform:"generic", menuUrl:"https://dudeabides-willow.dispensary.shop/menu",
    flowhubHost:"dudeabides-willow.dispensary.shop",
    flowhubOrigin:"https://origin.dispensary.shop",
    storeId:"22ef2975-9e8d-466c-9d88-8e6230a04d65", enabled:true },
  /* Cannavate storefront at shophcc.com. Their page ships the whole retailer
     table, so the Coldwater id is theirs rather than a guess -- it is listed
     against "880 East Chicago Street, Coldwater, MI 49036". Products are not in
     the HTML: it is a Next.js App Router app streaming RSC payloads, so the
     catalogue arrives over a separate call that still needs identifying. */
  { key:"herbology",  name:"Herbology Cannabis Co.", addr:"880 E Chicago St",         phone:"(517) 924-0417",
    site:"https://www.shophcc.com/", area:"Chicago St",
    platform:"none", retailerId:"6c36404c-574a-474d-b4a5-1188d351deb4", enabled:false },
  /* Jane (iheartjane), read straight out of their page config:
       "storeId":5187,"partnerHostedPath":"/coldwater"
     An integer id, which is Jane's own shape, and the partner path names the
     town -- Green Tree Relief run more than one shop, so that second field is
     what makes this the Coldwater store rather than a sibling. Enabled: unlike
     Dutchie, Jane's menu endpoint is the one their embedded menus call, so the
     probe on production will say plainly whether it answers a server. */
  { key:"greentree",  name:"Green Tree Relief",    addr:"553 E Chicago St",           phone:"",
    site:"https://greentreerelief.com/coldwater/", area:"Chicago St",
    /* OFF for the same reason as Sapura: Jane answers a server with a Cloudflare
       challenge every time, so this is pure latency on the live path. ?diag=greentree
       still checks it, which is where a question like this belongs. */
    platform:"jane", storeId:5187, enabled:false },
  /* Tymber, now Blaze -- their image CDN is tymber-blaze-products.imgix.net.
     A Next.js site whose __NEXT_DATA__ carries the FILTER catalogue but not the
     products: 104 brands, 12 categories, 29 weights, and no menu. So unlike Lume
     this one still needs its product call identified. The site group slug is the
     handle to search on. */
  { key:"banzen",     name:"Banzen",               addr:"55 S Michigan Ave",          phone:"",
    site:"https://banzencoldwater.com/coldwater-mi-dispensary", area:"Downtown",
    platform:"none", tymberSiteGroup:"grass-bannzen", enabled:false },
  /* Dutchie, same as Sapura and therefore the same Cloudflare wall -- their page
     sets platform 'dutchie' explicitly. The retailer id is not static in the
     markup either; it is read at runtime from locationData.retailer_id, so there
     is nothing to record beyond the platform. Both Dutchie stores are gated on a
     merchant-side conversation rather than on anything in this file. */
  { key:"exclusive",  name:"Exclusive",            addr:"",                           phone:"",
    site:"https://www.exclusivemi.com/dispensaries/locations/coldwater/", area:"",
    platform:"none", note:"dutchie; retailer id resolved client-side", enabled:false },
  /* THE FAN-OUT. One adapter, four more towns, zero new parsing -- and every
     one of them off until a storeCookie exists. */

  /* ------------------------------------------------------------- DETROIT ---
   * NINE SHOPS, EACH READ OFF ITS OWN PAGE, which is the standard Coldwater's
   * seven were built to and it does not move because the roster got bigger.
   * discover-market.mjs fetched each one on 17 Aug 2026 and promoted it only
   * where the page NAMED DETROIT -- the guard that stops a chain's national
   * site being filed here because its url happened to carry the word, and the
   * only thing that separates these from the Hamtramck shops that a directory,
   * a mailing address and even a menu-platform slug all call "Detroit".
   * Evidence: .github/workflows/discover-market.yml run 32059070669.
   *
   * SEVEN OF THE NINE ARE DUTCHIE, which measures a prediction this repo made
   * before it had any Detroit data: "expect Dutchie to dominate, which means
   * expect the manual lane to carry more of it than anywhere else". Dutchie
   * answers a server-side request with a Cloudflare challenge (§ Sapura and
   * Exclusive in the Coldwater rows above), so platform:"dutchie" here is a
   * finding about who to capture with a browser, not a wiring that works.
   *
   * EVERY ONE IS enabled:false, and that is not caution for its own sake:
   * `enabled` means the live path will call it, and nothing here has an adapter
   * proven against it yet. Detroit is also still status:"target" in
   * api/markets.js, so liveMarkets() does not serve it at all -- an empty shelf
   * under a real place name is worse than a 404.
   *
   * NINE AGAINST THE STATE'S 61. The gap is the honest reading of what a seed
   * list built from public search can reach, not an estimate of the city.
   */
  { key:"hod-detroit",   name:"House of Dank",        town:"detroit", addr:"", phone:"",
    site:"https://shophod.com/stores/house-of-dank-recreational-cannabis-8-mile",
    area:"8 Mile", platform:"dutchie", enabled:false },
  { key:"liberty-detroit", name:"Liberty Cannabis",   town:"detroit", addr:"", phone:"",
    site:"https://libertycannabis.com/shop/detroit/",
    area:"", platform:"dutchie", enabled:false },
  { key:"cloud-detroit", name:"Cloud Cannabis",       town:"detroit", addr:"", phone:"",
    site:"https://cloudcannabis.com/detroit-order-online/",
    area:"", platform:"dutchie", enabled:false },
  { key:"kingofbudz-detroit", name:"King of Budz",    town:"detroit", addr:"", phone:"",
    site:"https://kingofbudz.com/",
    area:"Gratiot", platform:"dutchie", enabled:false },
  { key:"geniecannabis", name:"Green Genie Cannabis", town:"detroit", addr:"", phone:"",
    site:"https://geniecannabis.com/",
    area:"", platform:"dutchie", enabled:false },
  { key:"420factory",    name:"420 Factory",          town:"detroit", addr:"", phone:"",
    site:"https://420factorydetroit.com/",
    area:"Greenfield", platform:"dutchie", enabled:false },
  { key:"highclub",      name:"High Club",            town:"detroit", addr:"", phone:"",
    site:"https://shophighclub.com/",
    area:"", platform:"dutchie", enabled:false },
  /* Platform not identified by signature. "" is "nobody has looked yet" and is
     NOT "none" -- that is a finding, and api/coldwater.js tells them apart. */
  { key:"dacut",         name:"DACUT",                town:"detroit", addr:"", phone:"",
    site:"https://dacut.com/mi/detroit-dispensary/",
    area:"Gratiot", platform:"", enabled:false },
  { key:"ascend-detroit", name:"Ascend",              town:"detroit", addr:"", phone:"",
    site:"https://letsascend.com/locations/michigan/detroit/",
    area:"Grand River", platform:"", enabled:false },

  /* ---- Detroit, round two -------------------------------------------------
   * NINE WAS THE SEED LIST, NOT THE CITY, and it was read as the city once
   * already ("is that all the stores in detroit? there is no way"). The state's
   * per-licence payout says 61; a directory count says 49 storefronts. These
   * are the ones a second round of public search attests to WITH THEIR OWN
   * DOMAIN, which is the bar that matters here -- a shop reachable only through
   * Weedmaps or Leafly has no page of its own for either lane to read, so it is
   * left for a later round rather than added as a row nothing can capture.
   *
   * PLATFORM IS "" ON ALL OF THEM ON PURPOSE. That is "nobody has looked yet",
   * which api/coldwater.js tells apart from "none", and it is the honest state
   * until tools/probe-catalogue.mjs has actually asked them for a product. The
   * previous round wrote platform:"dutchie" onto seven shops from a homepage
   * signature and none of those seven was ever asked for a catalogue.
   *
   * TWO DELIBERATE EXCLUSIONS, both of which would have been easy to add:
   *   - QUALITY ROOTS is in HAMTRAMCK, a separate city entirely surrounded by
   *     Detroit. A directory, a mailing address and a menu-platform slug all
   *     call it Detroit. It is not, and filing it here is the enclave trap this
   *     registry names in api/markets.js.
   *   - THE REEF's operating company was added to the Cannabis Regulatory
   *     Agency's exclusion list, so the licensee is barred from the industry.
   *     That is a reason not to list a shop, and it is worth writing down
   *     because the storefront still appears in every directory.
   */
  { key:"pleasantrees-detroit", name:"Pleasantrees",   town:"detroit", addr:"", phone:"",
    site:"https://enjoypleasantrees.com/the-reef-detroit/",
    area:"E 8 Mile", platform:"", enabled:false,
    note:"Operates the E 8 Mile store. Listed under Pleasantrees rather than under The Reef, whose own licensee is on the CRA exclusion list -- confirm which entity is trading before capturing." },
  { key:"puff-detroit",   name:"Puff Cannabis",        town:"detroit", addr:"", phone:"",
    site:"https://puffcannabiscompany.com/",
    area:"", platform:"", enabled:false,
    note:"Chain site; the Detroit shop's own path still needs reading off their store list." },
  { key:"cookies-detroit", name:"Cookies Detroit",     town:"detroit", addr:"", phone:"",
    site:"https://cookies.co/pages/detroit",
    area:"", platform:"", enabled:false,
    note:"National brand, Shopify on the corporate site -- which is NOT evidence the menu is: the storefront may be a separate platform." },
  { key:"utopiagardens",  name:"Utopia Gardens",       town:"detroit", addr:"", phone:"",
    site:"https://utopiagardens.com/",
    area:"Eastern Market", platform:"", enabled:false,
    note:"Answered 403 to the first sweep, which is a refusal rather than a death -- candidate, operator's lane until a probe says otherwise. Also runs delivery, so its catalogue may not be a walk-in shelf." },
  { key:"jars-detroit",   name:"JARS Cannabis",        town:"detroit", addr:"", phone:"",
    site:"https://jarscannabis.com/",
    area:"", platform:"", enabled:false,
    note:"Chain site; the Detroit shop's own path still needs reading off their store list." },
  { key:"gage-detroit",   name:"Gage Cannabis",        town:"detroit", addr:"", phone:"",
    site:"https://gagecannabis.com/",
    area:"", platform:"", enabled:false,
    note:"Chain site; the Detroit shop's own path still needs reading off their store list." },
  { key:"naturesremedy-detroit", name:"Nature's Remedy", town:"detroit", addr:"", phone:"",
    site:"https://www.naturesremedycannabis.com/",
    area:"", platform:"", enabled:false,
    note:"Chain with Michigan stores; confirm a Detroit location before enabling." },

  /* ------------------------------------------------------------------------
   * GRAND RAPIDS -- 27 licences by the state's per-licence payout, eight here.
   *
   * SAME METHOD AS DETROIT AND THE SAME CAVEAT: a seed list built from public
   * search, not a census. Eight of 27 is what one round of searching reaches;
   * the number is in api/markets.js and the gap is meant to be read as work
   * remaining rather than as the city.
   *
   * THREE OF THESE ARE CHAINS ALREADY ON THIS ROSTER IN ANOTHER CITY, and that
   * is the first time this file has had that. House of Dank is in Detroit and
   * here on shophod.com; Exclusive is in Coldwater and here on exclusivemi.com;
   * Skymint has TWO Grand Rapids shops on one domain. Every one of those is a
   * host that cannot name a store on its own -- which is exactly what the
   * directory projection in api/coldwater-ingest.js computes from this file
   * rather than from a list of platforms somebody maintains. The path in `site`
   * is therefore load bearing here in a way it is not for a single-shop domain:
   * it is the only thing separating two shops of one chain, and reading it
   * wrongly is the Sapura/Exclusive failure (693 rows under another shop's
   * name). Give each of these a site url whose path names THIS shop.
   *
   * PLATFORMS ARE UNVERIFIED. Egress to every one of these hosts is refused
   * from the container this was written in, so none of them claims a platform:
   * "" is "nobody has looked yet", which api/coldwater.js tells apart from
   * "none". discover-market.yml is what fills these in, on a runner with
   * ordinary network access, and it promotes a shop only where the page NAMES
   * the city -- the guard that stops a chain's national site being filed here
   * because its url happened to carry the word.
   *
   * ALL enabled:false, and Grand Rapids is still status:"target" in
   * api/markets.js, so liveMarkets() does not serve it. An empty shelf under a
   * real place name is worse than a 404.
   */
  { key:"hod-grandrapids", name:"House of Dank",      town:"grandrapids", addr:"", phone:"",
    site:"https://shophod.com/stores/house-of-dank-grand-rapids",
    area:"", platform:"", enabled:false },
  { key:"fluresh-grandrapids", name:"Fluresh",        town:"grandrapids", addr:"", phone:"",
    site:"https://fluresh.com/store/",
    area:"", platform:"", enabled:false,
    note:"Grand Rapids' first licensed recreational store (Oct 2020)." },
  { key:"skymint-division", name:"Skymint Division",  town:"grandrapids", addr:"", phone:"",
    site:"https://skymint.com/grand-rapids-division",
    menuUrl:"https://skymint.com/grand-rapids-division/menu",
    area:"Division", platform:"", enabled:false },
  { key:"skymint-plainfield", name:"Skymint Plainfield", town:"grandrapids", addr:"", phone:"",
    site:"https://skymint.com/grand-rapids-plainfield",
    area:"Plainfield", platform:"", enabled:false },
  { key:"pharmhouse",    name:"Pharmhouse Wellness",  town:"grandrapids", addr:"831 Wealthy St SW", phone:"",
    site:"https://pharmhousewellness.com/menu/grand-rapids",
    area:"Wealthy St", platform:"", enabled:false,
    note:"Locally owned; the only one on this list that is not part of a chain." },
  { key:"exclusive-grandrapids", name:"Exclusive",    town:"grandrapids", addr:"", phone:"",
    site:"https://exclusivemi.com/dispensaries/grand-rapids/",
    area:"", platform:"", enabled:false,
    note:"Same chain as Coldwater's `exclusive`, which is dutchie -- so this one probably is too. Left \"\" because a guess about one shop from another shop is what put 693 rows under the wrong name." },
  { key:"jars-alpine",   name:"JARS Cannabis",        town:"grandrapids", addr:"", phone:"",
    site:"https://jarscannabis.com/",
    area:"Alpine", platform:"", enabled:false,
    note:"Chain site -- the Alpine shop's own path still needs reading off their store list." },
  { key:"gage-grandrapids", name:"Gage Cannabis",     town:"grandrapids", addr:"", phone:"",
    site:"https://gagecannabis.com/",
    area:"", platform:"", enabled:false,
    note:"Chain site -- the Grand Rapids shop's own path still needs reading off their store list." },
  /* Round two, same bar as Detroit's: attested with a domain of its own. */
  { key:"noxx-grandrapids", name:"NOXX",              town:"grandrapids", addr:"", phone:"",
    site:"https://noxx.com/",
    area:"", platform:"", enabled:false,
    note:"Grand Rapids based, operates NOXX & Cookies. Confirm which of its shops are in the city proper." },
  { key:"greenhouse-grandrapids", name:"Greenhouse",  town:"grandrapids", addr:"", phone:"",
    site:"https://greenhouseprovisions.com/",
    area:"", platform:"", enabled:false,
    note:"Unconfirmed domain -- the sweep promotes it only if the page names Grand Rapids, which is exactly what that guard is for." },
  { key:"meds-cafe-grandrapids", name:"Meds Cafe",    town:"grandrapids", addr:"", phone:"",
    site:"https://medscafe.com/",
    area:"", platform:"", enabled:false,
    note:"Unconfirmed domain; sweep will confirm or drop it." },

  /* ------------------------------------------------------------------------
   * NEW BUFFALO -- MEASURED ON A RUNNER, NOT SEEDED FROM A SEARCH.
   *
   * Detroit's and Grand Rapids' rosters are leads from public search waiting on
   * a sweep. This one is the other way round: the sweep ran first
   * (discover-market.yml, run 7, 2026-09-07) because the container this was
   * written in has no route to the open web at all -- the egress gateway
   * answers 403 to CONNECT for every host, dispensary and otherwise. So every
   * platform below is a reading rather than a guess, which is the first time
   * that has been true of a city on its first commit.
   *
   * Ten leads in, and the sweep's own verdict: 3 confirmed, 6 candidate, 1
   * dead. Cloud Cannabis 404s and is dead. Nirvana Center, Green Stem, Dispo
   * and Pincanna could not be fetched, so they stay candidates and are not
   * written here -- a refusal is not a death and neither is it a finding.
   * Skymint and Exclusive were fetched and their pages never name New Buffalo,
   * so they are not in this town.
   *
   * THE GUARD'S BLIND SPOT GOT HIT, and House of Dank is the one that shows it.
   * discover-market.mjs promotes a lead when the fetched page NAMES THE CITY,
   * and data/newbuffalo-seeds.txt warned in advance that a bare chain domain
   * cannot name a shop on its own. shophod.com came back CONFIRMED anyway,
   * because a chain's front door lists the towns it trades in. That is a
   * finding about the chain, not about a shop, and it is precisely the
   * Sapura/Exclusive failure that once put 693 rows under another shop's name.
   * So it is here with its measured platform and NO promotion: it needs a url
   * whose PATH names this shop before it can be anything else.
   *
   * ALL THREE ARE enabled:false and that is not a formality. None of them has
   * yet proved WHICH STORE its prices belong to, which is the only question
   * that matters in a border market two miles from a different municipality.
   *
   * WHAT THE CATALOGUE PROBE FOUND WHEN IT ASKED ALL THREE FOR PRODUCTS (run 8,
   * against the roster as committed rather than against the sweep's leads):
   *
   *   lume-newbuffalo   server-readable   935 products from one 4.9MB GET
   *   jars-newbuffalo   render-needed     10 fetches, all 200, products=0
   *   hod-newbuffalo    render-needed     every menu path 404
   *
   * One of three is an adapter shop and the other two belong to the headless or
   * operator lane. That is a worse ratio than the readability sweep suggested
   * twenty minutes earlier, and the difference is the whole reason both probes
   * run: one asks whether a page loaded, the other asks whether a catalogue
   * came back, and only the second decides anything.
   */
  /* Confirmed on a url whose path names this shop, which is the bar House of
     Dank below does not clear. Platform read off the page: cannavate, the same
     platform Coldwater's Herbology runs, so an adapter may already exist.

     AND THE SECOND RUN CORRECTED THE FIRST, which is the reason this shop is
     worth a paragraph. readability-sweep graded it "server-readable via rsc" at
     223KB, and on that reading it was the most promising unconnected shop in
     the town. probe-catalogue then ASKED IT FOR PRODUCTS -- five page paths and
     five platform endpoints, every one HTTP 200 -- and got products=0 from all
     ten. The 223KB is a shell; the catalogue arrives client-side.

     That is the same over-generous verdict this repo caught once before, and it
     is why the two probes both exist: "did a page load" and "did a catalogue
     come back" are different questions, and only the second one decides a lane.
     JARS is the headless or operator lane here, not an adapter. */
  { key:"jars-newbuffalo", name:"JARS Cannabis",   town:"newbuffalo", addr:"", phone:"",
    site:"https://jarscannabis.com/michigan/new-buffalo/",
    area:"", platform:"cannavate", enabled:false,
    note:"Confirmed 2026-09-07: page names New Buffalo, platform read as cannavate. Render-needed, measured: ten fetches, all HTTP 200, products=0 on every one. Not an adapter shop." },
  /* CONFIRMED BY THE SWEEP AND NOT PROMOTABLE ON IT, per the note above. The
     seed was the chain's front door because no New Buffalo path was known, and
     that is still true. Platform dutchie and render-needed are real readings
     OF THE CHAIN SITE and say nothing about a shop here. */
  { key:"hod-newbuffalo", name:"House of Dank",    town:"newbuffalo", addr:"", phone:"",
    site:"https://shophod.com/",
    area:"", platform:"dutchie", enabled:false,
    note:"Sweep confirmed shophod.com names New Buffalo, but that is a bare chain domain listing its towns, not this shop's own page. The catalogue probe then 404'd on every menu path tried and got products=0 from the one page that answered, which is what a chain front door with no New Buffalo store path looks like. Needs a url whose path names this store before it is anything more than a lead." },

  ...LUME_TOWNS.map(lumeStore),
];

export { STORES, TOWNS, DEFAULT_TOWN, townKey, lumeStore, LUME_TOWNS };
