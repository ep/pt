// Tests for field-tools/reimagination-lab/index.html (the Reimagination Lab) in a
// simulated browser with jsdom. It walks a whole team session on a call and a whole
// solo session, checks the timers, reveals through Next, escaping, print, the outcome
// image, Email this (with the real send kit from assets/kit/), picking up after a
// reload, and clear with undo.
//   node _backend/tests/qa-reimagination-lab.mjs
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(here, "../../field-tools/reimagination-lab/index.html");
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
  w.downloads = []; w.opened = []; w.__printed = 0;
  w.HTMLAnchorElement.prototype.click = function () { w.downloads.push({ href: this.href, download: this.download }); };
  w.open = (u) => { w.opened.push(u); return null; };
  w.print = () => { w.__printed++; };
  w.URL.createObjectURL = () => "blob:fake"; w.URL.revokeObjectURL = () => {};
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
async function next(w) { w.__skip(2000); $(w, "#nextBtn").click(); await sleep(60); }
async function back(w) { w.__skip(2000); $(w, "#backBtn").click(); await sleep(60); }
async function at(w, id, label) { const ok = await until(() => cur(w) === id, 4000); if (!ok) check(`${label}: reached ${id}`, false, "at " + cur(w)); return ok; }
function type(w, el, v) { el.focus(); el.value = v; el.dispatchEvent(new w.Event("input", { bubbles: true })); }
function key(w, el, k, extra = {}) { el.dispatchEvent(new w.KeyboardEvent("keydown", Object.assign({ key: k, bubbles: true, cancelable: true }, extra))); }
async function addNotes(w, list) { for (const t of list) { const f = $(w, ".scene:last-child .adder .field") || $(w, ".adder .field"); type(w, f, t); key(w, f, "Enter"); await sleep(30); } }
function visibleBtns(w) {
  const scene = $$(w, "#stage .scene").pop();
  const pool = [...scene.querySelectorAll(".btn"), $(w, "#nextBtn"), $(w, "#backBtn")];
  return pool.filter((b) => {
    if (!b || b.disabled) return false;
    for (let n = b; n && n !== w.document.body; n = n.parentElement) {
      if (n.hidden) return false;
      if (n.tagName === "DETAILS" && !n.open && !(b.closest("summary") && n.contains(b.closest("summary")))) return false;
    }
    return true;
  });
}
function screenChecks(w, label) {
  const id = cur(w);
  const prim = visibleBtns(w).filter((b) => !b.classList.contains("sec") && !b.classList.contains("ghost")).map((b) => b.textContent.trim());
  return { id, scenes: $$(w, "#stage .scene").length, prim, xss: w.__xss || 0, imgs: w.document.querySelectorAll(".note img, .fr img, .quote img, .vrow img, .ocard img, .hotc img, .vnote img").length };
}
// The Lab saves a moment after each change, and at once when the tab is hidden or closed.
function stored(w) { w.dispatchEvent(new w.Event("pagehide")); return JSON.parse(w.localStorage.getItem("rlab-v3") || "{}"); }

/* =================== the file itself =================== */
{
  check("page: noindex, like every pt page", /<meta name="robots" content="noindex, nofollow">/.test(HTML));
  check("page: no analytics", !/clarity|googletagmanager|gtag\(/i.test(HTML));
  check("page: no em or en dashes", !/[\u2013\u2014]/.test(HTML));
  check("page: the proprietary notice and copyright", /proprietary ExperiencePoint tool/.test(HTML) && /Copyright &copy; ExperiencePoint Inc\. 2026/.test(HTML));
  check("page: the feedback and Email this kits are one line each", (HTML.match(/<script src="https:\/\/ep\.github\.io\/pt\/assets\/kit\/(feedback|send)\.js" defer><\/script>/g) || []).length === 2);
}

/* =================== a team session on a call =================== */
const w = openLab();
{
  const L = "team";
  await at(w, "cover", L);
  check("start: the cover, with no errors", cur(w) === "cover" && w.__errors.length === 0, w.__errors.join(" | "));
  check("cover: plain words, no “single sitting”", /Bring one workflow that bugs you\.\s*Leave with a better one\./.test($(w, ".cover .sub").textContent) && !/single sitting/.test(HTML));
  const T = w.EPKit && w.EPKit.tool;
  check("kit hook: names the tool, its version and the screen", T && T.id === "reimagination-lab" && T.version === "v6" && T.screen() === "cover" && T.dot === "bottom-center");
  check("kit hook: reports a few settings and the step", T && T.state().mode === "team" && T.state().step === "1 of 48", JSON.stringify(T && T.state()));
  const secs = T && T.sections();
  check("kit hook: names its parts for the board: set up, the six chapters, finish", secs && secs.map((s) => s.name).join("|") === "Set up|1. Better way|2. Why it exists|3. Draw it|4. Judge it|5. Reimagine it|6. Share it|Finish", secs && secs.map((s) => s.name).join("|"));
  const all = secs ? secs.reduce((a, s) => a.concat(s.screens), []) : [];
  check("kit hook: every screen sits in exactly one part, in the Lab's order", all.length === new Set(all).size && all.length === 49 && secs[0].screens[0] === "cover" && secs[1].screens.includes("b-share") && secs[2].screens.includes("ladder") && secs[7].screens.join() === "finish", all.length);
  check("this round: the dial2, dot and break screens are gone", !["dial2", "dot", "brk"].some((id) => all.includes(id)));

  // settings sit behind a gear, with who's here first
  $(w, "#menuBtn").click(); await sleep(60);
  check("settings: the gear opens Settings, with who's here first", $(w, "#menuBtn").getAttribute("aria-label") === "Settings" && $(w, "#mpanel h4").textContent === "Settings" && $(w, "#mpanel .mlab").textContent === "Who’s here" && $$(w, "#mpanel .mch").length === 8);
  key(w, w.document.body, "Escape"); await sleep(60);

  $(w, "[data-act=begin]").click();
  await at(w, "who", L);
  check("who: no extra line under the question", !$(w, ".scene:last-child .frame .sub"));
  $(w, '[data-v="team-room"]').click();
  await at(w, "gather", L);
  check("who: picking a team moves on by itself", cur(w) === "gather" && stored(w).mode === "team" && stored(w).place === "room");
  check("gather: dot stickers are off the list", !/Dot stickers/.test($(w, ".checks").textContent) && /Something to drink/.test($(w, ".checks").textContent));
  const checks = $$(w, ".check");
  checks[0].click(); checks[1].click(); checks[2].click(); await sleep(30);
  check("gather: each item fills in as it's ticked", checks.slice(0, 3).every((c) => c.getAttribute("aria-pressed") === "true") && !$(w, ".checks.all"));
  checks[3].click(); await sleep(60);
  check("gather: the last tick says All set", $(w, ".gath-h").textContent === "All set." && !!$(w, ".checks.all"));
  check("gather: then moves on by itself", await until(() => cur(w) === "roles", 4000));
  check("roles: the lead's line moved to the notes", !$(w, ".scene:last-child .frame .sub") && /You’re the lead/.test($(w, "#drawerBody").textContent));
  await back(w); await at(w, "gather", L);
  $(w, '.check[data-k="r-cup"]').click(); await sleep(30);
  check("gather: unticking one undoes All set", $(w, ".gath-h").textContent === "Grab a few things.");
  await sleep(2100);
  check("gather: and stays put", cur(w) === "gather");
  $(w, '.check[data-k="r-cup"]').click(); await until(() => cur(w) === "roles", 4000);

  // switch to a call for the rest of the session
  $(w, "#menuBtn").click(); await sleep(60);
  $(w, '#mpanel [data-m="who"][data-v="team-virtual"]').click(); await sleep(60);
  key(w, w.document.body, "Escape"); await sleep(60);
  check("settings: switching to a call keeps your place", cur(w) === "roles" && stored(w).place === "virtual");
  await next(w); await at(w, "agenda", L);
  check("agenda: about 45 minutes, no break", $(w, ".total b").getAttribute("data-count") === "45" && !/Break/.test($(w, ".agenda").textContent));
  await next(w); await at(w, "c1", L);
  await next(w); await at(w, "spin", L);
  await next(w); await at(w, "b-think", L);
  check("timer: 90 seconds to write, with a quiet minus beside the plus", $(w, "[data-timer]").getAttribute("data-sec") === "90" && !!$(w, "[data-timer] [data-act=tminus]") && !!$(w, "[data-timer] [data-act=tplus]") && !$(w, ".tline"));
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
  await next(w); await at(w, "b-think", L);
  await next(w); await at(w, "b-share", L);
  check("timer: moving on past its screen ends it", $(w, "#mini").hidden && !$(w, "[data-timer].running"));
  check("b-share: 90 seconds for the round", $(w, "[data-timer]").getAttribute("data-sec") === "90");
  await addNotes(w, ["A report no one reads but everyone updates", "The weekly status meeting", XSS, "Approvals that need three signatures for a $40 purchase"]);
  check("b-share: notes go on the wall", stored(w).cands.length === 4, stored(w).cands.length);
  check("b-share: typed text is shown as text, never run", !w.__xss && !$(w, ".note img"));
  await next(w); await at(w, "dial1", L);
  check("dial: the size example reads as a note, colored by its zone", /dial-note z0/.test($(w, ".dial-note").className) && /performance-management/.test($(w, ".dial-note").textContent));
  const rng = $(w, ".dial input[type=range]"); rng.value = "50"; rng.dispatchEvent(new w.Event("input", { bubbles: true })); await sleep(20);
  check("dial: just right turns the note gold", /z1/.test($(w, ".dial-note").className) && /quarterly performance review/.test($(w, ".dial-note").textContent));
  await next(w); await at(w, "b-vote", L);
  check("b-vote: Next reads Next before any votes", $(w, "#nextBtn").textContent === "Next");
  const nv = (i) => $$(w, ".vnote")[i].click();
  nv(0); nv(0); nv(0); nv(1); nv(2); await sleep(40);
  let c = screenChecks(w);
  check("b-vote: no Reveal button on the page; Next reads Reveal and turns gold", !$(w, ".frame [data-act=reveal]") && c.prim.length === 1 && c.prim[0] === "Reveal" && $(w, "#nextBtn").classList.contains("reveal"), JSON.stringify(c.prim));
  w.__skip(1200); $(w, "#nextBtn").click();
  const win = await until(() => $(w, ".vnote.win"), 6000);
  check("b-vote: Next reveals, and the most votes wins", win && /A report no one reads/.test(win.textContent), win && win.textContent);
  check("b-vote: after the reveal, the Lab moves on by itself", await until(() => cur(w) === "r1", 5000), cur(w));
  check("r1: the group's own words come back", /A report no one reads/.test($(w, ".quote").textContent));
  await next(w); await at(w, "c2", L);
  await next(w); await at(w, "quiz", L);
  check("quiz: the middle option fits on one line like the others", $$(w, ".qopt .qt")[1].textContent === "Help sales leaders spot stuck deals and act early");
  $(w, "[data-v=ok]").click(); await sleep(40);
  await next(w); await at(w, "climb", L);
  check("climb: one centered example ladder, the top rung too far, no timer", $$(w, ".exl li").length === 7 && !!$(w, ".exl li.too .toofar") && !$(w, ".scene:last-child [data-timer]") && !$(w, ".scene:last-child .split"));
  await next(w); await at(w, "ladder", L);
  check("ladder: 2 minutes, and the next rung waits until the top one has words", $(w, "[data-timer]").getAttribute("data-sec") === "120" && $(w, ".rung.ghost").disabled);
  type(w, $(w, '[data-bind="ladder.0"]'), "Show leaders the pipeline every Monday");
  check("ladder: an empty top rung keeps it locked", $(w, ".rung.ghost").disabled);
  type(w, $(w, '[data-bind="ladder.1"]'), "Help leaders see where deals are stuck");
  check("ladder: filling the top rung unlocks the next", !$(w, ".rung.ghost").disabled && /Climb another rung/.test($(w, ".rung.ghost").textContent));
  $(w, ".rung.ghost").click(); await sleep(40);
  check("ladder: climbing adds a rung and puts you in it", stored(w).ladder.length === 3 && w.document.activeElement === $(w, '[data-bind="ladder.2"]') && $(w, ".rung.ghost").disabled);
  type(w, $(w, '[data-bind="ladder.2"]'), "Grow revenue");
  check("ladder: three rungs saved", stored(w).ladder.filter(Boolean).length === 3, JSON.stringify(stored(w).ladder));
  w.document.activeElement.blur();
  await next(w); await at(w, "pick", L);
  const vp = (i) => $$(w, ".vrow [data-act=vplus]")[i].click();
  vp(1); vp(0);
  check("pick: Next reads Reveal once votes are in", $(w, "#nextBtn").textContent === "Reveal");
  w.__skip(1200); $(w, "#nextBtn").click();
  await until(() => $$(w, ".vrow.tie").length === 2, 6000);
  check("pick: a tie asks for a pick and waits", $$(w, ".vrow.tie").length === 2 && /tie/.test($(w, ".vmsg").textContent) && $(w, "#nextBtn").textContent === "Next");
  await sleep(1200);
  check("pick: and does not move on by itself", cur(w) === "pick");
  $$(w, ".vrow.tie").find((r) => /where deals are stuck/.test(r.textContent)).click(); await sleep(60);
  check("pick: tapping a finalist settles it", /where deals are stuck/.test(stored(w).purpose), stored(w).purpose);
  check("pick: then the Lab moves on", await until(() => cur(w) === "r2", 5000), cur(w));
  await next(w); await at(w, "c3", L);
  await next(w); await at(w, "ends", L);
  check("ends: the sizing hint lives here now", /4 to 8 steps/.test($(w, ".scene:last-child .sub").textContent));
  type(w, $(w, "[data-bind=start]"), "a sales leader asks for the pipeline view");
  type(w, $(w, "[data-bind=end]"), "the leader decides which deals to step into");
  w.document.activeElement.blur();
  await next(w); await at(w, "mode", L);
  $(w, "[data-v=sketch]").click();
  await at(w, "make", L);
  check("make: 4 minutes, who does what, and four drawn frames as the example", $(w, "[data-timer]").getAttribute("data-sec") === "240" && $$(w, ".ministeps.who li").length === 3 && /Everyone:/.test($(w, ".ministeps").textContent) && $$(w, ".story4 figure").length === 4);
  await back(w); await at(w, "mode", L);
  $(w, "[data-v=act]").click(); await at(w, "make", L);
  const actSec = $(w, "[data-timer]").getAttribute("data-sec");
  check("make: acting it out gets the same time, and a five-step example on one row", actSec === "240" && $$(w, ".strip.ex .fr").length === 5, actSec);
  await back(w); await at(w, "mode", L);
  $(w, "[data-v=sketch]").click(); await at(w, "make", L);
  await next(w); await at(w, "capture", L);
  const steps = ["Export opportunities", "Clean the data in Excel", XSS, "Build 14 slides", "Email the deck", "Walk through every slide", "Leaders ask for the riskiest deals"];
  for (const s of steps) {
    const f = w.document.activeElement && w.document.activeElement.hasAttribute && w.document.activeElement.hasAttribute("data-bstep") ? w.document.activeElement : $$(w, "[data-bstep]").pop();
    type(w, f, s); key(w, f, "Enter"); await sleep(30);
  }
  check("capture: seven steps saved", stored(w).frames.filter((f) => f.t).length === 7, stored(w).frames.length);
  w.document.activeElement.blur();
  const id2 = stored(w).frames[1].id;
  $(w, `[data-act=sdown][data-id="${id2}"]`).click(); await sleep(60);
  check("capture: a moved step stays lit", stored(w).frames[2].id === id2 && $(w, ".step.moved") && $(w, ".step.moved").getAttribute("data-fid") === id2);
  $(w, `[data-act=sup][data-id="${id2}"]`).click(); await sleep(60);
  check("capture: moving it again keeps it lit", stored(w).frames[1].id === id2 && $$(w, ".step.moved").length === 1);
  $$(w, "[data-bstep]")[4].focus(); await sleep(30);
  check("capture: tapping into another step moves the light there", $$(w, ".step.moved").length === 1 && $(w, ".step.moved").getAttribute("data-fid") === stored(w).frames[4].id);
  $(w, ".frame [data-act=sadd]").click(); await sleep(60);
  check("capture: adding a step moves the light to the new one", $$(w, ".step.moved").length === 1 && $(w, ".step.moved").getAttribute("data-fid") === stored(w).frames[stored(w).frames.length - 1].id);
  $(w, ".step:last-child [data-act=sdel]").click(); await sleep(60);
  check("capture: doing something else clears it", !$(w, ".step.moved"));
  w.document.activeElement.blur();
  await next(w); await at(w, "r3", L);
  check("r3: no photo, no print frame", !$(w, ".polaroid"));
  check("r3: seven steps sit in two even rows, at most six to a row", /--per:4;--perm:3/.test($(w, ".strip.bal").getAttribute("style")));
  await next(w); await at(w, "c4", L);
  await next(w); await at(w, "lenses", L);
  await next(w); await at(w, "tally", L);
  check("judge: one screen, who does what, a 2:30 timer and the steps to count", $$(w, ".ministeps.who li").length === 3 && /Lead:/.test($(w, ".ministeps").textContent) && $(w, "[data-timer]").getAttribute("data-sec") === "150" && $$(w, ".jrow").length === 7 && !/sticker/i.test($(w, ".scene:last-child").textContent));
  const tap = (row, k, n) => { for (let i = 0; i < n; i++) $$(w, ".jrow")[row].querySelector(".jb." + k).click(); };
  tap(1, "f", 4); tap(3, "c", 3); tap(5, "f", 2); tap(0, "d", 1);
  check("judge: reactions are counted per step", stored(w).frames[1].f === 4 && stored(w).frames[3].c === 3);
  await next(w); await at(w, "hot", L);
  check("hot: the three hottest steps get a why card, 2 minutes", $$(w, "[data-bwhy]").length === 3 && $(w, "[data-timer]").getAttribute("data-sec") === "120", $$(w, "[data-bwhy]").length);
  type(w, $(w, "[data-bwhy]"), "Nobody trusts the export, so we rebuild it");
  w.document.activeElement.blur();
  await next(w); await at(w, "r4", L);
  await next(w); await at(w, "stories", L);
  await next(w); await at(w, "tesla", L);
  check("tesla: the film is on the page", !!$(w, ".film") && !!$(w, ".film .poster") && /About a minute/.test($(w, ".film .poster").textContent));
  await next(w); await at(w, "mlb", L);
  await next(w); await at(w, "poll", L);
  $$(w, "[data-act=pplus]")[0].click(); $$(w, "[data-act=pplus]")[0].click(); $$(w, "[data-act=pplus]")[1].click(); await sleep(30);
  check("poll: Next reads Reveal once hands are counted", $(w, "#nextBtn").textContent === "Reveal" && !$(w, ".frame [data-act=reveal]"));
  w.__skip(1200); $(w, "#nextBtn").click();
  await until(() => stored(w).revealed && stored(w).revealed.story, 6000);
  check("poll: Next shows the split", !!$(w, ".dv") && stored(w).revealed.story === true);
  check("poll: then moves on to chapter 5", await until(() => cur(w) === "c5", 6000), cur(w));
  check("c5: the bigger entrance", $$(w, "#stage .scene").pop().classList.contains("grand"));
  await next(w); await at(w, "moves", L);
  await next(w); await at(w, "mv-sub", L);
  check("moves: one minute each, with who does what", $(w, "[data-timer]").getAttribute("data-sec") === "60" && $$(w, ".ministeps.who li").length === 3 && /Together:/.test($(w, ".ministeps").textContent));
  await addNotes(w, ["Drop the 14 slides", "Stop the Monday walkthrough"]);
  await next(w); await at(w, "mv-shr", L); await addNotes(w, ["Auto-clean the export"]);
  await next(w); await at(w, "mv-amp", L); await addNotes(w, ["More time on the riskiest deals"]);
  await next(w); await at(w, "mv-inv", L); await addNotes(w, ["An agent flags stuck deals daily", XSS]);
  check("moves: ideas saved under each move", stored(w).ideas.sub.length === 2 && stored(w).ideas.inv.length === 2);
  await next(w); await at(w, "ideas", L);
  const ni = (i) => $$(w, ".vnote")[i].click();
  ni(0); ni(0); ni(3); ni(4); ni(4);
  c = screenChecks(w);
  check("ideas: Next reads Reveal; no other filled button", c.prim.length === 1 && c.prim[0] === "Reveal", JSON.stringify(c.prim));
  w.__skip(1200); $(w, "#nextBtn").click();
  await until(() => stored(w).revealed && stored(w).revealed.ideas, 6000);
  check("ideas: Next reveals what made the cut", $$(w, ".vnote.kept").length === 3);
  check("ideas: then moves on by itself", await until(() => cur(w) === "newflow", 6000), cur(w));
  check("newflow: 3 minutes", $(w, "[data-timer]").getAttribute("data-sec") === "180");
  $$(w, ".carry button[data-act=carry]")[0].click(); await sleep(30);
  $$(w, ".carry button[data-act=carryidea]")[0].click(); await sleep(30);
  check("newflow: today's steps and kept ideas carry into the new flow", stored(w).newFrames.length === 2, stored(w).newFrames.length);
  const nf0 = stored(w).newFrames[0].id;
  $(w, `[data-act=sdown][data-id="${nf0}"]`).click(); await sleep(60);
  check("newflow: the moved step stays lit", $(w, ".step.moved") && $(w, ".step.moved").getAttribute("data-fid") === nf0 && stored(w).newFrames[1].id === nf0);
  await next(w); await at(w, "r5", L);
  check("r5: before and after, with the new steps marked", $$(w, "#baNew .fr").length === 2 && $$(w, "#baNew .fr.new").length === 1);
  await next(w); await at(w, "c6", L);
  await next(w); await at(w, "lww", L);
  await next(w); await at(w, "people", L);
  type(w, $(w, '[data-bind="people.0.who"]'), "Head of sales ops");
  w.document.activeElement.blur();
  await next(w); await at(w, "rehearse", L);
  check("rehearse: 2 minutes", $(w, "[data-timer]").getAttribute("data-sec") === "120");
  $(w, "[data-timer] [data-act=tgo]").click(); await sleep(40);
  await next(w); await at(w, "test", L);
  check("test: the last step says Finish", $(w, "#nextBtn").textContent === "Finish");
  type(w, $(w, "[data-bind=test]"), "Send leaders a one-line list of the riskiest deals next Monday");
  type(w, $(w, "[data-bind=owner]"), "Sam"); type(w, $(w, "[data-bind=when]"), "next Monday");
  w.document.activeElement.blur();
  await next(w); await at(w, "finish", L);
  check("finish: no timer left running", $(w, "#mini").hidden && !$(w, "#burn i").style.width.replace(/^0(px|%)?$/, ""), $(w, "#burn i").style.width);
  check("finish: all six chapter stamps", $$(w, ".stamps i.got").length === 6);
  check("finish: four workshop cards on one aligned track", $$(w, ".phases .ws").length === 4 && $$(w, ".phases .phase").length === 3 && ["c1", "c2", "c3", "c4"].every((k) => $(w, ".phases .ws." + k)) && !$(w, ".ws-row"));
  c = screenChecks(w);
  check("finish: one filled button, Save as image", c.prim.length === 1 && c.prim[0] === "Save as image", JSON.stringify(c.prim));
  check("whole session: typed code never ran anywhere", !w.__xss && !c.imgs);
  check("whole session: no page errors", w.__errors.length === 0, w.__errors.join(" | "));

  // Outcome image and print
  w.downloads.length = 0;
  $(w, "[data-act=png]").click();
  await until(() => w.downloads.length, 3000);
  check("finish: Save as image downloads the card", w.downloads[0] && w.downloads[0].download === "reimagination-lab.png");
  $(w, "[data-act=print]").click(); await sleep(200);
  const pr = $(w, "#printout").innerHTML;
  check("print: opens the print dialog with every chapter", w.__printed === 1 && /Isn’t there a better way\?/.test(pr) && /Share it/.test(pr));
  check("print: leaves room for like, wish, wonder", /I wonder/.test(pr));
  check("print: typed text is escaped", !/<img src=x/.test(pr) && /&lt;img src=x/.test(pr));

  // Email this appears only once the send kit is there, then sends a useful summary
  const eb = $(w, '[data-act="email"]');
  check("Email this: hidden until the send kit loads", eb && eb.hidden);
  w.eval(fs.readFileSync(path.join(KIT, "send.js"), "utf8"));
  await sleep(30);
  check("Email this: appears when the send kit is ready", !eb.hidden);
  c = screenChecks(w);
  check("Email this: still one filled button on the finish screen", c.prim.length === 1, JSON.stringify(c.prim));
  eb.click();
  const sheet = await until(() => { const h = $(w, '[data-epkit="send"]'); return h && h.shadowRoot && h.shadowRoot.querySelector('[data-route="outlook"]') && h.shadowRoot; }, 4000);
  check("Email this: the sheet attaches the outcome card", sheet && /reimagination-lab\.png/.test(sheet.querySelector(".file").textContent));
  w.opened.length = 0; w.downloads.length = 0;
  sheet.querySelector('[data-route="outlook"]').click(); await sleep(30);
  const u = decodeURIComponent(w.opened[0] || "");
  check("Email this: the subject names the workflow", u.includes("subject=Our reimagined workflow: A report no one reads but everyone updates"), u.slice(0, 200));
  check("Email this: the body sums up the session", u.includes("Why it exists: Help leaders see where deals are stuck") && u.includes("The reimagined flow:") && u.includes("First test: Send leaders a one-line list of the riskiest deals next Monday (owner Sam, by next Monday)"), u.slice(0, 600));
  check("Email this: the card downloads to attach", w.downloads.some((d) => d.download === "reimagination-lab.png"));
  const done = Array.from(sheet.querySelectorAll("button")).find((b) => b.textContent === "Done");
  if (done) done.click();
}

/* =================== picking up after a reload, and clear with undo =================== */
{
  const saved = w.localStorage.getItem("rlab-v3");
  const w2 = openLab({ "rlab-v3": saved });
  await at(w2, "finish", "reload");
  check("reload: picks up on the finish screen with everything kept", cur(w2) === "finish" && JSON.parse(w2.localStorage.getItem("rlab-v3")).frames.filter((f) => f.t).length === 7);
  $(w2, "#menuBtn").click(); await sleep(60);
  $(w2, "[data-m=clear]").click(); await sleep(200);
  check("menu: Clear my answers clears them", !JSON.parse(w2.localStorage.getItem("rlab-v3") || "{}").eyeroll);
  $(w2, "#toastA").click(); await sleep(200);
  check("menu: Undo brings them back", /A report no one reads/.test(JSON.parse(w2.localStorage.getItem("rlab-v3") || "{}").eyeroll || ""));
  check("reload: no page errors", w2.__errors.length === 0, w2.__errors.join(" | "));
  const o = JSON.parse(saved); o.at = "dot";
  const w3 = openLab({ "rlab-v3": JSON.stringify(o) });
  check("reload: a session left on a screen that is gone picks up where it went", await until(() => cur(w3) === "tally", 3000), cur(w3));
  o.at = "r3"; o.photoOld = "data:image/png;base64,iVBORw0KGgo=";
  const w4 = openLab({ "rlab-v3": JSON.stringify(o) });
  await at(w4, "r3", "reload");
  check("r3: shows the group's photo as a print", !!$(w4, ".polaroid img") && $(w4, ".polaroid img").getAttribute("src") === o.photoOld);
  check("reload: no page errors on either", w3.__errors.length === 0 && w4.__errors.length === 0, w3.__errors.concat(w4.__errors).join(" | "));
  // a tied eye-roller vote waits for the lead to pick, then moves on
  const t = { at: "b-vote", mode: "team", place: "room", cands: [{ id: "k1", t: "The Friday report" }, { id: "k2", t: "Three sign-offs" }, { id: "k3", t: "Copying notes" }], votes: { eyeroll: { k1: 2, k2: 2, k3: 1 } } };
  const w5 = openLab({ "rlab-v3": JSON.stringify(t) });
  await at(w5, "b-vote", "tie");
  check("b-vote tie: Next reads Reveal", $(w5, "#nextBtn").textContent === "Reveal");
  w5.__skip(2000); $(w5, "#nextBtn").click();
  await until(() => $$(w5, ".vnote.tie").length === 2, 6000);
  check("b-vote tie: both finalists wobble and Next goes back to Next", $$(w5, ".vnote.tie").length === 2 && $(w5, "#nextBtn").textContent === "Next");
  await sleep(1500);
  check("b-vote tie: nothing moves on until someone picks", cur(w5) === "b-vote");
  $$(w5, ".vnote.tie").find((n) => /Three sign-offs/.test(n.textContent)).click(); await sleep(60);
  check("b-vote tie: the pick becomes the eye-roller", stored(w5).eyeroll === "Three sign-offs");
  check("b-vote tie: then the Lab moves on", await until(() => cur(w5) === "r1", 5000), cur(w5));
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
  let multi = [], soloMake = "", soloMins = "";
  for (let guard = 0; guard < 60; guard++) {
    const id = cur(s); if (!id) break;
    if (seen.includes(id) && id !== "finish") { check("solo: never stuck", false, "stuck at " + id); break; }
    seen.push(id);
    if (id === "b-solo") { type(s, $(s, "textarea.big, input.big"), "A meeting that could have been an email"); s.document.activeElement.blur(); }
    if (id === "ladder") { type(s, $(s, '[data-bind="ladder.0"]'), "Share updates"); type(s, $(s, '[data-bind="ladder.1"]'), "Keep everyone on the same priorities"); s.document.activeElement.blur(); }
    if (id === "pick") { $$(s, ".vrow.pick")[0].click(); await sleep(60); }
    if (id === "mode") { $(s, "[data-v=sticky]").click(); await until(() => cur(s) !== "mode", 3000); continue; }
    if (id === "make") { soloMake = $(s, "[data-timer]").getAttribute("data-sec") + ":" + $$(s, ".strip.ex .fr").length; }
    if (id === "agenda") { soloMins = $(s, ".total b").getAttribute("data-count"); }
    if (id === "capture") { for (const t of ["Book the room", "Read updates aloud", "Notes go out by email"]) { const f = $$(s, "[data-bstep]").pop(); type(s, f, t); key(s, f, "Enter"); await sleep(30); } s.document.activeElement.blur(); }
    if (id && id.indexOf("mv-") === 0) await addNotes(s, ["Idea for " + id]);
    if (id === "test") { type(s, $(s, "[data-bind=test]"), "Try written updates for two weeks"); s.document.activeElement.blur(); }
    const sc = screenChecks(s);
    if (sc.scenes !== 1 || sc.prim.length > 1) multi.push(id + ":" + sc.scenes + ":" + sc.prim.join("|"));
    if (id === "finish") break;
    await next(s);
    await until(() => cur(s) !== id, 3000);
  }
  check("solo: reaches the finish screen", seen[seen.length - 1] === "finish", seen.join(" "));
  check("solo: team-only screens never show", !seen.some((id) => ["roles", "b-think", "b-share", "b-vote", "rehearse"].includes(id)), seen.join(" "));
  check("solo: about 30 minutes", soloMins === "30", soloMins);
  check("solo: 3 minutes to map, with a five-step example", soloMake === "180:5", soloMake);
  check("solo: one screen at a time, at most one filled button", multi.length === 0, multi.join(", "));
  check("solo: the kit hook reports solo", s.EPKit.tool.state().mode === "solo");
  check("solo: no page errors", s.__errors.length === 0, s.__errors.join(" | "));
}

/* =================== solo picks respond plainly =================== */
{
  const st = { at: "poll", mode: "solo", place: "virtual", theme: "light", ideas: { sub: [{ id: "a1", t: "Drop the report" }], shr: [], amp: [{ id: "a2", t: "This matters" }], inv: [{ id: "a3", t: "A new check-in" }] }, ladder: ["Share updates", "Keep priorities straight"] };
  const s2 = openLab({ "rlab-v3": JSON.stringify(st) });
  await at(s2, "poll", "solo picks");
  $(s2, ".side.L").click(); await sleep(40);
  check("solo poll: the pick is marked and the other side steps back", $(s2, ".side.L").classList.contains("sel") && $(s2, ".duo").classList.contains("picked") && stored(s2).picks.story === "tesla");
  $(s2, ".side.R").click(); await sleep(40);
  check("solo poll: tapping the other side changes the pick", $(s2, ".side.R").classList.contains("sel") && !$(s2, ".side.L").classList.contains("sel") && stored(s2).picks.story === "mlb");
  check("solo poll: then the Lab moves on by itself", await until(() => cur(s2) === "c5", 5000), cur(s2));
  const o2 = Object.assign({}, st, { at: "ideas" });
  const s3 = openLab({ "rlab-v3": JSON.stringify(o2) });
  await at(s3, "ideas", "solo picks");
  const note = () => $$(s3, ".vnote").find((n) => /This matters/.test(n.textContent));
  note().click(); await sleep(30);
  check("solo ideas: a tap keeps an idea", note().classList.contains("kept") && note().getAttribute("aria-pressed") === "true" && stored(s3).votes.ideas.a2 === 1);
  note().click(); await sleep(30);
  check("solo ideas: a second tap lets it go", !note().classList.contains("kept") && !stored(s3).votes.ideas.a2);
  check("solo ideas: no moving on while choosing", cur(s3) === "ideas");
  const o3 = Object.assign({}, st, { at: "pick" });
  const s4 = openLab({ "rlab-v3": JSON.stringify(o3) });
  await at(s4, "pick", "solo picks");
  $$(s4, ".vrow.pick")[0].click(); await sleep(40);
  check("solo rung: the pick becomes the purpose, then the Lab moves on", stored(s4).purpose === "Keep priorities straight" && await until(() => cur(s4) === "r2", 5000), cur(s4));
  check("solo picks: no page errors", [s2, s3, s4].every((x) => x.__errors.length === 0), [s2, s3, s4].map((x) => x.__errors.join(" | ")).join(" / "));
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
  let x = await replay("hot", { mode: "team", place: "room" });
  check("replay: the board can open any screen of a team session", cur(x.r) === "hot" && x.msg && x.msg.ok === true, cur(x.r));
  check("replay: with made-up content, never a real session", /It eats Friday afternoon/.test(x.r.document.querySelector("#stage").innerHTML) && x.r.EPKit.tool.state().place === "room");
  check("replay: the frame says it is ready", x.msg.type === "epkit-replay");
  check("replay: and tells the board the Lab's parts", x.map && x.map.sections.length === 8 && x.map.sections[3].name === "3. Draw it");
  x = await replay("finish", { mode: "solo" });
  check("replay: a solo finish screen, with the made-up card", cur(x.r) === "finish" && /The weekly status report nobody reads/.test(x.r.document.querySelector("#stage").textContent) && x.r.EPKit.tool.state().mode === "solo");
  x = await replay("no-such-screen", { mode: "team" });
  check("replay: an unknown screen falls back to the cover and says so", cur(x.r) === "cover" && x.msg.ok === false);
  check("replay: no page errors", x.errors.length === 0, x.errors.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
