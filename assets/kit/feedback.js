/* ExperiencePoint feedback kit. This header is the home for how to use it.

   What it does
   Testers open a tool with their tester link, which ends in ?feedback=CODE. A
   small bar appears with a Comment button. They click Comment, the pointer becomes
   a comment bubble, and whatever is under it outlines; one click picks that part
   of the page (or the whole screen), then they type and Post. Each comment goes
   straight to the pt worker with what the tool knows about that moment: the part
   of the page it is about (so the board can find it again), the screen, the tool's
   settings, the window size, the device, the last few clicks (by label, never typed
   words), page errors, and which version of the file was open. No picture is taken:
   the feedback board in feedback/ rebuilds the screen from the tool's own code.
   Nothing typed is lost: an unsent comment is kept in the browser until it posts,
   and so is a half-written one. Testers can edit or delete their own comments,
   clear their own list with a three-second hold (the board keeps every comment;
   only the team changes the board), and Done shows how many were sent.

   Everyone else: this file reads the address, finds no ?feedback, and stops.
   Nothing else loads and nothing is recorded.

   Add it to a tool (one line, anywhere in the page):
     <script src="/pt/assets/kit/feedback.js" defer></script>
   Standalone files opened outside pt use the full address instead:
     <script src="https://ep.github.io/pt/assets/kit/feedback.js" defer></script>

   Optional: tell it about the tool, before or after that line:
     (window.EPKit = window.EPKit || {}).tool = {
       id: "pair-poll",              // short id; defaults to the folder name
       name: "Pair Poll",            // defaults to the page title
       version: "v4",                // optional; the file's own version is stamped anyway
       screen: function () { ... },  // the current screen's id
       state: function () { ... },   // a few settings worth knowing: {mode: "team"}
       restore: function (o) { ... },// opens screen o.screen with o.settings and made-up
                                     // content, so the board can rebuild it; return true
       sections: function () { ... },// the tool's major parts, in order, so the board can
                                     // group comments: [{name: "1. Better way",
                                     //   screens: ["c1", "spin"]}, ...]
       safeParams: ["mode"],         // address parts safe to keep (others are removed)
       dot: "bottom-left"            // where the bar sits: bottom-left, bottom-right,
                                     // bottom-center, top-left, top-right
     };
   Anything marked data-feedback-private is never named in a comment's context.
   Parts with an id, data-id or data-act are found again most reliably when the
   board rebuilds a screen, even after the tool changes.

   Remove it: delete the script line. The tool hook can stay; it does nothing alone.
   Turn it off in a tab: ?feedback=off, or Done, then Turn off feedback.

   Files: feedback.js (this, loaded by every page that carries the line),
   feedback-ui.js (the bar and comments, loaded only in feedback mode),
   feedback-replay.js (loaded only when the board rebuilds a screen), send.js
   (Email this, for outputs). The worker routes are described in
   _backend/pt-worker.js under FEEDBACK. Tests: _backend/tests/qa-kit.mjs. */
(function () {
  "use strict";
  var K = window.EPKit = window.EPKit || {};
  if (K.feedback) return;
  var KIT = "2026-10-27", FLAG = "ep-feedback", CODE = "ep-feedback-code";

  function ss(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  function load(file) {
    var me = document.currentScript, base = (me && me.src) ? me.src.replace(/[^\/]*$/, "") : "/pt/assets/kit/";
    var s = document.createElement("script");
    s.src = base + file + "?v=" + KIT; s.async = true; s.setAttribute("data-epkit", file);
    (document.head || document.documentElement).appendChild(s);
    return base;
  }

  /* Removes the values of anything that could be a key or a code. */
  K.scrub = function (s) {
    return String(s == null ? "" : s).replace(/([?&#;]\s*(?:k|fk|key|host|join|session|code|token|sid|auth|me|feedback)=)[^&#\s"'<>]*/gi, "$1[removed]");
  };

  /* The board frames a tool to rebuild a screen, or only to read its sections (map).
     feedback-replay.js does that work. */
  if (window.EPKitReplay && typeof window.EPKitReplay === "object") {
    K.feedback = { on: false, kit: KIT, replay: true, actions: [], errors: [] };
    load("feedback-replay.js");
    return;
  }

  var m = /[?&]feedback(?:=([^&]*))?(?:&|$)/i.exec(location.search || ""), on = false;
  if (m) {
    var v = String(m[1] || "").trim();
    if (/^(off|0|false)$/i.test(v)) ss(function (s) { s.removeItem(FLAG); s.removeItem(CODE); });
    else {
      on = true;
      var code = v.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
      ss(function (s) { s.setItem(FLAG, "1"); if (code) s.setItem(CODE, code); });
    }
  } else {
    on = ss(function (s) { return s.getItem(FLAG) === "1"; }) === true;
  }

  var fb = K.feedback = { on: on, kit: KIT, flag: FLAG, codeKey: CODE, actions: [], errors: [] };
  if (!on) return;
  fb.code = ss(function (s) { return s.getItem(CODE); }) || "";


  function clip(t, n) { t = String(t == null ? "" : t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
  function now() { var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; }; return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); }
  function screenId() { try { var t = K.tool, s = t && t.screen; return clip(typeof s === "function" ? s() : (s || ""), 60); } catch (e) { return ""; } }
  function inKit(el) { return !!(el && el.closest && el.closest("[data-epkit]")); }
  function hidden(el) { return !!(el && el.closest && el.closest("[data-feedback-private]")); }
  function fieldName(el) {
    var id = el.id, l = id && document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    return clip(el.getAttribute("aria-label") || (l && l.textContent) || el.getAttribute("placeholder") || el.name || el.id || el.type || "a field", 50);
  }
  function label(el) {
    for (var n = el, i = 0; n && n.nodeType === 1 && i < 7; n = n.parentElement, i++) {
      var tag = n.tagName.toLowerCase(), role = n.getAttribute("role") || "";
      if (/^(button|a|summary|label|select|input|textarea)$/.test(tag) || /^(button|link|tab|menuitem|checkbox|radio|switch|option)$/.test(role) || n.hasAttribute("data-act")) {
        if (tag === "input" || tag === "textarea" || tag === "select") return "clicked " + fieldName(n);
        if (hidden(n)) return "clicked a private " + (role || tag);
        var t = n.getAttribute("aria-label") || n.getAttribute("title") || n.innerText || n.textContent || "";
        return "clicked " + (role || tag) + ' "' + clip(t, 50) + '"';
      }
    }
    return "clicked " + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "");
  }
  function log(what) {
    if (!fb.on) return;
    fb.actions.push({ t: now(), what: K.scrub(what), screen: screenId() });
    if (fb.actions.length > 14) fb.actions.shift();
  }
  function err(what) {
    if (!fb.on) return;
    fb.errors.push({ t: now(), what: clip(K.scrub(what), 240), screen: screenId() });
    if (fb.errors.length > 8) fb.errors.shift();
  }
  fb.err = err;

  document.addEventListener("click", function (e) { var t = e.target; if (t && t.nodeType === 1 && !inKit(t)) log(label(t)); }, true);
  document.addEventListener("keydown", function (e) {
    if (inKit(e.target)) return;
    var k = e.key || "", typing = e.target && /^(input|textarea|select)$/i.test(e.target.tagName || "") || (e.target && e.target.isContentEditable);
    if (e.ctrlKey || e.metaKey) { if (k.length === 1) log("pressed " + (e.metaKey ? "Cmd" : "Ctrl") + "+" + k.toUpperCase()); return; }
    if (k.length < 2 || /^(Shift|Control|Alt|Meta|CapsLock|Tab|Unidentified|Process|Dead)$/.test(k)) return;
    if (typing && /^(Backspace|Delete|Arrow|Home|End)/.test(k)) return;
    log("pressed " + k);
  }, true);
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t || !t.tagName || inKit(t)) return;
    var tag = t.tagName.toLowerCase(), type = (t.type || "").toLowerCase();
    if (tag === "select") log('chose "' + clip(t.options && t.selectedIndex > -1 ? t.options[t.selectedIndex].text : "", 40) + '" in ' + fieldName(t));
    else if (type === "checkbox") log((t.checked ? "ticked " : "unticked ") + fieldName(t));
    else if (type === "radio") log("chose " + fieldName(t));
    else if (type === "file") log("added a file to " + fieldName(t));
    else log("edited " + fieldName(t));
  }, true);
  window.addEventListener("error", function (e) {
    var t = e.target;
    if (t && t !== window && t.tagName) { err("Couldn't load " + t.tagName.toLowerCase() + " " + (t.currentSrc || t.src || t.href || "")); return; }
    var at = e.filename ? " (" + String(e.filename).split("/").pop() + ":" + (e.lineno || 0) + ")" : "";
    err((e.message || "Script error") + at);
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason; err("Unhandled promise: " + (r && (r.message || r.name) || String(r)));
  });
  var ce = window.console && console.error;
  if (ce) console.error = function () {
    try { err("console.error: " + Array.prototype.map.call(arguments, function (a) { return a && a.message ? a.message : typeof a === "object" ? "[object]" : String(a); }).join(" ")); } catch (x) {}
    return ce.apply(console, arguments);
  };

  fb.base = load("feedback-ui.js");
})();
