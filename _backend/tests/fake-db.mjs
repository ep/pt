/* fake D1: just enough SQL for the pt worker. Shared by every harness. */
export function FakeDB(){
  const rows = new Map(); // key room|path -> {value, updated}
  return {
    prepare(sql){
      return { bind(...args){
        return {
          async all(){
            const room=args[0], out=[];
            const prefixed = sql.includes('LIKE');           /* the slim read: path = ? OR path LIKE 'prefix/%' */
            const pair = !prefixed && sql.includes('(path = ? OR path = ?)'); /* the internals read: _sk and _open */
            const exact = prefixed ? args[1] : null, like = prefixed ? args[2].slice(0,-1) : null;
            rows.forEach((v,k)=>{ const [r,p]=k.split('|');
              if(r!==room) return;
              if(prefixed && !(p===exact || p.startsWith(like))) return;
              if(pair && p!==args[1] && p!==args[2]) return;
              out.push({path:p, value:v.value}); });
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
