export interface Subscriber {
  user_id: string;
  bot_token: string;
  context_token: string;
  sync_buf: string;
  created_at: number;
  token_updated_at: number;
  last_reminder_at: number;
}

export interface PendingSubscriber {
  user_id: string;
  bot_token: string;
  sync_buf: string;
  created_at: number;
}

export interface QrSession {
  session_id: string;
  qrcode: string;
  qr_url: string;
  status: string;
  bot_token: string | null;
  user_id: string | null;
  created_at: number;
}

// ── sync_state ──────────────────────────────────────────────────────────────

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

export async function getLastNewsMessage(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM sync_state WHERE key = 'last_news_message'")
    .first<{ value: string }>();
  return row?.value ?? null;
}

export async function saveLastNewsMessage(db: D1Database, message: string): Promise<void> {
  await db
    .prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES ('last_news_message', ?)")
    .bind(message)
    .run();
}

// ── subscribers ──────────────────────────────────────────────────────────────

// Returns true if this is a brand-new subscriber (first message ever).
export async function upsertSubscriber(
  db: D1Database,
  userId: string,
  botToken: string,
  contextToken: string,
  syncBuf: string,
): Promise<boolean> {
  const existing = await db
    .prepare("SELECT 1 FROM subscribers WHERE user_id = ?")
    .bind(userId)
    .first();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO subscribers (user_id, bot_token, context_token, sync_buf, created_at, token_updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         bot_token        = CASE WHEN excluded.bot_token != '' THEN excluded.bot_token ELSE bot_token END,
         context_token    = excluded.context_token,
         sync_buf         = excluded.sync_buf,
         token_updated_at = excluded.token_updated_at`
    )
    .bind(userId, botToken, contextToken, syncBuf, now, now)
    .run();
  return !existing;
}

export async function updateSubscriberSyncBuf(
  db: D1Database,
  userId: string,
  syncBuf: string,
): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET sync_buf = ? WHERE user_id = ?")
    .bind(syncBuf, userId)
    .run();
}

export async function deleteSubscriber(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("DELETE FROM subscribers WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function listSubscribers(db: D1Database): Promise<Subscriber[]> {
  const result = await db
    .prepare("SELECT user_id, bot_token, context_token, sync_buf, created_at, token_updated_at, last_reminder_at FROM subscribers")
    .all<Subscriber>();
  return result.results;
}

export async function updateLastReminder(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("UPDATE subscribers SET last_reminder_at = ? WHERE user_id = ?")
    .bind(Date.now(), userId)
    .run();
}

// ── pending_subscribers ──────────────────────────────────────────────────────

export async function upsertPending(
  db: D1Database,
  userId: string,
  botToken: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT OR REPLACE INTO pending_subscribers (user_id, bot_token, sync_buf, created_at)
       VALUES (?, ?, '', ?)`
    )
    .bind(userId, botToken, now)
    .run();
}

export async function getPending(db: D1Database, userId: string): Promise<PendingSubscriber | null> {
  return db
    .prepare("SELECT user_id, bot_token, sync_buf, created_at FROM pending_subscribers WHERE user_id = ?")
    .bind(userId)
    .first<PendingSubscriber>();
}

export async function listPending(db: D1Database): Promise<PendingSubscriber[]> {
  return (
    await db.prepare("SELECT user_id, bot_token, sync_buf, created_at FROM pending_subscribers").all<PendingSubscriber>()
  ).results;
}

export async function updatePendingSyncBuf(
  db: D1Database,
  userId: string,
  syncBuf: string,
): Promise<void> {
  await db
    .prepare("UPDATE pending_subscribers SET sync_buf = ? WHERE user_id = ?")
    .bind(syncBuf, userId)
    .run();
}

export async function deletePending(db: D1Database, userId: string): Promise<void> {
  await db
    .prepare("DELETE FROM pending_subscribers WHERE user_id = ?")
    .bind(userId)
    .run();
}

export async function cleanupStalePending(db: D1Database, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await db
    .prepare("DELETE FROM pending_subscribers WHERE created_at < ?")
    .bind(cutoff)
    .run();
}

// ── qr_sessions ──────────────────────────────────────────────────────────────

export async function createQrSession(
  db: D1Database,
  sessionId: string,
  qrcode: string,
  qrUrl: string,
): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO qr_sessions (session_id, qrcode, qr_url, status, created_at)
       VALUES (?, ?, ?, 'pending', ?)`
    )
    .bind(sessionId, qrcode, qrUrl, now)
    .run();
}

export async function getQrSession(
  db: D1Database,
  sessionId: string,
): Promise<QrSession | null> {
  return db
    .prepare("SELECT * FROM qr_sessions WHERE session_id = ?")
    .bind(sessionId)
    .first<QrSession>();
}

export async function updateQrSession(
  db: D1Database,
  sessionId: string,
  fields: { qrcode?: string; qr_url?: string; status?: string; bot_token?: string; user_id?: string },
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (fields.qrcode   !== undefined) { sets.push("qrcode = ?");    vals.push(fields.qrcode); }
  if (fields.qr_url   !== undefined) { sets.push("qr_url = ?");    vals.push(fields.qr_url); }
  if (fields.status   !== undefined) { sets.push("status = ?");    vals.push(fields.status); }
  if (fields.bot_token!== undefined) { sets.push("bot_token = ?"); vals.push(fields.bot_token); }
  if (fields.user_id  !== undefined) { sets.push("user_id = ?");   vals.push(fields.user_id); }
  if (sets.length === 0) return;
  vals.push(sessionId);
  await db
    .prepare(`UPDATE qr_sessions SET ${sets.join(", ")} WHERE session_id = ?`)
    .bind(...vals)
    .run();
}

export async function cleanupStaleQrSessions(db: D1Database, maxAgeMs: number): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  await db
    .prepare("DELETE FROM qr_sessions WHERE created_at < ?")
    .bind(cutoff)
    .run();
}
