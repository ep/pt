/* qa-ai-impact-ladder.mjs: jsdom harness for field-tools/ai-impact-ladder/index.html (v3).
   Walks the conversation the way a presenter would: the cover, Today, Priorities, the ladder
   intro and its four rungs, Focus, Measures and the Plan, then copy, download and start over.
   Checks the focus suggestion rule against the panel's scenarios (a "Mixed everywhere" Ready
   must not win by default, "Can't tell" never counts against a rung, split views take the
   less favorable answer), the challenge line, which measure sections open, the "Start with
   these" picks, notes (left out of the report unless ticked, parked notes in by default),
   escaping in the plan, report and CSV, downloads only on the hosted page, picking up after a
   reload, a browser that blocks storage, and that nothing tracks or brands the page.
   Run: node _backend/tests/qa-ai-impact-ladder.mjs   (needs: npm install jsdom) */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, '../../field-tools/ai-impact-ladder/index.html');
const html = fs.readFileSync(FILE, 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond ? 'PASS  ' : 'FAIL  ') + name); if (!cond) failures++; }

const HOSTED = 'https://ep.github.io/pt/field-tools/ai-impact-ladder/';
const ELSEWHERE = 'http://localhost:8000/field-tools/ai-impact-ladder/';

function load(url, opts){
  opts = opts || {};
  return new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url: url || HOSTED, beforeParse(w){
    w.HTMLElement.prototype.scrollIntoView = function(){};
    w.scrollTo = function(){};
    w.__downloads = [];
    w.URL.createObjectURL = function(blob){ w.__lastBlob = blob; return 'blob:test'; };
    w.URL.revokeObjectURL = function(){};
    w.HTMLAnchorElement.prototype.click = function(){ if (this.hasAttribute('download')) w.__downloads.push({name:this.getAttribute('download'), blob:w.__lastBlob}); };
    w.__clip = null;
    Object.defineProperty(w.navigator, 'clipboard', { value:{ writeText(t){ w.__clip = t; return Promise.resolve(); } }, configurable:true });
    if (opts.preload) w.sessionStorage.setItem(opts.key || 'ail.v3', JSON.stringify(opts.preload));
    if (opts.blockStorage) Object.defineProperty(w, 'sessionStorage', { get(){ throw new w.DOMException('blocked', 'SecurityError'); } });
  }});
}
function tools(dom){
  const w = dom.window, d = w.document;
  const $ = id => d.getElementById(id);
  const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles:true }));
  const type = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles:true })); };
  const chip = (group, id) => $(group).querySelector('[data-id="' + id + '"]');
  const st = v => $('stChips').querySelector('[data-v="' + v + '"]');
  const lev = v => $('levChips').querySelector('[data-v="' + v + '"]');
  const ev = (p, v) => d.querySelector('.play[data-p="' + p + '"] button[data-v="' + v + '"]');
  const primaries = () => Array.prototype.filter.call(d.querySelectorAll('.bar-ctl .btn'), b => !b.classList.contains('sec') && !b.classList.contains('ghost') && !b.hidden);
  const A = w.__ail;
  return { w, d, $, click, type, chip, st, lev, ev, primaries, A, S: () => A.S(), next: () => click($('primary')), back: () => click($('back')), text: () => $('primary').textContent };
}
function onlyScreen(t, n){ for (let i = 0; i <= 6; i++) if (!t.$('s' + i).hidden !== (i === n)) return false; return true; }
async function blobText(b){ return b && b.text ? await b.text() : ''; }
function setLadder(t, map){
  const S = t.S();
  S.st = {}; S.lev = {}; S.other = {}; S.split = {}; S.know = {}; S.focusSet = false;
  for (const n in map){ S.st[n] = map[n][0]; S.lev[n] = map[n][1] || []; }
}

(async function(){
  console.log('[statics]');
  check('no em or en dashes', !html.includes('—') && !html.includes('–'));
  check('noindex meta present', html.includes('<meta name="robots" content="noindex, nofollow">'));
  check('no analytics: Clarity is gone', !/clarity/i.test(html));
  check('no external scripts at all', !/<script[^>]+src=/i.test(html));
  const storageLines = html.split('\n').filter(l => /sessionStorage|localStorage/.test(l));
  check('every storage access is guarded', storageLines.length > 0 && storageLines.every(l => l.includes('try{')));
  check('no localStorage (answers live in the tab only)', !html.includes('localStorage'));
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const tmp = path.join(os.tmpdir(), 'ail-check.js'); fs.writeFileSync(tmp, scripts.join('\n'));
  let syntaxOk = true; try { execFileSync(process.execPath, ['--check', tmp]); } catch(e){ syntaxOk = false; }
  check('inline script passes node --check', syntaxOk);
  const copyOnly = html.replace(/sessionStorage/g, '');
  check('client copy never says "session"', !/\bsession\b/i.test(copyOnly));
  check('client copy never names a product, the firm or a client', !/ExperiencePoint|WBWAI|Work Better|KickstartChange|Trulioo|\bthe workshop\b/i.test(html) && !/\bSpark\b/.test(html));
  check('cover says where answers go', html.includes('Your answers stay in this browser tab and clear when you close it. Nothing you enter is sent anywhere.'));
  check('"Ask before you measure" kept word for word', html.includes('Talk to three to five leaders about what would convince them. Test the measures on one team for about six weeks. Adjust before you scale.'));
  check('no count-ups or frost transitions', !/countUp|backdrop-filter|data-count/.test(html));
  check('no "where it breaks" language', !/where it breaks|breakRung/i.test(html));

  console.log('[cover]');
  let dom = load(); let t = tools(dom);
  check('cover is the only screen', onlyScreen(t, 0));
  check('primary says Begin', t.text() === 'Begin');
  check('Back and Note hidden on the cover', t.$('back').hidden && t.$('noteBtn').hidden);
  check('six labelled steps in the navigator', t.$('steps').querySelectorAll('button').length === 6 && t.$('steps').textContent.includes('Measures'));
  check('cover ladder drawn with four rungs', t.$('coverArt').querySelectorAll('line.rg').length === 4);
  t.type(t.$('who'), 'Acme <script>alert(1)</script> & Co');
  t.type(t.$('by'), 'Pat "Q" Lee');
  check('prepared for and with are saved', t.S().who.startsWith('Acme <script>') && t.S().by === 'Pat "Q" Lee');
  t.next();

  console.log('[1 today]');
  check('Today is the only screen', onlyScreen(t, 1));
  check('navigator marks step 1 current', t.$('steps').querySelector('[aria-current="step"]').getAttribute('data-go') === '1');
  t.next();
  check('Show without answers asks for them', t.$('h1').textContent.includes('Pick how many'));
  check('reveal stays hidden', t.$('r1').hidden);
  t.click(t.chip('qUse', 'half')); t.click(t.chip('qRes', 'little'));
  check('chips record answers', t.S().use === 'half' && t.S().res === 'little');
  t.next();
  check('reveal shows', !t.$('r1').hidden);
  check('read for half and a little', t.$('r1say').textContent.startsWith('Use is running ahead of results'));
  check('80% and 37% gap shown with McKinsey sample', t.$('r1').textContent.includes('80%') && t.$('r1').textContent.includes('37%') && t.$('r1').textContent.includes('1,719'));
  check('core idea shown', t.$('r1').textContent.includes('Value shows up when the work itself changes.'));
  t.click(t.chip('qUse', 'unsure'));
  check('"Not sure" gets a generous read, never "first thing to fix"', t.$('r1say').textContent.startsWith('Plenty of organizations') && !/first thing to fix/.test(t.$('r1say').textContent));
  t.click(t.chip('qUse', 'half'));
  check('primary now says Next', t.text() === 'Next');
  t.next();

  console.log('[2 priorities]');
  check('Priorities is the only screen', onlyScreen(t, 2));
  t.next();
  check('Show without picks asks for one', t.$('h2').textContent === 'Pick at least one.');
  ['risk','capacity','quality'].forEach(id => t.click(t.chip('qPrio', id)));
  t.click(t.chip('qPrio', 'rev'));
  check('a fourth pick is refused with a hint', t.S().prios.length === 3 && t.$('h2').textContent.includes('Three is the limit'));
  t.next();
  check('destinations lit by picks', t.d.querySelector('.dest[data-dest="better"]').classList.contains('on') && t.d.querySelector('.dest[data-dest="more"]').classList.contains('on') && t.d.querySelector('.dest[data-dest="new"]').classList.contains('off'));
  check('"Same work, less effort" names overtime and outside spend', t.d.querySelector('.dest[data-dest="less"]').textContent.includes('overtime'));
  check('one watch row per pick', t.$('watch').children.length === 3);
  t.next();

  console.log('[3 ladder]');
  check('Ladder opens on the intro', onlyScreen(t, 3) && !t.$('ladIntro').hidden && t.$('ladRung').hidden);
  check('intro draws four rungs, top first', t.$('ladBig').querySelectorAll('.lrow').length === 4 && t.$('ladBig').querySelector('.lrow').getAttribute('data-rung') === '4');
  check('intro shows owners in plain words', t.$('ladBig').textContent.includes('Usually owned by IT and L&D') && t.$('ladBig').textContent.includes('Usually owned by executives and finance'));
  check('intro says rungs can move together', t.$('ladAfter').textContent.includes('Rungs can move at the same time'));
  check('"Why these four" cites McKinsey, BCG, Microsoft, Kirkpatrick, Prosci', ['McKinsey','BCG','Microsoft','Kirkpatrick','Prosci'].every(s => t.$('ladAfter').textContent.includes(s)));
  check('primary says Start with Ready', t.text() === 'Start with Ready');
  check('mini ladder is on from step 3', t.$('mini').classList.contains('on') && t.$('mini').querySelectorAll('.mr').length === 4);
  t.next();
  check('rung 1 page', !t.$('ladRung').hidden && t.$('ladRung').textContent.includes('Ready: people can.'));
  check('How\'s it going comes before What\'s helping', t.$('ladRung').textContent.indexOf('How\'s it going?') < t.$('ladRung').textContent.indexOf('What\'s helping?'));
  check('four status options, no failing option', [...t.$('stChips').querySelectorAll('button')].map(b => b.textContent).join('|') === 'Going well|Mixed|Not yet|Can\'t tell');
  check('no "Nothing yet" chip to tick', !/Nothing yet/.test(t.$('ladRung').textContent));
  check('"How do you know?" waits for a status', !t.$('knowChips'));
  t.click(t.st('mixed'));
  check('status recorded', t.S().st[1].join() === 'mixed');
  check('"How do you know?" appears', !!t.$('knowChips'));
  t.click(t.$('knowChips').querySelector('[data-v="data"]'));
  ['tools','guide','train'].forEach(v => t.click(t.lev(v)));
  check('levers recorded', t.S().lev[1].length === 3);
  check('mini ladder shows Ready as mixed and current', t.$('mini').textContent.includes('Mixed') && t.$('mini').querySelector('.mr.cur') !== null);
  t.click(t.st('cant'));
  check('"Can\'t tell" clears and hides "How do you know?"', !t.$('knowChips') && !t.S().know[1]);
  t.click(t.st('mixed'));
  t.next();
  check('primary says Next rung', t.text() === 'Next rung');
  t.click(t.$('splitBtn'));
  t.click(t.st('well')); t.click(t.st('mixed'));
  check('views differ: two answers kept', t.S().st[2].join() === 'well,mixed');
  check('split counts as the less favorable answer', t.A.statusOf(2) === 'mixed');
  check('split shown as "Views differ"', t.$('mini').textContent.includes('Views differ: Going well and Mixed'));
  t.click(t.st('not'));
  check('a third pick replaces the oldest', t.S().st[2].join() === 'mixed,not');
  t.click(t.$('splitBtn'));
  check('turning split off keeps one answer', t.S().st[2].length === 1);
  t.click(t.st(t.S().st[2][0]));
  check('tapping the same answer again clears it', t.S().st[2].length === 0);
  t.click(t.st('mixed'));
  ['champ','lib'].forEach(v => t.click(t.lev(v)));
  t.next();
  t.click(t.st('mixed'));
  t.type(t.$('otherIn'), 'Claims pilot');
  check('"Something else" lever saved and lit', t.S().other[3] === 'Claims pilot' && t.$('otherIn').classList.contains('on'));
  t.next();
  t.click(t.st('cant'));
  t.back();
  check('Back steps down a rung', t.S().sub === 3 && t.$('ladRung').textContent.includes('Changing'));
  t.next(); t.next();

  console.log('[4 focus]');
  check('Focus is the only screen', onlyScreen(t, 4));
  const sg = t.A.suggest();
  check('Ready mixed with three levers does not win', sg.n === 3 && sg.kind === 'thin');
  check('focus preselects the suggestion', t.S().focus === 3 && t.d.querySelector('.frow[data-rung="3"]').getAttribute('aria-pressed') === 'true');
  check('suggestion marked on the ladder', t.d.querySelector('.frow[data-rung="3"]').textContent.includes('Our suggestion'));
  check('reason keeps the client\'s own words', t.$('fwhy').textContent === 'Changing is mixed, and the only help in place is “Claims pilot”. Every rung above builds on it.');
  check('three moves and the training line', t.$('fcard').querySelectorAll('li').length === 3 && t.$('fcard').textContent.includes('What training can and can\'t do here'));
  check('"Can\'t tell" never counts against a rung, said on screen', t.$('fcard').textContent.includes('never counts against a rung'));
  check('no challenge when the suggestion is chosen', !t.$('fcheck'));
  t.click(t.d.querySelector('.frow[data-rung="4"]'));
  check('client can choose a higher rung', t.S().focus === 4 && t.S().focusSet);
  check('gentle challenge appears', t.$('fcheck').textContent === 'Worth a check: Changing is mixed, and Paying off depends on it.');
  check('card says what was suggested, without repeating the check', t.$('fwhy').textContent === 'We\'d suggested Changing.');
  check('mini ladder marks the chosen focus', t.$('mini').querySelector('.mr.foc .nm').textContent.startsWith('Paying off'));
  t.click(t.d.querySelector('.frow[data-rung="3"]'));

  console.log('[focus rule scenarios]');
  const keep = JSON.parse(JSON.stringify(t.S()));
  setLadder(t, {1:[['mixed'],['tools','guide','train']], 2:[['mixed'],['champ','lib']], 3:[['mixed'],['wksp','own']], 4:[['cant'],[]]});
  let s = t.A.suggest();
  check('all mixed with help in place: fewest levers wins, lower rung on a tie, never Ready with three in place', s.n === 2 && s.kind === 'mixed');
  setLadder(t, {1:[['well']], 2:[['not'],['champ','lib','help']], 3:[['mixed'],[]]});
  check('a stuck rung below beats a thin rung above', t.A.suggest().n === 2 && t.A.suggest().kind === 'stuck');
  setLadder(t, {2:[['mixed'],['champ','lib']]});
  check('one mixed rung reads naturally', t.A.why(t.A.suggest()) === 'Using is mixed, with some help in place. It\'s the place to push next.');
  setLadder(t, {1:[['mixed'],['train']]});
  check('one lever reads as a sentence', t.A.why(t.A.suggest()) === 'Ready is mixed, and the only help in place is training or workshops. Every rung above builds on it.');
  setLadder(t, {1:[['not'],[]]});
  check('no lever: no doubled "yet"', t.A.why(t.A.suggest()) === 'Ready isn\'t there yet, and nothing is in place to help it. Every rung above builds on it.');
  setLadder(t, {1:[['mixed'],[]], 3:[['not'],[]]});
  check('a basic gap with nothing in place is suggested', t.A.suggest().n === 1);
  setLadder(t, {1:[['mixed'],['tools','guide','train']], 3:[['not'],['wksp','time']]});
  s = t.A.suggest();
  check('"Not yet" despite help: suggested, with a question', s.n === 3 && s.kind === 'stuck' && t.A.why(s).includes('Worth asking what\'s in the way'));
  setLadder(t, {1:[['well']], 2:[['well']], 3:[['well']], 4:[['cant']]});
  s = t.A.suggest();
  check('everything well, Paying off can\'t tell: measure it', s.n === 4 && s.kind === 'cant');
  setLadder(t, {1:[['well']], 2:[['cant']], 3:[['mixed'],['own']], 4:[['cant']]});
  check('"Can\'t tell" never outranks a rung that is actually mixed', t.A.suggest().n === 3);
  setLadder(t, {1:[['well']], 2:[['well']]});
  s = t.A.suggest();
  check('all answered rungs well: suggest the next one up', s.n === 3 && s.kind === 'well');
  setLadder(t, {1:[['well']], 2:[['well']], 3:[['well']], 4:[['well']]});
  check('all four well: Paying off, keep showing it', t.A.suggest().n === 4 && t.A.why(t.A.suggest()).includes('spread what works'));
  setLadder(t, {});
  check('nothing answered: no suggestion', t.A.suggest() === null);
  setLadder(t, {2:[['mixed'],[]], 4:[['mixed'],['base','credit']]});
  t.S().focus = 4; t.S().focusSet = true;
  check('challenge names both rungs', t.A.challenge() === 'Worth a check: Using is mixed, and Paying off depends on it.');
  Object.assign(t.S(), keep);
  t.next();

  console.log('[5 measures]');
  check('Measures is the only screen', onlyScreen(t, 5));
  check('"Ask before you measure" with three questions', t.$('askq').children.length === 3 && t.$('askq').textContent.includes('a year from now') && t.$('askq').textContent.includes('decision like this get made here'));
  check('no "prospective hindsight" jargon on screen', !/prospective hindsight/i.test(t.d.querySelector('#s5').textContent));
  const secs = [...t.d.querySelectorAll('.rsec')];
  check('focus rung listed first and open', secs[0].getAttribute('data-rung') === '3' && secs[0].querySelectorAll('.play').length === 3 && secs[0].textContent.includes('Your focus'));
  const sec = n => t.d.querySelector('.rsec[data-rung="' + n + '"]');
  check('"Can\'t tell" rung open too', sec(4).querySelectorAll('.play').length === 3 && sec(4).textContent.includes('Can\'t tell yet'));
  check('other rungs collapsed', sec(1).querySelectorAll('.play').length === 0 && sec(2).querySelectorAll('.play').length === 0);
  t.click(sec(1).querySelector('.rsh'));
  check('a collapsed rung opens on tap', sec(1).querySelectorAll('.play').length === 2);
  check('licences rated low, workflow before and after rated high', t.d.querySelector('.play[data-p="r1"] .trust').getAttribute('aria-label').includes('1 of 3') && t.d.querySelector('.play[data-p="c2"] .trust').getAttribute('aria-label').includes('3 of 3'));
  check('"Value agreed with finance" is back', !!t.d.querySelector('.play[data-p="p1"]') && t.d.querySelector('.play[data-p="p1"]').textContent.includes('how AI gets credit'));
  check('picker offers "Wouldn\'t convince"', !!t.ev('c1', 'no'));
  check('each measure has "How to run it"', t.d.querySelectorAll('.play details.how').length === t.d.querySelectorAll('.play').length);
  t.next();
  check('Show without ratings asks for one', t.$('h5').textContent.includes('Mark at least one'));
  t.click(t.ev('r1', 'have'));
  t.click(t.ev('c1', 'easy')); t.click(t.ev('c2', 'have')); t.click(t.ev('c3', 'hard'));
  t.click(t.ev('p1', 'hard')); t.click(t.ev('p2', 'easy')); t.click(t.ev('p3', 'no'));
  t.click(t.ev('r1', 'have'));
  check('tapping a rating twice clears it', !t.S().ev.r1);
  t.click(t.ev('r1', 'have'));
  t.next();
  const picks = t.A.startPicks().map(p => p.id);
  check('start with focus rung first, already-have before easy', picks.join() === 'c2,c1,p2');
  check('picks shown', t.$('picks').children.length === 3 && t.$('picks').textContent.includes('One workflow, before and after'));
  check('reveal reads like a person', t.$('r5say').textContent === 'One you already collect, two easy to add. Run them with one team for six weeks, then adjust.');
  check('no "of these 10" counting copy', !/of these \d+/.test(t.$('r5').textContent));
  check('plan for later lists the hard ones', t.$('later').textContent.includes('Value agreed with finance') && t.$('later').textContent.includes('Quality and risk held'));
  check('"Wouldn\'t convince" never picked', !picks.includes('p3') && !t.$('later').textContent.includes('Where freed capacity went'));
  const S5 = t.S(); const evKeep = JSON.parse(JSON.stringify(S5.ev));
  S5.ev = {r1:'have', u1:'have', u2:'easy', c1:'easy'}; S5.focus = 2; S5.focusSet = true;
  check('a strong measure is swapped in when all picks are weak', t.A.startPicks().some(p => p.trust >= 2));
  S5.ev = evKeep; S5.focus = 3;

  console.log('[notes]');
  t.click(t.$('noteBtn'));
  check('note popover opens for this step', !t.$('notepop').hidden && t.$('npCtx').textContent === 'Measures');
  t.$('npText').value = 'CFO: "show me the comparison team"';
  t.$('npPark').checked = true;
  t.click(t.$('npDone'));
  check('parked note saved', !!t.S().notes.meas && t.S().notes.meas.park === true);
  check('Note button shows a dot', t.$('noteBtn').classList.contains('has'));
  t.click(t.d.querySelector('.pnote[data-k="m:c2"]'));
  check('measure note opens with its name', t.$('npCtx').textContent === 'Measure: One workflow, before and after');
  t.$('npText').value = 'Proposal turnaround <b>lives in Salesforce</b>';
  t.click(t.d.body);
  check('clicking away saves and closes', t.$('notepop').hidden && t.S().notes['m:c2'].t.includes('Salesforce'));
  check('measure note dot shows', t.d.querySelector('.pnote[data-k="m:c2"]').classList.contains('has'));
  t.next();

  console.log('[6 plan]');
  check('Plan is the only screen', onlyScreen(t, 6));
  check('band escapes the name', t.$('plan').querySelector('.band h2').textContent === 'Acme <script>alert(1)</script> & Co' && !t.$('plan').querySelector('.band script'));
  check('band shows prepared with and focus', t.$('plan').querySelector('.band').textContent.includes('Prepared with Pat "Q" Lee') && t.$('plan').querySelector('.band').textContent.includes('Focus: Changing'));
  check('band ladder pins the focus rung', t.$('plan').querySelectorAll('.band svg circle').length === 1);
  check('three workflow rows with five fields', t.$('plan').querySelectorAll('.wf .row:not(.hd)').length === 3 && t.$('plan').querySelectorAll('.wf .inp').length === 15);
  t.type(t.$('plan').querySelector('[data-k="wf.0.w"]'), 'Claims first notice <x>');
  t.type(t.$('plan').querySelector('[data-k="wf.0.n"]'), 'Cycle time');
  t.type(t.$('plan').querySelector('[data-k="team"]'), 'Claims East');
  t.type(t.$('plan').querySelector('[data-k="ag.0.o"]'), 'Dana');
  t.type(t.$('plan').querySelector('[data-k="next.what"]'), 'Book the redesign workshop');
  check('plan fields saved', t.S().plan.wf[0].w === 'Claims first notice <x>' && t.S().plan.team === 'Claims East' && t.S().plan.ag[0].o === 'Dana');
  check('three agreements, each with owner and date', t.$('plan').querySelectorAll('.agl li').length === 3 && t.$('plan').querySelectorAll('.agl .inp').length === 6);
  check('notes listed for review', t.$('plan').querySelectorAll('.notes li').length === 2);
  const incMeas = t.$('plan').querySelector('[data-inc="meas"]'), incC2 = t.$('plan').querySelector('[data-inc="m:c2"]');
  check('parked note in by default, quote out by default', incMeas.checked && !incC2.checked);
  check('note text escaped on screen', t.$('plan').querySelector('.notes li[data-k="m:c2"] .tx').textContent.includes('<b>lives in Salesforce</b>'));
  check('"Where you are" shows every rung', t.$('plan').querySelectorAll('.where li').length === 4);
  check('spreadsheet button on the hosted page', !!t.$('csvBtn'));
  check('primary says Download report', t.text() === 'Download report');
  check('Copy as text alongside', !t.$('copy').hidden);
  const wf1 = t.$('plan').querySelector('[data-k="wf.1.w"]');
  t.click(t.$('noteBtn')); t.$('npText').value = 'typed while planning'; t.click(wf1);
  check('closing a note leaves the plan fields in place', wf1.isConnected && t.$('notepop').hidden);
  delete t.S().notes.plan;

  let M = t.A.model();
  check('model leaves unticked quotes out', M.notes.length === 0 && M.parked.length === 1);
  const txt = t.A.summaryText(M);
  check('text has focus, workflow, measures, agreements, next step', ['Focus: Changing','Claims first notice <x>','Start with these measures','One workflow, before and after','Three things to agree together','Owner: Dana','What: Book the redesign workshop','To come back to'].every(x => txt.includes(x)));
  check('text marks blanks to fill', txt.includes('Baseline: ________'));
  check('text leaves the unticked quote out', !txt.includes('Salesforce'));
  incC2.checked = true; incC2.dispatchEvent(new t.w.Event('change', { bubbles:true }));
  M = t.A.model();
  check('ticking a note puts it in', M.notes.length === 1 && t.A.summaryText(M).includes('In your words'));

  const doc = t.A.reportDoc(M);
  check('report escapes everything typed', !doc.includes('<script>alert') && doc.includes('Acme &lt;script&gt;') && doc.includes('Claims first notice &lt;x&gt;') && doc.includes('&lt;b&gt;lives in Salesforce'));
  check('report: cover, then the plan, then where you are', doc.indexOf('class="cover"') > -1 && doc.indexOf('The plan') < doc.indexOf('Where you are'));
  check('report page one leads with focus and workflows', doc.indexOf('Focus: Changing') < doc.indexOf('Workflows to prove it on') && doc.indexOf('Workflows to prove it on') < doc.indexOf('Start with these measures'));
  check('report credits who prepared it', doc.includes('Prepared with Pat &quot;Q&quot; Lee'));
  check('report has no em dashes', !doc.includes('—'));
  check('report prints with page breaks', doc.includes('break-after:page') && doc.includes('print-color-adjust:exact'));

  const csv = t.A.csv();
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  check('CSV starts with a BOM for Excel', csv.charCodeAt(0) === 0xfeff);
  check('CSV header names source, owner, frequency, baseline date', ['Source','Suggested owner','How often','Baseline date'].every(x => lines[0].includes(x)));
  check('CSV skips "Wouldn\'t convince"', lines.length === 7 && !csv.includes('Where freed capacity went'));
  check('CSV flags what to start with', lines.filter(l => l.includes(',Yes,')).length === 3);
  check('CSV quotes cells that hold commas', lines.some(l => l.includes('"Where the workflow runs: ticketing, CRM, document history"')));

  t.next();
  const dl = t.w.__downloads.pop();
  check('download named for the organization and date', !!dl && /^ai-impact-ladder-acme-script-alert-1-script-co-\d{4}-\d{2}-\d{2}\.html$/.test(dl.name));
  check('downloaded file is the report', (await blobText(dl && dl.blob)).includes('Three things to agree together'));
  t.click(t.$('csvBtn'));
  const dl2 = t.w.__downloads.pop();
  check('spreadsheet download named', !!dl2 && /^ai-impact-ladder-measures-acme-.*\.csv$/.test(dl2.name));
  t.click(t.$('copy'));
  await new Promise(r => setTimeout(r, 10));
  check('copy as text puts the plan on the clipboard', (t.w.__clip || '').startsWith('AI impact plan: Acme'));

  t.click(t.$('plan').querySelector('[data-del="m:c2"]'));
  check('delete removes a note', !t.S().notes['m:c2'] && t.$('plan').querySelectorAll('.notes li').length === 1);

  console.log('[navigation]');
  t.click(t.$('steps').querySelector('[data-go="3"]'));
  check('navigator jumps back to the ladder, same rung', onlyScreen(t, 3) && t.S().sub === 4);
  t.click(t.$('steps').querySelector('[data-go="6"]'));
  check('and forward to the plan', onlyScreen(t, 6));
  check('one primary button per screen', t.primaries().length === 1);
  const rb = t.$('restartBtn');
  t.click(rb);
  check('start over asks for a second click', rb.textContent.includes('Click again') && t.S().step === 6);
  t.click(rb);
  check('second click clears everything', onlyScreen(t, 0) && t.S().prios.length === 0 && t.S().who === '' && Object.keys(t.S().notes).length === 0);

  console.log('[reload]');
  const pre = JSON.parse(JSON.stringify(keep)); pre.step = 4; pre.v = 3;
  dom = load(HOSTED, { preload: pre }); t = tools(dom);
  check('picks up where it left off', onlyScreen(t, 4) && t.S().use === 'half' && t.S().st[3].join() === 'mixed');
  check('focus card rebuilt', t.$('fcard').textContent.includes('Focus: Changing'));
  dom = load(HOSTED, { preload: { step:5, use:'most' }, key:'ail.v1' }); t = tools(dom);
  check('old v1 answers are ignored', onlyScreen(t, 0) && t.S().use === null);
  dom = load(HOSTED, { preload: { v:3, step:99, sub:-4, prios:'oops', plan:null } }); t = tools(dom);
  check('bad saved state is clamped and repaired', t.S().step === 6 && t.S().sub === 0 && Array.isArray(t.S().prios) && Array.isArray(t.S().plan.wf));

  console.log('[elsewhere]');
  dom = load(ELSEWHERE, { preload: Object.assign(JSON.parse(JSON.stringify(keep)), {step:6, v:3}) }); t = tools(dom);
  check('off the hosted page, primary copies text', t.text() === 'Copy as text');
  check('no download or spreadsheet buttons', t.$('copy').hidden && !t.$('csvBtn'));
  check('note says downloads work on the hosted page', t.$('plan').textContent.includes('Downloads work on the hosted page.'));
  t.next();
  await new Promise(r => setTimeout(r, 10));
  check('copy works off-host', (t.w.__clip || '').startsWith('AI impact plan') && t.w.__downloads.length === 0);

  console.log('[blocked storage]');
  dom = load(HOSTED, { blockStorage: true }); t = tools(dom);
  t.next(); t.click(t.chip('qUse', 'most')); t.click(t.chip('qRes', 'clear')); t.next();
  check('works with storage blocked', !t.$('r1').hidden && t.$('r1say').textContent.startsWith('You\'re ahead of most'));
  t.next(); t.click(t.chip('qPrio', 'cost')); t.next(); t.next(); t.next();
  t.click(t.st('not'));
  for (let i = 0; i < 4; i++) t.next();
  check('reaches Focus with storage blocked', onlyScreen(t, 4) && t.S().focus === 1);

  console.log('[keyboard and navigator]');
  dom = load(); t = tools(dom);
  t.click(t.$('steps').querySelector('[data-go="6"]'));
  check('jumping ahead does not mark skipped steps done', t.$('steps').querySelectorAll('button.done').length === 0);
  check('no spreadsheet button with nothing marked', !t.$('csvBtn'));
  t.click(t.$('steps').querySelector('[data-go="1"]'));
  t.chip('qUse', 'most').focus(); t.click(t.chip('qUse', 'most'));
  check('focus stays on the chip after picking', t.d.activeElement === t.chip('qUse', 'most'));
  check('cover rungs visible with reduced motion', html.includes('.cover-art .rg{stroke-dashoffset:0}'));
  t.click(t.$('noteBtn')); t.type(t.$('npText'), 'saved as I type');
  check('note text saved while typing', !!t.S().notes.today && t.S().notes.today.t === 'saved as I type');

  console.log(failures ? '\n' + failures + ' FAILED' : '\nAll checks passed');
  process.exit(failures ? 1 : 0);
})();
