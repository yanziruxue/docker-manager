/**
 * 内外网分区（v1.50.36）：按访问者来源 IP 与配置网段（CIDR）判断内网 / 外网。
 *
 * - IPv4：点分十进制 + 前缀长度精确位匹配（无 / 视为 /32）；
 * - IPv6：BigInt 位匹配，支持 ::、IPv4 尾段（含 ::ffff:a.b.c.d v4-mapped）；
 * - 配置归一化：逗号 / 分号 / 回车分隔，非法项丢弃，无有效项回落默认网段集。
 *
 * 默认网段（用户已确认，2026-11-09）：RFC1918 三段 + 回环 + 链路本地 + IPv6 私网。
 */

/** 默认内网网段（设置卡片留空 / 无有效输入时生效） */
export const DEFAULT_INTRANET_CIDRS = [
  "127.0.0.0/8", // 本机回环
  "10.0.0.0/8", // RFC1918 A 类
  "172.16.0.0/12", // RFC1918 B 类（172.16~172.31）
  "192.168.0.0/16", // RFC1918 C 类
  "169.254.0.0/16", // 链路本地（APIPA）
  "::1/128", // IPv6 回环
  "fe80::/10", // IPv6 链路本地
  "fc00::/7", // IPv6 内网 ULA（fc00::~fdff::）
];

/** 点分 IPv4 → 无符号 32 位整数；非法返回 null（严格校验，拒绝 256+ / 非数字段） */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let v = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = v * 256 + n;
  }
  return v >>> 0;
}

/** IPv6 地址（含 ::、IPv4 尾段 / v4-mapped）→ 128 位 BigInt；非法返回 null */
function ipv6ToBigInt(input: string): bigint | null {
  let s = input.toLowerCase().trim();
  const lastColon = s.lastIndexOf(":");
  // 尾部 IPv4 段（::ffff:1.2.3.4 或 x:x:...:1.2.3.4）先转成两个 16 位十六进制组
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const v4 = ipv4ToInt(s.slice(lastColon + 1));
    if (v4 === null) return null;
    s = s.slice(0, lastColon + 1) + (v4 >>> 16).toString(16) + ":" + (v4 & 0xffff).toString(16);
  }
  if (!s.includes(":")) return null;
  const dc = s.split("::");
  if (dc.length > 2) return null; // 多个 "::" 非法
  const groups = dc.length === 2 ? [...(dc[0] ? dc[0].split(":") : []), ...(dc[1] ? dc[1].split(":") : [])] : s.split(":");
  if (groups.length > 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  let value = 0n;
  for (const g of dc.length === 2 ? (dc[0] ? dc[0].split(":") : []) : groups) {
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  if (dc.length === 2) {
    const head = dc[0] ? dc[0].split(":") : [];
    const tail = dc[1] ? dc[1].split(":") : [];
    value <<= BigInt(16 * (8 - head.length - tail.length));
    for (const g of tail) value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

/** 单个 IP 是否命中单个 CIDR；任一侧解析失败视为不命中（绝不因坏配置误判） */
function ipMatchCidr(ip: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf("/");
  const addrPart = slash >= 0 ? cidr.slice(0, slash) : cidr;
  const prefixStr = slash >= 0 ? cidr.slice(slash + 1) : "";
  if (prefixStr !== "" && !/^\d{1,3}$/.test(prefixStr)) return false;
  if (addrPart.includes(":")) {
    const ipV = ipv6ToBigInt(ip);
    const netV = ipv6ToBigInt(addrPart);
    if (ipV === null || netV === null) return false;
    const prefix = prefixStr === "" ? 128 : Number(prefixStr);
    if (prefix > 128) return false;
    if (prefix === 0) return true;
    const shift = BigInt(128 - prefix);
    return ipV >> shift === netV >> shift;
  }
  const ipV = ipv4ToInt(ip);
  const netV = ipv4ToInt(addrPart);
  if (ipV === null || netV === null) return false;
  const prefix = prefixStr === "" ? 32 : Number(prefixStr);
  if (prefix > 32) return false;
  if (prefix === 0) return true;
  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0;
  return ((ipV & mask) >>> 0) === ((netV & mask) >>> 0);
}

/** IP 是否命中网段列表（任一命中即内网）。v4-mapped（::ffff:a.b.c.d）先归一化为纯 IPv4 */
export function ipInCidrs(ip: string, cidrs: string[]): boolean {
  let target = String(ip || "").trim();
  if (!target) return false;
  if (target.toLowerCase().startsWith("::ffff:") && ipv4ToInt(target.slice(7)) !== null) {
    target = target.slice(7);
  }
  return cidrs.some((c) => ipMatchCidr(target, c));
}

/**
 * 归一化「页面设置 → 内外网自动切换」的网段原始串：
 * 拆分（逗号 / 分号 / 回车）→ trim → 格式校验（非法丢弃）→ 去重；
 * 空串 / 无有效项 ⇒ 返回默认网段集副本。
 */
export function normalizeIntranetCidrs(raw: string): string[] {
  const items = String(raw || "")
    .split(/[,;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return [...DEFAULT_INTRANET_CIDRS];
  const valid = items.filter((item) => {
    const slash = item.lastIndexOf("/");
    const addrPart = slash >= 0 ? item.slice(0, slash) : item;
    const prefixStr = slash >= 0 ? item.slice(slash + 1) : "";
    if (prefixStr !== "" && !/^\d{1,3}$/.test(prefixStr)) return false;
    if (addrPart.includes(":")) {
      return ipv6ToBigInt(addrPart) !== null && (prefixStr === "" || Number(prefixStr) <= 128);
    }
    return ipv4ToInt(addrPart) !== null && (prefixStr === "" || Number(prefixStr) <= 32);
  });
  if (valid.length === 0) return [...DEFAULT_INTRANET_CIDRS];
  return [...new Set(valid)];
}

/**
 * 从请求中提取访问者来源 IP：
 * - 优先 X-Forwarded-For 首个（兼容 nginx / fnOS 反代场景；内网工具，可接受伪造风险）；
 * - 否则取 TCP 对端地址，并把 v4-mapped（::ffff:a.b.c.d）归一化为纯 IPv4，
 *   保证与 IPv4 网段（192.168.0.0/16 等）正常匹配。
 */
export function clientIpFromRequest(req: {
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}): string {
  const xff = req.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  const ra = String(req.socket?.remoteAddress || "").trim();
  return ra.startsWith("::ffff:") ? ra.slice(7) : ra;
}

/** 判定访问分区：命中任一内网网段 = intranet，否则 internet */
export function resolveNetworkZone(ip: string, cidrs: string[]): "intranet" | "internet" {
  return ipInCidrs(ip, cidrs) ? "intranet" : "internet";
}
