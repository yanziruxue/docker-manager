import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  Edit3,
  ScrollText,
  Globe,
  TrendingUp,
  Pause,
  Search,
  Filter,
  Download,
  Terminal,
  ChevronDown,
  ChevronRight,
  Cpu,
  MemoryStick,
  Network,
  CheckSquare,
  Square as SquareIcon,
  RefreshCw,
  X,
  ArrowUpRight,
  ArrowDownRight,
  Columns,
} from "lucide-react";
import type { Container, LogEntry } from "../types";
import { StatusBadge, Tag } from "../components/Badge";
import { Modal, ConfirmDialog } from "../components/Modal";
import { Toggle, ProgressBar, IconButton, EmptyState } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";
import { fetchContainerLogs, fetchContainerStats, containerActionApi, removeContainerApi } from "../api";
import { transformLogs } from "../transforms";
import { addOpLog } from "../opLog";
import { XTermTerminal } from "../components/XTermTerminal";

interface ContainersProps {
  containers: Container[];
  onNavigate: (page: string) => void;
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  defaultVisibleColumns?: string[];
}

export function Containers({ containers, onNavigate, onRefresh, loading, error, engineId, defaultVisibleColumns }: ContainersProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailContainer, setDetailContainer] = useState<Container | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "logs" | "stats" | "terminal">("info");

  // 弹窗中始终使用最新的容器数据
  const activeContainer = useMemo(() => {
    if (!detailContainer) return null;
    const latest = containers.find((c) => c.id === detailContainer.id);
    return latest || detailContainer;
  }, [containers, detailContainer]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  const handleAction = async (container: Container, action: "start" | "stop" | "restart") => {
    if (!engineId) return;
    const actionNames: Record<string, string> = { start: "启动容器", stop: "停止容器", restart: "重启容器" };
    try {
      await containerActionApi(engineId, container.id, action);
      addOpLog({ action: actionNames[action] || action, target: container.name, status: "success", engineId });
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: actionNames[action] || action, target: container.name, status: "failed", detail: e.message || "操作失败", engineId });
      // 静默失败，后续可加 toast
    }
  };

  const handleDelete = async (containerId: string) => {
    if (!engineId) return;
    const target = containers.find((c) => c.id === containerId)?.name || containerId;
    try {
      await removeContainerApi(engineId, containerId);
      addOpLog({ action: "删除容器", target, status: "success", engineId });
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: "删除容器", target, status: "failed", detail: e.message || "删除失败", engineId });
    }
  };

  // 列可见性状态
  type ColumnKey = "icon" | "name" | "status" | "image" | "ports" | "uptime" | "restartPolicy" | "actions";
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "icon", label: "图标" },
    { key: "name", label: "容器名称" },
    { key: "status", label: "状态" },
    { key: "image", label: "镜像" },
    { key: "ports", label: "端口映射" },
    { key: "uptime", label: "运行时长" },
    { key: "restartPolicy", label: "重启策略" },
    { key: "actions", label: "操作" },
  ];
  const containerDefaults = defaultVisibleColumns && defaultVisibleColumns.length > 0
    ? new Set(defaultVisibleColumns as ColumnKey[])
    : new Set(allColumns.map((c) => c.key));
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(containerDefaults);

  // 关闭列选择器
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggleColumn = (key: ColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleColumns(next);
  };

  // 导出容器列表（CSV）
  const handleExport = () => {
    const headers = ["容器名称", "镜像", "状态", "端口映射", "IP", "运行时长", "重启策略"];
    const rows = filtered.map((c) => [
      c.name,
      c.image,
      c.status === "running" ? "运行中" : c.status === "stopped" ? "已停止" : c.status === "paused" ? "已暂停" : c.status,
      c.ports.map((p) => `${p.host}:${p.container}/${p.protocol}`).join("; "),
      c.ip,
      c.uptime,
      c.restartPolicy || "—",
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${v}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `containers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => {
    return containers.filter((c) => {
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase()) || c.image.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || c.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [containers, search, statusFilter]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((c) => c.id)));
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedRows(next);
  };

  const handleContextMenu = (e: React.MouseEvent, container: Container) => {
    e.preventDefault();
    setDetailContainer(container);
    setDetailTab("info");
  };

  if (loading && containers.length === 0) return <LoadingState message="正在加载容器列表..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索容器名称或镜像..."
              className="w-64 pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          >
            <option value="all">全部状态</option>
            <option value="running">运行中</option>
            <option value="stopped">已停止</option>
            <option value="paused">已暂停</option>
          </select>
          <span className="text-sm text-slate-400">{filtered.length} 个容器</span>
        </div>
        <div className="flex items-center gap-2">
          {/* 列选择器 */}
          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              title="选择显示列"
            >
              <Columns size={14} /> 列
            </button>
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg border border-slate-200 shadow-lg z-50 py-1">
                {allColumns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <Download size={14} /> 导出
          </button>
        </div>
      </div>

      {/* Batch Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg animate-slide-down">
          <span className="text-sm text-blue-700 font-medium">已选中 {selected.size} 个容器</span>
          <div className="h-4 w-px bg-blue-200" />
          <button className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><Play size={14} /> 批量启动</button>
          <button className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><Square size={14} /> 批量停止</button>
          <button className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><RotateCw size={14} /> 批量重启</button>
          <button className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><RefreshCw size={14} /> 批量更新</button>
          <button className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"><Trash2 size={14} /> 批量删除</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="w-10 px-4 py-3">
                <button onClick={toggleSelectAll} className="text-slate-400 hover:text-slate-600">
                  {selected.size === filtered.length && filtered.length > 0 ? <CheckSquare size={16} /> : <SquareIcon size={16} />}
                </button>
              </th>
              <th className="w-8 px-2"></th>
              {visibleColumns.has("icon") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 w-14">图标</th>}
              {visibleColumns.has("name") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">容器名称</th>}
              {visibleColumns.has("status") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">状态</th>}
              {visibleColumns.has("image") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">镜像</th>}
              {visibleColumns.has("ports") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">端口映射</th>}
              {visibleColumns.has("uptime") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">运行时长</th>}
              {visibleColumns.has("restartPolicy") && <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">重启策略</th>}
              {visibleColumns.has("actions") && <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((container) => {
              const visibleCount = Array.from(visibleColumns).length + 1; // +1 for expand column
              return (
              <React.Fragment key={container.id}>
                <tr
                  className={`hover:bg-slate-50 transition-colors cursor-context-menu ${selected.has(container.id) ? "bg-blue-50/50" : ""}`}
                  onContextMenu={(e) => handleContextMenu(e, container)}
                  onClick={() => setDetailContainer(container)}
                >
                  <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(container.id); }}>
                    <button className="text-slate-400 hover:text-blue-500">
                      {selected.has(container.id) ? <CheckSquare size={16} className="text-blue-500" /> : <SquareIcon size={16} />}
                    </button>
                  </td>
                  <td className="px-2" onClick={(e) => { e.stopPropagation(); toggleExpand(container.id); }}>
                    {container.stats && (
                      <button className="text-slate-400 hover:text-slate-600">
                        {expandedRows.has(container.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    )}
                  </td>
                  {visibleColumns.has("icon") && (
                    <td className="px-3 py-3">
                      {/* 图标独立列：WebUI Labels 设置的图标按服务名匹配显示 */}
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {container.icon ? (
                          <img src={container.icon} alt="" className="w-7 h-7 rounded" />
                        ) : (
                          <span className="text-xs font-bold text-slate-400">{container.name.charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("name") && (
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2.5">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-medium text-slate-700">{container.name}</span>
                            {container.hasUpdate && (
                              <span className="w-2 h-2 bg-amber-400 rounded-full" title="有可用更新" />
                            )}
                          </div>
                          <span className="text-xs text-slate-400">{container.networkMode}</span>
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("status") && (
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 text-sm">
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          container.status === "running" ? "bg-green-500 animate-pulse" :
                          container.status === "paused" ? "bg-amber-500" :
                          container.status === "restarting" ? "bg-blue-500 animate-pulse" :
                          "bg-slate-400"
                        }`} />
                        <span className={
                          container.status === "running" ? "text-green-600 font-medium" :
                          container.status === "paused" ? "text-amber-600 font-medium" :
                          container.status === "restarting" ? "text-blue-600 font-medium" :
                          "text-slate-500"
                        }>
                          {container.status === "running" ? "运行中" :
                           container.status === "stopped" ? "已停止" :
                           container.status === "paused" ? "已暂停" :
                           container.status === "restarting" ? "重启中" : container.status}
                        </span>
                      </span>
                    </td>
                  )}
                  {visibleColumns.has("image") && <td className="px-3 py-3"><span className="text-sm text-slate-600 font-mono">{container.image}</span></td>}
                  {visibleColumns.has("ports") && (
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {container.ports.map((p, i) => (
                          <Tag key={i} text={`${p.host}:${p.container}/${p.protocol}`} color="blue" />
                        ))}
                        {container.ports.length === 0 && <span className="text-xs text-slate-300">—</span>}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("uptime") && <td className="px-3 py-3"><span className="text-sm text-slate-500">{container.uptime}</span></td>}
                  {visibleColumns.has("restartPolicy") && (
                    <td className="px-3 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        container.restartPolicy === "always" ? "bg-green-50 text-green-600 border border-green-100" :
                        container.restartPolicy === "unless-stopped" ? "bg-blue-50 text-blue-600 border border-blue-100" :
                        container.restartPolicy === "on-failure" ? "bg-amber-50 text-amber-600 border border-amber-100" :
                        "bg-slate-50 text-slate-400 border border-slate-100"
                      }`}>
                        {container.restartPolicy || "no"}
                      </span>
                    </td>
                  )}
                  {visibleColumns.has("actions") && (
                    <td className="px-3 py-3">
                      <div className="flex items-center justify-end">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (container.webuiUrl) window.open(container.webuiUrl, "_blank");
                          }}
                          disabled={!container.webuiUrl}
                          className="p-1.5 rounded-lg transition-colors text-slate-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-slate-400"
                          title={container.webuiUrl ? `打开 WebUI：${container.webuiUrl}` : "该容器未配置 WebUI 地址"}
                        >
                          <Globe size={16} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
                {/* Expanded Resource Row */}
                {expandedRows.has(container.id) && container.stats && (
                  <tr className="bg-slate-50/50">
                    <td colSpan={visibleCount + 1} className="px-12 py-4">
                      <div className="grid grid-cols-4 gap-4">
                        <ResourceMini icon={<Cpu size={14} />} label="CPU" value={`${container.stats.cpuPercent}%`} percent={container.stats.cpuPercent} color="blue" />
                        <ResourceMini icon={<MemoryStick size={14} />} label="内存" value={`${container.stats.memoryUsage} / ${container.stats.memoryLimit} MB`} percent={(container.stats.memoryUsage / container.stats.memoryLimit) * 100} color="purple" />
                        <ResourceMini icon={<Network size={14} />} label="网络 I/O" value={`${container.stats.netInput} ↓ / ${container.stats.netOutput} ↑ KB`} icon2={<ArrowDownRight size={12} className="text-green-500" />} icon3={<ArrowUpRight size={12} className="text-orange-500" />} />
                        <ResourceMini icon={<TrendingUp size={14} />} label="磁盘 I/O" value={`${container.stats.blockInput} ↓ / ${container.stats.blockOutput} ↑ KB`} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );})}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <EmptyState
            icon={<Filter size={28} />}
            title="未找到匹配的容器"
            description="尝试调整搜索条件或状态筛选器"
          />
        )}
      </div>

      {/* Container Detail Modal */}
      {activeContainer && (
        <ContainerDetailModal
          container={activeContainer}
          tab={detailTab}
          onTabChange={setDetailTab}
          onClose={() => setDetailContainer(null)}
          engineId={engineId}
          onRefresh={onRefresh}
        />
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) { handleDelete(confirmDelete); setConfirmDelete(null); } }}
        title="删除容器"
        message="确定要删除此容器吗？此操作不可撤销，容器的数据卷不会被删除。"
        confirmText="删除"
        danger
      />
    </div>
  );
}

function ResourceMini({ icon, label, value, percent, color, icon2, icon3 }: any) {
  return (
    <div className="bg-white rounded-lg border border-slate-100 p-3">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
        {icon} {label}
        {icon2} {icon3}
      </div>
      <p className="text-sm font-mono font-semibold text-slate-700 mb-1">{value}</p>
      {percent !== undefined && <ProgressBar value={percent} color={color} />}
    </div>
  );
}

// ============ Container Detail Modal ============

function ContainerDetailModal({
  container,
  tab,
  onTabChange,
  onClose,
  engineId,
  onRefresh,
}: {
  container: Container;
  tab: "info" | "logs" | "stats" | "terminal";
  onTabChange: (tab: "info" | "logs" | "stats" | "terminal") => void;
  onClose: () => void;
  engineId?: string;
  onRefresh?: () => void;
}) {
  const [logs, setLogs] = useState<{ timestamp: string; level: string; message: string }[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState("all");
  const [logPaused, setLogPaused] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [stats, setStats] = useState<{
    cpuPercent: number;
    memoryUsage: number;
    memoryLimit: number;
    netInput: number;
    netOutput: number;
    blockInput: number;
    blockOutput: number;
  } | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  // 清除操作状态（容器状态变化后）
  useEffect(() => {
    setActionLoading(null);
    setDeleteConfirm(false);
  }, [container.status]);

  // 拉起操作
  const handleOperation = async (action: "start" | "stop" | "restart" | "pause" | "unpause") => {
    if (!engineId) return;
    setActionLoading(action);
    try {
      await containerActionApi(engineId, container.id, action);
      onRefresh?.();
    } catch (e: any) {
      // 失败后清除 loading 让用户重试
    } finally {
      setActionLoading(null);
    }
  };

  // 删除
  const handleDelete = async () => {
    if (!engineId || deleteConfirm) return;
    setDeleteConfirm(true);
    // 等待用户二次确认（通过按钮再次点击）
  };

  const confirmDelete = async () => {
    if (!engineId || !deleteConfirm) return;
    setActionLoading("delete");
    try {
      await removeContainerApi(engineId, container.id);
      onClose();
      onRefresh?.();
    } catch (e: any) {
      setActionLoading(null);
      setDeleteConfirm(false);
    }
  };

  // 拉取真实日志
  useEffect(() => {
    if (tab !== "logs" || !engineId || !container.id) return;
    let cancelled = false;
    setLogsLoading(true);
    (async () => {
      try {
        const rawLogs = await fetchContainerLogs(engineId, container.id, 200);
        if (!cancelled) {
          setLogs(transformLogs(rawLogs));
        }
      } catch (err) {
        console.error("获取日志失败:", err);
      } finally {
        if (!cancelled) setLogsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, engineId, container.id]);

  // 拉取资源监控
  useEffect(() => {
    if (tab !== "stats" || !engineId || !container.id) return;
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);
    (async () => {
      try {
        const data = await fetchContainerStats(engineId, container.id);
        if (!cancelled) {
          setStats(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setStatsError(err.message || "获取资源监控失败");
        }
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, engineId, container.id]);

  const tabs = [
    { key: "info", label: "基本信息", icon: <Edit3 size={14} /> },
    { key: "logs", label: "日志", icon: <ScrollText size={14} /> },
    { key: "stats", label: "资源监控", icon: <TrendingUp size={14} /> },
    { key: "terminal", label: "终端", icon: <Terminal size={14} /> },
  ];

  const filteredLogs = logLevel === "all" ? logs : logs.filter((l) => l.level === logLevel);

  return (
    <Modal open={true} onClose={onClose} size="xl">
      <div className="-mx-6 -my-4">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-4 pb-3 border-b border-slate-100">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
            {container.icon ? <img src={container.icon} alt="" className="w-9 h-9 rounded" /> : <span className="text-sm font-bold text-slate-400">{container.name.charAt(0)}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-800">{container.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={container.status} />
              <span className="text-xs text-slate-400 truncate">{container.image}</span>
              <span className="text-xs text-slate-300">•</span>
              <span className="text-xs text-slate-400">运行 {container.uptime}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {actionLoading ? (
              <button
                disabled
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg cursor-wait"
              >
                <RefreshCw size={14} className="animate-spin" />
                {actionLoading === "start" ? "启动中..." :
                 actionLoading === "stop" ? "停止中..." :
                 actionLoading === "restart" ? "重启中..." :
                 actionLoading === "pause" ? "暂停中..." :
                 actionLoading === "unpause" ? "恢复中..." :
                 actionLoading === "delete" ? "删除中..." : "处理中..."}
              </button>
            ) : container.status === "running" ? (
              <>
                <button
                  onClick={() => handleOperation("stop")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-slate-600 rounded-lg hover:bg-slate-700 transition-colors"
                >
                  <Square size={14} /> 停止
                </button>
                <button
                  onClick={() => handleOperation("restart")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <RotateCw size={14} /> 重启
                </button>
                <button
                  onClick={() => handleOperation("pause")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
                >
                  <Pause size={14} /> 暂停
                </button>
              </>
            ) : container.status === "paused" ? (
              <>
                <button
                  onClick={() => handleOperation("unpause")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
                >
                  <Play size={14} /> 恢复
                </button>
                <button
                  onClick={() => handleOperation("stop")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Square size={14} /> 停止
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handleOperation("start")}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors"
                >
                  <Play size={14} /> 启动
                </button>
                <button
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-400 border border-slate-200 rounded-lg cursor-not-allowed"
                  disabled
                  title="容器已停止，无法重启"
                >
                  <RotateCw size={14} /> 重启
                </button>
              </>
            )}
            {container.webuiUrl && (
              <button
                onClick={() => window.open(container.webuiUrl, "_blank")}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
              >
                <Globe size={14} /> WebUI
              </button>
            )}
            {deleteConfirm ? (
              <button
                onClick={confirmDelete}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 animate-pulse transition-colors"
              >
                <Trash2 size={14} /> 确认删除
              </button>
            ) : (
              <button
                onClick={handleDelete}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} /> 删除
              </button>
            )}
          </div>
        </div>

        {/* Action Progress Bar */}
        {actionLoading && (
          <div className="h-0.5 bg-slate-100 overflow-hidden">
            <div className={`h-full animate-progress-indeterminate ${actionLoading === "delete" ? "bg-red-500" : "bg-blue-500"}`} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-100">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => onTabChange(t.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key ? "border-blue-500 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {tab === "info" && <ContainerInfoTab container={container} />}
          {tab === "logs" && (
            <div>
              <div className="flex items-center gap-3 mb-3">
                <select value={logLevel} onChange={(e) => setLogLevel(e.target.value)} className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white">
                  <option value="all">全部级别</option>
                  <option value="info">INFO</option>
                  <option value="warn">WARN</option>
                  <option value="error">ERROR</option>
                  <option value="debug">DEBUG</option>
                </select>
                <button onClick={() => setLogPaused(!logPaused)} className={`flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border transition-colors ${logPaused ? "bg-amber-50 border-amber-200 text-amber-700" : "border-slate-200 text-slate-600"}`}>
                  {logPaused ? "已暂停" : "实时滚动"}
                </button>
                <button className="flex items-center gap-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"><Download size={14} /> 下载日志</button>
                <span className="text-xs text-slate-400 ml-auto">{filteredLogs.length} 条日志</span>
              </div>
              <div className="bg-slate-900 rounded-lg p-4 max-h-[50vh] overflow-y-auto font-mono text-xs">
                {logsLoading && (
                  <div className="flex items-center gap-2 text-slate-500 py-2">
                    <RefreshCw size={14} className="animate-spin" />
                    <span>正在加载日志...</span>
                  </div>
                )}
                {!logsLoading && filteredLogs.length === 0 && (
                  <div className="text-slate-500 py-4 text-center">暂无日志</div>
                )}
                {filteredLogs.map((log, i) => (
                  <div key={i} className="flex gap-3 py-0.5 hover:bg-slate-800/50 px-2 -mx-2 rounded">
                    {log.timestamp && <span className="text-slate-500 flex-shrink-0">{log.timestamp}</span>}
                    <span className={`flex-shrink-0 font-semibold ${log.level === "error" ? "text-red-400" : log.level === "warn" ? "text-amber-400" : log.level === "debug" ? "text-slate-500" : "text-blue-400"}`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-slate-300">{log.message}</span>
                  </div>
                ))}
                {!logPaused && !logsLoading && filteredLogs.length > 0 && (
                  <div className="flex gap-3 py-0.5 px-2">
                    <span className="text-green-400 animate-pulse">▊</span>
                  </div>
                )}
              </div>
            </div>
          )}
          {tab === "stats" && (
            <div>
              {statsLoading && (
                <div className="flex items-center gap-2 text-slate-500 py-8 justify-center">
                  <RefreshCw size={16} className="animate-spin" />
                  <span>正在加载资源监控...</span>
                </div>
              )}
              {statsError && (
                <div className="text-center py-8">
                  <p className="text-red-500 text-sm">{statsError}</p>
                  <p className="text-slate-400 text-xs mt-1">容器已停止或无法获取监控数据</p>
                </div>
              )}
              {!statsLoading && !statsError && stats && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><Cpu size={16} className="text-blue-500" /> CPU 使用率</span>
                      <span className="text-xl font-bold text-slate-800">{stats.cpuPercent}%</span>
                    </div>
                    <ProgressBar value={stats.cpuPercent} color="blue" showLabel />
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><MemoryStick size={16} className="text-purple-500" /> 内存使用</span>
                      <span className="text-xl font-bold text-slate-800">{stats.memoryUsage}<span className="text-sm font-normal text-slate-400"> / {stats.memoryLimit} MB</span></span>
                    </div>
                    <ProgressBar value={stats.memoryUsage} max={stats.memoryLimit} color="purple" showLabel />
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <span className="flex items-center gap-2 text-sm text-slate-600 mb-2"><Network size={16} className="text-green-500" /> 网络 I/O</span>
                    <div className="flex gap-6 mt-2">
                      <div>
                        <p className="text-xs text-slate-400">接收</p>
                        <p className="text-lg font-mono font-semibold text-slate-700">{stats.netInput} KB</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">发送</p>
                        <p className="text-lg font-mono font-semibold text-slate-700">{stats.netOutput} KB</p>
                      </div>
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <span className="flex items-center gap-2 text-sm text-slate-600 mb-2"><TrendingUp size={16} className="text-amber-500" /> 磁盘 I/O</span>
                    <div className="flex gap-6 mt-2">
                      <div>
                        <p className="text-xs text-slate-400">读取</p>
                        <p className="text-lg font-mono font-semibold text-slate-700">{stats.blockInput} KB</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">写入</p>
                        <p className="text-lg font-mono font-semibold text-slate-700">{stats.blockOutput} KB</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {!statsLoading && !statsError && !stats && (
                <div className="text-center py-8 text-slate-400 text-sm">暂无资源监控数据</div>
              )}
            </div>
          )}
          {tab === "terminal" && (
            <XTermTerminal
              engineId={engineId}
              containerId={container.id}
              containerName={container.name}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}

function ContainerInfoTab({ container }: { container: Container }) {
  const info = [
    { label: "容器 ID", value: container.id },
    { label: "容器名称", value: container.name },
    { label: "镜像", value: container.image },
    { label: "网络模式", value: container.networkMode },
    { label: "IP 地址", value: container.ip },
    { label: "创建时间", value: container.createdAt },
    { label: "运行时长", value: container.uptime },
    { label: "重启策略", value: container.restartPolicy || "no" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {info.map((item) => (
          <div key={item.label} className="flex items-center gap-3 py-2 border-b border-slate-50">
            <span className="text-sm text-slate-500 w-24 flex-shrink-0">{item.label}</span>
            <span className="text-sm text-slate-700 font-mono">{item.value}</span>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-sm font-semibold text-slate-700 mb-2">端口映射</h4>
        <div className="bg-slate-50 rounded-lg p-3">
          {container.ports.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-1 text-sm font-mono">
              <span className="text-slate-600">{p.host}</span>
              <span className="text-slate-400">→</span>
              <span className="text-slate-600">{p.container}</span>
              <Tag text={p.protocol} color="blue" />
            </div>
          ))}
          {container.ports.length === 0 && <span className="text-sm text-slate-400">无端口映射</span>}
        </div>
      </div>
    </div>
  );
}
