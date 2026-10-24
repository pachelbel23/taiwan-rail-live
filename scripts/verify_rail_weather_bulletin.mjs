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
assert.match(source.title, /10\/24.*台鐵中午後分批恢復.*新北三線維持停駛/);
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
  "revision": "20261024-0845",
  "newPlanTrainNumbers": [
    "118",
    "120",
    "137",
    "125",
    "133",
    "5120",
    "2608",
    "2615",
    "2534",
    "2527",
    "5216",
    "426",
    "219",
    "5233",
    "5249",
    "271",
    "277",
    "281"
  ],
  "newPlanDepartureTimes": [
    "12:31",
    "12:15",
    "12:57",
    "11:39",
    "12:26",
    "12:49",
    "12:30",
    "12:25",
    "12:40",
    "12:14",
    "12:35",
    "12:45",
    "17:09",
    "17:38",
    "19:01",
    "19:30"
  ],
  "checks": [
    {
      "id": "new-train-118-route-time-scope",
      "fragments": {
        "zh-TW": [
          "西部對號順行自屏東至七堵 118 次（彰化 12:31）及海線 120 次起恢復；"
        ],
        "en": [
          "Restoration schedule after noon: Western Main Line reserved-seat services resume from Train 118, Pingtung–Qidu (Changhua departure 12:31), and Trains 137 and 125, Qidu–Chaozhou (Taipei departures 12:15 and 12:57 respectively)."
        ],
        "ja": [
          "正午以降の再開計画：西部幹線の指定席列車は、屏東～七堵118次（彰化12:31発）と七堵～潮州137次・125次（台北12:15発・12:57発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-120-route-time-scope",
      "fragments": {
        "zh-TW": [
          "西部對號順行自屏東至七堵 118 次（彰化 12:31）及海線 120 次起恢復；"
        ],
        "en": [
          "Coast Line reserved-seat services resume from Train 120 (clockwise) and Train 133 (counterclockwise), in their respective directions; the notice gives no termini or departure times for these two trains."
        ],
        "ja": [
          "海線の指定席列車は120次（時計回り）・133次（反時計回り）から、それぞれの方向で再開。"
        ]
      }
    },
    {
      "id": "new-train-137-route-time-scope",
      "fragments": {
        "zh-TW": [
          "逆行自七堵至潮州 137 次（臺北 12:15）、125 次（臺北 12:57）及海線 133 次起恢復，鳳山至七堵 5120 次停駛。"
        ],
        "en": [
          "Restoration schedule after noon: Western Main Line reserved-seat services resume from Train 118, Pingtung–Qidu (Changhua departure 12:31), and Trains 137 and 125, Qidu–Chaozhou (Taipei departures 12:15 and 12:57 respectively)."
        ],
        "ja": [
          "正午以降の再開計画：西部幹線の指定席列車は、屏東～七堵118次（彰化12:31発）と七堵～潮州137次・125次（台北12:15発・12:57発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-125-route-time-scope",
      "fragments": {
        "zh-TW": [
          "逆行自七堵至潮州 137 次（臺北 12:15）、125 次（臺北 12:57）及海線 133 次起恢復，鳳山至七堵 5120 次停駛。"
        ],
        "en": [
          "Restoration schedule after noon: Western Main Line reserved-seat services resume from Train 118, Pingtung–Qidu (Changhua departure 12:31), and Trains 137 and 125, Qidu–Chaozhou (Taipei departures 12:15 and 12:57 respectively)."
        ],
        "ja": [
          "正午以降の再開計画：西部幹線の指定席列車は、屏東～七堵118次（彰化12:31発）と七堵～潮州137次・125次（台北12:15発・12:57発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-133-route-time-scope",
      "fragments": {
        "zh-TW": [
          "逆行自七堵至潮州 137 次（臺北 12:15）、125 次（臺北 12:57）及海線 133 次起恢復，鳳山至七堵 5120 次停駛。"
        ],
        "en": [
          "Coast Line reserved-seat services resume from Train 120 (clockwise) and Train 133 (counterclockwise), in their respective directions; the notice gives no termini or departure times for these two trains."
        ],
        "ja": [
          "海線の指定席列車は120次（時計回り）・133次（反時計回り）から、それぞれの方向で再開。"
        ]
      }
    },
    {
      "id": "new-train-5120-route-time-scope",
      "fragments": {
        "zh-TW": [
          "逆行自七堵至潮州 137 次（臺北 12:15）、125 次（臺北 12:57）及海線 133 次起恢復，鳳山至七堵 5120 次停駛。"
        ],
        "en": [
          "Train 5120, Fongshan–Qidu, is cancelled because of typhoon-related rolling-stock arrangements."
        ],
        "ja": [
          "台風による車両運用の影響で、鳳山～七堵5120次は運休します。"
        ]
      }
    },
    {
      "id": "new-train-2608-route-time-scope",
      "fragments": {
        "zh-TW": [
          "西部非對號成追線順行自臺中至通霄 2608 次（成功 11:39）、逆行自通霄至豐原 2615 次（追分 12:26）恢復；"
        ],
        "en": [
          "Non-reserved services on the Chengzhui Line resume from Train 2608, Taichung–Tongxiao (Chenggong departure 11:39), and Train 2615, Tongxiao–Fengyuan (Zhuifen departure 12:26)."
        ],
        "ja": [
          "成追線の非指定席列車は、台中～通霄2608次（成功11:39発）と通霄～豊原2615次（追分12:26発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-2615-route-time-scope",
      "fragments": {
        "zh-TW": [
          "西部非對號成追線順行自臺中至通霄 2608 次（成功 11:39）、逆行自通霄至豐原 2615 次（追分 12:26）恢復；"
        ],
        "en": [
          "Non-reserved services on the Chengzhui Line resume from Train 2608, Taichung–Tongxiao (Chenggong departure 11:39), and Train 2615, Tongxiao–Fengyuan (Zhuifen departure 12:26)."
        ],
        "ja": [
          "成追線の非指定席列車は、台中～通霄2608次（成功11:39発）と通霄～豊原2615次（追分12:26発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-2534-route-time-scope",
      "fragments": {
        "zh-TW": [
          "海線順行自彰化至新竹 2534 次（彰化 12:49）、逆行自竹南至彰化 2527 次（竹南 12:30）恢復。"
        ],
        "en": [
          "Coast Line non-reserved services resume from Train 2534, Changhua–Hsinchu (Changhua departure 12:49), and Train 2527, Zhunan–Changhua (Zhunan departure 12:30)."
        ],
        "ja": [
          "海線の非指定席列車は、彰化～新竹2534次（彰化12:49発）と竹南～彰化2527次（竹南12:30発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-2527-route-time-scope",
      "fragments": {
        "zh-TW": [
          "海線順行自彰化至新竹 2534 次（彰化 12:49）、逆行自竹南至彰化 2527 次（竹南 12:30）恢復。"
        ],
        "en": [
          "Coast Line non-reserved services resume from Train 2534, Changhua–Hsinchu (Changhua departure 12:49), and Train 2527, Zhunan–Changhua (Zhunan departure 12:30)."
        ],
        "ja": [
          "海線の非指定席列車は、彰化～新竹2534次（彰化12:49発）と竹南～彰化2527次（竹南12:30発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-5216-route-time-scope",
      "fragments": {
        "zh-TW": [
          "東部對號順行自樹林至花蓮 5216 次（臺北 12:25）、樹林至臺東 426 次（臺北 12:40），逆行自花蓮至樹林 219 次（花蓮 12:14）恢復；"
        ],
        "en": [
          "Eastern Main Line reserved-seat services resume from Train 5216, Shulin–Hualien (Taipei departure 12:25), Train 426, Shulin–Taitung (Taipei departure 12:40), and Train 219, Hualien–Shulin (Hualien departure 12:14)."
        ],
        "ja": [
          "東部幹線の指定席列車は、樹林～花蓮5216次（台北12:25発）、樹林～台東426次（台北12:40発）、花蓮～樹林219次（花蓮12:14発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-426-route-time-scope",
      "fragments": {
        "zh-TW": [
          "東部對號順行自樹林至花蓮 5216 次（臺北 12:25）、樹林至臺東 426 次（臺北 12:40），逆行自花蓮至樹林 219 次（花蓮 12:14）恢復；"
        ],
        "en": [
          "Eastern Main Line reserved-seat services resume from Train 5216, Shulin–Hualien (Taipei departure 12:25), Train 426, Shulin–Taitung (Taipei departure 12:40), and Train 219, Hualien–Shulin (Hualien departure 12:14)."
        ],
        "ja": [
          "東部幹線の指定席列車は、樹林～花蓮5216次（台北12:25発）、樹林～台東426次（台北12:40発）、花蓮～樹林219次（花蓮12:14発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-219-route-time-scope",
      "fragments": {
        "zh-TW": [
          "東部對號順行自樹林至花蓮 5216 次（臺北 12:25）、樹林至臺東 426 次（臺北 12:40），逆行自花蓮至樹林 219 次（花蓮 12:14）恢復；"
        ],
        "en": [
          "Eastern Main Line reserved-seat services resume from Train 5216, Shulin–Hualien (Taipei departure 12:25), Train 426, Shulin–Taitung (Taipei departure 12:40), and Train 219, Hualien–Shulin (Hualien departure 12:14)."
        ],
        "ja": [
          "東部幹線の指定席列車は、樹林～花蓮5216次（台北12:25発）、樹林～台東426次（台北12:40発）、花蓮～樹林219次（花蓮12:14発）から再開します。"
        ]
      }
    },
    {
      "id": "new-train-5233-route-time-scope",
      "fragments": {
        "zh-TW": [
          "花蓮至樹林 5233 次、臺東至樹林 5249 次停駛，部分非對號仍截短或停駛。"
        ],
        "en": [
          "Trains 5233, Hualien–Shulin, and 5249, Taitung–Shulin, are cancelled because of rolling-stock arrangements; some non-reserved services remain shortened or cancelled."
        ],
        "ja": [
          "車両運用の影響で、花蓮～樹林5233次と台東～樹林5249次は運休。"
        ]
      }
    },
    {
      "id": "new-train-5249-route-time-scope",
      "fragments": {
        "zh-TW": [
          "花蓮至樹林 5233 次、臺東至樹林 5249 次停駛，部分非對號仍截短或停駛。"
        ],
        "en": [
          "Trains 5233, Hualien–Shulin, and 5249, Taitung–Shulin, are cancelled because of rolling-stock arrangements; some non-reserved services remain shortened or cancelled."
        ],
        "ja": [
          "車両運用の影響で、花蓮～樹林5233次と台東～樹林5249次は運休。"
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
          "Cross-line reserved-seat services have partial cancellations: Train 271, originally Hualien–Changhua, is cancelled between Hualien and Songshan and instead starts at Songshan (12:35; Taipei 12:45)."
        ],
        "ja": [
          "花蓮～彰化271次は花蓮～松山が運休となり、松山を始発（12:35発、台北12:45発）に変更。"
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
          "Train 277, originally Hualien–Dounan, is cancelled between Hualien and Qidu and instead starts at Qidu (17:09; Taipei 17:38)."
        ],
        "ja": [
          "花蓮～斗南277次は花蓮～七堵が運休となり、七堵を始発（17:09発、台北17:38発）に変更。"
        ]
      }
    },
    {
      "id": "new-train-281-route-time-scope",
      "fragments": {
        "zh-TW": [
          "花蓮至屏東 281 次的花蓮至七堵間停駛，改由七堵特開（七堵 19:01、臺北 19:30），不是整班取消。"
        ],
        "en": [
          "Train 281, originally Hualien–Pingtung, is cancelled between Hualien and Qidu and instead starts at Qidu (19:01; Taipei 19:30)."
        ],
        "ja": [
          "花蓮～屏東281次は花蓮～七堵が運休となり、七堵を始発（19:01発、台北19:30発）に変更します。"
        ]
      }
    },
    {
      "id": "morning-plan-including-cancelled-and-normal-exceptions",
      "fragments": {
        "zh-TW": [
          "10/24 12:00 前仍依先前分區方案：西部對號列車基隆至彰化停駛，彰化經高雄至枋寮正常；基隆至彰化間非對號列車原海線、成追線全區間停駛，其餘視風雨機動行駛，彰化至枋寮正常。但最新公告明列成追線臺中至通霄 2608 次由成功 11:39 開車，為先前中午前停駛方案的例外。東部樹林經宜蘭至花蓮對號及非對號列車停駛，花蓮至臺東正常；南迴線對號及非對號正常。472、102、280、270、207 次全區間停駛；101、191 次台中至潮州及 371 次台中至臺東全區間正常。上午六家、集集、沙崙正常，平溪、深澳、內灣全區間停駛；行經停駛區間的加班車全區間停駛。"
        ],
        "en": [
          "TRA's Oct 24 notice, published at 08:30, announces a gradual restoration of services after 12:00, with the specific trains and exceptions below; it does not mean that every train resumes at noon. Before 12:00, the earlier regional plan remains the reference, except for the explicitly announced Chengzhui Line Train 2608 restart at Chenggong at 11:39: western reserved-seat services are suspended between Keelung and Changhua, while Changhua–Kaohsiung–Fangliao operates normally. Between Keelung and Changhua, non-reserved services on the Coast and Chengzhui lines are suspended under that earlier plan; other routes operate subject to weather, and Changhua–Fangliao operates normally. Reserved and non-reserved services on Shulin–Yilan–Hualien are suspended, while Hualien–Taitung and the South-Link Line operate normally. The earlier notice lists Trains 472, 102, 280, 270 and 207 as suspended throughout, with Trains 101 and 191 on Taichung–Chaozhou and Train 371 on Taichung–Taitung operating throughout. Under the earlier before-noon plan, Liujia, Jiji and Shalun operate normally, while Pingxi, Shen-ao and Neiwan are suspended throughout. Extra trains passing through suspended sections are cancelled throughout under that plan."
        ],
        "ja": [
          "台鉄が10月24日08:30に発表した公告では、12:00以降、下記の列車から段階的に運転を再開します。正午に全列車が一斉に通常運転へ戻るという意味ではありません。12:00より前は先の区間別運転計画を参照してください。ただし、今回明示された成追線2608次の成功11:39発は例外です。先の計画では、西部の指定席列車は基隆～彰化が運休、彰化～高雄～枋寮は通常運転。基隆～彰化の非指定席列車は海線・成追線が全区間運休、その他は天候に応じて運転し、彰化～枋寮は通常運転です。樹林～宜蘭～花蓮は指定席・非指定席とも運休、花蓮～台東と南廻線は通常運転。472・102・280・270・207次は全区間運休、101・191次の台中～潮州と371次の台中～台東は全区間運転とされています。先の正午前の計画では、六家線・集集線・沙崙線は通常運転、平渓線・深澳線・内湾線は全区間運休です。運休区間を通る増発列車は、その計画では全区間運休です。"
        ]
      }
    },
    {
      "id": "early-1139-exception",
      "fragments": {
        "zh-TW": [
          "但最新公告明列成追線臺中至通霄 2608 次由成功 11:39 開車，為先前中午前停駛方案的例外。"
        ],
        "en": [
          "Before 12:00, the earlier regional plan remains the reference, except for the explicitly announced Chengzhui Line Train 2608 restart at Chenggong at 11:39: western reserved-seat services are suspended between Keelung and Changhua, while Changhua–Kaohsiung–Fangliao operates normally."
        ],
        "ja": [
          "ただし、今回明示された成追線2608次の成功11:39発は例外です。"
        ]
      }
    },
    {
      "id": "phased-not-all-at-noon",
      "fragments": {
        "zh-TW": [
          "台鐵 10/24 08:30 新公告公布 12:00 後陸續恢復方案，並非 12:00 整點所有列車已正常。"
        ],
        "en": [
          "TRA's Oct 24 notice, published at 08:30, announces a gradual restoration of services after 12:00, with the specific trains and exceptions below; it does not mean that every train resumes at noon."
        ],
        "ja": [
          "正午に全列車が一斉に通常運転へ戻るという意味ではありません。"
        ]
      }
    },
    {
      "id": "east-local-limits",
      "fragments": {
        "zh-TW": [
          "花蓮至樹林 5233 次、臺東至樹林 5249 次停駛，部分非對號仍截短或停駛。"
        ],
        "en": [
          "Trains 5233, Hualien–Shulin, and 5249, Taitung–Shulin, are cancelled because of rolling-stock arrangements; some non-reserved services remain shortened or cancelled."
        ],
        "ja": [
          "一部の非指定席列車は区間短縮または運休となります。"
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
      "id": "cross-partial-only",
      "fragments": {
        "zh-TW": [
          "花蓮至屏東 281 次的花蓮至七堵間停駛，改由七堵特開（七堵 19:01、臺北 19:30），不是整班取消。"
        ],
        "en": [
          "These are shortened services, not restorations of the cancelled sections."
        ],
        "ja": [
          "路線をまたぐ指定席列車には一部区間の運休があります。"
        ]
      }
    },
    {
      "id": "normal-branches",
      "fragments": {
        "zh-TW": [
          "六家、集集、沙崙正常；平溪、深澳、內灣須路線巡查完畢後恢復"
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
          "平溪、深澳、內灣須路線巡查完畢後恢復，未列明確時間。"
        ],
        "en": [
          "The Pingxi, Shen-ao and Neiwan lines will resume only after track inspections are complete; no resumption time is stated."
        ],
        "ja": [
          "平渓線・深澳線・内湾線は線路点検が完了してから運転を再開する予定で、再開時刻は明示されていません。"
        ]
      }
    },
    {
      "id": "tourist-blue-normal-others-all-day",
      "fragments": {
        "zh-TW": [
          "觀光列車除藍皮解憂號正常外，海風、山嵐、鳴日廚房及 1、2 次環島之星全日停駛；"
        ],
        "en": [
          "Breezy Blue operates normally; tourist services including Haifeng, Shanlan, Mingri Kitchen and Formosa Express Nos. 1 and 2 are suspended all day."
        ],
        "ja": [
          "観光列車は藍皮解憂号が通常運転する一方、海風・山嵐・鳴日厨房・環島之星1次と2次などは終日運休します。"
        ]
      }
    },
    {
      "id": "science-train-transfer-and-closing",
      "fragments": {
        "zh-TW": [
          "科普列車全日停駛並辦理迴送，閉幕活動取消。"
        ],
        "en": [
          "The Science Train is suspended all day and will be repositioned without passengers; its closing event is cancelled."
        ],
        "ja": [
          "科学普及列車は終日運休して回送を行い、閉幕行事も中止。"
        ]
      }
    },
    {
      "id": "remaining-local-limits-check-before-travel",
      "fragments": {
        "zh-TW": [
          "部分非對號仍可能截短或停駛，出發前須查官方班次。"
        ],
        "en": [
          "Some non-reserved services may still be shortened or cancelled; check TRA's latest information before departure."
        ],
        "ja": [
          "一部の非指定席列車には引き続き区間短縮や運休があるため、出発前に台鉄の最新情報を確認してください。"
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
    }
  ],
  "forbidden": {
    "zh-TW": [
      "10/24 12:00 後資訊預定於當日 08:00 公告，尚不能推定中午後恢復。"
    ],
    "en": [
      "resumption after noon is not yet confirmed."
    ],
    "ja": [
      "正午以降の再開は未確認です。"
    ]
  }
};

// Additive fact assertions only. Keep every existing version/window/CORS/
// uniqueness/mobile/real-touch/scroll/native/HTTP/source-link assertion.
const normalizeTRA = value => String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
const hasTRAToken = (text, token) => new RegExp('(?:^|[^0-9])' + token + '(?![0-9])').test(text);
function assertTRAUpdatedFacts(text, language, {context = 'TRA'} = {}) {
  if (TRA_UPDATED_FACTS.checks.length !== 30 || new Set(TRA_UPDATED_FACTS.checks.map(x => x.id)).size !== 30
      || TRA_UPDATED_FACTS.newPlanTrainNumbers.length !== 18 || new Set(TRA_UPDATED_FACTS.newPlanTrainNumbers).size !== 18
      || TRA_UPDATED_FACTS.newPlanDepartureTimes.length !== 16 || new Set(TRA_UPDATED_FACTS.newPlanDepartureTimes).size !== 16) {
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
  if (failed.length) {
    const error = new Error(context + ' [' + lang + '] TRA facts failed: ' + failed.map(x => x.id).join(', '));
    error.traFactFailures = failed;
    throw error;
  }
  return {language: lang, revision: TRA_UPDATED_FACTS.revision,
    factGroups: TRA_UPDATED_FACTS.checks.length, newPlanTrains: 18, newPlanDepartureTimes: 16,
    exactRouteTimeScopeBindings: true, morningAndEarlyExceptionVerified: true,
    previousDayExtrasExcluded: true};
}

const tra = source.systems.find(s => s.id === 'tra');
assert.equal(tra.sourceUrl, "https://www.railway.gov.tw/tra-tip-web/tip/tip009/tip911/newsDtl?newsNo=8ae4cac3a1650e3a01a16b5888661c31&page=0");
assert.equal(tra.sourceCheckedAt, '2026-10-24T08:45:33+08:00');
assert.match(tra.sourceLabel, /10\/24 08:30.*中午後陸續恢復/);
assert.equal(tra.additionalSources.length, 1);
assert.ok(tra.additionalSources[0].sourceUrl.includes('8ae4cac3a1650e3a01a16906f5681318'));
assert.match(tra.additionalSources[0].sourceLabel, /中午前.*2608 次 11:39 例外依最新稿/);
assert.match(tra.detail, /^10\/24 12:00 前仍依先前分區方案.*基隆至彰化停駛.*彰化經高雄至枋寮正常/);
assert.match(tra.detail, /但最新公告明列成追線臺中至通霄 2608 次由成功 11:39 開車.*中午前停駛方案的例外/);
assert.match(tra.detail, /472、102、280、270、207.*101、191.*371.*上午六家、集集、沙崙.*平溪、深澳、內灣/);
assert.match(tra.detail, /12:00 後陸續恢復方案.*並非 12:00 整點所有列車已正常/);
for (const lang of ['zh-TW','en','ja']) assertTRAUpdatedFacts(lang==='zh-TW' ? tra.detail : tra.detailI18n[lang],lang,{context:'官方原文獨立核對的台鐵完整方案'});
assert.doesNotMatch(tra.detailI18n.en, /free (?:ride|fare|of charge)/i);
const afr = source.systems.find(s => s.id === 'afr');
assert.equal(afr.sourceUrl, 'https://afrch.forest.gov.tw/AllNews/0079490');
assert.equal(afr.sourceCheckedAt, '2026-10-24T08:45:02+08:00');
assert.match(afr.detail, /^10\/24 本線嘉義至阿里山定期列車停駛.*阿里山國家森林遊樂區.*尚未取得明確開行時間/);
assert.match(afr.detail, /本輪 10\/24 08:45 成功核讀 10\/22 19:00 更新原文.*較早 13:30 原文不能覆蓋 19:00 更新/);
assert.match(afr.detail, /文化|檜意森活村/);
assert.match(afr.detailI18n.en, /On Oct 24.*mainline.*suspended.*no definite departure time.*successfully read at 08:45 on Oct 24.*earlier 13:30 text does not supersede the 19:00 update/);
assert.match(afr.detailI18n.ja, /10月24日.*本線定期列車が運休.*具体的な発車時刻は未確認/);
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
assert.equal(trtc.sourceUrl, 'https://www.metro.taipei/News_Content.aspx?n=30CCEFD2A45592BF&sms=72544237BBE4C5F6&s=1E432CD2383523BA');
assert.equal(trtc.additionalSources.length, 2);
assert.ok(trtc.additionalSources[0].sourceUrl.includes('D24768D861F3702F'));
assert.ok(trtc.additionalSources[1].sourceUrl.includes('649A1A69E7BC170D'));
for (const old of trtc.additionalSources) assert.match(old.sourceLabel, /僅供歷史參考/);
assert.match(trtc.sourceLabel, /06:00.*04:32 資料更新/);
assert.match(trtc.detail, /^北捷 10\/24.*各路線正常營運.*文湖線、淡水信義線、松山新店線、板南線及中和新蘆線班距約 12 分鐘.*南勢角至大橋頭.*約 6 分鐘/);
assert.match(trtc.detail, /平面、高架路段.*瞬間風速達 10 級以上.*10 分鐘內平均風速達 7 級.*暫停營運.*地下段維持運轉/);
assert.match(trtc.detail, /06:00.*不是明示的首班或復駛起始時刻.*未逐段列出復駛時間.*不能據此認定查核當下已開行/);
assert.match(trtc.detail, /先前部分首班待通知及 10\/23 停駛稿僅保留為歷史參考/);
assert.doesNotMatch(trtc.status, /待通知|已復駛|06:00 起/);
assert.match(trtc.detailI18n.en, /Oct 24.*normal operation on all routes.*Wenhu, Tamsui-Xinyi, Songshan-Xindian, Bannan and Zhonghe-Xinlu.*12-minute.*6 minutes.*Nanshijiao.*Daqiaotou/);
assert.match(trtc.detailI18n.en, /gusts reach force 10 or above.*10-minute average reaches force 7.*not an explicitly stated first-service or resumption start time.*Do not infer that services were already running at the check time/);
assert.match(trtc.detailI18n.ja, /10月24日.*各路線の通常運転.*文湖線・淡水信義線・松山新店線・板南線・中和新蘆線.*約12分間隔.*約6分間隔/);
assert.match(trtc.detailI18n.ja, /10級以上.*10分間平均が7級.*始発や運転再開の開始時刻を明示したものではなく.*確認時点ですでに運転中とは判断していません/);
const tymc = source.systems.find(s => s.id === 'tymc');
assert.equal(tymc.sourceUrl, 'https://www.tymetro.com.tw/tymetro-new/tw/_pages/news/show-2439-1.html');
assert.equal(tymc.additionalSources.length, 1);
assert.ok(tymc.additionalSources[0].sourceUrl.includes('general/show-22-1'));
assert.match(tymc.detail, /^10\/24 全天取消直達車及加班車.*普通車維持 15 分鐘.*A1.*A3.*全天暫停/);
assert.match(tymc.detail, /10\/23 21:55:16 強風慢速稿.*未列今日新班距、特定區段或恢復正常速度時間/);
assert.match(tymc.detail, /本輪原連結轉至首頁，無法讀到該原文.*不能因轉址推定已恢復/);
assert.match(tymc.detailI18n.en, /original link now redirects to the homepage.*redirect does not establish recovery/);
assert.match(tymc.detailI18n.en, /On Oct 24.*all express and extra services are cancelled.*15 minutes.*does not guarantee normal speed today/);
assert.match(tymc.detailI18n.ja, /10月24日.*直達車と増発列車が終日運休.*15分間隔.*通常速度を保証するものではありません/);
const ntmetro = source.systems.find(s => s.id === 'ntmetro');
assert.equal(ntmetro.sourceUrl, 'https://www.ntmetro.com.tw/');
assert.equal(ntmetro.sourceCheckedAt, '2026-10-24T08:44:57+08:00');
assert.equal(ntmetro.additionalSources.length, 2);
assert.equal(ntmetro.additionalSources[0].sourceUrl, 'https://www.ntmetro.com.tw/basic/?mode=detail&node=914');
assert.match(ntmetro.additionalSources[0].sourceLabel, /歷史依據/);
assert.equal(ntmetro.additionalSources[1].sourceUrl, 'https://www.facebook.com/NewTaipeiMetro/');
assert.match(ntmetro.status, /三線維持停駛.*環狀約 15 分鐘/);
assert.match(ntmetro.detail, /10\/24 本輪核對.*首頁最新跑馬.*三鶯線、安坑輕軌及淡海輕軌維持停駛.*環狀線班距約 15 分鐘/);
assert.match(ntmetro.detail, /新版短訊本身未列日期、精確發布時刻、停駛起始或復駛時間.*不能把核讀時刻當成停駛起點/);
assert.match(ntmetro.detail, /先前首頁明列 10\/24.*約 15 分鐘.*依運量及風速調整.*最新短訊未重列調整條件/);
assert.match(ntmetro.detail, /10\/23 15:00 起三線預防性停駛.*歷史依據.*軌道、供電與沿線安全巡檢/);
assert.match(ntmetro.detail, /不能把昨日停駛前淡海、安坑每 30 分鐘及三鶯每 15 分鐘班距當成今日方案.*不能因首頁一般燈號或舊公告消失推定三線已復駛/);
assert.match(ntmetro.detailI18n.en, /In this Oct 24 check.*latest official homepage.*Sanying Line, Ankeng LRT and Danhai LRT remain suspended.*15 minutes/);
assert.match(ntmetro.detailI18n.en, /new short notice itself gives no date, exact publication time, suspension start time or resumption time.*check time is not a suspension start time/);
assert.match(ntmetro.detailI18n.en, /earlier homepage plan explicitly dated Oct 24.*demand and wind.*latest short notice does not repeat/);
assert.match(ntmetro.detailI18n.ja, /10月24日の今回の確認.*最新スクロール案内.*三鶯線・安坑ライトレール・淡海ライトレールは運休継続、環状線は約15分間隔/);
assert.match(ntmetro.detailI18n.ja, /短文自体には日付、正確な発表時刻、運休開始時刻、再開時刻は記載されておらず.*確認時刻を運休開始時刻とはしていません/);
assert.doesNotMatch(ntmetro.status, /待確認|06:00.*起|三線.*已復駛/);
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
          assert.equal(await page.locator('section[aria-labelledby="tra"] a').count(), 2, '中午後新方案與中午前限時參考來源均可查閱');
          assert.equal(await page.locator('section[aria-labelledby="tymc"] a').count(), 2, '今日模式與歷史慢速來源可查閱');
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
              en: 'Typhoon Champi · Oct 24: TRA services resume in stages after noon; three New Taipei Metro lines remain suspended',
              ja: '台風情報｜10/24 台湾鉄道は正午以降順次再開・新北MRTの3路線は運休継続',
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
        assert.ok(text.includes(thsr.detail), '舊網頁完整保留今日高鐵方案與昨日取消的日期區別');
        assert.ok(text.includes(trtc.detail), '舊網頁完整保留今日北捷五線方案與時刻限制');
        assert.match(text,/三鶯線、安坑輕軌及淡海輕軌維持停駛.*環狀線班距約 15 分鐘/);
        assert.match(text,/新版短訊本身未列日期、精確發布時刻、停駛起始或復駛時間/);
        assert.match(text,/三線須待風雨趨緩，並完成軌道、供電與沿線安全巡檢確認後才能恢復/);
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
        assert.ok(text.includes(thsr.detail), '已發行App須顯示今日高鐵正常營運與日期區別');
        assert.ok(text.includes(trtc.detail), '已發行App保留今日北捷五線方案與時刻限制');
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
