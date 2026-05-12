const SITE_URL = "https://wechat-world-claw.ha7ch.com";
const BOT_ACCOUNT_ID = "c0bf0a7ef6f4@im.bot";

const WECHAT_DEEPLINK = `weixin://dl/chat?username=${encodeURIComponent(BOT_ACCOUNT_ID)}`;
const QR_API_URL = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(WECHAT_DEEPLINK)}`;

export function landingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中登BOT · 每日国际要闻推送</title>
  <link rel="canonical" href="${SITE_URL}" />
  <meta property="og:title" content="中登BOT · 每日国际要闻推送" />
  <meta property="og:description" content="每小时为你推送最新国际要闻，直达微信。" />
  <meta property="og:url" content="${SITE_URL}" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
      background: #f5f5f5;
      color: #333;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    header {
      width: 100%;
      background: #1a1a2e;
      color: #fff;
      padding: 24px 20px 20px;
      text-align: center;
    }
    header .emoji { font-size: 2.4rem; }
    header h1 { font-size: 1.6rem; font-weight: 700; margin-top: 6px; letter-spacing: 1px; }
    header p  { font-size: 0.88rem; color: #aac4ff; margin-top: 6px; }

    .card {
      background: #fff;
      border-radius: 16px;
      padding: 28px 24px;
      margin: 20px 16px 0;
      max-width: 420px;
      width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      text-align: center;
    }

    .card h2 { font-size: 1rem; color: #555; margin-bottom: 20px; font-weight: 500; }

    .qr-wrap {
      display: inline-block;
      border: 3px solid #eee;
      border-radius: 12px;
      padding: 10px;
      margin-bottom: 14px;
    }
    .qr-wrap img { display: block; width: 200px; height: 200px; border-radius: 6px; }

    .hint {
      font-size: 0.82rem;
      color: #888;
      line-height: 1.6;
    }
    .hint strong { color: #1a1a2e; }

    .steps {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      margin: 16px 16px 0;
      max-width: 420px;
      width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .steps h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 16px; color: #1a1a2e; }
    .step {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }
    .step-num {
      flex-shrink: 0;
      width: 26px; height: 26px;
      border-radius: 50%;
      background: #1a1a2e;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { font-size: 0.88rem; line-height: 1.5; color: #444; padding-top: 3px; }

    .features {
      background: #fff;
      border-radius: 16px;
      padding: 24px;
      margin: 16px 16px 0;
      max-width: 420px;
      width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .features h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 14px; color: #1a1a2e; }
    .feature-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
      font-size: 0.88rem;
      color: #444;
      line-height: 1.4;
    }
    .feature-row .icon { font-size: 1.1rem; flex-shrink: 0; }

    .preview {
      background: #f0f4ff;
      border-radius: 16px;
      padding: 24px;
      margin: 16px 16px 0;
      max-width: 420px;
      width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .preview h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 14px; color: #1a1a2e; }
    .msg-bubble {
      background: #fff;
      border-radius: 10px;
      padding: 14px 16px;
      font-size: 0.82rem;
      line-height: 1.7;
      color: #333;
      white-space: pre-wrap;
      text-align: left;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    footer {
      margin: 28px 0 24px;
      font-size: 0.76rem;
      color: #bbb;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="emoji">📡</div>
    <h1>中登BOT</h1>
    <p>每两小时为你推送最新国际要闻</p>
  </header>

  <div class="card">
    <h2>微信扫码，立即订阅</h2>
    <div class="qr-wrap">
      <img src="${QR_API_URL}" alt="扫码订阅二维码" />
    </div>
    <p class="hint">
      用微信扫描上方二维码<br>
      <strong>向 bot 发送任意一条消息</strong>即完成订阅<br>
      <span style="color:#aaa">发送「退订」可随时取消</span>
    </p>
  </div>

  <div class="steps">
    <h3>订阅步骤</h3>
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">打开微信，扫描上方二维码</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">在与 bot 的对话框中发送任意一条消息（如"你好"）</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">订阅成功！每两小时，有新闻时自动推送到这个对话</div>
    </div>
  </div>

  <div class="features">
    <h3>内容涵盖</h3>
    <div class="feature-row"><span class="icon">🇺🇸</span>美国政局 · 特朗普最新动态</div>
    <div class="feature-row"><span class="icon">🌏</span>中美关系 · 关税 · 贸易</div>
    <div class="feature-row"><span class="icon">⚔️</span>中东局势 · 以色列 · 伊朗</div>
    <div class="feature-row"><span class="icon">🌍</span>国际要闻 · 乌克兰 · 俄罗斯</div>
    <div class="feature-row"><span class="icon">🕐</span>每日 08:00–22:00，每两小时更新</div>
    <div class="feature-row"><span class="icon">🔕</span>无新内容不推送，不打扰</div>
  </div>

  <div class="preview">
    <h3>推送样例</h3>
    <div class="msg-bubble">📡 世界速报 · 05/12 15:00 北京时间
─────────────────

【特朗普宣布对中国商品暂缓加征关税90天】
美国总统特朗普周一签署行政令，宣布在贸易谈判期间暂停对价值约2400亿美元中国商品征收的部分额外关税，此前双方谈判代表于日内瓦达成初步框架协议。
— 法新社

【以色列对加沙北部发动新一轮空袭，造成至少23人死亡】
以色列国防军周一证实，其空军对加沙城及附近难民营发动定点清除行动，目标为哈马斯武装指挥官。加沙卫生部称死亡人数已上升至23人，其中包括多名平民。
— VOA美国之音</div>
  </div>

  <footer>
    中登BOT · <a href="${SITE_URL}" style="color:#bbb">${SITE_URL.replace('https://','')}</a><br>
    内容来自 RFI法广、VOA美国之音、联合国新闻等公开来源
  </footer>
</body>
</html>`;
}
