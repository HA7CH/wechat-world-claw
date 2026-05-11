import type { NewsData } from "./sources/news";

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
    // 【标题】 brackets for visual prominence (iLink is plain text only)
    lines.push(`【${item.title}】`);
    if (item.description) {
      lines.push(item.description);
    }
    lines.push(`— ${item.source}`);
  });

  return lines.join("\n").trimEnd();
}
