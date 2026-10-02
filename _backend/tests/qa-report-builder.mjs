/* qa-report-builder.mjs: jsdom harness for wbwai201/report-builder/index.html.
   Loads made-up workshop CSVs (built in this file, no CSV files in the repo), clicks
   through the setup screen and checks the report: the highlights and their numbers,
   one organization and open enrolment wording, skipped activities, section order,
   name shortening, the confidentiality line, and the copy for Google Docs.
   It also checks the page's security lock still matches its script.
   Run: node _backend/tests/qa-report-builder.mjs   (needs: npm install jsdom) */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../wbwai201/report-builder/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ made-up sessions */
const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
function csv(cols, people){
  const lines = [[''].concat(cols).map(q).join(',')];
  people.forEach(p => lines.push([p.name].concat(cols.map(c => p[c] || '')).map(q).join(',')));
  return lines.join('\n') + '\n';
}
const two = (a, b, sep) => [a.length ? '1. ' + a.join(sep || ',') + ' ' : '', b.length ? '2. ' + b.join(sep || ',') : ''].filter(Boolean).join('\n\n');
const ALL = ['AI Adoption Curve','Hopes and Fears','Dormant Resources','Build Your First Agent','Core Value','Abundant vs Scarce'];
const SHUFFLED = ['Hopes and Fears','Dormant Resources','AI Adoption Curve','Build Your First Agent','Core Value','Abundant vs Scarce'];
const LONGNAME = 'Maximiliana Theodora Featherstonehaugh-Wolfeschlegel';
const AAA = 'A'.repeat(40);

function person(name, d){
  return {
    name,
    'AI Adoption Curve': '1. ' + d.curve,
    'Hopes and Fears': two(d.hopes, d.fears),
    'Dormant Resources': d.doc.length || d.like.length ? two(d.doc, d.like) : '[no submission]',
    'Build Your First Agent': d.agent ? '1. ' + d.agent : '[no submission]',
    'Core Value': d.value ? '1. My role exists to ' + d.value + ', so that leaders can act' : '',
    'Abundant vs Scarce': two(d.easy, d.hard, '\n')
  };
}
const SAMPLE = [
  person('Maya Alvarez', { curve:'Optimization Value', hopes:['Faster first drafts','More time with clients'], fears:['Losing the craft'], doc:['Travel policy','Pricing guide'], like:['Winning proposal'], agent:'Policy helper', value:'help clients decide', easy:['Meeting notes','Scheduling'], hard:['Earning trust'] }),
  person('Jordan Brooks', { curve:'Early Friction', hopes:['Less copy and paste'], fears:['Mistakes nobody catches','<script>alert(1)</script> & "quotes"'], doc:['Onboarding handbook'], like:[], agent:'', value:'keep customers coming back', easy:['Formatting slides'], hard:['Coaching people','Setting direction'] }),
  person(LONGNAME, { curve:'Optimization Value', hopes:['Room to experiment'], fears:[], doc:['Brand voice guide','Expense rules','Product FAQ'], like:['Best case study','Board update'], agent:'Meeting notes agent', value:'protect quality', easy:['Summarizing documents'], hard:[] }),
  person(AAA, { curve:'Explosive Innovation Value', hopes:['Smarter notes'], fears:['Bias in outputs'], doc:[], like:['Launch email'], agent:'Proposal drafter', value:'', easy:['Translating notes','Searching old files'], hard:['Reading the room'] }),
  person('g', { curve:'Optimization Value', hopes:['Quicker proposals'], fears:['Too many tools'], doc:['Security checklist'], like:[], agent:'', value:'build great teams', easy:[], hard:['Telling a client no'] }),
  person('Priya Chandra', { curve:'Early Friction', hopes:[], fears:['My role shrinking'], doc:['Vendor checklist','IT articles'], like:['Town hall script'], agent:'Reply drafter', value:'turn data into plans', easy:['Building agendas'], hard:['Spotting the real problem'] }),
  { name: 'Ben Okoro' } /* registered, answered nothing: left out of every count */
];
const EXP = {
  people: 6,
  dormant: 3 + 1 + 5 + 1 + 1 + 3,
  hopes: 3 + 3 + 1 + 2 + 2 + 1,
  value: 5,
  easy: 2 + 1 + 1 + 2 + 0 + 1,
  hard: 1 + 2 + 0 + 1 + 1 + 1
};
const perPerson = (Math.round(EXP.dormant / EXP.people * 10) / 10).toFixed(1).replace(/\.0$/, '');

/* ------------------------------------------------------------ driving the page */
function load(){
  return new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://ep.github.io/pt/wbwai201/report-builder/', beforeParse(w){
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = function(){};
    w.printed = 0; w.print = () => { w.printed++; };
    w.copied = null;
    w.ClipboardItem = class { constructor(items){ this.items = items; } };
    Object.defineProperty(w.navigator, 'clipboard', { value: { write: async (list) => {
      const it = list[0].items; w.copied = { html: await it['text/html'].text(), text: await it['text/plain'].text() };
    } } });
  } });
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles:true }));
async function give(w, text, name){
  const input = w.document.getElementById('file');
  const file = new w.File([text], name || 'session.csv', { type:'text/csv' });
  Object.defineProperty(input, 'files', { value:[file], configurable:true });
  input.dispatchEvent(new w.Event('change'));
  await sleep(30);
}
const choose = (w, group, v) => click(w, w.document.querySelector('#' + group + ' [data-v="' + v + '"]'));
function setOrg(w, v){ w.document.getElementById('fOrg').value = v; }
function build(w){ click(w, w.document.getElementById('build')); }
const report = w => w.document.getElementById('report');
const statements = w => Array.from(w.document.querySelectorAll('#report .hl .st')).map(p => p.textContent);
const sections = w => Array.from(w.document.querySelectorAll('#report .rsec')).map(s => s.querySelector('h2').textContent);
function bulletsUnder(w, headline){
  const sec = Array.from(w.document.querySelectorAll('#report .rsec')).find(s => s.querySelector('h2').textContent === headline);
  return sec ? sec.querySelectorAll('.cell:not(.gap)').length : -1;
}
function untick(w, name){
  const li = Array.from(w.document.querySelectorAll('#acts li')).find(l => l.querySelector('.an').textContent === name);
  const box = li.querySelector('input'); box.checked = false; box.dispatchEvent(new w.Event('change'));
}
const H = {
  hl: 'What this group achieved', curve: 'Where people place themselves on the AI curve', hopes: 'What people hope for, and what worries them',
  dormant: 'Resources people already have, ready to put to work', agent: 'The agents people built',
  value: 'Where people say they create value', scarce: 'What to hand to AI, and what to keep human-led'
};

(async () => {
  /* ------------------------------------------------------------ the file itself */
  console.log('\n[the file]');
  const main = html.match(/<script>([\s\S]*?)<\/script>/);
  const hash = 'sha256-' + crypto.createHash('sha256').update(main[1], 'utf8').digest('base64');
  check('security lock matches the script (the page will run)', html.includes("script-src '" + hash + "'"));
  check('only one script runs on the page', (html.match(/<script>/g) || []).length === 1);
  check('the lock blocks every outgoing request', /default-src 'none'/.test(html) && /connect-src 'none'/.test(html));
  check('no web addresses in the script', !/https?:\/\//.test(main[1].replace(/'http:\/\/www\.w3\.org\/2000\/svg'/, '')));
  check('no em or en dashes anywhere', !/[\u2013\u2014]/.test(html));
  check('no copyright line anywhere', !/copyright/i.test(html));
  check('robots tag says noindex, nofollow', html.includes('<meta name="robots" content="noindex, nofollow">'));
  const labels = JSON.parse(html.match(/<script type="application\/json" id="labels">([\s\S]*?)<\/script>/)[1]);
  const known = /^(org|=.+|(dormant|hopes|value|easy|hard|perPerson)(\|[^|]+){0,2})$/;
  const tokens = [].concat(labels.highlights.oneOrg, labels.highlights.openEnrolment).flatMap(s => s.say).flatMap(t => (t.match(/\{[^}]*\}/g) || []).map(x => x.slice(1, -1)));
  check('every highlight sentence uses known numbers only', tokens.length > 0 && tokens.every(t => known.test(t)));
  check('LABELS lists the curve first', labels.activities[0].id === 'curve');

  /* ------------------------------------------------------------ one organization, names shown */
  console.log('\n[one organization, names shown, curve column not first]');
  let dom = load(), w = dom.window, d = w.document;
  await give(w, csv(SHUFFLED, SAMPLE));
  check('setup shows the options after a file', !d.getElementById('opts').hidden);
  check('file summary counts people who took part', d.getElementById('fsum').textContent === '6 people · 6 activities · 1 with no answers left out');
  check('highlights is the first Include row, ticked', d.querySelector('#acts li .an').textContent === H.hl && d.querySelector('#acts li input').checked);
  check('Include rows follow the LABELS order', Array.from(d.querySelectorAll('#acts .an')).map(x => x.textContent).join('|') === [H.hl, H.curve, H.hopes, H.dormant, H.agent, H.value, H.scarce].join('|'));
  build(w);
  check('build waits for who took part', d.getElementById('viewer').hidden && d.getElementById('buildErr').textContent === 'Choose One organization or Open enrolment.' && d.getElementById('aud').classList.contains('need'));
  choose(w, 'aud', 'org');
  check('organization field label changes', d.getElementById('orgLabel').textContent === 'Organization');
  check('anonymous is chosen by default, and says it is recommended', d.querySelector('#names [aria-pressed="true"]').getAttribute('data-v') === 'anon' && d.querySelector('#names [data-v="anon"]').textContent === 'Anonymous (recommended)');
  choose(w, 'names', 'show');
  setOrg(w, 'Northwind Test Co');
  d.getElementById('fDate').value = '2026-10-01';
  build(w);
  check('report is built', !d.getElementById('viewer').hidden && !!report(w));
  const rep = report(w).textContent;
  check('cover counts 6 participants', rep.includes('6 participants'));
  check('cover carries the confidentiality line', d.querySelector('#report .cover .conf').textContent === labels.report.confidential);
  check('no copyright text in the report', !/copyright/i.test(rep));
  check('section order: highlights, then curve first', sections(w).join('|') === [H.hl, H.curve, H.hopes, H.dormant, H.agent, H.value, H.scarce].join('|'));
  const st = statements(w);
  check('four highlight sentences', st.length === 4);
  check('resources sentence, exact', st[0] === 'Identified ' + EXP.dormant + ' dormant resources, ' + perPerson + ' per person: existing assets AI can multiply in value across Northwind Test Co.');
  check('resources number equals the bullets in its section', bulletsUnder(w, H.dormant) === EXP.dormant);
  check('hopes and fears sentence, exact', st[1] === 'Shared ' + EXP.hopes + ' hopes and fears, a candid read on sentiment to guide the next AI decisions at Northwind Test Co.');
  check('hopes and fears number equals the bullets in its section', bulletsUnder(w, H.hopes) === EXP.hopes);
  check('value sentence joins both activities', st[2] === 'Wrote ' + EXP.value + ' core value statements defining the enduring value of each role at Northwind Test Co, and named ' + EXP.easy + ' tasks where AI delegation could make sense.');
  check('agents sentence, with the general figure', st[3] === 'Built AI agents for their own work and shared workflows, cutting friction while keeping human judgment at the helm. Groups average 1 to 3 agents per person.');
  const rings = Array.from(d.querySelectorAll('#report .hl .hn')).map(x => x.textContent);
  check('numbers are ringed', rings.join('|') === [EXP.dormant, perPerson, EXP.hopes, EXP.value, EXP.easy, '1 to 3'].join('|'));
  check('each sentence has its own tint', Array.from(d.querySelectorAll('#report .hl .st')).map(p => p.className).join('|') === 'st t-gold|st t-teal|st t-clay|st t-fern');
  check('curve bars are drawn as shapes', d.querySelectorAll('#report .crow svg.track rect').length === 6 && d.querySelectorAll('#report .crow svg.track')[1].querySelectorAll('rect')[1].getAttribute('width') === '50.00%');
  check('names longer than 30 characters are shortened', rep.includes('Maximiliana Theodora Feathers…') && !rep.includes(LONGNAME));
  check('unbroken junk names are shortened', rep.includes('A'.repeat(29) + '…') && !rep.includes(AAA));
  check('short names stay whole', Array.from(d.querySelectorAll('#report .who')).some(x => x.textContent === 'g'));
  check('the person who answered nothing is left out', !rep.includes('Ben Okoro'));
  check('typed markup shows as text', rep.includes('<script>alert(1)</script> & "quotes"') && !d.querySelector('#report script'));
  const box = d.getElementById('pagebox').textContent;
  check('print footer has page numbers and no copyright', box.includes('counter(page)') && !/copyright/i.test(box));
  check('first printed page has no margin, so Chrome adds no file address', box.includes('@page:first{margin:0;'));
  click(w, d.getElementById('print'));
  check('Save as PDF prints straight from the click', w.printed === 1);
  click(w, d.getElementById('copy'));
  await sleep(30);
  check('Google Docs copy has the highlights with bold numbers', w.copied && w.copied.html.includes('What this group achieved') && w.copied.html.includes('<b>' + EXP.dormant + '</b>'));
  check('Google Docs copy has the confidentiality line and no copyright', w.copied.html.includes('Confidential. These results') && !/copyright/i.test(w.copied.html + w.copied.text));
  check('Google Docs copy escapes typed markup', w.copied.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !w.copied.html.includes('<script>alert'));
  check('plain text copy has the sentences', w.copied.text.includes(st[0]) && w.copied.text.includes(st[3]));

  console.log('\n[edit: untick an activity, then the highlights]');
  click(w, d.getElementById('edit'));
  untick(w, H.dormant);
  build(w);
  check('unticked activity loses its section and its sentence', !sections(w).includes(H.dormant) && statements(w).length === 3 && !statements(w)[0].includes('dormant'));
  click(w, d.getElementById('edit'));
  untick(w, H.hl);
  build(w);
  check('unticked highlights leave no highlights section', !d.querySelector('#report .hl') && sections(w)[0] === H.curve);
  click(w, d.getElementById('restart'));
  check('start over goes back to an empty drop zone', d.getElementById('opts').hidden && !d.getElementById('setup').hidden);
  await give(w, csv(ALL, SAMPLE));
  check('the next file starts fresh: no audience, anonymous, no organization', d.querySelector('#aud [aria-pressed="true"]') === null && d.querySelector('#names [aria-pressed="true"]').getAttribute('data-v') === 'anon' && d.getElementById('fOrg').value === '');

  /* ------------------------------------------------------------ open enrolment, anonymous */
  console.log('\n[open enrolment, anonymous]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(ALL, SAMPLE));
  choose(w, 'aud', 'open'); choose(w, 'names', 'anon');
  check('open enrolment keeps the Prepared for label', d.getElementById('orgLabel').textContent === 'Prepared for');
  setOrg(w, 'Leadership Programme 2026');
  build(w);
  const st2 = statements(w), rep2 = report(w).textContent;
  check('cover still says who it was prepared for', rep2.includes('Prepared for Leadership Programme 2026'));
  check('no organization name in the highlights', st2.every(s => !s.includes('Leadership Programme')));
  check('resources sentence, open wording', st2[0] === 'Identified ' + EXP.dormant + ' dormant resources, ' + perPerson + ' per person: existing assets AI can multiply in value across their organizations.');
  check('hopes and fears sentence, open wording', st2[1] === 'Shared ' + EXP.hopes + ' hopes and fears, a candid read on how professionals across organizations feel about AI today.');
  check('value sentence, open wording', st2[2] === 'Wrote ' + EXP.value + ' core value statements defining the enduring value of their roles, and named ' + EXP.easy + ' tasks where AI delegation could make sense.');
  check('anonymous report has no names', !d.querySelector('#report .who') && !rep2.includes('Maya Alvarez') && !rep2.includes('Priya'));
  check('curve is still first after the highlights', sections(w)[1] === H.curve);

  /* ------------------------------------------------------------ skipped activities */
  console.log('\n[skipped activities: only curve, core value, abundant vs scarce]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(['Core Value', 'AI Adoption Curve', 'Abundant vs Scarce'], SAMPLE));
  choose(w, 'aud', 'org'); choose(w, 'names', 'anon');
  build(w);
  const st3 = statements(w);
  check('only the sections that ran, curve first', sections(w).join('|') === [H.hl, H.curve, H.value, H.scarce].join('|'));
  check('no resources or hopes sentences', st3.length === 2 && !st3.some(s => /dormant|hopes/.test(s)));
  check('no organization typed: the sentence says your organization', st3[0].includes('each role at your organization'));
  check('agents sentence still shows', st3[1].startsWith('Built AI agents'));
  check('no ringed zero anywhere', Array.from(d.querySelectorAll('#report .hn')).every(x => x.textContent !== '0'));

  console.log('\n[only abundant vs scarce]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(['Abundant vs Scarce'], SAMPLE));
  choose(w, 'aud', 'org'); choose(w, 'names', 'anon');
  build(w);
  check('delegation sentence names both lists', statements(w)[0] === 'Named ' + EXP.easy + ' tasks where AI delegation could make sense, and ' + EXP.hard + ' tasks where human judgment matters most.');

  console.log('\n[an activity with no answers, and singular wording]');
  const quiet = [
    { name:'Ana', 'Dormant Resources':'1. Travel policy', 'Hopes and Fears':'[no submission]' },
    { name:'Raj', 'Dormant Resources':'[no submission]', 'Hopes and Fears':'' }
  ];
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(['Hopes and Fears', 'Dormant Resources'], quiet));
  const rows = Array.from(d.querySelectorAll('#acts li'));
  const hopesRow = rows.find(l => l.querySelector('.an').textContent === H.hopes);
  check('an activity nobody answered starts unticked', hopesRow && !hopesRow.querySelector('input').checked && hopesRow.querySelector('.ct').textContent === 'No answers');
  check('a person with no answers anywhere is left out', d.getElementById('fsum').textContent.startsWith('1 person'));
  choose(w, 'aud', 'org'); choose(w, 'names', 'anon');
  build(w);
  check('one resource reads as singular', statements(w)[0].startsWith('Identified 1 dormant resource, 1 per person:'));
  check('the unanswered activity is not in the report', !sections(w).includes(H.hopes));

  /* ------------------------------------------------------------ a big room */
  console.log('\n[a big room]');
  const big = [];
  for (let i = 0; i < 45; i++) big.push(person('Person ' + i, { curve:'Optimization Value', hopes:['Hope ' + i], fears:['Fear ' + i], doc:['Doc ' + i, 'Guide ' + i], like:['Model ' + i], agent:'', value:'serve ' + i, easy:['Task ' + i], hard:['Judgment ' + i] }));
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(ALL, big));
  check('more than 40 people starts in the compact layout', d.querySelector('#layout [data-v="compact"]').getAttribute('aria-pressed') === 'true');
  choose(w, 'aud', 'org'); choose(w, 'names', 'show');
  build(w);
  check('compact report keeps the highlights', report(w).classList.contains('compact') && statements(w).length === 4);
  check('three resources per person', statements(w)[0].includes(', 3 per person:'));

  console.log('\n[wrong files]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, 'PK\u0003\u0004binary', 'session.xlsx');
  check('an Excel file gets a plain message', d.getElementById('fileErr').textContent === 'This is an Excel file. Export it as CSV and try again.');
  await give(w, 'just one line');
  check('a file that is not an export gets a plain message', d.getElementById('fileErr').textContent === "This doesn't look like a WBWAI 201 report CSV.");

  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed.'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
