// Tests for field-tools/reimagination-lab/index.html (the Reimagination Lab) in a
// simulated browser with jsdom. It walks a whole team session (in a room, then on a call)
// and a whole solo session through the six steps and the rail that fills with the group's
// own words, and checks the timers, the eye-roller vote revealed through Next, the why
// chain and the pick of its real purpose, the strip of frames the steps become (typed in,
// judged with one face each, questioned as necessary or inherited, then changed in place by
// the four moves), the story player, the change replayed in Share it, escaping, print, the
// outcome image, Email this (with the real send kit from assets/kit/), picking up after a
// reload (including sessions saved by earlier versions), clear with undo, and the hooks
// the feedback board uses.
//   node _backend/tests/qa-reimagination-lab.mjs
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(here, "../../field-tools/reimagination-lab");
const FILE = path.join(DIR, "index.html");
const KIT = path.resolve(here, "../../assets/kit");
const HTML = fs.readFileSync(FILE, "utf8");
const URL0 = "https://ep.github.io/pt/field-tools/reimagination-lab/";
const XSS = '<img src=x onerror="window.__xss=1">';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log("PASS " + name); }
  else { fail++; console.log("FAIL " + name + (detail !== undefined ? " :: " + String(detail).slice(0, 300) : "")); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) { const t0 = Date.now(); for (;;) { let v = false; try { v = fn(); } catch (e) {} if (v) return v; if (Date.now() - t0 > ms) return false; await sleep(25); } }

/* jsdom has no canvas, sound or media queries: give the page quiet stand-ins. */
function prepare(w, store) {
  const noop = () => {};
  const grad = { addColorStop: noop };
  const handler = {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "measureText") return (s) => ({ width: String(s).length * 10 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createConicGradient" || k === "createPattern") return () => grad;
      if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return noop;
    },
    set(t, k, v) { t[k] = v; return true; }
  };
  w.HTMLCanvasElement.prototype.getContext = function () { return new Proxy({ canvas: this }, handler); };
  w.HTMLCanvasElement.prototype.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
  w.HTMLCanvasElement.prototype.toBlob = function (cb, type) { setTimeout(() => cb(new w.Blob(["fake png bytes"], { type: type || "image/png" })), 0); };
  w.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  const realNow = w.Date.now.bind(w.Date); let off = 0;
  w.Date.now = () => realNow() + off;
  w.__skip = (ms) => { off += ms; };
  w.downloads = []; w.opened = []; w.__printed = 0; w.__audio = [];
  w.HTMLAnchorElement.prototype.click = function () { w.downloads.push({ href: this.href, download: this.download }); };
  w.open = (u) => { w.opened.push(u); return null; };
  w.print = () => { w.__printed++; };
  w.URL.createObjectURL = () => "blob:fake"; w.URL.revokeObjectURL = () => {};
  /* a stand-in for the voice: it records what was asked of it and never plays */
  w.Audio = function (src) { const a = { src, preload: "", muted: false, currentTime: 0, listeners: {}, played: 0, paused: true,
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }, play() { this.played++; return Promise.reject(new Error("no media here")); }, pause() { this.paused = true; } };
    w.__audio.push(a); return a; };
  if (store) for (const k of Object.keys(store)) w.localStorage.setItem(k, store[k]);
}
function openLab(store, url) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!/getContext|Not implemented: (navigation|window\.scrollTo|HTMLMediaElement)/.test(e.message)) errors.push(e.message); });
  vc.on("error", (e) => errors.push(String(e && e.message || e)));
  const dom = new JSDOM(HTML, { url: url || URL0, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, beforeParse: (w) => prepare(w, store) });
  dom.window.__errors = errors;
  return dom.window;
}
const cur = (w) => { const s = w.document.querySelectorAll("#stage .scene"); return s.length ? s[s.length - 1].getAttribute("data-id") : null; };
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => Array.from(w.document.querySelectorAll(s));
const scene = (w) => $$(w, "#stage .scene").pop();
async function next(w) { w.__skip(2000); $(w, "#nextBtn").click(); await sleep(60); }
async function back(w) { w.__skip(2000); $(w, "#backBtn").click(); await sleep(60); }
const SHOWN = [];
// A line that quotes the group's own words is marked private, so a tester's comment on it never carries them.
function quotesPrivate(w) { const q = Array.from(scene(w).querySelectorAll(".own")); return q.every((b) => b.hasAttribute("data-feedback-private") && !!b.parentElement && !!b.parentElement.closest("[data-feedback-private]")); }
const QUOTED = { screens: [], bad: [] };
async function at(w, id, label) {
  const ok = await until(() => cur(w) === id, 4000);
  if (!ok) { check(`${label}: reached ${id}`, false, "at " + cur(w)); return ok; }
  SHOWN.push(scene(w).textContent);
  if (scene(w).querySelector(".own")) { QUOTED.screens.push(id); if (!quotesPrivate(w)) QUOTED.bad.push(id); }
  return ok;
}
function type(w, el, v) { el.focus(); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); }
function key(w, el, k, extra = {}) { el.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra))); }
async function addTo(w, pathName, list) { for (const t of list) { const f = $(w, `.scene:last-child [data-add="${pathName}"]`); type(w, f, t); key(w, f, "Enter"); await sleep(30); } }
function visibleBtns(w) {
  const sc = scene(w);
  const pool = [...sc.querySelectorAll(".btn"), $(w, "#nextBtn"), $(w, "#backBtn")];
  return pool.filter((b) => {
    if (!b || b.disabled) return false;
    for (let n = b; n && n !== w.document.body; n = n.parentElement) {
      if (n.hidden) return false;
      if (n.tagName === "DETAILS" && !n.open && !(b.closest("summary") && n.contains(b.closest("summary")))) return false;
    }
    return true;
  });
}
function prim(w) { return visibleBtns(w).filter((b) => !b.classList.contains("sec") && !b.classList.contains("ghost")).map((b) => b.textContent.trim()); }
function railText(w, n) { const b = $(w, `#rail button[data-ch="${n}"]`); return b ? b.querySelector("em").textContent : null; }
// The Lab saves a moment after each change, and at once when the tab is hidden or closed.
function stored(w) { w.dispatchEvent(new w.Event("pagehide")); return JSON.parse(w.localStorage.getItem("rlab-v3") || "{}"); }

/* =================== the file itself =================== */
{
  check("page: noindex, like every pt page", /<meta name="robots" content="noindex, nofollow">/.test(HTML));
  check("page: no analytics", !/clarity|googletagmanager|gtag\(/i.test(HTML));
  check("page: no em or en dashes", !/[–—]/.test(HTML));
  check("page: the proprietary notice and copyright stay in the file and the printout", /proprietary ExperiencePoint tool/.test(HTML) && /Copyright &copy; ExperiencePoint Inc\. 2026/.test(HTML));
  check("page: the feedback and Email this kits are one line each", (HTML.match(/<script src="https:\/\/ep\.github\.io\/pt\/assets\/kit\/(feedback|send)\.js" defer><\/script>/g) || []).length === 2);
  const kb = Buffer.byteLength(HTML) / 1024;
  check("page: stays well under 1 MB, so the feedback board can read every version through GitHub", kb < 600, Math.round(kb) + " KB");
  check("page: no photos built in (their source was never confirmed)", !/data:image\/jpeg;base64/.test(HTML));
  check("page: the voice is a separate file beside the page, fetched by its full address", /https:\/\/ep\.github\.io\/pt\/field-tools\/reimagination-lab\/story\.mp3/.test(HTML) && !/data:audio/.test(HTML));
  const mp3 = path.join(DIR, "story.mp3");
  const mp3ok = fs.existsSync(mp3) && (() => { const b = fs.readFileSync(mp3); return b.length > 100000 && b.length < 1000000 && (b.subarray(0, 3).toString("latin1") === "ID3" || b[0] === 0xff); })();
  check("story.mp3: sits beside the page and is a small MP3", mp3ok, fs.existsSync(mp3) ? fs.statSync(mp3).size + " bytes" : "missing");
  const shown = HTML.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  check("page: says “workflow”, never “flow” on its own", !/(^|[^k])\bflow\b/i.test(shown.replace(/workflow/gi, "")));
  check("page: no Goldilocks, no ladder or rungs, no quiz in the page itself", !/goldilocks|\brungs?\b|ladder|quiz/i.test(shown));
  check("page: the workshop line lives in the bottom bar, apart from the activity", /<footer class="bar bottom" id="bottom">[\s\S]*id="goLink"[\s\S]*<\/footer>/.test(HTML));
}

/* =================== a team session, in a room and then on a call =================== */
const w = openLab();
{
  const L = "team";
  await at(w, "cover", L);
  check("start: the cover, with no errors", cur(w) === "cover" && w.__errors.length === 0, w.__errors.join(" | "));
  check("cover: plain words", /Bring one workflow that bugs you\.\s*Leave with a better one\./.test($(w, ".cover .sub").textContent));
  const T = w.EPKit && w.EPKit.tool;
  check("kit hook: names the tool, its version and the screen", T && T.id === "reimagination-lab" && T.version === "v8" && T.screen() === "cover");
  check("kit hook: reports a few settings and the step", T && T.state().mode === "team" && T.state().step === "1 of 18", JSON.stringify(T && T.state()));
  const secs = T && T.sections();
  check("kit hook: names its parts for the board: set up, the six steps, finish", secs && secs.map((s) => s.name).join("|") === "Set up|1. Better way|2. Why it exists|3. Draw it|4. Judge it|5. Reimagine it|6. Share it|Finish", secs && secs.map((s) => s.name).join("|"));
  const all = secs ? secs.reduce((a, s) => a.concat(s.screens), []) : [];
  check("kit hook: every screen sits in exactly one part, in the Lab's order", all.length === new Set(all).size && all.length === 19 && secs[0].screens.join() === "cover,who,plan" && secs[2].screens.join() === "why,purpose" && secs[5].screens.join() === "stories,moves" && secs[7].screens.join() === "workshops,finish", all.join());
  check("this round: the separate new-workflow screen is gone; the moves change the workflow itself", !all.includes("newflow") && !all.includes("test"));
  check("privacy: the rail carries the group's words, so the feedback kit never names it", $(w, "#rail").hasAttribute("data-feedback-private"));
  check("rail: hidden on the cover", $(w, "#rail").hidden);
  check("workshop line: not on the cover", $(w, "#goLink").hidden);

  $(w, "#menuBtn").click(); await sleep(60);
  check("settings: the gear opens Settings, with who's here first", $(w, "#mpanel h4").textContent === "Settings" && $(w, "#mpanel .mlab").textContent === "Who’s here" && $$(w, "#mpanel .mch").length === 8);
  key(w, w.document.body, "Escape"); await sleep(60);

  $(w, "[data-act=begin]").click();
  await at(w, "who", L);
  check("who: solo reads “Working through it at my own pace.”", /Working through it at my own pace\./.test(scene(w).textContent));
  $(w, '[data-v="team-room"]').click();
  await at(w, "plan", L);
  check("who: picking a team moves on by itself", stored(w).mode === "team" && stored(w).place === "room");
  check("plan: one path of six steps, two questions then four actions, each with what it leaves you with", $$(w, ".path6 .pc").length === 6 && $$(w, ".path6 .pc.q").length === 2 && $$(w, ".path6 .pdot").map((n) => n.textContent).join("") === "123456" && /One eye-roller/.test($(w, ".path6").textContent) && /A first test/.test($(w, ".path6").textContent));
  check("plan: about 30 minutes, adding to one card", /About 30 minutes\. Each step adds to one card/.test(scene(w).textContent));
  check("plan: one short line on what to grab, for a room", /^Before you start, grab sticky notes, markers/.test($(w, ".grab").textContent));
  check("plan: the workshop for people new to AI sits in the bottom bar, not on the plan", !$(w, "#goLink").hidden && /New to AI\? Start with Building AI Confidence, an ExperiencePoint workshop/.test($(w, "#goLink").textContent) && !scene(w).querySelector(".go"));
  check("rail: still hidden on the plan, which shows the six steps itself", $(w, "#rail").hidden);
  await next(w); await at(w, "spin", L);
  check("rail: appears with the six steps by name, the first one lit", !$(w, "#rail").hidden && $$(w, "#rail button").length === 6 && railText(w, 1) === "Better way" && railText(w, 6) === "Share it" && $(w, '#rail button[data-ch="1"]').classList.contains("on"));
  check("spin: the step's question heads the screen", /Isn’t there a better way\?/.test($(w, ".scene:last-child .ask").textContent));
  await next(w); await at(w, "b-write", L);
  check("b-write: who does what in plain lines, no numbers", $$(w, ".scene:last-child .who li").length === 3 && /^Alone:/.test($(w, ".who li").textContent) && /one by one, read yours out in one breath/i.test(scene(w).textContent) && !$(w, ".ministeps"));
  check("b-write: the example is in pencil, marked with a small pencil", /For example:/.test($(w, ".scene:last-child .pencil").textContent) && !!$(w, ".scene:last-child .pencil .eg svg.pi"));
  check("timer: 90 seconds to write, with a quiet minus beside the plus", $(w, "[data-timer]").getAttribute("data-sec") === "90" && !!$(w, "[data-timer] [data-act=tminus]") && !!$(w, "[data-timer] [data-act=tplus]"));
  $(w, "[data-timer] [data-act=tgo]").click(); await sleep(80);
  check("timer: starting the think timer opens the big timer", $(w, "#focus").classList.contains("open"));
  $(w, "#focusMinus").click(); await sleep(30);
  check("timer: minus 30 on the big timer takes time off", /^(1:00|0:59|0:58)$/.test($(w, "#focusT").textContent), $(w, "#focusT").textContent);
  key(w, w.document.body, "Escape"); await sleep(80);
  check("timer: Escape closes the big timer", !$(w, "#focus").classList.contains("open"));
  for (let i = 0; i < 4; i++) { $(w, "[data-timer] [data-act=tminus]").click(); await sleep(10); }
  check("timer: never drops below 10 seconds", /^0:(10|09|08)$/.test($(w, "[data-timer] .tt").textContent), $(w, "[data-timer] .tt").textContent);
  await back(w); await at(w, "spin", L);
  check("timer: going back keeps it running, with the small chip", !$(w, "#mini").hidden);
  await next(w); await at(w, "b-write", L);
  await addTo(w, "cands", ["A report no one reads but everyone updates", "The weekly status meeting", XSS, "Approvals that need three signatures for a $40 purchase"]);
  check("b-write: notes go on the wall", stored(w).cands.length === 4, stored(w).cands.length);
  check("privacy: the wall is marked private for the feedback kit", !!$(w, ".wall[data-feedback-private]"));
  check("b-write: typed text is shown as text, never run", !w.__xss && !$(w, ".note img"));
  await next(w); await at(w, "b-vote", L);
  check("timer: moving on past its screen ends it", $(w, "#mini").hidden && !$(w, "[data-timer].running"));
  check("b-vote: the sizing tip stays with the sales report, marked with a light bulb", /Keep it manageable\. The weekly sales report is about right\. The whole sales process is too big\./.test($(w, ".scene:last-child .pencil").textContent) && !!$(w, ".scene:last-child .pencil .eg svg.pi"));
  check("privacy: the vote notes are marked private for the feedback kit", !!$(w, ".vote-grid[data-feedback-private]"));
  check("b-vote: the workshop line sits in the bottom bar, apart from the step", /Take this further in Finding AI Use Cases, an ExperiencePoint workshop/.test($(w, "#goLink").textContent) && !$(w, ".scene:last-child .go") && $(w, "#goLink").getAttribute("target") === "_blank");
  check("b-vote: Next reads Next before any votes", $(w, "#nextBtn").textContent === "Next");
  const nv = (i) => $$(w, ".vnote")[i].click();
  nv(0); nv(0); nv(0); nv(1); nv(2); await sleep(40);
  let c = prim(w);
  check("b-vote: no Reveal button on the page; Next reads Reveal and turns gold", !$(w, ".frame [data-act=reveal]") && c.length === 1 && c[0] === "Reveal" && $(w, "#nextBtn").classList.contains("reveal"), JSON.stringify(c));
  w.__skip(1200); $(w, "#nextBtn").click();
  const win = await until(() => $(w, ".vnote.win"), 6000);
  check("b-vote: Next reveals, and the most votes wins", win && /A report no one reads/.test(win.textContent), win && win.textContent);
  check("rail: the winning eye-roller fills step 1", await until(() => /A report no one reads/.test(railText(w, 1)), 4000), railText(w, 1));
  check("b-vote: after the reveal, the Lab moves on to step 2 by itself", await until(() => cur(w) === "why", 5000), cur(w));

  /* 2. why it exists, then which line is the real purpose */
  check("why: the bridge quotes the group's eye-roller and says what's next", /Now that you’ve picked “A report no one reads but everyone updates”, find its real purpose\./.test(scene(w).textContent));
  check("privacy: the bridge and the chain hold the group's words, so both are marked private", quotesPrivate(w) && !!$(w, ".scene:last-child .sub[data-feedback-private] .own") && !!$(w, ".scene:last-child ol.chain[data-feedback-private]"));
  check("why: the group's eye-roller sits above the chain, with Polish the wording", /A report no one reads/.test($(w, ".eyer .et").textContent) && /Polish the wording/.test($(w, ".eyer summary").textContent));
  check("why: the chain reads like the workbook, top down, with no ladder or rungs", $(w, ".chain .cj").textContent === "We do this in order to…" && $$(w, ".chain .cl").length === 2 && !/rung|ladder|climb/i.test(scene(w).textContent));
  check("why: nothing to pick here, so nothing turns gold; picking comes next", !$(w, ".chain .cpick") && !$(w, ".chint") && !$(w, ".chain .picked"));
  check("why: 1:30, and the next line waits until the last one has words", $(w, "[data-timer]").getAttribute("data-sec") === "90" && $(w, ".cghost").disabled);
  check("why: going too far is a plain tip, nothing crossed out", /Tip: If you reach something like “grow the business,” you’ve gone too far\. Come back down a line\./.test($(w, ".scene:last-child .pencil").textContent) && !$(w, ".scene:last-child .pencil s"));
  type(w, $(w, '[data-bind="why.0"]'), "Show leaders the pipeline every Monday");
  check("why: an empty last line keeps the next one locked", $(w, ".cghost").disabled);
  type(w, $(w, '[data-bind="why.1"]'), "Help leaders see where deals are stuck");
  check("why: filling the last line unlocks the next", !$(w, ".cghost").disabled && /Ask again: in order to\?/.test($(w, ".cghost").textContent));
  check("rail: the last line written fills step 2 as it's written", await until(() => railText(w, 2) === "Help leaders see where deals are stuck", 2000), railText(w, 2));
  const l1 = $(w, '[data-bind="why.1"]'); key(w, l1, "Enter"); await sleep(60);
  check("why: Enter on the last line asks again, and puts you in the new line", stored(w).why.length === 3 && w.document.activeElement === $(w, '[data-bind="why.2"]'));
  type(w, $(w, '[data-bind="why.2"]'), "Grow revenue");
  $$(w, ".chain .rx")[2].click(); await sleep(40);
  check("why: removing a line works and offers undo", stored(w).why.length === 2 && /Line removed/.test($(w, "#toastT").textContent));
  $(w, "#toastA").click(); await sleep(40);
  check("why: undo brings it back", stored(w).why.length === 3 && stored(w).why[2] === "Grow revenue");
  w.document.activeElement.blur();
  await next(w); await at(w, "purpose", L);
  check("purpose: its own screen asks which line is the real purpose", $(w, ".scene:last-child .ask").textContent === "Which line is its real purpose?" && /specific enough to design a better workflow around/.test(scene(w).textContent));
  check("purpose: every line of the chain is a choice, none picked yet", $$(w, ".pc8").length === 3 && !$(w, ".pc8.on") && $(w, ".pchoices").getAttribute("role") === "radiogroup" && $(w, ".pchoices").hasAttribute("data-feedback-private"));
  check("purpose: Next reads Pick one until a line is picked", $(w, "#nextBtn").textContent === "Pick one");
  await next(w); await sleep(60);
  check("purpose: Next can't skip the pick; it nudges", cur(w) === "purpose" && $(w, ".pchoices").classList.contains("nudge") && /Pick the line that’s the real purpose/.test($(w, "#toastT").textContent));
  $$(w, ".pc8")[1].click(); await sleep(40);
  check("purpose: picking a line makes it the real purpose, in gold, and only that one", stored(w).whyPick === 1 && stored(w).purpose === "Help leaders see where deals are stuck" && $$(w, ".pc8.on").length === 1 && $$(w, ".pc8")[1].getAttribute("aria-checked") === "true" && $(w, "#nextBtn").textContent === "Next");
  key(w, $$(w, ".pc8")[1], "ArrowDown"); await sleep(40);
  check("purpose: arrow keys move the pick and stay on the screen", cur(w) === "purpose" && stored(w).whyPick === 2 && $$(w, ".pc8.on").length === 1);
  $$(w, ".pc8")[1].click(); await sleep(40);
  await next(w); await at(w, "ends", L);
  check("rail: step 2 keeps the purpose that was picked", railText(w, 2) === "Help leaders see where deals are stuck");

  /* 3. draw it */
  check("ends: the bridge quotes the real purpose; the step's name and the sizing tip", /Now that you know its real purpose, “Help leaders see where deals are stuck”, draw how the work gets done today\./.test(scene(w).textContent) && $(w, ".scene:last-child .ask").textContent === "Draw it." && /5 to 8 steps/.test($(w, ".scene:last-child .pencil").textContent));
  check("ends: the fields hint at what to write, with no example of their own", $(w, "[data-bind=start]").getAttribute("placeholder") === "the first thing happens" && $(w, "[data-bind=end]").getAttribute("placeholder") === "the last thing happens" && !/proposal/.test(scene(w).innerHTML));
  type(w, $(w, "[data-bind=start]"), "a sales leader asks for the pipeline view.");
  type(w, $(w, "[data-bind=end]"), "the leader decides which deals to step into.");
  w.document.activeElement.blur();
  await next(w); await at(w, "map", L);
  check("map: one verb for the step: draw it, three ways on one screen, sketching first", $(w, ".scene:last-child .ask").textContent === "Draw it your way." && $$(w, ".mode").length === 3 && $(w, '.mode[data-v="sketch"]').getAttribute("aria-checked") === "true");
  check("map: the sketch example folds six boxes and draws one step in each, none left blank", $$(w, ".sheet6 text.lab").length === 6 && /fold a sheet into six boxes/.test(scene(w).textContent) && !$(w, ".sheet8"));
  check("map: each way has its own example panel, captioned in pencil", !!$(w, ".expanel.m-sketch") && /For example: the weekly sales report, sketched\./.test($(w, ".expanel figcaption").textContent));
  check("map: the group's start and end, quoted, with no double full stops", /Start with “a sales leader asks for the pipeline view” and end with “the leader decides which deals to step into”\./.test(scene(w).textContent) && !/\.\./.test($(w, ".scene:last-child .who").textContent), $(w, ".scene:last-child .who").textContent);
  check("map: 2:30 for a team, the same for every way", $(w, "[data-timer]").getAttribute("data-sec") === "150");
  $(w, "[data-timer] [data-act=tgo]").click(); await sleep(60);
  check("map: the timer runs small, so the example and the steps stay in view", !$(w, "#focus").classList.contains("open") && !!$(w, "[data-timer].running"));
  $(w, "[data-timer] [data-act=treset]").click(); await sleep(30);
  $(w, '.mode[data-v="sticky"]').click(); await sleep(40);
  check("map: sticky notes switch the steps and the example, and keep the screen", cur(w) === "map" && $$(w, ".expanel.m-sticky .xn").length === 6 && stored(w).drawMode === "sticky" && $(w, "[data-timer]").getAttribute("data-sec") === "150");
  key(w, $(w, '.mode[data-v="sticky"]'), "ArrowLeft"); await sleep(40);
  check("map: arrow keys move between the ways to draw, and stay on the screen", cur(w) === "map" && stored(w).drawMode === "act" && w.document.activeElement === $(w, '.mode[data-v="act"]'));
  $(w, '.mode[data-v="act"]').click(); await sleep(40);
  check("map: acting it out has its own steps and a drawn example", /Cast it:/.test($(w, ".scene:last-child .who").textContent) && !!$(w, ".expanel.m-act svg.actex") && /passing a real report along/.test($(w, ".expanel figcaption").textContent));
  $(w, '.mode[data-v="sketch"]').click(); await sleep(40);
  await next(w); await at(w, "capture", L);
  check("capture: each step is a frame in the strip, typed in place", !!$(w, ".strip8.edit[data-feedback-private]") && $$(w, ".strip8.edit .sf-in").length === 1 && !!$(w, ".strip8.edit .addf"));
  const steps = ["Export opportunities", "Clean the data in Excel", XSS, "Build 14 slides", "Email the deck", "Walk through every slide", "Leaders ask for the riskiest deals"];
  for (const s of steps) {
    const f = w.document.activeElement && w.document.activeElement.hasAttribute && w.document.activeElement.hasAttribute("data-bstep") ? w.document.activeElement : $$(w, "[data-bstep]").pop();
    type(w, f, s); key(w, f, "Enter"); await sleep(30);
  }
  check("capture: Enter makes the next frame; seven steps saved", stored(w).frames.filter((f) => f.t).length === 7, stored(w).frames.length);
  w.document.activeElement.blur();
  check("capture: an arrow sits between frames in a row, never after the last", $$(w, ".strip8.edit .sf.re").length >= 1 && $$(w, ".strip8.edit .sf:not(.addf)").pop().classList.contains("re"));
  const id2 = stored(w).frames[1].id;
  $(w, `[data-act=sdown][data-id="${id2}"]`).click(); await sleep(60);
  check("capture: a frame moves later and stays lit, with no gold", stored(w).frames[2].id === id2 && $(w, ".sf.moved") && $(w, ".sf.moved").getAttribute("data-fid") === id2);
  $(w, `[data-act=sup][data-id="${id2}"]`).click(); await sleep(60);
  check("capture: and back again", stored(w).frames[1].id === id2 && $$(w, ".sf.moved").length === 1);
  check("capture: the first frame can't move earlier", $(w, ".strip8.edit .sf [data-act=sup]").disabled);
  $(w, ".scene:last-child [data-act=sadd]").click(); await sleep(60);
  check("capture: Add a step puts you in an empty frame, adding one only when none is waiting", stored(w).frames.length === 8 && w.document.activeElement === $$(w, ".sf-in").pop());
  $$(w, ".strip8.edit .sf [data-act=sdel]").pop().click(); await sleep(60);
  check("capture: a frame can be removed, with undo, and the light goes", stored(w).frames.length === 7 && /Step removed/.test($(w, "#toastT").textContent) && !$(w, ".sf.moved"));
  await next(w); await at(w, "judge", L);
  check("rail: step 3 says how many steps were drawn, in words", railText(w, 3) === "Drawn in 7 steps", railText(w, 3));
  check("rail: the landing animation comes off once it has played", await until(() => !$(w, "#rail .land"), 2500));

  /* 4. judge it: a face stamped on each frame */
  check("judge: the bridge asks the workbook's question of each step, against the real purpose", /judge each step against its real purpose, “Help leaders see where deals are stuck”\. Does it help, or get in the way\?/.test(scene(w).textContent));
  check("judge: the strip again, who does what, 1:30", /^Lead:/.test($(w, ".who li").textContent) && $(w, "[data-timer]").getAttribute("data-sec") === "90" && $$(w, ".strip8.judge .sf").length === 7 && $(w, ".strip8.judge").hasAttribute("data-feedback-private"));
  check("judge: the three faces are defined in a tip, from the workbook", /Tip: 😍 it works and is worth protecting\. 😤 it costs effort, delay or repetition\. 🤔 nobody’s sure why it’s there\./.test($(w, ".scene:last-child .pencil").textContent));
  check("judge: one face per frame, chosen like a radio button", $$(w, ".strip8.judge .sf")[0].querySelectorAll("[role=radio]").length === 3);
  const face = (row, k) => $$(w, ".strip8.judge .sf")[row].querySelector(".fb." + k).click();
  face(1, "f"); await sleep(30);
  check("judge: a chosen face is stamped on the frame", !!$$(w, ".strip8.judge .sf")[1].querySelector(".stamp") && $$(w, ".strip8.judge .sf")[1].querySelector(".stamp").textContent === "😤");
  face(3, "c"); await sleep(30); face(5, "f"); await sleep(30); face(0, "d"); await sleep(30);
  face(3, "f"); await sleep(30);
  check("judge: picking another face replaces the first", stored(w).frames[3].r === "f" && stored(w).frames[1].r === "f" && stored(w).frames[0].r === "d");
  face(3, "c"); await sleep(30); face(3, "c"); await sleep(30);
  check("judge: tapping the chosen face again clears it, stamp and all", stored(w).frames[3].r === "" && !$$(w, ".strip8.judge .sf")[3].querySelector(".stamp"));
  face(3, "c"); await sleep(30);
  check("judge: the frame takes the face's tint", $$(w, ".strip8.judge .sf")[3].classList.contains("r-c") && $$(w, ".strip8.judge .sf")[1].classList.contains("r-f"));
  const rowFace = $$(w, ".strip8.judge .sf")[6].querySelector(".fb.d"); rowFace.focus(); key(w, rowFace, "ArrowRight"); await sleep(40);
  check("judge: arrow keys move between the faces on a frame, and stay on the screen", cur(w) === "judge" && stored(w).frames[6].r === "f");
  face(6, "f"); await sleep(30);
  await next(w); await at(w, "inherit", L);
  check("rail: step 4 says what to question, in the group's words", railText(w, 4) === "Question “Clean the data in Excel”", railText(w, 4));
  check("inherit: the bridge names the flagged steps", /Now that you’ve flagged “Clean the data in Excel” and 2 more steps, ask why each one happens/.test(scene(w).textContent));
  check("inherit: a small copy of the strip, with the frames to question lifted out of it", $$(w, ".mstrip .mt").length === 7 && $$(w, ".mstrip .mt.slot").length === 3 && $$(w, ".lifts .lift").length === 3 && /Clean the data in Excel/.test($$(w, ".lift")[0].textContent));
  check("privacy: each why field is named without the step's words, which a screen reader still hears from the card", $$(w, ".lift textarea").length === 3 && $$(w, ".lift textarea").every((t) => { const h = w.document.getElementById(t.getAttribute("aria-describedby")); return t.getAttribute("aria-label") === "Why does it happen?" && !!h && h.closest(".lift") === t.closest(".lift") && h.textContent.trim().length > 0; }));
  check("inherit: 1 minute", $(w, "[data-timer]").getAttribute("data-sec") === "60");
  type(w, $(w, "[data-bwhy]"), "Nobody trusts the export, so we rebuild it");
  $$(w, ".lift")[1].querySelector('[data-v="inh"]').click(); await sleep(40);
  check("inherit: marking a step inherited is saved, and stamps a seal on its frame", stored(w).frames[3].nec === "inh" && $$(w, ".lift")[1].querySelector(".nec .inh").classList.contains("on") && !!$$(w, ".lift")[1].querySelector(".seal.inh"));
  check("rail: an inherited step becomes the one to question first", await until(() => railText(w, 4) === "Question “Build 14 slides”", 2000), railText(w, 4));
  $$(w, ".lift")[1].querySelector('[data-v="need"]').click(); await sleep(40);
  check("inherit: necessary replaces inherited, seal and all", stored(w).frames[3].nec === "need" && !!$$(w, ".lift")[1].querySelector(".seal.need"));
  $$(w, ".lift")[1].querySelector('[data-v="inh"]').click(); await sleep(40);
  w.document.activeElement.blur();
  await next(w); await at(w, "stories", L);

  /* 5. reimagine it */
  check("stories: a captioned player, waiting behind a play button, nothing loaded yet", !!$(w, ".story .st-poster") && $$(w, ".still").length === 14 && w.__audio.length === 0);
  check("stories: the workshop line is in the bottom bar, not under the player", /Driving AI Innovation/.test($(w, "#goLink").textContent) && !$(w, ".storyscreen .go"));
  check("stories: the line under the heading quotes the group's eye-roller", /Before you change “A report no one reads but everyone updates”, see how two organizations changed theirs\./.test(scene(w).textContent));
  $(w, "#soundBtn").click(); await sleep(20);
  $(w, ".st-poster").click(); await sleep(80);
  check("stories: with the sound off, it plays silently with captions and never fetches the voice", $(w, ".story").classList.contains("started") && $(w, ".still.on").getAttribute("data-i") === "0" && /Two stories\./.test($(w, ".st-cap").textContent) && w.__audio.length === 0);
  $(w, '.st-ctl [data-s="next"]').click(); await sleep(60);
  check("stories: Next line moves the still and the caption on", $(w, ".still.on").getAttribute("data-i") === "1" && /Model 3 ramp/.test($(w, ".st-cap").textContent));
  for (let i = 0; i < 12; i++) { $(w, '.st-ctl [data-s="next"]').click(); await sleep(15); }
  check("stories: the last still asks which story sounds like yours", $(w, ".still.on").classList.contains("last") && $$(w, ".spk").length === 2);
  $(w, '.st-ctl [data-s="replay"]').click(); await sleep(60);
  $(w, "#soundBtn").click(); await sleep(40);
  check("stories: turning the sound on mid-story brings the voice in at once", w.__audio.length === 1 && /reimagination-lab\/story\.mp3$/.test(w.__audio[0].src) && w.__audio[0].played === 1);
  $(w, '.st-ctl [data-s="replay"]').click(); await sleep(60);
  check("stories: with the sound on, play asks the voice to start again", w.__audio.length === 1 && w.__audio[0].played === 2);
  check("stories: if the voice can't play, the captions carry on from the same moment", await until(() => $(w, ".story").classList.contains("playing") && $(w, ".still.on").getAttribute("data-i") === "0", 1500));
  $(w, '.st-ctl [data-s="toggle"]').click(); await sleep(30);
  check("stories: pause pauses", $(w, ".story").classList.contains("paused"));
  for (let i = 0; i < 13; i++) { $(w, '.st-ctl [data-s="next"]').click(); await sleep(15); }
  $(w, '.spk[data-id="tesla"]').click(); await sleep(40);
  check("stories: the pick is marked and the other steps back", $(w, '.spk[data-id="tesla"]').classList.contains("sel") && $(w, ".spick").classList.contains("picked") && stored(w).story === "tesla");
  check("stories: then the Lab moves on to the four moves", await until(() => cur(w) === "moves", 5000), cur(w));
  check("moves: four tools, each with the workbook's question", $$(w, ".tools8 .tool").length === 4 && $(w, ".tools8").getAttribute("role") === "radiogroup" && /What should disappear\?/.test($(w, ".tool.t-sub").textContent) && /What is newly possible with AI\?/.test($(w, ".tool.t-inv").textContent));
  check("moves: the story the group picked is the move in hand, and says so", $(w, ".tool.t-sub").getAttribute("aria-checked") === "true" && $(w, ".tool.t-sub").classList.contains("from") && /You said more Tesla, so start here\. Select a step to cut it\./.test($(w, ".armed").textContent) && /Tesla deleted the mats/.test($(w, ".armed .pencil").textContent));
  check("moves: the bridge names what the group questioned", /Now that you’ve questioned “Build 14 slides”, change the work\. Use any of the four moves, in any order\./.test(scene(w).textContent));
  check("moves: today's steps are the frames to change, with what judging found on each", $$(w, ".strip8.moves .sf").length === 7 && $(w, ".strip8.moves").hasAttribute("data-feedback-private") && $$(w, ".strip8.moves .sf")[3].querySelector(".seal.inh") && $$(w, ".strip8.moves .sf")[1].querySelector(".sf-fe").textContent === "😤");
  check("moves: who does what in a line, and a 2:30 think timer that stays small", /Read them out\. The lead uses the moves on the steps\./.test($(w, ".scene:last-child .who1").textContent) && $(w, "[data-timer]").getAttribute("data-sec") === "150" && $(w, "[data-timer]").getAttribute("data-kind") === "think" && $(w, "[data-timer]").getAttribute("data-stay") === "1");
  const frameAt = (i) => $$(w, ".strip8.moves .sf")[i];
  const hit = async (i) => { frameAt(i).querySelector(".sf-hit").click(); await sleep(50); };
  await hit(3);
  check("moves: Subtract cuts a step: it stays as a ghost, with undo", stored(w).flow[3].mv === "sub" && frameAt(3).classList.contains("mv-sub") && /Step cut/.test($(w, "#toastT").textContent) && /^Bring back step 4/.test(frameAt(3).querySelector(".sf-hit").getAttribute("aria-label")));
  await hit(3);
  check("moves: selecting a cut step brings it back", stored(w).flow[3].mv === "");
  await hit(3);
  $(w, ".tool.t-shr").click(); await sleep(40);
  check("moves: picking another tool puts it in hand, with its hint and example", $(w, ".tool.t-shr").getAttribute("aria-checked") === "true" && $(w, ".tool.t-sub").getAttribute("aria-checked") === "false" && /Select a step to shrink it, then say how\. Work like this is often a job for AI\./.test($(w, ".armed").textContent));
  await hit(1);
  check("moves: Shrink marks the step and opens a line to say how, ready to type", stored(w).flow[1].mv === "shr" && w.document.activeElement === $(w, `[data-fhow="${stored(w).flow[1].id}"]`));
  type(w, w.document.activeElement, "Auto-clean the export"); key(w, w.document.activeElement, "Enter"); await sleep(30);
  check("moves: the how is saved, and Enter puts the field away", stored(w).flow[1].how === "Auto-clean the export" && w.document.activeElement.tagName !== "TEXTAREA");
  $(w, ".tool.t-amp").click(); await sleep(40);
  await hit(6);
  type(w, w.document.activeElement, "Leaders spend the call on the riskiest deals"); w.document.activeElement.blur();
  $(w, ".tool.t-inv").click(); await sleep(40);
  check("moves: Invent asks which step the new idea comes after", /Select the step your new idea comes after\./.test($(w, ".armed").textContent));
  await hit(0);
  check("moves: Invent adds a new frame right after the one selected, ready to type", stored(w).flow.length === 8 && stored(w).flow[1].mv === "inv" && !stored(w).flow[1].src && w.document.activeElement === $(w, `[data-ftext="${stored(w).flow[1].id}"]`));
  type(w, w.document.activeElement, "An agent flags stuck deals daily"); w.document.activeElement.blur();
  await hit(5);
  type(w, w.document.activeElement, XSS); w.document.activeElement.blur(); await sleep(30);
  check("moves: typed code in a new step stays text", !w.__xss && !$(w, ".strip8.moves img"));
  $$(w, ".strip8.moves .sf.isnew")[1].querySelector("[data-act=unmove]").click(); await sleep(50);
  check("moves: a new step can be removed, with undo", stored(w).flow.length === 8 && /New step removed/.test($(w, "#toastT").textContent));
  check("moves: each tool counts how often it's been used", $(w, ".tool.t-sub .tn").textContent === "1" && $(w, ".tool.t-inv .tn").textContent === "1" && !$(w, ".tool.t-sub").querySelector(".tn + .tn"));
  key(w, w.document.body, "Escape"); await sleep(40);
  check("moves: Escape puts the tool down", !$(w, ".tool.on") && /Pick a move, then select a step\./.test($(w, ".armed").textContent));
  await hit(0);
  check("moves: with no tool in hand, selecting a step asks for a move first", stored(w).flow[0].mv === "" && /Pick a move first/.test($(w, "#toastT").textContent) && $(w, ".tools8").classList.contains("nudge"));
  const toolKey = $(w, ".tool.t-sub"); toolKey.focus(); key(w, toolKey, "ArrowRight"); await sleep(40);
  check("moves: arrow keys move between the tools, and stay on the screen", cur(w) === "moves" && $(w, ".tool.t-shr").getAttribute("aria-checked") === "true");
  $(w, ".tool.t-shr").click(); await sleep(30);
  check("moves: no vote on ideas, and no separate board of ideas any more", !$(w, ".vote-grid") && !$(w, ".board") && $(w, "#nextBtn").textContent === "Next");
  await back(w); await at(w, "stories", L); await next(w); await at(w, "moves", L);
  check("moves: coming back keeps every change and never copies today's steps in again", stored(w).flow.length === 8 && stored(w).flow.filter((x) => x.mv).length === 4);
  await next(w); await at(w, "share", L);
  check("rail: step 5 says how many steps now, and before", railText(w, 5) === "Now 7 steps, was\u00a07", railText(w, 5));

  /* 6. share it: the change replayed, then who to ask and the first test */
  check("share: the bridge quotes the workflow and says what's next", /Now that you’ve reimagined “A report no one reads but everyone updates”, get feedback from at least three people it affects\. Then pick the smallest piece you could try next week\./.test(scene(w).textContent));
  check("share: today's workflow turns into the new one, as one strip", $$(w, "#replay .rp").length === 8 && $$(w, "#replay .rp.mv-sub").length === 1 && $$(w, "#replay .rp.isnew").length === 1 && $(w, "#replay [data-rn]").textContent.length > 0 && $(w, "#replay").hasAttribute("data-feedback-private"));
  check("share: a changed step shows its new wording", /Auto-clean the export/.test($(w, "#replay").textContent));
  $(w, "[data-act=replay]").click(); await sleep(40);
  check("share: Play it again is there, and with reduced motion it shows the new workflow at once", !!$(w, "#replay [data-act=replay]") && $(w, "#replay").classList.contains("after") && $(w, "#replay [data-rn]").textContent === "7");
  check("share: like, wish and wonder are the tip", /What do you like\? What do you wish\? What do you wonder\?/.test($(w, ".scene:last-child .pencil").textContent));
  check("share: no false ending", !/You reimagined it/.test(HTML));
  check("share: the first test, who to ask, its owner and date", ["ask", "test", "owner", "when"].every((k) => !!$(w, `.scene:last-child [data-bind="${k}"]`)) && !$(w, "[data-bind^=people]"));
  check("share: the last step says Next, since the workshops come before the card", $(w, "#nextBtn").textContent === "Next");
  check("share: Communicating AI Strategy is the workshop line, in the bottom bar", /Take this further in Communicating AI Strategy/.test($(w, "#goLink").textContent));
  type(w, $(w, "[data-bind=ask]"), "Head of sales ops, Priya and Sam");
  type(w, $(w, "[data-bind=test]"), "Send leaders a one-line list of the riskiest deals next Monday");
  type(w, $(w, "[data-bind=owner]"), "Sam"); type(w, $(w, "[data-bind=when]"), "next Monday");
  w.document.activeElement.blur();
  await next(w); await at(w, "workshops", L);
  check("rail: step 6 holds the first test", /^Send leaders a one-line list/.test(railText(w, 6)));
  check("workshops: before the card, the whole path, with “offer”", /This lab is one activity\. Our workshops offer the whole path\./.test($(w, ".pathscreen .ask").textContent) && $$(w, ".phases .ws").length === 4);
  check("workshops: the usage figure matches ExperiencePoint's site, 13% to 59%", /13% to 59%/.test(scene(w).textContent) && !/13% to 60%/.test(HTML));
  check("workshops: Finding AI Use Cases builds on what the group did today", /Builds on what you did today/.test(scene(w).textContent));
  check("workshops: no workshop line in the bar, since the page is the workshops", $(w, "#goLink").hidden);
  check("workshops: Next reads Get your card", $(w, "#nextBtn").textContent === "Get your card");
  await next(w); await at(w, "finish", L);
  check("finish: no timer left running", $(w, "#mini").hidden && !$(w, "#burn i").style.width.replace(/^0(px|%)?$/, ""), $(w, "#burn i").style.width);
  check("finish: all six steps stamped", $$(w, ".stamps i.got").length === 6);
  check("finish: “Save your card”", /Save your card and post it where the team will see it\./.test(scene(w).textContent));
  check("finish: From eye-roll to a better way", $(w, ".finale .hero").textContent === "From eye-roll to a better way.");
  check("finish: ends on the card, with no legal notice on screen", !$(w, ".scene:last-child .legal") && !/proprietary/.test(scene(w).textContent));
  check("finish: the card says real purpose, like every other step", /Real purpose/.test($(w, "#ocard").textContent) && !/Why it exists/.test($(w, "#ocard").textContent) && $(w, "#ocard").hasAttribute("data-feedback-private"));
  check("finish: the buttons come before the card, so nobody scrolls to save", (() => { const ex = $(w, ".exports"), oc = $(w, "#ocard"); return ex && oc && (ex.compareDocumentPosition(oc) & w.Node.DOCUMENT_POSITION_FOLLOWING); })());
  c = prim(w);
  check("finish: one filled button, Save as image", c.length === 1 && c[0] === "Save as image", JSON.stringify(c));
  check("finish: the card lists what changed", /What we changed/.test($(w, "#ocard").textContent) && /New: An agent flags stuck deals daily/.test($(w, "#ocard").textContent) && /Less effort: Auto-clean the export/.test($(w, "#ocard").textContent));
  check("finish: the reimagined strip on the card marks new and changed steps", $$(w, "#ocard .fr.new").length === 1 && $$(w, "#ocard .fr.chg").length === 2 && $$(w, "#ocard .fr.cut").length === 1);
  check("whole session: typed code never ran anywhere", !w.__xss && !w.document.querySelector(".note img, .chip img, .fr img, .vnote img, .ocard img, .lift img, .sf img, .mt img, .st-cap img"));
  check("whole session: no page errors", w.__errors.length === 0, w.__errors.join(" | "));
  const said = SHOWN.join(" ");
  check("whole session: no Goldilocks, no ladder or rungs, no quiz, anywhere on screen", SHOWN.length >= 18 && !/goldilocks|\brungs?\b|ladder|climb the|quiz/i.test(said), SHOWN.length);
  check("whole session: says workflow, never flow on its own", !/(^|[^k])\bflow\b/i.test(said.replace(/workflow/gi, "")));
  check("privacy: every line that quotes the group's words is marked private, on every screen", QUOTED.screens.length >= 7 && QUOTED.bad.length === 0, "quoted on " + QUOTED.screens.join(" ") + "; not private on " + QUOTED.bad.join(" "));

  w.downloads.length = 0;
  $(w, "[data-act=png]").click();
  await until(() => w.downloads.length, 3000);
  check("finish: Save as image downloads the card", w.downloads[0] && w.downloads[0].download === "reimagination-lab.png");
  $(w, "[data-act=print]").click(); await sleep(200);
  const pr = $(w, "#printout").innerHTML;
  check("print: every step, the why chain, faces and inherited", w.__printed === 1 && /Isn’t there a better way\?/.test(pr) && /We do this in order to Show leaders the pipeline/.test(pr) && /😤 frustrated/.test(pr) && /Inherited/.test(pr) && /Share it/.test(pr));
  check("print: leaves room for like, wish, wonder for each person to ask", /What do you like\?/.test(pr) && /What do you wonder\?/.test(pr) && /1\. Head of sales ops/.test(pr) && /2\. Priya/.test(pr) && /3\. Sam/.test(pr));
  check("print: what changed, and the reimagined workflow with its counts", /Cut: Build 14 slides/.test(pr) && /Less effort: Auto-clean the export/.test(pr) && /The reimagined workflow<\/strong> \(1 step gone, 1 new\)/.test(pr));
  check("print: ends with where to take it further, and keeps the copyright on paper", /Take it further:<\/strong> ExperiencePoint’s AI workshops build on what you made today/.test(pr) && /Copyright © ExperiencePoint Inc\. 2026/.test(pr));
  check("print: says workflow, and records the story pick", /The reimagined workflow/.test(pr) && /more Tesla/.test(pr));
  check("print: typed text is escaped", !/<img src=x/.test(pr) && /&lt;img src=x/.test(pr));
  check("print: the other eye-rollers are listed, not the one chosen", /Also suggested: The weekly status meeting/.test(pr) && !/Also suggested:[^<]*A report no one reads/.test(pr));

  const eb = $(w, '[data-act="email"]');
  check("Email this: hidden until the send kit loads", eb && eb.hidden);
  w.eval(fs.readFileSync(path.join(KIT, "send.js"), "utf8"));
  await sleep(30);
  check("Email this: appears when the send kit is ready", !eb.hidden);
  check("Email this: still one filled button on the finish screen", prim(w).length === 1);
  eb.click();
  const sheet = await until(() => { const h = $(w, '[data-epkit="send"]'); return h && h.shadowRoot && h.shadowRoot.querySelector('[data-route="outlook"]') && h.shadowRoot; }, 4000);
  check("Email this: the sheet attaches the outcome card", sheet && /reimagination-lab\.png/.test(sheet.querySelector(".file").textContent));
  w.opened.length = 0; w.downloads.length = 0;
  sheet.querySelector('[data-route="outlook"]').click(); await sleep(30);
  const u = decodeURIComponent(w.opened[0] || "");
  check("Email this: the subject names the workflow", u.includes("subject=Our reimagined workflow: A report no one reads but everyone updates"), u.slice(0, 200));
  check("Email this: the body sums up the session", u.includes("Real purpose: Help leaders see where deals are stuck") && u.includes("Today it takes 7 steps. Reimagined, it takes 7 steps: 1 cut, 2 changed and 1 new.") && u.includes("The reimagined workflow:") && u.includes("What we changed:") && u.includes("First test: Send leaders a one-line list of the riskiest deals next Monday (owner Sam, by next Monday)") && u.includes("Who we’ll ask: Head of sales ops, Priya and Sam"), u.slice(0, 900));
  check("Email this: it ends with where to take it further", u.includes("Take it further: ExperiencePoint’s AI workshops build on what we made today. https://www.experiencepoint.com/ai-training/"));
  const done = Array.from(sheet.querySelectorAll("button")).find((b) => b.textContent === "Done");
  if (done) done.click();
}

/* =================== picking up after a reload, earlier versions, clear with undo =================== */
{
  const saved = w.localStorage.getItem("rlab-v3");
  const w2 = openLab({ "rlab-v3": saved });
  await at(w2, "finish", "reload");
  check("reload: picks up on the finish screen with everything kept, changes included", stored(w2).frames.filter((f) => f.t).length === 7 && stored(w2).flow.filter((x) => x.mv).length === 4);
  $(w2, "#menuBtn").click(); await sleep(60);
  $(w2, "[data-m=clear]").click(); await sleep(200);
  check("menu: Clear my answers clears them", !JSON.parse(w2.localStorage.getItem("rlab-v3") || "{}").eyeroll);
  $(w2, "#toastA").click(); await sleep(200);
  check("menu: Undo brings them back, purpose included", /A report no one reads/.test(stored(w2).eyeroll || "") && stored(w2).purpose === "Help leaders see where deals are stuck");
  check("reload: no page errors", w2.__errors.length === 0, w2.__errors.join(" | "));
  // a session saved by v6: a ladder of rungs, faces counted by hand, and a screen that is gone
  const v6 = { at: "tally", mode: "team", place: "virtual", eyeroll: "The Friday report", ladder: ["Tell leaders what happened", "Help leaders decide where to step in", ""], purpose: "Help leaders decide where to step in",
    frames: [{ id: "a", t: "Pull the numbers", d: 0, f: 3, c: 1, why: "" }, { id: "b", t: "Build the slides", d: 0, f: 0, c: 2, why: "Habit" }, { id: "c", t: "Talk it through", d: 4, f: 0, c: 0, why: "" }] };
  const w3 = openLab({ "rlab-v3": JSON.stringify(v6) });
  check("earlier version: a session left on a screen that is gone picks up where it went", await until(() => cur(w3) === "judge", 3000), cur(w3));
  const s3 = stored(w3);
  check("earlier version: the ladder becomes the why chain and keeps its purpose", s3.why.length === 3 && s3.whyPick === 1 && s3.purpose === "Help leaders decide where to step in", JSON.stringify(s3.why) + " " + s3.whyPick);
  check("earlier version: hand counts become the face most people chose", s3.frames[0].r === "f" && s3.frames[1].r === "c" && s3.frames[2].r === "d" && s3.frames[1].why === "Habit");
  check("earlier version: no page errors", w3.__errors.length === 0, w3.__errors.join(" | "));
  check("earlier version: a story pick saved with v6's votes carries over", stored(openLab({ "rlab-v3": JSON.stringify(Object.assign({}, v6, { picks: { story: "mlb" } })) })).story === "mlb");
  check("earlier version: three people to ask become one line", stored(openLab({ "rlab-v3": JSON.stringify(Object.assign({}, v6, { people: [{ who: "A director" }, { who: "" }, { who: "The coordinator" }] })) })).ask === "A director, The coordinator");
  for (const [old, now] of [["r5", "share"], ["climb", "why"], ["poll", "stories"], ["mv-shr", "moves"], ["gather", "plan"], ["rehearse", "share"], ["test", "share"], ["newflow", "moves"]]) {
    const wx = openLab({ "rlab-v3": JSON.stringify(Object.assign({}, v6, { at: old })) });
    check(`earlier version: ${old} picks up on ${now}`, await until(() => cur(wx) === now, 3000), cur(wx));
  }
  // a session saved by v7: the new workflow was a separate list beside today's
  const v7 = { at: "newflow", mode: "team", place: "room", eyeroll: "The Friday report", why: ["Tell leaders what happened", "Help leaders decide where to step in"], whyPick: 1,
    frames: [{ id: "a", t: "Pull the numbers", r: "f" }, { id: "b", t: "Build the slides", r: "c", nec: "inh" }, { id: "c", t: "Talk it through", r: "d" }],
    newFrames: [{ id: "n1", t: "Pull the numbers" }, { id: "n2", t: "An agent drafts the risks" }, { id: "n3", t: "Talk it through" }], nfSeeded: true };
  const w7 = openLab({ "rlab-v3": JSON.stringify(v7) });
  check("v7: a session on the new-workflow screen picks up on the moves", await until(() => cur(w7) === "moves", 3000), cur(w7));
  const s7 = stored(w7);
  check("v7: steps the new workflow left out become cuts, and its added steps become new ones", s7.flowSeeded === true && s7.flow.length === 4 && s7.flow.filter((x) => x.mv === "sub").map((x) => x.t).join() === "Build the slides" && s7.flow.filter((x) => x.mv === "inv").map((x) => x.t).join() === "An agent drafts the risks", JSON.stringify(s7.flow));
  check("v7: the moves screen shows the carried-over changes", $$(w7, ".strip8.moves .sf.mv-sub").length === 1 && $$(w7, ".strip8.moves .sf.isnew").length === 1);
  check("v7: no page errors", w7.__errors.length === 0, w7.__errors.join(" | "));
  // frames edited after the moves: the changes stay with their steps
  const w8 = openLab({ "rlab-v3": JSON.stringify({ at: "capture", mode: "team", place: "room", eyeroll: "The Friday report", frames: [{ id: "a", t: "Pull the numbers" }, { id: "b", t: "Build the slides" }, { id: "c", t: "Talk it through" }],
    flowSeeded: true, flow: [{ id: "x1", src: "a", t: "Pull the numbers", mv: "shr", how: "Auto-pull" }, { id: "x2", src: "", t: "Flag risks", mv: "inv", how: "" }, { id: "x3", src: "b", t: "Build the slides", mv: "sub", how: "" }, { id: "x4", src: "c", t: "Talk it through", mv: "", how: "" }] }) });
  await at(w8, "capture", "edit after moves");
  type(w8, $$(w8, ".sf-in")[0], "Pull the numbers from the CRM"); w8.document.activeElement.blur();
  $(w8, `[data-act=sdel][data-id="c"]`).click(); await sleep(60);
  $(w8, ".frame [data-act=sadd]").click(); await sleep(60);
  type(w8, w8.document.activeElement, "Send a summary"); w8.document.activeElement.blur();
  await next(w8); await at(w8, "judge", "edit after moves"); await next(w8); await at(w8, "inherit", "edit after moves");
  const f8 = stored(w8).flow;
  check("after the moves: renaming a step keeps its change, a removed step leaves, a new step joins at its place", f8.map((x) => x.t).join("|") === "Pull the numbers from the CRM|Flag risks|Build the slides|Send a summary" && f8[0].mv === "shr" && f8[0].how === "Auto-pull" && f8[1].mv === "inv" && f8[2].mv === "sub" && f8[3].mv === "", f8.map((x) => x.t + ":" + x.mv).join("|"));
  check("after the moves: no page errors", w8.__errors.length === 0, w8.__errors.join(" | "));
  // a tied eye-roller vote waits for the lead to pick, then moves on
  const t = { at: "b-vote", mode: "team", place: "room", cands: [{ id: "k1", t: "The Friday report" }, { id: "k2", t: "Three sign-offs" }, { id: "k3", t: "Copying notes" }], votes: { eyeroll: { k1: 2, k2: 2, k3: 1 } } };
  const w5 = openLab({ "rlab-v3": JSON.stringify(t) });
  await at(w5, "b-vote", "tie");
  check("b-vote tie: Next reads Reveal", $(w5, "#nextBtn").textContent === "Reveal");
  w5.__skip(2000); $(w5, "#nextBtn").click();
  await until(() => $$(w5, ".vnote.tie").length === 2, 6000);
  check("b-vote tie: both finalists wobble and Next reads Pick one", $$(w5, ".vnote.tie").length === 2 && $(w5, "#nextBtn").textContent === "Pick one");
  await sleep(1500);
  check("b-vote tie: nothing moves on until someone picks", cur(w5) === "b-vote");
  w5.__skip(2000); $(w5, "#nextBtn").click(); await sleep(80);
  check("b-vote tie: Next can't skip the pick; it nudges the finalists", cur(w5) === "b-vote" && $$(w5, ".vnote.nudge").length === 2 && /It’s a tie/.test($(w5, "#toastT").textContent));
  $$(w5, ".vnote.tie").find((n) => /Three sign-offs/.test(n.textContent)).click(); await sleep(60);
  check("b-vote tie: the pick becomes the eye-roller", stored(w5).eyeroll === "Three sign-offs");
  check("b-vote tie: then the Lab moves on", await until(() => cur(w5) === "why", 5000), cur(w5));
  check("b-vote tie: no page errors", w5.__errors.length === 0, w5.__errors.join(" | "));
}

/* =================== a solo session, start to finish =================== */
{
  const s = openLab();
  await at(s, "cover", "solo");
  $(s, "[data-act=begin]").click(); await at(s, "who", "solo");
  $(s, "[data-v=solo]").click();
  await until(() => cur(s) !== "who", 3000);
  const seen = [];
  let multi = [], soloMap = "", soloMins = "", timers = [], soloBridge = false, soloType = false, soloSketch = "", soloSeeded = null, soloPick = false, soloCut = false, soloWho = "";
  for (let guard = 0; guard < 40; guard++) {
    const id = cur(s); if (!id) break;
    if (seen.includes(id) && id !== "finish") { check("solo: never stuck", false, "stuck at " + id); break; }
    seen.push(id);
    if ($(s, ".scene:last-child [data-timer]")) timers.push(id);
    if (id === "plan") soloMins = /About 20 minutes/.test(scene(s).textContent) ? "20" : scene(s).textContent.slice(0, 80);
    if (id === "b-solo") { type(s, $(s, '[data-bind="eyeroll"]'), "A meeting that could have been an email."); s.document.activeElement.blur(); }
    if (id === "why") { soloBridge = /Now that you’ve named “A meeting that could have been an email”, find its real purpose\./.test(scene(s).textContent); type(s, $(s, '[data-bind="why.0"]'), "Share updates"); type(s, $(s, '[data-bind="why.1"]'), "Keep everyone on the same priorities"); s.document.activeElement.blur(); }
    if (id === "purpose") { $$(s, ".pc8")[1].click(); await sleep(40); soloPick = stored(s).purpose === "Keep everyone on the same priorities"; }
    if (id === "map") {
      soloType = $$(s, ".mode").length === 4 && $(s, '.mode[data-v="type"]').getAttribute("aria-checked") === "true" && !$(s, ".scene:last-child [data-timer]") && /Type the steps straight in/.test(scene(s).textContent);
      $(s, '.mode[data-v="sketch"]').click(); await sleep(40); soloSketch = $(s, "[data-timer]") ? $(s, "[data-timer]").getAttribute("data-sec") : "";
      $(s, '.mode[data-v="type"]').click(); await sleep(40);
      soloMap = $(s, ".scene:last-child [data-timer]") ? "timer" : "";
    }
    if (id === "capture") { for (const t of ["Book the room", "Read updates aloud", "Notes go out by email"]) { const f = $$(s, "[data-bstep]").pop(); type(s, f, t); key(s, f, "Enter"); await sleep(30); } s.document.activeElement.blur(); }
    if (id === "judge") { $$(s, ".strip8.judge .sf")[1].querySelector(".fb.f").click(); await sleep(30); }
    if (id === "moves") {
      soloSeeded = stored(s).flow; soloWho = ($(s, ".scene:last-child .who1") ? "who1 " : "") + ($(s, ".scene:last-child [data-timer]") ? "timer " : "") + ($(s, ".tool.on") ? "armed " : "") + $(s, ".armed").textContent;
      $(s, ".tool.t-sub").click(); await sleep(30);
      $$(s, ".strip8.moves .sf")[1].querySelector(".sf-hit").click(); await sleep(50);
      soloCut = stored(s).flow[1].mv === "sub";
      $(s, ".tool.t-inv").click(); await sleep(30);
      $$(s, ".strip8.moves .sf")[0].querySelector(".sf-hit").click(); await sleep(50);
      type(s, s.document.activeElement, "A shared doc instead"); s.document.activeElement.blur();
    }
    if (id === "share") { type(s, $(s, "[data-bind=test]"), "Try written updates for two weeks"); s.document.activeElement.blur(); }
    const sc = $$(s, "#stage .scene").length, p = prim(s);
    if (sc !== 1 || p.length > 1) multi.push(id + ":" + sc + ":" + p.join("|"));
    if (id === "finish") break;
    await next(s);
    await until(() => cur(s) !== id, 3000);
  }
  check("solo: reaches the finish screen", seen[seen.length - 1] === "finish", seen.join(" "));
  check("solo: 17 screens with the cover and who's here, and the team-only ones never show", seen.length + 2 === 17 && !seen.some((id) => ["b-write", "b-vote"].includes(id)), seen.join(" "));
  check("solo: about 20 minutes", soloMins === "20", soloMins);
  check("solo: picking the real purpose works the same alone", soloPick);
  check("solo: drawing starts as typing the steps straight in, with no timer", soloType && soloMap === "" && timers.length === 0, timers.join() + " " + soloMap);
  check("solo: sketching instead brings a 2 minute timer", soloSketch === "120", soloSketch);
  check("solo: the moves start from the steps typed in", Array.isArray(soloSeeded) && soloSeeded.length === 3 && soloSeeded[0].t === "Book the room" && soloSeeded.every((x) => !x.mv));
  check("solo: no story picked, so no move is in hand until one is chosen, and no timer or team line", soloCut && /^Pick a move, then select a step\./.test(soloWho), soloWho);
  check("solo: one screen at a time, at most one filled button", multi.length === 0, multi.join(", "));
  check("solo: the bridge says named, not picked", soloBridge);
  check("solo: the eye-roller fills the rail when you move on", stored(s).eyeroll === "A meeting that could have been an email." && /A meeting that could have been an email/.test(railText(s, 1)));
  check("solo: the card says what I changed", /What I changed/.test($(s, "#ocard").textContent) && /New: A shared doc instead/.test($(s, "#ocard").textContent) && /Cut: Read updates aloud/.test($(s, "#ocard").textContent));
  check("solo: the kit hook reports solo", s.EPKit.tool.state().mode === "solo");
  check("solo: no page errors", s.__errors.length === 0, s.__errors.join(" | "));
}

/* =================== two tabs, one saved session =================== */
{
  const mine = JSON.stringify({ at: "judge", mode: "team", place: "room", eyeroll: "The Friday report", frames: [{ id: "a", t: "Pull the numbers" }] });
  const a = openLab({ "rlab-v3": mine });
  await at(a, "judge", "two tabs");
  const theirs = JSON.stringify({ at: "moves", mode: "team", place: "room", eyeroll: "Three sign-offs", frames: [{ id: "b", t: "Ask for approval" }] });
  a.localStorage.setItem("rlab-v3", theirs);
  a.dispatchEvent(new a.Event("pagehide")); a.document.dispatchEvent(new a.Event("visibilitychange"));
  check("two tabs: an idle tab closing never saves its older copy over newer work", a.localStorage.getItem("rlab-v3") === theirs);
  a.dispatchEvent(new a.StorageEvent("storage", { key: "rlab-v3", newValue: theirs }));
  check("two tabs: an idle tab takes the other tab's newer copy", await until(() => cur(a) === "moves", 2000) && /Three sign-offs/.test(a.document.querySelector("#rail").textContent) && /Ask for approval/.test($(a, ".strip8.moves").textContent), cur(a));
  check("two tabs: no page errors", a.__errors.length === 0, a.__errors.join(" | "));
}

/* =================== the feedback board rebuilds a screen =================== */
{
  const BOOT = fs.readFileSync(path.join(KIT, "feedback.js"), "utf8"), REPLAY = fs.readFileSync(path.join(KIT, "feedback-replay.js"), "utf8");
  async function replay(screen, settings) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => { if (!/getContext|Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(HTML, { url: URL0, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, beforeParse: (r) => { prepare(r); r.EPKitReplay = { screen, settings, scroll: 0 }; r.scrollTo = () => {}; } });
    const r = dom.window; let msg = null, map = null;
    r.addEventListener("message", (e) => { if (e.data.type === "epkit-map") map = e.data; else if (e.data.type === "epkit-replay") msg = e.data; });
    await until(() => r.document.readyState === "complete", 3000);
    r.eval(BOOT); r.eval(REPLAY);
    await until(() => msg, 4000);
    return { r, msg, map, errors };
  }
  let x = await replay("inherit", { mode: "team", place: "room" });
  check("replay: the board can open any screen of a team session", cur(x.r) === "inherit" && x.msg && x.msg.ok === true, cur(x.r));
  check("replay: with made-up content, never a real session", /It eats Friday afternoon/.test(x.r.document.querySelector("#stage").innerHTML) && x.r.EPKit.tool.state().place === "room");
  check("replay: the rail shows the made-up story so far", /The weekly status report nobody reads/.test(x.r.document.querySelector("#rail").textContent));
  check("replay: and tells the board the Lab's parts", x.map && x.map.sections.length === 8 && x.map.sections[3].name === "3. Draw it");
  x = await replay("moves", { mode: "team", place: "room" });
  check("replay: the moves screen shows the made-up changes on the strip", cur(x.r) === "moves" && x.r.document.querySelectorAll(".strip8.moves .sf.mv-sub").length === 3 && x.r.document.querySelectorAll(".strip8.moves .sf.isnew").length === 1);
  x = await replay("share", { mode: "team" });
  check("replay: the share screen replays the made-up change", cur(x.r) === "share" && x.r.document.querySelectorAll("#replay .rp").length === 7);
  x = await replay("finish", { mode: "solo" });
  check("replay: a solo finish screen, with the made-up card", cur(x.r) === "finish" && /The weekly status report nobody reads/.test(x.r.document.querySelector("#stage").textContent) && x.r.EPKit.tool.state().mode === "solo");
  x = await replay("stories", { mode: "team" });
  check("replay: the stories screen opens without fetching the voice", cur(x.r) === "stories" && x.r.__audio.length === 0);
  x = await replay("no-such-screen", { mode: "team" });
  check("replay: an unknown screen falls back to the cover and says so", cur(x.r) === "cover" && x.msg.ok === false);
  check("replay: no page errors", x.errors.length === 0, x.errors.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
