// 與 API 使用同一份核對快照，產生可分享、無須 JavaScript 即可閱讀的公告頁。
import { readFile, writeFile } from 'node:fs/promises';
const data = JSON.parse(await readFile(new URL('../data/rail_weather_bulletin.json', import.meta.url), 'utf8'));
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const checked = data.checkedAt.replace('T', ' ').slice(0, 16);
const rows = data.systems.map(s => `<section aria-labelledby="${esc(s.id)}"><div class="row-head"><h2 id="${esc(s.id)}">${esc(s.label)}</h2><span class="status">${esc(s.status)}</span></div><p>${esc(s.detail)}</p><a href="${esc(s.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.sourceLabel)} ↗</a></section>`).join('\n');
await writeFile(new URL('../weather-status.html', import.meta.url), `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><meta name="theme-color" content="#f4edda">
<title>10/23 薔琵颱風・全台鐵道營運公告｜軌島</title>
<meta name="description" content="10/23 薔琵颱風鐵道營運公告彙整：台鐵、阿里山林鐵、高鐵及各捷運輕軌。附核對時間與官方原文，出發前請再次確認。">
<style>
*{box-sizing:border-box}body{margin:0;background:#f4edda;color:#302f29;font:16px/1.8 system-ui,-apple-system,sans-serif}main{max-width:900px;margin:auto;padding:24px max(20px,env(safe-area-inset-right)) 48px max(20px,env(safe-area-inset-left))}a{color:#245c59;text-underline-offset:4px;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #be5f26;outline-offset:3px}nav a,section a{display:inline-flex;align-items:center;min-height:44px}nav{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-bottom:2px solid #302f29;padding-bottom:10px}.eyebrow{letter-spacing:.12em;font-size:13px;margin:25px 0 8px}h1{font-size:clamp(26px,5vw,40px);line-height:1.35;margin:0 0 16px}h2{font-size:20px;line-height:1.5;margin:0}.warning{border:2px solid #a24424;border-left-width:7px;background:#fff1dc;padding:16px 20px;color:#6f2917}.warning strong{display:block;font-size:20px}.warning p{margin:8px 0 0}.meta{color:#615d51;font-size:14px}.row-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}section{margin-top:16px;padding:20px;border:1px solid #aaa38e;background:#fffaf0;border-radius:8px}section p{margin:12px 0 4px}.status{font-size:13px;border:1px solid #a27e3a;border-radius:4px;padding:2px 8px;background:#f5e8c9}footer{margin-top:28px;border-top:1px solid #aaa38e;padding-top:16px;font-size:14px}#ageNote{font-weight:700;color:#8e351d}@media(max-width:480px){main{padding-top:16px}section{padding:16px}.warning{padding:14px}.row-head{display:block}.status{display:inline-block;margin-top:8px}nav{font-size:14px}}
</style></head><body><main>
<nav aria-label="網站導覽"><a href="./">← 軌島即時地圖</a><a href="${esc(data.weatherUrl)}" target="_blank" rel="noopener noreferrer">氣象署颱風警報 ↗</a></nav>
<p class="eyebrow">RAIL ISLAND · 營運公告彙整</p><h1>10/23 薔琵颱風<br>全台鐵道營運資訊</h1>
<div class="warning" role="note"><strong>⚠ 地圖有列車，不代表實際開行</strong><p>${esc(data.warning)}</p></div>
<p class="meta">適用日期：${esc(data.serviceDate)}（台灣時間）<br>人工核對時間：<time datetime="${esc(data.checkedAt)}">${esc(checked)} UTC+8</time><br>本頁為公告快照，後續異動請點各系統官方來源確認。</p>
<p id="ageNote">尚待確認的系統不代表正常營運；未列出的班次也不能推定開行。</p>
${rows}
<footer>營運資訊由各單位公告人工彙整；本站動畫的停駛、臨時班距與復駛顯示可能與現場不同。請以營運單位最新公告及車站指示為準。</footer>
</main><script>
(() => { const expires = ${JSON.stringify(data.expiresAt)}, checked = ${JSON.stringify(data.checkedAt)};
function updateAge() { const now = Date.now(); const el = document.getElementById('ageNote');
if (now >= Date.parse(expires)) el.textContent = '這份快照已過適用日期，僅供歷史查閱。請直接查看各系統官方最新公告，不能據此判斷現在是否開行。';
else if (now - Date.parse(checked) >= 4 * 3600000) el.textContent = '距離人工核對已超過 4 小時，營運方案可能已有異動。請直接查看下方官方最新公告；尚待確認不代表正常營運。'; }
updateAge(); setInterval(updateAge, 60000); })();
</script></body></html>\n`);
console.log(`weather-status.html：${data.systems.length} 個系統／群組，核對時間 ${checked}`);
