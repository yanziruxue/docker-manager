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
  Info,
  Lock,
  RefreshCw,
  Package,
  Hammer,
  Layers,
  AlertCircle,
  CheckCircle2,
  Tag as TagIcon,
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
  Code,
  ArrowLeftRight,
  Columns,
} from "lucide-react";
import type { Stack, StackContainer, ResourceTag, ComposeTemplate } from "../types";
import { convert, type ConvertResult } from "../lib/compose-convert";
import {
  createStackApi,
  stackActionApi,
  streamStackActions,
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
import { Toggle, IconButton, EmptyState, FormField, Input, Select, SortableTh } from "../components/UI";
import { TagGroup, TagSelect } from "../components/TagPicker";
import { LoadingState, ErrorState } from "../components/DataState";
import { YamlEditor } from "../components/YamlEditor";
import { EnvEditor } from "../components/EnvEditor";
import { shortImageRef } from "../transforms";

/* ---------------- 堆栈图标：SVG 代码支持 ----------------
 * 图标字段（settings.iconUrl）本质是一个图片 URL 字符串，后端原样存进 meta.icon，
 * 因此把 SVG 源码编码成 data URI 存进去即可，后端无需任何改动，<img src> 也能直接渲染。
 * ------------------------------------------------------ */

/** 内嵌 SVG 图标的最大体积（100KB）。过大会撑大 meta 文件并拖慢列表接口 */
const MAX_SVG_BYTES = 100 * 1024;

/** 判断一段文本是否为 SVG 源码（而非 URL / 文件路径） */
function isSvgCode(text: string): boolean {
  const t = text.trim();
  return /^<\?xml[\s\S]*<svg[\s>]/i.test(t) || /^<svg[\s>]/i.test(t);
}

/**
 * 清洗 SVG 中的可执行内容。
 * 图标最终以 <img src="data:..."> 渲染，浏览器本就不会执行 SVG 内的脚本，
 * 但图标数据会存盘、可能被其它上下文复用，故仍剔除脚本、事件属性与 javascript: 协议。
 */
function sanitizeSvg(code: string): string {
  return code
    .replace(/<\s*(script|foreignObject)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|foreignObject)\b[^>]*\/\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(?:xlink:)?href\s*=\s*(["'])\s*javascript:[^"']*\1/gi, "");
}

/** SVG 源码 → data URI（base64 编码，避免 #、<、> 等字符破坏 URL） */
function svgToDataUri(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** data URI → SVG 源码（供「编辑代码」回填）；非 SVG data URI 返回 null */
function dataUriToSvg(uri: string): string | null {
  const t = uri.trim();
  const b64 = /^data:image\/svg\+xml;base64,(.+)$/is.exec(t);
  if (b64) {
    try {
      const bin = atob(b64[1].trim());
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    } catch {
      return null;
    }
  }
  const plain = /^data:image\/svg\+xml,(.+)$/is.exec(t);
  if (plain) {
    try {
      return decodeURIComponent(plain[1]);
    } catch {
      return null;
    }
  }
  return null;
}

/** 取值是否为内嵌 SVG 图标（用于决定表单显示成 URL 输入框还是「已内嵌」展示条） */
function isInlineSvgIcon(value?: string): boolean {
  return !!value && /^data:image\/svg\+xml[;,]/i.test(value.trim());
}

/** 内嵌 SVG 图标的源码体积，用于展示条上的「（1.2 KB）」 */
function svgSizeLabel(uri: string): string {
  const code = dataUriToSvg(uri);
  if (code === null) return "未知大小";
  const bytes = new TextEncoder().encode(code).length;
  return bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
}

/**
 * 收集 SVG 源码的校验结果：清洗后内容、体积、以及不能用的原因。
 * 校验顺序有意排成「先判空 → 再判是不是 SVG → 最后判体积」，
 * 这样用户看到的第一条错误永远是最该先解决的那个。
 */
function validateSvgCode(raw: string): { code: string; bytes: number; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { code: "", bytes: 0, error: null };
  if (!isSvgCode(trimmed)) return { code: "", bytes: 0, error: "内容不是 SVG（应以 <svg 或 <?xml 开头）" };
  const code = sanitizeSvg(trimmed);
  if (!/<svg[\s>]/i.test(code)) return { code: "", bytes: 0, error: "未找到 <svg> 标签" };
  const bytes = new TextEncoder().encode(code).length;
  if (bytes > MAX_SVG_BYTES) {
    return { code, bytes, error: `体积 ${(bytes / 1024).toFixed(1)} KB 超出上限 ${MAX_SVG_BYTES / 1024} KB` };
  }
  return { code, bytes, error: null };
}

/**
/**
 * 从 Compose YAML 内容中提取 services 下的服务信息。
 * - name：服务声明了 container_name 时优先返回 container_name（与实际 Docker 容器名一致，便于 WebUI Labels 与容器列表/图标联动）。
 * - hostPort：ports: 下第一行端口映射中的宿主机端口（英文冒号左侧，如 `8807:8080` → `8807`；兼容 `ip:hostPort:containerPort` 与 `hostPort:containerPort`）。
 */
interface ComposeServiceInfo {
  name: string;
  containerName?: string;
  hostPort?: string;
}

function parseComposeServices(composeContent: string): ComposeServiceInfo[] {
  if (!composeContent) return [];
  const lines = composeContent.split("\n");
  const services: ComposeServiceInfo[] = [];
  let inServices = false;
  let servicesIndent = -1;
  let currentName: string | null = null; // 当前服务的服务名
  let containerName: string | null = null; // 当前服务的 container_name
  let inPorts = false; // 是否进入当前服务的 ports: 子块
  let portsIndent = -1; // ports: 行的缩进
  let hostPort: string | null = null; // 当前服务识别到的宿主机端口

  // 从端口映射字符串中取宿主机端口：取「倒数第二段」（英文冒号左侧）
  // 8807:8080          → 8807
  // 127.0.0.1:8807:8080 → 8807
  // 8080（仅容器端口）   → null
  const extractHostPort = (mapping: string): string | null => {
    const parts = mapping.split(":");
    if (parts.length >= 2) {
      const cand = parts[parts.length - 2];
      if (cand && /^\d+$/.test(cand)) return cand;
    }
    return null;
  };

  const commit = () => {
    if (currentName) {
      services.push({
        name: containerName || currentName,
        containerName: containerName || undefined,
        hostPort: hostPort || undefined,
      });
    }
    currentName = null;
    containerName = null;
    inPorts = false;
    portsIndent = -1;
    hostPort = null;
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
        // 注意 trimmed 仍含行首缩进，正则须用 ^\s* 才能命中（修复：此前 ^ 锚点导致缩进服务名永远匹配失败）
        const match = trimmed.match(/^\s*([a-zA-Z0-9_.-]+)\s*:/);
        if (match) {
          commit();
          currentName = match[1];
        }
      } else if (currentName && leadingSpaces > servicesIndent) {
        // 离开 ports 子块（缩进回到 ports: 同级或更浅）
        if (inPorts && leadingSpaces <= portsIndent) {
          inPorts = false;
          portsIndent = -1;
        }
        // 服务属性行
        const m = trimmed.match(/^\s*container_name\s*:\s*["']?([a-zA-Z0-9_.-]+)/);
        if (m) {
          containerName = m[1];
        } else if (/^\s*ports\s*:/.test(trimmed)) {
          // 进入 ports: 子块（兼容 `ports:` 独占一行 与 `ports: - 8807:8080` 同行写法）
          inPorts = true;
          portsIndent = leadingSpaces;
          const inline = trimmed.replace(/^\s*ports\s*:\s*/, "").trim();
          if (inline.startsWith("-")) {
            const item = inline.match(/^-\s*["']?([^"']+)["']?/);
            if (item) {
              const hp = extractHostPort(item[1]);
              if (hp) hostPort = hp;
              inPorts = false; // 仅取第一行映射
            }
          }
        } else if (inPorts && leadingSpaces > portsIndent) {
          // ports 列表项：- 8807:8080 / - "127.0.0.1:8807:8080"
          const item = trimmed.match(/^\s*-\s*["']?([^"']+)["']?/);
          if (item) {
            const hp = extractHostPort(item[1]);
            if (hp) hostPort = hp;
            inPorts = false; // 仅取第一行映射
          }
        }
      }
    }
  }
  commit();
  return services;
}

/** 汇总某堆栈 LABELS 中所有服务挂载的标签（按 id 去重，保留标签库最新快照） */
function collectStackTags(stack: Stack): ResourceTag[] {
  const map = new Map<string, ResourceTag>();
  for (const l of stack.webuiLabels || []) {
    for (const t of l.tags || []) {
      if (t && t.id && !map.has(t.id)) map.set(t.id, t);
    }
  }
  return Array.from(map.values());
}

interface StacksProps {
  stacks: Stack[];
  loading?: boolean;
  error?: string | null;
  engineId?: string;
  onRefresh?: () => void;
  menuLanguage?: "en" | "zh";
  /** 全局标签库（来自系统设置 → 标签管理），LABELS 编辑器选择与列表聚合展示共用 */
  tagLibrary?: ResourceTag[];
  /** 堆栈管理页默认可见列（来自系统设置 → 列显隐 → 堆栈管理）；控制主页主表格 */
  defaultVisibleColumns?: string[];
  /** 容器子表默认可见列（来自系统设置 → 列显隐 → 容器子表）；控制弹窗内子表，与主页完全独立 */
  defaultSubColumns?: string[];
  /** 操作结果弹窗自动关闭延迟（秒），来自系统设置 → 弹窗设置；0/未设 = 不自动关闭 */
  autoCloseDelay?: number;
  /** 一键填入模板（来自系统设置 → Compose 管理） */
  composeTemplates?: ComposeTemplate[];
}

export function Stacks({ stacks, loading, error, engineId, onRefresh, menuLanguage = "zh", tagLibrary = [], defaultVisibleColumns, defaultSubColumns, autoCloseDelay = 5, composeTemplates = [] }: StacksProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  // 排序：默认按堆栈名称升序；名称/状态/标签/容器数 列头可点击切换
  const [sortKey, setSortKey] = useState<"name" | "status" | "tags" | "containers">("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  // 堆栈管理页 列显隐（来自系统设置 → 列显隐 → 堆栈管理）：控制主页主表格列
  type StackColumnKey = "name" | "status" | "tags" | "containers" | "uptime" | "update";
  const allStackColumns: { key: StackColumnKey; label: string }[] = [
    { key: "name", label: "堆栈名称" },
    { key: "status", label: "状态" },
    { key: "tags", label: "标签" },
    { key: "containers", label: "容器" },
    { key: "uptime", label: "运行时长" },
    { key: "update", label: "更新" },
  ];
  const [visibleStackColumns, setVisibleStackColumns] = useState<Set<StackColumnKey>>(
    defaultVisibleColumns && defaultVisibleColumns.length > 0
      ? new Set(defaultVisibleColumns as StackColumnKey[])
      : new Set(allStackColumns.map((c) => c.key))
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);
  const toggleStackColumn = (key: StackColumnKey) => {
    const next = new Set(visibleStackColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleStackColumns(next);
  };
  // 容器子表 列显隐（来自系统设置 → 列显隐 → 容器子表）：控制弹窗内子表，与主页完全独立
  type SubColumnKey = "name" | "image" | "status" | "network" | "ip" | "ports" | "update";
  const allSubColumns: { key: SubColumnKey; label: string }[] = [
    { key: "name", label: "容器名称" },
    { key: "image", label: "镜像" },
    { key: "status", label: "状态" },
    { key: "network", label: "网络" },
    { key: "ip", label: "容器 IP" },
    { key: "ports", label: "端口" },
    { key: "update", label: "更新" },
  ];
  const [visibleColumns, setVisibleColumns] = useState<Set<SubColumnKey>>(
    defaultSubColumns && defaultSubColumns.length > 0
      ? new Set(defaultSubColumns as SubColumnKey[])
      : new Set(allSubColumns.map((c) => c.key))
  );
  const toggleColumn = (key: SubColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setVisibleColumns(next);
  };
  // 点击外部关闭列选择器
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);
  const [containersModal, setContainersModal] = useState<Stack | null>(null);
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
  const { cmdOutput, showOutput, patchOutput, closeOutput } = useCmdOutput();

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

  /**
   * 活跃的 SSE 流句柄：按堆栈名保存（多个堆栈可同时操作，互不干扰）。
   * 组件卸载时全部关闭，避免连接泄漏。
   */
  const streamsRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => () => { streamsRef.current.forEach((close) => close()); streamsRef.current.clear(); }, []);

  /** 当前占据弹窗的堆栈（多堆栈并发时，只有它才往弹窗写入，避免输出串台） */
  const activeStackRef = useRef<string | null>(null);

  /**
   * 以 SSE 流式执行堆栈操作：点击后立即弹出命令输出弹窗，
   * compose 输出逐块实时推送滚动显示（不再显示「正在执行操作...」进度条）。
   * 弹窗关闭只是隐藏视图，操作仍继续执行完毕，操作日志照常记录。
   */
  const runStackActionStream = (
    stackName: string,
    label: string,
    actions: ("up" | "down" | "pull" | "restart" | "build")[]
  ) => {
    if (!engineId || operatingStacks.has(stackName)) return;
    setOperationError(null);
    addOperating(stackName);
    activeStackRef.current = stackName;
    showOutput({ title: label, name: stackName, output: "", streaming: true });
    let buf = "";
    // 所有堆栈操作（up/down/pull/restart/build）完成后均按设置自动关闭（取消按钮可保留弹窗）
    const closeDelay = autoCloseDelay ?? 5;
    // 只有占据弹窗的堆栈才更新弹窗内容（并发操作时其它堆栈照常记录日志）
    const isActive = () => activeStackRef.current === stackName;
    const closer = streamStackActions(engineId, stackName, actions, {
      onChunk: (text) => {
        buf = text;
        if (isActive()) patchOutput({ output: buf });
      },
      onDone: (output) => {
        addOpLog({ action: label, target: stackName, status: "success", engineId });
        if (isActive()) {
          patchOutput({ output, streaming: false, autoCloseDelay: closeDelay });
          activeStackRef.current = null;
        }
        streamsRef.current.delete(stackName);
        removeOperating(stackName);
        onRefresh?.();
      },
      onFail: (detail) => {
        addOpLog({ action: label, target: stackName, status: "failed", detail, engineId });
        if (isActive()) {
          patchOutput({ output: buf || detail, failed: true, streaming: false, autoCloseDelay: closeDelay });
          activeStackRef.current = null;
        }
        streamsRef.current.delete(stackName);
        removeOperating(stackName);
      },
    });
    streamsRef.current.set(stackName, closer);
  };

  // 执行堆栈操作：立即弹出实时进度弹窗，SSE 流式展示 compose 输出（成功与失败都弹）
  const handleStackAction = (stackName: string, action: "up" | "down" | "pull" | "restart" | "build") => {
    runStackActionStream(stackName, STACK_ACTION_LABEL[action] || action, [action]);
  };

  /**
   * 多步组合操作（如 强制更新 = pull + up、构建并启动 = build + up）。
   * 各步输出按顺序实时流式展示在同一个弹窗；中途失败展示已完成步骤的输出 + 失败详情。
   */
  const handleStackSteps = (
    stackName: string,
    label: string,
    actions: ("up" | "down" | "pull" | "restart" | "build")[]
  ) => {
    runStackActionStream(stackName, label, actions);
  };

  // 执行堆栈删除（docker compose down 输出以 tail 文本弹窗展示）
  const handleDeleteStack = async (stackName: string, removeVolumes: boolean) => {
    if (!engineId || deleting) return;
    setDeleting(true);
    try {
      const output = await removeStackApi(engineId, stackName, removeVolumes);
      addOpLog({ action: "删除堆栈", target: stackName, status: "success", detail: removeVolumes ? "含数据卷" : undefined, engineId });
      showOutput({ title: "删除堆栈", name: stackName, output: output || "（无输出）", autoCloseDelay });
      onRefresh?.();
      setConfirmDelete(null);
    } catch (e: any) {
      const detail = e.message || "删除失败";
      addOpLog({ action: "删除堆栈", target: stackName, status: "failed", detail, engineId });
      showOutput({ title: "删除堆栈", name: stackName, output: detail, failed: true, autoCloseDelay });
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
      showOutput({ title: "备份堆栈", name: stackName, output: `备份成功\n备份文件: ${result.backupName}`, autoCloseDelay });
    } catch (e: any) {
      const detail = e.message || "备份失败";
      addOpLog({ action: "备份堆栈", target: stackName, status: "failed", detail, engineId });
      showOutput({ title: "备份堆栈", name: stackName, output: detail, failed: true, autoCloseDelay });
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
        autoCloseDelay,
      });
      onRefresh?.();
    } catch (e: any) {
      showOutput({ title: "批量操作", name: `${names.length} 个堆栈`, output: e.message || "批量操作失败", failed: true, autoCloseDelay });
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

  const toggleSort = (key: string) => {
    const k = key as "name" | "status" | "tags" | "containers";
    if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setSortDir(1); }
  };

  const filtered = useMemo(() => {
    // 状态排序权重：running < partial < stopped < error < updating
    const statusRank: Record<string, number> = { running: 0, partial: 1, stopped: 2, error: 3, updating: 4 };
    const list = stacks.filter((s) => {
      const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.description.toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || s.status === statusFilter;
      return matchSearch && matchStatus;
    });
    // 排序（默认名称升序；点击列头切换）
    list.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "name") cmp = a.name.localeCompare(b.name, "zh");
      else if (sortKey === "status") cmp = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
      else if (sortKey === "tags") {
        const join = (s: Stack) => collectStackTags(s).map((t) => t.name).join(" ").toLowerCase();
        cmp = join(a).localeCompare(join(b), "zh");
        if (cmp === 0) cmp = collectStackTags(a).length - collectStackTags(b).length;
      } else if (sortKey === "containers") {
        cmp = (a.totalContainers - b.totalContainers) || (a.runningContainers - b.runningContainers);
      }
      // 二级排序：名称永远升序（保证稳定、可预期）
      if (cmp === 0) cmp = a.name.localeCompare(b.name, "zh");
      return cmp * sortDir;
    });
    return list;
  }, [stacks, search, statusFilter, sortKey, sortDir]);

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

          <span className="text-sm text-slate-400">{filtered.length} 个堆栈</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 提示：点击状态列弹出容器子表，置于列显隐按钮左边 */}
          <span
            className="inline-flex items-center gap-1 text-xs text-slate-400"
            title={L("Click the status column to pop up the container sub-table", "点击状态列可弹出容器子表")}
          >
            <Info size={12} className="text-blue-400" /> 点击状态列弹出容器子表
          </span>
          {/* 列显隐（堆栈管理页），位置与其他页面一致：主按钮左侧 */}
          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              title="选择堆栈管理页显示的列"
            >
              <Columns size={14} /> 列
            </button>
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg border border-slate-200 shadow-lg z-50 py-1">
                {allStackColumns.map((col) => (
                  <label
                    key={col.key}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={visibleStackColumns.has(col.key)}
                      onChange={() => toggleStackColumn(col.key)}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            )}
          </div>
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

      {/* 操作进度：不再显示全局「正在执行操作...」进度条，
          点击操作立即弹出命令输出弹窗（SSE 实时滚动显示 compose 输出） */}

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
              {visibleStackColumns.has("name") && <SortableTh label="堆栈名称" sortKey={sortKey} dir={sortDir} sortId="name" onSort={toggleSort} />}
              {visibleStackColumns.has("status") && <SortableTh label="状态" sortKey={sortKey} dir={sortDir} sortId="status" onSort={toggleSort} />}
              {visibleStackColumns.has("tags") && <SortableTh label="标签" sortKey={sortKey} dir={sortDir} sortId="tags" onSort={toggleSort} />}
              {visibleStackColumns.has("containers") && <SortableTh label="容器" align="center" sortKey={sortKey} dir={sortDir} sortId="containers" onSort={toggleSort} />}
              {visibleStackColumns.has("uptime") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">运行时长</th>}
              {visibleStackColumns.has("update") && <th className="text-center text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3">更新</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filtered.map((stack) => (
              <React.Fragment key={stack.id}>
                <tr
                  className={`hover:bg-slate-50 transition-colors cursor-context-menu ${selected.has(stack.id) ? "bg-blue-50/50" : ""}`}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, stack }); }}
                >
                  <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(stack.id); }}>
                    <button className="text-slate-400 hover:text-blue-500">
                      {selected.has(stack.id) ? <CheckSquare size={16} className="text-blue-500" /> : <SquareIcon size={16} />}
                    </button>
                  </td>
                  {visibleStackColumns.has("name") && (
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
                  )}
                  {visibleStackColumns.has("status") && (
                  <td className="px-3 py-3">
                    <button
                      onClick={() => setContainersModal(stack)}
                      title={L("Click status to view container sub-table", "点击状态列查看容器子表")}
                      className="inline-flex items-center rounded-md ring-1 ring-transparent hover:ring-blue-300 hover:bg-blue-50 px-1.5 py-0.5 transition-colors"
                    >
                      {/* 操作后台执行期间优先显示「执行中」，完成后自动回到真实状态 */}
                      <StatusBadge status={operatingStacks.has(stack.name) ? "operating" : stack.status} />
                    </button>
                  </td>
                  )}
                  {visibleStackColumns.has("tags") && (
                  <td className="px-3 py-3">
                    {(() => {
                      const st = collectStackTags(stack);
                      return st.length > 0 ? <TagGroup tags={st} max={2} /> : <span className="text-xs text-slate-300">—</span>;
                    })()}
                  </td>
                  )}
                  {visibleStackColumns.has("containers") && (
                  <td className="px-3 py-3 text-center">
                    <span className="text-sm font-bold text-slate-700">{stack.runningContainers}<span className="text-slate-400 font-normal">/{stack.totalContainers}</span></span>
                  </td>
                  )}
                  {visibleStackColumns.has("uptime") && (
                  <td className="px-3 py-3"><span className="text-sm text-slate-500">{stack.uptime}</span></td>
                  )}
                  {visibleStackColumns.has("update") && (
                  <td className="px-3 py-3 text-center">
                    {stack.hasUpdate ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 text-xs rounded-full border border-amber-100">
                        <RefreshCw size={10} /> 有更新
                      </span>
                    ) : (
                      <CheckCircle2 size={14} className="text-green-400 inline-block" />
                    )}
                  </td>
                  )}
                  {/* 操作列已移除：所有操作统一走右键菜单 */}
                </tr>
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
      {editStack && <StackEditorModal stack={editStack} onClose={() => setEditStack(null)} engineId={engineId} onRefresh={onRefresh} tagLibrary={tagLibrary} composeTemplates={composeTemplates} />}

      {/* Create Stack Modal */}
      {createMode && <CreateStackModal onClose={() => setCreateMode(false)} engineId={engineId} onRefresh={onRefresh} />}

      {/* Terminal Modal */}
      {terminalStack && <TerminalModal stack={terminalStack} onClose={() => setTerminalStack(null)} engineId={engineId} onRefresh={onRefresh} />}

      {/* Stack Log Modal */}
      {logStack && <StackLogModal stack={logStack} onClose={() => setLogStack(null)} engineId={engineId} />}

      {/* Container Sub-table Modal（点击状态列弹出，查看该堆栈的容器列表） */}
      {containersModal && (
        <Modal
          open
          onClose={() => setContainersModal(null)}
          title={`${L("Containers", "容器子表")} · ${containersModal.name}`}
          size="lg"
          dismissable
        >
          <div className="space-y-3">
            {/* Profiles */}
            {containersModal.profiles.length > 0 && (
              <div className="flex items-center gap-2 py-2 border-b border-slate-100">
                <TagIcon size={12} className="text-slate-400" />
                <span className="text-xs text-slate-500">Profiles:</span>
                {containersModal.profiles.map((p) => (
                  <Tag key={p} text={p} color={p === containersModal.settings.defaultProfiles[0] ? "blue" : "slate"} />
                ))}
                <span className="text-xs text-slate-400 ml-2">默认: {containersModal.settings.defaultProfiles.join(", ") || "无"}</span>
              </div>
            )}

            {/* 列显隐控制 */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-400">显示列:</span>
              {allSubColumns.map((c) => (
                <button
                  key={c.key}
                  onClick={() => toggleColumn(c.key)}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                    visibleColumns.has(c.key)
                      ? "bg-blue-50 border-blue-200 text-blue-600"
                      : "bg-slate-50 border-slate-200 text-slate-400"
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>

            {/* Container Table */}
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    {visibleColumns.has("name") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">容器名称</th>}
                    {visibleColumns.has("image") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">镜像</th>}
                    {visibleColumns.has("status") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">状态</th>}
                    {visibleColumns.has("network") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">网络</th>}
                    {visibleColumns.has("ip") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">容器 IP</th>}
                    {visibleColumns.has("ports") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">端口</th>}
                    {visibleColumns.has("update") && <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2">更新</th>}
                  </tr>
                </thead>
                <tbody>
                  {containersModal.containers.length === 0 ? (
                    <tr>
                      <td colSpan={visibleColumns.size || 1} className="px-3 py-8 text-center text-sm text-slate-400">该堆栈暂无容器</td>
                    </tr>
                  ) : (
                    containersModal.containers.map((container) => (
                      <tr
                        key={container.name}
                        className="hover:bg-slate-50 transition-colors cursor-context-menu border-b border-slate-50 last:border-0"
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, stack: containersModal, container }); }}
                      >
                        {visibleColumns.has("name") && (
                          <td className="px-3 py-2.5">
                            <span className="text-sm font-medium text-slate-700">{container.name}</span>
                            {container.isPinned && <Tag text="已固定" color="green" />}
                          </td>
                        )}
                        {visibleColumns.has("image") && (
                          <td className="px-3 py-2.5">
                            <span className="text-xs font-mono text-slate-600" title={`${container.image}:${container.tag}`}>{shortImageRef(container.image)}</span>
                            <span className="text-xs font-mono text-slate-400">:{container.tag}</span>
                          </td>
                        )}
                        {visibleColumns.has("status") && <td className="px-3 py-2.5"><StatusBadge status={operatingStacks.has(container.name) ? "operating" : container.status} /></td>}
                        {visibleColumns.has("network") && <td className="px-3 py-2.5"><span className="text-xs text-slate-500">{container.network}</span></td>}
                        {visibleColumns.has("ip") && <td className="px-3 py-2.5"><span className="text-xs font-mono text-slate-500">{container.ip}</span></td>}
                        {visibleColumns.has("ports") && <td className="px-3 py-2.5"><span className="text-xs font-mono text-slate-500">{container.ports}</span></td>}
                        {visibleColumns.has("update") && (
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </Modal>
      )}

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

/** 值留空时填入的默认值（键 → 取值函数，svcName 为第一个服务名）。 */
const COMPOSE_VALUE_DEFAULTS: Record<string, (svcName: string) => string> = {
  restart: () => "unless-stopped",
  network_mode: () => "bridge",
  container_name: (svcName) => svcName,
  privileged: () => "false",
  tty: () => "true",
  stdin_open: () => "true",
  init: () => "true",
  stop_grace_period: () => "10s",
};

/**
 * 为一行 compose 内容补全留空的值（仅当冒号后无任何非空内容时）。
 * 保留模板自身的缩进（手动空格），不强制层级。
 */
function completeEmptyValue(line: string, svcName: string): string {
  const m = line.match(/^(\s*)([A-Za-z0-9_.\-]+)\s*:\s*(.*)$/);
  if (!m) return line;
  const [, indent, key, val] = m;
  if (val.trim() !== "") return line; // 已有值，原样保留
  const def = COMPOSE_VALUE_DEFAULTS[key];
  if (def) return `${indent}${key}: ${def(svcName)}`;
  return line; // 未知键且无值，原样保留（无法推断默认）
}

/**
 * 将一段模板（可多行）插入到 compose 文本。
 * - insert="service"：插到 services 下第一个服务内部（缩进由模板自身决定，用户手动输入空格）；
 * - insert="end"：追加到 compose 文本的最后一行（末尾）。
 * 模板内每一行原样保留（支持多行内容）；值留空的项按 COMPOSE_VALUE_DEFAULTS 补全；
 * 服务块内已存在同名 key 时跳过（避免重复键）；未找到 services: / 服务行时（仅 service 模式）返回结构错误原因。
 */
function insertTemplateBlock(
  compose: string,
  block: string,
  insert: "service" | "end"
): { next: string; ok: boolean; reason?: string } {
  const lines = compose.split("\n");
  const blockLines = block
    .split("\n")
    // 末尾模式无服务名可注入，传 "" 即可（container_name 等键不会补全，符合预期）
    .map((l) => completeEmptyValue(l, ""));
  const contentLines = blockLines.filter((l) => l.trim() !== "");
  if (contentLines.length === 0) return { next: compose, ok: false, reason: "模板内容为空，无法填入" };

  if (insert === "end") {
    // 去掉尾部空行后直接追加到文件末尾（保留一个换行分隔）
    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(...blockLines);
    return { next: lines.join("\n"), ok: true };
  }

  // ---- service 模式：插入到第一个服务内部 ----
  const svcIdx = lines.findIndex((l) => /^services\s*:\s*(#.*)?$/.test(l));
  if (svcIdx < 0) return { next: compose, ok: false, reason: "未找到 services: 顶层键，无法定位填入位置" };

  const indentOf = (l: string) => (l.match(/^(\s*)/) || ["", ""])[1].length;
  const baseIndent = indentOf(lines[svcIdx]);

  // services: 下第一个服务名行
  let svcLineIdx = -1;
  let svcIndent = -1;
  let svcName = "";
  for (let i = svcIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || /^\s*#/.test(l)) continue;
    const ind = indentOf(l);
    if (ind <= baseIndent) break;
    const m = l.match(/^\s*([A-Za-z0-9_.\-]+)\s*:/);
    if (m) {
      svcName = m[1];
      svcLineIdx = i;
      svcIndent = ind;
    }
    break;
  }
  if (svcLineIdx < 0) return { next: compose, ok: false, reason: "services: 下没有任何服务，无法定位填入位置" };

  // 末尾模式补全用的 svcName 已失效（上面用 "" 跑了一次），此处用真实 svcName 重新补全
  const finalBlockLines = block.split("\n").map((l) => completeEmptyValue(l, svcName));
  const firstKey = contentLines[0].match(/^\s*([A-Za-z0-9_.\-]+)\s*:/)?.[1];
  if (firstKey) {
    for (let i = svcLineIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (!l.trim() || /^\s*#/.test(l)) continue;
      const ind = indentOf(l);
      if (ind <= svcIndent) break; // 离开服务块
      const km = l.match(/^\s*([A-Za-z0-9_.\-]+)\s*:/);
      if (km && km[1] === firstKey) return { next: compose, ok: false, reason: `属性 ${firstKey} 已存在，已跳过` };
    }
  }

  // 插入位置：服务名行之后，跳过空行/注释，插到服务块顶部
  let insertAt = svcLineIdx + 1;
  while (insertAt < lines.length && (!lines[insertAt].trim() || /^\s*#/.test(lines[insertAt]))) insertAt++;
  lines.splice(insertAt, 0, ...finalBlockLines);
  return { next: lines.join("\n"), ok: true };
}

function StackEditorModal({ stack, onClose, engineId, onRefresh, tagLibrary = [], composeTemplates = [] }: { stack: Stack; onClose: () => void; engineId?: string; onRefresh?: () => void; tagLibrary?: ResourceTag[]; composeTemplates?: ComposeTemplate[] }) {
  const [activeTab, setActiveTab] = useState<"compose" | "env" | "webui" | "settings">("compose");
  const [composeContent, setComposeContent] = useState(stack.composeContent);
  const [envContent, setEnvContent] = useState(stack.envContent || "");
  const [webuiLabels, setWebuiLabels] = useState(stack.webuiLabels);
  const [settings, setSettings] = useState(stack.settings);
  const [yamlValid, setYamlValid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  /** 一键填入模板面板的瞬时提示（同名跳过 / 结构错误原因） */
  const [tplHint, setTplHint] = useState<string | null>(null);
  /** 填入单个模板项：按模板自身 insert 模式插入，缩进由模板自身决定，同名 key 已存在则跳过并提示 */
  const applyComposeTemplate = (tpl: ComposeTemplate) => {
    const res = insertTemplateBlock(composeContent, tpl.content, tpl.insert);
    if (!res.ok) { setTplHint(res.reason || "无法填入"); return; }
    setComposeContent(res.next);
    setTplHint(null);
  };
  /** 一键全填入：按模板顺序逐项插入，已存在的自动跳过 */
  const applyAllComposeTemplates = () => {
    let cur = composeContent;
    const skipped: string[] = [];
    for (const tpl of composeTemplates) {
      const res = insertTemplateBlock(cur, tpl.content, tpl.insert);
      if (res.ok) cur = res.next;
      else skipped.push((tpl.content.split("\n")[0].split(":")[0] || tpl.content).trim() || "空模板");
    }
    setComposeContent(cur);
    setTplHint(skipped.length ? `已跳过：${skipped.join("、")}` : null);
  };
  const [iconUploading, setIconUploading] = useState(false);
  const iconInputRef = useRef<HTMLInputElement>(null);
  // 内嵌 SVG 图标的代码编辑器（settings.iconUrl 与 webuiLabels[i].iconUrl 共用）
  type IconTarget = { kind: "settings" } | { kind: "label"; index: number };
  const [svgEditorOpen, setSvgEditorOpen] = useState(false);
  const [svgTarget, setSvgTarget] = useState<IconTarget>({ kind: "settings" });
  const [svgDraft, setSvgDraft] = useState("");
  // 编辑器的实时校验结果与预览地址（空内容时 validate 返回全零，不会误报）
  const svgValidation = useMemo(() => validateSvgCode(svgDraft), [svgDraft]);
  const svgPreview = svgValidation.code ? svgToDataUri(svgValidation.code) : "";
  /** 读取图标的目标：stack 设置图标或某个 LABELS 服务的图标 */
  const getIconUrl = (t: IconTarget): string =>
    t.kind === "settings" ? settings.iconUrl : webuiLabels[t.index]?.iconUrl || "";
  const setIconUrl = (t: IconTarget, url: string) => {
    if (t.kind === "settings") {
      setSettings({ ...settings, iconUrl: url });
    } else {
      const next = [...webuiLabels];
      if (next[t.index]) next[t.index] = { ...next[t.index], iconUrl: url };
      setWebuiLabels(next);
    }
  };
  // LABELS 图标：本地文件 → data URI（LABELS 图标不托管于服务器，直接内联）
  const labelIconInputRef = useRef<HTMLInputElement>(null);
  const pendingLabelIconIndexRef = useRef<number>(-1);

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
      const missing = services.filter((s) => !existingNames.has(s.name));
      if (missing.length === 0) return prev; // 无需补全

      // WebUI URL 默认 = 地址栏 scheme://hostname : 识别到的宿主机端口
      const base = `${window.location.protocol}//${window.location.hostname}`;
      // 只追加缺失的服务，保留已有配置（自动填入宿主机端口与 WebUI 地址）
      return [
        ...prev,
        ...missing.map((s) => ({
          serviceName: s.name,
          iconUrl: "",
          webuiPort: s.hostPort || "",
          webuiUrl: s.hostPort ? `${base}:${s.hostPort}` : "",
          defaultShell: "/bin/sh",
          tags: [],
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

  /** 读取本地文件为 data URI 并写入指定 LABELS 服务的图标（LABELS 图标不托管服务器，直接内联） */
  const handleLabelIconFile = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (url) setIconUrl({ kind: "label", index }, url);
    };
    reader.onerror = () => setSaveError("图标读取失败");
    reader.readAsDataURL(file);
  };

  /**
   * 图标输入框变化：直接粘贴 SVG 源码时自动转成 data URI。
   * 这样即使用户不点「SVG 代码」按钮，把代码粘进输入框也能正常工作。
   */
  const handleIconInputChange = (t: IconTarget, val: string) => {
    if (!isSvgCode(val)) {
      setIconUrl(t, val);
      return;
    }
    const { code, error } = validateSvgCode(val);
    if (error) {
      setSaveError(error);
      return;
    }
    setSaveError(null);
    setIconUrl(t, svgToDataUri(code));
  };

  /** 打开 SVG 代码编辑器：已内嵌 SVG 时回填原码，否则从空白开始 */
  const openSvgEditor = (t: IconTarget) => {
    setSvgTarget(t);
    const cur = getIconUrl(t);
    setSvgDraft(isInlineSvgIcon(cur) ? dataUriToSvg(cur) || "" : "");
    setSaveError(null);
    setSvgEditorOpen(true);
  };

  /** 应用编辑器里的 SVG 代码（写进 iconUrl，需再点 APPLY 才会落盘） */
  const applySvgCode = () => {
    const { code, error } = validateSvgCode(svgDraft);
    if (error) {
      setSaveError(error);
      return;
    }
    if (!code) {
      setIconUrl(svgTarget, ""); // 内容为空视为清除图标
      setSvgEditorOpen(false);
      return;
    }
    setSaveError(null);
    setIconUrl(svgTarget, svgToDataUri(code));
    setSvgEditorOpen(false);
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
        lines.push(`# ${s.name.toUpperCase().replace(/[-.]/g, "_")}_PORT=`);
      }
    }
    setEnvContent(lines.join("\n"));
  };

  return createPortal(
    <div className="fixed inset-0 z-[1000] bg-black/40 flex flex-col">
      <div className="modal-content bg-white rounded-t-xl shadow-2xl w-full max-w-[90vw] h-[90vh] mx-auto mt-auto flex flex-col">
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
            <div className="flex flex-col h-full p-6 gap-3">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">支持的文件名:</span>
                {["compose.yaml", "docker-compose.yaml", "compose.yml", "docker-compose.yml"].map((f) => {
                  const baseName = stack.composeFilePath.split(/[\\/]/).pop() || "";
                  return <Tag key={f} text={f} color={baseName === f ? "blue" : "slate"} />;
                })}
              </div>
              <div className="flex gap-3 flex-1 min-h-0">
                {/* 左：YAML 编辑器（行号 + 高亮 + Lint + 格式化） */}
                <YamlEditor
                  className="flex-1 min-w-0"
                  value={composeContent}
                  onChange={(v) => { setComposeContent(v); setTplHint(null); }}
                  onValidChange={(v) => setYamlValid(v)}
                  placeholder={"services:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\"\n    restart: unless-stopped"}
                />
                {/* 右：一键填入模板面板（系统设置 → Compose 管理 配置） */}
                {composeTemplates.length > 0 && (
                  <div className="w-52 shrink-0 flex flex-col border border-slate-200 rounded-lg bg-slate-50/60 overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-500">
                      一键填入
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
                      {composeTemplates.map((tpl, i) => (
                        <button
                          key={i}
                          onClick={() => applyComposeTemplate(tpl)}
                          title={`填入: ${tpl.content}\n位置: ${tpl.insert === "end" ? "末尾" : "服务内"}`}
                          className="w-full text-left px-2 py-1.5 rounded-md border border-slate-200 bg-white font-mono text-[11px] leading-relaxed text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors whitespace-pre-wrap break-words"
                        >
                          <span className="inline-block mb-0.5 px-1 rounded bg-slate-100 text-[9px] text-slate-400 uppercase">
                            {tpl.insert === "end" ? "末尾" : "服务内"}
                          </span>
                          {"\n"}
                          {tpl.content.trim() || `（空模板 ${i + 1}）`}
                        </button>
                      ))}
                    </div>
                    <div className="p-2 border-t border-slate-100 space-y-1.5">
                      {tplHint && (
                        <div className="text-[11px] text-amber-600 leading-snug break-all">{tplHint}</div>
                      )}
                      <button
                        onClick={applyAllComposeTemplates}
                        className="w-full px-2 py-1.5 text-xs text-white bg-blue-500 rounded-md hover:bg-blue-600 transition-colors"
                      >
                        全部填入
                      </button>
                    </div>
                  </div>
                )}
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
                  <EnvEditor
                    value={envContent}
                    onChange={setEnvContent}
                    minHeight={320}
                  />
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
                  onClick={() => setWebuiLabels([...webuiLabels, { serviceName: "", iconUrl: "", webuiPort: "", webuiUrl: "", defaultShell: "/bin/sh", tags: [] }])}
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
                const missing = detected.filter((s) => !configured.has(s.name));
                return (
                  <div className="flex items-center gap-2 flex-wrap px-3 py-2 mb-4 bg-blue-50 border border-blue-100 rounded-lg">
                    <CheckCircle2 size={14} className="text-blue-500 flex-shrink-0" />
                    <span className="text-xs text-blue-600">
                      已识别 {detected.length} 个服务：{detected.map((s) => (
                        <span key={s.name} className={`inline-block px-1.5 py-0.5 mx-0.5 rounded font-mono text-[11px] ${configured.has(s.name) ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{s.name}</span>
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
                      <FormField label="图标">
                        {isInlineSvgIcon(label.iconUrl) ? (
                          // 内嵌 SVG：base64 串很长，塞进单行输入框毫无意义，改为展示条 + 编辑入口
                          <div className="flex items-center gap-3 px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50">
                            <img src={label.iconUrl} alt="" className="w-6 h-6 flex-shrink-0" />
                            <span className="flex-1 text-sm text-slate-600 truncate">
                              内嵌 SVG 图标（{svgSizeLabel(label.iconUrl)}）
                            </span>
                            <button
                              type="button"
                              onClick={() => openSvgEditor({ kind: "label", index: i })}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded hover:bg-white whitespace-nowrap"
                            >
                              <Code size={12} /> 编辑代码
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = [...webuiLabels];
                                next[i] = { ...label, iconUrl: "" };
                                setWebuiLabels(next);
                              }}
                              className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 border border-slate-200 rounded hover:bg-white hover:text-red-600 whitespace-nowrap"
                            >
                              <Trash2 size={12} /> 清除
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <Input
                              value={label.iconUrl}
                              onChange={(val) => handleIconInputChange({ kind: "label", index: i }, val)}
                              placeholder="https://... 、上传本地图片，或直接粘贴 SVG 代码"
                            />
                            <input
                              ref={labelIconInputRef}
                              type="file"
                              accept="image/png,image/jpeg,image/gif,image/svg+xml,image/webp,image/x-icon"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleLabelIconFile(pendingLabelIconIndexRef.current, file);
                                e.target.value = "";
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => { pendingLabelIconIndexRef.current = i; labelIconInputRef.current?.click(); }}
                              title="上传本地图片（含 .svg 文件）"
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Upload size={14} /> 上传
                            </button>
                            <button
                              type="button"
                              onClick={() => openSvgEditor({ kind: "label", index: i })}
                              title="粘贴 SVG 代码作为图标"
                              className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                            >
                              <Code size={14} /> SVG
                            </button>
                          </div>
                        )}
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

                    {/* 标签：为每个服务（对应容器）打上全局标签库中的彩色标签 */}
                    <div className="mt-3">
                      <FormField label="标签">
                        <TagSelect
                          library={tagLibrary}
                          value={label.tags || []}
                          onChange={(next) => {
                            const arr = [...webuiLabels];
                            arr[i] = { ...label, tags: next };
                            setWebuiLabels(arr);
                          }}
                          placeholder="选择标签（容器管理/堆栈管理列表将同步显示）"
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
                  {isInlineSvgIcon(settings.iconUrl) ? (
                    // 内嵌 SVG：base64 串很长，塞进单行输入框毫无意义，改为展示条 + 编辑入口
                    <div className="flex items-center gap-3 px-3 py-1.5 border border-slate-200 rounded-lg bg-slate-50">
                      <img src={settings.iconUrl} alt="" className="w-6 h-6 flex-shrink-0" />
                      <span className="flex-1 text-sm text-slate-600 truncate">
                        内嵌 SVG 图标（{svgSizeLabel(settings.iconUrl)}）
                      </span>
                      <button
                        type="button"
                        onClick={() => openSvgEditor({ kind: "settings" })}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded hover:bg-white whitespace-nowrap"
                      >
                        <Code size={12} /> 编辑代码
                      </button>
                      <button
                        type="button"
                        onClick={() => setSettings({ ...settings, iconUrl: "" })}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500 border border-slate-200 rounded hover:bg-white hover:text-red-600 whitespace-nowrap"
                      >
                        <Trash2 size={12} /> 清除
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        value={settings.iconUrl}
                        onChange={(val) => handleIconInputChange({ kind: "settings" }, val)}
                        placeholder="https://... 、上传本地图片，或直接粘贴 SVG 代码"
                      />
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
                        title="上传本地图片（含 .svg 文件）"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        {iconUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                        上传
                      </button>
                      <button
                        type="button"
                        onClick={() => openSvgEditor({ kind: "settings" })}
                        title="粘贴 SVG 代码作为图标"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Code size={14} /> SVG
                      </button>
                    </div>
                  )}
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

        {/* 内嵌 SVG 图标：代码编辑器 */}
        <Modal
          open={svgEditorOpen}
          onClose={() => setSvgEditorOpen(false)}
          title="SVG 图标代码"
          size="lg"
          footer={
            <>
              <button
                onClick={() => setSvgEditorOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
              >
                取消
              </button>
              <button
                onClick={applySvgCode}
                disabled={!!svgValidation.error}
                className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                {svgValidation.code ? "应用" : "清除图标"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-xs text-slate-500 leading-relaxed">
              粘贴 SVG 源码（以 <code className="px-1 bg-slate-100 rounded">&lt;svg</code> 开头）。
              保存时会自动剔除脚本、事件属性与 <code className="px-1 bg-slate-100 rounded">javascript:</code> 链接，
              再编码为 data URI 存入图标字段；单张上限 {MAX_SVG_BYTES / 1024} KB。
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">SVG 代码</label>
                <textarea
                  value={svgDraft}
                  onChange={(e) => setSvgDraft(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  placeholder={'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  ...\n</svg>'}
                  className="w-full px-3 py-2 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">预览</label>
                <div className="h-[248px] flex items-center justify-center border border-slate-200 rounded-lg bg-slate-50">
                  {svgPreview ? (
                    <img src={svgPreview} alt="SVG 预览" className="max-w-[80%] max-h-[80%]" />
                  ) : (
                    <span className="text-xs text-slate-400">填入有效 SVG 代码后在此预览</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className={svgValidation.error ? "text-red-500" : "text-slate-400"}>
                {svgValidation.error || (svgValidation.bytes > 0 ? `体积 ${(svgValidation.bytes / 1024).toFixed(1)} KB` : "等待输入")}
              </span>
              <span className="text-slate-400">应用后需再点「应用 / 确定」才会保存</span>
            </div>
          </div>
        </Modal>
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
    { key: "convert", label: "命令转换", icon: <ArrowLeftRight size={20} />, desc: "docker run → Compose" },
  ];

  // ===== 命令转换面板状态 =====
  const [convertInput, setConvertInput] = useState("");
  const [convertResult, setConvertResult] = useState<ConvertResult | null>(null);

  /** 执行转换 */
  const runConvert = () => setConvertResult(convert(convertInput));

  /**
   * 用转换结果新建堆栈：回填 compose 内容并切到 Web 编辑器。
   * 只有 run2compose 方向才有意义（compose2run 产出的是 docker run 命令，不是 compose）。
   */
  const useConvertedCompose = () => {
    if (!convertResult?.ok || !convertResult.output.trim()) return;
    setComposeContent(convertResult.output);
    setYamlValid(true);
    setCreateError(null);
    setMethod("editor");
  };

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
        <div className="grid grid-cols-3 gap-3">
          {methods.map((m) => (
            <button
              key={m.key}
              onClick={() => setMethod(m.key)}
              disabled={creating}
              className={`flex items-start gap-2.5 p-3 rounded-lg border-2 text-left transition-all ${
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
              <YamlEditor
                className={creating ? "opacity-60 pointer-events-none" : ""}
                value={composeContent}
                onChange={(v) => {
                  setComposeContent(v);
                  setYamlValid(v.trim().length > 0);
                }}
                onValidChange={setYamlValid}
                minHeight={260}
                placeholder={"services:\n  web:\n    image: nginx:alpine\n    ports:\n      - '8080:80'\n    restart: unless-stopped"}
              />
            </FormField>
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

        {/* ===== 命令转换：docker run → Docker Compose ===== */}
        {method === "convert" && (
          <div className="space-y-3">
            {/* 输入 */}
            <FormField label="docker run 命令">
              <textarea
                value={convertInput}
                onChange={(e) => { setConvertInput(e.target.value); setConvertResult(null); }}
                className="w-full h-28 p-3 font-mono text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 resize-none"
                spellCheck={false}
                placeholder={'docker run -d --name myapp -p 8080:80 -e FOO=bar nginx:alpine'}
              />
            </FormField>

            {/* 操作行 */}
            <div className="flex items-center gap-2">
              <button
                onClick={runConvert}
                disabled={!convertInput.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ArrowLeftRight size={14} /> 转换
              </button>
              {convertResult?.ok && convertResult.output && (
                <button
                  onClick={() => navigator.clipboard?.writeText(convertResult.output)}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <Copy size={14} /> 复制结果
                </button>
              )}
            </div>

            {/* 转换失败 */}
            {convertResult && !convertResult.ok && (
              <div className="flex items-start gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                <span className="text-xs text-red-600">{convertResult.error}</span>
              </div>
            )}

            {/* 转换成功：输出 + 警告 */}
            {convertResult?.ok && (
              <div className="space-y-2">
                <FormField label="Compose 转换结果">
                  <pre className="w-full max-h-64 overflow-auto p-3 font-mono text-xs text-slate-200 bg-slate-900 rounded-lg whitespace-pre-wrap break-all">
                    {convertResult.output || "（无输出）"}
                  </pre>
                </FormField>

                {convertResult.warnings.length > 0 && (
                  <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-1">
                      <AlertCircle size={12} className="text-amber-500" />
                      <span className="text-xs font-medium text-amber-700">转换提示（{convertResult.warnings.length}）</span>
                    </div>
                    <ul className="space-y-0.5 pl-4 list-disc">
                      {convertResult.warnings.map((w, i) => (
                        <li key={i} className="text-xs text-amber-600">{w}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 转换成 Compose 后：一键带入新建表单 */}
                {convertResult.output.trim() && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5 bg-blue-50 border border-blue-100 rounded-lg">
                    <span className="text-xs text-blue-700">已生成 Compose 内容，可直接用它创建新堆栈</span>
                    <button
                      onClick={useConvertedCompose}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors whitespace-nowrap"
                    >
                      <Plus size={14} /> 新建
                    </button>
                  </div>
                )}
              </div>
            )}
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
        {/* 命令转换模式只有输入/输出，没有堆栈名称，创建按钮无意义 → 隐藏 */}
        {method !== "convert" && (
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
        )}
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
