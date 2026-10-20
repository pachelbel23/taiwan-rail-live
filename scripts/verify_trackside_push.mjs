// 軌道邊卡片 IO 驗收：直接呼叫 worker 函式，D1 使用真的本機 binding。
// APNs 全是假 fetch；即時資料攔在 caches.default.match，其他 fetch 一律拒絕。
//
// 本機前置，缺任一項就中止：
// 1. 在本樹套 schema/0014_trackside.sql：
//    arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --local \
//      --file=schema/0014_trackside.sql
// 2. 本樹 .dev.vars 恰好四個鍵，不能複製別棵樹的 secrets：
//    APNS_KEY_P8：丟棄式 P-256 PKCS8，用 generateKeyPairSync('ec',
//      { namedCurve: 'prime256v1' }) 產生，privateKey.export({ type:'pkcs8', format:'pem' })。
//    APNS_KEY_ID=FAKELOCAL1、APNS_TEAM_ID=FAKELOCALTEAM；
//    LA_TEST_BEARER 用 randomBytes(16).toString('hex') 產生。
// 3. 執行 node scripts/verify_trackside_push.mjs。
import assert from 'node:assert/strict';
import { getPlatformProxy } from 'wrangler';
import { readFileSync } from 'node:fs';
import { createHash, createPrivateKey } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const WT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerPath = resolve(WT, 'worker.js');
const workerSource = readFileSync(workerPath, 'utf8');
console.log(`受測目標：${workerPath} md5=${createHash('md5').update(workerSource).digest('hex')}`);
const results = [];
let completed = false;
let printed = false;
function summary(reason = '') {
  if (printed) return;
  printed = true;
  const failed = results.filter(result => !result.pass).length;
  console.log(`總計 ${results.length} 項，FAIL ${failed}${reason ? `，中止：${reason}` : ''}`);
}
async function check(name, run) {
  try {
    await run();
    results.push({ name, pass: true });
    console.log(`ok ${name}`);
  } catch (error) {
    results.push({ name, pass: false });
    console.error(`FAIL ${name} — ${error.stack || error}`);
  }
}
process.on('exit', () => {
  if (!completed) {
    summary('未完成全部驗收');
    process.exitCode = 2;
  }
});

const realNow = Date.now;
const realFetch = globalThis.fetch;
const realCaches = globalThis.caches;
const START_MS = 1792454400000;
let mockNowMs = START_MS;
Date.now = () => mockNowMs;
let apnsCalls = [];
let unexpectedFetches = [];
let apnsNextStatus = 200;
let apnsNextReason = '';
let apnsAdvanceMs = 0;
let srcLive = null;
let liveStatus = 200;
let cacheMatches = [];
globalThis.fetch = async (input, init) => {
  const raw = String(input?.url || input);
  const url = new URL(raw);
  if (['api.push.apple.com', 'api.sandbox.push.apple.com'].includes(url.hostname)
      && url.pathname.startsWith('/3/device/')) {
    apnsCalls.push({
      token: url.pathname.slice('/3/device/'.length),
      host: url.hostname === 'api.sandbox.push.apple.com' ? 'sandbox' : 'prod',
      body: JSON.parse(init.body), headers: init.headers, atMs: mockNowMs,
    });
    mockNowMs += apnsAdvanceMs;
    return new Response(JSON.stringify({ reason: apnsNextReason }), { status: apnsNextStatus });
  }
  unexpectedFetches.push(raw);
  throw new Error(`未預期的 fetch 目標：${raw}`);
};
globalThis.caches = {
  default: {
    async match(input) {
      const raw = String(input?.url || input);
      cacheMatches.push(raw);
      if (raw.includes('/api/tra-live') && (srcLive !== null || liveStatus !== 200)) {
        return new Response(JSON.stringify(srcLive), {
          status: liveStatus, headers: { 'content-type': 'application/json' },
        });
      }
      return undefined;
    },
    async put() {},
  },
};
async function captureConsole(run) {
  const log = console.log, error = console.error;
  const logLines = [], errLines = [];
  console.log = (...args) => logLines.push(args.map(String).join(' '));
  console.error = (...args) => errLines.push(args.map(String).join(' '));
  try { return { result: await run(), logLines, errLines }; }
  finally { console.log = log; console.error = error; }
}

const BASE = 'https://trackside.invalid';
const T = tag => (Buffer.from(String(tag)).toString('hex') + '0'.repeat(64)).slice(0, 64);
const UID = 'local-test';
const fakeCtx = { waitUntil(promise) { promise?.catch(() => {}); } };
let env, dispose, schemaReady = false;
let tracksideBind, tracksideUnbind, tracksidePushAll, tracksidePushWithHalf;
const db = () => env.DELAY_DB;
const rows = async () => (await db().prepare('SELECT * FROM trackside_bindings ORDER BY token').all()).results;
const row = token => db().prepare('SELECT * FROM trackside_bindings WHERE token=?').bind(token).first();
async function reset() {
  await db().prepare('DELETE FROM trackside_bindings').run();
  mockNowMs = START_MS;
  apnsCalls = [];
  unexpectedFetches = [];
  apnsNextStatus = 200;
  apnsNextReason = '';
  apnsAdvanceMs = 0;
  srcLive = null;
  liveStatus = 200;
  cacheMatches = [];
}
function validBody(tag = 'bind') {
  return {
    token: T(tag), endMs: mockNowMs + 7200000, tickMode: 'phase',
    passes: [
      { no: '172', sys: 'tra_sched', ms: mockNowMs + 600000, prevMs: mockNowMs + 300000, nextDay: false },
      { no: '803', sys: 'thsr_sched', ms: mockNowMs + 1200000, prevMs: mockNowMs + 900000, nextDay: true },
    ],
  };
}
function req(endpoint, body, { method = 'POST', auth = env.LA_TEST_BEARER, raw = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (auth !== null) headers.Authorization = `Bearer ${auth}`;
  return new Request(`${BASE}/api/trackside/${endpoint}`, {
    method, headers, ...(method === 'GET' ? {} : { body: raw ? body : JSON.stringify(body) }),
  });
}
async function responseIs(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), body);
}
async function bindOk(body = validBody()) {
  await responseIs(await tracksideBind(req('bind', body), env), 200, { ok: true });
}
const CONTENT_KEYS = [
  'no', 'sys', 'ms', 'actualMs', 'prevActualMs', 'delayMin', 'nextDay', 'passedPrev',
  'cd', 'minutes', 'clock', 'delayAtMs', 'delayStale', 'nextNo', 'nextSys', 'nextMs',
  'nextActualMs', 'nextDelayMin', 'nextNextDay', 'pushed', 'tick',
];
function freshLive(delays = { '172': 0 }, atMs = mockNowMs) {
  srcLive = {
    at: new Date(atMs).toISOString(),
    trains: Object.entries(delays).map(([no, delay]) => ({ no, delay })),
  };
  liveStatus = 200;
}
async function insertRow(tag, overrides = {}) {
  const body = validBody(tag);
  const value = {
    token: body.token, uid: UID, passes: body.passes, tickMode: body.tickMode,
    endMs: body.endMs, expireMs: body.endMs + 300000, boundMs: mockNowMs,
    lastState: null, apnsEnv: null, failStreak: 0, ...overrides,
  };
  await db().prepare(
    'INSERT INTO trackside_bindings' +
    ' (token,uid,passes,tick_mode,end_ms,expire_ms,bound_ms,last_state,apns_env,fail_streak)' +
    ' VALUES (?,?,?,?,?,?,?,?,?,?)'
  ).bind(
    value.token, value.uid, typeof value.passes === 'string' ? value.passes : JSON.stringify(value.passes),
    value.tickMode, value.endMs, value.expireMs, value.boundMs,
    value.lastState === null ? null : JSON.stringify(value.lastState), value.apnsEnv, value.failStreak,
  ).run();
  return value;
}
const push = half => tracksidePushAll(env, fakeCtx, BASE, half);
const content = call => call.body.aps['content-state'];
function nextIsNull(state) {
  for (const key of ['nextNo', 'nextSys', 'nextMs', 'nextActualMs', 'nextDelayMin', 'nextNextDay']) {
    assert.equal(state[key], null, key);
  }
}
function assertEndCall(call, previous, atMs) {
  assert.equal(call.body.aps.event, 'end');
  assert.equal(call.body.aps.timestamp, Math.floor(atMs / 1000));
  assert.equal(call.body.aps['dismissal-date'], Math.floor(atMs / 1000));
  assert.deepEqual(Object.keys(content(call)), CONTENT_KEYS);
  assert.deepEqual(content(call), { ...previous, pushed: true, tick: atMs });
}
async function collectAsyncCases(cases, run) {
  const errors = [];
  for (const item of cases) {
    try { await run(item); }
    catch (error) { errors.push(`${item}: ${error.message}`); }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
}

try {
  const varsSource = readFileSync(resolve(WT, '.dev.vars'), 'utf8');
  const varsKeys = [...varsSource.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)].map(match => match[1]).sort();
  assert.deepEqual(varsKeys, ['APNS_KEY_ID', 'APNS_KEY_P8', 'APNS_TEAM_ID', 'LA_TEST_BEARER'],
    '.dev.vars 必須恰好四個本機假值');
  const proxy = await getPlatformProxy({
    configPath: resolve(WT, 'wrangler.jsonc'),
    persist: { path: resolve(WT, '.wrangler/state/v3') },
  });
  dispose = proxy.dispose;
  assert.equal(proxy.env.APNS_KEY_ID, 'FAKELOCAL1', 'APNS_KEY_ID 必須是本機假值');
  assert.equal(proxy.env.APNS_TEAM_ID, 'FAKELOCALTEAM', 'APNS_TEAM_ID 必須是本機假值');
  assert.match(proxy.env.LA_TEST_BEARER || '', /^[0-9a-f]{32}$/, 'LA_TEST_BEARER 必須為 32 碼隨機 hex');
  assert.ok(proxy.env.APNS_KEY_P8, '缺 APNS_KEY_P8');
  const privateKey = createPrivateKey(proxy.env.APNS_KEY_P8.replace(/\\n/g, '\n'));
  assert.equal(privateKey.asymmetricKeyType, 'ec');
  assert.equal(privateKey.asymmetricKeyDetails.namedCurve, 'prime256v1');
  for (const key of ['FIREBASE_WEB_API_KEY', 'REVENUECAT_PROJECT_ID', 'REVENUECAT_V2_SECRET_KEY', 'APNS_HOST']) {
    assert.ok(!proxy.env[key], `本機不應帶入 ${key}`);
  }
  env = { ...proxy.env, LA_LIMITER: undefined, USAGE: { writeDataPoint() {} } };
  const columns = (await db().prepare('PRAGMA table_info(trackside_bindings)').all()).results.map(item => item.name).sort();
  assert.deepEqual(columns, [
    'apns_env', 'bound_ms', 'end_ms', 'expire_ms', 'fail_streak',
    'last_state', 'passes', 'tick_mode', 'token', 'uid',
  ], '本機 D1 未套完整 0014 schema');
  schemaReady = true;
  const worker = await import(pathToFileURL(workerPath));
  ({ tracksideBind, tracksideUnbind, tracksidePushAll, tracksidePushWithHalf } = worker._ts || {});
  assert.equal(typeof tracksideBind, 'function', '缺 _ts.tracksideBind');
  assert.equal(typeof tracksideUnbind, 'function', '缺 _ts.tracksideUnbind');
  assert.equal(typeof tracksidePushAll, 'function', '缺 _ts.tracksidePushAll');
  assert.equal(typeof tracksidePushWithHalf, 'function', '缺 _ts.tracksidePushWithHalf');
  assert.equal(worker._ts.TS_TICK_BUDGET_MS, 30000);
  assert.match(T('local'), /^(?:[0-9a-f]{2}){32,128}$/);
  console.log('ok preflight 本機 D1、四個假值、P-256 與受測 exports');

  await check('G1 routing', async () => {
    await reset();
    const names = name => {
      const block = workerSource.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`));
      assert.ok(block, `${name} 不存在`);
      return [...block[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
    };
    for (const endpoint of ['bind', 'unbind']) {
      assert.ok(names('API_POST_ALLOWED').includes(`/api/trackside/${endpoint}`), `POST ${endpoint}`);
      assert.ok(names('API_ENDPOINTS').includes(`trackside/${endpoint}`), `埋點 ${endpoint}`);
      const handler = endpoint === 'bind' ? 'tracksideBind' : 'tracksideUnbind';
      assert.ok(workerSource.includes(`url.pathname === '/api/trackside/${endpoint}') res = await ${handler}(request, env)`),
        `路由 ${endpoint}`);
    }
  });

  await check('B1 合法綁定', async () => {
    await reset();
    const body = validBody('B1');
    body.tickMode = 'minute';
    await bindOk(body);
    const stored = await rows();
    assert.equal(stored.length, 1);
    const got = stored[0];
    assert.equal(got.uid, UID);
    assert.equal(got.token, body.token);
    assert.deepEqual(JSON.parse(got.passes), body.passes);
    for (const pass of JSON.parse(got.passes)) {
      assert.deepEqual(Object.keys(pass).sort(), ['ms', 'nextDay', 'no', 'prevMs', 'sys']);
    }
    assert.equal(got.tick_mode, 'minute');
    assert.equal(got.end_ms, START_MS + 7200000);
    assert.equal(got.expire_ms, START_MS + 7500000);
    assert.equal(got.bound_ms, START_MS);
    assert.equal(got.last_state, null);
    assert.equal(got.fail_streak, 0);
    assert.equal(apnsCalls.length, 0);
  });

  await check('B2 身分驗證採封閉失敗', async () => {
    await reset();
    for (const auth of [null, 'incorrect-local-bearer']) {
      const response = await tracksideBind(req('bind', validBody('B2'), { auth }), env);
      await responseIs(response, 503, { error: 'entitlement_unavailable' });
      assert.deepEqual(await rows(), []);
    }
    assert.equal(unexpectedFetches.length, 0);
  });

  await check('B3 多餘鍵不寫入', async () => {
    await reset();
    const withCoordinate = validBody('B3a');
    withCoordinate.lat = 25;
    const withStation = validBody('B3b');
    withStation.passes[0].prev = '松山';
    for (const body of [withCoordinate, withStation]) {
      await responseIs(await tracksideBind(req('bind', body), env), 400, { error: 'bad_keys' });
      assert.deepEqual(await rows(), []);
    }
  });

  await check('B4 超過收卡時限', async () => {
    await reset();
    const body = validBody('B4');
    body.endMs = mockNowMs + 7500001;
    await responseIs(await tracksideBind(req('bind', body), env), 400, { error: 'bad_end' });
    assert.deepEqual(await rows(), []);
  });

  await check('B5 筆數與重複班次', async () => {
    await reset();
    const tooMany = validBody('B5a');
    tooMany.passes = Array.from({ length: 301 }, (_, i) => ({ ...tooMany.passes[0], no: String(i) }));
    await responseIs(await tracksideBind(req('bind', tooMany), env), 400, { error: 'bad_passes' });
    assert.deepEqual(await rows(), []);
    const duplicate = validBody('B5b');
    duplicate.passes = [duplicate.passes[0], { ...duplicate.passes[0] }];
    await responseIs(await tracksideBind(req('bind', duplicate), env), 400, { error: 'bad_pass' });
    assert.deepEqual(await rows(), []);
  });

  await check('B6 重綁清狀態並保留 APNs 環境', async () => {
    await reset();
    const body = validBody('B6');
    await bindOk(body);
    await db().prepare('UPDATE trackside_bindings SET last_state=?, fail_streak=4, apns_env=? WHERE token=?')
      .bind('{"no":"1"}', 'sandbox', body.token).run();
    mockNowMs += 1000;
    const replacement = validBody('B6');
    replacement.passes[0].no = '184';
    replacement.tickMode = 'minute';
    await bindOk(replacement);
    const got = await row(body.token);
    assert.equal((await rows()).length, 1);
    assert.equal(got.last_state, null);
    assert.equal(got.fail_streak, 0);
    assert.equal(got.apns_env, 'sandbox');
    assert.deepEqual(JSON.parse(got.passes), replacement.passes);
    assert.equal(got.bound_ms, START_MS + 1000);
    assert.equal(got.end_ms, START_MS + 7201000);
    assert.equal(got.expire_ms, START_MS + 7501000);
    assert.equal(got.tick_mode, 'minute');
  });

  await check('B7 每帳號最多三列', async () => {
    await reset();
    for (let i = 0; i < 4; i++) {
      mockNowMs = START_MS + i * 1000;
      await bindOk(validBody(`B7-${i}`));
    }
    const stored = await rows();
    assert.equal(stored.length, 3);
    assert.equal(await row(T('B7-0')), null);
    assert.deepEqual(stored.map(item => item.token).sort(), [T('B7-1'), T('B7-2'), T('B7-3')].sort());
    assert.ok(stored.every(item => item.uid === UID));
  });

  await check('B8 解除綁定冪等且不驗身分', async () => {
    await reset();
    const body = validBody('B8');
    await bindOk(body);
    await responseIs(await tracksideUnbind(req('unbind', { token: body.token }, { auth: null }), env), 200, { ok: true });
    assert.equal(await row(body.token), null);
    await responseIs(await tracksideUnbind(req('unbind', { token: T('absent') }, { auth: null }), env), 200, { ok: true });
    await bindOk(body);
    const before = await rows();
    await responseIs(await tracksideUnbind(req('unbind', { token: 'zz' }, { auth: null }), env), 200, { ok: true });
    assert.deepEqual(await rows(), before);
    await responseIs(await tracksideUnbind(req('unbind', '{', { raw: true, auth: null }), env), 200, { ok: true });
    assert.deepEqual(await rows(), before);
  });

  await check('B9 拒絕 GET', async () => {
    await reset();
    await responseIs(await tracksideBind(req('bind', null, { method: 'GET' }), env), 405, { error: 'method not allowed' });
    await responseIs(await tracksideUnbind(req('unbind', null, { method: 'GET' }), env), 405, { error: 'method not allowed' });
    assert.deepEqual(await rows(), []);
  });

  await check('B10 共用限流器', async () => {
    await reset();
    let limitedCalls = 0;
    const limited = {
      ...env,
      LA_LIMITER: { async limit() { limitedCalls++; return { success: false }; } },
    };
    await responseIs(await tracksideBind(req('bind', validBody('B10')), limited), 429, { error: 'rate_limited' });
    await responseIs(await tracksideUnbind(req('unbind', { token: T('B10') }), limited), 429, { error: 'rate_limited' });
    assert.equal(limitedCalls, 2);
    assert.deepEqual(await rows(), []);
  });

  await check('B-count', () => {
    assert.equal(results.filter(result => /^B\d+\s/.test(result.name)).length, 10, 'B 項分母應為 10');
  });

  await check('P1 首次推播完整契約與毫秒時刻', async () => {
    await reset();
    freshLive();
    const passes = validBody().passes;
    passes[0].ms += 1;
    const seeded = await insertRow('P1', { passes });
    const result = await push();
    assert.equal(result.sent, 1);
    assert.equal(result.ended, 0);
    assert.equal(result.dropped, 0);
    assert.equal(apnsCalls.length, 1);
    const call = apnsCalls[0];
    assert.equal(call.token, seeded.token);
    assert.equal(call.host, 'prod');
    assert.equal(call.body.aps.event, 'update');
    assert.equal(call.body.aps.timestamp, 1792454400);
    assert.equal(call.body.aps['stale-date'], 1792455001);
    assert.deepEqual(Object.keys(content(call)), CONTENT_KEYS);
    assert.deepEqual(content(call), {
      no: '172', sys: 'tra_sched', ms: START_MS + 600001, actualMs: START_MS + 600001,
      prevActualMs: START_MS + 300000, delayMin: 0, nextDay: false, passedPrev: false,
      cd: 'minutes', minutes: 10, clock: '', delayAtMs: START_MS, delayStale: false,
      nextNo: '803', nextSys: 'thsr_sched', nextMs: START_MS + 1200000,
      nextActualMs: START_MS + 1200000, nextDelayMin: null, nextNextDay: true, pushed: true, tick: START_MS,
    });
    assert.equal(call.headers['apns-topic'], 'tw.railisland.app.push-type.liveactivity');
    assert.equal(call.headers['apns-priority'], '5');
    const stored = await row(seeded.token);
    assert.deepEqual(JSON.parse(stored.last_state), content(call));
    assert.equal(stored.apns_env, 'prod');
    assert.equal(stored.fail_streak, 0);
  });

  await check('P2 內容相同不重推', async () => {
    await reset();
    freshLive();
    const seeded = await insertRow('P2');
    await push();
    const previous = (await row(seeded.token)).last_state;
    apnsCalls = [];
    mockNowMs += 1000;
    freshLive();
    const result = await push();
    assert.equal(result.sent, 0);
    assert.equal(apnsCalls.length, 0);
    assert.equal((await row(seeded.token)).last_state, previous);
  });

  await check('P3 新誤點改變實際通過時刻', async () => {
    await reset();
    freshLive();
    await insertRow('P3');
    await push();
    apnsCalls = [];
    mockNowMs += 60000;
    freshLive({ '172': 3 });
    const result = await push();
    assert.equal(result.sent, 1);
    assert.equal(apnsCalls.length, 1);
    assert.equal(content(apnsCalls[0]).delayMin, 3);
    assert.equal(content(apnsCalls[0]).actualMs, START_MS + 780000);
    assert.equal(content(apnsCalls[0]).prevActualMs, START_MS + 480000);
    assert.equal(content(apnsCalls[0]).delayAtMs, START_MS + 60000);
  });

  await check('P4 實際通過後換下一班', async () => {
    await reset();
    freshLive({ '172': 3 });
    await insertRow('P4');
    await push();
    assert.equal(content(apnsCalls[0]).no, '172');
    apnsCalls = [];
    mockNowMs = START_MS + 780001;
    freshLive({ '172': 3 });
    const result = await push();
    assert.equal(result.sent, 1);
    assert.equal(result.ended, 0);
    assert.equal(apnsCalls.length, 1);
    assert.equal(content(apnsCalls[0]).no, '803');
    assert.equal(content(apnsCalls[0]).sys, 'thsr_sched');
    assert.equal(content(apnsCalls[0]).actualMs, START_MS + 1200000);
    nextIsNull(content(apnsCalls[0]));
  });

  await check('P5 抵達前一站實際時刻就更新', async () => {
    await reset();
    freshLive({ '172': 3 });
    await insertRow('P5');
    await push();
    assert.equal(content(apnsCalls[0]).passedPrev, false);
    apnsCalls = [];
    mockNowMs = START_MS + 480000;
    freshLive({ '172': 3 });
    const result = await push();
    assert.equal(result.sent, 1);
    assert.equal(apnsCalls.length, 1);
    assert.equal(content(apnsCalls[0]).passedPrev, true);
    assert.equal(content(apnsCalls[0]).prevActualMs, START_MS + 480000);
  });

  await check('P6 phase 與 minute 的更新時機', async () => {
    await reset();
    freshLive();
    const passes = validBody().passes;
    passes[0].prevMs = START_MS - 60000;
    const phase = await insertRow('P6-phase', { passes, tickMode: 'phase' });
    const minute = await insertRow('P6-minute', { passes, tickMode: 'minute' });
    assert.equal((await push()).sent, 2);
    apnsCalls = [];
    mockNowMs = START_MS + 60000;
    freshLive();
    const minuteResult = await push();
    assert.equal(minuteResult.sent, 1);
    assert.equal(apnsCalls.length, 1);
    assert.equal(apnsCalls[0].token, minute.token);
    assert.equal(content(apnsCalls[0]).minutes, 9);
    assert.equal(JSON.parse((await row(phase.token)).last_state).minutes, 10);
    apnsCalls = [];
    mockNowMs = START_MS + 550000;
    freshLive();
    const imminentResult = await push();
    assert.equal(imminentResult.sent, 2);
    assert.deepEqual(apnsCalls.map(call => call.token).sort(), [phase.token, minute.token].sort());
    assert.ok(apnsCalls.every(call => content(call).cd === 'imminent'));
  });

  await check('P7 end_ms 到期收卡並刪列', async () => {
    await reset();
    freshLive({ '172': 3 });
    const seeded = await insertRow('P7', {
      passes: [{ no: '172', sys: 'tra_sched', ms: START_MS + 7200000, prevMs: START_MS + 7000000, nextDay: false }],
    });
    await push();
    const previous = content(apnsCalls[0]);
    apnsCalls = [];
    mockNowMs = seeded.endMs;
    freshLive({ '172': 3 });
    const result = await push();
    assert.equal(result.ended, 1);
    assert.equal(result.sent, 0);
    assert.equal(apnsCalls.length, 1);
    assertEndCall(apnsCalls[0], previous, mockNowMs);
    assert.equal(await row(seeded.token), null);
  });

  await check('P8 通過清單用完收卡並刪列', async () => {
    await reset();
    freshLive();
    const seeded = await insertRow('P8');
    await push();
    const previous = content(apnsCalls[0]);
    apnsCalls = [];
    mockNowMs = START_MS + 1200000;
    freshLive();
    assert.ok(mockNowMs < seeded.endMs);
    const result = await push();
    assert.equal(result.ended, 1);
    assert.equal(result.sent, 0);
    assert.equal(apnsCalls.length, 1);
    assertEndCall(apnsCalls[0], previous, mockNowMs);
    assert.equal(await row(seeded.token), null);
  });

  await check('P9 過舊或中斷的即時資料退回表定', async () => {
    await collectAsyncCases(['stale', 'down'], async kind => {
      await reset();
      freshLive({ '172': 5 });
      const seeded = await insertRow(`P9-${kind}`);
      await push();
      assert.equal(content(apnsCalls[0]).delayMin, 5);
      apnsCalls = [];
      mockNowMs += 1000;
      if (kind === 'stale') freshLive({ '172': 5 }, mockNowMs - 1860000);
      else { srcLive = null; liveStatus = 500; }
      const result = await push();
      assert.equal(result.sent, 1);
      assert.equal(result.ended, 0);
      assert.equal(apnsCalls.length, 1);
      assert.equal(apnsCalls[0].body.aps.event, 'update');
      assert.equal(content(apnsCalls[0]).delayMin, null);
      assert.equal(content(apnsCalls[0]).actualMs, START_MS + 600000);
      assert.equal(content(apnsCalls[0]).delayAtMs, kind === 'stale' ? mockNowMs - 1860000 : null);
      assert.ok(await row(seeded.token));
      assert.equal(unexpectedFetches.length, 0);
      assert.deepEqual(result.handoff, { live: kind === 'stale' ? srcLive : null });
    });
  });

  await check('P10 缺車次與隔日估計不套誤點', async () => {
    await collectAsyncCases(['missing', 'nextDay'], async kind => {
      await reset();
      freshLive({ '172': 5 });
      const passes = validBody().passes;
      if (kind === 'nextDay') passes[0].nextDay = true;
      await insertRow(`P10-${kind}`, { passes });
      if (kind === 'missing') {
        await push();
        assert.equal(content(apnsCalls[0]).delayMin, 5);
        apnsCalls = [];
        mockNowMs += 1000;
        freshLive({ '9999': 5 });
      }
      const result = await push();
      assert.equal(result.sent, 1);
      assert.equal(apnsCalls.length, 1);
      assert.equal(content(apnsCalls[0]).no, '172');
      assert.equal(content(apnsCalls[0]).delayMin, null);
      assert.equal(content(apnsCalls[0]).actualMs, START_MS + 600000);
      assert.equal(content(apnsCalls[0]).nextDay, kind === 'nextDay');
    });
  });

  await check('P11 半分鐘換班與收卡失敗隔離', async () => {
    await collectAsyncCases(['switch', 'down', 'end', 'apns410'], async kind => {
      await reset();
      freshLive();
      const passes = [
        { no: '172', sys: 'tra_sched', ms: START_MS + 25000, prevMs: START_MS - 275000, nextDay: false },
        { no: '803', sys: 'thsr_sched', ms: START_MS + 120000, prevMs: START_MS - 180000, nextDay: false },
      ];
      let endMs = START_MS + 7200000;
      if (kind === 'end') {
        endMs = START_MS + 20000;
        passes[0].ms = START_MS + 10000;
        passes[1].ms = START_MS + 15000;
      }
      const seeded = await insertRow(`P11-${kind}`, { passes, endMs, expireMs: endMs + 300000 });
      if (kind === 'down') { srcLive = null; liveStatus = 500; }
      let slept = 0;
      const result = await tracksidePushWithHalf(env, fakeCtx, BASE, async ms => {
        slept++;
        assert.equal(ms, 30000);
        assert.equal(apnsCalls.length, 1);
        assert.equal(content(apnsCalls[0]).no, '172');
        mockNowMs += ms;
        if (kind === 'apns410') {
          apnsNextStatus = 410;
          apnsNextReason = 'Unregistered';
          await db().prepare('UPDATE trackside_bindings SET fail_streak=2 WHERE token=?').bind(seeded.token).run();
        }
      });
      assert.equal(slept, 1);
      assert.equal(result.sent, 1);
      assert.ok(result.half, '半分鐘那一輪應有執行');
      assert.equal(result.half.ended, 0);
      assert.equal(result.half.dropped, 0);
      assert.ok(await row(seeded.token));
      assert.equal((await row(seeded.token)).fail_streak, kind === 'apns410' ? 2 : 0);
      assert.equal(cacheMatches.filter(url => new URL(url).pathname === '/api/tra-live').length, 1);
      assert.equal(unexpectedFetches.length, 0);
      assert.ok(apnsCalls.every(call => call.body.aps.event === 'update'));
      if (kind === 'end') {
        assert.equal(apnsCalls.length, 1);
        assert.equal(result.half.sent, 0);
      } else {
        assert.equal(apnsCalls.length, 2);
        assert.equal(content(apnsCalls[1]).no, '803');
        assert.equal(content(apnsCalls[1]).tick, START_MS + 30000);
        assert.equal(result.half.sent, kind === 'apns410' ? 0 : 1);
        const stored = JSON.parse((await row(seeded.token)).last_state);
        assert.equal(stored.no, kind === 'apns410' ? '172' : '803');
      }
    });
  });

  await check('P12 單列永久失敗刪除', async () => {
    await reset();
    freshLive();
    const seeded = await insertRow('P12');
    apnsNextStatus = 410;
    apnsNextReason = 'Unregistered';
    const result = await push();
    assert.equal(apnsCalls.length, 1);
    assert.equal(result.sent, 0);
    assert.equal(result.dropped, 1);
    assert.equal(await row(seeded.token), null);
  });

  await check('P13 過期列先清除再推播', async () => {
    await reset();
    const seeded = await insertRow('P13', { endMs: START_MS - 300001, expireMs: START_MS - 1 });
    const result = await push();
    assert.equal(await row(seeded.token), null);
    assert.equal(apnsCalls.length, 0);
    assert.equal(cacheMatches.length, 0);
    assert.equal(unexpectedFetches.length, 0);
    assert.deepEqual(result, { sent: 0, ended: 0, dropped: 0, handoff: null });
  });

  await check('P14 空表零上游與零 APNs', async () => {
    await reset();
    const result = await tracksidePushAll({ ...env, APNS_KEY_P8: 'not-a-key' }, fakeCtx, BASE);
    assert.deepEqual(result, { sent: 0, ended: 0, dropped: 0, handoff: null });
    assert.equal(apnsCalls.length, 0);
    assert.equal(cacheMatches.length, 0);
    assert.equal(unexpectedFetches.length, 0);
  });

  await check('P15 推播 log 不含身分或班次內容', async () => {
    await reset();
    freshLive({ SAFE172X: 0 });
    const passes = validBody().passes;
    passes[0].no = 'SAFE172X';
    passes[1].no = 'SAFE803Y';
    const seeded = await insertRow('privacy-token-long', { passes });
    apnsNextStatus = 410;
    apnsNextReason = 'Unregistered';
    const captured = await captureConsole(() => push());
    assert.equal(captured.result.dropped, 1);
    const all = [...captured.logLines, ...captured.errLines].join('\n');
    assert.ok(all.length > 0);
    assert.equal(all.includes(UID), false);
    for (const pass of passes) assert.equal(all.includes(pass.no), false, pass.no);
    assert.equal(all.includes(seeded.token), false);
    assert.equal(all.includes(seeded.token.slice(0, 9)), false);
    const loggedTokens = [...all.matchAll(/token=([0-9a-f]+)/g)].map(match => match[1]);
    assert.ok(loggedTokens.length > 0, '失敗 log 應帶 token 前綴');
    assert.ok(loggedTokens.every(token => token === seeded.token.slice(0, 8)));
  });

  await check('P16 即時資料錯誤 log 的迴圈標籤', async () => {
    await reset();
    await insertRow('P16');
    srcLive = null;
    liveStatus = 500;
    const ts = await captureConsole(() => push());
    assert.ok(ts.errLines.includes('[cron ts-push] tra-live 不可用(status=500),本輪全部列拿不到官方誤點'));
    assert.equal(ts.errLines.some(line => line.startsWith('[cron tw-push]')), false);
    const token = T('trackside-verify-tw-P16');
    const nowSec = Math.floor(mockNowMs / 1000);
    try {
      await db().prepare(
        'INSERT INTO tra_wait_bindings' +
        ' (token,station,train_no,sched_sec,prev_dep_sec,end_at,bound_at,expire_at)' +
        ' VALUES (?,?,?,?,?,?,?,?)'
      ).bind(token, '測試站', '172', nowSec + 600, nowSec + 300, nowSec + 7200, nowSec, nowSec + 7500).run();
      const tw = await captureConsole(() => worker._tw.traWaitPushAll(env, fakeCtx, BASE));
      assert.ok(tw.errLines.includes('[cron tw-push] tra-live 不可用(status=500),本輪全部列拿不到官方誤點'));
      assert.equal(tw.errLines.some(line => line.startsWith('[cron ts-push]')), false);
    } finally {
      await db().prepare('DELETE FROM tra_wait_bindings WHERE token=?').bind(token).run();
    }
    assert.equal(unexpectedFetches.length, 0);
  });

  await check('P-count', () => {
    assert.equal(results.filter(result => /^P\d+\s/.test(result.name)).length, 16, 'P 項分母應為 16');
  });

  await check('G2 壞清單與半分鐘未推過的列', async () => {
    await reset();
    freshLive();
    const bad = await insertRow('bad-passes', { passes: '{', lastState: { no: '172' } });
    const half = { live: srcLive, deadlineMs: mockNowMs + 55000 };
    const halfResult = await push(half);
    assert.equal(halfResult.sent, 0);
    assert.equal(halfResult.ended, 0);
    assert.ok(await row(bad.token));
    await push();
    assert.equal(await row(bad.token), null);
    assert.equal(apnsCalls.length, 0);
    const newRow = await insertRow('half-no-prev');
    const unpushed = await push(half);
    assert.equal(unpushed.sent, 0);
    assert.equal(apnsCalls.length, 0);
    assert.equal((await row(newRow.token)).last_state, null);
  });

  await check('G3 牆鐘預算停止後續列', async () => {
    await reset();
    freshLive();
    for (let i = 0; i < 3; i++) await insertRow(`budget-${i}`, { endMs: START_MS + 7200000 + i });
    apnsAdvanceMs = 31000;
    const captured = await captureConsole(() => push());
    assert.equal(captured.result.sent, 1);
    assert.equal(apnsCalls.length, 1);
    assert.equal((await rows()).filter(item => item.last_state !== null).length, 1);
    assert.ok(captured.errLines.some(line => line.includes('本輪預算用盡')));
  });

  await check('G4 全敗熔斷與失敗上限', async () => {
    await reset();
    freshLive();
    for (let i = 0; i < 3; i++) await insertRow(`breaker-${i}`);
    apnsNextStatus = 410;
    apnsNextReason = 'Unregistered';
    const first = await push();
    assert.equal(first.dropped, 0);
    assert.equal((await rows()).length, 3);
    assert.ok((await rows()).every(item => item.fail_streak === 1));
    await db().prepare('UPDATE trackside_bindings SET fail_streak=4').run();
    const last = await push();
    assert.equal(last.dropped, 3);
    assert.deepEqual(await rows(), []);
  });
  completed = true;
} catch (error) {
  console.error(`FAIL preflight — ${error.stack || error}`);
  process.exitCode = 2;
} finally {
  if (schemaReady) {
    try { await db().prepare('DELETE FROM trackside_bindings').run(); }
    catch (error) { console.error(`FAIL cleanup — ${error.message}`); completed = false; }
  }
  if (dispose) await dispose();
  Date.now = realNow;
  globalThis.fetch = realFetch;
  globalThis.caches = realCaches;
}
summary(completed ? '' : '前置或清理未完成');
process.exitCode = completed ? (results.some(result => !result.pass) ? 1 : 0) : 2;
