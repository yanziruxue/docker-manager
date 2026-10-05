/**
 * 应用详情 / 安装位置（系统设置 → 应用详情）
 *
 * 纯只读聚合：把散落在各处的运行态与目录信息收拢成一个响应，
 * 供设置页「应用详情」分区展示（版本、构建渠道、运行用户、各目录路径与占用）。
 *
 * 目录占用采用**带缓存的受限遍历**：备份目录动辄几百 MB 且有成千上万条目，
 * 每次请求都全量 stat 会拖垮主线程，因此
 *   · 结果缓存 30 秒；
 *   · 单目录最多遍历 MAX_ENTRIES 个条目，超出即截断并标记 truncated（前端提示「≥」）。
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CONFIG_DIR, COMPOSE_DIR, DATA_DIR, LOG_DIR } from "./paths.js";
import { CURRENT_VERSION, getInstallDir } from "./updater.js";
import { resolveBackupDir } from "./backup.js";
import { getAllEngines, getActiveEngineId } from "./engines.js";

/** 进程启动时刻（uptime 反推，避免额外维护一个启动时间戳） */
const BOOT_AT_MS = Date.now() - Math.round(process.uptime() * 1000);

/** 单目录遍历条目上限：超过即截断，避免超大目录把事件循环卡住 */
const MAX_ENTRIES = 200_000;
/** 目录占用缓存有效期（毫秒） */
const CACHE_TTL_MS = 30_000;

interface DirMeasure {
  files: number;
  sizeBytes: number;
  truncated: boolean;
}

const measureCache = new Map<string, { at: number; value: DirMeasure }>();

/** 迭代式遍历（不用递归，避免深目录爆栈）；符号链接一律跳过，防环 */
function measureDir(root: string): DirMeasure {
  let files = 0;
  let sizeBytes = 0;
  let truncated = false;
  let seen = 0;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 无权限 / 已消失：跳过该分支
    }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) {
        truncated = true;
        break;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        try {
          sizeBytes += fs.statSync(abs).size;
          files += 1;
        } catch {
          /* 竞态消失，忽略 */
        }
      }
    }
    if (truncated) break;
  }
  return { files, sizeBytes, truncated };
}

function measureCached(root: string): DirMeasure {
  const hit = measureCache.get(root);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = measureDir(root);
  measureCache.set(root, { at: Date.now(), value });
  return value;
}

export interface AppDirInfo {
  key: string;
  label: string;
  /** 该目录的来源说明（哪个环境变量可覆盖等） */
  note: string;
  path: string;
  exists: boolean;
  files: number;
  sizeBytes: number;
  /** 条目超过 MAX_ENTRIES 被截断（占用值仅代表已统计部分） */
  truncated: boolean;
}

export interface AppInfo {
  version: string;
  /** 当前实际运行形态：SEA 单二进制 / 开发模式 */
  channel: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  /** 运行用户（非 root 的 docker-manager-yanzi） */
  user: string;
  pid: number;
  /** 进程启动时间（ISO） */
  startedAt: string;
  /** 已运行秒数 */
  uptimeSeconds: number;
  /** 进程工作目录（生产下即安装目录） */
  cwd: string;
  /** 当前活跃引擎：名称 + 连接方式 */
  engineName: string;
  engineConnection: string;
  engineCount: number;
  dirs: AppDirInfo[];
}

/** 组装应用详情（只读，无副作用） */
export function getAppInfo(): AppInfo {
  const installDir = getInstallDir();
  const specs: Array<{ key: string; label: string; note: string; path: string }> = [
    { key: "install", label: "程序安装目录", note: "二进制所在目录（OTA 替换此处文件）", path: installDir },
    { key: "data", label: "数据目录", note: "环境变量 DATA_DIR 可覆盖", path: DATA_DIR },
    { key: "config", label: "配置目录", note: "环境变量 CONFIG_DIR 可覆盖；含 settings.json / 用户与凭据", path: CONFIG_DIR },
    { key: "logs", label: "日志目录", note: "环境变量 LOG_DIR 可覆盖；app-YYYY-MM-DD.log", path: LOG_DIR },
    { key: "compose", label: "Compose 目录", note: "堆栈项目根目录（<数据目录>/dockercompose）", path: COMPOSE_DIR },
    { key: "backups", label: "备份目录", note: "全量备份与堆栈备份（<数据目录>/backups）", path: resolveBackupDir() },
  ];

  const dirs: AppDirInfo[] = specs.map((s) => {
    let exists = false;
    try {
      exists = fs.existsSync(s.path) && fs.statSync(s.path).isDirectory();
    } catch {
      exists = false;
    }
    const m = exists ? measureCached(s.path) : { files: 0, sizeBytes: 0, truncated: false };
    return { ...s, exists, ...m };
  });

  // 构建渠道：SEA 下 __APP_VERSION__ 被注入；开发模式未注入
  const isSea = typeof __APP_VERSION__ !== "undefined";
  let user = "unknown";
  try {
    user = os.userInfo().username;
  } catch {
    /* 容器内可能无 passwd 条目 */
  }

  let engineName = "—";
  let engineConnection = "—";
  let engineCount = 0;
  try {
    const engines = getAllEngines();
    engineCount = engines.length;
    const activeId = getActiveEngineId();
    const active = engines.find((e) => e.id === activeId) || engines[0];
    if (active) {
      engineName = active.name;
      engineConnection = active.connectionType;
    }
  } catch {
    /* 引擎配置缺失时留占位 */
  }

  return {
    version: CURRENT_VERSION,
    channel: isSea ? `sea-${process.platform}-${process.arch}` : "dev",
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    user,
    pid: process.pid,
    startedAt: new Date(BOOT_AT_MS).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    cwd: process.cwd(),
    engineName,
    engineConnection,
    engineCount,
    dirs,
  };
}
