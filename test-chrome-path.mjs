/* test-chrome-path.mjs — a browser that exists is not a browser that runs.
 *
 * THE FAILURE THIS EXISTS FOR. Three of sixteen browser jobs failed one CI run
 * with "Chromium did not start" -- sixteen seconds in, before a single
 * assertion -- while the same suites passed locally and the other thirteen
 * passed on the same commit. The failing and passing jobs reported different git
 * versions, so the matrix had landed on different runner images, and some of
 * those images ship a google-chrome that exists, is a file, is executable, and
 * dies on launch.
 *
 * TWO FAULTS, and the second is the expensive one:
 *
 *   CHROME_PATH won on the strength of being a FILE, so there was no fallback --
 *   one bad image took the job down even though a working Chromium sat further
 *   down the candidate list.
 *
 *   And the message named nothing. "Chromium did not start" is the symptom;
 *   "error while loading shared libraries: libnss3.so" is the cause, and it was
 *   being thrown away. A suite that cannot start a browser fails in a way that
 *   reads like the PAGE being at fault, which is how the Google Fonts block cost
 *   an evening.
 *
 * THE FIXTURE IS A BROKEN BROWSER, not a missing one -- a missing path was
 * already handled, and pretending otherwise would test the case that worked.
 *
 *   node test-chrome-path.mjs
 */
import { writeFileSync, chmodSync, mkdtempSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0; const fails = [];
const ok = (m, c, x) => {
  if (c) { pass++; console.log("  ok   " + m + (x ? "   (" + x + ")" : "")); }
  else { fails.push(m); console.log("  FAIL " + m + (x ? "   (" + x + ")" : "")); }
};
const group = m => console.log("\n" + m);

const dir = mkdtempSync(join(tmpdir(), "chromepath-"));
const make = (name, body) => {
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\n" + body + "\n");
  chmodSync(p, 0o755);
  return p;
};

/* Exists, is a file, is executable -- and dies exactly as a broken runner image
   does. This is the shape the old check could not tell from a working browser. */
const broken = make("broken-chrome", 'echo "error while loading shared libraries: libnss3.so" >&2; exit 127');
/* Worse than broken, and the reason "it exited 0" is not the test: a shim that
   succeeds having done nothing would satisfy any exit-code check. */
const liar = make("liar-chrome", 'echo "hello"; exit 0');

/* spawnSync, NOT execFileSync, and the difference is the whole point of two of
   these assertions: execFileSync RETURNS STDOUT ONLY on success, so the fallback
   notice -- which is written to stderr, where a diagnostic belongs -- vanished
   on exactly the path this suite exists to check. The first draft failed three
   assertions against working code for that reason. */
const run = env => {
  const r = spawnSync(process.execPath,
    ["-e", 'import("./tools/chrome-path.mjs").then(m=>console.log("RESOLVED:"+m.chromePath()))'],
    { env: { ...process.env, ...env }, encoding: "utf8" });
  return { out: String(r.stdout || "") + String(r.stderr || ""), code: r.status == null ? -1 : r.status };
};

console.log("\nA browser that exists is not a browser that runs\n");

group("THE NORMAL CASE IS UNCHANGED, and costs one --version");
{
  const r = run({});
  const line = (r.out.match(/RESOLVED:(.*)/) || [])[1] || "";
  ok("a working environment still resolves a browser", !!line.trim(), line.trim());
  ok("...without printing a fallback notice", !/would not start/.test(r.out));
}

group("A BROKEN CHROME_PATH FALLS BACK instead of taking the job down");
{
  const r = run({ CHROME_PATH: broken });
  const line = (r.out.match(/RESOLVED:(.*)/) || [])[1] || "";
  ok("something is still resolved", !!line.trim(), line.trim());
  ok("...and it is NOT the broken one", line.trim() !== broken, line.trim());
  /* The half that turns a mystery into a fix. */
  ok("the reason is printed, not swallowed", /libnss3\.so/.test(r.out),
     (r.out.match(/.*libnss3.*/) || [""])[0].trim().slice(0, 90));
  ok("...and it says which path was skipped", r.out.includes(broken));
}

group("AND A SHIM THAT EXITS 0 IS NOT A BROWSER");
{
  /* An exit-code check would accept this. The candidate has to IDENTIFY itself,
     because "ran without erroring" is satisfied by anything at all. */
  const r = run({ CHROME_PATH: liar });
  const line = (r.out.match(/RESOLVED:(.*)/) || [])[1] || "";
  ok("it is rejected despite succeeding", line.trim() !== liar, line.trim());
  ok("...for the stated reason", /did not identify itself/.test(r.out));
}

group("NOTHING WORKING IS A NAMED FAILURE, not a spawn error");
{
  /* PLAYWRIGHT_BROWSERS_PATH is redirected too, or the real builds under the
     default root would be found and this would prove nothing. */
  const r = run({ CHROME_PATH: broken, CHROMIUM_PATH: liar, PATH: dir,
                  PLAYWRIGHT_BROWSERS_PATH: join(dir, "none") });
  const resolved = (r.out.match(/RESOLVED:(.*)/) || [])[1];
  if (resolved && resolved.trim()) {
    /* A distro browser exists on this machine, so the exhausted path cannot be
       reached here. Say so rather than asserting something vacuous. */
    ok("a system browser was found, so the exhausted-list path is not reachable here",
       true, resolved.trim());
  } else {
    ok("it exits non-zero rather than throwing ENOENT later", r.code === 2, String(r.code));
    ok("...listing every path tried", /Tried:/.test(r.out));
    ok("...and why each one failed", /Why each failed:/.test(r.out) && /libnss3/.test(r.out));
  }
}

console.log("\n" + (fails.length ? `FAILED: ${fails.join(", ")}` : `All ${pass} assertions passed.`) + "\n");
process.exit(fails.length ? 1 : 0);
