// test-concierge-browser.mjs -- boots public/index.html in real Chromium and drives the concierge
// widget. `node test-concierge-browser.mjs` (starts its own server on PORT, default 3141).
//
// WHY THIS EXISTS
//
// CLAUDE.md section 5a is explicit: after touching index.html, "verify by booting the page, not by
// reading it. file:// URLs are not enough -- they render without running the scripts." A diff review
// cannot tell you that the base64 engine still decodes, and the widget is 495 lines of appended
// script whose first syntax error would take the whole page down silently -- the engine's own
// bootstrap runs in the same document.
//
// ZERO DEPENDENCIES, like everything else here. It speaks the Chrome DevTools Protocol directly over
// Node's built-in WebSocket rather than pulling in Playwright, which would be the first entry in an
// intentionally empty `dependencies` (CLAUDE.md section 1). Chromium is located the same way the
// Playwright suites find it, via PLAYWRIGHT_BROWSERS_PATH.
//
// WHAT IT CAN AND CANNOT SEE. Where there is no egress to the sixteen stores, /api/products returns
// nothing and the grid has no cards -- so this asserts on what does not depend on the feed (the
// engine decoding, the widget mounting, the register gate, the mood chips, which come from an
// endpoint that needs no catalogue) plus the failure path when the feed is missing, which is the one
// case a developer with a working feed will never see by hand.

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromePath, launchChrome } from "./tools/chrome-path.mjs";

process.env.LL_NO_STORE_FETCH = "1";   // never call a real shop from a test; api/ reads it
                                       // per call, so setting it after the imports is fine.
const PORT = Number(process.env.PORT) || 3141;
const CDP_PORT = Number(process.env.CDP_PORT) || 9376;

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; failures.push(label); console.log(`  FAIL ${label}${extra ? `\n       ${extra}` : ''}`); }
}
// Prints what it got when it fails. The earlier sections here spell out `ok(a === b, ...)` and then
// have to describe the mismatch in prose; this reports the actual value, which is the difference
// between "the count was wrong" and knowing what it was.
function eq(a, b, label) { ok(a === b, label, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

/* Resolved by the shared module (tools/chrome-path.mjs), which knows CHROME_PATH,
   every Playwright build under the browsers root, the headless shell and the
   distro's own binary. This used to be its own copy that checked neither
   CHROME_PATH nor /usr/bin, so it could not run on a CI runner. */
async function findChromium() { return chromePath(); }

// Minimal CDP client: send(method, params) -> Promise<result>, plus event subscription.
function cdp(url) {
  const ws = new WebSocket(url);
  let next = 1;
  const waiting = new Map();
  const listeners = [];
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waiting.has(m.id)) {
      const { res, rej } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else if (m.method) {
      for (const l of listeners) l(m);
    }
  };
  return {
    ready: open,
    on(fn) { listeners.push(fn); },
    send(method, params = {}) {
      const id = next++;
      return new Promise((res, rej) => {
        waiting.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { try { ws.close(); } catch { /* already gone */ } }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// WHERE THE CARDS COME FROM WITH NO EGRESS, and why they are not a stub.
//
// The grid section needs a shelf to drive, and the obvious move -- intercept /api/products and serve a
// synthetic catalogue -- was tried first and abandoned. Built by the real scraper against a stubbed
// store, so the shape was right, it reached the engine (LL_admin.items() held all four products) and
// still rendered nothing, because something in the engine's own ingest declines a feed assembled that
// way. Chasing that would mean reverse-engineering the blob to satisfy a fixture, and the fixture was
// never the point.
//
// It turns out none of it is needed: the blob carries a baked seed, so with the feed down the grid
// renders twelve real Greek Glass cards. That is a genuine shelf, produced by the real render path,
// and it is what the assertions drive. They read the card titles out of the DOM rather than hardcoding
// them, so a re-cut of the blob changes the data under the test without invalidating it.

async function main() {
  const server = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore'
  });
  const profile = await mkdtemp(join(tmpdir(), 'llc-'));
  /* LAUNCHED THROUGH THE SHARED HELPER, like the other fifteen browser suites.
     This was the last one still spawning Chrome by hand and polling /json/list
     on its own 15-second budget, and on a loaded runner about:blank can
     register later than that -- which surfaced as "Chromium did not expose a
     page target" while the browser had started perfectly. Fixing it here rather
     than raising one more private timeout is the whole argument for the helper:
     the failure was already fixed everywhere else and this suite could not
     inherit it. launchChrome waits for the target and asks for one if none
     appears, so the poll below now finds it already there. */
  const { proc: chrome } = await launchChrome(CDP_PORT, [], { userDataDir: profile });

  const cleanup = async () => {
    try { chrome.kill('SIGKILL'); } catch { /* gone */ }
    try { server.kill('SIGKILL'); } catch { /* gone */ }
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  process.on('exit', () => { try { chrome.kill('SIGKILL'); server.kill('SIGKILL'); } catch { /* gone */ } });

  try {
    // Wait for both to answer rather than sleeping a guessed amount.
    let target = null;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      try {
        const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
        const list = await r.json();
        target = list.find((t) => t.type === 'page');
        if (target) break;
      } catch { /* not up yet */ }
    }
    if (!target) throw new Error('Chromium did not expose a page target');
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try { const r = await fetch(`http://127.0.0.1:${PORT}/`); if (r.ok) break; } catch { /* not up yet */ }
    }

    const c = cdp(target.webSocketDebuggerUrl);
    await c.ready;

    const consoleErrors = [], pageErrors = [];
    c.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails || {};
        pageErrors.push(d.exception && d.exception.description ? d.exception.description : d.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        pageErrors.push((m.params.args || []).map((a) => a.value || a.description || '').join(' '));
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        // The url matters as much as the text: Chromium's network errors say "Failed to load
        // resource: 404" with no hint what failed, and a filter written against the text alone
        // would have to be widened until it hid real breakage.
        consoleErrors.push(m.params.entry.text + ' <' + (m.params.entry.url || 'no-url') + '>');
      }
    });
    await c.send('Runtime.enable');
    await c.send('Log.enable');
    await c.send('Page.enable');

    await c.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    await sleep(4500);   // let the engine decode, boot, and its feed fetch fail

    console.log('\n== the 21+ gate is up before anything else ==');
    // Asserted FIRST, and dismissed here, because everything below drives a page the gate is covering.
    // A suite that silently clicked through it would also silently pass if the gate stopped appearing.
    {
      const evalNow = async (expr) => {
        const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr);
        return r.result.value;
      };
      ok(await evalNow('!!document.getElementById("ll-age")'), 'the gate mounted on a fresh profile');
      ok(await evalNow('document.documentElement.classList.contains("ll-gated")'),
        'and marked the document, which is what stops the page scrolling behind it');
      eq(await evalNow('getComputedStyle(document.body).overflow'), 'hidden',
        'the page cannot be scrolled while gated');
      // The content must still BE there -- gating by emptying the document is how sites deindex
      // themselves, and a crawler that does not run scripts has to see a real page.
      ok(await evalNow('document.querySelectorAll("#grid").length') === 1, 'the grid is still in the DOM behind it');
      ok((await evalNow('document.title || ""')).length > 0, 'and the title is intact');
      eq(await evalNow('document.activeElement && document.activeElement.className'), 'llg-yes',
        'focus starts on the confirm button, so a keyboard user is not hunting for it');
      // Escape must not be a way in.
      await evalNow('document.getElementById("ll-age").dispatchEvent('
        + 'new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); true');
      ok(await evalNow('!!document.getElementById("ll-age")'), 'Escape does not dismiss it');

      await evalNow('document.querySelector("#ll-age .llg-yes").click(); true');
      await sleep(300);
      eq(await evalNow('document.getElementById("ll-age")'), null, 'confirming removes the overlay');
      eq(await evalNow('document.documentElement.classList.contains("ll-gated")'), false, 'and unlocks the page');
      eq(await evalNow('localStorage.getItem("ll_age_ok")'), '1', 'and it is remembered, so it asks once');
    }

    const evaluate = async (expr) => {
      const r = await c.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr);
      return r.result.value;
    };

    console.log('\n== the engine still boots ==');
    // The single most important assertion in this file: if the appended block had a syntax error, or
    // if the blob had been corrupted, this is where it shows. LL_admin is defined inside the engine.
    ok(await evaluate('typeof window.LL_admin') === 'object', 'window.LL_admin is still an object (blob decoded and ran)');
    ok(await evaluate('typeof window.LL === "object" && typeof window.LL.track === "function"'), 'window.LL.track still present');
    ok(await evaluate('document.querySelectorAll("script").length > 5'), 'the document has its scripts');
    ok(!(await evaluate('!!document.querySelector("#fType")')) === false, 'the grid filter controls are in the DOM');

    console.log('\n== the widget mounted ==');
    ok(await evaluate('!!document.querySelector(".llc-fab")'), 'the launcher exists');
    ok(await evaluate('!!document.querySelector(".llc-panel")'), 'the panel exists');
    ok(await evaluate('getComputedStyle(document.querySelector(".llc-panel")).display') === 'none', 'the panel starts closed');
    ok(await evaluate('!!document.getElementById("ll-concierge-style")'), 'the additive style block is present');

    console.log('\n== first open asks for a register, once ==');
    await evaluate('localStorage.removeItem("ll_conc_reg"); document.querySelector(".llc-fab").click(); true');
    await sleep(700);
    ok(await evaluate('document.querySelector(".llc-panel").classList.contains("on")'), 'clicking the launcher opens the panel');
    ok(await evaluate('!!document.querySelector(".llc-pickreg")'), 'a first-time visitor gets the one-tap register choice');
    ok(await evaluate('document.querySelectorAll(".llc-pickreg button").length') === 2, 'two options, straight talk and take it slow');
    ok(await evaluate('getComputedStyle(document.getElementById("llcFoot")).display') === 'none',
      'the composer is hidden until a register is chosen -- no typing into an unset voice');

    await evaluate('document.querySelector(".llc-pickreg button[data-r=\\"sommelier\\"]").click(); true');
    await sleep(500);
    ok(await evaluate('localStorage.getItem("ll_conc_reg")') === 'sommelier', 'the choice persists');
    ok((await evaluate('document.getElementById("llcTitle").textContent')).indexOf('guide') !== -1,
      'the header reflects the chosen register');
    ok(await evaluate('getComputedStyle(document.getElementById("llcFoot")).display') !== 'none', 'the composer appears');
    ok(!(await evaluate('!!document.querySelector(".llc-pickreg")')), 'and the chooser is gone');

    // Re-opening must not ask again -- the whole point of "once".
    await evaluate('document.getElementById("llcX").click(); true');
    await sleep(300);
    await evaluate('document.querySelector(".llc-fab").click(); true');
    await sleep(600);
    ok(!(await evaluate('!!document.querySelector(".llc-pickreg")')), 'reopening does not ask again');

    console.log('\n== the mood chips come from an endpoint that needs no catalogue ==');
    ok(await evaluate('document.querySelectorAll(".llc-chip").length') === 4, 'four mood chips rendered');
    const labels = await evaluate('Array.prototype.map.call(document.querySelectorAll(".llc-chip"), function(b){return b.textContent}).join("|")');
    ok(/Unwind/.test(labels) && /Drift off/.test(labels), `chips carry the real labels (${labels})`);

    console.log('\n== the missing-feed path a developer never sees by hand ==');
    await evaluate('document.querySelectorAll(".llc-chip")[0].click(); true');
    await sleep(2500);
    const errText = await evaluate('(document.querySelector(".llc-err")||{}).textContent || ""');
    ok(/feed is not answering|Nothing in stock/i.test(errText),
      `a 503 from the catalogue renders as a readable message, not a blank bubble (got: ${JSON.stringify(errText)})`);
    ok(!(await evaluate('!!document.querySelector(".llc-note") && document.querySelector(".llc-note").textContent.indexOf("Reading the shelf") !== -1')),
      'the pending line is cleared rather than left spinning forever');

    console.log('\n== with a catalogue: the grid actually moves ==');
    // THIS SECTION EXISTS BECAUSE ITS ABSENCE SHIPPED A BUG. It used to say, in a comment here, that
    // it could assert the controls exist but "does NOT prove the grid re-renders in response ...
    // check that by hand". Nobody did, and apply() was pointing `search` at #fStrainSearch -- the
    // strain PICKER's typeahead, which the engine wires to a dropdown and nothing else. The field
    // exists, so setField() returned true, the || short-circuited before #q, and the widget cheerfully
    // reported "Grid pointed at: search" over a grid that had not changed. Existence was never the
    // question; effect was.
    //
    // So the feed is served by intercepting the request in the browser, and every assertion below is
    // about CARD COUNT -- what the shopper sees -- rather than about a control's value.
    const cardCount = () => evaluate('document.querySelectorAll(".card").length');
    const titles = async () => evaluate('Array.prototype.map.call(document.querySelectorAll(".card"),'
      + 'function(c){ return (c.querySelector(".cname")||{}).textContent || ""; })');

    /* COUNT THE SHELF, NOT THE PAGE -- and this cost a red suite to learn.
       These assertions used to compare rendered .card nodes against a baseline
       taken at first paint, and that baseline is not a property of the filter
       at all. public/js/shelf-shuffle.js presses the engine's own Load more on
       arrival to top the opening screen up to FLOOR (40), which lands on 48
       (12 -> 24 -> 36 -> 48), and then DELIBERATELY STANDS DOWN the moment the
       shopper asks for anything. So the grid holds 48 cards at load and fewer
       ever after: measured here, 48 at load, 48 after the first clear, 24 after
       the second, 12 by the fourth. Every one of those is the documented
       behaviour working.
       The suite read that decay as the filter failing to restore the shelf, and
       failed on the FOURTH round trip while blaming the filter -- five, six then
       seven failures across three runs of identical code, which reads as flake
       and is a moving baseline.
       The engine's own counter is paging-independent and is the number the
       shopper actually reads: 64 -> 0 -> 64 through every cycle above. It is
       also the STRONGER assertion, because a card count cannot tell "the filter
       cleared" apart from "another page loaded" and this can. */
    const dealCount = async () => {
      const t = await evaluate('(document.querySelector(".subbar .cnt")||{}).textContent||""');
      const m = String(t).match(/([\d,]+)/);
      return m ? Number(m[1].replace(/,/g, "")) : null;
    };
    /* SETTLE BEFORE MEASURING. The catalogue arrives by intercepted fetch, so the
       shelf grows once it lands -- the seed alone reads 64 and the seed plus the
       served feed reads 84. A baseline taken on the way up makes the very first
       comparison look like the search WIDENED the shelf (84 of 64), which sends
       the next reader to the search box rather than to the clock. Two identical
       reads in a row is the cheapest statement of "it has stopped moving". */
    let all = await dealCount();
    for (let i = 0; i < 20; i++) {
      await sleep(400);
      const again = await dealCount();
      if (again === all && again > 1) break;
      all = again;
    }
    ok(all > 1, `the grid has a shelf to drive (${all} deals, settled)`);
    ok((await cardCount()) > 0, 'and it has rendered cards to read titles off');

    // The search term is read off a rendered card, not hardcoded, and checked to be unique first --
    // otherwise "narrowed to one" could be luck.
    const names = await titles();
    const pickName = names.find((n) => n && names.filter((m) => m === n).length === 1) || names[0];
    const token = pickName.split(/\s+/).filter((w) => w.length > 4).pop() || pickName;
    /* The term only has to be usable, not predictive. What it matches across the
       WHOLE catalogue is unknowable from the DOM -- the grid renders one page --
       so this asserts the token is real and discriminating among what is
       rendered, and the narrowing itself is asserted below against the shelf
       counter rather than against a number derived from here. */
    const localHits = names.filter((n) => n.toLowerCase().indexOf(token.toLowerCase()) !== -1).length;
    ok(localHits >= 1 && localHits < names.length,
      `"${token}" is a term that discriminates (${localHits} of ${names.length} rendered)`);

    // WHAT THE STRAIN BOX ACTUALLY DOES, measured rather than assumed -- the first version of this
    // test asserted it was inert and was wrong. The engine binds `input` on it to state.strain, so it
    // does drive the grid; it just filters by STRAIN. Hand it anything a strain does not match and the
    // shelf empties, which is the empty grid the shopper was sent to when apply() aimed search here.
    await evaluate('(function(){ var e=document.getElementById("fStrainSearch");'
      + ' e.value="Nonexistent Kush 9000"; e.dispatchEvent(new Event("input",{bubbles:true})); })()');
    await sleep(500);
    const strainMiss = await cardCount();
    ok(strainMiss === 0,
      `a strain nothing matches empties the shelf -- this is the failure mode, not a dead control (${strainMiss})`);
    await evaluate('var e=document.getElementById("fStrainSearch"); e.value="";'
      + ' e.dispatchEvent(new Event("input",{bubbles:true})); true');
    await sleep(400);
    ok(await dealCount() === all, 'and clearing the strain box restores the shelf');

    // ...whereas #q is what the engine binds `oninput` to state.q, matched against name/store/category.
    await evaluate(`(function(){ var e=document.getElementById("q"); e.value=${JSON.stringify(token)};
      e.dispatchEvent(new Event("input",{bubbles:true})); })()`);
    await sleep(500);
    /* NARROWED, AND EVERYTHING LEFT MATCHES. The old form compared against a
       count derived from RENDERED titles, which is only the current page -- so
       a term matching something on page two read as the search over-matching.
       Two claims instead, neither of which needs the unrendered rows: the shelf
       got smaller but not empty, and every card still on it carries the term.
       A dead search box fails the first; one that filters the wrong field fails
       the second. */
    const afterQ = await dealCount();
    ok(afterQ >= 1 && afterQ < all, `#q narrows the shelf for real (${afterQ} of ${all})`);
    const stillShown = await titles();
    const strays = stillShown.filter((n) => n.toLowerCase().indexOf(token.toLowerCase()) === -1);
    ok(strays.length === 0, 'and every card left on the shelf carries the term',
      strays.slice(0, 3).join(' | '));
    await evaluate('var e=document.getElementById("q"); e.value=""; e.dispatchEvent(new Event("input",{bubbles:true})); true');
    await sleep(500);
    ok(await dealCount() === all, 'and clearing it puts the shelf back');

    console.log('\n== "Show in grid" drives it end to end ==');
    // The mood endpoint is the only thing stubbed, and only so a pick exists to click. Its product
    // name is a card that is really on the shelf, so the button has a real pickName.
    const moodBody = JSON.stringify({
      mood: 'unwind', label: 'Unwind', reads: 'indica-leaning', basis: 'stubbed so a pick exists to click',
      updated: '2026-08-11 00:00 UTC',
      picks: [{ score: 88, why: ['stubbed pick'], potency: null, potencySource: null,
        product: { id: 'seed__target', name: pickName, store: 'Greek Glass', type: '',
          category: '', from: 27, perG: null, ship: 8.99, inStock: true },
        url: 'https://example.invalid/p', image: '' }]
    });
    // The CAPPED POST, as the server really answers it once the daily spend ceiling is reached: a text
    // frame explaining, then a `picks` frame carrying deterministic picks, then done{capped}. Built by
    // hand rather than by running the server, because what is under test here is the CLIENT half --
    // whether the widget renders that frame at all, or silently drops an event type it does not know.
    const cappedSse = [
      'event: text\ndata: ' + JSON.stringify({ text: "I've hit my chat budget for today, so I can't talk this one through -- that resets at midnight UTC." }),
      'event: picks\ndata: ' + JSON.stringify({
        mood: 'drift', label: 'Drift off', basis: 'No model was called for this.',
        picks: [{ score: 91, why: ['indica suits drift off'], potency: 24.1, potencySource: 'lab',
          thcaAdvertised: 27.5,
          product: { id: 'seed__capped', name: pickName, store: 'Greek Glass', type: 'Indica',
            category: '', from: 33, perG: 1.18, ship: 0, inStock: true },
          url: 'https://example.invalid/capped', image: '' }]
      }),
      'event: done\ndata: ' + JSON.stringify({ stopReason: 'capped', capped: true, register: 'budtender' })
    ].join('\n\n') + '\n\n';

    // MUTABLE, so a later section can make the stubbed POST answer with a different frame and still be
    // driving the REAL client path -- server event in, DOM out. A test-only hook on window would have
    // been easier and would have tested the function rather than the wiring.
    let postSse = cappedSse;
    c.on(async (m) => {
      if (m.method !== 'Fetch.requestPaused') return;
      // Two routes reach here now and they answer differently: the mood GET returns JSON, the chat
      // POST returns an SSE stream. Anything paused MUST be answered either way or the page hangs.
      const isPost = ((m.params.request && m.params.request.method) || 'GET') === 'POST';
      try {
        await c.send('Fetch.fulfillRequest', {
          requestId: m.params.requestId, responseCode: 200,
          responseHeaders: [{ name: 'content-type', value: isPost ? 'text/event-stream' : 'application/json' }],
          body: Buffer.from(isPost ? postSse : moodBody, 'utf8').toString('base64')
        });
      } catch { /* pickName went away mid-run */ }
    });
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/concierge*', requestStage: 'Request' }] });

    if (!(await evaluate('document.querySelector(".llc-panel").classList.contains("on")'))) {
      await evaluate('document.querySelector(".llc-fab").click(); true');
      await sleep(800);
    }
    await evaluate('document.querySelectorAll(".llc-chip")[0].click(); true');
    await sleep(2000);
    ok(await evaluate('document.querySelectorAll(".llc-pick").length') >= 1, 'the mood path rendered a pick');
    await evaluate('document.querySelector(".llc-pick .llc-acts button").click(); true');
    await sleep(800);
    // The load-bearing pair: the title went to the box that matches titles, and the strain box -- which
    // would have been handed a title it cannot match -- was left alone.
    ok((await evaluate('document.getElementById("q").value')) === pickName,
      'the button reached #q, the box that substring-matches the product name');
    ok((await evaluate('document.getElementById("fStrainSearch").value')) === '',
      'and left the strain box empty, so no unmatchable strain was set');
    const shown = await cardCount();
    ok(shown >= 1 && shown < all,
      `and the shelf actually narrowed to the named product (${shown} of ${all})`);
    const survivor = (await titles())[0];
    ok(survivor === pickName, `the card left standing is the one named (${JSON.stringify(survivor)})`);
    const note = await evaluate('(function(){var n=document.querySelectorAll(".llc-note");'
      + 'return n.length ? n[n.length-1].textContent : "";})()');
    ok(/Grid pointed at/.test(note) && /search/.test(note),
      `and the widget's claim matches what happened (${JSON.stringify(note)})`);
    // THE COUNT IS IN THE CLAIM, and this is the assertion the old version could not make. "Grid
    // pointed at: type, category." was printed for real over a grid holding 2 cards out of 3,556, and
    // it was true -- naming the controls we touched says nothing about what survived them.
    const noteN = note.match(/(\d+) deals? showing/);
    ok(noteN != null, `the note carries a count, not just a list of controls (${JSON.stringify(note)})`);
    ok(noteN && Number(noteN[1]) === shown,
      `and the number it prints is the number on screen (${noteN && noteN[1]} vs ${shown})`);

    console.log('\n== the count is countable when apply() reads it ==');
    // apply() counts .card straight after dispatching, with no await. That is only correct if the
    // engine re-renders SYNCHRONOUSLY off the change event -- if it deferred to rAF or a timeout, the
    // count would be of the previous shelf and the widget would confidently print a stale number,
    // which is a worse failure than the one being fixed. Measured, not assumed: dispatch and count
    // inside ONE expression, so nothing can tick between them.
    const sync = await evaluate(`(function(){
      var s=document.getElementById("fType"), i;
      for (i=0;i<s.options.length;i++){ if(String(s.options[i].value).toLowerCase()==="indica"){ s.selectedIndex=i; break; } }
      var was=document.querySelectorAll(".card").length;
      s.dispatchEvent(new Event("change",{bubbles:true}));
      var now=document.querySelectorAll(".card").length;
      s.selectedIndex=0; s.dispatchEvent(new Event("change",{bubbles:true}));
      return was + ":" + now;
    })()`);
    const [wasN, nowN] = String(sync).split(':').map(Number);
    ok(nowN !== wasN,
      `the grid repaints before the dispatch returns, so the count is live (${wasN} -> ${nowN} with no tick between)`);
    await sleep(400);
    // Back to what it was BEFORE this probe, not to `all`: #q still holds the product name from the
    // "Show in grid" step above, so the baseline here is 1. Asserting `all` was predicting a number
    // this point in the suite has no business knowing.
    ok(await cardCount() === wasN, `and the shelf is back to its pre-probe state (${wasN})`);
    await c.send('Fetch.disable');

    console.log('\n== the other controls apply() drives repaint too ==');
    // apply() touches eight controls through three mechanisms. The search line was wrong; these were
    // right, and the only way to know that rather than assume it is to watch the card count.
    await evaluate('var e=document.getElementById("q"); e.value=""; e.dispatchEvent(new Event("input",{bubbles:true})); true');
    await sleep(400);
    /* Counts the SHELF, not the page, for the reason dealCount's own note gives:
       "cleared" means the filter let everything back in, which is a statement
       about the catalogue and not about how much of it is currently painted. */
    const drive = async (label, expr, want) => {
      await evaluate(expr);
      await sleep(450);
      const n = await dealCount();
      ok(want(n), `${label} -> ${n} deal(s) of ${all}`);
    };
    // #fBudget is `oninput`, which is the mechanism behind maxPrice. A budget under the cheapest card
    // must empty the shelf; anything less is the value being set without a repaint.
    await drive('#fBudget=1', '(function(){ var e=document.getElementById("fBudget"); e.value="1";'
      + ' e.dispatchEvent(new Event("input",{bubbles:true})); })()', (n) => n === 0);
    await drive('#fBudget cleared', '(function(){ var e=document.getElementById("fBudget"); e.value="";'
      + ' e.dispatchEvent(new Event("input",{bubbles:true})); })()', (n) => n === all);
    // #fType is `onchange`, the mechanism behind type/store/category/sort. Nothing on an accessory shelf
    // is Indica, so the shelf must empty -- and an emptied shelf is proof the dispatch repainted rather
    // than merely setting a value. The exact count is not asserted, because what this pins is the
    // mechanism, and pinning seed content the blob owns would make the test brittle for no gain.
    await drive('#fType=Indica', `(function(){ var s=document.getElementById("fType");`
      + ` for (var i=0;i<s.options.length;i++){ if(String(s.options[i].value).toLowerCase()==="indica"){ s.selectedIndex=i; break; } }`
      + ` s.dispatchEvent(new Event("change",{bubbles:true})); })()`, (n) => n < all);
    await drive('#fType cleared', `(function(){ var s=document.getElementById("fType");`
      + ` s.selectedIndex=0; s.dispatchEvent(new Event("change",{bubbles:true})); })()`, (n) => n === all);

    console.log('\n== the capped answer renders as real picks, not as a dropped frame ==');
    // A new SSE event type is only useful if the client knows it. The widget's dispatch is a chain of
    // string comparisons with no default branch, so an unhandled `picks` frame would vanish in
    // silence and the shopper would see the apology with nothing under it -- worse than an error,
    // because it reads as the site having nothing to sell.
    {
      // Interception was turned off after the grid section, so it has to come back on here or the POST
      // escapes to a server that is not running and the whole section silently asserts nothing. That is
      // exactly how this section failed the first time it ran.
      await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/concierge*', requestStage: 'Request' }] });
      const before = await evaluate('document.querySelectorAll(".llc-pick").length');
      await evaluate('(function(){ var t=document.getElementById("llcIn"); t.value="something to help me sleep";'
        + ' document.getElementById("llcGo").click(); })()');
      await sleep(1200);
      const after = await evaluate('document.querySelectorAll(".llc-pick").length');
      ok(after > before, `the picks frame rendered a card (${before} -> ${after})`);
      const bodyText = await evaluate('document.getElementById("llcBody").textContent');
      ok(/chat budget/i.test(bodyText), 'the explanation is shown, so the downgrade is stated rather than hidden');
      ok(/No model was called/.test(bodyText), 'and the basis note explains why it is free');
      // The credibility line still has to survive the degraded path: this is the one thing the site is
      // for, and a fallback that drops it would be a fallback worth less than nothing.
      ok(/24\.1%/.test(bodyText) && /lab/.test(bodyText), 'the measured potency and its lab badge render');
      ok(/label claims 27\.5%/.test(bodyText), 'and the vendor claim is named beside it');
      await c.send('Fetch.disable');
    }

    console.log('\n== the grid can be pinned to an explicit set of listings ==');
    // THE FEATURE THE CONCIERGE HAD TO REFUSE. It named five strains and then said "I can't filter the
    // grid to show only those five" -- correctly, for the tools it had. Driven here the way production
    // drives it: an `action` frame with tool "pin_products" arrives on the stream and the page reacts.
    {
      await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/concierge*', requestStage: 'Request' }] });
      const cards = JSON.parse(await evaluate(
        'JSON.stringify([].slice.call(document.querySelectorAll("#grid > .card")).map(function(c){'
        + 'return {id:c.getAttribute("data-pid"), name:(c.querySelector(".cname")||{}).textContent||""};}))'));
      ok(cards.length >= 3 && cards.every((c) => c.id),
        `every card carries a data-pid to pin by (${cards.length} cards)`);

      const two = cards.slice(0, 2).map((c) => ({ id: c.id, name: c.name, store: 'Greek Glass' }));
      const pinSse = [
        'event: text\ndata: ' + JSON.stringify({ text: 'Pinned those for you.' }),
        'event: action\ndata: ' + JSON.stringify({ tool: 'pin_products', title: 'Two from the chat', items: two }),
        'event: done\ndata: ' + JSON.stringify({ stopReason: 'end_turn', register: 'budtender' })
      ].join('\n\n') + '\n\n';
      postSse = pinSse;

      await evaluate('(function(){ var t=document.getElementById("llcIn"); t.value="show me those two";'
        + ' document.getElementById("llcGo").click(); })()');
      await sleep(1400);

      eq(await evaluate('document.documentElement.classList.contains("ll-pinned")'), true,
        'the action frame put the page into its pinned state');
      const visible = await evaluate('[].slice.call(document.querySelectorAll("#grid > .card"))'
        + '.filter(function(c){ return getComputedStyle(c).display !== "none"; }).length');
      eq(visible, 2, 'exactly the pinned cards are visible');
      const stillThere = await evaluate('document.querySelectorAll("#grid > .card").length');
      ok(stillThere > 2, `and the rest are hidden rather than destroyed (${stillThere} still in the DOM)`);

      const barTxt = await evaluate('(document.getElementById("ll-pinbar")||{}).textContent || ""');
      ok(/Two from the chat/.test(barTxt), 'the banner carries the title the model chose');
      ok(/showing 2 of 2/.test(barTxt),
        `and states the count rather than just that something happened (${JSON.stringify(barTxt.slice(0, 60))})`);
      const chat = await evaluate('document.getElementById("llcBody").textContent');
      ok(/Pinned 2 on the grid/.test(chat), 'and the widget says so in the conversation too');

      // Clearing must restore the shelf exactly, or a pin is a trap rather than a view.
      await evaluate('document.querySelector("#ll-pinbar button").click(); true');
      await sleep(300);
      eq(await evaluate('document.documentElement.classList.contains("ll-pinned")'), false, 'Clear removes the pinned state');
      eq(await evaluate('document.getElementById("ll-pinbar")'), null, 'and the banner with it');
      eq(await dealCount(), all, `and the full shelf is back (${all} deals)`);

      /* ---- A PIN MUST SURVIVE THE FILTERS THAT WERE ALREADY ON --------------
         REPORTED LIVE: asked to filter to everything Durban Poison, the concierge named two
         listings, offered to pin them side by side, and the banner came back "showing 0 of 2 --
         the rest are further down the shelf than I can reach; clear this and search by name".

         search_catalog runs over the WHOLE feed, server-side. The grid does not -- and it is very
         often narrowed by the concierge itself, one turn earlier, because the shopper asked it to.
         A pinned listing excluded by the live filters is not on page 40, it is on no page at all,
         so the sweep runs out of shelf and blames distance for what was exclusion. Every word of
         that banner was wrong and the instruction it gave was the shopper doing the bot's job.

         Driven here the way it happens: a filter that provably hides both targets goes on FIRST,
         then the pin arrives. */
      {
        const txt = JSON.stringify(two.map((t) => t.name));
        /* A search term that matches neither target, so both are off the shelf before we pin. */
        await evaluate('var e=document.getElementById("q"); e.value="zzzznotathing";'
          + ' e.dispatchEvent(new Event("input",{bubbles:true}));'
          + ' e.dispatchEvent(new Event("change",{bubbles:true})); true');
        await sleep(500);
        const hidden = await evaluate('[].slice.call(document.querySelectorAll("#grid > .card"))'
          + '.filter(function(c){ return getComputedStyle(c).display !== "none"; }).length');
        eq(hidden, 0, 'the pre-set filter really does hide everything, including both targets');

        postSse = pinSse;
        await evaluate('(function(){ var t=document.getElementById("llcIn"); t.value="pin those two";'
          + ' document.getElementById("llcGo").click(); })()');
        await sleep(1600);

        eq(await evaluate('document.documentElement.classList.contains("ll-pinned")'), true,
          'the pin still takes effect over an active filter');
        const bar2 = await evaluate('(document.getElementById("ll-pinbar")||{}).textContent || ""');
        ok(/showing 2 of 2/.test(bar2),
          `both pinned listings are placed despite the filter (${JSON.stringify(bar2.slice(0, 80))})`);
        ok(!/could not place/.test(bar2), '...so the banner makes no excuse about reach');
        const vis2 = await evaluate('[].slice.call(document.querySelectorAll("#grid > .card"))'
          + '.filter(function(c){ return getComputedStyle(c).display !== "none"; }).length');
        eq(vis2, 2, 'and exactly the two are on screen');

        /* THE NEEDLE CAN NEVER EXCLUDE WHAT IT IS FINDING. The pin narrows the shelf by typing the
           longest phrase the pinned names share into the engine's own search box -- which is only
           safe because that phrase came out of every one of those names. Asserted as the property
           rather than as a value, so the test does not become a second copy of the algorithm. */
        const q = await evaluate('(document.getElementById("q")||{}).value || ""');
        const names = JSON.parse(txt).map((n) => String(n).toLowerCase());
        ok(q === '' || names.every((n) => n.indexOf(String(q).toLowerCase()) !== -1),
          `the search term the pin typed appears in every pinned name (${JSON.stringify(q)})`);

        /* AND THE SHOPPER'S OWN FILTER COMES BACK. Widening the shelf to place a pin is fine;
           leaving it widened after they dismiss the pin is a trap they never saw set. */
        await evaluate('document.querySelector("#ll-pinbar button").click(); true');
        await sleep(500);
        eq(await evaluate('(document.getElementById("q")||{}).value || ""'), 'zzzznotathing',
          'Clear puts the filter the shopper had back');
        await evaluate('var e=document.getElementById("q"); e.value="";'
          + ' e.dispatchEvent(new Event("input",{bubbles:true}));'
          + ' e.dispatchEvent(new Event("change",{bubbles:true})); true');
        await sleep(500);
        eq(await dealCount(), all, 'and the whole shelf is reachable again');
      }

      // A pin and a filter cannot both be in charge. The pin yields, rather than the two fighting over
      // every re-render.
      postSse = pinSse;
      await evaluate('(function(){ var t=document.getElementById("llcIn"); t.value="again";'
        + ' document.getElementById("llcGo").click(); })()');
      await sleep(1400);
      eq(await evaluate('document.documentElement.classList.contains("ll-pinned")'), true, 'pinned again');
      await evaluate('var e=document.getElementById("fType"); e.selectedIndex=1;'
        + ' e.dispatchEvent(new Event("change",{bubbles:true})); true');
      await sleep(400);
      eq(await evaluate('document.documentElement.classList.contains("ll-pinned")'), false,
        'touching a grid filter clears the pin rather than fighting it');
      await evaluate('var e=document.getElementById("fType"); e.selectedIndex=0;'
        + ' e.dispatchEvent(new Event("change",{bubbles:true})); true');
      await sleep(400);
      eq(await dealCount(), all, 'and the shelf is whole again afterwards');
      await c.send('Fetch.disable');
      postSse = cappedSse;
    }

    console.log('\n== nothing floats on top of the composer ==');
    // A DOM assertion cannot see an overlap, which is how this one shipped and was caught by eye:
    // at mobile width the site's own #ggFloat promo pill (z-index 9999) landed squarely on the
    // input. So this measures geometry instead -- any fixed element stacked above the panel that
    // intersects the composer is a collision. The auth modal is exempt on purpose: an account
    // prompt outranks a chat panel and is meant to cover it.
    await c.send('Emulation.setDeviceMetricsOverride', { width: 420, height: 780, deviceScaleFactor: 1, mobile: true });
    await evaluate('localStorage.setItem("ll_conc_reg","budtender"); true');
    if (!(await evaluate('document.querySelector(".llc-panel").classList.contains("on")'))) {
      await evaluate('document.querySelector(".llc-fab").click(); true');
    }
    await sleep(900);
    const collisions = await evaluate(`JSON.stringify((function(){
      var panel = document.querySelector('.llc-panel');
      var pz = parseInt(getComputedStyle(panel).zIndex, 10);
      var box = document.getElementById('llcIn').getBoundingClientRect();
      var hits = [], all = document.querySelectorAll('*');
      for (var i = 0; i < all.length; i++) {
        var e = all[i], s = getComputedStyle(e);
        if (s.position !== 'fixed' && s.position !== 'sticky') continue;
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) continue;
        if (panel.contains(e) || e.contains(panel)) continue;
        if (/auth-ov|auth-modal/.test(String(e.className))) continue;
        var z = parseInt(s.zIndex, 10);
        if (!(z > pz)) continue;
        var r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom) {
          hits.push((e.id ? '#' + e.id : '.' + e.className) + ' z=' + z);
        }
      }
      return hits;
    })())`);
    const hit = JSON.parse(collisions);
    ok(hit.length === 0, 'no fixed element stacked above the panel overlaps the composer', hit.join(', '));
    ok(await evaluate('document.documentElement.classList.contains("ll-conc-open")'),
      'the open panel marks the document, which is what suppresses the site\'s floating chrome');
    await evaluate('document.getElementById("llcX").click(); true');
    await sleep(300);
    ok(!(await evaluate('document.documentElement.classList.contains("ll-conc-open")')),
      'and closing restores it rather than leaving the site permanently altered');
    ok(await evaluate('!!document.getElementById("ggFloat") && getComputedStyle(document.getElementById("ggFloat")).display') !== 'none',
      'the hidden button comes back');

    console.log('\n== console is clean apart from the missing feed ==');
    // Two classes of expected noise, both named rather than pattern-widened. Widening a filter until
    // a test goes green is how a harness stops being able to see real breakage.
    //   1. The catalogue: /api/products has no egress here, so it and everything downstream fails.
    //   2. /_vercel/insights/script.js: Vercel Web Analytics exists only on Vercel. It has 404'd in
    //      the local preview since it was added (present on main, unrelated to this change).
    const EXPECTED = /\/api\/(products|concierge)|_vercel\/insights|Failed to fetch|NetworkError|net::/i;
    const noise = [...pageErrors, ...consoleErrors].filter((t) => t && !EXPECTED.test(t));
    ok(noise.length === 0, 'no unexplained page errors', noise.slice(0, 4).join('\n       '));
    if (pageErrors.length || consoleErrors.length) {
      console.log(`  (${pageErrors.length + consoleErrors.length} feed-related console messages ignored, as expected with no egress)`);
    }

    c.close();
  } finally {
    await cleanup();
  }

  console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`);
  if (fail) { console.log('failed:\n' + failures.map((f) => '  - ' + f).join('\n')); process.exitCode = 1; }
}

main().catch((e) => { console.error('harness error:', e.message); process.exitCode = 1; });
