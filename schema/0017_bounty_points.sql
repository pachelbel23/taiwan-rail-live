-- 校正懸賞 v3：籌碼改點數（沿線 1 公里 1 點）。帳本與車庫解鎖各補一欄 unit，記這一列的數字是哪一種單位。
--
-- unit：'chip'＝v2 的籌碼（1 顆值 data/bounty_rules.json 的 chips.chipToPoints 點）；'point'＝v3 的點數。
--   預設是 'chip'：這個檔先套、v3 的 Worker 後出，中間這段時間還在跑的 v2 Worker 寫進來的列（它不知道這一欄）也一定是籌碼。
--   v3 的 Worker 每一句 INSERT 都明寫 'point'。
-- 換算不在這個檔裡做，由 v3 的 Worker 在每個人第一次讀餘額或兌換時做（worker.js 的 bountyPointsConvert）：
--   帳本補一筆 kind='adjust'、ref 以 'v3points|' 開頭的列，數額＝(chipToPoints − 1) × 這個人 unit='chip' 列的加總 − 已經補過的換算；
--   重跑算出來是 0 就不寫，不會重算。
--   🔴 不在這裡一次換：v2 的 Worker 把 SUM(delta) 當籌碼餘額、價格是 4／8，若在它還在線上時就補換算列，
--   每個人的「籌碼」一下子變 50 倍，可以把車庫全部換光。
-- garage_unlocks.unit：那一座當時是用籌碼還是點數付的（cost 的單位）。帳號合併時兩邊解過同一座、要退回較晚那一座的花費，
--   退款列照它的 unit 寫，用籌碼付的退款一樣會被換算成點數。
--
-- 🔴 所有環境都要跑（新環境＝0002 + 0014 + 0015 + 0016 + 0017）。先套 schema、再部署 v3 的 Worker。忘了套的症狀：
--    v3 Worker 每一句寫帳本、寫解鎖、讀餘額的 SQL 都提到 unit，缺欄整句失敗：chips-me、garage-redeem、cloud-ride 一律 503，
--    判定 cron 的入帳那一句丟錯（排在標記已判定之前，樣本留在 pending，補套之後下一發重判，不會永久漏發）。
-- 自成一檔：0014–0016 都已經套進正式庫，重套它們會在第一句 ALTER 中斷。重跑這個檔會報 duplicate column name（無害，代表已經套過）。
ALTER TABLE chip_ledger ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip';
ALTER TABLE garage_unlocks ADD COLUMN unit TEXT NOT NULL DEFAULT 'chip';
