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
    ...options,
  });
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new ApiError(json.error || "请求失败", json.code, res.status);
  }
  return json.data as T;
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

export function pruneImagesApi(engineId: string): Promise<any> {
  return request<any>(`/engines/${engineId}/images/prune`, { method: "POST" });
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
