import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DATA_DIR, CONFIG_DIR, COMPOSE_DIR, dataPath } from "./paths.js";
import { getSettings } from "./settings.js";
import { createLogger } from "./logger.js";

/**
 * 备份 / 恢复 / 导出 的统一实现。
 *
 * 备份包结构（tar.gz，统一根，便于整体打包与解包）：
 *   dockercompose/        —— 全部 Compose 堆栈目录
 *   config/settings.json  —— 应用设置
 *   data/engines.json     —— 引擎列表
 *   data/active_engine.json —— 当前活跃引擎
 *   manifest.json         —— 元信息（createdAt / kind / 堆栈数）
 *
 * 备份目录解析：`settings.backup.backupPath` 为**绝对路径**时使用它，
 * 否则默认 `<data>/backups`（与旧行为一致，避免相对名写出意外位置）。
 */

const log = createLogger("Backup");

export interface BackupFileInfo {
  name: string;
  size: number;
  mtime: string;
}

export type BackupKind = "manual" | "auto";

/** 解析备份目录（绝对路径配置优先），并确保目录存在 */
export function resolveBackupDir(): string {
  let custom = "";
  try {
    custom = String(getSettings()?.backup?.backupPath ?? "").trim();
  } catch {
    /* 设置读取失败则用默认目录 */
  }
  const dir = custom && path.isAbsolute(custom) ? custom : path.join(DATA_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 时间戳（文件名安全） */
function tsCompact(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

/** 校验文件名并解析为备份目录内的绝对路径（防路径穿越） */
function resolveInBackupDir(dir: string, name: string): string {
  const base = path.resolve(dir);
  const target = path.resolve(dir, name);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("非法的备份文件名");
  }
  return target;
}

/**
 * 执行 tar（shell:false，避免空格路径被 shell 拆分、避免绝对路径被 shell 转义破坏）。
 * 归档文件一律用「相对名 + cwd=归档所在目录」传递：GNU tar 会把 `-f` 中的
 * `C:\...` 冒号误判为远程主机（Windows 下报 "Cannot connect to C:"），
 * 相对名可规避该歧义；Linux 生产环境同样适用。
 *
 * 全项目唯二的 tar 调用点（backup.ts 全量备份 / docker.ts 堆栈级备份）共用本函数，
 * 保证跨平台行为一致。
 */
export function runTar(args: string[], what: string, cwd?: string): void {
  // Windows 下 tar（Git/mingw 的 GNU tar）会把 `C:\a\b` 这类含反斜杠的绝对路径
  // 重复转义成 `C\:\\a\\b` 而报 “Cannot open: No such file or directory”，
  // 转成正斜杠即可（Linux 路径不含反斜杠，此转换是 no-op）。
  // 注意：归档文件始终用相对名传递，因此不会把 `-f C:/...` 交给 tar 触发冒号歧义。
  const safeArgs = args.map((a) => (/^[A-Za-z]:\\/.test(a) ? a.replace(/\\/g, "/") : a));
  const r = spawnSync("tar", safeArgs, { encoding: "utf-8", cwd });
  if (r.error || r.status !== 0) {
    const detail = r.error?.message || (r.stderr || "").trim() || `退出码 ${r.status}`;
    throw new Error(`${what}失败：${detail}`);
  }
}

function copyIfExists(src: string, dest: string): boolean {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

/** 收集待备份内容到暂存目录（单一根，供 tar 打包/解包） */
function stageConfig(staging: string): { stacks: number; files: string[] } {
  const files: string[] = [];

  // 1) Compose 堆栈目录
  const composeDest = path.join(staging, "dockercompose");
  let stacks = 0;
  if (fs.existsSync(COMPOSE_DIR)) {
    fs.cpSync(COMPOSE_DIR, composeDest, { recursive: true });
    stacks = fs.readdirSync(COMPOSE_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
  } else {
    fs.mkdirSync(composeDest, { recursive: true });
  }

  // 2) 应用设置
  if (copyIfExists(path.join(CONFIG_DIR, "settings.json"), path.join(staging, "config", "settings.json"))) {
    files.push("settings.json");
  }
  // 3) 引擎与活跃引擎
  if (copyIfExists(dataPath("engines.json"), path.join(staging, "data", "engines.json"))) {
    files.push("engines.json");
  }
  if (copyIfExists(dataPath("active_engine.json"), path.join(staging, "data", "active_engine.json"))) {
    files.push("active_engine.json");
  }

  return { stacks, files };
}

/**
 * 创建全量备份包。
 * @param kind manual=手动（文件名 all_*）/ auto=自动（文件名 auto-<tag>_*）
 * @param tag  自动备份的调度类型（weekly / monthly / yearly / simple），用于分组保留
 */
export function createFullBackup(kind: BackupKind = "manual", tag = ""): { name: string; size: number } {
  const dir = resolveBackupDir();
  const name = `${kind === "manual" ? "all" : "auto"}${tag ? "-" + tag : ""}_${tsCompact()}.tar.gz`;
  const out = path.join(dir, name);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-backup-"));
  try {
    const info = stageConfig(staging);
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(
        { app: "docker-stack-manager", kind, tag: tag || null, createdAt: new Date().toISOString(), stacks: info.stacks, files: info.files },
        null,
        2
      ),
      "utf-8"
    );
    runTar(["-czf", name, "-C", staging, "."], "备份打包", dir);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const st = fs.statSync(out);
  log.info(`已创建${kind === "manual" ? "手动" : "自动"}全量备份：${name}（${st.size} 字节）`);
  return { name, size: st.size };
}

/** 从全量备份包恢复（覆盖 Compose 堆栈与设置/引擎文件） */
export function restoreFullBackup(backupName: string): { stacks: number } {
  const dir = resolveBackupDir();
  const archive = resolveInBackupDir(dir, backupName);
  if (!fs.existsSync(archive)) throw new Error(`备份文件不存在: ${backupName}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-restore-"));
  try {
    runTar(["-xzf", path.basename(archive), "-C", staging], "备份解包", path.dirname(archive));

    const srcCompose = path.join(staging, "dockercompose");
    let stacks = 0;
    if (fs.existsSync(srcCompose)) {
      fs.mkdirSync(COMPOSE_DIR, { recursive: true });
      fs.cpSync(srcCompose, COMPOSE_DIR, { recursive: true, force: true });
      stacks = fs.readdirSync(srcCompose, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    }
    copyIfExists(path.join(staging, "config", "settings.json"), path.join(CONFIG_DIR, "settings.json"));
    copyIfExists(path.join(staging, "data", "engines.json"), dataPath("engines.json"));
    copyIfExists(path.join(staging, "data", "active_engine.json"), dataPath("active_engine.json"));

    log.info(`已从 ${backupName} 恢复（堆栈 ${stacks} 个）`);
    return { stacks };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

/** 生成“导出全部配置”归档到临时目录（不进备份列表）；调用方下载后应删除 */
export function exportConfigArchive(): { name: string; path: string } {
  const name = `config-export_${tsCompact()}.tar.gz`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dsm-export-")), name);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-export-stage-"));
  try {
    stageConfig(staging);
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify({ app: "docker-stack-manager", kind: "export", createdAt: new Date().toISOString() }, null, 2),
      "utf-8"
    );
    runTar(["-czf", path.basename(out), "-C", staging, "."], "导出打包", path.dirname(out));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  return { name, path: out };
}

/** 备份文件列表（按修改时间倒序） */
export function listBackupFiles(): BackupFileInfo[] {
  const dir = resolveBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".tar.gz"))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtime.toISOString() };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/** 解析备份文件的绝对路径（校验存在且在备份目录内，防路径穿越） */
export function backupFilePath(backupName: string): string {
  const dir = resolveBackupDir();
  const target = resolveInBackupDir(dir, backupName);
  if (!fs.existsSync(target)) throw new Error(`备份文件不存在: ${backupName}`);
  return target;
}

/** 删除备份文件（限备份目录内，防路径穿越） */
export function deleteBackupFile(backupName: string): void {
  const dir = resolveBackupDir();
  const target = resolveInBackupDir(dir, backupName);
  if (!fs.existsSync(target)) throw new Error(`备份文件不存在: ${backupName}`);
  fs.unlinkSync(target);
}

/** 保留清理：删除同前缀（如 `auto-weekly_`）中除最新 keep 个外的备份，返回删除数量 */
export function pruneBackups(prefix: string, keep: number): number {
  const dir = resolveBackupDir();
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".tar.gz"))
    .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  let removed = 0;
  for (const x of files.slice(Math.max(0, keep))) {
    try {
      fs.unlinkSync(path.join(dir, x.f));
      removed++;
    } catch {
      /* 单个删除失败不影响其余 */
    }
  }
  return removed;
}
