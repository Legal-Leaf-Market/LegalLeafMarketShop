/* public/js/arcade-invaders.js — the house cabinet.
 *
 * WHY A BUILT-IN GAME EXISTS AT ALL. An arcade whose only cabinets are 20MB
 * Godot downloads is an arcade nobody plays on a phone on a bus. This one is a
 * few kilobytes of canvas, starts instantly, and needs no headers, no WASM and
 * no build step -- so /arcade is never empty, and the shell has something real
 * to be tested against.
 *
 * It draws with the SITE'S OWN TOKENS read off the document, so it wears
 * Legal-Leaf's cold blue here and Nicotia's amber there with no per-site
 * branch. Same contract as the rest of the arcade.
 *
 * DELIBERATELY SMALL IN SCOPE: no sound, no highscore server, no sprites to
 * load. Everything is drawn. That is what keeps it portable and what keeps it
 * from becoming a project.
 */
(function () {
  "use strict";

  function tok(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) || fallback;
  }

  window.LL_invaders = function mount(host) {
    var C = {
      bg: tok("--bg", "#080f14"),
      ink: tok("--text", "#eaf2f6"),
      accent: tok("--leaf", "#4ec9ff"),
      gold: tok("--gold", "#f0b93c"),
      red: tok("--red", "#ef5350"),
      dim: tok("--dim", "#7d94a2"),
      line: tok("--line", "#22303a"),
    };

    var W = 480, H = 360;
    var wrap = document.createElement("div");
    wrap.className = "ar-canvaswrap";
    var cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cv.setAttribute("tabindex", "0");
    cv.setAttribute("role", "application");
    cv.setAttribute("aria-label", "Shelf Invaders. Arrow keys or drag to move, space or tap to fire.");
    wrap.appendChild(cv);
    var hint = document.createElement("p");
    hint.className = "ar-hint";
    hint.textContent = "← → move  ·  SPACE fire  ·  or drag and tap on a phone";
    wrap.appendChild(hint);
    host.innerHTML = "";
    host.appendChild(wrap);

    var ctx = cv.getContext("2d");
    var raf = 0, over = false, won = false, score = 0, best = 0;
    try { best = parseInt(localStorage.getItem("ll_arcade_invaders") || "0", 10) || 0; } catch (e) { best = 0; }

    var ship, rows, shots, bombs, dir, step, tick;

    function reset() {
      ship = { x: W / 2, y: H - 26, w: 26, h: 10, cool: 0 };
      rows = [];
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < 8; c++) {
          rows.push({ x: 46 + c * 48, y: 44 + r * 30, w: 22, h: 15, alive: true, r: r });
        }
      }
      shots = []; bombs = []; dir = 1; step = 0; tick = 0;
      over = false; won = false; score = 0;
    }
    reset();

    /* --- input. Keyboard and touch, because half of this site's traffic is a
           phone and a keyboard-only game there is a dead cabinet. --- */
    var held = {};
    function key(e, down) {
      var k = e.key;
      if (k === "ArrowLeft" || k === "ArrowRight" || k === " " || k === "Spacebar") {
        held[k === "Spacebar" ? " " : k] = down;
        e.preventDefault();
      }
      if (down && (over || won) && (k === "Enter" || k === " " || k === "Spacebar")) reset();
    }
    cv.addEventListener("keydown", function (e) { key(e, true); });
    cv.addEventListener("keyup", function (e) { key(e, false); });
    cv.addEventListener("pointerdown", function (e) {
      cv.focus();
      if (over || won) { reset(); return; }
      var r = cv.getBoundingClientRect();
      ship.x = (e.clientX - r.left) * (W / r.width);
      fire();
    });
    cv.addEventListener("pointermove", function (e) {
      if (e.buttons !== 1) return;
      var r = cv.getBoundingClientRect();
      ship.x = (e.clientX - r.left) * (W / r.width);
      e.preventDefault();
    });

    function fire() {
      if (ship.cool > 0 || over || won) return;
      shots.push({ x: ship.x, y: ship.y - 8 });
      ship.cool = 14;
    }

    function alive() { var n = 0; for (var i = 0; i < rows.length; i++) if (rows[i].alive) n++; return n; }

    function update() {
      tick++;
      if (ship.cool > 0) ship.cool--;
      if (over || won) return;

      if (held.ArrowLeft) ship.x -= 4;
      if (held.ArrowRight) ship.x += 4;
      if (held[" "]) fire();
      ship.x = Math.max(16, Math.min(W - 16, ship.x));

      /* The wall steps sideways and drops -- the pace rises as it thins, which
         is the whole tension of the original. */
      var left = alive();
      var every = Math.max(6, 34 - (32 - left));
      if (tick % every === 0) {
        step++;
        var hitEdge = false;
        for (var i = 0; i < rows.length; i++) {
          if (!rows[i].alive) continue;
          rows[i].x += dir * 9;
          if (rows[i].x < 22 || rows[i].x > W - 22) hitEdge = true;
        }
        if (hitEdge) {
          dir *= -1;
          for (var j = 0; j < rows.length; j++) if (rows[j].alive) rows[j].y += 14;
        }
        /* One bomb per step from a random surviving column. */
        var live = rows.filter(function (b) { return b.alive; });
        if (live.length) {
          var b = live[(step * 7919) % live.length];
          bombs.push({ x: b.x, y: b.y + 10 });
        }
      }

      for (var s = shots.length - 1; s >= 0; s--) {
        shots[s].y -= 7;
        if (shots[s].y < 0) { shots.splice(s, 1); continue; }
        for (var k = 0; k < rows.length; k++) {
          var t = rows[k];
          if (!t.alive) continue;
          if (Math.abs(shots[s].x - t.x) < t.w / 2 && Math.abs(shots[s].y - t.y) < t.h / 2) {
            t.alive = false; shots.splice(s, 1);
            score += (4 - t.r) * 10;
            break;
          }
        }
      }

      for (var m = bombs.length - 1; m >= 0; m--) {
        bombs[m].y += 3.4;
        if (bombs[m].y > H) { bombs.splice(m, 1); continue; }
        if (Math.abs(bombs[m].x - ship.x) < 16 && Math.abs(bombs[m].y - ship.y) < 10) { over = true; }
      }
      for (var q = 0; q < rows.length; q++) if (rows[q].alive && rows[q].y > H - 48) over = true;
      if (!alive()) won = true;

      if ((over || won) && score > best) {
        best = score;
        try { localStorage.setItem("ll_arcade_invaders", String(best)); } catch (e) {}
      }
    }

    function draw() {
      ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = C.gold; ctx.fillText("SCORE " + String(score).padStart(5, "0"), 10, 16);
      ctx.textAlign = "right";
      ctx.fillStyle = C.dim; ctx.fillText("BEST " + String(best).padStart(5, "0"), W - 10, 16);
      ctx.strokeStyle = C.line; ctx.beginPath(); ctx.moveTo(0, 24); ctx.lineTo(W, 24); ctx.stroke();

      for (var i = 0; i < rows.length; i++) {
        var t = rows[i];
        if (!t.alive) continue;
        ctx.fillStyle = t.r === 0 ? C.red : t.r === 1 ? C.gold : C.accent;
        /* A blocky glyph rather than a sprite: two lobes and a body, which at
           this size reads as the thing everybody already pictures. */
        ctx.fillRect(t.x - 9, t.y - 5, 18, 8);
        ctx.fillRect(t.x - 11, t.y - 1, 4, 5);
        ctx.fillRect(t.x + 7, t.y - 1, 4, 5);
        ctx.fillRect(t.x - 5, t.y + 3, 3, 3);
        ctx.fillRect(t.x + 2, t.y + 3, 3, 3);
      }

      ctx.fillStyle = C.accent;
      ctx.fillRect(ship.x - 13, ship.y, 26, 6);
      ctx.fillRect(ship.x - 3, ship.y - 6, 6, 6);

      ctx.fillStyle = C.ink;
      for (var s = 0; s < shots.length; s++) ctx.fillRect(shots[s].x - 1, shots[s].y, 2, 7);
      ctx.fillStyle = C.red;
      for (var m = 0; m < bombs.length; m++) ctx.fillRect(bombs[m].x - 1, bombs[m].y, 2, 6);

      if (over || won) {
        ctx.fillStyle = "rgba(3,8,12,.82)";
        ctx.fillRect(0, H / 2 - 42, W, 84);
        ctx.textAlign = "center";
        ctx.fillStyle = won ? C.accent : C.red;
        ctx.font = "16px ui-monospace, monospace";
        ctx.fillText(won ? "SHELF CLEARED" : "GAME OVER", W / 2, H / 2 - 8);
        ctx.fillStyle = C.dim;
        ctx.font = "10px ui-monospace, monospace";
        ctx.fillText("press SPACE or tap to play again", W / 2, H / 2 + 16);
      }
    }

    function loop() { update(); draw(); raf = requestAnimationFrame(loop); }
    loop();
    setTimeout(function () { try { cv.focus({ preventScroll: true }); } catch (e) {} }, 30);

    /* The player calls this when the cabinet is closed. Without it the loop
       runs forever behind a hidden panel, which on a phone is a battery bug
       nobody would ever attribute to this file. */
    return function stop() { cancelAnimationFrame(raf); host.innerHTML = ""; };
  };
})();
