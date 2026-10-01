/* tools/chrome-path.mjs — where the browser is, asked once.
 *
 * Nine suites and the scheduled harvester drive real Chromium over raw CDP (no Playwright import, which is
 * what keeps `dependencies` empty -- CLAUDE.md sections 1 and 11). Five of them
 * hardcoded ONE path, `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, and
 * four had grown their own candidate list. That split is a problem in two
 * directions and both of them are silent:
 *
 *   - THE VERSION IS PINNED INTO THE PATH. `chromium-1194` is whatever the
 *     container happened to ship. The day it becomes 1195 the five hardcoded
 *     suites stop finding a browser and the four with lists carry on, so the
 *     failure arrives as "half the suites broke" rather than as "the browser
 *     moved" -- and a suite that cannot start a browser fails in a way that
 *     reads like the page being at fault, which is precisely how the Google
 *     Fonts block cost an evening (CLAUDE.md section 10).
 *   - CI HAS A DIFFERENT BROWSER ENTIRELY. GitHub's ubuntu runner ships Chrome
 *     at /usr/bin/google-chrome and has no /opt/pw-browsers at all, so those
 *     five could never run there. Unifying this is the prerequisite for the
 *     suites running on anything but this container.
 *
 * ORDER MATTERS AND IS DELIBERATE: an explicit CHROME_PATH beats everything
 * (that is what CI sets), then Playwright's own root if the environment names
 * one, then the pinned build, then the unpinned symlink, then the distro's.
 * Wildcards are resolved by reading the directory rather than by guessing a
 * version number, so a bumped build is found without editing this file.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync, spawn as spawnProc } from "node:child_process";
import { join } from "node:path";

/* Any chromium-* under the Playwright root, newest build first. The directory
   name carries the build number, so a numeric sort finds the current one
   without this file having to know what it is. */
function pwBuilds(root) {
  let names = [];
  try { names = readdirSync(root); } catch { return []; }
  const byBuild = (a, b) =>
    (parseInt(b.replace(/\D/g, ""), 10) || 0) - (parseInt(a.replace(/\D/g, ""), 10) || 0);
  const full = names.filter(n => /^chromium(-|$)/.test(n)).sort(byBuild)
    .map(n => join(root, n, "chrome-linux", "chrome"));
  /* The headless shell LAST, and only as a fallback. It runs a page and speaks
     CDP, which is all these suites need, but it is a cut-down build -- so a full
     Chromium is preferred wherever one exists rather than picked by build
     number against it. */
  const shell = names.filter(n => /^chromium_headless_shell-/.test(n)).sort(byBuild)
    .map(n => join(root, n, "chrome-linux", "headless_shell"));
  return full.concat(shell);
}

const PW_ROOT = process.env.PLAYWRIGHT_BROWSERS_PATH || "/opt/pw-browsers";

const CANDIDATES = [
  process.env.CHROME_PATH,
  process.env.CHROMIUM_PATH,
  ...pwBuilds(PW_ROOT),
  join(PW_ROOT, "chromium"),                  // the unpinned symlink, where it exists
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
].filter(Boolean);

/* Executable, not merely present: a directory named `chromium` matches the
   symlink candidate above and is not something spawn() can run. */
function runnable(p) {
  try { return existsSync(p) && statSync(p).isFile(); } catch { return false; }
}

/* AND IT HAS TO ACTUALLY RUN, WHICH "IS A FILE" DOES NOT PROVE.
 *
 * Three of sixteen browser jobs failed one CI run with "Chromium did not start"
 * -- sixteen seconds in, before a single assertion -- while the same suites
 * passed locally and the other thirteen passed on the same commit. The failing
 * and passing jobs reported different git versions, so the matrix had landed on
 * different runner images and some of those images ship a google-chrome that
 * exists, is a file, is executable, and dies on launch.
 *
 * CHROME_PATH beat every other candidate on the strength of being a file, so
 * there was no fallback: one bad image took the job down. And the message named
 * nothing -- "did not start" is the symptom, while `error while loading shared
 * libraries: libnss3.so` is the cause and was thrown away.
 *
 * So a candidate must answer `--version` before it is chosen. That is one cheap
 * spawn, at most once per candidate, and it stops at the first that works --
 * so the normal case costs a single 50ms exec and a broken image costs one more.
 * The stderr of every failure is kept and printed if nothing works at all,
 * because a suite that cannot start a browser fails in a way that reads like the
 * PAGE being at fault, which is exactly how the Google Fonts block cost an
 * evening (CLAUDE.md section 10). */
const WHY = [];
function answers(p) {
  try {
    const out = execFileSync(p, ["--version"], {
      timeout: 10000, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    });
    /* A browser that starts prints its name and version. Anything else -- an
       empty string, a shim that exits 0 having done nothing -- is not one. */
    if (/chrom/i.test(String(out || ""))) return true;
    WHY.push(p + ": ran but did not identify itself as Chromium (" + String(out || "").trim().slice(0, 60) + ")");
    return false;
  } catch (e) {
    const msg = String((e && (e.stderr || e.message)) || e).trim().replace(/\s+/g, " ");
    WHY.push(p + ": " + msg.slice(0, 160));
    return false;
  }
}

/* Verified lazily and cached, so importing this file costs nothing until a
   browser is actually wanted -- several node-only suites import it for CANDIDATES
   and never start anything. */
let VERIFIED = null;
function resolve() {
  if (VERIFIED !== null) return VERIFIED;
  VERIFIED = CANDIDATES.filter(runnable).find(answers) || "";
  return VERIFIED;
}

const CHROME = CANDIDATES.find(runnable) || "";

/* Suites call this rather than reading CHROME, so the failure is one clear
   sentence naming every path tried instead of a spawn ENOENT. */
export function chromePath() {
  const ok = resolve();
  if (ok) {
    /* Said out loud when the obvious answer was NOT the one that worked, so a
       run on a broken image reads as "we fell back" rather than as a mystery
       that happens to have taken longer. */
    if (CHROME && ok !== CHROME) {
      console.error("chrome-path: " + CHROME + " would not start, using " + ok);
      for (const w of WHY) console.error("  " + w);
    }
    return ok;
  }
  console.error(
    "No Chromium would start. Set CHROME_PATH, or install one at a known location.\n" +
    "Tried:\n  " + CANDIDATES.join("\n  ") +
    (WHY.length ? "\nWhy each failed:\n  " + WHY.join("\n  ") : ""));
  process.exit(2);
}


/* ---------------------------------------------------------------- launch ---
 * STARTING A BROWSER IS A SEPARATE QUESTION FROM FINDING ONE, and conflating
 * them cost a third red build.
 *
 * The --version check above was added because a runner image shipped a
 * google-chrome that could not run at all. It fixed that and did NOT fix this:
 *
 *     using /usr/bin/google-chrome (Google Chrome 151.0.7922.137)
 *     Chromium did not start
 *     Terminate orphan process: pid (2161) (chrome)
 *     Terminate orphan process: pid (2168) (chrome_crashpad_handler)
 *
 * The binary answered --version perfectly and then failed to bring up a
 * DEBUGGABLE browser inside the fifteen seconds the suite allowed. Orphaned
 * chrome and crashpad processes prove it spawned; nothing anywhere said why,
 * because every suite spawned with stdio "ignore" and threw Chrome's own
 * explanation away.
 *
 * THREE THINGS, none of which any individual suite should be reimplementing:
 *
 *   A BUDGET THAT SUITS A COLD START ON A LOADED RUNNER. Fifteen seconds is
 *   generous locally and tight on shared CI hardware, and the failure it
 *   produces is indistinguishable from a broken browser.
 *
 *   CHROME'S STDERR, KEPT. "Chromium did not start" names the symptom. The
 *   process usually says something -- a profile lock, a missing library, a port
 *   already bound -- and that sentence is the difference between a fix and
 *   another re-run.
 *
 *   A REAL FALLBACK. If the chosen browser will not come up, the next candidate
 *   is tried rather than the run being abandoned.
 */
/* The page target, waited for and then asked for. Returned so a suite can use
   it directly; suites that keep their own /json/list poll simply find it
   already there, which is the point. */
async function pageTarget(port, budgetMs) {
  const base = "http://127.0.0.1:" + port;
  const deadline = Date.now() + Math.max(5000, budgetMs || 0);
  let asked = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + "/json/list");
      if (r.ok) {
        const list = await r.json().catch(() => []);
        const pg = Array.isArray(list) && list.find(x => x && x.type === "page" && x.webSocketDebuggerUrl);
        if (pg) return pg;
        /* Once, not every tick: a tab per poll is how a stuck browser becomes a
           browser with two hundred tabs. */
        if (!asked) {
          asked = true;
          try { await fetch(base + "/json/new?about:blank", { method: "PUT" }); } catch {}
        }
      }
    } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

export async function launchChrome(port, extraArgs, opts) {
  const o = opts || {};
  const budgetMs = o.budgetMs || 45000;
  const tried = [];
  const cands = CANDIDATES.filter(runnable);
  /* The verified one first, then the rest -- so the normal path is one spawn. */
  const first = resolve();
  const order = first ? [first].concat(cands.filter(c => c !== first)) : cands;

  for (const bin of order) {
    let err = "";
    const proc = spawnProc(bin, [
      "--remote-debugging-port=" + port, "--headless=new", "--no-sandbox",
      "--disable-gpu", "--disable-dev-shm-usage",
      "--user-data-dir=" + (o.userDataDir || ("/tmp/_ll_" + port)),
      "about:blank",
    ].concat(extraArgs || []), { stdio: ["ignore", "ignore", "pipe"] });
    if (proc.stderr) proc.stderr.on("data", d => { err += String(d); });

    const t0 = Date.now();
    let ready = false, ver = null;
    while (Date.now() - t0 < budgetMs && !ready) {
      try {
        const r = await fetch("http://127.0.0.1:" + port + "/json/version");
        if (r.ok) { ver = await r.json().catch(() => ({})); ready = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 150));
    }
    if (ready) {
      /* AND A DEBUG PORT IS NOT A PAGE. Every suite here then polls /json/list
         for a target of type "page", each with its own retry count, and on a
         loaded runner about:blank can register later than the shortest of them
         allows -- which surfaced as "Chromium did not expose a page target"
         from test-concierge-browser.mjs while the browser itself had started
         perfectly. Same shape as the failure launchChrome was written for, one
         step further along, so it belongs in the same place rather than being
         fixed sixteen times at sixteen different timeouts.
         If none appears, one is asked for: /json/new is the documented way and
         a browser that answers /json/version can always honour it. */
      const target = await pageTarget(port, budgetMs - (Date.now() - t0));
      if (!target) {
        try { proc.kill(); } catch {}
        tried.push(bin + " opened a debug port but never a page target");
        continue;
      }
      if (tried.length) console.error("chrome: fell back to " + bin + " after " + tried.join("; "));
      return { proc, bin, version: (ver && ver.Browser) || "", target };
    }
    try { proc.kill(); } catch {}
    tried.push(bin + " did not open a debug port in " + Math.round(budgetMs / 1000) + "s" +
               (err.trim() ? " (" + err.trim().split("\n").slice(-2).join(" ").slice(0, 200) + ")" : " (said nothing)"));
  }
  console.error("No Chromium would start a debuggable browser.\n  " + tried.join("\n  "));
  process.exit(2);
}

export { CHROME, CANDIDATES };
export default chromePath;
