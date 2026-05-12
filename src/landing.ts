const SITE_URL = "https://wwc.ha7ch.com";

const BASE_STYLES = `
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
  footer {
    margin: 28px 0 24px;
    font-size: 0.76rem;
    color: #bbb;
    text-align: center;
  }
`;

export function landingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中登BOT · 每日国际要闻推送</title>
  <link rel="canonical" href="${SITE_URL}" />
  <style>
    ${BASE_STYLES}
    .subscribe-btn {
      display: inline-block;
      margin-top: 20px;
      padding: 14px 36px;
      background: #1a1a2e;
      color: #fff;
      border-radius: 50px;
      font-size: 1rem;
      font-weight: 600;
      text-decoration: none;
      letter-spacing: 0.5px;
    }
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
    .step { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
    .step-num {
      flex-shrink: 0; width: 26px; height: 26px; border-radius: 50%;
      background: #1a1a2e; color: #fff; font-size: 0.8rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-text { font-size: 0.88rem; line-height: 1.5; color: #444; padding-top: 3px; }
    .features {
      background: #fff; border-radius: 16px; padding: 24px;
      margin: 16px 16px 0; max-width: 420px; width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .features h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 14px; color: #1a1a2e; }
    .feature-row { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 0.88rem; color: #444; line-height: 1.4; }
    .feature-row .icon { font-size: 1.1rem; flex-shrink: 0; }
    .preview {
      background: #f0f4ff; border-radius: 16px; padding: 24px;
      margin: 16px 16px 0; max-width: 420px; width: calc(100% - 32px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .preview h3 { font-size: 0.95rem; font-weight: 600; margin-bottom: 14px; color: #1a1a2e; }
    .msg-bubble {
      background: #fff; border-radius: 10px; padding: 14px 16px;
      font-size: 0.82rem; line-height: 1.7; color: #333;
      white-space: pre-wrap; text-align: left; box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }
  </style>
</head>
<body>
  <header>
    <div class="emoji">📡</div>
    <h1>中登BOT</h1>
    <p>给你老爹一个掌握全球局势的微信ClawBot</p>
  </header>

  <div class="card">
    <h2 style="font-size:1rem;color:#555;font-weight:500;margin-bottom:16px">微信直达，每两小时推送</h2>
    <p style="font-size:0.88rem;color:#666;line-height:1.6">
      点击下方按钮，用微信扫码订阅。<br>
      有新消息才推，不刷屏。发送「退订」可随时取消。
    </p>
    <a class="subscribe-btn" href="/subscribe">立即订阅</a>
  </div>

  <div class="steps">
    <h3>订阅步骤</h3>
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-text">点击「立即订阅」，用微信扫码</div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-text">扫码后，向 bot 发送任意一条消息（如「你好」）</div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-text">订阅成功！每两小时，有新闻时自动推送</div>
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

export function subscribePageHtml(sessionId: string, qrUrl: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>订阅 · 中登BOT</title>
  <style>
    ${BASE_STYLES}
    .qr-wrap {
      display: inline-block;
      border: 3px solid #eee;
      border-radius: 12px;
      padding: 10px;
      margin: 16px 0 12px;
      position: relative;
    }
    .qr-wrap img { display: block; width: 220px; height: 220px; border-radius: 6px; }
    .qr-wrap.expired::after {
      content: '二维码已过期\\A点击刷新';
      white-space: pre;
      position: absolute; inset: 0;
      background: rgba(255,255,255,0.92);
      display: flex; align-items: center; justify-content: center;
      border-radius: 10px;
      font-size: 0.9rem; color: #1a1a2e; font-weight: 600;
      cursor: pointer; text-align: center; line-height: 1.6;
    }
    .status-msg { font-size: 0.85rem; color: #888; margin-top: 8px; min-height: 1.4em; }
    .status-msg.ok { color: #2a9d2a; font-weight: 600; }
    .status-msg.warn { color: #e07b00; }
    .back-link { display: inline-block; margin-top: 20px; font-size: 0.82rem; color: #aaa; text-decoration: none; }
  </style>
</head>
<body>
  <header>
    <div class="emoji">📡</div>
    <h1>中登BOT</h1>
    <p>微信扫码订阅</p>
  </header>

  <div class="card" id="card">
    <h2 style="font-size:1rem;color:#555;font-weight:500">用微信扫描下方二维码</h2>
    <div class="qr-wrap" id="qr-wrap">
      <img id="qr-img" src="${qrUrl}" alt="订阅二维码" />
    </div>
    <p style="font-size:0.9rem;color:#333;margin-top:12px;line-height:1.6">
      扫码后，向机器人发送<strong>「你好」</strong>完成订阅
    </p>
    <p class="status-msg" id="status-msg">等待扫码…</p>
    <p style="font-size:0.78rem;color:#ccc;margin-top:4px">二维码约8分钟内有效</p>
    <a class="back-link" href="/">← 返回首页</a>
  </div>

  <script>
    const SESSION = ${JSON.stringify(sessionId)};
    const statusEl = document.getElementById('status-msg');
    const qrWrap = document.getElementById('qr-wrap');
    const qrImg = document.getElementById('qr-img');
    let done = false;

    function setStatus(msg, cls) {
      statusEl.textContent = msg;
      statusEl.className = 'status-msg' + (cls ? ' ' + cls : '');
    }

    async function poll() {
      if (done) return;
      try {
        const r = await fetch('/subscribe/status?s=' + SESSION);
        const data = await r.json();
        if (data.status === 'scaned') {
          setStatus('已扫码，请在微信中确认…', 'warn');
        } else if (data.status === 'activated') {
          done = true;
          setStatus('✅ 订阅成功！新闻推送已开始', 'ok');
          qrWrap.style.opacity = '0.3';
        } else if (data.status === 'confirmed') {
          setStatus('✓ 扫码成功！请立即在微信向机器人发送「你好」（请在2分钟内完成）', 'ok');
          qrWrap.style.opacity = '0.3';
        } else if (data.status === 'new_qr') {
          qrImg.src = data.qr_url;
          setStatus('二维码已刷新，请重新扫码', '');
        } else if (data.status === 'expired') {
          done = true;
          qrWrap.classList.add('expired');
          qrWrap.onclick = () => { window.location.href = '/subscribe'; };
          setStatus('二维码已过期', '');
        }
      } catch (e) {
        // network error — keep retrying
      }
      if (!done) setTimeout(poll, 2500);
    }

    setTimeout(poll, 2500);
  </script>
</body>
</html>`;
}
