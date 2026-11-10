import fs from "node:fs";
import { configPath } from "./paths.js";

/**
 * 导航分组独立持久化（v1.51.2，label 分支解耦）。
 *
 * 设计原则（用户铁律）：导航页的配置与设置全部收口在本页自己的管理页里，
 * 与 main 主支的 `settings.json` / `SystemSettings` 完全分离——label 分支只作为 main 主支的功能扩展，
 * 不得污染 main 核心逻辑与落盘 schema。因此本模块拥有**独立文件** + **独立路由** + **独立客户端 API**，
 * 永不借道 `/api/settings` 与 `SystemSettings`。
 *
 * 一次性迁移（v1.51.2）：老版本（v1.51.0 / v1.51.1）把 nav 配置写进了 main 的 `settings.json.nav.groups`。
 * 本模块在读不到 `nav-groups.json` 时，自动从旧 `settings.json` 把该段迁过来，
 * 并把旧 `nav` 键从 `settings.json` 中清除（保持 main 落盘文件干净）。迁移仅执行一次。
 */

const NAV_GROUPS_FILE = configPath("nav-groups.json");
const SETTINGS_FILE = configPath("settings.json");

/**
 * 导航分组归一化：宽容解析用户 / 旧版数据——
 * 字段全做 trim + 长度钳制、非法条目丢弃、id 缺失补生成；整体条目数设上限防配置膨胀。
 * （从旧 `server/settings.ts` 迁移而来，逻辑不变。）
 */
function normalizeNavGroups(v: any): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  const str = (x: unknown, cap: number): string => String(x ?? "").trim().slice(0, cap);
  const genId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const out: Array<Record<string, unknown>> = [];
  for (const g of v.slice(0, 50)) {
    if (!g || typeof g !== "object") continue;
    const name = str((g as any).name, 40);
    if (!name) continue;
    const rawApps = Array.isArray((g as any).apps) ? (g as any).apps : [];
    const apps = rawApps.slice(0, 200).map((a: any) => {
      const an = (!a || typeof a !== "object") ? {} : a;
      return {
        id: str(an.id, 40) || genId(),
        name: str(an.name, 60) || "未命名",
        icon: str(an.icon, 300),
        iconColor: str(an.iconColor, 32),
        url: str(an.url, 500),
        lanUrl: str(an.lanUrl, 300),
        remark: str(an.remark, 200),
      };
    });
    out.push({ id: str((g as any).id, 40) || genId(), name, icon: str((g as any).icon, 300), apps });
  }
  return out;
}

function writeNavGroupsFile(groups: Array<Record<string, unknown>>): void {
  fs.writeFileSync(NAV_GROUPS_FILE, JSON.stringify({ groups }, null, 2), { mode: 0o600 });
}

/**
 * 一次性迁移：从旧 `settings.json.nav.groups` 迁到独立文件，并清除旧键。
 * 返回归一化后的分组（可能为空数组）。任何异常都安全降级为空，绝不抛给调用方。
 */
function migrateFromSettings(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return [];
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const oldGroups = parsed?.nav?.groups;
    const normalized = normalizeNavGroups(oldGroups);
    // 清除旧 nav 键，保持 main 落盘文件干净（仅当确有 nav 段时改写，避免无谓变更）
    if (parsed && typeof parsed === "object" && "nav" in parsed) {
      delete parsed.nav;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    }
    return normalized;
  } catch {
    return [];
  }
}

let cache: Array<Record<string, unknown>> | null = null;

/** 读取导航分组（含一次性迁移；结果带内存缓存，避免每次请求重读磁盘） */
export function getNavGroups(): Array<Record<string, unknown>> {
  if (cache) return cache;
  try {
    if (fs.existsSync(NAV_GROUPS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(NAV_GROUPS_FILE, "utf-8"));
      cache = normalizeNavGroups(parsed?.groups);
    } else {
      cache = migrateFromSettings();
      // 落盘迁移结果（即使为空也写，标记已迁移，避免下次重复读 settings）
      writeNavGroupsFile(cache);
    }
  } catch {
    cache = [];
  }
  return cache;
}

/** 保存导航分组：归一化 + 落盘（0600）+ 更新缓存，返回规范化后的数据 */
export function saveNavGroups(groups: any): Array<Record<string, unknown>> {
  const norm = normalizeNavGroups(groups);
  writeNavGroupsFile(norm);
  cache = norm;
  return norm;
}
