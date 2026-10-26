/* ExperiencePoint send kit: Email this. This header is the home for how to use it.

   What it does
   Lets someone email a tool's output from their own email. On a phone or tablet
   it opens the device's share sheet, which attaches the files. On a computer it
   downloads the files and opens a ready-written email in Gmail, Outlook or the
   computer's email app, with the subject, body and any fixed recipients filled
   in; the person attaches the download and sends. Nothing passes through EP.

   Add it to a tool:
     <script src="/pt/assets/kit/send.js" defer></script>
   (standalone files outside pt: https://ep.github.io/pt/assets/kit/send.js)

   Use it from a button:
     if (window.EPKit && EPKit.email) EPKit.email({
       subject: "Our reimagined workflow",
       body: "Plain text. New lines are kept.",
       files: function () { return [{ name: "card.png", blob: pngBlob }]; },
                                   // a list, or a function returning one (or a Promise of one)
       to: [],                     // optional fixed recipients
       heading: "Email this",      // optional
       lead: "",                   // optional first line under the heading
       complete: false,            // true when the body alone carries everything
       confirmSent: false,         // true asks "Sent it?" and calls onSent on yes
       onSent: function () {},
       theme: "auto",              // light, dark or auto
       accent: "#22304A", accentInk: "#FFFFFF"
     }).then(function (r) { r.route; r.sent; });
   Check EPKit.email exists before showing the button: the file loads after the page.

   Limits: a computer needs one manual step (attach the download). Long bodies are
   shortened to fit an email link, with a line saying the attachment has the rest.
   Several files may make the browser ask once to allow multiple downloads.
   Tests: _backend/tests/qa-kit.mjs. */
(function () {
  "use strict";
  var K = window.EPKit = window.EPKit || {};
  if (K.email) return;
  var doc = document, win = window, ROUTE_KEY = "ep-kit-mail-route";

  function lsGet(k) { try { return win.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { win.localStorage.setItem(k, v); } catch (e) {} }
  function el(tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function btn(cls, text, fn) { var b = el("button", cls, text); b.type = "button"; if (fn) b.addEventListener("click", fn); return b; }
  function size(n) { return n < 1024 ? n + " bytes" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function touch() { try { return win.matchMedia("(pointer: coarse)").matches; } catch (e) { return false; } }
  function dark(theme) { if (theme === "dark") return true; if (theme === "light") return false; try { return win.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; } }

  /* Email links. Kept separate so they can be tested. */
  function crlf(s) { return String(s || "").replace(/\r?\n/g, "\r\n"); }
  function fit(body, max, hasFiles) {
    body = String(body || "");
    if (body.length <= max) return body;
    var note = hasFiles ? "\n\n(Shortened to fit. The attachment has everything.)" : "\n\n(Shortened to fit.)";
    var cut = body.slice(0, max - note.length), nl = cut.lastIndexOf("\n");
    return (nl > max * 0.6 ? cut.slice(0, nl) : cut) + note;
  }
  var links = K.emailLinks = {
    mailto: function (o) {
      var to = (o.to || []).map(encodeURIComponent).join(",");
      return "mailto:" + to + "?subject=" + encodeURIComponent(o.subject || "") + "&body=" + encodeURIComponent(crlf(o.body));
    },
    gmail: function (o) {
      return "https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent((o.to || []).join(",")) +
        "&su=" + encodeURIComponent(o.subject || "") + "&body=" + encodeURIComponent(o.body || "");
    },
    outlook: function (o) {
      return "https://outlook.office.com/mail/deeplink/compose?to=" + encodeURIComponent((o.to || []).join(",")) +
        "&subject=" + encodeURIComponent(o.subject || "") + "&body=" + encodeURIComponent(o.body || "");
    },
    fit: fit
  };

  function download(f) {
    var url = URL.createObjectURL(f.blob), a = doc.createElement("a");
    a.href = url; a.download = f.name; a.rel = "noopener"; a.style.display = "none";
    doc.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  K.download = download;

  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { return true; }, function () { return legacyCopy(t); });
    return Promise.resolve(legacyCopy(t));
  }
  function legacyCopy(t) {
    var ta = doc.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    doc.body.appendChild(ta); ta.select(); var ok = false; try { ok = doc.execCommand("copy"); } catch (e) {} ta.remove(); return ok;
  }
  K.copyText = copyText;

  var CSS = [
    ":host{all:initial}",
    "*{box-sizing:border-box}",
    ".back{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(9,12,20,.48);font:15px/1.45 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;animation:in .18s ease-out}",
    ".sheet{width:min(440px,100%);max-height:calc(100vh - 32px);overflow:auto;background:var(--card);color:var(--ink);border-radius:18px;padding:24px 24px 20px;box-shadow:0 24px 70px rgba(0,0,0,.35);position:relative}",
    "@media (max-width:520px){.back{align-items:flex-end;padding:0}.sheet{border-radius:18px 18px 0 0;padding:22px 18px calc(18px + env(safe-area-inset-bottom))}}",
    "h2{margin:0 36px 6px 0;font-size:20px;line-height:1.25;font-weight:650;letter-spacing:-.01em}",
    "p{margin:0 0 14px;color:var(--muted)}",
    ".x{position:absolute;top:14px;right:14px;width:36px;height:36px;border-radius:50%;border:0;background:transparent;color:var(--muted);font-size:22px;line-height:1;cursor:pointer}",
    ".x:hover{background:var(--soft)}",
    ".to{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 12px;padding:10px 12px;border-radius:12px;background:var(--soft)}",
    ".to b{font-weight:600;color:var(--muted);font-size:13px}.to span{flex:1;min-width:0;overflow-wrap:anywhere;color:var(--ink)}",
    ".file{display:flex;align-items:center;gap:10px;margin:0 0 16px;padding:10px 12px;border:1px solid var(--line);border-radius:12px}",
    ".file i{flex:none;width:28px;height:34px;border-radius:5px;background:var(--soft);position:relative}",
    ".file i::after{content:'';position:absolute;left:7px;right:7px;top:10px;height:2px;background:var(--line);box-shadow:0 6px 0 var(--line),0 12px 0 var(--line)}",
    ".file span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file small{color:var(--muted);font-size:13px}",
    ".lbl{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--muted)}",
    ".routes{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:0 0 12px}",
    "button{font:inherit;cursor:pointer}",
    ".tile{min-height:48px;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-weight:600}",
    ".tile:hover{border-color:var(--accent)}",
    ".tile.primary,.primary{background:var(--accent);border-color:var(--accent);color:var(--accentInk)}",
    ".big{display:block;width:100%;min-height:50px;margin:0 0 12px;border-radius:12px;border:1px solid var(--accent);font-weight:650}",
    ".link{border:0;background:none;padding:6px 0;color:var(--ink);text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--line)}",
    ".row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:6px}.grow{flex:1}",
    ".btn{min-height:44px;padding:0 18px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--ink);font-weight:600}",
    ".btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accentInk)}",
    ".say{min-height:20px;margin:8px 0 0;font-size:13px;color:var(--muted)}",
    ":focus-visible{outline:3px solid var(--focus);outline-offset:2px}",
    "@keyframes in{from{opacity:0}}",
    "@media (prefers-reduced-motion:reduce){.back{animation:none}}"
  ].join("\n");

  function vars(o) {
    var d = dark(o.theme);
    return {
      "--card": d ? "#1B2130" : "#FFFFFF", "--ink": d ? "#EEF0F4" : "#1E2533", "--muted": d ? "#A7AEBC" : "#5B6474",
      "--line": d ? "rgba(255,255,255,.16)" : "#DDE1E8", "--soft": d ? "rgba(255,255,255,.07)" : "#F2F4F7",
      "--accent": o.accent || (d ? "#F2C14E" : "#22304A"), "--accentInk": o.accentInk || (d ? "#1B2130" : "#FFFFFF"),
      "--focus": d ? "#F2C14E" : "#2E6BD6"
    };
  }

  var open = null;

  K.email = function (o) {
    o = o || {};
    if (open) open.close(null);
    return new Promise(function (resolve) {
      var to = (o.to || []).filter(Boolean), files = [], last = doc.activeElement, result = { route: null, sent: false };
      var host = el("div"); host.setAttribute("data-epkit", "send"); host.setAttribute("data-clarity-mask", "true");
      var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
      var st = el("style"); st.textContent = CSS; root.appendChild(st);
      var back = el("div", "back"), sheet = el("div", "sheet");
      sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", o.heading || "Email this");
      var v = vars(o); Object.keys(v).forEach(function (k) { sheet.style.setProperty(k, v[k]); });
      back.appendChild(sheet); root.appendChild(back); doc.body.appendChild(host);
      ["click", "pointerdown", "mousedown", "touchstart"].forEach(function (ev) { root.addEventListener(ev, function (e) { e.stopPropagation(); }); });
      host.epkitResult = result;

      function close(r) {
        if (!host.parentNode) return;
        doc.removeEventListener("keydown", onKey, true);
        host.remove(); open = null;
        try { if (last && last.focus) last.focus(); } catch (e) {}
        resolve(r || result);
      }
      function onKey(e) {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); close(result); return; }
        if (e.key === "Tab") {
          var f = Array.prototype.slice.call(sheet.querySelectorAll("button,[href],textarea,input")).filter(function (n) { return !n.disabled; });
          if (!f.length) return;
          var a = root.activeElement || doc.activeElement, i = f.indexOf(a);
          if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
          else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
        }
      }
      doc.addEventListener("keydown", onKey, true);
      back.addEventListener("click", function (e) { if (e.target === back) close(result); });
      open = { close: close, host: host };

      function frame(title, lead) {
        sheet.textContent = "";
        sheet.appendChild(btn("x", "\u00d7", function () { close(result); })).setAttribute("aria-label", "Close");
        sheet.appendChild(el("h2", null, title));
        if (lead) sheet.appendChild(el("p", null, lead));
      }
      var say = el("p", "say"); say.setAttribute("aria-live", "polite");
      function flash(t) { say.textContent = t; clearTimeout(flash.t); flash.t = setTimeout(function () { say.textContent = ""; }, 2600); }

      function bodyFor(route) {
        var max = route === "mailto" ? (touch() ? 6000 : 1800) : 6000;
        return fit(o.body, max, files.length > 0);
      }
      function payload(route) { return { to: to, subject: o.subject || "", body: bodyFor(route) }; }
      function fileObjs() {
        try { return files.map(function (f) { return new File([f.blob], f.name, { type: f.blob.type || "application/octet-stream" }); }); } catch (e) { return null; }
      }
      function canShare() {
        if (!navigator.share || !navigator.canShare || !files.length) return false;
        var fo = fileObjs(); try { return !!(fo && navigator.canShare({ files: fo })); } catch (e) { return false; }
      }
      function take(route) {
        result.route = route; lsSet(ROUTE_KEY, route);
        if (route === "share") {
          var fo = fileObjs(), data = { files: fo, title: o.subject || "", text: o.body || "" };
          navigator.share(data).then(function () { after(route, true); }, function (e) { if (!e || e.name !== "AbortError") flash("Sharing didn't work here. Try one of the email choices."); });
          return;
        }
        if (route === "copy") {
          var t = (to.length ? "To: " + to.join(", ") + "\n" : "") + "Subject: " + (o.subject || "") + "\n\n" + (o.body || "");
          if (files.length) files.forEach(download);
          copyText(t).then(function (ok) { flash(ok ? "Copied. Paste it into a new email." : "Couldn't copy here. Try one of the email choices."); if (ok) after(route, false); });
          return;
        }
        if (!(o.complete && touch())) files.forEach(download);
        var url = links[route](payload(route));
        if (route === "mailto") { K._leaving = Date.now(); var a = doc.createElement("a"); a.href = url; a.style.display = "none"; doc.body.appendChild(a); a.click(); a.remove(); }
        else win.open(url, "_blank", "noopener");
        after(route, false);
      }

      function main() {
        frame(o.heading || "Email this", o.lead || (files.length && !o.complete ? "Send it from your own email." : ""));
        if (to.length) {
          var tr = el("div", "to"); tr.appendChild(el("b", null, "To")); tr.appendChild(el("span", null, to.join(", ").replace(/@/g, "@\u200b")));
          tr.appendChild(btn("link", "Copy address", function () { copyText(to.join(", ")).then(function (ok) { flash(ok ? "Address copied." : "Couldn't copy here."); }); }));
          sheet.appendChild(tr);
        }
        files.forEach(function (f) {
          var r = el("div", "file"); r.appendChild(el("i")); r.appendChild(el("span", null, f.name)); r.appendChild(el("small", null, size(f.blob.size || 0)));
          sheet.appendChild(r);
        });
        var share = canShare(), mobile = touch(), pref = lsGet(ROUTE_KEY);
        if (mobile && o.complete) {
          sheet.appendChild(btn("big primary", "Write the email", function () { take("mailto"); }));
          if (share) sheet.appendChild(btn("big tile", "Share the file instead", function () { take("share"); }));
        } else if (mobile && share) {
          sheet.appendChild(btn("big primary", "Share", function () { take("share"); }));
          sheet.appendChild(btn("big tile", "Write the email instead", function () { take("mailto"); }));
        } else {
          sheet.appendChild(el("p", "lbl", "Write the email in"));
          var g = el("div", "routes"), opts = [["gmail", "Gmail"], ["outlook", "Outlook"], ["mailto", "Email app"]];
          if (share) opts.push(["share", "Share\u2026"]);
          if (pref) opts.sort(function (a, b) { return (b[0] === pref) - (a[0] === pref); });
          opts.forEach(function (r) {
            var b = btn("tile" + (r[0] === pref ? " primary" : ""), r[1], function () { take(r[0]); });
            b.setAttribute("data-route", r[0]); g.appendChild(b);
          });
          sheet.appendChild(g);
          if (files.length) sheet.appendChild(el("p", null, "Choosing one downloads " + (files.length === 1 ? files[0].name : "the files") + " so you can attach it."));
        }
        var row = el("div", "row"), cp = btn("link", "Copy the message instead", function () { take("copy"); });
        cp.setAttribute("data-route", "copy"); row.appendChild(cp);
        sheet.appendChild(row); sheet.appendChild(say);
        var first = sheet.querySelector(".primary") || sheet.querySelector(".tile") || sheet.querySelector("button"); if (first) first.focus();
      }

      function after(route, shared) {
        var attach = files.length && !(o.complete && touch()) && !shared;
        var lead = shared ? "" : route === "copy" ? "Paste it into a new email" + (to.length ? " to " + to.join(", ") : "") + (attach ? ", attach " + names() + " from your Downloads, then send." : ", then send.") :
          (route === "mailto" ? "Your email app should open now. " : "Your email is open in a new tab. ") + (attach ? "Attach " + names() + " from your Downloads folder, then send." : "Check it, then send.");
        if (o.confirmSent) {
          frame("Sent it?", lead);
          var r = el("div", "row");
          if (attach) r.appendChild(btn("link", "Download again", function () { files.forEach(download); }));
          r.appendChild(el("span", "grow"));
          r.appendChild(btn("btn", "Not yet", function () { close(result); }));
          var yes = btn("btn primary", "Yes, it's sent", function () { result.sent = true; try { if (o.onSent) o.onSent(); } catch (e) {} close(result); });
          r.appendChild(yes); sheet.appendChild(r); sheet.appendChild(say); yes.focus();
          return;
        }
        if (shared) { result.sent = true; close(result); return; }
        frame("Almost there", lead);
        var r2 = el("div", "row");
        if (attach) r2.appendChild(btn("link", "Download again", function () { files.forEach(download); }));
        r2.appendChild(el("span", "grow"));
        var done = btn("btn primary", "Done", function () { close(result); }); r2.appendChild(done);
        sheet.appendChild(r2); sheet.appendChild(say); done.focus();
      }
      function names() { return files.length === 1 ? files[0].name : "the files"; }

      frame(o.heading || "Email this", "Getting it ready\u2026");
      Promise.resolve().then(function () { return typeof o.files === "function" ? o.files() : (o.files || []); })
        .then(function (list) {
          files = (list || []).filter(function (f) { return f && f.blob && f.name; }).map(function (f) { return { name: String(f.name).replace(/[\\\/:*?"<>|]+/g, "-").slice(0, 120), blob: f.blob }; });
          if (host.parentNode) main();
        }, function () {
          if (!host.parentNode) return;
          frame(o.heading || "Email this", "Couldn't get the file ready. Close this and try again.");
        });
    });
  };
  try { doc.dispatchEvent(new CustomEvent("epkit:email-ready")); } catch (e) {}
})();
