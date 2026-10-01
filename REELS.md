# REELS.md — the /reels page, and where the reels travel

Two jobs in one file: how to run the `/reels` page (the site now *features* the family's
Instagram reels instead of just tagging the accounts), and the distribution playbook for
posting those reels beyond Instagram. Written 2026-08-14.

---

## 1. What /reels is

`public/reels.html`, served at **`/reels`** (routing added in BOTH `vercel.json` and
`server.mjs`, per CLAUDE.md §3). Linked from the home-page nav ("Reels"), the home footer,
and the footer link row on `/consumables`, `/devices`, `/international`, `/greekglass`.

The page has two layers, and only one of them ever needs a human:

- **The account grids (zero upkeep).** Each of the five accounts renders as a live
  Instagram *profile embed* (`instagram.com/<handle>/embed/`): newest posts, served by
  Instagram itself, always current. Nothing in this repo refreshes them because nothing
  has to.
- **Featured reels (curated).** The `featured` array in **`public/reels.json`** pins
  hand-picked reels to the top of the page as full playable embeds. Empty array = the
  section hides itself; it never ships as an empty shelf.

The five accounts (also in `reels.json`, so adding a sixth is a JSON edit, not a code
change):

| Handle | Shown as |
|---|---|
| `@legal_leaf_market` | Legal Leaf Market — the market's own account |
| `@legalleafjacob` | Legal Leaf Jacob |
| `@herbal_leaf_market` | Herbal Leaf Market |
| `@nicotia_market` | Nicotia Market |
| `@stomp_box_world` | Stomp Box World |

The Organization JSON-LD on the home page previously pointed `sameAs` at
`instagram.com/legalleafmarket` (no underscores — a handle the family doesn't use). It now
points at `instagram.com/legal_leaf_market`. Only the brand's own profile lives in
`sameAs`; the other four are linked from `/reels`, which is the right place for
different-entity accounts.

## 2. How to feature a reel (the whole procedure)

1. Open the reel on Instagram → **Share → Copy link.**
2. Edit **`public/reels.json`** (the GitHub web editor is fine, phone included).
3. Append to `featured`:

```json
{ "url": "https://www.instagram.com/reel/SHORTCODE/", "by": "legal_leaf_market", "title": "What price per gram actually tells you" }
```

4. Commit / merge. Vercel redeploys and the reel is at the top of `/reels`.

Any `instagram.com` link with `/reel/`, `/reels/`, `/p/` or `/tv/` in it works, query
strings and `/<username>/` prefixes included — the page extracts the shortcode. `by` is
the handle shown under the card (with or without the `@`), `title` is optional. Remove the
entry to unfeature. Order in the file is display order.

## 3. Caveats worth knowing before they look like bugs

- **No Instagram API, no token, on purpose.** Auto-pulling "the latest reels" as first-class
  data needs Meta's oEmbed/Graph API and an app token — a secret to manage and a dependency
  this repo deliberately doesn't take (CLAUDE.md §1, §9). Profile embeds get 90% of the value
  for 0% of the surface.
- **Instagram serves the embeds.** In some regions/browsers a grid may show a log-in wall
  instead of posts. The follow buttons and handle links always work; that's why every card
  carries them outside the iframe.
- **An embed that renders blank** usually means the reel was deleted, made private, or the
  URL lost its shortcode. Fix the entry in `reels.json`; nothing in this repo caches it.
- The page tracks with the site's own `LL.track` (`reels_view`, `reels_out`) — see
  `ANALYTICS.md`. No new analytics surface.

## 4. Where else to post the reels

Already active: **Instagram, Facebook, X, Threads, Reddit.** The list below is ranked by
expected return for educational cannabis/hemp content specifically. Platform drug policies
move; when in doubt re-check the platform's page — this table is honest as of Aug 2026.

**Add these:**

- **YouTube Shorts — the biggest gap.** Second-largest short-video surface, and unlike
  Instagram the content keeps working for years (Shorts surface in search and
  recommendations long after posting; a reel is dead in 48 hours). Educational/documentary
  cannabis content is allowed under YouTube policy; expect possible age-restriction, keep
  purchase links out of descriptions, don't demonstrate consumption. Bonus: a YouTube
  channel gives the site embeddable video that never shows a log-in wall.
- **Bluesky.** Cannabis-tolerant culture, growing fast, and the X-format content you
  already make reposts there verbatim. Near-zero marginal effort.
- **LinkedIn.** Sounds wrong, isn't: hemp is an industry, the 0.3% line is a business
  story, and "we read 1,400 lab certificates" is exactly what performs there. Zero policy
  friction for education. Post the reels natively with a written framing paragraph.
- **Pinterest — test it.** Organic educational CBD/hemp content broadly survives (ads
  don't). Video pins have long lives and search intent ("what is THCa") matches the
  library's content. Start with the most educational, least deal-y reels.
- **Tumblr.** Small but permissive and communities persist. Effort rounds to zero if
  you're already multi-posting.
- **Communities, not platforms: Discord and Telegram.** Deal-hunter servers and hemp
  groups are where this audience already congregates. Share reels as clips + a link. Also
  consider running your own — the email list (Resend is already wired in) is the owned
  version of this.
- **The site + the email list.** Every newsletter should carry one featured reel;
  `/reels` is the landing page for it. Owned distribution is the only channel no policy
  change can take away.

**Skip or handle with gloves:**

- **TikTok.** Reach is real, enforcement against cannabis content is real-er. Accounts get
  banned for educational content regularly; if you try it, use a dedicated account you can
  afford to lose, zero product/price talk, zero consumption, and expect strikes anyway.
- **Snapchat.** Policy hostile, discovery weak for this niche. Not worth the upload.
- **Anything paid.** Meta/Google/TikTok ads for cannabis-adjacent content is its own
  compliance project; organic only until that's a deliberate decision.

**Mechanics that matter more than the platform list:**

1. **Strip the watermark before cross-posting.** YouTube and TikTok downrank videos with
   a visible other-platform watermark. Export clean from the editor (CapCut etc.), not
   from the Instagram share sheet.
2. **On Instagram itself, use Collab posts across the five accounts.** Inviting a second
   account as collaborator puts one reel in both feeds with merged engagement — that's the
   "featuring each other" move on-platform, and it beats tagging by a mile. Tag the other
   three in the caption.
3. **Education travels, deal-talk gets flagged.** Prices, "link in bio to buy," and cart
   screenshots are what trip enforcement on Meta/TikTok/YouTube. Keep the deals on the
   site; the reels teach, the site sells. (Same division of labor this repo already has.)
4. **Links in first comment / reply**, not the post body, on platforms that downrank
   external links (X, Facebook). Reddit: respect each sub's self-promo rules — the 9:1
   rule is the norm; post the video natively and be a participant, not a flyer.
5. **One canonical home per reel.** When a reel is worth featuring, pin it in
   `reels.json` the same day it posts — the site is the only place all five accounts'
   best work sits side by side.
