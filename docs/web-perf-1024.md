# 網站效能檢視與改進（2026-10-24）

目標：雙 App 做完中階手機效能線之後，網站也要讓「大多數人的電腦」順暢跑。量測一律無視窗 Chrome（`channel:'chrome'`、headless）＋ CDP 降速：4× 代表一般文書筆電、8× 代表很舊或很省電的機器。模擬時刻釘在 08:00 尖峰（全台約 170 班在跑），不釘的話深夜只有 4 班、量不出問題。

分支 `perf/web-desktop-1024`，基準 origin/main `f4bd1987`（v1024a）。量測腳本在 `scripts/perf-web/`（profile／subtree／callers），全部原始數據在 `output/perf-web/`（已 ignore），重跑方式見最後一節。

## 一、結論（同一時段、同一台機器的 A/B：基準樹 vs 修改後，4× 降速，1440×900 @2x）

| 情境 | 基準 rAF fps | 修改後 | 基準 p95 幀距 | 修改後 | 每幀 tickCore | 修改後 |
|---|---|---|---|---|---|---|
| 全台平面（landing） | 60.1 | 60.2 | 16.8 ms | 16.8 ms | 9.15 ms | 5.36 ms |
| 全台拖曳 | 49.5 | 59.8 | 33.4 ms | 16.7 ms | 11.09 ms | 6.69 ms |
| 台北 z13 | 60.1 | 60.2 | 16.8 | 16.7 | 8.12 | 5.52 |
| 台北拖曳 | 57.6 | 60.1 | 16.8 | 16.7 | 9.87 | 6.10 |
| 跟車 | 60.0 | 60.2 | 16.8 | 16.8 | 8.81 | 5.98 |
| 3D 台北 z16 pitch 60 | 27.4 | 33.4 | 50 | 50 | 22.48 | 18.46 |

開機（同一組 A/B）：

| | 基準 | 修改後 |
|---|---|---|
| `state.ready` | 5.46 s | 4.11 s |
| 列車就緒 | 5.83 s | 4.49 s |
| 請求數 | 202 | 120 |
| 傳輸量（本機、未壓縮） | 50.2 MB | 23.2 MB |
| JS heap（就緒時） | 185 MB | 121 MB |

正式站是 brotli 壓縮：延後的三份股道剖面在線上約 8 MB（壓縮後），佔原本 14.7 MB 的一半以上。

8× 降速（很舊或很省電的機器，同一時段 A/B）：

| 情境 | 基準 rAF fps | 修改後 | 基準 p95 | 修改後 | 50 ms 以上的幀（6 秒內） |
|---|---|---|---|---|---|
| 全台平面 | 29.8 | 59.7 | 50 ms | 16.8 ms | 5 → 0 |
| 全台拖曳 | 22.7 | 37.2 | 83 ms | 50 ms | 36 → 8 |
| 跟車 | 27.7 | 42.5 | 50 ms | 33 ms | 4 → 2 |
| 3D 台北 z16 | 9.5 | 13.6 | 183 ms | 117 ms | 57 → 56 |

開機就緒 9.1 → 8.4 s、heap 159 → 111 MB。8× 下 2D 已經能用，3D 則兩邊都不能用——這類機器需要的是「別開 3D」，不是再省幾毫秒。

3D 剩下的瓶頸不在我們的程式：`maplibre-paint`（MapLibre 自己畫地圖＋建築＋地形）基準與修改後都約 11 ms／幀，我們這邊的 `3d-integration` 從 10.6 降到 9.1 ms。要再往上只能動畫質（dpr、建築、地形），那是取捨題，見第五節。

> 數字會隨機器當下狀態漂移（第一輪單獨量的基準 landing tickCore 是 15.3 ms、同時段 A/B 那輪是 9.15 ms），所以只拿**同一時段跑的 A/B** 做結論，不拿兩輪之間的差。

## 二、根因（基準 CPU profile，4× 降速，08:00 尖峰）

每幀 15 ms 裡最大的幾項：

1. **`updateBlockHolds`（issue #17 防追撞）7.4 ms／幀**：對全部台鐵車（約 1,800 班，不只在跑的）每幀各做一次 `liveDelaySec` → `easedShift`。鍵 `(_rday|sys:train)` 每次重新拼字串再進 Map 雜湊，加上 `blockKeyOf` 也每次拼；`easedShift` 連「沒有條目、目標 0」的快路徑都先讀一次 `performance.now()`。
2. **`drawSched` 12.9 ms／次**：
   - `isFavStationName` 用「`_favStNames.size` 為 0 就重載」當快取判準——沒有最愛站的人 size 永遠是 0，於是**每站每幀**重讀 localStorage 再 `JSON.parse`（`userDataRead`＋正規化佔 drawSched 15%）。
   - 同一班車的 `liveDelaySec` 被畫點、拖尾、閉塞、3D 各問一次，每次都重拼鍵。
   - `glowUnder`／`drawTrail` 在紙底（不發光）時仍先 `ctx.save()` 再判斷、再 `restore()`，白付兩對狀態複製。
   - `i18nNumber` 每次 `new Intl.NumberFormat`。
3. **逐幀 DOM 寫入逼出強制重排**：`#clock`／`#todOut`／`#count` 每幀寫同值 `textContent`（Chrome 同值也算 childList 變動）、`tod.value` 每幀寫；`#statBadge` 上有 MutationObserver → `fitBadgeDetail` → `getClientRects`；跟車面板每幀 `classList.add/remove`（同值也會發 mutation）打到 `body.dwell-show`，而 `view-controls.js` 用 MutationObserver 看 body class → 每幀 `layout()` 量版面。`paintTimeRail` 每幀讀 `clientWidth`，版面一髒就在幀內付重排。
4. **3D**：`map3d.js` 的 `project()` 每車每幀讀 `clientWidth/Height`（佔 update 11%）；`rail-3d.js` 的 `capture()` 每站每幀 `join(':')` 拼 id（佔 capture 13%）。
5. **開機**：立體算繪器（three.js 1.3 MB、整合模組、2.4 MB 顯示剖面）在 `style.load` 就掛，三份股道剖面（display／level／metro-display-profiles，解壓 23 MB）在開機就抓，但 `render()` 在 zoom < 13.8 一律清空——全台平面視角的人載了用不到。

## 三、改了什麼（每一行都對得回上面某一條）

`index.html`
- `liveDelaySec`：鍵記在車上（`_ldKey`，名冊日或系統變了才重算）。曾試過逐幀記憶（同幀同鐘回舊值），被 `verify_tra_motion` G1–G4 擋下——它們在同一幀直接改 `state.live.map` 再查，契約是「下一次查詢就反映新 target」——所以拿掉，只留鍵快取；拿掉後量測反而更好。
- `easedShift`：無條目且目標 0 先回 0，`performance.now()` 留給真的要算的。
- `blockKeyOf`：鍵記在車上。
- `isFavStationName`：改用 `_favStLoaded` 旗標判斷載過沒。
- `i18nNumber`：格式器依語言＋選項快取。
- `syncTimeUI`／`updateCount`／`drawSched` 班數：新增 `setText(el, s)`，只在值變了才寫；`tod.value` 同。
- `paintTimeRail`：寬度由 ResizeObserver 回報，不每幀讀 `clientWidth`；位移字串沒變不寫。
- `glowUnder`／`drawTrail`：先判斷 `trainGlow()` 再 `save()`。
- `updateFollowPanel`：狀態列文字走 `setText`；`run`／`dp-next`／`show`／`dwell-show` 一律 `classList.toggle(name, force)`（不變就不動 DOM）。

`rail-3d/integration/map3d.js`
- 視口尺寸 `viewW/viewH` 只在 map `resize` 事件重讀，取代 21 處 `el.clientWidth/Height`、`map.getCanvas().clientWidth/Height`。

`rail-3d.js`
- `capture()` 的車站 id 以 WeakMap 快取（連同 sys）。
- 新增 `rendererWanted()`：衛星原貌、地形、漫遊、鎖頭跟車、zoom ≥ 12.5、`?scene=3d`、`?visit` 之一成立才掛算繪器；`render()` 在沒有算繪器時每幀檢查一次，`style.load` 與開機也改成「要用才掛」。`attach()` 等 `physicalLoad` 與 `ensureProfiles()` 都到位才 `createLiveMap`。

`rail-3d/physical/client.js`
- `loadPhysicalMotion()` 開機只抓 network／dispatch／metro-network；三份剖面改成空殼物件，`ensureProfiles()` 時再抓、填進同一個物件（route-runtime 的 elevation／level／levelAt 都是查詢當下才讀 `profiles.entries`，所以不用改）。`portals` 改 getter，`portalPaths` 載入後重綁。

沒有動：`updateBlockHolds` 的節奏與演算法、閘門腳本、CSS、任何版面。

## 四、驗證

閘門（都在修改後的樹上跑，Chrome 無視窗）：

| 閘門 | 結果 |
|---|---|
| `scripts/verify_tra_motion.mjs`（誤點漸變、#17 阻擋、snap 規則） | 15 PASS / 0 FAIL |
| `scripts/verify_tra_eased_roster_day.mjs`（跨日名冊鍵） | 7 PASS / 0 FAIL |
| `scripts/verify_spark_cursor.mjs`（流量圖游標） | 5 PASS / 0 FAIL |
| `scripts/verify_phys_speed_cap.mjs`（實體股道速度上限） | 7 PASS / 0 FAIL |
| `scripts/verify_all_metro_motion.mjs`（全捷運運動，chromium） | 通過（輸出 `output/perf-web/gates/metro-motion.json`） |
| `scripts/verify_changelog_copy.mjs`（更新紀錄字數） | 通過 |
| `scripts/verify_easedshift_key.mjs`（台鐵∩林鐵撞號） | 深夜跑會自行中止（林鐵只跑白天）；10/24 09:43 白天補跑 K1–K7 全 ✓、rc=0 |

3D 延後掛載的行為抽查（`output/perf-web/check-lazy3d.mjs`，五種進場）：全台 z7.96 → 沒有算繪器、three.js 與三份剖面都沒下載；放大到台北 z16 → 掛上、54 輛模型、3,689 段橋梁結構、剖面已載；`?scene=3d` 深連結、`?map=landscape`、漫遊 → 一開始就掛；五個情境零頁面錯誤。

3D A/B 閘門 `scripts/verify_3d_performance.mjs`：通過（「可見車廂與列車投影逐值相同、無渲染例外」）。跑法是 `BASE_URL` 指基準樹的 server、`PERF_BASE_DIR` 指本樹——閘門只替換 index.html／rail-3d.js／map3d.js／night-map.js 四個檔，client.js 的延遲載入由上面的行為抽查覆蓋。

畫面像素比對（`output/perf-web/visual-ab.mjs`：同一模擬時刻 08:00、暫停、同視角，基準樹 vs 修改後，RGB 差 >24 算不同）：

| 視角 | 1440×900 | 375×812 | 360×740 | 414×896 | 768×1024 |
|---|---|---|---|---|---|
| 全台 | 0 px | 463 px（0.15%） | – | – | – |
| 台北 z13 | 2 px | 37 px（0.01%） | 37 px | – | 0 px |
| 跟車 | 145 px（0.01%） | 267 px（0.09%） | – | 356 px（0.10%） | – |

差異像素畫出來看（`output/perf-web/visual-ab/*-diff.png`）全是列車光環的呼吸圈——那個動畫吃牆鐘不吃模擬時刻，兩次截圖拍到不同相位；其餘畫面逐像素相同。每個視角兩邊的 zoom、班數、時鐘、跟車狀態列文字與 class 完全相同、零頁面錯誤。手機 375 寬播放 2.5 秒後時鐘 08:00→08:03、滑桿 480→483、班數 170→168 都在更新；桌機時刻尺位移 59.1→57.08 px 有在捲，視窗 1440→1100 後 ResizeObserver 回報的寬度等於實際 clientWidth。

## 五、尚未做、留給下一步判斷

- **3D 在 4× 降速只有 33 fps**，瓶頸是 MapLibre 的繪製（建築擠出＋地形＋傾斜 60°）。可做的是「省電模式再降 dpr 到 1.5、或在 3D 關掉建築層」這類畫質取捨，需要使用者看過畫面再決定。
- **自動降級（對應 App 的中低階模式）**：8× 量到 2D 可用、3D 不可用（10–14 fps）。做法可以比照 App 的建議卡：偵測到「立體列車開著、連續幾秒 rAF 幀距中位數 > 60 ms、沒在互動」就把立體列車切回平面並吐司「這台電腦跑立體列車太吃力，已改用平面；可在觀看設定重新開啟」。只影響這次開啟（不改 `ri-trains-enabled` 的使用者設定）。這會改變使用者看到的畫面，等使用者決定要不要做、要不要用更保守的門檻。既有的 30 fps 省電模式對 2D 幫助不大（8× 下 2D 瓶頸是每幀的工作量，不是幀率上限），不建議拿它當兜底。
- ~~`verify_easedshift_key` 白天再補跑一次~~：10/24 09:43 已補跑，K1–K7 全 ✓。

## 六、怎麼重跑

```bash
# dev server（worktree 根）
PORT=5248 node scripts/dev_server.mjs
# 量測（情境：landing,drag,city,drag-city,follow,3d；PROFILE=mac|win；CPU_RATE=4|8）
PROFILE=mac CPU_RATE=4 OUT=output/perf-web/<名稱> node scripts/perf-web/profile.mjs
# 拆 CPU profile
node scripts/perf-web/subtree.mjs output/perf-web/<名稱>/landing.cpuprofile updateBlockHolds 20
node scripts/perf-web/callers.mjs output/perf-web/<名稱>/landing.cpuprofile "get clientWidth"
# 對照樹：git archive f4bd1987 | tar -x -C output/perf-web/base-tree；PORT=5249 node output/perf-web/base-tree/scripts/dev_server.mjs
```
