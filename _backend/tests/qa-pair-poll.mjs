/* qa-pair-poll.mjs: jsdom harness for field-tools/pair-poll/index.html.
   Runs the console and phones against the real pt worker code (fake database).
   Run: node _backend/tests/qa-pair-poll.mjs */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import worker from '../pt-worker.js';
import { FakeDB } from './fake-db.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../field-tools/pair-poll/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const HOSTED = 'https://ep.github.io/pt/field-tools/pair-poll/';
const env = { DB: FakeDB() };
const requests = [];
function mockFetch(win){ win.fetch = async function(url, init){ init = init || {}; requests.push({ url:String(url), method:init.method||'GET' }); const req = new Request(String(url), { method:init.method||'GET', headers:init.headers||{}, body:init.body }); return worker.fetch(req, env); }; }
const testHtml = html.replace(/<script type="text\/javascript">[\s\S]*?clarity[\s\S]*?<\/script>/, '');
function load(url, live){ return new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url, beforeParse(window){ if (live) mockFetch(window); } }); }
function click(win, el){ el.dispatchEvent(new win.MouseEvent('click', { bubbles:true })); }
function type(win, el, value){ el.value = value; el.dispatchEvent(new win.Event('input', { bubbles:true })); }
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
  if (opts.sum){ click(win, doc.getElementById('sumOn')); click(win, doc.querySelector('[data-calc="'+opts.sum+'"]')); type(win, doc.getElementById('sumT'), opts.sumT || 'Where this room leans'); type(win, doc.getElementById('sumL'), opts.sumL || 'BOLD'); type(win, doc.getElementById('sumR'), opts.sumR || 'CAREFUL'); }
  click(win, doc.getElementById('next2'));
  if (opts.wel){ click(win, doc.getElementById('welOn')); type(win, doc.getElementById('welT'), 'Welcome, team'); type(win, doc.getElementById('welB'), 'Two statements at a time. <b>Pick</b> honestly.'); }
  click(win, doc.getElementById('next3'));
}
const cnt = el => parseInt(el.querySelector('small').textContent, 10);
const pc = el => parseInt(el.textContent, 10);
const fast = 'App.botDelay=function(){return 5;}; App.conPollMs=40; App.countMs=0; App.endDelay=120;';

(async function(){
// ---------- statics ----------
check('no em dashes', !html.includes('\u2014'));
check('no copyright line anywhere', !/copyright/i.test(html));
check('no phone assumptions in the copy', (html.match(/phone/gi)||[]).filter(m=>true).length===(html.match(/\.phone|class="phone"/g)||[]).length);
check('named lobby, coachmarks, start-muted, submission rows are gone', !/named lobby|coachmark|start muted|nickInput|sub\/q/i.test(html));
const storageUses=(html.match(/localStorage\./g)||[]).length, guarded=(html.match(/try\{ localStorage\./g)||[]).length+(html.match(/try\{ return localStorage\./g)||[]).length;
check('every storage access guarded', storageUses>0 && storageUses===guarded);
check('every URL rewrite is guarded for file:// pages', (html.match(/history\.replaceState/g)||[]).length===1 && html.includes("function setUrl(u){ try{ history.replaceState"));
check('tool id, worker url, key header, prefix reads wired', html.includes("TOOL_ID = 'pair-poll'") && html.includes("'X-Session-Key':App.sessionKey") && html.includes("Net.state('pub')"));
check('sound resumes a suspended context before scheduling', html.includes("c.resume().then(function(){ voice("));
check('mute defaults: facilitator off, participant on', html.includes("mutedByRole:{ studio:true, console:true, pax:false }"));
check('muted state has a visible slash', html.includes(".ibtn.muted::after"));
check('noindex meta and Clarity present (hosted tool)', html.includes('noindex, nofollow') && html.includes('y1t5l9zfdm'));
check('reduced-motion guard, 100dvh layout, ExperiencePoint link on the ended page', html.includes('prefers-reduced-motion:reduce') && html.includes('min-height:100dvh') && html.includes('href="https://experiencepoint.com"'));
check('participant screens never say Pair Poll', !/id="scr_pax"[\s\S]*?Pair Poll[\s\S]*?id="scr_gate"/.test(html));
check('losing side fades, winner pulses, confetti exists', html.includes('.side.lose{') && html.includes('.side.win{animation:win') && html.includes('id="confetti"'));
check('long text is wrapped everywhere it can appear', (html.match(/overflow-wrap:anywhere/g)||[]).length>=8);

// ---------- studio wizard with pulse guidance ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  const painted = id => win.getComputedStyle(doc.getElementById(id)).display;
  check('hero is the only step painted before any click', painted('st0')!=='none' && ['st1','st2','st3','st4'].every(id=>painted(id)==='none'));
  click(win, doc.getElementById('btnBuild'));
  check('after the click only step 1 is painted', painted('st0')==='none' && painted('st1')!=='none');
  check('next is enabled even when incomplete, so it can guide', doc.getElementById('next1').disabled===false);
  click(win, doc.getElementById('next1'));
  check('next on an incomplete question stays, warns, and pulses the pill and the empty field', stepOn(doc)==='st1' && doc.getElementById('qHint').classList.contains('warn') && doc.querySelector('#qnav [data-i="0"]').classList.contains('pulse') && doc.getElementById('qL').classList.contains('pulse'));
  fillQ(win, doc, 'A', 'B', 'first', 'second');
  click(win, doc.getElementById('qAdd'));
  fillQ(win, doc, 'C', 'D', 'third', '');
  click(win, doc.querySelector('#qnav [data-i="0"]'));
  click(win, doc.getElementById('next1'));
  check('next jumps to the first incomplete question and pulses its missing field', stepOn(doc)==='st1' && win.STUDIO.qi===1 && doc.getElementById('qRS').classList.contains('pulse'));
  type(win, doc.getElementById('qRS'), 'fourth');
  click(win, doc.getElementById('next1'));
  check('complete questions proceed to the reveal step', stepOn(doc)==='st2' && doc.getElementById('sumBlock').classList.contains('hide'));
  click(win, doc.getElementById('modeEnd'));
  click(win, doc.getElementById('sumOn'));
  click(win, doc.getElementById('next2')); click(win, doc.getElementById('next3'));
  check('review blocks launch when summary labels are missing', stepOn(doc)==='st4' && doc.getElementById('btnLaunch').disabled===true && doc.getElementById('launchNote').textContent.includes('pole labels'));
  click(win, doc.getElementById('back4')); click(win, doc.getElementById('back3'));
  type(win, doc.getElementById('sumL'), 'X'.repeat(24)); type(win, doc.getElementById('sumR'), 'Y'.repeat(24)); type(win, doc.getElementById('sumT'), 'Z'.repeat(40));
  click(win, doc.getElementById('next2')); click(win, doc.getElementById('next3'));
  check('max-length labels and headline are accepted and shown', doc.getElementById('btnLaunch').disabled===false && doc.getElementById('review').textContent.includes('X'.repeat(24)));
  const link = HOSTED+'?setup='+win.encodeSetup(win.STUDIO.setup);
  const re=load(link,false), rw=re.window;
  check('a setup link reopens the studio intact', rw.STUDIO.setup.qs.length===2 && rw.STUDIO.setup.mode==='end' && rw.STUDIO.setup.sum.l==='X'.repeat(24));
  check('decode clamps oversize fields and question count', (()=>{ const s=win.decodeSetup(win.encodeSetup({qs:Array(14).fill({l:'x'.repeat(60),r:'y',ls:'z'.repeat(400),rs:'w'}), sum:{on:true, t:'t'.repeat(90), l:'l'.repeat(50), r:'r', calc:'nope'}})); return s.qs.length===10 && s.qs[0].l.length===24 && s.qs[0].ls.length===150 && s.sum.t.length===40 && s.sum.l.length===24 && s.sum.calc==='avg'; })());
  re.window.close(); win.close();
}

// ---------- summary math, every calculation and edge ----------
{
  const dom=load(HOSTED,false), win=dom.window;
  const st={ ballot:{ q0:{a:'L',b:'L',c:'R'}, q1:{a:'L',b:'R',c:'R'}, q2:{a:'R',b:'R',c:'R'} } };
  const avg=win.computeSummary(st,3,'avg'), maj=win.computeSummary(st,3,'majority'), ppl=win.computeSummary(st,3,'people');
  check('average lean: mean of per-question left shares (67, 33, 0 -> 33)', avg.n===3 && avg.pl===33);
  check('question count: one left win, two right wins, bar at 33', maj.L===1 && maj.R===2 && maj.T===0 && maj.pl===33);
  check('people count: a leans left, b and c lean right', ppl.n===3 && ppl.L===1 && ppl.R===2);
  const tie={ ballot:{ q0:{a:'L',b:'R'}, q1:{a:'L',b:'R'} } };
  check('ties: majority counts them separately, people can tie, bar sits at 50 when balanced', win.computeSummary(tie,2,'majority').T===2 && win.computeSummary(tie,2,'majority').pl===0 && win.computeSummary(tie,2,'people').T===0 && win.computeSummary(tie,2,'people').pl===50);
  check('unanswered questions are skipped, not counted as zero', win.computeSummary({ballot:{q0:{a:'L'}}},3,'avg').n===1 && win.computeSummary({ballot:{q0:{a:'L'}}},3,'avg').pl===100);
  check('empty state summarizes to zero without errors', win.computeSummary({},3,'avg').n===0 && win.computeSummary({},3,'people').n===0);
  check('headline reads correctly for every calculation', win.summaryHeadline({l:'BOLD',r:'CAREFUL'},avg)==='67% toward CAREFUL' && win.summaryHeadline({l:'BOLD',r:'CAREFUL'},maj)==='2 of 3 questions leaned CAREFUL' && win.summaryHeadline({l:'BOLD',r:'CAREFUL'},ppl)==='2 of 3 people leaned CAREFUL' && win.summaryHeadline({l:'B',r:'C'},{calc:'avg',n:0})==='Nothing to summarize yet.');
  check('my lean: majority of my picks', win.myLean({0:'L',1:'L',2:'R'})==='L' && win.myLean({0:'L',1:'R'})==='T' && win.myLean({})==='');
  win.close();
}

// ---------- test drive, reveal-each, welcome page, back and re-open, sim restart ----------
{
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  buildTwo(win, doc, { wel:true, prompt:'Where do you lean today?', ls:'We <b>trust</b> our people.', l0:'A'.repeat(24) });
  win.eval(fast);
  click(win, doc.getElementById('btnTestDrive'));
  await sleep(150);
  check('test drive opens the console lobby with the sim bar, no links, one note', vis(doc,'con_lobby') && vis(doc,'simBarC') && !vis(doc,'joinCard') && !vis(doc,'facCard') && vis(doc,'simNote') && doc.getElementById('conCode').textContent==='');
check('test drive is named in exactly one place per view', (doc.getElementById('scr_console').textContent.match(/[Tt]est drive/g)||[]).length===1);
  check('facilitator starts muted, sim label reads Facilitator / Participant', win.App.muted===true && doc.getElementById('btnMuteC').classList.contains('muted') && doc.getElementById('segCon').textContent==='Facilitator' && doc.getElementById('segPax').textContent==='Participant');
  check('status shows joined count in the top bar', /^1[23] in$/.test(doc.getElementById('conStatus').textContent));
  click(win, doc.getElementById('segPax')); await sleep(40);
  check('participant view shows its own sim bar and starts unmuted', vis(doc,'simBarP') && win.App.muted===false && !doc.getElementById('btnMuteP').classList.contains('muted'));
  check('participant lands on the welcome page with the brand cluster, escaped, no Pair Poll wording', vis(doc,'pax_wel') && doc.querySelector('#pax_wel .cluster') && doc.getElementById('paxWelT').textContent==='Welcome, team' && doc.getElementById('paxWelB').innerHTML.includes('&lt;b&gt;') && !doc.getElementById('scr_pax').textContent.includes('Pair Poll'));
  click(win, doc.getElementById('btnWelGo'));
  check('continue moves to the lobby, already counted', vis(doc,'pax_wait') && win.App.joined===true);
  click(win, doc.getElementById('segCon')); await sleep(60);
  check('switching back restores facilitator mute state', win.App.muted===true);
  click(win, doc.getElementById('btnStart'));
  await sleep(80);
  check('start is a single tap', vis(doc,'con_vote') && doc.getElementById('conQNum').textContent==='Question 1 of 2');
  check('back is hidden on question 1, re-open hidden before reveal', !vis(doc,'btnBack') && !vis(doc,'btnReopen'));
  check('max-length label renders in the pill', doc.querySelector('#conL .pill').textContent==='A'.repeat(24));
  await sleep(150);
  check('status shows joined and voted', /^13 in · \d+ voted$/.test(doc.getElementById('conStatus').textContent));
  click(win, doc.getElementById('segPax')); await sleep(60);
  click(win, doc.getElementById('paxL'));
  check('tap selects', doc.getElementById('paxL').classList.contains('sel'));
  click(win, doc.getElementById('segCon')); await sleep(60);
  click(win, doc.getElementById('btnReveal'));
  check('reveal still asks twice', doc.getElementById('btnReveal').classList.contains('armed') && doc.getElementById('conResult').classList.contains('hide'));
  click(win, doc.getElementById('btnReveal')); await sleep(100);
  check('reveal shows the bar, numbers, and fades the losing card on the console', vis(doc,'conResult') && (doc.getElementById('conL').classList.contains('lose') || doc.getElementById('conR').classList.contains('lose')) && !(doc.getElementById('conL').classList.contains('lose') && doc.getElementById('conR').classList.contains('lose')));
  const L=cnt(doc.getElementById('conNL')), R=cnt(doc.getElementById('conNR')), pl=pc(doc.getElementById('conNL')), pr=pc(doc.getElementById('conNR'));
  check('counts sum to the room and percents to 100 after the count-up', L+R===13 && pl+pr===100);
  check('after reveal: re-open shows, reveal hides', vis(doc,'btnReopen') && !vis(doc,'btnReveal'));
  click(win, doc.getElementById('segPax')); await sleep(60);
  check('participant reveal fades the losing side, keeps the winner, marks YOU', (doc.getElementById('paxL').classList.contains('lose') !== doc.getElementById('paxR').classList.contains('lose')) && (doc.getElementById('paxNL').innerHTML.includes('YOU')));
  // re-open
  click(win, doc.getElementById('segCon'));
  click(win, doc.getElementById('btnReopen')); await sleep(80);
  check('re-open clears the reveal and keeps every ballot', win.eval("SIM.rows['pub/rev/q0']")===0 && Object.keys(win.eval('SIM.rows')).filter(k=>k.startsWith('ballot/q0/')).length===13 && doc.getElementById('conResult').classList.contains('hide'));
  click(win, doc.getElementById('segPax')); await sleep(60);
  check('participant sees voting reopened with their pick kept', doc.getElementById('paxHelp').textContent.includes('open again') && doc.getElementById('paxL').classList.contains('sel') && !doc.getElementById('paxL').classList.contains('lose'));
  click(win, doc.getElementById('paxR'));
  check('they can change their mind in the re-opened round', win.eval("SIM.rows['ballot/q0/youbal']")==='R');
  click(win, doc.getElementById('segCon'));
  click(win, doc.getElementById('btnReveal')); click(win, doc.getElementById('btnReveal')); await sleep(80);
  check('second reveal works', vis(doc,'conResult') && win.eval("SIM.rows['pub/rev/q0']")===1);
  click(win, doc.getElementById('btnNext')); await sleep(80);
  check('next is a single tap and back now shows', doc.getElementById('conQNum').textContent==='Question 2 of 2' && vis(doc,'btnBack'));
  click(win, doc.getElementById('btnBack')); await sleep(80);
  check('back returns to question 1, still revealed', doc.getElementById('conQNum').textContent==='Question 1 of 2' && vis(doc,'conResult'));
  click(win, doc.getElementById('btnNext')); await sleep(200);
  click(win, doc.getElementById('btnReveal')); click(win, doc.getElementById('btnReveal')); await sleep(80);
  click(win, doc.getElementById('btnNext')); await sleep(100);
  check('recap reached with two rows, each with a faded losing side or a tie', vis(doc,'con_recap') && doc.querySelectorAll('#recapList .rrow').length===2 && Array.from(doc.querySelectorAll('#recapList .rrow')).every(r=>r.querySelectorAll('.rside.lose').length<=1));
  click(win, doc.getElementById('btnBackRecap')); await sleep(80);
  check('back from the recap lands on the last question', vis(doc,'con_vote') && doc.getElementById('conQNum').textContent==='Question 2 of 2');
  click(win, doc.getElementById('btnNext')); await sleep(100);
  click(win, doc.getElementById('segPax')); await sleep(100);
  check('participant recap celebrates once with confetti and no personal summary line', vis(doc,'pax_recap') && win.App.celebrated===true && !doc.querySelector('#paxSum .mine') && doc.querySelectorAll('#confetti i').length===40);
check('counts under the numbers carry no repeated labels', /^\d+ votes?/.test(doc.querySelector('#paxRecapList .nums small').textContent));
  click(win, doc.getElementById('segCon'));
  click(win, doc.getElementById('btnEnd')); await sleep(60);
  check('test drive end offers run again and back to setup, no deletion warning', vis(doc,'endSim') && !vis(doc,'endLive'));
  click(win, doc.getElementById('btnSimAgain')); await sleep(150);
  check('run again restarts a fresh lobby with the same setup', vis(doc,'con_lobby') && parseInt(doc.getElementById('conJoined').textContent,10)>=12 && win.App.setup.qs.length===2);
  click(win, doc.getElementById('btnEnd')); await sleep(40); click(win, doc.getElementById('btnSimSetup')); await sleep(40);
  check('back to setup returns to step 1 with the questions intact', stepOn(doc)==='st1' && doc.getElementById('scr_studio').classList.contains('on') && win.STUDIO.setup.qs[1].l==='SPEED');
  let threw=false; try{ win.Sfx.reveal(); win.Sfx.celebrate(); win.Music.start(); win.Music.stop(); }catch(e){ threw=true; }
  check('sound kit, celebration, and music sequencer degrade silently', !threw);
  win.close();
}

// ---------- reveal-at-end with every summary calc ----------
for (const calc of ['avg','majority','people']){
  const dom=load(HOSTED,false), win=dom.window, doc=win.document;
  buildTwo(win, doc, { mode:'end', sum:calc, sumT:'W'.repeat(40) });
  win.eval(fast);
  click(win, doc.getElementById('btnTestDrive')); await sleep(150);
  click(win, doc.getElementById('btnStart')); await sleep(80);
  check(calc+': end mode hides reveal, next is single tap until the last', !vis(doc,'btnReveal') && doc.getElementById('btnNext').disabled===false);
  await sleep(120);
  click(win, doc.getElementById('segPax')); await sleep(40); click(win, doc.getElementById('paxL')); click(win, doc.getElementById('segCon'));
  click(win, doc.getElementById('btnNext')); await sleep(180);
  click(win, doc.getElementById('segPax')); await sleep(40); click(win, doc.getElementById('paxL')); click(win, doc.getElementById('segCon'));
  click(win, doc.getElementById('btnNext'));
  check(calc+': the final reveal asks twice', doc.getElementById('btnNext').classList.contains('armed') && !vis(doc,'con_recap'));
  click(win, doc.getElementById('btnNext')); await sleep(140);
  const sum=win.eval("SIM.rows['pub/sum']");
  check(calc+': summary computed and published', vis(doc,'con_recap') && sum && sum.calc===calc);
  const hero=doc.querySelector('#conSum .sumhero');
  check(calc+': hero renders headline, max-length title, poles, and fades the trailing pole', hero && doc.querySelector('#conSum .cap').textContent==='W'.repeat(40) && doc.querySelector('#conSum .lean').textContent.length>0 && (sum.pl===50 || doc.querySelectorAll('#conSum .nums .n.lose').length===1));
  click(win, doc.getElementById('segPax')); await sleep(80);
  check(calc+': participant hero has no personal line', vis(doc,'pax_recap') && doc.querySelector('#paxSum .sumhero') && !doc.querySelector('#paxSum .mine'));
  win.close();
}

// ---------- live mode against the real worker: console plus two phones, undoable end ----------
{
  requests.length=0;
  const con=load(HOSTED,true), cw=con.window, cd=cw.document;
  buildTwo(cw, cd, { wel:true });
  cw.eval(fast);
  click(cw, cd.getElementById('btnLaunch')); await sleep(160);
  const url=new URL(cw.location.href), code=url.searchParams.get('session'), k=url.searchParams.get('k'), fk=url.searchParams.get('fk');
  check('launch rewrites the facilitator URL', /^[A-Z]{4}$/.test(code||'') && /^[a-z0-9]{14}$/.test(k||'') && /^[A-Z]{8}$/.test(fk||''));
  check('live lobby shows the join card and facilitator card, no sim bar', vis(cd,'joinCard') && vis(cd,'facCard') && !vis(cd,'simBarC'));
  const joinLink=cd.getElementById('joinLink').textContent;
  check('join link carries code and key, never the facilitator key', joinLink===HOSTED+'?session='+code+'&k='+k && !joinLink.includes(fk));
  const p1=load(joinLink,true), w1=p1.window, d1=w1.document; await sleep(120);
  check('phone auto-joins, tab title never says Pair Poll', w1.App.joined===true && d1.title==='Live poll');
  click(w1, d1.getElementById('btnWelGo'));
  await sleep(100);
  check('console sees the phone in the status bar', cd.getElementById('conStatus').textContent==='1 in');
  click(cw, cd.getElementById('btnStart')); await sleep(100);
  await w1.pollPax();
  click(w1, d1.getElementById('paxL')); await sleep(60);
  const u1=new URL(w1.location.href), bid=u1.searchParams.get('b'), rid=u1.searchParams.get('me');
  check('ballot under the ballot id, roster under the roster id, never linked', env.DB._rows.has('pair-poll:'+code+'|ballot/q0/'+bid) && env.DB._rows.has('pair-poll:'+code+'|roster/'+rid) && !env.DB._rows.has('pair-poll:'+code+'|ballot/q0/'+rid));
  const p2=load(joinLink,true), w2=p2.window, d2=w2.document; await sleep(120);
  click(w2, d2.getElementById('btnWelGo')); await w2.pollPax(); click(w2, d2.getElementById('paxR')); await sleep(60);
  const reload=load(w2.location.href,true), wr=reload.window, dr=wr.document; await sleep(140);
  check('a reloaded phone recovers identity and vote and skips the welcome', wr.App.joined===true && wr.App.myVotes[0]==='R' && !vis(dr,'pax_wel') && dr.getElementById('paxR').classList.contains('sel'));
  w2.close(); await sleep(100);
  click(cw, cd.getElementById('btnReveal')); click(cw, cd.getElementById('btnReveal')); await sleep(120);
  check('console reveal shows 1 and 1 at 50/50 with no faded side', cnt(cd.getElementById('conNL'))===1 && cnt(cd.getElementById('conNR'))===1 && cd.getElementById('conNL').textContent.startsWith('50%') && !cd.getElementById('conL').classList.contains('lose') && !cd.getElementById('conR').classList.contains('lose'));
  await w1.pollPax(); await wr.pollPax();
  check('both phones mirror the reveal with YOU on their own sides', d1.getElementById('paxNL').innerHTML.includes('YOU') && dr.getElementById('paxNR').innerHTML.includes('YOU'));
  const paxReqs=requests.filter(r=>r.url.includes('/api/state')&&r.url.includes('prefix=pub')), conReqs=requests.filter(r=>r.url.includes('/api/state')&&!r.url.includes('prefix='));
  check('phones read with prefix=pub, console reads the full room', paxReqs.length>2 && conReqs.length>2);
  const bad=load(HOSTED+'?session='+code+'&k=wrongwrongwrong',true); await sleep(100);
  check('wrong key hits the gate without a setup link', bad.window.document.getElementById('scr_gate').classList.contains('on') && bad.window.document.getElementById('gateMsg').textContent.includes('key is missing') && bad.window.document.getElementById('gateSetup').classList.contains('hide'));
  bad.window.close();
  click(cw, cd.getElementById('btnNext')); await sleep(80);
  click(cw, cd.getElementById('btnReveal')); click(cw, cd.getElementById('btnReveal')); await sleep(80);
  click(cw, cd.getElementById('btnNext')); await sleep(120);
  check('live recap reached', vis(cd,'con_recap'));
  click(cw, cd.getElementById('btnEnd')); await sleep(30);
  check('end is a single tap with an undo window; nothing deleted yet', vis(cd,'endLive') && [...env.DB._rows.keys()].some(x=>x.startsWith('pair-poll:'+code+'|')));
  click(cw, cd.getElementById('btnUndoEnd')); await sleep(80);
  check('undo returns to the recap with the session intact', vis(cd,'con_recap') && [...env.DB._rows.keys()].some(x=>x.startsWith('pair-poll:'+code+'|')));
  click(cw, cd.getElementById('btnEnd')); await sleep(260);
  check('after the window the session is wiped and the done screen shows', vis(cd,'endDone') && ![...env.DB._rows.keys()].some(x=>x.startsWith('pair-poll:'+code+'|')));
  await w1.pollPax();
  check('phones show the ended page with the ExperiencePoint link', vis(d1,'pax_ended') && d1.querySelector('#pax_ended a.brand').getAttribute('href')==='https://experiencepoint.com');
  click(cw, cd.getElementById('btnAgainSame')); await sleep(40);
  check('set up another with these questions returns to the studio with them loaded', cd.getElementById('scr_studio').classList.contains('on') && cw.STUDIO.setup.qs[0].l==='EMPOWERMENT');
  w1.close(); wr.close(); cw.close();
}

// ---------- off-origin: no dead download button ----------
{
  const dom=load('http://localhost/pair-poll.html',false), win=dom.window, doc=win.document;
  buildTwo(win, doc); win.eval(fast);
  click(win, doc.getElementById('btnTestDrive')); await sleep(60);
  check('off the hosted origin the download button hides and the note shows', doc.getElementById('btnDownload').classList.contains('hide') && !doc.getElementById('dlNote').classList.contains('hide'));
  win.close();
}

console.log(failures===0 ? '\nPAIR POLL TESTS PASSED' : '\n'+failures+' FAILURES');
process.exit(failures===0?0:1);
})();
