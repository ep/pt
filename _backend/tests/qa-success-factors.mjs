/* qa-success-factors.mjs: jsdom harness for field-tools/success-factors/index.html.
   Runs the studio, the console and up to 21 laptops against the real pt worker code (fake database),
   decodes the lobby QR with jsQR, and checks the ranking, scoring and limits directly.
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
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0=Date.now(); while (Date.now()-t0 < (ms||4000)){ try{ if (fn()) return true; }catch(e){} await sleep(15); } return false; }
const HOSTED = 'https://ep.github.io/pt/field-tools/success-factors/';
const env = { DB: FakeDB() };
const errors = [];
let posts = 0, fetchesInDrive = 0;
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; if ((init.method||'GET')==='POST' && /\/api\/set$/.test(String(url))) posts++; const req = new Request(String(url), { method:init.method||'GET', headers:Object.assign({ Origin:'https://ep.github.io' }, init.headers||{}), body:init.body }); return worker.fetch(req, env); }; }
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
    window.scrollTo = () => {};
    window.HTMLAnchorElement.prototype.click = function(){ window.clickedDownload = this.download; };
    window.addEventListener('error', e => errors.push(String(e.message)));
  } });
  d.window.eval(fast + (opts.skew ? 'App.skew='+opts.skew+';' : ''));
  if (d.window.App.role) d.window.startLoops();
  doms.push(d); return d;
}
const fast = 'App.pollMs=40; App.hbMs=60000; App.retryMs=5; App.countMs=10; App.botMs=15; App.tickMs=20; App.anim=false; App.bannerMs=40; App.armMs=400;';
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, el, k, extra){ el.dispatchEvent(new win.KeyboardEvent('keydown', Object.assign({ key:k, bubbles:true }, extra||{}))); }
function on(d, id){ return d.window.document.getElementById(id).classList.contains('on'); }
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
async function joinLaptop(link, name, mascot, opts){
  const d = load(link, opts); const w = d.window, doc = w.document;
  await until(()=>doc.getElementById('jName'));
  type(w, doc.getElementById('jName'), name);
  click(w, doc.querySelector('#jPick [data-m="'+mascot+'"]'));
  click(w, doc.getElementById('jGo'));
  return d;
}
const stageText = d => d.window.document.getElementById('cStage').textContent;

(async function(){
  /* ---------- the file ---------- */
  check('noindex is set', html.includes('<meta name="robots" content="noindex, nofollow">'));
  check('no analytics', !/clarity|googletagmanager|gtag\(|analytics/i.test(html));
  check('a single card in Classify keeps its mascot small', /\.item \.ih \.av\{width:28px;height:28px;flex:0 0 28px;\}/.test(html));
  check('the shared favicon, send kit and feedback kit load by absolute path', html.includes('/pt/assets/favicon/favicon.svg') && html.includes('<script src="/pt/assets/kit/send.js" defer>') && html.includes('<script src="/pt/assets/kit/feedback.js" defer>'));
  check('tool id sf and the shared worker', /var TOOL_ID = "sf";/.test(html) && html.includes('var WORKER_URL = "https://pt.armand-khambatta.workers.dev"'));
  check('one file, well under 400 KB', html.length < 400000);
  const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(m=>m[0]).filter(u=>!/^https?:\/\/(pt\.armand-khambatta\.workers\.dev|ep\.github\.io\/pt|fonts\.googleapis\.com|fonts\.gstatic\.com|www\.w3\.org)/.test(u));
  check('talks only to the worker, the fonts and its own site', urls.length===0);
  check('no em dashes in anything people read', !/\u2014/.test(html));

  /* ---------- the gate ---------- */
  let r = await call('GET','/api/health');
  check('the worker gates sf', r.data.gatedTools.includes('sf'));

  /* ---------- Studio ---------- */
  const st = load(HOSTED); const sw = st.window, sd = sw.document;
  await until(()=>on(st,'studio'));
  check('the studio opens with no hash', on(st,'studio') && !on(st,'console'));
  check('studio defaults: 5 votes, top 10, timers 1, 10 and 3 minutes', sd.getElementById('stVotes').value==='5' && sd.getElementById('stTop').value==='10' && sd.getElementById('stTi').value==='1' && sd.getElementById('stTb').value==='10' && sd.getElementById('stTv').value==='3');
  click(sw, sd.getElementById('stGo'));
  await sleep(30);
  check('starting without an initiative asks for one, and starts nothing', !sd.getElementById('stErr').classList.contains('hide') && /initiative/.test(txt(st,'stErr')) && on(st,'studio'));
  type(sw, sd.getElementById('stInit'), 'Northwind relaunch');
  type(sw, sd.getElementById('stVotes'), '99'); type(sw, sd.getElementById('stTop'), '0');
  const v = sw.studioValues();
  check('votes and top list are held to their ranges', v.set.votes===15 && v.set.topN===1);
  type(sw, sd.getElementById('stVotes'), '3'); type(sw, sd.getElementById('stTop'), '3');
  type(sw, sd.getElementById('stFac'), 'Pat');
  click(sw, sd.getElementById('stGo'));
  await until(()=>on(st,'console'));
  const CODE = sw.App.code, KEY = sw.App.key;
  check('Start session opens the console in the same tab', on(st,'console'));
  check('a 6-letter code and a session key', /^[A-Z]{6}$/.test(CODE) && /^[A-Za-z0-9]{24}$/.test(KEY));
  check('the session is closed: a key, and no open paths', env.DB._rows.has('sf:'+CODE+'|_sk') && !env.DB._rows.has('sf:'+CODE+'|_open'));
  check('the control row holds the setup', row(CODE,'ctl').phase==='lobby' && row(CODE,'ctl').initiative==='Northwind relaunch' && row(CODE,'ctl').set.votes===3 && row(CODE,'ctl').set.t.build===10);
  check('the address carries the facilitator link in its hash', sw.location.hash==='#c='+CODE+'&k='+KEY+'&r=host');
  r = await call('GET','/api/state?tool=sf&code='+CODE);
  check('no key: the session refuses to be read', r.status===401);
  r = await call('GET','/api/state?tool=sf&code='+CODE, null, 'WRONGKEYWRONGKEY');
  check('a wrong key is refused', r.status===401);
  r = await call('POST','/api/set',{ tool:'sf', code:CODE, path:'idea/p1x1', value:{t:'sneaky'} });
  check('no key: writes are refused', r.status===401);

  /* ---------- Lobby, QR and joining ---------- */
  await until(()=>sd.querySelector('#cStage .qr svg'));
  const joinLink = sw.joinLink();
  check('the join link carries the code and the key in its hash', joinLink===HOSTED+'#c='+CODE+'&k='+KEY+'&r=pax');
  const decoded = decodeMatrix(svgToMatrix(sd.querySelector('#cStage .qr').innerHTML));
  check('the lobby QR decodes to the join link (jsQR)', decoded===joinLink);
  click(sw, sd.querySelector('[data-a="copyjoin"]')); click(sw, sd.querySelector('[data-a="copyhost"]'));
  check('Copy join link and Copy facilitator link copy the right links', sw.copied[0]===joinLink && sw.copied[1]===sw.hostLink());
  const A = await joinLaptop(joinLink, 'Ana', 'm01');
  await until(()=>A.window.App.seat && on(A,'laptop') && A.window.document.querySelector('.wait'));
  check('a laptop joins by link and claims seat 1', A.window.App.seat==='p1' && row(CODE,'pax/p1').nick==='Ana' && row(CODE,'who/p1').m==='m01');
  check('it waits in the lobby with its mascot', /You're in/.test(A.window.document.getElementById('pBody').textContent));
  /* two people pick the same mascot at the same moment: the later pick picks again */
  const B = load(joinLink), Cx = load(joinLink);
  await until(()=>B.window.document.getElementById('jName') && Cx.window.document.getElementById('jName'));
  check('a mascot someone has is greyed out on other laptops', B.window.document.querySelector('#jPick [data-m="m01"]').disabled);
  type(B.window, B.window.document.getElementById('jName'), 'Ben'); click(B.window, B.window.document.querySelector('#jPick [data-m="m02"]'));
  type(Cx.window, Cx.window.document.getElementById('jName'), 'Chi'); click(Cx.window, Cx.window.document.querySelector('#jPick [data-m="m02"]'));
  click(B.window, B.window.document.getElementById('jGo')); click(Cx.window, Cx.window.document.getElementById('jGo'));
  await until(()=>B.window.App.seat && Cx.window.App.seat);
  const grabbed = d => /Someone just grabbed that one/.test(d.window.document.getElementById('pBody').textContent);
  await until(()=>grabbed(B) || grabbed(Cx));
  await sleep(120);
  check('two picks of one mascot at once: exactly one person is asked to pick again', grabbed(B) !== grabbed(Cx));
  const loser = grabbed(B) ? B : Cx;
  click(loser.window, loser.window.document.querySelector('#jPick [data-m="m13"]')); click(loser.window, loser.window.document.getElementById('jGo'));
  await until(()=>loser.window.document.querySelector('.wait') && row(CODE,'who/'+loser.window.App.seat).m==='m13');
  check('a new pick lets them in', row(CODE,'who/'+loser.window.App.seat).m==='m13' && !!loser.window.document.querySelector('.wait'));
  await until(()=>/3/.test(sd.querySelector('#cStage .count').textContent));
  check('the console counts people here', /^3\s*of 20 here/.test(sd.querySelector('#cStage .count').textContent.trim()) && sd.querySelectorAll('#cStage .crowd .who').length===3);
  check('names stay on laptops and the lobby; the facilitator holds no seat', !row(CODE,'pax/p4') && !Object.keys(sw.App.S.pax).includes('fac'));

  /* ---------- Ideate ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>A.window.document.getElementById('pIdea'));
  check('Start ideas moves every screen to Ideate', row(CODE,'ctl').phase==='ideate' && !!A.window.document.getElementById('pIdea'));
  const aw = A.window, ad = aw.document;
  type(aw, ad.getElementById('pIdea'), 'A sponsor who shows up'); key(aw, ad.getElementById('pIdea'), 'Enter');
  type(aw, ad.getElementById('pIdea'), 'Typo idea'); click(aw, ad.getElementById('pSend'));
  type(aw, ad.getElementById('pIdea'), '<img src=x onerror=alert(1)>Training first'); key(aw, ad.getElementById('pIdea'), 'Enter');
  await until(()=>row(CODE,'idea/p1x3'));
  check('Enter and Add both send an idea, with its own id', row(CODE,'idea/p1x1').t==='A sponsor who shows up' && row(CODE,'idea/p1x2').t==='Typo idea' && row(CODE,'idea/p1x1').ph==='i');
  click(aw, ad.querySelectorAll('#pMine [data-p="edit"]')[1]);
  type(aw, ad.getElementById('pEdit'), 'Clear owners'); key(aw, ad.getElementById('pEdit'), 'Enter');
  await until(()=>row(CODE,'idea/p1x2').t==='Clear owners');
  check('a participant edits their own idea in Ideate', row(CODE,'idea/p1x2').t==='Clear owners');
  const bw = B.window, bd = bw.document;
  type(bw, bd.getElementById('pIdea'), 'Quick wins early'); key(bw, bd.getElementById('pIdea'), 'Enter');
  type(bw, bd.getElementById('pIdea'), 'Delete me'); key(bw, bd.getElementById('pIdea'), 'Enter');
  await until(()=>row(CODE,'idea/p2x2'));
  click(bw, bd.querySelectorAll('#pMine [data-p="del"]')[1]);
  await until(()=>row(CODE,'idea/p2x2')===null);
  check('a participant deletes their own idea in Ideate', row(CODE,'idea/p2x2')===null && bd.querySelectorAll('#pMine li').length===1);
  const cw = Cx.window, cd = cw.document;
  type(cw, cd.getElementById('pIdea'), 'Front-line voices'); key(cw, cd.getElementById('pIdea'), 'Enter');
  await until(()=>sd.getElementById('ideaCount') && sd.getElementById('ideaCount').textContent==='5' && sd.querySelectorAll('#cStage .dots .who.lit').length===3);
  check('the console shows the count and who has added, never the text', sd.getElementById('ideaCount').textContent==='5' && !/sponsor|Quick wins|Front-line/.test(stageText(st)) && sd.querySelectorAll('#cStage .dots .who.lit').length===3);
  check('a laptop sees only its own ideas', !/Quick wins/.test(ad.getElementById('pBody').textContent) && /sponsor/.test(ad.getElementById('pBody').textContent));
  /* skewed clocks: two laptops 30 s fast and slow count down with the console */
  const F = load(A.window.location.href.replace('r=pax','r=pax'), { skew: 30000, seed:{ ['sf-seat-'+CODE]:'p2' } });
  const S2 = load(joinLink, { skew: -30000, seed:{ ['sf-seat-'+CODE]:'p3' } });
  await sleep(450);
  click(sw, sd.getElementById('tStart'));
  await until(()=>F.window.document.getElementById('pTm').textContent && S2.window.document.getElementById('pTm').textContent && row(CODE,'ctl').timer.running);
  await sleep(150);
  const t = row(CODE,'ctl').timer, remF = F.window.remaining(t), remS = S2.window.remaining(t), remC = sw.remaining(t);
  check('timers agree across screens with clocks 30 seconds apart', Math.abs(remF-remC)<1000 && Math.abs(remS-remC)<1000 && remC>50000);
  /* run the clock down: set it to end now */
  const tc = JSON.parse(JSON.stringify(row(CODE,'ctl'))); tc.timer.endsAt = Date.now() + 300; tc.timer.left = 300;
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tc }, KEY);
  await until(()=>F.window.document.getElementById('pIdea') && F.window.document.getElementById('pIdea').disabled && S2.window.document.getElementById('pIdea').disabled && ad.getElementById('pIdea').disabled, 3000);
  check('at zero every laptop locks input, whatever its clock', F.window.document.getElementById('pIdea').disabled && S2.window.document.getElementById('pIdea').disabled && ad.getElementById('pIdea').disabled);
  check('a locked laptop says time is up', !ad.getElementById('pLock').classList.contains('hide'));
  check('a locked laptop cannot send', aw.addIdea()===false);
  await until(()=>row(CODE,'ctl').phase==='reveal', 3000);
  check('after a 3-2-1 the console moves to Reveal on its own', row(CODE,'ctl').phase==='reveal');
  F.window.close(); S2.window.close();

  /* ---------- Reveal ---------- */
  await until(()=>/A sponsor who shows up/.test(stageText(st)));
  check('Reveal shows every idea on the console', /A sponsor who shows up/.test(stageText(st)) && /Quick wins early/.test(stageText(st)) && /Front-line voices/.test(stageText(st)) && !/Delete me/.test(stageText(st)));
  check('typed text never runs as markup', !sd.querySelector('#cStage img') && /<img src=x/.test(stageText(st)));
  await until(()=>/A sponsor/.test(bd.getElementById('pBody').textContent));
  check('laptops get a read-only copy of the board', /A sponsor/.test(bd.getElementById('pBody').textContent) && !bd.querySelector('#pBody .cm'));
  click(sw, sd.querySelector('[data-a="round"]'));
  await until(()=>row(CODE,'ctl').phase==='ideate' && row(CODE,'ctl').round===2);
  check('Run another round goes back to Ideate as round 2', row(CODE,'ctl').round===2);
  await until(()=>ad.getElementById('pIdea') && !ad.getElementById('pIdea').disabled);
  type(aw, ad.getElementById('pIdea'), 'Managers can explain why'); key(aw, ad.getElementById('pIdea'), 'Enter');
  await until(()=>row(CODE,'idea/p1x4'));
  check('round 2 ideas carry their round, and the console counts only this round', row(CODE,'idea/p1x4').r===2 && await until(()=>sd.getElementById('ideaCount').textContent==='1'));
  check('a laptop lists only this round\'s ideas to edit', ad.querySelectorAll('#pMine li').length===1);
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='reveal');
  await until(()=>/Managers can explain why/.test(stageText(st)) && /A sponsor/.test(stageText(st)));
  check('earlier ideas stay on the board', /Managers can explain why/.test(stageText(st)) && /A sponsor/.test(stageText(st)));

  /* ---------- Build ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='build' && row(CODE,'ctl').timer.dur===600000);
  check('Build loads its own 10-minute timer, stopped', row(CODE,'ctl').timer.running===false && row(CODE,'ctl').timer.left===600000);
  let before = posts; sw.groupWith('p1x1','p2x1');
  await until(()=>row(CODE,'grp/g1') && row(CODE,'meta/p1x1') && row(CODE,'meta/p2x1'));
  check('dropping a card on a card makes a group, in 3 writes', row(CODE,'meta/p1x1').g==='g1' && row(CODE,'meta/p2x1').g==='g1' && posts-before===3);
  await until(()=>sd.querySelector('[data-gt="g1"]'));
  check('the new group\'s name box opens', sd.activeElement===sd.querySelector('[data-gt="g1"]'));
  type(sw, sd.querySelector('[data-gt="g1"]'), 'Leadership'); key(sw, sd.querySelector('[data-gt="g1"]'), 'Enter');
  await until(()=>row(CODE,'grp/g1').t==='Leadership');
  check('naming a group saves it', row(CODE,'grp/g1').t==='Leadership');
  /* a real drag: card onto the group */
  await until(()=>sd.querySelector('.card[data-id="p1x4"]') && sd.querySelector('[data-drop="grp:g1"]'));
  const srcCard = sd.querySelector('.card[data-id="p1x4"]'), grpBox = sd.querySelector('[data-drop="grp:g1"]');
  sd.elementFromPoint = () => grpBox;
  before = posts;
  srcCard.dispatchEvent(new sw.MouseEvent('pointerdown', { bubbles:true, clientX:10, clientY:10, button:0 }));
  sw.dispatchEvent(new sw.MouseEvent('pointermove', { bubbles:true, clientX:80, clientY:60 }));
  check('dragging shows a card under the pointer and outlines the target', !!sd.querySelector('.ghostcard') && grpBox.classList.contains('dropok'));
  sw.dispatchEvent(new sw.MouseEvent('pointerup', { bubbles:true, clientX:80, clientY:60 }));
  await until(()=>row(CODE,'meta/p1x4') && row(CODE,'meta/p1x4').g==='g1');
  check('dropping a card on a group adds it, in 1 write', row(CODE,'meta/p1x4').g==='g1' && posts-before===1 && !sd.querySelector('.ghostcard'));
  sw.ungroup('p1x4');
  await until(()=>!row(CODE,'meta/p1x4').g);
  check('dropping on Unsorted takes a card out of its group', !row(CODE,'meta/p1x4').g);
  before = posts; sw.mergeInto('p1x3','p1x2');
  await until(()=>row(CODE,'meta/p1x3') && row(CODE,'meta/p1x3').mg==='p1x2');
  check('merge writes only the merged card', posts-before===1 && row(CODE,'meta/p1x3').mg==='p1x2');
  await until(()=>/\+1 merged/.test(stageText(st)));
  check('the card it went into says so, and the merged card leaves the board', /\+1 merged/.test(stageText(st)) && !/Training first/.test(stageText(st)));
  sw.splitOut('p1x3');
  await until(()=>!row(CODE,'meta/p1x3').mg);
  check('Split brings a merged card back', !row(CODE,'meta/p1x3').mg);
  sw.editCard('p3x1','Front-line voices in the design','Two people from each site');
  await until(()=>row(CODE,'meta/p3x1') && row(CODE,'meta/p3x1').d);
  check('the facilitator edits text and detail, keeping the earlier text', row(CODE,'meta/p3x1').t==='Front-line voices in the design' && row(CODE,'meta/p3x1').h[0]==='Front-line voices' && row(CODE,'meta/p3x1').d==='Two people from each site');
  check('the author\'s own row is never changed after Reveal', row(CODE,'idea/p3x1').t==='Front-line voices');
  await until(()=>/Two people from each site/.test(stageText(st)));
  sw.delCard('p1x3');
  await until(()=>row(CODE,'meta/p1x3').x===1);
  check('Delete hides a card', row(CODE,'meta/p1x3').x===1);
  key(sw, sd.body, 'z', { ctrlKey:true });
  await until(()=>!row(CODE,'meta/p1x3').x);
  check('Ctrl+Z undoes the last board action', !row(CODE,'meta/p1x3').x);
  key(sw, sd.body, 'z', { ctrlKey:true });
  await until(()=>!(row(CODE,'meta/p3x1')||{}).d);
  check('and the one before it', !(row(CODE,'meta/p3x1')||{}).d && !(row(CODE,'meta/p3x1')||{}).t);
  sw.editCard('p3x1','Front-line voices in the design','');
  /* the card menu, by keyboard */
  await until(()=>sd.querySelector('[data-menu="p2x1"]'));
  click(sw, sd.querySelector('[data-menu="p2x1"]'));
  check('each card has a menu: Edit, Group with, Merge into, History and Delete', ['edit','group','merge','delete'].every(k=>sd.querySelector('.menu [data-mi="'+k+'"]')) && sd.activeElement===sd.querySelector('.menu button'));
  key(sw, sd.querySelector('.menu'), 'Escape');
  check('Escape closes the menu', !sd.querySelector('.menu'));
  click(sw, sd.querySelector('[data-menu="p3x1"]')); click(sw, sd.querySelector('.menu [data-mi="history"]'));
  check('History lists the original wording', /Front-line voices/.test(sd.querySelector('.dlg').textContent) && /\(now\)/.test(sd.querySelector('.dlg').textContent));
  key(sw, sd.querySelector('.dlg'), 'Escape');
  /* participants add new and build-on ideas */
  await until(()=>bd.querySelector('[data-mode="on"]'));
  click(bw, bd.querySelector('[data-mode="on"]'));
  await until(()=>bd.querySelector('#pBoard .card[data-id="p1x1"]'));
  check('Build on waits for a card', bd.getElementById('pSend').disabled && /Tap the card/.test(bd.getElementById('pOn').textContent));
  click(bw, bd.querySelector('#pBoard .card[data-id="p1x1"]'));
  check('tapping a card picks what you build on', /Building on: A sponsor/.test(bd.getElementById('pOn').textContent) && !bd.getElementById('pSend').disabled);
  type(bw, bd.getElementById('pIdea'), '...who joins the monthly demo'); click(bw, bd.getElementById('pSend'));
  await until(()=>row(CODE,'idea/p2x3'));
  check('a build-on idea records its parent', row(CODE,'idea/p2x3').par==='p1x1' && row(CODE,'idea/p2x3').ph==='b');
  type(bw, bd.getElementById('pIdea'), 'A shared channel for questions'); click(bw, bd.getElementById('pSend'));
  await until(()=>row(CODE,'idea/p2x4'));
  check('a new idea in Build has no parent', row(CODE,'idea/p2x4').par===null);
  await until(()=>sd.querySelector('.card[data-id="p1x1"]') && sd.querySelector('.card[data-id="p1x1"]').parentNode.querySelector('.kids .card[data-id="p2x3"]'));
  check('build-on cards sit under their parent', !!sd.querySelector('.card[data-id="p1x1"]').parentNode.querySelector('.kids .card[data-id="p2x3"]'));
  sw.facIdea('Systems ready before launch','');
  await until(()=>row(CODE,'idea/fx1'));
  check('the facilitator can add a card (fx ids)', row(CODE,'idea/fx1').t==='Systems ready before launch');
  sw.groupWith('p2x4','p1x2'); await until(()=>row(CODE,'grp/g2')); sw.renameGroup('g2','Ways of working');
  await until(()=>row(CODE,'grp/g2').t==='Ways of working');

  /* ---------- Classify ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='classify' && sd.querySelector('#cStage .unc [data-item="g1"]'));
  check('Classify starts with everything unsorted', sd.querySelectorAll('#cStage .unc .item').length>=4 && !sd.querySelector('#cStage .col .item'));
  const itemG1 = sd.querySelector('[data-item="g1"]'), colE = sd.querySelector('[data-drop="col:e"]');
  sd.elementFromPoint = () => colE;
  itemG1.dispatchEvent(new sw.MouseEvent('pointerdown', { bubbles:true, clientX:10, clientY:10, button:0 }));
  sw.dispatchEvent(new sw.MouseEvent('pointermove', { bubbles:true, clientX:90, clientY:90 }));
  sw.dispatchEvent(new sw.MouseEvent('pointerup', { bubbles:true, clientX:90, clientY:90 }));
  await until(()=>row(CODE,'grp/g1').c==='e');
  check('dragging a group into Essential classifies it', row(CODE,'grp/g1').c==='e');
  click(sw, sd.querySelector('[data-imenu="p3x1"]')); click(sw, sd.querySelector('.menu [data-mi="a"]'));
  await until(()=>row(CODE,'meta/p3x1').c==='a');
  check('the item menu classifies a loose card', row(CODE,'meta/p3x1').c==='a');
  ['g2','p1x3','p2x1x','fx1','p1x4'].forEach(id=>{ if (sw.model().items.some(i=>i.id===id)) sw.classify(id,'a'); });
  await until(()=>row(CODE,'grp/g2').c==='a' && row(CODE,'meta/fx1') && row(CODE,'meta/fx1').c==='a');
  await until(()=>/Essential/.test(bd.getElementById('pBody').textContent) && bd.querySelector('#pBoard .col.e [data-item="g1"]'));
  check('laptops see the columns, read-only', !!bd.querySelector('#pBoard .col.e [data-item="g1"]') && !bd.querySelector('#pBoard [data-imenu]'));

  /* ---------- Vote ---------- */
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='vote' && bd.querySelector('[data-vote="+"]'));
  check('Vote loads its 3-minute timer', row(CODE,'ctl').timer.dur===180000);
  check('only aspirational items are on the ballot', !bd.querySelector('[data-t="g1"]') && !!bd.querySelector('[data-t="g2"]') && !!bd.querySelector('[data-t="p3x1"]'));
  check('the laptop shows votes left', bd.getElementById('votesLeft').textContent==='3 of 3 votes left');
  const plus = (d,id)=>click(d.window, d.window.document.querySelector('[data-vote="+"][data-t="'+id+'"]'));
  plus(B,'g2'); await sleep(5); plus(B,'g2');
  await until(()=>row(CODE,'vote/p2') && row(CODE,'vote/p2').g2===2);
  check('votes stack on one item', row(CODE,'vote/p2').g2===2 && bd.getElementById('votesLeft').textContent==='1 of 3 votes left');
  plus(B,'p3x1'); await until(()=>row(CODE,'vote/p2').p3x1===1);
  check('+ is off once the votes are spent', bd.querySelector('[data-vote="+"][data-t="g2"]').disabled);
  bw.castVote('p2','fx1',1); await sleep(80);
  check('the cap holds even if + is pressed anyway', !row(CODE,'vote/p2').fx1);
  plus(A,'g2'); await sleep(5); plus(A,'fx1'); await sleep(5); plus(A,'p3x1');
  plus(Cx,'p3x1'); await sleep(5); plus(Cx,'fx1');
  sw.castVote('fac','g2',1);
  await until(()=>row(CODE,'vote/p1') && Object.values(row(CODE,'vote/p1')).reduce((a,b)=>a+b,0)===3 && row(CODE,'vote/p3') && row(CODE,'vote/fac'));
  const barN = (d,id) => d.window.document.querySelector('[data-bar="'+id+'"] .n').textContent;
  const agreed = () => barN(st,'g2')==='4' && barN(A,'g2')==='4' && barN(B,'g2')==='4' && barN(st,'p3x1')==='3' && barN(Cx,'p3x1')==='3' && barN(st,'fx1')==='2';
  await until(agreed);
  check('live tallies match on the console and every laptop', agreed());
  check('the leader glows', sd.querySelector('[data-bar="g2"]').classList.contains('lead'));
  /* going back: an item moved out of aspirational gives its votes back */
  click(sw, sd.getElementById('cBack'));
  await until(()=>row(CODE,'ctl').phase==='classify');
  sw.classify('fx1','e');
  await until(()=>row(CODE,'meta/fx1').c==='e');
  click(sw, sd.getElementById('cNext'));
  await until(()=>row(CODE,'ctl').phase==='vote' && Cx.window.document.getElementById('votesLeft'));
  await until(()=>Cx.window.document.getElementById('votesLeft').textContent==='2 of 3 votes left');
  check('going back keeps votes cast, and gives back votes on items no longer aspirational', row(CODE,'vote/p3').fx1===1 && Cx.window.document.getElementById('votesLeft').textContent==='2 of 3 votes left' && !sd.querySelector('[data-bar="fx1"]'));
  await until(()=>row(CODE,'ctl').allv===true);
  check('everyone present voting earns the room 5 points, once', row(CODE,'ctl').allv===true);
  /* time runs out: voting locks and the console moves to Results */
  const tv = JSON.parse(JSON.stringify(row(CODE,'ctl'))); tv.timer = { phase:'vote', dur:180000, left:200, running:true, endsAt:Date.now()+200 };
  await call('POST','/api/set',{ tool:'sf', code:CODE, path:'ctl', value:tv }, KEY);
  await until(()=>row(CODE,'ctl').phase==='results', 3000);
  check('at zero the vote closes and the console moves to Results', row(CODE,'ctl').phase==='results');

  /* ---------- Results, report, email, end ---------- */
  await until(()=>sd.querySelector('#cStage .rank li'));
  const R = sw.ranking();
  check('Olympic ranking on the live session: 4 votes gold, 3 silver', R[0].id==='g2' && R[0].medal==='gold' && R[1].id==='p3x1' && R[1].medal==='silver');
  check('medal winners are bold and labelled', /We will drive toward these/.test(stageText(st)) && sd.querySelectorAll('#cStage .rank li.won').length>=2);
  check('Essentials sit on the left, by group', /Leadership/.test(sd.querySelector('#cStage .ess').textContent) && /A sponsor who shows up/.test(sd.querySelector('#cStage .ess').textContent));
  check('the podium has a gold and a silver step', /Ways of working/.test(sd.querySelector('.pstep.gold').textContent) && /Front-line/.test(sd.querySelector('.pstep.silver').textContent));
  await until(()=>/Results/.test(bd.getElementById('pBody').textContent) && bd.querySelector('#pBoard .rank'));
  check('laptops see the results, with download waiting for Finalize', !bd.querySelector('[data-a="download"]') && /finalize/.test(bd.getElementById('pBody').textContent));
  check('download refuses before Finalize', sw.downloadReport()===false);
  click(sw, sd.querySelector('[data-a="finalize"]'));
  await until(()=>row(CODE,'ctl').final===true && sd.querySelector('[data-a="download"]'));
  check('Finalize freezes the board', row(CODE,'ctl').final===true && sd.getElementById('cBack').disabled && sd.getElementById('cNext').classList.contains('hide'));
  const name = sw.downloadReport();
  check('the report file name', /^success-factors-northwind-relaunch-\d{4}-\d{2}-\d{2}\.html$/.test(name));
  const rep = sw.reportHtml(true);
  check('the report: initiative, question, facilitator, people, level', /<h1>Northwind relaunch<\/h1>/.test(rep) && /What has to be true/.test(rep) && /Facilitated by Pat/.test(rep) && /Ana/.test(rep) && /Ben/.test(rep) && /Level reached: /.test(rep));
  check('the report: essentials by group with detail', /<h3>Leadership<\/h3>/.test(rep) && rep.indexOf('Essential success factors') < rep.indexOf('Aspirational goals'));
  check('the report: ranked aspirations with tallies and medals', /We will drive toward these/.test(rep) && /class="m gold">1</.test(rep) && /class="m silver">2</.test(rep));
  check('the report appendix: other aspirations, original wording, earlier questions', /Appendix/.test(rep) && /Original wording/.test(rep) && /Front-line voices <span class="d">now: Front-line voices in the design/.test(rep));
  check('the appendix can be left out', !/Appendix/.test(sw.reportHtml(false)));
  check('the report escapes what people typed and prints cleanly', !/<img src=x/.test(rep) && /&lt;img src=x/.test(rep) && /@media print/.test(rep) && /noindex/.test(rep));
  await until(()=>bd.querySelector('[data-a="download"]'));
  click(bw, bd.querySelector('[data-a="download"]'));
  check('every laptop can download after Finalize', bw.App.lastDownload===name && !!bw.lastBlob);
  sw.EPKit = { email(o){ sw.emailed = o; return Promise.resolve({}); } };
  type(sw, sd.getElementById('mailTo'), 'a@example.com, b@example.com'); sd.getElementById('mailTo').dispatchEvent(new sw.Event('change', { bubbles:true }));
  click(sw, sd.querySelector('[data-a="email"]'));
  const em = sw.emailed;
  check('Email report calls the send kit with the subject, body and file', em && em.subject==='Success factors: Northwind relaunch' && em.to.join()==='a@example.com,b@example.com' && /We will drive toward these:/.test(em.body) && /Leadership:/.test(em.body) && em.files()[0].name===name);
  /* a reload, two console tabs, presence */
  const A2 = load(joinLink, { seed:{ ['sf-seat-'+CODE]:'p1' } });
  await until(()=>A2.window.document.getElementById('pTop') && !A2.window.document.getElementById('pTop').classList.contains('hide'));
  check('a reload resumes the same seat and mascot', A2.window.App.seat==='p1' && !A2.window.document.getElementById('jName') && /Ana/.test(txt(A2,'pMe')));
  const st2 = load(sw.hostLink());
  await until(()=>on(st2,'console') && /Results/.test(stageText(st2)));
  check('a second console tab opens on the same session', /Results/.test(stageText(st2)) && st2.window.App.S.ctl.final===true);
  sw.App.times.p3 = Date.now() - 31000 - sw.App.offset;
  check('a seat that stops beating for 30 seconds counts as away', sw.present('p3')===false && sw.present('p1')===true);
  /* End session: armed, then clear */
  click(sw, sd.querySelector('[data-a="end"]'));
  check('End session asks for a second click', sw.App.armed===true && rows(CODE)>0 && /Click again/.test(stageText(st)));
  click(sw, sd.querySelector('[data-a="end"]'));
  await until(()=>rows(CODE)===0);
  check('the second click clears the session from the worker', rows(CODE)===0 && on(st,'gate') && /ended and cleared/.test(txt(st,'gHead')));
  await until(()=>on(B,'gate'));
  check('laptops show that the session has ended', on(B,'gate') && /isn't running/.test(txt(B,'gHead')));
  doms.forEach(d=>{ try{ d.window.stopLoops(); }catch(e){} });

  /* ---------- a full room: 20 seats, the 21st refused, limits ---------- */
  const FULL='FULLRM', FK='FULLKEYFULLKEY12';
  await call('POST','/api/create',{ tool:'sf', code:FULL, sk:FK }, null);
  await call('POST','/api/set',{ tool:'sf', code:FULL, path:'ctl', value:{ phase:'lobby', round:1, q:'Q', initiative:'Full', set:{votes:5,topN:10,t:{ideate:1,build:10,vote:3}}, timer:{phase:'lobby',dur:0,left:0,running:false,endsAt:null} } }, FK);
  for (let i=1;i<=20;i++) await call('POST','/api/claim',{ tool:'sf', code:FULL, path:'pax/p'+i, value:{ nick:'Person '+i } }, FK);
  const L21 = await joinLaptop(HOSTED+'#c='+FULL+'&k='+FK+'&r=pax', 'Late', 'm05');
  await until(()=>!L21.window.document.getElementById('jErr').classList.contains('hide'));
  check('the 21st person gets a friendly message, and no seat', /room is full/.test(L21.window.document.getElementById('jErr').textContent) && !L21.window.App.seat);
  r = await call('POST','/api/claim',{ tool:'sf', code:FULL, path:'pax/p21', value:{ nick:'x' } }, FK);
  check('seat 21 does not exist on the worker', r.status===400);
  L21.window.stopLoops();
  const long = n => 'x'.repeat(n);
  let maxLen = 0;
  for (let i=1;i<=20;i++){
    await call('POST','/api/set',{ tool:'sf', code:FULL, path:'who/p'+i, value:{ m:'m'+String(i).padStart(2,'0'), at:Date.now() } }, FK);
    await call('POST','/api/set',{ tool:'sf', code:FULL, path:'here/p'+i, value:1 }, FK);
    const vrow = {}; for (let k=1;k<=10;k++) vrow['p'+i+'x'+k]=1;
    const vr = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'vote/p'+i, value:vrow }, FK); maxLen=Math.max(maxLen, JSON.stringify(vrow).length);
    for (let k=1;k<=10;k++){
      const iv = { t:long(200), ph:'b', par:'p'+(i%20+1)+'x'+k, at:Date.now(), r:3 }, mv = { t:long(200), d:long(600), g:'g'+k, c:'a', mg:'p20x10', h:[long(200),long(200),long(200),long(200),long(200)], x:1 };
      const a1 = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'idea/p'+i+'x'+k, value:iv }, FK);
      const a2 = await call('POST','/api/set',{ tool:'sf', code:FULL, path:'meta/p'+i+'x'+k, value:mv }, FK);
      maxLen = Math.max(maxLen, JSON.stringify(iv).length, JSON.stringify(mv).length);
      if (a1.status!==200 || a2.status!==200 || vr.status!==200) { maxLen = 99999; }
    }
  }
  for (let g=1; g<=30; g++) await call('POST','/api/set',{ tool:'sf', code:FULL, path:'grp/g'+g, value:{ t:long(40), c:'a', o:g } }, FK);
  for (let q=1; q<=10; q++) await call('POST','/api/set',{ tool:'sf', code:FULL, path:'qh/'+q, value:{ q:long(200), at:Date.now() } }, FK);
  check('20 seats and 200 ideas at full length: every value is under 4,000 characters and accepted', maxLen < 4000);
  check('and the session stays far under 6,000 rows', rows(FULL) < 600);
  r = await call('GET','/api/state?tool=sf&code='+FULL+'&times=here', null, FK);
  check('one full read stays a reasonable size', JSON.stringify(r.data).length < 1200000 && r.status===200);

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
  /* scoreboard */
  const base = { ctl:{ set:{votes:5,topN:10,t:{ideate:1,build:10,vote:3}} }, idea:{ p1x1:{t:'a'}, p1x2:{t:'b', par:'p1x1'}, p2x1:{t:'c'}, p2x2:null }, meta:{ p1x1:{ d:'detail', g:'g1' }, p2x1:{ g:'g1' } }, grp:{ g1:{ t:'Named', c:'e' }, g2:{ t:'Empty group' } } };
  const pts = s => tw.score(tw.model(s), s);
  check('points: 1 per idea, 2 for a build-on, 2 for detail, 3 per named group, 3 per essential', pts(base) === 3 + 2 + 2 + 3 + 3);
  const b2 = JSON.parse(JSON.stringify(base)); b2.ctl.allv = true;
  check('5 points once everyone present has voted', pts(b2) === pts(base) + 5);
  const b3 = JSON.parse(JSON.stringify(base)); b3.meta.p1x2 = { x:1 };
  check('deleting an idea removes its points', pts(b3) === pts(base) - 3);
  check('levels at 15, 35 and 60', tw.levelOf(14)===0 && tw.levelOf(15)===1 && tw.levelOf(35)===2 && tw.levelOf(59)===2 && tw.levelOf(60)===3);
  tw.App.S = JSON.parse(JSON.stringify(b3)); tw.App.S.ctl.lvl = 2;
  check('a level once reached never drops', tw.shownLevel(tw.model())===2);
  const bv = JSON.parse(JSON.stringify(base)); bv.grp.g1.c='a'; bv.vote = { p1:{ g1:9 }, p2:{ g1:2, zz:3 } };
  const TV = tw.tallies(tw.model(bv), bv);
  check('counting ignores votes above the cap and on things that are not aspirational', TV.tal.g1===7 && TV.used.p1===5 && TV.used.p2===2);
  T.window.close();

  /* ---------- the test drive: six practice people, no network ---------- */
  const TD = load(HOSTED, { live:false }); const dw = TD.window, dd = dw.document;
  await until(()=>on(TD,'studio'));
  type(dw, dd.getElementById('stInit'), 'Practice');
  click(dw, dd.getElementById('stDrive'));
  await until(()=>on(TD,'console'));
  dw.App.pollMs = 40; dw.startLoops();
  await until(()=>dw.seats().length===6, 3000);
  check('Test drive: six practice people join on their own', dw.seats().length===6 && dw.seats().every(s=>s.m));
  click(dw, dd.getElementById('cNext'));
  await until(()=>Object.keys(dw.App.S.idea||{}).length>=12, 4000);
  check('they add ideas in Ideate', Object.keys(dw.App.S.idea).length>=12);
  dw.goPhase('reveal'); dw.goPhase('build');
  await until(()=>Object.values(dw.App.S.idea).some(x=>x && x.par), 4000);
  check('they build on each other in Build', Object.values(dw.App.S.idea).some(x=>x && x.par));
  dw.model().items.forEach((it,i)=>dw.classify(it.id, i%3===0?'e':'a'));
  dw.goPhase('classify'); dw.goPhase('vote');
  await until(()=>Object.keys(dw.tallies(dw.model()).used).length>=6 && Object.values(dw.tallies(dw.model()).used).every(n=>n===5), 6000);
  check('they spend their votes in Vote', Object.values(dw.tallies(dw.model()).used).filter(n=>n===5).length>=6);
  check('a test drive makes no network calls', fetchesInDrive===0);
  dw.Bots.stop(); dw.stopLoops();

  /* ---------- sound ---------- */
  const SN = load(HOSTED + '#c=' + 'ZZZZ' + '&k=nokeynokey12&r=host', { seed:{ 'sf-sound':'on' } });
  await until(()=>SN.window.App.code==='ZZZZ');
  check('the sound choice is remembered', SN.window.Snd.on===true);
  SN.window.Snd.set(false);
  check('turning it off is remembered too', SN.window.localStorage.getItem('sf-sound')==='off');
  SN.window.stopLoops();
  check('laptops never play music', !/Snd\.music\([^)]*\)[^;]*pax/.test(html) && /music: function \(name, level\) \{\s*if \(App\.role !== "host"\) return;/.test(html));

  check('no script errors', errors.length===0);
  if (errors.length) console.log(errors.slice(0,5));
  doms.forEach(d=>{ try{ d.window.stopLoops(); d.window.close(); }catch(e){} });
  console.log(failures ? failures+' FAILED' : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e=>{ console.error(e); process.exit(1); });
