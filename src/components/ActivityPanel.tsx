import React, { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  Copy,
  Check,
  Loader2,
  Eye,
  EyeOff,
  AlertTriangle,
  UploadCloud,
  Thermometer,
  HardDrive,
} from "lucide-react";
import {
  fetchTelemetryStatus,
  fetchServiceUnitStatus,
  fetchThermalStatus,
  type TelemetryStatus,
  type DeviceHardware,
  type DeviceDetails,
  type ServiceUnitStatus,
  type ThermalStatus,
} from "../api";
import { copyText } from "../lib/clipboard";
import { tempTextColor, fmtTemp } from "../lib/thermal";
import { Card, Toggle } from "./UI";

/** 单条「标签：值」展示行 */
function Row({
  label,
  value,
  mono,
  span2,
  title,
}: {
  label: string;
  value: string;
  mono?: boolean;
  span2?: boolean;
  title?: string;
}) {
  return (
    <div className={`flex justify-between gap-2${span2 ? " sm:col-span-2" : ""}`}>
      <span className="text-slate-500 flex-shrink-0">{label}</span>
      <span
        className={`text-slate-700 truncate text-right${mono ? " font-mono text-xs" : ""}`}
        title={title || value}
      >
        {value || "—"}
      </span>
    </div>
  );
}

/** 时间戳 → 本地时间串（无效值返回空串） */
function fmtTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

/** CPU：型号 核心数 线程数 频率 */
function fmtCpu(c?: DeviceDetails["cpu"]): string {
  if (!c) return "";
  const parts: string[] = [];
  if (c.model) parts.push(c.model);
  const spec: string[] = [];
  if (c.cores) spec.push(`${c.cores} 核`);
  if (c.threads) spec.push(`${c.threads} 线程`);
  if (c.freqGHz) spec.push(`${c.freqGHz} GHz`);
  if (spec.length) parts.push(spec.join(" "));
  return parts.join("  ");
}

/** GPU：型号 显存 */
function fmtGpu(g?: DeviceDetails["gpu"]): string {
  if (!g) return "";
  const parts: string[] = [];
  if (g.model) parts.push(g.model);
  if (g.memory) parts.push(g.memory);
  return parts.join("  ");
}

/** 内存：型号 大小 */
function fmtMem(m?: DeviceDetails["memory"]): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.model) parts.push(m.model);
  if (m.sizeGB) parts.push(`${m.sizeGB} GB`);
  return parts.join("  ");
}

/** 硬盘：序列号 型号 大小 */
function fmtDisk(d?: DeviceDetails["disk"]): string {
  if (!d) return "";
  const parts: string[] = [];
  if (d.serial) parts.push(d.serial);
  if (d.model) parts.push(d.model);
  if (d.size) parts.push(d.size);
  return parts.join("  ");
}

/** 加载 drivetemp 的持久化命令（重启后仍生效） */
const DRIVETEMP_CMD = "echo drivetemp | sudo tee /etc/modules-load.d/drivetemp.conf && sudo modprobe drivetemp";

/**
 * 硬件信息（只读设备标识 / 温度）+ 安装数量上传开关。
 *
 * 设备标识 = 本机硬件指纹（主板+CPU+内存+硬盘+显卡+安装的系统 6 维哈希），
 * 作为安装量 / 活跃度统计的统计主键；标识文件创建后不再修改，只有被删或被改写才会重新生成。
 *
 * 温度卡片：CPU（sysfs hwmon `coretemp` / `k10temp`，回退 `/sys/class/thermal`）+ 各整盘温度
 * （NVMe 自带 hwmon；SATA/HDD 需内核 `drivetemp` 模块）。全部读 sysfs，**无需 root**。
 *
 * 上传开关（`settings.telemetry.enabled`，默认开启）：关闭后不再向远端发送任何数据。
 * 开关值由设置页持有（单一写入方），改动后点右下角「APPLY」保存生效。
 *
 * 另附「服务单元落后」提示：单元文件由 install.sh 安装、OTA 不更新，落后时
 * 依赖新指令的功能（如 root 镜像 DMI 序列号）会静默失效，需提示用户重装单元。
 */
export function ActivityPanel({
  telemetryEnabled,
  onTelemetryEnabledChange,
}: {
  /** 上传开关当前值（来自系统设置；未传入时回退用后端返回值展示） */
  telemetryEnabled?: boolean;
  /** 切换上传开关（改动后需点「APPLY」保存） */
  onTelemetryEnabledChange?: (val: boolean) => void;
} = {}) {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [unit, setUnit] = useState<ServiceUnitStatus | null>(null);
  const [thermal, setThermal] = useState<ThermalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUuid, setShowUuid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fixCopied, setFixCopied] = useState(false);
  const [modCopied, setModCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // 单元状态 / 遥测状态 / 温度并行取；任一失败不影响其它卡片
    const [s, u, t] = await Promise.all([
      fetchTelemetryStatus().catch(() => null),
      fetchServiceUnitStatus().catch(() => null),
      fetchThermalStatus().catch(() => null),
    ]);
    // 静默失败：保留空态，不干扰其它设置
    if (s) setStatus(s);
    setUnit(u);
    setThermal(t);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyUuid = async () => {
    if (!status) return;
    if (await copyText(status.deviceId)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const copyFix = async () => {
    if (!unit?.fixCommand) return;
    if (await copyText(unit.fixCommand)) {
      setFixCopied(true);
      setTimeout(() => setFixCopied(false), 1500);
    }
  };

  const copyMod = async () => {
    if (await copyText(DRIVETEMP_CMD)) {
      setModCopied(true);
      setTimeout(() => setModCopied(false), 1500);
    }
  };

  const maskedUuid = status
    ? `${status.deviceId.slice(0, 8)}${"•".repeat(24)}${status.deviceId.slice(-4)}`
    : "—";

  const hw: DeviceHardware | undefined = status?.hardware;
  const details: DeviceDetails | undefined = status?.details;

  const unitStale = !!unit && unit.applicable && !unit.upToDate;
  /** DMI 两行恒为空时的悬停提示：区分「单元没更新 / 服务没重启 / BIOS 没烧录」 */
  const dmiHint =
    !unit || !unit.applicable
      ? "需 root 权限读取（内核 sysfs 权限 0400）"
      : unitStale
        ? "系统服务单元落后：服务启动前未镜像 DMI 值，请按上方提示更新服务单元"
        : unit.mirrorFiles.length === 0
          ? "服务单元已是最新，但 DMI 镜像尚未生成（重启服务即可）"
          : "镜像已生成；仍为空说明 BIOS 未烧录该字段";

  /** 上传开关：优先用设置页传入的值，其次用后端已保存的值（默认开启） */
  const enabled = telemetryEnabled ?? status?.enabled ?? true;
  /** 已改动但尚未保存（与后端已保存值不一致） */
  const enabledDirty =
    telemetryEnabled !== undefined && !!status && telemetryEnabled !== status.enabled;

  /** SATA/HDD 缺温度且 drivetemp 未加载 ⇒ 给加载提示（NVMe 无需该模块） */
  const needDrivetemp = !!thermal && !thermal.drivetempLoaded && thermal.sataWithoutTemp.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">硬件信息</h2>
      </div>

      {/* 服务单元落后提示：单元由 install.sh 安装，OTA 不更新它 */}
      {unitStale && unit && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="min-w-0 space-y-1">
              <div className="font-medium">
                系统服务单元落后，缺少 {unit.missing.length} 条指令
              </div>
              <div className="text-amber-700 leading-relaxed">
                该文件由安装脚本写入 <span className="font-mono">{unit.unitPath}</span>
                ，在线升级不会更新它，因此部分功能静默失效（如「产品序列号 / 系统UUID」需服务启动前以
                root 读取 DMI）。
              </div>
              <div className="font-mono text-[11px] text-amber-700 break-all">
                {unit.missing.join("  ")}
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  onClick={copyFix}
                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                >
                  {fixCopied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
                  {fixCopied ? "已复制" : "复制修复命令"}
                </button>
                <span className="text-amber-600">在服务器上以 root 执行；会覆盖该单元并重启服务</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 温度：CPU + 各整盘（读 sysfs hwmon，无需 root） */}
      <Card title="温度" icon={<Thermometer size={16} />}>
        {loading && !thermal ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </div>
        ) : thermal ? (
          <div className="space-y-3">
            {/* CPU 温度 */}
            <div className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Cpu size={14} className="text-slate-400" />
                CPU 温度
              </div>
              <div className="min-w-0 text-right">
                {thermal.cpu ? (
                  <div className={`font-mono text-sm ${tempTextColor(thermal.cpu.tempC)}`}>
                    {fmtTemp(thermal.cpu.tempC)}
                  </div>
                ) : (
                  <div
                    className="text-sm text-slate-400"
                    title="未识别到 CPU 温度传感器（内核 coretemp / k10temp / zenpower，或 /sys/class/thermal 的 x86_pkg_temp）"
                  >
                    —
                  </div>
                )}
                <div className="text-[11px] text-slate-400 truncate">
                  {thermal.cpu ? `传感器 ${thermal.cpu.source}` : "无传感器"}
                </div>
              </div>
            </div>

            {/* 各整盘温度 */}
            <div className="grid grid-cols-1 gap-y-2 text-sm">
              <div className="text-xs text-slate-500">
                硬盘温度{thermal.disks.length > 0 ? `（${thermal.disks.length} 块设备）` : ""}
              </div>
              {thermal.disks.length === 0 ? (
                <div className="text-sm text-slate-400 py-1">
                  未检测到整盘设备（仅本机引擎可读取 sysfs）
                </div>
              ) : (
                thermal.disks.map((d) => (
                  <div key={d.name} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-slate-500 min-w-0">
                      <HardDrive size={13} className="text-slate-400 flex-shrink-0" />
                      <span className="font-mono text-xs truncate">{d.name}</span>
                    </span>
                    {typeof d.tempC === "number" ? (
                      <span className={`font-mono ${tempTextColor(d.tempC)}`}>{fmtTemp(d.tempC)}</span>
                    ) : (
                      <span
                        className="text-slate-400"
                        title="无温度传感器，或 SATA 盘未加载 drivetemp 内核模块"
                      >
                        —
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* drivetemp 未加载提示：只对「缺温度的 SATA 盘」出现，NVMe-only 机器不打扰 */}
            {needDrivetemp && thermal && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">
                      检测到 {thermal.sataWithoutTemp.length} 块 SATA 盘没有温度
                    </div>
                    <div className="text-amber-700 leading-relaxed">
                      <span className="font-mono">{thermal.sataWithoutTemp.join("  ")}</span>{" "}
                      缺温度是因为内核未加载 <span className="font-mono">drivetemp</span> 模块
                      （NVMe 盘由 nvme 驱动自带，不受影响）。
                      <span className="font-medium">安装脚本（install.sh）会自动加载</span>
                      ；在线升级不更新安装脚本，老部署可手动执行下面这条命令（无需重启）：
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <button
                        onClick={copyMod}
                        className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100"
                        title={DRIVETEMP_CMD}
                      >
                        {modCopied ? (
                          <Check size={12} className="text-green-600" />
                        ) : (
                          <Copy size={12} />
                        )}
                        {modCopied ? "已复制" : "复制加载命令"}
                      </button>
                      <span className="text-amber-600">含写入 modules-load.d，重启后仍生效</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {thermal.disks.length === 0 && !thermal.cpu && (
              <div className="text-[11px] text-slate-400 leading-relaxed">
                温度全部读自内核 sysfs（世界可读，无需 root）；远程引擎无法读取宿主 sysfs，故此处为空。
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-400">温度数据不可用</div>
        )}
      </Card>

      <Card title="硬件信息标识" icon={<Cpu size={16} />}>
        {loading && !status ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </div>
        ) : status ? (
          <div className="space-y-3">
            {/* 设备标识（硬件指纹） */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 mb-1">设备标识（硬件指纹，统计主键）</div>
                <div className="font-mono text-sm text-slate-700 break-all">
                  {showUuid ? status.deviceId : maskedUuid}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setShowUuid(!showUuid)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
                  title={showUuid ? "隐藏" : "显示完整标识"}
                >
                  {showUuid ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={copyUuid}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
                  title="复制标识"
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* 安装数量上传开关 */}
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                    <UploadCloud size={14} className="text-slate-400" />
                    上传安装数量统计
                  </div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-500">
                    仅上传本机应用安装信息用于安装数量收集，
                    <span className="text-slate-600">不含容器 / 镜像 / 堆栈等任何业务数据，也不含账号信息</span>
                    。默认开启，可随时关闭；关闭后不再发送任何数据。
                  </div>
                </div>
                <div className="flex-shrink-0 pt-0.5">
                  <Toggle active={enabled} onChange={onTelemetryEnabledChange} />
                </div>
              </div>
              {(enabledDirty || !enabled) && (
                <div className="mt-2 border-t border-slate-200 pt-2 text-[11px] leading-relaxed text-amber-600">
                  {enabledDirty
                    ? "已修改，点右下角「APPLY」保存后生效。"
                    : "当前为关闭状态（已保存）。"}
                </div>
              )}
            </div>

            {/* 上报状态 */}
            <div className="grid grid-cols-1 gap-y-2 text-sm border-t border-slate-100 pt-3">
              <Row label="安装时间" value={fmtTime(status.createdAt)} title={status.createdAt} />
            </div>

            {/* 明细：一行一条 */}
            <div className="grid grid-cols-1 gap-y-2 text-sm border-t border-slate-100 pt-3">
              <Row label="运行环境" value={status.virtualized ? "虚拟化 / 容器" : "物理机"} />
              <Row label="应用版本" value={`v${status.appVersion}`} />
              <Row label="架构" value={status.arch} />
              <Row label="系统" value={status.osVersion} title={status.osVersion} />
              <Row
                label="标识文件"
                value={status.deviceFile}
                mono
                title={status.deviceFile}
              />
              <Row label="主板" value={hw?.boardSerial ?? ""} mono title={hw?.boardSerial} />
              <Row label="主板型号" value={details?.dmi?.boardName ?? ""} title={details?.dmi?.boardName} />
              <Row
                label="产品序列号"
                value={details?.dmi?.productSerial ?? ""}
                mono
                title={details?.dmi?.productSerial || dmiHint}
              />
              <Row
                label="系统UUID"
                value={details?.dmi?.productUuid ?? ""}
                mono
                title={details?.dmi?.productUuid || dmiHint}
              />
              <Row label="CPU" value={fmtCpu(details?.cpu)} title={fmtCpu(details?.cpu)} />
              <Row label="GPU" value={fmtGpu(details?.gpu)} title={fmtGpu(details?.gpu)} />
              <Row label="内存" value={fmtMem(details?.memory)} title={fmtMem(details?.memory)} />
              <Row
                label="硬盘"
                value={fmtDisk(details?.disk)}
                title={fmtDisk(details?.disk)}
              />
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">暂无设备信息</div>
        )}
      </Card>
    </div>
  );
}
