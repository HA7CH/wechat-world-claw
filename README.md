# 📡 中登BOT — 微信国际要闻推送

> 给你老爹一个掌握全球局势的微信ClawBot

**Live:** [wwc.ha7ch.com](https://wwc.ha7ch.com)

每两小时自动推送国际要闻到微信，无需安装任何 App。

---

## 功能

- 🕐 **每两小时推送**（北京时间 08:00–22:00）
- 📰 **多源聚合**：RFI法广 · VOA美国之音 · 联合国新闻 · BBC中文 · 联合早报 · 澎湃 · 虎嗅 · 36氪
- 🎯 **热点优先**：特朗普、中美关系、中东局势、乌克兰……智能排序
- 🔕 **无新内容不推送**，不骚扰
- 💬 **每人独立 bot**，互不干扰
- 🔄 **保活机制**：36h 温馨提醒，44h 独立催活，48h 自动暂停

## 订阅方式

1. 访问 [wwc.ha7ch.com](https://wwc.ha7ch.com)，点击「立即订阅」
2. 用微信扫描二维码
3. **立即**（2分钟内）在微信向机器人发送任意消息（如「你好」）
4. 订阅成功！收到欢迎语 + 最新一期新闻

> ⚠️ 扫码后请在 **2 分钟内** 发消息，否则 bot token 过期需重新扫

---

## 技术架构

```
┌──────────────────────────────────────────────┐
│              Cloudflare Workers              │
│                                              │
│  GET /               落地页                  │
│  GET /subscribe      生成专属 QR + 会话       │
│  GET /subscribe/status  轮询扫码状态 + 激活   │
│  GET /trigger        手动触发（调试用）        │
│                                              │
│  Cron (每2h, 08:00–22:00 CST)               │
│    pollMainBot()       主 bot 轮询（旧用户）  │
│    pollPending()       激活待扫码用户         │
│    pollOwnBot()        刷新各人 context token │
│    fetchNews()         并行拉取 RSS           │
│    batchBroadcast()    每人用自己的 bot 推送  │
│                                              │
│  D1 (SQLite)                                 │
│    subscribers         正式订阅者             │
│    pending_subscribers 已扫码待激活           │
│    qr_sessions         QR 会话状态            │
│    sync_state          游标 + 上次推送时间    │
└──────────────────────────────────────────────┘
```

### 订阅流程

```
用户访问 /subscribe
  → 服务器调 WeChat iLink API 生成专属 QR
  → 用户扫码（确认后立即触发 25s 密集轮询）
  → 用户在微信发消息 → 拿到 context_token
  → 激活：发欢迎语 + 最新一期新闻
```

### 推送流程

```
Cron 触发
  → fetchNews(lastPushTime)  // 只取新文章
  → 无新文章 → 跳过
  → 有新文章 → 按订阅者状态分组：
      0–36h   → 正常推新闻
      36–44h  → 新闻 + 温和提醒（保活）
      44–48h  → 单独发催活消息
      >48h    → 跳过（token 已失效）
  → 每人用自己的 bot_token 发送
```

**技术栈**

| 组件 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers (TypeScript) |
| 数据库 | Cloudflare D1 (SQLite) |
| 定时任务 | Cloudflare Cron Triggers |
| 消息通道 | WeChat iLink Bot Protocol（逆向）|
| 新闻来源 | RSS 多源聚合 |

---

## 数据来源

| 来源 | 类型 |
|---|---|
| RFI 法广 | 国际时政 |
| VOA 美国之音 | 国际时政 |
| 联合国新闻 | 国际组织 |
| BBC 中文 | 国际综合 |
| 联合早报 | 亚太视角 |
| 澎湃新闻 | 国内外时政 |
| 虎嗅网 | 财经科技 |
| 36氪 | 财经科技 |

---

## 自部署指南

### 前置条件

- [Cloudflare 账户](https://cloudflare.com)（免费套餐即可）
- Node.js ≥ 20
- 微信账号（用于扫码登录主 bot）

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/LAWTED/wechat-world-push.git
cd wechat-world-push
npm install

# 2. 创建 D1 数据库
npx wrangler d1 create wechat-world-push
# 把输出的 database_id 填入 wrangler.toml

# 3. 建表（生产环境）
npx wrangler d1 execute wechat-world-push --remote --file=schema.sql

# 4. 登录主 bot（扫码授权，token 写入 .dev.vars）
npm run login

# 5. 上传 Secrets 到 Cloudflare
npx wrangler secret put WECHAT_TOKEN
npx wrangler secret put WECHAT_ACCOUNT_ID

# 6. 部署
npx wrangler deploy
```

### 环境变量

| 变量 | 来源 | 说明 |
|---|---|---|
| `WECHAT_TOKEN` | `npm run login` 自动写入 | 主 bot 鉴权 token（约 48h 有效） |
| `WECHAT_ACCOUNT_ID` | `npm run login` 自动写入 | 主 bot 账号 ID |
| `ALERT_WEBHOOK_URL` | 可选，手动填入 | Discord/Slack webhook，token 过期时告警 |

> ⚠️ `.dev.vars` 已加入 `.gitignore`，请勿提交到 Git

### 本地开发

```bash
# 复制环境变量模板
cp .dev.vars.example .dev.vars
npm run login  # 扫码，自动写入 .dev.vars

# 建本地 D1 表
npx wrangler d1 execute wechat-world-push --local --file=schema.sql

# 启动本地 dev server
npm run dev

# 手动触发推送
curl http://localhost:8787/trigger

# 类型检查
npm run typecheck
```

### Token 过期处理

主 bot token 约 48 小时失效，届时会收到告警（若配置了 webhook）。

```bash
# 重新登录，刷新 token
npm run login

# 上传新 token 并重新部署
npx wrangler secret put WECHAT_TOKEN
npx wrangler secret put WECHAT_ACCOUNT_ID
npx wrangler deploy
```

### 常用查询

```bash
# 查看订阅人数
npx wrangler d1 execute wechat-world-push --remote \
  --command="SELECT COUNT(*) as 正式订阅 FROM subscribers; SELECT COUNT(*) as 待激活 FROM pending_subscribers;"

# 查看最近加入的订阅者
npx wrangler d1 execute wechat-world-push --remote \
  --command="SELECT user_id, datetime(created_at/1000,'unixepoch','+8 hours') as joined FROM subscribers ORDER BY created_at DESC LIMIT 10;"

# 查看上次推送时间
npx wrangler d1 execute wechat-world-push --remote \
  --command="SELECT key, value FROM sync_state;"

# 实时日志
npx wrangler tail
```

---

## 项目结构

```
src/
  index.ts          # Worker 入口，HTTP 路由 + cron handler
  wechat.ts         # WeChat iLink 客户端（getupdates / sendmessage / QR 生成）
  db.ts             # D1 数据库操作
  formatter.ts      # 消息格式化
  landing.ts        # 落地页 + 订阅页 HTML
  sources/
    news.ts         # RSS 拉取 + 解析 + 相关性排序
schema.sql          # D1 建表语句（含 migration 注释）
scripts/
  login.mts         # 微信扫码登录，写入 .dev.vars
wrangler.toml       # Cloudflare Workers 配置
```

---

## 推送样例

```
📡 世界速报 · 05/12 16:00 北京时间
─────────────────

【特朗普宣布对中国商品暂缓加征关税90天】
美国总统特朗普周一签署行政令，宣布在贸易谈判期间暂停对价值约2400亿美元
中国商品征收的部分额外关税，此前双方谈判代表于日内瓦达成初步框架协议。
— 法新社

【以色列对加沙北部发动新一轮空袭，造成至少23人死亡】
以色列国防军周一证实，其空军对加沙城及附近难民营发动定点清除行动，
目标为哈马斯武装指挥官。加沙卫生部称死亡人数已上升至23人。
— VOA美国之音
```

---

## License

MIT
