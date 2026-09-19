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
  Upload,
  ImageDown,
  RotateCcw,
} from "lucide-react";
import type { DockerImage, PullTask, ImageUpdateStatusView } from "../types";
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
  downloadImageApi,
  uploadImageApi,
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
  /** 检查全部镜像更新（后端 digest 比对） */
  onCheckAllUpdates?: () => void;
  /** 检查单个镜像更新（右键菜单，传 repo:tag） */
  onCheckImageUpdate?: (ref: string) => void;
  checkingUpdates?: boolean;
  /** 最近一次检查结果（进页面读缓存 / 检查后写入） */
  imageUpdateStatus?: ImageUpdateStatusView | null;
  /** 检查失败原因（后端不可达 / 引擎未连接等） */
  imageUpdateError?: string | null;
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

/**
 * 字节单位换算（KB/MB/GB）。parseFloat 单位必须是 B/KB/MB/GB/TB，
 * 单位字母取大写首字符后查表。
 */
const SIZE_UNIT: Record<string, number> = { "": 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(1)} MB`;
  return `${(b / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * 从 tail 文本解析字节进度（不依赖 layer 字段，兼容 CLI + Dockerode 两条路径）。
 *
 * docker pull 输出行有三种形态：
 *   1. `<hash>: Downloading [=>    ] 1.2MB/45.6MB` — 解析 current/total
 *   2. `<hash>: Download complete`                — 无字节信息（跳过）
 *   3. `$ docker pull nginx:latest`               — 命令回显（跳过，非 <hash>: 开头）
 *
 * CLI 与 dockerode 输出都共用「<hash>: <状态> [可选进度]」格式，前端扫 outputTail 即可。
 * 同一层每秒一条进度行，按层 ID 保留 max current / max total 再求和，
 * 避免「同一层被多次累加」导致 current 大于 total。
 *
 * 返回 null 表示本批次还没收到任何带字节的行（拉取刚启动、或纯状态行）。
 */
function parsePullTailSizes(tail: string[]): { current: number; total: number } | null {
  const SIZE_RE = /(\d+(?:\.\d+)?)\s*([kKmMgGtT]?B)\s*\/\s*(\d+(?:\.\d+)?)\s*([kKmMgGtT]?B)/;
  const currentByLayer = new Map<string, number>();
  const totalByLayer = new Map<string, number>();
  for (const line of tail) {
    const colonIdx = line.indexOf(": ");
    if (colonIdx < 12) continue; // 不是 "<hash>: ..." 开头
    const m = line.match(SIZE_RE);
    if (!m) continue;
    const layerId = line.substring(0, colonIdx);
    const cur = Math.round(parseFloat(m[1]) * (SIZE_UNIT[m[2].toUpperCase().charAt(0)] || 1));
    const tot = Math.round(parseFloat(m[3]) * (SIZE_UNIT[m[4].toUpperCase().charAt(0)] || 1));
    if (cur > (currentByLayer.get(layerId) || 0)) currentByLayer.set(layerId, cur);
    if (tot > (totalByLayer.get(layerId) || 0)) totalByLayer.set(layerId, tot);
  }
  if (currentByLayer.size === 0) return null;
  let cur = 0, tot = 0;
  currentByLayer.forEach((v) => { cur += v; });
  totalByLayer.forEach((v) => { tot += v; });
  return { current: cur, total: tot };
}

/**
 * 计算拉取任务的整体字节进度。
 * - 已完成层（Pull complete / Already exists / Download complete）若未提供 current/total，
 *   不计入总量，避免总进度被未知大小的层拉低。
 * - 进行中层按 current / total 求和；total 为 0 时返回 0%。
 */
function calcPullProgress(layers: PullTask["layers"]) {
  let current = 0;
  let total = 0;
  let completed = 0;
  for (const l of layers) {
    const done = /^(Pull complete|Already exists|Download complete)$/i.test(l.status || "");
    if (done) {
      completed++;
      if (l.current != null && l.total != null && l.total > 0) {
        current += l.current;
        total += l.total;
      }
      continue;
    }
    if (l.current != null && l.total != null && l.total > 0) {
      current += l.current;
      total += l.total;
    }
  }
  const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
  return { current, total, pct, completed, count: layers.length };
}

/**
 * 拉取进度面板：可视化层进度 + 终端风格 tail 文本。
 * - 自动滚到底（避免长 tail 时停在顶部看不到新行）
 * - tail 为空时显示「正在连接…」占位
 * - 字节指示：解析不到时显示 — / —（拉取刚开始或只有状态行）
 */
function PullOutputPanel({ task }: { task: PullTask }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [task.outputTail]);

  const bytes = parsePullTailSizes(task.outputTail);
  const progress = calcPullProgress(task.layers);
  const isPulling = task.status === "pulling";
  const hasLayers = task.layers.length > 0;

  return (
    <div className="space-y-4">
      {/* 总进度条 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <Layers size={16} className="text-blue-500" />
            <span>下载进度</span>
            {!isPulling && task.status === "success" && (
              <CheckCircle2 size={14} className="text-green-500" />
            )}
            {!isPulling && task.status === "error" && (
              <XCircle size={14} className="text-red-500" />
            )}
          </div>
          <div className="text-xs font-mono text-slate-500">
            {progress.total > 0 ? (
              <span>
                <span className="font-semibold text-slate-700">{progress.pct}%</span>
                <span className="ml-1.5">{fmtBytes(progress.current)} / {fmtBytes(progress.total)}</span>
              </span>
            ) : bytes ? (
              <span>{fmtBytes(bytes.current)} / {fmtBytes(bytes.total)}</span>
            ) : (
              <span>— / —</span>
            )}
          </div>
        </div>
        <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              task.status === "error" ? "bg-red-500" :
              task.status === "success" ? "bg-green-500" : "bg-blue-500"
            }`}
            style={{ width: `${progress.total > 0 ? progress.pct : task.status === "success" ? 100 : 0}%` }}
          />
        </div>
      </div>

      {/* 镜像层明细 */}
      {hasLayers && (
        <div className="border border-slate-200 rounded-lg overflow-hidden">
          <div className="bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-500 flex items-center justify-between">
            <span>镜像层</span>
            <span>{progress.completed}/{progress.count} 完成</span>
          </div>
          <div className="max-h-[180px] overflow-y-auto p-2 space-y-2">
            {task.layers.map((layer) => {
              const done = /^(Pull complete|Already exists|Download complete)$/i.test(layer.status || "");
              const hasSize = layer.total != null && layer.total > 0 && layer.current != null;
              const pct = hasSize ? Math.min(100, Math.round((layer.current! / layer.total!) * 100)) : done ? 100 : 0;
              return (
                <div key={layer.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-slate-500 truncate max-w-[80px]">{layer.id.slice(0, 12)}</span>
                      <span className="text-slate-700 truncate">{layer.status || "等待中"}</span>
                    </div>
                    {hasSize && (
                      <span className="text-slate-500 font-mono ml-2 shrink-0">
                        {fmtBytes(layer.current!)} / {fmtBytes(layer.total!)}
                      </span>
                    )}
                  </div>
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${done ? "bg-green-500" : "bg-blue-400"}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 输出日志 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500">输出日志</span>
          <span className="text-xs font-mono text-slate-400">
            {bytes ? `${fmtBytes(bytes.current)}${bytes.total > 0 ? ` / ${fmtBytes(bytes.total)}` : ""}` : "— / —"}
          </span>
        </div>
        <pre
          ref={ref}
          className="bg-slate-900 text-slate-200 rounded-lg p-3 max-h-[40vh] min-h-[160px] overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {task.outputTail.length === 0 ? "正在连接...\n" : task.outputTail.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">{line}</div>
          ))}
        </pre>
      </div>
    </div>
  );
}

/** 导入镜像的进度状态（两阶段：① 上传 tar ② 服务端 docker load 解包） */
export interface ImageImportState {
  fileName: string;
  fileSize: number;
  /** 已上传字节；total 为 0 表示长度不可知（浏览器未给出 lengthComputable） */
  sent: number;
  total: number;
  phase: "uploading" | "loading" | "done" | "error";
  /** docker load 累计输出行：既用于 tail 展示，也用于解析导入阶段的字节进度 */
  lines: string[];
  /** 成功时导入的镜像（来自 `Loaded image: …` 行） */
  images: string[];
  error?: string;
}

/**
 * 进度条。value === null 时渲染不确定态滑动条纹 —— 宁可显示「在进行、进度未知」，
 * 也不伪造一个假的百分比。
 */
function ProgressBar({ value, tone }: { value: number | null; tone: "blue" | "green" | "red" }) {
  const color = tone === "red" ? "bg-red-500" : tone === "green" ? "bg-green-500" : "bg-blue-500";
  return (
    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
      {value === null ? (
        <div className={`h-full w-1/3 rounded-full ${color} animate-indeterminate`} />
      ) : (
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      )}
    </div>
  );
}

/**
 * 导入镜像进度面板。
 *
 * 两个阶段的进度来源本就不同，刻意分开显示：
 * - **上传 tar**：XHR `upload.onprogress` 给出的精确字节（大镜像耗时最长的一段就在这）；
 * - **导入（docker load）**：只能从 CLI 输出行解析——`docker load` 不预先公布层总量，
 *   非 TTY 下往往只输出「层完成行」，因此解析不到字节时用不确定态条纹，
 *   而不是伪造百分比。能解析时复用 `parsePullTailSizes`（同为 `<hash>: … MB/MB` 格式）。
 */
function ImageImportPanel({
  state,
  onCancel,
  onClose,
}: {
  state: ImageImportState;
  onCancel: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  const lineCount = state.lines.length;
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lineCount]);

  const done = state.phase === "done";
  const failed = state.phase === "error";
  const uploading = state.phase === "uploading";
  const uploadPct = state.total > 0 ? Math.min(100, Math.round((state.sent / state.total) * 100)) : null;

  const loadBytes = parsePullTailSizes(state.lines);
  const loadPct = done
    ? 100
    : loadBytes && loadBytes.total > 0
      ? Math.min(100, Math.round((loadBytes.current / loadBytes.total) * 100))
      : null;

  return (
    <div className="p-6 space-y-4">
      {/* 终态结果横幅 */}
      {(done || failed) && (
        <div
          className={`flex items-start gap-3 px-4 py-3 rounded-lg ${
            done ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
          }`}
        >
          {done ? <CheckCircle2 size={20} className="mt-0.5 shrink-0" /> : <XCircle size={20} className="mt-0.5 shrink-0" />}
          <div className="min-w-0">
            <div className="text-sm font-semibold">{done ? "导入成功" : "导入失败"}</div>
            <div className="text-xs mt-0.5 opacity-80 break-all">
              {done ? (state.images.length ? state.images.join("、") : state.fileName) : state.error || "导入失败"}
            </div>
          </div>
        </div>
      )}

      {/* 阶段一：上传 tar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <Upload size={16} className={uploading ? "text-blue-500" : "text-slate-300"} />
            <span>上传 tar</span>
            {!uploading && <CheckCircle2 size={14} className="text-green-500" />}
          </div>
          <span className="text-xs font-mono text-slate-500 shrink-0">
            {uploading && uploadPct === null ? "—" : `${uploading ? uploadPct : 100}%`}
            {state.total > 0 && (
              <span className="ml-1.5">
                {fmtBytes(uploading ? state.sent : state.total)} / {fmtBytes(state.total)}
              </span>
            )}
          </span>
        </div>
        <ProgressBar value={uploading ? uploadPct : 100} tone="blue" />
      </div>

      {/* 阶段二：服务端 docker load 解包 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-slate-700">
            <HardDrive size={16} className={state.phase === "loading" ? "text-blue-500" : "text-slate-300"} />
            <span>导入镜像（docker load）</span>
            {done && <CheckCircle2 size={14} className="text-green-500" />}
            {failed && <XCircle size={14} className="text-red-500" />}
          </div>
          <span className="text-xs font-mono text-slate-500 shrink-0">
            {loadBytes
              ? `${fmtBytes(loadBytes.current)} / ${fmtBytes(loadBytes.total)}`
              : uploading
                ? "等待上传"
                : done
                  ? "已完成"
                  : "解包中"}
          </span>
        </div>
        <ProgressBar value={failed ? null : loadPct} tone={failed ? "red" : done ? "green" : "blue"} />
      </div>

      {/* docker load 实时输出 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500">导入输出</span>
          <span className="text-xs font-mono text-slate-400">{lineCount} 行</span>
        </div>
        <pre
          ref={ref}
          className="bg-slate-900 text-slate-200 rounded-lg p-3 max-h-[40vh] min-h-[140px] overflow-y-auto font-mono text-xs leading-relaxed"
        >
          {lineCount === 0 ? (
            <span className="text-slate-400">
              {uploading ? "上传中…（docker load 将在数据到达后开始输出）\n" : "等待 docker load 输出…\n"}
            </span>
          ) : (
            state.lines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                {line}
              </div>
            ))
          )}
        </pre>
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        {!done && !failed && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
          >
            <XCircle size={14} /> 取消导入
          </button>
        )}
        {(done || failed) && (
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
          >
            关闭
          </button>
        )}
      </div>
    </div>
  );
}

export function Images({ images, loading, error, engineId, onRefresh, defaultVisibleColumns, onCheckAllUpdates, onCheckImageUpdate, checkingUpdates, imageUpdateStatus, imageUpdateError }: ImagesProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "dangling" | "used" | "unused">("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmCleanUnused, setConfirmCleanUnused] = useState(false);
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
      lines.push("无需清理（没有可删除的悬空或未使用镜像）");
    } else {
      lines.push(`已删除 ${deleted.length} 个镜像：`);
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

  // ===== 镜像导出（下载）/ 导入（上传）状态 =====
  /** 正在导出的镜像引用（行内按钮转圈），null 表示空闲 */
  const [downloadingImage, setDownloadingImage] = useState<string | null>(null);
  /** 导入（上传）镜像的进度状态；null = 未在导入、弹窗关闭 */
  const [imageImport, setImageImport] = useState<ImageImportState | null>(null);
  /** 导入的取消句柄：abort XHR → 请求体中断 → 服务端随之结束 docker load 子进程 */
  const importAbortRef = useRef<AbortController | null>(null);
  const imageFileRef = useRef<HTMLInputElement>(null);
  /** 导入弹窗是否打开（含终态，此时工具按钮保持禁用，避免并发第二个导入） */
  const importOpen = imageImport !== null;
  /** 导入是否仍在进行（上传中 / 解包中） */
  const importRunning =
    imageImport !== null && (imageImport.phase === "uploading" || imageImport.phase === "loading");

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

  /**
   * （已迁出到模块顶层 parsePullTailSizes / fmtBytes / PullOutputPanel，
   * 此处保留注释防止后续误加回内部重复定义）
   */

  /** 当前弹窗关注的任务（从轮询列表中取，保证实时） */
  const activePullTask = useMemo(
    () => pullTasks.find((t) => t.id === activePullTaskId) || null,
    [pullTasks, activePullTaskId],
  );

  /**
   * 发起拉取：调 API 创建任务，成功后切换到进度视图。
   * imageOverride 用于「重试」——直接用失败任务的镜像名再拉一次，不依赖输入框。
   */
  const [pullStarting, setPullStarting] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const startPull = async (imageOverride?: string) => {
    const image = (imageOverride ?? pullPrefill).trim();
    if (!engineId || !image) return;
    setPullStarting(true);
    setPullError(null);
    setShowPullModal(true);
    setActivePullTaskId(null);
    try {
      const task = await startImagePullApi(engineId, image);
      setActivePullTaskId(task.id);
      // 立即刷新任务列表
      const list = await fetchPullTasksApi(engineId);
      setPullTasks(list);
      addOpLog({ action: "拉取镜像", target: image, status: "success", engineId });
    } catch (e: any) {
      setPullError(e.message || "启动拉取失败");
      addOpLog({ action: "拉取镜像", target: image, status: "failed", detail: e.message || "启动失败", engineId });
    } finally {
      setPullStarting(false);
    }
  };

  /** 拉取失败重试：用失败任务的镜像名直接重发拉取 */
  const retryPull = (image: string) => {
    setPullPrefill(image);
    void startPull(image);
  };

  /**
   * 导出（下载）镜像为 tar。
   * 走 fetch → Blob → objectURL（与备份下载同一套），失败能拿到错误提示，
   * 不会像 `<a href="/api/...">` 那样点了没反应。
   */
  const handleDownloadImage = async (imageRef: string) => {
    if (!engineId || downloadingImage) return;
    setDownloadingImage(imageRef);
    try {
      const filename = await downloadImageApi(engineId, imageRef);
      addOpLog({ action: "导出镜像", target: displayImageRef(imageRef), status: "success", detail: filename, engineId });
    } catch (e: any) {
      addOpLog({ action: "导出镜像", target: displayImageRef(imageRef), status: "failed", detail: e.message || "导出失败", engineId });
      showOutput({ title: "导出镜像", name: displayImageRef(imageRef), output: e.message || "导出失败", failed: true });
    } finally {
      setDownloadingImage(null);
    }
  };

  /**
   * 导入（上传）镜像 tar：服务端流式管道进 docker load，全程显示两阶段进度。
   *
   * 进度面板取代了原先「转圈 + 结果弹窗」：上传阶段用 XHR 的精确字节，
   * 解包阶段用服务端逐行下发的 docker load 输出，两者在同一个弹窗里连续呈现。
   */
  const handleUploadImage = async (file: File) => {
    if (!engineId || importOpen) return;
    const controller = new AbortController();
    importAbortRef.current = controller;
    setImageImport({
      fileName: file.name,
      fileSize: file.size,
      sent: 0,
      total: file.size,
      phase: "uploading",
      lines: [],
      images: [],
    });
    try {
      const result = await uploadImageApi(
        engineId,
        file,
        {
          onUploadProgress: (sent, total) =>
            setImageImport((prev) => (prev ? { ...prev, sent, total: total > 0 ? total : prev.total } : prev)),
          onUploadDone: () => setImageImport((prev) => (prev ? { ...prev, phase: "loading" } : prev)),
          onLoadOutput: (lines) =>
            setImageImport((prev) => (prev ? { ...prev, lines: [...prev.lines, ...lines] } : prev)),
        },
        controller.signal
      );
      setImageImport((prev) =>
        prev
          ? {
              ...prev,
              phase: "done",
              images: result.images,
              // 兜底：反代缓冲导致流式行没收到时，用最终合并输出补全，避免输出区空白
              lines: prev.lines.length === 0 && result.output ? result.output.split(/\r?\n/).filter(Boolean) : prev.lines,
            }
          : prev
      );
      addOpLog({
        action: "导入镜像",
        target: file.name,
        status: "success",
        detail: result.images.join(", ") || "导入完成",
        engineId,
      });
      onRefresh?.();
    } catch (e: any) {
      const msg = e?.message || "导入失败";
      setImageImport((prev) => (prev ? { ...prev, phase: "error", error: msg } : prev));
      addOpLog({ action: "导入镜像", target: file.name, status: "failed", detail: msg, engineId });
    } finally {
      importAbortRef.current = null;
      // 允许重复选择同一个文件（否则第二次 change 不触发）
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  };

  /** 取消导入：中断上传，服务端随之结束 docker load */
  const cancelImageImport = () => {
    importAbortRef.current?.abort();
  };

  /** 关闭进度弹窗（防御性：万一仍在进行也一并取消，避免留下无 UI 的后台请求） */
  const closeImageImport = () => {
    importAbortRef.current?.abort();
    setImageImport(null);
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

  const handlePruneUnused = async () => {
    if (!engineId) return;
    setPruning(true);
    setPruneError(null);
    try {
      const result = await pruneImagesApi(engineId, true);
      addOpLog({ action: "清理未使用镜像", target: "全部未使用镜像", status: "success", engineId });
      showOutput({ title: "清理未使用镜像", name: "全部未使用镜像", output: formatImagePrune(result) });
      setConfirmCleanUnused(false);
      onRefresh?.();
    } catch (e: any) {
      addOpLog({ action: "清理未使用镜像", target: "全部未使用镜像", status: "failed", detail: e.message || "清理失败", engineId });
      showOutput({ title: "清理未使用镜像", name: "全部未使用镜像", output: e.message || "清理失败", failed: true });
      setConfirmCleanUnused(false);
    } finally {
      setPruning(false);
    }
  };

  type ColumnKey = "repository" | "tag" | "id" | "size" | "createdAt" | "updateStatus" | "associatedContainers" | "sha256" | "actions";
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "repository", label: "仓库名" },
    { key: "tag", label: "标签" },
    { key: "id", label: "镜像 ID" },
    { key: "size", label: "大小" },
    { key: "createdAt", label: "创建时间" },
    { key: "updateStatus", label: "更新状态" },
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
  const isUnused = (i: typeof images[number]) => i.associatedContainers.length === 0;
  const unusedCount = images.filter(isUnused).length;
  const unusedSize = images.filter(isUnused).reduce((sum, img) => {
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
          <button
            onClick={() => imageFileRef.current?.click()}
            disabled={importOpen || !engineId}
            title="上传 docker save 导出的 tar 文件并导入到该引擎"
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importRunning ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {importRunning ? "导入中..." : "上传镜像"}
          </button>
          <input
            ref={imageFileRef}
            type="file"
            accept=".tar,.tar.gz,.tgz,application/x-tar"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUploadImage(f);
            }}
          />
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
            disabled={unusedCount === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} /> 清理未使用 ({unusedCount})
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

      {/* 镜像版本检查结果：有更新数量 / 全部最新 / 失败原因 */}
      {(imageUpdateStatus || imageUpdateError) && (
        <div
          className={`rounded-xl border shadow-sm p-3 flex items-start gap-2 text-sm ${
            imageUpdateError
              ? "bg-red-50 border-red-200 text-red-700"
              : (imageUpdateStatus?.updates ?? 0) > 0
              ? "bg-amber-50 border-amber-200 text-amber-700"
              : "bg-green-50 border-green-200 text-green-700"
          }`}
        >
          {imageUpdateError || (imageUpdateStatus?.updates ?? 0) > 0 ? (
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          ) : (
            <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            {imageUpdateError ? (
              <span>检查更新失败：{imageUpdateError}</span>
            ) : (
              <span>
                {(imageUpdateStatus?.updates ?? 0) > 0
                  ? `${imageUpdateStatus!.updates} 个镜像有可用更新（已检查 ${imageUpdateStatus!.checked} 个）`
                  : `全部镜像均为最新（已检查 ${imageUpdateStatus!.checked} 个）`}
                <span className="opacity-70"> · {new Date(imageUpdateStatus!.at).toLocaleString("zh-CN")}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 拉取任务条：进行中 + 最近完成的任务（后台拉取也在此展示） */}
      {visiblePullTasks.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Download size={14} className="text-blue-500" />
            <span className="text-xs font-semibold text-slate-600">镜像拉取任务</span>
          </div>
          {visiblePullTasks.map((t) => {
            const bytes = parsePullTailSizes(t.outputTail);
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
                {t.status === "pulling" && bytes && (
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    {fmtBytes(bytes.current)}{bytes.total > 0 ? ` / ${fmtBytes(bytes.total)}` : ""}
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
                {t.status === "error" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); retryPull(t.image); }}
                    className="flex items-center gap-1 px-2 py-0.5 text-xs text-blue-600 border border-blue-200 rounded hover:bg-blue-50 whitespace-nowrap"
                  >
                    <RotateCcw size={11} /> 重试
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
                {visibleColumns.has("updateStatus") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">更新状态</th>}
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
                  {visibleColumns.has("updateStatus") && (() => {
                    const st = imageUpdateStatus?.byRef[`${img.repository}:${img.tag}`];
                    return (
                      <td className="px-3 py-3 whitespace-nowrap">
                        {st === undefined ? (
                          <span className="text-xs text-slate-300">未检查</span>
                        ) : st ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                            <AlertTriangle size={12} /> 有更新
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-green-600">
                            <CheckCircle2 size={12} /> 最新
                          </span>
                        )}
                      </td>
                    );
                  })()}
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
                            {
                              label: downloadingImage === buildImageRef(img) ? "导出中..." : "下载镜像",
                              icon: <ImageDown size={14} />,
                              disabled: !!downloadingImage,
                              onClick: () => handleDownloadImage(buildImageRef(img)),
                            },
                            {
                              label: "检查更新",
                              icon: <RefreshCw size={14} />,
                              disabled: !onCheckImageUpdate,
                              onClick: () => onCheckImageUpdate?.(`${img.repository}:${img.tag}`),
                            },
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
        open={confirmCleanUnused}
        onClose={() => { setConfirmCleanUnused(false); setPruneError(null); }}
        onConfirm={() => { handlePruneUnused(); }}
        title="清理未使用镜像"
        message={`将删除 ${unusedCount} 个未被容器引用的镜像（含悬空），释放约 ${unusedSize.toFixed(0)} MB 空间。此操作不可撤销，正在运行的容器依赖的镜像不会被删除。`}
        confirmText="清理"
        danger
        loading={pruning}
        errorMessage={pruneError}
      />

      {/* 命令输出弹窗（清理镜像的 tail 文本） */}
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
                onClick={() => startPull()}
                disabled={!pullPrefill.trim() || pullStarting}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {pullStarting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {pullStarting ? "启动中..." : "开始拉取"}
              </button>
            </div>
          </div>
        )}

        {/* 情况二：拉取进行中 — tail 文本是唯一进度展示 */}
        {activePullTask && activePullTask.status === "pulling" && (
          <div className="p-6 space-y-3">
            <PullOutputPanel task={activePullTask} />
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

            <PullOutputPanel task={activePullTask} />

            <div className="flex items-center justify-end gap-2 pt-2">
              {activePullTask.status === "error" && (
                <button
                  onClick={() => retryPull(activePullTask.image)}
                  disabled={pullStarting}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {pullStarting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  {pullStarting ? "重试中..." : "重试"}
                </button>
              )}
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

      {/* ===== 镜像导入（上传 tar）进度弹窗 ===== */}
      <Modal
        open={importOpen}
        onClose={closeImageImport}
        title={imageImport ? `导入镜像 — ${imageImport.fileName}` : "导入镜像"}
        size="lg"
        dismissable={false}
      >
        {imageImport && (
          <ImageImportPanel state={imageImport} onCancel={cancelImageImport} onClose={closeImageImport} />
        )}
      </Modal>
    </div>
  );
}
