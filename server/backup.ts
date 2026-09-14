import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DATA_DIR, CONFIG_DIR, COMPOSE_DIR, dataPath } from "./paths.js";
import { getSettings } from "./settings.js";
import { createLogger } from "./logger.js";
import { zipDirectory, extractZip } from "./zip.js";
import {
  diagnosePerm,
  formatIssue,
  isPermError,
  tryGrantOwnerRead,
  currentUser,
  type PermIssue,
} from "./perms.js";

/**
 * 备份 / 恢复 / 导出 的统一实现。
 *
 * 备份包格式：**zip**（`.zip`）。历史上用过 `tar.gz`，读取端仍兼容（见 isTarGz），
 * 但不再产出——zip 跨平台可直接双击打开，且不携带源目录的畸形权限位。
 *
 * 备份包结构（统一根，便于整体打包与解包）：
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

/** 递归归一化权限：目录 0755 / 文件 0644（暂存目录由本进程创建，修正后打包与清理都不会再遇 EACCES） */
function chmodTree(dir: string): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        fs.chmodSync(full, 0o755);
        chmodTree(full);
      } else if (e.isFile()) {
        fs.chmodSync(full, 0o644);
      }
    } catch {
      /* 单个条目修正失败不影响其余 */
    }
  }
}

/**
 * 删除暂存目录。
 * 关键：**清理失败绝不能影响备份结果**——曾经因为暂存目录继承了源目录的只读权限，
 * `rmSync` 抛 EACCES 让整个「立即备份」返回失败（实际备份包已生成）。
 */
function rmrf(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    return;
  } catch (e: any) {
    log.warn(`暂存目录清理失败，修正权限后重试：${e?.message || e}`);
  }
  try {
    chmodTree(dir);
    fs.chmodSync(dir, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (e: any) {
    log.warn(`暂存目录仍无法删除（不影响备份结果）：${dir} — ${e?.message || e}`);
  }
}

/**
 * 复制单个文件；遇到权限类失败且开启自愈时，给「属于自己的」文件补上属主读位后重试一次。
 * 只补 `u+r`（`mode | 0o400`），不改动 group/other 位、不改动归属，
 * 因此不会把 `0600` 的敏感文件放大成 `0644`。属主不是当前进程时**直接放弃**。
 */
function copyFileMaybeHeal(
  s: string,
  d: string,
  autoFix: boolean,
  onFixed?: (absPath: string, detail: string) => void
): void {
  try {
    fs.copyFileSync(s, d);
    return;
  } catch (e: any) {
    if (!autoFix || !isPermError(e)) throw e;
    const r = tryGrantOwnerRead(s);
    if (!r.ok) throw e;
    fs.copyFileSync(s, d); // 修好后重试一次
    log.warn(`已自动补上属主读权限并完成复制：${s}（${r.detail}）`);
    onFixed?.(s, r.detail);
  }
}

/** 备份期自愈开关（默认开；settings.backup.autoFixReadPerm 可关） */
function shouldAutoFixReadPerm(): boolean {
  try {
    const v = getSettings()?.backup?.autoFixReadPerm;
    return v === undefined ? true : !!v;
  } catch {
    return true;
  }
}

/**
 * 递归复制目录。
 *
 * 刻意**不用 `fs.cpSync`**：Node v22.22.2 在 Windows 上对**含非 ASCII 字符的源目录名**
 * 做递归复制会直接段错误（实测 `只读栈` 这类名字必崩）；自研实现还便于逐条隔离错误、
 * 丢弃源目录的畸形权限位（避免暂存目录只读 → 清理报 EACCES）。
 *
 * @returns 根目录是否成功复制（子条目失败只记录，不影响整体）
 */
function copyTree(
  src: string,
  dest: string,
  onError: (relPath: string, e: any) => void,
  autoFix: boolean,
  onFixed?: (absPath: string, detail: string) => void
): boolean {
  fs.mkdirSync(dest, { recursive: true });
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(src, { withFileTypes: true });
  } catch (e: any) {
    onError("", e);
    return false;
  }
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        let target: string;
        try {
          target = fs.readlinkSync(s);
        } catch (e: any) {
          onError(entry.name, e);
          continue;
        }
        try {
          fs.symlinkSync(target, d);
        } catch {
          /* 目标已存在或平台不支持符号链接：跳过 */
        }
      } else if (entry.isDirectory()) {
        copyTree(s, d, (rel, e) => onError(rel ? `${entry.name}/${rel}` : entry.name, e), autoFix, onFixed);
      } else if (entry.isFile()) {
        copyFileMaybeHeal(s, d, autoFix, onFixed);
        try {
          fs.chmodSync(d, 0o644);
        } catch {
          /* 权限修正失败不致命 */
        }
      }
      // socket / fifo / 设备文件无法复制，跳过
    } catch (e: any) {
      onError(entry.name, e);
    }
  }
  return true;
}

/**
 * 收集待备份内容到暂存目录（单一根）。
 * Compose 堆栈**逐个复制并隔离错误**：某个堆栈（或其中个别文件）因权限/损坏复制失败时
 * 只跳过它，其余照常备份。失败项不再只报一句 `EACCES`，而是给出完整权限诊断
 * （权限位 / 属主 / 目标 uid / 可直接复制的修复命令），并在属主正确时先尝试自愈。
 */
function stageConfig(staging: string): {
  stacks: number;
  files: string[];
  skipped: string[];
  skippedDetails: PermIssue[];
  fixed: PermIssue[];
} {
  const files: string[] = [];
  const skipped: string[] = [];
  const skippedDetails: PermIssue[] = [];
  const fixed: PermIssue[] = [];
  const me = currentUser();
  const autoFix = shouldAutoFixReadPerm();

  /** 记录一次失败：结构化诊断 + 自解释文案 + 单行完整日志 */
  const record = (absPath: string, relPath: string, e: any): void => {
    const code = String(e?.code || e?.message || "未知错误");
    const issue = diagnosePerm({ absPath, relPath, code, targetUid: me.uid });
    skippedDetails.push(issue);
    skipped.push(formatIssue(issue));
    log.warn(
      `备份跳过 ${relPath}｜${issue.code}｜权限 ${issue.mode}｜属主 ${issue.owner}(uid ${issue.uid})｜` +
        `运行用户 ${issue.targetUser}(uid ${issue.targetUid})｜原因：${issue.reason}｜建议：${issue.advice}`
    );
  };

  /** 自愈成功：记入 fixed 供界面提示「已自动修复」 */
  const onFixed = (absPath: string, detail: string): void => {
    const rel = path.relative(COMPOSE_DIR, absPath) || path.basename(absPath);
    fixed.push(diagnosePerm({ absPath, relPath: rel, code: "EACCES", targetUid: me.uid, autoFixed: true }));
    log.info(`备份自愈：${rel}（${detail}）`);
  };

  // 1) Compose 堆栈目录
  const composeDest = path.join(staging, "dockercompose");
  fs.mkdirSync(composeDest, { recursive: true });
  let stacks = 0;
  if (fs.existsSync(COMPOSE_DIR)) {
    const entries = fs
      .readdirSync(COMPOSE_DIR, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const src = path.join(COMPOSE_DIR, entry.name);
      const dest = path.join(composeDest, entry.name);
      const fail = (rel: string, e: any) =>
        record(rel ? path.join(src, rel) : src, rel ? `${entry.name}/${rel}` : entry.name, e);
      if (entry.isDirectory()) {
        if (copyTree(src, dest, fail, autoFix, onFixed)) stacks++;
      } else if (entry.isFile()) {
        try {
          copyFileMaybeHeal(src, dest, autoFix, onFixed);
        } catch (e: any) {
          fail("", e);
        }
      }
    }
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

  chmodTree(staging);
  return { stacks, files, skipped, skippedDetails, fixed };
}

/**
 * 创建全量备份包。
 * @param kind manual=手动（文件名 all_*）/ auto=自动（文件名 auto-<tag>_*）
 * @param tag  自动备份的调度类型（weekly / monthly / yearly / simple），用于分组保留
 */
export function createFullBackup(
  kind: BackupKind = "manual",
  tag = ""
): { name: string; size: number; skipped: string[]; skippedDetails: PermIssue[]; fixed: PermIssue[] } {
  const dir = resolveBackupDir();
  const name = `${kind === "manual" ? "all" : "auto"}${tag ? "-" + tag : ""}_${tsCompact()}.zip`;
  const out = path.join(dir, name);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-backup-"));
  let skipped: string[] = [];
  let skippedDetails: PermIssue[] = [];
  let fixed: PermIssue[] = [];
  try {
    const info = stageConfig(staging);
    skipped = info.skipped;
    skippedDetails = info.skippedDetails;
    fixed = info.fixed;
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(
        {
          app: "docker-stack-manager",
          format: "zip",
          kind,
          tag: tag || null,
          createdAt: new Date().toISOString(),
          stacks: info.stacks,
          files: info.files,
          skipped: info.skipped,
        },
        null,
        2
      ),
      "utf-8"
    );
    zipDirectory(staging, out);
    if (fixed.length) {
      log.warn(`备份过程中自动补正了 ${fixed.length} 个文件的读权限：${fixed.map((f) => f.relPath).join("、")}`);
    }
    if (skipped.length) log.warn(`备份已跳过 ${skipped.length} 个条目（逐条诊断见上方日志）`);
  } finally {
    rmrf(staging);
  }
  const st = fs.statSync(out);
  log.info(`已创建${kind === "manual" ? "手动" : "自动"}全量备份：${name}（${st.size} 字节）`);
  return { name, size: st.size, skipped, skippedDetails, fixed };
}

/** 旧版归档判定（仅用于兼容读取历史备份，新备份一律 .zip） */
function isTarGz(name: string): boolean {
  return /\.tar\.gz$/i.test(name);
}

/** 从全量备份包恢复（覆盖 Compose 堆栈与设置/引擎文件） */
export function restoreFullBackup(backupName: string): { stacks: number } {
  const dir = resolveBackupDir();
  const archive = resolveInBackupDir(dir, backupName);
  if (!fs.existsSync(archive)) throw new Error(`备份文件不存在: ${backupName}`);

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-restore-"));
  try {
    if (isTarGz(backupName)) {
      // 历史 tar.gz 备份：仍可恢复
      runTar(["-xzf", path.basename(archive), "-C", staging], "备份解包", path.dirname(archive));
    } else {
      extractZip(archive, staging);
    }

    const srcCompose = path.join(staging, "dockercompose");
    let stacks = 0;
    if (fs.existsSync(srcCompose)) {
      fs.mkdirSync(COMPOSE_DIR, { recursive: true });
      const loaded = stageStacksFrom(srcCompose, COMPOSE_DIR);
      stacks = loaded.stacks;
      if (loaded.skipped.length) {
        throw new Error(`恢复中止，以下堆栈写入失败：${loaded.skipped.join("、")}`);
      }
    }
    copyIfExists(path.join(staging, "config", "settings.json"), path.join(CONFIG_DIR, "settings.json"));
    copyIfExists(path.join(staging, "data", "engines.json"), dataPath("engines.json"));
    copyIfExists(path.join(staging, "data", "active_engine.json"), dataPath("active_engine.json"));

    log.info(`已从 ${backupName} 恢复（堆栈 ${stacks} 个）`);
    return { stacks };
  } finally {
    rmrf(staging);
  }
}

/** 把解包出来的堆栈目录逐个写回 COMPOSE_DIR，隔离单个失败 */
function stageStacksFrom(srcCompose: string, destRoot: string): { stacks: number; skipped: string[] } {
  const skipped: string[] = [];
  let stacks = 0;
  const entries = fs
    .readdirSync(srcCompose, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const src = path.join(srcCompose, entry.name);
    const dest = path.join(destRoot, entry.name);
    const fail = (rel: string, e: any) => {
      skipped.push(`${rel ? `${entry.name}/${rel}` : entry.name}（${e?.code || e?.message || "未知错误"}）`);
      log.warn(`堆栈恢复失败：${path.join(dest, rel)} — ${e?.message || e}`);
    };
    if (entry.isDirectory()) {
      // 恢复方向不做自愈：写回堆栈时若失败应显式报错中止，而不是悄悄改动源文件权限
      if (copyTree(src, dest, fail, false)) stacks++;
    } else if (entry.isFile()) {
      try {
        fs.copyFileSync(src, dest);
      } catch (e: any) {
        fail("", e);
      }
    }
  }
  return { stacks, skipped };
}

/** 生成“导出全部配置”归档到临时目录（不进备份列表）；调用方下载后应删除 */
export function exportConfigArchive(): { name: string; path: string } {
  const name = `config-export_${tsCompact()}.zip`;
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dsm-export-")), name);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "dsm-export-stage-"));
  try {
    const info = stageConfig(staging);
    fs.writeFileSync(
      path.join(staging, "manifest.json"),
      JSON.stringify(
        { app: "docker-stack-manager", format: "zip", kind: "export", createdAt: new Date().toISOString(), skipped: info.skipped },
        null,
        2
      ),
      "utf-8"
    );
    zipDirectory(staging, out);
  } finally {
    rmrf(staging);
  }
  return { name, path: out };
}

/** 备份包扩展名（新格式 zip；历史 tar.gz 仍列出，保证旧备份可恢复/下载） */
const BACKUP_EXT = /\.(zip|tar\.gz)$/i;

/** 备份文件列表（按修改时间倒序） */
export function listBackupFiles(): BackupFileInfo[] {
  const dir = resolveBackupDir();
  return fs
    .readdirSync(dir)
    .filter((f) => BACKUP_EXT.test(f))
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
    .filter((f) => f.startsWith(prefix) && BACKUP_EXT.test(f))
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
