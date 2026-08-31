import React from "react";
import {
  Container as ContainerIcon,
  Layers,
  Image as ImageIcon,
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  TrendingUp,
  Server,
  Clock,
} from "lucide-react";
import { Card, ProgressBar } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";
import { StatusBadge } from "../components/Badge";
import type { Container, Stack, DockerImage, ActivityLog, EngineResourceStats } from "../types";

interface DashboardProps {
  containers: Container[];
  stacks: Stack[];
  images: DockerImage[];
  activities: ActivityLog[];
  resourceStats: EngineResourceStats | null;
  onNavigate: (page: string) => void;
  loading?: boolean;
  error?: string | null;
}

/** KB → 可读文本 */
function fmtKB(kb: number): string {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
  return `${Math.round(kb)} KB`;
}

/** MB → 可读文本 */
function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function Dashboard({ containers, stacks, images, activities, resourceStats, onNavigate, loading, error }: DashboardProps) {
  const running = containers.filter((c) => c.status === "running").length;
  const stopped = containers.filter((c) => c.status === "stopped").length;
  const paused = containers.filter((c) => c.status === "paused").length;
  const hasUpdate = containers.filter((c) => c.hasUpdate).length;
  const runningStacks = stacks.filter((s) => s.status === "running").length;
  const danglingImages = images.filter((i) => i.isDangling).length;

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

  // 资源监控：真实引擎数据（CPU/内存为运行容器合计，磁盘为镜像+卷占用，网络为累计流量）
  interface ResourceRow {
    label: string;
    display: string;
    icon: React.ReactNode;
    color: "blue" | "green" | "amber" | "red" | "purple";
    value?: number;
    max?: number;
    note?: string;
  }
  const resourceRows: ResourceRow[] = resourceStats
    ? [
        {
          label: "CPU 使用（容器合计）",
          display: `${resourceStats.cpuPercent.toFixed(1)}%`,
          note: `${resourceStats.ncpu} 核上限 ${resourceStats.cpuMaxPercent}%`,
          icon: <Cpu size={16} />,
          color: "blue",
          value: resourceStats.cpuPercent,
          max: resourceStats.cpuMaxPercent || 100,
        },
        {
          label: "内存使用（容器合计）",
          display: fmtMB(resourceStats.memoryUsageMB),
          note: `宿主机 ${fmtMB(resourceStats.memTotalMB)} · ${resourceStats.sampledContainers}/${resourceStats.runningContainers} 容器`,
          icon: <MemoryStick size={16} />,
          color: "purple",
          value: resourceStats.memoryUsageMB,
          max: resourceStats.memTotalMB || 1,
        },
        {
          label: "Docker 磁盘占用",
          display: fmtMB(resourceStats.dockerDiskMB),
          note: "镜像 + 数据卷",
          icon: <HardDrive size={16} />,
          color: "amber",
        },
        {
          label: "网络 I/O（累计）",
          display: `↓ ${fmtKB(resourceStats.netRxKB)} / ↑ ${fmtKB(resourceStats.netTxKB)}`,
          icon: <Network size={16} />,
          color: "green",
        },
      ]
    : [];

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

      {/* Resource Overview */}
      <div className="grid grid-cols-2 gap-4">
        <Card title="资源监控" icon={<Activity size={16} />} actions={<span className="text-xs text-slate-400">实时刷新</span>}>
          <div className="space-y-4">
            {resourceRows.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">正在获取引擎资源数据...</div>
            )}
            {resourceRows.map((res) => (
              <div key={res.label}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span className="text-slate-400">{res.icon}</span>
                    {res.label}
                  </div>
                  <span className="text-sm font-mono font-semibold text-slate-700">
                    {res.display}
                  </span>
                </div>
                {res.value !== undefined && res.max ? (
                  <ProgressBar value={res.value} max={res.max} color={res.color} />
                ) : (
                  <div className="h-0.5" />
                )}
                {res.note && <p className="text-xs text-slate-400 mt-1">{res.note}</p>}
              </div>
            ))}
          </div>
        </Card>

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
      </div>

      {/* Recent Activity & Quick Stacks */}
      <div className="grid grid-cols-3 gap-4">
        <Card title="最近活动" icon={<Clock size={16} />} className="col-span-2" bodyClassName="p-0">
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
          </div>
        </Card>

        <Card title="堆栈概览" icon={<Layers size={16} />} actions={
          <button onClick={() => onNavigate("stacks")} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
            查看全部 <ArrowUpRight size={12} />
          </button>
        }>
          <div className="space-y-2.5">
            {stacks.slice(0, 4).map((stack) => (
              <div key={stack.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => onNavigate("stacks")}>
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
          </div>
        </Card>
      </div>
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
