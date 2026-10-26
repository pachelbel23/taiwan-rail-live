// 路段懸賞後端驗收：雲端搭乘 POST /api/cloud-ride（v3：每一次入帳點數）。
// 離線：假 D1（scripts/d1_local.mjs，真 SQLite）＋ stub ASSETS（班表檔讀 data/、或換成合成的）＋ BOUNTY_NOW 釘死；不起伺服器、不碰網路。
// 跑法：node scripts/verify_bounty_cloud.mjs
//
// 期望值全部寫死在這裡，不呼叫實作（連 scripts/bounty_chips_core.mjs 都不呼叫）去產生期望：
//   ・產品規則（v3 點數）：捷運不列入懸賞；一趟至少 10 分鐘；雲端搭乘每一次（模擬器除外）入帳 20 點；錄程每日上限 500 點（雲端不占）。
//   ・其餘數字（雲端搭乘連續 600 秒算 1 次、每日最多 1 次）來自 data/bounty_rules.json 的 chips.cloud，這裡照抄成字面。
//   ・v2 是「3 次換 1 顆籌碼」：上線前搭了、還沒湊滿的零頭不補，v2 留下的半套搭乘（搭乘列在、籌碼沒發）重送也不補（S2、S4）。
// 每一條判準寫的時候都先答「哪一筆輸入能讓它變紅」——答不出來的判準等於沒有判準。
//
// ⚠️ 假 D1 的保真度：scripts/d1_local.mjs 的 batch() 是排隊序列化的，但 batch 之外的單句寫入
//    可以插進另一個 batch 的交易中間；真的 D1 不會這樣。所以 S 組「兩個併發的請求」只證明「序列化之後的
//    各種交錯」是安全的，證明不了真 D1 的行為。上線後要對正式庫做一次唯讀抽查（同一營運日兩列、
//    重複的雲端籌碼 ref）。
//
// 身分與授權收緊之後：雲端搭乘會發點數、點數可以花，所以已併進帳號的裝置、或帳號（uid）本身送搭乘，
// 都必須帶該帳號的 Bearer（G4）。P1a 原本拿 `Authorization: Bearer plus-token` 當「通行證標頭」的替身，
// 現在 Bearer 是真的身分憑證（會被驗），所以替身換成 x-plus-token 系列標頭——被驗的東西不變（通行證與結果無關）。
// 身分規則本身的驗收在 scripts/verify_bounty_auth.mjs。
//
// 分組：C 基本規則與冪等　S 點數入帳（模擬器、v2 留下的狀態、併發、合併後重送）　T 車次驗證與時間窗（合成班表，逐邊界）
//       X 四種系統各一個成功案例（讀真班表檔）　G 閘門與路由　P 通行證欄位不影響結果　D 白名單與 SYS_DEFS 對得上
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import worker, { _bounty } from '../worker.js';
import { openTestDb } from './d1_local.mjs';

console.log(`[G0] worker.js md5=${createHash('md5').update(readFileSync(new URL('../worker.js', import.meta.url))).digest('hex')}`);

globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
// 對外連線偵測：雲端搭乘只該讀寫 D1 與讀 ASSETS，不該打任何外部服務（不驗 Firebase、不查通行證）。
const outbound = [];
globalThis.fetch = async (u) => { outbound.push(String(u)); throw new Error('offline: ' + String(u)); };

const RULES = JSON.parse(readFileSync('data/bounty_rules.json', 'utf8'));
const R = [];
const ok = (n, p, msg = '') => { R.push({ n, p }); console.log(`${p ? '  ok ' : 'FAIL '} ${n}${msg ? ' — ' + msg : ''}`); };
// 例外也要記成 FAIL（而不是讓整支腳本崩潰、後面的判準全部沒跑）：突變時「紅」有兩種長相——斷言為假、或流程直接丟例外。
const attempt = async (name, fn) => {
  try { await fn(); }
  catch (e) { ok(`${name}（流程丟例外）`, false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')); }
};
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x))
  ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x);
const same = (a, b) => canon(a) === canon(b);

// ── 固定的世界 ─────────────────────────────────────────────────────────────
const NOW_MS = Date.parse('2026-07-29T08:00:00Z');          // 台北 2026-07-29 16:00（週三）
const TODAY = '2026-07-29', YESTERDAY = '2026-07-28', DAY_BEFORE = '2026-07-27', TOMORROW = '2026-07-30';
// 台北該日 00:00 的 epoch 毫秒。這裡自己寫一份（不呼叫 worker 的），才不會跟被驗的實作同源。
const t0 = day => Date.parse(day + 'T00:00:00Z') - 8 * 3600e3;
const at = (day, h, m = 0, s = 0) => t0(day) + ((h * 60 + m) * 60 + s) * 1000;        // h 可以 ≥ 24（跨午夜的營運日）
const APP = { platform: 'ios', app: '1.6.13', simulator: false };
const SIM = { platform: 'ios', app: '1.6.13', simulator: true };
const limiter = blocked => ({ limit: async () => ({ success: !blocked }) });

// 合成的台鐵班表（形狀同 data/tra_widget_schedule.json：dates[日期]＝當日開行的 trains 索引；
// trains[i]＝[車次, 車種, [[站索引, 秒, 停站秒, 旗標],…]]，秒是距營運日台北 00:00 的秒、跨午夜的班次會超過 86400）。
//   0：今天的 101（10:00–11:00）　1：昨天的 102（25:00–26:00，跨午夜）　2：昨天的 101（另一個版本 13:53–14:43）
const TRA_FIX = { dates: { [TODAY]: [0], [YESTERDAY]: [1, 2] }, trains: [
  ['101', '自強', [[1, 36000, 60, 1], [2, 39600, 60, 1]]],
  ['102', '區間', [[1, 90000, 60, 1], [2, 93600, 60, 1]]],
  ['101', '自強', [[1, 50000, 60, 1], [2, 53000, 60, 1]]],
] };
// 合成的高鐵逐日班表 blob（形狀同 kv_blobs 的 thsr_sched：{fetchedAt, days:{YYYYMMDD: 文件}, _meta}）：只有今天，0101 跑 10:00–11:00
const THSR_BLOB = { fetchedAt: '2026-07-29T00:00:00Z', days: { '20260729': { trains: [
  { train: '0101', stops: [{ name: 'A', order: 1, arrSec: 36000, depSec: 36000, stop: true }, { name: 'B', order: 2, arrSec: 39600, depSec: 39600, stop: true }] },
  // 殘缺的兩班（測試專用，真資料的每一站都有 arrSec／depSec）：首站沒有 arrSec、末站沒有 depSec——算不出時間窗，不能當萬用通行
  { train: '0199', stops: [{ name: 'A', order: 1, depSec: 36000, stop: true }, { name: 'B', order: 2, arrSec: 39600, depSec: 39600, stop: true }] },
  { train: '0198', stops: [{ name: 'A', order: 1, arrSec: 36000, depSec: 36000, stop: true }, { name: 'B', order: 2, arrSec: 39600, stop: true }] },
] } }, _meta: {} };

const memo = {};
const REAL = name => (memo[name] = memo[name] || JSON.parse(readFileSync('data/' + name, 'utf8')));

// 一個獨立的世界：全新的 D1、規則與班表資產替身、釘死的時鐘。
//   files：檔名→物件（覆蓋 data/ 下的真檔）；missing：這些檔一律回 404（模擬資產讀不到）。
//   w.sql 記下每一句 prepare 過的 SQL（證明「被擋掉的請求沒有碰 D1」「沒有查通行證表」）。
function world(over = {}) {
  const { db, DELAY_DB } = openTestDb(over.seed || '');
  const w = { db, sql: [] };
  const DB = {
    prepare: s => { w.sql.push(s); return DELAY_DB.prepare(s); },
    exec: s => DELAY_DB.exec(s),
    batch: st => DELAY_DB.batch(st),
  };
  const ASSETS = { fetch: async r => {
    const name = new URL(String(r.url)).pathname.replace(/^\/data\//, '');
    if ((over.missing || []).includes(name)) return new Response('nf', { status: 404 });
    if (over.files && over.files[name] !== undefined) return new Response(JSON.stringify(over.files[name]), { status: 200 });
    if (name === 'bounty_rules.json') return new Response(JSON.stringify(over.rules || RULES), { status: 200 });
    return existsSync('data/' + name) ? new Response(JSON.stringify(REAL(name)), { status: 200 }) : new Response('nf', { status: 404 });
  } };
  w.env = { DELAY_DB: DB, ASSETS, BOUNTY_LIMITER: limiter(false), BOUNTY_NOW: String(over.now || NOW_MS), ...(over.env || {}) };
  w.at = ms => { w.env.BOUNTY_NOW = String(ms); };        // 把這個世界的時鐘撥到某個時刻
  return w;
}

// ── 呼叫端 ─────────────────────────────────────────────────────────────────
const ALL = [];
const req = (path, init) => new Request('https://railisland.tw' + path, init);
const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
async function fin(res) { const text = await res.text(); ALL.push(text); return { status: res.status, text, json: parse(text) }; }
async function call(fn, request, env) { _bounty.bountyResetMemCaches(); return fin(await fn(request, env)); }
const post = (b, hdr = {}, method = 'POST') => req('/api/cloud-ride', {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...hdr },
  ...(method === 'GET' ? {} : { body: typeof b === 'string' ? b : JSON.stringify(b) }) });
const ride = (w, b, hdr) => call(_bounty.cloudRide, post(b, hdr), w.env);
const me = (w, actor) => call(_bounty.chipsMe, req('/api/chips-me?actor=' + actor), w.env);
// Firebase 替身：只在 fn 執行期間換掉 fetch（其餘時間仍是「一律丟例外」），呼叫記在 calls、不記進 outbound——
// outbound 專門抓「不該有的對外連線」（P1c／D2b 要求它全程為 0）。uid＝驗過會回的 uid，null＝Firebase 說 token 無效。
async function withFirebase(uid, fn) {
  const saved = globalThis.fetch, calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u));
    return uid ? new Response(JSON.stringify({ users: [{ localId: uid }] }), { status: 200 }) : new Response('{}', { status: 400 }); };
  try { return { out: await fn(), calls }; } finally { globalThis.fetch = saved; }
}
let rid = 0;
const nextReq = () => 'req-' + String(++rid).padStart(6, '0');                        // 10 字元，過 8–64 的字元集規則
// 預設是「今天的 101，09:40 上車、連續 600 秒」——合成班表裡 101 今天 10:00 開，窗從 09:30 起
const rb = (o = {}) => ({ actor: 'dev-cloud-0001', day: TODAY, trainKey: 'tra_sched|101', startedAt: at(TODAY, 9, 40), sec: 600,
  requestId: nextReq(), client: APP, ...o });
// 捷運的搭乘（窗是營運時段 05:00–次日 01:30，與班表無關）：某天 09:00 上車
const mb = (day, o = {}) => ({ actor: 'dev-cloud-0001', day, trainKey: 'mrt|BR|veh-0001', startedAt: at(day, 9), sec: 600,
  requestId: nextReq(), client: APP, ...o });

// ── 讀庫（一律自己寫 SQL）────────────────────────────────────────────────────
const q = {
  rides: (w, a) => w.db.prepare('SELECT actor,day,train_key,sec,request_id,created_at,simulator FROM cloud_rides WHERE actor=? ORDER BY day').all(a).map(r => ({ ...r })),
  nRides: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM cloud_rides WHERE actor=?').get(a).c,
  cloudLedger: (w, a) => w.db.prepare("SELECT id,actor,kind,delta,ref,day,created_at,unit FROM chip_ledger WHERE actor=? AND kind='cloud' ORDER BY ref").all(a).map(r => ({ ...r })),
  nLedger: (w, a) => w.db.prepare('SELECT COUNT(*) c FROM chip_ledger WHERE actor=?').get(a).c,
  bal: (w, a) => w.db.prepare('SELECT COALESCE(SUM(delta),0) n FROM chip_ledger WHERE actor=?').get(a).n,
};
// v2 發的雲端籌碼列（unit='chip'，ref 是 v2 的 <actor>|cloud|N）
const seedV2Chip = (w, actor, n, day) => w.db.prepare("INSERT INTO chip_ledger (id,actor,kind,delta,ref,day,created_at,unit) VALUES (?,?,'cloud',1,?,?,?,'chip')")
  .run(`cloud|${actor}|cloud|${n}`, actor, `${actor}|cloud|${n}`, day, NOW_MS - 9000);
// 一筆 v3 入帳列應有的樣子（期望值自己組，不讀實作）
const payRow = (actor, requestId, day, at) => ({ id: `cloud|${actor}.${requestId}`, actor, kind: 'cloud', delta: 20, ref: `${actor}.${requestId}`, day, created_at: at, unit: 'point' });
const seedRide = (w, actor, day, o = {}) => w.db.prepare('INSERT INTO cloud_rides (actor,day,train_key,sec,request_id,created_at,simulator) VALUES (?,?,?,?,?,?,?)')
  .run(actor, day, o.trainKey || 'mrt|BR|seed', o.sec || 700, o.requestId === undefined ? null : o.requestId, o.at ?? NOW_MS - 1000, o.simulator ? 1 : 0);

// ═══ C 組：基本規則與冪等（合成台鐵班表）═══════════════════════════════════════
// C1 600 秒剛好夠：200、rides 1、這一次入帳 20 點；庫裡一列，欄位逐一核對
await attempt('C1', async () => {
  const A = 'dev-c1aaaa01';
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const b = rb({ actor: A });
  const r = await ride(w, b);
  ok('C1a 600 秒（正好門檻）→ 200，回應六個欄位一個不多：{ok, day, rides:1, toNextChip:1, chipAwarded:true, points:20}',
    r.status === 200 && same(r.json, { ok: true, day: TODAY, rides: 1, toNextChip: 1, chipAwarded: true, points: 20 }), r.text);
  const rows = q.rides(w, A);
  ok('C1b 庫裡恰好一列，欄位逐一對：actor／day／trainKey／sec／requestId／created_at＝時鐘／simulator 0',
    rows.length === 1 && same(rows[0], { actor: A, day: TODAY, train_key: 'tra_sched|101', sec: 600, request_id: b.requestId, created_at: NOW_MS, simulator: 0 }),
    JSON.stringify(rows));
  ok('C1c 第 1 次就入帳：帳本恰一列 cloud（delta 20、unit point、ref＝<actor>.<requestId>、id＝cloud|<ref>、day＝營運日、created_at＝時鐘），餘額 20',
    same(q.cloudLedger(w, A), [payRow(A, b.requestId, TODAY, NOW_MS)]) && q.nLedger(w, A) === 1 && q.bal(w, A) === 20, JSON.stringify(q.cloudLedger(w, A)));
});

// C2 599 秒差一秒 → 400 too_short，且零寫入（600 通過與 599 被擋是一對，缺一邊「一律 400」也會過）
await attempt('C2', async () => {
  const A = 'dev-c2aaaa01';
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const r = await ride(w, rb({ actor: A, sec: 599 }));
  ok('C2 599 秒 → 400 too_short 且零寫入', r.status === 400 && r.json && r.json.error === 'too_short' && q.nRides(w, A) === 0, r.text);
  const r0 = await ride(w, rb({ actor: A, sec: 600 }));
  ok('C2b 同一個人改成 600 秒 → 200（前一筆被擋沒有占掉當天那一格）', r0.status === 200 && q.nRides(w, A) === 1, r0.text);
});

// C3 同一天換一個 requestId 再送 → 409 already_today；庫裡仍是第一筆（requestId 沒被蓋掉）
await attempt('C3', async () => {
  const A = 'dev-c3aaaa01';
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const b1 = rb({ actor: A });
  await ride(w, b1);
  const r2 = await ride(w, rb({ actor: A }));
  const rows = q.rides(w, A);
  ok('C3 同一天第二次（不同 requestId）→ 409 already_today，庫裡仍是第一筆',
    r2.status === 409 && r2.json.error === 'already_today' && rows.length === 1 && rows[0].request_id === b1.requestId, r2.text + JSON.stringify(rows));
  // 昨天是另一個營運日，不受今天那一格影響：用昨天的 102（跨午夜）
  const r3 = await ride(w, rb({ actor: A, day: YESTERDAY, trainKey: 'tra_sched|102', startedAt: at(YESTERDAY, 25, 5) }));
  ok('C3b 換成昨天的營運日照樣收（每日 1 次押的是 (actor, day) 不是 actor）', r3.status === 200 && r3.json.rides === 2 && q.nRides(w, A) === 2, r3.text);
});

// C4 同一個 requestId 重送 → 200、與第一次同形狀、庫裡仍一列；回應形狀含 chipAwarded／rides／toNextChip
await attempt('C4', async () => {
  const A = 'dev-c4aaaa01';
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const b = rb({ actor: A });
  const r1 = await ride(w, b), r2 = await ride(w, b);
  ok('C4 同一個 requestId 重送 → 兩次都 200 且回應完全一樣（points 20）、庫裡仍一列、帳本仍一列 20',
    r1.status === 200 && r2.status === 200 && same(r1.json, r2.json) && r2.json.points === 20 && q.nRides(w, A) === 1 && q.nLedger(w, A) === 1 && q.bal(w, A) === 20,
    r1.text + ' / ' + r2.text);
  // 同一個 requestId 拿去送另一個營運日 → 409 conflict（重送必須是「一模一樣的那一筆」）
  const rc = await ride(w, { ...b, day: YESTERDAY, trainKey: 'tra_sched|102', startedAt: at(YESTERDAY, 25, 5) });
  ok('C4b 同一個 requestId 送了別的營運日 → 409 conflict 且沒有多寫', rc.status === 409 && rc.json.error === 'conflict' && q.nRides(w, A) === 1, rc.text);
  // requestId 是「每個人自己的」：另一個人用同一個字串不受影響
  const rOther = await ride(w, { ...b, actor: 'dev-c4bbbb01' });
  ok('C4c 另一個人用同一個 requestId 字串 → 照常 200 且各自一列（去重鍵是 (actor, requestId)）',
    rOther.status === 200 && rOther.json.rides === 1 && q.nRides(w, 'dev-c4bbbb01') === 1 && q.nRides(w, A) === 1, rOther.text);   // rides＝各自的次數（不把別人的搭乘算進來）
});

// C5 併發：兩個同時抵達的請求。同一個 requestId＝兩個都 200 且只有一列；不同 requestId＝一個 200 一個 409 且只有一列
await attempt('C5', async () => {
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const A = 'dev-c5aaaa01', B = 'dev-c5bbbb01';
  const bA = rb({ actor: A });
  const [a1, a2] = await Promise.all([ride(w, bA), ride(w, bA)]);
  ok('C5a 同一個 requestId 併發兩發 → 都 200、回應相同、只有一列', a1.status === 200 && a2.status === 200 && same(a1.json, a2.json) && q.nRides(w, A) === 1,
    a1.text + ' / ' + a2.text);
  const bB1 = rb({ actor: B }), bB2 = rb({ actor: B });
  const [b1, b2] = await Promise.all([ride(w, bB1), ride(w, bB2)]);
  const st = [b1.status, b2.status].sort();
  const winId = b1.status === 200 ? bB1.requestId : bB2.requestId;
  ok('C5b 不同 requestId 併發兩發 → 恰好一個 200 一個 409 already_today、庫裡只有一列（主鍵＋讀回擋下輸的那個）；'
    + '帳本恰 1 列 20 點、ref 是贏的那一筆（輸的那個不入帳）',
    st[0] === 200 && st[1] === 409 && [b1, b2].filter(x => x.status === 409)[0].json.error === 'already_today' && q.nRides(w, B) === 1 &&
      same(q.cloudLedger(w, B).map(x => x.ref), [`${B}.${winId}`]) && q.bal(w, B) === 20,
    b1.text + ' / ' + b2.text + ' ' + JSON.stringify(q.cloudLedger(w, B)));
});

// C6 拒收的形狀：座標、沒帶 client、網頁 client、日期、時間、秒數、requestId、actor、壞 JSON——每一種都零寫入
await attempt('C6', async () => {
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const A = 'dev-c6aaaa01';
  const want = async (name, b, status, error, hdr) => {
    const before = q.nRides(w, A);
    const r = await ride(w, b, hdr);
    ok(`C6 ${name} → ${status} ${error}，零寫入`, r.status === status && r.json && r.json.error === error && q.nRides(w, A) === before, r.text);
  };
  await want('帶 lat', { ...rb({ actor: A }), lat: 25.05 }, 400, 'coordinates_not_accepted');
  await want('巢狀的 lon', { ...rb({ actor: A }), extra: { lon: 121.5 } }, 400, 'coordinates_not_accepted');
  await want('沒帶 client', (() => { const b = rb({ actor: A }); delete b.client; return b; })(), 400, 'app_only');
  await want('client.platform 是 web', rb({ actor: A, client: { platform: 'web', app: '1', simulator: false } }), 400, 'app_only');
  await want('client 不是物件', rb({ actor: A, client: 'ios' }), 400, 'app_only');
  await want('前天（超出今天／昨天）', rb({ actor: A, day: DAY_BEFORE }), 400, 'bad_day');
  await want('明天', rb({ actor: A, day: TOMORROW }), 400, 'bad_day');
  await want('日期不是字串', rb({ actor: A, day: 20260729 }), 400, 'bad_day');
  await want('日期形狀不對', rb({ actor: A, day: '2026/07/29' }), 400, 'bad_day');
  await want('startedAt 不是整數', rb({ actor: A, startedAt: 'yesterday' }), 400, 'bad_time');
  await want('startedAt 是小數', rb({ actor: A, startedAt: at(TODAY, 9, 40) + 0.5 }), 400, 'bad_time');
  await want('sec 不是整數', rb({ actor: A, sec: 600.5 }), 400, 'bad_sec');
  await want('sec 是負數', rb({ actor: A, sec: -1 }), 400, 'bad_sec');
  await want('sec 超過一整天', rb({ actor: A, sec: 86401 }), 400, 'bad_sec');
  await want('沒有 requestId', (() => { const b = rb({ actor: A }); delete b.requestId; return b; })(), 400, 'bad_request_id');
  await want('requestId 太短', rb({ actor: A, requestId: 'abc' }), 400, 'bad_request_id');
  await want('requestId 有空白', rb({ actor: A, requestId: 'req 000001' }), 400, 'bad_request_id');
  await want('actor 太短', rb({ actor: 'short' }), 400, 'bad_actor');
  await want('壞 JSON', '{not json', 400, 'bad_json');
  await want('body 是 null', 'null', 400, 'bad_actor');
});

// C7 搭乘不能發生在未來：結束時間＝startedAt＋sec×1000 不可晚於「現在＋60 秒」；邊界兩側各一點
await attempt('C7', async () => {
  const w = world({});
  // 用捷運的窗（05:00–25:30，16:00 上下都在窗內），把班表排除在外，只量時間上界
  const endEq = NOW_MS + 60000, endLate = NOW_MS + 60001;
  const rEq = await ride(w, mb(TODAY, { actor: 'dev-c7aaaa01', startedAt: endEq - 600000 }));
  const rLate = await ride(w, mb(TODAY, { actor: 'dev-c7bbbb01', startedAt: endLate - 600000 }));
  ok('C7a 結束時間＝現在＋60 秒（邊界）→ 200；差 1 毫秒＝現在＋60.001 秒 → 400 bad_time 且零寫入',
    rEq.status === 200 && rLate.status === 400 && rLate.json.error === 'bad_time' && q.nRides(w, 'dev-c7bbbb01') === 0, rEq.text + ' / ' + rLate.text);
  const rFuture = await ride(w, mb(TODAY, { actor: 'dev-c7cccc01', startedAt: NOW_MS + 3600e3 }));
  ok('C7b 一個小時後才開始的搭乘 → 400 bad_time', rFuture.status === 400 && rFuture.json.error === 'bad_time', rFuture.text);
});

// ═══ S 組：點數入帳 ═══════════════════════════════════════════════════════════
// 多個營運日各一次（時鐘撥到各日 16:00），用捷運的窗（不依賴班表）。期望值：每一次（模擬器除外）都入帳 20 點。
// S1 三天各 1 次：rides 依序 1、2、3；每一次都 points 20；帳本三列各自的 ref；chips-me 餘額 60
await attempt('S1', async () => {
  const A = 'dev-s1aaaa01';
  const w = world({});
  const outs = [], bs = [];
  for (const day of [DAY_BEFORE, YESTERDAY, TODAY]) { w.at(at(day, 16)); const b = mb(day, { actor: A }); bs.push(b); outs.push(await ride(w, b)); }
  ok('S1a 三天各一次：rides 1→2→3、toNextChip 一律 1、chipAwarded 一律真、points 一律 20',
    outs.every(o => o.status === 200) &&
    same(outs.map(o => [o.json.rides, o.json.toNextChip, o.json.chipAwarded, o.json.points]), [[1, 1, true, 20], [2, 1, true, 20], [3, 1, true, 20]]), outs.map(o => o.text).join(' | '));
  const led = q.cloudLedger(w, A);
  const want = [DAY_BEFORE, YESTERDAY, TODAY].map((d, i) => payRow(A, bs[i].requestId, d, at(d, 16))).sort((x, y) => (x.ref < y.ref ? -1 : 1));
  ok('S1b 帳本三列 kind=cloud：各 20 點、unit point、ref＝<actor>.<各自的 requestId>、day＝各自的營運日、created_at＝各自的時鐘',
    same(led, want), JSON.stringify(led));
  const m = await me(w, A);
  ok('S1c chips-me：balance 60、cloud {rides 3, toNextChip 1, points 20}；雲端點數不占錄程每日上限（today.chips 仍 0）',
    m.status === 200 && m.json.balance === 60 && same(m.json.cloud, { rides: 3, toNextChip: 1, points: 20 }) && same(m.json.today, { chips: 0, cap: 500 }), m.text);
});

// S2 v2 留下的狀態：還沒湊滿 3 次的零頭不補；已經發過的 v2 雲端籌碼不影響 v3 這一次入帳
await attempt('S2', async () => {
  const A = 'dev-s2aaaa01';
  const w = world({});
  seedRide(w, A, '2026-07-20'); seedRide(w, A, '2026-07-21');               // v2：2 次、還沒換到籌碼
  const r = await ride(w, mb(TODAY, { actor: A }));
  ok('S2a 庫裡 2 筆 v2 搭乘（零頭）＋v3 的這一次 → rides 3、points 20；帳本只有這一次的 1 列（不補 v2 的「3 次換 1 顆」）、餘額 20',
    r.status === 200 && r.json.rides === 3 && r.json.points === 20 && q.cloudLedger(w, A).length === 1 && q.bal(w, A) === 20, r.text + ' ' + JSON.stringify(q.cloudLedger(w, A)));
  const B = 'dev-s2bbbb01', w2 = world({});
  for (const d of ['2026-07-20', '2026-07-21', '2026-07-22']) seedRide(w2, B, d);
  seedV2Chip(w2, B, 1, '2026-07-22');                                         // v2：3 次換到的 1 顆
  const r2 = await ride(w2, mb(TODAY, { actor: B }));
  const m2 = await me(w2, B);
  ok('S2b 已有 v2 的 3 次＋1 顆雲端籌碼 → v3 第 4 次照入 20 點（不看「已得」）；chips-me 餘額 70（1 顆×50＋20）',
    r2.status === 200 && r2.json.rides === 4 && r2.json.points === 20 && q.cloudLedger(w2, B).length === 2 && m2.json.balance === 70, r2.text + ' ' + m2.text);
});

// S3 模擬器：照寫、不算、不入帳。三次模擬器搭乘後：庫裡 3 列（simulator=1）、帳本 0 列、chips-me cloud.rides 0
await attempt('S3', async () => {
  const A = 'dev-s3aaaa01';
  const w = world({});
  const outs = [];
  for (const day of [DAY_BEFORE, YESTERDAY, TODAY]) { w.at(at(day, 16)); outs.push(await ride(w, mb(day, { actor: A, client: SIM }))); }
  ok('S3a 模擬器三次：都 200，回應的 rides 一直是 0、toNextChip 1、chipAwarded 假、points 0',
    outs.every(o => o.status === 200 && same(o.json, { ok: true, day: o.json.day, rides: 0, toNextChip: 1, chipAwarded: false, points: 0 })), outs.map(o => o.text).join(' | '));
  const rows = q.rides(w, A);
  ok('S3b 庫裡照寫 3 列且都 simulator=1；帳本 0 列、餘額 0', rows.length === 3 && rows.every(r => r.simulator === 1) && q.nLedger(w, A) === 0 && q.bal(w, A) === 0, JSON.stringify(rows));
  const m = await me(w, A);
  ok('S3c chips-me 的 cloud.rides 排除模擬器（0）、toNextChip 1、balance 0', m.json.balance === 0 && same(m.json.cloud, { rides: 0, toNextChip: 1, points: 20 }), m.text);
  // 模擬器那天已經占掉那一格：同一天真機再送 → 409（PK (actor, day)）
  const r = await ride(w, mb(TODAY, { actor: A, client: APP }));
  ok('S3d 模擬器的搭乘占掉當天那一格：同一天真機再送 → 409 already_today', r.status === 409 && r.json.error === 'already_today', r.text);
  // 混合：模擬器 1 次＋真機 2 次在庫裡，再送 1 次真機 → rides 3（模擬器那次不算進次數）、入帳 20
  const B = 'dev-s3bbbb01', w2 = world({});
  seedRide(w2, B, '2026-07-25', { simulator: true }); seedRide(w2, B, '2026-07-26'); seedRide(w2, B, DAY_BEFORE);
  w2.at(at(YESTERDAY, 16));
  const m1 = await ride(w2, mb(YESTERDAY, { actor: B }));
  ok('S3e 混合：1 筆模擬器＋2 筆真機在庫裡，再送 1 筆真機 → rides 3、points 20（模擬器那筆不算進次數）',
    m1.status === 200 && m1.json.rides === 3 && m1.json.points === 20 && q.cloudLedger(w2, B).length === 1, m1.text);
});

// S4 v2 留下的半套搭乘（搭乘列寫進去、結算前失敗）：v3 的重送回 200 但不補入帳（v3 的搭乘與入帳同一筆交易，不會再有半套）
await attempt('S4', async () => {
  const A = 'dev-s4aaaa01';
  const w = world({});
  seedRide(w, A, '2026-07-20'); seedRide(w, A, '2026-07-21');
  seedRide(w, A, TODAY, { requestId: 'req-heal001', at: NOW_MS });
  const b = mb(TODAY, { actor: A, requestId: 'req-heal001' });
  const r1 = await ride(w, b), r2 = await ride(w, b);
  ok('S4 v2 半套的那一筆重送兩次：都 200、rides 3、chipAwarded 假、points 0；帳本 0 列（不補）',
    [r1, r2].every(r => r.status === 200 && r.json.rides === 3 && r.json.chipAwarded === false && r.json.points === 0) && q.nLedger(w, A) === 0, r1.text + ' / ' + r2.text);
});

// S5 正常送出後重送：回應要與第一次相同（第一次的回應掉了，客戶端重送要拿到同樣的答案）
await attempt('S5', async () => {
  const A = 'dev-s5aaaa01';
  const w = world({});
  const b = mb(TODAY, { actor: A });
  const first = await ride(w, b), again = await ride(w, b);
  ok('S5a 重送：兩次回應相同（points 20、rides 1），帳本仍 1 列', first.json.points === 20 && same(first.json, again.json) && q.cloudLedger(w, A).length === 1, first.text + ' / ' + again.text);
  // 更早的一次在後來又搭了兩次之後重送：回的是它自己那一次的 20 點，不是加總、也不是 0
  const w3 = world({});
  const C = 'dev-s5cccc01';
  const o1 = mb(DAY_BEFORE, { actor: C }), o2 = mb(YESTERDAY, { actor: C }), o3 = mb(TODAY, { actor: C });
  w3.at(at(DAY_BEFORE, 16)); await ride(w3, o1); w3.at(at(YESTERDAY, 16)); await ride(w3, o2); w3.at(at(TODAY, 16)); await ride(w3, o3);
  w3.at(at(TODAY, 17));
  const late2 = await ride(w3, o2);      // 第 2 次的請求重送（昨天）
  ok('S5b 後來又搭了一次之後，昨天那筆重送：200、points 20（它自己那一次）、rides 3；帳本仍 3 列',
    late2.status === 200 && late2.json.points === 20 && late2.json.rides === 3 && q.cloudLedger(w3, C).length === 3, late2.text);
});

// S6 併發：昨天與今天兩筆同時抵達（同一個時鐘、同一毫秒）——兩邊各入帳 20，各自的回應只算自己那一筆
await attempt('S6', async () => {
  const A = 'dev-s6aaaa01';
  const w = world({});
  seedRide(w, A, '2026-07-20');
  const [r1, r2] = await Promise.all([ride(w, mb(YESTERDAY, { actor: A })), ride(w, mb(TODAY, { actor: A }))]);
  ok('S6 兩筆併發：都 200、都 points 20（不是 40——同一毫秒的兩筆入帳不能互相算進對方的回應）、帳本恰 2 列、餘額 40',
    r1.status === 200 && r2.status === 200 && r1.json.points === 20 && r2.json.points === 20 && q.cloudLedger(w, A).length === 2 && q.bal(w, A) === 40,
    r1.text + ' / ' + r2.text);
});

// S7 同一個 requestId 併發重送：搭乘一列、入帳一列，兩個回應相同
await attempt('S7', async () => {
  const A = 'dev-s7aaaa01';
  const w = world({});
  const b = mb(TODAY, { actor: A });
  const [r1, r2] = await Promise.all([ride(w, b), ride(w, b)]);
  ok('S7 同一個 requestId 同時送兩次 → 都 200、回應相同（points 20）；搭乘 1 列、帳本 1 列、餘額 20',
    r1.status === 200 && r2.status === 200 && same(r1.json, r2.json) && r1.json.points === 20 && q.nRides(w, A) === 1 && q.cloudLedger(w, A).length === 1 && q.bal(w, A) === 20,
    r1.text + ' / ' + r2.text);
});

// S8 合併之後的重送：搭乘列與入帳列都搬到帳號（只改 actor，ref 不動），舊裝置帶帳號的 Bearer 重送同一個 requestId
await attempt('S8', async () => {
  const D = 'dev-s8aaaa01', U = 'uid-s8acct0001';
  const w = world({ env: { FIREBASE_WEB_API_KEY: 'k' } });
  const b = mb(TODAY, { actor: D });
  const first = await ride(w, b);
  w.db.prepare('UPDATE cloud_rides SET actor=? WHERE actor=?').run(U, D);
  w.db.prepare('UPDATE chip_ledger SET actor=? WHERE actor=?').run(U, D);
  w.db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,NULL,0,?,1)').run(D, U);
  w.db.prepare('INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES (?,?,0,NULL,1)').run(U, U);
  const again = (await withFirebase(U, () => ride(w, b, { Authorization: 'Bearer tok-s8' }))).out;
  ok('S8 合併前送出、合併後帶帳號的 Bearer 重送 → 200、與第一次同一份（points 20、rides 1）；帳號名下帳本仍 1 列、舊裝置名下 0 列',
    first.status === 200 && again.status === 200 && same(again.json, first.json) && first.json.points === 20 &&
      q.cloudLedger(w, U).length === 1 && q.nLedger(w, D) === 0, first.text + ' / ' + again.text);
});

// S9 跨人隔離：同一個世界裡有別人的搭乘與雲端點數，不能影響我的次數與入帳
await attempt('S9', async () => {
  const X = 'dev-s9xxxx01', Y = 'dev-s9yyyy01', w = world({});
  seedRide(w, X, '2026-07-20'); seedRide(w, X, '2026-07-21'); seedV2Chip(w, X, 1, '2026-07-18');
  seedRide(w, Y, '2026-07-20'); seedRide(w, Y, '2026-07-21');
  const y = await ride(w, mb(TODAY, { actor: Y }));
  ok('S9a Y 的第 3 次：rides 是 Y 自己的 3（不是全站的 5）、points 20；Y 帳本 1 列、X 的帳仍恰好 1 列',
    y.status === 200 && y.json.rides === 3 && y.json.points === 20 && q.cloudLedger(w, Y).length === 1 && q.cloudLedger(w, X).length === 1, y.text);
  const x = await ride(w, mb(YESTERDAY, { actor: X }));
  ok('S9b X 的第 3 次：rides 3、points 20；X 的帳 2 列（v2 那顆＋這次）、Y 的帳仍 1 列',
    x.status === 200 && x.json.rides === 3 && x.json.points === 20 && q.cloudLedger(w, X).length === 2 && q.cloudLedger(w, Y).length === 1, x.text);
});

// ═══ T 組：車次驗證與時間窗（合成班表，逐邊界）═══════════════════════════════════
// T1 不存在的車：台鐵、高鐵、林鐵、格式錯誤、不認得的系統——都 400 unknown_train 且零寫入
await attempt('T1', async () => {
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  let n = 0;
  const bad = async (name, trainKey, extra = {}) => {
    const A = 'dev-t1a' + String(++n).padStart(5, '0');
    const r = await ride(w, rb({ actor: A, trainKey, ...extra }));
    ok(`T1 ${name} → 400 unknown_train，零寫入`, r.status === 400 && r.json && r.json.error === 'unknown_train' && q.nRides(w, A) === 0, r.text);
  };
  await bad('台鐵不存在的車次 9999', 'tra_sched|9999');
  await bad('高鐵不存在的車次 9999', 'thsr_sched|9999');
  await bad('林鐵不存在的車次 999', 'afr_sched|999');
  await bad('只有系統沒有車次', 'tra_sched');
  await bad('台鐵多一段', 'tra_sched|101|extra');
  await bad('捷運只有兩段', 'mrt|BR');
  await bad('捷運車輛識別是空的', 'mrt|BR|');
  await bad('捷運系統不認得', 'subway|BR|veh-1');
  await bad('系統是空字串', '|101');
  await bad('trainKey 不是字串', 12345);
  await bad('trainKey 是物件', { a: 1 });
  await bad('車次含空白', 'tra_sched|10 1');
  await bad('車次超過 8 碼', 'tra_sched|123456789');
  await bad('捷運線 id 超過 32 字', 'mrt|' + 'L'.repeat(33) + '|veh-1');
  await bad('捷運車輛識別超過 64 字', 'mrt|BR|' + 'v'.repeat(65));
  await bad('trainKey 過長（>96 字）', 'mrt|BR|' + 'v'.repeat(90));
});

// T2 台鐵：走「當天的索引」——同車次不同日的兩個版本、跨午夜、時間窗四個邊界
await attempt('T2', async () => {
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  let n = 0;
  const go = async (b) => { const A = 'dev-t2a' + String(++n).padStart(5, '0'); return [await ride(w, rb({ actor: A, ...b })), A]; };
  // 101 今天 10:00–11:00，窗＝09:30–11:30（前後各 30 分鐘）
  const [lo, A1] = await go({ startedAt: at(TODAY, 9, 30) });
  ok('T2a 窗的起點（首站前 30 分鐘整）→ 200', lo.status === 200 && q.nRides(w, A1) === 1, lo.text);
  const [before, A2] = await go({ startedAt: at(TODAY, 9, 29, 59) });
  ok('T2b 早 1 秒 → 400 unknown_train 且零寫入', before.status === 400 && before.json.error === 'unknown_train' && q.nRides(w, A2) === 0, before.text);
  const [hi, A3] = await go({ startedAt: at(TODAY, 11, 30) });
  ok('T2c 窗的終點（末站後 30 分鐘整）→ 200', hi.status === 200 && q.nRides(w, A3) === 1, hi.text);
  const [after, A4] = await go({ startedAt: at(TODAY, 11, 30, 1) });
  ok('T2d 晚 1 秒 → 400 unknown_train', after.status === 400 && after.json.error === 'unknown_train' && q.nRides(w, A4) === 0, after.text);
  // 同車次不同日：昨天的 101 是另一個版本（13:53–14:43）。昨天 10:00 上車（今天版本的時間）→ 不在昨天那一版的窗內 → 擋；13:40 → 收
  const [wrongVer, A5] = await go({ day: YESTERDAY, startedAt: at(YESTERDAY, 10) });
  ok('T2e 昨天的 101 用「今天那一版」的時間上車 → 400 unknown_train（驗的是當天的班次，不是檔內任一版）', wrongVer.status === 400 && wrongVer.json.error === 'unknown_train' && q.nRides(w, A5) === 0, wrongVer.text);
  const [rightVer, A6] = await go({ day: YESTERDAY, startedAt: at(YESTERDAY, 13, 40) });
  ok('T2f 昨天的 101 用昨天那一版的時間 → 200', rightVer.status === 200 && q.nRides(w, A6) === 1, rightVer.text);
  // 跨午夜：102 只在昨天開行（25:00–26:00＝今天 01:00–02:00）；昨天營運日、今天凌晨 01:05 上車
  const [xm, A7] = await go({ day: YESTERDAY, trainKey: 'tra_sched|102', startedAt: at(YESTERDAY, 25, 5) });
  ok('T2g 跨午夜的班次（營運日昨天、上車時間是今天凌晨 01:05）→ 200', xm.status === 200 && q.nRides(w, A7) === 1, xm.text);
  // 102 今天不開行（檔內有、但不在今天的索引裡）
  const [notToday, A8] = await go({ trainKey: 'tra_sched|102', startedAt: at(TODAY, 9, 40) });
  ok('T2h 102 檔內有、但今天不開行 → 400 unknown_train（嚴格模式看當天的索引，不是看檔內有沒有）', notToday.status === 400 && notToday.json.error === 'unknown_train' && q.nRides(w, A8) === 0, notToday.text);
  // 只有時間對、日期錯：把昨天的 102 搭乘（今天凌晨 01:05）用 day=今天送出 → 今天不開 102
  const [dayMix, A9] = await go({ day: TODAY, trainKey: 'tra_sched|102', startedAt: at(YESTERDAY, 25, 5) });
  ok('T2i 營運日填今天、卻是昨天那班 102 的時間 → 400 unknown_train', dayMix.status === 400 && q.nRides(w, A9) === 0, dayMix.text);
});

// T3 台鐵班表檔過期（那一天不在 dates 裡）→ 降級成「車次在檔內任一天存在」：不看時間窗，但不存在的車次仍擋
await attempt('T3', async () => {
  const later = Date.parse('2026-08-15T08:00:00Z');       // 台北 2026-08-15 16:00——合成班表只有 07-28／07-29
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX }, now: later });
  const d = '2026-08-15';
  const r1 = await ride(w, rb({ actor: 'dev-t3aaaa01', day: d, trainKey: 'tra_sched|101', startedAt: at(d, 3) }));
  ok('T3a 班表檔沒有這一天：101 在檔內 → 200（降級：不看時間窗，凌晨 03:00 也收）', r1.status === 200 && q.nRides(w, 'dev-t3aaaa01') === 1, r1.text);
  const r2 = await ride(w, rb({ actor: 'dev-t3bbbb01', day: d, trainKey: 'tra_sched|9999', startedAt: at(d, 9) }));
  ok('T3b 降級模式下不存在的車次仍擋 → 400 unknown_train', r2.status === 400 && r2.json.error === 'unknown_train' && q.nRides(w, 'dev-t3bbbb01') === 0, r2.text);
});

// T4 高鐵：D1 逐日班表有那一天 → 嚴格（車次＋時間窗）；那天不在 blob 或沒有 blob → 降級成靜態檔「車次存在」
await attempt('T4', async () => {
  const seed = `INSERT INTO kv_blobs (k,v,updated) VALUES ('thsr_sched','${JSON.stringify(THSR_BLOB).replace(/'/g, "''")}','x');`;
  const w = world({ seed });
  let n = 0;
  const go = async (b) => { const A = 'dev-t4a' + String(++n).padStart(5, '0'); return [await ride(w, rb({ actor: A, ...b })), A]; };
  const [in1, A1] = await go({ trainKey: 'thsr_sched|0101', startedAt: at(TODAY, 9, 40) });
  ok('T4a blob 有今天：0101 在窗內 → 200', in1.status === 200 && q.nRides(w, A1) === 1, in1.text);
  const [out1, A2] = await go({ trainKey: 'thsr_sched|0101', startedAt: at(TODAY, 8) });
  ok('T4b blob 有今天：0101 但 08:00 上車（窗外）→ 400 unknown_train', out1.status === 400 && out1.json.error === 'unknown_train' && q.nRides(w, A2) === 0, out1.text);
  const [no1, A3] = await go({ trainKey: 'thsr_sched|0116', startedAt: at(TODAY, 9, 40) });
  ok('T4c blob 有今天：0116 靜態檔有、但今天 blob 沒有這班 → 400 unknown_train（嚴格：blob 說了算，不退回靜態檔）', no1.status === 400 && no1.json.error === 'unknown_train' && q.nRides(w, A3) === 0, no1.text);
  // 資料殘缺：首站沒有 arrSec／末站沒有 depSec → 算不出窗，一律擋（Number(null)＝0 會讓窗變成半夜起算，等於放行）
  const [bad1, A3b] = await go({ trainKey: 'thsr_sched|0199', startedAt: at(TODAY, 9, 40) });
  ok('T4g blob 有今天：0199 首站沒有 arrSec（殘缺）→ 400 unknown_train（沒有時間窗＝不收，不是萬用通行）', bad1.status === 400 && bad1.json.error === 'unknown_train' && q.nRides(w, A3b) === 0, bad1.text);
  const [bad2, A3c] = await go({ trainKey: 'thsr_sched|0198', startedAt: at(TODAY, 9, 40) });
  ok('T4h blob 有今天：0198 末站沒有 depSec（殘缺）→ 400 unknown_train', bad2.status === 400 && bad2.json.error === 'unknown_train' && q.nRides(w, A3c) === 0, bad2.text);
  // 昨天不在 blob → 降級：靜態檔（真檔）有的車次就收，不看時間
  const real = REAL('thsr_schedule_dense.json').trains[0].train;
  const [fb, A4] = await go({ day: YESTERDAY, trainKey: 'thsr_sched|' + real, startedAt: at(YESTERDAY, 3) });
  ok(`T4d blob 沒有昨天 → 降級：靜態檔有 ${real} → 200（不看時間窗）`, fb.status === 200 && q.nRides(w, A4) === 1, fb.text);
  const [fbNo, A5] = await go({ day: YESTERDAY, trainKey: 'thsr_sched|9999', startedAt: at(YESTERDAY, 9) });
  ok('T4e 降級模式下靜態檔沒有的車次 → 400 unknown_train', fbNo.status === 400 && q.nRides(w, A5) === 0, fbNo.text);
  // 完全沒有 blob（表存在、沒有那一列）
  const w2 = world({});
  const r = await ride(w2, rb({ actor: 'dev-t4bbbb01', trainKey: 'thsr_sched|' + real, startedAt: at(TODAY, 3) }));
  ok('T4f 完全沒有 thsr_sched blob → 降級成靜態檔存在檢查 → 200', r.status === 200 && q.nRides(w2, 'dev-t4bbbb01') === 1, r.text);
});

// T5 捷運／輕軌：沒有逐車次班表，驗的是格式與營運時段（05:00–次日 01:30），邊界照樣釘住
await attempt('T5', async () => {
  const w = world({});
  let n = 0;
  const go = async (b) => { const A = 'dev-t5a' + String(++n).padStart(5, '0'); return [await ride(w, mb(b.day || TODAY, { actor: A, ...b })), A]; };
  const [a, A1] = await go({ startedAt: at(TODAY, 5) });
  ok('T5a 05:00 整 → 200（營運時段起點）', a.status === 200 && q.nRides(w, A1) === 1, a.text);
  const [b, A2] = await go({ startedAt: at(TODAY, 4, 59, 59) });
  ok('T5b 04:59:59 → 400 unknown_train', b.status === 400 && b.json.error === 'unknown_train' && q.nRides(w, A2) === 0, b.text);
  // 昨天營運日、今天 01:30 整（＝25:30）→ 收；01:30:01 → 擋。世界的時鐘在今天 16:00，都在過去
  const [c, A3] = await go({ day: YESTERDAY, startedAt: at(YESTERDAY, 25, 30) });
  ok('T5c 營運日昨天、次日 01:30 整 → 200（營運時段終點）', c.status === 200 && q.nRides(w, A3) === 1, c.text);
  const [d, A4] = await go({ day: YESTERDAY, startedAt: at(YESTERDAY, 25, 30, 1) });
  ok('T5d 營運日昨天、次日 01:30:01 → 400 unknown_train', d.status === 400 && d.json.error === 'unknown_train' && q.nRides(w, A4) === 0, d.text);
  // 同一個人同一個營運日：捷運與台鐵共用同一格（每日 1 次不分系統）
  const A5 = 'dev-t5bbbb01', w2 = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  await ride(w2, mb(TODAY, { actor: A5 }));
  const r = await ride(w2, rb({ actor: A5 }));
  ok('T5e 同一天先搭捷運再搭台鐵 → 第二次 409 already_today（每日 1 次不分系統）', r.status === 409 && r.json.error === 'already_today', r.text);
});

// ═══ X 組：四種系統各一個成功案例（讀 data/ 真班表檔，日期與車次從檔內當場挑，不寫死）════════════════
await attempt('X1', async () => {
  const RT = REAL('tra_widget_schedule.json');
  const D = Object.keys(RT.dates).sort()[3];
  const onD = RT.dates[D].map(i => RT.trains[i]);
  const pick = onD.find(t => t[2].length >= 2 && t[2][0][1] <= 80000);
  const now = Date.parse(D + 'T15:00:00Z');                 // 台北 D 23:00
  const w = world({ now });
  ok(`X1 [fixture] 真檔 ${D} 有可用的班次（首站 ≤ 22:13 且至少兩站）`, !!pick, D);
  const A = 'dev-x1aaaa01';
  const r = await ride(w, { actor: A, day: D, trainKey: 'tra_sched|' + pick[0], startedAt: t0(D) + pick[2][0][1] * 1000, sec: 600, requestId: nextReq(), client: APP });
  ok(`X1a 台鐵真班表：${D} 的 ${pick[0]} 首站時間上車 → 200`, r.status === 200 && r.json.rides === 1 && q.nRides(w, A) === 1, r.text);
  // 嚴格模式對真檔也成立：找一個檔內有、但 D 那天不開的車次（週間／週末班次不同）
  const onDNo = new Set(onD.map(t => t[0]));
  const other = RT.trains.find(t => !onDNo.has(t[0]));
  ok('X1b [fixture] 真檔裡存在一個「檔內有、但 D 那天不開」的車次', !!other);
  if (other) {
    const B = 'dev-x1bbbb01';
    const r2 = await ride(w, { actor: B, day: D, trainKey: 'tra_sched|' + other[0], startedAt: t0(D) + 3600e3, sec: 600, requestId: nextReq(), client: APP });   // 時間隨便給（01:00）：擋掉它的是「D 那天不開」不是時間
    ok(`X1c 真檔：${other[0]} 在檔內、但 ${D} 不開行 → 400 unknown_train`, r2.status === 400 && r2.json.error === 'unknown_train' && q.nRides(w, B) === 0, r2.text);
  }
});
await attempt('X2', async () => {
  const H = REAL('thsr_schedule_dense.json');
  const no = H.trains[0].train;
  const w = world({});
  const A = 'dev-x2aaaa01';
  const r = await ride(w, { actor: A, day: TODAY, trainKey: 'thsr_sched|' + no, startedAt: at(TODAY, 9), sec: 600, requestId: nextReq(), client: APP });
  ok(`X2 高鐵真班表（無 blob 降級）：${no} → 200`, r.status === 200 && q.nRides(w, A) === 1, r.text);
});
await attempt('X3', async () => {
  const F = REAL('afr_schedule_dense.json');
  const t = F.trains.find(x => x.stops.length >= 2 && x.stops[0].arrSec <= 50000);
  const w = world({});
  const A = 'dev-x3aaaa01';
  ok('X3 [fixture] 真檔有可用的林鐵班次', !!t);
  const r = await ride(w, { actor: A, day: TODAY, trainKey: 'afr_sched|' + t.train, startedAt: t0(TODAY) + t.stops[0].arrSec * 1000, sec: 600, requestId: nextReq(), client: APP });
  ok(`X3a 林鐵真班表：${t.train} 首站時間上車 → 200`, r.status === 200 && q.nRides(w, A) === 1, r.text);
  const B = 'dev-x3bbbb01';
  const r2 = await ride(w, { actor: B, day: TODAY, trainKey: 'afr_sched|' + t.train, startedAt: t0(TODAY) + (t.stops[0].arrSec - 31 * 60) * 1000, sec: 600, requestId: nextReq(), client: APP });
  ok('X3b 林鐵：首站前 31 分鐘（窗外）→ 400 unknown_train', r2.status === 400 && r2.json.error === 'unknown_train' && q.nRides(w, B) === 0, r2.text);
});
await attempt('X4', async () => {
  const w = world({});
  const A = 'dev-x4aaaa01';
  const r = await ride(w, { actor: A, day: TODAY, trainKey: 'krtc|R|車輛-0042', startedAt: at(TODAY, 12), sec: 900, requestId: nextReq(), client: { platform: 'android', app: '1.6.13', simulator: false } });
  ok('X4 捷運（高雄捷運紅線、Android）→ 200，庫裡存的 sec 是 900、trainKey 原樣',
    r.status === 200 && q.rides(w, A).length === 1 && q.rides(w, A)[0].sec === 900 && q.rides(w, A)[0].train_key === 'krtc|R|車輛-0042', r.text);
});

// ═══ G 組：閘門與路由 ═══════════════════════════════════════════════════════════
await attempt('G1', async () => {
  const A = 'dev-g1aaaa01';
  const w = world({ files: { 'tra_widget_schedule.json': TRA_FIX } });
  const rGet = await call(_bounty.cloudRide, post(null, {}, 'GET'), w.env);
  ok('G1a GET → 405 method 且沒碰 D1', rGet.status === 405 && rGet.json.error === 'method' && w.sql.length === 0, rGet.text);
  const wL = world({ files: { 'tra_widget_schedule.json': TRA_FIX }, env: { BOUNTY_LIMITER: limiter(true) } });
  const rL = await ride(wL, rb({ actor: A }));
  ok('G1b 限流器擋下 → 429 rate_limited 且沒碰 D1（擋在任何 D1 存取之前）', rL.status === 429 && rL.json.error === 'rate_limited' && wL.sql.length === 0, rL.text);
  const wB = world({ files: { 'tra_widget_schedule.json': TRA_FIX }, env: { BOUNTY_LIMITER: { limit: async () => { throw new Error('limiter down'); } } } });
  const rB = await ride(wB, rb({ actor: A }));
  ok('G1c 限流服務丟例外 → 429（寫入端 fail-closed）且零寫入', rB.status === 429 && q.nRides(wB, A) === 0, rB.text);
  const wOff = world({ files: { 'tra_widget_schedule.json': TRA_FIX }, env: { BOUNTY_WRITES: 'off' } });
  const rOff = await ride(wOff, rb({ actor: A }));
  ok('G1d BOUNTY_WRITES=off → 503 bounty_paused、零寫入、沒碰 D1', rOff.status === 503 && rOff.json.error === 'bounty_paused' && q.nRides(wOff, A) === 0 && wOff.sql.length === 0, rOff.text);
});
await attempt('G2', async () => {
  const A = 'dev-g2aaaa01';
  // 規則檔讀不到 → 503 not_ready（不拿猜的門檻收搭乘）
  const w1 = world({ missing: ['bounty_rules.json'] });
  const r1 = await ride(w1, mb(TODAY, { actor: A }));
  ok('G2a 規則檔讀不到 → 503 not_ready 且零寫入', r1.status === 503 && r1.json.error === 'not_ready' && q.nRides(w1, A) === 0, r1.text);
  // 班表資產讀不到：台鐵 503 not_ready（fail-closed，寧可讓客戶端留在佇列重試，也不收無法驗證的搭乘）；捷運不需要班表、照常收
  const w2 = world({ missing: ['tra_widget_schedule.json'] });
  const r2 = await ride(w2, rb({ actor: A }));
  ok('G2b 台鐵班表檔讀不到 → 503 not_ready、零寫入（不降級成不驗證）', r2.status === 503 && r2.json.error === 'not_ready' && q.nRides(w2, A) === 0, r2.text);
  const r3 = await ride(w2, mb(TODAY, { actor: A }));
  ok('G2c 同一個世界：捷運不需要班表 → 200', r3.status === 200 && q.nRides(w2, A) === 1, r3.text);
});
await attempt('G3', async () => {
  // 經 worker.fetch 走完整路由：POST 收得到、GET 得 405、回應標 no-store
  const A = 'dev-g3aaaa01';
  const w = world({});
  _bounty.bountyResetMemCaches();
  const res = await worker.fetch(post(mb(TODAY, { actor: A })), w.env, { waitUntil() {} });
  const r = await fin(res);
  ok('G3a 經 worker.fetch 路由：POST /api/cloud-ride → 200、rides 1，回應標 no-store',
    r.status === 200 && r.json && r.json.rides === 1 && res.headers.get('cache-control') === 'no-store', r.text + ' cc=' + res.headers.get('cache-control'));
  const g = await fin(await worker.fetch(post(null, {}, 'GET'), w.env, { waitUntil() {} }));
  ok('G3b 經 worker.fetch 路由：GET /api/cloud-ride → 405（不是 404、也不是 200）', g.status === 405, g.text);
});
await attempt('G4', async () => {
  // 合併過的匿名 token：搭乘寫在 uid 名下（resolveActor 轉向）。
  // 改寫：必須帶 uid 的 Bearer（舊版不帶任何憑證就能替別人的帳發搭乘、發點數）；種子也補上正式合併會留下的 uid 帳號列
  const w = world({ env: { FIREBASE_WEB_API_KEY: 'k' } });
  w.db.prepare("INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('dev-g4tomb01',NULL,0,'uid-g4real0001',1)").run();
  w.db.prepare("INSERT INTO bounty_points (actor,uid,points,merged_into,updated_at) VALUES ('uid-g4real0001','uid-g4real0001',0,NULL,1)").run();
  const { out: r, calls } = await withFirebase('uid-g4real0001', () => ride(w, mb(TODAY, { actor: 'dev-g4tomb01' }), { Authorization: 'Bearer tok-g4' }));
  ok('G4 已併進 uid 的 device token 送搭乘（帶 uid 的 Bearer）：列寫在 uid 名下，token 名下零列；Firebase 恰好查 1 次',
    r.status === 200 && q.nRides(w, 'uid-g4real0001') === 1 && q.nRides(w, 'dev-g4tomb01') === 0 && calls.length === 1, r.text);
});

// ═══ P 組：通行證欄位不影響結果（點數與通行證無關）═══════════════════════════
await attempt('P1', async () => {
  const run = async (extra, hdr) => {
    const w = world({});
    const A = 'dev-p1aaaa01';
    const seedDays = ['2026-07-20', '2026-07-21']; seedDays.forEach(d => seedRide(w, A, d));
    const b = { ...mb(TODAY, { actor: A, requestId: 'req-plus001' }), ...extra };
    const r = await ride(w, b, hdr);
    return { r, rows: q.rides(w, A).length, led: q.cloudLedger(w, A).map(x => x.ref), sql: w.sql.join('\n') };
  };
  const base = await run({});
  const plus = await run({ plus: true, plusActive: true, isPlus: true, entitlement: 'plus', pass: 'active', 通行證: true }, { 'x-plus-token': 'plus-token', 'x-plus': '1', 'x-entitlement': 'plus' });
  ok('P1a 帶滿通行證欄位與標頭的請求，結果與不帶的完全相同（同 status、同回應、同列數、同帳本）',
    base.r.status === 200 && plus.r.status === 200 && same(base.r.json, plus.r.json) && base.rows === plus.rows && same(base.led, plus.led) && base.r.json.chipAwarded === true,
    base.r.text + ' / ' + plus.r.text);
  ok('P1b 兩次都沒有任何一句 SQL 碰通行證／資格（plus／entitle／revenuecat／pass／通行證）', !/plus|entitle|revenuecat|passes|通行證/i.test(base.sql + plus.sql), '');
  ok('P1c 全程沒有任何對外連線（不驗 Firebase、不問 RevenueCat）', outbound.length === 0, JSON.stringify(outbound));
});

// ═══ D 組：捷運白名單對得上前端 SYS_DEFS；schema 帶 simulator 欄 ═══════════════════════
await attempt('D1', async () => {
  const html = readFileSync('index.html', 'utf8');
  const start = html.indexOf('const SYS_DEFS = [');
  const block = html.slice(start, html.indexOf('\n];', start));
  const freq = [...block.matchAll(/\{ id: '([a-z_]+)'[^\n]*mode: 'freq'/g)].map(m => m[1]);
  const sched = [...block.matchAll(/\{ id: '([a-z_]+)'[^\n]*mode: 'sched'/g)].map(m => m[1]);
  ok('D1a [fixture] 從 index.html SYS_DEFS 讀到 7 個 freq 系統與 3 個 sched 系統',
    freq.length === 7 && sched.length === 3 && sched.join() === 'tra_sched,thsr_sched,afr_sched', JSON.stringify({ freq, sched }));
  const w = world({});
  const bad = [];
  for (let i = 0; i < freq.length; i++) {
    const r = await ride(w, mb(TODAY, { actor: 'dev-d1s' + String(i).padStart(5, '0'), trainKey: `${freq[i]}|L1|veh-${i}` }));
    if (r.status !== 200) bad.push(freq[i] + ':' + r.text);
  }
  ok('D1b 前端 SYS_DEFS 的每一個 freq 系統 id，worker 的白名單都收（新增捷運系統忘了改 worker 會紅在這裡）', bad.length === 0, bad.join(' | '));
  // 反向對照：sched 系統的 id 不能拿來當捷運用（tra_sched|L1|veh 是三段、台鐵只收兩段）
  const r = await ride(w, mb(TODAY, { actor: 'dev-d1sched01', trainKey: 'tra_sched|L1|veh-1' }));
  ok('D1c 反向：sched 系統 id 不在捷運白名單（tra_sched 三段 → 400 unknown_train）', r.status === 400 && r.json.error === 'unknown_train', r.text);
});
await attempt('D2', async () => {
  const w = world({});
  const cols = w.db.prepare("SELECT name, type, \"notnull\" nn, dflt_value d FROM pragma_table_info('cloud_rides') WHERE name='simulator'").all();
  ok('D2 cloud_rides 有 simulator INTEGER NOT NULL DEFAULT 0（schema 直接寫在 0014 的 CREATE 裡，不是另補的 ALTER）',
    cols.length === 1 && cols[0].type === 'INTEGER' && cols[0].nn === 1 && String(cols[0].d) === '0', JSON.stringify(cols));
  ok('D2b 全程 outbound 仍為 0（整支腳本沒打過任何對外連線）', outbound.length === 0, JSON.stringify(outbound));
});

const pass = R.filter(r => r.p).length;
console.log(`\n${pass}/${R.length} 通過`);
process.exit(pass === R.length ? 0 : 1);
