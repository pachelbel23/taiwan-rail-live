// 手動使用的規則突變腳本；每次僅改一處，最後逐 byte 還原。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('./trackside_core.mjs', import.meta.url));
const verify = fileURLToPath(new URL('./verify_trackside_core.mjs', import.meta.url));
const original = readFileSync(target, 'utf8');
const md5 = text => createHash('md5').update(text).digest('hex');
const before = md5(original);
const mutations = [
  ['roundHalfUp', 'Math.floor(raw + 0.5)', 'Math.trunc(raw)', 'goldenCases'],
  ['staleDelayIgnored', 'nowMs - delayAtMs < TS_CONSTANTS.DELAY_MAX_AGE_MS',
    'nowMs - delayAtMs <= TS_CONSTANTS.DELAY_MAX_AGE_MS', 'goldenCases'],
  ['systemBeforeNumber', 'compareString(a.sys, b.sys) || compareString(a.no, b.no)',
    'compareString(a.no, b.no)', 'goldenCases'],
  ['nextDayNoDelay', "pass.sys === 'tra_sched' && pass.nextDay !== true",
    "pass.sys === 'tra_sched'", 'goldenCases'],
  ['passedPrev', "'passedPrev', 'delayStale', 'nextNo'", "'delayStale', 'nextNo'", 'shouldPushTable'],
  ['passKeys',
    "  if (passes.some(pass => !isObject(pass) || Object.keys(pass).length !== PASS_KEYS.length ||\n      Object.keys(pass).some(key => !PASS_KEYS.includes(key)))) return bad('bad_keys');",
    '  // 暫時停用 pass 鍵檢查。', 'validateBindTable'],
];
let failed = false;
try {
  for (const [name, from, to, expected] of mutations) {
    if (original.split(from).length !== 2) throw Error(`${name}: 字面取代不是恰好一次`);
    console.log(`${name}: 預期 FAIL ${expected}`);
    writeFileSync(target, original.replace(from, to));
    const run = spawnSync(process.execPath, [verify], { encoding: 'utf8' });
    const output = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
    const caught = run.status === 1 && output.split('\n').some(line =>
      line.startsWith('FAIL ') && line.includes(expected));
    console.log(`${caught ? 'ok' : 'FAIL'} ${name}`);
    if (!caught) { console.error(output); failed = true; }
    writeFileSync(target, original);
  }
} finally {
  writeFileSync(target, original);
  if (md5(readFileSync(target, 'utf8')) !== before) throw Error('還原 md5 不同');
  console.log(`還原 md5=${before}`);
}
process.exitCode = failed ? 1 : 0;
