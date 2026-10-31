/**
 * 持久化通知存储（事件日志）
 *
 * ⚠️ 旧实现（`docker.ts:getActivityLogs`）是「基于 Docker 实时状态派生的快照」：
 *   容器被重建/删除、事件超过 30 天、或累计超过 100 条，条目立即消失 ——
 *   这正是用户反馈「昨天 40 条今天变 17 条」与「满 100 后看不清以前通知」的共同根因。
 *
 * 本模块改为**真·事件日志**：每次发生有意义事件（容器停止、检测到更新、更新完成、镜像检查汇总）
 * 由 `notify.ts`/`scheduler.ts`/`docker.ts` 埋点调用 `recordNotification()`，**追加写入磁盘**
 * （`data/notifications.jsonl`，JSONL 一行一条）并同步进内存缓存。前端按需**分页**读取，
 * 历史不再丢失，也不再受 100 条硬截断限制。
 *
 * 设计要点：
 *  - 落盘 = JSONL 追加写（O(1) 写入，不重写整文件）；
 *  - 内存缓存 = `engineId -> 按时间倒序的数组`，读取零延迟、分页 O(1)；
 *  - 每引擎上限 `PER_ENGINE_CAP`（默认 2000），超限时裁剪并压缩文件，避免无限增长；
 *  - 写入串行化（promise 链互斥），避免并发追加交错 / 裁剪竞态；
 *  - 永不抛错：任何存储异常只写日志，绝不影响容器/镜像主流程。
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { dataPath } from "./paths.js";

export type NotificationType = "info" | "success" | "warning" | "error";

export interface NotificationRecord {
  id: string;
  engineId: string;
  /** 展示用时间戳：YYYY-MM-DD HH:MM:SS（本地） */
  timestamp: string;
  type: NotificationType;
  message: string;
}

export interface RecordNotificationInput {
  engineId: string;
  level: NotificationType;
  title: string;
  summary: string;
  lines?: string[];
}

export interface GetNotificationsResult {
  data: NotificationRecord[];
  total: number;
  hasMore: boolean;
}

const FILE = dataPath("notifications.jsonl");
/** 每引擎最多保留条数（远超旧 100 上限，滚动查看历史无忧） */
const PER_ENGINE_CAP = 2000;

/** 内存缓存：engineId -> 按 timestamp 倒序（最新在前） */
const cache = new Map<string, NotificationRecord[]>();
let loaded = false;

/** 串行化所有文件写操作，避免并发追加 / 裁剪竞态 */
let writeChain: Promise<void> = Promise.resolve();
function serialize(task: () => void): Promise<void> {
  const run = writeChain.then(task, task);
  // 吞掉异常，保证链不断
  writeChain = run.then(
    () => {},
    () => {},
  );
  return run;
}

function nowTs(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

function composeMessage(input: RecordNotificationInput): string {
  const parts: string[] = [input.title];
  if (input.summary) parts.push(input.summary);
  if (input.lines && input.lines.length) parts.push(input.lines.join("；"));
  return parts.join(" — ");
}

/** 首次访问时从磁盘加载到内存（幂等；失败不抛错） */
function ensureLoadedSync(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(FILE)) {
      const text = fs.readFileSync(FILE, "utf-8");
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const rec = JSON.parse(t) as NotificationRecord;
          if (!rec || !rec.id || !rec.engineId) continue;
          const arr = cache.get(rec.engineId) || [];
          arr.push(rec);
          cache.set(rec.engineId, arr);
        } catch {
          // 损坏行跳过，不阻断其余
        }
      }
      // 每引擎按时间倒序 + 裁剪到上限
      for (const [eid, arr] of cache) {
        arr.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        if (arr.length > PER_ENGINE_CAP) cache.set(eid, arr.slice(0, PER_ENGINE_CAP));
      }
    }
  } catch (e) {
    console.warn("[notifications] 加载失败：", e);
  }
}

/** 把内存缓存全部写回文件（裁减后保持文件与缓存一致） */
function compactSync(): void {
  const all: NotificationRecord[] = [];
  for (const arr of cache.values()) all.push(...arr);
  all.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const body = all.map((r) => JSON.stringify(r)).join("\n") + (all.length ? "\n" : "");
  fs.writeFileSync(FILE, body, "utf-8");
}

/**
 * 记录一条通知（追加写 + 内存缓存）。
 * 若未提供 engineId 则跳过（测试通知等无引擎上下文的不入日志）。
 * 永不抛错。
 */
export function recordNotification(input: RecordNotificationInput): void {
  if (!input.engineId) return;
  ensureLoadedSync();
  const record: NotificationRecord = {
    id: crypto.randomUUID(),
    engineId: input.engineId,
    timestamp: nowTs(),
    type: input.level,
    message: composeMessage(input),
  };
  const arr = cache.get(input.engineId) || [];
  arr.unshift(record); // 最新在前
  cache.set(input.engineId, arr);

  void serialize(() => {
    try {
      fs.appendFileSync(FILE, JSON.stringify(record) + "\n", "utf-8");
      if (arr.length > PER_ENGINE_CAP) {
        // 超限：裁剪并压缩整个文件（多线程串行化，安全）
        const trimmed = arr.slice(0, PER_ENGINE_CAP);
        cache.set(input.engineId, trimmed);
        compactSync();
      }
    } catch (e) {
      console.warn("[notifications] 写入失败：", e);
    }
  });
}

/**
 * 分页读取某引擎的通知。
 * @param limit 单页条数（默认 50）
 * @param offset 偏移（默认 0）
 */
export function getNotifications(
  engineId: string,
  opts: { limit?: number; offset?: number } = {},
): GetNotificationsResult {
  ensureLoadedSync();
  const arr = cache.get(engineId) || [];
  const total = arr.length;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const data = arr.slice(offset, offset + limit);
  const hasMore = offset + data.length < total;
  return { data, total, hasMore };
}
