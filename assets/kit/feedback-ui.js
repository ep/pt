/* ExperiencePoint feedback kit: the bar and comments. feedback.js loads this only
   in feedback mode; how to use the kit is in feedback.js's header. */
(function () {
"use strict";
var K = window.EPKit = window.EPKit || {};
var FB = K.feedback;
if (!FB || !FB.on || FB.ui) return;
var doc = document, win = window;
var API = K.api || "https://pt.armand-khambatta.workers.dev";
var MINE = "ep-feedback-mine", NAME = "ep-feedback-name", COACH = "ep-feedback-coach", DRAFT = "ep-feedback-draft";
var HOLD_MS = 3000;

/* ---------- helpers ---------- */
function str(v) { return v == null ? "" : String(v); }
function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, fn) { var b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
function ls(fn) { try { return fn(win.localStorage); } catch (e) { return null; } }
function ss(fn) { try { return fn(win.sessionStorage); } catch (e) { return null; } }
function mq(q) { try { return win.matchMedia(q).matches; } catch (e) { return false; } }
function touch() { return mq("(pointer: coarse)"); }
function calm() { return mq("(prefers-reduced-motion: reduce)"); }
function verb() { return touch() ? "Tap" : "Click"; }
function pad(x) { return (x < 10 ? "0" : "") + x; }
function hm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function randFrom(abc, n) {
  var o = "", r = new Uint8Array(n);
  try { crypto.getRandomValues(r); } catch (e) { for (var j = 0; j < n; j++) r[j] = Math.floor(Math.random() * 256); }
  for (var i = 0; i < n; i++) o += abc.charAt(r[i] % abc.length);
  return o;
}
function scrub(s) { return K.scrub ? K.scrub(s) : str(s); }
function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
var raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : function (f) { return setTimeout(f, 16); };
function svg(d, w) {
  var ns = "http://www.w3.org/2000/svg", s = doc.createElementNS(ns, "svg"), p = doc.createElementNS(ns, "path");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", w || "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  p.setAttribute("d", d); s.appendChild(p);
  return s;
}
var BUBBLE = "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z", TICK = "M5 12.5l4.2 4.2L19 7";

/* ---------- what the tool says about itself ---------- */
function T() { return K.tool || {}; }
function hook(name) { try { var v = T()[name]; return typeof v === "function" ? v() : v; } catch (e) { return undefined; } }
function toolId() {
  var id = str(T().id).toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (id) return id.slice(0, 40);
  var p = location.pathname.replace(/\/index\.html?$/i, "").replace(/\/+$/, "").split("/").pop() || "page";
  return (p.replace(/\.html?$/i, "").toLowerCase().replace(/[^a-z0-9-]/g, "-") || "page").slice(0, 40);
}
function toolName() { return clip(T().name || doc.title || toolId(), 80); }
function screenId() { return clip(scrub(hook("screen")), 80); }
/* The name of the part of the tool a screen belongs to, if the tool says. */
function sectionName(id) {
  var list = hook("sections");
  if (!Array.isArray(list) || !id) return "";
  for (var i = 0; i < list.length; i++) { var s = list[i]; if (s && Array.isArray(s.screens) && s.screens.indexOf(id) > -1) return clip(scrub(s.name), 80); }
  return "";
}
function cleanUrl(href) {
  try {
    var u = new URL(href), keep = T().safeParams || [], parts = [];
    u.searchParams.forEach(function (v, k) {
      if (k === "feedback") parts.push("feedback");
      else parts.push(keep.indexOf(k) > -1 ? (v ? k + "=" + v : k) : k + "=[removed]");
    });
    var base = u.protocol === "file:" ? "a file on the tester's computer: " + decodeURIComponent(u.pathname.split("/").pop()) : u.protocol + "//" + u.host + u.pathname;
    return base + (parts.length ? "?" + parts.join("&") : "") + (u.hash && u.hash !== "#" ? "#[removed]" : "");
  } catch (e) { return location.pathname; }
}
function heading() {
  var hs = doc.querySelectorAll("h1,h2,h3,[role=heading]");
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i]; if (h.closest("[data-epkit]") || h.closest("[data-feedback-private]")) continue;
    var r = h.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < win.innerHeight) return clip(h.getAttribute("aria-label") || h.innerText || h.textContent, 120);
  }
  return "";
}
function device() {
  var ua = navigator.userAgent || "", b = "a browser", os = "an unknown system", m;
  if ((m = /Edg\/(\d+)/.exec(ua))) b = "Edge " + m[1];
  else if ((m = /OPR\/(\d+)/.exec(ua))) b = "Opera " + m[1];
  else if ((m = /(?:Chrome|CriOS)\/(\d+)/.exec(ua))) b = "Chrome " + m[1];
  else if ((m = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua))) b = "Firefox " + m[1];
  else if ((m = /Version\/(\d+(?:\.\d+)?).*Safari/.exec(ua))) b = "Safari " + m[1];
  if (/iPhone|iPod/.test(ua)) os = "iOS";
  else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) os = "iPadOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  var dpr = Math.round((win.devicePixelRatio || 1) * 100) / 100;
  return {
    browser: b, os: os, window: win.innerWidth + "\u00d7" + win.innerHeight,
    screen: (win.screen ? win.screen.width + "\u00d7" + win.screen.height : "") + (dpr !== 1 ? " at " + dpr + "x" : ""),
    input: touch() ? "touch" : "mouse or trackpad", language: navigator.language || "",
    theme: mq("(prefers-color-scheme: dark)") ? "dark" : "light", reducedMotion: calm() ? "yes" : "no"
  };
}
function settings() {
  var s = hook("state"), o = {};
  if (s && typeof s === "object") Object.keys(s).slice(0, 16).forEach(function (k) {
    var v = s[k]; if (v == null || typeof v === "function") return;
    o[clip(k, 40)] = clip(scrub(typeof v === "object" ? JSON.stringify(v) : v), 100);
  });
  return o;
}
function context() {
  var tz = ""; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) {}
  return {
    name: toolName(), version: clip(hook("version"), 40), kit: FB.kit, page: cleanUrl(location.href),
    heading: clip(scrub(heading()), 120), section: sectionName(screenId()), settings: settings(), at: Date.now(), tz: tz,
    scroll: Math.round(win.scrollY || win.pageYOffset || 0), device: device(),
    actions: FB.actions.slice(-10).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; }),
    errors: FB.errors.slice(-6).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; })
  };
}

/* Which version of the file is open: the fingerprint Git gives the file, so the
   board can match each comment to a commit in pt's history. It reads the file from
   the address the page was opened at, so the browser can answer from the copy it is
   showing, even after a tool rewrites its own address. */
var ver = "";
(function () {
  var own = str(hook("version")) ? "tool:" + clip(hook("version"), 40) : "";
  ver = own;
  try {
    if (!/^https?:$/.test(location.protocol) || !win.crypto || !crypto.subtle || !win.fetch || !win.TextEncoder) return;
    var from = location.pathname;
    try {
      var nav = win.performance && performance.getEntriesByType && performance.getEntriesByType("navigation")[0], u = nav && nav.name ? new URL(nav.name) : null;
      if (u && u.origin === location.origin && u.pathname === location.pathname) from = u.pathname + u.search;
    } catch (e) {}
    fetch(from, { cache: "force-cache", credentials: "same-origin" }).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (buf) {
      if (!buf) return null;
      var head = new TextEncoder().encode("blob " + buf.byteLength + "\u0000"), all = new Uint8Array(head.length + buf.byteLength);
      all.set(head); all.set(new Uint8Array(buf), head.length);
      return crypto.subtle.digest("SHA-1", all);
    }).then(function (d) {
      if (d) ver = "git:" + Array.prototype.map.call(new Uint8Array(d), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }).catch(function () {});
  } catch (e) {}
})();

/* ---------- the part of the page a comment is about ---------- */
var ACTIONABLE = "button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[data-act]";
var INLINE = /^(span|b|i|em|strong|small|sup|sub|br|code|mark|abbr|svg|path|use|g|circle|rect|line|polyline|polygon|ellipse|text|tspan|img)$/i;
var STABLE = ["data-id", "data-act", "data-k", "name"];
function inKit(n) { return !!(n && n.closest && n.closest("[data-epkit]")); }
/* A short, readable path for people and AIs: "footer#bottom > button#nextBtn". */
function pathOf(n) {
  var parts = [];
  for (var i = 0; n && n.nodeType === 1 && i < 5 && n !== doc.body && n !== doc.documentElement; n = n.parentElement, i++) {
    var p = n.tagName.toLowerCase();
    if (n.id) { parts.unshift(p + "#" + n.id); if (i > 0) break; continue; }
    var cls = str(n.getAttribute("class")).split(/\s+/).filter(function (c) { return c && c.length < 32 && !/\d{4,}/.test(c); }).slice(0, 2);
    if (cls.length) p += "." + cls.join(".");
    parts.unshift(p);
  }
  return parts.join(" > ");
}
/* An exact path, so the board (and the pins here) can find the same part again:
   each step names its position among its kind, and a stable id or attribute when
   the page has one. */
function stepOf(n) {
  var tag = n.tagName.toLowerCase(), s = tag, attr = "", val = "";
  for (var i = 0; i < STABLE.length; i++) {
    var v = n.getAttribute(STABLE[i]);
    if (v && v.length < 40 && /^[\w .:-]+$/.test(v)) { attr = STABLE[i]; val = v; s += "[" + attr + '="' + v + '"]'; break; }
  }
  var p = n.parentElement, k = 0, at = 0, like = 0;
  if (!p) return s;
  for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
    if (c.tagName !== n.tagName) continue;
    k++; if (c === n) at = k;
    if (!attr || c.getAttribute(attr) === val) like++;
  }
  return like > 1 ? s + ":nth-of-type(" + at + ")" : s;
}
function selOf(n) {
  var parts = [];
  for (var i = 0; n && n.nodeType === 1 && i < 16; n = n.parentElement, i++) {
    if (n === doc.body || n === doc.documentElement) { parts.unshift(n.tagName.toLowerCase()); break; }
    if (n.id && /^[A-Za-z][\w-]*$/.test(n.id)) {
      var dup = 0; try { dup = doc.querySelectorAll("#" + n.id).length; } catch (e) { dup = 0; }
      if (dup === 1) { parts.unshift("#" + n.id); break; }
    }
    parts.unshift(stepOf(n));
  }
  var s = parts.join(" > ");
  return s.length > 600 ? "" : s;
}
function fieldName(n) {
  var id = n.id, l = null;
  try { l = id && doc.querySelector('label[for="' + (win.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); } catch (e) {}
  return clip(n.getAttribute("aria-label") || (l && l.textContent) || n.getAttribute("placeholder") || n.name || n.id || "a field", 60);
}
function textOf(n) {
  if (n.closest && n.closest("[data-feedback-private]")) return "";
  var tag = n.tagName.toLowerCase();
  if (/^(input|textarea|select)$/.test(tag)) return "the field " + fieldName(n);
  if (n.isContentEditable) return "an editable area";
  return clip(n.getAttribute("aria-label") || n.getAttribute("alt") || n.getAttribute("title") || n.innerText || n.textContent || "", 80);
}
function hitAt(x, y) {
  var list = [];
  try { list = doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : (doc.elementFromPoint ? [doc.elementFromPoint(x, y)] : []); } catch (e) { list = []; }
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    if (c && c.nodeType === 1 && c !== doc.documentElement && c !== doc.body && !inKit(c)) return c;
  }
  return null;
}
function describe(n) {
  if (!n) return { tag: "page", text: "", path: "" };
  if (n.ownerSVGElement) n = n.ownerSVGElement;
  return { tag: n.tagName.toLowerCase(), role: n.getAttribute("role") || "", text: scrub(textOf(n)), path: pathOf(n), sel: selOf(n) };
}
function fit(b) {
  var W = win.innerWidth, H = win.innerHeight, w = clamp(b.w, 8, W), h = clamp(b.h, 8, H);
  return { x: clamp(b.x, 0, W - w), y: clamp(b.y, 0, H - h), w: w, h: h };
}
function whole() { return { el: null, whole: true, rect: { x: 0, y: 0, w: win.innerWidth, h: win.innerHeight } }; }
function around(n) { var r = n.getBoundingClientRect(); return fit({ x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 }); }
/* The part a click means: the control or block under the pointer. Empty space, or a
   container nearly as big as the window, means the whole screen. */
function areaAt(x, y) {
  var n = hitAt(x, y), W = win.innerWidth, H = win.innerHeight;
  if (n) {
    var act = n.closest && n.closest(ACTIONABLE); if (act && !inKit(act)) n = act;
    if (n.ownerSVGElement) n = n.ownerSVGElement;
    for (var i = 0; i < 4 && n && n.parentElement && n.parentElement !== doc.body; i++) {
      var r0 = n.getBoundingClientRect();
      if (r0.width >= 28 && r0.height >= 18 && !INLINE.test(n.tagName)) break;
      n = n.parentElement;
    }
  }
  var r = n ? n.getBoundingClientRect() : null;
  if (!r || !r.width || !r.height || r.width * r.height > 0.85 * W * H) return whole();
  return { el: n, whole: false, rect: around(n) };
}
/* The nearest ancestor that scrolls, when a screen scrolls inside itself. */
function scroller(n) {
  for (var p = n && n.parentElement; p && p !== doc.body && p !== doc.documentElement; p = p.parentElement) {
    try { var s = win.getComputedStyle(p); if (/(auto|scroll)/.test(s.overflowY) && p.scrollHeight > p.clientHeight + 1) return p; } catch (e) { return null; }
  }
  return null;
}

/* ---------- the tester's own comments, kept in this browser ---------- */
var GONE = "ep-feedback-gone", storeOk = true, warnedFull = false;
function readList(key) { var v = ls(function (l) { return JSON.parse(l.getItem(key) || "[]"); }); return Array.isArray(v) ? v.filter(function (c) { return c && c.id; }) : []; }
var all = readList(MINE);
/* mine(): this tool's comments the tester sees (list, pins, count). queue(): everything
   still to post, including comments cleared from the list before they posted. */
function mine() { var id = toolId(); return all.filter(function (c) { return c.tool === id && !c.cleared; }); }
function queue() { var id = toolId(); return all.filter(function (c) { return c.tool === id && c.status !== "posted"; }); }
function goneIds() { var o = {}; readList(GONE).forEach(function (g) { o[g.id] = 1; }); return o; }
function markGone(id) { var g = readList(GONE).filter(function (x) { return x.id !== id; }); g.push({ id: id, at: Date.now() }); ls(function (l) { l.setItem(GONE, JSON.stringify(g.slice(-300))); }); }
/* Every tool on this site shares the browser's storage, and a tester may have two tabs
   open, so the list is merged with what is stored before every save: comment by
   comment, the newer copy wins, and nothing another tab saved is ever dropped. */
function merge() {
  var gone = goneIds(), here = {};
  all = all.filter(function (c) { return !gone[c.id]; });
  all.forEach(function (c) { here[c.id] = c; });
  readList(MINE).forEach(function (s) {
    if (gone[s.id]) return;
    var c = here[s.id];
    if (!c) { all.push(s); here[s.id] = s; return; }
    var later = (s.updated || 0) > (c.updated || 0) || ((s.updated || 0) === (c.updated || 0) && s.status === "posted" && c.status !== "posted" && !inflight[c.id]);
    if (later) for (var k in s) if (k !== "ctx" || s.ctx) c[k] = s[k];
    if (s.cleared) c.cleared = true;
  });
  all.sort(function (x, y) { return (x.created || 0) - (y.created || 0); });
}
function serial(list) { return JSON.stringify(list.map(function (c) { if (c.status !== "posted") return c; var o = {}; for (var k in c) if (k !== "ctx") o[k] = c[k]; o.heading = c.heading || (c.ctx && c.ctx.heading) || ""; return o; })); }
/* Nothing unsent is ever dropped to make room; only old posted comments are. If the
   browser's storage is full, posted ones go first; if even that fails, the tester is
   told to keep the page open, and the leave warning stays on until everything posts. */
function saveMine() {
  merge();
  var unsentN = all.filter(function (c) { return c.status !== "posted"; }).length;
  var room = Math.max(0, 300 - unsentN), seen = 0;
  for (var i = all.length - 1; i >= 0; i--) if (all[i].status === "posted" && ++seen > room) all.splice(i, 1);
  var put = function (text) { return ls(function (l) { l.setItem(MINE, text); return true; }) === true; };
  storeOk = put(serial(all)) || put(serial(all.filter(function (c) { return c.status !== "posted"; })));
  if (!storeOk && !warnedFull) { warnedFull = true; showToast("This browser's storage is full. Keep this page open until your comments post."); }
  if (storeOk) warnedFull = false;
}
function myName() { return str(ls(function (l) { return l.getItem(NAME); })).slice(0, 60); }
/* A half-written comment, kept as it is typed so a reload, a crash or a closed tab
   never loses it. id is set when it is a change to a comment already posted. */
/* One slot per tool for a new comment, and one per comment being changed, so one never
   overwrites another, across tools as well. */
function draftKey(id, tool) { return DRAFT + ":" + (tool || toolId()) + (id ? ":" + id : ""); }
/* Words kept by the first version of this kit, in a slot shared by every tool, move to
   their own tool's slot. */
(function () {
  ls(function (l) {
    var keys = [];
    for (var i = 0; i < l.length; i++) { var k = l.key(i); if (k === DRAFT || (k && k.indexOf(DRAFT + ":") === 0)) keys.push(k); }
    keys.forEach(function (k) {
      var d = null; try { d = JSON.parse(l.getItem(k) || "null"); } catch (e) { d = null; }
      if (!d || !d.tool) return;
      var want = draftKey(d.id, d.tool);
      if (k !== want) { if (!l.getItem(want)) l.setItem(want, JSON.stringify(d)); l.removeItem(k); }
    });
  });
})();
function draftGet(id) {
  var d = ls(function (l) { return JSON.parse(l.getItem(draftKey(id)) || "null"); });
  return d && d.tool === toolId() && str(d.text).trim() ? d : null;
}
function draftSet(text, id) {
  ls(function (l) {
    if (!str(text).trim()) { l.removeItem(draftKey(id)); return; }
    var t = st.target, sel = t && t.el ? selOf(t.el) : "";
    l.setItem(draftKey(id), JSON.stringify({ tool: toolId(), id: id || "", text: str(text).slice(0, 2000), screen: screenId(), sel: sel, whole: !!(t && t.whole), at: Date.now(), back: false }));
  });
}
function draftClear(id) { ls(function (l) { l.removeItem(draftKey(id)); }); }

/* ---------- talking to the pt worker ---------- */
var linkOk = null, flushing = false;
function api(path, body, keep) {
  var o = body ? { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body), keepalive: !!keep } : {};
  return fetch(API + path, o).then(function (res) {
    return res.json().catch(function () { return {}; }).then(function (d) { return { ok: res.ok && d.ok !== false, status: res.status, error: d.error || "", data: d }; });
  }, function () { return { ok: false, status: 0, error: "offline", data: {} }; });
}
function checkLink() {
  if (!FB.code) { linkOk = false; renderBar(); return Promise.resolve(false); }
  return api("/api/fb/check?code=" + encodeURIComponent(FB.code)).then(function (r) {
    if (r.status === 200) linkOk = !!(r.data && r.data.ok);
    renderBar(); return linkOk;
  });
}
/* What is sent, trimmed so the context can never stop a comment from posting. The
   words are always sent whole. */
function payload(c, bare) {
  var x = c.ctx || {}, o = {}, k, size = function () { return JSON.stringify(o).length; };
  for (k in x) o[k] = x[k];
  if (bare) o = { name: x.name, version: x.version, kit: x.kit, page: clip(x.page, 300), heading: x.heading, section: x.section, at: x.at, scroll: x.scroll };
  else {
    if (size() > 5000) { o.errors = (o.errors || []).slice(-2); o.actions = (o.actions || []).slice(-4); }
    if (size() > 5000) { delete o.errors; delete o.actions; }
    if (size() > 5000) o.settings = {};
  }
  var w = c.where || {}, wo = {};
  for (k in w) if (k !== "el") wo[k] = w[k];
  if (w.el) wo.el = { tag: clip(w.el.tag, 20), role: clip(w.el.role, 30), text: clip(w.el.text, 120), path: clip(w.el.path, bare ? 200 : 400), sel: bare ? "" : str(w.el.sel).slice(0, 600) };
  /* A change to a posted comment, after a reload, no longer has its context here: it is
     left out, and the worker keeps the one it has. updated orders the changes. */
  return { tool: c.tool, code: FB.code, id: c.id, edit: c.edit, comment: { name: c.name, text: str(c.text).slice(0, 2000), ver: c.ver, screen: c.screen, where: c.where ? wo : undefined, ctx: c.ctx ? o : undefined, updated: c.updated || 0 } };
}
/* One request per comment at a time. A change made while one is out goes as soon as it
   comes back, so the board always ends with the newest words. */
var inflight = {};
function send(c) {
  if (inflight[c.id]) { c.again = true; return inflight[c.id]; }
  var stamp = c.updated;
  c.status = "sending"; c.again = false;
  var p = api("/api/fb/post", payload(c)).then(function (r) {
    if (r.status === 400 || r.status === 413) return api("/api/fb/post", payload(c, true));
    return r;
  }).then(function (r) {
    delete inflight[c.id];
    var more = c.again || c.updated !== stamp; c.again = false;
    if (r.ok && r.data && r.data.gone) {
      all = all.filter(function (x) { return x !== c; }); markGone(c.id); draftClear(c.id);
      saveMine(); renderBar(); renderPins(); return r;
    }
    if (r.ok) { c.status = more ? "waiting" : "posted"; delete c.err; }
    else if (r.status === 401) { c.status = "waiting"; c.err = "link"; linkOk = false; }
    else if (r.status === 400 || r.status === 413) { c.status = "failed"; c.err = r.error || "rejected"; }
    else { c.status = "waiting"; c.err = r.status ? "busy" : "offline"; }
    saveMine(); renderBar(); renderPins();
    return r.ok && more ? send(c) : r;
  });
  inflight[c.id] = p;
  return p;
}
function flush(again) {
  if (flushing || linkOk === false) return Promise.resolve();
  var w = queue().filter(function (c) { return !inflight[c.id] && (c.status === "waiting" || c.status === "sending" || (again && c.status === "failed")); });
  if (!w.length) return Promise.resolve();
  flushing = true;
  return w.reduce(function (p, c) { return p.then(function () { return send(c); }); }, Promise.resolve()).then(function () { flushing = false; }, function () { flushing = false; });
}
/* Leaving the page: anything not yet posted goes out on a request that outlives it.
   It also stays here, so the next visit posts it if this one didn't land. */
var lastOut = 0;
function sendOnLeave() {
  if (linkOk === false || Date.now() - lastOut < 5000) return;
  var budget = 56000;
  queue().forEach(function (c) {
    if (c.status === "failed") return;
    var body = payload(c), n = JSON.stringify(body).length;
    if (n > budget) return;
    budget -= n; lastOut = Date.now();
    api("/api/fb/post", body, true);
  });
}
function unsent() { return queue().length; }
function posted() { var id = toolId(); return all.filter(function (c) { return c.tool === id && c.status === "posted"; }).length; }

/* ---------- the parts on screen ---------- */
var host = el("div");
host.setAttribute("data-epkit", "feedback");
host.setAttribute("data-clarity-mask", "true");
var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
var GOLD = "#F5C04A", INK = "#1B1F2A";
/* The pointer becomes a comment bubble while picking; its tip is the point. */
var CURSOR_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">' +
  '<path d="M9 2h12a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5h-9l-7.5 5.5L6 19.6A5 5 0 0 1 4 15V7a5 5 0 0 1 5-5z" fill="' + GOLD + '" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M15 7v8M11 11h8" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/></svg>';
var CURSOR = 'url("data:image/svg+xml,' + encodeURIComponent(CURSOR_SVG) + '") 4 26, crosshair';
var CSS_TEXT = [
  ":host{all:initial}",
  "*{box-sizing:border-box}",
  ".k{font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:#F2F0EA}",
  "button,input,textarea{font:inherit}",
  "button{cursor:pointer}",
  "[hidden]{display:none!important}",
  ".bar{position:fixed;z-index:2147483560;display:flex;align-items:center;gap:4px;padding:4px;border-radius:14px;background:rgba(27,31,42,.96);box-shadow:0 10px 30px rgba(0,0,0,.32),inset 0 0 0 1px rgba(255,255,255,.08)}",
  ".bl{left:calc(12px + env(safe-area-inset-left));bottom:calc(12px + env(safe-area-inset-bottom))}",
  ".br{right:calc(12px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom))}",
  ".bc{left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom))}",
  ".tl{left:calc(12px + env(safe-area-inset-left));top:calc(12px + env(safe-area-inset-top))}",
  ".tr{right:calc(12px + env(safe-area-inset-right));top:calc(12px + env(safe-area-inset-top))}",
  ".b{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:0 13px;border-radius:10px;border:0;background:transparent;color:#F2F0EA;font-weight:600;white-space:nowrap}",
  ".b:hover{background:rgba(255,255,255,.08)}",
  ".b.p{background:" + GOLD + ";color:" + INK + "}",
  ".b.p:hover{background:#F8CD66}",
  ".b:disabled{opacity:.4;cursor:default}",
  ".b svg{width:16px;height:16px;flex:none}",
  ".c .b{min-height:44px}",
  ".n{min-width:36px;justify-content:center;padding:0 10px;color:#D8D4C8}",
  ".n.bump{animation:bump .5s ease-out}",
  "@keyframes bump{0%{transform:scale(1)}35%{transform:scale(1.28);color:" + GOLD + "}100%{transform:scale(1)}}",
  ".msg{padding:0 10px;font-size:13px;color:#F2DFA8;max-width:300px}",
  ".tip{position:fixed;z-index:2147483565;max-width:min(440px,calc(100vw - 24px));padding:8px 8px 8px 14px;border-radius:12px;background:" + INK + ";box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.1);display:flex;align-items:center;gap:10px}",
  ".tip p{margin:0;color:#F2F0EA}",
  ".tip .b{border:1px solid rgba(255,255,255,.18)}",
  ".tip .b.p{border-color:" + GOLD + "}",
  ".shield{position:fixed;inset:0;z-index:2147483510;cursor:" + CURSOR + ";touch-action:none;background:rgba(10,12,18,.04)}",
  ".hover{position:fixed;z-index:2147483512;pointer-events:none;border:2px solid " + GOLD + ";background:rgba(245,192,74,.08);border-radius:4px;transition:left .08s,top .08s,width .08s,height .08s}",
  ".hover.whole,.box.whole{border-width:3px;background:transparent;border-radius:0}",
  ".box{position:fixed;z-index:2147483520;pointer-events:none;border:2px solid " + GOLD + ";border-radius:4px;background:rgba(245,192,74,.10);box-shadow:0 0 0 1px rgba(10,12,18,.45),0 0 0 9999px rgba(10,12,18,.28)}",
  ".box.whole{box-shadow:none}",
  ".flash{position:fixed;z-index:2147483521;pointer-events:none;border:2px solid " + GOLD + ";border-radius:4px;background:rgba(245,192,74,.30);animation:flash .7s ease-out forwards}",
  ".flash.whole{border-width:3px;border-radius:0;background:transparent}",
  "@keyframes flash{0%{opacity:1;transform:scale(1)}60%{opacity:.7;transform:scale(1.015)}100%{opacity:0;transform:scale(1.03)}}",
  ".card{position:fixed;z-index:2147483570;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:12px;border-radius:14px;background:" + INK + ";box-shadow:0 18px 50px rgba(0,0,0,.42),inset 0 0 0 1px rgba(255,255,255,.08)}",
  ".card.dock{left:12px!important;right:12px;width:auto}",
  "input,textarea{display:block;width:100%;margin:0 0 8px;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#FFFFFF;font-size:15px}",
  "textarea{min-height:88px;resize:vertical;line-height:1.45}",
  "input::placeholder,textarea::placeholder{color:#8F96A5}",
  "input:focus,textarea:focus{outline:none;border-color:" + GOLD + ";box-shadow:0 0 0 3px rgba(245,192,74,.22)}",
  ".row{display:flex;align-items:center;gap:6px}",
  ".grow{flex:1}",
  ".card .b{border:1px solid rgba(255,255,255,.18)}",
  ".card .b.p{border-color:" + GOLD + "}",
  ".card .b.q{border-color:transparent;padding:0 6px;color:#D8D4C8}",
  ".b.hold{position:relative;overflow:hidden;margin-top:12px;width:100%;justify-content:center;color:#F2C9B5;border-color:rgba(242,201,181,.3)}",
  ".hold .fill{position:absolute;inset:0;background:#B14E1C;transform:scaleX(0);transform-origin:left center}",
  ".hold span{position:relative}",
  ".hold.holding{color:#FFFFFF}",
  "h2{margin:0 0 8px;font-size:16px;line-height:1.3;font-weight:650;color:#FFFFFF}",
  ".top{display:flex;align-items:center;gap:8px;margin-bottom:6px}.top h2{flex:1;margin:0}",
  ".x{width:32px;height:32px;border-radius:50%;border:0;background:transparent;color:#C2C7D1;font-size:20px;line-height:1;padding:0}",
  ".x:hover{background:rgba(255,255,255,.08)}",
  "p{margin:0 0 10px;color:#C8CCD5}",
  ".list{display:flex;flex-direction:column;gap:4px;margin:4px 0 10px}",
  ".item{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:9px;border:0;background:rgba(255,255,255,.04);color:#F2F0EA}",
  ".item:hover{background:rgba(255,255,255,.09)}",
  ".item span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}",
  ".item small{display:block;margin-top:2px;font-size:12px;color:#A4AAB7}",
  ".item small b{font-weight:600;color:#F2DFA8}",
  ".who{display:flex;align-items:center;gap:6px;font-size:13px;color:#A4AAB7}",
  ".pin{position:fixed;z-index:2147483505;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid " + INK + ";background:" + GOLD + ";color:" + INK + ";font:700 11px/18px system-ui,sans-serif;text-align:center;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.35)}",
  ".pin{transition:background-color .3s,color .3s}",
  ".pin.wait{background:" + INK + ";color:" + GOLD + ";border-color:" + GOLD + "}",
  ".pin.pop{animation:pop .45s cubic-bezier(.3,1.6,.5,1)}",
  "@keyframes pop{0%{transform:scale(.3);opacity:0}100%{transform:scale(1);opacity:1}}",
  ".toast{position:fixed;z-index:2147483575;display:flex;align-items:center;gap:7px;padding:6px 12px;border-radius:9px;background:" + INK + ";color:#F2F0EA;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(4px);transition:opacity .18s,transform .18s;pointer-events:none;max-width:min(340px,calc(100vw - 24px))}",
  ".toast svg{width:16px;height:16px;flex:none;color:" + GOLD + "}",
  ".toast.on{opacity:1;transform:none}",
  ":focus-visible{outline:3px solid " + GOLD + ";outline-offset:2px}",
  "@media (prefers-reduced-motion:reduce){.hover,.toast{transition:none}.n.bump,.pin.pop,.flash{animation:none}.flash{display:none}}"
].join("\n");
var wrap = el("div", "k" + (touch() ? " c" : ""));
var styleEl = el("style"); styleEl.textContent = CSS_TEXT;
root.appendChild(styleEl); root.appendChild(wrap);

var POS = { "bottom-left": "bl", "bottom-right": "br", "bottom-center": "bc", "top-left": "tl", "top-right": "tr" };
var corner = POS[T().dot] || "bl";
var pins = el("div"), shield = el("div", "shield"), hoverBox = el("div", "hover"), box = el("div", "box");
var card = el("div", "card"), tip = el("div", "tip"), bar = el("div", "bar " + corner), toast = el("div", "toast");
shield.hidden = hoverBox.hidden = box.hidden = card.hidden = tip.hidden = true;
card.setAttribute("role", "dialog");
toast.setAttribute("aria-live", "polite");
[pins, shield, hoverBox, box, card, tip, bar, toast].forEach(function (n) { wrap.appendChild(n); });

/* Keys and clicks inside the panel never reach the tool. */
["keydown", "keyup", "keypress", "click", "pointerdown", "mousedown", "touchstart", "input", "change"].forEach(function (t) {
  root.addEventListener(t, function (e) { e.stopPropagation(); }, false);
});
shield.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });

var st = { mode: "idle", target: null, editing: null, down: null, list: false, just: "", live: {} };

function showToast(t, done) {
  toast.textContent = "";
  if (done) toast.appendChild(svg(TICK, "2.6"));
  toast.appendChild(doc.createTextNode(t));
  var r = bar.getBoundingClientRect(), up = /^t/.test(corner);
  toast.style.left = clamp(r.left, 8, Math.max(8, win.innerWidth - 350)) + "px";
  toast.style.top = (up ? r.bottom + 8 : Math.max(8, r.top - 40)) + "px";
  toast.classList.add("on");
  clearTimeout(showToast.t); showToast.t = setTimeout(function () { toast.classList.remove("on"); }, 2600);
}
function placeTip() {
  var r = bar.getBoundingClientRect(), up = /^t/.test(corner), tw = tip.offsetWidth || 300, th = tip.offsetHeight || 48;
  var x = corner === "bc" ? (win.innerWidth - tw) / 2 : /r$/.test(corner) ? r.right - tw : r.left;
  tip.style.left = clamp(x, 8, Math.max(8, win.innerWidth - tw - 8)) + "px";
  tip.style.top = Math.max(8, up ? r.bottom + 8 : r.top - th - 8) + "px";
}
function showTip(text, buttons) {
  tip.textContent = ""; tip.appendChild(el("p", null, text));
  (buttons || []).forEach(function (b) { tip.appendChild(b); });
  tip.hidden = false; placeTip();
}

/* ---------- the bar ---------- */
var bumpUntil = 0;
function renderBar() {
  bar.textContent = "";
  if (linkOk === false) {
    tip.hidden = true;
    var u = unsent();
    bar.appendChild(el("span", "msg", (FB.code ? "This feedback link isn't working. Ask for a new one." : "This page needs a feedback link. Ask for one.") +
      (u === 1 ? " Your unsent comment is kept here and posts from the new link." : u ? " Your " + u + " unsent comments are kept here and post from the new link." : "")));
    bar.appendChild(btn("b", "Turn off", turnOff));
    return;
  }
  var picking = st.mode === "pick" || st.mode === "edit";
  var c = btn("b" + (picking ? "" : " p"), null, function () { if (picking) cancelComment(); else startComment(); });
  if (!picking) c.appendChild(svg(BUBBLE));
  c.appendChild(doc.createTextNode(picking ? "Cancel" : "Comment"));
  c.setAttribute("data-k", "comment");
  bar.appendChild(c);
  var n = mine().length;
  if (n) {
    var cnt = btn("b n" + (Date.now() < bumpUntil ? " bump" : ""), String(n), function () { openList(); });
    cnt.setAttribute("aria-label", plural(n, "comment", "comments")); cnt.setAttribute("data-k", "count"); bar.appendChild(cnt);
  }
  var d = btn("b", "Done", function () { openDone(); }); d.setAttribute("data-k", "done"); bar.appendChild(d);
}

/* ---------- choosing what a comment is about ---------- */
function startComment() {
  closeCard(); st.list = false; st.mode = "pick"; st.editing = null; st.target = null; st.picked = false;
  ls(function (l) { l.setItem(COACH, "1"); });
  shield.hidden = false; box.hidden = true; hoverBox.hidden = true;
  showTip(verb() + " what your comment is about.", [btnK("b", "Whole screen", function () { choose(whole()); }, "whole")]);
  renderBar(); renderPins(); listenKeys(true);
}
function btnK(cls, text, fn, k) { var b = btn(cls, text, fn); b.setAttribute("data-k", k); return b; }
function cancelComment() {
  st.mode = "idle"; st.editing = null; st.down = null; st.target = null;
  shield.hidden = true; hoverBox.hidden = true; box.hidden = true; tip.hidden = true;
  closeCard(); renderBar(); renderPins(); if (!st.list) listenKeys(false);
}
function paint(node, r, isWhole) {
  node.classList.toggle("whole", !!isWhole);
  node.style.left = r.x + "px"; node.style.top = r.y + "px"; node.style.width = r.w + "px"; node.style.height = r.h + "px";
  node.hidden = false;
}
shield.addEventListener("pointermove", function (e) {
  if (touch() || (st.mode !== "pick" && st.mode !== "edit")) return;
  var a = areaAt(e.clientX, e.clientY);
  if (st.mode === "edit" && st.target && a.el === st.target.el && !!a.whole === !!st.target.whole) { hoverBox.hidden = true; return; }
  paint(hoverBox, a.rect, a.whole);
});
shield.addEventListener("pointerleave", function () { hoverBox.hidden = true; });
shield.addEventListener("pointerdown", function (e) {
  if (e.button > 0) return;
  st.down = { x: e.clientX, y: e.clientY };
  e.preventDefault();
});
shield.addEventListener("pointerup", function (e) {
  var d = st.down; st.down = null; if (!d) return;
  choose(areaAt(e.clientX, e.clientY));
});
function choose(t) {
  hoverBox.hidden = true; tip.hidden = true; st.picked = true;
  st.target = t; paint(box, t.rect, t.whole);
  if (st.mode === "edit") { placeCard(); keepDraft(); return; }
  st.mode = "edit"; shield.hidden = false;
  renderBar(); openComposer(null);
}

/* ---------- writing a comment ---------- */
function closeCard() { if (holdStop) holdStop(); card.hidden = true; card.textContent = ""; card.className = "card"; composer = null; }
function placeCard() {
  if (card.hidden) return;
  var W = win.innerWidth, H = win.innerHeight, cw = card.offsetWidth || 340, ch = card.offsetHeight || 200;
  var b = st.target && !st.target.whole && (st.mode === "edit") ? st.target.rect : null;
  if (W < 560) {
    card.classList.add("dock");
    var low = b ? b.y + b.h / 2 > H / 2 : false;
    card.style.top = (low ? 12 : Math.max(12, H - ch - 12)) + "px"; card.style.left = "12px";
    return;
  }
  card.classList.remove("dock");
  var x, y;
  if (!b) {
    var r = bar.getBoundingClientRect();
    x = corner === "bc" ? (W - cw) / 2 : /r$/.test(corner) ? r.right - cw : r.left;
    y = /^t/.test(corner) ? r.bottom + 10 : r.top - ch - 10;
  }
  else if (b.y + b.h + 10 + ch < H - 8) { x = b.x; y = b.y + b.h + 10; }
  else if (b.y - 10 - ch > 8) { x = b.x; y = b.y - 10 - ch; }
  else if (b.x + b.w + 10 + cw < W - 8) { x = b.x + b.w + 10; y = b.y; }
  else { x = b.x - 10 - cw; y = b.y; }
  card.style.left = Math.round(clamp(x, 8, Math.max(8, W - cw - 8))) + "px"; card.style.top = Math.round(clamp(y, 8, Math.max(8, H - ch - 8))) + "px";
}
var composer = null;
function keepDraft() { if (composer) draftSet(composer.ta.value, composer.existing ? composer.existing.id : ""); }
function openComposer(existing) {
  closeCard(); card.hidden = false;
  card.setAttribute("aria-label", existing ? "Edit comment" : "New comment");
  var nameIn = null;
  if (!existing && !myName()) {
    nameIn = el("input"); nameIn.placeholder = "Your name"; nameIn.maxLength = 60; nameIn.setAttribute("aria-label", "Your name"); nameIn.autocomplete = "name";
    card.appendChild(nameIn);
  }
  var ta = el("textarea"); ta.placeholder = "Add a comment"; ta.maxLength = 2000; ta.setAttribute("aria-label", "Comment");
  var kept = draftGet(existing ? existing.id : "");
  ta.value = kept ? kept.text : (existing ? existing.text : "");
  card.appendChild(ta);
  var r = el("div", "row");
  if (existing) {
    var del = btn("b q", "Delete", function () {
      if (del.getAttribute("data-armed")) { removeComment(existing); return; }
      del.setAttribute("data-armed", "1"); del.textContent = verb() + " again to delete";
      setTimeout(function () { if (del.isConnected) { del.removeAttribute("data-armed"); del.textContent = "Delete"; } }, 3500);
    });
    del.setAttribute("data-k", "delete"); r.appendChild(del);
  }
  r.appendChild(el("span", "grow"));
  /* Cancel throws typed words away, so it asks first. Escape and the bar keep them. */
  var cancel = btn("b", "Cancel", function () {
    var changed = ta.value.trim() && ta.value !== (existing ? existing.text : "");
    if (changed && !cancel.getAttribute("data-armed")) {
      cancel.setAttribute("data-armed", "1"); cancel.textContent = "Discard?";
      setTimeout(function () { if (cancel.isConnected) { cancel.removeAttribute("data-armed"); cancel.textContent = "Cancel"; } }, 3500);
      return;
    }
    draftClear(existing ? existing.id : ""); cancelComment();
  });
  cancel.setAttribute("data-k", "cancel");
  r.appendChild(cancel);
  var go = btn("b p", existing ? "Save" : "Post", function () { submit(existing, ta, nameIn); });
  go.setAttribute("data-k", "post"); go.disabled = !ta.value.trim();
  r.appendChild(go); card.appendChild(r);
  composer = { ta: ta, existing: existing };
  ta.addEventListener("input", function () { go.disabled = !ta.value.trim(); keepDraft(); });
  placeCard();
  try { ((nameIn && !nameIn.value) ? nameIn : ta).focus({ preventScroll: true }); } catch (e) { ta.focus(); }
}
function whereNow() {
  var t = st.target || whole(), b = t.rect, W = win.innerWidth, H = win.innerHeight;
  var p = function (v, of) { return Math.round(1000 * v / of) / 10; };
  var sc = t.el ? scroller(t.el) : null;
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), vw: W, vh: H, xp: p(b.x, W), yp: p(b.y, H), wp: p(b.w, W), hp: p(b.h, H),
    area: false, whole: !!t.whole, sy: Math.round(sc ? sc.scrollTop : (win.scrollY || win.pageYOffset || 0)), el: describe(t.el) };
}
function submit(existing, ta, nameIn) {
  var text = ta.value.trim(); if (!text) return;
  if (nameIn && nameIn.value.trim()) ls(function (l) { l.setItem(NAME, nameIn.value.trim().slice(0, 60)); });
  var c, t = st.target;
  if (existing) {
    c = existing; c.text = text.slice(0, 2000); c.updated = Math.max(Date.now(), (c.updated || 0) + 1);
    if (st.picked && t && c.screen === screenId()) { c.where = whereNow(); if (t.el) st.live[c.id] = t.el; }
    c.status = "waiting"; delete c.err;
  } else {
    c = { id: randFrom("abcdefghijkmnpqrstuvwxyz23456789", 14), edit: randFrom("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", 24), tool: toolId(), created: Date.now(), updated: Date.now(), name: myName(), text: text.slice(0, 2000), ver: ver, screen: screenId(), where: whereNow(), ctx: context(), status: "waiting" };
    if (t && t.el) st.live[c.id] = t.el;
    all.push(c);
  }
  /* Saved here before anything else, so nothing typed is lost even if the post fails. */
  saveMine(); draftClear(existing ? existing.id : ""); composer = null; st.list = false;
  if (t && !calm()) { var f = el("div", "flash"); paint(f, t.rect, t.whole); wrap.appendChild(f); setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 800); }
  st.just = c.id; bumpUntil = existing ? 0 : Date.now() + 600;
  cancelComment();
  return send(c).then(function (r) {
    if (r.ok) showToast(existing ? "Saved" : "Posted", true);
    else if (c.err === "link") showToast("Kept here. It posts when you open a working feedback link.");
    else if (c.status === "failed") showToast("Kept here. Couldn't post it yet.");
    else showToast("Kept here. It posts when you're back online.");
    st.just = ""; return r;
  });
}
function removeComment(c) {
  return (inflight[c.id] || Promise.resolve()).then(function () {
    return api("/api/fb/delete", { tool: c.tool, code: FB.code, id: c.id, edit: c.edit });
  }).then(function (r) {
    if (r.ok || c.status !== "posted") {
      all = all.filter(function (x) { return x !== c; }); markGone(c.id); saveMine(); draftClear(c.id);
      var wasList = st.list; cancelComment(); showToast("Deleted"); if (wasList) openList();
    } else showToast(r.status ? "Couldn't delete it. Try again." : "Couldn't delete it while offline.");
  });
}

/* ---------- pins for this screen's comments, on the part they are about ---------- */
function pinAt(c) {
  var w = c.where;
  if (!w || w.whole || c.screen !== screenId()) return null;
  var n = st.live[c.id], sel = w.el && w.el.sel;
  if (!n || !n.isConnected) { n = null; if (sel) { try { n = doc.querySelector(sel); } catch (e) { n = null; } } }
  if (n) {
    var r = n.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > win.innerHeight) return null;
    return { x: clamp(r.left - 8, 12, win.innerWidth - 12), y: clamp(r.top - 8, 12, win.innerHeight - 12) };
  }
  if (sel) return null;
  return { x: w.xp * win.innerWidth / 100, y: w.yp * win.innerHeight / 100 };
}
/* Pins are kept and moved rather than redrawn, so they follow the page as it scrolls
   and animates without losing keyboard focus. */
var pinEls = {};
function byId(id) { var m = mine(); for (var i = 0; i < m.length; i++) if (m[i].id === id) return m[i]; return null; }
function renderPins() {
  var keep = {};
  if (st.mode !== "pick" && st.mode !== "edit") mine().forEach(function (c, i) {
    var at = pinAt(c); if (!at) return;
    var p = pinEls[c.id];
    if (!p) {
      p = btn("pin", null, function () { var x = byId(c.id); if (x) editComment(x); });
      if (st.just === c.id) p.classList.add("pop");
      pinEls[c.id] = p; pins.appendChild(p);
    }
    p.textContent = String(i + 1);
    p.classList.toggle("wait", c.status !== "posted");
    p.style.left = at.x + "px"; p.style.top = at.y + "px";
    p.setAttribute("aria-label", "Comment " + (i + 1) + ": " + clip(c.text, 60));
    keep[c.id] = 1;
  });
  Object.keys(pinEls).forEach(function (id) { if (!keep[id]) { if (pinEls[id].parentNode) pinEls[id].parentNode.removeChild(pinEls[id]); delete pinEls[id]; } });
}
var pinFrame = 0;
function pinsSoon() { if (pinFrame) return; pinFrame = raf(function () { pinFrame = 0; renderPins(); }); }
function editComment(c) {
  st.list = false; closeCard();
  st.mode = "edit"; st.editing = c; st.target = null; st.picked = false;
  if (c.where && !c.where.whole && c.screen === screenId()) {
    var n = st.live[c.id]; if (!n || !n.isConnected) { n = null; try { n = c.where.el && c.where.el.sel ? doc.querySelector(c.where.el.sel) : null; } catch (e) { n = null; } }
    st.target = n ? { el: n, whole: false, rect: around(n) } : { el: null, whole: false, rect: fit({ x: c.where.xp * win.innerWidth / 100, y: c.where.yp * win.innerHeight / 100, w: c.where.wp * win.innerWidth / 100, h: c.where.hp * win.innerHeight / 100 }) };
    paint(box, st.target.rect, false);
  } else if (c.where && c.where.whole && c.screen === screenId()) { st.target = whole(); paint(box, st.target.rect, true); }
  else box.hidden = true;
  shield.hidden = !st.target;
  renderBar(); renderPins(); listenKeys(true); openComposer(c);
}

/* ---------- the list, clearing, and Done ---------- */
function openList() {
  cancelComment(); st.list = true; card.hidden = false; card.setAttribute("aria-label", "Comments");
  var list = mine(), top = el("div", "top");
  top.appendChild(el("h2", null, "Comments"));
  var x = btn("x", "\u00d7", closePanel); x.setAttribute("aria-label", "Close"); top.appendChild(x);
  card.appendChild(top);
  if (!list.length) card.appendChild(el("p", null, "No comments yet. " + verb() + " Comment to add one."));
  var bx = el("div", "list");
  list.slice().reverse().forEach(function (c) {
    var it = btn("item", null, function () { editComment(c); });
    it.appendChild(el("span", null, c.text));
    var where = c.heading || (c.ctx && c.ctx.heading) || c.screen || "This page";
    var m = el("small", null, clip(where, 34).replace(/[.!?:;,]+$/, "") + ", " + hm(c.created));
    if (c.status !== "posted") { m.appendChild(doc.createTextNode(", ")); m.appendChild(el("b", null, c.status === "failed" ? "couldn't post yet" : "not posted yet")); }
    it.appendChild(m); bx.appendChild(it);
  });
  card.appendChild(bx);
  var who = el("div", "who"), nm = myName();
  who.appendChild(el("span", "grow", nm ? "Posting as " + nm : "No name added"));
  who.appendChild(btn("b q", nm ? "Change" : "Add name", askName));
  card.appendChild(who);
  if (list.length) card.appendChild(holdButton("Hold to clear all " + list.length, "Keep holding to clear your list", clearAll));
  listenKeys(true); placeCard();
  try { x.focus({ preventScroll: true }); } catch (e) {}
}
/* A button that acts only after it is held down for three seconds, by pointer or by
   Space or Enter. Letting go early does nothing. */
var holdStop = null;
function holdButton(label, holding, done) {
  var b = btn("b hold"), fill = el("i", "fill"), lab = el("span", null, label), t0 = 0, timer = 0;
  b.appendChild(fill); b.appendChild(lab);
  b.setAttribute("data-k", "clear"); b.setAttribute("aria-label", label + ". Press and hold for 3 seconds.");
  function draw() { if (!t0) return; var p = Math.min(1, (Date.now() - t0) / HOLD_MS); fill.style.transform = "scaleX(" + p + ")"; if (p < 1) raf(draw); }
  function stop() { clearTimeout(timer); t0 = 0; if (holdStop === stop) holdStop = null; b.classList.remove("holding"); fill.style.transform = "scaleX(0)"; lab.textContent = label; }
  function start(e) {
    if (t0 || b.disabled) return;
    if (e && e.type === "pointerdown") { if (e.button !== 0) return; e.preventDefault(); try { b.setPointerCapture(e.pointerId); } catch (x) {} }
    if (holdStop) holdStop();
    t0 = Date.now(); holdStop = stop; b.classList.add("holding"); lab.textContent = holding; draw();
    timer = setTimeout(function () {
      /* Only a hold that is still going, on a list that is still open, clears it. */
      if (!t0 || holdStop !== stop || !b.isConnected || card.hidden) { stop(); return; }
      t0 = 0; holdStop = null; b.disabled = true; fill.style.transform = "scaleX(1)"; lab.textContent = "Clearing\u2026"; done();
    }, HOLD_MS);
  }
  b.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel", "lostpointercapture", "blur", "contextmenu"].forEach(function (t) { b.addEventListener(t, function () { if (t0) stop(); }); });
  b.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) start(); } else if (t0) stop(); });
  b.addEventListener("keyup", function (e) { if ((e.key === " " || e.key === "Enter") && t0) stop(); });
  b.hold = { start: start, stop: stop };
  return b;
}
/* Clears this tester's list and pins for this tool. The board keeps every comment:
   only the team changes the board. A comment not yet posted still posts; it just
   leaves the list. */
function clearAll() {
  var list = mine();
  list.forEach(function (c) { c.cleared = true; draftClear(c.id); });
  saveMine(); openList(); renderBar(); renderPins();
  showToast("Cleared. The team still has " + (list.length === 1 ? "your comment." : "your comments."), true);
  if (queue().length) flush();
  return Promise.resolve({ cleared: list.length });
}
function askName() {
  closeCard(); card.hidden = false; st.list = true; card.setAttribute("aria-label", "Name");
  card.appendChild(el("h2", null, "Name"));
  var inp = el("input"); inp.placeholder = "Your name"; inp.maxLength = 60; inp.value = myName(); inp.setAttribute("aria-label", "Your name");
  card.appendChild(inp);
  var r = el("div", "row"); r.appendChild(el("span", "grow"));
  r.appendChild(btn("b", "Cancel", openList));
  var sv = btn("b p", "Save", function () { var v = inp.value.trim().slice(0, 60); ls(function (l) { if (v) l.setItem(NAME, v); else l.removeItem(NAME); }); openList(); });
  sv.setAttribute("data-k", "post"); r.appendChild(sv);
  card.appendChild(r); placeCard(); inp.focus();
}
function openDone() {
  cancelComment(); st.list = true; card.hidden = false; card.setAttribute("aria-label", "Done");
  var n = posted(), w = unsent();
  card.appendChild(el("h2", null, n ? "Thanks. " + plural(n, "comment", "comments") + " sent." : "No comments sent yet."));
  if (w) card.appendChild(el("p", null, plural(w, "comment hasn't", "comments haven't") + " posted yet. " + (w === 1 ? "It's kept here and posts" : "They're kept here and post") + " the next time this page is open and online."));
  var r = el("div", "row"); r.appendChild(el("span", "grow"));
  r.appendChild(btn("b", "Keep going", closePanel));
  var off = btn("b p", "Turn off feedback", turnOff); off.setAttribute("data-k", "off"); r.appendChild(off);
  card.appendChild(r); listenKeys(true); placeCard();
  try { off.focus({ preventScroll: true }); } catch (e) {}
}
function closePanel() { st.list = false; closeCard(); listenKeys(false); renderPins(); }

/* ---------- keys ---------- */
/* While the bar is busy, keys never reach the tool. Keys inside the bar still reach
   its own buttons (holding Space on Clear, say); the bar's root stops them after that. */
function onKey(e) {
  if (e.target !== host) e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (st.list) closePanel(); else cancelComment(); return; }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    var go = card.querySelector('[data-k="post"]'); if (go && !go.disabled) { e.preventDefault(); go.click(); }
  }
}
function listenKeys(on) { if (on) doc.addEventListener("keydown", onKey, true); else doc.removeEventListener("keydown", onKey, true); }

/* ---------- turning it off ---------- */
var timers = [];
function turnOff() {
  timers.forEach(clearInterval); timers = [];
  ss(function (s) { s.removeItem(FB.flag || "ep-feedback"); s.removeItem(FB.codeKey || "ep-feedback-code"); });
  try {
    var u = new URL(location.href);
    if (u.searchParams.has("feedback")) { u.searchParams.delete("feedback"); var q = u.searchParams.toString(); history.replaceState(history.state, "", u.pathname + (q ? "?" + q : "") + u.hash); }
  } catch (e) {}
  FB.on = false; listenKeys(false); host.remove();
  win.removeEventListener("beforeunload", onLeaving);
  doc.removeEventListener("scroll", pinsSoon, true);
}

/* ---------- leaving the page ---------- */
function onLeaving(e) {
  if (!FB.on) return;
  var typed = composer && composer.ta.value.trim() && composer.ta.value !== (composer.existing ? composer.existing.text : "");
  if (!typed && !unsent()) return;
  e.preventDefault(); e.returnValue = ""; return "";
}
win.addEventListener("beforeunload", onLeaving);
win.addEventListener("blur", function () { if (holdStop) holdStop(); });
win.addEventListener("storage", function (e) { if (e.key === MINE || e.key === GONE || e.key === null) { merge(); renderBar(); renderPins(); } });
win.addEventListener("pagehide", sendOnLeave);
doc.addEventListener("visibilitychange", function () { if (doc.visibilityState === "hidden") { if (holdStop) holdStop(); sendOnLeave(); } });

/* ---------- start ---------- */
(doc.documentElement || doc.body).appendChild(host);
renderBar(); renderPins();
/* A comment that was being written when the page last closed comes back, once. */
(function () {
  var d = draftGet("");
  if (d && !d.back) {
    ls(function (l) { d.back = true; l.setItem(draftKey(""), JSON.stringify(d)); });
    var n = null; if (d.sel && d.screen === screenId()) { try { n = doc.querySelector(d.sel); } catch (e) { n = null; } }
    st.list = false; st.mode = "edit"; st.target = n ? { el: n, whole: false, rect: around(n) } : whole();
    shield.hidden = false; paint(box, st.target.rect, st.target.whole);
    renderBar(); listenKeys(true); openComposer(null);
  } else if (!ls(function (l) { return l.getItem(COACH); })) {
    showTip(verb() + " Comment, then what your comment is about.", [btnK("b p", "OK", function () { ls(function (l) { l.setItem(COACH, "1"); }); tip.hidden = true; }, "ok")]);
  }
})();
checkLink().then(function (ok) { if (ok !== false) flush(true); });
win.addEventListener("online", function () { flush(); });
timers.push(setInterval(function () { if (unsent()) flush(); }, 20000));
timers.push(setInterval(renderPins, 1000));
win.addEventListener("resize", function () { renderPins(); if (!tip.hidden) placeTip(); placeCard(); });
doc.addEventListener("scroll", pinsSoon, true);

FB.ui = {
  start: startComment, cancel: cancelComment, list: openList, done: openDone, turnOff: turnOff, flush: flush, clear: clearAll,
  mine: mine, state: st, context: context, describe: describe, areaAt: areaAt, cleanUrl: cleanUrl, selOf: selOf,
  version: function () { return ver; }, link: function () { return linkOk; }, host: host, root: root
};
try { doc.dispatchEvent(new CustomEvent("epkit:feedback-ready")); } catch (e) {}
})();
