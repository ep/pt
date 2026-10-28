// Tests for the shared kits in assets/kit/: the feedback kit (feedback.js and
// feedback-ui.js) and the Email this kit (send.js). Runs in a simulated browser
// with jsdom. The feedback kit talks to the real worker code (pt-worker.js) over a
// fake fetch, with the shared fake database, so posting runs through the real gate.
//   node _backend/tests/qa-kit.mjs
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import worker from "../pt-worker.js";
import { FakeDB } from "./fake-db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(here, "../../assets/kit");
const src = (f) => fs.readFileSync(path.join(KIT, f), "utf8");
const API = "https://pt.armand-khambatta.workers.dev";
const TEAM = "team-key-for-tests-0123456789";

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail !== undefined ? " :: " + String(detail).slice(0, 300) : "")); }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settle(n = 8) { for (let i = 0; i < n; i++) await tick(0); }
async function until(fn, ms = 3000) { const t0 = Date.now(); for (;;) { let v; try { v = fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await tick(15); } }

/* ---- the worker, behind a fake network ---- */
const env = { DB: FakeDB(), FEEDBACK_KEY: TEAM };
let offline = false;
async function call(method, p, body, headers) {
  const req = new Request(API + p, { method, headers: Object.assign({ "Content-Type": "application/json", Origin: "https://ep.github.io" }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env);
  return { status: res.status, data: await res.json() };
}
const team = (method, p, body) => call(method, p, body, { "X-Team-Key": TEAM });

const PAGE = `<!doctype html><html><head><title>Test Tool</title></head><body>
  <main id="stage"><h1>Pick a pair</h1>
    <label for="nm">Your answer</label><input id="nm" type="text">
    <button id="start" aria-label="Start the round">Go</button>
    <div data-feedback-private><button id="secret">ABCD secret link</button></div>
  </main>
  <footer id="bottom"><button id="nextBtn" class="btn primary">Next</button></footer>
</body></html>`;
const PAGE_BYTES = Buffer.from(PAGE, "utf8");
const PAGE_SHA = crypto.createHash("sha1").update(Buffer.concat([Buffer.from("blob " + PAGE_BYTES.length + "\0"), PAGE_BYTES])).digest("hex");

function makePage(url, opts = {}) {
  const dom = new JSDOM(opts.html || PAGE, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.URL.createObjectURL = () => "blob:fake";
  w.URL.revokeObjectURL = () => {};
  w.downloads = []; w.opened = []; w.requests = [];
  w.HTMLAnchorElement.prototype.click = function () { w.downloads.push({ href: this.href, download: this.download }); };
  w.open = (u, t, f) => { w.opened.push({ u, t, f }); return null; };
  if (opts.coarse) w.matchMedia = (q) => ({ matches: /pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(w, "crypto", { configurable: true, value: crypto.webcrypto });
  w.TextEncoder = TextEncoder;
  w.fetch = async (u, o = {}) => {
    u = String(u);
    w.requests.push(u);
    if (u.indexOf(API) !== 0) {
      if (new URL(u, w.location.href).pathname === w.location.pathname) return { ok: true, status: 200, arrayBuffer: async () => PAGE_BYTES.buffer.slice(PAGE_BYTES.byteOffset, PAGE_BYTES.byteOffset + PAGE_BYTES.length), json: async () => ({}) };
      throw new Error("unexpected request " + u);
    }
    if (offline) throw new Error("offline");
    if (o.keepalive) (w.kept = w.kept || []).push(u);
    const isPost = /\/api\/fb\/post$/.test(u);
    if (isPost) { w.postsOut = (w.postsOut || 0) + 1; w.maxOut = Math.max(w.maxOut || 0, w.postsOut); }
    if (w.slow) await new Promise((r) => setTimeout(r, w.slow));
    const req = new Request(u, { method: o.method || "GET", headers: Object.assign({ Origin: "https://ep.github.io", "CF-Connecting-IP": "10.0.0.1" }, o.headers || {}), body: o.body });
    const res = await worker.fetch(req, env);
    if (isPost) w.postsOut--;
    const text = await res.text();
    return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
  };
  if (opts.before) opts.before(w);
  return w;
}
function runKit(w, file) {
  Object.defineProperty(w.document, "currentScript", { configurable: true, get: () => ({ src: "https://ep.github.io/pt/assets/kit/" + file + "?v=x" }) });
  w.eval(src(file));
  Object.defineProperty(w.document, "currentScript", { configurable: true, get: () => null });
}
function fbRoot(w) { const h = w.document.querySelector('[data-epkit="feedback"]'); return h && h.shadowRoot; }
function sendRoot(w) { const h = w.document.querySelector('[data-epkit="send"]'); return h && h.shadowRoot; }
function byText(root, sel, re) { return Array.from(root.querySelectorAll(sel)).find((n) => re.test(n.textContent)); }
function press(w, target, key, extra = {}) { target.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key, bubbles: true, composed: true, cancelable: true }, extra))); }
function pointer(w, target, type, x, y) { target.dispatchEvent(new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true, cancelable: true, button: 0 })); }
function rect(el, x, y, wd, ht) { el.getBoundingClientRect = () => ({ left: x, top: y, right: x + wd, bottom: y + ht, width: wd, height: ht, x, y }); }
function typeIn(w, el, v) { el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true, composed: true })); }
const k = (root, name) => root.querySelector(`[data-k="${name}"]`);

/* =================== static checks on the kit files =================== */
{
  for (const f of ["feedback.js", "feedback-ui.js", "feedback-replay.js", "send.js"]) {
    const s = src(f);
    check(`${f}: plain ASCII, so it reads the same under any page encoding`, /^[\x09\x0a\x0d\x20-\x7e]*$/.test(s), (s.match(/[^\x09\x0a\x0d\x20-\x7e]/) || [])[0]);
    check(`${f}: no em or en dashes`, !/[\u2013\u2014]|\\u201[34]/.test(s));
    check(`${f}: never writes HTML from strings`, !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s));
    check(`${f}: no eval or new Function`, !/\beval\s*\(|new Function/.test(s));
    check(`${f}: no beacons, sockets or XHR`, !/XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(s));
    const hosts = (s.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.replace(/^https?:\/\//, "").toLowerCase());
    check(`${f}: only EP's own addresses and the two email sites`, hosts.every((h) => ["ep.github.io", "pt.armand-khambatta.workers.dev", "mail.google.com", "outlook.office.com", "www.w3.org"].includes(h)), hosts.join(","));
  }
  const ui = src("feedback-ui.js");
  check("feedback-ui.js: no pictures of the screen and no PDF", !/getDisplayMedia|toDataURL|application\/pdf/.test(ui));
  check("feedback-ui.js: talks only to the pt worker, plus reading its own page once", (ui.match(/fetch\(/g) || []).length === 2 && /fetch\(API \+ path/.test(ui) && /fetch\(from, \{ cache: "force-cache"/.test(ui));
  const rp = src("feedback-replay.js");
  check("feedback-replay.js: talks to nothing, only to the board that framed it", !/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie/.test(rp) && /win\.parent\.postMessage/.test(rp));
  check("feedback-replay.js: listens only to the board that framed it", /e\.source !== win\.parent/.test(rp));
  check("no email address is written in any kit file", !/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i.test(src("feedback.js") + ui));
  const boot = src("feedback.js").replace(/\/\*[\s\S]*?\*\//, "");
  check("feedback.js stays small for everyone (code under 7.5 KB)", boot.length < 7680, boot.length);
}

/* =================== dormant: no ?feedback =================== */
{
  const w = makePage("https://ep.github.io/pt/field-tools/test-tool/?join=ABCD");
  const before = w.document.querySelectorAll("script").length;
  runKit(w, "feedback.js");
  check("dormant: feedback is off without ?feedback", w.EPKit.feedback.on === false);
  check("dormant: nothing else is loaded or fetched", w.document.querySelectorAll("script").length === before && w.requests.length === 0);
  check("dormant: no bar or panel", !w.document.querySelector("[data-epkit]"));
  check("dormant: the tab flag is untouched", w.sessionStorage.getItem("ep-feedback") === null);
  w.document.getElementById("start").click();
  check("dormant: clicks are not recorded", w.EPKit.feedback.actions.length === 0);
  const ce = w.console.error; runKit(w, "feedback.js");
  check("dormant: loading twice is harmless", w.console.error === ce && w.EPKit.feedback.on === false);
}

/* =================== the flag and the tester code =================== */
{
  const w = makePage("https://ep.github.io/pt/field-tools/test-tool/?x=1&feedback=k7qx2m");
  runKit(w, "feedback.js");
  const added = Array.from(w.document.querySelectorAll("script[data-epkit]")).map((s) => s.src);
  check("?feedback=CODE turns it on and keeps the code for this tab", w.EPKit.feedback.on === true && w.EPKit.feedback.code === "K7QX2M" && w.sessionStorage.getItem("ep-feedback-code") === "K7QX2M");
  check("it loads only the comment panel, from beside itself", added.length === 1 && /^https:\/\/ep\.github\.io\/pt\/assets\/kit\/feedback-ui\.js\?v=/.test(added[0]), added.join(" "));
  w.history.replaceState(null, "", "/pt/field-tools/test-tool/?host=ABCD&k=KEY123");
  delete w.EPKit.feedback; runKit(w, "feedback.js");
  check("it survives a tool rewriting its own address, code included", w.EPKit.feedback.on === true && w.EPKit.feedback.code === "K7QX2M");
  w.history.replaceState(null, "", "/pt/field-tools/test-tool/?feedback=off");
  delete w.EPKit.feedback; runKit(w, "feedback.js");
  check("?feedback=off turns it off and forgets the code", w.EPKit.feedback.on === false && w.sessionStorage.getItem("ep-feedback") === null && w.sessionStorage.getItem("ep-feedback-code") === null);
  check("scrub removes keys, codes and the tester code from any text", w.EPKit.scrub("x?host=ABCD&k=SECRET&me=7&feedback=K7QX y") === "x?host=[removed]&k=[removed]&me=[removed]&feedback=[removed] y");
}

/* =================== replay: the board rebuilds a screen =================== */
{
  const w = makePage("about:blank", { before: (win) => { win.EPKitReplay = { screen: "ladder", settings: { mode: "team" }, scroll: 0 }; } });
  let got = null; const msgs = [];
  w.EPKit = { tool: { id: "test-tool", restore: (o) => { got = o; return true; },
    sections: () => [{ name: "Set up", screens: ["cover"] }, { name: "1. Better way", screens: ["ladder", 42] }, { name: "x".repeat(200), screens: [] }] } };
  w.addEventListener("message", (e) => { msgs.push(e.data); });
  w.scrollTo = () => {};
  runKit(w, "feedback.js");
  const loaded = Array.from(w.document.querySelectorAll("script[data-epkit]")).map((s) => s.src);
  check("replay: feedback.js loads only the replay part, from beside itself", loaded.length === 1 && /^https:\/\/ep\.github\.io\/pt\/assets\/kit\/feedback-replay\.js\?v=/.test(loaded[0]), loaded.join(" "));
  runKit(w, "feedback-replay.js");
  await until(() => msgs.some((m) => m.type === "epkit-replay"), 3000);
  const map = msgs.find((m) => m.type === "epkit-map"), msg = msgs.find((m) => m.type === "epkit-replay");
  check("replay: the tool is asked to open that screen with those settings", got && got.screen === "ladder" && got.settings.mode === "team");
  check("replay: the frame tells the board it is ready, and how big it is", msg && msg.ok === true && msg.w > 0);
  check("replay: the tool's sections go to the board first (the board cleans them up)", map && msgs.indexOf(map) < msgs.indexOf(msg) && map.sections.length === 3 && map.sections[1].name === "1. Better way" && map.sections[1].screens.join() === "ladder,42", JSON.stringify(map));
  check("replay: no bar, nothing recorded", !w.document.querySelector('[data-epkit="feedback"]') && w.EPKit.feedback.on === false);
}
{
  const w = makePage("about:blank", { before: (win) => { win.EPKitReplay = { map: true }; } });
  let restored = false; const msgs = [];
  w.EPKit = { tool: { id: "test-tool", restore: () => { restored = true; return true; }, sections: [{ name: "Only part", screens: ["a"] }] } };
  w.addEventListener("message", (e) => { msgs.push(e.data); });
  runKit(w, "feedback.js"); runKit(w, "feedback-replay.js");
  await until(() => msgs.length, 3000); await tick(700);
  check("map only: the board can ask just for the sections, and nothing else runs", msgs.length === 1 && msgs[0].type === "epkit-map" && msgs[0].sections[0].name === "Only part" && !restored);
}
{
  const w = makePage("about:blank", { before: (win) => { win.EPKitReplay = { map: true }; } });
  const msgs = [];
  w.EPKit = { tool: { id: "test-tool", sections: () => { throw new Error("nope"); } } };
  w.addEventListener("message", (e) => { msgs.push(e.data); });
  runKit(w, "feedback.js"); runKit(w, "feedback-replay.js");
  await until(() => msgs.length, 3000);
  check("map only: a tool without working sections says so instead of breaking", msgs[0].type === "epkit-map" && msgs[0].sections === null);
}

/* =================== replay: finding what each comment is about =================== */
{
  const html = `<!doctype html><html><head><title>Lab</title></head><body><main id="stage">
    <section data-id="cover" class="scene" style="overflow-y:auto"><div class="frame">
      <h1 class="hero">Made-up title</h1>
      <div class="cta"><button class="go">Begin</button><p class="quiet">Best with sound on.</p></div>
      <ul class="steps"><li>Made-up one</li><li>Made-up two</li><li>Made-up three</li></ul>
      <p class="other">Another line</p>
      <p class="lede" style="opacity:0">Fades in late</p><p class="late">Drawn in later</p>
    </div></section></main></body></html>`;
  const T = (o) => Object.assign({ x: 0, y: 0, w: 10, h: 10 }, o);
  const targets = [
    T({ id: "fresh", tag: "p", text: "Best with sound on.", path: "main#stage > section.scene > div.frame > div.cta > p.quiet", sel: '#stage > section[data-id="cover"] > div > div > p', sy: 253 }),
    T({ id: "older", tag: "button", text: "Begin", path: "main#stage > section.scene.night > div.frame > div.cta.fadein > button.go" }),
    T({ id: "madeup", tag: "li", text: "The tester's real step two", path: "main#stage > section.scene > div.frame > ul.steps > li", x: 100, y: 330, w: 200, h: 30 }),
    T({ id: "gone", tag: "p", text: "A line that isn't here", path: "aside.gone > p", sel: "#nope > p" }),
    T({ id: "words", tag: "p", text: "Another line", path: "section.moved > p" }),
    T({ id: "screen", whole: true, tag: "page", text: "", path: "" }),
    T({ id: "faded", tag: "p", text: "Fades in late", path: "main#stage > section.scene > div.frame > p.lede", sel: '#stage > section[data-id="cover"] > div > p:nth-of-type(2)' }),
    T({ id: "late", tag: "p", text: "Drawn in later", path: "main#stage > section.scene > div.frame > p.late", sel: '#stage > section[data-id="cover"] > div > p:nth-of-type(3)' })
  ];
  const w = makePage("about:blank", { html, before: (win) => { win.EPKitReplay = { screen: "cover", settings: {}, scroll: 0, focus: "fresh", targets }; } });
  const d = w.document, scene = d.querySelector("section");
  const lay = { h1: [0, 40, 1280, 300], "button.go": [560, 420, 140, 60], "p.quiet": [560, 490, 160, 22], li: null, "p.other": [400, 600, 300, 22], "p.lede": [400, 360, 300, 22], section: [0, 0, 1280, 640], ".frame": [64, 0, 1152, 900], ".cta": [500, 410, 280, 110], "ul.steps": [100, 280, 400, 120], main: [0, 0, 1280, 640] };
  for (const k of Object.keys(lay)) if (lay[k]) d.querySelectorAll(k).forEach((n) => rect(n, ...lay[k]));
  d.querySelectorAll("li").forEach((n, i) => rect(n, 100, 290 + i * 40, 200, 30));
  Object.defineProperty(scene, "scrollHeight", { configurable: true, value: 900 }); Object.defineProperty(scene, "clientHeight", { configurable: true, value: 640 });
  const scrolled = []; w.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this.className); };
  w.scrollTo = () => {};
  const msgs = []; w.addEventListener("message", (e) => msgs.push(e.data));
  w.EPKit = { tool: { id: "lab", restore: () => true } };
  runKit(w, "feedback.js"); runKit(w, "feedback-replay.js");
  await until(() => msgs.some((m) => m.type === "epkit-rects"), 3000);
  const r = msgs.find((m) => m.type === "epkit-rects");
  check("find: a new comment's exact place is found, even with made-up content around it", r.rects.fresh && r.rects.fresh.x === 560 && r.rects.fresh.y === 490 && r.found === true && r.focus === "fresh", JSON.stringify(r.rects.fresh));
  check("find: the screen scrolls inside itself the way the tester had it", scene.scrollTop === 253, scene.scrollTop);
  check("find: an older comment with only a path is found by its words, even when the classes changed", r.rects.older && r.rects.older.x === 560 && r.rects.older.y === 420, JSON.stringify(r.rects.older));
  check("find: with made-up words, the same kind of part nearest the spot is used", r.rects.madeup && r.rects.madeup.y === 330, JSON.stringify(r.rects.madeup));
  check("find: a part that isn't there is not guessed at", r.rects.gone === null);
  check("find: a part that moved is found by its exact words", r.rects.words && r.rects.words.y === 600, JSON.stringify(r.rects.words));
  check("find: a whole-screen comment has no box", r.rects.screen === null);
  check("find: the rebuilt screen says it is ready after saying where things are", msgs.findIndex((m) => m.type === "epkit-rects") < msgs.findIndex((m) => m.type === "epkit-replay"));
  check("find: a part still fading in (opacity 0) is found", r.rects.faded && r.rects.faded.y === 360, JSON.stringify(r.rects.faded));
  check("find: a part not drawn yet is not guessed at", r.rects.late === null);
  rect(d.querySelector("p.late"), 400, 640, 300, 22);
  await until(() => msgs.some((m) => m.type === "epkit-rects" && m.rects.late), 2500);
  check("find: the rebuilt screen keeps looking, and reports a part once it is drawn", msgs.some((m) => m.type === "epkit-rects" && m.rects.late && m.rects.late.y === 640));
  /* the board picks another comment on the same screen */
  msgs.length = 0;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-locate", focus: "older", targets }, source: w.parent }));
  await until(() => msgs.some((m) => m.type === "epkit-rects" && m.focus === "older"), 2000);
  check("locate: the board can ask again for another comment, without rebuilding", msgs.some((m) => m.type === "epkit-rects" && m.focus === "older" && m.rects.older && m.found));
  msgs.length = 0;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-locate", focus: "fresh", targets }, source: null }));
  await tick(60);
  check("locate: a request from anywhere but the board is ignored", !msgs.some((m) => m.type === "epkit-rects" && m.focus === "fresh"));
  const off = d.querySelector("p.other"); rect(off, 400, 1400, 300, 22);
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-locate", focus: "words", targets }, source: w.parent }));
  await until(() => scrolled.includes("other"), 1500);
  check("locate: a part out of view is scrolled into view", scrolled.includes("other"));
  scene.scrollTop = 0;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-locate", focus: "fresh", targets }, source: w.parent }));
  await tick(30);
  const was = scene.scrollTop;
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-locate", focus: "gone", targets }, source: w.parent }));
  await tick(30);
  check("locate: scrolling done for one comment is undone for the next", was === 253 && scene.scrollTop === 0, was + " then " + scene.scrollTop);
}

/* =================== a tester's whole session =================== */
let CODE = (await team("POST", "/api/fb/code", {})).data.code;
check("setup: the team has a tester code", /^[A-Z0-9]{6}$/.test(CODE || ""));
const URL1 = `https://ep.github.io/pt/field-tools/test-tool/?host=ABCD&k=SECRETKEY99&feedback=${CODE.toLowerCase()}#tok=abc`;
const w = makePage(URL1);
w.EPKit = { tool: { id: "test-tool", name: "Test Tool", version: "v9", screen: () => w.currentScreen, state: () => ({ mode: "team", link: "https://x/?k=SECRETKEY99" }),
  sections: () => [{ name: "Set up", screens: ["cover"] }, { name: "2. Why it exists", screens: ["ladder"] }] } };
w.currentScreen = "cover";
const pageKeys = [];
w.document.addEventListener("keydown", (e) => pageKeys.push(e.key));
runKit(w, "feedback.js");
w.document.getElementById("start").click();
w.document.getElementById("secret").click();
const nm = w.document.getElementById("nm"); nm.value = "my secret answer"; nm.dispatchEvent(new w.Event("change", { bubbles: true }));
press(w, w.document.body, "ArrowRight");
w.currentScreen = "ladder";
w.dispatchEvent(new w.ErrorEvent("error", { message: "boom at ?k=SECRETKEY99", filename: "https://ep.github.io/pt/x/app.js", lineno: 12 }));
runKit(w, "feedback-ui.js");
const FB = w.EPKit.feedback, UI = FB.ui, root = fbRoot(w), hostEl = w.document.querySelector('[data-epkit="feedback"]');
await until(() => UI.link() === true && UI.version().startsWith("git:"));
check("bar: one host, masked from Clarity", !!root && hostEl.getAttribute("data-clarity-mask") === "true");
check("bar: checks the tester link with the worker", UI.link() === true);
check("bar: Comment and Done, in plain words", k(root, "comment").textContent === "Comment" && k(root, "done").textContent === "Done" && !k(root, "count"));
check("bar: sits bottom left unless the tool says otherwise", root.querySelector(".bar").classList.contains("bl"));
check("first visit: one tip points at Comment", /^Click Comment, then what your comment is about\.OK$/.test(root.querySelector(".tip").textContent) && !root.querySelector(".tip").hidden);
check("version: the comment will carry the file's Git fingerprint", UI.version() === "git:" + PAGE_SHA, UI.version());
check("actions: clicks by label, private ones unnamed, typed words never", FB.actions.some((a) => a.what === 'clicked button "Start the round"') && FB.actions.some((a) => a.what === "clicked a private button") && FB.actions.some((a) => a.what === "edited Your answer") && !JSON.stringify(FB.actions).includes("secret"));
check("errors: kept, with keys removed", FB.errors.length === 1 && /app\.js:12/.test(FB.errors[0].what) && !FB.errors[0].what.includes("SECRETKEY99"));

// Comment: the pointer becomes a comment bubble, parts outline as it moves, a click picks one
const nextBtn = w.document.getElementById("nextBtn"), startBtn = w.document.getElementById("start");
rect(nextBtn, 800, 700, 120, 44); rect(startBtn, 40, 120, 100, 40);
rect(w.document.getElementById("stage"), 0, 0, 1024, 690);
w.document.elementsFromPoint = (x, y) => (x >= 800 && x <= 920 && y >= 700 && y <= 744) ? [nextBtn, w.document.getElementById("bottom"), w.document.body]
  : (x >= 40 && x <= 140 && y >= 120 && y <= 160) ? [startBtn, w.document.getElementById("stage"), w.document.body] : [w.document.getElementById("stage"), w.document.body];
k(root, "comment").click(); await settle();
const shield = root.querySelector(".shield"), boxEl = root.querySelector(".box"), CSSX = root.querySelector("style").textContent;
check("comment mode: one short instruction, and a way to pick the whole screen", root.querySelector(".tip p").textContent === "Click what your comment is about." && !!k(root.querySelector(".tip"), "whole") && root.querySelector(".tip").textContent.indexOf("OK") < 0);
check("comment mode: the pointer becomes a comment bubble", /\.shield\{[^}]*cursor:url\("data:image\/svg\+xml,[^"]+"\) 4 26, crosshair/.test(CSSX));
check("comment mode: Comment turns into Cancel", k(root, "comment").textContent === "Cancel" && !shield.hidden);
check("comment mode: the first tip is not shown again", w.localStorage.getItem("ep-feedback-coach") === "1");
pointer(w, shield, "pointermove", 850, 720);
const hv = root.querySelector(".hover");
check("pointing: the part under the pointer is outlined", !hv.hidden && hv.style.left === "796px" && hv.style.width === "128px" && hv.style.height === "52px" && !hv.classList.contains("whole"), hv.style.cssText);
pointer(w, shield, "pointermove", 300, 300);
check("pointing: empty space, or a container as big as the window, means the whole screen", hv.classList.contains("whole") && hv.style.left === "0px" && hv.style.width === "1024px" && hv.style.height === "768px", hv.style.cssText);
pointer(w, shield, "pointerdown", 300, 300); pointer(w, shield, "pointermove", 600, 500); pointer(w, shield, "pointermove", 840, 710);
check("no drawing: dragging across the page draws no box", boxEl.hidden);
pointer(w, shield, "pointerup", 850, 720); await settle();
let card = root.querySelector(".card");
check("click: the part itself is outlined, with nothing to drag or resize", !boxEl.hidden && boxEl.style.left === "796px" && boxEl.style.width === "128px" && boxEl.querySelectorAll(".h").length === 0 && /\.box\{[^}]*pointer-events:none/.test(CSSX), boxEl.style.cssText);
const nameIn = card.querySelector('input[placeholder="Your name"]'), ta = card.querySelector('textarea[placeholder="Add a comment"]');
check("click: a comment box opens, asking a name the first time", !!nameIn && !!ta && k(card, "post").textContent === "Post" && k(card, "post").disabled);
check("click: nothing else to read", !card.querySelector("p"));
typeIn(w, ta, "Draft words");
check("half-written words are kept in this browser as they are typed", JSON.parse(w.localStorage.getItem("ep-feedback-draft:test-tool")).text === "Draft words");
pointer(w, shield, "pointerdown", 60, 130); pointer(w, shield, "pointerup", 60, 130); await settle();
check("while writing, a click on another part moves the comment there and keeps the words", boxEl.style.left === "36px" && UI.state.target.el === startBtn && root.querySelector(".card textarea").value === "Draft words", boxEl.style.cssText);
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
check("and back again", UI.state.target.el === nextBtn && boxEl.style.left === "796px");
pageKeys.length = 0;
press(w, ta, "ArrowRight"); press(w, ta, " ");
check("keys typed in a comment never reach the tool", pageKeys.length === 0, pageKeys.join(","));
const NOTE1 = 'Next jumps when the timer appears <img src=x onerror="window.pwned=1">';
typeIn(w, nameIn, "Ana"); typeIn(w, ta, NOTE1);
check("Post turns on once there are words", !k(card, "post").disabled);
k(card, "post").click();
check("post: the part flashes once as it is sent", !!root.querySelector(".flash"));
check("post: the count steps up with a small bump", !!k(root, "count") && k(root, "count").classList.contains("bump"));
await until(() => UI.mine()[0] && UI.mine()[0].status === "posted");
let list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
const c1 = list[0];
check("post: the comment reaches the worker straight away", list.length === 1 && c1.text === NOTE1 && c1.name === "Ana", JSON.stringify(list).slice(0, 200));
await until(() => /Posted/.test(root.querySelector(".toast").textContent));
check("post: it says Posted, with a tick, and the bar counts it", /^Posted$/.test(root.querySelector(".toast").textContent) && !!root.querySelector(".toast svg") && k(root, "count").textContent === "1");
check("post: what it is about, as an exact place, a readable path and its box in the window", c1.where.x === 796 && c1.where.w === 128 && c1.where.vw === 1024 && Math.abs(c1.where.xp - 77.7) < 0.2 && c1.where.el.path === "footer#bottom > button#nextBtn" && c1.where.el.sel === "#nextBtn" && c1.where.el.text === "Next" && c1.where.whole === false && c1.where.area === false && c1.where.sy === 0, JSON.stringify(c1.where));
check("post: the screen and the file version", c1.screen === "ladder" && c1.ver === "git:" + PAGE_SHA);
check("post: the part of the tool the screen belongs to", c1.ctx.section === "2. Why it exists", c1.ctx.section);
check("post: context with keys, codes and the tester code removed", c1.ctx.page === "https://ep.github.io/pt/field-tools/test-tool/?host=[removed]&k=[removed]&feedback#[removed]" && c1.ctx.settings.link.includes("k=[removed]"), c1.ctx.page);
check("post: nothing secret anywhere in what was sent", !JSON.stringify(c1).includes("SECRETKEY99") && !JSON.stringify(c1).includes(CODE) && !JSON.stringify(c1).includes("secret answer") && !JSON.stringify(c1).includes("tok=abc"));
check("post: the half-written copy is cleared once it is sent", w.localStorage.getItem("ep-feedback-draft:test-tool") === null);
check("post: the outline and the comment box close", boxEl.hidden && root.querySelector(".card").hidden && shield.hidden && k(root, "comment").textContent === "Comment");
check("the name is kept for next time", w.localStorage.getItem("ep-feedback-name") === "Ana");
let pin = root.querySelector(".pin");
check("pins: a numbered pin lands just outside the part's corner", pin && pin.textContent === "1" && pin.style.left === "792px" && pin.style.top === "692px" && pin.classList.contains("pop") && !pin.classList.contains("wait") && /^Comment 1: Next jumps/.test(pin.getAttribute("aria-label")), pin && pin.style.cssText);
check("typed text is never run as HTML", !root.querySelector("img") && w.pwned === undefined);
rect(nextBtn, 700, 650, 120, 44); w.document.dispatchEvent(new w.Event("scroll")); await tick(40);
check("pins: the pin follows its part as the page moves, and stays the same pin", root.querySelector(".pin") === pin && pin.style.left === "692px" && pin.style.top === "642px", pin.style.cssText);
rect(nextBtn, 800, 700, 120, 44); w.document.dispatchEvent(new w.Event("scroll")); await tick(40);

// Escape, then the whole screen, and Ctrl+Enter
k(root, "comment").click(); await settle();
press(w, w.document.body, "Escape");
check("Escape leaves comment mode", root.querySelector(".shield").hidden && k(root, "comment").textContent === "Comment");
k(root, "comment").click(); await settle();
k(root.querySelector(".tip"), "whole").click(); await settle();
check("whole screen: the window's edge is outlined", !boxEl.hidden && boxEl.classList.contains("whole") && boxEl.style.width === "1024px" && boxEl.style.height === "768px");
card = root.querySelector(".card");
check("second comment: no name question", !card.querySelector('input[placeholder="Your name"]'));
typeIn(w, card.querySelector("textarea"), "The heading is hard to read.\nEspecially in dark mode.");
press(w, card.querySelector("textarea"), "Enter", { ctrlKey: true });
await until(() => UI.mine().length === 2 && UI.mine()[1].status === "posted");
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("Ctrl+Enter posts, and the comment is about the whole screen", list.length === 2 && list[1].where.whole === true && list[1].where.el.tag === "page" && list[1].text === "The heading is hard to read.\nEspecially in dark mode.", JSON.stringify(list[1] && list[1].where));
check("a whole-screen comment has no pin", root.querySelectorAll(".pin").length === 1);

// Words are never lost: Escape keeps them, Cancel asks first, a reload brings them back
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
typeIn(w, root.querySelector(".card textarea"), "Half a thought");
press(w, w.document.body, "Escape");
check("Escape closes the comment box but keeps the words", root.querySelector(".card").hidden && JSON.parse(w.localStorage.getItem("ep-feedback-draft:test-tool")).text === "Half a thought");
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
check("the next comment starts with the kept words", root.querySelector(".card textarea").value === "Half a thought");
const cancelB = k(root.querySelector(".card"), "cancel");
cancelB.click();
check("Cancel asks before throwing typed words away", cancelB.textContent === "Discard?" && !root.querySelector(".card").hidden);
cancelB.click();
check("a second click throws them away", root.querySelector(".card").hidden && w.localStorage.getItem("ep-feedback-draft:test-tool") === null);
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
typeIn(w, root.querySelector(".card textarea"), "Typing when the tab closes");
let bu = new w.Event("beforeunload", { cancelable: true }); w.dispatchEvent(bu);
check("leaving the page while writing asks first", bu.defaultPrevented === true);
press(w, w.document.body, "Escape");
bu = new w.Event("beforeunload", { cancelable: true }); w.dispatchEvent(bu);
check("leaving with everything posted doesn't ask", bu.defaultPrevented === false);
{
  const kept = w.localStorage.getItem("ep-feedback-draft:test-tool");
  const seed = (win) => { win.localStorage.setItem("ep-feedback-draft:test-tool", kept); win.localStorage.setItem("ep-feedback-coach", "1"); win.localStorage.setItem("ep-feedback-name", "Ana"); };
  const r1 = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { before: seed });
  r1.EPKit = { tool: { id: "test-tool", screen: () => "ladder" } };
  rect(r1.document.getElementById("nextBtn"), 800, 700, 120, 44);
  runKit(r1, "feedback.js"); runKit(r1, "feedback-ui.js"); await settle();
  const rr = fbRoot(r1);
  check("after a reload, the comment being written comes back, on the same part", !rr.querySelector(".card").hidden && rr.querySelector(".card textarea").value === "Typing when the tab closes" && r1.EPKit.feedback.ui.state.target.el === r1.document.getElementById("nextBtn"));
  press(r1, r1.document.body, "Escape");
  const again = r1.localStorage.getItem("ep-feedback-draft:test-tool");
  const r2 = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { before: (win) => { seed(win); win.localStorage.setItem("ep-feedback-draft:test-tool", again); } });
  r2.EPKit = { tool: { id: "test-tool", screen: () => "ladder" } };
  runKit(r2, "feedback.js"); runKit(r2, "feedback-ui.js"); await settle();
  check("it comes back once; after that it waits for the next comment", fbRoot(r2).querySelector(".card").hidden && JSON.parse(r2.localStorage.getItem("ep-feedback-draft:test-tool")).text === "Typing when the tab closes");
}
root.querySelector(".pin").click(); await settle();
typeIn(w, root.querySelector(".card textarea"), "Changed but not saved");
press(w, w.document.body, "Escape");
const editKey = "ep-feedback-draft:test-tool:" + UI.mine()[0].id;
check("a change to a posted comment is kept in its own slot, never over a new comment's words", JSON.parse(w.localStorage.getItem(editKey)).text === "Changed but not saved" && JSON.parse(w.localStorage.getItem("ep-feedback-draft:test-tool")).text === "Typing when the tab closes");
root.querySelector(".pin").click(); await settle();
check("reopening that comment brings the change back", root.querySelector(".card textarea").value === "Changed but not saved");
k(root.querySelector(".card"), "cancel").click(); k(root.querySelector(".card"), "cancel").click();
check("discarding the change leaves the posted words alone", w.localStorage.getItem(editKey) === null && UI.mine()[0].text === NOTE1);
w.localStorage.removeItem("ep-feedback-draft:test-tool");

// Edit from a pin
root.querySelector(".pin").click(); await settle();
card = root.querySelector(".card");
check("pin: opens the comment on its part, with Save and Delete", card.querySelector("textarea").value === NOTE1 && k(card, "post").textContent === "Save" && !!k(card, "delete") && !boxEl.hidden && boxEl.style.left === "796px");
typeIn(w, card.querySelector("textarea"), "Next jumps when the timer appears.");
k(card, "post").click();
await until(() => /Saved/.test(root.querySelector(".toast").textContent));
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("edit: Save changes the comment on the worker, same comment", list.length === 2 && list[0].text === "Next jumps when the timer appears." && list[0].created === c1.created);

// The list, the name and deleting
k(root, "count").click(); await settle();
card = root.querySelector(".card");
const items = card.querySelectorAll(".item");
check("list: Comments, newest first", card.querySelector("h2").textContent === "Comments" && items.length === 2 && /heading is hard/.test(items[0].textContent) && /, \d\d:\d\d$/.test(items[0].querySelector("small").textContent));
check("list: shows who is posting, with Change", /Posting as Ana/.test(card.textContent) && !!byText(card, "button", /^Change$/));
byText(card, "button", /^Change$/).click(); await settle();
card = root.querySelector(".card");
typeIn(w, card.querySelector("input"), "Ana P"); k(card, "post").click(); await settle();
check("name: changed in one step", w.localStorage.getItem("ep-feedback-name") === "Ana P" && /Posting as Ana P/.test(root.querySelector(".card").textContent));
root.querySelector(".card").querySelectorAll(".item")[0].click(); await settle();
card = root.querySelector(".card");
const del = k(card, "delete");
del.click();
check("delete: asks for a second click", del.textContent === "Click again to delete");
del.click();
await until(() => UI.mine().length === 1);
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("delete: gone from the worker and from this browser", list.length === 1 && UI.mine().length === 1 && /Deleted/.test(root.querySelector(".toast").textContent));

// Offline: kept here, sent as the page closes, and posted later
offline = true;
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
card = root.querySelector(".card"); typeIn(w, card.querySelector("textarea"), "Offline note"); k(card, "post").click();
await until(() => /back online/.test(root.querySelector(".toast").textContent));
check("offline: the comment is kept in this browser, its pin hollow", UI.mine()[1].status === "waiting" && root.querySelector(".pin.wait") && JSON.parse(w.localStorage.getItem("ep-feedback-mine")).some((c) => c.text === "Offline note"));
k(root, "count").click(); await settle();
check("offline: the list says it hasn't posted yet", /not posted yet/.test(root.querySelector(".card").textContent));
press(w, w.document.body, "Escape");
k(root, "done").click(); await settle();
check("Done: says what is still waiting, and that it is kept", /^1 comment hasn't posted yet\. It's kept here and posts the next time this page is open and online\.$/.test(root.querySelector(".card p").textContent), root.querySelector(".card p").textContent);
press(w, w.document.body, "Escape");
bu = new w.Event("beforeunload", { cancelable: true }); w.dispatchEvent(bu);
check("leaving with a comment not yet posted asks first", bu.defaultPrevented === true);
offline = false; w.kept = [];
w.dispatchEvent(new w.Event("pagehide")); await tick(60);
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("leaving the page sends anything not yet posted on a request that outlives the page", w.kept.length === 1 && /\/api\/fb\/post$/.test(w.kept[0]) && list.some((c) => c.text === "Offline note"));
await UI.flush();
check("back online: it posts, once", UI.mine()[1].status === "posted" && (await team("GET", "/api/fb/list?tool=test-tool")).data.comments.length === 2);

// Done
k(root, "done").click(); await settle();
card = root.querySelector(".card");
check("Done: Thanks, with the count", card.querySelector("h2").textContent === "Thanks. 2 comments sent." && !!byText(card, "button", /^Keep going$/));
byText(card, "button", /^Keep going$/).click(); await settle();

// Clear all, only after holding for three seconds
k(root, "count").click(); await settle();
const hold = k(root.querySelector(".card"), "clear");
check("clear: the list ends with a button you hold, saying how many", hold && hold.textContent === "Hold to clear all 2" && /Press and hold for 3 seconds/.test(hold.getAttribute("aria-label")));
hold.click(); await tick(50);
check("clear: a click alone does nothing", UI.mine().length === 2);
pointer(w, hold, "pointerdown", 10, 10); await tick(700);
check("clear: holding says to keep holding, and fills as it goes", /Keep holding/.test(hold.textContent) && /scaleX\(0\.[1-9]/.test(hold.querySelector(".fill").style.transform), hold.querySelector(".fill").style.transform);
pointer(w, hold, "pointerup", 10, 10);
await tick(2600);
check("clear: letting go early stops it, and nothing is cleared", hold.textContent === "Hold to clear all 2" && UI.mine().length === 2 && (await team("GET", "/api/fb/list?tool=test-tool")).data.comments.length === 2);
offline = true;
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
typeIn(w, root.querySelector(".card textarea"), "Written just before clearing"); k(root.querySelector(".card"), "post").click();
await until(() => UI.mine().length === 3 && UI.mine()[2].status === "waiting");
k(root, "count").click(); await settle();
const hold2 = k(root.querySelector(".card"), "clear");
hold2.dispatchEvent(new w.KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true }));
await tick(3150);
await until(() => /Cleared/.test(root.querySelector(".toast").textContent), 2000);
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("clear: held for three seconds (Space works too), the tester's list and pins empty, and the board keeps every comment", UI.mine().length === 0 && list.length === 2 && root.querySelector(".toast").textContent === "Cleared. The team still has your comments." && !k(root, "count") && !root.querySelector(".pin"), root.querySelector(".toast").textContent + " / " + list.length);
offline = false;
await UI.flush();
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("clear: a comment not yet posted when the list was cleared still reaches the board", list.length === 3 && list.some((c) => c.text === "Written just before clearing") && UI.mine().length === 0);
check("clear: the kit never deletes from the board when clearing", !/fb\/delete[\s\S]{0,400}cleared|cleared[\s\S]{0,400}fb\/delete/.test(src("feedback-ui.js").slice(src("feedback-ui.js").indexOf("function clearAll"), src("feedback-ui.js").indexOf("function askName"))) && !/api\(/.test(src("feedback-ui.js").slice(src("feedback-ui.js").indexOf("function clearAll"), src("feedback-ui.js").indexOf("function askName"))));
press(w, w.document.body, "Escape");
k(root, "done").click(); await settle();
check("Done still counts what was sent before the list was cleared", root.querySelector(".card h2").textContent === "Thanks. 3 comments sent.", root.querySelector(".card h2").textContent);
press(w, w.document.body, "Escape");

// Done and turning off
k(root, "done").click(); await settle();
card = root.querySelector(".card");
k(card, "off").click(); await settle();
check("turn off: the bar goes and the tab forgets", !w.document.querySelector('[data-epkit="feedback"]') && w.sessionStorage.getItem("ep-feedback") === null && w.sessionStorage.getItem("ep-feedback-code") === null && FB.on === false);
check("turn off: ?feedback leaves the address, the rest stays", !/feedback/.test(w.location.search) && /host=ABCD/.test(w.location.search), w.location.href);
const before = FB.actions.length; w.document.getElementById("start").click();
check("turn off: nothing more is recorded", FB.actions.length === before);

/* =================== a comment an older kit couldn't post =================== */
{
  const stuck = { id: "stuck000000001", edit: "S".repeat(24), tool: "test-tool", created: Date.now(), updated: Date.now(), name: "Ana", text: "Left over from an older kit", ver: "", screen: "cover",
    where: { x: 1, y: 1, w: 10, h: 10, vw: 1024, vh: 768, xp: 0.1, yp: 0.1, wp: 1, hp: 1, area: true, el: { tag: "div", text: "", path: "main#stage" } },
    ctx: { name: "Test Tool", errors: Array.from({ length: 60 }, (_, i) => ({ what: "x".repeat(240) + i })) }, status: "failed", err: "too big" };
  const f2 = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { before: (win) => win.localStorage.setItem("ep-feedback-mine", JSON.stringify([stuck])) });
  f2.EPKit = { tool: { id: "test-tool" } };
  runKit(f2, "feedback.js"); runKit(f2, "feedback-ui.js");
  await until(() => f2.EPKit.feedback.ui.mine()[0].status === "posted");
  const got = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments.find((c) => c.id === stuck.id);
  check("a comment an older kit couldn't post is sent on the next visit, its context trimmed to fit", f2.EPKit.feedback.ui.mine()[0].status === "posted" && got && got.text === stuck.text && got.ctx.errors.length <= 2);
}

/* =================== no stale words, no lost words =================== */
{
  const listOf = async () => (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
  const seedName = (win) => { win.localStorage.setItem("ep-feedback-coach", "1"); win.localStorage.setItem("ep-feedback-name", "Rae"); };
  async function tester(before) {
    const p = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { before });
    p.EPKit = { tool: { id: "test-tool", screen: () => "cover" } };
    const nb = p.document.getElementById("nextBtn"); rect(nb, 800, 700, 120, 44);
    p.document.elementsFromPoint = (x, y) => (x >= 800 && x <= 920 && y >= 700 && y <= 744) ? [nb, p.document.body] : [p.document.body];
    runKit(p, "feedback.js"); runKit(p, "feedback-ui.js");
    await until(() => p.EPKit.feedback.ui.link() === true);
    const R = fbRoot(p), sh = R.querySelector(".shield");
    return { p, R, U: p.EPKit.feedback.ui, pick: async () => { pointer(p, sh, "pointerdown", 850, 720); pointer(p, sh, "pointerup", 850, 720); await settle(); } };
  }
  const A = await tester(seedName);
  /* a change saved while the first post is still on its way */
  A.p.slow = 150; A.p.maxOut = 0;
  k(A.R, "comment").click(); await settle(); await A.pick();
  typeIn(A.p, A.R.querySelector(".card textarea"), "First words"); k(A.R.querySelector(".card"), "post").click();
  await tick(20);
  const cA = A.U.mine()[0];
  A.R.querySelector(".pin").click(); await settle();
  typeIn(A.p, A.R.querySelector(".card textarea"), "Corrected words"); k(A.R.querySelector(".card"), "post").click();
  check("a change saved while the first post is out is not marked posted yet, here or in storage", cA.status !== "posted" && JSON.parse(A.p.localStorage.getItem("ep-feedback-mine")).find((c) => c.id === cA.id).status !== "posted");
  await until(() => cA.status === "posted", 3000);
  let got = (await listOf()).find((c) => c.id === cA.id);
  check("the board ends with the newest words, sent one request at a time", got && got.text === "Corrected words" && A.p.maxOut === 1, (got && got.text) + " / " + A.p.maxOut);
  A.p.slow = 0;
  /* a change after a reload keeps the context and pointer the board already has */
  const before = (await listOf()).find((c) => c.id === cA.id);
  const B = await tester((win) => { seedName(win); win.localStorage.setItem("ep-feedback-mine", A.p.localStorage.getItem("ep-feedback-mine")); });
  check("after a reload, a posted comment's context is not kept here", !B.U.mine()[0].ctx);
  k(B.R, "count").click(); await settle();
  B.R.querySelector(".card .item").click(); await settle();
  typeIn(B.p, B.R.querySelector(".card textarea"), "Third words"); k(B.R.querySelector(".card"), "post").click();
  await until(() => B.U.mine()[0].status === "posted");
  got = (await listOf()).find((c) => c.id === cA.id);
  check("a change after a reload keeps the context and pointer the board already has", got.text === "Third words" && got.ctx.settings && JSON.stringify(got.ctx) === JSON.stringify(before.ctx) && JSON.stringify(got.where) === JSON.stringify(before.where), JSON.stringify(got.ctx).slice(0, 120));
  /* two tabs, and two tools, never overwrite each other */
  const other = { id: "othertab000001", edit: "O".repeat(24), tool: "test-tool", created: Date.now(), updated: Date.now(), name: "Rae", text: "Written in another tab", ver: "", screen: "cover", where: {}, ctx: { name: "Test Tool" }, status: "waiting" };
  const st0 = JSON.parse(B.p.localStorage.getItem("ep-feedback-mine")); st0.push(other); B.p.localStorage.setItem("ep-feedback-mine", JSON.stringify(st0));
  B.p.localStorage.setItem("ep-feedback-draft:other-tool", JSON.stringify({ tool: "other-tool", id: "", text: "Words for another tool", screen: "x", sel: "", at: 1 }));
  k(B.R, "comment").click(); await settle(); await B.pick();
  typeIn(B.p, B.R.querySelector(".card textarea"), "Tab B's own comment"); k(B.R.querySelector(".card"), "post").click();
  await until(() => B.U.mine().some((c) => c.text === "Tab B's own comment" && c.status === "posted"));
  check("a save in one tab keeps a comment another tab saved", JSON.parse(B.p.localStorage.getItem("ep-feedback-mine")).some((c) => c.id === other.id));
  await B.U.flush();
  check("and this tab picks it up and posts it", B.U.mine().some((c) => c.id === other.id) && (await listOf()).some((c) => c.text === "Written in another tab"));
  k(B.R, "comment").click(); await settle(); await B.pick();
  k(B.R.querySelector(".card"), "cancel").click(); await settle();
  check("another tool's half-written words are never touched", JSON.parse(B.p.localStorage.getItem("ep-feedback-draft:other-tool")).text === "Words for another tool");
  const st1 = JSON.parse(B.p.localStorage.getItem("ep-feedback-mine")); st1.push(Object.assign({}, other, { id: "othertab000002", text: "Arrived from a third tab" })); B.p.localStorage.setItem("ep-feedback-mine", JSON.stringify(st1));
  B.p.dispatchEvent(new B.p.StorageEvent("storage", { key: "ep-feedback-mine" }));
  check("a save in another tab shows up here at once", B.U.mine().some((c) => c.id === "othertab000002") && k(B.R, "count").textContent === String(B.U.mine().length));
  /* words kept by the first version of the kit, in the old shared slot */
  const M = await tester((win) => { seedName(win); win.localStorage.setItem("ep-feedback-draft", JSON.stringify({ tool: "test-tool", id: "", text: "Kept in the old slot", screen: "cover", sel: "#nextBtn", at: 1, back: false })); });
  check("words in the old shared slot move to their tool's slot and come back", M.p.localStorage.getItem("ep-feedback-draft") === null && !M.R.querySelector(".card").hidden && M.R.querySelector(".card textarea").value === "Kept in the old slot");
  press(M.p, M.p.document.body, "Escape");
  /* a delete while the first post is still on its way */
  B.p.slow = 150;
  k(B.R, "comment").click(); await settle(); await B.pick();
  typeIn(B.p, B.R.querySelector(".card textarea"), "Delete me quickly"); k(B.R.querySelector(".card"), "post").click();
  await tick(20);
  const dc = B.U.mine().find((c) => c.text === "Delete me quickly");
  k(B.R, "count").click(); await settle();
  B.R.querySelector(".card .item").click(); await settle();
  k(B.R.querySelector(".card"), "delete").click(); k(B.R.querySelector(".card"), "delete").click();
  await until(() => !B.U.mine().some((c) => c.id === dc.id), 3000); await tick(200);
  check("a delete while the first post is out still takes it off the board", !(await listOf()).some((c) => c.id === dc.id));
  B.p.slow = 0;
  /* Hold to clear only acts on a full, unbroken hold */
  const n0 = B.U.mine().length;
  k(B.R, "count").click(); await settle();
  let hb = k(B.R.querySelector(".card"), "clear");
  hb.dispatchEvent(new B.p.MouseEvent("pointerdown", { button: 2, bubbles: true, composed: true, cancelable: true }));
  check("hold: a right-click does not start it", !hb.classList.contains("holding"));
  hb.dispatchEvent(new B.p.KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true }));
  await tick(300);
  press(B.p, B.p.document.body, "Escape");
  await tick(3100);
  check("hold: closing the list mid-hold stops it", B.U.mine().length === n0);
  k(B.R, "count").click(); await settle();
  hb = k(B.R.querySelector(".card"), "clear");
  hb.dispatchEvent(new B.p.KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true }));
  await tick(300);
  B.p.dispatchEvent(new B.p.Event("blur"));
  await tick(3100);
  check("hold: switching away mid-hold stops it", B.U.mine().length === n0 && !hb.classList.contains("holding"));
  hb.dispatchEvent(new B.p.KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true, cancelable: true }));
  await tick(300);
  hb.dispatchEvent(new B.p.KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true, cancelable: true }));
  await tick(3100);
  check("hold: any other key stops it", B.U.mine().length === n0);
  press(B.p, B.p.document.body, "Escape");
  /* a full browser storage */
  const realSet = B.p.Storage.prototype.setItem;
  B.p.Storage.prototype.setItem = function (key, v) { if (key === "ep-feedback-mine") throw new B.p.DOMException("full", "QuotaExceededError"); return realSet.call(this, key, v); };
  offline = true;
  k(B.R, "comment").click(); await settle(); await B.pick();
  typeIn(B.p, B.R.querySelector(".card textarea"), "Written with storage full"); k(B.R.querySelector(".card"), "post").click();
  await until(() => /storage is full/.test(B.R.querySelector(".toast").textContent) || /back online/.test(B.R.querySelector(".toast").textContent), 2000);
  const full = /This browser's storage is full\. Keep this page open until your comments post\./.test(B.R.querySelector(".toast").textContent) || B.U.mine().some((c) => c.text === "Written with storage full");
  let bu2 = new B.p.Event("beforeunload", { cancelable: true }); B.p.dispatchEvent(bu2);
  check("full storage: the tester is told to keep the page open, and leaving asks first", full && bu2.defaultPrevented === true);
  await until(() => B.U.mine().some((c) => c.text === "Written with storage full" && c.status === "waiting"));
  B.p.Storage.prototype.setItem = realSet; offline = false;
  await B.U.flush();
  check("full storage: the comment still posts once the network is back", (await listOf()).some((c) => c.text === "Written with storage full"));
}

/* =================== a bad link, and no link =================== */
{
  const b = makePage("https://ep.github.io/pt/field-tools/test-tool/?feedback=WRONG1");
  runKit(b, "feedback.js"); runKit(b, "feedback-ui.js");
  await until(() => b.EPKit.feedback.ui.link() === false);
  const r = fbRoot(b);
  check("bad link: no tip pointing at a Comment button that isn't there", r.querySelector(".tip").hidden);
  check("bad link: the bar says so and what to do", /^This feedback link isn't working\. Ask for a new one\.$/.test(r.querySelector(".bar .msg").textContent) && !k(r, "comment") && !!byText(r, "button", /^Turn off$/));
  const n = makePage("https://ep.github.io/pt/field-tools/test-tool/?feedback");
  runKit(n, "feedback.js"); runKit(n, "feedback-ui.js"); await settle();
  check("no code: the bar asks for a feedback link", /This page needs a feedback link\. Ask for one\./.test(fbRoot(n).querySelector(".bar").textContent));
  const old = CODE; CODE = (await team("POST", "/api/fb/code", {})).data.code;
  const waitingOne = { id: "waiting0000001", edit: "W".repeat(24), tool: "test-tool", created: Date.now(), updated: Date.now(), name: "Ana", text: "Written before the link changed", ver: "", screen: "cover", where: {}, ctx: {}, status: "waiting" };
  const o = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${old}`, { before: (win) => win.localStorage.setItem("ep-feedback-mine", JSON.stringify([waitingOne])) });
  runKit(o, "feedback.js"); runKit(o, "feedback-ui.js");
  await until(() => o.EPKit.feedback.ui.link() === false);
  check("a retired tester code says so, and that unsent comments are kept", /isn't working\. Ask for a new one\. Your unsent comment is kept here and posts from the new link\.$/.test(fbRoot(o).querySelector(".bar .msg").textContent), fbRoot(o).querySelector(".bar .msg").textContent);
  const kept = o.localStorage.getItem("ep-feedback-mine");
  const fresh = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { before: (win) => win.localStorage.setItem("ep-feedback-mine", kept) });
  runKit(fresh, "feedback.js"); runKit(fresh, "feedback-ui.js");
  await until(() => fresh.EPKit.feedback.ui.mine()[0] && fresh.EPKit.feedback.ui.mine()[0].status === "posted");
  check("the new link posts what the old one couldn't", (await team("GET", "/api/fb/list?tool=test-tool")).data.comments.some((c) => c.text === "Written before the link changed"));
}

/* =================== on a phone =================== */
{
  const p = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${CODE}`, { coarse: true });
  Object.defineProperty(p, "innerWidth", { configurable: true, value: 390 }); Object.defineProperty(p, "innerHeight", { configurable: true, value: 844 });
  p.EPKit = { tool: { id: "test-tool", dot: "bottom-center", screen: () => "cover" } };
  runKit(p, "feedback.js"); runKit(p, "feedback-ui.js");
  await until(() => p.EPKit.feedback.ui.link() === true);
  const r = fbRoot(p);
  check("phone: bigger targets, placed where the tool asks", r.querySelector(".k").classList.contains("c") && r.querySelector(".bar").classList.contains("bc"));
  check("phone: the first tip says tap", /^Tap Comment, then what your comment is about\./.test(r.querySelector(".tip").textContent));
  k(r, "comment").click(); await settle();
  check("phone: the instruction says tap", r.querySelector(".tip p").textContent === "Tap what your comment is about.");
  const nb = p.document.getElementById("nextBtn"); rect(nb, 250, 780, 120, 44);
  p.document.elementsFromPoint = () => [nb, p.document.body];
  pointer(p, r.querySelector(".shield"), "pointermove", 300, 800);
  check("phone: no hover outline", r.querySelector(".hover").hidden);
  pointer(p, r.querySelector(".shield"), "pointerdown", 300, 800); pointer(p, r.querySelector(".shield"), "pointerup", 300, 800); await settle();
  const cd = r.querySelector(".card");
  check("phone: a tap picks the part and the comment box docks across the top, clear of it", !r.querySelector(".box").hidden && p.EPKit.feedback.ui.state.target.el === nb && cd.classList.contains("dock") && cd.style.top === "12px");
}
{
  const f = makePage("file:///Users/someone/Downloads/test-tool.html?feedback=" + CODE);
  f.EPKit = { tool: { id: "test-tool", version: "v9" } };
  runKit(f, "feedback.js"); runKit(f, "feedback-ui.js"); await settle();
  check("a file opened from a computer stamps the tool's own version", f.EPKit.feedback.ui.version() === "tool:v9");
  check("a file's address shows only its name, never the tester's folders", f.EPKit.feedback.ui.context().page === "a file on the tester's computer: test-tool.html?feedback");
}

/* =================== Email this =================== */
/* =================== Email this on its own =================== */
{
  const v = makePage("https://ep.github.io/pt/field-tools/other/");
  let ready = false; v.document.addEventListener("epkit:email-ready", () => { ready = true; });
  runKit(v, "send.js");
  check("send.js: announces itself so buttons can appear", ready && typeof v.EPKit.email === "function");
  const L = v.EPKit.emailLinks;
  check("links: the email app link keeps new lines", L.mailto({ to: ["a@b.co"], subject: "Hi & bye", body: "one\ntwo" }) === "mailto:a%40b.co?subject=Hi%20%26%20bye&body=one%0D%0Atwo");
  check("links: Outlook on the web", L.outlook({ to: ["a@b.co", "c@d.co"], subject: "S", body: "B" }) === "https://outlook.office.com/mail/deeplink/compose?to=a%40b.co%2Cc%40d.co&subject=S&body=B");
  const longBody = "word ".repeat(1200);
  const fitted = L.fit(longBody, 1800, true);
  check("links: long bodies are shortened with a note", fitted.length <= 1800 && fitted.endsWith("(Shortened to fit. The attachment has everything.)"));
  check("links: short bodies are left alone", L.fit("short", 1800, true) === "short");

  const keys = []; v.document.addEventListener("keydown", (e) => keys.push(e.key));
  const done = v.EPKit.email({ subject: "Our card <b>", body: "line one\nline two", theme: "dark",
    files: () => Promise.resolve([{ name: "card<script>x</script>.png", blob: new v.Blob(["12345"], { type: "image/png" }) }]) });
  await settle(10);
  let r = sendRoot(v);
  check("sheet: a labelled dialog called Email this", !!r && r.querySelector('[role="dialog"]').getAttribute("aria-label") === "Email this" && /Email this/.test(r.querySelector("h2").textContent));
  check("sheet: file names are shown as text and made safe", !r.querySelector("script") && r.querySelector(".file span").textContent === "card-script-x-script-.png", r.querySelector(".file span").textContent);
  check("sheet: dark theme when asked", r.querySelector(".sheet").style.getPropertyValue("--card") === "#1B2130");
  check("sheet: says choosing downloads the file", /Choosing one downloads/.test(r.textContent));
  press(v, r.querySelector('[data-route="mailto"]'), "ArrowRight");
  check("sheet: keys never reach the tool behind it", keys.length === 0);
  v.downloads.length = 0;
  r.querySelector('[data-route="mailto"]').click(); await settle();
  const mail = v.downloads.find((d) => d.href.startsWith("mailto:"));
  check("sheet: the email app route downloads the file, then opens the email", v.downloads[0] && /\.png$/.test(v.downloads[0].download) && !!mail && mail.href.includes("body=line%20one%0D%0Aline%20two"), JSON.stringify(v.downloads));
  check("sheet: then says what is left to do", /Almost there/.test(r.textContent) && /Attach card/.test(r.textContent));
  byText(r, "button", /^Done$/).click();
  const res = await done;
  check("sheet: Done closes it and reports the route", !sendRoot(v) && res.route === "mailto");
  check("sheet: remembers the route for next time", v.localStorage.getItem("ep-kit-mail-route") === "mailto");

  const p2 = v.EPKit.email({ subject: "S", body: "B", files: [{ name: "a.csv", blob: new v.Blob(["a,b"], { type: "text/csv" }) }] });
  await settle(10); r = sendRoot(v);
  check("sheet: the remembered route comes first and is the one filled button", r.querySelector(".routes .tile").getAttribute("data-route") === "mailto" && r.querySelectorAll(".primary").length === 1);
  let copied = null; v.navigator.clipboard = { writeText: (t) => { copied = t; return Promise.resolve(); } };
  r.querySelector('[data-route="copy"]').click(); await settle(6);
  check("sheet: Copy the message copies the subject and body", copied === "Subject: S\n\nB");
  press(v, v.document.body, "Escape"); await settle();
  check("sheet: Escape closes it", !sendRoot(v) && (await p2).route === "copy");

  const bad = v.EPKit.email({ subject: "S", body: "B", files: () => Promise.reject(new Error("no")) });
  await settle(10);
  check("sheet: says plainly when the file couldn't be made", /Couldn't get the file ready/.test(sendRoot(v).textContent));
  press(v, v.document.body, "Escape"); await bad;
}
{
  // A phone: the share sheet attaches the files
  const p = makePage("https://ep.github.io/pt/field-tools/other/", { coarse: true });
  let shared = null;
  p.navigator.canShare = () => true; p.navigator.share = (d) => { shared = d; return Promise.resolve(); };
  runKit(p, "send.js");
  const out = p.EPKit.email({ subject: "S", body: "B", files: [{ name: "card.png", blob: new p.Blob(["x"], { type: "image/png" }) }] });
  await settle(10);
  let r = sendRoot(p);
  check("phone: Share is the main choice", /^Share$/.test(r.querySelector(".primary").textContent) && !!byText(r, "button", /Write the email instead/));
  r.querySelector(".primary").click(); await settle(6);
  check("phone: sharing passes the file, subject and body", shared && shared.files.length === 1 && shared.files[0].name === "card.png" && shared.title === "S" && shared.text === "B");
  check("phone: a finished share closes the sheet", !sendRoot(p) && (await out).sent === true);

  // A phone sending text-only feedback: the email itself carries everything
  const out2 = p.EPKit.email({ subject: "S", body: "B", complete: true, to: ["x@y.co"], files: [{ name: "f.pdf", blob: new p.Blob(["%PDF"], { type: "application/pdf" }) }] });
  await settle(10); r = sendRoot(p);
  check("phone, complete body: Write the email is the main choice", /^Write the email$/.test(r.querySelector(".primary").textContent));
  p.downloads.length = 0;
  r.querySelector(".primary").click(); await settle();
  check("phone, complete body: no download, just the email", p.downloads.length === 1 && p.downloads[0].href.startsWith("mailto:x%40y.co?"));
  byText(sendRoot(p), "button", /^Done$/).click(); await out2;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
