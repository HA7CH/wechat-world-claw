CREATE TABLE IF NOT EXISTS subscribers (
  user_id          TEXT PRIMARY KEY,
  bot_token        TEXT NOT NULL DEFAULT '',  -- empty = use WECHAT_TOKEN (legacy)
  context_token    TEXT NOT NULL DEFAULT '',
  sync_buf         TEXT NOT NULL DEFAULT '',
  created_at       INTEGER NOT NULL,
  token_updated_at  INTEGER NOT NULL DEFAULT 0,
  last_reminder_at  INTEGER NOT NULL DEFAULT 0
);

-- Migration for existing deployments:
-- wrangler d1 execute wechat-world-push --command "ALTER TABLE subscribers ADD COLUMN bot_token TEXT NOT NULL DEFAULT ''; ALTER TABLE subscribers ADD COLUMN sync_buf TEXT NOT NULL DEFAULT '';"

CREATE TABLE IF NOT EXISTS pending_subscribers (
  user_id    TEXT PRIMARY KEY,
  bot_token  TEXT NOT NULL,
  sync_buf   TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qr_sessions (
  session_id TEXT PRIMARY KEY,
  qrcode     TEXT NOT NULL,
  qr_url     TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',  -- pending/confirmed/expired
  bot_token  TEXT,
  user_id    TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
