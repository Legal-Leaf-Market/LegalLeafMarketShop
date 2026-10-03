// api/admin/sign-in.js — /admin/sign-in
//
// Shows the passcode form, or setup instructions when ADMIN_PASSCODE isn't
// configured. Already-authenticated visitors bounce straight to ?redirect
// (or /admin/operating-model). Never cached — it reads a cookie and an env var.

import { adminConfigured, passcode, isAdmin } from './_gate.js';
import { renderShell } from './_page-shell.js';

function safeRedirect(raw) {
  if (typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/admin/operating-model';
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const url = new URL(req.url, 'http://internal');
  const destination = safeRedirect(url.searchParams.get('redirect'));

  if (isAdmin(req)) {
    res.statusCode = 302;
    res.setHeader('Location', destination);
    return res.end();
  }

  const configured = adminConfigured();
  const hasPasscode = passcode() !== null;

  let body;
  if (!configured) {
    body = `
      <div class="card" style="max-width:28rem;margin:0 auto">
        <p class="eyebrow">Admin mode</p>
        <h1 class="admin-h1" style="font-size:1.5rem">This page is private</h1>
        <div style="margin-top:14px">
          <p>No admin credential is configured on this deployment, so nothing can be unlocked yet. The gate fails closed on purpose &mdash; an unset variable must not publish the operating model.</p>
          <p>Set this in Netlify &rarr; Project configuration &rarr; Environment variables, then redeploy:</p>
          <div class="card" style="margin-top:10px;background:rgba(255,255,255,0.05)">
            <code style="font-weight:900;color:var(--leaf)">ADMIN_PASSCODE</code>
            <p style="margin-top:4px;font-size:0.78rem">A long random string. Enter it here to unlock; it also signs the session cookie, so changing it signs everyone out.</p>
          </div>
        </div>
        <p style="margin-top:18px;border-top:1px solid rgba(240,185,60,0.15);padding-top:14px;font-size:0.78rem"><a href="/" style="color:var(--muted);text-decoration:none">&larr; Back to the public site</a></p>
      </div>`;
  } else if (hasPasscode) {
    body = `
      <div class="card" style="max-width:28rem;margin:0 auto">
        <p class="eyebrow">Admin mode</p>
        <h1 class="admin-h1" style="font-size:1.5rem">This page is private</h1>
        <p style="margin-top:12px;font-size:0.85rem;color:var(--muted);line-height:1.6">Enter the admin passcode to open the operating model.</p>
        <form id="passcode-form" style="margin-top:18px;display:flex;flex-direction:column;gap:10px">
          <label style="display:block">
            <span style="display:block;margin-bottom:6px;font-size:0.6rem;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:var(--gold)">Admin passcode</span>
            <input type="password" name="passcode" autocomplete="current-password" autofocus style="width:100%;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);padding:8px 10px;font-size:0.85rem;font-weight:700;color:var(--leaf);outline:none;box-sizing:border-box">
          </label>
          <p id="passcode-error" role="alert" style="display:none;font-size:0.82rem;font-weight:700;color:#ff8f8c;margin:0"></p>
          <button type="submit" class="btn btn-primary" style="width:100%;padding:9px 12px">Enter admin</button>
        </form>
        <p style="margin-top:18px;border-top:1px solid rgba(240,185,60,0.15);padding-top:14px;font-size:0.78rem"><a href="/" style="color:var(--muted);text-decoration:none">&larr; Back to the public site</a></p>
      </div>
      <script>
      (function () {
        var form = document.getElementById('passcode-form');
        var error = document.getElementById('passcode-error');
        form.addEventListener('submit', function (e) {
          e.preventDefault();
          var btn = form.querySelector('button[type=submit]');
          var input = form.querySelector('input[name=passcode]');
          btn.disabled = true;
          btn.textContent = 'Checking…';
          error.style.display = 'none';
          fetch('/api/admin/session', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ passcode: input.value }),
          })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, body: b }; }); })
            .then(function (result) {
              if (!result.ok) {
                error.textContent = (result.body && result.body.error) || 'Sign-in failed.';
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Enter admin';
                return;
              }
              location.replace(${JSON.stringify(destination)});
            })
            .catch(function () {
              error.textContent = "Couldn't reach the server. Try again.";
              error.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Enter admin';
            });
        });
      })();
      </script>`;
  } else {
    // adminConfigured() is true but passcode() is null: unreachable today
    // since this codebase only implements the passcode gate (see _gate.js),
    // kept only so a future second gate degrades to a message instead of a
    // blank form.
    body = `
      <div class="card" style="max-width:28rem;margin:0 auto">
        <p class="eyebrow">Admin mode</p>
        <h1 class="admin-h1" style="font-size:1.5rem">This page is private</h1>
        <p style="margin-top:12px;font-size:0.85rem;color:var(--muted)">No sign-in method is available. Set <code style="color:var(--leaf)">ADMIN_PASSCODE</code> and redeploy.</p>
      </div>`;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(renderShell({ title: 'Sign in', admin: false, bodyHtml: body }));
}
