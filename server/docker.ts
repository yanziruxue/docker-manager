import Docker from "dockerode";
import https from "node:https";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pathPosix from "node:path/posix";
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { DockerEngine } from "./engines.js";
import { DATA_DIR, COMPOSE_DIR } from "./paths.js";
import { getSettings } from "./settings.js";

/**
 * 拼接路径：SSH 引擎用 POSIX 路径（远程 Linux），本地引擎用系统路径
 */
function joinPath(engine: DockerEngine, ...segments: string[]): string {
  if (engine.connectionType === "ssh") return pathPosix.join(...segments);
  return path.join(...segments);
}

/** 同步执行命令，避免 execSync 在 Windows 上 /bin/sh ENOENT */
function run(cmd: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; input?: string } = {}): string {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    env: { ...dockerCliEnv(), ...options.env },
  });
  if (result.error) {
    throw Object.assign(new Error(`${cmd} ${args.join(" ")} 执行失败：${result.error.message}`), { stderr: result.error.message });
  }
  if (result.status !== 0) {
    const err = new Error(`${cmd} ${args.join(" ")} 退出码 ${result.status}：${(result.stderr || "").trim()}`);
    (err as any).stderr = result.stderr || "";
    throw err;
  }
  return (result.stdout || "").trim();
}

/**
 * 执行命令并返回 **stdout + stderr 合并** 的完整输出。
 *
 * `docker compose up/down/pull/build` 的进度信息几乎全部写入 stderr，
 * 只取 stdout（见 `run()`）会让前端的「命令输出弹窗」几乎空白，
 * 因此需要单独的合并版本给堆栈操作使用。
 *
 * 失败时抛出的 Error 上附加 `output` 字段，携带已产生的合并输出，
 * 便于前端把失败详情原样展示在同一个输出弹窗里。
 */
function runCombined(
  cmd: string,
  args: string[],
  options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; input?: string } = {}
): string {
  const result = spawnSync(cmd, args, {
    ...options,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    shell: true,
    env: { ...dockerCliEnv(), ...options.env },
  });
  const merged = [result.stdout || "", result.stderr || ""]
    .map((s) => s.replace(/\r/g, "").trim())
    .filter(Boolean)
    .join("\n");
  if (result.error) {
    throw Object.assign(new Error(`${cmd} ${args.join(" ")} 执行失败：${result.error.message}`), {
      stderr: result.error.message,
      output: merged || result.error.message,
    });
  }
  if (result.status !== 0) {
    throw Object.assign(new Error(`${cmd} ${args.join(" ")} 退出码 ${result.status}`), {
      stderr: result.stderr || "",
      output: merged || `退出码 ${result.status}`,
    });
  }
  return merged;
}

/**
 * docker CLI 环境隔离：DOCKER_CONFIG 未设置时指向临时可写目录，
 * 避免 ~/.docker/config.json 权限问题（如 systemd ProtectHome 屏蔽 /home）
 * 让 compose 插件加载失败 / 干扰检测。docker CLI 对不存在的配置目录会静默忽略。
 */
function dockerCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.DOCKER_CONFIG) {
    try {
      const dir = path.join(os.tmpdir(), "docker-manager-yanzi-docker-config");
      fs.mkdirSync(dir, { recursive: true });
      env.DOCKER_CONFIG = dir;
    } catch {
      /* 创建失败则退回默认行为 */
    }
  }
  return env;
}

/**
 * compose 可用性判定：退出码 0 直接可用；
 * 非 0 时若输出中仍出现版本号（如 stderr 仅有 config.json 权限 WARNING），也视为可用
 */
function isComposeVersionOk(result: { status: number | null; stdout?: string; stderr?: string }): boolean {
  if (result.status === 0) return true;
  const out = `${result.stdout || ""}\n${result.stderr || ""}`;
  return /Docker Compose version|docker compose version/i.test(out);
}

/**
 * Docker Compose 命令检测（缓存）
 * 支持 3 种模式（由 settings.json 中 docker.composeMode 控制）：
 *   "auto"       — 自动检测：docker compose > docker-compose > docker compose
 *   "plugin"     — 强制使用 docker compose（Docker Compose 插件）
 *   "standalone" — 强制使用 docker-compose（独立二进制）
 */
let _composeMode: { cmd: string; baseArgs: string[] } | null = null;

/** 检测服务器上实际可用的 compose 模式（用于设置页展示） */
export function detectComposeModes(): { plugin: boolean; standalone: boolean } {
  const env = dockerCliEnv();
  const plugin = spawnSync("docker", ["compose", "version"], { encoding: "utf-8", stdio: "pipe", shell: true, env });
  const standalone = spawnSync("docker-compose", ["version"], { encoding: "utf-8", stdio: "pipe", shell: true, env });
  return { plugin: isComposeVersionOk(plugin), standalone: isComposeVersionOk(standalone) };
}

export function getComposeCmd(): { cmd: string; baseArgs: string[] } {
  const settings = getSettings();
  const mode = settings.docker?.composeMode || "auto";

  // 强制模式：不缓存，每次都走对应的命令
  if (mode === "plugin") {
    return { cmd: "docker", baseArgs: ["compose"] };
  }
  if (mode === "standalone") {
    return { cmd: "docker-compose", baseArgs: [] };
  }

  // 自动模式：检测结果缓存
  if (!_composeMode) {
    const env = dockerCliEnv();
    const plugin = spawnSync("docker", ["compose", "version"], { encoding: "utf-8", stdio: "pipe", shell: true, env });
    if (isComposeVersionOk(plugin)) {
      _composeMode = { cmd: "docker", baseArgs: ["compose"] };
      console.log(`🔧 Compose: docker compose（自动检测 → 插件模式）`);
    } else {
      const standalone = spawnSync("docker-compose", ["version"], { encoding: "utf-8", stdio: "pipe", shell: true, env });
      if (isComposeVersionOk(standalone)) {
        _composeMode = { cmd: "docker-compose", baseArgs: [] };
        console.log(`🔧 Compose: docker-compose（自动检测 → 独立模式）`);
      } else {
        _composeMode = { cmd: "docker", baseArgs: ["compose"] };
        console.warn(`⚠️  Compose: 未检测到可用命令，回退到 docker compose（插件模式）`);
      }
    }
  }
  return _composeMode!;
}

/**
 * 构建 SSH 连接参数数组（用于 spawnSync ssh 命令）
 * 返回 args 数组（不含 'ssh'），如 ["-p", "22", "user@host"]
 */
function buildSshArgs(engine: DockerEngine): string[] {
  const args: string[] = [];
  if (engine.sshPort && engine.sshPort !== 22) {
    args.push("-p", String(engine.sshPort));
  }
  // 禁用严格主机密钥检查，方便家庭 NAS 场景
  args.push("-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null");
  // 禁用交互式提示
  args.push("-o", "BatchMode=yes");
  if (engine.sshAuthType === "key" && engine.sshKey) {
    // 私钥内容需要写入临时文件，然后通过 -i 引用
    const os = require("node:os");
    const keyPath = path.join(os.tmpdir(), `dsm-ssh-key-${engine.id}-${Date.now()}`);
    try {
      fs.writeFileSync(keyPath, engine.sshKey, { mode: 0o600 });
      args.push("-i", keyPath);
      // 60 秒后自动清理临时私钥
      setTimeout(() => { try { fs.unlinkSync(keyPath); } catch { /* ignore */ } }, 60000);
    } catch (e) {
      console.warn("写入临时 SSH 私钥失败：", e);
    }
  }
  args.push(`${engine.sshUsername}@${engine.sshHost}`);
  return args;
}

/**
 * 通过 SSH 远程执行命令，返回 stdout
 */
function sshExec(engine: DockerEngine, remoteCmd: string, options: { timeout?: number } = {}): string {
  const sshArgs = buildSshArgs(engine);
  // 用 sh -c 包裹，确保远端 shell 解释管道/通配符等
  return run("ssh", [...sshArgs, "sh", "-c", remoteCmd], { timeout: options.timeout || 10000 });
}

/**
 * 通过 SSH 远程写入文件（用 stdin 传递内容）
 */
function sshWriteFile(engine: DockerEngine, remotePath: string, content: string): void {
  const sshArgs = buildSshArgs(engine);
  // 用 cat > FILE <<'EOF'\n...\nEOF 方式写入，避免引号转义问题
  const escapedPath = remotePath.replace(/'/g, `'\\''`);
  const heredoc = `cat > '${escapedPath}' << '__DSM_EOF__'\n${content}\n__DSM_EOF__`;
  run("ssh", [...sshArgs, "sh", "-c", heredoc], { timeout: 15000 });
}

/**
 * 读取文件内容（兼容本地 socket 和远程 SSH 引擎）
 * TCP 引擎无 SSH 凭据，无法读取远程文件，返回空字符串
 */
function readStackFile(engine: DockerEngine, filePath: string): string {
  if (!filePath) return "";
  // 优先检查本地文件系统（本地创建的堆栈文件在本地磁盘上）
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf-8");
  } catch (e: any) {
    console.warn(`读取本地文件失败 ${filePath}：${e.message}`);
  }
  // 本地不存在且为 SSH 引擎，尝试远程读取
  if (engine.connectionType === "ssh") {
    try {
      const exists = sshExec(engine, `test -f '${filePath.replace(/'/g, `'\\''`)}' && echo Y || echo N`);
      if (exists.trim() !== "Y") return "";
      return sshExec(engine, `cat '${filePath.replace(/'/g, `'\\''`)}'`);
    } catch (e: any) {
      console.warn(`远程读取文件失败 ${filePath}：${e.message}`);
      return "";
    }
  }
  return "";
}

/**
 * 检查文件是否存在（兼容本地 socket 和远程 SSH 引擎）
 */
function fileExists(engine: DockerEngine, filePath: string): boolean {
  if (!filePath) return false;
  // 优先检查本地文件系统
  try { if (fs.existsSync(filePath)) return true; } catch { /* ignore */ }
  // 本地不存在且为 SSH 引擎，检查远程
  if (engine.connectionType === "ssh") {
    try {
      const r = sshExec(engine, `test -f '${filePath.replace(/'/g, `'\\''`)}' && echo Y || echo N`);
      return r.trim() === "Y";
    } catch { return false; }
  }
  return false;
}

/**
 * 写入文件内容（兼容本地 socket 和远程 SSH 引擎）
 */
function writeStackFile(engine: DockerEngine, filePath: string, content: string): void {
  // 优先检查本地：文件本身或其父目录在本地存在 → 本地写入
  const parentDir = path.dirname(filePath);
  if (fs.existsSync(filePath) || fs.existsSync(parentDir)) {
    fs.writeFileSync(filePath, content, "utf-8");
    return;
  }
  // 本地不存在且为 SSH 引擎 → 远程写入
  if (engine.connectionType === "ssh") {
    sshWriteFile(engine, filePath, content);
    return;
  }
  // socket/TCP 回退：尝试本地写入
  fs.writeFileSync(filePath, content, "utf-8");
}

export interface EngineConnection {
  success: boolean;
  status: "connected" | "disconnected" | "error";
  dockerVersion?: string;
  error?: string;
}

/**
 * 解析 TCP 地址，提取 host / port / protocol
 * 支持格式: tcp://1.2.3.4, tcp://1.2.3.4:2375, https://1.2.3.4:2376, 1.2.3.4:2375
 * 
 * 协议自动检测：
 * - 显式指定 https:// → 使用 HTTPS
 * - 端口 2376 → 自动 HTTPS（Docker TLS 默认端口）
 * - 端口 2375 或未指定 → HTTP
 */
function parseTcpAddress(tcpAddress: string): { host: string; port: number; protocol: "http" | "https" } {
  let cleaned = tcpAddress.replace(/^(tcp|https?):\/\//i, "");

  // 从原始地址检测协议
  let protocol: "http" | "https" = "http";
  if (/^https/i.test(tcpAddress)) {
    protocol = "https";
  }

  const hostPortMatch = cleaned.match(/^([^:]+):(\d+)$/);
  let host: string;
  let port: number;

  if (hostPortMatch) {
    host = hostPortMatch[1];
    port = parseInt(hostPortMatch[2], 10);
    // 端口 2376 是 Docker TLS 默认端口，自动使用 HTTPS
    if (!/^https/i.test(tcpAddress) && port === 2376) {
      protocol = "https";
    }
  } else {
    host = cleaned;
    port = 2375; // Docker API 默认 HTTP 端口
  }

  return { host, port, protocol };
}

/**
 * 构建 Docker 连接选项
 */
function buildOptions(engine: {
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: "password" | "key";
  sshPassword: string;
  sshKey: string;
  sshPassphrase: string;
}): Docker.DockerOptions {
  if (engine.connectionType === "socket") {
    return { socketPath: engine.socketPath };
  }

  if (engine.connectionType === "ssh") {
    const sshOptions: Docker.DockerOptions = {
      protocol: "ssh",
      host: engine.sshHost,
      port: engine.sshPort || 22,
      username: engine.sshUsername,
    };
    if (engine.sshAuthType === "key") {
      (sshOptions as any).privateKey = engine.sshKey;
      if (engine.sshPassphrase) {
        (sshOptions as any).passphrase = engine.sshPassphrase;
      }
    } else {
      (sshOptions as any).password = engine.sshPassword;
    }
    return sshOptions;
  }

  // TCP
  const { host, port, protocol } = parseTcpAddress(engine.tcpAddress);
  const options: Docker.DockerOptions = { host, port, protocol };

  // HTTPS 连接：允许自签名证书（家庭 NAS / 内网常见）
  if (protocol === "https") {
    (options as any).agent = new https.Agent({ rejectUnauthorized: false });
  }

  return options;
}

/**
 * 将技术错误转换为用户友好的提示
 */
function friendlyError(err: any): string {
  const msg: string = err.message || "连接失败";
  if (msg.includes("ECONNRESET")) {
    return "连接被重置 — Docker 可能配置了 TLS 双向认证（需要客户端证书），或该端口不是 Docker API";
  }
  if (msg.includes("ECONNREFUSED")) {
    return "连接被拒绝 — 请确认 Docker 已开启 TCP 远程访问（-H tcp://0.0.0.0:2375）";
  }
  if (msg.includes("ENOTFOUND") || msg.includes("EAI_AGAIN")) {
    return "无法解析地址 — 请检查 IP 是否正确";
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("超时")) {
    return "连接超时 — 请检查网络连通性和防火墙规则";
  }
  if (msg.includes("self-signed") || msg.includes("SSL") || msg.includes("CERT") || msg.includes("UNABLE_TO_VERIFY")) {
    return "TLS 证书验证失败 — 已尝试自签名模式，如仍失败可能证书不受信任";
  }
  if (msg.includes("authentication") || msg.includes("Auth fail") || msg.includes("Permission denied")) {
    return "SSH 认证失败 — 请检查用户名、密码或私钥是否正确";
  }
  if (msg.includes("All configured authentication methods failed")) {
    return "SSH 认证失败 — 所有认证方式均被拒绝";
  }
  return msg;
}

/**
 * 尝试连接 Docker 引擎并获取基本信息
 */
export async function connectDocker(engine: {
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: "password" | "key";
  sshPassword: string;
  sshKey: string;
  sshPassphrase: string;
}): Promise<EngineConnection> {
  try {
    const options = buildOptions(engine);
    const docker = new Docker(options);

    // SSH 连接给 15 秒超时（建立隧道需要时间）
    const timeout = engine.connectionType === "ssh" ? 15000 : 10000;
    const info = await Promise.race([
      docker.info(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("连接超时（" + timeout / 1000 + " 秒），请检查地址和端口是否正确")), timeout)),
    ]);

    return {
      success: true,
      status: "connected",
      dockerVersion: `v${info.ServerVersion || "unknown"}`,
    };
  } catch (err: any) {
    return {
      success: false,
      status: "error",
      error: friendlyError(err),
    };
  }
}

/**
 * 简单 ping，快速检测连接状态
 */
export async function pingDocker(engine: {
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: "password" | "key";
  sshPassword: string;
  sshKey: string;
  sshPassphrase: string;
}): Promise<{ alive: boolean; error?: string }> {
  try {
    const options = buildOptions(engine);
    const docker = new Docker(options);
    const timeout = engine.connectionType === "ssh" ? 6000 : 3000;
    await Promise.race([
      docker.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("超时")), timeout)),
    ]);
    return { alive: true };
  } catch (err: any) {
    return { alive: false, error: friendlyError(err) };
  }
}

/**
 * 获取 Docker 实例（内部使用）
 */
function getDocker(engine: DockerEngine): Docker {
  return new Docker(buildOptions(engine));
}

/** 带超时的执行 */
async function withTimeout<T>(fn: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("请求超时")), ms)),
  ]);
}

/**
 * 获取引擎系统信息
 */
export async function getEngineInfo(engine: DockerEngine): Promise<any> {
  const docker = getDocker(engine);
  const info = await withTimeout(docker.info(), 10000);
  return info;
}

/**
 * 获取容器列表（含 restart policy）
 */
export async function getContainers(engine: DockerEngine): Promise<any[]> {
  const docker = getDocker(engine);
  const containers = await withTimeout(docker.listContainers({ all: true }), 10000);

  // 并行获取每个容器的 inspect 数据（提取 RestartPolicy）
  const enhanced = await Promise.all(
    containers.map(async (c: any) => {
      try {
        const inspect = await withTimeout(docker.getContainer(c.Id).inspect(), 5000);
        return {
          ...c,
          restartPolicy: inspect?.HostConfig?.RestartPolicy?.Name || "no",
        };
      } catch {
        return { ...c, restartPolicy: "—" };
      }
    })
  );

  return enhanced;
}

/**
 * 获取镜像列表
 */
export async function getImages(engine: DockerEngine): Promise<any[]> {
  const docker = getDocker(engine);
  const images = await withTimeout(docker.listImages(), 10000);
  return images;
}

/* ==================== 镜像拉取任务系统 ==================== */

/** 拉取任务状态 */
export type PullTaskStatus = "pulling" | "success" | "error" | "canceled";

/** 单个镜像层的下载/解压进度 */
export interface PullLayerInfo {
  id: string;          // 层 ID（如 a1b2c3d4）
  status: string;      // Downloading / Extracting / Pull complete / Already exists ...
  progress?: string;   // 原始进度文本（如 [==> ] 12.3MB/45.6MB）
  current?: number;    // 已下载字节
  total?: number;      // 总字节
}

/** 对外暴露的拉取任务信息（不含内部 stream 引用） */
export interface PullTaskInfo {
  id: string;
  engineId: string;
  image: string;
  status: PullTaskStatus;
  startedAt: number;
  endedAt?: number;
  error?: string;
  layers: PullLayerInfo[];
  /** 最近 N 条格式化输出行（供详情弹窗展示） */
  outputTail: string[];
}

/** 内部任务对象：额外持有进度流/子进程引用，用于取消 */
interface PullTaskInternal extends PullTaskInfo {
  stream: any | null;
  /** 本地 CLI 拉取路径的子进程引用，用于取消 */
  child: ChildProcess | null;
  layerMap: Map<string, PullLayerInfo>;
  outputLines: string[];
}

/** 内存任务表：重启后丢失（可接受，拉取是短任务） */
const pullTasks = new Map<string, PullTaskInternal>();
const PULL_OUTPUT_LIMIT = 200;   // 输出行缓冲上限
const PULL_TASK_TTL = 30 * 60 * 1000; // 已结束任务保留 30 分钟

/** 定时清理已结束的任务，防止内存增长 */
function cleanupFinishedPullTasks(): void {
  const now = Date.now();
  for (const [id, task] of pullTasks) {
    if (task.endedAt && now - task.endedAt > PULL_TASK_TTL) pullTasks.delete(id);
  }
}

/** 追加一行输出（带缓冲上限） */
function pushOutput(task: PullTaskInternal, line: string): void {
  task.outputLines.push(line);
  if (task.outputLines.length > PULL_OUTPUT_LIMIT) task.outputLines.shift();
  task.outputTail = task.outputLines.slice(-60);
}

/**
 * 启动镜像拉取任务（后台异步执行，不阻塞请求）
 * 返回任务信息，前端通过轮询获取进度
 *
 * 路径选择：本地 socket 引擎走 `docker pull` CLI 子进程（实测在该环境下
 * CLI 路径 100% 成功而 API 路径会命中 daemon 的 registry 回退超时），
 * 远程 SSH/TCP 引擎保留 dockerode API 路径。
 */
export function startImagePull(engine: DockerEngine, image: string): PullTaskInfo {
  cleanupFinishedPullTasks();
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  // 生成候选镜像名列表：每个加速源改写后的镜像（按数组顺序=优先级）+ 原镜像名兜底
  const candidates = buildPullCandidates(image);

  const task: PullTaskInternal = {
    id,
    engineId: engine.id,
    image,
    status: "pulling",
    startedAt: Date.now(),
    layers: [],
    outputTail: [],
    stream: null,
    child: null,
    layerMap: new Map(),
    outputLines: [],
  };
  pullTasks.set(id, task);

  if (engine.connectionType === "socket") {
    startCliPull(task, engine, candidates, image);
  } else {
    // SSH/TCP 远程引擎：走远程 docker CLI 拉取，让远程 daemon 套用其 registry-mirrors。
    // 背景：dockerode API 的 /images/create 不会套用 daemon 的 registry-mirrors，
    // 在被墙网络里会直连 registry-1.docker.io 超时；而远程 `docker pull` CLI 会正常用加速源。
    startRemoteCliPull(task, engine, candidates, image);
  }

  return toPublicInfo(task);
}

/**
 * 按系统设置「镜像加速源」生成拉取候选镜像名列表。
 *
 * 数组顺序即拉取优先级：前面的源先试，失败自动尝试下一个，
 * 最后以原镜像名兜底（走 daemon 自身 registry-mirrors 的回退链）。
 * 未配置任何加速源（或关闭改写）时，返回 [原镜像名]（等价于不改写）。
 *
 * v1.5.0 起仅在 `docker.rewriteImageNames === true` 时改写镜像名：加速源默认只写入
 * /etc/docker/daemon.json 由守护进程生效；把「仅代理私有仓库 / fnnas 类」的源用于
 * 镜像名改写会 404，因此改写降级为显式开关（旧配置迁移时自动置 true 保持原行为）。
 */
export function buildPullCandidates(image: string): string[] {
  const raw = (image || "").trim();
  let mirrors: string[] = [];
  try {
    const d = getSettings()?.docker;
    if (d?.rewriteImageNames === true && Array.isArray(d?.registryMirrors)) {
      mirrors = (d.registryMirrors as unknown[]).map((x) => String(x || "").trim()).filter(Boolean);
    }
  } catch { /* 设置未就绪时忽略 */ }
  if (mirrors.length === 0) return [raw];
  // 去重（保留顺序），并去掉协议头与结尾斜杠，统一成裸域名
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const mm of mirrors) {
    const c = mm.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
    if (c && !seen.has(c)) { seen.add(c); cleaned.push(c); }
  }
  const candidates = cleaned.map((m) => rewriteOne(raw, m));
  // 原镜像名兜底（走 daemon 自身回退链）；避免与改写结果重复
  if (!candidates.includes(raw)) candidates.push(raw);
  return candidates;
}

/**
 * 把单个镜像名改写为 `<mirror>/<repo>`（library 命名空间补齐）。
 * 已自带 registry（首段含 `.` / `:` 或为 localhost）的镜像原样返回。
 */
export function rewriteOne(image: string, mirror: string): string {
  const raw = (image || "").trim();
  const atIdx = raw.indexOf("@");
  const namePart = atIdx >= 0 ? raw.slice(0, atIdx) : raw; // 去掉 digest 部分再判断
  const slashIdx = namePart.indexOf("/");
  if (slashIdx > 0) {
    const first = namePart.slice(0, slashIdx);
    if (first.includes(".") || first.includes(":") || first === "localhost") return raw;
  }
  const repo = slashIdx > 0 ? namePart : `library/${namePart}`;
  return raw.replace(namePart, `${mirror}/${repo}`);
}


/**
 * 本地 socket 引擎：spawn `docker pull` 子进程拉取。
 * CLI 输出按 \r/\n 分行解析，恢复层状态与字节进度（与 API 路径的
 * PullLayerInfo 结构一致，前端无感知差异）。
 */
function startCliPull(task: PullTaskInternal, engine: DockerEngine, candidates: string[], originalImage: string): void {
  if (candidates.length === 0) {
    task.status = "error";
    task.endedAt = Date.now();
    task.error = "无可用拉取源";
    pushOutput(task, `✗ ${task.error}`);
    return;
  }
  const [pullImage, ...rest] = candidates;
  const env = dockerCliEnv();
  // CLI 需显式指向引擎配置的 socket（默认 /var/run/docker.sock 之外的路径尤其必要）
  env.DOCKER_HOST = `unix://${engine.socketPath}`;

  pushOutput(task, `$ docker pull ${pullImage}`);

  const child = spawn("docker", ["pull", pullImage], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32", // Windows 开发机需 shell 解析 docker.exe
  });
  task.child = child;

  let buf = "";
  const consume = (chunk: string) => {
    buf += chunk;
    // docker CLI 用 \r 原地刷新进度行，\r/\n 都视为行边界
    const parts = buf.split(/\r\n|\r|\n/);
    buf = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) handleCliPullLine(task, trimmed);
    }
  };
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", consume);

  const stderrLines: string[] = [];
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (c: string) => {
    for (const line of String(c).split(/\r\n|\r|\n/)) {
      if (line.trim()) stderrLines.push(line.trim());
    }
    if (stderrLines.length > 10) stderrLines.splice(0, stderrLines.length - 10);
  });

  child.on("error", (err) => {
    task.child = null;
    task.endedAt = Date.now();
    if (task.status === "canceled") return;
    task.status = "error";
    task.error = `无法启动 docker 命令: ${err.message}`;
    pushOutput(task, `✗ ${task.error}`);
  });

  child.on("close", (code, signal) => {
    task.child = null;
    if (task.status === "canceled") return; // 已被用户取消
    if (code === 0) {
      task.status = "success";
      task.endedAt = Date.now();
      pushOutput(task, `✓ 拉取完成: ${originalImage}`);
    } else {
      const errText = stderrLines.join(" ") || `docker pull 异常退出（code=${code ?? signal}）`;
      if (rest.length > 0) {
        // 当前源失败，自动尝试下一个源（按数组顺序=优先级）
        pushOutput(task, `⚠ 源 ${pullImage} 拉取失败（${errText.split(/\r\n|\r|\n/)[0] || errText}），尝试下一个源: ${rest[0]}`);
        startCliPull(task, engine, rest, originalImage);
        return;
      }
      task.status = "error";
      task.endedAt = Date.now();
      task.error = errText;
      pushOutput(task, `✗ 拉取失败: ${task.error}`);
    }
  });
}

/**
 * SSH/TCP 远程引擎：通过远程 `docker` CLI 拉取，让远程 daemon 套用其 registry-mirrors。
 *
 * 背景：dockerode API 的 /images/create 不会套用 daemon 的 registry-mirrors，
 * 在被墙网络里会直连 registry-1.docker.io 超时；而远程 `docker pull` CLI 会正常用加速源。
 * - SSH：拼 `ssh [...opts] user@host "docker pull '<img>'"` 在远程执行（key 认证写临时私钥文件，
 *   password 认证用 sshpass 包裹；无 sshpass 时回退 dockerode API）。
 * - TCP：本地 `docker -H tcp://addr pull '<img>'`，由远程 daemon 套用加速源（TLS 自签名放行）。
 */
function startRemoteCliPull(task: PullTaskInternal, engine: DockerEngine, candidates: string[], originalImage: string): void {
  if (candidates.length === 0) {
    task.status = "error";
    task.endedAt = Date.now();
    task.error = "无可用拉取源";
    pushOutput(task, `✗ ${task.error}`);
    return;
  }
  const [pullImage, ...rest] = candidates;
  let command: string;
  let args: string[];
  let env = dockerCliEnv();
  let tmpKeyPath: string | null = null;

  // 远程 docker pull 命令（单引号包裹镜像名，转义内部单引号）
  const safeImg = pullImage.replace(/'/g, "'\\''");
  const remotePull = `docker pull '${safeImg}'`;

  if (engine.connectionType === "ssh") {
    const port = engine.sshPort || 22;
    const remote = `${engine.sshUsername}@${engine.sshHost}`;
    const sshBase = [
      "-p", String(port),
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
    ];
    if (engine.sshAuthType === "key" && engine.sshKey) {
      const kp = path.join(os.tmpdir(), `dmk_${Date.now()}_${Math.random().toString(36).slice(2)}`);
      try { fs.writeFileSync(kp, engine.sshKey, { mode: 0o600 }); tmpKeyPath = kp; } catch { tmpKeyPath = null; }
      if (tmpKeyPath) sshBase.unshift("-i", tmpKeyPath);
    }
    command = "ssh";
    args = [...sshBase, remote, remotePull];
  } else {
    // TCP：本地 docker CLI 通过 tcp 连远程 daemon
    command = "docker";
    env.DOCKER_HOST = `tcp://${engine.tcpAddress}`;
    if (/^https:\/\//i.test(engine.tcpAddress)) env.DOCKER_TLS_VERIFY = "1";
    args = ["pull", pullImage];
  }

  // password 认证用 sshpass 包裹；缺失则回退 dockerode API（仅尝试原镜像名一次）
  if (engine.connectionType === "ssh" && engine.sshAuthType === "password" && engine.sshPassword) {
    let hasSshpass = false;
    try { hasSshpass = spawnSync("sshpass", ["-V"], { encoding: "utf-8" }).stdout?.length > 0; } catch { hasSshpass = false; }
    if (hasSshpass) {
      args = ["-p", engine.sshPassword, command, ...args];
      command = "sshpass";
    } else {
      pushOutput(task, "⚠ 未找到 sshpass，password 认证无法走远程 CLI，回退 API 拉取（远程 daemon 若不套加速源可能超时）");
      cleanupTmpKey(tmpKeyPath);
      startApiPull(task, engine, originalImage, originalImage);
      return;
    }
  }

  const cleanup = () => cleanupTmpKey(tmpKeyPath);

  pushOutput(task, `$ ${command === "sshpass" ? "sshpass -p *** ssh" : command} ... ${remotePull}`);

  const child = spawn(command, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  task.child = child;

  let buf = "";
  const consume = (chunk: string) => {
    buf += chunk;
    const parts = buf.split(/\r\n|\r|\n/);
    buf = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (trimmed) handleCliPullLine(task, trimmed);
    }
  };
  child.stdout?.setEncoding("utf-8");
  child.stdout?.on("data", consume);

  const stderrLines: string[] = [];
  child.stderr?.setEncoding("utf-8");
  child.stderr?.on("data", (c: string) => {
    for (const line of String(c).split(/\r\n|\r|\n/)) {
      if (line.trim()) stderrLines.push(line.trim());
    }
    if (stderrLines.length > 10) stderrLines.splice(0, stderrLines.length - 10);
  });

  child.on("error", (err) => {
    task.child = null;
    cleanup();
    if (task.status === "canceled") return;
    task.status = "error";
    task.endedAt = Date.now();
    task.error = `无法启动 ${command} 命令: ${err.message}`;
    pushOutput(task, `✗ ${task.error}`);
  });

  child.on("close", (code, signal) => {
    task.child = null;
    cleanup();
    if (task.status === "canceled") return; // 已被用户取消
    if (code === 0) {
      task.status = "success";
      task.endedAt = Date.now();
      pushOutput(task, `✓ 拉取完成: ${originalImage}`);
    } else {
      const errText = stderrLines.join(" ") || `远程 docker pull 异常退出（code=${code ?? signal}）`;
      if (rest.length > 0) {
        // 当前源失败，自动尝试下一个源（按数组顺序=优先级）
        pushOutput(task, `⚠ 源 ${pullImage} 拉取失败（${errText.split(/\r\n|\r|\n/)[0] || errText}），尝试下一个源: ${rest[0]}`);
        startRemoteCliPull(task, engine, rest, originalImage);
        return;
      }
      task.status = "error";
      task.endedAt = Date.now();
      task.error = errText;
      pushOutput(task, `✗ 拉取失败: ${task.error}`);
    }
  });
}

/** 安全删除临时私钥文件 */
function cleanupTmpKey(p: string | null): void {
  if (!p) return;
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

/** 解析 docker CLI 字节数（如 "1.5MB"、"299MB"、"12kB"）为字节数 */
function parseCliSize(s: string): number | undefined {
  const m = s.trim().match(/^([\d.]+)\s*([kKmMgGtT]?)[bB]$/);
  if (!m) return undefined;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return undefined;
  const unit = m[2].toLowerCase();
  const mult = unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : unit === "g" ? 1024 ** 3 : unit === "t" ? 1024 ** 4 : 1;
  return Math.round(n * mult);
}

/**
 * 解析 docker pull 的单行输出并更新任务状态。
 * 层行格式：`085992e40cc3: Downloading [===>  ]  10.5MB/299MB`
 * 非层行（Pulling from / Digest / Status）只进 outputTail。
 */
function handleCliPullLine(task: PullTaskInternal, line: string): void {
  pushOutput(task, line);

  const m = line.match(/^([0-9a-f]{7,64}): (.+)$/);
  if (!m) return;

  const layerId = m[1];
  const rest = m[2];

  let status = rest;
  let progress: string | undefined;
  let current: number | undefined;
  let total: number | undefined;

  // 进度段：`10.5MB/299MB`（也可能只有进度没有方括号条）
  const pm = rest.match(/(\d+(?:\.\d+)?)\s*([kKmMgGtT]?B)\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]?B)/);
  if (pm) {
    progress = `${pm[1]}${pm[2]}/${pm[3]}${pm[4]}`;
    current = parseCliSize(`${pm[1]}${pm[2]}`);
    total = parseCliSize(`${pm[3]}${pm[4]}`);
    status = rest.slice(0, pm.index ?? 0).replace(/\[[=>\s.]*\]\s*$/, "").trim();
  } else {
    status = rest.replace(/\[[=>\s.]*\]/, "").trim();
  }
  if (!status) status = "progress";

  const layer: PullLayerInfo = task.layerMap.get(layerId) || { id: layerId, status: "" };
  layer.status = status;
  if (progress) layer.progress = progress;
  if (current != null) layer.current = current;
  if (total != null) layer.total = total;
  task.layerMap.set(layerId, layer);
  task.layers = Array.from(task.layerMap.values());
}

/** 远程 SSH/TCP 引擎：dockerode API 拉取（无 sshpass 时的兜底路径，仅拉取一次） */
function startApiPull(task: PullTaskInternal, engine: DockerEngine, pullImage: string, originalImage: string): void {
  const docker = getDocker(engine);
  // dockerode pull：回调拿到进度流，followProgress 逐事件推进
  docker.pull(pullImage, (err: any, stream: any) => {
    if (err || !stream) {
      const errMsg = err?.message || `拉取 ${pullImage} 失败：无法建立进度流`;
      task.status = "error";
      task.endedAt = Date.now();
      task.error = errMsg;
      pushOutput(task, `✗ ${task.error}`);
      return;
    }
    task.stream = stream;
    pushOutput(task, `$ docker pull ${pullImage}`);

    docker.modem.followProgress(
      stream,
      // 完成回调
      (finErr: any, _output: any) => {
        task.stream = null;
        if (task.status === "canceled") return; // 已被用户取消
        if (finErr) {
          const errMsg = finErr.message || String(finErr);
          task.status = "error";
          task.endedAt = Date.now();
          task.error = errMsg;
          pushOutput(task, `✗ 拉取失败: ${task.error}`);
        } else {
          task.status = "success";
          task.endedAt = Date.now();
          pushOutput(task, `✓ 拉取完成: ${originalImage}`);
        }
      },
      // 进度回调：evt = { id, status, progress, progressDetail: { current, total } }
      (evt: any) => {
        if (!evt) return;
        const line = [evt.id, evt.status, evt.progress].filter(Boolean).join(" ");
        pushOutput(task, line);
        if (evt.id) {
          // 按层 ID 聚合状态
          const layer: PullLayerInfo = task.layerMap.get(evt.id) || { id: evt.id, status: "" };
          layer.status = evt.status || layer.status;
          if (evt.progress) layer.progress = evt.progress;
          if (evt.progressDetail?.current != null) layer.current = evt.progressDetail.current;
          if (evt.progressDetail?.total != null) layer.total = evt.progressDetail.total;
          task.layerMap.set(evt.id, layer);
          task.layers = Array.from(task.layerMap.values());
        }
      }
    );
  });
}

/** 取消拉取任务：销毁进度流 / 终止 CLI 子进程 */
export function cancelImagePull(taskId: string): PullTaskInfo {
  const task = pullTasks.get(taskId);
  if (!task) throw new Error(`拉取任务不存在: ${taskId}`);
  if (task.status !== "pulling") return toPublicInfo(task); // 已结束的任务无需取消
  try { task.stream?.destroy?.(); } catch { /* 忽略销毁异常 */ }
  try { task.child?.kill("SIGTERM"); } catch { /* 忽略终止异常 */ }
  task.status = "canceled";
  task.endedAt = Date.now();
  pushOutput(task, `✗ 已取消拉取: ${task.image}`);
  return toPublicInfo(task);
}

/** 获取单个任务信息 */
export function getPullTask(taskId: string): PullTaskInfo {
  const task = pullTasks.get(taskId);
  if (!task) throw new Error(`拉取任务不存在: ${taskId}`);
  return toPublicInfo(task);
}

/** 获取指定引擎的全部拉取任务（按启动时间倒序） */
export function listPullTasks(engineId: string): PullTaskInfo[] {
  cleanupFinishedPullTasks();
  return Array.from(pullTasks.values())
    .filter((t) => !engineId || t.engineId === engineId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .map(toPublicInfo);
}

/** 剥离内部引用，返回可序列化的任务信息 */
function toPublicInfo(task: PullTaskInternal): PullTaskInfo {
  return {
    id: task.id,
    engineId: task.engineId,
    image: task.image,
    status: task.status,
    startedAt: task.startedAt,
    endedAt: task.endedAt,
    error: task.error,
    layers: task.layers,
    outputTail: task.outputTail,
  };
}

/**
 * 获取数据卷列表
 */
export async function getVolumes(engine: DockerEngine): Promise<any> {
  const docker = getDocker(engine);
  const result = await withTimeout(docker.listVolumes(), 10000);
  return result;
}

/**
 * 获取堆栈列表（多数据源合并：容器标签 + 本地 compose 文件扫描）
 * 解决 docker compose down 后容器被移除导致堆栈"消失"的问题
 */
export async function getStacks(engine: DockerEngine): Promise<any[]> {
  const docker = getDocker(engine);
  const containers = await withTimeout(docker.listContainers({ all: true }), 10000);

  // 按项目名分组 — 只收录同时有 compose project 和 service 标签的容器
  // 且排除 exited/dead 的无主容器（避免幽灵容器如 "thirsty_ritchie" 等 Docker 自动生成名）
  const projectMap = new Map<string, any[]>();
  for (const c of containers) {
    const labels = c.Labels || {};
    const project = labels["com.docker.compose.project"];
    const service = labels["com.docker.compose.service"];
    if (!project || !service) continue;
    if (!projectMap.has(project)) projectMap.set(project, []);
    projectMap.get(project)!.push(c);
  }

  const stacks: any[] = [];
  const seenProjects = new Set<string>();

  for (const [projectName, projectContainers] of projectMap) {
    seenProjects.add(projectName);
    const labels = projectContainers[0]?.Labels || {};
    const composeFile = labels["com.docker.compose.project.config_files"] || "";
    const workingDir = labels["com.docker.compose.project.working_dir"] || "";

    const running = projectContainers.filter((c) => c.State === "running").length;
    const total = projectContainers.length;
    let status: string;
    if (running === total) status = "running";
    else if (running === 0) status = "stopped";
    else status = "partial";

    // 找最早的创建时间作为 uptime 基准
    const createdTimes = projectContainers
      .filter((c) => c.State === "running")
      .map((c) => (c.Created || 0) * 1000);
    const oldestStart = createdTimes.length > 0 ? Math.min(...createdTimes) : 0;

    // 读取 compose 文件内容（支持远程 SSH 引擎）
    const composeContent = readStackFile(engine, composeFile);

    // 读取 .env 文件内容
    const envPath = workingDir ? joinPath(engine, workingDir, ".env") : "";
    const envContent = readStackFile(engine, envPath);

    const stackContainers = projectContainers.map((c) => {
      const cLabels = c.Labels || {};
      // service 标签已在筛选阶段保证存在，无需回退到 docker 自动生成名
      const serviceName = cLabels["com.docker.compose.service"];
      const repoTag = c.Image || "";
      const [image, tag] = repoTag.includes(":") ? repoTag.split(/:(.+)/) : [repoTag, "latest"];
      const networks = c.NetworkSettings?.Networks || {};
      const netKeys = Object.keys(networks);
      const ip = netKeys.length > 0 ? networks[netKeys[0]]?.IPAddress || "" : "";

      // 端口映射合并显示：宿主机端口:容器端口/协议（如 8807:8080/tcp）
      // 无宿主机映射的条目不显示；按完整映射去重（0.0.0.0/:: 绑定会产生重复条目）
      const portSet = new Set<string>();
      for (const p of c.Ports || []) {
        if (!p.PublicPort || !p.PrivatePort) continue;
        portSet.add(`${p.PublicPort}:${p.PrivatePort}/${p.Type || "tcp"}`);
      }
      const ports = Array.from(portSet).join(", ");

      return {
        name: serviceName,
        image: image,
        tag: tag,
        status: c.State === "running" ? "running" : "stopped",
        network: netKeys[0] || "bridge",
        ip: ip || "—",
        ports: ports || "—",
        hasUpdate: false,
      };
    });

    stacks.push({
      id: projectName,
      name: projectName,
      status,
      totalContainers: total,
      runningContainers: running,
      uptime: oldestStart ? formatUptime(oldestStart) : "—",
      composeFilePath: composeFile,
      composeContent,
      envContent,
      workingDir,
      containers: stackContainers,
    });
  }

  // 补充扫描本地 stacks 目录：本地目录优先于容器标签
  // 即便堆栈有运行容器（config_files 标签可能指向旧路径），
  // 只要本地 COMPOSE_DIR/<name>/ 下存在 compose 文件，就用本地路径+内容覆盖
  const stacksDir = COMPOSE_DIR;
  if (fs.existsSync(stacksDir)) {
    const entries = fs.readdirSync(stacksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;

      const dirPath = path.join(stacksDir, name);
      // 本地扫描兼容 .yaml 和 .yml 四种文件名（与 saveStackCompose 对齐）
      const localComposeNames = ["compose.yaml", "docker-compose.yaml", "compose.yml", "docker-compose.yml"];
      let composeFilePath = "";
      for (const fname of localComposeNames) {
        const p = path.join(dirPath, fname);
        if (fs.existsSync(p)) { composeFilePath = p; break; }
      }

      // 读取元信息（描述、图标、WebUI Labels、Settings）
      // 规范布局：name / description 为纯文本元文件；.stack-meta.json 仅存 icon/settings 等扩展字段
      const metaPath = path.join(dirPath, ".stack-meta.json");
      let hasMeta = false;
      let metaDescription = "";
      let metaIcon = "";
      let metaWebuiLabels: any[] = [];
      let metaSettings: any = {};
      if (fs.existsSync(metaPath)) {
        try {
          const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
          hasMeta = true;
          metaDescription = meta.description || "";
          metaIcon = meta.icon || "";
          metaWebuiLabels = meta.webuiLabels || [];
          metaSettings = meta.settings || {};
        } catch { /* ignore */ }
      }
      // description 元文件优先（统一规范）
      const descFile = path.join(dirPath, "description");
      if (fs.existsSync(descFile)) {
        const text = fs.readFileSync(descFile, "utf-8").trim();
        if (text) metaDescription = text;
      }
      // 图标：目录内 icon.* 文件存在即视为有图标
      const hasIconFile = fs.readdirSync(dirPath).some((f) => /^icon\.(png|jpe?g|gif|svg|webp|ico)$/i.test(f));
      if (hasIconFile) metaIcon = `/api/stack-icons/${encodeURIComponent(name)}`;

      // 既没有 compose 文件、meta 文件，也没有 description 元文件：认为是残留空目录，跳过
      if (!composeFilePath && !hasMeta && !metaDescription) continue;

      // 读取 compose 和 .env 文件内容（兼容 SSH 引擎）
      const composeContent = composeFilePath ? readStackFile(engine, composeFilePath) : "";
      const envPath = path.join(dirPath, ".env");
      const envContent = readStackFile(engine, envPath);
      const description = metaDescription;
      const icon = metaIcon;
      const webuiLabels = metaWebuiLabels;
      const settings = metaSettings;

      const existingIndex = stacks.findIndex((s) => s.name === name);
      if (existingIndex >= 0) {
        // 已有容器数据的条目：覆盖 composeFilePath / composeContent / envContent / workingDir / 元数据
        // 保留来自容器标签的 status / totalContainers / runningContainers / containers / uptime
        stacks[existingIndex] = {
          ...stacks[existingIndex],
          composeFilePath,
          composeContent,
          envContent,
          workingDir: dirPath,
          description: description || stacks[existingIndex].description,
          icon: icon || stacks[existingIndex].icon,
          webuiLabels: webuiLabels.length > 0 ? webuiLabels : stacks[existingIndex].webuiLabels,
          settings: { ...stacks[existingIndex].settings, ...settings },
        };
      } else {
        // 没有容器数据 — 文件系统补充（堆栈已 down 或仅有 meta 的空记录）
        stacks.push({
          id: name,
          name,
          description,
          icon,
          status: "stopped",
          totalContainers: 0,
          runningContainers: 0,
          uptime: "—",
          composeFilePath,
          composeContent,
          workingDir: dirPath,
          containers: [],
          hasBuild: false,
          hasUpdate: false,
          webuiLabels,
          envContent,
          settings: {
            autoStart: false,
            forceRecreate: false,
            timeout: 60,
            autoUpdate: false,
            visible: true,
            ...settings,
          },
          backupCount: 0,
        });
      }
    }
  }

  return stacks;
}

// ============ 堆栈操作 ============

/**
 * 创建堆栈：仅写入 compose 文件，不自动启动
 */
export async function createStack(
  _engine: DockerEngine,
  name: string,
  description: string,
  composeContent: string
): Promise<{ name: string; path: string }> {
  // 校验名称（仅允许字母、数字、横线、下划线）
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("堆栈名称只能包含字母、数字、横线和下划线");
  }

  // 创建堆栈目录
  const stacksDir = COMPOSE_DIR;
  const stackDir = path.join(stacksDir, name);
  if (!fs.existsSync(stacksDir)) {
    fs.mkdirSync(stacksDir, { recursive: true });
  }

  // 目录已存在时：检查是否已有 compose 文件
  // 只有真正存在 compose 文件才视为重复；若只有空目录或残留 meta，允许重新写入
  const localComposeNames = ["compose.yaml", "docker-compose.yaml", "compose.yml", "docker-compose.yml"];
  let existingCompose = "";
  if (fs.existsSync(stackDir)) {
    for (const fname of localComposeNames) {
      const p = path.join(stackDir, fname);
      if (fs.existsSync(p)) { existingCompose = p; break; }
    }
    if (existingCompose) {
      throw new Error(`堆栈 "${name}" 已存在`);
    }
  }

  fs.mkdirSync(stackDir, { recursive: true });

  // 统一规范布局：docker-compose.yaml（核心编排）+ name（展示名）+ description（描述）
  const composeFile = path.join(stackDir, "docker-compose.yaml");
  fs.writeFileSync(composeFile, composeContent, "utf-8");

  fs.writeFileSync(path.join(stackDir, "name"), name, "utf-8");
  fs.writeFileSync(path.join(stackDir, "description"), description || "", "utf-8");

  return { name, path: composeFile };
}

/**
 * 根据堆栈名查找堆栈目录
 * 先查 COMPOSE_DIR/<name>，再通过运行中容器的 working_dir 查找
 */
function findStackDir(engine: DockerEngine, stackName: string): string {
  const stacksDir = COMPOSE_DIR;
  const localDir = path.join(stacksDir, stackName);

  // 优先查本地管理目录
  if (fs.existsSync(localDir)) return localDir;

  // 通过容器标签查找 working_dir（远程 Docker 主机上的真实路径）
  try {
    const result = run("docker", [
      "ps", "-a",
      "--filter", `label=com.docker.compose.project=${stackName}`,
      "--format", '{{.Label "com.docker.compose.project.working_dir"}}',
    ]);
    if (result) {
      // 本地连接：检查路径是否在本地存在
      // 远程连接：直接返回远程路径（不能本地 fs.existsSync 检查）
      if (engine.connectionType === "ssh") return result.trim();
      if (fs.existsSync(result)) return result;
    }
  } catch { /* ignore */ }

  // 最后回退到默认路径
  return localDir;
}

/**
 * 堆栈操作：up / down / pull / restart / build
 */
export async function stackAction(
  engine: DockerEngine,
  stackName: string,
  action: "up" | "down" | "pull" | "restart" | "build"
): Promise<string> {
  const cwd = findStackDir(engine, stackName);
  const { cmd: composeCmd, baseArgs: composeBase } = getComposeCmd();

  /**
   * 执行单步 compose 命令，输出前加上命令行标头（形如 `$ docker compose up -d`），
   * 这样多步操作（restart = down + up）在前端弹窗里能清楚区分各步输出。
   * 失败时抛出的 Error 同时把标头 + 输出写进 message 和 output，供前端原样展示。
   */
  const step = (stepArgs: string[], timeout: number): string => {
    const full = [...composeBase, ...stepArgs];
    const header = `$ ${composeCmd} ${full.join(" ")}`;
    try {
      const out = runCombined(composeCmd, full, { cwd, timeout });
      return `${header}\n${out || "(无输出)"}`;
    } catch (err: any) {
      const detail = (err.output || err.stderr || err.message || "").toString().slice(0, 8000);
      const text = `${header}\n${detail}`.trim();
      throw Object.assign(new Error(text), { output: text });
    }
  };

  if (action === "restart") {
    // restart = down + up（分两步执行，因为 spawnSync 不支持 &&）
    const downOut = step(["down"], 60000);
    const upOut = step(["up", "-d"], 300000);
    return `${downOut}\n\n${upOut}`;
  }
  return step(getComposeArgs(action), 300000);
}

function getComposeArgs(action: string): string[] {
  switch (action) {
    case "up": return ["up", "-d"];
    case "down": return ["down"];
    case "pull": return ["pull"];
    case "build": return ["build", "--pull"];
    default: return [action];
  }
}

/**
 * 删除堆栈：docker compose down -v + 删除文件
 */
export async function removeStack(
  engine: DockerEngine,
  stackName: string,
  removeVolumes: boolean = false,
  removeFiles: boolean = true
): Promise<string> {
  const cwd = findStackDir(engine, stackName);
  const { cmd: composeCmd, baseArgs: composeBase } = getComposeCmd();

  const chunks: string[] = [];

  // 执行 docker compose down（捕获完整输出，失败不阻断删除）
  try {
    const downArgs = removeVolumes ? [...composeBase, "down", "-v"] : [...composeBase, "down"];
    const header = `$ ${composeCmd} ${downArgs.join(" ")}`;
    const out = runCombined(composeCmd, downArgs, { cwd, timeout: 60000 });
    chunks.push(`${header}\n${out || "(无输出)"}`);
  } catch (err: any) {
    const detail = (err.output || err.stderr || err.message || "").toString().slice(0, 8000);
    chunks.push(`compose down 警告：${detail}`);
    // down 失败不阻断删除（可能容器已被手动删除）
    console.warn(`compose down 警告：${detail.slice(0, 200)}`);
  }

  // 删除堆栈目录
  if (removeFiles && fs.existsSync(cwd)) {
    try {
      fs.rmSync(cwd, { recursive: true, force: true });
      chunks.push("已删除堆栈目录");
    } catch (e: any) {
      chunks.push(`删除目录失败：${(e as Error).message || e}`);
    }
  }

  return chunks.join("\n");
}

/**
 * 保存堆栈 compose 文件内容
 */
export async function saveStackCompose(
  engine: DockerEngine,
  stackName: string,
  composeContent: string
): Promise<void> {
  const cwd = findStackDir(engine, stackName);

  // 查找已存在的 compose 文件名（兼容远程）
  const composeNames = ["compose.yaml", "docker-compose.yaml", "compose.yml", "docker-compose.yml"];
  let composeFile = "";
  for (const name of composeNames) {
    const p = joinPath(engine, cwd, name);
    if (fileExists(engine, p)) { composeFile = p; break; }
  }
  if (!composeFile) composeFile = joinPath(engine, cwd, "docker-compose.yaml");

  writeStackFile(engine, composeFile, composeContent);
}

/**
 * 保存堆栈环境变量文件（原始文本）
 */
export async function saveStackEnv(
  engine: DockerEngine,
  stackName: string,
  envContent: string
): Promise<void> {
  const cwd = findStackDir(engine, stackName);
  const envFile = joinPath(engine, cwd, ".env");
  writeStackFile(engine, envFile, envContent);
}

/**
 * 保存堆栈设置
 */
export async function saveStackSettings(
  engine: DockerEngine,
  stackName: string,
  settings: any
): Promise<void> {
  let cwd = findStackDir(engine, stackName);

  // 处理堆栈重命名：如果 settings.name 与当前名称不同，重命名目录
  const newName = settings.name;
  if (newName && newName !== stackName && engine.connectionType !== "ssh") {
    const stacksDir = COMPOSE_DIR;
    const oldDir = path.join(stacksDir, stackName);
    const newDir = path.join(stacksDir, newName);

    // 只重命名本地管理目录下的堆栈
    if (fs.existsSync(oldDir) && !fs.existsSync(newDir)) {
      fs.renameSync(oldDir, newDir);
      cwd = newDir;
      // 同步更新 name 元文件（展示名 = 目录名）
      try { writeStackFile(engine, joinPath(engine, newDir, "name"), newName); } catch { /* ignore */ }
    }
  }

  const metaFile = joinPath(engine, cwd, ".stack-meta.json");

  // 保留已有的元数据
  let existing: any = {};
  if (fileExists(engine, metaFile)) {
    const raw = readStackFile(engine, metaFile);
    try { existing = JSON.parse(raw); } catch { /* ignore */ }
  }

  const updated = { ...existing, ...settings, updatedAt: new Date().toISOString() };
  // iconUrl 与 icon 字段同步：getStacks 读取 meta.icon，设置表单写入 settings.iconUrl
  if (settings.iconUrl !== undefined) updated.icon = settings.iconUrl;
  if (settings.description !== undefined) updated.description = settings.description;
  writeStackFile(engine, metaFile, JSON.stringify(updated, null, 2));

  // description 元文件同步（统一规范：name/description 为纯文本元文件）
  if (settings.description !== undefined) {
    try { writeStackFile(engine, joinPath(engine, cwd, "description"), String(settings.description)); } catch { /* ignore */ }
  }
  // name 元文件兜底（目录内尚无该文件时补齐）
  try {
    const nameFile = joinPath(engine, cwd, "name");
    if (!fileExists(engine, nameFile)) writeStackFile(engine, nameFile, stackName);
  } catch { /* ignore */ }
}

/**
 * 检查堆栈内容器的镜像更新（SHA-256 比较）
 */
export async function checkStackUpdates(
  engine: DockerEngine,
  stackName?: string
): Promise<{ stackName: string; containers: { name: string; hasUpdate: boolean; currentSha: string; latestSha: string }[] }[]> {
  const docker = getDocker(engine);
  const stacks = await getStacks(engine);
  const targetStacks = stackName ? stacks.filter((s) => s.name === stackName) : stacks;

  const results: any[] = [];
  for (const stack of targetStacks) {
    const containers = await Promise.all(
      (stack.containers || []).map(async (c: any) => {
        try {
          // 获取本地镜像
          const localImage = docker.getImage(`${c.image}:${c.tag}`);
          const localInspect = await withTimeout(localImage.inspect(), 5000);
          const currentSha = localInspect.RepoDigests?.[0]?.split("@")[1] || localInspect.Id?.replace("sha256:", "") || "";

          // 拉取远程 manifest 比较
          let latestSha = currentSha;
          try {
            const res = await fetch(`https://registry-1.docker.io/v2/library/${c.image}/manifests/${c.tag}`, {
              headers: { Accept: "application/vnd.docker.distribution.manifest.v2+json" },
            });
            if (res.ok) {
              latestSha = res.headers.get("docker-content-digest")?.replace("sha256:", "") || currentSha;
            }
          } catch { /* 网络不可达时跳过 */ }

          return {
            name: c.name,
            hasUpdate: currentSha !== latestSha && latestSha !== "",
            currentSha,
            latestSha,
          };
        } catch {
          return { name: c.name, hasUpdate: false, currentSha: "", latestSha: "" };
        }
      })
    );
    results.push({ stackName: stack.name, containers });
  }

  return results;
}

/**
 * 备份堆栈（压缩包）
 */
export async function backupStack(
  engine: DockerEngine,
  stackName: string
): Promise<string> {
  const cwd = findStackDir(engine, stackName);
  if (!fs.existsSync(cwd)) throw new Error(`堆栈目录不存在: ${cwd}`);

  const backupsDir = path.join(DATA_DIR, "backups");
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupName = `${stackName}_${timestamp}.tar.gz`;
  const backupPath = path.join(backupsDir, backupName);

  // Windows 上可能没有 tar，用 node 内置模块打包
  // 简单方案：直接用 cp -r 到临时目录再 tar
  run("tar", ["-czf", backupPath, "-C", path.dirname(cwd), path.basename(cwd)], {
    timeout: 30000,
  });

  return backupName;
}

/**
 * 恢复堆栈（从备份压缩包）
 */
export async function restoreStack(
  engine: DockerEngine,
  backupName: string
): Promise<void> {
  const backupsDir = path.join(DATA_DIR, "backups");
  const backupPath = path.join(backupsDir, backupName);
  if (!fs.existsSync(backupPath)) throw new Error(`备份文件不存在: ${backupName}`);

  const stacksDir = COMPOSE_DIR;
  if (!fs.existsSync(stacksDir)) fs.mkdirSync(stacksDir, { recursive: true });

  run("tar", ["-xzf", backupPath, "-C", stacksDir], { timeout: 30000 });
}

// ============ 容器操作 ============

export async function containerAction(engine: DockerEngine, containerId: string, action: "start" | "stop" | "restart" | "pause" | "unpause"): Promise<void> {
  const docker = getDocker(engine);
  const container = docker.getContainer(containerId);
  switch (action) {
    case "start": await withTimeout(container.start(), 15000); break;
    case "stop": await withTimeout(container.stop(), 15000); break;
    case "restart": await withTimeout(container.restart(), 20000); break;
    case "pause": await withTimeout(container.pause(), 10000); break;
    case "unpause": await withTimeout(container.unpause(), 10000); break;
  }
}

export async function removeContainer(engine: DockerEngine, containerId: string, force: boolean = false): Promise<void> {
  const docker = getDocker(engine);
  const container = docker.getContainer(containerId);
  await withTimeout(container.remove({ force, v: false }), 15000);
}

// ============ 镜像操作 ============

export async function removeImage(engine: DockerEngine, imageId: string, force: boolean = false): Promise<void> {
  const docker = getDocker(engine);
  const image = docker.getImage(imageId);
  await withTimeout(image.remove({ force }), 15000);
}

/**
 * 分类镜像删除的 409 冲突错误，返回前端可直接展示的中文提示与机器可读 code。
 * 返回 null 表示非冲突类错误（交由上层按 500 处理）。
 *
 * 区分两类 409，因为处置方式完全不同：
 * - IMAGE_REFERENCED：镜像被多个仓库标签引用 → force 可解决（会移除所有引用标签）
 * - IMAGE_IN_USE：镜像正被容器使用 → force 也无效，必须先处理容器
 */
export function classifyImageRemoveError(
  err: any
): { code: string; message: string; status: number } | null {
  const msg = String(err?.message || "");
  const statusCode = Number(err?.statusCode || 0);
  if (statusCode !== 409 && !/\(HTTP code 409\)/.test(msg)) return null;

  if (/must be forced|referenced in multiple repositories/.test(msg)) {
    return {
      code: "IMAGE_REFERENCED",
      status: 409,
      message: "该镜像被多个仓库标签引用，普通删除被拒绝。强制删除将移除此镜像 ID 下的所有引用标签。",
    };
  }
  if (/being used by (a )?(running|stopped|created) container|cannot be forced/.test(msg)) {
    return {
      code: "IMAGE_IN_USE",
      status: 409,
      message: "该镜像正在被容器使用，强制删除也无法移除。请先删除或更新使用此镜像的容器。",
    };
  }
  return {
    code: "IMAGE_CONFLICT",
    status: 409,
    message: msg.replace(/^\(HTTP code \d+\)\s*\w+\s*-\s*/, "") || "镜像删除冲突",
  };
}

export async function pruneImages(engine: DockerEngine): Promise<any> {
  const docker = getDocker(engine);
  return await withTimeout(docker.pruneImages(), 15000);
}

// ============ 数据卷操作 ============

export async function removeVolume(engine: DockerEngine, volumeName: string, force: boolean = false): Promise<void> {
  const docker = getDocker(engine);
  const volume = docker.getVolume(volumeName);
  await withTimeout(volume.remove({ force }), 10000);
}

export async function pruneVolumes(engine: DockerEngine): Promise<any> {
  const docker = getDocker(engine);
  return await withTimeout(docker.pruneVolumes(), 15000);
}

export async function createVolume(engine: DockerEngine, name: string, driver: string): Promise<any> {
  const docker = getDocker(engine);
  return await withTimeout(docker.createVolume({ Name: name, Driver: driver }), 10000);
}

function formatUptime(startMs: number): string {
  const diff = Date.now() - startMs;
  if (diff < 0) return "—";
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  if (days > 0) return `${days}天 ${hours}小时`;
  const minutes = Math.floor((diff % 3600000) / 60000);
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}

/**
 * 获取容器日志
 */
export async function getContainerLogs(engine: DockerEngine, containerId: string, tail: number = 200): Promise<string[]> {
  const docker = getDocker(engine);
  const container = docker.getContainer(containerId);

  // dockerode logs 返回的是 stream，用 callback 方式获取
  const raw: string = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("获取日志超时")), 10000);

    container.logs({
      stdout: true,
      stderr: true,
      tail: tail,
      timestamps: true,
    }, (err: any, stream: any) => {
      clearTimeout(timeout);
      if (err) {
        reject(err);
        return;
      }

      // stream 可能是 Readable stream 或直接是字符串/Buffer
      if (typeof stream === "string" || Buffer.isBuffer(stream)) {
        resolve(stream.toString("utf-8"));
        return;
      }

      // 处理 stream
      if (stream && typeof stream.on === "function") {
        const chunks: Buffer[] = [];
        stream.on("data", (chunk: any) => {
          if (Buffer.isBuffer(chunk)) chunks.push(chunk);
          else if (typeof chunk === "string") chunks.push(Buffer.from(chunk));
        });
        stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        stream.on("error", (e: any) => reject(e));
        // 安全超时
        setTimeout(() => resolve(Buffer.concat(chunks).toString("utf-8")), 8000);
      } else if (stream) {
        resolve(String(stream));
      } else {
        resolve("");
      }
    });
  });

  // Docker 日志格式：每行前面可能有 8 字节 header
  return raw.split("\n").filter((l) => l.trim());
}

/**
 * 获取容器 stats
 */
export async function getContainerStats(engine: DockerEngine, containerId: string): Promise<any> {
  const docker = getDocker(engine);
  const container = docker.getContainer(containerId);

  const stats: any = await withTimeout(
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("获取 stats 超时")), 8000);
      container.stats({ stream: false }, (err: any, data: any) => {
        clearTimeout(t);
        if (err) reject(err);
        else resolve(data);
      });
    }),
    8000
  );

  // 计算 CPU 使用率
  let cpuPercent = 0;
  const cpuStats = stats.cpu_stats || {};
  const preCpuStats = stats.precpu_stats || {};
  const cpuDelta = (cpuStats.cpu_usage?.total_usage || 0) - (preCpuStats.cpu_usage?.total_usage || 0);
  const systemDelta = (cpuStats.system_cpu_usage || 0) - (preCpuStats.system_cpu_usage || 0);
  const cpuCount = cpuStats.online_cpus || cpuStats.cpu_usage?.percpu_usage?.length || 1;
  if (systemDelta > 0 && cpuDelta > 0) {
    cpuPercent = (cpuDelta / systemDelta) * cpuCount * 100;
  }

  // 内存
  const memStats = stats.memory_stats || {};
  const memoryUsage = memStats.usage || 0;
  const memoryLimit = memStats.limit || 1;

  // 网络 I/O（累加所有接口）
  let netInput = 0;
  let netOutput = 0;
  const networks = stats.networks || {};
  for (const iface of Object.values(networks) as any[]) {
    netInput += iface.rx_bytes || 0;
    netOutput += iface.tx_bytes || 0;
  }

  // 磁盘 I/O
  let blockInput = 0;
  let blockOutput = 0;
  const blkio = stats.blkio_stats?.io_service_bytes_recursive || [];
  for (const entry of blkio) {
    if (entry.op === "Read") blockInput += entry.value || 0;
    if (entry.op === "Write") blockOutput += entry.value || 0;
  }

  return {
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    memoryUsage: Math.round(memoryUsage / 1024 / 1024), // MB
    memoryLimit: Math.round(memoryLimit / 1024 / 1024), // MB
    netInput: Math.round(netInput / 1024), // KB
    netOutput: Math.round(netOutput / 1024), // KB
    blockInput: Math.round(blockInput / 1024), // KB
    blockOutput: Math.round(blockOutput / 1024), // KB
  };
}
/**
 * 引擎级资源汇总（仪表盘资源监控）
 * - info：NCPU / MemTotal（宿主机规格，作为 CPU/内存上限）
 * - df：镜像 + 数据卷 + 容器的磁盘占用
 * - 逐个运行容器 stats（stream=false 一次性采样）汇总 CPU/内存/网络/块设备
 */
export async function getEngineResourceStats(engine: DockerEngine): Promise<any> {
  const docker = getDocker(engine);

  const [info, df, running] = await Promise.all([
    withTimeout(docker.info(), 10000),
    withTimeout(docker.df(), 10000).catch(() => null),
    withTimeout(docker.listContainers({ all: false }), 10000).catch(() => [] as any[]),
  ]);

  // 并发采样每个运行容器的 stats，单个失败不影响整体
  const statResults = await Promise.allSettled(
    (running as any[]).map((c) => getContainerStats(engine, c.Id))
  );

  let cpuPercent = 0;
  let memoryUsageMB = 0;
  let netRxKB = 0;
  let netTxKB = 0;
  let blockReadKB = 0;
  let blockWriteKB = 0;
  let sampled = 0;
  for (const r of statResults) {
    if (r.status !== "fulfilled") continue;
    const s = r.value;
    sampled++;
    cpuPercent += s.cpuPercent || 0;
    memoryUsageMB += s.memoryUsage || 0;
    netRxKB += s.netInput || 0;
    netTxKB += s.netOutput || 0;
    blockReadKB += s.blockInput || 0;
    blockWriteKB += s.blockOutput || 0;
  }

  // Docker 磁盘占用：镜像 + 数据卷（df 的 Containers.Size 已含在镜像里，避免重复计）
  let dockerDiskBytes = 0;
  if (df) {
    for (const img of df.Images || []) dockerDiskBytes += img.Size || 0;
    for (const vol of df.Volumes || []) dockerDiskBytes += vol.UsageData?.Size || 0;
  }

  const ncpu = info.NCPU || info.CPUs || 1;
  const memTotalMB = Math.round((info.MemTotal || 0) / 1024 / 1024);

  return {
    ncpu,
    memTotalMB,
    runningContainers: (running as any[]).length,
    sampledContainers: sampled,
    cpuPercent: Math.round(cpuPercent * 100) / 100,
    cpuMaxPercent: ncpu * 100,
    memoryUsageMB,
    dockerDiskMB: Math.round(dockerDiskBytes / 1024 / 1024),
    netRxKB: Math.round(netRxKB),
    netTxKB: Math.round(netTxKB),
    blockReadKB: Math.round(blockReadKB),
    blockWriteKB: Math.round(blockWriteKB),
    serverVersion: info.ServerVersion || "",
  };
}

export async function getActivityLogs(engine: DockerEngine): Promise<any[]> {
  const docker = getDocker(engine);
  const now = Date.now();
  const activities: any[] = [];
  const WINDOW = 30 * 86400000; // 30 天

  try {
    const containers = await withTimeout(docker.listContainers({ all: true }), 10000);
    const images = await withTimeout(docker.listImages(), 10000);

    // 容器状态
    for (const c of containers) {
      const name = (c.Names?.[0] || "").replace(/^\//, "");
      const created = (c.Created || 0) * 1000;
      const ago = now - created;

      if (ago > WINDOW) continue;

      if (c.State === "running") {
        activities.push({
          id: `c-run-${c.Id?.slice(0, 12)}`,
          timestamp: new Date(created).toISOString().replace("T", " ").substring(0, 19),
          type: "success",
          message: `容器 ${name} 运行中`,
        });
      } else if (c.State === "exited") {
        activities.push({
          id: `c-stop-${c.Id?.slice(0, 12)}`,
          timestamp: new Date(created).toISOString().replace("T", " ").substring(0, 19),
          type: "warning",
          message: `容器 ${name} 已停止`,
        });
      } else if (c.State === "paused") {
        activities.push({
          id: `c-pause-${c.Id?.slice(0, 12)}`,
          timestamp: new Date(created).toISOString().replace("T", " ").substring(0, 19),
          type: "info",
          message: `容器 ${name} 已暂停`,
        });
      }
    }

    // 最近拉取的镜像
    for (const img of images) {
      const created = (img.Created || 0) * 1000;
      const ago = now - created;
      if (ago > WINDOW) continue;
      const repoTag = img.RepoTags?.[0] || "<none>";
      activities.push({
        id: `img-${img.Id?.replace("sha256:", "").slice(0, 12)}`,
        timestamp: new Date(created).toISOString().replace("T", " ").substring(0, 19),
        type: "info",
        message: `镜像 ${repoTag} 已拉取`,
      });
    }

    // 按时间倒序，取最近 20 条
    activities.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return activities.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * 在容器中创建 exec 并返回可交互的 stream
 */
export async function attachContainerTerminal(
  engine: DockerEngine,
  containerId: string
): Promise<{ stream: any; execId: string; cleanup: () => void }> {
  const docker = getDocker(engine);
  const container = docker.getContainer(containerId);

  // 尝试常见的 shell
  const shells = ["/bin/bash", "/bin/sh", "/bin/ash"];
  let exec: any = null;
  let lastError: any = null;

  for (const shell of shells) {
    try {
      exec = await withTimeout(
        container.exec({
          Cmd: [shell],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
          User: "root",
        }),
        5000
      );
      break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!exec) {
    throw lastError || new Error("无法在容器中创建终端");
  }

  const stream = await withTimeout(
    new Promise((resolve, reject) => {
      exec.start(
        { hijack: true, stdin: true, Tty: true },
        (err: any, s: any) => {
          if (err) reject(err);
          else resolve(s);
        }
      );
    }),
    10000
  );

  return {
    stream,
    execId: exec.id,
    cleanup: () => {
      try { (stream as any)?.destroy?.(); } catch { /* ignore */ }
      try { exec?.abort?.(); } catch { /* ignore */ }
    },
  };
}

/**
 * 调整 exec 终端大小
 */
export async function resizeContainerTerminal(
  engine: DockerEngine,
  containerId: string,
  execId: string,
  w: number,
  h: number
): Promise<void> {
  const docker = getDocker(engine);
  const exec = docker.getExec(execId);
  await withTimeout(
    new Promise((resolve, reject) => {
      exec.resize({ h, w }, (err: any) => {
        if (err) reject(err);
        else resolve(undefined);
      });
    }),
    5000
  );
}
