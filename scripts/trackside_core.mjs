// 軌道邊卡片的純規則。時刻採 epoch 毫秒，與 App 共用 golden 契約。
export const TS_CONSTANTS = Object.freeze({
  RADIUS_KM: 1.5,
  MAX_RAILS: 3,
  END_TOLERANCE_KM: 0.05,
  LOOKBACK_MS: 10_800_000,
  HORIZON_MS: 75_600_000,
  DELAY_MAX_AGE_MS: 1_800_000,
  DELAY_STALE_LABEL_MS: 600_000,
  CARD_LIFETIME_MS: 7_200_000,
  IMMINENT_MS: 60_000,
  CLOCK_AFTER_MS: 3_600_000,
  DIR_NORTH: 'N',
  DIR_SOUTH: 'S',
  DIR_TOWARD: 'T',
  CD_PASSING: 'passing',
  CD_IMMINENT: 'imminent',
  CD_MINUTES: 'minutes',
  CD_CLOCK: 'clock',
});

export const TS_TOKEN_RE = /^(?:[0-9a-f]{2}){32,128}$/;
export const TS_TICK_MODES = ['phase', 'minute'];
export const TS_MAX_PASSES = 300;
export const TS_MAX_PASSES_JSON = 24000;
export const TS_END_SLACK_MS = 300_000;
export const TS_CONTENT_KEYS = [
  'no', 'sys', 'ms', 'actualMs', 'prevActualMs', 'delayMin', 'nextDay',
  'passedPrev', 'cd', 'minutes', 'clock', 'delayAtMs', 'delayStale',
  'nextNo', 'nextSys', 'nextMs', 'nextActualMs', 'nextDelayMin',
  'nextNextDay', 'pushed', 'tick',
];

export function tsDelays(live, nowMs) {
  const at = Date.parse(live?.at ?? '');
  if (!Number.isFinite(at) || !Array.isArray(live?.trains)) {
    return { delays: {}, delayAtMs: null };
  }
  const delays = {};
  for (const row of live.trains) {
    const v = row?.delay;
    if (v == null || v === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    const no = String(row.no);
    // defineProperty 讓任何上游鍵都只是資料，不會改變物件原型。
    const raw = Object.hasOwn(delays, no) ? Math.max(delays[no], n) : n;
    Object.defineProperty(delays, no, { value: raw, enumerable: true, configurable: true });
  }
  return { delays, delayAtMs: Math.min(at, nowMs) };
}

const compareString = (a, b) => a < b ? -1 : a > b ? 1 : 0;

export function tsUpcoming(passes, delays, delayAtMs, nowMs) {
  const fresh = delayAtMs != null && nowMs - delayAtMs < TS_CONSTANTS.DELAY_MAX_AGE_MS;
  const out = [];
  for (const pass of passes) {
    const raw = Object.hasOwn(delays, pass.no) ? delays[pass.no] : null;
    const delayMin = fresh && pass.sys === 'tra_sched' && pass.nextDay !== true &&
      Number.isFinite(raw) ? Math.floor(raw + 0.5) : null;
    const shift = (delayMin ?? 0) * 60_000;
    const actualMs = pass.ms + shift;
    if (actualMs > nowMs) {
      out.push({ ...pass, actualMs, prevActualMs: pass.prevMs + shift, delayMin });
    }
  }
  return out.sort((a, b) => a.actualMs - b.actualMs ||
    compareString(a.sys, b.sys) || compareString(a.no, b.no));
}

export function tsCountdown(actualMs, nowMs) {
  const diff = actualMs - nowMs;
  if (diff <= 0) return { cd: TS_CONSTANTS.CD_PASSING, minutes: 0, clock: '' };
  if (diff < TS_CONSTANTS.IMMINENT_MS) return { cd: TS_CONSTANTS.CD_IMMINENT, minutes: 0, clock: '' };
  if (diff < TS_CONSTANTS.CLOCK_AFTER_MS) {
    return { cd: TS_CONSTANTS.CD_MINUTES, minutes: Math.floor(diff / 60_000), clock: '' };
  }
  const taipei = new Date(actualMs + 8 * 3_600_000);
  const clock = `${String(taipei.getUTCHours()).padStart(2, '0')}:${String(taipei.getUTCMinutes()).padStart(2, '0')}`;
  return { cd: TS_CONSTANTS.CD_CLOCK, minutes: 0, clock };
}

export function tsDelayStale(delayAtMs, nowMs) {
  return delayAtMs != null && nowMs - delayAtMs > TS_CONSTANTS.DELAY_STALE_LABEL_MS;
}

export function tsContentState(ups, delayAtMs, nowMs) {
  if (!ups.length) return null;
  const first = ups[0], next = ups[1];
  const countdown = tsCountdown(first.actualMs, nowMs);
  return {
    no: first.no, sys: first.sys, ms: first.ms, actualMs: first.actualMs,
    prevActualMs: first.prevActualMs, delayMin: first.delayMin, nextDay: first.nextDay,
    passedPrev: nowMs >= first.prevActualMs,
    cd: countdown.cd, minutes: countdown.minutes, clock: countdown.clock,
    delayAtMs, delayStale: tsDelayStale(delayAtMs, nowMs),
    nextNo: next?.no ?? null, nextSys: next?.sys ?? null,
    nextMs: next?.ms ?? null, nextActualMs: next?.actualMs ?? null,
    nextDelayMin: next?.delayMin ?? null, nextNextDay: next?.nextDay ?? null,
    pushed: true, tick: nowMs,
  };
}

export function tsEndState(prev, nowMs) {
  const state = Object.fromEntries(TS_CONTENT_KEYS.map(key => [key, prev?.[key] ?? null]));
  state.pushed = true;
  state.tick = nowMs;
  return state;
}

const TS_CHANGE_KEYS = [
  'no', 'sys', 'ms', 'actualMs', 'prevActualMs', 'delayMin', 'nextDay',
  'passedPrev', 'delayStale', 'nextNo', 'nextSys', 'nextMs',
  'nextActualMs', 'nextDelayMin', 'nextNextDay', 'cd',
];
export function tsShouldPush(prev, next, tickMode) {
  if (prev == null) return true;
  const keys = tickMode === 'minute' ? [...TS_CHANGE_KEYS, 'minutes', 'clock'] : TS_CHANGE_KEYS;
  return keys.some(key => String(prev[key] ?? '') !== String(next[key] ?? ''));
}

export function tsShouldEnd(nowMs, endMs, ups) {
  if (nowMs >= endMs) return 'endAt';
  return ups.length ? null : 'empty';
}

export function tsStaleDateSec(state) {
  return Number.isFinite(state?.actualMs) ? Math.ceil(state.actualMs / 1000) : null;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const BIND_KEYS = ['token', 'endMs', 'tickMode', 'passes'];
const PASS_KEYS = ['no', 'sys', 'ms', 'prevMs', 'nextDay'];
export function tsValidateBind(body, nowMs) {
  const bad = error => ({ ok: false, error });
  if (!isObject(body)) return bad('bad_json');
  if (Object.keys(body).some(key => !BIND_KEYS.includes(key))) return bad('bad_keys');
  if (!TS_TOKEN_RE.test(String(body.token))) return bad('bad_token');
  const { endMs, tickMode, passes } = body;
  if (!Number.isInteger(endMs) || endMs <= nowMs ||
      endMs > nowMs + TS_CONSTANTS.CARD_LIFETIME_MS + TS_END_SLACK_MS) return bad('bad_end');
  if (!TS_TICK_MODES.includes(tickMode)) return bad('bad_tick');
  if (!Array.isArray(passes) || passes.length < 1 || passes.length > TS_MAX_PASSES ||
      JSON.stringify(passes).length > TS_MAX_PASSES_JSON) return bad('bad_passes');
  // 先驗整份清單的鍵，再驗值；錯誤順序與隱私邊界一致。
  if (passes.some(pass => !isObject(pass) || Object.keys(pass).length !== PASS_KEYS.length ||
      Object.keys(pass).some(key => !PASS_KEYS.includes(key)))) return bad('bad_keys');
  const seen = new Set(), clean = [];
  for (const pass of passes) {
    const { no, sys, ms, prevMs, nextDay } = pass;
    if (typeof no !== 'string' || !/^[0-9A-Za-z]{1,8}$/.test(no) ||
        !['tra_sched', 'thsr_sched'].includes(sys) ||
        !Number.isInteger(ms) || !Number.isInteger(prevMs) || prevMs >= ms ||
        ms < nowMs - TS_CONSTANTS.LOOKBACK_MS || ms > endMs ||
        typeof nextDay !== 'boolean') return bad('bad_pass');
    const key = `${sys}:${no}:${ms}`;
    if (seen.has(key)) return bad('bad_pass');
    seen.add(key);
    clean.push({ no, sys, ms, prevMs, nextDay });
  }
  return { ok: true, value: { token: String(body.token), endMs, tickMode, passes: clean } };
}
