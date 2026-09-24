import type { DockerEngine, EngineResourceStats, ResourceSample, SystemSettings, SchedulerStatus, SchedulerLastResult, ImageUpdateSummaryView, DockerNetwork, NetworkCreateOptions } from "./types";

const BASE = "/api";

/**
 * 带业务错误码的 API 错误。
 * code 由后端返回（如 IMAGE_REFERENCED），前端据此决定处置方式
 * （例如镜像删除冲突时是否提供「强制删除」）。
 */
export class ApiError extends Error {
  code?: string;
  statusCode?: number;

  constructor(message: string, code?: string, statusCode?: number) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    ...options,
  });
  // 会话失效（非鉴权接口）：通知 App 回到登录页
  if (res.status === 401 && !url.startsWith("/auth/")) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
  }
  const json = await res.json().catch(() => ({ success: false, error: "响应解析失败" }));
  if (!res.ok || !json.success) {
    throw new ApiError(json.error || "请求失败", json.code, res.status);
  }
  return json.data as T;
}

// ============ 鉴权 API ============

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

/** 是否已初始化（存在用户） */
export function getAuthInitStatus(): Promise<{ initialized: boolean }> {
  return request<{ initialized: boolean }>("/auth/init-status");
}

/** 首次部署创建管理员账号（recoveryCode 可选，留空可后续在设置页补设） */
export function initAccount(
  username: string,
  password: string,
  recoveryCode?: string
): Promise<AuthUser> {
  return request<AuthUser>("/auth/init", {
    method: "POST",
    body: JSON.stringify({ username, password, recoveryCode }),
  });
}

/** 登录 */
export function login(username: string, password: string): Promise<AuthUser> {
  return request<AuthUser>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

/** 登出 */
export function logout(): Promise<void> {
  return request<void>("/auth/logout", { method: "POST" });
}

/** 当前登录用户 */
export function getMe(): Promise<AuthUser> {
  return request<AuthUser>("/auth/me");
}

// ---------- 遥测（安装量与活跃度，仅上报端） ----------

/** 本机设备标识的 6 维硬件属性（与后端 telemetry.ts 同构） */
export interface DeviceHardware {
  /** 系统（安装的操作系统 + 版本） */
  system: string;
  /** CPU 标识 */
  cpu: string;
  /** GPU 标识 */
  gpu: string;
  /** 内存标识（容量 + 序列号） */
  memory: string;
  /** 硬盘序列号 */
  diskUid: string;
  /** 主板序列号 */
  boardSerial: string;
}

/** 设备标识卡片展示用的富硬件详情（与后端 telemetry.ts 同构） */
export interface DeviceDetails {
  cpu: { model: string; cores: number; threads: number; freqGHz: number };
  gpu: { model: string; memory: string };
  memory: { model: string; sizeGB: number };
  disk: { serial: string; model: string; size: string };
  /** DMI 标识字段（只读展示，不参与指纹）：主板型号 / 产品序列号 / 系统 UUID */
  dmi: { boardName: string; productSerial: string; productUuid: string };
}

export interface TelemetryStatus {
  /** 设备标识（硬件指纹 6 维哈希，统计主键） */
  deviceId: string;
  virtualized: boolean;
  createdAt: string;
  appVersion: string;
  osVersion: string;
  arch: string;
  deviceFile: string;
  /** 硬件环境是否未变化（设备指纹稳定） */
  envUnchanged: boolean;
  /** 已识别的硬件维度数（0-6） */
  matchCount: number;
  /** 本机设备标识 6 维 */
  hardware: DeviceHardware;
  /** 设备标识卡片展示用的富硬件详情 */
  details: DeviceDetails;
}

/** 远端统计服务端聚合数据（服务端未就绪时为 null） */
export interface TelemetryStats {
  /** 安装总次数（含重装） */
  installs: number;
  /** 新增设备数（按硬件指纹 device_uuid 去重） */
  newDevices: number;
  /** 日活 */
  dau: number;
  /** 月活 */
  mau: number;
  /** 近 N 日趋势 */
  trend?: { date: string; dau: number; installs: number }[];
}

/** 本机设备标识与上报状态 */
export function fetchTelemetryStatus(): Promise<TelemetryStatus> {
  return request<TelemetryStatus>("/telemetry/status");
}

/** 立即上报一次（force=true，忽略当日已报） */
export function reportTelemetryNow(): Promise<{
  sent: string[];
  error?: string;
  status: TelemetryStatus;
}> {
  return request("/telemetry/report", { method: "POST" });
}

/** 拉取统计服务端聚合数据（后端代理，未就绪返回 null） */
export function fetchTelemetryStats(): Promise<TelemetryStats | null> {
  return request<TelemetryStats | null>("/telemetry/stats");
}

/**
 * systemd 服务单元一致性（部署提示用）。
 * 单元文件由 install.sh 安装、OTA 不更新，落后时依赖新指令的功能会静默失效。
 */
export interface ServiceUnitStatus {
  /** 是否适用（Linux 且已安装单元；Windows / 容器下为 false） */
  applicable: boolean;
  unitName: string;
  unitPath: string;
  exists: boolean;
  /** 已安装单元 + drop-in 缺失的指令（空数组 = 一致） */
  missing: string[];
  /** 已加载的 drop-in 文件名 */
  dropIns: string[];
  /** DMI 镜像目录及其中的文件 */
  mirrorDir: string;
  mirrorFiles: string[];
  /** 已安装单元是否覆盖模板全部指令 */
  upToDate: boolean;
  /** 一键修复命令（多行，含 sudo） */
  fixCommand: string;
}

/** 查询 systemd 服务单元是否与当前二进制内置模板一致 */
export function fetchServiceUnitStatus(): Promise<ServiceUnitStatus> {
  return request<ServiceUnitStatus>("/system/service-unit");
}

/** 修改当前用户密码（单管理员：必须校验原密码） */
export function changeMyPassword(oldPassword: string, newPassword: string): Promise<void> {
  return request<void>("/auth/password", {
    method: "POST",
    body: JSON.stringify({ oldPassword, newPassword }),
  });
}

// ============ 密码找回码 ============

export interface RecoveryStatus {
  /** 找回码要求的长度（位） */
  length: number;
  hasRecovery: boolean;
  setAt: string | null;
  lastUsedAt: string | null;
  /** 距下次可使用还需等待的毫秒数（0 = 立即可用） */
  cooldownRemainingMs: number;
}

/** 找回码状态（不回显明文） */
export function getRecoveryStatus(): Promise<RecoveryStatus> {
  return request<RecoveryStatus>("/auth/recovery");
}

/** 设置/重设找回码（需当前密码） */
export function setRecoveryCode(code: string, password: string): Promise<void> {
  return request<void>("/auth/recovery", {
    method: "POST",
    body: JSON.stringify({ code, password }),
  });
}

/** 清除找回码 */
export function clearRecoveryCode(): Promise<void> {
  return request<void>("/auth/recovery", { method: "DELETE" });
}

/** 通过找回码重置密码（无需登录；两次使用间隔 10 分钟） */
export function resetPasswordByRecovery(
  username: string,
  code: string,
  newPassword: string
): Promise<void> {
  return request<void>("/auth/reset-by-recovery", {
    method: "POST",
    body: JSON.stringify({ username, code, newPassword }),
  });
}

// ============ 引擎 API ============

export function fetchEngines(): Promise<DockerEngine[]> {
  return request<DockerEngine[]>("/engines");
}

/** 获取当前活跃引擎 ID */
export function fetchActiveEngineId(): Promise<string> {
  return request<{ activeEngineId: string }>("/engines/active").then(
    (res) => res.activeEngineId
  );
}

/** 设置当前活跃引擎 */
export function setActiveEngineIdApi(
  activeEngineId: string
): Promise<{ activeEngineId: string }> {
  return request<{ activeEngineId: string }>("/engines/active", {
    method: "PUT",
    body: JSON.stringify({ activeEngineId }),
  });
}

export function createEngine(data: {
  name: string;
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  sshHost?: string;
  sshPort?: number;
  sshUsername?: string;
  sshAuthType?: "password" | "key";
  sshPassword?: string;
  sshKey?: string;
  sshPassphrase?: string;
}): Promise<DockerEngine> {
  return request<DockerEngine>("/engines", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function renameEngine(id: string, name: string): Promise<DockerEngine> {
  return request<DockerEngine>(`/engines/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function deleteEngine(id: string): Promise<void> {
  return request<void>(`/engines/${id}`, { method: "DELETE" });
}

export function testEngineConnection(id: string): Promise<DockerEngine> {
  return request<DockerEngine>(`/engines/${id}/connect`, { method: "POST" });
}

export function refreshAllEngines(): Promise<DockerEngine[]> {
  return request<DockerEngine[]>("/engines/refresh", { method: "POST" });
}

// ============ 引擎数据 API ============

/** 获取引擎系统信息 */
export function fetchEngineInfo(engineId: string): Promise<any> {
  return request<any>(`/engines/${engineId}/info`);
}

/** 获取容器列表（原始 dockerode 数据） */
export function fetchEngineContainers(engineId: string): Promise<any[]> {
  return request<any[]>(`/engines/${engineId}/containers`);
}

/** 获取镜像列表（原始 dockerode 数据） */
export function fetchEngineImages(engineId: string): Promise<any[]> {
  return request<any[]>(`/engines/${engineId}/images`);
}

/** 获取数据卷列表（原始 dockerode 数据） */
export function fetchEngineVolumes(engineId: string): Promise<any> {
  return request<any>(`/engines/${engineId}/volumes`);
}

/** 获取堆栈列表 */
export function fetchEngineStacks(engineId: string): Promise<any[]> {
  return request<any[]>(`/engines/${engineId}/stacks`);
}

/** 获取容器日志 */
export function fetchContainerLogs(engineId: string, containerId: string, tail: number = 200): Promise<string[]> {
  return request<string[]>(`/engines/${engineId}/containers/${containerId}/logs?tail=${tail}`);
}

/** 获取容器资源监控 */
export function fetchContainerStats(engineId: string, containerId: string): Promise<{
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  netInput: number;
  netOutput: number;
  blockInput: number;
  blockOutput: number;
}> {
  return request(`/engines/${engineId}/containers/${containerId}/stats`);
}

/** 获取引擎资源汇总（仪表盘资源监控） */
export function fetchEngineResourceStats(engineId: string): Promise<EngineResourceStats> {
  return request<EngineResourceStats>(`/engines/${engineId}/resource-stats`);
}

/** 获取资源时间序列（仪表盘内存 / 网络折线图；range: 10s|30s|1m|2m|5m） */
export function fetchResourceHistoryApi(engineId: string, range = "5m"): Promise<ResourceSample[]> {
  return request<ResourceSample[]>(`/engines/${engineId}/resource-history?range=${range}`);
}

// ============ 容器操作 API ============

export function containerActionApi(engineId: string, containerId: string, action: "start" | "stop" | "restart" | "pause" | "unpause"): Promise<void> {
  return request<void>(`/engines/${engineId}/containers/${containerId}/${action}`, { method: "POST" });
}

export function removeContainerApi(engineId: string, containerId: string, force?: boolean): Promise<void> {
  return request<void>(`/engines/${engineId}/containers/${containerId}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

// ============ 镜像操作 API ============

export function removeImageApi(engineId: string, imageId: string, force?: boolean): Promise<void> {
  return request<void>(`/engines/${engineId}/images/${encodeURIComponent(imageId)}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export function pruneImagesApi(engineId: string, all: boolean = false): Promise<any> {
  return request<any>(`/engines/${engineId}/images/prune`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all }),
  });
}

// ============ 镜像拉取任务 API ============

/** 发起镜像拉取（后台任务，立即返回任务信息） */
export function startImagePullApi(engineId: string, image: string): Promise<import("./types").PullTask> {
  return request<import("./types").PullTask>(`/engines/${engineId}/images/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
  });
}

/** 获取引擎的全部拉取任务（含进行中与最近完成） */
export function fetchPullTasksApi(engineId: string): Promise<import("./types").PullTask[]> {
  return request<import("./types").PullTask[]>(`/engines/${engineId}/images/pull-tasks`);
}

/** 获取单个拉取任务详情（层进度 + 输出行） */
export function fetchPullTaskApi(engineId: string, taskId: string): Promise<import("./types").PullTask> {
  return request<import("./types").PullTask>(`/engines/${engineId}/images/pull-tasks/${taskId}`);
}

/** 取消拉取任务 */
export function cancelPullTaskApi(engineId: string, taskId: string): Promise<import("./types").PullTask> {
  return request<import("./types").PullTask>(`/engines/${engineId}/images/pull-tasks/${taskId}/cancel`, { method: "POST" });
}

/** 手动清理单个拉取任务（前后端同时移除） */
export function removePullTaskApi(engineId: string, taskId: string): Promise<void> {
  return request<void>(`/engines/${engineId}/images/pull-tasks/${taskId}`, { method: "DELETE" });
}

/** 导出镜像为 tar 并触发浏览器下载（返回实际文件名） */
export function downloadImageApi(engineId: string, imageRef: string): Promise<string> {
  return downloadAsBlob(
    `/engines/${encodeURIComponent(engineId)}/images/save?image=${encodeURIComponent(imageRef)}`
  );
}

/** 导入镜像的进度回调集合 */
export interface ImageImportHandlers {
  /** 请求体（tar）上传进度；不可计算时 total 为 0 */
  onUploadProgress?: (sent: number, total: number) => void;
  /** tar 上传完毕，服务端进入 docker load 解包阶段 */
  onUploadDone?: () => void;
  /** docker load 新产出的输出行（一次可能多条） */
  onLoadOutput?: (lines: string[]) => void;
}

/**
 * 上传镜像 tar 并导入（服务端流式管道进 docker load），全程回报进度。
 *
 * 为什么用 XMLHttpRequest 而不是 fetch：
 * 1) 只有 `upload.onprogress` 能拿到「已上传字节」——fetch 观测不到请求体上传进度
 *    （`ReadableStream` 请求体 + `duplex:"half"` 在 Safari/Firefox 不可用）；
 * 2) 响应体是服务端逐行下发的 NDJSON（见 server/index.ts），XHR 在 readyState=3
 *    阶段即可增量读取 `responseText`，从而实时呈现 `docker load` 的解包进度。
 *
 * 显式声明 application/octet-stream，避免被全局 express.json 中间件按 JSON 解析/缓冲。
 */
export function uploadImageApi(
  engineId: string,
  file: File,
  handlers: ImageImportHandlers = {},
  signal?: AbortSignal
): Promise<{ output: string; images: string[] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/engines/${encodeURIComponent(engineId)}/images/load`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.responseType = "text";

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // NDJSON 增量解析：只处理完整行，半行留在 pending 等下一帧（否则行会被腰斩成非法 JSON）
    let consumed = 0;
    let pending = "";
    const drain = () => {
      const text = xhr.responseText || "";
      if (text.length <= consumed) return;
      pending += text.slice(consumed);
      consumed = text.length;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      const lines: string[] = [];
      for (const raw of parts) {
        const s = raw.trim();
        if (!s) continue;
        let msg: any;
        try {
          msg = JSON.parse(s);
        } catch {
          continue; // 非 JSON 行（反代注入等）忽略
        }
        if (msg?.type === "progress" && typeof msg.line === "string") {
          lines.push(msg.line);
        } else if (msg?.type === "done") {
          finish(() =>
            resolve({
              output: msg.output || "导入完成",
              images: Array.isArray(msg.images) ? msg.images : [],
            })
          );
        } else if (msg?.type === "error") {
          finish(() => reject(new ApiError(msg.error || "导入失败")));
        }
      }
      if (lines.length) handlers.onLoadOutput?.(lines);
    };

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) handlers.onUploadProgress?.(e.loaded, e.total);
    };
    xhr.upload.onload = () => {
      handlers.onUploadProgress?.(file.size, file.size);
      handlers.onUploadDone?.();
    };
    xhr.onprogress = drain;
    xhr.onload = () => {
      drain();
      if (settled) return;
      // 鉴权失败发生在路由之前，是普通 JSON 响应（非 NDJSON）
      if (xhr.status === 401) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:unauthorized"));
        finish(() => reject(new ApiError("会话已失效，请重新登录", undefined, 401)));
        return;
      }
      finish(() => {
        let parsed: any = null;
        try {
          parsed = JSON.parse(xhr.responseText || "");
        } catch {
          /* NDJSON 流整体必然不是合法 JSON，属预期 */
        }
        if (parsed?.error) {
          reject(new ApiError(parsed.error, parsed.code, xhr.status));
          return;
        }
        if (xhr.status >= 400) {
          reject(new ApiError(`导入失败（HTTP ${xhr.status}）`, undefined, xhr.status));
          return;
        }
        reject(new ApiError("导入中断：未收到服务端完成确认"));
      });
    };
    xhr.onerror = () => finish(() => reject(new ApiError("网络错误：上传失败或连接中断")));
    xhr.onabort = () => finish(() => reject(new ApiError("已取消导入")));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

// ============ 数据卷操作 API ============

export function removeVolumeApi(engineId: string, volumeName: string, force?: boolean): Promise<void> {
  return request<void>(`/engines/${engineId}/volumes/${encodeURIComponent(volumeName)}${force ? "?force=true" : ""}`, { method: "DELETE" });
}

export function pruneVolumesApi(engineId: string): Promise<any> {
  return request<any>(`/engines/${engineId}/volumes/prune`, { method: "POST" });
}

export function createVolumeApi(engineId: string, name: string, driver: string): Promise<any> {
  return request<any>(`/engines/${engineId}/volumes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, driver }),
  });
}

// ============ 网络管理 API ============

/** 获取网络列表（含关联容器与其累计收发字节） */
export function fetchNetworksApi(engineId: string): Promise<DockerNetwork[]> {
  return request<DockerNetwork[]>(`/engines/${engineId}/networks`);
}

/** 创建网络 */
export function createNetworkApi(engineId: string, opts: NetworkCreateOptions): Promise<any> {
  return request<any>(`/engines/${engineId}/networks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

/** 编辑网络（后端 = 删除后用相同配置重建，保留原名称） */
export function editNetworkApi(engineId: string, netId: string, opts: NetworkCreateOptions): Promise<any> {
  return request<any>(`/engines/${engineId}/networks/${encodeURIComponent(netId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
}

/** 删除网络 */
export function removeNetworkApi(engineId: string, netId: string): Promise<void> {
  return request<void>(`/engines/${engineId}/networks/${encodeURIComponent(netId)}`, { method: "DELETE" });
}

/** 创建堆栈（仅写入 compose 文件，不自动启动） */
export function createStackApi(engineId: string, name: string, description: string, composeContent: string): Promise<any> {
  return request<any>(`/engines/${engineId}/stacks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, composeContent }),
  });
}

/** 从上传的「堆栈备份」zip 初始化一个新堆栈（name 为新堆栈名，避免与现有冲突） */
export async function createStackFromBackupApi(
  engineId: string,
  name: string,
  file: File
): Promise<{ name: string; path: string }> {
  const res = await fetch(`${BASE}/engines/${engineId}/stacks/from-backup?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.success) {
    throw new Error(json.error || "创建失败");
  }
  return json.data;
}

// ============ 堆栈操作 API ============

/** 堆栈操作（up/down/pull/restart/build） */
export function stackActionApi(engineId: string, stackName: string, action: "up" | "down" | "pull" | "restart" | "build"): Promise<string> {
  return request<string>(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/${action}`, { method: "POST" });
}

/**
 * 堆栈操作（SSE 流式实时进度）：点击操作后立即建立 EventSource，
 * 后端边执行 compose 边推送输出块。steps 支持多步组合（如 ["pull", "up"]）。
 * 返回关闭函数（组件卸载时调用，避免泄漏）。
 */
export function streamStackActions(
  engineId: string,
  stackName: string,
  steps: ("up" | "down" | "pull" | "restart" | "build")[],
  handlers: { onChunk: (text: string) => void; onDone: (output: string) => void; onFail: (detail: string) => void }
): () => void {
  const url = `/api/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/actions/stream?steps=${steps.join(",")}`;
  const es = new EventSource(url);
  // 动作类连接不允许 EventSource 自动重连（重连会重新执行操作），出错即终止并报失败
  let finished = false;
  const finish = (fn: () => void) => {
    if (finished) return;
    finished = true;
    es.close();
    fn();
  };
  es.addEventListener("chunk", (e) => {
    try { handlers.onChunk(JSON.parse((e as MessageEvent).data)); } catch { /* ignore */ }
  });
  es.addEventListener("done", (e) => {
    finish(() => {
      let output = "";
      try { output = JSON.parse((e as MessageEvent).data); } catch { /* ignore */ }
      handlers.onDone(output);
    });
  });
  es.addEventListener("fail", (e) => {
    finish(() => {
      let detail = "操作失败";
      try { detail = JSON.parse((e as MessageEvent).data); } catch { /* ignore */ }
      handlers.onFail(detail);
    });
  });
  es.onerror = () => {
    // 服务器正常 end 后 EventSource 也会触发 error；仅在未收到 done/fail 时视为中断
    finish(() => handlers.onFail("连接中断，操作状态未知（请刷新列表确认）"));
  };
  return () => { finished = true; es.close(); };
}

/** 删除堆栈（返回 docker compose down 命令输出） */
export function removeStackApi(engineId: string, stackName: string, removeVolumes?: boolean, removeFiles?: boolean): Promise<string> {
  const params = new URLSearchParams();
  if (removeVolumes) params.set("removeVolumes", "true");
  if (removeFiles === false) params.set("removeFiles", "false");
  const qs = params.toString();
  return request<string>(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}${qs ? `?${qs}` : ""}`, { method: "DELETE" });
}

/** 保存堆栈 compose 文件 */
export function saveStackComposeApi(engineId: string, stackName: string, composeContent: string): Promise<void> {
  return request<void>(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/compose`, {
    method: "PUT",
    body: JSON.stringify({ composeContent }),
  });
}

/** 保存堆栈环境变量（原始文本） */
export function saveStackEnvApi(engineId: string, stackName: string, envContent: string): Promise<void> {
  return request<void>(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/env`, {
    method: "PUT",
    body: JSON.stringify({ envContent }),
  });
}

/** 保存堆栈设置 */
export function saveStackSettingsApi(engineId: string, stackName: string, settings: any): Promise<void> {
  return request<void>(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/settings`, {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** 上传堆栈图标（本地图片） */
export async function uploadStackIconApi(engineId: string, stackName: string, file: File): Promise<string> {
  const res = await fetch(`${BASE}/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/icon`, {
    method: "POST",
    headers: { "Content-Type": file.type || "image/png" },
    body: file,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error || "图标上传失败");
  }
  return json.data.iconUrl as string;
}

/** 检查堆栈更新 */
export function checkStackUpdatesApi(engineId: string, stackName?: string): Promise<{ stackName: string; containers: { name: string; hasUpdate: boolean }[] }[]> {
  return request(`/engines/${engineId}/stacks/check-updates`, {
    method: "POST",
    body: JSON.stringify({ stackName }),
  });
}

/** 获取更新调度器状态（上次/下次检查时间、统计） */
export function getSchedulerStatusApi(): Promise<SchedulerStatus> {
  return request("/update-scheduler/status");
}

/** 立即触发一次镜像更新检查（全部引擎） */
export function runSchedulerCheckApi(): Promise<SchedulerLastResult> {
  return request("/update-scheduler/check-now", { method: "POST" });
}

/** 检查某引擎镜像的版本更新；ref 传 repo:tag 时只检查该镜像 */
export function checkImageUpdatesApi(engineId: string, ref?: string): Promise<ImageUpdateSummaryView> {
  return request(`/engines/${engineId}/images/check-updates`, {
    method: "POST",
    body: JSON.stringify({ ref }),
  });
}

/** 读取某引擎最近一次镜像更新检查结果（未检查过返回 null） */
export function getImageUpdateStatusApi(engineId: string): Promise<ImageUpdateSummaryView | null> {
  return request(`/engines/${engineId}/images/update-status`);
}

/** 备份堆栈 */
export function backupStackApi(engineId: string, stackName: string): Promise<{ backupName: string }> {
  return request(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/backup`, { method: "POST" });
}

/** 恢复堆栈 */
export function restoreStackApi(engineId: string, stackName: string, backupName: string): Promise<void> {
  return request(`/engines/${engineId}/stacks/${encodeURIComponent(stackName)}/restore`, {
    method: "POST",
    body: JSON.stringify({ backupName }),
  });
}

// ============ 备份文件 API ============

/** 备份文件信息（DATA_DIR/backups 下的 .zip；历史 .tar.gz 仍会列出） */
export interface BackupFileInfo {
  name: string;
  size: number; // 字节
  mtime: string; // ISO 时间
}

/** 备份文件列表（与引擎无关，均为本机备份） */
export function fetchBackupsApi(): Promise<BackupFileInfo[]> {
  return request("/backups");
}

/** 单条权限问题诊断（后端 PermIssue，用于自解释提示与一键复制修复命令） */
export interface PermIssue {
  /** 相对展示路径，如 qinglong/.stack-meta.json */
  relPath: string;
  /** 绝对路径（可直接粘贴进终端） */
  absPath: string;
  code: string; // EACCES / EPERM
  scope: "self" | "parent";
  mode: string; // 八进制权限位，如 "600"
  uid: number;
  gid: number;
  owner: string;
  targetUid: number;
  targetUser: string;
  procUid: number;
  procUser: string;
  /** 人类可读的判定原因 */
  reason: string;
  /** 可直接复制的修复命令 */
  advice: string;
  /** 本次备份是否已自动修复 */
  autoFixed: boolean;
}

/** 立即备份的返回：skipped 为人类可读摘要，skippedDetails 为结构化诊断，fixed 为备份期自动修复项 */
export interface BackupCreateResult {
  backupName: string;
  size: number;
  skipped: string[];
  skippedDetails?: PermIssue[];
  fixed?: PermIssue[];
  /** 唯一的修复入口命令（检查 + 修复一步完成），服务端给出真实绝对路径 */
  fixCommand?: string;
}

/** 立即备份（全量：compose 堆栈 + 设置 + 引擎） */
export function createBackupApi(): Promise<BackupCreateResult> {
  return request("/backups", { method: "POST" });
}

/** 权限体检结果（只读扫描 compose 目录） */
export interface PermCheckResult {
  ok: boolean;
  checked: number;
  issues: PermIssue[];
  targetUid: number;
  targetUser: string;
  composeDir: string;
  /** 唯一的修复入口命令（检查 + 修复一步完成），服务端给出真实绝对路径 */
  fixCommand: string;
}

/** 权限体检（refresh=true 跳过 60s 缓存） */
export function checkPermissionsApi(refresh = false): Promise<PermCheckResult> {
  return request(`/system/permission-check${refresh ? "?refresh=1" : ""}`);
}

/** 从全量备份恢复（覆盖堆栈与设置/引擎文件） */
export function restoreBackupApi(backupName: string): Promise<{ message: string; stacks: number }> {
  return request(`/backups/${encodeURIComponent(backupName)}/restore`, { method: "POST" });
}

/** 上传本地备份文件并直接恢复（无需先存入备份列表；后端校验 zip 与 manifest） */
export async function restoreUploadedBackupApi(file: File): Promise<{ message: string; stacks: number }> {
  const res = await fetch(`${BASE}/backups/restore-upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.success) {
    throw new Error(json.error || "恢复失败");
  }
  return json.data;
}

/** 删除备份文件 */
export function deleteBackupApi(backupName: string): Promise<void> {
  return request(`/backups/${encodeURIComponent(backupName)}`, { method: "DELETE" });
}

/**
 * 从 Content-Disposition 头解析服务端建议的文件名。
 * 优先取 RFC 5987 的 filename*=UTF-8''（非 ASCII 名），退化到普通 filename=。
 */
function parseContentDispositionFilename(disposition: string | null): string {
  if (!disposition) return "";
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* 解析失败则回退到普通 filename */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain ? plain[1].trim() : "";
}

/** 用 objectURL 触发浏览器下载（与容器 CSV 导出保持同一套写法） */
function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 立即 revoke 会让部分浏览器来不及读取，延迟释放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 下载服务端文件为浏览器下载（fetch → Blob → objectURL）。
 *
 * 为何不用 `<a href="/api/...">` 直连：那会让浏览器对 API 地址发起「顶层导航」，
 * 请求失败（401/500、反向代理拦截、iframe 沙箱禁止下载）时用户只会看到“点了没反应”，
 * 拿不到任何错误信息。改走 fetch 后与其它接口共用同一条鉴权链路（credentials: include），
 * 且能读取错误 JSON 抛出可展示的 ApiError。
 */
async function downloadAsBlob(url: string): Promise<string> {
  const res = await fetch(`${BASE}${url}`, { credentials: "include" });
  if (res.status === 401 && !url.startsWith("/auth/")) {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("auth:unauthorized"));
    }
    throw new ApiError("未登录或会话已过期", undefined, 401);
  }
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    throw new ApiError(json?.error || `下载失败（HTTP ${res.status}）`, json?.code, res.status);
  }
  const blob = await res.blob();
  const filename = parseContentDispositionFilename(res.headers.get("content-disposition"));
  triggerBlobDownload(blob, filename);
  return filename;
}

/** 下载指定备份文件（返回实际文件名） */
export function downloadBackupApi(backupName: string): Promise<string> {
  return downloadAsBlob(`/backups/${encodeURIComponent(backupName)}/download`);
}

/** 导出全部配置（下载归档，返回实际文件名） */
export function exportConfigApi(): Promise<string> {
  return downloadAsBlob("/backups/export");
}

/** 批量操作堆栈（返回每个堆栈的成功/失败与命令输出） */
export function batchStackActionApi(engineId: string, action: "up" | "down" | "restart" | "pull" | "delete", stackNames: string[]): Promise<{ stackName: string; success: boolean; output?: string; error?: string }[]> {
  return request(`/engines/${engineId}/stacks/batch/${action}`, {
    method: "POST",
    body: JSON.stringify({ stackNames }),
  });
}

/** 获取活动日志 */
export function fetchEngineActivity(engineId: string): Promise<any[]> {
  return request<any[]>(`/engines/${engineId}/activity`);
}

// ============ 系统设置 API ============

/** 获取系统设置 */
export function fetchSettings(): Promise<SystemSettings> {
  return request<SystemSettings>("/settings");
}

/** 保存系统设置 */
export function saveSettingsApi(settings: SystemSettings): Promise<SystemSettings> {
  return request<SystemSettings>("/settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

/** 检测服务器上可用的 Compose 命令 */
export function detectComposeModes(): Promise<{ plugin: boolean; standalone: boolean }> {
  return request<{ plugin: boolean; standalone: boolean }>("/compose-modes");
}

/** 提权方式：root 直接执行 / sudo -n 免密 / 无能力 */
export type ElevateMode = "root" | "sudo" | "none";

/** 宿主机 /etc/docker/daemon.json 的内容与读写能力 */
export interface DaemonConfigInfo {
  path: string;
  exists: boolean;
  /** 运行本服务的系统用户 */
  runAs: string;
  isRoot: boolean;
  sudoAvailable: boolean;
  elevate: ElevateMode;
  canRead: boolean;
  canWrite: boolean;
  canRestart: boolean;
  /** daemon.json 中的 registry-mirrors */
  registryMirrors: string[];
  /** 除 registry-mirrors 之外的配置键（写入时原样保留） */
  otherKeys: string[];
  raw: string;
  parseError?: string;
  error?: string;
  /** 无权限时的修复建议 */
  hint?: string;
}

export interface DaemonConfigWriteResult {
  ok: boolean;
  /** 内容是否变化（未变化则无需重启） */
  changed: boolean;
  backupPath?: string;
  content?: string;
  elevate?: ElevateMode;
  output?: string;
  error?: string;
  hint?: string;
}

export interface RestartDockerResult {
  ok: boolean;
  command?: string;
  output: string;
  error?: string;
}

/** 读取宿主机 Docker 守护进程配置（/etc/docker/daemon.json） */
export function fetchDaemonConfig(): Promise<DaemonConfigInfo> {
  return request<DaemonConfigInfo>("/system/daemon-config");
}

/** 重新探测提权能力（配好 sudoers 后无需重启服务） */
export function refreshDaemonPrivileges(): Promise<{
  isRoot: boolean;
  sudo: boolean;
  user: string;
  info: DaemonConfigInfo;
}> {
  return request<{ isRoot: boolean; sudo: boolean; user: string; info: DaemonConfigInfo }>(
    "/system/daemon-config/refresh-privileges",
    { method: "POST" }
  );
}

/** 写入整份 /etc/docker/daemon.json（设置页 JSON 编辑器：内容即文件内容） */
export function saveDaemonConfigContent(content: string): Promise<DaemonConfigWriteResult> {
  return request<DaemonConfigWriteResult>("/system/daemon-config", {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

/** 重启宿主机 Docker 服务 */
export function restartDockerApi(): Promise<RestartDockerResult> {
  return request<RestartDockerResult>("/system/docker/restart", { method: "POST" });
}

// ============ 系统更新（OTA） API ============

/** 获取当前应用版本与安装目录 */
export function fetchAppVersion(): Promise<{ version: string; installDir: string }> {
  return request<{ version: string; installDir: string }>("/system/version");
}

/** 检查 GitHub Releases 是否有新版本 */
export function checkUpdateApi(): Promise<import("./types").UpdateInfo> {
  return request<import("./types").UpdateInfo>("/system/update/check");
}

/** 下载并应用更新（替换二进制后进程退出，由 systemd 拉起新版本） */
export function applyUpdateApi(): Promise<{ message: string }> {
  return request<{ message: string }>("/system/update/apply", { method: "POST" });
}

/** 取消正在进行的系统升级（下载 / 解压 / 替换阶段均可；取消后状态回 idle） */
export function cancelUpdateApi(): Promise<{ message: string }> {
  return request<{ message: string }>("/system/update/cancel", { method: "POST" });
}

/** 获取更新进度（前端轮询） */
export function fetchUpdateStatusApi(): Promise<import("./types").UpdateState> {
  return request<import("./types").UpdateState>("/system/update/status");
}

/** 上传本地 zip 更新包（仅保存，不立即执行；进度由手动「更新」按钮触发） */
export interface UploadUpdateHandlers {
  /** 上传进度：已发送字节 / 总字节（来自 XMLHttpRequest.upload.onprogress，fetch 观测不到请求体上传进度） */
  onProgress?: (sent: number, total: number) => void;
}

export function uploadUpdateZipApi(
  file: File,
  handlers: UploadUpdateHandlers = {}
): Promise<{ fileName: string; size: number; uploadedAt: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE}/system/update/upload`, true);
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/zip");

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    // 上传进度：XHR 可观测请求体发送字节；fetch 不行
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) handlers.onProgress?.(e.loaded, e.total);
    };
    xhr.upload.onload = () => {
      // 发送完毕：拉满到文件总字节（避免个别浏览器 lengthComputable 缺失导致卡 99%）
      handlers.onProgress?.(file.size, file.size);
    };

    xhr.onload = () => {
      if (settled) return;
      // 鉴权失败发生在路由之前，是普通 JSON 响应（非流）
      if (xhr.status === 401) {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("auth:unauthorized"));
        finish(() => reject(new ApiError("会话已失效，请重新登录", undefined, 401)));
        return;
      }
      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* 非 JSON：走下方失败分支 */
      }
      if (xhr.status < 200 || xhr.status >= 300 || !data?.success) {
        finish(() => reject(new ApiError(data?.error || `更新包上传失败（${xhr.status}）`)));
        return;
      }
      finish(() => resolve(data.data as { fileName: string; size: number; uploadedAt: string }));
    };
    xhr.onerror = () => {
      if (settled) return;
      finish(() => reject(new ApiError("网络错误，更新包上传失败")));
    };

    xhr.send(file);
  });
}

/** 查询已上传、待应用的本地更新包 */
export function fetchPendingUploadApi(): Promise<{ exists: boolean; fileName?: string; size?: number; uploadedAt?: string; ttlMs?: number; expiresAt?: string }> {
  return request<{ exists: boolean; fileName?: string; size?: number; uploadedAt?: string; ttlMs?: number; expiresAt?: string }>("/system/update/local");
}

/** 应用已上传的本地更新包（手动「更新」按钮触发，跳过 GitHub 下载） */
export function applyLocalUpdateApi(): Promise<{ message: string }> {
  return request<{ message: string }>("/system/update/apply-local", { method: "POST" });
}

/** 主动丢弃已上传、待应用的本地更新包（手动「丢弃」或倒计时归零时调用） */
export function discardPendingUploadApi(): Promise<{ message: string }> {
  return request<{ message: string }>("/system/update/local", { method: "DELETE" });
}
