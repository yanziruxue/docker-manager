import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
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
  Lock,
  Unlock,
} from "lucide-react";
import type { DockerImage, PullTask, ImageUpdateStatusView, ImageLock } from "../types";
import { Tag } from "../components/Badge";
import { ConfirmDialog, Modal } from "../components/Modal";
import { CmdOutputModal, useCmdOutput } from "../components/CmdOutputModal";
import { EmptyState, IconButton } from "../components/UI";
import { ContextMenu, type MenuItem } from "../components/ContextMenu";
import { LoadingState, ErrorState } from "../components/DataState";

import {
  removeImageApi,
  pruneImagesApi,
  startImagePullApi,
  fetchPullTasksApi,
  fetchPullTaskApi,
  cancelPullTaskApi,
  removePullTaskApi,
  downloadImageApi,
  uploadImageApi,
  fetchImageLocksApi,
  setImageLockApi,
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
  /**
   * 镜像删除成功后的**本地即时移除**回调（乐观更新，v1.43.21）。
   * 背景：onRefresh 走 loadEngineData 需并行等 5 个请求全部返回才 setImages，
   * 任一请求挂起 ⇒ 列表停留旧数据（已删镜像仍显示，手动刷新才消失）。
   * 先本地移除被删镜像保证 UI 即时更新，随后的 onRefresh 再与服务端对账。
   */
  onImagesRemoved?: (ids: string[]) => void;
  defaultVisibleColumns?: string[];
  /**
   * 「仓库 registry 地址」显隐的初始值（系统设置 → 列显隐 → 镜像管理，v1.42.15）。
   * true = 隐藏 registry 地址前缀（默认）；false = 原样显示完整仓库名。
   * 页内工具栏「列」下拉的「仓库 registry 地址」项以此为初值、会话级切换（v1.42.18），
   * 不回写服务端；设置页开关仍是持久化入口。
   */
  hideRepoRegistryInit?: boolean;
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
 * 仓库名隐藏 registry 地址前缀（v1.42.15，系统设置 → 列显隐 → 镜像管理 控制）。
 * 判定沿用 Docker 自身规则：`/` 前首段含「.」或「:」、或为 `localhost` ⇒ 视为 registry 主机名并剥掉。
 *   docker.1panel.live/gitea/gitea ⇒ gitea/gitea
 *   registry:5000/foo/bar         ⇒ foo/bar
 *   localhost/foo                 ⇒ foo
 *   gitea/gitea / nginx / library/nginx ⇒ 原样（无主机名）
 * 悬空镜像 `<none>`、空串、剥完为空（如裸 `localhost/`）时原样返回，绝不显示空仓库名。
 */
function stripRegistryHost(repo: string): string {
  const raw = repo?.trim() || "";
  if (!raw || raw === "<none>") return raw;
  const slash = raw.indexOf("/");
  if (slash <= 0) return raw; // 无斜杠或斜杠开头 ⇒ 无主机名可剥
  const head = raw.slice(0, slash);
  const isHost = head === "localhost" || head.includes(".") || head.includes(":");
  if (!isHost) return raw;
  const rest = raw.slice(slash + 1);
  return rest ? rest : raw;
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
 * 拉取进度弹窗的**自动关闭倒计时**（秒）。
 *
 * 何时自动关闭：
 *  - `success`（拉取成功）与 `canceled`（已取消）⇒ 倒计时结束自动关闭，并刷新镜像列表；
 *  - `error`（拉取失败）⇒ **不自动关闭** —— 弹窗里有「重试」按钮和失败原因，
 *    自动关掉等于把用户刚要看的错误信息收走、还得重新拉一次；
 *  - `pulling` ⇒ 不关。
 *
 * 关闭前会显示剩余秒数并提供「立即关闭」，不做「突然消失」。
 */
const PULL_AUTO_CLOSE_SECONDS = 5;

/**
 * 该任务状态是否应当自动关闭拉取弹窗。
 *
 * 规则（抽成纯函数便于断言，避免埋在 effect 条件里悄悄改掉）：
 *  - `success`  拉取成功 ⇒ 关。结果不会丢：左侧任务列表仍显示该任务状态，关闭时还会刷新镜像列表。
 *  - `canceled` 已取消   ⇒ 关。用户是主动取消的，没有需要阅读的信息。
 *  - `error`    拉取失败 ⇒ **不关**。弹窗里有失败原因和「重试」按钮，
 *               自动关掉等于把用户刚要看的错误收走、还得重新拉一次。
 *  - `pulling` / 空     ⇒ 不关。
 */
export function shouldAutoClosePullModal(status?: string | null): boolean {
  return status === "success" || status === "canceled";
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

export function Images({ images, loading, error, engineId, onRefresh, onImagesRemoved, defaultVisibleColumns, hideRepoRegistryInit = true, onCheckAllUpdates, onCheckImageUpdate, checkingUpdates, imageUpdateStatus, imageUpdateError }: ImagesProps) {
  const [search, setSearch] = useState("");
  // 搜索框 ref：非受控模式，原生事件直读 DOM 值（见下方 useEffect 注释）
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 搜索框非受控化：受控 onChange 在中文输入法组合态下会静默失效
  // （框里有字、state 仍是空串，Enter/失焦也无法补救，列表永不过滤）。
  // 改用原生 input/compositionend 事件直读 DOM value 同步 state，
  // 绕开 React 合成事件系统，任何输入法/浏览器环境下都能生效。
  useEffect(() => {
    const el = searchInputRef.current;
    if (!el) return;
    const sync = () => setSearch(el.value);
    el.addEventListener("input", sync);
    el.addEventListener("compositionend", sync);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("compositionend", sync);
    };
  }, []);
  // 分类只有「使用中 / 未使用」；悬空不再单列，归入未使用
  const [filter, setFilter] = useState<"all" | "used" | "unused">("all");
  const [confirmDelete, setConfirmDelete] = useState<{ ref: string; id: string } | null>(null);
  const [confirmCleanUnused, setConfirmCleanUnused] = useState(false);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** 删除冲突类型：多仓库引用时可显示「强制删除」，被容器占用时只提示 */
  const [forceDeleteAvailable, setForceDeleteAvailable] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [pruneError, setPruneError] = useState<string | null>(null);
  /** 不被清理的镜像列表（服务端持久化，换浏览器也生效） */
  const [locks, setLocks] = useState<ImageLock[]>([]);
  /** 正在切换不被清理状态的镜像 sha256，用于按钮 loading */
  const [lockBusy, setLockBusy] = useState<string | null>(null);
  /** 右键菜单（操作列已移除，所有操作统一走右键，v1.42.13） */
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; img: DockerImage } | null>(null);
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  // 拉取不被清理列表
  useEffect(() => {
    if (!engineId) { setLocks([]); return; }
    let canceled = false;
    fetchImageLocksApi(engineId)
      .then((list) => { if (!canceled) setLocks(Array.isArray(list) ? list : []); })
      .catch(() => { if (!canceled) setLocks([]); });
    return () => { canceled = true; };
  }, [engineId]);

  /** 把 dockerode pruneImages 的返回格式化为 tail 文本 */
  const formatImagePrune = (result: any): string => {
    if (!result) return "（无输出）";
    const deleted = Array.isArray(result.ImagesDeleted) ? result.ImagesDeleted : [];
    const space = typeof result.SpaceReclaimed === "number" ? result.SpaceReclaimed : 0;
    const locked = typeof result.Locked === "number" ? result.Locked : 0;
    const lines: string[] = [];
    if (deleted.length === 0) {
      lines.push("无需清理（没有可删除的未使用镜像）");
    } else {
      lines.push(`已删除 ${deleted.length} 个镜像：`);
      for (const d of deleted) {
        lines.push(`- ${d.Deleted || d.Untagged || JSON.stringify(d)}`);
      }
    }
    if (locked > 0) lines.push(`已跳过 ${locked} 个标记为「不被清理」的镜像（取消标记后才会被清理）`);
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

  /**
   * 手动清理任务条上的拉取任务（第二种清理方式，前后端同时移除）。
   * 先本地摘掉，避免要等下一次轮询才消失；调用失败则重新拉列表校正回真实状态。
   * 若清掉的正是详情弹窗关注的任务，一并清空 activePullTaskId（否则弹窗会退回新建表单）。
   */
  const removePullFromBar = async (taskId: string) => {
    if (!engineId) return;
    setPullTasks((prev) => prev.filter((t) => t.id !== taskId));
    setActivePullTaskId((cur) => (cur === taskId ? null : cur));
    try {
      await removePullTaskApi(engineId, taskId);
    } catch {
      try {
        const list = await fetchPullTasksApi(engineId);
        setPullTasks(list);
      } catch { /* 引擎离线等瞬时错误忽略 */ }
    }
  };

  /**
   * 拉取任务条展示范围：进行中 + 30 分钟内结束的任务。
   * 30 分钟与后端 `PULL_TASK_TTL` 严格对齐 —— 到期由后端惰性清理，前端不再提前隐藏，
   * 保证「后端还留着，前端就看得见」；手动清理走行尾「×」（前后端同时删）。
   * 不做条数截断：截断会让保留期形同虚设（任务静默消失且无从清理）。
   */
  const visiblePullTasks = useMemo(() => {
    const now = Date.now();
    return pullTasks.filter(
      (t) => t.status === "pulling" || (t.endedAt && now - t.endedAt < 30 * 60 * 1000)
    );
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

  // ============ 拉取完成 → 自动关闭弹窗 ============
  // 设计：用「关闭时刻戳」而非「递减计数器」驱动，避免在 setState 更新函数里做副作用
  //（React 严格模式下更新函数可能被调用两次 ⇒ 关闭/onRefresh 会重复执行）。
  const [autoCloseAt, setAutoCloseAt] = useState<number | null>(null);
  const [autoCloseLeft, setAutoCloseLeft] = useState(0);

  /** 关闭拉取弹窗：清状态 + 刷新镜像列表（手动关闭与自动关闭共用同一条路径） */
  const closePullModal = useCallback(() => {
    setShowPullModal(false);
    setActivePullTaskId(null);
    setAutoCloseAt(null);
    setAutoCloseLeft(0);
    onRefresh?.();
  }, [onRefresh]);

  // ① 进入终态（成功 / 已取消）时设定关闭时刻；拉取中或失败则撤销倒计时
  useEffect(() => {
    if (!showPullModal || !shouldAutoClosePullModal(activePullTask?.status)) {
      setAutoCloseAt(null);
      setAutoCloseLeft(0);
      return;
    }
    setAutoCloseLeft(PULL_AUTO_CLOSE_SECONDS);
    setAutoCloseAt(Date.now() + PULL_AUTO_CLOSE_SECONDS * 1000);
    // ⚠️ 依赖只放「是否进入终态」相关的值：刻意不放 autoCloseLeft / closePullModal，
    //    否则倒计时每跳一次就会重建定时器，永远走不到 0。
  }, [showPullModal, activePullTask?.id, activePullTask?.status]);

  // ② 每 500ms 刷新剩余秒数，归零后自动关闭
  useEffect(() => {
    if (autoCloseAt === null) return;
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((autoCloseAt - Date.now()) / 1000));
      setAutoCloseLeft(left);
      if (left <= 0) {
        clearInterval(timer);
        closePullModal();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [autoCloseAt, closePullModal]);

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

  // 导入成功后自动关闭弹窗（短暂展示「导入成功」后收起，无需手动关闭）
  useEffect(() => {
    if (imageImport?.phase === "done") {
      const t = setTimeout(() => closeImageImport(), 1500);
      return () => clearTimeout(t);
    }
  }, [imageImport?.phase, closeImageImport]);

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

  const handleRemoveImage = async (imageRef: string, force = false, imageId?: string) => {
    if (!engineId) return;
    setDeleting(true);
    setDeleteError(null);
    setForceDeleteAvailable(false);
    try {
      await removeImageApi(engineId, imageRef, force);
      addOpLog({ action: force ? "强制删除镜像" : "删除镜像", target: displayImageRef(imageRef), status: "success", engineId });
      setConfirmDelete(null);
      // 先本地即时移除（不等 5 请求全返回），再服务端刷新对账
      if (imageId) {
        onImagesRemoved?.([imageId]);
        setSelected((prev) => {
          if (!prev.has(imageId)) return prev;
          const next = new Set(prev);
          next.delete(imageId);
          return next;
        });
      }
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

  /** 标记 / 取消「不被清理」：被标记为不被清理的镜像在「清理未使用」时会被跳过 */
  const handleToggleLock = async (img: DockerImage) => {
    if (!engineId) return;
    const key = img.sha256 || img.id;
    // 悬空镜像无有效引用，只按 ID 标记为不被清理
    const ref = img.isDangling ? "" : `${img.repository}:${img.tag}`;
    const nextLocked = !isLocked(img);
    setLockBusy(key);
    try {
      const list = await setImageLockApi(engineId, { id: key, ref, locked: nextLocked });
      setLocks(Array.isArray(list) ? list : []);
      addOpLog({
        action: nextLocked ? "标记为不被清理" : "允许清理",
        target: buildImageRef(img),
        status: "success",
        engineId,
      });
    } catch (e: any) {
      showOutput({
        title: nextLocked ? "标记为不被清理" : "允许清理",
        name: buildImageRef(img),
        output: e.message || "操作失败",
        failed: true,
      });
    } finally {
      setLockBusy(null);
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

  // ===== 批量操作（镜像）=====
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // v1.43.18：镜像更新检查结果不再以内嵌横幅展示（横幅已移除），改为：
  //  1) 汇总进「通知中心」—— 服务端 /api/engines/:id/activity 派生一条汇总活动；
  //  2) 手动检查（检查全部 / 单镜像）完成后，下方 showCheckResult 弹窗提示明细。
  const [showCheckResult, setShowCheckResult] = useState(false);
  const manualCheckPending = useRef(false);
  // 手动检查完成（checkingUpdates 由 true 落回 false）即弹出结果明细弹窗
  useEffect(() => {
    if (manualCheckPending.current && !checkingUpdates) {
      manualCheckPending.current = false;
      setShowCheckResult(true);
    }
  }, [checkingUpdates]);
  // 弹窗所需的汇总数据（取最近一次检查结果）
  const checkResult = imageUpdateStatus
    ? {
        checked: imageUpdateStatus.checked,
        updates: imageUpdateStatus.updates,
        upToDate: Math.max(0, imageUpdateStatus.checked - imageUpdateStatus.updates),
        at: imageUpdateStatus.at,
      }
    : null;
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState<{ current: number; total: number; ref: string } | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);

  const toggleSelect = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const selectedImages = useMemo(() => images.filter((i) => selected.has(i.id)), [images, selected]);

  /** 批量标记 / 取消不被清理：逐条调用 setImageLockApi，刷新不被清理列表 */
  const batchLock = async (lock: boolean) => {
    if (!engineId || selected.size === 0) return;
    setBatchBusy(true);
    try {
      let cur = locks;
      for (const img of selectedImages) {
        const key = img.sha256 || img.id;
        const ref = img.isDangling ? "" : `${img.repository}:${img.tag}`;
        const list = await setImageLockApi(engineId, { id: key, ref, locked: lock });
        if (Array.isArray(list)) cur = list;
      }
      setLocks(cur);
      addOpLog({ action: lock ? "批量标记为不被清理" : "批量允许清理", target: `${selectedImages.length} 个镜像`, status: "success", engineId });
      setSelected(new Set());
    } catch (e: any) {
      showOutput({ title: lock ? "批量标记为不被清理" : "批量允许清理", name: `${selectedImages.length} 个镜像`, output: e.message || "操作失败", failed: true });
    } finally {
      setBatchBusy(false);
    }
  };

  /** 批量删除：跳过被容器占用的镜像（in-use），逐个删除并汇总成功/失败/跳过 */
  const batchDelete = async () => {
    if (!engineId || selected.size === 0) return;
    setBatchBusy(true);
    const lines: string[] = [];
    let ok = 0, fail = 0, skipped = 0;
    // 同一镜像多 tag 拆成多行（同 id）⇒ 删除按镜像粒度去重：
    // 否则第一个 tag 删掉后镜像已不存在，第二个 tag 的删除调用必失败（v1.43.12）。
    const seenIds = new Set<string>();
    const removedIds: string[] = [];
    try {
      for (const img of selectedImages) {
        if (seenIds.has(img.id)) continue;
        seenIds.add(img.id);
        const ref = buildImageRef(img);
        if (img.associatedContainers.length > 0) { skipped++; lines.push(`- 跳过（使用中）: ${displayImageRef(ref)}`); continue; }
        try {
          await removeImageApi(engineId, ref);
          ok++; removedIds.push(img.id); lines.push(`✓ ${displayImageRef(ref)}`);
        } catch (e: any) {
          fail++; lines.push(`✗ ${displayImageRef(ref)}: ${e.message || "删除失败"}`);
        }
      }
      lines.unshift(`删除成功 ${ok} 个，失败 ${fail} 个，跳过（使用中）${skipped} 个`);
      addOpLog({ action: "批量删除镜像", target: `${ok} 个`, status: fail > 0 ? "failed" : "success", engineId });
      showOutput({ title: "批量删除镜像", name: `${ok} 个`, output: lines.join("\n"), failed: fail > 0 });
      setConfirmBatchDelete(false);
      setSelected(new Set());
      // 先本地即时移除已删镜像（不等 5 请求全返回），再服务端刷新对账
      if (removedIds.length > 0) onImagesRemoved?.(removedIds);
      onRefresh?.();
    } finally {
      setBatchBusy(false);
    }
  };

  /** 批量拉取：逐个发起 pull 任务（任务条可见），不弹窗 */
  const batchPull = async () => {
    if (!engineId || selected.size === 0) return;
    setBatchBusy(true);
    const lines: string[] = [];
    let ok = 0, fail = 0;
    try {
      for (const img of selectedImages) {
        const ref = buildImageRef(img);
        try { await startImagePullApi(engineId, ref); ok++; lines.push(`✓ ${ref}`); }
        catch (e: any) { fail++; lines.push(`✗ ${ref}: ${e.message || "拉取失败"}`); }
      }
      lines.unshift(`已发起拉取 ${ok} 个，失败 ${fail} 个`);
      addOpLog({ action: "批量拉取镜像", target: `${ok} 个`, status: fail > 0 ? "failed" : "success", engineId });
      showOutput({ title: "批量拉取镜像", name: `${ok} 个`, output: lines.join("\n"), failed: fail > 0 });
      setSelected(new Set());
    } finally {
      setBatchBusy(false);
    }
  };

  /** 批量下载（导出）镜像：逐个串行下载，避免并发打满 */
  const batchDownload = async () => {
    if (!engineId || selected.size === 0) return;
    setBatchBusy(true);
    const lines: string[] = [];
    let ok = 0, fail = 0;
    try {
      const list = selectedImages;
      for (let i = 0; i < list.length; i++) {
        const img = list[i];
        const ref = buildImageRef(img);
        setBatchDownloading({ current: i + 1, total: list.length, ref });
        try { await downloadImageApi(engineId, ref); ok++; lines.push(`✓ ${displayImageRef(ref)}`); }
        catch (e: any) { fail++; lines.push(`✗ ${displayImageRef(ref)}: ${e.message || "导出失败"}`); }
      }
      lines.unshift(`导出成功 ${ok} 个，失败 ${fail} 个`);
      addOpLog({ action: "批量导出镜像", target: `${ok} 个`, status: fail > 0 ? "failed" : "success", engineId });
      showOutput({ title: "批量导出镜像", name: `${ok} 个`, output: lines.join("\n"), failed: fail > 0 });
      setSelected(new Set());
    } finally {
      setBatchDownloading(null);
      setBatchBusy(false);
    }
  };

  // 操作列已移除（v1.42.13）：所有操作统一走行右键菜单
  type ColumnKey = "repository" | "tag" | "id" | "size" | "createdAt" | "updateStatus" | "associatedContainers" | "sha256";
  // 「仓库名」列常驻不可隐藏（v1.42.17）：不进 allColumns ⇒ 页内「列」下拉无该项；
  // 初始集合由下方 defaultSet.add("repository") 强制补回，旧设置里曾被取消勾选的也能恢复
  const allColumns: { key: ColumnKey; label: string }[] = [
    { key: "tag", label: "标签" },
    { key: "id", label: "镜像 ID" },
    { key: "size", label: "大小" },
    { key: "createdAt", label: "创建时间" },
    { key: "updateStatus", label: "更新状态" },
    { key: "associatedContainers", label: "关联容器" },
    { key: "sha256", label: "SHA-256" },
  ];

  // 「SHA-256」列默认不显示（v1.42.19）：未保存过列显隐设置的用户，默认集合不含 sha256
  // （列太长且极少用到；需要时可在页内「列」下拉或设置 → 列显隐 手动勾选）。
  // 已保存过列选择的用户走 stored 分支，尊重其既有勾选（保存过 sha256 的仍显示）
  const defaultSet = defaultVisibleColumns && defaultVisibleColumns.length > 0
    ? new Set(defaultVisibleColumns as ColumnKey[])
    : new Set(allColumns.filter(c => c.key !== "sha256").map(c => c.key));
  // 「仓库名」为镜像主标识列：常驻显示、不可隐藏（v1.42.17）——
  // 无论旧设置是否勾选过该列，初始集合强制包含，保证镜像列表主标识始终可见
  defaultSet.add("repository");

  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(defaultSet);

  // 「仓库 registry 地址」显隐（v1.42.18）：工具栏「列」下拉新增项「仓库 registry 地址」——
  // 勾选 = 显示完整仓库地址（含 registry 前缀）；不勾选 = 隐藏前缀只显示短名（gitea/gitea）。
  // 初始值取服务端设置（缺省隐藏），页内切换为会话级，不写 settings（设置页开关仍是持久化入口）
  const [hideRepoRegistry, setHideRepoRegistry] = useState(hideRepoRegistryInit);

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
    const kw = search.toLowerCase();
    return images.filter((img) => {
      // 仓库名同时按「完整地址」与「隐藏 registry 后的短名」匹配——
      // 表头显示短名时用户按看到的文案搜也要能命中（v1.42.15）
      const repo = img.repository.toLowerCase();
      const repoShort = hideRepoRegistry ? stripRegistryHost(img.repository).toLowerCase() : repo;
      const matchSearch = repo.includes(kw) || repoShort.includes(kw) || img.tag.toLowerCase().includes(kw);
      let matchFilter = true;
      if (filter === "used") matchFilter = img.associatedContainers.length > 0;
      // 「未使用」= 无任何容器引用；悬空镜像已归入此分类（不再单列）
      else if (filter === "unused") matchFilter = img.associatedContainers.length === 0;
      return matchSearch && matchFilter;
    });
  }, [images, search, filter, hideRepoRegistry]);

  // ⚠️ 勾选按「镜像」粒度计：transformImages 按 RepoTag 拆行 ⇒ 同一镜像 id 多行。
  // 全选/取消判断必须走 id 维度——早期版本用 `selected.size === filtered.length`
  // 比「去重后 id 数」与「行数」，多 tag 镜像存在时永不相等 ⇒ 全选后点标题行
  // 复选框只会重复全选、无法取消（v1.43.12 修复）。
  const filteredIds = useMemo(() => new Set(filtered.map((i) => i.id)), [filtered]);
  const allFilteredSelected = filteredIds.size > 0 && [...filteredIds].every((id) => selected.has(id));
  const someFilteredSelected = [...filteredIds].some((id) => selected.has(id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      // 取消：仅移除当前筛选结果覆盖的 id，保留筛选范围外已勾选的镜像
      const next = new Set(selected);
      for (const id of filteredIds) next.delete(id);
      setSelected(next);
    } else {
      // 全选：合并入已选（不清空筛选范围外的选择）
      setSelected(new Set([...selected, ...filteredIds]));
    }
  };

  const totalSize = images.reduce((sum, img) => {
    const num = parseFloat(img.size);
    if (img.size.includes("GB")) return sum + num * 1024;
    return sum + num;
  }, 0);

  /** MB 数值（用于汇总） */
  const sizeMB = (img: typeof images[number]) => {
    const num = parseFloat(img.size);
    if (isNaN(num)) return 0;
    return img.size.includes("GB") ? num * 1024 : num;
  };
  /** 按镜像 ID 去重：多 tag 镜像只算一个（Docker 按 ID 整体删除） */
  const uniqImageCount = (list: typeof images) =>
    new Set(list.map((i) => i.sha256 || i.id)).size;

  const isUnused = (i: typeof images[number]) => i.associatedContainers.length === 0;
  /** 未使用总数（**包含已被标记为不被清理项**，与筛选标签数字一致） */
  const unusedCount = images.filter(isUnused).length;
  const unusedSize = images.filter(isUnused).reduce((sum, img) => sum + sizeMB(img), 0);

  /** 该镜像是否已被标记为不被清理：镜像 ID 命中，或 repo:tag 命中 */
  const isLocked = (img: typeof images[number]) =>
    locks.some(
      (l) => (!!l.id && l.id === img.sha256) || (!!l.ref && l.ref === `${img.repository}:${img.tag}`)
    );
  /** 被标记为不被清理的镜像数（按 ID 去重） */
  const lockedCount = uniqImageCount(images.filter(isLocked));
  /** 被标记为不被清理因而会被清理跳过的未使用镜像数（按 ID 去重） */
  const lockedUnusedCount = uniqImageCount(images.filter((i) => isUnused(i) && isLocked(i)));
  /** 本次「清理未使用」实际会删除的镜像数（按 ID 去重，不含不被清理项） */
  const deletableCount = uniqImageCount(images.filter((i) => isUnused(i) && !isLocked(i)));
  const deletableSize = images
    .filter((i) => isUnused(i) && !isLocked(i))
    .reduce((sum, img) => sum + sizeMB(img), 0);
  /**
   * 本次「清理未使用」实际会删除的镜像清单（按 ID 去重，不含不被清理项）。
   * 用于确认弹窗逐条列出「有哪些会被清理」，避免误删（v1.43.4）。
   */
  const deletableList = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const img of images) {
      if (!isUnused(img) || isLocked(img)) continue;
      const key = img.sha256 || img.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`${buildImageRef(img)}  ·  ${img.size}`);
    }
    return out;
  })();

  /**
   * 镜像右键菜单（v1.42.13）：操作列已移除，原「操作」列下拉的全部条目迁到此处。
   * 与原 ActionDropdown 逐条一致：拉取 / 下载镜像 / 检查更新 / 标记为不被清理（允许清理）/ 删除。
   */
  const getImageMenuItems = (img: DockerImage): MenuItem[] => [
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
      onClick: () => {
        manualCheckPending.current = true;
        onCheckImageUpdate?.(`${img.repository}:${img.tag}`);
      },
    },
    {
      label:
        lockBusy === (img.sha256 || img.id)
          ? "处理中..."
          : isLocked(img)
            ? "允许清理（取消不被清理）"
            : "标记为不被清理",
      icon: isLocked(img) ? <Unlock size={14} /> : <Lock size={14} />,
      disabled: lockBusy === (img.sha256 || img.id),
      onClick: () => handleToggleLock(img),
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
        setConfirmDelete({ ref: buildImageRef(img), id: img.id });
      },
    },
  ];

  const filterOptions = [
    { key: "all", label: "全部", count: images.length },
    { key: "used", label: "使用中", count: images.filter((i) => i.associatedContainers.length > 0).length },
    { key: "unused", label: "未使用", count: unusedCount },
  ];

  if (loading && images.length === 0) return <LoadingState message="正在加载镜像列表..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6 space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-5 gap-4">
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
            <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center"><Layers size={18} className="text-green-500" /></div>
            <div>
              <p className="text-xs text-slate-500">使用中</p>
              <p className="text-xl font-bold text-slate-800">{images.filter((i) => i.associatedContainers.length > 0).length}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center"><AlertTriangle size={18} className="text-amber-500" /></div>
            <div>
              <p className="text-xs text-slate-500">未使用</p>
              <p className="text-xl font-bold text-slate-800">{unusedCount} <span className="text-sm font-normal text-slate-400">({unusedSize.toFixed(0)} MB)</span></p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center"><Lock size={18} className="text-slate-500" /></div>
            <div>
              <p className="text-xs text-slate-500">不被清理</p>
              <p className="text-xl font-bold text-slate-800">{lockedCount}</p>
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
              ref={searchInputRef}
              defaultValue=""
              onKeyDown={(e) => { if (e.key === "Enter") setSearch(e.currentTarget.value); }}
              onBlur={(e) => setSearch(e.currentTarget.value)}
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
                {/* 「仓库 registry 地址」项（v1.42.18）：勾选 = 显示完整地址；不勾选 = 隐藏前缀显示短名。
                    与其他列项并列在「列」下拉内，会话级切换；持久化入口仍在 设置 → 列显隐 → 镜像管理。 */}
                <div className="mt-1 border-t border-slate-100 pt-1">
                  <label
                    className="flex items-center gap-2 px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-50 rounded cursor-pointer"
                    title="勾选显示完整仓库地址（如 docker.1panel.live/gitea/gitea）；不勾选隐藏 registry 地址前缀（如 gitea/gitea）"
                  >
                    <input
                      type="checkbox"
                      checked={!hideRepoRegistry}
                      onChange={() => setHideRepoRegistry((v) => !v)}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                    />
                    仓库 registry 地址
                  </label>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setConfirmCleanUnused(true)}
            disabled={deletableCount === 0}
            title={
              lockedUnusedCount > 0
                ? `未使用共 ${unusedCount} 个，其中 ${lockedUnusedCount} 个已标记为不被清理，本次不会清理`
                : undefined
            }
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} /> 清理未使用 ({deletableCount})
          </button>
          {onCheckAllUpdates && (
            <button
              onClick={() => {
                manualCheckPending.current = true;
                onCheckAllUpdates();
              }}
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
                {t.status !== "pulling" && (
                  <button
                    onClick={(e) => { e.stopPropagation(); void removePullFromBar(t.id); }}
                    title="清理该任务（前后端同时移除）"
                    aria-label="清理该任务"
                    className="flex items-center justify-center w-5 h-5 shrink-0 text-slate-400 rounded hover:bg-slate-200 hover:text-slate-700"
                  >
                    <X size={13} />
                  </button>
                )}
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

      {/* 批量操作条（选中镜像后出现） */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5">
          <span className="text-sm text-blue-700 font-medium">已选中 {selected.size} 个镜像</span>
          <div className="w-px h-5 bg-blue-200 mx-1" />
          <button onClick={() => batchLock(true)} disabled={batchBusy} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50"><Lock size={14} /> 标记为不被清理</button>
          <button onClick={() => batchLock(false)} disabled={batchBusy} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50"><Unlock size={14} /> 允许清理</button>
          <button onClick={() => setConfirmBatchDelete(true)} disabled={batchBusy} className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700 disabled:opacity-50"><Trash2 size={14} /> 删除</button>
          <button onClick={batchPull} disabled={batchBusy} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50"><Download size={14} /> 拉取</button>
          <button onClick={batchDownload} disabled={batchBusy} className="flex items-center gap-1 text-sm text-slate-600 hover:text-blue-600 disabled:opacity-50">
            {batchDownloading ? <Loader2 size={14} className="animate-spin" /> : <ImageDown size={14} />}
            {batchDownloading ? `导出中 ${batchDownloading.current}/${batchDownloading.total}` : "下载镜像"}
          </button>
          <button onClick={() => setSelected(new Set())} title="取消选择" aria-label="取消选择" className="ml-auto p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-blue-100 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="w-10 px-3 py-3">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected; }}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-blue-500 focus:ring-blue-500"
                  />
                </th>
                {visibleColumns.has("repository") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3 whitespace-nowrap">仓库名</th>}
                {visibleColumns.has("tag") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">标签</th>}
                {visibleColumns.has("id") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">镜像 ID</th>}
                {visibleColumns.has("size") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">大小</th>}
                {visibleColumns.has("createdAt") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">创建时间</th>}
                {visibleColumns.has("updateStatus") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">更新状态</th>}
                {visibleColumns.has("associatedContainers") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">关联容器</th>}
                {visibleColumns.has("sha256") && <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-3 whitespace-nowrap">SHA-256</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filtered.map((img) => (
                <tr
                  key={img.id}
                  className={`hover:bg-slate-50 transition-colors cursor-context-menu ${selected.has(img.id) ? "bg-blue-50/50" : ""}`}
                  onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, img }); }}
                  title="右键打开操作菜单"
                >
                  <td className="w-10 px-3 py-3" onClick={(e) => { e.stopPropagation(); toggleSelect(img.id); }}>
                    <input
                      type="checkbox"
                      readOnly
                      checked={selected.has(img.id)}
                      className="rounded border-slate-300 text-blue-500 focus:ring-blue-500 pointer-events-none"
                    />
                  </td>
                  {visibleColumns.has("repository") && (
                    <td className="px-5 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-mono text-slate-700"
                          title={hideRepoRegistry && stripRegistryHost(img.repository) !== img.repository ? img.repository : undefined}
                        >
                          {hideRepoRegistry ? stripRegistryHost(img.repository) : img.repository}
                        </span>
                        {img.isDangling && <Tag text="悬空" color="amber" />}
                        {isLocked(img) && <Tag text="不被清理" color="purple" />}
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
                  {/* 操作列已移除：所有操作统一走右键菜单 */}
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
        onConfirm={() => { if (confirmDelete) { handleRemoveImage(confirmDelete.ref, false, confirmDelete.id); } }}
        title="删除镜像"
        message="确定要删除此镜像吗？如果有关联的容器，需要先删除或更新对应容器。"
        confirmText="删除"
        danger
        loading={deleting}
        errorMessage={deleteError}
        extraAction={
          forceDeleteAvailable && confirmDelete
            ? { label: "强制删除", onClick: () => handleRemoveImage(confirmDelete.ref, true, confirmDelete.id), loading: deleting }
            : undefined
        }
      />

      <ConfirmDialog
        open={confirmCleanUnused}
        onClose={() => { setConfirmCleanUnused(false); setPruneError(null); }}
        onConfirm={() => { handlePruneUnused(); }}
        title="清理未使用镜像"
        message={
          `将删除 ${deletableCount} 个未被容器引用的镜像（含悬空），释放约 ${deletableSize.toFixed(0)} MB 空间。` +
          (lockedUnusedCount > 0
            ? `未使用镜像共 ${unusedCount} 个，其中 ${lockedUnusedCount} 个已标记为不被清理，本次将跳过。`
            : "") +
          `此操作不可撤销，正在运行的容器依赖的镜像不会被删除。下方为本次将清理的镜像清单：`
        }
        list={deletableList}
        confirmText="清理"
        danger
        wide
        loading={pruning}
        errorMessage={pruneError}
      />

      {/* 批量删除镜像确认 */}
      <ConfirmDialog
        open={confirmBatchDelete}
        onClose={() => setConfirmBatchDelete(false)}
        onConfirm={batchDelete}
        title="批量删除镜像"
        message={`确定要删除选中的 ${selected.size} 个镜像吗？被容器占用的镜像会被跳过，此操作不可撤销。`}
        confirmText="批量删除"
        danger
        loading={batchBusy}
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

            <div className="flex items-center justify-between gap-2 pt-2">
              {/* 自动关闭提示：只在成功 / 已取消时出现；失败时保留弹窗让人看清原因并重试 */}
              {autoCloseLeft > 0 ? (
                <span className="text-[11px] text-slate-500 tabular-nums">
                  {autoCloseLeft} 秒后自动关闭
                </span>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
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
                {autoCloseLeft > 0 && (
                  <button
                    onClick={closePullModal}
                    className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                  >
                    立即关闭
                  </button>
                )}
                <button
                  onClick={closePullModal}
                  className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
                >
                  关闭
                </button>
              </div>
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

      {/* 右键菜单（操作列已移除，v1.42.13） */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getImageMenuItems(contextMenu.img)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* v1.43.18：手动检查更新（检查全部 / 单镜像）完成后弹出的结果明细 */}
      <Modal
        open={showCheckResult}
        onClose={() => setShowCheckResult(false)}
        title="镜像更新检查结果"
        size="sm"
      >
        <div className="p-6 space-y-4">
          {imageUpdateError ? (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <AlertTriangle size={16} className="flex-shrink-0" />
              <span>检查更新失败：{imageUpdateError}</span>
            </div>
          ) : checkResult ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                {checkResult.updates > 0 ? (
                  <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />
                ) : (
                  <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                )}
                <span>
                  {checkResult.updates > 0
                    ? `发现 ${checkResult.updates} 个镜像有可用更新`
                    : "全部镜像均为最新"}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-center">
                  <div className="text-2xl font-semibold text-slate-800">{checkResult.checked}</div>
                  <div className="text-xs text-slate-500 mt-1">已检查</div>
                </div>
                <div className="rounded-lg bg-green-50 border border-green-100 p-3 text-center">
                  <div className="text-2xl font-semibold text-green-600">{checkResult.upToDate}</div>
                  <div className="text-xs text-slate-500 mt-1">为最新</div>
                </div>
                <div
                  className={`rounded-lg border p-3 text-center ${
                    checkResult.updates > 0 ? "bg-amber-50 border-amber-100" : "bg-slate-50 border-slate-100"
                  }`}
                >
                  <div
                    className={`text-2xl font-semibold ${
                      checkResult.updates > 0 ? "text-amber-600" : "text-slate-400"
                    }`}
                  >
                    {checkResult.updates}
                  </div>
                  <div className="text-xs text-slate-500 mt-1">可更新</div>
                </div>
              </div>
              <p className="text-xs text-slate-400">
                检查时间：{new Date(checkResult.at).toLocaleString("zh-CN")}
              </p>
            </div>
          ) : null}
          <div className="flex justify-end pt-2">
            <button
              onClick={() => setShowCheckResult(false)}
              className="px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600"
            >
              知道了
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
