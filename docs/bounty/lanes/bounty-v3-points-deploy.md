# 校正懸賞 v3（點數制）部署清單

> **P0、P1 已在 10-27 執行**（經使用者 go，結果寫在第 1、2 節末；0017 已套上正式庫）。P2 之後一步都還沒執行。每一個 `--remote`、`ship-web`、`secret put`、對正式站的請求（連唯讀查詢也算）都是對外動作，逐步等 go。
> 規格：`docs/bounty/contract-v3.md`（第 8 節是上線順序的理由）。共用的工具與機制沿用 `docs/bounty-v2-merge-handoff.md` 第 5 節，這裡不重抄，只寫 v3 不一樣的地方。

## 0. 一眼看完

| 步驟 | 動作 | 寫正式環境？ | 退路 |
|---|---|---|---|
| P0 | 唯讀盤點：schema、現行版本＝**V0**、寫入總閘、帳本規模 | 只讀 | — |
| P1 | 正式 D1 套 `0017`（兩句 `ALTER`，只加欄） | 是 | 只加不刪；v2 照常運作 |
| P2 | 出貨前本機準備：日期、BUILD、重產單位／路段檔、全部閘門、併 main（隱私權政策入口句在同一顆裡） | 本機＋公開 repo | — |
| P3 | `ship-web --preview` 上傳預覽，使用者本人在瀏覽器看（含隱私權政策中英日） | 上傳一個不上線的版本 | 不升版就沒事 |
| P4 | `ship-web` 上線 | 是 | 第 7 節 |
| P5 | 上線後檢查（唯讀，含隱私權政策中英日） | 只讀 | 第 7 節 |
| P6 | 開寫入總閘（P4、P5 都過了才做），開閘後看帳本 | 是（`secret put` 產生新版本並立刻上線） | 第 7 節第 1 步凍結寫入 |

順序的硬條件：

- **P1 一定早於 P3、P4**：v3 每一句讀寫帳本與解鎖的 SQL 都提到 `unit`，沒這一欄 chips-me、garage-redeem、cloud-ride 一律 503，判定 cron 入帳那一句丟錯（`schema/0017_bounty_points.sql` 檔頭）。ship-web 2.4（`verify_remote_schema`）會擋，但不要靠它。
- **P1 對還在線上的 v2 無害**：v2 寫帳本與解鎖的 INSERT 全部明列欄位（base `7c8924be` 的 `worker.js:7408 7702 7709 7848 8663`），新欄位吃預設值 `'chip'`，正好是 v2 寫的單位。
- **換算列只能由 v3 寫**：v2 把 Σdelta 當籌碼餘額，看到換算列（`kind='adjust'`、ref `v3points|…`）會以為那個人多了 49 倍籌碼。所以換算不在 migration 裡做，P3 預覽時也要避開（第 4 節）。
- 規則檔（`data/bounty_rules.json`）、路段檔與 Worker 在同一個版本裡一起上，沒有「新程式配舊規則」的中間狀態。
- **P6 開寫入總閘排在 P4、P5 都過了之後**：總閘從 10-25 v2 上線時（v2 交接檔 5.6 E0）就關著，P0–P5 都沒有開它的步驟，v3 上線後還是關著。開閘之前 v3 收不到錄程與兌換，出事退回 V0 還安全；開閘之後一有 `unit='point'` 的列就退不回 v2（第 7 節）。
- **隱私權政策入口句跟 v3 同一次上傳**（10-27 加進來）：`privacy.html:58` 粗體那句與英日翻譯（`i18n/legal-translations.js:84`、`:166`；這個檔拿整句中文當鍵，三處要一起改）從 v2 的「護照 →「校正貢獻」→ 懸賞板 → 挑一段路段」改成 App 1.7.3 的流程：護照 →「校正懸賞」→「找任務」→ 選起站和訖站 →「接下這班」→「開始錄製」。按鈕字照 native `8e6b399ff` 的 `ios/RailBoardWidget/Localizable.xcstrings`（中英日），Android 畫面用的是同一組中文字。
  - 跟 v3 同一次上傳：這只是靜態頁與翻譯字典的字，沒有執行期效果，不增加 P4 的風險，也省掉多出一次 BUILD 與全套閘門。
  - 生效日維持 10-25：什麼時候取位置、上傳什麼都沒變，換的只是按「開始錄製」之前的步驟；本頁自己寫的是資料處理方式有重大改變才更新生效日（`privacy.html:139`）。這句後面的實質內容、第 122 行刪帳號的範圍都沒動。
  - 要分開只有一種情況：1.7.3 要在 v3 上線之前送審，又不想讓審查看到舊入口。那就先從 main 單獨出這顆（一樣等使用者 go），正式站在 V0 之後多一版，第 7 節的回滾目標改成那一版；P2–P5 照舊（這顆已經在 main 裡）。

## 1. P0 唯讀盤點

工具同 v2 交接檔 5.3：

```bash
mkdir -p tmp/v3deploy
w() { arch -arm64 node ./node_modules/wrangler/bin/wrangler.js "$@"; }
q() { w d1 execute DELAY_DB --remote --json --command "$1"; }
node scripts/verify_remote_schema.mjs 2>&1 | tee tmp/v3deploy/01_schema.txt
w deployments list 2>&1 | tee tmp/v3deploy/02_deployments.txt
w versions list 2>&1 | tee tmp/v3deploy/03_versions.txt
w secret list 2>&1 | tee tmp/v3deploy/04_secrets.txt
q "SELECT kind, COUNT(*) AS n, SUM(delta) AS s FROM chip_ledger GROUP BY kind" | tee tmp/v3deploy/05_ledger.json
q "SELECT COUNT(*) AS n FROM chip_ledger WHERE kind='adjust' AND substr(ref,1,9)='v3points|'" | tee tmp/v3deploy/06_no_conversion_yet.json
q "SELECT COUNT(*) AS n, SUM(cost) AS s FROM garage_unlocks" | tee tmp/v3deploy/07_unlocks.json
curl -sS -X POST -H 'content-type: application/json' -d '{}' -w ' HTTP %{http_code}\n' https://railisland.tw/api/bounty-claim | tee tmp/v3deploy/08_writes_gate.txt
```

| 輸出 | 要看到什麼 |
|---|---|
| 01 | 只缺 `chip_ledger.unit`、`garage_unlocks.unit` 兩項。缺別的：先照 v2 交接檔 5.5 補，不要在這條線代套 |
| 02 | 現在正在跑的版本 id，寫下來＝**V0**（第 7 節的回滾目標） |
| 03 | 最新上傳的版本是不是就是 V0。不是：有別條線 `--preview` 上傳過，之後的 `secret put` 會被拒（錯誤碼 10215），回滾時別用「最新版本」 |
| 04、08 | 寫入總閘現況：08 回 `503 bounty_paused`＝關著；`400 bad_actor`＝開著 |
| 05、07 | 換算規模：`trip`／`cloud`／`redeem` 的籌碼總數 × 50 就是上線後會出現的點數量級 |
| 06 | 要是 0。不是 0：有人在 v2 線上時寫過換算列（例如預覽時寫的），先停手查 |

#### 10-27 實跑結果（08:03 台北，經使用者 go；原始輸出在本線樹的 `tmp/v3deploy/`，被忽略）

| 輸出 | 結果 |
|---|---|
| 00 | `wrangler whoami`：這台登入的 Cloudflare 帳號，OAuth，有 D1 與 Workers 的寫入權限 |
| 01 | rc=1，只缺 `chip_ledger.unit`、`garage_unlocks.unit` |
| 02 | **V0＝`db880f91-8987-4e4b-a4ea-02986d142a94`**（100%，10-25 21:57 台北上線） |
| 03 | 最新上傳的版本就是 V0，沒有別條線的預覽版 |
| 04、08 | 有 `BOUNTY_WRITES`；08 回 `503 bounty_paused`，寫入總閘關著 |
| 05、07 | 兩張表都是 0 列，換算規模是 0 |
| 06 | 0 |

## 2. P1 套 0017

時段同 v2 交接檔 5.5：台北 01:30–03:00 之類的低流量時段，避開 03:30（判定 cron `30 19`）與 09:15（每日 ingest `15 1`）。
ALTER 是毫秒級，真正要避的是 03:30 那一發判定（它會寫 `chip_ledger`）：台北 03:20 前送完，過了就改隔天。

兩句 `ALTER` 用 `--command` 一句一句送，不用 `--file`（`--file` 走 import，套用期間整個正式庫停服務）；01 的 `verify_remote_schema` 印出的 `--file=schema/0017…` 補法也不要照做。
`--command` 不會跳確認，按下去就執行，送之前先核對。內容與 `schema/0017_bounty_points.sql:18-19` 一字不差，送之前 `grep -c '^ALTER' schema/0017_bounty_points.sql` 要是 2：

```bash
q "ALTER TABLE chip_ledger ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip'"
q "ALTER TABLE garage_unlocks ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip'"
```

套完（唯讀）：

```bash
node scripts/verify_remote_schema.mjs 2>&1 | tee tmp/v3deploy/11_schema_after.txt
q "SELECT unit, COUNT(*) AS n FROM chip_ledger GROUP BY unit" | tee tmp/v3deploy/12_ledger_units.json
q "SELECT unit, COUNT(*) AS n FROM garage_unlocks GROUP BY unit" | tee tmp/v3deploy/13_unlock_units.json
q "SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('chip_ledger','garage_unlocks')" | tee tmp/v3deploy/14_ddl.json
```

11 全綠；12、13 只有 `chip` 一列，筆數等於 P0 的 05、07；14 兩張表的 DDL 文字都含 `unit TEXT NOT NULL DEFAULT 'chip'`（D1 不准 `pragma_table_info`，只能看 DDL）。
重送任一句會報 `duplicate column name: unit`，無害，代表已經套過；第一句成功、第二句失敗時，只重送第二句。

#### 10-27 實跑結果（08:10 台北，經使用者 go 在早上送，不在上面的夜間時段，離 03:30 判定與 09:15 ingest 都遠；原始輸出同上）

| 步 | 結果 |
|---|---|
| 送前 | 要送的字跟 `0017` 第 18、19 行一字不差；`verify_remote_schema` rc=1、只缺這兩欄；兩張表 0 列、換算列 0。Time Travel 送前書籤 `000008d2-00000ac6-00005111-0650c0cb985f3981feb81c4cbef427a7` |
| 送 | 兩句各用 `--command` 送一次（08:10:45），都是 rc=0、`success: true` |
| 送後 | 11 rc=0：20 支 migration、24 張表、223 欄、12 個 `INDEXED BY` 索引都在；12、13 是空集合（兩張表本來就是 0 列，筆數照舊）；14 兩張表的 DDL 都在 `created_at` 後面接上 `unit TEXT NOT NULL DEFAULT 'chip'` |

書籤只是留底：0017 不用退（第 7 節），Time Travel 還原會把那一刻之後整個庫的寫入一起丟掉。

## 3. P2 出貨前本機準備

1. 先跟 main 對齊：`git log --oneline HEAD..origin/main` 不是空的就併進來（主線做）。
2. **更新紀錄日期**：`index.html` 兩處 `<span class="d">10/26</span>`（最近更新 `data-cl-of="bountypoints"`、完整歷史 `data-cl="bountypoints"`）與 `最後更新：2026/10/26` 改成實際上線那天。
   - main 在這之間若也加了更新紀錄：最近更新最多 8 條（多出來的拿掉最舊那條，它在完整歷史裡還有一份），`scripts/verify_changelog_browser.mjs` 的 `expectedHistoryCount`＝main 那時的數字＋1。
3. **BUILD**：`index.html` 的 `const BUILD` 遞增成上線日的新版號，不能跟正式站一樣（ship-web 第 4 步會擋「內容不同、BUILD 相同」）。
4. **單位檔與路段檔當天重產**：`npm run build-bounty-units`（同一支寫 `data/bounty_units.json` 與 `data/bounty_sections.json`）。
   - 只有 `generatedAt` 變：兩個檔都不要 commit。
   - 還有別的變了（台鐵班表每週重抓，自強停靠數會影響區段邊界）：兩個檔一起 commit，再跑 `node scripts/build_data_manifest.mjs` 一起 commit。
   - 終端印出的每條線段數與最短／最長段要對得上 `docs/bounty/lanes/bounty-v3-points-handoff.md` 第 4 節的例外清單，新冒出來的例外要先看懂。
5. **兩個資料檔要在出貨那顆 commit 裡、`.assetsignore` 沒擋**：ship-web 從 `git worktree add --detach <sha>` 建的乾淨樹上傳（`scripts/ship_web.mjs:95-96`），沒 commit 的檔不會上去；`data/bounty_sections.json` 是新檔，最容易漏。`.assetsignore` 是 gitignore 語法、對 assets 目錄 `.`（`wrangler.jsonc:149-151`），用一個空 repo 套它的規則來問：

```bash
git ls-tree --name-only <要出的那顆 sha> -- data/bounty_rules.json data/bounty_sections.json
d=$(mktemp -d) && git -C "$d" init -q && cp .assetsignore "$d/.gitignore" && git -C "$d" check-ignore --no-index -v data/bounty_rules.json data/bounty_sections.json; echo "rc=$?"
```

   - 第一句要印出兩個路徑。第二句什麼都不印、`rc=1`（1＝兩個都沒被擋；被擋會印出 `.assetsignore` 的行號）。
   - 本線在這條分支跑過：兩個都沒被擋；同一句問 `data/place_index.json` 與 `schema/0017_bounty_points.sql` 會印出第 103 行與第 26 行、`rc=0`，證明它真的在讀規則。
   - 路段檔不在 `data/data_manifest.json` 裡是正常的：清單只收 `index.html` 會載入的檔（`scripts/build_data_manifest.mjs:21-25`），網頁不讀路段檔。
6. 閘門，全部要綠：

```bash
node scripts/verify_bounty_all.mjs
npm run check-copy
npm run check-copy-browser
npm run check-i18n
npm run check-i18n-browser
npm run check-manifest
node tmp/v3deploy/privacy_check.mjs .
```

   - 最後一句是隱私權政策那句（第 0 節）：中英日三個語言實際打開 `privacy.html`，新句各 1 處、舊字 0 處、英文頁 `main` 沒有中文、沒有 pageerror，三行都要 `ok`。腳本在本線樹的 `tmp/v3deploy/`（被忽略），從這棵樹供檔、不起 server；`check-i18n` 管的是三處的鍵對得上。
   - 本線 10-27 在這條分支跑過：`check-i18n`、`check-i18n-browser` 綠，`privacy_check` 三行 `ok`；同一支對 base `7c8924be` 的三個檔跑是三行 `BAD`（新句 0、舊字 1），證明它分得出新舊。

7. 併進 main 由主線做（這條線不 push main）。

#### 10-27 實跑結果（18:5x 台北，經使用者 go；原始輸出在本線樹的 `tmp/v3deploy/` 5x 開頭的檔，被忽略）

- 第 1 步：origin/main 還是 base `7c8924be`，不用併。正式站仍是 V0（`db880f91`，也是最新上傳）；沒有別發 ship-web 在跑、沒有鎖檔。
- 第 2、3 步：更新紀錄兩處與「最後更新」改成 10/27；BUILD `v1025a` → `v1027a`（正式站是 `v1025a`）。
- 第 4 步：班表日 2026-10-25，21 條線 83 段、8–30 km 以外 14 段，跟交接檔第 4 節相同；兩個檔跟 commit 裡的比只差 `generatedAt`，照規則不 commit。
- 第 5 步：`.assetsignore` 沒擋兩個資料檔、`privacy.html`、`i18n/legal-translations.js`（`rc=1`）；對照組 `data/place_index.json`、`schema/`、`docs/` 有被擋（`rc=0`）。
- 第 6 步：全綠。`verify_bounty_all` 18 支 1903 條、`check-copy`（最近 8 條、完整歷史 524 條）、`check-copy-browser`、`check-i18n`、`check-i18n-browser`（36 個情境）、`check-manifest`（41 個資料檔）、`privacy_check` 三語 `ok`。

## 4. P3 預覽

```bash
npm run ship-web -- --ref <要出的那顆 sha> --preview
```

- 這一步就是「`wrangler versions upload`」：ship-web 先去註解再上傳。**不要直接跑 `wrangler versions upload`**，會把沒去註解的原始檔傳上去（`scripts/ship_web.mjs` 檔頭）。
- 預覽網址在 Cloudflare Access 後面，curl 與 Playwright 只拿得到登入頁，只有使用者本人開得起來。
- 🔴 **預覽版本用的是正式 D1 與正式 secret**。寫入總閘開著的時候，用「有 v2 籌碼的帳號」登入打開護照，預覽版的 chips-me 會替那個帳號補換算列，而線上還是 v2：那個帳號在 v2 會變成 50 倍籌碼。所以預覽時：
  - 用沒有 v2 籌碼的帳號登入（新帳號最安全），或先確認 P0 的 08 是 `503`；
  - 不按兌換、不從預覽觸發雲端搭乘；
  - 預覽之後決定不上線，回頭用第 1 節的 06 那句確認沒有換算列。
- 上傳之後「最新上傳的版本」就不是 V0 了，P3 到 P4 之間的 `secret put` 會被拒（10215），這段期間不要動寫入總閘。P4 把新上傳的版本切上線之後就恢復，開閘在 P6。

使用者在預覽看的東西（網頁的懸賞介面要網址帶 `?bounty=1` 才出現，英日文再加 `&lang=en`／`&lang=ja`；`BOUNTY_ENABLED` 只認它與 `?demo=bounty`，`index.html:15428`。隱私權政策不用帶）：

| 位置 | 應該看到 |
|---|---|
| 懸賞板副標 | 「合格的一趟照沿線里程得到島民點數，每天有上限」那一句 |
| 南迴、臺東線的卡片 | 「島民點數 ×2」 |
| 出發前說明卡 | 「1 公里 1 點」「這條線的島民點數 ×2」「每天最多 500 點」；合格那句是「沿線至少移動」 |
| 護照（登入） | 點數列：「島民點數」與餘額、「下一座場景要 200 點」、「雲端搭乘 N 次・每天一次 20 點」、「錄程每天最多 500 點」 |
| 更新紀錄 | 最上面一條是點數制那一條，日期是當天 |
| 英文、日文介面 | 同上各句的翻譯（島民點數是 Islander Points／島民ポイント），沒有 chip／チップ |
| 隱私權政策 `/privacy.html`、`?lang=en`、`?lang=ja` | 「定位資料」清單最後一條（校正旅程）的粗體句：中文「護照」→「校正懸賞」按「找任務」、選好起站和訖站並按「接下這班」，再按「開始錄製」；英文 Passport → Calibration bounties… “Find a task”… “Take this train”…；日文「パスポート」→「校正懸賞」で「任務を探す」…「この列車にする」…。生效日還是 2026 年 10 月 25 日 |

#### 10-27 實跑結果（台北，經使用者 go；原始輸出在本線樹的 `tmp/v3deploy/` 60–67 開頭的檔，被忽略）

- 第一次（19:0x，`--ref f70adb41`）停在機捷車種閘門，沒有上傳：`scripts/verify_tymc_train_kind.mjs` 寫死主 checkout 的 node_modules 路徑，主 checkout 10-27 00:48 重裝成 playwright 1.48.2，它要的 chromium-1140 不在瀏覽器快取裡。
  改成從自己這棵樹載入 `playwright`，commit `9f38ba42`，兩支 14 PASS。其他把 node_modules 連到主 checkout 的樹，跑同一支閘門也會遇到。
- 第二次（19:18–20:03，`--ref 9f38ba42`）停在通行證閘門，沒有上傳：`verify_plus_subscription` 432/436，LT6 兩個引擎各收到一筆 console.error（某個資源回 503），Z0 那頁又一筆（所以 Z0b 摘除前後 2 → 3、K 也紅）。
  閘門自己的本機伺服器 `/api/*` 一律回 200；照同一個伺服器載入首頁，對外只連 OpenFreeMap 圖磚與捷運 Core 的 Worker（`tmp/v3deploy/probe_503.mjs` 實測，都是 200），503 是其中一個當下回的，事後分不出是誰。同一棵樹單獨重跑 436/436。
- 第三次（20:0x–20:39，`--ref 9f38ba42`）全部閘門過、上傳：版本 `f917938b-e237-4317-81e4-8a3b5dd6f29d`（20:39），BUILD `v1027a`，去註解後 md5 `7277a572094d2ead206e87dd37a854cc`。正式站仍是 V0，寫入總閘 `503 bounty_paused`。
- 使用者看過預覽六頁（中英日網頁帶 `?bounty=1`、隱私權政策中英日）後 go。

## 5. P4 上線

```bash
npm run ship-web
```

- ship-web 跑完全部閘門（含 2.4 正式庫 schema、懸賞總閘門），去註解、上傳、`versions deploy <這次上傳的 id>@100% --yes`、對正式站逐 byte 收貨。這一步就是「`versions deploy`」。
  一次切 100%，不要分流：v2、v3 同時在線，v2 會把 v3 寫的點數列當籌碼。
- 避開台北 03:20–04:00（判定 cron `30 19` 在跑）。
- 上線後 App 1.7.3 會照新的回應顯示數字，只是單位字眼還是舊的（`docs/bounty/contract-v3.md` 第 7 節）。P6 開閘之後 1.7.3 也照這樣入帳，不等新 App。

#### 10-27 實跑結果（21:07–21:12 台北，經使用者 go；原始輸出在本線樹的 `tmp/v3deploy/` 68、69、90 開頭的檔，被忽略）

- 上線前一刻重查：origin/main 仍是 `7c8924be`、是 `9f38ba42` 的祖先；正式站仍是 V0，最新上傳是 P3 的預覽版；沒有鎖檔、沒有別發 ship-web 在跑。
- main 快進 `7c8924be..9f38ba42`：這次由本線推（使用者在本線 go；第 3 節第 7 步原本寫主線做），推送閘門（追蹤檔基線、資料清單、更新紀錄文案）都過。
- `npm run ship-web`：上傳前、升版前兩次認正式站都是 `7c8924be`；新版本 **`15ae640a-509b-4af0-98d9-4e0d2d0a7323`**（21:12:44）一次切 100%。
  收貨：正式站逐 byte＝stripped(`9f38ba42`)、1907220 bytes、BUILD `v1027a`、API 200；去註解後 md5 跟 P3 預覽一樣是 `7277a572…`。
- 回滾目標仍是 V0 `db880f91`：P4 前一刻在跑的就是它。

## 6. P5 上線後檢查、P6 開寫入總閘

唯讀，上線後馬上跑：

```bash
curl -sS "https://railisland.tw/data/bounty_rules.json?cb=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).chips;console.log(JSON.stringify({unit:c.unit,perKm:c.perKm,cap:c.dailyChipCap,prices:c.prices,cloud:c.cloud&&c.cloud.points,rate:c.chipToPoints,remote:c.remoteMultiplier}))})'
curl -sS "https://railisland.tw/data/bounty_sections.json?cb=$(date +%s)" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const L=Object.values(j.lines);console.log("lines",L.length,"sections",L.reduce((a,l)=>a+l.length,0))})'
for f in bounty_rules bounty_sections; do echo "== $f"; curl -sSI "https://railisland.tw/data/$f.json?cb=$(date +%s)" | grep -iE '^(HTTP|content-type|cache-control|access-control-allow-origin|etag)'; done
e=$(curl -sSI https://railisland.tw/data/bounty_sections.json | grep -i '^etag' | sed -E 's/^[Ee][Tt][Aa][Gg]: *//' | tr -d '\r'); curl -sS -o /dev/null -w 'sections If-None-Match HTTP %{http_code} %{size_download} bytes\n' -H "If-None-Match: $e" https://railisland.tw/data/bounty_sections.json
curl -sS -o /dev/null -w 'board HTTP %{http_code} %{size_download} bytes\n' https://railisland.tw/api/bounty-board
A="v3check-$(node -e 'console.log(require("crypto").randomUUID())')"
curl -sS "https://railisland.tw/api/chips-me?actor=$A" -w ' HTTP %{http_code}\n'
for p in garage-redeem cloud-ride; do printf '%s ' "$p"; curl -sS -X POST -H 'content-type: application/json' -d '{}' -w ' HTTP %{http_code}\n' "https://railisland.tw/api/$p"; done
curl -sSL "https://railisland.tw/privacy.html?cb=$(date +%s)" | grep -o -e '「校正懸賞」按「找任務」' -e '校正貢獻」打開' | sort | uniq -c
curl -sSL "https://railisland.tw/i18n/legal-translations.js?cb=$(date +%s)" | grep -o -e 'Calibration bounties in the app' -e '「校正懸賞」で「任務を探す」' -e 'Calibration contributions in the app' | sort | uniq -c
node tmp/v3deploy/privacy_check.mjs https://railisland.tw
```

| 指令 | 應該看到 |
|---|---|
| 規則檔 | `{"unit":"point","perKm":1,"cap":500,"prices":[200,300],"cloud":20,"rate":50,"remote":2}` |
| 路段檔 | 與 P2 第 4 步重產時印出的線數、段數相同（本線產出時是 21 條線、83 段） |
| 兩個資料檔的標頭 | 都是 `HTTP/2 200`、`content-type: application/json`、`access-control-allow-origin: *`、`cache-control: public, max-age=0, must-revalidate`、有 `etag`。路段檔 404＝它沒進出貨那顆 commit（P2 第 5 步）。上線前的樣子（本線 10-26 唯讀量的）：規則檔就是這組標頭，路段檔 404（還沒上） |
| 帶 ETag 再讀一次 | `304`、0 bytes（10-26 對規則檔量過）：App 每次線上讀只是一次條件請求 |
| 看板 | 200 |
| chips-me（全新的裝置 id） | 200，`{"unit":"point","balance":0,"unlocked":[],"nextCost":200,"cloud":{"rides":0,"toNextChip":1,"points":20},"today":{"chips":0,"cap":500}}`。全新 id 沒有籌碼列，換算那句算出 0 不寫，所以這一發不寫庫（`v3check-` 加 UUID 共 44 字，符合 `isActorId` 的 `^[A-Za-z0-9_-]{8,64}$`） |
| 兩個寫入端點（body `{}`） | 寫入總閘開著：`400 bad_actor`；關著：`503 bounty_paused`。兩種都在碰 D1 之前就回 |
| 隱私權政策（中文頁） | 只有一行 `1 「校正懸賞」按「找任務」`；出現 `校正貢獻」打開`＝還是舊頁 |
| 法務翻譯字典 | `1 Calibration bounties in the app` 與 `1 「校正懸賞」で「任務を探す」` 兩行；出現 `Calibration contributions in the app`＝還是舊字典。出貨去註解不動字串（`scripts/strip_ship_comments.mjs` 檔頭），所以搜得到原字 |
| `privacy_check`（正式站） | 中英日三行都 `ok`、`rc=0`：真的打開三個語言的頁面看到那一句 |

#### 10-27 實跑結果（21:13 台北；`tmp/v3deploy/p5.sh`，輸出在同一處 70–81 開頭的檔與 `p5_summary.txt`，被忽略）

全部跟上表一樣：現行版本 `15ae640a`、BUILD `v1027a`；規則檔那串一字不差；路段檔 21 條線 83 段；兩個資料檔的標頭五項都對，帶 ETag 再讀 `304`、0 bytes；看板 200；
全新裝置 id 的 chips-me 跟上表那串一字不差；兩個寫入端點 `503 bounty_paused`（總閘照計畫關著）；隱私權中文頁與法務翻譯字典都只有新句；`privacy_check` 正式站三語 `ok`、`rc=0`。

快取設定不用改：`_headers:47-48` 對 `/data/*` 只加 CORS，沒給 Cache-Control，所以走靜態資產的預設 `public, max-age=0, must-revalidate`，每次讀都拿 ETag 回來驗，沒變就回 304。這兩個檔要跟 Worker 同時換（第 0 節），新 App 又會線上讀規則檔、內建一份當備援（N1 那條線）；只要給了 `max-age`，已經讀過的人到期前都拿著 v2 規則對 v3 伺服器。所以不要在 `_headers` 替這兩個檔加長快取。CORS `*` 是給 App 殼與網頁跨來源讀的（理由在 `_headers:40-46`），原生 HTTP 不看 CORS。

### P6 開寫入總閘

P4、P5 都過了才做；做的當下要使用者在本線明確授權（`secret put` 會產生新版本並立刻上線，是對外寫入）。時段同 P4，避開台北 03:20–04:00。
`worker.js:7079` 只認 `off`（不分大小寫），設成其他值或沒設都算開；這裡寫 `on` 只是讓人看得懂。

先看（唯讀）：

```bash
w deployments list 2>&1 | tee tmp/v3deploy/40_deployments.txt
w versions list 2>&1 | tee tmp/v3deploy/41_versions.txt
q "SELECT COUNT(*) AS n FROM kv_blobs WHERE k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}'" | tee tmp/v3deploy/42_strikes_before.json
```

- 40 正在跑的是 P4 上線的那一版（v3＋`off`），41 最新上傳的版本也是它。不是的話，代表有別條線上傳過預覽，`secret put` 會被拒（10215）：停手問，不要改用 `versions secret put`（同第 7 節第 1 步的前提）。
- 42 是下面 23 的基準。

開：

```bash
printf on | w secret put BOUNTY_WRITES
```

開完（唯讀）：

```bash
curl -sS -X POST -H 'content-type: application/json' -d '{}' -w ' HTTP %{http_code}\n' https://railisland.tw/api/bounty-claim | tee tmp/v3deploy/43_writes_gate_open.txt
w deployments list 2>&1 | tee tmp/v3deploy/44_deployments_after.txt
```

- 43 要是 `400 bad_actor`（跟 P0 的 08 同一句，`{}` 在碰 D1 之前就回）。還是 `503 bounty_paused`：看 44，新版本有沒有切上去。
- 44 最後一筆就是這一步產生的版本，id 記下來＝開閘版（v3＋`on`）。從這裡開始退不回 v2（第 7 節）。要停寫入走第 7 節第 1 步，它會再產生一版 v3＋`off`。
- 這一步只動 `BOUNTY_WRITES`。另外兩個開關不在這一步，要不要動另外決定：`BOUNTY_CLAIMABLE_FROM`（估值 L2 的起算點，沒設＝L2 恆為 1，不擋入帳，`worker.js:8122-8124`），以及網頁 `BOUNTY_ENABLED` 的預設（現在只認 `?bounty=1`，`index.html:15428`）。
  v2 交接檔 5.11 另外列了開放前要先有的東西：App 連正式站的那一版（native `7e310353a`，1.7.3 已經包含），以及計畫書 §12.1 第 5 項（本線沒查現況）。

開閘之後第一次有人讀錢包、以及開閘後的第一發判定 cron（台北 03:30）跑完，各看一次帳本（唯讀）。總閘關著的時候沒有新的錄程、兌換、雲端搭乘進來，所以要等開閘之後才看：

```bash
q "SELECT unit, kind, COUNT(*) AS n, SUM(delta) AS s FROM chip_ledger GROUP BY 1, 2" | tee tmp/v3deploy/21_ledger_after.json
q "SELECT actor, day, SUM(delta) AS s FROM chip_ledger WHERE kind='trip' AND unit='point' GROUP BY 1, 2 ORDER BY s DESC LIMIT 5" | tee tmp/v3deploy/22_top_trip_days.json
q "SELECT COUNT(*) AS n FROM kv_blobs WHERE k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}'" | tee tmp/v3deploy/23_strikes.json
```

- 21：會開始出現 `trip`＋`point`。換算列（`adjust`＋`point`）只有在有 `unit='chip'` 的列時才會出現，總和＝讀過錢包或兌換過的那些人的 49 ×（各自 `chip` 列的加總）；P0 時帳本是空的。
- 22：每人每天的 `trip` 點數不超過 500（入帳時已經算進同一天換算前的籌碼列）。
- 23：跟 42 比沒有暴增。判定出錯會記在這裡，樣本留在 pending 等下一發重判。

#### 10-27 實跑結果（21:18 台北，經使用者 go；原始輸出在本線樹的 `tmp/v3deploy/` 40–49 開頭的檔，被忽略）

- 先看：40 正在跑的是 P4 那一版 `15ae640a`（v3＋`off`），41 最新上傳的也是它；42 是 0。
- 開：`printf on | w secret put BOUNTY_WRITES`（21:18:45，rc=0）。產生的版本 **`4da39d7f-6aec-44fa-bc4b-bb7e531b129d`**（來源 Secret Change，21:18:46，100%）＝開閘版（v3＋`on`），BUILD 仍是 `v1027a`。
- 開完：43 是 `400 bad_actor`；`garage-redeem`、`cloud-ride` 送 `{}` 也是 `400 bad_actor`。
- 開閘當下（21:19）先讀一次當基準：帳本 0 列、`trip` 點數 0 列、`garage_unlocks` 0 列、42 那句仍是 0。
- 還沒做：上面 21–23 那兩次（開閘後第一次有人讀錢包之後、10-28 03:30 判定跑完之後）。在那之前第 7 節那句 n 仍是 0；一有點數列寫進來就只能走 n＞0 那條，凍結寫入的前提（最新上傳＝正在跑的版本）現在是 `4da39d7f`。

#### 開閘後的帳本快照（10-27 21:54 台北，判定 cron 之前，唯讀；原始輸出在本樹 `tmp/v3deploy/` 的 `a_`、`app_` 開頭檔，被忽略）

上面「還沒做」的兩次之前，先在判定 cron 之前留一份快照；這時還沒有真人讀過錢包（21:58 那發 chips-me 用全新 id，不寫庫）。原定那次（10-28 04:00 之後、03:30 的判定跑完）的結果接在這一節後面。
腳本 `tmp/v3deploy/p6_check.sh`：`a` 是快照，`b` 是原定那次，`b` 在台北 10-28 04:00 之前、以及 03:20–04:00 都會自己拒絕執行。這棵樹沒有 `node_modules`，`w` 改用主 checkout 的 wrangler，在本樹目錄下跑、讀本樹的 `wrangler.jsonc`。

- 登入：`wrangler whoami` 是 OAuth，帳號 ID 跟 P0 的相同（帳號名稱含 email，不寫進公開 repo）。
- 21：空集合（帳本 0 列：沒有 `trip`＋`point`，也沒有 `adjust`＋`point`）。22：空集合。23：n＝0，跟開閘當下的基準 0 相同。第 7 節那句：n＝0。
- `w deployments list`：最後一筆是 `4da39d7f-6aec-44fa-bc4b-bb7e531b129d`（Secret Change，21:18:46，100%），前一筆 `15ae640a`（21:12:44），再前是 V0 `db880f91`（10-25）。正在跑的仍是開閘版。
- 判讀：開閘後 36 分鐘沒有任何點數列寫進來（1.7.3 還沒上架、網頁懸賞要帶 `?bounty=1`），第 7 節走「n＝0」那條的前提沒變。
- 21:58 另外照 App 的抓法讀正式站（純網址、`Cache-Control: no-cache`、不帶 cb；只有 GET，沒有寫入）：
  規則檔、區段檔都是 200，內容跟 repo 位元組相同（sha256 前 16 碼 `3f173964209bf5ff`、`5b5e4092bee3ccdb`），標頭是 `public, max-age=0, must-revalidate`；規則檔 `v` 3、`unit` `point`、`perKm` 1、`dailyChipCap` 500；看板 200（203753 bytes）；全新裝置 id 的 chips-me 跟 P5 那串一字不差。
  native `09a9d9e12`（App 222／121 的建包基準）打包的 `shared/bounty/bounty_rules.json` 也跟 `data/bounty_rules.json` 位元組相同。
- 22:1x iOS 222（TestFlight）真機：使用者看過護照頂端卡與「找任務」畫面，都對（Android 121 沒有人看過）。護照的點數餘額讀自 chips-me，畫面對＝讀到了 v3 形狀的回應。
  22:13 再留一份快照（`a2_` 開頭檔）：21、22 空集合，23 n＝0，第 7 節那句 n＝0，正在跑的仍是 `4da39d7f`——護照讀過錢包之後帳本還是 0 列。

#### 22:58 起 n＞0（10-27 23:04 台北，唯讀；來源是主線的通知加本樹實查）

- 主線（通知說經使用者 go）在 22:58 寫了一筆人工加點進正式帳本：`kind='adjust'`、ref 開頭 `owner-demo`、+1100 點，讓使用者用自己的 iPhone 正式包（1.7.3／222）實際兌換四座車庫（200＋300×3）。樣本與加點是同一個 actor（那台 iPhone 的 installId）；id 與 ref 全文不寫進公開 repo。
- 23:04 本樹唯讀實查（`tmp/v3deploy/p6_check.sh c`，輸出在 `c_` 開頭檔，被忽略），跟主線的通知一致：
  `chip_ledger` 兩列 `point`——`adjust` 1 列 +1100、`redeem` 1 列 −200；`garage_unlocks` 1 列（south-coast，第 1 座，200 點）；`bounty_samples` 該 actor 2 列 `pending`（thsr_sched 4037，乘車日 10-27，22:57 上傳，主線說明是在家錄的 1～2 分鐘）。該 actor 餘額 900。
  23：n＝0；22：空集合；正在跑的仍是 `4da39d7f`。**第 7 節那句 n＝3。**
- 兌換在正式庫上走通過一次（23:00，一座，從人工加點的餘額扣）；入帳（判定 cron 給的點數）、換算、雲端搭乘還沒看到。
- **從這裡起退不回 V0**：第 7 節走「n＞0」那條，出事只能凍結寫入（`printf off | w secret put BOUNTY_WRITES`），前提是最新上傳的版本＝正在跑的 `4da39d7f`（否則被拒 10215，停手問，不要改用 `versions secret put`）。
- 10-28 04:07 那次的判準（主線轉知）：
  - 預期、不算異常：owner-demo 那筆 adjust；redeem 最多 4 列、合計 −1100；garage_unlocks 最多 4 列；餘額 ≥ 0（四座換完是 0）。
  - 異常：這個 actor 出現任何 `trip` 列（那 2 筆樣本 03:30 應判不合格、不給點，verdict 不該是 `ok`）；出現第二筆 adjust；redeem 合計超過 1100；餘額 < 0。
  - 其他 actor 有入帳算正常使用，照原本的上限檢查（每人每天 `trip` 點數 ≤ 500）。
  - 分類由 `tmp/v3deploy/p6_classify.mjs` 做（`p6_check.sh` 最後會呼叫它），輸出把 actor 遮成 owner-demo、actor-N。

## 7. 回滾

先跑這一句（唯讀）決定走哪一條：

```bash
q "SELECT (SELECT COUNT(*) FROM chip_ledger WHERE unit='point') + (SELECT COUNT(*) FROM garage_unlocks WHERE unit='point') AS n" | tee tmp/v3deploy/31_point_rows.json
```

P6 開閘之後，只要有人入帳、兌換或雲端搭乘過，n 就大於 0，從那之後退回 v2 就不安全了。出事先走下面 n＞0 的第 1 步凍結寫入，不要退程式。

**n＝0（v3 還沒寫過任何一列）**：可以退回 V0。

```bash
VER='填 P0 記下的 V0'
w versions deploy "$VER@100%" --yes
```

V0 記在第 1 節末（10-27）。P4 之前若又出過別的版本，回滾目標要換成 P4 前一刻在跑的那一版（P4 前重跑一次 02），不然連那幾版一起退掉。
退完照 v2 交接檔 5.7 的 R3 確認（`const BUILD` 回到舊的）。0017 不用退，v2 不讀那一欄。
隱私權政策那句會跟著退回舊入口（V0 是舊字）。1.7.3 已經送審或上架的話，退完再單獨出一次這句（V0 出貨的那顆加上它，一樣等使用者 go），不然隱私權頁寫的入口跟 App 對不上。

**n＞0**：**不要退程式**。v2 會把點數當籌碼：換算列讓讀過錢包的人多出 49 倍籌碼、點數制的入帳與退款列也被當成籌碼，v2 的價格是 4／8，整個車庫一下就換光。改成：

1. 凍結寫入：`printf off | w secret put BOUNTY_WRITES`（前提同 v2 交接檔 5.6 E0：最新上傳的版本＝正在跑的版本，否則被拒 10215，停手問，不要改用 `versions secret put`）。它拿現在的 v3 程式加上 off 產生新版本並立刻上線：claim、submit、garage-redeem、cloud-ride 回 503，chips-me 不再補換算列、餘額照樣讀得到。
2. 判定 cron 不看寫入總閘。問題出在判定入帳的話，連 cron 一起停：從一棵 `wrangler.jsonc` 的 crons 沒有 `"30 19 * * *"` 的乾淨樹跑 `w triggers deploy`（做法同 v2 交接檔 5.7 R1）。這也會停掉懸賞估值。
3. 修好之後照 P2–P4 再出一版（fix forward）。

不要做的事：

- 不要把 `chips.chipToPoints` 調低：餘額是從帳本現算的，調低等於把每個人已經換好的點數重新縮水，花過點數的人會變負數。
- 不要把規則檔改回 v2 的樣子當暫停鍵：v3 遇到不是點數制的規則，錢包三支回 503、判定 cron 丟錯（`bountyPointsRulesOk`），等於全停，而且要出一版才改得回來；要暫停用上面第 1 步。
- 不要刪 `unit='point'` 的列來「讓 v2 可以回來」：那是使用者賺到的點數，刪不刪是使用者的決定。
