import { getUpdates, sendTextMessage, extractText, ILinkError, type WeixinMessage } from "./wechat";
import {
  getSyncBuf, saveSyncBuf,
  upsertSubscriber, deleteSubscriber, listSubscribers,
  getLastPushTime, saveLastPushTime,
  type Subscriber,
} from "./db";
import { fetchNews } from "./sources/news";
import { formatMessage } from "./formatter";
import { landingPageHtml } from "./landing";

export interface Env {
  DB: D1Database;
  WECHAT_TOKEN: string;
  WECHAT_ACCOUNT_ID: string;
  ALERT_WEBHOOK_URL?: string; // 可选，Discord/Slack webhook，用于 bot session 过期告警
}

const WELCOME_MSG = "已订阅 📡 世界速报，每两小时推送国际要闻。有新消息才推，不刷屏。\n\n回复「退订」可随时取消。";
const UNSUBSCRIBE_MSG = "已取消订阅，感谢使用！👋 如需重新订阅，发送任意消息即可。";
const RENEWAL_REMINDER = "\n\n📌 您已超过44小时未回复，请回复任意内容（如「好」）以保持订阅，否则明日起将暂停推送。";

const UNSUBSCRIBE_KEYWORDS = ["退订", "取消订阅", "退出", "取消", "unsubscribe"];

const TOKEN_WARN_MS = 44 * 60 * 60 * 1000; // 44h: 开始显示续订提醒
const TOKEN_TTL_MS  = 48 * 60 * 60 * 1000; // 48h: 停止推送

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

type BroadcastEntry = { user_id: string; context_token: string; message: string };

async function batchBroadcast(
  token: string,
  entries: BroadcastEntry[],
  batchSize = 10,
  delayMs = 500,
): Promise<{ ok: number; failed: number; stale: number }> {
  let ok = 0, failed = 0, stale = 0;

  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map((e) => sendTextMessage(token, e.user_id, e.context_token, e.message))
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

type PollResult = "ok" | "session_expired" | "error";

async function pollAndRegister(env: Env): Promise<PollResult> {
  let syncBuf: string;
  try {
    syncBuf = await getSyncBuf(env.DB);
  } catch (err) {
    console.error("[poll] getSyncBuf failed:", err);
    return "error";
  }

  let resp;
  try {
    resp = await getUpdates(env.WECHAT_TOKEN, syncBuf, 5_000);
  } catch (err) {
    console.error("[poll] getUpdates failed:", err);
    return "error";
  }

  if (resp.errcode === -14 || resp.ret === -14) {
    await sendAlert(
      env,
      "⚠️ 中登BOT: Bot session 已过期（errcode -14），请运行 npm run login 重新扫码登录并更新 WECHAT_TOKEN。"
    );
    return "session_expired";
  }

  if (resp.get_updates_buf && resp.get_updates_buf !== syncBuf) {
    try { await saveSyncBuf(env.DB, resp.get_updates_buf); } catch { /* non-fatal */ }
  }

  const userMsgs = (resp.msgs ?? []).filter(
    (m: WeixinMessage) => m.message_type === 1 && m.from_user_id && m.context_token
  );

  for (const msg of userMsgs) {
    const userId = msg.from_user_id!;
    const contextToken = msg.context_token!;
    const text = extractText(msg);

    if (UNSUBSCRIBE_KEYWORDS.some((kw) => text.includes(kw))) {
      try {
        await deleteSubscriber(env.DB, userId);
        await sendTextMessage(env.WECHAT_TOKEN, userId, contextToken, UNSUBSCRIBE_MSG);
        console.log(`[poll] unsubscribed: ${userId}`);
      } catch (err) {
        console.error(`[poll] unsubscribe failed for ${userId}:`, err);
      }
      continue;
    }

    try {
      const isNew = await upsertSubscriber(env.DB, userId, contextToken);
      if (isNew) {
        await sendTextMessage(env.WECHAT_TOKEN, userId, contextToken, WELCOME_MSG);
        console.log(`[poll] new subscriber: ${userId}`);
      } else {
        console.log(`[poll] token refreshed: ${userId}`);
      }
    } catch (err) {
      console.error(`[poll] failed to register ${userId}:`, err);
    }
  }

  return "ok";
}

async function runScheduled(env: Env): Promise<void> {
  const lastPushTime = await getLastPushTime(env.DB).catch(() => 0);

  const [pollResult, newsResult] = await Promise.allSettled([
    pollAndRegister(env),
    fetchNews(lastPushTime),
  ]);

  if (pollResult.status === "fulfilled" && pollResult.value === "session_expired") {
    console.log("[push] session expired, skipping push");
    return;
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

  const activeSubs: Subscriber[] = [];
  const warningSubs: Subscriber[] = [];

  for (const sub of subscribers) {
    const ageMs = now - sub.token_updated_at;
    if (ageMs >= TOKEN_TTL_MS) {
      const ageH = Math.round(ageMs / 36e5);
      console.log(`[push] skip ${sub.user_id}: token age ${ageH}h > TTL`);
    } else if (ageMs >= TOKEN_WARN_MS) {
      warningSubs.push(sub);
    } else {
      activeSubs.push(sub);
    }
  }

  console.log(
    `[push] ${news.items.length} items → active:${activeSubs.length} warning:${warningSubs.length} ` +
    `expired:${subscribers.length - activeSubs.length - warningSubs.length}`
  );

  if (activeSubs.length + warningSubs.length === 0) {
    console.log("[push] no active subscribers to push to");
    return;
  }

  const entries: BroadcastEntry[] = [
    ...activeSubs.map((sub) => ({ user_id: sub.user_id, context_token: sub.context_token, message: newsMessage })),
    ...warningSubs.map((sub) => ({ user_id: sub.user_id, context_token: sub.context_token, message: newsMessage + RENEWAL_REMINDER })),
  ];

  const { ok, failed, stale } = await batchBroadcast(env.WECHAT_TOKEN, entries);
  console.log(`[push] done — ok:${ok} failed:${failed} stale:${stale}`);

  const newestPubMs = Math.max(...news.items.map((it) => it.pubMs).filter(Boolean));
  await saveLastPushTime(env.DB, newestPubMs > 0 ? newestPubMs : Date.now()).catch(() => {});
}

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
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(landingPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
};
