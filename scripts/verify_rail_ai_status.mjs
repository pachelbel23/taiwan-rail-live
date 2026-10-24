#!/usr/bin/env node
// AI 營運整理（scripts/rail_ai_status.mjs）的離線驗收：真 SQL（d1_local＋schema/*.sql）、假官網、假 Claude 串流。
// 不連網、不花錢。用法：node scripts/verify_rail_ai_status.mjs
import { openTestDb } from './d1_local.mjs';
import { railAiDetect, railAiSummarize, railAiScheduled, railAiStatus, RAIL_AI_SOURCES } from './rail_ai_status.mjs';
import manual from '../data/rail_weather_bulletin.json' with { type: 'json' };

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

const TRA = RAIL_AI_SOURCES.find(s => s.id === 'tra-list').url;
const traItem = (no, title) => `<li><a href="/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=${no}">${title}</a></li>`;
const traUrl = no => new URL(`/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=${no}`, TRA).href;

// 假世界：官網列表、公告內文、Claude 的回應都由測試控制
const world = {
  lists: {
    'tra-list': [traItem('aa01', '中秋連假加開列車')],
    'trtc-list': ['<a href="News_Content.aspx?n=30CCEFD2A45592BF&s=1">捷運商品館新品上市</a>'],
    'afr-list': ['<a href="/AllNews/0001">林鐵徵才公告</a>'],
    'thsr-home': ['<a href="/ArticleContent/00000000-0000-0000-0000-000000000001">高鐵會員活動</a>'],
  },
  ntm: { status: '全線正常營運', marquee: '環狀線正常' },
  articles: { [traUrl('aa01')]: '<p>中秋連假加開 3 列自強號</p>' },
  claude: null, claudeCalls: [],
};
const listHtml = id => `<html><body><ul>${world.lists[id].join('')}</ul></body></html>`;
const ntmHtml = () => `<html><body><div>營運狀況 ${world.ntm.status} 公司簡介</div><div id="home-marquee"><div>${world.ntm.marquee}</div></div></body></html>`;

function sse(events, { crlf = false, chunk = 7 } = {}) {
  const nl = crlf ? '\r\n' : '\n';
  const body = events.map(e => `event: ${e.type}${nl}data: ${JSON.stringify(e)}${nl}${nl}`).join('');
  const bytes = new TextEncoder().encode(body);
  let i = 0;
  return new Response(new ReadableStream({ pull(c) { if (i >= bytes.length) return c.close(); c.enqueue(bytes.slice(i, i += chunk)); } }), { status: 200 });
}
function claudeReply(entry, { stop = 'end_turn', crlf = false } = {}) {
  const text = JSON.stringify(entry);
  return sse([
    { type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 10000, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想一下' } },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 20) } },
    { type: 'ping' },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(20) } },
    { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5000 } },
    { type: 'message_stop' },
  ], { crlf });
}
const entry = (status, state = '停駛', url = traUrl('bb02')) => ({
  status, statusEn: 'EN ' + status, statusJa: 'JA ' + status, detail: `台鐵公告：${status}`, detailEn: 'en', detailJa: 'ja',
  sourceUrls: [url, 'javascript:alert(1)'], impacts: [{ scope: '基隆=彰化', state, from: '12:00', until: '', trains: [] }],
});

async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url === 'https://api.anthropic.com/v1/messages') {
    const body = JSON.parse(init.body);
    world.claudeCalls.push({ body, headers: init.headers });
    return world.claude(body);
  }
  const src = RAIL_AI_SOURCES.find(s => s.url === url);
  if (src && src.id === 'ntmetro-home') return new Response(ntmHtml());
  if (src) return new Response(listHtml(src.id));
  if (url in world.articles) return new Response(world.articles[url]);
  return new Response('not found', { status: 404 });
}

const { db, DELAY_DB } = openTestDb();
const env = { DELAY_DB, ANTHROPIC_API_KEY: 'test-key' };
const T0 = Date.parse('2026-10-24T09:00:00+08:00');
const api = async (now, qs = '') => { const r = await railAiStatus(new Request('https://railisland.tw/api/rail-status' + qs), env, now); return { status: r.status, body: await r.json() }; };

// 1. 第一輪記基準；列表上已經有營運相關公告（台鐵加開）、燈號有營運狀況（新北捷）的系統直接排整理
world.claude = () => { throw new Error('不該叫模型'); };
let d = await railAiDetect(env, { now: T0, fetch: fakeFetch });
check('第一輪：每個來源都記基準，有營運相關內容的系統排整理', d.dirty.join() === 'tra,ntmetro' && d.relevant === 0 && d.errors.length === 0 && db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE type='baseline'`).get().n === RAIL_AI_SOURCES.length, JSON.stringify(d));
check('第一輪：列表上既有的營運相關公告先存原文、不相關的不存', db.prepare('SELECT text FROM rail_ai_articles WHERE url = ?').get(traUrl('aa01'))?.text.includes('加開 3 列')
  && db.prepare('SELECT COUNT(*) n FROM rail_ai_articles').get().n === 1);
// 第一輪的整理在第 17 節用另一個庫驗；這裡清掉，下面的流程從沒有待整理開始
db.prepare(`DELETE FROM rail_ai_kv WHERE k LIKE 'pending:%'`).run();
let s = await railAiSummarize(env, { now: T0, fetch: fakeFetch });
check('沒有待整理就不呼叫模型', s.skipped === 'nothing pending' && world.claudeCalls.length === 0);

// 2. 不相關的新公告：記事件、不整理、不抓內文
world.lists['tra-list'].unshift(traItem('aa02', '台鐵便當新口味'));
d = await railAiDetect(env, { now: T0 + 3 * 60e3, fetch: fakeFetch });
check('不相關的新公告不會標成待整理', d.events === 1 && d.relevant === 0 && d.dirty.length === 0);
check('不相關的新公告不存原文', db.prepare('SELECT COUNT(*) n FROM rail_ai_articles WHERE url = ?').get(traUrl('aa02')).n === 0);

// 3. 相關的新公告：存原文、標待整理、整理一次、出新版
world.lists['tra-list'].unshift(traItem('bb02', '因應颱風 列車停駛公告'));
world.articles[traUrl('bb02')] = '<html><script>var x=1</script><body><h1>因應颱風 列車停駛公告</h1><p>基隆=彰化 12 時起停駛</p></body></html>';
const T1 = T0 + 6 * 60e3;
d = await railAiDetect(env, { now: T1, fetch: fakeFetch });
check('相關的新公告標成待整理', d.dirty.join() === 'tra', JSON.stringify(d));
const art = db.prepare('SELECT title, text FROM rail_ai_articles WHERE url = ?').get(traUrl('bb02'));
check('相關公告存了去掉 HTML 的原文', art && art.text.includes('12 時起停駛') && !art.text.includes('var x'));
world.claude = () => claudeReply(entry('部分停駛'), { crlf: true });
s = await railAiSummarize(env, { now: T1, fetch: fakeFetch });
check('整理一個系統、算出費用', s.done && s.done.join() === 'tra' && s.failed.length === 0 && Math.abs(s.cost - 0.14) < 1e-9, JSON.stringify(s));
const call = world.claudeCalls.at(-1);
check('請求帶 2026-10-21 版本、結構化輸出、串流、金鑰在標頭', call.headers['anthropic-version'] === '2026-10-21' && call.body.stream === true
  && call.body.output_config.format.type === 'json_schema' && call.headers['x-api-key'] === 'test-key' && !('temperature' in call.body));
check('送給模型的內容含新公告原文與變化清單', call.body.messages[0].content.includes('12 時起停駛') && call.body.messages[0].content.includes('新出現'));
check('整理完清掉待整理', db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k LIKE 'pending:%'`).get().n === 0);
let a = await api(T1 + 60e3);
const tra = a.body.systems.find(x => x.id === 'tra');
check('API 回這一版：標 AI、附官方原文標題、濾掉非 http 網址', a.status === 200 && tra && tra.basis === 'ai' && tra.sources.length === 1
  && tra.sources[0].title === '因應颱風 列車停駛公告' && tra.statusEn === 'EN 部分停駛', JSON.stringify(tra && tra.sources));
check('API 帶最近一次檢查官方來源的時間與版本', a.body.checkedAt === T1 && a.body.revision && a.body.revision.changed.join() === 'tra');

// 4. 第二版是增量：上一版內容會送進去
world.lists['tra-list'].unshift(traItem('cc03', '颱風後 列車恢復行駛'));
world.articles[traUrl('cc03')] = '<p>15 時起恢復正常行駛</p>';
const T2 = T1 + 30 * 60e3;
await railAiDetect(env, { now: T2, fetch: fakeFetch });
world.claude = () => claudeReply(entry('恢復正常', '正常', traUrl('cc03')));
s = await railAiSummarize(env, { now: T2, fetch: fakeFetch });
const c2 = world.claudeCalls.at(-1).body.messages[0].content;
check('第二版把上一版當基礎送進去', c2.includes('<previous_entry>') && c2.includes('部分停駛') && c2.includes('15 時起恢復'));
check('版本累積兩版', db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === 2);
a = await api(T2 + 60e3, '?list=1');
check('?list=1 列出每一版與費用', a.body.revisions.length === 2 && a.body.revisions[0].changed.join() === 'tra');
a = await api(T2 + 60e3, '?rev=1');
check('?rev=1 回第一版的內容', a.body.systems.find(x => x.id === 'tra').status === '部分停駛');

// 5. 已恢復正常的系統留 24 小時後從頁面消失；看舊版（?rev）不受影響
a = await api(T2 + 23 * 3600e3);
check('恢復正常 23 小時內還在頁面上', a.body.systems.some(x => x.id === 'tra'));
a = await api(T2 + 25 * 3600e3);
check('恢復正常超過 24 小時就不列', !a.body.systems.some(x => x.id === 'tra'));

// 6. 燈號型來源（新北首頁）的改變算相關變化
world.ntm.marquee = '安坑輕軌暫停營運';
d = await railAiDetect(env, { now: T2 + 3 * 60e3, fetch: fakeFetch });
check('新北首頁跑馬改變標成待整理', d.dirty.join() === 'ntmetro');

// 7. 執行鎖：上一輪還沒結束，第二輪不重複叫模型；鎖過期才接手
const T3 = T2 + 6 * 60e3;
db.prepare(`INSERT INTO rail_ai_kv (k, v, updated_ms) VALUES ('ai_lock', ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v`).run(String(T3 + 5 * 60e3), T3);
const callsBefore = world.claudeCalls.length;
s = await railAiSummarize(env, { now: T3, fetch: fakeFetch });
check('鎖還在就跳過', s.skipped === 'locked by another run' && world.claudeCalls.length === callsBefore);

// 8. 整理途中又有新變化：整理完不能清掉那一筆
world.claude = () => claudeReply(entry('安坑暫停', '部分停駛', 'https://www.ntmetro.com.tw/'));
const later = T3 + 13 * 60e3;
db.prepare(`UPDATE rail_ai_kv SET v = ? WHERE k = 'pending:ntmetro'`).run(String(later + 60e3)); // 模擬下一輪偵測在整理途中寫入
s = await railAiSummarize(env, { now: later, fetch: fakeFetch });
check('整理途中的新變化保留在待整理', s.done && s.done.join() === 'ntmetro' && db.prepare(`SELECT COUNT(*) n FROM rail_ai_kv WHERE k = 'pending:ntmetro'`).get().n === 1, JSON.stringify(s));
check('整理完釋放執行鎖', db.prepare(`SELECT v FROM rail_ai_kv WHERE k = 'ai_lock'`).get().v === '0');

// 9. 模型沒寫完（max_tokens）：不出新版、記錯誤、待整理留著
world.claude = () => claudeReply(entry('x'), { stop: 'max_tokens' });
const revsBefore = db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n;
s = await railAiSummarize(env, { now: later + 3 * 60e3, fetch: fakeFetch });
check('模型沒寫完就不出新版、記錯誤', s.done.length === 0 && s.failed.length === 1 && db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === revsBefore
  && db.prepare(`SELECT COUNT(*) n FROM rail_ai_events WHERE source='summarizer' AND type='error'`).get().n === 1, JSON.stringify(s));
check('沒寫完的費用照樣記進當月花費', db.prepare(`SELECT v FROM rail_ai_kv WHERE k LIKE 'spend:%'`).get().v > 0.42);

// 10. 手動鎖定：AI 不改寫；人工彙整在適用期間內就改顯示人工版
db.prepare('INSERT INTO rail_ai_locks (system, locked_ms, note) VALUES (?, ?, ?)').run('ntmetro', later, '測試');
world.claude = () => { throw new Error('鎖住的系統不該叫模型'); };
s = await railAiSummarize(env, { now: later + 6 * 60e3, fetch: fakeFetch });
check('鎖住的系統不整理', s.skipped === 'nothing pending', JSON.stringify(s));
const inManual = Date.parse(manual.displayFrom) + 60e3;
a = await api(inManual);
const nt = a.body.systems.find(x => x.id === 'ntmetro');
check('鎖住且人工彙整有效：顯示人工版', nt && nt.basis === 'manual' && nt.locked === true && nt.detail === manual.systems.find(x => x.id === 'ntmetro').detail);
a = await api(Date.parse(manual.expiresAt) + 60e3);
const nt2 = a.body.systems.find(x => x.id === 'ntmetro');
check('鎖住但人工彙整過期：顯示鎖定前最後一版並標暫停', nt2 && nt2.basis === 'ai-frozen' && nt2.status === '安坑暫停');
db.prepare('DELETE FROM rail_ai_locks').run();

// 11. 當月花費到上限就只偵測不整理
db.prepare(`UPDATE rail_ai_kv SET v = '1000' WHERE k LIKE 'spend:%'`).run();
s = await railAiSummarize(env, { now: later + 9 * 60e3, fetch: fakeFetch });
check('到當月上限就不整理', /monthly cap/.test(s.skipped || ''), JSON.stringify(s));

// 12. 沒有金鑰：只偵測
s = await railAiSummarize({ DELAY_DB }, { now: later + 12 * 60e3, fetch: fakeFetch });
check('沒有金鑰就不整理', s.skipped === 'no key');

// 13. cron 入口只在每 3 分鐘那一分鐘跑
const offMinute = Math.floor(later / 60e3) * 60e3 + 60e3 * (Math.floor(later / 60e3) % 3 === 0 ? 1 : 0);
const r = await railAiScheduled({ scheduledTime: offMinute }, env, { fetch: fakeFetch });
check('不是 3 的倍數分鐘就不跑', r.skipped === 'not this minute');

// 14. 官網抓不到：記錯誤，不當成公告消失
const brokenFetch = (url, init) => String(url).includes('railway.gov.tw') ? Promise.reject(new Error('ETIMEDOUT')) : fakeFetch(url, init);
d = await railAiDetect(env, { now: later + 15 * 60e3, fetch: brokenFetch });
check('官網抓不到只記錯誤、不產生消失事件', d.errors.length === 1 && d.dirty.length === 0, JSON.stringify(d));

// 15. TDX 公告：有傳進來才比；自己寫的彙整與例行正常不算
const alerts = { tra: [{ bulletin: true, sysLabel: '軌島', title: '彙整' }, { status: 1, title: '全線營運正常' }],
  thsr: [], metro: [{ sysLabel: '高雄輕軌', status: 2, title: '輕軌部分區間停駛', desc: '因強風', lines: ['C'] }] };
d = await railAiDetect(env, { now: later + 18 * 60e3, fetch: fakeFetch, alerts });
check('第一次拿到 TDX：已經有營運相關公告的系統直接排整理（高雄輕軌）', d.dirty.join() === 'klrt', JSON.stringify(d));
alerts.metro[0].desc = '因強風，預計 16 時恢復';
d = await railAiDetect(env, { now: later + 21 * 60e3, fetch: fakeFetch, alerts });
check('TDX 公告內容改變標成待整理（高雄輕軌）', d.dirty.join() === 'klrt', JSON.stringify(d));

// 16. 資料表不存在（正式庫漏套 migration）時 API 回 503，不丟例外
const bad = await railAiStatus(new Request('https://railisland.tw/api/rail-status'), { DELAY_DB: { prepare() { throw new Error('no such table: rail_ai_revisions'); } } });
check('資料表不存在回 503', bad.status === 503);

// 17. 剛上線的第一輪：直接整理，提示裡要說明 first_seen 不是發布時間
{
  const fresh = openTestDb();
  const env2 = { DELAY_DB: fresh.DELAY_DB, ANTHROPIC_API_KEY: 'test-key' };
  world.claudeCalls.length = 0;
  world.claude = () => claudeReply(entry('加開列車', '正常', traUrl('aa01')));
  await railAiDetect(env2, { now: T0, fetch: fakeFetch });
  const s2 = await railAiSummarize(env2, { now: T0, fetch: fakeFetch });
  const prompts = world.claudeCalls.map(c => c.body.messages[0].content);
  check('剛上線第一輪就整理有營運相關內容的系統', s2.done && s2.done.sort().join() === 'ntmetro,tra' && fresh.db.prepare('SELECT COUNT(*) n FROM rail_ai_revisions').get().n === 1, JSON.stringify(s2));
  check('第一輪的提示說明 first_seen 不是發布時間，並附上既有公告原文', prompts.length === 2 && prompts.every(p => p.includes('不是發布時間'))
    && prompts.some(p => p.includes('加開 3 列')) && prompts.some(p => p.includes('全線正常營運')));
}

console.log(fails ? `\n${fails} 項失敗` : '\n全部通過');
process.exit(fails ? 1 : 0);
