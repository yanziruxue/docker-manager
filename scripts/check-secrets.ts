#!/usr/bin/env node
/**
 * 密钥存储链路断言（v1.37.0）
 *
 * 为什么存在：通知密钥（SMTP 密码 / Webhook 签名密钥）此前是**明文**躺在 settings.json 里，
 * 且 `GET /api/settings` 会把明文回传前端。这两件事都属于「静默退化」型缺陷：
 * 功能照样能用，泄漏与退化为明文都不会报错。本门禁把三件事钉死：
 *   ① 落盘必须是 AES-256-GCM 密文（而不是明文）
 *   ② 响应必须脱敏（前端永远拿不到明文）
 *   ③ 三态语义正确：留空 = 保持、__CLEAR__ = 清除、其它 = 新值
 *
 * 另覆盖：GCM 篡改检测、明文向后兼容、幂等（不二次加密）、env 覆盖优先级、跨文件常量契约。
 *
 * 跑法：`npm run test:secrets`（已并入 test:gates）。零网络；用唯一沙箱目录，不污染真实配置。
 */
import fs from "node:fs";
import path from "node:path";

// ★ 必须在 import 业务模块之前设好目录（paths.ts 在 import 期就固化了目录）
// 用**固定**沙箱路径而非唯一名：本门禁已并入 test:gates 会反复运行，唯一名会导致
// 仓库里不断堆积 .tmp-secrets-* 目录；固定路径 + 起步清理保持恒定占用。
const ROOT = path.resolve(".tmp-secrets-check");
const CFG = path.join(ROOT, "config");
const DATA = path.join(ROOT, "data");
const LOGS = path.join(ROOT, "logs");
for (const d of [CFG, DATA, LOGS]) fs.mkdirSync(d, { recursive: true });
// 起步清理：本门禁只写这两个文件，逐一 unlink 即可（单文件删除很快；
// 刻意不用递归 rm —— 本机「安全删除」垫片会把删目录路由到回收站并阻塞）。
for (const f of [path.join(CFG, "settings.json"), path.join(CFG, "secret.key")]) {
  try {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  } catch {
    /* 忽略 */
  }
}
process.env.DATA_DIR = DATA;
process.env.CONFIG_DIR = CFG;
process.env.LOG_DIR = LOGS;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, extra = "") {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? "  <<< " + extra : ""));
  }
}

const sec = (t: string) => console.log(`\n══ ${t} ══`);
const SETTINGS_FILE = path.join(CFG, "settings.json");
const KEY_FILE = path.join(CFG, "secret.key");
const SMTP_PW = "smtp-pass-绝密-123";
const HOOK_SECRET = "hook-secret-abc";

try {
  const store = await import("../server/secret-store.js");
  const settings = await import("../server/settings.js");

  // ---------- ① 加解密往返 ----------
  sec("① 加解密往返");
  const enc = store.encryptSecret(SMTP_PW);
  check("加密结果带 enc:v1: 前缀", enc.startsWith("enc:v1:"), enc.slice(0, 24) + "…");
  check("密文不含明文片段", !enc.includes("绝密") && !enc.includes(SMTP_PW));
  check("★ 解密还原一致", store.decryptSecret(enc) === SMTP_PW);
  check("★ 两次加密结果不同（IV 随机）", store.encryptSecret(SMTP_PW) !== enc);
  check("isEncrypted 判定正确", store.isEncrypted(enc) && !store.isEncrypted("plain"));
  check("空串加密仍为空串（没什么可加密）", store.encryptSecret("") === "");
  check("空串解密仍为空串", store.decryptSecret("") === "");

  // ---------- ② 幂等与向后兼容 ----------
  sec("② 幂等与向后兼容");
  check("★ 已加密值不再二次加密（幂等）", store.encryptSecret(enc) === enc);
  check("★ 历史明文原样返回（老配置无需迁移）", store.decryptSecret("legacy-plaintext-pw") === "legacy-plaintext-pw");

  // ---------- ③ GCM 篡改检测 ----------
  sec("③ GCM 篡改检测");
  const parts = enc.split(":");
  const ct = Buffer.from(parts[4], "base64");
  ct[0] = ct[0] ^ 0xff; // 翻转密文第一个字节
  const tampered = [...parts.slice(0, 4), ct.toString("base64")].join(":");
  let threw = false;
  let dec = "";
  try {
    dec = store.decryptSecret(tampered);
  } catch {
    threw = true;
  }
  check("★ 密文被篡改 ⇒ 不抛错（避免设置页整页打不开）", !threw);
  check("★★ 密文被篡改 ⇒ 返回空串而非错误明文（auth tag 校验失败）", dec === "", `实得 ${JSON.stringify(dec)}`);
  check("格式非法的密文 ⇒ 返回空串", store.decryptSecret("enc:v1:onlyonepart") === "");

  // ---------- ④ 三态语义（走真实 saveSettings 落盘） ----------
  sec("④ 三态语义：留空保持 / __CLEAR__ 清除 / 其它为新值");
  settings.saveSettings({
    notifications: {
      webhookEnabled: true,
      webhookUrl: "http://127.0.0.1:1/hook",
      webhookSecret: HOOK_SECRET,
      emailEnabled: true,
      emailSmtp: "smtp.example.com",
      emailPort: 587,
      emailUser: "bot@example.com",
      emailPassword: SMTP_PW,
      emailFrom: "",
      emailTo: "me@example.com",
    },
  });

  const rawOnDisk = fs.readFileSync(SETTINGS_FILE, "utf8");
  check("★ 落盘文件里没有 SMTP 明文密码", !rawOnDisk.includes(SMTP_PW));
  check("★ 落盘文件里没有 Webhook 明文密钥", !rawOnDisk.includes(HOOK_SECRET));
  check("★ 落盘文件里是 enc:v1: 密文", rawOnDisk.includes("enc:v1:"));
  check("★ 读回能解出明文（后端自己要用）", settings.getSettings().notifications.emailPassword === SMTP_PW);
  check("★ 读回能解出 Webhook 密钥", settings.getSettings().notifications.webhookSecret === HOOK_SECRET);

  // 留空 = 保持
  settings.saveSettings({ notifications: { ...settings.getSettings().notifications, emailPassword: "", webhookSecret: "" } });
  const g1 = settings.getSettings().notifications;
  check("★★ 留空提交 ⇒ 密码保持原值（不会被清掉）", g1.emailPassword === SMTP_PW);
  check("★★ 留空提交 ⇒ 密钥保持原值", g1.webhookSecret === HOOK_SECRET);

  // 新值覆盖
  settings.saveSettings({ notifications: { ...settings.getSettings().notifications, emailPassword: "new-pass-2" } });
  check("★ 传新值 ⇒ 覆盖成功", settings.getSettings().notifications.emailPassword === "new-pass-2");
  check("★ 覆盖后落盘仍无明文", !fs.readFileSync(SETTINGS_FILE, "utf8").includes("new-pass-2"));

  // __CLEAR__ 清除
  settings.saveSettings({ notifications: { ...settings.getSettings().notifications, emailPassword: settings.SECRET_CLEAR } });
  check("★ 传 __CLEAR__ ⇒ 密码被清空", settings.getSettings().notifications.emailPassword === "");

  // ---------- ⑤ 响应脱敏 ----------
  sec("⑤ 响应脱敏（密钥不回传前端）");
  settings.saveSettings({ notifications: { ...settings.getSettings().notifications, emailPassword: SMTP_PW, webhookSecret: HOOK_SECRET } });
  const red = settings.redactSettings(settings.getSettings());
  check("★★ 脱敏后 emailPassword 为空串", red.notifications.emailPassword === "");
  check("★★ 脱敏后 webhookSecret 为空串", red.notifications.webhookSecret === "");
  check("★ 脱敏对象里不含任何明文密钥",
    !JSON.stringify(red).includes(SMTP_PW) && !JSON.stringify(red).includes(HOOK_SECRET));
  check("★ 以「已设置」标志替代明文", red.notifications.emailPasswordSet === true && red.notifications.webhookSecretSet === true);
  check("★ 未设置时标志为 false",
    settings.redactSettings({ notifications: { emailPassword: "", webhookSecret: "" } }).notifications.emailPasswordSet === false);
  check("★ saveSettings 的返回值也脱敏（PUT 响应不会漏明文）",
    settings.saveSettings({ notifications: { ...settings.getSettings().notifications } }).notifications.emailPassword === "");

  // ---------- ⑥ 主密钥文件 ----------
  sec("⑥ 主密钥文件");
  check("★ 已生成 secret.key", fs.existsSync(KEY_FILE));
  const keyText = fs.readFileSync(KEY_FILE, "utf8").trim();
  check("★ 密钥为 32 字节（AES-256）", Buffer.from(keyText, "hex").length === 32, `实得 ${Buffer.from(keyText, "hex").length} 字节`);
  if (process.platform === "linux") {
    const mode = fs.statSync(KEY_FILE).mode & 0o777;
    check("★ 密钥文件权限 0600", mode === 0o600, `实得 0o${mode.toString(8)}`);
  } else {
    console.log(`  SKIP  密钥文件权限 0600（当前平台 ${process.platform} 无 POSIX 权限位；Linux 上生效）`);
  }
  check("★ 密钥内容不是明文密码", !keyText.includes(SMTP_PW));

  // ---------- ⑦ env 覆盖 + 来源 ----------
  sec("⑦ 环境变量覆盖");
  const notify = await import("../server/notify.js");
  process.env.DMS_SMTP_PASSWORD = "env-pass";
  process.env.DMS_WEBHOOK_SECRET = "env-hook";
  const src = notify.getSecretSources();
  check("★★ env 设置后来源为 env", src.smtpPassword === "env" && src.webhookSecret === "env", JSON.stringify(src));
  delete process.env.DMS_SMTP_PASSWORD;
  delete process.env.DMS_WEBHOOK_SECRET;
  const src2 = notify.getSecretSources();
  check("★★ 未设 env 时回落到配置文件（file）", src2.smtpPassword === "file" && src2.webhookSecret === "file", JSON.stringify(src2));
  check("★ 清理后配置里确实没密钥 ⇒ 来源为 none", (() => {
    settings.saveSettings({ notifications: { ...settings.getSettings().notifications, emailPassword: settings.SECRET_CLEAR, webhookSecret: settings.SECRET_CLEAR } });
    const s3 = notify.getSecretSources();
    return s3.smtpPassword === "none" && s3.webhookSecret === "none";
  })());
  check("★ 加密状态自检可用", typeof settings.secretsAreEncrypted() === "boolean");

  // ---------- ⑧ 跨文件契约 ----------
  sec("⑧ 跨文件常量契约");
  const feTypes = fs.readFileSync(path.resolve("src/types.ts"), "utf8");
  const feClear = (feTypes.match(/export const SECRET_CLEAR = "([^"]+)"/) || [])[1];
  check("★★ 前端 SECRET_CLEAR 与后端一致", feClear === settings.SECRET_CLEAR,
    `前端 ${JSON.stringify(feClear)} / 后端 ${JSON.stringify(settings.SECRET_CLEAR)}`);
  const uiSrc = fs.readFileSync(path.resolve("src/pages/Settings.tsx"), "utf8");
  check("★ 前端用 SecretField 渲染密钥（带「清除」与 env 只读提示）",
    /<SecretField/.test(uiSrc) && /SECRET_CLEAR/.test(uiSrc) && /已由环境变量/.test(uiSrc));
  check("★ GET /api/settings 走脱敏", /res\.json\(\{ success: true, data: redactSettings\(getSettings\(\)\) \}\)/.test(
    fs.readFileSync(path.resolve("server/index.ts"), "utf8")));

  // ---------- ⑨ git 泄漏防线 ----------
  sec("⑨ git 泄漏防线");
  const gi = fs.readFileSync(path.resolve(".gitignore"), "utf8");
  check("★ .gitignore 忽略 settings.json（运行时配置含密钥，绝不入库）", /^settings\.json$/m.test(gi));
  check("★ .gitignore 仍忽略 .env 系列", /^\.env$/m.test(gi));
} catch (e: any) {
  console.log(`\n!! 断言执行异常：${e?.message || e}`);
  fail++;
} finally {
  console.log(`\n结果: PASS=${pass}  FAIL=${fail}`);
  console.log(`沙箱目录: ${ROOT}`);
  process.exit(fail === 0 ? 0 : 1);
}
