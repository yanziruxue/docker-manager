import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getSettings } from "./settings.js";

/**
 * 应用版本号：构建期由 esbuild define 注入（数据源 package.json）。
 * 开发模式（tsx 直跑源码）下未注入，兜底为 0.0.0-dev。
 */
export const CURRENT_VERSION =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";

/** zip 包内的二进制相对路径（与 make-package.py 的输出结构一致） */
const ASSET_APP_NAME = "docker-manager-yanzi";
const BINARY_IN_ZIP = path.join(ASSET_APP_NAME, ASSET_APP_NAME);
/** 新二进制最小体积（40MB 左右，低于 50MB 视为异常） */
const MIN_BINARY_SIZE = 50 * 1024 * 1024;

/**
 * 安装目录。
 * 生产环境（SEA 二进制）下 process.execPath 就是二进制自身路径，取其所在目录最可靠；
 * 开发模式下退化为进程工作目录。
 */
export function getInstallDir(): string {
  if (typeof __APP_VERSION__ !== "undefined") return path.dirname(process.execPath);
  return process.cwd();
}

/** 更新工作目录：位于可写的数据目录下 */
function getUpdateDir(): string {
  return path.join(getInstallDir(), "data", "update");
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
  htmlUrl: string;
}

export type UpdatePhase = "idle" | "downloading" | "extracting" | "replacing" | "done" | "error";

export interface UpdateState {
  phase: UpdatePhase;
  message: string;
  percent: number;
  error?: string;
}

let updateState: UpdateState = { phase: "idle", message: "", percent: 0 };

function setState(phase: UpdatePhase, message: string, percent: number, error?: string): void {
  updateState = { phase, message, percent, ...(error ? { error } : {}) };
}

export function getUpdateState(): UpdateState {
  return { ...updateState };
}

/** 兜底：把更新标记为失败（performUpdate 已知失败路径内部已自行 setState("error")，此处仅防极端未覆盖的异常） */
export function markUpdateError(message: string, detail?: string): void {
  if (getUpdateState().phase !== "error") setState("error", message, 0, detail);
}

/** 语义化版本比较：a > b 返回正数，a < b 返回负数，相等返回 0 */
export function compareVersion(a: string, b: string): number {
  const pa = String(a).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** GitHub 仓库固定写死（已设为公开仓库，无需 Token、无需在设置里配置） */
const UPDATE_REPO = "yanziruxue/docker-manager";

/** 返回固定仓库地址；仓库已公开，检查更新与下载均无需鉴权 */
function getRepo(): string {
  return UPDATE_REPO;
}

/** 统一的 GitHub 请求头（公开仓库，不带鉴权） */
function ghHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "docker-manager-yanzi",
    ...(extra || {}),
  };
}

/**
 * GitHub 资产 CDN（objects.githubusercontent.com）在国内常被墙，直连下载会 fetch failed。
 * 直连失败后按此列表回退（均为公开代理，仅中转二进制下载，不改动校验逻辑）。
 * 顺序即优先级；可在服务器环境变量 UPDATE_MIRROR 追加自定义镜像（完整前缀，如 https://my.proxy/）。
 */
const BUILTIN_MIRRORS = [
  "https://gh-proxy.com/",
];

/** 生成下载候选地址：直连优先，其次自定义镜像，最后内置镜像 */
function getDownloadCandidates(downloadUrl: string): string[] {
  const candidates = [downloadUrl];
  const extra = (process.env.UPDATE_MIRROR || "").trim();
  if (extra) candidates.push(extra.replace(/\/+$/, "") + "/" + downloadUrl);
  for (const m of BUILTIN_MIRRORS) {
    candidates.push(m.replace(/\/+$/, "") + "/" + downloadUrl);
  }
  return candidates;
}

/**
 * 检查 GitHub Releases 的最新版本。
 * 未认证调用有 60 次/小时的速率限制，个人使用足够。
 */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const repo = getRepo();
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;

  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: ghHeaders(),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e: any) {
    throw new Error(`无法连接 GitHub，请检查服务器网络：${e.message}`);
  }

  if (!res.ok) {
    if (res.status === 404) throw new Error("未找到该仓库的 Release（请确认仓库地址正确，且 Release 已发布、非草稿/预发布）");
    if (res.status === 401) throw new Error("GitHub 鉴权失败，请稍后再试");
    if (res.status === 403) throw new Error("GitHub API 速率限制或访问被拒绝，请稍后再试");
    throw new Error(`GitHub API 返回 ${res.status}`);
  }

  const data: any = await res.json();
  const tagName: string = data.tag_name || "";
  const latestVersion = tagName.replace(/^v/i, "");
  const assets: any[] = Array.isArray(data.assets) ? data.assets : [];
  // 选取 linux-x64 的交付包
  const asset =
    assets.find((a) => /linux-x64\.zip$/i.test(a.name || "")) ||
    assets.find((a) => /\.zip$/i.test(a.name || "")) ||
    assets[0];

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    hasUpdate: !!latestVersion && compareVersion(latestVersion, CURRENT_VERSION) > 0,
    releaseName: data.name || tagName || "",
    releaseNotes: String(data.body || "").slice(0, 2000),
    publishedAt: data.published_at || "",
    assetName: asset?.name || "",
    assetSize: asset?.size || 0,
    downloadUrl: asset?.browser_download_url || "",
    htmlUrl: data.html_url || "",
  };
}

/**
 * 下载并应用更新。
 *
 * 替换策略：Linux 下用 mv（rename）覆盖正在运行的可执行文件不会触发 ETXTBSY，
 * 旧 inode 由运行中的进程继续持有；替换完成后本进程主动退出，
 * 由 systemd 的 Restart=always 拉起新版本，因此**不需要 root 权限**。
 */
export async function performUpdate(): Promise<{ message: string; inProgress?: boolean }> {
  if (updateState.phase === "downloading" || updateState.phase === "extracting" || updateState.phase === "replacing") {
    // 已在更新中：正常返回（而非抛错），让前端接管轮询显示进度
    return { message: "更新正在进行中", inProgress: true };
  }

  // 同步置为“进行中”：apply 接口已改为后台执行并立即返回，必须让状态端点在此刻就反映更新已开始，
  // 否则前端点完按钮、轮询首次取状态时仍是 idle，进度条要等下一次轮询才出现（表现为“点了没反应”）。
  setState("downloading", "正在准备更新...", 0);

  const info = await checkForUpdate();
  if (!info.hasUpdate) {
    setState("done", "当前已是最新版本", 100);
    return { message: "当前已是最新版本" };
  }
  if (!info.downloadUrl) throw new Error("该 Release 没有可下载的 zip 附件");

  const updateDir = getUpdateDir();
  fs.mkdirSync(updateDir, { recursive: true });
  const zipPath = path.join(updateDir, `${ASSET_APP_NAME}-${info.latestVersion}.zip`);

  // 1. 下载（流式读取，实时上报进度 5% → 40%；直连失败自动回退镜像）
  setState("downloading", `正在下载 v${info.latestVersion}...`, 5);
  const candidates = getDownloadCandidates(info.downloadUrl);
  let lastErr = "";
  let downloaded = false;
  for (let ci = 0; ci < candidates.length; ci++) {
    const url = candidates[ci];
    const viaMirror = ci > 0;
    try {
      const res = await fetch(url, {
        headers: ghHeaders(),
        signal: AbortSignal.timeout(600000), // 40MB 包，给足 10 分钟
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const total = parseInt(res.headers.get("content-length") || "0", 10);
      const chunks: Buffer[] = [];
      let received = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(Buffer.from(value));
            received += value.byteLength;
            if (total > 0) {
              const pct = Math.min(40, 5 + Math.floor((received / total) * 35));
              setState(
                "downloading",
                `正在下载 v${info.latestVersion}（${viaMirror ? "镜像" : "直连"}）... ${(received / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`,
                pct
              );
            } else {
              setState("downloading", `正在下载 v${info.latestVersion}（${viaMirror ? "镜像" : "直连"}）... ${(received / 1024 / 1024).toFixed(1)} MB`, 35);
            }
          }
        }
      } else {
        const ab = Buffer.from(await res.arrayBuffer());
        chunks.push(ab);
        received = ab.length;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < 1024 * 1024) throw new Error(`下载内容异常（仅 ${buf.length} 字节）`);
      fs.writeFileSync(zipPath, buf);
      setState("downloading", `下载完成（${(buf.length / 1024 / 1024).toFixed(1)} MB${viaMirror ? "，经镜像" : ""}）`, 40);
      downloaded = true;
      break;
    } catch (e: any) {
      lastErr = e.message;
      if (ci < candidates.length - 1) {
        setState("downloading", `直连失败（${e.message}），尝试镜像...`, 5);
        continue;
      }
    }
  }
  if (!downloaded) {
    setState("error", "下载失败", 40, lastErr);
    throw new Error(`下载失败：${lastErr}`);
  }

  // 2. 解压
  setState("extracting", "正在解压...", 50);
  const extractDir = path.join(updateDir, `extract-${info.latestVersion}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    extractZip(zipPath, extractDir);
  } catch (e: any) {
    setState("error", "解压失败", 55, e.message);
    throw new Error(`解压失败：${e.message}`);
  }

  // 3. 定位并校验新二进制
  const newBinary = path.join(extractDir, BINARY_IN_ZIP);
  if (!fs.existsSync(newBinary)) {
    const msg = `压缩包内未找到 ${BINARY_IN_ZIP}`;
    setState("error", msg, 60, msg);
    throw new Error(msg);
  }
  const newSize = fs.statSync(newBinary).size;
  if (newSize < MIN_BINARY_SIZE) {
    const msg = `新二进制体积异常（${(newSize / 1024 / 1024).toFixed(1)} MB），已中止`;
    setState("error", msg, 60, msg);
    throw new Error(msg);
  }

  // 4. 替换（mv 不触发 ETXTBSY）+ 备份旧版本
  setState("replacing", "正在替换二进制...", 75);
  const installDir = getInstallDir();
  const target = path.join(installDir, ASSET_APP_NAME);
  try {
    if (fs.existsSync(target)) {
      fs.cpSync(target, path.join(updateDir, `${ASSET_APP_NAME}.bak.${CURRENT_VERSION}`));
    }
    fs.renameSync(newBinary, target); // rename 语义，可覆盖正在运行的可执行文件
    try { fs.chmodSync(target, 0o755); } catch { /* 部分文件系统不支持则忽略 */ }
    fs.writeFileSync(
      path.join(updateDir, "last-update.json"),
      JSON.stringify({ version: info.latestVersion, appliedAt: new Date().toISOString() }, null, 2)
    );
  } catch (e: any) {
    const hint = /EACCES|EPERM|EROFS/.test(e.message)
      ? `${e.message}（安装目录不可写，请确认服务已配置该目录的写权限）`
      : e.message;
    setState("error", "替换失败", 80, hint);
    throw new Error(`替换失败：${hint}`);
  }

  // 5. 清理并安排重启：先返回响应，稍后退出由 systemd 拉起新版本
  setState("done", `已更新到 v${info.latestVersion}，正在重启服务...`, 100);
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }

  setTimeout(() => {
    console.log(`[updater] 更新完成，退出进程等待 systemd 重启（v${CURRENT_VERSION} → v${info.latestVersion}）`);
    process.exit(0);
  }, 1500);

  return { message: `已更新到 v${info.latestVersion}，服务即将重启` };
}

/** 解压 zip：优先 python3（服务器上通常存在），失败回退 unzip */
function extractZip(zipPath: string, destDir: string): void {
  const py = spawnSync(
    "python3",
    ["-c", `import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])`, zipPath, destDir],
    { encoding: "utf-8" }
  );
  if (py.status === 0) return;

  const uz = spawnSync("unzip", ["-o", "-q", zipPath, "-d", destDir], { encoding: "utf-8" });
  if (uz.status === 0) return;

  const pyErr = py.error ? py.error.message : (py.stderr || "").trim();
  const uzErr = uz.error ? uz.error.message : (uz.stderr || "").trim();
  throw new Error(`python3: ${pyErr || "不可用"}；unzip: ${uzErr || "不可用"}`);
}
