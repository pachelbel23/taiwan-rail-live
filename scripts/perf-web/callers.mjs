// 列出 cpuprofile 裡指定函式(預設：原生呼叫)的「最近的應用程式層呼叫端」，用來找每幀的 DOM 讀取／JSON.parse 來源
import fs from 'node:fs';
const [file,...wanted]=process.argv.slice(2);
const p=JSON.parse(fs.readFileSync(file,'utf8'));
const nodes=new Map(p.nodes.map(n=>[n.id,n])),parent=new Map();
for(const n of p.nodes)for(const c of n.children||[])parent.set(c,n.id);
const key=n=>{const f=n.callFrame;const url=f.url?f.url.replace(/^.*\//,'').replace(/\?.*$/,'')||'index':'';return `${f.functionName||'(anon)'}${f.url?' '+url+':'+(f.lineNumber+1):''}`;};
const isApp=n=>n.callFrame.url&&!/maplibre|three\.module/.test(n.callFrame.url);
const want=new Set(wanted.length?wanted:['get clientWidth','get clientHeight','getClientRects','getBoundingClientRect','querySelectorAll','querySelector','getItem','parse','object.<computed>','matchMedia','getPropertyValue','getComputedStyle','now','save','restore','measureText']);
const agg=new Map();let total=0;
for(let i=0;i<p.samples.length;i++){const dt=p.timeDeltas[i]/1000;total+=dt;const n=nodes.get(p.samples[i]);const fn=n.callFrame.functionName;if(!want.has(fn))continue;
  let id=parent.get(n.id),chain=[];while(id!==undefined){const nn=nodes.get(id);if(isApp(nn)){chain.push(key(nn));if(chain.length>=3)break;}id=parent.get(id);}
  const k=fn+'  <-  '+chain.join('  <-  ');agg.set(k,(agg.get(k)||0)+dt);}
for(const [k,v] of [...agg].sort((a,b)=>b[1]-a[1]).slice(0,28))console.log((v/total*100).toFixed(2).padStart(6)+'%  '+k);
