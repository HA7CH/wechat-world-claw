export interface NewsItem {
  title: string;
  description: string;  // empty string if not available
  link: string;         // empty string for Google News items
  source: string;
  pubMs: number;
}

export interface NewsData {
  items: NewsItem[];
}

const DIRECT_SOURCES = [
  { name: "RFI法广",     url: "https://www.rfi.fr/cn/rss" },
  { name: "VOA美国之音", url: "https://www.voachinese.com/api/zm_yql-vomx-tpeybti" },
  { name: "联合国新闻",  url: "https://news.un.org/feed/subscribe/zh/news/all/rss.xml" },
];

const GNEWS_URL =
  "https://news.google.com/rss/search" +
  "?q=%E7%89%B9%E6%9C%97%E6%99%AE+OR+%E4%B8%AD%E4%B8%9C+OR+%E4%B8%AD%E7%BE%8E+OR+%E4%BB%A5%E8%89%B2%E5%88%97+OR+%E4%B9%8C%E5%85%8B%E5%85%B0" +
  "&hl=zh-CN&gl=CN&ceid=CN:zh-Hans";

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

const HOT_KEYWORDS = [
  "特朗普", "拜登", "哈里斯", "中美", "中国", "习近平", "美国",
  "中东", "以色列", "伊朗", "加沙", "黎巴嫩", "乌克兰", "俄罗斯",
  "台湾", "朝鲜", "半岛", "峰会", "关税", "贸易战", "制裁",
  "战争", "冲突", "袭击", "爆炸", "地震", "核",
];

function relevanceScore(item: { title: string; description: string }): number {
  const text = item.title + item.description;
  return HOT_KEYWORDS.reduce((score, kw) => score + (text.includes(kw) ? 1 : 0), 0);
}


function parsePubDate(s: string): number {
  try { return new Date(s.trim()).getTime(); } catch { return 0; }
}

function getTagContent(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function parseDirectItems(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const block of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const raw = block[0];

    const titleRaw = getTagContent(raw, "title");
    const title = truncate(stripHtml(titleRaw), 60);
    if (title.length < 5) continue;

    const descRaw = getTagContent(raw, "description");
    const desc = truncate(stripHtml(descRaw), 200);
    // Skip description if it's essentially the same as the title
    const description = desc.length > 15 && !title.startsWith(desc.slice(0, 10)) ? desc : "";

    const link = (raw.match(/<link>(https?:\/\/[^\s<]+)<\/link>/) ??
                  raw.match(/<link><!\[CDATA\[(https?:\/\/[^\]]+)\]\]><\/link>/))?.[1]?.trim() ?? "";

    const pubMs = parsePubDate(getTagContent(raw, "pubDate"));

    items.push({ title, description, link, source: sourceName, pubMs });
  }
  return items;
}

function parseGnewsItems(xml: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const block of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const raw = block[0];

    const titleRaw = getTagContent(raw, "title");
    let title = stripHtml(titleRaw);
    let source = "综合媒体";

    // Extract " - SourceName" suffix
    const sourceTagMatch = raw.match(/<source[^>]*>([^<]+)<\/source>/);
    if (sourceTagMatch) {
      source = sourceTagMatch[1].trim();
    } else {
      const suffixMatch = title.match(/^([\s\S]+?)\s+-\s+([^-]{2,30})$/);
      if (suffixMatch) { title = suffixMatch[1].trim(); source = suffixMatch[2].trim(); }
    }
    title = truncate(title, 60);
    if (title.length < 5) continue;

    const pubMs = parsePubDate(getTagContent(raw, "pubDate"));
    // Google News: no description, no link (URLs are long base64 redirects)
    items.push({ title, description: "", link: "", source, pubMs });
  }
  return items;
}

async function fetchXml(url: string, signal: AbortSignal): Promise<string | null> {
  try {
    const resp = await fetch(url, {
      signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WorldPushBot/1.0)" },
    });
    if (!resp.ok) { console.error(`[news] HTTP ${resp.status} ${url}`); return null; }
    return await resp.text();
  } catch (err) {
    console.error(`[news] failed ${url}:`, err);
    return null;
  }
}

export async function fetchNews(sinceMs: number): Promise<NewsData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const [gnewsXml, ...directXmls] = await Promise.all([
      fetchXml(GNEWS_URL, controller.signal),
      ...DIRECT_SOURCES.map((s) => fetchXml(s.url, controller.signal)),
    ]);

    const allItems: NewsItem[] = [];
    const seen = new Set<string>();

    // Direct sources first (they have descriptions + clean links)
    for (let i = 0; i < DIRECT_SOURCES.length; i++) {
      const xml = directXmls[i];
      if (!xml) continue;
      for (const item of parseDirectItems(xml, DIRECT_SOURCES[i].name)) {
        const key = item.title.slice(0, 15);
        if (seen.has(key)) continue;
        seen.add(key);
        if (sinceMs > 0 && item.pubMs > 0 && item.pubMs <= sinceMs) continue;
        allItems.push(item);
      }
    }

    // Google News fills remaining slots
    if (gnewsXml) {
      for (const item of parseGnewsItems(gnewsXml)) {
        const key = item.title.slice(0, 15);
        if (seen.has(key)) continue;
        seen.add(key);
        if (sinceMs > 0 && item.pubMs > 0 && item.pubMs <= sinceMs) continue;
        allItems.push(item);
      }
    }

    // Sort by relevance score first, then by recency
    allItems.sort((a, b) => {
      const scoreDiff = relevanceScore(b) - relevanceScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.pubMs - a.pubMs;
    });
    const items = allItems.slice(0, 4);

    console.log(`[news] ${items.length} new items`);
    if (items.length === 0) return null;
    return { items };
  } finally {
    clearTimeout(timer);
  }
}
