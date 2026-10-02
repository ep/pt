/* qa-kc-report-builder.mjs: jsdom harness for kc/report-builder/index.html.
   Loads made-up KickstartChange CSVs (built in this file, no CSV files in the repo), one row per team,
   clicks through the setup screen and checks the report: one chapter per team in the order team,
   change, Hallway Huddle, then the rest; one change for everyone or one per team; the highlights and
   their numbers; skipped activities; the copies for Google Docs and for AI; and the page's security lock.
   Run: node _backend/tests/qa-kc-report-builder.mjs   (needs: npm install jsdom) */
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, '../../kc/report-builder/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if (!cond) failures++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ------------------------------------------------------------ made-up sessions */
const q = v => /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
function csv(cols, teams, first){
  const lines = [[first === undefined ? 'Team' : first].concat(cols).map(q).join(',')];
  teams.forEach(t => lines.push([t.name || ''].concat(cols.map(c => t[c] || '')).map(q).join(',')));
  return lines.join('\n') + '\n';
}
const ALL = ['Preserve and Let Go','The Change','Why Change',"Who's Involved",'Key Persona',"What's In It For Them",'Future Behaviors','Barriers','Key Barrier','Barrier Busting Idea','Hallway Huddle'];
function team(name, change, o){
  return Object.assign({
    name,
    'Preserve and Let Go': '1. Customer focus,Weekly huddles\n\n2. Paper forms',
    'The Change': change,
    'Why Change': 'Clients wait too long for answers and we lose deals.',
    "Who's Involved": 'Sales\nService\nIT',
    'Key Persona': 'A ten-year account manager who knows every client by name.',
    "What's In It For Them": 'Less admin, more time with clients.',
    'Future Behaviors': 'Log calls same day\nAsk for help early',
    'Barriers': 'Old habits\nNo time to learn',
    'Key Barrier': 'No time to learn',
    'Barrier Busting Idea': '15-minute Friday practice slots',
    'Hallway Huddle': 'Rehearsed with a skeptical manager. It landed when we led with time saved.'
  }, o || {});
}
const SAME = [
  team('Blue <b>Table</b>', 'Move to the new CRM'),
  team('Green', 'Move to the new CRM', { 'Barriers': '[no submission]' }),
  team('Red', 'move to the new CRM.', { 'Hallway Huddle': '' }),
  { name: 'Absent' } /* a team with no answers anywhere is left out */
];
const DIFF = [team('Blue', 'Move to the new CRM'), team('', 'Hybrid work policy'), team('Red', 'New expense tool')];

/* ------------------------------------------------------------ driving the page */
function load(){
  return new JSDOM(html, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://ep.github.io/pt/kc/report-builder/', beforeParse(w){
    w.scrollTo = () => {};
    w.Element.prototype.scrollIntoView = function(){};
    w.printed = 0; w.print = () => { w.printed++; };
    w.copied = null; w.ai = null;
    w.ClipboardItem = class { constructor(items){ this.items = items; } };
    Object.defineProperty(w.navigator, 'clipboard', { value: {
      write: async (list) => { const it = list[0].items; w.copied = { html: await it['text/html'].text(), text: await it['text/plain'].text() }; },
      writeText: async (t) => { w.ai = t; }
    } });
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
const pressedV = (w, group) => { const b = w.document.querySelector('#' + group + ' [aria-pressed="true"]'); return b ? b.getAttribute('data-v') : null; };
function build(w){ click(w, w.document.getElementById('build')); }
const report = w => w.document.getElementById('report');
const statements = w => Array.from(w.document.querySelectorAll('#report .hl .st')).map(p => p.textContent);
const chapters = w => Array.from(w.document.querySelectorAll('#report .tchap'));
const chapterActs = ch => Array.from(ch.querySelectorAll('.tact h3')).map(h => h.textContent);
function untick(w, name){
  const li = Array.from(w.document.querySelectorAll('#acts li')).find(l => l.querySelector('.an').textContent === name);
  const box = li.querySelector('input'); box.checked = false; box.dispatchEvent(new w.Event('change'));
}

(async () => {
  /* ------------------------------------------------------------ the file itself */
  console.log('\n[the file]');
  const main = html.match(/<script>([\s\S]*?)<\/script>/);
  const hash = 'sha256-' + crypto.createHash('sha256').update(main[1], 'utf8').digest('base64');
  check('security lock matches the script (the page will run)', html.includes("script-src '" + hash + "'"));
  check('only one script runs on the page', (html.match(/<script>/g) || []).length === 1);
  check('the lock blocks every outgoing request', /default-src 'none'/.test(html) && /connect-src 'none'/.test(html));
  check('no web addresses in the script', !/https?:\/\//.test(main[1].replace(/'http:\/\/www\.w3\.org\/2000\/svg'/, '')));
  check('no analytics or network calls', !/clarity|fetch\(|XMLHttpRequest|sendBeacon|WebSocket/i.test(main[1]));
  check('no em or en dashes anywhere', !/[–—]/.test(html));
  check('no copyright line anywhere', !/copyright/i.test(html));
  check('robots tag says noindex, nofollow', html.includes('<meta name="robots" content="noindex, nofollow">'));
  const labels = JSON.parse(html.match(/<script type="application\/json" id="labels">([\s\S]*?)<\/script>/)[1]);
  const ids = labels.activities.map(a => a.id);
  const known = new RegExp('^(org|=.+|(teams|teamsOne|teamsEach|(' + ids.join('|') + ')(Teams|1|2)?)(\\|[^|]+){0,2})$');
  const tokens = [].concat(labels.highlights.oneOrg, labels.highlights.openEnrolment).flatMap(s => s.say).flatMap(t => (t.match(/\{[^}]*\}/g) || []).map(x => x.slice(1, -1)));
  check('every highlight sentence uses known numbers only', tokens.length > 0 && tokens.every(t => known.test(t)));
  check('the AI prompt speaks to whoever reads the report', !/facilitator|ExperiencePoint/i.test(labels.ai.prompt.join(' ')));

  /* ------------------------------------------------------------ one change for everyone */
  console.log('\n[one change for everyone]');
  let dom = load(), w = dom.window, d = w.document;
  await give(w, csv(ALL, SAME));
  check('summary counts teams and leaves out the empty one', d.getElementById('fsum').textContent === '3 teams · 11 activities · 1 with no answers left out');
  check('the same change everywhere starts as one change', pressedV(w, 'mode') === 'one' && d.getElementById('fChange').value === 'Move to the new CRM' && !d.getElementById('changeFld').hidden);
  check('no team name or layout option', !d.getElementById('names') && !d.getElementById('layout'));
  const listed = Array.from(d.querySelectorAll('#acts .an')).map(s => s.textContent);
  check('the change is not a tick box', !listed.includes('The change'));
  check('the Hallway Huddle is listed first', listed[1] === 'The Hallway Huddle');
  build(w);
  check('building asks who took part', !d.getElementById('buildErr').hidden && d.getElementById('setup').hidden === false);
  choose(w, 'aud', 'org'); d.getElementById('fOrg').value = 'Acme';
  build(w);
  check('the cover carries the change', report(w).querySelector('.cover .change').textContent === 'Move to the new CRM');
  const ch = chapters(w);
  check('one chapter per team', ch.length === 3);
  check('chapters are titled by team name, as text', ch[0].querySelector('h2').textContent === 'Blue <b>Table</b>' && !ch[0].querySelector('h2 b'));
  check('a shared change is not repeated in each chapter', ch.every(c => !c.querySelector('.tchange')));
  check('the Hallway Huddle comes right after the team', chapterActs(ch[0])[0] === 'The Hallway Huddle' && ch[0].querySelector('.tact.lead'));
  check('the rest follows in LABELS order', chapterActs(ch[0]).slice(1, 4).join('|') === 'What to preserve, and what to let go|Why the change matters|Who the change touches');
  check('a team that skipped the huddle starts with the rest', chapterActs(ch[2])[0] === 'What to preserve, and what to let go');
  check('preserve and let go keep their names', Array.from(ch[0].querySelectorAll('h4')).map(h => h.textContent).join('|') === 'Preserve|Let go');
  check('a no-submission answer shows nothing', !chapterActs(ch[1]).includes('What could get in the way'));
  const st = statements(w);
  check('five highlights', st.length === 5);
  check('teams and the organization', st[0] === '3 teams took on the same change at Acme, and each built its own plan to make it stick.');
  check('preserve and let go counted', st[1].startsWith('Chose 6 things to preserve and 3 things to let go'));
  check('barriers counted by item, ideas by team', st[3] === 'Spotted 4 barriers that could slow the change down, and came up with 3 barrier-busting ideas.');
  check('huddles counted by team', st[4].includes('rehearsed 2 real conversations'));

  console.log('\n[copies]');
  click(w, d.getElementById('copy')); await sleep(20);
  check('Google Docs copy escapes text', w.copied.html.includes('Blue &lt;b&gt;Table&lt;/b&gt;') && !w.copied.html.includes('<b>Table'));
  check('Google Docs copy reads team by team', w.copied.text.indexOf('Blue <b>Table</b>') < w.copied.text.indexOf('Green') && w.copied.text.includes('Prepared for Acme'));
  click(w, d.getElementById('copyAI')); await sleep(20);
  check('AI copy starts with the prompt', w.ai.startsWith(labels.ai.prompt[0]));
  check('AI copy carries the shared change and team names', w.ai.includes('same change: Move to the new CRM') && w.ai.includes('\nGreen\n'));
  check('AI copy leaves out the organization', !w.ai.includes('Acme'));
  check('AI copy puts the huddle first in each team', w.ai.indexOf('The Hallway Huddle') < w.ai.indexOf('What to preserve'));
  click(w, d.getElementById('print'));
  check('Save as PDF prints', w.printed === 1);

  /* ------------------------------------------------------------ a change per team */
  console.log('\n[a different change per team, open enrolment]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(ALL, DIFF));
  check('different changes start as one per team', pressedV(w, 'mode') === 'team' && d.getElementById('changeFld').hidden);
  choose(w, 'aud', 'open');
  untick(w, 'Who the change touches');
  build(w);
  const c2 = chapters(w);
  check('each chapter shows its own change', c2.map(c => c.querySelector('.tchange').textContent).join('|') === 'Move to the new CRM|Hybrid work policy|New expense tool');
  check('a team with no name is numbered', c2[1].querySelector('h2').textContent === 'Team 2');
  check('no change on the cover', !report(w).querySelector('.cover .change'));
  check('an unticked activity is left out', !chapterActs(c2[0]).includes('Who the change touches'));
  check('open enrolment wording', statements(w)[0].startsWith('3 teams each took on a real change from their own organizations'));
  click(w, d.getElementById('copyAI')); await sleep(20);
  check('AI copy gives each team its change', w.ai.includes('Team 2\nThe change: Hybrid work policy') && w.ai.includes('Each team worked on its own change.'));

  /* ------------------------------------------------------------ skipped activities */
  console.log('\n[skipped activities, no team column header]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, csv(['The Change', 'Barriers'], DIFF, ''));
  choose(w, 'aud', 'org'); build(w);
  check('only what ran is in the report', chapters(w).length === 3 && chapterActs(chapters(w)[0]).join('|') === 'What could get in the way');
  check('missing activities drop their sentences', statements(w).length === 2);

  console.log('\n[wrong files]');
  dom = load(); w = dom.window; d = w.document;
  await give(w, 'PK\u0003\u0004binary', 'session.xlsx');
  check('an Excel file gets a plain message', d.getElementById('fileErr').textContent === 'This is an Excel file. Export it as CSV and try again.');
  await give(w, 'just one line');
  check('a file that is not an export gets a plain message', d.getElementById('fileErr').textContent === "This doesn't look like a KickstartChange report CSV.");

  console.log('\n' + (failures ? failures + ' FAILED' : 'All checks passed.'));
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
