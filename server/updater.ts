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
export function getUpdateDir(): string {
  return path.join(getInstallDir(), "data", "update");
}

/** 已上传、尚未执行的本地更新包固定文件名（重复上传覆盖旧包） */
const PENDING_ZIP = "pending-update.zip";

/** 已上传待应用（未执行）的本地更新包路径 */
export function getPendingUploadPath(): string {
  return path.join(getUpdateDir(), PENDING_ZIP);
}

/**
 * 仅保存上传的 zip 包，不执行更新（上传与应用解耦：
 * 上传后需用户手动点击「更新」按钮才应用）。固定文件名，重复上传覆盖旧包。
 */
export function saveUploadPackage(buf: Buffer): { fileName: string; size: number; uploadedAt: string } {
  if (!Buffer.isBuffer(buf) || buf.length < 1024) {
    throw new Error("未收到有效的更新包文件");
  }
  // zip 文件魔数：PK\x03\x04
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) {
    throw new Error("文件不是 zip 压缩包（应以 PK 开头）");
  }
  const zipPath = getPendingUploadPath();
  fs.mkdirSync(getUpdateDir(), { recursive: true });
  // 同步落盘（包已在前端内存中，写入量有限，且需确保后续手动「更新」前文件已就绪）
  fs.writeFileSync(zipPath, buf);
  return { fileName: PENDING_ZIP, size: buf.length, uploadedAt: new Date().toISOString() };
}

/** 待应用本地更新包自动销毁时限：上传后超过此时长仍未手动点击「更新」则自动清除 */
export const PENDING_TTL_MS = 2 * 60 * 1000;

/** 查询是否存在已上传、待应用的本地更新包 */
export function getPendingUpload(): {
  exists: boolean;
  fileName?: string;
  size?: number;
  uploadedAt?: string;
  ttlMs?: number;
  expiresAt?: string;
} {
  const zipPath = getPendingUploadPath();
  if (!fs.existsSync(zipPath)) return { exists: false };
  try {
    const st = fs.statSync(zipPath);
    const uploadedAt = st.mtime.toISOString();
    return {
      exists: true,
      fileName: PENDING_ZIP,
      size: st.size,
      uploadedAt,
      ttlMs: PENDING_TTL_MS,
      expiresAt: new Date(st.mtime.getTime() + PENDING_TTL_MS).toISOString(),
    };
  } catch {
    return { exists: false };
  }
}

/** 清除已上传待应用的更新包（正常由 applyLocalZip 在应用成功后清理；此函数仅兜底异常场景） */
export function clearPendingUpload(): void {
  try {
    fs.rmSync(getPendingUploadPath(), { force: true });
  } catch {
    /* 忽略清理失败 */
  }
}

/** 待应用包自动销毁定时器（同一时刻仅一个，重复上传会重置） */
let pendingExpiryTimer: NodeJS.Timeout | null = null;

/** 取消自动销毁定时器（不删除文件，供「更新」按钮点击、应用前调用，避免倒计时到点误删正在应用的包） */
export function cancelPendingExpiry(): void {
  if (pendingExpiryTimer) {
    clearTimeout(pendingExpiryTimer);
    pendingExpiryTimer = null;
  }
}

/** 安排待应用包自动销毁：依据 uploadedAt + TTL 计算剩余时间，到点自动清除文件（重复调用会重置定时器） */
export function schedulePendingExpiry(): void {
  cancelPendingExpiry();
  const p = getPendingUpload();
  if (!p.exists || !p.uploadedAt) return;
  const remaining = PENDING_TTL_MS - (Date.now() - new Date(p.uploadedAt).getTime());
  if (remaining <= 0) {
    clearPendingUpload();
    return;
  }
  pendingExpiryTimer = setTimeout(() => {
    clearPendingUpload();
    pendingExpiryTimer = null;
  }, remaining);
}

/** 主动丢弃待应用包（手动「丢弃」按钮或前端倒计时归零时调用）：取消定时器并删除文件 */
export function discardPendingUpload(): void {
  cancelPendingExpiry();
  clearPendingUpload();
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
  /** 已下载字节数（仅 downloading 阶段有意义） */
  bytesReceived?: number;
  /** 总字节数，Content-Length 缺失时为 0 */
  bytesTotal?: number;
  /** 当前下载速度，字节/秒（EMA 平滑） */
  speedBps?: number;
  /** 预计剩余秒数；速度未知或已完成时为 null */
  etaSeconds?: number | null;
}

let updateState: UpdateState = { phase: "idle", message: "", percent: 0 };

function setState(
  phase: UpdatePhase,
  message: string,
  percent: number,
  error?: string,
  extra?: Pick<UpdateState, "bytesReceived" | "bytesTotal" | "speedBps" | "etaSeconds">
): void {
  updateState = { phase, message, percent, ...(error ? { error } : {}), ...(extra || {}) };
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

/** 字节数转 MB 字符串（保留 1 位小数） */
function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
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
      // 速度统计：对瞬时速度做 EMA 平滑，避免数字剧烈跳动；起步阶段无 EMA 时回退到平均值
      const startedAt = Date.now();
      let lastTickAt = startedAt;
      let lastTickBytes = 0;
      let emaSpeed = 0;
      let lastReportAt = 0;
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(Buffer.from(value));
            received += value.byteLength;

            const now = Date.now();
            const dt = now - lastTickAt;
            if (dt >= 200) {
              const inst = ((received - lastTickBytes) / dt) * 1000;
              emaSpeed = emaSpeed === 0 ? inst : emaSpeed * 0.7 + inst * 0.3;
              lastTickAt = now;
              lastTickBytes = received;
            }
            const avgSpeed = (received / Math.max(1, now - startedAt)) * 1000;
            const speed = emaSpeed > 0 ? emaSpeed : avgSpeed;
            // 起步稳定期：开流瞬间常有一次性的缓冲区数据涌入，瞬时速度会虚高到几十 MB/s，
            // 直接展示会出现「剩余 1 秒」随后跳回「剩余 10 秒」的跳变，故前 1 秒不下发速度与 ETA。
            const stable = now - startedAt >= 1000;
            const speedBps = stable && speed > 0 ? Math.round(speed) : undefined;
            // 总大小未知或速度尚未测出时不预估，前端显示“计算中”
            const eta =
              speedBps !== undefined && total > 0 ? Math.max(0, Math.ceil((total - received) / speed)) : null;

            // 节流上报：前端轮询间隔 1.5s，逐 chunk 更新状态只是无谓的状态写入
            if (now - lastReportAt >= 200) {
              lastReportAt = now;
              const pct = total > 0 ? Math.min(40, 5 + Math.floor((received / total) * 35)) : 35;
              setState(
                "downloading",
                total > 0
                  ? `正在下载 v${info.latestVersion}（${viaMirror ? "镜像" : "直连"}）... ${mb(received)}/${mb(total)} MB`
                  : `正在下载 v${info.latestVersion}（${viaMirror ? "镜像" : "直连"}）... ${mb(received)} MB`,
                pct,
                undefined,
                { bytesReceived: received, bytesTotal: total, speedBps, etaSeconds: eta }
              );
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

  // 2~5. 解压 → 校验 → 替换 → 重启（与手动上传路径共用同一套逻辑）
  await applyLocalZip(zipPath, info.latestVersion, "github");

  return { message: `已更新到 v${info.latestVersion}，服务即将重启` };
}

/**
 * 应用一个本地已落盘的 zip 更新包：解压 → 校验新二进制 → 替换（备份旧版本）→ 安排 systemd 重启。
 * OTA 下载路径（performUpdate）与手动上传路径（performUpdateFromUpload）共用，避免两套解压/替换逻辑分叉。
 * @param zipPath 已落盘的更新包路径
 * @param label 进度消息里展示的来源标签（OTA 时为版本号，上传时为「本地更新包」）
 */
async function applyLocalZip(zipPath: string, label: string, source: string): Promise<void> {
  // 解压
  setState("extracting", "正在解压更新包...", 50);
  const updateDir = getUpdateDir();
  const extractDir = path.join(updateDir, `extract-${Date.now()}`);
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  try {
    extractZip(zipPath, extractDir);
  } catch (e: any) {
    setState("error", "解压失败", 55, e.message);
    throw new Error(`解压失败：${e.message}`);
  }

  // 定位并校验新二进制
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

  // 替换（mv 不触发 ETXTBSY）+ 备份旧版本
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
      JSON.stringify({ version: label, appliedAt: new Date().toISOString(), source }, null, 2)
    );
    // 清理已落盘的更新包（保留 .bak.<version> 回滚备份）
    try { fs.rmSync(zipPath, { force: true }); } catch { /* 忽略清理失败 */ }
  } catch (e: any) {
    const hint = /EACCES|EPERM|EROFS/.test(e.message)
      ? `${e.message}（安装目录不可写，请确认服务已配置该目录的写权限）`
      : e.message;
    setState("error", "替换失败", 80, hint);
    throw new Error(`替换失败：${hint}`);
  }

  // 清理并安排重启：先返回，稍后退出由 systemd 拉起新版本
  setState("done", `已应用更新包（${label}），正在重启服务...`, 100);
  try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch { /* 忽略清理失败 */ }

  setTimeout(() => {
    console.log(`[updater] 更新包应用完成，退出进程等待 systemd 重启（${label}）`);
    process.exit(0);
  }, 1500);
}

/**
 * 手动上传 zip 更新：应用已落盘的本地更新包，跳过 GitHub 下载。
 * 进度经由与 OTA 相同的 getUpdateState 通道下发，前端轮询复用同一套进度 UI。
 */
export async function performUpdateFromUpload(zipPath: string): Promise<{ message: string; inProgress?: boolean }> {
  if (updateState.phase === "downloading" || updateState.phase === "extracting" || updateState.phase === "replacing") {
    // 已在更新中：正常返回（而非抛错），让前端接管轮询显示进度
    return { message: "更新正在进行中", inProgress: true };
  }
  // 立即置为「进行中」，避免前端上传后首次轮询仍是 idle（同 apply，否则进度条迟滞）
  setState("extracting", "正在应用本地更新包...", 50);
  await applyLocalZip(zipPath, "本地更新包", "local");
  return { message: "已应用本地更新包，服务即将重启" };
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
