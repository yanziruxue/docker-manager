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
 * v1.52.0 结构升级为三级：分区(zones) → 分组(groups) → 应用(apps)。
 * 文件形状由 `{ groups: [...] }` 升级为 `{ zones: [...] }`，并保留向后兼容迁移：
 * 旧版 `{ groups }` 自动包裹进一个默认分区「默认分区」，已配置的导航不丢失。
 * v1.52.9 不变量：每个分区至少存在一个分组；空组分区归一化时自动补一个与分区同名的默认分组。
 */

const NAV_GROUPS_FILE = configPath("nav-groups.json");
const SETTINGS_FILE = configPath("settings.json");

/** v1.51.9 分组外观枚举白名单（参照 FlatNas）；非法值一律回落默认，避免前端注入任意字符串 */
const CARD_STYLES = ["solid", "glass", "flat", "outline", "transparent"] as const;
const ICON_SHAPES = [
  "rounded", "circle", "square", "leaf", "diamond",
  "pentagon", "hexagon", "octagon", "none", "hidden",
] as const;

const str = (x: unknown, cap: number): string => String(x ?? "").trim().slice(0, cap);
const genId = () => `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** 数值钳制：非有限数或越界回落默认 */
const num = (x: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof x === "number" && isFinite(x) ? x : NaN;
  if (isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
};
/** 枚举白名单：只接受合法值，其余回落默认（含旧数据缺字段） */
const pick = <T extends string>(x: unknown, allowed: readonly T[], dflt: T): T => {
  const s = String(x ?? "");
  return allowed.includes(s as T) ? (s as T) : dflt;
};
/** 备链数组钳制 */
const backups = (raw: unknown, cap: number, each: number): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 10).map((x) => str(x, each)).filter(Boolean).slice(0, cap);
};

/** 归一化单个分组（v1.52.3 起分组为纯分类容器：仅 id/name/icon/apps，不再携带外观字段） */
function normalizeNavGroup(g: any): Record<string, unknown> | null {
  if (!g || typeof g !== "object") return null;
  const name = str(g.name, 40);
  if (!name) return null;
  const rawApps = Array.isArray(g.apps) ? g.apps : [];
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
      description: str(an.description, 200),
      // v1.51.7：类型 + 卡片增强字段（全部可选，缺省回落）
      kind: an.kind === "ext" ? "ext" : "self",
      titleColor: str(an.titleColor, 32),
      urlBackups: backups(an.urlBackups, 10, 500),
      lanBackups: backups(an.lanBackups, 10, 300),
      isPublic: Boolean(an.isPublic),
      iconZoom: num(an.iconZoom, 50, 200, 100),
    };
  });
  return {
    id: str(g.id, 40) || genId(),
    name,
    icon: str(g.icon, 300),
    apps,
  };
}

/**
 * 分区外观提升（v1.52.3）：外观参数统一上移到分区级。
 * 取值优先级：分区自身字段 > 首个分组的遗留外观字段（旧数据样式挂在 group 上，迁移时提升）> 默认值。
 * 这样旧 nav-groups.json（样式在 group 上）GET 即干净、渲染不丢。
 */
function zoneAppearanceFromRaw(z: any): Record<string, unknown> {
  const g0 = Array.isArray(z?.groups) && z.groups.length > 0 ? z.groups[0] : undefined;
  return {
    cardLayout: z?.cardLayout === "horizontal" || g0?.cardLayout === "horizontal" ? "horizontal" : "vertical",
    cardSize: num(z?.cardSize ?? g0?.cardSize, 60, 240, 120),
    gridGap: num(z?.gridGap ?? g0?.gridGap, 0, 60, 16),
    iconSize: num(z?.iconSize ?? g0?.iconSize, 16, 96, 48),
    cardStyle: pick(z?.cardStyle ?? g0?.cardStyle, CARD_STYLES, "solid"),
    iconShape: pick(z?.iconShape ?? g0?.iconShape, ICON_SHAPES, "rounded"),
    // v1.52.4：分区级间距（0–120），旧数据缺字段回落为改动前的视觉值
    zoneFirstGroupGap: num(z?.zoneFirstGroupGap, 0, 120, 20),
    groupCardGapTop: num(z?.groupCardGapTop, 0, 120, 20),
    groupCardGapBottom: num(z?.groupCardGapBottom, 0, 120, 32),
  };
}

/**
 * 导航分区归一化（v1.52.0）：宽容解析用户 / 旧版数据——
 * 字段全做 trim + 长度钳制、非法条目丢弃、id 缺失补生成；整体条数设上限防配置膨胀。
 * v1.52.3：外观字段提升到分区级（zoneAppearanceFromRaw）。
 */
function normalizeNavZones(v: any): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  const out: Array<Record<string, unknown>> = [];
  for (const z of v.slice(0, 50)) {
    if (!z || typeof z !== "object") continue;
    const name = str(z.name, 40);
    if (!name) continue;
    const rawGroups = Array.isArray(z.groups) ? z.groups : [];
    const groups = (rawGroups.slice(0, 50) as any[])
      .map((g: any) => normalizeNavGroup(g))
      .filter((g: any): g is Record<string, unknown> => !!g);
    // v1.52.9：分区下至少一个分组——旧数据 / 直接 PUT 的空组分区自动补一个同名默认分组（幂等）
    // 读取(get)只归一化内存结构不改写文件；下次保存(save)时规范化结果自然落盘。
    if (groups.length === 0) {
      groups.push({ id: genId(), name, icon: "", apps: [] });
    }
    out.push({
      id: str(z.id, 40) || genId(),
      name,
      groups,
      ...zoneAppearanceFromRaw(z),
    });
  }
  return out;
}

/** 把任意旧结构（{groups} 或 settings.nav.groups）包裹为单一默认分区 */
function wrapLegacyAsZone(groupsRaw: any): Array<Record<string, unknown>> {
  const rawGroups = Array.isArray(groupsRaw) ? groupsRaw : [];
  const groups = rawGroups
    .map(normalizeNavGroup)
    .filter((g): g is Record<string, unknown> => !!g);
  if (groups.length === 0) return [];
  // 旧数据样式挂在 group 上，迁移时提升到分区级（取首个分组的外观）
  return [{ id: genId(), name: "默认分区", groups, ...zoneAppearanceFromRaw({ groups: rawGroups }) }];
}

function writeNavGroupsFile(zones: Array<Record<string, unknown>>): void {
  fs.writeFileSync(NAV_GROUPS_FILE, JSON.stringify({ zones }, null, 2), { mode: 0o600 });
}

/**
 * 一次性迁移：从旧 `settings.json.nav.groups` 迁到独立文件，并清除旧键。
 * 返回归一化后的分区（可能为空数组）。任何异常都安全降级为空，绝不抛给调用方。
 */
function migrateFromSettings(): Array<Record<string, unknown>> {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return [];
    const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    const oldGroups = parsed?.nav?.groups;
    const zones = wrapLegacyAsZone(oldGroups);
    // 清除旧 nav 键，保持 main 落盘文件干净（仅当确有 nav 段时改写，避免无谓变更）
    if (parsed && typeof parsed === "object" && "nav" in parsed) {
      delete parsed.nav;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(parsed, null, 2), { mode: 0o600 });
    }
    return zones;
  } catch {
    return [];
  }
}

let cache: Array<Record<string, unknown>> | null = null;

/** 读取导航分区（含一次性迁移；结果带内存缓存，避免每次请求重读磁盘） */
export function getNavGroups(): Array<Record<string, unknown>> {
  if (cache) return cache;
  try {
    if (fs.existsSync(NAV_GROUPS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(NAV_GROUPS_FILE, "utf-8"));
      // 新结构 {zones} 直接归一化；旧结构 {groups} 包裹为单一默认分区（数据不丢）；其它回落空
      let raw: unknown[] = [];
      if (Array.isArray(parsed?.zones)) raw = parsed.zones;
      else if (Array.isArray(parsed?.groups)) raw = wrapLegacyAsZone(parsed.groups);
      cache = normalizeNavZones(raw);
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

/** 保存导航分区：归一化 + 落盘（0600）+ 更新缓存，返回规范化后的数据 */
export function saveNavGroups(zones: any): Array<Record<string, unknown>> {
  const norm = normalizeNavZones(zones);
  writeNavGroupsFile(norm);
  cache = norm;
  return norm;
}
