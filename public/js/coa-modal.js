/* ============================================================
   coa-modal.js : the COA viewer, for the satellite pages
   ------------------------------------------------------------
   The main grid opens a certificate in an overlay on the page. The satellite
   cards were shipping a plain target="_blank" link, which throws the reader out
   to a new tab and loses the grid they were working through.

   This is a port of the engine's own openCoa() and coaPdfEmbed(), which live
   inside the base64 blob. The branch order, the embed choices and the wording
   are copied rather than reinvented, so a certificate opens the same way on
   /consumables as it does on /. If the engine's version changes, change this to
   match.

   Why the branches exist, all of them learned the hard way:

     Dropbox deep link   Dropbox refuses to be iframed, so a card naming the
                         exact file beats an embed that renders a refusal page.
     Dropbox folder      A whole folder cannot be embedded at all, so say which
                         product to look for once it opens.
     store /pages/ COA   Storefront pages send X-Frame-Options, so embedding one
                         produces an empty box. Offer the link instead.
     Dropbox file        Rewrite to dl.dropboxusercontent.com with raw=1, which
                         serves the bytes rather than the viewer chrome.
     PDF                 Google's viewer fetches server side and returns HTML,
                         which embeds where a cross-origin PDF often will not.
                         pdf.js is the fallback, and a plain link under both.

   The overlay markup is created once and reused, so a page with 1200 cards does
   not carry 1200 hidden modals.
   ============================================================ */
(function () {
  "use strict";

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var ov = null;
  function overlay() {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.className = 'llcoa-ov';
    ov.innerHTML = '<div class="llcoa-modal"></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
    return ov;
  }
  function close() { if (ov) ov.classList.remove('open'); }

  function pdfEmbed(url) {
    var gv = 'https://docs.google.com/viewer?embedded=true&url=' + encodeURIComponent(url);
    var pj = 'https://mozilla.github.io/pdf.js/web/viewer.html?file=' + encodeURIComponent(url);
    return '<iframe class="llcoa-frame" src="' + esc(gv) + '" loading="lazy" '
      + 'onerror="this.src=\'' + esc(pj) + '\'"></iframe>'
      + '<div class="llcoa-hint">Loading the COA. If it does not appear, '
      + '<a href="' + esc(url) + '" target="_blank" rel="noopener">open it in a new tab</a>.</div>';
  }

  function open(p) {
    var m = overlay(), box = m.querySelector('.llcoa-modal');
    var coa = (p && p.coa) || '';
    var hasReal = !!coa;
    var url = coa || (p && p.url) || '';
    if (!url) return;

    var isPdf = /\.pdf(\?|$)/i.test(url);
    var isImg = /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url);
    var isDrive = /drive\.google\.com|docs\.google\.com/i.test(url);
    var isDbxPreview = /dropbox\.com\/scl\/fo\//i.test(url) && /[?&]preview=/i.test(url);
    var isDropboxFolder = (/dropbox\.com\/scl\/fo\//i.test(url) || /dropbox\.com\/sh\//i.test(url)) && !isDbxPreview;
    var isDropboxFile = /dropbox\.com\/scl\/fi\//i.test(url) || (/dropbox\.com\//i.test(url) && /\.(pdf|png|jpe?g)/i.test(url));
    var isCoaPage = /\/pages?\//i.test(url) && !/\.(pdf|png|jpe?g|webp)/i.test(url);

    var embed;
    if (isDbxPreview) {
      var fname = decodeURIComponent((url.match(/[?&]preview=([^&]+)/) || [])[1] || '').replace(/\.pdf.*$/i, '');
      embed = '<div class="llcoa-miss">The Certificate of Analysis for <b>' + esc(p.name) + '</b> is ready.'
        + (fname ? '<br/><span class="llcoa-file">File: ' + esc(fname) + '</span>' : '')
        + '<br/><br/>Open it below to view the lab report in Dropbox.</div>';
    } else if (isDropboxFolder || isCoaPage) {
      var where = isDropboxFolder ? 'a shared Dropbox folder' : 'its Certificate of Analysis page';
      embed = '<div class="llcoa-miss">' + esc(p.store) + ' keeps its Certificates of Analysis on ' + where
        + ', organised by product.<br/><br/>Open it below and find <b>' + esc(p.name) + '</b>.</div>';
    } else if (isDropboxFile) {
      var draw = url.replace(/([?&])dl=0/, '$1raw=1').replace(/www\.dropbox\.com/, 'dl.dropboxusercontent.com');
      embed = /\.pdf/i.test(draw) ? pdfEmbed(draw)
        : '<img class="llcoa-img" src="' + esc(draw) + '" alt="COA" referrerpolicy="no-referrer"/>';
    } else if (isImg) {
      embed = '<img class="llcoa-img" src="' + esc(url) + '" alt="COA for ' + esc(p.name) + '" referrerpolicy="no-referrer"/>';
    } else if (isDrive) {
      var pv = url.replace(/\/view.*$/, '/preview').replace(/\/edit.*$/, '/preview');
      embed = '<iframe class="llcoa-frame" src="' + esc(pv) + '" loading="lazy"></iframe>';
    } else if (isPdf) {
      embed = pdfEmbed(url);
    } else {
      embed = '<div class="llcoa-miss">We could not embed this store’s COA here. '
        + 'It is on the product page, which you can open below.</div>';
    }

    var linkTxt = isDbxPreview ? 'View this COA in Dropbox'
      : isDropboxFolder ? 'Browse the COA folder on Dropbox'
      : isCoaPage ? 'Open the COA page'
      : hasReal ? 'Open the COA full size'
      : 'Open the product page';

    box.innerHTML =
      '<div class="llcoa-head"><div><div class="llcoa-title">Certificate of Analysis</div>'
      + '<div class="llcoa-sub">' + esc(p.name) + ' · ' + esc(p.store || '') + '</div></div>'
      + '<button class="llcoa-x" type="button" data-close aria-label="Close">×</button></div>'
      + '<div class="llcoa-wrap">' + embed + '</div>'
      + '<div class="llcoa-foot">'
      + '<a class="llcoa-open" href="' + esc(url) + '" target="_blank" rel="noopener nofollow">' + linkTxt + ' ↗</a>'
      + '<button class="llcoa-close" type="button" data-close>Close</button></div>';

    box.querySelectorAll('[data-close]').forEach(function (b) { b.onclick = close; });
    m.classList.add('open');
  }

  window.LL_COA = { open: open, close: close };
})();
