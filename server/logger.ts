/**
 * 日志系统
 *
 * 双通道输出：
 *   1. stdout/stderr —— systemd 服务模式下可通过 journalctl 查看
 *   2. 日志文件     —— <安装目录>/logs/<频道>-YYYY-MM-DD.log（按天 + 按频道分文件）
 *
 * ★ v1.38.0 起分**频道**（`LogChannel`），每个频道独立文件、独立保留策略：
 *   - `app`    应用日志（默认频道，等价于旧行为）
 *   - `notify` 通知日志（Webhook / 邮件 的每次发送与失败）
 *   - `oplog`  操作记录（用户触发的写操作，如容器启停 / 镜像拉取）
 *
 * 日志级别可通过系统设置调整（debug/info/warn/error）。
 */

import { appendFile } from "node:fs";
import { logPath } from "./paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * 日志频道 —— 各自独立文件 `<channel>-YYYY-MM-DD.log`。
 * ⚠️ 命名必须与 `server/applogs.ts` 的 `LOG_FILE_RE` 白名单一致，改这里要同步改那边（门禁有断言）。
 */
export type LogChannel = "app" | "notify" | "oplog";

/** 全部频道（顺序即界面展示顺序） */
export const LOG_CHANNELS: readonly LogChannel[] = ["app", "notify", "oplog"];

/** 频道中文名（界面与导出用） */
export const CHANNEL_LABELS: Record<LogChannel, string> = {
  app: "应用日志",
  notify: "通知日志",
  oplog: "操作记录",
};

/** 该频道某天的文件名 */
export function logFileName(channel: LogChannel, date = new Date().toISOString().slice(0, 10)): string {
  return `${channel}-${date}.log`;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: " INFO",
  warn: " WARN",
  error: "ERROR",
};

// 当前日志级别（运行时可动态调整）
let currentLevel: LogLevel = "info";

/** 从设置中加载日志级别 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** 获取当前日志级别 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatMessage(level: LogLevel, tag: string, msg: string): string {
  return `[${timestamp()}] [${LEVEL_LABEL[level]}] [${tag}] ${msg}`;
}

/** 追加写入 <logs>/<频道>-YYYY-MM-DD.log（异步，失败时静默降级到 stdout） */
function writeToLogFile(channel: LogChannel, line: string): void {
  try {
    const file = logPath(logFileName(channel));
    appendFile(file, line + "\n", (err) => {
      if (err) console.error("[logger] 写入日志文件失败:", err.message);
    });
  } catch {
    // 目录不可写等场景：仅输出到 stdout，不阻塞业务
  }
}

function logAt(level: LogLevel, tag: string, msg: string, extra?: unknown, channel: LogChannel = "app"): void {
  if (!shouldLog(level)) return;
  const line = formatMessage(level, tag, msg);
  writeToLogFile(channel, line);
  if (level === "error") {
    if (extra !== undefined) {
      console.error(line, extra);
    } else {
      console.error(line);
    }
  } else if (level === "warn") {
    if (extra !== undefined) {
      console.warn(line, extra);
    } else {
      console.warn(line);
    }
  } else {
    if (extra !== undefined) {
      console.log(line, extra);
    } else {
      console.log(line);
    }
  }
}

/**
 * 创建带标签的 logger 实例
 *
 * 用法：
 *   const log = createLogger("API");              // 默认写入 app 频道
 *   const log = createLogger("Notify", "notify"); // 写入通知日志
 *   const log = createLogger("API", "oplog");     // 写入操作记录
 *   log.info("容器启动", { id: "abc", action: "start" });
 */
export function createLogger(tag: string, channel: LogChannel = "app") {
  return {
    debug: (msg: string, extra?: unknown) => logAt("debug", tag, msg, extra, channel),
    info: (msg: string, extra?: unknown) => logAt("info", tag, msg, extra, channel),
    warn: (msg: string, extra?: unknown) => logAt("warn", tag, msg, extra, channel),
    error: (msg: string, extra?: unknown) => logAt("error", tag, msg, extra, channel),
  };
}

// 全局 logger，供不方便创建实例的地方使用
export const log = {
  debug: (tag: string, msg: string, extra?: unknown) => logAt("debug", tag, msg, extra),
  info: (tag: string, msg: string, extra?: unknown) => logAt("info", tag, msg, extra),
  warn: (tag: string, msg: string, extra?: unknown) => logAt("warn", tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => logAt("error", tag, msg, extra),
};
