// api/admin/gear.js — /admin/gear-avail, the gated Gear Avail model page.
//
// Mirrors model.js exactly: check the session cookie server-side before any
// content goes out, never cache, inline the engine + app scripts so nothing
// here is ever reachable as a standalone static file.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAdmin } from './_gate.js';
import { renderShell } from './_page-shell.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = readFileSync(join(__dirname, '_client-engine-gear.js'), 'utf8');
const APP_JS = readFileSync(join(__dirname, '_client-app-gear.js'), 'utf8');

const escapeForInlineScript = (src) => src.replace(/<\/script/gi, '<\\/script');

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAdmin(req)) {
    res.statusCode = 302;
    res.setHeader('Location', `/admin/sign-in?redirect=${encodeURIComponent('/admin/gear-avail')}`);
    return res.end();
  }

  const body = `<div id="app"><p style="color:var(--muted);font-size:0.85rem">Loading the Gear Avail model&hellip;</p></div>
<script>${escapeForInlineScript(ENGINE_JS)}</script>
<script>${escapeForInlineScript(APP_JS)}</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(renderShell({ title: 'Gear Avail', admin: true, bodyHtml: body }));
}
