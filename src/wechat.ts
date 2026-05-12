const BASE_URL = "https://ilinkai.weixin.qq.com";
const CHANNEL_VERSION = "wechat-world-push-0.1.0";

export interface WeixinMessage {
  from_user_id?: string;
  to_user_id?: string;
  context_token?: string;
  message_type?: number; // 1=USER, 2=BOT
  item_list?: Array<{ type?: number; text_item?: { text?: string } }>;
}

export interface GetUpdatesResp {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  get_updates_buf?: string;
}

export class ILinkError extends Error {
  constructor(
    public readonly errcode: number,
    public readonly errmsg: string,
  ) {
    super(`iLink errcode ${errcode}: ${errmsg}`);
    this.name = "ILinkError";
  }

  get isSessionExpired(): boolean {
    return this.errcode === -14;
  }

  get isRateLimit(): boolean {
    return this.errcode === -2 && this.errmsg.toLowerCase().includes("frequency");
  }

  get isStaleToken(): boolean {
    return this.errcode === -2 && !this.errmsg.toLowerCase().includes("frequency");
  }
}

export function extractText(msg: WeixinMessage): string {
  return (msg.item_list ?? [])
    .filter((item) => item.type === 1)
    .map((item) => item.text_item?.text ?? "")
    .join("")
    .trim();
}

function randomWechatUin(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const uint32 = new DataView(buf.buffer).getUint32(0, false);
  return btoa(String(uint32));
}

function buildHeaders(token: string, body: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "AuthorizationType": "ilink_bot_token",
    "Authorization": `Bearer ${token}`,
    "Content-Length": String(new TextEncoder().encode(body).length),
    "X-WECHAT-UIN": randomWechatUin(),
  };
}

export async function getUpdates(
  token: string,
  syncBuf: string,
  timeoutMs = 5_000
): Promise<GetUpdatesResp> {
  const body = JSON.stringify({
    get_updates_buf: syncBuf,
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${BASE_URL}/ilink/bot/getupdates`, {
      method: "POST",
      headers: buildHeaders(token, body),
      body,
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`getupdates HTTP ${resp.status}`);
    return (await resp.json()) as GetUpdatesResp;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ret: 0, msgs: [], get_updates_buf: syncBuf };
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function sendTextMessage(
  token: string,
  toUserId: string,
  contextToken: string,
  text: string
): Promise<void> {
  const clientId = `${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text } }],
      context_token: contextToken,
    },
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const resp = await fetch(`${BASE_URL}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: buildHeaders(token, body),
    body,
  });
  if (!resp.ok) throw new Error(`sendmessage HTTP ${resp.status}`);
  const json = (await resp.json()) as { ret?: number; errcode?: number; errmsg?: string };
  console.log("[wechat] sendmessage resp:", JSON.stringify(json));
  const errcode = (json.errcode ?? json.ret) as number | undefined;
  if (errcode !== undefined && errcode !== 0) {
    throw new ILinkError(errcode, json.errmsg ?? "");
  }
}
