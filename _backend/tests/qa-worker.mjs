import worker from '../pt-worker.js';
let failures = 0;
function check(name, cond){ console.log((cond?'PASS  ':'FAIL  ')+name); if(!cond) failures++; }

/* fake D1: just enough SQL for this worker */
function FakeDB(){
  const rows = new Map(); // key room|path -> {value, updated}
  return {
    prepare(sql){
      return { bind(...args){
        return {
          async all(){
            const room=args[0], out=[];
            rows.forEach((v,k)=>{ const [r,p]=k.split('|'); if(r===room) out.push({path:p, value:v.value}); });
            return { results: out };
          },
          async first(){
            const key=args[0]+'|'+args[1];
            return rows.has(key) ? { value: rows.get(key).value } : null;
          },
          async run(){
            if (sql.includes('HAVING MAX')){
              const cutoff=args[0], maxBy={};
              rows.forEach((v,k)=>{ const r=k.split('|')[0]; maxBy[r]=Math.max(maxBy[r]||0, v.updated); });
              let n=0;
              rows.forEach((v,k)=>{ const r=k.split('|')[0]; if (maxBy[r]<cutoff){ rows.delete(k); n++; } });
              return { meta:{ changes:n } };
            }
            if (sql.startsWith('DELETE')){
              const room=args[0]; let n=0;
              rows.forEach((v,k)=>{ if (k.split('|')[0]===room){ rows.delete(k); n++; } });
              return { meta:{ changes:n } };
            }
            const key=args[0]+'|'+args[1];
            if (sql.includes('DO NOTHING')){
              if (rows.has(key)) return { meta:{ changes:0 } };
              rows.set(key,{value:args[2],updated:args[3]});
              return { meta:{ changes:1 } };
            }
            rows.set(key,{value:args[2],updated:args[3]});
            return { meta:{ changes:1 } };
          }
        };
      }};
    },
    _rows: rows
  };
}

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
check('gating works with no dashboard variable set', r.data.ok===true && r.data.gatedTools.join()==='pyc');
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

console.log(failures===0?'\nWORKER TESTS PASSED':'\n'+failures+' FAILURES');
process.exit(failures===0?0:1);
})();
