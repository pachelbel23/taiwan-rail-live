# 校正懸賞 v3（點數制）伺服器線交接

> 線：S（伺服器點數）。基底 web main `7c8924be`，分支 `claude/bounty-v3-points-1ea1ca`。
> 計畫書在 native 的 ignored 路徑 `native/build/bounty-v3/plan.md`（第 2.1、2.2、2.5、4 節）。本檔隨做隨寫。

## 1. App 1.7.3 相容性（native `13a622760` 實讀，10-26）

### 1.1 1.7.3 的規則檔是打包在 App 裡的，不向伺服器讀

- Android：`M4State.kt:295`、`AndroidBountyWallet.kt:23/31` 讀 asset `bounty/bounty_rules.json`；
  iOS：`M4Store.swift:582`、`BountyRulesProvider.swift:12` 讀 Bundle。
- 打包來源是 native repo 的 `parity/golden/modules/bounty/input/bounty_rules.json`（`androidApp/build.gradle.kts:545`、`ios/project.yml:43`）。
- 結論：改伺服器 `data/bounty_rules.json` 不可能讓 1.7.3 解析失敗；反過來，1.7.3 出發前說明的兩句一直是內建 v2 數字：
  「合格的一趟得 1 顆籌碼。」「每天最多 4 顆。」（`BountyViews.kt:109/112`、`BountyBriefAdapter.swift:52/54`）。伺服器端改不到，只能等使用者更新。
- 新 App 若沿用打包，要更新 parity 那份規則檔；打包模式下「改設定檔就改數字」到不了 App（已回報主線）。

### 1.2 chips-me：欄位一個都不能少

- railcore `WalletJson.parseSnapshot`（`WalletJson.kt:7`）要求 `balance`、`unlocked`、`nextCost`、`cloud.rides`、`cloud.toNextChip`、
  `today.chips`、`today.cap` 都是非負整數，少一個整份錢包解析失敗（餘額、兌換全掛）。
- 所以「不給舊欄位、讓舊客端整行不畫」做不到：chips-me 解析成功，「雲端搭乘 N 次・再 M 次拿 1 顆」那一行就一定畫
  （Android `BountyViews.kt:231`、iOS `BountyWallet.swift:105`）。
- 雲端搭乘協調器另讀 chips-me，`toNextChip < 1` 就一直退避重查（`CloudRideCoordinator.kt:277`）。

### 1.3 cloud-ride 200

- 1.7.3 要 `day`、`rides`、`toNextChip ≥ 1`、`chipAwarded`（bool）；不合格當無效 200，同一筆退避重送
  （`CloudRideCoordinator.kt:245/265`、`CloudRideWireFormat.kt:76`、Android `BountyCloudPorts.kt:93`）。
- 1.7.3 的雲端搭乘規則 port 要 `chips.cloud.perChip` 是 ≥ 1 的整數，否則整個功能停（Android `BountyCloudPorts.kt:20`、iOS `BountyCloudPorts.swift:33`）。
  1.7.3 讀的是內建檔，所以這條只約束「打包新規則檔、又沿用這段程式」的新 App。

### 1.4 定案形狀（10-26 已 SendMessage 主線）

- `bounty_rules.json`：`v` 3；`chips` 加 `unit:"point"`、`perKm:1`、`cloud.points:20`；`perTrip` 改 0、`cloud.perChip` 改 1、`dailyChipCap` 500、`prices` [200,300]。
  - `perTrip: 0`：快取裡的舊網頁讀到 0 就不畫「一趟得 N 顆」與兩句合格說明（`bountyRewardText`、`bountyQualifyParts` 都要 > 0 才畫）。
  - `cloud.perChip: 1`：「每一次都入帳」，留給沿用舊雲端程式的 App。
- `chips-me`：`{unit:"point", balance, unlocked, nextCost, cloud:{rides, toNextChip:1, points}, today:{chips, cap}}`，數字都是點數；`toNextChip` 固定 1。
  新客端看頂層 `unit === "point"` 判斷伺服器是不是 v3。
- `cloud-ride` 200：`{ok, day, rides, toNextChip:1, chipAwarded, points}`；`points` 是這一次入帳幾點（模擬器 0），重送回同樣的值。
- `garage-redeem`、`bounty-board`、`bounty-me` 形狀不變。

### 1.5 1.7.3 接上 v3 伺服器會看到

| 畫面 | 顯示 | 數字對不對 |
|---|---|---|
| 錢包列 | 「籌碼 250」 | 對（點數，舊字眼） |
| 錢包列 | 「雲端搭乘 N 次・再 1 次拿 1 顆」 | 「1 顆」寫死在 App 裡，實際每次 20 點（偏低） |
| 錢包列 | 「錄程每天最多 500 顆」 | 對（點數，舊字眼） |
| 車庫兌換 | 沒有這個入口 | 1.7.3 不能兌換：兩平台建錢包時可兌換場景都給空清單（Android `BountyWalletPorts.kt:71-72`、iOS `BountyWallet.swift:86`），iOS 的端點白名單也沒有 `garage-redeem`（`BountyAPI.swift:29`）；`nextCost` 只在解析時檢查，畫面不顯示 |
| 出發前說明 | 「合格的一趟得 1 顆籌碼。」「每天最多 4 顆。」 | 錯。**這兩句在 1.7.3 是寫死的**：句子在 App 裡，1 和 4 是 App 內建 v2 規則檔的 `perTrip`、`dailyChipCap`（1.1）。實際一趟照沿線里程給點（約 1 公里 1 點）、每天最多 500 點 |
| 停站卡的錄法 | 「整趟要錄滿…、在同一條線上移動…才有籌碼」 | 偏嚴：v3 看各線合計（2.2 第 2 條），照 App 說的做一定合格 |

出發前說明那兩句伺服器改不到，只有使用者更新到新 App 才會變。偏低、偏嚴的字只會讓人少期待，不會讓人少拿點數。要不要等新 App 普及再上伺服器，是主線問使用者的事。

10-27 A54 與 iPhone 17 Pro 實機（1.7.3 除錯包：APK sha256 開頭 `f81ffcec`、iOS 是 native `13a622760` 的 Debug-iphoneos 建置；接本機 v3 假站，種子是 v2 籌碼 8 顆，所以餘額 400，上表的 250 是別組種子）：
- 看板與護照的錢包列都是「籌碼 400」「雲端搭乘 0 次・再 1 次拿 1 顆」「錄程每天最多 500 顆」，沒有兌換入口。看板副標是「合格的一趟可以得到籌碼，每天有上限」。
- 臺東線軌道卡說明：「合格的一趟得 1 顆籌碼。」「這條線的籌碼 ×2。」「每天最多 4 顆。」。×2 是 App 內建 v2 規則的偏遠線倍率，v3 也是 ×2，數字剛好一樣。
- 縱貫線南段停站卡：「整趟要錄滿 10 分鐘、在同一條線上移動 1.0 公里 才有籌碼」，加上同樣兩句。
- iPhone 的除錯版自動挑第一張沒收滿的軌道卡（縱貫線南段，不是偏遠線），所以沒有 ×2 那句；先講清楚那段是「沒達到門檻，能用的資料照樣拿來校正，只是沒有籌碼。」。
- 兩支都跟上表一致，沒有閃退。截圖在 `tmp/bounty-v3/phone/shots/`、`shots-ios/`（被忽略）。iPhone 的護照只截到上半段（devicectl 不能捲動），錢包列在看板那張。

## 2. 點數規則與伺服器實作（已做、已驗）

- 規則檔 `data/bounty_rules.json` v3：`chips.unit:"point"`、`perKm:1`、`minTripSec:600`、`minTripMoveM:1000`、`dailyChipCap:500`、
  `prices:[200,300]`、`cloud.points:20`、`chipToPoints:50`、偏遠線（南迴、臺東）×2、`events` 照舊。
  第一座 200、之後每座 300、每天上限 500、雲端一次 20 點、1 顆籌碼換 50 點，是 10-26 已確認的設定值。
- 核心 `scripts/bounty_chips_core.mjs`：`tripPoints`＝Σ 各 ok 線收下的沿線公尺 × 偏遠倍率 × 期間活動倍率，最後捨去一次；
  `applyDailyChipCap` 上限數的是加倍後的點數。內部用公寸整數算（98.4 km → 98，不會因浮點誤差變 97）。
- `worker.js`：
  - 判定 cron（`bountyCreditTripChips`）：每條線取「這一發收下的點」與前次 ok 列 `kept_d0／kept_d1` 的聯集跨距；帳本列 `unit='point'`；
    每日上限把當天 v2 的籌碼列照 `chipToPoints` 換算後計入（`BOUNTY_POINTS_OF_ROW`）。
  - chips-me：頂層 `unit:'point'`；`balance`、`nextCost`、`today.chips` 都是點數；`cloud.toNextChip` 固定 1。
  - cloud-ride：一次合格搭乘入帳 `cloud.points` 點；回應 `points` 照 ref（`<送來的 actor>.<requestId>`）找回這一次的入帳列，重送回同樣的值。
  - garage-redeem：價格與餘額都是點數；交易內的餘額守衛用 `BOUNTY_POINTS_BALANCE_SQL`（不靠換算列寫進去了沒）。
- `schema/0017_bounty_points.sql`：`chip_ledger`、`garage_unlocks` 各加 `unit TEXT NOT NULL DEFAULT 'chip'`。先套 schema、再出 Worker（檔頭有理由與忘套的症狀）。

### 2.1 舊籌碼換點數（冪等）

- 不在 migration 一次換：v2 Worker 還在線上時補換算列，它會把每個人的籌碼看成 50 倍。
- v3 Worker 在 chips-me（驗完身分之後、寫入總閘沒關時）與 garage-redeem（同一個 batch 的第一句）補一筆 `kind='adjust'`、
  ref `v3points|<actor>|<籌碼列數>` 的列，數額＝49 × Σ籌碼列 − 已補的換算；算出 0 就不寫，重跑不重算。
- 餘額＝Σ delta ＋ max(0, 49 × Σ籌碼列 − Σ換算列)：換算列寫沒寫進去，餘額都一樣。
- 判準：redeem V 組（×50、重跑不重算、合併搬進籌碼列後補差額）、auth A3b（擋下的請求不換算、驗完身分才換算）。

### 2.2 本線裁示（做了什麼／為什麼／錯了的代價；不是使用者的決定）

1. 遲到的後半段不補發：同一班已入帳就不再入帳（沿用 v2 的唯一鍵）。為什麼：補差額要改帳本唯一鍵與冪等設計，風險大於收益。
   錯了的代價：分兩次上傳、前半段已過 600 秒的人少拿後半段的里程（cron2 J 組、hardening C2s 釘住）。
2. 移動門檻（minTripMoveM 1000 m）看各線收下里程的合計，不是單一條線。為什麼：點數本身就是各線相加，門檻跟點數同一把尺。
   錯了的代價：跨線的短程（每條線都不到 1 km、合計 ≥ 1 km）會拿到 1 點（hardening MV7b 從 0 改成 1）。
3. 偏遠倍率逐線套，不是整趟套。為什麼：計畫寫「南迴、臺東線 ×2」，直通車只有偏遠那段該加倍。代價：無（比整趟套保守）。
4. v2 雲端搭乘「累積 3 次換 1 顆」的進度不補償：v3 每次 20 點，舊進度歸零。代價：上線前一兩天搭過、還沒湊滿的人少 1～2 次的份。
5. `chipToPoints` 只准調高，不准調低：已補的換算列是寫死的數額。調低之後，已補過的人照舊值、還沒補的人照新值，兩種人不一致
   （餘額公式的 max(0, …) 不會把已補的扣回來）。調高沒有這個問題：餘額公式的第二項會把差額算進去
   （換算列的 ref 帶籌碼列數，列數沒變就不會再寫一筆，差額留在公式裡，餘額照樣對）。
6. 合併退款照那一座付款時的單位（`garage_unlocks.unit`）寫：籌碼付的退籌碼，之後照樣換算。代價：無。
7. 規則檔若被退回 v2（沒有 `unit:"point"`）：chips-me、garage-redeem、cloud-ride 一律 503，判定 cron 整支中止、樣本留 pending。
   為什麼：v3 Worker 讀 v2 規則會用錯單位入帳；寧可停也不錯帳。
8. `cloud.toNextChip` 固定 1（1.7.3 要 ≥ 1 才不退避，見 1.2、1.3）。
9. 測試對照版（cron2 K 組的 v2 實作）餵 v2 規則；新舊等價比對拿掉帳本 delta 與 stat.chips，另加手算點數的判準（K1r／K2p／K3p／K5p）。

## 3. 驗證（node 後端 15 支全綠，10-26）

| 支 | 判準數 | 變化 |
|---|---|---|
| hardening | 183 | 期望值改點數；C2s 日額窗改用點數列；C4 前次列帶 kept 範圍；M3 守衛邊界改 200／201；PL 指名族補 v3 新句 |
| schema | 50 | ＋0017 的欄位與預設值 |
| ledger | 73 | 入帳單位、每日上限換算 v2 籌碼列 |
| chips | 37 | 核心純函式：98.4 km→98、南迴 ×2、兩線相加、超過 500 截斷、雲端 20、價格 200／300 |
| redeem | 106 | 價格點數、換算 ×50 與重跑不重算（V 組） |
| cloud | 119 | 每次 20 點、重送回同樣的 points |
| merge | 60 | 退款照付款單位 |
| auth | 89 | 擋下的請求不換算 |
| cron2 | 131 | 里程聯集、前次列 kept、偏遠逐線、手算點數 |
| 其餘（valuation 88、gates 75、dwell 16、api 105、cron 70） | 不變 | |
| rules | 16 → 20 | 區段檔，見 4.2 |

- 每一條新判準都在針對性突變下看過紅一次、還原後綠（突變腳本與紀錄在本機 ignored 路徑 `tmp/bounty-v3/`，不進版控）。
  例：「點數四捨五入」「里程用原始的點」「前次線組不算里程」「偏遠倍率套整趟」「移動門檻不相加」「兌換守衛改成 >」「每日上限多 100」
  「換算列永遠不寫」「換算在驗身分之前」各自讓對應判準變紅。
- `worker.js` 一句 SQL 的引號改一致（chips-me 今天的錄程點數）：hardening PLa 從原始碼抽 `INDEXED BY` 片段，混用引號會抽錯。

## 4. 區段檔 `data/bounty_sections.json`（已做、已驗）

- `scripts/build_bounty_units.mjs` 同一發寫出單位檔與區段檔，兩份都算完才寫：區段那一步擋下（車站資訊檔查不到縣市）時，舊的單位檔原封不動。
  多一個必要輸入 `data/tra_station_info.json`，缺了就停（跟原本六個輸入檔同一套）。
- 形狀照計畫 4.2：`{v:1, generatedAt, rule, regions:[6 個分頁], lines:{線鍵:[{a,b,dA,dB,km,regions}]}}`。
  `dA`／`dB` 是 `bounty_units.json` lines 裡那一站的里程原值（不取位，客端可以直接比對），`km` 取一位；`a`→`b` 里程遞增。
- 版控裡這份用 10-25 的班表產（跟版控裡的單位檔同一份輸入）。重跑出來的單位檔除了 `generatedAt` 一字不差，所以單位檔不 commit，免得跟別條線撞單行的大檔。
- 21 條線 83 段；最短 阿里山–沼平 1.1 km、最長 高鐵 嘉義–台南 62.5 km。建置輸出：

```
縱貫線北段 7 段：基隆–汐止(13.2)、汐止–臺北(15.2)、臺北–桃園(29.1)、桃園–中壢(9.9)、中壢–楊梅(9.8)、楊梅–新竹(29.4)、新竹–竹南(19)
山線 5 段：竹南–苗栗(15.3)、苗栗–三義(18.2)、三義–豐原(20.2)、豐原–臺中(14.1)、臺中–彰化(17.8)
海線 5 段：竹南–後龍(15)、後龍–通霄(20.6)、通霄–大甲(18.6)、大甲–沙鹿(14.5)、沙鹿–彰化(21.8)
縱貫線南段 11 段：彰化–員林(14.8)、員林–田中(11.5)、田中–斗六(23.5)、斗六–大林(16.2)、大林–嘉義(15)、嘉義–新營(23)、新營–善化(19.7)、善化–臺南(19)、臺南–岡山(25.3)、岡山–新左營(12.9)、新左營–高雄(8.7)
屏東線 3 段：高雄–屏東(20.8)、屏東–潮州(15.2)、潮州–枋寮(25.3)
南迴線 6 段：枋寮–枋山(13.6)、枋山–大武(30.1)、大武–金崙(20)、金崙–太麻里(11)、太麻里–知本(11.8)、知本–臺東(11.6)
臺東線 9 段：臺東–鹿野(14.3)、鹿野–關山(15.8)、關山–池上(12.1)、池上–玉里(25.8)、玉里–瑞穗(20.4)、瑞穗–光復(19.9)、光復–鳳林(10.4)、鳳林–壽豐(15.4)、壽豐–花蓮(17.2)
北迴線 4 段：花蓮–崇德(21.7)、崇德–和平(18)、和平–南澳(21.1)、南澳–蘇澳新(18.8)
宜蘭線 8 段：蘇澳–羅東(13.5)、羅東–宜蘭(8.9)、宜蘭–礁溪(8.4)、礁溪–龜山(13.5)、龜山–福隆(17.4)、福隆–雙溪(9.1)、雙溪–瑞芳(13.9)、瑞芳–八堵(8.9)
支線各 1 段：新竹–內灣(28)、竹中–六家(3.2)、三貂嶺–菁桐(13)、瑞芳–八斗子(4.7)、二水–車埕(29.5)、中洲–沙崙(5.7)、追分–成功(2.2)
高鐵 11 段：南港–台北(9.3)、台北–板橋(7.2)、板橋–桃園(29.2)、桃園–新竹(29.9)、新竹–苗栗(32.8)、苗栗–台中(60.9)、台中–彰化(28.3)、彰化–雲林(24.6)、雲林–嘉義(33.2)、嘉義–台南(62.5)、台南–左營(31.4)
林鐵本線 4 段：嘉義–竹崎(14.3)、竹崎–交力坪(20.6)、交力坪–十字路(20.5)、十字路–神木(14)
林鐵祝山線、神木線、沼平線各 1 段：阿里山–祝山(5.8)、神木–阿里山(1.3)、阿里山–沼平(1.1)
```

- 8–30 km 以外 14 段：高鐵站距 6 段（台北–板橋 7.2、新竹–苗栗 32.8、苗栗–台中 60.9、雲林–嘉義 33.2、嘉義–台南 62.5、台南–左營 31.4）；
  整條一段的短線 7 段（六家 3.2、深澳 4.7、沙崙 5.7、成追 2.2、祝山 5.8、神木 1.3、沼平 1.1）；南迴線 枋山–大武 30.1（見 4.1 第 5 條）。

### 4.1 本線裁示（計畫 2.2 沒寫死的地方）

1. 「自強號平日常停」照括號的定義算：班表 14 天各日停靠次數的中位數 ≥ 8（跟單位檔 perDay 同一個中位數），沒有另外排除週末。
   為什麼：括號是規格的操作定義；14 天裡 10 天是平日，中位數本來就落在平日。錯了的代價：週末才多停的站多或少一個分界，改一處。
2. 「停靠較少／最多」先比自強、再比全部車種（都是各日中位數）。併：從最短的一段開始，線的端點不拿，一樣多拿後面那站。
   切：只在「切下去兩邊都還有 8 km」的站裡挑，一樣多挑離中點近的，切出來的兩半再查。這個保證修掉主線參考腳本的已知 bug（先併後切會留下 < 8 km 的段）。
3. 支線（內灣、六家、平溪、深澳、集集、沙崙、成追）寫死整條一段；其他台鐵線一律走幹線規則，以後新加的線不在名單裡也照幹線規則切，不會停。
4. 林鐵：分界＝線的兩端＋有車發車或到底的站（各日中位數 ≥ 1 班），再照 8／30 km 併、切。計畫只寫了分界、沒寫長度；不切的話嘉義–十字路 55 km 一段。
   本線因此以十字路為界（有一班在那裡折返），奮起湖不是分界。錯了的代價：林鐵本線 4 段的切點不同，改一處。
5. 南迴線 枋山–大武 30.1 km 照留：枋寮–大武 43.8 km 照規則在停得最多的枋山切，剩 30.1 km。兩個條件同時成立只有一種切法：以枋野（號誌站，沒有車停）為界。
   用沒人上下車的站當分界，不如超 0.1 km。驗收 R14b 列名放行這一段；資料改了又冒出別的例外就會紅。
6. 地區：台鐵看兩端站在 `tra_station_info.json` 的地址（郵遞區號後接縣市；站名照網頁 `stnInfo()` 的對法：臺→台，查不到再去掉括號註記），縣市分區照計畫 2.2；
   高鐵一律 `thsr`、林鐵一律 `afr`。查不到縣市就停，不猜。
7. 站名照軌道檔原字（高鐵「台北」、台鐵「臺北」），跟 `bounty_units.json` 的 lines 同一套。

### 4.2 驗證

- `verify_bounty_rules` 16 → 20 條：R14（版控那份：形狀、每條線從頭鋪到尾、站名里程跟單位檔同一套、地區對得上地址的縣市；縣市分區在驗收裡照計畫另寫一份）、
  R14b（8–30 km 以外只准高鐵站距、整條一段的線、列名例外；支線整條、高鐵每站一段）、R15（手寫的線與班表跑建置腳本，期望值手算）、
  R15b（查不到縣市擋下、舊單位檔不動、區段檔不寫）；R13 的手寫輸入多一份車站資訊檔，R13b 多試缺車站資訊檔。
- 突變：建置腳本 19 種、區段檔資料 10 種，各自讓對應判準紅，還原後全綠（例：門檻 ≥ 改 >、中位數換成最大、併的時候拿停得多的、端點可拿、剛好 8 km 也併、
  切的時候不留 8 km、不挑離中點近的、剛好 30 km 也切、前半段不再查、支線不整條、林鐵照自強規則、地區只看起點、縣市不做臺／台、站名不去括號、先寫單位檔再算區段；
  資料：少列一區、拿掉一段、km 錯、里程差一點、少一條線、兩段併成 39 km、內灣線切兩段、高鐵兩站併一段）。

## 5. 網頁措辭（已做、已驗）

- 範圍：`index.html` 懸賞相關的畫面字（看板副標、卡片倍率標記、說明卡獎勵句與合格兩句、停站卡錄法、護照點數列、收滿的卡、網頁殼提示），
  加上 `i18n/content-translations.js` 對應的英日文。看板版面不動。
- 合格那句的「在同一條線上至少移動」改成「沿線至少移動」：v3 的移動門檻看各線合計（2.2 第 2 條），寫「同一條線」會講錯。
- 不是點數制就不寫：規則檔 `chips.unit` 不是 `'point'`、或 `perKm` 不是正數，說明卡的獎勵句與合格兩句整段不寫（CH17g、CH23n、CH25h）；
  chips-me 回應沒有 `cloud.points`（不是 v3 伺服器）就不畫雲端那一格（CH1i）。「每天一次」對應規則檔 `cloud.dailyMax` 1，
  改 dailyMax 時 CH1h 會紅，要一起改那句。
- 程式註解：講畫面字的跟著改；講本機快取機制的（`trainmap-chips-me-v1` 那幾段）沒動，快取鍵名也沒變。
- 錢包點數定名「島民點數」（10-27 定案，單位仍是「點」），照 N1 交接檔裁示 31 同一套規則：把點數當名詞的 10 句改成「島民點數」
  （看板副標、卡片倍率標記「島民點數 ×2」、說明卡的倍率句與「只是沒有島民點數」、停站卡錄法「才有島民點數」、護照點數列的標題與登出提示、
  收滿的卡、網頁殼提示、更新紀錄那一條），英文 Islander Points、日文島民ポイント。「1 公里 1 點」「每天最多 500 點」「下一座場景要 200 點」
  這類單位、「給點」、伺服器的 `unit:"point"`、護照校正貢獻的舊句都沒動。`verify_bounty_chips_web.mjs` 的期望值一起改，
  看板副標的判準收緊成要看到新名字本身。
  - 裁示：卡片倍率標記、收滿的卡、網頁殼提示不在主線列的四處裡，照同一條規則一起改，同一塊看板上不會一半舊名一半新名。
    錯了的代價：多改三句；退回只要改回字典鍵、英日文與判準。
- 更新紀錄：最近更新與完整歷史「收藏、護照與成就」各加一條（`data-cl="bountypoints"`），日期先寫 10/26、`最後更新：2026/10/26`；
  最近更新拿掉最舊那條（完整歷史裡還有一份）。`verify_changelog_browser` 的 `expectedHistoryCount` 523 → 524。上線日不是 10/26 要改日期（部署清單 P2 第 2 步）。
- 法務文字裡沒有「籌碼」，這條線沒改。給主線判斷的兩處：
  - `privacy.html:122`（英日文：`i18n/legal-translations.js` 第 102、184 行）寫「校正旅程資料（含累積的貢獻點數）」。v3 起「點數」也是錢包的名字；
    刪帳號本來就連錢包的表一起刪（`bountyPurgeUid`），文字要不要點名錢包由主線決定。
  - `terms.html:42` 提到車庫只在通行證那一節，跟點數兌換無關。
- 不是使用者看得到的「籌碼」字樣沒動：`scripts/check_deploy_config.mjs:37`、`scripts/ship_web.mjs` 611–617、`app/shipped-baseline.json:3105`、
  `verify_hidden.mjs` H13／H14（只驗 DOM）。

## 6. 驗證（全套，10-26）

- 總閘門 `node scripts/verify_bounty_all.mjs`：18 支全綠、共 1903 條判準（另有棘輪判法自我測試 19／19），rc=0。
- chips_web 641 → 646：新增 CH1h（三個餘額情境各一條）、CH1i、CH17g。突變三種，各自只讓目標判準紅、還原後 md5 相同：
  雲端格不看 `points` → CH1i；獎勵句不看 `unit` → CH17g；合格句不看 `unit` 與 `perKm` → CH17g。
- 其他閘門：`verify_changelog_copy`（最近 8 條、最長 81 字；完整歷史 524 條）、`check_i18n`（2989 個 key）、
  `verify_data_manifest`（41 檔；`data/data_manifest.json` 只有 `bounty_rules.json` 那一行變）、`verify_changelog_browser`（Chromium＋WebKit 無視窗、360／375／414／768 寬，完整歷史 524 條）。
- 10-27 補：65fca323 只重產了 `data/data_manifest.json`，`data/data_provenance.json` 裡 `bounty_rules.json` 的 checksum 還是舊的，
  `npm run check-manifest`（manifest 與 provenance 兩支）會紅。跑 `npm run build-manifest` 重產，只有那一行變，之後 check-manifest 綠。
- App 1.7.3 實測（native `13a622760`＝1.7.3 更新說明那一顆）：
  - railcore 原始碼原封不動（`json/`、`m4/BountyRules.kt`、`m4/wallet/` 兩檔、`m4/cloudwire/` 兩檔、`BountyInstallId.kt`、`CloudRide.kt`），
    用 Kotlin 2.2.20 編在 JVM 上；Android 平台層的兩段（雲端規則 port、cloud-ride 回應轉 receipt）照
    `androidApp/.../m4/BountyCloudPorts.kt` 第 18–21、93–97 行原樣搬進檢查程式。14／14：規則檔 5 條（`BountyRules.parseOrNull`、
    品質／停站／完整性判準照樣解得出來、chips 數字、雲端規則 port 收下 `perChip` 1、`WalletJson.parseRules` 讀到 [200, 300]）、
    chips-me 三份、兌換成功與 not_enough、cloud-ride 與重送，加兩個對照組（拿掉 `cloud.toNextChip` 的 chips-me 要解析失敗；同一支解析器讀 v2 規則檔讀到 v2 的數字）。
  - iOS 的 cloud-ride 回應與錢包雲端格是 Swift Decodable（`ios/RailIslandNative/M4/BountyCloudPorts.swift` 第 69–70 行），原樣編成小程式：6／6（含對照組）。
  - 餵進去的都是本機 v3 worker 實際回的字，不是手寫的。
- 本機 worker：wrangler dev 在這台機器起不來（`scripts/d1_local.mjs` 檔頭），改用 node 把 `worker.js` 的 fetch 掛在 127.0.0.1，
  D1 用 `d1_local`（套 `schema/` 全部檔），ASSETS 讀工作樹的檔。種子照 v2 Worker 的寫法插籌碼列（不帶 `unit`）：錄程 12 顆、兌換第一座 −4 顆。

| 請求 | 結果 |
|---|---|
| GET `/api/bounty-board`（先跑一次估值） | 200，267 張卡 |
| GET `/api/chips-me`（v2 種子） | `{"unit":"point","balance":400,…,"nextCost":300,"cloud":{"rides":0,"toNextChip":1,"points":20},"today":{"chips":0,"cap":500}}`；帳本多一筆 `adjust` +392（`unit='point'`，ref `v3points|…|13`） |
| 再 GET 一次 | 一樣 400，帳本沒有第二筆換算 |
| POST `/api/garage-redeem` 第二座 | 200，`nth` 2、`cost` 300、`balance` 100；解鎖列 `unit='point'` |
| POST `/api/cloud-ride`，再用同一個 requestId 重送 | 兩次都 200 `{"ok":true,"rides":1,"toNextChip":1,"chipAwarded":true,"points":20}`，只入帳一次 |
| GET `/api/chips-me` | 餘額 120、`cloud.rides` 1 |
| POST `/api/garage-redeem` 第三座 | 409 `{"error":"not_enough","cost":300,"balance":120}` |
| GET `/api/chips-me` 全新裝置 id | 餘額 0、`nextCost` 200；帳本總列數不變（不寫庫） |
| 兩個寫入端點 body `{}` | 400 `bad_actor`；帳本總列數不變 |

- 舊網頁（base 的 `index.html` 與 i18n，瀏覽器快取裡的那一版）讀 v3 規則檔與 v3 回應：中英文各 5 條全過、沒有未捕捉的例外。
  畫面是舊字眼配新數字：「籌碼 400」「下一座場景要 300 顆」「雲端搭乘 0 次・再 1 次拿 1 顆」「這條線的籌碼 ×2」「每天最多 500 顆」；
  `perTrip` 0 讓「一趟得幾顆」與合格兩句不畫。重新整理拿到新頁就好。

## 7. 部署

`docs/bounty/lanes/bounty-v3-points-deploy.md`。P0、P1 已在 10-27 經使用者 go 執行，0017 已套上正式庫（結果寫在部署清單第 1、2 節末，V0 也在那裡）。
P2–P5 也在 10-27 經使用者 go 執行：main 快進到 `9f38ba42`，正式站 21:12 換成 `15ae640a`（v3，寫入總閘照舊關著），上線後檢查全過（部署清單第 3–6 節各節末）。
P6 開寫入總閘也在 10-27 21:18 經使用者 go 執行：開閘版 `4da39d7f`，三個寫入端點送 `{}` 都回 `400 bad_actor`（部署清單 P6 段末）。
開閘後的帳本檢查：10-27 21:54 先在判定 cron 之前留了一份快照（帳本 0 列、n＝0、strike 0、正在跑的是開閘版 `4da39d7f`，部署清單 P6 段末），22:13 護照在真機讀過錢包之後又留一份，一樣是 0 列、n＝0；原定那次（10-28 03:30 判定跑完之後）還沒做，排在 04:07。
**22:58 起 n＞0**：主線寫了一筆 owner-demo 人工加點（+1100），使用者隨後在 iPhone 上兌換了一座（23:04 本線實查 n＝3）。從這裡起退不回 V0，出事只能凍結寫入（做法與前提、04:07 的判準都在部署清單 P6 段末「22:58 起 n＞0」）。

- 兩個資料檔會當靜態資產發出去：`.assetsignore` 沒擋到 `data/bounty_rules.json`、`data/bounty_sections.json`（部署清單 P2 第 5 步的指令，含要被擋的對照組）；
  ship-web 只上傳出貨那顆 commit 裡的檔，路段檔是新檔，要確認在 commit 裡。
- 快取不用改：`_headers` 的 `/data/*` 只加 CORS，Cache-Control 走預設 `public, max-age=0, must-revalidate`，每次讀都用 ETag 驗。
  規則檔要跟 Worker 同時換、新 App 又會線上讀，不能給 `max-age`（理由寫在部署清單 P5）。
- 正式站現況（10-26 唯讀標頭查詢，沒打 API）：規則檔、單位檔都是 200、`application/json`、`access-control-allow-origin: *`、上面那組 Cache-Control；
  規則檔帶 ETag 再讀回 304、0 bytes；路段檔 404（還沒上）。上線後同一組檢查在部署清單 P5，10-27 上線後跑過：兩個檔都是這組標頭、路段檔 200、帶 ETag 再讀 304。
- 隱私權政策「校正旅程」那條的入口句（`privacy.html:58`，英日 `i18n/legal-translations.js:84`、`:166`）10-27 改成 App 1.7.3 的流程，跟 v3 同一次上傳；
  生效日維持 10-25、其他法務文字沒動，理由與要分開出的情況寫在部署清單第 0 節。本機三語實際打開驗過；P3 預覽使用者看過，P5 在正式站三語再打開一次都是新句。

## 8. 沒驗到的

- 正式 D1：10-27 只做了 P0 唯讀盤點與 P1 兩句 `ALTER`。0017 套上之後對還在線上的 v2 無害，根據是讀程式碼：v2 寫這兩張表的 INSERT 全部明列欄位（部署清單第 0 節），讀取也都點名欄位、沒有 `SELECT *`（base `worker.js` 實查）。
  沒打正式站 API 確認；寫入總閘關著、兩張表都是空的，v2 在有 `unit` 欄的庫上寫入的情況還沒實際發生過。
- 正式站：P5 打過看板、全新裝置 id 的 chips-me、兩個寫入端點送 `{}`（503），加上 P0 的 08，都是唯讀或在碰 D1 之前就回。
  寫入總閘 10-27 21:18 才打開，開閘當下帳本是空的；點數制的入帳（判定 cron 給的點數）、換算、雲端搭乘在正式庫上還沒看到實際發生（截至 23:04）；兌換 23:00 在 iPhone 222 上走通一座，餘額是 owner-demo 人工加點（+1100），不是賺來的。
- 1.7.3 連上正式站的 v3：10-27 22:1x 使用者在 iOS 222（TestFlight）真機看過護照頂端卡與「找任務」畫面，都對；22:57 起同一台 iPhone 還上傳了兩段短樣本、23:00 兌換了一座，伺服器都收到（本線 23:04 實查）。Android 121、判定入帳與雲端搭乘，本線沒看到真機對正式站走過的紀錄（10-27 凌晨那次見下一條）。
  App 端只讀了程式（10-27 夜，native `09a9d9e12`＝222／121 的建包基準，已在 `origin/main`）：護照頂端「校正懸賞」卡沒有遠端開關（iOS `PassportHeroCards.swift:13`，Release 的 `bountyEnabled` 恆為 `true`，`M3Views.swift:7`），
  字眼跟 `chips-me` 的 `unit`（`PassportHeroCards.swift:46`，沒有 `unit` 才寫「籌碼」）；懸賞板每次打開都用 `Cache-Control: no-cache` 重讀規則檔與區段檔（`BountyPlanStore.swift` 的 `refresh()`），讀到才換成點數字眼與預估，
  只有打包的那份時被當舊規則（`pointUnit` 設 false：字眼照舊、不出預估）。打包的規則檔跟 `data/bounty_rules.json` 位元組相同。
  `13a622760`（凌晨的 1.7.3 除錯包）沒有那張卡（`git ls-tree` 查不到 `PassportHeroCards`），所以跑著舊 build 的手機護照會是舊版面。
- 1.7.3 真機：A54、iPhone 10-27 都看過（1.5 節最後一段）；iPhone 護照裡的錢包列沒截到，同一個元件在看板那張有。
  10-26 夜在自己開的 emulator 試過：Mac 負載太高，App 啟動逾時被系統結束（`start timeout`），沒拿到畫面。
- 預覽網址在 Cloudflare Access 後面，只有使用者本人開得起來。
- D1「每次呼叫的查詢數」（v2 交接檔 5.8）：v3 的 chips-me 多一句換算、兌換的 batch 多一句換算；判定 cron 的句數沒有重估。
- 本機只在台北晚上 21 點左右打過 cloud-ride（捷運時段內）；跨午夜的日界線靠 node 判準，沒有在本機 worker 上打。
- CH1h 的 `dailyMax` 守門沒做突變。
