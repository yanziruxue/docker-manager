import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
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
  Folder,
  FileText,
  Upload,
  Plus,
  ArrowLeft,
  Save,
  FilePlus2,
  FolderPlus,
} from "lucide-react";
import type { Container, LogEntry, ContainerFileEntry } from "../types";
import { StatusBadge, Tag } from "../components/Badge";
import { Modal, ConfirmDialog, Drawer } from "../components/Modal";
import { Toggle, ProgressBar, IconButton, EmptyState, SortableTh } from "../components/UI";
import { TagGroup } from "../components/TagPicker";
import { LoadingState, ErrorState } from "../components/DataState";
import { fetchContainerLogs, fetchContainerStats, containerActionApi, removeContainerApi } from "../api";
import {
  listContainerFilesApi,
  readContainerFileApi,
  writeContainerFileApi,
  uploadContainerFileApi,
  downloadContainerFileApi,
  downloadContainerArchiveApi,
  createContainerEntryApi,
} from "../api";
import { transformLogs, shortImageRef } from "../transforms";
import { addOpLog } from "../opLog";
import { XTermTerminal } from "../components/XTermTerminal";
import { LineChart, type LineSeries } from "../components/LineChart";

interface ContainersProps {
  containers: Container[];
  onNavigate: (page: string) => void;
  onRefresh?: () => void;
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  defaultVisibleColumns?: string[];
  /** 容器详情展示形式：drawer = 半页面（默认）；modal = 居中弹窗。由系统设置 → 弹窗设置控制 */
  containerDetailStyle?: "drawer" | "modal";
}

export function Containers({ containers, onNavigate, onRefresh, loading, error, engineId, defaultVisibleColumns, containerDetailStyle = "drawer" }: ContainersProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailContainer, setDetailContainer] = useState<Container | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "logs" | "stats" | "terminal" | "file">("info");

  // 弹窗中始终使用最新的容器数据
  const activeContainer = useMemo(() => {
    if (!detailContainer) return null;
    const latest = containers.find((c) => c.id === detailContainer.id);
    return latest || detailContainer;
  }, [containers, detailContainer]);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
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

  // 批量操作（启动/停止/重启），逐容器执行并汇总成功/失败
  const batchAction = async (action: "start" | "stop" | "restart") => {
    if (!engineId || selected.size === 0) return;
    const ids = Array.from(selected);
    const actionNames: Record<string, string> = { start: "批量启动容器", stop: "批量停止容器", restart: "批量重启容器" };
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const name = containers.find((c) => c.id === id)?.name || id;
      try {
        await containerActionApi(engineId, id, action);
        ok++;
      } catch (e: any) {
        fail++;
        addOpLog({ action: actionNames[action], target: name, status: "failed", detail: e.message || "操作失败", engineId });
      }
    }
    addOpLog({
      action: actionNames[action],
      target: `${ids.length} 个容器（成功 ${ok} / 失败 ${fail}）`,
      status: fail === 0 ? "success" : "failed",
      engineId,
    });
    onRefresh?.();
  };

  // 批量删除（强制删除，含运行中的容器），二次确认后执行
  const batchDelete = async () => {
    if (!engineId || selected.size === 0) return;
    const ids = Array.from(selected);
    let ok = 0;
    let fail = 0;
    for (const id of ids) {
      const name = containers.find((c) => c.id === id)?.name || id;
      try {
        await removeContainerApi(engineId, id, true);
        ok++;
        addOpLog({ action: "批量删除容器", target: name, status: "success", engineId });
      } catch (e: any) {
        fail++;
        addOpLog({ action: "批量删除容器", target: name, status: "failed", detail: e.message || "删除失败", engineId });
      }
    }
    setSelected(new Set());
    setConfirmBatchDelete(false);
    onRefresh?.();
  };

  // 列可见性状态
  type ColumnKey = "icon" | "name" | "status" | "tags" | "image" | "ports" | "network" | "uptime" | "restartPolicy" | "actions";
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "icon", label: "图标" },
    { key: "name", label: "容器名称" },
    { key: "status", label: "状态" },
    { key: "tags", label: "标签" },
    { key: "image", label: "镜像" },
    { key: "ports", label: "端口映射" },
    { key: "network", label: "网络模式" },
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
    const headers = ["容器名称", "镜像", "状态", "端口映射", "网络模式", "IP", "运行时长", "重启策略"];
    const rows = filtered.map((c) => [
      c.name,
      c.image,
      c.status === "running" ? "运行中" : c.status === "stopped" ? "已停止" : c.status === "paused" ? "已暂停" : c.status,
      c.ports.map((p) => `${p.host}:${p.container}/${p.protocol}`).join("; "),
      c.networkMode,
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

  // 排序：默认按名称升序；名称/状态/标签/重启策略 列头可点击切换排序
  type SortKey = "name" | "status" | "tags" | "restartPolicy";
  const STATUS_ORDER: Record<string, number> = {
    running: 0, restarting: 1, paused: 2, exited: 3, dead: 4, stopped: 5, created: 6, removing: 7,
  };
  const RESTART_ORDER: Record<string, number> = { always: 0, "unless-stopped": 1, "on-failure": 2, no: 3 };
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const toggleSort = (key: string) => {
    const k = key as SortKey;
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name, "zh");
      else if (sortKey === "status") cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
      else if (sortKey === "tags") {
        const join = (c: Container) => (c.tags || []).map((t) => t.name).join(" ").toLowerCase();
        cmp = join(a).localeCompare(join(b), "zh");
        if (cmp === 0) cmp = (a.tags?.length || 0) - (b.tags?.length || 0);
      } else if (sortKey === "restartPolicy") {
        cmp = (RESTART_ORDER[a.restartPolicy] ?? 9) - (RESTART_ORDER[b.restartPolicy] ?? 9);
      }
      // 二级排序：名称永远升序（保证稳定、可预期）
      if (cmp === 0) cmp = a.name.localeCompare(b.name, "zh");
      return cmp * sortDir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

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
          <button onClick={() => batchAction("start")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><Play size={14} /> 批量启动</button>
          <button onClick={() => batchAction("stop")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><Square size={14} /> 批量停止</button>
          <button onClick={() => batchAction("restart")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600"><RotateCw size={14} /> 批量重启</button>
          <button onClick={() => setConfirmBatchDelete(true)} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"><Trash2 size={14} /> 批量删除</button>
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
              {visibleColumns.has("icon") && <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 w-14">图标</th>}
              {visibleColumns.has("name") && <SortableTh label="容器名称" sortKey={sortKey} dir={sortDir} sortId="name" onSort={toggleSort} />}
              {visibleColumns.has("status") && <SortableTh label="状态" align="center" sortKey={sortKey} dir={sortDir} sortId="status" onSort={toggleSort} />}
              {visibleColumns.has("tags") && <SortableTh label="标签" align="center" sortKey={sortKey} dir={sortDir} sortId="tags" onSort={toggleSort} />}
              {visibleColumns.has("image") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">镜像</th>}
              {visibleColumns.has("ports") && <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">端口映射</th>}
              {visibleColumns.has("network") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">网络模式</th>}
              {visibleColumns.has("uptime") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">运行时长</th>}
              {visibleColumns.has("restartPolicy") && <SortableTh label="重启策略" align="center" sortKey={sortKey} dir={sortDir} sortId="restartPolicy" onSort={toggleSort} />}
              {visibleColumns.has("actions") && <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {sorted.map((container) => {
              const visibleCount = Array.from(visibleColumns).length + 1; // +1 for expand column
              return (
              <React.Fragment key={container.id}>
                <tr
                  className={`hover:bg-slate-50 transition-colors ${selected.has(container.id) ? "bg-blue-50/50" : ""}`}
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
                      <div className="flex justify-center">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                          {container.icon ? (
                            <img src={container.icon} alt="" className="w-7 h-7 rounded" />
                          ) : (
                            <span className="text-xs font-bold text-slate-400">{container.name.charAt(0).toUpperCase()}</span>
                          )}
                        </div>
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
                        </div>
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("status") && (
                    <td className="px-3 py-3">
                      {/* 与堆栈管理一致：点击状态列打开详情弹窗 */}
                      <div className="flex justify-center">
                        <button
                          onClick={() => { setDetailContainer(container); setDetailTab("info"); }}
                          title="点击状态列查看容器详情"
                          className="inline-flex items-center gap-1.5 text-sm rounded-md ring-1 ring-transparent hover:ring-blue-300 hover:bg-blue-50 px-1.5 py-0.5 transition-colors"
                        >
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
                        </button>
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("tags") && (
                    <td className="px-3 py-3">
                      <div className="flex justify-center">
                        {container.tags && container.tags.length > 0 ? (
                          <TagGroup tags={container.tags} max={2} />
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("image") && <td className="px-3 py-3"><span className="text-sm text-slate-600 font-mono">{container.image}</span></td>}
                  {visibleColumns.has("ports") && (
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap justify-center gap-1">
                        {container.ports.map((p, i) => (
                          <Tag key={i} text={`${p.host}:${p.container}/${p.protocol}`} color="blue" />
                        ))}
                        {container.ports.length === 0 && <span className="text-xs text-slate-300">—</span>}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("network") && <td className="px-3 py-3"><span className="text-sm text-slate-600">{container.networkMode}</span></td>}
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
          presentation={containerDetailStyle}
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

      {/* Batch Delete Confirmation */}
      <ConfirmDialog
        open={confirmBatchDelete}
        onClose={() => setConfirmBatchDelete(false)}
        onConfirm={batchDelete}
        title="批量删除容器"
        message={`确定要删除选中的 ${selected.size} 个容器吗？此操作不可撤销，容器的数据卷不会被删除。`}
        confirmText="批量删除"
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

// ---- 「资源监控」曲线：轮询采样 + 卡片曲线 ----

/** 采样间隔与保留点数：1s × 300 ⇒ 最近 5 分钟（与仪表盘曲线的采样口径一致） */
const STATS_SAMPLE_MS = 1000;
const STATS_MAX_POINTS = 300;

/**
 * 曲线时长选项（1s 一个点，`points` 即窗口内的点数）。
 * 与仪表盘 `RANGES` 同一套口径；切换时长只在**本地切片**，不产生额外请求。
 */
const STATS_RANGES: { key: string; label: string; points: number }[] = [
  { key: "10s", label: "10 秒", points: 10 },
  { key: "30s", label: "30 秒", points: 30 },
  { key: "1m", label: "1 分钟", points: 60 },
  { key: "2m", label: "2 分钟", points: 120 },
  { key: "5m", label: "5 分钟", points: 300 },
];
const STATS_RANGE_DEFAULT = "30s";
const STATS_RANGE_STORAGE_KEY = "dm.container.statsRange";

interface StatsSample {
  ts: number;
  cpu: number;
  mem: number;
  netIn: number;
  netOut: number;
  blkIn: number;
  blkOut: number;
}

/**
 * 累计计数器 → 速率（/s）。
 * 服务端的 `netInput` / `blockOutput` 等是**自容器启动累计值**，直接画曲线只会是一条单调上升的斜线；
 * 首采样无基线、以及容器重启导致计数器回卷（`cur < prev`）时都返回 0。
 */
function toRate(cur: number, prev: number, dtSec: number): number {
  if (!(dtSec > 0) || cur < prev) return 0;
  return (cur - prev) / dtSec;
}

/** 时间戳 → HH:MM:SS（曲线悬停提示的时间标签，与仪表盘同一口径） */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** KB/s → 可读速率（与仪表盘同一口径） */
function fmtKbRate(kbps: number): string {
  if (!isFinite(kbps) || kbps <= 0) return "0";
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps * 10) / 10} KB/s`;
}

/** MB → 可读文本（与仪表盘同一口径） */
function fmtMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

/** 卡片里的小曲线通用参数：高度 + 半透明网格 */
const CARD_CHART_HEIGHT = 104;

function ContainerDetailModal({
  container,
  tab,
  onTabChange,
  onClose,
  engineId,
  onRefresh,
  presentation = "drawer",
}: {
  container: Container;
  tab: "info" | "logs" | "stats" | "terminal" | "file";
  onTabChange: (tab: "info" | "logs" | "stats" | "terminal" | "file") => void;
  onClose: () => void;
  engineId?: string;
  onRefresh?: () => void;
  /** 展示形式：drawer = 半页面（默认）；modal = 居中弹窗 */
  presentation?: "drawer" | "modal";
}) {
  const [logs, setLogs] = useState<{ timestamp: string; level: string; message: string }[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logLevel, setLogLevel] = useState("all");
  // 日志自动跟随开关（默认开启 = 实时滚动）。用户手动上滚时自动暂停；滚回底部再自动恢复。
  const [logPaused, setLogPaused] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // 滚动容器 ref：用来在「实时滚动」开启时把视口滚到底部
  const logsScrollRef = useRef<HTMLDivElement>(null);
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
  /** 曲线窗口：进入「资源监控」页签后累积的采样点（最多 5 分钟） */
  const [statsHistory, setStatsHistory] = useState<StatsSample[]>([]);
  /** 曲线时长（窗口点数由 STATS_RANGES 决定）；默认 30 秒，按 localStorage 持久化 */
  const [statsRange, setStatsRange] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(STATS_RANGE_STORAGE_KEY);
      return raw && STATS_RANGES.some((r) => r.key === raw) ? raw : STATS_RANGE_DEFAULT;
    } catch {
      return STATS_RANGE_DEFAULT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(STATS_RANGE_STORAGE_KEY, statsRange);
    } catch {
      // 忽略：隐私模式 / 禁用存储
    }
  }, [statsRange]);
  const statsPoints = STATS_RANGES.find((r) => r.key === statsRange)?.points ?? 30;
  const statsRangeLabel = STATS_RANGES.find((r) => r.key === statsRange)?.label ?? "30 秒";
  /** 上一次的累计计数快照，用于差分出网络/磁盘速率；离开页签时清空以重建基线 */
  const prevRawRef = useRef<{ ts: number; netIn: number; netOut: number; blkIn: number; blkOut: number } | null>(null);

  // 清除操作状态（容器状态变化后）
  useEffect(() => {
    setActionLoading(null);
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

  // 拉取资源监控：进入「资源监控」页签后按固定间隔轮询，累积窗口用于画曲线。
  // CPU% / 内存是瞬时值直接采；网络 / 磁盘的原始值是自容器启动累计（KB），须与上次快照差分才是速率。
  useEffect(() => {
    if (tab !== "stats" || !engineId || !container.id) return;
    let cancelled = false;
    setStatsLoading(true);
    setStatsError(null);

    /** 防重入：上一轮还没返回就跳过本次（1s 间隔下远端 SSH/TCP 引擎可能来不及） */
    let inFlight = false;
    const pull = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await fetchContainerStats(engineId, container.id);
        if (cancelled) return;
        setStats(data);
        const ts = Date.now();
        const prev = prevRawRef.current;
        const dtSec = prev ? (ts - prev.ts) / 1000 : 0;
        const sample: StatsSample = {
          ts,
          cpu: data.cpuPercent,
          mem: data.memoryUsage,
          netIn: prev ? toRate(data.netInput, prev.netIn, dtSec) : 0,
          netOut: prev ? toRate(data.netOutput, prev.netOut, dtSec) : 0,
          blkIn: prev ? toRate(data.blockInput, prev.blkIn, dtSec) : 0,
          blkOut: prev ? toRate(data.blockOutput, prev.blkOut, dtSec) : 0,
        };
        prevRawRef.current = {
          ts,
          netIn: data.netInput,
          netOut: data.netOutput,
          blkIn: data.blockInput,
          blkOut: data.blockOutput,
        };
        setStatsHistory((h) =>
          h.length >= STATS_MAX_POINTS ? [...h.slice(h.length - STATS_MAX_POINTS + 1), sample] : [...h, sample]
        );
      } catch (err: any) {
        if (!cancelled) {
          setStatsError(err.message || "获取资源监控失败");
        }
      } finally {
        inFlight = false;
        if (!cancelled) setStatsLoading(false);
      }
    };

    pull();
    const timer = window.setInterval(pull, STATS_SAMPLE_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      // 离开页签后重新建立基线，避免下次进来用「几分钟前的快照」差出偏低的平均速率
      prevRawRef.current = null;
    };
  }, [tab, engineId, container.id]);

  // 「实时滚动」开启时：日志更新后把滚动容器滚到底部，让最新日志可见
  useEffect(() => {
    if (logPaused) return;
    const el = logsScrollRef.current;
    if (!el) return;
    // 直接同步赋值即可（DOM 已经在 logs 状态更新后提交到屏幕前完成）
    el.scrollTop = el.scrollHeight;
  }, [logs, logPaused, logsLoading]);

  // 用户手动滚动：离开底部自动暂停，回到底部自动恢复「实时滚动」
  const handleLogsScroll = () => {
    const el = logsScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < 8;
    setLogPaused((prev) => {
      if (!atBottom && !prev) return true; // 原跟随 + 滚离底部 → 暂停
      if (atBottom && prev) return false;  // 原暂停 + 滚回底部 → 恢复跟随
      return prev;
    });
  };

  const tabs = [
    { key: "info", label: "基本信息", icon: <Edit3 size={14} /> },
    { key: "logs", label: "日志", icon: <ScrollText size={14} /> },
    { key: "stats", label: "资源监控", icon: <TrendingUp size={14} /> },
    { key: "terminal", label: "终端", icon: <Terminal size={14} /> },
    { key: "file", label: "文件", icon: <Folder size={14} /> },
  ];

  const filteredLogs = logLevel === "all" ? logs : logs.filter((l) => l.level === logLevel);

  // 「资源监控」曲线：按所选时长在**本地切片**（切换时长不额外发请求），四张卡共用同一窗口
  const statsWindow = statsHistory.slice(-statsPoints);
  const statsLabels = statsWindow.map((s) => fmtClock(s.ts));
  const latestSample = statsWindow.length > 0 ? statsWindow[statsWindow.length - 1] : null;
  const cpuSeries: LineSeries[] = [
    { name: "CPU", color: "#3b82f6", values: statsWindow.map((s) => s.cpu), area: true },
  ];
  const memSeries: LineSeries[] = [
    { name: "内存", color: "#a855f7", values: statsWindow.map((s) => s.mem), area: true },
  ];
  const netRateSeries: LineSeries[] = [
    { name: "接收", color: "#ef4444", values: statsWindow.map((s) => s.netIn), area: true },
    { name: "发送", color: "#f59e0b", values: statsWindow.map((s) => s.netOut), area: true },
  ];
  const blkRateSeries: LineSeries[] = [
    { name: "读取", color: "#3b82f6", values: statsWindow.map((s) => s.blkIn), area: true },
    { name: "写入", color: "#f59e0b", values: statsWindow.map((s) => s.blkOut), area: true },
  ];

  const detailInner = (
    <div className="flex flex-col h-full min-h-0">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 pt-4 pb-3 border-b border-slate-100">
          <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
            {container.icon ? <img src={container.icon} alt="" className="w-9 h-9 rounded" /> : <span className="text-sm font-bold text-slate-400">{container.name.charAt(0)}</span>}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-slate-800">{container.name}</h2>
            <div className="flex items-center gap-2 mt-0.5">
              <StatusBadge status={container.status} />
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
                 actionLoading === "unpause" ? "恢复中..." : "处理中..."}
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
            {/* 弹窗不再支持点击遮罩关闭，这里补一个显式关闭按钮 */}
            <button
              onClick={onClose}
              title="关闭"
              className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Action Progress Bar */}
        {actionLoading && (
          <div className="h-0.5 bg-slate-100 overflow-hidden">
            <div className={`h-full animate-progress-indeterminate bg-blue-500`} />
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

        {/* Content：日志 / 终端页签内部自行撑满（避免下方大片空白），其余页签整体滚动 */}
        <div className={tab === "logs" || tab === "terminal" ? "flex-1 min-h-0 flex flex-col px-6 py-4" : "flex-1 min-h-0 overflow-y-auto px-6 py-4"}>
          {tab === "info" && <ContainerInfoTab container={container} />}
          {tab === "logs" && (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center gap-3 mb-3 flex-shrink-0">
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
                <button
                  onClick={() => setLogs([])}
                  disabled={logs.length === 0}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="清空当前页面已加载的日志（切换页签会重新拉取）"
                >
                  <Trash2 size={14} /> 清空
                </button>
                <span className="text-xs text-slate-400 ml-auto">{filteredLogs.length} 条日志</span>
              </div>
              <div
                  ref={logsScrollRef}
                  onScroll={handleLogsScroll}
                  className="flex-1 min-h-0 bg-slate-900 rounded-lg p-4 overflow-y-auto font-mono text-xs"
                >
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
                <div className="space-y-4">
                  {/* 曲线时长：四张卡共用，默认 30 秒；切换只在本地切片，不重新采样 */}
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-slate-400">
                      曲线窗口：最近 <b className="font-medium text-slate-500">{statsRangeLabel}</b>
                      （每 {STATS_SAMPLE_MS / 1000} 秒采样，当前 {statsWindow.length} 个点）
                    </span>
                    <select
                      value={statsRange}
                      onChange={(e) => setStatsRange(e.target.value)}
                      title="选择曲线显示的时长"
                      className="px-2.5 py-1.5 text-sm border border-slate-200 rounded-lg bg-white"
                    >
                      {STATS_RANGES.map((r) => (
                        <option key={r.key} value={r.key}>{r.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><Cpu size={16} className="text-blue-500" /> CPU 使用率</span>
                      <span className="text-xl font-bold text-slate-800">{stats.cpuPercent}%</span>
                    </div>
                    <ProgressBar value={stats.cpuPercent} color="blue" showLabel />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <LineChart
                        series={cpuSeries}
                        yMax={100}
                        height={CARD_CHART_HEIGHT}
                        labels={statsLabels}
                        formatMax={(v) => `${Math.round(v)}%`}
                        formatMin={() => "0"}
                        formatValue={(v) => `${Math.round(v * 10) / 10}%`}
                        emptyText="正在采样 CPU…"
                      />
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><MemoryStick size={16} className="text-purple-500" /> 内存使用</span>
                      <span className="text-xl font-bold text-slate-800">{stats.memoryUsage}<span className="text-sm font-normal text-slate-400"> / {stats.memoryLimit} MB</span></span>
                    </div>
                    <ProgressBar value={stats.memoryUsage} max={stats.memoryLimit} color="purple" showLabel />
                    <div className="mt-3 pt-3 border-t border-slate-100">
                      <LineChart
                        series={memSeries}
                        yMax={stats.memoryLimit > 0 ? stats.memoryLimit : undefined}
                        height={CARD_CHART_HEIGHT}
                        labels={statsLabels}
                        formatMax={fmtMB}
                        formatMin={() => "0"}
                        formatValue={(v) => fmtMB(v)}
                        emptyText="正在采样内存…"
                      />
                    </div>
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><Network size={16} className="text-green-500" /> 网络 I/O</span>
                      <span className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#ef4444" }} />
                          接收 <b className="font-mono text-slate-700">{fmtKbRate(latestSample?.netIn ?? 0)}</b>
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
                          发送 <b className="font-mono text-slate-700">{fmtKbRate(latestSample?.netOut ?? 0)}</b>
                        </span>
                      </span>
                    </div>
                    <LineChart
                      series={netRateSeries}
                      height={CARD_CHART_HEIGHT}
                      labels={statsLabels}
                      formatMax={fmtKbRate}
                      formatMin={() => "0"}
                      formatValue={(v) => fmtKbRate(v)}
                      emptyText="正在采样网络…"
                    />
                  </div>
                  <div className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-2 gap-3 flex-wrap">
                      <span className="flex items-center gap-2 text-sm text-slate-600"><TrendingUp size={16} className="text-amber-500" /> 磁盘 I/O</span>
                      <span className="flex items-center gap-3 text-xs">
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#3b82f6" }} />
                          读取 <b className="font-mono text-slate-700">{fmtKbRate(latestSample?.blkIn ?? 0)}</b>
                        </span>
                        <span className="flex items-center gap-1.5 text-slate-500">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: "#f59e0b" }} />
                          写入 <b className="font-mono text-slate-700">{fmtKbRate(latestSample?.blkOut ?? 0)}</b>
                        </span>
                      </span>
                    </div>
                    <LineChart
                      series={blkRateSeries}
                      height={CARD_CHART_HEIGHT}
                      labels={statsLabels}
                      formatMax={fmtKbRate}
                      formatMin={() => "0"}
                      formatValue={(v) => fmtKbRate(v)}
                      emptyText="正在采样磁盘…"
                    />
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
              fill
            />
          )}
          {tab === "file" && (
            <ContainerFileTab
              engineId={engineId}
              containerId={container.id}
              containerName={container.name}
              containerStatus={container.status}
            />
          )}
        </div>
    </div>
  );

  // 半页面（右侧抽屉）——1panel 风格；弹窗为原有居中样式
  if (presentation === "drawer") {
    return <Drawer open={true} onClose={onClose} resizable>{detailInner}</Drawer>;
  }
  return (
    <Modal open={true} onClose={onClose} size="xl" dismissable bodyClassName="p-0 flex-1 min-h-0 flex flex-col overflow-hidden">
      {detailInner}
    </Modal>
  );
}

// ============ 容器文件管理 Tab（参考 1panel） ============

function fmtFileSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function ContainerFileTab({
  engineId,
  containerId,
  containerName,
  containerStatus,
}: {
  engineId?: string;
  containerId: string;
  containerName: string;
  containerStatus: Container["status"];
}) {
  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<ContainerFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  // 编辑器
  const [editing, setEditing] = useState<ContainerFileEntry | null>(null);
  const [editIsBinary, setEditIsBinary] = useState(false);
  const [editText, setEditText] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // 对话框状态
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<"file" | "dir">("file");
  const [createName, setCreateName] = useState("");
  const [busy, setBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadList = useCallback(async (dir: string) => {
    if (!engineId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listContainerFilesApi(engineId, containerId, dir);
      const sorted = [...data.entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
    } catch (e: any) {
      setError(e?.message || "加载目录失败");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [engineId, containerId]);

  useEffect(() => {
    if (containerStatus === "running") loadList(currentPath);
  }, [currentPath, containerStatus, loadList]);

  if (containerStatus !== "running") {
    return (
      <EmptyState
        icon={<Terminal size={28} />}
        title="容器未运行"
        description="文件管理需要运行中的容器，请先启动容器再进行文件浏览与编辑。"
      />
    );
  }

  const segments = currentPath.split("/").filter(Boolean);

  const openDir = (e: ContainerFileEntry) => {
    setSelectedPath(null);
    setCurrentPath(e.path);
  };

  const openFile = async (e: ContainerFileEntry) => {
    setEditing(e);
    setEditText("");
    setEditError(null);
    setEditLoading(true);
    try {
      const data = await readContainerFileApi(engineId!, containerId, e.path);
      setEditIsBinary(data.isBinary);
      if (!data.isBinary) setEditText(data.content || "");
    } catch (err: any) {
      setEditError(err?.message || "读取文件失败");
    } finally {
      setEditLoading(false);
    }
  };

  const saveFile = async () => {
    if (!editing) return;
    setSaving(true);
    setEditError(null);
    try {
      await writeContainerFileApi(engineId!, containerId, editing.path, editText);
      setEditing(null);
      loadList(currentPath);
    } catch (e: any) {
      setEditError(e?.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const doCreate = async () => {
    if (!createName.trim()) return;
    setBusy(true);
    try {
      const target = `${currentPath === "/" ? "" : currentPath}/${createName.trim()}`;
      await createContainerEntryApi(engineId!, containerId, target, createType);
      setShowCreate(false);
      setCreateName("");
      loadList(currentPath);
    } catch (e: any) {
      setError(e?.message || "创建失败");
    } finally {
      setBusy(false);
    }
  };

  const onUploadClick = () => fileInputRef.current?.click();
  const onFilePicked = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const buf = await file.arrayBuffer();
      const target = `${currentPath === "/" ? "" : currentPath}/${file.name}`;
      await uploadContainerFileApi(engineId!, containerId, target, buf);
      loadList(currentPath);
    } catch (e: any) {
      setError(e?.message || "上传失败");
    } finally {
      setBusy(false);
      ev.target.value = "";
    }
  };

  const selectedEntry = entries.find((e) => e.path === selectedPath) || null;

  return (
    <div className="space-y-3">
      {/* 面包屑 + 工具栏 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 text-sm text-slate-500 flex-wrap min-w-0">
          <button
            onClick={() => { setSelectedPath(null); setCurrentPath("/"); }}
            className="hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Folder size={14} /> 根目录
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-slate-300" />
              <button
                onClick={() => { setSelectedPath(null); setCurrentPath("/" + segments.slice(0, i + 1).join("/")); }}
                className="hover:text-blue-600 transition-colors truncate max-w-[160px]"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => { setCreateType("file"); setCreateName(""); setShowCreate(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <FilePlus2 size={14} /> 新建文件
          </button>
          <button
            onClick={() => { setCreateType("dir"); setCreateName(""); setShowCreate(true); }}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <FolderPlus size={14} /> 新建文件夹
          </button>
          <button
            onClick={onUploadClick}
            disabled={busy}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            <Upload size={14} /> 上传
          </button>
          {/* 选中条目后才可下载：目录走「打包下载」（tar.gz），文件走原样下载 */}
          <button
            onClick={() => {
              if (!selectedEntry) return;
              setBusy(true);
              const task = selectedEntry.isDir
                ? downloadContainerArchiveApi(engineId!, containerId, selectedEntry.path)
                : downloadContainerFileApi(engineId!, containerId, selectedEntry.path);
              task.catch((e) => setError(e?.message || "下载失败")).finally(() => setBusy(false));
            }}
            disabled={!selectedEntry || busy}
            title={selectedEntry ? (selectedEntry.isDir ? "打包为 tar.gz 下载" : "下载文件") : "请先选中文件或文件夹"}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:text-slate-300 disabled:border-slate-100 disabled:bg-slate-50 disabled:cursor-not-allowed disabled:hover:bg-slate-50"
          >
            <Download size={14} /> {selectedEntry ? (selectedEntry.isDir ? "打包下载" : "下载") : "下载"}
          </button>
          <input ref={fileInputRef} type="file" className="hidden" onChange={onFilePicked} />
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
      )}

      {/* 文件列表 */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 bg-slate-50 text-xs font-medium text-slate-500 border-b border-slate-200">
          <span>名称</span>
          <span className="w-24 text-right">大小</span>
          <span className="w-40">修改时间</span>
          <span className="w-20 text-right">权限</span>
        </div>
        {loading && (
          <div className="flex items-center gap-2 justify-center py-10 text-slate-400 text-sm">
            <RefreshCw size={16} className="animate-spin" /> 加载中...
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="py-10 text-center text-slate-400 text-sm">空目录</div>
        )}
        {!loading && entries.map((e) => (
          <div
            key={e.path}
            onClick={() => setSelectedPath(e.path)}
            onDoubleClick={() => (e.isDir ? openDir(e) : openFile(e))}
            className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 items-center border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${
              selectedPath === e.path ? "bg-blue-50" : "hover:bg-slate-50"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {e.isDir ? <Folder size={15} className="text-blue-500 flex-shrink-0" /> : <FileText size={15} className="text-slate-400 flex-shrink-0" />}
              <span className="truncate text-sm text-slate-700">
                {e.name}
                {e.isSymlink && e.target && <span className="text-slate-400 text-xs"> → {e.target}</span>}
              </span>
            </div>
            <span className="w-24 text-right text-xs text-slate-500 font-mono">{e.isDir ? "—" : fmtFileSize(e.size)}</span>
            <span className="w-40 text-xs text-slate-500">{e.mtime ? new Date(e.mtime).toLocaleString() : "—"}</span>
            <span className="w-20 text-right text-xs text-slate-500 font-mono">{e.mode}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">双击文件夹进入目录；双击文件查看/编辑；单击选中后可在右上角下载（目录会打包为 tar.gz）。</p>

      {/* 文件编辑弹窗 */}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={`编辑文件 · ${editing?.name || ""}`} size="xl">
        {editing && (
          <div className="space-y-3">
            <div className="text-xs text-slate-400 break-all">{editing.path}</div>
            {editLoading && (
              <div className="flex items-center gap-2 justify-center py-10 text-slate-400 text-sm">
                <RefreshCw size={16} className="animate-spin" /> 读取中...
              </div>
            )}
            {!editLoading && (
              <>
                {editError && <div className="text-sm text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{editError}</div>}
                {editIsBinary ? (
                  <div className="text-center py-10">
                    <p className="text-sm text-slate-500 mb-3">该文件为二进制文件，无法在浏览器内编辑。</p>
                    <button
                      onClick={() => downloadContainerFileApi(engineId!, containerId, editing.path).catch((e) => setEditError(e?.message || "下载失败"))}
                      className="flex items-center gap-1.5 mx-auto px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
                    >
                      <Download size={14} /> 下载文件
                    </button>
                  </div>
                ) : (
                  <textarea
                    value={editText}
                    onChange={(ev) => setEditText(ev.target.value)}
                    spellCheck={false}
                    className="w-full h-80 p-3 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200 resize-none"
                  />
                )}
              </>
            )}
            <div className="flex items-center justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">取消</button>
              {!editIsBinary && !editLoading && (
                <button
                  onClick={saveFile}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  <Save size={14} /> {saving ? "保存中..." : "保存"}
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 新建弹窗 */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title={createType === "dir" ? "新建文件夹" : "新建文件"} size="sm">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setCreateType("file")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg border ${createType === "file" ? "border-blue-300 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-600"}`}>
              <FilePlus2 size={14} /> 文件
            </button>
            <button onClick={() => setCreateType("dir")} className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm rounded-lg border ${createType === "dir" ? "border-blue-300 bg-blue-50 text-blue-600" : "border-slate-200 text-slate-600"}`}>
              <FolderPlus size={14} /> 文件夹
            </button>
          </div>
          <input
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doCreate()}
            placeholder={createType === "dir" ? "文件夹名称" : "文件名称"}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <div className="flex items-center justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200">取消</button>
            <button onClick={doCreate} disabled={busy || !createName.trim()} className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50">
              {busy ? "创建中..." : "创建"}
            </button>
          </div>
        </div>
      </Modal>

    </div>
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
      {/* 半页面窄栏下两列会挤压换行，统一单列展示 */}
      <div className="space-y-0.5">
        {info.map((item) => (
          <div key={item.label} className="flex items-start gap-3 py-2 border-b border-slate-50">
            <span className="text-sm text-slate-500 w-24 flex-shrink-0">{item.label}</span>
            <span className="text-sm text-slate-700 font-mono break-all min-w-0">{item.value}</span>
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
