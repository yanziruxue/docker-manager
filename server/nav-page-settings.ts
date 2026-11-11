import fs from "node:fs";
import { configPath } from "./paths.js";

/**
 * 导航页「页面设置」独立持久化（v1.51.8）。
 *
 * 设计原则（沿用 nav-groups 铁律）：导航页的配置与 main 主支的 `settings.json` / `SystemSettings`
 * 完全分离——nav 相关配置收口在 nav 自己的管理通道里，永不借道 `/api/settings`。
 * 本模块拥有**独立文件** + **独立路由** + **独立客户端 API**，schema 与 main 核心逻辑零耦合。
 *
 * 与本模块对应的是「分组卡片设置」（v1.51.7，存于 nav-groups.json）——
 * 二者职责分离：分组设置管「某分组的卡片布局/尺寸/间距/图标大小」；
 * 本模块管「整页背景/天气/内外网默认模式/白昼」，作用于整页而非单分组。
 */

const NAV_PAGE_SETTINGS_FILE = configPath("nav-page-settings.json");

const WEATHERS = new Set(["none", "rain", "snow", "sakura", "leaves"]);
const THEMES = new Set(["auto", "light", "dark"]);
const NETMODES = new Set(["auto", "lan", "wan"]);

/** 数值钳制：非有限数或越界回落默认 */
function num(x: unknown, min: number, max: number, dflt: number): number {
  const n = typeof x === "number" && isFinite(x) ? x : NaN;
  if (isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * 导航页面设置归一化：宽容解析用户 / 旧版数据——
 * 所有字段可选；字符串枚举非法值回落默认；bgBlur 钳制 0–40；缺字段回落 undefined。
 */
function normalizeNavPageSettings(v: any): Record<string, unknown> {
  const o = v && typeof v === "object" ? v : {};
  const out: Record<string, unknown> = {};
  const bg = typeof o.bgImage === "string" ? o.bgImage.trim().slice(0, 2000) : "";
  if (bg) out.bgImage = bg;
  const blur = num(o.bgBlur, 0, 40, 0);
  if (blur > 0) out.bgBlur = blur;
  if (WEATHERS.has(o.weather)) out.weather = o.weather;
  if (THEMES.has(o.theme)) out.theme = o.theme;
  if (NETMODES.has(o.navNetworkMode)) out.navNetworkMode = o.navNetworkMode;
  return out;
}

function writeFile(settings: Record<string, unknown>): void {
  fs.writeFileSync(NAV_PAGE_SETTINGS_FILE, JSON.stringify(settings, null, 2), { mode: 0o600 });
}

let cache: Record<string, unknown> | null = null;

/** 读取导航页面设置（结果带内存缓存，避免每次请求重读磁盘） */
export function getNavPageSettings(): Record<string, unknown> {
  if (cache) return cache;
  try {
    if (fs.existsSync(NAV_PAGE_SETTINGS_FILE)) {
      cache = normalizeNavPageSettings(JSON.parse(fs.readFileSync(NAV_PAGE_SETTINGS_FILE, "utf-8")));
    } else {
      cache = {};
    }
  } catch {
    cache = {};
  }
  return cache;
}

/** 保存导航页面设置：归一化 + 落盘（0600）+ 更新缓存，返回规范化后的数据 */
export function saveNavPageSettings(settings: any): Record<string, unknown> {
  const norm = normalizeNavPageSettings(settings);
  writeFile(norm);
  cache = norm;
  return norm;
}
