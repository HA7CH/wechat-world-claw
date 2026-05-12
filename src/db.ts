export interface Subscriber {
  user_id: string;
  context_token: string;
  created_at: number;
  token_updated_at: number;
}

export async function getSyncBuf(db: D1Database): Promise<string> {
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'getupdates_buf'")
    .first<{ value: string }>();
  return row?.value ?? "";
}

export async function saveSyncBuf(db: D1Database, buf: string): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('getupdates_buf', ?)")
    .bind(buf)
    .run();
}

// Returns true if this is a brand-new subscriber (first message ever)
export async function upsertSubscriber(
  db: D1Database,
  userId: string,
  contextToken: string
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT 1 FROM subscribers WHERE user_id = ?")
    .bind(userId)
    .first();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO subscribers (user_id, context_token, created_at, token_updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         context_token = excluded.context_token,
         token_updated_at = excluded.token_updated_at`
    )
    .bind(userId, contextToken, now, now)
    .run();
  return !existing;
}

export async function deleteSubscriber(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("DELETE FROM subscribers WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function listSubscribers(db: D1Database): Promise<Subscriber[]> {
  const result = await db
    .prepare("SELECT user_id, context_token, created_at, token_updated_at FROM subscribers")
    .all<Subscriber>();
  return result.results;
}

export async function getLastPushTime(db: D1Database): Promise<number> {
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_push_at'")
    .first<{ value: string }>();
  return row ? parseInt(row.value, 10) : 0;
}

export async function saveLastPushTime(db: D1Database, ms: number): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_push_at', ?)")
    .bind(String(ms))
    .run();
}
