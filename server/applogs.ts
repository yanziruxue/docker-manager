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
/** 合法日志**归档包**文件名（v1.41.6 每周打包产物；同样参与路径穿越防线） */
const LOG_ARCHIVE_RE = /^logs-(\d{8})-(\d{8})\.zip$/;
/** 尾部读取默认/最大行数 */
const DEFAULT_TAIL_LINES = 500;
const MAX_TAIL_LINES = 5000;
/** 尾部读取最多从文件末尾读多少字节（够 5000 行普通日志绰绰有余） */
const TAIL_READ_BYTES = 2 * 1024 * 1024;
/** 「导出全部」的源文件总量上限：超出则只导出最新的若干份 */
const EXPORT_MAX_BYTES = 128 * 1024 * 1024;
/** 单个日志归档包的**源文件总量上限**：超出则本轮不打包（避免一个包无限膨胀）；0 = 不限 */
const PACK_MAX_SOURCE_BYTES = 512 * 1024 * 1024;
/** 每周打包的默认滚动间隔（天） */
const PACK_DEFAULT_INTERVAL_DAYS = 7;

/**
 * 单包源文件上限（字节）。**可由 `settings.logRetention.packMaxSourceMB` 覆盖**（MB，0 = 不限）。
 * 单测用它把上限调到极小以触发「超限放弃」分支。
 */
function packMaxSourceBytes(): number {
  const rawMB = (getSettings() as any)?.logRetention?.packMaxSourceMB;
  if (Number.isFinite(Number(rawMB)) && Number(rawMB) >= 0) return Number(rawMB) * 1024 * 1024;
  return PACK_MAX_SOURCE_BYTES;
}

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
 *   - `notify` / `oplog` 各有同名字段子段，**三者完全独立、互不继承**（v1.42.7 起）。
 *     任一频道未写字段时**各自 fallback 到 365 天 / 1024 MB 默认**，而非跟随「应用日志」。
 */
export function getRetentionConfig(channel: LogChannel = "app"): LogRetentionConfig {
  let raw: any = null;
  try {
    raw = getSettings()?.logRetention;
  } catch {
    raw = null;
  }
  const src = channel === "app" ? (raw || {}) : ((raw && raw[channel]) || {});
  const enabled = typeof src?.enabled === "boolean" ? src.enabled : true;
  const maxDays = Number.isFinite(Number(src?.maxDays)) ? Number(src.maxDays) : 365;
  const maxTotalMB = Number.isFinite(Number(src?.maxTotalMB)) ? Number(src.maxTotalMB) : 1024;
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
  // 归档包不分频道，一律按顶层（「应用日志」那一档）策略处理
  const topCfg = getRetentionConfig("app");

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
  // ③ 归档包清理（v1.41.6）：压缩包**不归属任何频道**，按「顶层」策略（应用日志那一档）处理，
  //    与用户「压缩包同样受 365 天 / 1G 约束」的期望一致。放在最后：先清散文件再清包。
  if (topCfg.enabled && (topCfg.maxDays > 0 || topCfg.maxTotalMB > 0)) {
    const removedArchives = pruneArchives(topCfg);
    if (removedArchives.removed.length > 0) {
      log.info(`日志归档包已清理 ${removedArchives.removed.length} 个（超期或超容量上限），释放 ${removedArchives.freedBytes} 字节`);
      removed.push(...removedArchives.removed);
      freedBytes += removedArchives.freedBytes;
    }
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

/* ==================== 每周打包（v1.41.6） ==================== */

/** 打包状态（上次打包时间等），落在日志目录旁的独立文件，避免被日志清理误删 */
const PACK_STATE_FILE = path.join(path.dirname(LOG_DIR), "log-pack-status.json");

let lastPackAt = 0;

function loadPackState(): void {
  try {
    if (fs.existsSync(PACK_STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(PACK_STATE_FILE, "utf-8"));
      if (typeof raw.lastPackAt === "number") lastPackAt = raw.lastPackAt;
    }
  } catch {
    /* 损坏则忽略：当作「从未打包」，下轮会打一次 */
  }
}

function persistPackState(): void {
  try {
    fs.writeFileSync(PACK_STATE_FILE, JSON.stringify({ lastPackAt }, null, 2), "utf-8");
  } catch {
    /* 写入失败忽略：最坏后果是多打一次包，不会丢数据 */
  }
}

/** 打包配置（顶层；不参与频道继承 —— 归档包不分频道） */
export interface LogPackConfig {
  enabled: boolean;
  intervalDays: number;
  /** 上次打包时间（毫秒；0 = 从未打包） */
  lastPackAt: number;
  /** 当前总占用（散文件 ＋ 归档包，字节） */
  totalBytes: number;
  /** 归档包数量 */
  archiveCount: number;
  /** 下次可打包时间（ISO；null = 未启用） */
  nextPackAt: string | null;
}

export function getPackConfig(): LogPackConfig {
  const raw = (getSettings() as any)?.logRetention ?? {};
  const enabled = typeof raw.packEnabled === "boolean" ? raw.packEnabled : true;
  const intervalDays =
    Number.isFinite(Number(raw.packIntervalDays)) && Number(raw.packIntervalDays) > 0
      ? Math.floor(Number(raw.packIntervalDays))
      : PACK_DEFAULT_INTERVAL_DAYS;
  const nextPackAt = enabled && lastPackAt > 0 ? new Date(lastPackAt + intervalDays * 86400_000).toISOString() : null;
  return {
    enabled,
    intervalDays,
    lastPackAt,
    totalBytes: logsTotalBytes(),
    archiveCount: listLogArchives().length,
    nextPackAt,
  };
}

/** 列出日志归档包（新 → 旧） */
export function listLogArchives(): { name: string; sizeBytes: number; mtime: string }[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(LOG_DIR).filter((n) => LOG_ARCHIVE_RE.test(n));
  } catch {
    return [];
  }
  const out: { name: string; sizeBytes: number; mtime: string }[] = [];
  for (const name of names) {
    try {
      const st = fs.statSync(path.join(LOG_DIR, name));
      if (st.isFile()) out.push({ name, sizeBytes: st.size, mtime: st.mtime.toISOString() });
    } catch {
      /* 竞态消失，忽略 */
    }
  }
  out.sort((a, b) => b.name.localeCompare(a.name));
  return out;
}

/** 校验归档包文件名并解析绝对路径（与 resolveLogFile 同款穿越防线） */
export function resolveLogArchive(name: string): string | null {
  const base = String(name || "").trim();
  if (!LOG_ARCHIVE_RE.test(base)) return null;
  const abs = path.resolve(LOG_DIR, base);
  const root = path.resolve(LOG_DIR);
  if (abs !== path.join(root, base)) return null;
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** 删除单个日志归档包（白名单校验，拒绝穿越）；返回是否成功 */
export function deleteLogArchive(name: string): { ok: boolean; error?: string } {
  const abs = resolveLogArchive(name);
  if (!abs) return { ok: false, error: "归档包名不合法" };
  if (!fs.existsSync(abs)) return { ok: false, error: "归档包不存在" };
  try {
    fs.unlinkSync(abs);
    log.info(`已删除日志归档包：${name}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "删除归档包失败" };
  }
}

function pruneArchives(cfg: LogRetentionConfig): { removed: string[]; freedBytes: number } {
  const removed: string[] = [];
  let freedBytes = 0;
  const archives = listLogArchives(); // 新 → 旧
  const survivors: typeof archives = [];

  // ① 期限裁剪（按**文件名里的区间起点**判定：包的覆盖范围越老越该清）
  for (const a of archives) {
    const m = a.name.match(LOG_ARCHIVE_RE)!;
    const startMs = Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T00:00:00Z`);
    if (cfg.maxDays > 0 && Number.isFinite(startMs) && Date.now() - startMs > cfg.maxDays * 86400_000) {
      if (tryRemoveArchive(a.name, a.sizeBytes)) removed.push(a.name);
    } else {
      survivors.push(a);
    }
  }

  // ② 容量裁剪（**总量口径 = 散文件 + 归档包**，与用户「压缩包同样受 1G 约束」一致）
  if (cfg.maxTotalMB > 0) {
    const limit = cfg.maxTotalMB * 1024 * 1024;
    let total = survivors.reduce((n, a) => n + a.sizeBytes, 0) + logsTotalBytes();
    for (let i = survivors.length - 1; i >= 0 && total > limit; i--) {
      const a = survivors[i];
      if (tryRemoveArchive(a.name, a.sizeBytes)) {
        total -= a.sizeBytes;
        removed.push(a.name);
      }
    }
  }

  return { removed, freedBytes };
  function tryRemoveArchive(name: string, size: number): boolean {
    const abs = resolveLogArchive(name);
    if (!abs) return false;
    try {
      fs.unlinkSync(abs);
      freedBytes += size;
      return true;
    } catch {
      return false;
    }
  }
}

export interface PackResult {
  /** 本轮是否真的产出了压缩包 */
  packed: boolean;
  /** 压缩包文件名（未打包时为空） */
  archiveName: string;
  /** 已归入压缩包并删除的原始文件 */
  archivedFiles: string[];
  /** 归档前原始文件总大小 */
  sourceBytes: number;
  /** 压缩包大小 */
  archiveBytes: number;
  /** 未打包的原因（供界面提示） */
  reason: string;
}

/**
 * 每周打包：把**已结束的**每日 `.log`（当天文件永不打包，正在写入）归拢成一个 zip 归档，
 * 成功后删除原始文件。
 *
 * 设计要点：
 *  · 归档包名 `logs-<起始YYYYMMDD>-<结束YYYYMMDD>.zip`，由实际被打包文件的日期区间推导；
 *  · 先写临时文件、校验可读，**再**删原始文件 ⇒ 打包失败绝不丢日志（宁可重复也不丢数据）；
 *  · 源文件总量超 `PACK_MAX_SOURCE_BYTES` 则本轮放弃并保留原始文件，避免单包无限膨胀；
 *  · 归档包自身由 `pruneLogs()` 按顶层策略（365 天 / 1G）清理。
 */
export function packLogs(): PackResult {
  const none: PackResult = {
    packed: false,
    archiveName: "",
    archivedFiles: [],
    sourceBytes: 0,
    archiveBytes: 0,
    reason: "",
  };

  const files = listLogFiles().filter((f) => !f.current);
  if (files.length === 0) return { ...none, reason: "没有已结束的日志文件可打包" };

  const sourceBytes = files.reduce((n, f) => n + f.sizeBytes, 0);
  const maxSrc = packMaxSourceBytes();
  if (maxSrc > 0 && sourceBytes > maxSrc) {
    log.warn(`日志打包跳过：源文件合计 ${(sourceBytes / 1024 / 1024).toFixed(1)} MB 超过单包上限，保留原始文件`);
    return { ...none, sourceBytes, reason: "源文件总量超过单包上限，已保留原始文件" };
  }

  // 日期区间：取文件名里的日期部分（比 mtime 更能反映日志归属日期）。
  // ★ LOG_FILE_RE 只有一个捕获组（频道），日期要按位置切，不能用 m[2]。
  const days = files
    .map((f) => {
      const m = f.name.match(LOG_FILE_RE);
      return m ? m[0].slice(m[1].length + 1, -".log".length).replace(/-/g, "") : "";
    })
    .filter(Boolean)
    .sort();
  const from = days[0] || "00000000";
  const to = days[days.length - 1] || "00000000";
  const archiveName = `logs-${from}-${to}.zip`;
  // 实际落盘名（同名包已存在时会加序号），须在 try 外可见 —— 后面要用来读大小
  let finalName = archiveName;
  let n = 1;

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dms-logpack-"));
  const stage = path.join(tmpRoot, "logs");
  const outFile = path.join(tmpRoot, archiveName);
  try {
    fs.mkdirSync(stage, { recursive: true });
    const copied: string[] = [];
    for (const f of files) {
      const abs = resolveLogFile(f.name);
      if (!abs) continue;
      try {
        fs.copyFileSync(abs, path.join(stage, f.name));
        copied.push(f.name);
      } catch (e: any) {
        log.warn(`日志打包时复制失败：${f.name} — ${e?.message || e}`);
      }
    }
    if (copied.length === 0) return { ...none, reason: "没有任何日志文件可复制" };

    // 归档内附一份清单，便于事后对账（不参与源文件名区间推导）
    try {
      fs.writeFileSync(
        path.join(stage, "pack-manifest.txt"),
        [
          `打包时间：${new Date().toISOString()}`,
          `日志目录：${LOG_DIR}`,
          `日期区间：${from} ~ ${to}`,
          `文件数：${copied.length}`,
          `原始大小：${sourceBytes} 字节`,
          `包含：${copied.join(", ")}`,
        ].join("\n"),
        "utf-8",
      );
    } catch {
      /* 清单写不进去不影响打包 */
    }

    zipDirectory(stage, outFile, "logs");

    // ★ 先验证压缩包可读，再删原始文件 —— 打包失败绝不能丢日志
    const st = fs.statSync(outFile);
    if (!st.isFile() || st.size === 0) throw new Error("压缩包为空或不可读");

    // 同名包已存在（异常重入）时另加序号，绝不覆盖既有归档
    while (fs.existsSync(path.join(LOG_DIR, finalName))) {
      finalName = archiveName.replace(/\.zip$/, `-${n++}.zip`);
    }
    fs.renameSync(outFile, path.join(LOG_DIR, finalName));
  } catch (e: any) {
    log.warn(`日志打包失败（原始文件已保留）：${e?.message || e}`);
    return { ...none, sourceBytes, reason: `打包失败：${e?.message || e}` };
  } finally {
    fs.rm(tmpRoot, { recursive: true, force: true }, () => {
      /* 尽力而为清理暂存目录 */
    });
  }

  // 压缩包已落盘 ⇒ 现在才删原始文件（逐个删，失败的仅留文件、不影响整体成功）
  const archived: string[] = [];
  for (const f of files) {
    const abs = resolveLogFile(f.name);
    if (!abs) continue;
    try {
      fs.unlinkSync(abs);
      archived.push(f.name);
    } catch (e: any) {
      log.warn(`日志已入包但原始文件删除失败：${f.name} — ${e?.message || e}`);
    }
  }

  lastPackAt = Date.now();
  persistPackState();

  let archiveBytes = 0;
  try {
    archiveBytes = fs.statSync(resolveLogArchive(finalName)!).size;
  } catch {
    /* ignore */
  }
  log.info(
    `日志每周打包完成：${finalName}（${archived.length} 个文件 / 原始 ${(sourceBytes / 1024 / 1024).toFixed(1)} MB → ${(archiveBytes / 1024 / 1024).toFixed(1)} MB）`
  );
  return { packed: true, archiveName: finalName, archivedFiles: archived, sourceBytes, archiveBytes, reason: "" };
}

/**
 * 按滚动间隔判断是否该打包（`距上次打包 ≥ intervalDays`），该打才打。
 * `lastPackAt` 从未写过时**不打**（首轮不制造空包），改为在此初始化基准时间。
 */
export function packLogsIfDue(): PackResult | null {
  const cfg = getPackConfig();
  if (!cfg.enabled) return null;
  if (cfg.lastPackAt === 0) {
    lastPackAt = Date.now();
    persistPackState();
    return null;
  }
  if (Date.now() - cfg.lastPackAt < cfg.intervalDays * 86400_000) return null;
  return packLogs();
}

/** 立即打包（界面「立即打包」按钮；忽略间隔） */
export function packLogsNow(): PackResult {
  return packLogs();
}

/**
 * 日志目录当前总占用（字节）＝ **散文件 + 归档包**。
 * ★ 容量上限的统计口径必须含压缩包：否则 1G 上限会被压缩包「隐形突破」
 *   （散文件统计不到包 ⇒ 包只增不减 ⇒ 真正可用的散文件空间被悄悄吃掉）。
 */
export function logsTotalBytes(): number {
  const loose = listLogFiles().reduce((n, f) => n + f.sizeBytes, 0);
  const archives = listLogArchives().reduce((n, a) => n + a.sizeBytes, 0);
  return loose + archives;
}

let retentionTimer: NodeJS.Timeout | null = null;

/**
 * 启动日志保留守护：启动后先延迟跑一次（避开启动高峰），之后每 30 分钟一次。
 * 幂等 —— 重复调用不会叠加定时器。
 *
 * v1.41.6：每轮清理后顺带判断「每周打包」是否到期（滚动间隔）。
 */
export function startLogRetention(): void {
  if (retentionTimer) return;
  loadPackState();
  const run = () => {
    try {
      pruneLogs();
    } catch (e: any) {
      log.warn(`日志保留策略执行失败：${e?.message || e}`);
    }
    try {
      packLogsIfDue();
    } catch (e: any) {
      log.warn(`日志每周打包执行失败：${e?.message || e}`);
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
