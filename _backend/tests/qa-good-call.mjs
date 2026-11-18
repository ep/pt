/* qa-good-call.mjs: jsdom harness for field-tools/good-call/index.html.
   Runs the studio, the console and many phones against the real pt worker code (fake database): joining
   and moving people between tables, orders passing between real players, the clock, pausing, covering for
   a phone that went away, the audit, the second half, the final board and the end. Decodes the join QR
   with jsQR, rebuilds every screen the way the feedback board does, and plays the scoring and ranking in
   random rooms of every size, checking that every screen showing the same fact agrees.
   Run: node _backend/tests/qa-good-call.mjs   (needs: npm install jsdom jsqr) */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import worker from '../pt-worker.js';
import { FakeDB } from './fake-db.mjs';
const require = createRequire(import.meta.url);
const jsQR = require('jsqr');

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../field-tools/good-call/index.html'), 'utf8');
let failures = 0, passes = 0;
function check(name, cond, detail){ console.log((cond?'PASS  ':'FAIL  ')+name+(!cond && detail !== undefined ? '  :: '+detail : '')); if (!cond) failures++; else passes++; }
function section(t){ console.log('\n'+t); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0=Date.now(); while (Date.now()-t0 < (ms||4000)){ try{ if (fn()) return true; }catch(e){} await sleep(15); } return false; }
const HOSTED = 'https://ep.github.io/pt/field-tools/good-call/';
const env = { DB: FakeDB() };
const errors = [];
let fetchesInDrive = 0;
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; if (win.offline) throw new Error('offline'); win.reads = (win.reads||[]); if ((init.method||'GET')==='GET') win.reads.push(String(url)); const req = new Request(String(url), { method:init.method||'GET', headers:Object.assign({ Origin:'https://ep.github.io' }, init.headers||{}), body:init.body }); return worker.fetch(req, env); }; }
const doms = [];
const fast = 'App.pollMs=40; App.hbMs=60; App.presentMs=600; App.retryMs=5; App.tickMs=20; App.botMs=15; App.anim=false; App.bannerMs=40; App.endMs=300; App.bookMs=0; App.flipMs=0; App.boardMs=0; App.toastMs=5000;';
function load(url, opts){
  opts = opts || {};
  const d = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){
    if (opts.live !== false) mockFetch(window); else window.fetch = async () => { fetchesInDrive++; throw new Error('no network in a test drive'); };
    if (opts.seed) Object.keys(opts.seed).forEach(k=>window.localStorage.setItem(k, opts.seed[k]));
    window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } });
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    window.addEventListener('error', e => errors.push(String(e.message) + ' @ ' + url.slice(-30)));
  } });
  d.window.eval(fast + (opts.skew ? 'App.skew='+opts.skew+';' : '') + 'window.sounds=[]; ["oneMin","zero","fanfare","plink","stone"].forEach(function(k){ var f=Snd[k]; Snd[k]=function(){ window.sounds.push(k); return f.apply(Snd, arguments); }; });');
  if (d.window.App.role) d.window.startLoops();
  doms.push(d); return d;
}
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, el, k){ el.dispatchEvent(new win.KeyboardEvent('keydown', { key:k, bubbles:true })); }
const $ = (d, s) => d.window.document.querySelector(s);
const $$ = (d, s) => [...d.window.document.querySelectorAll(s)];
const on = (d, id) => d.window.document.getElementById(id).classList.contains('on');
const txt = (d, s) => { const e = $(d, s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : ''; };
const shows = (d, s) => { const e = $(d, s); if (!e) return false; let n = e; while (n && n.nodeType === 1) { if (d.window.getComputedStyle(n).display === 'none') return false; n = n.parentElement; } return true; };
const screen = d => d.window.EPKit.tool.screen();
function row(code, p){ const r = env.DB._rows.get('good-call:'+code+'|'+p); return r ? JSON.parse(r.value) : undefined; }
function rows(code){ let n=0; env.DB._rows.forEach((v,k)=>{ if (k.startsWith('good-call:'+code+'|')) n++; }); return n; }
function rowSizes(code){ let m=0; env.DB._rows.forEach((v,k)=>{ if (k.startsWith('good-call:'+code+'|')) m=Math.max(m, v.value.length); }); return m; }
async function call(method, p, body, sk){ const h={ 'Content-Type':'application/json', Origin:'https://ep.github.io' }; if (sk) h['X-Session-Key']=sk; const r = await worker.fetch(new Request('https://w.test'+p, { method, headers:h, body: body?JSON.stringify(body):undefined }), env); return { status:r.status, data: await r.json() }; }
function svgToMatrix(svg){
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/), total = parseInt(vb[1],10), quiet = 3, n = total - quiet*2;
  const m = Array.from({length:n}, () => new Array(n).fill(0));
  const rects = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="(\d+)" height="(\d+)" rx="[\d.]+" fill="(#[0-9A-Fa-f]+)"/g)];
  for (const r of rects){ const x=parseFloat(r[1])-quiet, y=parseFloat(r[2])-quiet, w=parseInt(r[3],10), dark = r[5].toUpperCase()!=='#FFFFFF'; for (let dy=0;dy<w;dy++) for (let dx=0;dx<w;dx++) m[y+dy][x+dx]=dark?1:0; }
  const rad = 0.43;
  for (const d of svg.matchAll(/M([\d.]+) ([\d.]+)a/g)){ const cx=parseFloat(d[1])+rad, cy=parseFloat(d[2]); m[Math.round(cy-0.5)-quiet][Math.round(cx-0.5)-quiet]=1; }
  return { size:n, modules:m };
}
function decodeMatrix(q){
  const scale=8, quiet=4, total=q.size+quiet*2, W=total*scale, data=new Uint8ClampedArray(W*W*4); data.fill(255);
  for (let r=0;r<q.size;r++) for (let c=0;c<q.size;c++){ if (!q.modules[r][c]) continue; for (let y=0;y<scale;y++) for (let x=0;x<scale;x++){ const px=((r+quiet)*scale+y)*W+((c+quiet)*scale+x); data[px*4]=0; data[px*4+1]=0; data[px*4+2]=0; } }
  const res = jsQR(data, W, W); return res ? res.data : null;
}
const qrOf = el => decodeMatrix(svgToMatrix(el.innerHTML));
/* a phone joins: first name, then the table */
async function joinPhone(link, name, table, opts){
  const d = load(link, opts); const w = d.window;
  await until(()=>$(d,'#jName'));
  type(w, $(d,'#jName'), name); click(w, $(d,'#jGo'));
  await until(()=>$(d,'#pGrid button'));
  if (table != null) { click(w, $(d,'#pGrid [data-t="'+table+'"]')); await until(()=>screen(d)==='phone-lobby'); }
  return d;
}
const G = d => d.window.GC;
const ev = (d, s) => d.window.eval(s);
/* jump the running clock to a time into the round (ms), the way a facilitator waiting would */
async function jump(con, ms){ ev(con, '(function(){var c=C(),k=tKey(c),tm=clone(c.tm);tm[k].ran='+ms+';tm[k].from=tm[k].running?wnow():null;setCtl({tm:tm});})()'); await sleep(150); }
const desk = d => ({ station: txt(d,'.dtop .ds'), cust: txt(d,'.tk .cust'), waiting: txt(d,'.wait'), up: txt(d,'.tk .up'), stamps: txt(d,'.stamps'), team: txt(d,'#pTeam'), ai: txt(d,'.ai'), picked: ($(d,'.opts [aria-checked="true"]')||{}).textContent || null });
async function handOff(d){ const before = d.window.App.log; const n = JSON.stringify(before).length; click(d.window, $(d,'#pHand')); return n; }

(async function(){
  /* ---------- the file ---------- */
  section('The file');
  check('noindex is set', html.includes('<meta name="robots" content="noindex, nofollow">'));
  check('no analytics', !/clarity|googletagmanager|gtag\(|analytics/i.test(html));
  check('the shared favicon, send kit and feedback kit load by absolute path', html.includes('/pt/assets/favicon/favicon.svg') && html.includes('<script src="/pt/assets/kit/send.js" defer>') && html.includes('<script src="/pt/assets/kit/feedback.js" defer>'));
  check('tool id good-call and the shared worker', /var TOOL_ID = "good-call";/.test(html) && html.includes('var WORKER_URL = "https://pt.armand-khambatta.workers.dev"'));
  check('one file, well under 400 KB', html.length < 400000, html.length);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)\\]+/g)].map(m=>m[0]).filter(u=>!/^https?:\/\/(pt\.armand-khambatta\.workers\.dev|ep\.github\.io\/pt|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org)/.test(u));
  check('talks only to the worker, the fonts and its own site', urls.length===0, urls.slice(0,3).join(' '));
  check('no em dashes in anything people read', !/—/.test(html));
  check('the house look: Montserrat and Georgia on warm paper', /family=Montserrat/.test(html) && /Georgia/.test(html) && /#FBF8F3/i.test(html));
  check('the rules ride in the page as they are: the order book and the replay', html.includes('Good Call: the rules.') && html.includes('G.replay = function (r, seats, logs, end)') && html.includes("title:'The rush'"));
  check('participants never see the product name: no phone screen says Good Call', !/paxSkeleton[\s\S]{0,4000}Good Call/.test(html.slice(html.indexOf('function paxSkeleton'), html.indexOf('function paxSkeleton')+4000)));

  /* ---------- the gate ---------- */
  let r = await call('GET','/api/health');
  check('the worker gates good-call', r.data.gatedTools.includes('good-call'));

  /* ---------- Studio ---------- */
  section('Setting up');
  const st = load(HOSTED); const sw = st.window;
  await until(()=>on(st,'studio'));
  check('the studio opens with no hash, on its first step', on(st,'studio') && $(st,'#st0').classList.contains('on') && screen(st)==='studio-start');
  check('defaults: 10 teams, 3-minute rounds', txt(st,'#stTeams')==='10' && txt(st,'#stLen')==='3' && /Seats 30 people/.test(txt(st,'#stTeamsHint')));
  click(sw, $(st,'#stBuild'));
  check('Set up a session opens the room step', screen(st)==='studio-room');
  const stepBtn = (k, dd, n) => { for (let i=0;i<n;i++) click(sw, $(st,'.stepper[data-k="'+k+'"] [data-d="'+dd+'"]')); };
  stepBtn('teams','1',5);
  check('teams stop at 12, and the button at the end turns off', txt(st,'#stTeams')==='12' && $(st,'.stepper[data-k="teams"] [data-d="1"]').disabled && /Seats 36/.test(txt(st,'#stTeamsHint')));
  stepBtn('teams','-1',15);
  check('teams stop at 2', txt(st,'#stTeams')==='2' && $(st,'.stepper[data-k="teams"] [data-d="-1"]').disabled);
  stepBtn('teams','1',2);
  type(sw, $(st,'#stName'), 'Spring cohort');
  click(sw, $(st,'#st1 [data-next="2"]'));
  check('the timing step names its screen', screen(st)==='studio-timing');
  stepBtn('len','-1',5);
  check('rounds go down to 2 minutes', txt(st,'#stLen')==='2' && $(st,'.stepper[data-k="len"] [data-d="-1"]').disabled);
  stepBtn('len','1',10);
  check('and up to 8', txt(st,'#stLen')==='8' && $(st,'.stepper[data-k="len"] [data-d="1"]').disabled);
  stepBtn('len','-1',4);
  click(sw, $(st,'#st2 [data-next="3"]'));
  check('the review lists every choice', /4 teams, seating 12 in threes/.test(txt(st,'#review')) && /Spring cohort/.test(txt(st,'#review')) && /Rounds of 4 min, Round 4 5 min, and 1 min before the audit/.test(txt(st,'#review')));
  check('the draft is kept on this device', JSON.parse(sw.localStorage.getItem('gc-draft')).teams===4);
  click(sw, $(st,'#stCopySetup'));
  const setupUrl = sw.copied.pop();
  const SU = load(setupUrl); await until(()=>on(SU,'studio'));
  check('a setup link reopens the same setup, at the review', /\?setup=/.test(setupUrl) && $(SU,'#st3').classList.contains('on') && /4 teams/.test(txt(SU,'#review')));
  SU.window.close();
  click(sw, $(st,'#review [data-go="1"]'));
  check('a review row jumps back to its step', screen(st)==='studio-room');
  click(sw, $(st,'#st1 [data-next="2"]')); click(sw, $(st,'#st2 [data-next="3"]'));

  /* ---------- a live session: the console and the lobby ---------- */
  section('The lobby');
  click(sw, $(st,'#stGo'));
  await until(()=>on(st,'console') && sw.App.started);
  const con = st, cw = sw, code = cw.App.code, sk = cw.App.key;
  check('starting a live session opens the console on the lobby', on(con,'console') && screen(con)==='console-lobby' && /#c=[A-Z]{6}&k=\w+&r=host/.test(cw.location.hash));
  check('the session is closed: no key, no read', (await call('GET','/api/state?tool=good-call&code='+code)).status===401);
  check('with the key it reads', (await call('GET','/api/state?tool=good-call&code='+code, null, sk)).status===200);
  const joinLink = cw.joinLink();
  check('the join link carries the key and the participant role', joinLink.includes('#c='+code+'&k='+sk+'&r=pax') && joinLink.startsWith(HOSTED));
  const qr = $(con,'.joincard .qr'); check('the lobby QR decodes to the join link', !!qr && qrOf(qr)===joinLink, qr && qrOf(qr));
  check('one row per table, four of them, each with its mascot', $$(con,'.trow[data-table]').length===4 && /Fox/.test(txt(con,'[data-table="1"]')) && /Owl/.test(txt(con,'[data-table="2"]')));
  check('the console starts muted, and says how to turn sound on', $(con,'#cMute').getAttribute('aria-pressed')==='false' && /Sound is off/.test(txt(con,'#cCtl')));
  check('the session name sits in the top bar', txt(con,'#cIni')==='Spring cohort');

  const ana = await joinPhone(joinLink, 'Ana', 1);
  const mo = await joinPhone(joinLink, 'Mo', 1);
  const sam = await joinPhone(joinLink, 'Sam', 1);
  check('a phone asks for a first name, then the table', true);
  await until(()=>txt(con,'[data-table="1"] .cnt')==='3');
  check('a full table shows a teal 3', txt(con,'[data-table="1"] .cnt')==='3' && $(con,'[data-table="1"]').classList.contains('full'));
  await until(()=>/Table 1, Team Fox/.test(txt(ana,'#pWaitH')) && /Mo/.test(txt(ana,'#pMates')) && /You start at Pricing/.test(txt(ana,'#pStation')));
  check('phones in the lobby see their table, tablemates and starting station', /Table 1, Team Fox/.test(txt(ana,'#pWaitH')) && /Ana \(you\)/.test(txt(ana,'#pMates')) && /Mo/.test(txt(ana,'#pMates')) && /You start at Pricing/.test(txt(ana,'#pStation')));
  await until(()=>/You start at Delivery/.test(txt(sam,'#pStation')));
  await until(()=>/You start at Policy/.test(txt(mo,'#pStation')));
  check('stations go by join order: Pricing, Policy, Delivery', /You start at Policy/.test(txt(mo,'#pStation')) && /You start at Delivery/.test(txt(sam,'#pStation')), txt(mo,'#pStation')+' | '+JSON.stringify(mo.window.App.S.pub.lob));
  check('phones never show the product name or a count of others', !/Good Call/.test(ana.window.document.getElementById('phone').textContent) && !/\d+ in\b/.test(txt(ana,'#pBody')));
  const jo = await joinPhone(joinLink, 'Jo', 1);
  await until(()=>txt(con,'[data-table="1"] .cnt')==='4');
  check('a fourth at one table turns its count clay', $(con,'[data-table="1"]').classList.contains('over'));
  /* the facilitator moves Jo: tap the name, then the table */
  const joChip = $$(con,'[data-table="1"] [data-pick]').find(b=>b.textContent==='Jo');
  click(cw, joChip);
  check('tapping a name picks it, and every table becomes a target', $(con,'.nm.sel') && /Now tap the table for Jo/.test(txt(con,'.picking')) && $(con,'[data-table="2"]').classList.contains('target'));
  click(cw, $(con,'[data-table="2"]'));
  await until(()=>txt(con,'[data-table="2"] .cnt')==='1' && txt(con,'[data-table="1"] .cnt')==='3');
  check('the move lands: table 1 back to three, Jo at table 2', txt(con,'[data-table="1"] .cnt')==='3' && /Jo/.test(txt(con,'[data-table="2"]')));
  await until(()=>shows(jo,'#pMoved'));
  check('Jo\'s phone says the facilitator moved them, and shows the new table', shows(jo,'#pMoved') && /Table 2, Team Owl/.test(txt(jo,'#pWaitH')));
  const kai = await joinPhone(joinLink, 'Kai', null);
  await until(()=>/Not at a table yet/.test(txt(con,'#tables')) && /Kai/.test(txt(con,'#tables')));
  check('someone who hasn\'t picked a table shows under Not at a table yet', /Not at a table yet\s*Kai/.test(txt(con,'#tables')));
  click(kai.window, $(kai,'#pGrid [data-t="3"]'));
  await until(()=>screen(kai)==='phone-lobby');
  click(kai.window, $(kai,'[data-p="wrong"]'));
  check('Wrong table? goes back to the numbers', screen(kai)==='phone-table');
  click(kai.window, $(kai,'#pGrid [data-t="2"]'));
  await until(()=>txt(con,'[data-table="2"] .cnt')==='2');
  check('picking again moves them', /Kai/.test(txt(con,'[data-table="2"]')) && txt(con,'[data-table="3"] .cnt')==='0');
  const lee = await joinPhone(joinLink, 'Lee', 3);
  await until(()=>txt(con,'[data-table="3"] .cnt')==='1');
  check('a table of two: one person runs Pricing and Policy', /You start at Pricing and Policy/.test(txt(jo,'#pStation')) && /You start at Delivery/.test(txt(kai,'#pStation')));
  check('a table of one runs all three', /You run all three stations/.test(txt(lee,'#pStation')));
  check('the chip counts everyone in', /^6in$/.test(txt(con,'#chip')), txt(con,'#chip'));



  global.__ctx = { con, cw, code, sk, ana, mo, sam, jo, kai, lee, joinLink };
  await partTwo();
})().catch(e => { console.log('CRASH', e && e.stack); failures++; finish(); });


async function partTwo(){
  const { con, cw, code, sk, ana, mo, sam, jo, kai, lee, joinLink } = global.__ctx;
  const nextC = () => click(cw, $(con,'#cNext'));
  const truthOf = d => { const D = d.window.App.desk; return D ? G(d).order(D.r, D.k).truth[D.s] : null; };
  const pickTruth = d => { const i = truthOf(d); click(d.window, $(d,'.opts [data-i="'+i+'"]')); return i; };
  const boardVal = t => { const li = $(con,'#bList [data-t="'+t+'"]') || $(con,'#rvSlide [data-t="'+t+'"]'); return li ? txt(con, (li.closest('#rvSlide') ? '#rvSlide' : '#bList') + ' [data-t="'+t+'"] .v.last') : null; };

  section('The opening');
  nextC();
  await until(()=>screen(con)==='console-opening');
  check('Start opens the opening on the day: Quarter-end, and the leadership team on the desks', screen(con)==='console-opening' && /Quarter-end/.test(txt(con,'#cStage')) && /The last day of the quarter, one of the busiest of the year\./.test(txt(con,'#cStage')) && /Today the leadership team works the order desks\./.test(txt(con,'#cStage')));
  check('the next button says Next', txt(con,'#cNext')==='Next');
  await until(()=>screen(ana)==='phone-opening' && screen(mo)==='phone-opening' && /Policy/.test(txt(mo,'#pRoleH')));
  check('phones: your first station, what it does, your book', txt(ana,'#pRoleH')==='Pricing' && txt(ana,'#pRoleP')==='You build the quote. Your book: the price list.' && txt(mo,'#pRoleH')==='Policy' && txt(sam,'#pRoleP')==='You tell the customer when it ships. Your book: the warehouse calendar.', txt(mo,'#pRoleH')+' | '+txt(sam,'#pRoleP'));
  check('and who is down the line, by name, with eyes on the big screen', /You\s*Pricing.*Mo\s*Policy.*Sam\s*Delivery/.test(txt(ana,'#pTrack')) && /Ana\s*Pricing.*You\s*Policy/.test(txt(mo,'#pTrack')) && /Eyes on the big screen/.test(txt(ana,'#pBody')), txt(ana,'#pTrack'));
  check('a table of two: one person runs two stations on the card', txt(jo,'#pRoleH')==='Pricing and Policy' && /You build the quote and set the discount\. Your books: the price list and the policy book\./.test(txt(jo,'#pRoleP')), txt(jo,'#pRoleP'));
  const seat0 = row(code,'pub/seat'); check('the seats for round 1 are written when the opening starts', seat0 && seat0[0] && seat0[0][1].length===3 && seat0[0][2].length===2 && seat0[0][3].length===1 && !seat0[0][4], JSON.stringify(seat0));
  nextC();
  await until(()=>screen(con)==='console-opening-desk');
  check('then the desk: three stations, and an AI helper at each', /Pricing.*Policy.*Delivery/.test(txt(con,'.line')) && /Builds the quote/.test(txt(con,'.line')) && /an AI helper drafts the answer and shows how sure it is/.test(txt(con,'#cStage')));
  nextC();
  await until(()=>screen(con)==='console-opening-rules');
  check('then the three rules, and the button sends the first order', /Speed counts\.\s*The board is public\.\s*Mistakes are costly\./.test(txt(con,'.rules')) && txt(con,'#cNext')==='Send the first order');
  click(cw, $(con,'#cBack')); await until(()=>screen(con)==='console-opening-desk');
  check('Back steps through the slides', screen(con)==='console-opening-desk');
  nextC(); await until(()=>screen(con)==='console-opening-rules');

  section('The first order: one easy order down the line, not scored');
  nextC();
  await until(()=>screen(con)==='console-first' && screen(ana)==='phone-first');
  check('the shared screen shows each desk\'s order, with Start round 1', txt(con,'#cTitle')==='The first order' && $$(con,'#fList li').length===3 && txt(con,'#cNext')==='Start round 1' && /0 of 3 desks shipped/.test(txt(con,'#fFoot')), txt(con,'#fFoot'));
  check('Pricing gets the order, one line, the order first', txt(ana,'.tk .tkline')==='2 tents · Willow Bend' && /% sure/.test(txt(ana,'.ai')), txt(ana,'.tk .tkline'));
  check('one tip at a time, starting with the order', txt(ana,'.coach span')==='A customer\u2019s order. You build the quote.' && $$(ana,'.coach').length===1, txt(ana,'.coach'));
  await until(()=>screen(mo)==='phone-first-wait' && screen(sam)==='phone-first-wait');
  check('teammates see where the order is, by name', /Ana is pricing your first order\./.test(txt(mo,'#pBody')) && /It comes to you next\./.test(txt(mo,'#pBody')) && /Then Mo, then you\./.test(txt(sam,'#pBody')), txt(sam,'#pBody'));
  click(ana.window, $(ana,'[data-p="ftip"]')); click(ana.window, $(ana,'[data-p="ftip"]'));
  check('the tips go on: Look it up, and what it costs', /Look it up opens the price list\. It takes a moment\./.test(txt(ana,'.coach')));
  click(ana.window, $(ana,'[data-p="flook"]'));
  check('Look it up opens the price list', ana.window.App.bookOpen && txt(ana,'#bookH')==='Price list');
  click(ana.window, $(ana,'#bookClose'));
  await until(()=>/Hand off sends it to Policy \(Mo\)\./.test(txt(ana,'.coach')));
  check('the last tip names who the hand-off goes to', /Hand off sends it to Policy \(Mo\)\./.test(txt(ana,'.coach')) && !$(ana,'.coach [data-p="ftip"]'), txt(ana,'.coach'));
  click(ana.window, $(ana,'[data-p="fhand"]'));
  await until(()=>screen(mo)==='phone-first');
  check('the hand-off reaches Policy, with the quote on the line', txt(mo,'.tk .tkline')==='2 tents · $400 · Willow Bend' && /Ana built the quote\. You set the discount\./.test(txt(mo,'.coach')), txt(mo,'.tk .tkline'));
  await until(()=>screen(ana)==='phone-first-wait');
  check('Pricing now watches it move on', /Mo is setting the discount\./.test(txt(ana,'#pBody')) && /Then Sam tells the customer when it ships\./.test(txt(ana,'#pBody')), txt(ana,'#pBody'));
  for (let i = 0; i < 3; i++) click(mo.window, $(mo,'[data-p="ftip"]'));
  check('Policy\'s tips include Send back, by name', /Send back returns it to Pricing \(Ana\)\./.test(txt(mo,'.coach')), txt(mo,'.coach'));
  click(mo.window, $(mo,'[data-p="fback"]'));
  await until(()=>screen(ana)==='phone-first' && screen(mo)==='phone-first-wait');
  check('Send back returns it to Pricing', screen(ana)==='phone-first' && /Ana has it back\./.test(txt(mo,'#pBody')), txt(mo,'#pBody'));
  click(ana.window, $(ana,'[data-p="fhand"]'));
  await until(()=>screen(mo)==='phone-first');
  check('and the next tip names who it goes to next', /Hand off sends it to Delivery \(Sam\)\./.test(txt(mo,'.coach')), txt(mo,'.coach'));
  click(mo.window, $(mo,'[data-p="fhand"]'));
  await until(()=>screen(sam)==='phone-first');
  check('Delivery sees the date, with the quote and discount on the small line', txt(sam,'.tk .tkline')==='2 tents by March 3 · Willow Bend' && /Quote \$400/.test(txt(sam,'.tk .up')) && /Discount 0%/.test(txt(sam,'.tk .up')), txt(sam,'.tk .tkline')+' | '+txt(sam,'.tk .up'));
  click(sam.window, $(sam,'[data-p="fhand"]'));
  await until(()=>screen(ana)==='phone-first-done' && screen(sam)==='phone-first-done' && /Shipped/.test(txt(con,'#fList [data-t="1"]')));
  check('it ships: every phone says so, and so does the shared screen', /Your desk shipped its first order\./.test(txt(ana,'#pBody')) && /1 of 3 desks shipped/.test(txt(con,'#fFoot')), txt(con,'#fFoot'));
  const fr = row(code,'t1/f/'+ana.window.App.seat);
  check('each phone stores only its own first-order moves', fr && fr.m.length===2 && fr.m.every(x => x[1]===0 && x[2]==='h'), JSON.stringify(fr));
  check('the first order never reaches the board', (row(code,'pub/board')||{})[1] && row(code,'pub/board')[1][0]===0, JSON.stringify(row(code,'pub/board')));

  section('Round 1: orders pass between real players');
  nextC();
  await until(()=>screen(con)==='console-round' && screen(ana)==='phone-desk' && !!desk(ana).cust);
  const c1 = cw.C();
  check('the round\'s clock starts on its own', !!c1.tm.r0 && c1.tm.r0.running && /^\d:\d\d$/.test(txt(con,'#cDig')) && shows(con,'#cTimer'));
  check('the board shows the three seated tables, not the empty one', $$(con,'#bList li').length===3 && !$(con,'#bList [data-t="4"]') && txt(con,'#bHead')==='Orders out');
  const o0 = G(ana).order(0, 0);
  check('Pricing sees the first order and the AI\'s draft, already picked', desk(ana).cust===o0.cust && /% sure/.test(desk(ana).ai) && desk(ana).picked===o0.opts[0][o0.ai[0].i].label, JSON.stringify(desk(ana)));
  await until(()=>/Waiting for Pricing/.test(desk(mo).waiting) && /Waiting for Policy/.test(desk(sam).waiting));
  check('Policy and Reply wait for the order before them', /Waiting for Pricing/.test(desk(mo).waiting) && /Waiting for Policy/.test(desk(sam).waiting));
  check('the desk names the station and the team', /^Pricing$/.test(desk(ana).station) && /Team Fox/.test(desk(ana).team), JSON.stringify(desk(ana)));
  check('Pricing has no Send back', !$(ana,'[data-p="back"]') && !!$(ana,'[data-p="look"]'));
  check('the desk shows no count of orders waiting', !$(ana,'#pQueue') && !/waiting/.test(txt(ana,'.desk')), txt(ana,'.desk'));
  click(ana.window, $(ana,'[data-p="look"]'));
  check('Look it up opens the price list over the order', ana.window.App.bookOpen && txt(ana,'#bookH')==='Price list' && /Tent: \$200/.test(txt(ana,'#bookL')) && screen(ana)==='phone-book');
  click(ana.window, $(ana,'#bookClose'));
  check('Back to the order closes it', !ana.window.App.bookOpen);
  click(ana.window, $(ana,'#pHand'));
  await until(()=>desk(mo).cust===o0.cust);
  check('the hand-off reaches Policy: the order in bold, Pricing\'s quote, then the customer', desk(mo).cust===o0.cust && txt(mo,'.tk .tkline')===o0.text+' · '+o0.opts[0][o0.ai[0].i].label+' · '+o0.cust && txt(mo,'.tk .tkline .ord')===o0.text && !desk(mo).up, txt(mo,'.tk .tkline'));
  check('round 1 carries no names on the order', desk(mo).stamps==='');
  check('round 1 gives no result on the phone', !ana.window.App.lastToast);
  check('Pricing moves on to the next order', desk(ana).cust===G(ana).order(0,1).cust);
  click(mo.window, $(mo,'#pHand'));
  await until(()=>desk(sam).cust===o0.cust);
  check('then Delivery, with the quote and the discount', desk(sam).up.includes('Discount'));
  click(sam.window, $(sam,'#pHand'));
  await until(()=>boardVal(1)==='1');
  check('the order ships and the board counts it', boardVal(1)==='1');
  await until(()=>desk(ana).team==='Team Fox · 1st' && desk(sam).team==='Team Fox · 1st');
  check('each phone\'s team line agrees with the board, by place alone', desk(ana).team==='Team Fox · 1st' && desk(sam).team==='Team Fox · 1st', 'Ana: '+desk(ana).team+' | Sam: '+desk(sam).team);
  check('the rows in the store stay under 4,000 characters', rowSizes(code) < 4000);

  section('The clock');
  click(cw, $(con,'#tPlay'));
  await until(()=>!cw.C().tm.r0.running);
  const held = cw.roundMs(); await sleep(150);
  check('tapping the clock stops it, and new orders stop with it', !cw.C().tm.r0.running && cw.roundMs()===held);
  click(cw, $(con,'#tPlay')); await until(()=>cw.C().tm.r0.running);
  const lim0 = cw.limitOf(cw.C().tm.r0);
  click(cw, $(con,'#tUp')); await until(()=>cw.limitOf(cw.C().tm.r0)===lim0+60000);
  check('a minute up moves only the end', cw.limitOf(cw.C().tm.r0)===lim0+60000 && Math.abs(cw.roundMs() - held) < 2000);
  click(cw, $(con,'#tDown')); await until(()=>cw.limitOf(cw.C().tm.r0)===lim0);
  check('a minute down takes it back', cw.limitOf(cw.C().tm.r0)===lim0);

  section('Pausing every screen');
  click(cw, $(con,'#cPause'));
  await until(()=>screen(ana)==='phone-paused' && screen(jo)==='phone-paused');
  check('Pause screens: every phone looks up, and the console says so', /Eyes up front/.test(txt(ana,'#pEyesH')) && shows(con,'#cPausedTag') && txt(con,'#cPause')==='Resume screens');
  const pausedAt = cw.roundMs(); await sleep(150);
  check('the running clock waits with them', !cw.C().tm.r0.running && cw.roundMs()===pausedAt);
  check('the console screen is named for the feedback board', screen(con)==='console-paused');
  click(cw, $(con,'#cPause'));
  await until(()=>screen(ana)==='phone-desk' && cw.C().tm.r0.running);
  check('Resume brings the desks back, and the clock runs again', screen(ana)==='phone-desk' && cw.C().tm.r0.running);

  section('Time\'s up');
  await jump(con, cw.limitOf(cw.C().tm.r0) - 59000);
  await until(()=>cw.sounds.includes('oneMin'));
  check('the console chimes at one minute left', cw.sounds.includes('oneMin'));
  await until(()=>!!$(ana,'#pHand') && !$(ana,'#pHand').disabled);
  const o1 = G(ana).order(0, 1);
  click(ana.window, $(ana,'#pHand'));
  await until(()=>desk(mo).cust===o1.cust);
  await jump(con, cw.limitOf(cw.C().tm.r0) + 500);
  await until(()=>screen(ana)==='phone-timeup' && screen(mo)==='phone-timeup' && screen(lee)==='phone-timeup');
  check('at zero the console chimes and every phone locks', cw.sounds.includes('zero') && screen(ana)==='phone-timeup' && screen(lee)==='phone-timeup');
  check('a locked phone says where you go next', /Next round you're at Policy\./.test(txt(ana,'#pNext')) && /Next round you're at Delivery\./.test(txt(mo,'#pNext')), txt(ana,'#pNext'));
  await until(()=>txt(con,'#cNext')==='Round 2');
  check('the console offers the next round, and a hint to read the board', txt(con,'#cNext')==='Round 2' && /Read the board/.test(txt(con,'#cCtl')), txt(con,'#cCtl'));
  const outBefore = boardVal(1), end0 = cw.roundEnd(0), moSeat = mo.window.App.seat;
  /* a slow phone: a hand-off stamped after time was called */
  const moLog = row(code,'t1/0/'+moSeat) || '';
  const lateMove = G(con).pack([{ k:1, s:1, a:'h', c:o1.truth[1], f:0, d:900, t:end0 + 2000 }]);
  await call('POST','/api/set', { tool:'good-call', code, path:'t1/0/'+moSeat, value: moLog ? moLog + ',' + lateMove : lateMove }, sk);
  await until(()=>cw.teamRep(1,0) && cw.teamRep(1,0).late.length===1);
  check('a move stamped after time was called never reaches the board', boardVal(1)===outBefore && cw.teamRep(1,0).late.length===1 && cw.teamRep(1,0).orders[1].at===1);

  global.__ctx2 = { nextC, truthOf, pickTruth, boardVal };
  await partThree();
}

async function partThree(){
  const C1 = global.__ctx, { con, cw, code, sk, joinLink } = C1;
  let { ana, mo, sam, jo, kai, lee } = C1;
  const { nextC, truthOf, pickTruth, boardVal } = global.__ctx2;
  const handWhenReady = async (d, cust) => { await until(()=>desk(d).cust===cust && $(d,'#pHand') && !$(d,'#pHand').disabled); click(d.window, $(d,'#pHand')); };

  section('Round 2: names on every hand-off');
  nextC();
  await until(()=>screen(con)==='console-intro' && screen(ana)==='phone-intro');
  check('the round opens on its title and its line of story, with Start round 2', txt(con,'#cTitle')==='Round 2: Sign your name' && txt(con,'#cSub')==='Finance wants a name on every order.' && txt(con,'#cNext')==='Start round 2', txt(con,'#cSub'));
  await until(()=>/Policy/.test(txt(ana,'#pEyesH')) && /Delivery/.test(txt(mo,'#pEyesH')) && /Pricing/.test(txt(sam,'#pEyesH')) && /Pricing and Policy/.test(txt(kai,'#pEyesH')) && /Delivery/.test(txt(jo,'#pEyesH')));
  check('everyone moves one station down the line', /Round 2: you're on Policy\./.test(txt(ana,'#pEyesH')) && /Round 2: you're on Delivery\./.test(txt(mo,'#pEyesH')) && /Round 2: you're on Pricing\./.test(txt(sam,'#pEyesH')));
  check('a team of two swaps who runs two stations', /Round 2: you're on Pricing and Policy\./.test(txt(kai,'#pEyesH')) && /Round 2: you're on Delivery\./.test(txt(jo,'#pEyesH')));
  check('each phone says what its station does, and its book', txt(ana,'#pJob')==='You set the discount. Your book: the policy book.', txt(ana,'#pJob'));
  check('between rounds the console offers the tables', !!$(con,'[data-c="tables"]'));
  nextC();
  await until(()=>screen(sam)==='phone-desk' && !!desk(sam).cust);
  const q0 = G(sam).order(1, 0);
  click(sam.window, $(sam,'[data-p="look"]')); click(sam.window, $(sam,'#bookClose'));
  click(sam.window, $(sam,'#pHand'));
  await until(()=>desk(ana).cust===q0.cust);
  check('downstream sees who checked it', /Checked by Sam/.test(desk(ana).stamps), desk(ana).stamps);
  click(ana.window, $(ana,'#pHand'));
  await until(()=>desk(mo).cust===q0.cust);
  check('and who didn\'t check', /Checked by Sam/.test(desk(mo).stamps) && /Not checked by Ana/.test(desk(mo).stamps), desk(mo).stamps);
  check('Delivery can send an order back', !!$(mo,'[data-p="back"]'));
  click(mo.window, $(mo,'[data-p="back"]'));
  await until(()=>desk(ana).cust===q0.cust && /Sent back by Mo/.test(desk(ana).stamps));
  check('a sent-back order goes to the front, saying who sent it', desk(ana).cust===q0.cust && /Sent back by Mo/.test(desk(ana).stamps));

  section('A phone that reloads mid-round keeps its moves');
  const anaSeat = ana.window.App.seat, anaRow = row(code,'t1/1/'+anaSeat), seed = {};
  for (let i = 0; i < ana.window.localStorage.length; i++){ const k = ana.window.localStorage.key(i); seed[k] = ana.window.localStorage.getItem(k); }
  ana.window.stopLoops(); ana.window.close();
  ana = load(joinLink, { seed });
  await until(()=>screen(ana)==='phone-desk' && desk(ana).cust===q0.cust);
  check('after a reload the phone is back at its desk, on the same order', screen(ana)==='phone-desk' && desk(ana).cust===q0.cust && /Sent back by Mo/.test(desk(ana).stamps));
  click(ana.window, $(ana,'#pHand'));
  await until(()=>(row(code,'t1/1/'+anaSeat)||'').split(',').length===anaRow.split(',').length + 1);
  check('its next move adds to what it had, nothing lost', row(code,'t1/1/'+anaSeat).startsWith(anaRow + ','));
  await until(()=>desk(mo).cust===q0.cust);
  click(mo.window, $(mo,'#pHand'));

  section('Round 3: the rush, and covering for a phone that went away');
  nextC();
  await until(()=>screen(con)==='console-intro' && txt(con,'#cTitle')==='Round 3: The rush');
  nextC();
  await until(()=>screen(mo)==='phone-desk' && !!desk(mo).cust);
  check('round 3 opens with eight orders waiting at Pricing', /^Pricing$/.test(desk(mo).station) && ev(mo,'deskModel().q.length')===8, ev(mo,'deskModel().q.length'));
  const moSeat = mo.window.App.seat;
  mo.window.stopLoops(); mo.window.close();
  await until(()=>/1\s*away/.test(txt(con,'#chip')), 6000);
  check('the console counts a phone that went away', /1\s*away/.test(txt(con,'#chip')), txt(con,'#chip'));
  await until(()=>!!$(sam,'[data-p="cover"]'), 6000);
  check('a teammate is offered the quiet station', /Mo's phone is away\. Cover Pricing\?/.test(txt(sam,'.cover')) && screen(sam)==='phone-cover', txt(sam,'.cover'));
  click(sam.window, $(sam,'[data-p="cover"]'));
  await until(()=>/Pricing for Mo/.test(desk(sam).station));
  const coverCust = desk(sam).cust;
  check('covering puts that station on your desk, labeled', /Pricing for Mo/.test(desk(sam).station) && coverCust===G(sam).order(2,0).cust);
  click(sam.window, $(sam,'#pHand'));
  await until(()=>desk(sam).station==='Policy' && desk(sam).cust===coverCust);
  check('the covered hand-off moves the order on, with the coverer\'s name', desk(sam).station==='Policy' && /Not checked by Sam/.test(desk(sam).stamps), JSON.stringify(desk(sam)));
  await until(()=>G(con).unpack(row(code,'t1/2/'+sam.window.App.seat)||'').some(a => a.as===moSeat && a.s===0));
  check('the move is stored as covering for Mo', G(con).unpack(row(code,'t1/2/'+sam.window.App.seat)||'').some(a => a.as===moSeat && a.s===0));
  const max = await joinPhone(joinLink, 'Max', 3);
  await until(()=>screen(max)==='phone-late');
  check('someone who arrives mid-round waits for the next one', screen(max)==='phone-late' && /You'll join your team next round\. Until then, eyes on the big screen\./.test(txt(max,'#pBody')), txt(max,'#pBody'));

  section('Before the audit');
  nextC();
  await until(()=>screen(con)==='console-huddle' && screen(ana)==='phone-huddle');
  check('the question, with a one-minute clock', /What was your team optimizing for\?/.test(txt(con,'#cStage')) && shows(con,'#cTimer') && /^[01]:\d\d$/.test(txt(con,'#cDig')) && cw.C().tm.huddle.dur===60000);
  check('phones down', /Phones down\./.test(txt(ana,'#pEyesH')) && /optimizing for/.test(txt(ana,'#pEyesP')));
  check('the next button runs the audit', txt(con,'#cNext')==='Run the audit');
  const pubBoard = row(code,'pub/board');
  check('until now the public board carries speed only, no points', pubBoard && Object.values(pubBoard).every(v => v[1]===null && v[2]===null), JSON.stringify(pubBoard));

  section('The audit');
  nextC();
  await until(()=>on(con,'reveal') && screen(con)==='console-audit');
  await until(()=>/Points after the audit/.test(txt(con,'#rvSlide .boardfoot')));
  /* the truth, worked out here from the stored moves */
  await until(()=>(row(code,'pub/ctl')||{}).step==='reveal');
  const ctl = row(code,'pub/ctl'), seats = row(code,'pub/seat'), GG = G(con);
  const logsFrom = (t, r) => { const out = {}; env.DB._rows.forEach((v, k) => { const m = new RegExp('^good-call:'+code+'\\|t'+t+'/'+r+'/(p\\d+)(?:_(\\d+))?$').exec(k); if (m) { (out[m[1]] = out[m[1]] || []).push([+(m[2]||0), JSON.parse(v.value)]); } }); const L = {}; Object.keys(out).forEach(p => { L[p] = GG.unpack(out[p].sort((a,b)=>a[0]-b[0]).map(x=>x[1]).join(',')); }); return L; };
  const endOf = r => { const t = (ctl.tm||{})['r'+r]; return t ? Math.min(t.ran, t.dur + (t.add||0)) : 0; };
  const repOf = (t, r) => seats[r] && seats[r][t] ? GG.replay(r, GG.seats(seats[r][t], r), logsFrom(t, r), endOf(r)) : null;
  const truth = [1,2,3].map(t => { const reps = [0,1,2].map(r => repOf(t, r)); return { t, reps, pts: GG.half(reps, 0).pts, out: GG.half(reps, 0).out }; });
  const placesNow = cw.placed(truth.map(x => ({ t:x.t, pts1:x.pts })), 'pts1');
  check('the board flips from orders out to points, every table right', truth.every(x => boardVal(x.t)===cw.num(x.pts)), truth.map(x => x.t+':'+x.pts+'/'+boardVal(x.t)).join(' '));
  check('and reorders by points, Gold on the leader', placesNow.every(x => $(con,'#rvSlide [data-t="'+x.t+'"]').classList.contains('lead')===(x.place===1)) && txt(con,'#rvSlide .colhead')==='Points');
  check('the room hears it, once', cw.sounds.filter(s=>s==='fanfare').length===1 && cw.App.celebrated);
  await until(()=>screen(ana)==='phone-audit' && /Your desk finished/.test(txt(ana,'#pRes h2')) && screen(jo)==='phone-audit');
  const anaPlace = placesNow.find(x => x.t===1);
  check('each phone shows its own audit, and its place agrees with the board', txt(ana,'#pRes h2')==='Your desk finished '+cw.placeWords(anaPlace)+'.' && screen(jo)==='phone-audit', 'Ana: '+txt(ana,'#pRes h2')+' (board says '+cw.placeWords(anaPlace)+') | Jo: '+screen(jo));
  const anaP = GG.person(anaSeat, truth[0].reps);
  check('the phone\'s rounds and mistakes match the stored moves', $$(ana,'#pRes .rlist li:not(.miss)').length===3 && $$(ana,'#pRes li.miss').length===anaP.mistakes.length && (anaP.shipped[0] ? new RegExp('Your name is on '+anaP.shipped[0]).test(txt(ana,'.tline')) : /No mistakes carry your name/.test(txt(ana,'.tline'))));
  check('the public board now carries points', Object.values(row(code,'pub/board')).every(v => v[1]!==null));
  check('nothing about others leaks to a phone: no other table\'s moves were read', ana.window.reads.every(u => /prefix=(pub|t1)&/.test(u)), ana.window.reads.filter(u=>!/prefix=(pub|t1)&/.test(u)).slice(0,2).join(' '));

  section('The debrief');
  const room = GG.room(truth.map(x => ({ team:x.t, reps:x.reps })));
  click(cw, $(con,'#rvNext'));
  await until(()=>screen(con)==='console-shipped');
  check('what the room shipped: orders out, mistakes shipped, mistakes caught', txt(con,'#rvSlide .stats')===room.out+'orders out'+room.wrong+'mistakes shipped'+room.caught+'mistakes caught', txt(con,'#rvSlide .stats'));
  check('and how many desks sent Trailhead\'s discount out wrong', new RegExp('at '+room.flagged+' of 3 desks').test(txt(con,'#rvSlide .dline')));
  click(cw, $(con,'#rvNext')); await until(()=>screen(con)==='console-speed');
  check('how fast the room handed off, AI right against AI wrong', /AI right/.test(txt(con,'#rvSlide')) && txt(con,'#rvSlide .bar b')===cw.secs(room.speed.right.mean||0).replace(/\s+/g,' '));
  click(cw, $(con,'#rvNext')); await until(()=>screen(con)==='console-systems');
  check('three ways of thinking', /System 1.*System 2.*System 3/.test(txt(con,'#rvSlide')));
  click(cw, $(con,'#rvBack')); await until(()=>screen(con)==='console-speed');
  check('Back steps back one screen', screen(con)==='console-speed');
  key(cw, cw.document.body, 'ArrowRight'); await until(()=>screen(con)==='console-systems');
  check('the arrow keys drive it too', screen(con)==='console-systems');
  key(cw, cw.document.body, 'Escape');
  check('Escape closes the reveal, and the console offers to continue it', !on(con,'reveal') && txt(con,'#cNext')==='Continue the audit');
  /* a facilitator who reloads lands back on it */
  const hostUrl = cw.location.href;
  const con2 = load(hostUrl); await until(()=>con2.window.App.started && on(con2,'reveal'));
  check('a reloaded console lands back on the same screen', on(con2,'reveal') && screen(con2)==='console-systems');
  con2.window.stopLoops(); con2.window.close();
  check('phones keep their own results through the debrief', screen(ana)==='phone-audit');
  nextC(); await until(()=>on(con,'reveal'));
  click(cw, $(con,'#rvNext')); await until(()=>screen(con)==='console-rules');
  check('house rules: written on paper, and what changes next', /Write them on the back of your card/.test(txt(con,'#rvSlide')) && /the AI waits until you ask/.test(txt(con,'#rvSlide')));

  global.__ctx3 = { ana, sam, max, truth, logsFrom, endOf, anaSeat };
  await partFour();
}

async function partFour(){
  const { con, cw, code, sk, joinLink, jo, kai, lee } = global.__ctx;
  const { nextC, truthOf, pickTruth, boardVal } = global.__ctx2;
  const { ana, sam, max, logsFrom, anaSeat } = global.__ctx3;
  const GG = G(con);

  section('Between rounds: the tables');
  click(cw, $(con,'#rvNext'));
  await until(()=>screen(con)==='console-intro' && txt(con,'#cTitle')==='Round 4: Your rules');
  check('after the house rules, Round 4 comes up', txt(con,'#cNext')==='Start round 4' && !on(con,'reveal'));
  click(cw, $(con,'[data-c="tables"]'));
  check('Tables opens the table rows, with a row for people sitting out', !$(con,'#tblDlg').classList.contains('hide') && /Not playing/.test(txt(con,'#tblBody')));
  const moChip = $$(con,'#tblBody [data-pick]').find(b => b.textContent==='Mo');
  click(cw, moChip); click(cw, $(con,'#tblBody [data-table="0"]'));
  await until(()=>{ const s3 = (row(code,'pub/seat')||{})[3]; return s3 && s3[1] && s3[1].length===2; });
  const s3 = row(code,'pub/seat')[3];
  check('taking someone out reseats their table for the next round', s3[1].length===2 && s3[1].indexOf(anaSeat)===0 && /Not playing\s*Mo/.test(txt(con,'#tblBody')));
  check('the late arrival joins their table at the next round', s3[3].length===2 && s3[3][1]===max.window.App.seat);
  click(cw, $(con,'#tblDone'));
  await until(()=>screen(ana)==='phone-intro' && screen(max)==='phone-intro' && /Round 4/.test(txt(ana,'#pEyesH')) && /Round 4/.test(txt(sam,'#pEyesH')) && /Round 4/.test(txt(max,'#pEyesH')));
  check('phones see their new stations', /Round 4: you're on Delivery\./.test(txt(ana,'#pEyesH')) && /Round 4: you're on Pricing and Policy\./.test(txt(sam,'#pEyesH')) && /Round 4: you're on Pricing and Policy\./.test(txt(max,'#pEyesH')), txt(ana,'#pEyesH')+' | '+txt(max,'#pEyesH'));

  section('Round 4: the AI waits until you ask');
  nextC();
  await until(()=>screen(sam)==='phone-ask' && !!desk(sam).cust);
  check('the AI\'s answer hides behind Ask the AI, nothing picked', /The AI has a suggestion/.test(desk(sam).ai) && !!$(sam,'[data-p="ask"]') && desk(sam).picked===null && $(sam,'#pHand').disabled);
  check('the board now counts points', txt(con,'#bHead')==='Points' && screen(con)==='console-round4');
  check('round 4 orders come in the customer\'s words', (!/^Pricing/.test(desk(sam).station) || txt(sam,'.tk .tkline')===desk(sam).cust) && !/\d/.test(txt(sam,'.tk .note')), desk(sam).station + ': ' + txt(sam,'.tk .tkline'));
  click(sam.window, $(sam,'[data-p="ask"]'));
  await until(()=>/% sure/.test(desk(sam).ai));
  check('Ask the AI shows its draft and picks it', /% sure/.test(desk(sam).ai) && desk(sam).picked!==null && !$(sam,'#pHand').disabled);
  click(sam.window, $(sam,'#pHand'));
  await until(()=>!!sam.window.App.lastToast);
  check('each hand-off shows its result at once', !!sam.window.App.lastToast && $(sam,'#toast').classList.contains('on'));
  /* play on with your own calls until one beats a wrong AI */
  const seen = [];
  for (let i = 0; i < 24 && !seen.some(t => /beat the AI/.test(t)); i++) {
    await until(()=>$(sam,'#pHand') && $(sam,'[data-p="ask"]'), 3000);
    if (!$(sam,'[data-p="ask"]')) break;
    sam.window.App.lastToast = null; pickTruth(sam); click(sam.window, $(sam,'#pHand'));
    await until(()=>!!sam.window.App.lastToast); seen.push(sam.window.App.lastToast + ' ' + txt(sam,'#toast b'));
    if (i % 2 === 1 && $(ana,'#pHand') && !$(ana,'#pHand').disabled) { pickTruth(ana); click(ana.window, $(ana,'#pHand')); }
  }
  const beat = seen.find(t => /beat the AI/.test(t));
  check('your own call beating a wrong AI earns the bonus', !!beat && /\+20/.test(beat), seen.join(' / '));
  await until(()=>!!$(ana,'#pHand') && !$(ana,'#pHand').disabled, 3000);
  ana.window.App.lastToast = null; pickTruth(ana); click(ana.window, $(ana,'#pHand'));
  await until(()=>!!ana.window.App.lastToast);
  check('Delivery sees what it shipped', /Shipped|Caught|beat/.test(ana.window.App.lastToast), ana.window.App.lastToast);
  await until(()=>{ const v = boardVal(1); return v && v !== '0' && new RegExp('Team Fox · ' + v.replace('−','\\u2212') + ' points?').test(desk(ana).team) && desk(sam).team.indexOf(v)>0; }, 4000);
  check('points go up on the board as orders are checked, and the phones agree', boardVal(1)!=='0' && desk(ana).team.indexOf(boardVal(1))>0 && desk(sam).team.indexOf(boardVal(1))>0, boardVal(1)+' | Ana: '+desk(ana).team+' | Sam: '+desk(sam).team);

  section('Round 5: no AI');
  nextC(); await until(()=>screen(con)==='console-intro' && txt(con,'#cTitle')==='Round 5: Pull the plug');
  nextC(); await until(()=>screen(ana)==='phone-noai' && !!desk(ana).cust);
  check('no AI at all, and nothing picked', /No AI this round/.test(desk(ana).ai) && desk(ana).picked===null && $(ana,'#pHand').disabled && /^Pricing$/.test(desk(ana).station), JSON.stringify(desk(ana)));
  for (let i = 0; i < 4; i++) { await until(()=>$(ana,'.opts button') && !ana.window.App.desk.busy, 2000); pickTruth(ana); click(ana.window, $(ana,'#pHand')); await sleep(60); }
  await until(()=>$(sam,'.opts button'), 2000); pickTruth(sam); click(sam.window, $(sam,'#pHand')); await sleep(100);

  section('The final board');
  nextC();
  await until(()=>on(con,'reveal') && screen(con)==='console-final');
  await until(()=>(row(code,'pub/ctl')||{}).phase==='final');
  const ctl = row(code,'pub/ctl'), seats = row(code,'pub/seat');
  const endOf = r => { const t = (ctl.tm||{})['r'+r]; return t ? Math.min(t.ran, t.dur + (t.add||0)) : 0; };
  const repOf = (t, r) => seats[r] && seats[r][t] ? GG.replay(r, GG.seats(seats[r][t], r), logsFrom(t, r), endOf(r)) : null;
  const truth = [1,2,3].map(t => { const reps = [0,1,2,3,4].map(r => repOf(t, r)); return { t, reps, pts1: GG.half(reps,0).pts, pts2: GG.half(reps,1).pts }; });
  const fin = cw.placed(truth.map(x => ({ t:x.t, pts2:x.pts2 })), 'pts2');
  check('first half and second half side by side, every table right', txt(con,'#rvSlide .colhead')==='1st half2nd half' && truth.every(x => txt(con,'#rvSlide [data-t="'+x.t+'"] .v.first')===cw.num(x.pts1) && txt(con,'#rvSlide [data-t="'+x.t+'"] .v.last')===cw.num(x.pts2)), truth.map(x=>x.t+':'+x.pts1+'/'+x.pts2).join(' ') + ' vs ' + $$(con,'#rvSlide .rank li').map(l=>l.getAttribute('data-t')+':'+txt(con,'#rvSlide [data-t="'+l.getAttribute('data-t')+'"] .v.first')+'/'+txt(con,'#rvSlide [data-t="'+l.getAttribute('data-t')+'"] .v.last')).join(' ') + ' head=' + txt(con,'#rvSlide .colhead'));
  check('ranked on the second half', $$(con,'#rvSlide .rank li').map(l => +l.getAttribute('data-t')).join()===fin.map(x=>x.t).join());
  await until(()=>screen(ana)==='phone-final' && /second half/.test(txt(ana,'#pRes h2')));
  const anaP = GG.person(anaSeat, truth[0].reps);
  check('each phone: its place in the second half, agreeing with the board', txt(ana,'#pRes h2')==='Your desk finished '+cw.placeWords(fin.find(x=>x.t===1))+' in the second half.', txt(ana,'#pRes h2'));
  check('and mistakes caught and shipped, first half against second', txt(ana,'.cmp')===('1st half2nd halfMistakes caught'+anaP.caught[0]+anaP.caught[1]+'Mistakes shipped'+anaP.shipped[0]+anaP.shipped[1]), txt(ana,'.cmp'));
  click(cw, $(con,'#rvNext')); await until(()=>screen(con)==='console-surrender');
  check('the closing shows the surrender loop first', /Hand it off.*Skip the book.*Trust it more.*Skill fades/.test(txt(con,'.loop.sur')) && $(con,'.loop.eng').classList.contains('off'));
  click(cw, $(con,'#rvNext')); await until(()=>screen(con)==='console-loops');
  check('Next adds the engagement loop beside it, and the button says End', !$(con,'.loop.eng').classList.contains('off') && /Make your call/.test(txt(con,'.loop.eng')) && txt(con,'#rvNext')==='End');

  section('Ending');
  click(cw, $(con,'#rvNext'));
  await until(()=>screen(con)==='console-thanks');
  check('End says thanks, with six seconds to undo', /Thanks for taking the shift\./.test(txt(con,'#rvSlide')) && !!$(con,'#cUndoEnd'));
  click(cw, $(con,'#cUndoEnd'));
  await sleep(450);
  check('Undo keeps the session', rows(code) > 0 && screen(con)==='console-loops' && txt(con,'#rvNext')==='End');
  click(cw, $(con,'#rvNext'));
  await until(()=>on(con,'gate'), 3000);
  check('the session is deleted from the server', rows(code)===0);
  check('the console ends on thanks and what the room did', txt(con,'#gHead')==='Thanks for taking the shift.' && /3desks/.test(txt(con,'#gExtra')) && screen(con)==='ended');
  await until(()=>on(ana,'gate'), 3000);
  check('each phone ends with thanks and its own numbers', /Thanks for taking the shift, Ana\./.test(txt(ana,'#gHead')) && /Mistakes caught/.test(txt(ana,'#gExtra')) && screen(ana)==='phone-ended');
  check('the console view is gone once it ends', !shows(con,'#console') && shows(con,'#gate'));
  await partFive();
}

async function partFive(){
  section('A full room');
  const code2 = 'FULLRM', sk2 = 'fullroomkey';
  await call('POST','/api/create', { tool:'good-call', code:code2, sk:sk2 });
  await call('POST','/api/set', { tool:'good-call', code:code2, path:'pub/ctl', value:{ phase:'lobby', set:{ teams:10, len:4 }, tm:{} } }, sk2);
  for (let i = 1; i <= 60; i++) await call('POST','/api/claim', { tool:'good-call', code:code2, path:'pax/p'+i, value:{ nick:'X' } }, sk2);
  const full = load(HOSTED + '#c=' + code2 + '&k=' + sk2 + '&r=pax'); await until(()=>$(full,'#jName'));
  type(full.window, $(full,'#jName'), 'Zed'); click(full.window, $(full,'#jGo'));
  await until(()=>/full/.test(txt(full,'#jErr')), 8000);
  check('the 61st person is told the room is full', /This room is full\. Up to 60 people/.test(txt(full,'#jErr')));
  full.window.stopLoops(); full.window.close();

  section('Links that don\'t open a session');
  const bad = load(HOSTED + '#c=' + code2 + '&k=wrongkey&r=pax');
  await until(()=>on(bad,'gate'));
  check('a wrong key: this link doesn\'t open a session', /This link doesn't open a session/.test(txt(bad,'#gHead')) && screen(bad)==='gate');
  const gone = load(HOSTED + '#c=NOSUCH&k=x&r=pax');
  await until(()=>on(gone,'gate'));
  check('a session that isn\'t there: this session isn\'t running', /isn't running/.test(txt(gone,'#gHead')));

  section('Test drive: practice players, nothing sent anywhere');
  const td = load(HOSTED, { live:false }); const tw = td.window;
  await until(()=>on(td,'studio'));
  click(tw, $(td,'#stBuild')); click(tw, $(td,'#st1 [data-next="2"]')); click(tw, $(td,'#st2 [data-next="3"]'));
  click(tw, $(td,'#stDrive'));
  await until(()=>on(td,'console') && /29\s*in/.test(txt(td,'#chip')), 6000);
  check('Test drive opens the console, and practice people fill the tables', on(td,'console') && /29\s*in/.test(txt(td,'#chip')) && shows(td,'#simBar'), txt(td,'#chip'));
  check('table 1 keeps a seat for you', txt(td,'[data-table="1"] .cnt')==='2' && txt(td,'[data-table="2"] .cnt')==='3');
  tw.next(); await until(()=>screen(td)==='console-opening'); tw.next(); tw.next(); tw.next();
  await until(()=>screen(td)==='console-first');
  await until(()=>$$(td,'#fList li').filter(li => /Shipped/.test(li.textContent)).length >= 2, 20000);
  check('the practice desks pass the first order down their lines', $$(td,'#fList li').filter(li => /Shipped/.test(li.textContent)).length >= 2, txt(td,'#fFoot'));
  tw.next();
  await until(()=>screen(td)==='console-round');
  await jump(td, 90000);
  await until(()=>$$(td,'#bList .v.last').some(v => +v.textContent > 0), 8000);
  check('the practice desks play the round on their own', $$(td,'#bList .v.last').some(v => +v.textContent > 0));
  click(tw, $(td,'#segPax'));
  await until(()=>on(td,'phone') && $(td,'#jName'));
  check('the participant view joins as one more person', on(td,'phone') && shows(td,'#simBar2') && screen(td)==='phone-join');
  type(tw, $(td,'#jName'), 'You'); click(tw, $(td,'#jGo'));
  await until(()=>$(td,'#pGrid button')); click(tw, $(td,'#pGrid [data-t="1"]'));
  await until(()=>screen(td)==='phone-late');
  check('joining mid-round waits for the next round, as in a live room', screen(td)==='phone-late');
  click(tw, $(td,'#segCon2')); await until(()=>on(td,'console'));
  tw.next(); await until(()=>screen(td)==='console-intro');
  click(tw, $(td,'#segPax')); await until(()=>screen(td)==='phone-intro');
  check('at the next round you get a desk at table 1', /Round 2: you're on/.test(txt(td,'#pEyesH')), txt(td,'#pEyesH'));
  click(tw, $(td,'#segCon2')); await until(()=>on(td,'console'));
  tw.next(); await until(()=>screen(td)==='console-round');
  click(tw, $(td,'#segPax')); await until(()=>/phone-(desk|book)/.test(screen(td)));
  check('and play it from the participant view', /phone-desk/.test(screen(td)) && (!!desk(td).cust || /Waiting/.test(desk(td).waiting)));
  click(tw, $(td,'#simExit2'));
  await until(()=>on(td,'studio'));
  check('Exit test drive returns to the review, setup intact', $(td,'#st3').classList.contains('on') && /10 teams/.test(txt(td,'#review')));
  check('a test drive sends nothing anywhere', fetchesInDrive===0, fetchesInDrive);

  section('Every screen rebuilds for the feedback board');
  const fb = load(HOSTED, { live:false }); const fw = fb.window;
  await until(()=>on(fb,'studio'));
  const secs = fw.EPKit.tool.sections(), names = secs.flatMap(s => s.screens), texts = {};
  check('each screen is listed once', new Set(names).size===names.length && names.length >= 39, names.length);
  let bad2 = [], t0 = Date.now();
  for (const sc of names) {
    const ok = fw.EPKit.tool.restore({ screen: sc, settings: {} });
    const name = fw.EPKit.tool.screen();
    const vis = ['studio','console','phone','gate'].find(v => on(fb, v)), text = ((vis==='studio' ? fw.document.querySelector('#studio .step.on') : fw.document.getElementById(vis)).textContent + (on(fb,'reveal') ? fw.document.getElementById('reveal').textContent : '') + (fw.App.bookOpen ? txt(fb,'#book') : '')).replace(/\s+/g,' ').trim();
    texts[sc] = text;
    if (!ok || name !== sc || text.length < 10) bad2.push(sc + ' -> ' + name);
  }
  check('restore opens every screen, and screen() names it', bad2.length===0, bad2.join(', '));
  const dup = names.filter((a, i) => names.some((b, j) => j < i && texts[a]===texts[b]));
  check('each screen draws something of its own', dup.length===0, dup.join(', '));
  check('rebuilding every screen stays quick', Date.now() - t0 < 30000, (Date.now()-t0)+' ms');
  fw.EPKit.tool.restore({ screen:'phone-desk', settings:{} });
  check('a rebuilt desk has a real order on it', !!desk(fb).cust && !!$(fb,'#pHand'));
  fw.EPKit.tool.restore({ screen:'console-audit', settings:{} });
  check('a rebuilt audit shows the board in points', txt(fb,'#rvSlide .colhead')==='Points' && $$(fb,'#rvSlide .rank li').length===4);
  check('the state a comment carries names the screen\'s moment', fw.EPKit.tool.state().phase==='audit' && fw.EPKit.tool.state().role==='console');

  section('Scores and places in random rooms, every size, with ties');
  const W = fb.window, GG = W.GC;
  let agreeBad = [], tieSeen = { 1:0, 2:0, 3:0, mid:0 }, rooms = 0;
  const rnd = (() => { let s = 12345; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; })();
  for (let teams = 2; teams <= 12; teams++) for (let trial = 0; trial < 3; trial++) {
    rooms++;
    const rowsS = {}, put = (p, v) => { rowsS[p] = { v, t: Date.now() }; };
    let pid = 0; const tables = {};
    for (let t = 1; t <= teams; t++) { const n = 1 + Math.floor(rnd() * 5); tables[t] = []; for (let j = 0; j < n; j++) { pid++; tables[t].push('p'+pid); put('pax/p'+pid, { nick:'P'+pid }); put('tb/p'+pid, { t, at: pid }); } }
    const seat = {}; for (let r = 0; r < 5; r++) seat[r] = JSON.parse(JSON.stringify(tables));
    put('pub/seat', seat);
    const tm = {}; for (let r = 0; r < 5; r++) tm['r'+r] = { dur:240000, ran:240000, running:false, from:null, add:0 };
    put('pub/ctl', { phase:'final', step:null, rv:0, set:{ teams, len:4 }, tm });
    /* play each desk; then copy one desk's moves onto another of the same size, so they tie */
    const logsBy = {};
    for (let t = 1; t <= teams; t++) for (let r = 0; r < 5; r++) {
      const until = rnd() < 0.15 ? 0 : 20000 + Math.floor(rnd() * 120000);
      const logs = W.demoPlay(r, t, tables[t], until, null); logsBy[t+':'+r] = logs;
      Object.keys(logs).forEach(p => W.chunks(logs[p]).forEach((str, i) => put(W.logPath(t, r, p, i), str)));
    }
    const sizes = {}; Object.keys(tables).forEach(t => (sizes[tables[t].length] = sizes[tables[t].length] || []).push(+t));
    Object.values(sizes).filter(a => a.length > 1).forEach(a => { const src = a[0], dst = a[1];
      for (let r = 0; r < 5; r++) {
        Object.keys(rowsS).filter(k => k.startsWith('t'+dst+'/'+r+'/')).forEach(k => delete rowsS[k]);
        const L = logsBy[src+':'+r], M = {};
        tables[src].forEach((p, i) => { M[tables[dst][i]] = L[p] || []; W.chunks(M[tables[dst][i]]).forEach((str, j) => put(W.logPath(dst, r, tables[dst][i], j), str)); });
        logsBy[dst+':'+r] = M;
      } });
    W.Sim.rows = rowsS; W.App.sim = true; W.App.offset = 0;
    let d = W.Sim.read(); W.Sim.set('pub/lob', W.lobOf(W.people(d.state))); W.Sim.set('pub/board', W.demoBoard(W.Sim.read().state)); d = W.Sim.read(); W.App.S = d.state; W.App.times = d.times;
    /* the console's board, as drawn */
    const box = W.document.createElement('div'); box.innerHTML = '<div class="colhead"></div><ol class="rank"></ol><p class="boardfoot"></p>'; W.document.body.appendChild(box);
    const c = W.C(); W.drawBoard(box, c, 'final', {});
    const rowsC = W.boardRows(c), placesC = W.placed(rowsC, 'pts2'), placesC1 = W.placed(rowsC, 'pts1');
    placesC.forEach(x => { if (x.tied) { if (x.place <= 3) tieSeen[x.place]++; else tieSeen.mid++; } });
    /* every table: the drawn row, the public row and the phone at that table agree, and the engine agrees with them */
    for (let t = 1; t <= teams; t++) {
      const reps = [0,1,2,3,4].map(r => GG.replay(r, GG.seats(tables[t], r), logsBy[t+':'+r], 240000));
      const want2 = GG.half(reps, 1).pts, want1 = GG.half(reps, 0).pts, pc = placesC.find(x => x.t===t), pc1 = placesC1.find(x => x.t===t);
      const li = box.querySelector('[data-t="'+t+'"]'), shown = li.querySelector('.v.last').textContent, rk = li.querySelector('.rk').textContent;
      W.App.role = 'pax'; W.App.seat = tables[t][0]; W.App.me = { nick:'P' }; W.App.log = {}; W.App.myPick = null;
      const mp = W.myPlace('pts2'), mp1 = W.myPlace('pts1'), h2 = (W.finalHtml().match(/<h2>(.*?)<\/h2>/)||[])[1], a2 = (W.auditHtml().match(/<h2>(.*?)<\/h2>/)||[])[1];
      W.App.role = null;
      const ok = shown===W.num(want2) && pc.pts2===want2 && pc1.pts1===want1 && rk===(pc.tied ? '='+pc.place : String(pc.place)) && mp.place===pc.place && mp.tied===pc.tied && mp1.place===pc1.place &&
        h2==='Your desk finished '+W.placeWords(pc)+' in the second half.' && a2==='Your desk finished '+W.placeWords(pc1)+'.' && li.classList.contains('lead')===(pc.place===1);
      if (!ok) agreeBad.push(teams+'/'+t+': '+[shown, want2, rk, pc.place, mp && mp.place, h2].join(' '));
    }
    box.remove();
  }
  check('in '+rooms+' random rooms of 2 to 12 desks and 1 to 5 people, the board, the public row, every phone and the engine agree', agreeBad.length===0, agreeBad.slice(0,3).join(' | '));
  check('ties came up at first, second, third and further down, and each screen said tied', tieSeen[1] > 0 && tieSeen[2] + tieSeen[3] + tieSeen.mid > 0, JSON.stringify(tieSeen));

  section('Long logs stay under the worker\'s row limit');
  const big = Array.from({ length:400 }, (_, i) => ({ k:i, s:i%3, a:i%9 ? 'h' : 'b', c:i%9 ? i%5 : undefined, f:i%8, d:4100 + i*10, t:i*700, as: i%50===0 ? 'p7' : undefined }));
  const parts = W.chunks(big);
  check('a 400-move log splits into rows under 4,000 characters', parts.length > 1 && parts.every(p => JSON.stringify(p).length < 4000), parts.map(p=>p.length).join(','));
  W.Sim.rows = {}; parts.forEach((p, i) => W.Sim.set(W.logPath(2, 1, 'p5', i), p));
  const back = W.logsOf(2, 1, W.Sim.read().state).p5;
  check('and reads back as the same moves, in order', back.length===400 && GG.pack(back)===GG.pack(big));

  finish();
}





function finish(){
  doms.forEach(d => { try { d.window.stopLoops && d.window.stopLoops(); d.window.Bots && d.window.Bots.stop(); d.window.close(); } catch(e){} });
  check('no script errors on any screen', errors.length===0, errors.slice(0,3).join(' | '));
  console.log('\n' + (failures ? failures + ' FAILED, ' : 'All green: ') + passes + ' passed');
  process.exit(failures ? 1 : 0);
}
