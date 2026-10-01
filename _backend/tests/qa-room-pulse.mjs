/* qa-room-pulse.mjs: jsdom harness for field-tools/room-pulse/index.html.
   Runs the studio, the console and several phones against the real pt worker code (fake database),
   checks the scoring and placement math directly, and decodes the lobby QR with jsQR.
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
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; const req = new Request(String(url), { method:init.method||'GET', headers:init.headers||{}, body:init.body }); return worker.fetch(req, env); }; }
function load(url, live){
  return new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){
    if (live) mockFetch(window);
    window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
    window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } });
    window.HTMLCanvasElement.prototype.getContext = () => null;
    window.addEventListener('error', e => errors.push(String(e.message)));
  } });
}
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, el, k){ el.dispatchEvent(new win.KeyboardEvent('keydown', { key:k, bubbles:true })); }
function painted(win, el){ if (!el) return false; let n=el; while (n && n.nodeType===1){ if (win.getComputedStyle(n).display==='none') return false; n=n.parentNode; } return true; }
function primaries(doc, id){ const root=doc.getElementById(id); return Array.from(root.querySelectorAll('.btn')).filter(b=>!b.classList.contains('sec') && !b.classList.contains('ghost') && !b.classList.contains('hide') && !b.closest('.hide')).length; }
function stepOn(doc){ return Array.from(doc.querySelectorAll('.step')).find(s => s.classList.contains('on')).id; }
const fast = 'App.conPollMs=40; App.paxBase=40; App.frostMs=0; App.anim=false; App.holdMin=0; App.holdMax=0; App.lockMs=0; App.writeMs=0; App.endDelay=120; App.hbMs=60000;';
async function phone(code, extra){ const d=load(HOSTED+'?join='+code+(extra||''), true); d.window.eval(fast); await sleep(60); return d; }
function view(d){ return d.window.App.paxSig; }
function body(d){ return d.window.document.getElementById('paxBody').textContent; }
/* answer every pair on a phone: biased toward pleasant words when lean>0, unpleasant when lean<0 */
async function answerAll(d, lean, limit){
  const w=d.window; let n=0;
  for (let i=0;i<200;i++){
    const v=w.paxViewOf();
    if (v.v==='hold'){ await sleep(10); continue; }
    if (v.v!=='warm' && v.v!=='pair') break;
    let pick=0;
    if (v.v==='pair'){ const s=w.seqFor(v.p)[v.k], W=w.cfgOf().words; pick = (W[s[0]].x*lean >= W[s[1]].x*lean) ? 0 : 1; n++; }
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
  const rawStorage = js.replace(/function store\(k,v\)\{ try\{ localStorage\.setItem\(k,v\); \}catch\(e\)\{\} \}/,'').replace(/function read\(k\)\{ try\{ return localStorage\.getItem\(k\); \}catch\(e\)\{ return null; \} \}/,'').replace(/function unstore\(k\)\{ try\{ localStorage\.removeItem\(k\); \}catch\(e\)\{\} \}/,'');
  check('local storage is only touched through the guarded helpers', !/localStorage|sessionStorage/.test(rawStorage));
  check('one font family, Archivo, from Google Fonts', /family=Archivo:/.test(html) && !/Montserrat/.test(html));
  check('no step captions, no copyright line', !/Step \d of/.test(html) && !/©|copyright/i.test(noscript));
  check('participants have no forward controls', !/data-act="next"|>Skip<|>Begin<|>Finish</.test(js));
  check('standby copy is the orb, the line and the gold button', /id="rvStandby"><div class="orb"><\/div><h1>Enough suspense\.<\/h1><button class="btn big gold" id="rvBegin">Show the room<\/button>/.test(html));
  check('participant beat copy is present', /re in!/.test(js) && /First, an easy one\./.test(js) && /Got it\./.test(js) && /Now we wait for the room\./.test(js) && /Locked in\./.test(js) && /Once more\./.test(js) && /s all, folks\./.test(js) && /s up\./.test(js));
  check('the default note says why the eight are a good start', /two in each corner of the feelings map, so no answer gets a nudge/.test(js));
  check('console controls are a bar that stays in view', /\.con \.controls\{position:sticky;bottom:0/.test(html));
  check('sound unlocks on every gesture and when the tab returns', /\['pointerdown','touchend','keydown'\]/.test(js) && /visibilitychange/.test(js));
  check('the waiting toy takes touch as a fallback and fades under the words', /addEventListener\('touchstart'/.test(js) && /destination-out/.test(js));
  check('reduced motion stops animation and hides the toy', /prefers-reduced-motion:reduce\)\{\*\{animation:none !important;transition:none !important;\}.*#idle\{display:none;\}/.test(html));
  check('a closing page says goodbye with a plain-text keepalive', /keepalive:true/.test(js) && /text\/plain/.test(js) && /'pagehide'/.test(js));
  const shortJoin=fs.readFileSync(path.join(here, '../../pulse/index.html'), 'utf8');
  check('the short address pt/pulse forwards to this join screen and carries the code', /location\.replace\('\/pt\/field-tools\/room-pulse\/\?join'\+\(c\?'='\+c\.toUpperCase\(\):''\)\)/.test(shortJoin) && /noindex/.test(shortJoin) && /JOIN_SHORT = 'ep\.github\.io\/pt\/pulse'/.test(js));
  check('canvases are sized by layout, not by the painted box', /var w=cv\.clientWidth, h=cv\.clientHeight/.test(js));

  /* ---------- the core: schedule, scoring, placement, headlines ---------- */
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
    check('every pair is covered by a full run (28 for eight words)', new Set(C.sequence(8,7,'z').map(p=>Math.min(...p)+'-'+Math.max(...p))).size===28);
    check('odd word counts sit one word out per round', C.maxRounds(7)===7 && C.sequence(7,7,'q').length===21 && C.maxRounds(9)===9);
    check('each person gets their own order, the same again on reload', JSON.stringify(C.sequence(8,7,'a:1'))===JSON.stringify(C.sequence(8,7,'a:1')) && JSON.stringify(C.sequence(8,7,'a:1'))!==JSON.stringify(C.sequence(8,7,'b:1')));
    let topFirst=0; for (let t=0;t<400;t++){ const s=C.sequence(8,7,'s'+t); s.forEach(p=>{ if (p[0]<p[1]) topFirst++; }); }
    check('which word sits on top is shuffled', topFirst>400*28*.4 && topFirst<400*28*.6);
    check('length options: quick, steady, every pair', JSON.stringify(win.lengthOptions(8))==='[3,5,7]' && JSON.stringify(win.lengthOptions(4))==='[3]' && JSON.stringify(win.lengthOptions(10))==='[3,5,9]');
    check('default length is every pair up to 30 picks, else five rounds', win.defaultRounds(8)===7 && win.defaultRounds(10)===5);
  }
  {
    /* the scoring note's example: one point per pick, wins out of times shown */
    const all=C.rounds(8).flat();
    const order=[0,1,2,3,4,5,6,7];
    let s=''; all.forEach(p=>{ const w = order.indexOf(p[0])<order.indexOf(p[1]) ? p[0] : p[1]; s+=w+''+(w===p[0]?p[1]:p[0]); });
    let sc=C.score(C.parse(s),8);
    check('a clear order scores 7, 6, 5 ... and the top word is home', sc.wins.join()==='7,6,5,4,3,2,1,0' && sc.top===0 && sc.sec===1 && !sc.mixed);
    /* Excited and Anxious both win six and met head to head: a real split, kept.
       Excited beats Anxious but loses to Curious; Anxious loses only to Excited. */
    let u=''; all.forEach(p=>{ const a=p[0], b=p[1], has=(x,y)=>(a===x&&b===y)||(a===y&&b===x); let w;
      if (has(0,4)) w=0; else if (has(0,1)) w=1; else if (a===4||b===4) w=4; else if (a===0||b===0) w=0; else if (has(1,2)) w=2; else if (has(1,3)) w=3; else w=Math.min(a,b);
      u+=w+''+(w===a?b:a); });
    sc=C.score(C.parse(u),8);
    check('a tie at the top between words that met stays mixed', sc.wins[0]===6 && sc.wins[4]===6 && sc.mixed===true);
    /* two words that never met tie on wins: ordered by who they beat, not mixed */
    sc=C.score(C.parse('01'+'23'+'31'),8);
    check('a tie between words that never met is a lean, ordered by who they beat', !sc.mixed && sc.top===2 && sc.sec===0);
    sc=C.score(C.parse('01'+'23'+'45'+'67'),8);
    check('and when nothing can separate them, it stays a split', sc.mixed);
    check('6 of 7 reads as wins out of times shown, not a share of a person', Math.abs(C.score(C.parse(u),8).rate[0]-6/7)<1e-9);
  }
  {
    let honest=true, close=true, between=true;
    for (let t=0;t<300;t++){
      const picks=C.parse(win.botPicks([{x:.5,y:.4}], 3+t%5, words8, 1+t%7, 'h'+t)); if (picks.length<4) continue;
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
    const W=['Excited','Curious','Confident','Calm','Anxious','Frustrated','Discouraged','Indifferent'].map(w=>({w}));
    check('numbers match words: 13 of 32 is many, never most', C.headline({n:32,c:[3,13,2,1,7,0,4,2],m:0},W)==='Many curious. Some anxious. A few discouraged.');
    check('more than half is mostly', /^Mostly curious\./.test(C.headline({n:32,c:[3,17,2,1,5,0,2,0],m:2},W)));
    check('a small room gets words without counts', C.headline({n:3,c:[1,0,0,0,1,0,0,0],m:1},W)==='Excited. Anxious.');
    check('a thin spread says so', /^All over the map\./.test(C.headline({n:20,c:[3,3,3,2,3,2,2,1],m:1},W)));
    check('two neighbouring words splitting one cluster is not a spread', !/All over/.test(C.headline({n:18,c:[4,4,3,0,3,0,1,0],m:3},W)));
    check('in between names the two words when one pair holds most of them', /Some between excited and anxious\./.test(C.headline({n:20,c:[2,9,0,0,3,0,0,0],m:6,mp:{a:0,b:4,n:4}},W)));
    const A={n:32,c:[3,9,2,1,10,3,2,2],m:0};
    check('the shift names what fell and what rose', C.shiftHeadline(A,{n:30,c:[8,9,6,2,3,1,1,0],m:0},W)==='Less anxious. More excited. Many curious.');
    check('a shift that barely moved says so', C.shiftHeadline(A,{n:32,c:[3,9,2,1,10,3,2,2],m:0},W)==='Much the same. Still many anxious.');
    check('the shift never names the same word twice', !/Still some curious/.test(C.shiftHeadline({n:30,c:[2,14,6,1,4,1,1,1],m:0},{n:30,c:[2,9,5,6,4,1,2,1],m:0},W)));
    check('typed capitals inside a word are kept', C.low('AI-curious')==='AI-curious' && C.low('Curious')==='curious');
  }

  /* ---------- studio ---------- */
  check('studio opens on the hero with steps hidden', stepOn(doc)==='st0' && doc.getElementById('steps').classList.contains('hide'));
  check('hero has exactly one primary', primaries(doc,'st0')===1);
  click(win, doc.getElementById('btnBuild'));
  check('step 1 is the question, with a phone preview', stepOn(doc)==='st1' && doc.querySelectorAll('#steps i').length===4 && doc.getElementById('pvQ').textContent==='How are you feeling about this change?');
  click(win, doc.getElementById('next1'));
  check('Next with an empty blank stays and asks for it', stepOn(doc)==='st1' && /Fill in the blank/.test(doc.getElementById('qNote').textContent));
  click(win, doc.querySelector('[data-try="AI"]'));
  check('a suggestion fills the blank and the preview', doc.getElementById('qBlank').value==='AI' && doc.getElementById('pvQ').textContent==='How are you feeling about AI?');
  click(win, doc.getElementById('qRewrite'));
  check('writing your own question starts from the sentence', painted(win, doc.getElementById('qFull')) && !painted(win, doc.getElementById('qBlank')) && doc.getElementById('qFull').value==='How are you feeling about AI?');
  type(win, doc.getElementById('qFull'), 'How are you <b>arriving</b> today?');
  check('the preview shows the question as typed, escaped', doc.getElementById('pvQ').textContent==='How are you <b>arriving</b> today?' && !doc.getElementById('pvQ').querySelector('b'));
  click(win, doc.getElementById('qBack'));
  check('back to the sentence keeps the blank', painted(win, doc.getElementById('qBlank')) && doc.getElementById('qBlank').value==='AI');
  check('the instruction defaults to the plain line', doc.getElementById('instr').placeholder===win.DEFAULT_INSTR && doc.getElementById('pvI').textContent===win.DEFAULT_INSTR);
  type(win, doc.getElementById('instr'), 'Pick the one that fits.');
  check('the instruction updates the preview', doc.getElementById('pvI').textContent==='Pick the one that fits.');
  check('step 1 has one primary', primaries(doc,'st1')===1);
  click(win, doc.getElementById('next1'));
  check('step 2 is the words on the map', stepOn(doc)==='st2' && doc.querySelectorAll('#edTags .wtag').length===8);
  check('the eight come with their note, and no reset', /two in each corner/.test(doc.getElementById('wNote').textContent) && doc.getElementById('wReset').classList.contains('hide'));
  type(win, doc.getElementById('wAdd'), 'curious'); click(win, doc.getElementById('wAddBtn'));
  check('a word already on the map is refused', doc.querySelectorAll('#edTags .wtag').length===8 && /already on the map/.test(doc.getElementById('wWarn').textContent));
  type(win, doc.getElementById('wAdd'), '<i>Overwhelmed</i>'); key(win, doc.getElementById('wAdd'), 'Enter');
  const s1=win.STUDIO.setup.words;
  check('Enter adds a word, placed apart from the others, escaped', s1.length===9 && doc.querySelectorAll('#edTags .wtag').length===9 && !doc.querySelector('#edTags i') && s1.slice(0,8).every(w=>Math.hypot(w.x-s1[8].x,w.y-s1[8].y)>=.2));
  check('a changed set offers the reset and says where things go', !doc.getElementById('wReset').classList.contains('hide') && /Pleasant to the right/.test(doc.getElementById('wNote').textContent));
  const tag=doc.querySelector('#edTags .wtag[data-i="8"]'); const x0=s1[8].x; key(win, tag, 'ArrowRight');
  check('arrow keys nudge a word', Math.abs(win.STUDIO.setup.words[8].x-(x0+.04))<.02 || win.STUDIO.setup.words[8].x!==x0);
  win.STUDIO.setup.words[8].x=win.STUDIO.setup.words[1].x; win.STUDIO.setup.words[8].y=win.STUDIO.setup.words[1].y; win.settleWord(8);
  check('a word dropped on another steps away', Math.hypot(win.STUDIO.setup.words[8].x-win.STUDIO.setup.words[1].x, win.STUDIO.setup.words[8].y-win.STUDIO.setup.words[1].y)>=.25);
  key(win, doc.querySelector('#edTags .wtag[data-i="8"]'), 'Delete');
  check('Delete removes the focused word', win.STUDIO.setup.words.length===8);
  for (const w of ['Hopeful','Weary']){ type(win, doc.getElementById('wAdd'), w); click(win, doc.getElementById('wAddBtn')); }
  check('ten is the most', win.STUDIO.setup.words.length===10 && doc.getElementById('wAdd').disabled===true);
  click(win, doc.querySelector('#edTags .x[data-i="9"]'));
  check('the x removes a word', win.STUDIO.setup.words.length===9 && doc.getElementById('wAdd').disabled===false);
  click(win, doc.getElementById('wReset'));
  check('use our eight puts the eight back', win.isDefaultWords(win.STUDIO.setup.words));
  for (let i=0;i<5;i++) click(win, doc.querySelector('#edTags .x[data-i="0"]'));
  click(win, doc.getElementById('next2'));
  check('Next with three words stays and asks for four', stepOn(doc)==='st2' && /at least four/.test(doc.getElementById('wWarn').textContent));
  click(win, doc.getElementById('wReset')); click(win, doc.getElementById('next2'));
  check('step 3 offers three lengths, every pair chosen for eight words', stepOn(doc)==='st3' && doc.querySelectorAll('#lenCards .ccard').length===3 && doc.querySelector('#lenCards [data-r="7"]').getAttribute('aria-pressed')==='true');
  check('length cards draw who meets whom', doc.querySelectorAll('#lenCards .mini svg').length===3 && /Every pair/.test(doc.getElementById('lenCards').textContent));
  check('the fuse defaults on, sized to the length', doc.getElementById('fuseOn').getAttribute('aria-pressed')==='true' && doc.getElementById('fuseV').textContent===win.clock(win.defaultFuse(8,7)) && win.defaultFuse(8,7)>=win.secsFor(28));
  click(win, doc.querySelector('#lenCards [data-r="3"]'));
  check('a shorter run shortens the fuse', doc.getElementById('fuseV').textContent==='1:00' && win.STUDIO.setup.rounds===3);
  click(win, doc.getElementById('fuseMore')); click(win, doc.getElementById('fuseMore'));
  check('the fuse steps in 15 seconds and keeps a hand-set value', doc.getElementById('fuseV').textContent==='1:30');
  click(win, doc.querySelector('#lenCards [data-r="7"]'));
  check('a set fuse stays put when the length changes', doc.getElementById('fuseV').textContent==='1:30');
  click(win, doc.getElementById('fuseOn'));
  check('fuse off hides the stepper', !painted(win, doc.getElementById('fuseRow')));
  click(win, doc.getElementById('fuseOn'));
  check('step 3 has one primary', primaries(doc,'st3')===1);
  click(win, doc.getElementById('next3'));
  const rv=doc.getElementById('review').textContent;
  check('the review is the whole setup', stepOn(doc)==='st4' && /How are you feeling about AI\?/.test(rv) && /Pick the one that fits\./.test(rv) && /Every pair, 28 picks/.test(rv) && /1:30 each/.test(rv));
  check('review rows edit', (click(win, doc.querySelector('.rw[data-step="2"]')), stepOn(doc)==='st2'));
  click(win, doc.getElementById('next2')); click(win, doc.getElementById('next3'));
  click(win, doc.getElementById('btnCopySetup'));
  const link=win.copied[win.copied.length-1]||'';
  const dec=win.decodeSetup(link.split('setup=')[1]||'');
  check('a setup link carries the whole setup', !!dec && dec.blank==='AI' && dec.instr==='Pick the one that fits.' && dec.fuse.s===90 && dec.rounds===7);
  check('the draft autosaves', !!win.decodeSetup(win.read('rp_draft')||''));
  const d2=load(HOSTED+'?setup='+(link.split('setup=')[1]||''), false); await sleep(30);
  check('a setup link reopens the studio on the question', stepOn(d2.window.document)==='st1' && d2.window.document.getElementById('qBlank').value==='AI');
  d2.window.close();
  win.close();

  /* ---------- live: studio to console, phones by link and by code ---------- */
  dom = load(HOSTED, true); win = dom.window; doc = win.document; win.eval(fast); await sleep(30);
  click(win, doc.getElementById('btnBuild')); type(win, doc.getElementById('qBlank'), 'this change');
  click(win, doc.getElementById('next1')); click(win, doc.getElementById('next2'));
  click(win, doc.getElementById('fuseOn'));
  click(win, doc.getElementById('next3')); click(win, doc.getElementById('btnLaunch'));
  await until(()=>/host=/.test(win.location.href), 2000);
  const code=(win.location.href.match(/host=([A-Z]+)/)||[])[1];
  check('launch creates a session and moves to the console', !!code && doc.getElementById('scr_console').classList.contains('on') && /&k=/.test(win.location.href));
  const roomRows=[...env.DB._rows.keys()].filter(k=>k.startsWith('room-pulse:'+code));
  check('the session is open with here and ballot only', JSON.parse(env.DB._rows.get('room-pulse:'+code+'|_open').value).join()==='here,ballot');
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
  check('each phone keeps its own id on the device, never in the link', P.every(d=>!/[?&]me=/.test(d.window.location.href) && d.window.read('rp_me_'+code)===d.window.App.pid && /^[a-z0-9]{6}$/.test(d.window.App.pid)) && new Set(P.map(d=>d.window.App.pid)).size===P.length);
  await until(()=>doc.getElementById('chipHere').textContent==='6', 2000);
  check('the chip counts phones here', doc.getElementById('chipHere').textContent==='6' && !painted(win, doc.getElementById('chipDone')));
  const j=load(HOSTED+'?join', true); j.window.eval(fast); await sleep(40);
  type(j.window, j.window.document.getElementById('codeIn'), 'ZZZZ'); await sleep(80);
  check('a wrong code shakes and says so', /Nothing with those letters/.test(j.window.document.getElementById('joinMsg').textContent));
  type(j.window, j.window.document.getElementById('codeIn'), code.toLowerCase()); await until(()=>j.window.App.paxSig==='wait', 1500);
  check('typing the four letters joins', j.window.document.getElementById('scr_pax').classList.contains('on') && j.window.App.code===code);
  P.push(j);
  await until(()=>doc.getElementById('chipHere').textContent==='7', 2000);
  /* presence: a closed page drops at once, a silent one after a while */
  j.window.dispatchEvent(new j.window.Event('pagehide'));
  await until(()=>doc.getElementById('chipHere').textContent==='6', 2000);
  check('a page that closes leaves the count at once', doc.getElementById('chipHere').textContent==='6');
  P.pop(); j.window.close();

  click(win, doc.getElementById('btnOpen'));
  await until(()=>P.every(d=>view(d)==='warm' || view(d)==='hold'), 2000);
  await until(()=>P.every(d=>view(d)==='warm'), 2000);
  check('phones hold on the question, then a warm-up pair', P.every(d=>/First, an easy one\./.test(body(d))) && P[0].window.document.querySelectorAll('[data-pick]').length===2);
  check('the console shows the question and the room\'s progress', painted(win, doc.getElementById('con_open')) && doc.getElementById('openQ').textContent==='How are you feeling about this change?' && painted(win, doc.getElementById('chipDone')));
  check('the answering view has one primary', primaries(doc,'con_open')===1);
  const ph=P[0], pw=ph.window;
  pw.paxPick(0); await sleep(10);
  check('the warm-up is not counted', (pw.App.picks[1]||'')==='' && view(ph)==='pair1:0');
  check('real pairs show the question and the instruction', /How are you feeling about this change\?/.test(body(ph)) && /Two words at a time/.test(body(ph)));
  const s0=pw.seqFor(1)[0], cards=pw.document.querySelectorAll('[data-pick]');
  check('the cards are the scheduled pair, in order', cards[0].textContent===pw.cfgOf().words[s0[0]].w && cards[1].textContent===pw.cfgOf().words[s0[1]].w);
  click(pw, cards[1]); await sleep(10);
  check('a tap is the answer: winner then loser', pw.App.picks[1]===String(s0[1])+String(s0[0]) && view(ph)==='pair1:1');
  check('Back appears after a pick', painted(pw, pw.document.getElementById('btnUndo')));
  click(pw, pw.document.getElementById('btnUndo')); await sleep(10);
  check('Back takes the last pick away', (pw.App.picks[1]||'')==='' && view(ph)==='pair1:0');
  key(pw, pw.document, 'ArrowDown'); await sleep(10);
  check('arrow keys answer on a keyboard', pw.App.picks[1].length===2);
  await until(()=>{ const b=env.DB._rows.get('room-pulse:'+code+'|ballot/'+pw.App.pid+'/1'); return b && JSON.parse(b.value).s.length===2; }, 1500);
  /* a pick waiting on the throttle is not lost when the page closes */
  pw.App.writeMs=60000; pw.App.lastWrite=Date.now();
  { const s1=pw.seqFor(1)[1]; pw.paxPick(0); await sleep(10); const want=pw.App.picks[1];
    pw.dispatchEvent(new pw.Event('pagehide'));
    await until(()=>{ const b=env.DB._rows.get('room-pulse:'+code+'|ballot/'+pw.App.pid+'/1'); return b && JSON.parse(b.value).s===want; }, 1500);
    check('a waiting pick is written as the page closes', JSON.parse(env.DB._rows.get('room-pulse:'+code+'|ballot/'+pw.App.pid+'/1').value).s===want);
    pw.App.writeMs=0; pw.beat(); }
  check('the ballot is one row per person per pulse', !![...env.DB._rows.keys()].find(k=>k==='room-pulse:'+code+'|ballot/'+pw.App.pid+'/1'));
  /* a reload mid-answer comes back to the same person and the next pair */
  const before=pw.App.picks[1], pid0=pw.App.pid;
  const re=load(HOSTED+'?join='+code+'&me='+pid0, true); re.window.eval(fast); await until(()=>/^pair1/.test(re.window.App.paxSig||''), 2000);
  check('a reload keeps the same person and picks up at the next pair', re.window.App.pid===pid0 && re.window.App.picks[1]===before && view(re)==='pair1:'+(before.length/2));
  re.window.close();
  for (let i=0;i<P.length;i++) await answerAll(P[i], i<4 ? 1 : -1);
  await until(()=>P.every(d=>/^done1/.test(view(d))), 2000);
  check('after the last pair, phones rest on "Got it."', P.every(d=>/Got it\./.test(body(d))));
  check('every ballot is complete and marked done', P.every(d=>d.window.App.picks[1].length===56 && d.window.App.done[1]));
  await until(()=>doc.getElementById('chipDone').textContent==='6', 2000);
  check('the chip counts done, and warms when everyone is', doc.getElementById('chipDone').textContent==='6' && doc.getElementById('chip').classList.contains('warm'));
  check('the progress line fills', parseFloat(doc.getElementById('progFill').style.width)>=99);

  /* ---------- reveal ---------- */
  click(win, doc.getElementById('btnReveal'));
  await until(()=>doc.getElementById('reveal').classList.contains('on'), 1000);
  check('reveal opens on the standby', painted(win, doc.getElementById('rvStandby')) && !painted(win, doc.getElementById('rvSlide')));
  const late=await phone(code);
  await until(()=>P.every(d=>/^locked/.test(view(d))) && /^locked/.test(view(late)), 2000);
  check('the standby locks every phone, late arrivals included', P.every(d=>/Locked in\./.test(body(d))) && /Locked in\./.test(body(late)));
  /* a mirror tab follows the driving tab */
  const mir=load(HOSTED+'?host='+code+'&k='+win.App.key, true); mir.window.eval(fast);
  await until(()=>mir.window.App.rvOpen && mir.window.App.rvStandby, 2000);
  check('a second facilitator tab opens on the standby too', mir.window.document.getElementById('reveal').classList.contains('on'));
  click(win, doc.getElementById('rvBegin'));
  await until(()=>doc.getElementById('rvHead').textContent.length>0, 2000);
  const head=doc.getElementById('rvHead').textContent;
  const res=win.resultsOf(1);
  check('the read is written: one summary row and the people in chunks', !!res && res.people.length===6 && res.room.n===6 && !![...env.DB._rows.keys()].find(k=>k==='room-pulse:'+code+'|res/1/0'));
  check('the headline is the core headline for these counts', head.replace(/\s/g,'')===win.CORE.headline(res.room, win.cfgOf().words).replace(/\s/g,''));
  check('the headline sets one sentence per line', doc.getElementById('rvHead').children.length===win.CORE.headline(res.room, win.cfgOf().words).split('. ').length);
  check('the map carries every word, weighted by its people', doc.querySelectorAll('#rvMap .w').length===8 && Array.from(doc.querySelectorAll('#rvMap .w')).some(w=>+w.style.fontWeight>600));
  check('the map has a text label for screen readers', /near/.test(doc.getElementById('rvMap').getAttribute('aria-label')));
  check('people results hold no names, only random ids and spots', res.people.every(p=>/^[a-z0-9]{6}$/.test(p.pid)));
  await until(()=>mir.window.App.rvOpen && !mir.window.App.rvStandby, 2000);
  check('the mirror tab plays the read when it begins', mir.window.document.getElementById('rvHead').textContent.length>0);
  await until(()=>P.every(d=>/^result1/.test(view(d))), 2000);
  const lines=P.map(d=>d.window.document.getElementById('myLine').textContent);
  check('each phone gets its own line', lines.every(l=>/^You’re (one of \d+ near|the only one near|between|split between) /.test(l)));
  const mine=P[0].window.resultsOf(1).people.find(p=>p.pid===P[0].window.App.pid);
  check('the line names this person\'s own word', lines[0].indexOf(P[0].window.cfgOf().words[mine.h].w)>-1);
  check('a late arrival who did not answer sits it out', /sat this one out/.test(late.window.document.getElementById('myLine').textContent));
  check('the reveal surface has one primary', primaries(doc,'reveal')<=1);
  click(win, doc.getElementById('rvDone'));
  await until(()=>painted(win, doc.getElementById('con_rest')), 1500);
  check('Done lands on the read at rest, with the next pulse as the primary', !doc.getElementById('reveal').classList.contains('on') && painted(win, doc.getElementById('btnAgain')) && primaries(doc,'con_rest')===1);
  await until(()=>!mir.window.App.rvOpen, 2000);
  check('the mirror tab closes with it', !mir.window.document.getElementById('reveal').classList.contains('on'));
  /* replay through the standby; phones keep their result and play it again */
  const seen0=P[1].window.App.seenShow;
  click(win, doc.getElementById('btnReplay')); await until(()=>win.App.rvStandby, 1000);
  await sleep(150);
  check('phones keep their result while a replay waits on the standby', /^result1/.test(view(P[1])));
  click(win, doc.getElementById('rvBegin')); await until(()=>P[1].window.App.seenShow!==seen0, 2000);
  check('phones play the read again on a replay', P[1].window.App.seenShow!==seen0);
  check('a replay does not rewrite the results', win.resultsOf(1).sig===res.sig);
  click(win, doc.getElementById('rvDone')); await until(()=>painted(win, doc.getElementById('con_rest')), 1500);

  /* ---------- the second pulse and the shift ---------- */
  click(win, doc.getElementById('btnAgain'));
  await until(()=>P.every(d=>/^(hold2|pair2)/.test(view(d))), 2000);
  check('the second pulse opens with "Once more." and no warm-up', P.some(d=>/Once more\./.test(body(d))) || P.every(d=>/^pair2/.test(view(d))));
  check('the console says once more, to the room', painted(win, doc.getElementById('openPre')) && doc.getElementById('btnReveal').textContent==='Reveal the shift');
  await until(()=>P.every(d=>/^pair2/.test(view(d))), 2000);
  check('the first answer is not shown before the second', P.every(d=>!d.window.document.getElementById('myMap')));
  /* someone who arrives for the second pulse only gets the warm-up and the plain question, never "Once more." */
  const newbie=await phone(code); await until(()=>view(newbie)==='warm', 2000);
  check('a newcomer at the second pulse gets the warm-up, not "Once more."', view(newbie)==='warm' && !/Once more/.test(body(newbie)));
  await answerAll(newbie, 1); await until(()=>/^done2/.test(view(newbie)), 2000);
  /* half the room moves toward the other side */
  for (let i=0;i<P.length;i++) await answerAll(P[i], i<2 ? -1 : 1);
  await until(()=>P.every(d=>/^done2/.test(view(d))), 2000);
  check('the second done says what comes next', /how the room moved/.test(body(P[0])));
  click(win, doc.getElementById('btnReveal')); await until(()=>win.App.rvStandby, 1000);
  check('the second standby offers the shift', doc.getElementById('rvBegin').textContent==='Show the shift');
  click(win, doc.getElementById('rvBegin'));
  await until(()=>!!win.resultsOf(2), 2000); await sleep(60);
  const r2=win.resultsOf(2);
  check('the shift headline is written with the second read', !!r2 && r2.sh===win.CORE.shiftHeadline(win.resultsOf(1).room, r2.room, win.cfgOf().words));
  await until(()=>P.every(d=>/^result2/.test(view(d))), 2000);
  const l2=P.map(d=>d.window.document.getElementById('myLine').textContent);
  check('each phone says how it moved, or that it stayed', l2.every(l=>/^You (moved from|stayed near|’re between|’re near)/.test(l)));
  await until(()=>/^result2/.test(view(newbie)), 2000);
  check('a newcomer sees where they are now', /^You’re (near|between) .* now\.$/.test(newbie.window.document.getElementById('myLine').textContent));
  check('people who switched sides hear that they moved', /You moved from/.test(l2[0]) || /between/.test(l2[0]));
  check('the same person is matched across both pulses', P.every(d=>d.window.resultsOf(1).people.some(p=>p.pid===d.window.App.pid) && d.window.resultsOf(2).people.some(p=>p.pid===d.window.App.pid)));
  click(win, doc.getElementById('rvDone'));
  await until(()=>painted(win, doc.getElementById('con_rest')) && painted(win, doc.getElementById('restSeg')), 1500);
  check('the rest view after the shift toggles before and after, with no next pulse', painted(win, doc.getElementById('restSeg')) && !painted(win, doc.getElementById('btnAgain')));
  click(win, doc.getElementById('segBefore'));
  check('"When they arrived" shows the first headline', doc.getElementById('restHead').textContent.replace(/\s/g,'')===win.resultsOf(1).head.replace(/\s/g,''));
  click(win, doc.getElementById('segAfter'));
  check('"Before they left" shows the shift', doc.getElementById('restHead').textContent.replace(/\s/g,'')===(r2.sh||r2.head).replace(/\s/g,''));
  /* the download: totals, both reads, every pick, no ids */
  const rep=win.buildReport();
  check('the results download holds both reads, the counts and every pick', /When they arrived/.test(rep) && /Before they left/.test(rep) && /<table>/.test(rep) && /room-pulse-picks-/.test(rep));
  check('the download carries no participant ids', P.every(d=>rep.indexOf(d.window.App.pid)===-1));
  check('the download is noindex and has no em dashes', /noindex/.test(rep) && !/—/.test(rep));

  /* ---------- a small room shows hills only ---------- */
  {
    const v=new win.MapView(doc.createElement('div'), {});
    const few=res.people.slice(0,3); const sc=win.revealScene(v, {words:win.cfgOf().words, people:few, room:win.roomOf(few,8), seed:'x'}, {}); sc.end();
    check('fewer than five people: no dots, only the terrain', v.dots.length===0 && v.layers.length===1);
    const sh=win.shiftScene(v, {words:win.cfgOf().words, A:few, B:few, ra:win.roomOf(few,8), rb:win.roomOf(few,8)}, {}); sh.end();
    check('and no paths to follow in the shift', v.dots.length===0 && v.trails===null);
  }

  /* ---------- the fuse ---------- */
  {
    const d=load(HOSTED, true), w=d.window, dd=w.document; w.eval(fast); await sleep(30);
    click(w, dd.getElementById('btnBuild')); type(w, dd.getElementById('qBlank'), 'today');
    click(w, dd.getElementById('next1')); click(w, dd.getElementById('next2')); click(w, dd.getElementById('next3')); click(w, dd.getElementById('btnLaunch'));
    await until(()=>/host=/.test(w.location.href), 2000);
    const c2=w.location.href.match(/host=([A-Z]+)/)[1];
    await until(()=>w.App.state && w.App.state.pub && w.App.state.pub.cfg, 2000);
    await w.Net.set('pub/cfg', Object.assign({}, w.App.state.pub.cfg, {f:1}));
    const f=await phone(c2); await until(()=>f.window.App.paxSig==='wait', 1500);
    click(w, dd.getElementById('btnOpen')); await until(()=>view(f)==='warm', 2000);
    f.window.paxPick(0); await sleep(20);
    check('the fuse shows on real pairs', painted(f.window, f.window.document.getElementById('fuse')) && !f.window.document.getElementById('fuse').classList.contains('fill'));
    await answerAll(f, 1, 5);
    await until(()=>/^done1/.test(view(f)), 4000);
    check('when the fuse runs out, what was picked counts', /Time’s up\./.test(body(f)) && f.window.App.done[1] && f.window.App.picks[1].length===10);
    check('a fuse cut-off still counts once a round is done', (()=>{ const st={ballot:{}}; st.ballot[f.window.App.pid]={1:{s:f.window.App.picks[1], d:1}}; w.App.state.ballot=st.ballot; return w.computeResults(w.App.state,1).people.length===1; })());
    f.window.close(); d.window.close();
  }

  /* ---------- presence: a silent phone drops after a while ---------- */
  win.App.aliveMs=250; clearInterval(P[5].window.App.hbTimer); P[5].window.App.role='gone';
  const keep=P.slice(0,5).map(d=>setInterval(()=>d.window.beat(), 60));
  await until(()=>doc.getElementById('chipHere').textContent==='5', 2500);
  keep.forEach(clearInterval);
  check('a phone that stops beating leaves the count', doc.getElementById('chipHere').textContent==='5');
  win.App.aliveMs=40000;

  /* ---------- end, with undo ---------- */
  click(win, doc.getElementById('btnEnd'));
  check('End shows the undo card at once', painted(win, doc.getElementById('endLive')) && painted(win, doc.getElementById('con_ended')));
  click(win, doc.getElementById('btnUndoEnd')); await sleep(200);
  check('Undo keeps the session', !!env.DB._rows.get('room-pulse:'+code+'|pub/meta') && painted(win, doc.getElementById('con_rest')));
  click(win, doc.getElementById('btnEnd')); await sleep(400);
  check('End deletes the session after the undo window', ![...env.DB._rows.keys()].some(k=>k.startsWith('room-pulse:'+code+'|')) && painted(win, doc.getElementById('endDone')));
  await until(()=>view(P[0])==='ended', 2000);
  check('phones say goodbye when the session ends', /That’s all, folks\./.test(body(P[0])) && /ExperiencePoint\.com/.test(body(P[0])));
  check('the facilitator link is forgotten', !win.read('rp_host'));

  /* ---------- gates ---------- */
  {
    const g=load(HOSTED+'?host='+code+'&k=whatever123', true); await sleep(120);
    check('an ended session shows a plain dead end', /This session is over\./.test(g.window.document.getElementById('gateHead').textContent));
    const d=load(HOSTED, true); d.window.eval(fast); await sleep(20);
    click(d.window, d.window.document.getElementById('btnBuild')); type(d.window, d.window.document.getElementById('qBlank'), 'x');
    click(d.window, d.window.document.getElementById('next1')); click(d.window, d.window.document.getElementById('next2')); click(d.window, d.window.document.getElementById('next3')); click(d.window, d.window.document.getElementById('btnLaunch'));
    await until(()=>/host=/.test(d.window.location.href), 2000);
    const c3=d.window.location.href.match(/host=([A-Z]+)/)[1];
    const bad=load(HOSTED+'?host='+c3+'&k=wrongwrongwrong1', true); await sleep(150);
    check('a wrong facilitator key is refused, with a way forward', /needs a hand/.test(bad.window.document.getElementById('gateHead').textContent) && /four-letter code/.test(bad.window.document.getElementById('gateMsg').textContent));
    /* exit from the standby goes back to answering and unlocks phones */
    const q=await phone(c3); await until(()=>view(q)==='wait', 1500);
    click(d.window, d.window.document.getElementById('btnOpen')); await until(()=>view(q)==='warm', 2000);
    click(d.window, d.window.document.getElementById('btnReveal')); await until(()=>/^locked/.test(view(q)), 2000);
    click(d.window, d.window.document.getElementById('rvClose')); await until(()=>view(q)==='warm', 2000);
    check('Exit on the standby goes back to answering and unlocks phones', !d.window.document.getElementById('reveal').classList.contains('on') && view(q)==='warm' && painted(d.window, d.window.document.getElementById('con_open')));
    /* the facilitator picks up where they left off */
    const st=load(HOSTED, true); await sleep(40); st.window.store('rp_host', JSON.stringify({code:c3, k:d.window.App.key, at:Date.now()})); st.window.renderResume(); await sleep(80);
    check('the studio offers a way back to the live session', painted(st.window, st.window.document.getElementById('resumeBar')) && st.window.document.getElementById('resumeCode').textContent===c3);
    [g,d,bad,q,st].forEach(x=>x.window.close());
  }

  /* ---------- text extremes ---------- */
  {
    const d=load(HOSTED, false), w=d.window, dd=w.document; await sleep(20);
    click(w, dd.getElementById('btnBuild')); click(w, dd.getElementById('qRewrite'));
    type(w, dd.getElementById('qFull'), 'Q'.repeat(200));
    check('the question is capped at 90 characters', w.questionOf(w.STUDIO.setup).length<=90 || dd.getElementById('qFull').maxLength===90);
    click(w, dd.getElementById('next1'));
    type(w, dd.getElementById('wAdd'), 'W'.repeat(30)); click(w, dd.getElementById('wAddBtn'));
    check('a word is capped at 18 characters', w.STUDIO.setup.words[8].w.length===18);
    check('words wrap rather than overflow on a card', /\.card\{[^}]*overflow-wrap:anywhere/.test(html) && /\.pq\{[^}]*overflow-wrap:anywhere/.test(html) && /\.head\{[^}]*overflow-wrap:anywhere/.test(html));
    d.window.close();
  }

  /* ---------- test drive: bots arrive, answer, two wander off ---------- */
  {
    const d=load(HOSTED, false), w=d.window, dd=w.document; w.eval(fast+' App.botPick=function(){return 4;}; App.botJoin=function(){return 10;};'); await sleep(20);
    click(w, dd.getElementById('btnBuild')); type(w, dd.getElementById('qBlank'), 'AI');
    click(w, dd.getElementById('next1')); click(w, dd.getElementById('next2')); click(w, dd.getElementById('next3'));
    click(w, dd.getElementById('btnTestDrive'));
    await until(()=>dd.getElementById('chipHere').textContent==='18', 3000);
    check('test drive: bots join on their own', dd.getElementById('chipHere').textContent==='18' && painted(w, dd.getElementById('simBarC')));
    click(w, dd.getElementById('btnOpen'));
    await until(()=>dd.getElementById('chipDone').textContent==='18', 8000);
    check('test drive: bots answer at their own pace', dd.getElementById('chipDone').textContent==='18');
    await until(()=>dd.getElementById('chipHere').textContent==='16', 6000);
    check('test drive: two bots wander off, and the count falls', dd.getElementById('chipHere').textContent==='16');
    click(w, dd.getElementById('btnReveal')); await until(()=>w.App.rvStandby, 1000); click(w, dd.getElementById('rvBegin'));
    await until(()=>dd.getElementById('rvHead').textContent.length>0, 2000);
    check('test drive: the read plays with nothing sent anywhere', w.resultsOf(1).room.n===18 && !w.App.state.res[1][0].includes('youpax'));
    click(w, dd.getElementById('rvDone')); await sleep(80);
    click(w, dd.getElementById('segPax')); await until(()=>/^result1/.test(w.App.paxSig||''), 2000);
    check('test drive: the participant view shows the read on a phone', /sat this one out/.test(dd.getElementById('myLine').textContent));
    click(w, dd.getElementById('segCon2')); await sleep(60);
    click(w, dd.getElementById('btnSimExit'));
    check('exit test drive returns to the review step with the setup intact', dd.getElementById('scr_studio').classList.contains('on') && stepOn(dd)==='st4' && w.STUDIO.setup.blank==='AI');
    d.window.close();
  }

  check('no page errors along the way', errors.length===0);
  if (errors.length) console.log(errors.slice(0,5));
  P.forEach(d=>d.window.close()); late.window.close(); newbie.window.close(); mir.window.close(); win.close();
  console.log(failures===0?'\nALL CHECKS PASSED':'\n'+failures+' FAILURES');
  process.exit(failures===0?0:1);
})();
