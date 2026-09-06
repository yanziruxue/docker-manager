import path from "node:path";
import fs from "node:fs";
import { DATA_DIR_DEFAULT, LOG_DIR_DEFAULT, CONFIG_DIR_DEFAULT } from "./config.js";

/**
 * 目录解析优先级：
 *   1. 环境变量（DATA_DIR / LOG_DIR / CONFIG_DIR，生产部署可覆盖）
 *   2. 生产模式 → 安装目录下子目录（config.ts 默认值：<cwd>/data 等）
 *   3. 开发模式 → 项目根下同名子目录
 */
function resolveDir(envValue: string | undefined, fallback: string): string {
  if (envValue) return envValue;
  return process.env.NODE_ENV === "production"
    ? fallback
    : path.join(process.cwd(), path.basename(fallback));
}

export const DATA_DIR = resolveDir(process.env.DATA_DIR, DATA_DIR_DEFAULT);
export const LOG_DIR = resolveDir(process.env.LOG_DIR, LOG_DIR_DEFAULT);
export const CONFIG_DIR = resolveDir(process.env.CONFIG_DIR, CONFIG_DIR_DEFAULT);

/** Compose 项目统一存放目录：<data>/dockercompose/<项目名>/ */
export const COMPOSE_DIR = path.join(DATA_DIR, "dockercompose");

/** 解析数据文件路径（<data>/...） */
export function dataPath(filename: string): string {
  return path.join(DATA_DIR, filename);
}

/** 解析配置文件路径（<config>/...） */
export function configPath(filename: string): string {
  return path.join(CONFIG_DIR, filename);
}

/** 解析日志文件路径（<logs>/...） */
export function logPath(filename: string): string {
  return path.join(LOG_DIR, filename);
}

// 确保目录存在（幂等）
for (const dir of [DATA_DIR, LOG_DIR, CONFIG_DIR, COMPOSE_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// ---------- 旧布局数据迁移 ----------
// 旧版本数据散落在进程 cwd（开发）或 /var/lib/docker-stack-manager（旧生产默认）。
// 新文件缺失时自动复制到新布局，避免升级后丢配置。
function copyIfMissing(src: string, dest: string): void {
  if (!fs.existsSync(src) || fs.existsSync(dest)) return;
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log(`[paths] 迁移旧数据: ${src} → ${dest}`);
  } catch (e) {
    console.warn(`[paths] 迁移失败 ${src}:`, e);
  }
}

function migrateLegacy(): void {
  const legacyDirs = [process.cwd(), "/var/lib/docker-stack-manager"];
  for (const dir of legacyDirs) {
    if (!dir || !fs.existsSync(dir)) continue;
    copyIfMissing(path.join(dir, "settings.json"), configPath("settings.json"));
    copyIfMissing(path.join(dir, "engines.json"), dataPath("engines.json"));
    copyIfMissing(path.join(dir, "active_engine.json"), dataPath("active_engine.json"));
    // 旧 stacks 目录 → 新 dockercompose 目录
    const srcStacks = path.join(dir, "stacks");
    if (fs.existsSync(srcStacks) && dir !== DATA_DIR) {
      mergeIntoCompose(srcStacks);
    }
    const srcBackups = path.join(dir, "backups");
    const destBackups = path.join(DATA_DIR, "backups");
    if (fs.existsSync(srcBackups) && !fs.existsSync(destBackups)) {
      try {
        fs.cpSync(srcBackups, destBackups, { recursive: true });
        console.log(`[paths] 迁移旧数据目录: ${srcBackups} → ${destBackups}`);
      } catch (e) {
        console.warn(`[paths] 迁移目录失败 ${srcBackups}:`, e);
      }
    }
  }
  // data/stacks → data/dockercompose（布局升级）
  mergeIntoCompose(path.join(DATA_DIR, "stacks"));
  // 拆分旧 .stack-meta.json 为规范元文件（name / description）
  splitLegacyMeta();
}
migrateLegacy();

/** 把旧 stacks 目录下的项目合并进 dockercompose（同名跳过） */
function mergeIntoCompose(srcStacks: string): void {
  if (!fs.existsSync(srcStacks)) return;
  try {
    const entries = fs.readdirSync(srcStacks, { withFileTypes: true });
    let moved = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dest = path.join(COMPOSE_DIR, entry.name);
      if (fs.existsSync(dest)) continue;
      fs.cpSync(path.join(srcStacks, entry.name), dest, { recursive: true });
      moved++;
    }
    // 原目录已全部合并：删除避免重复扫描
    const remaining = fs.readdirSync(srcStacks).filter((n) => {
      const dest = path.join(COMPOSE_DIR, n);
      return !fs.existsSync(dest);
    });
    if (remaining.length === 0) {
      fs.rmSync(srcStacks, { recursive: true, force: true });
      console.log(`[paths] 堆栈目录已升级并清空旧目录: ${srcStacks} → ${COMPOSE_DIR}${moved ? ` (迁移 ${moved} 个项目)` : ""}`);
    }
  } catch (e) {
    console.warn(`[paths] 堆栈目录迁移失败 ${srcStacks}:`, e);
  }
}

/** 旧 .stack-meta.json → 规范元文件：name（展示名=目录名）/ description（纯文本） */
function splitLegacyMeta(): void {
  try {
    const entries = fs.readdirSync(COMPOSE_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(COMPOSE_DIR, entry.name);
      const metaPath = path.join(dir, ".stack-meta.json");
      // name 元文件：规范要求始终存在
      const nameFile = path.join(dir, "name");
      if (!fs.existsSync(nameFile)) fs.writeFileSync(nameFile, entry.name, "utf-8");
      if (!fs.existsSync(metaPath)) continue;
      // description 元文件：从 meta 提取
      const descFile = path.join(dir, "description");
      if (!fs.existsSync(descFile)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          fs.writeFileSync(descFile, String(meta.description || ""), "utf-8");
        } catch { /* meta 损坏则写空 */ fs.writeFileSync(descFile, "", "utf-8"); }
      }
    }
  } catch { /* 目录不存在时忽略 */ }
}
