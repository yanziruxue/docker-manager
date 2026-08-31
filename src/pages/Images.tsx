import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  Trash2,
  Download,
  RefreshCw,
  Image as ImageIcon,
  AlertTriangle,
  CheckCircle2,
  Filter,
  HardDrive,
  Layers,
  Columns,
  X,
  Loader2,
  XCircle,
  Eye,
} from "lucide-react";
import type { DockerImage, PullTask } from "../types";
import { Tag } from "../components/Badge";
import { ConfirmDialog, Modal } from "../components/Modal";
import { CmdOutputModal, useCmdOutput } from "../components/CmdOutputModal";
import { EmptyState, IconButton, ActionDropdown, type ActionItem } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";

import {
  removeImageApi,
  pruneImagesApi,
  startImagePullApi,
  fetchPullTasksApi,
  fetchPullTaskApi,
  cancelPullTaskApi,
  ApiError,
} from "../api";
import { addOpLog } from "../opLog";
import { formatBytes } from "../transforms";

interface ImagesProps {
  images: DockerImage[];
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  onRefresh?: () => void;
  defaultVisibleColumns?: string[];
  onCheckAllUpdates?: () => void;
  checkingUpdates?: boolean;
}

/**
 * 构造删除用的镜像引用。
 * 优先按 `仓库:标签` 删除——Docker 只会解除该标签，同一镜像 ID 的其它标签不受影响。
 * 悬空镜像（<none>）没有可用标签，才退回按 sha256 digest 删除整个镜像 ID。
 */
function buildImageRef(image: DockerImage): string {
  const repo = image.repository?.trim() || "";
  const tag = image.tag?.trim() || "";
  if (repo && tag && repo !== "<none>" && tag !== "<none>") return `${repo}:${tag}`;
  return `sha256:${image.sha256}`;
}

/** 操作日志里的镜像标识：digest 取短 ID，repotag 原样展示 */
function displayImageRef(ref: string): string {
  return ref.startsWith("sha256:") ? ref.slice(7, 19) : ref;
}

export function Images({ images, loading, error, engineId, onRefresh, defaultVisibleColumns, onCheckAllUpdates, checkingUpdates }: ImagesProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "dangling" | "used" | "unused">("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCleanDangling, setConfirmCleanDangling] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** 删除冲突类型：多仓库引用时可显示「强制删除」，被容器占用时只提示 */
  const [forceDeleteAvailable, setForceDeleteAvailable] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pruneError, setPruneError] = useState<string | null>(null);
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  /** 把 dockerode pruneImages 的返回格式化为 tail 文本 */
  const formatImagePrune = (result: any): string => {
    if (!result) return "（无输出）";
    const deleted = Array.isArray(result.ImagesDeleted) ? result.ImagesDeleted : [];
    const space = typeof result.SpaceReclaimed === "number" ? result.SpaceReclaimed : 0;
    const lines: string[] = [];
    if (deleted.length === 0) {
      lines.push("无悬空镜像需要清理");
    } else {
      lines.push(`已删除 ${deleted.length} 个悬空镜像：`);
      for (const d of deleted) {
        lines.push(`- ${d.Deleted || d.Untagged || JSON.stringify(d)}`);
      }
    }
    lines.push(`释放空间：${formatBytes(space)}`);
    return lines.join("\n");
  };
  const columnPickerRef = useRef<HTMLDivElement>(null);

  // ===== 镜像拉取任务状态 =====
  const [pullTasks, setPullTasks] = useState<PullTask[]>([]);
  const [showPullModal, setShowPullModal] = useState(false);
  const [pullPrefill, setPullPrefill] = useState("");
  const [activePullTaskId, setActivePullTaskId] = useState<string | null>(null);

  // 轮询拉取任务列表：有进行中任务时高频（2.5s），否则低频（10s）
  useEffect(() => {
    if (!engineId) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      try {
        const list = await fetchPullTasksApi(engineId);
        if (stopped) return;
        setPullTasks(list);
        const hasPulling = list.some((t) => t.status === "pulling");
        if (hasPulling && !timer) timer = setInterval(poll, 2500);
        if (!hasPulling && timer) { clearInterval(timer); timer = null; }
      } catch { /* 引擎离线等瞬时错误忽略 */ }
    };
    poll();
    const slowTimer = setInterval(() => {
      // 低频兜底：后台拉取新任务发起后也要能被发现
      if (!timer) poll();
    }, 10000);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      clearInterval(slowTimer);
    };
  }, [engineId]);

  /** 打开拉取弹窗（可预填镜像名，来自行菜单） */
  const openPullModal = (prefill?: string) => {
    setPullPrefill(prefill || "");
    setActivePullTaskId(null);
    setShowPullModal(true);
  };

  /** 从任务条点击查看某个任务的详细进度 */
  const viewPullTask = (taskId: string) => {
    setActivePullTaskId(taskId);
    setShowPullModal(true);
  };

  /** 取消任务条上的拉取任务 */
  const cancelPullFromBar = async (taskId: string) => {
    if (!engineId) return;
    try { await cancelPullTaskApi(engineId, taskId); } catch { /* 状态由轮询同步 */ }
  };

  // 拉取任务条展示范围：进行中 + 5 分钟内结束的任务
  const visiblePullTasks = useMemo(() => {
    const now = Date.now();
    return pullTasks.filter(
      (t) => t.status === "pulling" || (t.endedAt && now - t.endedAt < 5 * 60 * 1000)
    ).slice(0, 6);
  }, [pullTasks]);

  /** 汇总拉取任务已下载字节（用于任务条简报） */
  const pullTaskBytes = (t: PullTask) => {
    const current = t.layers.reduce((s, l) => s + (l.current || 0), 0);
    const total = t.layers.reduce((s, l) => s + (l.total || 0), 0);
    return { current, total };
  };

  /** 当前弹窗关注的任务（从轮询列表中取，保证实时） */
  const activePullTask = useMemo(
    () => pullTasks.find((t) => t.id === activePullTaskId) || null,
    [pullTasks, activePullTaskId],
  );

  /** 发起拉取：调 API 创建任务，成功后切换到进度视图 */
  const [pullStarting, setPullStarting] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const startPull = async () => {
    if (!engineId || !pullPrefill.trim()) return;
    setPullStarting(true);
    setPullError(null);
    try {
      const task = await startImagePullApi(engineId, pullPrefill.trim());
      setActivePullTaskId(task.id);
      // 立即刷新任务列表
      const list = await fetchPullTasksApi(engineId);
      setPullTasks(list);
    } catch (e: any) {
      setPullError(e.message || "启动拉取失败");
    } finally {
      setPullStarting(false);
    }
  };

  /** 后台拉取：关闭弹窗但保持任务运行 */
  const backgroundPull = () => {
    setShowPullModal(false);
    setActivePullTaskId(null);
  };

  /** 取消当前弹窗中的拉取任务 */
  const cancelActivePull = async () => {
    if (!engineId || !activePullTaskId) return;
    try { await cancelPullTaskApi(engineId, activePullTaskId); } catch { /* 轮询同步状态 */ }
  };

  const handleRemoveImage = async (imageRef: string, force = false) => {
    if (!engineId) return;
    setDeleting(true);
    setDeleteError(null);
    setForceDeleteAvailable(false);
    try {
      await removeImageApi(engineId, imageRef, force);
      addOpLog({ action: force ? "强制删除镜像" : "删除镜像", target: displayImageRef(imageRef), status: "success", engineId });
      setConfirmDelete(null);
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: force ? "强制删除镜像" : "删除镜像", target: displayImageRef(imageRef), status: "failed", detail: e.message || "删除失败", engineId });
      setDeleteError(e.message || "删除失败");
      // 多仓库引用冲突 → 提供「强制删除」；被容器占用则只能提示（force 也无效）
      setForceDeleteAvailable(e instanceof ApiError && e.code === "IMAGE_REFERENCED");
    } finally {
      setDeleting(false);
    }
  };

  const handlePruneDangling = async () => {
    if (!engineId) return;
    setPruning(true);
    setPruneError(null);
    try {
      const result = await pruneImagesApi(engineId);
      addOpLog({ action: "清理悬空镜像", target: "全部悬空镜像", status: "success", engineId });
      showOutput({ title: "清理悬空镜像", name: "全部悬空镜像", output: formatImagePrune(result) });
      setConfirmCleanDangling(false);
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: "清理悬空镜像", target: "全部悬空镜像", status: "failed", detail: e.message || "清理失败", engineId });
      showOutput({ title: "清理悬空镜像", name: "全部悬空镜像", output: e.message || "清理失败", failed: true });
      setConfirmCleanDangling(false);
    } finally {
      setPruning(false);
    }
  };

  type ColumnKey = "repository" | "tag" | "id" | "size" | "createdAt" | "associatedContainers" | "sha256" | "actions";
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "repository", label: "仓库名" },
    { key: "tag", label: "标签" },
    { key: "id", label: "镜像 ID" },
    { key: "size", label: "大小" },
    { key: "createdAt", label: "创建时间" },
    { key: "associatedContainers", label: "关联容器" },
    { key: "sha256", label: "SHA-256" },
    { key: "actions", label: "操作" },
  ];

  const defaultSet = defaultVisibleColumns && defaultVisibleColumns.length > 0
    ? new Set(defaultVisibleColumns as ColumnKey[])
    : new Set(allColumns.map(c => c.key));

  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(defaultSet);

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

  const filtered = useMemo(() => {
    return images.filter((img) => {
      const matchSearch = img.repository.toLowerCase().includes(search.toLowerCase()) || img.tag.toLowerCase().includes(search.toLowerCase());
      let matchFilter = true;
      if (filter === "dangling") matchFilter = img.isDangling;
      else if (filter === "used") matchFilter = img.associatedContainers.length > 0;
      else if (filter === "unused") matchFilter = img.associatedContainers.length === 0 && !img.isDangling;
      return matchSearch && matchFilter;
    });
  }, [images, search, filter]);

  const totalSize = images.reduce((sum, img) => {
    const num = parseFloat(img.size);
    if (img.size.includes("GB")) return sum + num * 1024;
    return sum + num;
  }, 0);

  const danglingCount = images.filter((i) => i.isDangling).length;
  const danglingSize = images.filter((i) => i.isDangling).reduce((sum, img) => {
    const num = parseFloat(img.size);
    if (img.size.includes("GB")) return sum + num * 1024;
    return sum + num;
  }, 0);

  const filterOptions = [
    { key: "all", label: "全部", count: images.length },
    { key: "dangling", label: "悬空", count: danglingCount },
    { key: "used", label: "使用中", count: images.filter((i) => i.associatedContainers.length > 0).length },
    { key: "unused", label: "未使用", count: images.filter((i) => i.associatedContainers.length === 0 && !i.isDangling).length },
  ];

  if (loading && images.length === 0) return <LoadingState message="正在加载镜像列表..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6 space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center"><ImageIcon size={18} className="text-blue-500" /></div>
            <div>
              <p className="text-xs text-slate-500">镜像总数</p>
              <p className="text-xl font-bold text-slate-800">{images.length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center"><HardDrive size={18} className="text-purple-500" /></div>
            <div>
              <p className="text-xs text-slate-500">总占用空间</p>
              <p className="text-xl font-bold text-slate-800">{(totalSize / 1024).toFixed(1)} GB</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"><AlertTriangle size={18} className="text-amber-500" /></div>
            <div>
              <p className="text-xs text-slate-500">悬空镜像</p>
              <p className="text-xl font-bold text-slate-800">{danglingCount} <span className="text-sm font-normal text-slate-400">({danglingSize.toFixed(0)} MB)</span></p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center"><Layers size={18} className="text-green-500" /></div>
            <div>
              <p className="text-xs text-slate-500">使用中</p>
              <p className="text-xl font-bold text-slate-800">{images.filter((i) => i.associatedContainers.length > 0).length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索镜像..."
              className="w-64 pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5">
            {filterOptions.map((opt) => (
              <button
                key={opt.key}
                onClick={() => setFilter(opt.key as any)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${filter === opt.key ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}
              >
                {opt.label} <span className="text-slate-400">({opt.count})</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => openPullModal()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
          >
            <Download size={14} /> 拉取镜像
          </button>
          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Columns size={14} /> 列
            </button>
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-200 z-30 p-2">
                <div className="flex items-center justify-between mb-1 px-2 py-1">
                  <span className="text-xs font-semibold text-slate-500">显示列</span>
                  <button onClick={() => setShowColumnPicker(false)} className="text-slate-400 hover:text-slate-600">
                    <X size={12} />
                  </button>
                </div>
                {allColumns.map((col) => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded cursor-pointer">
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(col.key)}
                      onChange={() => toggleColumn(col.key)}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => setConfirmCleanDangling(true)}
            disabled={danglingCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} /> 清理悬空 ({danglingCount})
          </button>
          {onCheckAllUpdates && (
            <button
              onClick={onCheckAllUpdates}
              disabled={checkingUpdates}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw size={14} className={checkingUpdates ? "animate-spin" : ""} />
              {checkingUpdates ? "检查中..." : "检查全部更新"}
            </button>
          )}
        </div>
      </div>

      {/* 拉取任务条：进行中 + 最近完成的任务（后台拉取也在此展示） */}
      {visiblePullTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Download size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-slate-600">镜像拉取任务</span>
          </div>
          {visiblePullTasks.map((t) => {
            const bytes = pullTaskBytes(t);
            const pct = bytes.total > 0 ? Math.min((bytes.current / bytes.total) * 100, 100) : null;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-100 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                onClick={() => viewPullTask(t.id)}
              >
                {t.status === "pulling" ? (
                  <Loader2 size={14} className="text-blue-500 animate-spin flex-shrink-0" />
                ) : t.status === "success" ? (
                  <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle size={14} className="text-red-500 flex-shrink-0" />
                )}
                <span className="text-sm font-mono text-slate-700 truncate flex-1">{t.image}</span>
                {t.status === "pulling" && pct != null && (
                  <>
                    <div className="w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden hidden md:block">
                      <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs font-mono text-slate-500 whitespace-nowrap hidden sm:inline">{pct.toFixed(0)}%</span>
                  </>
                )}
                {t.status === "pulling" && (
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {(bytes.current / 1024 / 1024).toFixed(1)}MB{bytes.total > 0 ? ` / ${(bytes.total / 1024 / 1024).toFixed(1)}MB` : ""}
                  </span>
                )}
                {t.status !== "pulling" && (
                  <span className={`text-xs whitespace-nowrap ${t.status === "success" ? "text-green-600" : "text-red-500"}`}>
                    {t.status === "success" ? "拉取完成" : t.status === "canceled" ? "已取消" : "失败"}
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs text-blue-500 whitespace-nowrap">
                  <Eye size={12} /> 详情
                </span>
                {t.status === "pulling" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); cancelPullFromBar(t.id); }}
                    className="px-2 py-0.5 text-xs text-red-600 border border-red-200 rounded hover:bg-red-50 whitespace-nowrap"
                  >
                    取消
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {visibleColumns.has("repository") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 whitespace-nowrap">仓库名</th>}
                {visibleColumns.has("tag") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">标签</th>}
                {visibleColumns.has("id") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">镜像 ID</th>}
                {visibleColumns.has("size") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">大小</th>}
                {visibleColumns.has("createdAt") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">创建时间</th>}
                {visibleColumns.has("associatedContainers") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">关联容器</th>}
                {visibleColumns.has("sha256") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">SHA-256</th>}
                {visibleColumns.has("actions") && <th className="text-right text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">操作</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((img) => (
                <tr key={img.id} className="hover:bg-slate-50 transition-colors">
                  {visibleColumns.has("repository") && (
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-mono text-slate-700">{img.repository}</span>
                        {img.isDangling && <Tag text="悬空" color="amber" />}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("tag") && <td className="px-3 py-3 whitespace-nowrap"><Tag text={img.tag} color={img.tag === "latest" ? "blue" : "slate"} /></td>}
                  {visibleColumns.has("id") && <td className="px-3 py-3 whitespace-nowrap"><span className="text-xs font-mono text-slate-400">{img.id}</span></td>}
                  {visibleColumns.has("size") && <td className="px-3 py-3 whitespace-nowrap"><span className="text-sm text-slate-600">{img.size}</span></td>}
                  {visibleColumns.has("createdAt") && <td className="px-3 py-3 whitespace-nowrap"><span className="text-sm text-slate-500">{img.createdAt}</span></td>}
                  {visibleColumns.has("associatedContainers") && (
                    <td className="px-3 py-3">
                      {img.associatedContainers.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {img.associatedContainers.slice(0, 3).map((c) => (
                            <Tag key={c} text={c} color="slate" />
                          ))}
                          {img.associatedContainers.length > 3 && (
                            <span className="text-xs text-slate-400">+{img.associatedContainers.length - 3}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-300 whitespace-nowrap">—</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.has("sha256") && (
                    <td className="px-3 py-3">
                      {img.sha256 ? (
                        <span className="text-xs font-mono text-slate-400">{img.sha256.substring(0, 16)}...</span>
                      ) : (
                        <span className="text-xs text-slate-300">—</span>
                      )}
                    </td>
                  )}
                  {visibleColumns.has("actions") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center justify-end">
                        <ActionDropdown
                          items={[
                            { label: "拉取", icon: <Download size={14} />, onClick: () => openPullModal(`${img.repository}:${img.tag}`) },
                            { label: "检查更新", icon: <RefreshCw size={14} />, onClick: () => onCheckAllUpdates?.() },
                            { separator: true },
                            {
                              label: img.associatedContainers.length > 0 ? "删除（使用中）" : "删除",
                              icon: <Trash2 size={14} />,
                              danger: true,
                              disabled: img.associatedContainers.length > 0,
                              onClick: () => {
                                setDeleteError(null);
                                setForceDeleteAvailable(false);
                                setConfirmDelete(buildImageRef(img));
                              },
                            },
                          ]}
                        />
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <EmptyState icon={<Filter size={28} />} title="未找到匹配的镜像" description="尝试调整搜索条件或筛选器" />
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); setDeleteError(null); setForceDeleteAvailable(false); }}
        onConfirm={() => { if (confirmDelete) { handleRemoveImage(confirmDelete); } }}
        title="删除镜像"
        message="确定要删除此镜像吗？如果有关联的容器，需要先删除或更新对应容器。"
        confirmText="删除"
        danger
        loading={deleting}
        errorMessage={deleteError}
        extraAction={
          forceDeleteAvailable && confirmDelete
            ? { label: "强制删除", onClick: () => handleRemoveImage(confirmDelete, true), loading: deleting }
            : undefined
        }
      />

      <ConfirmDialog
        open={confirmCleanDangling}
        onClose={() => { setConfirmCleanDangling(false); setPruneError(null); }}
        onConfirm={() => { handlePruneDangling(); }}
        title="清理悬空镜像"
        message={`将删除 ${danglingCount} 个悬空镜像，释放约 ${danglingSize.toFixed(0)} MB 空间。此操作不可撤销。`}
        confirmText="清理"
        danger
        loading={pruning}
        errorMessage={pruneError}
      />

      {/* 命令输出弹窗（清理悬空镜像的 tail 文本） */}
      <CmdOutputModal data={cmdOutput} onClose={closeOutput} />

      {/* ===== 镜像拉取弹窗 ===== */}
      <Modal
        open={showPullModal}
        onClose={() => { setShowPullModal(false); setActivePullTaskId(null); }}
        title={activePullTask ? `拉取进度: ${activePullTask.image}` : "拉取镜像"}
        size="lg"
        dismissable={false}
      >
        {/* 情况一：无活跃任务，显示输入框发起拉取 */}
        {!activePullTask && (
          <div className="p-6 space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 mb-1.5 block">镜像名称</label>
              <input
                value={pullPrefill}
                onChange={(e) => setPullPrefill(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && pullPrefill.trim() && !pullStarting) startPull(); }}
                placeholder="例如: nginx:latest 或 redis:7-alpine"
                autoFocus
                className="w-full px-3 py-2.5 text-sm font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
              <p className="text-xs text-slate-400 mt-1.5">输入完整镜像名（含 Tag），按回车或点击下方按钮开始拉取</p>
            </div>
            {pullError && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg">
                <AlertTriangle size={14} /> {pullError}
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowPullModal(false); setActivePullTaskId(null); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                取消
              </button>
              <button
                onClick={startPull}
                disabled={!pullPrefill.trim() || pullStarting}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pullStarting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {pullStarting ? "启动中..." : "开始拉取"}
              </button>
            </div>
          </div>
        )}

        {/* 情况二：拉取进行中，显示实时进度 + 后台拉取/取消拉取按钮 */}
        {activePullTask && activePullTask.status === "pulling" && (
          <div className="p-6 space-y-4">
            {/* 总进度条 */
              (() => {
                const bytes = pullTaskBytes(activePullTask);
                const pct = bytes.total > 0 ? Math.min((bytes.current / bytes.total) * 100, 100) : 0;
                return (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-slate-700">总进度</span>
                      <span className="text-sm font-mono text-slate-500">
                        {bytes.total > 0
                          ? `${(bytes.current / 1024 / 1024).toFixed(1)}MB / ${(bytes.total / 1024 / 1024).toFixed(1)}MB (${pct.toFixed(0)}%)`
                          : `${(bytes.current / 1024 / 1024).toFixed(1)}MB 已下载`}
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: bytes.total > 0 ? `${pct}%` : "100%", opacity: bytes.total > 0 ? 1 : 0.4 }} />
                    </div>
                  </div>
                );
              })()
            }

            {/* 各层进度 */
              activePullTask.layers.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-2">镜像层 ({activePullTask.layers.length})</div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                    {activePullTask.layers.map((layer) => {
                      const lpct = layer.total && layer.total > 0 ? Math.min((layer.current! / layer.total) * 100, 100) : null;
                      return (
                        <div key={layer.id} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400 w-16 truncate">{layer.id.substring(0, 12)}</span>
                          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            {lpct != null ? (
                              <div className="h-full bg-blue-400 rounded-full transition-all" style={{ width: `${lpct}%` }} />
                            ) : (
                              <div className="h-full bg-slate-300 rounded-full" style={{ width: layer.status.includes("complete") || layer.status.includes("Already") ? "100%" : "30%", opacity: 0.6 }} />
                            )}
                          </div>
                          <span className="text-xs text-slate-400 whitespace-nowrap w-32 truncate">{layer.status || (layer.progress || "")}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )
            }

            {/* 最近输出行 */
              activePullTask.outputTail.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-2">输出日志</div>
                  <div className="bg-slate-900 text-slate-300 rounded-lg p-3 max-h-32 overflow-y-auto font-mono text-xs leading-relaxed">
                    {activePullTask.outputTail.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap">{line}</div>
                    ))}
                  </div>
                </div>
              )
            }

            {/* 操作按钮：后台拉取 + 取消拉取 */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                onClick={backgroundPull}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                <Eye size={14} /> 后台拉取
              </button>
              <button
                onClick={cancelActivePull}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                <XCircle size={14} /> 取消拉取
              </button>
            </div>
          </div>
        )}

        {/* 情况三：拉取完成（成功/失败/取消），显示结果 + 关闭按钮 */}
        {activePullTask && activePullTask.status !== "pulling" && (
          <div className="p-6 space-y-4">
            <div className={`flex items-center gap-3 px-4 py-3 rounded-lg ${
              activePullTask.status === "success" ? "bg-green-50 text-green-700" :
              activePullTask.status === "canceled" ? "bg-slate-50 text-slate-600" :
              "bg-red-50 text-red-600"
            }`}>
              {activePullTask.status === "success" ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
              <div>
                <div className="text-sm font-semibold">
                  {activePullTask.status === "success" ? "拉取成功" : activePullTask.status === "canceled" ? "已取消拉取" : "拉取失败"}
                </div>
                {activePullTask.error && <div className="text-xs mt-0.5 opacity-80">{activePullTask.error}</div>}
              </div>
            </div>

            {/* 输出日志 */
              activePullTask.outputTail.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 mb-2">输出日志</div>
                  <div className="bg-slate-900 text-slate-300 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs leading-relaxed">
                    {activePullTask.outputTail.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap">{line}</div>
                    ))}
                  </div>
                </div>
              )
            }

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => { setShowPullModal(false); setActivePullTaskId(null); onRefresh?.(); }}
                className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
              >
                关闭
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
