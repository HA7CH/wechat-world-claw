# 📡 中登BOT — 微信国际要闻推送

> 每小时自动推送国际要闻到你的微信，无需安装任何 App。

**Live:** [wechat-world-claw.ha7ch.com](https://wechat-world-claw.ha7ch.com)

---

## 功能

- 🕐 **每小时推送**（北京时间 08:00–22:00）
- 📰 **四大权威来源**：RFI法广 · VOA美国之音 · 联合国新闻 · Google新闻
- 🎯 **热点优先**：特朗普、中美关系、中东局势、乌克兰……智能排序
- 📝 **正文摘要**：每条新闻附 200 字左右的内容概述
- 🔕 **无新内容不推送**，不骚扰
- 💬 **直达微信**，无需额外 App 或账号

## 订阅方式

1. 访问 [wechat-world-claw.ha7ch.com](https://wechat-world-claw.ha7ch.com)，用微信扫描二维码
2. 向 bot 发送任意一条消息（如"你好"）
3. 订阅成功，每小时整点有新闻时自动推送

---

## 技术架构

```
┌──────────────────────────────────────┐
│         Cloudflare Workers           │
│                                      │
│  Cron (08:00–22:00 CST, hourly)     │
│      │                               │
│      ├─ pollAndRegister()            │  WeChat iLink getupdates
│      │    ↓ upsert subscribers       │  (新订阅者注册 + context_token 刷新)
│      │                               │
│      ├─ fetchNews()                  │  并行拉取 RSS
│      │    ↓ relevance sort → top 4  │
│      │                               │
│      └─ broadcast()                  │  sendmessage → 每位订阅者
│                                      │
│  D1 (SQLite)                         │
│    subscribers (user_id,             │
│      context_token,                  │
│      token_updated_at)               │
│    sync_state (getupdates cursor,    │
│      last_push_at)                   │
└──────────────────────────────────────┘
```

**技术栈**

| 组件 | 选型 |
|---|---|
| 运行时 | Cloudflare Workers (TypeScript) |
| 数据库 | Cloudflare D1 (SQLite) |
| 定时任务 | Cloudflare Cron Triggers |
| 消息通道 | WeChat iLink Bot Protocol |
| 新闻来源 | RSS (RFI / VOA / UN / Google News) |

---

## 数据来源

| 来源 | 语言 | 说明 |
|---|---|---|
| [RFI 法广](https://www.rfi.fr/cn/rss) | 中文 | 法国国际广播电台中文 RSS |
| [VOA 美国之音](https://www.voachinese.com) | 中文 | 美国之音中文 RSS |
| [联合国新闻](https://news.un.org/zh) | 中文 | 联合国官方新闻中文 RSS |
| [Google 新闻](https://news.google.com) | 中文 | 热词搜索聚合（特朗普/中东/中美...） |

---

## 自部署指南

### 前置条件

- [Cloudflare 账户](https://cloudflare.com)（免费套餐即可）
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) `npm i -g wrangler`
- Node.js ≥ 18
- 微信账号（用于扫码登录 iLink bot）

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/LAWTED/wechat-world-push.git
cd wechat-world-push
npm install

# 2. 创建 D1 数据库
wrangler d1 create wechat-world-push
# 把输出的 database_id 填入 wrangler.toml

# 3. 建表
npm run db:migrate:remote

# 4. 登录 WeChat iLink bot（扫码授权）
npm run login
# 扫码后自动写入 .dev.vars

# 5. 上传 Secrets 到 Cloudflare
wrangler secret put WECHAT_TOKEN
wrangler secret put WECHAT_ACCOUNT_ID

# 6. 部署
npm run deploy
```

### 环境变量

| 变量 | 来源 | 说明 |
|---|---|---|
| `WECHAT_TOKEN` | `npm run login` 自动生成 | iLink bot 鉴权 token |
| `WECHAT_ACCOUNT_ID` | `npm run login` 自动生成 | bot 的微信账号 ID |

> ⚠️ **安全提示**：`.dev.vars` 已加入 `.gitignore`，请勿提交到 Git。

### 本地开发

```bash
# 创建本地 D1 并建表
npm run db:migrate:local

# 启动本地 dev server
npm run dev

# 手动触发一次推送（本地）
curl "http://localhost:8787/trigger"

# 类型检查
npm run typecheck
```

---

## 项目结构

```
src/
  index.ts          # Worker 入口，cron handler + HTTP 路由
  wechat.ts         # WeChat iLink HTTP 客户端（getupdates / sendmessage）
  db.ts             # D1 数据库操作
  formatter.ts      # 消息格式化
  landing.ts        # 落地页 HTML
  sources/
    news.ts         # RSS 拉取 + 解析 + 相关性排序
    finance.ts      # (备用) Binance BTC/ETH 行情
    usgs.ts         # (备用) USGS 地震数据
schema.sql          # D1 建表语句
scripts/
  login.mts         # 微信扫码登录 iLink bot，写入 .dev.vars
wrangler.toml       # Cloudflare Workers 配置
```

---

## 推送样例

```
📡 世界速报 · 05/12 15:00 北京时间
─────────────────

【特朗普宣布对中国商品暂缓加征关税90天】
美国总统特朗普周一签署行政令，宣布在贸易谈判期间暂停对部分中国商品征收的额外关税，
此前双方谈判代表于日内瓦达成初步框架协议。
— 法新社

【以色列对加沙北部发动新一轮空袭，造成至少23人死亡】
以色列国防军证实，其空军对加沙城及附近难民营发动定点清除行动，目标为哈马斯武装指挥官。
加沙卫生部称死亡人数已上升至23人，其中包括多名平民。
— VOA美国之音
```

---

## License

MIT
