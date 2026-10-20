// 軌道邊倒數純函式驗收。golden 與期望值獨立於受測實作。
// 跑法：node scripts/verify_trackside_core.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULE = resolve(ROOT, 'scripts/trackside_core.mjs');
const FIXTURE = resolve(ROOT, 'scripts/fixtures/trackside-rules-cases.json');
const FIXTURE_SHA256 = '04d59d9dd029003cedad39cc869248e2d8b770dd96bd525cdd840ecf84d5aaf6';
const hash = (algorithm, data) => createHash(algorithm).update(data).digest('hex');
const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, pass: true });
    console.log(`ok ${name}`);
  } catch (error) {
    results.push({ name, pass: false });
    console.error(`FAIL ${name} — ${error.message}`);
  }
}
function summary() {
  const failed = results.filter(result => !result.pass).length;
  console.log(`總計 ${results.length} 項，FAIL ${failed}`);
  process.exitCode = failed ? 1 : 0;
}

let golden, core;
try {
  const moduleBytes = readFileSync(MODULE);
  const fixtureBytes = readFileSync(FIXTURE);
  console.log(`受測模組：${MODULE} md5=${hash('md5', moduleBytes)}`);
  console.log(`fixture：${FIXTURE} md5=${hash('md5', fixtureBytes)} sha256=${hash('sha256', fixtureBytes)}`);
  assert.equal(hash('sha256', fixtureBytes), FIXTURE_SHA256, 'fixture 指紋不符');
  golden = JSON.parse(fixtureBytes);
  assert.equal(golden.cases.length, 20, 'golden cases 分母應為 20');
  assert.equal(golden.staleCases.length, 3, 'golden staleCases 分母應為 3');
  assert.equal(Object.keys(golden.constants).length, 17, 'golden constants 分母應為 17');
  core = await import(pathToFileURL(MODULE));
} catch (error) {
  console.error(`FAIL preflight — ${error.stack || error}`);
  process.exit(1);
}
const {
  TS_CONSTANTS, TS_TOKEN_RE, TS_TICK_MODES, TS_MAX_PASSES, TS_MAX_PASSES_JSON, TS_END_SLACK_MS,
  tsDelays, tsUpcoming, tsCountdown, tsDelayStale, tsContentState, tsEndState,
  tsShouldPush, tsShouldEnd, tsStaleDateSec, tsValidateBind,
} = core;
const CONTENT_KEYS = [
  'no', 'sys', 'ms', 'actualMs', 'prevActualMs', 'delayMin', 'nextDay', 'passedPrev',
  'cd', 'minutes', 'clock', 'delayAtMs', 'delayStale', 'nextNo', 'nextSys', 'nextMs',
  'nextActualMs', 'nextDelayMin', 'nextNextDay', 'pushed', 'tick',
];
const NOW = 1792454400000;
const TOKEN = 'ab'.repeat(32);
const clone = value => structuredClone(value);
const pass = (overrides = {}) => ({
  no: '172', sys: 'tra_sched', ms: NOW + 600000, prevMs: NOW + 300000, nextDay: false,
  ...overrides,
});
const bind = () => ({
  token: TOKEN, endMs: NOW + 7200000, tickMode: 'phase',
  passes: [pass(), pass({ no: '803', sys: 'thsr_sched', ms: NOW + 1200000, prevMs: NOW + 900000 })],
});
const delaySnapshot = value => ({ delays: { ...value.delays }, delayAtMs: value.delayAtMs });
function collectCases(cases, run) {
  const errors = [];
  for (const item of cases) {
    try { run(item); }
    catch (error) { errors.push(`${item.name}: ${error.message}`); }
  }
  assert.equal(errors.length, 0, errors.join('\n'));
}

check('constantsMatchGolden', () => {
  assert.deepEqual(Object.keys(TS_CONSTANTS).sort(), Object.keys(golden.constants).sort());
  for (const [key, value] of Object.entries(golden.constants)) assert.equal(TS_CONSTANTS[key], value, key);
});

check('bindingConstants', () => {
  assert.deepEqual(TS_TICK_MODES, ['phase', 'minute']);
  assert.equal(TS_MAX_PASSES, 300);
  assert.equal(TS_MAX_PASSES_JSON, 24000);
  assert.equal(TS_END_SLACK_MS, 300000);
});

check('goldenCases', () => {
  collectCases(golden.cases, item => {
    const ups = tsUpcoming(item.passes, item.delays, item.delayAtMs, item.nowMs);
    const actual = ups.map(up => {
      const countdown = tsCountdown(up.actualMs, item.nowMs);
      return {
        no: up.no, actualMs: up.actualMs, delayMin: up.delayMin,
        cd: countdown.cd, minutes: countdown.minutes, clock: countdown.clock,
        passedPrev: item.nowMs >= up.prevActualMs,
      };
    });
    assert.deepEqual(actual, item.expect);
  });
});

check('goldenStaleCases', () => {
  collectCases(golden.staleCases, item => {
    assert.equal(tsDelayStale(item.lastOkMs, item.nowMs), item.stale);
  });
});

check('tokenReMatchesWorker', () => {
  const worker = readFileSync(resolve(ROOT, 'worker.js'), 'utf8');
  const match = worker.match(/const LA_TOKEN_RE\s*=\s*\/((?:\\.|[^/\n])+)\/([a-z]*);/);
  assert.ok(match, 'worker 的 LA_TOKEN_RE 字面不存在');
  assert.equal(TS_TOKEN_RE.source, new RegExp(match[1], match[2]).source);
  assert.equal(TS_TOKEN_RE.source, '^(?:[0-9a-f]{2}){32,128}$');
  for (const bytes of [32, 128]) assert.equal(TS_TOKEN_RE.test('ab'.repeat(bytes)), true);
  for (const token of ['ab'.repeat(31), 'ab'.repeat(129), 'AB'.repeat(32), 'a'.repeat(65)]) {
    assert.equal(TS_TOKEN_RE.test(token), false, `token 長度 ${token.length}`);
  }
});

check('delaysTakeLargerRaw', () => {
  const rows = [{ no: '3782', delay: 5 }, { no: '3782', delay: 6 }, { no: '288', delay: '1' }];
  const want = { delays: { '3782': 6, '288': 1 }, delayAtMs: 1792454400000 };
  for (const trains of [rows, [...rows].reverse()]) {
    assert.deepEqual(delaySnapshot(tsDelays({ at: '2026-10-20T08:00:00+08:00', trains }, NOW)), want);
  }
  const raw = tsDelays({
    at: '2026-10-20T08:00:00+08:00',
    trains: [{ no: 172, delay: 4.4 }, { no: '172', delay: 4.5 }],
  }, NOW);
  assert.equal(raw.delays['172'], 4.5);
});

check('delaysStrictNumbers', () => {
  const got = tsDelays({
    at: '2026-10-20T08:00:00+08:00',
    trains: [
      { no: '1', delay: null }, { no: '2', delay: '' }, { no: '3', delay: 'abc' },
      { no: '4', delay: 4.5 }, { no: '5', delay: Infinity }, { no: '6', delay: NaN },
      { no: '7', delay: 0 },
    ],
  }, NOW);
  assert.deepEqual({ ...got.delays }, { '4': 4.5, '7': 0 });
});

check('staleOrUnparsableAtGivesNoDelays', () => {
  for (const live of [
    { at: 'x', trains: [{ no: '172', delay: 5 }] },
    { trains: [{ no: '172', delay: 5 }] },
    { at: '2026-10-20T08:00:00+08:00', trains: {} },
    null,
  ]) assert.deepEqual(delaySnapshot(tsDelays(live, NOW)), { delays: {}, delayAtMs: null });
  const future = tsDelays({
    at: '2026-10-20T08:05:00+08:00', trains: [{ no: '172', delay: 5 }],
  }, NOW);
  assert.equal(future.delayAtMs, NOW);
  assert.equal(future.delays['172'], 5);
  const old = tsDelays({
    at: '2026-10-20T07:29:00+08:00', trains: [{ no: '172', delay: 5 }],
  }, NOW);
  assert.equal(old.delayAtMs, NOW - 1860000);
  assert.equal(old.delays['172'], 5);
  const upcoming = tsUpcoming([pass()], old.delays, old.delayAtMs, NOW);
  assert.equal(upcoming[0].delayMin, null);
  assert.equal(upcoming[0].actualMs, NOW + 600000);
});

check('missingTrainIsAbsent', () => {
  const delays = tsDelays({
    at: '2026-10-20T08:00:00+08:00', trains: [{ no: '172', delay: 5 }],
  }, NOW);
  assert.equal(Object.hasOwn(delays.delays, '1234'), false);
  const upcoming = tsUpcoming([pass({ no: '1234' })], delays.delays, delays.delayAtMs, NOW);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].delayMin, null);
  assert.equal(upcoming[0].actualMs, NOW + 600000);
});

check('contentStateKeys', () => {
  const ups = [
    {
      no: '172', sys: 'tra_sched', ms: NOW + 600000, prevMs: NOW - 180000,
      nextDay: false, actualMs: NOW + 780000, prevActualMs: NOW, delayMin: 3,
    },
    {
      no: '803', sys: 'thsr_sched', ms: NOW + 1200000, prevMs: NOW + 900000,
      nextDay: true, actualMs: NOW + 1200000, prevActualMs: NOW + 900000, delayMin: null,
    },
  ];
  const got = tsContentState(ups, NOW - 600001, NOW);
  assert.deepEqual(Object.keys(got), CONTENT_KEYS);
  assert.deepEqual(got, {
    no: '172', sys: 'tra_sched', ms: NOW + 600000, actualMs: NOW + 780000,
    prevActualMs: NOW, delayMin: 3, nextDay: false, passedPrev: true,
    cd: 'minutes', minutes: 13, clock: '', delayAtMs: NOW - 600001, delayStale: true,
    nextNo: '803', nextSys: 'thsr_sched', nextMs: NOW + 1200000,
    nextActualMs: NOW + 1200000, nextDelayMin: null, nextNextDay: true, pushed: true, tick: NOW,
  });
  const solo = tsContentState([ups[0]], null, NOW);
  for (const key of ['nextNo', 'nextSys', 'nextMs', 'nextActualMs', 'nextDelayMin', 'nextNextDay']) {
    assert.equal(solo[key], null, key);
  }
  assert.equal(solo.delayStale, false);
  assert.equal(solo.delayAtMs, null);
  assert.equal(tsContentState([], NOW, NOW), null);
  for (const previous of [null, { no: '172' }]) {
    const end = tsEndState(previous, NOW);
    assert.deepEqual(Object.keys(end), CONTENT_KEYS);
    for (const key of CONTENT_KEYS) {
      const expected = key === 'pushed' ? true : key === 'tick' ? NOW : key === 'no' && previous ? '172' : null;
      assert.equal(end[key], expected, key);
    }
  }
  const end = tsEndState({ ...got, extra: 'omit' }, NOW + 1000);
  assert.deepEqual(Object.keys(end), CONTENT_KEYS);
  assert.deepEqual(end, { ...got, tick: NOW + 1000 });
});

check('shouldPushTable', () => {
  const prev = {
    no: '172', sys: 'tra_sched', ms: NOW + 600000, actualMs: NOW + 780000,
    prevActualMs: NOW, delayMin: 3, nextDay: false, passedPrev: true,
    cd: 'minutes', minutes: 13, clock: '', delayAtMs: NOW, delayStale: false,
    nextNo: '803', nextSys: 'thsr_sched', nextMs: NOW + 1200000,
    nextActualMs: NOW + 1200000, nextDelayMin: null, nextNextDay: true, pushed: true, tick: NOW,
  };
  const events = [
    ['no', '174'], ['sys', 'thsr_sched'], ['ms', NOW + 610000], ['actualMs', NOW + 790000],
    ['prevActualMs', NOW + 1000], ['delayMin', 4], ['nextDay', true], ['passedPrev', false],
    ['delayStale', true], ['nextNo', '805'], ['nextSys', 'tra_sched'], ['nextMs', NOW + 1201000],
    ['nextActualMs', NOW + 1201000], ['nextDelayMin', 0], ['nextNextDay', false],
  ];
  assert.equal(events.length, 15);
  for (const [key, value] of events) {
    for (const mode of ['phase', 'minute']) {
      assert.equal(tsShouldPush(prev, { ...prev, [key]: value }, mode), true, `${mode} ${key}`);
    }
  }
  for (const key of ['delayAtMs', 'tick', 'pushed']) {
    const value = key === 'pushed' ? false : NOW + 60000;
    for (const mode of ['phase', 'minute']) {
      assert.equal(tsShouldPush(prev, { ...prev, [key]: value }, mode), false, `${mode} ${key}`);
    }
  }
  for (const [key, value] of [['minutes', 12], ['clock', '09:01']]) {
    assert.equal(tsShouldPush(prev, { ...prev, [key]: value }, 'phase'), false, key);
    assert.equal(tsShouldPush(prev, { ...prev, [key]: value }, 'minute'), true, key);
  }
  for (const mode of ['phase', 'minute']) {
    assert.equal(tsShouldPush(prev, { ...prev, cd: 'imminent' }, mode), true);
    assert.equal(tsShouldPush(null, prev, mode), true);
    assert.equal(tsShouldPush(prev, { ...prev }, mode), false);
    assert.equal(tsShouldPush({ ...prev, delayMin: null }, { ...prev, delayMin: 0 }, mode), true);
    assert.equal(tsShouldPush(prev, { ...prev, ms: String(prev.ms) }, mode), false);
  }
});

check('shouldEndTable', () => {
  assert.equal(tsShouldEnd(NOW, NOW, [{}]), 'endAt');
  assert.equal(tsShouldEnd(NOW, NOW, []), 'endAt');
  assert.equal(tsShouldEnd(NOW - 1, NOW, []), 'empty');
  assert.equal(tsShouldEnd(NOW - 1, NOW, [{}]), null);
  assert.equal(tsShouldEnd(NOW + 1, NOW, [{}]), 'endAt');
});

check('staleDateRoundsUp', () => {
  assert.equal(tsStaleDateSec({ actualMs: 1791590459001 }), 1791590460);
  assert.equal(tsStaleDateSec({ actualMs: 1791590460000 }), 1791590460);
  assert.equal(tsStaleDateSec({ actualMs: null }), null);
  assert.equal(tsStaleDateSec({ actualMs: '1791590460000' }), null);
  assert.equal(tsStaleDateSec({}), null);
});

check('validateBindTable', () => {
  const valid = bind();
  const result = tsValidateBind(valid, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, valid);
  assert.notEqual(result.value.passes, valid.passes);
  result.value.passes.forEach((item, index) => {
    assert.deepEqual(Object.keys(item).sort(), ['ms', 'nextDay', 'no', 'prevMs', 'sys']);
    assert.notEqual(item, valid.passes[index]);
  });
  const failures = [
    ['bodyExtra', body => { body.lat = 25; }, 'bad_keys'],
    ['passExtra', body => { body.passes[0].prev = '松山'; }, 'bad_keys'],
    ['passMissing', body => { delete body.passes[0].nextDay; }, 'bad_keys'],
    ['nextDayType', body => { body.passes[0].nextDay = 'no'; }, 'bad_pass'],
    ['token', body => { body.token = 'zz'; }, 'bad_token'],
    ['endTooLate', body => { body.endMs = NOW + 7500001; }, 'bad_end'],
    ['endNow', body => { body.endMs = NOW; }, 'bad_end'],
    ['tick', body => { body.tickMode = 'second'; }, 'bad_tick'],
    ['noPasses', body => { body.passes = []; }, 'bad_passes'],
    ['tooManyPasses', body => { body.passes = Array.from({ length: 301 }, (_, i) => pass({ no: String(i) })); }, 'bad_passes'],
    ['system', body => { body.passes[0].sys = 'metro'; }, 'bad_pass'],
    ['previousSameTime', body => { body.passes[0].prevMs = body.passes[0].ms; }, 'bad_pass'],
    ['outsideLookback', body => { body.passes[0].ms = NOW - 10800001; body.passes[0].prevMs = NOW - 10900000; }, 'bad_pass'],
    ['duplicate', body => { body.passes = [clone(body.passes[0]), clone(body.passes[0])]; }, 'bad_pass'],
    ['fractionalTime', body => { body.passes[0].ms = 1.5; }, 'bad_pass'],
    ['previousAfter', body => { body.passes[0].prevMs = body.passes[0].ms + 1; }, 'bad_pass'],
    ['afterEnd', body => { body.passes[0].ms = body.endMs + 1; }, 'bad_pass'],
    ['fractionalPrevious', body => { body.passes[0].prevMs += 0.5; }, 'bad_pass'],
    ['invalidNumber', body => { body.passes[0].no = '12-3'; }, 'bad_pass'],
    ['longNumber', body => { body.passes[0].no = '123456789'; }, 'bad_pass'],
    ['passArray', body => { body.passes[0] = []; }, 'bad_keys'],
    ['passNull', body => { body.passes[0] = null; }, 'bad_keys'],
    ['passBytes', body => { body.passes[0].no = '1'.repeat(24001); }, 'bad_passes'],
  ];
  collectCases(failures.map(([name, mutate, error]) => ({ name, mutate, error })), item => {
    const body = bind();
    item.mutate(body);
    assert.deepEqual(tsValidateBind(body, NOW), { ok: false, error: item.error });
  });
  for (const body of [[], null, 'text', 3]) assert.deepEqual(tsValidateBind(body, NOW), { ok: false, error: 'bad_json' });
  const endBoundary = bind();
  endBoundary.endMs = NOW + 7500000;
  assert.equal(tsValidateBind(endBoundary, NOW).ok, true);
  const lookbackBoundary = bind();
  lookbackBoundary.passes[0].ms = NOW - 10800000;
  lookbackBoundary.passes[0].prevMs = NOW - 10860000;
  assert.equal(tsValidateBind(lookbackBoundary, NOW).ok, true);
  const atEnd = bind();
  atEnd.passes[0].ms = atEnd.endMs;
  assert.equal(tsValidateBind(atEnd, NOW).ok, true);
  const minute = bind();
  minute.tickMode = 'minute';
  assert.equal(tsValidateBind(minute, NOW).ok, true);
  const precedence = bind();
  precedence.lat = 25;
  precedence.token = 'bad';
  assert.equal(tsValidateBind(precedence, NOW).error, 'bad_keys');
});

check('countdownPassingBoundary', () => {
  assert.deepEqual(tsCountdown(NOW, NOW), { cd: 'passing', minutes: 0, clock: '' });
  assert.deepEqual(tsCountdown(NOW - 1, NOW), { cd: 'passing', minutes: 0, clock: '' });
  assert.deepEqual(tsCountdown(NOW + 1, NOW), { cd: 'imminent', minutes: 0, clock: '' });
});

check('upcomingPreservesFields', () => {
  const input = [pass()];
  const before = clone(input);
  const got = tsUpcoming(input, { '172': 2.5 }, NOW, NOW);
  assert.deepEqual(got, [{
    no: '172', sys: 'tra_sched', ms: NOW + 600000, prevMs: NOW + 300000,
    nextDay: false, actualMs: NOW + 780000, prevActualMs: NOW + 480000, delayMin: 3,
  }]);
  assert.deepEqual(input, before);
  assert.equal(tsUpcoming(input, { '172': Infinity }, NOW, NOW)[0].delayMin, null);
});

check('caseCount', () => assert.equal(results.length, 16, '驗收項目分母改變'));
summary();
