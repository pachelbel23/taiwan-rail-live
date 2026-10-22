// 具時效的人工核對快照。舊 App 不去重，既有端點按系統分送；新版網頁明確要求完整彙整。
// 只轉述營運資訊，不改列車名冊、時刻表或位置；未查得公告不等於正常。
import bulletin from '../data/rail_weather_bulletin.json' with { type: 'json' };

const scopes = {
  'tra-alert': { ids: ['tra', 'afr'], label: '台鐵與阿里山林鐵' },
  'thsr-alert': { ids: ['thsr'], label: '高鐵' },
  'metro-alert': { ids: ['trtc', 'tymc', 'ntmetro', 'tmrt', 'krtc', 'klrt'], label: '捷運與輕軌' },
};

export function railWeatherNotice(now = Date.now(), scope = 'full') {
  if (!(now >= Date.parse(bulletin.displayFrom) && now < Date.parse(bulletin.expiresAt))) return null;
  const selected = scopes[scope];
  if (scope !== 'full' && !selected) throw new Error('Unknown rail weather scope: ' + scope);
  const systems = selected ? bulletin.systems.filter(s => selected.ids.includes(s.id)) : bulletin.systems;
  const date = bulletin.serviceDate.slice(5).replace('-', '/').replace(/^0/, '');
  const checked = bulletin.checkedAt.replace('T', ' ').slice(0, 16);
  const descI18n = {};
  for (const [lang, warning] of Object.entries(bulletin.warningI18n || {})) {
    const heading = lang === 'en' ? `Official notices, manually checked ${checked} (Taiwan time)`
      : `公式発表の手動確認時刻：${checked}（台湾時間）`;
    descI18n[lang] = heading + '\n' + warning + '\n'
      + systems.map(s => `[${s.labelI18n?.[lang] || s.label}] ${s.detailI18n?.[lang] || s.detail}`).join('\n')
      + '\nhttps://railisland.tw/weather-status.html';
  }
  return {
    descI18n,
    bulletin: true, bulletinScope: scope, status: 0, sysLabel: '軌島', sig: `rail-weather:${bulletin.id}:${bulletin.revision}${selected ? ':' + scope : ''}`,
    title: selected ? `${date} ${selected.label}營運公告` : bulletin.title,
    desc: `【官方公告人工彙整｜核對時間 ${checked}（台灣時間）】\n${bulletin.warning}\n`
      + systems.map(s => `【${s.label}】${s.detail}`).join('\n')
      + '\n完整來源：https://railisland.tw/weather-status.html',
    start: bulletin.displayFrom, end: bulletin.expiresAt,
    sourceUrl: 'https://railisland.tw/weather-status.html',
    sourceLabel: '各系統官方公告與核對時間',
    lines: [], stations: [],
  };
}

export async function withRailWeatherNotice(response, now = Date.now(), scope = 'full') {
  const notice = railWeatherNotice(now, scope);
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
