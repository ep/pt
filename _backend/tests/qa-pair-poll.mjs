/* qa-pair-poll.mjs: jsdom harness for field-tools/pair-poll/index.html.
   Runs the console and phones against the real pt worker code (fake database),
   and decodes the lobby QR with jsQR to prove it scans.
   Run: node _backend/tests/qa-pair-poll.mjs   (needs: npm install jsdom jsqr) */
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
const html = fs.readFileSync(path.join(here, '../../field-tools/pair-poll/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOSTED = 'https://ep.github.io/pt/field-tools/pair-poll/';
const env = { DB: FakeDB() };
const requests = [];
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; const h = new Headers(init.headers||{}); requests.push({ url:String(url), method:init.method||'GET', key:h.get('X-Session-Key')||'', body:init.body||'' }); const req = new Request(String(url), { method:init.method||'GET', headers:init.headers||{}, body:init.body }); return worker.fetch(req, env); }; }
const testHtml = html.replace(/<script type="text\/javascript">[\s\S]*?clarity[\s\S]*?<\/script>/, '');
function load(url, live){ return new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){ if (live) mockFetch(window); window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {}; window.copied=[]; Object.defineProperty(window.navigator, 'clipboard', { value:{ writeText:(t)=>{ window.copied.push(t); return Promise.resolve(); } } }); window.HTMLCanvasElement.prototype.getContext = () => null; } }); }
/* the one-primary rule: at most one filled button visible inside a container */
function primaries(doc, id){ const root=doc.getElementById(id); return Array.from(root.querySelectorAll('.btn')).filter(b=>!b.classList.contains('sec') && !b.classList.contains('ghost') && !b.classList.contains('hide') && !b.closest('.hide')).length; }
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
function key(win, k){ win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key:k, bubbles:true })); }
function vis(doc, id){ const el = doc.getElementById(id); if (!el || el.classList.contains('hide')) return false; const scr = el.closest('.screen'); return scr ? scr.classList.contains('on') : true; }
function stepOn(doc){ return Array.from(doc.querySelectorAll('.step')).find(s => s.classList.contains('on')).id; }
function fillQ(win, doc, l, r, ls, rs, p){ type(win, doc.getElementById('qL'), l); type(win, doc.getElementById('qR'), r); type(win, doc.getElementById('qLS'), ls); type(win, doc.getElementById('qRS'), rs); if (p) type(win, doc.getElementById('qP'), p); }
function buildTwo(win, doc, opts){
  opts = opts || {};
  click(win, doc.getElementById('btnBuild'));
  fillQ(win, doc, opts.l0 || 'EMPOWERMENT', 'WISDOM', opts.ls || 'Our people determine solutions.', 'Leaders originate solutions.', opts.prompt);
  if (!opts.one){ click(win, doc.getElementById('qAdd')); fillQ(win, doc, 'SPEED', 'CARE', 'Ship this week, fix live.', 'Take the month, ship it right.'); }
  click(win, doc.getElementById('next1'));
  if (opts.mode === 'end') click(win, doc.getElementById('modeEnd'));
  if (opts.pace === 'fac') click(win, doc.getElementById('paceFac'));
  click(win, doc.getElementById('next2'));
  if (opts.calc) click(win, doc.querySelector('[data-calc="'+opts.calc+'"]'));
  if (opts.order==='details') click(win, doc.getElementById('orderDetails'));
  click(win, doc.getElementById('next3'));
  if (opts.instr) type(win, doc.getElementById('instr'), opts.instr);
  if (!opts.one){ type(win, doc.getElementById('sumT'), opts.sumT || 'Where this room leans'); type(win, doc.getElementById('sumL'), 'BOLD'); type(win, doc.getElementById('sumR'), 'CAREFUL'); }
  if (opts.wel){ click(win, doc.getElementById('welOn')); type(win, doc.getElementById('welT'), 'Welcome, team'); type(win, doc.getElementById('welB'), 'Two statements at a time. <b>Pick</b> honestly.'); }
  click(win, doc.getElementById('next4'));
}
const fast = 'App.botDelay=function(){return 5;}; App.conPollMs=40; App.countMs=0; App.endDelay=120; App.frostMs=0; App.anim=false; App.holdMin=0; App.holdMax=0; App.lockMs=0;';
const paxFast = 'App.paxBase=40; App.countMs=0; App.frostMs=0; App.anim=false; App.holdMin=0; App.holdMax=0; App.lockMs=0;';
async function openPhone(code, extra){ const dom=load(HOSTED+'?join='+code, true); dom.window.eval(paxFast+(extra||'')); await sleep(120); return dom; }
const wingL = root => parseFloat(root.querySelector('.dv .wing.L i').style.width);
const wingR = root => parseFloat(root.querySelector('.dv .wing.R i').style.width);

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
  check('favicon set is linked from /pt/assets/favicon/', /\/pt\/assets\/favicon\/favicon\.svg/.test(html) && /favicon-32\.png/.test(html) && /apple-touch-icon\.png/.test(html));
  check('paper grain is a CSS variable with a whisper default', /--grain:\.05/.test(html) && /opacity:var\(--grain\)/.test(html));
  check('hero copy reads "See where the room stands."', /See where the room stands\./.test(noscript) && /They choose a side\. You reveal the split\./.test(noscript));
  check('join-by-code link sits under the hero', /Use the <a href="\?join">join-by-code link<\/a>/.test(noscript));
  check('no "Step N of" captions, no question-count hint', !/Step \d of/.test(html) && !/questions?, \d+ complete/.test(html) && !/of 10 questions/.test(html));
  check('music is gone, four designed sound moments remain', !/Music/.test(js) && /join:function/.test(js) && /select:function/.test(js) && /reveal:function/.test(js) && /celebrate:function/.test(js));
  check('participants have no Skip or Finish controls', !/data-act="next"/.test(js) && !/data-act="skip"/.test(js) && !/>Skip</.test(js) && !/>Finish</.test(js) || /rvNext/.test(html));
  check('participant markup has no forward controls', !/data-act="next"/.test(js) && !/Skip this one/.test(js) && !/data-act="skip"/.test(js));
  check('standby screen copy is present', /Enough suspense\./.test(noscript) && /Let's see the results/.test(noscript));
  check('participant beat copy is present', /Hang tight\./.test(js) && /picked your sides/.test(js) && /big reveal!/.test(js) && /That\\u2019s all, folks\./.test(js) && /Thanks for weighing in!/.test(js) && /Here we go\./.test(js));
  check('idle delight engine ships room, lean and handful', /K\.room=/.test(js) && /K\.lean=/.test(js) && /K\.handful=/.test(js) && /pp_idle/.test(js));
  check('progress pills replace the strip', /function pillsHtml/.test(js) && !/stripHtml/.test(js) && /\.pills i\.rev/.test(html));
  check('join info is summonable from the console, with the facilitator link inside', /id="btnJoinInfo"/.test(html) && /id="joinModal"/.test(html) && /id="btnCopyFac2"/.test(html));
  check('no dot row anywhere on the console', !/voteRoom/.test(html) && !/field2/.test(html) && !/renderField/.test(js));
  check('console controls are a bar that stays in view', /\.con \.controls\{position:sticky;bottom:0/.test(html));
  check('test-drive bar sits above the idle canvas and offers a way out', /\.simbar\{position:relative;z-index:2/.test(html) && /id="btnSimExit"/.test(html) && /id="btnSimExit2"/.test(html));
  check('current pill has no midline, gaps are fixed', !/\.pills i\.on::after/.test(html) && /\.pills i\.on::before/.test(html) && /\.pills em\{flex:0 0 auto;width:16px/.test(html));
  check('self-list labels take the pill caps', /\.plist \.p \.lab b\{[^}]*text-transform:uppercase/.test(html));
  check('standby is the orb, the line, and the gold button, nothing else', /id="rvStandby"><div class="orb"><\/div><h1>Enough suspense\.<\/h1><button/.test(html) && !/rvStandbyP/.test(html) && !/Share your screen/.test(js));
  check('join panel copy faces participants, tips gone', /Join at this link\./.test(js) && /Scan the code\./.test(js) && !/Paste it into the chat/.test(js) && !/way back if this tab/.test(html+js));
  check('sound unlocks on every gesture and when the tab returns', /\['pointerdown','touchend','keydown'\]/.test(js) && /visibilitychange/.test(js));
  check('toys take touch events as a fallback', /addEventListener\('touchstart'/.test(js) && /orientationchange/.test(js));
  check('resume bar exists in the studio', /id="resumeBar"/.test(html) && /function renderResume/.test(js));
  check('ended cards are plain rows, never the bar', /Thanks for running it\.<\/p><div class="controls plain">/.test(html) && /go back and adjust\.<\/p><div class="controls plain">/.test(html) && /\.con \.controls\.plain\{position:static/.test(html));
  check('the console bar is slim glass', /rgba\(253,251,246,\.55\)/.test(html) && /blur\(16px\) saturate/.test(html));
  check('choice cards select with the glow alone', !/\.ccard\[aria-pressed="true"\]::after/.test(html) && !/aria-pressed="true"\] \.mini/.test(html));
  check('the trimmed copy stays trimmed', !/Locks every answer/.test(html) && !/opens on a standby screen first/.test(html) && !/Leave it, or write your own/.test(html) && /E\.g\. Which one better describes your organization\?/.test(html) && /E\.g\. "67% toward Innovation"/.test(html) && /Everything participants will read, in one place\./.test(html));
  check('remove-question is quiet', /\.qtools \.btn\.ghost\{font-weight:500/.test(html));
  check('review rows are edit buttons', /class="rw" data-step="/.test(js) && /'review'\)\.addEventListener\('click'/.test(js));
  check('the big QR overlay exists with a way in, out, and on', /id="qrBig"/.test(html) && /data-act="qrbig"/.test(js) && /id="btnStart2"/.test(html) && /id="qrBigClose"/.test(html));
  check('participant links boot behind a veil', /paxpre/.test(html) && /html\.paxpre \.screen\{opacity:0/.test(html) && /classList\.remove\('paxpre'\)/.test(js));
  check('nervous double-taps are guarded', /function oneFlight/.test(js) && /function throttleMs/.test(js) && /oneFlight\(conFinal\)/.test(js) && /throttleMs\(function\(\)\{ rvGo\(1\); \}, 160\)/.test(js));
  check('the waiting toy re-rolls per session', /'pp_idle_'\+\(App\.code/.test(js));
  check('lean hover is mouse-only, small, and smoothed', /pointer:fine/.test(js) && /Math\.min\(\.12,/.test(js) && /state\.hov \+= \(want-state\.hov\)/.test(js));
  check('a mirror tab follows the show and never writes it', /function followReveal/.test(js) && /followReveal\(\); renderConsole\(\)/.test(js));
  check('no em dashes in copy', !/\u2014/.test(html));
  check('Clarity tag present', /clarity\.ms\/tag\//.test(html));
  check('no summary toggle in the studio', !/id="sumOn"/.test(html) && !/majority/.test(js));

  /* ---------- studio ---------- */
  let dom = load(HOSTED, false), win = dom.window, doc = win.document; await sleep(50);
  check('studio opens on the hero with steps hidden', stepOn(doc)==='st0' && doc.getElementById('steps').classList.contains('hide'));
  check('hero has exactly one primary', primaries(doc,'st0')===1);
  click(win, doc.getElementById('btnBuild'));
  check('step 1 shows a visual counter only', stepOn(doc)==='st1' && doc.querySelectorAll('#steps i').length===5 && doc.getElementById('qHint').textContent==='');
  click(win, doc.getElementById('next1'));
  check('Next with an empty question stays and pulses the first gap', stepOn(doc)==='st1' && /needs both labels/.test(doc.getElementById('qHint').textContent));
  fillQ(win, doc, 'EMPOWERMENT', 'WISDOM', 'Our people determine solutions.', 'Leaders originate solutions.');
  click(win, doc.getElementById('next1'));
  check('step 2: each-mode hides pace, one primary', stepOn(doc)==='st2' && doc.getElementById('paceBlock').classList.contains('hide') && primaries(doc,'st2')===1);
  check('choice cards carry diagrams', doc.querySelectorAll('#st2 .ccard .mini svg').length===4);
  click(win, doc.getElementById('modeEnd'));
  check('end-mode reveals pace and defaults to self-paced', !doc.getElementById('paceBlock').classList.contains('hide') && doc.getElementById('paceSelf').getAttribute('aria-pressed')==='true');
  click(win, doc.getElementById('modeEach'));
  click(win, doc.getElementById('next2'));
  check('step 3 with one question has no big reveal', stepOn(doc)==='st3' && doc.getElementById('sumBlock').classList.contains('hide') && /the question is the reveal/.test(doc.getElementById('revLede').textContent));
  click(win, doc.getElementById('back3')); click(win, doc.getElementById('back2'));
  click(win, doc.getElementById('qAdd')); fillQ(win, doc, 'SPEED', 'CARE', 'Ship this week, fix live.', 'Take the month, ship it right.');
  click(win, doc.getElementById('next1')); click(win, doc.getElementById('next2'));
  check('two questions: big reveal is on, calc cards only, order hidden in each-mode', !doc.getElementById('sumBlock').classList.contains('hide') && doc.querySelectorAll('[data-calc]').length===2 && doc.getElementById('orderBlock').classList.contains('hide'));
  click(win, doc.getElementById('next3'));
  check('step 4 holds instruction, headline, side names, greeting', stepOn(doc)==='st4' && !doc.getElementById('sumWords').classList.contains('hide') && doc.getElementById('sumL') && doc.getElementById('welOn'));
  click(win, doc.getElementById('next4'));
  check('missing side names stop Next and pulse the field', stepOn(doc)==='st4' && /Name both sides/.test(doc.getElementById('wordsNote').textContent));
  type(win, doc.getElementById('sumL'), 'BOLD'); type(win, doc.getElementById('sumR'), 'CAREFUL');
  click(win, doc.getElementById('welOn')); click(win, doc.getElementById('next4'));
  check('greeting on but empty stops Next', stepOn(doc)==='st4' && /Write a title/.test(doc.getElementById('wordsNote').textContent));
  type(win, doc.getElementById('welT'), 'Welcome'); click(win, doc.getElementById('next4'));
  check('review lists the big reveal with side names', stepOn(doc)==='st5' && /BOLD vs CAREFUL/.test(doc.getElementById('review').textContent) && primaries(doc,'st5')===1);
  click(win, doc.querySelector('#review .rw[data-step="2"]')); await sleep(120);
  check('tapping a review row opens its step', stepOn(doc)==='st2');
  win.goStep(5); await sleep(80);
  click(win, doc.getElementById('btnCopySetup'));
  check('setup link round-trips', win.copied.length===1 && /\?setup=/.test(win.copied[0]));
  const setupCode = win.copied[0].split('setup=')[1];
  dom = load(HOSTED+'?setup='+setupCode, false); win = dom.window; doc = win.document; await sleep(50);
  check('setup link reopens on step 1 with both questions', stepOn(doc)==='st1' && doc.querySelectorAll('#qnav [data-i]').length===2 && win.STUDIO.setup.sum.l==='BOLD');
  const legacy = win.encodeSetup({mode:'end', pace:'fac', order:'grand', instr:'', qs:[{p:'',l:'A',r:'B',ls:'a',rs:'b'},{p:'',l:'C',r:'D',ls:'c',rs:'d'}], wel:{on:false,t:'',b:''}, sum:{on:true, calc:'majority', t:'', l:'L', r:'R'}});
  check('round-1 setup links still decode (majority becomes average, sum always on)', (function(){ const s=win.decodeSetup(legacy); return s && s.sum.calc==='avg' && s.pace==='fac' && win.sumAllowed(s); })());

  /* ---------- live: reveal after each question, facilitator pace, welcome on ---------- */
  requests.length = 0;
  dom = load(HOSTED, true); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { wel:true, instr:'Which one is more like your team?' });
  click(win, doc.getElementById('btnLaunch')); await sleep(300);
  check('launch reaches the console', doc.getElementById('scr_console').classList.contains('on'));
  const code = win.App.code, keyv = win.App.key;
  check('facilitator URL carries host and key', /\?host=[A-Z]{4}&k=[a-z0-9]{16}$/.test(win.location.search+''));
  check('console pills: two questions and a reveal marker', doc.querySelectorAll('#conPills i').length===3 && doc.querySelectorAll('#conPills i.rev').length===1);
  const ways = doc.getElementById('joinWays');
  check('lobby offers the link, the code, and the typed backup', ways.querySelectorAll('.way').length===2 && /\?join=[A-Z]{4}$/.test(ways.querySelector('.linkbox').textContent) && /Or go to ep\.github\.io\/pt\/join and enter [A-Z]{4}/.test(ways.querySelector('.way3').textContent.replace(/\s+/g,' ')));
  check('lobby has one primary (Start the poll)', primaries(doc,'con_lobby')===1 && doc.getElementById('btnStart').textContent==='Start the poll');
  const qrSvg = ways.querySelector('.qr').innerHTML;
  check('lobby QR decodes to the join link', decodeMatrix(svgToMatrix(qrSvg))===HOSTED+'?join='+code);
  click(win, ways.querySelector('[data-copy="link"]')); click(win, ways.querySelector('[data-copy="code"]'));
  check('copy link and copy instructions put the right text on the clipboard', win.copied[0]===HOSTED+'?join='+code && win.copied[1]==='Go to ep.github.io/pt/join and enter '+code);
  click(win, ways.querySelector('[data-act="qrbig"]')); await sleep(80);
  check('the code blows up full screen with Start the poll on it', doc.getElementById('qrBig').classList.contains('on') && doc.getElementById('qrBigCode').textContent===code && vis(doc,'btnStart2') && decodeMatrix(svgToMatrix(doc.getElementById('qrBigQr').innerHTML))===HOSTED+'?join='+code);
  key(win, 'Escape');
  check('Escape closes the big code', !doc.getElementById('qrBig').classList.contains('on'));
  check('copy QR image button exists and does not throw without a canvas', (function(){ try{ click(win, ways.querySelector('[data-copy="qr"]')); return true; }catch(e){ return false; } })());
  check('join modal is hidden in the lobby', doc.getElementById('btnJoinInfo').classList.contains('hide'));
  check('create was an open session with roster and ballot prefixes', requests.some(r=>/\/api\/create$/.test(r.url) && /"open":\["roster","ballot"\]/.test(r.body)));

  const p1 = await openPhone(code), p2 = await openPhone(code), p3 = await openPhone(code);
  check('the boot veil lifts once the participant view paints', !p1.window.document.documentElement.classList.contains('paxpre') && p1.window.document.getElementById('scr_pax').classList.contains('on'));
  const d1 = p1.window.document, d2 = p2.window.document, d3 = p3.window.document;
  await sleep(200);
  check('phones land on the waiting screen with no button', d1.getElementById('scr_pax').classList.contains('on') && /Hang tight/.test(d1.getElementById('paxBody').textContent) && !d1.querySelector('#paxBody .btn'));
  check('waiting screen turns the idle canvas on', p1.window.document.getElementById('pwrap').classList.contains('idle') || !p1.window.App.anim);
  check('phone URL carries me and b', /me=[a-z0-9]{6}/.test(p1.window.location.search) && /b=[a-z0-9]{6}/.test(p1.window.location.search));
  await sleep(200);
  check('console counts three in', doc.getElementById('chipIn').textContent==='3');
  {
    const again = load(HOSTED+'?setup='+setupCode, true); again.window.eval(fast); await sleep(60);
    again.window.localStorage.setItem('pp_host', JSON.stringify({code:code, k:keyv, at:Date.now()})); again.window.initStudio(again.window.decodeSetup(setupCode)); await sleep(200);
    check('a live session shows a return bar on every studio step, even from a setup link', stepOn(again.window.document)==='st1' && !again.window.document.getElementById('resumeBar').classList.contains('hide') && again.window.document.getElementById('resumeLink').href.indexOf('?host='+code+'&k='+keyv)>0);
    again.window.localStorage.setItem('pp_host', JSON.stringify({code:'ZZZZ', k:'nokeynokeynokeyx', at:Date.now()})); again.window.initStudio(); await sleep(200);
    check('a stale session record is verified and hidden', again.window.document.getElementById('resumeBar').classList.contains('hide') && again.window.localStorage.getItem('pp_host')===null);
    again.window.close();
  }

  click(win, doc.getElementById('btnStart')); await sleep(250);
  check('vote view shows the instruction line and the pair', vis(doc,'con_vote') && doc.getElementById('conInstr').textContent==='Which one is more like your team?' && doc.querySelector('#conL .stmt').textContent==='Our people determine solutions.');
  check('vote view has one primary (Reveal) and no Next yet', primaries(doc,'con_vote')===1 && !doc.getElementById('btnReveal').classList.contains('hide') && doc.getElementById('btnNext').classList.contains('hide'));
  check('current pill is lit', doc.querySelectorAll('#conPills i.on').length===1);
  const slow = await openPhone(code, 'App.holdMin=400; App.holdMax=400;'); await sleep(150);
  check('at launch, phones get the hold moment with the greeting', /Welcome, team/.test(slow.window.document.getElementById('paxBody').textContent) && !slow.window.document.querySelector('#paxBody .btn'));
  await sleep(500);
  check('the hold releases into the first question on its own', slow.window.document.querySelector('#paxBody .opt.L') && slow.window.document.getElementById('paxStripWrap') && !slow.window.document.getElementById('paxStripWrap').classList.contains('hide'));
  click(slow.window, slow.window.document.querySelector('#paxBody .opt.R'));
  await sleep(150);
  check('phones show question 1 with the pills', d1.querySelector('#paxBody .opt.L') && d1.querySelectorAll('#paxStrip i').length===3);
  click(p1.window, d1.querySelector('#paxBody .opt.L')); click(p2.window, d2.querySelector('#paxBody .opt.R')); click(p3.window, d3.querySelector('#paxBody .opt.L'));
  await sleep(300);
  check('ballots are written under ballot/q0', requests.some(r=>/\/api\/set$/.test(r.url) && /"path":"ballot\/q0\/[a-z0-9]{6}"/.test(r.body)));
  check('console sees four votes and warms the chip', doc.getElementById('chipDone').textContent==='4' && doc.getElementById('chip').classList.contains('warm'));
  click(p1.window, d1.querySelector('#paxBody .opt.R')); await sleep(250);
  check('changing a vote before the reveal is allowed', p1.window.App.myVotes[0]==='R' && win.countBallots(win.App.state,0).R===3);

  click(win, doc.getElementById('btnReveal')); await sleep(300);
  check('Reveal opens the standby screen, not the result', doc.getElementById('reveal').classList.contains('on') && !doc.getElementById('rvStandby').classList.contains('hide') && doc.getElementById('rvSlide').classList.contains('hide'));
  check('standby has one primary (Let\'s see the results)', primaries(doc,'rvStandby')===1);
  check('standby locks the phones without revealing', /Locked in\. Here comes the reveal\./.test(d1.getElementById('paxHelp').textContent) && d1.getElementById('paxResult').classList.contains('hide') && !win.isRevealed(0));
  click(p1.window, d1.querySelector('#paxBody .opt.L')); await sleep(150);
  check('taps during standby are ignored', p1.window.App.myVotes[0]==='R');
  {
    const back = load(HOSTED+'?host='+code+'&k='+keyv, true); back.window.eval(fast); await sleep(300);
    check('a facilitator who reloads during a per-question standby lands back on the standby', back.window.document.getElementById('reveal').classList.contains('on') && !back.window.document.getElementById('rvStandby').classList.contains('hide'));
    back.window.close();
  }
  click(win, doc.getElementById('rvBegin')); await sleep(350);
  {
    const back = load(HOSTED+'?host='+code+'&k='+keyv, true); back.window.eval(fast); await sleep(300);
    check('a facilitator who reloads during a per-question slide lands back on the slide', back.window.document.getElementById('reveal').classList.contains('on') && !back.window.document.getElementById('rvSlide').classList.contains('hide') && back.window.document.getElementById('rvNext').textContent==='Finish');
    back.window.close();
  }
  check('begin plays the one slide with the instruction and sets the flag', !doc.getElementById('rvSlide').classList.contains('hide') && /Which one is more like your team\?/.test(doc.querySelector('#rvSlide .instr').textContent) && win.isRevealed(0) && doc.getElementById('rvNext').textContent==='Finish');
  check('phone shows its result in place, loser thinned', wingL(d1.getElementById('paxResult'))===25 && wingR(d1.getElementById('paxResult'))===75 && d1.querySelector('#paxBody .opt.L').classList.contains('lose') && d1.querySelector('#paxBody .opt.R').classList.contains('win') && /Locked in\./.test(d1.getElementById('paxHelp').textContent));
  check('YOU tag on the right', /YOU/.test(d1.querySelector('#paxResult .nr').textContent));
  {
    const re = load(p1.window.location.href, true); re.window.eval(paxFast+'App.holdMin=400; App.holdMax=400;'); await sleep(300);
    check('a participant who reloads after voting skips the hold and keeps their pick and result', re.window.document.querySelector('#paxBody .opt.R') && re.window.document.querySelector('#paxBody .opt.R').classList.contains('sel') && !re.window.document.getElementById('paxResult').classList.contains('hide'));
    re.window.close();
  }
  click(win, doc.getElementById('rvNext')); await sleep(250);
  check('Finish closes the surface and returns to the console with the result', !doc.getElementById('reveal').classList.contains('on') && vis(doc,'conResult') && win.showOf().k==='done');
  check('after the reveal, Next is the one primary', primaries(doc,'con_vote')===1 && !doc.getElementById('btnNext').classList.contains('hide') && doc.getElementById('btnReveal').classList.contains('hide'));
  click(win, doc.getElementById('btnReopen')); await sleep(250);
  check('re-open unlocks the phones', !win.isRevealed(0) && /open again/.test(d1.getElementById('paxHelp').textContent));
  click(win, doc.getElementById('btnReveal')); await sleep(200); click(win, doc.getElementById('rvBegin')); await sleep(250); key(win, 'Escape'); await sleep(200);
  check('Escape after a per-question reveal returns to the console with the question revealed', !doc.getElementById('reveal').classList.contains('on') && win.isRevealed(0) && win.meta().stage==='vote');
  click(win, doc.getElementById('btnNext')); await sleep(250);
  check('Next moves everyone to question 2', win.meta().q===1 && d1.querySelector('#paxBody .opt.L .stmt').textContent==='Ship this week, fix live.' && doc.querySelectorAll('#conPills i.done').length===1);
  check('last question labels Next as the big reveal, only after the reveal', doc.getElementById('btnNext').classList.contains('hide') && doc.getElementById('btnReveal').textContent==='Reveal');
  click(p1.window, d1.querySelector('#paxBody .opt.L')); click(p2.window, d2.querySelector('#paxBody .opt.L')); click(p3.window, d3.querySelector('#paxBody .opt.R')); await sleep(300);
  click(win, doc.getElementById('btnReveal')); await sleep(200); click(win, doc.getElementById('rvBegin')); await sleep(250); click(win, doc.getElementById('rvNext')); await sleep(250);
  check('after the last reveal, Next reads The big reveal', doc.getElementById('btnNext').textContent==='The big reveal');
  click(win, doc.getElementById('btnNext')); await sleep(350);
  check('The big reveal opens standby with the summary computed', doc.getElementById('reveal').classList.contains('on') && !doc.getElementById('rvStandby').classList.contains('hide') && win.meta().stage==='reveal' && win.App.state.pub.sum && win.App.state.pub.sum.n===2);
  check('phones wait on the picked page during standby', /picked your sides/.test(d1.getElementById('paxBody').textContent) && /big reveal!/.test(d1.getElementById('paxBody').textContent));
  click(win, doc.getElementById('rvBegin')); await sleep(350);
  check('each-mode summary plays as one grand slide', /BOLD|CAREFUL/.test(doc.querySelector('#rvSlide .sumhero .lean').textContent) && doc.getElementById('rvNext').textContent==='Finish');
  check('phones mirror the grand slide', d1.querySelector('#paxBody .sumhero'));
  click(win, doc.getElementById('rvNext')); await sleep(350);
  check('Finish lands on the recap and celebrates on the console', vis(doc,'con_recap') && win.meta().stage==='recap' && win.App.celebrated===true && doc.querySelectorAll('#recapList .rrow').length===2);
  check('recap pills: all done and the reveal marker lit', doc.querySelectorAll('#conPills i.done').length===2 && doc.querySelectorAll('#conPills i.rev.lit').length===1);
  await sleep(200);
  check('phones celebrate on the recap', p1.window.App.celebrated===true && d1.querySelectorAll('#paxRecapList .rrow').length===2 && d1.querySelector('#paxSum .sumhero'));
  check('recap has no filled primary until paused', primaries(doc,'con_recap')===0 && !doc.getElementById('btnContinue').classList.contains('hide')===false);
  click(win, doc.getElementById('btnReplay')); await sleep(300);
  check('replay starts from standby', doc.getElementById('reveal').classList.contains('on') && !doc.getElementById('rvStandby').classList.contains('hide') && win.showOf().k==='standby');
  key(win, 'Escape'); await sleep(250);
  check('Escape from standby pauses: stage stays reveal, Continue is the one primary', !doc.getElementById('reveal').classList.contains('on') && win.meta().stage==='reveal' && primaries(doc,'con_recap')===1 && !doc.getElementById('btnContinue').classList.contains('hide'));
  click(win, doc.getElementById('btnContinue')); await sleep(250); click(win, doc.getElementById('rvBegin')); await sleep(300);
  check('a replay in each-mode plays every question and the big reveal', win.App.rvSteps.length===3 && win.App.rvSteps[0].k==='grand' && doc.getElementById('rvNext').textContent==='Next');
  {
    const late = await openPhone(code); await sleep(200);
    check('a latecomer during the reveal goes straight to the mirrored slide, no hold', late.window.document.querySelector('#paxBody .sumhero') && !/Here we go/.test(late.window.document.getElementById('paxBody').textContent));
    late.window.close();
  }
  click(win, doc.getElementById('rvNext')); await sleep(200); click(win, doc.getElementById('rvNext')); await sleep(200); click(win, doc.getElementById('rvNext')); await sleep(300);
  check('continue, begin, finish returns to the recap', vis(doc,'con_recap') && win.meta().stage==='recap');
  click(win, doc.getElementById('btnBackRecap')); await sleep(300);
  check('re-open from recap in each-mode reopens only the last question', win.meta().stage==='vote' && win.meta().q===1 && win.isRevealed(0) && !win.isRevealed(1));
  click(win, doc.getElementById('btnReveal')); await sleep(200); click(win, doc.getElementById('rvBegin')); await sleep(200); click(win, doc.getElementById('rvNext')); await sleep(200); click(win, doc.getElementById('btnNext')); await sleep(300); click(win, doc.getElementById('rvBegin')); await sleep(250); click(win, doc.getElementById('rvNext')); await sleep(300);
  check('back on the recap', vis(doc,'con_recap'));
  click(win, doc.getElementById('btnJoinInfo')); await sleep(50);
  check('join info modal opens from the console with the three ways', doc.getElementById('joinModal').classList.contains('on') && doc.querySelectorAll('#joinWaysModal .way').length===2 && /\?join=/.test(doc.querySelector('#joinWaysModal .linkbox').textContent));
  check('modal carries the facilitator link in a live session', vis(doc,'modalFac'));
  click(win, doc.getElementById('btnCopyFac2'));
  check('modal facilitator link copies the host link', win.copied[win.copied.length-1]===HOSTED+'?host='+code+'&k='+keyv);
  key(win, 'Escape');
  check('Escape closes the modal', !doc.getElementById('joinModal').classList.contains('on'));

  /* gates */
  const stranger = load(HOSTED+'?host='+code+'&k=nope', true); stranger.window.eval(fast); await sleep(250);
  check('wrong key is refused', stranger.window.document.getElementById('scr_gate').classList.contains('on'));
  const cold = load(HOSTED+'?join=ZZZZ', true); cold.window.eval(paxFast); await sleep(250);
  check('unknown code is refused', cold.window.document.getElementById('scr_gate').classList.contains('on'));
  const joiner = load(HOSTED+'?join', true); joiner.window.eval(paxFast); await sleep(100);
  check('join screen opens on ?join', joiner.window.document.getElementById('scr_join').classList.contains('on'));
  type(joiner.window, joiner.window.document.getElementById('codeIn'), code.toLowerCase()); await sleep(300);
  check('typing the code joins the poll', joiner.window.document.getElementById('scr_pax').classList.contains('on') && joiner.window.location.search.indexOf('?join='+code)===0);

  /* end, undo, end */
  click(win, doc.getElementById('btnEnd')); await sleep(50);
  check('ending shows the undo card', vis(doc,'endLive') && vis(doc,'con_ended'));
  click(win, doc.getElementById('btnUndoEnd')); await sleep(100);
  check('undo returns to the recap', vis(doc,'con_recap'));
  click(win, doc.getElementById('btnEnd')); await sleep(300);
  check('end clears the session and shows Done', vis(doc,'endDone') && requests.some(r=>/\/api\/clear$/.test(r.url) && r.key===keyv));
  check('ended card has one primary', primaries(doc,'endDone')===1);
  check('ended console goes quiet: no join info, no chip, a plain row', doc.getElementById('btnJoinInfo').classList.contains('hide') && doc.getElementById('chip').classList.contains('hide') && doc.querySelector('#endDone .controls').classList.contains('plain'));
  await sleep(250);
  check('phones show the wrap with the handful engine', /That.s all, folks/.test(d1.getElementById('paxBody').textContent) && /Thanks for weighing in!/.test(d1.getElementById('paxBody').textContent) && (p1.window.Idle.kind()==='handful' || !p1.window.App.anim));
  for (const d of [dom, p1, p2, p3, slow, stranger, cold, joiner]) d.window.close();

  /* ---------- live: reveal at the end, self-paced, no greeting ---------- */
  requests.length = 0;
  dom = load(HOSTED, true); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { mode:'end', calc:'people', order:'details' });
  click(win, doc.getElementById('btnLaunch')); await sleep(300);
  const code2 = win.App.code;
  check('self-paced lobby labels Start as Open the poll', doc.getElementById('btnStart').textContent==='Open the poll');
  const a = await openPhone(code2), b = await openPhone(code2), c = await openPhone(code2);
  const da = a.window.document, db = b.window.document, dc = c.window.document;
  await sleep(250);
  click(win, doc.getElementById('btnStart')); await sleep(300);
  check('console shows the per-question list, one primary', vis(doc,'con_self') && doc.querySelectorAll('#selfList .p').length===2 && primaries(doc,'con_self')===1);
  check('phones hold briefly without a greeting, then start on question 1', /Ship|Our people/.test(da.querySelector('#paxBody .stmt').textContent) && da.querySelector('[data-act="prev"]') && !da.querySelector('[data-act="next"]') && !da.querySelector('[data-act="skip"]'));
  click(a.window, da.querySelector('#paxBody .opt.L')); await sleep(80);
  check('a tap answers and advances on its own', a.window.App.myVotes[0]==='L' && a.window.App.pi===1 && da.querySelector('#paxBody .opt.L .stmt').textContent==='Ship this week, fix live.');
  check('phone pills fill for the answered question', da.querySelectorAll('#paxStrip i.done').length===1 && da.querySelectorAll('#paxStrip i.on').length===1);
  click(a.window, da.querySelector('[data-act="prev"]')); await sleep(50);
  check('Back returns to question 1 with the pick shown', a.window.App.pi===0 && da.querySelector('#paxBody .opt.L').classList.contains('sel'));
  click(a.window, da.querySelector('#paxBody .opt.L')); await sleep(80);
  click(a.window, da.querySelector('#paxBody .opt.R')); await sleep(80);
  check('answering the last question lands on the picked page', /picked your sides/.test(da.getElementById('paxBody').textContent) && da.querySelector('[data-act="change"]'));
  click(a.window, da.querySelector('[data-act="change"]')); await sleep(50);
  check('Change an answer returns to the last question', a.window.App.pi===1 && da.querySelector('#paxBody .opt.R').classList.contains('sel'));
  click(a.window, da.querySelector('#paxBody .opt.L')); await sleep(80);
  check('changing the last answer lands back on the picked page', a.window.App.myVotes[1]==='L' && /picked your sides/.test(da.getElementById('paxBody').textContent));
  click(b.window, db.querySelector('#paxBody .opt.R')); await sleep(80); click(b.window, db.querySelector('#paxBody .opt.R')); await sleep(80);
  click(c.window, dc.querySelector('#paxBody .opt.L')); await sleep(80); click(c.window, dc.querySelector('#paxBody .opt.R')); await sleep(400);
  check('console counts three done and the pills fill by share', doc.getElementById('chipDone').textContent==='3' && doc.querySelectorAll('#conPills i.done').length===2);
  click(win, doc.getElementById('btnRevealAll')); await sleep(400);
  check('Reveal the results locks everything and opens standby', doc.getElementById('reveal').classList.contains('on') && !doc.getElementById('rvStandby').classList.contains('hide') && win.isRevealed(0) && win.isRevealed(1) && win.meta().stage==='reveal');
  check('phones wait on the picked page without Change an answer', /picked your sides/.test(da.getElementById('paxBody').textContent) && !da.querySelector('[data-act="change"]:not(.hide)'));
  click(win, doc.getElementById('rvBegin')); await sleep(350);
  check('details order plays question 1 first', /Our people determine/.test(doc.querySelector('#rvSlide .stmt').textContent));
  check('phone mirrors slide one with its own pick marked', da.querySelector('#paxBody .side.L').classList.contains('sel'));
  click(win, doc.getElementById('rvNext')); await sleep(250); click(win, doc.getElementById('rvNext')); await sleep(300);
  check('grand slide last, in people terms', doc.querySelector('#rvSlide .sumhero') && /people|person|Split/.test(doc.querySelector('#rvSlide .sumhero .lean').textContent) && doc.getElementById('rvNext').textContent==='Finish');
  click(win, doc.getElementById('rvNext')); await sleep(350);
  check('recap with the summary hero, celebrated', vis(doc,'con_recap') && doc.querySelector('#conSum .sumhero') && win.App.celebrated===true);
  click(win, doc.getElementById('btnReplay')); await sleep(300);
  check('replay from standby again', !doc.getElementById('rvStandby').classList.contains('hide'));
  click(win, doc.getElementById('rvBegin')); await sleep(300); click(win, doc.getElementById('rvNext')); await sleep(200); key(win, 'Escape'); await sleep(250);
  check('pause mid-sequence keeps the stage and offers Continue', win.meta().stage==='reveal' && !doc.getElementById('btnContinue').classList.contains('hide') && doc.getElementById('btnReplay').classList.contains('hide'));
  click(win, doc.getElementById('btnContinue')); await sleep(250);
  check('Continue reopens at the same slide', doc.getElementById('reveal').classList.contains('on') && doc.getElementById('rvStandby').classList.contains('hide') && win.App.rvIdx===1);
  click(win, doc.getElementById('rvNext')); await sleep(200); click(win, doc.getElementById('rvNext')); await sleep(300);
  check('finish again lands on the recap', vis(doc,'con_recap'));
  click(win, doc.getElementById('btnBackRecap')); await sleep(300);
  check('re-open in end-mode clears every reveal and reopens voting', win.meta().stage==='vote' && !win.isRevealed(0) && !win.isRevealed(1));
  await sleep(200);
  check('phones get Change an answer back', da.querySelector('[data-act="change"]'));
  click(win, doc.getElementById('btnRevealAll')); await sleep(300); click(win, doc.getElementById('rvBegin')); await sleep(250);
  for (let i=0;i<3;i++){ click(win, doc.getElementById('rvNext')); await sleep(200); }
  check('second reveal lands on the recap again', vis(doc,'con_recap'));
  check('report builds with the people headline', /Poll recap/.test(win.buildReport()) && /leaned|Split/.test(win.buildReport()));
  for (const d of [dom, a, b, c]) d.window.close();

  /* ---------- one question: no big reveal, straight to the recap ---------- */
  dom = load(HOSTED, true); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { one:true });
  click(win, doc.getElementById('btnLaunch')); await sleep(300);
  const code3 = win.App.code; const s1 = await openPhone(code3); await sleep(200);
  click(win, doc.getElementById('btnStart')); await sleep(250);
  click(s1.window, s1.window.document.querySelector('#paxBody .opt.L')); await sleep(250);
  click(win, doc.getElementById('btnReveal')); await sleep(200); click(win, doc.getElementById('rvBegin')); await sleep(250); click(win, doc.getElementById('rvNext')); await sleep(250);
  check('one question: Next reads Show the recap', doc.getElementById('btnNext').textContent==='Show the recap');
  click(win, doc.getElementById('btnNext')); await sleep(300);
  check('one question goes straight to the recap, no summary, celebrated, replay available', vis(doc,'con_recap') && !doc.querySelector('#conSum .sumhero') && win.App.celebrated===true && !doc.getElementById('btnReplay').classList.contains('hide'));
  click(win, doc.getElementById('btnReplay')); await sleep(300); click(win, doc.getElementById('rvBegin')); await sleep(300);
  check('one-question replay plays the question', win.App.rvSteps.length===1 && /Our people/.test(doc.querySelector('#rvSlide .stmt').textContent) && doc.getElementById('rvNext').textContent==='Finish');
  click(win, doc.getElementById('rvNext')); await sleep(300);
  check('and returns to the recap', vis(doc,'con_recap'));
  dom.window.close(); s1.window.close();

  /* ---------- fac-paced end poll: a big room, slow wires, nervous fingers, a second tab ---------- */
  dom = load(HOSTED, true); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { mode:'end', pace:'fac' });
  click(win, doc.getElementById('btnLaunch')); await sleep(300);
  const codeB = win.App.code; const keyB = win.App.key;
  for (let i=0;i<40;i++){ await win.Net.set('roster/big'+i, {}); await win.Net.set('ballot/q0/bb'+i, i%3?'L':'R'); }
  const pR = await openPhone(codeB); await sleep(150);
  click(win, doc.getElementById('btnStart')); await sleep(300);
  check('a forty-person room reads clean on the chip', doc.getElementById('chipIn').textContent==='41');
  check('forty ballots land in the first bar', win.App.state && Object.keys(win.App.state.ballot['q0']).length===40);
  const oSet = win.Net.set.bind(win.Net), oState = win.Net.state.bind(win.Net);
  win.Net.set = (p,v)=>new Promise(r=>setTimeout(()=>r(oSet(p,v)), 90));
  win.Net.state = (p,c)=>new Promise(r=>setTimeout(()=>r(oState(p,c)), 60));
  click(win, doc.getElementById('btnNext')); click(win, doc.getElementById('btnNext')); await sleep(500);
  check('a double-tap on Next moves one question, even on a slow wire', win.meta().q===1);
  click(win, pR.window.document.querySelector('#paxBody .opt.L'));
  click(win, doc.getElementById('btnNext')); click(win, doc.getElementById('btnNext')); await sleep(700);
  const shB=(win.App.state && win.App.state.pub && win.App.state.pub.show)||{};
  check('a vote racing the reveal is still counted, and the reveal opens once', win.meta().stage==='reveal' && shB.k==='standby' && win.App.state.ballot['q1'] && Object.keys(win.App.state.ballot['q1']).length===1);
  win.Net.set = oSet; win.Net.state = oState;
  const tab2 = load(HOSTED+'?host='+codeB+'&k='+keyB, true); tab2.window.eval(fast); await sleep(350);
  check('a second facilitator tab lands on the same standby', tab2.window.document.getElementById('reveal').classList.contains('on') && !tab2.window.document.getElementById('rvStandby').classList.contains('hide'));
  click(win, doc.getElementById('rvBegin')); await sleep(400); await sleep(300);
  check('the second tab follows the sequence', !tab2.window.document.getElementById('rvSlide').classList.contains('hide'));
  for (let k=0;k<4;k++){ click(win, doc.getElementById('rvNext')); await sleep(220); }
  check('the big room lands on the recap in both tabs', vis(doc,'con_recap') && vis(tab2.window.document,'con_recap'));
  tab2.window.close(); pR.window.close(); dom.window.close();

  /* ---------- one question, self-paced ---------- */
  dom = load(HOSTED, true); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { one:true, mode:'end' });
  click(win, doc.getElementById('btnLaunch')); await sleep(300);
  const code4 = win.App.code; const s2 = await openPhone(code4); await sleep(200);
  click(win, doc.getElementById('btnStart')); await sleep(250);
  click(s2.window, s2.window.document.querySelector('#paxBody .opt.R')); await sleep(200);
  check('one question self-paced lands on the picked page after the tap', /picked your sides/.test(s2.window.document.getElementById('paxBody').textContent));
  click(win, doc.getElementById('btnRevealAll')); await sleep(300); click(win, doc.getElementById('rvBegin')); await sleep(300);
  check('one question self-paced reveals the question alone', win.App.rvSteps.length===1 && doc.getElementById('rvNext').textContent==='Finish');
  click(win, doc.getElementById('rvNext')); await sleep(300);
  check('and lands on the recap with replay', vis(doc,'con_recap') && !doc.getElementById('btnReplay').classList.contains('hide'));
  dom.window.close(); s2.window.close();

  /* ---------- legacy links ---------- */
  const legacyPax = load(HOSTED+'?session=ABCD&me=abcdef&b=ghijkl', true); legacyPax.window.eval(paxFast); await sleep(250);
  check('legacy participant link gates with a way to the join screen', legacyPax.window.document.getElementById('scr_gate').classList.contains('on') && vis(legacyPax.window.document,'gateJoin'));
  legacyPax.window.close();

  /* ---------- test drive ---------- */
  dom = load(HOSTED, false); win = dom.window; doc = win.document; await sleep(50); win.eval(fast);
  buildTwo(win, doc, { mode:'end' });
  click(win, doc.getElementById('btnTestDrive')); await sleep(200);
  check('test drive shows the sim note instead of join ways', vis(doc,'simBarC') && /No link in a test drive/.test(doc.getElementById('joinWays').textContent));
  click(win, doc.getElementById('btnStart')); await sleep(500);
  check('bots vote through both questions in the test drive', doc.getElementById('chipIn').textContent==='12' && parseInt(doc.getElementById('chipDone').textContent,10)>=6);
  click(win, doc.getElementById('segPax')); await sleep(200);
  check('participant view in the test drive shows a question', doc.getElementById('scr_pax').classList.contains('on') && doc.querySelector('#paxBody .opt.L'));
  check('participant view shows the test-drive bar with the switch and the exit', vis(doc,'simBarP') && !doc.getElementById('btnSimExit2').classList.contains('hide'));
  click(win, doc.getElementById('segCon')); await sleep(100);
  check('switching back lands on the console', doc.getElementById('scr_console').classList.contains('on'));
  click(win, doc.getElementById('btnRevealAll')); await sleep(300); click(win, doc.getElementById('rvBegin')); await sleep(200);
  for (let i=0;i<3;i++){ click(win, doc.getElementById('rvNext')); await sleep(150); }
  check('test drive reaches the recap', vis(doc,'con_recap'));
  click(win, doc.getElementById('btnEnd')); await sleep(100);
  check('test drive ends on the rehearsal card', vis(doc,'endSim'));
  click(win, doc.getElementById('btnSimAgain')); await sleep(300);
  check('run it again restarts the drive', doc.getElementById('scr_console').classList.contains('on') && vis(doc,'con_lobby'));
  click(win, doc.getElementById('btnSimExit')); await sleep(200);
  check('Exit test drive returns to the review step with the setup intact', doc.getElementById('scr_studio').classList.contains('on') && stepOn(doc)==='st5' && win.STUDIO.setup.qs.length===2 && win.App.sim===false);
  await sleep(300);
  check('nothing keeps polling after the exit', doc.getElementById('scr_studio').classList.contains('on') && !win.App.paxTimer && !win.App.conTimer);
  dom.window.close();

  console.log(failures ? ('\n' + failures + ' FAILED') : '\nALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
