/* public/js/promo.js -- the house coupon banner, at the top of every shopping page.
 *
 * Names only stores that actually accept the code (see api/promo.js, which reads
 * the registry), so it can never advertise a discount a checkout refuses. If the
 * answer is empty or the request fails, nothing is drawn: no dead banner.
 *
 * STANDS DOWN ON A CITY PAGE. Those are generated from index.html and carry this
 * file with them, but they list Michigan dispensaries, where an online hemp code
 * means nothing. window.LL_TOWN is what makes a page a town (CLAUDE.md, rails).
 */
(function () {
  'use strict';
  if (window.LL_TOWN) return;
  var KEY = 'll_promo_x';

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  fetch('/api/promo', { headers: { accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (window.LL_TOWN) return;   // set later in the document on a city page
      if (!d || !d.code || !d.stores || !d.stores.length) return;
      try { if (sessionStorage.getItem(KEY) === d.code) return; } catch (e) {}

      var top = d.stores.reduce(function (m, s) { return Math.max(m, s.pct || 0); }, 0);
      var list = d.stores.map(function (s) {
        return '<a href="' + esc(s.url) + '"' + (/^https?:/.test(s.url) ? ' rel="sponsored noopener" target="_blank"' : '') + '>' +
          esc(s.name) + '</a>' + (s.pct && s.pct !== top ? ' (' + s.pct + '%)' : '');
      }).join(', ');

      var st = document.createElement('style');
      st.textContent =
        '.ll-promo{position:relative;z-index:60;background:linear-gradient(90deg,#1787c4,#4ec9ff 55%,#f0b93c);color:#04121b;' +
          'font:600 14px/1.4 Jost,system-ui,sans-serif;text-align:center;padding:9px 44px 9px 14px}' +
        '.ll-promo b.code{font-weight:800;letter-spacing:.06em;background:rgba(4,18,27,.12);padding:1px 7px;border-radius:6px}' +
        '.ll-promo a{color:#04121b;text-decoration:underline;text-underline-offset:2px}' +
        '.ll-promo .stores{display:block;font-weight:500;font-size:13px;opacity:.9}' +
        '.ll-promo button.copy{margin-left:8px;border:1.5px solid #04121b;background:transparent;color:#04121b;border-radius:999px;' +
          'font:700 12px/1 Jost,system-ui,sans-serif;padding:5px 11px;cursor:pointer}' +
        '.ll-promo button.copy:hover{background:#04121b;color:#4ec9ff}' +
        '.ll-promo .x{position:absolute;right:10px;top:50%;transform:translateY(-50%);border:0;background:none;color:#04121b;font-size:20px;cursor:pointer;line-height:1}';
      document.head.appendChild(st);

      var bar = document.createElement('div');
      bar.className = 'll-promo'; bar.setAttribute('role', 'region'); bar.setAttribute('aria-label', 'Coupon code');
      bar.innerHTML = 'Code <b class="code">' + esc(d.code) + '</b> saves up to ' + top + '%' +
        '<button class="copy" type="button">Copy code</button>' +
        '<span class="stores">at ' + list + '</span>' +
        '<button class="x" type="button" aria-label="Dismiss">&times;</button>';
      bar.querySelector('.copy').onclick = function () {
        var b = this;
        try { navigator.clipboard.writeText(d.code); b.textContent = 'Copied'; } catch (e) { b.textContent = d.code; }
      };
      bar.querySelector('.x').onclick = function () { try { sessionStorage.setItem(KEY, d.code); } catch (e) {} bar.remove(); };
      var mount = function () { document.body.insertBefore(bar, document.body.firstChild); };
      if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
    })
    .catch(function () {});
})();
