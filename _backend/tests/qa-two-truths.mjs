/* qa-two-truths.mjs: jsdom harness for field-tools/two-truths/index.html (Two Truths and a Hallucination).
   Runs the studio, the console and several participants against the real pt worker code (fake database),
   decodes the join QR with jsQR, and checks the guess assignment and the scoring directly.
   The live session runs on the worker's own gated list (GATED_TOOLS_DEFAULT, which names two-truths), and one
   check takes the id off that list through the GATED_TOOLS variable to make sure an ungated worker starts
   nothing. Run: node _backend/tests/qa-two-truths.mjs   (needs: npm install jsdom jsqr) */
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
const html = fs.readFileSync(path.join(here, '../../field-tools/two-truths/index.html'), 'utf8');
let failures = 0;
function check(name, cond, detail){ console.log((cond?'PASS  ':'FAIL  ')+name+(!cond && detail ? '  :: '+detail : '')); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0=Date.now(); while (Date.now()-t0 < (ms||4000)){ try{ if (fn()) return true; }catch(e){} await sleep(15); } return false; }
const HOSTED = 'https://ep.github.io/pt/field-tools/two-truths/';
/* the worker's own gated list (it names this tool), and the same list without it for the ungated check */
const gatedDefault = fs.readFileSync(path.join(here, '../pt-worker.js'), 'utf8').match(/var GATED_TOOLS_DEFAULT = '([^']*)'/)[1];
const gated = gatedDefault.split(',').includes('two-truths') ? gatedDefault : gatedDefault + ',two-truths';
const env = { DB: FakeDB(), GATED_TOOLS: gated };
const ungated = { DB: FakeDB(), GATED_TOOLS: gatedDefault.split(',').filter(t => t !== 'two-truths').join(',') };
const errors = [];
let fetchesInDrive = 0;
function mockFetch(win, E){ win.fetch = async function(url, init){ init = init || {}; const req = new Request(String(url), { method:init.method||'GET', headers:Object.assign({ Origin:'https://ep.github.io' }, init.headers||{}), body:init.body }); return worker.fetch(req, E || env); }; }
const doms = [];
function load(url, opts){
  opts = opts || {};
  const d = new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){
    if (opts.seed) Object.keys(opts.seed).forEach(k=>window.localStorage.setItem(k, opts.seed[k]));
    if (opts.live !== false) mockFetch(window, opts.env); else window.fetch = async () => { fetchesInDrive++; throw new Error('no network in a test drive'); };
    window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } });
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    window.addEventListener('error', e => errors.push(String(e.message)));
  } });
  d.window.eval(fast);
  if (d.window.App.role) d.window.startLoops();
  doms.push(d); return d;
}
const fast = 'App.pollMs=40; App.hbMs=250; App.retryMs=5; App.botMs=10; App.tickMs=20; App.anim=false; App.bannerMs=40; App.endMs=300;';
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function on(d, id){ return d.window.document.getElementById(id).classList.contains('on'); }
function txt(d, id){ return d.window.document.getElementById(id).textContent; }
function row(code, p){ const r = env.DB._rows.get('two-truths:'+code+'|'+p); return r ? JSON.parse(r.value) : undefined; }
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
async function joinAs(link, name, mascot){
  const d = load(link); const w = d.window, doc = w.document;
  await until(()=>doc.getElementById('jName'));
  type(w, doc.getElementById('jName'), name);
  click(w, doc.querySelector('#jPick [data-m="'+mascot+'"]'));
  click(w, doc.getElementById('jGo'));
  return d;
}
const bodyText = d => d.window.document.getElementById('pBody').textContent;
const view = d => d.window.paxView();
async function writeThree(d, a, b, h, submit){
  const w = d.window, doc = w.document;
  await until(()=>doc.getElementById('w0'));
  type(w, doc.getElementById('w0'), a); type(w, doc.getElementById('w1'), b); type(w, doc.getElementById('w2'), h);
  if (submit !== false) click(w, doc.getElementById('pSubmit'));
}
async function guessAll(d, pickH){
  const w = d.window, doc = w.document;
  for (let i=0;i<4;i++){
    if (!/^guess:/.test(view(d))) break;
    await until(()=>doc.querySelector('#pOpts .opt'));
    const opts = [...doc.querySelectorAll('#pOpts .opt')];
    const t = opts[0].getAttribute('data-t');
    const pick = opts.find(o => (o.getAttribute('data-si')==='2') === !!pickH(t));
    click(w, pick);
    await until(()=>!w.App.holdKey);
    await sleep(30);
  }
}

(async function(){
  /* ---------- the file ---------- */
  check('noindex is set', html.includes('<meta name="robots" content="noindex, nofollow">'));
  check('no analytics', !/clarity|googletagmanager|gtag\(|hotjar/i.test(html));
  check('the shared favicon and the feedback kit load by absolute path', html.includes('/pt/assets/favicon/favicon.svg') && html.includes('<script src="/pt/assets/kit/feedback.js" defer>'));
  check('tool id two-truths, at most 12 characters, and the shared worker', /var TOOL_ID = "two-truths";/.test(html) && 'two-truths'.length <= 12 && html.includes('var WORKER_URL = "https://pt.armand-khambatta.workers.dev"'));
  check('one file, well under 400 KB', html.length < 400000);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]).filter(u=>!/^https?:\/\/(pt\.armand-khambatta\.workers\.dev|ep\.github\.io\/pt|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org)/.test(u));
  check('talks only to the worker, the fonts and its own site', urls.length===0, urls.slice(0,3).join(' '));
  check('no em dashes in anything people read', !/—/.test(html));
  check('the house look: Montserrat and Georgia on warm paper', /family=Montserrat/.test(html) && /Georgia/.test(html) && /#FBF8F3/i.test(html));
  check('mascots are animals with no names shown under them', !/"Robot"/.test(html) && !/mascotSvg\(m\[0\]\) \+ esc\(m\[1\]\)/.test(html));

  /* ---------- the guess assignment and the scoring, directly ---------- */
  const T = load(HOSTED, { live:false }); const tw = T.window;
  await until(()=>on(T,'studio'));
  let fair = true, bad = '';
  for (let m=2; m<=40; m++){
    for (let rep=0; rep<5; rep++){
      const ids = Array.from({length:m}, (_, i) => 'p'+i), a = tw.assign(ids), seen = {}, k = Math.min(3, m-1);
      if (a.k !== k) { fair=false; bad='k '+m; }
      ids.forEach(g => { const t = a.m[g]; if (t.length !== k || new Set(t).size !== k || t.includes(g)) { fair=false; bad='targets '+m; } t.forEach(x => seen[x]=(seen[x]||0)+1); });
      if (!ids.every(id => seen[id]===k)) { fair=false; bad='seen '+m; }
    }
  }
  check('every set is guessed the same number of times (3, or one less than the sets), never by its author, for rooms of 2 to 40', fair, bad);
  check('a guesser sees the same order of statements on every reload', JSON.stringify(tw.orderFor('pa','pb'))===JSON.stringify(tw.orderFor('pa','pb')) && tw.orderFor('pa','pb').slice().sort().join()==='0,1,2');
  const S = { ppl:{ a:{nick:'Ana'}, b:{nick:'Ben'}, c:{nick:'Chi'} }, st:{ a:{t:['x1','x2','xh']}, b:{t:['y1','y2','yh']}, c:{t:['z1','z2','zh']} },
    ctl:{ asg:{ id:'q', k:2, m:{ a:['b','c'], b:['c','a'], c:['a','b'] } } },
    gs:{ a:{a:'q', g:{ b:2, c:0 }}, b:{a:'q', g:{ c:1, a:1 }}, c:{a:'stale', g:{ a:2, b:2 }} } };
  const R = tw.results(S);
  /* a: spots b (+1), misses c (-1), fooled b (+1) = 1. b: misses twice (-2), fooled by nobody = -2... c's picks are stale so they don't count.
     c: fooled a and b (+2). */
  check('scoring: spot it +1, pick a truth -1, +1 for each person fooled; guesses from an old assignment do not count',
    R.R.a.score===1 && R.R.b.score===-2 && R.R.c.score===2 && R.R.c.fooled===2 && R.R.a.correct===1 && R.R.c.guessed===0, JSON.stringify(R.R));
  check('ranking puts the highest first, and the places skip nobody', R.list.map(r=>r.id).join()==='c,a,b' && R.places[0][0].id==='c' && R.places[2][0].id==='b');
  check('awards: best hallucination fooled the most, sharpest eye spotted the most', R.bestH[0].id==='c' && R.sharp[0].id==='a');
  const Tie = tw.results({ ppl:{a:{nick:'A'},b:{nick:'B'}}, ctl:{asg:{id:'t',k:1,m:{a:['b'],b:['a']}}}, gs:{ a:{a:'t',g:{b:2}}, b:{a:'t',g:{a:2}} } });
  check('a tie shares the place, and the reveal skips places nobody holds', Tie.places[0].length===2 && Tie.places[1].length===0 && tw.rvSteps(Tie).join()==='standby,p1,awards');
  /* a ring of four: Ana spots it and fools Dev (2), Ben and Chi spot it (1 each), Dev misses (-1).
     The scores call Dev 4th, so the podium has no third step. */
  const Tie2 = tw.results({ ppl:{a:{nick:'Ana'},b:{nick:'Ben'},c:{nick:'Chi'},d:{nick:'Dev'}}, ctl:{asg:{id:'u',k:1,m:{a:['b'],b:['c'],c:['d'],d:['a']}}}, gs:{ a:{a:'u',g:{b:2}}, b:{a:'u',g:{c:2}}, c:{a:'u',g:{d:2}}, d:{a:'u',g:{a:0}} } });
  check('a tie for 2nd leaves 3rd empty, matching the ranks on the scores', Tie2.places[0].length===1 && Tie2.places[1].length===2 && Tie2.places[2].length===0 && Tie2.list.find(r=>r.id==='d').rank===4 && tw.rvSteps(Tie2).join()==='standby,p2,p1,awards', JSON.stringify(Tie2.list.map(r=>[r.id,r.score,r.rank])));
  /* random rooms of 2 to 40, with ties wherever they fall: the podium, the scores and each person's breakdown agree */
  {
    const keepS = tw.App.S; let agree = true, why = '';
    for (let m=2; m<=40 && agree; m++) for (let rep=0; rep<6 && agree; rep++){
      const ids = Array.from({length:m}, (_, i) => 'q'+i), a = tw.assign(ids), nick = i => 'n'+i+'x';
      const S = { ppl:{}, st:{}, gs:{}, ctl:{ asg:a } };
      ids.forEach((id, i) => {
        S.ppl[id] = { nick:nick(i), m:tw.MASCOTS[i % tw.MASCOTS.length][0] }; S.st[id] = { t:['t1','t2','h'] };
        const g = {}; a.m[id].forEach(t => { const r = Math.random(); if (r < 0.9) g[t] = r < 0.45 ? 2 : r < 0.7 ? 0 : 1; }); S.gs[id] = { a:a.id, g };
      });
      tw.App.S = S; const Rs = tw.results(S), steps = tw.rvSteps(Rs);
      const holders = p => Rs.list.filter(r => r.rank === p);
      if (Rs.list.some(r => r.score !== r.correct - r.missed + r.fooled)) { agree = false; why = m+': a breakdown does not add up to its score'; break; }
      const box = tw.document.createElement('div'); box.innerHTML = tw.scoresHtml();
      const board = {}; box.querySelectorAll('.board2 li').forEach(li => { board[li.querySelector('.nm').textContent] = li.querySelector('.rk').textContent; });
      box.innerHTML = tw.podiumSlide(Rs, steps, 'p1');
      [['gold',1,'p1'],['silver',2,'p2'],['bronze',3,'p3']].forEach(([cls, p, st]) => {
        if (!agree) return;
        const h = holders(p), el = box.querySelector('.pstep[data-medal="'+cls+'"]'), vacant = el.classList.contains('vacant');
        if (!h.length){ if (!vacant || (p > 1 && steps.includes(st))) { agree = false; why = m+': place '+p+' is held by nobody on the scores but shows on the podium'; } return; }
        const names = el.querySelector('.pn') ? el.querySelector('.pn').textContent : '';
        if (vacant || !steps.includes(st)) { agree = false; why = m+': place '+p+' is held on the scores but empty on the podium'; return; }
        if (el.querySelector('.pp').textContent !== tw.fmtPts(h[0].score)) { agree = false; why = m+': place '+p+' shows the wrong points'; return; }
        const shown = Object.keys(board).filter(n => names.includes(n));
        if (shown.some(n => board[n] !== tw.ordinal(p)) || shown.length !== Math.min(h.length, h.length > 4 ? 3 : 4)) { agree = false; why = m+': place '+p+' on the podium is '+names+', the scores say '+h.map(r => S.ppl[r.id].nick+' '+tw.ordinal(r.rank)).join(', '); }
      });
    }
    tw.App.S = keepS;
    check('in random rooms of 2 to 40, every place on the podium matches the scores, ties included, and every breakdown adds up', agree, why);
  }
  check('the hallucination helper suggests something in the spirit of the truths, and never the same one twice in a row',
    (()=>{ const used=[]; const a=tw.suggestHallucination(['I walked across Spain','I climbed a mountain in Peru'], used), b=tw.suggestHallucination(['I walked across Spain','I climbed a mountain in Peru'], used); return a && b && a!==b && tw.THEMES.travel.h.includes(a); })());
  T.window.close();

  /* ---------- the studio ---------- */
  const st = load(HOSTED); const sw = st.window, sd = sw.document;
  await until(()=>on(st,'studio'));
  check('the studio opens on its first step', sd.getElementById('st0').classList.contains('on') && sw.EPKit.tool.screen()==='studio-start');
  click(sw, sd.getElementById('stBuild'));
  check('studio defaults: 3 minutes to write, 2 to guess', txt(st,'stTw')==='3' && txt(st,'stTg')==='2' && sw.EPKit.tool.screen()==='studio-timing');
  for (let i=0;i<12;i++) click(sw, sd.querySelector('.stepper[data-k="tw"] [data-d="1"]'));
  check('steppers hold their range', txt(st,'stTw')==='10' && sd.querySelector('.stepper[data-k="tw"] [data-d="1"]').disabled);
  for (let i=0;i<6;i++) click(sw, sd.querySelector('.stepper[data-k="tw"] [data-d="-1"]'));
  click(sw, sd.querySelector('#st1 [data-next="2"]'));
  check('the review lists the timing', /4 min/.test(txt(st,'review')) && /2 min/.test(txt(st,'review')) && sw.EPKit.tool.screen()==='studio-review');
  click(sw, sd.getElementById('stCopySetup'));
  const setupUrl = sw.copied.pop();
  const SU = load(setupUrl); await until(()=>on(SU,'studio'));
  check('a setup link reopens the same setup, at the review', /\?setup=/.test(setupUrl) && SU.window.document.getElementById('st2').classList.contains('on') && /4 min/.test(txt(SU,'review')));
  SU.window.close();

  /* ---------- a worker that doesn't gate the tool starts nothing ---------- */
  const U = load(HOSTED, { env: ungated }); await until(()=>on(U,'studio'));
  U.window.goStep(2); click(U.window, U.window.document.getElementById('stGo'));
  await until(()=>/switched on/.test(txt(U,'stErr')));
  check('no live session starts until the worker gates this tool', on(U,'studio') && /switched on/.test(txt(U,'stErr')));
  U.window.close();

  /* ---------- a live session: console and five participants ---------- */
  click(sw, sd.querySelector('.stepper[data-k="tw"] [data-d="-1"]'));
  click(sw, sd.getElementById('stGo'));
  await until(()=>on(st,'console'));
  const code = sw.App.code, key = sw.App.key;
  check('starting opens the console in the lobby, with a closed session the worker guards', on(st,'console') && /^[A-Z]{6}$/.test(code) && sw.EPKit.tool.screen()==='console-lobby');
  const r0 = await worker.fetch(new Request('https://w.test/api/state?tool=two-truths&code='+code, { headers:{ Origin:'https://ep.github.io' } }), env);
  check('the session can\'t be read without the key', r0.status===401);
  await until(()=>sd.querySelector('#cStage .qr svg'));
  const joinUrl = sw.joinLink();
  check('the lobby QR decodes to the join link, which carries the key, not the facilitator role', qrOf(sd.querySelector('#cStage .qr'))===joinUrl && /#c=[A-Z]{6}&k=[^&]+&r=pax$/.test(joinUrl));
  check('the console starts muted', sd.getElementById('cMute').classList.contains('muted'));
  check('Start writing waits for someone to join', sd.getElementById('cNext').disabled);
  const J = load(joinUrl); await until(()=>J.window.document.getElementById('jPick'));
  check('joining asks for a first name and a mascot, and the mascots carry no names on screen', !!J.window.document.getElementById('jName') && [...J.window.document.querySelectorAll('#jPick .mpick')].every(b=>b.textContent.trim()==='' && b.getAttribute('aria-label')) && J.window.document.querySelectorAll('#jPick .mpick').length===19 && J.window.EPKit.tool.screen()==='laptop-join');
  J.window.close();
  const A = await joinAs(joinUrl, 'Ana', 'm01'), B = await joinAs(joinUrl, 'Ben', 'm03'), Cc = await joinAs(joinUrl, 'Chi', 'm05'), D = await joinAs(joinUrl, 'Dev', 'm01'), E = await joinAs(joinUrl, 'Eli', 'm07');
  await until(()=>sd.querySelectorAll('#cStage .crowd .who').length===5);
  check('five people join; two can pick the same mascot', sd.querySelectorAll('#cStage .crowd .who').length===5 && view(D)==='lobby' && view(A)==='lobby');
  check('a participant sees a welcome by name in the lobby', /You're in, Ana!/.test(bodyText(A)) && A.window.EPKit.tool.screen()==='laptop-lobby');
  const chipIn = () => sd.getElementById('chipIn') && sd.getElementById('chipIn').textContent;
  await until(()=>chipIn()==='5');
  check('the chip counts who is here', chipIn()==='5');
  /* a reload keeps the seat */
  const A2 = load(joinUrl, { seed:{ ['tt-seat-'+code]: A.window.App.seat } });
  await until(()=>A2.window.paxView()==='lobby');
  check('a reload keeps a participant\'s seat', A2.window.paxView()==='lobby' && A2.window.App.seat===A.window.App.seat);
  A2.window.stopLoops(); A2.window.close();

  /* write */
  await until(()=>!sd.getElementById('cNext').disabled);
  click(sw, sd.getElementById('cNext'));
  await until(()=>view(A)==='write');
  check('Start writing starts a 3-minute clock on every screen', sw.C().phase==='write' && /^3:00|^2:5/.test(txt(st,'cDig')) && /left/.test(A.window.document.getElementById('pTm').textContent));
  check('the participant writes on one screen: three boxes and Submit, which waits for all three', !!A.window.document.getElementById('w2') && A.window.document.getElementById('pSubmit').disabled && A.window.EPKit.tool.screen()==='laptop-write');
  click(A.window, A.window.document.querySelector('[data-p="idea"][data-i="0"]'));
  check('Need an idea? gives a prompt to spark a truth', A.window.TRUTH_Q.some(q=>A.window.document.getElementById('idea0').textContent.startsWith(q)) && !A.window.document.getElementById('idea0').classList.contains('hide'));
  type(A.window, A.window.document.getElementById('w0'), 'I walked the whole Camino de Santiago');
  type(A.window, A.window.document.getElementById('w1'), 'I climbed a volcano in Chile');
  click(A.window, A.window.document.querySelector('[data-p="suggest"]'));
  await until(()=>A.window.document.getElementById('w2').value.length>5);
  check('Suggest one fills in a hallucination in the spirit of the truths, and it can be changed', A.window.THEMES.travel.h.includes(A.window.document.getElementById('w2').value) && !A.window.document.getElementById('pSubmit').disabled);
  click(A.window, A.window.document.getElementById('pSubmit'));
  await until(()=>view(A)==='wrote');
  await until(()=>!!row(code,'st/'+A.window.App.seat));
  check('Submit locks in the three and shows them back', view(A)==='wrote' && /Locked in/.test(bodyText(A)) && !!row(code,'st/'+A.window.App.seat));
  click(A.window, A.window.document.querySelector('[data-p="edit"]'));
  await until(()=>view(A)==='write');
  check('Change my answers reopens the three, filled in', A.window.document.getElementById('w0').value==='I walked the whole Camino de Santiago');
  type(A.window, A.window.document.getElementById('w1'), 'I climbed a volcano in Chile at night');
  click(A.window, A.window.document.getElementById('pSubmit'));
  await until(()=>row(code,'st/'+A.window.App.seat) && /at night/.test(row(code,'st/'+A.window.App.seat).t[1]));
  check('an update replaces the set', /at night/.test(row(code,'st/'+A.window.App.seat).t[1]));
  await writeThree(B, 'I was an extra in a zombie movie', 'I can whistle two notes at once', 'I used to juggle fire at weddings');
  await writeThree(Cc, 'I grew up on a farm with 600 sheep', 'I play the theremin', 'I speak fluent Icelandic');
  await writeThree(D, 'I ran a marathon dressed as a banana', 'I collect typewriters', 'I sang on a cereal jingle', false);
  await until(()=>sd.getElementById('chipMore') && sd.getElementById('chipMore').textContent==='3');
  check('the console counts who has written, and lights their mascots', sd.getElementById('chipMore').textContent==='3' && sd.querySelectorAll('#cStage .who.lit').length===3);
  /* pause */
  click(sw, sd.getElementById('cPause'));
  await until(()=>view(B)==='paused');
  check('Pause screens turns every participant to the shared screen, and the clock waits', view(B)==='paused' && !sw.C().timer.running && B.window.EPKit.tool.screen()==='laptop-paused' && sw.EPKit.tool.screen()==='console-paused');
  click(sw, sd.getElementById('cPause'));
  await until(()=>view(B)==='wrote');
  const left0 = sw.remaining(sw.C().timer); click(sw, sd.getElementById('tUp'));
  check('a minute up adds a minute', sw.remaining(sw.C().timer) > left0 + 50000);
  /* time's up: a complete set that wasn't submitted goes in; an empty one doesn't */
  const t = JSON.parse(JSON.stringify(sw.C().timer)); t.endsAt = sw.wnow() - 10; sw.setCtl({ timer: t });
  await until(()=>row(code,'st/'+D.window.App.seat));
  await until(()=>view(E)==='late');
  check('at zero, a complete set that wasn\'t submitted goes in, and every screen locks', !!row(code,'st/'+D.window.App.seat) && view(D)==='wrote' && view(E)==='late' && /Time's up/.test(bodyText(E)));
  check('at zero the console says pens down', sw.App.lastBanner==='Pens down');

  /* guess */
  await until(()=>sw.people().filter(p=>sw.setFor(p.id)).length===4);
  click(sw, sd.getElementById('cNext'));
  await until(()=>sw.C().phase==='guess' && /^guess:/.test(view(A)));
  const asg = sw.C().asg, ids = Object.keys(asg.m);
  check('Start guessing gives each of the 4 sets to 3 other people, and none to the person who wrote none', asg.k===3 && ids.length===4 && !ids.includes(E.window.App.seat) && ids.every(g=>asg.m[g].length===3 && !asg.m[g].includes(g)), JSON.stringify(asg)+' E='+E.window.App.seat+' D='+D.window.App.seat);
  await until(()=>view(E)==='watch' && [B, Cc, D].every(d=>/^guess:/.test(view(d))));
  check('someone with no set watches this round', view(E)==='watch' && E.window.EPKit.tool.screen()==='laptop-watch');
  check('a guess screen names whose three it is and shows them in a shuffled order', /'s three/.test(bodyText(A)) && A.window.document.querySelectorAll('#pOpts .opt').length===3 && A.window.EPKit.tool.screen()==='laptop-guess');
  const authors = { [A.window.App.seat]:'A', [B.window.App.seat]:'B', [Cc.window.App.seat]:'C', [D.window.App.seat]:'D' };
  /* A spots everything; B spots nothing; C spots only A's; D doesn't guess */
  await guessAll(A, () => true);
  await guessAll(B, () => false);
  await guessAll(Cc, t => authors[t]==='A');
  await until(()=>view(A)==='guessed' && view(B)==='guessed' && view(Cc)==='guessed');
  check('after three picks a participant waits for the results', view(A)==='guessed' && /guesses are in/.test(bodyText(A)));
  await until(()=>sd.getElementById('chipMore').textContent==='9');
  check('the console counts guesses and fills the dots', sd.getElementById('chipMore').textContent==='9' && sd.querySelectorAll('#cStage .gdots i.on').length===9, sd.getElementById('chipMore').textContent+' '+sd.querySelectorAll('#cStage .gdots i.on').length);
  await until(()=>row(code,'gs/'+A.window.App.seat) && Object.keys(row(code,'gs/'+A.window.App.seat).g).length===3);
  check('the guess for the right assignment is stored per guesser', row(code,'gs/'+A.window.App.seat).a===asg.id && Object.keys(row(code,'gs/'+A.window.App.seat).g).length===3);

  /* results and the reveal */
  check('Show the results is the one gold button', sd.getElementById('cNext').classList.contains('gold') && /Show the results/.test(sd.getElementById('cNext').textContent));
  click(sw, sd.getElementById('cNext'));
  await until(()=>on(st,'reveal'));
  await until(()=>view(A)==='hold');
  check('the reveal opens on a standby, and participants look up', /Who fooled the room/.test(txt(st,'rvSlide')) && view(A)==='hold' && sw.EPKit.tool.screen()==='console-standby' && A.window.EPKit.tool.screen()==='laptop-hold');
  const Rs = sw.results(), steps = sw.rvSteps(Rs);
  /* work the scores out by hand from what happened */
  const exp = {}; ids.forEach(id=>exp[id]=0);
  ids.forEach(g => { const gr = (row(code,'gs/'+g)||{g:{}}).g; asg.m[g].forEach(t => { const v = gr[t]; if (v===undefined) return; if (v===2) exp[g]++; else { exp[g]--; exp[t]++; } }); });
  check('every score matches the rule worked out by hand', ids.every(id => Rs.R[id].score===exp[id]), JSON.stringify(exp)+' vs '+JSON.stringify(ids.map(id=>Rs.R[id].score)));
  click(sw, sd.getElementById('rvBegin'));
  await until(()=>sw.C().rv===steps[1]);
  check('the first step after the standby is the lowest place that someone holds', sw.C().rv===steps[1] && /place|winner|tie/i.test(txt(st,'rvSlide')));
  for (let i=2;i<steps.length;i++){ click(sw, sd.getElementById('rvNext')); await until(()=>sw.C().rv===steps[i]); if (steps[i]==='p1') check('first place shows its people on the gold step', sd.querySelector('#rvSlide .pstep.gold .pn') && !sd.querySelector('#rvSlide .pstep.gold.vacant') && sw.EPKit.tool.screen()==='console-first'); }
  check('the awards name the best hallucination and the sharpest eye', /Best hallucination/.test(txt(st,'rvSlide')) && /Sharpest eye/.test(txt(st,'rvSlide')) && sw.EPKit.tool.screen()==='console-awards');
  click(sw, sd.getElementById('rvNext'));
  await until(()=>!on(st,'reveal'));
  await until(()=>view(A)==='results');
  check('Done closes the reveal onto the scores, ranked', !on(st,'reveal') && sd.querySelectorAll('#cStage .board2 li').length===4 && sw.EPKit.tool.screen()==='console-results');
  click(sw, sd.querySelector('#cStage [data-a="detail"][data-id="'+B.window.App.seat+'"]'));
  check('the facilitator can open anyone\'s three, with the hallucination marked', !!sw.App.dlg && /Truth/.test(sw.App.dlg.textContent) && /Hallucination/.test(sw.App.dlg.textContent) && /juggle fire/.test(sw.App.dlg.textContent) && sw.EPKit.tool.screen()==='console-detail');
  click(sw, sw.App.dlg.querySelector('[data-x="close"]'));
  check('Done closes it', !sw.App.dlg);
  /* each participant's breakdown adds up to their score */
  await until(()=>[A, B, Cc, D, E].every(d=>view(d)==='results'));
  const sums = d => [...d.window.document.querySelectorAll('.rh .pt')].map(e => +e.textContent.replace('−','-').replace('+',''));
  const okSum = [A, B, Cc, D].every(d => { const s = sums(d), r = sw.results().R[d.window.App.seat]; return s.length===2 && s[0]+s[1]===r.score; });
  check('each participant sees their guesses and the guesses on theirs, and the two add up to their score', okSum && /Your guesses/.test(bodyText(A)) && /Guesses on yours/.test(bodyText(A)) && A.window.EPKit.tool.screen()==='laptop-results');
  check('the breakdown lists one row per guess they made and per person who saw theirs', A.window.document.querySelectorAll('.rlist')[0].children.length===3 && A.window.document.querySelectorAll('.rlist')[1].children.length===3);
  check('someone who wrote nothing is thanked for watching', /Thanks for watching/.test(bodyText(E)));
  check('B, who missed every guess, sees three wrong picks with the real hallucination', (bodyText(B).match(/The hallucination:/g)||[]).length===3);

  /* ending */
  click(sw, sd.getElementById('cEnd'));
  check('End waits behind Undo', !!sd.getElementById('cUndoEnd'));
  click(sw, sd.getElementById('cUndoEnd'));
  check('Undo keeps the session', !sd.getElementById('cUndoEnd') && !!sd.getElementById('cEnd'));
  click(sw, sd.getElementById('cEnd'));
  await until(()=>on(st,'gate'), 3000);
  await until(()=>on(A,'gate'), 3000);
  check('ending deletes the session and every screen gets an ending', on(st,'gate') && /ended and cleared/.test(txt(st,'gHead')) && on(A,'gate') && /Thanks, Ana!/.test(txt(A,'gHead')) && row(code,'ctl')===undefined);

  /* ---------- the test drive: practice people, no network ---------- */
  const TD = load(HOSTED, { live:false }); const tdw = TD.window, tdd = tdw.document;
  await until(()=>on(TD,'studio'));
  tdw.goStep(2); click(tdw, tdd.getElementById('stDrive'));
  await until(()=>tdw.people().length>=6, 4000);
  check('the test drive fills the room with practice people and a bar that says so', tdw.people().length>=6 && !tdd.getElementById('simBar').classList.contains('hide'));
  click(tdw, tdd.getElementById('segPax'));
  await until(()=>tdd.getElementById('jName'));
  type(tdw, tdd.getElementById('jName'), 'Max'); click(tdw, tdd.querySelector('#jPick [data-m="m02"]')); click(tdw, tdd.getElementById('jGo'));
  await until(()=>view(TD)==='lobby');
  check('the participant view joins the practice room as one more person', view(TD)==='lobby');
  click(tdw, tdd.getElementById('segCon')); click(tdw, tdd.getElementById('cNext'));
  await until(()=>tdw.people().filter(p=>tdw.setFor(p.id)).length>=8, 5000);
  check('practice people write their three', tdw.people().filter(p=>tdw.setFor(p.id)).length>=8);
  click(tdw, tdd.getElementById('segPax')); await writeThree(TD, 'I have met a penguin', 'I own a tuba', 'I invented a sandwich'); click(tdw, tdd.getElementById('segCon'));
  click(tdw, tdd.getElementById('cNext'));
  await until(()=>tdw.guessCounts().tot>0 && tdw.guessCounts().got >= tdw.guessCounts().tot - 3, 6000);
  check('practice people guess', tdw.guessCounts().got>=tdw.guessCounts().tot-3);
  click(tdw, tdd.getElementById('cNext'));
  await until(()=>on(TD,'reveal'));
  check('the reveal runs in a test drive', /Who fooled the room/.test(txt(TD,'rvSlide')));
  check('nothing in the test drive touched the network', fetchesInDrive===0, String(fetchesInDrive));
  click(tdw, tdd.getElementById('rvClose'));
  click(tdw, tdd.getElementById('simExit'));
  check('Exit test drive goes back to the review', on(TD,'studio') && tdd.getElementById('st2').classList.contains('on'));

  /* ---------- every screen the feedback board can rebuild ---------- */
  const F = load(HOSTED, { live:false }); await until(()=>on(F,'studio'));
  const secs = F.window.EPKit.tool.sections(); let all = 0, okAll = 0, wrong = [];
  for (const s of secs) for (const sc of s.screens){ all++; const r = F.window.EPKit.tool.restore({ screen: sc, settings:{} }); if (r===true && F.window.EPKit.tool.screen()===sc) okAll++; else wrong.push(sc+'->'+F.window.EPKit.tool.screen()); }
  check('every one of the '+all+' feedback screens rebuilds and names itself', okAll===all && all===28, wrong.join(' '));
  check('no script errors', errors.length===0, errors.slice(0,3).join(' | '));

  doms.forEach(d => { try { d.window.stopLoops && d.window.stopLoops(); d.window.close(); } catch(e){} });
  console.log(failures ? '\n'+failures+' FAILED' : '\nAll checks passed.');
  process.exit(failures ? 1 : 0);
})();
