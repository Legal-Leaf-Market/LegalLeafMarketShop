# T-Rex Runner — third-party, vendored

**Upstream:** <https://github.com/wayou/t-rex-runner> — the T-Rex Runner easter egg
extracted from Chromium.
**Licence:** BSD 3-Clause. The full text is in `LICENSE.txt` beside this file, unchanged,
with the copyright notice retained as the licence requires.

> Named `LICENSE.txt` rather than `LICENSE` deliberately: an extensionless file
> is not served by `server.mjs`'s static resolver (its `tryFiles` appends
> `.html` or looks for `index.html`), so a bare `LICENSE` would 404 in local
> preview. A licence that has to travel with the distribution needs to actually
> be reachable.

## Why this is here rather than iframed from somebody else's server

itch.io's own documentation asks people not to embed other creators' games
("Please don't do that with somebody else's game"), and there is an open issue
about sites doing exactly that and burning the developers' bandwidth. Hot-linking
a game you did not write is rude whatever the licence says. This one carries a
licence that explicitly permits redistribution, so it is **self-hosted**: 156KB of
files we serve ourselves, costing nobody else anything.

That is the test for any future cabinet. A permissive licence (BSD, MIT, Apache,
CC0) means vendor it and credit it. No licence, or a "free to play" page with no
licence at all, means **ask the author** — not embed and hope.

## What was changed

Three cosmetic edits, listed in a comment at the top of `index.html`. No game
logic is touched:

1. The Google Fonts `<link>` removed — this repo blocks that host in every
   browser suite, and a render-blocking font in a cabinet is a stalled cabinet.
2. A dark skin, so it is not a white rectangle punched through a near-black page.
3. The canvas is inverted, because Chromium ships the dino as dark art on white
   and a dark ground needs the negative. Same trick Chrome's own dark mode uses.

## What was NOT copied

`assets/` upstream is 2.4MB, nearly all of it README screenshots and demo GIFs.
Only the two sprite sheets the game actually loads are here.
