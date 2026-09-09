import type { DockerEngine, EngineResourceStats, SystemSettings } from "./types";

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

export interface TelemetryStatus {
  enabled: boolean;
  endpoint: string;
  collectHwFingerprint: boolean;
  uuid: string;
  hwFingerprintShort: string;
  virtualized: boolean;
  createdAt: string;
  installReported: boolean;
  lastActiveDate: string;
  lastReportAt?: string;
  lastError?: string;
  deviceFile: string;
  appVersion: string;
  osVersion: string;
  arch: string;
}

/** 远端统计服务端聚合数据（服务端未就绪时为 null） */
export interface TelemetryStats {
  /** 安装总次数（含重装） */
  installs: number;
  /** 新增设备数（按 device_uuid 去重） */
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

/** 创建堆栈（仅写入 compose 文件，不自动启动） */
export function createStackApi(engineId: string, name: string, description: string, composeContent: string): Promise<any> {
  return request<any>(`/engines/${engineId}/stacks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description, composeContent }),
  });
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

/** 备份文件信息（DATA_DIR/backups 下的 tar.gz） */
export interface BackupFileInfo {
  name: string;
  size: number; // 字节
  mtime: string; // ISO 时间
}

/** 备份文件列表（与引擎无关，均为本机备份） */
export function fetchBackupsApi(): Promise<BackupFileInfo[]> {
  return request("/backups");
}

/** 删除备份文件 */
export function deleteBackupApi(backupName: string): Promise<void> {
  return request(`/backups/${encodeURIComponent(backupName)}`, { method: "DELETE" });
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

/** 写回 registry-mirrors（保留 daemon.json 其它配置项） */
export function saveDaemonConfigApi(registryMirrors: string[]): Promise<DaemonConfigWriteResult> {
  return request<DaemonConfigWriteResult>("/system/daemon-config", {
    method: "PUT",
    body: JSON.stringify({ registryMirrors }),
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

/** 获取更新进度（前端轮询） */
export function fetchUpdateStatusApi(): Promise<import("./types").UpdateState> {
  return request<import("./types").UpdateState>("/system/update/status");
}

/** 上传本地 zip 更新包（仅保存，不立即执行；进度由手动「更新」按钮触发） */
export async function uploadUpdateZipApi(file: File): Promise<{ fileName: string; size: number; uploadedAt: string }> {
  const res = await fetch(`${BASE}/system/update/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: file,
  });
  const json = await res.json().catch(() => ({} as any));
  if (!res.ok || !json.success) {
    throw new Error(json.error || "更新包上传失败");
  }
  return json.data;
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
