import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import {
  Play,
  Square,
  RotateCw,
  Download,
  Edit3,
  Copy,
  Trash2,
  Globe,
  Terminal,
  GitBranch,
  Search,
  Plus,
  Upload,
  ChevronDown,
  ChevronRight,
  Lock,
  RefreshCw,
  Package,
  Hammer,
  Layers,
  AlertCircle,
  CheckCircle2,
  Tag as TagIcon,
  FolderTree,
  FileCode,
  FileText,
  Settings as SettingsIcon,
  Bell,
  Eye,
  EyeOff,
  Wrench,
  CheckSquare,
  Square as SquareIcon,
  X,
  Filter,
  Loader2,
} from "lucide-react";
import type { Stack, StackContainer } from "../types";
import {
  createStackApi,
  stackActionApi,
  removeStackApi,
  saveStackComposeApi,
  saveStackEnvApi,
  saveStackSettingsApi,
  uploadStackIconApi,
  backupStackApi,
  batchStackActionApi,
  containerActionApi,
  fetchContainerLogs,
} from "../api";
import { addOpLog } from "../opLog";
import { StatusBadge, Tag } from "../components/Badge";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { Modal, ConfirmDialog } from "../components/Modal";
import { CmdOutputModal, useCmdOutput } from "../components/CmdOutputModal";
import { Toggle, IconButton, EmptyState, FormField, Input, Select, ProgressBar } from "../components/UI";
import { LoadingState, ErrorState } from "../components/DataState";

/**
 * 从 Compose YAML 内容中提取 services 下的服务名列表。
 * 服务声明了 container_name 时优先返回 container_name（与实际 Docker 容器名一致，
 * 便于 WebUI Labels 与容器列表/图标联动）。
 */
function parseComposeServices(composeContent: string): string[] {
  if (!composeContent) return [];
  const lines = composeContent.split("\n");
  const services: string[] = [];
  let inServices = false;
  let servicesIndent = -1;
  let currentName: string | null = null; // 当前服务的服务名
  let containerName: string | null = null; // 当前服务的 container_name

  const commit = () => {
    if (currentName) services.push(containerName || currentName);
    currentName = null;
    containerName = null;
  };

  for (const line of lines) {
    const trimmed = line.trimEnd();
    // 跳过空行和纯注释行
    if (trimmed === "" || /^\s*#/.test(trimmed)) continue;

    const leadingSpaces = line.length - (line as string).trimStart().length;

    if (!inServices) {
      // 查找顶层的 services: 键（允许前面有少量空白，但通常无缩进）
      if (/^\s*services\s*:/.test(line) && leadingSpaces <= 2) {
        inServices = true;
        servicesIndent = -1; // 尚未确定 services 子项的缩进
      }
    } else {
      // 已进入 services 块
      if (leadingSpaces <= (servicesIndent > 0 ? servicesIndent - 1 : 0)) {
        // 缩进回退到 services 同级或更浅，说明 services 块结束
        break;
      }
      if (servicesIndent < 0) {
        // 第一条非空子行，记录其缩进作为基准
        servicesIndent = leadingSpaces;
      }
      if (leadingSpaces === servicesIndent) {
        // 匹配服务名：缩进与基准一致，且格式为 name: 或 name: #注释
        const match = trimmed.match(/^([a-zA-Z0-9_.-]+)\s*:/);
        if (match) {
          commit();
          currentName = match[1];
        }
      } else if (currentName && leadingSpaces > servicesIndent) {
        // 服务属性行，检测 container_name: xxx
        const m = trimmed.match(/^container_name\s*:\s*["']?([a-zA-Z0-9_.-]+)/);
        if (m) containerName = m[1];
      }
    }
  }
  commit();
  return services;
}

interface StacksProps {
  stacks: Stack[];
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  onRefresh?: () => void;
  menuLanguage?: "en" | "zh";
}

export function Stacks({ stacks, loading, error, engineId, onRefresh, menuLanguage = "en" }: StacksProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"basic" | "advanced">("basic");
  const [expandedStacks, setExpandedStacks] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stack: Stack; container?: StackContainer } | null>(null);
  const [editStack, setEditStack] = useState<Stack | null>(null);

  // 刷新 stacks 后同步 editStack 引用，确保编辑弹窗的元数据（composeFilePath 等）是最新的
  useEffect(() => {
    if (editStack) {
      const updated = stacks.find(s => s.name === editStack.name);
      if (updated) setEditStack(updated);
    }
  }, [stacks]);
  const [createMode, setCreateMode] = useState(false);
  const [terminalStack, setTerminalStack] = useState<Stack | null>(null);
  const [logStack, setLogStack] = useState<Stack | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  /**
   * 堆栈操作的命令输出弹窗（tail 文本形式）。
   * 启动/停止/重启/拉取/构建等操作执行完后统一在此展示 compose 的完整输出，
   * 失败时同样弹出并展示失败详情（failed = true 时标红）。
   */
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  // 操作状态
  const [operatingStacks, setOperatingStacks] = useState<Set<string>>(new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [batchOperating, setBatchOperating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const addOperating = useCallback((name: string) => setOperatingStacks((prev) => new Set(prev).add(name)), []);
  const removeOperating = useCallback((name: string) => setOperatingStacks((prev) => { const n = new Set(prev); n.delete(name); return n; }), []);

  /** 堆栈操作的中文名（用于操作日志与输出弹窗标题） */
  const STACK_ACTION_LABEL: Record<string, string> = { up: "启动堆栈", down: "关闭堆栈", pull: "拉取镜像", restart: "重启堆栈", build: "构建堆栈", delete: "删除堆栈" };

  // 执行堆栈操作：命令输出统一以 tail 文本弹窗展示（成功与失败都弹）
  const handleStackAction = async (stackName: string, action: "up" | "down" | "pull" | "restart" | "build") => {
    if (!engineId || operatingStacks.has(stackName)) return;
    setOperationError(null);
    addOperating(stackName);
    const label = STACK_ACTION_LABEL[action] || action;
    try {
      const output = await stackActionApi(engineId, stackName, action);
      addOpLog({ action: label, target: stackName, status: "success", engineId });
      showOutput({ title: label, name: stackName, output: output || "（命令执行成功，无输出）" });
      onRefresh?.();
    } catch (e: any) {
      const detail = e?.message || "操作失败";
      addOpLog({ action: label, target: stackName, status: "failed", detail, engineId });
      showOutput({ title: label, name: stackName, output: detail, failed: true });
    } finally {
      removeOperating(stackName);
    }
  };

  /**
   * 多步组合操作（如 强制更新 = pull + up、构建并启动 = build + up）。
   * 各步输出按顺序汇总到同一个弹窗；中途失败则展示已完成步骤的输出 + 失败详情。
   */
  const handleStackSteps = async (
    stackName: string,
    label: string,
    actions: ("up" | "down" | "pull" | "restart" | "build")[]
  ) => {
    if (!engineId || operatingStacks.has(stackName)) return;
    setOperationError(null);
    addOperating(stackName);
    const chunks: string[] = [];
    try {
      for (const action of actions) {
        const output = await stackActionApi(engineId, stackName, action);
        chunks.push(output || `（${action} 无输出）`);
      }
      addOpLog({ action: label, target: stackName, status: "success", engineId });
      showOutput({ title: label, name: stackName, output: chunks.join("\n\n") });
      onRefresh?.();
    } catch (e: any) {
      const detail = e?.message || "操作失败";
      addOpLog({ action: label, target: stackName, status: "failed", detail, engineId });
      showOutput({ title: label, name: stackName, output: [...chunks, detail].join("\n\n"), failed: true });
    } finally {
      removeOperating(stackName);
    }
  };

  // 执行堆栈删除（docker compose down 输出以 tail 文本弹窗展示）
  const handleDeleteStack = async (stackName: string, removeVolumes: boolean) => {
    if (!engineId || deleting) return;
    setDeleting(true);
    try {
      const output = await removeStackApi(engineId, stackName, removeVolumes);
      addOpLog({ action: "删除堆栈", target: stackName, status: "success", detail: removeVolumes ? "含数据卷" : undefined, engineId });
      showOutput({ title: "删除堆栈", name: stackName, output: output || "（无输出）" });
      onRefresh?.();
      setConfirmDelete(null);
    } catch (e: any) {
      const detail = e.message || "删除失败";
      addOpLog({ action: "删除堆栈", target: stackName, status: "failed", detail, engineId });
      showOutput({ title: "删除堆栈", name: stackName, output: detail, failed: true });
      setConfirmDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  // 备份堆栈（结果以 tail 文本弹窗展示）
  const handleBackup = async (stackName: string) => {
    if (!engineId) return;
    addOperating(stackName);
    try {
      const result = await backupStackApi(engineId, stackName);
      addOpLog({ action: "备份堆栈", target: stackName, status: "success", detail: result.backupName, engineId });
      showOutput({ title: "备份堆栈", name: stackName, output: `备份成功\n备份文件: ${result.backupName}` });
    } catch (e: any) {
      const detail = e.message || "备份失败";
      addOpLog({ action: "备份堆栈", target: stackName, status: "failed", detail, engineId });
      showOutput({ title: "备份堆栈", name: stackName, output: detail, failed: true });
    } finally {
      removeOperating(stackName);
    }
  };

  // 批量操作（逐堆栈结果汇总到 tail 文本弹窗）
  const handleBatchAction = async (action: "up" | "down" | "restart" | "pull" | "delete") => {
    if (!engineId || batchOperating) return;
    const names = Array.from(selected).map((id) => stacks.find((s) => s.id === id)?.name).filter(Boolean) as string[];
    if (names.length === 0) return;
    setBatchOperating(action);
    try {
      const results = await batchStackActionApi(engineId, action, names);
      const label = STACK_ACTION_LABEL[action] || action;
      const lines = results.map((r) => (r.success ? `✓ ${r.stackName}` : `✗ ${r.stackName}: ${r.error || "失败"}`));
      const failedCount = results.filter((r) => !r.success).length;
      const summary = `${label} 完成：${results.length - failedCount} 成功 / ${failedCount} 失败`;
      showOutput({
        title: `批量${label}`,
        name: `${names.length} 个堆栈`,
        output: `${summary}\n\n${lines.join("\n")}`,
        failed: failedCount > 0,
      });
      onRefresh?.();
    } catch (e: any) {
      showOutput({ title: "批量操作", name: `${names.length} 个堆栈`, output: e.message || "批量操作失败", failed: true });
    } finally {
      setBatchOperating(null);
    }
  };

  // 容器操作（堆栈内单个容器）
  const handleContainerAction = async (containerName: string, action: "start" | "stop" | "restart" | "pause" | "unpause") => {
    if (!engineId) return;
    addOperating(containerName);
    const actionNames: Record<string, string> = { start: "启动容器", stop: "停止容器", restart: "重启容器", pause: "暂停容器", unpause: "恢复容器" };
    try {
      await containerActionApi(engineId, containerName, action);
      addOpLog({ action: actionNames[action] || action, target: containerName, status: "success", engineId });
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: actionNames[action] || action, target: containerName, status: "failed", detail: e.message || "操作失败", engineId });
      setOperationError(e.message || "操作失败");
    } finally {
      removeOperating(containerName);
    }
  };

  const filtered = useMemo(() => {
    return stacks.filter((s) => {
      const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [stacks, search, statusFilter]);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set());
    else setSelected(new Set(filtered.map((s) => s.id)));
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedStacks);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedStacks(next);
  };

  // 菜单标签中英对照
  const L = (en: string, zh: string) => (menuLanguage === "zh" ? zh : en);

  const getStackMenuItems = (stack: Stack): MenuItem[] => {
    const items: MenuItem[] = [];
    const isRunning = stack.status === "running" || stack.status === "partial";
    const isOperating = operatingStacks.has(stack.name);

    // 按用户截图 10 项菜单排列
    items.push({ label: L("Compose Up", "启动"), icon: <Play size={14} />, onClick: () => handleStackAction(stack.name, "up"), disabled: isOperating });
    items.push({ label: L("Stop", "停止"), icon: <Square size={14} />, onClick: () => handleStackAction(stack.name, "down"), disabled: isOperating || !isRunning });
    items.push({ label: L("Restart", "重启"), icon: <RotateCw size={14} />, onClick: () => handleStackAction(stack.name, "restart"), disabled: isOperating || !isRunning });
    items.push({ label: L("Down", "关闭"), icon: <Square size={14} />, onClick: () => handleStackAction(stack.name, "down"), disabled: isOperating });

    items.push({ separator: true });
    items.push({ label: L("Pull", "拉取"), icon: <Download size={14} />, onClick: () => handleStackAction(stack.name, "pull"), disabled: isOperating });
    items.push({ label: L("Check Updates", "检查更新"), icon: <RefreshCw size={14} />, onClick: () => handleStackAction(stack.name, "pull"), disabled: isOperating });
    items.push({ label: L("Force Update", "强制更新"), icon: <RefreshCw size={14} />, onClick: () => handleStackSteps(stack.name, "强制更新", ["pull", "up"]), disabled: isOperating });

    items.push({ separator: true });
    items.push({ label: L("Edit Stack", "编辑堆栈"), icon: <Edit3 size={14} />, onClick: () => { setContextMenu(null); setEditStack(stack); } });
    items.push({ label: L("View Logs", "查看日志"), icon: <FileText size={14} />, onClick: () => { setContextMenu(null); setLogStack(stack); } });
    items.push({ label: L("Delete Stack", "删除堆栈"), icon: <Trash2 size={14} />, danger: true, onClick: () => { setContextMenu(null); setConfirmDelete({ id: stack.id, name: stack.name }); } });

    // 保留额外功能（不显示在主菜单序列中，但通过分隔符隔开）
    if (stack.hasBuild) {
      items.push({ separator: true });
      items.push({ label: L("Build", "构建"), icon: <Hammer size={14} />, onClick: () => handleStackAction(stack.name, "build"), disabled: isOperating });
      items.push({ label: L("Build & Up", "构建并启动"), icon: <Play size={14} />, onClick: () => handleStackSteps(stack.name, "构建并启动", ["build", "up"]), disabled: isOperating });
    }

    items.push({ separator: true });
    items.push({ label: L("Terminal", "终端"), icon: <Terminal size={14} />, onClick: () => { setContextMenu(null); setTerminalStack(stack); } });
    items.push({ label: L("Backup", "备份"), icon: <Package size={14} />, onClick: () => { setContextMenu(null); handleBackup(stack.name); }, disabled: isOperating });
    items.push({ label: L("Duplicate", "复制"), icon: <Copy size={14} />, onClick: () => { setContextMenu(null); setTimeout(() => { setCreateMode(true); }, 100); } });

    if (stack.webuiLabels.length > 0) {
      const webuiLabel = stack.webuiLabels[0];
      const webuiUrl = webuiLabel.webuiUrl || (webuiLabel.webuiPort ? `http://localhost:${webuiLabel.webuiPort}` : "");
      items.push({ separator: true });
      items.push({ label: L("Open WebUI", "打开 WebUI"), icon: <Globe size={14} />, onClick: () => webuiUrl && window.open(webuiUrl, "_blank") });
    }

    items.push({ separator: true });
    items.push({ label: stack.settings.visible ? L("Hide in Containers", "在容器列表中隐藏") : L("Show in Containers", "在容器列表中显示"), icon: stack.settings.visible ? <EyeOff size={14} /> : <Eye size={14} />, onClick: async () => { if (!engineId) return; try { await saveStackSettingsApi(engineId, stack.name, { ...stack.settings, visible: !stack.settings.visible }); onRefresh?.(); } catch(e: any) { setOperationError(e.message); } } });

    return items;
  };

  const getContainerMenuItems = (stack: Stack, container: StackContainer): MenuItem[] => {
    const items: MenuItem[] = [];
    const isRunning = container.status === "running";
    const isOperating = operatingStacks.has(container.name);

    if (isRunning) {
      items.push({ label: L("Stop", "停止"), icon: <Square size={14} />, onClick: () => handleContainerAction(container.name, "stop"), disabled: isOperating });
      items.push({ label: L("Pause", "暂停"), icon: <Lock size={14} />, onClick: () => handleContainerAction(container.name, "pause"), disabled: isOperating });
      items.push({ label: L("Restart", "重启"), icon: <RotateCw size={14} />, onClick: () => handleContainerAction(container.name, "restart"), disabled: isOperating });
    } else {
      items.push({ label: L("Start", "启动"), icon: <Play size={14} />, onClick: () => handleContainerAction(container.name, "start"), disabled: isOperating });
    }

    items.push({ separator: true });
    items.push({ label: L("Logs", "日志"), icon: <FileCode size={14} />, onClick: () => {} });
    items.push({ label: L("Console", "控制台"), icon: <Terminal size={14} />, onClick: () => {} });
    items.push({ label: L("Inspect", "详情"), icon: <Search size={14} />, onClick: () => {} });

    if (container.hasUpdate) {
      items.push({ separator: true });
      items.push({ label: L("Update", "更新"), icon: <RefreshCw size={14} />, onClick: () => handleStackSteps(stack.name, "更新堆栈镜像", ["pull", "up"]) });
    }

    return items;
  };

  if (loading && stacks.length === 0) return <LoadingState message="正在加载堆栈列表..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6">
      {/* Error banner */}
      {operationError && (
        <div className="flex items-center justify-between px-4 py-2.5 mb-3 bg-amber-50 border border-amber-100 rounded-lg">
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-500 flex-shrink-0" />
            <span className="text-sm text-amber-700">{operationError}</span>
          </div>
          <button onClick={() => setOperationError(null)} className="text-amber-400 hover:text-amber-600"><X size={14} /></button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索堆栈..."
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
            <option value="partial">部分运行</option>
          </select>

          {/* View Toggle */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode("basic")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === "basic" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}
            >
              基本视图
            </button>
            <button
              onClick={() => setViewMode("advanced")}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${viewMode === "advanced" ? "bg-white text-slate-700 shadow-sm" : "text-slate-500"}`}
            >
              高级视图
            </button>
          </div>

          <span className="text-sm text-slate-400">{filtered.length} 个堆栈</span>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={() => setCreateMode(true)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors">
            <Plus size={14} /> 新建堆栈
          </button>
        </div>
      </div>

      {/* Batch Actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-3 px-4 py-2.5 bg-blue-50 border border-blue-100 rounded-lg animate-slide-down">
          <span className="text-sm text-blue-700 font-medium">已选中 {selected.size} 个堆栈</span>
          <div className="h-4 w-px bg-blue-200" />
          <button onClick={() => handleBatchAction("up")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50" disabled={!!batchOperating}><Play size={14} /> 批量启动</button>
          <button onClick={() => handleBatchAction("down")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50" disabled={!!batchOperating}><Square size={14} /> 批量停止</button>
          <button onClick={() => handleBatchAction("restart")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50" disabled={!!batchOperating}><RotateCw size={14} /> 批量重启</button>
          <button onClick={() => handleBatchAction("pull")} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50" disabled={!!batchOperating}><RefreshCw size={14} /> 批量更新</button>
          <button onClick={() => handleBatchAction("delete")} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-50" disabled={!!batchOperating}>{batchOperating === "delete" ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} 批量删除</button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-slate-400 hover:text-slate-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Operating progress bar */}
      {operatingStacks.size > 0 && (
        <div className="mb-3">
          <ProgressBar indeterminate color="blue" />
          <p className="text-xs text-blue-500 mt-1">正在执行操作...</p>
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
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">堆栈名称</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">状态</th>
              <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">容器</th>
              <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">运行时长</th>
              <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">更新</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((stack) => (
              <React.Fragment key={stack.id}>
                <tr
                  className={`hover:bg-slate-50 transition-colors cursor-context-menu ${selected.has(stack.id) ? "bg-blue-50/50" : ""}`}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, stack }); }}
                  onClick={() => toggleExpand(stack.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(stack.id); }}>
                    <button className="text-slate-400 hover:text-blue-500">
                      {selected.has(stack.id) ? <CheckSquare size={16} className="text-blue-500" /> : <SquareIcon size={16} />}
                    </button>
                  </td>
                  <td className="px-2">
                    <button className="text-slate-400 hover:text-slate-600">
                      {expandedStacks.has(stack.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                        {stack.icon ? <img src={stack.icon} alt="" className="w-7 h-7 rounded" /> : <Layers size={16} className="text-slate-400" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-medium text-slate-700">{stack.name}</span>
                          {stack.locked && <Lock size={12} className="text-amber-500" />}
                          {stack.isIndirect && <Tag text="间接" color="amber" />}
                          {stack.isGitSource && <GitBranch size={12} className="text-slate-400" />}
                          {stack.hasBuild && <Tag text="Build" color="purple" />}
                          {stack.settings.autoUpdateEnabled && <Bell size={12} className="text-blue-400" />}
                          {!stack.settings.visible && <EyeOff size={12} className="text-slate-400" />}
                        </div>
                        <span className="text-xs text-slate-400 truncate block">{stack.description}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><StatusBadge status={stack.status} /></td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-sm font-bold text-slate-700">{stack.runningContainers}<span className="text-slate-400 font-normal">/{stack.totalContainers}</span></span>
                  </td>
                  <td className="px-3 py-3"><span className="text-sm text-slate-500">{stack.uptime}</span></td>
                  <td className="px-3 py-3 text-center">
                    {stack.hasUpdate ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded-full border border-amber-100">
                        <RefreshCw size={10} /> 有更新
                      </span>
                    ) : (
                      <CheckCircle2 size={14} className="text-green-400 inline-block" />
                    )}
                  </td>
                  {/* 操作列已移除：所有操作统一走右键菜单 */}
                </tr>
                {/* Expanded Container Sub-table */}
                {expandedStacks.has(stack.id) && (
                  <tr className="bg-slate-50/50">
                    <td colSpan={7} className="px-8 py-0">
                      <div className="animate-slide-down">
                        {/* Profiles */}
                        {stack.profiles.length > 0 && (
                          <div className="flex items-center gap-2 py-2 border-b border-slate-100">
                            <TagIcon size={12} className="text-slate-400" />
                            <span className="text-xs text-slate-500">Profiles:</span>
                            {stack.profiles.map((p) => (
                              <Tag key={p} text={p} color={p === stack.settings.defaultProfiles[0] ? "blue" : "slate"} />
                            ))}
                            <span className="text-xs text-slate-400 ml-2">默认: {stack.settings.defaultProfiles.join(", ") || "无"}</span>
                          </div>
                        )}

                        {/* Compose File Path */}
                        <div className="flex items-center gap-2 py-2 border-b border-slate-100">
                          <FolderTree size={12} className="text-slate-400" />
                          <span className="text-xs text-slate-500 font-mono">{stack.composeFilePath}</span>
                          {stack.settings.externalComposePath && (
                            <Tag text="外部路径" color="amber" />
                          )}
                        </div>

                        {/* Container Table */}
                        <table className="w-full">
                          <thead>
                            <tr className="bg-slate-50/50">
                              <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">容器名称</th>
                              {viewMode === "advanced" && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">镜像</th>}
                              <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">状态</th>
                              <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">网络</th>
                              {viewMode === "advanced" && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">容器 IP</th>}
                              <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">端口</th>
                              {viewMode === "advanced" && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">更新</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {stack.containers.map((container) => (
                              <tr
                                key={container.name}
                                className="hover:bg-white transition-colors cursor-context-menu border-b border-slate-50 last:border-0"
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, stack, container }); }}
                              >
                                <td className="px-3 py-2.5">
                                  <span className="text-sm font-medium text-slate-700">{container.name}</span>
                                  {container.isPinned && <Tag text="已固定" color="green" />}
                                </td>
                                {viewMode === "advanced" && (
                                  <td className="px-3 py-2.5">
                                    <span className="text-xs font-mono text-slate-600">{container.image}</span>
                                    <span className="text-xs font-mono text-slate-400">:{container.tag}</span>
                                  </td>
                                )}
                                <td className="px-3 py-2.5"><StatusBadge status={container.status} /></td>
                                <td className="px-3 py-2.5"><span className="text-xs text-slate-500">{container.network}</span></td>
                                {viewMode === "advanced" && <td className="px-3 py-2.5"><span className="text-xs font-mono text-slate-500">{container.ip}</span></td>}
                                <td className="px-3 py-2.5"><span className="text-xs font-mono text-slate-500">{container.ports}</span></td>
                                {viewMode === "advanced" && (
                                  <td className="px-3 py-2.5">
                                    {container.hasUpdate ? (
                                      <span className="flex items-center gap-1 text-xs text-amber-600"><RefreshCw size={10} /> 可更新</span>
                                    ) : (
                                      <CheckCircle2 size={14} className="text-green-400" />
                                    )}
                                    {container.hasUpdate && (
                                      <button className="text-xs text-blue-600 hover:underline ml-2">强制更新</button>
                                    )}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <EmptyState icon={<Filter size={28} />} title="未找到匹配的堆栈" description="尝试调整搜索条件或创建新堆栈" />
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.container ? getContainerMenuItems(contextMenu.stack, contextMenu.container) : getStackMenuItems(contextMenu.stack)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Stack Editor Modal */}
      {editStack && <StackEditorModal stack={editStack} onClose={() => setEditStack(null)} engineId={engineId} onRefresh={onRefresh} />}

      {/* Create Stack Modal */}
      {createMode && <CreateStackModal onClose={() => setCreateMode(false)} engineId={engineId} onRefresh={onRefresh} />}

      {/* Terminal Modal */}
      {terminalStack && <TerminalModal stack={terminalStack} onClose={() => setTerminalStack(null)} engineId={engineId} onRefresh={onRefresh} />}

      {/* Stack Log Modal */}
      {logStack && <StackLogModal stack={logStack} onClose={() => setLogStack(null)} engineId={engineId} />}

      {/* Command Output Modal（启动/停止/重启/拉取/构建/删除/备份/批量 的 tail 文本输出，统一复用） */}
      <CmdOutputModal data={cmdOutput} onClose={closeOutput} />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => { setConfirmDelete(null); setDeleteError(null); }}
        onConfirm={() => confirmDelete && handleDeleteStack(confirmDelete.name, false)}
        title="删除堆栈"
        message={`确定要删除堆栈 "${confirmDelete?.name}" 吗？可选择是否同时删除关联的 volume、network 和镜像。此操作不可撤销。`}
        confirmText={deleting ? "删除中..." : "删除"}
        danger
        loading={deleting}
        errorMessage={deleteError}
      />
    </div>
  );
}

// ============ Stack Editor Modal (4 tabs) ============

function StackEditorModal({ stack, onClose, engineId, onRefresh }: { stack: Stack; onClose: () => void; engineId?: string; onRefresh?: () => void }) {
  const [activeTab, setActiveTab] = useState<"compose" | "env" | "webui" | "settings">("compose");
  const [composeContent, setComposeContent] = useState(stack.composeContent);
  const [envContent, setEnvContent] = useState(stack.envContent || "");
  const [webuiLabels, setWebuiLabels] = useState(stack.webuiLabels);
  const [settings, setSettings] = useState(stack.settings);
  const [yamlValid, setYamlValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [iconUploading, setIconUploading] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);

  const tabs = [
    { key: "compose", label: "COMPOSE", icon: <FileCode size={14} /> },
    { key: "env", label: ".ENV", icon: <Wrench size={14} /> },
    { key: "webui", label: "LABELS", icon: <Globe size={14} /> },
    { key: "settings", label: "SETTINGS", icon: <SettingsIcon size={14} /> },
  ];

  // 切换到 Web UI Labels Tab 时，自动识别 compose 中的服务并补全缺失条目
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "webui") return;
    const services = parseComposeServices(composeContent);
    if (services.length === 0) return;

    setWebuiLabels((prev) => {
      // 已自动检测过且用户没有新增/删除服务，跳过
      const existingNames = new Set(prev.map((l) => l.serviceName).filter(Boolean));
      const missing = services.filter((s) => !existingNames.has(s));
      if (missing.length === 0) return prev; // 无需补全

      // 只追加缺失的服务，保留已有配置
      return [
        ...prev,
        ...missing.map((name) => ({
          serviceName: name,
          iconUrl: "",
          webuiPort: "",
          webuiUrl: "",
          defaultShell: "/bin/sh",
        })),
      ];
    });
    autoDetectedRef.current = true;
  }, [activeTab, composeContent]);

  const handleSave = async () => {
    if (!engineId || saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      if (activeTab === "compose") {
        await saveStackComposeApi(engineId, stack.name, composeContent);
      } else if (activeTab === "env") {
        await saveStackEnvApi(engineId, stack.name, envContent);
      } else if (activeTab === "webui") {
        await saveStackSettingsApi(engineId, stack.name, { webuiLabels });
      } else if (activeTab === "settings") {
        await saveStackSettingsApi(engineId, stack.name, settings);
        // 名称变更后目录已被重命名，关闭弹窗避免后续操作使用旧名称
        if (settings.name && settings.name !== stack.name) {
          setSaveSuccess(true);
          onRefresh?.();
          setTimeout(() => onClose(), 800);
          return;
        }
      }
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      onRefresh?.();
    } catch (e: any) {
      setSaveError(e.message || "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleIconUpload = async (file: File) => {
    if (!engineId || iconUploading) return;
    setIconUploading(true);
    try {
      const iconUrl = await uploadStackIconApi(engineId, stack.name, file);
      setSettings({ ...settings, iconUrl });
      onRefresh?.();
    } catch (e: any) {
      setSaveError(e.message || "图标上传失败");
    } finally {
      setIconUploading(false);
    }
  };

  // 生成 .ENV 模板：从 compose 中识别服务名，输出通用变量骨架
  const handleCreateEnvTemplate = () => {
    const services = parseComposeServices(composeContent);
    const lines = [
      "# 环境变量模板（由系统自动生成）",
      "# 每行格式 KEY=VALUE，支持 # 注释",
      "",
      `COMPOSE_PROJECT_NAME=${stack.name}`,
      "TZ=Asia/Shanghai",
      "PUID=99",
      "PGID=100",
    ];
    if (services.length > 0) {
      lines.push("", "# 各服务端口变量");
      for (const s of services) {
        lines.push(`# ${s.toUpperCase().replace(/[-.]/g, "_")}_PORT=`);
      }
    }
    setEnvContent(lines.join("\n"));
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex flex-col" onClick={onClose}>
      <div className="modal-content bg-white rounded-t-xl shadow-2xl w-full max-w-[90vw] h-[90vh] mx-auto mt-auto flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden">
              {stack.icon ? <img src={stack.icon} alt="" className="w-8 h-8 rounded" /> : <Layers size={16} className="text-slate-400" />}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-800">编辑堆栈: {stack.name}</h2>
              <p className="text-xs text-slate-400">{stack.composeFilePath}</p>
            </div>
          </div>
          {(saveError || saveSuccess) && (
            <div className="flex items-center gap-2">
              {saveError && (
                <span className="flex items-center gap-1 text-xs text-red-500"><AlertCircle size={12} /> {saveError}</span>
              )}
              {saveSuccess && (
                <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 size={12} /> 已保存</span>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold tracking-wider border-b-2 transition-colors ${
                activeTab === tab.key ? "border-blue-500 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "compose" && (
            <div className="flex flex-col h-full p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-slate-400">支持的文件名:</span>
                {["compose.yaml", "docker-compose.yaml", "compose.yml", "docker-compose.yml"].map((f) => {
                  const baseName = stack.composeFilePath.split(/[\\/]/).pop() || "";
                  return <Tag key={f} text={f} color={baseName === f ? "blue" : "slate"} />;
                })}
              </div>
              <div className="flex-1 flex flex-col border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:border-blue-400 transition-colors" style={{ minHeight: "380px" }}>
                <textarea
                  value={composeContent}
                  onChange={(e) => {
                    setComposeContent(e.target.value);
                    // Simple YAML validation
                    try {
                      setYamlValid(e.target.value.trim().length > 0);
                    } catch {
                      setYamlValid(false);
                    }
                  }}
                  className="flex-1 w-full px-4 py-3 font-mono text-sm text-slate-700 bg-white border-0 focus:outline-none resize-none"
                  spellCheck={false}
                />
                <div className={`flex items-center gap-2 px-4 py-1.5 border-t ${yamlValid ? "border-slate-100 bg-green-50" : "border-red-100 bg-red-50"}`}>
                  {yamlValid ? (
                    <CheckCircle2 size={13} className="text-green-500" />
                  ) : (
                    <AlertCircle size={13} className="text-red-500" />
                  )}
                  <span className={`text-xs font-medium ${yamlValid ? "text-green-600" : "text-red-600"}`}>
                    {yamlValid ? "YAML 语法有效" : "YAML 语法无效"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {activeTab === "env" && (
            <div className="p-6">
              {envContent.trim() === "" ? (
                <div className="border border-dashed border-slate-300 rounded-lg py-16 text-center bg-slate-50/50">
                  <Wrench size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 mb-1">尚未创建 .env 文件</p>
                  <p className="text-xs text-slate-400 mb-5">环境变量以 KEY=VALUE 格式逐行定义，可被 Compose 中的 {"${VAR}"} 引用</p>
                  <button
                    onClick={handleCreateEnvTemplate}
                    className="px-4 py-2 text-xs font-semibold tracking-wider text-white bg-blue-500 rounded-lg hover:bg-blue-600"
                  >
                    CREATE .ENV TEMPLATE
                  </button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-slate-700">环境变量编辑</h3>
                    <button
                      onClick={handleCreateEnvTemplate}
                      className="text-xs text-blue-500 hover:text-blue-600 hover:underline"
                    >
                      重新生成模板（覆盖当前内容）
                    </button>
                  </div>
                  <div className="border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:border-blue-400 transition-colors">
                    <textarea
                      value={envContent}
                      onChange={(e) => setEnvContent(e.target.value)}
                      className="w-full h-80 px-4 py-3 text-sm font-mono text-slate-700 bg-white border-0 resize-none focus:outline-none"
                    />
                  </div>
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs text-blue-600">
                      提示: 在 Compose 文件中使用 <code className="font-mono bg-blue-100 px-1 rounded">{"${VAR_NAME}"}</code> 引用环境变量
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === "webui" && (
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">Web UI Labels 配置</h3>
                  <p className="text-xs text-slate-400 mt-0.5">自动识别 Compose 中的服务，为每个服务配置 WebUI 访问地址和图标</p>
                </div>
                <button
                  onClick={() => setWebuiLabels([...webuiLabels, { serviceName: "", iconUrl: "", webuiPort: "", webuiUrl: "", defaultShell: "/bin/sh" }])}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
                >
                  <Plus size={14} /> 添加服务
                </button>
              </div>
              {/* 服务自动识别状态条：实时从 Compose 内容解析 */}
              {(() => {
                const detected = parseComposeServices(composeContent);
                if (detected.length === 0) {
                  return (
                    <div className="flex items-center gap-2 px-3 py-2 mb-4 bg-amber-50 border border-amber-100 rounded-lg">
                      <AlertCircle size={14} className="text-amber-500 flex-shrink-0" />
                      <span className="text-xs text-amber-600">未在 Compose 中识别到服务，请检查 services: 段或手动添加</span>
                    </div>
                  );
                }
                const configured = new Set(webuiLabels.map((l) => l.serviceName).filter(Boolean));
                const missing = detected.filter((s) => !configured.has(s));
                return (
                  <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-4 bg-blue-50 border border-blue-100 rounded-lg">
                    <CheckCircle2 size={14} className="text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-blue-600">
                      已识别 {detected.length} 个服务：{detected.map((s) => (
                        <span key={s} className={`inline-block px-1.5 py-0.5 mx-0.5 rounded font-mono text-[11px] ${configured.has(s) ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{s}</span>
                      ))}
                      {missing.length > 0 && <span className="text-slate-400">（{missing.length} 个未配置，将自动补全）</span>}
                    </span>
                  </div>
                );
              })()}
              <div className="space-y-4">
                {webuiLabels.map((label, i) => (
                  <div key={i} className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-slate-500">
                        {label.serviceName || `服务 #${i + 1}`}
                      </span>
                      <button
                        onClick={() => setWebuiLabels(webuiLabels.filter((_, idx) => idx !== i))}
                        className="p-1 text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="服务名称">
                        <Input value={label.serviceName} onChange={(val) => {
                          const next = [...webuiLabels];
                          next[i] = { ...label, serviceName: val };
                          setWebuiLabels(next);
                        }} placeholder="如: jellyfin" />
                      </FormField>
                      <FormField label="图标 URL">
                        <Input value={label.iconUrl} onChange={(val) => {
                          const next = [...webuiLabels];
                          next[i] = { ...label, iconUrl: val };
                          setWebuiLabels(next);
                        }} placeholder="https://..." />
                      </FormField>
                      <FormField label="WebUI 端口">
                        <Input value={label.webuiPort} onChange={(val) => {
                          const next = [...webuiLabels];
                          next[i] = { ...label, webuiPort: val };
                          setWebuiLabels(next);
                        }} placeholder="如: 8096" />
                      </FormField>
                      <FormField label="WebUI URL">
                        <Input value={label.webuiUrl} onChange={(val) => {
                          const next = [...webuiLabels];
                          next[i] = { ...label, webuiUrl: val };
                          setWebuiLabels(next);
                        }} placeholder="http://localhost:8096" />
                      </FormField>
                      <FormField label="默认 Shell">
                        <Select
                          value={label.defaultShell}
                          onChange={(val) => {
                            const next = [...webuiLabels];
                            next[i] = { ...label, defaultShell: val };
                            setWebuiLabels(next);
                          }}
                          options={[
                            { value: "/bin/sh", label: "/bin/sh" },
                            { value: "/bin/bash", label: "/bin/bash" },
                            { value: "/bin/ash", label: "/bin/ash (Alpine)" },
                            { value: "/bin/zsh", label: "/bin/zsh" },
                          ]}
                        />
                      </FormField>
                    </div>
                  </div>
                ))}
                {webuiLabels.length === 0 && (
                  <p className="text-sm text-slate-400 text-center py-8">暂无 WebUI Labels 配置</p>
                )}
              </div>
            </div>
          )}

          {activeTab === "settings" && (
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField label="堆栈名称" required>
                  <Input value={settings.name} onChange={(val) => setSettings({ ...settings, name: val })} />
                </FormField>
                <FormField label="图标">
                  <div className="flex gap-2">
                    <Input value={settings.iconUrl} onChange={(val) => setSettings({ ...settings, iconUrl: val })} placeholder="https://... 或上传本地图片" />
                    <input
                      ref={iconInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/x-icon"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleIconUpload(file);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => iconInputRef.current?.click()}
                      disabled={iconUploading}
                      className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                    >
                      {iconUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                      上传
                    </button>
                  </div>
                </FormField>
              </div>

              <FormField label="描述">
                <Input value={settings.description} onChange={(val) => setSettings({ ...settings, description: val })} />
              </FormField>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100 space-y-3">
                <h4 className="text-sm font-semibold text-slate-700">自动更新</h4>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用自动更新检查</span>
                  <Toggle active={settings.autoUpdateEnabled} onChange={(val) => setSettings({ ...settings, autoUpdateEnabled: val })} />
                </div>
                {settings.autoUpdateEnabled && (
                  <FormField label="更新方式">
                    <Select
                      value={settings.autoUpdateMode}
                      onChange={(val) => setSettings({ ...settings, autoUpdateMode: val as any })}
                      options={[
                        { value: "notify", label: "仅通知" },
                        { value: "auto", label: "自动拉取并更新" },
                      ]}
                    />
                  </FormField>
                )}
              </div>

              <div className="bg-slate-50 rounded-lg p-4 border border-slate-100">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-semibold text-slate-700">在容器列表中显示</span>
                    <p className="text-xs text-slate-400 mt-0.5">关闭后，此堆栈的容器不会出现在容器管理页面</p>
                  </div>
                  <Toggle active={settings.visible} onChange={(val) => setSettings({ ...settings, visible: val })} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer status bar (Unraid style) */}
        <div className="flex items-center justify-between px-6 py-2.5 border-t border-slate-200 bg-slate-50">
          <div className="flex items-center gap-5 text-xs min-w-0">
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-slate-400">PROJECT DIR</span>
              <span className="font-mono text-slate-600 truncate" title={stack.composeFilePath}>{stack.composeFilePath.split(/[\\/]/).slice(0, -1).join("/") || "/"}</span>
            </span>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="text-slate-400">EDITING FILE</span>
              <span className="font-mono text-slate-600 truncate">
                {activeTab === "compose"
                  ? (stack.composeFilePath.split(/[\\/]/).pop() || "compose.yaml")
                  : activeTab === "env" ? ".env"
                  : activeTab === "webui" ? "labels"
                  : "settings"}
              </span>
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {saving && <Loader2 size={14} className="animate-spin text-blue-500" />}
            <button
              onClick={async () => { await handleSave(); onClose(); }}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-semibold tracking-wider text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
            >
              确定
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-semibold tracking-wider text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50"
            >
              应用
            </button>
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-xs font-semibold tracking-wider text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ============ Create Stack Modal ============

function CreateStackModal({ onClose, engineId, onRefresh }: { onClose: () => void; engineId?: string; onRefresh?: () => void }) {
  const [method, setMethod] = useState("editor");
  const [stackName, setStackName] = useState("");
  const [stackDescription, setStackDescription] = useState("");
  const [composeContent, setComposeContent] = useState(`services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    restart: unless-stopped
`);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [yamlValid, setYamlValid] = useState(true);

  const methods = [
    { key: "editor", label: "Web 编辑器", icon: <Edit3 size={20} />, desc: "从零编写 compose 文件" },
    { key: "upload", label: "上传文件", icon: <Upload size={20} />, desc: "上传本地 compose + env 文件" },
  ];

  const handleCreate = async () => {
    if (!stackName.trim()) { setCreateError("请输入堆栈名称"); return; }
    if (!composeContent.trim()) { setCreateError("compose 文件内容不能为空"); return; }
    if (!engineId) { setCreateError("未选择 Docker 引擎"); return; }
    setCreating(true);
    setCreateError(null);
    try {
      await createStackApi(engineId, stackName.trim(), stackDescription.trim(), composeContent);
      onRefresh?.();
      onClose();
    } catch (e: any) {
      setCreateError(e.message || "创建失败");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title="创建新堆栈" size="lg" dismissable={false}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              disabled={creating}
              className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all ${
                method === m.key ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
              } ${creating ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${method === m.key ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                {m.icon}
              </div>
              <div>
                <p className="text-sm font-medium text-slate-700">{m.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {method === "editor" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="堆栈名称" required>
                <Input value={stackName} onChange={setStackName} placeholder="如: my-new-stack" disabled={creating} />
              </FormField>
              <FormField label="描述">
                <Input value={stackDescription} onChange={setStackDescription} placeholder="简要描述堆栈用途" disabled={creating} />
              </FormField>
            </div>
            <FormField label="Compose 文件内容" required>
              <textarea
                value={composeContent}
                onChange={(e) => {
                  setComposeContent(e.target.value);
                  setYamlValid(e.target.value.trim().length > 0);
                }}
                disabled={creating}
                className="w-full h-64 p-4 font-mono text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                spellCheck={false}
                placeholder="services:&#10;  web:&#10;    image: nginx:alpine&#10;    ports:&#10;      - '8080:80'"
              />
            </FormField>
            <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${yamlValid ? "bg-green-50" : "bg-red-50"}`}>
              {yamlValid ? (
                <CheckCircle2 size={14} className="text-green-500" />
              ) : (
                <AlertCircle size={14} className="text-red-500" />
              )}
              <span className={`text-xs font-medium ${yamlValid ? "text-green-600" : "text-red-600"}`}>
                {yamlValid ? "Compose 内容有效" : "Compose 内容不能为空"}
              </span>
            </div>
          </div>
        )}

        {method === "upload" && (
          <div className="space-y-3">
            <FormField label="堆栈名称" required>
              <Input value={stackName} onChange={setStackName} placeholder="如: my-new-stack" disabled={creating} />
            </FormField>
            <FormField label="描述">
              <Input value={stackDescription} onChange={setStackDescription} placeholder="简要描述堆栈用途" disabled={creating} />
            </FormField>
            <div className="border-2 border-dashed border-slate-200 rounded-lg p-8 text-center hover:border-blue-400 transition-colors cursor-pointer">
              <Upload size={32} className="mx-auto text-slate-400 mb-2" />
              <p className="text-sm text-slate-600">点击或拖拽上传 compose 文件</p>
              <p className="text-xs text-slate-400 mt-1">支持 .yml, .yaml 格式</p>
            </div>
          </div>
        )}

        {createError && (
          <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-100 rounded-lg">
            <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
            <span className="text-sm text-red-600">{createError}</span>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
        <button onClick={onClose} disabled={creating} className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50">取消</button>
        <button
          onClick={handleCreate}
          disabled={creating || !stackName.trim() || !composeContent.trim()}
          className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
        >
          {creating ? (
            <>
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              创建中...
            </>
          ) : (
            "创建"
          )}
        </button>
      </div>
    </Modal>
  );
}

// ============ Stack Log Modal ============

function StackLogModal({ stack, onClose, engineId }: { stack: Stack; onClose: () => void; engineId?: string }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [tail, setTail] = useState(200);

  const runningContainers = stack.containers.filter((c) => c.status === "running");

  useEffect(() => {
    if (!engineId || runningContainers.length === 0) { setLoading(false); return; }
    const target = selectedContainer || runningContainers[0].name;
    if (!selectedContainer) setSelectedContainer(target);
    setLoading(true);
    fetchContainerLogs(engineId, target, tail)
      .then((lines) => setLogs(lines))
      .catch(() => setLogs(["获取日志失败"]))
      .finally(() => setLoading(false));
  }, [engineId, selectedContainer, tail, stack.name]);

  return (
    <Modal open onClose={onClose} title={`堆栈日志 - ${stack.name}`} size="xl" dismissable>
      <div className="flex items-center gap-3 mb-3">
        <label className="text-xs text-slate-500">容器</label>
        <select
          value={selectedContainer}
          onChange={(e) => setSelectedContainer(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white"
        >
          {runningContainers.map((c) => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <label className="text-xs text-slate-500">行数</label>
        <select
          value={tail}
          onChange={(e) => setTail(Number(e.target.value))}
          className="text-sm border border-slate-200 rounded-lg px-2 py-1 bg-white"
        >
          <option value={100}>100</option>
          <option value={200}>200</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
        </select>
      </div>
      <div className="bg-slate-900 rounded-lg p-4 h-[500px] overflow-auto">
        {loading ? (
          <div className="text-slate-400 text-sm">加载中...</div>
        ) : logs.length === 0 ? (
          <div className="text-slate-400 text-sm">暂无日志</div>
        ) : (
          <pre className="text-xs text-slate-200 font-mono whitespace-pre-wrap break-all">{logs.join("\n")}</pre>
        )}
      </div>
    </Modal>
  );
}

// ============ Terminal Modal ============

function TerminalModal({ stack, onClose, engineId, onRefresh }: { stack: Stack; onClose: () => void; engineId?: string; onRefresh?: () => void }) {
  const [output, setOutput] = useState<string[]>(["root@compose:~# 等待命令..."]);
  const [running, setRunning] = useState(false);

  const composeCommands = [
    { label: "docker compose ps", action: "status" },
    { label: "docker compose up -d", action: "up" },
    { label: "docker compose down", action: "down" },
    { label: "docker compose pull", action: "pull" },
    { label: "docker compose restart", action: "restart" },
    { label: "docker compose logs", action: "logs" },
  ];

  const runCommand = async (cmd: string, action: string | null) => {
    if (running || !engineId) return;
    setRunning(true);
    setOutput((prev) => [...prev, "$ " + cmd]);
    try {
      if (action && action !== "status" && action !== "logs") {
        const result = await stackActionApi(engineId, stack.name, action as any);
        setOutput((prev) => [...prev, result || "执行成功"]);
      } else {
        setOutput((prev) => [...prev, "命令已发送（日志/状态输出请在对应页面查看）"]);
      }
      onRefresh?.();
    } catch (e: any) {
      setOutput((prev) => [...prev, "错误: " + (e.message || "执行失败")]);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal open={true} onClose={onClose} title={`Compose 终端 - ${stack.name}`} size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {composeCommands.map((cmd) => (
            <button
              key={cmd.label}
              onClick={() => runCommand(cmd.label, cmd.action)}
              disabled={running}
              className="px-3 py-1.5 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 disabled:opacity-50 font-mono"
            >
              {cmd.label}
            </button>
          ))}
        </div>
        <div className="bg-slate-900 rounded-lg p-4 h-[50vh] overflow-y-auto font-mono text-xs">
          <div className="space-y-0.5">
            {output.map((line, i) => (
              <div key={i} className={line.startsWith("错误") ? "text-red-400" : line.startsWith("$") ? "text-yellow-400" : "text-slate-300"}>
                {line}
              </div>
            ))}
            {running && (
              <div className="text-green-400">
                <span className="animate-pulse">{">"}</span> 执行中...
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
        <Terminal size={12} />
        <span>一键执行常用 compose 命令</span>
      </div>
    </Modal>
  );
}
