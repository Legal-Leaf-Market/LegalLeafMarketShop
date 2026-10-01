/* public/js/arcade-play.js — the player. Renders the wall, opens one cabinet.
 *
 * IDENTICAL ON EVERY SITE. It knows nothing about Legal-Leaf: the palette
 * comes from whichever tokens.css the host page loaded, and the catalogue
 * comes from arcade-games.js. Copy it unchanged.
 */
(function () {
  "use strict";
  var A = window.LL_ARCADE;
  if (!A) return;

  var $ = function (s) { return document.querySelector(s); };
  var esc = function (v) {
    return String(v == null ? "" : v).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  /* ?all=1 shows the unlisted cabinets too -- how the owner looks at a game
     before it is public, without it being public. */
  var showAll = /(?:^|[?&])all=1(?:&|$)/.test(location.search);
  var wall = $("#arWall"), play = $("#arPlay"), stage = $("#arStage");
  var stop = null;

  function render() {
    var list = showAll ? A.games : A.visible(false);
    if (!list.length) {
      wall.innerHTML = '<p class="ar-note">The arcade is empty right now.</p>';
      return;
    }
    wall.innerHTML = list.map(function (g, i) {
      var ready = A.installed(g);
      return '<button class="ar-cab" type="button" data-game="' + esc(g.id) + '"' +
        (ready ? "" : " disabled") + '>' +
        '<span class="ar-screen">' +
          (g.cover ? '<img src="' + esc(g.cover) + '" alt=""/>'
                   : '<span class="ar-glyph" aria-hidden="true">' + esc(g.title.charAt(0)) + '</span>') +
          '<span class="ar-slot">' + (i < 9 ? "0" : "") + (i + 1) + '</span>' +
          (ready ? "" : '<span class="ar-soon">SOON</span>') +
        '</span>' +
        '<span class="ar-meta">' +
          '<h2>' + esc(g.title) + '</h2>' +
          '<span class="ar-by">' + esc(g.by) + '</span>' +
          '<span class="ar-blurb">' + esc(g.blurb) + '</span>' +
          (g.weight ? '<span class="ar-weight">' + esc(g.weight) + '</span>' : "") +
        '</span>' +
      '</button>';
    }).join("");
  }

  function close() {
    /* The built-in returns its own teardown. Without calling it the loop runs
       forever behind a hidden panel, which on a phone is a battery drain
       nobody would ever attribute to this file. */
    if (typeof stop === "function") { try { stop(); } catch (e) {} }
    stop = null;
    stage.innerHTML = "";
    play.hidden = true;
  }

  function open(id) {
    var g = A.byId(id);
    if (!g || !A.installed(g)) return;
    close();
    $("#arTitle").textContent = g.title;
    $("#arBy").textContent = g.by ? "by " + g.by : "";
    play.hidden = false;

    if (g.builtin && id === "invaders" && window.LL_invaders) {
      stop = window.LL_invaders(stage);
    } else if (g.embed) {
      /* AN IFRAME, ALWAYS, AND NOT ONLY FOR TIDINESS. A threaded Godot export
         needs COOP/COEP on its own path, and those headers block every
         cross-origin image on whatever document carries them -- every product
         photo on this site. The frame is the boundary that keeps them off the
         parent page. See the trap note in arcade-games.js. */
      var f = document.createElement("iframe");
      f.src = g.embed;
      f.title = g.title;
      f.allow = "autoplay; fullscreen; gamepad";
      f.setAttribute("loading", "eager");
      stage.appendChild(f);
      stop = function () { f.src = "about:blank"; };
    }
    play.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  wall.addEventListener("click", function (e) {
    var b = e.target.closest("[data-game]");
    if (b && !b.disabled) open(b.dataset.game);
  });
  $("#arClose").addEventListener("click", close);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !play.hidden) close(); });

  render();
})();
