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
check('gating works with no dashboard variable set', r.data.ok===true && r.data.gatedTools.join()==='pyc,pair-poll');
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

console.log(failures===0?'\nWORKER TESTS PASSED':'\n'+failures+' FAILURES');
process.exit(failures===0?0:1);
})();
