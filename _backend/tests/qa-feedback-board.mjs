// Tests for feedback/index.html (the feedback board) in a simulated browser with
// jsdom. The board talks to the real worker code (pt-worker.js) with the shared fake
// database, and to a fake GitHub for the tool's history.
//   node _backend/tests/qa-feedback-board.mjs
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";
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

/* ---- the page itself ---- */
{
  check("page: noindex", /<meta name="robots" content="noindex, nofollow">/.test(HTML));
  check("page: no analytics", !/clarity|gtag\(|googletagmanager/i.test(HTML));
  check("page: no em or en dashes", !/[\u2013\u2014]/.test(HTML));
  const script = HTML.slice(HTML.indexOf("<script>") + 8, HTML.lastIndexOf("</script>"));
  check("page: never writes HTML from strings", !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(script));
  check("page: the rebuilt screen never shares the board's origin", /setAttribute\("sandbox", "allow-scripts"\)/.test(script) && !/allow-same-origin/.test(HTML));
  check("page: the team key travels only in a header, never in an address", /"X-Team-Key": S\.key/.test(script) && !/[?&]key=/.test(script));
  const hosts = [...new Set((HTML.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((u) => u.replace(/^https?:\/\//, "").toLowerCase()))];
  check("page: talks only to EP's worker, GitHub and Google Fonts", hosts.every((h) => ["fonts.googleapis.com", "pt.armand-khambatta.workers.dev", "api.github.com", "raw.githubusercontent.com", "ep.github.io"].includes(h)), hosts.join(","));
}

/* ---- comments from testers, posted through the real worker ---- */
const CODE = (await team("POST", "/api/fb/code", {})).data.code;
const PAGE = "https://ep.github.io/pt/field-tools/reimagination-lab/?host=[removed]&feedback";
function comment(id, o) {
  return Object.assign({ name: "Ana", text: "Words", ver: "git:" + "b".repeat(40), screen: "b-share",
    where: { x: 796, y: 696, w: 168, h: 72, vw: 1280, vh: 800, xp: 62.2, yp: 87, wp: 13.1, hp: 9, area: false, el: { tag: "button", role: "", text: "Next", path: "footer#bottom > button#nextBtn" } },
    ctx: { name: "Reimagination Lab", page: PAGE, heading: "Write your eye-rollers", settings: { mode: "team", place: "virtual" }, device: { browser: "Chrome 141", os: "macOS", input: "mouse or trackpad" }, actions: [{ t: "10:41:58", what: 'clicked button "Next"', screen: "b-think" }], errors: [] } }, o);
}
async function post(id, o, ip) { return call("POST", "/api/fb/post", { tool: "reimagination-lab", code: CODE, id, edit: "E".repeat(20) + id.slice(0, 4), comment: comment(id, o) }, { "CF-Connecting-IP": ip || "1.2.3.4" }); }
await post("c1aaaaaaaa", { text: "Next jumps when the timer appears." });
await tick(5);
await post("c2bbbbbbbb", { name: "Sam", text: "The Next button moves when I start the timer." });
await tick(5);
await post("c3cccccccc", { name: 'Lee <img src=x onerror="window.pwned=1">', text: 'The ladder <img src=x onerror="window.pwned=1"> is confusing.', screen: "ladder", ver: "git:" + "a".repeat(40),
  where: { x: 100, y: 200, w: 300, h: 100, vw: 1280, vh: 800, xp: 7.8, yp: 25, wp: 23.4, hp: 12.5, area: true, el: { tag: "div", text: "", path: "main#stage > section.scene" } },
  ctx: Object.assign(comment("x").ctx, { heading: "Build the ladder together." }) });
await tick(5);
await post("c4dddddddd", { name: "Kim", text: "Too small on my phone.", screen: "ladder", where: { x: 10, y: 600, w: 200, h: 60, vw: 390, vh: 844, xp: 2.6, yp: 71.1, wp: 51.3, hp: 7.1, area: false, el: { tag: "textarea", text: "the field We do this in order to", path: "textarea.big" } } });

/* ---- the board in a simulated browser ---- */
const TOOL_HTML_LIVE = "<!doctype html><html><head><title>Lab</title></head><body><p>live version</p></body></html>";
const TOOL_HTML_OLD = "<!doctype html><html><head><title>Lab</title></head><body><p>old version</p></body></html>";
const dom = new JSDOM(HTML, { url: "https://ep.github.io/pt/feedback/", runScripts: "outside-only", pretendToBeVisual: true });
const w = dom.window;
w.requests = [];
let copied = null;
Object.defineProperty(w.navigator, "clipboard", { configurable: true, value: { writeText: (t) => { copied = t; return Promise.resolve(); } } });
w.fetch = async (u, o = {}) => {
  u = String(u); w.requests.push({ u, o });
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => (typeof data === "string" ? data : JSON.stringify(data)) });
  if (u.indexOf(API) === 0) {
    const req = new Request(u, { method: o.method || "GET", headers: Object.assign({ Origin: "https://ep.github.io" }, o.headers || {}), body: o.body });
    const res = await worker.fetch(req, env); const text = await res.text();
    return { ok: res.ok, status: res.status, json: async () => JSON.parse(text) };
  }
  if (u.indexOf("https://api.github.com/repos/ep/pt/commits?path=field-tools%2Freimagination-lab%2Findex.html") === 0)
    return ok([{ sha: "c2sha", commit: { message: "Reimagination Lab v4", author: { date: "2026-10-27T14:00:00Z" } } }, { sha: "c1sha", commit: { message: "Reimagination Lab", author: { date: "2026-10-26T14:00:00Z" } } }]);
  if (u === "https://api.github.com/repos/ep/pt/contents/field-tools/reimagination-lab/index.html?ref=c2sha") return ok({ sha: "b".repeat(40) });
  if (u === "https://api.github.com/repos/ep/pt/contents/field-tools/reimagination-lab/index.html?ref=c1sha") return ok({ sha: "a".repeat(40) });
  if (u === "/pt/field-tools/reimagination-lab/index.html") return ok(TOOL_HTML_LIVE);
  if (u === "https://raw.githubusercontent.com/ep/pt/c1sha/field-tools/reimagination-lab/index.html") return ok(TOOL_HTML_OLD);
  return { ok: false, status: 404, json: async () => ({}), text: async () => "" };
};
const SCRIPT = HTML.slice(HTML.indexOf("<script>") + 8, HTML.lastIndexOf("</script>"));
w.eval(SCRIPT);
const $ = (s) => w.document.querySelector(s), $$ = (s) => Array.from(w.document.querySelectorAll(s));
const B = w.EPBoard;
function submitGate(key, name) { $("#keyIn").value = key; $("#nameIn").value = name; $("#gateForm").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); }

check("sign in: the board asks for the team key and a name first", !$("#gate").hidden && $("#board").hidden && $("#gate h1").textContent === "Feedback board");
submitGate("not-the-key", "Rowan");
await until(() => !$("#gateErr").hidden);
check("sign in: a wrong key says so plainly", $("#gateErr").textContent === "That key doesn't match. Check it and try again." && $("#board").hidden);
submitGate(TEAM, "Rowan");
await until(() => !$("#board").hidden && $$(".card").length > 0 && B.S.latest);
await until(() => /the live one/.test($("#verSel").textContent));
check("sign in: the right key opens the board and is remembered here", !$("#board").hidden && w.localStorage.getItem("ep-board-key") === TEAM && w.localStorage.getItem("ep-board-name") === "Rowan");
check("tools: named from the comments, with a count", $("#toolSel").options[0].textContent === "Reimagination Lab (4)");
const scr = $$("#screens .scr");
check("screens: each screen with its comment count", scr.length === 2 && /Write your eye-rollers/.test(scr[0].textContent) && scr[0].querySelector("b").textContent === "2" && /Build the ladder together\./.test(scr[1].textContent) && scr[0].getAttribute("aria-current") === "true");
check("view: the screen's heading and count", $("#view h2").textContent === "Write your eye-rollers" && /2 comments on b-share/.test($("#view .sub").textContent));

/* the rebuilt screen */
const F = B.frame();
check("rebuild: the frame is the tester's window size", F.iframe && F.iframe.getAttribute("width") === "1280" && F.iframe.getAttribute("height") === "800");
check("rebuild: sandboxed, scripts only", F.iframe.getAttribute("sandbox") === "allow-scripts");
await until(() => F.iframe.getAttribute("srcdoc"));
const sd = F.iframe.getAttribute("srcdoc") || "";
check("rebuild: the live version's code, told which screen and settings to open", /live version/.test(sd) && /window\.EPKitReplay=\{"screen":"b-share","settings":\{"mode":"team","place":"virtual"\}/.test(sd), sd.slice(0, 300));
check("rebuild: relative links resolve to the tool's own folder", /<base href="https:\/\/ep\.github\.io\/pt\/field-tools\/reimagination-lab\/">/.test(sd));
check("rebuild: says it is working on it", !F.load.hidden && /Rebuilding this screen/.test(F.load.textContent));
w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-replay", ok: true, w: 1280, h: 800 } }));
check("rebuild: a message from anywhere else is ignored", !F.load.hidden);
if (F.iframe.contentWindow) {
  w.dispatchEvent(new w.MessageEvent("message", { data: { type: "epkit-replay", ok: true, w: 1280, h: 800 }, source: F.iframe.contentWindow }));
  check("rebuild: the frame's ready message clears the wait", F.load.hidden);
} else check("rebuild: the frame has a window to listen to", false);
check("rebuild: the note says it is made-up content at that size", /^Rebuilt with made-up content at 1280 \u00d7 800, version of 27 Oct 2026, the live one\.$/.test(F.note.textContent), F.note.textContent);
const boxes = $$(".cbox");
check("boxes: one numbered box per comment, where the tester put it", boxes.length === 2 && boxes[0].querySelector("i").textContent === "1" && Math.abs(parseFloat(boxes[0].style.left) - 796.2) < 1 && Math.abs(parseFloat(boxes[0].style.top) - 696) < 1 && boxes[0].classList.contains("sel"));
boxes[1].click(); await tick(5);
check("boxes: picking a box selects its comment", $$(".cbox")[1].classList.contains("sel") && $$(".card")[1].classList.contains("sel"));

/* versions */
const vopts = Array.from($("#verSel").options).map((o) => o.textContent);
check("versions: grouped by the file each tester had open, newest first", vopts[0] === "All versions" && vopts[1] === "Version of 27 Oct 2026, the live one (3)" && vopts[2] === "Version of 26 Oct 2026 (1)", vopts.join(" | "));

/* sorting a comment */
let cards = $$(".card");
check("cards: the tester's words, who, when and on what", /Next jumps when the timer appears\./.test(cards[0].querySelector(".words").textContent) && /^Ana, \d+ \w+ \d\d:\d\d, Chrome 141 on macOS, 1280\u00d7800$/.test(cards[0].querySelector(".meta").textContent), cards[0].querySelector(".meta").textContent);
const seg = cards[0].querySelector(".seg");
check("cards: one priority control, Must Should Could Won't", Array.from(seg.querySelectorAll("button")).map((b) => b.textContent).join() === "Must,Should,Could,Won't" && seg.getAttribute("aria-label") === "Priority");
seg.querySelector(".must").click();
await until(() => $$(".card")[0].querySelector(".must").getAttribute("aria-pressed") === "true");
let L = (await team("GET", "/api/fb/list?tool=reimagination-lab")).data;
check("priority: one click saves Must for the whole team", L.reviews.c1aaaaaaaa.priority === "must" && L.reviews.c1aaaaaaaa.by === "Rowan");
$$(".card")[0].querySelector(".must").click();
await until(() => $$(".card")[0].querySelector(".must").getAttribute("aria-pressed") === "false");
check("priority: clicking it again clears it", (await team("GET", "/api/fb/list?tool=reimagination-lab")).data.reviews.c1aaaaaaaa.priority === "");
$$(".card")[0].querySelector(".must").click();
await until(() => $$(".card")[0].querySelector(".must").getAttribute("aria-pressed") === "true");

/* a team note */
let ta = $$(".card")[0].querySelector(".addnote textarea"), add = $$(".card")[0].querySelector(".addnote button");
check("notes: Add waits for words", add.disabled);
ta.value = "Layout shift when the timer chip mounts.\nKeep Next fixed."; ta.dispatchEvent(new w.Event("input", { bubbles: true })); add.click();
await until(() => $$(".card")[0].querySelector(".notes li"));
L = (await team("GET", "/api/fb/list?tool=reimagination-lab")).data;
check("notes: a comment on the comment, with the reviewer's name", L.reviews.c1aaaaaaaa.notes.length === 1 && L.reviews.c1aaaaaaaa.notes[0].name === "Rowan" && /Keep Next fixed/.test(L.reviews.c1aaaaaaaa.notes[0].text) && L.reviews.c1aaaaaaaa.priority === "must");
check("notes: shown under the comment", /^Rowan: Layout shift/.test($$(".card")[0].querySelector(".notes li").textContent));

/* a repeat */
const sameSel = $$(".card")[1].querySelector(".same");
sameSel.value = "c1aaaaaaaa"; sameSel.dispatchEvent(new w.Event("change", { bubbles: true }));
await until(() => $$(".card")[1].querySelector(".follows"));
check("repeats: Same as #1 hands the comment that priority", /Same as #1/.test($$(".card")[1].querySelector(".follows").textContent) && !$$(".card")[1].querySelector(".seg") && (await team("GET", "/api/fb/list?tool=reimagination-lab")).data.reviews.c2bbbbbbbb.same === "c1aaaaaaaa");

/* the ladder screen: escaping, phone boxes */
$$("#screens .scr")[1].click(); await tick(5);
cards = $$(".card");
check("escaping: typed HTML shows as text and never runs", w.pwned === undefined && !$("#comments img") && /<img src=x/.test(cards[0].querySelector(".words").textContent) && /<img src=x/.test(cards[0].querySelector(".meta").textContent));
await until(() => B.frame().iframe.getAttribute("srcdoc"));
check("rebuild: an older version comes from that commit", /old version/.test(B.frame().iframe.getAttribute("srcdoc")));
check("boxes: only comments made at a similar window size are drawn", $$(".cbox").length === 1);
cards[1].querySelector(".num").click(); await tick(5);
check("boxes: choosing a phone comment rebuilds at the phone's size", B.frame().iframe.getAttribute("width") === "390" && $$(".cbox").length === 1 && $$(".cbox")[0].classList.contains("sel"));
$$(".card")[0].querySelector(".wont").click();
await until(() => $$(".card")[0].querySelector(".wont").getAttribute("aria-pressed") === "true");

/* filters */
$("#priSel").value = "none"; $("#priSel").dispatchEvent(new w.Event("change"));
check("filter: Not sorted shows only what still needs a call", $$(".card").length === 1 && /Too small on my phone/.test($$(".card")[0].textContent));
$("#priSel").value = "must"; $("#priSel").dispatchEvent(new w.Event("change"));
check("filter: Must includes its repeats", $$(".card").length === 2 && $$("#screens .scr").length === 1);
$("#priSel").value = "all"; $("#priSel").dispatchEvent(new w.Event("change"));

/* Copy for AI */
const t1 = B.aiText({ none: false, wont: true }).text;
check("AI: a heading, the version and the counts", /^## Tester feedback: Reimagination Lab\n\nComments from more than one version of the tool\. 4 comments from 4 testers, /.test(t1), t1.slice(0, 200));
check("AI: a short guide to reading it, with no instructions of its own", /How to read this: each item is something testers raised, in their own words\./.test(t1) && !/\b(please|you should|fix this|you must)\b/i.test(t1));
check("AI: Must first, repeats folded in with a count", /### Must\n1\. "Next jumps when the timer appears\." \(2 testers\)/.test(t1) && /Also said: "The Next button moves when I start the timer\."\n/.test(t1));
check("AI: no names of testers or reviewers, because personal names stay out of what goes into an AI", !/\b(?:Ana|Sam|Kim|Lee|Rowan)\b/.test(t1));
check("AI: the team note and where it is in the code", /Team note: Layout shift when the timer chip mounts\. Keep Next fixed\./.test(t1) && /Where: screen b-share \("Write your eye-rollers"\), button "Next" \(footer#bottom > button#nextBtn\), box at 62% across and 87% down, 1280\u00d7800 window/.test(t1));
check("AI: what happened just before", /Just before: clicked button "Next"/.test(t1));
check("AI: Won't becomes leave as is, last", /### Leave as is\n- "The ladder <img src=x onerror="window\.pwned=1"> is confusing\."$/.test(t1));
check("AI: unsorted comments stay out unless asked for", !/Too small on my phone/.test(t1) && /### Not sorted yet\n1\. "Too small on my phone\."/.test(B.aiText({ none: true, wont: true }).text));
$("#aiBtn").click(); await tick(5);
const dlg = $("#dlg");
check("AI: the dialog shows the text and says what was left out", dlg && dlg.querySelector("textarea").value === t1 && /1 comment isn't sorted yet, so it's left out\./.test(dlg.textContent));
Array.from(dlg.querySelectorAll("button")).find((b) => b.textContent === "Copy").click(); await tick(5);
check("AI: Copy puts it on the clipboard", copied === t1 && /Copied/.test($("#toast").textContent));
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
check("dialogs: Escape closes them", !$("#dlg"));
$("#verSel").value = "git:" + "b".repeat(40); $("#verSel").dispatchEvent(new w.Event("change"));
check("AI: one version at a time, named at the top", /^## Tester feedback: Reimagination Lab\n\nVersion of 27 Oct 2026, the live one\. 3 comments from 3 testers/.test(B.aiText({ none: false, wont: true }).text));
check("versions: the board shows only that version's comments", $$("#screens .scr").length === 2 && $$(".card").length >= 1 && !$$(".card .words").some((c) => /ladder <img/.test(c.textContent)));
$("#verSel").value = "all"; $("#verSel").dispatchEvent(new w.Event("change"));

/* the tester link */
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
const NEW = $("#dlg .codebig").textContent;
check("tester link: the new code is live and the old one stops", (await call("GET", "/api/fb/check?code=" + NEW)).data.ok === true && (await call("GET", "/api/fb/check?code=" + CODE)).data.ok === false);
w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

/* deleting */
const del = $$(".card")[0].querySelector(".cardfoot button");
del.click();
check("delete: asks for a second click", del.textContent === "Click again to delete");
del.click();
await until(() => /Deleted/.test($("#toast").textContent));
await until(() => B.S.comments.length === 3);
check("delete: the comment is gone for everyone", (await team("GET", "/api/fb/list?tool=reimagination-lab")).data.comments.length === 3);

/* one filled button per screen */
check("design: one filled button on the board, Copy for AI", $$(".top .btn").filter((b) => !b.classList.contains("sec") && !b.classList.contains("ghost")).map((b) => b.textContent).join() === "Copy for AI");

/* signing out */
$("#menuBtn").click(); $("#outBtn").click();
check("sign out: back to the gate, and the key is forgotten here", !$("#gate").hidden && $("#board").hidden && w.localStorage.getItem("ep-board-key") === null);
check("the board never put the team key in an address", w.requests.every((r) => r.u.indexOf(TEAM) === -1));

/* not set up yet */
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
