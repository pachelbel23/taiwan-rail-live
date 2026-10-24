-- AI 營運整理（/api/rail-status、rail-status.html）。跟人工彙整 data/rail_weather_bulletin.json 完全分開。
-- 所有時間欄位皆為 epoch 毫秒。
-- rail_ai_kv：各來源上一輪的列表／燈號、待整理的系統、執行鎖、當月花費。
CREATE TABLE IF NOT EXISTS rail_ai_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_ms INTEGER NOT NULL
);
-- 偵測到的每一個變化（新公告、標題改變、燈號改變、TDX 公告出現或消失）。保留 30 天。
CREATE TABLE IF NOT EXISTS rail_ai_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  source TEXT NOT NULL,
  system TEXT NOT NULL,
  type TEXT NOT NULL,
  item_key TEXT,
  value TEXT,
  prev TEXT,
  relevant INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS rail_ai_events_at ON rail_ai_events(at_ms);
CREATE INDEX IF NOT EXISTS rail_ai_events_system ON rail_ai_events(system, at_ms);
-- 官方公告原文（去掉 HTML 的本文）：給 AI 當依據，也是事後查核的存證。
CREATE TABLE IF NOT EXISTS rail_ai_articles (
  url TEXT PRIMARY KEY,
  system TEXT NOT NULL,
  title TEXT,
  relevant INTEGER NOT NULL DEFAULT 0,
  first_seen_ms INTEGER NOT NULL,
  fetched_ms INTEGER NOT NULL,
  text TEXT
);
CREATE INDEX IF NOT EXISTS rail_ai_articles_system ON rail_ai_articles(system, first_seen_ms);
-- 每一版整理的完整快照（所有系統）。changed＝這一版改了哪些系統。
CREATE TABLE IF NOT EXISTS rail_ai_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at_ms INTEGER NOT NULL,
  changed TEXT NOT NULL,
  systems TEXT NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  meta TEXT
);
CREATE INDEX IF NOT EXISTS rail_ai_revisions_at ON rail_ai_revisions(at_ms);
-- 手動鎖定：列在這裡的系統 AI 不改寫，頁面改顯示人工彙整（人工彙整過期時顯示鎖定前最後一版）。
CREATE TABLE IF NOT EXISTS rail_ai_locks (
  system TEXT PRIMARY KEY,
  locked_ms INTEGER NOT NULL,
  note TEXT
);
