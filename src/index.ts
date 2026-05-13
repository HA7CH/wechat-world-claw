import {
  getUpdates, sendTextMessage, sendImageMessage, prepareImage, uploadPreparedImage,
  uploadPreparedVoice, sendVoiceMessage,
  extractText, getBotQrCode, pollQrCodeStatus, ILinkError,
  type WeixinMessage, type PreparedImage,
} from "./wechat";
import {
  upsertSubscriber, updateSubscriberSyncBuf, updateLastReminder, deleteSubscriber, listSubscribers, getSubscriber,
  upsertPending, getPending, listPending, updatePendingSyncBuf, deletePending, cleanupStalePending,
  createQrSession, getQrSession, updateQrSession, cleanupStaleQrSessions,
  getLastPushTime, saveLastPushTime, getLastNewsMessage, saveLastNewsMessage,
  type Subscriber, type PendingSubscriber,
} from "./db";
import { fetchNews } from "./sources/news";
import { formatMessage, shortenNewsLinks } from "./formatter";
import { renderNewsImage, renderNewsSvg } from "./image";
import { landingPageHtml, subscribePageHtml } from "./landing";

export interface Env {
  DB: D1Database;
  IMAGE_CACHE: KVNamespace;
  ALERT_WEBHOOK_URL?: string;
}

const WELCOME_MSG = "已订阅 📡 世界速报，每两小时推送国际要闻。有新消息才推，不刷屏。\n\n回复「退订」可随时取消。";
const UNSUBSCRIBE_MSG = "已取消订阅，感谢使用！👋 如需重新订阅，发送任意消息即可。";

const FIRST_REMINDER = "\n\n💬 另外，觉得还不错的话，随手回复一下（比如「收到」）就能保持推送继续哦，不然过两天会自动停掉～";
const SECOND_REMINDER = "📢 推送快到期了\n\n已经有一段时间没收到您的回复，再不续期的话明天起就推不过去了。\n\n回复任意内容（比如「收到」）就能续期，感谢支持！🙏";

const UNSUBSCRIBE_KEYWORDS = ["退订", "取消订阅", "退出", "取消", "unsubscribe"];

// WeChat iLink context_token effective TTL is ~12-14h, not 48h.
// Constants below shifted earlier so the keep-alive prompt actually reaches users.
const FIRST_WARN_MS  =  8 * 60 * 60 * 1000;  // 8h: 第一次温和提醒（附在新闻后）
const SECOND_WARN_MS = 11 * 60 * 60 * 1000;  // 11h: 第二次独立消息
const TOKEN_TTL_MS   = 14 * 60 * 60 * 1000;  // 14h: 停止推送（避免对死透的 token 浪费请求）

// ── helpers ──────────────────────────────────────────────────────────────────

function randomId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}



// ── push ─────────────────────────────────────────────────────────────────────

type BroadcastEntry = {
  user_id: string;
  token: string;
  context_token: string;
  message: string;
  needsFirstReminder?: boolean;
};

function handleBroadcastError(
  err: unknown, userId: string,
  counts: { ok: number; failed: number; stale: number }
) {
  if (err instanceof ILinkError && err.isStaleToken) {
    counts.stale++;
    console.log(`[push] stale token for ${userId}`);
  } else if (err instanceof ILinkError && err.isRateLimit) {
    counts.failed++;
    console.warn(`[push] rate limited for ${userId}`);
  } else {
    counts.failed++;
    console.error(`[push] failed for ${userId}:`, err);
  }
}

async function batchBroadcast(
  entries: BroadcastEntry[],
  perUser?: PerUserResult[],
  batchSize = 4,
  delayMs = 800,
): Promise<{ ok: number; failed: number; stale: number }> {
  let ok = 0, failed = 0, stale = 0;
  const counts = { ok, failed, stale };

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const t0s = batch.map(() => Date.now());
    const results = await Promise.allSettled(
      batch.map((e) => withRetry(
        () => sendTextMessage(e.token, e.user_id, e.context_token, e.message),
        `text ${e.user_id.slice(0, 20)}`
      ))
    );
    results.forEach((r, j) => {
      const u = batch[j].user_id;
      const latency = Date.now() - t0s[j];
      if (r.status === "fulfilled") {
        counts.ok++;
        perUser?.push({ user_id: u, status: "ok", latency_ms: latency });
      } else {
        handleBroadcastError(r.reason, u, counts);
        const err = r.reason;
        let status: PerUserResult["status"] = "failed";
        if (err instanceof ILinkError && err.isSessionExpired) status = "stale";
        else if (err instanceof ILinkError && err.isRateLimit) status = "rate_limit";
        const errstr = err instanceof ILinkError ? `iLink ${err.errcode}: ${err.errmsg}` : String(err).slice(0, 200);
        perUser?.push({ user_id: u, status, errcode: err instanceof ILinkError ? err.errcode : undefined, errmsg: errstr, latency_ms: latency });
      }
    });
    if (i + batchSize < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return counts;
}

// Per-user upload + send: CDN resource is bound to to_user_id, so each user needs own upload.
// Retry transient failures (CDN 5xx, iLink -2 non-frequency). Skip permanent ones.
async function withRetry<T>(fn: () => Promise<T>, label: string, retries = 1, baseDelayMs = 1000): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (err instanceof ILinkError && (err.isSessionExpired || err.isRateLimit)) {
        throw err;
      }
      if (attempt < retries) {
        const delay = baseDelayMs * (attempt + 1);
        console.warn(`[retry] ${label} attempt ${attempt + 1} failed, waiting ${delay}ms:`, err);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// Returns entries that failed image delivery (non-stale, non-expired) for text fallback.
export interface PerUserResult {
  user_id: string;
  status: "ok" | "failed" | "stale" | "rate_limit";
  errcode?: number;
  errmsg?: string;
  latency_ms: number;
}

async function batchBroadcastImage(
  entries: BroadcastEntry[],
  prepared: PreparedImage,
  perUser: PerUserResult[],
  batchSize = 2,
  delayMs = 1500,
): Promise<{ ok: number; failed: number; stale: number; textFallback: BroadcastEntry[] }> {
  let ok = 0, failed = 0, stale = 0;
  const counts = { ok, failed, stale };
  const textFallback: BroadcastEntry[] = [];

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const t0s = batch.map(() => Date.now());
    const results = await Promise.allSettled(
      batch.map((e) => withRetry(async () => {
        const upload = await uploadPreparedImage(e.token, e.user_id, prepared);
        await sendImageMessage(e.token, e.user_id, e.context_token, upload);
      }, `image ${e.user_id.slice(0, 20)}`))
    );
    results.forEach((r, j) => {
      const latency = Date.now() - t0s[j];
      const u = batch[j].user_id;
      if (r.status === "fulfilled") {
        counts.ok++;
        perUser.push({ user_id: u, status: "ok", latency_ms: latency });
      } else {
        const err = r.reason;
        if (err instanceof ILinkError && err.isSessionExpired) {
          counts.stale++;
          perUser.push({ user_id: u, status: "stale", errcode: err.errcode, errmsg: err.errmsg, latency_ms: latency });
        } else if (err instanceof ILinkError && err.isRateLimit) {
          counts.failed++;
          console.warn(`[push] rate limited (image) for ${u}`);
          perUser.push({ user_id: u, status: "rate_limit", errcode: err.errcode, errmsg: err.errmsg, latency_ms: latency });
        } else {
          // Push to textFallback; status logged as 'failed' here but
          // will be overwritten when text fallback runs.
          textFallback.push(batch[j]);
          const errstr = err instanceof ILinkError
            ? `iLink ${err.errcode}: ${err.errmsg}`
            : String(err).slice(0, 200);
          perUser.push({ user_id: u, status: "failed", errmsg: errstr, latency_ms: latency });
        }
      }
    });
    if (i + batchSize < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { ...counts, textFallback };
}

// ── poll: one bot's getupdates ────────────────────────────────────────────────

interface PollBotResult {
  newSyncBuf: string | null;
  sessionExpired: boolean;
  messages: WeixinMessage[];
}

async function pollBot(token: string, syncBuf: string, timeoutMs = 5_000): Promise<PollBotResult> {
  let resp;
  try {
    resp = await getUpdates(token, syncBuf, timeoutMs);
  } catch (err) {
    console.error("[poll] getUpdates error:", err);
    return { newSyncBuf: null, sessionExpired: false, messages: [] };
  }

  if (resp.errcode === -14 || resp.ret === -14) {
    return { newSyncBuf: null, sessionExpired: true, messages: [] };
  }

  const newSyncBuf = (resp.get_updates_buf && resp.get_updates_buf !== syncBuf)
    ? resp.get_updates_buf
    : null;

  const messages = (resp.msgs ?? []).filter(
    (m: WeixinMessage) => m.message_type === 1 && m.from_user_id && m.context_token
  );

  return { newSyncBuf, sessionExpired: false, messages };
}

// ── activate one pending subscriber ──────────────────────────────────────────

// Returns true if the subscriber was activated (first message received).
async function tryActivatePending(p: PendingSubscriber, env: Env, timeoutMs = 2_000): Promise<boolean> {
  const { newSyncBuf, sessionExpired, messages } = await pollBot(p.bot_token, p.sync_buf, timeoutMs);

  if (sessionExpired) {
    console.warn(`[pending] session expired for ${p.user_id}`);
    await deletePending(env.DB, p.user_id).catch(() => {});
    return false;
  }

  if (newSyncBuf) {
    await updatePendingSyncBuf(env.DB, p.user_id, newSyncBuf).catch(() => {});
  }

  const firstMsg = messages.find((m) => m.from_user_id === p.user_id);
  if (!firstMsg) return false;

  const contextToken = firstMsg.context_token!;
  const text = extractText(firstMsg);

  if (UNSUBSCRIBE_KEYWORDS.some((kw) => text.includes(kw))) {
    await deletePending(env.DB, p.user_id).catch(() => {});
    console.log(`[pending] user ${p.user_id} unsubscribed before activating`);
    return false;
  }

  try {
    await upsertSubscriber(env.DB, p.user_id, p.bot_token, contextToken, newSyncBuf ?? p.sync_buf);
    await deletePending(env.DB, p.user_id);
    await sendTextMessage(p.bot_token, p.user_id, contextToken, WELCOME_MSG);

    // Fetch fresh news, shorten URLs, send as text.
    const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
    const news = await fetchNews(sixHoursAgo).catch(() => null);
    let sentMode: "text" | "none" = "none";
    if (news && news.items.length > 0) {
      try {
        await sendTextMessage(p.bot_token, p.user_id, contextToken, formatMessage(news));
        sentMode = "text";
      } catch (err) {
        console.error(`[pending] news text send failed for ${p.user_id}:`, err);
      }
    } else {
      const lastMsg = await getLastNewsMessage(env.DB).catch(() => null);
      if (lastMsg) {
        await sendTextMessage(p.bot_token, p.user_id, contextToken, lastMsg).catch(() => {});
        sentMode = "text";
      }
    }
    console.log(`[pending] activated: ${p.user_id} (${sentMode})`);
    return true;
  } catch (err) {
    console.error(`[pending] failed to activate ${p.user_id}:`, err);
    return false;
  }
}

// ── poll: pending subscribers (waiting for first message) ────────────────────

async function pollPendingSubscribers(env: Env): Promise<void> {
  const pending = await listPending(env.DB).catch(() => [] as PendingSubscriber[]);
  if (pending.length === 0) return;
  await Promise.allSettled(pending.map((p) => tryActivatePending(p, env, 2_000)));
}

// ── poll: active own-bot subscribers (unsubscribe + token refresh) ────────────

async function pollOwnBotSubscribers(env: Env): Promise<void> {
  const subscribers = await listSubscribers(env.DB).catch(() => [] as Subscriber[]);
  const ownBot = subscribers.filter((s) => s.bot_token && s.bot_token !== "");
  if (ownBot.length === 0) return;

  await Promise.allSettled(ownBot.map(async (sub) => {
    const { newSyncBuf, sessionExpired, messages } = await pollBot(sub.bot_token, sub.sync_buf, 2_000);

    if (sessionExpired) {
      console.warn(`[poll/own] session expired for ${sub.user_id}`);
      return;
    }

    if (newSyncBuf) {
      await updateSubscriberSyncBuf(env.DB, sub.user_id, newSyncBuf).catch(() => {});
    }

    for (const msg of messages) {
      if (msg.from_user_id !== sub.user_id) continue;
      const contextToken = msg.context_token!;
      const text = extractText(msg);

      if (UNSUBSCRIBE_KEYWORDS.some((kw) => text.includes(kw))) {
        try {
          await deleteSubscriber(env.DB, sub.user_id);
          await sendTextMessage(sub.bot_token, sub.user_id, contextToken, UNSUBSCRIBE_MSG);
          console.log(`[poll/own] unsubscribed: ${sub.user_id}`);
        } catch (err) {
          console.error(`[poll/own] unsubscribe failed for ${sub.user_id}:`, err);
        }
        return;
      }

      // Refresh context token on any message.
      try {
        await upsertSubscriber(env.DB, sub.user_id, sub.bot_token, contextToken, newSyncBuf ?? sub.sync_buf);
        console.log(`[poll/own] token refreshed: ${sub.user_id}`);
      } catch (err) {
        console.error(`[poll/own] refresh failed for ${sub.user_id}:`, err);
      }
    }
  }));
}

// ── scheduled ────────────────────────────────────────────────────────────────

// CF Workers may run /trigger and /status in different isolates, so we
// persist broadcast results to D1 instead of module memory.
async function saveBroadcastResults(env: Env, payload: { push_at: number; results: PerUserResult[] }): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)")
    .bind("last_broadcast_results", JSON.stringify(payload))
    .run();
}

async function loadBroadcastResults(env: Env): Promise<{ push_at: number; results: PerUserResult[] }> {
  const row = await env.DB.prepare("SELECT value FROM sync_state WHERE key = ?")
    .bind("last_broadcast_results")
    .first<{ value: string }>();
  if (!row) return { push_at: 0, results: [] };
  try {
    return JSON.parse(row.value);
  } catch {
    return { push_at: 0, results: [] };
  }
}

const BROADCAST_PAUSED = true; // 项目已暂停 — 恢复时改为 false

async function runScheduled(env: Env, forceSinceMs?: number): Promise<void> {
  if (BROADCAST_PAUSED) {
    console.log("[push] broadcast paused — set BROADCAST_PAUSED=false to re-enable");
    return;
  }
  // Cleanup stale sessions/pending (8-minute QR expiry + buffer; 24h pending TTL).
  await Promise.allSettled([
    cleanupStaleQrSessions(env.DB, 15 * 60 * 1000),
    cleanupStalePending(env.DB, 2 * 60 * 60 * 1000),
  ]);

  const lastPushTime = forceSinceMs !== undefined ? forceSinceMs : await getLastPushTime(env.DB).catch(() => 0);

  const [newsResult] = await Promise.allSettled([
    fetchNews(lastPushTime),
    pollPendingSubscribers(env),
    pollOwnBotSubscribers(env),
  ]);

  const news = newsResult.status === "fulfilled" ? newsResult.value : null;
  if (!news || news.items.length === 0) {
    console.log("[push] no new articles since last push, skipping");
    return;
  }

  const subscribers = await listSubscribers(env.DB).catch((err) => {
    console.error("[push] listSubscribers failed:", err);
    return null;
  });

  if (!subscribers || subscribers.length === 0) {
    console.log("[push] no subscribers, skipping");
    return;
  }

  const now = Date.now();
  // Use original URLs (zaobao.com, thepaper.cn etc. are trusted by WeChat content scan).
  // Short URLs via wwc.ha7ch.com triggered "请稍后再试" rebroadcasts. See conversation 2026-05-13.
  const newsMessage = formatMessage(news);

  const newsEntries: BroadcastEntry[] = [];
  const secondReminderEntries: BroadcastEntry[] = [];
  let skipped = 0;

  for (const sub of subscribers) {
    const ageMs = now - sub.token_updated_at;
    const tok = sub.bot_token;

    if (ageMs >= TOKEN_TTL_MS) {
      skipped++;
      console.log(`[push] skip ${sub.user_id}: token age ${Math.round(ageMs / 36e5)}h > TTL`);
      continue;
    }

    if (ageMs >= SECOND_WARN_MS) {
      const reminderAge = now - sub.last_reminder_at;
      if (sub.last_reminder_at === 0 || reminderAge > SECOND_WARN_MS) {
        secondReminderEntries.push({ user_id: sub.user_id, token: tok, context_token: sub.context_token, message: SECOND_REMINDER });
      }
      continue;
    }

    newsEntries.push({
      user_id: sub.user_id,
      token: tok,
      context_token: sub.context_token,
      message: ageMs >= FIRST_WARN_MS ? newsMessage + FIRST_REMINDER : newsMessage,
      needsFirstReminder: ageMs >= FIRST_WARN_MS,
    });
  }

  console.log(`[push] ${news.items.length} items → news:${newsEntries.length} reminder2:${secondReminderEntries.length} expired:${skipped}`);

  if (newsEntries.length === 0 && secondReminderEntries.length === 0) {
    console.log("[push] no recipients");
    return;
  }

  // Per-user delivery tracking for this run.
  const perUser: PerUserResult[] = [];

  // Text-only broadcast (image broadcasting has CDN flakiness, replaced by text+short-URLs).
  if (newsEntries.length > 0) {
    const { ok, failed, stale } = await batchBroadcast(newsEntries, perUser);
    console.log(`[push] text — ok:${ok} failed:${failed} stale:${stale}`);
  }

  if (secondReminderEntries.length > 0) {
    const { ok, failed, stale } = await batchBroadcast(secondReminderEntries, perUser);
    console.log(`[push] reminder2 — ok:${ok} failed:${failed} stale:${stale}`);
    await Promise.allSettled(
      secondReminderEntries.map((e) => updateLastReminder(env.DB, e.user_id))
    );
  }

  await saveLastNewsMessage(env.DB, newsMessage).catch(() => {});

  const newestPubMs = Math.max(...news.items.map((it) => it.pubMs).filter(Boolean));
  await saveLastPushTime(env.DB, newestPubMs > 0 ? newestPubMs : Date.now()).catch(() => {});

  await saveBroadcastResults(env, { push_at: Date.now(), results: perUser }).catch((e) => console.error("[push] saveBroadcastResults failed:", e));
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

const LAWTED_USER_ID    = "o9cq80xZb97BwMafTGIOStmfcj0A@im.wechat";
const LAWTED_BOT_TOKEN  = "e1b7073e7f7f@im.bot:0600008e3decefd033bb5adeb5e499b73034cf";

// Debug wrapper: capture upload details into log[]
async function uploadPreparedImageDebug(
  token: string, toUserId: string,
  p: import("./wechat").PreparedImage,
  log: string[]
): Promise<import("./wechat").ImageUploadResult> {
  const filekey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")).join("");

  const body = JSON.stringify({
    filekey, media_type: 1, to_user_id: toUserId,
    rawsize: p.rawSize, rawfilemd5: p.rawMd5,
    filesize: p.fileSize,
    no_need_thumb: true,
    aeskey: p.aeskeyHex,
    base_info: { channel_version: "wechat-world-push-0.1.0" },
  });

  const uinBytes = crypto.getRandomValues(new Uint8Array(4));
  const uin = btoa(String(new DataView(uinBytes.buffer).getUint32(0, false)));
  const uploadResp = await fetch("https://ilinkai.weixin.qq.com/ilink/bot/getuploadurl", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "AuthorizationType": "ilink_bot_token",
      "Authorization": `Bearer ${token}`,
      "Content-Length": String(new TextEncoder().encode(body).length),
      "X-WECHAT-UIN": uin,
    },
    body,
  });
  const uploadJson = await uploadResp.json() as Record<string, unknown>;
  log.push(`getuploadurl keys: ${Object.keys(uploadJson).join(", ")}`);
  log.push(`getuploadurl full: ${JSON.stringify(uploadJson).slice(0, 200)}`);

  const cdnUrl = (uploadJson.upload_full_url as string) ?? "";
  if (!cdnUrl) throw new Error("no cdn url");

  const cdnResp = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: p.encryptedBuf,
  });
  const cdnHeaders: Record<string, string> = {};
  cdnResp.headers.forEach((v, k) => { cdnHeaders[k] = v.slice(0, 60); });
  log.push(`CDN status: ${cdnResp.status}`);
  log.push(`CDN headers: ${JSON.stringify(cdnHeaders)}`);

  const encryptQueryParam = cdnResp.headers.get("x-encrypted-param") ?? "";
  log.push(`x-encrypted-param: ${encryptQueryParam.slice(0,30)}...`);
  return { encryptQueryParam, aesKey: p.aesKey, fileSize: p.fileSize, rawSize: p.rawSize };
}

async function handleTestSend(env: Env): Promise<Response> {
  const log: string[] = [];
  try {
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    if (!sub) return new Response("subscriber not found", { status: 404 });
    log.push(`ctx: ${sub.context_token.slice(0, 40)}...`);

    const news = await fetchNews(Date.now() - 6 * 60 * 60 * 1000);
    if (!news || news.items.length === 0) return new Response("no news", { status: 200 });
    log.push(`news items: ${news.items.length}`);

    const imageBytes = await renderNewsImage(news);
    log.push(`png bytes: ${imageBytes.length}`);

    const prepared = await prepareImage(imageBytes);
    log.push(`encrypted bytes: ${prepared.fileSize}, rawMd5: ${prepared.rawMd5}`);

    const upload = await uploadPreparedImageDebug(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, prepared, log);
    log.push(`encryptQueryParam: ${upload.encryptQueryParam.slice(0, 40)}...`);
    log.push(`aesKey: ${upload.aesKey}`);
    log.push(`fileSize in msg: ${upload.fileSize}`);

    try {
      await sendImageMessage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, sub.context_token, upload);
      log.push("sendImageMessage: OK");
    } catch (err) {
      log.push(`sendImageMessage ERROR: ${String(err)}`);
    }

    return new Response(log.join("\n"), {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    log.push(`FATAL: ${String(err)}`);
    return new Response(log.join("\n"), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

// 3-second silk-v3 (24kHz) sample with Tencent header. Built locally from
// samplelib.com sample-3s.mp3 via silk-sdk. Used to verify WeChat renders
// voice as a playable bubble (encode_type=6).
const SAMPLE_SILK_B64 = "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";

async function handleTestVoiceSilk(env: Env): Promise<Response> {
  const log: string[] = [];
  try {
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    if (!sub) return new Response("subscriber not found", { status: 404 });

    const bin = atob(SAMPLE_SILK_B64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    // Keep Tencent's leading 0x02 byte — matches real WeChat-on-disk silk files.
    log.push(`silk bytes: ${bytes.length}, header: ${Array.from(bytes.slice(0, 10), (b) => b.toString(16).padStart(2, "0")).join(" ")}`);

    const prepared = await prepareImage(bytes);
    log.push(`encrypted: ${prepared.fileSize}, md5: ${prepared.rawMd5}`);

    const upload = await uploadPreparedVoice(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, prepared);
    log.push(`upload ok, eqp: ${upload.encryptQueryParam.slice(0, 30)}...`);

    try {
      await sendVoiceMessage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, sub.context_token, upload, {
        encodeType: 6, // silk
        sampleRate: 24000,
        bitsPerSample: 16,
        playtimeMs: 3180,
      });
      log.push("sendVoiceMessage: OK");
    } catch (err) {
      log.push(`sendVoiceMessage ERROR: ${String(err)}`);
    }

    return new Response(log.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (err) {
    log.push(`FATAL: ${String(err)}`);
    return new Response(log.join("\n"), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

async function handleTestVoice(env: Env, audioUrl: string): Promise<Response> {
  const log: string[] = [];
  try {
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    if (!sub) return new Response("subscriber not found", { status: 404 });

    log.push(`fetching: ${audioUrl}`);
    const resp = await fetch(audioUrl);
    if (!resp.ok) return new Response(`fetch failed: ${resp.status}`, { status: 500 });
    const bytes = new Uint8Array(await resp.arrayBuffer());
    log.push(`bytes: ${bytes.length}, content-type: ${resp.headers.get("content-type")}`);

    const prepared = await prepareImage(bytes);
    log.push(`encrypted: ${prepared.fileSize}, md5: ${prepared.rawMd5}`);

    const upload = await uploadPreparedVoice(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, prepared);
    log.push(`upload ok, eqp: ${upload.encryptQueryParam.slice(0, 30)}...`);

    try {
      await sendVoiceMessage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, sub.context_token, upload, {
        encodeType: 7,       // mp3
        sampleRate: 44100,
        bitsPerSample: 16,
        playtimeMs: 3000,
      });
      log.push("sendVoiceMessage: OK");
    } catch (err) {
      log.push(`sendVoiceMessage ERROR: ${String(err)}`);
    }

    return new Response(log.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (err) {
    log.push(`FATAL: ${String(err)}`);
    return new Response(log.join("\n"), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

async function handleTestPoll(env: Env): Promise<Response> {
  try {
    await pollOwnBotSubscribers(env);
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    return new Response(
      `poll done\nctx: ${sub?.context_token.slice(0, 40) ?? "(none)"}...`,
      { headers: { "Content-Type": "text/plain; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(`FATAL: ${String(err)}`, { status: 500 });
  }
}

async function handleTestText(env: Env, text: string, toUserId?: string): Promise<Response> {
  try {
    const targetUserId = toUserId ?? LAWTED_USER_ID;
    const sub = await getSubscriber(env.DB, targetUserId);
    if (!sub) return new Response(`subscriber not found: ${targetUserId}`, { status: 404 });
    const token = sub.bot_token || LAWTED_BOT_TOKEN;
    await sendTextMessage(token, targetUserId, sub.context_token, text);
    return new Response(`sendTextMessage: OK\nto: ${targetUserId}\ntext: ${text}`, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (err) {
    return new Response(`FATAL: ${String(err)}`, { status: 500 });
  }
}

async function handleTestUrlImage(env: Env, imgUrl: string): Promise<Response> {
  const log: string[] = [];
  try {
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    if (!sub) return new Response("not found", { status: 404 });

    log.push(`fetching: ${imgUrl}`);
    const fetchResp = await fetch(imgUrl);
    if (!fetchResp.ok) return new Response(`fetch failed: ${fetchResp.status}`, { status: 500 });
    const imgBytes = new Uint8Array(await fetchResp.arrayBuffer());
    log.push(`fetched ${imgBytes.length} bytes, type: ${fetchResp.headers.get("content-type")}`);

    const prepared = await prepareImage(imgBytes);
    log.push(`encrypted: ${prepared.fileSize} bytes, md5: ${prepared.rawMd5}`);

    const upload = await uploadPreparedImageDebug(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, prepared, log);
    log.push(`encryptQueryParam: ${upload.encryptQueryParam.slice(0, 40)}...`);

    try {
      await sendImageMessage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, sub.context_token, upload);
      log.push("sendImageMessage: OK");
    } catch (err) {
      log.push(`sendImageMessage ERROR: ${String(err)}`);
    }

    return new Response(log.join("\n"), { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    log.push(`FATAL: ${String(err)}`);
    return new Response(log.join("\n"), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}

// 1×1 白色像素 PNG (hardcoded)
const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function handleTestSmallImage(env: Env): Promise<Response> {
  const log: string[] = [];
  try {
    const sub = await getSubscriber(env.DB, LAWTED_USER_ID);
    if (!sub) return new Response("not found", { status: 404 });

    // Use ha7ch avatar as test image
    const fetchResp = await fetch("https://www.ha7ch.com/ha7ch-avatar.png");
    const imageBytes = new Uint8Array(await fetchResp.arrayBuffer());
    log.push(`ha7ch avatar bytes: ${imageBytes.length}`);

    const prepared = await prepareImage(imageBytes);
    const upload = await uploadPreparedImage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, prepared);
    log.push(`upload ok, eqp: ${upload.encryptQueryParam.slice(0, 30)}...`);

    await sendImageMessage(sub.bot_token || LAWTED_BOT_TOKEN, LAWTED_USER_ID, sub.context_token, upload);
    log.push("sendImageMessage: OK");
    return new Response(log.join("\n"), { headers: { "Content-Type": "text/plain" } });
  } catch (err) {
    log.push(`ERROR: ${String(err)}`);
    return new Response(log.join("\n"), { status: 500, headers: { "Content-Type": "text/plain" } });
  }
}


async function handleTestImage(env: Env): Promise<Response> {
  // Serve cached PNG from last push (generated during cron with 30s CPU)
  const cached = await env.IMAGE_CACHE.get("latest", "arrayBuffer").catch(() => null);
  if (cached) {
    return new Response(cached, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
    });
  }

  // No cache yet — fall back to SVG preview (low CPU, fine for HTTP)
  try {
    const news = await fetchNews(Date.now() - 4 * 60 * 60 * 1000);
    if (!news || news.items.length === 0) {
      return new Response("No news yet. Trigger a push first: /trigger", { status: 200 });
    }
    const svg = await renderNewsSvg(news);
    return new Response(svg, {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Image-Note": "SVG preview only — PNG will be cached after first cron push",
      },
    });
  } catch (err) {
    console.error("[test-image] error:", err);
    return new Response(`Error: ${String(err)}`, { status: 500 });
  }
}

function qrImageUrl(content: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(content)}`;
}

async function handleSubscribe(env: Env): Promise<Response> {
  let qrResp;
  try {
    qrResp = await getBotQrCode();
  } catch (err) {
    console.error("[subscribe] getBotQrCode failed:", err);
    return new Response("暂时无法生成二维码，请稍后重试", { status: 503 });
  }

  const sessionId = randomId();
  // qrcode_img_content is the raw string to encode into a QR, not an image URL.
  const imgUrl = qrImageUrl(qrResp.qrcode_img_content);
  await createQrSession(env.DB, sessionId, qrResp.qrcode, imgUrl);

  return new Response(subscribePageHtml(sessionId, imgUrl), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Polls aggressively for up to maxMs to catch the user's first message.
async function waitForActivation(pending: PendingSubscriber, env: Env, maxMs = 25_000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const p = await getPending(env.DB, pending.user_id).catch(() => null);
    if (!p) return; // already activated by someone else
    const activated = await tryActivatePending(p, env, 3_000);
    if (activated) return;
    await new Promise((r) => setTimeout(r, 1_500));
  }
}

async function handleSubscribeStatus(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("s");
  if (!sessionId) return Response.json({ error: "missing session" }, { status: 400 });

  const session = await getQrSession(env.DB, sessionId);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });

  if (session.status === "expired") return Response.json({ status: "expired" });

  // QR confirmed — try to activate the pending subscriber on each frontend poll.
  // CF Workers can't sustain a 5-min background ctx.waitUntil, so we rely on the
  // browser's continued polling here to repeatedly catch the user's first message.
  if (session.status === "confirmed" && session.user_id) {
    const pending = await getPending(env.DB, session.user_id);
    if (!pending) {
      const sub = await getSubscriber(env.DB, session.user_id);
      return Response.json({ status: sub ? "activated" : "timed_out" });
    }
    const activated = await tryActivatePending(pending, env, 3_000);
    return Response.json({ status: activated ? "activated" : "confirmed" });
  }

  // Poll WeChat for current status (short timeout so the HTTP request doesn't hang).
  let wechatStatus;
  try {
    wechatStatus = await pollQrCodeStatus(session.qrcode, 4_000);
  } catch (err) {
    console.error("[subscribe/status] pollQrCodeStatus failed:", err);
    return Response.json({ status: "wait" });
  }

  if (wechatStatus.status === "confirmed") {
    const { bot_token, ilink_user_id } = wechatStatus;
    await Promise.allSettled([
      updateQrSession(env.DB, sessionId, { status: "confirmed", bot_token, user_id: ilink_user_id }),
      upsertPending(env.DB, ilink_user_id, bot_token),
    ]);
    console.log(`[subscribe] new pending subscriber: ${ilink_user_id}`);
    // Immediately start background polling — token expires in minutes.
    const pending = { user_id: ilink_user_id, bot_token, sync_buf: "", created_at: Date.now() };
    ctx.waitUntil(waitForActivation(pending, env, 25_000));
    return Response.json({ status: "confirmed" });
  }

  if (wechatStatus.status === "expired") {
    // Auto-refresh QR.
    try {
      const newQr = await getBotQrCode();
      const newImgUrl = qrImageUrl(newQr.qrcode_img_content);
      await updateQrSession(env.DB, sessionId, { qrcode: newQr.qrcode, qr_url: newImgUrl });
      return Response.json({ status: "new_qr", qr_url: newImgUrl });
    } catch {
      await updateQrSession(env.DB, sessionId, { status: "expired" });
      return Response.json({ status: "expired" });
    }
  }

  return Response.json({ status: wechatStatus.status });
}

// ── exports ───────────────────────────────────────────────────────────────────

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/trigger") {
      const force = url.searchParams.has("force");
      ctx.waitUntil(runScheduled(env, force ? 0 : undefined));
      return new Response("triggered" + (force ? " (force)" : ""), { status: 200 });
    }
    if (url.pathname.startsWith("/r/")) {
      const id = url.pathname.slice(3);
      const target = await env.IMAGE_CACHE.get(`url:${id}`);
      if (!target) return new Response("link expired", { status: 404 });
      return Response.redirect(target, 302);
    }
    if (url.pathname === "/status") {
      const filterUser = url.searchParams.get("user");
      const r = await loadBroadcastResults(env);
      const filtered = filterUser ? r.results.filter((x) => x.user_id.startsWith(filterUser)) : r.results;
      const ok = filtered.filter((x) => x.status === "ok").length;
      const failed = filtered.filter((x) => x.status === "failed").length;
      const stale = filtered.filter((x) => x.status === "stale").length;
      const rate = filtered.filter((x) => x.status === "rate_limit").length;
      const avgLatency = filtered.length ? Math.round(filtered.reduce((s, x) => s + x.latency_ms, 0) / filtered.length) : 0;
      return new Response(JSON.stringify({
        push_at: r.push_at,
        push_at_iso: r.push_at ? new Date(r.push_at).toISOString() : null,
        total: filtered.length,
        summary: { ok, failed, stale, rate_limit: rate },
        avg_latency_ms: avgLatency,
        results: filtered,
      }, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (url.pathname === "/trigger-sync") {
      const force = url.searchParams.has("force");
      try {
        await runScheduled(env, force ? 0 : undefined);
        const lp = await getLastPushTime(env.DB);
        return new Response(`done; last_push_at=${lp}`, { status: 200 });
      } catch (err) {
        return new Response(`FATAL: ${String(err)}`, { status: 500 });
      }
    }
    if (url.pathname === "/poll-pending") {
      await pollPendingSubscribers(env);
      const remaining = await listPending(env.DB).catch(() => []);
      return new Response(`pending after poll: ${remaining.length}\n${remaining.map((p) => `- ${p.user_id}`).join("\n")}`, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    if (url.pathname === "/debug-pending") {
      const list = await listPending(env.DB).catch(() => []);
      const results = await Promise.all(list.map(async (p) => {
        try {
          const resp = await getUpdates(p.bot_token, p.sync_buf, 3_000);
          return {
            user_id: p.user_id,
            bot_token_prefix: p.bot_token.slice(0, 20),
            sync_buf: p.sync_buf || "(empty)",
            errcode: resp.errcode ?? resp.ret,
            errmsg: resp.errmsg,
            msgs_count: resp.msgs?.length ?? 0,
            msgs: (resp.msgs ?? []).map((m) => ({
              message_type: m.message_type,
              from_user_id: m.from_user_id,
              has_context_token: !!m.context_token,
              item_count: m.item_list?.length,
            })),
          };
        } catch (err) {
          return { user_id: p.user_id, error: String(err) };
        }
      }));
      return new Response(JSON.stringify(results, null, 2), {
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (url.pathname === "/subscribe/status") {
      return handleSubscribeStatus(request, env, ctx);
    }
    if (url.pathname === "/subscribe") {
      return handleSubscribe(env);
    }
    if (url.pathname === "/test-image") {
      return handleTestImage(env);
    }
    if (url.pathname === "/test-send") {
      return handleTestSend(env);
    }
    if (url.pathname === "/test-text") {
      const text = url.searchParams.get("text") ?? "你好";
      const to = url.searchParams.get("to") ?? undefined;
      return handleTestText(env, text, to);
    }
    if (url.pathname === "/test-poll") {
      return handleTestPoll(env);
    }
    if (url.pathname === "/test-news-nolink") {
      const to = url.searchParams.get("to") ?? LAWTED_USER_ID;
      try {
        const sub = await getSubscriber(env.DB, to);
        if (!sub) return new Response("subscriber not found", { status: 404 });
        const news = await fetchNews(Date.now() - 6 * 60 * 60 * 1000);
        if (!news || news.items.length === 0) return new Response("no news", { status: 200 });
        const stripped = { items: news.items.map((it) => ({ ...it, link: "" })) };
        const msg = formatMessage(stripped);
        await sendTextMessage(sub.bot_token, sub.user_id, sub.context_token, msg);
        return new Response(`sendTextMessage: OK\nto: ${to}\nlength: ${msg.length} chars (no links)`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`FATAL: ${String(err)}`, { status: 500 });
      }
    }
    if (url.pathname === "/test-news") {
      const to = url.searchParams.get("to") ?? LAWTED_USER_ID;
      try {
        const sub = await getSubscriber(env.DB, to);
        if (!sub) return new Response("subscriber not found", { status: 404 });
        const news = await fetchNews(Date.now() - 6 * 60 * 60 * 1000);
        if (!news || news.items.length === 0) return new Response("no news", { status: 200 });
        const msg = formatMessage(news);
        await sendTextMessage(sub.bot_token, sub.user_id, sub.context_token, msg);
        return new Response(`sendTextMessage: OK\nto: ${to}\nlength: ${msg.length} chars (original URLs)`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`FATAL: ${String(err)}`, { status: 500 });
      }
    }
    if (url.pathname === "/test-news-short") {
      const to = url.searchParams.get("to") ?? LAWTED_USER_ID;
      try {
        const sub = await getSubscriber(env.DB, to);
        if (!sub) return new Response("subscriber not found", { status: 404 });
        const news = await fetchNews(Date.now() - 6 * 60 * 60 * 1000);
        if (!news || news.items.length === 0) return new Response("no news", { status: 200 });
        const shortened = await shortenNewsLinks(env.IMAGE_CACHE, news);
        const msg = formatMessage(shortened);
        await sendTextMessage(sub.bot_token, sub.user_id, sub.context_token, msg);
        return new Response(`sendTextMessage: OK\nto: ${to}\nlength: ${msg.length} chars`, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      } catch (err) {
        return new Response(`FATAL: ${String(err)}`, { status: 500 });
      }
    }
    if (url.pathname === "/test-voice") {
      const audioUrl = url.searchParams.get("url") ?? "https://samplelib.com/mp3/sample-3s.mp3";
      return handleTestVoice(env, audioUrl);
    }
    if (url.pathname === "/test-voice-silk") {
      return handleTestVoiceSilk(env);
    }
    if (url.pathname === "/test-tiny") {
      return handleTestSmallImage(env);
    }
    if (url.pathname === "/test-url") {
      const imgUrl = url.searchParams.get("url") ?? "https://www.ha7ch.com/ha7ch-avatar.png";
      return handleTestUrlImage(env, imgUrl);
    }
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(landingPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};
