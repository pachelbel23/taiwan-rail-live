-- 軌道邊卡片的推播交班表。一列保存通過清單，每輪重算目前與下一班，
-- 因而不共用只綁單班列車的 tra_wait_bindings。
-- uid 用於付費驗證後的帳號列數上限；所有時間欄位皆為 epoch 毫秒。
-- 卡片到期後多留五分鐘供收卡重試，再由 expire_ms 兜底清理。
CREATE TABLE IF NOT EXISTS trackside_bindings (
  token TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  passes TEXT NOT NULL,
  tick_mode TEXT NOT NULL DEFAULT 'phase',
  end_ms INTEGER NOT NULL,
  expire_ms INTEGER NOT NULL,
  bound_ms INTEGER NOT NULL,
  last_state TEXT,
  apns_env TEXT,
  fail_streak INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS trackside_bindings_expire ON trackside_bindings(expire_ms);
CREATE INDEX IF NOT EXISTS trackside_bindings_uid ON trackside_bindings(uid, bound_ms);
