import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Copy, Check, Loader2, Eye, EyeOff } from "lucide-react";
import {
  fetchTelemetryStatus,
  type TelemetryStatus,
  type DeviceHardware,
  type DeviceDetails,
} from "../api";
import { copyText } from "../lib/clipboard";
import { Card } from "./UI";

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

/**
 * 本机设备标识（只读）。
 * 设备标识 = 本机硬件指纹（主板+CPU+内存+硬盘+显卡+安装的系统 6 维哈希），
 * 作为安装量 / 活跃度统计的统计主键；硬件指纹不变即视为同一设备。
 * 卡片按「设备标识 / 运行环境 / 应用版本 / 架构 / 系统 / 标识文件 / 主板 / CPU / GPU / 内存 / 硬盘」展示。
 */
export function ActivityPanel() {
  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [showUuid, setShowUuid] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await fetchTelemetryStatus();
      setStatus(s);
    } catch {
      // 静默失败：保留空态，不干扰其它设置
    } finally {
      setLoading(false);
    }
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

  const maskedUuid = status
    ? `${status.deviceId.slice(0, 8)}${"•".repeat(24)}${status.deviceId.slice(-4)}`
    : "—";

  const hw: DeviceHardware | undefined = status?.hardware;
  const details: DeviceDetails | undefined = status?.details;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">本机设备</h2>
        <p className="text-sm text-slate-500">
          设备唯一标识与硬件指纹（用于安装量 / 活跃度统计，自动静默上报）
        </p>
      </div>

      <Card title="本机设备标识" icon={<Cpu size={16} />}>
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

            {/* 明细 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-slate-100 pt-3">
              <Row label="运行环境" value={status.virtualized ? "虚拟化 / 容器" : "物理机"} />
              <Row label="应用版本" value={`v${status.appVersion}`} />
              <Row label="架构" value={status.arch} />
              <Row label="系统" value={status.osVersion} title={status.osVersion} />
              <Row
                label="标识文件"
                value={status.deviceFile}
                mono
                span2
                title={status.deviceFile}
              />
              <Row label="主板" value={hw?.boardSerial ?? ""} mono title={hw?.boardSerial} />
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
