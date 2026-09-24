import React, { useState, useEffect } from "react";
import {
  Container as ContainerIcon,
  Layers,
  Image as ImageIcon,
  Activity,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  TrendingUp,
  Server,
  Clock,
  HardDrive,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { Card } from "../components/UI";
import { Gauge, CpuCoresGauge } from "../components/Gauge";
import { LineChart, type LineSeries } from "../components/LineChart";
import { LoadingState, ErrorState } from "../components/DataState";
import { StatusBadge } from "../components/Badge";
import { fetchResourceHistoryApi } from "../api";
import type {
  Container,
  Stack,
  DockerImage,
  ActivityLog,
  EngineResourceStats,
  DockerVolume,
  DiskStat,
  ResourceSample,
} from "../types";

interface DashboardProps {
  containers: Container[];
  stacks: Stack[];
  images: DockerImage[];
  volumes: DockerVolume[];
  activities: ActivityLog[];
  resourceStats: EngineResourceStats | null;
  /** 用于拉取资源时间序列（内存 / 网络折线图） */
  engineId?: string;
  onNavigate: (page: string) => void;
  loading?: boolean;
  error?: string | null;
}

/** MB → 可读文本 */
function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** KB/s → 可读速率 */
function fmtRate(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps * 10) / 10} KB/s`;
}

export function Dashboard({
  containers,
  stacks,
  images,
  volumes,
  activities,
  resourceStats,
  engineId,
  onNavigate,
  loading,
  error,
}: DashboardProps) {
  const running = containers.filter((c) => c.status === "running").length;
  const stopped = containers.filter((c) => c.status === "stopped").length;
  const paused = containers.filter((c) => c.status === "paused").length;
  const hasUpdate = containers.filter((c) => c.hasUpdate).length;
  const runningStacks = stacks.filter((s) => s.status === "running").length;
  const danglingImages = images.filter((i) => i.isDangling).length;

  // 资源时间序列：每 3s 拉一次最近 5 分钟样本（当前值仍由 SSE 实时推送）
  const [history, setHistory] = useState<ResourceSample[]>([]);
  useEffect(() => {
    if (!engineId) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchResourceHistoryApi(engineId, "5m");
        if (alive) setHistory(data || []);
      } catch {
        // 忽略：当前值仍由 SSE 推送，历史点下次再补
      }
    };
    void load();
    const timer = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [engineId]);

  const stats = [
    { label: "运行容器", value: running, total: containers.length, icon: <ContainerIcon size={20} />, color: "blue", page: "containers" },
    { label: "活跃堆栈", value: runningStacks, total: stacks.length, icon: <Layers size={20} />, color: "purple", page: "stacks" },
    { label: "本地镜像", value: images.length, icon: <ImageIcon size={20} />, color: "amber", page: "images" },
    { label: "可用更新", value: hasUpdate, icon: <TrendingUp size={20} />, color: "red", page: "containers" },
  ];

  const colorMap: Record<string, string> = {
    blue: "from-blue-500 to-blue-600",
    purple: "from-purple-500 to-purple-600",
    amber: "from-amber-500 to-amber-600",
    red: "from-red-500 to-red-600",
  };

  const activityIcon = {
    success: <CheckCircle2 size={16} className="text-green-500" />,
    warning: <AlertTriangle size={16} className="text-amber-500" />,
    error: <XCircle size={16} className="text-red-500" />,
    info: <Info size={16} className="text-blue-500" />,
  };

  if (loading && containers.length === 0) return <LoadingState message="正在加载仪表盘数据..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6 space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={() => onNavigate(stat.page)}
            className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 text-left hover:shadow-md hover:border-slate-300 transition-all group"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-500 mb-1">{stat.label}</p>
                <p className="text-2xl font-bold text-slate-800">
                  {stat.value}
                  {stat.total !== undefined && (
                    <span className="text-base text-slate-400 font-normal"> / {stat.total}</span>
                  )}
                </p>
              </div>
              <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${colorMap[stat.color]} flex items-center justify-center text-white shadow-md`}>
                {stat.icon}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Resource Monitoring（整宽） */}
      <Card title="资源监控" icon={<Activity size={16} />} actions={<span className="text-xs text-slate-400">实时刷新</span>}>
        {!resourceStats ? (
          <div className="py-6 text-center text-sm text-slate-400">正在获取引擎资源数据...</div>
        ) : (
          <div className="space-y-6">
            {/* CPU：各物理核使用率环簇 */}
            <CpuCoresGauge
              label="CPU 使用"
              cores={resourceStats.cpuCores}
              aggregatePercent={resourceStats.cpuPercent}
              subText={`${resourceStats.ncpu} 核 · 上限 ${resourceStats.cpuMaxPercent}%`}
              color="blue"
            />

            {/* 内存 + 网络：双线折线图 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-100">
              <MemChart stats={resourceStats} history={history} />
              <NetChart stats={resourceStats} history={history} />
            </div>

            {/* 磁盘利用率 */}
            <div className="pt-4 border-t border-slate-100">
              <DiskSection disks={resourceStats.disks} />
            </div>

            {/* Docker 存储占用 */}
            <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
              <Gauge
                label="Docker 镜像占用"
                mainText={fmtMB(resourceStats.imageDiskMB)}
                color="amber"
                subText={`${images.length} 镜像 · 堆栈 ${stacks.length} / 容器 ${containers.length}`}
              />
              <Gauge
                label="Docker 数据卷占用"
                mainText={`${volumes.length} 卷`}
                color="blue"
                subText={`占用 ${fmtMB(resourceStats.volumeDiskMB)}`}
              />
            </div>
          </div>
        )}
      </Card>

      {/* 容器状态分布 + 堆栈概览 */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="容器状态分布" icon={<Server size={16} />}>
          <div className="space-y-3">
            <StatusRow label="运行中" count={running} total={containers.length} color="green" />
            <StatusRow label="已停止" count={stopped} total={containers.length} color="slate" />
            <StatusRow label="已暂停" count={paused} total={containers.length} color="amber" />
            <StatusRow label="有可用更新" count={hasUpdate} total={containers.length} color="blue" />
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">悬空镜像可清理</span>
              <span className="text-amber-600 font-medium">{danglingImages} 个</span>
            </div>
          </div>
        </Card>

        <Card
          title="堆栈概览"
          icon={<Layers size={16} />}
          actions={
            <button onClick={() => onNavigate("stacks")} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              查看全部 <ArrowUpRight size={12} />
            </button>
          }
        >
          <div className="space-y-2.5">
            {stacks.slice(0, 4).map((stack) => (
              <div
                key={stack.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                onClick={() => onNavigate("stacks")}
              >
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  {stack.icon ? (
                    <img src={stack.icon} alt="" className="w-6 h-6 rounded" />
                  ) : (
                    <Layers size={16} className="text-slate-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{stack.name}</p>
                  <p className="text-xs text-slate-400">{stack.runningContainers}/{stack.totalContainers} 容器</p>
                </div>
                <StatusBadge status={stack.status} />
              </div>
            ))}
            {stacks.length === 0 && <p className="text-xs text-slate-400 py-2">暂无堆栈</p>}
          </div>
        </Card>
      </div>

      {/* 最近活动 */}
      <Card title="最近活动" icon={<Clock size={16} />} bodyClassName="p-0">
        <div className="divide-y divide-slate-50">
          {activities.map((act) => (
            <div key={act.id} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="mt-0.5">{activityIcon[act.type]}</div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700">{act.message}</p>
                <p className="text-xs text-slate-400 mt-0.5">{act.timestamp}</p>
              </div>
            </div>
          ))}
          {activities.length === 0 && <p className="text-xs text-slate-400 px-5 py-4">暂无活动记录</p>}
        </div>
      </Card>
    </div>
  );
}

/** 内存：系统占用 / Docker 占用 双曲线 + 下方「最大支持大小 / 已安装大小」 */
function MemChart({ stats, history }: { stats: EngineResourceStats; history: ResourceSample[] }) {
  const pts = history.slice(-120);
  const memSeries: LineSeries[] = [
    { name: "系统占用", color: "#64748b", values: pts.map((s) => s.memSystemMB), area: true },
    { name: "Docker 占用", color: "#f59e0b", values: pts.map((s) => s.memDockerMB), area: true },
  ];
  const installed = stats.memInstalledMB || stats.memTotalMB || 0;
  const maxSupported = stats.memMaxSupportedMB || 0;

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2 gap-3">
        <p className="text-sm font-semibold text-slate-600">内存</p>
        <div className="flex items-center gap-3 text-[11px] whitespace-nowrap">
          <span className="flex items-center gap-1 text-slate-500">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#64748b" }} />
            系统占用 {fmtMB(stats.memSystemMB)}
          </span>
          <span className="flex items-center gap-1 text-amber-600">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
            Docker 占用 {fmtMB(stats.memoryUsageMB)}
          </span>
        </div>
      </div>
      <LineChart series={memSeries} formatMax={fmtMB} formatMin={() => "0"} emptyText="正在采样内存…" />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mt-2 text-[11px] text-slate-400">
        <span>
          最大支持大小：
          <span className="text-slate-600 font-medium">{maxSupported > 0 ? fmtMB(maxSupported) : "—"}</span>
        </span>
        <span>
          已安装大小：
          <span className="text-slate-600 font-medium">{installed > 0 ? fmtMB(installed) : "—"}</span>
        </span>
        <span>
          空闲：
          <span className="text-slate-600 font-medium">{stats.memFreeMB > 0 ? fmtMB(stats.memFreeMB) : "—"}</span>
        </span>
      </div>
    </div>
  );
}

const RANGES: { key: string; label: string; points: number }[] = [
  { key: "10s", label: "10 秒", points: 10 },
  { key: "30s", label: "30 秒", points: 30 },
  { key: "1m", label: "1 分钟", points: 60 },
  { key: "2m", label: "2 分钟", points: 120 },
  { key: "5m", label: "5 分钟", points: 300 },
];

/** 网络：下行 / 上行 双曲线 + 时间范围选择 + 当前速率 */
function NetChart({ stats, history }: { stats: EngineResourceStats; history: ResourceSample[] }) {
  const [range, setRange] = useState("30s");
  const points = RANGES.find((r) => r.key === range)?.points || 30;
  const pts = history.slice(-points);
  const netSeries: LineSeries[] = [
    { name: "下行速率", color: "#ef4444", values: pts.map((s) => s.netRxKBps), area: true },
    { name: "上行速率", color: "#f59e0b", values: pts.map((s) => s.netTxKBps), area: true },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm font-semibold text-slate-600">网络流量</p>
        <select
          value={range}
          onChange={(e) => setRange(e.target.value)}
          className="text-xs border border-slate-200 rounded-md px-2 py-1 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
        >
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mb-1">
        <span className="flex items-center gap-1 text-red-500">
          <ArrowDown size={12} /> 下行速率 <b className="font-semibold">{fmtRate(stats.netRxKBps)}</b>
        </span>
        <span className="flex items-center gap-1 text-amber-500">
          <ArrowUp size={12} /> 上行速率 <b className="font-semibold">{fmtRate(stats.netTxKBps)}</b>
        </span>
      </div>
      <LineChart series={netSeries} formatMax={fmtRate} formatMin={() => "0"} emptyText="正在采样网络…" />
    </div>
  );
}

/** 磁盘：设备 / 状态 / 读写速率 / 利用率（温度与 S.M.A.R.T. 需 root，未提供） */
function DiskSection({ disks }: { disks: DiskStat[] }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <p className="text-sm font-semibold text-slate-600">磁盘</p>
        <span className="text-[10px] text-slate-400">温度 / S.M.A.R.T. 需 root（smartctl），当前版本未提供</span>
      </div>
      {disks.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">本机磁盘数据不可用（仅本机 socket 引擎可读取 /proc/diskstats）。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">设备</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">状态</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">读写速率</th>
                <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 w-[240px]">利用率</th>
              </tr>
            </thead>
            <tbody>
              {disks.map((d) => (
                <tr key={d.name} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-2 text-sm font-mono text-slate-700">
                      <HardDrive size={14} className="text-slate-400" />
                      {d.name}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    <span className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className={`w-2 h-2 rounded-full ${d.active ? "bg-green-500" : "bg-slate-300"}`} />
                      {d.active ? "活动" : "空闲"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs text-slate-500 whitespace-nowrap">
                    读 {d.readMBps} MB/s · 写 {d.writeMBps} MB/s
                  </td>
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-slate-600 w-12 text-right">{d.busyPct}%</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, d.busyPct)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatusRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const colors: Record<string, string> = {
    green: "bg-green-500",
    slate: "bg-slate-400",
    amber: "bg-amber-500",
    blue: "bg-blue-500",
  };
  const percent = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 w-28 text-sm text-slate-600">
        <span className={`w-2 h-2 rounded-full ${colors[color]}`} />
        {label}
      </div>
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${colors[color]} rounded-full transition-all`} style={{ width: `${percent}%` }} />
      </div>
      <span className="text-sm font-mono text-slate-500 w-8 text-right">{count}</span>
    </div>
  );
}
