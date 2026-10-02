/* qa-room-pulse.mjs: jsdom harness for field-tools/room-pulse/index.html.
   Runs the studio, the console and several phones against the real pt worker code (fake database),
   checks the schedules, scoring, placement and headlines directly (including a small accuracy study),
   and decodes the lobby QR with jsQR.
   Run: node _backend/tests/qa-room-pulse.mjs   (needs: npm install jsdom jsqr) */
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
const html = fs.readFileSync(path.join(here, '../../field-tools/room-pulse/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0=Date.now(); while (Date.now()-t0 < (ms||3000)){ try{ if (fn()) return true; }catch(e){} await sleep(15); } return false; }
const HOSTED = 'https://ep.github.io/pt/field-tools/room-pulse/';
const env = { DB: FakeDB() };
const testHtml = html.replace(/<script type="text\/javascript">[\s\S]*?clarity[\s\S]*?<\/script>/, '');
const errors = [];
/* tabs in one browser talk over BroadcastChannel; jsdom has none, so tabs share this little bus */
const bus = {};
function FakeBC(name){ this.name=name; this.ls=[]; this.closed=false; (bus[name]=bus[name]||[]).push(this); }
FakeBC.prototype.postMessage=function(data){ const me=this; setTimeout(()=>{ (bus[me.name]||[]).forEach(o=>{ if (o!==me && !o.closed) o.ls.forEach(f=>f({data})); }); }, 1); };
FakeBC.prototype.addEventListener=function(t,f){ if (t==='message') this.ls.push(f); };
FakeBC.prototype.removeEventListener=function(t,f){ this.ls=this.ls.filter(x=>x!==f); };
FakeBC.prototype.close=function(){ this.closed=true; };
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; const req = new Request(String(url), { method:init.method||'GET', headers:init.headers||{}, body:init.body }); return worker.fetch(req, env); }; }
function load(url, live, seed){
  return new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){
    if (live) mockFetch(window);
    window.BroadcastChannel = FakeBC;
    if (seed) Object.keys(seed).forEach(k=>window.localStorage.setItem(k, seed[k]));
    window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
    window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } });
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.scrollTo = () => {};
    window.addEventListener('error', e => errors.push(String(e.message)));
  } });
}
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, el, k){ el.dispatchEvent(new win.KeyboardEvent('keydown', { key:k, bubbles:true })); }
function painted(win, el){ if (!el) return false; let n=el; while (n && n.nodeType===1){ if (win.getComputedStyle(n).display==='none') return false; n=n.parentNode; } return true; }
function primaries(doc, id){ const root=doc.getElementById(id); return Array.from(root.querySelectorAll('.btn')).filter(b=>!b.classList.contains('sec') && !b.classList.contains('ghost') && !b.classList.contains('hide') && !b.closest('.hide')).length; }
function stepOn(doc){ return Array.from(doc.querySelectorAll('.step')).find(s => s.classList.contains('on')).id; }
const fast = 'App.conPollMs=40; App.paxBase=40; App.frostMs=0; App.anim=false; App.holdMin=0; App.holdMax=0; App.lockMs=0; App.writeMs=0; App.endDelay=120; App.hbMs=60000; App.idMs=20;';
async function phone(code, extra, seed){ const d=load(HOSTED+'?join='+code+(extra||''), true, seed); d.window.eval(fast); await sleep(60); return d; }
function view(d){ return d.window.App.paxSig; }
function body(d){ return d.window.document.getElementById('paxBody').textContent; }
function row(code, p){ return env.DB._rows.get('room-pulse:'+code+'|'+p); }
/* answer every pair on a phone: toward pleasant words when lean>0, unpleasant when lean<0 */
async function answerAll(d, lean, limit){
  const w=d.window; let n=0;
  for (let i=0;i<200;i++){
    const v=w.paxViewOf();
    if (v.v==='hold'){ await sleep(10); continue; }
    if (v.v!=='warm' && v.v!=='pair') break;
    let pick=0;
    if (v.v==='pair'){ const s=w.pairFor(v.p, v.k), W=w.cfgOf().words; pick = (W[s[0]].x*lean >= W[s[1]].x*lean) ? 0 : 1; n++; }
    w.paxPick(pick); await sleep(5);
    if (limit && n>=limit) break;
  }
}
/* read a rendered QR back into modules, rasterize it, decode with jsQR */
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
async function launch(win, doc, len){
  click(win, doc.getElementById('btnBuild'));
  click(win, doc.getElementById('next1')); click(win, doc.getElementById('next2'));
  if (len) click(win, doc.querySelector('[data-len="'+len+'"]'));
  click(win, doc.getElementById('next3')); click(win, doc.getElementById('btnLaunch'));
  await until(()=>/host=/.test(win.location.href), 2000);
  return (win.location.href.match(/host=([A-Z]+)/)||[])[1];
}

(async function(){
  /* ---------- statics ---------- */
  const noscript = html.replace(/<script[\s\S]*?<\/script>/g, '');
  const js = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
  check('page is noindex', /name="robots" content="noindex, nofollow"/.test(html));
  check('favicon set is linked from /pt/assets/favicon/', /\/pt\/assets\/favicon\/favicon\.svg/.test(html) && /apple-touch-icon\.png/.test(html));
  check('Clarity tag present, and participant screens are masked from it', /clarity\.ms\/tag\//.test(html) && /id="paxBody" data-clarity-mask="True"/.test(html));
  check('no em dashes anywhere', !/—/.test(html));
  check('every script parses', [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].every(m=>{ try{ new Function(m[1]); return true; }catch(e){ return false; } }));
  check('no regex lookbehind (older iPhones refuse the whole script)', !/\(\?<[=!]/.test(js));
  const rawStorage = js.replace(/function store\(k,v\)\{ try\{ localStorage\.setItem\(k,v\); \}catch\(e\)\{\} \}/,'').replace(/function read\(k\)\{ try\{ return localStorage\.getItem\(k\); \}catch\(e\)\{ return null; \} \}/,'').replace(/function unstore\(k\)\{ try\{ localStorage\.removeItem\(k\); \}catch\(e\)\{\} \}/,'').replace(/function sstore\(k,v\)\{ try\{ sessionStorage\.setItem\(k,v\); \}catch\(e\)\{\} \}/,'').replace(/function sread\(k\)\{ try\{ return sessionStorage\.getItem\(k\); \}catch\(e\)\{ return null; \} \}/,'');
  check('browser storage is only touched through the guarded helpers', !/localStorage|sessionStorage/.test(rawStorage));
  check('one font family, Archivo, from Google Fonts', /family=Archivo:/.test(html) && !/Montserrat/.test(html));
  check('no step captions, no copyright line', !/Step \d of/.test(html) && !/©|copyright/i.test(noscript));
  check('participants have no forward controls', !/data-act="next"|>Skip<|>Begin<|>Finish</.test(js));
  check('the fuse is gone: no timer, no setting, no copy', !/\bfuse|Fuse\b|Time’s up|each, from their first pair/.test(html));
  check('the instruction field is gone; participants read one plain line', !/id="instr"/.test(html) && !/Above the first pairs/.test(html) && /Two words at a time\. Tap the one closer to how you feel\./.test(js));
  check('standby copy is the orb, the line and the gold button', /id="rvStandby"><div class="orb"><\/div><h1>Enough suspense\.<\/h1><button class="btn big gold" id="rvBegin">Show the room<\/button>/.test(html));
  check('participant beat copy is present', /re in!/.test(js) && /First, an easy one\./.test(js) && /Got it\./.test(js) && /Now we wait for the room\./.test(js) && /Locked in\./.test(js) && /Once more\./.test(js) && /s all, folks\./.test(js));
  check('the default note says why the eight are a good start', /two in each corner of the feelings map, so no answer gets a nudge/.test(js));
  check('console controls are a bar that stays in view', /\.con \.controls\{position:sticky;bottom:0/.test(html));
  check('sound unlocks on every gesture and when the tab returns', /\['pointerdown','touchend','keydown'\]/.test(js) && /visibilitychange/.test(js));
  check('the waiting toy takes touch as a fallback, fades under the words, and makes no sound', /addEventListener\('touchstart'/.test(js) && /destination-out/.test(js) && !/function down\(x,y\)\{[^}]*Sfx\./.test(js));
  check('the waiting toy has a hint that leaves after the first touch', /id="toyHint"/.test(html) && /Press and hold anywhere to raise a hill\./.test(html) && /classList\.add\('gone'\)/.test(js));
  check('reduced motion stops animation and hides the toy', /prefers-reduced-motion:reduce\)\{\*\{animation:none !important;transition:none !important;\}.*#idle\{display:none;\}/.test(html));
  check('a closing page says goodbye with a plain-text keepalive; a hidden one says it is asleep', /keepalive:true/.test(js) && /text\/plain/.test(js) && /'pagehide'/.test(js) && /Net\.bye\('here\/'\+App\.pid, -2\)/.test(js));
  check('the console asks the worker for presence times', /Net\.state\(null, null, 'here'\)/.test(js) && /&times='\+times/.test(js));
  const shortJoin=fs.readFileSync(path.join(here, '../../pulse/index.html'), 'utf8');
  check('the short address pt/pulse forwards to this join screen and carries the code', /location\.replace\('\/pt\/field-tools\/room-pulse\/\?join'\+\(c\?'='\+c\.toUpperCase\(\):''\)\)/.test(shortJoin) && /noindex/.test(shortJoin) && /JOIN_SHORT = 'ep\.github\.io\/pt\/pulse'/.test(js));
  check('canvases are sized by layout, not by the painted box', /var w=cv\.clientWidth, h=cv\.clientHeight/.test(js));
  check('the four corners are named on every map, in EP supporting colours', /name:'Energized'/.test(js) && /name:'Tense'/.test(js) && /name:'Drained'/.test(js) && /name:'Settled'/.test(js) && /rgb:\[104,191,189\]/.test(js) && /rgb:\[144,178,16\]/.test(js) && /rgb:\[88,106,144\]/.test(js) && /rgb:\[216,101,39\]/.test(js));
  check('the editor keeps its axis labels on', !/\.edmap \.ax\{[^}]*opacity:0/.test(html) && /class="ax r">Pleasant/.test(html));
  check('every coaching note carries its source', ['Russell, 1980','Fredrickson, 2001','Brooks, 2014','Maslach and Leiter, 2016','Prentice and Miller, 1993','Larsen, McGraw and Cacioppo, 2001','Piderit, 2000','Barsade, 2002','Kahneman, Fredrickson, Schreiber and Redelmeier, 1993','Howard, 1980'].every(s=>js.indexOf(s)>-1));
  check('the hero keeps the over-time path off the main path', /class="hint heroalt"><button class="lnk" id="btnTime">Show saved results over time<\/button>/.test(html));

  /* ---------- the core: schedules, scoring, placement, headlines ---------- */
  let dom = load(HOSTED, false), win = dom.window, doc = win.document; await sleep(40);
  const C = win.CORE;
  const words8 = win.DEFAULT_WORDS;
  {
    let ok=true, adj=0;
    for (const R of [3,5,7]) for (let t=0;t<60;t++){
      const s=C.sequence(8,R,'p'+t), seen=new Array(8).fill(0), pairs=new Set();
      s.forEach(p=>{ seen[p[0]]++; seen[p[1]]++; const k=Math.min(p[0],p[1])+'-'+Math.max(p[0],p[1]); if (pairs.has(k)) ok=false; pairs.add(k); });
      if (!seen.every(x=>x===R) || s.length!==R*4) ok=false;
      for (let i=1;i<s.length;i++) if (s[i].some(w=>s[i-1].includes(w))) adj++;
    }
    check('rounds are balanced: every word shows up once per round, no pair twice', ok);
    check('no word shows up in two pairs in a row', adj===0);
    check('every pair is covered by a full run (28 for eight words)', new Set(C.sequence(8,7,'z').map(p=>Math.min(...p)+'-'+Math.max(...p))).size===28 && C.total(8,'all')===28);
    check('odd word counts sit one word out per round', C.maxRounds(7)===7 && C.sequence(7,7,'q').length===21 && C.maxRounds(9)===9);
    check('each person gets their own order, the same again on reload', JSON.stringify(C.sequence(8,7,'a:1'))===JSON.stringify(C.sequence(8,7,'a:1')) && JSON.stringify(C.sequence(8,7,'a:1'))!==JSON.stringify(C.sequence(8,7,'b:1')));
    let topFirst=0; for (let t=0;t<400;t++){ const s=C.sequence(8,7,'s'+t); s.forEach(p=>{ if (p[0]<p[1]) topFirst++; }); }
    check('which word sits on top is shuffled', topFirst>400*28*.4 && topFirst<400*28*.6);
  }
  {
    /* Focused: a round of opposites, then every winner meets every other winner */
    const fp=C.farPairs(words8), side=i=>words8[i].x>=0, quad=i=>C.quadOf(words8[i].x, words8[i].y);
    check('the opposites cross the map: every first-round pair spans both sides and two corners', fp.bye===-1 && fp.pairs.length===4 && fp.pairs.every(p=>side(p[0])!==side(p[1]) && quad(p[0])!==quad(p[1])));
    check('Focused is 10 picks for eight words: 4 opposites, then 6 among the winners', C.total(8,'focus')===10 && JSON.stringify(C.stages(8,'focus'))==='[4,6]');
    let ok=true, det=true;
    for (let t=0;t<300;t++){ const r=C.mulberry(t+1), s=C.run(words8,'focus',0,'x'+t,(a,b)=>r()<.5?a:b), picks=C.parse(s);
      const keys=picks.map(p=>Math.min(...p)+'-'+Math.max(...p)), win=picks.slice(0,4).map(p=>p[0]);
      if (picks.length!==10 || new Set(keys).size!==10 || !picks.slice(4).every(p=>win.includes(p[0]) && win.includes(p[1]))) ok=false;
      const again=C.run(words8,'focus',0,'x'+t,(a,b)=>{ const q=picks.find(p=>(p[0]===a&&p[1]===b)||(p[0]===b&&p[1]===a)); return q[0]; }); if (again!==s) det=false; }
    check('a Focused run never repeats a pair, and the close calls are among the winners only', ok);
    check('a Focused run is the same again from the same picks (reloads land on the same pair)', det);
    const W9=words8.concat([{w:'Hopeful',x:.2,y:.55}]), W10=W9.concat([{w:'Tired',x:-.2,y:-.6}]);
    check('odd and larger sets: the word nearest the middle goes straight through, and lengths stay fixed', C.farPairs(W9).bye>-1 && C.total(9,'focus')===14 && C.total(10,'focus')===15 && C.parse(C.run(W9,'focus',0,'o',(a,b)=>a)).length===14 && C.parse(C.run(W10,'focus',0,'o',(a,b)=>b)).length===15);
    check('with five words or fewer, Focused is simply every pair', C.total(5,'focus')===10 && C.total(4,'focus')===6 && !C.focusOK(5) && C.focusOK(6));
    check('someone who stops early counts once half their run is in', C.minPicks(8,'all')===14 && C.minPicks(8,'focus')===7);
  }
  {
    /* the scoring note's example: one point per pick, wins out of times shown */
    const all=C.rounds(8).flat();
    const order=[0,1,2,3,4,5,6,7];
    let s=''; all.forEach(p=>{ const w = order.indexOf(p[0])<order.indexOf(p[1]) ? p[0] : p[1]; s+=w+''+(w===p[0]?p[1]:p[0]); });
    let sc=C.score(C.parse(s),8);
    check('a clear order scores 7, 6, 5 ... and the top word is home', sc.wins.join()==='7,6,5,4,3,2,1,0' && sc.top===0 && sc.sec===1 && !sc.mixed);
    let u=''; all.forEach(p=>{ const a=p[0], b=p[1], has=(x,y)=>(a===x&&b===y)||(a===y&&b===x); let w;
      if (has(0,4)) w=0; else if (has(0,1)) w=1; else if (a===4||b===4) w=4; else if (a===0||b===0) w=0; else if (has(1,2)) w=2; else if (has(1,3)) w=3; else w=Math.min(a,b);
      u+=w+''+(w===a?b:a); });
    sc=C.score(C.parse(u),8);
    check('a tie at the top between words that met stays mixed', sc.wins[0]===6 && sc.wins[4]===6 && sc.mixed===true);
    sc=C.score(C.parse('01'+'23'+'31'),8);
    check('a tie between words that never met is a lean, ordered by who they beat', !sc.mixed && sc.top===2 && sc.sec===0);
    sc=C.score(C.parse('01'+'23'+'45'+'67'),8);
    check('and when nothing can separate them, it stays a split', sc.mixed);
    check('6 of 7 reads as wins out of times shown, not a share of a person', Math.abs(C.score(C.parse(u),8).rate[0]-6/7)<1e-9);
  }
  {
    let honest=true, close=true, between=true;
    for (let t=0;t<300;t++){
      const picks=C.parse(win.botPicks([{x:.5,y:.4}], 3+t%5, words8, t%2?'focus':'all', 7, 'h'+t)); if (picks.length<4) continue;
      const sc=C.score(picks,8), p=C.place(sc,words8,'pid'+t), k=C.nearest(words8,p.x,p.y);
      if (sc.mixed){ if (k!==sc.top && k!==sc.sec) between=false; }
      else { if (k!==sc.top) honest=false; if (Math.hypot(p.x-words8[sc.top].x, p.y-words8[sc.top].y)>.13+.1) close=false; }
    }
    check('every dot sits nearest its own top word', honest);
    check('a lean is a short step toward the runner-up, never into the middle', close);
    check('a split sits between its two words', between);
    const W8=words8;
    check('a split between far-apart words keeps the dot home and rings the other word', !!win.splitRing({m:true, h:7, s:1, x:W8[7].x+.03, y:W8[7].y}, W8) && win.splitRing({m:true, h:0, s:1, x:(W8[0].x+W8[1].x)/2, y:(W8[0].y+W8[1].y)/2}, W8)===null && win.splitRing({m:false, h:0, s:1, x:W8[0].x, y:W8[0].y}, W8)===null);
  }
  {
    /* validity: Focused finds the same top word as every pair, read from the same people's answers */
    const r=C.mulberry(2026);
    function gauss(){ let a=0,b=0; while(!a) a=r(); while(!b) b=r(); return Math.sqrt(-2*Math.log(a))*Math.cos(2*Math.PI*b); }
    let agree=0, truthF=0, truthA=0, N=400;
    for (let i=0;i<N;i++){
      const w=words8[Math.floor(r()*8)], at={x:w.x+gauss()*.12, y:w.y+gauss()*.12}, T={};
      const d=x=>Math.hypot(at.x-words8[x].x, at.y-words8[x].y);
      for (let a=0;a<8;a++) for (let b=a+1;b<8;b++){ const pa=1/(1+Math.exp(-5*(d(b)-d(a)))); T[a+'-'+b]= r()<pa ? a : b; }
      const ask=(a,b)=>T[Math.min(a,b)+'-'+Math.max(a,b)], truth=C.nearest(words8, at.x, at.y);
      const sa=C.score(C.parse(C.run(words8,'all',7,'v'+i,ask)),8), sf=C.score(C.parse(C.run(words8,'focus',7,'v'+i,ask)),8);
      if (sa.top===sf.top) agree++; if (sf.top===truth) truthF++; if (sa.top===truth) truthA++;
    }
    check('validity: Focused agrees with every pair on the top word for at least 9 in 10 people ('+Math.round(agree/N*100)+'%)', agree/N>=.9);
    check('validity: Focused is within 4 points of every pair at finding the true feeling ('+Math.round(truthF/N*100)+'% vs '+Math.round(truthA/N*100)+'%)', truthF/N >= truthA/N - .04);
  }
  {
    const W=words8;
    check('the room comes first: under half on the biggest word leans', C.headline({n:32,c:[3,13,2,1,7,0,4,2],m:0},W)==='The room leans curious. Some anxious. A few discouraged.');
    check('numbers match words: more than half is mostly, 8 in 10 is almost entirely, everyone is plain', /^The room is mostly curious\./.test(C.headline({n:32,c:[3,17,2,1,5,0,2,0],m:2},W)) && C.headline({n:25,c:[21,1,1,0,0,0,0,0],m:2},W)==='The room is almost entirely excited.' && C.headline({n:12,c:[12,0,0,0,0,0,0,0],m:0},W)==='The room is excited.');
    check('a small room gets words without counts', C.headline({n:3,c:[1,0,0,0,1,0,0,0],m:1},W)==='The room is excited and anxious.');
    check('a thin spread says so, and still names its biggest groups', /^The room is all over the map\. Some excited\. Some curious\. Some/.test(C.headline({n:20,c:[3,3,3,2,3,2,2,1],m:1},W)));
    check('a split is two big groups on opposite sides', C.headline({n:20,c:[9,0,0,0,8,0,0,0],m:3,mp:{a:0,b:4,n:2}},W).indexOf('The room is split between excited and anxious.')===0 && !/split/.test(C.headline({n:20,c:[9,8,0,0,0,0,0,0],m:3},W)));
    check('two neighbouring words that together hold most of the room read as one group', /^The room is mostly excited and curious\./.test(C.headline({n:20,c:[7,5,0,0,3,0,0,0],m:5},W)));
    check('a tie at the top reads as mixed, with room for one more line', C.headline({n:18,c:[4,4,3,0,3,0,1,0],m:3},W)==='The room is mixed. Some excited. Some curious. Some anxious.');
    check('a fifth of the room or more on the other side is never left out of the headline; less than that, biggest first', C.headline({n:40,c:[7,13,0,7,4,4,3,2],m:0},W)==='The room leans curious. Some excited. Some anxious or frustrated.' && C.headline({n:40,c:[9,14,0,10,3,2,2,0],m:0},W)==='The room leans curious. Some calm. Some excited.' && C.headline({n:10,c:[3,4,0,0,1,1,1,0],m:0},W)==='The room is mostly curious and excited. Some anxious or frustrated.');
    check('in between names the two words when one pair holds most of them', /Some between excited and anxious\./.test(C.headline({n:20,c:[2,9,0,0,3,0,0,0],m:6,mp:{a:0,b:4,n:4}},W)));
    check('a room mostly torn says so', C.headline({n:10,c:[1,1,0,0,1,0,0,0],m:7,mp:{a:1,b:2,n:5}},W)==='The room is torn between curious and confident.');
    const A={n:32,c:[3,9,2,1,10,3,2,2],m:0};
    check('the shift says what the room is now: less of one, more of another', C.shiftHeadline(A,{n:30,c:[8,9,6,2,3,1,1,0],m:0},W)==='The room is less anxious and more excited. Many curious.');
    check('a shift that barely moved says so', C.shiftHeadline(A,{n:32,c:[3,9,2,1,10,3,2,2],m:0},W)==='The room is much the same. Still many anxious.');
    { const A2=[], B2=[]; for (let i=0;i<20;i++){ A2.push({pid:'p'+i, h:i<10?4:1, m:false}); B2.push({pid:'p'+i, h:i<3?3:(i<10?4:1), m:false}); }
      const ra=win.roomOf(A2,8), rb=win.roomOf(B2,8), fl=C.flowsOf(A2,B2,8);
      check('a small swap among the same people is not called a move (paired test)', ra.c[4]-rb.c[4]===3 && C.shiftHeadline(ra, rb, W, fl).indexOf('much the same')>-1 && C.shiftHeadline(ra, rb, W).indexOf('less anxious')>-1); }
    { const A2=[], B2=[]; for (let i=0;i<20;i++){ A2.push({pid:'p'+i, h:i<10?4:1, m:false}); B2.push({pid:'p'+i, h:i<7?3:(i<10?4:1), m:false}); }
      check('a real move among the same people is named', C.shiftHeadline(win.roomOf(A2,8), win.roomOf(B2,8), W, C.flowsOf(A2,B2,8))==='The room is less anxious and more calm. Still many curious.'); }
    { /* six people leave four different unpleasant words for four pleasant ones: no single word moves enough, but the room does */
      const hA=[4,4,5,5,5,6,6,7,7,7,0,0,1,1,1,2,2,3,3,3], mk=hs=>hs.map((h,i)=>({pid:'p'+i, h, m:false, x:W[h].x, y:W[h].y})), roomOf=P=>win.roomOf(P,8);
      const right={0:0,2:1,5:2,7:3,3:1,8:3}, left={10:4,12:5,15:6,17:7,13:5,18:7}, A2=mk(hA), B2=mk(hA.map((h,i)=>i in right?right[i]:h)), L2=mk(hA.map((h,i)=>i in left?left[i]:h));
      check('a move across the map that no single word shows reads as more (or less) pleasant', C.shiftHeadline(roomOf(A2), roomOf(B2), W, C.flowsOf(A2,B2,8))==='The room is more pleasant. Still some curious.' && /^The room is less pleasant\./.test(C.shiftHeadline(roomOf(A2), roomOf(L2), W, C.flowsOf(A2,L2,8))) && /^The room is much the same\./.test(C.shiftHeadline(roomOf(A2), roomOf(A2), W, C.flowsOf(A2,A2,8))));
      const lead=(b, a)=>{ const box=doc.createElement('div'); box.innerHTML=win.notesHtml(2, {room:roomOf(b), people:b}, {room:roomOf(a), people:a}, W); return Array.from(box.querySelectorAll('.note b')).map(x=>x.textContent).join(' | '); };
      check('the notes agree with the headline about the move, with the counts behind it', /The room moved toward pleasant\./.test(lead(B2,A2)) && /Of the 20 people who answered both times, 6 moved toward pleasant and 14 toward neither\./.test((()=>{ const box=doc.createElement('div'); box.innerHTML=win.notesHtml(2, {room:roomOf(B2), people:B2}, {room:roomOf(A2), people:A2}, W); return box.textContent; })()) && /The room moved toward unpleasant\./.test(lead(L2,A2)) && /No clear move toward pleasant or unpleasant\./.test(lead(A2,A2)) && !/The room moved/.test(lead(A2,A2))); }
    check('the shift never names the same word twice', !/Still some curious/.test(C.shiftHeadline({n:30,c:[2,14,6,1,4,1,1,1],m:0},{n:30,c:[2,9,5,6,4,1,2,1],m:0},W)));
    check('typed capitals inside a word are kept', C.low('AI-curious')==='AI-curious' && C.low('Curious')==='curious');
    /* every quantifier in a headline matches its share */
    let honest=true; const r=C.mulberry(77);
    for (let t=0;t<2000;t++){ const n=5+Math.floor(r()*80), c=new Array(8).fill(0); let m=0; for (let i=0;i<n;i++){ if (r()<.15) m++; else c[Math.floor(Math.pow(r(),1+t%3)*8)]++; }
      const h0=C.headline({n, c, m, mp:null}, W);
      /* a line naming two words ("Some anxious or frustrated.") counts both */
      const h=h0.replace(/(Mostly|Many|Some|A few) (\S+) or (\S+)\./g, (all, q, a, b)=>{ const ia=W.findIndex(w=>w.w.toLowerCase()===a), ib=W.findIndex(w=>w.w.toLowerCase()===b), s=(c[ia]+c[ib])/n;
        if (ia<0 || ib<0 || !c[ia] || !c[ib] || c[ia]+c[ib]<2) honest=false; if (q==='Mostly' && !(s>.5)) honest=false; if (q==='Many' && !(s>=.3 && s<=.5)) honest=false; if (q==='Some' && !(s>=.15 && s<.3)) honest=false; if (q==='A few' && !(s<.15)) honest=false; return ''; });
      W.forEach((w,i)=>{ const s=c[i]/n, low=w.w.toLowerCase();
        if (h.indexOf('mostly '+low)>-1 && !(s>.5) && h.indexOf('mostly '+low+' and')<0) honest=false;
        if (h.indexOf('almost entirely '+low)>-1 && !(s>=.8)) honest=false;
        if (h.indexOf('Many '+low)>-1 && !(s>=.3 && s<=.5)) honest=false;
        if (h.indexOf('Some '+low)>-1 && !(s>=.15 && s<=.3)) honest=false;
        if (h.indexOf('A few '+low)>-1 && !(s<.15 && c[i]>=2)) honest=false; }); }
    check('across 2,000 random rooms, every quantifier matches its share', honest);
  }

  /* ---------- studio ---------- */
  check('studio opens on the hero with steps hidden', stepOn(doc)==='st0' && doc.getElementById('steps').classList.contains('hide'));
  check('hero has exactly one primary', primaries(doc,'st0')===1);
  click(win, doc.getElementById('btnBuild'));
  check('step 1 is the question, ready to go with "this change"', stepOn(doc)==='st1' && doc.querySelectorAll('#steps i').length===4 && doc.getElementById('qBlank').value==='this change' && doc.getElementById('pvQ').textContent==='How are you feeling about this change?');
  check('the suggestions are in plain view, the current one marked', doc.querySelectorAll('#tries .try').length===4 && doc.querySelector('#tries [data-try="this change"]').getAttribute('aria-pressed')==='true');
  type(win, doc.getElementById('qBlank'), '');
  click(win, doc.getElementById('next1'));
  check('Next with an empty blank stays and asks for it', stepOn(doc)==='st1' && /Fill in the blank/.test(doc.getElementById('qNote').textContent));
  click(win, doc.querySelector('[data-try="AI"]'));
  check('a suggestion fills the blank and the preview', doc.getElementById('qBlank').value==='AI' && doc.getElementById('pvQ').textContent==='How are you feeling about AI?');
  check('participants read the fixed instruction in the preview', doc.getElementById('pvI').textContent===win.DEFAULT_INSTR);
  click(win, doc.getElementById('qmFull'));
  check('writing your own question starts from the sentence', painted(win, doc.getElementById('qFull')) && !painted(win, doc.getElementById('qBlank')) && doc.getElementById('qFull').value==='How are you feeling about AI?' && doc.getElementById('qmFull').getAttribute('aria-pressed')==='true');
  type(win, doc.getElementById('qFull'), 'How are you feeling as we wrap up <b>another year</b>?');
  check('the preview shows the question as typed, escaped', doc.getElementById('pvQ').textContent==='How are you feeling as we wrap up <b>another year</b>?' && !doc.getElementById('pvQ').querySelector('b'));
  click(win, doc.getElementById('qmBlank'));
  check('back to the sentence keeps the blank', painted(win, doc.getElementById('qBlank')) && doc.getElementById('qBlank').value==='AI');
  click(win, doc.getElementById('qmFull'));
  check('and your own question is still there when you come back to it', doc.getElementById('qFull').value==='How are you feeling as we wrap up <b>another year</b>?');
  check('a reset is offered once anything changed', painted(win, doc.getElementById('qReset')));
  click(win, doc.getElementById('qReset'));
  check('reset puts the sentence back and clears your own question', win.STUDIO.setup.mode==='blank' && win.STUDIO.setup.blank==='this change' && win.STUDIO.setup.full==='' && !painted(win, doc.getElementById('qReset')));
  click(win, doc.querySelector('[data-try="AI"]'));
  check('step 1 has one primary', primaries(doc,'st1')===1);
  click(win, doc.getElementById('next1'));
  check('step 2 is the words on the map, with the corners named', stepOn(doc)==='st2' && doc.querySelectorAll('#edTags .wtag').length===8 && doc.querySelectorAll('#edQuads .qd').length===4 && /Energized/.test(doc.getElementById('edQuads').textContent));
  check('the eight come with their note, and no reset', /two in each corner/.test(doc.getElementById('wNote').textContent) && doc.getElementById('wReset').classList.contains('hide'));
  type(win, doc.getElementById('wAdd'), 'curious'); click(win, doc.getElementById('wAddBtn'));
  check('a word already on the map is refused', doc.querySelectorAll('#edTags .wtag').length===8 && /already on the map/.test(doc.getElementById('wWarn').textContent));
  type(win, doc.getElementById('wAdd'), '<i>Overwhelmed</i>'); key(win, doc.getElementById('wAdd'), 'Enter');
  const s1=win.STUDIO.setup.words;
  check('Enter adds a word, placed apart from the others, escaped', s1.length===9 && doc.querySelectorAll('#edTags .wtag').length===9 && !doc.querySelector('#edTags i') && s1.slice(0,8).every(w=>Math.hypot(w.x-s1[8].x,w.y-s1[8].y)>=.2));
  check('a changed set offers the way back to our eight as a button', !doc.getElementById('wReset').classList.contains('hide') && doc.getElementById('wReset').classList.contains('btn') && /Go back to our eight/.test(doc.getElementById('wReset').textContent) && /Pleasant to the right/.test(doc.getElementById('wNote').textContent));
  const tag=doc.querySelector('#edTags .wtag[data-i="8"]'); const x0=s1[8].x; key(win, tag, 'ArrowRight');
  check('arrow keys nudge a word', win.STUDIO.setup.words[8].x!==x0);
  win.STUDIO.setup.words[8].x=win.STUDIO.setup.words[1].x; win.STUDIO.setup.words[8].y=win.STUDIO.setup.words[1].y; win.settleWord(8);
  check('a word dropped on another steps away', Math.hypot(win.STUDIO.setup.words[8].x-win.STUDIO.setup.words[1].x, win.STUDIO.setup.words[8].y-win.STUDIO.setup.words[1].y)>=.25);
  key(win, doc.querySelector('#edTags .wtag[data-i="8"]'), 'Delete');
  check('Delete removes the focused word', win.STUDIO.setup.words.length===8);
  for (const w of ['Hopeful','Weary']){ type(win, doc.getElementById('wAdd'), w); click(win, doc.getElementById('wAddBtn')); }
  check('ten is the most', win.STUDIO.setup.words.length===10 && doc.getElementById('wAdd').disabled===true);
  click(win, doc.getElementById('next2'));
  check('with ten words, Focused is the default (every pair would be 45 picks)', doc.querySelector('[data-len="focus"]').getAttribute('aria-pressed')==='true' && /15 picks/.test(doc.querySelector('[data-len="focus"]').textContent) && /45 picks/.test(doc.querySelector('[data-len="all"]').textContent));
  click(win, doc.getElementById('back3'));
  click(win, doc.querySelector('#edTags .x[data-i="9"]'));
  check('the x removes a word', win.STUDIO.setup.words.length===9 && doc.getElementById('wAdd').disabled===false);
  click(win, doc.getElementById('wReset'));
  check('the button puts the eight back', win.isDefaultWords(win.STUDIO.setup.words));
  for (let i=0;i<5;i++) click(win, doc.querySelector('#edTags .x[data-i="0"]'));
  click(win, doc.getElementById('next2'));
  check('Next with three words stays and asks for four', stepOn(doc)==='st2' && /at least four/.test(doc.getElementById('wWarn').textContent));
  type(win, doc.getElementById('wAdd'), 'Hopeful'); click(win, doc.getElementById('wAddBtn')); click(win, doc.getElementById('next2'));
  check('with four or five words there is one length: every pair', stepOn(doc)==='st3' && doc.querySelectorAll('#lenCards .ccard').length===1 && !!doc.querySelector('[data-len="all"]'));
  click(win, doc.getElementById('back3')); click(win, doc.getElementById('wReset')); click(win, doc.getElementById('next2'));
  check('step 3 offers Focused and every pair, every pair chosen for eight words', stepOn(doc)==='st3' && doc.querySelectorAll('#lenCards .ccard').length===2 && doc.querySelector('[data-len="all"]').getAttribute('aria-pressed')==='true');
  check('length cards draw who meets whom, with picks and time', doc.querySelectorAll('#lenCards .mini svg').length===2 && /10 picks/.test(doc.getElementById('lenCards').textContent) && /28 picks/.test(doc.getElementById('lenCards').textContent));
  click(win, doc.querySelector('[data-len="focus"]'));
  check('a chosen length sticks', win.STUDIO.setup.len==='focus' && win.STUDIO.setup.lenSet===true);
  check('step 3 has one primary', primaries(doc,'st3')===1);
  click(win, doc.getElementById('next3'));
  const rv=doc.getElementById('review').textContent;
  check('the review is the whole setup, with no fuse and no instruction', stepOn(doc)==='st4' && /How are you feeling about AI\?/.test(rv) && /Focused, 10 picks/.test(rv) && !/Fuse|Above the first/.test(rv));
  check('the test drive says how many pretend people, and the number changes', doc.getElementById('botN').textContent==='18' && (click(win, doc.getElementById('botMore')), doc.getElementById('botN').textContent==='40') && (click(win, doc.getElementById('botLess')), click(win, doc.getElementById('botLess')), doc.getElementById('botN').textContent==='8'));
  click(win, doc.getElementById('botMore'));
  check('review rows edit', (click(win, doc.querySelector('.rw[data-step="2"]')), stepOn(doc)==='st2'));
  click(win, doc.getElementById('next2')); click(win, doc.getElementById('next3'));
  click(win, doc.getElementById('btnCopySetup'));
  const link=win.copied[win.copied.length-1]||'';
  const dec=win.decodeSetup(link.split('setup=')[1]||'');
  check('a setup link carries the whole setup', !!dec && dec.blank==='AI' && dec.len==='focus' && dec.words.length===8);
  check('the draft autosaves', !!win.decodeSetup(win.read('rp_draft')||''));
  const d2=load(HOSTED+'?setup='+(link.split('setup=')[1]||''), false); await sleep(30);
  check('a setup link reopens the studio on the question', stepOn(d2.window.document)==='st1' && d2.window.document.getElementById('qBlank').value==='AI');
  const legacy=win.btoa(JSON.stringify({mode:'blank', blank:'x', instr:'old', words:words8, rounds:3, lenSet:true, fuse:{on:true,s:90,set:true}})), legacyAll=win.btoa(JSON.stringify({mode:'blank', blank:'x', words:words8, rounds:7}));
  check('setup links from before this round still open: short runs become Focused', win.decodeSetup(legacy).len==='focus' && win.decodeSetup(legacyAll).len==='all');
  d2.window.close();
  win.close();

  /* ---------- live: studio to console, phones by link and by code ---------- */
  dom = load(HOSTED, true); win = dom.window; doc = win.document; win.eval(fast); await sleep(30);
  const code = await launch(win, doc);
  check('launch creates a session and moves to the console', !!code && doc.getElementById('scr_console').classList.contains('on') && /&k=/.test(win.location.href));
  check('the session is open with here and ballot only', JSON.parse(row(code,'_open').value).join()==='here,ballot');
  check('the session carries its length', JSON.parse(row(code,'pub/cfg').value).m==='all' && !('f' in JSON.parse(row(code,'pub/cfg').value)) && !('i' in JSON.parse(row(code,'pub/cfg').value)));
  check('the facilitator link is remembered for seven days', !!JSON.parse(win.read('rp_host')||'null'));
  await until(()=>doc.getElementById('lobQ').textContent.length>0, 1000);
  check('the lobby shows the question and three ways in', doc.getElementById('lobQ').textContent==='How are you feeling about this change?' && doc.querySelectorAll('#joinWays .way').length===2 && !!doc.querySelector('#joinWays .way3'));
  check('the lobby has one primary', primaries(doc,'con_lobby')===1);
  const qr=doc.querySelector('#joinWays .qr').innerHTML;
  check('the lobby QR decodes to the join link', decodeMatrix(svgToMatrix(qr))===HOSTED+'?join='+code);
  check('the console never shows results before a reveal', !painted(win, doc.getElementById('con_rest')));

  const P=[];
  for (let i=0;i<6;i++) P.push(await phone(code));
  await until(()=>P.every(d=>view(d)==='wait'), 2000);
  check('phones wait with a word of welcome and no product name', P.every(d=>/You’re in!/.test(body(d))) && P[0].window.document.title!=='Room Pulse');
  check('each phone keeps its own id on the device and in its tab, never in the link', P.every(d=>!/[?&]me=/.test(d.window.location.href) && d.window.read('rp_me_'+code)===d.window.App.pid && d.window.sread('rp_tab_'+code)===d.window.App.pid && /^[a-z0-9]{6}$/.test(d.window.App.pid)) && new Set(P.map(d=>d.window.App.pid)).size===P.length);
  await until(()=>doc.getElementById('chipHere').textContent==='6', 2000);
  check('the chip counts phones that joined', doc.getElementById('chipHere').textContent==='6' && /joined/.test(doc.getElementById('chip').textContent));
  /* two tabs in one browser are two people; a tab reopened after closing is the same person */
  const me0=P[0].window.App.pid;
  const twin=await phone(code, '', {['rp_me_'+code]:me0}); await until(()=>view(twin)==='wait', 2000);
  check('a second tab in the same browser is a second person', twin.window.App.pid && twin.window.App.pid!==me0);
  const solo=await phone(code); const meS=solo.window.App.pid; await until(()=>view(solo)==='wait', 2000);
  solo.window.dispatchEvent(new solo.window.Event('pagehide')); solo.window.PAX.bc.close(); solo.window.close();
  const back=await phone(code, '', {['rp_me_'+code]:meS}); await until(()=>view(back)==='wait', 2000);
  check('a phone that reopens the link after closing it is the same person', back.window.App.pid===meS);
  await until(()=>doc.getElementById('chipHere').textContent==='8', 2000);
  back.window.dispatchEvent(new back.window.Event('pagehide')); back.window.PAX.bc.close(); back.window.close();
  twin.window.dispatchEvent(new twin.window.Event('pagehide')); twin.window.PAX.bc.close(); twin.window.close();
  await until(()=>doc.getElementById('chipHere').textContent==='6', 2000);
  const j=load(HOSTED+'?join', true); j.window.eval(fast); await sleep(40);
  type(j.window, j.window.document.getElementById('codeIn'), 'ZZZZ'); await sleep(80);
  check('a wrong code shakes and says so', /Nothing with those letters/.test(j.window.document.getElementById('joinMsg').textContent));
  type(j.window, j.window.document.getElementById('codeIn'), code.toLowerCase()); await until(()=>j.window.App.paxSig==='wait', 1500);
  check('typing the four letters joins', j.window.document.getElementById('scr_pax').classList.contains('on') && j.window.App.code===code);
  await until(()=>doc.getElementById('chipHere').textContent==='7', 2000);
  /* presence: a phone whose screen goes off stays counted; a closed page leaves at once */
  Object.defineProperty(j.window.document, 'visibilityState', {value:'hidden', configurable:true});
  j.window.document.dispatchEvent(new j.window.Event('visibilitychange'));
  await until(()=>JSON.parse((row(code,'here/'+j.window.App.pid)||{}).value||'0')===-2, 1500);
  await sleep(150);
  check('a phone whose screen goes off says it is asleep, and still counts as joined', JSON.parse(row(code,'here/'+j.window.App.pid).value)===-2 && doc.getElementById('chipHere').textContent==='7');
  j.window.dispatchEvent(new j.window.Event('pagehide'));
  await until(()=>doc.getElementById('chipHere').textContent==='6', 2000);
  check('a page that closes leaves the count at once', doc.getElementById('chipHere').textContent==='6');
  j.window.close();
  /* a console that reloads counts by the worker's clock: a phone silent for a minute is not counted again */
  const ghost=await phone(code); await until(()=>view(ghost)==='wait', 2000); clearInterval(ghost.window.App.hbTimer); ghost.window.App.role='gone';
  row(code,'here/'+ghost.window.App.pid).updated=Date.now()-60000;
  const re1=load(HOSTED+'?host='+code+'&k='+win.App.key, true); re1.window.eval(fast);
  await until(()=>re1.window.document.getElementById('chipHere').textContent==='6', 2000);
  check('a reloaded console does not count phones that went silent before it loaded', re1.window.document.getElementById('chipHere').textContent==='6' && re1.window.App.pres[ghost.window.App.pid]==='gone');
  re1.window.close(); ghost.window.close();

  click(win, doc.getElementById('btnOpen'));
  await until(()=>P.every(d=>view(d)==='warm'), 3000);
  check('phones hold on the question, then a warm-up pair', P.every(d=>/First, an easy one\./.test(body(d))) && P[0].window.document.querySelectorAll('[data-pick]').length===2);
  await until(()=>painted(win, doc.getElementById('con_open')), 1000);
  check('the console shows the question and one figure for the room\'s progress', painted(win, doc.getElementById('con_open')) && doc.getElementById('openQ').textContent==='How are you feeling about this change?' && painted(win, doc.getElementById('tally')) && !painted(win, doc.getElementById('chip')));
  check('the figure starts at nobody done, everyone still choosing', doc.getElementById('tDone').textContent==='0' && doc.getElementById('tIn').textContent==='6' && /6 still choosing/.test(doc.getElementById('tSub').textContent));
  check('the answering view has one primary, and it leads to a first look', primaries(doc,'con_open')===1 && doc.getElementById('btnReveal').textContent==='See the results');
  const ph=P[0], pw=ph.window;
  pw.paxPick(0); await sleep(10);
  check('the warm-up is not counted', (pw.App.picks[1]||'')==='' && view(ph)==='pair1:0');
  check('real pairs show the question and the instruction', /How are you feeling about this change\?/.test(body(ph)) && /Two words at a time/.test(body(ph)));
  check('a trail shows how many remain: one tick per pick', pw.document.querySelectorAll('#trail .tkr i').length===28 && /28 to go/.test(pw.document.getElementById('trail').textContent));
  const s0=pw.pairFor(1,0), cards=pw.document.querySelectorAll('[data-pick]');
  check('the cards are the scheduled pair, in order', cards[0].textContent===pw.cfgOf().words[s0[0]].w && cards[1].textContent===pw.cfgOf().words[s0[1]].w);
  click(pw, cards[1]); await sleep(10);
  check('a tap is the answer: winner then loser', pw.App.picks[1]===String(s0[1])+String(s0[0]) && view(ph)==='pair1:1');
  await sleep(90);
  check('the trail moves on: one tick done, 27 to go', pw.document.querySelectorAll('#trail .tkr i.done').length===1 && /27 to go/.test(pw.document.getElementById('trail').textContent));
  check('Back appears after a pick', painted(pw, pw.document.getElementById('btnUndo')));
  click(pw, pw.document.getElementById('btnUndo')); await sleep(10);
  check('Back takes the last pick away', (pw.App.picks[1]||'')==='' && view(ph)==='pair1:0');
  key(pw, pw.document, 'ArrowDown'); await sleep(10);
  check('arrow keys answer on a keyboard', pw.App.picks[1].length===2);
  await until(()=>{ const b=row(code,'ballot/'+pw.App.pid+'/1'); return b && JSON.parse(b.value).s.length===2; }, 1500);
  /* a pick waiting on the throttle is not lost when the page closes */
  pw.App.writeMs=60000; pw.App.lastWrite=Date.now();
  { pw.paxPick(0); await sleep(10); const want=pw.App.picks[1];
    pw.dispatchEvent(new pw.Event('pagehide'));
    await until(()=>{ const b=row(code,'ballot/'+pw.App.pid+'/1'); return b && JSON.parse(b.value).s===want; }, 1500);
    check('a waiting pick is written as the page closes', JSON.parse(row(code,'ballot/'+pw.App.pid+'/1').value).s===want);
    pw.App.writeMs=0; pw.beat(); }
  check('the ballot is one row per person per pulse', !!row(code,'ballot/'+pw.App.pid+'/1'));
  /* a reload mid-answer comes back to the same person and the next pair */
  const before=pw.App.picks[1], pid0=pw.App.pid;
  const re=load(HOSTED+'?join='+code+'&me='+pid0, true); re.window.eval(fast); await until(()=>/^pair1/.test(re.window.App.paxSig||''), 2000);
  check('a reload keeps the same person and picks up at the next pair', re.window.App.pid===pid0 && re.window.App.picks[1]===before && view(re)==='pair1:'+(before.length/2));
  re.window.close();
  for (let i=0;i<P.length-1;i++) await answerAll(P[i], i<4 ? 1 : -1);
  await until(()=>doc.getElementById('tDone').textContent==='5', 2000);
  /* the room's figure: done counts whoever finished, still choosing counts whoever is here and not done */
  check('the figure counts the finished and the still choosing, with no double count', doc.getElementById('tDone').textContent==='5' && doc.getElementById('tIn').textContent==='6' && /1 still choosing/.test(doc.getElementById('tSub').textContent) && win.tallyOf(win.App.state,1).frac<1);
  P[0].window.dispatchEvent(new P[0].window.Event('pagehide')); await sleep(200);
  check('someone who finished and closed the page still counts as done', doc.getElementById('tDone').textContent==='5' && doc.getElementById('tIn').textContent==='6');
  P[0].window.beat();
  await answerAll(P[5], -1);
  await until(()=>P.every(d=>/^done1/.test(view(d))), 2000);
  check('after the last pair, phones rest on "Got it."', P.every(d=>/Got it\./.test(body(d))));
  check('every ballot is complete and marked done', P.every(d=>d.window.App.picks[1].length===56 && d.window.App.done[1]));
  await until(()=>doc.getElementById('tDone').textContent==='6', 2000);
  check('everyone done fills the figure and says so', doc.getElementById('tDone').textContent==='6' && doc.getElementById('tally').classList.contains('full') && /Everyone’s done\./.test(doc.getElementById('tSub').textContent) && win.tallyOf(win.App.state,1).frac===1);

  /* ---------- the first look, then the reveal ---------- */
  const mir=load(HOSTED+'?host='+code+'&k='+win.App.key, true); mir.window.eval(fast); await sleep(120);
  click(win, doc.getElementById('btnReveal'));
  await until(()=>doc.getElementById('reveal').classList.contains('on'), 1000);
  check('See the results opens a private first look in this tab', painted(win, doc.getElementById('rvBack')) && !painted(win, doc.getElementById('rvStandby')) && !painted(win, doc.getElementById('rvSlide')));
  const fr=win.App.frozen[1];
  check('the first look shows the headline the room will see, and notes with their sources', doc.getElementById('bkHead').textContent.replace(/\s/g,'')===win.CORE.headline(fr.room, win.cfgOf().words).replace(/\s/g,'') && doc.querySelectorAll('#bkNotes .note').length>=3 && /Russell, 1980/.test(doc.getElementById('bkNotes').textContent) && /Nobody has to say where their dot is\./.test(doc.getElementById('bkNotes').textContent));
  check('the first look has one gold primary', primaries(doc,'rvBack')===1 && doc.getElementById('bkBegin').classList.contains('gold'));
  {
    /* the notes never claim more than the numbers: "most" means more than half, the left needs more than half, two rooms needs both sides */
    const W=win.cfgOf().words, Q=['TR','TL','BL','BR'], corner={TR:[1,1],TL:[-1,1],BL:[-1,-1],BR:[1,-1]}, bad=[];
    let sd=7; const rnd=()=>{ sd=(sd*1103515245+12345)%2147483648; return sd/2147483648; };
    const rooms=[[20,0,20,0],[10,5,5,0],[5,5,5,5],[6,0,6,0],[3,2,0,0]].map(c=>({TR:c[0],TL:c[1],BL:c[2],BR:c[3]}));
    for (let i=0;i<1500;i++){ const n=5+Math.floor(rnd()*60), w=Q.map(()=>rnd()*rnd()), t=w.reduce((a,b)=>a+b), r={TR:0,TL:0,BL:0,BR:0};
      for (let k=0;k<n;k++){ let u=rnd()*t, q='BR'; for (let j=0;j<4;j++){ if (u<w[j]){ q=Q[j]; break; } u-=w[j]; } r[q]++; } rooms.push(r); }
    rooms.forEach(r=>{
      const people=[]; Q.forEach(q=>{ for (let k=0;k<r[q];k++) people.push({ pid:'p'+people.length, x:corner[q][0]*(.1+.8*rnd()), y:corner[q][1]*(.1+.8*rnd()), m:rnd()<.15 }); });
      const n=people.length, box=doc.createElement('div'); box.innerHTML=win.notesHtml(1, { room:{n}, people }, null, W);
      const leads=Array.from(box.querySelectorAll('.note b')).map(b=>b.textContent), has=re=>leads.some(l=>re.test(l));
      const top=Math.max(...Q.map(q=>r[q]/n)), left=(r.TL+r.BL)/n, torn=people.filter(p=>p.m).length/n;
      if (has(/^Most of the room/) && !(top>.5)) bad.push('most');
      if (has(/starts on the left/) && !(left>.5)) bad.push('left');
      if (has(/^Two rooms/) && !(left>=.3 && 1-left>=.3)) bad.push('two');
      if (has(/^Many people are torn/) && !(torn>=.3)) bad.push('torn');
      if (has(/^No shared mood/) && !(top<.35)) bad.push('spread');
    });
    check('the notes never claim more than the numbers, across 1,505 rooms including exact halves', bad.length===0);
  }
  const late=await phone(code);
  await until(()=>P.every(d=>/^locked/.test(view(d))) && /^locked/.test(view(late)), 2000);
  check('during the first look every phone is locked, late arrivals included', P.every(d=>/Locked in\./.test(body(d))) && /Locked in\./.test(body(late)));
  await until(()=>mir.window.App.rvOpen && mir.window.App.rvStandby, 2000);
  check('a second facilitator tab (the projector) shows the standby, never the notes', mir.window.document.getElementById('reveal').classList.contains('on') && painted(mir.window, mir.window.document.getElementById('rvStandby')) && !painted(mir.window, mir.window.document.getElementById('rvBack')));
  click(win, doc.getElementById('bkRoom'));
  check('Hide notes turns this tab into the standby, and remembers', painted(win, doc.getElementById('rvStandby')) && !painted(win, doc.getElementById('rvBack')) && win.read('rp_bk')==='room' && painted(win, doc.getElementById('rvNotes')));
  click(win, doc.getElementById('rvNotes'));
  check('Notes brings the first look back', painted(win, doc.getElementById('rvBack')) && win.read('rp_bk')==='notes');
  click(win, doc.getElementById('bkBackOpen'));
  await until(()=>P.every(d=>/^done1/.test(view(d))) && !doc.getElementById('reveal').classList.contains('on'), 2000);
  check('Reopen answers goes back to answering and unlocks phones', painted(win, doc.getElementById('con_open')) && P.every(d=>/^done1/.test(view(d))));
  click(win, doc.getElementById('btnReveal')); await until(()=>win.App.rvBack, 1000);
  const preview=JSON.stringify(win.App.frozen[1].room);
  click(win, doc.getElementById('bkBegin'));
  await until(()=>doc.getElementById('rvHead').textContent.length>0, 2000);
  const head=doc.getElementById('rvHead').textContent;
  const res=win.resultsOf(1);
  check('the read is written: one summary row and the people in chunks', !!res && res.people.length===6 && res.room.n===6 && !!row(code,'res/1/0'));
  check('what the room sees is exactly what the first look showed', JSON.stringify({n:res.room.n,c:res.room.c,m:res.room.m,mp:res.room.mp})===JSON.stringify(JSON.parse(preview)));
  check('the headline is the core headline for these counts, and starts with the room', head.replace(/\s/g,'')===win.CORE.headline(res.room, win.cfgOf().words).replace(/\s/g,'') && /^The room/.test(head));
  check('the headline sets one sentence per line, the words it names in colour', doc.getElementById('rvHead').children.length===win.CORE.headline(res.room, win.cfgOf().words).split('. ').length && !!doc.querySelector('#rvHead .hw'));
  check('the map carries every word and the four corners', doc.querySelectorAll('#rvMap .w').length===8 && doc.querySelectorAll('#rvMap .qd').length===4 && Array.from(doc.querySelectorAll('#rvMap .w')).some(w=>+w.style.fontWeight>600));
  check('the map has a text label for screen readers', /near/.test(doc.getElementById('rvMap').getAttribute('aria-label')));
  check('people results hold no names, only random ids and spots', res.people.every(p=>/^[a-z0-9]{6}$/.test(p.pid)));
  await until(()=>mir.window.App.rvOpen && !mir.window.App.rvStandby, 2000);
  check('the projector tab plays the read when it begins', mir.window.document.getElementById('rvHead').textContent.length>0);
  await until(()=>P.every(d=>/^result1/.test(view(d))), 2000);
  const lines=P.map(d=>d.window.document.getElementById('myLine').textContent);
  check('each phone says what that person expressed, never what they are', lines.every(l=>/^You’ve expressed feeling /.test(l)) && lines.every(l=>!/You’re (one|the only|between|near)/.test(l)));
  check('each phone headline says what the room is', P.every(d=>/^The room/.test(d.window.document.getElementById('myHead').textContent)));
  const mine=P[0].window.resultsOf(1).people.find(p=>p.pid===P[0].window.App.pid);
  check('the line names this person\'s own word', lines[0].indexOf(P[0].window.cfgOf().words[mine.h].w.toLowerCase())>-1);
  check('a late arrival who did not answer sits it out', /sat this one out/.test(late.window.document.getElementById('myLine').textContent));
  check('the reveal surface has one primary', primaries(doc,'reveal')<=1);
  click(win, doc.getElementById('rvDone'));
  await until(()=>painted(win, doc.getElementById('con_rest')), 1500);
  check('Done lands on the read at rest, with the next pulse as the primary', !doc.getElementById('reveal').classList.contains('on') && painted(win, doc.getElementById('btnAgain')) && primaries(doc,'con_rest')===1 && painted(win, doc.getElementById('chip')));
  await until(()=>!mir.window.App.rvOpen, 2000);
  check('the projector tab closes with it', !mir.window.document.getElementById('reveal').classList.contains('on'));
  const seen0=P[1].window.App.seenShow;
  click(win, doc.getElementById('btnReplay')); await until(()=>win.App.rvStandby, 1000);
  await sleep(150);
  check('a replay waits on the standby, and phones keep their result meanwhile', painted(win, doc.getElementById('rvStandby')) && /^result1/.test(view(P[1])));
  click(win, doc.getElementById('rvBegin')); await until(()=>P[1].window.App.seenShow!==seen0, 2000);
  check('phones play the read again on a replay', P[1].window.App.seenShow!==seen0);
  check('a replay does not rewrite the results', win.resultsOf(1).sig===res.sig);
  click(win, doc.getElementById('rvDone')); await until(()=>painted(win, doc.getElementById('con_rest')), 1500);

  /* ---------- the second pulse and the shift ---------- */
  click(win, doc.getElementById('btnAgain'));
  await until(()=>P.every(d=>/^(hold2|pair2)/.test(view(d))), 2000);
  check('the second pulse opens with "Once more." and no warm-up', P.some(d=>/Once more\./.test(body(d))) || P.every(d=>/^pair2/.test(view(d))));
  check('the console says once more, to the room', painted(win, doc.getElementById('openPre')) && doc.getElementById('btnReveal').textContent==='See the shift');
  await until(()=>P.every(d=>/^pair2/.test(view(d))), 2000);
  check('the first answer is not shown before the second', P.every(d=>!d.window.document.getElementById('myMap')));
  const newbie=await phone(code); await until(()=>view(newbie)==='warm', 2000);
  check('a newcomer at the second pulse gets the warm-up, not "Once more."', view(newbie)==='warm' && !/Once more/.test(body(newbie)));
  await answerAll(newbie, 1); await until(()=>/^done2/.test(view(newbie)), 2000);
  for (let i=0;i<P.length;i++) await answerAll(P[i], i<2 ? -1 : 1);
  await until(()=>P.every(d=>/^done2/.test(view(d))), 2000);
  check('the second done says what comes next', /how the room moved/.test(body(P[0])));
  click(win, doc.getElementById('btnReveal')); await until(()=>win.App.rvBack, 1000);
  check('the second first look talks about movement', /How the room moved, just for you\./.test(doc.getElementById('bkTitle').textContent) && /ghost hills/.test(doc.getElementById('bkNotes').textContent) && doc.getElementById('bkBegin').textContent==='Show the shift');
  click(win, doc.getElementById('bkBegin'));
  await until(()=>!!win.resultsOf(2), 2000); await sleep(60);
  const r2=win.resultsOf(2);
  check('the shift headline is written with the second read', !!r2 && r2.sh===win.CORE.shiftHeadline(win.resultsOf(1).room, r2.room, win.cfgOf().words, win.CORE.flowsOf(win.resultsOf(1).people, r2.people, 8)) && /^The room is/.test(r2.sh));
  await until(()=>P.every(d=>/^result2/.test(view(d))), 2000);
  const l2=P.map(d=>d.window.document.getElementById('myLine').textContent);
  check('each phone says how that person moved, or that they expressed the same again', l2.every(l=>/^You’ve (moved from|expressed feeling)/.test(l)));
  await until(()=>/^result2/.test(view(newbie)), 2000);
  check('a newcomer sees what they expressed', /^You’ve expressed feeling .*\.$/.test(newbie.window.document.getElementById('myLine').textContent));
  check('people who switched sides hear that they moved', /You’ve moved from/.test(l2[0]) || /between/.test(l2[0]));
  check('the same person is matched across both pulses', P.every(d=>d.window.resultsOf(1).people.some(p=>p.pid===d.window.App.pid) && d.window.resultsOf(2).people.some(p=>p.pid===d.window.App.pid)));
  click(win, doc.getElementById('rvDone'));
  await until(()=>painted(win, doc.getElementById('con_rest')) && painted(win, doc.getElementById('restSeg')), 1500);
  check('the rest view after the shift toggles before and after, with no next pulse', painted(win, doc.getElementById('restSeg')) && !painted(win, doc.getElementById('btnAgain')));
  click(win, doc.getElementById('segBefore'));
  check('"When they arrived" shows the first headline', doc.getElementById('restHead').textContent.replace(/\s/g,'')===win.resultsOf(1).head.replace(/\s/g,''));
  click(win, doc.getElementById('segAfter'));
  check('"Before they left" shows the shift', doc.getElementById('restHead').textContent.replace(/\s/g,'')===(r2.sh||r2.head).replace(/\s/g,''));
  /* the download: a page to read, data to load again, every pick, no ids */
  const rep=win.buildReport();
  check('the results download holds both reads, the counts and every pick', /When they arrived/.test(rep) && /Before they left/.test(rep) && /<table>/.test(rep) && /room-pulse-picks-/.test(rep));
  check('the download carries no participant ids', P.every(d=>rep.indexOf(d.window.App.pid)===-1));
  check('the download is noindex and has no em dashes', /noindex/.test(rep) && !/—/.test(rep));
  const fc=win.focusCheck(win.App.state,1);
  check('the download replays Focused on the room\'s own every-pair answers', !!fc && fc.n===6 && fc.same>=4 && /Focused check\./.test(rep) && /finds the same top word for \d+ of 13 completed answers/.test(rep));
  const data=win.parseResults(rep);
  check('the download carries its data, which Room Pulse can read back', !!data && data.pulses.length===2 && data.words.length===8 && data.pulses[0].people.length===6 && data.pulses[1].people.every(q=>q.length===6));
  check('the same person has the same number in both pulses of a download', data.pulses[0].people.map(q=>q[0]).filter(id=>data.pulses[1].people.some(q=>q[0]===id)).length===6);

  /* ---------- over time: saved results, played in order, nothing sent anywhere ---------- */
  {
    const t=load(HOSTED+'?time', false), tw=t.window, td=tw.document; await sleep(40);
    check('the over-time page opens from its own link', td.getElementById('scr_time').classList.contains('on'));
    const notes=[];
    tw.addSaved(rep, 'week1.html', notes);
    const later=rep.replace(/"at":(\d+)/, (m,a)=>'"at":'+(+a+7*864e5)).replace(/"date":"[^"]*"/, '"date":"2026-10-09"');
    tw.addSaved(later, 'week2.html', notes);
    tw.addSaved(rep, 'again.html', notes);
    tw.addSaved('<html>nothing</html>', 'other.html', notes);
    const otherWords=rep.replace('"Excited"', '"Thrilled"');
    tw.addSaved(otherWords.replace(/"at":(\d+)/, (m,a)=>'"at":'+(+a+14*864e5)), 'w3.html', notes);
    tw.renderTimeList();
    check('two saved sessions become four pulses, in date order, each with a plain name', tw.TM.snaps.length===4 && tw.TM.snaps[0].at<tw.TM.snaps[2].at && /when they arrived/.test(tw.TM.snaps[0].label) && /before they left/.test(tw.TM.snaps[1].label));
    check('the same file twice is added once; other files and other words are refused, with a reason', notes.length===2 && notes.some(n=>/not a Room Pulse results file/.test(n)) && notes.some(n=>/different words/.test(n)));
    check('people are matched within a session, never across two', tw.TM.snaps[0].people[0].pid.split(':')[0]===tw.TM.snaps[1].people[0].pid.split(':')[0] && tw.TM.snaps[0].people[0].pid.split(':')[0]!==tw.TM.snaps[2].people[0].pid.split(':')[0]);
    click(tw, td.getElementById('tmPlay'));
    check('Play shows the first pulse with its headline and the line of pulses below', td.getElementById('tmPlayer').classList.contains('on') && /^The room/.test(td.getElementById('tmHead').textContent) && td.querySelectorAll('#tmLine button').length===4 && td.querySelector('#tmLine button.on').getAttribute('data-k')==='0');
    click(tw, td.getElementById('tmNext'));
    check('Next plays the move to the next pulse, headline included', td.querySelector('#tmLine button.on').getAttribute('data-k')==='1' && /^The room/.test(td.getElementById('tmHead').textContent));
    click(tw, td.querySelector('#tmLine [data-k="3"]'));
    check('any pulse can be jumped to', tw.TM.i===3 && td.getElementById('tmNext').disabled===true);
    key(tw, td, 'Escape');
    check('Escape leaves the player', !td.getElementById('tmPlayer').classList.contains('on'));
    const set=[]; tw.Blob=function(parts){ set.push(parts.join('')); }; tw.downloadSet();
    const back=tw.parseResults(set[0]||'');
    check('a set downloads as one file that loads back the same pulses and names', !!back && back.set===true && back.snaps.length===4 && back.snaps[1].label===tw.TM.snaps[1].label);
    t.window.close();
  }

  /* ---------- a small room shows hills only ---------- */
  {
    const v=new win.MapView(doc.createElement('div'), {});
    const few=res.people.slice(0,3); const sc=win.revealScene(v, {words:win.cfgOf().words, people:few, room:win.roomOf(few,8), seed:'x'}, {}); sc.end();
    check('fewer than five people: no dots, only the terrain', v.dots.length===0 && v.layers.length===1);
    const sh=win.shiftScene(v, {words:win.cfgOf().words, A:few, B:few, ra:win.roomOf(few,8), rb:win.roomOf(few,8)}, {}); sh.end();
    check('and no paths to follow in the shift', v.dots.length===0 && v.trails===null && v.arrow===null);
  }

  /* ---------- a Focused session, live ---------- */
  {
    const d=load(HOSTED, true), w=d.window, dd=w.document; w.eval(fast); await sleep(30);
    const c2=await launch(w, dd, 'focus');
    await until(()=>w.App.state && w.App.state.pub && w.App.state.pub.cfg, 2000);
    check('a Focused session says so in its settings', JSON.parse(row(c2,'pub/cfg').value).m==='focus');
    const f=await phone(c2), g=await phone(c2); await until(()=>view(f)==='wait' && view(g)==='wait', 1500);
    click(w, dd.getElementById('btnOpen')); await until(()=>view(f)==='warm' && view(g)==='warm', 2000);
    f.window.paxPick(0); await sleep(20);
    check('a Focused trail has 10 ticks, with a gap after the opposites', f.window.document.querySelectorAll('#trail .tkr i').length===10 && /10 to go/.test(f.window.document.getElementById('trail').textContent));
    await answerAll(f, 1); await answerAll(g, -1);
    await until(()=>/^done1/.test(view(f)) && /^done1/.test(view(g)), 3000);
    const pf=w.CORE.parse(f.window.App.picks[1]);
    check('a Focused run ends after 10 picks, the close calls among the words that won', pf.length===10 && pf.slice(4).every(p=>pf.slice(0,4).some(q=>q[0]===p[0]) && pf.slice(0,4).some(q=>q[0]===p[1])));
    const fw=w.cfgOf().words, top=w.CORE.score(pf,8).top;
    check('someone leaning pleasant lands on a pleasant word', fw[top].x>0);
    await until(()=>dd.getElementById('tDone').textContent==='2', 2000);
    check('the figure counts Focused runs as done', dd.getElementById('tDone').textContent==='2' && dd.getElementById('tally').classList.contains('full'));
    [f,g].forEach(x=>x.window.close()); d.window.close();
  }

  /* ---------- end, with undo ---------- */
  click(win, doc.getElementById('btnEnd'));
  check('End shows the undo card at once, with the results still to download', painted(win, doc.getElementById('endLive')) && painted(win, doc.getElementById('con_ended')) && painted(win, doc.querySelector('#endLive .endDl')));
  click(win, doc.getElementById('btnUndoEnd')); await sleep(200);
  check('Undo keeps the session', !!row(code,'pub/meta') && painted(win, doc.getElementById('con_rest')));
  click(win, doc.getElementById('btnEnd')); await sleep(400);
  check('End deletes the session after the undo window', ![...env.DB._rows.keys()].some(k=>k.startsWith('room-pulse:'+code+'|')) && painted(win, doc.getElementById('endDone')) && painted(win, doc.querySelector('#endDone .endDl')));
  check('the results can still be downloaded from memory after the session is gone', /When they arrived/.test(win.buildReport()));
  await until(()=>view(P[0])==='ended', 2000);
  check('phones say goodbye when the session ends', /That’s all, folks\./.test(body(P[0])) && /ExperiencePoint\.com/.test(body(P[0])));
  check('the facilitator link is forgotten', !win.read('rp_host'));

  /* ---------- gates ---------- */
  {
    const g=load(HOSTED+'?host='+code+'&k=whatever123', true); await sleep(120);
    check('an ended session shows a plain dead end', /This session is over\./.test(g.window.document.getElementById('gateHead').textContent));
    const d=load(HOSTED, true); d.window.eval(fast); await sleep(20);
    const c3=await launch(d.window, d.window.document);
    const bad=load(HOSTED+'?host='+c3+'&k=wrongwrongwrong1', true); await sleep(150);
    check('a wrong facilitator key is refused, with a way forward', /needs a hand/.test(bad.window.document.getElementById('gateHead').textContent) && /four-letter code/.test(bad.window.document.getElementById('gateMsg').textContent));
    const q=await phone(c3); await until(()=>view(q)==='wait', 1500);
    click(d.window, d.window.document.getElementById('btnOpen')); await until(()=>view(q)==='warm', 2000);
    click(d.window, d.window.document.getElementById('btnReveal')); await until(()=>/^locked/.test(view(q)), 2000);
    /* a reload of the driving tab during the first look lands back on it */
    const again=load(HOSTED+'?host='+c3+'&k='+d.window.App.key, true); again.window.eval(fast); again.window.store('rp_bk','notes');
    await until(()=>again.window.App.rvOpen, 2000);
    check('a reloaded facilitator tab lands back on the first look', again.window.App.rvBack===true && painted(again.window, again.window.document.getElementById('rvBack')));
    again.window.close();
    key(d.window, d.window.document, 'Escape'); await until(()=>view(q)==='warm', 2000);
    check('Escape on the first look goes back to answering and unlocks phones', !d.window.document.getElementById('reveal').classList.contains('on') && view(q)==='warm' && painted(d.window, d.window.document.getElementById('con_open')));
    const st=load(HOSTED, true); await sleep(40); st.window.store('rp_host', JSON.stringify({code:c3, k:d.window.App.key, at:Date.now()})); st.window.renderResume(); await sleep(80);
    check('the studio offers a way back to the live session', painted(st.window, st.window.document.getElementById('resumeBar')) && st.window.document.getElementById('resumeCode').textContent===c3);
    [g,d,bad,q,st].forEach(x=>x.window.close());
  }

  /* ---------- a session started before this round keeps working ---------- */
  {
    const d=load(HOSTED, true), w=d.window, dd=w.document; w.eval(fast); await sleep(30);
    const c4=await launch(w, dd);
    await w.Net.set('pub/cfg', {q:'Old?', i:'Old line', w:words8.map(x=>[x.w,x.x,x.y]), r:3, f:120, wu:0});
    const o=await phone(c4); await until(()=>view(o)==='wait', 1500);
    click(w, dd.getElementById('btnOpen')); await until(()=>view(o)==='warm', 2000);
    await answerAll(o, 1); await until(()=>/^done1/.test(view(o)), 2000);
    check('an older session (three rounds, a fuse) runs its 12 picks with no fuse', o.window.App.picks[1].length===24 && !o.window.document.getElementById('fuse'));
    [o,d].forEach(x=>x.window.close());
  }

  /* ---------- text extremes ---------- */
  {
    const d=load(HOSTED, false), w=d.window, dd=w.document; await sleep(20);
    click(w, dd.getElementById('btnBuild')); click(w, dd.getElementById('qmFull'));
    type(w, dd.getElementById('qFull'), 'Q'.repeat(200));
    check('the question is capped at 90 characters', w.questionOf(w.STUDIO.setup).length<=90 || dd.getElementById('qFull').maxLength===90);
    click(w, dd.getElementById('next1'));
    type(w, dd.getElementById('wAdd'), 'W'.repeat(30)); click(w, dd.getElementById('wAddBtn'));
    check('a word is capped at 18 characters', w.STUDIO.setup.words[8].w.length===18);
    check('words wrap rather than overflow on a card', /\.card\{[^}]*overflow-wrap:anywhere/.test(html) && /\.pq\{[^}]*overflow-wrap:anywhere/.test(html) && /\.head\{[^}]*overflow-wrap:anywhere/.test(html));
    d.window.close();
  }

  /* ---------- test drive: pretend people arrive, answer, two wander off ---------- */
  {
    const d=load(HOSTED, false), w=d.window, dd=w.document; w.eval(fast+' App.botPick=function(){return 4;}; App.botJoin=function(){return 10;};'); await sleep(20);
    click(w, dd.getElementById('btnBuild')); type(w, dd.getElementById('qBlank'), 'AI');
    click(w, dd.getElementById('next1')); click(w, dd.getElementById('next2')); click(w, dd.getElementById('next3'));
    click(w, dd.getElementById('btnTestDrive'));
    await until(()=>dd.getElementById('chipHere').textContent==='18', 3000);
    check('test drive: pretend people join on their own, and the bar says how many', dd.getElementById('chipHere').textContent==='18' && painted(w, dd.getElementById('simBarC')) && /18 pretend people/.test(dd.getElementById('simTxtC').textContent));
    click(w, dd.getElementById('btnOpen'));
    await until(()=>dd.getElementById('tDone').textContent==='18', 8000);
    check('test drive: pretend people answer at their own pace', dd.getElementById('tDone').textContent==='18' && dd.getElementById('tIn').textContent==='18');
    await until(()=>w.App.hereN===16, 6000);
    check('test drive: two wander off; finished people still count as done', w.App.hereN===16 && dd.getElementById('tDone').textContent==='18');
    click(w, dd.getElementById('btnReveal')); await until(()=>w.App.rvBack, 1000);
    check('test drive: the first look shows notes too', painted(w, dd.getElementById('rvBack')) && dd.querySelectorAll('#bkNotes .note').length>=3);
    click(w, dd.getElementById('bkBegin'));
    await until(()=>dd.getElementById('rvHead').textContent.length>0, 2000);
    check('test drive: the read plays with nothing sent anywhere', w.resultsOf(1).room.n===18 && !w.App.state.res[1][0].includes('youpax'));
    click(w, dd.getElementById('rvDone')); await sleep(80);
    click(w, dd.getElementById('segPax')); await until(()=>/^result1/.test(w.App.paxSig||''), 2000);
    check('test drive: the participant view shows the read on a phone', /sat this one out/.test(dd.getElementById('myLine').textContent));
    click(w, dd.getElementById('segCon2')); await sleep(60);
    click(w, dd.getElementById('btnSimExit'));
    check('exit test drive returns to the review step with the setup intact', dd.getElementById('scr_studio').classList.contains('on') && stepOn(dd)==='st4' && w.STUDIO.setup.blank==='AI');
    w.App.botN=4; click(w, dd.getElementById('btnTestDrive'));
    await until(()=>dd.getElementById('chipHere').textContent==='4', 3000);
    check('test drive: a room of four is four pretend people', dd.getElementById('chipHere').textContent==='4' && /4 pretend people/.test(dd.getElementById('simTxtC').textContent));
    click(w, dd.getElementById('btnSimExit'));
    d.window.close();
  }

  check('no page errors along the way', errors.length===0);
  if (errors.length) console.log(errors.slice(0,5));
  P.forEach(d=>d.window.close()); late.window.close(); newbie.window.close(); mir.window.close(); win.close();
  console.log(failures===0?'\nALL CHECKS PASSED':'\n'+failures+' FAILURES');
  process.exit(failures===0?0:1);
})();
