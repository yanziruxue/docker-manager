/**
 * 目录镜像同步（系统设置 → 目录镜像）
 *
 * 把两个「原始目录」单向镜像到用户指定的**另一个路径**，保持实时一致：
 *   · backups → <数据目录>/backups（全量备份与堆栈备份）
 *   · compose → <数据目录>/dockercompose（堆栈项目）
 *
 * 触发方式（双保险）：
 *   1. `fs.watch(source, { recursive: true })` 变更即触发，**1 秒防抖**（合并成批写入）；
 *   2. 每 60 秒全量对账兜底 —— 覆盖监听不可用（部分内核 / 文件系统不支持递归 watch）、
 *      进程错过事件、源目录被重建等情况。同步本身是**幂等**的，多跑无害。
 *
 * ⚠️ 语义为**真镜像**（按用户选择）：目标严格等于源 —— 源里被删除的文件 / 目录，
 *    会同步从目标删除。因此目标路径做了严格校验，**绝不允许目标是源的上级**（那会在
 *    源被清空时连带删掉源），也不允许目标在源内部（无限递归）。
 *
 * 增量策略：比对「文件大小 + mtime」，只复制变化的文件；复制后用 `utimesSync` 回写 mtime，
 * 否则目标 mtime 永远是复制时刻、下一轮会全量重拷。
 */

import fs from "node:fs";
import path from "node:path";
import { COMPOSE_DIR } from "./paths.js";
import { resolveBackupDir } from "./backup.js";
import { getSettings } from "./settings.js";
import { createLogger } from "./logger.js";

const log = createLogger("Mirror");

/** 监听防抖：源目录一次操作会连发多个事件，合并后再同步 */
const DEBOUNCE_MS = 1000;
/** 兜底全量对账间隔 */
const POLL_MS = 60_000;
/** 单目录遍历条目上限（防超大目录把事件循环卡死） */
const WALK_LIMIT = 500_000;

export type MirrorKey = "backups" | "compose";

const KEYS: MirrorKey[] = ["backups", "compose"];

const LABELS: Record<MirrorKey, string> = {
  backups: "备份目录",
  compose: "Compose 目录",
};

function sourceOf(key: MirrorKey): string {
  return key === "backups" ? resolveBackupDir() : COMPOSE_DIR;
}

export interface MirrorState {
  key: MirrorKey;
  label: string;
  /** 源目录（只读来源，权威） */
  source: string;
  /** 配置里是否开启 */
  enabled: boolean;
  /** 目标目录（空 = 未配置） */
  target: string;
  /** 目标路径是否合法可写 */
  valid: boolean;
  invalidReason: string;
  /** 递归监听是否可用（不可用则仅靠 60 秒轮询） */
  watcherActive: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastDurationMs: number;
  lastError: string | null;
  /** 最近一次同步统计 */
  copied: number;
  deleted: number;
  sourceFiles: number;
  targetFiles: number;
}

const states: Record<MirrorKey, MirrorState> = {
  backups: freshState("backups"),
  compose: freshState("compose"),
};

function freshState(key: MirrorKey): MirrorState {
  return {
    key,
    label: LABELS[key],
    source: "",
    enabled: false,
    target: "",
    valid: true,
    invalidReason: "",
    watcherActive: false,
    syncing: false,
    lastSyncAt: null,
    lastDurationMs: 0,
    lastError: null,
    copied: 0,
    deleted: 0,
    sourceFiles: 0,
    targetFiles: 0,
  };
}

interface Entry {
  dir: boolean;
  size: number;
  mtimeMs: number;
  atimeMs: number;
}

/** 迭代遍历目录 → { 相对路径(POSIX) → 条目 }；目录键以 `/` 结尾；符号链接跳过防环 */
function walk(root: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const stack: Array<[string, string]> = [["", root]];
  let seen = 0;
  while (stack.length > 0) {
    const [rel, abs] = stack.pop() as [string, string];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (++seen > WALK_LIMIT) return out;
      const r = rel ? `${rel}/${e.name}` : e.name;
      const a = path.join(abs, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        out.set(r + "/", { dir: true, size: 0, mtimeMs: 0, atimeMs: 0 });
        stack.push([r, a]);
      } else if (e.isFile()) {
        try {
          const st = fs.statSync(a);
          out.set(r, { dir: false, size: st.size, mtimeMs: st.mtimeMs, atimeMs: st.atimeMs });
        } catch {
          /* 竞态消失 */
        }
      }
    }
  }
  return out;
}

export interface TargetValidation {
  ok: boolean;
  reason: string;
}

/** 目标路径校验：绝对路径 / 不等于源 / 不在源内部 / 不是源的上级 / 可写 */
export function validateTarget(source: string, target: string): TargetValidation {
  const raw = String(target || "").trim();
  if (!raw) return { ok: false, reason: "未填写目标路径" };
  if (!path.isAbsolute(raw)) return { ok: false, reason: "目标路径必须是绝对路径（如 /mnt/user/backup-mirror）" };
  const s = path.resolve(source);
  const t = path.resolve(raw);
  if (s === t) return { ok: false, reason: "目标路径不能与源目录相同" };
  if (t.startsWith(s + path.sep)) return { ok: false, reason: "目标路径不能位于源目录内部（同步会无限递归）" };
  if (s.startsWith(t + path.sep)) return { ok: false, reason: "目标路径不能是源目录的上级（真镜像会连带删除源）" };
  if (t === path.parse(t).root) return { ok: false, reason: "目标路径不能是文件系统根目录" };

  // 可写性探测：建目录 + 写探针文件
  try {
    fs.mkdirSync(t, { recursive: true });
    const probe = path.join(t, ".dms-mirror-probe");
    fs.writeFileSync(probe, String(Date.now()), "utf-8");
    fs.unlinkSync(probe);
  } catch (e: any) {
    return { ok: false, reason: `目标路径不可写：${e?.message || e}` };
  }
  return { ok: true, reason: "" };
}

function readConfig(): Record<MirrorKey, { enabled: boolean; target: string }> {
  let raw: any = null;
  try {
    raw = getSettings()?.mirror;
  } catch {
    raw = null;
  }
  const pick = (k: MirrorKey) => ({
    enabled: !!raw?.[k]?.enabled,
    target: String(raw?.[k]?.target || "").trim(),
  });
  return { backups: pick("backups"), compose: pick("compose") };
}

interface SyncStat {
  copied: number;
  deleted: number;
  sourceFiles: number;
  targetFiles: number;
}

/**
 * 单次同步：补目录 → 增量复制 → 删除目标多余项（真镜像）。
 * 同步执行的（fs 同步 API），调用方保证不并发进入。
 */
function syncOne(key: MirrorKey): SyncStat | null {
  const st = states[key];
  if (!st.enabled || !st.valid || !st.target) return null;
  const source = sourceOf(key);
  const target = st.target;
  const stat: SyncStat = { copied: 0, deleted: 0, sourceFiles: 0, targetFiles: 0 };

  const src = walk(source);
  const dst = walk(target);

  // ① 目录：源有目标没有 → 建；类型冲突（目标是文件）→ 先删文件
  for (const [r, e] of src) {
    if (!e.dir) continue;
    const existing = dst.get(r);
    const absTarget = path.join(target, r);
    if (existing && existing.dir) continue;
    if (existing && !existing.dir) {
      try {
        fs.unlinkSync(path.join(target, r.replace(/\/$/, "")));
      } catch {
        /* ignore */
      }
    } else if (dst.has(r.replace(/\/$/, ""))) {
      // 目标把同名项当成文件
      try {
        fs.unlinkSync(path.join(target, r.replace(/\/$/, "")));
      } catch {
        /* ignore */
      }
    }
    try {
      fs.mkdirSync(absTarget, { recursive: true });
    } catch (e: any) {
      st.lastError = `创建目录失败 ${r}：${e?.message || e}`;
    }
  }

  // ② 文件：新增 / 大小或 mtime 变化 → 复制并回写 mtime
  for (const [r, e] of src) {
    if (e.dir) continue;
    stat.sourceFiles += 1;
    const existing = dst.get(r);
    const same = existing && !existing.dir && existing.size === e.size && Math.abs(existing.mtimeMs - e.mtimeMs) < 1000;
    if (same) continue;
    const absTarget = path.join(target, r);
    try {
      // 目标同名项是目录 → 先整棵删掉再写文件
      if (existing?.dir || dst.has(r + "/")) {
        fs.rmSync(absTarget, { recursive: true, force: true });
      }
      fs.mkdirSync(path.dirname(absTarget), { recursive: true });
      fs.copyFileSync(path.join(source, r), absTarget);
      try {
        fs.utimesSync(absTarget, new Date(e.atimeMs), new Date(e.mtimeMs));
      } catch {
        /* mtime 回写失败只影响下轮增量效率，不报错 */
      }
      stat.copied += 1;
    } catch (e: any) {
      st.lastError = `复制失败 ${r}：${e?.message || e}`;
    }
  }

  // ③ 真镜像：目标多出来的文件 / 目录 → 删除（目录按深度倒序，先文件后目录）
  const extraFiles: string[] = [];
  const extraDirs: string[] = [];
  for (const [r, e] of dst) {
    // 只统计**文件**（与 sourceFiles 口径一致）；目录不计入
    if (!e.dir) stat.targetFiles += 1;
    if (src.has(r)) continue;
    if (e.dir) extraDirs.push(r);
    else extraFiles.push(r);
  }
  for (const r of extraFiles) {
    try {
      fs.unlinkSync(path.join(target, r));
      stat.deleted += 1;
    } catch {
      /* ignore */
    }
  }
  extraDirs.sort((a, b) => b.split("/").length - a.split("/").length);
  for (const r of extraDirs) {
    try {
      fs.rmdirSync(path.join(target, r));
    } catch {
      /* 非空则留待下轮（可能还有待删文件） */
    }
  }
  return stat;
}

const timers = new Map<MirrorKey, NodeJS.Timeout>();
const watchers = new Map<MirrorKey, fs.FSWatcher>();

/** 防抖调度一次同步 */
function schedule(key: MirrorKey, delay = DEBOUNCE_MS): void {
  const old = timers.get(key);
  if (old) clearTimeout(old);
  const t = setTimeout(() => {
    timers.delete(key);
    runSync(key);
  }, delay);
  if (typeof t.unref === "function") t.unref();
  timers.set(key, t);
}

/** 执行一次同步并落状态（含串行保护：同步中再触发则排一次队） */
function runSync(key: MirrorKey, reason = "auto"): void {
  const st = states[key];
  if (!st.enabled || !st.valid || !st.target) return;
  if (st.syncing) {
    schedule(key, DEBOUNCE_MS); // 排队重试，不并发
    return;
  }
  st.syncing = true;
  const t0 = Date.now();
  try {
    const stat = syncOne(key);
    if (stat) {
      st.copied = stat.copied;
      st.deleted = stat.deleted;
      st.sourceFiles = stat.sourceFiles;
      st.targetFiles = stat.targetFiles;
      st.lastSyncAt = new Date().toISOString();
      st.lastError = null;
      if (stat.copied > 0 || stat.deleted > 0) {
        log.info(`[${st.label}] 同步完成（${reason}）：复制 ${stat.copied} 个，删除 ${stat.deleted} 个`);
      }
    }
  } catch (e: any) {
    st.lastError = e?.message || String(e);
    log.warn(`[${st.label}] 同步失败：${st.lastError}`);
  } finally {
    st.lastDurationMs = Date.now() - t0;
    st.syncing = false;
  }
}

function closeWatcher(key: MirrorKey): void {
  const w = watchers.get(key);
  if (w) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
    watchers.delete(key);
  }
  states[key].watcherActive = false;
}

function ensureWatcher(key: MirrorKey): void {
  const st = states[key];
  if (watchers.has(key)) return;
  try {
    const w = fs.watch(st.source, { recursive: true }, () => schedule(key, DEBOUNCE_MS));
    w.on("error", (e: any) => {
      log.warn(`[${st.label}] 目录监听中断，转为 60 秒轮询兜底：${e?.message || e}`);
      closeWatcher(key);
    });
    watchers.set(key, w);
    st.watcherActive = true;
  } catch (e: any) {
    // 部分内核 / 网络文件系统不支持 recursive watch —— 不致命，靠轮询兜底
    st.watcherActive = false;
    log.warn(`[${st.label}] 递归目录监听不可用，仅靠 60 秒轮询：${e?.message || e}`);
  }
}

/** 把最新配置应用到运行态（幂等；配置变更后调用） */
export function applyMirrorSettings(): void {
  const cfg = readConfig();
  for (const key of KEYS) {
    const st = states[key];
    const c = cfg[key];
    st.source = sourceOf(key);

    if (!c.enabled || !c.target) {
      closeWatcher(key);
      st.enabled = false;
      st.target = "";
      st.valid = true;
      st.invalidReason = "";
      continue;
    }

    const v = validateTarget(st.source, c.target);
    st.target = c.target;
    st.valid = v.ok;
    st.invalidReason = v.reason;
    st.enabled = true;

    if (!v.ok) {
      closeWatcher(key);
      st.lastError = v.reason;
      log.warn(`[${st.label}] 目标路径不可用：${v.reason}`);
      continue;
    }
    ensureWatcher(key);
    schedule(key, 300); // 应用配置后立即对账一次
  }
}

/** 立即同步（手动触发；返回同步后的状态） */
export function syncMirrorNow(): MirrorState[] {
  for (const key of KEYS) runSync(key, "manual");
  return getMirrorStatus();
}

/** 运行态快照 */
export function getMirrorStatus(): MirrorState[] {
  return KEYS.map((k) => ({ ...states[k], source: sourceOf(k) }));
}

let pollTimer: NodeJS.Timeout | null = null;

/** 启动镜像引擎：应用配置 + 60 秒兜底对账（幂等） */
export function startMirror(): void {
  applyMirrorSettings();
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    for (const key of KEYS) runSync(key, "poll");
  }, POLL_MS);
  if (typeof pollTimer.unref === "function") pollTimer.unref();
  const active = KEYS.filter((k) => states[k].enabled && states[k].valid);
  if (active.length > 0) {
    log.info(`目录镜像已启动：${active.map((k) => `${LABELS[k]} → ${states[k].target}`).join("；")}`);
  }
}
