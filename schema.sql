CREATE TABLE IF NOT EXISTS subscribers (
  user_id           TEXT PRIMARY KEY,
  context_token     TEXT NOT NULL,
  created_at        INTEGER NOT NULL,
  token_updated_at  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
