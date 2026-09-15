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
function load(url, live){ return new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){ if (live) mockFetch(window); window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {}; } }); }
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
  click(win, doc.getElementById('qAdd'));
  fillQ(win, doc, 'SPEED', 'CARE', 'Ship this week, fix live.', 'Take the month, ship it right.');
  click(win, doc.getElementById('next1'));
  if (opts.mode === 'end') click(win, doc.getElementById('modeEnd'));
  if (opts.pace === 'self') click(win, doc.getElementById('paceSelf'));
  click(win, doc.getElementById('next2'));
  if (opts.sum){ click(win, doc.getElementById('sumOn')); click(win, doc.querySelector('[data-calc="'+opts.sum+'"]')); type(win, doc.getElementById('sumT'), opts.sumT || 'Where this room leans'); type(win, doc.getElementById('sumL'), 'BOLD'); type(win, doc.getElementById('sumR'), 'CAREFUL'); if (opts.order==='details') click(win, doc.getElementById('orderDetails')); }
  click(win, doc.getElementById('next3'));
  if (opts.instr) type(win, doc.getElementById('instr'), opts.instr);
  if (opts.wel){ click(win, doc.getElementById('welOn')); type(win, doc.getElementById('welT'), 'Welcome, team'); type(win, doc.getElementById('welB'), 'Two statements at a time. <b>Pick</b> honestly.'); }
  click(win, doc.getElementById('next4'));
}
const fast = 'App.botDelay=function(){return 5;}; App.conPollMs=40; App.countMs=0; App.endDelay=120; App.frostMs=0; App.anim=false;';
const paxFast = 'App.paxBase=40; App.countMs=0; App.frostMs=0; App.anim=false;';
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
// ---------- statics ----------
check('no em dashes', !html.includes('\u2014'));
check('no copyright line anywhere', !/copyright/i.test(html));
check('no "phone" assumptions in the copy', !/[^a-z]phone[^a-z]/i.test(html.replace(/\.phone|class="phone"/g,'')));
const storageUses=(html.match(/localStorage\./g)||[]).length, guarded=(html.match(/try\{ localStorage\./g)||[]).length+(html.match(/try\{ return localStorage\./g)||[]).length;
check('every storage access guarded', storageUses>0 && storageUses===guarded);
check('every URL rewrite is guarded for file:// pages', (html.match(/history\.replaceState/g)||[]).length===1 && html.includes("function setUrl(u){ try{ history.replaceState"));
check('tool id, worker url, open paths, conditional key header, prefix reads wired', html.includes("TOOL_ID = 'pair-poll'") && html.includes("OPEN_PATHS = ['roster','ballot']") && html.includes("if (App.key) h['X-Session-Key']=App.key") && html.includes("Net.state('pub')"));
check('sound resumes a suspended context before scheduling', html.includes("c.resume().then(function(){ voice("));
check('mute defaults: facilitator off, participant on', html.includes("mutedByRole:{ studio:true, console:true, pax:false }"));
check('noindex meta and Clarity present (hosted tool)', html.includes('noindex, nofollow') && html.includes('y1t5l9zfdm'));
check('reduced-motion guard, 100dvh layout, ExperiencePoint link on the ended page', html.includes('prefers-reduced-motion:reduce') && html.includes('min-height:100dvh') && html.includes('href="https://experiencepoint.com"'));
const paxMarkup = html.slice(html.indexOf('id="scr_pax"'), html.indexOf('id="scr_join"'));
check('participant screens never say Pair Poll and carry no topbar or dot field', !/Pair Poll/.test(paxMarkup) && !/class="topbar"/.test(paxMarkup) && !/class="field"/.test(paxMarkup));
check('participant mute is a tiny text button at the foot', /<div class="pfoot"><button class="tiny" id="btnMuteP"/.test(paxMarkup));
check('diverging bar, gold cap on the winner, losing wing thins', html.includes('.dv .wing.win i::after') && html.includes('.dv .wing.lose i{opacity:.35;}') && html.includes('border-left:2px dashed'));
check('reveal mode fills the window with one primary control', html.includes('#reveal{position:fixed;inset:0') && html.includes('id="rvNext"') && html.includes('class="btn ghost rvclose"'));
check('frost transition exists and is the swap helper', html.includes('.frost{filter:blur(14px)') && html.includes('function swap(el, render)'));
check('losing side fades, winner pulses, confetti exists', html.includes('.side.lose{') && html.includes('.side.win{animation:win') && html.includes('id="confetti"'));
check('hero copy as specified', html.includes('See where the room stands.') && html.includes('Create pairs of contrasting statements. Participants pick the side they agree with, then you reveal the results to the room.'));
check('"Where the room landed" title is gone', !/Where the room landed/i.test(html));
check('long text is wrapped everywhere it can appear', (html.match(/overflow-wrap:anywhere/g)||[]).length>=10);
check('welcome preview in the studio is text only', !/<div class="preview">[\s\S]*?<button/.test(html.slice(html.indexOf('class="preview"'), html.indexOf('id="st5"'))));

// ---------- studio ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  const painted = id => win.getComputedStyle(doc.getElementById(id)).display;
  check('hero is the only step painted before any click', painted('st0')!=='none' && ['st1','st2','st3','st4','st5'].every(id=>painted(id)==='none'));
  check('hero carries the living miniature', doc.querySelectorAll('#demo circle.d').length===14 && doc.querySelectorAll('#demo .wl, #demo .wr').length===2);
  click(win, doc.getElementById('btnBuild'));
  type(win, doc.getElementById('qL'), 'A');
  check('the count hint stays neutral while typing', !doc.getElementById('qHint').classList.contains('warn') && /questions, 0 complete/.test(doc.getElementById('qHint').textContent));
  click(win, doc.getElementById('next1'));
  check('next on an incomplete question stays, warns, and pulses the pill and the empty field', stepOn(doc)==='st1' && doc.getElementById('qHint').classList.contains('warn') && doc.querySelector('#qnav [data-i="0"]').classList.contains('pulse') && doc.getElementById('qLS').classList.contains('pulse'));
  fillQ(win, doc, 'A', 'B', 'first', 'second');
  click(win, doc.getElementById('qAdd'));
  fillQ(win, doc, 'C', 'D', 'third', '');
  click(win, doc.querySelector('#qnav [data-i="0"]'));
  click(win, doc.getElementById('next1'));
  check('next jumps to the first incomplete question and pulses its missing field', stepOn(doc)==='st1' && win.STUDIO.qi===1 && doc.getElementById('qRS').classList.contains('pulse'));
  type(win, doc.getElementById('qRS'), 'fourth');
  click(win, doc.getElementById('next1'));
  check('step 2 is the flow; pace hidden while revealing after each question', stepOn(doc)==='st2' && !vis(doc,'paceBlock'));
  click(win, doc.getElementById('modeEnd'));
  check('reveal at the end shows the pace choice', vis(doc,'paceBlock'));
  click(win, doc.getElementById('paceSelf'));
  click(win, doc.getElementById('modeEach'));
  check('switching back to reveal-each resets the pace to facilitator', win.STUDIO.setup.pace==='fac' && !vis(doc,'paceBlock'));
  click(win, doc.getElementById('modeEnd')); click(win, doc.getElementById('paceSelf'));
  click(win, doc.getElementById('next2'));
  check('step 3 is the reveal with the summary switch', stepOn(doc)==='st3' && vis(doc,'sumBlock'));
  click(win, doc.getElementById('sumOn'));
  check('order choice appears with the summary, summary first by default', vis(doc,'orderGrand') && doc.getElementById('orderGrand').getAttribute('aria-pressed')==='true');
  click(win, doc.getElementById('orderDetails'));
  click(win, doc.getElementById('next3'));
  check('missing pole labels guide back to the reveal step and pulse the field', stepOn(doc)==='st3' && doc.getElementById('sumL').classList.contains('pulse'));
  type(win, doc.getElementById('sumL'), 'BOLD'); type(win, doc.getElementById('sumR'), 'CAREFUL');
  click(win, doc.getElementById('next3'));
  check('step 4 is the words: instruction with the default as placeholder', stepOn(doc)==='st4' && doc.getElementById('instr').placeholder==='Which do you agree with more?');
  click(win, doc.getElementById('welOn')); type(win, doc.getElementById('welT'), 'Hi'); type(win, doc.getElementById('welB'), 'Body');
  check('welcome preview shows the text and no button', doc.getElementById('welPT').textContent==='Hi' && doc.getElementById('welPB').textContent==='Body' && !doc.querySelector('.preview button'));
  click(win, doc.getElementById('next4'));
  check('review names pace, order and the default instruction', stepOn(doc)==='st5' && /Participants set their own/.test(doc.getElementById('review').textContent) && /after the questions/.test(doc.getElementById('review').textContent) && /Which do you agree with more\?/.test(doc.getElementById('review').textContent));
  const enc = win.encodeSetup(win.STUDIO.setup), back = win.decodeSetup(enc);
  check('setup link round-trips pace, order, instruction', back.pace==='self' && back.order==='details' && back.sum.on && back.wel.on);
  const old = win.decodeSetup(win.btoa(JSON.stringify({mode:'end', qs:[{l:'A',r:'B',ls:'x',rs:'y'}], sum:{on:false}})));
  check('a setup link from before this release still opens with safe defaults', old && old.pace==='fac' && old.order==='grand' && old.instr==='' && old.qs.length===1);
  const selfEach = win.cleanSetup({mode:'each', pace:'self', qs:[{l:'A',r:'B',ls:'x',rs:'y'}]});
  check('self pace is refused when revealing after each question', selfEach.pace==='fac');
  const saved = win.localStorage.getItem('pp_draft');
  const dom2 = new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url:HOSTED, beforeParse(w){ w.localStorage.setItem('pp_draft', saved); } });
  check('draft persists across a reload', win.decodeSetup(saved).qs.length===2 && vis(dom2.window.document,'btnDraft'));
}

// ---------- live: facilitator paced, reveal after each question ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  mockFetch(win); win.eval(fast);
  buildTwo(win, doc, {prompt:'When we build, we believe', wel:true});
  click(win, doc.getElementById('btnLaunch'));
  await sleep(150);
  const created = requests.find(r => r.url.endsWith('/api/create'));
  check('launch creates an open session (roster and ballot writable by code)', created && JSON.parse(created.body).open.join()==='roster,ballot');
  check('facilitator link carries the key; the join link carries only the code', /\?host=[A-Z]{4}&k=[a-z0-9]{16}$/.test(win.location.search.replace('?','?')) && win.joinLink()===HOSTED+'?join='+win.App.code);
  const code = win.App.code, hostKey = win.App.key;
  check('host record stored for the studio return link', JSON.parse(win.localStorage.getItem('pp_host')).code===code);
  check('console shows lobby with the code and the short join address', vis(doc,'con_lobby') && doc.getElementById('codeBig').textContent===code && doc.getElementById('joinShort').textContent==='ep.github.io/pt/join');
  const svg = doc.getElementById('qr').innerHTML;
  check('lobby QR is drawn as brand dots with solid finders', /<circle|a0\.43 0\.43/.test(svg) && (svg.match(/<rect/g)||[]).length>=9);
  check('lobby QR decodes to the join link', decodeMatrix(svgToMatrix(svg))===HOSTED+'?join='+code);
  check('copy join link is the primary control in the join card', doc.getElementById('btnCopyJoin').classList.contains('big'));

  const p1=await openPhone(code), w1=p1.window, d1=w1.document;
  check('participant joins with the code alone: no key header on any request', requests.filter(r=>r.url.includes('code='+code) && r.url.includes('/api/state') && !r.key).length>0 && !requests.some(r=>r.key && r.key!==hostKey));
  check('participant URL gains me and b', /join=[A-Z]{4}&me=[a-z0-9]{6}&b=[a-z0-9]{6}/.test(w1.location.search));
  check('welcome page shows first with a Begin button', d1.querySelector('[data-act="begin"]') && d1.querySelector('[data-act="begin"]').textContent==='Begin');
  click(w1, d1.querySelector('[data-act="begin"]'));
  check('waiting view says they are in, with no count of others', /You are in\./.test(d1.getElementById('paxBody').textContent) && !/\d/.test(d1.getElementById('paxBody').textContent));

  const j=load(HOSTED+'?join', true), wj=j.window, dj=wj.document; wj.eval(paxFast); await sleep(50);
  check('the join screen opens on ?join', vis(dj,'codeIn'));
  type(wj, dj.getElementById('codeIn'), 'zzzz'); await sleep(80);
  check('a wrong code shakes and explains', dj.getElementById('codeIn').classList.contains('bad') && /No poll with those letters/.test(dj.getElementById('joinMsg').textContent));
  type(wj, dj.getElementById('codeIn'), code.toLowerCase()); await sleep(200);
  check('typing the code joins: participant screen, URL rewritten, roster written', vis(dj,'paxBody') && wj.location.search.startsWith('?join='+code) && wj.App.joined);
  click(wj, dj.querySelector('[data-act="begin"]'));
  await sleep(120);
  check('console counts two in the room, dots in the field', doc.getElementById('chipIn').textContent==='2' && doc.querySelectorAll('#lobbyField i').length===2 && !vis(doc,'chipDone'));

  click(win, doc.getElementById('btnStart')); await sleep(200);
  check('vote view: strip shows question 1 of 2, chip shows in and voted, question number quiet', vis(doc,'con_vote') && doc.querySelectorAll('#conStrip i.on').length===1 && vis(doc,'chipDone') && doc.getElementById('chipDoneLab').textContent==='voted' && doc.getElementById('conQNum').textContent==='1 of 2');
  check('only one place on the console says how many voted', doc.getElementById('con_vote').textContent.indexOf('voted')===-1);
  check('participant vote view: instruction at the top, prompt, pair, strip, no chrome', d1.querySelector('.instr').textContent==='Which do you agree with more?' && d1.querySelector('.pfill .prompt').textContent==='When we build, we believe' && d1.querySelectorAll('.opt').length===2 && vis(d1,'paxStripWrap'));
  click(w1, d1.querySelector('.opt.L')); await sleep(120);
  check('ballot written with the code alone; console chip 1 of 2 voted; field dot fills', requests.some(r=>r.body.includes('"ballot/q0/') && !r.key) && doc.getElementById('chipDone').textContent==='1' && doc.querySelectorAll('#voteField i.on').length===1);
  click(wj, dj.querySelector('.opt.R')); await sleep(120);
  check('all in: chip pulses gold and the field turns gold', doc.getElementById('chipDone').textContent==='2' && doc.getElementById('chip').classList.contains('pulse') && doc.getElementById('voteField').classList.contains('all'));
  check('next question is disabled until the reveal', doc.getElementById('btnNext').disabled===true);
  click(win, doc.getElementById('btnReveal'));
  check('reveal arms first', doc.getElementById('btnReveal').classList.contains('armed'));
  click(win, doc.getElementById('btnReveal')); await sleep(200);
  check('reveal opens reveal mode with one slide: statements, bar, numerals', doc.getElementById('reveal').classList.contains('on') && doc.querySelectorAll('#rvSlide .side').length===2 && doc.querySelector('#rvSlide .dvn .nl').textContent.startsWith('50%'));
  check('reveal mode hides the console chrome and mirrors to phones via pub/show', doc.getElementById('rvNext').textContent==='Finish' && requests.some(r=>r.body.includes('"pub/show"') && r.body.includes('"k":"q"')));
  await sleep(120);
  check('participant sees the result in place with wings, YOU on their side, and locked cards', wingL(d1.getElementById('paxResult'))===50 && d1.querySelector('#paxResult .nl .you') && d1.querySelector('.opt.L').classList.contains('locked') && /Locked in/.test(d1.getElementById('paxHelp').textContent));
  check('a tie shows no loser and says so', !d1.querySelector('.opt.lose') && vis(d1, d1.querySelector('#paxResult .tie').id || 'paxResult') && !d1.querySelector('#paxResult .tie').classList.contains('hide'));
  click(win, doc.getElementById('rvNext')); await sleep(150);
  check('finishing the slide returns to the console with the inline result and Next enabled', !doc.getElementById('reveal').classList.contains('on') && vis(doc,'conResult') && doc.getElementById('btnNext').disabled===false && vis(doc,'btnReopen'));
  click(win, doc.getElementById('btnReopen')); await sleep(150);
  check('re-open unlocks the phones and hides the result', !vis(doc,'conResult') && !d1.querySelector('.opt.L').classList.contains('locked') && /open again/.test(d1.getElementById('paxHelp').textContent));
  click(w1, d1.querySelector('.opt.R')); await sleep(120);
  click(win, doc.getElementById('btnReveal')); click(win, doc.getElementById('btnReveal')); await sleep(200);
  key(win, 'ArrowRight'); await sleep(120);
  check('arrow key finishes the slide; the losing card fades and the winner keeps its color', !doc.getElementById('reveal').classList.contains('on') && doc.getElementById('conL').classList.contains('lose') && !doc.getElementById('conR').classList.contains('lose') && wingR(doc.getElementById('conResult'))===100);
  check('participant mirror: their pick marked, loser faded, 0 and 100', d1.querySelector('.opt.L').classList.contains('lose') && d1.querySelector('#paxResult .nr .you') && d1.querySelector('#paxResult .nl').classList.contains('lose'));
  click(win, doc.getElementById('btnNext')); await sleep(150);
  check('question 2: strip advances, phones move on with a fresh pair', doc.getElementById('conQNum').textContent==='2 of 2' && doc.querySelectorAll('#conStrip i.done').length===1 && d1.querySelector('.opt.L .stmt').textContent==='Ship this week, fix live.' && !d1.querySelector('.opt.L').classList.contains('sel'));
  click(w1, d1.querySelector('.opt.L')); click(wj, dj.querySelector('.opt.L')); await sleep(120);
  click(win, doc.getElementById('btnReveal')); click(win, doc.getElementById('btnReveal')); await sleep(200); key(win, 'Escape'); await sleep(100);
  check('escape exits reveal mode; next now reads Show the recap', !doc.getElementById('reveal').classList.contains('on') && doc.getElementById('btnNext').textContent==='Show the recap');
  click(win, doc.getElementById('btnNext')); await sleep(200);
  check('recap: rows with bars, no duplicate title, chip shows in only', vis(doc,'con_recap') && doc.querySelectorAll('#recapList .rrow').length===2 && doc.getElementById('conSum').innerHTML==='' && !vis(doc,'chipDone') && doc.querySelectorAll('#conStrip i.rev').length===1);
  check('replay is only offered for reveal-at-the-end', !vis(doc,'btnReplay'));
  await sleep(100);
  check('participant recap lists both questions with their picks and celebrates once', d1.querySelectorAll('#paxRecapList .rrow').length===2 && d1.querySelectorAll('#paxRecapList .you').length===2 && w1.App.celebrated===true);
  const report = win.buildReport();
  check('report carries the diverging bars and both questions', (report.match(/class="dv"/g)||[]).length===2 && /Question 2/.test(report) && !report.includes('\u2014'));
  click(win, doc.getElementById('btnBackRecap')); await sleep(150);
  check('back from the recap re-opens the last question', vis(doc,'con_vote') && doc.getElementById('conQNum').textContent==='2 of 2' && !d1.querySelector('.opt.L').classList.contains('locked'));
  click(win, doc.getElementById('btnNext')); await sleep(150);

  /* wrong key and unknown code */
  const bad=load(HOSTED+'?host='+code+'&k=wrongwrongwrong1', true); await sleep(80);
  check('a facilitator link with the wrong key is gated, not served', vis(bad.window.document,'gateHead') && /needs a hand/.test(bad.window.document.getElementById('gateHead').textContent));
  const nope=await openPhone('QQQQ');
  check('an unknown code on a join link gates as over', vis(nope.window.document,'gateHead'));
  /* a second facilitator tab with the key resumes the console */
  const tab2=load(HOSTED+'?host='+code+'&k='+hostKey, true); tab2.window.eval(fast); await sleep(150);
  check('the facilitator link resumes the console at the recap', vis(tab2.window.document,'con_recap'));

  click(win, doc.getElementById('btnEnd')); await sleep(30);
  check('end shows the undo window', vis(doc,'endLive'));
  click(win, doc.getElementById('btnUndoEnd')); await sleep(80);
  check('undo returns to the recap', vis(doc,'con_recap'));
  click(win, doc.getElementById('btnEnd')); await sleep(300);
  check('end clears the session and forgets the host record', vis(doc,'endDone') && win.localStorage.getItem('pp_host')===null && requests.some(r=>r.url.endsWith('/api/clear') && r.key===hostKey));
  await sleep(150);
  check('participants see the wrap page with the ExperiencePoint link', /That is a wrap/.test(d1.getElementById('paxBody').textContent) && d1.querySelector('a.brand'));
}

// ---------- live: reveal at the end, self paced, summary, details first ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  mockFetch(win); win.eval(fast);
  buildTwo(win, doc, {mode:'end', pace:'self', sum:'avg', order:'details', instr:'Which one better describes your organization?'});
  click(win, doc.getElementById('btnLaunch')); await sleep(150);
  const code = win.App.code;
  check('self-paced lobby offers Open the poll', doc.getElementById('btnStart').textContent==='Open the poll');
  const p1=await openPhone(code), w1=p1.window, d1=w1.document;
  const p2=await openPhone(code), w2=p2.window, d2=w2.document;
  await sleep(100);
  click(win, doc.getElementById('btnStart')); await sleep(200);
  check('console self view: where people are, chip counts done', vis(doc,'con_self') && doc.getElementById('chipDoneLab').textContent==='done' && doc.querySelectorAll('#selfList .p').length===2);
  check('participant self view: custom instruction, nav with Skip, strip of two', d1.querySelector('.instr').textContent==='Which one better describes your organization?' && d1.querySelector('[data-act="next"]').textContent==='Skip' && d1.querySelectorAll('#paxStrip i').length===2);
  click(w1, d1.querySelector('.opt.L')); await sleep(60);
  check('a tap answers and moves them on to question 2', w1.App.pi===1 && d1.querySelector('[data-act="next"]').textContent==='Finish' && d1.querySelectorAll('#paxStrip i.done').length===1);
  click(w1, d1.querySelector('[data-act="prev"]'));
  check('back shows question 1 with their pick still marked', w1.App.pi===0 && d1.querySelector('.opt.L').classList.contains('sel'));
  click(w1, d1.querySelector('.opt.R')); await sleep(60);
  check('changing an answer before the reveal is allowed', w1.App.myVotes[0]==='R' && w1.App.pi===1);
  click(w1, d1.querySelector('.opt.L')); await sleep(60);
  check('after the last question they see the done page with a review control', /That is everything/.test(d1.getElementById('paxBody').textContent) && d1.querySelector('[data-act="review"]'));
  await sleep(120);
  check('console: one done, per-question counts', doc.getElementById('chipDone').textContent==='1' && /1<small/.test(doc.getElementById('selfList').innerHTML));
  click(w2, d2.querySelector('.opt.L')); await sleep(60); click(w2, d2.querySelector('.opt.L')); await sleep(150);
  check('all done: chip pulses and the field turns gold', doc.getElementById('chipDone').textContent==='2' && doc.getElementById('selfField').classList.contains('all'));
  click(win, doc.getElementById('btnRevealAll')); click(win, doc.getElementById('btnRevealAll')); await sleep(300);
  check('reveal all opens reveal mode: details first, then the summary, three steps', doc.getElementById('reveal').classList.contains('on') && doc.querySelectorAll('#rvDots i').length===3 && win.App.rvSteps.map(s=>s.k).join()==='q,q,grand');
  check('slide 1 is question 1 with the split 50/50 and a tie note', doc.querySelector('#rvSlide .side.L .stmt').textContent==='Our people determine solutions.' && !doc.querySelector('#rvSlide .tie').classList.contains('hide'));
  await sleep(150);
  check('phones mirror slide 1, locked, their pick marked', d1.querySelector('.pair[data-q="0"]') && d1.querySelector('#paxBody .side.R').classList.contains('sel') && w1.App.paxView==='reveal');
  click(w1, d1.querySelector('#paxBody .side.L'));
  check('a tap during the reveal changes nothing', w1.App.myVotes[0]==='R');
  click(win, doc.getElementById('rvNext')); await sleep(150);
  check('slide 2 is question 2: left wins 100 to 0, right thins', doc.querySelector('#rvSlide .side.L .stmt').textContent==='Ship this week, fix live.' && wingL(doc.getElementById('rvSlide'))===100 && doc.querySelector('#rvSlide .side.R').classList.contains('lose') && doc.querySelector('#rvSlide .dvn .nr').classList.contains('lose'));
  click(win, doc.getElementById('rvNext')); await sleep(150);
  check('slide 3 is the summary with pole labels and the headline', doc.querySelector('#rvSlide .sumhero') && /BOLD/.test(doc.querySelector('#rvSlide .dvn').textContent) && /75% toward BOLD/.test(doc.querySelector('#rvSlide .lean').textContent) && doc.getElementById('rvNext').textContent==='Finish');
  await sleep(120);
  check('phones mirror the summary', d2.querySelector('.sumhero') && /75% toward BOLD/.test(d2.querySelector('.lean').textContent));
  click(win, doc.getElementById('rvNext')); await sleep(200);
  check('finish lands on the recap with the summary hero once and replay offered', vis(doc,'con_recap') && doc.querySelectorAll('#conSum .sumhero').length===1 && vis(doc,'btnReplay') && doc.getElementById('btnBackRecap').textContent==='Re-open voting');
  await sleep(120);
  check('phones land on the recap with their picks', d1.querySelectorAll('#paxRecapList .you').length===2 && d1.querySelector('#paxSum .sumhero'));
  click(win, doc.getElementById('btnReplay')); await sleep(200);
  check('replay reopens reveal mode from the first slide', doc.getElementById('reveal').classList.contains('on') && win.App.rvIdx===0);
  key(win, 'Escape'); await sleep(150);
  win.App.state.pub.meta.order='grand';
  check('summary-first order puts the summary on slide 1', win.revealSteps().map(s=>s.k).join()==='grand,q,q');
  /* frost: a phone with the transition on updates after the delay, not before */
  const p3=await openPhone(code, 'App.frostMs=120; App.anim=true;'); await sleep(200);
  check('a late joiner at the recap sees the recap and does not replay the celebration', /BOLD/.test(p3.window.document.getElementById('paxBody').textContent) && p3.window.App.celebrated===true);
  click(win, doc.getElementById('btnBackRecap')); await sleep(60);
  const before = p3.window.document.getElementById('paxBody').textContent;
  await sleep(60);
  const mid = p3.window.document.getElementById('paxBody').classList.contains('frost') || p3.window.document.getElementById('paxBody').textContent===before;
  await sleep(250);
  check('frost holds the old view briefly, then the new view is in', mid && /Which one better describes/.test(p3.window.document.getElementById('paxBody').textContent));
}

// ---------- legacy links from sessions started before this release ----------
{
  const SK='legacykey1234567', code='LEGA';
  await worker.fetch(new Request('https://pt.test/api/create', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tool:'pair-poll', code, sk:SK})}), env);
  const setLegacy = (p,v) => worker.fetch(new Request('https://pt.test/api/set', {method:'POST', headers:{'Content-Type':'application/json','X-Session-Key':SK}, body:JSON.stringify({tool:'pair-poll', code, path:p, value:v})}), env);
  await setLegacy('meta/fk','fkfkfk'); await setLegacy('pub/meta',{stage:'vote', q:0, mode:'each', n:1, wel:false, sum:false}); await setLegacy('pub/cfg/q0',{p:'',l:'A',r:'B',ls:'x',rs:'y'}); await setLegacy('pub/joined',0);
  const con=load(HOSTED+'?session='+code+'&fk=fkfkfk&k='+SK, true); con.window.eval(fast); await sleep(150);
  check('an old facilitator link still opens its console', vis(con.window.document,'con_vote'));
  const ph=load(HOSTED+'?session='+code+'&k='+SK, true); ph.window.eval(paxFast); await sleep(150);
  check('an old participant link still votes (it sends the key it carries)', vis(ph.window.document,'paxBody') && ph.window.document.querySelectorAll('.opt').length===2 && ph.window.App.key===SK);
  const badfk=load(HOSTED+'?session='+code+'&fk=nope&k='+SK, true); await sleep(100);
  check('an old facilitator link with the wrong fk is gated', vis(badfk.window.document,'gateHead'));
}

// ---------- test drive ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document; win.eval(fast);
  buildTwo(win, doc, {mode:'end', pace:'self', sum:'people'});
  click(win, doc.getElementById('btnTestDrive')); await sleep(200);
  check('test drive: bots join, no network', vis(doc,'con_lobby') && vis(doc,'simBarC') && parseInt(doc.getElementById('chipIn').textContent,10)>=6 && !requests.some(r=>r.url.includes('DEMO')||r.body.includes('DEMO')));
  click(win, doc.getElementById('btnStart')); await sleep(400);
  check('self-paced bots answer every question', parseInt(doc.getElementById('chipDone').textContent,10)>=10);
  click(win, doc.getElementById('segPax'));
  check('participant view in the test drive shows the self-paced pair', vis(doc,'paxBody') && doc.querySelectorAll('#paxBody .opt').length===2 && vis(doc,'simBarP'));
  click(win, doc.getElementById('segCon2'));
  click(win, doc.getElementById('btnRevealAll')); click(win, doc.getElementById('btnRevealAll')); await sleep(300);
  check('test drive reveal mode opens with the summary first by default', win.App.rvSteps[0].k==='grand');
  key(win,'Escape'); await sleep(100);
  click(win, doc.getElementById('btnEnd')); await sleep(50);
  check('ending a test drive is instant and offers to run again', vis(doc,'endSim'));
}

console.log(failures ? ('\n'+failures+' FAILURE(S)') : '\nALL PASS');
process.exit(failures ? 1 : 0);
})();
