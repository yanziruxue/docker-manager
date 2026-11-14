/**
 * 自定义图标自动匹配（浏览器侧纯函数，无 node 依赖；v1.50.32）。
 *
 * 图标映射由服务端 `GET /api/custom-icons` 构造好（已按 png > jpg/jpeg > ico > 其他
 * 处理同名多格式），本模块只负责「名称归一化 + 候选派生 + 查表」。
 * 映射为空（未绑定目录 / 目录不可读）时所有函数返回空结果 ⇒ 行为等同原有方案。
 */

export interface CustomIconEntry {
  name: string;
  url: string;
  ext: string;
  stem: string;
}

export interface CustomIconsPayload {
  bound: boolean;
  dir: string;
  error: string;
  entries: CustomIconEntry[];
  /** stem → 取图 URL，服务端已按格式优先级去重 */
  map: Record<string, string>;
}

export interface CustomIconCheckResult {
  ok: boolean;
  count: number;
  files: number;
  error: string;
  unbound: boolean;
  /** v1.52.18：目录是否可写（只读挂载 / 权限不足时 false，图标仍可显示但下载写入会失败） */
  writable?: boolean;
  /** v1.52.18：不可写时的警告说明 */
  warn?: string;
}

/**
 * 是否允许自动图标填入：
 * - 空图标 ⇒ 可以；
 * - 堆栈目录 `icon.*` 的自动回退引用 `/api/stack-icons/<name>` ⇒ 可以（自定义目录优先，原图库兜底）；
 * - 手工图库选择 `/api/stack-icons/<name>/<file>`、外链、内嵌 SVG ⇒ **保留不覆盖**。
 */
export function shouldAutoFillIcon(icon?: string): boolean {
  if (!icon) return true;
  return /^\/api\/stack-icons\/[^/]+$/.test(icon);
}

/**
 * 容器名 → 自动匹配候选键（大小写不敏感、去重、保序）。
 * 覆盖三种常见命名：container_name=server、compose 默认 `<project>-<service>-<n>`、
 * compose v1 下划线 `<project>_<service>_<n>`。
 */
export function iconNameCandidates(name: string, stackName?: string): string[] {
  const out: string[] = [];
  const push = (v: string) => {
    const k = String(v || "").trim().toLowerCase();
    if (k && !out.includes(k)) out.push(k);
  };
  push(name);
  if (stackName && name.toLowerCase().startsWith(stackName.toLowerCase() + "-")) {
    push(name.slice(stackName.length + 1).replace(/[-_]\d+$/, ""));
  }
  const parts = String(name || "").split(/[-_]/).filter(Boolean);
  const tail = [...parts].reverse().find((p) => !/^\d+$/.test(p));
  if (tail) push(tail);
  return out;
}

/** 依次尝试候选键查映射，命中即返回 URL；映射为空时返回空串 */
export function pickCustomIcon(map: Record<string, string> | undefined, candidates: string[]): string {
  if (!map) return "";
  for (const c of candidates) {
    const url = map[String(c || "").trim().toLowerCase()];
    if (url) return url;
  }
  return "";
}
