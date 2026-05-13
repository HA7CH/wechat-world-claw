export function landingPageHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>中登BOT</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
      background: #0f172a;
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 40px 20px;
    }
    .emoji { font-size: 3rem; opacity: 0.4; }
    h1 { font-size: 1.5rem; font-weight: 700; margin-top: 16px; letter-spacing: 1px; opacity: 0.6; }
    p { font-size: 0.88rem; color: #64748b; margin-top: 12px; line-height: 1.6; }
    footer { position: fixed; bottom: 24px; font-size: 0.72rem; color: #334155; }
    footer a { color: #334155; text-decoration: none; }
  </style>
</head>
<body>
  <div class="emoji">📡</div>
  <h1>中登BOT</h1>
  <p>服务暂停维护中</p>
  <footer>
    <a href="https://ha7ch.com">ha7ch.com</a>
  </footer>
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
