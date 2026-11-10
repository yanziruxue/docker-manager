/**
 * WebUI 地址解析器（v1.50.36，容器管理页消费）：
 * - 内网：浏览器地址栏 protocol + hostname + LABELS 页端口（端口空回落完整 URL）；
 * - 外网：LABELS 页 WebUI URL（空回落「地址栏 + 端口」兜底）；
 * - 自动：按服务端判定的访问分区（GET /api/network-zone，来源 IP 匹配配置网段）分派。
 * 纯函数（不 import node:*，遵循 src/ 纯函数约定）。
 */

export type WebuiZoneMode = "auto" | "intranet" | "internet";
export type WebuiZone = "intranet" | "internet";

/** 非自动选择的 localStorage 键（自动模式不落盘 = 默认态） */
export const WEBUI_ZONE_MODE_KEY = "webui-zone-mode";

/** 归一化持久化的模式值：非法 / 缺失回落 auto */
export function loadWebuiZoneMode(store: { getItem(key: string): string | null }): WebuiZoneMode {
  const v = store.getItem(WEBUI_ZONE_MODE_KEY);
  return v === "intranet" || v === "internet" ? v : "auto";
}

/** 三态循环顺序：自动 → 内网 → 外网 → 自动 */
export function nextWebuiZoneMode(mode: WebuiZoneMode): WebuiZoneMode {
  return mode === "auto" ? "intranet" : mode === "intranet" ? "internet" : "auto";
}

/**
 * WebUI 地址解析：
 * - loc.protocol 形如 "http:"（window.location.protocol 原样），拼出 `${protocol}//${hostname}:${port}`；
 * - 优先级：内网取端口地址（缺端口回落完整 URL）；外网取完整 URL（缺 URL 回落端口地址兜底）；
 * - 解析结果为空串时调用方应禁用 WebUI 按钮。
 */
export function resolveWebuiUrl(
  label: { webuiUrl?: string; webuiPort?: string },
  mode: WebuiZoneMode,
  zone: WebuiZone,
  loc: { protocol: string; hostname: string },
): string {
  const portUrl = label.webuiPort ? `${loc.protocol}//${loc.hostname}:${label.webuiPort}` : "";
  const full = String(label.webuiUrl || "").trim();
  const intranetPick = () => portUrl || full;
  const internetPick = () => full || portUrl;
  if (mode === "intranet") return intranetPick();
  if (mode === "internet") return internetPick();
  return zone === "intranet" ? intranetPick() : internetPick();
}

/**
 * 导航应用内网地址归一化（v1.51.0）：
 * - `http(s)://…` 开头 → 原样（完整地址）；
 * - `:端口`（如 `:8807`）→ 浏览器协议 + 地址栏 host + 该端口；
 * - 其余（如 `192.168.24.10:8807` 或 `nas.local`）→ 浏览器协议 + 该值。
 * 空串返回空串（调用方回落外网地址）。
 */
export function normalizeNavLanUrl(
  lanUrl: string,
  loc: { protocol: string; hostname: string },
): string {
  const v = String(lanUrl || "").trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith(":")) return `${loc.protocol}//${loc.hostname}${v}`;
  return `${loc.protocol}//${v}`;
}

/**
 * 导航应用地址解析（v1.51.0，导航仪表盘卡片消费）：
 * - 内网：lanUrl（归一化后）优先，缺省回落 url；
 * - 外网：url 优先，缺省回落 lanUrl（兜底）；
 * - 自动：按服务端判定的访问分区分派。
 * 解析结果为空串时调用方应禁用卡片打开动作。
 */
export function resolveNavAppUrl(
  app: { url?: string; lanUrl?: string },
  mode: WebuiZoneMode,
  zone: WebuiZone,
  loc: { protocol: string; hostname: string },
): string {
  const lan = normalizeNavLanUrl(app.lanUrl || "", loc);
  const wan = String(app.url || "").trim();
  const intranetPick = () => lan || wan;
  const internetPick = () => wan || lan;
  if (mode === "intranet") return intranetPick();
  if (mode === "internet") return internetPick();
  return zone === "intranet" ? intranetPick() : internetPick();
}
