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
let tracksideBind, tracksideUnbind;
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
  ({ tracksideBind, tracksideUnbind } = worker._ts || {});
  assert.equal(typeof tracksideBind, 'function', '缺 _ts.tracksideBind');
  assert.equal(typeof tracksideUnbind, 'function', '缺 _ts.tracksideUnbind');
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
