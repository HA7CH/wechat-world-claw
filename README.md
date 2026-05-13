# 📡 中登BOT — WeChat iLink 国际要闻推送

> **项目状态：已停止（2026-05-13）**  
> 复盘页面：[wwc.ha7ch.com](https://wwc.ha7ch.com) · 代码照旧，感兴趣的自取。

---

## 是什么

一个 WeChat bot，每两小时推送一条国际要闻聚合文本到订阅用户的微信。

- 多源 RSS 聚合（联合国新闻、联合早报、澎湃新闻、虎嗅、36氪……）
- 关键词排序（中美、台湾、中东、降息……）
- 每人一个专属 bot，互不干扰
- 全托管在 Cloudflare Workers + D1 + KV，$0 月费
- 24 小时内从 0 到 74 个订阅者

## 为什么停了

1. **微信内容审核**：外媒（BBC/RFI/VOA）的链接和标题被直接拦截，用户看到「请稍后再试」
2. **iLink context_token 真实寿命约 12–14 小时**（不是文档暗示的那样长）：用户超过半天没跟 bot 交互，token 就失效，之后什么都发不出去
3. **CDN 不稳定**：图片广播走 WeChat 自家 CDN，间歇性 500，改成纯文字解决了一部分，但上面两个问题没法绕

## 时间线

```
07:00  验证想法
10:00  出 demo
12:00  上线
14:00  74 个订阅者
次日   验证不通过，决定 drop
```

---

## 架构

```
Cloudflare Workers (TypeScript)
│
├── HTTP
│   ├── GET /                    落地页（现已改为复盘页）
│   ├── GET /subscribe           生成 QR + 会话
│   ├── GET /subscribe/status    轮询扫码状态 + 实时激活
│   ├── GET /trigger-sync?force  同步触发广播（含返回值）
│   ├── GET /poll-pending        手动激活卡住的 pending 用户
│   ├── GET /status              查看上次广播每用户结果
│   ├── GET /r/:id               短链 302 重定向（未启用于广播）
│   └── GET /test-*              调试端点
│
└── Cron（已注释，恢复时取消注释 wrangler.toml）
    每 2h (UTC 0,2,4,6,8,10,12,14)
    → fetchNews(sinceLastPush)
    → 无新内容 → 跳过
    → 有 → 按 token 年龄分组广播
        < 8h   → 正常推文本新闻
        8–11h  → 新闻 + 保活提醒
        11–14h → 只发催活消息
        > 14h  → 跳过（token 已死）

Cloudflare D1 (SQLite)
    subscribers         已激活订阅者（bot_token + context_token）
    pending_subscribers 已扫码、等待发第一条消息的用户
    qr_sessions         QR 会话（8 分钟有效期）
    sync_state          上次推送时间 + 上次广播结果

Cloudflare KV (IMAGE_CACHE binding)
    latest              最新一张推送图（24h TTL，/preview 端点用）
    url:<id>            短链映射（30 天 TTL）
```

---

## 本地跑起来

### 前置

- Node.js ≥ 20
- Cloudflare 账号（免费套餐够用）
- `npm install -g wrangler`

### 步骤

```bash
git clone https://github.com/HA7CH/wechat-world-claw.git
cd wechat-world-claw
npm install

# 1. 创建 D1 数据库
npx wrangler d1 create wechat-world-push
# 把返回的 database_id 填入 wrangler.toml

# 2. 创建 KV namespace
npx wrangler kv namespace create IMAGE_CACHE
# 把返回的 id 填入 wrangler.toml

# 3. 建表
npx wrangler d1 execute wechat-world-push --remote --file=schema.sql

# 4. 恢复 cron（取消注释 wrangler.toml 里的 [triggers] 块）

# 5. 部署
npx wrangler deploy
```

### 关键配置（wrangler.toml）

```toml
[[d1_databases]]
binding = "DB"
database_name = "wechat-world-push"
database_id = "<你的 database_id>"

[[kv_namespaces]]
binding = "IMAGE_CACHE"
id = "<你的 kv_id>"
```

不需要任何 secret，bot token 是用户订阅时通过 WeChat iLink API 动态颁发的，存在 D1 里。

---

## 已知坑（踩过的）

| 问题 | 表现 | 原因 |
|---|---|---|
| 外媒链接/标题被拦 | 「请稍后再试」永远卡住 | 微信内容审核 |
| 短链被拦 | 同上 | 5 个 `wwc.ha7ch.com/r/` 短链触发反 spam |
| 大批量图片广播失败 | `iLink -2` 80% 失败 | WeChat CDN 频控，改文本广播解决 |
| context_token 14h 死亡 | `iLink -2` 无错误信息 | iLink 实际 TTL ≠ 文档推测值；代码里 `TOKEN_TTL_MS = 14h` |
| 注册激活不成功 | 用户扫码但收不到欢迎消息 | `handleSubscribeStatus` 曾被改成只读，不再主动调 `tryActivatePending`；已修复 |
| 多次重新扫码导致多个孤儿 bot | 微信里出现多个同名 bot | 每次扫码产生新 bot_token，旧的自动作废 |

---

## 推送样例

```
📡 世界速报 · 05/13 08:01 北京时间
─────────────────

【特朗普宣布对中国商品暂缓加征关税90天】
美国总统特朗普签署行政令，宣布在贸易谈判期间暂停对华额外关税……
https://m.thepaper.cn/detail/33169610
— 澎湃新闻

【以色列对加沙发动新一轮空袭，至少23人死亡】
...
— 联合国新闻
```

---

## License

MIT — 代码可以随便用，但微信的 iLink 协议是逆向所得，使用风险自负。
