# 路段懸賞 v2 整併交接（本機分支 `bounty/v2-merge`）

> 寫於 2026-10-25。這份給「沒看過實作、要複審上線計畫」的人讀：照第 5 節逐步做得完，每一步的風險與退路都寫在該步。
> 本線**沒有** push 任何分支、沒有部署、沒有碰正式 D1、沒有進 Cloudflare 後台。第 5 節每一個 `--remote`、部署、設變數都是對外動作，逐項等 go。

## 0. 結論

- 整併完成：`8ef76a8a`＝`origin/main` `ef09beef` ＋ `origin/fix/bounty-gate-env-flakes` `7a28cd16`（v2＝`origin/feat/bounty-chips-v2` `428e30c2` 再加兩顆總閘門修正）。只在本機。
- 懸賞總閘門：整併當下 18 支套件 16 支綠、2 支各紅 1 條，兩條都**不是整併造成的**（第 3.2 節）。主線依規則定了處理方式，已各修一顆 commit（`21400e80`、`74c78869`），修完重跑結果見第 3.1 節。
- main 原有的 worker 相關檢查 40 支：沒有一支被整併弄紅（第 3.3 節）。
- 用 `wrangler dev --local` 起整併版，照 10-24 真機請求的形狀打 21 發（看板 → 接卡 → 上傳 → me → chips-me → 雲端搭乘 → 兌換 ＋ 錯誤路徑），21/21 符合 App 的預期（第 3.6 節）。
- App 契約（原生 origin/main `83a195b69`）：七個端點的請求欄位、回應欄位、錯誤碼都對得上；沒有會讓 App 壞掉的不一致，差異列在第 4 節。
- 正式庫現在到底套了哪幾支遷移，沒有人實查過（文件說法互相矛盾）。上線第一步是唯讀查（第 5.2 節）。

## 1. 分支與 commit

| 項目 | 值 |
|---|---|
| 樹 | `.claude/worktrees/magical-wilson-2c343d` |
| 分支 | `bounty/v2-merge`（本機，**未 push**） |
| 合併 commit | `8ef76a8a`，parents `ef09beef`（origin/main）、`7a28cd16`（v2） |
| 判準修正 | `21400e80`（valuation F1 參考值）、`74c78869`（hardening PLb 一句只比排序後的行） |
| 交接檔 commit | `4c8b9d0c` 初版；之後的更新看 `git log -- docs/bounty-v2-merge-handoff.md` |
| 合併基準 | `cbe6e603`（09-28） |

每個衝突怎麼解，逐條寫在合併 commit 的訊息裡：`git show -s --format=%B 8ef76a8a`。摘要：

- `worker.js`：`API_POST_ALLOWED` 取聯集；`bountySubmit` 結尾、`bountyVerifyCron` 判定迴圈取 v2 的程式，註解用 main 改過的句子（main 在這兩段只改了註解）。
- main 在 07-29 的三顆懸賞修正 `5efc5803`、`a5a3f0bf`、`40163d86` 都在合併基準之前，兩邊都有，原樣保留。
- `wrangler.jsonc` 沒有衝突、沒有改：crons 仍是 `["* * * * *", "15 1 * * *"]`（v2 的判定 cron 要另外加，見第 5.4 節）。
- `schema/`：v2 的 `0014_bounty_v2`／`0015_bounty_retired`／`0016_bounty_kept_range` 跟 main 的 `0014_trackside`／`0015_rail_ai_status`／`0016_rail_push` 同號。**不改號**：兩組碰的表不重疊、沒有 migration 追蹤表、所有套用與檢查工具都是讀目錄後照檔名排序；`verify_bounty_schema` 有十幾條斷言綁 v2 的檔名。`schema/README.md` 已補一段說明。
- 產生物重產：`data/bounty_units.json`（班表日 2026-10-25、計價單位 3533＝軌道 1810＋停站 1723、29 條線、台鐵尖峰 [6,7,8,17,18,19]），`data/data_manifest.json`、`data/data_provenance.json`。

## 2. 重現環境

- 全部指令在本樹根目錄跑。wrangler 一律 `arch -arm64 node ./node_modules/wrangler/bin/wrangler.js`（這台的 `npx wrangler` 會被 Rosetta 拉成 x64）。
- 系統 node `v24.22.1`（內建 SQLite 3.53.4），10-23 前後裝的；v2 開發時是 SQLite 3.51.2（`scripts/verify_bounty_hardening.mjs:1987` 的註解）。這個差別就是第 3.2 節 PLb 的根因。
- 對照用的 portable node `v24.14.1`（內建 SQLite 3.51.2，Node 官方 changelog：3.51.2 從 24.13.1 進來、24.15.0 換成 3.52.0）放在本樹的 `tmp/portable-node/`（`.gitignore:106` 忽略的路徑，沒有全域安裝、沒有換系統 node）。來源 `https://nodejs.org/dist/v24.14.1/node-v24.14.1-darwin-arm64.tar.gz`，SHA256 `25495ff8…cb1fe` 對過官方 `SHASUMS256.txt`。用法：`PATH=$PWD/tmp/portable-node/node-v24.14.1-darwin-arm64/bin:$PATH node scripts/verify_bounty_hardening.mjs`。
- 驗收紀錄、實打腳本、模擬腳本的副本在主線共用筆記資料夾的 `bounty-v2-merge/`（`side-session-notes/local_aa7e619a-…/bounty-v2-merge/`）：`verify_bounty_all_merged.log`、`v2_alone_hardening.log`、`worker_checks_{merged,main}.tsv`、`e2e.mjs`、`e2e_result.json`、`guard_sim.mjs`、`segkeys.mjs`。

## 3. 驗收

### 3.1 懸賞總閘門

指令：`node scripts/verify_bounty_all.mjs`（ship-web 第 615 行跑的同一支）。

**修正後（`74c78869`，系統 node 24.22.1）：rc=0，18 支全綠，共 1880 條判準**（hardening 183/183、valuation 88/88，其餘 16 支數字與下表相同）。

整併當下（`8ef76a8a`）的結果 rc=1：

| 套件 | 結果 | 套件 | 結果 |
|---|---|---|---|
| selftest | 19/19 | ledger | 71/71 |
| **hardening** | **182/183（PLb）** | chips | 40/40 |
| schema | 47/47 | rules | 16/16 |
| **valuation** | **87/88（F1）** | redeem | 91/91 |
| gates | 75/75 | cloud | 124/124 |
| dwell | 16/16 | merge | 58/58 |
| api | 105/105 | cron | 70/70 |
| auth | 89/89 | cron2 | 131/131 |
| merge_web | 27/27 | recorder_web | 8/8 |
| chips_web | 641/641 | | |

### 3.2 兩條紅的根因（都沒改期望值）

**valuation F1：判準過期，不是回歸。**

- F1 從三個軌道檔重算「真實區間鍵」的數量，跟寫死的 275（台鐵 244／高鐵 11／林鐵 20）比。整併版算出 276（台鐵 245）。
- 根因：main 的 `9310ed8c`（10-02，平鎮臨時站 10/3 啟用）在 `data/tra.json` 加了平鎮站，縱貫線北段的 `中壢|埔心` 拆成 `中壢|平鎮`＋`埔心|平鎮`。v2 的基準在這之前。
- 證據：`segkeys.mjs` 對 v2 原樣樹 244 鍵、對 main 與整併版都是 245 鍵，`diff` 只差這三行。v2 原樣樹跑 valuation 88/88。
- F 組其餘斷言（每個單位的 seg_key 都落在真實鍵空間裡）全過，所以新的單位檔沒有壞鍵。
- 處理（主線依規則定：判準過期、根因已證實）：`21400e80` 把參考值改成 276／245，訊息寫明平鎮臨時站。改後 valuation 88/88。

**hardening PLb：v2 原樣就紅，根因是 SQLite 版本換了（已實證）。**

- PLb 要求碰六張懸賞表的 61 句，在 8 種 ANALYZE 統計形狀下的查詢計畫跟「沒有統計」時逐行相同。
- 紅的只有一句：`bountyMerge` 搬車庫解鎖的 `INSERT OR IGNORE INTO chip_ledger … SELECT … FROM garage_unlocks d … EXISTS (bounty_points …)`，在 one／tiny3／cheap 三種形狀下，計畫的三行**順序**變了（`EXISTS` 那行從第一行移到最後一行）。用的索引完全一樣，沒有全表掃描（`scans: []`）。
- v2 原樣樹（`7a28cd16`）在這台跑出同一個 182/183、同一句。所以跟整併無關。
- 根因：v2 是在 SQLite 3.51.2 下寫、下綠的，這台的 node 10-23 前後換成內建 3.53.4 的版本，兩版對這個相關子查詢的 EXPLAIN 列印順序不同。
- 實證：同一棵樹（整併版）用 portable node 24.14.1（SQLite 3.51.2）跑 hardening → 183/183，PLb 綠；系統 node 24.22.1（3.53.4）→ 182/183，只紅這一句。
- 處理（主線依規則定）：`74c78869` 新增 `PL_ORDER_FREE`（`scripts/verify_bounty_hardening.mjs`，`PL_CTRL` 之後），清單裡只有這一句。它比「排序後逐行相同」，而且每一種統計形狀下都要沒有全表掃描；比對式要恰好攔到一句，否則 PLb 紅。其他 60 句照舊逐行比。
  - 改後：3.51.2 → 183/183；3.53.4 → 183/183。
  - 對照（判準還有牙）：在暫用樹拿掉 `u` 的 `INDEXED BY`，用 3.53.4 跑 → PLb 紅，one／cheap 出現 `SCAN u`、tiny3 是 `SCAN u` 在外層（同時 PLc、PLc2 也紅）。
- 正式 D1 用的是 Cloudflare 自己的 SQLite，版本跟這兩個都不一定相同。這條判準要守的是「統計怎麼偏都不會變成全表掃描」，放寬的只有一句的行序。

### 3.3 main 原有的 worker 相關檢查（確認沒弄紅別的功能）

清單 40 支（`worker_checks_merged.tsv`／`worker_checks_main.tsv`，同一支腳本對整併樹與 `ef09beef` 各跑一次，每支 8 分鐘上限）：

- **30 支綠**，兩邊相同。
- **4 支缺環境中止**（rc=2，兩邊相同）：`verify_trackside_push`、`verify_la_push_loop` 要 `LA_WT` 乾淨副本；`verify_metro_wait_push`、`verify_tra_wait_push` 要 `.dev.vars` 的 `APNS_KEY_P8`。v2 沒改這四個功能的函式，只在 `scheduled()` 加了 `BOUNTY_CRON` 分支（`worker.js:10318`，在每分鐘分支之後、每日 ingest 之前，跑完就 return）。
- **6 支在 main 一樣紅、失敗的行相同**：`verify_hidden`（缺 5178 的伺服器）、`verify_binder_identity`、`verify_plus_data_claims`、`verify_plus_redirect_policy`（同樣 7 個 fetch 呼叫點，行號只位移 1）、`verify_trtc_official_worker`（17 項）、`verify_usage_split`（2 項）。
- `verify_hidden` 對整併樹起一個靜態伺服器重跑：17/17（懸賞入口預設仍藏著）。

### 3.4 其他

| 指令 | 結果 |
|---|---|
| `node scripts/check_deploy_config.mjs` | 通過（2 條 cron） |
| `node scripts/verify_data_manifest.mjs`、`verify_data_provenance.mjs` | 通過 |
| `node scripts/verify_public_repo_hygiene.mjs` | ALL PASS（最終狀態 0、歷史 0） |
| `node scripts/check_i18n.mjs` ＋ 重複鍵比對 | 通過；合併後沒有新增「同鍵不同譯」 |
| `node --check worker.js` | 通過 |

### 3.5 根目錄 `verify_bounty.mjs`（舊的 v1 前端驗收）

整併版 13 FAIL／28 ok；v2 原樣 17 FAIL；main 原樣 1 FAIL（R1）。整併版的紅全部是 v2 原樣的紅的子集，兩邊在同一處崩潰（`page.evaluate` TypeError）。根因是 v2 改了前端行為（現行 App 殼要更新才能錄程、點數改成籌碼），這支 v1 驗收沒跟著改。出貨鏈不跑它（ship-web 只跑 `verify_bounty_all`）。沒改它，建議另開一顆把它退役或改寫。

### 3.6 `wrangler dev --local` 實打

做法（不碰正式庫）：

1. `git worktree add --detach <暫存>/vtree HEAD`，`ln -sn` 本樹的 `node_modules`。
2. 照檔名排序逐支 `d1 execute DELAY_DB --local --persist-to <暫存>/wdev-state --file=schema/<檔>`。0004–0006 報 `duplicate column`（0001 已含那幾欄），與 `scripts/d1_local.mjs` 的行為相同，其餘都 ok。
3. `wrangler dev --local --local-protocol https --port 47631 --inspector-port 47632 --persist-to <暫存>/wdev-state --test-scheduled`。
4. 打 `/__scheduled?cron=30+19+*+*+*`：log 印 `[cron bounty 估值] 新上架 3533, 退場 0` 與 `[cron bounty 驗證] 0 班…子請求 101`；看板 267 張卡、`valuationOk` 有值、`retireBlock` null。
   - 坑：本機 `caches.default` 不遵守 `s-maxage`，估值前打過一次看板，之後就一直回空板。停掉 wrangler、清 `wdev-state/v3/cache`、重起才讀到新板。
5. `NODE_TLS_REJECT_UNAUTHORIZED=0 node e2e.mjs https://localhost:47631 e2e_result.json`：**21/21 符合預期**。

| # | 請求（形狀照 10-24 A54／iPhone 的實際請求） | 狀態 | 回應重點 |
|---|---|---|---|
| 1 | GET bounty-board | 200 | 267 張卡，含 `tra_sched\|南迴線\|1\|區間車\|track\|` |
| 2 | POST bounty-claim `{actor, cardId}` | 200 | `ok, claimId, units, pointsLocked, expiresAt, claimers` |
| 3 | 同卡重接 | 200 | 新的 claimId |
| 4 | claim 壞 cardId | 400 | `bad_card` |
| 5 | POST bounty-submit（13 點、`client`、`requestId`、`batch`） | 200 | `ok, id=rq.<actor>.<requestId>, verdict:pending, accepted:13, dropped:0` |
| 6 | 同 requestId 重送 | 200 | 同一個 id（去重） |
| 7 | 不帶 client | 400 | `app_only` |
| 8 | 不存在的線 | 400 | `unknown_line` |
| 9 | 乘車日超出窗 | 400 | `bad_date` |
| 10 | GET bounty-me?actor= | 200 | `actor, points, corrected, dwellStops, lines, firsts, trips` |
| 11 | GET chips-me?actor=（搭乘前） | 200 | `{balance:0, unlocked:[], nextCost:4, cloud:{rides:0,toNextChip:3}, today:{chips:0,cap:4}}` |
| 12 | POST cloud-ride 捷運 `mrt\|BR\|101`、700 秒 | 200 | `{ok, day, rides:1, toNextChip:2, chipAwarded:false}` |
| 13 | 同 requestId 重送 | 200 | rides 仍 1 |
| 14 | 同日第二趟 | 409 | `already_today` |
| 15 | 另一人 cloud-ride 台鐵 `tra_sched\|371` | 200 | 371 今天有開、時間在窗內 |
| 16 | sec 100（< minSec 600） | 400 | `too_short` |
| 17 | chips-me（搭乘後） | 200 | `cloud.rides:1, toNextChip:2` |
| 18 | POST garage-redeem `{actor, scene:south-coast, requestId}` 餘額 0 | 409 | `{error:not_enough, cost:4, balance:0}` |
| 19 | garage-redeem 不存在的場景 | 400 | `unknown_scene` |
| 20 | POST bounty-merge 不帶 Bearer | 401 | `unauthorized` |
| 21 | chips-me 壞 actor | 400 | `bad_actor` |

沒打到的：判定 cron 對真錄程的判決（今天的趟次要等營運日結束才判）、帶 Bearer 的路徑（本機沒有可用的 Firebase token）、BOUNTY_LIMITER 的實際限流（本機模擬）。這三塊由總閘門的 cron／cron2／auth／api 套件離線蓋到。

## 4. App 契約對照（以原生 origin/main `83a195b69` 為準）

參考：`scripts/bounty-ui-and-fake.py`（Android 假站）、`ios/scripts/bounty-ui-ios-server.py`（iOS 假站）、`fixtures.json`、`BountyClaim.kt`、`BountySubmitRequest.kt`／`BountySubmitQueue`、`BountyCloudPorts.kt`、`WalletController.kt`／`WalletJson.kt`，與 10-24 兩台真機的請求紀錄。

| 端點 | App 送什麼 | 整併版伺服器 | 判定 |
|---|---|---|---|
| GET `/api/bounty-board` | 無參數 | `{at, coverN, cards[], retireBlock, valuationOk}`；卡片欄位 `id sys lnId dir trainKind kind slot unitKeys units points samples claimers coverN need distinctOk covered` | 一致；`retireBlock`、`valuationOk` 是多的，App 不讀 |
| POST `/api/bounty-claim` | `{actor, cardId}`，不帶 Bearer | 回 `{ok, claimId, units, pointsLocked, expiresAt, claimers}`；錯誤 `no_open_units` 404、`rate_limited` 429、`bounty_paused`／`claim_failed` 503、`bad_actor`／`bad_card`／`bad_json` 400、`unauthorized`／`auth_required` 401、`wrong_account` 403 | 一致（fixtures.json 的錯誤碼表逐項對得上）；`claimers` App 不讀 |
| POST `/api/bounty-submit` | `{actor, sys, lnId, trainNo, tripDate, dir, batch, samples[{d,t,v,acc}], client{platform,app,simulator}, requestId}` | 回 `{ok, id, verdict, accepted, dropped}`；`batch` 伺服器不讀 | 一致。App 的處理：200 送達；401 等登入；403 `wrong_account` 換 ID；其他 4xx（429 除外）終止；其餘重試 |
| GET `/api/bounty-me` | Bearer 或 `?actor=installId` | `{actor, points, corrected, dwellStops, lines, firsts, trips}` | 一致 |
| GET `/api/chips-me` | `?actor=installId`，不帶 Bearer | `{balance, unlocked[{scene,nth,at}], nextCost, cloud{rides,toNextChip}, today{chips,cap}}`；`BOUNTY_WRITES=off` 不擋 | 一致 |
| POST `/api/cloud-ride` | `{actor, day, trainKey, startedAt, sec, requestId, client}`，不帶 Bearer | 回 `{ok, day, rides, toNextChip, chipAwarded}`；錯誤 405／400（`bad_day bad_time bad_sec too_short unknown_train`…）／409（`conflict already_today`）／503（`cloud_ride_failed not_ready bounty_paused`） | 一致；捷運系統清單 App＝伺服器 `CLOUD_RIDE_METRO_SYS` |
| POST `/api/garage-redeem` | `{actor, scene, requestId}`，有 Bearer 才帶 | 回 `{ok, scene, nth, cost, balance, unlocked}`；`not_enough` 409 帶 `cost`／`balance` | 一致 |
| POST `/api/bounty-merge` | **App origin/main 沒有呼叫點**（只有註解說要處理 409 `merged_elsewhere`、403 `wrong_account`） | 要 Bearer；錯誤 `not_a_device`／`bad_json`／`bad_actor` 400、`unauthorized` 401、`merged_elsewhere` 409、`rate_limited` 429、`merge_failed` 503 | App 端還沒接，不算不一致 |

假站與真伺服器的差別（App 在假站上測不到、真伺服器會回的）：

1. 假站不驗 `unknown_line`、`unknown_train`、乘車日窗、`daily_quota`。真伺服器的 `daily_quota` 是 429（每人每個乘車日 720 批）；App 把 429 當可重試、等回前景再送，同一個乘車日超量後重送永遠不會成功，只會每次回前景多打一發。影響小，記著。
2. `toNextChip`：iOS 假站寫死 `3 − rides % 3`；真伺服器是 `perChip − rides % perChip`，`perChip` 讀 `data/bounty_rules.json` 的 `chips.cloud.perChip`（現在是 3，所以值相同）。
3. 假站 `nextCost` 是 8，真伺服器現在是 4。App 照伺服器值顯示，不寫死。
4. 真伺服器的 cloud-ride 會驗那班車那天有沒有開、開始時間在不在班次窗內（台鐵讀 `tra_widget_schedule.json` 的 `dates[day]`），假站不驗。

身分的一條注意：App 的 claim／submit／cloud-ride／chips-me 都只帶匿名 installId。如果某個 installId 已經被併進帳號，`'wallet'` 模式的端點（chips-me `?actor=`、cloud-ride、garage-redeem、bounty-me `?actor=`）會回 401 `auth_required`，App 停在等登入。現在 App 不呼叫 merge，碰不到這條；App 接上 merge 那天要一起測。

## 5. 上線計畫（**不執行**，每一步等 go）

依據：本節是把 v2 計畫書 §9、§12.1（主工作樹 `docs/superpowers/plans/2026-09-29-路段懸賞與籌碼.md`，未進版控，§12.1 在第 930 行起）對到這次整併的現況。兩邊有出入時以本節為準，出入處有標。

### 5.0 順序總覽

| 步驟 | 動作 | 寫正式環境？ | 可回頭？ |
|---|---|---|---|
| A | 出貨前的本機準備（5.1；擋 ship-web 的兩條紅已修） | 否（本機 commit） | 是 |
| B | push 分支／併 main | 是（公開 repo） | 難 |
| C | 唯讀查正式庫 schema、看板、B6 髒列、Worker 變數名單 | 只讀 | — |
| D | 照 C 的結果補套 0014 → 0015 → 0016（懸賞三支） | 是 | 欄位與表只加不刪，見 5.2 |
| E | 先設 `BOUNTY_WRITES=off`，再 ship-web 出 Worker | 是 | 回滾 Worker，見 5.3 |
| F | cron 加 `30 19 * * *`（含 `check_deploy_config` 一起改），`triggers deploy` | 是 | 拿掉那條再 `triggers deploy` |
| G | 上線後唯讀巡檢 | 只讀 | — |
| H | 開放：`BOUNTY_CLAIMABLE_FROM`、`BOUNTY_WRITES` 開、網頁 `BOUNTY_ENABLED` 預設開 | 是 | 設回 off |

D 一定早於 E：v2 的 Worker 遇到沒套 0014 的庫，`/api/account-delete` 會對**所有人**回 502（`bountyPurgeUid` 同一個 batch 刪四張新表），看板整個 503（`schema/0014_bounty_v2.sql` 檔頭第 3–13 行）。ship-web 2.4 的守門人會擋，但不要靠它。

### 5.1 出貨前要先處理（步驟 A）

1. ~~valuation F1~~：已修（`21400e80`）。
2. ~~hardening PLb~~：已修（`74c78869`）。修完總閘門 18/18（3.1）。
3. **`bounty_units.json` 出貨當天重產**：`npm run build-bounty-units`，有差異就 commit。這次重產是 10-25 的班表；ship-web 的資料閘不會擋舊的單位檔（R11 只守站表、R13 只守算法），而台鐵班表每週重抓、尖峰小時可能跟著換。
4. 視需要：根目錄 `verify_bounty.mjs` 退役或改寫（3.5）。不擋出貨。
5. 註解衛生：v2 新增行裡沒有引用使用者原話（`原話`／`裁示` 0 筆、`verify_public_repo_hygiene` ALL PASS）。main 10-18 做過「註解只留做法與理由」的清理，v2 的註解還有 `brief §…` 之類指向其他文件的代號，要不要比照清理由主線決定，不擋出貨。
6. 這份交接檔本身要不要進公開 repo，push 前由主線決定（裡面有本機路徑）。

### 5.2 正式 D1（步驟 C、D）

**C. 先唯讀查**（查正式庫也是對外動作，照樣等 go）：

```bash
node scripts/verify_remote_schema.mjs
```

它只跑一句 `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index')`（`scripts/verify_remote_schema.mjs:142`），比對每支 `schema/*.sql` 的表、欄、`INDEXED BY` 指名的索引，缺什麼就印出要補套哪一支、或哪一句 `CREATE INDEX`。這就是 ship-web 2.4 跑的那支。

為什麼一定要先查：`schema/README.md` 第 86 行的寫法暗示 0014 可能已經套過正式庫（「若正式庫在 idx… 加進 0014 之前就套過它」），v2 計畫書 §12.1 卻是「依序套」。哪個對，沒人實查過。

同時唯讀查三件事：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --json --command "SELECT sys, kind, COUNT(*) n FROM bounty_board GROUP BY 1,2"
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --json --command "SELECT actor, uid, merged_into FROM bounty_points WHERE uid IS NOT NULL AND merged_into IS NOT NULL"
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js secret list
```

- 第一句：看板上現有幾列（判斷退場守門，見 5.6）。
- 第二句：B6 髒列。有列就先修資料再開寫入（計畫書 §12.1 第 4 項）。
- 第三句：只列名字，看 `BOUNTY_WRITES` 等變數現在有沒有設（見 5.5）。

**main 那三支同號遷移不是本線的**：`0014_trackside`（10-20 進 main）、`0015_rail_ai_status`（10-24）、`0016_rail_push`（10-25 00:13，在 v1024l 出貨之後）。ship-web 2.4 會比對**全部** `schema/*.sql`，其中任何一支沒套，出懸賞這一版也會被擋。照 `verify_remote_schema` 的輸出跟那兩條線（軌道邊卡片、AI 營運整理）確認後再套，不要順手代套。

**D. 補套**（只套 C 說缺的；懸賞三支彼此照順序）：

```bash
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0014_bounty_v2.sql
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0015_bounty_retired.sql
arch -arm64 node ./node_modules/wrangler/bin/wrangler.js d1 execute DELAY_DB --remote --file=schema/0016_bounty_kept_range.sql
```

- 已套過 0014、只缺索引：照守門人印的那一句 `--command "CREATE INDEX IF NOT EXISTS …"` 補，**不要重套整支 0014**（檔尾兩句 ALTER 會中斷，前面的 CREATE 會不會跟著回滾沒驗過）。
- 0015、0016 只有 `ALTER TABLE … ADD COLUMN`，重跑報 `duplicate column name` 代表已套過，無害。
- 缺主鍵自動索引：要重建整張表，先停手問。
- 套完重跑一次 `node scripts/verify_remote_schema.mjs`，要綠。

**會不會動到既有資料**：不會改寫既有列。0014 是 `CREATE TABLE/INDEX IF NOT EXISTS` 六張表的建表，加上檔尾兩句 `ALTER TABLE ADD COLUMN`（`bounty_board.distinct_ok_users`、`bounty_samples.client`）；0015 是 `bounty_board.retired`、0016 是 `bounty_samples.kept_d0／kept_d1`，都是 ADD COLUMN（帶預設值或可 NULL）。既有列的既有欄位不變。

**退路**：

- 現行正式 Worker（main v1）不讀新表新欄，套了 schema 而 Worker 還沒換，對現在的功能無害。所以 D 做完、E 出問題時，Worker 留在舊版就好，schema 不必拆。
- 不建議拿 D1 Time Travel 還原當退路：還原會把那個時間點之後**所有**寫入一起丟掉（誤點履歷 ingest、推播綁定、北捷之外的每一張表），代價遠大於留著幾張空表。真的要用，先 `d1 time-travel info DELAY_DB` 記下套用前的 bookmark（這台沒實測過這個指令）。

### 5.3 部署（步驟 E）

```bash
npm run ship-web
```

- ship-web 會從乾淨 worktree 出貨，依序跑：正式庫 schema（2.4，第 127 行）、部署設定（第 192 行）、懸賞總閘門（第 615 行）…最後 `wrangler versions upload`（第 949 行）＋ `versions deploy <id>@100% --yes`（第 966 行）。**不要繞過 ship-web 直接 `wrangler deploy`／`versions upload`**：ship-web 會先去註解，直接上傳會把原始檔出上去（`scripts/ship_web.mjs:12`）。
- 出之前 `BOUNTY_WRITES` 要已經是 `off`（5.5），這一版出去的前提是寫入端點全關、只開唯讀。
- 回滾：`arch -arm64 node ./node_modules/wrangler/bin/wrangler.js deployments list` 找上一版的 version id，`versions deploy <上一版 id>@100% --yes`。**副作用**（`schema/0014_bounty_v2.sql` 檔頭第 17–21 行）：舊版 Worker 不認得四張新表，刪帳號不會清籌碼帳本、車庫解鎖、雲端搭乘、每段貢獻，帳號合併也不搬它們。回滾期間這四張表若有資料，要暫停刪帳號與合併，或回滾後手動補刪補搬。在 H 之前 `BOUNTY_WRITES=off`，新表幾乎不會有資料，回滾成本最低。

### 5.4 cron（步驟 F）

- `wrangler.jsonc` 的 `triggers.crons` 加 `"30 19 * * *"`（台北 03:30，前一營運日的車都收班了；程式常數 `BOUNTY_CRON`，`worker.js:8737`；分支在 `worker.js:10318`，只跑估值＋判定然後 return，不會落進每日 ingest）。
- **同一顆 commit** 在 `scripts/check_deploy_config.mjs` 的 `REQUIRED_CRONS`（第 29 行）補一條說明，不然 ship-web 第 192 行會擋（反向檢查：宣告了卻沒說明的 cron 一律擋）。
- **`15 4 * * *` 永遠不加回**（`wrangler.jsonc:88-98` 的註解）。v2 的估值與判定改掛在 `30 19`，跟 `15 4` 無關。
- 出法：ship-web 走 `versions upload`＋`versions deploy`。依 Cloudflare 文件，cron triggers 不跟著版本走，要另外 `arch -arm64 node ./node_modules/wrangler/bin/wrangler.js triggers deploy`（v2 計畫書 §9 第 3 項也是這樣寫）。這一步拿 `wrangler.jsonc` 那份清單**整包取代**正式的 cron，所以清單裡另外兩條（`* * * * *`、`15 1 * * *`）一條都不能少——`check_deploy_config` 就是在守這件事。這台沒實測過 versions 會不會帶 triggers；部署後到 Worker 的 Triggers 頁（或 Workers Schedules API 的 GET）唯讀確認三條都在。
- 第一發會做什麼：估值把新清單上架（本機 3533 單位、267 張卡），判定處理前一營運日的錄程。子請求本機量到 101（空庫）。正式上限 10,000／發、牆鐘 15 分鐘；程式預設預算 `BOUNTY_SUBREQ_BUDGET` 8000。
- E 跟 F 可以分開出：E 出了、F 還沒加，看板上就只有正式庫現在那批舊列（v1 07-28／29 估的），不會有新單位。要看板有新卡，F 一定要做。

### 5.5 env／secret

都不在 `wrangler.jsonc` 的 `vars` 裡（現在只有兩個 FIRESTORE 變數）。以前怎麼設的、現在設了哪些，要看 C 的 `secret list`。

| 名稱 | 上線時的值 | 作用 | 沒設的行為 |
|---|---|---|---|
| `BOUNTY_WRITES` | E 之前設 `off`；H 才拿掉或設別的值 | `off` 時 claim／submit／cloud-ride／garage-redeem 回 503 `bounty_paused`（`worker.js:7013 7110 7647 7873`）；chips-me 與看板照常 | **寫入全開**（只認 `off`，`worker.js:7079`） |
| `BOUNTY_CLAIMABLE_FROM` | H 當天設（L2 起算時間，毫秒） | 估值的 L2 時間分量從這天起算 | L2 恆 1 |
| `BOUNTY_SUBREQ_BUDGET` | 可選，保守可設 900 | 判定 cron 的子請求預算 | 8000 |
| `BOUNTY_BYTES_BUDGET` | 可選 | 判定讀取量預算 | 128 MB |
| `BOUNTY_WALL_BUDGET_MS` | 可選 | 牆鐘預算，會被壓在租約內 | 程式預設 |
| `BOUNTY_RETIRE_ACK` | 只在退場守門擋下、確認是真換班表時設成訊息裡的 `generatedAt` | 放行那一份清單 | 擋下時估值停擺 |
| `BOUNTY_NOW`、`BOUNTY_VERIFY_ORDER` | **正式不要設** | 測試鉤 | — |

注意：

- `bountyMerge` 不受 `BOUNTY_WRITES` 管（沒有呼叫 `bountyWritesOff`）。v1 也是這樣。
- 設變數的方式要先想清楚：`wrangler secret put` 會立刻部署一版；若改用 `wrangler.jsonc` 的 `vars`，那是整包覆蓋（後台手動加的 plain var 會在下一次部署消失）。哪種在這個專案行得通，沒實測過，C 的 `secret list` 先看現況再決定。
- 網頁 `BOUNTY_ENABLED` 不是 Worker 變數：現在只能靠網址 `?bounty=1`（`index.html:15427`）打開，預設打開要改程式、另外出一版。

### 5.6 `bounty_units.json` 要不要重產；舊板列會不會觸發退場守門

- 要重產，出貨當天（5.1 第 3 項）。
- 退場守門（`worker.js:7997`、`8067` 起）：板上現役列裡「新清單沒有的」至少 10 列、而且超過那個系統的一成或那條線的一半，就整發估值中止、板不動、`retireBlock` 帶出訊息。
- 正式板上的舊列是 v1 在 07-28／29 估的。模擬（`guard_sim.mjs`，照守門的算法）：拿 main 在 `864dd16f`（07-28）與 `5efc5803`（07-29）的單位檔當「板上現役列」，對這次重產的清單：要退場 208 列（全是台鐵）、新增 94 列，**沒有任何系統或線過門檻，不會擋**。
- 假設：正式板的列＝那兩份清單之一。C 的第一句查得到實際的列數，對不上就把正式板的列匯出成同樣的形狀重跑 `guard_sim.mjs`。另一條線 10-25 對正式站看板的實查是 `cards: []`，板若是空的就沒有東西可退。
- 就算擋了也是安全失敗：在任何寫入之前丟錯，板不動；處理方式在計畫書 §12.1 第 6 項。

### 5.7 上線後巡檢（步驟 G）

照計畫書 §12.1 第 6 項。最少要看：

- `30 19` 那發的兩行 log：`[cron bounty 估值] 新上架 N, 退場 M…`、`[cron bounty 驗證] … 子請求 X`；有沒有 `預算用盡`、`bounty_units shrink`。
- `GET /api/bounty-board` 的 `valuationOk.at` 是不是當天、`retireBlock` 是不是 null。
- 誤判率：`SELECT verdict, reject_code, quality_code, COUNT(*) FROM bounty_samples GROUP BY 1,2,3`。
- 出錯記錄：`SELECT k, v FROM kv_blobs WHERE k LIKE 'bounty_verify_strike|%'`。

### 5.8 H 之前要先有決定的（不屬於這次整併，列出來免得漏）

計畫書 §12.1 第 5、7 項：D-T1 網頁改動、防偽閘第 2 關從沒跑過、純停靠錄程給不給籌碼、用真錄程校門檻、都卜勒第四重要判可疑還是影子模式、平台性質（記憶體、CPU、D1「每次呼叫的查詢數」怎麼算）用預覽 Worker＋獨立 D1 量一次。

## 6. 沒做、沒驗、不確定

- 沒對正式庫做任何查詢，正式庫的 schema 現況未知（5.2 C）。
- 帶 Bearer 的路徑、真錄程的判定結果，本機實打沒蓋到（3.6），只靠離線套件。
- 退場守門的模擬假設正式板＝07-28／29 的清單（5.6）。
- `wrangler secret put` 與 `vars` 哪個適合設 `BOUNTY_WRITES`，沒實測（5.5）。
- `versions deploy` 會不會帶 cron triggers，沒實測，照文件寫成要另外 `triggers deploy`（5.4）。
