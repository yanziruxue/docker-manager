/**
 * 安装量与活跃度上报（仅上报端）
 *
 * 设计依据《Linux应用安装量与活跃用户统计方案（设备唯一标识+风控校验体系）》：
 *  - 主标识（统计主键）：本机硬件指纹 = 主板 + CPU + 内存 + 硬盘 + 显卡 + 安装的系统（6 维哈希）
 *  - 事件：install（首次安装 / 重装 / 标识文件重建）/ active（进程启动、重启、每 12 小时）
 *
 * 文件职责拆分（v1.29.0 起）：
 *  - device.info（标识文件）：deviceId / createdAt(≈安装时间) / virtualized / hardware(安装时快照)
 *    —— **只在创建时写一次**，之后纯只读；仅当「文件被删」或「创建时间与修改时间不一致」时重建。
 *  - telemetry-state.json（运行态）：installReported / lastReportAt / lastActiveAt / lastError
 *    —— 每次上报后写，**不参与标识文件的完整性校验**（避免「写一次」被自己打破）。
 *
 * 上传开关：系统设置 → 本机设备（`settings.telemetry.enabled`，默认开启），关闭后不发任何请求。
 *
 * 容错原则：任何失败（无权限、离线、采集失败）都不得影响主业务。
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { CONFIG_DIR } from "./paths.js";
import { getSettings } from "./settings.js";

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

/**
 * 标识文件：位于应用配置目录（随安装目录持久化），**创建后不再修改**。
 * 普通卸载不清除它（重装仍视为同一设备）。
 */
const DEVICE_FILE = path.join(CONFIG_DIR, "device.info");
/** 运行态文件：每次上报后写，独立于标识文件（不参与「创建时间 / 修改时间」判据） */
const STATE_FILE = path.join(CONFIG_DIR, "telemetry-state.json");

/** 上报周期：12 小时 */
const REPORT_INTERVAL_MS = 12 * 60 * 60 * 1000;
/** 周期判定的宽限：定时器可能比 12 小时整点早几十毫秒，避免因此空转一轮 */
const DUE_SLACK_MS = 60 * 1000;
/** 失败重试间隔：10 分钟（仅针对可重试错误：网络 / 5xx） */
const RETRY_INTERVAL_MS = 10 * 60 * 1000;
/** 启动后延迟首报：避开开机阶段网络未就绪与启动流程资源争抢 */
const FIRST_REPORT_DELAY_MS = 30 * 1000;
/** 单次网络请求超时 */
const REQUEST_TIMEOUT_MS = 10 * 1000;
/** 标识文件重建限流：24 小时内最多重建 1 次（防被外部持续改写导致 install 风暴） */
const REBUILD_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 创建时间 / 修改时间比较容差：创建本身是 create + write 两个动作，可能跨秒 */
const MTIME_TOLERANCE_MS = 2000;

/** 标识文件内容（写一次，之后只读） */
export interface DeviceInfo {
  /** 主标识：本机硬件指纹（主板+CPU+内存+硬盘+显卡+系统 6 维哈希），统计去重唯一依据 */
  deviceId: string;
  /** 标识文件创建时间（≈ 安装时间；重装 / 重建后为新的时间） */
  createdAt: string;
  /** 是否虚拟化环境 */
  virtualized: boolean;
  /** 安装时采集的 6 维硬件快照（与 deviceId 同源，可复算校验；不再刷新） */
  hardware: DeviceHardware;
}

/** 运行态（可随时重写；不进标识文件，故不影响「创建时间 == 修改时间」判据） */
interface TelemetryState {
  /** install 事件是否已成功上报 */
  installReported: boolean;
  /** 最近一次**成功**上报时间 */
  lastReportAt?: string;
  /** 最近一次**成功**上报 active 的时间（周期判定依据） */
  lastActiveAt?: string;
  /** 最近一次标识文件重建时间（重建限流依据） */
  lastRebuildAt?: string;
  /** 最近一次上报错误信息 */
  lastError?: string;
}

// ---------- 标识文件：写一次 + 完整性自愈 ----------

/** 标识文件路径（页面展示用） */
export function getDeviceFilePath(): string {
  return DEVICE_FILE;
}

/** 标识文件完整性判定结果 */
type DeviceFileCheck = "ok" | "missing" | "tampered" | "unknown";

/**
 * 校验标识文件的「创建时间 vs 修改时间」。
 *  - 两者一致（含 1~2 秒容差）→ ok，不做任何修改；
 *  - 修改时间明显晚于创建时间 → tampered，需要重新生成标识文件；
 *  - 创建时间不可用（部分文件系统不提供 btime，Node 会回退成 ctime）→ unknown，宁可放过不误重建。
 *
 * 关键：只比 mtime，**不比 ctime** —— `chmod` / `chown` 只改 ctime，
 * 安装脚本对目录/文件改权限不应被误判为「文件被改写」。
 */
function checkDeviceFile(file: string): DeviceFileCheck {
  try {
    if (!fs.existsSync(file)) return "missing";
    const st = fs.statSync(file);
    const btime = st.birthtimeMs;
    const mtime = st.mtimeMs;
    // btime 不可用或拿到的是 ctime 回退值（btime 比 mtime 还新）→ 跳过校验
    if (!Number.isFinite(btime) || btime <= 0) return "unknown";
    if (btime > mtime) return "unknown";
    if (mtime > btime + MTIME_TOLERANCE_MS) return "tampered";
    return "ok";
  } catch {
    return "unknown";
  }
}

/** 读取标识文件原始 JSON（解析失败返回 null） */
function readDeviceFileRaw(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(DEVICE_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(DEVICE_FILE, "utf-8"));
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 把原始 JSON 归一化为 DeviceInfo（缺 deviceId 视为无效） */
function toDeviceInfo(raw: Record<string, unknown>): DeviceInfo | null {
  if (!raw?.deviceId) return null;
  return {
    deviceId: String(raw.deviceId),
    createdAt: String(raw.createdAt || ""),
    virtualized: !!raw.virtualized,
    hardware: (raw.hardware || {}) as DeviceHardware,
  };
}

/**
 * 写入标识文件（**唯一的写入点**）：权限 0600（chmod 只动 ctime，不影响判据）。
 *
 * ⚠️ 必须「先写临时文件 → 原子替换」，**不能直接覆写已有文件**：
 * 覆写会复用旧 inode，其**创建时间（btime）保持为最初创建时刻**（Linux ext4 / Windows 皆如此），
 * 于是刚重建出来的文件立刻又满足「修改时间 > 创建时间」→ 每次调用都重建，陷入死循环。
 * rename 会带上临时文件自己的 btime，`btime == mtime` 才成立。
 */
function writeDeviceFile(info: DeviceInfo): void {
  try {
    fs.mkdirSync(path.dirname(DEVICE_FILE), { recursive: true });
    const tmp = `${DEVICE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(info, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmp, DEVICE_FILE);
  } catch (e) {
    console.warn("[telemetry] 标识文件写入失败:", (e as Error).message);
  }
}

function readState(): TelemetryState {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      installReported: !!raw?.installReported,
      lastReportAt: raw?.lastReportAt,
      lastActiveAt: raw?.lastActiveAt,
      lastRebuildAt: raw?.lastRebuildAt,
      lastError: raw?.lastError,
    };
  } catch {
    return { installReported: false };
  }
}

function writeState(patch: Partial<TelemetryState>): TelemetryState {
  const next: TelemetryState = { ...readState(), ...patch };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf-8");
  } catch (e) {
    console.warn("[telemetry] 上报状态写入失败:", (e as Error).message);
  }
  return next;
}

/**
 * 老版本把运行态（installReported / lastReportAt）混存在 device.info 里：
 * 升级到「运行态独立文件」后首次读取时迁移一次，避免存量部署升级后被误判为「首次安装」。
 */
function migrateLegacyState(raw: Record<string, unknown>): void {
  const st = readState();
  if (st.installReported) return;
  if (raw?.installReported === true) {
    writeState({
      installReported: true,
      lastReportAt: typeof raw.lastReportAt === "string" ? raw.lastReportAt : undefined,
    });
  }
}

export interface DeviceInfoResult {
  info: DeviceInfo;
  /** 本次是否**重新生成**了标识文件（＝文件被删 / 被改写，视为「重装」） */
  regenerated: boolean;
  /** 本次重建是否**计为一次重新安装**并上报 install（受 24 小时限流保护） */
  reportInstall: boolean;
}

/**
 * 获取本机设备标识（标识文件存在且完好时**只读，不做任何写入**）。
 *
 * 自愈规则（用户需求）：重装 / 更新后启动时校验「创建时间 vs 修改时间」——
 *  - 一致 → 不做任何修改，沿用原标识（含 deviceId 与安装时间）；
 *  - 不一致（或被删）→ **总是重新生成标识文件**（deviceId 按当前硬件指纹重算、安装时间取当下）。
 *
 * 24 小时限流只作用于「是否把这次重建当作一次新的安装上报」：
 * 距上次重建不足 24 小时的重建**照常重建但不上报 install**，避免被外部脚本反复改写时
 * 把统计端的安装量刷成天文数字（也避免重装/删文件的瞬间产生重复安装事件）。
 */
export function getDeviceInfo(): DeviceInfoResult {
  const check = checkDeviceFile(DEVICE_FILE);
  const raw = readDeviceFileRaw();
  const existing = raw ? toDeviceInfo(raw) : null;

  // ① 完好 → 只读返回（绝不回写，否则会破坏「创建时间 == 修改时间」）
  if (check === "ok" && existing) {
    return { info: existing, regenerated: false, reportInstall: false };
  }

  if (raw) migrateLegacyState(raw);

  // ② btime 不可用等无法判定的情形：文件内容可解析就放过，保持原标识
  if (existing && check === "unknown") {
    return { info: existing, regenerated: false, reportInstall: false };
  }

  // ③ 需要重建（文件缺失 / 被改写 / 内容不可解析）：总是重建，install 是否上报看限流
  const lastRebuild = readState().lastRebuildAt;
  const last = lastRebuild ? Date.parse(lastRebuild) : 0;
  const withinLimit =
    Number.isFinite(last) && last > 0 && Date.now() - last < REBUILD_MIN_INTERVAL_MS;
  if (withinLimit) {
    console.warn("[telemetry] 标识文件需要重新生成，但距上次重建不足 24 小时，本次不再上报 install");
  }

  const fp = collectHardwareFingerprint();
  const info: DeviceInfo = {
    deviceId: fp.fingerprint,
    createdAt: new Date().toISOString(),
    virtualized: fp.virtualized,
    hardware: collectHardwareAttrs(),
  };
  writeDeviceFile(info);
  // 限流窗口不因「被限流的重建」而顺延：否则持续被改写时永远报不出下一次 install
  if (!withinLimit) writeState({ lastRebuildAt: info.createdAt });
  return { info, regenerated: true, reportInstall: !withinLimit };
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

// ---------- 设备标识 6 维采集 ----------

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

/**
 * 采集 DMI 标识字段：主板型号 / 产品序列号 / 系统 UUID（只读展示）。
 *
 * 读取顺序：① systemd 以 root 镜像的世界可读副本 `/run/docker-manager-yanzi/dmi-<field>`
 * （内核把 product_serial / product_uuid 的 sysfs 权限设为 0400，非 root 服务直读不到）；
 * ② 回退 sysfs 直读。两者都失败则返回空串（卡片显示「—」）。
 * 注意：本函数只服务展示，不参与 6 维硬件指纹；`collectBoardId()` 保持原样以确保指纹稳定。
 */
function collectDmiIds(): DeviceDetails["dmi"] {
  const read = (field: string) =>
    readTextFile(`/run/docker-manager-yanzi/dmi-${field}`) ||
    readTextFile(`/sys/class/dmi/id/${field}`);
  return {
    boardName: read("board_name"),
    productSerial: read("product_serial"),
    productUuid: read("product_uuid"),
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

/** 上报端点（可用环境变量 TELEMETRY_ENDPOINT 覆盖，便于自建/调试） */
const TELEMETRY_ENDPOINT = process.env.TELEMETRY_ENDPOINT || "https://yanzi-api.ziruxue.top";
/** 上报路径 */
const TELEMETRY_PATH = "/api/yanzi-docker/event";

/**
 * 读取上报配置。`enabled` 取自「系统设置 → 本机设备」的上传开关
 * （`settings.telemetry.enabled`，缺省视为开启）。
 */
function readConfig(): Required<TelemetryConfigLike> {
  let enabled = true;
  try {
    const s = getSettings();
    if (s?.telemetry && typeof s.telemetry.enabled === "boolean") enabled = s.telemetry.enabled;
  } catch {
    /* 读取失败按默认开启 */
  }
  return { enabled, endpoint: TELEMETRY_ENDPOINT, collectHwFingerprint: true };
}

/**
 * 构造上报载荷（本机应用安装信息：硬件标识 + 硬件明细 + 系统 + 应用版本；
 * **不含容器 / 镜像 / 堆栈等任何业务数据，也不含账号信息**）
 * @param uploadEnabled 上传开关当前状态（开启/关闭），随每次上报带出，服务端可记录本机最新 opt-in 状态
 */
function buildPayload(event: TelemetryEvent, info: DeviceInfo, collectHw: boolean, uploadEnabled: boolean) {
  return {
    // 统计主键 = 本机硬件指纹（主板+CPU+内存+硬盘+显卡+系统 6 维哈希）
    device_uuid: info.deviceId,
    // 硬件指纹与统计主键同源，保留以兼容服务端风控字段
    hw_fingerprint: collectHw ? info.deviceId : "",
    event,
    ts: new Date().toISOString(),
    /** 上传开关当前状态（开启/关闭）；不含任何业务数据，仅用于服务端记录本机最新 opt-in 状态 */
    uploadEnabled,
    /** 安装时间（＝标识文件创建时间；重装 / 重建后为新的时间） */
    installedAt: info.createdAt,
    app: "docker-manager-yanzi",
    appVersion: currentAppVersion(),
    os: "linux",
    osVersion: collectOsVersion(),
    arch: process.arch,
    channel: "sea-linux-x64",
    virtualized: info.virtualized,
    /** 标识文件路径（本机 `config/device.info`，对应卡片「标识文件」） */
    deviceFile: DEVICE_FILE,
    // 6 维设备标识（安装时快照，与 deviceId 同源，服务端可复算校验）—— 对应卡片「主板」等
    hardware: collectHw ? info.hardware : null,
    /**
     * 富硬件明细（与「本机设备」卡片逐项对应）：
     * cpu{model,cores,threads,freqGHz} / gpu{model,memory} / memory{model,sizeGB} /
     * disk{serial,model,size} / dmi{boardName,productSerial,productUuid}
     */
    details: collectHw ? collectHardwareDetails() : null,
  };
}

/** 发送单次事件；`fatal=true` 表示鉴权失败（401/403），不做密集重试 */
async function sendEvent(
  event: TelemetryEvent,
  info: DeviceInfo,
  cfg: Required<TelemetryConfigLike>,
  uploadEnabled: boolean
): Promise<{ ok: true } | { ok: false; error: string; fatal: boolean }> {
  const url = `${cfg.endpoint}${TELEMETRY_PATH}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // 鉴权：设备标识（硬件指纹）同时作为 X-Telemetry-Key
        "X-Telemetry-Key": info.deviceId,
      },
      body: JSON.stringify(buildPayload(event, info, cfg.collectHwFingerprint, uploadEnabled)),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const fatal = res.status === 401 || res.status === 403;
      return { ok: false, error: `HTTP ${res.status}`, fatal };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message || "网络错误", fatal: false };
  }
}

/** 下一次计划上报时间（含失败重试），页面展示用 */
let nextAttemptAt: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/** 距上次**成功**上报 active 是否已满 12 小时周期（从未成功过则视为到期） */
function dueForActive(state: TelemetryState): boolean {
  if (!state.lastActiveAt) return true;
  const t = Date.parse(state.lastActiveAt);
  return !Number.isFinite(t) || Date.now() - t >= REPORT_INTERVAL_MS - DUE_SLACK_MS;
}

/**
 * 执行一次上报：
 *  - 标识文件被删 / 被改写 → 重新生成标识文件；若距上次重建已满 24 小时，
 *    则视为重装并上报 `install`（附带新的安装时间）；
 *  - 否则若距上次 active 成功已满 12 小时（或从未成功过）→ 上报 `active`；
 *  - `force=true` 忽略周期判断（进程启动/重启首报、页面「立即上报」）。
 * 任何失败都只写运行态 `lastError`，不抛异常、不影响主业务。
 */
export async function reportOnce(force = false): Promise<{ sent: TelemetryEvent[]; error?: string; fatal?: boolean }> {
  const cfg = readConfig();
  if (!cfg.enabled) return { sent: [], error: "上传已关闭" };

  const { info, reportInstall } = getDeviceInfo();
  const state = readState();
  const sent: TelemetryEvent[] = [];

  const needInstall = reportInstall || !state.installReported;
  const needActive = !needInstall && (force || dueForActive(state));
  const action: TelemetryEvent | null = needInstall ? "install" : needActive ? "active" : null;
  if (!action) return { sent };

  const r = await sendEvent(action, info, cfg, cfg.enabled);
  const now = new Date().toISOString();
  if (!r.ok) {
    writeState({ lastError: r.error });
    return { sent, error: r.error, fatal: r.fatal };
  }
  // install 同样刷新活跃时间（远端据此判定在线）
  writeState({
    installReported: true,
    lastReportAt: now,
    lastActiveAt: now,
    lastError: undefined,
  });
  sent.push(action);
  return { sent };
}

/**
 * 上传开关变更时立即上报（开启或关闭都触发）。
 * - 开启：以 `enabled=true` 走正常载荷，依次上报 `install`（如需）与 `active`。
 * - 关闭：`reportOnce` 会因 `!cfg.enabled` 直接返回「上传已关闭」而不发请求，
 *   这里强制以 `{ ...readConfig(), enabled: true }` 绕过守卫，仍把最新开关状态透出。
 * 不论开启或关闭，都**同时上报 install 与 active**（install 成功必带 active），
 * 载荷携带 `uploadEnabled` 字段（＝本次开关新值），使服务端可记录本机最新 opt-in 状态。
 * 任何失败只写运行态 `lastError`，不影响主业务。
 */
export async function reportOnToggle(enabled: boolean): Promise<{ sent: TelemetryEvent[]; error?: string; fatal?: boolean }> {
  const { info } = getDeviceInfo();
  // 强制 enabled:true 以绕过 reportOnce 的「上传已关闭」提前返回；真实开关态走 uploadEnabled 字段
  const cfg = { ...readConfig(), enabled: true };
  const sent: TelemetryEvent[] = [];
  let lastError: string | undefined;
  let fatal = false;

  // 先 install 后 active；发 install 必发 active
  for (const event of ["install", "active"] as TelemetryEvent[]) {
    const r = await sendEvent(event, info, cfg, enabled);
    if (!r.ok) {
      lastError = r.error;
      fatal = fatal || r.fatal;
      continue;
    }
    sent.push(event);
  }

  const now = new Date().toISOString();
  const patch: Partial<TelemetryState> = { lastReportAt: now, lastActiveAt: now, lastError };
  if (sent.includes("install")) patch.installReported = true;
  writeState(patch);
  return { sent, error: lastError, fatal };
}

/** 安排下一次上报；`force` 表示这次必须发（启动首报 / 失败重试） */
function scheduleNext(delayMs: number, force: boolean): void {
  if (timer) clearTimeout(timer);
  nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
  timer = setTimeout(() => {
    void (async () => {
      const r = await reportOnce(force);
      // 可重试错误（网络 / 5xx）10 分钟后再试；鉴权失败（401/403）不密集重试，等下一个周期
      const retry = !!r.error && !r.fatal;
      scheduleNext(retry ? RETRY_INTERVAL_MS : REPORT_INTERVAL_MS, retry);
    })();
  }, delayMs);
  // 定时器不应阻止进程退出
  (timer as unknown as { unref?: () => void }).unref?.();
}

/**
 * 启动后台上报：进程启动 / 重启后延迟 30 秒首报（安装或活跃），
 * 之后每 12 小时一次，失败则 10 分钟重试。
 */
export function startTelemetryHeartbeat(): void {
  if (started) return;
  started = true;
  scheduleNext(FIRST_REPORT_DELAY_MS, true);
}

// ---------- 状态 ----------

export interface TelemetryStatus {
  /** 设备标识（硬件指纹 6 维哈希，统计主键） */
  deviceId: string;
  virtualized: boolean;
  /** 标识文件创建时间（≈ 安装时间） */
  createdAt: string;
  appVersion: string;
  osVersion: string;
  arch: string;
  /** 标识文件路径 */
  deviceFile: string;
  /** 运行态文件路径 */
  stateFile: string;
  /** 上传开关（系统设置 → 本机设备） */
  enabled: boolean;
  /** 上报端点（便于排查） */
  endpoint: string;
  /** 上报周期（小时） */
  reportIntervalHours: number;
  /** 是否已成功上报过 install */
  installReported: boolean;
  /** 最近一次成功上报时间 */
  lastReportAt?: string;
  /** 最近一次成功上报 active 的时间 */
  lastActiveAt?: string;
  /** 下一次计划上报时间（含失败重试） */
  nextReportAt?: string;
  /** 最近一次上报错误信息 */
  lastError?: string;
  /** 硬件环境是否与标识生成时一致（仅提示，不再触发身份重建） */
  envUnchanged: boolean;
  /** 已识别的硬件维度数（0-6） */
  matchCount: number;
  /** 实时采集的 6 维（页面展示用；标识文件里保存的是安装时快照） */
  hardware: DeviceHardware;
  /** 设备标识卡片展示用的富硬件详情（CPU/GPU/内存/硬盘） */
  details: DeviceDetails;
}

export function getTelemetryStatus(): TelemetryStatus {
  const { info } = getDeviceInfo();
  const state = readState();
  const cfg = readConfig();
  const current = collectHardwareAttrs();
  const currentDeviceId = collectHardwareFingerprint().fingerprint;
  return {
    deviceId: info.deviceId,
    virtualized: info.virtualized,
    createdAt: info.createdAt,
    appVersion: currentAppVersion(),
    osVersion: collectOsVersion(),
    arch: process.arch,
    deviceFile: DEVICE_FILE,
    stateFile: STATE_FILE,
    enabled: cfg.enabled,
    endpoint: cfg.endpoint,
    reportIntervalHours: Math.round(REPORT_INTERVAL_MS / 3600000),
    installReported: state.installReported,
    lastReportAt: state.lastReportAt,
    lastActiveAt: state.lastActiveAt,
    nextReportAt: nextAttemptAt ?? undefined,
    lastError: state.lastError,
    envUnchanged: info.deviceId === currentDeviceId,
    matchCount: countNonEmpty(current),
    hardware: current,
    details: collectHardwareDetails(),
  };
}
