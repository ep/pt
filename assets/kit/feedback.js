/* ExperiencePoint feedback kit. This header is the home for how to use it.

   What it does
   Testers open any tool with ?feedback on the end of its address. A faint dot
   appears in a corner. Tapping it saves a note with what the tester saw: on a
   computer, a picture of the tab (after one Allow per visit) with up to two
   spotlights; on a phone, the note plus the element they tapped. Every note
   carries context automatically: screen, settings, device, recent actions and
   page errors, with keys and codes stripped from the address. Notes stay in the
   tester's browser until they send them from their own email as one PDF that
   people and AI assistants can read. Nothing is sent anywhere by the kit.

   Everyone else: this file checks the address, finds no ?feedback, and stops.
   No dot, no listeners, nothing else loaded.

   Add it to a tool (one line, anywhere in the page):
     <script src="/pt/assets/kit/feedback.js" defer></script>
   Standalone files opened outside pt use the full address instead:
     <script src="https://ep.github.io/pt/assets/kit/feedback.js" defer></script>

   Optional: tell it about the tool, before or after the line above, in any order:
     (window.EPKit = window.EPKit || {}).tool = {
       id: "pair-poll",              // short id; defaults to the folder name
       name: "Pair Poll",            // defaults to the page title
       version: "v4",                // a string, or a function returning one
       screen: function () { ... },  // the current screen's id
       state: function () { ... },   // a few settings worth knowing: {mode: "team"}
       private: ".join-link, #notes",// extra elements to black out of pictures
       safeParams: ["mode"],         // address parts safe to keep (others are removed)
       dot: "bottom-left",           // bottom-left, bottom-right, bottom-center, top-left, top-right
       pictures: true                // false turns tab pictures off for this tool
     };
   Mark anything sensitive with data-feedback-private and it is blacked out of
   every picture. Password fields always are.

   Remove it: delete the script line. The tool hook can stay; it does nothing alone.

   Turn it off in a tab: ?feedback=off, or Turn off feedback in the notes list.

   Files: feedback.js (this, loaded by every page), feedback-ui.js (the panel,
   loaded only in feedback mode) and send.js (the Email this sheet). All three
   live together; this file finds the others next to itself.
   Tests: _backend/tests/qa-kit.mjs. */
(function () {
  "use strict";
  var K = window.EPKit = window.EPKit || {};
  if (K.feedback) return;
  var KIT = "2026-10-25", FLAG = "ep-feedback";

  function ss(fn) { try { return fn(window.sessionStorage); } catch (e) { return null; } }
  var m = /[?&]feedback(?:=([^&]*))?(?:&|$)/i.exec(location.search || ""), on = false;
  if (m) {
    var v = String(m[1] || "").toLowerCase();
    if (v === "off" || v === "0" || v === "false") ss(function (s) { s.removeItem(FLAG); });
    else { on = true; ss(function (s) { s.setItem(FLAG, "1"); }); }
  } else {
    on = ss(function (s) { return s.getItem(FLAG) === "1"; }) === true;
  }

  /* Removes the values of anything that could be a key or a code. */
  K.scrub = function (s) {
    return String(s == null ? "" : s).replace(/([?&#;]\s*(?:k|fk|key|host|join|session|code|token|sid|auth|me)=)[^&#\s"'<>]*/gi, "$1[removed]");
  };

  var fb = K.feedback = { on: on, kit: KIT, flag: FLAG, actions: [], errors: [] };
  if (!on) return;

  var me = document.currentScript, base = (me && me.src) ? me.src.replace(/[^\/]*$/, "") : "/pt/assets/kit/";
  fb.base = base;

  function clip(t, n) { t = String(t == null ? "" : t).replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "\u2026" : t; }
  function now() { var d = new Date(), p = function (x) { return (x < 10 ? "0" : "") + x; }; return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()); }
  function screenId() { try { var t = K.tool, s = t && t.screen; return clip(typeof s === "function" ? s() : (s || ""), 60); } catch (e) { return ""; } }
  function inKit(el) { return !!(el && el.closest && el.closest("[data-epkit]")); }
  function fieldName(el) {
    var id = el.id, l = id && document.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    return clip(el.getAttribute("aria-label") || (l && l.textContent) || el.getAttribute("placeholder") || el.name || el.id || el.type || "a field", 50);
  }
  function label(el) {
    for (var n = el, i = 0; n && n.nodeType === 1 && i < 7; n = n.parentElement, i++) {
      var tag = n.tagName.toLowerCase(), role = n.getAttribute("role") || "";
      if (/^(button|a|summary|label|select|input|textarea)$/.test(tag) || /^(button|link|tab|menuitem|checkbox|radio|switch|option)$/.test(role) || n.hasAttribute("data-act")) {
        if (tag === "input" || tag === "textarea" || tag === "select") return "clicked " + fieldName(n);
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

  function add(file) {
    var s = document.createElement("script");
    s.src = base + file + "?v=" + KIT; s.async = true; s.setAttribute("data-epkit", file);
    (document.head || document.documentElement).appendChild(s);
  }
  if (!K.email) add("send.js");
  add("feedback-ui.js");
})();
