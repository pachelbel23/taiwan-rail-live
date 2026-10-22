// 離線驗證颱風快照、既有公告路由／App CORS、跨午夜失效與真實觸控 UI。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { railWeatherNotice, withRailWeatherNotice } from './rail_weather_bulletin.mjs';
import worker from '../worker.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp/rail-weather-verification');
fs.mkdirSync(outDir, { recursive: true });
const results = [];
const record = (name, detail) => { results.push({ name, ...detail }); console.log('PASS', name); };
const source = JSON.parse(fs.readFileSync(path.join(root, 'data/rail_weather_bulletin.json')));
const when = Date.parse(source.checkedAt);
assert.equal(source.serviceDate, '2026-10-23');
assert.doesNotMatch(railWeatherNotice(when).descI18n.en, /[\u3400-\u9fff]/);
assert.ok(railWeatherNotice(when).descI18n.ja.includes('10月23日'));
assert.equal(source.systems.length, 9);
assert.ok(source.systems.find(s => s.id === 'tra').detail.includes('六家、集集、沙崙'));
const tra = source.systems.find(s => s.id === 'tra');
assert.match(tra.detail, /6115.*08:23.*09:00.*14:08/);
assert.match(tra.detail, /6117.*09:46.*10:20.*14:56/);
assert.match(tra.detail, /兩班均採全車自由座/);
assert.equal(tra.additionalSources.length, 1);
assert.ok(tra.additionalSources[0].sourceUrl.includes('8ae4cac3a15ab24201a16394bf4219db'));
assert.ok(source.systems.find(s => s.id === 'thsr').detail.includes('10/23 全線正常營運'));
const ntmetro = source.systems.find(s => s.id === 'ntmetro');
// 新北捷運官方貼文適用10/23：兩條輕軌30分鐘，淡海重疊區與兩條捷運15分鐘。
assert.match(ntmetro.status, /淡海、安坑30分/);
assert.match(ntmetro.status, /淡海重疊、環狀、三鶯15分/);
assert.match(ntmetro.detail, /淡海輕軌、安坑輕軌每 30 分鐘/);
assert.match(ntmetro.detail, /V01 紅樹林至 V09 濱海沙崙重疊路段每 15 分鐘/);
assert.match(ntmetro.detail, /環狀線、三鶯線每 15 分鐘/);
assert.doesNotMatch(ntmetro.detail, /待確認|尚未查得/);
assert.ok(ntmetro.sourceUrl.startsWith('https://www.facebook.com/NewTaipeiMetro/posts/'));
assert.equal(ntmetro.additionalSources[0].sourceUrl, 'https://www.ntmetro.com.tw/');
assert.match(ntmetro.detailI18n.en, /30 minutes.*V01–V09.*15 minutes/);
assert.match(ntmetro.detailI18n.ja, /30分間隔.*V01紅樹林～V09濱海沙崙.*15分間隔/);
assert.match(source.systems.find(s => s.id === 'klrt').detail, /下午營運模式待官方/);
assert.equal(railWeatherNotice(Date.parse('2026-10-22T20:19:59+08:00')), null);
assert.ok(railWeatherNotice(Date.parse('2026-10-23T23:59:59+08:00')));
assert.equal(railWeatherNotice(Date.parse('2026-10-24T00:00:00+08:00')), null);
const failed = await withRailWeatherNotice(new Response('upstream failed', { status: 502 }), when);
assert.equal(failed.status, 200);
const failedBody = await failed.json();
assert.equal(failedBody.upstreamUnavailable, true);
assert.equal(failedBody.alerts.length, 1);
assert.ok(failedBody.alerts[0].desc.includes('動畫仍可能依原班表'));
const expiredResponse = new Response('upstream failed', { status: 502 });
assert.equal(await withRailWeatherNotice(expiredResponse, Date.parse(source.expiresAt)), expiredResponse);
record('時效邊界／上游故障仍傳遞警告／到期保留原上游狀態', {});

// 由正式 router 走 cache hit；不可打真 TDX，也不能因 wrapper 遺失 App CORS。
const savedCaches = globalThis.caches, savedNow = Date.now;
const savedFetch = globalThis.fetch;
const upstream = { at: '2026-10-16T22:07:04+08:00', alerts: [{ title: '全線營運正常', status: 1 }] };
const feeds = new Map();
const scopedIds = { 'tra-alert': ['tra', 'afr'], 'thsr-alert': ['thsr'], 'metro-alert': ['tmrt', 'krtc', 'klrt', 'trtc', 'tymc', 'ntmetro'] };
assert.deepEqual(Object.values(scopedIds).flat().sort(), source.systems.map(s => s.id).sort(), '所有系統恰好分送一次');
try {
  Date.now = () => when;
  globalThis.fetch = async () => { throw new Error('測試禁止連外'); };
  globalThis.caches = { default: { match: async () => Response.json(upstream) } };
  for (const endpoint of ['tra-alert', 'thsr-alert', 'metro-alert']) {
    for (const full of [false, true]) for (const origin of ['capacitor://localhost', 'https://localhost', null, 'https://railisland.tw']) {
      const response = await worker.fetch(new Request('https://railisland.tw/api/' + endpoint + (full ? '?weather=full' : ''), { headers: origin ? { Origin: origin } : {} }), {});
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), origin && ['capacitor://localhost', 'https://localhost'].includes(origin) ? origin : null);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const body = await response.json();
      assert.equal(body.at, upstream.at); // 不能把舊台鐵時戳偽裝成剛更新。
      assert.equal(body.alerts[0].bulletin, true);
      assert.equal(body.alerts[1].status, 1);
      const wantFull = full || !['capacitor://localhost', 'https://localhost'].includes(origin);
      assert.equal(body.alerts[0].bulletinScope, wantFull ? 'full' : endpoint);
      for (const system of source.systems) {
        assert.equal(body.alerts[0].desc.includes(system.detail), wantFull || scopedIds[endpoint].includes(system.id), endpoint + '/' + system.id);
      }
      if (origin === 'https://localhost') feeds.set(endpoint + (full ? '?weather=full' : ''), body);
    }
  }
} finally { globalThis.caches = savedCaches; Date.now = savedNow; globalThis.fetch = savedFetch; }
record('三個正式公告路由：舊 App 系統分送／新版完整彙整／iOS 與 Android CORS／保留上游時間與公告', {});

const baseline = JSON.parse(fs.readFileSync(path.join(root, 'app/shipped-baseline.json')));
const oldIndex = baseline.from.find(p => p.includes('1.6.15-128'));
assert.ok(oldIndex && fs.existsSync(oldIndex), '需要已發行 App 128 原始產物驗相容性');
const oldRoot = path.dirname(oldIndex);
const previousWeb = execFileSync('git', ['show', '187b0841:index.html'], { cwd:root, encoding:'utf8', maxBuffer:8*1024*1024 });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const old = url.pathname.startsWith('/old-app/');
  const oldWeb = url.pathname.startsWith('/old-web/');
  if (url.pathname === '/old-web/') return res.writeHead(200, { 'content-type':'text/html; charset=utf-8' }).end(previousWeb);
  let relative = decodeURIComponent(old || oldWeb ? url.pathname.slice(8) : url.pathname);
  if (relative === '/') relative = '/index.html';
  const baseRoot = old ? oldRoot : root;
  const target = path.resolve(baseRoot, '.' + relative);
  if (!target.startsWith(baseRoot + path.sep) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': mime[path.extname(target)] || 'application/octet-stream' });
  fs.createReadStream(target).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

async function configure(context) {
  await context.addInitScript(() => {
    localStorage.setItem('trainmap-howto-seen', '1');
    localStorage.setItem('trainmap-appearance', 'light');
    localStorage.setItem('trainmap-language', 'zh-TW');
  });
  await context.route('**/*', route => {
    const u = new URL(route.request().url());
    const endpoint = u.pathname.split('/').pop();
    if (u.pathname.includes('/api/')) {
      const legacyApp = route.request().frame().url().includes('/old-app/');
      const body = feeds.get(endpoint + (!legacyApp || u.searchParams.get('weather') === 'full' ? '?weather=full' : '')) || (endpoint === 'thsr-schedule' ? JSON.parse(fs.readFileSync(path.join(root, 'data/thsr_schedule_dense.json')))
        : endpoint === 'hazard-alert' ? { hazards: [] }
        : endpoint === 'trtc-live' ? { at: '', src: null, trains: [], board: [], boardPos: { at: null, rows: [], dropped: {} } }
          : { at: '', rows: [], trains: [] });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*' } });
    }
    if (u.href === 'https://railisland.tw/weather-status.html') return route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(path.join(root, 'weather-status.html'), 'utf8') });
    if (u.origin === base) return route.continue();
    return route.abort('blockedbyclient');
  });
}

// 掃所有現有互動控件：比較新增的來源連結與公告入口，不使用手寫控件清單。
async function measure(page, target) {
  return page.evaluate(selector => {
    const el = document.querySelector(selector), r = el.getBoundingClientRect();
    const visible = e => { const s = getComputedStyle(e), b = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0 && b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.left < innerWidth && b.right > 0; };
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const collisions = [...document.querySelectorAll('button,a[href],input,select,[role="button"],[tabindex]')]
      // 全幅地圖畫布本來就鋪在浮動控件後方，屬於底層互動表面，另外以 elementFromPoint 驗遮擋方向。
      .filter(e => !e.matches('canvas.maplibregl-canvas') && e !== el && !el.contains(e) && !e.contains(el) && visible(e))
      .filter(e => { const b = e.getBoundingClientRect(); return Math.min(r.right, b.right) - Math.max(r.left, b.left) > 1 && Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top) > 1; })
      .map(e => e.id || e.className || e.tagName);
    return { visible: visible(el), hitSelf: hit === el || el.contains(hit), collisions,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom },
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      viewportWidth: innerWidth, maxTouchPoints: navigator.maxTouchPoints, hitId: hit && (hit.id || hit.className) };
  }, target);
}

try {
  for (const [name, engine] of Object.entries({ chromium, webkit })) {
    const browser = await engine.launch({ headless: true, ...(name === 'chromium' ? { channel: 'chrome' } : {}) });
    try {
      // 四個規定寬度，加 390 與 600 的中間帶。
      for (const width of [360, 375, 390, 414, 600, 768]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
        try {
          await configure(context);
          const page = await context.newPage();
          await page.clock.install({ time: new Date(when) });
          const errors = [];
          page.on('pageerror', error => errors.push(error.message));
          await page.goto(base + '/?lang=zh-TW', { waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => { try { return state.ready && activeAlertList().some(a => a.bulletin); } catch { return false; } }, null, { timeout: 60000 });
          assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 1);
          const states = [];
          for (const mode of ['default', 'fs', 'drawer', 'sheet']) {
            if (mode === 'drawer') { await page.evaluate(() => { document.getElementById('alertDetail').hidden = true; }); await page.tap('#tabMore'); }
            if (mode === 'sheet') await page.tap('#tabSearch');
            await page.evaluate(m => {
              if (m === 'fs') state._setFs(true);
              document.getElementById('alertDetail').hidden = true;
              renderAlertBanner();
            }, mode);
            await page.waitForTimeout(350);
            const modalChip = mode === 'drawer' ? await measure(page, '#alertChip') : null;
            if (modalChip) {
              assert.equal(modalChip.hitId, 'moreScrim', '更多抽屜以遮罩接管互動');
              await page.tap('#moreClose');
              await page.waitForTimeout(350);
            }
            const chip = await measure(page, '#alertChip');
            assert.ok(chip.visible && chip.hitSelf, `${name}/${width}/${mode}: 公告入口可觸控 ${JSON.stringify(chip)}`);
            assert.deepEqual(chip.collisions, [], `${name}/${width}/${mode}: 入口碰撞`);
            await page.tap('#alertChip');
            await page.waitForFunction(() => !document.getElementById('alertDetail').hidden);
            const link = await measure(page, '#alertDetail a[href$="weather-status.html"]');
            assert.ok(link.visible && link.hitSelf && link.rect.height >= 44, `${name}/${width}/${mode}: 來源入口被裁切 ${JSON.stringify(link)}`);
            assert.deepEqual(link.collisions, [], `${name}/${width}/${mode}: 來源連結碰撞`);
            assert.ok(link.overflow <= 1, `${name}/${width}/${mode}: 水平溢出`);
            states.push({ mode, modalChip, chip, link });
          }
          await page.screenshot({ path: path.join(outDir, `${name}-${width}-map.png`) });
          // 真正觸控來源連結，確認另開的頁面是公告頁，且不打正式站。
          const popupPromise = page.waitForEvent('popup');
          await page.tap('#alertDetail a[href$="weather-status.html"]');
          const popup = await popupPromise;
          await popup.waitForURL('**/weather-status.html');
          await popup.locator('section').first().waitFor();
          assert.equal(await popup.locator('section').count(), 9);
          await popup.close();
          // 完整長公告與兩套真實跟車卡：開啟讓位、關閉恢復，跟隨身分不變。
          await page.goto(base + '/?lang=zh-TW');
          await page.waitForFunction(() => state.ready && activeAlertList().some(a => a.bulletin));
          await page.evaluate(() => { state._setFs(true); state.playing = false; state.clockAtNow = false; });
          for (const kind of ['sched', 'freq']) {
            const selector = kind === 'sched' ? '#followPanel' : '#freqCard';
            const identity = await page.evaluate(kind => {
              if (kind === 'sched') {
                const tr = state.trains.find(t => t.sys === 'tra_sched' && t.stops?.length > 2);
                state.simSec = tr.stops[0].depSec + 60;
                setFollow(tr, false, true); return state.followId;
              }
              const ln = state.decoLines.find(l => !isTrtcBoardLine(l) && l._tt?.some(t => t.length >= 4));
              const tr = ln._tt.find(t => t.length >= 4); state.simSec = tr[1] + 1;
              setFreqFollow({ ln, tr }); return state.freqFollow?.ln.id;
            }, kind);
            assert.ok(identity, `${name}/${width}/${kind}: 跟隨真實班次`);
            assert.equal(await page.locator(selector).evaluate(e => getComputedStyle(e).visibility), 'visible');
            await page.tap('#alertChip');
            assert.equal(await page.locator(selector).evaluate(e => getComputedStyle(e).visibility), 'hidden', '公告閱讀中跟車卡讓位');
            await page.tap('#alertChip');
            assert.equal(await page.locator(selector).evaluate(e => getComputedStyle(e).visibility), 'visible', '關閉公告恢復原卡');
            assert.equal(await page.evaluate(kind => kind === 'sched' ? state.followId : state.freqFollow?.ln.id, kind), identity, '跟隨身分不變');
            states.push({ mode:'follow-' + kind, identity, restored:true });
          }
          if (width === 375) {
            await page.evaluate(() => { window.__weatherActiveAlertList = activeAlertList; activeAlertList = () => [{ title:'一般公告',desc:'一般公告內容' }]; renderAlertBanner(); });
            await page.tap('#alertChip');
            assert.equal(await page.locator('#freqCard').evaluate(e => getComputedStyle(e).visibility), 'visible', '一般短公告不隱藏跟車卡');
            await page.tap('#alertChip');
            await page.evaluate(() => { activeAlertList = window.__weatherActiveAlertList; delete window.__weatherActiveAlertList; renderAlertBanner(); });
          }
          await page.clock.setSystemTime(new Date('2026-10-24T00:01:00+08:00'));
          assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 0);
          await page.clock.setSystemTime(new Date(when));
          // 單看林鐵：原本沒有 Alert API，現在仍要收到全台提醒。
          if (width === 375) {
            await page.evaluate(async () => { await selectGroup(GROUPS.find(g => g.id === 'tra')); state.schedSystems = state.schedSystems.filter(s => s.id === 'afr_sched'); state.alert = null; await pollAlert(); });
            assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 1);
          }
          await page.goto(base + '/weather-status.html');
          assert.equal(await page.locator('section').count(), 9);
          assert.equal(await page.locator('section[aria-labelledby="tra"] a').count(), 2, '加開公告與原停駛方案都可查閱');
          assert.equal(await page.locator('section[aria-labelledby="ntmetro"] a').count(), 2, '官方班距貼文與官網營運資訊都可查閱');
          const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(pageOverflow <= 1);
          for (const a of await page.locator('section a').all()) {
            await a.scrollIntoViewIfNeeded();
            assert.ok(await a.evaluate(e => { const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.height >= 44 && (h === e || e.contains(h)); }));
          }
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: path.join(outDir, `${name}-${width}-status.png`), fullPage: true });
          await page.clock.setSystemTime(new Date('2026-10-24T00:01:00+08:00'));
          await page.reload();
          assert.match(await page.locator('#ageNote').innerText(), /已過適用日期/);
          assert.deepEqual(errors, []);
          record(`${name} ${width}px 觸控／四種面板狀態／全控件碰撞／來源頁與過期警告`, { states });
        } finally { await context.close(); }
      }
      const backup = await browser.newContext({ viewport: { width: 375, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
      try {
        await configure(backup);
        await backup.route('**/api/**', route => route.fulfill({ status: 404, body: 'GitHub Pages has no Worker API' }));
        const page = await backup.newPage();
        await page.clock.install({ time: new Date(when) });
        await page.goto(base + '/?lang=zh-TW');
        await page.waitForFunction(() => { try { return state.ready && activeAlertList().some(a => a.bulletin); } catch { return false; } }, null, { timeout: 60000 });
        assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 1);
        await page.tap('#alertChip');
        assert.match(await page.locator('#alertDetail').innerText(), /台鐵.*停駛/s);
        record(`${name} 備援站所有 API 404 時仍可由靜態公告顯示警告`, {});
      } finally { await backup.close(); }
      const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-TW' });
      try {
        await configure(desktop);
        const page = await desktop.newPage();
        await page.clock.install({ time: new Date(when) });
        await page.goto(base + '/?lang=zh-TW');
        await page.waitForFunction(() => { try { return state.ready && activeAlertList().some(a => a.bulletin); } catch { return false; } }, null, { timeout: 60000 });
        await page.click('#alertBanner');
        const link = await measure(page, '#alertDetail a[href$="weather-status.html"]');
        assert.ok(link.hitSelf && link.rect.height >= 44 && link.overflow <= 1);
        assert.deepEqual(link.collisions, []);
        await page.click('#alertBanner .ab-close');
        assert.equal(await page.locator('#alertBanner').isVisible(), false);
        await page.evaluate(() => { for (const a of state.alert.list) if (a.bulletin) a.sig += ':revision-2'; renderAlertBanner(); });
        assert.equal(await page.locator('#alertBanner').isVisible(), true);
        record(`${name} 桌面橫幅／來源連結／收起與新版本重現`, {});
      } finally { await desktop.close(); }
      const oldWebContext = await browser.newContext({ viewport:{width:375,height:900},isMobile:true,hasTouch:true,locale:'zh-TW' });
      try {
        await configure(oldWebContext);
        const page=await oldWebContext.newPage(); await page.clock.install({time:new Date(when)});
        await page.goto(base+'/old-web/?lang=zh-TW');
        await page.waitForFunction(()=>state.ready&&activeAlertList().some(a=>a.bulletin));
        assert.equal(await page.evaluate(()=>activeAlertList().filter(a=>a.bulletin).length),1);
        await page.tap('#alertChip');
        const text=await page.locator('#alertDetail').innerText();
        assert.match(text,/環狀線、三鶯線.*15 分鐘/);
        record(`${name} 已開啟的 v1022b 舊網頁仍收到單一完整彙整`,{});
      } finally { await oldWebContext.close(); }
      const context = await browser.newContext({ viewport: { width: 375, height: 900 }, isMobile: true, hasTouch: true, locale: 'zh-TW' });
      try {
        await configure(context);
        const page = await context.newPage();
        await page.clock.install({ time: new Date(when) });
        await page.goto(base + '/old-app/?lang=zh-TW', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => { try { return state.ready && activeAlertList().some(a => a.bulletin); } catch { return false; } }, null, { timeout: 60000 });
        await page.tap('#alertChip');
        await page.waitForFunction(() => !document.getElementById('alertDetail').hidden);
        const text = await page.locator('#alertDetail').innerText();
        assert.match(text, /台鐵.*停駛/s);
        assert.match(text, /阿里山/);
        assert.match(text, /動畫仍可能依原班表/);
        const combined = await page.evaluate(() => activeAlertList().filter(a => a.bulletin));
        assert.equal(combined.length, 3, '全台同框保留三則內容不同的系統公告');
        assert.equal(new Set(combined.map(a => a.title)).size, 3, '三個不同標題');
        assert.equal(new Set(combined.map(a => a.sig)).size, 3, '三個不同內容簽章');
        for (const system of source.systems) {
          assert.equal(combined.filter(a => a.desc.includes(system.detail)).length, 1, system.id + ' 內容不能重複');
        }
        const singleCases = [];
        for (const [groupId, scope, sysId] of [['tra', 'tra-alert', 'tra_sched'], ['hsr', 'thsr-alert', 'thsr_sched'], ['metro', 'metro-alert', 'mrt']]) {
          await page.evaluate(async ({ groupId, sysId }) => {
            const group = GROUPS.find(g => g.id === groupId) || GROUPS.find(g => g.members?.includes(sysId));
            if (!group) throw new Error('找不到群組 ' + groupId);
            await selectGroup(group); await pollAlert();
          }, { groupId, sysId });
          const notices = await page.evaluate(() => activeAlertList().filter(a => a.bulletin));
          assert.equal(notices.length, 1, groupId + ' 單獨分頁仍有公告');
          assert.equal(notices[0].bulletinScope, scope);
          singleCases.push({ groupId, scope, count:notices.length });
        }
        record(`${name} 已發行 App 1.6.15 (128)：全台各系統內容恰好一次、切換單一系統仍有公告`, { bulletinCount:combined.length, titles:combined.map(a => a.title), singleCases });
      } finally { await context.close(); }
    } finally { await browser.close(); }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
}
console.log(`完成 ${results.length} 組驗證：${outDir}`);
