// 跟車面板的時速與「停靠／行進中」要跟地圖上的車同源（2026-10-14 錄影回報）。
//
// 回報：?train=4172&t=12:09 讓時鐘 1× 走，地圖上的車到表定 12:10:00 才離開福隆，左側面板卻從
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
// MUTATE=1 時速改回「現在→20 秒後」；MUTATE=2 停靠判準加回剩 3 秒就收掉；MUTATE=3 倒數改回四捨五入。
// 突變各自應該紅；正常驗收勿帶。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const MUTATE = process.env.MUTATE || '';
const PIN_DATE = Date.parse('2026-10-14T11:00:00+08:00'); // 回報當天（週三）

const MUTATIONS = {
  1: ['const pa = trainPos(tr, state.simSec - FP_SPEED_DT_SEC), pb = trainPos(tr, state.simSec);\n'
      + '  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / FP_SPEED_DT_SEC * 3600, speedCapOf(tr)) : 0;',
      'const pa = trainPos(tr, state.simSec), pb = trainPos(tr, state.simSec + 20);\n'
      + '  const kmh = (pa && pb) ? Math.min(haversineKm(pa, pb) / 20 * 3600, speedCapOf(tr)) : 0;'],
  2: ['return dw && dw.st.stop !== false && dw.total >= 20 ? dw : null;',
      'return dw && dw.st.stop !== false && dw.remain > 3 && dw.total >= 20 ? dw : null;'],
  3: ['const left = Math.ceil(dw.remain), mm = Math.floor(left / 60), ss = left % 60;',
      'const mm = Math.floor(dw.remain / 60), ss = Math.round(dw.remain % 60);'],
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
    const { context, page, errors, source } = await openFollow(`train=4172&t=12:09${mode.q}`, mode);
    const tag = `[4172/${mode.name}]`;
    check(`${tag} G0 位置來源確實是${mode.name}（物理模型 loaded=${source.loaded} covers=${source.covers}）`,
      mode.physical ? source.covers : !source.loaded);
    const fulong = await stopOf(page, '福隆'), shicheng = await stopOf(page, '石城');
    const ok = check(`${tag} G0 4172 有福隆、石城兩個 20 秒以上的停靠`,
      [fulong, shicheng].every(s => s && s.stop !== false && s.dep - s.arr >= 20), JSON.stringify({ fulong, shicheng }));
    if (ok) {
      await sweepStop(page, `${tag} 福隆`, fulong);
      await sweepStop(page, `${tag} 石城`, shicheng);
      if (mode.physical) {
        await realClock(page, `${tag} 福隆`, fulong);
        await journeyLog(page, tag, shicheng);
      }
    }
    check(`${tag} 頁面沒有例外`, errors.length === 0, errors.slice(0, 3).join(' | '));
    await context.close();
  }

  // 反方向（北上經石城→福隆）挑一班在這段有 20 秒以上停靠的車
  const scout = await openFollow('train=4172&t=12:09', { physical: false });
  const pick = await scout.page.evaluate(() => {
    for (const tr of state.trains) {
      if (tr.sys !== 'tra_sched' || tr.loop) continue;
      const a = tr.stops.findIndex(s => s.name === '石城'), b = tr.stops.findIndex(s => s.name === '福隆');
      if (a < 1 || b <= a) continue;
      for (const i of [a, b]) {
        const s = tr.stops[i];
        if (s.stop !== false && s.depSec - s.arrSec >= 20 && s.depSec - s.arrSec <= 120 && s.arrSec > 8 * 3600 && s.arrSec < 20 * 3600)
          return { train: String(tr.train), name: s.name, arr: s.arrSec };
      }
    }
    return null;
  });
  await scout.context.close();
  if (check('[反方向] G0 找得到一班北上經石城→福隆、在其中一站停 20 秒以上的車', !!pick)) {
    const hm = Math.floor((pick.arr - 60) / 60);
    const query = `train=${pick.train}&t=${String(Math.floor(hm / 60)).padStart(2, '0')}:${String(hm % 60).padStart(2, '0')}`;
    const { context, page, errors, source } = await openFollow(query, { physical: true });
    const tag = `[${pick.train}/北上/實體股道]`;
    check(`${tag} G0 位置來源確實是實體股道`, source.covers);
    await sweepStop(page, `${tag} ${pick.name}`, await stopOf(page, pick.name));
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
