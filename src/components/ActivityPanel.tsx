import React, { useCallback, useEffect, useState } from "react";
import {
  Cpu,
  Copy,
  Check,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  fetchTelemetryStatus,
  type TelemetryStatus,
  type DeviceHardware,
} from "../api";
import { copyText } from "../lib/clipboard";
import { Card } from "./UI";

/** 本机设备标识 7 维硬件属性（展示顺序与标签） */
const HW_FIELDS: { key: keyof DeviceHardware; label: string }[] = [
  { key: "system", label: "系统" },
  { key: "cpu", label: "CPU" },
  { key: "gpu", label: "GPU" },
  { key: "memory", label: "内存容量" },
  { key: "diskUid", label: "硬盘 UID" },
  { key: "boardSerial", label: "主板序列号" },
  { key: "deviceUid", label: "设备 UID" },
];

function fmtDateTime(v?: string): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

/**
 * 本机设备标识（只读）。
 * 不暴露任何遥测设置或上报状态——上报为后端硬编码、随活跃事件自动静默触发。
 * 设备 UUID 通过 7 维硬件指纹中的 ≥3 项匹配维持稳定：环境未变则沿用旧 UUID，
 * 否则重新生成，从而把「硬件环境是否改变」作为统计主键连续性的依据。
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
    if (await copyText(status.uuid)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const maskedUuid = status
    ? `${status.uuid.slice(0, 8)}${"•".repeat(24)}${status.uuid.slice(-4)}`
    : "—";

  const envChanged = status ? !status.envUnchanged : false;
  const matchCount = status ? status.matchCount : 0;

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
            {/* 设备 UUID */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 mb-1">设备 UUID（统计主键）</div>
                <div className="font-mono text-sm text-slate-700 break-all">
                  {showUuid ? status.uuid : maskedUuid}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setShowUuid(!showUuid)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
                  title={showUuid ? "隐藏" : "显示完整 UUID"}
                >
                  {showUuid ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  onClick={copyUuid}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100"
                  title="复制 UUID"
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </div>
            </div>

            {/* 硬件环境连续性 */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-500">硬件环境</span>
              <span
                className={`text-sm font-medium ${
                  envChanged ? "text-amber-600" : "text-green-600"
                }`}
              >
                {envChanged ? "已变化" : "未变化"}
                <span className="ml-1 text-xs font-normal text-slate-400">
                  （{matchCount}/7 项匹配）
                </span>
              </span>
            </div>

            {/* 基础环境信息 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-slate-100 pt-3">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">运行环境</span>
                <span className="text-slate-700">
                  {status.virtualized ? "虚拟化 / 容器" : "物理机"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">首次安装</span>
                <span className="text-slate-700">{fmtDateTime(status.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">应用版本</span>
                <span className="text-slate-700">v{status.appVersion}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">系统</span>
                <span className="text-slate-700 truncate" title={status.osVersion}>
                  {status.osVersion}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">架构</span>
                <span className="text-slate-700">{status.arch}</span>
              </div>
              <div className="flex justify-between gap-2 sm:col-span-2">
                <span className="text-slate-500">标识文件</span>
                <span
                  className="font-mono text-xs text-slate-600 truncate"
                  title={status.deviceFile}
                >
                  {status.deviceFile}
                </span>
              </div>
            </div>

            {/* 7 维硬件指纹 */}
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-500 mb-2">硬件指纹（7 维）</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {HW_FIELDS.map(({ key, label }) => {
                  const val = status.hardware?.[key] ?? "";
                  return (
                    <div key={key} className="flex justify-between gap-2">
                      <span className="text-slate-500">{label}</span>
                      <span
                        className={`font-mono text-xs truncate text-right ${
                          val ? "text-slate-600" : "text-slate-300"
                        }`}
                        title={val || "未采集"}
                      >
                        {val || "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">暂无设备信息</div>
        )}
      </Card>
    </div>
  );
}
