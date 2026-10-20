// 手動使用的推播突變腳本；僅使用本機 D1 與驗收腳本的假 IO。
// 每一發恰好取代一處，結束時原樣還原 worker.js 並核對 md5。
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const target = fileURLToPath(new URL('../worker.js', import.meta.url));
const verify = fileURLToPath(new URL('./verify_trackside_push.mjs', import.meta.url));
const original = readFileSync(target, 'utf8');
const md5 = text => createHash('md5').update(text).digest('hex');
const before = md5(original);
const mutations = [
  ['halfEnd',
    "      if (why) {\n        if (half) { unchanged++; continue; }\n        await metroWaitPushEnd(env, jwt, row, tsEndState",
    "      if (why) {\n        await metroWaitPushEnd(env, jwt, row, tsEndState", 'P11'],
  ['nullLiveHandoff', 'handoff: processed ? { live } : null',
    'handoff: live ? { live } : null', 'P11'],
  ['rebindState', "' last_state=NULL, fail_streak=0'",
    "' fail_streak=0'", 'B6'],
  ['staleDate', "      if (staleDate != null) body.aps['stale-date'] = staleDate;",
    '      // 暫時省略 stale-date。', 'P1'],
  ['minuteOnly', 'tsShouldPush(prev, state, row.tick_mode)',
    "tsShouldPush(prev, state, 'minute')", 'P6'],
  ['endDelete',
    "        await env.DELAY_DB.prepare('DELETE FROM trackside_bindings WHERE token=?').bind(row.token).run();\n        ended++;",
    '        ended++;', 'P7'],
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
      line.startsWith(`FAIL ${expected} `));
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
