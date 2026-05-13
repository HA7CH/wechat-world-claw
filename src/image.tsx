import satori from "@cf-wasm/satori/workerd";
// @ts-ignore - legacy/workerd uses a smaller, CF-compatible resvg WASM
import { Resvg } from "@cf-wasm/resvg/legacy/workerd";
import type { NewsData } from "./sources/news";
import { qrSvg } from "./qr";

const WIDTH = 750;
const PADDING_X = 56;
const HEADER_H = 280;
const FOOTER_H = 80;
const ITEM_PADDING_Y = 36;
const QR_SIZE = 180;
const QR_LABEL_H = 24;
const QR_GAP_TOP = 20;
const QR_LABEL_GAP = 8;

// CJK is ~1em wide; ASCII narrower. Count as 1 unit / 0.55 unit; conservatively round up.
function visualWidthUnits(s: string): number {
  let u = 0;
  for (const ch of s) {
    u += /[\x00-\x7F]/.test(ch) ? 0.55 : 1;
  }
  return u;
}

// Estimate rendered height for one news item based on text length
function estimateItemHeight(title: string, description?: string, hasLink?: boolean): number {
  const textWidth = WIDTH - 2 * PADDING_X;
  const titleCharsPerLine = Math.max(1, Math.floor(textWidth / 32) - 1);
  const titleLines = Math.max(1, Math.ceil(visualWidthUnits(title) / titleCharsPerLine));
  const titleH = titleLines * 32 * 1.5;
  const descCharsPerLine = Math.max(1, Math.floor(textWidth / 24) - 1);
  const descLines = description
    ? Math.max(1, Math.ceil(visualWidthUnits(description) / descCharsPerLine))
    : 0;
  const descH = descLines * 24 * 1.7;
  const sourceH = 32;
  const gaps = 12 * (description ? 2 : 1);
  const qrH = hasLink ? QR_GAP_TOP + QR_SIZE + QR_LABEL_GAP + QR_LABEL_H : 0;
  const safety = 24; // small per-item buffer for line-height rounding
  return ITEM_PADDING_Y * 2 + titleH + descH + sourceH + gaps + qrH + safety;
}

// ha7ch logo SVG (white version — fill replaced from #D9D9D9 to white)
const HA7CH_LOGO_SVG = `<svg width="487" height="78" viewBox="0 0 487 78" fill="none" xmlns="http://www.w3.org/2000/svg"><rect y="9" width="16.2025" height="60" fill="white"/><rect x="16.2025" y="45.7814" width="14" height="47.5949" transform="rotate(-90 16.2025 45.7814)" fill="white"/><rect x="63.7975" y="9" width="16.2025" height="60" fill="white"/><path d="M132.033 15H148.912L109.879 63H93L132.033 15Z" fill="white"/><path d="M149.967 15H133.088L172.121 63H189L149.967 15Z" fill="white"/><path d="M295 12.9226L276.84 12.9226L208.5 78H232.62L295 12.9226Z" fill="white"/><path d="M308.5 0H214.5L202 13.0774H295L308.5 0Z" fill="white"/><path d="M321.5 31.5976V45.2308L387.12 25.6331L393.5 12L321.5 31.5976Z" fill="white"/><path d="M321.5 45.7899V31.7308L387.12 51.9408L393.5 66L321.5 45.7899Z" fill="white"/><rect x="406.5" y="9" width="16.2025" height="60" fill="white"/><rect x="422.702" y="45.7814" width="14" height="47.5949" transform="rotate(-90 422.702 45.7814)" fill="white"/><rect x="470.297" y="9" width="16.2025" height="60" fill="white"/></svg>`;

const HA7CH_LOGO_URL = `data:image/svg+xml;utf8,${encodeURIComponent(HA7CH_LOGO_SVG)}`;
const SATELLITE_EMOJI_URL = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/1f4e1.svg";

let fontData: ArrayBuffer | null = null;

async function getFont(): Promise<ArrayBuffer> {
  if (fontData) return fontData;
  const data = await fetch(
    "https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@latest/chinese-simplified-400-normal.woff"
  ).then((r) => r.arrayBuffer());
  fontData = data;
  return data;
}

function QrBlock({ url }: { url: string }) {
  const svg = qrSvg(url);
  const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return (
    <img
      src={dataUrl}
      width={QR_SIZE}
      height={QR_SIZE}
      style={{ display: "flex" }}
    />
  );
}

function Header({ time }: { time: string }) {
  const logoW = 97; // 487/78 * 16 ≈ 100px at ~16px height
  const logoH = 16;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        width: "100%",
        height: HEADER_H,
        background: "#0f172a",
        padding: `48px ${PADDING_X}px`,
        gap: 32,
      }}
    >
      {/* Top: ha7ch logo (left) + "世界速报" label (right) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
        }}
      >
        <img
          src={HA7CH_LOGO_URL}
          width={logoW}
          height={logoH}
          style={{ display: "flex" }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 20,
            color: "#475569",
            letterSpacing: "0.08em",
          }}
        >
          国际要闻
        </div>
      </div>

      {/* Middle: title with satellite emoji */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <img
          src={SATELLITE_EMOJI_URL}
          width={48}
          height={48}
          style={{ display: "flex" }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 52,
            fontWeight: 700,
            color: "#f1f5f9",
            letterSpacing: "-0.5px",
          }}
        >
          世界速报
        </div>
      </div>

      {/* Bottom: time */}
      <div
        style={{
          display: "flex",
          fontSize: 24,
          color: "#64748b",
          letterSpacing: "0.02em",
        }}
      >
        {time} · 北京时间
      </div>
    </div>
  );
}

function NewsItem({
  title,
  description,
  source,
  link,
  isLast,
}: {
  title: string;
  description?: string;
  source: string;
  link?: string;
  isLast: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        background: "#ffffff",
        borderBottom: isLast ? "1px solid #e2e8f0" : "1px solid #f1f5f9",
        padding: `${ITEM_PADDING_Y}px ${PADDING_X}px`,
        gap: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: 32,
          fontWeight: 700,
          color: "#0f172a",
          lineHeight: 1.5,
        }}
      >
        {title}
      </div>
      {description && (
        <div
          style={{
            display: "flex",
            fontSize: 24,
            color: "#64748b",
            lineHeight: 1.7,
          }}
        >
          {description}
        </div>
      )}
      <div
        style={{
          display: "flex",
          fontSize: 20,
          color: "#94a3b8",
          marginTop: 2,
        }}
      >
        — {source}
      </div>

      {link && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: QR_GAP_TOP,
            gap: QR_LABEL_GAP,
          }}
        >
          <QrBlock url={link} />
          <div style={{ display: "flex", fontSize: 18, color: "#94a3b8" }}>
            扫码阅读
          </div>
        </div>
      )}
    </div>
  );
}

function Footer() {
  const logoW = 73;
  const logoH = 12;
  // dark version of logo
  const darkLogoSvg = HA7CH_LOGO_SVG.replace(/fill="white"/g, 'fill="#94a3b8"');
  const darkLogoUrl = `data:image/svg+xml;utf8,${encodeURIComponent(darkLogoSvg)}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        height: FOOTER_H,
        background: "#f8fafc",
        borderTop: "1px solid #e2e8f0",
        padding: `0 ${PADDING_X}px`,
      }}
    >
      <img
        src={darkLogoUrl}
        width={logoW}
        height={logoH}
        style={{ display: "flex" }}
      />
      <div
        style={{
          display: "flex",
          fontSize: 20,
          color: "#94a3b8",
          gap: 8,
        }}
      >
        每两小时更新
      </div>
    </div>
  );
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

async function buildLayout(news: NewsData): Promise<{ element: unknown; width: number; height: number; font: ArrayBuffer }> {
  const font = await getFont();
  const time = beijingTime();
  const height = HEADER_H + news.items.reduce((sum, item) => sum + estimateItemHeight(item.title, item.description, !!item.link), 0) + FOOTER_H;

  const element = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: WIDTH,
        height,
        background: "#f8fafc",
        fontFamily: "Noto Sans SC",
      }}
    >
      <Header time={time} />
      {news.items.map((item, i) => (
        <NewsItem
          title={item.title}
          description={item.description}
          source={item.source}
          link={item.link}
          isLast={i === news.items.length - 1}
        />
      ))}
      <Footer />
    </div>
  );

  return { element, width: WIDTH, height, font };
}

// Lightweight SVG for browser preview
export async function renderNewsSvg(news: NewsData): Promise<string> {
  const { element, width, height, font } = await buildLayout(news);
  return satori(
    element as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: [{ name: "Noto Sans SC", data: font, weight: 400 }],
      graphemeImages: {
        "📡": SATELLITE_EMOJI_URL,
      },
    }
  );
}

export async function renderNewsImage(news: NewsData): Promise<Uint8Array> {
  const { element, width, height, font } = await buildLayout(news);

  const svg = await satori(
    element as Parameters<typeof satori>[0],
    {
      width,
      height,
      fonts: [{ name: "Noto Sans SC", data: font, weight: 400 }],
      graphemeImages: {
        "📡": SATELLITE_EMOJI_URL,
      },
    }
  );

  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: WIDTH } });
  return resvg.render().asPng();
}
