// 跟車面板的時速與「停靠／行進中」要跟地圖上的車同源。
//
// 症狀：?train=4172&t=12:09 讓時鐘 1× 走，地圖上的車到表定 12:10:00 才離開福隆，左側面板卻從
// 12:09:4x 起時速就往上爬，12:09:57 就切「行進中」、倒數沒出現「3 秒後」；石城同樣。
// 舊寫法：時速取「現在→20 秒後」的位移（偷看地圖還沒畫的未來），狀態列在剩 3 秒時提早收掉。
//
// 真值一律取班表（tr.stops 的 arrSec／depSec），不取面板自己用的位置差分：
//   - 表定停靠中（到站滿半秒之後、發車之前）：時速讀數必須是 0，狀態列寫「停靠 該站」且倒數＝無條件進位的剩餘秒數；
//   - 表定發車那一刻起：狀態列「行進中」；
//   - 正向對照：地圖上的車在停靠期間確實不動、發車後確實在動，開出去之後時速不是 0、站間巡航有一般速度
//     （證明上面的 0 不是讀數卡死）。
// 「到站滿半秒」是規格：時速是最近一小段時間的平均，車剛停下的那一瞬間允許還有一點尾數。
//
// 兩條位置來源都驗：實體股道（物理模型，正式站預設）與示意線形（?tracks=legacy）。
// 另驗反方向一班（AGENTS.md：有方向性的資料兩個方向各至少一例）、真時鐘 1× 跑過發車那一刻（使用者的實際動作），
// 以及旅程日誌在真時鐘下會記到下一站的停靠（錄影只記到福隆，是錄影腳本把 dt 固定為 0、日誌掃描不會觸發）。
//
// 被前車擋住（防追撞 hold）：地圖上的車放慢或停住，時刻表軸照走。這段的真值是「地圖上的車每一幀實際畫在哪」，
// 取真時鐘跑過一段 hold 正在變化的區間，逐幀比面板讀數與地圖位移換算的時速；另驗暫停時讀數不跳。
// 暫停撥鐘量不到這段：暫停時 hold 會直接對齊目標，與時鐘在走時的漸變不同。
//
// 班表每週重抓（data/tra_schedule_dense.json 的 dates 只涵蓋兩週），所以日期與車次從資料裡挑：
// 優先用回報的 4172 福隆／石城，資料裡沒有就換一班有兩個相鄰 20 秒以上停靠的車。
//
// MUTATE=1 時速改回「現在→20 秒後」；MUTATE=2 停靠判準加回剩 3 秒就收掉；MUTATE=3 倒數改回四捨五入；
// MUTATE=4 時速改回「同一個 hold 往回推 0.5 秒」（v1014a 第一版，照不到被擋的車）；MUTATE=5 暫停時不沿用讀數；
// MUTATE=6 前幾幀固定只留 2 模擬秒（高倍率一幀跨過就退回同一個 hold 往回推）。
// 突變各自應該紅；正常驗收勿帶。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MUTATE = process.env.MUTATE || '';

// 挑日期與車次：今天（台北）在資料範圍內就用今天，否則用資料的第一天；4172 福隆→石城優先
const DENSE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
const TODAY = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const DAYS = Object.keys(DENSE.dates || {}).sort();
const dwellPair = (tr, a, b) => {
  const i = tr.stops.findIndex(x => x.name === a);
  const ok = st => st && st.stop !== false && st.depSec - st.arrSec >= 20 && st.depSec - st.arrSec <= 120;
  return i >= 0 && tr.stops[i + 1]?.name === b && ok(tr.stops[i]) && ok(tr.stops[i + 1]);
};
function pickCase() {
  for (const day of [TODAY, ...DAYS].filter((d, i, a) => DAYS.includes(d) && a.indexOf(d) === i)) {
    const trains = DENSE.dates[day].map(i => DENSE.trains[i]);
    const tr = trains.find(t => String(t.train) === '4172');
    if (tr && dwellPair(tr, '福隆', '石城')) return { day, train: '4172', a: '福隆', b: '石城', arr: tr.stops.find(x => x.name === '福隆').arrSec };
  }
  const day = DAYS.includes(TODAY) ? TODAY : DAYS[0];
  for (const tr of DENSE.dates[day].map(i => DENSE.trains[i])) {
    if (tr.stops[0].name === tr.stops.at(-1).name) continue; // 環島車
    for (let i = 1; i + 2 < tr.stops.length; i++) {
      const a = tr.stops[i], b = tr.stops[i + 1];
      if (a.arrSec > 8 * 3600 && a.arrSec < 20 * 3600 && dwellPair(tr, a.name, b.name))
        return { day, train: String(tr.train), a: a.name, b: b.name, arr: a.arrSec };
    }
  }
  return null;
}
const CASE = pickCase();
if (!CASE) throw new Error(`G0 班表 ${DAYS[0]}～${DAYS.at(-1)} 裡找不到有兩個相鄰 20 秒以上停靠的台鐵車`);
const PIN_DATE = Date.parse(`${CASE.day}T11:00:00+08:00`);
const clockQuery = (train, sec) => {
  const hm = Math.floor(sec / 60);
  return `train=${train}&t=${String(Math.floor(hm / 60)).padStart(2, '0')}:${String(hm % 60).padStart(2, '0')}`;
};
const CASE_QUERY = clockQuery(CASE.train, CASE.arr - 60); // 進第一站前一分鐘

const MUTATIONS = {
  1: ['const kmh = followSpeedKmh(tr);',
      'const pa = trainPos(tr, state.simSec), pb = trainPos(tr, state.simSec + 20);\n'
      + '  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / 20 * 3600, speedCapOf(tr)) : 0;'],
  2: ['return dw && dw.st.stop !== false && dw.total >= 20 ? dw : null;',
      'return dw && dw.st.stop !== false && dw.remain > 3 && dw.total >= 20 ? dw : null;'],
  3: ['const left = Math.ceil(dw.remain), mm = Math.floor(left / 60), ss = left % 60;',
      'const mm = Math.floor(dw.remain / 60), ss = Math.round(dw.remain % 60);'],
  4: ['const kmh = followSpeedKmh(tr);',
      'const pa = trainPos(tr, state.simSec - FP_SPEED_DT_SEC), pb = trainPos(tr, state.simSec);\n'
      + '  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / FP_SPEED_DT_SEC * 3600, speedCapOf(tr)) : 0;'],
  5: ['    if (Math.abs(last.e - e) > 1e-3) _fpEff.hist = [{ s, e }];\n    return _fpEff.kmh;\n',
      '    hist.pop();\n'],
  6: ['const keep = Math.max(FP_SPEED_KEEP_SEC, (state.speedMult || 1) * FP_SPEED_KEEP_REAL_SEC);',
      'const keep = FP_SPEED_KEEP_SEC;'],
};
if (MUTATE) {
  const [from, to] = MUTATIONS[MUTATE] || [];
  if (!from || !INDEX.includes(from)) throw new Error(`G0 突變 ${MUTATE} 找不到目標片段：${from}`);
  INDEX = INDEX.replace(from, to);
  console.log(`⚠️  MUTATE=${MUTATE}：${to}`);
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.geojson': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
};
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) { // 離線：不套即時誤點，表定時刻就是畫面時刻
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"offline test"}');
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    response.writeHead(200, { 'content-type': MIME['.html'] });
    response.end(INDEX);
    return;
  }
  const target = path.join(ROOT, decodeURIComponent(url.pathname));
  if (!path.resolve(target).startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
    response.writeHead(404); response.end('Not found'); return;
  }
  response.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const BASE = `http://127.0.0.1:${server.address().port}/`;
console.log(`目標目錄 ${ROOT}`);
console.log(`班表日 ${CASE.day}（資料 ${DAYS[0]}～${DAYS.at(-1)}）；${CASE.train} 次 ${CASE.a}→${CASE.b}`);

let assertions = 0;
const failures = [];
const check = (name, pass, detail = '') => {
  assertions++;
  if (!pass) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
};
const hms = s => new Date(Math.round(s * 1000) % 86400000).toISOString().slice(11, 21);
const speedOf = text => { const m = /^(\d+)\s*km\/h/.exec(text || ''); return m ? +m[1] : NaN; };
// 「⏸ 停靠 福隆 · 1 分 30 秒後開車（待避／調度長停）」→ { station, sec }
const dwellOf = text => {
  const m = /^⏸ 停靠 (.+?) · (?:(\d+) 分 )?(\d+) 秒後開車/.exec(text || '');
  return m ? { station: m[1], sec: (+(m[2] || 0)) * 60 + (+m[3]) } : null;
};
const RUNNING = '▶ 行進中';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openFollow(query, { physical }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'zh-TW', timezoneId: 'Asia/Taipei' });
  await context.addInitScript(target => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
    const RealDate = Date, off = target - RealDate.now();
    class PinnedDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); }
      static now() { return RealDate.now() + off; }
    }
    window.Date = PinnedDate;
  }, PIN_DATE);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${BASE}?${query}&lang=zh-TW`, { waitUntil: 'load', timeout: 120000 });
  const want = /train=([^&]+)/.exec(query)[1];
  await page.waitForFunction(no => {
    try {
      return state.followTrain && String(state.followTrain.train) === no && !document.getElementById('followPanel').hidden;
    } catch (error) { return false; }
  }, want, { timeout: 120000 });
  // 實體股道非同步載入；載入那一刻停車點會換到實體月台（一次性位移），所以要等它到位才量
  if (physical) {
    await page.waitForFunction(() => !!window.railIslandPhysical?.has?.(state.followTrain), null, { timeout: 120000 })
      .catch(() => {});
  }
  const source = await page.evaluate(() => ({
    loaded: !!window.railIslandPhysical,
    covers: !!window.railIslandPhysical?.has?.(state.followTrain),
  }));
  return { context, page, errors, source };
}

// 一次讀齊：模擬時刻、面板兩格、地圖上這班車的位置（draw() 與立體圖層都是 trainPos(tr, state.simSec)）
const readPanel = page => page.evaluate(() => {
  const tr = state.followTrain, p = trainPos(tr, state.simSec);
  return {
    sim: state.simSec,
    spd: document.getElementById('fpSpd').textContent,
    st: document.getElementById('fpStatus').textContent,
    lat: p ? p.lat : null, lon: p ? p.lon : null,
  };
});
// 前提：地圖這一幀畫的車＝trainPos(tr, state.simSec)。拿 2D 命中框（每幀重建）反投影回經緯度對一次，
// 不然底下所有「地圖上的車」都只是腳本自己呼叫 trainPos，跟面板同一個函式。
const drawnGap = page => page.evaluate(() => {
  const tr = state.followTrain, p = trainPos(tr, state.simSec);
  const hit = (state._trainHits || []).find(h => h.tr === tr);
  if (!p || !hit || !M.raw?.unproject) return null;
  const ll = M.raw.unproject([hit.x, hit.y]);
  return haversineKm(p, { lat: ll.lat, lon: ll.lng }) * 1000;
});
const metres = (a, b) => {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos((a.lat + b.lat) / 2 * k), y = (b.lat - a.lat) * k;
  return Math.hypot(x, y) * 6371008.8;
};
// 暫停後直接撥模擬時刻，等兩幀讓真正的 tick→updateFollowCamera→updateFollowPanel 畫完再讀
async function at(page, sim) {
  await page.evaluate(sim => { state.playing = false; state.simSec = sim; }, sim);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return readPanel(page);
}

const stopOf = (page, name) => page.evaluate(name => {
  const tr = state.followTrain, i = tr.stops.findIndex(s => s.name === name);
  if (i < 0) return null;
  const s = tr.stops[i], next = tr.stops[i + 1];
  return { i, name: s.name, label: stationName(s.name, tr.sys), stop: s.stop, arr: s.arrSec, dep: s.depSec,
    nextArr: next ? next.arrSec : null, train: String(tr.train) };
}, name);

async function sweepStop(page, tag, st) {
  const dwellFrom = st.arr + 0.5;
  const times = [];
  for (let t = dwellFrom; t < st.dep; t += 0.25) times.push(t);
  times.push(st.dep - 0.01);
  const anchor = await at(page, dwellFrom);
  const gap = await drawnGap(page);
  check(`${tag} G1 地圖這一幀畫的車＝trainPos（2D 命中框反投影差 ${gap == null ? '—' : gap.toFixed(2)} m）`, gap != null && gap < 1);
  let bad = { spd: [], st: [], moved: 0 };
  for (const t of times) {
    const r = await at(page, t);
    const spd = speedOf(r.spd), dw = dwellOf(r.st), want = Math.ceil(st.dep - t);
    bad.moved = Math.max(bad.moved, metres(anchor, r));
    if (spd !== 0) bad.spd.push(`${hms(t)} ${r.spd}`);
    if (!dw || dw.station !== st.label || dw.sec !== want) bad.st.push(`${hms(t)}「${r.st}」應為 停靠 ${st.label} · ${want} 秒`);
  }
  check(`${tag} P1 正向對照：表定停靠期間地圖上的車不動（最大位移 ${bad.moved.toFixed(3)} m）`, bad.moved < 0.01);
  check(`${tag} A1 停靠期間時速讀數恆為 0（${times.length} 個時點）`, bad.spd.length === 0,
    `${bad.spd.length} 個時點不是 0，前幾個：${bad.spd.slice(0, 4).join('；')}`);
  check(`${tag} A2 停靠期間狀態列寫「停靠 ${st.label}」且倒數＝無條件進位的剩餘秒數`, bad.st.length === 0,
    `${bad.st.length} 個時點不符，前幾個：${bad.st.slice(0, 3).join('；')}`);
  const last = await at(page, st.dep - 0.25);
  check(`${tag} A3 發車前 0.25 秒仍是「停靠 · 1 秒後開車」`, dwellOf(last.st)?.sec === 1, `實際「${last.st}」`);
  const after = [];
  for (const d of [0, 0.01, 0.25, 0.5, 1, 2, 3]) {
    const r = await at(page, st.dep + d);
    if (r.st !== RUNNING) after.push(`+${d}s「${r.st}」`);
  }
  check(`${tag} A4 表定發車那一刻起才是「行進中」`, after.length === 0, after.join('；'));
  const gone = await at(page, st.dep + 3);
  check(`${tag} P2 正向對照：表定發車後地圖上的車確實開出去（+3 秒位移 ${metres(anchor, gone).toFixed(2)} m）`,
    metres(anchor, gone) > 0.3);
  const rolling = await at(page, st.dep + 3);
  check(`${tag} P3 正向對照：開出去 3 秒時速不是 0（${rolling.spd}）`, speedOf(rolling.spd) > 0);
  if (st.nextArr != null) {
    const mid = await at(page, (st.dep + st.nextArr) / 2);
    check(`${tag} P4 正向對照：站間中點時速有一般巡航速度（${mid.spd}）`, speedOf(mid.spd) >= 20);
  }
  console.log(`  ${tag} ${st.label} ${hms(st.arr)}→${hms(st.dep)}：停靠 ${times.length} 點，時速非 0 ${bad.spd.length}、狀態不符 ${bad.st.length}`);
}

// 使用者的實際動作：時鐘 1× 真的走過發車那一刻
async function realClock(page, tag, st) {
  await page.evaluate(sim => { state.simSec = sim; state.speedMult = 1; state.playing = true; }, st.dep - 6);
  // 撥鐘後先等兩幀：撥鐘當下面板還是上一幀畫的，讀到的不是這個時刻的面板
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const samples = [];
  const until = Date.now() + 10000;
  while (Date.now() < until) {
    samples.push(await readPanel(page));
    if (samples.at(-1).sim > st.dep + 3) break;
    await page.waitForTimeout(40);
  }
  await page.evaluate(() => { state.playing = false; });
  const before = samples.filter(s => s.sim <= st.dep - 0.05 && s.sim >= st.arr + 0.5);
  const after = samples.filter(s => s.sim >= st.dep + 0.05);
  check(`${tag} R0 真時鐘有取到發車前後的樣本（前 ${before.length}、後 ${after.length}）`, before.length >= 20 && after.length >= 20);
  const badSpd = before.filter(s => speedOf(s.spd) !== 0);
  check(`${tag} R1 真時鐘：發車前時速恆為 0`, badSpd.length === 0, badSpd.slice(0, 4).map(s => `${hms(s.sim)} ${s.spd}`).join('；'));
  const badSt = before.filter(s => dwellOf(s.st)?.sec !== Math.ceil(st.dep - s.sim));
  check(`${tag} R2 真時鐘：發車前倒數＝無條件進位的剩餘秒數`, badSt.length === 0,
    badSt.slice(0, 4).map(s => `${hms(s.sim)}「${s.st}」`).join('；'));
  const seen = new Set(before.map(s => dwellOf(s.st)?.sec));
  check(`${tag} R3 真時鐘：倒數依序出現 3、2、1 秒`, [3, 2, 1].every(n => seen.has(n)), `看到 ${[...seen].join(',')}`);
  const early = after.filter(s => s.st !== RUNNING);
  check(`${tag} R4 真時鐘：發車後才是「行進中」`, early.length === 0, early.slice(0, 4).map(s => `${hms(s.sim)}「${s.st}」`).join('；'));
  const runAt = samples.find(s => s.st === RUNNING);
  console.log(`  ${tag} 真時鐘 ${samples.length} 樣本；第一次「行進中」在 ${runAt ? hms(runAt.sim) : '—'}（表定 ${hms(st.dep)}）`);
}

// 被前車擋住：真時鐘跑過一段 hold 正在變化的區間，逐幀比面板讀數與地圖上的車實際畫出的位移。
// 「實際畫出」取 draw() 推進 2D 命中框的點反投影回經緯度（攔在 draw 裡，相機還沒為下一幀移動），
// 不呼叫 trainPos——面板用的也是 trainPos 那條路，拿它當真值會同源。跟車時多半是 MapLibre render 裡
// 同步畫（syncDrawMaplibre），晚於這裡的 rAF 回呼，所以依模擬秒記下來，跑完再跟面板讀數對齊。
// pause：跑完按暫停，讀數要停在暫停前那一幀；minFrames／minBit：這一輪要有幾幀、其中幾幀 hold 真的有作用。
async function holdRun(page, tag, run) {
  const rows = await page.evaluate(async ({ from, to, mult, pause }) => {
    const raf = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
    const realDraw = window.draw, drawnBy = new Map();
    window.draw = function () {
      const result = realDraw.apply(this, arguments);
      const tr = state.followTrain, hit = (state._trainHits || []).find(h => h.tr === tr);
      // 同一個模擬秒只記第一次畫的：暫停後同一秒會一直重畫（hold 直接對齊目標、車會跳），那不是行駛
      if (hit && M.raw?.unproject && !drawnBy.has(state.simSec)) {
        const ll = M.raw.unproject([hit.x, hit.y]), p = trainPos(tr, state.simSec);
        drawnBy.set(state.simSec, { lat: ll.lat, lon: ll.lng, gap: p ? haversineKm(p, { lat: ll.lat, lon: ll.lng }) * 1000 : null });
      }
      return result;
    };
    const out = [];
    let holdJump = 0;
    try {
      state.playing = false; state.simSec = from; await raf(); await raf();
      state.speedMult = mult; state.playing = true;
      const tr = state.followTrain;
      // 每一幀都讀（rAF 回呼排在 tick 之後）：面板往回找的那一幀，這裡也有同一幀可以比
      while (state.simSec < to && state.simSec >= from) {
        await raf();
        const base = state.simSec - liveDelaySec(tr), r0 = trainPosAt(tr, base - 0.5), r1 = trainPosAt(tr, base);
        out.push({ s: state.simSec, spd: document.getElementById('fpSpd').textContent,
          raw: r0 && r1 ? haversineKm(r0, r1) / 0.5 * 3600 : null });
      }
      state.playing = false;
      if (pause) {
        const hold0 = blockHoldSec(tr);
        for (let k = 0; k < 6; k++) { await raf(); out.push({ paused: true, s: state.simSec, spd: document.getElementById('fpSpd').textContent }); }
        holdJump = Math.abs(blockHoldSec(tr) - hold0);
      }
      await raf(); await raf(); // 最後一幀的 MapLibre render 也要畫完
    } finally { window.draw = realDraw; }
    for (const r of out) Object.assign(r, drawnBy.get(r.s) || {});
    return { out, holdJump };
  }, run);
  const live = rows.out.filter(r => !r.paused), paused = rows.out.filter(r => r.paused);
  const gaps = live.filter(r => r.gap != null).map(r => r.gap);
  check(`${tag} G2 被擋期間地圖畫的車＝trainPos（${gaps.length} 幀，最大差 ${gaps.length ? Math.max(...gaps).toFixed(3) : '—'} m）`,
    gaps.length >= run.minFrames && Math.max(...gaps) < 1);
  const cmp = [];
  for (let i = 0; i < live.length; i++) {
    const r = live[i];
    if (r.s < run.from + 1 || r.lat == null) continue; // 開跑第一秒是撥鐘後的第一幀，面板還沒有前幾幀可比
    let j = i - 1; // 跟面板同一條規則：最近一個往回 0.5 模擬秒以上的幀；那一幀沒畫（等 GL）就不比
    while (j >= 0 && r.s - live[j].s < 0.5) j--;
    if (j < 0 || live[j].lat == null) continue;
    const map = metres(live[j], r) / 1000 / (r.s - live[j].s) * 3600;
    cmp.push({ s: r.s, step: r.s - live[i - 1].s, map, raw: r.raw, panel: speedOf(r.spd) });
  }
  const bit = cmp.filter(c => c.raw != null && Math.abs(c.raw - c.map) >= 10);
  const step = cmp.length ? Math.min(...cmp.map(c => c.step)) : 0;
  check(`${tag} H0 有逐幀樣本、而且 hold 真的讓地圖上的車跟時刻表軸分開（${cmp.length} 幀、每幀至少 ${step.toFixed(2)} 模擬秒，差 10 km/h 以上 ${bit.length} 幀）`,
    cmp.length >= run.minFrames && bit.length >= run.minBit && step >= (run.minStep || 0));
  const off = cmp.filter(c => Math.abs(c.panel - c.map) > 1.5);
  check(`${tag} H1 每一幀面板時速＝地圖上的車最近一段的位移換算（±1.5 km/h）`, off.length === 0,
    `${off.length} 幀不符，前幾個：${off.slice(0, 4).map(c => `${hms(c.s)} 面板 ${c.panel}／地圖 ${c.map.toFixed(1)}`).join('；')}`);
  if (run.pause) {
    const lastLive = live.at(-1), drift = paused.filter(r => r.spd !== lastLive.spd);
    check(`${tag} H2 暫停後讀數停在暫停前那一幀（${lastLive.spd}；暫停時 hold 跳了 ${rows.holdJump.toFixed(2)} 秒）`, drift.length === 0,
      drift.map(r => r.spd).join('；'));
  }
  const worst = cmp.reduce((a, c) => Math.max(a, Math.abs(c.raw - c.map)), 0);
  console.log(`  ${tag} ${hms(run.from)}→${hms(run.to)} ${run.mult}×：${cmp.length} 幀、時刻表軸與地圖最多差 ${worst.toFixed(1)} km/h`);
}

// 用 updateBlockHolds 本身快轉掃一遍，找 hold 每秒長 0.3 秒以上（地圖上的車明顯慢於時刻表軸）、又不在停站、連續 20 秒以上的段落。
// 掃到的段落不一定在實跑頁重現：hold 會帶歷史（前車被擋過、棘輪、跨幀 latch），而且同一段時間換一頁跟別的車，結果也可能不同
// （2026-10-16 換班表後挑到 6566 次 09:00：掃樣本那頁它被擋 6 分多鐘，跟 6566 的頁從同一起點以同一步長重播，hold 恆為 0，H0 因此恆紅）。
// 所以每個掃描窗都從清空的狀態起掃、回傳起掃點與多個候選，再到實跑頁用 replayHolds 重播、holdRisesOn 確認真的會被擋才拿來考。
const RESET_HOLDS = `for (const m of [_blockHold, _blockCapped, _blockGap, _blockPrevD, _blockSide, _blockSideSign,
  _blockSideRole, _blockSideEase, _blockSideLatch]) m.clear(); _blockSim = null;`;
const findHoldRuns = page => page.evaluate(reset => {
  state.playing = false;
  const trs = new Map(state.trains.map(t => [blockKeyOf(t), t]));
  const out = [];
  for (const [from, to] of [[6.5 * 3600, 9.5 * 3600], [5 * 3600, 6.5 * 3600], [9.5 * 3600, 23.5 * 3600]]) {
    (0, eval)(reset);
    const prev = new Map(), open = new Map(), runs = [];
    for (let s = from; s <= to; s += 0.5) {
      state.simSec = s; updateBlockHolds();
      for (const [k, h] of _blockHold) {
        const p = prev.get(k); prev.set(k, h);
        const tr = trs.get(k);
        const rising = p != null && (h - p) / 0.5 > 0.3 && !dwellInfoOf(tr, effTLive(tr));
        const o = open.get(k);
        if (rising) { if (o) o.to = s; else open.set(k, { train: String(tr.train), from: s, to: s }); }
        else if (o && s - o.to > 2) { open.delete(k); runs.push(o); }
      }
      for (const k of [...prev.keys()]) if (!_blockHold.has(k)) { prev.delete(k); }
    }
    runs.push(...open.values());
    out.push(...runs.filter(o => o.to - o.from >= 20).sort((x, y) => (y.to - y.from) - (x.to - x.from)).map(o => ({ ...o, scanFrom: from })));
  }
  return out;
}, RESET_HOLDS);
// 從起掃點以同一步長重播到 until，讓實跑頁的 hold 狀態與掃描時同一條歷史
const replayHolds = (page, scanFrom, until) => page.evaluate(([reset, from, to]) => {
  state.playing = false;
  (0, eval)(reset);
  for (let s = from; s < to; s += 0.5) { state.simSec = s; updateBlockHolds(); }
}, [RESET_HOLDS, scanFrom, until]);
// 在這一頁（跟的就是這班車）從 from 推到 to，回傳跟的車 hold 每秒長 0.3 秒以上的累計秒數
const holdRisesOn = (page, from, to) => page.evaluate(([from, to]) => {
  const tr = state.followTrain;
  let prev = blockHoldSec(tr), rising = 0;
  for (let s = from + 0.5; s <= to; s += 0.5) {
    state.simSec = s; updateBlockHolds();
    const h = blockHoldSec(tr);
    if ((h - prev) / 0.5 > 0.3 && !dwellInfoOf(tr, effTLive(tr))) rising += 0.5;
    prev = h;
  }
  return rising;
}, [from, to]);

async function journeyLog(page, tag, st) {
  await page.evaluate(sim => {
    state.followEvents = []; state._evSeen = {}; renderFollowEvents();
    state.simSec = sim; state.speedMult = 1; state.playing = true;
  }, st.arr - 3);
  await page.waitForFunction(t => state.simSec > t, st.arr + 2, { timeout: 15000 }).catch(() => {});
  const log = await page.evaluate(() => document.getElementById('tcEvents').innerText);
  await page.evaluate(() => { state.playing = false; });
  check(`${tag} L1 真時鐘跑過 ${st.label} 進站，旅程日誌記下「停靠 ${st.label}」`, log.includes(`停靠 ${st.label}`), JSON.stringify(log));
}

try {
  for (const mode of [{ name: '實體股道', q: '', physical: true }, { name: '示意線形', q: '&tracks=legacy', physical: false }]) {
    const { context, page, errors, source } = await openFollow(`${CASE_QUERY}${mode.q}`, mode);
    const tag = `[${CASE.train}/${mode.name}]`;
    check(`${tag} G0 位置來源確實是${mode.name}（物理模型 loaded=${source.loaded} covers=${source.covers}）`,
      mode.physical ? source.covers : !source.loaded);
    const first = await stopOf(page, CASE.a), second = await stopOf(page, CASE.b);
    const ok = check(`${tag} G0 頁面上的 ${CASE.train} 有${CASE.a}、${CASE.b}兩個 20 秒以上的停靠`,
      [first, second].every(s => s && s.stop !== false && s.dep - s.arr >= 20), JSON.stringify({ first, second }));
    if (ok) {
      await sweepStop(page, `${tag} ${CASE.a}`, first);
      await sweepStop(page, `${tag} ${CASE.b}`, second);
      if (mode.physical) {
        await realClock(page, `${tag} ${CASE.a}`, first);
        await journeyLog(page, tag, second);
      }
    }
    check(`${tag} 頁面沒有例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  // 反方向（經 b→a）挑一班在這段有 20 秒以上停靠的車；同一頁順便找被前車擋住的一段
  const scout = await openFollow(CASE_QUERY, { physical: false });
  const pick = await scout.page.evaluate(([na, nb]) => {
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || tr.loop) continue;
      const a = tr.stops.findIndex(s => s.name === nb), b = tr.stops.findIndex(s => s.name === na);
      if (a < 1 || b <= a) continue;
      for (const i of [a, b]) {
        const s = tr.stops[i];
        if (s.stop !== false && s.depSec - s.arrSec >= 20 && s.depSec - s.arrSec <= 120 && s.arrSec > 8 * 3600 && s.arrSec < 20 * 3600)
          return { train: String(tr.train), name: s.name, arr: s.arrSec };
      }
    }
    return null;
  }, [CASE.a, CASE.b]);
  await scout.context.close();
  // 被前車擋住的樣本在實體股道頁上找（實跑走實體股道，兩種幾何的擋車判定不同），再逐一到實跑頁確認
  const holdScout = await openFollow(CASE_QUERY, { physical: true });
  const holdCands = holdScout.source.covers ? await findHoldRuns(holdScout.page) : [];
  await holdScout.context.close();
  let holdPick = null, holdOpen = null;
  const tried = [];
  for (const c of holdCands.filter((c, i, a) => a.findIndex(x => x.train === c.train) === i).slice(0, 4)) {
    const from = c.from - 10, to = Math.min(c.to, c.from + 60) + 10;
    const o = await openFollow(clockQuery(c.train, from - 60), { physical: true });
    let rises = 0;
    if (o.source.covers) { await replayHolds(o.page, c.scanFrom, from); rises = await holdRisesOn(o.page, from, to); }
    tried.push(`${c.train}@${hms(c.from)} ${rises}s`);
    if (rises >= 20) { holdPick = c; holdOpen = o; break; }
    await o.context.close();
  }
  console.log(`  被前車擋住的樣本：候選 ${holdCands.length} 段，試過 ${tried.join('、') || '（無）'}`);
  if (check(`[反方向] G0 找得到一班反方向經${CASE.b}→${CASE.a}、在其中一站停 20 秒以上的車`, !!pick)) {
    const { context, page, errors, source } = await openFollow(clockQuery(pick.train, pick.arr - 60), { physical: true });
    const tag = `[${pick.train}/反方向/實體股道]`;
    check(`${tag} G0 位置來源確實是實體股道`, source.covers);
    await sweepStop(page, `${tag} ${pick.name}`, await stopOf(page, pick.name));
    check(`${tag} 頁面沒有例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  if (check('[被前車擋住] G0 班表裡找得到一段 hold 連續長 20 秒以上、又不在停站的車，而且在跟那班車的頁上重現', !!holdPick,
    `候選 ${holdCands.length} 段；試過 ${tried.join('、') || '（無）'}`)) {
    const from = holdPick.from - 10, to = Math.min(holdPick.to, holdPick.from + 60) + 10;
    const { context, page, errors, source } = holdOpen;
    const tag = `[${holdPick.train}/被前車擋住/實體股道]`;
    check(`${tag} G0 位置來源確實是實體股道`, source.covers);
    await replayHolds(page, holdPick.scanFrom, from);
    await holdRun(page, tag, { from, to, mult: 5, pause: true, minFrames: 100, minBit: 30 });
    // 高倍率一幀推進 2 模擬秒以上（手機省電跟車約 30 fps、開 60× 就是一幀 2 秒）：面板仍要找得到前一幀
    await replayHolds(page, holdPick.scanFrom, from); // 上一輪跑完再撥回 from 是倒轉，hold 會直接對齊、歷史就沒了
    await holdRun(page, `${tag}[高倍率]`, { from, to, mult: 150, pause: false, minFrames: 15, minBit: 5, minStep: 2 });
    check(`${tag} 頁面沒有例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (failures.length) {
  console.log(`\n❌ ${failures.length}/${assertions} 條斷言失敗：`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`\n✅ ${assertions} 條斷言全過`);
