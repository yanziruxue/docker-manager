/**
 * 操作日志系统
 *
 * 双通道输出：
 *   1. stdout/stderr —— systemd 服务模式下可通过 journalctl 查看
 *   2. 日志文件     —— <安装目录>/logs/app-YYYY-MM-DD.log（按天分文件）
 *
 * 日志级别可通过系统设置调整（debug/info/warn/error）。
 */

import { appendFile } from "node:fs";
import { logPath } from "./paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

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

/** 追加写入 <logs>/app-YYYY-MM-DD.log（异步，失败时静默降级到 stdout） */
function writeToLogFile(line: string): void {
  try {
    const date = new Date().toISOString().slice(0, 10);
    const file = logPath(`app-${date}.log`);
    appendFile(file, line + "\n", (err) => {
      if (err) console.error("[logger] 写入日志文件失败:", err.message);
    });
  } catch {
    // 目录不可写等场景：仅输出到 stdout，不阻塞业务
  }
}

function logAt(level: LogLevel, tag: string, msg: string, extra?: unknown): void {
  if (!shouldLog(level)) return;
  const line = formatMessage(level, tag, msg);
  writeToLogFile(line);
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
 *   const log = createLogger("API");
 *   log.info("容器启动", { id: "abc", action: "start" });
 *   log.error("拉取镜像失败", err);
 */
export function createLogger(tag: string) {
  return {
    debug: (msg: string, extra?: unknown) => logAt("debug", tag, msg, extra),
    info: (msg: string, extra?: unknown) => logAt("info", tag, msg, extra),
    warn: (msg: string, extra?: unknown) => logAt("warn", tag, msg, extra),
    error: (msg: string, extra?: unknown) => logAt("error", tag, msg, extra),
  };
}

// 全局 logger，供不方便创建实例的地方使用
export const log = {
  debug: (tag: string, msg: string, extra?: unknown) => logAt("debug", tag, msg, extra),
  info: (tag: string, msg: string, extra?: unknown) => logAt("info", tag, msg, extra),
  warn: (tag: string, msg: string, extra?: unknown) => logAt("warn", tag, msg, extra),
  error: (tag: string, msg: string, extra?: unknown) => logAt("error", tag, msg, extra),
};
