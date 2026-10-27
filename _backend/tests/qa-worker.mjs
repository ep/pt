import worker from '../pt-worker.js';
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if(!cond) failures++; }

import { FakeDB } from './fake-db.mjs';

const base='https://pt.test';
const env={ DB: FakeDB() };  /* no dashboard variable: the code default must gate pyc */
async function call(method, path, body, headers){
  const req=new Request(base+path,{method, headers:Object.assign({'Content-Type':'application/json'},headers||{}),
    body: body?JSON.stringify(body):undefined});
  const res=await worker.fetch(req, env);
  let data=null; try{ data=await res.json(); }catch(e){}
  return { status:res.status, data, headers:res.headers };
}
const SK='abcdefgh1234';
const KH={'X-Session-Key':SK};

(async function(){
// health names the gated tools
let r=await call('GET','/api/health');
check('gating works with no dashboard variable set, Room Pulse included', r.data.ok===true && r.data.gatedTools.join()==='pyc,pair-poll,room-pulse');
/* and a dashboard variable, if ever set, still wins */
const ovEnv={ DB: FakeDB(), GATED_TOOLS:'other-tool' };
const ovRes=await worker.fetch(new Request(base+'/api/health'), ovEnv);
const ovData=await ovRes.json();
check('dashboard variable overrides the code default', ovData.gatedTools.join()==='other-tool');

// gated tool lifecycle
r=await call('POST','/api/create',{tool:'pyc',code:'ABCD',sk:SK});
check('create registers a session', r.data.ok===true);
r=await call('POST','/api/create',{tool:'pyc',code:'ABCD',sk:'zzzzzzzz9999'});
check('second create on the same code refused', r.data.ok===false);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'meta/stage',value:'lobby'});
check('gated write without key: locked', r.status===401);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'meta/stage',value:'lobby'},{'X-Session-Key':'wrongwrong11'});
check('gated write with wrong key: locked', r.status===401);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'meta/stage',value:'lobby'},KH);
check('gated write with the link key works', r.data.ok===true);
r=await call('GET','/api/state?tool=pyc&code=ABCD');
check('gated read without key: locked', r.status===401);
r=await call('GET','/api/state?tool=pyc&code=ABCD',null,KH);
check('gated read with key returns state', r.data.state.meta.stage==='lobby');
check('the session key itself never appears in state', JSON.stringify(r.data.state).indexOf(SK)===-1);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'_sk',value:'hijack'},KH);
check('underscore paths refused', r.status===400);
r=await call('POST','/api/claim',{tool:'pyc',code:'ABCD',path:'pax/p1',value:{nick:'Priya'}},KH);
check('claim works behind the gate', r.data.ok===true);
r=await call('POST','/api/claim',{tool:'pyc',code:'ABCD',path:'pax/p1',value:{nick:'Sam'}},KH);
check('double claim refused', r.data.ok===false);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'pax/p2',value:{nick:'X'}},KH);
check('seat writes must use claim', r.status===400);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'bad path!',value:1},KH);
check('bad path rejected', r.status===400);
r=await call('POST','/api/set',{tool:'pyc',code:'ABCD',path:'meta/x',value:'y'.repeat(5000)},KH);
check('oversize value rejected', r.status===400);
r=await call('GET','/api/state?tool=pyc&code=ZZZZ',null,KH);
check('unknown session reads as empty, not an error', r.status===200 && r.data.state===null);

// open sessions: the code opens the participant door, the key stays with the host
r=await call('POST','/api/create',{tool:'pair-poll',code:'OPEN',sk:SK,open:['roster','ballot']});
check('create with open prefixes registers a session', r.data.ok===true);
r=await call('POST','/api/create',{tool:'pair-poll',code:'BADO',sk:SK,open:['Roster!']});
check('open prefixes are validated', r.status===400);
r=await call('POST','/api/create',{tool:'pair-poll',code:'BADO',sk:SK,open:[]});
check('an empty open list is refused', r.status===400);
await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'pub/meta',value:{stage:'vote',q:0}},KH);
r=await call('GET','/api/state?tool=pair-poll&code=OPEN&prefix=pub');
check('open session: read with the code alone works', r.status===200 && r.data.state.pub.meta.stage==='vote');
r=await call('GET','/api/state?tool=pair-poll&code=OPEN');
check('open session: full read with the code alone works too', r.status===200 && r.data.state.pub.meta.q===0);
check('open session: internals never leave the notebook', JSON.stringify(r.data.state).indexOf('_open')===-1 && JSON.stringify(r.data.state).indexOf(SK)===-1);
r=await call('GET','/api/state?tool=pair-poll&code=OPEN',null,{'X-Session-Key':'wrongwrong11'});
check('open session: a wrong key is still refused', r.status===401);
r=await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'roster/r1x2y3',value:{}});
check('open session: guest writes under an open prefix', r.data.ok===true);
r=await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'ballot/q0/b1x2y3',value:'L'});
check('open session: guest writes a ballot', r.data.ok===true);
r=await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'pub/meta',value:{stage:'recap'}});
check('open session: guest cannot touch facilitator paths', r.status===401);
r=await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'rosterx/r1',value:{}});
check('open prefix matches the whole segment, not a substring', r.status===401);
r=await call('POST','/api/clear',{tool:'pair-poll',code:'OPEN'});
check('open session: guest cannot clear', r.status===401);
r=await call('GET','/api/state?tool=pair-poll&code=OPEN',null,KH);
check('open session: host reads everything', r.data.state.roster.r1x2y3!==undefined && r.data.state.ballot.q0.b1x2y3==='L');
r=await call('POST','/api/set',{tool:'pair-poll',code:'OPEN',path:'pub/meta',value:{stage:'recap'}},KH);
check('open session: host writes facilitator paths', r.data.ok===true);
r=await call('POST','/api/clear',{tool:'pair-poll',code:'OPEN'},KH);
check('open session: host clears', r.data.ok===true);
r=await call('GET','/api/state?tool=pair-poll&code=OPEN');
check('cleared open session reads as empty', r.status===200 && r.data.state===null);
r=await call('POST','/api/create',{tool:'pyc',code:'SHUT',sk:SK});
r=await call('GET','/api/state?tool=pyc&code=SHUT');
check('closed sessions (chips) still need the key for every read', r.status===401);
r=await call('POST','/api/set',{tool:'pyc',code:'SHUT',path:'meta/stage',value:'x'});
check('closed sessions still need the key for every write', r.status===401);
r=await call('POST','/api/set',{tool:'pair-poll',code:'NOPE',path:'roster/r1',value:{}});
check('a write to a session that does not exist is refused', r.status===401);

// slim reads for big rooms (pair-poll)
r=await call('POST','/api/create',{tool:'pair-poll',code:'POLL',sk:SK});
check('pair-poll is gated by the code default', r.data.ok===true);
r=await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'pub/meta',value:{stage:'vote'}});
check('pair-poll write without key: locked', r.status===401);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'pub/meta',value:{stage:'vote',q:0}},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'pub/agg/q0',value:{L:13,R:7,n:20}},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'ballot/q0/abc123',value:'L'},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'roster/r1x2y3',value:{nick:'Priya'}},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'public/decoy',value:1},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'pub0',value:1},KH);
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'pub_x',value:1},KH);
for (let i=0;i<40;i++) await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'ballot/q1/b'+i,value:'R'},KH);
env.DB._reads.n=0;
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=pub',null,KH);
check('prefix read touches only its own rows plus the two internals, however many ballots the room holds', env.DB._reads.n<=4);
check('prefix range leaves siblings that merely start with the letters out', r.data.state.pub0===undefined && r.data.state.pub_x===undefined);
env.DB._reads.n=0;
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'ballot/q1/b7',value:'L'},KH);
check('updating an existing row skips the room count', env.DB._reads.n<=3);
env.DB._reads.n=0;
await call('POST','/api/set',{tool:'pair-poll',code:'POLL',path:'ballot/q1/fresh',value:'L'},KH);
check('a new row still pays for the count', env.DB._reads.n>40);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=pub',null,KH);
check('prefix read returns the pub rows', r.data.state.pub.meta.stage==='vote' && r.data.state.pub.agg.q0.L===13);
check('prefix read leaves ballots and roster out', r.data.state.ballot===undefined && r.data.state.roster===undefined);
check('prefix matches the segment, not the substring', r.data.state.public===undefined);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=pub');
check('prefix read without key: locked', r.status===401);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=pub',null,{'X-Session-Key':'wrongwrong11'});
check('prefix read with wrong key: locked', r.status===401);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=_sk',null,KH);
check('underscore prefix rejected', r.status===400);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=bad%20prefix',null,KH);
check('malformed prefix rejected', r.status===400);
r=await call('GET','/api/state?tool=pair-poll&code=POLL&prefix=nothing',null,KH);
check('empty prefix on a live session returns an empty object, not null', r.status===200 && r.data.state!==null && Object.keys(r.data.state).length===0);
r=await call('GET','/api/state?tool=pair-poll&code=NOPE&prefix=pub',null,KH);
check('prefix read of an unknown session reads as empty', r.status===200 && r.data.state===null);
r=await call('GET','/api/state?tool=pair-poll&code=POLL',null,KH);
check('full read still returns everything', r.data.state.ballot.q0.abc123==='L' && r.data.state.roster.r1x2y3.nick==='Priya');
check('the session key never appears in a full read either', JSON.stringify(r.data.state).indexOf(SK)===-1);
await call('POST','/api/clear',{tool:'pair-poll',code:'POLL'},KH);

// ungated tools stay frictionless
r=await call('POST','/api/set',{tool:'open',code:'ABCD',path:'meta/stage',value:'go'});
check('ungated tool writes keyless', r.data.ok===true);
r=await call('GET','/api/state?tool=open&code=ABCD');
check('ungated tool reads keyless', r.data.state.meta.stage==='go');
check('same code, different tools, separate rooms', r.data.state.meta.stage!=='lobby');
r=await call('POST','/api/set',{tool:'BAD TOOL!',code:'ABCD',path:'meta/x',value:1});
check('bad tool id rejected', r.status===400);

// clear
r=await call('POST','/api/clear',{tool:'pyc',code:'ABCD'},KH);
check('clear deletes behind the gate', r.data.ok===true);
r=await call('GET','/api/state?tool=pyc&code=ABCD',null,KH);
check('cleared session reads empty', r.data.state===null);

// origin lock: active by default from the code, no dashboard variable needed
async function ocall(origin, oenv){
  const req=new Request(base+'/api/state?tool=open&code=ABCD',{method:'GET',headers:origin?{Origin:origin}:{}});
  const res=await worker.fetch(req, oenv||env);
  return { status:res.status, allow:res.headers.get('Access-Control-Allow-Origin') };
}
let o=await ocall('https://ep.github.io');
check('pages origin passes by default, header echoed', o.status===200 && o.allow==='https://ep.github.io');
o=await ocall('https://evil.example');
check('other origins refused by default', o.status===403);
o=await ocall(null);
check('no-origin requests (health checks, curl) pass', o.status===200);
o=await ocall('https://staging.example', { DB: env.DB, ALLOW_ORIGIN:'https://staging.example' });
check('dashboard variable overrides the code default', o.status===200 && o.allow==='https://staging.example');

// retention sweep
const db2=FakeDB();
const renv={ DB: db2 };
const old=Date.now()-8*864e5, fresh=Date.now();
await db2.prepare('INSERT').bind('pyc:OLDD','meta/stage',JSON.stringify('report'),old).run();
await db2.prepare('INSERT').bind('pyc:OLDD','notes/x',JSON.stringify('sensitive'),old).run();
await db2.prepare('INSERT').bind('pyc:NEWW','meta/stage',JSON.stringify('lobby'),fresh).run();
await worker.scheduled(null,renv,null);
check('7-day sweep removes stale sessions whole', ![...db2._rows.keys()].some(k=>k.startsWith('pyc:OLDD')));
check('7-day sweep keeps live sessions', [...db2._rows.keys()].some(k=>k.startsWith('pyc:NEWW')));


/* ---------- the room row ceiling and the body cap ---------- */
{
  const cenv = { DB: FakeDB(), ROOM_ROWS_MAX: '12' };
  const capApi = async (path, bodyObj, key) => {
    const req = new Request(base+path, { method:'POST', headers: Object.assign({'Content-Type':'application/json'}, key?{'X-Session-Key':key}:{}), body: JSON.stringify(bodyObj) });
    const res = await worker.fetch(req, cenv);
    return { status: res.status, body: await res.json() };
  };
  const ck = 'roomcapkey12345x';
  let r = await capApi('/api/create', { tool:'pair-poll', code:'CAPX', sk:ck, open:['roster','ballot'] });
  check('cap session creates', r.body.ok === true);
  let refusedAt = -1;
  for (let i=0; i<14; i++){
    r = await capApi('/api/set', { tool:'pair-poll', code:'CAPX', path:'roster/g'+i, value:{} });
    if (r.status===409){ refusedAt=i; break; }
  }
  check('a guest filling the room is refused at the ceiling with 409 room full', refusedAt===10 && r.body.error==='room full');
  r = await capApi('/api/set', { tool:'pair-poll', code:'CAPX', path:'roster/g3', value:{ back:true } });
  check('updating an existing row is still allowed at the ceiling', r.status===200 && r.body.ok===true);
  r = await capApi('/api/set', { tool:'pair-poll', code:'CAPX', path:'ballot/q0/newrow', value:'L', }, ck);
  check('the ceiling holds for the key holder too', r.status===409);
  /* browsers always send content-length; undici does not set it on constructed Requests, so state it */
  const bigBody = JSON.stringify({ tool:'pair-poll', code:'CAPX', path:'roster/g3', value:'x'.repeat(20000) });
  const bigReq = new Request(base+'/api/set', { method:'POST', headers:{'Content-Type':'application/json','content-length':String(bigBody.length)}, body: bigBody });
  const bigRes = await worker.fetch(bigReq, cenv);
  check('an outsized body is refused before parsing', bigRes.status===413);
  r = await capApi('/api/create', { tool:'pair-poll', code:'CAPY', sk:ck, open:['roster','ballot'] });
  r = await capApi('/api/set', { tool:'pair-poll', code:'CAPY', path:'pub/meta', value:{ stage:'lobby' } }, ck);
  check('a room under the ceiling writes normally in the same environment', r.status===200 && r.body.ok===true);
}

/* ---------- source: what the deployed file promises ---------- */
{
  const fs = await import('fs'); const url = await import('url'); const path = await import('path');
  const src = fs.readFileSync(path.join(path.dirname(url.fileURLToPath(import.meta.url)), '../pt-worker.js'), 'utf8');
  check('the prefix read is a range, never LIKE', /path >= \? AND path < \?/.test(src) && !/LIKE/.test(src));
  check('the AI proxy note no longer claims it is safe as written', /Not safe to turn on as written/.test(src) && !/only a live gated session can spend budget/.test(src));
  check('no free-tier wording left in the worker', !/free tier/i.test(src));
  /* Room Pulse: open session with presence and ballots, nothing else */
  const renv = { DB: FakeDB() };
  const rp = async (pth, body, key) => { const req=new Request(base+pth,{method:body?'POST':'GET',headers:Object.assign({'Content-Type':'application/json'},key?{'X-Session-Key':key}:{}),body:body?JSON.stringify(body):undefined}); const res=await worker.fetch(req, renv); return { status:res.status, body: await res.json() }; };
  let q = await rp('/api/create', { tool:'room-pulse', code:'PULS', sk:SK, open:['here','ballot'] });
  check('room-pulse creates an open session', q.body.ok===true);
  q = await rp('/api/set', { tool:'room-pulse', code:'PULS', path:'here/abc123', value:3 });
  check('room-pulse guest heartbeat is allowed', q.body.ok===true);
  q = await rp('/api/set', { tool:'room-pulse', code:'PULS', path:'ballot/abc123/1', value:{ s:'4013', d:0 } });
  check('room-pulse guest ballot is allowed', q.body.ok===true);
  q = await rp('/api/set', { tool:'room-pulse', code:'PULS', path:'pub/meta', value:{ stage:'open' } });
  check('room-pulse guest cannot touch pub', q.status===401);
  q = await rp('/api/clear', { tool:'room-pulse', code:'PULS' });
  check('room-pulse guest cannot end the session', q.status===401);
  q = await rp('/api/set', { tool:'room-pulse', code:'PULS', path:'pub/meta', value:{ stage:'open' } }, SK);
  check('room-pulse host writes pub', q.body.ok===true);
  /* a page closing sends its last heartbeat as plain text; the worker reads the body either way */
  const beacon = new Request(base+'/api/set', { method:'POST', headers:{'Content-Type':'text/plain;charset=UTF-8','Origin':'https://ep.github.io'}, body: JSON.stringify({ tool:'room-pulse', code:'PULS', path:'here/abc123', value:-1 }) });
  const br = await worker.fetch(beacon, renv);
  check('a closing page can mark itself gone with a plain-text keepalive', br.status===200);
  q = await rp('/api/state?tool=room-pulse&code=PULS&prefix=pub');
  check('room-pulse phones read pub with the code alone', q.status===200 && q.body.state.pub.meta.stage==='open' && q.body.state.here===undefined);
  /* presence by the worker's clock: the console asks when each heartbeat row was written */
  await rp('/api/set', { tool:'room-pulse', code:'PULS', path:'here/zzz999', value:7 });
  renv.DB._rows.get('room-pulse:PULS|here/zzz999').updated = Date.now()-60000;
  const t0 = Date.now();
  q = await rp('/api/state?tool=room-pulse&code=PULS&times=here', null, SK);
  check('times=here returns when each heartbeat was written, and the worker clock', q.status===200 && typeof q.body.now==='number' && q.body.now>=t0 && Object.keys(q.body.times).sort().join()==='abc123,zzz999' && q.body.now-q.body.times.zzz999>=59000 && q.body.now-q.body.times.abc123<5000);
  check('times covers only the asked prefix', q.body.times['1']===undefined && q.body.times['meta']===undefined && q.body.state.ballot.abc123['1'].s==='4013');
  q = await rp('/api/state?tool=room-pulse&code=PULS', null, SK);
  check('without times the read is unchanged', q.status===200 && q.body.times===undefined && q.body.now===undefined);
  q = await rp('/api/state?tool=room-pulse&code=PULS&times=_sk', null, SK);
  check('times rejects an internal or malformed prefix', q.status===400);
  q = await rp('/api/state?tool=room-pulse&code=PULS&times=here', null, 'wrongwrong11');
  check('times needs the same key as any read', q.status===401);
  q = await rp('/api/state?tool=room-pulse&code=PULS&prefix=here&times=here');
  check('a guest prefix read can carry times too, with nothing internal', q.status===200 && q.body.times.abc123>0 && q.body.state._sk===undefined && q.body.state._open===undefined);
}


/* ---------- feedback: testers comment with a tester code, the team reads with its key ---------- */
{
  const TEAM='team-key-0123456789abcdef';
  const fenv={ DB: FakeDB(), FEEDBACK_KEY: TEAM };
  const bare={ DB: FakeDB() };
  async function fb(method, path, body, headers, e){
    const req=new Request(base+path,{method, headers:Object.assign({'Content-Type':'application/json'},headers||{}), body: body?JSON.stringify(body):undefined});
    const res=await worker.fetch(req, e||fenv); let data=null; try{ data=await res.json(); }catch(x){}
    return { status:res.status, data, headers:res.headers };
  }
  const TK={'X-Team-Key':TEAM};
  let q=await fb('GET','/api/health',null,null,bare);
  check('health says feedback is not set up until the secret exists', q.data.feedback===false);
  q=await fb('GET','/api/health');
  check('health says feedback is set up once the secret exists, without showing it', q.data.feedback===true && JSON.stringify(q.data).indexOf(TEAM)===-1);
  q=await fb('GET','/api/fb/tools',null,TK,bare);
  check('team reads refuse politely before the secret is set', q.status===503);
  q=await fb('GET','/api/fb/tools');
  check('team reads need the team key', q.status===401);
  q=await fb('GET','/api/fb/tools',null,{'X-Team-Key':'team-key-wrong-wrong-wrong'});
  check('a wrong team key is refused', q.status===401);
  q=await fb('GET','/api/fb/tools',null,TK);
  check('with the key: no tools and no tester code yet', q.status===200 && q.data.tools.length===0 && q.data.code===null);
  q=await fb('POST','/api/fb/post',{tool:'reimagination-lab',code:'ANYONE',id:'abc12345',edit:'e'.repeat(20),comment:{text:'hi'}});
  check('nobody can post before a tester code exists', q.status===401);
  q=await fb('POST','/api/fb/code',{},TK);
  const CODE=q.data && q.data.code;
  check('the team makes a six-character tester code', q.data.ok===true && /^[A-HJ-NP-Z2-9]{6}$/.test(CODE));
  q=await fb('POST','/api/fb/code',{});
  check('only the team can make a tester code', q.status===401);
  q=await fb('GET','/api/fb/check?code='+CODE.toLowerCase());
  check('a tester link can check its code, in any case', q.data.ok===true);
  q=await fb('GET','/api/fb/check?code=ZZZZZZ');
  check('a wrong code checks false', q.data.ok===false);

  const C1={tool:'reimagination-lab',code:CODE,id:'c1a2b3c4d5',edit:'Edit0123456789abcdef',comment:{name:'Ana',text:'The Next button jumps.',ver:'git:abc',screen:'b-share',where:{x:10,y:20,w:30,h:40},ctx:{device:{browser:'Chrome 141'}}}};
  q=await fb('POST','/api/fb/post',C1,{'CF-Connecting-IP':'1.1.1.1'});
  check('a tester posts a comment with the code', q.data.ok===true && q.data.created>0);
  const created=q.data.created;
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{code:'ZZZZZZ'}));
  check('a wrong tester code cannot post', q.status===401);
  for (const [label, patch] of [['empty text',{comment:{text:'   '}}],['text over 2,000 characters',{comment:{text:'x'.repeat(2001)}}],['a bad id',{id:'BAD ID!'}],['a bad edit token',{edit:'short'}],['a bad tool id',{tool:'Bad Tool'}]]) {
    q=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'n'+Math.random().toString(36).slice(2,10)},patch));
    check('post refuses '+label, q.status===400);
  }
  /* a comment is never refused for its context: too much is trimmed, the words stay whole */
  const longWords='\u{1F600} '.repeat(665)+'end';
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'big12345',comment:{text:longWords,where:{x:1,y:2,w:3,h:4,el:{tag:'p',text:'t',path:'p'.repeat(900),sel:'s'.repeat(900),junk:'j'.repeat(3000)},extra:'e'.repeat(3000)},ctx:{name:'Lab',heading:'H',settings:{a:'1'},actions:Array.from({length:40},(_, i)=>({what:'clicked '+'x'.repeat(200)+i})),errors:[{what:'boom'}],x:'y'.repeat(7000)}}}),{'CF-Connecting-IP':'1.1.1.1'});
  check('an outsized context is trimmed, never refused', q.status===200 && q.data.ok===true, q.status);
  let bigC=(await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK)).data.comments.find(c=>c.id==='big12345');
  check('trimming keeps the tester\'s words whole and the screen\'s name', bigC && bigC.text===longWords && bigC.ctx.name==='Lab' && bigC.ctx.heading==='H' && bigC.ctx.trimmed===true && !('x' in bigC.ctx), bigC && JSON.stringify(bigC.ctx).slice(0,200));
  check('trimming keeps where it points, with long paths cut short', bigC && bigC.where.x===1 && bigC.where.el.tag==='p' && bigC.where.el.path.length<=400 && !('junk' in bigC.where.el) && JSON.stringify(bigC.where).length<=2000, bigC && JSON.stringify(bigC.where).slice(0,200));
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'mid12345',comment:{text:'ok',ctx:{name:'Lab',settings:{a:'1'},actions:Array.from({length:40},(_, i)=>({what:'clicked '+'x'.repeat(200)+i})),errors:[{what:'boom'}]}}}),{'CF-Connecting-IP':'1.1.1.1'});
  bigC=(await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK)).data.comments.find(c=>c.id==='mid12345');
  check('trimming drops the oldest clicks first and keeps the settings', bigC && bigC.ctx.actions.length===4 && bigC.ctx.settings.a==='1' && !bigC.ctx.trimmed, bigC && JSON.stringify(bigC.ctx).slice(0,120));
  await fb('POST','/api/fb/delete',{tool:'reimagination-lab',id:'big12345'},TK);
  await fb('POST','/api/fb/delete',{tool:'reimagination-lab',id:'mid12345'},TK);
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{comment:Object.assign({},C1.comment,{text:'The Next button jumps when the timer starts.'})}),{'CF-Connecting-IP':'1.1.1.1'});
  check('the tester changes their own comment with its edit token', q.data.ok===true && q.data.created===created);
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{edit:'Other0123456789abcdef'}));
  check('nobody else can change it', q.status===401);
  q=await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK);
  const got=q.data.comments[0];
  check('the team reads the comment as written, latest words', q.status===200 && q.data.comments.length===1 && got.text==='The Next button jumps when the timer starts.' && got.name==='Ana' && got.screen==='b-share' && got.where.w===30);
  check('edit tokens never leave the worker', JSON.stringify(q.data).indexOf('Edit0123456789abcdef')===-1);
  q=await fb('GET','/api/fb/list?tool=reimagination-lab');
  check('reading comments needs the team key', q.status===401);
  q=await fb('GET','/api/fb/tools',null,TK);
  check('the tools list counts comments and shows the tester code', q.data.tools.length===1 && q.data.tools[0].tool==='reimagination-lab' && q.data.tools[0].n===1 && q.data.code===CODE);

  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'must',same:'c9z9z9z9z9',notes:[{name:'Rowan',text:'Layout shift when the timer mounts.'}],by:'Rowan'}},TK);
  check('the team sets a weight and a note', q.data.ok===true && q.data.review.priority==='must' && q.data.review.notes[0].text==='Layout shift when the timer mounts.');
  check('"same as" is no longer kept', !('same' in q.data.review));
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'urgent!!'}},TK);
  check('an unknown weight is stored as none', q.data.review.priority==='');
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'ignore'}},TK);
  check('Ignore is a weight of its own', q.data.review.priority==='ignore');
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'wont'}},TK);
  check("an old Won't is kept as Ignore", q.data.review.priority==='ignore');
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'',open:'git:'+'ab'.repeat(20)}},TK);
  check('still open holds the live version it was marked on', q.data.review.open==='git:'+'ab'.repeat(20));
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{open:'git:<b>nope</b>'}},TK);
  check('still open takes only a real version', q.data.review.open==='');
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'must'}});
  check('reviews need the team key', q.status===401);
  q=await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'nothere99',review:{priority:'must'}},TK);
  check('a review needs a real comment', q.status===404);
  await fb('POST','/api/fb/review',{tool:'reimagination-lab',id:'c1a2b3c4d5',review:{priority:'should',notes:[{name:'Rowan',text:'Check on phones too.'}]}},TK);
  q=await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK);
  check('the list carries each review', q.data.reviews.c1a2b3c4d5.priority==='should' && q.data.reviews.c1a2b3c4d5.notes.length===1);

  q=await fb('POST','/api/fb/delete',{tool:'reimagination-lab',code:CODE,id:'c1a2b3c4d5',edit:'Other0123456789abcdef'});
  check('a tester cannot delete someone else\'s comment', q.status===401);
  q=await fb('POST','/api/fb/delete',{tool:'reimagination-lab',code:CODE,id:'c1a2b3c4d5',edit:'Edit0123456789abcdef'});
  q=await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK);
  check('a tester deletes their own comment, and its review goes with it', q.data.comments.length===0 && Object.keys(q.data.reviews).length===0);
  await fb('POST','/api/fb/post',Object.assign({},C1,{id:'teamdel01'}),{'CF-Connecting-IP':'1.1.1.1'});
  q=await fb('POST','/api/fb/delete',{tool:'reimagination-lab',id:'teamdel01'},TK);
  check('the team can delete any comment', q.data.ok===true && (await fb('GET','/api/fb/list?tool=reimagination-lab',null,TK)).data.comments.length===0);

  /* caps: 60 new comments per visitor per hour; edits do not count */
  let last=null;
  for (let i=0;i<61;i++) last=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'rate'+String(i).padStart(4,'0')}),{'CF-Connecting-IP':'9.9.9.9'});
  check('a visitor is slowed down after 60 new comments in an hour', last.status===429);
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'other00001'}),{'CF-Connecting-IP':'8.8.8.8'});
  check('other visitors are not affected', q.data.ok===true);
  check('visitor addresses are stored only as a short hash', [...fenv.DB._rows.keys()].every(k=>k.indexOf('9.9.9.9')===-1 && k.indexOf('8.8.8.8')===-1));
  const big=new Request(base+'/api/fb/post',{method:'POST',headers:{'Content-Type':'application/json','content-length':'40000'},body:JSON.stringify(C1)});
  check('an outsized body is refused before reading', (await worker.fetch(big, fenv)).status===413);

  /* a new tester code retires the old links */
  const OLD=CODE; q=await fb('POST','/api/fb/code',{},TK);
  check('a new tester code replaces the old one', q.data.code!==OLD);
  q=await fb('POST','/api/fb/post',Object.assign({},C1,{id:'oldlink01'}));
  check('old tester links can no longer post', q.status===401);

  /* the origin lock still applies */
  q=await fb('POST','/api/fb/post',C1,{'Origin':'https://evil.example'});
  check('feedback routes keep the origin lock', q.status===403);
  q=await fb('OPTIONS','/api/fb/list',null,{'Origin':'https://ep.github.io'});
  check('the board may send the team key header across origins', /X-Team-Key/.test(q.headers.get('Access-Control-Allow-Headers')));

  /* retention: feedback keeps its own clock */
  const day=24*60*60*1000, rows=fenv.DB._rows;
  rows.set('pyc:OLDS|meta/stage',{value:'"x"',updated:Date.now()-8*day});
  rows.set('fb:reimagination-lab|c/stale0001',{value:JSON.stringify({id:'stale0001',text:'old'}),updated:Date.now()-366*day});
  rows.set('fb:reimagination-lab|r/stale0001',{value:'{}',updated:Date.now()-366*day});
  rows.set('fb:reimagination-lab|c/keep00001',{value:JSON.stringify({id:'keep00001',text:'recent'}),updated:Date.now()-30*day});
  rows.set('fb:_admin|rl/oldvisitor',{value:'{"n":3,"t0":0}',updated:Date.now()-3*day});
  await worker.scheduled({}, fenv, {});
  check('the daily sweep still ends week-old sessions', !rows.has('pyc:OLDS|meta/stage'));
  check('feedback survives the 7-day sweep', rows.has('fb:reimagination-lab|c/keep00001') && rows.has('fb:_admin|code'));
  check('comments and reviews go a year after they last changed', !rows.has('fb:reimagination-lab|c/stale0001') && !rows.has('fb:reimagination-lab|r/stale0001'));
  check('post counters go after two days', !rows.has('fb:_admin|rl/oldvisitor'));
}

console.log(failures===0?'\nWORKER TESTS PASSED':'\n'+failures+' FAILURES');
process.exit(failures===0?0:1);
})();
