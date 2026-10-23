// 網站效能基準：無視窗 Chrome（真 GPU）＋CPU 節流，量預設到站體驗與常見操作，附 CPU profile 熱點。
// 用法：BASE_URL=http://127.0.0.1:5248/ CPU_RATE=4 PROFILE=mac node scripts/perf-web/profile.mjs
import {chromium} from 'playwright';
import fs from 'node:fs';
const base=process.env.BASE_URL||'http://127.0.0.1:5248/';
const rate=Number(process.env.CPU_RATE||4), duration=Number(process.env.PERF_MS||6000);
const profileName=process.env.PROFILE||'mac';
const profiles={mac:{viewport:{width:1440,height:900},deviceScaleFactor:2},win:{viewport:{width:1920,height:1080},deviceScaleFactor:1.25}};
const scenarios=(process.env.SCENARIOS||'landing,drag,city,drag-city,follow,3d').split(',');
const out=process.env.OUT||`output/perf-web/${profileName}-x${rate}`;fs.mkdirSync(out,{recursive:true});
const query=process.env.QUERY||'?lang=zh-TW&t=08:00';

function aggregate(profile){
  const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parent=new Map();
  for(const n of profile.nodes)for(const c of n.children||[])parent.set(c,n.id);
  const self=new Map(),incl=new Map(),cat=new Map();let total=0;
  const key=n=>{const f=n.callFrame;const url=f.url?f.url.replace(/^.*\//,'').replace(/\?.*$/,'')||'index':'';return `${f.functionName||'(anon)'} ${url}${f.url?':'+(f.lineNumber+1):''}`;};
  const catOf=n=>{const u=n.callFrame.url,fn=n.callFrame.functionName;if(!u)return fn==='(garbage collector)'?'gc':fn==='(idle)'?'idle':fn==='(program)'?'program':'native:'+fn;
    if(u.includes('maplibre'))return 'maplibre';if(u.includes('three'))return 'three';if(u.includes('rail-3d/'))return 'rail-3d';if(!/\.m?js(\?|$)/.test(u))return 'index.html';return u.replace(/^.*\//,'').replace(/\?.*$/,'');};
  for(let i=0;i<profile.samples.length;i++){const dt=profile.timeDeltas[i]/1000;total+=dt;const n=nodes.get(profile.samples[i]);const k=key(n);self.set(k,(self.get(k)||0)+dt);const c=catOf(n);cat.set(c,(cat.get(c)||0)+dt);
    const seen=new Set();let id=n.id;while(id!==undefined){const nn=nodes.get(id);const kk=key(nn);if(!seen.has(kk)){seen.add(kk);incl.set(kk,(incl.get(kk)||0)+dt);}id=parent.get(id);}}
  const top=(m,n)=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,n).map(([k,v])=>({fn:k,ms:+v.toFixed(1),pct:+(v/total*100).toFixed(1)}));
  return {totalMs:+total.toFixed(0),categories:top(cat,14),self:top(self,30),inclusive:top(incl,45)};
}

const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({...profiles[profileName],locale:'zh-TW',timezoneId:'Asia/Taipei'});
await context.addInitScript(()=>{localStorage.setItem('trainmap-howto-seen','1');});
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e.stack||e).slice(0,300)));
const cdp=await context.newCDPSession(page);
await cdp.send('Network.enable');let encodedBytes=0,requests=0;const byExt={};
cdp.on('Network.loadingFinished',e=>{encodedBytes+=e.encodedDataLength;requests++;});
cdp.on('Network.responseReceived',e=>{const u=new URL(e.response.url);const ext=(u.pathname.match(/\.[a-z0-9]+$/)||['(none)'])[0];const host=u.host;const k=host.includes('127.0.0.1')?ext:host;byExt[k]=(byExt[k]||0)+1;});
await cdp.send('Emulation.setCPUThrottlingRate',{rate});
const netMbps=Number(process.env.NET_MBPS||0);if(netMbps)await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:40,downloadThroughput:netMbps*125000,uploadThroughput:5*125000});
const t0=Date.now();
await page.goto(base+query);
await page.waitForFunction(()=>typeof state!=='undefined'&&state.ready,null,{timeout:180000});const readyMs=Date.now()-t0;
await page.waitForFunction(()=>state.trains.length>0,null,{timeout:180000});const trainsMs=Date.now()-t0;
await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:60000}).catch(()=>{});const tilesMs=Date.now()-t0;
await page.waitForTimeout(2000);
const boot=await page.evaluate(()=>{const res=performance.getEntriesByType('resource');const nav=performance.getEntriesByType('navigation')[0];
  const gl=M.raw.painter.context.gl,ext=gl.getExtension('WEBGL_debug_renderer_info');
  return {build:typeof BUILD!=='undefined'?BUILD:null,group:state.group,mode:state.mode,zoom:+M.getZoom().toFixed(2),center:M.getCenter(),trains:state.trains.length,lines:state.lines?.length,
    dpr:state.dpr,overlayCanvas:(()=>{const o=document.getElementById('overlay');return o?[o.width,o.height]:null;})(),glCanvas:[gl.drawingBufferWidth,gl.drawingBufferHeight],powerSave:state.powerSave,map3d:state.map3d,basemap:state.basemap,
    gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,resources:res.length,
    transferMB:+(res.reduce((s,r)=>s+(r.transferSize||0),0)/1048576).toFixed(2),decodedMB:+(res.reduce((s,r)=>s+(r.decodedBodySize||0),0)/1048576).toFixed(2),
    biggest:res.map(r=>({name:r.name.replace(/^.*\/\/[^/]+/,''),kb:+( (r.decodedBodySize||0)/1024).toFixed(0),ms:+(r.duration).toFixed(0)})).sort((a,b)=>b.kb-a.kb).slice(0,12),
    nav:nav?{responseEnd:+nav.responseEnd.toFixed(0),domContentLoaded:+nav.domContentLoadedEventEnd.toFixed(0),load:+nav.loadEventEnd.toFixed(0)}:null};});
boot.readyMs=readyMs;boot.trainsMs=trainsMs;boot.tilesMs=tilesMs;boot.encodedMB=+(encodedBytes/1048576).toFixed(2);boot.requests=requests;boot.byExt=byExt;
console.log('BOOT',JSON.stringify(boot));
await page.screenshot({path:`${out}/boot.png`});
await page.evaluate(()=>{window.__pw={};
  const wrap=(object,key,label)=>{const fn=object&&object[key];if(typeof fn!=='function')return;object[key]={['wrap_'+label]:function(...args){const start=performance.now();try{return fn.apply(this,args);}finally{const row=__pw[label]||(__pw[label]={calls:0,ms:0,maxMs:0});const ms=performance.now()-start;row.calls++;row.ms+=ms;row.maxMs=Math.max(row.maxMs,ms);}}}['wrap_'+label];};
  wrap(window,'tickCore','tickCore');wrap(window,'draw','overlay-draw');wrap(window,'reproject','reproject');wrap(M.raw.painter,'render','maplibre-paint');
  wrap(window,'drawSched','drawSched');wrap(window,'drawFreq','drawFreq');wrap(window,'drawDecoBase','drawDecoBase');wrap(window,'updateBlockHolds','updateBlockHolds');wrap(window,'drawFlow','drawFlow');wrap(window,'syncTimeUI','syncTimeUI');
  window.__pwWrap=wrap;});
const results=[];
for(const scenario of scenarios){
  const ok=await page.evaluate(async scenario=>{
    try{
      setSimSec(Number(window.__PERF_SIM||28800));if(!state.playing)togglePlay();
      if(scenario==='city'||scenario==='drag-city'){clearFollow();clearFreqFollow();M.raw.jumpTo({center:[121.517,25.0478],zoom:13,pitch:0,bearing:0});}
      else if(scenario==='follow'){clearFreqFollow();const tr=state.trains.find(tr=>tr.sys==='tra_sched'&&trainPos(tr,state.simSec));if(!tr)return 'no-train';setFollow(tr,false,true);if(typeof setFollowLock==='function')setFollowLock(true);}
      else if(scenario==='3d'){clearFollow();clearFreqFollow();M.raw.jumpTo({center:[121.517,25.0478],zoom:16,pitch:60,bearing:0});if(!state.map3d)setMap3d(true);}
      return 'ok';
    }catch(e){return 'setup-error '+e.message;}
  },scenario);
  if(ok!=='ok'){results.push({scenario,skipped:ok});console.log('SKIP',scenario,ok);continue;}
  if(scenario==='3d'){await page.waitForFunction(()=>window.railIslandIntegration&&!railIslandIntegration.loading&&railIslandIntegration.renderer,null,{timeout:90000}).catch(()=>{});
    await page.waitForFunction(()=>M.raw.areTilesLoaded(),null,{timeout:60000}).catch(()=>{});
    await page.waitForFunction(()=>railIslandIntegration?.renderer?.stats?.models>0,null,{timeout:30000}).catch(()=>console.log('WARN 3d models still 0'));
    await page.evaluate(()=>{const r=window.railIslandIntegration;if(r){__pwWrap(r,'render','3d-integration');if(r.renderer)__pwWrap(r.renderer,'update','3d-vehicles');}});}
  await page.waitForTimeout(1800);
  await cdp.send('Profiler.enable');await cdp.send('Profiler.setSamplingInterval',{interval:500});await cdp.send('Profiler.start');
  const measure=page.evaluate(async d=>{
    for(const k in __pw)__pw[k]={calls:0,ms:0,maxMs:0};
    const times=[],start=performance.now();let last=start;const d0=state._drawCount||0;let longTasks=0,longMs=0;
    let po;try{po=new PerformanceObserver(l=>{for(const e of l.getEntries()){longTasks++;longMs+=e.duration;}});po.observe({type:'longtask'});}catch(e){}
    await new Promise(r=>{const step=t=>{times.push(t-last);last=t;if(t-start<d)requestAnimationFrame(step);else r();};requestAnimationFrame(step);});
    po?.disconnect();const el=performance.now()-start,s=[...times].sort((a,b)=>a-b),q=p=>+s[Math.min(s.length-1,Math.floor(s.length*p))].toFixed(1);
    const r3=window.railIslandIntegration?.renderer?.stats;
    return {elapsedMs:+el.toFixed(0),rafFps:+(times.length*1000/el).toFixed(1),drawsPerSec:+(((state._drawCount||0)-d0)*1000/el).toFixed(1),p50:q(.5),p95:q(.95),p99:q(.99),max:+s[s.length-1].toFixed(1),over50:times.filter(t=>t>50).length,longTasks,longMs:+longMs.toFixed(0),
      work:Object.fromEntries(Object.entries(__pw).map(([k,v])=>[k,{calls:v.calls,ms:+v.ms.toFixed(0),avg:+(v.ms/Math.max(1,v.calls)).toFixed(2),max:+v.maxMs.toFixed(1)}])),
      heapMB:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):null,zoom:+M.getZoom().toFixed(2),pitch:M.raw.getPitch(),trainHits:state._trainHits?.length,freqHits:state._freqHits?.length,labels:typeof labelBoxes!=='undefined'?labelBoxes.length:null,
      map3d:state.map3d,models:r3?.models,tickErrors:state._tickErrs||[]};
  },duration);
  if(scenario==='drag'||scenario==='drag-city'){const vp=profiles[profileName].viewport,cx=vp.width/2,cy=vp.height/2;const until=Date.now()+duration;let n=0;
    while(Date.now()<until){const right=n++%2===0;await page.mouse.move(right?cx-200:cx+200,cy);await page.mouse.down();await page.mouse.move(right?cx+200:cx-200,cy,{steps:30});await page.mouse.up();}}
  const row={scenario,profile:profileName,cpuRate:rate,...await measure};
  const {profile}=await cdp.send('Profiler.stop');await cdp.send('Profiler.disable');
  row.cpu=aggregate(profile);fs.writeFileSync(`${out}/${scenario}.cpuprofile`,JSON.stringify(profile));
  await page.screenshot({path:`${out}/${scenario}.png`});
  results.push(row);
  console.log('ROW',JSON.stringify({...row,cpu:{totalMs:row.cpu.totalMs,categories:row.cpu.categories,self:row.cpu.self.slice(0,12)}}));
}
fs.writeFileSync(`${out}/results.json`,JSON.stringify({base,profile:profileName,rate,duration,boot,results,errors},null,2));
console.log('ERRORS',errors.length,errors.slice(0,3));
await browser.close();
