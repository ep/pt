// Tests for feedback/index.html (the feedback board) in a simulated browser with
// jsdom. The board talks to the real worker code (pt-worker.js) with the shared fake
// database, and to a fake GitHub for the tool's history.
//   node _backend/tests/qa-feedback-board.mjs
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { TextEncoder, TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import worker from "../pt-worker.js";
import { FakeDB } from "./fake-db.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, "../../feedback/index.html");
const HTML = fs.readFileSync(FILE, "utf8");
const API = "https://pt.armand-khambatta.workers.dev";
const TEAM = "team-key-for-board-tests-0123";
const env = { DB: FakeDB(), FEEDBACK_KEY: TEAM };

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail !== undefined ? " :: " + String(detail).slice(0, 300) : "")); }
}
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 3000) { const t0 = Date.now(); for (;;) { let v; try { v = fn(); } catch (e) { v = false; } if (v) return v; if (Date.now() - t0 > ms) return false; await tick(15); } }
async function call(method, p, body, headers) {
  const req = new Request(API + p, { method, headers: Object.assign({ "Content-Type": "application/json", Origin: "https://ep.github.io" }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const res = await worker.fetch(req, env); return { status: res.status, data: await res.json() };
}
const team = (m, p, b) => call(m, p, b, { "X-Team-Key": TEAM });
const list = async () => (await team("GET", "/api/fb/list?tool=reimagination-lab")).data;

/* ---- the page itself ---- */
const SCRIPT = HTML.slice(HTML.indexOf("<script>") + 8, HTML.lastIndexOf("</script>"));
{
  check("page: noindex", /<meta name="robots" content="noindex, nofollow">/.test(HTML));
  check("page: no analytics", !/clarity|gtag\(|googletagmanager/i.test(HTML));
  check("page: no em or en dashes", !/[\u2013\u2014]/.test(HTML));
  check("page: never writes HTML from strings", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(SCRIPT));
  check("page: the rebuilt screen never shares the board's origin", /setAttribute\("sandbox", "allow-scripts"\)/.test(SCRIPT) && !/allow-same-origin/.test(HTML));
  check("page: the team key travels only in a header, never in an address", /"X-Team-Key": S\.key/.test(SCRIPT) && !/[?&]key=/.test(SCRIPT));
  check("page: no dropdowns to find your way around", !/<select/i.test(HTML) && !/createElement\("select"\)|el\("select"/.test(SCRIPT));
  const hosts = [...new Set((HTML.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.replace(/^https?:\/\//, "").toLowerCase()))];
  check("page: talks only to EP's worker, GitHub and Google Fonts", hosts.every((h) => ["fonts.googleapis.com", "pt.armand-khambatta.workers.dev", "api.github.com", "raw.githubusercontent.com", "ep.github.io", "www.w3.org"].includes(h)), hosts.join(","));
}

/* ---- two versions of the tool, fingerprinted the way Git and the kit do it ---- */
const TOOL_HTML_LIVE = "<!doctype html><html><head><title>Lab</title></head><body><p>live version</p></body></html>";
const TOOL_HTML_OLD = "<!doctype html><html><head><title>Lab</title></head><body><p>old version</p></body></html>";
const blob = (s) => { const b = Buffer.from(s, "utf8"); return crypto.createHash("sha1").update("blob " + b.length + "\0").update(b).digest("hex"); };
const LIVE = "git:" + blob(TOOL_HTML_LIVE), OLD = "git:" + blob(TOOL_HTML_OLD);

/* ---- comments from testers, posted through the real worker ---- */
const CODE = (await team("POST", "/api/fb/code", {})).data.code;
const PAGE = "https://ep.github.io/pt/field-tools/reimagination-lab/?host=[removed]&feedback";
function comment(o) {
  return Object.assign({ name: "Ana", text: "Words", ver: LIVE, screen: "b-share",
    where: { x: 796, y: 696, w: 168, h: 72, vw: 1280, vh: 800, xp: 62.2, yp: 87, wp: 13.1, hp: 9, area: false, el: { tag: "button", role: "", text: "Next", path: "footer#bottom > button#nextBtn" } },
    ctx: { name: "Reimagination Lab", page: PAGE, heading: "Write your eye-rollers", settings: { mode: "team", place: "virtual" }, device: { browser: "Chrome 141", os: "macOS", input: "mouse or trackpad" }, actions: [{ t: "10:41:58", what: 'clicked button "Next"', screen: "b-think" }], errors: [] } }, o);
}
let codeNow = CODE;
async function post(id, o, tool) { return call("POST", "/api/fb/post", { tool: tool || "reimagination-lab", code: codeNow, id, edit: "E".repeat(20) + id.slice(0, 4), comment: comment(o) }, { "CF-Connecting-IP": "1.2.3.4" }); }
const ctx = (o) => Object.assign(comment({}).ctx, o);
await post("c1aaaaaaaa", { text: "Next jumps when the timer appears." }); await tick(3);
await post("c2bbbbbbbb", { name: "Sam", text: "The Next button moves when I start the timer." }); await tick(3);
await post("c3cccccccc", { name: 'Lee <img src=x onerror="window.pwned=1">', text: 'The ladder <img src=x onerror="window.pwned=1"> is confusing.', screen: "ladder", ver: OLD,
  where: { x: 100, y: 200, w: 300, h: 100, vw: 1280, vh: 800, xp: 7.8, yp: 25, wp: 23.4, hp: 12.5, area: true, el: { tag: "div", text: "", path: "main#stage > section.scene" } },
  ctx: ctx({ heading: "Build the ladder together." }) }); await tick(3);
await post("c4dddddddd", { name: "Kim", text: "Too small on my phone.", screen: "ladder", where: { x: 10, y: 600, w: 200, h: 60, vw: 390, vh: 844, xp: 2.6, yp: 71.1, wp: 51.3, hp: 7.1, area: false, el: { tag: "textarea", text: "the field We do this in order to", path: "textarea.big" } }, ctx: ctx({ heading: "Build the ladder together." }) }); await tick(3);
await post("c5eeeeeeee", { text: "The welcome takes too long to read.", screen: "who", ctx: ctx({ heading: "Who's here?" }) }); await tick(3);
await post("c6ffffffff", { name: "Kim", text: "Cover music is loud.", screen: "cover", ver: OLD, ctx: ctx({ heading: "Reimagination Lab" }) }); await tick(3);
await post("c7gggggggg", { name: "Sam", text: "The drawing step needs a timer.", screen: "draw-old", ver: OLD, ctx: ctx({ heading: "Draw it", section: "3. Draw it" }) });
/* reviews saved by the first board, before Ignore and still open existed */
const put = (id, v) => env.DB.prepare("INSERT INTO kv (room, path, value, updated) VALUES (?,?,?,?) ON CONFLICT(room, path) DO UPDATE SET value = excluded.value, updated = excluded.updated").bind("fb:reimagination-lab", "r/" + id, JSON.stringify(v), Date.now()).run();
await put("c2bbbbbbbb", { priority: "must", same: "c1aaaaaaaa", notes: [], by: "Old board", at: Date.now() });
await put("c6ffffffff", { priority: "wont", same: "", notes: [], by: "Old board", at: Date.now() });

/* ---- the board in a simulated browser ---- */
const SECTIONS = [{ name: "Set up", screens: ["cover", "who"] }, { name: "1. Better way", screens: ["c1", "spin", "b-think", "b-share"] }, { name: "2. Why it exists", screens: ["c2", "ladder"] }, { name: "3. Draw it", screens: ["c3", "make"] }];
const dom = new JSDOM(HTML, { url: "https://ep.github.io/pt/feedback/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
Object.defineProperty(w, "crypto", { configurable: true, value: crypto.webcrypto });
w.TextEncoder = TextEncoder; w.TextDecoder = TextDecoder;
Object.defineProperty(w, "innerWidth", { configurable: true, writable: true, value: 1440 });
w.requests = [];
let copied = null;
Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
w.fetch = async (u, o = {}) => {
  u = String(u); w.requests.push({ u, o });
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => (typeof data === "string" ? data : JSON.stringify(data)), arrayBuffer: async () => { const b = Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8"); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); } });
  if (u.indexOf(API) === 0) {
    const req = new Request(u, { method: o.method || "GET", headers: Object.assign({ Origin: "https://ep.github.io" }, o.headers || {}), body: o.body });
    const res = await worker.fetch(req, env); const text = await res.text();
    return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
  }
  if (u.indexOf("https://api.github.com/repos/ep/pt/commits?path=field-tools%2Freimagination-lab%2Findex.html") === 0)
    return ok([{ sha: "c2sha00", commit: { message: "Reimagination Lab v4", author: { date: "2026-10-27T14:00:00Z" } } }, { sha: "c1sha00", commit: { message: "Reimagination Lab", author: { date: "2026-10-26T14:00:00Z" } } }]);
  if (u === "https://api.github.com/repos/ep/pt/contents/field-tools/reimagination-lab/index.html?ref=c2sha00") return ok({ sha: LIVE.slice(4) });
  if (u === "https://api.github.com/repos/ep/pt/contents/field-tools/reimagination-lab/index.html?ref=c1sha00") return ok({ sha: OLD.slice(4) });
  if (u === "/pt/field-tools/reimagination-lab/index.html") return ok(TOOL_HTML_LIVE);
  if (u === "https://raw.githubusercontent.com/ep/pt/c1sha00/field-tools/reimagination-lab/index.html") return ok(TOOL_HTML_OLD);
  return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
};
w.eval(SCRIPT);
const $ = (s) => w.document.querySelector(s), $$ = (s) => Array.from(w.document.querySelectorAll(s));
const B = w.EPBoard;
const press = (key) => w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key, bubbles: true }));
const rowsText = () => $$(".crow .txt").map((r) => r.textContent);
const heads = () => $$(".grp h2").map((h) => h.firstChild.textContent + "|" + h.querySelector(".n").textContent);
const row = (id) => $('.crow[data-id="' + id + '"]');
function submitGate(key, name) { $("#keyIn").value = key; $("#nameIn").value = name; $("#gateForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }

check("sign in: the board asks for the team key and a name first", !$("#gate").hidden && $("#board").hidden && $("#gate h1").textContent === "Feedback board");
submitGate("not-the-key", "Rowan");
await until(() => !$("#gateErr").hidden);
check("sign in: a wrong key says so plainly", $("#gateErr").textContent === "That key doesn't match. Check it and try again." && $("#board").hidden);
submitGate(TEAM, "Rowan");
await until(() => !$("#board").hidden && B.S.live && $$(".crow").length > 0);
check("sign in: the right key opens the board and is remembered here", !$("#board").hidden && w.localStorage.getItem("ep-board-key") === TEAM && w.localStorage.getItem("ep-board-name") === "Rowan");
check("the tool's name is the page heading, and one tool needs no switcher", $("#toolName").textContent === "Reimagination Lab" && $("#toolsBtn").hidden);
check("versions: the live version is the fingerprint of the file the board just fetched", B.S.live === LIVE);

/* ---- the overview, before the tool has named its parts ---- */
check("overview: until the tool names its parts, comments group by screen", heads().join() === "Write your eye-rollers|2,Build the ladder together|1,Who's here|1", heads().join());
const mf = B.mapFrame();
check("sections: the live tool opens out of sight, only to name its parts", mf && mf.getAttribute("sandbox") === "allow-scripts" && /window\.EPKitReplay=\{"map":true\}/.test(mf.getAttribute("srcdoc") || "") && /live version/.test(mf.getAttribute("srcdoc") || "") && $("#mapHost").contains(mf));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-map", sections: [{ name: "Bogus", screens: ["b-share"] }] } }));
check("sections: a message from anywhere else is ignored", B.S.map === null || B.S.map === undefined);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-map", sections: SECTIONS }, source: mf.contentWindow }));
await until(() => B.S.map);
check("sections: the frame closes once it has answered", !B.mapFrame() && !$("#mapHost iframe"));
check("sections: remembered here for next time", /"1\. Better way"/.test(w.localStorage.getItem("ep-board-map") || ""));

/* ---- the overview: the forest first ---- */
check("overview: grouped by the tool's own parts, in the tool's order, with counts", heads().join() === "Set up|1,1. Better way|2,2. Why it exists|1", heads().join());
check("overview: every comment on one page, in the order of the tool", rowsText().join(" / ") === "The welcome takes too long to read. / Next jumps when the timer appears. / The Next button moves when I start the timer. / Too small on my phone.", rowsText().join(" / "));
check("overview: each comment is its own card, in a list per part", $$(".grp .rows > li > .crow").length === 4 && !$("#list").classList.contains("sheet") && /\.rows\{[^}]*gap:8px/.test(HTML));
check("overview: a one-line summary of who said how much", $("#summary").textContent === "4 comments from 3 testers.", $("#summary").textContent);
check("overview: the weight shows as a word at the end of the card, and colours its edge", row("c2bbbbbbbb").querySelector(".meta .wt.must").textContent === "Must" && row("c2bbbbbbbb").classList.contains("must") && row("c2bbbbbbbb").querySelector(".meta").lastChild.classList.contains("wt") && !row("c1aaaaaaaa").querySelector(".wt"));
check("overview: an old \"same as\" is simply dropped", !/same as/i.test($("#list").textContent));
check("overview: each card says where, who and when", /^Write your eye-rollers, Sam, \d+ \w+ \d\d:\d\d$/.test(row("c2bbbbbbbb").querySelector(".meta .m").textContent), row("c2bbbbbbbb").querySelector(".meta .m").textContent);
check("overview: earlier versions sit in their own tab, with counts", !$("#tabs").hidden && $("#tabLive").textContent === "Live version4" && $("#tabEarlier").textContent === "Earlier versions3" && $("#tabLive").getAttribute("aria-selected") === "true");
check("overview: nothing is open yet, so the list has the whole width", $("#detail").hidden && !$("#main").classList.contains("split"));

/* ---- one comment at a time ---- */
row("c1aaaaaaaa").click(); await tick(5);
check("detail: a click opens the comment beside the list", !$("#detail").hidden && $("#main").classList.contains("split") && row("c1aaaaaaaa").getAttribute("aria-current") === "true");
check("detail: where it sits in the list", $("#pos").textContent === "2 of 4" && !$("#prevBtn").disabled && !$("#nextBtn").disabled);
check("detail: the words, who, when and on what", $("#dWords").textContent === "Next jumps when the timer appears." && /^Ana, \d+ \w+ \d\d:\d\d, Chrome 141 on macOS$/.test($("#dMeta").textContent), $("#dMeta").textContent);
check("detail: the part of the tool and the screen", $("#dWhere").textContent === "1. Better way, Write your eye-rollers", $("#dWhere").textContent);
check("detail: one weight control, Must Should Could Ignore", $$("#dWeight button").map((b) => b.textContent).join() === "Must,Should,Could,Ignore" && $("#dWeight").getAttribute("aria-label") === "Weight");
check("detail: a comment on the live version has no version controls", $("#dEarlier").hidden && $("#dSwitch").hidden);
check("detail: on a wide screen the page doesn't lock", !w.document.body.classList.contains("lock"));
let F = B.frame();
check("rebuild: the frame is the tester's window size, sandboxed", F.iframe.getAttribute("width") === "1280" && F.iframe.getAttribute("height") === "800" && F.iframe.getAttribute("sandbox") === "allow-scripts");
await until(() => F.iframe.getAttribute("srcdoc"));
let sd = F.iframe.getAttribute("srcdoc") || "";
check("rebuild: the live code, told which screen and settings to open", /live version/.test(sd) && /window\.EPKitReplay=\{"screen":"b-share","settings":\{"mode":"team","place":"virtual"\}/.test(sd), sd.slice(0, 300));
check("rebuild: relative links resolve to the tool's own folder", /<base href="https:\/\/ep\.github\.io\/pt\/field-tools\/reimagination-lab\/">/.test(sd));
check("rebuild: says it is working on it", !F.load.hidden && /Rebuilding this screen/.test(F.load.textContent));
check("rebuild: the screen is told which comment to find, and the others made on that screen", /"focus":"c1aaaaaaaa","targets":\[\{"id":"c1aaaaaaaa"/.test(sd) && /"id":"c2bbbbbbbb"/.test(sd) && /"path":"footer#bottom > button#nextBtn"/.test(sd) && !/"id":"c4dddddddd"/.test(sd));
check("boxes: nothing is drawn until the rebuilt screen says where things are", $$(".cbox").length === 0);
const RECTS1 = { c1aaaaaaaa: { x: 600, y: 650, w: 120, h: 44 }, c2bbbbbbbb: { x: 600, y: 650, w: 120, h: 44 } };
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c1aaaaaaaa", rects: RECTS1, found: true } }));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-replay", ok: true, w: 1280, h: 800 } }));
check("rebuild: messages from anywhere else are ignored", !F.load.hidden && $$(".cbox").length === 0);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c1aaaaaaaa", rects: RECTS1, found: true }, source: F.iframe.contentWindow }));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-replay", ok: true, w: 1280, h: 800 }, source: F.iframe.contentWindow }));
check("rebuild: the frame's ready message clears the wait", F.load.hidden);
check("rebuild: the note says it is made-up content at that size", $("#dNote").textContent === "Rebuilt with made-up content at 1280 \u00d7 800.", $("#dNote").textContent);
let bx = $$(".cbox");
check("boxes: the box goes around the part where the rebuilt screen found it, not where it sat for the tester", bx.length === 2 && bx.filter((b) => b.classList.contains("sel")).length === 1 && $(".cbox.sel").style.left === "596px" && $(".cbox.sel").style.top === "646px" && $(".cbox.sel").style.width === "128px", $(".cbox.sel") && $(".cbox.sel").style.cssText);
$(".cbox:not(.sel)").click(); await tick(5);
check("boxes: clicking the other box opens that comment", B.S.sel === "c2bbbbbbbb" && $("#pos").textContent === "3 of 4");
check("detail: the same screen keeps its frame, and asks it again where things are", B.frame() === F && B.frame().focus === "c2bbbbbbbb" && B.frame().pending === true && $$(".cbox").length === 0);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c2bbbbbbbb", rects: RECTS1, found: true }, source: F.iframe.contentWindow }));
check("boxes: drawn again once the screen answers for this comment", $$(".cbox").length === 2 && $(".cbox.sel").getAttribute("data-id") === "c2bbbbbbbb" && $(".cbox.sel").style.left === "596px");
$("#nextBtn").click(); await tick(5);
check("next: moves through the list", B.S.sel === "c4dddddddd" && $("#pos").textContent === "4 of 4" && $("#nextBtn").disabled);
check("rebuild: a phone comment rebuilds at the phone's size", B.frame().iframe.getAttribute("width") === "390");
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c4dddddddd", rects: { c4dddddddd: null }, found: false }, source: B.frame().iframe.contentWindow }));
check("boxes: a part the rebuilt screen can't find keeps the spot the tester pointed at, and says so", Math.abs(parseFloat($(".cbox.sel").style.left) - 10.14) < 0.1 && / The part they pointed at isn't on this screen now, so the box shows where it was\.$/.test($("#dNote").textContent), $("#dNote").textContent);
$("#prevBtn").click(); await tick(5);
check("previous: back one", B.S.sel === "c2bbbbbbbb");
press("ArrowLeft"); await tick(5);
check("keys: left arrow is previous", B.S.sel === "c1aaaaaaaa");
press("j"); await tick(5);
check("keys: j is next", B.S.sel === "c2bbbbbbbb");
press("k"); await tick(5);
press("Escape"); await tick(5);
check("keys: Escape closes the comment and the list takes the whole width again", $("#detail").hidden && !$("#main").classList.contains("split") && !B.frame().iframe && w.document.activeElement === row("c1aaaaaaaa"));
press("ArrowRight"); await tick(5);
check("keys: with nothing open, right arrow opens the first comment", B.S.sel === "c5eeeeeeee" && $("#pos").textContent === "1 of 4");

/* ---- weight ---- */
row("c1aaaaaaaa").click(); await tick(5);
$("#dWeight .must").click();
await until(() => $("#dWeight .must").getAttribute("aria-pressed") === "true");
let L = await list();
check("weight: one click saves Must for the whole team", L.reviews.c1aaaaaaaa.priority === "must" && L.reviews.c1aaaaaaaa.by === "Rowan");
check("weight: the card shows it straight away, without moving", row("c1aaaaaaaa").querySelector(".wt.must") && row("c1aaaaaaaa").classList.contains("must") && rowsText()[1] === "Next jumps when the timer appears.");
check("weight: each button names its key", $$("#dWeight button").map((b) => b.title).join() === "Must (1),Should (2),Could (3),Ignore (4)");
press("2");
await until(() => $("#dWeight .should").getAttribute("aria-pressed") === "true");
check("weight: the number keys weigh the open comment", (await list()).reviews.c1aaaaaaaa.priority === "should" && row("c1aaaaaaaa").classList.contains("should"));
press("1");
await until(() => $("#dWeight .must").getAttribute("aria-pressed") === "true");
$("#dWeight .must").click();
await until(() => $("#dWeight .must").getAttribute("aria-pressed") === "false");
check("weight: clicking it again clears it", (await list()).reviews.c1aaaaaaaa.priority === "");
$("#dWeight .must").click();
await until(() => $("#dWeight .must").getAttribute("aria-pressed") === "true");
row("c5eeeeeeee").click(); await tick(5);
$("#dWeight .ignore").click();
await until(() => row("c5eeeeeeee").classList.contains("ignored"));
check("ignore: the row dims and says Ignored", row("c5eeeeeeee").querySelector(".wt.ignore").textContent === "Ignored" && (await list()).reviews.c5eeeeeeee.priority === "ignore");
row("c2bbbbbbbb").click(); await tick(5);
check("weight: a Must saved by the old board still shows as Must", $("#dWeight .must").getAttribute("aria-pressed") === "true");

/* ---- team notes ---- */
row("c1aaaaaaaa").click(); await tick(5);
let ta = $("#dNotes textarea"), add = $("#dNotes .addnote button");
check("notes: Add waits for words", add.disabled);
ta.value = "Layout shift when the timer chip mounts.\nKeep Next fixed."; ta.dispatchEvent(new w.Event("input", { bubbles: true }));
$("#dWeight .should").click();
await until(() => $("#dWeight .should").getAttribute("aria-pressed") === "true");
check("notes: a half-written note survives other changes", $("#dNotes textarea").value === "Layout shift when the timer chip mounts.\nKeep Next fixed.");
$("#dWeight .must").click();
await until(() => $("#dWeight .must").getAttribute("aria-pressed") === "true");
$("#dNotes .addnote button").click();
await until(() => $("#dNotes .nlist li"));
L = await list();
check("notes: a comment on the comment, signed with the reviewer's name", L.reviews.c1aaaaaaaa.notes.length === 1 && L.reviews.c1aaaaaaaa.notes[0].name === "Rowan" && /Keep Next fixed/.test(L.reviews.c1aaaaaaaa.notes[0].text) && L.reviews.c1aaaaaaaa.priority === "must");
check("notes: shown with the comment, and counted in its row", /^Rowan: Layout shift/.test($("#dNotes .nlist li span").textContent) && /1 team note$/.test(row("c1aaaaaaaa").querySelector(".meta .m").textContent) && $("#dNotes textarea").value === "");
$("#dNotes textarea").value = "Second thought."; $("#dNotes textarea").dispatchEvent(new w.Event("input", { bubbles: true })); $("#dNotes .addnote button").click();
await until(() => $$("#dNotes .nlist li").length === 2);
let rm = $$("#dNotes .nlist li")[1].querySelector("button");
rm.click();
check("notes: Remove asks for a second click", rm.textContent === "Click again to remove");
rm.click();
await until(() => $$("#dNotes .nlist li").length === 1);
check("notes: removing one keeps the rest", (await list()).reviews.c1aaaaaaaa.notes.map((n) => n.text).join() === "Layout shift when the timer chip mounts.\nKeep Next fixed.");

/* ---- earlier versions ---- */
$("#tabEarlier").click(); await tick(5);
check("earlier: its own list, by part of the tool", heads().join() === "Set up|1,2. Why it exists|1,3. Draw it|1" && $("#detail").hidden, heads().join());
check("earlier: a screen the live tool no longer has still finds its part by name", row("c7gggggggg") && row("c7gggggggg").closest(".grp").querySelector("h2").firstChild.textContent === "3. Draw it");
check("earlier: an old Won't shows as Ignored", row("c6ffffffff").querySelector(".wt.ignore").textContent === "Ignored");
check("earlier: says what to do, with one button for all", $("#summary").textContent === "Made on earlier versions. Mark the ones that still apply as still open." && !$("#allBtn").hidden && $("#allBtn").textContent === "Mark all still open");
check("earlier: rows say which version", /version of 26 Oct$/.test(row("c3cccccccc").querySelector(".meta").textContent), row("c3cccccccc").querySelector(".meta").textContent);
check("escaping: typed HTML shows as text and never runs", w.pwned === undefined && !$("#list img") && /<img src=x/.test(row("c3cccccccc").querySelector(".txt").textContent) && /<img src=x/.test(row("c3cccccccc").querySelector(".meta").textContent));
row("c3cccccccc").click(); await tick(5);
check("earlier: says which version, by date and commit", !$("#dEarlier").hidden && $("#dVer").textContent === "Made on the version of 26 Oct 2026, commit c1sha00." && $("#dOpen").getAttribute("aria-pressed") === "false", $("#dVer").textContent);
check("earlier: Then and Now, starting on Then", !$("#dSwitch").hidden && $("#thenBtn").getAttribute("aria-pressed") === "true");
await until(() => B.frame().iframe.getAttribute("srcdoc"));
check("then: the screen the tester saw, from that commit", /old version/.test(B.frame().iframe.getAttribute("srcdoc")) && $("#dNote").textContent === "Rebuilt with made-up content at 1280 \u00d7 800, on the version it was made on.");
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c3cccccccc", rects: { c3cccccccc: { x: 600, y: 500, w: 100, h: 50 } }, found: true }, source: B.frame().iframe.contentWindow }));
check("then: an older box drawn by hand keeps its size, moved onto the part it was drawn over", Math.abs(parseFloat($(".cbox.sel").style.left) - 450.24) < 0.5 && Math.abs(parseFloat($(".cbox.sel").style.top) - 450) < 0.5 && Math.abs(parseFloat($(".cbox.sel").style.width) - 299.52) < 0.5, $(".cbox.sel").style.cssText);
$("#nowBtn").click(); await tick(5);
await until(() => /live version/.test(B.frame().iframe.getAttribute("srcdoc") || ""));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c3cccccccc", rects: { c3cccccccc: { x: 600, y: 500, w: 100, h: 50 } }, found: true }, source: B.frame().iframe.contentWindow }));
check("now: the same screen on the live version, with the old box dashed", $("#nowBtn").getAttribute("aria-pressed") === "true" && $(".cbox.sel").classList.contains("then") && $("#dNote").textContent === "Rebuilt with made-up content at 1280 \u00d7 800, on the live version.", $("#dNote").textContent);
$("#dOpen").click();
await until(() => $("#dOpen").getAttribute("aria-pressed") === "true");
check("still open: saved against the live version", (await list()).reviews.c3cccccccc.open === LIVE);
check("still open: the row says so, and the tab count grows", /still open$/.test(row("c3cccccccc").querySelector(".meta").textContent) && $("#tabLive").textContent === "Live version5");
check("mark all: with only one left to check, no need for the button", $("#allBtn").hidden);
$("#dOpen").click();
await until(() => $("#dOpen").getAttribute("aria-pressed") === "false" && !$("#allBtn").hidden);
$("#allBtn").click();
await until(() => /marked still open/.test($("#toast").textContent));
L = await list();
check("mark all: keeps every unchecked comment open, but not the ignored ones", L.reviews.c7gggggggg.open === LIVE && L.reviews.c3cccccccc.open === LIVE && !L.reviews.c6ffffffff.open && $("#tabLive").textContent === "Live version6");
$("#tabLive").click(); await tick(5);
check("live: still-open comments join their part of the tool", heads().join() === "Set up|1,1. Better way|2,2. Why it exists|2,3. Draw it|1" && /still open from the 26 Oct version$/.test(row("c3cccccccc").querySelector(".meta").textContent), heads().join());
check("live: the summary counts them", $("#summary").textContent === "6 comments from 4 testers, 2 of them still open from an earlier version.", $("#summary").textContent);
row("c7gggggggg").click(); await tick(5);
$("#dOpen").click();
await until(() => !row("c7gggggggg"));
check("still open: unmarking it takes it out of the live list, and the comment stays open to undo", B.S.sel === "c7gggggggg" && !$("#detail").hidden && $("#pos").textContent === "Moved out" && (await list()).reviews.c7gggggggg.open === "");
$("#dOpen").click();
await until(() => row("c7gggggggg"));
check("still open: and it can come straight back", $("#pos").textContent === "6 of 6");

/* ---- Copy for AI ---- */
const t1 = B.aiText({ all: true }).text;
check("AI: a heading, the live version and the counts", /^## Tester feedback: Reimagination Lab\n\nLive version of 27 Oct 2026 \(commit c2sha00\)\. 5 comments from 4 testers, 2 of them from an earlier version that the team marked still open\./.test(t1), t1.slice(0, 260));
check("AI: settings most comments share are said once", /still open\. Settings, unless a comment says otherwise: mode team, place virtual\.\n/.test(t1) && !/   Settings: /.test(t1));
check("AI: a short guide to reading it, with no instructions of its own", /How to read this: comments are grouped by part of the tool, in the testers' own words\./.test(t1) && !/\b(please|you should|fix this|you must)\b/i.test(t1));
check("AI: grouped by part of the tool, in the tool's order", t1.indexOf("### 1. Better way") > -1 && t1.indexOf("### 1. Better way") < t1.indexOf("### 2. Why it exists") && t1.indexOf("### 2. Why it exists") < t1.indexOf("### 3. Draw it") && t1.indexOf("### Set up") === -1);
check("AI: each comment with its weight, in the testers' words", /### 1\. Better way\n1\. Must: "Next jumps when the timer appears\."\n   Team note: Layout shift when the timer chip mounts\. Keep Next fixed\.\n   Where: screen b-share \("Write your eye-rollers"\), button "Next" \(footer#bottom > button#nextBtn\), box at 62% across and 87% down, 1280\u00d7800 window\n   Seen on: Chrome 141 on macOS, mouse or trackpad\n   Just before: clicked button "Next"\n2\. Must: "The Next button moves when I start the timer\."/.test(t1), t1.slice(t1.indexOf("### 1."), t1.indexOf("### 1.") + 500));
check("AI: no weight means no label", /\n\d\. "Too small on my phone\."/.test(t1));
check("AI: an earlier comment names its version and commit, and says where it was then", /"The ladder <img src=x onerror="window\.pwned=1"> is confusing\."\n   From an earlier version: 26 Oct 2026, commit c1sha00\. The team marked it still open\.\n   Where then: screen ladder/.test(t1));
check("AI: no names of testers or reviewers, because personal names stay out of what goes into an AI", !/\b(?:Ana|Sam|Kim|Lee|Rowan)\b/.test(t1));
check("AI: ignored comments and unchecked earlier ones stay out", !/welcome takes too long/.test(t1) && !/Cover music/.test(t1));
const t2 = B.aiText({ all: false }).text;
check("AI: comments with no weight can be left out", !/Too small on my phone/.test(t2) && !/The ladder/.test(t2) && /Next jumps/.test(t2));
$("#aiBtn").click(); await tick(5);
let dlg = $("#dlg");
check("AI: the dialog shows the text and says what was left out", dlg && dlg.querySelector("textarea").value === t1 && dlg.querySelector("p").textContent === "Left out: 1 ignored and 1 from earlier versions that aren't marked still open.", dlg && dlg.querySelector("p").textContent);
dlg.querySelector('input[type="checkbox"]').click();
check("AI: unticking no-weight comments updates the text and the count", dlg.querySelector("textarea").value === t2 && /3 with no weight/.test(dlg.querySelector("p").textContent), dlg.querySelector("p").textContent);
Array.from(dlg.querySelectorAll("button")).find((b) => b.textContent === "Copy").click(); await tick(5);
check("AI: Copy puts it on the clipboard", copied === t2 && /Copied/.test($("#toast").textContent));
press("Escape");
check("dialogs: Escape closes them and leaves the comment open", !$("#dlg") && !$("#detail").hidden);

/* ---- the tester link ---- */
$("#linkBtn").click(); await tick(5);
let d = $("#dlg");
check("tester link: reminds whoever shares it that testers use made-up details", /Ask testers to use made-up names and details\./.test(d.textContent));
check("tester link: the code, and the tool's link to share", d.querySelector(".codebig").textContent === CODE && d.querySelector(".link code").textContent === "https://ep.github.io/pt/field-tools/reimagination-lab/?feedback=" + CODE);
const other = d.querySelector('input[placeholder="Paste a tool\'s address"]');
other.value = "https://ep.github.io/pt/field-tools/pair-poll/?host=X#y"; other.dispatchEvent(new w.Event("change"));
check("tester link: paste any tool's address to get its link", d.querySelectorAll(".link code")[1].textContent === "https://ep.github.io/pt/field-tools/pair-poll/?host=X&feedback=" + CODE);
const nc = Array.from(d.querySelectorAll("button")).find((b) => b.textContent === "New code");
nc.click();
check("tester link: a new code asks for a second click and says what happens", nc.textContent === "Click again. Old links stop working.");
nc.click();
await until(() => $("#dlg") && $("#dlg .codebig") && $("#dlg .codebig").textContent !== CODE);
const NEW = $("#dlg .codebig").textContent; codeNow = NEW;
check("tester link: the new code is live and the old one stops", (await call("GET", "/api/fb/check?code=" + NEW)).data.ok === true && (await call("GET", "/api/fb/check?code=" + CODE)).data.ok === false);
press("Escape");

/* ---- deleting ---- */
row("c4dddddddd").click(); await tick(5);
const del = $("#delBtn");
del.click();
check("delete: asks for a second click", del.textContent === "Click again to delete");
del.click();
await until(() => /Deleted/.test($("#toast").textContent));
check("delete: gone for everyone, and the next comment opens", !(await list()).comments.some((c) => c.id === "c4dddddddd") && B.S.sel && B.S.sel !== "c4dddddddd" && $("#delBtn").textContent === "Delete comment");

/* ---- a new comment arrives, about the whole screen ---- */
await post("c8hhhhhhhh", { name: "Max", text: "The whole screen feels slow.", screen: "b-share", where: { x: 0, y: 0, w: 1280, h: 800, vw: 1280, vh: 800, xp: 0, yp: 0, wp: 100, hp: 100, area: false, whole: true, sy: 0, el: { tag: "page", text: "", path: "" } } });
B.pull();
await until(() => row("c8hhhhhhhh"));
check("arrivals: a new comment shows up on its own, glowing for a moment, with a note", row("c8hhhhhhhh").classList.contains("fresh") && /1 new comment/.test($("#toast").textContent));
row("c8hhhhhhhh").click(); await tick(5);
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-rects", focus: "c8hhhhhhhh", rects: { c8hhhhhhhh: null }, found: false }, source: B.frame().iframe.contentWindow }));
check("whole screen: no box, and the note says what it is about", !$(".cbox.sel") && / The comment is about the whole screen\.$/.test($("#dNote").textContent), $("#dNote").textContent);
check("whole screen: Copy for AI says so too", /"The whole screen feels slow\."\n   Where: screen b-share \("Write your eye-rollers"\), the whole screen, 1280\u00d7800 window/.test(B.aiText({ all: true }).text));
await tick(3100);
check("arrivals: the glow fades", !row("c8hhhhhhhh").classList.contains("fresh") || !B.S.fresh.c8hhhhhhhh);

/* ---- refreshing never disturbs the reviewer ---- */
{
  row("c1aaaaaaaa").click(); await tick(5);
  const node = row("c1aaaaaaaa"), wb = $("#dWeight .could");
  B.pull(); await tick(80);
  check("refresh: with nothing new, the page is left exactly as it was", row("c1aaaaaaaa") === node && $("#dWeight .could") === wb);
  row("c2bbbbbbbb").focus();
  await post("c9iiiiiiii", { name: "Max", text: "One more arrives.", screen: "who", ctx: ctx({ heading: "Who's here?" }) });
  B.pull();
  await until(() => row("c9iiiiiiii")); await tick(60);
  check("refresh: when something is new, keyboard focus stays on the same card", w.document.activeElement === row("c2bbbbbbbb"));
  const was = weightOf0();
  function weightOf0() { const r = B.S.reviews.c1aaaaaaaa; return r ? r.priority : ""; }
  w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "3", bubbles: true, repeat: true }));
  await tick(80);
  check("weights: a held number key doesn't flip the weight back and forth", weightOf0() === was && (await list()).reviews.c1aaaaaaaa.priority === was);
}

/* ---- a tester-made address can't put anything into the board's frame ---- */
{
  await post("e1jjjjjjjj", { text: "Odd address.", ctx: ctx({ name: "Evil", page: 'https://ep.github.io/pt/a"><script>window.bad=1</script>/../../field-tools/reimagination-lab/?feedback' }) }, "evil-tool");
  $("#menuBtn").click(); $("#refreshBtn").click();
  await until(() => !$("#toolsBtn").hidden);
  $("#toolsBtn").click(); await tick(5);
  Array.from($$("#dlg .toolrow")).find((b) => /Evil/i.test(b.textContent)).click();
  await until(() => row("e1jjjjjjjj"));
  row("e1jjjjjjjj").click(); await tick(30);
  const frames = $$("iframe").map((f) => f.getAttribute("srcdoc") || "").join(" ");
  check("frame: an address with anything but a plain path is not used, and nothing from it reaches the frame", !/window\.bad/.test(frames) && /Can't find this tool's file/.test($("#dNote").textContent), $("#dNote").textContent);
  $("#toolsBtn").click(); await tick(5);
  Array.from($$("#dlg .toolrow")).find((b) => /Reimagination/i.test(b.textContent)).click();
  await until(() => row("c1aaaaaaaa"));
  row("c1aaaaaaaa").click(); await tick(5);
}

/* ---- small screens ---- */
w.innerWidth = 800; w.dispatchEvent(new w.Event("resize"));
check("phones: the open comment covers the list, and the page behind it stays still", w.document.body.classList.contains("lock"));
$("#backBtn").click(); await tick(5);
check("phones: Back returns to the list", $("#detail").hidden && !w.document.body.classList.contains("lock"));
w.innerWidth = 1440;

/* ---- more than one tool ---- */
check("tools: a second tool's comment posts", (await post("p1hhhhhhhh", { text: "Pair Poll comment.", screen: "studio", ctx: ctx({ name: "Pair Poll", page: "https://ep.github.io/pt/field-tools/pair-poll/?feedback" }) }, "pair-poll")).status === 200);
$("#menuBtn").click(); $("#refreshBtn").click();
await until(() => !$("#toolsBtn").hidden);
$("#toolsBtn").click(); await tick(5);
check("tools: with two tools, a list to switch between them", $$("#dlg .toolrow").length === 2);
press("Escape");

/* ---- one filled button ---- */
check("design: one filled button on the board, Copy for AI", $$(".top .btn").filter((b) => !b.classList.contains("sec") && !b.classList.contains("ghost")).map((b) => b.textContent).join() === "Copy for AI");

/* ---- signing out ---- */
$("#menuBtn").click(); $("#outBtn").click();
check("sign out: back to the gate, and the key is forgotten here", !$("#gate").hidden && $("#board").hidden && w.localStorage.getItem("ep-board-key") === null);
check("the board never put the team key in an address", w.requests.every((r) => r.u.indexOf(TEAM) === -1));

/* ---- not set up yet ---- */
{
  const bare = { DB: FakeDB() };
  const d2 = new JSDOM(HTML, { url: "https://ep.github.io/pt/feedback/", runScripts: "outside-only" });
  const w2 = d2.window;
  w2.fetch = async (u, o = {}) => { const req = new Request(String(u), { method: o.method || "GET", headers: Object.assign({ Origin: "https://ep.github.io" }, o.headers || {}), body: o.body }); const res = await worker.fetch(req, bare); const text = await res.text(); return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) }; };
  w2.eval(SCRIPT);
  w2.document.querySelector("#keyIn").value = "anything"; w2.document.querySelector("#nameIn").value = "Rowan";
  w2.document.querySelector("#gateForm").dispatchEvent(new w2.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => !w2.document.querySelector("#gateErr").hidden);
  check("before the secret is set, the board says what to do", w2.document.querySelector("#gateErr").textContent === "The board isn't set up yet. Add the FEEDBACK_KEY secret to the pt worker first.");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
