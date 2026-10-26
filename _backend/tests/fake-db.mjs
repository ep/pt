/* fake D1: just enough SQL for the pt worker. Shared by every harness. */
export function FakeDB(){
  const rows = new Map(); // key room|path -> {value, updated}
  const reads = { n:0 }; // rows touched, so harnesses can check what a request costs
  return {
    prepare(sql){
      return { bind(...args){
        return {
          async all(){
            const room=args[0], out=[];
            const ranged = sql.includes('path >= ?');        /* the slim read: a range on the primary key, [prefix, prefix0) */
            const pair = !ranged && sql.includes('(path = ? OR path = ?)'); /* the internals read: _sk and _open */
            rows.forEach((v,k)=>{ const [r,p]=k.split('|');
              if(r!==room) return;
              if(ranged && !(p>=args[1] && p<args[2])) return;
              if(pair && p!==args[1] && p!==args[2]) return;
              out.push({path:p, value:v.value, updated:v.updated}); });
            /* rows a real database would touch: an indexed range or key read touches only its matches, a whole-room read touches the room */
            reads.n += out.length;
            return { results: out };
          },
          async first(){
            if (sql.includes('COUNT')){
              let n=0; rows.forEach((v,k)=>{ if (k.split('|')[0]===args[0]) n++; });
              reads.n += n;
              return { c: n };
            }
            reads.n += 1;
            const key=args[0]+'|'+args[1];
            return rows.has(key) ? { value: rows.get(key).value, x: 1 } : null;
          },
          async run(){
            if (sql.includes('HAVING MAX')){
              /* the session sweep; "(room < ? OR room >= ?)" leaves out the rooms in that range (feedback) */
              const skip = sql.includes('(room < ? OR room >= ?)') ? [args[0], args[1]] : null;
              const cutoff = skip ? args[2] : args[0], maxBy={};
              rows.forEach((v,k)=>{ const r=k.split('|')[0]; maxBy[r]=Math.max(maxBy[r]||0, v.updated); });
              let n=0;
              rows.forEach((v,k)=>{ const r=k.split('|')[0]; if (skip && r>=skip[0] && r<skip[1]) return; if (maxBy[r]<cutoff){ rows.delete(k); n++; } });
              return { meta:{ changes:n } };
            }
            if (sql.startsWith('DELETE FROM kv WHERE room >= ?')){
              /* a ranged delete: rooms in [a0,a1), paths in [a2,a3), last written before a4 */
              let n=0;
              rows.forEach((v,k)=>{ const [r,p]=k.split('|'); if (r>=args[0] && r<args[1] && p>=args[2] && p<args[3] && v.updated<args[4]){ rows.delete(k); n++; } });
              return { meta:{ changes:n } };
            }
            if (sql.startsWith('DELETE FROM kv WHERE room = ? AND path = ?')){
              const had = rows.delete(args[0]+'|'+args[1]);
              return { meta:{ changes: had?1:0 } };
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
    _rows: rows,
    _reads: reads
  };
}
