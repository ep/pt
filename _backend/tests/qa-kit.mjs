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
    const req = new Request(u, { method: o.method || "GET", headers: Object.assign({ Origin: "https://ep.github.io", "CF-Connecting-IP": "10.0.0.1" }, o.headers || {}), body: o.body });
    const res = await worker.fetch(req, env);
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
  for (const f of ["feedback.js", "feedback-ui.js", "send.js"]) {
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
  check("feedback-ui.js: talks only to the pt worker, plus reading its own page once", (ui.match(/fetch\(/g) || []).length === 2 && /fetch\(API \+ path/.test(ui) && /fetch\(location\.pathname/.test(ui));
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
  await until(() => msgs.some((m) => m.type === "epkit-replay"), 3000);
  const map = msgs.find((m) => m.type === "epkit-map"), msg = msgs.find((m) => m.type === "epkit-replay");
  check("replay: the tool is asked to open that screen with those settings", got && got.screen === "ladder" && got.settings.mode === "team");
  check("replay: the frame tells the board it is ready, and how big it is", msg && msg.ok === true && msg.w > 0);
  check("replay: the tool's sections go to the board first (the board cleans them up)", map && msgs.indexOf(map) < msgs.indexOf(msg) && map.sections.length === 3 && map.sections[1].name === "1. Better way" && map.sections[1].screens.join() === "ladder,42", JSON.stringify(map));
  check("replay: no bar, nothing recorded", !w.document.querySelector("[data-epkit]") && w.EPKit.feedback.on === false);
}
{
  const w = makePage("about:blank", { before: (win) => { win.EPKitReplay = { map: true }; } });
  let restored = false; const msgs = [];
  w.EPKit = { tool: { id: "test-tool", restore: () => { restored = true; return true; }, sections: [{ name: "Only part", screens: ["a"] }] } };
  w.addEventListener("message", (e) => { msgs.push(e.data); });
  runKit(w, "feedback.js");
  await until(() => msgs.length, 3000); await tick(700);
  check("map only: the board can ask just for the sections, and nothing else runs", msgs.length === 1 && msgs[0].type === "epkit-map" && msgs[0].sections[0].name === "Only part" && !restored);
}
{
  const w = makePage("about:blank", { before: (win) => { win.EPKitReplay = { map: true }; } });
  const msgs = [];
  w.EPKit = { tool: { id: "test-tool", sections: () => { throw new Error("nope"); } } };
  w.addEventListener("message", (e) => { msgs.push(e.data); });
  runKit(w, "feedback.js");
  await until(() => msgs.length, 3000);
  check("map only: a tool without working sections says so instead of breaking", msgs[0].type === "epkit-map" && msgs[0].sections === null);
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
check("first visit: one tip points at Comment", /^Click Comment, then the area you mean\.OK$/.test(root.querySelector(".tip").textContent) && !root.querySelector(".tip").hidden);
check("version: the comment will carry the file's Git fingerprint", UI.version() === "git:" + PAGE_SHA, UI.version());
check("actions: clicks by label, private ones unnamed, typed words never", FB.actions.some((a) => a.what === 'clicked button "Start the round"') && FB.actions.some((a) => a.what === "clicked a private button") && FB.actions.some((a) => a.what === "edited Your answer") && !JSON.stringify(FB.actions).includes("secret"));
check("errors: kept, with keys removed", FB.errors.length === 1 && /app\.js:12/.test(FB.errors[0].what) && !FB.errors[0].what.includes("SECRETKEY99"));

// Comment: point, outline, click, box
const nextBtn = w.document.getElementById("nextBtn");
rect(nextBtn, 800, 700, 120, 44);
w.document.elementsFromPoint = (x, y) => (x >= 800 && x <= 920 && y >= 700 && y <= 744) ? [nextBtn, w.document.getElementById("bottom"), w.document.body] : [w.document.getElementById("stage"), w.document.body];
rect(w.document.getElementById("stage"), 0, 0, 1024, 690);
k(root, "comment").click(); await settle();
const shield = root.querySelector(".shield"), boxEl = root.querySelector(".box");
check("comment mode: one short instruction", root.querySelector(".tip p").textContent === "Click the area your feedback is about." && root.querySelector(".tip").textContent.indexOf("OK") < 0);
check("comment mode: Comment turns into Cancel", k(root, "comment").textContent === "Cancel" && !shield.hidden);
check("comment mode: the first tip is not shown again", w.localStorage.getItem("ep-feedback-coach") === "1");
pointer(w, shield, "pointermove", 850, 720);
const hv = root.querySelector(".hover");
check("pointing: the area under the pointer is outlined", !hv.hidden && hv.style.left === "796px" && hv.style.width === "128px" && hv.style.height === "52px", hv.style.cssText);
pointer(w, shield, "pointermove", 300, 300);
check("pointing: a big container is never the whole page, just the spot", hv.style.width === "180px" && hv.style.height === "120px", hv.style.cssText);
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
let card = root.querySelector(".card");
check("click: the area gets a square box with four corner handles", !boxEl.hidden && boxEl.style.left === "796px" && boxEl.querySelectorAll(".h").length === 4);
const nameIn = card.querySelector('input[placeholder="Your name"]'), ta = card.querySelector('textarea[placeholder="Add a comment"]');
check("click: a comment box opens, asking a name the first time", !!nameIn && !!ta && k(card, "post").textContent === "Post" && k(card, "post").disabled);
check("click: nothing else to read", !card.querySelector("p"));
pointer(w, boxEl.querySelector(".se"), "pointerdown", 924, 748); pointer(w, boxEl, "pointermove", 964, 768); pointer(w, boxEl, "pointerup", 964, 768);
check("box: dragging a corner resizes it", boxEl.style.width === "168px" && boxEl.style.height === "72px", boxEl.style.cssText);
pointer(w, boxEl, "pointerdown", 850, 720); pointer(w, boxEl, "pointermove", 750, 700); pointer(w, boxEl, "pointerup", 750, 700);
check("box: dragging the middle moves it", boxEl.style.left === "696px" && boxEl.style.top === "676px", boxEl.style.cssText);
pointer(w, boxEl, "pointerdown", 800, 700); pointer(w, boxEl, "pointermove", 900, 720); pointer(w, boxEl, "pointerup", 900, 720);
pageKeys.length = 0;
press(w, ta, "ArrowRight"); press(w, ta, " ");
check("keys typed in a comment never reach the tool", pageKeys.length === 0, pageKeys.join(","));
const NOTE1 = 'Next jumps when the timer appears <img src=x onerror="window.pwned=1">';
typeIn(w, nameIn, "Ana"); typeIn(w, ta, NOTE1);
check("Post turns on once there are words", !k(card, "post").disabled);
k(card, "post").click();
await until(() => UI.mine()[0] && UI.mine()[0].status === "posted");
let list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
const c1 = list[0];
check("post: the comment reaches the worker straight away", list.length === 1 && c1.text === NOTE1 && c1.name === "Ana", JSON.stringify(list).slice(0, 200));
check("post: it says Posted, and the bar counts it", /Posted/.test(root.querySelector(".toast").textContent) && k(root, "count") && k(root, "count").textContent === "1");
check("post: where it points, as pixels and as shares of the window", c1.where.x === 796 && c1.where.w === 168 && c1.where.vw === 1024 && Math.abs(c1.where.xp - 77.7) < 0.2 && c1.where.el.path === "footer#bottom > button#nextBtn" && c1.where.el.text === "Next", JSON.stringify(c1.where));
check("post: the screen and the file version", c1.screen === "ladder" && c1.ver === "git:" + PAGE_SHA);
check("post: the part of the tool the screen belongs to", c1.ctx.section === "2. Why it exists", c1.ctx.section);
check("post: context with keys, codes and the tester code removed", c1.ctx.page === "https://ep.github.io/pt/field-tools/test-tool/?host=[removed]&k=[removed]&feedback#[removed]" && c1.ctx.settings.link.includes("k=[removed]"), c1.ctx.page);
check("post: nothing secret anywhere in what was sent", !JSON.stringify(c1).includes("SECRETKEY99") && !JSON.stringify(c1).includes(CODE) && !JSON.stringify(c1).includes("secret answer") && !JSON.stringify(c1).includes("tok=abc"));
check("post: the box and the comment box close", boxEl.hidden && root.querySelector(".card").hidden && shield.hidden && k(root, "comment").textContent === "Comment");
check("the name is kept for next time", w.localStorage.getItem("ep-feedback-name") === "Ana");
const pin = root.querySelector(".pin");
check("pins: this screen shows a numbered pin for it", pin && pin.textContent === "1" && /^Comment 1: Next jumps/.test(pin.getAttribute("aria-label")));
check("typed text is never run as HTML", !root.querySelector("img") && w.pwned === undefined);

// Escape, then draw a box by dragging, and Ctrl+Enter
k(root, "comment").click(); await settle();
press(w, w.document.body, "Escape");
check("Escape leaves comment mode", root.querySelector(".shield").hidden && k(root, "comment").textContent === "Comment");
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 100, 100); pointer(w, shield, "pointermove", 200, 160); pointer(w, shield, "pointermove", 300, 250); pointer(w, shield, "pointerup", 300, 250); await settle();
check("drag: drawing a box marks any area", boxEl.style.left === "100px" && boxEl.style.width === "200px" && boxEl.style.height === "150px");
card = root.querySelector(".card");
check("second comment: no name question", !card.querySelector('input[placeholder="Your name"]'));
typeIn(w, card.querySelector("textarea"), "The heading is hard to read.\nEspecially in dark mode.");
press(w, card.querySelector("textarea"), "Enter", { ctrlKey: true });
await until(() => UI.mine().length === 2 && UI.mine()[1].status === "posted");
list = (await team("GET", "/api/fb/list?tool=test-tool")).data.comments;
check("Ctrl+Enter posts", list.length === 2 && list[1].where.area === true && list[1].text === "The heading is hard to read.\nEspecially in dark mode.");

// Edit from a pin
root.querySelector(".pin").click(); await settle();
card = root.querySelector(".card");
check("pin: opens the comment with Save and Delete", card.querySelector("textarea").value === NOTE1 && k(card, "post").textContent === "Save" && !!k(card, "delete"));
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

// Offline: saved here, posted later
offline = true;
k(root, "comment").click(); await settle();
pointer(w, shield, "pointerdown", 850, 720); pointer(w, shield, "pointerup", 850, 720); await settle();
card = root.querySelector(".card"); typeIn(w, card.querySelector("textarea"), "Offline note"); k(card, "post").click();
await until(() => /online again/.test(root.querySelector(".toast").textContent));
check("offline: the comment waits in this browser", UI.mine()[1].status === "waiting" && root.querySelector(".pin.wait"));
k(root, "count").click(); await settle();
check("offline: the list says it hasn't posted yet", /not posted yet/.test(root.querySelector(".card").textContent));
press(w, w.document.body, "Escape");
k(root, "done").click(); await settle();
check("Done: says what is still waiting", /1 comment hasn't posted yet\. Keep this page open until it does\./.test(root.querySelector(".card").textContent));
press(w, w.document.body, "Escape");
offline = false;
await UI.flush();
check("back online: it posts", UI.mine()[1].status === "posted" && (await team("GET", "/api/fb/list?tool=test-tool")).data.comments.length === 2);

// Done and turning off
k(root, "done").click(); await settle();
card = root.querySelector(".card");
check("Done: Thanks, with the count", card.querySelector("h2").textContent === "Thanks. 2 comments sent." && !!byText(card, "button", /^Keep going$/));
k(card, "off").click(); await settle();
check("turn off: the bar goes and the tab forgets", !w.document.querySelector('[data-epkit="feedback"]') && w.sessionStorage.getItem("ep-feedback") === null && w.sessionStorage.getItem("ep-feedback-code") === null && FB.on === false);
check("turn off: ?feedback leaves the address, the rest stays", !/feedback/.test(w.location.search) && /host=ABCD/.test(w.location.search), w.location.href);
const before = FB.actions.length; w.document.getElementById("start").click();
check("turn off: nothing more is recorded", FB.actions.length === before);

/* =================== a bad link, and no link =================== */
{
  const b = makePage("https://ep.github.io/pt/field-tools/test-tool/?feedback=WRONG1");
  runKit(b, "feedback.js"); runKit(b, "feedback-ui.js");
  await until(() => b.EPKit.feedback.ui.link() === false);
  const r = fbRoot(b);
  check("bad link: the bar says so and what to do", /This feedback link isn't working\. Ask for a new one\./.test(r.querySelector(".bar").textContent) && !k(r, "comment") && !!byText(r, "button", /^Turn off$/));
  const n = makePage("https://ep.github.io/pt/field-tools/test-tool/?feedback");
  runKit(n, "feedback.js"); runKit(n, "feedback-ui.js"); await settle();
  check("no code: the bar asks for a feedback link", /This page needs a feedback link\. Ask for one\./.test(fbRoot(n).querySelector(".bar").textContent));
  const old = CODE; CODE = (await team("POST", "/api/fb/code", {})).data.code;
  const o = makePage(`https://ep.github.io/pt/field-tools/test-tool/?feedback=${old}`);
  runKit(o, "feedback.js"); runKit(o, "feedback-ui.js");
  await until(() => o.EPKit.feedback.ui.link() === false);
  check("a retired tester code shows the same message", /isn't working/.test(fbRoot(o).querySelector(".bar").textContent));
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
  check("phone: the first tip says tap", /^Tap Comment, then the area you mean\./.test(r.querySelector(".tip").textContent));
  k(r, "comment").click(); await settle();
  check("phone: the instruction says tap", r.querySelector(".tip p").textContent === "Tap the area your feedback is about.");
  const nb = p.document.getElementById("nextBtn"); rect(nb, 250, 780, 120, 44);
  p.document.elementsFromPoint = () => [nb, p.document.body];
  pointer(p, r.querySelector(".shield"), "pointermove", 300, 800);
  check("phone: no hover outline", r.querySelector(".hover").hidden);
  pointer(p, r.querySelector(".shield"), "pointerdown", 300, 800); pointer(p, r.querySelector(".shield"), "pointerup", 300, 800); await settle();
  const cd = r.querySelector(".card");
  check("phone: a tap picks the area and the comment box docks across the top, clear of it", !r.querySelector(".box").hidden && cd.classList.contains("dock") && cd.style.top === "12px");
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
