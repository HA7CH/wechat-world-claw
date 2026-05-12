import { getUpdates, sendTextMessage, type WeixinMessage } from "./wechat";
import {
  getSyncBuf, saveSyncBuf,
  upsertSubscriber, listSubscribers,
  getLastPushTime, saveLastPushTime,
} from "./db";
import { fetchNews } from "./sources/news";
import { formatMessage } from "./formatter";
import { landingPageHtml } from "./landing";

export interface Env {
  DB: D1Database;
  WECHAT_TOKEN: string;
  WECHAT_ACCOUNT_ID: string;
}

const WELCOME_MSG = "已订阅 📡 世界速报，每小时推送国际要闻。有新消息才推，不刷屏。";

async function pollAndRegister(env: Env): Promise<void> {
  let syncBuf: string;
  try {
    syncBuf = await getSyncBuf(env.DB);
  } catch (err) {
    console.error("[poll] getSyncBuf failed:", err);
    return;
  }

  let resp;
  try {
    resp = await getUpdates(env.WECHAT_TOKEN, syncBuf, 5_000);
  } catch (err) {
    console.error("[poll] getUpdates failed:", err);
    return;
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
}

async function runScheduled(env: Env): Promise<void> {
  // Poll for new subscribers + fetch news + load subscribers in parallel
  const lastPushTime = await getLastPushTime(env.DB).catch(() => 0);

  // pollAndRegister must complete first so D1 has fresh context_tokens
  const [, newsResult] = await Promise.allSettled([
    pollAndRegister(env),
    fetchNews(lastPushTime),
  ]);
  const subscribersResult = await Promise.allSettled([listSubscribers(env.DB)]).then(r => r[0]);

  const news = newsResult.status === "fulfilled" ? newsResult.value : null;

  // Skip push if no new articles
  if (!news || news.items.length === 0) {
    console.log("[push] no new articles since last push, skipping");
    return;
  }

  if (subscribersResult.status === "rejected") {
    console.error("[push] listSubscribers failed:", subscribersResult.reason);
    return;
  }
  const subscribers = subscribersResult.value;

  if (subscribers.length === 0) {
    console.log("[push] no subscribers, skipping");
    return;
  }

  const message = formatMessage(news);
  const TOKEN_TTL_MS = 48 * 60 * 60 * 1000; // 48 hours — tune based on empirical testing
  const now = Date.now();
  const activeSubs = subscribers.filter((sub) => {
    const ageMs = now - sub.token_updated_at;
    const ageH = Math.round(ageMs / 36e5);
    if (ageMs > TOKEN_TTL_MS) {
      console.log(`[push] skip ${sub.user_id}: token age ${ageH}h > TTL`);
      return false;
    }
    console.log(`[push] token age ${ageH}h for ${sub.user_id}`);
    return true;
  });
  console.log(`[push] ${news.items.length} new items → ${activeSubs.length}/${subscribers.length} active subscriber(s)`);

  const results = await Promise.allSettled(
    activeSubs.map((sub) =>
      sendTextMessage(env.WECHAT_TOKEN, sub.user_id, sub.context_token, message)
    )
  );

  let ok = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      ok++;
    } else {
      console.error(`[push] failed for ${subscribers[i].user_id}:`, r.reason);
    }
  });

  console.log(`[push] done — ${ok}/${activeSubs.length} ok`);

  // Save push time as the newest article's pubDate (or now)
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
