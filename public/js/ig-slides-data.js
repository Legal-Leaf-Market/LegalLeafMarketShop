/* public/js/ig-slides-data.js -- the carousel copy and the deck's styling, in ONE
 * place, read by BOTH the command-line renderer and the studio page.
 *
 *   tools/make-ig-slides.mjs   imports it and renders PNGs via headless Chromium
 *   public/ig-studio.html      imports it in the browser to edit and export the same slides
 *
 * WHY THIS FILE EXISTS AT ALL. The copy started inside the CLI tool. Adding a page
 * that renders the same slides would have meant a second copy of the same strings
 * and the same CSS -- and this repo already knows how that ends: storeCheckoutUrl()
 * exists four times over, rscRoots()/balancedEnd() twice, public/js/overrides.js
 * carries a hand port of the engine's _applyOv, and every one of those pairs has
 * drifted at least once, silently, with the wrong half being the one that mattered
 * (CLAUDE.md sections 6 and 7). A deck whose page and whose exporter disagree about
 * a vote count is that same bug in a nicer coat.
 *
 * Plain ESM, no build step, which is what lets both sides read it: node imports it
 * directly and the browser takes it through <script type="module">. Nothing here
 * touches the DOM or the filesystem -- keep it that way, since each side has only
 * one of those.
 *
 * THE SHAPE IS DELIBERATELY DUMB because editing the copy is the point:
 * POSTS[key] is {title, slides:[{eyebrow, body}]} and body is an HTML fragment.
 * No template language and no field schema -- the studio edits these fragments as
 * text and the renderer drops them into the same markup, so what you type is
 * exactly what both sides draw.
 *
 * ENTITIES, NOT LITERAL CHARACTERS, above ASCII. This file is read by two
 * toolchains and re-encoded by neither, and the pack's own history has a commit
 * that mangled every non-ASCII byte in index.html and merged, because mojibake
 * still looks like text in a diff (CLAUDE.md section 5a). The dashes are also not
 * interchangeable: a vote count is a range and takes an en dash (90&#8211;6); a
 * compound modifier takes a hyphen (Senate-passed, R-NC).
 */

export const W = 1080, H = 1350;   // 4:5, the largest frame Instagram serves in-feed

/* Palette is READ OFF public/index.html rather than restated by eye: bg #0b120d,
   text #eaf3ec, leaf #4ade80, gold #f0b93c, amber #e8a33d, red #ef5350,
   muted #9fb6a6, dim #7d9488, line #223029. Keep them in step if the site moves. */
export const CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${W}px;height:${H}px}
body{
  background:#0b120d;color:#eaf3ec;
  font-family:"Liberation Sans","DejaVu Sans",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;overflow:hidden;
}
/* COLOUR AND FONT LIVE ON .slide, NOT ONLY ON body, and that is load bearing.
   The CLI writes a whole document so body{} applies; the studio's PNG export
   serialises THIS ELEMENT into an SVG foreignObject, where there is no <body> for
   that rule to match. Everything with an explicit colour rendered correctly and
   every h1 -- which inherited -- came out BLACK ON BLACK, with the whole slide in
   the default serif because the font stack was on body too. Three slides of a
   seven-slide post shipped unreadable and the suite passed, because it checked the
   PNG's dimensions and byte count and never looked at a pixel. Anything the export
   needs has to be reachable from .slide down. */
.slide{
  color:#eaf3ec;
  font-family:"Liberation Sans","DejaVu Sans",Arial,sans-serif;
  position:relative;width:${W}px;height:${H}px;padding:88px;
  display:flex;flex-direction:column;
  background:radial-gradient(120% 80% at 50% 0%, #121e16 0%, #0b120d 62%),#0b120d;
}
.slide::after{content:"";position:absolute;inset:40px;border:1px solid #223029;border-radius:10px}
.eyebrow{
  font-size:23px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;
  color:#4ade80;display:flex;align-items:center;gap:16px;flex:none;
}
.eyebrow::after{content:"";height:1px;flex:1;background:#223029}
.body-area{flex:1;display:flex;flex-direction:column;justify-content:center;gap:34px}
.foot{
  flex:none;display:flex;align-items:center;justify-content:space-between;
  font-size:24px;color:#7d9488;letter-spacing:.04em;
}
.foot .handle{color:#9fb6a6;font-weight:700}
.dots{display:flex;gap:9px}
.dot{width:9px;height:9px;border-radius:50%;background:#223029}
.dot.on{background:#4ade80}

h1{font-size:96px;line-height:1.02;letter-spacing:-.028em;font-weight:700}
h1.sm{font-size:78px}
h1.xs{font-size:66px}
.struck{
  font-size:66px;line-height:1.08;letter-spacing:-.02em;font-weight:700;color:#6d7f74;
  text-decoration:line-through;text-decoration-color:#ef5350;text-decoration-thickness:7px;
}
.numeral{font-size:250px;line-height:.86;font-weight:700;letter-spacing:-.045em;color:#f0b93c}
.numeral.leaf{color:#4ade80}
.numeral.red{color:#ef5350}
.numeral.sm{font-size:190px}
.label{font-size:30px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#9fb6a6}
p{font-size:37px;line-height:1.46;color:#9fb6a6;max-width:830px}
p b{color:#eaf3ec;font-weight:700}
p .leaf{color:#4ade80;font-weight:700}
p .red{color:#ef5350;font-weight:700}
.sub{font-size:40px;line-height:1.35;color:#9fb6a6;font-style:italic}
.rule{height:3px;width:120px;background:#4ade80;flex:none}
.kicker{font-size:34px;font-weight:700;letter-spacing:.03em;color:#e8a33d}
.stack{display:flex;flex-direction:column;gap:18px}
.stack .item{font-size:52px;font-weight:700;letter-spacing:-.01em;color:#eaf3ec}
.stack .item span{color:#7d9488;font-weight:400}

/* --- the comparison bars (post 2, slide 4) -------------------------------
   One measure (mg of THC) at two magnitudes, so this is NOT a categorical
   palette: the gold is the proposed dose and the red flags the ban as a state.
   Both bars are direct-labeled, so identity never rests on colour alone --
   which is also what makes the red/gold pair legal here (validated: deutan
   dE 16.5, normal-vision 23.5, both over the 8/15 floors). */
.bars{display:flex;flex-direction:column;gap:46px;margin:6px 0}
.barrow{display:flex;flex-direction:column;gap:14px}
.barcap{font-size:27px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7d9488}
.barline{display:flex;align-items:center;gap:22px}
/* 700px is the full 5 mg; the ban is 0.4/5 of it = 56px, computed not eyeballed.
   The track has to leave room for the value label on ONE line -- content width is
   904px and an unconstrained 800px bar wrapped "5 mg" onto two lines. */
.fill{height:62px;border-radius:4px}
.fill.big{width:700px;background:#f0b93c}
.fill.tiny{width:56px;background:#ef5350}
.barval{font-size:46px;font-weight:700;letter-spacing:-.02em;white-space:nowrap}
.barval.gold{color:#f0b93c}
.barval.red{color:#ef5350}
.note{font-size:27px;color:#7d9488;font-style:italic}

/* --- lists (posts 4 and 5) -----------------------------------------------
   Two shapes on purpose. A BULLET list is a set -- the order carries nothing, so
   the marker is a neutral dash. A STEP list is a sequence someone is meant to
   act on in order, so the number is the marker and it is set in the accent. Using
   one for the other reads as a formatting slip and quietly changes what the slide
   is asking for. Both keep body text muted with <b> in full white, the same
   hierarchy the paragraphs use, so a five-item slide does not shout louder than
   the headline above it. */
/* UA-COLOURED ELEMENTS ARE FORCED BACK TO THE DECK'S INK. The reset at the top of
   this file zeroes margin and padding but never COLOUR, so any element the browser
   ships with a colour of its own keeps it: <a> renders link-blue, <mark> black on
   yellow, and button/input black on white. Hand-written slides never used those, so
   it stayed invisible -- but drafts are written as HTML by a model, and a model
   reaches for <a> to carry a source and <mark> to emphasise. Reported as "some of
   the text showed up black and therefore unreadable".

   mark is given a real highlight in the deck's own colours rather than being
   flattened, because it MEANS highlighted and a reader should still see that. */
.slide a, .slide button, .slide input, .slide select, .slide textarea,
.slide code, .slide kbd, .slide samp, .slide cite, .slide q {
  color:inherit; background:transparent; border:0; font:inherit;
}
.slide a{text-decoration:none}
.slide mark{color:#0b120d;background:#f0b93c;padding:0 .12em;border-radius:4px}
.bullets{display:flex;flex-direction:column;gap:20px}
.bullets div{font-size:40px;line-height:1.28;color:#9fb6a6;padding-left:36px;position:relative}
.bullets div::before{content:"";position:absolute;left:0;top:.6em;width:16px;height:3px;background:#4ade80}
.bullets b{color:#eaf3ec;font-weight:700}
.steps{display:flex;flex-direction:column;gap:24px}
.steps div{font-size:38px;line-height:1.28;color:#9fb6a6;padding-left:64px;position:relative}
.steps div span{position:absolute;left:0;top:-3px;font-size:42px;font-weight:700;color:#4ade80}
.steps b{color:#eaf3ec;font-weight:700}

/* --- pull quotes and name lists (post 3) ---------------------------------
   The coalition post's whole job is that the names are not who you expect, so
   the names ARE the graphic. Gillibrand is tinted because one Democrat among
   three Republican cosponsors is the fact being reported; the tint is backed by
   the party tag beside it rather than carrying the point alone. */
.quote{
  font-size:58px;line-height:1.22;letter-spacing:-.02em;font-weight:700;color:#eaf3ec;
  border-left:5px solid #4ade80;padding-left:34px;
}
.quote.sm{font-size:46px}
.attrib{font-size:30px;color:#9fb6a6;padding-left:39px}
.attrib b{color:#eaf3ec}
.names{display:flex;flex-direction:column;gap:14px}
.names .n{font-size:56px;font-weight:700;letter-spacing:-.015em;color:#eaf3ec}
.names .n .tag{font-size:28px;font-weight:400;color:#7d9488;letter-spacing:.06em}
.names .n.d{color:#4ade80}
`;

export const POSTS = {
  post1: {
    title: "It's Not Law Yet (The Correction)",
    slides: [
      { eyebrow: "Federal hemp ban &#183; status", body: `
        <div class="struck">THE HEMP BAN<br>WAS DELAYED.</div>
        <h1>THE SENATE <span style="color:#4ade80">VOTED</span><br>TO DELAY IT.</h1>
        <div class="sub">Those are not the same sentence.</div>` },
      { eyebrow: "August 8, 2026", body: `
        <div class="numeral">90&#8211;6</div>
        <div class="label">Senate passes the continuing resolution</div>
        <p>It funds the government through December 11 &#8212; and moves the hemp ban&#8217;s
        effective date to <b>December 11, 2026</b>.</p>` },
      { eyebrow: "The amendment fight", body: `
        <p style="margin-bottom:-6px">Sen. <b>Ted Budd (R-NC)</b> filed <b>S.Amdt. 6733</b>
        to strip the delay and hold November 12.</p>
        <div class="numeral sm leaf">61&#8211;32</div>
        <div class="label">Motion to table &#8212; carried</div>
        <p>The amendment is <span class="red">dead</span>. Killed procedurally,
        not voted down on the merits.</p>` },
      { eyebrow: "Here&#8217;s the part getting lost", body: `
        <h1 class="sm">THE BILL IS<br><span style="color:#e8a33d">SENATE-PASSED</span><br>ONLY.</h1>
        <div class="rule"></div>
        <p>The House hasn&#8217;t voted. The House is in recess until <b>August 31</b>.</p>` },
      { eyebrow: "If the House does not act", body: `
        <div class="kicker">NOVEMBER 12, 2026</div>
        <h1>IS STILL<br>THE LAW.</h1>
        <p>Every date past that is a <b>proposal</b>, not a protection.
        Plan inventory, contracts and payment processing accordingly.</p>` },
      { eyebrow: "One piece does not move", body: `
        <h1 class="xs">BANNED EITHER WAY.</h1>
        <p>Synthetic cannabinoids &#8212; those <b>not capable of being naturally produced</b>
        by the plant &#8212; are banned <b>November 12</b>, delay or no delay.</p>
        <p style="font-size:32px;color:#7d9488">Related: the DEA has filed arguing HHC is a
        Schedule I controlled substance rather than lawful hemp.</p>` },
      { eyebrow: "Where this actually stands", body: `
        <h1 class="sm">NOTHING HAS<br>BEEN SAVED YET.</h1>
        <div class="rule"></div>
        <h1 class="xs" style="color:#4ade80">WE BOUGHT A VOTE.<br>NOT A DATE.</h1>
        <p style="font-size:33px">Tell your House member to cosponsor <b>H.R. 9830</b>
        &#8212; <span class="leaf">hempsupporter.com</span></p>` },
    ],
  },

  post2: {
    title: "0.4 Milligrams (What the Ban Actually Does)",
    slides: [
      { eyebrow: "The number the ban turns on", body: `
        <div class="numeral red">0.4 mg</div>
        <div class="sub">Per container. Not per serving.<br>Per container.</div>` },
      { eyebrow: "The baseline &#183; 2018", body: `
        <h1 class="sm">0.3% DELTA-9<br>BY DRY WEIGHT.</h1>
        <p>That is how the <b>2018 Farm Bill</b> defined hemp &#8212; and that one
        definition built the entire industry.</p>` },
      { eyebrow: "The rewrite &#183; late 2025", body: `
        <p style="margin-bottom:-6px">A spending bill redefined it. Only products with</p>
        <div class="numeral sm red">0.4 mg</div>
        <div class="label">of total THC per container stay legal</div>
        <p>Not a limit on a serving. A limit on <b>the whole package</b>.</p>` },
      { eyebrow: "For scale", body: `
        <div class="bars">
          <div class="barrow">
            <div class="barcap">Per serving &#8212; the bipartisan bill&#8217;s cap</div>
            <div class="barline"><div class="fill big"></div><div class="barval gold">5 mg</div></div>
          </div>
          <div class="barrow">
            <div class="barcap">Per container &#8212; the ban</div>
            <div class="barline"><div class="fill tiny"></div><div class="barval red">0.4 mg</div></div>
          </div>
        </div>
        <div class="note">Drawn to true proportion.</div>
        <p style="font-size:33px">5 mg is the dose lawmakers themselves landed on as
        reasonable. The ban allows <b>0.4 mg in the entire package</b>.</p>` },
      { eyebrow: "What it reaches", body: `
        <div class="stack">
          <div class="item">Gummies</div>
          <div class="item">Beverages</div>
          <div class="item">Vapes</div>
          <div class="item">Tinctures</div>
        </div>
        <p>There is no product you can build inside that limit.
        Effectively <b>the whole category</b>.</p>` },
      { eyebrow: "What is attached to it", body: `
        <div class="numeral">$28B</div>
        <div class="label">Reported size of the affected sector</div>
        <p>Farms. Processors. Retailers. Distributors. <b>Payroll.</b></p>` },
      { eyebrow: "Call it what it is", body: `
        <h1 class="xs">THIS ISN&#8217;T A<br>SAFETY LIMIT.</h1>
        <div class="rule"></div>
        <h1 class="xs" style="color:#4ade80">IT&#8217;S A DEFINITION<br>THAT DELETES<br>A CATEGORY.</h1>
        <p style="font-size:31px">Send this to anyone who thinks it&#8217;s regulation.</p>` },
    ],
  },

  /* Post 3 quotes two people and paraphrases a third, and the difference is
     drawn in the layout on purpose. Budd's line is verbatim, so it gets the
     pull-quote treatment. Rand Paul's is reported speech in which only the
     words "some of" are his -- rendering that as a pull quote would put a
     sentence in his mouth, and the hedge is the whole reason the pack flags it
     (HEMP_LAW_IG_CONTENT.md, "Before You Post" item 5). It stays body copy with
     the two quoted words marked. */
  post3: {
    title: "Not Left vs. Right (The Coalition)",
    slides: [
      { eyebrow: "The vote nobody predicted", body: `
        <h1 class="sm">THUNE AND SCHUMER<br>VOTED
        <span style="color:#4ade80">THE SAME WAY.</span></h1>
        <div class="sub">Reset whatever you assumed about this fight.</div>` },
      { eyebrow: "What the tally showed", body: `
        <h1 class="sm">IT SPLIT THE<br>USUAL COALITIONS.</h1>
        <div class="rule"></div>
        <p>The <b>Majority Leader</b> and the <b>Minority Leader</b> both voted to table
        the amendment that would have sped the ban up.</p>` },
      { eyebrow: "Cosponsors of S.Amdt. 6733", body: `
        <div class="names">
          <div class="n">McConnell <span class="tag">R-KY</span></div>
          <div class="n">Cornyn <span class="tag">R-TX</span></div>
          <div class="n">Grassley <span class="tag">R-IA</span></div>
          <div class="n d">Gillibrand <span class="tag">D-NY</span></div>
        </div>
        <p>Nobody&#8217;s whip is counting this one.</p>` },
      { eyebrow: "Who objects, and why", body: `
        <h1 class="xs">BECAUSE IT COMPETES.</h1>
        <p>Sen. <b>Rand Paul (R-KY)</b> named the objectors: the cannabis industry,
        and <b>&#8220;some of&#8221;</b> the alcohol industry.</p>
        <p style="font-size:32px;color:#7d9488">Alcohol <b style="color:#9fb6a6">retailers and
        wholesalers</b> went the other way &#8212; they are backing federal regulation.</p>` },
      { eyebrow: "On the President&#8217;s position", body: `
        <div class="quote">&#8220;I think he&#8217;s been<br>misinformed<br>by his staff.&#8221;</div>
        <div class="attrib">&#8212; Sen. <b>Ted Budd (R-NC)</b>, who filed the amendment</div>` },
      { eyebrow: "And from the administration", body: `
        <div class="numeral sm">$500</div>
        <div class="label">A year of hemp products, covered</div>
        <p>CMS Administrator <b>Dr. Mehmet Oz</b> wrote to senators asking them to
        <b>oppose</b> Budd&#8217;s amendment, citing a plan to cover hemp products
        through CMS innovation models.</p>` },
      { eyebrow: "What that means for you", body: `
        <h1 class="sm">THERE IS NO<br>PARTY LINE HERE.</h1>
        <div class="rule"></div>
        <h1 class="xs" style="color:#4ade80">WHICH MEANS YOUR<br>REP IS PERSUADABLE.</h1>
        <p style="font-size:31px">They&#8217;re back <b>August 31</b>.</p>` },
    ],
  },

  post4: {
    title: "There's a Real Alternative (The Bills)",
    slides: [
      { eyebrow: "The case nobody hears", body: `
        <h1 class="sm">NOBODY IS ASKING<br>FOR NO RULES.</h1>
        <div class="sub">Two bipartisan bills would regulate hemp THC<br>instead of banning it.</div>` },
      { eyebrow: "Bill one &#183; introduced Aug 10, 2026", body: `
        <h1 class="xs">BEVERAGE<br>REGULATORY<br>PARITY ACT</h1>
        <div class="rule"></div>
        <p>Reps. <b>Beth Van Duyne (R-TX)</b><br>and <b>Greg Landsman (D-OH)</b></p>` },
      { eyebrow: "What&#8217;s in it", body: `
        <div class="bullets">
          <div><b>21+</b> only</div>
          <div><b>5 mg</b> total intoxicating THC per serving</div>
          <div><b>8&#162;/mg</b> federal excise tax</div>
          <div>Testing, packaging, labeling and serving-size standards</div>
          <div>Federal permits to manufacture, wholesale or sell</div>
        </div>` },
      { eyebrow: "And also", body: `
        <div class="bullets">
          <div>U.S.-cultivated, <b>naturally occurring</b> cannabinoids only</div>
          <div><b>750 mL</b> cap on multi-serve containers</div>
          <div>States, tribes and localities can go <b>stricter</b> &#8212; but cannot block interstate transport</div>
        </div>
        <p style="font-size:31px">Oversight split across TTB, HHS and USDA.</p>` },
      { eyebrow: "Bill two &#183; introduced Jul 22, 2026", body: `
        <h1 class="xs">LAWFUL HEMP<br>PROTECTION ACT</h1>
        <div class="kicker">H.R. 9830</div>
        <p>Reps. <b>Andy Barr (R-KY)</b> and <b>Angie Craig (D-MN)</b>, co-led by
        <b>Tim Moore (R-NC)</b> and <b>Marc Veasey (D-TX)</b>.</p>` },
      { eyebrow: "Read that list again", body: `
        <h1 class="xs">AGE LIMITS. DOSE CAPS.<br>LAB TESTING. TAXES.<br>FEDERAL PERMITS.</h1>
        <div class="rule"></div>
        <p>That&#8217;s an industry <b>growing up</b> &#8212;<br>not one getting deleted.</p>` },
      { eyebrow: "The entire ask", body: `
        <h1 class="sm">ASK YOUR REP<br>TO COSPONSOR<br><span style="color:#4ade80">H.R. 9830.</span></h1>
        <p style="font-size:31px">One word: <b>cosponsor</b>. Most offices hear almost
        nothing on this &#8212; which is exactly why one call registers.</p>` },
    ],
  },

  post5: {
    title: "October 15 (The Close)",
    slides: [
      { eyebrow: "The deadline nobody is posting about", body: `
        <h1>OCTOBER 15.</h1>
        <div class="sub">It lands a month before the law does.</div>` },
      { eyebrow: "The commercial clock", body: `
        <h1 class="xs">SQUARE TOLD SELLERS<br>TO CLEAR THEIR<br>CATALOGS.</h1>
        <p>Remove CBD and hemp products by <b>October 15, 2026</b> &#8212; ahead of
        the November 12 federal law.</p>` },
      { eyebrow: "And they were not first", body: `
        <div class="kicker">DECEMBER 2025</div>
        <h1 class="xs">CURALEAF ALREADY<br>EXITED HEMP THC.</h1>
        <p>Processors and operators are pricing in the ban
        <b>while Congress is on break</b>.</p>` },
      { eyebrow: "The part a delay does not fix", body: `
        <h1 class="xs">UNCERTAINTY DOES<br>PROHIBITION&#8217;S WORK<br>FOR FREE.</h1>
        <div class="rule"></div>
        <p>Processors won&#8217;t underwrite a category with a question mark on it.
        Distributors won&#8217;t commit. The damage isn&#8217;t waiting for a date.</p>` },
      { eyebrow: "Which is why the bills matter", body: `
        <h1 class="sm">A PATCH EXTENDS<br>THE UNCERTAINTY.</h1>
        <h1 class="sm" style="color:#4ade80">A FRAMEWORK ENDS IT.</h1>
        <p style="font-size:33px">The House returns <b>August 31</b>.
        November 12 is still the operative law.</p>` },
      { eyebrow: "Three things, under five minutes", body: `
        <div class="steps">
          <div><span>1</span> Call your House member &#8212; ask them to cosponsor <b>H.R. 9830</b></div>
          <div><span>2</span> Ask them to keep hemp protections in the funding bill</div>
          <div><span>3</span> Send this to one person whose income runs through this category</div>
        </div>` },
      { eyebrow: "Where that Senate vote came from", body: `
        <h1 class="sm">THAT SENATE VOTE<br>WASN&#8217;T LUCK.</h1>
        <div class="rule"></div>
        <h1 class="xs" style="color:#4ade80">SOMEBODY CALLED.</h1>
        <p style="font-size:31px"><span class="leaf">hempsupporter.com</span>
        &#8212; scripts and district lookup</p>` },
    ],
  },

  /* Post 6 is the OPERATOR's post, not the shopper's. Posts 1-5 argue that the ban
     is wrong; this one hands somebody deciding whether to comply the arithmetic and
     declines to answer for them. That is why slide 7 asks a question and stops.

     TWO CLAIMS HERE GO BEYOND WHAT HEMP_LAW_IG_CONTENT.md VERIFIED, and they are
     flagged rather than quietly promoted: the three-tier / no-vertical-integration
     structure, and "Referred to Committee". The pack's fact sheet confirms 21+,
     5 mg, 8&#162;/mg, the 750 mL cap, U.S.-cultivated naturally occurring
     cannabinoids and TTB/HHS/USDA oversight -- not those two. Re-check them before
     this posts, and note a committee status is the kind of fact that ages in days.

     The 40-cent figure is arithmetic on a stated rate (5 x 8&#162;), not a claim. */
  post6: {
    title: "The Survival Path (What the Bill Would Cost)",
    slides: [
      { eyebrow: "There is a version where this survives", body: `
        <h1 class="sm">THERE&#8217;S A LEGAL PATH<br>FOR HEMP DRINKS.</h1>
        <div class="sub">It looks like alcohol.</div>` },
      { eyebrow: "The bill &#183; introduced Aug 10, 2026", body: `
        <h1 class="xs">BEVERAGE<br>REGULATORY<br>PARITY ACT</h1>
        <div class="rule"></div>
        <p>Reps. <b>Beth Van Duyne (R-TX)</b> and <b>Greg Landsman (D-OH)</b>.
        Referred to committee.</p>` },
      { eyebrow: "Serving limits", body: `
        <div class="kicker">PER-SERVING CAP</div>
        <div class="numeral sm">5 mg</div>
        <div class="label">Total intoxicating THC</div>
        <p>The maximum per serving in any compliant hemp beverage.
        Age limit: <b>21 and over</b>.</p>` },
      { eyebrow: "Distribution", body: `
        <h1 class="xs">THREE-TIER SYSTEM</h1>
        <div class="bullets">
          <div>Manufacturer &#8594; wholesaler</div>
          <div>Wholesaler &#8594; retailer</div>
          <div><b>No vertical integration</b></div>
          <div>Overseen by the <b>TTB</b></div>
        </div>
        <p style="font-size:31px">The same framework that governs beer, wine and spirits.</p>` },
      { eyebrow: "Federal tax", body: `
        <div class="kicker">EXCISE TAX</div>
        <div class="numeral sm">8&#162;</div>
        <div class="label">Per milligram of THC</div>
        <p>Collected at the manufacturer, like alcohol excise.
        On a 5 mg can: <b>about 40 cents</b>.</p>` },
      { eyebrow: "What&#8217;s banned", body: `
        <h1 class="xs">SYNTHETICS OUT.</h1>
        <p>Only <b>naturally occurring compounds</b> from U.S.-grown hemp qualify.</p>
        <div class="rule"></div>
        <p style="font-size:32px">And it covers drinks only. Flower, edibles and vapes get
        <b>no carve-out</b> &#8212; November 12 still stands for them.</p>` },
      { eyebrow: "The decision", body: `
        <h1 class="sm">DOES THE MATH<br>WORK FOR YOU?</h1>
        <p>TTB permits, excise cost, three-tier margins and fifty sets of state rules
        &#8212; against a deadline in November.</p>
        <p style="font-size:31px">It&#8217;s in committee now. That&#8217;s when they&#8217;re
        still listening &#8212; <b>tell them either way</b>.</p>` },
    ],
  },
};
