import type { NewsData } from "./sources/news";

// SHA-256 first 4 bytes → 6 base64url chars. KV stores `url:<id>` → full URL.
async function shortenUrl(kv: KVNamespace, fullUrl: string): Promise<string> {
  const buf = new TextEncoder().encode(fullUrl);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(hashBuf);
  let raw = "";
  for (let i = 0; i < 4; i++) raw += String.fromCharCode(bytes[i]);
  const b64 = btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
  const id = b64.slice(0, 6);
  await kv.put(`url:${id}`, fullUrl, { expirationTtl: 30 * 24 * 60 * 60 }).catch(() => {});
  return `https://wwc.ha7ch.com/r/${id}`;
}

export async function shortenNewsLinks(kv: KVNamespace, news: NewsData): Promise<NewsData> {
  const items = await Promise.all(
    news.items.map(async (item) => ({
      ...item,
      link: item.link ? await shortenUrl(kv, item.link) : item.link,
    }))
  );
  return { items };
}

function beijingTime(): string {
  const now = new Date();
  const cst = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const mm = String(cst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(cst.getUTCDate()).padStart(2, "0");
  const hh = String(cst.getUTCHours()).padStart(2, "0");
  const min = String(cst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

export function formatMessage(news: NewsData): string {
  const lines: string[] = [];

  lines.push(`📡 世界速报 · ${beijingTime()} 北京时间`);
  lines.push("─────────────────");

  news.items.forEach((item) => {
    lines.push("");
    lines.push(`【${item.title}】`);
    if (item.description) {
      lines.push(item.description);
    }
    if (item.link) {
      lines.push(item.link);
    }
    lines.push(`— ${item.source}`);
  });

  return lines.join("\n").trimEnd();
}
