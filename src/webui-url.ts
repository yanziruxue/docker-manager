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
