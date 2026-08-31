import fs from "node:fs";
import { connectDocker, pingDocker } from "./docker.js";
import { dataPath } from "./paths.js";

export interface DockerEngine {
  id: string;
  name: string;
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  // SSH 连接参数
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: "password" | "key";
  sshPassword: string;
  sshKey: string;
  sshPassphrase: string;
  status: "connected" | "disconnected" | "error";
  dockerVersion?: string;
  errorMessage?: string;
}

const ENGINES_FILE = dataPath("engines.json");
const ACTIVE_ENGINE_FILE = dataPath("active_engine.json");

// 默认引擎配置
const DEFAULT_ENGINES: DockerEngine[] = [
  {
    id: "e1",
    name: "本地 Docker",
    connectionType: "socket",
    socketPath: process.platform === "win32" ? "//./pipe/docker_engine" : "/var/run/docker.sock",
    tcpAddress: "",
    sshHost: "",
    sshPort: 22,
    sshUsername: "",
    sshAuthType: "password",
    sshPassword: "",
    sshKey: "",
    sshPassphrase: "",
    status: "disconnected",
  },
];

function loadEngines(): DockerEngine[] {
  try {
    if (fs.existsSync(ENGINES_FILE)) {
      const raw = fs.readFileSync(ENGINES_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // 文件损坏则用默认
  }
  return DEFAULT_ENGINES;
}

function saveEngines(engines: DockerEngine[]): void {
  fs.writeFileSync(ENGINES_FILE, JSON.stringify(engines, null, 2), "utf-8");
}

// 活跃引擎 ID 持久化
function loadActiveEngineId(): string {
  try {
    if (fs.existsSync(ACTIVE_ENGINE_FILE)) {
      const raw = fs.readFileSync(ACTIVE_ENGINE_FILE, "utf-8").trim();
      if (raw) return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  // 默认取第一个引擎
  const engines = getAllEnginesRaw();
  return engines.length > 0 ? engines[0].id : "";
}

function saveActiveEngineId(id: string): void {
  fs.writeFileSync(ACTIVE_ENGINE_FILE, JSON.stringify(id), "utf-8");
}

// 内存缓存
let engines: DockerEngine[] = loadEngines();
let activeEngineId: string = loadActiveEngineId();

// 兜底：如果存储的 activeEngineId 不在当前引擎列表中，自动修正
if (engines.length > 0 && !engines.find((e) => e.id === activeEngineId)) {
  activeEngineId = engines[0].id;
  saveActiveEngineId(activeEngineId);
}

// 仅供 loadActiveEngineId 在 getAllEngines 之前使用（避免循环）
function getAllEnginesRaw(): DockerEngine[] {
  return engines;
}

export function getActiveEngineId(): string {
  return activeEngineId;
}

export function setActiveEngineId(id: string): boolean {
  if (!engines.find((e) => e.id === id)) return false;
  activeEngineId = id;
  saveActiveEngineId(id);
  return true;
}

export function getAllEngines(): DockerEngine[] {
  return engines;
}

export function getEngine(id: string): DockerEngine | undefined {
  return engines.find((e) => e.id === id);
}

export function addEngine(engine: Omit<DockerEngine, "id" | "status">): DockerEngine {
  const newEngine: DockerEngine = {
    ...engine,
    id: "e" + Date.now(),
    status: "disconnected",
    sshHost: engine.sshHost || "",
    sshPort: engine.sshPort || 22,
    sshUsername: engine.sshUsername || "",
    sshAuthType: engine.sshAuthType || "password",
    sshPassword: engine.sshPassword || "",
    sshKey: engine.sshKey || "",
    sshPassphrase: engine.sshPassphrase || "",
  };
  engines.push(newEngine);
  saveEngines(engines);
  return newEngine;
}

export function updateEngine(id: string, updates: Partial<Pick<DockerEngine, "name">>): DockerEngine | null {
  const idx = engines.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  engines[idx] = { ...engines[idx], ...updates };
  saveEngines(engines);
  return engines[idx];
}

export function removeEngine(id: string): boolean {
  const len = engines.length;
  engines = engines.filter((e) => e.id !== id);
  if (engines.length !== len) {
    saveEngines(engines);
    // 如果删的是当前活跃引擎，自动切换到第一个
    if (activeEngineId === id && engines.length > 0) {
      activeEngineId = engines[0].id;
      saveActiveEngineId(activeEngineId);
    }
    return true;
  }
  return false;
}

/**
 * 测试引擎连接并更新状态
 */
export async function testConnection(id: string): Promise<DockerEngine | null> {
  const engine = engines.find((e) => e.id === id);
  if (!engine) return null;

  // 先快速 ping
  const ping = await pingDocker(engine);
  if (!ping.alive) {
    engine.status = "error";
    engine.errorMessage = ping.error || "连接失败";
    engine.dockerVersion = undefined;
    saveEngines(engines);
    return engine;
  }

  // 连接成功，获取详细信息
  const result = await connectDocker(engine);
  engine.status = result.status;
  engine.dockerVersion = result.dockerVersion;
  engine.errorMessage = result.error;
  saveEngines(engines);
  return engine;
}

/**
 * 启动时自动检测所有引擎连接
 */
export async function testAllConnections(): Promise<void> {
  for (const engine of engines) {
    const ping = await pingDocker(engine);
    if (ping.alive) {
      const result = await connectDocker(engine);
      engine.status = result.status;
      engine.dockerVersion = result.dockerVersion;
      engine.errorMessage = result.error;
    } else {
      engine.status = "disconnected";
      engine.errorMessage = ping.error;
      engine.dockerVersion = undefined;
    }
  }
  saveEngines(engines);
}
