export interface GdeltEvent {
  titles: string[];
}

// Targeted Chinese Google News query: Trump, Middle East, China-US, Israel, Ukraine
const GNEWS_URL =
  "https://news.google.com/rss/search" +
  "?q=%E7%89%B9%E6%9C%97%E6%99%AE+OR+%E4%B8%AD%E4%B8%9C+OR+%E4%B8%AD%E7%BE%8E+OR+%E4%BB%A5%E8%89%B2%E5%88%97+OR+%E4%B9%8C%E5%85%8B%E5%85%B0" +
  "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans";

// RFI Chinese as fallback
const RFI_URL = "https://www.rfi.fr/cn/rss";

function extractTitles(xml: string, max: number): string[] {
  const titles: string[] = [];
  // Match CDATA titles inside <item> blocks
  const items = xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g);
  for (const item of items) {
    const cdata = item[0].match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/);
    const plain = item[0].match(/<title>([^<]+)<\/title>/);
    const raw = (cdata?.[1] ?? plain?.[1])?.trim();
    if (!raw) continue;
    // Strip trailing source tag like " - 新华网"
    const title = raw.replace(/\s+-\s+[^\-]+$/, "").trim();
    if (title.length > 5) titles.push(title);
    if (titles.length >= max) break;
  }
  return titles;
}

async function fetchRss(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WorldPushBot/1.0)" },
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

export async function fetchGdeltEvent(): Promise<GdeltEvent | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    // Try Google News first, fall back to RFI
    const xml = (await fetchRss(GNEWS_URL, controller.signal))
      ?? (await fetchRss(RFI_URL, controller.signal));

    if (!xml) {
      console.error("[news] all sources failed");
      return null;
    }

    const titles = extractTitles(xml, 4);
    if (titles.length === 0) return null;
    return { titles };
  } catch (err) {
    console.error("[news] fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
