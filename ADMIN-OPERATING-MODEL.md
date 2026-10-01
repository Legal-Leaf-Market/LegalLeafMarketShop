# Operating model — admin mode

The 24-month projection for the four-site affiliate family, served privately at
**`/admin/operating-model`** on legal-leafmarket.com.

## Why this isn't a Next.js page

This feature was originally built and verified against a snapshot of this
codebase that turned out to predate a revert back to the zero-dependency
static + serverless architecture CLAUDE.md describes (§2, §11: "Do NOT add a
build step / framework"). That snapshot's version of the feature was a full
Next.js App Router subtree — React components, Tailwind, Better Auth. None of
that exists here, and adding it for one internal page would be a far bigger
change than the page itself, and would risk re-triggering the "No Next.js
version detected" deploy failure CLAUDE.md warns about.

So this is a **native reimplementation**: the same math, the same defaults,
the same acceptance numbers, but as plain HTML/CSS/JS served by
`api/*.js` serverless functions, matching every other page in this repo.

## Turning it on

The gate **fails closed**. With no credential configured nobody gets in, and
the sign-in page says so rather than silently exposing the page. Set this in
your Vercel project's environment variables and redeploy:

| Variable | What it does |
|---|---|
| `ADMIN_PASSCODE` | A long random string. Type it at `/admin/sign-in` to unlock. It also signs the session cookie, so changing it signs everyone out. Sessions last 30 days. |

The upstream brief this was built from also specced a second path —
`ADMIN_EMAILS` checked against a Better Auth session — for deployments that
already have their own user login wired up. This codebase has no user
accounts, no Better Auth and no `DATABASE_URL`, so that path is not
implemented here. If this site ever grows real user accounts, `api/admin/_gate.js`
is where a second `isAdmin()` path would go.

Failed passcode attempts are rate-limited per IP (8 / 10 min) and compared in
constant time. The whole `/admin` tree is `noindex, nofollow, nocache`, listed
in `robots.txt` under `Disallow`, and absent from `sitemap.xml`.

## What the page does

Everything recalculates live — nothing downstream of the assumptions is
hard-coded.

- **Scenario** — bear / base / bull. The scenario *multiplies* the assumptions
  rather than replacing them, so your edits survive a scenario switch.
- **Edit any cell** — basket, commission, conversion and attribution are
  editable inline in the unit-economics table; all eight inputs per site
  (including the three session anchors) live in the assumptions panel.
- **Actuals** — enter real sessions *and* real earned commission for a closed
  month. Both are required: revenue alone can't tell you whether you missed on
  traffic or on yield. Once a month has both, it overrides the model and
  re-anchors everything after it, per site — forward traffic scales by how
  you're tracking against plan, and forward revenue per session is re-based on
  realised yield while keeping the modelled improvement curve.
- **Persistence** — entries save to your browser's `localStorage` automatically
  (key `llm.operating-model.v1`), with export, import and reset.

## How the projection is built

`api/admin/_client-engine.js` is the whole engine — a plain browser script,
inlined into the gated page's HTML by `api/admin/model.js` (never served as a
standalone static file, so the numbers are never reachable while signed out).

1. **Traffic** follows an S-curve in log space,
   `ln sessions(t) = A + B·sigmoid(k(t − t0))`, solved so it passes through the
   month-1, month-12 and month-24 anchors exactly. `k` is a per-site constant;
   `A`, `B` and `t0` are derived by scanning for a sign change and bisecting.
   If a pathological set of anchors admits no solution, it falls back to
   piecewise-geometric interpolation rather than returning `NaN`.
2. **Seasonality** multiplies on top — a fixed per-category monthly vector.
   April for hemp, January for nicotine, Q4 for tea and gifting, Black Friday
   through December for kawaii. The anchors describe the deseasonalised trend,
   which is why a month can print slightly above or below its anchor.
3. **Conversion** matures from 80% to 125% of the stated rate over the
   horizon; **attribution** ramps from today's capture to its month-24 target.
   Both are normalised Weibull curves reaching their end state exactly at
   month 24.
4. **Revenue** = sessions × conversion × basket × commission × attribution.
   GMV and orders are derived from revenue so that `revenue / GMV` always
   equals `commission × attribution` and `GMV / orders` always equals the
   basket — true for modelled and re-anchored months alike.

Reproduced from the 8 August 2026 model: month 24 (`$8,390`), exit run-rate
(`$100,679`), blended revenue per session (`$0.123`), month-24 sessions
(`68,241`), the per-site maturity economics (`$0.240 / $0.055 / $0.141 /
$0.072`), the bear 24-month total (`$15,371`) and the bull exit run-rate
(`$254,715`) all reproduce exactly in this implementation.

## Files

```
api/admin/_gate.js                  the gate: passcode issue/verify, throttle, cookie
api/admin/_client-engine.js         engine + reference data (inlined into the page, never standalone)
api/admin/_client-app.js            the dashboard UI (state, tables, controls, chart)
api/admin/_client-styles.css        admin page styles, built on this site's own tokens.css
api/admin/_page-shell.js            shared HTML chrome (noindex meta, header, sign-out)
api/admin/home.js                   /admin -> redirect to /admin/operating-model
api/admin/sign-in.js                /admin/sign-in -> passcode form or setup instructions
api/admin/model.js                  /admin/operating-model -> the gated page
api/admin/session.js                /api/admin/session -> passcode check, cookie issue/clear
public/robots.txt                   (modified) /admin added to Disallow
vercel.json                         (modified) rewrites for the three /admin routes
server.mjs                          (modified) local-preview parity for the same three routes
```

The chart is hand-rolled inline SVG built via the DOM API, no library. Its
four colours were validated as a set against the dark chart surface for
lightness band, chroma floor, colour-vision separation and contrast; the
green↔pink pair sits in the 6–8 ΔE band, which is why the bands carry a 2px
surface gap, a legend and direct end-of-series labels rather than relying on
hue alone.
