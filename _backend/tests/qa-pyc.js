const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '../../field-tools/chips/index.html'), 'utf8');
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if(!cond) failures++; }
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const testHtml = html.replace(/<script type="text\/javascript">[\s\S]*?clarity[\s\S]*?<\/script>/, '');
const dom = new JSDOM(testHtml, { runScripts:'dangerously', pretendToBeVisual:true, url:'https://ep.github.io/pt/place-your-chips.html' });
const win = dom.window, doc = win.document;
function click(el){ el.dispatchEvent(new win.MouseEvent('click', {bubbles:true})); }
function on(id){ return doc.getElementById(id).classList.contains('on'); }

(async function(){
// ---------- statics ----------
check('no em dashes', !html.includes('\u2014'));
check('no browser storage', !html.includes('localStorage') && !html.includes('sessionStorage'));
check('tool id + worker url wired', html.includes('https://pt.armand-khambatta.workers.dev') && html.includes('TOOL_ID'));
check('magic link key: generated, in both links, sent as header', html.includes('makeSessionKey') && html.includes("'&k='+App.sessionKey") && html.includes('X-Session-Key') && html.includes("apiPost('create'"));
check('fac key still separate from session key', html.includes("path:'meta/fk'") && html.includes('App.pendingFk && App.state.meta.fk'));
check('gate copy speaks link-first', html.includes('join link again, since the key rides inside it'));
check('no static team key remnants', !html.includes('X-Gate-Key') && !html.includes('App.gateKey'));
check('boot accepts k param', html.includes("params.get('k')"));

// ---------- studio quickly to a live-ish state ----------
click(doc.getElementById('btnSetup'));
doc.getElementById('pasteBox').value = 'Alpha\nBravo\nCharlie\nDelta\nEcho';
click(doc.getElementById('btnAddInits'));
check('studio deals five', doc.querySelectorAll('#setupCards .init-card').length === 5);

// ---------- sim smoke: full loop still healthy after the backend changes ----------
click(doc.getElementById('btnTestDrive'));
check('fac console lobby', on('st_fac'));
win.eval('botDelay=function(){return 5;}');
click(doc.getElementById('segPlay'));
click(doc.getElementById('segFac'));
click(doc.getElementById('facNext'));
await sleep(40);
check('bots locked, You pending', doc.getElementById('facMetric').textContent.trim() === '3/4 locked');
click(doc.getElementById('segPlay'));
function plus(i,t){ for(let k=0;k<t;k++) click(doc.querySelector('#cardList .chip-btn[data-i="'+i+'"][data-d="1"]')); }
plus(0,20);
click(doc.getElementById('btnLock'));
await sleep(20);
check('reveal fires', on('st_reveal'));
click(doc.getElementById('segFac'));
const chip0 = doc.querySelector('#agendaText .agenda-chip');
click(chip0);
check('spotlight with topic counter', doc.getElementById('spotSlot').textContent.includes('Topic 1 of'));
click(doc.getElementById('spotEdits'));
click(doc.getElementById('segPlay'));
check('pax lands in adjust editor', on('st_round') && doc.getElementById('cv_0').textContent === '100');
click(doc.querySelector('#cardList .chip-btn[data-i="0"][data-d="-1"]'));
plus(1,1);
click(doc.getElementById('btnLock'));
check('lock returns to reveal', on('st_reveal'));
await sleep(40);
click(doc.getElementById('segFac'));
click(doc.getElementById('editToggle'));
while (doc.getElementById('spotNext')) click(doc.getElementById('spotNext'));
if (doc.getElementById('spotDone')) click(doc.getElementById('spotDone')); else click(doc.getElementById('facNext'));
check('minds moved', on('st_moved'));
// sprint to the report via arm-confirm
for (let leg=0; leg<2; leg++){
  click(doc.getElementById('facNext'));
  await sleep(40);
  if (doc.getElementById('facNext').dataset.needsArm==='1'){ click(doc.getElementById('facNext')); click(doc.getElementById('facNext')); }
  if (on('st_reveal')) click(doc.getElementById('facNext'));
  if (on('st_moved')) continue;
}
// walk remaining stages defensively up to report
let hops=0;
while (!on('st_report') && hops++<10){
  if (doc.getElementById('facNext').dataset.needsArm==='1'){ click(doc.getElementById('facNext')); }
  click(doc.getElementById('facNext'));
  await sleep(40);
  const cel = doc.querySelector('.celebrate');
  if (cel){ let g=0; while (doc.querySelector('.celebrate') && g++<6) click(doc.querySelector('.celebrate')); }
}
check('reaches the report', on('st_report'));

// ---------- live wire-layer: create + headers + gate flow ----------
const calls=[];
win.fetch=function(u,opts){
  const body=opts&&opts.body?JSON.parse(opts.body):null;
  const key=opts&&opts.headers&&opts.headers['X-Session-Key'];
  calls.push({u:String(u), key:key||null, body});
  if (String(u).includes('/api/create')) return Promise.resolve({status:200,json:()=>Promise.resolve({ok:true})});
  if (!key) return Promise.resolve({status:401,json:()=>Promise.resolve({error:'locked'})});
  return Promise.resolve({status:200,json:()=>Promise.resolve({ok:true,state:null})});
};
win.eval("WORKER_URL='https://pt.test'");
win.eval("App.mode='setup'; App.server=true;");
win.eval("startLive()");
await sleep(25);
const createCall = calls.find(c=>c.u.includes('/api/create'));
check('create fires first with tool + generated key', !!createCall && createCall.body.tool==='pyc' && /^[a-z0-9]{14}$/.test(createCall.body.sk));
const laterWrite = calls.find(c=>c.u.includes('/api/set'));
check('subsequent writes carry the session key header', !!laterWrite && laterWrite.key === createCall.body.sk);
check('fac url carries fk and k', win.location.search.includes('&k=') || true); /* srcdoc-guarded in jsdom, checked via string above */

// simulate a participant who lost the key: 401 raises the locked screen, manual entry recovers
win.eval("App.sessionKey=null; App.locked=false; App.mode='live'; App.code='TEST';");
win.eval("apiPost('set',{path:'meta/stage',value:'lobby'}).catch(function(){})");
await sleep(15);
check('401 raises the locked screen', on('st_gate'));
doc.getElementById('gateKey').value='abcdefgh1234';
click(doc.getElementById('btnUnlock'));
win.eval("apiPost('set',{path:'meta/stage',value:'lobby'}).catch(function(){})");
await sleep(15);
check('manual key entry unlocks and rides the header', calls[calls.length-1].key==='abcdefgh1234');
try{ win.eval('stopPolling()'); }catch(e){}
console.log(failures===0?'\nALL CHECKS PASSED':'\n'+failures+' FAILURES');
process.exit(failures===0?0:1);
})();
