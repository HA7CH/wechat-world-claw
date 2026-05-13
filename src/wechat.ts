// @ts-ignore - @noble/hashes/legacy exports md5 at this path
import { md5 } from "@noble/hashes/legacy.js";

const BASE_URL = "https://ilinkai.weixin.qq.com";
const CDN_URL = "https://novac2c.cdn.weixin.qq.com";

export interface QrCodeResponse {
  qrcode: string;
  qrcode_img_content: string;
  ret?: number;
  errcode?: number;
}

export type QrCodeStatus =
  | { status: "wait" | "scaned" | "expired" }
  | { status: "confirmed"; bot_token: string; ilink_bot_id: string; ilink_user_id: string; baseurl?: string };

export async function getBotQrCode(): Promise<QrCodeResponse> {
  const resp = await fetch(
    `${BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`,
    { headers: { "iLink-App-ClientVersion": "1" } },
  );
  if (!resp.ok) throw new Error(`get_bot_qrcode HTTP ${resp.status}`);
  return resp.json() as Promise<QrCodeResponse>;
}

export async function pollQrCodeStatus(qrcode: string, timeoutMs = 4_000): Promise<QrCodeStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(
      `${BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
      { headers: { "iLink-App-ClientVersion": "1" }, signal: controller.signal },
    );
    if (!resp.ok) throw new Error(`get_qrcode_status HTTP ${resp.status}`);
    return resp.json() as Promise<QrCodeStatus>;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { status: "wait" };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
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

// ── image upload ─────────────────────────────────────────────────────────────

// AES-128-ECB via Web Crypto: encrypt each 16-byte block independently
// using AES-CBC with a zero IV (CBC(block, zeroIV) = ECB(block) for single block)
async function aes128EcbEncrypt(key: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const padLen = 16 - (plaintext.length % 16);
  const padded = new Uint8Array(plaintext.length + padLen);
  padded.set(plaintext);
  padded.fill(padLen, plaintext.length);

  const keyBuf = key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer;
  const cryptoKey = await crypto.subtle.importKey("raw", keyBuf, { name: "AES-CBC" }, false, ["encrypt"]);
  const zeroIv = new Uint8Array(16);
  const blockCount = padded.length / 16;
  const result = new Uint8Array(padded.length);

  for (let i = 0; i < blockCount; i++) {
    const block = padded.slice(i * 16, (i + 1) * 16);
    const blockBuf = block.buffer.slice(block.byteOffset, block.byteOffset + block.byteLength) as ArrayBuffer;
    const enc = await crypto.subtle.encrypt({ name: "AES-CBC", iv: zeroIv }, cryptoKey, blockBuf);
    result.set(new Uint8Array(enc).subarray(0, 16), i * 16);
  }
  return result;
}

// Prepared image: encrypted once, reused across all per-user uploads
export interface PreparedImage {
  encryptedBytes: Uint8Array;
  encryptedBuf: ArrayBuffer;
  aeskeyHex: string;
  aesKey: string;   // base64 of aeskeyHex ASCII bytes, matching iLink media.aes_key
  rawMd5: string;
  rawSize: number;
  fileSize: number;
}

export async function prepareImage(imageBytes: Uint8Array): Promise<PreparedImage> {
  const aeskeyBytes = crypto.getRandomValues(new Uint8Array(16));
  const aeskeyHex = Array.from(aeskeyBytes, (b) => b.toString(16).padStart(2, "0")).join("");
  const md5Bytes: Uint8Array = md5(imageBytes);
  const rawMd5 = Array.from(md5Bytes, (b) => (b as number).toString(16).padStart(2, "0")).join("");
  const encryptedBytes = await aes128EcbEncrypt(aeskeyBytes, imageBytes);
  const encryptedBuf = encryptedBytes.buffer.slice(
    encryptedBytes.byteOffset, encryptedBytes.byteOffset + encryptedBytes.byteLength
  ) as ArrayBuffer;
  // iLink media.aes_key uses base64(hex string), while getuploadurl.aeskey uses plain hex.
  const aesKey = btoa(aeskeyHex);
  return {
    encryptedBytes,
    encryptedBuf,
    aeskeyHex,
    aesKey,
    rawMd5,
    rawSize: imageBytes.length,
    fileSize: encryptedBytes.length,
  };
}

export interface ImageUploadResult {
  encryptQueryParam: string;
  aesKey: string;
  fileSize: number;   // encrypted size
  rawSize: number;    // original PNG size
}

// Upload per-user (CDN resource is bound to to_user_id)
export async function uploadPreparedImage(
  token: string,
  toUserId: string,
  p: PreparedImage
): Promise<ImageUploadResult> {
  const filekey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  const body = JSON.stringify({
    filekey,
    media_type: 1,
    to_user_id: toUserId,
    rawsize: p.rawSize,
    rawfilemd5: p.rawMd5,
    filesize: p.fileSize,
    no_need_thumb: true,
    aeskey: p.aeskeyHex,
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const resp = await fetch(`${BASE_URL}/ilink/bot/getuploadurl`, {
    method: "POST",
    headers: buildHeaders(token, body),
    body,
  });
  if (!resp.ok) throw new Error(`getuploadurl HTTP ${resp.status}`);
  const json = (await resp.json()) as {
    ret?: number; errcode?: number; errmsg?: string;
    upload_full_url?: string; upload_param?: string;
  };
  if ((json.errcode ?? json.ret) && json.errcode !== 0) {
    throw new ILinkError(json.errcode!, json.errmsg ?? "");
  }
  const cdnUrl = json.upload_full_url
    ?? (json.upload_param
      ? `${CDN_URL}/c2c/upload?encrypted_query_param=${encodeURIComponent(json.upload_param)}&filekey=${encodeURIComponent(filekey)}`
      : null);
  if (!cdnUrl) throw new Error(`getuploadurl: no upload url`);

  const cdnResp = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: p.encryptedBuf,
  });
  console.log("[cdn] status:", cdnResp.status);
  const allHeaders: Record<string,string> = {};
  cdnResp.headers.forEach((v,k) => { allHeaders[k] = v; });
  console.log("[cdn] headers:", JSON.stringify(allHeaders));
  if (!cdnResp.ok) throw new Error(`CDN upload HTTP ${cdnResp.status}`);

  const encryptQueryParam = cdnResp.headers.get("x-encrypted-param");
  if (!encryptQueryParam) throw new Error("CDN upload: missing x-encrypted-param");

  return { encryptQueryParam, aesKey: p.aesKey, fileSize: p.fileSize, rawSize: p.rawSize };
}

// Voice upload (media_type=4); reuses PreparedImage encryption shape.
export async function uploadPreparedVoice(
  token: string,
  toUserId: string,
  p: PreparedImage
): Promise<ImageUploadResult> {
  const filekey = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");

  const body = JSON.stringify({
    filekey,
    media_type: 4, // VOICE
    to_user_id: toUserId,
    rawsize: p.rawSize,
    rawfilemd5: p.rawMd5,
    filesize: p.fileSize,
    no_need_thumb: true,
    aeskey: p.aeskeyHex,
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const resp = await fetch(`${BASE_URL}/ilink/bot/getuploadurl`, {
    method: "POST",
    headers: buildHeaders(token, body),
    body,
  });
  if (!resp.ok) throw new Error(`getuploadurl HTTP ${resp.status}`);
  const json = (await resp.json()) as {
    ret?: number; errcode?: number; errmsg?: string;
    upload_full_url?: string; upload_param?: string;
  };
  if ((json.errcode ?? json.ret) && json.errcode !== 0) {
    throw new ILinkError(json.errcode!, json.errmsg ?? "");
  }
  const cdnUrl = json.upload_full_url
    ?? (json.upload_param
      ? `${CDN_URL}/c2c/upload?encrypted_query_param=${encodeURIComponent(json.upload_param)}&filekey=${encodeURIComponent(filekey)}`
      : null);
  if (!cdnUrl) throw new Error(`getuploadurl: no upload url`);

  const cdnResp = await fetch(cdnUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: p.encryptedBuf,
  });
  console.log("[cdn voice] status:", cdnResp.status);
  if (!cdnResp.ok) throw new Error(`CDN upload HTTP ${cdnResp.status}`);

  const encryptQueryParam = cdnResp.headers.get("x-encrypted-param");
  if (!encryptQueryParam) throw new Error("CDN upload: missing x-encrypted-param");

  return { encryptQueryParam, aesKey: p.aesKey, fileSize: p.fileSize, rawSize: p.rawSize };
}

export interface VoiceMeta {
  encodeType: number;    // 6=silk, 7=mp3
  sampleRate: number;    // Hz
  bitsPerSample: number;
  playtimeMs: number;
}

export async function sendVoiceMessage(
  token: string,
  toUserId: string,
  contextToken: string,
  upload: ImageUploadResult,
  meta: VoiceMeta,
): Promise<void> {
  const clientId = `${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [
        {
          type: 3, // VOICE
          voice_item: {
            media: {
              encrypt_query_param: upload.encryptQueryParam,
              aes_key: upload.aesKey,
              encrypt_type: 1,
            },
            encode_type: meta.encodeType,
            sample_rate: meta.sampleRate,
            bits_per_sample: meta.bitsPerSample,
            duration: meta.playtimeMs,
          },
        },
      ],
    },
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const resp = await fetch(`${BASE_URL}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: buildHeaders(token, body),
    body,
  });
  if (!resp.ok) throw new Error(`sendVoiceMessage HTTP ${resp.status}`);
  const respJson = (await resp.json()) as { ret?: number; errcode?: number; errmsg?: string };
  console.log("[sendvoice] resp:", JSON.stringify(respJson));
  const errcode = (respJson.errcode ?? respJson.ret) as number | undefined;
  if (errcode !== undefined && errcode !== 0) {
    throw new ILinkError(errcode, respJson.errmsg ?? "");
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

export async function sendImageMessage(
  token: string,
  toUserId: string,
  contextToken: string,
  upload: ImageUploadResult
): Promise<void> {
  const clientId = `${Date.now()}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0")}`;
  const body = JSON.stringify({
    msg: {
      from_user_id: "",
      to_user_id: toUserId,
      client_id: clientId,
      message_type: 2,
      message_state: 2,
      context_token: contextToken,
      item_list: [
        {
          type: 2, // IMAGE
          image_item: {
            media: {
              encrypt_query_param: upload.encryptQueryParam,
              aes_key: upload.aesKey,
              encrypt_type: 1,
            },
            mid_size: upload.fileSize,  // encrypted size (per spec)
          },
        },
      ],
    },
    base_info: { channel_version: CHANNEL_VERSION },
  });

  const resp = await fetch(`${BASE_URL}/ilink/bot/sendmessage`, {
    method: "POST",
    headers: buildHeaders(token, body),
    body,
  });
  if (!resp.ok) throw new Error(`sendImageMessage HTTP ${resp.status}`);
  const respJson = (await resp.json()) as { ret?: number; errcode?: number; errmsg?: string };
  console.log("[sendimg] resp:", JSON.stringify(respJson));
  const errcode2 = (respJson.errcode ?? respJson.ret) as number | undefined;
  if (errcode2 !== undefined && errcode2 !== 0) {
    throw new ILinkError(errcode2, respJson.errmsg ?? "");
  }
}
