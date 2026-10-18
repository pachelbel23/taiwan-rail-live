// 班表上架時掃完整個台鐵班表窗：逐日跑 verify_overtake_distinct_track（OVERTAKE_DATE=那一天），列出哪幾天會紅、紅在哪一筆，
// 以及從哪一天起 ship-web 會因為它擋出貨。只寫報告、不擋（離開碼恆 0）；npm run fetch-schedule 最後一步會跑。
//
// 為什麼要這支：出貨鏈裡那道閘門只驗「台北今天起第一個有預排待避的日子」，窗口後面幾天的紅要等到那一天零時才看得到，
// 那時任何網頁出貨都已經被擋（10/22 金崙那件，10/15 重抓班表時就已經在窗口裡）。在班表上架當下掃完整窗，
// 修得及的就能在那一天之前修好。判準一字不動，逐日呼叫的就是出貨用的同一支閘門。
// 班表上架不因此停下：資料照常更新，擋出貨仍由 ship-web 裡那道閘門在當天負責。
//
// 跑法：node scripts/scan_overtake_window.mjs（npm run report-overtake-window）
//   SCAN_FROM=YYYY-MM-DD 從那天起掃（預設台北今天）；SCAN_DAYS=N 只掃前 N 天。
//   報告寫 output/overtake-window/report.json，逐日 log 在同一個資料夾。一天兩個引擎約 5–8 秒。
//   某一天閘門根本沒跑起來（瀏覽器起不來、頁面逾時）記成「沒跑完」，報告不完整時最後一行會明說。
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'output/overtake-window');
const md5 = f => createHash('md5').update(readFileSync(join(ROOT, f))).digest('hex');
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const today = process.env.SCAN_FROM || new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
const sched = JSON.parse(readFileSync(join(ROOT, 'data/tra_schedule_dense.json'), 'utf8'));
let days = Object.keys(sched.dates || {}).filter(d => d >= today).sort();
if (process.env.SCAN_DAYS) days = days.slice(0, Number(process.env.SCAN_DAYS));
mkdirSync(OUT, { recursive: true });
const inputs = Object.fromEntries(['data/tra_schedule_dense.json', 'rail-3d/physical/network.json', 'rail-3d/physical/dispatch.json', 'index.html'].map(f => [f, md5(f)]));
console.log(`掃描待避分股閘門：${days[0] || '—'}～${days.at(-1) || '—'} 共 ${days.length} 天；班表 md5 ${inputs['data/tra_schedule_dense.json']}`);

const rows = [];
for (const day of days) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, ['scripts/verify_overtake_distinct_track.mjs'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20,
    env: { ...process.env, OVERTAKE_DATE: day, PORT: '' } });
  const text = `${r.stdout || ''}${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`;
  const log = join(OUT, `${day}.log`);
  writeFileSync(log, text);
  const lines = text.split('\n'), counts = [...text.matchAll(/當天有預排待避（(\d+) 筆）/g)].map(m => Number(m[1]));
  // 兩個引擎的同一項失敗只記一次（明細相同時）。
  const fails = [...new Set(lines.filter(l => l.startsWith('FAIL ')).map(l => l.replace(/^FAIL (Chromium|WebKit) /, '')))];
  const ran = lines.some(l => /^(PASS|FAIL) /.test(l)) && counts.length === 2;
  // 那天沒有預排待避：閘門的 A–E 都要求「筆數 > 0」而一起紅，這不是缺陷；ship-web 不給日期時也是跳過這種日子往後找。
  const status = r.status === 0 ? 'green' : !ran ? 'error' : Math.max(...counts) === 0 ? 'none' : 'red';
  rows.push({ day, status, waits: counts.length ? Math.max(...counts) : null, rc: r.status, fails: status === 'red' ? fails : [], sec: Math.round((Date.now() - t0) / 1000), log });
}
// ship-web 驗的是「台北今天起第一個有預排待避的日子」，所以某一天紅，從它前一個有待避的日子的隔天零時起就會擋出貨。
for (const [i, x] of rows.entries()) {
  if (x.status !== 'red') continue;
  const prev = rows.slice(0, i).findLast(y => y.waits > 0);
  x.blocksShipFrom = prev ? addDays(prev.day, 1) : today;
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ generated: new Date().toISOString(), from: today, inputs, days: rows }, null, 1));

const label = { green: '綠', none: '沒有預排待避', red: '紅', error: '沒跑完' };
for (const x of rows) console.log(`${x.day} ${label[x.status]}${x.waits != null ? `（待避 ${x.waits} 筆）` : ''} ${x.sec}s`);
const red = rows.filter(x => x.status === 'red'), broken = rows.filter(x => x.status === 'error');
for (const x of red) {
  console.log(`\n紅 ${x.day}：台北 ${x.blocksShipFrom} 00:00 起 ship-web 會擋出貨（log ${x.log}）`);
  for (const f of x.fails) console.log(`  ${f}`);
}
console.log(`\n${red.length ? `窗口裡 ${red.length} 天會紅：${red.map(x => x.day).join('、')}` : broken.length ? '跑完的日子裡沒有會紅的' : '窗口裡沒有會紅的日子'}；報告 ${join(OUT, 'report.json')}`);
if (broken.length) console.log(`⚠ 報告不完整：${broken.map(x => x.day).join('、')} 這 ${broken.length} 天閘門沒跑完，看各天的 log`);
process.exit(0);
