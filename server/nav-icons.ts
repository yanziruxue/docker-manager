/**
 * 导航页专属图标库（v1.52.4）——与「设置中心 → 页面设置 → 图标库目录」
 * （settings.json 的 modal.iconDir，供 Docker / 堆栈页使用）完全分开：
 *  - 独立配置文件 config/nav-icons.json，只存 { dir }；
 *  - 独立路由 /api/nav-icons/*，从链接下载的图标只写入本库目录；
 *  - 只读扫描 / 取图防穿越复用 server/custom-icons.ts 的纯函数，避免两套实现漂移。
 *
 * 安全边界：URL 仅 http(s)；拒绝回环 / 本机 / 云元数据；重定向手动跟随 ≤3 跳且逐跳校验；
 * Content-Type 必须 image/*；流式读取累计 ≤2MB；文件名保留中文但剔除路径与危险字符；
 * 写入前二次 realpath 校验目录；重名追加序号绝不覆盖。
 */
import fs from "node:fs";
import path from "node:path";
import { configPath } from "./paths.js";
import {
  resolveCustomIconDir,
  listCustomIconEntries,
  buildCustomIconMap,
  resolveCustomIconFile,
  type CustomIconEntry,
} from "./custom-icons.js";

const NAV_ICONS_FILE = configPath("nav-icons.json");
const NAV_ICON_MAX_BYTES = 2 * 1024 * 1024;

const NAV_ICON_CT_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
};
const NAV_ICON_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico"]);

export interface NavIconsPayload {
  bound: boolean;
  dir: string;
  error: string;
  entries: CustomIconEntry[];
  /** stem（去扩展名小写）→ 取图 URL，导航库同名优先 */
  map: Record<string, string>;
}

/** 读取绑定的原始目录路径（未绑定 / 文件损坏一律空串） */
export function getNavIconDir(): string {
  try {
    if (!fs.existsSync(NAV_ICONS_FILE)) return "";
    const p = JSON.parse(fs.readFileSync(NAV_ICONS_FILE, "utf-8"));
    return String(p?.dir ?? "").trim().slice(0, 2000);
  } catch {
    return "";
  }
}

/** 绑定 / 解绑目录（空串 = 解绑）；校验失败不落盘 */
export function bindNavIconDir(raw: unknown): { bound: boolean; dir: string; error: string } {
  const input = String(raw ?? "").trim();
  if (input) {
    const { dir, error } = resolveCustomIconDir(input);
    if (error || !dir) return { bound: false, dir: "", error };
  }
  fs.writeFileSync(NAV_ICONS_FILE, JSON.stringify({ dir: input }, null, 2), { mode: 0o600 });
  const { dir, error } = resolveCustomIconDir(input);
  return { bound: !!dir, dir, error };
}

/** 当前可用目录（realpath 后），供扫描 / 下载 / 取图共用 */
export function boundNavIconDir(): { dir: string; error: string } {
  return resolveCustomIconDir(getNavIconDir());
}

/** 列出导航图标库（取图 URL 前缀改为 /api/nav-icons/） */
export function navIconsPayload(): NavIconsPayload {
  const bound = !!getNavIconDir();
  const { dir, error } = boundNavIconDir();
  let entries: CustomIconEntry[] = [];
  if (dir) {
    try {
      entries = listCustomIconEntries(dir).map((e) => ({
        ...e,
        url: `/api/nav-icons/${encodeURIComponent(e.name)}`,
      }));
    } catch (e: any) {
      return { bound, dir: "", error: `读取图标目录失败：${e?.message || "无权限"}`, entries: [], map: {} };
    }
  }
  return { bound, dir, error, entries, map: buildCustomIconMap(entries) };
}

/** 取图路径校验（复用 custom-icons 的防穿越 / 符号链接越界实现） */
export function resolveNavIconFile(rawFile: unknown): { file: string; error: string } {
  const { dir, error: dirError } = boundNavIconDir();
  if (!dir) return { file: "", error: dirError || "未绑定导航图标库目录" };
  return resolveCustomIconFile(dir, rawFile);
}

/** 文件名净化：保留中文 / 字母 / 数字，剔除路径分隔符与控制字符，补白名单扩展名 */
function navIconFilename(rawName: string, ext: string): string {
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

/** 重名不覆盖：a.png → a-2.png */
function dedupe(dir: string, name: string): string {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  for (let i = 2; i < 1000; i++) {
    const c = `${stem}-${i}${ext}`;
    if (!fs.existsSync(path.join(dir, c))) return c;
  }
  return `${stem}-${Date.now()}${ext}`;
}

/** 下载远程图标写入绑定目录，返回可取图的同源 URL */
export async function downloadNavIcon(rawUrl: unknown, rawName: unknown): Promise<{ url: string; file: string }> {
  const { dir, error } = boundNavIconDir();
  if (!dir) throw new Error(error || "请先绑定导航图标库目录");
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
    ext = NAV_ICON_CT_EXT[ct] || extFromUrl(current) || ".png";
    if (!NAV_ICON_EXTS.has(ext)) throw new Error(`不支持的图片类型：${ct}`);
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > NAV_ICON_MAX_BYTES) throw new Error("图标超过 2MB，请换一张更小的图片");
    // 流式累计，超限立即中断，避免无 Content-Length 的大响应吃满内存
    const reader = res.body?.getReader();
    if (!reader) throw new Error("无法读取图标内容");
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > NAV_ICON_MAX_BYTES) {
        await reader.cancel();
        throw new Error("图标超过 2MB，请换一张更小的图片");
      }
      chunks.push(Buffer.from(value));
    }
    buf = Buffer.concat(chunks);
    if (!buf.length) throw new Error("图标内容为空");
    break;
  }
  if (!buf) throw new Error("下载重定向次数过多（最多 3 跳）");

  const file = dedupe(dir, navIconFilename(String(rawName ?? ""), ext));
  // 写入前二次确认目录未被替换成软链接，且目标落在该目录内
  const real = fs.realpathSync(dir);
  if (!path.resolve(real, file).startsWith(real + path.sep)) throw new Error("图标目录异常");
  fs.writeFileSync(path.join(real, file), buf);
  return { url: `/api/nav-icons/${encodeURIComponent(file)}`, file };
}
