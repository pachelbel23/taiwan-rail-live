import {chromium,webkit} from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';
// 日期、資料夾與輸出位置參數化（不給參數＝9/12 封存版，行為與改版前相同）：
//   --date=2026-10-16 --dir=memories/tainan-2026-10-16 --out=output/tainan-memory-1016，或環境變數 MEMORY_DATE／MEMORY_DIR／MEMORY_OUT。
//   dir 預設 memories/tainan-<date>；out 預設 9/12 → output/tainan-memory、其他日期 → output/tainan-memory-MMDD。
//   CHROMIUM_CHANNEL 換 Chromium 的 channel（預設 chromium）。--date=2026-10-16 時另跑 10/16 版專屬檢查（lastDayChecks）。
const opt=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3)||process.env[`MEMORY_${name.toUpperCase()}`]||'';
const DATE=opt('date')||'2026-09-12',DIR=(opt('dir')||`memories/tainan-${DATE}`).replace(/^\/+|\/+$/g,''),OUTDIR=opt('out')||(DATE==='2026-09-12'?'output/tainan-memory':`output/tainan-memory-${DATE.slice(5).replace('-','')}`);
const lastDay=DATE==='2026-10-16';
const base=process.env.VURL||'http://127.0.0.1:5244',out=OUTDIR;fs.mkdirSync(out,{recursive:true});
const results=[];
// 正式站會由 Cloudflare 注入 Web Analytics；它不提供重播資料。
// 只辨識正式網域上的兩個基礎設施端點，其他外部請求與 /api/* 仍不得出現。
function isProductionTelemetry(url){
 if(base!=='https://railisland.tw'&&base!=='https://www.railisland.tw')return false;
 const u=new URL(url);
 return (u.origin==='https://static.cloudflareinsights.com'&&/^\/beacon\.min\.js(?:\/[^/]+)?$/.test(u.pathname))||(u.origin===base&&u.pathname==='/cdn-cgi/rum');
}
async function controls(page,scope='body',skip=''){
 return page.evaluate(([scope,skip])=>{
  const all=[...document.querySelector(scope).querySelectorAll('button,a,input,select')].filter(e=>e.getClientRects().length&&!e.closest('dialog:not([open])')&&!(skip&&e.closest(skip)));
  const boxes=all.map(e=>({id:e.id||e.textContent.trim().slice(0,30),e,r:e.getBoundingClientRect()})).filter(v=>v.r.width&&v.r.height);
  const errors=[];
  for(const b of boxes){if(b.r.left<-.1||b.r.right>innerWidth+.1||b.r.top<-.1||b.r.bottom>innerHeight+.1)errors.push('溢出:'+b.id);const hit=document.elementFromPoint(b.r.x+b.r.width/2,b.r.y+b.r.height/2);if(hit!==b.e&&!b.e.contains(hit))errors.push('無法觸及:'+b.id);if(b.r.width<24||b.r.height<24)errors.push('觸控目標過小:'+b.id);}
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];if(a.e.contains(b.e)||b.e.contains(a.e))continue;if(Math.min(a.r.right,b.r.right)-Math.max(a.r.left,b.r.left)>1&&Math.min(a.r.bottom,b.r.bottom)-Math.max(a.r.top,b.r.top)>1)errors.push('相交:'+a.id+'/'+b.id);}
  if(document.documentElement.scrollWidth>innerWidth)errors.push('水平捲動');return {count:boxes.length,errors};
 },[scope,skip]);
}
// ── 10/16 版專屬檢查（--date=2026-10-16 才跑）──────────────────────────────────────────────
// 預期值一律從 tainanMemory.data（snapshot）與下面的常數算，不呼叫頁面自己的格式化函式；失敗訊息開頭是「引擎 寬×高」與檢查名稱。
const KIND_ZH={official:'官方',observed:'實測',inferred:'推定'},SRC_ZH={obs:'實測',interp:'內插',sched:'表定'},WORDS={'track-overlap':'股道安排待確認','single-line-unresolved':'封鎖初期股道安排不明'};
const pad2=n=>String(n).padStart(2,'0');
const hhmm=sec=>{const s=((Math.floor(sec)%86400)+86400)%86400;return pad2(Math.floor(s/3600))+':'+pad2(Math.floor(s%3600/60));};
const evTime=t=>(t>=86400?'次日 ':'')+hhmm(t);
const hms=sec=>{if(!Number.isFinite(sec))return '—';const r=Math.round(sec),d=Math.floor(r/86400),s=r-d*86400;return (d<0?'前日 ':d>0?'次日 ':'')+pad2(Math.floor(s/3600))+':'+pad2(Math.floor(s%3600/60))+':'+pad2(s%60);};
const dur=sec=>{const s=Math.round(Math.abs(sec)),m=Math.floor(s/60),r=s%60;return (m?m+'分':'')+(r||!m?r+'秒':'');};
const diff=d=>!Number.isFinite(d)?'—':Math.abs(d)<5?'準點':(d>0?'晚':'早')+dur(d);
const isTainan=s=>s.name.replace('台','臺')==='臺南',anchorOf=t=>(t.stops.find(isTainan)||t.stops[0]).arrSec;
const cssRgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);
const toHsl=([r,g,b])=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn,l=(mx+mn)/2;let h=0;if(d){h=mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4;h=(h*60+360)%360;}return {h,s:d?d/(1-Math.abs(2*l-1)):0,l};};
// 兩張 PNG 在頁面裡解碼後逐像素比：回傳差異像素數與「有光暈那張」差異處的平均顏色（不經網路，不產生請求）。
const pixelDiff=(page,a,b)=>page.evaluate(async([a,b])=>{
 const load=async s=>{const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);const bmp=await createImageBitmap(new Blob([u],{type:'image/png'})),c=document.createElement('canvas');c.width=bmp.width;c.height=bmp.height;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(bmp,0,0);return g.getImageData(0,0,bmp.width,bmp.height).data;};
 const A=await load(a),B=await load(b);let n=0,r=0,g=0,bl=0;
 for(let i=0;i<A.length;i+=4){const d=Math.abs(A[i]-B[i])+Math.abs(A[i+1]-B[i+1])+Math.abs(A[i+2]-B[i+2]);if(d>60){n++;r+=A[i];g+=A[i+1];bl+=A[i+2];}}
 return {n,total:A.length/4,avg:n?[r/n,g/n,bl/n].map(Math.round):null};
},[a.toString('base64'),b.toString('base64')]);
// 開場：預設時刻讀 snapshot.defaultSec（22:00）、標題與日期、說明文字要點。
async function lastDayOpening(page,{engine,width,height}){
 const where=`${engine} ${width}×${height}`;
 const r=await page.evaluate(()=>{const d=tainanMemory.data;return {sec:tainanMemory.state.sec,def:d.defaultSec,title:document.title,h1:document.querySelector('h1').textContent,date:document.querySelector('.date').textContent,clock:document.getElementById('clock').textContent,tl:Number(document.getElementById('timeline').value),about:document.querySelector('#details .detail-body').textContent,sched:[...new Set(d.trains.filter(t=>t.timing==='scheduled').map(t=>t.train))].sort(),from:d.singleLine?.fromSec,night:!document.getElementById('night').hidden};});
 const fail=m=>{throw Error(`[10/16 ${where}] 開場：${m}`);};
 if(r.def!==79200)fail('snapshot.defaultSec 不是 22:00（79200）：'+r.def);
 if(!(r.sec>=r.def&&r.sec<r.def+120))fail(`開場時刻 ${r.sec} 不是 defaultSec ${r.def}（容許 120 秒的自動播放）`);
 if(!r.clock.startsWith('22:0')||r.tl<r.def||r.tl>=r.def+120)fail(`時鐘或時間軸沒有落在 22:00 起：${r.clock} / ${r.tl}`);
 if(!r.title.includes('臺南地面鐵道最後一天・2026 年 10 月 16 日'))fail('標題不對：'+r.title);
 if(r.h1!=='臺南地面鐵道最後一天'||r.date!=='2026 年 10 月 16 日')fail(`h1／日期不對：${r.h1} / ${r.date}`);
 if(!r.night)fail('資料有事件，時間軸面板卻是隱藏的');
 if(r.sched.length===0)fail('snapshot 沒有任何 timing==="scheduled" 的班次（6631～6633 應整班照表定）');
 const need=['臺鐵即時動態','不是 GPS 軌跡','誤差約半分鐘','大橋與仁德兩站不回報','內插',r.sched.join('、')+' 次沒有任何即時動態紀錄','照時刻表畫','「無即時動態紀錄」','股道位置是推演','單線雙向',hhmm(r.from),'封鎖初期股道安排不明','股道安排待確認','區間車（8 節）與莒光號（9 節）是推估編組','沿用 9 月 12 日的封存版本','隔天清晨 6 點','地下化'];
 const miss=need.filter(k=>!r.about.includes(k));if(miss.length)fail('說明文字缺這些要點：'+JSON.stringify(miss));
 return {defaultSec:r.def,scheduledTrains:r.sched};
}
async function lastDayChecks(page,{engine,width,height,click,out}){
 const where=`${engine} ${width}×${height}`,done=[],side=width>=900||(width>=700&&height<=520);
 const step=async(name,fn)=>{try{await fn();done.push(name);}catch(e){e.message=`[10/16 ${where}] ${name}：${e.message}`;console.log('FAIL '+String(e.message).split('\n')[0]);throw e;}};   // 改過的 message 不會出現在 Node 印出的 stack 裡，所以另外印一行，失敗時才看得到是哪一步、哪個視窗
 const frames=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 const isOpen=async()=>(await page.locator('#nightToggle').getAttribute('aria-expanded'))==='true';
 const setPanel=async open=>{if(await isOpen()!==open)await click('#nightToggle');assert.equal(await isOpen(),open,'面板沒有'+(open?'展開':'收合'));};
 const shot=name=>page.screenshot({path:`${out}/lastday-${engine}-${width}-${name}.png`});
 const D=await page.evaluate(()=>{const m=tainanMemory,d=m.data;return {events:d.events||[],single:d.singleLine||null,marks:m.marks,
  intervals:m.uncertainty.intervals.map(i=>({start:i.start,end:i.end,trains:i.trains,trainNos:i.trainNos,reason:i.reason||''})),
  trains:d.trains.map(t=>({id:t.id,train:t.train,direction:t.direction,typeName:t.typeName,mark:t.mark||'',timing:t.timing||'',stops:t.stops.map(s=>({name:s.name,stop:s.stop,arrSec:s.arrSec,depSec:s.depSec,schedArrSec:s.schedArrSec,schedDepSec:s.schedDepSec,src:s.src,holdSec:s.holdSec}))}))};});
 const gm=D.trains.find(t=>t.mark==='last-ground'),sm=D.trains.find(t=>t.mark==='last-south');
 const evs=[...D.events].sort((a,b)=>a.t-b.t);
 const rowChecks=async()=>{const n=await page.locator('#events .evb').count();assert.ok(n>0,'沒有任何可點的事件列');
  for(let i=0;i<n;i++){const b=page.locator('#events .evb').nth(i);await b.scrollIntoViewIfNeeded();
   const m=await b.evaluate(e=>{const r=e.getBoundingClientRect(),body=document.getElementById('nightBody').getBoundingClientRect(),h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {h:Math.round(r.height),inBody:r.top>=body.top-.5&&r.bottom<=body.bottom+.5&&r.left>=body.left-.5&&r.right<=body.right+.5,inView:r.left>=-.1&&r.right<=innerWidth+.1&&r.top>=-.1&&r.bottom<=innerHeight+.1,hit:e===h||e.contains(h)};});
   assert.ok(m.h>=40&&m.inBody&&m.inView&&m.hit,`事件列 ${i} 摸不到或太小：${JSON.stringify(m)}`);}return n;};

 await step('資料契約：兩班重點車（3782 地面最後一班、145 最後南下）、每班都有 timing、事件與單線欄位齊全',async()=>{
  assert.ok(gm&&sm,'snapshot 缺 mark');assert.equal(gm.train,'3782');assert.equal(sm.train,'145');
  assert.deepEqual(D.trains.filter(t=>!['observed','scheduled'].includes(t.timing)).map(t=>t.train),[],'有班次沒有 timing');
  assert.ok(evs.length>=2&&evs.every(e=>e.id&&Number.isFinite(e.t)&&e.text&&KIND_ZH[e.kind]),'events 欄位不齊');
  assert.ok(evs.some(e=>e.t>=86400),'缺次日 06:00 通車那一列');assert.ok(D.single&&Number.isFinite(D.single.fromSec)&&Number.isFinite(D.single.toSec)&&D.single.note,'缺 singleLine');
 });

 await step('最後一夜面板：寬版預設展開、窄版預設收合；展開與收合都不擋控件、不溢出；每一列都摸得到',async()=>{
  const st=()=>page.evaluate(()=>{const t=document.getElementById('nightToggle'),b=document.getElementById('nightBody'),n=document.getElementById('night');return {exp:t.getAttribute('aria-expanded'),body:getComputedStyle(b).display,hidden:n.hidden,bh:b.getBoundingClientRect().height};});
  const s0=await st();assert.equal(s0.hidden,false,'面板被藏起來');assert.equal(s0.exp,String(side),'預設展開狀態不對（寬版應展開、窄版應收合）');assert.equal(s0.body==='none',!side,'內容顯示狀態跟 aria-expanded 不一致');
  for(const open of side?[true,false]:[false,true]){await setPanel(open);const s=await st();assert.equal(s.exp,String(open));assert.equal(s.body==='none',!open);if(open)assert.ok(s.bh>40,'展開後內容高度只有 '+s.bh);
   const l=await controls(page,'body','#events');assert.deepEqual(l.errors,[],`面板${open?'展開':'收合'}：`+JSON.stringify(l.errors));if(open)await rowChecks();await shot(open?'panel-open':'panel-closed');}
  await setPanel(side);
 });

 await step('時間軸：列的內容、種類標籤；每一列跳到對的時刻、有 train 的同時跟車；過去／現在／未來標記；次日列不可點',async()=>{
  const rows=await page.evaluate(()=>[...document.querySelectorAll('#events > li.ev')].map(li=>({id:li.dataset.id,tag:li.firstElementChild.tagName,time:li.querySelector('time').textContent,text:li.querySelector('.tx').textContent,kd:li.querySelector('.kd').textContent})));
  assert.equal(rows.length,evs.length,'列數與 snapshot.events 不同');
  evs.forEach((e,i)=>{const r=rows[i];assert.deepEqual(r,{id:e.id,tag:e.t<86400?'BUTTON':'DIV',time:evTime(e.t),text:e.text,kd:KIND_ZH[e.kind]},'第 '+i+' 列內容');});
  for(let i=0;i<evs.length;i++){const e=evs[i];if(e.t>=86400)continue;
   await page.evaluate(()=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');});await frames();
   if(!side)await setPanel(true);
   const sel=`#events > li.ev:nth-child(${i+1}) .evb`;await page.locator(sel).scrollIntoViewIfNeeded();await click(sel);await frames();
   const g=await page.evaluate(()=>({sec:tainanMemory.state.sec,follow:tainanMemory.state.follow,sel:document.getElementById('train').value,clock:document.getElementById('clock').textContent,open:document.getElementById('nightToggle').getAttribute('aria-expanded'),cardHidden:document.getElementById('followcard').hidden,cardTitle:document.querySelector('#followcard h3')?.firstElementChild?.textContent||'',
    rows:[...document.querySelectorAll('#events > li.ev')].map(li=>({st:li.dataset.state,mk:li.querySelector('.mk').textContent,cur:li.firstElementChild.getAttribute('aria-current')}))}));
   assert.ok(Math.abs(g.sec-e.t)<1,`第 ${i} 列（${e.id}）跳到 ${g.sec}，應為 ${e.t}`);assert.equal(g.clock,hms(e.t),'時鐘顯示');
   if(e.train!=null&&e.train!==''){const tr=D.trains.find(t=>t.id===g.follow);assert.ok(tr&&tr.train===String(e.train),`第 ${i} 列（${e.id}）應跟 ${e.train} 次，實際跟 ${tr?.train}`);assert.equal(g.sel,g.follow,'下拉選單沒跟著選');assert.equal(g.cardHidden,false,'跟車卡沒出現');assert.equal(g.cardTitle,e.train+' 次');}
   else{assert.equal(g.follow,'','沒有 train 的列不該開始跟車');}
   assert.equal(g.open,String(side),side?'寬版點了事件不該收合面板':'窄版點了事件要收合面板，讓人看到場景');
   const cur=evs.reduce((c,x,j)=>x.t<=e.t?j:c,-1);
   g.rows.forEach((x,j)=>{const want=j<cur?'past':j===cur?'current':'future';assert.deepEqual(x,{st:want,mk:{past:'✓',current:'●',future:'○'}[want],cur:j===cur?'true':null},`點第 ${i} 列後，第 ${j} 列的標記`);});}
  // 次日列：不是按鈕、永遠在未來
  const nd=await page.evaluate(()=>[...document.querySelectorAll('#events > li.ev')].filter(li=>Number(li.dataset.t)>=86400).map(li=>({tag:li.firstElementChild.tagName,st:li.dataset.state,btn:!!li.querySelector('button')})));
  assert.ok(nd.length>0&&nd.every(x=>x.tag==='DIV'&&!x.btn&&x.st==='future'),'次日列不對：'+JSON.stringify(nd));
  await page.evaluate(()=>{tainanMemory.followTrain('');});await setPanel(side);
 });

 await step('車次下拉選單：最上方固定兩班重點車、其餘照到臺南時間排且不重複、選了就跟',async()=>{
  const opts=await page.evaluate(()=>[...document.getElementById('train').options].map(o=>({v:o.value,t:o.textContent})));
  assert.deepEqual(opts[0],{v:'',t:'自由觀看'});
  assert.equal(opts[1].v,gm.id);assert.ok(opts[1].t.startsWith('★ 地面最後一班 · ')&&opts[1].t.includes(' · 3782 '),opts[1].t);
  assert.equal(opts[2].v,sm.id);assert.ok(opts[2].t.startsWith('★ 最後南下・告別列車 · ')&&opts[2].t.includes(' · 145 '),opts[2].t);
  const rest=[...D.trains].filter(t=>t.stops.length&&t.id!==gm.id&&t.id!==sm.id).sort((a,b)=>anchorOf(a)-anchorOf(b));
  assert.deepEqual(opts.slice(3).map(o=>o.v),rest.map(t=>t.id),'其餘選項沒有照到臺南時間排，或有重複／遺漏');
  rest.forEach((t,i)=>{const o=opts[3+i];assert.ok(!o.t.startsWith('★')&&o.t.endsWith(' · 表定')===(t.timing==='scheduled')&&o.t.includes(' · '+t.train+' '),'選項文字 '+o.t);});
  for(const t of [gm,sm]){await page.locator('#train').selectOption(t.id);await frames();assert.equal(await page.evaluate(()=>tainanMemory.state.follow),t.id);}
  await page.locator('#train').selectOption('');await frames();assert.equal(await page.evaluate(()=>tainanMemory.state.follow),'');
 });

 await step('標籤來源旗標：每班車帶 實測／內插／表定；整班沒有即時紀錄的標「無即時動態紀錄」；重點車標籤文字',async()=>{
  const got=await page.evaluate(()=>Object.fromEntries(tainanMemory.data.trains.map(t=>{const e=tainanMemory.models.get(t.id).label.e;return [t.id,{lt:e.querySelector('.lt').textContent,flag:e.querySelector('.flag')?.textContent||'',src:e.dataset.src||'',mark:e.dataset.mark||''}];})));
  const counts={obs:0,interp:0,sched:0};
  for(const t of D.trains){const g=got[t.id],k=t.timing==='scheduled'?'sched':(t.stops.find(isTainan)?.src||'obs');counts[k]++;
   assert.deepEqual(g,{lt:t.mark==='last-ground'?'地面最後一班 '+t.train:t.mark==='last-south'?'最後南下・告別列車 '+t.train:t.train+' '+t.direction,flag:t.timing==='scheduled'?'無即時動態紀錄':SRC_ZH[k],src:k,mark:t.mark},'班次 '+t.train);}
  assert.ok(counts.sched>0&&counts.obs>0,'旗標種類不足，這項檢查是空轉：'+JSON.stringify(counts));
 });

 // 兩班重點車的標籤與光暈：標籤文字／配色／可見度、光暈物件數＝車廂數，並用「關掉光暈前後的畫面差」證明光暈真的畫在畫面上、顏色對。
 const markCheck=async(tr,{text,sec,hueOk,colorOk,name,file})=>{
  if(!side)await setPanel(false);
  await page.evaluate(([id,sec])=>{tainanMemory.state.playing=false;tainanMemory.followTrain(id,sec);},[tr.id,sec]);await frames();
  const L=await page.evaluate(id=>{const m=tainanMemory,model=m.models.get(id),e=model.label.e,cs=getComputedStyle(e),r=e.getBoundingClientRect(),s=document.getElementById('scene').getBoundingClientRect(),prev=e.style.pointerEvents;e.style.pointerEvents='auto';const h=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);e.style.pointerEvents=prev;
   return {hidden:e.hidden,display:cs.display,vis:cs.visibility,op:cs.opacity,lt:e.querySelector('.lt').textContent,mark:e.dataset.mark,bg:cs.backgroundColor,bd:cs.borderTopColor,w:r.width,h:r.height,inScene:r.left>=s.left-1&&r.right<=s.right+1&&r.top>=s.top-1&&r.bottom<=s.bottom+1,onTop:e===h||e.contains(h),groupVisible:model.group.visible,cars:model.cars.length,glow:model.glow?model.glow.list.length:-1};},tr.id);
  assert.ok(!L.hidden&&L.display!=='none'&&L.vis==='visible'&&Number(L.op)>.9&&L.w>40&&L.h>10&&L.inScene&&L.onTop&&L.groupVisible,name+' 標籤不可見：'+JSON.stringify(L));
  assert.equal(L.lt,text);assert.equal(L.mark,tr.mark);assert.ok(hueOk(L),name+' 標籤配色不對：'+JSON.stringify({bg:L.bg,bd:L.bd}));assert.equal(L.glow,L.cars,name+' 光暈數量應等於車廂數');
  // 光暈外圈只有約 3 個像素寬：小畫面（橫向手機）裡一列 3 節車只有 20 像素長，量不出差別。量測前把畫面放大到車身 ≥150 像素長（上限＝放大極限 34 m），
  // 用頁面上真正的「＋」鈕放大；標籤可見度與全頁截圖仍是放大前、使用者跟車當下看到的畫面。
  await shot(file);
  const measure=()=>page.evaluate(id=>{const m=tainanMemory,model=m.models.get(id),c=m.camera,r=m.renderer.domElement.getBoundingClientRect();let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;for(const car of model.cars){const v=c.position.clone().set(car.position.x,car.position.y,car.position.z+2).project(c),x=r.left+(v.x+1)/2*r.width,y=r.top+(1-v.y)/2*r.height;x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
   const L=Math.hypot(x1-x0,y1-y0),pad=40;x0=Math.max(r.left,x0-pad);y0=Math.max(r.top,y0-pad);x1=Math.min(r.right,x1+pad);y1=Math.min(r.bottom,y1+pad);return {x:x0,y:y0,width:x1-x0,height:y1-y0,L,span:c.top-c.bottom};},tr.id);
  await page.waitForFunction(()=>tainanMemory.state.nearReady,null,{timeout:60000});   // 近景車身模型載入完才量：載入前後車身幾何不同，會被誤當成光暈的差異
  let clip=await measure();for(let i=0;i<8&&clip.L<150&&clip.span>34.5;i++){await click('#zoomin');await frames();clip=await measure();}await frames();
  assert.ok(clip.width>30&&clip.height>30,name+' 車身不在畫面裡：'+JSON.stringify(clip));
  const box={x:clip.x,y:clip.y,width:clip.width,height:clip.height};
  // 小畫面裡量測框會蓋到視角按鈕（剛按過的「＋」還在淡出 hover 底色）與標籤：量光暈時把場景上的 HTML 疊層藏起來，只比 WebGL 畫布。
  const overlays=on=>page.evaluate(on=>{for(const e of document.querySelectorAll('#labels,.view-controls,#singleline,.scene-note'))e.style.visibility=on?'':'hidden';},on);
  await overlays(false);await frames();await page.waitForTimeout(700);   // 剛按過「＋」：手機模擬的點按反白要等它退掉
  const withGlow=await page.screenshot({clip:box}),again=await page.screenshot({clip:box});
  const noise=await pixelDiff(page,withGlow,again);assert.equal(noise.n,0,name+' 同一個畫面連拍兩張就不一樣（'+noise.n+' 像素），量測不可信');   // 對照組：沒動任何東西，差異必須是 0
  const setGlow=on=>page.evaluate(([id,on])=>{for(const c of tainanMemory.models.get(id).glow.list){c.shell.visible=on;c.floor.visible=on;}},[tr.id,on]);
  await setGlow(false);await frames();const without=await page.screenshot({clip:box});await setGlow(true);await frames();
  const back=await page.screenshot({clip:box});await overlays(true);await frames();
  const restore=await pixelDiff(page,withGlow,back);assert.equal(restore.n,0,name+' 光暈關了又開，畫面沒有回到原樣（'+restore.n+' 像素），差異不能全算在光暈上');   // 對照組：開→關→開要回到一模一樣的畫面
  fs.writeFileSync(`${out}/lastday-${engine}-${width}-${file}-glow-on.png`,withGlow);fs.writeFileSync(`${out}/lastday-${engine}-${width}-${file}-glow-off.png`,without);
  const d=await pixelDiff(page,withGlow,without);
  // 外圈約 3 個像素寬、沿車身兩側：差異像素數至少要有「車身在畫面上的長度（像素）」的 2 倍（實測約 6～9 倍）；沒有光暈時關前後的差異是 0。
  const need=Math.max(20,Math.round(2*clip.L));
  assert.ok(d.n>=need&&d.avg&&colorOk(d.avg),`${name} 光暈在畫面上的差異不足（要 ≥${need}）或顏色不對：${JSON.stringify({...d,trainLengthPx:Math.round(clip.L)})}`);
  return {labelBg:L.bg,labelBd:L.bd,glowPixels:d.n,glowAvgRgb:d.avg,trainLengthPx:Math.round(clip.L),cameraSpanM:Math.round(clip.span)};
 };
 const marks={};
 await step('地面最後一班 3782：23:05 金色標籤看得見、車身外圈金色光暈真的畫出來',async()=>{
  marks.ground=await markCheck(gm,{text:'地面最後一班 3782',sec:83100,name:'3782 地面最後一班',file:'mark-3782',
   hueOk:L=>{const h=toHsl(cssRgb(L.bg));return h.h>=38&&h.h<=52&&h.s>.6;},colorOk:([r,g,b])=>r>=200&&g>=140&&r-b>=60&&g-b>=30});
 });
 await step('最後南下 145：標籤文字、深紅配色、紅色光暈真的畫出來',async()=>{
  const at=sm.stops.find(isTainan).arrSec+5;
  marks.south=await markCheck(sm,{text:'最後南下・告別列車 145',sec:at,name:'145 最後南下',file:'mark-145',
   hueOk:L=>{const h=toHsl(cssRgb(L.bd));return (h.h<=12||h.h>=348)&&h.s>.3;},colorOk:([r,g,b])=>r-g>=40&&r-b>=40});
 });

 await step('跟車逐站卡：表定／實測／差／留置（≥90 秒）／來源逐站對得上 snapshot，另列這班車自己的事件',async()=>{
  const sched=D.trains.find(t=>t.timing==='scheduled'),held=D.trains.find(t=>!t.mark&&t.timing==='observed'&&t.stops.some(s=>Number(s.holdSec)>=90))||D.trains.find(t=>!t.mark&&t.timing==='observed');
  const picks=[gm,sm,sched,held].filter(Boolean);assert.equal(picks.length,4,'找不到要驗的四班車（兩班重點車、一班整班表定、一班一般實測）');
  let holdRows=0,noHoldRows=0;const srcSeen=new Set();
  for(const t of picks){
   await page.evaluate(()=>{tainanMemory.state.playing=false;});await page.locator('#train').selectOption(t.id);await frames();
   const g=await page.evaluate(()=>{const c=document.getElementById('followcard');if(c.hidden)return null;return {sec:tainanMemory.state.sec,h3:[...c.querySelector('h3').children].map(x=>x.textContent),status:c.querySelector('.st').textContent,note:c.querySelector('.note').textContent,
    rows:[...c.querySelectorAll('tbody tr')].map(tr=>({name:tr.querySelector('th').textContent,state:tr.dataset.state||'',tds:[...tr.querySelectorAll('td')].map(td=>td.querySelector('.src')?[td.textContent]:[...td.querySelectorAll('.ln')].map(l=>l.textContent)),holdCls:!!tr.querySelector('td.hold')})),
    mine:[...c.querySelectorAll('.mine li')].map(li=>[li.querySelector('time').textContent,li.querySelector('span').textContent]),hint:document.querySelector('#nightToggle .s').textContent};});
   assert.ok(g,t.train+' 沒有跟車卡');
   assert.deepEqual(g.h3,[t.train+' 次',t.typeName+' '+t.direction,...(t.mark==='last-ground'?['地面最後一班']:t.mark==='last-south'?['最後南下・告別列車']:[])],t.train+' 卡片標題');
   assert.equal(g.rows.length,t.stops.length,t.train+' 逐站列數');
   t.stops.forEach((s,i)=>{const pass=s.stop===false,has=Number.isFinite(s.schedArrSec),hold=Number(s.holdSec)>=90?Number(s.holdSec):0,r=g.rows[i];
    const want=[has?(pass?['通過',hms(s.schedArrSec)]:[hms(s.schedArrSec),hms(s.schedDepSec)]):['—'],pass?['通過',hms(s.arrSec)]:[hms(s.arrSec),hms(s.depSec)],
     has?(pass?[diff(s.arrSec-s.schedArrSec)]:[diff(s.arrSec-s.schedArrSec),diff(s.depSec-s.schedDepSec)]):['—'],[hold?dur(hold):'—'],[SRC_ZH[s.src]||'—']];
    assert.equal(r.name,s.name);assert.deepEqual(r.tds,want,`${t.train} ${s.name} 的表定／實測／差／留置／來源`);assert.equal(r.holdCls,!!hold,`${t.train} ${s.name} 留置的強調樣式`);
    const slack=pass?10:0;assert.equal(r.state,g.sec>s.depSec+slack?'past':g.sec>=s.arrSec-slack?'now':'future',`${t.train} ${s.name} 的過去／現在／未來標記`);
    if(hold)holdRows++;else if(!pass&&Number(s.holdSec)<90)noHoldRows++;srcSeen.add(SRC_ZH[s.src]||'—');});
   assert.deepEqual(g.mine,evs.filter(e=>e.train!=null&&String(e.train)===t.train).map(e=>[evTime(e.t),e.text]),t.train+' 的「這班車在最後一夜」清單');
   assert.ok((t.timing==='scheduled'?g.note.includes('沒有任何即時動態紀錄'):g.note.includes('到站誤差約半分鐘')),t.train+' 卡片註腳');
   assert.equal(g.hint,'跟車中：'+t.train+' 次的逐站時刻','收合列的副標');
   if(t===sm){if(!side)await setPanel(true);await page.locator('#followcard').scrollIntoViewIfNeeded();const box=await page.locator('#followcard').boundingBox();assert.ok(box&&box.width>100&&box.height>60,'跟車卡在畫面上沒有大小');await shot('card-145');await setPanel(side);}}
  assert.ok(holdRows>0,'四班車裡沒有任何留置（≥90 秒）的列，留置欄位這項檢查是空轉');assert.ok(noHoldRows>0,'沒有任何「未達 90 秒、不標留置」的列，反向對照缺');
  for(const k of ['實測','內插','表定'])assert.ok(srcSeen.has(k),'四班車的卡片沒出現來源「'+k+'」');
  await page.locator('#train').selectOption('');await frames();const off=await page.evaluate(()=>({hidden:document.getElementById('followcard').hidden,hint:document.querySelector('#nightToggle .s').textContent}));
  assert.equal(off.hidden,true,'取消跟車後卡片還在');assert.equal(off.hint,'點一列，跳到那個時刻','取消跟車後副標沒復原');
 });

 await step('單線雙向：時段內場景裡有一行說明、時段外沒有，不壓控件、不接收指標',async()=>{
  await setPanel(side);const sl=D.single,mid=Math.round((sl.fromSec+sl.toSec)/2);
  for(const [sec,on] of [[sl.fromSec-60,false],[sl.fromSec+2,true],[mid,true],[sl.toSec-2,true],[sl.toSec+60,false]]){
   await page.evaluate(sec=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');tainanMemory.jump(sec);},sec);await frames();
   const g=await page.evaluate(()=>{const e=document.getElementById('singleline'),r=e.getBoundingClientRect(),s=document.getElementById('scene').getBoundingClientRect(),cs=getComputedStyle(e),hit=[];
    if(!e.hidden)for(const o of [...document.querySelectorAll('#scene button,#scene a,#scene input,#scene select,#scene .scene-note')]){const b=o.getBoundingClientRect();if(!b.width||!b.height||getComputedStyle(o).display==='none')continue;if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>1&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>1)hit.push(o.id||o.className||o.tagName);}
    return {hidden:e.hidden,text:e.textContent,pe:cs.pointerEvents,inScene:r.left>=s.left-1&&r.right<=s.right+1&&r.top>=s.top-1&&r.bottom<=s.bottom+1,w:r.width,hit};});
   assert.equal(g.hidden,!on,`${hms(sec)} 單線說明該${on?'顯示':'隱藏'}`);
   if(on){assert.equal(g.text,sl.note);assert.equal(g.pe,'none');assert.ok(g.inScene&&g.w>60,'說明超出場景：'+JSON.stringify(g));assert.deepEqual(g.hit,[],'單線說明壓到控件或操作提示');}}
 });

 await step('不確定時段：每種 reason 各有字幕寫法（封鎖初期股道安排不明／股道安排待確認）；車身隱藏、標籤留原位、離開後恢復',async()=>{
  const reasons=[...new Set(D.intervals.map(i=>i.reason))];assert.ok(reasons.length>0&&reasons.every(r=>WORDS[r]),'intervals 的 reason 缺漏或未知：'+JSON.stringify(reasons));
  assert.ok(reasons.includes('single-line-unresolved'),'封鎖初期（22:00 到單線起點）那幾班要有 single-line-unresolved 的不確定時段：'+JSON.stringify(reasons));   // track-overlap 有就驗、沒有就略過（兩種都有時各驗一次）
  for(const r of reasons){const iv=D.intervals.find(i=>i.reason===r),sec=(iv.start+iv.end)/2;
   await page.evaluate(sec=>{tainanMemory.state.playing=false;tainanMemory.followTrain('');tainanMemory.jump(sec);tainanMemory.stationView();},sec);await frames();
   const g=await page.evaluate(([ids,sec])=>{const m=tainanMemory;const sampled=id=>!!m.sample(m.data.trains.find(t=>t.id===id),sec);return {caption:document.getElementById('caption').textContent,cls:document.getElementById('caption').classList.contains('uncertain'),
    now:m.uncertainty.intervals.filter(i=>sec>=i.start&&sec<=i.end).map(i=>({reason:i.reason||'',on:i.trains.some(sampled)})),
    own:ids.map(id=>{const model=m.models.get(id),p=m.sample(m.data.trains.find(t=>t.id===id),sec);return {id,bodyHidden:!model.group.visible,keep:!!model.label.coordinate&&!!p&&Math.hypot((model.label.coordinate[0]-p.coordinate[0])*102000,(model.label.coordinate[1]-p.coordinate[1])*111320)<.001,dashed:model.label.e.classList.contains('uncertain')};})};},[iv.trains,sec]);
   assert.ok(g.cls,r+' 字幕沒有標成不確定樣式');
   for(const [k,w] of Object.entries(WORDS)){const present=g.now.some(x=>x.reason===k&&x.on);assert.equal(g.caption.includes(w),present,`${hms(sec)} 字幕「${w}」該${present?'出現':'不出現'}：${g.caption}`);}
   assert.ok(g.now.some(x=>x.reason===r&&x.on),r+' 的挑選時刻沒有任何車在場景內，這項檢查是空轉');
   for(const n of iv.trainNos)assert.ok(g.caption.includes(n),`字幕缺車次 ${n}：${g.caption}`);
   for(const o of g.own)assert.deepEqual([o.bodyHidden,o.keep,o.dashed],[true,true,true],`${r} 的 ${o.id} 沒有保留原位置標記`);
   await page.evaluate(sec=>{tainanMemory.jump(sec);},iv.end+2);await frames();
   const after=await page.evaluate(([ids,sec])=>{const m=tainanMemory,busy=new Set(m.uncertainty.intervals.filter(i=>sec>=i.start&&sec<=i.end).flatMap(i=>i.trains));return ids.filter(id=>!busy.has(id)).map(id=>({id,visible:m.models.get(id).group.visible,sampled:!!m.sample(m.data.trains.find(t=>t.id===id),sec)}));},[iv.trains,iv.end+2]);
   for(const a of after)if(a.sampled)assert.ok(a.visible,`${r}：離開時段後 ${a.id} 沒有恢復車身`);}
 });
 return {steps:done.length,marks};
}
for(const [engine,type] of Object.entries({chromium,webkit})){
 if(process.env.ENGINES&&!process.env.ENGINES.split(',').includes(engine))continue;
 // 使用者 2026-09-23 裁示瀏覽器測試一律無視窗(有視窗會搶焦點、把畫面切走)。Chromium 帶 channel:'chromium' 走真 GPU 的無視窗模式;預設 headless shell 是 SwiftShader 軟體算繪。
 const browser=await type.launch(engine==='chromium'?{channel:process.env.CHROMIUM_CHANNEL||'chromium',headless:true}:{headless:true});
 for(const [width,height] of [[360,780],[375,812],[390,844],[414,896],[768,1024],[844,390],[1280,900]]){
  console.log('開始',engine,width,height);
  const touch=width!==1280,context=await browser.newContext({viewport:{width,height},isMobile:touch,hasTouch:touch,deviceScaleFactor:1});const page=await context.newPage(),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
  // 模擬地下化後才開啟；歷史頁不可依裝置日期換班表。
  await page.addInitScript(()=>{const NativeDate=Date;globalThis.Date=class extends NativeDate{constructor(...a){super(...(a.length?a:['2027-01-03T12:00:00+08:00']));}static now(){return new NativeDate('2027-01-03T12:00:00+08:00').valueOf();}};});
  await page.goto(base+'/'+DIR+'/');try{await page.waitForFunction(()=>window.tainanMemory?.state.ready,null,{timeout:60000});}catch(e){console.log('載入狀態',await page.locator('#loading').textContent(),errors);throw e;}
  const opening=lastDay?await lastDayOpening(page,{engine,width,height}):{};
  const click=sel=>touch?page.tap(sel):page.click(sel);
  await click('#play');const layout=await controls(page,'body',lastDay?'#events':'');assert.deepEqual(layout.errors,[],engine+' '+width+' '+JSON.stringify(layout.errors));
  await click('#next');await click('#zoomin');await click('#zoomout');await click('#rotate');await click('#overview');await click('#station');
  // 施工外罩預設蓋上，按鈕可拿掉再蓋回（使用者 2026-09-29 選「完整站房＋外罩可切換」）。
  const wrapState=()=>page.evaluate(()=>[tainanMemory.wrap?.visible,document.getElementById('wrap').textContent]);
  assert.deepEqual(await wrapState(),[true,'拿掉外罩']);await click('#wrap');assert.deepEqual(await wrapState(),[false,'蓋回外罩']);await click('#wrap');assert.deepEqual(await wrapState(),[true,'拿掉外罩']);
  // 周邊建物改成低細節網格（使用者 2026-09-30「附近的建築物應該也要同樣建模 不需要太精細 但是不要是灰色方塊」）：網格在場景裡，群組、材質、頂點數與 model.json 一致，
  // 香格里拉飯店塔身（封存輪廓漏收、另依 OSM 部件補上的 255990928）也在。
  assert.deepEqual(await page.evaluate(()=>{const s=tainanMemory.surroundings,n=s?.meta?.lods?.near;return [!!s?.mesh?.parent,n?.drawGroups?.length>0&&s.mesh.geometry.groups.length===n.drawGroups.length,Array.isArray(s?.mesh?.material)&&s.mesh.material.length===n?.drawGroups?.length,s?.mesh?.geometry?.attributes?.position?.count===n?.vertexCount,!!s?.meta?.buildings?.some(b=>b.id===255990928&&b.minHeightM===24)];}),[true,true,true,true,true],'周邊建物網格沒有完整載入');
  // 放大極限 34 公尺（使用者 2026-09-29「放大極限就用 34 公尺」）：從舊站近景連按放大，視野高度停在 34 m、不會更近。
  for(let i=0;i<8;i++)await click('#zoomin');assert.equal(await page.evaluate(()=>Math.round((tainanMemory.camera.top-tainanMemory.camera.bottom)*1000)/1000),34);
  // 馬路（使用者 2026-09-30「連馬路、人行道細節也做更多一點」）：柏油、人行道、路緣、白線、黃線五層網格都在場景裡、不是空的；
  // 標線只有 12～15 cm 寬，放大到 34 m 時完全不透明，切到全線時淡出、不畫（每個像素幾公尺，畫了只會閃爍）。
  assert.deepEqual(await page.evaluate(()=>{const m=tainanMemory.roads?.meshes||{};return ['asphalt','sidewalk','curb','white','yellow'].map(k=>!!m[k]?.parent&&m[k].geometry.attributes.position.count>0).concat([m.white?.visible,m.white?.material.opacity,m.yellow?.material.opacity]);}),[true,true,true,true,true,true,1,1],'馬路網格或 34 m 的標線不對');
  await click('#overview');assert.deepEqual(await page.evaluate(()=>{const m=tainanMemory.roads.meshes;return [m.white.visible,m.white.material.opacity,m.yellow.visible];}),[false,0,false],'全線視角的標線沒有淡出');
  await click('#station');
  // EMU3000 集電弓車的位置與朝向（維基編組表：1 號車在屏東／高雄端，集電弓在第 3、7 節靠 1 號車端、第 10 節靠 12 號車端；
  // 網格的集電弓在 -X 端，flip＝轉 180° 後集電弓朝行進前方）。期望值直接寫編組表推出來的結果，不照頁面的排法算。
  const ep3000=await page.evaluate(()=>Object.fromEntries(['南下','北上'].map(d=>{const t=tainanMemory.data.trains.find(t=>t.formation.id==='emu3000'&&t.direction===d);return [d,tainanMemory.models.get(t.id).parts.map((p,i)=>p.mesh==='emu3000'?'ED'+(p.flip?'<':'>')+i:p.mesh==='emu3000-ep'?'EP'+(p.flip?'<':'>')+i:null).filter(Boolean)];})));
  assert.deepEqual(ep3000,{南下:['ED>0','EP<2','EP<6','EP>9','ED<11'],北上:['ED>0','EP<2','EP>5','EP>9','ED<11']},'EMU3000 集電弓車的位置或朝向不對');
  await page.locator('#speed').selectOption('60');await page.locator('#time').fill('17:30:00');await page.locator('#time').dispatchEvent('change');assert.equal(await page.locator('#clock').textContent(),'17:30:00');
  const timeline=page.locator('#timeline');const b=await timeline.boundingBox();if(touch)await page.touchscreen.tap(b.x+b.width*.75,b.y+b.height/2);else await page.mouse.click(b.x+b.width*.75,b.y+b.height/2);assert.ok(await page.evaluate(()=>tainanMemory.state.sec>60000));
  if(height>520){await click('#about');for(const control of await page.locator('#details a,#details button').all()){await control.scrollIntoViewIfNeeded();assert.ok(await control.evaluate(e=>{const b=e.getBoundingClientRect(),h=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return b.height>=44&&(e===h||e.contains(h));}),'說明控件可捲到且可觸及');}await click('#details button');}
  const behavior=await page.evaluate(async lastDay=>{
   const m=tainanMemory,results=[];m.state.playing=false;
   const distance=(a,b)=>Math.hypot((a[0]-b[0])*102000,(a[1]-b[1])*111320);
   for(const direction of ['北上','南下']){
    const tr=m.data.trains.find(t=>t.direction===direction&&t.serviceDate===m.data.date&&t.stops.some(s=>s.name.replace('台','臺')==='臺南'&&s.depSec-s.arrSec>=120)),st=tr.stops.find(s=>s.name.replace('台','臺')==='臺南');
    const p=m.sample(tr,st.arrSec+40),q=m.sample(tr,st.depSec-20);if(!p||!q)throw Error('停靠時不見列車');if(distance(p.coordinate,q.coordinate)>.02)throw Error('停靠時仍移動 '+tr.train);
    let run;for(let t=tr.spans[0].start+30;t<st.arrSec-20;t+=10){const a=m.sample(tr,t),b=m.sample(tr,t+10);if(a&&b&&distance(a.coordinate,b.coordinate)>10){run={a,b,t};break;}}
    if(!run)throw Error('找不到動態案例');if(Math.sign(run.b.coordinate[1]-run.a.coordinate[1])!==(direction==='北上'?1:-1))throw Error('方向相反');
    m.jump(run.t);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const model=m.models.get(tr.id);if(!model.group.visible)throw Error('實際編組未顯示');
    // 由渲染物件反算座標，核對原始股道線段，而非只拿 sample() 與自己比。
    let error=0;for(const car of model.cars){const lon=m.data.origin[0]+car.position.x/(111320*Math.cos(m.data.origin[1]*Math.PI/180)),lat=m.data.origin[1]+car.position.y/111320;let nearest=Infinity;for(const rail of m.data.rails)for(let i=1;i<rail.coordinates.length;i++){const a=rail.coordinates[i-1],b=rail.coordinates[i],x=(a[0]-lon)*102000,y=(a[1]-lat)*111320,dx=(b[0]-a[0])*102000,dy=(b[1]-a[1])*111320,f=Math.max(0,Math.min(1,-(x*dx+y*dy)/(dx*dx+dy*dy||1)));nearest=Math.min(nearest,Math.hypot(x+f*dx,y+f*dy));}error=Math.max(error,nearest);}if(error>.05)throw Error('車廂離軌 '+error);
    results.push({direction,train:tr.train,cars:model.cars.length,trackErrorM:error,dwellDisplacementM:distance(p.coordinate,q.coordinate)});
   }
   const night=m.data.trains.filter(t=>t.serviceDate!==m.data.date).map(t=>({train:t.train,visible:!!m.sample(t,t.spans[0].start+1)}));if(night.some(t=>!t.visible))throw Error('跨夜遺失');
   const uncertain=lastDay?(m.uncertainty.intervals.find(i=>(i.reason||'track-overlap')==='track-overlap')||m.uncertainty.intervals[0]):m.uncertainty.intervals.find(i=>i.trainNos.includes('3158'));m.jump((uncertain.start+uncertain.end)/2);m.stationView();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   for(const id of uncertain.trains){const model=m.models.get(id),tr=m.data.trains.find(t=>t.id===id),p=m.sample(tr,m.state.sec);if(model.group.visible||!model.label.coordinate||distance(model.label.coordinate,p.coordinate)>.001)throw Error('不確定股道沒有保留原位置標記');}
   if(!document.getElementById('caption').textContent.includes(lastDay&&uncertain.reason==='single-line-unresolved'?'封鎖初期股道安排不明':'股道安排待確認'))throw Error('缺少不確定性說明');
   m.jump(uncertain.end+2);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));for(const id of uncertain.trains)if(!m.models.get(id).group.visible)throw Error('已離開不確定時段仍不恢復車身');
   return {date:m.data.date,dayTrainCount:m.data.trains.length,directions:results,night,uncertainty:'原位置標記與明示說明，離開時段恢復車身'};
  },lastDay);
  const lastResult=lastDay?{opening,...await lastDayChecks(page,{engine,width,height,click,out})}:{};
  const followId=await page.evaluate(()=>tainanMemory.data.trains.find(t=>t.direction==='南下'&&t.serviceDate===tainanMemory.data.date).id);await page.locator('#train').selectOption(followId);assert.equal(await page.evaluate(()=>tainanMemory.state.follow),followId);await click('#station');
  const before=await page.evaluate(()=>tainanMemory.state.sec);await click('#play');await page.waitForFunction(before=>tainanMemory.state.sec>before+5,before);await click('#play');
  await page.locator('#time').fill('08:03:30');await page.locator('#time').dispatchEvent('change');await page.screenshot({path:`${out}/${engine}-${width}.png`});
  assert.deepEqual(errors,[]);assert.ok(requests.every(u=>u.startsWith(base+'/'+DIR+'/')||u==='data:,'||isProductionTelemetry(u)),'歷史頁讀取外部或即時資料');
  assert.equal(await page.locator('#live').getAttribute('href'),'../../?scene=3d&g=all&at=22.99681,120.21295&z=17');
  results.push({engine,width,height,controls:layout.count,requests:requests.length,telemetryRequests:requests.filter(isProductionTelemetry).length,...behavior,...lastResult});console.log('通過',engine,width);fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));await context.close();
 }
 await browser.close();
}
fs.writeFileSync(out+'/browser-results.json',JSON.stringify(results,null,2));console.log('雙引擎重播驗收通過：'+results.length+' 組；'+results.map(r=>r.width).join('/'));
