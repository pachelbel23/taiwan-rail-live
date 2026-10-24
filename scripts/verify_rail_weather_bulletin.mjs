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
assert.equal(source.serviceDate, '2026-10-24');
assert.equal(source.displayFrom, '2026-10-24T00:00:00+08:00');
assert.equal(source.expiresAt, '2026-10-25T00:00:00+08:00');
assert.ok(Date.parse(source.checkedAt) >= Date.parse(source.displayFrom));
assert.equal(source.title, "薔琵颱風｜10/24 桃捷普通 15 分鐘，林鐵沼平、神木 13 時起恢復");
assert.doesNotMatch(railWeatherNotice(when).descI18n.en, /[\u3400-\u9fff]/);
assert.ok(railWeatherNotice(when).descI18n.ja.includes('10月24日'));
assert.equal(source.systems.length, 9);
for (const system of source.systems) {
  assert.ok(Number.isFinite(Date.parse(system.sourceCheckedAt)), system.id + ' 保留原文真實最近成功核對時間');
  assert.ok(Date.parse(system.sourceCheckedAt) <= when, system.id + ' 不能虛報未來核對時間');
}
const TRA_UPDATED_FACTS = {
  "schema": 1,
  "serviceDate": "2026-10-24",
  "revision": "20261024-1508",
  "newPlanTrainNumbers": [
    "432",
    "273",
    "5216",
    "5233",
    "5249",
    "271",
    "277",
    "281"
  ],
  "newPlanDepartureTimes": [
    "15:00",
    "14:18",
    "12:35",
    "12:45",
    "17:09",
    "17:38",
    "19:01",
    "19:30"
  ],
  "checks": [
    {
      "id": "notice-1130-fallen-tree-repairs",
      "fragments": {
        "zh-TW": [
          "台鐵 10/24 11:30 公告指出，北迴線、宜蘭線路樹倒塌嚴重，正全力搶修，"
        ],
        "en": [
          "TRA's notice issued at 11:30 on Oct 24 reports severe disruption caused by fallen trackside trees on the North-Link and Yilan lines. Repairs are under way,"
        ],
        "ja": [
          "台湾鉄道の10月24日11:30の発表によると、北廻線・宜蘭線では線路沿いの樹木の倒壊が深刻で、全力で復旧作業を進めており、"
        ]
      }
    },
    {
      "id": "expected-1500-restoration",
      "fragments": {
        "zh-TW": [
          "預計 15:00 恢復正常行駛；"
        ],
        "en": [
          "with normal services expected to resume at 15:00."
        ],
        "ja": [
          "通常運転の再開は15:00を見込んでいます。"
        ]
      }
    },
    {
      "id": "not-actual-resumption-confirmation",
      "fragments": {
        "zh-TW": [
          "這是預估，尚非實際復駛確認，"
        ],
        "en": [
          "This is an estimate, not confirmation that services have actually resumed,"
        ],
        "ja": [
          "これは見通しであり、実際の運転再開を確認したものではありません。"
        ]
      }
    },
    {
      "id": "not-all-at-1500",
      "fragments": {
        "zh-TW": [
          "也不能概括為全線於 15:00 整點同步恢復。"
        ],
        "en": [
          "and it does not mean that the entire network will resume simultaneously at exactly 15:00."
        ],
        "ja": [
          "また、全線が15:00ちょうどに一斉再開するという意味でもありません。"
        ]
      }
    },
    {
      "id": "current-after-noon-scope",
      "fragments": {
        "zh-TW": [
          "原文同時明列今日 12:00 後各級列車方案："
        ],
        "en": [
          "The same notice explicitly sets out today's operating plan for trains of all classes after 12:00:"
        ],
        "ja": [
          "同じ発表には、本日12:00以降の各種列車の運行計画も明記されており、"
        ]
      }
    },
    {
      "id": "western-main-normal",
      "fragments": {
        "zh-TW": [
          "西部幹線基隆至潮州至枋寮正常行駛。"
        ],
        "en": [
          "the Western Main Line, Keelung–Chaozhou–Fangliao, operates normally."
        ],
        "ja": [
          "西部幹線の基隆～潮州～枋寮は通常運転とされています。"
        ]
      }
    },
    {
      "id": "new-train-432-route-time-scope",
      "fragments": {
        "zh-TW": [
          "東部對號順行自樹林至花蓮 432 次（臺北 15:00 開車）、"
        ],
        "en": [
          "Eastern reserved-seat services are to resume in the clockwise direction from Train 432, Shulin–Hualien (Taipei departure 15:00),"
        ],
        "ja": [
          "東部の指定席列車は、時計回りが樹林～花蓮432次（台北15:00発）から、"
        ]
      }
    },
    {
      "id": "new-train-273-route-time-scope",
      "fragments": {
        "zh-TW": [
          "逆行自花蓮至彰化 273 次（花蓮 14:18 開車）恢復，"
        ],
        "en": [
          "and in the counterclockwise direction from Train 273, Hualien–Changhua (Hualien departure 14:18)."
        ],
        "ja": [
          "反時計回りが花蓮～彰化273次（花蓮14:18発）から再開する計画です。"
        ]
      }
    },
    {
      "id": "distinct-time-and-no-operation-inference",
      "fragments": {
        "zh-TW": [
          "兩個不同時刻均按原文保留，不自行調成同一時間，亦不據此宣稱查核時已開行。"
        ],
        "en": [
          "These two different departure times are both retained as stated in the notice; they have not been changed to a single time, and they do not establish that these trains were already running at the check time."
        ],
        "ja": [
          "この異なる2つの時刻は原文どおり両方を残し、同じ時刻に置き換えていません。また、確認時点ですでに運転していたとは判断していません。"
        ]
      }
    },
    {
      "id": "new-train-5216-route-time-scope",
      "fragments": {
        "zh-TW": [
          "樹林至花蓮 5216 次改停駛，"
        ],
        "en": [
          "Train 5216, Shulin–Hualien, is now cancelled."
        ],
        "ja": [
          "樹林～花蓮5216次は運休に変更され、"
        ]
      }
    },
    {
      "id": "remaining-5233-5249-cancellations",
      "fragments": {
        "zh-TW": [
          "花蓮至樹林 5233 次、臺東至樹林 5249 次仍停駛；"
        ],
        "en": [
          "Trains 5233, Hualien–Shulin, and 5249, Taitung–Shulin, remain cancelled;"
        ],
        "ja": [
          "花蓮～樹林5233次と台東～樹林5249次は引き続き運休します。"
        ]
      }
    },
    {
      "id": "east-local-limits",
      "fragments": {
        "zh-TW": [
          "部分非對號列車截短或停駛。"
        ],
        "en": [
          "some non-reserved-seat services are shortened or cancelled."
        ],
        "ja": [
          "一部の非指定席列車は運転区間の短縮または運休となります。"
        ]
      }
    },
    {
      "id": "south-link-normal",
      "fragments": {
        "zh-TW": [
          "南迴線新左營至臺東正常。"
        ],
        "en": [
          "The South-Link Line, Xinzuoying–Taitung, operates normally."
        ],
        "ja": [
          "南廻線の新左営～台東は通常運転です。"
        ]
      }
    },
    {
      "id": "new-train-271-route-time-scope",
      "fragments": {
        "zh-TW": [
          "跨線花蓮至彰化 271 次的花蓮至松山間停駛，改由松山特開（松山 12:35、臺北 12:45）；"
        ],
        "en": [
          "Cross-line services have partial cancellations: Train 271, Hualien–Changhua, is cancelled between Hualien and Songshan and instead starts at Songshan (Songshan departure 12:35; Taipei departure 12:45)."
        ],
        "ja": [
          "花蓮～彰化271次は花蓮～松山が運休となり、松山を始発に変更します（松山12:35発、台北12:45発）。"
        ]
      }
    },
    {
      "id": "new-train-277-route-time-scope",
      "fragments": {
        "zh-TW": [
          "花蓮至斗南 277 次的花蓮至七堵間停駛，改由七堵特開（七堵 17:09、臺北 17:38）；"
        ],
        "en": [
          "Train 277, Hualien–Dounan, is cancelled between Hualien and Qidu and instead starts at Qidu (Qidu departure 17:09; Taipei departure 17:38)."
        ],
        "ja": [
          "花蓮～斗南277次は花蓮～七堵が運休となり、七堵を始発に変更します（七堵17:09発、台北17:38発）。"
        ]
      }
    },
    {
      "id": "new-train-281-route-time-scope",
      "fragments": {
        "zh-TW": [
          "花蓮至屏東 281 次的花蓮至七堵間停駛，改由七堵特開（七堵 19:01、臺北 19:30），"
        ],
        "en": [
          "Train 281, Hualien–Pingtung, is cancelled between Hualien and Qidu and instead starts at Qidu (Qidu departure 19:01; Taipei departure 19:30)."
        ],
        "ja": [
          "花蓮～屏東281次は花蓮～七堵が運休となり、七堵を始発に変更します（七堵19:01発、台北19:30発）。"
        ]
      }
    },
    {
      "id": "cross-partial-only",
      "fragments": {
        "zh-TW": [
          "這三班不是整班取消，停駛區段也未因此復駛。"
        ],
        "en": [
          "These three trains are not cancelled for their entire routes, and this does not restore service on their cancelled sections."
        ],
        "ja": [
          "この3本は全区間運休ではなく、運休区間がこれによって再開するわけでもありません。"
        ]
      }
    },
    {
      "id": "normal-branches",
      "fragments": {
        "zh-TW": [
          "六家、集集、沙崙正常；"
        ],
        "en": [
          "The Liujia, Jiji and Shalun lines operate normally."
        ],
        "ja": [
          "六家線・集集線・沙崙線は通常運転です。"
        ]
      }
    },
    {
      "id": "inspection-before-branch-resumption",
      "fragments": {
        "zh-TW": [
          "平溪、深澳、內灣須路線巡查完畢後恢復，"
        ],
        "en": [
          "The Pingxi, Shen-ao and Neiwan lines will resume after track inspections are completed."
        ],
        "ja": [
          "平渓線・深澳線・内湾線は線路の巡回点検が完了してから再開します。"
        ]
      }
    },
    {
      "id": "inspection-no-time-or-completed-inference",
      "fragments": {
        "zh-TW": [
          "未列明確時間，不能當作已完成巡查或已復駛。"
        ],
        "en": [
          "No definite time is stated, so this does not establish that inspections have been completed or services have resumed."
        ],
        "ja": [
          "明確な時刻は記載されていないため、すでに点検が完了した、または運転を再開したとは判断できません。"
        ]
      }
    },
    {
      "id": "tourist-blue-normal-others-all-day",
      "fragments": {
        "zh-TW": [
          "觀光列車除藍皮解憂號正常外，海風、山嵐、鳴日廚房及 1、2 次環島之星等全日停駛；"
        ],
        "en": [
          "Among sightseeing trains, Breezy Blue operates normally, while services including Haifeng, Shanlan, Mingri Kitchen and Formosa Express Nos. 1 and 2 are suspended all day."
        ],
        "ja": [
          "観光列車は藍皮解憂号が通常運転する一方、海風・山嵐・鳴日厨房・環島之星1次と2次などは終日運休します。"
        ]
      }
    },
    {
      "id": "science-train-all-day-cancelled-and-deadhead",
      "fragments": {
        "zh-TW": [
          "科普列車全日停駛並辦理迴送，"
        ],
        "en": [
          "The Science Train is suspended all day and will be repositioned without passengers;"
        ],
        "ja": [
          "科学普及列車は終日運休して回送を行い、"
        ]
      }
    },
    {
      "id": "science-closing-event-cancelled",
      "fragments": {
        "zh-TW": [
          "閉幕活動取消。"
        ],
        "en": [
          "its closing event is cancelled."
        ],
        "ja": [
          "閉幕行事も中止します。"
        ]
      }
    },
    {
      "id": "earlier-plans-historical-only",
      "fragments": {
        "zh-TW": [
          "08:30 先前稿與中午前方案僅保留為歷史參考，"
        ],
        "en": [
          "The earlier 08:30 notice and the before-noon plan are retained only as historical references."
        ],
        "ja": [
          "先の08:30の発表と正午前の運行計画は、過去の参考情報としてのみ残しています。"
        ]
      }
    },
    {
      "id": "old-5216-resumption-superseded",
      "fragments": {
        "zh-TW": [
          "5216 次的舊恢復安排已由本稿停駛取代。"
        ],
        "en": [
          "The earlier resumption arrangement for Train 5216 is superseded by its cancellation in this notice."
        ],
        "ja": [
          "5216次の従来の再開予定は、今回の発表にある運休へ変更されています。"
        ]
      }
    },
    {
      "id": "western-first-trains-not-reconfirmed",
      "fragments": {
        "zh-TW": [
          "新稿未再逐列西部原首班及 5120 次，",
          "也不把舊首班時刻當成此次新確認；"
        ],
        "en": [
          "The new notice does not repeat the earlier first resuming western services or Train 5120 individually.",
          "and the earlier first-service times are not treated as newly confirmed by this notice."
        ],
        "ja": [
          "新しい発表では、西部の従来の再開初便や5120次を個別には再掲していません。",
          "従来の初便時刻を今回新たに確認された時刻としても扱いません。"
        ]
      }
    },
    {
      "id": "5120-not-withdrawn-from-omission",
      "fragments": {
        "zh-TW": [
          "不據此推定 5120 次停駛已撤銷，"
        ],
        "en": [
          "This does not establish that Train 5120's cancellation has been withdrawn,"
        ],
        "ja": [
          "これだけで5120次の運休が撤回されたとは判断せず、"
        ]
      }
    },
    {
      "id": "early-1139-exception-historical",
      "fragments": {
        "zh-TW": [
          "成追線 2608 次成功 11:39 是先前上午例外，並非此次新恢復時刻。"
        ],
        "en": [
          "Train 2608's Chenggong departure at 11:39 on the Chengzhui Line is an exception from the earlier morning plan, not a newly announced resumption time in this notice."
        ],
        "ja": [
          "成追線2608次の成功11:39発は、先の午前中の計画にあった例外であり、今回新たに発表された再開時刻ではありません。"
        ]
      }
    },
    {
      "id": "yesterday-extra-trains-excluded",
      "fragments": {
        "zh-TW": [
          "10/23 的 6115、6117 次加開不屬於今日方案。"
        ],
        "en": [
          "The Oct 23 extra trains 6115 and 6117 are not part of today's plan."
        ],
        "ja": [
          "10月23日の増発6115・6117次は、本日の計画には含まれません。"
        ]
      }
    },
    {
      "id": "remaining-local-limits-check-before-travel",
      "fragments": {
        "zh-TW": [
          "部分非對號仍可能截短或停駛，出發前須查台鐵最新班次。"
        ],
        "en": [
          "Some non-reserved-seat services may still be shortened or cancelled; check TRA's latest train information before departure."
        ],
        "ja": [
          "一部の非指定席列車には引き続き運転区間の短縮や運休があり得るため、出発前に台湾鉄道の最新運行情報を確認してください。"
        ]
      }
    }
  ],
  "forbidden": {
    "zh-TW": [
      "10/24 12:00 後資訊預定於當日 08:00 公告，尚不能推定中午後恢復。",
      "北迴線、宜蘭線已於 15:00 恢復正常行駛。",
      "所有路線已於 15:00 同時恢復正常。",
      "5216 次確認恢復行駛。",
      "5120 次確認恢復行駛。",
      "2608 次成功 11:39 是此次新恢復時刻。",
      "6115、6117 次加開屬於今日方案。",
      "東部對號順行自樹林至花蓮 5216 次（臺北 12:25）、樹林至臺東 426 次（臺北 12:40），逆行自花蓮至樹林 219 次（花蓮 12:14）恢復；"
    ],
    "en": [
      "resumption after noon is not yet confirmed.",
      "All lines have resumed normal service at 15:00.",
      "Train 5216 is confirmed to be running.",
      "Train 5120 is confirmed to be running.",
      "Train 2608 at Chenggong 11:39 is a newly announced resumption in this notice.",
      "The Oct 23 extra trains 6115 and 6117 are included in today's plan.",
      "Eastern Main Line reserved-seat services resume from Train 5216, Shulin–Hualien (Taipei departure 12:25), Train 426, Shulin–Taitung (Taipei departure 12:40), and Train 219, Hualien–Shulin (Hualien departure 12:14)."
    ],
    "ja": [
      "正午以降の再開は未確認です。",
      "全線が15:00に一斉に運転を再開しました。",
      "5216次は運転を再開しました。",
      "5120次は運転を再開しました。",
      "2608次の成功11:39発は今回新たに発表された再開時刻です。",
      "10月23日の増発6115・6117次は本日の計画に含まれます。",
      "東部幹線の指定席列車は、樹林～花蓮5216次（台北12:25発）、樹林～台東426次（台北12:40発）、花蓮～樹林219次（花蓮12:14発）から再開します。"
    ]
  },
  "unexpectedClausePolicy": {
    "scope": "After removing every independently verified positive fragment, reject additional unreviewed TRA train clauses or explicit fare/actual-resumption claims. This prevents valid positive clauses plus contradictory appended text from passing.",
    "trainTokenPattern": "(?:^|[^A-Za-z0-9])(?:432|273|5216|5233|5249|271|277|281|5120|2608|6115|6117)(?![A-Za-z0-9])",
    "fareClaimPatterns": {
      "zh-TW": "(?:非對號|對號)[^。.!?;]{0,100}(?:免費|免票|零票價)",
      "en": "(?:non-reserved(?:-seat)?|reserved-seat)[^.!?;]{0,100}(?:fare-free|freefare|free of charge|\\bfree\\b)",
      "ja": "(?:非指定席|指定席)[^。.!?;]{0,100}(?:無料|運賃不要)"
    },
    "actualResumptionClaimPatterns": {
      "zh-TW": "(?:北迴|宜蘭|平溪|深澳|內灣)[^。.!?;]{0,120}(?:已[^。.!?;]{0,40}(?:恢復|復駛|開行|巡查)|確認[^。.!?;]{0,40}復駛)",
      "en": "(?:North-Link|Yilan|Pingxi|Shen-ao|Neiwan)[^.!?;]{0,120}(?:have|has)[^.!?;]{0,25}(?:resumed|reopened)",
      "ja": "(?:北廻|宜蘭|平渓|深澳|内湾)[^。.!?;]{0,120}(?:再開済み|再開しました|通常運転中|点検完了)"
    }
  }
};

// Additive fact assertions only. Keep every existing version/window/CORS/
// uniqueness/mobile/real-touch/scroll/native/HTTP/source-link assertion.
const normalizeTRA = value => String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
const hasTRAToken = (text, token) => new RegExp('(?:^|[^0-9])' + token + '(?![0-9])').test(text);
function assertTRAUpdatedFacts(text, language, {context = 'TRA'} = {}) {
  if (TRA_UPDATED_FACTS.checks.length !== 30 || new Set(TRA_UPDATED_FACTS.checks.map(x => x.id)).size !== 30
      || TRA_UPDATED_FACTS.newPlanTrainNumbers.length !== 8 || new Set(TRA_UPDATED_FACTS.newPlanTrainNumbers).size !== 8
      || TRA_UPDATED_FACTS.newPlanDepartureTimes.length !== 8 || new Set(TRA_UPDATED_FACTS.newPlanDepartureTimes).size !== 8) {
    throw new Error(context + ': incomplete TRA fact inventory');
  }
  const lang = language === 'zh' ? 'zh-TW' : language;
  if (!['zh-TW', 'en', 'ja'].includes(lang)) throw new Error(context + ': unsupported TRA language ' + language);
  if (typeof text !== 'string' || !text.trim()) throw new Error(context + ': missing rendered TRA text');
  const actual = normalizeTRA(text), failed = [];
  for (const check of TRA_UPDATED_FACTS.checks) {
    const fragments = check.fragments[lang];
    if (!Array.isArray(fragments) || !fragments.length) throw new Error('Incomplete multilingual TRA rule ' + check.id);
    for (const fragment of fragments) {
      if (!actual.includes(normalizeTRA(fragment))) failed.push({id: check.id, fragment});
    }
  }
  for (const token of TRA_UPDATED_FACTS.newPlanTrainNumbers) {
    if (!hasTRAToken(actual, token)) failed.push({id: 'new-train-' + token});
  }
  for (const token of TRA_UPDATED_FACTS.newPlanDepartureTimes) {
    if (!hasTRAToken(actual, token)) failed.push({id: 'new-time-' + token});
  }
  for (const fragment of TRA_UPDATED_FACTS.forbidden[lang]) {
    if (actual.includes(normalizeTRA(fragment))) failed.push({id: 'obsolete-noon-placeholder', fragment});
  }
  // Positive clauses must not mask a contradictory extra TRA statement. Strip
  // only reviewed fixture fragments, never arbitrary errors or negations. The
  // remaining train names are constrained at ASCII-alphanumeric boundaries so
  // unrelated official URL hex IDs (for example 1E432CD...) are not train 432.
  let extra = actual;
  const reviewed = [...new Set(TRA_UPDATED_FACTS.checks.flatMap(check => check.fragments[lang]))]
    .map(normalizeTRA).sort((a,b) => b.length-a.length);
  for (const fragment of reviewed) extra = extra.split(fragment).join(' ');
  extra = normalizeTRA(extra);
  const policy = TRA_UPDATED_FACTS.unexpectedClausePolicy;
  for (const [id, pattern] of [
    ['unreviewed-extra-tra-train-clause',policy.trainTokenPattern],
    ['unannounced-free-fare-claim',policy.fareClaimPatterns[lang]],
    ['unconfirmed-actual-resumption-claim',policy.actualResumptionClaimPatterns[lang]],
  ]) {
    if (new RegExp(pattern,'i').test(extra)) failed.push({id,unreviewedText:extra});
  }
  if (failed.length) {
    const error = new Error(context + ' [' + lang + '] TRA facts failed: ' + failed.map(x => x.id).join(', '));
    error.traFactFailures = failed;
    throw error;
  }
  return {language: lang, revision: TRA_UPDATED_FACTS.revision,
    factGroups: TRA_UPDATED_FACTS.checks.length, newPlanTrains: 8, newPlanDepartureTimes: 8,
    exactRouteTimeScopeBindings: true,
    // Legacy API key: verifies the historical 2608/11:39 context only; it never
    // promotes that morning exception into the current 11:30 operating plan.
    morningAndEarlyExceptionVerified: true,
    early2608HistoricalNotCurrent: true, expected1500NotActualResumption: true,
    distinct432And273DepartureTimesRetained: true, threeCrosslinePartialNotWholeTrainCancellation: true,
    previous0830Full18Train16TimeInventoryVerifiedHere: false,
    previousDayExtrasExcluded: true};
}

const TRTC_NOON_FACTS = {
  "schema": 1,
  "serviceDate": "2026-10-24",
  "revision": "20261024-1508",
  "sourceUrl": "https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=07211C1B52E9F4FE",
  "sourceCheckedAt": "2026-10-24T12:32:41+08:00",
  "rawEvidence": "/private/tmp/rail-weather-trtc-noon-1024-1232-source.json",
  "rawEvidenceSHA256": "e387002a603683eec9d71395b1c05a82efb66d653c405472a197c00caae3def8",
  "lineCount": 5,
  "overlapSectionCount": 3,
  "headwayRangeSeconds": [
    480,
    570
  ],
  "overlapHeadwaySeconds": 270,
  "checks": [
    {
      "id": "moving-away-gradual-headway-plan",
      "fragments": {
        "zh-TW": [
          "因颱風逐漸遠離，將逐步加密列車班距，"
        ],
        "en": [
          "as the typhoon moves away, train headways will be shortened gradually,"
        ],
        "ja": [
          "台風が次第に遠ざかることを受けて列車の運転間隔を段階的に短縮し、"
        ]
      }
    },
    {
      "id": "crowd-dependent-extra-trains",
      "fragments": {
        "zh-TW": [
          "並持續觀察人潮狀況機動加發列車。"
        ],
        "en": [
          "with extra trains added as needed after monitoring crowds."
        ],
        "ja": [
          "利用者の混雑状況を引き続き確認しながら臨機応変に増発するとしています。"
        ]
      }
    },
    {
      "id": "five-line-exact-headway-range-binding",
      "fragments": {
        "zh-TW": [
          "文湖線、淡水信義線、松山新店線、板南線及中和新蘆線班距由 12 分鐘逐步調整至 8 分鐘至 9 分 30 秒；"
        ],
        "en": [
          "Headways on the Wenhu, Tamsui-Xinyi, Songshan-Xindian, Bannan and Zhonghe-Xinlu lines will gradually change from 12 minutes to between 8 minutes and 9 minutes 30 seconds."
        ],
        "ja": [
          "文湖線・淡水信義線・松山新店線・板南線・中和新蘆線は、12分間隔から8分～9分30秒間隔へ段階的に調整します。"
        ]
      }
    },
    {
      "id": "three-overlapping-sections-exact-headway-binding",
      "fragments": {
        "zh-TW": [
          "南勢角至大橋頭、北投至大安、南港展覽館至亞東醫院三段重疊區間，班距均約 4 分 30 秒。"
        ],
        "en": [
          "The three overlapping service sections, Nanshijiao–Daqiaotou, Beitou–Daan and Taipei Nangang Exhibition Center–Far Eastern Hospital, will have headways of about 4 minutes 30 seconds."
        ],
        "ja": [
          "南勢角～大橋頭、北投～大安、南港展覧館～亜東医院の3つの重複運行区間は、いずれも約4分30秒間隔です。"
        ]
      }
    },
    {
      "id": "gradual-not-completed-at-check",
      "fragments": {
        "zh-TW": [
          "這是逐步調整方案，未確認查核時已全部調整完成；"
        ],
        "en": [
          "This is a gradual adjustment plan, not confirmation that every adjustment was complete at the check time."
        ],
        "ja": [
          "これは段階的な調整計画であり、確認時点ですべての調整が完了したと確認したものではありません。"
        ]
      }
    },
    {
      "id": "no-explicit-exact-start",
      "fragments": {
        "zh-TW": [
          "原文未列精確開始時刻，"
        ],
        "en": [
          "The text gives no exact start time;"
        ],
        "ja": [
          "本文には正確な開始時刻がなく、"
        ]
      }
    },
    {
      "id": "headline-no-exact-publication-start-or-completion-proof",
      "fragments": {
        "zh-TW": [
          "不能把標題「12:00」當作精確發布時刻或生效起點，亦非已於 12:00 全部完成的證明。"
        ],
        "en": [
          "the headline '12:00' does not establish an exact publication time or effective start time, nor prove that all adjustments were completed by 12:00."
        ],
        "ja": [
          "見出しの「12:00」だけでは正確な発表時刻や適用開始時刻を確定できず、12:00までにすべて完了したことを示すものでもありません。"
        ]
      }
    },
    {
      "id": "new-notice-does-not-repeat-old-safety-and-underground-conditions",
      "fragments": {
        "zh-TW": [
          "新稿未重列 06:00 舊稿的安全與地下段條件。"
        ],
        "en": [
          "The new notice does not repeat the safety and underground-section conditions from the earlier '06:00' notice."
        ],
        "ja": [
          "新しい発表は、先の「06:00」発表の安全条件や地下区間の扱いを再掲していません。"
        ]
      }
    },
    {
      "id": "historical-twelve-six-demand-wind",
      "fragments": {
        "zh-TW": [
          "舊稿所列約 12／6 分鐘及依運量、風速調整，"
        ],
        "en": [
          "That earlier notice's approximately 12/6-minute headways and adjustments for demand and wind,"
        ],
        "ja": [
          "先の発表にある約12分／6分間隔と利用状況・風速に応じた調整、"
        ]
      }
    },
    {
      "id": "historical-ground-elevated-wind-thresholds",
      "fragments": {
        "zh-TW": [
          "以及平面、高架路段若瞬間風速達 10 級以上或 10 分鐘內平均風速達 7 級即暫停營運、"
        ],
        "en": [
          "its suspension of ground-level and elevated services when gusts reach force 10 or above or the 10-minute average reaches force 7,"
        ],
        "ja": [
          "地上・高架区間で瞬間風速が10級以上または10分間平均が7級に達した場合の運転見合わせ、"
        ]
      }
    },
    {
      "id": "historical-underground-continued-crowd-adjustment",
      "fragments": {
        "zh-TW": [
          "地下段維持運轉並依人潮調整班距，"
        ],
        "en": [
          "and continued underground operation with headways adjusted to crowds"
        ],
        "ja": [
          "地下区間の運転維持と混雑に応じた間隔調整は、"
        ]
      }
    },
    {
      "id": "old-conditions-historical-not-newly-confirmed",
      "fragments": {
        "zh-TW": [
          "均僅作歷史條件參考，不是本次新確認；"
        ],
        "en": [
          "are retained only as historical conditions, not newly confirmed by this notice."
        ],
        "ja": [
          "いずれも過去の条件としてのみ参照し、今回新たに確認された条件とはしていません。"
        ]
      }
    },
    {
      "id": "omission-not-withdrawal",
      "fragments": {
        "zh-TW": [
          "不能因新稿未重列就推定條件已撤銷，"
        ],
        "en": [
          "Their omission does not establish that they have been withdrawn;"
        ],
        "ja": [
          "再掲されていないことだけで条件が撤回されたとは判断せず、"
        ]
      }
    },
    {
      "id": "old-twelve-six-not-new-headway",
      "fragments": {
        "zh-TW": [
          "舊 12／6 分鐘也不是此次新班距。"
        ],
        "en": [
          "the old 12/6-minute headways are not the new headways in this update."
        ],
        "ja": [
          "旧12分／6分間隔も今回の新しい間隔ではありません。"
        ]
      }
    },
    {
      "id": "first-pending-and-oct23-stops-historical-only",
      "fragments": {
        "zh-TW": [
          "更早部分首班待通知及 10/23 停駛區段稿亦僅保留為歷史，"
        ],
        "en": [
          "The still earlier first-service-pending plan and Oct 23 suspension-section notice are also historical references only,"
        ],
        "ja": [
          "さらに前の一部始発の続報待ち計画と10月23日の運休区間の発表も過去の参考情報のみであり、"
        ]
      }
    },
    {
      "id": "no-current-section-stop-or-resumption-inference",
      "fragments": {
        "zh-TW": [
          "不據此認定當下特定區段仍停駛或已復駛。"
        ],
        "en": [
          "and do not establish whether any particular section is still suspended or has resumed at the check time."
        ],
        "ja": [
          "確認時点で特定の区間がなお運休中か、すでに再開したかを判断する根拠にはしていません。"
        ]
      }
    },
    {
      "id": "muzha-free-parking-only",
      "fragments": {
        "zh-TW": [
          "木柵機廠停車場配合疏散水門政策開放免費停車，"
        ],
        "en": [
          "Muzha Depot's car park offers free parking under the city's floodgate evacuation policy;"
        ],
        "ja": [
          "市の水門からの車両避難方針に合わせて木柵車両基地の駐車場を無料開放し、"
        ]
      }
    },
    {
      "id": "other-car-parks-normal",
      "fragments": {
        "zh-TW": [
          "其餘停車場正常營運；"
        ],
        "en": [
          "other car parks operate normally."
        ],
        "ja": [
          "その他の駐車場は通常営業するとあります。"
        ]
      }
    },
    {
      "id": "two-table-tennis-facilities-normal",
      "fragments": {
        "zh-TW": [
          "南港展覽館站及板橋站桌球場正常營運。"
        ],
        "en": [
          "The table-tennis facilities at Taipei Nangang Exhibition Center and Banqiao stations also operate normally."
        ],
        "ja": [
          "南港展覧館駅と板橋駅の卓球場も通常営業です。"
        ]
      }
    },
    {
      "id": "three-ancillary-services-suspended",
      "fragments": {
        "zh-TW": [
          "跑馬資訊仍列遺失物中心、北投會館、捷運商品館暫停服務，"
        ],
        "en": [
          "The scrolling notices still list the Lost and Found Center, Beitou Resort and Metro souvenir shops as temporarily closed;"
        ],
        "ja": [
          "スクロール案内では遺失物センター・北投会館・MRTグッズショップが引き続き休業とされており、"
        ]
      }
    },
    {
      "id": "continued-trains-not-all-ancillary-resumed",
      "fragments": {
        "zh-TW": [
          "不能把列車維持營運擴大為所有附屬服務均已恢復。"
        ],
        "en": [
          "continued train operation does not mean all ancillary services have resumed."
        ],
        "ja": [
          "列車の運行継続がすべての付帯サービスの再開を意味するわけではありません。"
        ]
      }
    },
    {
      "id": "headline-date-and-data-update-metadata",
      "fragments": {
        "zh-TW": [
          "北捷 10/24「12:00」營運速報（資料更新 12:24）表示，"
        ],
        "en": [
          "Taipei Metro's Oct 24 update headed '12:00' (data updated at 12:24) says that,"
        ],
        "ja": [
          "台北MRTの10月24日「12:00」運転速報（データ更新12:24）は、"
        ]
      }
    }
  ],
  "independenceAudit": {
    "duplicateOrContainedFragments": 0,
    "operatingAndScopeGroups": 21,
    "metadataGroups": 1
  }
};

// Pure, self-contained assertions. The approved groups bind every route and time
// to its scope; residual scanning rejects contradictory additions even if all
// approved sentences were kept. No browser, clock, filesystem or import is used.
function normalizeTRTCNoon(value) {
  return String(value).normalize('NFC').replace(/[\s\u00a0\u200b\ufeff]+/g, '');
}
const TRTC_NOON_CONTRADICTIONS = {
  'zh-TW': [
    /(?:北捷|台北捷運).{0,24}(?:現在|目前|仍為|仍是|固定|仍).{0,18}12[／/]6/u,
    /(?:新稿|本次|此次).{0,16}(?:確認|重申).{0,24}(?:地下段|地下區間).{0,18}(?:運轉|運行)/u,
    /(?:北捷|台北捷運|捷運)?列車.{0,12}(?:不用付費|免付費|免費)/u,
    /(?:五線|全線|台北捷運|北捷).{0,28}(?:已(?:於|在)?12[:：]00|已全部|全部已|皆已|均已|已經全部).{0,25}(?:完成|加密|調整)/u,
    /(?:五線|全線|台北捷運|北捷).{0,28}(?:精確|確定|正式|統一)(?:自|於|在)?12[:：]00.{0,20}(?:起|開始|生效|完成)/u,
    /(?:標題|見出).{0,12}12[:：]00.{0,18}(?:就是|明示|證實|確定為|即為)(?:精確)?(?:發布|生效|開始)/u,
    /(?:本次|新稿|新方案|目前|現行).{0,16}(?:固定|維持|採用|仍為|仍是|班距為).{0,10}12[／/]6/u,
    /(?:安全|風速|地下段|舊稿).{0,20}(?:條件|規則).{0,10}(?:已撤銷|已撤回|已取消|本次新確認|本次重新確認)/u,
    /(?:所有|全部).{0,12}附屬服務.{0,15}(?:已恢復|正常營運|全部正常)/u,
    /(?:列車|捷運|全線).{0,8}(?:免費乘車|免費搭乘|免票|免車資)/u,
    /(?:文湖線|淡水信義線|松山新店線|板南線|中和新蘆線|南勢角|大橋頭|北投至大安|南港展覽館至亞東醫院).{0,90}(?:(?:班距|間隔|每).{0,18}[0-9]|[0-9](?:分|秒))/u
  ],
  en: [
    /(?:newnotice|thisnotice|newupdate).{0,25}(?:reconfirms?|confirms?).{0,55}(?:safety|wind|underground)/iu,
    /TaipeiMetro.{0,50}(?:stillruns|nowruns|current).{0,35}12[\/-]6/iu,
    /(?:TaipeiMetro|Metrotrains|trains).{0,35}free(?:train|rail|ride|travel)/iu,
    /(?:allfive|alllines|TaipeiMetro).{0,50}(?:already|completed|finished|fullyadjusted).{0,35}(?:12:00|headway|adjustment)/iu,
    /(?:allfive|alllines|TaipeiMetro).{0,50}(?:exactly|precisely|effectivefrom|startsat)12:00/iu,
    /(?:headline).{0,20}12:00.{0,20}(?:proves|establishes|is)(?:theexact)?(?:publication|start|effective)/iu,
    /(?:current|new|now).{0,25}(?:headways|plan|notice).{0,30}(?:fixed|are|is|uses|retains)12[\/-]6/iu,
    /(?:safety|wind|underground).{0,30}(?:conditions|rules).{0,30}(?:withdrawn|cancelled|newlyconfirmed|reconfirmed)/iu,
    /(?:allancillaryservices|allfacilities).{0,25}(?:have(?:now)?resumed|operate(?:normally)?|arenowopen)/iu,
    /(?:Metro|trains|rail).{0,15}(?:fare-free|freeofcharge|freefares|free(?:rides|travel))/iu,
    /(?:Wenhu|Tamsui-Xinyi|Songshan-Xindian|Bannan|Zhonghe-Xinlu|Nanshijiao|Daqiaotou|Beitou.Daan|NangangExhibitionCenter.FarEasternHospital).{0,110}(?:headway|every|minutes?|seconds?)/iu
  ],
  ja: [
    /(?:安全|風速).{0,20}条件.{0,16}(?:撤回|撤廃|取消)/u,
    /(?:新発表|今回|新しい発表).{0,40}(?:地下区間|地下).{0,40}(?:改めて確認|確認しました|再確認)/u,
    /(?:台北MRT|列車).{0,15}(?:列車は)?無料(?:です|で|に)/u,
    /(?:台北MRT|5路線|全線).{0,30}(?:今も|現在も|依然).{0,15}12分[／/]6分/u,
    /(?:5路線|全線|台北MRT).{0,35}(?:12[:：]00.{0,10}(?:すべて|全て)|すでに|既に).{0,25}(?:完了|短縮済|調整済)/u,
    /(?:5路線|全線|台北MRT).{0,25}(?:正確に|一斉に|確定した開始時刻は)12[:：]00/u,
    /(?:見出し).{0,15}12[:：]00.{0,15}(?:正確な発表時刻|正確な適用開始時刻)(?:を示す|である|です)/u,
    /(?:今回|新しい|現在).{0,20}(?:間隔|計画).{0,15}(?:12分[／/]6分|12[／/]6分)/u,
    /(?:安全|風速|地下区間).{0,20}(?:条件|規則).{0,15}(?:撤回された|撤廃された|新たに確認|再確認)/u,
    /(?:すべて|全て).{0,12}付帯サービス.{0,18}(?:再開済|再開しました|通常営業)/u,
    /(?:列車|MRT|全線).{0,8}(?:無料乗車|運賃無料|無料運行)/u,
    /(?:文湖線|淡水信義線|松山新店線|板南線|中和新蘆線|南勢角|大橋頭|北投～大安|南港展覧館～亜東医院).{0,90}(?:間隔|分ごと|秒ごと)/u
  ]
};

const TRTC_NOON_APPROVED_SUPPLEMENTAL = {
  "zh-TW": [
    "薔琵颱風｜10/24 台鐵北迴、宜蘭線搶修，北捷逐步加密班距",
    "北捷公告五線逐步加密至 8 分至 9 分 30 秒，三段重疊區間約 4 分 30 秒；保留台鐵東部搶修、改班與停駛例外",
    "逐步加密至 8 分～9 分 30 秒／重疊約 4 分 30 秒",
    "北捷 10/24「12:00」逐步加密班距速報（12:24 資料更新）",
    "北捷 10/24「06:00」舊 12／6 分鐘方案（僅歷史，非此次新班距）",
    "北捷先前部分首班待通知方案（10/23 公布，當時資料更新 20:06，僅供歷史參考）",
    "北捷 10/23「17:10」停駛區段稿（僅供歷史參考）"
  ],
  "en": [
    "Typhoon Champi · Oct 24: TRA North-Link/Yilan repairs; Taipei Metro plans to gradually shorten headways",
    "Taipei Metro announces gradual headways on five lines of 8 minutes to 9 minutes 30 seconds, with about 4 minutes 30 seconds on three overlapping sections; TRA eastern repairs, service changes and specified cancellations remain included.",
    "Gradually 8min–9min30s; overlapping sections about 4min30s",
    "Taipei Metro's Oct 24 '12:00' gradual headway update (data updated at 12:24)",
    "Taipei Metro's earlier Oct 24 '06:00' 12/6-minute plan (historical only; not this update's new headways)",
    "Taipei Metro's earlier first-service-pending plan (published Oct 23; data updated at 20:06 at that time; historical reference only)",
    "Taipei Metro's Oct 23 '17:10' suspension-section notice (historical reference only)"
  ],
  "ja": [
    "新しい発表に風速条件の再掲がないことを条件の撤回とは扱いません。",
    "台風情報｜10/24 台湾鉄道の北廻線・宜蘭線は復旧作業中、台北MRTは段階的に間隔短縮",
    "台北MRTは5路線を8分～9分30秒間隔へ段階的に短縮し、3つの重複区間は約4分30秒間隔と発表。台湾鉄道東部の復旧作業・運行変更・個別の運休情報も引き続き掲載。",
    "段階的に8分～9分30秒間隔、重複区間は約4分30秒",
    "台北MRT 10/24「12:00」の段階的な運転間隔短縮速報（12:24データ更新）",
    "台北MRT 10/24「06:00」の旧12分／6分間隔計画（過去の参考のみ。今回の新間隔ではありません）",
    "台北MRTの以前の一部始発続報待ち計画（10/23公表、当時のデータ更新20:06、過去の参考のみ）",
    "台北MRT 10/23「17:10」の運休区間発表（過去の参考のみ）"
  ]
};

function assertTRTCNoonFacts(text, language = 'zh-TW', { context = 'TRTC noon operating facts' } = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error(`${context}: nonempty text required`);
  if (!Object.prototype.hasOwnProperty.call(TRTC_NOON_CONTRADICTIONS, language)) throw new Error(`${context}: unsupported language ${language}`);
  const actual = normalizeTRTCNoon(text);
  const approved = [];
  for (const check of TRTC_NOON_FACTS.checks) {
    for (const fragment of check.fragments[language]) {
      const expected = normalizeTRTCNoon(fragment);
      if (!actual.includes(expected)) throw new Error(`${context}: missing or altered fact ${check.id} (${language})`);
      approved.push(expected);
    }
  }
  approved.push(...TRTC_NOON_APPROVED_SUPPLEMENTAL[language].map(normalizeTRTCNoon));
  let residual = actual;
  for (const fragment of [...new Set(approved)].sort((a, b) => b.length - a.length)) residual = residual.split(fragment).join('');
  for (const pattern of TRTC_NOON_CONTRADICTIONS[language]) {
    if (pattern.test(residual)) throw new Error(`${context}: contradictory or unsupported operating assertion (${language})`);
  }
  return {
    language,
    revision: TRTC_NOON_FACTS.revision,
    factGroups: TRTC_NOON_FACTS.checks.length,
    lines: TRTC_NOON_FACTS.lineCount,
    overlapSections: TRTC_NOON_FACTS.overlapSectionCount,
    headwayRangeSeconds: [...TRTC_NOON_FACTS.headwayRangeSeconds],
    overlapHeadwaySeconds: TRTC_NOON_FACTS.overlapHeadwaySeconds,
    exactHeadwayScopeBindings: true,
    gradualNotCompleted: true,
    headlineNotExplicitStartTime: true,
    headlineNotProofOfExactPublicationTime: true,
    oldTwelveSixHistoricalOnly: true,
    oldSafetyConditionsHistoricalNotReconfirmed: true,
    noOmissionAsRevocation: true
  };
}

const NT_TYMC_FACTS = {
  "schema": 1,
  "revision": "20261024-1508",
  "serviceDate": "2026-10-24",
  "checkedAt": "2026-10-24T15:08:38+08:00",
  "expiresAt": "2026-10-25T00:00:00+08:00",
  "rawEvidence": "/private/tmp/rail-weather-ntmetro-ankeng-readonly-1024-1400.json",
  "sourceEvidenceFiles": [
    {
      "path": "/private/tmp/rail-weather-ntmetro-ankeng-readonly-1024-1400.json",
      "sha256": "e49461fe39fe6021865f55ba93aba9cc3902fdf8ddbeff6e9467969c0fd69321"
    },
    {
      "path": "/private/tmp/rail-weather-nt-tymc-new-source-1024-1345.json",
      "sha256": "4adf9f1a8cfe8a896809cf9aa6e968ca8c3d91eded1fca6a66e6befdf2db8718"
    },
    {
      "path": "/private/tmp/rail-weather-tymc-afr-new-notices-1024-1505-source.json",
      "sha256": "3dec2087ff254ad646c6edf7c76516ba117ab87e008a341d91003f71ca120090"
    }
  ],
  "canonicalDraft": "/private/tmp/rail-weather-tymc-afr-1024-1508-bulletin-draft.json",
  "canonicalDraftSHA256": "03133059d4aaf8e4f4f0fc6859ffc678dbdfcb02a26ff3a74990984cfa457693",
  "checks": [
    {
      "id": "nt-circular-and-sanying-approximately-fifteen",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "10/24 本輪核對新北捷運官方首頁已載入的最新跑馬，環狀線與三鶯線班距皆約 15 分鐘，"
        ],
        "en": [
          "In this Oct 24 check, the fully loaded scrolling notices on New Taipei Metro's official homepage give headways of about 15 minutes for both the Circular and Sanying lines,"
        ],
        "ja": [
          "10月24日の今回の確認では、新北MRT公式トップページで読み込みが完了した最新スクロール案内に、環状線と三鶯線はいずれも約15分間隔、"
        ]
      }
    },
    {
      "id": "nt-ankeng-approximately-thirty",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "安坑輕軌班距約 30 分鐘；"
        ],
        "en": [
          "and about 30 minutes for Ankeng LRT."
        ],
        "ja": [
          "安坑ライトレールは約30分間隔と記載されています。"
        ]
      }
    },
    {
      "id": "nt-three-lines-demand-dependent-adjust-slow-or-suspend",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "三線各自註明將視運量調整班距、降速行駛或暫停營運。"
        ],
        "en": [
          "Each of the three notices says headways may be adjusted, trains may slow down or service may be suspended according to demand."
        ],
        "ja": [
          "3路線とも利用状況に応じて運転間隔の調整、減速、運休を行う場合があります。"
        ]
      }
    },
    {
      "id": "nt-ankeng-normal-tab-extended-headway-field",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "正常點選首頁安坑輕軌欄位後，顯示「全線班距延長」。"
        ],
        "en": [
          "A normal click on the homepage's Ankeng LRT tab shows 'extended headways throughout the line'."
        ],
        "ja": [
          "トップページの安坑ライトレールのタブを通常の操作で選ぶと、「全線で運転間隔を延長」と表示されます。"
        ]
      }
    },
    {
      "id": "nt-ankeng-thirty-new-explicit-not-yesterday-carryover",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "安坑約 30 分鐘是本輪官方最新明文，並非把昨日停駛前的班距自動延用。"
        ],
        "en": [
          "The approximately 30-minute Ankeng headway is explicitly stated in the latest official notice in this check; it is not an automatic carry-over of yesterday's pre-suspension headway."
        ],
        "ja": [
          "安坑の約30分間隔は今回の最新の公式案内に明記されたもので、昨日の運休前の運転間隔を自動的に引き継いだものではありません。"
        ]
      }
    },
    {
      "id": "nt-short-notice-no-service-date-publication-start-or-resumption",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "短訊本身未列適用日期、精確發布、開始或復駛時刻，"
        ],
        "en": [
          "The short notices give no service date, exact publication time, start time or resumption time."
        ],
        "ja": [
          "短文自体には適用日、正確な発表時刻、開始時刻、再開時刻は記載されていません。"
        ]
      }
    },
    {
      "id": "nt-check-time-not-sanying-or-ankeng-resumption-time",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "不能把核讀時刻當成三鶯或安坑的復駛起點，"
        ],
        "en": [
          "The check time is not a confirmed Sanying or Ankeng resumption time,"
        ],
        "ja": [
          "確認時刻を三鶯線や安坑の再開時刻とはせず、"
        ]
      }
    },
    {
      "id": "nt-not-full-normal-timetable-restoration",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "也不能寫成全面恢復正常班表。"
        ],
        "en": [
          "and this is not a statement that the full normal timetable has resumed."
        ],
        "ja": [
          "通常ダイヤへの全面復帰ともしていません。"
        ]
      }
    },
    {
      "id": "nt-danhai-entire-line-still-not-operating",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "首頁淡海輕軌欄位仍顯示「全線停止運作」，"
        ],
        "en": [
          "The homepage's Danhai LRT field still reads 'entire line out of operation'."
        ],
        "ja": [
          "トップページの淡海ライトレール欄は引き続き「全線運行停止」です。"
        ]
      }
    },
    {
      "id": "nt-no-danhai-resumption-from-other-three-lines",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "本輪尚未取得淡海復駛的明確公告，不能由其他三線的班距推定淡海已復駛。"
        ],
        "en": [
          "No explicit Danhai resumption notice was obtained in this check; the other three lines' headways do not establish resumption on Danhai."
        ],
        "ja": [
          "淡海の再開を明記した発表は今回確認できておらず、ほかの3路線の運転間隔から淡海の再開を推定できません。"
        ]
      }
    },
    {
      "id": "nt-earlier-three-line-stop-history-not-current-sanying-or-ankeng-stop",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "先前 08:44 核對的「三線維持停駛」跑馬及 10/23 15:00 起三線預防性停駛原文，僅保留為歷史依據，不能當成最新三鶯線、安坑輕軌仍停駛的公告；"
        ],
        "en": [
          "The scrolling notice checked at 08:44 saying that all three lines remained suspended and the notice of preventive suspension from 15:00 on Oct 23 are retained as historical evidence only, not as the latest statement that Sanying and Ankeng are still suspended."
        ],
        "ja": [
          "08:44に確認した「3路線は運休継続」というスクロール案内と、10月23日15:00から3路線を予防的に運休する発表は、過去の根拠資料としてのみ残し、三鶯線や安坑が現在も運休中という最新発表としては扱っていません。"
        ]
      }
    },
    {
      "id": "nt-yesterday-safety-inspection-conditions-historical",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "昨日原文要求風雨趨緩並完成軌道、供電與沿線安全巡檢確認後才能恢復。"
        ],
        "en": [
          "Yesterday's notice required wind and rain to ease and safety confirmation after inspections of track, power supply and lineside conditions before resumption."
        ],
        "ja": [
          "昨日の発表は、風雨が弱まり、軌道・電力設備・沿線の安全点検を終えて安全を確認してから再開するとしていました。"
        ]
      }
    },
    {
      "id": "nt-yesterday-danhai-thirty-not-todays-plan",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "昨日停駛前的淡海每 30 分鐘班距不能自動延用為今日方案，"
        ],
        "en": [
          "Yesterday's pre-suspension 30-minute headway on Danhai is not automatically today's plan."
        ],
        "ja": [
          "昨日の運休前の淡海30分間隔を本日の計画に自動的に引き継ぐことはせず、"
        ]
      }
    },
    {
      "id": "nt-missing-notice-or-indicators-not-resumption",
      "system": "ntmetro",
      "fragments": {
        "zh-TW": [
          "公告缺失或一般燈號也不等於復駛。"
        ],
        "en": [
          "Missing notices or generic operating indicators do not establish resumption."
        ],
        "ja": [
          "発表の消失や一般的な運行表示だけでは再開を確認できません。"
        ]
      }
    },
    {
      "id": "tymc-headline-date-and-unconfirmed-exact-time",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "桃捷 10/24 最新公告標題標示「14:00」，頁面日期為 10/24，未確認精確發布或生效時刻，不能把標題時間當成直達車開始或全面復駛時間。"
        ],
        "en": [
          "Taoyuan Metro's latest Oct 24 notice has '14:00' in its headline and an Oct 24 page date. The exact publication or effective time is unconfirmed; the headline time is not a confirmed start or full resumption time for express services."
        ],
        "ja": [
          "桃園MRTの10月24日付の最新発表は、見出しに「14:00」、ページ日付に10月24日と表示されています。正確な発表時刻や適用開始時刻は未確認で、見出しの時刻を直達車の開始時刻や全面再開時刻とはしていません。"
        ]
      }
    },
    {
      "id": "tymc-commuter-current-fifteen-minute-headway",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "今日普通車維持 15 分鐘班距，"
        ],
        "en": [
          "Today, commuter trains maintain 15-minute headways,"
        ],
        "ja": [
          "本日の普通車は15分間隔を維持し、"
        ]
      }
    },
    {
      "id": "tymc-flight-and-crowd-dependent-flexible-express",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "並依機場航班需求、視人潮狀況彈性加開直達車班次；"
        ],
        "en": [
          "with additional express services provided flexibly according to airport flight demand and crowds."
        ],
        "ja": [
          "空港のフライト需要と利用者の状況に応じて直達車を柔軟に増発します。"
        ]
      }
    },
    {
      "id": "tymc-a1-a3-all-day-checkin-and-baggage-suspension",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "A1 台北車站、A3 新北產業園區站預辦登機及行李託運服務全天暫停。"
        ],
        "en": [
          "In-town check-in and baggage services at A1 Taipei Main Station and A3 New Taipei Industrial Park are suspended all day."
        ],
        "ja": [
          "A1台北車站・A3新北産業園区の市内チェックインと受託手荷物受付は終日休止です。"
        ]
      }
    },
    {
      "id": "tymc-no-new-express-start-time",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "新稿未重列直達車加開起始時刻，"
        ],
        "en": [
          "The new notice does not repeat an express-service start time"
        ],
        "ja": [
          "新しい発表には直達車の増発開始時刻の再掲、"
        ]
      }
    },
    {
      "id": "tymc-no-fixed-express-headway-count-or-normal-speed-time",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "也未列固定直達車班距、增開班次總數或恢復正常速度時間，"
        ],
        "en": [
          "or give a fixed express headway, total number of additional services or time for a return to normal speed."
        ],
        "ja": [
          "固定運転間隔、増発本数の合計、通常速度に戻す時刻はありません。"
        ]
      }
    },
    {
      "id": "tymc-not-full-normal-express-timetable",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "不能把彈性加開寫成直達車已全面依正常班表運行。"
        ],
        "en": [
          "Flexible additions do not mean that the full normal express timetable has resumed."
        ],
        "ja": [
          "柔軟な増発を、直達車の通常ダイヤへの全面復帰とはしていません。"
        ]
      }
    },
    {
      "id": "tymc-previous-133740-holiday-from13-wind-plan",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "先前頁面顯示 10/24 13:37:40 的公告曾寫普通車依假日時刻、自 13 時起視人潮彈性加開直達，並依實際風速調整營運模式及班距；"
        ],
        "en": [
          "The earlier notice displaying 13:37:40 on Oct 24 said commuter trains followed the holiday timetable, express services would be added flexibly according to crowds from 13:00, and operating patterns and headways would be adjusted to actual wind speeds."
        ],
        "ja": [
          "先に10月24日13:37:40と表示された発表は、普通車を休日ダイヤどおりとし、13:00から利用状況に応じて直達車を柔軟に増発し、実際の風速に応じて運行形態や運転間隔を調整するとしていました。"
        ]
      }
    },
    {
      "id": "tymc-old-holiday-not-replace15-and-wind-omission-not-revocation",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "僅作先前方案參考，不能把其假日時刻概括取代新稿明列的 15 分鐘，亦不把最新稿省略風速條件當成撤銷。"
        ],
        "en": [
          "It is retained as the previous plan only: its general holiday-timetable wording does not replace the latest explicit 15-minute headway, and omission of the wind conditions from the new notice does not establish their withdrawal."
        ],
        "ja": [
          "これは前の計画としてのみ残し、休日ダイヤという一般的な表現で最新の15分間隔を置き換えず、新しい発表に風速条件の再掲がないことを条件の撤回とは扱いません。"
        ]
      }
    },
    {
      "id": "tymc-earlier-all-day-express-cancellation-historical",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "更早 10/23 公布的 10/24 直達及加班車全天取消模式僅供歷史參考，不是最新列車方案。"
        ],
        "en": [
          "The still earlier Oct 24 plan, published on Oct 23, cancelling express and extra services all day is historical only, not the latest train plan."
        ],
        "ja": [
          "さらに前の10月23日発表の10月24日直達車・増発列車終日運休は、過去の計画であり、最新の列車運行計画ではありません。"
        ]
      }
    },
    {
      "id": "tymc-old-slow-history-last-full-success0151",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "10/23 21:55:16 強風慢速稿僅保留歷史依據，最近成功核讀為 10/24 01:51；"
        ],
        "en": [
          "The Oct 23 21:55:16 strong-wind reduced-speed article is retained as historical evidence only; it was last successfully read at 01:51 on Oct 24."
        ],
        "ja": [
          "10月23日21:55:16の強風による減速記事は過去の根拠資料としてのみ残し、最後に正常閲覧できたのは10月24日01:51です。"
        ]
      }
    },
    {
      "id": "tymc-historical-redirect-not-recovery-or-speed-proof",
      "system": "tymc",
      "fragments": {
        "zh-TW": [
          "原連結最近核對仍轉至首頁，不能因轉址推定已恢復或保證今日正常速度。"
        ],
        "en": [
          "Its original link still redirected to the homepage in the most recent check. The redirect does not establish recovery or guarantee normal speed today."
        ],
        "ja": [
          "元のリンクは直近の確認でもトップページへ転送されており、転送は復旧を意味せず、本日の通常速度を保証しません。"
        ]
      }
    }
  ],
  "independenceAudit": {
    "groups": 26,
    "ntmetroGroups": 14,
    "tymcGroups": 12,
    "duplicateOrContainedFragments": 0
  },
  "ntmetro": {
    "sanyingHeadwayMinutes": 15,
    "circularHeadwayMinutes": 15,
    "ankengHeadwayMinutes": 30,
    "sourceCheckedAt": "2026-10-24T13:56:31+08:00",
    "sanyingStartTimeNotGiven": true,
    "ankengStartTimeNotGiven": true,
    "danhaiSuspended": true,
    "old914NotCurrentSanyingOrAnkengStop": true,
    "ankengThirtyIsNewExplicitNotYesterdayCarryover": true
  },
  "tymc": {
    "noticeTitleTime": "14:00",
    "titleTimeDoesNotEstablishExactPublicationOrStart": true,
    "pageDate": "2026-10-24",
    "commuterHeadwayMinutes": 15,
    "flightDemandDependentExtraExpress": true,
    "crowdDependentExtraExpress": true,
    "checkInBaggageAllDaySuspended": true,
    "checkInBaggageStations": [
      "A1",
      "A3"
    ],
    "noNewExpressStartTimeGiven": true,
    "noFixedExpressHeadwayOrFullResumptionClaim": true,
    "previousHolidayAnd1300HistoricalOnly": true,
    "windConditionOmissionNotWithdrawal": true,
    "oldSlowLinkRedirectNotFullRecheck": true
  }
};

function normalizeNtTymc(value) {
  return String(value).normalize('NFC').replace(/[\s\u00a0\u200b\ufeff]+/g, '');
}
const NT_TYMC_CONTRADICTIONS = {
  'zh-TW': [
    /安坑.{0,24}(?:仍|維持|繼續|目前|現在|尚未).{0,12}(?:停駛|停止營運|停止運作|復駛)/u,
    /安坑.{0,20}(?:營運方案|班距).{0,12}(?:待確認|未確認|不明|未知)/u,
    /安坑.{0,24}(?:已於|自|於|開始).{0,15}[0-9]{1,2}(?:[:：][0-9]{2}|時).{0,15}(?:復駛|恢復|營運)/u,
    /安坑.{0,24}(?:全面|正常班表|正常時刻表)/u,
    /安坑.{0,20}(?:約|每|班距為)15(?:分|分鐘)/u,
    /(?:三鶯|環狀).{0,20}(?:約|每|班距為)30(?:分|分鐘)/u,
    /三鶯(?:線)?.{0,24}(?:尚未|仍未|未曾).{0,12}(?:復駛|恢復|載客)/u,
    /淡海.{0,24}(?:恢復服務|開始載客|恢復載客|運作中)/u,
    /直達車.{0,25}(?:恢復|依照|按).{0,10}(?:例行|正常)(?:時刻表|班表)/u,
    /(?:預辦登機|行李託運).{0,25}(?:可正常使用|可使用|已可辦理|開放辦理)/u,
    /(?:三鶯|環狀).{0,24}(?:不會|不再|不受|不依).{0,20}(?:運量|調整|降速|暫停)/u,
    /普通車.{0,20}(?:每(?:隔)?|班距(?:為|是)|維持)15(?:分|分鐘)/u,
    /直達車.{0,20}(?:不再|不會|不予|不)(?:加開|增開)/u,
    /(?:桃捷|機場捷運|營運模式|班距).{0,25}(?:不再|不會|不受|不依).{0,20}(?:風速|風力|調整)/u,
    /(?:三鶯(?:線)?|新北三線).{0,28}(?:仍|維持|繼續|目前|現在).{0,12}(?:停駛|停止營運|停止運作)/u,
    /(?:三鶯(?:線)?).{0,28}(?:(?:自|於|已在|確定|開始|復駛).{0,15}[0-9]{1,2}(?:[:：][0-9]{2}|時|點)|(?:已|全面).{0,12}(?:正常班表|正常時刻|正常營運))/u,
    /淡海.{0,20}(?:已(?:經)?復駛|恢復(?:正常)?(?:營運|行駛)|正常(?:營運|行駛)|開放行駛)/u,
    /(?:三鶯(?:線)?|環狀線|安坑輕軌|安坑線).{0,26}(?:(?:固定|保證|每隔|班距為)[0-9]|(?:班距|間隔).{0,12}(?:固定|保證|確定)[0-9])/u,
    /(?:普通車|機場捷運普通車|桃捷普通車).{0,24}(?:固定|保證|確定|現在每|目前每).{0,8}15(?:分|分鐘)/u,
    /(?:直達車).{0,28}(?:全面|全數|全部|已經|已).{0,18}(?:復駛|恢復正常|正常班表|正常時刻表)/u,
    /(?:直達車).{0,28}(?:全天|全日).{0,8}(?:取消|停駛)/u,
    /(?:直達車).{0,24}(?:固定|每隔|班距為|保證).{0,8}[0-9]+(?:分|分鐘)/u,
    /(?:增開|加開).{0,12}[0-9]+(?:班|列).{0,8}直達車/u,
    /(?:預辦登機|行李託運|託運服務).{0,24}(?:已恢復|恢復辦理|已重啟|正常辦理|已開放)/u,
    /(?:桃捷|機場捷運).{0,24}(?:已恢復|保證|維持).{0,10}正常速度/u,
    /(?:13:37:40).{0,18}(?:就是|確定為|即為).{0,8}(?:精確發布|生效|開始)/u
  ],
  en: [
    /Ankeng.{0,28}(?:still|remains?|notyet|hasnot).{0,15}(?:suspended|closed|resumed|reopened)/iu,
    /Ankeng.{0,24}(?:plan|headway).{0,16}(?:unconfirmed|unknown)/iu,
    /Ankeng.{0,24}(?:resumed|reopened|started).{0,15}(?:at|from)[0-9]{1,2}:[0-9]{2}/iu,
    /Ankeng.{0,24}(?:fullnormal|normaltimetable|regularschedule)/iu,
    /Ankeng.{0,24}(?:about|every)15(?:-?minutes?)/iu,
    /(?:Sanying|Circular).{0,24}(?:about|every)30(?:-?minutes?)/iu,
    /Sanying.{0,24}(?:hasnot|havenot|notyet).{0,12}(?:resumed|reopened)/iu,
    /Danhai.{0,24}(?:isback|hasrestored|hasreturned)/iu,
    /(?:AirportMRTexpress(?:trains|services)?|expresstrains|expressservices).{0,35}(?:returned|restored|running).{0,18}(?:regular|normal).{0,10}(?:timetable|schedule)/iu,
    /(?:check-in|checkin|baggage).{0,35}(?:areopenagain|isopenagain|availableagain|canbeused)/iu,
    /(?:Sanying|Circular).{0,30}(?:not|never|nolonger).{0,30}(?:demand|slowdown|suspend|adjust)/iu,
    /Danhai.{0,25}(?:isbackinservice|isnowoperating|hasreturnedtonormal)/iu,
    /commuter(?:trains|services)?.{0,25}(?:every|headwaysof|intervalsof)15(?:-?minute)/iu,
    /(?:AirportMRTexpress(?:trains|services)?|express(?:trains|services)).{0,25}(?:remain|are|still).{0,15}(?:cancelled|canceled|suspended).{0,18}(?:allday|throughouttheday)/iu,
    /(?:no|not|never).{0,15}(?:additional|extra).{0,15}express(?:trains|services)?/iu,
    /(?:operatingpatterns|operatingmodes|headways|AirportMRT).{0,35}(?:nolonger|not).{0,30}wind/iu,
    /(?:Sanying|allthreeNewTaipeilines).{0,30}(?:remains?|still|currently|is).{0,14}(?:suspended|closed|outofoperation)/iu,
    /Sanying.{0,40}(?:resumed|resumes|reopened|reopens|started|starts).{0,20}(?:at|from)[0-9]{1,2}:[0-9]{2}/iu,
    /Sanying.{0,35}(?:hasreturned|hasresumed|nowruns|hasfully).{0,20}(?:normal|timetable|service)/iu,
    /Danhai.{0,30}(?:hasresumed|haveresumed|reopened|operatesnormally|runsnormally|isrunning)/iu,
    /(?:Sanying|Circular|Ankeng).{0,35}(?:fixed|exactly|guaranteed).{0,15}[0-9]+-?(?:minute|second)/iu,
    /(?:commuter(?:trains|services)?).{0,35}(?:fixed|guaranteed|exactly|nowevery|currentlyevery).{0,12}15(?:-?minute)/iu,
    /(?:express(?:trains|services)?).{0,35}(?:all|fully|complete|normal).{0,25}(?:resumed|restored|timetable|schedule)/iu,
    /(?:all|every).{0,15}express(?:trains|services)?.{0,22}(?:cancelled|canceled|suspended).{0,12}(?:allday|forthewholeday)/iu,
    /express(?:trains|services)?.{0,30}(?:fixed|exactly|every|guaranteed).{0,10}[0-9]+(?:-?minute)/iu,
    /(?:adds?|additional|extra).{0,12}[0-9]+(?:expressservices|expresstrains)/iu,
    /(?:check-in|checkin|baggage(?:services)?).{0,35}(?:hasresumed|haveresumed|arenowopen|isnowavailable|havebeenrestored|isavailableagain)/iu,
    /(?:AirportMRT|TaoyuanMetro).{0,30}(?:hasreturnedto|guarantees|nowrunsat).{0,12}normalspeed/iu,
    /13:37:40.{0,15}(?:istheexact|provestheexact).{0,12}(?:publication|start|effective)/iu
  ],
  ja: [
    /安坑.{0,24}(?:現在も|今も|引き続き|まだ).{0,15}(?:運休|停止|再開していません)/u,
    /安坑.{0,24}(?:運行計画|運転間隔).{0,10}(?:未確認|不明)/u,
    /安坑.{0,20}[0-9]{1,2}(?:[:：][0-9]{2}|時).{0,12}(?:再開|復帰|開始)/u,
    /安坑.{0,24}(?:通常ダイヤ|全面再開|全面復帰)/u,
    /安坑.{0,20}(?:約|毎)15分/u,
    /(?:三鶯|環状).{0,20}(?:約|毎)30分/u,
    /三鶯線.{0,24}(?:まだ|なお|いまだ).{0,15}(?:再開していません|再開していない|運休)/u,
    /淡海.{0,25}(?:運転再開|再開して|運行中)/u,
    /直達車.{0,25}(?:通常の時刻表|通常ダイヤ).{0,15}(?:運行|運転|復帰|戻り)/u,
    /普通車.{0,20}15分おき/u,
    /(?:チェックイン|受託手荷物|荷物受付).{0,25}(?:再開して|受付可能|利用できます)/u,
    /(?:三鶯線|環状線).{0,30}(?:利用状況|需要).{0,15}(?:関係なく|影響しない|調整しない)/u,
    /普通車.{0,20}15分(?:間隔|ごと)/u,
    /直達車.{0,25}(?:通常ダイヤ|通常運転).{0,15}(?:戻り|復帰|再開)/u,
    /直達車.{0,20}(?:増発しません|増発しない|追加しない)/u,
    /(?:運行形態|運転間隔|空港MRT).{0,30}(?:風速|風力).{0,15}(?:影響しない|関係ない|応じません|調整しません)/u,
    /(?:三鶯線|新北MRTの3路線).{0,28}(?:現在も|今も|引き続き|依然|なお).{0,10}(?:運休|停止)/u,
    /三鶯線.{0,24}[0-9]{1,2}(?:[:：][0-9]{2}|時).{0,12}(?:再開|復帰|運転開始)/u,
    /三鶯線.{0,25}(?:全面|すべて|すでに).{0,15}(?:通常ダイヤ|通常運転|再開)/u,
    /淡海.{0,25}(?:再開しました|運転を再開|通常運転|通常営業|再開済)/u,
    /(?:三鶯線|環状線|安坑線).{0,25}(?:正確に|固定|必ず|保証).{0,10}[0-9]+分/u,
    /普通車.{0,25}(?:固定|必ず|正確に|現在は).{0,10}15分/u,
    /直達車.{0,30}(?:全面|すべて|全て|完全に).{0,15}(?:再開|復帰|通常ダイヤ)/u,
    /(?:直達車|全直達車).{0,24}(?:終日運休|終日取消)/u,
    /直達車.{0,24}(?:固定|正確に|必ず).{0,10}[0-9]+分/u,
    /直達車.{0,12}[0-9]+本.{0,8}(?:増発|追加)/u,
    /(?:チェックイン|受託手荷物|荷物受付).{0,24}(?:再開しました|再開済|受付再開|通常営業|利用可能)/u,
    /(?:桃園MRT|空港MRT).{0,25}(?:通常速度に復帰|通常速度を保証|通常速度に戻りました)/u,
    /13:37:40.{0,15}(?:正確な発表|適用開始|運転開始).{0,8}(?:です|である|を示す)/u
  ]
};


const J_TYMC_ADDITIONAL_CONTRADICTIONS = {
 'zh-TW': [/14:00.{0,18}(?:就是|確定為|即為).{0,8}(?:精確發布|生效|開始)/u, /普通車.{0,24}(?:目前|今日|現在|最新).{0,20}(?:假日時刻|休日班表)/u, /(?:今日|現在|最新).{0,15}普通車.{0,20}(?:假日時刻|休日班表)/u, /普通車.{0,20}(?:班距|每|維持).{0,10}(?:10|20|30)分鐘/u, /(?:桃捷|直達車).{0,25}(?:確定|精確|正式|自)14:00.{0,20}(?:開始|生效|復駛)/u, /(?:航班|人潮).{0,20}(?:無關|不影響|不需|不依)/u],
 en: [/14:00.{0,15}(?:istheexact|provestheexact).{0,12}(?:publication|start|effective)/iu, /commuter(?:trains|services)?.{0,25}(?:now|today|currently|latest).{0,20}(?:holidaytimetable|holidayschedule)/iu, /(?:today|current|latest).{0,15}commuter(?:trains|services)?.{0,25}holiday/iu, /commuter(?:trains|services)?.{0,25}(?:every|headways|intervals).{0,10}(?:10|20|30)-?minutes?/iu, /(?:AirportMRT|express(?:trains|services)).{0,30}(?:exactly|effectivefrom|startsat|resumedat)14:00/iu, /(?:flightdemand|crowds).{0,25}(?:irrelevant|doesnotaffect|notrequired)/iu],
 ja: [/14:00.{0,15}(?:正確な発表|適用開始|運転開始).{0,8}(?:です|である|を示す)/u, /(?:本日|現在|最新).{0,15}普通車.{0,20}休日ダイヤ/u, /普通車.{0,20}(?:現在|本日|最新).{0,20}休日ダイヤ/u, /普通車.{0,20}(?:10|20|30)分間隔/u, /(?:直達車|桃園MRT).{0,20}14:00.{0,20}(?:確定|正式開始|全面再開|適用開始です)/u, /(?:フライト需要|利用状況).{0,20}(?:関係なく|無関係|影響しない)/u]
};

const NT_TYMC_APPROVED_SUPPLEMENTAL = {
  "zh-TW": [
    "薔琵颱風｜10/24 桃捷普通 15 分鐘，林鐵沼平、神木 13 時起恢復",
    "桃捷10/24「14:00」標題稿明列普通車15分鐘、依機場航班需求及人潮彈性加開直達，A1/A3預辦登機及行李託運全天停辦。林鐵官方列表標題列沼平、神木24日13時起恢復，本線、祝山25日恢復；新單篇全文、班次及附加條件尚未取得。台鐵東部15時仍是11:30原文預估，尚非實際復通確認；北捷逐步加密及新北15/15/30分方案保留。",
    "桃捷普通15分鐘、依航班與人潮彈性加開直達；林鐵列表：沼平、神木24日13時起恢復，本線、祝山25日恢復。",
    "新北捷運（環狀、淡海、安坑、三鶯）",
    "環狀、三鶯約 15 分鐘／安坑約 30 分鐘／淡海停駛",
    "新北捷運官方首頁最新跑馬（環狀、三鶯約 15 分鐘；安坑約 30 分鐘）",
    "新北捷運 10/23 三線停駛原文（僅供歷史依據，不代表最新三鶯、安坑仍停駛）",
    "新北捷運官方公開粉專（本輪登入頁，最近公開成功 10/24 07:15）",
    "桃園機場捷運",
    "普通車 15 分鐘／依航班與人潮彈性增開直達",
    "桃捷 10/24「14:00」營運模式（標題時間；普通 15 分鐘、彈性加開直達）",
    "桃捷先前 10/24 公告（頁面顯示 13:37:40；假日時刻與 13 時起彈性直達僅供歷史參考）",
    "桃捷更早 10/24 模式（10/23 公布；直達及加班車全天取消僅供歷史參考）",
    "桃捷 10/23 21:55:16 慢速歷史原文（目前轉址，最近成功 10/24 01:51）",
    "阿里山林鐵",
    "沼平、神木 10/24 13 時起恢復／本線、祝山 10/25 恢復（列表標題）",
    "林鐵官方最新列表（10/24 新標題；僅確認路線與恢復日期時段）",
    "林鐵處 10/22 19:00 更新舊原文（僅歷史，10/24 15:05 成功重讀）"
  ],
  "en": [
    "Typhoon Champi | Oct 24 Airport MRT commuter trains every 15 minutes; Alishan Zhaoping and Shenmu lines resume from 13:00",
    "Taoyuan Metro's Oct 24 notice headed '14:00' specifies 15-minute commuter headways and flexible extra express services according to airport flight demand and crowds; A1/A3 in-town check-in and baggage services remain closed all day. The Alishan official list headline gives Zhaoping and Shenmu resumption from 13:00 on Oct 24, and mainline/Zhushan resumption on Oct 25; the new article's full text, train services and additional conditions are unconfirmed. TRA's 15:00 eastern restoration remains an estimate from its 11:30 notice, not confirmation of actual resumption. Taipei Metro's gradual headway reductions and New Taipei's 15/15/30-minute plans are retained.",
    "Airport MRT commuter trains run every 15 minutes, with flexible extra express services according to flights and crowds. The Alishan official list gives Zhaoping/Shenmu resumption from 13:00 on Oct 24 and mainline/Zhushan resumption on Oct 25.",
    "新北捷運（環狀、淡海、安坑、三鶯）",
    "環狀、三鶯約 15 分鐘／安坑約 30 分鐘／淡海停駛",
    "新北捷運官方首頁最新跑馬（環狀、三鶯約 15 分鐘；安坑約 30 分鐘）",
    "新北捷運 10/23 三線停駛原文（僅供歷史依據，不代表最新三鶯、安坑仍停駛）",
    "新北捷運官方公開粉專（本輪登入頁，最近公開成功 10/24 07:15）",
    "桃園機場捷運",
    "普通車 15 分鐘／依航班與人潮彈性增開直達",
    "桃捷 10/24「14:00」營運模式（標題時間；普通 15 分鐘、彈性加開直達）",
    "桃捷先前 10/24 公告（頁面顯示 13:37:40；假日時刻與 13 時起彈性直達僅供歷史參考）",
    "桃捷更早 10/24 模式（10/23 公布；直達及加班車全天取消僅供歷史參考）",
    "桃捷 10/23 21:55:16 慢速歷史原文（目前轉址，最近成功 10/24 01:51）",
    "阿里山林鐵",
    "沼平、神木 10/24 13 時起恢復／本線、祝山 10/25 恢復（列表標題）",
    "林鐵官方最新列表（10/24 新標題；僅確認路線與恢復日期時段）",
    "林鐵處 10/22 19:00 更新舊原文（僅歷史，10/24 15:05 成功重讀）"
  ],
  "ja": [
    "台風情報｜10月24日 空港MRT普通車は15分間隔、阿里山の沼平・神木線は13:00から運転再開",
    "桃園MRTの10月24日「14:00」という見出しの発表は、普通車15分間隔、空港のフライト需要と利用状況に応じた直達車の柔軟な増発、A1/A3の市内チェックイン・受託手荷物受付の終日休止を明記しています。林鉄の公式一覧の見出しは、沼平・神木線が10月24日13:00から再開、本線・祝山線が10月25日に再開としていますが、新記事の全文・列車・追加条件は未確認です。台鉄東部の15:00再開は11:30の発表にある見込みであり、実際の復旧確認ではありません。台北MRTの段階的な間隔短縮と、新北MRTの15・15・30分間隔の計画は保持しています。",
    "空港MRT普通車は15分間隔、フライト需要と利用状況に応じて直達車を柔軟に増発します。林鉄公式一覧では沼平・神木線は10月24日13:00から、本線・祝山線は10月25日に再開予定です。",
    "新北捷運（環狀、淡海、安坑、三鶯）",
    "環狀、三鶯約 15 分鐘／安坑約 30 分鐘／淡海停駛",
    "新北捷運官方首頁最新跑馬（環狀、三鶯約 15 分鐘；安坑約 30 分鐘）",
    "新北捷運 10/23 三線停駛原文（僅供歷史依據，不代表最新三鶯、安坑仍停駛）",
    "新北捷運官方公開粉專（本輪登入頁，最近公開成功 10/24 07:15）",
    "桃園機場捷運",
    "普通車 15 分鐘／依航班與人潮彈性增開直達",
    "桃捷 10/24「14:00」營運模式（標題時間；普通 15 分鐘、彈性加開直達）",
    "桃捷先前 10/24 公告（頁面顯示 13:37:40；假日時刻與 13 時起彈性直達僅供歷史參考）",
    "桃捷更早 10/24 模式（10/23 公布；直達及加班車全天取消僅供歷史參考）",
    "桃捷 10/23 21:55:16 慢速歷史原文（目前轉址，最近成功 10/24 01:51）",
    "阿里山林鐵",
    "沼平、神木 10/24 13 時起恢復／本線、祝山 10/25 恢復（列表標題）",
    "林鐵官方最新列表（10/24 新標題；僅確認路線與恢復日期時段）",
    "林鐵處 10/22 19:00 更新舊原文（僅歷史，10/24 15:05 成功重讀）"
  ]
};

function assertNtTymcFacts(text, language = 'zh-TW', {context = 'NT/TYMC updated facts'} = {}) {
  if (typeof text !== 'string' || text.trim().length === 0) throw new Error(`${context}: nonempty text required`);
  if (!Object.prototype.hasOwnProperty.call(NT_TYMC_CONTRADICTIONS, language)) throw new Error(`${context}: unsupported language ${language}`);
  const actual = normalizeNtTymc(text);
  const approved = [];
  for (const check of NT_TYMC_FACTS.checks) {
    for (const fragment of check.fragments[language]) {
      const expected = normalizeNtTymc(fragment);
      if (!actual.includes(expected)) throw new Error(`${context}: missing or altered fact ${check.id} (${language})`);
      approved.push(expected);
    }
  }
  approved.push(...NT_TYMC_APPROVED_SUPPLEMENTAL[language].map(normalizeNtTymc));
  let residual = actual;
  for (const fragment of [...new Set(approved)].sort((a,b)=>b.length-a.length)) residual = residual.split(fragment).join('');
  for (const pattern of [...NT_TYMC_CONTRADICTIONS[language], ...J_TYMC_ADDITIONAL_CONTRADICTIONS[language]]) {
    if (pattern.test(residual)) throw new Error(`${context}: contradictory or unsupported operating assertion (${language})`);
  }
  return {
    language, revision: NT_TYMC_FACTS.revision,
    factGroups: NT_TYMC_FACTS.checks.length,
    ntmetroFactGroups: NT_TYMC_FACTS.checks.filter(c=>c.system==='ntmetro').length,
    tymcFactGroups: NT_TYMC_FACTS.checks.filter(c=>c.system==='tymc').length,
    exactServiceAndConditionBindings: true,
    historicalAndUnknownBoundariesRetained: true,
    noUnstatedStartOrRestoration: true,
    ntmetro: {sanyingHeadwayMinutes:15,circularHeadwayMinutes:15,ankengHeadwayMinutes:30,sanyingStartTimeNotGiven:true,ankengStartTimeNotGiven:true,danhaiSuspended:true,old914NotCurrentSanyingOrAnkengStop:true,ankengThirtyIsNewExplicitNotYesterdayCarryover:true},
    tymc: {"noticeTitleTime": "14:00", "titleTimeDoesNotEstablishExactPublicationOrStart": true, "pageDate": "2026-10-24", "commuterHeadwayMinutes": 15, "flightDemandDependentExtraExpress": true, "crowdDependentExtraExpress": true, "checkInBaggageAllDaySuspended": true, "checkInBaggageStations": ["A1", "A3"], "noNewExpressStartTimeGiven": true, "noFixedExpressHeadwayOrFullResumptionClaim": true, "previousHolidayAnd1300HistoricalOnly": true, "windConditionOmissionNotWithdrawal": true, "oldSlowLinkRedirectNotFullRecheck": true}
  };
}

const AFR_LIST_FACTS = {
  "schema": 1,
  "revision": "20261024-1508",
  "serviceDate": "2026-10-24",
  "sourceUrl": "https://afrch.forest.gov.tw/AllNews",
  "sourceCheckedAt": "2026-10-24T15:05:37+08:00",
  "newFullArticleObtained": false,
  "canonicalDraft": "/private/tmp/rail-weather-tymc-afr-1024-1508-bulletin-draft.json",
  "canonicalDraftSHA256": "03133059d4aaf8e4f4f0fc6859ffc678dbdfcb02a26ff3a74990984cfa457693",
  "checks": [
    {
      "id": "afr-official-list-real-success1505",
      "fragments": {
        "zh-TW": [
          "本輪 10/24 15:05 成功核讀林鐵官方最新列表，日期 10/24 的新標題明列："
        ],
        "en": [
          "The Alishan Forest Railway's latest official list was successfully read at 15:05 on Oct 24."
        ],
        "ja": [
          "阿里山林業鉄道の公式最新一覧を10月24日15:05に正常閲覧しました。"
        ]
      }
    },
    {
      "id": "afr-zhaoping-shenmu-oct24-from1300",
      "fragments": {
        "zh-TW": [
          "沼平線、神木線 10/24 下午 1 時（13:00）起恢復營運；"
        ],
        "en": [
          "A new entry dated Oct 24 states that the Zhaoping and Shenmu lines resume operations from 13:00 on Oct 24,"
        ],
        "ja": [
          "10月24日付の新しい見出しは、沼平線・神木線が10月24日午後1時（13:00）から運転再開、"
        ]
      }
    },
    {
      "id": "afr-mainline-zhushan-oct25-only",
      "fragments": {
        "zh-TW": [
          "本線及祝山線 10/25 恢復營運。"
        ],
        "en": [
          "while the mainline and Zhushan Line resume on Oct 25."
        ],
        "ja": [
          "本線・祝山線が10月25日に運転再開と明記しています。"
        ]
      }
    },
    {
      "id": "afr-only-title-route-date-time-confirmed",
      "fragments": {
        "zh-TW": [
          "這裡僅依官方列表標題確認以上路線與日期時段，"
        ],
        "en": [
          "Only the routes, dates and time stated in that official list headline are confirmed here."
        ],
        "ja": [
          "ここで確認できたのは、この公式一覧の見出しにある路線・日付・時間帯のみです。"
        ]
      }
    },
    {
      "id": "afr-not-today-mainline-zhushan-or-all-branches",
      "fragments": {
        "zh-TW": [
          "不能把明日方案寫成今日本線或祝山線已復駛，也不能擴成今日全支線恢復。"
        ],
        "en": [
          "Tomorrow's plan does not mean the mainline or Zhushan Line has resumed today, and the notice must not be expanded to all branch lines resuming today."
        ],
        "ja": [
          "明日の計画を本線や祝山線が本日すでに再開したという意味にせず、本日の全支線再開にも拡大しません。"
        ]
      }
    },
    {
      "id": "afr-later-normal-reads500-unavailable",
      "fragments": {
        "zh-TW": [
          "隨後 15:08 再讀列表及 15:09 一次正常重讀皆回傳 HTTP 500 並顯示「Web Page Blocked!」，正常重讀受阻，"
        ],
        "en": [
          "The subsequent list check at 15:08 and one normal retry at 15:09 both returned HTTP 500 and displayed “Web Page Blocked!”. Normal rereading was blocked,"
        ],
        "ja": [
          "その後15:08の一覧再閲覧と15:09の通常の再試行1回はいずれもHTTP 500で「Web Page Blocked!」と表示され、通常の再閲覧が遮断されました。"
        ]
      }
    },
    {
      "id": "afr-new-article-url-and-full-text-not-obtained",
      "fragments": {
        "zh-TW": [
          "未取得這則新公告的單篇網址或完整正文，"
        ],
        "en": [
          "and the new article's individual URL and complete text have not been obtained;"
        ],
        "ja": [
          "新しい発表の個別URLや全文は取得できておらず、"
        ]
      }
    },
    {
      "id": "afr-publication-trains-first-services-conditions-unconfirmed",
      "fragments": {
        "zh-TW": [
          "精確發布時刻、班次、明日首班及其他附加條件尚未確認，"
        ],
        "en": [
          "its exact publication time, train services, tomorrow's first departures and any additional conditions remain unconfirmed."
        ],
        "ja": [
          "正確な発表時刻、列車、明日の始発、追加条件は未確認です。"
        ]
      }
    },
    {
      "id": "afr-no-guess-or-normal-speed-guarantee",
      "fragments": {
        "zh-TW": [
          "不能補推或保證正常速度，"
        ],
        "en": [
          "Do not infer them or guarantee normal speed."
        ],
        "ja": [
          "これらを推定したり通常速度を保証したりせず、"
        ]
      }
    },
    {
      "id": "afr-announced1300-not-checktime",
      "fragments": {
        "zh-TW": [
          "13:00 也不是本輪核讀時刻。"
        ],
        "en": [
          "The announced 13:00 is not the time of this check."
        ],
        "ja": [
          "13:00を今回の確認時刻ともしていません。"
        ]
      }
    },
    {
      "id": "afr-old1900-read1505-historical-only",
      "fragments": {
        "zh-TW": [
          "10/22 19:00 更新的舊原文於 10/24 15:05 再次成功核讀，僅保留為歷史依據；"
        ],
        "en": [
          "The earlier article updated at 19:00 on Oct 22 was successfully re-read at 15:05 on Oct 24 and is retained as historical evidence only."
        ],
        "ja": [
          "10月22日19:00更新の旧記事は10月24日15:05に再び正常閲覧できましたが、過去の根拠資料としてのみ残します。"
        ]
      }
    },
    {
      "id": "afr-old-park-conditional-plan-not-override-new1300",
      "fragments": {
        "zh-TW": [
          "不能用其支線配合遊樂區開放、尚未明列開行時間的先前方案覆蓋新列表已明列的沼平、神木 13:00。"
        ],
        "en": [
          "Its earlier plan tying branch services to the recreation area's opening without a definite departure time does not override the new list's explicit 13:00 resumption for Zhaoping and Shenmu."
        ],
        "ja": [
          "遊楽区の開園に合わせるとし、具体的な発車時刻を示していなかった従来の支線計画で、沼平線・神木線の13:00再開を明記した新しい一覧を上書きしません。"
        ]
      }
    },
    {
      "id": "afr-village-opening-not-park-or-train-recovery",
      "fragments": {
        "zh-TW": [
          "嘉義市檜意森活村及阿里山林業村開園不代表阿里山國家森林遊樂區開放或列車復駛，以上恢復資訊是依鐵道營運的新列表標題。"
        ],
        "en": [
          "Reopening of the Hinoki Village and Alishan Forestry Village in Chiayi City does not establish reopening of the national forest recreation area or train services; the resumption information above comes from the new railway-operating headline on the official list."
        ],
        "ja": [
          "嘉義市の檜意森活村・阿里山林業村の開園は、国家森林遊楽区の開園や列車再開を意味しません。上記の再開情報は、公式一覧の新しい鉄道運行見出しに基づきます。"
        ]
      }
    }
  ]
};

const AFR_LIST_CONTRADICTIONS = {
 'zh-TW': [/(?:本線|祝山線).{0,24}(?:今日|今天|10\/24|24日).{0,16}(?:已|恢復|復駛|正常營運)/u, /(?:今日|今天|10\/24|24日).{0,20}(?:本線|祝山線).{0,20}(?:復駛|恢復|正常營運)/u, /(?:林鐵|阿里山).{0,20}(?:今日|今天|24日).{0,16}(?:全線|全支線|所有支線).{0,15}(?:復駛|恢復|正常)/u, /(?:新公告|新文章|新稿).{0,25}(?:全文|單篇|網址).{0,15}(?:已取得|已核讀|完整成功|已確認)/u, /(?:沼平|神木).{0,25}(?:仍停駛|尚未復駛|待確認|明日|10\/25|25日)/u, /(?:沼平|神木).{0,20}(?:14:00|15:00|15:05).{0,12}(?:起恢復|起復駛|開始營運)/u, /(?:本線|祝山).{0,25}(?:首班|首班車).{0,12}[0-9]{1,2}(?:時|:)/u, /(?:林鐵|阿里山).{0,20}(?:正常速度|保證正常|全線正常)/u, /(?:林鐵|新公告).{0,24}(?:精確發布|發布時刻).{0,15}(?:就是|確認|13:00|15:05)/u, /(?:園區|遊樂區|森林遊樂區|檜意森活村|阿里山林業村).{0,30}(?:開放|開園).{0,20}(?:代表|證實|所以).{0,16}(?:列車|林鐵).{0,10}(?:復駛|恢復)/u],
 en: [/(?:mainline|Zhushan).{0,30}(?:resumed|running|normal|operating).{0,20}(?:today|Oct24)/iu, /(?:all|every).{0,15}Alishan.{0,25}branchlines.{0,20}operat(?:e|ing).{0,20}(?:today|Oct24)/iu, /(?:mainline|Zhushan).{0,30}(?:today|Oct24).{0,20}(?:resumed|running|normal|operating)/iu, /(?:today|Oct24).{0,25}(?:mainline|Zhushan).{0,25}(?:resumed|running|normal|operating)/iu, /(?:all|every).{0,15}(?:Alishan|branchlines).{0,20}(?:resumed|reopened|operate).{0,20}(?:today|Oct24)/iu, /(?:newarticle|newnotice).{0,25}(?:fulltext|completebody|individualURL).{0,20}(?:obtained|verified|readsuccessfully)/iu, /(?:Zhaoping|Shenmu).{0,30}(?:stillsuspended|notyetresumed|tomorrow|Oct25)/iu, /(?:Zhaoping|Shenmu).{0,25}(?:14:00|15:00|15:05).{0,20}(?:resume|resumption|start)/iu, /(?:mainline|Zhushan).{0,25}first(?:train|departure).{0,15}[0-9]{1,2}:/iu, /Alishan.{0,25}(?:guarantees|nowrunsat).{0,15}normalspeed/iu, /(?:park|village).{0,25}reopening.{0,15}(?:proves|means|establishes).{0,20}(?:train|rail).{0,20}(?:resumption|recovery)/iu],
 ja: [/(?:本線|祝山線).{0,25}(?:本日|今日|10月24日).{0,20}(?:再開済|再開しました|通常運転)/u, /(?:本日|今日|10月24日).{0,20}(?:本線|祝山線).{0,20}(?:再開しました|再開済|通常運転)/u, /(?:全支線|全線|すべての支線).{0,20}(?:本日|今日).{0,20}(?:再開|通常運転)/u, /(?:新記事|新しい発表).{0,20}(?:全文|個別URL).{0,15}(?:取得済|取得しました|確認済|閲覧済)/u, /(?:沼平|神木).{0,24}(?:運休継続|まだ再開していません|明日|10月25日)/u, /(?:沼平|神木).{0,20}(?:14:00|15:00|15:05).{0,15}(?:再開|開始)/u, /(?:本線|祝山線).{0,25}始発.{0,12}[0-9]{1,2}(?:時|:)/u, /林業鉄道.{0,20}(?:通常速度を保証|通常速度に復帰)/u, /(?:遊楽区|村).{0,20}開園.{0,20}(?:証明|意味します).{0,20}(?:列車|鉄道).{0,15}再開/u]
};

function assertAFRListFacts(text, language='zh-TW', {context='AFR official-list minimum facts'}={}) {
 if(typeof text!=='string'||!text.trim())throw new Error(`${context}: nonempty text required`);
 if(!Object.prototype.hasOwnProperty.call(AFR_LIST_CONTRADICTIONS,language))throw new Error(`${context}: unsupported language`);
 const actual=normalizeNtTymc(text), approved=[];
 for(const c of AFR_LIST_FACTS.checks)for(const fragment of c.fragments[language]){
  const expected=normalizeNtTymc(fragment);
  if(!actual.includes(expected))throw new Error(`${context}: missing or altered fact ${c.id} (${language})`);
  approved.push(expected);
 }
 approved.push(...NT_TYMC_APPROVED_SUPPLEMENTAL[language].map(normalizeNtTymc));
 let residual=actual;
 for(const x of [...new Set(approved)].sort((a,b)=>b.length-a.length))residual=residual.split(x).join('');
 for(const pattern of AFR_LIST_CONTRADICTIONS[language])if(pattern.test(residual))throw new Error(`${context}: contradictory or unsupported operating assertion (${language})`);
 return {language,revision:AFR_LIST_FACTS.revision,factGroups:AFR_LIST_FACTS.checks.length,"sourceScope": "official-list-title-only", "titleOnly": true, "newArticleFullTextObtained": false, "newArticleURLObtained": false, "routeDateTimeBindingsVerified": true, "zhaopingShenmu": {"serviceDate": "2026-10-24", "from": "13:00"}, "mainlineZhushan": {"serviceDate": "2026-10-25", "firstTrainTimeUnconfirmed": true}, "precisePublicationTimeUnconfirmed": true, "trainServicesAndAdditionalConditionsUnconfirmed": true, "normalSpeedNotGuaranteed": true, "listLastSuccessfulCheckedAt": "2026-10-24T15:05:37+08:00", "listLaterNormalReadsUnavailable": true, "old1900SourceHistoricalOnly": true, "parkOpeningNotTrainResumption": true};
}

const tra = source.systems.find(s => s.id === 'tra');
assert.equal(tra.sourceUrl, "https://www.railway.gov.tw/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=8ae4cac2a16a254301a16c15868d53b5&page=0");
assert.equal(tra.sourceCheckedAt, '2026-10-24T12:15:45+08:00');
assert.match(tra.sourceLabel, /10\/24 11:30.*北迴.*宜蘭.*搶修/);
assert.equal(tra.additionalSources.length, 2);
assert.ok(tra.additionalSources[0].sourceUrl.includes('8ae4cac3a1650e3a01a16b5888661c31'));
assert.match(tra.additionalSources[0].sourceLabel, /08:30.*歷史.*11:30/);
assert.ok(tra.additionalSources[1].sourceUrl.includes('8ae4cac3a1650e3a01a16906f5681318'));
assert.match(tra.additionalSources[1].sourceLabel, /中午前.*歷史/);
assert.match(tra.detail, /預計 15:00.*尚非實際復駛確認.*432 次（臺北 15:00 開車）.*273 次（花蓮 14:18 開車）/);
assert.match(tra.detail, /5216 次改停駛.*5233 次.*5249 次仍停駛/);
assert.match(tra.detail, /2608 次成功 11:39 是先前上午例外.*並非此次新恢復時刻/);
for (const lang of ['zh-TW','en','ja']) assertTRAUpdatedFacts(lang==='zh-TW' ? tra.detail : tra.detailI18n[lang],lang,{context:'官方原文獨立核對的台鐵完整方案'});
assert.doesNotMatch(tra.detailI18n.en, /free (?:ride|fare|of charge)/i);

const afr = source.systems.find(s => s.id === 'afr');
assert.equal(afr.status, "沼平、神木 10/24 13 時起恢復／本線、祝山 10/25 恢復（列表標題）");
assert.equal(afr.sourceUrl, "https://afrch.forest.gov.tw/AllNews");
assert.equal(afr.sourceCheckedAt, "2026-10-24T15:05:37+08:00");
assert.equal(afr.sourceLabel, "林鐵官方最新列表（10/24 新標題；僅確認路線與恢復日期時段）");
assert.equal(afr.additionalSources.length, 1);
assert.equal(afr.additionalSources[0].sourceUrl, "https://afrch.forest.gov.tw/AllNews/0079490");
assert.equal(afr.additionalSources[0].sourceLabel, "林鐵處 10/22 19:00 更新舊原文（僅歷史，10/24 15:05 成功重讀）");
for(const lang of ['zh-TW','en','ja']) assertAFRListFacts(lang==='zh-TW'?afr.detail:afr.detailI18n[lang],lang,{context:'官方列表標題最小復駛範圍，非新文章全文'});
const thsr = source.systems.find(s => s.id === 'thsr');
assert.equal(thsr.sourceUrl, 'https://www.thsrc.com.tw/ArticleContent/0a67aca6-69e4-4a47-a3cf-ffbd2568648d');
assert.match(thsr.detail, /10\/24 全線正常營運，各車次依時刻表發車/);
assert.match(thsr.detail, /10\/23 的 8825、8529.*僅適用昨日，不能當作今日停駛資訊/);
assert.match(thsr.detailI18n.en, /normal service.*Oct 24.*8825 and 8529 applied to Oct 23 only/);
assert.match(thsr.detailI18n.ja, /10月24日の全線通常運転.*10月23日限定/);
const tmrt = source.systems.find(s => s.id === 'tmrt');
assert.ok(tmrt.sourceUrl.includes('6ad4cf49-4444-48f8-8cd0-944a0391e16d'));
assert.match(tmrt.detail, /^10\/24.*15 分鐘.*平均風力達 7 級.*40 公里.*平均 8 級或瞬間 10 級.*2 小時/);
assert.match(tmrt.detail, /不代表本輪已確認實際降速或停駛/);
assert.match(tmrt.detailI18n.en, /On Oct 24.*15 minutes.*not confirmation that a speed restriction or suspension is currently in effect/);
assert.match(tmrt.detailI18n.ja, /10月24日.*15分間隔.*実際の減速・運休を確認したという意味ではありません/);
const trtc = source.systems.find(s => s.id === 'trtc');
assert.equal(trtc.sourceUrl, "https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=07211C1B52E9F4FE");
assert.equal(trtc.sourceCheckedAt, '2026-10-24T12:32:41+08:00');
assert.equal(trtc.sourceLabel, "北捷 10/24「12:00」逐步加密班距速報（12:24 資料更新）");
assert.equal(trtc.additionalSources.length,3);
for (const old of trtc.additionalSources) assert.match(old.sourceLabel,/歷史/);
assert.ok(trtc.additionalSources[0].sourceUrl.includes('1E432CD2383523BA'));
assert.match(trtc.additionalSources[0].sourceLabel,/06:00.*歷史/);
assert.ok(trtc.additionalSources[1].sourceUrl.includes('D24768D861F3702F'));
assert.ok(trtc.additionalSources[2].sourceUrl.includes('649A1A69E7BC170D'));
for (const lang of ['zh-TW','en','ja']) assertTRTCNoonFacts(lang==='zh-TW'?trtc.detail:trtc.detailI18n[lang],lang,{context:'北捷12:00新原文完整獨立核對'});
assert.doesNotMatch(trtc.status,/12:00 起|已全部|完成調整/);
const tymc = source.systems.find(s => s.id === 'tymc');
const ntmetro = source.systems.find(s => s.id === 'ntmetro');
assert.equal(tymc.status, "普通車 15 分鐘／依航班與人潮彈性增開直達");
assert.equal(tymc.sourceUrl, "https://www.tymetro.com.tw/tymetro-new/tw/_pages/news/show-2440-1.html");
assert.equal(tymc.sourceCheckedAt, "2026-10-24T15:08:38+08:00");
assert.equal(tymc.sourceLabel, "桃捷 10/24「14:00」營運模式（標題時間；普通 15 分鐘、彈性加開直達）");
assert.equal(tymc.additionalSources.length, 3);
assert.equal(tymc.additionalSources[0].sourceUrl, "https://www.tymetro.com.tw/tymetro-new/tw/_pages/general/show-23-1.html");
assert.equal(tymc.additionalSources[0].sourceLabel, "桃捷先前 10/24 公告（頁面顯示 13:37:40；假日時刻與 13 時起彈性直達僅供歷史參考）");
assert.equal(tymc.additionalSources[1].sourceUrl, "https://www.tymetro.com.tw/tymetro-new/tw/_pages/news/show-2439-1.html");
assert.equal(tymc.additionalSources[1].sourceLabel, "桃捷更早 10/24 模式（10/23 公布；直達及加班車全天取消僅供歷史參考）");
assert.equal(tymc.additionalSources[2].sourceUrl, "https://www.tymetro.com.tw/tymetro-new/tw/_pages/general/show-22-1.html");
assert.equal(tymc.additionalSources[2].sourceLabel, "桃捷 10/23 21:55:16 慢速歷史原文（目前轉址，最近成功 10/24 01:51）");
assert.equal(ntmetro.status, "環狀、三鶯約 15 分鐘／安坑約 30 分鐘／淡海停駛");
assert.equal(ntmetro.sourceUrl, "https://www.ntmetro.com.tw/");
assert.equal(ntmetro.sourceCheckedAt, "2026-10-24T13:56:31+08:00");
assert.equal(ntmetro.sourceLabel, "新北捷運官方首頁最新跑馬（環狀、三鶯約 15 分鐘；安坑約 30 分鐘）");
assert.equal(ntmetro.additionalSources.length, 2);
assert.equal(ntmetro.additionalSources[0].sourceUrl, "https://www.ntmetro.com.tw/basic/?mode=detail&node=914");
assert.equal(ntmetro.additionalSources[0].sourceLabel, "新北捷運 10/23 三線停駛原文（僅供歷史依據，不代表最新三鶯、安坑仍停駛）");
assert.equal(ntmetro.additionalSources[1].sourceUrl, "https://www.facebook.com/NewTaipeiMetro/");
assert.equal(ntmetro.additionalSources[1].sourceLabel, "新北捷運官方公開粉專（本輪登入頁，最近公開成功 10/24 07:15）");
for (const lang of ['zh-TW','en','ja']) assertNtTymcFacts([tymc,ntmetro].map(s=>lang==='zh-TW'?s.detail:s.detailI18n[lang]).join('\n'),lang,{context:'新北與桃捷最新原文完整獨立核對'});
const krtc = source.systems.find(s => s.id === 'krtc');
const klrt = source.systems.find(s => s.id === 'klrt');
for (const system of [krtc, klrt]) {
  assert.equal(system.sourceUrl, 'https://www.krtc.com.tw/Information/notice');
  assert.match(system.status, /10\/24.*待確認/);
  assert.match(system.detail, /空稿.*不能/);
  assert.match(system.detailI18n.en, /Oct 24/);
  assert.match(system.detailI18n.ja, /10月24日/);
}
for (const system of [krtc,klrt]) {
  assert.match(system.detail, /官方公開粉專本輪要求登入.*最近成功公開核讀為 10\/24 07:15.*不能宣稱本輪重新讀到最新貼文/);
  assert.match(system.detailI18n.en, /requires login in this check.*07:15 on Oct 24.*not been freshly verified/);
  assert.match(system.detailI18n.ja, /今回ログインを求められ.*10月24日07:15.*今回最新投稿を再確認できたとはしていません/);
}
assert.match(krtc.detail, /慢速稿最近成功核讀為 10\/23 20:59.*不能因原文消失或網站一般正常燈號推定已恢復/);
assert.match(krtc.detail, /昨日 14:30 起 10 分鐘、23:00 後 20 分鐘方案不直接延用為今日班距/);
assert.match(krtc.detailI18n.en, /not automatically extended to today/);
assert.match(klrt.detail, /不能推定今日仍為 20 分鐘.*不能據此推定復駛或正常營運/);
assert.match(klrt.detailI18n.en, /does not confirm 20-minute headways today, resumption or normal service/);
assert.equal(railWeatherNotice(Date.parse('2026-10-23T23:59:59+08:00')), null);
assert.ok(railWeatherNotice(Date.parse('2026-10-24T00:00:00+08:00')));
assert.ok(railWeatherNotice(Date.parse('2026-10-24T23:59:59+08:00')));
assert.equal(railWeatherNotice(Date.parse('2026-10-25T00:00:00+08:00')), null);
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
            const renderedWeatherText = await page.locator('#alertDetail').innerText();
            assertTRAUpdatedFacts(renderedWeatherText,'zh-TW',{context:name+'/'+width+'/'+mode+' 實際手機公告'});
            assertTRTCNoonFacts(renderedWeatherText,'zh-TW',{context:'actual mobile/legacy noon TRTC'});
            assertNtTymcFacts(renderedWeatherText,'zh-TW',{context:'actual mobile/legacy NT TYMC'});
            assertAFRListFacts(renderedWeatherText,'zh-TW',{context:'actual mobile/legacy AFR title-only minimum scope'});
            for (const system of source.systems) assert.equal(renderedWeatherText.split(system.detail).length-1,1,system.id+' 手機畫面完整且恰好一次');
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
          await page.clock.setSystemTime(new Date('2026-10-25T00:01:00+08:00'));
          assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 0);
          await page.clock.setSystemTime(new Date(when));
          // 單看林鐵：原本沒有 Alert API，現在仍要收到全台提醒。
          if (width === 375) {
            await page.evaluate(async () => { await selectGroup(GROUPS.find(g => g.id === 'tra')); state.schedSystems = state.schedSystems.filter(s => s.id === 'afr_sched'); state.alert = null; await pollAlert(); });
            assert.equal(await page.evaluate(() => activeAlertList().filter(a => a.bulletin).length), 1);
          }
          await page.goto(base + '/weather-status.html');
          assert.equal(await page.locator('section').count(), 9);
          assert.equal(await page.locator('section[aria-labelledby="trtc"] a').count(), 4, '北捷12:00新稿與三份歷史來源均保留可查閱');
          assert.equal(await page.locator('section[aria-labelledby="tra"] a').count(), 3, '11:30新方案與08:30及中午前歷史來源共三筆均可查閱');
          assert.equal(await page.locator('section[aria-labelledby="tymc"] a').count(), 4, '14:00新稿、13:37歷史、先前今日模式與歷史慢速來源均保留');
          assert.equal(await page.locator('section[aria-labelledby="afr"] a').count(), 2, '官方新列表標題與舊19時歷史原文分列');
          assert.equal(await page.locator('section[aria-labelledby="ntmetro"] a').count(), 3, '最近停駛原文與今日待確認的官方最新入口都可查閱');
          const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
          assert.ok(pageOverflow <= 1);
          for (const a of await page.locator('section a').all()) {
            await a.scrollIntoViewIfNeeded();
            assert.ok(await a.evaluate(e => { const r = e.getBoundingClientRect(), h = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return r.height >= 44 && (h === e || e.contains(h)); }));
          }
          await page.evaluate(() => scrollTo(0, 0));
          await page.screenshot({ path: path.join(outDir, `${name}-${width}-status.png`), fullPage: true });
          await page.clock.setSystemTime(new Date('2026-10-25T00:01:00+08:00'));
          await page.reload();
          assert.match(await page.locator('#ageNote').innerText(), /已過適用日期/);
          if (width === 375) {
            const languageTitles = {
              en: "Typhoon Champi | Oct 24 Airport MRT commuter trains every 15 minutes; Alishan Zhaoping and Shenmu lines resume from 13:00",
              ja: "台風情報｜10月24日 空港MRT普通車は15分間隔、阿里山の沼平・神木線は13:00から運転再開",
            };
            await page.clock.setSystemTime(new Date(when));
            for (const lang of ['en','ja']) {
              await page.goto(base+'/?lang='+lang, {waitUntil:'domcontentloaded'});
              await page.waitForFunction(() => state.ready && activeAlertList().some(a => a.bulletin), null, {timeout:60000});
              await page.tap('#alertChip');
              await page.waitForFunction(() => !document.getElementById('alertDetail').hidden);
              const translatedText = await page.locator('#alertDetail').innerText();
              assert.ok(translatedText.includes(languageTitles[lang]),name+' '+lang+' 完整翻譯標題');
              for (const system of source.systems) assert.equal(translatedText.split(system.detailI18n[lang]).length-1,1,system.id+' '+lang+' 完整且恰好一次');
              const traFacts = assertTRAUpdatedFacts(translatedText,lang,{context:name+' '+lang+' 手機實際公告'});
              traFacts.trtcNoon = assertTRTCNoonFacts(translatedText,lang,{context:'actual mobile/legacy noon TRTC'});
              traFacts.ntTymc = assertNtTymcFacts(translatedText,lang,{context:'actual mobile/legacy NT TYMC'});
              traFacts.afr = assertAFRListFacts(translatedText,lang,{context:'actual mobile/legacy AFR title-only minimum scope'});
              assert.ok(await page.evaluate(() => document.documentElement.scrollWidth-innerWidth <= 1),lang+' 無水平溢出');
              states.push({mode:'language-'+lang,operatorDetailsOnce:true,traFacts});
              await page.screenshot({path:path.join(outDir,name+'-375-'+lang+'-notice.png')});
            }
          }
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
        assert.ok(text.includes(ntmetro.detail), '舊網頁仍須顯示最新完整新北公告');
        assertTRAUpdatedFacts(text,'zh-TW',{context:'已開啟的舊網頁台鐵完整方案'});
        assertTRTCNoonFacts(text,'zh-TW',{context:'actual mobile/legacy noon TRTC'});
        assertNtTymcFacts(text,'zh-TW',{context:'actual mobile/legacy NT TYMC'});
        assertAFRListFacts(text,'zh-TW',{context:'actual mobile/legacy AFR title-only minimum scope'});
        assert.ok(text.includes(thsr.detail), '舊網頁完整保留今日高鐵方案與昨日取消的日期區別');
        assert.ok(text.includes(trtc.detail), '舊網頁完整保留今日北捷五線方案與時刻限制');



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
        assertTRAUpdatedFacts(text,'zh-TW',{context:'已發行App台鐵完整方案'});
        assertTRTCNoonFacts(text,'zh-TW',{context:'actual mobile/legacy noon TRTC'});
        assertNtTymcFacts(text,'zh-TW',{context:'actual mobile/legacy NT TYMC'});
        assertAFRListFacts(text,'zh-TW',{context:'actual mobile/legacy AFR title-only minimum scope'});
        assert.ok(text.includes(thsr.detail), '已發行App須顯示今日高鐵正常營運與日期區別');
        // 已發行App的 HTML normal white-space 會把新公告段落換行合併為空白；仍比較整張完整內容。
        assert.ok(text.replace(/\s+/g, ' ').includes(trtc.detail.replace(/\s+/g, ' ')), '已發行App保留今日北捷五線完整方案與時刻限制');
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
