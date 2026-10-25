# 路段懸賞 v2 整併交接（本機分支 `bounty/v2-merge`）

> 寫於 2026-10-25。這份給「沒看過實作、要複審上線計畫」的人讀：照第 5 節逐步做得完，每一步的風險與退路都寫在該步。
> 本線**沒有** push 任何分支、沒有部署、沒有碰正式 D1、沒有進 Cloudflare 後台。第 5 節每一個 `--remote`、部署、設變數都是對外動作，逐項等 go。

## 0. 結論

- 整併完成：`8ef76a8a`＝`origin/main` `ef09beef` ＋ `origin/fix/bounty-gate-env-flakes` `7a28cd16`（v2＝`origin/feat/bounty-chips-v2` `428e30c2` 再加兩顆總閘門修正）。只在本機。
- 懸賞總閘門：整併當下 18 支套件 16 支綠、2 支各紅 1 條，兩條都**不是整併造成的**（第 3.2 節）。主線依規則定了處理方式，已各修一顆 commit（`21400e80`、`74c78869`），修完重跑結果見第 3.1 節。
- main 原有的 worker 相關檢查 40 支：沒有一支被整併弄紅（第 3.3 節）。
- 用 `wrangler dev --local` 起整併版，照 10-24 真機請求的形狀打 21 發（看板 → 接卡 → 上傳 → me → chips-me → 雲端搭乘 → 兌換 ＋ 錯誤路徑），21/21 符合 App 的預期（第 3.6 節）。
- App 契約（原生 origin/main `83a195b69`）：七個端點的請求欄位、回應欄位、錯誤碼都對得上；沒有會讓 App 壞掉的不一致，差異列在第 4 節。
- 10-25 已唯讀盤點正式環境（第 5.3 節）：懸賞 v2 的三支遷移一支都沒套，v1 的懸賞表全是 0 列，沒有 `BOUNTY_*` 變數（寫入總閘開著），正式 cron 只有兩條、沒有 `15 4`；帳號方案 API 查不到。
- 10-25 13:19 已做完 D：三支遷移套上正式庫，套用後守門人與 12 句索引探針全綠（第 5.5 節）。下一步是 B、E0、E。
- 上線計畫照 10-25 獨立複審（2 點 blocking、10 點 should-fix）改過：刪帳號在 E 之後實測（5.6）、回滾要連 cron 一起退且目標寫死（5.7）、`BOUNTY_WRITES` 一律用 secret（5.1）、D1 查詢數在 F 之前處理（5.8）。

## 1. 分支與 commit

| 項目 | 值 |
|---|---|
| 樹 | `.claude/worktrees/magical-wilson-2c343d` |
| 分支 | `bounty/v2-merge`（本機，**未 push**） |
| 合併 commit | `8ef76a8a`，parents `ef09beef`（origin/main）、`7a28cd16`（v2） |
| 判準修正 | `21400e80`（valuation F1 參考值）、`74c78869`（hardening PLb 一句只比排序後的行） |
| BUILD | `e5a771bd`（`v1024l` → `v1025a`，見 5.2 第 2 點） |
| 交接檔 commit | `4c8b9d0c` 初版；之後的更新看 `git log -- docs/bounty-v2-merge-handoff.md` |
| 合併基準 | `cbe6e603`（09-28） |

每個衝突怎麼解，逐條寫在合併 commit 的訊息裡：`git show -s --format=%B 8ef76a8a`。摘要：

- `worker.js`：`API_POST_ALLOWED` 取聯集；`bountySubmit` 結尾、`bountyVerifyCron` 判定迴圈取 v2 的程式，註解用 main 改過的句子（main 在這兩段只改了註解）。
- main 在 07-29 的三顆懸賞修正 `5efc5803`、`a5a3f0bf`、`40163d86` 都在合併基準之前，兩邊都有，原樣保留。
- `wrangler.jsonc` 沒有衝突、沒有改：crons 仍是 `["* * * * *", "15 1 * * *"]`（v2 的判定 cron 要另外加，見第 5.8 節）。
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

依據：v2 計畫書 §9、§12.1（主工作樹 `docs/superpowers/plans/2026-09-29-路段懸賞與籌碼.md`，**未進版控**）對到這次整併的現況，再照 10-25 的獨立複審（2 點 blocking、10 點 should-fix）改過一版。計畫書裡上線會用到的部分（B6 髒列、退場擋下、巡檢清單）已經搬進本節，照本節做不必再開計畫書；兩邊有出入以本節為準。

### 5.0 共用前置

指令在本樹根目錄跑；F 一定要在出貨那顆 sha 的乾淨樹跑（5.8）。先定義兩個函式，bash、zsh 都能用（zsh 不會把字串變數拆成多個字，所以不用 `W="arch …"; $W …` 那種寫法）：

```bash
w() { arch -arm64 node ./node_modules/wrangler/bin/wrangler.js "$@"; }
q() { w d1 execute DELAY_DB --remote --json --command "$1"; }
```

- `q` 一次送一句。D 以外的寫入一律用 `q`（`--command`），**不要用 `--file`**：`--file` 走 import，wrangler 4.111 會印「This process may take some time, during which your D1 database will be unavailable to serve queries.」，整個正式庫在那段時間停止服務。
- 所有輸出、快照存在 `tmp/` 底下（`.gitignore:106` 忽略）。

### 5.1 順序總覽

| 步驟 | 動作 | 寫正式環境？ | 退路 |
|---|---|---|---|
| A | 本機準備（5.2） | 否（本機 commit） | — |
| B | push 分支、併 main | 是（公開 repo） | 難 |
| C | 唯讀盤點：schema、樣本、看板、B6、估值狀態、v2 表、secret、版本、寫入總閘、cron、方案（5.3） | 只讀 | — |
| C′ | 看 C 的結果做決定（5.4） | 依決定 | — |
| D | 低流量時段補套懸賞遷移，套完跑 12 句索引探針（5.5）。**10-25 13:19 已完成、全綠** | 是（套用期間全庫停服務） | 只加不刪 |
| E0 | 視 C 的結果 `secret put BOUNTY_WRITES`＝`off`，記下它產生的版本 id＝**回滾目標**（5.6） | 是（立刻部署一版舊程式） | — |
| E | ship-web 出 v2；四個寫入端點要 503、刪帳號實測（5.6） | 是 | 5.7 回滾三步 |
| F0 | D1「每次呼叫的查詢數」先處理（5.8，二選一） | 依選項 | — |
| F | commit `30 19` 的 cron、出貨，從那顆 sha 的乾淨樹 `triggers deploy`（5.8） | 是 | 5.7 第 1 步 |
| G | 上線後巡檢，含再實刪一次（5.10） | 只讀（實刪那次是寫入） | — |
| H | 開放（5.11 的前置都完成後） | 是 | 設回 off |

- **D 一定早於 E**：v2 遇到沒套 0014 的庫，`/api/account-delete` 對**所有人**回 502（`bountyPurgeUid` 在同一個 batch 刪四張新表，`worker.js:7512` 起；失敗回 502 在 `worker.js:5412-5413`），看板整個 503（`schema/0014_bounty_v2.sql` 檔頭第 3–13 行）。ship-web 2.4 會擋，但不要靠它。
- **E0 早於 E**：`versions upload` 預設保留 secret（wrangler 4.111 原始碼 `keepSecrets: true`），E0 設的 secret 會跟著進 v2 那一版。plain var 不會：沒帶 `--keep-vars` 時「Wrangler will delete all vars before setting those found in the Wrangler configuration」，而 ship-web 的 `versions upload`（`scripts/ship_web.mjs:949`）沒帶。所以 `BOUNTY_WRITES` **一定用 secret**。
- **判定 cron 不受 `BOUNTY_WRITES` 管**：只有 claim／submit／garage-redeem／cloud-ride 四個端點檢查它（`worker.js:7013 7110 7647 7873`），`bountyVerifyCron`（`worker.js:8851`）不看。判定一跑（F 之後的 `30 19`，或正式 cron 若還留著 `15 4`，`worker.js:10355`），就判庫裡所有 `trip_date` 早於今天的 pending 樣本（`worker.js:8914`，沒有日期下限）；舊列的 `client` 是 NULL，判成不是模擬器（`worker.js:9098`），照樣發籌碼、寫每段貢獻。C 要先看有多少（5.3 第 02、03 句）。

### 5.2 出貨前（步驟 A）

1. ~~valuation F1~~ 已修 `21400e80`；~~hardening PLb~~ 已修 `74c78869`。修完總閘門 18/18（3.1）。
2. **BUILD 已 bump**：`e5a771bd` 把 `index.html:7076` 的 `v1024l` 改成 `v1025a`。ship-web 第 4 步（`scripts/ship_web.mjs:932-937`）在「內容與正式站不同、BUILD 卻相同」時擋下，整併版的 index.html 與正式站不同。出貨前 index.html 若又變了、而正式站已經是 `v1025a`，要再 bump。更新紀錄沒有加條目（2.45 只守字數，不要求新條目）；要不要加由主線決定。
3. **`bounty_units.json` 出貨當天重產**：`npm run build-bounty-units`，有差異就 commit。這次重產是 10-25 的班表；ship-web 的資料閘不會擋舊的單位檔（R11 只守站表、R13 只守算法），而台鐵班表每週重抓、尖峰小時可能跟著換。
4. 視需要：根目錄 `verify_bounty.mjs` 退役或改寫（3.5）。不擋出貨。
5. 註解衛生：v2 新增行裡沒有引用使用者原話（`原話`／`裁示` 0 筆、`verify_public_repo_hygiene` ALL PASS）。main 10-18 做過「註解只留做法與理由」的清理，v2 的註解還有 `brief §…` 之類指向其他文件的代號，要不要比照清理由主線決定，不擋出貨。
6. 這份交接檔本身要不要進公開 repo，push 前由主線決定（裡面有本機路徑）。

### 5.3 唯讀盤點（步驟 C）

查正式庫、打正式 API 也是對外動作，照樣等 go。下面整段只有 SELECT、GET、`whoami`、`secret list`、`deployments list`、`versions list`、`auth token`（讀本機登入），外加一發 body 故意不合法的 POST（第 13 行，說明在表下）；**沒有任何寫入**。可以整段貼上。

```bash
mkdir -p tmp/c
w() { arch -arm64 node ./node_modules/wrangler/bin/wrangler.js "$@"; }
q() { w d1 execute DELAY_DB --remote --json --command "$1"; }
w whoami 2>&1 | tee tmp/c/00_whoami.txt
node scripts/verify_remote_schema.mjs 2>&1 | tee tmp/c/01_schema.txt
q "SELECT verdict, COUNT(*) AS n, MIN(trip_date) AS d0, MAX(trip_date) AS d1 FROM bounty_samples GROUP BY verdict" | tee tmp/c/02_samples.json
q "SELECT verdict, client IS NULL AS no_client, COUNT(*) AS n, MIN(trip_date) AS d0, MAX(trip_date) AS d1 FROM bounty_samples GROUP BY 1, 2" | tee tmp/c/03_samples_client.json
q "SELECT sys, kind, COUNT(*) AS n, MIN(first_claimable_at) AS fc_min, MAX(first_claimable_at) AS fc_max, MIN(l2) AS l2_min, MAX(l2) AS l2_max, SUM(l2_capped_at IS NOT NULL) AS capped, SUM(covered_at IS NOT NULL) AS covered, SUM(unlocked_offer) AS unlocked FROM bounty_board GROUP BY 1, 2" | tee tmp/c/04_board.json
q "SELECT actor, uid, merged_into, points, updated_at FROM bounty_points WHERE uid IS NOT NULL AND merged_into IS NOT NULL" | tee tmp/c/05_b6.json
q "SELECT COUNT(*) AS n, SUM(uid IS NOT NULL) AS accounts, SUM(merged_into IS NOT NULL) AS merged, SUM(points) AS points FROM bounty_points" | tee tmp/c/06_points.json
q "SELECT k, v, updated FROM kv_blobs WHERE k IN ('bounty_valuation_ok', 'bounty_retire_block', 'bounty_verify_lease')" | tee tmp/c/07_kv_state.json
q "SELECT COUNT(*) AS n FROM kv_blobs WHERE k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}'" | tee tmp/c/08_strikes.json
q "SELECT 'chip_ledger' AS t, COUNT(*) AS n FROM chip_ledger UNION ALL SELECT 'garage_unlocks', COUNT(*) FROM garage_unlocks UNION ALL SELECT 'cloud_rides', COUNT(*) FROM cloud_rides UNION ALL SELECT 'bounty_seg_contrib', COUNT(*) FROM bounty_seg_contrib" | tee tmp/c/09_v2_tables.json
w secret list 2>&1 | tee tmp/c/10_secrets.txt
w deployments list 2>&1 | tee tmp/c/11_deployments.txt
w versions list 2>&1 | tee tmp/c/12_versions.txt
curl -sS -X POST -H 'content-type: application/json' -d '{}' -w ' HTTP %{http_code}\n' https://railisland.tw/api/bounty-claim | tee tmp/c/13_writes_gate.txt
curl -sS -o tmp/c/14_board.json -w 'HTTP %{http_code} %{size_download} bytes\n' https://railisland.tw/api/bounty-board
cat > tmp/c/cf_get.mjs <<'EOF'
// 只發 GET：帳號清單、這支 Worker 的 cron 排程、帳號的訂閱方案。token 從 stdin 讀，不印出來。
let s = '';
for await (const d of process.stdin) s += d;
const tok = JSON.parse(s.slice(s.indexOf('{'))).token;
const get = p => fetch('https://api.cloudflare.com/client/v4' + p, { method: 'GET', headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json());
const acc = await get('/accounts');
if (!acc.success) { console.log('accounts:', JSON.stringify(acc.errors)); process.exit(1); }
for (const a of acc.result) {
  const sc = await get(`/accounts/${a.id}/workers/scripts/taiwan-rail-live/schedules`);
  console.log(`[${a.name}] schedules:`, sc.success ? JSON.stringify(sc.result.schedules.map(x => x.cron)) : JSON.stringify(sc.errors));
  const sub = await get(`/accounts/${a.id}/subscriptions`);
  console.log(`[${a.name}] subscriptions:`, sub.success ? JSON.stringify(sub.result.map(x => [x.rate_plan && x.rate_plan.public_name, x.rate_plan && x.rate_plan.id, x.state])) : JSON.stringify(sub.errors));
}
EOF
w auth token --json 2>/dev/null | node tmp/c/cf_get.mjs | tee tmp/c/15_cf.txt
```

這段在本機做過的檢查：`zsh -n`、`bash -n` 語法都過；`cf_get.mjs` 用假的 `fetch` 跑過一次（只發 GET、token 沒印出來、權限不足的回應照原樣印）。**沒有對正式環境跑過任何一行。**

| 輸出 | 看什麼 | 接到哪 |
|---|---|---|
| 00 | 登入的帳號是不是 `taiwan-rail-live` 所在的那個 | 不對就停 |
| 01 | 全綠＝D 不必做；缺什麼照 5.5 | 缺 `cloud_rides.simulator`、`idx_seg_contrib_actor`、`idx_seg_contrib_first` 其中之一＝正式庫套的是**舊版 0014**（5.5 第 5 點） |
| 02、03 | pending 樣本有幾列、日期範圍、`client` 是不是 NULL。03 在 0014 沒套時會報 `no such column: client`，那本身就是答案 | 5.4 第 1 點 |
| 04 | 舊板列的 `first_claimable_at`、`l2`、`l2_capped_at` | 5.4 第 2 點 |
| 05 | B6 髒列 | 5.4 第 3 點 |
| 06 | 帳號與合併的總數（回滾快照的規模） | 5.7 |
| 07 | 舊版不寫這三個鍵（`ef09beef` 的 worker.js 0 處），有值＝v2 的程式曾經對正式庫跑過 | 有值就先查是誰、什麼時候 |
| 08、09 | 判定出錯記錄與四張 v2 表現在有沒有列。09 在 0014 沒套時會報 `no such table` | 同上 |
| 10 | `BOUNTY_WRITES` 等名字有沒有出現（只列名字，看不到值） | 5.4 第 4 點 |
| 11、12 | 最新上傳的版本是不是就是正在跑的版本 | 5.6 E0 的前提 |
| 13 | 回 `503 {"error":"bounty_paused"}`＝現在寫入已關；回 `400 {"error":"bad_actor"}`＝寫入開著 | 5.4 第 4 點 |
| 14 | 正式看板現在長怎樣（另一條線 10-25 實查是 `cards: []`） | 5.9 |
| 15 | 正式 cron 有哪幾條（**特別看 `15 4 * * *` 在不在**）、帳號方案 | 5.4 第 5、6 點 |

第 13 行為什麼不是寫入：正式站現在跑的 main 版 `bountyClaim` 先過節流、再看 `BOUNTY_WRITES`，然後解析 body，`{}` 沒有 `actor` 就回 400 `bad_actor`，在這之前沒有任何 D1 存取（`ef09beef` 的 `worker.js:6861-6867`）。唯一的副作用是吃掉一格節流額度（每分鐘 30 次）。

第 15 行的 `subscriptions` 若回權限錯誤（wrangler 的 OAuth 不一定有帳務讀取權），方案改到後台看：<https://dash.cloudflare.com/?to=/:account/workers/plans>。

#### 10-25 實查結果（11:53–12:00 台北，經使用者 go，清單一字未改；原始輸出在 `tmp/c/`，被忽略、不進版控）

| 輸出 | 結果 |
|---|---|
| 00 | OAuth 登入，底下只有一個 Cloudflare 帳號；token 權限沒有帳務讀取 |
| 01 | rc=1、缺 37 項：**懸賞 v2 的 0014、0015、0016 一支都沒套**（四張表整張不在、`distinct_ok_users`／`client`／`retired`／`kept_d0`／`kept_d1` 不在、六個索引不在）。main 的 `0014_trackside`、`0015_rail_ai_status`、`0016_rail_push` 沒列在缺項裡＝都在 |
| 02 | `bounty_samples` 0 列 |
| 03 | `no such column: client`（0014 沒套，預期中） |
| 04 | `bounty_board` 0 列 |
| 05 | B6 髒列 0 列 |
| 06 | `bounty_points` 0 列 |
| 07 | 三個估值狀態鍵都不在 |
| 08 | 判定出錯記錄 0 筆 |
| 09 | `no such table: bounty_seg_contrib`（0014 沒套，預期中） |
| 10 | 20 個 secret，**沒有任何 `BOUNTY_*`** |
| 11、12 | 線上 100% 是 `060576e2`（2026-10-24T18:42:45Z 上傳），也是最新上傳的版本（版本清單 10 個，最新那個就是它） |
| 13 | `{"error":"bad_actor"} HTTP 400`：**寫入總閘現在是開的** |
| 14 | HTTP 200、`cards` 0 張 |
| 15 | 正式 cron 只有 `* * * * *`、`15 1 * * *`，**沒有 `15 4`**；`subscriptions` 回 `10000 Authentication error`（沒有帳務權限），方案沒查到 |

一句話：正式庫的懸賞部分是空的（v1 的四張表都 0 列），v2 的 schema 一支都沒套，沒有 `BOUNTY_*` 變數，cron 是乾淨的兩條。

### 5.4 看完 C 要做的決定（步驟 C′，每一項的寫入都要另外 go）

**10-25 實查後的判讀**（逐項對下面 1–6）：

1. 舊樣本：0 列，不用清，第一發判定沒有東西可判。
2. 舊板列：0 列。L2 起算、自動開關、退場守門的疑慮都不存在：第一發估值是全新上架，沒有東西可退（5.9 的模擬不用再做）。
3. B6：0 列，不用修。
4. `BOUNTY_WRITES`：13 回 400、10 沒有它＝**寫入開著、從沒設過**。要做 E0。E0 的前提（最新上傳＝線上，都是 `060576e2`）10-25 12:00 成立，但其他線隨時會 `--preview` 上傳，**E0 當下要重跑 C 的 11、12**。
5. `15 4`：不在，跳過。
6. 方案：API 查不到（沒有帳務權限）。要使用者到後台看一眼：<https://dash.cloudflare.com/?to=/:account/workers/plans>。是 Workers Paid 才照本計畫走；間接證據（auto-memory 記著 Workers Paid 的超量計費）指向付費。


1. **舊的 pending 樣本**（02、03）：第一發判定會把它們全部判掉、照常發籌碼（5.1 第三點）。要先清（例如判成 `unusable`），還是讓它們照判，由主線決定。決定之前不做 F，也不要讓 `15 4` 留在正式 cron 上出 E。
2. **舊板列**（04）：`bountyValuationCron` 重算時 L2 的起算是 `r.first_claimable_at || BOUNTY_CLAIMABLE_FROM`（`worker.js:8180`）。舊列若帶著 07 月的 `first_claimable_at`，第一發估值 L2 就照 07 月起算，可能一上來就頂到 5；`l2_capped_at` 已有值的列，滿 30 天且沒樣本會自動打開（`unlocked_offer`）。要不要在 F 之前把舊列的這三欄清掉，看 04 的數字再決定。
3. **B6 髒列**（05）：舊版 `bountyMerge` 的合併劫持留下的「帳號列（`uid` 非 NULL）又掛著 `merged_into`＝攻擊者」。v2 的程式已經不跟這種列走：`resolveActor` 有 uid 就回自己（`worker.js:6775-6781`），`bountyMerge` 的每一句寫入都帶 `uid IS NULL` 守衛（`worker.js:7347`），`bountyPurgeUid` 不把它當成攻擊者的裝置（`worker.js:7505-7511`）；判準在 `verify_bounty_auth` A1b、A9e 與 `verify_bounty_hardening`。所以髒列在 v2 底下不會再被利用，但它在劫持當時可能已經搬過點數。05 有列時：
   - 每一列先查 `merged_into` 那個 actor 是誰、劫持前後 `bounty_points.points` 怎麼變（v1 的合併會把來源的點數加到目的、來源歸零，`ef09beef` 的 `worker.js:7084-7090`），能還原多少由主線決定；
   - 標記本身的修法（寫入、要 go）：`q "UPDATE bounty_points SET merged_into=NULL WHERE actor='<該列 actor>' AND uid IS NOT NULL"`，逐列做，不要一次 `WHERE uid IS NOT NULL` 全改。
4. **`BOUNTY_WRITES` 現況**（10＋13）：
   - 13 回 503 而且 10 有 `BOUNTY_WRITES`：已經是 secret 的 off。E0 不用做，**回滾目標＝11 裡現在正在跑的那個版本 id**，寫下來。
   - 13 回 503 但 10 沒有它：是 plain var（或別的來源），ship-web 一出就會被洗掉（5.1 第二點）。停手，先問主線怎麼換成 secret（同名 plain var 存在時直接 `secret put` 會怎樣，沒查過）。
   - 13 回 400：寫入現在開著，做 E0。
5. **正式 cron 有 `15 4 * * *`**（15）：v2 一出，`15 4`（台北 12:15）就會跑 v2 的估值＋判定（`worker.js:10355`），等於沒做 F 就開了判定，而且是跟每日 ingest 擠同一發。要在 E 之前先拿掉：從**正式站現在那顆 sha** 的乾淨樹（步驟同 5.8 第 3 點）`w triggers deploy`，那份 `wrangler.jsonc` 只有 `* * * * *`、`15 1 * * *`。沒有 `15 4` 就跳過。
6. **方案**（15）：本節的預算照付費方案寫（cron 子請求 10,000／發、牆鐘 15 分鐘）。若是免費方案，cron 一發的 CPU 上限 10 ms，估值一發跑不完，整個上線計畫要重想。間接證據指向付費：auto-memory `cloudflare-d1-ledger-rows-read-cost` 記著 Workers Paid 的內含 250 億列／月、08-29 起超量計費。以 15 的實查為準。

### 5.5 正式 D1 補套（步驟 D）

**時段**：`--file` 走 import，套用期間整個正式庫停止服務（5.0）——每分鐘 cron 的北捷帳本取樣、所有讀 D1 的 API 都會失敗。挑低流量時段，例如台北 01:30–03:00（末班車收班後）；避開 03:30（`30 19`，F 之後的判定）、09:15（`15 1`，每日 ingest）。每支檔多久，這台沒量過。

**照 C 的 01 只套缺的**（懸賞三支彼此照順序）：

```bash
w d1 execute DELAY_DB --remote --file=schema/0014_bounty_v2.sql
w d1 execute DELAY_DB --remote --file=schema/0015_bounty_retired.sql
w d1 execute DELAY_DB --remote --file=schema/0016_bounty_kept_range.sql
```

1. **整支檔要嘛全套、要嘛全不套**（複審的說法；wrangler 原始碼只對 `d1 migrations apply` 寫了失敗回滾，`execute --file` 沒寫，計畫書 §12.1 第 7 項也把「遠端 `--file` 是不是整檔一筆交易」列為沒驗過）。不管是哪一種，結論一樣：**已經套過 0014 的庫，重套 0014 補不上任何東西**——它會在檔尾第一句 `ALTER`（`duplicate column name`）失敗，前面的 CREATE 不是被一起回滾、就是本來就已存在。
2. 已套過 0014、只缺索引：照 01 印的那一句 `w d1 execute DELAY_DB --remote --command "CREATE INDEX IF NOT EXISTS …"` 單獨補（`scripts/verify_remote_schema.mjs:169`）。
3. 0015、0016 各自只有 `ALTER TABLE … ADD COLUMN`，重跑報 `duplicate column name`＝已套過，無害。
4. 缺主鍵自動索引（`sqlite_autoindex_*`）：要重建整張表，停手問。
5. **舊版 0014**：0014 在 v2 分支上改過幾次，後加的有 `cloud_rides.simulator`（`79a55437`，09-29 14:11）、`idx_seg_contrib_actor`（`c2e81e3b`，09-29 15:39）、`idx_seg_contrib_first`（`a70d0cf5`，09-30 08:22）。正式庫若是更早套的，`CREATE TABLE IF NOT EXISTS` 不會補欄。01 若說缺 `cloud_rides.simulator` 這類「表在、欄不在」，守門人會印「`--file=schema/0014_bounty_v2.sql`」（`scripts/verify_remote_schema.mjs:168`，它對缺欄一律叫人重套建表那支）——**不要照做**，停手，另寫一支只有 `ALTER TABLE cloud_rides ADD COLUMN simulator INTEGER NOT NULL DEFAULT 0;` 的新遷移（編號接在現有之後），本機過 `verify_bounty_schema` 再套。索引照第 2 點單獨補。
6. 套完重跑 `node scripts/verify_remote_schema.mjs`，要綠。
7. **12 句索引探針**（D 之後、E 之前，唯讀）：`worker.js` 用 `INDEXED BY` 指名了 12 個索引（全檔 56 處），名字不在，那一句直接報錯（刪帳號就是 502）。每個名字各跑一句，12 句都要回 `n: 0`、不報錯：

```bash
pr() { q "SELECT '$2' AS idx, COUNT(*) AS n FROM $1 INDEXED BY $2 WHERE $3='__probe__'"; }
pr chip_ledger idx_chip_ledger_actor_day actor
pr bounty_claims idx_claims_actor actor
pr bounty_claims idx_claims_expiry status
pr bounty_claims idx_claims_unit seg_key
pr bounty_samples idx_samples_pending verdict
pr bounty_samples idx_samples_trip actor
pr bounty_seg_contrib idx_seg_contrib_actor actor
pr bounty_seg_contrib idx_seg_contrib_first seg_key
pr bounty_samples sqlite_autoindex_bounty_samples_1 id
pr bounty_seg_contrib sqlite_autoindex_bounty_seg_contrib_1 seg_key
pr cloud_rides sqlite_autoindex_cloud_rides_1 actor
pr garage_unlocks sqlite_autoindex_garage_unlocks_1 actor
```

   這 12 句（同一份清單）在本機 D1（`wrangler dev --local` 的狀態）跑過，12/12 回 0。

**會不會動到既有資料**：不會改寫既有列。0014 是**四張表、三個索引**的 `CREATE … IF NOT EXISTS`（`bounty_seg_contrib`、`chip_ledger`、`garage_unlocks`、`cloud_rides`；`idx_seg_contrib_actor`、`idx_seg_contrib_first`、`idx_chip_ledger_actor_day`），加上檔尾兩句 `ALTER TABLE ADD COLUMN`（`bounty_board.distinct_ok_users`、`bounty_samples.client`）；0015 是 `bounty_board.retired`、0016 是 `bounty_samples.kept_d0／kept_d1`，都是 ADD COLUMN（帶預設值或可 NULL）。

**退路**：現行正式 Worker（main 版）不讀新表新欄，D 做完、E 出問題時 Worker 留在舊版就好，schema 不必拆。不建議拿 D1 Time Travel 還原：會把那個時間點之後**所有**寫入一起丟掉（誤點履歷、推播綁定、北捷帳本……）。真的要用，先 `w d1 time-travel info DELAY_DB` 記下套用前的 bookmark（這台沒實測過這個指令）。

**正式庫已經套了什麼**：文件說法原本互相矛盾（`schema/README.md:86` 暗示 0014 套過；`schema/0016_bounty_kept_range.sql:13` 的註解寫「0014、0015 都已經套進正式庫」；計畫書 §12.1 第 1 項是「依序套」）。**10-25 實查：三支都沒套**（5.3），計畫書對、那兩處註解錯。所以第 5 點「舊版 0014」不會發生，D 照順序把三支都套上即可。另外 `schema/0014_bounty_v2.sql:3` 的「新環境＝0002 + 0014 + 0015」漏了 0016，新環境要套 0002、0014、0015、0016 四支（這次只改文件，那行註解沒動）。

**main 那三支同號遷移不是本線的**：`0014_trackside`（10-20 進 main）、`0015_rail_ai_status`（10-24）、`0016_rail_push`。依主線告知，`0016_rail_push` 已在 10-25 套上正式庫並出貨。ship-web 2.4 會比對**全部** `schema/*.sql`，其中任何一支沒套，出懸賞這一版也會被擋；照 01 的輸出跟那幾條線確認，不要順手代套。

#### 10-25 實跑結果（13:18–13:20 台北，經使用者 go，由主線在本樹照 5.0／5.5 的指令跑；原始輸出在 `tmp/d/`，被忽略）

| 步 | 結果 |
|---|---|
| 套用前 | `verify_remote_schema` rc=1、缺 37 項，與 C 的 01 相同（全是懸賞 v2）。Time Travel 套用前書籤 `000008a6-00000f09-0000510f-552b8f9e56b6b53e10c0a3616214af2e` |
| 套用 | `d1 execute --remote --yes --file` 依序 0014（13:19:03–06）、0015（13:19:06–10）、0016（13:19:10–13），三支 rc=0、`success: true`。D1 回報 duration 6.6／2.9／7.3 ms，rows_written 18／1／2，size_after 140,627,968 |
| 套用後 | `verify_remote_schema` rc=0：19 支 migration、24 張表、221 欄、12 個 `INDEXED BY` 索引都在 |
| 探針 | 12 句 12/12：都回 `n: 0`、`success: true`、沒有報錯 |
| 服務 | 套用後每分鐘 cron 照常寫入（`tra_station_events` 在 13:20:04 那一發新寫 21 筆），`railisland.tw` 首頁 HTTP 200 |

D 完成。三支檔各只用幾秒，停服務的時間短到在每分鐘 cron 上看不出缺口。要退的話（不建議，理由見上面「退路」），用上面那個書籤。

### 5.6 部署（步驟 E0、E）

**E0：設寫入總閘**（只在 5.4 第 4 點說要做時）

1. 前提：C 的 11、12 顯示「最新上傳的版本＝正在跑的版本」。不是的話，`secret put` 會被 API 拒絕（錯誤碼 10215，wrangler 原文要人改用 `wrangler versions secret put` 或先部署最新版）。**這時停手問**，不要改用 `versions secret put`：它複製的是「最新上傳的版本」（wrangler 4.111 原始碼取 `versions[0]`），那可能是某條線 `--preview` 上傳、沒上線的程式。
2. `printf off | w secret put BOUNTY_WRITES`。它會拿現在的程式加上這個 secret 產生新版本並立刻部署。
3. 跑 `w deployments list`，**把這一次產生的版本 id 寫下來：這就是 5.7 的回滾目標**（舊程式＋`BOUNTY_WRITES=off`）。secret 跟著版本走（`versions upload` 的 `keepSecrets` 就是把上一版的 secret 複製進新版），回滾到 E0 之前的版本會連 off 一起退掉。
4. 唯讀確認：C 的第 13 行重跑一次，要 `503 bounty_paused`。

**E：出 v2**

```bash
npm run ship-web
```

- ship-web 從乾淨 worktree 出貨，依序跑：正式庫 schema（2.4，第 127 行）、更新紀錄字數（2.45）、部署設定（2.6，第 192 行）、懸賞總閘門（第 615 行）、BUILD 防撞（第 4 步，第 932–937 行）……最後 `versions upload`（第 949 行）＋`versions deploy <id>@100% --yes`（第 966 行）。**不要繞過 ship-web 直接 `wrangler deploy`／`versions upload`**：ship-web 會先去註解，直接上傳會把原始檔出上去（`scripts/ship_web.mjs:12`）。
- 出完立刻做兩件事：

**E-1：四個寫入端點要 503**（body 故意不合法；v2 這四支都是節流之後第一件事就看 `BOUNTY_WRITES`，在解析 body 之前，`worker.js:7013 7110 7647 7873`，不會寫入）：

```bash
for p in bounty-claim bounty-submit garage-redeem cloud-ride; do printf '%s ' "$p"; curl -sS -X POST -H 'content-type: application/json' -d '{}' -w ' HTTP %{http_code}\n' "https://railisland.tw/api/$p"; done
```

四行都要 `{"error":"bounty_paused"} HTTP 503`。有任何一行不是：立刻照 5.7 回滾。

**E-2：刪帳號實測**（這是 B1：v2 的刪帳號在正式庫從沒跑過，D 的探針只證明索引名字在、不證明整個 batch 跑得過）

1. 準備一個**專用的測試帳號**（不要用任何人的真帳號），在網頁登入一次，記下它的 Firebase uid（Firebase 主控台，或網頁 devtools）。下面第一行的 `U` 換成它；沒換的話 `ins` 會拒絕送出。
2. 在正式庫放一組標記過的測試列（寫入、要 go；每句一行，不用 `--file`）：

```bash
U='填測試帳號的 uid'
ins() { [[ "$U" =~ ^[A-Za-z0-9_-]{6,128}$ ]] || { echo 'U 還沒換成測試帳號的 uid'; return 1; }; q "$1"; }
ins "INSERT INTO bounty_points (actor, uid, points, updated_at) VALUES ('$U', '$U', 0, 0)"
ins "INSERT INTO bounty_samples (id, actor, sys, ln_id, train_no, dir, trip_date, payload, submitted_at, verdict) VALUES ('deltest-$U', '$U', 'tra', 'deltest', '0', 0, '2026-01-01', '[]', 0, 'unusable')"
ins "INSERT INTO bounty_claims (id, actor, seg_key, train_kind, dir, kind, slot, points_locked, claimed_at, expires_at, status) VALUES ('deltest-$U', '$U', 'deltest|x|a|b', 'x', 0, 'track', 'all', 0, 0, 0, 'expired')"
ins "INSERT INTO chip_ledger (id, actor, kind, delta, ref, day, created_at) VALUES ('deltest-$U', '$U', 'adjust', 0, 'deltest-$U', '2026-01-01', 0)"
ins "INSERT INTO garage_unlocks (actor, scene, nth, cost, created_at) VALUES ('$U', 'deltest', 1, 0, 0)"
ins "INSERT INTO cloud_rides (actor, day, train_key, sec, request_id, created_at, simulator) VALUES ('$U', '2026-01-01', 'deltest', 0, NULL, 0, 1)"
ins "INSERT INTO bounty_seg_contrib (seg_key, actor, first_ok_at) VALUES ('deltest|x|a|b', '$U', 0)"
ins "INSERT INTO kv_blobs (k, v) VALUES ('bounty_verify_strike|$U|2026-01-01|0', '{\"at\":0,\"error\":\"deltest\",\"n\":1}')"
```

   樣本判成 `unusable`、認領是 `expired`、搭乘是模擬器、籌碼 0：判定 cron 與看板都不會用到它們。

3. 檢查句（刪之前跑一次，八列都要 `n: 1`）：

```bash
q "SELECT 'bounty_points' AS t, COUNT(*) AS n FROM bounty_points WHERE actor='$U' UNION ALL SELECT 'bounty_samples', COUNT(*) FROM bounty_samples WHERE actor='$U' UNION ALL SELECT 'bounty_claims', COUNT(*) FROM bounty_claims WHERE actor='$U' UNION ALL SELECT 'chip_ledger', COUNT(*) FROM chip_ledger WHERE actor='$U' UNION ALL SELECT 'garage_unlocks', COUNT(*) FROM garage_unlocks WHERE actor='$U' UNION ALL SELECT 'cloud_rides', COUNT(*) FROM cloud_rides WHERE actor='$U' UNION ALL SELECT 'bounty_seg_contrib', COUNT(*) FROM bounty_seg_contrib WHERE actor='$U' UNION ALL SELECT 'strike', COUNT(*) FROM kv_blobs WHERE k >= 'bounty_verify_strike|$U|' AND k < 'bounty_verify_strike|$U}'"
```

4. 用網頁的刪除帳號按鈕刪掉測試帳號（`index.html:17133` 送 `/api/account-delete`）。在 devtools 的 Network 看那一發：要 **200**，回應是 `{"ok":true,"deleted":{"samples":1,"claims":1,"points":1,"chips":1,"unlocks":1,"cloudRides":1,"contrib":1}}`（`worker.js:5448`；kv 的出錯記錄只刪、不計數）。
5. 再跑第 3 步的檢查句，八列都要 `n: 0`。
6. 不是 200、或有任何一列沒變 0：v2 的刪帳號在正式庫壞了。照 5.7 回滾，然後用 5.7 第 4 步的補刪把測試帳號的列清掉。

   第 2、3、5 步的 SQL 在本機 SQLite（套 0001、0002、0014–0016）跑過：插入成功、八列 1；用 `bountyPurgeUid` 同樣的刪除句（不帶裝置 id）刪完，八列 0。

### 5.7 回滾（B2：三步，順序不能換）

**為什麼要連 cron 一起退**：舊版（main `ef09beef`）的 `scheduled()` 只認 `* * * * *`（`worker.js:8489`）和 `15 4 * * *`（`worker.js:8640`，在 finally 裡），**其他 cron 一律落進每日 ingest**（`worker.js:8620`）。F 之後正式 cron 有 `30 19`；只退 Worker 不退 cron，舊版每天台北 03:30 會多跑一次每日誤點 ingest（多耗 TDX 點數、多寫 D1）。

**R0（回滾前，唯讀）**：快照帳號與合併關係，給第 4 步用。

```bash
q "SELECT actor, uid, merged_into FROM bounty_points" > tmp/rollback_points_before.json
```

**R1：cron 先退回兩條**。從**回滾目標那顆 sha**（E0 之前正式站跑的 main，目前是 `ef09beef`；以 E0 當時的 `deployments list` 為準）的乾淨樹跑 `triggers deploy`，步驟同 5.8 第 3 點。那份 `wrangler.jsonc` 的 crons 是 `["* * * * *", "15 1 * * *"]`。F 還沒做的話這步可以跳過。

**R2：退 Worker**：

```bash
VER='填 E0 那一次產生的版本 id'
w versions deploy "$VER@100%" --yes
```

- 回滾目標**寫死成 E0 產生的那個版本**（5.4 第 4 點判定不用做 E0 時，是 C 當時正在跑的版本）。不要從 `deployments list` 隨手挑「上一個」：再往前的版本沒有 `BOUNTY_WRITES=off`，舊程式的 claim／submit 會重新開放。

**R3：唯讀確認**：C 的第 13 行要 503 `bounty_paused`；C 的第 15 行（cf_get.mjs）要只剩兩條 cron；`curl -sS https://railisland.tw/ | grep -o "const BUILD = '[^']*'"` 要是舊的 BUILD。

**R4：隱私補刪**（`schema/0014_bounty_v2.sql` 檔頭第 17–21 行）：舊版的刪帳號只刪 `bounty_samples`、`bounty_claims`、`bounty_points`（`ef09beef` 的 `worker.js:7120` 起），不認得四張 v2 表，也不認得判定出錯記錄（kv_blobs 的 `bounty_verify_strike|<actor>|<乘車日>|<車次>`，v2 的 `worker.js:7534-7539` 才刪）。**刪帳號沒有暫停開關**，所以回滾期間有人刪帳號，這幾樣會留下來。回到 v2（或決定不回去）之前補刪：

```bash
q "SELECT actor, uid, merged_into FROM bounty_points" > tmp/rollback_points_after.json
cat > tmp/rollback_orphans.mjs <<'EOF'
// 回滾期間被舊版刪帳號刪掉的身分＝回滾前快照有、現在沒有的 bounty_points 列（舊版只有刪帳號會刪這張表的列）。
import fs from 'node:fs';
const rd = f => { const s = fs.readFileSync(f, 'utf8'); return JSON.parse(s.slice(s.indexOf('[')))[0].results.map(r => r.actor); };
const now = new Set(rd('tmp/rollback_points_after.json'));
const gone = rd('tmp/rollback_points_before.json').filter(a => !now.has(a));
if (gone.some(a => !/^[A-Za-z0-9_-]{1,64}$/.test(a))) throw new Error('actor 格式不對，停手');
console.log(`回滾期間被刪的身分 ${gone.length} 個：${gone.join(' ')}`);
const L = gone.map(a => `'${a}'`).join(',');
const W = {
  chip_ledger: `actor IN (${L})`, garage_unlocks: `actor IN (${L})`, cloud_rides: `actor IN (${L})`, bounty_seg_contrib: `actor IN (${L})`,
  kv_blobs: `k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}' AND substr(k, 22, instr(substr(k, 22), '|') - 1) IN (${L})`,
};
const out = (f, fn) => fs.writeFileSync(f, gone.length ? Object.entries(W).map(fn).join('\n') + '\n' : '');
out('tmp/rollback_orphans_count.sql', ([t, w]) => `SELECT '${t}' AS t, COUNT(*) AS n FROM ${t} WHERE ${w}`);
out('tmp/rollback_orphans_delete.sql', ([t, w]) => `DELETE FROM ${t} WHERE ${w}`);
EOF
node tmp/rollback_orphans.mjs
while IFS= read -r s; do q "$s"; done < tmp/rollback_orphans_count.sql
```

- 前面都是唯讀。看過計數、拿到 go，才跑寫入那一行：`while IFS= read -r s; do q "$s"; done < tmp/rollback_orphans_delete.sql`。
- `substr(k, 22, …)`：前綴 `bounty_verify_strike|` 是 21 個字，actor 從第 22 個字開始，到下一個 `|` 為止（同 `bountyStrikeParts`，`worker.js:8730`）。
- 本機 SQLite 驗過：快照有三個身分、回滾後少了兩個，產出的 SQL 只刪那兩個的籌碼與出錯記錄，第三個身分與 kv_blobs 其他鍵不動。
- 涵蓋不到的：快照之後才出現、又在回滾期間被刪的身分。E0 到 H 之間寫入總閘關著，v2 四張表只有判定 cron 會寫（`chip_ledger` 的 trip、`bounty_seg_contrib`）。判定寫入時那個身分有沒有一定有 `bounty_points` 列，沒查過，所以這一型算已知漏洞。
- 合併：舊版的 `bountyMerge` 也不搬四張 v2 表，回滾期間合併的裝置，籌碼與解鎖會留在裝置名下。回到 v2 後同一個 uid 再呼叫一次合併會搬（`worker.js:7342-7343` 的說明），App 會不會自己再呼叫，沒查。

### 5.8 cron（步驟 F0、F）

**F0：D1「每次呼叫的查詢數」要在 F 之前處理**。付費方案一發的子請求上限 10,000；D1 限制頁另寫「每次呼叫 1000 句」，官方沒寫清楚 batch 裡的每一句算不算（auto-memory `workers-cron-subrequest-wallclock-limits`）。第一發估值約 95 次 D1 呼叫、其中約 90 次是 batch，若每句都算約 7,300 句。判定會在預算用盡時停在可續跑的地方，**估值本身沒有這種邊界**（計畫書 §12.1 第 7 項）。二選一，由主線決定：

- **選項一（建議）：F 之前用預覽 Worker＋獨立 D1 量一次**。要另外寫：一份只給量測用的 wrangler 設定（不同的 Worker 名字、綁一個新建的 D1，`d1 create` 是寫入）、套 0001–0016、灌一份與正式同量級的板與樣本、用暫時的 cron 觸發一發，看估值那一行跑完沒有、Cloudflare 記的子請求數；量完刪掉 Worker 與 D1。**這個沒有現成腳本**，是一件獨立的工作。好處是失敗只發生在量測環境。
- **選項二：F 第一發就是實驗**。E0 時一起設 `printf 900 | w secret put BOUNTY_SUBREQ_BUDGET`（E0 之後再設會多出一個版本，回滾目標要跟著改成最後那一個）。G 要看到估值那一行的「重算」約 3533（`worker.js:8176-8195`：重算＝板上沒退場、沒收滿的每一列，第一發應該就是新清單的 3533 個單位）、`valuationOk.at` 是當天。估值若中途丟錯（每句都算、超過上限），已經提交的 batch 不會回滾，板會停在半套；之後怎麼收拾這台沒驗過。

**F：加判定 cron**

1. 一顆 commit：`wrangler.jsonc` 的 `triggers.crons` 加 `"30 19 * * *"`（台北 03:30；程式常數 `BOUNTY_CRON`，`worker.js:8737`；分支在 `worker.js:10318`，只跑估值＋判定然後 return，不會落進每日 ingest），**同一顆**在 `scripts/check_deploy_config.mjs` 的 `REQUIRED_CRONS`（第 29 行）補一條說明，不然 ship-web 2.6（第 192 行）會擋。**`15 4 * * *` 永遠不加回**（`wrangler.jsonc:88-98`）。
2. 這顆照常 push、`npm run ship-web` 出貨（index.html 沒變，BUILD 防撞不會擋），讓正式站跑的就是這顆 sha。不要讓 cron 的 commit 跟 E 擠在同一發：依 Cloudflare 文件 cron 不跟著 `versions upload` 走，但這台沒實測過；分開出就不會在 F0 決定之前意外開了判定。
3. **從出貨那顆 sha 的乾淨樹跑 `triggers deploy`**。它是整包 PUT：cron 那份清單整包取代正式的（wrangler 原始碼「PUT will override previous schedules」），連 `routes` 的 custom domain 也重送一次。所以那棵樹的 `wrangler.jsonc` 必須就是正式站的那一份。ship-web 出完會把自己的乾淨樹刪掉，另開一棵：

```bash
SHA='填出貨那顆 sha'
WT="$PWD/tmp/trig-$SHA"
git -C "$PWD" rev-parse --verify "$SHA^{commit}" && git -C "$PWD" worktree add --detach "$WT" "$SHA" && ln -sn "$PWD/node_modules" "$WT/node_modules" && (cd "$WT" && grep -n '"crons"' wrangler.jsonc && arch -arm64 node ./node_modules/wrangler/bin/wrangler.js triggers deploy)
git -C "$PWD" worktree remove --force "$WT"
```

4. 唯讀確認：C 的第 15 行（cf_get.mjs）要剛好三條：`* * * * *`、`15 1 * * *`、`30 19 * * *`。

- 第一發會做什麼：估值把新清單上架（本機 3533 單位、267 張卡），判定處理所有前一營運日以前的 pending 樣本（5.1 第三點、5.4 第 1 點）。子請求本機量到 101（空庫）。程式預設預算 `BOUNTY_SUBREQ_BUDGET` 8000。
- E 跟 F 可以分開出：E 出了、F 還沒做，看板只有正式庫現在那批舊列（或空板），不會有新單位。

### 5.9 env／secret、單位檔與退場守門

都不在 `wrangler.jsonc` 的 `vars` 裡（現在只有兩個 FIRESTORE 變數）。**一律用 secret**（5.1 第二點）。

| 名稱 | 上線時的值 | 作用 | 沒設的行為 |
|---|---|---|---|
| `BOUNTY_WRITES` | E0 設 `off`；H 才拿掉或設別的值 | `off` 時 claim／submit／cloud-ride／garage-redeem 回 503 `bounty_paused`（`worker.js:7013 7110 7647 7873`）；chips-me、看板、**判定 cron、`bounty-merge`** 照常 | **寫入全開**（只認 `off`，`worker.js:7079`） |
| `BOUNTY_CLAIMABLE_FROM` | H 當天設（L2 起算時間，毫秒） | 估值的 L2 時間分量從這天起算；已有 `first_claimable_at` 的列不吃它（5.4 第 2 點） | L2 恆 1 |
| `BOUNTY_SUBREQ_BUDGET` | 選項二設 900 | 判定的子請求預算 | 8000 |
| `BOUNTY_BYTES_BUDGET` | 可選 | 判定讀取量預算 | 128 MB |
| `BOUNTY_WALL_BUDGET_MS` | 可選 | 牆鐘預算，會被壓在租約內 | 程式預設 |
| `BOUNTY_RETIRE_ACK` | 只在退場守門擋下、確認是真換班表時設 | 放行那一份清單 | 擋下時估值停擺 |
| `BOUNTY_NOW`、`BOUNTY_VERIFY_ORDER` | **正式不要設** | 測試鉤 | — |

- **設 secret 的實際行為**（wrangler 4.111 原始碼）：`secret put` 拿正在跑的版本加上新 secret，產生新版本並立刻部署；最新上傳的版本沒部署時，API 回 10215 拒絕。`versions secret put` 複製最新上傳的版本、不部署。E0 之後每多設一個 secret 就多一個版本，**回滾目標要跟著換成最後設 off 的那一個**。
- **`scripts/ship_web.mjs:35` 的描述要訂正**：它寫「`wrangler secret put`（會把最新上傳的版本升上線）」，跟上面的行為不符（不是升最新上傳的版本；最新上傳的版本沒部署時是直接被拒）。這次只改文件，那行沒動，列為後續。
- 網頁 `BOUNTY_ENABLED` 不是 Worker 變數：現在只能靠網址 `?bounty=1`（`index.html:15427`）打開，預設打開要改程式、另外出一版。

**單位檔與退場守門**：

- 單位檔出貨當天重產（5.2 第 3 點）。
- 退場守門（`worker.js:7997`、`8067` 起）：板上現役列裡「新清單沒有的」至少 10 列、而且超過那個系統的一成或那條線的一半，就整發估值中止、板不動、`retireBlock` 帶出訊息。
- 模擬（`guard_sim.mjs`，照守門的算法）：拿 main 在 `864dd16f`（07-28）與 `5efc5803`（07-29）的單位檔當「板上現役列」，對這次重產的清單：退場 208 列（全是台鐵）、新增 94 列，**沒有任何系統或線過門檻，不會擋**。假設正式板＝那兩份清單之一；C 的 04 對不上，就把正式板匯出成同樣形狀重跑 `guard_sim.mjs`。板若是空的就沒有東西可退。
- **擋下了怎麼辦**（原在計畫書 §12.1 第 6 項）：log 會出現 `[cron bounty 估值] 失敗: bounty_units shrink: …`，逐項列出 `<系統> <要退場>/<現役>` 與 `<系統>|<線> <要退場>/<現役>`。
  - 擋下期間整個估值停擺、所有系統一起停：新單位不上架，per_day、L1／L2 不重算，收滿不補寫。同一發的判定照跑，用上一次估值的板價；只有整組都不在板上的新段會吃虧（停擺期間判成 0 點、判過不再重判），所以當天或隔天就要處理。
  - 先查單位檔與它的六個輸入檔是不是殘缺（上游回了殘缺的班表或軌道、建錯樹出貨）；是的話修好輸入、重建、重新出貨。
  - 確認是真的換班表（停駛、大改點），才把 secret `BOUNTY_RETIRE_ACK` 設成錯誤訊息裡的 `generatedAt`（照數字原樣，前後空白換行不算，寫成 `3.0` 這類不算數）。只對那一份清單有效。設 secret 會產生並部署新版本，回滾目標要跟著換（上一點）。
  - 訊息寫「清單沒有 generatedAt」：這份清單不是建置腳本產的，沒有任何 ack 放得行，重建再出貨。

### 5.10 上線後巡檢（步驟 G，原在計畫書 §12.1 第 6 項）

每天看一次，至少到 H 之後一週：

- `30 19` 那發的兩行 log：`[cron bounty 估值] 新上架 N, 退場 M, 重算 X…`、`[cron bounty 驗證] …`。判定那一行看：子請求數、「讀取 X MB（N 列）」、`預算用盡`（子請求、牆鐘、讀取量三種）、「班判定出錯」、「截斷」、「可信身分的班車用到份額」，並對照 Cloudflare 後台的實際用量。選項二要看到「重算」約 3533。
- `curl -sS https://railisland.tw/api/bounty-board` 的 `valuationOk.at` 是當天、`retireBlock` 是 null。
- 出錯記錄：`q "SELECT k, v FROM kv_blobs WHERE k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}'"`。值是 `{at, error, n}`；n≥2 的每一發排最後，要人工看。n 開始長，先查 `sqlite_master` 的索引（索引不在時是安靜的失敗：認領、合併回 503，判定逐班記出錯）。
- 誤判率：`q "SELECT verdict, reject_code, quality_code, COUNT(*) AS n FROM bounty_samples GROUP BY 1, 2, 3"`。`impossible_physics`、`doppler_too_clean` 的比例明顯高於幾個百分點，先抽幾趟看是不是誠實錄程。
- **刪帳號**：Cloudflare 後台的 Workers 日誌看 `/api/account-delete` 有沒有 502。F 之後的第一個工作天，用另一個測試帳號照 5.6 E-2 再實刪一次。
- 併發的唯讀抽查（假 D1 在 batch 之外的單句寫入可以插進別的 batch 中間，真 D1 不會，所以離線的併發判準只證明「序列化之後的交錯」安全）。上線後各查一次：
  - auth：B6 那一句（C 的 05）；籌碼落在沒有帳號列的 uid 底下；
  - cloud：同一營運日兩列、重複的雲端籌碼 ref；
  - merge：重複的退款列、對不上的 nth、被減兩次的 `distinct_ok_users`；
  - redeem：重複的 redeem 列、對不上的 nth、餘額變負。

### 5.11 H 之前要先有的（不屬於這次整併，列出來免得漏）

- **App 要先出一版指向 `railisland.tw` 的懸賞**。原生 repo 另一條線正在做：分支 `claude/adoring-brattain-cd4004`（origin 在 `bd0355cd7`，比原生 origin/main `83a195b69` 多 3 顆，其中 `7e310353a` 是「正式版懸賞連正式站」）。那一版上架之前開 H，App 端用不到。
- 計畫書 §12.1 第 5 項：D-T1 網頁改動、防偽閘第 2 關從沒跑過、純停靠錄程給不給籌碼、用真錄程校門檻、都卜勒第四重要判可疑還是影子模式。
- 上面這些之後才設 `BOUNTY_CLAIMABLE_FROM`、拿掉 `BOUNTY_WRITES=off`、把網頁 `BOUNTY_ENABLED` 預設打開。

## 6. 沒做、沒驗、不確定

- 正式環境做過 C 的唯讀盤點與 D 的補套（10-25，5.3、5.5）；E0 以後一步都沒做。帳號方案 API 查不到，要到後台看（5.4 判讀第 6 點）。
- 帶 Bearer 的路徑、真錄程的判定結果，本機實打沒蓋到（3.6），只靠離線套件；刪帳號在正式庫的實測排在 E-2。
- 遠端 `d1 execute --file` 是不是整檔一筆交易、每支檔要套多久，沒驗（5.5）。
- `versions upload` 會不會帶 cron triggers，沒實測，照文件寫成要另外 `triggers deploy`；F 刻意跟 E 分開出（5.8）。
- `triggers deploy` 在另開的乾淨樹（node_modules 用符號連結）跑，這台沒實測（5.8）。
- 正式庫有同名 plain var 時 `secret put` 會怎樣，沒查（5.4 第 4 點）。
- D1「每次呼叫的查詢數」怎麼算，官方沒寫清楚，F0 二選一（5.8）。
- 回滾補刪漏掉「快照之後才出現、又在回滾期間被刪」的身分（5.7 R4）。
- `scripts/ship_web.mjs:35` 與 `schema/0014_bounty_v2.sql:3` 的註解錯誤、`scripts/verify_remote_schema.mjs:168` 對缺欄一律建議重套建表那支，都只寫在這裡、沒改（5.5、5.9）。
