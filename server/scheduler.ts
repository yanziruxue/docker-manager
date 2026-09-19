import fs from "node:fs";
import { getSettings } from "./settings.js";
import { getAllEngines, getEngine } from "./engines.js";
import { checkAllImageUpdates, startImagePull, type ImageUpdateDetail, type ImageUpdateSummary } from "./docker.js";
import { createLogger } from "./logger.js";
import { dataPath } from "./paths.js";
import { createFullBackup, pruneBackups } from "./backup.js";

const log = createLogger("Scheduler");

export interface SchedulerEngineResult {
  engineId: string;
  name: string;
  checked: number;
  updates: number;
  skipped?: boolean;
  error?: string;
}

export interface SchedulerLastResult {
  checked: number;
  updates: number;
  byEngine: SchedulerEngineResult[];
  at: string; // ISO
}

export interface SchedulerConfigView {
  enabled: boolean;
  mode: "daily" | "weekly" | "monthly";
  hour: number;
  minute: number;
  dayOfWeek: number;
  dayOfMonth: number;
  autoPull: boolean;
}

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  lastCheck: string | null;
  lastResult: SchedulerLastResult | null;
  nextCheck: string | null;
  config: SchedulerConfigView;
}

const STATUS_FILE = dataPath("scheduler-status.json");
const TICK_MS = 60_000; // 每 60 秒评估一次是否到检查时刻

let running = false;
let lastRunAt = 0; // 上次实际执行的时间戳（毫秒）
let status: SchedulerStatus = {
  enabled: false,
  running: false,
  lastCheck: null,
  lastResult: null,
  nextCheck: null,
  config: { enabled: false, mode: "daily", hour: 1, minute: 0, dayOfWeek: 1, dayOfMonth: 1, autoPull: false },
};
let timer: ReturnType<typeof setInterval> | null = null;

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function atTime(d: Date, hour: number, minute: number): Date {
  const x = new Date(d);
  x.setSeconds(0, 0);
  x.setHours(hour, minute, 0, 0);
  return x;
}

/** 根据频率配置计算 base 之后下一次应执行的绝对时间（毫秒） */
function computeNextRun(baseMs: number, cfg: SchedulerConfigView): number {
  const base = new Date(baseMs);
  if (cfg.mode === "daily") {
    let cand = atTime(base, cfg.hour, cfg.minute);
    if (cand.getTime() <= baseMs) cand.setDate(cand.getDate() + 1);
    return cand.getTime();
  }
  if (cfg.mode === "weekly") {
    let cand = atTime(base, cfg.hour, cfg.minute);
    let guard = 0;
    while (cand.getDay() !== cfg.dayOfWeek && guard < 8) {
      cand.setDate(cand.getDate() + 1);
      guard++;
    }
    if (cand.getTime() <= baseMs) cand.setDate(cand.getDate() + 7);
    return cand.getTime();
  }
  // monthly
  let cand = atTime(base, cfg.hour, cfg.minute);
  const clamp = Math.min(cfg.dayOfMonth, daysInMonth(cand.getFullYear(), cand.getMonth()));
  cand.setDate(clamp);
  if (cand.getTime() <= baseMs) {
    cand.setMonth(cand.getMonth() + 1);
    const clamp2 = Math.min(cfg.dayOfMonth, daysInMonth(cand.getFullYear(), cand.getMonth()));
    cand.setDate(clamp2);
  }
  return cand.getTime();
}

function loadPersisted(): void {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8"));
      if (typeof raw.lastCheck === "string") status.lastCheck = raw.lastCheck;
      if (raw.lastResult) status.lastResult = raw.lastResult;
      if (typeof raw.lastRunAt === "number") lastRunAt = raw.lastRunAt;
    }
  } catch {
    /* 损坏则忽略 */
  }
}

function persist(): void {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ lastCheck: status.lastCheck, lastResult: status.lastResult, lastRunAt }, null, 2), "utf-8");
  } catch {
    /* 写入失败忽略 */
  }
}

function readConfig(): SchedulerConfigView {
  const s = getSettings().updateScheduler || {};
  return {
    enabled: !!s.enabled,
    mode: s.mode === "weekly" || s.mode === "monthly" ? s.mode : "daily",
    hour: typeof s.hour === "number" ? Math.max(0, Math.min(23, s.hour | 0)) : 1,
    minute: typeof s.minute === "number" ? Math.max(0, Math.min(59, s.minute | 0)) : 0,
    dayOfWeek: typeof s.dayOfWeek === "number" ? Math.max(0, Math.min(6, s.dayOfWeek | 0)) : 1,
    dayOfMonth: typeof s.dayOfMonth === "number" ? Math.max(1, Math.min(31, s.dayOfMonth | 0)) : 1,
    autoPull: !!s.autoPull,
  };
}

async function runCheck(): Promise<SchedulerLastResult> {
  if (running) {
    // 已有检查在跑，直接返回最近结果（避免重叠）
    return status.lastResult as SchedulerLastResult;
  }
  running = true;
  status.running = true;
  const cfg = readConfig();
  const engines = getAllEngines();
  const byEngine: SchedulerEngineResult[] = [];
  let totalChecked = 0;
  let totalUpdates = 0;

  for (const e of engines) {
    if (e.status !== "connected") {
      byEngine.push({ engineId: e.id, name: e.name, checked: 0, updates: 0, skipped: true });
      continue;
    }
    try {
      const sum = await checkAllImageUpdates(e);
      saveImageCache(e.id, sum);
      if (cfg.autoPull) {
        for (const d of sum.details) {
          if (d.hasUpdate) {
            try {
              startImagePull(e, d.image);
            } catch {
              /* 自动拉取失败不影响统计 */
            }
          }
        }
      }
      byEngine.push({ engineId: e.id, name: e.name, checked: sum.checked, updates: sum.updates });
      totalChecked += sum.checked;
      totalUpdates += sum.updates;
    } catch (err: any) {
      byEngine.push({ engineId: e.id, name: e.name, checked: 0, updates: 0, error: String(err?.message || err) });
    }
  }

  lastRunAt = Date.now();
  const result: SchedulerLastResult = {
    checked: totalChecked,
    updates: totalUpdates,
    byEngine,
    at: new Date(lastRunAt).toISOString(),
  };
  status.lastCheck = result.at;
  status.lastResult = result;
  status.running = false;
  running = false;
  persist();
  log.info(`镜像更新检查完成：检查 ${totalChecked} 个，发现 ${totalUpdates} 个有可用更新`);
  return result;
}

function tick(): void {
  const cfg = readConfig();
  status.enabled = cfg.enabled;
  status.config = cfg;
  status.nextCheck = new Date(computeNextRun(lastRunAt || Date.now(), cfg)).toISOString();
  if (!cfg.enabled) return;
  const now = Date.now();
  const next = computeNextRun(lastRunAt || 0, cfg);
  if (now >= next) {
    runCheck().catch((e) => {
      log.warn(`镜像更新检查异常: ${e?.message || e}`);
      running = false;
      status.running = false;
    });
  }
}

/** 启动更新调度器（server listen 后调用一次） */
export function startUpdateScheduler(): void {
  loadPersisted();
  loadImageCache();
  tick();
  if (timer) clearInterval(timer);
  timer = setInterval(tick, TICK_MS);
  log.info("镜像更新调度器已启动");
}

/** 返回当前调度器状态（含下次检查时间与最近一次结果） */
export function getSchedulerStatus(): SchedulerStatus {
  const cfg = readConfig();
  status.enabled = cfg.enabled;
  status.config = cfg;
  status.nextCheck = new Date(computeNextRun(lastRunAt || Date.now(), cfg)).toISOString();
  return status;
}

/** 立即触发一次检查（前端「立即检查全部」按钮） */
export async function runSchedulerCheckNow(): Promise<SchedulerLastResult> {
  return runCheck();
}

// ============ 镜像更新检查结果缓存 ============
//
// 镜像管理页需要「哪些镜像有更新」，而调度器的 lastResult 只保留计数。
// 这里把 checkAllImageUpdates 的逐镜像明细单独落盘，供：
//   ① 页面进入时读取上次结果（无需重跑 digest 比对）；
//   ② 「检查更新」按钮写入新结果。
// 定时调度与手动检查写入同一份缓存。

export interface ImageUpdateCacheEntry {
  engineId: string;
  checked: number;
  updates: number;
  details: ImageUpdateDetail[];
  at: string; // ISO
}

const IMAGE_CACHE_FILE = dataPath("image-update-cache.json");
let imageUpdateCache: Record<string, ImageUpdateCacheEntry> = {};

function loadImageCache(): void {
  try {
    if (fs.existsSync(IMAGE_CACHE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(IMAGE_CACHE_FILE, "utf-8"));
      if (raw && typeof raw === "object" && !Array.isArray(raw)) imageUpdateCache = raw;
    }
  } catch {
    /* 损坏则忽略 */
  }
}

function persistImageCache(): void {
  try {
    fs.writeFileSync(IMAGE_CACHE_FILE, JSON.stringify(imageUpdateCache, null, 2), "utf-8");
  } catch {
    /* 写入失败忽略 */
  }
}

/** 写入某引擎的检查结果；merge=true（单镜像检查）时与旧明细合并，避免覆盖其它镜像的结果 */
function saveImageCache(engineId: string, sum: ImageUpdateSummary, merge = false): ImageUpdateCacheEntry {
  const prev = imageUpdateCache[engineId];
  let details = sum.details;
  let checked = sum.checked;
  let updates = sum.updates;
  if (merge && prev) {
    const map = new Map(prev.details.map((d) => [d.image, d]));
    for (const d of sum.details) map.set(d.image, d);
    details = [...map.values()];
    checked = details.length;
    updates = details.filter((d) => d.hasUpdate).length;
  }
  const entry: ImageUpdateCacheEntry = { engineId, checked, updates, details, at: new Date().toISOString() };
  imageUpdateCache[engineId] = entry;
  persistImageCache();
  return entry;
}

/** 读取某引擎最近一次镜像更新检查结果（从未检查过则返回 null） */
export function getImageUpdateCache(engineId: string): ImageUpdateCacheEntry | null {
  return imageUpdateCache[engineId] || null;
}

/**
 * 立即检查某引擎镜像的版本更新（镜像管理页「检查更新」/「检查全部更新」）。
 * `onlyRef` 传入 repo:tag 时只检查该镜像，并把结果合并进缓存。
 */
export async function checkEngineImages(engineId: string, onlyRef?: string): Promise<ImageUpdateCacheEntry> {
  const engine = getEngine(engineId);
  if (!engine) throw new Error("引擎不存在");
  if (engine.status !== "connected") throw new Error(`引擎「${engine.name}」未连接，无法检查更新`);
  const sum = await checkAllImageUpdates(engine, onlyRef);
  if (onlyRef && sum.checked === 0) throw new Error(`镜像「${onlyRef}」不可检查（本地构建镜像或标签不匹配）`);
  const entry = saveImageCache(engineId, sum, !!onlyRef);
  log.info(
    `镜像更新检查完成（${engine.name}${onlyRef ? ` · ${onlyRef}` : ""}）：检查 ${sum.checked} 个，发现 ${sum.updates} 个有可用更新`
  );
  return entry;
}

// ============ 自动备份调度器 ============
//
// 读取 settings.backup（mode 1：weekly/monthly/yearly 三档；mode 2：simpleFrequency 五段 cron），
// 到期后创建全量备份（server/backup.ts），并按各档 retention 清理同前缀历史包。
// 备份包命名：auto-<key>_<timestamp>.zip（key ∈ weekly/monthly/yearly/simple）。

export interface BackupScheduleView {
  key: string;
  label: string;
  retention: number;
  nextRun: string | null;
}

export interface BackupSchedulerStatus {
  enabled: boolean;
  mode: number;
  running: boolean;
  lastRun: string | null;
  nextRun: string | null;
  schedules: BackupScheduleView[];
}

const BACKUP_STATUS_FILE = dataPath("backup-scheduler-status.json");

const DOW: Record<string, number> = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };

let backupRunning = false;
let lastBackupRunAt = 0;
let backupTimer: ReturnType<typeof setInterval> | null = null;
let backupStatus: BackupSchedulerStatus = {
  enabled: false,
  mode: 1,
  running: false,
  lastRun: null,
  nextRun: null,
  schedules: [],
};

function parseHM(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(t || "").trim());
  if (!m) return { h: 23, m: 0 };
  return { h: Math.min(23, Math.max(0, parseInt(m[1], 10))), m: Math.min(59, Math.max(0, parseInt(m[2], 10))) };
}

/** 下一次“每周 day 的 h:m” */
function nextWeekly(nowMs: number, day: string, time: string): number {
  const { h, m } = parseHM(time);
  const target = DOW[day] ?? 6;
  const d = new Date(nowMs);
  d.setHours(h, m, 0, 0);
  let guard = 0;
  while (d.getDay() !== target && guard < 8) {
    d.setDate(d.getDate() + 1);
    guard++;
  }
  if (d.getTime() <= nowMs) d.setDate(d.getDate() + 7);
  return d.getTime();
}

/** 下一次“每月 dayOfMonth 的 h:m”（dayOfMonth<=0 表示每月最后一天） */
function nextMonthly(nowMs: number, dayOfMonth: number, time: string): number {
  const { h, m } = parseHM(time);
  const base = new Date(nowMs);
  let y = base.getFullYear();
  let mo = base.getMonth();
  for (let i = 0; i < 14; i++) {
    const dim = new Date(y, mo + 1, 0).getDate();
    const dom = dayOfMonth <= 0 ? dim : Math.min(dayOfMonth, dim);
    const cand = new Date(y, mo, dom, h, m, 0, 0);
    if (cand.getTime() > nowMs) return cand.getTime();
    mo++;
    if (mo > 11) {
      mo = 0;
      y++;
    }
  }
  return Infinity;
}

/** 下一次“每年 MM-DD 的 h:m” */
function nextYearly(nowMs: number, date: string, time: string): number {
  const { h, m } = parseHM(time);
  const mm = /^(\d{1,2})-(\d{1,2})$/.exec(String(date || "").trim());
  const month = mm ? Math.min(12, Math.max(1, parseInt(mm[1], 10))) - 1 : 11;
  const day = mm ? Math.min(31, Math.max(1, parseInt(mm[2], 10))) : 31;
  const base = new Date(nowMs);
  for (let i = 0; i < 3; i++) {
    const y = base.getFullYear() + i;
    const dim = new Date(y, month + 1, 0).getDate();
    const cand = new Date(y, month, Math.min(day, dim), h, m, 0, 0);
    if (cand.getTime() > nowMs) return cand.getTime();
  }
  return Infinity;
}

/** 解析单段 cron 字段：支持通配、单值、列表（a,b）、区间（a-b）、步长写法（斜杠 N） */
function parseCronField(field: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of String(field ?? "").split(",")) {
    const p = part.trim();
    if (!p) continue;
    let step = 1;
    let range = p;
    const slash = p.split("/");
    if (slash.length === 2) {
      range = slash[0];
      step = Math.max(1, parseInt(slash[1], 10) || 1);
    }
    let start = min;
    let end = max;
    if (range !== "*") {
      const dash = range.split("-");
      if (dash.length === 2) {
        start = parseInt(dash[0], 10);
        end = parseInt(dash[1], 10);
      } else {
        const v = parseInt(range, 10);
        if (Number.isNaN(v)) continue;
        start = end = v;
      }
    }
    if (Number.isNaN(start) || Number.isNaN(end)) continue;
    start = Math.max(min, start);
    end = Math.min(max, end);
    for (let v = start; v <= end; v += step) out.add(v);
  }
  if (out.size === 0) for (let v = min; v <= max; v++) out.add(v);
  return out;
}

/** 下一次满足五段 cron 的时间（分钟级扫描，最多往前找 400 天） */
function nextCron(nowMs: number, expr: string): number {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return Infinity;
  const mins = parseCronField(parts[0], 0, 59);
  const hrs = parseCronField(parts[1], 0, 23);
  const doms = parseCronField(parts[2], 1, 31);
  const mons = parseCronField(parts[3], 1, 12);
  const dows = parseCronField(parts[4], 0, 6);
  const d = new Date(nowMs);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  const cap = nowMs + 400 * 864e5;
  while (d.getTime() <= cap) {
    if (mins.has(d.getMinutes()) && hrs.has(d.getHours()) && mons.has(d.getMonth() + 1) && dows.has(d.getDay()) && doms.has(d.getDate())) {
      return d.getTime();
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return Infinity;
}

interface BackupConfigView {
  enabled: boolean;
  mode: number;
  simpleFrequency: string;
  simpleRetentionCount: number;
  weekly: { enabled: boolean; day: string; time: string; retention: number };
  monthly: { enabled: boolean; dayOfMonth: number; time: string; retention: number };
  yearly: { enabled: boolean; date: string; time: string };
}

function readBackupConfig(): BackupConfigView {
  const b = getSettings()?.backup || {};
  const clampRetention = (v: any, dft: number) => Math.max(1, Math.min(60, parseInt(v, 10) || dft));
  return {
    enabled: !!b.autoBackupEnabled,
    mode: b.mode === 2 ? 2 : 1,
    simpleFrequency: String(b.simpleFrequency || "0 3 * * 0"),
    simpleRetentionCount: clampRetention(b.simpleRetentionCount, 5),
    weekly: {
      enabled: !!b.weekly?.enabled,
      day: b.weekly?.day || "Saturday",
      time: b.weekly?.time || "23:00",
      retention: clampRetention(b.weekly?.retention, 6),
    },
    monthly: {
      enabled: !!b.monthly?.enabled,
      dayOfMonth: parseInt(b.monthly?.dayOfMonth, 10) || 0,
      time: b.monthly?.time || "23:00",
      retention: clampRetention(b.monthly?.retention, 8),
    },
    yearly: {
      enabled: !!b.yearly?.enabled,
      date: b.yearly?.date || "12-31",
      time: b.yearly?.time || "23:00",
    },
  };
}

function computeBackupSchedules(nowMs: number): Array<{ key: string; label: string; retention: number; nextAt: number }> {
  const c = readBackupConfig();
  const list: Array<{ key: string; label: string; retention: number; nextAt: number }> = [];
  if (c.mode === 2) {
    list.push({ key: "simple", label: `Cron: ${c.simpleFrequency}`, retention: c.simpleRetentionCount, nextAt: nextCron(nowMs, c.simpleFrequency) });
  } else {
    if (c.weekly.enabled) {
      list.push({ key: "weekly", label: `每周 ${c.weekly.day} ${c.weekly.time}`, retention: c.weekly.retention, nextAt: nextWeekly(nowMs, c.weekly.day, c.weekly.time) });
    }
    if (c.monthly.enabled) {
      list.push({
        key: "monthly",
        label: `每月 ${c.monthly.dayOfMonth <= 0 ? "最后一天" : c.monthly.dayOfMonth + " 日"} ${c.monthly.time}`,
        retention: c.monthly.retention,
        nextAt: nextMonthly(nowMs, c.monthly.dayOfMonth, c.monthly.time),
      });
    }
    if (c.yearly.enabled) {
      list.push({ key: "yearly", label: `每年 ${c.yearly.date} ${c.yearly.time}`, retention: 12, nextAt: nextYearly(nowMs, c.yearly.date, c.yearly.time) });
    }
  }
  return list;
}

function loadBackupStatus(): void {
  try {
    if (fs.existsSync(BACKUP_STATUS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(BACKUP_STATUS_FILE, "utf-8"));
      if (typeof raw.lastRunAt === "number") lastBackupRunAt = raw.lastRunAt;
      if (typeof raw.lastRun === "string") backupStatus.lastRun = raw.lastRun;
    }
  } catch {
    /* 损坏则忽略 */
  }
}

function persistBackupStatus(): void {
  try {
    fs.writeFileSync(BACKUP_STATUS_FILE, JSON.stringify({ lastRunAt: lastBackupRunAt, lastRun: backupStatus.lastRun }, null, 2), "utf-8");
  } catch {
    /* 写入失败忽略 */
  }
}

/** 刷新对外暴露的调度视图（不触发备份） */
function refreshBackupView(): void {
  const c = readBackupConfig();
  const schedules = computeBackupSchedules(lastBackupRunAt || Date.now());
  backupStatus.enabled = c.enabled;
  backupStatus.mode = c.mode;
  const earliest = schedules.reduce((min, s) => Math.min(min, Number.isFinite(s.nextAt) ? s.nextAt : Infinity), Infinity);
  backupStatus.nextRun = Number.isFinite(earliest) ? new Date(earliest).toISOString() : null;
  backupStatus.schedules = schedules.map((s) => ({
    key: s.key,
    label: s.label,
    retention: s.retention,
    nextRun: Number.isFinite(s.nextAt) ? new Date(s.nextAt).toISOString() : null,
  }));
}

async function runBackup(key: string, retention: number): Promise<void> {
  if (backupRunning) return;
  backupRunning = true;
  backupStatus.running = true;
  try {
    const r = createFullBackup("auto", key);
    const removed = pruneBackups(`auto-${key}_`, retention);
    lastBackupRunAt = Date.now();
    backupStatus.lastRun = new Date(lastBackupRunAt).toISOString();
    persistBackupStatus();
    log.info(`自动备份完成（${key}）：${r.name}${removed ? `，清理旧包 ${removed} 个` : ""}`);
  } catch (e: any) {
    log.warn(`自动备份失败（${key}）：${e?.message || e}`);
  } finally {
    backupRunning = false;
    backupStatus.running = false;
  }
}

function tickBackup(): void {
  refreshBackupView();
  const c = readBackupConfig();
  if (!c.enabled || backupRunning) return;
  const now = Date.now();
  const schedules = computeBackupSchedules(lastBackupRunAt || now);
  const due = schedules.filter((s) => Number.isFinite(s.nextAt) && now >= s.nextAt).sort((a, b) => a.nextAt - b.nextAt);
  if (due.length === 0) return;
  void runBackup(due[0].key, due[0].retention);
}

/** 启动自动备份调度器（server listen 后调用一次） */
export function startBackupScheduler(): void {
  loadBackupStatus();
  tickBackup();
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(tickBackup, TICK_MS);
  log.info("自动备份调度器已启动");
}

/** 自动备份调度器状态 */
export function getBackupSchedulerStatus(): BackupSchedulerStatus {
  refreshBackupView();
  return { ...backupStatus, schedules: [...backupStatus.schedules] };
}
