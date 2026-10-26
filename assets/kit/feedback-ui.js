/* ExperiencePoint feedback kit: the bar and comments. feedback.js loads this only
   in feedback mode; how to use the kit is in feedback.js's header. */
(function () {
"use strict";
var K = window.EPKit = window.EPKit || {};
var FB = K.feedback;
if (!FB || !FB.on || FB.ui) return;
var doc = document, win = window;
var API = K.api || "https://pt.armand-khambatta.workers.dev";
var MINE = "ep-feedback-mine", NAME = "ep-feedback-name", COACH = "ep-feedback-coach";

/* ---------- helpers ---------- */
function str(v) { return v == null ? "" : String(v); }
function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, fn) { var b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
function ls(fn) { try { return fn(win.localStorage); } catch (e) { return null; } }
function ss(fn) { try { return fn(win.sessionStorage); } catch (e) { return null; } }
function mq(q) { try { return win.matchMedia(q).matches; } catch (e) { return false; } }
function touch() { return mq("(pointer: coarse)"); }
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
    theme: mq("(prefers-color-scheme: dark)") ? "dark" : "light", reducedMotion: mq("(prefers-reduced-motion: reduce)") ? "yes" : "no"
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
    heading: clip(scrub(heading()), 120), settings: settings(), at: Date.now(), tz: tz,
    scroll: Math.round(win.scrollY || win.pageYOffset || 0), device: device(),
    actions: FB.actions.slice(-10).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; }),
    errors: FB.errors.slice(-6).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; })
  };
}

/* Which version of the file is open: the fingerprint Git gives the file, so the
   board can match each comment to a commit in pt's history. */
var ver = "";
(function () {
  var own = str(hook("version")) ? "tool:" + clip(hook("version"), 40) : "";
  ver = own;
  try {
    if (!/^https?:$/.test(location.protocol) || !win.crypto || !crypto.subtle || !win.fetch || !win.TextEncoder) return;
    fetch(location.pathname, { cache: "force-cache", credentials: "same-origin" }).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (buf) {
      if (!buf) return null;
      var head = new TextEncoder().encode("blob " + buf.byteLength + "\u0000"), all = new Uint8Array(head.length + buf.byteLength);
      all.set(head); all.set(new Uint8Array(buf), head.length);
      return crypto.subtle.digest("SHA-1", all);
    }).then(function (d) {
      if (d) ver = "git:" + Array.prototype.map.call(new Uint8Array(d), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    }).catch(function () {});
  } catch (e) {}
})();

/* ---------- what is under a comment's box ---------- */
var ACTIONABLE = "button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[data-act]";
var INLINE = /^(span|b|i|em|strong|small|sup|sub|br|code|mark|abbr|svg|path|use|g|circle|rect|line|polyline|polygon|ellipse|text|tspan|img)$/i;
function inKit(n) { return !!(n && n.closest && n.closest("[data-epkit]")); }
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
  return { tag: n.tagName.toLowerCase(), role: n.getAttribute("role") || "", text: scrub(textOf(n)), path: pathOf(n) };
}
function fit(b) {
  var W = win.innerWidth, H = win.innerHeight, w = clamp(b.w, 24, W), h = clamp(b.h, 24, H);
  return { x: clamp(b.x, 0, W - w), y: clamp(b.y, 0, H - h), w: w, h: h };
}
/* The area a click means: the control or block under the pointer, never the whole page. */
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
  if (!r || !r.width || !r.height || r.width * r.height > 0.5 * W * H) return { el: n, rect: fit({ x: x - 90, y: y - 60, w: 180, h: 120 }), area: true };
  return { el: n, rect: fit({ x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 }), area: false };
}

/* ---------- the tester's own comments, kept in this browser ---------- */
function loadMine() { var v = ls(function (l) { return JSON.parse(l.getItem(MINE) || "[]"); }); return Array.isArray(v) ? v : []; }
var all = loadMine();
function mine() { var id = toolId(); return all.filter(function (c) { return c && c.tool === id; }); }
function saveMine() {
  all = all.slice(-300);
  ls(function (l) { l.setItem(MINE, JSON.stringify(all.map(function (c) { if (c.status !== "posted") return c; var o = {}; for (var k in c) if (k !== "ctx") o[k] = c[k]; o.heading = c.heading || (c.ctx && c.ctx.heading) || ""; return o; }))); });
}
function myName() { return str(ls(function (l) { return l.getItem(NAME); })).slice(0, 60); }

/* ---------- talking to the pt worker ---------- */
var linkOk = null, flushing = false;
function api(path, body) {
  var o = body ? { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: JSON.stringify(body) } : {};
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
function send(c) {
  c.status = "sending";
  return api("/api/fb/post", { tool: c.tool, code: FB.code, id: c.id, edit: c.edit, comment: { name: c.name, text: c.text, ver: c.ver, screen: c.screen, where: c.where, ctx: c.ctx || {} } }).then(function (r) {
    if (r.ok) { c.status = "posted"; delete c.err; }
    else if (r.status === 401) { c.status = "waiting"; c.err = "link"; linkOk = false; }
    else if (r.status === 400 || r.status === 413) { c.status = "failed"; c.err = r.error; }
    else { c.status = "waiting"; c.err = r.status ? "busy" : "offline"; }
    saveMine(); renderBar(); renderPins(); return r;
  });
}
function flush() {
  if (flushing || linkOk === false) return Promise.resolve();
  var w = mine().filter(function (c) { return c.status === "waiting" || c.status === "sending"; });
  if (!w.length) return Promise.resolve();
  flushing = true;
  return w.reduce(function (p, c) { return p.then(function () { return send(c); }); }, Promise.resolve()).then(function () { flushing = false; }, function () { flushing = false; });
}
function waiting() { return mine().filter(function (c) { return c.status !== "posted"; }).length; }
function posted() { return mine().filter(function (c) { return c.status === "posted"; }).length; }

/* ---------- the parts on screen ---------- */
var host = el("div");
host.setAttribute("data-epkit", "feedback");
host.setAttribute("data-clarity-mask", "true");
var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
var GOLD = "#F5C04A";
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
  ".b.p{background:" + GOLD + ";color:#1B1F2A}",
  ".b.p:hover{background:#F8CD66}",
  ".b:disabled{opacity:.4;cursor:default}",
  ".b svg{width:16px;height:16px;flex:none}",
  ".c .b{min-height:44px}",
  ".n{min-width:36px;justify-content:center;padding:0 10px;color:#D8D4C8}",
  ".msg{padding:0 10px;font-size:13px;color:#F2DFA8;max-width:260px}",
  ".tip{position:fixed;z-index:2147483565;max-width:min(320px,calc(100vw - 24px));padding:10px 12px;border-radius:12px;background:#1B1F2A;box-shadow:0 10px 30px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.1);display:flex;align-items:center;gap:12px}",
  ".tip p{margin:0;color:#F2F0EA}",
  ".shield{position:fixed;inset:0;z-index:2147483510;cursor:crosshair;touch-action:none;background:rgba(10,12,18,.06)}",
  ".hover{position:fixed;z-index:2147483512;pointer-events:none;border:2px solid " + GOLD + ";background:rgba(245,192,74,.07);border-radius:2px;transition:left .08s,top .08s,width .08s,height .08s}",
  ".box{position:fixed;z-index:2147483520;border:2px solid " + GOLD + ";border-radius:2px;background:rgba(245,192,74,.10);box-shadow:0 0 0 1px rgba(10,12,18,.45),0 0 0 9999px rgba(10,12,18,.28);cursor:move;touch-action:none}",
  ".h{position:absolute;width:12px;height:12px;background:#FFFFFF;border:2px solid " + GOLD + ";border-radius:2px}",
  ".c .h{width:20px;height:20px}",
  ".nw{left:-7px;top:-7px;cursor:nwse-resize}.ne{right:-7px;top:-7px;cursor:nesw-resize}.sw{left:-7px;bottom:-7px;cursor:nesw-resize}.se{right:-7px;bottom:-7px;cursor:nwse-resize}",
  ".c .nw{left:-11px;top:-11px}.c .ne{right:-11px;top:-11px}.c .sw{left:-11px;bottom:-11px}.c .se{right:-11px;bottom:-11px}",
  ".card{position:fixed;z-index:2147483570;width:min(340px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:12px;border-radius:14px;background:#1B1F2A;box-shadow:0 18px 50px rgba(0,0,0,.42),inset 0 0 0 1px rgba(255,255,255,.08)}",
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
  ".pin{position:fixed;z-index:2147483505;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid #1B1F2A;background:" + GOLD + ";color:#1B1F2A;font:700 11px/18px system-ui,sans-serif;text-align:center;padding:0;box-shadow:0 2px 8px rgba(0,0,0,.35)}",
  ".pin.wait{background:#1B1F2A;color:" + GOLD + ";border-color:" + GOLD + "}",
  ".toast{position:fixed;z-index:2147483575;padding:6px 12px;border-radius:9px;background:#1B1F2A;color:#F2F0EA;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.35);opacity:0;transform:translateY(4px);transition:opacity .18s,transform .18s;pointer-events:none;max-width:min(320px,calc(100vw - 24px))}",
  ".toast.on{opacity:1;transform:none}",
  ":focus-visible{outline:3px solid " + GOLD + ";outline-offset:2px}",
  "@media (prefers-reduced-motion:reduce){.hover,.toast{transition:none}}"
].join("\n");
var wrap = el("div", "k" + (touch() ? " c" : ""));
var styleEl = el("style"); styleEl.textContent = CSS_TEXT;
root.appendChild(styleEl); root.appendChild(wrap);
function commentIcon() {
  var ns = "http://www.w3.org/2000/svg", s = doc.createElementNS(ns, "svg"), p = doc.createElementNS(ns, "path");
  s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  p.setAttribute("d", "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"); s.appendChild(p);
  return s;
}

var POS = { "bottom-left": "bl", "bottom-right": "br", "bottom-center": "bc", "top-left": "tl", "top-right": "tr" };
var corner = POS[T().dot] || "bl";
var pins = el("div"), shield = el("div", "shield"), hoverBox = el("div", "hover"), box = el("div", "box");
var card = el("div", "card"), tip = el("div", "tip"), bar = el("div", "bar " + corner), toast = el("div", "toast");
shield.hidden = hoverBox.hidden = box.hidden = card.hidden = tip.hidden = true;
card.setAttribute("role", "dialog");
toast.setAttribute("aria-live", "polite");
["nw", "ne", "sw", "se"].forEach(function (k) { var h = el("i", "h " + k); h.setAttribute("data-h", k); box.appendChild(h); });
[pins, shield, hoverBox, box, card, tip, bar, toast].forEach(function (n) { wrap.appendChild(n); });

/* Keys and clicks inside the panel never reach the tool. */
["keydown", "keyup", "keypress", "click", "pointerdown", "mousedown", "touchstart", "input", "change"].forEach(function (t) {
  root.addEventListener(t, function (e) { e.stopPropagation(); }, false);
});
shield.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });

var st = { mode: "idle", draft: null, editing: null, drag: null, down: null, box: null, target: null, screen: "", list: false, draftText: "" };

function showToast(t) {
  toast.textContent = t;
  var r = bar.getBoundingClientRect(), up = /^t/.test(corner);
  toast.style.left = clamp(r.left, 8, Math.max(8, win.innerWidth - 330)) + "px";
  toast.style.top = (up ? r.bottom + 8 : Math.max(8, r.top - 40)) + "px";
  toast.classList.add("on");
  clearTimeout(showToast.t); showToast.t = setTimeout(function () { toast.classList.remove("on"); }, 2400);
}
function placeTip() {
  var r = bar.getBoundingClientRect(), up = /^t/.test(corner), tw = tip.offsetWidth || 260, th = tip.offsetHeight || 44;
  var x = corner === "bc" ? (win.innerWidth - tw) / 2 : /r$/.test(corner) ? r.right - tw : r.left;
  tip.style.left = clamp(x, 8, Math.max(8, win.innerWidth - tw - 8)) + "px";
  tip.style.top = Math.max(8, up ? r.bottom + 8 : r.top - th - 8) + "px";
}
function showTip(text, okFn) {
  tip.textContent = ""; tip.appendChild(el("p", null, text));
  if (okFn) tip.appendChild(btn("b p", "OK", okFn));
  tip.hidden = false; placeTip();
}

/* ---------- the bar ---------- */
function renderBar() {
  bar.textContent = "";
  if (linkOk === false) {
    bar.appendChild(el("span", "msg", FB.code ? "This feedback link isn't working. Ask for a new one." : "This page needs a feedback link. Ask for one."));
    bar.appendChild(btn("b", "Turn off", turnOff));
    return;
  }
  var picking = st.mode === "pick" || st.mode === "edit";
  var c = btn("b" + (picking ? "" : " p"), null, function () { if (picking) cancelComment(); else startComment(); });
  if (!picking) c.appendChild(commentIcon());
  c.appendChild(doc.createTextNode(picking ? "Cancel" : "Comment"));
  c.setAttribute("data-k", "comment");
  bar.appendChild(c);
  var n = mine().length;
  if (n) {
    var cnt = btn("b n", String(n), function () { openList(); });
    cnt.setAttribute("aria-label", plural(n, "comment", "comments")); cnt.setAttribute("data-k", "count"); bar.appendChild(cnt);
  }
  var d = btn("b", "Done", function () { openDone(); }); d.setAttribute("data-k", "done"); bar.appendChild(d);
}

/* ---------- choosing an area ---------- */
function startComment() {
  closeCard(); st.list = false; st.mode = "pick"; st.draft = null; st.editing = null; st.box = null;
  ls(function (l) { l.setItem(COACH, "1"); });
  shield.hidden = false; box.hidden = true; hoverBox.hidden = true;
  showTip(verb() + " the area your feedback is about.");
  renderBar(); renderPins(); listenKeys(true);
}
function cancelComment() {
  st.mode = "idle"; st.draft = null; st.editing = null; st.drag = null; st.down = null; st.box = null;
  shield.hidden = true; hoverBox.hidden = true; box.hidden = true; tip.hidden = true;
  closeCard(); renderBar(); renderPins(); if (!st.list) listenKeys(false);
}
function setBox(r) {
  st.box = fit(r);
  box.style.left = st.box.x + "px"; box.style.top = st.box.y + "px"; box.style.width = st.box.w + "px"; box.style.height = st.box.h + "px";
  box.hidden = false;
}
shield.addEventListener("pointermove", function (e) {
  if (st.down) {
    var dx = e.clientX - st.down.x, dy = e.clientY - st.down.y;
    if (!st.down.drawing && Math.sqrt(dx * dx + dy * dy) > 6) { st.down.drawing = true; hoverBox.hidden = true; }
    if (st.down.drawing) setBox({ x: Math.min(e.clientX, st.down.x), y: Math.min(e.clientY, st.down.y), w: Math.abs(dx), h: Math.abs(dy) });
    return;
  }
  if (st.mode !== "pick" || touch()) return;
  var a = areaAt(e.clientX, e.clientY);
  hoverBox.style.left = a.rect.x + "px"; hoverBox.style.top = a.rect.y + "px"; hoverBox.style.width = a.rect.w + "px"; hoverBox.style.height = a.rect.h + "px";
  hoverBox.hidden = false;
});
shield.addEventListener("pointerdown", function (e) {
  if (e.button > 0) return;
  st.down = { x: e.clientX, y: e.clientY, drawing: false };
  try { if (shield.setPointerCapture && e.pointerId != null) shield.setPointerCapture(e.pointerId); } catch (er) {}
  e.preventDefault();
});
shield.addEventListener("pointerup", function (e) {
  var d = st.down; st.down = null; if (!d) return;
  var t;
  if (d.drawing && st.box && st.box.w >= 24 && st.box.h >= 24) t = { el: hitAt(st.box.x + st.box.w / 2, st.box.y + st.box.h / 2), rect: st.box, area: true };
  else t = areaAt(e.clientX, e.clientY);
  chooseArea(t);
});
function chooseArea(t) {
  hoverBox.hidden = true; tip.hidden = true;
  setBox(t.rect); st.target = t;
  if (st.mode === "edit" && st.draft) { st.draft.el = t.el; placeCard(); return; }
  st.mode = "edit"; st.draft = { el: t.el };
  renderBar(); openComposer(null);
}
/* moving and resizing the box */
box.addEventListener("pointerdown", function (e) {
  if (e.button > 0 || !st.box) return;
  var h = e.target && e.target.getAttribute && e.target.getAttribute("data-h");
  st.drag = { h: h || "", x: e.clientX, y: e.clientY, b: { x: st.box.x, y: st.box.y, w: st.box.w, h: st.box.h } };
  try { if (box.setPointerCapture && e.pointerId != null) box.setPointerCapture(e.pointerId); } catch (er) {}
  e.preventDefault(); e.stopPropagation();
});
box.addEventListener("pointermove", function (e) {
  var d = st.drag; if (!d) return;
  var dx = e.clientX - d.x, dy = e.clientY - d.y, b = { x: d.b.x, y: d.b.y, w: d.b.w, h: d.b.h };
  if (!d.h) { b.x += dx; b.y += dy; }
  else {
    if (/w/.test(d.h)) { var mx = Math.min(dx, d.b.w - 24); b.x = d.b.x + mx; b.w = d.b.w - mx; }
    if (/e/.test(d.h)) b.w = Math.max(24, d.b.w + dx);
    if (/n/.test(d.h)) { var my = Math.min(dy, d.b.h - 24); b.y = d.b.y + my; b.h = d.b.h - my; }
    if (/s/.test(d.h)) b.h = Math.max(24, d.b.h + dy);
  }
  setBox(b);
});
function endBoxDrag() {
  if (!st.drag) return; st.drag = null;
  if (st.draft && st.box) st.draft.el = hitAt(st.box.x + st.box.w / 2, st.box.y + st.box.h / 2) || st.draft.el;
  placeCard();
}
box.addEventListener("pointerup", endBoxDrag);
box.addEventListener("pointercancel", endBoxDrag);

/* ---------- writing a comment ---------- */
function closeCard() { card.hidden = true; card.textContent = ""; card.className = "card"; toast.classList.remove("on"); }
function placeCard() {
  if (card.hidden) return;
  var W = win.innerWidth, H = win.innerHeight, cw = card.offsetWidth || 340, ch = card.offsetHeight || 200, b = st.box;
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
function openComposer(existing) {
  closeCard(); card.hidden = false;
  card.setAttribute("aria-label", existing ? "Edit comment" : "New comment");
  var nameIn = null;
  if (!existing && !myName()) {
    nameIn = el("input"); nameIn.placeholder = "Your name"; nameIn.maxLength = 60; nameIn.setAttribute("aria-label", "Your name"); nameIn.autocomplete = "name";
    card.appendChild(nameIn);
  }
  var ta = el("textarea"); ta.placeholder = "Add a comment"; ta.maxLength = 2000; ta.setAttribute("aria-label", "Comment");
  ta.value = existing ? existing.text : st.draftText;
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
  var cancel = btn("b", "Cancel", function () { st.draftText = ""; cancelComment(); }); cancel.setAttribute("data-k", "cancel");
  r.appendChild(cancel);
  var go = btn("b p", existing ? "Save" : "Post", function () { submit(existing, ta, nameIn); });
  go.setAttribute("data-k", "post"); go.disabled = !ta.value.trim();
  r.appendChild(go); card.appendChild(r);
  ta.addEventListener("input", function () { go.disabled = !ta.value.trim(); if (!existing) st.draftText = ta.value; });
  placeCard();
  try { ((nameIn && !nameIn.value) ? nameIn : ta).focus({ preventScroll: true }); } catch (e) { ta.focus(); }
}
function whereNow() {
  var b = st.box || { x: 0, y: 0, w: 0, h: 0 }, W = win.innerWidth, H = win.innerHeight, e1 = st.draft && st.draft.el;
  var p = function (v, of) { return Math.round(1000 * v / of) / 10; };
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h), vw: W, vh: H, xp: p(b.x, W), yp: p(b.y, H), wp: p(b.w, W), hp: p(b.h, H), area: !!(st.target && st.target.area), el: describe(e1) };
}
function submit(existing, ta, nameIn) {
  var text = ta.value.trim(); if (!text) return;
  if (nameIn && nameIn.value.trim()) ls(function (l) { l.setItem(NAME, nameIn.value.trim().slice(0, 60)); });
  var c;
  if (existing) {
    c = existing; c.text = text.slice(0, 2000); c.updated = Date.now();
    if (st.box && c.screen === screenId()) c.where = whereNow();
    if (!c.ctx) c.ctx = { name: toolName(), kit: FB.kit, heading: c.heading || "" };
  } else {
    c = { id: randFrom("abcdefghijkmnpqrstuvwxyz23456789", 14), edit: randFrom("ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789", 24), tool: toolId(), created: Date.now(), updated: Date.now(), name: myName(), text: text.slice(0, 2000), ver: ver, screen: screenId(), where: whereNow(), ctx: context(), status: "waiting" };
    all.push(c);
  }
  st.draftText = ""; st.list = false;
  saveMine(); cancelComment();
  showToast(existing ? "Saving\u2026" : "Posting\u2026");
  return send(c).then(function (r) {
    if (r.ok) showToast(existing ? "Saved" : "Posted");
    else if (c.err === "link") showToast("Couldn't post. Ask for a new feedback link.");
    else if (c.status === "failed") showToast("Couldn't post this one. Try shorter text.");
    else showToast("Saved here. It posts when you're online again.");
    return r;
  });
}
function removeComment(c) {
  return api("/api/fb/delete", { tool: c.tool, code: FB.code, id: c.id, edit: c.edit }).then(function (r) {
    if (r.ok || c.status !== "posted") {
      all = all.filter(function (x) { return x !== c; }); saveMine();
      var wasList = st.list; cancelComment(); showToast("Deleted"); if (wasList) openList();
    } else showToast(r.status ? "Couldn't delete it. Try again." : "Couldn't delete it while offline.");
  });
}

/* ---------- pins for this screen's comments ---------- */
function renderPins() {
  pins.textContent = "";
  if (st.mode === "pick" || st.mode === "edit") return;
  var sc = screenId();
  mine().forEach(function (c, i) {
    if (!c.where || c.screen !== sc) return;
    var p = btn("pin" + (c.status === "posted" ? "" : " wait"), String(i + 1), function () { editComment(c); });
    p.style.left = (c.where.xp * win.innerWidth / 100) + "px"; p.style.top = (c.where.yp * win.innerHeight / 100) + "px";
    p.setAttribute("aria-label", "Comment " + (i + 1) + ": " + clip(c.text, 60));
    pins.appendChild(p);
  });
}
function editComment(c) {
  var fromList = st.list; st.list = false; closeCard();
  st.mode = "edit"; st.draft = { el: null }; st.editing = c; st.target = { area: c.where && c.where.area };
  if (c.where && c.screen === screenId()) {
    shield.hidden = false;
    setBox({ x: c.where.xp * win.innerWidth / 100, y: c.where.yp * win.innerHeight / 100, w: c.where.wp * win.innerWidth / 100, h: c.where.hp * win.innerHeight / 100 });
    st.draft.el = hitAt(st.box.x + st.box.w / 2, st.box.y + st.box.h / 2);
  } else { st.box = null; box.hidden = true; shield.hidden = true; }
  renderBar(); renderPins(); listenKeys(true); openComposer(c);
  st.fromList = fromList;
}

/* ---------- the list, and Done ---------- */
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
    if (c.status !== "posted") { m.appendChild(doc.createTextNode(", ")); m.appendChild(el("b", null, "not posted yet")); }
    it.appendChild(m); bx.appendChild(it);
  });
  card.appendChild(bx);
  var who = el("div", "who"), nm = myName();
  who.appendChild(el("span", "grow", nm ? "Posting as " + nm : "No name added"));
  who.appendChild(btn("b q", nm ? "Change" : "Add name", askName));
  card.appendChild(who);
  listenKeys(true); placeCard();
  try { x.focus({ preventScroll: true }); } catch (e) {}
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
  var n = posted(), w = waiting();
  card.appendChild(el("h2", null, n ? "Thanks. " + plural(n, "comment", "comments") + " sent." : "No comments sent yet."));
  if (w) card.appendChild(el("p", null, plural(w, "comment hasn't", "comments haven't") + " posted yet. Keep this page open until " + (w === 1 ? "it does." : "they do.")));
  var r = el("div", "row"); r.appendChild(el("span", "grow"));
  r.appendChild(btn("b", "Keep going", closePanel));
  var off = btn("b p", "Turn off feedback", turnOff); off.setAttribute("data-k", "off"); r.appendChild(off);
  card.appendChild(r); listenKeys(true); placeCard();
  try { off.focus({ preventScroll: true }); } catch (e) {}
}
function closePanel() { st.list = false; closeCard(); listenKeys(false); renderPins(); }

/* ---------- keys ---------- */
function onKey(e) {
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); if (st.list) closePanel(); else cancelComment(); return; }
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
}

/* ---------- start ---------- */
(doc.documentElement || doc.body).appendChild(host);
renderBar(); renderPins();
if (!ls(function (l) { return l.getItem(COACH); })) showTip(verb() + " Comment, then the area you mean.", function () { ls(function (l) { l.setItem(COACH, "1"); }); tip.hidden = true; });
checkLink().then(function (ok) { if (ok !== false) flush(); });
win.addEventListener("online", function () { flush(); });
timers.push(setInterval(function () { if (waiting()) flush(); }, 20000));
timers.push(setInterval(function () { var s = screenId(); if (s !== st.screen) { st.screen = s; renderPins(); } }, 1000));
win.addEventListener("resize", function () { renderPins(); if (!tip.hidden) placeTip(); placeCard(); });

FB.ui = {
  start: startComment, cancel: cancelComment, list: openList, done: openDone, turnOff: turnOff, flush: flush,
  mine: mine, state: st, context: context, describe: describe, areaAt: areaAt, cleanUrl: cleanUrl,
  version: function () { return ver; }, link: function () { return linkOk; }, host: host, root: root
};
try { doc.dispatchEvent(new CustomEvent("epkit:feedback-ready")); } catch (e) {}
})();
