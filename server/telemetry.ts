/**
 * 安装量与活跃度遥测（仅上报端）
 *
 * 设计依据《Linux应用安装量与活跃用户统计方案（设备唯一标识+风控校验体系）》：
 *  - 主标识（统计主键）：本机硬件指纹 = 主板 + CPU + 内存 + 硬盘 + 显卡 + 安装的系统（6 维哈希）
 *  - 取消随机设备 UUID 作为标识：环境连续性直接由硬件指纹一致性决定（硬件指纹不变 = 同一设备）
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

/** 本机设备标识的 6 维硬件属性（统计主键 = 这 6 维的哈希，不依赖随机 UUID） */
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
  /** 主标识：本机硬件指纹（主板+CPU+内存+硬盘+显卡+系统 6 维哈希），统计去重唯一依据 */
  deviceId: string;
  /** 首次生成时间（≈ 首次安装时间） */
  createdAt: string;
  /** 是否虚拟化环境 */
  virtualized: boolean;
  /** 本机设备标识 6 维（系统/CPU/GPU/内存/硬盘UID/主板序列号） */
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
    if (!raw?.deviceId) return null;
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
 * 设备身份 = 本机硬件指纹（主板+CPU+内存+硬盘+显卡+系统 6 维哈希）：
 *  - 硬件指纹与已存记录一致 → 同一设备，沿用身份（仅刷新硬件快照）；
 *  - 无历史记录或硬件指纹变化 → 新设备，重新按当前硬件生成设备标识（install 重新上报）。
 * 不再使用随机设备 UUID 作为统计主键。
 */
export function getDeviceInfo(): DeviceInfo {
  const current = collectHardwareAttrs();
  const fp = collectHardwareFingerprint();
  const deviceId = fp.fingerprint;
  const existing = readDeviceInfo();

  // 无历史记录，或硬件指纹变化（环境已变）→ 视为新设备
  if (!existing || existing.deviceId !== deviceId) {
    const info: DeviceInfo = {
      deviceId,
      createdAt: new Date().toISOString(),
      virtualized: fp.virtualized,
      hardware: current,
      installReported: false,
      lastActiveDate: "",
    };
    writeDeviceInfo(info);
    return info;
  }

  // 硬件环境未变：沿用同一设备身份，仅刷新硬件快照
  existing.hardware = current;
  writeDeviceInfo(existing);
  return existing;
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
 * 采集硬件指纹（= 统计主键）。
 * 维度：系统 + CPU + 内存 + 硬盘 + 显卡 + 主板（6 维）。
 * 规则：虚拟环境六项统一归零后再哈希（避免虚拟机硬件同质化导致指纹碰撞）；
 *      采集失败字段保留空占位，避免字段缺失引发碰撞。
 */
export function collectHardwareFingerprint(): { fingerprint: string; virtualized: boolean } {
  const virtualized = detectVirtualization();
  const system = virtualized ? "0" : collectOsVersion();
  const cpu = virtualized ? "0" : collectCpuId();
  const gpu = virtualized ? "0" : collectGpu();
  const memory = virtualized ? "0" : collectMemory();
  const disk = virtualized ? "0" : collectDiskId();
  const board = virtualized ? "0" : collectBoardId();
  const raw = [system, cpu, gpu, memory, disk, board].join("|");
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex");
  return { fingerprint, virtualized };
}

// ---------- 设备标识 7 维采集（≥3 匹配决定硬件环境是否变化） ----------

/**
 * 从 /sys/bus/pci/devices 直读 GPU 型号（不依赖 lspci，普通用户可读，
 * 绕过非 root systemd 服务下 lspci 受限/PATH 缺失导致 GPU 识别为空的问题）。
 * 仅匹配 PCI class 0x03xx（显示控制器：VGA / 3D / Display）。
 */
function collectGpuFromSysfs(): string {
  try {
    const devDir = "/sys/bus/pci/devices";
    if (!fs.existsSync(devDir)) return "";
    for (const e of fs.readdirSync(devDir)) {
      const cls = readTextFile(path.join(devDir, e, "class"));
      if (!/^0x03/i.test(cls.trim())) continue; // 仅显示控制器（0x03xx）
      const vendor = readTextFile(path.join(devDir, e, "vendor"));
      const device = readTextFile(path.join(devDir, e, "device"));
      if (vendor && device) {
        const name = resolvePciName(vendor, device);
        if (name) return name;
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** 解析 pci.ids 数据库：vendor/device 形如 0x8086 / 0x1916，返回「厂商 设备」型号串 */
function resolvePciName(vendorHex: string, deviceHex: string): string {
  const vid = vendorHex.replace(/^0x/i, "").toLowerCase();
  const did = deviceHex.replace(/^0x/i, "").toLowerCase();
  for (const db of ["/usr/share/misc/pci.ids", "/usr/share/hwdata/pci.ids", "/usr/share/pci.ids"]) {
    const txt = readTextFile(db);
    if (!txt) continue;
    let inTargetVendor = false;
    let vendorName = "";
    for (const line of txt.split("\n")) {
      if (line.startsWith("#") || line.trim() === "") continue;
      if (/^\s/.test(line)) {
        // 缩进行：设备 / 子系统（厂商块内）
        const m = line.match(/^\s+([0-9a-f]{4})\s+(\S.*)$/);
        if (m && inTargetVendor && m[1] === did) return `${vendorName} ${m[2].trim()}`;
      } else {
        // 厂商行
        const m = line.match(/^([0-9a-f]{4})\s+(\S.*)$/);
        if (m) {
          if (m[1] === vid) {
            inTargetVendor = true;
            vendorName = m[2].trim();
          } else if (inTargetVendor) {
            break; // 已离开目标厂商块
          }
        }
      }
    }
  }
  return `Vendor ${vid} Device ${did}`;
}

/** 采集 GPU 标识：sysfs 直读优先（非 root 服务可识别），lspci 兜底，nvidia-smi 再兜底，失败返回空串 */
function collectGpu(): string {
  const sysfs = collectGpuFromSysfs();
  if (sysfs) return sysfs.slice(0, 120);
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

/** 采集 6 维设备标识（系统/CPU/GPU/内存/硬盘UID/主板序列号） */
export function collectHardwareAttrs(): DeviceHardware {
  return {
    system: collectOsVersion(),
    cpu: collectCpuId(),
    gpu: collectGpu(),
    memory: collectMemory(),
    diskUid: collectDiskId(),
    boardSerial: collectBoardId(),
  };
}

/** 统计 6 维中非空属性数量（用于展示硬件识别度，0-6） */
export function countNonEmpty(hw: DeviceHardware): number {
  const keys: (keyof DeviceHardware)[] = ["system", "cpu", "gpu", "memory", "diskUid", "boardSerial"];
  return keys.filter((k) => (hw[k] || "").trim()).length;
}

// ---------- 设备标识卡片富硬件详情（仅本地展示，不参与统计指纹） ----------

/** 本机设备标识卡片展示用的富硬件详情（不参与硬件指纹哈希，改动不影响统计主键） */
export interface DeviceDetails {
  cpu: { model: string; cores: number; threads: number; freqGHz: number };
  gpu: { model: string; memory: string };
  memory: { model: string; sizeGB: number };
  disk: { serial: string; model: string; size: string };
  /** DMI 标识字段（只读展示，不参与指纹）：主板型号 / 产品序列号 / 系统 UUID */
  dmi: { boardName: string; productSerial: string; productUuid: string };
}

/** 读取 /proc/cpuinfo 首个指定字段的值 */
function readProcCpuinfoField(field: string): string {
  try {
    const txt = fs.readFileSync("/proc/cpuinfo", "utf-8");
    const line = txt.split("\n").find((l) => l.startsWith(field));
    return line ? (line.split(":")[1]?.trim() || "") : "";
  } catch {
    return "";
  }
}

/** 采集 CPU 富详情：型号 / 物理核数 / 逻辑线程数 / 最高频率(GHz) */
function collectCpuDetails(): DeviceDetails["cpu"] {
  const model = readProcCpuinfoField("model name");
  let threads = 0;
  const nproc = tryExec("nproc", []);
  if (nproc) threads = parseInt(nproc, 10) || 0;
  const lscpu = tryExec("lscpu", []);
  const perSocket = lscpu.match(/Core\(s\) per socket:\s*(\d+)/)?.[1];
  const sockets = lscpu.match(/Socket\(s\):\s*(\d+)/)?.[1];
  let cores = 0;
  if (perSocket && sockets) cores = parseInt(perSocket, 10) * parseInt(sockets, 10);
  else {
    const cc = readProcCpuinfoField("cpu cores");
    if (cc) cores = parseInt(cc, 10) || 0;
  }
  let freqGHz = 0;
  const maxMhz = lscpu.match(/CPU max MHz:\s*([\d.]+)/)?.[1];
  if (maxMhz) freqGHz = parseFloat(maxMhz) / 1000;
  else {
    const curMhz = readProcCpuinfoField("cpu MHz");
    if (curMhz) freqGHz = parseFloat(curMhz) / 1000;
  }
  if (freqGHz) freqGHz = Number(freqGHz.toFixed(2));
  return { model, cores, threads, freqGHz };
}

/** 采集 GPU 富详情：型号 / 显存（nvidia-smi 优先） */
function collectGpuDetails(): DeviceDetails["gpu"] {
  const model = collectGpu();
  let memory = "";
  const vram = tryExec("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader"]);
  if (vram) memory = vram.trim().replace(/\s+/g, " ");
  return { model, memory };
}

/** 采集内存富详情：型号(Part Number) / 总容量(GB) */
function collectMemoryDetails(): DeviceDetails["memory"] {
  let model = "";
  const dmi = tryExec("dmidecode", ["-t", "memory"]);
  const pn = dmi.match(/Part Number:\s*(\S+)/i)?.[1];
  if (pn && !/^(Not|Unknown|NO DIMM|None)/i.test(pn)) model = pn;
  const sizeGB = Math.round(os.totalmem() / 1024 / 1024 / 1024);
  return { model, sizeGB };
}

/** 采集硬盘富详情：序列号 / 型号 / 大小（取首个物理盘） */
function collectDiskDetails(): DeviceDetails["disk"] {
  const serial = collectDiskId();
  const firstPhysical = (out: string) =>
    out.split("\n").map((s) => s.trim()).find((s) => s && !/^(loop|ram|sr|zram)/i.test(s)) || "";
  const model = firstPhysical(tryExec("lsblk", ["-d", "-n", "-o", "MODEL"]));
  const size = firstPhysical(tryExec("lsblk", ["-d", "-n", "-o", "SIZE"]));
  return { serial, model, size };
}

/** 采集 DMI 标识字段：主板型号 / 产品序列号 / 系统 UUID（sysfs 直读，失败降级空串，普通用户可读） */
function collectDmiIds(): DeviceDetails["dmi"] {
  return {
    boardName: readTextFile("/sys/class/dmi/id/board_name"),
    productSerial: readTextFile("/sys/class/dmi/id/product_serial"),
    productUuid: readTextFile("/sys/class/dmi/id/product_uuid"),
  };
}

/** 采集设备标识卡片所需的富硬件详情（只读展示，不影响 6 维指纹与统计主键） */
export function collectHardwareDetails(): DeviceDetails {
  return {
    cpu: collectCpuDetails(),
    gpu: collectGpuDetails(),
    memory: collectMemoryDetails(),
    disk: collectDiskDetails(),
    dmi: collectDmiIds(),
  };
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
    // 统计主键 = 本机硬件指纹（主板+CPU+内存+硬盘+显卡+系统 6 维哈希）；
    // 不再使用随机设备 UUID 作为标识。
    device_uuid: info.deviceId,
    // 硬件指纹与统计主键同源（均为 6 维哈希），保留以兼容服务端风控字段
    hw_fingerprint: collectHw ? info.deviceId : "",
    event,
    ts: new Date().toISOString(),
    app: "docker-manager-yanzi",
    appVersion: currentAppVersion(),
    os: "linux",
    osVersion: collectOsVersion(),
    arch: process.arch,
    channel: "sea-linux-x64",
    virtualized: info.virtualized,
    // 6 维设备标识：统计服务端据此做硬件指纹一致性校验（取代旧的 device_uuid 主键）
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
  /** 本机设备标识 6 维（统计主键维度，不对外展示敏感序列号） */
  hardware: DeviceHardware;
  /** 设备标识卡片展示用的富硬件详情（CPU/GPU/内存/硬盘） */
  details: DeviceDetails;
}

export function getTelemetryStatus(): TelemetryStatus {
  const info = getDeviceInfo();
  const current = collectHardwareAttrs();
  const currentDeviceId = collectHardwareFingerprint().fingerprint;
  const stored = readDeviceInfo();
  return {
    deviceId: info.deviceId,
    virtualized: info.virtualized,
    createdAt: info.createdAt,
    appVersion: currentAppVersion(),
    osVersion: collectOsVersion(),
    arch: process.arch,
    deviceFile: resolveDeviceFile(),
    envUnchanged: stored ? stored.deviceId === currentDeviceId : true,
    matchCount: countNonEmpty(current),
    hardware: info.hardware,
    details: collectHardwareDetails(),
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
