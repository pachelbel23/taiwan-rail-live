# 校正懸賞 v3（點數制）部署清單

> 本線**一步都沒有執行**。每一個 `--remote`、`ship-web`、`secret put`、對正式站的請求（連唯讀查詢也算）都是對外動作，逐步等 go。
> 規格：`docs/bounty/contract-v3.md`（第 8 節是上線順序的理由）。共用的工具與機制沿用 `docs/bounty-v2-merge-handoff.md` 第 5 節，這裡不重抄，只寫 v3 不一樣的地方。

## 0. 一眼看完

| 步驟 | 動作 | 寫正式環境？ | 退路 |
|---|---|---|---|
| P0 | 唯讀盤點：schema、現行版本＝**V0**、寫入總閘、帳本規模 | 只讀 | — |
| P1 | 正式 D1 套 `0017`（兩句 `ALTER`，只加欄） | 是 | 只加不刪；v2 照常運作 |
| P2 | 出貨前本機準備：日期、BUILD、重產單位／路段檔、全部閘門、併 main | 本機＋公開 repo | — |
| P3 | `ship-web --preview` 上傳預覽，使用者本人在瀏覽器看 | 上傳一個不上線的版本 | 不升版就沒事 |
| P4 | `ship-web` 上線 | 是 | 第 7 節 |
| P5 | 上線後檢查（唯讀）＋第一發判定 cron 之後再看一次 | 只讀 | 第 7 節 |

順序的硬條件：

- **P1 一定早於 P3、P4**：v3 每一句讀寫帳本與解鎖的 SQL 都提到 `unit`，沒這一欄 chips-me、garage-redeem、cloud-ride 一律 503，判定 cron 入帳那一句丟錯（`schema/0017_bounty_points.sql` 檔頭）。ship-web 2.4（`verify_remote_schema`）會擋，但不要靠它。
- **P1 對還在線上的 v2 無害**：v2 寫帳本與解鎖的 INSERT 全部明列欄位（base `7c8924be` 的 `worker.js:7408 7702 7709 7848 8663`），新欄位吃預設值 `'chip'`，正好是 v2 寫的單位。
- **換算列只能由 v3 寫**：v2 把 Σdelta 當籌碼餘額，看到換算列（`kind='adjust'`、ref `v3points|…`）會以為那個人多了 49 倍籌碼。所以換算不在 migration 裡做，P3 預覽時也要避開（第 4 節）。
- 規則檔（`data/bounty_rules.json`）、路段檔與 Worker 在同一個版本裡一起上，沒有「新程式配舊規則」的中間狀態。

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

## 2. P1 套 0017

時段同 v2 交接檔 5.5：台北 01:30–03:00 之類的低流量時段，避開 03:30（判定 cron `30 19`）與 09:15（每日 ingest `15 1`）。

兩句 `ALTER` 用 `--command` 一句一句送，不用 `--file`（`--file` 走 import，套用期間整個正式庫停服務）。內容與 `schema/0017_bounty_points.sql` 一字不差，送之前 `grep -c '^ALTER' schema/0017_bounty_points.sql` 要是 2：

```bash
q "ALTER TABLE chip_ledger ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip'"
q "ALTER TABLE garage_unlocks ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip'"
```

套完（唯讀）：

```bash
node scripts/verify_remote_schema.mjs 2>&1 | tee tmp/v3deploy/11_schema_after.txt
q "SELECT unit, COUNT(*) AS n FROM chip_ledger GROUP BY unit" | tee tmp/v3deploy/12_ledger_units.json
q "SELECT unit, COUNT(*) AS n FROM garage_unlocks GROUP BY unit" | tee tmp/v3deploy/13_unlock_units.json
```

11 全綠；12、13 只有 `chip` 一列，筆數等於 P0 的 05、07。重送任一句會報 `duplicate column name`，無害，代表已經套過。

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
npm run check-manifest
```

7. 併進 main 由主線做（這條線不 push main）。

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
- 上傳之後「最新上傳的版本」就不是 V0 了，這段期間的 `secret put` 會被拒（10215）。要動寫入總閘，在 P3 之前做。

使用者在預覽看的東西：

| 位置 | 應該看到 |
|---|---|
| 懸賞板副標 | 「合格的一趟照沿線里程得到點數，每天有上限」那一句 |
| 南迴、臺東線的卡片 | 「點數 ×2」 |
| 出發前說明卡 | 「1 公里 1 點」「這條線的點數 ×2」「每天最多 500 點」；合格那句是「沿線至少移動」 |
| 護照（登入） | 點數列：餘額、「下一座場景要 200 點」、「雲端搭乘 N 次・每天一次 20 點」、「錄程每天最多 500 點」 |
| 更新紀錄 | 最上面一條是點數制那一條，日期是當天 |
| 英文、日文介面 | 同上各句的翻譯，沒有 chip／チップ |

## 5. P4 上線

```bash
npm run ship-web
```

- ship-web 跑完全部閘門（含 2.4 正式庫 schema、懸賞總閘門），去註解、上傳、`versions deploy <這次上傳的 id>@100% --yes`、對正式站逐 byte 收貨。這一步就是「`versions deploy`」。
- 避開台北 03:20–04:00（判定 cron `30 19` 在跑）。
- 上線後 App 1.7.3 會照新的回應顯示數字，只是單位字眼還是舊的（`docs/bounty/contract-v3.md` 第 7 節），這是要不要先上伺服器的取捨，由使用者決定。

## 6. P5 上線後檢查

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

快取設定不用改：`_headers:47-48` 對 `/data/*` 只加 CORS，沒給 Cache-Control，所以走靜態資產的預設 `public, max-age=0, must-revalidate`，每次讀都拿 ETag 回來驗，沒變就回 304。這兩個檔要跟 Worker 同時換（第 0 節），新 App 又會線上讀規則檔、內建一份當備援（N1 那條線）；只要給了 `max-age`，已經讀過的人到期前都拿著 v2 規則對 v3 伺服器。所以不要在 `_headers` 替這兩個檔加長快取。CORS `*` 是給 App 殼與網頁跨來源讀的（理由在 `_headers:40-46`），原生 HTTP 不看 CORS。

上線後第一次有人讀錢包、以及第一發判定 cron（台北 03:30）之後，各看一次帳本（唯讀）：

```bash
q "SELECT unit, kind, COUNT(*) AS n, SUM(delta) AS s FROM chip_ledger GROUP BY 1, 2" | tee tmp/v3deploy/21_ledger_after.json
q "SELECT actor, day, SUM(delta) AS s FROM chip_ledger WHERE kind='trip' AND unit='point' GROUP BY 1, 2 ORDER BY s DESC LIMIT 5" | tee tmp/v3deploy/22_top_trip_days.json
q "SELECT COUNT(*) AS n FROM kv_blobs WHERE k >= 'bounty_verify_strike|' AND k < 'bounty_verify_strike}'" | tee tmp/v3deploy/23_strikes.json
```

- 21：`adjust`＋`point` 的總和＝已讀過錢包（或兌換過）那些人的 49 ×（各自 `unit='chip'` 列的加總）；`trip`＋`point` 開始出現。
- 22：每人每天的 `trip` 點數不超過 500（入帳時已經算進同一天換算前的籌碼列）。
- 23：跟 P0 時比沒有暴增。判定出錯會寫在這裡、樣本留 pending 下一發重判。

## 7. 回滾

先跑這一句（唯讀）決定走哪一條：

```bash
q "SELECT (SELECT COUNT(*) FROM chip_ledger WHERE unit='point') + (SELECT COUNT(*) FROM garage_unlocks WHERE unit='point') AS n" | tee tmp/v3deploy/31_point_rows.json
```

**n＝0（v3 還沒寫過任何一列）**：可以退回 V0。

```bash
VER='填 P0 記下的 V0'
w versions deploy "$VER@100%" --yes
```

退完照 v2 交接檔 5.7 的 R3 確認（`const BUILD` 回到舊的）。0017 不用退，v2 不讀那一欄。

**n＞0**：**不要退程式**。v2 會把點數當籌碼：換算列讓讀過錢包的人多出 49 倍籌碼、點數制的入帳與退款列也被當成籌碼，v2 的價格是 4／8，整個車庫一下就換光。改成：

1. 凍結寫入：`printf off | w secret put BOUNTY_WRITES`（前提同 v2 交接檔 5.6 E0：最新上傳的版本＝正在跑的版本，否則被拒 10215，停手問，不要改用 `versions secret put`）。它拿現在的 v3 程式加上 off 產生新版本並立刻上線：claim、submit、garage-redeem、cloud-ride 回 503，chips-me 不再補換算列、餘額照樣讀得到。
2. 判定 cron 不看寫入總閘。問題出在判定入帳的話，連 cron 一起停：從一棵 `wrangler.jsonc` 的 crons 沒有 `"30 19 * * *"` 的乾淨樹跑 `w triggers deploy`（做法同 v2 交接檔 5.7 R1）。這也會停掉懸賞估值。
3. 修好之後照 P2–P4 再出一版（fix forward）。

不要做的事：

- 不要把 `chips.chipToPoints` 調低：餘額是從帳本現算的，調低等於把每個人已經換好的點數重新縮水，花過點數的人會變負數。
- 不要把規則檔改回 v2 的樣子當暫停鍵：v3 遇到不是點數制的規則，錢包三支回 503、判定 cron 丟錯（`bountyPointsRulesOk`），等於全停，而且要出一版才改得回來；要暫停用上面第 1 步。
- 不要刪 `unit='point'` 的列來「讓 v2 可以回來」：那是使用者賺到的點數，刪不刪是使用者的決定。
