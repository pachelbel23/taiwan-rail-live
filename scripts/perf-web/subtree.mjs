// 指定函式的子樹：把它底下所有取樣的 self time 依函式彙整（找出某個熱點函式裡面的錢花在哪）
import fs from 'node:fs';
const [file,target,limit='18']=process.argv.slice(2);
const p=JSON.parse(fs.readFileSync(file,'utf8'));
const nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map();
for(const n of p.nodes)for(const c of n.children||[])parent.set(c,n.id);
const key=n=>{const f=n.callFrame;const url=f.url?f.url.replace(/^.*\//,'').replace(/\?.*$/,'')||'index':'';return `${f.functionName||'(anon)'}${f.url?' '+url+':'+(f.lineNumber+1):''}`;};
const agg=new Map();let total=0,inside=0;
for(let i=0;i<p.samples.length;i++){const dt=p.timeDeltas[i]/1000;total+=dt;const n=nodes.get(p.samples[i]);
  let id=n.id,hit=false;while(id!==undefined){const nn=nodes.get(id);if(nn.callFrame.functionName===target){hit=true;break;}id=parent.get(id);}
  if(!hit)continue;inside+=dt;const k=key(n);agg.set(k,(agg.get(k)||0)+dt);}
console.log(`${target}: inclusive ${(inside/total*100).toFixed(1)}% of ${total.toFixed(0)}ms`);
for(const [k,v] of [...agg].sort((a,b)=>b[1]-a[1]).slice(0,+limit))console.log('   '+(v/inside*100).toFixed(1).padStart(5)+'%  '+k);
