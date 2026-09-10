import fs from "node:fs";
import { getSettings } from "./settings.js";
import { getAllEngines } from "./engines.js";
import { checkAllImageUpdates, startImagePull } from "./docker.js";
import { createLogger } from "./logger.js";
import { dataPath } from "./paths.js";

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
