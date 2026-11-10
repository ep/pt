/* qa-success-factors.mjs: jsdom harness for field-tools/success-factors/index.html.
   Runs the studio, the console and several laptops against the real pt worker code (fake database),
   decodes the join QR with jsQR, rebuilds every screen the way the feedback board does,
   and checks the ranking, the meter and the limits directly.
   Run: node _backend/tests/qa-success-factors.mjs   (needs: npm install jsdom jsqr) */
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
const html = fs.readFileSync(path.join(here, '../../field-tools/success-factors/index.html'), 'utf8');
let failures = 0;
function check(name, cond, detail){ console.log((cond?'PASS  ':'FAIL  ')+name+(!cond && detail ? '  :: '+detail : '')); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0=Date.now(); while (Date.now()-t0 < (ms||4000)){ try{ if (fn()) return true; }catch(e){} await sleep(15); } return false; }
const HOSTED = 'https://ep.github.io/pt/field-tools/success-factors/';
const env = { DB: FakeDB() };
const errors = [];
let fetchesInDrive = 0;
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; if ((init.method||'GET')==='POST' && /\/api\/set$/.test(String(url))) win.posts = (win.posts||0) + 1; const req = new Request(String(url), { method:init.method||'GET', headers:Object.assign({ Origin:'https://ep.github.io' }, init.headers||{}), body:init.body }); return worker.fetch(req, env); }; }
const doms = [];
function load(url, opts){
  opts = opts || {};
  const d = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){
    if (opts.live !== false) mockFetch(window); else window.fetch = async () => { fetchesInDrive++; throw new Error('no network in a test drive'); };
    if (opts.seed) Object.keys(opts.seed).forEach(k=>window.localStorage.setItem(k, opts.seed[k]));
    window.URL.createObjectURL = (b) => { window.lastBlob = b; return 'blob:x'; }; window.URL.revokeObjectURL = () => {};
    window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } });
    window.HTMLMediaElement.prototype.play = function(){ window.played = (window.played||[]).concat([this.src]); return Promise.resolve(); };
    window.HTMLMediaElement.prototype.pause = function(){};
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    window.HTMLAnchorElement.prototype.click = function(){ window.clickedDownload = this.download; };
    window.addEventListener('error', e => errors.push(String(e.message)));
  } });
  d.window.eval(fast + (opts.skew ? 'App.skew='+opts.skew+';' : ''));
  if (d.window.App.role) d.window.startLoops();
  doms.push(d); return d;
}
const fast = 'App.pollMs=40; App.hbMs=250; App.retryMs=5; App.countMs=10; App.botMs=15; App.tickMs=20; App.anim=false; App.bannerMs=40; App.endMs=300;';
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, el, k, extra){ el.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key:k, bubbles:true }, extra||{}))); }
function on(d, id){ return d.window.document.getElementById(id).classList.contains('on'); }
function hidden(d, id){ return d.window.document.getElementById(id).classList.contains('hide'); }
function txt(d, id){ return d.window.document.getElementById(id).textContent; }
function row(code, p){ const r = env.DB._rows.get('sf:'+code+'|'+p); return r ? JSON.parse(r.value) : undefined; }
function rows(code){ let n=0; env.DB._rows.forEach((v,k)=>{ if (k.startsWith('sf:'+code+'|')) n++; }); return n; }
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
async function joinLaptop(link, name, mascot, opts){
  const d = load(link, opts); const w = d.window, doc = w.document;
  await until(()=>doc.getElementById('jName'));
  type(w, doc.getElementById('jName'), name);
  click(w, doc.querySelector('#jPick [data-m="'+mascot+'"]'));
  click(w, doc.getElementById('jGo'));
  return d;
}
const stageText = d => d.window.document.getElementById('cStage').textContent;
const bodyText = d => d.window.document.getElementById('pBody').textContent;
/* a real drag: press on one element, move, and let go over another */
function drag(d, src, target){
  const w = d.window, doc = w.document; doc.elementFromPoint = () => target;
  src.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles:true, clientX:10, clientY:10, button:0 }));
  w.dispatchEvent(new w.MouseEvent('pointermove', { bubbles:true, clientX:90, clientY:80 }));
  const ghost = !!doc.querySelector('.ghostcard'), outlined = target.classList.contains('dropok');
  w.dispatchEvent(new w.MouseEvent('pointerup', { bubbles:true, clientX:90, clientY:80 }));
  return { ghost, outlined };
}

(async function(){
  /* ---------- the file ---------- */
  check('noindex is set', html.includes('<meta name="robots" content="noindex, nofollow">'));
  check('no analytics', !/clarity|googletagmanager|gtag\(|analytics/i.test(html));
  check('the shared favicon, send kit and feedback kit load by absolute path', html.includes('/pt/assets/favicon/favicon.svg') && html.includes('<script src="/pt/assets/kit/send.js" defer>') && html.includes('<script src="/pt/assets/kit/feedback.js" defer>'));
  check('tool id sf and the shared worker', /var TOOL_ID = "sf";/.test(html) && html.includes('var WORKER_URL = "https://pt.armand-khambatta.workers.dev"'));
  check('one file, well under 400 KB', html.length < 400000);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]).filter(u=>!/^https?:\/\/(pt\.armand-khambatta\.workers\.dev|ep\.github\.io\/pt|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org)/.test(u));
  check('talks only to the worker, the fonts and its own site', urls.length===0, urls.slice(0,3).join(' '));
  check('no em dashes in anything people read', !/\u2014/.test(html));
  check('the house look: Montserrat and Georgia, warm paper, teal for essential and clay for aspirational', /family=Montserrat/.test(html) && /Georgia/.test(html) && /#FBF8F3/i.test(html) && /\.col\.e\{[^}]*--teal/.test(html) && /\.col\.a\{[^}]*--clay/.test(html) && !/Big Shoulders|Archivo/.test(html));
  check('control groups and board groups keep separate classes', /\.controls \.cgrp\{/.test(html) && !/\.controls \.grp\b/.test(html) && !/class="grp"><button/.test(html));
  check('vote rows keep their own class (no clash with the ideas list)', /\.bopt\.voted\{/.test(html) && !/\.bopt\.mine/.test(html));
  check('an empty podium step has its own class (no clash with the empty-state message that lifted it)', /\.pstep\.vacant \.blk\{/.test(html) && !/\.pstep\.empty/.test(html) && !/" empty"\) \+ '" data-medal/.test(html));

  /* ---------- the gate ---------- */
  let r = await call('GET','/api/health');
  check('the worker gates sf', r.data.gatedTools.includes('sf'));

  /* ---------- Studio: one idea per step ---------- */
  const st = load(HOSTED); const sw = st.window, sd = sw.document;
  await until(()=>on(st,'studio'));
  check('the studio opens with no hash, on its first step', on(st,'studio') && !on(st,'console') && sd.getElementById('st0').classList.contains('on') && sw.EPKit.tool.screen()==='studio-start');
  check('studio defaults: 5 votes, top 10, a goal of 100 ideas, and 5, 15, 2 and 3 minutes', ['stVotes','stTop','stGoal','stTi','stTs','stTm','stTv'].map(id=>txt(st,id)).join()==='5,10,100,5,15,2,3');
  click(sw, sd.getElementById('stBuild'));
  check('Set up a session opens the question step', sd.getElementById('st1').classList.contains('on') && sw.EPKit.tool.screen()==='studio-question');
  type(sw, sd.getElementById('stInit'), 'Northwind relaunch');
  check('the prompt fills in from the initiative, as a sentence to finish', sd.getElementById('stQ').value==='This Northwind relaunch will be successful if\u2026');
  check('timing has its own step, apart from the votes and the goal', !!sd.querySelector('#st2 .stepper[data-k="votes"]') && !!sd.querySelector('#st2 .stepper[data-k="goal"]') && !!sd.querySelector('#st3 .stepper[data-k="ti"]') && !!sd.querySelector('#st3 .stepper[data-k="tm"]') && !sd.querySelector('#st2 .stepper[data-k="ti"]') && !sd.querySelector('#st3 .stepper[data-k="votes"]'));
  click(sw, sd.querySelector('#st1 [data-next="2"]'));
  const step = (k, d, n) => { for (let i=0;i<n;i++) click(sw, sd.querySelector('.stepper[data-k="'+k+'"] [data-d="'+d+'"]')); };
  step('votes', '1', 20);
  check('steppers hold their range, and the button at the end turns off', txt(st,'stVotes')==='15' && sd.querySelector('.stepper[data-k="votes"] [data-d="1"]').disabled);
  step('votes', '-1', 12); step('topN', '-1', 7);
  step('goal', '-10', 20);
  check('the goal moves in tens, down to 20', txt(st,'stGoal')==='20' && sd.querySelector('.stepper[data-k="goal"] [data-d="-10"]').disabled);
  check('the draft is kept on this device', JSON.parse(sw.localStorage.getItem('sf-draft')).votes===3 && JSON.parse(sw.localStorage.getItem('sf-draft')).goal===20);
  click(sw, sd.querySelector('#st2 [data-next="3"]'));
  check('the timing step names its screen', sw.EPKit.tool.screen()==='studio-timing');
  click(sw, sd.querySelector('#st3 [data-next="4"]'));
  check('the review lists every choice', /Northwind relaunch/.test(txt(st,'review')) && /3 votes each, top 3 ranked/.test(txt(st,'review')) && /20 ideas/.test(txt(st,'review')) && /5 min ideas, 15 min share and build, 2 min marking, 3 min vote/.test(txt(st,'review')));
  click(sw, sd.getElementById('stCopySetup'));
  const setupUrl = sw.copied.pop();
  const SU = load(setupUrl); await until(()=>on(SU,'studio'));
  check('a setup link reopens the same setup, at the review', /^https:\/\/ep\.github\.io\/pt\/field-tools\/success-factors\/\?setup=/.test(setupUrl) && SU.window.document.getElementById('st4').classList.contains('on') && /3 votes each, top 3 ranked/.test(txt(SU,'review')) && /Northwind relaunch/.test(txt(SU,'review')));
  SU.window.close();
  type(sw, sd.getElementById('stInit'), '');
  click(sw, sd.getElementById('stGo'));
  await sleep(30);
  check('starting without an initiative goes back for one, and starts nothing', sd.getElementById('st1').classList.contains('on') && /initiative/.test(txt(st,'st1Err')) && on(st,'studio'));
  type(sw, sd.getElementById('stInit'), 'Northwind relaunch');
  type(sw, sd.getElementById('stFac'), 'Pat');
  sw.goStep(4);
  click(sw, sd.getElementById('stGo'));
  await until(()=>on(st,'console'));
  const CODE = sw.App.code, KEY = sw.App.key;
  check('Start a live session opens the console in the same tab', on(st,'console'));
  check('feedback hook: the console says which phase it is on', sw.EPKit.tool.screen()==='console-lobby');
  check('a 6-letter code and a session key', /^[A-Z]{6}$/.test(CODE) && /^[A-Za-z0-9]{24}$/.test(KEY));
  check('the session is closed: a key, and no open paths', env.DB._rows.has('sf:'+CODE+'|_sk') && !env.DB._rows.has('sf:'+CODE+'|_open'));
  const c0 = row(CODE,'ctl');
  check('the control row holds the setup', c0.phase==='lobby' && c0.initiative==='Northwind relaunch' && c0.q==='This Northwind relaunch will be successful if\u2026' && c0.set.votes===3 && c0.set.topN===3 && c0.set.goal===20 && c0.set.t.share===15 && c0.allIn===false);
  check('the address carries the facilitator link in its hash', sw.location.hash==='#c='+CODE+'&k='+KEY+'&r=host');
  r = await call('GET','/api/state?tool=sf&code='+CODE);
  check('no key: the session refuses to be read', r.status===401);
  r = await call('GET','/api/state?tool=sf&code='+CODE, null, 'WRONGKEYWRONGKEY');
  check('a wrong key is refused', r.status===401);
  r = await call('POST','/api/set',{ tool:'sf', code:CODE, path:'idea/p1x1', value:{t:'sneaky'} });
  check('no key: writes are refused', r.status===401);

  /* ---------- the console's top bar and sound ---------- */
  check('the top bar names the tool and the initiative; the phase lives in the strip below', /^Success Factors\s*Northwind relaunch$/.test(txt(st,'cMark').trim()) && !/Lobby/.test(sd.querySelector('#console .topbar').textContent) && sd.querySelector('#cPhases .on').textContent==='Lobby');
  const mute = sd.getElementById('cMute'), vol = sd.getElementById('cVol');
  check('the console starts muted: a crossed-out speaker, and the volume greyed out', mute.classList.contains('muted') && mute.getAttribute('aria-pressed')==='false' && /B14E1C/.test(mute.innerHTML) && vol.disabled);
  check('the lobby says how to share sound, in quotes', /"Share sound"/.test(txt(st,'cCtl')));
  click(sw, mute);
  check('sound on: a plain speaker, the volume works, and the choice is kept', !mute.classList.contains('muted') && mute.getAttribute('aria-pressed')==='true' && !/B14E1C/.test(mute.innerHTML) && !vol.disabled && sw.localStorage.getItem('sf-sound')==='on');
  click(sw, mute);
  check('and off again', mute.classList.contains('muted') && vol.disabled && sw.localStorage.getItem('sf-sound')==='off');

  /* ---------- Lobby, QR and joining ---------- */
  await until(()=>sd.querySelector('#cStage .qr svg'));
  const joinLink = sw.joinLink();
  check('the join link carries the code and the key in its hash', joinLink===HOSTED+'#c='+CODE+'&k='+KEY+'&r=pax');
  check('the lobby QR decodes to the join link (jsQR)', qrOf(sd.querySelector('#cStage .qr'))===joinLink);
  click(sw, sd.querySelector('[data-a="copyjoin"]')); click(sw, sd.querySelector('[data-c="copyhost"]'));
  check('Copy link and Copy facilitator link copy the right links', sw.copied[0]===joinLink && sw.copied[1]===sw.hostLink());
  const A = load(joinLink); const aw = A.window, ad = aw.document;
  await until(()=>ad.getElementById('jName') && /Northwind/.test(txt(A,'jInit')));
  check('the welcome names the initiative, and the button enters the lobby', /^Welcome!/.test(ad.querySelector('.welcome').textContent) && txt(A,'jInit')==="You're here to help define success for Northwind relaunch." && txt(A,'jGo')==='Enter the lobby');
  check('Enter the lobby waits for a name and a mascot', ad.getElementById('jGo').disabled);
  type(aw, ad.getElementById('jName'), 'Ana'); click(aw, ad.querySelector('#jPick [data-m="m01"]'));
  check('then it turns on', !ad.getElementById('jGo').disabled);
  click(aw, ad.getElementById('jGo'));
  await until(()=>aw.App.seat && ad.querySelector('.waitpage'));
  check('a laptop joins by link and claims seat 1', aw.App.seat==='p1' && row(CODE,'pax/p1').nick==='Ana' && row(CODE,'who/p1').m==='m01');
  check('feedback hook: a seated laptop in the lobby is "laptop-lobby"', aw.EPKit.tool.screen()==='laptop-lobby');
  check('it waits in the lobby by name, with no header', /You're in, Ana!/.test(bodyText(A)) && !ad.querySelector('#laptop .topbar'));
  check('the foot shows who you are', txt(A,'pMe')==='Ana' && !hidden(A,'pMeWrap'));
  const pm = ad.getElementById('pMute');
  check('laptop sound starts on: a speaker and "Sound on"', /Sound on/.test(pm.textContent) && pm.querySelector('svg') && !/B14E1C/.test(pm.innerHTML));
  click(aw, pm);
  check('tapping it turns sound off: a crossed-out speaker, remembered on that laptop', /Sound off/.test(pm.textContent) && /B14E1C/.test(pm.innerHTML) && aw.localStorage.getItem('sf-pax-sound')==='off');
  click(aw, pm);
  /* two people pick the same mascot at the same moment: the later pick picks again */
  const B = load(joinLink), Cx = load(joinLink);
  await until(()=>B.window.document.getElementById('jName') && Cx.window.document.getElementById('jName') && B.window.document.querySelector('#jPick [data-m="m01"]').disabled);
  check('a mascot someone has is greyed out on other laptops', B.window.document.querySelector('#jPick [data-m="m01"]').disabled);
  check('feedback hook: a laptop that has not joined yet is "laptop-join"', B.window.EPKit.tool.screen()==='laptop-join');
  type(B.window, B.window.document.getElementById('jName'), 'Ben'); click(B.window, B.window.document.querySelector('#jPick [data-m="m02"]'));
  type(Cx.window, Cx.window.document.getElementById('jName'), 'Chi'); click(Cx.window, Cx.window.document.querySelector('#jPick [data-m="m02"]'));
  click(B.window, B.window.document.getElementById('jGo')); click(Cx.window, Cx.window.document.getElementById('jGo'));
  await until(()=>B.window.App.seat && Cx.window.App.seat);
  const grabbed = d => /Someone just grabbed that one/.test(bodyText(d));
  await until(()=>grabbed(B) || grabbed(Cx));
  await sleep(120);
  check('two picks of one mascot at once: exactly one person is asked to pick again', grabbed(B) !== grabbed(Cx));
  const loser = grabbed(B) ? B : Cx;
  click(loser.window, loser.window.document.querySelector('#jPick [data-m="m13"]')); click(loser.window, loser.window.document.getElementById('jGo'));
  await until(()=>loser.window.document.querySelector('.waitpage') && row(CODE,'who/'+loser.window.App.seat).m==='m13');
  check('a new pick lets them in', row(CODE,'who/'+loser.window.App.seat).m==='m13' && !!loser.window.document.querySelector('.waitpage'));
  /* B is seat 2, Cx seat 3, whoever won the mascot */
  const bySeat = { p2: B.window.App.seat==='p2' ? B : Cx, p3: B.window.App.seat==='p2' ? Cx : B };
  const P2 = bySeat.p2, P3 = bySeat.p3;
  await until(()=>txt(st,'chipIn')==='3' && sd.querySelectorAll('#cStage .crowd .who').length===3);
  check('the chip counts people here, and the lobby shows their mascots', txt(st,'chipIn')==='3' && sd.querySelectorAll('#cStage .crowd .who').length===3);
  check('names stay on laptops and the lobby; the facilitator holds no seat', !row(CODE,'pax/p4') && !Object.keys(sw.App.S.pax).includes('fac'));
  /* a fourth person, never in the room, who wrote a pile of ideas */
  await call('POST','/api/claim',{ tool:'sf', code:CODE, path:'pax/p4', value:{ nick:'Dee' } }, KEY);
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'who/p4', value:{ m:'m04', at:Date.now() } }, KEY);

  /* ---------- Ideas: private, timed, and the meter ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>ad.getElementById('pIdea') && row(CODE,'ctl').phase==='ideate');
  const ti = row(CODE,'ctl').timer;
  check('Start ideas moves every screen to Ideas, and its 5-minute timer starts on its own', row(CODE,'ctl').phase==='ideate' && ti.phase==='ideate' && ti.running===true && ti.dur===300000 && ti.endsAt - Date.now() > 290000);
  check('feedback hook: console and laptops name the phase', sw.EPKit.tool.screen()==='console-ideate' && aw.EPKit.tool.screen()==='laptop-ideate');
  await until(()=>!hidden(st,'cTimer') && /^[45]:\d\d$/.test(txt(st,'cDig')));
  check('the console clock runs, with pause on its face and a minute up or down beside it', /^[45]:\d\d$/.test(txt(st,'cDig')) && !!sd.querySelector('#tFace #tPlay') && sd.getElementById('tPlay').getAttribute('data-i')==='pause' && sd.getElementById('tUp').getAttribute('aria-label')==='Add a minute' && sd.getElementById('tDown').getAttribute('aria-label')==='Take off a minute');
  await until(()=>/left$/.test(txt(A,'pTm')));
  check('laptops count down too', /^[45]:\d\d left$/.test(txt(A,'pTm')));
  click(sw, sd.getElementById('tPlay'));
  await until(()=>row(CODE,'ctl').timer.running===false);
  const tp = row(CODE,'ctl').timer;
  check('pause stops the clock and keeps the time left', tp.running===false && tp.left > 290000 && tp.left <= 300000 && sd.getElementById('tPlay').getAttribute('data-i')==='play');
  click(sw, sd.getElementById('tUp'));
  await until(()=>row(CODE,'ctl').timer.left > tp.left + 59000);
  check('the up arrow adds a minute', Math.abs(row(CODE,'ctl').timer.left - tp.left - 60000) < 50);
  click(sw, sd.getElementById('tDown')); click(sw, sd.getElementById('tDown'));
  await until(()=>row(CODE,'ctl').timer.left < tp.left - 59000);
  check('the down arrow takes one off', Math.abs(tp.left - row(CODE,'ctl').timer.left - 60000) < 50);
  click(sw, sd.getElementById('tPlay'));
  await until(()=>row(CODE,'ctl').timer.running===true);
  check('play starts it again from where it was', row(CODE,'ctl').timer.running && Math.abs(row(CODE,'ctl').timer.endsAt - Date.now() - (tp.left - 60000)) < 1500);
  type(aw, ad.getElementById('pIdea'), 'A sponsor who shows up'); key(aw, ad.getElementById('pIdea'), 'Enter');
  type(aw, ad.getElementById('pIdea'), 'Typo idea'); click(aw, ad.getElementById('pSend'));
  type(aw, ad.getElementById('pIdea'), '<img src=x onerror=alert(1)>Training first'); key(aw, ad.getElementById('pIdea'), 'Enter');
  await until(()=>row(CODE,'idea/p1x3'));
  check('Enter and Add both send an idea, with its own id, kept private', row(CODE,'idea/p1x1').t==='A sponsor who shows up' && row(CODE,'idea/p1x2').t==='Typo idea' && row(CODE,'idea/p1x1').ph==='i' && !row(CODE,'idea/p1x1').sh);
  click(aw, ad.querySelectorAll('#pMine [data-p="edit"]')[1]);
  type(aw, ad.getElementById('pEdit'), 'Clear owners'); key(aw, ad.getElementById('pEdit'), 'Enter');
  await until(()=>row(CODE,'idea/p1x2').t==='Clear owners');
  check('a participant edits their own idea', row(CODE,'idea/p1x2').t==='Clear owners');
  await sleep(120); const keepA = ad.querySelector('#pMine li');
  const bw = P2.window, bd = bw.document, cw = P3.window, cd = cw.document;
  type(bw, bd.getElementById('pIdea'), 'Quick wins early'); key(bw, bd.getElementById('pIdea'), 'Enter');
  type(bw, bd.getElementById('pIdea'), 'Delete me'); key(bw, bd.getElementById('pIdea'), 'Enter');
  await until(()=>row(CODE,'idea/p2x2'));
  click(bw, bd.querySelectorAll('#pMine [data-p="del"]')[1]);
  await until(()=>row(CODE,'idea/p2x2')===null);
  check('a participant deletes their own idea', row(CODE,'idea/p2x2')===null && bd.querySelectorAll('#pMine li').length===1);
  type(cw, cd.getElementById('pIdea'), 'Front-line voices'); key(cw, cd.getElementById('pIdea'), 'Enter');
  await until(()=>txt(st,'ideaCount')==='5' && sd.querySelectorAll('#cStage .crowd .who.lit').length===3);
  check('the console shows the count and who has added, never the text', txt(st,'ideaCount')==='5' && !/sponsor|Quick wins|Front-line/.test(stageText(st)) && sd.querySelectorAll('#cStage .crowd .who.lit').length===3);
  check('a laptop sees only its own ideas', !/Quick wins/.test(bodyText(A)) && /sponsor/.test(bodyText(A)));
  check('other people\'s ideas never redraw a laptop\'s list, so a tap can\'t land mid-redraw', ad.querySelector('#pMine li')===keepA);
  const marks = [...sd.querySelectorAll('#cStage .meter .mk')];
  check('the meter marks are the levels, at a quarter, half, three quarters and the goal', marks.map(m=>m.textContent).join('|')==='Getting Somewhere|Deep Thinkers|Visionaries|Bell Ringers' && marks.map(m=>m.style.bottom).join()==='25%,50%,75%,100%');
  await until(()=>row(CODE,'ctl').lvl===1);
  check('5 of 20 ideas reaches the first mark, and the reading names it', row(CODE,'ctl').lvl===1 && sd.querySelector('#cStage .reading .lvl').textContent==='Getting Somewhere' && sd.querySelector('#cStage .mk.now').textContent==='Getting Somewhere' && sd.querySelector('#cStage .meter').getAttribute('aria-label')==='5 of 20 ideas');
  /* the room keeps going: Dee's ideas take it to the goal, and the bell rings */
  sw.dings = 0; sw.Snd.ding = () => { sw.dings++; };
  for (let k=1;k<=15;k++) await call('POST','/api/set',{ tool:'sf', code:CODE, path:'idea/p4x'+k, value:{ t:'Idea '+k+' from the far table', ph:'i', par:null, at:Date.now(), r:1 } }, KEY);
  await until(()=>row(CODE,'ctl').lvl===4 && sw.App.lastBanner==='Ding! 20 ideas.');
  check('at the goal the bell rings: a banner, the ding, and the meter lights up', row(CODE,'ctl').lvl===4 && sw.App.lastBanner==='Ding! 20 ideas.' && sw.dings===1 && sd.querySelector('#cStage .meter').classList.contains('rung') && sd.querySelector('#cStage .reading .lvl').textContent==='Bell Ringers');
  /* skewed clocks: two laptops 30 s fast and slow count down with the console */
  const F = load(joinLink, { skew: 30000, seed:{ ['sf-seat-'+CODE]:'p2' } });
  const S2 = load(joinLink, { skew: -30000, seed:{ ['sf-seat-'+CODE]:'p3' } });
  await sleep(450);
  await until(()=>F.window.document.getElementById('pTm').textContent && S2.window.document.getElementById('pTm').textContent);
  const t = row(CODE,'ctl').timer, remF = F.window.remaining(t), remS = S2.window.remaining(t), remC = sw.remaining(t);
  check('timers agree across screens with clocks 30 seconds apart', Math.abs(remF-remC)<1000 && Math.abs(remS-remC)<1000 && remC>200000);
  /* the chimes: once at one minute left, once at zero, then a 3-2-1 into sharing */
  sw.chimes = []; sw.Snd.oneMin = () => sw.chimes.push('one'); sw.Snd.zero = () => sw.chimes.push('zero');
  let tc = row(CODE,'ctl'); tc.timer.endsAt = Date.now() + 59000;
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>sw.chimes.length===1);
  await sleep(120);
  check('one minute left: one chime, and the clock turns to its warning colour', sw.chimes.join()==='one' && sd.getElementById('cDig').classList.contains('low'));
  tc = row(CODE,'ctl'); tc.timer.endsAt = Date.now() + 300;
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>F.window.document.getElementById('pIdea') && F.window.document.getElementById('pIdea').disabled && S2.window.document.getElementById('pIdea').disabled && ad.getElementById('pIdea').disabled, 3000);
  check('at zero every laptop locks input, whatever its clock', F.window.document.getElementById('pIdea').disabled && S2.window.document.getElementById('pIdea').disabled && ad.getElementById('pIdea').disabled);
  check('a locked laptop says time is up, and cannot send', !hidden(A,'pLock') && aw.addIdea()===false && txt(A,'pTm')==="Time's up");
  await until(()=>row(CODE,'ctl').phase==='share', 3000);
  check('the zero chime, then after a 3-2-1 the console moves to sharing on its own', row(CODE,'ctl').phase==='share' && sw.chimes.join()==='one,zero');
  const ts = row(CODE,'ctl').timer;
  check('sharing gets its own 15-minute timer, already running', ts.phase==='share' && ts.running===true && ts.dur===900000);
  F.window.stopLoops(); S2.window.stopLoops(); F.window.close(); S2.window.close();

  /* ---------- Share and build ---------- */
  await until(()=>ad.querySelector('#pMine [data-p="share"]') && !ad.getElementById('pIdea').disabled);
  check('feedback hook: sharing names its screens', sw.EPKit.tool.screen()==='console-share' && aw.EPKit.tool.screen()==='laptop-share');
  check('the board starts empty: nothing is shared until its author shares it', !/sponsor|Quick wins|Front-line|far table/.test(stageText(st)) && /Nothing shared yet/.test(stageText(st)));
  check('each laptop lists its ideas with a Share button', ad.querySelectorAll('#pMine [data-p="share"]').length===3 && /3 to share/.test(txt(A,'pMineHead')));
  click(aw, ad.querySelector('#pMine [data-p="share"][data-id="p1x1"]'));
  await until(()=>row(CODE,'idea/p1x1').sh && sd.querySelector('#cStage .card[data-id="p1x1"]'));
  check('Share puts one idea on the board for everyone', !!row(CODE,'idea/p1x1').sh && !!sd.querySelector('#cStage .card[data-id="p1x1"]') && !/Clear owners/.test(stageText(st)));
  check('a shared idea says so on its author\'s list, and can no longer be shared or edited', /On the board/.test(ad.querySelector('#pMine li[data-mine="p1x1"]').textContent) && !ad.querySelector('#pMine li[data-mine="p1x1"] button'));
  check('your ideas and the board are two separate, named spaces', /Your ideas/.test(ad.querySelector('.pnote').textContent) && /Only you can see these/.test(ad.querySelector('.pnote').textContent) && /The board/.test(ad.querySelector('.pboardp').textContent) && /Same as the shared screen/.test(ad.querySelector('.pboardp').textContent) && ad.querySelector('.pnote').contains(ad.getElementById('pMine')) && ad.querySelector('.pboardp').contains(ad.getElementById('pBoard')));
  check('the next idea to share stands out', ad.querySelector('#pMine li.next').getAttribute('data-mine')==='p1x2');
  await until(()=>ad.querySelector('#pBoard .card[data-id="p1x1"]'));
  check('your own cards on the board say so', !!ad.querySelector('#pBoard .card[data-id="p1x1"] .ytag'));
  check('on a phone, two tabs switch between your ideas and the board', ad.getElementById('pShare').getAttribute('data-tab')==='mine' && /Your ideas/.test(txt(A,'tabMine')) && /The board\s*1/.test(txt(A,'tabBoard')));
  click(aw, ad.getElementById('tabBoard'));
  check('the board tab shows the board', ad.getElementById('pShare').getAttribute('data-tab')==='board' && ad.getElementById('tabBoard').getAttribute('aria-selected')==='true');
  click(aw, ad.getElementById('tabMine'));
  await until(()=>txt(st,'chip').includes('shared') && sd.getElementById('chipMore').textContent==='1');
  check('the chip counts what is shared', sd.getElementById('chipMore').textContent==='1');
  click(aw, ad.querySelector('#pMine [data-p="share"][data-id="p1x3"]'));
  click(bw, bd.querySelector('#pMine [data-p="share"][data-id="p2x1"]'));
  await until(()=>bd.querySelector('#pBoard [data-p="on"][data-id="p1x1"]'));
  click(bw, bd.querySelector('#pBoard [data-p="on"][data-id="p1x1"]'));
  const bcard = () => bd.querySelector('#pBoard .card[data-id="p1x1"]');
  check('Build on opens a composer right under that card', bcard().classList.contains('sel') && !!bcard().parentNode.querySelector(':scope > .bbox #pBuild') && /Your build on this/.test(bcard().parentNode.querySelector('.bbox').textContent) && bw.document.activeElement===bd.getElementById('pBuild'));
  type(bw, bd.getElementById('pBuild'), '...who joins the monthly demo'); key(bw, bd.getElementById('pBuild'), 'Enter');
  await until(()=>row(CODE,'idea/p2x3'));
  const b1 = row(CODE,'idea/p2x3');
  check('a build records its parent and goes straight on the board', b1.par==='p1x1' && b1.ph==='b' && !!b1.sh);
  check('the composer closes once the build is in', !bd.getElementById('pBuild') && !bcard().classList.contains('sel'));
  await until(()=>bd.querySelector('#pBoard [data-p="on"][data-id="p1x3"]'));
  click(bw, bd.querySelector('#pBoard [data-p="on"][data-id="p1x3"]'));
  type(bw, bd.getElementById('pBuild'), 'half a thou'); bd.getElementById('pBuild').focus();
  type(cw, cd.getElementById('pIdea'), 'A shared channel for questions'); click(cw, cd.getElementById('pSend'));
  await until(()=>row(CODE,'idea/p3x2'));
  await until(()=>/A shared channel/.test(bd.getElementById('pBoard').textContent));
  check('a half-written build survives the board redrawing as others share', bd.getElementById('pBuild') && bd.getElementById('pBuild').value==='half a thou' && bw.document.activeElement===bd.getElementById('pBuild'));
  click(bw, bd.querySelector('.bbox [data-p="unbuild"]'));
  check('Cancel closes the composer', !bd.getElementById('pBuild'));
  check('a new idea in sharing has no parent and goes straight on the board', row(CODE,'idea/p3x2').par===null && !!row(CODE,'idea/p3x2').sh);
  await until(()=>cd.querySelector('#pBoard .card[data-id="p1x3"]') && cd.querySelector('#pMine li[data-mine="p3x1"][draggable="true"]'));
  const dd1 = drag(P3, cd.querySelector('#pMine li[data-mine="p3x1"]'), cd.querySelector('#pBoard .card[data-id="p1x3"]'));
  await until(()=>row(CODE,'idea/p3x1').sh);
  check('dragging your own idea onto a card shares it as a build on that card', dd1.ghost && dd1.outlined && !!row(CODE,'idea/p3x1').sh && row(CODE,'idea/p3x1').par==='p1x3' && row(CODE,'idea/p3x1').ph==='b');
  await until(()=>sd.querySelector('.card[data-id="p1x1"]') && sd.querySelector('.card[data-id="p1x1"]').parentNode.querySelector('.kids .card[data-id="p2x3"]') && sd.querySelector('.card[data-id="p3x1"]'));
  check('builds sit under the card they build on', !!sd.querySelector('.card[data-id="p1x1"]').parentNode.querySelector('.kids .card[data-id="p2x3"]') && !!sd.querySelector('.card[data-id="p1x3"]').parentNode.querySelector('.kids .card[data-id="p3x1"]'));
  check('typed text never runs as markup', !sd.querySelector('#cStage img') && /<img src=x/.test(stageText(st)));
  await until(()=>/A shared channel/.test(bodyText(A)));
  check('every laptop sees the shared board, not the private ideas', /A shared channel/.test(bodyText(A)) && !/far table/.test(bodyText(A)) && !/Clear owners/.test(bodyText(P2)));
  /* the facilitator groups, names, merges, edits, deletes and undoes */
  let before = sw.posts; sw.groupWith('p1x1','p2x1');
  await until(()=>row(CODE,'grp/g1') && row(CODE,'meta/p1x1') && row(CODE,'meta/p2x1'));
  check('dropping a card on a card makes a group, in 3 writes', row(CODE,'meta/p1x1').g==='g1' && row(CODE,'meta/p2x1').g==='g1' && sw.posts-before===3);
  await until(()=>sd.querySelector('[data-gt="g1"]'));
  check('the new group\'s name box opens', sd.activeElement===sd.querySelector('[data-gt="g1"]'));
  type(sw, sd.querySelector('[data-gt="g1"]'), 'Leadership'); key(sw, sd.querySelector('[data-gt="g1"]'), 'Enter');
  await until(()=>row(CODE,'grp/g1').t==='Leadership');
  check('naming a group saves it', row(CODE,'grp/g1').t==='Leadership');
  check('a build joins its parent\'s group', sw.model().I.p2x3.g==='g1');
  await until(()=>sd.querySelector('.card[data-id="p1x3"]') && sd.querySelector('[data-drop="grp:g1"]'));
  before = sw.posts;
  const dd2 = drag(st, sd.querySelector('.card[data-id="p1x3"]'), sd.querySelector('[data-drop="grp:g1"]'));
  await until(()=>row(CODE,'meta/p1x3') && row(CODE,'meta/p1x3').g==='g1');
  check('dragging a card onto a group adds it, in 1 write', dd2.ghost && dd2.outlined && row(CODE,'meta/p1x3').g==='g1' && sw.posts-before===1 && !sd.querySelector('.ghostcard'));
  sw.ungroup('p1x3');
  await until(()=>!row(CODE,'meta/p1x3').g);
  check('dropping on Not grouped takes a card out of its group', !row(CODE,'meta/p1x3').g);
  click(sw, sd.querySelector('[data-c="addcard"]'));
  await until(()=>sd.querySelector('.dlg #aT'));
  type(sw, sd.querySelector('.dlg #aT'), 'Systems ready before launch'); click(sw, sd.querySelector('.dlg [data-d="save"]'));
  await until(()=>row(CODE,'idea/fx1'));
  check('Add a card puts the facilitator\'s card on the board (fx ids)', row(CODE,'idea/fx1').t==='Systems ready before launch' && !!row(CODE,'idea/fx1').sh && !sd.querySelector('.dlg'));
  before = sw.posts; sw.mergeInto('fx1','p3x2');
  await until(()=>row(CODE,'meta/fx1') && row(CODE,'meta/fx1').mg==='p3x2');
  check('merge writes only the merged card', sw.posts-before===1 && row(CODE,'meta/fx1').mg==='p3x2');
  await until(()=>/\+1 merged/.test(stageText(st)));
  check('the card it went into says so, and the merged card leaves the board', /\+1 merged/.test(stageText(st)) && !/Systems ready/.test(stageText(st)));
  sw.splitOut('fx1');
  await until(()=>!row(CODE,'meta/fx1').mg);
  check('Split brings a merged card back', !row(CODE,'meta/fx1').mg);
  sw.editCard('p3x1','Front-line voices in the design','Two people from each site');
  await until(()=>row(CODE,'meta/p3x1') && row(CODE,'meta/p3x1').d);
  check('the facilitator edits text and detail, keeping the earlier text', row(CODE,'meta/p3x1').t==='Front-line voices in the design' && row(CODE,'meta/p3x1').h[0]==='Front-line voices' && row(CODE,'meta/p3x1').d==='Two people from each site');
  check('the author\'s own row is never changed', row(CODE,'idea/p3x1').t==='Front-line voices');
  await until(()=>/Two people from each site/.test(stageText(st)));
  sw.delCard('p3x2');
  await until(()=>row(CODE,'meta/p3x2') && row(CODE,'meta/p3x2').x===1);
  check('Delete hides a card', row(CODE,'meta/p3x2').x===1);
  key(sw, sd.body, 'z', { ctrlKey:true });
  await until(()=>!(row(CODE,'meta/p3x2')||{}).x);
  check('Ctrl+Z undoes the last board action', !(row(CODE,'meta/p3x2')||{}).x);
  key(sw, sd.body, 'z', { ctrlKey:true });
  await until(()=>!(row(CODE,'meta/p3x1')||{}).d);
  check('and the one before it', !(row(CODE,'meta/p3x1')||{}).d && !(row(CODE,'meta/p3x1')||{}).t);
  sw.editCard('p3x1','Front-line voices in the design','');
  await until(()=>sd.querySelector('[data-menu="p2x1"]'));
  click(sw, sd.querySelector('[data-menu="p2x1"]'));
  check('each card has a menu: Edit, Group with, Merge into and Delete, focused for the keyboard', ['edit','group','merge','delete'].every(k=>sd.querySelector('.menu [data-mi="'+k+'"]')) && sd.activeElement===sd.querySelector('.menu button'));
  key(sw, sd.querySelector('.menu'), 'Escape');
  check('Escape closes the menu', !sd.querySelector('.menu'));
  await until(()=>sd.querySelector('[data-menu="p3x1"]'));
  click(sw, sd.querySelector('[data-menu="p3x1"]')); click(sw, sd.querySelector('.menu [data-mi="history"]'));
  check('History lists the original wording', /Front-line voices/.test(sd.querySelector('.dlg').textContent) && /\(now\)/.test(sd.querySelector('.dlg').textContent));
  key(sw, sd.querySelector('.dlg'), 'Escape');
  click(sw, sd.getElementById('cQ'));
  type(sw, sd.getElementById('cQedit'), 'What has to be true for the relaunch to land?'); key(sw, sd.getElementById('cQedit'), 'Enter');
  await until(()=>row(CODE,'ctl').q==='What has to be true for the relaunch to land?' && row(CODE,'qh/1'));
  check('the facilitator can reword the question; the old wording is kept', row(CODE,'qh/1').q==='This Northwind relaunch will be successful if\u2026' && txt(st,'cQ')==='What has to be true for the relaunch to land?');
  await until(()=>/relaunch to land/.test(bodyText(A)));
  check('laptops pick up the new wording', /relaunch to land/.test(bodyText(A)));
  click(sw, sd.getElementById('cJoin'));
  await until(()=>on(st,'joinModal') && sd.querySelector('#jmWays .qr svg'));
  check('Join info opens the link and the code from any phase', !hidden(st,'cJoin') && qrOf(sd.querySelector('#jmWays .qr'))===joinLink);
  click(sw, sd.getElementById('jmClose'));
  check('and closes', !on(st,'joinModal'));
  /* pause screens: every laptop looks up, and the clock waits */
  check('Pause screens sits in the top bar while people work', !hidden(st,'cPause') && txt(st,'cPause')==='Pause screens' && hidden(st,'cPausedTag'));
  click(sw, sd.getElementById('cPause'));
  await until(()=>row(CODE,'ctl').paused===true);
  const tpz = row(CODE,'ctl').timer;
  check('pausing stops the clock with the screens', tpz.running===false && tpz.left > 0 && row(CODE,'ctl').pausedT===true && !hidden(st,'cPausedTag') && txt(st,'cPause')==='Resume screens' && sw.EPKit.tool.screen()==='console-paused');
  await until(()=>/Eyes up front/.test(bodyText(A)) && /Eyes up front/.test(bodyText(P2)));
  check('every laptop points at the shared screen, and can\'t add anything', /paused the screens/.test(bodyText(A)) && aw.EPKit.tool.screen()==='laptop-paused' && !ad.getElementById('pIdea') && aw.addIdea()===false);
  click(sw, sd.getElementById('cPause'));
  await until(()=>row(CODE,'ctl').paused===false && ad.getElementById('pIdea'));
  check('Resume brings the screens back and restarts the clock where it was', row(CODE,'ctl').timer.running===true && Math.abs(row(CODE,'ctl').timer.endsAt - Date.now() - tpz.left) < 2000 && aw.EPKit.tool.screen()==='laptop-share');
  /* time runs out on sharing: nothing locks, the console says so and waits */
  sw.chimes = [];
  tc = row(CODE,'ctl'); tc.timer.endsAt = Date.now() + 200;
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>sw.chimes.includes('zero') && sw.App.lastBanner==="Time's up");
  await sleep(150);
  check('when sharing time runs out: a chime and a banner, and the room keeps sharing', sw.App.lastBanner==="Time's up" && row(CODE,'ctl').phase==='share' && !ad.getElementById('pIdea').disabled);

  /* ---------- Sort: everyone marks what has to be true, then the room talks through the splits ---------- */
  const Mb = sw.model(), late = Mb.count - Mb.shared;
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='sort' && sd.getElementById('markCount'));
  check('moving on to Sort brings every unshared idea onto the board, and says how many', late===16 && row(CODE,'ctl').allIn===true && sw.App.lastBanner===late+' ideas join the board' && sw.model().count===sw.model().shared);
  const tm0 = row(CODE,'ctl').timer;
  check('sorting starts with marking, on its own 2-minute clock', row(CODE,'ctl').step==='mark' && tm0.phase==='sort' && tm0.running===true && tm0.dur===120000 && sw.EPKit.tool.screen()==='console-mark');
  check('while people mark, the console shows how many have marked, never what', txt(st,'markCount')==='0' && !/sponsor|far table|Training first/.test(stageText(st)) && /Everyone/.test(stageText(st)) && txt(st,'chipMore')==='0');
  await until(()=>ad.querySelectorAll('#pMarks .mopt').length && bd.querySelectorAll('#pMarks .mopt').length);
  const nItems = sw.model().items.length;
  check('every laptop lists each group and card to mark', nItems===20 && ad.querySelectorAll('#pMarks .mopt').length===nItems && aw.EPKit.tool.screen()==='laptop-mark' && /What has to be true\?/.test(bodyText(A)));
  check('everything starts unmarked', !ad.querySelector('#pMarks .mopt.on') && txt(A,'pMarkN')==='Nothing marked yet');
  const mark = (d,id)=>click(d.window, d.window.document.querySelector('#pMarks [data-id="'+id+'"]'));
  mark(A,'g1'); mark(A,'p4x1'); mark(A,'p4x1'); mark(A,'p4x1');
  await until(()=>row(CODE,'mark/p1') && row(CODE,'mark/p1').g1 && row(CODE,'mark/p1').p4x1);
  check('a tap marks a card, a second tap takes it back', JSON.stringify(row(CODE,'mark/p1'))==='{"g1":1,"p4x1":1}' && ad.querySelector('#pMarks [data-id="g1"]').getAttribute('aria-pressed')==='true' && txt(A,'pMarkN')==='2 cards marked');
  click(aw, ad.getElementById('pDone'));
  await until(()=>row(CODE,'mark/p1')._d===1);
  check('I\'m done says so, and marks can still change', row(CODE,'mark/p1')._d===1 && txt(A,'pDone')==='Done' && !ad.querySelector('#pMarks .mopt').disabled);
  await sleep(120); const keepM = ad.querySelector('#pMarks [data-id="g1"]');
  mark(P2,'g1'); mark(P2,'p1x3'); click(bw, bd.getElementById('pDone'));
  mark(P3,'g1'); click(cw, cd.getElementById('pDone'));
  await until(()=>row(CODE,'mark/p2') && row(CODE,'mark/p2')._d && row(CODE,'mark/p3') && row(CODE,'mark/p3')._d);
  await until(()=>txt(st,'markCount')==='3');
  check('the console counts who has marked and who is done, still without a word of what', txt(st,'markCount')==='3' && txt(st,'chipMore')==='3' && /3 people are done/.test(stageText(st)) && sd.querySelectorAll('#cStage .crowd .who.lit').length===3 && !/sponsor|far table|Training first/.test(stageText(st)));
  await sleep(200);
  check('other people\'s marks never redraw a laptop\'s list', ad.querySelector('#pMarks [data-id="g1"]')===keepM);
  /* time runs out: marking locks, then the room talks it through */
  tc = row(CODE,'ctl'); tc.timer.endsAt = Date.now() + 300;
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>ad.querySelector('#pMarks .mopt') && ad.querySelector('#pMarks .mopt').disabled, 3000);
  check('at zero every laptop stops marking', ad.querySelector('#pMarks .mopt').disabled && !hidden(A,'pLock') && aw.toggleMark('p3x2')===false);
  await until(()=>row(CODE,'ctl').step==='discuss' && sd.querySelector('#cStage .cols'), 3000);
  check('after a 3-2-1 the console moves on to talking it through, with no clock', row(CODE,'ctl').phase==='sort' && row(CODE,'ctl').step==='discuss' && hidden(st,'cTimer') && sw.EPKit.tool.screen()==='console-sort');
  const col = id => { const el = sd.querySelector('#cStage [data-item="'+id+'"]'); const c = el && el.closest('.col'); return c ? (c.classList.contains('e') ? 'e' : c.classList.contains('d') ? 'd' : 'a') : null; };
  check('what everyone marked is essential, what some marked is to talk about, the rest is aspirational', col('g1')==='e' && col('p4x1')==='d' && col('p1x3')==='d' && col('fx1')==='a' && sd.querySelectorAll('#cStage .col.a .item').length===17);
  check('each card shows how many marked it', /3 of 3/.test(sd.querySelector('[data-item="g1"] .mk2').textContent) && /1 of 3/.test(sd.querySelector('[data-item="p4x1"] .mk2').textContent) && sd.querySelector('[data-item="p4x1"] .mk2').classList.contains('split'));
  check('the controls say what is left to talk about', /2 cards are still to talk about/.test(txt(st,'cCtl')) && txt(st,'cNext')==='Start voting');
  await until(()=>/Eyes up front/.test(bodyText(P2)));
  check('laptops point everyone at the shared screen, with nothing to drag', /talking through/.test(bodyText(P2)) && bw.EPKit.tool.screen()==='laptop-sort' && !bd.querySelector('[data-item]') && !bd.getElementById('pBoard'));
  const dd3 = drag(st, sd.querySelector('[data-item="p1x3"]'), sd.querySelector('[data-drop="col:a"]'));
  await until(()=>row(CODE,'meta/p1x3') && row(CODE,'meta/p1x3').c==='a');
  check('dragging a card to Aspirational settles it', dd3.ghost && row(CODE,'meta/p1x3').c==='a' && col('p1x3')==='a');
  click(sw, sd.querySelector('[data-imenu="p4x1"]'));
  check('the item menu offers the other columns', [...sd.querySelectorAll('.menu button')].map(b=>b.textContent).join('|')==='Make it essential|Make it aspirational');
  click(sw, sd.querySelector('.menu [data-mi="e"]'));
  await until(()=>row(CODE,'meta/p4x1') && row(CODE,'meta/p4x1').c==='e');
  check('the item menu makes a card essential', row(CODE,'meta/p4x1').c==='e' && col('p4x1')==='e');
  await until(()=>sd.querySelector('[data-imenu="fx1"]'));
  click(sw, sd.querySelector('[data-imenu="fx1"]')); click(sw, sd.querySelector('.menu [data-mi="d"]'));
  await until(()=>row(CODE,'meta/fx1') && row(CODE,'meta/fx1').c==='d');
  check('any card can go to the room to talk about', col('fx1')==='d');
  click(sw, sd.querySelector('[data-imenu="fx1"]')); click(sw, sd.querySelector('.menu [data-mi="a"]'));
  await until(()=>row(CODE,'meta/fx1').c==='a');
  sw.dropOn('item','p4x2','item:g1');
  await until(()=>row(CODE,'meta/p4x2') && row(CODE,'meta/p4x2').c==='e');
  check('dropping a card on another card joins that card\'s column', row(CODE,'meta/p4x2').c==='e');
  sw.classify('p4x2', null);
  await until(()=>!(row(CODE,'meta/p4x2')||{}).c);
  check('nothing is left to talk about', !sd.querySelector('#cStage .col.d .item') && /Drag a card between the columns/.test(txt(st,'cCtl')));
  click(sw, sd.getElementById('cBack'));
  await until(()=>row(CODE,'ctl').step==='mark');
  check('Back returns to marking with the marks kept and the clock waiting', row(CODE,'ctl').timer.running===false && row(CODE,'mark/p1').g1===1 && txt(st,'cNext')==='Talk about the splits');
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').step==='discuss' && sd.querySelector('#cStage .cols'));
  check('and forward again keeps every decision', col('p4x1')==='e' && col('p1x3')==='a' && col('g1')==='e');

  /* ---------- Vote ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='vote' && bd.querySelector('[data-vote="+"]'));
  const tv0 = row(CODE,'ctl').timer;
  check('Vote starts its own 3-minute timer', tv0.phase==='vote' && tv0.running===true && tv0.dur===180000);
  check('every aspirational card is on the ballot on its own, nothing essential is', !bd.querySelector('[data-t="p1x1"]') && !bd.querySelector('[data-t="p2x3"]') && !bd.querySelector('[data-t="p4x1"]') && !!bd.querySelector('[data-t="p1x3"]') && !!bd.querySelector('[data-t="p3x1"]') && !!bd.querySelector('[data-t="fx1"]'));
  const b3 = bd.querySelector('[data-bar="p3x1"]');
  check('a build sits under the card it builds on, drawn as a chain', b3.classList.contains('build') && b3.previousElementSibling===bd.querySelector('[data-bar="p1x3"]') && b3.parentNode.classList.contains('bthread') && /building on/.test(b3.getAttribute('aria-label')));
  check('the laptop shows votes left', txt(P2,'votesLeft')==='3 of 3 votes left');
  check('the console lists the ballot with no tallies, and the facilitator has no vote buttons', sd.querySelectorAll('#cStage [data-bar]').length===sw.model().items.filter(i=>i.col!=='e').reduce((n,i)=>n+i.cards.length,0) && !sd.querySelector('#cStage [data-vote]') && [...sd.querySelectorAll('#cStage .bopt')].every(b=>b.children.length===1 && b.firstElementChild.classList.contains('lbl')));
  const plus = (d,id)=>click(d.window, d.window.document.querySelector('[data-vote="+"][data-t="'+id+'"]'));
  plus(P2,'p1x3'); await sleep(5); plus(P2,'p1x3');
  await until(()=>row(CODE,'vote/p2') && row(CODE,'vote/p2').p1x3===2);
  check('votes stack on one item', row(CODE,'vote/p2').p1x3===2 && txt(P2,'votesLeft')==='1 of 3 votes left' && bd.querySelectorAll('[data-bar="p1x3"] .dots i').length===2 && bd.querySelector('[data-bar="p1x3"]').classList.contains('voted'));
  plus(P2,'p3x1'); await until(()=>row(CODE,'vote/p2').p3x1===1);
  check('+ is off once the votes are spent', bd.querySelector('[data-vote="+"][data-t="fx1"]').disabled);
  bw.castVote('p2','fx1',1); await sleep(80);
  check('the cap holds even if + is pressed anyway', !row(CODE,'vote/p2').fx1);
  click(bw, bd.querySelector('[data-vote="-"][data-t="p3x1"]'));
  await until(()=>!row(CODE,'vote/p2').p3x1);
  check('minus takes a vote back', !row(CODE,'vote/p2').p3x1 && txt(P2,'votesLeft')==='1 of 3 votes left');
  plus(P2,'p3x1');
  await until(()=>row(CODE,'vote/p2').p3x1===1); await sleep(120);
  const keepB = bd.querySelector('[data-bar="p1x3"]');
  plus(A,'p1x3'); await sleep(5); plus(A,'p1x3'); await sleep(5); plus(A,'fx1');
  plus(P3,'p3x1'); await sleep(5); plus(P3,'p3x1');
  await until(()=>row(CODE,'vote/p1') && Object.values(row(CODE,'vote/p1')).reduce((a,b)=>a+b,0)===3 && row(CODE,'vote/p3') && row(CODE,'vote/p3').p3x1===2 && row(CODE,'vote/p2').p3x1===1);
  await sleep(200);
  check('other people\'s votes never redraw a laptop\'s ballot', bd.querySelector('[data-bar="p1x3"]')===keepB);
  const pips = () => [...sd.querySelectorAll('#cStage .cast .who')].map(w=>w.querySelectorAll('.pips i.on').length).join();
  await until(()=>pips()==='3,3,2,0');
  check('the console shows who has voted, as pips, never what for', pips()==='3,3,2,0' && sd.getElementById('chipMore').textContent==='3');
  await until(()=>sd.getElementById('chip').classList.contains('warm'));
  check('when everyone here has voted, the chip warms up', sd.getElementById('chip').classList.contains('warm'));
  /* going back: an item moved to essential gives its votes back */
  click(sw, sd.getElementById('cBack'));
  await until(()=>row(CODE,'ctl').phase==='sort');
  check('Back from the vote lands on talking it through', row(CODE,'ctl').step==='discuss');
  sw.classify('fx1','e');
  await until(()=>row(CODE,'meta/fx1').c==='e');
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='vote' && ad.getElementById('votesLeft'));
  await until(()=>txt(A,'votesLeft')==='1 of 3 votes left');
  check('going back keeps votes cast, and gives back votes on items no longer aspirational', row(CODE,'vote/p1').p1x3===2 && txt(A,'votesLeft')==='1 of 3 votes left' && !sd.querySelector('[data-bar="fx1"]'));
  /* time runs out: voting locks and the room moves to the reveal */
  tc = row(CODE,'ctl'); tc.timer = { phase:'vote', dur:180000, left:200, running:true, endsAt:Date.now()+200 };
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>row(CODE,'ctl').phase==='results', 3000);
  check('at zero the vote closes and the console moves to the results, on standby', row(CODE,'ctl').phase==='results' && row(CODE,'ctl').rv==='standby');

  /* ---------- the reveal ---------- */
  await until(()=>on(st,'reveal') && sd.getElementById('rvBegin'));
  check('the console opens the reveal on standby, and nothing shows behind it', /Enough suspense\./.test(txt(st,'rvSlide')) && sw.EPKit.tool.screen()==='console-standby' && /reveal is paused/.test(stageText(st)));
  await until(()=>/Votes are in\./.test(bodyText(A)));
  check('laptops hold until the reveal', /Now we wait for the big reveal!/.test(bodyText(A)) && aw.EPKit.tool.screen()==='laptop-hold' && !bd.querySelector('.podium'));
  click(sw, sd.getElementById('rvBegin'));
  await until(()=>row(CODE,'ctl').rv===1 && /What has to be true/.test(txt(st,'rvSlide')));
  check('first the essentials, one stone each, sealed', sd.querySelectorAll('#rvSlide .stone').length===3 && sd.querySelectorAll('#rvSlide .stone .seal').length===3 && /Leadership/.test(txt(st,'rvSlide')) && /A sponsor who shows up/.test(txt(st,'rvSlide')) && /Systems ready/.test(txt(st,'rvSlide')) && /Three things this initiative can't do without\./.test(txt(st,'rvSlide')) && sw.EPKit.tool.screen()==='console-essentials');
  await until(()=>/Leadership/.test(bodyText(A)));
  check('laptops follow the reveal, with the same stones', aw.EPKit.tool.screen()==='laptop-essentials' && ad.querySelectorAll('#pBoard .stone').length===3);
  key(sw, sd.body, 'ArrowRight');
  await until(()=>row(CODE,'ctl').rv===2 && sd.querySelector('#rvSlide .podium'));
  const R = sw.ranking();
  check('then the podium, by the arrow key: Olympic ranking, 4 votes gold, 3 silver', R[0].id==='p1x3' && R[0].tally===4 && R[0].medal==='gold' && R[1].id==='p3x1' && R[1].tally===3 && R[1].medal==='silver' && /Training first/.test(sd.querySelector('#rvSlide .pstep.gold').textContent) && /Front-line voices in the design/.test(sd.querySelector('#rvSlide .pstep.silver').textContent) && sw.EPKit.tool.screen()==='console-podium');
  check('an empty step stays empty, and steps back', sd.querySelector('#rvSlide .pstep.bronze').classList.contains('vacant'));
  check('a build that wins says what it builds on', /Builds on/.test(sd.querySelectorAll('#rvSlide .rank li')[1].textContent) && /Training first/.test(sd.querySelectorAll('#rvSlide .rank li')[1].querySelector('.ctx').textContent));
  await until(()=>bd.querySelector('#pBoard .podium') && aw.EPKit.tool.screen()==='laptop-podium');
  check('laptops get the podium too', aw.EPKit.tool.screen()==='laptop-podium' && /Training first/.test(bd.querySelector('#pBoard .pstep.gold').textContent), aw.EPKit.tool.screen()+' / '+(bd.querySelector('#pBoard .pstep.gold')||{}).textContent);
  check('each laptop sees where its own votes went', /All three of your votes are on the podium\./.test(bd.querySelector('#pBoard .mypod').textContent) && bd.querySelectorAll('#pBoard .rank li .yours').length===2);
  click(sw, sd.getElementById('rvNext'));
  await until(()=>row(CODE,'ctl').rv==='done' && !on(st,'reveal'));
  check('Done closes the reveal onto the results', !on(st,'reveal') && !!sd.querySelector('#cStage .podium') && sw.EPKit.tool.screen()==='console-results');
  check('medal winners are labelled, essentials sit on the left', /We will drive toward these/.test(stageText(st)) && sd.querySelectorAll('#cStage .rank li.won').length===2 && /Leadership/.test(sd.querySelector('#cStage .ess').textContent));
  check('before Finalize: Re-open voting and Finalize results', !!sd.getElementById('cBack') && sd.getElementById('cNext').getAttribute('data-c')==='finalize');
  click(sw, sd.querySelector('[data-c="replay"]'));
  await until(()=>on(st,'reveal') && row(CODE,'ctl').rv==='standby');
  check('Play the reveal again goes back to standby', on(st,'reveal') && /Enough suspense/.test(txt(st,'rvSlide')));
  key(sw, sd.body, 'Escape');
  check('Escape leaves the reveal', !on(st,'reveal'));
  await until(()=>sd.querySelector('[data-c="contreveal"]'));
  click(sw, sd.querySelector('[data-c="contreveal"]'));
  click(sw, sd.getElementById('rvBegin')); await until(()=>row(CODE,'ctl').rv===1);
  click(sw, sd.getElementById('rvNext')); await until(()=>row(CODE,'ctl').rv===2);
  click(sw, sd.getElementById('rvNext')); await until(()=>row(CODE,'ctl').rv==='done');
  await until(()=>/finalize/.test(bodyText(P2)) && bd.querySelector('#pBoard .rank'));
  check('laptops see the results, with download waiting for Finalize', !bd.querySelector('[data-a="download"]') && /finalize/.test(bodyText(P2)) && bw.EPKit.tool.screen()==='laptop-results');
  check('download refuses before Finalize', sw.downloadReport()===false);

  /* ---------- Finalize, report, email ---------- */
  await until(()=>sd.querySelector('[data-c="finalize"]'));
  click(sw, sd.querySelector('[data-c="finalize"]'));
  await until(()=>row(CODE,'ctl').final===true && sd.querySelector('[data-c="download"]'));
  check('Finalize freezes the results: no Re-open voting, and the controls become End, Replay and Download', row(CODE,'ctl').final===true && !sd.getElementById('cBack') && [...sd.querySelectorAll('#cCtl button')].map(b=>b.textContent).join('|')==='End session|Play the reveal again|Download report' && sw.EPKit.tool.screen()==='console-final');
  const name = sw.downloadReport();
  check('the report file name', /^success-factors-northwind-relaunch-\d{4}-\d{2}-\d{2}\.html$/.test(name) && sw.clickedDownload===name);
  const rep = sw.reportHtml(true);
  check('the report: initiative, question, facilitator, people, level', /<h1>Northwind relaunch<\/h1>/.test(rep) && /relaunch to land/.test(rep) && /Facilitated by Pat/.test(rep) && /Ana/.test(rep) && /Dee/.test(rep) && /Level reached: Bell Ringers/.test(rep));
  check('the report: essentials by group and card', /<h3>Leadership<\/h3>/.test(rep) && /<h3>Systems ready before launch<\/h3>/.test(rep) && rep.indexOf('Essential success factors') < rep.indexOf('Aspirational goals'));
  check('the report: ranked aspirations with tallies and medals, builds with what they build on', /We will drive toward these/.test(rep) && /class="m gold">1</.test(rep) && /class="m silver">2</.test(rep) && /Front-line voices in the design <span class="d">builds on: &lt;img/.test(rep));
  check('the report appendix: other aspirations, original wording, earlier questions', /Appendix/.test(rep) && /no votes/.test(rep) && /Front-line voices <span class="d">now: Front-line voices in the design/.test(rep) && /This Northwind relaunch will be successful if\u2026<\/li>/.test(rep));
  check('the appendix can be left out', !/Appendix/.test(sw.reportHtml(false)));
  check('the report escapes what people typed and prints cleanly', !/<img src=x/.test(rep) && /&lt;img src=x/.test(rep) && /@media print/.test(rep) && /noindex/.test(rep));
  await until(()=>bd.querySelector('[data-a="download"]'));
  click(bw, bd.querySelector('[data-a="download"]'));
  check('every laptop can download after Finalize', bw.App.lastDownload===name && !!bw.lastBlob && bw.EPKit.tool.screen()==='laptop-final');
  sw.EPKit.email = function(o){ sw.emailed = o; return Promise.resolve({}); };
  type(sw, sd.getElementById('mailTo'), 'a@example.com, b@example.com');
  click(sw, sd.querySelector('[data-a="email"]'));
  const em = sw.emailed;
  check('Email report calls the send kit with the subject, body and file', em && em.subject==='Success factors: Northwind relaunch' && em.to.join()==='a@example.com,b@example.com' && /We will drive toward these:/.test(em.body) && /Leadership:/.test(em.body) && em.files()[0].name===name);
  /* a reload, two console tabs, presence */
  const A2 = load(joinLink, { seed:{ ['sf-seat-'+CODE]:'p1' } });
  await until(()=>A2.window.document.querySelector('#pBoard .rank'));
  check('a reload resumes the same seat and mascot', A2.window.App.seat==='p1' && !A2.window.document.getElementById('jName') && txt(A2,'pMe')==='Ana');
  const st2 = load(sw.hostLink());
  await until(()=>on(st2,'console') && st2.window.document.querySelector('#cStage .podium'));
  check('a second console tab opens on the same session', st2.window.App.S.ctl.final===true && !!st2.window.document.querySelector('[data-c="download"]'));
  sw.App.times.p3 = Date.now() - 31000 - sw.App.offset;
  check('a seat that stops beating for 30 seconds counts as away', sw.present('p3')===false && sw.present('p1')===true);
  st2.window.stopLoops(); A2.window.stopLoops();

  /* ---------- End session: a few seconds to undo, then clear ---------- */
  click(sw, sd.getElementById('cEnd'));
  check('End session gives a few seconds to undo', sw.App.ending===true && /Ending the session in a few seconds/.test(txt(st,'cCtl')) && !!sd.getElementById('cUndoEnd'));
  click(sw, sd.getElementById('cUndoEnd'));
  await sleep(450);
  check('Undo keeps the session', sw.App.ending===false && rows(CODE)>0 && on(st,'console') && !!sd.getElementById('cEnd'));
  const J = load(joinLink); await until(()=>J.window.document.getElementById('jName'));
  click(sw, sd.getElementById('cEnd'));
  await until(()=>rows(CODE)===0, 3000);
  check('then it clears the session from the worker', rows(CODE)===0);
  await until(()=>on(st,'gate'));
  check('the console says so, with what the room made and everyone who was in it', on(st,'gate') && txt(st,'gHead')==='Session ended and cleared.' && sw.EPKit.tool.screen()==='ended' && [...sd.querySelectorAll('#gExtra .etile b')].map(b=>b.textContent).join()==='4,23,3,'+sw.ranking().filter(x=>x.top).length && sd.querySelectorAll('#gExtra .roomrow .rm').length===4);
  await until(()=>on(P2,'gate') && on(J,'gate'));
  const p2nick = bw.App.S.pax.p2.nick;
  check('people in the session get their own wrap-up', txt(P2,'gHead')==='Thanks, '+p2nick+'!' && bw.EPKit.tool.screen()==='laptop-ended' && !!bd.querySelector('#gTop .endav svg') && [...bd.querySelectorAll('#gExtra .etile')].map(t=>t.textContent).join('|')==='1idea|1build|3votes' && /One of your ideas is an essential\./.test(txt(P2,'gExtra')) && bd.querySelectorAll('#gExtra .roomrow .rm').length===4);
  click(bw, bd.querySelector('[data-a="enddl"]'));
  check('and can still download the report after the session is gone', bw.App.lastDownload===name);
  check('a laptop that never joined is told the session isn\'t running', txt(J,'gHead')==="This session isn't running." && J.window.EPKit.tool.screen()==='gate');
  doms.forEach(d=>{ try{ d.window.stopLoops(); }catch(e){} });

  /* ---------- a full room: 20 seats, the 21st refused, limits ---------- */
  {
  const FULL='FULLRM', FK='FULLKEYFULLKEY12';
  await call('POST','/api/create',{ tool:'sf', code:FULL, sk:FK }, null);
  await call('POST','/api/set',{ tool:'sf', code:FULL, path:'ctl', value:{ phase:'lobby', round:1, q:'Q', initiative:'Full', set:{votes:5,topN:10,goal:100,t:{ideate:5,share:15,vote:3}}, timer:{phase:'lobby',dur:0,left:0,running:false,endsAt:null}, allIn:false } }, FK);
  for (let i=1;i<=20;i++) await call('POST','/api/claim',{ tool:'sf', code:FULL, path:'pax/p'+i, value:{ nick:'Person '+i } }, FK);
  const L21 = await joinLaptop(HOSTED+'#c='+FULL+'&k='+FK+'&r=pax', 'Late', 'm05');
  await until(()=>/room is full/.test(L21.window.document.getElementById('jErr').textContent));
  check('the 21st person gets a friendly message, and no seat', /room is full/.test(L21.window.document.getElementById('jErr').textContent) && !L21.window.App.seat);
  r = await call('POST','/api/claim',{ tool:'sf', code:FULL, path:'pax/p21', value:{ nick:'x' } }, FK);
  check('seat 21 does not exist on the worker', r.status===400);
  L21.window.stopLoops();
  const long = n => 'x'.repeat(n);
  let maxLen = 0;
  for (let i=1;i<=20;i++){
    await call('POST','/api/set',{ tool:'sf', code:FULL, path:'who/p'+i, value:{ m:'m'+String(i).padStart(2,'0'), at:Date.now() } }, FK);
    await call('POST','/api/set',{ tool:'sf', code:FULL, path:'here/p'+i, value:1 }, FK);
    const vrow = {}; for (let k=1;k<=15;k++) vrow['p'+i+'x'+k]=1;
    const vr = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'vote/p'+i, value:vrow }, FK); maxLen=Math.max(maxLen, JSON.stringify(vrow).length);
    for (let k=1;k<=15;k++){
      const iv = { t:long(200), ph:'b', par:'p'+(i%20+1)+'x'+k, at:Date.now(), sh:Date.now(), r:1 }, mv = { t:long(200), d:long(600), g:'g'+k, c:'e', mg:'p20x15', h:[long(200),long(200),long(200),long(200),long(200)], x:1 };
      const a1 = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'idea/p'+i+'x'+k, value:iv }, FK);
      const a2 = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'meta/p'+i+'x'+k, value:mv }, FK);
      maxLen = Math.max(maxLen, JSON.stringify(iv).length, JSON.stringify(mv).length);
      if (a1.status!==200 || a2.status!==200 || vr.status!==200) { maxLen = 99999; }
    }
  }
  for (let g=1; g<=30; g++) await call('POST','/api/set',{ tool:'sf', code:FULL, path:'grp/g'+g, value:{ t:long(40), c:'e', o:g } }, FK);
  for (let q=1; q<=10; q++) await call('POST','/api/set',{ tool:'sf', code:FULL, path:'qh/'+q, value:{ q:long(200), at:Date.now() } }, FK);
  check('20 seats and 300 ideas at full length: every value is under 4,000 characters and accepted', maxLen < 4000);
  check('and the session stays far under 6,000 rows', rows(FULL) < 800);
  r = await call('GET','/api/state?tool=sf&code='+FULL+'&times=here', null, FK);
  check('one full read stays a reasonable size', JSON.stringify(r.data).length < 1500000 && r.status===200);
  }

  /* ---------- the rules, directly ---------- */
  const T = load(HOSTED); const tw = T.window;
  const rk = (tallies, topN) => tw.rankItems(tallies.map((n,i)=>({ id:'i'+i, tally:n, o:i })), topN||10);
  const show = l => l.map(x=>x.rank).join('-');
  check('ranks 1-1-3: two golds mean no silver', show(rk([5,5,2]))==='1-1-3' && rk([5,5,2])[2].medal==='bronze');
  check('ranks 1-2-2: two silvers', show(rk([5,3,3]))==='1-2-2' && rk([5,3,3]).filter(x=>x.medal==='silver').length===2);
  check('ranks 1-1-1: three golds', show(rk([2,2,2]))==='1-1-1' && rk([2,2,2]).every(x=>x.medal==='gold'));
  check('rank 4 or lower gets no medal', rk([9,8,7,6])[3].medal===null);
  check('a tie at the cutoff shows every tied item', rk([9,8,7,6,5,4,3,2,1,1,1], 10).filter(x=>x.top).length===11);
  check('zero-vote items are never ranked', rk([3,0,0]).length===1);
  let ok = true;
  for (let n=0;n<2000;n++){
    const len = 1+Math.floor(Math.random()*14), arr = Array.from({length:len}, ()=>Math.floor(Math.random()*6)), topN = 1+Math.floor(Math.random()*12);
    const out = rk(arr, topN), sorted = arr.filter(x=>x>0).sort((a,b)=>b-a);
    if (out.length !== sorted.length) { ok=false; break; }
    for (const x of out){
      const exp = 1 + sorted.filter(y=>y>x.tally).length;
      const medal = exp===1?'gold':exp===2?'silver':exp===3?'bronze':null;
      if (x.rank!==exp || x.medal!==medal || x.top!==(exp<=topN)) { ok=false; break; }
    }
    for (let i=1;i<out.length;i++) if (out[i].tally>out[i-1].tally) ok=false;
    if (!ok) break;
  }
  check('2,000 random tallies rank exactly as the rule says', ok);
  check('the meter: marks at a quarter, half and three quarters of the goal, and the bell at the goal', [0,24,25,49,50,74,75,99,100,140].map(n=>tw.levelFor(n,100)).join('')==='0011223344' && [4,5,10,15,19,20].map(n=>tw.levelFor(n,20)).join('')==='012334');
  tw.App.S = { ctl:{ lvl:3, set:{ goal:100 } }, idea:{ p1x1:{ t:'a' } } };
  check('a level once reached never drops', tw.shownLevel(tw.model())===3);
  check('the prompt fills in from the initiative, and keeps a name\'s own article', tw.defaultQ('Northwind relaunch')==='This Northwind relaunch will be successful if\u2026' && tw.defaultQ('  ')==='This initiative will be successful if\u2026' && tw.defaultQ('our   new CRM')==='Our new CRM will be successful if\u2026');
  const ms = { ctl:{ phase:'share', set:{} }, idea:{ p1x1:{ t:'private' }, p1x2:{ t:'shared', sh:1 }, p2x1:{ t:'a build', par:'p1x2', sh:2 }, fx1:{ t:'facilitator card' } }, meta:{ p1x2:{ g:'g1' } }, grp:{ g1:{ t:'G' } } };
  let M0 = tw.model(ms);
  check('while sharing, only shared ideas, builds and the facilitator\'s cards are on the board', !M0.I.p1x1 && !!M0.I.p1x2 && !!M0.I.p2x1 && !!M0.I.fx1 && M0.count===4 && M0.shared===3);
  check('a build sits in its parent\'s group, one step down its chain', M0.I.p2x1.g==='g1' && M0.groups[0].cards.length===2 && M0.I.p2x1.up==='p1x2' && M0.I.p2x1.depth===1);
  ms.ctl.phase = 'sort'; M0 = tw.model(ms);
  check('past sharing, every idea is on the board', !!M0.I.p1x1 && M0.shared===4);
  check('with no marks, everything starts aspirational', M0.items.length===3 && M0.items.every(i=>i.col==='a') && M0.markers===0);
  const mk = { ctl:{ phase:'sort', set:{} }, idea:{ p1x1:{ t:'x', sh:1 }, p1x2:{ t:'y', sh:1 }, p1x3:{ t:'z', sh:1 }, p1x4:{ t:'w', sh:1 } }, meta:{ p1x4:{ c:'a' } }, mark:{ p1:{ p1x1:1, p1x4:1 }, p2:{ p1x1:1, p1x2:1, p1x4:1 }, p3:{ p1x1:1, p1x4:1, _d:1 } } };
  const cols = S => tw.model(S).items.map(i=>i.id+':'+i.col).join();
  check('marks decide: everyone, essential; some, to talk about; nobody, aspirational; the facilitator\'s placement beats them', cols(mk)==='p1x1:e,p1x2:d,p1x3:a,p1x4:a');
  mk.mark.p4 = { _d:1 };
  check('someone who marked nothing still counts, so nothing is unanimous without them', cols(mk)==='p1x1:d,p1x2:d,p1x3:a,p1x4:a');
  const bv = { ctl:{ phase:'vote', set:{ votes:5 } }, idea:{ p1x1:{ t:'a', sh:1 }, p1x2:{ t:'a build', sh:1, par:'p1x1' }, p2x1:{ t:'b', sh:1 }, p3x1:{ t:'c', sh:1 } }, meta:{ p1x1:{ g:'g1' }, p3x1:{ c:'e' } }, grp:{ g1:{ t:'Named' } }, vote:{ p1:{ p1x1:9 }, p2:{ p1x1:2, g1:3, p3x1:2, p1x2:2 } } };
  const Mv = tw.model(bv), TV = tw.tallies(Mv, bv);
  check('votes go on cards: above the cap, on a group, or on something essential, they don\'t count', TV.tal.p1x1===7 && TV.tal.p1x2===2 && TV.used.p1===5 && TV.used.p2===4 && !TV.tal.g1 && !TV.tal.p3x1);
  const Rv = tw.ranking(Mv, TV);
  check('a build wins on its own, and knows what it builds on', Rv.length===2 && Rv[1].id==='p1x2' && Rv[1].on.id==='p1x1' && Rv[0].medal==='gold' && Rv[1].medal==='silver');
  const tie = { ctl:{ phase:'vote', set:{ votes:5, topN:10 } }, idea:{}, vote:{ p1:{} } };
  ['p1x1','p1x2','p1x3','p1x4'].forEach(id=>{ tie.idea[id] = { t:'Tied '+id, sh:1 }; tie.vote.p1[id] = 1; });
  tw.App.S = tie; const Mt = tw.model(tie), ph = tw.podiumHtml(Mt, tw.tallies(Mt, tie));
  check('a four-way tie says so plainly and points to the list; empty steps step back', /Four-way tie/.test(ph) && /All four are in the list below\./.test(ph) && !/more</.test(ph) && (ph.match(/pstep (silver|bronze) vacant/g)||[]).length===2 && !/Tied p1x/.test(ph));
  tie.vote.p1 = { p1x1:2, p1x2:2 }; const ph2 = tw.podiumHtml(tw.model(tie), tw.tallies(tw.model(tie), tie));
  check('a two-way tie names both', /class="tie">Tie</.test(ph2) && (ph2.match(/Tied p1x/g)||[]).length===2);
  T.window.close();

  /* ---------- the test drive: six practice people, a participant view, no network ---------- */
  {
  const TD = load(HOSTED, { live:false }); const dw = TD.window, dd = dw.document;
  await until(()=>on(TD,'studio'));
  click(dw, dd.getElementById('stBuild')); dw.goStep(4);
  click(dw, dd.getElementById('stDrive'));
  await until(()=>on(TD,'console'));
  dw.App.pollMs = 40; dw.startLoops();
  check('a test drive runs without an initiative, as a practice run', dw.C().initiative==='Practice run' && !hidden(TD,'simBar') && /No link in a test drive/.test(stageText(TD)));
  await until(()=>dw.seats().length===6, 3000);
  check('six practice people join on their own', dw.seats().length===6 && dw.seats().every(s=>s.m));
  click(dw, dd.getElementById('cNext'));
  await until(()=>Object.keys(dw.App.S.idea||{}).length>=24, 6000);
  check('they add ideas, and keep them private', Object.keys(dw.App.S.idea).length>=24 && dw.model().shared===0);
  dw.goPhase('share');
  await until(()=>{ const M=dw.model(); return M.shared>=8 && Object.values(dw.App.S.idea).some(x=>x && x.par); }, 6000);
  check('they share and build while sharing', dw.model().shared>=8 && Object.values(dw.App.S.idea).some(x=>x && x.par && x.sh));
  dw.goPhase('sort');
  check('sorting starts with marking in the test drive too', dw.C().step==='mark' && dw.model().items.every(i=>i.col==='a'));
  await until(()=>dw.model().markers>=6, 6000);
  check('the practice people mark what has to be true', dw.model().markers>=6);
  dw.next();
  check('talking it through sorts by their marks', dw.C().step==='discuss' && dw.model().items.some(i=>i.col!=='a'));
  dw.goPhase('vote');
  await until(()=>Object.values(dw.tallies(dw.model()).used).filter(n=>n===5).length>=6, 8000);
  check('they spend their votes', Object.values(dw.tallies(dw.model()).used).filter(n=>n===5).length>=6);
  click(dw, dd.getElementById('segPax'));
  await until(()=>on(TD,'laptop') && dd.getElementById('jName'));
  check('the participant view opens the join screen, inside the same practice room', on(TD,'laptop') && !hidden(TD,'simBar2') && dw.EPKit.tool.screen()==='laptop-join');
  type(dw, dd.getElementById('jName'), 'Zed'); click(dw, dd.querySelector('#jPick .mpick:not([disabled])')); click(dw, dd.getElementById('jGo'));
  await until(()=>dw.App.simSeat && dd.getElementById('votesLeft'));
  check('you join as one more person and land on the vote', dw.App.simSeat==='p7' && txt(TD,'votesLeft')==='5 of 5 votes left');
  click(dw, dd.querySelector('[data-vote="+"]'));
  await until(()=>txt(TD,'votesLeft')==='4 of 5 votes left');
  check('and vote like anyone else', (dw.tallies(dw.model()).used.p7||0)===1);
  click(dw, dd.getElementById('segCon2'));
  await until(()=>on(TD,'console'));
  check('switching back shows the console with you in the room', on(TD,'console') && dw.seats().length===7 && dw.App.role==='host');
  click(dw, dd.getElementById('cNext'));
  await until(()=>on(TD,'reveal'));
  click(dw, dd.getElementById('rvBegin')); click(dw, dd.getElementById('rvNext')); click(dw, dd.getElementById('rvNext'));
  await until(()=>dd.querySelector('[data-c="finalize"]'));
  click(dw, dd.querySelector('[data-c="finalize"]'));
  await until(()=>dd.getElementById('cEnd'));
  check('the end button says it ends the test drive', txt(TD,'cEnd')==='End test drive');
  click(dw, dd.getElementById('simExit'));
  check('Exit test drive goes back to the review step', on(TD,'studio') && dd.getElementById('st4').classList.contains('on') && dw.App.sim===false);
  check('a test drive makes no network calls', fetchesInDrive===0);
  dw.Bots.stop(); dw.stopLoops();
  }

  /* ---------- the feedback kit: the hook, links in feedback mode, and every screen rebuilt as the board does ---------- */
  {
  const FH = load(HOSTED + '?feedback=tst42'); const fw = FH.window, fd = fw.document;
  await until(()=>on(FH,'studio'));
  const FT = fw.EPKit && fw.EPKit.tool;
  check('feedback hook: its own id and name, never the folder default', !!FT && FT.id==='success-factors' && FT.name==='Success Factors');
  check('feedback hook: the studio names each step', FT.screen()==='studio-start' && FT.state().role==='studio' && FT.state().step==='start');
  const fsecs = FT.sections(), fall = fsecs.reduce((a,s)=>a.concat(s.screens),[]);
  check('feedback hook: parts in session order, console and laptop screens together by phase', fsecs.map(s=>s.name).join('|')==='Set up|Lobby|Ideas|Share and build|Sort|Vote|Pause screens|Reveal|Results|End');
  check('feedback hook: every screen sits in exactly one part', fall.length===33 && new Set(fall).size===33);
  check('privacy: typed setup, the initiative, the question, names, the join link and email addresses are never named in a comment',
    ['stInit','stQ','stFac','cIni','cQ','cQedit','pMe','pAv'].every(id=>fd.getElementById(id).hasAttribute('data-feedback-private')) && /id="mailTo"[^>]*data-feedback-private/.test(html) && /class="crowd" data-feedback-private/.test(html) && /class="linkbox" data-feedback-private/.test(html) && /id="jInit" data-feedback-private/.test(html) && /r\[0\] === "Initiative" \|\| r\[0\] === "Prompt" \|\| r\[0\] === "Your name" \? " data-feedback-private"/.test(html) && /id="pBuild" class="box" maxlength="' \+ IDEA_MAX \+ '" placeholder="Yes, and\.\.\." data-feedback-private/.test(html) && /class="roomrow" aria-label="Who was in the room" data-feedback-private/.test(html) && /\$\("gHead"\)\.setAttribute\("data-feedback-private", ""\)/.test(html));
  check('stable names: key buttons carry data-act, main regions data-id',
    ['download','copyjoin','email','send','share','buildon','addcard','bigqr','sendbuild','unbuild','done'].every(a=>html.includes('data-act="'+a+'"')) && ['podium','columns','essential','discuss','aspirational','board','vote','votes-cast','join-qr','meter','essentials','aspirations','send','your-ideas','shared-board','build-box','marking'].every(a=>html.includes('data-id="'+a+'"')));
  click(fw, fd.getElementById('stBuild'));
  type(fw, fd.getElementById('stInit'), 'Feedback round');
  const names = [FT.screen()];
  for (const n of [2,3,4]) { click(fw, fd.querySelector('[data-next="'+n+'"]')); names.push(FT.screen()); }
  check('feedback hook: walking the steps names each screen', names.join()==='studio-question,studio-votes,studio-timing,studio-review');
  click(fw, fd.getElementById('stGo'));
  await until(()=>on(FH,'console') && fd.querySelector('#cStage .qr svg'));
  const FC = fw.App.code, FK = fw.App.key, fjl = fw.joinLink();
  check('feedback mode: the join link carries the tester code before the #', fjl===HOSTED+'?feedback=TST42#c='+FC+'&k='+FK+'&r=pax');
  check('feedback mode: the lobby QR decodes to that link', qrOf(fd.querySelector('#cStage .qr'))===fjl);
  click(fw, fd.querySelector('[data-a="copyjoin"]')); click(fw, fd.querySelector('[data-c="copyhost"]'));
  check('feedback mode: both copied links carry it', fw.copied[0]===fjl && fw.copied[1]===HOSTED+'?feedback=TST42#c='+FC+'&k='+FK+'&r=host');
  check('feedback mode: the address keeps the code after the session starts', /^\?feedback=tst42$/i.test(fw.location.search) && fw.location.hash==='#c='+FC+'&k='+FK+'&r=host');
  fw.EPKit.feedback = { on:false };
  check('feedback turned off in the tab: links go back to normal', fw.joinLink()===HOSTED+'#c='+FC+'&k='+FK+'&r=pax');
  fw.EPKit.feedback = { on:true, code:'ABC12' };
  check('the kit\'s own record of the code wins over the address', fw.joinLink()===HOSTED+'?feedback=ABC12#c='+FC+'&k='+FK+'&r=pax');
  delete fw.EPKit.feedback;
  const FL = load(fjl);
  await until(()=>FL.window.document.getElementById('jName'));
  check('a tester who joins from that link lands on the join screen, still in feedback mode', FL.window.EPKit.tool.screen()==='laptop-join' && /feedback=TST42/.test(FL.window.location.search));
  const fst = JSON.stringify(fw.EPKit.tool.state());
  check('state: settings only, never the question, the initiative, the code or the key', /"role":"console"/.test(fst) && /"phase":"lobby"/.test(fst) && /"goal":100/.test(fst) && !/Feedback round|has to be true/.test(fst) && !fst.includes(FC) && !fst.includes(FK));
  fw.stopLoops(); FL.window.stopLoops();

  /* the board's frame: no storage, no network, no #hash */
  let sbFetches = 0; const sbErrs = [];
  const SB = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:HOSTED, beforeParse(w){
    for (const k of ['localStorage','sessionStorage']) Object.defineProperty(w, k, { configurable:true, get(){ throw new w.DOMException('blocked', 'SecurityError'); } });
    w.fetch = () => { sbFetches++; return Promise.reject(new Error('offline')); };
    w.HTMLCanvasElement.prototype.getContext = () => null;
    w.scrollTo = () => {}; w.addEventListener('error', e => sbErrs.push(String(e.message)));
  } });
  doms.push(SB);
  const sw2 = SB.window, sd2 = sw2.document, ST = sw2.EPKit.tool;
  await sleep(50);
  const vis = id => { const e = sd2.getElementById(id); return !!e && e.classList.contains('on'); };
  const n = sel => sd2.querySelectorAll(sel).length;
  const T2 = sel => (sd2.querySelector(sel)||{}).textContent || '';
  const studioOn = k => vis('studio') && sd2.getElementById('st'+k).classList.contains('on');
  const painted = {
    'studio-start': () => studioOn(0),
    'studio-question': () => studioOn(1) && sd2.getElementById('stInit').value==='Service relaunch' && sd2.getElementById('stQ').value==='This Service relaunch will be successful if\u2026',
    'studio-votes': () => studioOn(2) && T2('#stVotes')==='5',
    'studio-timing': () => studioOn(3) && T2('#stTs')==='15' && T2('#stTm')==='2',
    'studio-review': () => studioOn(4) && /Service relaunch/.test(T2('#review')),
    'console-lobby': () => vis('console') && !!sd2.querySelector('#cStage .qr svg') && n('#cStage .crowd .who')===8 && T2('#chipIn')==='8',
    'laptop-join': () => vis('laptop') && !!sd2.getElementById('jName') && n('#jPick .mpick[disabled]')===8 && /Service relaunch/.test(T2('#jInit')),
    'laptop-lobby': () => vis('laptop') && T2('#pWaitName')==="You're in, Ben!",
    'console-ideate': () => T2('#ideaCount')==='11' && T2('#cDig')!=='0:00' && T2('#cStage .reading .lvl')==='Getting Somewhere' && T2('#cQ')==='This Service relaunch will be successful if\u2026',
    'laptop-ideate': () => !!sd2.getElementById('pIdea') && !sd2.getElementById('pIdea').disabled && n('#pMine li')===2,
    'console-share': () => n('#cStage .card')===12 && n('#cStage .grp')===4 && T2('#chipMore')==='12' && n('#cStage .kids .card')===3,
    'laptop-share': () => n('#pMine li[data-mine]')===3 && n('#pMine [data-p="share"]')===1 && n('#pBoard .card')===12 && !!sd2.querySelector('.pnote') && !!sd2.querySelector('.pboardp') && n('#pBoard .ytag')===2,
    'console-mark': () => T2('#markCount')==='5' && T2('#chipMore')==='5' && /3 people are done/.test(T2('#cStage')) && !/Quick wins/.test(T2('#cStage')) && T2('#cDig')!=='0:00',
    'laptop-mark': () => n('#pMarks .mopt')===9 && n('#pMarks .mopt.on')===4 && T2('#pMarkN')==='4 cards marked' && T2('#pDone')==="I'm done",
    'console-sort': () => n('#cStage .col.e .item')===1 && n('#cStage .col.d .item')===3 && n('#cStage .col.a .item')===5 && /5 of 8/.test(T2('#cStage [data-item="g2"] .mk2')),
    'laptop-sort': () => T2('.eyes h2')==='Eyes up front' && /talking through/.test(T2('.eyes p')) && !sd2.querySelector('#pBoard'),
    'console-vote': () => n('#cStage [data-bar]')===10 && n('#cStage .bopt.build')===2 && T2('#chipMore')==='5' && n('#cStage .cast .who')===8,
    'laptop-vote': () => T2('#pBody #votesLeft')==='3 of 5 votes left' && n('#pBoard [data-vote="+"]')===10 && n('#pBoard .bopt.build')===2,
    'console-paused': () => !sd2.getElementById('cPausedTag').classList.contains('hide') && T2('#cPause')==='Resume screens' && sd2.getElementById('tFace').classList.contains('paused'),
    'laptop-paused': () => T2('.eyes h2')==='Eyes up front' && /paused the screens/.test(T2('.eyes p')),
    'console-standby': () => vis('reveal') && /Enough suspense\./.test(T2('#rvSlide')) && !!sd2.getElementById('rvBegin'),
    'laptop-hold': () => /Votes are in\./.test(T2('#pBody')),
    'console-essentials': () => vis('reveal') && n('#rvSlide .stone')===3 && /Leaders who show up/.test(T2('#rvSlide')) && /Clear ownership/.test(T2('#rvSlide')) && /switched off on a set date/.test(T2('#rvSlide')) && /Three things/.test(T2('#rvSlide .stonesum')),
    'laptop-essentials': () => n('#pBoard .stone')===3 && n('#pBoard .stone .seal')===3,
    'console-podium': () => vis('reveal') && /Quick wins in the first 60 days/.test(T2('#rvSlide .pstep.gold')) && /Front-line voices/.test(T2('#rvSlide .pstep.silver')) && /Decisions in days/.test(T2('#rvSlide .pstep.bronze')) && n('#rvSlide .rank li')===9 && /Builds on/.test(T2('#rvSlide .rank')),
    'laptop-podium': () => /Quick wins in the first 60 days/.test(T2('#pBoard .pstep.gold')) && T2('#pBoard .mypod')==='You put three of your five votes on the podium.' && n('#pBoard .rank .yours')===3,
    'console-results': () => !vis('reveal') && !!sd2.querySelector('#cStage .podium') && !!sd2.querySelector('[data-c="finalize"]') && n('#cStage .ess .stone')===3,
    'laptop-results': () => !!sd2.querySelector('#pBoard .podium') && !sd2.querySelector('#pBoard [data-a="download"]'),
    'console-final': () => !!sd2.querySelector('#cCtl [data-c="download"]') && !!sd2.getElementById('mailTo') && !sd2.querySelector('[data-c="finalize"]'),
    'laptop-final': () => !!sd2.querySelector('#pBoard [data-a="download"]'),
    'ended': () => vis('gate') && T2('#gHead')==='Session ended and cleared.' && !/test drive/i.test(T2('#gMsg')) && n('#gExtra .etile')===4 && n('#gExtra .roomrow .rm')===8,
    'laptop-ended': () => vis('gate') && T2('#gHead')==='Thanks, Ben!' && n('#gExtra .etile')===3 && !!sd2.querySelector('#gExtra [data-a="enddl"]') && n('#gExtra .roomrow .rm')===8,
    'gate': () => vis('gate') && T2('#gHead')==="This session isn't running." && !sd2.querySelector('#gExtra .etile')
  };

  const bad = [];
  for (const sc of fall){ let ok = false; try { ok = ST.restore({ screen:sc, settings:{} }); } catch(e){ sbErrs.push(sc+': '+e.message); } await sleep(30); if (!(ok===true && ST.screen()===sc && painted[sc] && painted[sc]())) bad.push(sc); }
  check('the board\'s frame: restore() opens every screen, one after another, and paints it', bad.length===0 && Object.keys(painted).length===fall.length, bad.join(', '));
  check('the board\'s frame: no errors, and nothing ever reaches the network', sbErrs.length===0 && sbFetches===0, sbErrs.slice(0,3).join(' | '));
  ST.restore({ screen:'console-lobby', settings:{} });
  const liveBar = sd2.getElementById('simBar').classList.contains('hide') && !/test drive/i.test(T2('#cStage'));
  ST.restore({ screen:'console-lobby', settings:{ testDrive:true } });
  check('the board\'s frame: a rebuilt live session never shows the test-drive bar; a rebuilt test drive does', liveBar && !sd2.getElementById('simBar').classList.contains('hide') && /No link in a test drive/.test(T2('#cStage')));
  ST.restore({ screen:'laptop-ideate', settings:{ timeUp:true } }); await sleep(20);
  check('the board\'s frame: settings carry over (time up locks the laptop; 3 votes each)', sd2.getElementById('pIdea').disabled && !sd2.getElementById('pLock').classList.contains('hide') && ST.restore({ screen:'laptop-vote', settings:{ votes:3 } }) && T2('#pBody #votesLeft')==='1 of 3 votes left' && ST.restore({ screen:'laptop-mark', settings:{ timeUp:true } }) && sd2.querySelector('#pMarks .mopt').disabled);
  check('the board\'s frame: an unknown screen opens nothing', ST.restore({ screen:'console-join' })===false && ST.restore({ screen:'nope' })===false && ST.restore({})===false);
  sw2.stopLoops();
  }

  /* ---------- sound ---------- */
  const SN = load(HOSTED + '#c=ZZZZ&k=nokeynokey12&r=host', { seed:{ 'sf-sound':'on' } });
  await until(()=>SN.window.App.code==='ZZZZ');
  check('the sound choice is remembered', SN.window.Snd.on===true && !SN.window.document.getElementById('cVol').disabled);
  SN.window.Snd.set(false);
  check('turning it off is remembered too', SN.window.localStorage.getItem('sf-sound')==='off');
  SN.window.stopLoops();
  check('laptops never play music or the timer chimes', /music: function \(name, level\) \{\s*if \(App\.role !== "host"\) return;/.test(html) && /if \(App\.host\) \{\s*var t = c\.timer;/.test(html));

  check('no script errors', errors.length===0, errors.slice(0,3).join(' | '));
  doms.forEach(d=>{ try{ d.window.stopLoops(); d.window.close(); }catch(e){} });
  console.log(failures ? failures+' FAILED' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e=>{ console.error(e); process.exit(1); });
