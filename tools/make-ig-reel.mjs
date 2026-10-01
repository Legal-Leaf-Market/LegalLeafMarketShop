/* tools/make-ig-reel.mjs — render the reel in HEMP_LAW_IG_CONTENT.md as a
 * 1080x1920 MP4 (plus its cover frame and the numbered stills).
 *
 *   node tools/make-ig-reel.mjs                       # lists the reels it knows
 *   node tools/make-ig-reel.mjs reel1                 # -> out/ig/reel1/, silent
 *   node tools/make-ig-reel.mjs reel1 out --audio vo.wav   # with the voiceover
 *
 * WHAT THIS PRODUCES AND WHAT IT DOES NOT. This is the pack's "full
 * text-on-motion" option: the on-screen text, cut to the script's beats, as an
 * H.264 file ready to post or to take into CapCut. It draws no footage -- the
 * pictures are type.
 *
 * WITHOUT --audio it ships a SILENT AAC track rather than no track at all,
 * because several editors refuse or mistime a video-only import and that reads
 * as a corrupt file instead of a missing stream. WITH --audio the voiceover is
 * muxed in and the card timings are checked against it: the cards are cut to a
 * specific recording (see the beats note below), so pairing them with a
 * different take slides the picture off the voice a little further with every
 * card. That check is why the flag takes the file rather than the operator
 * adding audio afterwards -- by then nothing is watching the two lengths.
 *
 * The wav is NOT in the repo and must not be: it is 14MB of binary that changes
 * every re-record, and dependencies/artifacts stay out of this tree (CLAUDE.md
 * section 11). It is a path in, and out/ is gitignored.
 *
 * THE SAFE AREA IS THE WHOLE LAYOUT PROBLEM, and it is why these frames look
 * top-heavy opened on a desktop. Instagram draws its own UI over a reel: the
 * caption, handle and audio strip across the bottom and the like/comment/share
 * rail up the right. Meta's own guidance is to keep anything that must be read
 * clear of roughly the bottom third and the top eighth. So the content box here
 * is y=300..1300 of 1920 -- centred in the SAFE band, not in the frame. Centre
 * it in the frame and it reads perfectly in a file browser and sits under the
 * caption on a phone, which is the kind of mistake you only catch after posting.
 *
 * HARD CUTS, NO CROSSFADES. The script's own production note says "text slams
 * in, no music intro, start cold" -- the correction IS the hook, and a fade
 * softens the one beat the whole reel is built on. The concat demuxer carries
 * the per-beat durations and the output is CFR 30fps, which is what Instagram
 * wants. Note ffmpeg 6.1 REFUSES -r together with -fps_mode vfr ("this is
 * contradictory") and then fails to open the output at all, so do not add it.
 *
 * Shares the deck's palette and type with make-ig-slides.mjs on purpose: a reel
 * and its carousel arriving in the same feed should read as one campaign. If you
 * restyle one, restyle both -- they are deliberately not importing from each
 * other, because the reel's type scale is not the deck's and merging them would
 * mean a size table with two columns and a bug in whichever is used less.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import chromePath from "./chrome-path.mjs";

const W = 1080, H = 1920;          // 9:16
const SAFE_TOP = 300, SAFE_H = 1000;

const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px}
body{
  background:#0b120d;color:#eaf3ec;
  font-family:"Liberation Sans","DejaVu Sans",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;overflow:hidden;
}
.frame{
  position:relative;width:${W}px;height:${H}px;
  background:radial-gradient(120% 60% at 50% 22%, #121e16 0%, #0b120d 60%),#0b120d;
}
/* Everything readable lives in here. See the safe-area note at the top. */
.safe{
  position:absolute;top:${SAFE_TOP}px;left:80px;right:80px;height:${SAFE_H}px;
  display:flex;flex-direction:column;justify-content:center;gap:30px;
}
.mark{
  position:absolute;top:${SAFE_TOP + SAFE_H + 26}px;left:80px;
  font-size:26px;font-weight:700;letter-spacing:.05em;color:#3f5347;
}
h1{font-size:112px;line-height:1.03;letter-spacing:-.03em;font-weight:700}
h1.big{font-size:170px;line-height:.98}
h1.sm{font-size:92px}
.num{font-size:300px;line-height:.84;font-weight:700;letter-spacing:-.05em;color:#f0b93c}
.num.red{color:#ef5350}
.num.leaf{color:#4ade80}
.num.sm{font-size:230px}
.cap{font-size:44px;font-weight:700;letter-spacing:.17em;text-transform:uppercase;color:#9fb6a6}
.sub{font-size:46px;line-height:1.34;color:#9fb6a6}
.sub b{color:#eaf3ec}
/* UA-COLOURED ELEMENTS ARE FORCED BACK TO THE DECK'S INK. The reset at the top of
   this file zeroes margin and padding but never COLOUR, so any element the browser
   ships with a colour of its own keeps it: <a> renders link-blue, <mark> black on
   yellow, and button/input black on white. Hand-written slides never used those, so
   it stayed invisible -- but drafts are written as HTML by a model, and a model
   reaches for <a> to carry a source and <mark> to emphasise. Reported as "some of
   the text showed up black and therefore unreadable".

   mark is given a real highlight in the deck's own colours rather than being
   flattened, because it MEANS highlighted and a reader should still see that. */
.frame a, .frame button, .frame input, .frame select, .frame textarea,
.frame code, .frame kbd, .frame samp, .frame cite, .frame q {
  color:inherit; background:transparent; border:0; font:inherit;
}
.frame a{text-decoration:none}
.frame mark{color:#0b120d;background:#f0b93c;padding:0 .12em;border-radius:4px}
.stack{display:flex;flex-direction:column;gap:12px}
.stack div{font-size:104px;font-weight:700;letter-spacing:-.02em;line-height:1.06}
.rule{height:4px;width:150px;background:#4ade80}
/* End-card sign-off: the account this went out from, set larger and warmer
   than the per-frame watermark because it is the last thing on screen. */
.signoff{font-size:52px;font-weight:700;letter-spacing:-.01em;color:#f0b93c;margin-top:14px}
`;

/* Each beat is {t, body} where t is seconds on screen. The eight beats of the
   script are cut into thirteen frames: a beat that holds while the VO says two
   sentences needs a second card, or the picture dies under the voice.

   TIMINGS ARE CUT TO A SPECIFIC RECORDING, PER REEL. reel1 is cut to the 78.49s
   take; reel2 to a 64.64s one.

   AND WHEN A TAKE IS AN EDIT OF THE LAST ONE, DO SURGERY, NOT A RE-DERIVATION.
   reel2's 64.64s wav is the 69.64s wav with 5.00s removed: every pause up to 13.67s
   is identical and every pause from 24.45s on is shifted by exactly -5.00s, to the
   centisecond. Re-deriving from word weights against it snapped only 2 of 9 cuts and
   would have thrown away an alignment that was already right. Keeping the accepted
   boundaries, moving everything after the removal by -5 and splitting the lost 5s
   across the two cards that spanned it lands 5 cuts back in measured pauses.
   Diff the pause lists before assuming a new recording is a new performance.

   The pack estimated 40-44s for reel1 and a read-through came in at 1:25, so the
   only number worth cutting to is the wav that is actually going out.

   WHICH WAV BELONGS TO WHICH REEL IS NOT SELF-EVIDENT, and getting it wrong is
   silent. Both arrived named "The_Lone_Stoner__Reel__1.wav" and the 69.64s file was
   first paired with reel1 on that basis -- it is reel2's. Length does not settle it
   either: 69.64s is 178 wpm against reel1's 207 words and 109 wpm against reel2's
   126, and both are readable paces. Only the person who recorded it knows. Check
   the md5 before re-cutting anything; the second upload of that file was
   byte-identical to the first.

   Two things set the numbers, in this order:

   1. WORD WEIGHT, not a uniform scale. A card carrying "Not per serving. Per
      container." and a card carrying three sentences do not need the same room;
      scaled uniformly the punch line sits dead while the dense cards rush. Each
      beat is weighted by the words spoken over it (207 words across the read), so
      the picture changes when the sentence does.
   2. SNAPPED TO PAUSES ACTUALLY MEASURED IN THE WAV, via ffmpeg silencedetect.
      A cut that lands mid-word reads as a mistake; the same cut moved into the
      breath reads as an edit.

   SNAPPING IS SEQUENTIAL, AND ON THE SECOND TAKE THAT WAS THE DIFFERENCE. Compared
   against a fixed word-weighted grid this read agreed at only four of twelve cuts,
   which reads as "the model does not fit this take". It does fit: each accepted
   snap re-anchors the cards after it, so drift is corrected as it goes instead of
   accumulating. Re-anchored, seven of twelve land in a real pause -- one of them
   (card 8) within 0.01s. Judge the fit after re-anchoring, never before.

   THIS TAKE ALSO OPENS WITH 1.39s OF SILENCE, where the first opened with 0.41s.
   Distributing words from t=0 would run every card about a second early for the
   whole reel, drifting worst at the end where nothing is left to absorb it. Card 1
   holds through the lead-in and the words are spread over the SPEECH span.

   WHAT IS ASSUMED, AND HOW IT FAILS. silencedetect gives the position of a pause,
   never its CONTENT -- so this assumes the read follows the script in order. The
   agreement above is strong evidence for that but not proof. If a card lands on
   the wrong sentence, the fix is to move that one boundary, not to re-derive the
   set.

   AND DO NOT REUSE THE LAST TAKE'S THRESHOLD. The first recording had a bed under
   the voice and a floor near -20dB, so nothing registered below that and -18dB was
   what found its sentence breaks. This one is clean: pauses register down to -40dB,
   and -35dB/0.15s is what fits it. Run the sweep per recording -- carrying the old
   number over would have found 37 "pauses" in this file, most of them inside
   words.

   MINIMUM 2s PER CARD, and it is enforced on the snap rather than after it: a
   boundary is only taken if the card it closes still runs 2s or longer. On the
   first take that guard kept card 4 from being flashed for 1.08s, which is under
   what anyone can read. A boundary is only worth snapping to if the card survives
   it. */
const REELS = {
  reel1: {
    title: "It's Not Law Yet",
    cover: 2,                        // "IT DIDN'T." -- the script names this as the cover
    /* The account this reel posts FROM, stamped on every frame and on the end
       card. It is a per-reel field rather than a constant because the family
       runs several accounts (see reels.json) and the same argument can go out
       from more than one of them. Written as a NAME, not an @handle: an invented
       handle is a link to nowhere or, worse, to somebody else, which is the same
       reason api/products.js refuses to invent an affiliate id. Put the @ form
       here once the real one is confirmed. */
    handle: "The Lone Stoner",
    beats: [
      { t: 3.51, body: `<h1>YOU HEARD<br>THE HEMP BAN<br>GOT DELAYED.</h1>` },
      { t: 4.74, body: `<h1 class="big" style="color:#4ade80">IT<br>DIDN&#8217;T.</h1>` },
      { t: 9.12, body: `
        <div class="num red">0.4 mg</div>
        <div class="cap">Per container</div>` },
      { t: 2.07, body: `
        <h1 class="sm">NOT PER SERVING.</h1>
        <h1 class="sm" style="color:#ef5350">PER CONTAINER.</h1>` },
      { t: 4.25, body: `
        <div class="stack">
          <div>GUMMIES</div><div>DRINKS</div><div>VAPES</div>
        </div>
        <div class="sub">The whole shelf.</div>` },
      { t: 5.37, body: `
        <div class="num">$28B</div>
        <div class="sub">redefined out of existence<br>in one line of a spending bill.</div>` },
      { t: 7.33, body: `
        <div class="cap">The Senate voted</div>
        <div class="num sm">90&#8211;6</div>
        <div class="sub">to move the date to <b>December 11</b>.</div>` },
      { t: 8.69, body: `
        <div class="cap">Motion to table</div>
        <div class="num sm leaf">61&#8211;32</div>
        <div class="sub">Thune and Schumer voted <b>the same way</b>.</div>` },
      { t: 6.56, body: `<h1 style="color:#e8a33d">THE HOUSE<br>HASN&#8217;T VOTED.</h1>` },
      { t: 3.87, body: `
        <h1 class="sm">BACK AUG 31.</h1>
        <div class="rule"></div>
        <div class="sub">Ten weeks on the calendar.<br>Far fewer legislative days.</div>` },
      { t: 10.63, body: `
        <h1>NOV 12 IS<br>STILL REAL.</h1>
        <div class="sub">Square told sellers to clear their<br>catalogs by <b>October 15</b>.</div>` },
      /* The old final card held the whole close for 3s. At 85s that became a 13s
         hold on one card, so the close is split where the VO already splits:
         the argument, then the address. */
      { t: 8.03, body: `
        <h1 class="sm">A REGULATED MARKET.</h1>
        <h1 class="sm" style="color:#ef5350">NOT A BANNED ONE.</h1>
        <div class="sub">Your House member needs to hear it.</div>` },
      { t: 4.32, body: `
        <h1 class="sm" style="color:#4ade80">hempsupporter.com</h1>
        <div class="sub">Send this to someone<br>who sells it.</div>
        <div class="signoff">{{handle}}</div>` },
    ],
  },

  /* Reel 2 does a different job from reel 1 and is paced for it. Reel 1 corrects
     the record and wants urgency; this one is arithmetic somebody is doing about
     their own business, so the beats are longer and the close asks a question
     instead of answering it.

     TIMINGS ARE ESTIMATED, NOT MEASURED, and that is the one thing to know before
     using them. Reel 1's cards are cut to a real recording -- word-weighted, then
     snapped to pauses found in the wav. There is no recording for this one yet, so
     these are the word weights alone at the ~158 wpm reel 1 actually came in at.
     Record the VO, run with --audio, and the length check will refuse the pairing
     if the read lands more than a second from 48s; re-weight from the real total
     rather than nudging cards until it fits. */
  reel2: {
    title: "The Survival Path",
    cover: 2,                        // "IT LOOKS LIKE ALCOHOL." -- the comparison is the hook
    handle: "The Lone Stoner",
    beats: [
      { t: 7.24, body: `<h1 class="sm">THERE&#8217;S A LEGAL PATH<br>FOR HEMP DRINKS.</h1>` },
      { t: 2.58, body: `<h1 class="big" style="color:#f0b93c">IT LOOKS<br>LIKE<br>ALCOHOL.</h1>` },
      { t: 3.94, body: `
        <div class="cap">Per serving</div>
        <div class="num sm leaf">5 mg</div>
        <div class="sub">Total intoxicating THC. <b>21 and over.</b></div>` },
      { t: 3.47, body: `
        <div class="cap">Federal excise</div>
        <div class="num sm">8&#162;</div>
        <div class="sub">per milligram of THC</div>` },
      { t: 6.13, body: `
        <h1 class="sm">A 5 mg CAN?</h1>
        <h1 class="big" style="color:#f0b93c">40&#162;</h1>
        <div class="sub">Before you&#8217;ve paid anyone else.</div>` },
      { t: 6.35, body: `
        <div class="cap">Three-tier, under the TTB</div>
        <h1 class="sm">MAKER<br>&#8594; WHOLESALER<br>&#8594; RETAILER</h1>` },
      { t: 7.51, body: `
        <h1 class="sm" style="color:#ef5350">NO VERTICAL<br>INTEGRATION.</h1>
        <div class="sub">If you make it and sell it today,<br>read that part twice.</div>` },
      { t: 8.25, body: `
        <h1 class="sm">DRINKS ONLY.</h1>
        <div class="rule"></div>
        <div class="sub">Flower, edibles, vapes &#8212; no carve-out.<br>
        <b>November 12 still stands for them.</b></div>` },
      { t: 7.73, body: `
        <h1 class="xs">THE QUESTION ISN&#8217;T<br>WHETHER IT&#8217;S<br>GOOD NEWS.</h1>
        <div class="sub">It&#8217;s whether your margin survives it.</div>` },
      { t: 11.44, body: `
        <h1 class="sm" style="color:#4ade80">IT&#8217;S IN<br>COMMITTEE NOW.</h1>
        <div class="sub">That&#8217;s when they&#8217;re still listening.<br>Tell them either way.</div>
        <div class="signoff">{{handle}}</div>` },
    ],
  },
};

const argv = process.argv.slice(2);
const aIdx = argv.indexOf("--audio");
const audio = aIdx >= 0 ? argv[aIdx + 1] : null;
if (aIdx >= 0 && !audio) { console.error("--audio needs a file path."); process.exit(2); }
/* GUARDED ON aIdx >= 0, and the unguarded version is why this is commented. With
   no --audio, indexOf returns -1, so `i !== aIdx + 1` reads `i !== 0` and silently
   drops the FIRST positional -- the reel name. The command then prints its own
   usage, which looks like a typo in the argument rather than the parser eating it.
   It survived because every run after the flag was added passed --audio. */
const positional = aIdx >= 0
  ? argv.filter((_, i) => i !== aIdx && i !== aIdx + 1)
  : argv;
const key = positional[0];
const outRoot = positional[1] || "out/ig";

if (!key || !REELS[key]) {
  console.error(
    (key ? `Unknown reel "${key}".\n\n` : "Render one reel to MP4.\n\n") +
    "Usage: node tools/make-ig-reel.mjs <reel> [outDir] [--audio <voiceover>]\n\nKnown reels:\n" +
    Object.entries(REELS).map(([k, r]) =>
      `  ${k}  ${r.title} (${r.beats.length} frames, ${r.beats.reduce((a, b) => a + b.t, 0).toFixed(2)}s)`
    ).join("\n"));
  process.exit(key ? 2 : 0);
}

const reel = REELS[key];
const dir = resolve(outRoot, key);
mkdirSync(dir, { recursive: true });
const chrome = chromePath();
const total = reel.beats.reduce((a, b) => a + b.t, 0);

/* Checked BEFORE rendering thirteen frames, because this is the failure that
   wastes the most time to discover late: the cards are cut to one specific
   recording, so a different take slides the picture off the voice a little
   further with every card and is only obvious near the end. A second of slack
   is generous -- it is there for a re-export of the SAME read, not a new one. */
if (audio) {
  const a = spawnSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio,
  ], { encoding: "utf8" });
  const aDur = parseFloat((a.stdout || "").trim());
  if (!Number.isFinite(aDur)) {
    console.error(`Could not read a duration from ${audio}.`); process.exit(1);
  }
  if (Math.abs(aDur - total) > 1.0) {
    console.error(
      `The audio is ${aDur.toFixed(2)}s and the cards total ${total.toFixed(2)}s.\n` +
      `These cards are cut to a specific read; re-weight the beats for this one ` +
      `rather than letting the picture drift off the voice.`);
    process.exit(1);
  }
}

const pngs = reel.beats.map((beat, i) => {
  const n = String(i + 1).padStart(2, "0");
  const html = resolve(dir, `frame-${n}.html`);
  const png = resolve(dir, `frame-${n}.png`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="frame">
  <div class="safe">${beat.body.replace(/\{\{handle\}\}/g, reel.handle)}</div>
  ${beat.body.includes("{{handle}}") ? "" : `<div class="mark">${reel.handle}</div>`}
</div></body></html>`, "utf8");
  const r = spawnSync(chrome, [
    "--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
    "--force-device-scale-factor=1", `--window-size=${W},${H}`,
    `--screenshot=${png}`, `file://${html}`,
  ], { stdio: "ignore" });
  if (r.status !== 0) { console.error(`frame ${n}: chrome exited ${r.status}`); process.exit(1); }
  return png;
});

/* ONE INPUT PER BEAT WITH AN EXPLICIT -t, NOT THE CONCAT DEMUXER. The demuxer's
   documented trick for stills is to give each entry a `duration` and then repeat
   the last file with none, so the final beat is not dropped -- but that repeat
   is itself an entry, and it stretched a 44.0s script to 47.97s. Nothing errors:
   you get a video that plays, runs long, and drifts further from the voiceover
   with every beat. `-loop 1 -t <seconds>` per input is exact and is checked
   below against the script's own total. */
const mp4 = resolve(dir, `${key}.mp4`);
const inputs = reel.beats.flatMap((b, i) => ["-loop", "1", "-t", String(b.t), "-i", pngs[i]]);
const chain = reel.beats.map((_, i) => `[${i}:v]`).join("");
const ff = spawnSync("ffmpeg", [
  "-y", ...inputs,
  /* The voiceover if one was given; otherwise a silent stereo track, because
     some editors mistime or refuse a video-only import and that reads as a
     broken file rather than as a missing audio stream. */
  ...(audio ? ["-i", audio]
            : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"]),
  "-filter_complex", `${chain}concat=n=${reel.beats.length}:v=1:a=0[v]`,
  "-map", "[v]", "-map", `${reel.beats.length}:a`,
  "-r", "30", "-pix_fmt", "yuv420p",
  "-c:v", "libx264", "-profile:v", "high", "-crf", "18",
  "-c:a", "aac", "-b:a", "128k", "-shortest",
  "-movflags", "+faststart", mp4,
], { encoding: "utf8" });
if (ff.status !== 0) {
  console.error("ffmpeg failed:\n" + (ff.stderr || "").split("\n").slice(-15).join("\n"));
  process.exit(1);
}

/* ASSERT THE LENGTH. The failure this guards is silent by construction: a reel
   that runs long still plays, and the drift only shows up as a voiceover sliding
   out of sync with the cards somewhere around beat nine. */
const probe = spawnSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", mp4,
], { encoding: "utf8" });
const got = parseFloat((probe.stdout || "").trim());
/* TOLERANCE IS FRAME-AWARE, and a flat number was wrong. A beat whose length is
   not a whole number of frames is rounded up to the next one, so the error is
   bounded by the BEAT COUNT over the frame rate -- 13 beats at 30fps is up to
   0.43s, and a flat 0.15s failed a cut that was correct. Widening it to a round
   number would have been the wrong fix twice over: it hides the bound instead of
   stating it, and it would need widening again at the next beat. The failure this
   exists for was 3.97s, which this still catches by an order of magnitude. */
const tol = (reel.beats.length + 1) / 30;
if (!(Math.abs(got - total) <= tol)) {
  console.error(
    `Duration is ${got}s; the script says ${total}s (tolerance ${tol.toFixed(2)}s, ` +
    `${reel.beats.length} beats at 30fps). Refusing to ship a drifting cut.`);
  process.exit(1);
}

console.log(`  ${mp4}`);
console.log(`  cover: ${pngs[reel.cover - 1]}`);
console.log(`\n${reel.beats.length} frames, ${total.toFixed(2)}s, ${W}x${H} — ${reel.title}`);
