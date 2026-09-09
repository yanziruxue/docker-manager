import React, { useCallback, useEffect, useState } from "react";
import {
  Activity,
  BarChart3,
  Cpu,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Server,
  ShieldCheck,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  fetchTelemetryStatus,
  fetchTelemetryStats,
  reportTelemetryNow,
  type TelemetryStatus,
  type TelemetryStats,
} from "../api";
import { Card, FormField, Input, Toggle } from "./UI";
import type { TelemetryConfig } from "../types";

export const DEFAULT_TELEMETRY: TelemetryConfig = {
  enabled: true,
  endpoint: "https://docker.yanziruxue.top",
  collectHwFingerprint: true,
};

interface ActivityPanelProps {
  /** 当前遥测配置（未配置时按默认处理） */
  telemetry?: TelemetryConfig;
  /** 配置变更并落盘，返回是否成功 */
  onPatch: (patch: Partial<TelemetryConfig>) => Promise<boolean>;
  /** 配置成功变更后回调（父组件在此触发持久化保存） */
  onAfterSave?: () => Promise<void> | void;
}

function fmtDateTime(v?: string): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-CN", { hour12: false });
}

function fmtNum(n?: number): string {
  return typeof n === "number" ? n.toLocaleString("zh-CN") : "—";
}

/** 概览指标卡 */
function MetricCard({
  label,
  value,
  icon,
  hint,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold text-slate-800 tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </div>
  );
}

/** 近 N 日趋势条形图（纯 CSS，不引外部图表库） */
function TrendBars({ trend }: { trend: { date: string; dau: number; installs: number }[] }) {
  const max = Math.max(1, ...trend.map((t) => Math.max(t.dau, t.installs)));
  return (
    <div className="flex items-end gap-2 h-28">
      {trend.map((t) => (
        <div key={t.date} className="flex-1 flex flex-col items-center gap-1">
          <div className="w-full flex items-end justify-center gap-0.5 h-20">
            <div
              className="w-2.5 bg-blue-400 rounded-t"
              style={{ height: `${Math.max(2, (t.dau / max) * 100)}%` }}
              title={`日活 ${t.dau}`}
            />
            <div
              className="w-2.5 bg-amber-400 rounded-t"
              style={{ height: `${Math.max(2, (t.installs / max) * 100)}%` }}
              title={`安装 ${t.installs}`}
            />
          </div>
          <span className="text-[10px] text-slate-400">{t.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export function ActivityPanel({ telemetry, onPatch, onAfterSave }: ActivityPanelProps) {
  const cfg: TelemetryConfig = { ...DEFAULT_TELEMETRY, ...(telemetry || {}) };

  const [status, setStatus] = useState<TelemetryStatus | null>(null);
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [reporting, setReporting] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [showUuid, setShowUuid] = useState(false);
  const [copied, setCopied] = useState(false);
  const [endpointDraft, setEndpointDraft] = useState(cfg.endpoint);

  useEffect(() => {
    setEndpointDraft(cfg.endpoint);
  }, [cfg.endpoint]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, st] = await Promise.all([fetchTelemetryStatus(), fetchTelemetryStats()]);
      setStatus(s);
      setStats(st);
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message || "加载失败" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleReport = async () => {
    setReporting(true);
    setMsg(null);
    try {
      const r = await reportTelemetryNow();
      setStatus(r.status);
      if (r.error) setMsg({ type: "err", text: `上报失败：${r.error}` });
      else
        setMsg({
          type: "ok",
          text: r.sent.length > 0 ? `已上报：${r.sent.join("、")}` : "无需上报（当日已上报）",
        });
    } catch (e) {
      setMsg({ type: "err", text: (e as Error).message || "上报失败" });
    } finally {
      setReporting(false);
    }
  };

  const copyUuid = async () => {
    if (!status) return;
    try {
      await navigator.clipboard.writeText(status.uuid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMsg({ type: "err", text: "复制失败，请手动选择" });
    }
  };

  const maskedUuid = status ? `${status.uuid.slice(0, 8)}${"•".repeat(24)}${status.uuid.slice(-4)}` : "—";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800 mb-1">活跃度</h2>
        <p className="text-sm text-slate-500">
          安装量与活跃用户统计（设备唯一标识 + 硬件指纹风控辅标识）
        </p>
      </div>

      {msg && (
        <div
          className={`text-xs rounded-lg px-3 py-2 border ${
            msg.type === "ok"
              ? "text-green-700 bg-green-50 border-green-100"
              : "text-red-600 bg-red-50 border-red-100"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 概览：远端聚合统计（统计服务端未就绪时降级） */}
      <Card title="安装与活跃概览" icon={<BarChart3 size={16} />}>
        {!cfg.enabled ? (
          <div className="text-sm text-slate-400 py-2">遥测已关闭，不采集也不上报任何数据。</div>
        ) : stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard label="安装总次数" value={fmtNum(stats.installs)} icon={<Activity size={13} />} hint="含重装，事件累加" />
              <MetricCard label="新增设备" value={fmtNum(stats.newDevices)} icon={<Server size={13} />} hint="按设备 UUID 去重" />
              <MetricCard label="今日活跃 DAU" value={fmtNum(stats.dau)} icon={<Activity size={13} />} hint="自然日独立设备数" />
              <MetricCard label="本月活跃 MAU" value={fmtNum(stats.mau)} icon={<BarChart3 size={13} />} hint="自然月独立设备数" />
            </div>
            {stats.trend && stats.trend.length > 0 && (
              <div>
                <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-2">
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-blue-400 inline-block" /> 日活
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> 安装
                  </span>
                  <span className="ml-auto">近 {stats.trend.length} 日</span>
                </div>
                <TrendBars trend={stats.trend} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-2 text-sm text-slate-500">
            <AlertTriangle size={15} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              统计服务端暂未接入（当前端点 <code className="text-slate-600">{cfg.endpoint}</code>
              ）。本机上报与设备标识不受影响，接入后此页自动展示聚合数据。
            </div>
          </div>
        )}
      </Card>

      {/* 本机设备标识 */}
      <Card title="本机设备标识" icon={<Cpu size={16} />}>
        {loading && !status ? (
          <div className="flex items-center gap-2 text-sm text-slate-400 py-2">
            <Loader2 size={14} className="animate-spin" /> 加载中…
          </div>
        ) : status ? (
          <div className="space-y-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm border-t border-slate-100 pt-3">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">硬件指纹</span>
                <span className="font-mono text-xs text-slate-600">
                  {cfg.collectHwFingerprint ? `${status.hwFingerprintShort}…` : "已关闭采集"}
                </span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">运行环境</span>
                <span className="text-slate-700">
                  {status.virtualized ? "虚拟化 / 容器" : "物理机"}
                  {status.virtualized && (
                    <span className="ml-1 text-[11px] text-slate-400">（硬件指纹归零）</span>
                  )}
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
                <span className="font-mono text-xs text-slate-600 truncate" title={status.deviceFile}>
                  {status.deviceFile}
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">暂无设备信息</div>
        )}
      </Card>

      {/* 上报状态 */}
      <Card title="上报状态" icon={<ShieldCheck size={16} />}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">统计服务端</span>
              <span className="text-slate-700 font-mono text-xs">{cfg.endpoint}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">安装事件</span>
              <span className={status?.installReported ? "text-green-600" : "text-amber-600"}>
                {status?.installReported ? "已上报" : "待上报"}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">最近活跃日</span>
              <span className="text-slate-700">{status?.lastActiveDate || "—"}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">最近上报</span>
              <span className="text-slate-700">{fmtDateTime(status?.lastReportAt)}</span>
            </div>
            {status?.lastError && (
              <div className="flex justify-between gap-2 sm:col-span-2">
                <span className="text-slate-500">最近错误</span>
                <span className="text-red-600 text-xs truncate" title={status.lastError}>
                  {status.lastError}
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-end border-t border-slate-100 pt-3">
            <button
              onClick={handleReport}
              disabled={reporting || !cfg.enabled}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {reporting ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              立即上报
            </button>
          </div>
        </div>
      </Card>

      {/* 遥测设置 */}
      <Card title="遥测设置" icon={<Activity size={16} />}>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm text-slate-700">启用安装与活跃上报</div>
              <div className="text-xs text-slate-400 mt-0.5">
                上报设备 UUID、应用版本、系统信息，用于统计安装量与活跃度
              </div>
            </div>
            <Toggle
              active={cfg.enabled}
              onChange={async (v) => {
                const ok = await onPatch({ enabled: v });
                if (ok) { await onAfterSave?.(); void load(); }
              }}
            />
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
            <div>
              <div className="text-sm text-slate-700">采集硬件指纹</div>
              <div className="text-xs text-slate-400 mt-0.5">
                仅用于刷量风控与设备变更识别，不参与统计去重；虚拟化环境自动归零
              </div>
            </div>
            <Toggle
              active={cfg.collectHwFingerprint}
              onChange={async (v) => {
                const ok = await onPatch({ collectHwFingerprint: v });
                if (ok) { await onAfterSave?.(); void load(); }
              }}
            />
          </div>

          <div className="border-t border-slate-100 pt-3">
            <FormField label="统计服务端地址" hint="上报与拉取出数的基址，路径固定为 /api/telemetry/*">
              <div className="flex gap-2">
                <Input
                  value={endpointDraft}
                  onChange={(v) => setEndpointDraft(v)}
                  placeholder="https://docker.yanziruxue.top"
                />
                <button
                  onClick={async () => {
                    const v = endpointDraft.trim().replace(/\/+$/, "");
                    if (!v) {
                      setMsg({ type: "err", text: "地址不能为空" });
                      return;
                    }
                    const ok = await onPatch({ endpoint: v });
                    if (ok) {
                      await onAfterSave?.();
                      setMsg({ type: "ok", text: "已保存" });
                      void load();
                    }
                  }}
                  className="flex-shrink-0 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  保存
                </button>
              </div>
            </FormField>
          </div>
        </div>
      </Card>
    </div>
  );
}
