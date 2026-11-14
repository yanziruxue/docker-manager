/**
 * 自定义图标库目录（v1.50.32）—— 设置中心 → 页面设置 → 图标库目录。
 *
 * 绑定的是**运行本服务的那台机器上的绝对路径**（浏览器读不到任意本地目录）。
 * - 留空 / 路径不可用 ⇒ 映射为空，前端行为完全等同原有的堆栈 icon/ 图库方案；
 * - 绑定后按「名称（不含扩展名）」自动匹配图标：同名多格式优先 png > jpg/jpeg > ico > 其他。
 *
 * 安全边界：绝对路径 + 拒绝 .. + realpath 落在绑定目录内 + 单段文件名 +
 * 扩展名白名单 + 10MB 上限。扫描 / 取图为**只读**；v1.52.15 起额外提供
 * 受控下载 downloadCustomIcon（写入绑定目录，安全约束与 nav-icons 下载一致）。
 */
import fs from "node:fs";
import path from "node:path";

/** 图标扩展名白名单（与堆栈图库一致） */
export const CUSTOM_ICON_FILE_RE = /\.(png|jpe?g|gif|svg|webp|ico)$/i;
/** 单个图标文件体积上限（10MB，v1.52.16 由 2MB 放宽） */
export const CUSTOM_ICON_MAX_BYTES = 10 * 1024 * 1024;

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

/** 枚举目录内的图标文件（普通文件 + 白名单 + 10MB 以内），按名称与格式优先级排序 */
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

// ==================== v1.52.15：从链接下载图标写入图标库目录 ====================
// 供「导航页 / 堆栈 LABELS / 堆栈 SETTINGS」三处「从链接下载图标」统一使用；
// 目录 = 设置中心 → 页面设置 → 图标库目录（modal.iconDir）。

const ICON_CT_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};
const ICON_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

/** 图标文件写入统一收口（下载 / 上传共用）：探测可写 → 防穿越 → 写入（EROFS 等给中文提示） */
function writeIconFile(dir: string, file: string, buf: Buffer): { url: string; file: string } {
  // 写入前二次确认目录未被替换成软链接，且目标落在该目录内
  const real = fs.realpathSync(dir);
  if (!path.resolve(real, file).startsWith(real + path.sep)) throw new Error("图标目录异常");
  try {
    fs.writeFileSync(path.join(real, file), buf);
  } catch (e: any) {
    // v1.52.18：写入阶段被拒（如探测通过后被重新挂载为只读）也给出人话错误
    const code = String(e?.code || "");
    if (code === "EROFS") throw new Error("写入失败：目录是只读挂载（EROFS），请将该目录改为读写挂载或换一个可写的图标库目录");
    if (code === "EACCES" || code === "EPERM") throw new Error("写入失败：服务运行账号对该目录没有写权限，请检查目录属主/权限");
    throw e;
  }
  return { url: `/api/custom-icons/${encodeURIComponent(file)}`, file };
}

/** 逐跳校验下载目标（防 SSRF：回环 / 本机 / 云元数据拒绝；内网其它主机允许） */
function assertSafeIconUrl(u: URL): void {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("仅支持 http / https 链接");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "127.0.0.1" ||
    /^127\./.test(h) ||
    h === "::1" ||
    h === "0.0.0.0" ||
    h === "169.254.169.254"
  ) {
    throw new Error("不允许从本机 / 云元数据地址下载图标");
  }
}

/** 文件名净化：保留中文 / 字母 / 数字，剔除路径分隔符与控制字符 */
function iconFilename(rawName: string, ext: string): string {
  const base =
    String(rawName || "")
      .trim()
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
      .replace(/^\.+/, "")
      .slice(0, 80) || "icon";
  return `${base}${ext}`.slice(-100);
}

/** 从 URL 路径末段推断扩展名（Content-Type 未命中白名单时兜底） */
function extFromUrl(u: URL): string {
  const m = /\.(png|jpe?g|gif|svg|webp|ico)$/i.exec(u.pathname);
  return m ? m[0].toLowerCase() : "";
}

/** 重名不覆盖：a.png → a-2.png */
function dedupeIconFile(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  for (let i = 2; i < 1000; i++) {
    const c = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, c))) return c;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** 从链接下载图标写入绑定目录（dir 必须已过 resolveCustomIconDir 校验），返回可取图的同源 URL */
export async function downloadCustomIcon(rawUrl: unknown, rawName: unknown, dir: string): Promise<{ url: string; file: string }> {
  if (!dir) throw new Error("没有绑定图标库目录");
  // v1.52.18：下载前先探测可写性，只读挂载 / 无写权限在下载前就报人话错误（fail-fast）
  const w = probeIconDirWritable(dir);
  if (!w.writable) {
    throw new Error(`${w.error}；请将该目录改为读写挂载，或在设置中心换一个可写的图标库目录`);
  }
  const first = String(rawUrl ?? "").trim();
  if (!first) throw new Error("请填写图标链接");
  let current: URL;
  try {
    current = new URL(first);
  } catch {
    throw new Error("图标链接格式不正确");
  }

  let buf: Buffer | null = null;
  let ext = "";
  for (let hop = 0; hop < 4; hop++) {
    assertSafeIconUrl(current);
    const res = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,*/*" },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("下载重定向缺少 Location");
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    const ct = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ct.startsWith("image/")) throw new Error(`链接不是图片（Content-Type: ${ct || "未知"}）`);
    ext = ICON_CT_EXT[ct] || extFromUrl(current) || ".png";
    if (!ICON_EXTS.has(ext)) throw new Error(`不支持的图片类型：${ct}`);
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > CUSTOM_ICON_MAX_BYTES) throw new Error("图标超过 10MB，请换一张更小的图片");
    // 流式累计，超限立即中断，避免无 Content-Length 的大响应吃满内存
    const reader = res.body?.getReader();
    if (!reader) throw new Error("无法读取图标内容");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > CUSTOM_ICON_MAX_BYTES) {
        await reader.cancel();
        throw new Error("图标超过 10MB，请换一张更小的图片");
      }
      chunks.push(Buffer.from(value));
    }
    buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error("图标内容为空");
    break;
  }
  if (!buf) throw new Error("下载重定向次数过多（最多 3 跳）");

  const file = dedupeIconFile(dir, iconFilename(String(rawName ?? ""), ext));
  return writeIconFile(dir, file, buf);
}

/**
 * 上传本地图片到图标库目录（v1.52.23）：与「从链接下载」同一套落盘安全逻辑。
 * rawName 取项目名（前端预填），fallback 文件名；ext 由 Content-Type 映射。
 */
export function uploadCustomIcon(rawName: unknown, contentType: unknown, buf: Buffer, dir: string): { url: string; file: string } {
  if (!dir) throw new Error("没有绑定图标库目录");
  if (!buf?.length) throw new Error("请选择图片文件");
  if (buf.length > CUSTOM_ICON_MAX_BYTES) throw new Error("图标超过 10MB，请换一张更小的图片");
  // v1.52.18：写入前先探测可写性，只读挂载 / 无写权限提前报人话错误（fail-fast）
  const w = probeIconDirWritable(dir);
  if (!w.writable) {
    throw new Error(`${w.error}；请将该目录改为读写挂载，或在设置中心换一个可写的图标库目录`);
  }
  const ct = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  const ext = ICON_CT_EXT[ct] || "";
  if (!ext) throw new Error(`不支持的图片类型：${ct || "未知"}`);
  const file = dedupeIconFile(dir, iconFilename(String(rawName ?? ""), ext));
  return writeIconFile(dir, file, buf);
}

/**
 * 目录可写性探测（v1.52.18）：accessSync(W_OK)。
 * 只读挂载返回 EROFS（对 root 也生效），权限不足返回 EACCES/EPERM。
 * 供「检测目录」与「从链接下载图标」两处提前暴露写不进的问题。
 */
export function probeIconDirWritable(dir: string): { writable: boolean; error: string } {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return { writable: true, error: "" };
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code === "EROFS") return { writable: false, error: "目录是只读挂载（EROFS）" };
    if (code === "EACCES" || code === "EPERM") return { writable: false, error: "服务运行账号对该目录没有写权限" };
    return { writable: false, error: `目录不可写：${e?.message || code || "未知错误"}` };
  }
}
