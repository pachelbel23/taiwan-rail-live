// 具時效的人工核對快照。三個既有公告端點共用，讓已安裝的 App 也收到同一份警告。
// 只轉述營運資訊，不改列車名冊、時刻表或位置；未查得公告不等於正常。
import bulletin from '../data/rail_weather_bulletin.json' with { type: 'json' };

export function railWeatherNotice(now = Date.now()) {
  if (!(now >= Date.parse(bulletin.displayFrom) && now < Date.parse(bulletin.expiresAt))) return null;
  const checked = bulletin.checkedAt.replace('T', ' ').slice(0, 16);
  const descI18n = {};
  for (const [lang, warning] of Object.entries(bulletin.warningI18n || {})) {
    const heading = lang === 'en' ? `Official notices, manually checked ${checked} (Taiwan time)`
      : `公式発表の手動確認時刻：${checked}（台湾時間）`;
    descI18n[lang] = heading + '\n' + warning + '\n'
      + bulletin.systems.map(s => `[${s.labelI18n?.[lang] || s.label}] ${s.detailI18n?.[lang] || s.detail}`).join('\n')
      + '\nhttps://railisland.tw/weather-status.html';
  }
  return {
    descI18n,
    bulletin: true, status: 0, sysLabel: '軌島', sig: `rail-weather:${bulletin.id}:${bulletin.revision}`,
    title: bulletin.title,
    desc: `【官方公告人工彙整｜核對時間 ${checked}（台灣時間）】\n${bulletin.warning}\n`
      + bulletin.systems.map(s => `【${s.label}】${s.detail}`).join('\n')
      + '\n完整來源：https://railisland.tw/weather-status.html',
    start: bulletin.displayFrom, end: bulletin.expiresAt,
    sourceUrl: 'https://railisland.tw/weather-status.html',
    sourceLabel: '各系統官方公告與核對時間',
    lines: [], stations: [],
  };
}

export async function withRailWeatherNotice(response, now = Date.now()) {
  const notice = railWeatherNotice(now);
  if (!notice) return response;
  let body;
  try { body = await response.clone().json(); } catch { body = {}; }
  const upstreamOk = response.ok && Array.isArray(body?.alerts);
  const headers = new Headers(response.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  // 不把已到期公告藏進 CDN/browser cache；原端點的上游快取仍維持既有節奏。
  headers.set('Cache-Control', 'no-store');
  headers.delete('Content-Length');
  headers.delete('ETag');
  return new Response(JSON.stringify({ ...body,
    alerts: [notice, ...(upstreamOk ? body.alerts : [])],
    ...(!upstreamOk ? { upstreamUnavailable: true } : {}),
  }), { status: 200, headers });
}
