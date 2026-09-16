/**
 * 安装量与活跃度遥测（仅上报端）
 *
 * 设计依据《Linux应用安装量与活跃用户统计方案（设备唯一标识+风控校验体系）》：
 *  - 主标识：本地持久化 UUID4，作为所有统计去重的唯一依据
 *  - 辅标识：硬件多维指纹（CPU + 主板 + 硬盘），仅用于风控，不参与统计
 *  - 事件：install（首次冷启动/重装）/ active（日常启动、定时心跳，日粒度去重）
 *
 * 容错原则：任何失败（无权限、离线、采集失败）都不得影响主业务。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { CONFIG_DIR } from "./paths.js";

/** 遥测事件类型 */
export type TelemetryEvent = "install" | "active";

/** 本机设备标识的 7 维硬件属性（统计主键由 ≥3 匹配决定，不依赖随机 UUID） */
export interface DeviceHardware {
  /** 系统（OS + 版本） */
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
  /** 设备 UUID（统计主键候选，≥3 硬件匹配时沿用） */
  deviceUid: string;
}

/** 设备标识文件（不放在程序安装目录，普通卸载不清除） */
const DEVICE_FILE_GLOBAL = "/etc/docker-manager-yanzi/device.info";
const DEVICE_FILE_FALLBACK = path.join(CONFIG_DIR, "device.info");

/** 心跳检查间隔：30 分钟（跨天自动触发 active，日粒度去重，成本极低） */
const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000;
/** 启动后延迟首报，避免与启动流程争抢资源 */
const FIRST_REPORT_DELAY_MS = 30 * 1000;
/** 单次网络请求超时 */
const REQUEST_TIMEOUT_MS = 10 * 1000;

export interface DeviceInfo {
  /** 主标识：持久化 UUID4（环境未变时稳定沿用，环境已变则重新生成） */
  uuid: string;
  /** 首次生成时间（≈ 首次安装时间） */
  createdAt: string;
  /** 硬件指纹（辅标识，虚拟环境为全 0 归一化值） */
  hwFingerprint: string;
  /** 是否虚拟化环境 */
  virtualized: boolean;
  /** 本机设备标识 7 维（系统/CPU/GPU/内存/硬盘UID/主板序列号/设备UID） */
  hardware: DeviceHardware;
  /** install 事件是否已成功上报 */
  installReported: boolean;
  /** 最近一次成功上报 active 的自然日（YYYY-MM-DD），用于日粒度去重 */
  lastActiveDate: string;
  /** 最近一次上报时间 */
  lastReportAt?: string;
  /** 最近一次上报错误信息 */
  lastError?: string;
}

// ---------- 设备标识文件读写 ----------

/** 解析实际可用的设备文件路径（优先系统全局配置目录，无权限则降级到配置目录） */
function resolveDeviceFile(): string {
  for (const p of [DEVICE_FILE_GLOBAL, DEVICE_FILE_FALLBACK]) {
    if (fs.existsSync(p)) return p;
  }
  // 都不存在：用「实写 + 删」判定可写性，避免 accessSync 在某些环境给出假阳性
  const tryWrite = (p: string) => {
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      const probe = `${p}.probe`;
      fs.writeFileSync(probe, "1", "utf-8");
      fs.unlinkSync(probe);
      return true;
    } catch {
      return false;
    }
  };
  return tryWrite(DEVICE_FILE_GLOBAL) ? DEVICE_FILE_GLOBAL : DEVICE_FILE_FALLBACK;
}

function readDeviceInfo(): DeviceInfo | null {
  const file = resolveDeviceFile();
  try {
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!raw?.uuid) return null;
    return raw as DeviceInfo;
  } catch {
    return null;
  }
}

function writeDeviceInfo(info: DeviceInfo): void {
  const file = resolveDeviceFile();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(info, null, 2), "utf-8");
  } catch (e) {
    console.warn("[telemetry] 设备标识写入失败:", (e as Error).message);
  }
}

/**
 * 获取（必要时创建）设备信息。
 * 设备身份判定：7 维硬件属性中 ≥3 匹配即视为「硬件环境未变」，沿用原 UUID（统计主键稳定）；
 * 否则视为新设备，重新生成 UUID（代替原来盲持久化随机 UUID 作为主键）。
 */
export function getDeviceInfo(): DeviceInfo {
  const current = collectHardwareAttrs();
  const existing = readDeviceInfo();

  // 无历史记录：全新设备
  if (!existing) {
    const hw = collectHardwareFingerprint();
    const info: DeviceInfo = {
      uuid: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      hwFingerprint: hw.fingerprint,
      virtualized: hw.virtualized,
      hardware: { ...current, deviceUid: "" },
      installReported: false,
      lastActiveDate: "",
    };
    info.hardware.deviceUid = info.uuid;
    writeDeviceInfo(info);
    return info;
  }

  // 候选 UUID：环境未变则沿用原 UUID
  current.deviceUid = existing.uuid;
  const storedHw: DeviceHardware = existing.hardware || {
    system: "", cpu: "", gpu: "", memory: "", diskUid: "", boardSerial: "", deviceUid: existing.uuid,
  };

  if (isEnvUnchanged(storedHw, current)) {
    existing.hardware = current;
    writeDeviceInfo(existing);
    return existing;
  }

  // 环境已变（<3 匹配）：视为新设备
  const hw = collectHardwareFingerprint();
  const info: DeviceInfo = {
    uuid: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    hwFingerprint: hw.fingerprint,
    virtualized: hw.virtualized,
    hardware: { ...current, deviceUid: "" },
    installReported: false,
    lastActiveDate: "",
  };
  info.hardware.deviceUid = info.uuid;
  writeDeviceInfo(info);
  return info;
}

// ---------- 硬件指纹（仅风控，不参与统计） ----------

/** 尽力读取文本文件，失败返回空串 */
function readTextFile(p: string): string {
  try {
    return fs.readFileSync(p, "utf-8").trim();
  } catch {
    return "";
  }
}

/** 执行命令取首行有效输出，失败/超时返回空串 */
function tryExec(cmd: string, args: string[]): string {
  try {
    const out = execFileSync(cmd, args, {
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    return (out || "").trim().split("\n")[0]?.trim() || "";
  } catch {
    return "";
  }
}

/** 虚拟化环境检测：容器 / 虚拟机 */
function detectVirtualization(): boolean {
  if (fs.existsSync("/.dockerenv")) return true;
  const cgroup = readTextFile("/proc/1/cgroup");
  if (/docker|kubepods|containerd|lxc/i.test(cgroup)) return true;
  const cpuinfo = readTextFile("/proc/cpuinfo");
  if (/hypervisor/i.test(cpuinfo)) return true;
  const productName = readTextFile("/sys/class/dmi/id/product_name");
  if (/VMware|VirtualBox|KVM|QEMU|Hyper-V|Xen|innotek|Parallels/i.test(productName)) return true;
  const virt = tryExec("systemd-detect-virt", []);
  if (virt && !/^none$/i.test(virt)) return true;
  return false;
}

/** 采集 CPU 序列号（物理机取 dmidecode，容器/无权限置空） */
function collectCpuId(): string {
  return tryExec("dmidecode", ["-s", "processor-serial"]) || tryExec("dmidecode", ["-t", "4"]) .match(/ID:\s*(\S+)/)?.[1] || "";
}

/** 采集主板序列号：sysfs 优先，dmidecode 兜底 */
function collectBoardId(): string {
  return (
    readTextFile("/sys/class/dmi/id/board_serial") ||
    readTextFile("/sys/class/dmi/id/product_uuid") ||
    tryExec("dmidecode", ["-s", "baseboard-serial-number"])
  );
}

/** 采集硬盘序列号：跳过虚拟/循环设备，取首个非空物理盘序列号 */
function collectDiskId(): string {
  const lsblk = tryExec("lsblk", ["-d", "-n", "-o", "SERIAL"]);
  const fromLsblk = lsblk
    .split("\n")
    .map((s) => s.trim())
    .find((s) => s && !/^(loop|ram|sr|zram)/i.test(s));
  if (fromLsblk) return fromLsblk;
  // 兜底：直接扫 sysfs
  try {
    const blocks = fs.readdirSync("/sys/block");
    for (const b of blocks) {
      if (/^(loop|ram|sr|zram|dm-)/i.test(b)) continue;
      const serial = readTextFile(path.join("/sys/block", b, "serial"));
      if (serial) return serial;
    }
  } catch { /* 忽略 */ }
  return "";
}

/**
 * 采集硬件指纹。
 * 规则：虚拟环境三项统一归零后再哈希（避免虚拟机硬件同质化导致风控误判）；
 *      采集失败字段保留空占位，避免字段缺失引发碰撞。
 */
export function collectHardwareFingerprint(): { fingerprint: string; virtualized: boolean } {
  const virtualized = detectVirtualization();
  const cpu = virtualized ? "0" : collectCpuId();
  const board = virtualized ? "0" : collectBoardId();
  const disk = virtualized ? "0" : collectDiskId();
  const raw = [cpu, board, disk].join("|");
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex");
  return { fingerprint, virtualized };
}

// ---------- 设备标识 7 维采集（≥3 匹配决定硬件环境是否变化） ----------

/** 采集 GPU 标识：lspci 优先，nvidia-smi 兜底，失败返回空串 */
function collectGpu(): string {
  const lspci = tryExec("lspci", ["-nn"]);
  const gpuLine = lspci.split("\n").find((l) => /VGA|3D|Display|Graphics/i.test(l));
  if (gpuLine) return gpuLine.replace(/^\S+\s/, "").trim().slice(0, 120);
  const nvidia = tryExec("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
  if (nvidia) return nvidia.trim().slice(0, 120);
  return "";
}

/** 采集内存标识：总容量（GB）为主，dmidecode 内存序列号兜底（全 0 归零） */
function collectMemory(): string {
  try {
    const gb = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const serial = tryExec("dmidecode", ["-t", "memory"]).match(/Serial Number:\s*(\S+)/i)?.[1] || "";
    const s = /^0{4,}$/i.test(serial) ? "" : serial;
    return s ? `${gb}GB|${s}` : `${gb}GB`;
  } catch {
    return "";
  }
}

/** 采集 7 维设备标识（deviceUid 先留空，由 getDeviceInfo 填入候选 UUID） */
export function collectHardwareAttrs(): DeviceHardware {
  return {
    system: collectOsVersion(),
    cpu: collectCpuId(),
    gpu: collectGpu(),
    memory: collectMemory(),
    diskUid: collectDiskId(),
    boardSerial: collectBoardId(),
    deviceUid: "",
  };
}

/** 统计 7 维中相等的非空属性数量（用于环境变化判定） */
export function countMatches(a: DeviceHardware, b: DeviceHardware): number {
  const keys: (keyof DeviceHardware)[] = ["system", "cpu", "gpu", "memory", "diskUid", "boardSerial", "deviceUid"];
  let n = 0;
  for (const k of keys) {
    const va = (a[k] || "").trim();
    const vb = (b[k] || "").trim();
    if (va && va === vb) n++;
  }
  return n;
}

/** 硬件环境是否未变化：7 维中 ≥3 匹配即视为同一设备 */
export function isEnvUnchanged(stored: DeviceHardware | null, current: DeviceHardware): boolean {
  if (!stored) return true; // 首次，无历史可比对
  return countMatches(stored, current) >= 3;
}

// ---------- 环境信息 ----------

function collectOsVersion(): string {
  const osRelease = readTextFile("/etc/os-release");
  const pretty = osRelease.match(/^PRETTY_NAME="?([^"\n]+)"?/m)?.[1];
  return `${os.type()} ${os.release()}${pretty ? ` (${pretty})` : ""}`;
}

function currentAppVersion(): string {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "0.0.0-dev";
}

// ---------- 上报 ----------

interface TelemetryConfigLike {
  enabled?: boolean;
  endpoint?: string;
  collectHwFingerprint?: boolean;
}

/** 读取遥测配置（未配置时走默认值：启用 + 官方端点） */
const TELEMETRY_ENDPOINT = "https://docker-yanzi.ziruxue.top";
function readConfig(): Required<TelemetryConfigLike> {
  return { enabled: true, endpoint: TELEMETRY_ENDPOINT, collectHwFingerprint: true };
}

/** 构造上报载荷 */
function buildPayload(event: TelemetryEvent, info: DeviceInfo, collectHw: boolean) {
  return {
    device_uuid: info.uuid,
    // 用户关闭采集 / 虚拟环境时不上报真实指纹：虚拟环境指纹本就无风控价值
    hw_fingerprint: collectHw ? info.hwFingerprint : "",
    event,
    ts: new Date().toISOString(),
    app: "docker-manager-yanzi",
    appVersion: currentAppVersion(),
    os: "linux",
    osVersion: collectOsVersion(),
    arch: process.arch,
    channel: "sea-linux-x64",
    virtualized: info.virtualized,
    // 7 维设备标识：统计服务端据此做 ≥3 硬件匹配去重（代替盲 device_uuid 为主键）
    hardware: collectHw ? info.hardware : null,
  };
}

/** 发送单次事件，成功返回 true；失败返回错误信息 */
async function sendEvent(
  event: TelemetryEvent,
  info: DeviceInfo,
  cfg: Required<TelemetryConfigLike>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${cfg.endpoint}/api/telemetry/event`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPayload(event, info, cfg.collectHwFingerprint)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "网络错误" };
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10); // UTC 自然日，与统计端口径一致
}

/**
 * 执行一次上报调度：
 *  - install 未上报则先报 install
 *  - active 按自然日去重，跨天自动触发
 * 返回本次实际发生的动作，便于页面展示。
 */
export async function reportOnce(force = false): Promise<{ sent: TelemetryEvent[]; error?: string }> {
  const cfg = readConfig();
  if (!cfg.enabled) return { sent: [], error: "遥测已关闭" };

  const info = getDeviceInfo();
  const sent: TelemetryEvent[] = [];

  const persist = (patch: Partial<DeviceInfo>) => {
    const next = { ...info, ...patch, lastReportAt: new Date().toISOString() };
    Object.assign(info, next);
    writeDeviceInfo(info);
  };

  if (!info.installReported) {
    const r = await sendEvent("install", info, cfg);
    if (!r.ok) {
      persist({ lastError: r.error });
      return { sent, error: r.error };
    }
    persist({ installReported: true, lastError: undefined });
    sent.push("install");
  }

  if (force || info.lastActiveDate !== today()) {
    const r = await sendEvent("active", info, cfg);
    if (!r.ok) {
      persist({ lastError: r.error });
      return { sent, error: r.error };
    }
    persist({ lastActiveDate: today(), lastError: undefined });
    sent.push("active");
  }

  return { sent };
}

/** 启动后台心跳：延迟首报后按固定间隔检查（日粒度去重，跨天才真正发请求） */
export function startTelemetryHeartbeat(): void {
  setTimeout(() => {
    void reportOnce();
    setInterval(() => void reportOnce(), HEARTBEAT_INTERVAL_MS);
  }, FIRST_REPORT_DELAY_MS).unref?.();
}

// ---------- 状态与统计 ----------

export interface TelemetryStatus {
  /** 设备 UUID（环境未变时稳定沿用；环境已变则重新生成） */
  uuid: string;
  virtualized: boolean;
  createdAt: string;
  appVersion: string;
  osVersion: string;
  arch: string;
  deviceFile: string;
  /** 硬件环境是否未变化（7 维中 ≥3 匹配） */
  envUnchanged: boolean;
  /** 7 维中匹配的数量 */
  matchCount: number;
  /** 本机设备标识 7 维 */
  hardware: DeviceHardware;
}

export function getTelemetryStatus(): TelemetryStatus {
  const info = getDeviceInfo();
  const stored = readDeviceInfo();
  const current = collectHardwareAttrs();
  const storedHw = stored?.hardware || null;
  return {
    uuid: info.uuid,
    virtualized: info.virtualized,
    createdAt: info.createdAt,
    appVersion: currentAppVersion(),
    osVersion: collectOsVersion(),
    arch: process.arch,
    deviceFile: resolveDeviceFile(),
    envUnchanged: isEnvUnchanged(storedHw, current),
    matchCount: storedHw ? countMatches(storedHw, current) : 7,
    hardware: info.hardware,
  };
}

/**
 * 拉取统计服务端聚合数据（后端代理，避免浏览器跨域）。
 * 约定接口：GET {endpoint}/api/telemetry/stats
 * 服务端未就绪/离线时返回 null，页面优雅降级。
 */
export async function fetchRemoteStats(): Promise<unknown | null> {
  const cfg = readConfig();
  if (!cfg.enabled) return null;
  try {
    const res = await fetch(`${cfg.endpoint}/api/telemetry/stats`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
