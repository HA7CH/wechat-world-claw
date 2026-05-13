export interface NewsItem {
  title: string;
  description: string;
  link: string;
  source: string;
  pubMs: number;
}

export interface NewsData {
  items: NewsItem[];
}

const SOURCES = [
  // 外媒暂停（2026-05-13：微信内容审核拦截外媒链接/标题，恢复前需研究绕过方案）
  // { name: "RFI法广",     url: "https://www.rfi.fr/cn/rss" },
  // { name: "VOA美国之音", url: "https://www.voachinese.com/api/zm_yql-vomx-tpeybti" },
  // { name: "BBC中文",     url: "https://plink.anyfeeder.com/bbc/cn" },
  { name: "联合国新闻",  url: "https://news.un.org/feed/subscribe/zh/news/all/rss.xml" },
  // 新增国际/时政源
  { name: "联合早报",    url: "https://plink.anyfeeder.com/zaobao/realtime/world" },
  { name: "澎湃新闻",   url: "https://plink.anyfeeder.com/thepaper" },
  // 财经科技源（官方原生 RSS，最稳定）
  { name: "虎嗅网",     url: "https://www.huxiu.com/rss/0.xml" },
  { name: "36氪",       url: "https://36kr.com/feed" },
];

const HOT_KEYWORDS = [
  // 政治人物
  "特朗普", "拜登", "哈里斯", "习近平", "普京", "泽连斯基",
  // 中美关系
  "中美", "中国", "美国", "台湾", "关税", "贸易战", "制裁", "外交",
  // 中东
  "中东", "以色列", "伊朗", "加沙", "黎巴嫩",
  // 其他国际
  "乌克兰", "俄罗斯", "朝鲜", "半岛", "峰会",
  // 财经
  "股市", "美股", "A股", "降息", "加息", "经济", "GDP", "通胀",
  "人民币", "美元", "汇率", "黄金", "石油", "芯片", "半导体",
  // 科技
  "AI", "人工智能", "OpenAI", "DeepSeek",
  // 危机
  "战争", "冲突", "袭击", "爆炸", "地震", "核",
];

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    // Decode entities first so &lt;p&gt; doesn't survive tag stripping
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ").trim();
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

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

function parseItems(xml: string, sourceName: string): NewsItem[] {
  const items: NewsItem[] = [];
  for (const block of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)) {
    const raw = block[0];

    const titleRaw = getTagContent(raw, "title");
    const title = truncate(stripHtml(titleRaw), 60);
    if (title.length < 5) continue;

    const descRaw = getTagContent(raw, "description");
    const desc = truncate(stripHtml(descRaw), 200);
    const description = desc.length > 15 && !title.startsWith(desc.slice(0, 10)) ? desc : "";

    const link = (raw.match(/<link>(https?:\/\/[^\s<]+)<\/link>/) ??
                  raw.match(/<link><!\[CDATA\[(https?:\/\/[^\]]+)\]\]><\/link>/))?.[1]?.trim() ?? "";

    const pubMs = parsePubDate(getTagContent(raw, "pubDate"));

    items.push({ title, description, link, source: sourceName, pubMs });
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
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const xmlResults = await Promise.all(
      SOURCES.map((s) => fetchXml(s.url, controller.signal))
    );

    const allItems: NewsItem[] = [];
    const seen = new Set<string>();

    for (let i = 0; i < SOURCES.length; i++) {
      const xml = xmlResults[i];
      if (!xml) continue;
      for (const item of parseItems(xml, SOURCES[i].name)) {
        const key = item.title.slice(0, 15);
        if (seen.has(key)) continue;
        seen.add(key);
        if (sinceMs > 0 && item.pubMs > 0 && item.pubMs <= sinceMs) continue;
        allItems.push(item);
      }
    }

    allItems.sort((a, b) => {
      const scoreDiff = relevanceScore(b) - relevanceScore(a);
      if (scoreDiff !== 0) return scoreDiff;
      return b.pubMs - a.pubMs;
    });

    const items = allItems.slice(0, 5);
    console.log(`[news] ${items.length} new items from ${allItems.length} candidates`);
    if (items.length === 0) return null;
    return { items };
  } finally {
    clearTimeout(timer);
  }
}
