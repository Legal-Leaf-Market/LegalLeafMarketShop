// api/admin/_page-shell.js — shared HTML chrome for the /admin pages: the
// noindex meta, the site link, the admin pill, and (when signed in) the
// sign-out button. Plain server-rendered HTML, no templating engine.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STYLES = readFileSync(join(__dirname, '_client-styles.css'), 'utf8');

export function renderShell({ title, admin, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Admin · Legal-Leaf Market</title>
<meta name="robots" content="noindex, nofollow, nocache">
<meta name="theme-color" content="#0b120d">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/css/tokens.css">
<style>${STYLES}</style>
</head>
<body class="admin-body">
<div class="admin-shell">
  <header class="admin-header">
    <a class="brand" href="/">Legal-Leaf Market</a>
    <span class="admin-pill">Admin mode</span>
    <nav style="display:flex;gap:12px;font-size:0.72rem;font-weight:700">
      <a href="/admin/operating-model" style="color:var(--muted);text-decoration:none">Operating model</a>
      <a href="/admin/gear-avail" style="color:var(--muted);text-decoration:none">Gear Avail</a>
    </nav>
    ${admin ? '<button type="button" class="btn" id="admin-sign-out" style="margin-left:auto">Exit admin</button>' : ''}
  </header>
  <main class="admin-main">${bodyHtml}</main>
</div>
${
  admin
    ? `<script>
(function () {
  var btn = document.getElementById('admin-sign-out');
  btn.addEventListener('click', function () {
    btn.disabled = true;
    btn.textContent = 'Leaving…';
    fetch('/api/admin/session', { method: 'DELETE' })
      .catch(function () {})
      .then(function () { location.href = '/admin/sign-in'; });
  });
})();
</script>`
    : ''
}
</body>
</html>`;
}
