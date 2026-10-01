# public/img

Anything in `public/` is served at the matching URL, because `vercel.json` sets
`outputDirectory: public`. So a file dropped in here as `joint-arrow.png` is live
at `https://legal-leafmarket.com/img/joint-arrow.png` as soon as it is pushed.
There is no upload step and no CDN configuration.

## joint-arrow.png — the rail arrows

`public/js/rails.js` prefers this file for the carousel arrows and falls back to
a drawn SVG when it is absent, so the control is never broken while the picture
is being prepared. Drop the file in and it takes over on the next deploy;
nothing else has to change.

  - ONE file only, the joint POINTING RIGHT. The left-hand arrow is the same
    image mirrored in CSS -- two files would be two things to keep in step.
  - TRANSPARENT background, so PNG or WebP. A white background becomes a white
    block on this site's near-black rail.
  - CROPPED TIGHT to the joint. Whitespace around it shrinks the joint inside
    the button for no reason.
  - About 600px wide is plenty: the control renders at ~58px, so that covers
    four times retina with room to spare. Bigger is only bytes.

Smoke in the picture is fine either way. A drawn smoke layer is overlaid on top
regardless and animates on hover, because smoke baked into a photograph cannot
move and the hover puff is the whole affordance.
