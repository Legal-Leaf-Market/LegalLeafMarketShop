/* ============================================================================
 * /api/ambassador — applications to bring a town onto the site.
 * ----------------------------------------------------------------------------
 * THIS ONE MUST NOT FALL BACK TO MEMORY, and that is the difference between it
 * and every other endpoint here.
 *
 * api/coldwater/ingest degrades to a per-instance Map because a lost capture is
 * re-capturable: the operator still has the menu open, and the diagnostic says
 * `persistent:false` so they know to attach a store. An application is not like
 * that. Somebody types their name, their town and their email, reads "thanks,
 * we'll be in touch", and if that landed in a Map on a lambda that has since
 * been recycled, it is gone and NOBODY KNOWS -- not them, not us. They wait for
 * a reply that was never possible.
 *
 * So this endpoint FAILS CLOSED. With no durable backend and no webhook it
 * returns 503 and says, in words, to email instead. A form that admits it is
 * broken keeps the applicant; a form that lies loses them and the town.
 *
 * PII, deliberately minimal. Name, email, town, and what they know about the
 * shops there. No address, no date of birth, no ID. Reading the list back
 * requires LL_ADMIN_TOKEN -- the same gate as publishing overrides -- because
 * an open GET here would be a list of real people's names and emails alongside
 * their interest in cannabis retail, which is exactly the kind of record that
 * should not be one URL away from anybody who guesses it.
 * ========================================================================== */

import { neonOn, getJson as neonGetJson, setJson as neonSetJson } from "./neon.js";
import { kvUrl, kvTok, kvOn } from './kv.js';

/* The credential trio lives in api/kv.js now -- it was byte-identical in
   four files and a fifth was about to be written. See that file's header. */
const hookOn = () => !!process.env.LL_CRM_WEBHOOK;
const KEY = "ll:ambassador:applications";

/* A cap, so a scripted flood cannot grow the record without bound. Reaching it
   is reported rather than silently dropping the newest -- a full list that
   quietly refuses applications is the same failure as memory, slower. */
const MAX = 500;

export const backendName = () =>
  kvOn() ? "kv" : (neonOn() ? "neon" : (hookOn() ? "webhook" : ""));

async function readAll() {
  if (kvOn()) {
    try {
      const r = await fetch(`${kvUrl()}/get/${encodeURIComponent(KEY)}`, {
        headers: { authorization: `Bearer ${kvTok()}` },
      });
      if (r.ok) {
        const j = await r.json();
        if (j && j.result != null) {
          const v = typeof j.result === "string" ? JSON.parse(j.result) : j.result;
          if (Array.isArray(v)) return v;
        }
      }
    } catch (e) { /* fall through */ }
  }
  if (neonOn()) {
    try {
      const v = await neonGetJson(KEY);
      if (Array.isArray(v)) return v;
    } catch (e) { /* fall through */ }
  }
  return [];
}

async function writeAll(rows) {
  if (kvOn()) {
    const r = await fetch(`${kvUrl()}/set/${encodeURIComponent(KEY)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${kvTok()}`, "content-type": "application/json" },
      body: JSON.stringify(rows),
    });
    if (!r.ok) throw new Error("kv " + r.status);
    return "kv";
  }
  if (neonOn()) { await neonSetJson(KEY, rows); return "neon"; }
  throw new Error("no durable backend");
}

function readBody(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise(resolve => {
    let s = "";
    req.on("data", c => { s += c; if (s.length > 1e5) { s = ""; req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(s || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
/* Deliberately loose. A regex that rejects a valid address is worse than one
   that lets a typo through, because the typo gets a bounce and the rejection
   gets a person who gives up. */
const emailish = e => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(String(e || "").trim());

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");

  /* GET is a CONFIG probe, never the applications. Same shape as
     /api/overrides: it says whether a submission would survive, so a
     misconfigured deploy is visible before somebody applies into a void. */
  if (req.method === "GET") {
    const token = req.headers["x-ll-admin-token"];
    const backend = backendName();
    if (!token) {
      return res.status(200).json({
        ok: true,
        accepting: !!backend,
        storage: backend || "NOT CONFIGURED",
        note: backend
          ? "Applications are stored and readable with the admin token."
          : "No durable backend. POST will return 503 rather than accept an application it cannot keep.",
      });
    }
    if (!process.env.LL_ADMIN_TOKEN || token !== process.env.LL_ADMIN_TOKEN) {
      return res.status(401).json({ ok: false, error: "bad token" });
    }
    const rows = await readAll();
    return res.status(200).json({ ok: true, count: rows.length, applications: rows });
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "GET or POST" });
  }

  const b = await readBody(req);

  /* HONEYPOT. A field a human never sees and never fills; a bot fills
     everything. Answered with 200 on purpose -- telling a bot it was caught
     just teaches whoever wrote it to stop filling that field. */
  if (str(b.website, 80)) return res.status(200).json({ ok: true, received: true });

  const town = str(b.town, 80);
  const state = str(b.state, 40);
  const email = str(b.email, 160);
  const name = str(b.name, 80);

  if (!name) return res.status(400).json({ ok: false, error: "Tell us your name." });
  if (!emailish(email)) return res.status(400).json({ ok: false, error: "That email address does not look right." });
  if (!town) return res.status(400).json({ ok: false, error: "Which town?" });
  if (!state) return res.status(400).json({ ok: false, error: "Which state?" });
  if (b.confirm !== true) {
    return res.status(400).json({ ok: false, error: "Please confirm you are 21+ and happy for us to contact you." });
  }

  const row = {
    name, email, town, state,
    phone: str(b.phone, 40),
    shops: str(b.shops, 400),
    why: str(b.why, 1200),
    /* Their own words about the town, which is the part that actually decides
       this -- the code is the easy half, somebody who will keep it fresh is not. */
    at: new Date().toISOString(),
  };

  const backend = backendName();
  if (!backend) {
    /* FAIL CLOSED, LOUDLY. See the header: an application accepted into a
       per-instance Map is an application nobody will ever answer. */
    return res.status(503).json({
      ok: false,
      error: "We cannot record applications right now, and we would rather say so than lose yours. "
           + "Please email jake@nicotiamarket.com with your town and we will pick it up from there.",
    });
  }

  /* The webhook path is fire-and-forget alongside durable storage, or the only
     path when it is all that is configured. */
  const tasks = [];
  if (hookOn()) {
    tasks.push(fetch(process.env.LL_CRM_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "ambassador", ...row }),
    }).catch(() => {}));
  }

  let stored = "webhook";
  if (kvOn() || neonOn()) {
    try {
      const rows = await readAll();
      /* One application per email per town. A second submission updates the
         first rather than filling the list with duplicates from somebody who
         tapped twice on a slow connection. */
      const k = (row.email + "|" + row.town + "|" + row.state).toLowerCase();
      const at = rows.findIndex(r => (r.email + "|" + r.town + "|" + r.state).toLowerCase() === k);
      if (at >= 0) rows[at] = row;
      else if (rows.length >= MAX) {
        return res.status(503).json({
          ok: false,
          error: "Our application list is full at the moment. Please email jake@nicotiamarket.com.",
        });
      } else rows.push(row);
      stored = await writeAll(rows);
    } catch (e) {
      if (!hookOn()) {
        return res.status(503).json({
          ok: false,
          error: "We could not save that just now, and we would rather say so than lose it. "
               + "Please email jake@nicotiamarket.com with your town.",
        });
      }
    }
  }

  await Promise.all(tasks);
  /* The town is echoed back so the page can say it by name. The email is NOT
     logged or echoed anywhere it could end up in a log line. */
  return res.status(200).json({ ok: true, town, state, stored });
}
