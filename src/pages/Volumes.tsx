import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Database,
  Search,
  Trash2,
  Download,
  RefreshCw,
  Plus,
  HardDrive,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Eye,
  Terminal,
  Info,
  Columns,
  X,
} from "lucide-react";
import type { DockerVolume } from "../types";
import { Tag } from "../components/Badge";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { Modal, ConfirmDialog } from "../components/Modal";
import { CmdOutputModal, useCmdOutput } from "../components/CmdOutputModal";
import { IconButton, EmptyState, FormField, Input, Select, ActionDropdown } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";
import { formatBytes } from "../transforms";
import { removeVolumeApi, pruneVolumesApi, createVolumeApi } from "../api";
import { addOpLog } from "../opLog";

interface VolumesProps {
  volumes: DockerVolume[];
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  defaultVisibleColumns?: string[];
  onRefresh?: () => void;
}

export function Volumes({ volumes, loading, error, engineId, defaultVisibleColumns, onRefresh }: VolumesProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; volume: DockerVolume } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCleanUnused, setConfirmCleanUnused] = useState(false);
  const [detailVolume, setDetailVolume] = useState<DockerVolume | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  /** 把 dockerode pruneVolumes 的返回格式化为 tail 文本 */
  const formatVolumePrune = (result: any): string => {
    if (!result) return "（无输出）";
    const deleted = Array.isArray(result.VolumesDeleted) ? result.VolumesDeleted : [];
    const space = typeof result.SpaceReclaimed === "number" ? result.SpaceReclaimed : 0;
    const lines: string[] = [];
    if (deleted.length === 0) {
      lines.push("无未使用数据卷需要清理");
    } else {
      lines.push(`已删除 ${deleted.length} 个未使用数据卷：`);
      for (const v of deleted) lines.push(`- ${v}`);
    }
    lines.push(`释放空间：${formatBytes(space)}`);
    return lines.join("\n");
  };

  const handleRemoveVolume = async (volumeName: string) => {
    if (!engineId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await removeVolumeApi(engineId, volumeName);
      setConfirmDelete(null);
      onRefresh?.();
    } catch (e: any) {
      setDeleteError(e.message || "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handlePruneVolumes = async () => {
    if (!engineId) return;
    try {
      const result = await pruneVolumesApi(engineId);
      addOpLog({ action: "清理未使用数据卷", target: "全部未使用卷", status: "success", engineId });
      showOutput({ title: "清理未使用数据卷", name: "全部未使用卷", output: formatVolumePrune(result) });
      setConfirmCleanUnused(false);
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: "清理未使用数据卷", target: "全部未使用卷", status: "failed", detail: e.message || "清理失败", engineId });
      showOutput({ title: "清理未使用数据卷", name: "全部未使用卷", output: e.message || "清理失败", failed: true });
      setConfirmCleanUnused(false);
    }
  };

  type ColumnKey = "name" | "driver" | "mountpoint" | "size" | "associatedContainers" | "createdAt" | "inUse" | "actions";
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "name", label: "卷名称" },
    { key: "driver", label: "驱动" },
    { key: "mountpoint", label: "挂载点" },
    { key: "size", label: "大小" },
    { key: "associatedContainers", label: "关联容器" },
    { key: "createdAt", label: "创建时间" },
    { key: "inUse", label: "状态" },
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
    return volumes.filter((v) => {
      const matchSearch =
        v.name.toLowerCase().includes(search.toLowerCase()) ||
        v.driver.toLowerCase().includes(search.toLowerCase()) ||
        v.associatedContainers.some((c) => c.toLowerCase().includes(search.toLowerCase()));
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "inuse" && v.inUse) ||
        (statusFilter === "unused" && !v.inUse);
      return matchSearch && matchStatus;
    });
  }, [volumes, search, statusFilter]);

  const totalSize = volumes.filter((v) => v.size !== "—").length;
  const unusedCount = volumes.filter((v) => !v.inUse).length;

  const getVolumeMenuItems = (volume: DockerVolume): MenuItem[] => {
    const items: MenuItem[] = [];
    items.push({ label: "查看详情", icon: <Info size={14} />, onClick: () => setDetailVolume(volume) });
    items.push({ label: "检查使用情况", icon: <Search size={14} />, onClick: () => {} });
    items.push({ separator: true });
    if (volume.inUse) {
      items.push({ label: "查看关联容器", icon: <ChevronRight size={14} />, onClick: () => {} });
    }
    items.push({ label: "导出快照", icon: <Download size={14} />, onClick: () => {} });
    items.push({ separator: true });
    if (!volume.inUse) {
      items.push({ label: "删除", icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirmDelete(volume.id) });
    } else {
      items.push({ label: "删除", icon: <Trash2 size={14} />, danger: true, disabled: true, onClick: () => {} });
    }
    return items;
  };

  if (loading && volumes.length === 0) return <LoadingState message="正在加载数据卷列表..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center">
              <Database size={20} className="text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{volumes.length}</p>
              <p className="text-xs text-slate-400">数据卷总数</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center">
              <CheckCircle2 size={20} className="text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{volumes.filter((v) => v.inUse).length}</p>
              <p className="text-xs text-slate-400">使用中</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <AlertTriangle size={20} className="text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{unusedCount}</p>
              <p className="text-xs text-slate-400">未使用（悬空）</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-purple-50 flex items-center justify-center">
              <HardDrive size={20} className="text-purple-500" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-700">{totalSize}</p>
              <p className="text-xs text-slate-400">已统计大小</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索卷名、驱动或容器..."
              className="w-64 pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          >
            <option value="all">全部</option>
            <option value="inuse">使用中</option>
            <option value="unused">未使用</option>
          </select>
          <span className="text-sm text-slate-400">{filtered.length} 个数据卷</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Column Picker */}
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
            onClick={() => setConfirmCleanUnused(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors"
          >
            <AlertTriangle size={14} /> 清理悬空卷 ({unusedCount})
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <RefreshCw size={14} /> 刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
          >
            <Plus size={14} /> 新建数据卷
          </button>
        </div>
      </div>

      {/* Volume Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                {visibleColumns.has("name") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-5 py-3 whitespace-nowrap">卷名称</th>}
                {visibleColumns.has("driver") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">驱动</th>}
                {visibleColumns.has("mountpoint") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">挂载点</th>}
                {visibleColumns.has("size") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">大小</th>}
                {visibleColumns.has("associatedContainers") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">关联容器</th>}
                {visibleColumns.has("inUse") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">状态</th>}
                {visibleColumns.has("createdAt") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">创建时间</th>}
                {visibleColumns.has("actions") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-3 whitespace-nowrap">操作</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((volume) => (
                <tr
                  key={volume.id}
                  className="hover:bg-slate-50/50 transition-colors cursor-context-menu border-b border-slate-50 last:border-0"
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, volume }); }}
                >
                  {visibleColumns.has("name") && (
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Database size={14} className={volume.inUse ? "text-blue-400" : "text-slate-300"} />
                        <span className="text-sm font-medium text-slate-700 font-mono">{volume.name}</span>
                        {volume.labels?.some((l) => l.key === "com.docker.compose.project") && (
                          <Tag text={volume.labels.find((l) => l.key === "com.docker.compose.project")?.value || ""} color="purple" />
                        )}
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("driver") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-xs text-slate-500 font-mono">{volume.driver}</span>
                    </td>
                  )}
                  {visibleColumns.has("mountpoint") && (
                    <td className="px-3 py-3">
                      <span className="text-xs font-mono text-slate-400 truncate block max-w-[200px]">{volume.mountpoint}</span>
                    </td>
                  )}
                  {visibleColumns.has("size") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-xs text-slate-500">{volume.size || "—"}</span>
                    </td>
                  )}
                  {visibleColumns.has("associatedContainers") && (
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {volume.associatedContainers.length > 0
                          ? volume.associatedContainers.map((c) => (
                              <span key={c} className="inline-flex items-center px-2 py-0.5 text-[11px] font-mono bg-slate-100 text-slate-600 rounded">
                                {c}
                              </span>
                            ))
                          : <span className="text-xs text-slate-300">—</span>
                        }
                      </div>
                    </td>
                  )}
                  {visibleColumns.has("inUse") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      {volume.inUse ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <CheckCircle2 size={12} /> 使用中
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-xs text-amber-500">
                          <AlertTriangle size={12} /> 未使用
                        </span>
                      )}
                    </td>
                  )}
                  {visibleColumns.has("createdAt") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="text-xs text-slate-500">{volume.createdAt || "—"}</span>
                    </td>
                  )}
                  {visibleColumns.has("actions") && (
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex items-center">
                        <ActionDropdown
                          items={[
                            { label: "详情", icon: <Eye size={14} />, onClick: () => setDetailVolume(volume) },
                            { label: "导出", icon: <Download size={14} />, onClick: () => {} },
                            { separator: true },
                            {
                              label: volume.inUse ? "删除（使用中）" : "删除",
                              icon: <Trash2 size={14} />,
                              danger: true,
                              disabled: volume.inUse,
                              onClick: () => !volume.inUse && setConfirmDelete(volume.id),
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
          <EmptyState icon={<Database size={28} />} title="未找到匹配的数据卷" description="尝试调整搜索条件或新建数据卷" />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getVolumeMenuItems(contextMenu.volume)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Volume Detail Modal */}
      {detailVolume && (
        <Modal open={true} onClose={() => setDetailVolume(null)} title={`数据卷详情 - ${detailVolume.name}`} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">驱动</p>
                <p className="text-sm font-mono text-slate-700">{detailVolume.driver}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">大小</p>
                <p className="text-sm font-mono text-slate-700">{detailVolume.size || "—"}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg col-span-2">
                <p className="text-xs text-slate-400 mb-1">挂载点</p>
                <p className="text-sm font-mono text-slate-700 break-all">{detailVolume.mountpoint}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">创建时间</p>
                <p className="text-sm text-slate-700">{detailVolume.createdAt || "—"}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-lg">
                <p className="text-xs text-slate-400 mb-1">状态</p>
                <p className={`text-sm font-medium ${detailVolume.inUse ? "text-green-600" : "text-amber-500"}`}>
                  {detailVolume.inUse ? "使用中" : "未使用（悬空）"}
                </p>
              </div>
            </div>
            {detailVolume.associatedContainers.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">关联容器</p>
                <div className="space-y-1">
                  {detailVolume.associatedContainers.map((c) => (
                    <div key={c} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                      <Database size={14} className="text-slate-400" />
                      <span className="text-sm font-mono text-slate-700">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detailVolume.labels && detailVolume.labels.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">标签</p>
                <div className="space-y-1">
                  {detailVolume.labels.map((label, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                      <span className="text-xs font-mono text-slate-500">{label.key}</span>
                      <span className="text-xs text-slate-400">=</span>
                      <span className="text-xs font-mono text-slate-700">{label.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detailVolume.options && detailVolume.options.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">驱动选项</p>
                <div className="space-y-1">
                  {detailVolume.options.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg">
                      <span className="text-xs font-mono text-slate-500">{opt.key}</span>
                      <span className="text-xs text-slate-400">=</span>
                      <span className="text-xs font-mono text-slate-700">{opt.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
              <button className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                <Terminal size={14} /> 终端
              </button>
              <button className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                <Download size={14} /> 导出快照
              </button>
              <button
                onClick={() => { setConfirmDelete(detailVolume.id); setDeleteError(null); setDetailVolume(null); }}
                disabled={detailVolume.inUse}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg ml-auto transition-colors ${
                  detailVolume.inUse
                    ? "text-slate-300 bg-slate-100 cursor-not-allowed"
                    : "text-white bg-red-500 hover:bg-red-600"
                }`}
              >
                <Trash2 size={14} /> 删除卷
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); setDeleteError(null); }}
        onConfirm={() => { if (confirmDelete) { handleRemoveVolume(confirmDelete); } }}
        title="删除数据卷"
        message="确定要删除此数据卷吗？删除后数据将不可恢复。仅未使用的卷可以删除。"
        confirmText="删除"
        danger
        loading={deleting}
        errorMessage={deleteError}
      />

      {/* Clean Unused Confirmation */}
      <ConfirmDialog
        open={confirmCleanUnused}
        onClose={() => setConfirmCleanUnused(false)}
        onConfirm={() => { handlePruneVolumes(); setConfirmCleanUnused(false); }}
        title="清理悬空数据卷"
        message={`将删除 ${unusedCount} 个未使用的数据卷。此操作不可撤销。`}
        confirmText="清理"
        danger
      />

      {/* 命令输出弹窗（清理未使用数据卷的 tail 文本） */}
      <CmdOutputModal data={cmdOutput} onClose={closeOutput} />

      {/* Create Volume Modal */}
      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="新建数据卷" size="md">
          <CreateVolumeForm onClose={() => setShowCreate(false)} engineId={engineId} onRefresh={onRefresh} />
        </Modal>
      )}
    </div>
  );
}

function CreateVolumeForm({ onClose, engineId, onRefresh }: { onClose: () => void; engineId?: string; onRefresh?: () => void }) {
  const [name, setName] = useState("");
  const [driver, setDriver] = useState("local");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const handleCreate = async () => {
    if (!name.trim() || !engineId) return;
    setCreating(true);
    setError("");
    try {
      await createVolumeApi(engineId, name.trim(), driver);
      onClose();
      onRefresh?.();
    } catch (err: any) {
      setError(err.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="px-3 py-2 text-sm text-red-600 bg-red-50 rounded-lg border border-red-100">
          {error}
        </div>
      )}
      <FormField label="卷名称" required>
        <Input value={name} onChange={setName} placeholder="如: my-data-volume" />
      </FormField>
      <FormField label="驱动">
        <Select
          value={driver}
          onChange={setDriver}
          options={[
            { value: "local", label: "local（本地）" },
          ]}
        />
      </FormField>
      <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
        <button onClick={onClose} disabled={creating} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">取消</button>
        <button
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {creating ? "创建中..." : "创建"}
        </button>
      </div>
    </div>
  );
}
