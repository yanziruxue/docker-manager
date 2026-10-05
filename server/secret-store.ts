/**
 * 密钥落盘存储：AES-256-GCM 加密 + 明文向后兼容
 *
 * ⚠️ **能力边界（务必如实理解）**：
 *   本模块**防的是「文件被误传」** —— settings.json 被误提交 git、被备份/打包带走、
 *   被贴进 issue 或日志。密文离开本机即无用。
 *   它**防不住「已经能读本机 CONFIG_DIR 的人」** —— 主密钥（secret.key）必然与
 *   settings.json 在同一台机器上，能读到密文的人通常也能读到密钥。
 *   单机自托管场景下，真正的防线是「文件权限 + 不把密钥写进前端响应」。
 *
 * 存储格式：`enc:v1:<iv b64>:<tag b64>:<密文 b64>`
 *   - `v1` 版本号，便于将来换算法时区分；
 *   - GCM 的 auth tag 会随密文一起存，**任何篡改都会导致解密失败**（不会被静默接受）；
 *   - 无前缀的值一律当作**历史明文**原样返回 ⇒ 老配置无需迁移即可继续用。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./paths.js";
import { createLogger } from "./logger.js";

const log = createLogger("Secret");

/** 主密钥文件（与 settings.json 同目录） */
export const KEY_FILE = path.join(CONFIG_DIR, "secret.key");
const ENC_PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM 推荐 96 bit

let cachedKey: Buffer | null = null;

/**
 * 读取（首次调用时生成）本机主密钥。
 * 权限 0600：仅服务运行账号可读。失败时抛错，由调用方降级为「不加密」而不是崩掉。
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (fs.existsSync(KEY_FILE)) {
    const text = fs.readFileSync(KEY_FILE, "utf8").trim();
    const raw = Buffer.from(text, "hex");
    if (raw.length !== KEY_BYTES) {
      throw new Error(`主密钥长度异常（期望 ${KEY_BYTES} 字节，实得 ${raw.length}）；文件：${KEY_FILE}`);
    }
    cachedKey = raw;
    return raw;
  }
  const fresh = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  // hex 文本形态：便于人工确认与备份，且不会因为编辑器/传输把二进制改坏
  fs.writeFileSync(KEY_FILE, fresh.toString("hex"), { encoding: "utf8", mode: 0o600 });
  chmod600(KEY_FILE);
  log.info(`已生成本机密钥文件 ${KEY_FILE}（权限 0600）—— 请把它与 settings.json 一起妥善保管，勿公开或提交`);
  cachedKey = fresh;
  return fresh;
}

/** 尽量收紧到 0600（Windows/NTFS 无 POSIX 权限位，chmod 无效属正常） */
function chmod600(file: string): void {
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* Windows 上会失败，忽略 */
  }
}

/** 主密钥文件是否已存在（供状态接口展示） */
export function keyFileExists(): boolean {
  return fs.existsSync(KEY_FILE);
}

/** 该值是否为本模块产出的密文 */
export function isEncrypted(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(ENC_PREFIX);
}

/**
 * 加密。**幂等**：已加密的值原样返回（避免二次加密）；空串原样返回（没东西要加密）。
 * 加密失败（如密钥文件不可写）时**返回明文**并告警 —— 宁可退化为旧行为，也不让保存整体失败。
 */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  if (isEncrypted(plain)) return plain; // 幂等：密文不再加密
  try {
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENC_PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
  } catch (e: any) {
    log.warn(`密钥加密失败，将按明文保存（${e?.message || e}）`);
    return plain;
  }
}

/**
 * 解密。**向后兼容**：非密文（历史明文）原样返回。
 * 解密失败（密钥丢失/被换/密文被篡改）⇒ 返回空串并告警，**绝不抛错**
 *（否则设置页会整页打不开，用户连重新填密钥的机会都没有）。
 */
export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!isEncrypted(stored)) return stored; // 历史明文
  const body = stored.slice(ENC_PREFIX.length);
  const parts = body.split(":");
  if (parts.length !== 3) {
    log.warn("密钥密文格式非法（段数不为 3），按未设置处理");
    return "";
  }
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const decipher = crypto.createDecipheriv(ALGO, getKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch (e: any) {
    // 典型成因：secret.key 丢失/被替换、或密文被改动（GCM 校验不过）
    log.warn(
      `密钥解密失败（${e?.message || e}）—— 常见原因：${path.basename(KEY_FILE)} 丢失或与密文不是同一份。请重新填写该密钥`,
    );
    return "";
  }
}
