-- AI 營運整理的推播（scripts/rail_push.mjs）。所有時間欄位皆為 epoch 毫秒。
-- rail_push_devices：允許通知的 App 安裝。token 是 APNs device token（hex）；topic＝App 的 bundle id。
-- apns_env 第一次送成功才知道（'prod'／'sandbox'），未知時兩邊都試。
-- off＝使用者關掉的系統（JSON 陣列）；watching＝目前開著跟車／等車卡的系統，到 watching_until 為止。
-- admin＝收核可請求的裝置；tester＝測試請求的收件人。兩個旗標都只用 SQL 手動設定，App 改不到。
CREATE TABLE IF NOT EXISTS rail_push_devices (
  token TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  topic TEXT NOT NULL,
  apns_env TEXT,
  lang TEXT NOT NULL DEFAULT 'zh',
  off TEXT NOT NULL DEFAULT '[]',
  watching TEXT NOT NULL DEFAULT '[]',
  watching_until INTEGER NOT NULL DEFAULT 0,
  admin INTEGER NOT NULL DEFAULT 0,
  tester INTEGER NOT NULL DEFAULT 0,
  created_ms INTEGER NOT NULL,
  updated_ms INTEGER NOT NULL,
  fail_streak INTEGER NOT NULL DEFAULT 0
);
-- 每一則推播（草稿、核可請求、送出進度）。status：pending 待核可／approved 已核可送信中／sent 送完／
-- skipped 略過／superseded 被同系統新的一則取代／expired 沒人處理過期／dropped 模型判斷不值得推／error 草稿失敗。
-- title、body 是 {zh,en,ja}。nonce_hash＝核可按鈕用的一次性隨機碼的 SHA-256，隨機碼本身只在送給管理者的推播裡。
-- check_*＝AI 檢查（影子模式）的結論，只記錄、不影響發送。
CREATE TABLE IF NOT EXISTS rail_push_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_ms INTEGER NOT NULL,
  system TEXT NOT NULL,
  revision_id INTEGER,
  incident TEXT,
  category TEXT,
  tier TEXT,
  audience TEXT,
  title TEXT,
  body TEXT,
  reason TEXT,
  nonce_hash TEXT,
  status TEXT NOT NULL,
  test INTEGER NOT NULL DEFAULT 0,
  admin_sent INTEGER NOT NULL DEFAULT 0,
  decided_ms INTEGER,
  check_verdict TEXT,
  check_detail TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  estimate INTEGER,
  cursor TEXT,
  sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  done_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS rail_push_requests_status ON rail_push_requests(status, created_ms);
CREATE INDEX IF NOT EXISTS rail_push_requests_system ON rail_push_requests(system, created_ms);
-- 一般等級的推播送到了誰：同一件事恢復正常時，要通知「之前收過的人」。全體推播不記（恢復也推全體）。
CREATE TABLE IF NOT EXISTS rail_push_recipients (
  incident TEXT NOT NULL,
  token TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  PRIMARY KEY (incident, token)
) WITHOUT ROWID;
