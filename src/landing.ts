export function landingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中登BOT — 项目复盘</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
      background: #0f172a;
      color: #94a3b8;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 60px 20px 80px;
    }
    .wrap { max-width: 560px; width: 100%; }
    .header { text-align: center; margin-bottom: 48px; }
    .emoji { font-size: 2.4rem; opacity: 0.35; }
    h1 {
      font-size: 1.3rem; font-weight: 700; margin-top: 14px;
      letter-spacing: 1px; color: #475569;
      text-decoration: line-through; text-decoration-color: #334155;
    }
    .subtitle { font-size: 0.82rem; color: #334155; margin-top: 8px; }
    .section { margin-bottom: 32px; }
    .section h2 {
      font-size: 0.7rem; font-weight: 600; letter-spacing: 0.12em;
      text-transform: uppercase; color: #334155; margin-bottom: 14px;
    }
    .item { display: flex; gap: 14px; margin-bottom: 16px; }
    .dot {
      flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%;
      background: #1e293b; margin-top: 7px;
    }
    .item p { font-size: 0.88rem; line-height: 1.7; color: #64748b; }
    .item strong { color: #94a3b8; font-weight: 500; }
    footer { margin-top: 48px; font-size: 0.72rem; color: #1e293b; text-align: center; }
    footer a { color: #1e293b; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="emoji">📡</div>
      <h1>中登BOT</h1>
      <p class="subtitle">A WeChat bot for global news · 2026-05-12 → 2026-05-13</p>
    </div>

    <div class="section">
      <h2>为什么停了</h2>

      <div class="item">
        <div class="dot"></div>
        <p><strong>微信内容审核墙太高。</strong>带 BBC / RFI / VOA 链接或标题的消息被直接拦截，显示「请稍后再试」，永远等不到。国内平台对外媒关键词零容忍，绕不过去。</p>
      </div>

      <div class="item">
        <div class="dot"></div>
        <p><strong>iLink context_token 实际只活 12–14 小时。</strong>官方文档没说，实测才知道。用户只要超过半天没跟 bot 说话，token 就死了，之后发什么都是 iLink -2 静默失败。等于每天强制要求用户主动互动，违背了「不刷屏」的初衷。</p>
      </div>

      <div class="item">
        <div class="dot"></div>
        <p><strong>图片广播 CDN 不稳定。</strong>微信自家的 CDN（novac2c.cdn.weixin.qq.com）间歇性 500，加密图片上传后客户端拉取失败，也是「请稍后再试」。切纯文本解决了这个问题，但失去了排版。</p>
      </div>

      <div class="item">
        <div class="dot"></div>
        <p><strong>平台能力上限太低。</strong>语音消息协议支持但客户端不渲染；自定义短链触发反 spam；图文混排依赖 CDN；整个 bot 能力集比 Telegram 差一个量级。</p>
      </div>
    </div>

    <div class="section">
      <h2>做到了什么</h2>
      <div class="item">
        <div class="dot"></div>
        <p>48 小时内从零跑通：多 bot 订阅流程、RSS 聚合 + 关键词排序、图片渲染（Satori + resvg）、AES-128-ECB 加密上传、QR 码生成、cron 广播、退订保活提醒、全链路部署在 Cloudflare Workers + D1 + KV。跑起来了，也推出去了，37 个订阅者。</p>
      </div>
    </div>

    <footer>
      <a href="https://ha7ch.com">ha7ch.com</a>
    </footer>
  </div>
</body>
</html>`;
}

export function subscribePageHtml(_sessionId: string, _qrUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中登BOT</title>
  <meta http-equiv="refresh" content="0; url=/" />
</head>
<body></body>
</html>`;
}
