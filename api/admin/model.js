// api/admin/model.js — /admin/operating-model, the gated page.
//
// Checks the session cookie server-side before a single byte of the model
// goes out; an unauthenticated request gets nothing but a redirect, not a
// page that merely hides the numbers with CSS. Never cached.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { isAdmin } from './_gate.js';
import { renderShell } from './_page-shell.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENGINE_JS = readFileSync(join(__dirname, '_client-engine.js'), 'utf8');
const APP_JS = readFileSync(join(__dirname, '_client-app.js'), 'utf8');

// Defensive: a literal "</script" inside either file would truncate the tag
// early if it were ever introduced by a future edit.
const escapeForInlineScript = (src) => src.replace(/<\/script/gi, '<\\/script');

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (!isAdmin(req)) {
    res.statusCode = 302;
    res.setHeader('Location', `/admin/sign-in?redirect=${encodeURIComponent('/admin/operating-model')}`);
    return res.end();
  }

  const body = `<div id="app"><p style="color:var(--muted);font-size:0.85rem">Loading the operating model&hellip;</p></div>
<script>${escapeForInlineScript(ENGINE_JS)}</script>
<script>${escapeForInlineScript(APP_JS)}</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(renderShell({ title: 'Operating model', admin: true, bodyHtml: body }));
}
