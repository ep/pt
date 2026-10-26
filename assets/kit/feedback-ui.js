/* ExperiencePoint feedback kit: the panel. feedback.js loads this only in
   feedback mode; how to use the kit is in feedback.js's header. */
(function () {
"use strict";
var K = window.EPKit = window.EPKit || {};
var FB = K.feedback;
if (!FB || !FB.on || FB.ui) return;
var doc = document, win = window;
var TO = ["armand.khambatta", "experiencepoint.com"].join("@");
var INTRO_KEY = "ep-feedback-intro", TIP_KEY = "ep-feedback-tips";
var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* ---------- helpers ---------- */
function str(v) { return v == null ? "" : String(v); }
function clip(t, n) { t = str(t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function btn(cls, text, fn) { var b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
function ss(fn) { try { return fn(win.sessionStorage); } catch (e) { return null; } }
function ls(fn) { try { return fn(win.localStorage); } catch (e) { return null; } }
function mq(q) { try { return win.matchMedia(q).matches; } catch (e) { return false; } }
function coarse() { return mq("(pointer: coarse)"); }
function uid() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function pad(x) { return (x < 10 ? "0" : "") + x; }
function hms(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); }
function hm(t) { var d = new Date(t); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
function dayStr(t) { var d = new Date(t); return DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }
function isoDay(t) { var d = new Date(t); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; } }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function scrub(s) { return K.scrub ? K.scrub(s) : str(s); }

/* ---------- what the tool says about itself ---------- */
function T() { return K.tool || {}; }
function hook(name) { try { var v = T()[name]; return typeof v === "function" ? v() : v; } catch (e) { return undefined; } }
function toolId() {
  var id = str(T().id);
  if (id) return clip(id, 40);
  var p = location.pathname.replace(/\/index\.html?$/i, "").replace(/\/+$/, "").split("/").pop() || "page";
  return clip(p.replace(/\.html?$/i, ""), 40);
}
function toolName() { return clip(T().name || doc.title || toolId(), 80); }

function cleanUrl(href) {
  try {
    var u = new URL(href), keep = (T().safeParams || []).concat(["feedback"]), parts = [];
    u.searchParams.forEach(function (v, k) { parts.push(keep.indexOf(k) > -1 ? (v ? k + "=" + v : k) : k + "=[removed]"); });
    var base = u.protocol === "file:" ? "a file on the tester's computer: " + decodeURIComponent(u.pathname.split("/").pop()) : u.protocol + "//" + u.host + u.pathname;
    return base + (parts.length ? "?" + parts.join("&") : "") + (u.hash && u.hash !== "#" ? "#[removed]" : "");
  } catch (e) { return location.pathname; }
}
function heading() {
  var hs = doc.querySelectorAll("h1,h2,h3,[role=heading]");
  for (var i = 0; i < hs.length; i++) {
    var h = hs[i]; if (h.closest("[data-epkit]")) continue;
    var r = h.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < win.innerHeight) return clip(h.innerText || h.textContent, 120);
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
    browser: b, os: os,
    window: win.innerWidth + "\u00d7" + win.innerHeight,
    screen: (win.screen ? win.screen.width + "\u00d7" + win.screen.height : "") + (dpr !== 1 ? " at " + dpr + "x" : ""),
    input: coarse() ? "touch" : "mouse or trackpad",
    language: navigator.language || "",
    theme: mq("(prefers-color-scheme: dark)") ? "dark" : "light",
    reducedMotion: mq("(prefers-reduced-motion: reduce)") ? "yes" : "no",
    online: navigator.onLine === false ? "offline" : "online"
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
  return {
    tool: toolId(), name: toolName(), version: clip(hook("version"), 40), kit: FB.kit,
    page: cleanUrl(location.href), screen: clip(scrub(hook("screen")), 80), heading: clip(scrub(heading()), 120),
    settings: settings(), at: Date.now(), tz: tz(), scroll: Math.round(win.scrollY || win.pageYOffset || 0),
    device: device(),
    actions: FB.actions.slice(-10).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; }),
    errors: FB.errors.slice(-6).map(function (a) { return { t: a.t, what: a.what, screen: a.screen }; })
  };
}

/* ---------- where notes are kept: this browser only ---------- */
var store = (function () {
  var mem = {}, db = null, persistent = false;
  var ready = new Promise(function (res) {
    try {
      if (!win.indexedDB) return res();
      var rq = win.indexedDB.open("ep-feedback", 1);
      rq.onupgradeneeded = function () { try { rq.result.createObjectStore("notes", { keyPath: "id" }); } catch (e) {} };
      rq.onsuccess = function () { db = rq.result; persistent = true; res(); };
      rq.onerror = function () { res(); };
      rq.onblocked = function () { res(); };
    } catch (e) { res(); }
    setTimeout(res, 2500);
  });
  function req(mode, fn) {
    return new Promise(function (res, rej) {
      try {
        var t = db.transaction("notes", mode), r = fn(t.objectStore("notes"));
        t.oncomplete = function () { res(r ? r.result : undefined); };
        t.onerror = t.onabort = function () { rej(t.error || new Error("store")); };
      } catch (e) { rej(e); }
    });
  }
  function memList() { return Object.keys(mem).map(function (k) { return mem[k]; }); }
  return {
    ready: ready,
    persistent: function () { return persistent && !Object.keys(mem).length; },
    all: function () {
      return ready.then(function () { return db ? req("readonly", function (s) { return s.getAll(); }).catch(function () { return []; }) : []; })
        .then(function (list) {
          var seen = {}, out = [];
          (list || []).concat(memList()).forEach(function (n) { if (n && n.tool === toolId() && !seen[n.id]) { seen[n.id] = 1; out.push(n); } });
          return out.sort(function (a, b) { return a.created - b.created; });
        });
    },
    put: function (n) {
      return ready.then(function () {
        if (!db) { mem[n.id] = n; return; }
        return req("readwrite", function (s) { return s.put(n); }).then(function () { delete mem[n.id]; }, function () { mem[n.id] = n; });
      });
    },
    del: function (id) {
      delete mem[id];
      return ready.then(function () { if (db) return req("readwrite", function (s) { return s["delete"](id); }).catch(function () {}); });
    }
  };
})();

/* ---------- pictures of this tab (computers, Chrome and Edge) ---------- */
var cap = { state: "off", stream: null, video: null, ring: [], timer: 0 };
function picturesPossible() {
  if (T().pictures === false) return false;
  return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && navigator.userAgentData) && !coarse();
}
function stopRing() { if (cap.timer) clearInterval(cap.timer); cap.timer = 0; }
function stopCapture(next) {
  stopRing();
  if (cap.stream) cap.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
  cap.stream = null; cap.video = null; cap.ring = []; cap.state = next || "off";
}
function startCapture() {
  cap.state = "asking";
  var p;
  try {
    p = navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: "browser", frameRate: { ideal: 8, max: 12 } }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude",
      monitorTypeSurfaces: "exclude", systemAudio: "exclude"
    });
  } catch (e) { p = Promise.reject(e); }
  return p.then(function (s) {
    var tr = s.getVideoTracks()[0], set = tr && tr.getSettings ? tr.getSettings() : {};
    if (!tr || (set.displaySurface && set.displaySurface !== "browser")) {
      s.getTracks().forEach(function (t) { t.stop(); }); cap.state = "wrong"; return cap.state;
    }
    var v = doc.createElement("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.srcObject = s;
    return Promise.resolve(v.play && v.play()).catch(function () {}).then(function () { return waitFrame(v); }).then(function () {
      if (!v.videoWidth) { s.getTracks().forEach(function (t) { t.stop(); }); cap.state = "failed"; return cap.state; }
      cap.stream = s; cap.video = v; cap.state = "on";
      tr.addEventListener("ended", function () { stopCapture("stopped"); ui.status(); });
      stopRing(); cap.timer = setInterval(sample, 600);
      return "on";
    });
  }, function (e) { cap.state = e && e.name === "NotAllowedError" ? "denied" : "failed"; return cap.state; });
}
function waitFrame(v) { return new Promise(function (res) { var t0 = Date.now(); (function chk() { if (v.videoWidth > 0 || Date.now() - t0 > 2500) return res(); setTimeout(chk, 50); })(); }); }
function privateEls() {
  var sel = 'input[type="password"],[data-feedback-private]' + (T().private ? "," + T().private : "");
  try { return doc.querySelectorAll(sel); } catch (e) { return doc.querySelectorAll('input[type="password"],[data-feedback-private]'); }
}
function blackout(x, sx, sy) {
  var list = privateEls();
  for (var i = 0; i < list.length; i++) {
    var r = list[i].getBoundingClientRect(); if (!r.width || !r.height) continue;
    x.fillStyle = "#20242E"; x.fillRect(r.left * sx, r.top * sy, r.width * sx, r.height * sy);
  }
}
function sample() {
  var v = cap.video; if (!v || !v.videoWidth || doc.hidden || ui.isOpen()) return;
  var w = 480, h = Math.round(v.videoHeight * w / v.videoWidth);
  var c = cap.ring.length >= 4 ? cap.ring.shift().c : doc.createElement("canvas");
  c.width = w; c.height = h;
  var x = c.getContext("2d"); x.drawImage(v, 0, 0, w, h); blackout(x, w / win.innerWidth, h / win.innerHeight);
  cap.ring.push({ c: c, t: Date.now() });
}
function cloneCanvas(c) { var d = doc.createElement("canvas"); d.width = c.width; d.height = c.height; d.getContext("2d").drawImage(c, 0, 0); return d; }
function grab() {
  return new Promise(function (res) {
    var v = cap.video; if (!v || !v.videoWidth) return res(null);
    var done = false, n = 0;
    host.style.visibility = "hidden";
    function snap() {
      if (done) return; done = true;
      try {
        var W = Math.min(1600, v.videoWidth), H = Math.round(v.videoHeight * W / v.videoWidth);
        var c = doc.createElement("canvas"); c.width = W; c.height = H;
        var x = c.getContext("2d"); x.drawImage(v, 0, 0, W, H); blackout(x, W / win.innerWidth, H / win.innerHeight);
        var now = Date.now(), frames = cap.ring.filter(function (r) { return now - r.t > 250; }).slice(-3).map(function (r) { return { c: cloneCanvas(r.c), ago: now - r.t }; });
        res({ c: c, W: W, H: H, frames: frames, vw: win.innerWidth, vh: win.innerHeight });
      } catch (e) { res(null); }
      finally { host.style.visibility = ""; }
    }
    if (v.requestVideoFrameCallback) {
      var tick = function () { n++; if (n >= 2) snap(); else v.requestVideoFrameCallback(tick); };
      win.requestAnimationFrame(function () { v.requestVideoFrameCallback(tick); });
    }
    setTimeout(snap, 380);
  });
}
function toBlob(c, q) { return new Promise(function (res) { try { c.toBlob(function (b) { res(b); }, "image/jpeg", q); } catch (e) { res(null); } }); }
function thumb(c, w) { try { var t = doc.createElement("canvas"); t.width = w; t.height = Math.round(c.height * w / c.width); t.getContext("2d").drawImage(c, 0, 0, t.width, t.height); return t.toDataURL("image/jpeg", 0.72); } catch (e) { return ""; } }
function compose(shot, spots) {
  var c = cloneCanvas(shot.c), x = c.getContext("2d");
  if (!spots.length) return c;
  var sx = shot.W / shot.vw, sy = shot.H / shot.vh, s0 = (sx + sy) / 2;
  x.save(); x.beginPath(); x.rect(0, 0, shot.W, shot.H);
  spots.forEach(function (s) { x.moveTo(s.x * sx + s.r * s0, s.y * sy); x.arc(s.x * sx, s.y * sy, s.r * s0, 0, Math.PI * 2, true); });
  x.fillStyle = "rgba(8,10,16,0.22)"; x.fill("evenodd"); x.restore();
  spots.forEach(function (s, i) {
    var cx = s.x * sx, cy = s.y * sy, r = s.r * s0;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.lineWidth = 5 * s0; x.strokeStyle = "rgba(10,12,18,0.5)"; x.stroke();
    x.lineWidth = 2.5 * s0; x.strokeStyle = "#F5C04A"; x.stroke();
    var px = cx - r * 0.707, py = cy - r * 0.707;
    x.beginPath(); x.arc(px, py, 12 * s0, 0, Math.PI * 2); x.fillStyle = "#F5C04A"; x.fill();
    x.fillStyle = "#1B1F2A"; x.font = "bold " + Math.round(14 * s0) + "px system-ui, sans-serif"; x.textAlign = "center"; x.textBaseline = "middle";
    x.fillText(String(i + 1), px, py + 0.5 * s0);
  });
  return c;
}

/* ---------- what is under a spotlight ---------- */
var ACTIONABLE = "button,a,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[role=switch],[role=option],[data-act]";
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
  var tag = n.tagName.toLowerCase();
  if (/^(input|textarea|select)$/.test(tag)) return "the field " + fieldName(n);
  if (n.isContentEditable) return "an editable area";
  return clip(n.getAttribute("aria-label") || n.getAttribute("alt") || n.getAttribute("title") || n.innerText || n.textContent || "", 80);
}
function describe(x, y) {
  var list = [];
  var was = host.style.display; host.style.display = "none";
  try { list = doc.elementsFromPoint ? doc.elementsFromPoint(x, y) : (doc.elementFromPoint ? [doc.elementFromPoint(x, y)] : []); } catch (e) { list = []; }
  host.style.display = was;
  var hit = null;
  for (var i = 0; i < (list || []).length; i++) {
    var c = list[i];
    if (c && c.nodeType === 1 && c !== doc.documentElement && c !== doc.body && !(c.closest && c.closest("[data-epkit]"))) { hit = c; break; }
  }
  if (!hit) return { tag: "page", text: "", path: "" };
  var m = (hit.closest && hit.closest(ACTIONABLE)) || hit;
  if (m.ownerSVGElement) m = (m.ownerSVGElement.closest && m.ownerSVGElement.closest(ACTIONABLE)) || m.ownerSVGElement;
  return { tag: m.tagName.toLowerCase(), role: m.getAttribute("role") || "", text: scrub(textOf(m)), path: pathOf(m) };
}
function descLine(d) {
  if (!d || d.tag === "page") return "the page itself";
  return (d.role || d.tag) + (d.text ? ' "' + d.text + '"' : "") + (d.path ? " (" + d.path + ")" : "");
}

/* ---------- the panel ---------- */
var host = el("div");
host.setAttribute("data-epkit", "feedback");
host.setAttribute("data-clarity-mask", "true");
var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
var CSS_TEXT = [
  ":host{all:initial}",
  "*{box-sizing:border-box}",
  ".k{font:14px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;color:#F2F0EA}",
  "button{font:inherit;cursor:pointer}",
  ".dot{position:fixed;z-index:2147483500;width:30px;height:30px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}",
  ".dot.c{width:44px;height:44px}",
  ".dot i{display:block;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle at 50% 42%,#FFF4CF 0,#F5C04A 58%,#D9A22A 100%);box-shadow:0 0 0 1px rgba(20,24,33,.32),0 0 8px 2px rgba(245,192,74,.28);opacity:.62;transition:transform .2s ease,opacity .2s ease,box-shadow .2s ease}",
  ".dot:hover i,.dot:focus-visible i{transform:scale(2.3);opacity:1;box-shadow:0 0 0 .5px rgba(20,24,33,.4),0 0 14px 5px rgba(245,192,74,.4)}",
  ".dot:focus-visible{outline:none}",
  ".dot.pulse i{animation:pulse 1.1s ease-out}",
  "@keyframes pulse{0%{transform:scale(1);box-shadow:0 0 0 1px rgba(20,24,33,.32),0 0 0 0 rgba(245,192,74,.7)}40%{transform:scale(2.4);opacity:1}100%{transform:scale(1);box-shadow:0 0 0 1px rgba(20,24,33,.32),0 0 0 22px rgba(245,192,74,0)}}",
  ".bl{left:calc(6px + env(safe-area-inset-left));bottom:calc(6px + env(safe-area-inset-bottom))}",
  ".br{right:calc(6px + env(safe-area-inset-right));bottom:calc(6px + env(safe-area-inset-bottom))}",
  ".bc{left:50%;margin-left:-15px;bottom:calc(6px + env(safe-area-inset-bottom))}.dot.c.bc{margin-left:-22px}",
  ".tl{left:calc(6px + env(safe-area-inset-left));top:calc(6px + env(safe-area-inset-top))}",
  ".tr{right:calc(6px + env(safe-area-inset-right));top:calc(6px + env(safe-area-inset-top))}",
  ".said{position:fixed;z-index:2147483501;padding:5px 11px;border-radius:9px;background:#1B1F2A;color:#F2F0EA;font-size:12.5px;font-weight:600;box-shadow:0 6px 20px rgba(0,0,0,.3);opacity:0;transform:translateY(4px);transition:opacity .2s,transform .2s;pointer-events:none}",
  ".said.on{opacity:1;transform:none}",
  ".mark{position:fixed;inset:0;z-index:2147483520;cursor:crosshair;touch-action:none}",
  ".dim{position:absolute;inset:0;background:rgba(8,10,16,.2);transition:background .2s}",
  ".dim.on{background:rgba(8,10,16,.52)}",
  ".ring{position:absolute;border-radius:50%;box-shadow:0 0 0 2px #F5C04A,0 0 0 5px rgba(10,12,18,.32),0 0 30px 6px rgba(255,214,120,.22);cursor:move}",
  ".ring b{position:absolute;left:14.6%;top:14.6%;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:#F5C04A;color:#1B1F2A;font:700 12px/22px system-ui,sans-serif;text-align:center;pointer-events:none}",
  ".ring .rs{position:absolute;right:14.6%;bottom:14.6%;width:18px;height:18px;margin:0 -9px -9px 0;border-radius:50%;background:#F5C04A;box-shadow:0 0 0 3px rgba(10,12,18,.35);cursor:nwse-resize}",
  ".ring .rm{position:absolute;right:14.6%;top:14.6%;width:24px;height:24px;margin:-12px -12px 0 0;border-radius:50%;border:0;background:#1B1F2A;color:#F2F0EA;font-size:15px;line-height:24px;padding:0;box-shadow:0 0 0 1px rgba(255,255,255,.25)}",
  ".card{position:fixed;z-index:2147483550;width:min(388px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;background:rgba(27,31,42,.97);border-radius:16px;padding:16px;box-shadow:0 22px 64px rgba(0,0,0,.42),inset 0 0 0 1px rgba(255,255,255,.07);transition:left .24s ease,top .24s ease}",
  ".card.narrow{left:12px!important;right:12px;width:auto}",
  ".card.bar{width:auto;max-width:calc(100vw - 24px);display:flex;align-items:center;gap:14px;padding:8px 8px 8px 16px;border-radius:14px}",
  ".card.bar p{margin:0;color:#FFFFFF;font-weight:600}",
  ".card.bar .row{margin:0;flex-wrap:nowrap}",
  "h2{margin:0 0 6px;font-size:17px;line-height:1.3;font-weight:650;color:#FFFFFF}",
  "p{margin:0 0 10px;color:#C2C7D1}",
  "p.small{font-size:13px;color:#A4AAB7}",
  "textarea{display:block;width:100%;min-height:104px;resize:vertical;margin:0;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.06);color:#FFFFFF;font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
  "textarea::placeholder{color:#8F96A5}",
  "textarea:focus{outline:none;border-color:#F5C04A;box-shadow:0 0 0 3px rgba(245,192,74,.24)}",
  ".hint{margin:8px 0 0;font-size:13px;color:#A4AAB7}",
  ".tip{margin:6px 0 0;font-size:13px;color:#E3CF97}",
  ".stat{margin:0 0 10px;font-size:13px;color:#E3CF97}",
  ".shot{display:flex;align-items:center;gap:12px;margin:0 0 12px}",
  ".shot img{width:96px;height:auto;border-radius:6px;box-shadow:0 0 0 1px rgba(255,255,255,.16)}",
  ".shot.off img{opacity:.3}",
  ".shot span{flex:1;font-size:13px;color:#C2C7D1}",
  ".row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}",
  ".grow{flex:1}",
  ".b{min-height:38px;padding:0 14px;border-radius:10px;border:1px solid rgba(255,255,255,.2);background:transparent;color:#F2F0EA;font-weight:600}",
  ".b:hover{border-color:rgba(255,255,255,.4)}",
  ".b.p{background:#F5C04A;border-color:#F5C04A;color:#1B1F2A}",
  ".b:disabled{opacity:.42;cursor:default}",
  ".lk{border:0;background:none;padding:4px 0;color:#E9E6DD;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(255,255,255,.3);font-size:13px}",
  ".top{display:flex;align-items:baseline;gap:10px}.top h2{flex:1}",
  ".x{width:32px;height:32px;margin:-6px -6px 0 0;border-radius:50%;border:0;background:transparent;color:#C2C7D1;font-size:20px;line-height:1;padding:0}",
  ".x:hover{background:rgba(255,255,255,.08)}",
  ".list{display:flex;flex-direction:column;gap:6px;margin:6px 0 4px}",
  ".item{display:flex;gap:10px;align-items:flex-start;width:100%;text-align:left;padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:inherit}",
  ".item:hover{border-color:rgba(245,192,74,.6)}",
  ".item img,.item i{flex:none;width:64px;height:40px;border-radius:5px;object-fit:cover;background:rgba(255,255,255,.07)}",
  ".item div{flex:1;min-width:0}",
  ".item span{font-size:13.5px;color:#F2F0EA;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}",
  ".item small{display:block;margin-top:2px;font-size:12px;color:#A4AAB7}",
  ".big img{display:block;width:100%;border-radius:8px;margin:0 0 10px;box-shadow:0 0 0 1px rgba(255,255,255,.14)}",
  ".meta{margin:0 0 8px;font-size:12.5px;color:#A4AAB7}",
  ":focus-visible{outline:3px solid #F5C04A;outline-offset:2px}",
  "@media (prefers-reduced-motion:reduce){.card,.dot i,.said,.dim{transition:none}.dot.pulse i{animation:none}}"
].join("\n");
var wrapEl = el("div", "k");
var styleEl = el("style"); styleEl.textContent = CSS_TEXT;
root.appendChild(styleEl); root.appendChild(wrapEl);

var POS = { "bottom-left": "bl", "bottom-right": "br", "bottom-center": "bc", "top-left": "tl", "top-right": "tr" };
var dotPos = POS[T().dot] || "bl";
var dot = btn("dot " + dotPos + (coarse() ? " c" : ""), null, function () { openNote(); });
dot.appendChild(el("i"));
dot.setAttribute("aria-label", "Add a feedback note"); dot.title = "Add a feedback note";
var said = el("div", "said"); said.setAttribute("aria-live", "polite");
var mark = el("div", "mark"), dim = el("div", "dim");
mark.appendChild(dim); mark.hidden = true;
var card = el("div", "card"); card.hidden = true;
card.setAttribute("role", "dialog"); card.setAttribute("aria-modal", "true"); card.setAttribute("aria-label", "Feedback note");
wrapEl.appendChild(mark); wrapEl.appendChild(card); wrapEl.appendChild(dot); wrapEl.appendChild(said);

/* Keys and clicks inside the panel never reach the tool's own shortcuts. */
["keydown", "keyup", "keypress", "click", "pointerdown", "mousedown", "touchstart", "input", "change"].forEach(function (t) {
  root.addEventListener(t, function (e) { e.stopPropagation(); }, false);
});
mark.addEventListener("wheel", function (e) { e.preventDefault(); }, { passive: false });

var state = { open: false, view: "", draft: null, spots: [], drag: null, last: null, count: 0, text: "" };
var ui = {
  isOpen: function () { return state.open; },
  status: function () { if (state.open && state.view === "note") renderNote(true); }
};

function sayIt(t) {
  said.textContent = t;
  var r = dot.getBoundingClientRect(), left = r.right + 4, top = r.top + r.height / 2 - 13;
  if (dotPos === "br" || dotPos === "tr") left = r.left - 4 - 120;
  said.style.left = clamp(left, 6, win.innerWidth - 140) + "px"; said.style.top = clamp(top, 6, win.innerHeight - 32) + "px";
  said.classList.add("on"); dot.classList.remove("pulse"); void dot.offsetWidth; dot.classList.add("pulse");
  clearTimeout(sayIt.t); sayIt.t = setTimeout(function () { said.classList.remove("on"); }, 1800);
}
function refreshCount() {
  return store.all().then(function (list) {
    state.count = list.length;
    dot.title = "Add a feedback note" + (list.length ? " (" + plural(list.length, "note") + " saved)" : "");
    return list;
  });
}

function show(view) {
  state.view = view; state.open = true; card.hidden = false; card.textContent = "";
  card.className = "card" + (view === "point" ? " bar" : "");
  doc.addEventListener("keydown", onKey, true);
}
function close() {
  state.open = false; state.view = ""; card.hidden = true; mark.hidden = true; card.textContent = "";
  state.spots = []; paintSpots();
  doc.removeEventListener("keydown", onKey, true);
  try { if (state.last && state.last.focus && state.last !== doc.body) state.last.focus({ preventScroll: true }); } catch (e) {}
}
function onKey(e) {
  if (!state.open) return;
  e.stopPropagation();
  if (e.key === "Escape") { e.preventDefault(); if (state.view === "note") keepDraft(); if (state.view === "point") state.draft = null; close(); return; }
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && state.view === "note") { e.preventDefault(); saveNote(); return; }
  if (e.key === "Tab") {
    var f = Array.prototype.slice.call(card.querySelectorAll("button,textarea")).filter(function (n) { return !n.disabled; });
    if (!f.length) return;
    var a = root.activeElement, i = f.indexOf(a);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  }
}
function keepDraft() { var ta = card.querySelector("textarea"); if (ta) state.text = ta.value; }

function placeCard() {
  if (card.hidden) return;
  var W = win.innerWidth, H = win.innerHeight, m = 16;
  if (state.view === "point") {
    var bw = card.offsetWidth || 320, bh = card.offsetHeight || 54, top = /^t/.test(dotPos);
    var bx = dotPos === "bc" ? (W - bw) / 2 : /l$/.test(dotPos) ? m : W - bw - m;
    card.style.left = Math.round(Math.max(8, bx)) + "px"; card.style.top = Math.round(top ? m : H - bh - m) + "px";
    return;
  }
  if (W < 560) {
    card.classList.add("narrow");
    var low = state.spots.some(function (s) { return s.y > H * 0.45; });
    var ch = card.offsetHeight || 260;
    card.style.top = (low ? 12 : Math.max(12, H - ch - 12)) + "px"; card.style.left = "12px";
    return;
  }
  card.classList.remove("narrow");
  var cw = card.offsetWidth || 388, ch2 = card.offsetHeight || 260;
  var spots = { bl: [m, H - ch2 - m], br: [W - cw - m, H - ch2 - m], bc: [(W - cw) / 2, H - ch2 - m], tl: [m, m], tr: [W - cw - m, m] };
  var order = { bl: ["bl", "br", "tl", "tr"], br: ["br", "bl", "tr", "tl"], bc: ["bc", "br", "bl", "tr", "tl"], tl: ["tl", "tr", "bl", "br"], tr: ["tr", "tl", "br", "bl"] }[dotPos];
  var best = null, bestScore = Infinity;
  order.forEach(function (k, i) {
    var p = spots[k], score = i * 0.001;
    state.spots.forEach(function (s) {
      var ox = Math.max(0, Math.min(p[0] + cw, s.x + s.r) - Math.max(p[0], s.x - s.r));
      var oy = Math.max(0, Math.min(p[1] + ch2, s.y + s.r) - Math.max(p[1], s.y - s.r));
      score += ox * oy;
    });
    if (score < bestScore) { bestScore = score; best = p; }
  });
  card.style.left = Math.round(Math.max(8, best[0])) + "px"; card.style.top = Math.round(Math.max(8, best[1])) + "px";
}

/* ---------- spotlights ---------- */
function paintSpots() {
  Array.prototype.slice.call(mark.querySelectorAll(".ring")).forEach(function (r) { r.remove(); });
  var on = state.spots.length > 0;
  dim.classList.toggle("on", on);
  if (on) {
    var masks = state.spots.map(function (s) {
      return "radial-gradient(circle at " + Math.round(s.x) + "px " + Math.round(s.y) + "px, transparent " + Math.max(0, Math.round(s.r - 4)) + "px, #000 " + Math.round(s.r + 16) + "px)";
    }).join(",");
    dim.style.webkitMaskImage = masks; dim.style.maskImage = masks;
    dim.style.webkitMaskComposite = "source-in"; dim.style.maskComposite = "intersect";
  } else { dim.style.webkitMaskImage = ""; dim.style.maskImage = ""; }
  state.spots.forEach(function (s, i) {
    var r = el("div", "ring");
    r.style.left = Math.round(s.x - s.r) + "px"; r.style.top = Math.round(s.y - s.r) + "px";
    r.style.width = r.style.height = Math.round(s.r * 2) + "px";
    r.appendChild(el("b", null, String(i + 1)));
    var rs = el("i", "rs"); rs.setAttribute("data-i", i); r.appendChild(rs);
    var rm = btn("rm", "\u00d7", function (e) { e.stopPropagation(); state.spots.splice(i, 1); paintSpots(); hint(); placeCard(); });
    rm.setAttribute("aria-label", "Remove spotlight " + (i + 1)); r.appendChild(rm);
    mark.appendChild(r);
  });
}
mark.addEventListener("pointerdown", function (e) {
  if (e.button > 0 || (e.target && e.target.classList && e.target.classList.contains("rm"))) return;
  var x = e.clientX, y = e.clientY, idx = -1, mode = "move";
  for (var i = 0; i < state.spots.length; i++) {
    var s = state.spots[i], d = Math.sqrt((x - s.x) * (x - s.x) + (y - s.y) * (y - s.y));
    if ((e.target && e.target.classList && e.target.classList.contains("rs") && +e.target.getAttribute("data-i") === i) || Math.abs(d - s.r) < 12) { idx = i; mode = "size"; break; }
    if (d < s.r && idx < 0) idx = i;
  }
  if (idx < 0) {
    if (state.spots.length < 2) { state.spots.push({ x: x, y: y, r: coarse() ? 56 : 66 }); idx = state.spots.length - 1; }
    else { idx = state.spots.length - 1; state.spots[idx].x = x; state.spots[idx].y = y; }
    mode = "move";
  }
  var sp = state.spots[idx];
  state.drag = { i: idx, mode: mode, dx: x - sp.x, dy: y - sp.y };
  try { if (mark.setPointerCapture && e.pointerId != null) mark.setPointerCapture(e.pointerId); } catch (er) {}
  e.preventDefault(); paintSpots(); hint();
});
mark.addEventListener("pointermove", function (e) {
  var d = state.drag; if (!d) return;
  var s = state.spots[d.i]; if (!s) return;
  if (d.mode === "move") { s.x = clamp(e.clientX - d.dx, 0, win.innerWidth); s.y = clamp(e.clientY - d.dy, 0, win.innerHeight); }
  else { s.r = clamp(Math.sqrt((e.clientX - s.x) * (e.clientX - s.x) + (e.clientY - s.y) * (e.clientY - s.y)), 22, 420); }
  paintSpots();
});
function endDrag() {
  if (!state.drag) return; state.drag = null; paintSpots();
  if (state.view === "point") { renderNote(); return; }
  placeCard(); hint();
}
mark.addEventListener("pointerup", endDrag);
mark.addEventListener("pointercancel", endDrag);

function hint() {
  var h = card.querySelector(".hint"); if (!h) return;
  var n = state.spots.length, verb = coarse() ? "Tap" : "Click";
  h.textContent = n === 0 ? "Optional: " + verb.toLowerCase() + " the screen to spotlight what this is about." :
    n === 1 ? "Drag to move it, or pull its edge to resize. You can add one more." : "Drag to move, or pull an edge to resize.";
}
function tipText() {
  var ua = navigator.userAgent || "";
  if (/iPhone|iPad|iPod|Android/.test(ua) || coarse()) return "Rather talk? Tap the mic on your keyboard.";
  if (/Windows/.test(ua)) return "Rather talk? Press Windows + H to dictate.";
  if (/CrOS/.test(ua)) return "Rather talk? Press Search + D to dictate.";
  if (/Mac OS X|Macintosh/.test(ua)) return "Rather talk? Press Fn twice, or the mic key, to dictate.";
  return "";
}

/* ---------- views ---------- */
function introSeen() { return ss(function (s) { return s.getItem(INTRO_KEY) === "1"; }) === true; }
function markIntro() { ss(function (s) { s.setItem(INTRO_KEY, "1"); }); }

function openNote() {
  if (state.open) return;
  var a = doc.activeElement; state.last = a && a !== host ? a : null;
  if (!introSeen()) { renderIntro(); return; }
  beginNote();
}
function renderIntro() {
  show("intro");
  card.appendChild(el("h2", null, "Feedback mode is on"));
  if (picturesPossible()) {
    card.appendChild(el("p", null, "Tap the dot whenever something is worth a note. Each note can include a picture of this tab, so the team sees what you saw."));
    card.appendChild(el("p", "small", "Your browser asks once per visit: choose This tab, then Allow. Pictures show everything on screen, so test with made-up names and details."));
    var r = el("div", "row"); r.appendChild(el("span", "grow"));
    r.appendChild(btn("b", "Notes only", function () { markIntro(); beginNote(); }));
    var go = btn("b p", "Share this tab", function () {
      markIntro(); go.disabled = true;
      startCapture().then(function (res) { beginNote(capMsg(res)); });
    });
    r.appendChild(go); card.appendChild(r); go.focus();
  } else {
    card.appendChild(el("p", null, "Tap the dot whenever something is worth a note. Each note records the screen you were on and your device, so the team can find what you mean."));
    if (!coarse()) card.appendChild(el("p", "small", "Pictures of the screen work in Chrome and Edge on a computer."));
    var r2 = el("div", "row"); r2.appendChild(el("span", "grow"));
    var ok = btn("b p", "Got it", function () { markIntro(); beginNote(); }); r2.appendChild(ok); card.appendChild(r2); ok.focus();
  }
  mark.hidden = true; placeCard();
}
function capMsg(res) {
  return res === "on" ? "" : res === "denied" ? "Pictures are off for now. Notes still work." :
    res === "wrong" ? "That shared something other than this tab, so pictures are off. You can try again below." :
    res === "stopped" ? "Picture sharing stopped. You can turn it back on below." : res ? "Pictures didn't start here. Notes still work." : "";
}
function beginNote(msg) {
  var ctx = context();
  var p = cap.state === "on" ? grab() : Promise.resolve(null);
  return p.then(function (shot) {
    state.draft = { id: uid(), created: Date.now(), ctx: ctx, shot: shot, dropShot: false, msg: msg || "" };
    state.spots = [];
    renderPoint();
  });
}
function renderPoint() {
  show("point");
  card.setAttribute("aria-label", "Point to what the note is about");
  card.appendChild(el("p", null, (coarse() ? "Tap" : "Click") + " what this note is about."));
  var r = el("div", "row");
  var sk = btn("b", "Skip", function () { renderNote(); }); r.appendChild(sk);
  var x = btn("x", "\u00d7", function () { state.draft = null; close(); }); x.setAttribute("aria-label", "Cancel the note"); r.appendChild(x);
  card.appendChild(r);
  mark.hidden = false; paintSpots(); placeCard();
  try { sk.focus({ preventScroll: true }); } catch (e) { sk.focus(); }
}
function renderNote(keep) {
  var d = state.draft; if (!d) return;
  var text = keep ? ((card.querySelector("textarea") || {}).value || "") : state.text;
  show("note");
  card.setAttribute("aria-label", "Feedback note"); mark.hidden = false;
  if (d.msg) card.appendChild(el("p", "stat", d.msg));
  if (d.shot) {
    var s = el("div", "shot" + (d.dropShot ? " off" : "")), im = el("img");
    im.alt = "Picture of this tab"; im.src = thumb(d.shot.c, 200); s.appendChild(im);
    s.appendChild(el("span", null, d.dropShot ? "Picture left out" : "A picture of this tab goes with the note"));
    s.appendChild(btn("lk", d.dropShot ? "Put it back" : "Leave it out", function () { d.dropShot = !d.dropShot; renderNote(true); }));
    card.appendChild(s);
  } else if (picturesPossible() && cap.state !== "on" && cap.state !== "asking") {
    var s2 = el("div", "shot"); s2.appendChild(el("span", null, "No picture with this note."));
    s2.appendChild(btn("lk", "Add pictures", function () {
      keepDraft();
      startCapture().then(function (res) {
        if (res !== "on") { d.msg = capMsg(res); renderNote(true); return; }
        grab().then(function (shot) { d.shot = shot; d.msg = ""; renderNote(true); });
      });
    }));
    card.appendChild(s2);
  }
  var ta = el("textarea"); ta.placeholder = "What did you notice?"; ta.setAttribute("aria-label", "Your note"); ta.maxLength = 4000; ta.value = text;
  card.appendChild(ta);
  card.appendChild(el("p", "hint"));
  var tips = +(ls(function (l) { return l.getItem(TIP_KEY); }) || 0), tt = tipText();
  if (tt && tips < 3) card.appendChild(el("p", "tip", tt));
  if (!store.persistent()) card.appendChild(el("p", "hint", "Notes stay only while this tab is open, so send them before you close it."));
  var r = el("div", "row");
  r.appendChild(btn("lk", "Your notes" + (state.count ? " (" + state.count + ")" : ""), function () { keepDraft(); renderList(); }));
  r.appendChild(el("span", "grow"));
  r.appendChild(btn("b", "Cancel", function () { state.text = ""; state.draft = null; close(); }));
  var save = btn("b p", "Save note", saveNote); save.disabled = !ta.value.trim();
  r.appendChild(save); card.appendChild(r);
  ta.addEventListener("input", function () { save.disabled = !ta.value.trim(); });
  hint(); placeCard();
  try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
}
function saveNote() {
  var d = state.draft, ta = card.querySelector("textarea"); if (!d || !ta) return;
  var text = ta.value.trim(); if (!text) return;
  var spots = state.spots.map(function (s) {
    return { x: Math.round(s.x), y: Math.round(s.y), r: Math.round(s.r), xp: Math.round(100 * s.x / win.innerWidth), yp: Math.round(100 * s.y / win.innerHeight), el: describe(s.x, s.y) };
  });
  var note = { id: d.id, tool: toolId(), created: d.created, updated: Date.now(), text: text.slice(0, 4000), spots: spots, ctx: d.ctx, shot: null, frames: [] };
  var work = Promise.resolve();
  if (d.shot && !d.dropShot) {
    var c = compose(d.shot, state.spots);
    note.thumb = thumb(c, 240); note.shotW = c.width; note.shotH = c.height;
    var fr = d.shot.frames || [];
    if (fr.length) { note.frameW = fr[0].c.width; note.frameH = fr[0].c.height; note.framesAgo = fr.map(function (f) { return f.ago; }); }
    work = Promise.all([toBlob(c, 0.82)].concat(fr.map(function (f) { return toBlob(f.c, 0.72); }))).then(function (bl) {
      note.shot = bl[0]; note.frames = bl.slice(1).filter(Boolean);
      if (!note.shot) { note.shotW = note.shotH = 0; note.thumb = ""; }
    });
  }
  state.text = ""; state.draft = null;
  close();
  return work.then(function () { return store.put(note); }).then(function () {
    ls(function (l) { l.setItem(TIP_KEY, String(+(l.getItem(TIP_KEY) || 0) + 1)); });
    return refreshCount();
  }).then(function () { sayIt("Saved"); });
}
function renderList() {
  return refreshCount().then(function (list) {
    show("list");
    var top = el("div", "top"); top.appendChild(el("h2", null, "Your notes" + (list.length ? " (" + list.length + ")" : "")));
    var x = btn("x", "\u00d7", function () { if (state.draft) renderNote(); else close(); });
    x.setAttribute("aria-label", state.draft ? "Back to the note" : "Close"); top.appendChild(x); card.appendChild(top);
    if (!list.length) card.appendChild(el("p", null, "No notes yet. Tap the dot whenever something is worth saying."));
    var box = el("div", "list");
    list.slice().reverse().forEach(function (n) {
      var it = btn("item", null, function () { renderEdit(n); });
      if (n.thumb && /^data:image\//.test(n.thumb)) { var im = el("img"); im.alt = ""; im.src = n.thumb; it.appendChild(im); } else it.appendChild(el("i"));
      var tx = el("div"); tx.appendChild(el("span", null, n.text));
      tx.appendChild(el("small", null, (n.ctx && n.ctx.screen ? "On " + n.ctx.screen + ", " : "") + hm(n.created)));
      it.appendChild(tx); box.appendChild(it);
    });
    card.appendChild(box);
    if (!store.persistent() && list.length) card.appendChild(el("p", "hint", "These stay only while this tab is open. Send them before you close it."));
    var r = el("div", "row");
    r.appendChild(btn("lk", "Turn off feedback", turnOff));
    r.appendChild(el("span", "grow"));
    var send = btn("b p", list.length ? "Send " + plural(list.length, "note") : "Send", function () { sendNotes(); });
    send.disabled = !list.length; r.appendChild(send);
    card.appendChild(r);
    mark.hidden = !state.draft; placeCard();
    (send.disabled ? x : send).focus();
  });
}
function renderEdit(n) {
  show("edit");
  var top = el("div", "top"); top.appendChild(el("h2", null, "Edit note"));
  var x = btn("x", "\u00d7", function () { renderList(); }); x.setAttribute("aria-label", "Back to your notes"); top.appendChild(x); card.appendChild(top);
  if (n.thumb && /^data:image\//.test(n.thumb)) { var b = el("div", "big"), im = el("img"); im.alt = "Picture saved with this note"; im.src = n.thumb; b.appendChild(im); card.appendChild(b); }
  card.appendChild(el("p", "meta", (n.ctx && n.ctx.screen ? "On " + n.ctx.screen + ", " : "") + hm(n.created) + (n.spots && n.spots.length ? ", " + plural(n.spots.length, "spotlight") : "")));
  var ta = el("textarea"); ta.value = n.text; ta.maxLength = 4000; ta.setAttribute("aria-label", "Your note"); card.appendChild(ta);
  var r = el("div", "row");
  var del = btn("lk", "Delete", function () {
    if (del.getAttribute("data-armed")) { store.del(n.id).then(renderList); return; }
    del.setAttribute("data-armed", "1"); del.textContent = "Tap again to delete";
    setTimeout(function () { if (del.isConnected) { del.removeAttribute("data-armed"); del.textContent = "Delete"; } }, 3500);
  });
  r.appendChild(del); r.appendChild(el("span", "grow"));
  r.appendChild(btn("b", "Back", function () { renderList(); }));
  var sv = btn("b p", "Save changes", function () {
    var t = ta.value.trim(); if (!t) return;
    n.text = t.slice(0, 4000); n.updated = Date.now(); store.put(n).then(renderList);
  });
  r.appendChild(sv); card.appendChild(r);
  ta.addEventListener("input", function () { sv.disabled = !ta.value.trim(); });
  mark.hidden = true; placeCard(); ta.focus();
}
function turnOff() {
  stopCapture();
  ss(function (s) { s.removeItem(FB.flag || "ep-feedback"); s.removeItem(INTRO_KEY); });
  FB.on = false; close(); host.remove();
  win.removeEventListener("beforeunload", onLeave);
}
function onLeave(e) {
  if (K._leaving && Date.now() - K._leaving < 2000) return;
  if (!store.persistent() && state.count > 0) { e.preventDefault(); e.returnValue = ""; return ""; }
}
win.addEventListener("beforeunload", onLeave);

/* ---------- sending ---------- */
function fileName() { return "feedback-" + toolId() + "-" + isoDay(Date.now()) + ".pdf"; }
function subjectFor(notes) { return "Feedback on " + toolName() + " (" + plural(notes.length, "note") + ")"; }
function ctxLines(c) {
  var L = [], d = c.device || {};
  L.push("Screen: " + (c.screen || "not reported") + (c.heading ? ' ("' + c.heading + '")' : "") + (c.scroll ? ", scrolled " + c.scroll + " px" : ""));
  var st = Object.keys(c.settings || {}).map(function (k) { return k + " " + c.settings[k]; }).join("; ");
  if (st) L.push("Settings: " + st);
  L.push("Page: " + c.page);
  L.push("Time: " + hms(c.at) + ", " + dayStr(c.at) + (c.tz ? " (" + c.tz + ")" : ""));
  L.push("Device: " + d.browser + " on " + d.os + "; window " + d.window + "; screen " + d.screen + "; " + d.input + "; " + d.language + "; " + d.theme + " theme" + (d.reducedMotion === "yes" ? "; reduced motion on" : "") + (d.online === "offline" ? "; offline" : ""));
  L.push("Version: " + (c.version ? c.name + " " + c.version + ", " : "") + "feedback kit " + c.kit);
  return L;
}
function bodyText(notes, complete) {
  var L = [];
  L.push("Feedback on " + toolName() + ": " + plural(notes.length, "note") + " from " + dayStr(notes[0].created) + ".");
  if (!complete) L.push("The attached PDF has each note with its picture and details.");
  notes.forEach(function (n, i) {
    L.push("");
    L.push((i + 1) + ". " + (n.ctx && n.ctx.screen ? "On " + n.ctx.screen + " at " : "At ") + hm(n.created) + ":");
    L.push(complete ? n.text : clip(n.text, 180));
    if (complete) {
      (n.spots || []).forEach(function (s, k) { L.push("Tapped " + (k + 1) + ": " + descLine(s.el) + ", " + s.xp + "% across and " + s.yp + "% down"); });
      ctxLines(n.ctx).forEach(function (l) { L.push(l); });
      var a = (n.ctx.actions || []).map(function (x) { return x.t + " " + x.what; });
      L.push("Recent actions: " + (a.length ? a.join("; ") : "none"));
      var er = (n.ctx.errors || []).map(function (x) { return x.t + " " + x.what; });
      L.push("Page errors: " + (er.length ? er.join("; ") : "none"));
    }
  });
  L.push("");
  L.push("Made with the ExperiencePoint feedback kit.");
  return L.join("\n");
}
function sendNotes() {
  return store.all().then(function (notes) {
    if (!notes.length) return;
    var pics = notes.some(function (n) { return !!n.shot; });
    close();
    var opts = {
      heading: "Send your notes",
      lead: pics ? "They go to the product team as one PDF, from your own email." : "They go to the product team from your own email. A PDF copy is ready too.",
      to: [TO], subject: subjectFor(notes), body: bodyText(notes, !pics), complete: !pics,
      files: function () { return buildPdf(notes).then(function (blob) { return [{ name: fileName(), blob: blob }]; }); },
      confirmSent: true, theme: "dark", accent: "#F5C04A", accentInk: "#1B1F2A",
      onSent: function () { Promise.all(notes.map(function (n) { return store.del(n.id); })).then(refreshCount).then(function () { sayIt("Sent. Thank you"); }); }
    };
    if (K.email) return K.email(opts);
    return opts.files().then(function (f) {
      var a = doc.createElement("a"), u = URL.createObjectURL(f[0].blob); a.href = u; a.download = f[0].name; doc.body.appendChild(a); a.click(); a.remove();
      K._leaving = Date.now();
      location.href = "mailto:" + TO + "?subject=" + encodeURIComponent(opts.subject) + "&body=" + encodeURIComponent(opts.body.slice(0, 1800).replace(/\n/g, "\r\n"));
    });
  });
}

/* ---------- PDF: one cover page, then one page per note ---------- */
/* Helvetica widths for WinAnsi codes 32 to 255 (Adobe's metrics). */
var HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,761,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,500];
var HBW = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,761,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,556];
var WIN = { 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 };
function winCodes(s) {
  s = str(s); try { s = s.normalize("NFC"); } catch (e) {}
  var out = [];
  for (var i = 0; i < s.length; i++) {
    var c = s.codePointAt(i);
    if (c > 0xffff) { i++; out.push(63); continue; }
    if (c === 9 || c === 10 || c === 13) { out.push(32); continue; }
    if ((c >= 32 && c < 127) || (c >= 160 && c <= 255)) { out.push(c); continue; }
    if (WIN[c]) { out.push(WIN[c]); continue; }
    if (c < 32 || (c >= 127 && c < 160) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x200b && c <= 0x200f) || c === 0x2060 || c === 0xfeff) continue;
    if (c === 0x2192) { out.push(45, 62); continue; }
    var d = ""; try { d = String.fromCharCode(c).normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    out.push(d.length === 1 && d.charCodeAt(0) < 127 ? d.charCodeAt(0) : 63);
  }
  return out;
}
function tw(s, size, bold) { var W = bold ? HBW : HW, c = winCodes(s), t = 0; for (var i = 0; i < c.length; i++) t += W[c[i] - 32] || 556; return t * size / 1000; }
function wrap(text, size, bold, maxW) {
  var lines = [];
  str(text).split(/\r?\n/).forEach(function (para) {
    var words = para.split(/ +/), line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (tw(test, size, bold) <= maxW) { line = test; return; }
      if (line) lines.push(line);
      while (w.length > 1 && tw(w, size, bold) > maxW) {
        var k = w.length - 1; while (k > 1 && tw(w.slice(0, k), size, bold) > maxW) k--;
        lines.push(w.slice(0, k)); w = w.slice(k);
      }
      line = w;
    });
    lines.push(line);
  });
  return lines;
}
function pstr(s) {
  var c = winCodes(s), o = "(";
  for (var i = 0; i < c.length; i++) {
    var b = c[i];
    if (b === 40 || b === 41 || b === 92) o += "\\" + String.fromCharCode(b);
    else if (b >= 32 && b < 127) o += String.fromCharCode(b);
    else o += "\\" + ("00" + b.toString(8)).slice(-3);
  }
  return o + ")";
}
function latin(s) { var u = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
function n2(v) { return String(Math.round(v * 100) / 100); }
function Pdf() { this.objs = [null, null, null, null, null]; this.pages = []; }
Pdf.prototype.add = function (o) { this.objs.push(o); return this.objs.length; };
Pdf.prototype.page = function () { var p = { w: 792, h: 612, ops: [], imgs: {} }; this.pages.push(p); return p; };
Pdf.prototype.image = function (bytes, w, h) {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || !w || !h) return null;
  var id = this.add({ dict: "<< /Type /XObject /Subtype /Image /Width " + w + " /Height " + h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", stream: bytes });
  return { id: id, name: "Im" + id };
};
Pdf.prototype.bytes = function (info) {
  var self = this, pageIds = [];
  this.pages.forEach(function (p) {
    var cid = self.add({ dict: "<<", stream: latin(p.ops.join("\n")) });
    var xo = Object.keys(p.imgs).map(function (k) { return "/" + k + " " + p.imgs[k] + " 0 R"; }).join(" ");
    pageIds.push(self.add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + p.w + " " + p.h + "] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>" + (xo ? " /XObject << " + xo + " >>" : "") + " >> /Contents " + cid + " 0 R >>"));
  });
  var d = new Date(), stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  this.objs[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  this.objs[1] = "<< /Type /Pages /Kids [" + pageIds.map(function (i) { return i + " 0 R"; }).join(" ") + "] /Count " + pageIds.length + " >>";
  this.objs[2] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  this.objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  this.objs[4] = "<< /Title " + pstr(info.title) + " /Producer " + pstr(info.producer) + " /CreationDate (D:" + stamp + ") >>";
  var parts = [], off = 0, offs = [];
  function push(u) { parts.push(u); off += u.length; }
  push(latin("%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n"));
  this.objs.forEach(function (o, i) {
    offs[i] = off;
    if (typeof o === "string") { push(latin((i + 1) + " 0 obj\n" + o + "\nendobj\n")); return; }
    var dict = (o.dict === "<<" ? "<<" : o.dict) + " /Length " + o.stream.length + " >>";
    push(latin((i + 1) + " 0 obj\n" + dict + "\nstream\n")); push(o.stream); push(latin("\nendstream\nendobj\n"));
  });
  var xref = off, x = "xref\n0 " + (this.objs.length + 1) + "\n0000000000 65535 f \n";
  offs.forEach(function (o) { x += ("0000000000" + o).slice(-10) + " 00000 n \n"; });
  x += "trailer\n<< /Size " + (this.objs.length + 1) + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  push(latin(x));
  return parts;
};
var INK = "0.12 0.14 0.19", MUTED = "0.36 0.39 0.45", PW = 792, PH = 612, M = 36;
function text(p, x, y, s, size, bold, rgb) { p.ops.push("BT /" + (bold ? "F2" : "F1") + " " + n2(size) + " Tf " + rgb + " rg " + n2(x) + " " + n2(p.h - y) + " Td " + pstr(s) + " Tj ET"); }
function img(p, im, x, y, w, h) {
  if (!im) return; p.imgs[im.name] = im.id;
  p.ops.push("q " + n2(w) + " 0 0 " + n2(h) + " " + n2(x) + " " + n2(p.h - y - h) + " cm /" + im.name + " Do Q");
  p.ops.push("0.82 0.84 0.88 RG 0.6 w " + n2(x) + " " + n2(p.h - y - h) + " " + n2(w) + " " + n2(h) + " re S");
}
function rule(p, x, y, w) { p.ops.push("0.86 0.88 0.91 RG 0.6 w " + n2(x) + " " + n2(p.h - y) + " m " + n2(x + w) + " " + n2(p.h - y) + " l S"); }
function Flow(regions, more) { this.q = regions; this.more = more; this.next(); }
Flow.prototype.next = function () { this.r = this.q.shift() || this.more(); this.y = this.r.y; };
Flow.prototype.room = function (h) { if (this.y + h > this.r.bottom) this.next(); };
Flow.prototype.line = function (s, size, bold, rgb, dx) { var lead = size * 1.36; this.room(lead); text(this.r.page, this.r.x + (dx || 0), this.y + size, s, size, bold, rgb); this.y += lead; };
Flow.prototype.para = function (s, size, bold, rgb, after) { var me = this; wrap(s, size, bold, this.r.w).forEach(function (l) { me.line(l, size, bold, rgb); }); this.y += after || 0; };
Flow.prototype.kv = function (k, v, size) {
  size = size || 8.5; var lab = k + ": ", lw = tw(lab, size, true), lead = size * 1.36;
  var first = wrap(v, size, false, Math.max(40, this.r.w - lw)), rest = first.length > 1 ? wrap(first.slice(1).join(" "), size, false, this.r.w) : [];
  this.room(lead);
  text(this.r.page, this.r.x, this.y + size, lab, size, true, INK); text(this.r.page, this.r.x + lw, this.y + size, first[0] || "", size, false, MUTED);
  this.y += lead; var me = this; rest.forEach(function (l) { me.line(l, size, false, MUTED); });
};
function header(p, left, right) {
  text(p, M, M + 12, left, 12, true, INK);
  if (right) text(p, PW - M - tw(right, 9, false), M + 11, right, 9, false, MUTED);
  rule(p, M, M + 20, PW - 2 * M);
}
function cover(pdf, notes) {
  var p = pdf.page(), c = notes[0].ctx, pics = notes.some(function (n) { return n.shot; });
  var a = notes[0].created, b = notes[notes.length - 1].created;
  text(p, M, M + 26, "Feedback on " + c.name, 24, true, INK);
  text(p, M, M + 48, plural(notes.length, "note") + ", " + dayStr(a) + (isoDay(a) !== isoDay(b) ? " to " + dayStr(b) : hm(a) === hm(b) ? ", at " + hm(a) : ", " + hm(a) + " to " + hm(b)), 12, false, MUTED);
  rule(p, M, M + 62, PW - 2 * M);
  var more = function () { var q = pdf.page(); header(q, "Feedback on " + c.name + ", continued", ""); return { page: q, x: M, y: M + 34, w: PW - 2 * M, bottom: PH - M }; };
  var f = new Flow([{ page: p, x: M, y: M + 80, w: 470, bottom: PH - M }], more);
  f.para("About this file", 11, true, INK, 2);
  f.para("Each page after this one is one note a tester wrote while using " + c.name + ". A note has the tester's own words, " +
    (pics ? "a picture of their browser tab at that moment with up to two numbered spotlights on what it is about, " : "the spot they tapped, if any, ") +
    "the page element under each spotlight, and context: the screen, the tool's settings, the device, the tester's last few actions and any page errors.", 10, false, MUTED, 10);
  f.para("Reading it with an AI assistant", 11, true, INK, 2);
  f.para("Treat the tester's words as the main signal. The screen id and the element paths point to the matching code. Addresses have their keys and codes removed, and the action list records what was clicked, never what was typed. Pictures show whatever was on screen.", 10, false, MUTED, 10);
  f.para("The notes", 11, true, INK, 3);
  notes.forEach(function (n, i) { f.para((i + 1) + ". " + (n.ctx.screen ? "On " + n.ctx.screen + ": " : "") + clip(n.text, 160), 10, false, INK, 3); });
  var g = new Flow([{ page: p, x: M + 500, y: M + 80, w: PW - 2 * M - 500, bottom: PH - M }], more), d = c.device || {};
  g.para("Details", 11, true, INK, 4);
  g.kv("Tool", c.name + (c.version ? " " + c.version : ""), 9);
  g.kv("Page", c.page, 9);
  g.kv("Device", d.browser + " on " + d.os + ", window " + d.window, 9);
  g.kv("Feedback kit", c.kit, 9);
}
function secs(ms) { return (Math.round(ms / 100) / 10).toFixed(1) + " seconds"; }
function notePage(pdf, n, i, total, ims) {
  var p = pdf.page(), c = n.ctx, title = "Note " + (i + 1) + " of " + total, regions = [], top = M + 34;
  header(p, title, hm(n.created) + ", " + dayStr(n.created));
  if (ims.shot) {
    var s = Math.min(470 / n.shotW, 300 / n.shotH), w = n.shotW * s, h = n.shotH * s, yb = top + h;
    img(p, ims.shot, M, top, w, h);
    if (ims.frames.length && n.frameW) {
      var gap = 8, fw = (470 - gap * 2) / 3, fh = fw * n.frameH / n.frameW;
      text(p, M, yb + 18, "Just before", 9, true, INK);
      ims.frames.forEach(function (fi, k) {
        img(p, fi, M + k * (fw + gap), yb + 26, fw, fh);
        text(p, M + k * (fw + gap), yb + 26 + fh + 10, secs((n.framesAgo || [])[k] || 0) + " earlier", 7.5, false, MUTED);
      });
      yb += 26 + fh + 14;
    }
    regions.push({ page: p, x: M + 470 + 24, y: top, w: PW - M - (M + 470 + 24), bottom: PH - M });
    regions.push({ page: p, x: M, y: yb + 16, w: 470, bottom: PH - M });
  } else regions.push({ page: p, x: M, y: top, w: PW - 2 * M, bottom: PH - M });
  var f = new Flow(regions, function () { var q = pdf.page(); header(q, title + ", continued", ""); return { page: q, x: M, y: top, w: PW - 2 * M, bottom: PH - M }; });
  f.para(n.text, ims.shot ? 12 : 13, false, INK, 12);
  if (n.spots && n.spots.length) {
    f.para(ims.shot ? "Spotlights" : "Tapped", 9.5, true, INK, 1);
    n.spots.forEach(function (sp, k) { f.para((k + 1) + ". " + descLine(sp.el) + ", " + sp.xp + "% across and " + sp.yp + "% down", 8.5, false, MUTED, 2); });
    f.y += 6;
  }
  f.para("Context", 9.5, true, INK, 1);
  ctxLines(c).forEach(function (l) { var k = l.indexOf(": "); f.kv(l.slice(0, k), l.slice(k + 2)); });
  f.y += 6;
  f.para("Recent actions", 9.5, true, INK, 1);
  if (!(c.actions || []).length) f.para("None recorded.", 8.5, false, MUTED, 0);
  (c.actions || []).forEach(function (x) { f.para(x.t + (x.screen ? " on " + x.screen : "") + ": " + x.what, 8.5, false, MUTED, 0); });
  f.y += 6;
  f.para("Page errors", 9.5, true, INK, 1);
  if (!(c.errors || []).length) f.para("None.", 8.5, false, MUTED, 0);
  (c.errors || []).forEach(function (x) { f.para(x.t + ": " + x.what, 8.5, false, MUTED, 0); });
}
function bytesOf(b) {
  if (!b) return Promise.resolve(null);
  if (typeof b.byteLength === "number" && typeof b.BYTES_PER_ELEMENT === "number") return Promise.resolve(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  if (Object.prototype.toString.call(b) === "[object ArrayBuffer]") return Promise.resolve(new Uint8Array(b));
  return new Promise(function (res) {
    try { var r = new FileReader(); r.onload = function () { res(new Uint8Array(r.result)); }; r.onerror = function () { res(null); }; r.readAsArrayBuffer(b); }
    catch (e) { res(null); }
  });
}
function buildPdf(notes) {
  return Promise.all(notes.map(function (n) { return Promise.all([bytesOf(n.shot)].concat((n.frames || []).map(bytesOf))); })).then(function (all) {
    var pdf = new Pdf();
    cover(pdf, notes);
    notes.forEach(function (n, i) {
      var b = all[i], shot = b[0] ? pdf.image(b[0], n.shotW, n.shotH) : null;
      var frames = shot ? b.slice(1).map(function (x) { return pdf.image(x, n.frameW, n.frameH); }).filter(Boolean) : [];
      notePage(pdf, n, i, notes.length, { shot: shot, frames: frames });
    });
    return new Blob(pdf.bytes({ title: "Feedback on " + notes[0].ctx.name, producer: "ExperiencePoint feedback kit " + FB.kit }), { type: "application/pdf" });
  });
}

/* ---------- start ---------- */
(doc.documentElement || doc.body).appendChild(host);
refreshCount();
FB.ui = {
  open: openNote, close: close, send: sendNotes, turnOff: turnOff, list: renderList,
  store: store, context: context, describe: describe, cleanUrl: cleanUrl, bodyText: bodyText,
  buildPdf: buildPdf, wrap: wrap, winCodes: winCodes, pstr: pstr, cap: cap, state: state,
  host: host, root: root, to: function () { return TO; }
};
try { doc.dispatchEvent(new CustomEvent("epkit:feedback-ready")); } catch (e) {}
})();
