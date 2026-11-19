/* qa-throughline.mjs: tests ../../throughline/index.html (the Throughline story page) in a simulated browser.
   Run from the repo root, after: npm install jsdom
     node _backend/tests/qa-throughline.mjs
   The page is a story with made-up numbers. It stores nothing and sends nothing, and this test holds it to that. */
import { JSDOM, VirtualConsole } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import os from 'os';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '../../throughline/index.html');
const html = fs.readFileSync(file, 'utf8');
let pass = 0, fail = 0;
function ok(name, cond, extra) { if (cond) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name + (extra ? '  ' + extra : '')); } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const flat = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

/* ---------- the file itself ---------- */
ok('no em or en dashes', !/[—–]/.test(html));
ok('asks search engines to stay away', /<meta name="robots" content="noindex, nofollow">/.test(html));
ok('loads the feedback kit', html.includes('<script src="/pt/assets/kit/feedback.js" defer></script>'));
ok('uses no browser storage or cookies', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(html));
ok('makes no calls of its own', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/.test(html));
ok('carries no analytics', !/clarity\.ms|googletagmanager|google-analytics/.test(html));
const loads = [...html.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)="(https?:\/\/[^"]+)"/g)].map((m) => new URL(m[1]).host);
ok('loads only Google Fonts from outside pt', loads.every((h) => h === 'fonts.googleapis.com' || h === 'fonts.gstatic.com'), [...new Set(loads)].join(', '));
ok('says the week is invented', /The week shown is an invented example/.test(html) && /every number, including the industry comparison, is made up/.test(html));
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
let parses = scripts.length > 0;
scripts.forEach((s, i) => { const f = path.join(os.tmpdir(), 'tl-' + process.pid + '-' + i + '.js'); fs.writeFileSync(f, s);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { parses = false; } fs.unlinkSync(f); });
ok('every script parses', parses);

/* ---------- a visit ---------- */
function open() {
  const errs = [], vc = new VirtualConsole();
  vc.on('jsdomError', (e) => { if (!/Could not load script|Not implemented/.test(e.message)) errs.push(e.message); });
  const dom = new JSDOM(html, { url: 'https://ep.github.io/pt/throughline/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  return { w: dom.window, d: dom.window.document, errs };
}
function type(w, el, v) { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); }

const { w, d, errs } = open();
await sleep(400);
const $ = (s) => d.querySelector(s), $$ = (s) => [...d.querySelectorAll(s)];
w.TL.fast(true);

const PANELS = ['hero', 'why', 'shifts', 'setup', 'week', 'who', 'mon-am', 'mon-pm', 'tue', 'wed', 'thu', 'fri', 'report', 'faculty', 'platform', 'close'];
ok('all sixteen panels are there, in order', JSON.stringify($$('main section[id], body > section[id]').map((s) => s.id).filter((i) => PANELS.includes(i))) === JSON.stringify(PANELS));
ok('one h1', $$('h1').length === 1 && /behavior change/.test(flat($('h1'))));
ok('names fill in everywhere', $$('[data-b="school"]').length > 2 && $$('[data-b="school"]').every((e) => e.textContent === 'Harvard Business School') && $$('[data-b="client"]').every((e) => e.textContent === 'Nike'));

/* the hook the feedback board uses */
const t = w.EPKit && w.EPKit.tool;
ok('the hook has a plain id', t && t.id === 'throughline' && /id: "throughline"/.test(html));
const secs = t.sections(), screens = secs.reduce((a, s) => a.concat(s.screens), []);
ok('sections() lists 22 screens once each', screens.length === 22 && new Set(screens).size === 22 && secs.every((s) => s.name && s.screens.length));
let opened = 0;
for (const sc of screens) { if (t.restore({ screen: sc, settings: {} }) === true && t.screen() === sc) opened++; }
ok('every screen opens and names itself', opened === 22, opened + ' of 22');
ok('an unknown screen is refused', t.restore({ screen: 'nope' }) === false && t.restore(null) === false);
t.restore({ screen: 'setup-week' });
ok('a setup screen opens on its step', w.TL.S.step === 2 && $('#setup').hasAttribute('data-here'));
t.restore({ screen: 'tue-result' });
ok('a result screen shows the answered mirror', w.TL.S.play.m3 && !w.TL.S.play.m1 && $('[data-skip="m3"]').textContent.trim() === 'Start again');
t.restore({ screen: 'hero' });
ok('opening a screen clears the last one', !w.TL.S.play.m3 && $('[data-skip="m3"]').textContent.trim() === 'Answer for me' && $('#hero').hasAttribute('data-here') && !$('#tue').hasAttribute('data-here'));
ok('state() gives settings only', JSON.stringify(Object.keys(t.state())) === '["step","day"]');

/* the three shifts, typed by the visitor */
const nasty = '<img src=x onerror=1> & "more"';
type(w, $('#st0'), nasty);
ok('typed words are never run as HTML', !d.querySelector('img[src="x"]') && d.body.textContent.includes('<img src=x onerror=1>'));
ok('a typed shift reaches the report', flat($('#rep')).includes('<img src=x onerror=1>'));
ok('typed fields are private to the feedback kit', ['#sf0', '#st0'].every((s) => $(s).hasAttribute('data-feedback-private')));
type(w, $('#st0'), 'Agreeing up front how we will make the decision');

/* setup */
const steps = $$('#steps [data-step]');
ok('setup has four steps', steps.length === 4);
steps[1].click();
ok('the library offers seven mirror tools', $$('#pane [data-lib]').length === 7, String($$('#pane [data-lib]').length));
steps[2].click();
ok('the week step draws', flat($('#pane')).length > 40);
steps[3].click();
ok('the name fields are private', $('#in-school').hasAttribute('data-feedback-private') && $('#in-client').hasAttribute('data-feedback-private'));
type(w, $('#in-school'), 'Test <b>School</b>');
ok('a new school name shows everywhere, as text', $$('[data-b="school"]').every((e) => e.textContent === 'Test <b>School</b>') && !d.querySelector('[data-b="school"] b'));
type(w, $('#in-school'), '');
ok('an empty name falls back or stays empty without breaking', errs.length === 0);
type(w, $('#in-school'), 'Harvard Business School');
ok('colour swatches switch', (() => { const b = $$('#sw button[data-c]'); if (b.length < 2) return false; b[1].click(); const on = w.TL.S.color; b[0].click(); return on !== w.TL.S.color; })());

/* the three mirror tools */
for (const m of ['m1', 'm2', 'm3']) {
  const b = () => $('[data-skip="' + m + '"]');
  b().click(); await sleep(60);
  ok(m + ': answered, the phone and the group screen fill in', !!w.TL.S.play[m] && flat($('#p-' + m)).length > 60 && flat($('#g-' + m)).length > 60 && b().textContent.trim() === 'Start again');
  b().click(); await sleep(60);
  ok(m + ': starts again', !w.TL.S.play[m] && b().textContent.trim() === 'Answer for me');
}

/* the director's view */
ok('five days and nine groups', $$('#days [data-day]').length === 5 && $$('#tiles [data-grp]').length === 9);
$$('#days [data-day]')[0].click();
const mon = flat($('#tiles'));
$$('#days [data-day]')[4].click();
ok('the forecast changes by day', flat($('#tiles')) !== mon);
$$('#tiles [data-grp]')[3].click();
ok('a group opens with its own numbers', /Group 4/.test(flat($('#dside'))) && /of 6/.test(flat($('#dside'))));
const push = $('#dside [data-push]');
if (push) push.click();
ok('sending a mirror tool again is acknowledged', !!push && Object.keys(w.TL.S.sent).length === 1);

/* the sponsor report */
w.TL.play(); await sleep(400);
const rep = flat($('#rep'));
ok('the report shows first day and last day for each shift', ['26', '43', '23', '42', '16', '33'].every((n) => rep.includes(n)));
ok('each shift is compared with industry peers', /Ahead of industry peers, who reach 37/.test(rep) && /Behind industry peers, who reach 47/.test(rep) && /Well ahead of industry peers, who reach 22/.test(rep));
$('#replay').click(); await sleep(400);
ok('the report plays again to the same numbers', flat($('#rep')) === rep);

/* longest and emptiest text */
const long = 'W'.repeat(70);
$$('#shiftcards textarea').forEach((a) => type(w, a, long));
ok('longest shifts: nothing errors and the report holds them', flat($('#rep')).includes(long) || (w.TL.play(), flat($('#rep')).includes(long)));
$$('#shiftcards textarea').forEach((a) => type(w, a, ''));
w.TL.play(); await sleep(100);
ok('empty shifts: nothing errors', errs.length === 0, errs[0]);

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
w.close();

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
