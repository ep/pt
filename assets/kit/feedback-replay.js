/* ExperiencePoint feedback kit: the board's side. feedback.js loads this only when the
   feedback board (feedback/ in pt) rebuilds one of a tool's screens in a sandboxed
   frame, or asks the tool for its sections. It opens the screen with made-up content
   through the tool's restore hook, finds the part of the page each comment points at,
   scrolls it into view the way the tester had it, and tells the board where it is, so
   the board can outline that part instead of a spot that may have moved. How to use
   the kit is in feedback.js's header. */
(function () {
"use strict";
var K = window.EPKit = window.EPKit || {}, R = window.EPKitReplay, doc = document, win = window;
if (!R || typeof R !== "object" || K.replayRan) return;
K.replayRan = true;

function send(o) { try { win.parent.postMessage(o, "*"); } catch (e) {} }
function str(v) { return v == null ? "" : String(v); }
function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
function num(v) { v = +v; return isFinite(v) ? v : 0; }

/* ---------- finding the part of the page a comment is about ---------- */
function fieldName(n) {
  var id = n.id, l = null;
  try { l = id && doc.querySelector('label[for="' + (win.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); } catch (e) {}
  return clip(n.getAttribute("aria-label") || (l && l.textContent) || n.getAttribute("placeholder") || n.name || n.id || "a field", 60);
}
/* The same words the comment kit recorded for a part, so the two can be compared. */
function textOf(n) {
  if (n.closest && n.closest("[data-feedback-private]")) return "";
  var tag = n.tagName.toLowerCase();
  if (/^(input|textarea|select)$/.test(tag)) return "the field " + fieldName(n);
  if (n.isContentEditable) return "an editable area";
  return clip(n.getAttribute("aria-label") || n.getAttribute("alt") || n.getAttribute("title") || n.innerText || n.textContent || "", 80);
}
/* On the page and taking up space. A part that is still fading in counts: screens
   often draw their lines in one by one. */
function shown(n) {
  if (!n || !n.getBoundingClientRect || (n.closest && n.closest("[data-epkit]"))) return false;
  var r = n.getBoundingClientRect();
  if (!(r.width > 0 && r.height > 0)) return false;
  try { if (win.getComputedStyle(n).visibility === "hidden") return false; } catch (e) {}
  return true;
}
function all(sel) { if (!sel) return []; try { return Array.prototype.slice.call(doc.querySelectorAll(sel)).filter(shown); } catch (e) { return []; } }
/* A path the comment kit wrote, "main#stage > section.scene > div.frame > p.quiet",
   without the classes, which often change as a screen animates. */
function loose(path) { return str(path).split(" > ").map(function (p) { return p.indexOf("#") > -1 ? p.replace(/\.[^#]*$/, "") : p.replace(/\..*$/, ""); }).join(" > "); }
function centre(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
function nearest(list, t) {
  var cx = num(t.x) + num(t.w) / 2, cy = num(t.y) + num(t.h) / 2, best = null, bd = Infinity;
  list.forEach(function (n) { var c = centre(n.getBoundingClientRect()), d = (c.x - cx) * (c.x - cx) + (c.y - cy) * (c.y - cy); if (d < bd) { bd = d; best = n; } });
  return best;
}
/* Finds a comment's part in the rebuilt screen. The exact place the kit recorded comes
   first; then the looser path, preferring the same words (buttons and headings keep
   their words, while made-up content changes the rest); then whatever of the same kind
   sits nearest the spot the tester pointed at. Older comments have only the path. */
function find(t) {
  if (!t || t.whole) return null;
  var tag = str(t.tag).toLowerCase(), want = str(t.text);
  var exact = all(t.sel).filter(function (n) { return !tag || n.tagName.toLowerCase() === tag; });
  if (exact.length === 1 && (!want || textOf(exact[0]) === want)) return exact[0];
  var pool = all(t.path);
  if (!pool.length) pool = all(loose(t.path));
  /* Wider searches: the last step alone when it names a class or id, and anything of
     the same kind, but only when its words match exactly. */
  var last = str(t.path).split(" > ").pop(), tail = /[.#]/.test(last) ? all(last) : [];
  var kind = /^[a-z][a-z0-9-]*$/.test(tag) && tag !== "page" ? all(tag).slice(0, 600) : [];
  if (want) {
    var same = exact.concat(pool, tail, kind).filter(function (n, i, a) { return a.indexOf(n) === i && textOf(n) === want; });
    if (same.length) return nearest(same, t);
  }
  if (exact.length === 1) return exact[0];
  /* A comment that knows its exact place waits for it rather than guessing; only older
     comments, which have just the path, fall back to the nearest part of the same kind. */
  if (t.sel) return null;
  if (pool.length) return nearest(pool, t);
  return tail.length ? nearest(tail, t) : null;
}
/* The nearest ancestor that scrolls, if the screen scrolls inside itself. */
function scroller(n) {
  for (var p = n && n.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    try { var s = win.getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p; } catch (e) { return null; }
  }
  return null;
}
function rectOf(n) { var r = n.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; }

var targets = [], focus = "", found = {}, moved = [], placed = false;
/* Scrolling done for one comment is undone before the next, so a part that can't be
   found is shown where the tester's own scroll would put it. */
function unscroll() {
  moved.forEach(function (m) { try { m.el.scrollTop = m.top; } catch (e) {} });
  moved = [];
}
function nudge(n, top) { if (!n) return; moved.push({ el: n, top: n.scrollTop }); n.scrollTop = top; }
/* Scroll the way the tester had it, then make sure the part is in view. */
function bring(ft, el) {
  var sc = scroller(el);
  if (sc && ft.sy != null) nudge(sc, num(ft.sy));
  else if (!sc) win.scrollTo(0, ft.sy != null ? num(ft.sy) : num(R.scroll));
  var r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > win.innerHeight || r.left < 0 || r.right > win.innerWidth) {
    for (var p = el.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 1) moved.push({ el: p, top: p.scrollTop });
    el.scrollIntoView({ block: "center", inline: "nearest" });
  }
  placed = true;
}
function focusTarget() { var ft = null; targets.forEach(function (t) { if (t && t.id === focus) ft = t; }); return ft; }
function locate(list, f) {
  unscroll();
  targets = Array.isArray(list) ? list.slice(0, 200) : []; focus = str(f); found = {}; placed = false;
  targets.forEach(function (t) { if (t && t.id) found[t.id] = find(t); });
  var ft = focusTarget(), el = ft && found[focus];
  try { if (el) bring(ft, el); else win.scrollTo(0, num(R.scroll)); } catch (e) {}
  report();
}
/* Says where each part is now, looking again for any not found yet, since some only
   appear as the screen finishes drawing. */
function report() {
  targets.forEach(function (t) {
    if (!t || !t.id) return;
    var n = found[t.id];
    if (!n || !n.isConnected || !shown(n)) found[t.id] = find(t);
  });
  var ft = focusTarget();
  if (ft && found[focus] && !placed) { try { bring(ft, found[focus]); } catch (e) {} }
  var rects = {};
  Object.keys(found).forEach(function (id) { var n = found[id]; rects[id] = n && n.isConnected && shown(n) ? rectOf(n) : null; });
  send({ type: "epkit-rects", focus: focus, rects: rects, found: !!(focus && rects[focus]) });
}

/* ---------- opening the screen ---------- */
var answered = false;
function tell(ok) {
  if (!answered) send({ type: "epkit-replay", ok: !!ok, w: win.innerWidth, h: win.innerHeight });
  answered = true;
}
function go() {
  var s = null;
  try { s = K.tool && K.tool.sections; s = typeof s === "function" ? s() : s; } catch (e) { s = null; }
  send({ type: "epkit-map", sections: Array.isArray(s) ? s : null });
  if (R.map) return;
  var ok = false;
  try { var t = K.tool; if (t && typeof t.restore === "function") ok = t.restore({ screen: str(R.screen), settings: R.settings || {} }) !== false; } catch (e) { ok = false; }
  /* Give the screen a moment to draw and settle, then find the parts, and look again
     as late fonts and entrances finish. */
  setTimeout(function () {
    locate(R.targets, R.focus);
    tell(ok);
    [700, 1800, 3200].forEach(function (ms) { setTimeout(report, ms); });
  }, 600);
}
win.addEventListener("message", function (e) {
  var d = e.data;
  if (e.source !== win.parent || !d || typeof d !== "object" || d.type !== "epkit-locate") return;
  locate(d.targets, d.focus);
  [400, 1500].forEach(function (ms) { setTimeout(report, ms); });
});
if (doc.readyState === "complete") setTimeout(go, 50); else win.addEventListener("load", function () { setTimeout(go, 50); });
setTimeout(function () { tell(false); }, 8000);
})();
