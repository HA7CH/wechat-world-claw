/**
 * 微信 iLink Bot 扫码登录脚本
 *
 * 用法：npm run login
 *
 * 运行后终端会出现一个二维码，用微信扫一下，
 * 登录成功后会把 WECHAT_TOKEN 和 WECHAT_ACCOUNT_ID 写入 .dev.vars。
 */

import { ApiClient, loginWithQRCode } from "wechat-ilink-client";
// @ts-ignore - no type declarations for qrcode-terminal
import qrcode from "qrcode-terminal";
import fs from "node:fs";
import path from "node:path";

const DEV_VARS_PATH = path.resolve(process.cwd(), ".dev.vars");

async function main() {
  console.log("🔐 开始微信 iLink Bot 登录，请用微信扫码...\n");

  const api = new ApiClient({});

  const result = await loginWithQRCode(api, {
    onQRCode: (url: string) => {
      console.log("请用微信扫描下方二维码：\n");
      qrcode.generate(url, { small: true });
      console.log(`\n（链接：${url}）\n`);
    },
  });

  if (!result.connected || !result.botToken || !result.accountId) {
    console.error("❌ 登录失败：", result.message);
    process.exit(1);
  }

  const { botToken, accountId } = result;

  console.log("\n✅ 登录成功！");

  // 更新 .dev.vars
  let content = fs.existsSync(DEV_VARS_PATH)
    ? fs.readFileSync(DEV_VARS_PATH, "utf-8")
    : "WECHAT_TOKEN=your_token_here\nWECHAT_ACCOUNT_ID=your_account_id_here\n";

  content = content
    .replace(/^WECHAT_TOKEN=.*$/m, `WECHAT_TOKEN=${botToken}`)
    .replace(/^WECHAT_ACCOUNT_ID=.*$/m, `WECHAT_ACCOUNT_ID=${accountId}`);

  fs.writeFileSync(DEV_VARS_PATH, content, "utf-8");
  console.log("✅ 已写入 .dev.vars\n");

  console.log("部署时运行以下命令把 secrets 写到 Cloudflare：");
  console.log("  npx wrangler secret put WECHAT_TOKEN");
  console.log("  npx wrangler secret put WECHAT_ACCOUNT_ID");
}

main().catch((err) => {
  console.error("❌ 出错：", err);
  process.exit(1);
});
