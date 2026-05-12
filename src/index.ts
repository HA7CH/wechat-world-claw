import {
  getUpdates, sendTextMessage, extractText, getBotQrCode, pollQrCodeStatus,
  ILinkError, type WeixinMessage,
} from "./wechat";
import {
  getSyncBuf, saveSyncBuf,
  upsertSubscriber, updateSubscriberSyncBuf, updateLastReminder, deleteSubscriber, listSubscribers,
  upsertPending, getPending, listPending, updatePendingSyncBuf, deletePending, cleanupStalePending,
  createQrSession, getQrSession, updateQrSession, cleanupStaleQrSessions,
  getLastPushTime, saveLastPushTime, getLastNewsMessage, saveLastNewsMessage,
  type Subscriber, type PendingSubscriber,
} from "./db";
import { fetchNews } from "./sources/news";
import { formatMessage } from "./formatter";
import { landingPageHtml, subscribePageHtml } from "./landing";

export interface Env {
  DB: D1Database;
  WECHAT_TOKEN: string;       // legacy main-bot token (also used as fallback)
  WECHAT_ACCOUNT_ID: string;
  ALERT_WEBHOOK_URL?: string;
}

const WELCOME_MSG = "已订阅 📡 世界速报，每两小时推送国际要闻。有新消息才推，不刷屏。\n\n回复「退订」可随时取消。";
const UNSUBSCRIBE_MSG = "已取消订阅，感谢使用！👋 如需重新订阅，发送任意消息即可。";

const FIRST_REMINDER = "\n\n💬 另外，觉得还不错的话，随手回复一下（比如「收到」）就能保持推送继续哦，不然过两天会自动停掉～";
const SECOND_REMINDER = "📢 推送快到期了\n\n已经有一段时间没收到您的回复，再不续期的话明天起就推不过去了。\n\n回复任意内容（比如「收到」）就能续期，感谢支持！🙏";

const UNSUBSCRIBE_KEYWORDS = ["退订", "取消订阅", "退出", "取消", "unsubscribe"];

const FIRST_WARN_MS  = 36 * 60 * 60 * 1000;  // 36h: 第一次温和提醒（附在新闻后）
const SECOND_WARN_MS = 44 * 60 * 60 * 1000;  // 44h: 第二次独立消息
const TOKEN_TTL_MS   = 48 * 60 * 60 * 1000;  // 48h: 停止推送

// ── helpers ──────────────────────────────────────────────────────────────────

function randomId(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendAlert(env: Env, message: string): Promise<void> {
  console.error(`[ALERT] ${message}`);
  if (!env.ALERT_WEBHOOK_URL) return;
  try {
    await fetch(env.ALERT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    });
  } catch (err) {
    console.error("[alert] webhook failed:", err);
  }
}

function botToken(sub: Subscriber | PendingSubscriber, env: Env): string {
  return (sub.bot_token && sub.bot_token !== "") ? sub.bot_token : env.WECHAT_TOKEN;
}

// ── push ─────────────────────────────────────────────────────────────────────

type BroadcastEntry = { user_id: string; token: string; context_token: string; message: string };

async function batchBroadcast(
  entries: BroadcastEntry[],
  batchSize = 10,
  delayMs = 500,
): Promise<{ ok: number; failed: number; stale: number }> {
  let ok = 0, failed = 0, stale = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((e) => sendTextMessage(e.token, e.user_id, e.context_token, e.message))
    );

    results.forEach((r, j) => {
      if (r.status === "fulfilled") {
        ok++;
      } else {
        const err = r.reason;
        if (err instanceof ILinkError && err.isStaleToken) {
          stale++;
          console.log(`[push] stale token for ${batch[j].user_id}`);
        } else if (err instanceof ILinkError && err.isRateLimit) {
          failed++;
          console.warn(`[push] rate limited for ${batch[j].user_id}`);
        } else {
          failed++;
          console.error(`[push] failed for ${batch[j].user_id}:`, err);
        }
      }
    });

    if (i + batchSize < entries.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return { ok, failed, stale };
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

// ── poll: main bot (legacy subscribers) ──────────────────────────────────────

async function pollMainBot(env: Env): Promise<"ok" | "session_expired" | "error"> {
  let syncBuf: string;
  try {
    syncBuf = await getSyncBuf(env.DB);
  } catch (err) {
    console.error("[poll] getSyncBuf failed:", err);
    return "error";
  }

  const { newSyncBuf, sessionExpired, messages } = await pollBot(env.WECHAT_TOKEN, syncBuf);

  if (sessionExpired) {
    await sendAlert(
      env,
      "⚠️ 中登BOT: Bot session 已过期（errcode -14），请运行 npm run login 重新扫码登录并更新 WECHAT_TOKEN。"
    );
    return "session_expired";
  }

  if (newSyncBuf) {
    try { await saveSyncBuf(env.DB, newSyncBuf); } catch { /* non-fatal */ }
  }

  for (const msg of messages) {
    const userId = msg.from_user_id!;
    const contextToken = msg.context_token!;
    const text = extractText(msg);
    const token = env.WECHAT_TOKEN;

    if (UNSUBSCRIBE_KEYWORDS.some((kw) => text.includes(kw))) {
      try {
        await deleteSubscriber(env.DB, userId);
        await sendTextMessage(token, userId, contextToken, UNSUBSCRIBE_MSG);
        console.log(`[poll/main] unsubscribed: ${userId}`);
      } catch (err) {
        console.error(`[poll/main] unsubscribe failed for ${userId}:`, err);
      }
      continue;
    }

    try {
      // For legacy subscribers the bot_token stays empty (uses WECHAT_TOKEN).
      const isNew = await upsertSubscriber(env.DB, userId, "", contextToken, newSyncBuf ?? syncBuf);
      if (isNew) {
        await sendTextMessage(token, userId, contextToken, WELCOME_MSG);
        console.log(`[poll/main] new subscriber: ${userId}`);
      } else {
        console.log(`[poll/main] token refreshed: ${userId}`);
      }
    } catch (err) {
      console.error(`[poll/main] failed to register ${userId}:`, err);
    }
  }

  return "ok";
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

    // Send the last broadcast, or fall back to fetching the most recent news fresh.
    let newsMsg = await getLastNewsMessage(env.DB).catch(() => null);
    if (!newsMsg) {
      const sixHoursAgo = Date.now() - 6 * 60 * 60 * 1000;
      const fresh = await fetchNews(sixHoursAgo).catch(() => null);
      if (fresh && fresh.items.length > 0) newsMsg = formatMessage(fresh);
    }
    if (newsMsg) {
      await sendTextMessage(p.bot_token, p.user_id, contextToken, newsMsg);
    }
    console.log(`[pending] activated: ${p.user_id}${newsMsg ? " (sent news)" : ""}`);
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

async function runScheduled(env: Env): Promise<void> {
  // Cleanup stale sessions/pending (8-minute QR expiry + buffer; 24h pending TTL).
  await Promise.allSettled([
    cleanupStaleQrSessions(env.DB, 15 * 60 * 1000),
    cleanupStalePending(env.DB, 24 * 60 * 60 * 1000),
  ]);

  const lastPushTime = await getLastPushTime(env.DB).catch(() => 0);

  const [mainResult, newsResult] = await Promise.allSettled([
    pollMainBot(env),
    fetchNews(lastPushTime),
  ]);

  // Poll pending and own-bot subscribers in parallel with the rest.
  await Promise.allSettled([
    pollPendingSubscribers(env),
    pollOwnBotSubscribers(env),
  ]);

  const mainExpired = mainResult.status === "fulfilled" && mainResult.value === "session_expired";
  if (mainExpired) {
    console.log("[push] main bot session expired — own-bot subscribers will still be pushed");
  }

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
  const newsMessage = formatMessage(news);

  const newsEntries: BroadcastEntry[] = [];
  const secondReminderEntries: BroadcastEntry[] = [];
  let skipped = 0;

  for (const sub of subscribers) {
    const ageMs = now - sub.token_updated_at;
    const tok = botToken(sub, env);

    if (ageMs >= TOKEN_TTL_MS) {
      skipped++;
      console.log(`[push] skip ${sub.user_id}: token age ${Math.round(ageMs / 36e5)}h > TTL`);
      continue;
    }

    if (ageMs >= SECOND_WARN_MS) {
      // 44–48h: standalone second reminder (only once — check last_reminder_at)
      const reminderAge = now - sub.last_reminder_at;
      if (sub.last_reminder_at === 0 || reminderAge > SECOND_WARN_MS) {
        secondReminderEntries.push({ user_id: sub.user_id, token: tok, context_token: sub.context_token, message: SECOND_REMINDER });
      }
      continue; // skip news push for this window
    }

    const message = ageMs >= FIRST_WARN_MS
      ? newsMessage + FIRST_REMINDER   // 36–44h: news + gentle first reminder
      : newsMessage;
    newsEntries.push({ user_id: sub.user_id, token: tok, context_token: sub.context_token, message });
  }

  console.log(`[push] ${news.items.length} items → news:${newsEntries.length} reminder2:${secondReminderEntries.length} expired:${skipped}`);

  const allEntries = [...newsEntries, ...secondReminderEntries];
  if (allEntries.length === 0) {
    console.log("[push] no recipients");
    return;
  }

  const { ok, failed, stale } = await batchBroadcast(allEntries);
  console.log(`[push] done — ok:${ok} failed:${failed} stale:${stale}`);

  // Record that second reminder was sent.
  await Promise.allSettled(
    secondReminderEntries.map((e) => updateLastReminder(env.DB, e.user_id))
  );

  await saveLastNewsMessage(env.DB, newsMessage).catch(() => {});

  const newestPubMs = Math.max(...news.items.map((it) => it.pubMs).filter(Boolean));
  await saveLastPushTime(env.DB, newestPubMs > 0 ? newestPubMs : Date.now()).catch(() => {});
}

// ── HTTP handlers ─────────────────────────────────────────────────────────────

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

  // QR confirmed — try to activate the pending subscriber on each poll.
  if (session.status === "confirmed" && session.user_id) {
    const pending = await getPending(env.DB, session.user_id);
    if (!pending) {
      // Already activated (moved out of pending_subscribers).
      return Response.json({ status: "activated" });
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
      ctx.waitUntil(runScheduled(env));
      return new Response("triggered", { status: 200 });
    }
    if (url.pathname === "/subscribe/status") {
      return handleSubscribeStatus(request, env, ctx);
    }
    if (url.pathname === "/subscribe") {
      return handleSubscribe(env);
    }
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(landingPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    return new Response("not found", { status: 404 });
  },
};
