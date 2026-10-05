/**
 * 应用日志管理（系统设置 → 应用日志）
 *
 * 只管「日志文件本身」——列表 / 尾部查看 / 导出 / 删除 / 保留策略。
 * 日志内容由 logger.ts 写入 `<logs>/app-YYYY-MM-DD.log`（按天分文件），本模块不改写日志内容。
 *
 * 安全与健壮性要点：
 *   · 文件名**白名单校验**（^app-\d{4}-\d{2}-\d{2}\.log$）+ 解析后必须落在 LOG_DIR 内 ⇒ 杜绝路径穿越；
 *   · 尾部读取只从文件末尾读若干字节 ⇒ 上百 MB 的日志也不会把内存吃满；
 *   · 打包导出走**暂存目录**，只导出日志文件，且对总量设上限（超出只导出最新的、并回报 partial）；
 *   · 保留策略**永不删除当天文件**（正在被写入）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOG_DIR } from "./paths.js";
import { zipDirectory } from "./zip.js";
import { getSettings } from "./settings.js";
import { createLogger, LOG_CHANNELS, logFileName, type LogChannel } from "./logger.js";

const log = createLogger("Logs");

/** 合法日志文件名（同时是路径穿越防线） */
const LOG_FILE_RE = /^(app|notify|oplog)-\d{4}-\d{2}-\d{2}\.log$/;
/** 尾部读取默认/最大行数 */
const DEFAULT_TAIL_LINES = 500;
const MAX_TAIL_LINES = 5000;
/** 尾部读取最多从文件末尾读多少字节（够 5000 行普通日志绰绰有余） */
const TAIL_READ_BYTES = 2 * 1024 * 1024;
/** 「导出全部」的源文件总量上限：超出则只导出最新的若干份 */
const EXPORT_MAX_BYTES = 128 * 1024 * 1024;

export interface LogFileInfo {
  name: string;
  /** 所属频道（应用日志 / 通知日志 / 操作记录） */
  channel: LogChannel;
  sizeBytes: number;
  mtime: string;
  mtimeMs: number;
  /** 是否为「今天」的日志（正在被写入） */
  current: boolean;
}

export interface LogRetentionConfig {
  enabled: boolean;
  /** 保留天数；0 = 不限 */
  maxDays: number;
  /** 日志目录总大小上限（MB）；0 = 不限 */
  maxTotalMB: number;
}

/**
 * 读取**指定频道**的保留策略。
 *
 * 配置结构（`settings.logRetention`）：
 *   - 顶层 `enabled` / `maxDays` / `maxTotalMB` ＝ **应用日志**（沿用旧结构，向后兼容）；
 *   - `notify` / `oplog` 各有同名字段子段；**未写的字段继承顶层** ⇒ 用户只改想改的那一项即可。
 */
export function getRetentionConfig(channel: LogChannel = "app"): LogRetentionConfig {
  let raw: any = null;
  try {
    raw = getSettings()?.logRetention;
  } catch {
    raw = null;
  }
  const src = channel === "app" ? raw : { ...(raw || {}), ...((raw && raw[channel]) || {}) };
  const enabled = typeof src?.enabled === "boolean" ? src.enabled : true;
  const maxDays = Number.isFinite(Number(src?.maxDays)) ? Number(src.maxDays) : 30;
  const maxTotalMB = Number.isFinite(Number(src?.maxTotalMB)) ? Number(src.maxTotalMB) : 500;
  return {
    enabled,
    maxDays: maxDays > 0 ? maxDays : 0,
    maxTotalMB: maxTotalMB > 0 ? maxTotalMB : 0,
  };
}

/** 今日该频道的文件名 */
function todayName(channel: LogChannel = "app"): string {
  return logFileName(channel);
}

/** 从文件名解析频道（白名单已保证可解析） */
function channelOf(name: string): LogChannel {
  const m = name.match(LOG_FILE_RE);
  return (m ? (m[1] as LogChannel) : "app");
}

/**
 * 校验并解析日志文件绝对路径。
 * 只接受白名单文件名，且解析结果必须严格位于 LOG_DIR 下。
 */
export function resolveLogFile(name: string): string | null {
  const base = String(name || "").trim();
  if (!LOG_FILE_RE.test(base)) return null;
  const abs = path.resolve(LOG_DIR, base);
  const root = path.resolve(LOG_DIR);
  if (abs !== path.join(root, base)) return null;
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 列出所有日志文件（三个频道合并；按名称倒序 ≈ 日期从新到旧） */
export function listLogFiles(): LogFileInfo[] {
  let names: string[] = [];
  try {
    names = fs
      .readdirSync(LOG_DIR)
      .filter((n) => LOG_FILE_RE.test(n));
  } catch {
    return [];
  }
  const out: LogFileInfo[] = [];
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(LOG_DIR, name));
      if (!st.isFile()) continue;
      const channel = channelOf(name);
      out.push({
        name,
        channel,
        sizeBytes: st.size,
        mtime: st.mtime.toISOString(),
        mtimeMs: st.mtimeMs,
        current: name === todayName(channel),
      });
    } catch {
      /* 竞态消失，忽略 */
    }
  }
  // 先按频道（app → notify → oplog）再按名称倒序，便于界面分频道展示
  const order: Record<string, number> = { app: 0, notify: 1, oplog: 2 };
  out.sort((a, b) => {
    const d = (order[a.channel] ?? 9) - (order[b.channel] ?? 9);
    if (d !== 0) return d;
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
  });
  return out;
}

export interface LogTailResult {
  name: string;
  sizeBytes: number;
  mtime: string;
  lines: string[];
  /** 只读了文件末尾一段，前面还有内容未包含 */
  headTruncated: boolean;
}

/**
 * 读取日志尾部若干行。
 * 大文件只从末尾读 TAIL_READ_BYTES 字节，再按行切分取后 N 行 —— 内存占用与文件大小无关。
 */
export function readLogTail(name: string, tailLines?: number): LogTailResult | null {
  const abs = resolveLogFile(name);
  if (!abs) return null;
  let st: fs.Stats;
  try {
    st = fs.statSync(abs);
  } catch {
    return null;
  }
  const want = Math.min(
    MAX_TAIL_LINES,
    Math.max(1, Number.isFinite(Number(tailLines)) && Number(tailLines) > 0 ? Math.floor(Number(tailLines)) : DEFAULT_TAIL_LINES),
  );

  const readBytes = Math.min(st.size, TAIL_READ_BYTES);
  const start = Math.max(0, st.size - readBytes);
  const fd = fs.openSync(abs, "r");
  let text = "";
  try {
    const buf = Buffer.alloc(readBytes);
    const read = fs.readSync(fd, buf, 0, readBytes, start);
    text = buf.subarray(0, read).toString("utf-8");
  } finally {
    fs.closeSync(fd);
  }

  // 从中间起读时，第一行大概率是被截断的半行 —— 丢弃
  const readTruncated = start > 0;
  let all = text.split(/\r?\n/);
  if (readTruncated && all.length > 0) all = all.slice(1);
  if (all.length > 0 && all[all.length - 1] === "") all.pop();

  // 「前面还有内容没展示」有两种成因：① 只读了文件末尾一段 ② 行数超过 tail 被截掉
  const linesTruncated = all.length > want;

  return {
    name,
    sizeBytes: st.size,
    mtime: st.mtime.toISOString(),
    lines: linesTruncated ? all.slice(all.length - want) : all,
    headTruncated: readTruncated || linesTruncated,
  };
}

export interface ExportResult {
  outFile: string;
  includedFiles: string[];
  skippedFiles: string[];
  /** 因总量超限只导出了部分文件 */
  partial: boolean;
  bytes: number;
}

/**
 * 打包导出全部日志。
 * 先在临时目录「暂存 → 打包」，保证归档内只有日志文件；调用方负责在响应结束后删除 outFile。
 */
export function exportLogsZip(): ExportResult {
  const files = listLogFiles(); // 新 → 旧
  const included: string[] = [];
  const skipped: string[] = [];
  let budget = EXPORT_MAX_BYTES;
  for (const f of files) {
    if (f.sizeBytes <= budget) {
      included.push(f.name);
      budget -= f.sizeBytes;
    } else {
      skipped.push(f.name);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dms-logs-"));
  const stage = path.join(tmpRoot, "logs");
  fs.mkdirSync(stage, { recursive: true });
  for (const name of included) {
    try {
      fs.copyFileSync(path.join(LOG_DIR, name), path.join(stage, name));
    } catch (e: any) {
      log.warn(`导出时复制日志失败：${name} — ${e?.message || e}`);
    }
  }
  // 附一份清单：说明导出范围与保留策略，便于事后对账
  try {
    fs.writeFileSync(
      path.join(stage, "export-manifest.txt"),
      [
        `导出时间：${new Date().toISOString()}`,
        `日志目录：${LOG_DIR}`,
        `已包含：${included.length} 个文件（${included.join(", ") || "无"}）`,
        skipped.length ? `因总量超过 ${Math.round(EXPORT_MAX_BYTES / 1024 / 1024)} MB 未包含：${skipped.join(", ")}` : "未包含：无",
      ].join("\n"),
      "utf-8",
    );
  } catch {
    /* 清单写不进去不影响导出 */
  }

  const outFile = path.join(tmpRoot, `docker-manager-logs-${stamp}.zip`);
  zipDirectory(stage, outFile, "");
  let bytes = 0;
  try {
    bytes = fs.statSync(outFile).size;
  } catch {
    /* ignore */
  }
  return { outFile, includedFiles: included, skippedFiles: skipped, partial: skipped.length > 0, bytes };
}

/**
 * 导出结束后清理临时目录（整棵删，含暂存文件与 zip）。
 * ★ 必须**异步**删除：本函数挂在 `res.download` 的完成回调上，若用 `rmSync` 递归同步删目录，
 *   会**阻塞事件循环**（实测本机删除垫片走回收站时，一次导出把服务卡住 21 秒，期间所有请求无响应）。
 *   清理属尽力而为，失败无副作用（临时目录由 OS 回收）。
 */
export function cleanupExport(outFile: string): void {
  const dir = path.dirname(outFile);
  if (!dir.includes("dms-logs-")) return;
  fs.rm(dir, { recursive: true, force: true }, () => {
    /* 尽力而为：删不掉也不影响导出结果 */
  });
}

/** 删除单个日志文件（按白名单校验，拒绝穿越） */
export function deleteLogFile(name: string): boolean {
  const abs = resolveLogFile(name);
  if (!abs) return false;
  if (name === todayName()) return false; // 当天文件正在写，禁止删
  try {
    fs.unlinkSync(abs);
    log.info(`已删除日志文件：${name}`);
    return true;
  } catch {
    return false;
  }
}

export interface PruneResult {
  removed: string[];
  freedBytes: number;
  /** 未启用或两条上限都为 0 */
  skipped: boolean;
}

/**
 * 按保留策略清理日志：先按**天数**裁，再按**总量**裁（从最旧开始）。
 * 当天文件永不删除。
 */
export function pruneLogs(): PruneResult {
  const files = listLogFiles(); // 新 → 旧
  const removed: string[] = [];
  let freedBytes = 0;
  let anyEnabled = false;

  for (const channel of LOG_CHANNELS) {
    const cfg = getRetentionConfig(channel);
    if (!cfg.enabled || (cfg.maxDays <= 0 && cfg.maxTotalMB <= 0)) continue;
    anyEnabled = true;

    const mine = files.filter((f) => f.channel === channel);

    // ① 期限裁剪
    const cutoff = cfg.maxDays > 0 ? Date.now() - cfg.maxDays * 24 * 60 * 60 * 1000 : 0;
    const survivors: LogFileInfo[] = [];
    for (const f of mine) {
      if (cfg.maxDays > 0 && !f.current && f.mtimeMs < cutoff) {
        if (tryRemove(f)) removed.push(f.name);
      } else {
        survivors.push(f);
      }
    }

    // ② 容量裁剪（该频道内从最旧开始删，直到落在上限内；当天文件不删）
    if (cfg.maxTotalMB > 0) {
      let total = survivors.reduce((n, f) => n + f.sizeBytes, 0);
      const limit = cfg.maxTotalMB * 1024 * 1024;
      for (let i = survivors.length - 1; i >= 0 && total > limit; i--) {
        const f = survivors[i];
        if (f.current) continue;
        if (tryRemove(f)) {
          total -= f.sizeBytes;
          removed.push(f.name);
        }
      }
    }
  }

  if (removed.length > 0) {
    log.info(`日志保留策略已清理 ${removed.length} 个文件，释放 ${freedBytes} 字节（按频道各自的天数 / 容量上限）`);
  }
  return { removed, freedBytes, skipped: !anyEnabled };

  function tryRemove(f: LogFileInfo): boolean {
    const abs = resolveLogFile(f.name);
    if (!abs) return false;
    try {
      fs.unlinkSync(abs);
      freedBytes += f.sizeBytes;
      return true;
    } catch {
      return false;
    }
  }
}

/** 日志目录当前总占用（字节） */
export function logsTotalBytes(): number {
  return listLogFiles().reduce((n, f) => n + f.sizeBytes, 0);
}

let retentionTimer: NodeJS.Timeout | null = null;

/**
 * 启动日志保留守护：启动后先延迟跑一次（避开启动高峰），之后每 30 分钟一次。
 * 幂等 —— 重复调用不会叠加定时器。
 */
export function startLogRetention(): void {
  if (retentionTimer) return;
  const run = () => {
    try {
      pruneLogs();
    } catch (e: any) {
      log.warn(`日志保留策略执行失败：${e?.message || e}`);
    }
  };
  retentionTimer = setTimeout(() => {
    run();
    retentionTimer = setInterval(run, 30 * 60 * 1000);
    // 不要让定时器拖住进程退出
    if (typeof retentionTimer.unref === "function") retentionTimer.unref();
  }, 10_000);
  if (typeof retentionTimer.unref === "function") retentionTimer.unref();
}
