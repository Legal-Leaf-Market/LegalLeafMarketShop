/* public/js/arcade-games.js — WHAT IS IN THE ARCADE. One file, five sites.
 *
 * "This needs to be one code base of Brayton's games, hosted on Godot, that
 * can then be at /arcade on all of our sites."
 *
 * SO THE ARCADE IS THREE FILES AND A FOLDER, and nothing else:
 *
 *     public/arcade.html          the cabinet wall   (identical everywhere)
 *     public/js/arcade-games.js   THIS FILE          (identical everywhere)
 *     public/js/arcade-play.js    the player         (identical everywhere)
 *     public/arcade/<id>/         one game's build   (identical everywhere)
 *
 * Copy those to Nicotia, Herbal-Leaf, Kawaii Katz or Stompbox and the arcade
 * is there. The only thing that differs between the sites is the palette, and
 * every one of them already loads its own tokens.css -- so the page reaches
 * for --bg, --leaf, --gold and --line and comes out wearing the local colours
 * with no per-site branch. Same argument as api/markets.js and api/shelves.js:
 * a behaviour every site shares is not a behaviour a site file gets to own.
 *
 * ------------------------------------------------------------------
 * A GAME IS NEVER LOADED UNTIL SOMEBODY PRESSES IT, and that is a hard rule
 * rather than a nicety. A Godot web export is 10-25MB of WASM. Auto-loading
 * one on a page that also sells things would cost the shelf its mobile load
 * time, which is the one thing on this site that actually makes money. So the
 * wall renders covers, and `embed` is fetched on click, in an iframe.
 *
 * ------------------------------------------------------------------
 * THE COOP/COEP TRAP, WRITTEN DOWN BEFORE IT COSTS AN EVENING.
 *
 * Godot 4 exports with THREADS require two response headers:
 *
 *     Cross-Origin-Opener-Policy: same-origin
 *     Cross-Origin-Embedder-Policy: require-corp
 *
 * COEP blocks every cross-origin subresource that does not opt in. Set it on a
 * page of this site and EVERY PRODUCT PHOTO GOES BLANK -- Shopify's CDN,
 * lookah.com, vapor.com, all of them. It is the single most destructive header
 * that could be added to this repo.
 *
 * TWO WAYS OUT, and this file takes both:
 *   1. Prefer a SINGLE-THREADED Godot export (`threads:false` at export time).
 *      It needs no headers at all, so it can be served from anywhere. Slower,
 *      and for a 2D game nobody will notice.
 *   2. Where a game genuinely needs threads, the headers go on THAT GAME'S
 *      PATH ONLY, via a scoped `headers` entry in vercel.json matching
 *      `/arcade/<id>/(.*)`, and the game is played in an iframe so the parent
 *      page never inherits them. `threads:true` below is what says so, and
 *      arcade.html refuses to inline such a game into the page.
 *
 * ------------------------------------------------------------------
 * PERMISSION. The two games this was built for are Brayton's (Dean), and the
 * owner said plainly that they do not have his full sign-off yet. So the page
 * is noindex, is in no nav and is in no sitemap, and every entry here starts
 * `listed:false` -- present, playable by someone with the link, advertised to
 * nobody. Flipping `listed` is how a game goes public, and that flag is the
 * one thing that should wait on Brayton actually saying yes.
 */
(function () {
  "use strict";

  /* Each entry:
   *   id       folder under public/arcade/, and the ?g= value
   *   title    on the cabinet
   *   by       who made it -- always credited, never blank
   *   blurb    one line, what it is
   *   cover    a still. Local, or omitted for a drawn placeholder.
   *   embed    the page to iframe. Omitted = not installed yet.
   *   threads  true only if the build needs SharedArrayBuffer (see above)
   *   weight   rough download, printed BEFORE anyone commits to it
   *   listed   false keeps it off the public wall
   */
  var GAMES = [
    {
      id: "invaders",
      title: "Shelf Invaders",
      by: "Legal-Leaf Market",
      blurb: "The house cabinet. A few kilobytes of canvas, no download.",
      builtin: true,
      threads: false,
      weight: "",
      listed: true,
    },
    {
      id: "dino",
      title: "T-Rex Runner",
      by: "Chromium / wayou fork",
      blurb: "The one you already know from being offline. Space to jump.",
      embed: "/arcade/dino/",
      threads: false,
      weight: "160KB",
      listed: true,
      /* SELF-HOSTED, NOT HOT-LINKED, AND THAT IS THE RULE FOR EVERY FUTURE
         CABINET. It is BSD-3, so redistribution is explicitly permitted --
         LICENSE and NOTICE.md sit beside the build with the copyright notice
         retained. itch.io's own docs ask people not to embed other creators'
         games, and sites that do are burning somebody else's bandwidth. A
         permissive licence means vendor it and credit it; no licence means ask
         the author, not embed and hope. */
    },
    {
      id: "deep-water",
      title: "Deep Water",
      by: "Brayton (Dean)",
      blurb: "Horror fishing. Something is down there and it is not a fish.",
      embed: "",
      threads: false,
      weight: "",
      listed: false,
      note: "Not installed yet: drop the Godot web export into public/arcade/deep-water/ and set embed.",
    },
    {
      id: "long-haul",
      title: "Long Haul",
      by: "Brayton (Dean)",
      blurb: "Space travel, trade, and a fight you probably should have avoided.",
      embed: "",
      threads: false,
      weight: "",
      listed: false,
      note: "Not installed yet: drop the Godot web export into public/arcade/long-haul/ and set embed.",
    },
  ];

  /* Installed means there is something to load. An entry with no `embed` and
     no `builtin` is a placeholder -- it renders as a dark cabinet saying so,
     rather than as a button that does nothing when pressed. */
  function installed(g) { return !!(g && (g.builtin || g.embed)); }

  window.LL_ARCADE = {
    games: GAMES,
    installed: installed,
    /* The wall shows what is listed AND installed. `?all=1` shows everything,
       which is how the owner looks at a game before it goes public. */
    visible: function (showAll) {
      return GAMES.filter(function (g) { return showAll || (g.listed && installed(g)); });
    },
    byId: function (id) {
      for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
      return null;
    },
  };
})();
