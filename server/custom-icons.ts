/**
 * 自定义图标库目录（v1.50.32）—— 设置中心 → 页面设置 → 图标库目录。
 *
 * 绑定的是**运行本服务的那台机器上的绝对路径**（浏览器读不到任意本地目录）。
 * - 留空 / 路径不可用 ⇒ 映射为空，前端行为完全等同原有的堆栈 icon/ 图库方案；
 * - 绑定后按「名称（不含扩展名）」自动匹配图标：同名多格式优先 png > jpg/jpeg > ico > 其他。
 *
 * 安全边界：绝对路径 + 拒绝 .. + realpath 落在绑定目录内 + 单段文件名 +
 * 扩展名白名单 + 2MB 上限。本模块只做**只读**扫描，绝不写入用户目录。
 */
import fs from "node:fs";
import path from "node:path";

/** 图标扩展名白名单（与堆栈图库一致） */
export const CUSTOM_ICON_FILE_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/i;
/** 单个图标文件体积上限（2MB） */
export const CUSTOM_ICON_MAX_BYTES = 2 * 1024 * 1024;

export interface CustomIconEntry {
  /** 原始文件名 */
  name: string;
  /** 同源取图 URL */
  url: string;
  /** 小写扩展名（含点） */
  ext: string;
  /** 去扩展名后的小写名称，自动匹配键 */
  stem: string;
}

/**
 * 同名图标的格式优先级：png > jpg/jpeg > ico > 其他（svg / webp / gif）。
 * 数值越小越优先。
 */
export function customIconExtRank(ext: string): number {
  switch (ext.toLowerCase()) {
    case ".png": return 0;
    case ".jpg":
    case ".jpeg": return 1;
    case ".ico": return 2;
    default: return 3;
  }
}

/**
 * 校验并解析绑定目录。空串 = 未绑定（合法，error 为空）。
 * 返回 realpath 后的绝对路径，供后续拼接与越界校验使用。
 */
export function resolveCustomIconDir(raw: unknown): { dir: string; error: string } {
  const p = String(raw ?? "").trim();
  if (!p) return { dir: "", error: "" };
  if (!path.isAbsolute(p)) {
    return { dir: "", error: "路径必须是绝对路径（Linux 以 / 开头，Windows 以盘符开头）" };
  }
  if (p.split(/[\\/]+/).includes("..")) {
    return { dir: "", error: "路径不能包含 ..（防止越界访问）" };
  }
  try {
    const real = fs.realpathSync(p);
    if (!fs.statSync(real).isDirectory()) return { dir: "", error: "路径不是目录" };
    fs.readdirSync(real); // 可读性探测：服务运行账号可能无权读取
    return { dir: real, error: "" };
  } catch (e: any) {
    return { dir: "", error: `目录不可读：${e?.message || "不存在或无权限"}` };
  }
}

/** 枚举目录内的图标文件（普通文件 + 白名单 + 2MB 以内），按名称与格式优先级排序 */
export function listCustomIconEntries(dir: string): CustomIconEntry[] {
  if (!dir) return [];
  const out: CustomIconEntry[] = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isFile() || !CUSTOM_ICON_FILE_RE.test(ent.name)) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!ext) continue;
    let size = 0;
    try { size = fs.statSync(path.join(dir, ent.name)).size; } catch { continue; }
    if (size > CUSTOM_ICON_MAX_BYTES) continue;
    out.push({
      name: ent.name,
      url: `/api/custom-icons/${encodeURIComponent(ent.name)}`,
      ext,
      stem: ent.name.slice(0, -ext.length).toLowerCase(),
    });
  }
  return sortCustomIconEntries(out);
}

/** 排序：名称升序 → 格式优先级 → 文件名（保证映射构建确定性） */
export function sortCustomIconEntries(entries: CustomIconEntry[]): CustomIconEntry[] {
  return [...entries].sort(
    (a, b) =>
      a.stem.localeCompare(b.stem, "zh") ||
      customIconExtRank(a.ext) - customIconExtRank(b.ext) ||
      a.name.localeCompare(b.name, "zh")
  );
}

/** 构造 stem → url 映射：同名多格式只保留优先级最高的一个 */
export function buildCustomIconMap(entries: CustomIconEntry[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const e of sortCustomIconEntries(entries)) {
    if (map[e.stem] === undefined) map[e.stem] = e.url;
  }
  return map;
}

/**
 * 取图请求的路径校验，返回可安全读取的文件绝对路径。
 * 拒绝：路径穿越、子目录、非白名单扩展名、符号链接指向目录外、超体积文件。
 */
export function resolveCustomIconFile(dir: string, rawFile: unknown): { file: string; error: string } {
  const raw = String(rawFile ?? "");
  const base = path.basename(raw);
  if (!raw || base !== raw || base.includes("/") || base.includes("\\") || !CUSTOM_ICON_FILE_RE.test(base)) {
    return { file: "", error: "非法图标文件名" };
  }
  if (!dir) return { file: "", error: "未绑定图标目录" };
  try {
    const real = fs.realpathSync(path.join(dir, base));
    const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep;
    // realpath 必须落在绑定目录内（防符号链接越界）；大小写归一避免 Windows 盘符差异误判
    if (!real.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { file: "", error: "图标文件越界" };
    }
    const st = fs.statSync(real);
    if (!st.isFile() || st.size > CUSTOM_ICON_MAX_BYTES) return { file: "", error: "图标文件不可用" };
    return { file: real, error: "" };
  } catch {
    return { file: "", error: "图标文件不存在" };
  }
}
