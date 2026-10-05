/**
 * 通知发送（Webhook + 邮件）—— 统一入口
 *
 * ⚠️ 此前「设置 → 通知配置」里的 Webhook / 邮件**只有 UI 与配置落盘、没有任何消费端**，
 *    属于装饰性 stub。本模块是那批配置的消费端。
 *
 * 设计要点：
 *  - **永不抛错**：通知是旁路，失败只写日志，绝不影响容器启停 / 镜像拉取等主流程；
 *  - **不阻塞调用方**：`notify()` 内部即 fire-and-forget，主流程调用一行搞定；
 *  - **按事件开关过滤**：`settings.notifications.events.<key>` 为真才发；
 *  - **去重降噪**：同一 `dedupKey` 在 TTL 内只发一次（容器反复重启、更新检查每小时跑一次，
 *    不去噪会直接变成骚扰）；
 *  - **不写密钥**：SMTP 密码 / Webhook 签名密钥永不进日志。
 *
 * 事件与触发源（`buildFailed` 除外，见 EVENT_LABELS 注释）：
 *  - containerDown   → 本模块的容器状态巡检（后端原本没有状态变化检测）
 *  - updateAvailable → scheduler.checkEngineImages（镜像更新检查）
 *  - updateComplete  → docker.ts 拉取任务成功（镜像更新完成）
 *  - buildFailed     → **本项目没有镜像构建功能**，暂无触发源，开关保留但不生效
 */
import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { createLogger } from "./logger.js";
import { getSettings } from "./settings.js";
import { CURRENT_VERSION } from "./updater.js";
import os from "node:os";

const log = createLogger("Notify");

/** 事件键：与 settings.notifications.events 的键一一对应 */
export type NotifyEventKey = "containerDown" | "updateAvailable" | "updateComplete" | "buildFailed";

export const EVENT_LABELS: Record<NotifyEventKey, string> = {
  containerDown: "容器停止/异常",
  updateAvailable: "检测到可用更新",
  updateComplete: "更新完成",
  buildFailed: "构建失败",
};

/** ⚠️ buildFailed 无触发源：本项目没有镜像构建功能（`buildImageRef` 只是拼镜像名） */
export const EVENTS_WITHOUT_SOURCE: NotifyEventKey[] = ["buildFailed"];

export interface NotifyPayload {
  event: NotifyEventKey;
  /** 短标题，如「容器异常」 */
  title: string;
  /** 一句话摘要 */
  summary: string;
  /** 明细行（可选） */
  lines?: string[];
  level: "info" | "warning" | "error";
  /** 去重键：同一键在 TTL 内只发一次。不传则不去重 */
  dedupKey?: string;
}

const WEBHOOK_TIMEOUT_MS = 8_000;
const SMTP_TIMEOUT_MS = 15_000;
/** 去重窗口：同一 dedupKey 在此时间内不重复发送 */
const DEDUP_TTL_MS = 10 * 60 * 1000;

const dedup = new Map<string, number>();

function claimDedupe(key: string | undefined): boolean {
  if (!key) return true; // 未给键 = 不去重
  const now = Date.now();
  // 顺手清理过期项，避免 Map 无限增长
  for (const [k, at] of dedup) if (now - at > DEDUP_TTL_MS) dedup.delete(k);
  const prev = dedup.get(key);
  if (prev && now - prev < DEDUP_TTL_MS) return false;
  dedup.set(key, now);
  return true;
}

/**
 * 密钥可被环境变量覆盖。
 * systemd 部署可把这两行放进 `EnvironmentFile=/etc/docker-manager-yanzi/secrets.env`（0600、仅 root 可读）
 * ⇒ **密钥根本不落 app 的配置目录**，也不进备份包。
 * 沿用项目既有 env 覆盖先例（`UPDATE_GITEA_BASE` / `UPDATE_GITEA_REPO` / `UPDATE_MIRROR`）。
 */
export const ENV_SMTP_PASSWORD = "DMS_SMTP_PASSWORD";
export const ENV_WEBHOOK_SECRET = "DMS_WEBHOOK_SECRET";

/** 密钥来源：环境变量 / 配置文件 / 未设置 */
export type SecretSource = "env" | "file" | "none";

type SecretPick = { value: string; source: SecretSource };

/** env 优先于配置文件（env 为空串视为未设置，回落到文件） */
function pickSecret(envName: string, fileValue: string): SecretPick {
  const fromEnv = (process.env[envName] || "").trim();
  if (fromEnv) return { value: fromEnv, source: "env" };
  const v = String(fileValue || "");
  return { value: v, source: v ? "file" : "none" };
}

/** 读取通知配置（每次现读，用户改完设置立即生效，不需重启） */
function readNotifyConfig() {
  const s = getSettings() as any;
  const n = s?.notifications || {};
  const smtpPw = pickSecret(ENV_SMTP_PASSWORD, n.emailPassword);
  const hookSecret = pickSecret(ENV_WEBHOOK_SECRET, n.webhookSecret);
  return {
    events: (n.events || {}) as Partial<Record<NotifyEventKey, boolean>>,
    secretSource: { smtpPassword: smtpPw.source, webhookSecret: hookSecret.source },
    webhook: {
      enabled: !!n.webhookEnabled,
      url: String(n.webhookUrl || "").trim(),
      secret: hookSecret.value,
    },
    email: {
      enabled: !!n.emailEnabled,
      host: String(n.emailSmtp || "").trim(),
      port: Number(n.emailPort) || 587,
      user: String(n.emailUser || "").trim(),
      password: smtpPw.value,
      from: String(n.emailFrom || "").trim(),
      to: String(n.emailTo || "")
        .split(/[,;]/)
        .map((s: string) => s.trim())
        .filter(Boolean),
    },
  };
}

/** 组装两种通道通用的正文（纯文本） */
function renderText(p: NotifyPayload): string {
  const host = os.hostname();
  const lines = [
    `[${EVENT_LABELS[p.event]}] ${p.title}`,
    "",
    p.summary,
    ...(p.lines && p.lines.length ? ["", ...p.lines.map((l) => `- ${l}`)] : []),
    "",
    `主机：${host}    应用：Docker Stack Manager v${CURRENT_VERSION}    时间：${new Date().toLocaleString("zh-CN")}`,
  ];
  return lines.join("\n");
}

// ============ Webhook ============

/** 计算签名：HMAC-SHA256(body, secret)，十六进制。未配密钥返回空串 */
export function signPayload(body: string, secret: string): string {
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/** 发送 Webhook（POST application/json）。失败抛错给调用方记录，不外泄 */
export async function sendWebhook(
  url: string,
  secret: string,
  p: NotifyPayload,
): Promise<void> {
  const body = JSON.stringify({
    event: p.event,
    eventLabel: EVENT_LABELS[p.event],
    level: p.level,
    title: p.title,
    summary: p.summary,
    lines: p.lines || [],
    host: os.hostname(),
    app: "docker-stack-manager",
    version: CURRENT_VERSION,
    at: new Date().toISOString(),
    text: renderText(p),
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = signPayload(body, secret);
  if (sig) headers["x-docker-manager-signature"] = `sha256=${sig}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Webhook 返回 ${res.status} ${res.statusText}`);
}

// ============ 邮件 ============

/** 发送邮件（nodemailer）。失败抛错给调用方记录，不外泄（错误信息里不含密码） */
export async function sendEmail(
  cfg: { host: string; port: number; user: string; password: string; from: string; to: string[] },
  p: NotifyPayload,
): Promise<void> {
  if (!cfg.to.length) throw new Error("收件人为空");
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    // 465 = 隐式 TLS；其余（587/25 等）走 STARTTLS，由 nodemailer 按服务端能力协商
    secure: cfg.port === 465,
    auth: cfg.user ? { user: cfg.user, pass: cfg.password } : undefined,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
  });
  try {
    await transport.sendMail({
      from: cfg.from || cfg.user,
      to: cfg.to.join(", "),
      subject: `[${EVENT_LABELS[p.event]}] ${p.title} — ${os.hostname()}`,
      text: renderText(p),
    });
  } finally {
    transport.close();
  }
}

// ============ 统一入口 ============

export interface NotifyResult {
  webhook: "skipped" | "sent" | "failed";
  email: "skipped" | "sent" | "failed";
  errors: string[];
}

/**
 * 发通知。**永不抛错**。
 * 立即返回（内部 void 异步执行），调用方无需 await，也不会被拖慢。
 */
export function notify(p: NotifyPayload): void {
  void doNotify(p);
}

/** 实际发送（供 notify 与测试端点复用） */
export async function doNotify(p: NotifyPayload, opts?: { force?: boolean }): Promise<NotifyResult> {
  const res: NotifyResult = { webhook: "skipped", email: "skipped", errors: [] };
  let cfg: ReturnType<typeof readNotifyConfig>;
  try {
    cfg = readNotifyConfig();
  } catch (e: any) {
    log.warn(`读取通知配置失败：${e?.message || e}`);
    return res;
  }

  // 事件开关：测试端点（force）跳过开关
  if (!opts?.force && cfg.events[p.event] === false) return res;

  // 去重
  if (!claimDedupe(opts?.force ? undefined : p.dedupKey)) {
    log.debug(`事件 ${p.event} 在去重窗口内，跳过：${p.dedupKey || ""}`);
    return res;
  }

  const tasks: Promise<void>[] = [];

  if (cfg.webhook.enabled && cfg.webhook.url) {
    tasks.push(
      sendWebhook(cfg.webhook.url, cfg.webhook.secret, p)
        .then(() => {
          res.webhook = "sent";
        })
        .catch((e: any) => {
          res.webhook = "failed";
          // URL 可能带 token，只记主机名段
          res.errors.push(`Webhook 失败：${e?.message || e}`);
        }),
    );
  }

  if (cfg.email.enabled && cfg.email.host && cfg.email.user && cfg.email.to.length) {
    tasks.push(
      sendEmail(cfg.email, p)
        .then(() => {
          res.email = "sent";
        })
        .catch((e: any) => {
          res.email = "failed";
          res.errors.push(`邮件失败：${e?.message || e}`);
        }),
    );
  }

  await Promise.all(tasks);
  if (res.errors.length) log.warn(`事件 ${p.event} 推送失败：${res.errors.join("；")}`);
  else if (res.webhook === "sent" || res.email === "sent")
    log.info(`事件 ${p.event} 已推送（webhook=${res.webhook} email=${res.email}）：${p.title}`);
  return res;
}

/** 密钥来源自检（供 `/api/notify/status` 展示「来自环境变量（只读）」） */
export function getSecretSources(): { smtpPassword: SecretSource; webhookSecret: SecretSource } {
  try {
    return readNotifyConfig().secretSource;
  } catch {
    return { smtpPassword: "none", webhookSecret: "none" };
  }
}

/** 测试端点用：忽略去重与事件开关，强制走一遍两个通道 */export function sendTestNotify(): Promise<NotifyResult> {
  return doNotify(
    {
      event: "containerDown",
      title: "测试通知",
      summary: "这是一条来自 Docker Stack Manager 的测试通知，收到即说明推送链路正常。",
      lines: ["若收到本条，说明 Webhook / 邮件通道均已生效", `应用版本 v${CURRENT_VERSION}`],
      level: "info",
    },
    { force: true },
  );
}

// ============ 容器状态巡检（containerDown 的唯一触发源） ============

/** 引擎容器快照：engineId -> Map<containerId, running> */
let lastStates = new Map<string, Map<string, boolean>>();
let watchTimer: NodeJS.Timeout | null = null;

/**
 * 比对一次快照，把「运行中 → 非运行中」的容器发通知。
 * 纯函数语义（状态存于模块内）：首次建基线不发；引擎取数失败时**不更新基线**，下轮继续比对。
 */
export function diffContainerStates(
  engineId: string,
  engineName: string,
  list: { Id?: string; Names?: string[]; State?: string; Status?: string }[],
): void {
  const now = new Map<string, boolean>();
  for (const c of list) {
    const id = String(c.Id || "");
    if (id) now.set(id, c.State === "running");
  }
  const prev = lastStates.get(engineId);
  if (prev) {
    for (const [id, running] of now) {
      const wasRunning = prev.get(id);
      // 仅在「运行中 → 非运行中」的转变时通知；首轮建基线（wasRunning === undefined）不发
      if (wasRunning === true && running === false) {
        const c = list.find((x) => String(x.Id) === id);
        const name = (c?.Names?.[0] || id.slice(0, 12)).replace(/^\//, "");
        notify({
          event: "containerDown",
          title: `容器已停止：${name}`,
          summary: `容器 ${name} 在引擎「${engineName}」上不再运行。`,
          lines: [`容器 ID：${id.slice(0, 12)}`, `状态：${c?.Status || c?.State || "未知"}`],
          level: "warning",
          dedupKey: `down:${engineId}:${id}`,
        });
      }
    }
  }
  lastStates.set(engineId, now);
}

/** 清空基线（切引擎 / 测试用） */
export function resetContainerWatch(): void {
  lastStates = new Map();
}

/** 一个引擎的容器取数结果 */
export interface WatchTarget {
  engineId: string;
  engineName: string;
  list: { Id?: string; Names?: string[]; State?: string; Status?: string }[];
}

/**
 * 启动容器状态巡检（启动后延迟 30 秒跑第一轮，之后每 60 秒）。
 *
 * ⚠️ 取数函数由调用方（index.ts）注入而非本模块直接依赖 docker.js ——
 *    因为 docker.js 本身要发「更新完成」通知，直接依赖会形成循环引用。
 */
export function startContainerWatch(fetchTargets: () => Promise<WatchTarget[]>): void {
  if (watchTimer) return;
  const run = async () => {
    let targets: WatchTarget[] = [];
    try {
      targets = await fetchTargets();
    } catch (e: any) {
      log.warn(`容器状态巡检取数失败：${e?.message || e}`);
      return;
    }
    for (const t of targets) {
      try {
        diffContainerStates(t.engineId, t.engineName, t.list);
      } catch (e: any) {
        log.warn(`容器状态比对失败（${t.engineId}）：${e?.message || e}`);
      }
    }
  };
  const first = setTimeout(() => {
    void run();
    watchTimer = setInterval(() => void run(), 60_000);
    if (typeof watchTimer.unref === "function") watchTimer.unref();
  }, 30_000);
  if (typeof first.unref === "function") first.unref();
  log.info("容器状态巡检已启动（每 60 秒，用于「容器停止/异常」通知）");
}
