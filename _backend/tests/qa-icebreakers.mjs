/* qa-icebreakers.mjs: jsdom harness for field-tools/icebreakers/index.html (Icebox).
   Runs a stage and several controllers against the real pt worker code (fake database), decodes
   the lobby's QR with jsQR, plays every kind of round and checks the points, reloads screens
   mid-game, fills a room to its limit, rebuilds every screen the way the feedback board does, and
   checks the scoring, the word matching and the game content directly.
   Run: node _backend/tests/qa-icebreakers.mjs   (needs: npm install jsdom jsqr) */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import worker from '../pt-worker.js';
import { FakeDB } from './fake-db.mjs';
const require = createRequire(import.meta.url);
const jsQR = require('jsqr');

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../field-tools/icebreakers/index.html'), 'utf8');
const SITE = 'https://ep.github.io/pt/field-tools/icebreakers/';
let failures = 0;
function check(name, cond, detail) { console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (!cond && detail !== undefined ? '  :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : '')); if (!cond) failures++; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)) { try { if (fn()) return true; } catch (e) {} await sleep(12); } return false; }

const env = { DB: FakeDB() };
const errors = [], doms = [];
const FAST = { pollMs: 25, padPollMs: 25, tickMs: 15, beatMs: 120, flushMs: 30, retryMs: 5, endMs: 250, graceMs: 60, lateMs: 20, speed: 80, botMs: 12, botSpeed: 0.004, anim: false };
function load(url, o) {
  o = o || {};
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { const m = String((e && e.message) || e); if (!/Not implemented/.test(m)) errors.push(m.split('\n')[0]); });
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) {
    w.gets = []; w.posts = 0; w.tried = 0;
    if (o.net === false) w.fetch = async () => { w.tried++; throw new Error('no network in the practice room'); };
    else w.fetch = async (u, init) => {
      init = init || {};
      if ((init.method || 'GET') === 'POST') w.posts++; else w.gets.push(String(u));
      return worker.fetch(new Request(String(u), { method: init.method || 'GET', headers: Object.assign({ Origin: 'https://ep.github.io' }, init.headers || {}), body: init.body }), o.env || env);
    };
    if (o.seed) Object.keys(o.seed).forEach((k) => w.localStorage.setItem(k, o.seed[k]));
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.scrollTo = () => {};
    w.addEventListener('error', (e) => errors.push(String(e.message)));
  } });
  const w = dom.window;
  Object.assign(w.App, FAST, o.app || {});
  doms.push(dom);
  return w;
}
const $ = (w, sel) => w.document.querySelector(sel);
const $$ = (w, sel) => [...w.document.querySelectorAll(sel)];
function click(w, target) { const el = typeof target === 'string' ? $(w, target) : target; if (!el) throw new Error('nothing to click: ' + target); el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })); }
function type(w, target, v) { const el = typeof target === 'string' ? $(w, target) : target; if (!el) throw new Error('nothing to type in: ' + target); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }
function key(w, k, el) { (el || w.document.body).dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }
const text = (w, sel) => { const el = $(w, sel); return el ? el.textContent : ''; };
const painted = (w, id) => w.getComputedStyle(w.document.getElementById(id)).display !== 'none';
const views = (w) => ['studio', 'stageWrap', 'padWrap', 'gate'].filter((id) => painted(w, id)).join();
const ctl = (H) => H.__ice.fn.ctlOf(H.__ice.host().S);
const ph = (H) => ctl(H).ph;
const row = (code, p) => { const r = env.DB._rows.get('ice:' + code + '|' + p); return r ? JSON.parse(r.value) : undefined; };
const score = (code) => row(code, 'h/score') || {};      /* the running totals; pub/score is what the room was last shown */
const paths = (code) => { const out = []; env.DB._rows.forEach((v, k) => { if (k.startsWith('ice:' + code + '|')) out.push(k.split('|')[1]); }); return out; };
const put = (code, p, v) => env.DB._rows.set('ice:' + code + '|' + p, { value: JSON.stringify(v), updated: Date.now() });
async function call(method, p, body, sk) { const h = { 'Content-Type': 'application/json', Origin: 'https://ep.github.io' }; if (sk) h['X-Session-Key'] = sk; const r = await worker.fetch(new Request('https://w.test' + p, { method, headers: h, body: body ? JSON.stringify(body) : undefined }), env); return { status: r.status, data: await r.json() }; }

/* the QR is drawn as an SVG: read its modules back and decode them */
function svgToMatrix(svg) {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), total = parseInt(vb[1], 10), quiet = 3, n = total - quiet * 2;
  const m = Array.from({ length: n }, () => new Array(n).fill(0));
  for (const r of svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)" rx="[\d.]+" fill="(#[0-9A-Fa-f]+)"/g)) { const x = parseFloat(r[1]) - quiet, y = parseFloat(r[2]) - quiet, wd = parseInt(r[3], 10), dark = r[5].toUpperCase() !== '#FFFFFF'; for (let dy = 0; dy < wd; dy++) for (let dx = 0; dx < wd; dx++) m[y + dy][x + dx] = dark ? 1 : 0; }
  const rad = 0.43;
  for (const d of svg.matchAll(/M([\d.]+) ([\d.]+)a/g)) { const cx = parseFloat(d[1]) + rad, cy = parseFloat(d[2]); m[Math.round(cy - 0.5) - quiet][Math.round(cx - 0.5) - quiet] = 1; }
  return { size: n, modules: m };
}
function decodeMatrix(q) {
  const scale = 8, quiet = 4, total = q.size + quiet * 2, W = total * scale, data = new Uint8ClampedArray(W * W * 4); data.fill(255);
  for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) { if (!q.modules[r][c]) continue; for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) { const px = ((r + quiet) * scale + y) * W + ((c + quiet) * scale + x); data[px * 4] = 0; data[px * 4 + 1] = 0; data[px * 4 + 2] = 0; } }
  const res = jsQR(data, W, W); return res ? res.data : null;
}
const qrOf = (el) => decodeMatrix(svgToMatrix(el.innerHTML));

/* ---------- a stage, and people to play ---------- */
async function openHost(o) {
  const H = load(SITE, o);
  await until(() => $(H, '#stOpen'));
  click(H, '#stOpen');
  await until(() => H.__ice.host() && H.__ice.host().started && H.__ice.Stage.on);
  return { H, code: H.__ice.host().code, key: H.__ice.host().key };
}
async function joinPad(code, name, o) {
  const P = load(SITE + '?join=' + code, o);
  await until(() => $(P, '[data-nick]'));
  if (name) { type(P, '[data-nick]', name); click(P, '[data-act="join"]'); await until(() => P.__ice.pad() && P.__ice.pad().joined); }
  return P;
}
const pid = (P) => P.__ice.pad().pid;
const padText = (P) => text(P, '#pad');
const padView = (P) => $(P, '#pad').getAttribute('data-view');
async function room(names, o) {
  const S = await openHost(o);
  S.pads = [];
  for (const n of names) S.pads.push(await joinPad(S.code, n));
  await until(() => $$(S.H, '#sCrowd .who').length === names.length);
  return S;
}
/* the stage has finished writing, and has drawn what it wrote */
const settled = (H) => until(() => !H.__ice.Host.busy && !H.__ice.Stage.swapping && !$(H, '#hCtl .btn[disabled]'), 4000);
async function start(H, items, name) { await settled(H); await H.__ice.fn.hostPlay(items, name || ''); await until(() => ph(H) === 'intro'); await settled(H); click(H, '#hCtl [data-act="next"]'); await until(() => ph(H) !== 'intro'); await settled(H); }
async function next(H) { await settled(H); const p = ph(H), c = ctl(H).cid, r = ctl(H).r, d = ctl(H).done; click(H, '#hCtl [data-act="next"]'); await until(() => ph(H) !== p || ctl(H).cid !== c || ctl(H).r !== r || ctl(H).done !== d, 3000); await settled(H); }
async function skip(H) { await settled(H); const p = ph(H), c = ctl(H).cid; await H.__ice.fn.hostSkip(); await until(() => ph(H) !== p || ctl(H).cid !== c, 3000); await settled(H); }
/* every controller has caught up with the moment the stage is in */
const inStep = (H, pads) => until(() => pads.every((P) => { const c = P.__ice.fn.ctlOf(P.__ice.pad().net.S), h = ctl(H); return c.ph === h.ph && c.cid === h.cid && c.n === h.n; }), 4000);
async function home(H) { await settled(H); click(H, '#hMenu'); click(H, '#menu [data-act="home"]'); await until(() => ph(H) === 'lobby'); await settled(H); await until(() => $(H, '#sCrowd')); }
const done = async (H) => { const ok = await until(() => !!ctl(H).done, 6000); await settled(H); return ok; };
function onePrimary(H, label) { const filled = $$(H, '#hCtl .btn:not(.sec):not(.ghost)'), all = $$(H, '#hCtl .btn'); check('the bar has at most one filled button, at the right end: ' + label, filled.length <= 1 && (!filled.length || all[all.length - 1] === filled[0]), all.map((b) => b.textContent)); }
function padRules(P, label) {
  const filled = $$(P, '#pad .btn:not(.sec):not(.ghost)'), moving = $$(P, '#pad button').filter((b) => /^(next|skip|start|finish|begin|continue)\b/i.test(b.textContent.trim()));
  const bare = $$(P, '#pad button, #pad input, #pad textarea').filter((b) => !b.textContent.trim() && !b.getAttribute('aria-label'));
  check('a controller has one filled button at most, nothing that moves the game on, and names for its controls: ' + label, filled.length <= 1 && !moving.length && !bare.length, { filled: filled.length, moving: moving.map((b) => b.textContent), bare: bare.length });
}

(async () => {
  /* ================= the file itself ================= */
  check('no em or en dash anywhere in the file', !/[\u2014\u2013]/.test(html));
  check('the page asks search engines to stay away, and carries the kit line', /<meta name="robots" content="noindex, nofollow">/.test(html) && html.includes('<script src="/pt/assets/kit/feedback.js" defer></script>'));
  check('no analytics on the page', !/clarity|googletagmanager|gtag\(/i.test(html));
  check('the tab is called Play until the stage says otherwise, so players never see the kit name there', /<title>Play<\/title>/.test(html));
  check('storage is only touched inside its three guarded helpers', (html.match(/localStorage/g) || []).length === 3 && (html.match(/sessionStorage/g) || []).length === 0, (html.match(/localStorage/g) || []).length);
  const hosts = [...new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]))].sort();
  check('the only addresses in the file are pt, the worker, the fonts and the SVG namespace', hosts.join() === 'ep.github.io,fonts.googleapis.com,fonts.gstatic.com,pt.armand-khambatta.workers.dev,www.w3.org', hosts);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  let syntax = '';
  try { const f = path.join(os.tmpdir(), 'qa-icebreakers-' + process.pid + '.js'); fs.writeFileSync(f, scripts.join('\n')); execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); fs.unlinkSync(f); } catch (e) { syntax = String(e.stderr || e.message).slice(0, 300); }
  check('the script passes node --check', scripts.length === 1 && !syntax, syntax);
  const play = fs.readFileSync(path.join(here, '../../play/index.html'), 'utf8');
  check('the short address forwards to the join screen, and carries a code along', /noindex, nofollow/.test(play) && play.includes("location.replace('/pt/field-tools/icebreakers/?join'+(c?'='+c.toUpperCase():''))") && !/[\u2014\u2013]/.test(play));

  /* ================= the box: games, sets, voices, themes, bands ================= */
  const F = load(SITE), I = F.__ice, fn = I.fn;
  await until(() => $(F, '#stOpen'));
  const KINDS = ['bluff', 'best', 'whose', 'fake', 'fakeP', 'hands', 'match', 'secret'], gids = Object.keys(I.GAMES);
  const packed = I.PACKS.reduce((a, p) => a.concat(p.games), []);
  check('every pack names games that exist, and every game is in exactly one pack', packed.every((g) => I.GAMES[g]) && packed.length === gids.length && new Set(packed).size === gids.length, packed);
  check('the first box holds twelve games in three packs, two of them house originals', gids.length === 12 && I.PACKS.length === 3 && I.PACKS[0].games.join() === 'just,brain');
  const thin = gids.filter((g) => { const G = I.GAMES[g]; return !(G.name && KINDS.includes(G.kind) && G.hook && Array.isArray(G.steps) && G.steps.length === 3 && G.bridge && G.notes && G.mins > 0 && G.min >= 2); });
  check('every game has a name, a known kind, a hook, three steps, a closing line and host notes', !thin.length, thin);
  const needDeck = gids.filter((g) => ['bluff', 'hands', 'match', 'fake'].includes(I.GAMES[g].kind) && !(I.GAMES[g].deck || []).length);
  check('games that deal cards have cards to deal', !needDeck.length, needDeck);
  const R = I.GAMES.rule;
  check('every fake card has three statements, one marked made up, and a line that sets it straight', R.deck.every((c) => c.s.length === 3 && c.f >= 0 && c.f < 3 && c.fix) && R.deck.length >= 3);
  check('every twist card has a second fake of its own, with its own line', R.twists.length >= 2 && R.twists.every((c) => c.s.length === 3 && c.also !== c.f && c.also >= 0 && c.also < 3 && c.fix && c.fix2));
  check('the twist game never names its twist where the room can read it', !/twist/i.test(R.name + R.hook + R.steps.join(' ') + R.ask) && !/same|every card/i.test(I.GAMES.only.hook + I.GAMES.only.steps.join(' ')));
  check('the real answers in Be the Bot are short enough to pass for a player\'s', I.GAMES.bot.deck.every((c) => c.q && c.a && c.a.length <= I.GAMES.bot.cap));
  check('each secret card has its line, its warning and its mission', ['only', 'solo'].every((g) => I.GAMES[g].card.say && I.GAMES[g].card.keep && I.GAMES[g].card.mission && I.GAMES[g].flip));
  check('the ready-made sets are made of games that exist, and each ends on a twist', I.SETS.length === 3 && I.SETS.every((s) => s.name && s.mins && s.needs && s.items.every((it) => I.GAMES[it.g]) && I.GAMES[s.items[s.items.length - 1].g].twist));
  const vk = Object.keys(I.VOICES.cheeky).sort().join(), used = [...new Set([...html.matchAll(/\bline\("([a-zA-Z]+)"/g)].map((m) => m[1]))];
  check('both announcer voices have the same lines, and every line the stage asks for exists', vk === Object.keys(I.VOICES.classic).sort().join() && used.length > 20 && used.every((k) => I.VOICES.cheeky[k] && I.VOICES.classic[k]), used.filter((k) => !I.VOICES.cheeky[k]));
  const tids = Object.keys(I.THEMES);
  check('three themes and a seasonal edition, each with a name, confetti, a band and a preview', tids.length === 4 && tids.every((t) => { const T = I.THEMES[t]; return T.name && T.confetti.length >= 3 && I.BANDS[T.band] && T.backdrop && html.includes('.mini-stage.t-' + t) && (T.base ? I.THEMES[T.base] && html.includes('[data-edition="' + t + '"]{') : html.includes('[data-theme="' + t + '"]{')); }), tids);
  check('a seasonal edition is a short block on top of a theme', I.THEMES.snow.base === 'show' && I.THEMES.snow.seasonal === true && (html.match(/\[data-edition="snow"\]/g) || []).length <= 14);
  const badLoops = [];
  Object.keys(I.BANDS).forEach((b) => { const B = Object.assign({}, I.BANDS[I.BANDS[b].base] || {}, I.BANDS[b]); ['lobby', 'think', 'vote'].forEach((n) => { const L = B.loops && B.loops[n]; if (!L) return badLoops.push(b + ':' + n); ['bass', 'comp', 'arp', 'drums'].forEach((k) => { if (L[k] && (L[k].length !== L.chords.length || L[k].some((s) => s.length !== B.grid))) badLoops.push(b + ':' + n + ':' + k); }); ['hat', 'rush'].forEach((k) => { if (L[k] && L[k].length !== B.grid) badLoops.push(b + ':' + n + ':' + k); }); }); });
  check('every band has its three loops, written to its own grid', !badLoops.length, badLoops);
  check('the page explains how to add a pack, a theme and a band', ['HOW TO ADD A PACK', 'HOW TO ADD A THEME OR A SEASONAL EDITION', 'HOW TO ADD A BAND'].every((t) => html.includes(t)));

  /* ================= scoring and matching, checked directly ================= */
  const ids = { a: 1, b: 1, c: 1, d: 1, e: 1 }, P = I.PTS;
  let t = fn.tally({ k: 'text', opts: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], ok: ['o3'], auth: { o1: ['a'], o2: ['b', 'c'] } }, { a: { o: 'o3' }, b: { o: 'o1' }, c: { o: 'o1' }, d: { o: 'o2' }, e: { o: 'o3' }, zz: { o: 'o1' }, b2: null }, ids);
  check('bluff: spotting the real one scores, and so does every person you fool', t.pts.a === P.spot + 2 * P.fool && t.pts.b === P.fool && t.pts.c === P.fool && t.pts.e === P.spot && !t.pts.d && t.tot === 5 && t.right.join() === 'a,e', t);
  t = fn.tally({ k: 'text', opts: [{ id: 'o1' }, { id: 'o2' }], ok: ['o2'], auth: { o1: ['a'] } }, { a: { o: 'o1' }, b: { o: 'o1' } }, ids);
  check('a vote for your own answer is thrown out', t.cnt.o1 === 1 && t.pts.a === P.fool && t.tot === 1);
  t = fn.tally({ k: 'text', opts: [{ id: 'o1', x: 1 }, { id: 'o2' }], ok: ['o2'], auth: { o1: ['a'] } }, { b: { o: 'o1' }, c: { o: 'o2' } }, ids);
  check('an answer the host hid takes no votes and gives no points', t.cnt.o1 === 0 && !t.pts.a && t.pts.c === P.spot && t.tot === 1);
  t = fn.tally({ k: 'text', fav: 1, opts: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], ok: [], auth: { o1: ['a'], o2: ['b'], o3: ['c'] } }, { a: { o: 'o2' }, c: { o: 'o2' }, d: { o: 'o1' }, e: { o: 'o1' } }, ids);
  check('best answer: points for each vote, and a bonus for every winner in a tie', t.pts.a === 2 * P.vote + P.top && t.pts.b === 2 * P.vote + P.top && !t.pts.c);
  t = fn.tally({ k: 'name', opts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], ok: ['a'], excl: ['a'] }, { a: { o: 'a' }, b: { o: 'a' }, c: { o: 'c' }, d: { o: 'a' }, e: { o: 'b' } }, ids);
  check('guess who: right guesses score, the author sits out and scores for being known, and nobody may guess themselves', t.pts.b === P.who && t.pts.d === P.who && t.pts.a === 2 * P.known && !t.pts.c && !t.pts.e && t.tot === 3, t);
  t = fn.tally({ k: 'stmt', by: 'a', opts: [{ id: 'x1' }, { id: 'x2' }, { id: 'x3' }], ok: ['x2'], excl: ['a'] }, { b: { o: 'x2' }, c: { o: 'x1' }, d: { o: 'x3' }, a: { o: 'x2' } }, ids);
  check('two truths and a lie: catching it scores, and the author scores for everyone it fooled', t.pts.b === P.fake && t.pts.a === 2 * P.lied && !t.pts.c && t.tot === 3);
  let h = fn.scoreHands(5, { a: { g: 5 }, b: { g: 4 }, c: { g: 7 }, d: { g: 0 }, e: { g: 'x' }, zz: { g: 5 } }, ids, 8);
  check('show of hands: exact, one away and two away each score, and nothing else does', h.pts.a === P.exact && h.pts.b === P.near && h.pts.c === P.close && !h.pts.d && !h.pts.e && !h.pts.zz && h.best.join() === 'a' && h.miss === 0, h);
  h = fn.scoreHands(30, { a: { g: 26 }, b: { g: 21 }, c: { g: 19 }, d: { g: 999 } }, ids, 60);
  check('in a big room near means within a twelfth of the room', h.pts.a === P.near && h.pts.b === P.close && !h.pts.c && !h.pts.d && h.best.join() === 'a' && h.miss === 4, h);
  h = fn.scoreHands(2, { a: { g: 3 }, b: { g: 3 }, c: { g: 1 }, d: { g: 3 }, e: { g: 1 } }, ids, 5);
  check('ties for closest are all named, four at most', h.best.length === 4 && h.more === 1 && h.miss === 1);
  const wk = fn.wordKey;
  check('one word matches another through case, accents, punctuation, a leading article and a plural', wk('Coffee') === wk(' coffee!') && wk('the coffees') === wk('COFFEE') && wk('Café') === wk('cafe') && wk('bus') === 'bus' && wk('glass') === 'glass' && wk('pineapples') === 'pineapple' && wk('  ') === '' && wk('mystery sauce') === 'mysterysauce');
  check('words in any alphabet match, an emoji is a word, and a row of punctuation is not', wk('\u041a\u043e\u0444\u0435') === wk('\u043a\u043e\u0444\u0435!') && wk('\u043a\u043e\u0444\u0435').length === 4 && wk('\u5496\u5561') === '\u5496\u5561' && wk('\ud83c\udf55') === '\ud83c\udf55' && wk('?!') === '' && fn.textKey('...') === '...' && fn.textKey('\u3053\u3093\u306b\u3061\u306f\uff01') === '\u3053\u3093\u306b\u3061\u306f' && fn.textKey('Hello, There!') === 'hellothere');
  let cl = fn.cluster({ a: { w: 'Coffee' }, b: { w: 'coffee ' }, c: { w: 'the coffees' }, d: { w: 'tea' }, e: { w: '?!' }, zz: { w: 'coffee' } }, ids);
  check('matching words stack, and a stack of three pays each person for two matches', cl.stacks.length === 1 && cl.stacks[0].p.join() === 'a,b,c' && cl.singles.length === 1 && cl.pts.a === 2 * P.match && !cl.pts.d && !cl.pts.e, cl);
  const many = {}, manyIds = {}; for (let i = 0; i < 20; i++) { many['p' + i] = { w: 'same' }; manyIds['p' + i] = 1; }
  check('a huge stack is capped, so one word cannot run away with the game', fn.cluster(many, manyIds).pts.p0 === P.match * P.matchMax);
  const tw = fn.twinsOf(fn.pairsOf([[['a', 'b', 'c']], [['a', 'b'], ['c', 'd']], [['b', 'a']]]));
  check('a brain twin is whoever matched you most often', tw.a[0] === 'b' && tw.a[1] === 3 && tw.b[0] === 'a' && tw.d[0] === 'c' && tw.c[1] === 1);
  const groups = fn.groupTexts([{ p: 'a', a: { t: 'Hello there' } }, { p: 'b', a: { t: 'hello, THERE!' } }, { p: 'c', a: { t: 'Other' } }, { p: 'd', a: { t: ' ' } }]);
  check('the same answer from two people becomes one option with two authors', groups.length === 2 && groups[0].ps.join() === 'a,b');
  const feat = fn.pickFeatured([{ ps: ['a'] }, { ps: ['b'] }, { ps: ['c'] }, { ps: ['d'] }], 2, { a: 2, b: 1 }, fn.seeded('x')).map((g) => g.ps[0]).sort().join();
  check('the stage goes first to people who have had it least', feat === 'c,d', feat);
  const rk = fn.ranked({ p: { aaaa: { n: 'A', t: 1 }, bbbb: { n: 'B', t: 2 }, cccc: { n: 'C', t: 3 } } }, { aaaa: 100, bbbb: 300, cccc: 300 });
  check('equal scores share a place', rk.map((r) => r.id + r.rank).join() === 'bbbb1,cccc1,aaaa3');
  check('typed text is escaped and tidied before it is used', fn.esc('<b a="1">&\'') === '&lt;b a=&quot;1&quot;&gt;&amp;&#39;' && fn.tidy('  a\u0000\n​ b   c ', 5) === 'a b c' && fn.tidy('abcdefgh', 4) === 'abcd' && fn.tidy('ab\ud83d\ude00\ud83d\ude00', 3) === 'ab\ud83d\ude00' && fn.tidy('\u200d\u200c ') === '' && fn.tidy('\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645') === '\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645');
  const codes = Array.from({ length: 300 }, () => fn.mkCode());
  check('codes are eight letters with no I, L or O', codes.every((c) => /^[A-HJKMNP-Z]{8}$/.test(c)) && new Set(codes).size === 300 && fn.codeLook('ABCDEFGH') === 'ABCD EFGH');
  const r1 = fn.seeded('abc'), r2 = fn.seeded('abc'); check('a reloaded stage deals the same shuffle', [r1(), r1(), r1()].join() === [r2(), r2(), r2()].join() && fn.shuffled([1, 2, 3, 4, 5], fn.seeded('k')).join() === fn.shuffled([1, 2, 3, 4, 5], fn.seeded('k')).join());

  /* ================= the front page ================= */
  check('the front page is what paints first', views(F) === 'studio' && F.document.title === 'Icebox');
  check('it offers a practice room and one filled button, at the right end of its row', $$(F, '.go .btn').map((b) => b.textContent).join() === 'Try it with bots,Open the doors' && $$(F, '.go .btn:not(.sec)').length === 1 && $(F, '.go').lastElementChild.id === 'stOpen');
  check('ten characters wait on the front page, each one a named button', $$(F, '.cast .castm').length === 10 && $$(F, '.cast .castm').every((b) => b.getAttribute('aria-label')));
  click(F, '[data-theme-pick="type"]');
  check('picking a look changes the page at once and is remembered', F.document.documentElement.getAttribute('data-theme') === 'type' && F.localStorage.getItem('ice-theme') === 'type' && $(F, '[data-theme-pick="type"]').getAttribute('aria-pressed') === 'true');
  click(F, '[data-theme-pick="snow"]');
  check('a seasonal edition sits on the theme it belongs to', F.document.documentElement.getAttribute('data-theme') === 'show' && F.document.documentElement.getAttribute('data-edition') === 'snow' && I.Snd.band() === 'snow');
  click(F, '[data-theme-pick="show"]'); click(F, '[data-set="voice"][data-v="classic"]'); click(F, '[data-set="pace"][data-v="1.5"]');
  check('the announcer and the timers can be set before the doors open', F.App.voice === 'classic' && F.App.pace === 1.5 && !F.document.documentElement.hasAttribute('data-edition'));
  check('what is in the box is listed, with the twists kept folded away', $$(F, '.inside details').length === 15 && $$(F, '.inside details[open]').length === 0 && /Good to know/.test(text(F, '.inside')));
  check('the front page says how long things are kept, and what is not private', /deletes everything people typed/.test(text(F, '.inside')) && /seven days/.test(text(F, '.inside')) && /anyone in the room/.test(text(F, '.inside')));

  /* ================= opening the doors ================= */
  /* Right after a release the page can be live before the worker is. Until the worker gates this
     tool, a session's lock would not be real, so the page starts none. */
  {
    const iceRows = () => [...env.DB._rows.keys()].filter((k) => k.startsWith('ice:')).length, before = iceRows();
    const E = load(SITE, { env: { DB: env.DB, GATED_TOOLS: 'pyc,pair-poll,room-pulse,sf' } });
    await until(() => $(E, '#stOpen'));
    click(E, '#stOpen');
    await until(() => /switched on yet/.test(text(E, '#stErr')));
    check('a worker that does not gate this tool yet starts no live session, and the page says so', views(E) === 'studio' && /Live games aren't switched on yet/.test(text(E, '#stErr')) && !$(E, '#stOpen').disabled && iceRows() === before && E.location.search === '');
    try { E.close(); } catch (e) {}
  }
  click(F, '#stOpen');
  await until(() => I.host() && I.host().started && I.Stage.on);
  const H = F, code = I.host().code, hkey = I.host().key;
  check('the doors open onto the lobby', views(H) === 'stageWrap' && ph(H) === 'lobby' && /^[A-HJKMNP-Z]{8}$/.test(code) && /^[a-z0-9]{16}$/.test(hkey));
  check('the session is open under four paths, and only the worker holds the key', JSON.stringify(row(code, '_open')) === '["p","a","v","here"]' && row(code, '_sk') === hkey && !paths(code).some((p) => p.includes(hkey)));
  check('the address now reopens this stage, with the key after the hash', H.location.search === '?host=' + code && H.location.hash === '#k=' + hkey && JSON.parse(H.localStorage.getItem('ice-host')).code === code);
  check('the settings went with it', row(code, 'pub/cfg').vo === 'classic' && row(code, 'pub/cfg').pa === 1.5 && row(code, 'pub/cfg').th === 'show');
  check('the QR opens the join link', qrOf($(H, '#sQr')) === SITE + '?join=' + code, qrOf($(H, '#sQr')));
  check('the letters are shown in two groups of four, with the short address', $$(H, '.door .code span').map((s) => s.textContent).join(' ') === code.slice(0, 4) + ' ' + code.slice(4) && /ep\.github\.io\/pt\/play/.test(text(H, '.door')));
  check('sound starts on for the stage, with a mute button that says so', H.App.sound === true && $(H, '#hMute').getAttribute('aria-pressed') === 'true' && /Sound is on/.test($(H, '#hMute').getAttribute('aria-label')) && I.Snd.wanted() === 'lobby');
  key(H, 'm');
  check('M mutes, and the button says so', H.App.sound === false && $(H, '#hMute').getAttribute('aria-pressed') === 'false' && /Sound is off/.test($(H, '#hMute').getAttribute('aria-label')) && $(H, '#hVol').disabled && H.localStorage.getItem('ice-sound') === 'off');
  key(H, 'm');
  onePrimary(H, 'lobby');
  check('with nobody in, the room is invited once, and the bar adds no second line', /Waiting for the first player/.test(text(H, '#sEmpty')) && text(H, '#hStatus') === '');
  click(H, '#hCtl [data-act="pick"]');
  check('with nobody in, every game and set waits for players', $$(H, '#shelf .tile').length === 15 && $$(H, '#shelf .tile[disabled]').length === 15 && $$(H, '#shelf .tile small').every((e) => /^Needs \d players$/.test(e.textContent)));
  click(H, '.tile[data-g="just"]'); click(H, '.tile[data-set="opener"]');
  await sleep(60);
  check('a game that is waiting for players cannot start', row(code, 'pub/ctl').ph === 'lobby' && $(H, '#shelf').classList.contains('on'));
  key(H, 'Escape');

  /* what the code alone can and cannot do */
  let r = await call('GET', '/api/state?tool=ice&code=' + code);
  check('the code alone can read the session', r.status === 200 && r.data.state.pub.ctl.ph === 'lobby');
  r = await call('POST', '/api/set', { tool: 'ice', code, path: 'pub/ctl', value: { ph: 'podium' } });
  const r2b = await call('POST', '/api/set', { tool: 'ice', code, path: 'h/score', value: { x: 9999 } });
  const r3 = await call('POST', '/api/clear', { tool: 'ice', code });
  check('the code alone cannot run the game, change the scores or end the session', r.status === 401 && r2b.status === 401 && r3.status === 401 && row(code, 'pub/ctl').ph === 'lobby');
  r = await call('POST', '/api/set', { tool: 'ice', code, path: 'pub/ctl', value: { ph: 'podium' } }, 'wrongwrongwrong1');
  check('a wrong key is refused', r.status === 401);
  r = await call('GET', '/api/state?tool=ice&code=' + (code.slice(0, 7) + (code[7] === 'A' ? 'B' : 'A')));
  check('a near miss on the code finds nothing', r.status === 200 && r.data.state === null);

  /* ================= joining ================= */
  const A = load(SITE + '?join=' + code);
  await until(() => $(A, '[data-nick]'));
  check('the join link opens a controller asking for a name', views(A) === 'padWrap' && padView(A) === 'name' && A.document.title === 'Play' && !/Icebox/.test(text(A, '#padWrap')));
  padRules(A, 'name');
  click(A, '[data-act="join"]');
  check('a name is needed', !A.__ice.pad().joined && $(A, '[data-nick]').classList.contains('need'));
  const look0 = A.__ice.pad().a; for (let i = 0; i < 6 && A.__ice.pad().a === look0; i++) click(A, '[data-act="look"]');
  check('tapping the character changes the look', A.__ice.pad().a !== look0 && /^s\dc\d$/.test(A.__ice.pad().a));
  type(A, '[data-nick]', '  <i>Ana</i>   the very long name  '); click(A, '[data-act="join"]');
  await until(() => A.__ice.pad().joined && $$(H, '#sCrowd .who').length === 1);
  check('a name is tidied, cut at twelve characters, and shown as text', A.__ice.pad().n === '<i>Ana</i> t' && row(code, 'p/' + pid(A)).n === '<i>Ana</i> t' && !$(H, '#sCrowd i') && /<i>Ana<\/i> t/.test(text(H, '#sCrowd')));
  check('the stage counts the room in one place', /1 player in the room/.test(text(H, '#sCount')) && text(H, '#hStatus') === '');
  check('a controller reads only the shared rows after its first look', A.gets.length >= 2 && !/prefix=/.test(A.gets[0]) && A.gets.slice(1).every((u) => /prefix=pub/.test(u)), A.gets.slice(0, 3));
  check('the controller is in, with one thing to do', padView(A) === 'lobby' && /You're in\./.test(padText(A)));
  const waves0 = (row(code, 'here/' + pid(A)) || {}).w || 0; click(A, '[data-act="wave"]'); click(A, '[data-act="wave"]');
  check('a wave reaches the stage', await until(() => (row(code, 'here/' + pid(A)) || {}).w === waves0 + 2 && I.Stage.seen[pid(A)] && I.Stage.seen[pid(A)].w === waves0 + 2));
  /* the typed way in */
  const B = load(SITE + '?join');
  await until(() => $$(B, '#jBoxes input').length === 8);
  check('the short address lands on eight boxes, each one named', padView(B) === 'join' && $$(B, '#jBoxes input').every((x, i) => x.getAttribute('aria-label') === 'Letter ' + (i + 1) + ' of 8'));
  $$(B, '#jBoxes input').forEach((x, i) => type(B, x, code.charAt(i).toLowerCase()));
  await until(() => $(B, '[data-nick]'));
  type(B, '[data-nick]', 'Bo'); click(B, '[data-act="join"]');
  check('typing the letters in any case joins the same game', await until(() => B.__ice.pad() && B.__ice.pad().joined && B.__ice.pad().code === code));
  const W = load(SITE + '?join=QQQQQQQQ');
  check('a wrong code says so and keeps the letters', await until(() => /No game with that code/.test(text(W, '#jErr'))) && $$(W, '#jBoxes input').map((x) => x.value).join('') === 'QQQQQQQQ');
  const Wp = load(SITE + '?join=ABC');
  await until(() => $$(Wp, '#jBoxes input').length === 8);
  check('a short code fills what it can and waits for the rest', $$(Wp, '#jBoxes input').map((x) => x.value).join('') === 'ABC');
  const C = await joinPad(code, 'Cy'), D = await joinPad(code, 'Dee');
  await until(() => $$(H, '#sCrowd .who').length === 4);
  check('four players are on the stage, in the order they came', $$(H, '#sCrowd .who').map((w) => w.dataset.p).join() === [A, B, C, D].map(pid).join());
  check('the names everyone may show are one small shared row', await until(() => Object.keys(row(code, 'pub/nm')).length === 4 && row(code, 'pub/nm')[pid(B)][0] === 'Bo'));
  const N = { [pid(A)]: 'A', [pid(B)]: 'B', [pid(C)]: 'C', [pid(D)]: 'D' };

  /* ================= the shelf ================= */
  click(H, '#hCtl [data-act="pick"]');
  check('the shelf lists three sets and twelve games', $(H, '#shelf').classList.contains('on') && $$(H, '#shelf .tile.set').length === 3 && $$(H, '#shelf .tile[data-g]').length === 12 && $$(H, '#shelf .tile[disabled]').length === 0);
  check('nothing on the shelf gives a twist away', !/second fake|same thing|every card|two made-up/i.test(text(H, '#shelf')));
  key(H, 'Escape');
  check('Escape closes the shelf', !$(H, '#shelf').classList.contains('on'));
  click(H, '#hCtl [data-act="pick"]'); click(H, '.tile[data-g="bot"]');
  await until(() => ph(H) === 'intro');
  check('choosing a game shows its title card, with three steps', /Be the Bot/.test(text(H, '#sc h1')) && $$(H, '#sc .step').length === 3 && !$(H, '#shelf').classList.contains('on'));
  onePrimary(H, 'title card');
  await until(() => padView(A) === 'intro');
  check('controllers are told to look up', /Be the Bot/.test(padText(A)) && /Eyes on the big screen/.test(padText(A)));
  padRules(A, 'title card');

  /* ================= Be the Bot: write, vote, reveal, scores ================= */
  key(H, ' ');
  await until(() => ph(H) === 'write');
  const rid1 = ctl(H).rid, cs1 = row(code, 'pub/case');
  check('Space starts the round, with a prompt and a clock', /^p1g0r0$/.test(rid1) && cs1.q && cs1.of === 2 && ctl(H).dur === 70000 * 1.5 && I.Snd.wanted() === 'think');
  onePrimary(H, 'writing');
  await until(() => $(A, '[data-text]') && $(B, '[data-text]') && $(C, '[data-text]') && $(D, '[data-text]'));
  check('each controller shows the prompt and a box capped at the limit', padText(A).includes(cs1.q) && $(A, '[data-text]').getAttribute('maxlength') === '120' && /Cheerful opener/.test(padText(A)));
  padRules(A, 'writing');
  click(A, '[data-act="send"]');
  check('an empty answer is not sent', padView(A) === 'write' && !row(code, 'a/' + rid1 + '/' + pid(A)));
  type(A, '[data-text]', 'alpha <img src=x onerror=boom()> one'); click(A, '[data-act="send"]');
  check('a sent answer shows back, with a way to change it', padView(A) === 'sent' && /Sent\./.test(padText(A)) && !$(A, '#pad img') && /alpha <img/.test(padText(A)) && $(A, '[data-act="edit"]'));
  padRules(A, 'sent');
  click(A, '[data-act="edit"]');
  check('changing it brings the words back to edit', padView(A) === 'write' && $(A, '[data-text]').value === 'alpha <img src=x onerror=boom()> one');
  type(A, '[data-text]', 'alpha one'); click(A, '[data-act="send"]');
  type(B, '[data-text]', 'bravo two'); click(B, '[data-act="send"]');
  type(C, '[data-text]', '  Alpha   ONE! '); click(C, '[data-act="send"]');
  await until(() => row(code, 'a/' + rid1 + '/' + pid(C)));
  check('the stage shows who has sent something, never what', await until(() => /3 of 4 in/.test(text(H, '#hStatus'))) && $$(H, '#sCrowd .who.in').length === 3 && !/alpha|bravo/i.test(text(H, '#sc')));
  await skip(H);
  check('the round locks into a vote', ph(H) === 'vote' && ctl(H).cid === rid1 + 'c0' && I.Snd.wanted() === 'vote');
  const def1 = row(code, 'h/c/' + ctl(H).cid), pub1 = row(code, 'pub/case');
  const oAlpha = Object.keys(def1.auth).find((o) => def1.auth[o].length === 2), oBravo = Object.keys(def1.auth).find((o) => def1.auth[o].length === 1), oReal = def1.ok[0];
  check('the same answer twice becomes one option, and the real one is among them', def1.opts.length === 3 && oAlpha && def1.auth[oAlpha].slice().sort().join() === [pid(A), pid(C)].sort().join() && def1.auth[oBravo][0] === pid(B) && def1.opts.find((o) => o.id === oReal).t === I.GAMES.bot.deck.find((c) => c.q === cs1.q).a);
  check('the shared copy of the vote says nothing about who wrote what, or which is real', !JSON.stringify(pub1).includes(pid(A)) && !('ok' in pub1) && !('auth' in pub1));
  await inStep(H, [A, B, C, D]); await until(() => [A, B, C, D].every((p) => $$(p, '.choice').length === 3));
  check('your own answer is marked and cannot be chosen', $$(A, '.choice[disabled]').length === 1 && $(A, '.choice[data-o="' + oAlpha + '"]').disabled && /yours/.test($(A, '.choice[data-o="' + oAlpha + '"]').textContent) && $(C, '.choice[data-o="' + oAlpha + '"]').disabled && $$(D, '.choice[disabled]').length === 0);
  padRules(A, 'voting');
  check('the stage offers the host a way to hide an answer, and counts the votes in one place', $$(H, '#sOpts .hidebtn').length === 3 && /0 of 4 voted/.test(text(H, '#sMeter')) && text(H, '#hStatus') === '');
  click(A, '.choice[data-o="' + oReal + '"]'); click(B, '.choice[data-o="' + oAlpha + '"]'); click(C, '.choice[data-o="' + oBravo + '"]'); click(D, '.choice[data-o="' + oBravo + '"]');
  check('a choice shows as pressed', $(A, '.choice[data-o="' + oReal + '"]').getAttribute('aria-pressed') === 'true');
  click(D, '.choice[data-o="' + oAlpha + '"]');
  check('a vote can be changed until the vote locks', $(D, '.choice[data-o="' + oAlpha + '"]').getAttribute('aria-pressed') === 'true' && $(D, '.choice[data-o="' + oBravo + '"]').getAttribute('aria-pressed') === 'false');
  check('when everyone is in, the vote ends early by itself', await until(() => ph(H) === 'reveal', 4000));
  await done(H);
  const s1 = score(code);
  check('the points are right: spotting it, and fooling people', s1[pid(A)] === 500 + 500 && s1[pid(C)] === 500 && s1[pid(B)] === 250 && !s1[pid(D)], Object.keys(s1).map((p) => N[p] + ':' + s1[p]));
  check('the stage ends on the real answer stamped, the authors named and the counts shown', /The real AI/.test(text(H, '.opt[data-o="' + oReal + '"] .stamp')) && $(H, '.opt[data-o="' + oReal + '"]').classList.contains('real') && /wrote this/.test(text(H, '.opt[data-o="' + oAlpha + '"] .by')) && text(H, '.opt[data-o="' + oAlpha + '"] .n') === '2' && /1 of 4 spotted it\./.test(text(H, '#sc .ask')) && $$(H, '#sOpts .hidebtn').length === 0);
  onePrimary(H, 'reveal');
  await until(() => padView(A) === 'result' && padView(B) === 'result' && padView(D) === 'result');
  check('each controller says what happened to that person', /You spotted it\./.test(padText(A)) && /2 people thought yours was real\./.test(padText(A)) && /\+1000/.test(padText(A)) && /You fell for/.test(padText(B)) && /1 person thought yours was real\./.test(padText(B)) && /\+250/.test(padText(B)) && /You fell for/.test(padText(D)) && !$(D, '.delta'));
  padRules(A, 'result');
  await next(H);
  check('scores follow, highest first, and the round is not the last', ph(H) === 'scores' && !ctl(H).last && $$(H, '#sBoard .row').map((x) => N[x.dataset.p]).join('') === 'ACBD' && text(H, '#sBoard .row .pt') === '1000' && $(H, '#sBoard .row').classList.contains('first') && $$(H, '#hCtl .btn')[0].textContent === 'Next round');
  await until(() => padView(A) === 'scores' && padView(D) === 'scores');
  check('each controller shows its own place and total', /1st of 4/.test(padText(A)) && /1000/.test(padText(A)) && /4th of 4/.test(padText(D)) && text(A, '.me [data-pts]') === '1000');
  await next(H);
  const rid2 = ctl(H).rid;
  check('the second round has its own rows and a different prompt', ph(H) === 'write' && rid2 === 'p1g0r1' && row(code, 'pub/case').q !== cs1.q && row(code, 'pub/case').n === 2);
  /* pause, more time, skip */
  click(H, '#hCtl [data-act="pause"]');
  await until(() => !!ctl(H).paused);
  const pausedAt = ctl(H).paused; await sleep(80);
  check('Pause holds the clock and offers Resume', ctl(H).paused === pausedAt && !ctl(H).end && $(H, '#hCtl [data-act="pause"]').textContent === 'Resume' && I.Snd.wanted() === null);
  click(H, '#hCtl [data-act="more"]'); await until(() => ctl(H).paused === pausedAt + 30000);
  click(H, '#hCtl [data-act="pause"]'); await until(() => !ctl(H).paused && ctl(H).end);
  check('thirty more seconds can be added while paused, and Resume picks the clock and the music up', ctl(H).dur === 70000 * 1.5 + 30000 && (await until(() => I.Snd.wanted() === 'think')));
  await skip(H);
  check('a round nobody answered says so and moves on to the scores', ph(H) === 'scores' && ctl(H).thin === 1 && ctl(H).last === 1 && /Not enough answers/.test(I.Stage.lastSay));
  check('the last scores offer Finish', $$(H, '#hCtl .btn')[0].textContent === 'Finish');
  await next(H);
  check('a game with points ends on the podium', ph(H) === 'podium' && $$(H, '.podium .plinth').length === 3 && text(H, '.plinth.p1 .nm') === '<i>Ana</i> t' && !$(H, '.podium i'));
  await until(() => $(A, '.clapbtn'));
  padRules(A, 'applause');
  for (let i = 0; i < 6; i++) click(A, '.clapbtn');
  check('claps from a controller fill the meter on the stage', await until(() => I.Stage.claps >= 6 && parseFloat($(H, '#sApplause').style.width) > 0));
  await next(H);
  check('the last screen is the facilitator\'s closing line, on the stage and on every controller', ph(H) === 'close' && text(H, '.closing') === I.GAMES.bot.bridge && (await until(() => padText(A).includes(I.GAMES.bot.bridge))));
  onePrimary(H, 'closing line');
  await next(H);
  check('then back to the lobby, with the scores kept', ph(H) === 'lobby' && row(code, 'h/score')[pid(A)] === 1000 && (await until(() => padView(A) === 'lobby')));
  check('Host.err stayed empty through a whole game', !I.Host.err, String(I.Host.err && (I.Host.err.stack || I.Host.err)));

  /* ================= hide an answer, remove a player, change the look mid-game ================= */
  click(H, '#hCtl [data-act="pick"]');
  check('the shelf says scores carry on, and offers a fresh start', /Scores carry on/.test(text(H, '#shelf')) && $(H, '#shelf [data-fresh]'));
  click(H, '.tile[data-g="crowd"]');
  await until(() => ph(H) === 'intro'); await next(H);
  const rid3 = ctl(H).rid;
  check('a second game never meets the first one\'s rows', rid3 === 'p2g0r0' && !paths(code).some((p) => p.startsWith('a/' + rid3)));
  await until(() => $(A, '[data-text]') && $(B, '[data-text]') && $(C, '[data-text]'));
  type(A, '[data-text]', 'A'.repeat(200)); click(A, '[data-act="send"]'); type(B, '[data-text]', 'bee'); click(B, '[data-act="send"]'); type(C, '[data-text]', 'something rude'); click(C, '[data-act="send"]');
  await until(() => row(code, 'a/' + rid3 + '/' + pid(C)));
  check('an answer is cut at the game\'s limit', row(code, 'a/' + rid3 + '/' + pid(A)).t.length === I.GAMES.crowd.cap);
  await skip(H);
  const def3 = row(code, 'h/c/' + ctl(H).cid), oRude = Object.keys(def3.auth).find((o) => def3.auth[o][0] === pid(C)), oBee = Object.keys(def3.auth).find((o) => def3.auth[o][0] === pid(B));
  check('best-answer games put every answer up, with no real one', ph(H) === 'vote' && def3.fav === 1 && def3.opts.length === 3 && def3.ok.length === 0);
  click(H, '.hidebtn[data-o="' + oRude + '"]');
  await until(() => (row(code, 'pub/case').opts.find((o) => o.id === oRude) || {}).x === 1);
  check('the host can hide an answer: its words leave the stage and the shared rows', row(code, 'pub/case').opts.find((o) => o.id === oRude).t === '' && !/something rude/.test(text(H, '#sc')) && /Removed by the host/.test(text(H, '.opt[data-o="' + oRude + '"]')));
  await until(() => $(D, '.choice[data-o="' + oRude + '"]') && $(D, '.choice[data-o="' + oRude + '"]').disabled);
  check('a hidden answer cannot be chosen', /Removed by the host/.test($(D, '.choice[data-o="' + oRude + '"]').textContent));
  await inStep(H, [A, B, C, D]); await until(() => $(A, '.choice[data-o="' + oBee + '"]'));
  click(D, '.choice[data-o="' + oBee + '"]'); click(A, '.choice[data-o="' + oBee + '"]');
  await until(() => row(code, 'v/' + ctl(H).cid + '/' + pid(A)) && row(code, 'v/' + ctl(H).cid + '/' + pid(D)));
  /* the look changes for everyone, mid-vote */
  click(H, '#hMenu'); check('the menu opens and says so', $(H, '#menu').classList.contains('on') && $(H, '#hMenu').getAttribute('aria-expanded') === 'true');
  click(H, '#menu [data-act="theme"]');
  check('the host can change the look mid-game, and every controller follows', H.document.documentElement.getAttribute('data-theme') === 'sketch' && (await until(() => A.document.documentElement.getAttribute('data-theme') === 'sketch')) && ph(H) === 'vote' && $$(H, '#sOpts .opt').length === 3);
  click(H, '#hMenu'); click(H, '#menu [data-act="voice"]');
  check('and the announcer', H.App.voice === 'cheeky' && (await until(() => row(code, 'pub/cfg').vo === 'cheeky' && row(code, 'pub/cfg').th === 'sketch')));
  click(H, '#hMenu'); click(H, '#menu [data-act="notes"]');
  check('host notes open for the game in play, with the closing line', $(H, '#sheet').classList.contains('on') && /Crowd Pleaser/.test(text(H, '#sheet')) && text(H, '#sheet').includes(I.GAMES.crowd.bridge) && !/Be the Bot/.test(text(H, '#sheet')));
  key(H, 'Escape'); check('Escape closes them', !$(H, '#sheet').classList.contains('on'));
  await skip(H); await done(H);
  check('the favourite wins, the hidden answer scores nothing', score(code)[pid(B)] === 250 + 2 * 200 + 300 && score(code)[pid(C)] === 500 && /takes it\./.test(text(H, '#sc .ask')) && /Winner/.test(text(H, '.opt[data-o="' + oBee + '"] .stamp')));
  await until(() => padView(B) === 'result');
  check('the winner is told how many votes', /2 votes for yours\./.test(padText(B)) && /\+700/.test(padText(B)));
  await home(H);
  check('Back to the games leaves a game at any point', ph(H) === 'lobby' && (await until(() => $$(H, '#sCrowd .who').length === 4)));
  /* removing a player */
  const dpid = pid(D);
  click(H, '.kick[data-p="' + dpid + '"]');
  check('a removed player leaves the stage and is told why', (await until(() => views(D) === 'gate' && /removed/.test(text(D, '#gate')))) && (await until(() => $$(H, '#sCrowd .who').length === 3)) && row(code, 'pub/gone')[dpid] === 1);
  click(D, '#gateGo');
  await until(() => $(D, '[data-nick]'));
  type(D, '[data-nick]', 'Dee'); click(D, '[data-act="join"]');
  check('they can join again, as a new player', (await until(() => D.__ice.pad().joined && D.__ice.pad().pid !== dpid && $$(H, '#sCrowd .who').length === 4)));
  N[pid(D)] = 'D';

  /* ================= who said it: the author sits out ================= */
  I.SECS.write = 30; I.SECS.name = 30;
  await start(H, [{ g: 'said' }]);
  const rid4 = ctl(H).rid;
  await until(() => [A, B, C, D].every((p) => $(p, '[data-text]')));
  [[A, 'answer from a'], [B, 'answer from b'], [C, 'answer from c'], [D, 'answer from d']].forEach(([p, tx]) => { type(p, '[data-text]', tx); click(p, '[data-act="send"]'); });
  check('everyone in ends the writing early', await until(() => ph(H) === 'vote', 4000));
  let rounds = 0, ownOk = true, selfOff = true;
  while (ph(H) === 'vote' && rounds < 6) {
    const c = ctl(H), def = row(code, 'h/c/' + c.cid), owner = def.ok[0], ownerPad = [A, B, C, D].find((p) => pid(p) === owner), others = [A, B, C, D].filter((p) => p !== ownerPad);
    await inStep(H, [A, B, C, D]);
    await until(() => padView(ownerPad) === 'own' && others.every((p) => $$(p, '.choice').length === def.opts.length));
    ownOk = ownOk && /This one's yours/.test(padText(ownerPad)) && !$(ownerPad, '.choice');
    selfOff = selfOff && others.every((p) => { const me = $(p, '.choice[data-o="' + pid(p) + '"]'); return !me || me.disabled; });
    if (rounds === 0) { padRules(ownerPad, 'your own answer is up'); check('the stage shows the words and the suspects, by name', text(H, '.quote').includes('answer from') && $$(H, '#sOpts .sus').length === 4 && /Who said it\?/.test(text(H, '#sc .ask'))); }
    others.forEach((p) => click(p, '.choice[data-o="' + owner + '"]'));
    await until(() => ph(H) === 'reveal', 4000); await done(H);
    if (rounds === 0) { check('the reveal lands on the author', $(H, '.sus[data-o="' + owner + '"]').classList.contains('real') && /3 of 3 got it right\./.test(text(H, '#sc .ask'))); await until(() => padView(ownerPad) === 'result'); check('the author is told how many knew', /3 of 3 knew it was you\./.test(padText(ownerPad)) && /\+150/.test(padText(ownerPad))); }
    rounds++; await next(H);
  }
  const s4 = score(code), base4 = { [pid(A)]: 1000, [pid(B)]: 950, [pid(C)]: 500, [pid(D)]: 0 };
  check('four answers are read out, each author sits out, and nobody can guess themselves', rounds === 4 && ownOk && selfOff && ph(H) === 'scores');
  check('guessing right and being known both score', [A, B, C, D].every((p) => s4[pid(p)] - base4[pid(p)] === 3 * 400 + 3 * 50), [A, B, C, D].map((p) => s4[pid(p)] - base4[pid(p)]));
  await next(H); await next(H); await next(H);
  check('the game ends back in the lobby', ph(H) === 'lobby');

  /* ================= two truths and a lie ================= */
  await start(H, [{ g: 'truths' }]);
  await until(() => [A, B, C].every((p) => $(p, '[data-s="2"]')));
  check('three boxes, each one named', padView(A) === 'three' && $$(A, '[data-s]').every((x) => x.getAttribute('aria-label')));
  type(A, '[data-s="0"]', 'true one'); type(A, '[data-s="1"]', 'true two'); click(A, '[data-act="send3"]');
  check('all three are needed', padView(A) === 'three' && !row(code, 'a/' + ctl(H).rid + '/' + pid(A)));
  [[A, 'a'], [B, 'b'], [C, 'c']].forEach(([p, x]) => { type(p, '[data-s="0"]', x + ' truth one'); type(p, '[data-s="1"]', x + ' truth two'); type(p, '[data-s="2"]', x + ' LIE'); click(p, '[data-act="send3"]'); });
  await until(() => row(code, 'a/' + ctl(H).rid + '/' + pid(C)));
  await skip(H);
  let liesOk = true, n5 = 0; const got5 = {};
  while (ph(H) === 'vote' && n5 < 5) {
    const c = ctl(H), def = row(code, 'h/c/' + c.cid), by = def.by, lie = def.ok[0], truth = def.opts.find((o) => o.id !== lie).id, voters = [A, B, C, D].filter((p) => pid(p) !== by);
    liesOk = liesOk && def.opts.find((o) => o.id === lie).t === N[by].toLowerCase() + ' LIE' && def.excl[0] === by;
    await inStep(H, [A, B, C, D]);
    await until(() => voters.every((p) => $$(p, '.choice').length === 3) && padView([A, B, C, D].find((p) => pid(p) === by)) === 'own');
    if (n5 === 0) check('the stage names whose three they are', /says/.test(text(H, '.byline')) && $$(H, '#sOpts .opt').length === 3);
    click(voters[0], '.choice[data-o="' + lie + '"]'); voters.slice(1).forEach((p) => click(p, '.choice[data-o="' + truth + '"]'));
    got5[pid(voters[0])] = (got5[pid(voters[0])] || 0) + 400; got5[by] = (got5[by] || 0) + 2 * 150;
    await until(() => ph(H) === 'reveal', 4000); await done(H);
    if (n5 === 0) check('the lie is stamped, and the room is told how many it fooled', /The lie/.test(text(H, '.opt[data-o="' + lie + '"] .stamp')) && /fooled 2 of 3\./.test(text(H, '#sc .ask')));
    n5++; await next(H);
  }
  const s5 = score(code);
  check('three people are featured, the lie is always the third thing they wrote, and the points add up', n5 === 3 && liesOk && [A, B, C, D].every((p) => (s5[pid(p)] - s4[pid(p)]) === (got5[pid(p)] || 0)), [A, B, C, D].map((p) => s5[pid(p)] - s4[pid(p)]));
  await home(H);

  /* ================= spot the fake, and its twist ================= */
  await start(H, [{ g: 'rule', n: 2 }]);
  const plan6 = row(code, 'h/run').plan;
  check('a two-card game deals one card and one twist card', ph(H) === 'vote' && plan6.n === 2 && plan6.tw > -1 && plan6.qs.length === 1 && !/twist/i.test(text(H, '#sc')));
  check('statements from the pack have nothing to hide', $$(H, '#sOpts .hidebtn').length === 0);
  let def6 = row(code, 'h/c/' + ctl(H).cid);
  await until(() => [A, B, C, D].every((p) => $$(p, '.choice').length === 3));
  [A, B, C, D].forEach((p) => click(p, '.choice[data-o="' + def6.ok[0] + '"]'));
  await until(() => ph(H) === 'reveal', 4000); await done(H);
  check('the made-up statement is stamped and put right', /Made up/.test(text(H, '.opt[data-o="' + def6.ok[0] + '"] .stamp')) && text(H, '.opt[data-o="' + def6.ok[0] + '"] .fixline') === def6.fix && /4 of 4 caught it\./.test(text(H, '#sc .ask')));
  await next(H);
  def6 = row(code, 'h/c/' + ctl(H).cid);
  const truth6 = def6.opts.find((o) => o.id !== def6.ok[0] && o.id !== def6.also).id;
  check('the last card hides a second fake, and the shared rows do not say so yet', ph(H) === 'vote' && def6.also && def6.also !== def6.ok[0] && !JSON.stringify(row(code, 'pub/case')).includes('also') && !('also' in row(code, 'pub/res')));
  await inStep(H, [A, B, C, D]);
  await until(() => [A, B, C, D].every((p) => $$(p, '.choice').length === 3));
  click(A, '.choice[data-o="' + def6.ok[0] + '"]'); click(B, '.choice[data-o="' + def6.also + '"]'); click(C, '.choice[data-o="' + truth6 + '"]'); click(D, '.choice[data-o="' + def6.also + '"]');
  await until(() => ph(H) === 'reveal', 4000); await done(H);
  const s6a = score(code);
  check('at first only the announced fake counts', s6a[pid(A)] - s5[pid(A)] === 800 && s6a[pid(B)] - s5[pid(B)] === 400 && /1 of 4 caught it\./.test(text(H, '#sc .ask')));
  await next(H);
  check('then the twist: a second statement was made up too', ph(H) === 'twist' && row(code, 'pub/res').also === def6.also && row(code, 'pub/res').alsoN === 2);
  await done(H);
  const s6 = score(code);
  check('everyone who chose the second fake gets their points back', s6[pid(B)] - s5[pid(B)] === 800 && s6[pid(D)] - s5[pid(D)] === 800 && s6[pid(C)] - s5[pid(C)] === 400 && s6[pid(A)] - s5[pid(A)] === 800);
  check('the stage stamps both and says what happened', /Also made up/.test(text(H, '.opt[data-o="' + def6.also + '"] .stamp')) && text(H, '.opt[data-o="' + def6.also + '"] .fixline') === def6.fix2 && text(H, '#sc .ask') === I.GAMES.rule.twistSay[2]);
  await until(() => padView(B) === 'result' && /right all along/.test(padText(B)) && /made up too/.test(padText(A)));
  check('controllers hear it too', /You were right all along\./.test(padText(B)) && /\+400/.test(padText(B)) && /That one was made up too\./.test(padText(A)));
  await next(H); await next(H); await next(H); await next(H);
  check('and the game ends', ph(H) === 'lobby');

  /* ================= Just Me?: a secret show of hands ================= */
  await start(H, [{ g: 'just', n: 1 }]);
  const cid7 = ctl(H).cid;
  check('a card asks a question of the whole room', ph(H) === 'hand' && row(code, 'pub/case').tot === 4 && $$(H, '#sHands .hand').length === 4 && I.GAMES.just.deck.includes(row(code, 'pub/case').q));
  await until(() => [A, B, C, D].every((p) => $(p, '[data-y="1"]')));
  padRules(A, 'show of hands');
  click(A, '[data-y="1"]'); click(B, '[data-y="1"]'); click(C, '[data-y="0"]'); click(D, '[data-y="1"]');
  check('after answering, each person guesses the count', padView(A) === 'guess' && /How many of the 4 of us said yes\?/.test(padText(A)) && text(A, '[data-g]') === '2');
  padRules(A, 'guessing');
  click(A, '[data-d="1"]'); click(A, '[data-act="lockguess"]');
  click(B, '[data-act="lockguess"]');
  click(C, '[data-d="-1"]'); click(C, '[data-act="lockguess"]');
  for (let i = 0; i < 7; i++) click(D, '[data-d="1"]');
  const top7 = text(D, '[data-g]'); for (let i = 0; i < 9; i++) click(D, '[data-d="-1"]');
  check('the dial stops at everyone and at nobody', top7 === '4' && text(D, '[data-g]') === '0');
  click(D, '[data-act="lockguess"]');
  await until(() => ph(H) === 'handrev', 4000); await done(H);
  const bal = paths(code).filter((p) => p.startsWith('v/' + cid7 + 'h/'));
  check('the yes and no rows are keyed by ids that belong to nobody', bal.length === 4 && bal.every((p) => ![A, B, C, D].some((x) => p.endsWith('/' + pid(x)))) && !JSON.stringify(row(code, 'pub/res')).includes('"y"'));
  const res7 = row(code, 'pub/res'), s7 = score(code);
  check('the stage counts three hands of four, and names the closest guess', res7.yes === 3 && res7.tot === 4 && $$(H, '#sHands .hand.up').length === 3 && /^3 of 4$/.test(text(H, '#sTally').trim().replace(/\s+/g, ' ')) && /guessed it exactly/.test(text(H, '#sSub')));
  check('exact, one away and two away score as they should', s7[pid(A)] - s6[pid(A)] === 600 && s7[pid(B)] - s6[pid(B)] === 400 && s7[pid(C)] - s6[pid(C)] === 200 && s7[pid(D)] === s6[pid(D)], [A, B, C, D].map((p) => s7[pid(p)] - s6[pid(p)]));
  await inStep(H, [A, B, C, D]); await until(() => padView(A) === 'result' && padView(B) === 'result');
  check('each controller says how close that person was', /It was 3 of 4\./.test(padText(A)) && /You guessed it exactly\./.test(padText(A)) && /You guessed 2\./.test(padText(B)));
  await next(H); await next(H); await next(H); await next(H);

  /* ================= Same Brain: one word each ================= */
  await start(H, [{ g: 'brain', n: 2 }]);
  await until(() => [A, B, C, D].every((p) => $(p, '[data-word]')));
  padRules(A, 'one word');
  click(A, '[data-act="sendword"]'); check('a blank word is not sent', padView(A) === 'word');
  [[A, 'Coffee'], [B, 'coffee '], [C, 'the Coffees'], [D, 'tea']].forEach(([p, w]) => { type(p, '[data-word]', w); click(p, '[data-act="sendword"]'); });
  await until(() => ph(H) === 'wordrev', 4000); await done(H);
  const res8 = row(code, 'pub/res'), s8 = score(code);
  check('matching words stack into one tower, and loners are listed', res8.stacks.length === 1 && res8.stacks[0].p.length === 3 && res8.singles.join() === 'tea' && $$(H, '#sTowers .tower').length === 1 && $$(H, '#sTowers .brick').length === 3 && /tea/.test(text(H, '#sLoners')));
  check('each match scores', s8[pid(A)] - s7[pid(A)] === 300 && s8[pid(D)] === s7[pid(D)]);
  await until(() => padView(A) === 'result' && padView(D) === 'result');
  check('controllers say who shares a brain', /Same brain as/.test(padText(A)) && /One of a kind\./.test(padText(D)));
  await next(H);
  await inStep(H, [A, B, C, D]);
  await until(() => [A, B, C, D].every((p) => $(p, '[data-word]')));
  [[A, 'x'], [B, 'x'], [C, 'y'], [D, 'y']].forEach(([p, w]) => { type(p, '[data-word]', w); click(p, '[data-act="sendword"]'); });
  await until(() => ph(H) === 'wordrev', 4000); await done(H); await next(H);
  const twin = row(code, 'pub/twin');
  check('at the end each person has a brain twin: whoever matched them most', ph(H) === 'scores' && twin[pid(A)][0] === pid(B) && twin[pid(A)][1] === 2 && twin[pid(D)][0] === pid(C) && twin[pid(D)][1] === 1);
  await until(() => padView(A) === 'scores');
  check('and the controller names them', /Your brain twin is Bo\. You matched 2 times\./.test(padText(A)));
  check('each round\'s stacks are kept as their own small row', paths(code).filter((p) => p.startsWith('h/w/')).length === 2);
  await next(H); await next(H); await next(H);

  /* ================= a set: games in a row, one running score ================= */
  click(H, '#hCtl [data-act="pick"]'); click(H, '.tile[data-set="opener"]');
  await until(() => ph(H) === 'intro');
  check('a set carries its games and its name', row(code, 'pub/cfg').set.map((x) => x.g + x.n).join() === 'just2,brain2,rule2' && row(code, 'pub/cfg').nm === 'The Opener' && $$(H, '#sc .pips i').length === 3 && $$(H, '#sc .pips i.on').length === 1);
  await H.__ice.fn.hostPlay([{ g: 'just', n: 1 }, { g: 'rule', n: 1 }], 'Short set');
  await until(() => ctl(H).g === 'just' && row(code, 'pub/cfg').nm === 'Short set'); await next(H);
  await skip(H); await done(H); await next(H);
  check('between games the button says Next game', ph(H) === 'scores' && $$(H, '#hCtl .btn')[0].textContent === 'Next game');
  await next(H);
  check('the next game\'s title card follows, with its place in the set', ph(H) === 'intro' && ctl(H).gi === 1 && ctl(H).g === 'rule' && $$(H, '#sc .pips i.on').length === 2);
  await next(H);
  check('a one-card game of Spot the Fake has no twist', ph(H) === 'vote' && row(code, 'h/run').plan.tw === -1 && /^p\d+g1r0c0$/.test(ctl(H).cid));
  await skip(H); await done(H); await next(H);
  check('the last game of a set ends on Finish and the podium', $$(H, '#hCtl .btn')[0].textContent === 'Finish'); await next(H);
  check('with one running score', ph(H) === 'podium' && score(code)[pid(A)] >= s8[pid(A)]);
  await next(H); await next(H);

  /* ================= reloads and late arrivals ================= */
  I.SECS.vote = 30;
  await start(H, [{ g: 'bot', n: 1 }]);
  await until(() => $(A, '[data-text]') && $(B, '[data-text]'));
  type(A, '[data-text]', 'draft not sent yet');
  type(B, '[data-text]', 'bee again'); click(B, '[data-act="send"]');
  await until(() => row(code, 'a/' + ctl(H).rid + '/' + pid(B)));
  const B2 = load(SITE + '?join=' + code, { seed: { ['ice-me-' + code]: B.localStorage.getItem('ice-me-' + code) } });
  B.__ice.fn.stopLoops();
  check('a reloaded controller is the same player, and knows it already answered', (await until(() => B2.__ice.pad() && B2.__ice.pad().joined && padView(B2) === 'sent')) && pid(B2) === pid(B) && /bee again/.test(padText(B2)) && $$(H, '#sCrowd .who').length === 4);
  const L = await joinPad(code, 'Late');
  check('someone who arrives mid-round can play straight away', (await until(() => padView(L) === 'write')) && (await until(() => $$(H, '#sCrowd .who').length === 5)));
  type(L, '[data-text]', 'late answer'); click(L, '[data-act="send"]');
  type(A, '[data-text]', 'ay again'); click(A, '[data-act="send"]');
  await until(() => row(code, 'a/' + ctl(H).rid + '/' + pid(A)));
  await skip(H);
  check('the vote opens', ph(H) === 'vote');
  const def9 = row(code, 'h/c/' + ctl(H).cid);
  await until(() => $$(C, '.choice').length === def9.opts.length);
  click(C, '.choice[data-o="' + def9.ok[0] + '"]');
  await until(() => row(code, 'v/' + ctl(H).cid + '/' + pid(C)));
  /* the stage reloads mid-vote */
  H.__ice.fn.stopLoops(); I.host().dead = true;
  const H2 = load(SITE + '?host=' + code + '#k=' + hkey);
  await until(() => H2.__ice.host() && H2.__ice.host().started && H2.__ice.Stage.on);
  const I2 = H2.__ice;
  check('a reloaded stage picks the vote up where it was', ph(H2) === 'vote' && $$(H2, '#sOpts .opt').length === def9.opts.length && H2.document.documentElement.getAttribute('data-theme') === 'sketch' && H2.App.voice === 'cheeky' && H2.App.pace === 1.5 && /1 of 5 voted/.test(text(H2, '#sMeter')));
  const before9 = row(code, 'h/score')[pid(C)];
  await skip(H2); await done(H2);
  check('points are given once, by the stage that is now running', row(code, 'h/score')[pid(C)] === before9 + 500);
  /* reload again on the finished reveal: it must land on the same final picture, and not pay twice */
  H2.__ice.fn.stopLoops(); I2.host().dead = true;
  const H3 = load(SITE + '?host=' + code + '#k=' + hkey), I3 = H3.__ice;
  await until(() => I3.host() && I3.host().started && I3.Stage.on);
  check('a stage reloaded on a finished reveal shows the finished reveal', ph(H3) === 'reveal' && ctl(H3).done === 1 && /The real AI/.test(text(H3, '.opt.real .stamp')) && /spotted it\./.test(text(H3, '#sc .ask')) && row(code, 'h/score')[pid(C)] === before9 + 500);
  await next(H3); await next(H3);
  check('and carries on to the end', ph(H3) === 'podium');
  await next(H3); await next(H3);

  /* ================= a clock that runs out ================= */
  I3.SECS.write = 0.25; I3.SECS.vote = 0.25; I3.GAMES.crowd.secs = 0.25;
  await start(H3, [{ g: 'crowd' }]);
  check('with nobody writing, the clock ends the round by itself', await until(() => ph(H3) === 'scores' && ctl(H3).thin === 1, 4000));
  await next(H3); await next(H3); await next(H3);
  I3.SECS.write = 30;
  await start(H3, [{ g: 'bot', n: 1 }]);
  await until(() => $(A, '[data-text]'));
  type(A, '[data-text]', 'only me'); click(A, '[data-act="send"]');
  await until(() => row(code, 'a/' + ctl(H3).rid + '/' + pid(A)));
  await skip(H3);
  const quiet = (await until(() => ph(H3) === 'reveal', 4000)) && (await done(H3));
  check('a vote nobody casts ends on its own and says so', quiet && /No votes this time\./.test(text(H3, '#sc .ask')), { ph: ph(H3), done: ctl(H3).done, ask: text(H3, '#sc .ask'), votes: row(code, 'v/' + ctl(H3).cid) });
  await home(H3);
  I3.SECS.write = 70; I3.SECS.vote = 30; I3.GAMES.crowd.secs = 60;

  /* ================= Only You: the secret card ================= */
  click(H3, '#hCtl [data-act="pick"]'); click(H3, '#shelf [data-fresh]');
  check('scores can start from zero', await until(() => Object.keys(row(code, 'pub/score')).length === 0 && Object.keys(row(code, 'h/score')).length === 0));
  click(H3, '.tile[data-g="only"]');
  await until(() => ph(H3) === 'intro'); await next(H3);
  check('everyone is told to open a secret card, and the stage keeps the secret', ph(H3) === 'card' && /Everyone has a secret card/.test(text(H3, '#sc')) && !text(H3, '#sc').includes(I.GAMES.only.card.say) && $$(H3, '#hCtl .btn')[0].textContent === 'Start the mingle');
  await until(() => [A, C, D].every((p) => $(p, '[data-act="open"]')));
  padRules(A, 'secret card');
  click(A, '[data-act="open"]'); click(C, '[data-act="open"]');
  check('opening it is counted on the stage', (await until(() => /2 of 5 have opened it/.test(text(H3, '#sMeter')))) && $(A, '.scard').classList.contains('open') && padText(A).includes(I.GAMES.only.card.say) && padText(A).includes(I.GAMES.only.card.mission));
  await next(H3);
  check('the mingle starts a four-minute clock and asks one question', ph(H3) === 'mingle' && ctl(H3).dur === 240000 * 1.5 && text(H3, '#sc').includes(I.GAMES.only.ask) && /:\d\d/.test(text(H3, '#sBig')));
  onePrimary(H3, 'mingle');
  await until(() => $$(A, '[data-mark]').length === 3);
  click(A, '[data-mark="1"]'); click(A, '[data-mark="2"]');
  check('each chat is one tap', (await until(() => /2 chats so far/.test(text(H3, '#sMeter')))) && $$(A, '[data-mark][aria-pressed="true"]').length === 2);
  click(A, '[data-mark="2"]');
  check('and one tap takes it back', $$(A, '[data-mark][aria-pressed="true"]').length === 1);
  click(H3, '#hCtl [data-act="skip"]');
  await until(() => ph(H3) === 'flip'); await done(H3);
  check('the reveal: every card said the same thing', text(H3, '#sFlipT') === I.GAMES.only.flip && text(H3, '#sSub').includes(I.GAMES.only.card.say) && $$(H3, '#sDeck .mini.flip').length === $$(H3, '#sDeck .mini').length);
  await until(() => padView(A) === 'result');
  check('controllers land on the same line', /Every card said the same thing\./.test(padText(A)) && /It was never only you\./.test(padText(A)));
  await next(H3);
  check('a game with no points skips the podium and goes to the closing line', ph(H3) === 'close' && text(H3, '.closing') === I.GAMES.only.bridge);
  await next(H3);

  /* ================= a full room ================= */
  const big = await openHost();
  for (let i = 0; i < 64; i++) { const id = 'zz' + String(i).padStart(4, '0'); put(big.code, 'p/' + id, { n: ('Player ' + i + ' xxxxxx').slice(0, 12), a: 's' + (i % 10) + 'c' + (i % 8), t: 1000 + i }); put(big.code, 'here/' + id, { w: 0, c: 0, f: 0, z: 0 }); }
  await until(() => $$(big.H, '#sCrowd .who').length === 60 && row(big.code, 'pub/nm') && Object.keys(row(big.code, 'pub/nm')).length === 60, 6000);
  check('the room holds sixty: the first sixty to arrive', big.H.__ice.fn.roster(big.H.__ice.host().S).length === 60 && Object.keys(row(big.code, 'pub/nm')).length === 60 && !row(big.code, 'pub/nm').zz0060);
  const X = load(SITE + '?join=' + big.code);
  check('the sixty-first is told the game is full', await until(() => views(X) === 'gate' && /full/.test(text(X, '#gate'))));
  await start(big.H, [{ g: 'brain', n: 1 }]);
  for (let i = 0; i < 60; i++) put(big.code, 'a/' + ctl(big.H).rid + '/zz' + String(i).padStart(4, '0'), { w: i < 40 ? 'coffee' : i < 55 ? 'tea' : 'w' + i });
  await until(() => Object.keys((big.H.__ice.host().S.a || {})[ctl(big.H).rid] || {}).length === 60);
  await skip(big.H); await done(big.H);
  check('sixty words make two tall towers', row(big.code, 'pub/res').stacks.map((s) => s.p.length).join() === '40,15' && $$(big.H, '#sTowers .tower').length === 2 && /\+33 more/.test(text(big.H, '#sTowers')) && score(big.code).zz0000 === 750);
  await next(big.H);
  check('the scores show the top six and say the rest are on their own screens', big.H.__ice.fn.ctlOf(big.H.__ice.host().S).ph === 'scores' && $$(big.H, '#sBoard .row').length === 6 && /and 54 more/.test(text(big.H, '#sc')));
  await next(big.H); await next(big.H); await next(big.H);
  await start(big.H, [{ g: 'just', n: 1 }]);
  const bc = ctl(big.H).cid;
  for (let i = 0; i < 60; i++) { put(big.code, 'v/' + bc + 'h/b' + i, { y: i < 37 ? 1 : 0 }); put(big.code, 'a/' + bc + '/zz' + String(i).padStart(4, '0'), { g: i }); }
  await until(() => Object.keys((big.H.__ice.host().S.a || {})[bc] || {}).length === 60);
  await skip(big.H); await done(big.H);
  check('sixty hands are counted and drawn in three rows', row(big.code, 'pub/res').yes === 37 && $$(big.H, '#sHands .hand').length === 60 && $$(big.H, '#sHands .hand.up').length === 37 && row(big.code, 'pub/pts').d.zz0037 === 600 && row(big.code, 'pub/pts').d.zz0041 === 400 && row(big.code, 'pub/pts').d.zz0046 === 200 && !row(big.code, 'pub/pts').d.zz0050);
  let worst = 0, longest = 0;
  env.DB._rows.forEach((v, k) => { worst = Math.max(worst, v.value.length); longest = Math.max(longest, k.split('|')[1].length); });
  check('every row the kit wrote, in every session so far, fits the worker\'s limits', worst <= 4000 && longest <= 40, { worst, longest });
  check('a controller\'s read stays small however big the room', (await call('GET', '/api/state?tool=ice&code=' + big.code + '&prefix=pub&times=here')).data.state.pub && !(await call('GET', '/api/state?tool=ice&code=' + big.code + '&prefix=pub')).data.state.p);
  big.H.__ice.fn.stopLoops();

  /* ================= ending a session ================= */
  click(H3, '#hMenu'); click(H3, '#menu [data-act="end"]');
  check('ending waits a moment and offers Undo', /Undo/.test(text(H3, '#toast')) && $(H3, '#toast').classList.contains('on') && paths(code).length > 10);
  click(H3, '#toast [data-act="undo"]'); await sleep(350);
  check('Undo keeps everything', paths(code).length > 10 && !$(H3, '#toast').classList.contains('on') && views(H3) === 'stageWrap');
  click(H3, '#hMenu'); click(H3, '#menu [data-act="end"]');
  check('ending deletes the session from the worker', await until(() => paths(code).length === 0, 4000));
  check('the stage says so, with a way to start another', (await until(() => views(H3) === 'gate')) && /Session ended/.test(text(H3, '#gate')) && /deleted/.test(text(H3, '#gate')) && $(H3, '#gateGo') && H3.localStorage.getItem('ice-host') === null);
  check('controllers are told the game is over', (await until(() => views(A) === 'gate', 4000)) && /That's all/.test(text(A, '#gate')));
  click(H3, '#gateGo');
  check('Start another goes back to the front page', views(H3) === 'studio' && H3.location.search === '');
  const G1 = load(SITE + '?host=' + code + '#k=' + hkey);
  check('an old stage link says the session has ended', await until(() => views(G1) === 'gate' && /Session ended/.test(text(G1, '#gate'))));
  const G2 = load(SITE + '?host=' + big.code + '#k=wrongwrongwrong12');
  check('a stage link with the wrong key opens nothing', await until(() => views(G2) === 'gate' && /doesn't open a live game/.test(text(G2, '#gate'))));

  /* ================= the reveal as a show, with motion on ================= */
  const M = await room(['Mo', 'Ned', 'Ola'], { app: { anim: true, speed: 6 } });
  await start(M.H, [{ g: 'bot', n: 1 }]);
  await until(() => M.pads.every((p) => $(p, '[data-text]')), 6000);
  M.pads.forEach((p, i) => { type(p, '[data-text]', 'show answer ' + i); click(p, '[data-act="send"]'); });
  await until(() => ph(M.H) === 'vote', 6000);
  const defM = row(M.code, 'h/c/' + ctl(M.H).cid);
  await until(() => M.pads.every((p) => $$(p, '.choice').length === 4));
  click(M.pads[0], '.choice[data-o="' + defM.ok[0] + '"]'); click(M.pads[1], '.choice:not([disabled])'); click(M.pads[2], '.choice[data-o="' + defM.ok[0] + '"]');
  await until(() => ph(M.H) === 'reveal', 6000);
  check('with motion on, controllers wait while the stage plays the reveal', !ctl(M.H).done && (await until(() => padView(M.pads[0]) === 'watch')) && /Eyes up/.test(padText(M.pads[0])));
  check('the show reaches its end by itself and then tells the controllers', (await until(() => !!ctl(M.H).done, 8000)) && /spotted it\./.test(text(M.H, '#sc .ask')) && $(M.H, '.opt.real .stamp') && M.H.__ice.Stage.errs.length === 0, M.H.__ice.Stage.errs.map(String));
  await next(M.H);
  check('scores count up to the same totals', (await until(() => text(M.H, '#sBoard .row .pt') === String(Math.max(...Object.values(score(M.code)))), 4000)));
  await start(M.H, [{ g: 'rule', n: 2 }]);
  await skip(M.H);
  check('Next during a reveal finishes it first, and only then moves on', ph(M.H) === 'reveal' && (click(M.H, '#hCtl [data-act="next"]'), await until(() => !!ctl(M.H).done)) && ph(M.H) === 'reveal');
  await next(M.H); await skip(M.H); await done(M.H); await next(M.H);
  check('the twist plays as a show too', ph(M.H) === 'twist' && (await done(M.H)) && /Also made up/.test(text(M.H, '#sOpts')) && M.H.__ice.Stage.errs.length === 0);
  M.H.__ice.fn.stopLoops();

  /* ================= the practice room ================= */
  const T = load(SITE, { net: false, app: { anim: true } });
  await until(() => $(T, '#stDrive'));
  click(T, '#stDrive');
  await until(() => T.__ice.Stage.on && T.__ice.fn.roster(T.__ice.host().S).length === 8, 6000);
  check('the practice room fills with seven bots and you', views(T) === 'stageWrap' && /Practice room/.test(text(T, '#sc')) && $(T, '#stageWrap').classList.contains('drive') && T.__ice.drivePad().joined && !$(T, '#sQr'));
  check('the player\'s screen beside the stage is a real controller', $(T, '#drivePad').getAttribute('data-view') === 'lobby' && /You're in/.test(text(T, '#drivePad')));
  click(T, '#hCtl [data-act="pick"]'); click(T, '.tile[data-g="just"]');
  await until(() => ph(T) === 'intro'); click(T, '#hCtl [data-act="next"]');
  await until(() => ph(T) === 'hand' && $(T, '#drivePad [data-y="1"]'));
  click(T, '#drivePad [data-y="1"]'); click(T, '#drivePad [data-act="lockguess"]');
  check('bots answer, you answer, and the round ends by itself', await until(() => ph(T) === 'handrev', 6000));
  check('the practice player scores like anyone else', (await until(() => !!ctl(T).done, 8000)) && T.__ice.Sim.rows['pub/res'].v.tot === 8 && typeof T.__ice.Sim.rows['a/' + ctl(T).cid + '/youyou'].v.g === 'number');
  click(T, '#hMenu'); click(T, '#menu [data-act="end"]');
  check('leaving it goes back to the front page, and nothing ever went online', views(T) === 'studio' && T.tried === 0 && !T.__ice.Bots.on);
  click(T, '#stOpen');
  check('opening real doors without a connection says so, and offers the practice room', await until(() => /Couldn't start a session/.test(text(T, '#stErr')) && !$(T, '#stOpen').disabled));

  /* ================= the feedback board's rebuild ================= */
  const K = load(SITE, { net: false });
  await until(() => K.EPKit && K.EPKit.tool && $(K, '#stOpen'));
  const tool = K.EPKit.tool, screens = tool.sections().reduce((a, s) => a.concat(s.screens), []), wrong = [];
  for (const sc of screens) { let ok = false; try { ok = tool.restore({ screen: sc, settings: { theme: 'type' } }); } catch (e) { wrong.push(sc + ': ' + e.message); } if (ok !== true || tool.screen() !== sc) wrong.push(sc + ' gave ' + tool.screen()); }
  check('the kit can rebuild every screen with a made-up room, one after another', tool.id === 'icebreakers' && tool.name === 'Icebox' && screens.length >= 50 && new Set(screens).size === screens.length && !wrong.length, wrong.slice(0, 5));
  check('rebuilding never touches the network or the real room', K.tried === 0 && tool.restore({ screen: 'nope' }) === false);
  tool.restore({ screen: 'stage-reveal', settings: {} });
  check('typed words and names on the stage are marked so a comment never carries them', ['#sOpts', '#sc .ask', '#say'].every((s) => $(K, s) && $(K, s).hasAttribute('data-feedback-private')) && tool.restore({ screen: 'stage-write', settings: {} }) && $(K, '#sCrowd').hasAttribute('data-feedback-private') && tool.restore({ screen: 'stage-scores', settings: {} }) && $(K, '#sBoard').hasAttribute('data-feedback-private'));
  tool.restore({ screen: 'pad-vote', settings: {} });
  check('and on a controller', $(K, '#pad .me').hasAttribute('data-feedback-private') && $(K, '#pad .pm').hasAttribute('data-feedback-private'));
  check('what the kit records about a moment names no person', (() => { tool.restore({ screen: 'stage-vote', settings: {} }); const s = JSON.stringify(tool.state()); return /"players":8/.test(s) && !/Priya|demo0/.test(s); })());

  /* ================= the host's safety nets: a late answer, words taken down, quick taps ================= */
  const Q = await room(['Ann', 'Bob', 'Cat', 'Dan']);
  await start(Q.H, [{ g: 'said' }]);
  await until(() => Q.pads.every((p) => $(p, '[data-text]')));
  const qrid = ctl(Q.H).rid;
  Q.H.__ice.fn.stopLoops();      /* the stage stops looking, as if its last look were a second old */
  await sleep(60);
  Q.pads.slice(0, 3).forEach((p, i) => { type(p, '[data-text]', ['first words', 'second words', 'third words'][i]); click(p, '[data-act="send"]'); });
  await until(() => Q.pads.slice(0, 3).every((p) => row(Q.code, 'a/' + qrid + '/' + pid(p))));
  const unseen = Object.keys((Q.H.__ice.host().S.a || {})[qrid] || {}).length;
  await Q.H.__ice.fn.hostSkip();
  await until(() => ph(Q.H) === 'vote');
  check('an answer sent in the last second still counts: the stage looks once more before it locks', unseen === 0 && ph(Q.H) === 'vote' && row(Q.code, 'h/run').plan.cases === 3);
  Q.H.__ice.fn.startLoops(); await settled(Q.H);
  await until(() => $(Q.H, '.quote .hidebtn')); await inStep(Q.H, Q.pads);
  const c0 = ctl(Q.H).cid, d0 = row(Q.code, 'h/c/' + c0), voter0 = Q.pads.find((p) => pid(p) !== d0.ok[0]);
  await until(() => $(voter0, '.choice[data-o="' + d0.ok[0] + '"]'));
  click(voter0, '.choice[data-o="' + d0.ok[0] + '"]'); await until(() => row(Q.code, 'v/' + c0 + '/' + pid(voter0)));
  click(Q.H, '.quote .hidebtn');
  await until(() => ctl(Q.H).cid !== c0 && ph(Q.H) === 'vote', 4000); await settled(Q.H);
  check('taking the words down in a who-said-it round voids it: nothing scored, nobody named, on to the next answer', row(Q.code, 'h/c/' + c0).x === 1 && row(Q.code, 'h/c/' + c0).q === '' && Object.keys(score(Q.code)).length === 0 && (row(Q.code, 'pub/res') || {}).cid !== c0 && ctl(Q.H).c === 1 && !JSON.stringify(row(Q.code, 'h/c/' + c0)).includes(d0.q) && row(Q.code, 'pub/case').q !== d0.q);
  await inStep(Q.H, Q.pads);
  const c1 = ctl(Q.H).cid, d1 = row(Q.code, 'h/c/' + c1), tapper = Q.pads.find((p) => pid(p) !== d1.ok[0]);
  await until(() => $$(tapper, '.choice:not([disabled])').length >= 2);
  const [tx, ty] = $$(tapper, '.choice:not([disabled])').slice(0, 2).map((b) => b.dataset.o), realFetch = tapper.fetch;
  let votePosts = 0; tapper.fetch = async (u, init) => { if (init && init.method === 'POST' && /"path":"v\//.test(String(init.body)) && votePosts++ === 0) await sleep(140); return realFetch(u, init); };
  click(tapper, '.choice[data-o="' + tx + '"]'); click(tapper, '.choice[data-o="' + ty + '"]');
  await sleep(320);
  check('two quick taps land in order even when the first request is slow: the second vote is the one that stands', votePosts === 2 && row(Q.code, 'v/' + c1 + '/' + pid(tapper)).o === ty && $(tapper, '.choice[data-o="' + ty + '"]').getAttribute('aria-pressed') === 'true');
  tapper.fetch = realFetch;
  await home(Q.H);
  await start(Q.H, [{ g: 'truths' }]);
  await until(() => Q.pads.every((p) => $(p, '[data-s="2"]')));
  Q.pads.slice(0, 2).forEach((p, i) => { type(p, '[data-s="0"]', 'true a' + i); type(p, '[data-s="1"]', 'true b' + i); type(p, '[data-s="2"]', 'a lie ' + i); click(p, '[data-act="send3"]'); });
  await until(() => Q.pads.slice(0, 2).every((p) => row(Q.code, 'a/' + ctl(Q.H).rid + '/' + pid(p))));
  await skip(Q.H); await until(() => $(Q.H, '#sOpts .hidebtn'));
  const t0 = ctl(Q.H).cid;
  check('a person\'s own three statements can be taken down too', ph(Q.H) === 'vote' && $$(Q.H, '#sOpts .hidebtn').length === 3);
  click(Q.H, '#sOpts .hidebtn');
  await until(() => ctl(Q.H).cid !== t0 || ph(Q.H) !== 'vote', 4000); await settled(Q.H);
  check('and that voids their turn', row(Q.code, 'h/c/' + t0).opts.filter((o) => o.x === 1).length === 1 && Object.keys(score(Q.code)).length === 0 && (row(Q.code, 'pub/res') || {}).cid !== t0);
  check('the buttons that hide an answer or remove a player cannot be tapped by accident: they wake on hover or focus', /\.hidebtn\{[^}]*pointer-events:none/.test(html) && /\.kick\{[^}]*pointer-events:none/.test(html) && /\.hidebtn:focus-visible\{[^}]*pointer-events:auto/.test(html));
  Q.H.__ice.fn.stopLoops();

  /* ================= extremes ================= */
  const E = await room(['WWWWWWWWWWWW', 'i'], { app: { anim: false } });
  await start(E.H, [{ g: 'bot', n: 1 }]);
  await until(() => E.pads.every((p) => $(p, '[data-text]')));
  type(E.pads[0], '[data-text]', 'W'.repeat(400)); click(E.pads[0], '[data-act="send"]'); type(E.pads[1], '[data-text]', '.'); click(E.pads[1], '[data-act="send"]');
  await until(() => ph(E.H) === 'vote', 4000);
  check('the longest answer and the shortest both make it to the vote, whole and unbroken', $$(E.H, '#sOpts .opt').length === 3 && $$(E.H, '#sOpts .tt').some((x) => x.textContent === 'W'.repeat(120)) && $$(E.H, '#sOpts .tt').some((x) => x.textContent === '.') && /overflow-wrap:anywhere/.test(html));
  check('two players are enough for a game', ph(E.H) === 'vote' && E.H.__ice.GAMES.bot.min === 2);
  await skip(E.H); await done(E.H); await next(E.H);
  check('a twelve-letter name is shown whole on the board', $$(E.H, '#sBoard .row .nm').some((x) => x.textContent === 'WWWWWWWWWWWW'));
  E.H.__ice.fn.stopLoops();

  check('no script errors anywhere', errors.length === 0, errors.slice(0, 4));
  check('no stage hit an error while moving the game on', [H, H2, H3, big.H, M.H, T, Q.H, E.H].every((w) => !w.__ice.Host.err && !w.__ice.Stage.errs.length));
  doms.forEach((d) => { try { d.window.__ice.fn.stopLoops(); d.window.__ice.Bots.stop(); d.window.close(); } catch (e) {} });
  console.log(failures ? failures + ' FAILED' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
