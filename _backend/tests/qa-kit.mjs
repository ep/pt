// Tests for the shared kits in assets/kit/: the feedback kit (feedback.js and
// feedback-ui.js) and the Email this kit (send.js). Runs in a simulated browser
// with jsdom; no network, no packages beyond jsdom.
//   node _backend/tests/qa-kit.mjs
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KIT = path.resolve(here, "../../assets/kit");
const src = (f) => fs.readFileSync(path.join(KIT, f), "utf8");
const ADDRESS = ["armand.khambatta", "experiencepoint.com"].join("@");

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail !== undefined ? " :: " + String(detail).slice(0, 300) : "")); }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function settle(n = 6) { for (let i = 0; i < n; i++) await tick(0); }

const PAGE = `<!doctype html><html><head><title>Test Tool</title></head><body>
  <main id="stage"><h1>Pick a pair</h1>
    <label for="nm">Your answer</label><input id="nm" type="text">
    <input type="password" id="pw">
    <button id="start" aria-label="Start the round">Go</button>
    <div class="join-link">ABCD secret link</div>
  </main>
  <footer id="bottom"><button id="nextBtn" class="btn primary">Next</button></footer>
</body></html>`;

function makePage(url, opts = {}) {
  const dom = new JSDOM(opts.html || PAGE, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  w.URL.createObjectURL = () => "blob:fake";
  w.URL.revokeObjectURL = () => {};
  w.downloads = [];
  w.opened = [];
  w.HTMLAnchorElement.prototype.click = function () { w.downloads.push({ href: this.href, download: this.download }); };
  w.open = (u, t, f) => { w.opened.push({ u, t, f }); return null; };
  if (opts.coarse) w.matchMedia = (q) => ({ matches: /pointer: coarse/.test(q), addEventListener() {}, removeEventListener() {} });
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
async function bytesOfBlob(w, blob) {
  return await new Promise((res) => { const r = new w.FileReader(); r.onload = () => res(Buffer.from(new Uint8Array(r.result))); r.readAsArrayBuffer(blob); });
}

/* =================== static checks on the kit files =================== */
{
  const files = ["feedback.js", "feedback-ui.js", "send.js"];
  for (const f of files) {
    const s = src(f);
    check(`${f}: plain ASCII, so it reads the same under any page encoding`, /^[\x09\x0a\x0d\x20-\x7e]*$/.test(s), (s.match(/[^\x09\x0a\x0d\x20-\x7e]/) || [])[0]);
    check(`${f}: no em or en dashes`, !/[\u2013\u2014]|\\u201[34]/.test(s));
    check(`${f}: never writes HTML from strings (no innerHTML)`, !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(s));
    check(`${f}: sends nothing anywhere (no fetch, beacon, socket or XHR)`, !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(s));
    check(`${f}: no eval or new Function`, !/\beval\s*\(|new Function/.test(s));
    const hosts = (s.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.replace(/^https?:\/\//, "").toLowerCase());
    check(`${f}: only links to EP's pt and the two email sites`, hosts.every((h) => ["ep.github.io", "mail.google.com", "outlook.office.com"].includes(h)), hosts.join(","));
  }
  const ui = src("feedback-ui.js");
  check("the feedback address is not written out whole in the public file", !ui.includes(ADDRESS) && !src("feedback.js").includes(ADDRESS));
  const boot = src("feedback.js").replace(/\/\*[\s\S]*?\*\//, "");
  check("feedback.js stays small for everyone (code under 6 KB)", boot.length < 6144, boot.length);
}

/* =================== dormant: no ?feedback =================== */
{
  const w = makePage("https://ep.github.io/pt/field-tools/test-tool/?join=ABCD");
  const scriptsBefore = w.document.querySelectorAll("script").length;
  runKit(w, "feedback.js");
  check("dormant: feedback is off without ?feedback", w.EPKit.feedback.on === false);
  check("dormant: nothing else is loaded", w.document.querySelectorAll("script").length === scriptsBefore);
  check("dormant: no dot or panel", !w.document.querySelector("[data-epkit]"));
  check("dormant: the tab flag is untouched", w.sessionStorage.getItem("ep-feedback") === null);
  w.document.getElementById("start").click();
  check("dormant: clicks are not recorded", w.EPKit.feedback.actions.length === 0);
  const ce = w.console.error;
  runKit(w, "feedback.js");
  check("dormant: loading twice is harmless", w.console.error === ce && w.EPKit.feedback.on === false);
}

/* =================== the flag: on, remembered, off =================== */
{
  const w = makePage("https://ep.github.io/pt/field-tools/test-tool/?x=1&feedback");
  runKit(w, "feedback.js");
  const added = Array.from(w.document.querySelectorAll("script[data-epkit]")).map((s) => s.src);
  check("?feedback turns it on", w.EPKit.feedback.on === true);
  check("?feedback loads the panel and the send kit from beside itself", added.length === 2 && added.some((u) => /^https:\/\/ep\.github\.io\/pt\/assets\/kit\/feedback-ui\.js\?v=/.test(u)) && added.some((u) => /\/assets\/kit\/send\.js\?v=/.test(u)), added.join(" "));
  check("?feedback is remembered for this tab", w.sessionStorage.getItem("ep-feedback") === "1");
  w.history.replaceState(null, "", "/pt/field-tools/test-tool/?host=ABCD&k=KEY123");
  delete w.EPKit.feedback;
  runKit(w, "feedback.js");
  check("it survives a tool rewriting its own address", w.EPKit.feedback.on === true);
  w.history.replaceState(null, "", "/pt/field-tools/test-tool/?feedback=off");
  delete w.EPKit.feedback;
  runKit(w, "feedback.js");
  check("?feedback=off turns it off and forgets it", w.EPKit.feedback.on === false && w.sessionStorage.getItem("ep-feedback") === null);
  check("scrub removes keys and codes from any text", w.EPKit.scrub("x?host=ABCD&k=SECRET&me=7 y") === "x?host=[removed]&k=[removed]&me=[removed] y");
}

/* =================== the panel, end to end =================== */
const URL1 = "https://ep.github.io/pt/field-tools/test-tool/?host=ABCD&k=SECRETKEY99&feedback#tok=abc";
const w = makePage(URL1);
w.EPKit = { tool: { id: "test-tool", name: "Test Tool", version: "v9", screen: () => w.currentScreen, state: () => ({ mode: "team", place: "virtual", link: "https://x/?k=SECRETKEY99" }), private: ".join-link" } };
w.currentScreen = "cover";
const pageKeys = [];
w.document.addEventListener("keydown", (e) => pageKeys.push(e.key));
runKit(w, "feedback.js");
// Things testers do before opening the panel
w.document.getElementById("start").click();
const nm = w.document.getElementById("nm"); nm.value = "my secret answer"; nm.dispatchEvent(new w.Event("change", { bubbles: true }));
press(w, w.document.body, "ArrowRight");
press(w, nm, "Backspace");
w.currentScreen = "ladder";
w.dispatchEvent(new w.ErrorEvent("error", { message: "boom at ?k=SECRETKEY99", filename: "https://ep.github.io/pt/x/app.js", lineno: 12 }));
runKit(w, "send.js");
runKit(w, "feedback-ui.js");
const FB = w.EPKit.feedback, UI = FB.ui;
const root = fbRoot(w), hostEl = w.document.querySelector('[data-epkit="feedback"]');
check("panel: one host, masked from Clarity", !!root && hostEl.getAttribute("data-clarity-mask") === "true");
const dot = root.querySelector(".dot");
check("panel: the dot is a labelled button", !!dot && dot.tagName === "BUTTON" && dot.getAttribute("aria-label") === "Add a feedback note");
check("panel: the dot sits bottom left by default", dot.classList.contains("bl"));
check("panel: nothing else shows until the dot is tapped", root.querySelector(".card").hidden && root.querySelector(".mark").hidden);
check("actions: a click is recorded by its label", FB.actions.some((a) => a.what === 'clicked button "Start the round"' && a.screen === "cover"), JSON.stringify(FB.actions));
check("actions: a typed field is recorded by its name, never its words", FB.actions.some((a) => a.what === "edited Your answer") && !JSON.stringify(FB.actions).includes("secret answer"));
check("actions: named keys are recorded, editing keys inside fields are not", FB.actions.some((a) => a.what === "pressed ArrowRight") && !FB.actions.some((a) => /Backspace/.test(a.what)));
check("errors: page errors are kept, with keys removed", FB.errors.length === 1 && /boom/.test(FB.errors[0].what) && /app\.js:12/.test(FB.errors[0].what) && !FB.errors[0].what.includes("SECRETKEY99"));

dot.click();
await settle();
let card = root.querySelector(".card");
check("first tap: a short intro explains feedback mode", !card.hidden && /Feedback mode is on/.test(card.textContent));
check("first tap: browsers without tab pictures say notes only", /Pictures of the screen work in Chrome and Edge/.test(card.textContent) && !byText(card, "button", /Share this tab/));
byText(card, "button", /Got it/).click();
await settle();
check("point: a small bar asks what the note is about, with Skip", card.classList.contains("bar") && /Click what this note is about\./.test(card.textContent) && !!byText(card, "button", /^Skip$/) && !card.querySelector("textarea"));
check("point: the screen dims for pointing", !root.querySelector(".mark").hidden);
check("point: the bar sits beside the dot", card.style.left === "16px", card.style.left);
pageKeys.length = 0;
press(w, root.querySelector(".card button"), "ArrowRight");
check("point: keys never reach the tool while pointing", pageKeys.length === 0, pageKeys.join(","));

// Spotlight: tap, drag, resize, second, third replaces the last
w.document.elementsFromPoint = (x, y) => [w.document.getElementById("nextBtn"), w.document.body, w.document.documentElement];
const mark = root.querySelector(".mark");
pointer(w, mark, "pointerdown", 100, 700); pointer(w, mark, "pointermove", 120, 690); pointer(w, mark, "pointerup", 120, 690);
await settle();
card = root.querySelector(".card");
let ta = card.querySelector("textarea");
let save = byText(card, "button", /Save note/);
check("spotlight: a tap places one, dragging moves it", UI.state.spots.length === 1 && UI.state.spots[0].x === 120 && UI.state.spots[0].y === 690);
check("spotlight: lifting the finger opens the note", !card.classList.contains("bar") && !!ta && save.disabled && root.activeElement === ta);
check("spotlight: it is drawn with a number, a resize handle and a remove button", mark.querySelectorAll(".ring").length === 1 && !!mark.querySelector(".ring .rs") && !!mark.querySelector(".ring .rm"));
check("spotlight: the note card sits clear of it", card.style.left === (1024 - 388 - 16) + "px", card.style.left);
check("note: storage warning shows when the browser can't keep notes", /stay only while this tab is open/.test(card.textContent));
pageKeys.length = 0;
press(w, ta, "ArrowRight"); press(w, ta, " ");
check("note: keys typed in the panel never reach the tool", pageKeys.length === 0, pageKeys.join(","));
const r0 = UI.state.spots[0].r;
pointer(w, mark, "pointerdown", 120 + r0, 690); pointer(w, mark, "pointermove", 120 + r0 + 30, 690); pointer(w, mark, "pointerup", 120 + r0 + 30, 690);
check("spotlight: pulling the edge resizes it", Math.round(UI.state.spots[0].r) === r0 + 30 && UI.state.spots.length === 1, UI.state.spots[0].r);
pointer(w, mark, "pointerdown", 600, 200); pointer(w, mark, "pointerup", 600, 200);
pointer(w, mark, "pointerdown", 800, 300); pointer(w, mark, "pointerup", 800, 300);
check("spotlight: two at most; a third tap moves the second", UI.state.spots.length === 2 && UI.state.spots[1].x === 800);
mark.querySelectorAll(".ring .rm")[1].click();
check("spotlight: the remove button removes it", UI.state.spots.length === 1);
check("spotlight: the hint explains what to do next", /Drag to move it/.test(card.querySelector(".hint").textContent));
check("spotlight: typing survives moving the spotlight", root.querySelector("textarea") === ta);

const NOTE1 = 'The Next button <img src=x onerror="window.pwned=1"> feels \u201cslow\u201d \u2014 caf\u00e9 \u2728\ufe0f';
ta.value = NOTE1; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
check("note: Save turns on once there are words", !save.disabled);
save.click();
await settle(10);
check("save: the card closes and the dot says Saved", root.querySelector(".card").hidden && /Saved/.test(root.querySelector(".said").textContent));
let notes = await UI.store.all();
const n1 = notes[0];
check("save: one note kept for this tool", notes.length === 1 && n1.tool === "test-tool");
check("save: the tester's words are kept exactly", n1.text === NOTE1.trim());
check("save: the spotlight records the element under it", n1.spots.length === 1 && n1.spots[0].el.path === "footer#bottom > button#nextBtn" && n1.spots[0].el.text === "Next", JSON.stringify(n1.spots));
check("context: screen, heading slot, settings, tool and version", n1.ctx.screen === "ladder" && n1.ctx.tool === "test-tool" && n1.ctx.version === "v9" && n1.ctx.settings.mode === "team");
check("context: keys and codes are removed from the address", n1.ctx.page === "https://ep.github.io/pt/field-tools/test-tool/?host=[removed]&k=[removed]&feedback#[removed]", n1.ctx.page);
check("context: settings are scrubbed too", n1.ctx.settings.link.includes("k=[removed]"));
check("context: device details", /\u00d7/.test(n1.ctx.device.window) && n1.ctx.device.input === "mouse or trackpad");
check("context: nothing secret anywhere in the saved note", !JSON.stringify(n1).includes("SECRETKEY99") && !JSON.stringify(n1).includes("secret answer") && !JSON.stringify(n1).includes("tok=abc"));
check("save: no picture in browsers that can't take one", n1.shot === null && !n1.thumb);

// Escape keeps a draft, Cancel drops it
async function skip() { await settle(); byText(root.querySelector(".card"), "button", /^Skip$/).click(); await settle(); }
dot.click(); await settle();
card = root.querySelector(".card");
check("second tap: straight to pointing, no intro", card.classList.contains("bar") && !/Feedback mode is on/.test(card.textContent));
press(w, card.querySelector("button"), "Escape");
check("Escape while pointing cancels", root.querySelector(".card").hidden && UI.state.draft === null);
dot.click(); await skip();
card = root.querySelector(".card"); ta = card.querySelector("textarea");
check("Skip goes straight to the note, with no spotlight", !!ta && UI.state.spots.length === 0 && /Optional: click the screen/.test(card.querySelector(".hint").textContent));
ta.value = "half a thought"; press(w, ta, "Escape");
check("Escape closes the panel", root.querySelector(".card").hidden);
dot.click(); await skip();
card = root.querySelector(".card"); ta = card.querySelector("textarea");
check("Escape keeps the unfinished words for next time", ta.value === "half a thought");
byText(card, "button", /^Cancel$/).click();
dot.click(); await skip();
card = root.querySelector(".card"); ta = card.querySelector("textarea");
check("Cancel throws the unfinished words away", ta.value === "");
ta.value = "Second note, about the ladder.\nIt wraps."; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
press(w, ta, "Enter", { ctrlKey: true });
await settle(10);
notes = await UI.store.all();
check("Ctrl+Enter saves", notes.length === 2 && notes[1].text === "Second note, about the ladder.\nIt wraps.");

// The list, editing and deleting
dot.click(); await skip();
byText(root.querySelector(".card"), "button", /Your notes/).click(); await settle();
card = root.querySelector(".card");
const items = card.querySelectorAll(".item");
check("list: every note, newest first", items.length === 2 && /Second note/.test(items[0].textContent) && /On ladder/.test(items[0].textContent));
check("list: typed text is shown as text, never run as HTML", !root.querySelector(".item img") && w.pwned === undefined && /<img src=x/.test(items[1].textContent));
check("list: Send names the count", !!byText(card, "button", /^Send 2 notes$/));
items[0].click(); await settle();
card = root.querySelector(".card"); ta = card.querySelector("textarea");
check("edit: opens the note's words", /Edit note/.test(card.textContent) && ta.value.startsWith("Second note"));
ta.value = "Second note, edited."; byText(card, "button", /Save changes/).click(); await settle(10);
notes = await UI.store.all();
check("edit: Save changes keeps the new words", notes[1].text === "Second note, edited." && notes[1].updated >= notes[1].created);
card = root.querySelector(".card");
card.querySelectorAll(".item")[0].click(); await settle();
card = root.querySelector(".card");
const del = byText(card, "button", /^Delete$/);
del.click(); await settle();
check("delete: asks for a second tap", (await UI.store.all()).length === 2 && /Tap again/.test(del.textContent));
del.click(); await settle(10);
notes = await UI.store.all();
check("delete: the second tap deletes", notes.length === 1);
UI.close();

// Card placement: away from a spotlight in the dot's corner
dot.click(); await settle();
pointer(w, root.querySelector(".mark"), "pointerdown", 900, 120); pointer(w, root.querySelector(".mark"), "pointerup", 900, 120);
await settle(); card = root.querySelector(".card");
check("placement: with nothing in the way the card sits by the dot", card.style.left === "16px" && !!card.querySelector("textarea"), card.style.left);
UI.close();

/* =================== the PDF =================== */
{
  const fakeJpeg = new w.Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const pic = JSON.parse(JSON.stringify(notes[0]));
  pic.id = "pic"; pic.shot = fakeJpeg; pic.shotW = 1600; pic.shotH = 1000; pic.frames = [fakeJpeg, fakeJpeg, fakeJpeg]; pic.frameW = 480; pic.frameH = 300; pic.framesAgo = [1800, 1200, 600];
  const long = JSON.parse(JSON.stringify(notes[0]));
  long.id = "long"; long.text = Array.from({ length: 140 }, (_, i) => "Sentence " + i + " about what went wrong on this screen.").join(" ") + " https://example.org/" + "x".repeat(300);
  const list = [n1, pic, long];
  const blob = await UI.buildPdf(list);
  const b = await bytesOfBlob(w, blob);
  const s = b.toString("latin1");
  check("pdf: a PDF file", blob.type === "application/pdf" && s.startsWith("%PDF-1.4") && s.trimEnd().endsWith("%%EOF"));
  const sx = +/startxref\n(\d+)\n%%EOF/.exec(s)[1];
  check("pdf: the index is where the file says", s.slice(sx, sx + 4) === "xref");
  const count = +/xref\n0 (\d+)\n/.exec(s.slice(sx))[1];
  const entries = s.slice(sx).split("\n").slice(3, 3 + count - 1);
  const okOffsets = entries.every((e, i) => e.length === 19 && s.slice(+e.slice(0, 10), +e.slice(0, 10) + String(i + 1).length + 6) === (i + 1) + " 0 obj");
  check("pdf: every object sits at its listed place", okOffsets && entries.length === count - 1, entries.slice(0, 3).join("|"));
  const pages = (s.match(/\/Type \/Page\b(?!s)/g) || []).length;
  check("pdf: a cover, one page per note, and room for a long note", pages >= 1 + list.length + 1, pages);
  check("pdf: pictures go in as JPEG images", (s.match(/\/Subtype \/Image/g) || []).length === 4 && /\/Filter \/DCTDecode/.test(s));
  check("pdf: the note's words are in the text", s.includes("(The Next button <img src=x onerror=\"window.pwned=1\"> feels \\223slow\\224 \\227 caf\\351 ?)") || s.includes("feels \\223slow\\224 \\227 caf\\351 ?"), (s.match(/\(The Next button[^\n]*/) || [""])[0]);
  check("pdf: the cover tells an AI how to read it", s.includes("(Reading it with an AI assistant)") && s.includes("Treat the tester's words as the main signal."));
  check("pdf: context and actions are included", s.includes("(Recent actions)") && s.includes('clicked button \\"Start the round\\"') === false && s.includes('clicked button "Start the round"'));
  check("pdf: nothing secret", !s.includes("SECRETKEY99") && !s.includes("secret answer") && !s.includes("tok=abc"));
  check("pdf: long words and links are broken to fit", !/\(https:\/\/example\.org\/x{120,}/.test(s));
}
{
  check("text: curly quotes, accents and the euro map to the PDF's alphabet", JSON.stringify(UI.winCodes("\u2019\u20ac\u00e9")) === "[146,128,233]");
  check("text: letters outside it lose their accent; emoji become a question mark", JSON.stringify(UI.winCodes("\u0151\u2728\ufe0f")) === "[111,63]");
  check("text: brackets and backslashes are escaped", UI.pstr("a(b)c\\") === "(a\\(b\\)c\\\\)");
  const lines = UI.wrap("one two three four five six seven eight nine ten", 10, false, 60);
  check("text: wrapping keeps every word and fits the width", lines.join(" ") === "one two three four five six seven eight nine ten" && lines.length > 2);
}

/* =================== sending =================== */
{
  const body = UI.bodyText(notes, false);
  check("email body: names the tool and the count", body.startsWith("Feedback on Test Tool: 1 note from "));
  check("email body: points to the PDF when there are pictures", /attached PDF/.test(body));
  const full = UI.bodyText(notes, true);
  check("email body for phones: every detail in the text", /Device: /.test(full) && /Recent actions: /.test(full) && /Tapped 1: button "Next"/.test(full) && /Page: https:\/\/ep\.github\.io\/pt\/field-tools\/test-tool\/\?host=\[removed\]/.test(full), full.slice(0, 400));
  check("the feedback address is put together correctly", UI.to() === ADDRESS);

  UI.send(); await settle(20);
  const sr = sendRoot(w);
  check("send: opens the email sheet", !!sr && /Send your notes/.test(sr.textContent));
  check("send: shows who it goes to, with a Copy address button", sr.querySelector(".to").textContent.replace(/\u200b/g, "").includes(ADDRESS) && !!byText(sr, "button", /Copy address/));
  check("send: names the PDF it will attach", /feedback-test-tool-\d{4}-\d\d-\d\d\.pdf/.test(sr.querySelector(".file").textContent));
  check("send: Gmail, Outlook and the email app on a computer", ["gmail", "outlook", "mailto"].every((r) => sr.querySelector(`[data-route="${r}"]`)));
  w.downloads.length = 0; w.opened.length = 0;
  sr.querySelector('[data-route="gmail"]').click(); await settle();
  const g = w.opened[0] && w.opened[0].u;
  check("send: Gmail opens a new tab with everything filled in", !!g && g.startsWith("https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(ADDRESS) + "&su=" + encodeURIComponent("Feedback on Test Tool (1 note)")) && w.opened[0].f === "noopener", g);
  check("send: the PDF downloads so it can be attached", w.downloads.length === 1 && /\.pdf$/.test(w.downloads[0].download));
  check("send: then asks whether it was sent", /Sent it\?/.test(sr.textContent) && /Attach feedback-test-tool/.test(sr.textContent));
  byText(sr, "button", /Yes, it's sent/).click(); await settle(10);
  check("send: yes clears the sent notes", (await UI.store.all()).length === 0 && !sendRoot(w));
}

/* =================== turning it off =================== */
{
  UI.list(); await settle();
  byText(fbRoot(w).querySelector(".card"), "button", /Turn off feedback/).click(); await settle();
  check("turn off: the dot goes and the tab forgets", !w.document.querySelector('[data-epkit="feedback"]') && w.sessionStorage.getItem("ep-feedback") === null && FB.on === false);
  const before = FB.actions.length;
  w.document.getElementById("start").click();
  check("turn off: nothing more is recorded", FB.actions.length === before);
}

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
{
  // Feedback on a phone: bigger dot, tap the element
  const p = makePage("https://ep.github.io/pt/field-tools/test-tool/?feedback", { coarse: true });
  p.EPKit = { tool: { id: "test-tool", dot: "bottom-center" } };
  runKit(p, "feedback.js"); runKit(p, "send.js"); runKit(p, "feedback-ui.js");
  const r = fbRoot(p), d = r.querySelector(".dot");
  check("phone: a bigger tap target, placed where the tool asks", d.classList.contains("c") && d.classList.contains("bc"));
  d.click(); await settle();
  check("phone: the intro says what gets recorded", /records the screen you were on and your device/.test(r.querySelector(".card").textContent) && !/Chrome and Edge/.test(r.querySelector(".card").textContent));
  byText(r.querySelector(".card"), "button", /Got it/).click(); await settle();
  check("phone: the pointing bar says tap", /Tap what this note is about/.test(r.querySelector(".card").textContent));
  byText(r.querySelector(".card"), "button", /^Skip$/).click(); await settle();
  check("phone: the dictation tip points to the keyboard mic", /Tap the mic on your keyboard/.test(r.querySelector(".card").textContent));
  check("phone: the hint says tap", /tap the screen/.test(r.querySelector(".card .hint").textContent));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
