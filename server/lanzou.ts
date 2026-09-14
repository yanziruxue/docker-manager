import { compareVersion, type UpdateInfo } from "./updater.js";

/**
 * 蓝奏云 OTA 更新源（默认优先于 GitHub）。
 *
 * 设计要点：
 *  - 使用「文件夹分享链接」（b- 前缀）。文件夹页列出所有上传的 zip，
 *    我们从文件名提取版本号（docker-manager-yanzi-linux-x64-vX.Y.Z.zip），
 *    取语义版本最高者即「最新版」。每个文件虽各有独立分享链接，但列表来自
 *    文件夹页，无需预先知道具体链接 —— 这正解决了「每个文件链接不一样、如何确认最新」的问题。
 *  - 文件夹可设访问密码：密码经 filemoreajax.php 提交，服务端回写鉴权
 *    Cookie（phpdisk_info 等），该 Cookie 必须透传到文件页与 ajaxm.php 才能拿到直链。
 *  - 单文件分享页（i- 前缀）通过 ajaxm.php 拿真实直链（需从页面 JS 提取 sign 等签名参数）。
 *
 * 链接与密码写死在代码里（部署前确认）；环境变量可临时覆盖（便于测试、不改代码）：
 *   LANZOU_UPDATE_URL  覆盖文件夹链接
 *   LANZOU_FOLDER_PWD  覆盖文件夹密码
 */
const LANZOU_FOLDER_URL =
  (process.env.LANZOU_UPDATE_URL && process.env.LANZOU_UPDATE_URL.trim()) ||
  "https://yanziruxue.lanzoum.com/b0he7aaxc"; // 文件夹分享链接（b- 前缀）

// 文件夹访问密码（蓝奏云「需要密码」时填写；公开文件夹留空）。环境变量 LANZOU_FOLDER_PWD 可临时覆盖。
const LANZOU_FOLDER_PWD =
  (process.env.LANZOU_FOLDER_PWD && process.env.LANZOU_FOLDER_PWD.trim()) || "yanzidocker";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function originOf(url: string): string {
  const m = url.match(/^https?:\/\/[^/]+/i);
  return m ? m[0] : "https://yanziruxue.lanzoum.com";
}

/** 把 Set-Cookie / Cookie 头里的 name=value 解析成 map（忽略 path/domain/expires 等属性） */
function parseCookies(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq).trim();
    let val = part.slice(eq + 1);
    const sc = val.indexOf(";");
    if (sc >= 0) val = val.slice(0, sc);
    if (
      name &&
      !["path", "domain", "expires", "max-age", "samesite", "httponly", "secure"].includes(
        name.toLowerCase()
      )
    ) {
      out[name] = val;
    }
  }
  return out;
}

/** 合并多段 Cookie，后者覆盖前者，输出为请求头可用的 `a=b; c=d` 形式 */
function mergeCookies(...raws: string[]): string {
  const merged: Record<string, string> = {};
  for (const r of raws) Object.assign(merged, parseCookies(r));
  return Object.entries(merged)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** GET 文本页，并抓取 set-cookie（蓝奏云接口需带 Cookie 与 Referer） */
async function lzGet(
  url: string,
  referer?: string,
  cookie?: string
): Promise<{ text: string; cookies: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/json",
      ...(referer ? { Referer: referer } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`蓝奏云请求失败 HTTP ${res.status} @ ${url}`);
  const text = await res.text();
  const sc = res.headers.get("set-cookie");
  return { text, cookies: sc || "" };
}

/** POST 到 ajaxm.php / filemoreajax.php，返回 JSON（兼容 text 字段）与响应 Set-Cookie */
async function lzPostAjax(
  url: string,
  body: Record<string, string>,
  cookie: string,
  referer: string
): Promise<{ data: any; cookies: string }> {
  const form = new URLSearchParams(body).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: form,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`蓝奏云 ajax 失败 HTTP ${res.status}`);
  const text = await res.text();
  let data: any = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { text };
  }
  const sc = res.headers.get("set-cookie");
  return { data, cookies: sc || "" };
}

interface LzFile {
  name: string;
  pageUrl: string;
  version: string;
}

/**
 * 从文件夹分享页解析文件列表，并透出鉴权 Cookie。
 * 兼容两种结构：
 *  - 直接内联 HTML 中的 <a href="/iXXXX">name.zip</a>
 *  - 现代版经 filemoreajax.php 异步加载（返回 JSON.text 内含文件项 HTML）
 * 密码文件夹：向 filemoreajax.php 提交 pwd，服务端回写 Cookie 一并透出。
 */
async function listFolderFiles(
  folderUrl: string
): Promise<{ files: LzFile[]; cookie: string }> {
  const origin = originOf(folderUrl);
  const { text: html, cookies: baseCookies } = await lzGet(folderUrl);
  let pageText = html;
  let cookie = baseCookies;

  // 现代版：文件夹页通过 filemoreajax.php 异步加载文件列表（密码文件夹在此提交 pwd）
  const fid = (html.match(/var\s+folder_id\s*=\s*'?(\d+)'?/i) || [])[1];
  if (fid) {
    try {
      const body: Record<string, string> = { folder_id: fid, pg: "1", rank: "1" };
      if (LANZOU_FOLDER_PWD) body.pwd = LANZOU_FOLDER_PWD;
      const { data: more, cookies: moreCookies } = await lzPostAjax(
        `${origin}/filemoreajax.php`,
        body,
        cookie,
        folderUrl
      );
      if (moreCookies) cookie = mergeCookies(cookie, moreCookies);
      if (more && typeof more.text === "string" && more.text.includes("/i")) {
        // 合并解析，覆盖两种结构
        pageText = html + "\n" + more.text;
      }
    } catch {
      // 忽略，回退到直接解析 html
    }
  }

  const files: LzFile[] = [];
  // 抓取「文件分享链接 + 附近文件名（.zip）」，仅保留带版本号的 zip
  const re = /href="(\/i[\w]+)"[\s\S]*?([\w.\-]+\.zip)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pageText))) {
    const name = m[2];
    const vm = name.match(/v(\d+\.\d+\.\d+)/i);
    if (!vm) continue;
    files.push({
      name,
      pageUrl: `${origin}${m[1]}`,
      version: vm[1],
    });
  }
  return { files, cookie };
}

/** 从单个文件分享页拿真实直链（ajaxm.php），需带上文件夹鉴权 Cookie */
async function getDirectUrl(
  filePageUrl: string,
  cookie: string
): Promise<{ url: string; size: number }> {
  const origin = originOf(filePageUrl);
  const { text: html, cookies: pageCookies } = await lzGet(filePageUrl, filePageUrl, cookie);
  const cookie2 = mergeCookies(cookie, pageCookies);

  // 提取 ajaxdata 中的签名参数（不同版本字段名略有差异，能拿到的都带上）
  const sign = (html.match(/['"]?sign['"]?\s*:\s*'([^']+)'/i) || [])[1] || "";
  const signs = (html.match(/['"]?signs['"]?\s*:\s*'([^']+)'/i) || [])[1] || "";
  const websign = (html.match(/['"]?websign['"]?\s*:\s*'([^']+)'/i) || [])[1] || "";
  const websignkey = (html.match(/['"]?websignkey['"]?\s*:\s*'([^']+)'/i) || [])[1] || "";
  if (!sign && !signs) throw new Error("蓝奏云页面未找到签名参数（页面结构可能已变化）");

  const body: Record<string, string> = { action: "downprocess", ves: "1" };
  if (sign) body.sign = sign;
  if (signs) body.signs = signs;
  if (websign) body.websign = websign;
  if (websignkey) body.websignkey = websignkey;

  const { data } = await lzPostAjax(`${origin}/ajaxm.php`, body, cookie2, filePageUrl);
  if (!data || data.zt !== 1) {
    throw new Error(`蓝奏云获取直链失败：${data?.inf || "未知错误"}`);
  }
  const dom = data.dom || "";
  const url = data.url || "";
  if (!dom || !url) throw new Error("蓝奏云直链字段缺失");
  // dom 如 https://s3.lanzoui.com，url 如 /2024/06/15/xxx.zip（已含路径）
  const direct = `${dom.replace(/\/+$/, "")}${url.startsWith("/") ? url : "/" + url}`;
  const size = parseInt(String(data.filesize || data.size || "0"), 10) || 0;
  return { url: direct, size };
}

/**
 * 解析蓝奏云文件夹，选出最新版本，返回 UpdateInfo。
 * 网络/解析失败时抛错（由调用方回退 GitHub）。
 */
export async function resolveLanZouUpdate(currentVersion: string): Promise<UpdateInfo> {
  const { files, cookie } = await listFolderFiles(LANZOU_FOLDER_URL);
  if (files.length === 0) {
    throw new Error("蓝奏云文件夹中未找到带版本号的 zip 更新包");
  }

  // 取语义版本最高者
  let latest = files[0];
  for (const f of files) {
    if (compareVersion(f.version, latest.version) > 0) latest = f;
  }

  const { url: directUrl, size } = await getDirectUrl(latest.pageUrl, cookie);
  const hasUpdate = compareVersion(latest.version, currentVersion) > 0;

  return {
    currentVersion,
    latestVersion: latest.version,
    hasUpdate,
    releaseName: `蓝奏云 v${latest.version}`,
    releaseNotes: hasUpdate
      ? `蓝奏云更新可用：v${latest.version}（当前 v${currentVersion}）`
      : `已是最新版本（蓝奏云 v${latest.version}）`,
    publishedAt: "",
    assetName: latest.name,
    assetSize: size,
    downloadUrl: directUrl,
    htmlUrl: LANZOU_FOLDER_URL,
    source: "lanzou",
  };
}

/** 从蓝奏云直链下载 zip 到 Buffer，带进度回调 */
export async function downloadLanZou(
  url: string,
  onProgress?: (received: number, total: number) => void
): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Referer: LANZOU_FOLDER_URL },
    signal: AbortSignal.timeout(600000), // 40MB 包，给足 10 分钟
  });
  if (!res.ok) throw new Error(`蓝奏云下载失败 HTTP ${res.status}`);
  const total = parseInt(res.headers.get("content-length") || "0", 10);
  const reader = res.body?.getReader();
  if (!reader) {
    const ab = Buffer.from(await res.arrayBuffer());
    onProgress?.(ab.length, ab.length);
    return ab;
  }
  const chunks: Buffer[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(Buffer.from(value));
      received += value.byteLength;
      onProgress?.(received, total);
    }
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 1024 * 1024) throw new Error(`蓝奏云下载内容异常（仅 ${buf.length} 字节）`);
  return buf;
}
