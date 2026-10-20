// 突變產品碼後逐條確認防線會變紅；本機 server 只提供記憶體中的突變版本。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['index.html', 'scripts/verify_my_train_plus.mjs', 'scripts/verify_my_train_plus_mutations.mjs'];
const dirty = execFileSync('git', ['status', '--porcelain', '--', ...files], { cwd: root, encoding: 'utf8' });
if (dirty.trim()) throw Error('突變前必須先 commit 產品碼與驗收腳本');
const digest = () => createHash('sha256').update(readFileSync(path.join(root, 'index.html'))).digest('hex');
const before = digest(), output = path.join(root, 'output/my-train-plus/mutations');
mkdirSync(output, { recursive: true });
const cases = [
  ['entry', ['A1', 'A3']], ['map', ['A2']], ['paid', ['B1']],
  ['sync', ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'C1', 'C3']],
  ['storage', ['C2']], ['layout', ['UI']], ['exception', ['E1']],
  ['disabled', ['D1']], ['assignment', ['S0']],
  ['follow', ['C4']],
];
let pass = 0;
for (const [mutation, expected] of cases) {
  const r = spawnSync(process.execPath, ['scripts/verify_my_train_plus.mjs'], { cwd: root, encoding: 'utf8',
    env: { ...process.env, MYTRAIN_MUTATION: mutation, MYTRAIN_ENGINE: 'chromium', MYTRAIN_WIDTHS: '360' }, timeout: 240000 });
  const log = (r.stdout || '') + (r.stderr || '');
  writeFileSync(path.join(output, mutation + '.log'), log);
  for (const id of expected) {
    const red = r.status === 1 && log.split('\n').some(line => line.startsWith('FAIL ') && new RegExp(`(?:^| )${id}(?: |$)`).test(line));
    console.log(`${red ? 'PASS' : 'FAIL'} 突變 ${mutation} → ${id} 變紅（exit ${r.status}）`);
    if (red) pass++;
  }
}
const expectedCount = cases.reduce((n, c) => n + c[1].length, 0);
const unchanged = digest() === before;
console.log(`${unchanged ? 'PASS' : 'FAIL'} 原始產品碼雜湊未變`);
console.log(`總計 ${expectedCount + 1} 項，PASS ${pass + Number(unchanged)}／FAIL ${expectedCount - pass + Number(!unchanged)}`);
process.exitCode = pass === expectedCount && unchanged ? 0 : 1;
