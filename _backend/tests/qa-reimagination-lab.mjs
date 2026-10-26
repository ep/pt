// Tests for field-tools/reimagination-lab/index.html (the Reimagination Lab) in a
// simulated browser with jsdom. It walks a whole team session on a call and a whole
// solo session, checks escaping, print, the outcome image, Email this (with the real
// send kit from assets/kit/), picking up after a reload, and clear with undo.
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
async function next(w) { w.__skip(1200); $(w, "#nextBtn").click(); await sleep(60); }
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
  const T = w.EPKit && w.EPKit.tool;
  check("kit hook: names the tool and the screen", T && T.id === "reimagination-lab" && T.screen() === "cover" && T.dot === "bottom-center");
  check("kit hook: reports a few settings and the step", T && T.state().mode === "team" && T.state().step === "1 of 51", JSON.stringify(T && T.state()));
  $(w, "[data-act=begin]").click();
  await at(w, "who", L);
  $(w, '[data-v="team-virtual"]').click();
  await at(w, "gather", L);
  check("who: picking team on a call moves on by itself", cur(w) === "gather" && stored(w).mode === "team" && stored(w).place === "virtual");
  $$(w, ".check")[0].click();
  await next(w); await at(w, "roles", L);
  await next(w); await at(w, "agenda", L);
  await next(w); await at(w, "c1", L);
  await next(w); await at(w, "spin", L);
  await next(w); await at(w, "b-think", L);
  $(w, "[data-timer] [data-act=tgo]").click(); await sleep(80);
  check("timer: starting the think timer opens the big timer", $(w, "#focus").classList.contains("open"));
  key(w, w.document.body, "Escape"); await sleep(80);
  check("timer: Escape closes the big timer", !$(w, "#focus").classList.contains("open"));
  await next(w); await at(w, "b-share", L);
  check("timer: the small chip shows once you leave a running timer", !$(w, "#mini").hidden);
  await addNotes(w, ["A report no one reads but everyone updates", "The weekly status meeting", XSS, "Approvals that need three signatures for a $40 purchase"]);
  check("b-share: notes go on the wall", stored(w).cands.length === 4, stored(w).cands.length);
  check("b-share: typed text is shown as text, never run", !w.__xss && !$(w, ".note img"));
  await next(w); await at(w, "dial1", L);
  await next(w); await at(w, "b-vote", L);
  const nv = (i) => $$(w, ".vnote")[i].click();
  nv(0); nv(0); nv(0); nv(1); nv(2); await sleep(40);
  let c = screenChecks(w);
  check("b-vote: one filled button, Reveal the winner", c.prim.length === 1 && c.prim[0] === "Reveal the winner", JSON.stringify(c.prim));
  $(w, "[data-act=reveal]").click();
  const win = await until(() => $(w, ".vnote.win"), 6000);
  check("b-vote: the most votes wins", win && /A report no one reads/.test(win.textContent), win && win.textContent);
  await next(w); await at(w, "r1", L);
  check("r1: the group's own words come back", /A report no one reads/.test($(w, ".quote").textContent));
  await next(w); await at(w, "c2", L);
  await next(w); await at(w, "quiz", L);
  $(w, "[data-v=ok]").click(); await sleep(40);
  await next(w); await at(w, "climb", L);
  await next(w); await at(w, "ladder", L);
  type(w, $(w, '[data-bind="ladder.0"]'), "Show leaders the pipeline every Monday");
  type(w, $(w, '[data-bind="ladder.1"]'), "Help leaders see where deals are stuck");
  $(w, "[data-act=climb]").click(); await sleep(40);
  type(w, $(w, '[data-bind="ladder.2"]'), "Grow revenue");
  check("ladder: three rungs saved", stored(w).ladder.filter(Boolean).length === 3, JSON.stringify(stored(w).ladder));
  w.document.activeElement.blur();
  await next(w); await at(w, "pick", L);
  const vp = (i) => $$(w, ".vrow [data-act=vplus]")[i].click();
  vp(1); vp(1); vp(1); vp(0);
  $(w, "[data-act=reveal]").click();
  await until(() => stored(w).purpose, 6000);
  check("pick: the purpose is the winning rung", /where deals are stuck/.test(stored(w).purpose), stored(w).purpose);
  await next(w); await at(w, "r2", L);
  await next(w); await at(w, "c3", L);
  await next(w); await at(w, "dial2", L);
  await next(w); await at(w, "ends", L);
  type(w, $(w, "[data-bind=start]"), "a sales leader asks for the pipeline view");
  type(w, $(w, "[data-bind=end]"), "the leader decides which deals to step into");
  w.document.activeElement.blur();
  await next(w); await at(w, "mode", L);
  $(w, "[data-v=sketch]").click();
  await at(w, "make", L);
  await next(w); await at(w, "capture", L);
  const steps = ["Export opportunities", "Clean the data in Excel", XSS, "Build 14 slides", "Email the deck", "Walk through every slide", "Leaders ask for the riskiest deals"];
  for (const s of steps) {
    const f = w.document.activeElement && w.document.activeElement.hasAttribute && w.document.activeElement.hasAttribute("data-bstep") ? w.document.activeElement : $$(w, "[data-bstep]").pop();
    type(w, f, s); key(w, f, "Enter"); await sleep(30);
  }
  check("capture: seven steps saved", stored(w).frames.filter((f) => f.t).length === 7, stored(w).frames.length);
  w.document.activeElement.blur();
  await next(w); await at(w, "r3", L);
  await next(w); await at(w, "c4", L);
  await next(w); await at(w, "lenses", L);
  await next(w); await at(w, "dot", L);
  await next(w); await at(w, "tally", L);
  const tap = (row, k, n) => { for (let i = 0; i < n; i++) $$(w, ".jrow")[row].querySelector(".jb." + k).click(); };
  tap(1, "f", 4); tap(3, "c", 3); tap(5, "f", 2); tap(0, "d", 1);
  check("tally: reactions are counted per step", stored(w).frames[1].f === 4 && stored(w).frames[3].c === 3);
  await next(w); await at(w, "hot", L);
  check("hot: the three hottest steps get a why card", $$(w, "[data-bwhy]").length === 3, $$(w, "[data-bwhy]").length);
  type(w, $(w, "[data-bwhy]"), "Nobody trusts the export, so we rebuild it");
  w.document.activeElement.blur();
  await next(w); await at(w, "r4", L);
  await next(w); await at(w, "brk", L);
  await next(w); await at(w, "stories", L);
  await next(w); await at(w, "tesla", L);
  check("tesla: the film is on the page", !!$(w, ".film") && !!$(w, ".film .poster"));
  await next(w); await at(w, "mlb", L);
  await next(w); await at(w, "poll", L);
  $$(w, "[data-act=pplus]")[0].click(); $$(w, "[data-act=pplus]")[0].click(); $$(w, "[data-act=pplus]")[1].click();
  $(w, "[data-act=reveal]").click(); await sleep(200);
  await next(w); await at(w, "c5", L);
  await next(w); await at(w, "moves", L);
  await next(w); await at(w, "mv-sub", L); await addNotes(w, ["Drop the 14 slides", "Stop the Monday walkthrough"]);
  await next(w); await at(w, "mv-shr", L); await addNotes(w, ["Auto-clean the export"]);
  await next(w); await at(w, "mv-amp", L); await addNotes(w, ["More time on the riskiest deals"]);
  await next(w); await at(w, "mv-inv", L); await addNotes(w, ["An agent flags stuck deals daily", XSS]);
  check("moves: ideas saved under each move", stored(w).ideas.sub.length === 2 && stored(w).ideas.inv.length === 2);
  await next(w); await at(w, "ideas", L);
  const ni = (i) => $$(w, ".vnote")[i].click();
  ni(0); ni(0); ni(3); ni(4); ni(4);
  $(w, "[data-act=reveal]").click(); await sleep(300);
  await next(w); await at(w, "newflow", L);
  $$(w, ".carry button[data-act=carry]")[0].click(); await sleep(30);
  $$(w, ".carry button[data-act=carryidea]")[0].click(); await sleep(30);
  check("newflow: today's steps and kept ideas carry into the new flow", stored(w).newFrames.length === 2, stored(w).newFrames.length);
  await next(w); await at(w, "r5", L);
  await next(w); await at(w, "c6", L);
  await next(w); await at(w, "lww", L);
  await next(w); await at(w, "people", L);
  type(w, $(w, '[data-bind="people.0.who"]'), "Head of sales ops");
  w.document.activeElement.blur();
  await next(w); await at(w, "rehearse", L);
  await next(w); await at(w, "test", L);
  check("test: the last step says Finish", $(w, "#nextBtn").textContent === "Finish");
  type(w, $(w, "[data-bind=test]"), "Send leaders a one-line list of the riskiest deals next Monday");
  type(w, $(w, "[data-bind=owner]"), "Sam"); type(w, $(w, "[data-bind=when]"), "next Monday");
  w.document.activeElement.blur();
  await next(w); await at(w, "finish", L);
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
  check("print: opens the print dialog with every chapter", w.__printed === 1 && /Isn\u2019t there a better way\?/.test(pr) && /Share it/.test(pr));
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
}

/* =================== a solo session, start to finish =================== */
{
  const s = openLab();
  await at(s, "cover", "solo");
  $(s, "[data-act=begin]").click(); await at(s, "who", "solo");
  $(s, "[data-v=solo]").click();
  await until(() => cur(s) !== "who", 3000);
  const seen = [];
  let multi = [];
  for (let guard = 0; guard < 60; guard++) {
    const id = cur(s); if (!id) break;
    if (seen.includes(id) && id !== "finish") { check("solo: never stuck", false, "stuck at " + id); break; }
    seen.push(id);
    if (id === "b-solo") { type(s, $(s, "textarea.big, input.big"), "A meeting that could have been an email"); s.document.activeElement.blur(); }
    if (id === "ladder") { type(s, $(s, '[data-bind="ladder.0"]'), "Share updates"); type(s, $(s, '[data-bind="ladder.1"]'), "Keep everyone on the same priorities"); s.document.activeElement.blur(); }
    if (id === "pick") { $$(s, ".vrow.pick")[0].click(); await sleep(60); }
    if (id === "mode") { $(s, "[data-v=sticky]").click(); await until(() => cur(s) !== "mode", 3000); continue; }
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
  check("solo: team-only screens never show", !seen.some((id) => ["roles", "b-think", "b-share", "b-vote", "dot", "brk", "rehearse"].includes(id)), seen.join(" "));
  check("solo: one screen at a time, at most one filled button", multi.length === 0, multi.join(", "));
  check("solo: the kit hook reports solo", s.EPKit.tool.state().mode === "solo");
  check("solo: no page errors", s.__errors.length === 0, s.__errors.join(" | "));
}

/* =================== the feedback board rebuilds a screen =================== */
{
  const BOOT = fs.readFileSync(path.join(KIT, "feedback.js"), "utf8");
  async function replay(screen, settings) {
    const errors = [];
    const vc = new VirtualConsole();
    vc.on("jsdomError", (e) => { if (!/getContext|Not implemented/.test(e.message)) errors.push(e.message); });
    const dom = new JSDOM(HTML, { url: URL0, runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc, beforeParse: (r) => { prepare(r); r.EPKitReplay = { screen, settings, scroll: 0 }; r.scrollTo = () => {}; } });
    const r = dom.window; let msg = null;
    r.addEventListener("message", (e) => { msg = e.data; });
    await until(() => r.document.readyState === "complete", 3000);
    r.eval(BOOT);
    await until(() => msg, 4000);
    return { r, msg, errors };
  }
  let x = await replay("hot", { mode: "team", place: "room" });
  check("replay: the board can open any screen of a team session", cur(x.r) === "hot" && x.msg && x.msg.ok === true, cur(x.r));
  check("replay: with made-up content, never a real session", /It eats Friday afternoon/.test(x.r.document.querySelector("#stage").innerHTML) && x.r.EPKit.tool.state().place === "room");
  check("replay: the frame says it is ready", x.msg.type === "epkit-replay");
  x = await replay("finish", { mode: "solo" });
  check("replay: a solo finish screen, with the made-up card", cur(x.r) === "finish" && /The weekly status report nobody reads/.test(x.r.document.querySelector("#stage").textContent) && x.r.EPKit.tool.state().mode === "solo");
  x = await replay("no-such-screen", { mode: "team" });
  check("replay: an unknown screen falls back to the cover and says so", cur(x.r) === "cover" && x.msg.ok === false);
  check("replay: no page errors", x.errors.length === 0, x.errors.join(" | "));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
