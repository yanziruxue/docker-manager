import React, { useState, useEffect, useMemo } from "react";
import {
  Monitor,
  Cpu,
  MemoryStick,
  Container as ContainerIcon,
  Layers,
  Image as ImageIcon,
  Activity,
  HardDrive,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  ChevronUp,
} from "lucide-react";
import { Tile, useStoredFlag } from "../components/Tile";
import { TileGrid, useMinWidth } from "../components/TileGrid";
import { LineChart, type LineSeries } from "../components/LineChart";
import type { EngineResourceStats as EngineStats } from "../types";

/** 本地保留的实时曲线点上限（1 秒 1 点 ⇒ 约 1 分钟），更早的交给 3 秒轮询的历史段 */
const LIVE_SAMPLE_LIMIT = 60;

/**
 * 把 SSE 推来的「当前值」(`EngineResourceStats`) 转成一个曲线点 (`ResourceSample`)。
 * 两套结构字段名不同（`memoryUsageMB`→`memDockerMB`、`netIfaces[]`→按名索引的 Record），
 * 磁盘同理（`readMBps/writeMBps/busyPct`→`read/write/busy`）；远程引擎这两项为空 ⇒ 缺省不写。
 */
function statsToSample(st: EngineStats): ResourceSample {
  const netIfaces: Record<string, { rx: number; tx: number }> = {};
  for (const n of st.netIfaces || []) netIfaces[n.name] = { rx: n.rxKBps, tx: n.txKBps };
  const disks: Record<string, { read: number; write: number; busy: number }> = {};
  for (const d of st.disks || []) disks[d.name] = { read: d.readMBps, write: d.writeMBps, busy: d.busyPct };
  return {
    ts: Date.now(),
    memSystemMB: st.memSystemMB,
    memDockerMB: st.memoryUsageMB,
    netRxKBps: st.netRxKBps,
    netTxKBps: st.netTxKBps,
    cpuPercent: st.cpuPercent,
    ...(Object.keys(netIfaces).length ? { netIfaces } : {}),
    ...(Object.keys(disks).length ? { disks } : {}),
  };
}
import { LoadingState, ErrorState } from "../components/DataState";
import { NodeCard } from "../components/NodeCard";
import { NodeCardGrid, FilterChips } from "../components/NodeCardGrid";
import { StackContainersModal } from "../components/StackContainersModal";
import { Toast } from "../components/UI";
import { fetchResourceHistoryApi, fetchNetInterfacesApi } from "../api";
import { tempTextColor, fmtTemp } from "../lib/thermal";
import type {
  Container,
  Stack,
  DockerImage,
  EngineResourceStats,
  DiskStat,
  ResourceSample,
  NetInterfaceOption,
} from "../types";

interface DashboardProps {
  containers: Container[];
  stacks: Stack[];
  images: DockerImage[];
  resourceStats: EngineResourceStats | null;
  /** 用于拉取资源时间序列（内存 / 网络折线图） */
  engineId?: string;
  /** 堆栈磁贴弹出的容器子表初始可见列（系统设置 → 列显隐 → 容器子表） */
  defaultSubColumns?: string[];
  onNavigate: (page: string) => void;
  loading?: boolean;
  error?: string | null;
}

const NO_STATS = "正在获取引擎资源数据…";

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

/** MB/s → 可读速率（磁盘读写速率；<1 MB/s 退化为 KB/s，避免大量程下全是「0.0 MB/s」） */
function fmtDiskRate(mbps: number): string {
  if (!isFinite(mbps) || mbps <= 0) return "0";
  if (mbps < 1) return `${Math.round(mbps * 1024)} KB/s`;
  return `${mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10} MB/s`;
}

/** 秒 → 正常运行时间（「3 天 4 小时 12 分」）；0 / 无效值显示「—」（远程引擎读不到 /proc/uptime） */
function fmtUptime(sec: number): string {
  if (!sec || sec <= 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时 ${m} 分`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  return `${m} 分`;
}

/** 时间戳 → HH:MM:SS（曲线悬停提示的时间标签） */
function fmtClock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 取最近 N 个样本的时间标签（与曲线 values 一一对应，供悬停提示用） */
function clockLabels(pts: ResourceSample[]): string[] {
  return pts.map((s) => fmtClock(s.ts));
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** 按负载取条形色：<60 绿 / 60–85 琥珀 / ≥85 红（沿用原核环簇的语义） */
function loadColor(p: number): string {
  if (p >= 85) return "#ef4444";
  if (p >= 60) return "#f59e0b";
  return "#22c55e";
}

/** 每秒走动的时钟（系统概览磁贴用） */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function Dashboard({
  containers,
  stacks,
  images,
  resourceStats,
  engineId,
  defaultSubColumns,
  onNavigate,
  loading,
  error,
}: DashboardProps) {
  // 未使用镜像（含悬空）：无任何容器引用
  const unusedImages = images.filter((i) => i.associatedContainers.length === 0).length;
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

  /**
   * ★ 曲线「实时」的关键一步（v1.39.0）：
   * `history` 是每 3 秒轮询来的历史段，而 SSE 每秒就推一次当前值（`resourceStats`）——
   * 此前只把 SSE 用在「数字」上，曲线因此比数字慢 3 倍。
   * 这里把每次 SSE 样本按时间戳追加为曲线点（**复用已有流，后端请求量零增加**），
   * 再与历史段按时间戳去重合并 ⇒ 曲线秒级前进；3 秒轮询继续用于补齐 / 校正历史。
   */
  const [liveSamples, setLiveSamples] = useState<ResourceSample[]>([]);
  useEffect(() => {
    if (!resourceStats) return;
    const s = statsToSample(resourceStats);
    setLiveSamples((prev) => {
      const last = prev[prev.length - 1];
      // 与上一个点间隔不足 ~0.9s ⇒ 视为同一批推流，跳过（防重复点 / 抖动）
      if (last && s.ts - last.ts < 900) return prev;
      return [...prev, s].slice(-LIVE_SAMPLE_LIMIT);
    });
  }, [resourceStats]);

  /** 历史段（去重后）＋ 实时段 —— 供各磁贴画曲线 */
  const series = useMemo(() => {
    if (liveSamples.length === 0) return history;
    const cutoff = liveSamples[0].ts;
    return [...history.filter((h) => h.ts < cutoff), ...liveSamples];
  }, [history, liveSamples]);

  // 栅格断点：`lg`(1024) 起 2 列、`3xl`(1800) 起 3 列，再窄单列（见 `TileGrid`）。
  // **列元素个数不能超过当前列数**：2 列档塞 3 个列元素会让第 3 列换行到第 2 行第 1 格，
  // 而栅格**行高 = 该行最高单元**——折叠上方磁贴只让本列变矮，第 2 行纹丝不动，
  // 表现为「折叠后下方的磁贴不上移」并留出大片空白。
  // 单列档例外：3 个列元素各占一行、行内只有一格，堆叠后正好还原原有顺序。
  //
  // ⚠️ 这两个 hook **必须写在下面的「提前 return」之前**（Rules of Hooks）：首次渲染
  // `loading=true` 时下面会直接 return `<LoadingState>`，若 hook 在其后才调用，等数据
  // 到达再次渲染就会凭空多出 2 个 hook，React 抛
  // 「Rendered more hooks than during the previous render」并卸载整棵树 → **登录后白屏**
  // （v1.27.1 回归事故，v1.27.2 修复；门禁见 `scripts/check-hooks.mjs`）。
  const threeCol = useMinWidth(1800);
  const twoCol = useMinWidth(1024);
  /** 仅 2 列档需要把「存储 / 网络」并进前两列（避免换行） */
  const mergeIo = twoCol && !threeCol;

  if (loading && containers.length === 0) return <LoadingState message="正在加载仪表盘数据..." />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="p-6">
      <TileGrid
        columns={[
          /* 第 1 列 · 系统（2 列档并入存储） */
          <>
            <SystemTile stats={resourceStats} engineId={engineId} />
            <CpuTile stats={resourceStats} history={series} />
            <MemTile stats={resourceStats} history={series} />
            {mergeIo && <DiskTile stats={resourceStats} history={series} />}
          </>,
          /* 第 2 列 · 应用（2 列档并入网络） */
          <>
            <ContainersTile containers={containers} onNavigate={onNavigate} />
            <StacksTile stacks={stacks} defaultSubColumns={defaultSubColumns} onNavigate={onNavigate} />
            <ImagesTile
              total={images.length}
              unused={unusedImages}
              dangling={danglingImages}
              onNavigate={onNavigate}
            />
            {mergeIo && <NetTile stats={resourceStats} history={series} engineId={engineId} />}
          </>,
          ...(mergeIo
            ? []
            : [
                /* 第 3 列 · 网络与存储（单列档堆在末尾还原顺序，3 列档独占一列） */
                <>
                  <NetTile stats={resourceStats} history={series} engineId={engineId} />
                  <DiskTile stats={resourceStats} history={series} />
                </>,
              ]),
        ]}
      />
    </div>
  );
}

/* ────────────────────────────── 通用小件 ────────────────────────────── */

/** 横向条形（照搬 Unraid 处理器磁贴的进度条形态） */
function Bar({ percent, color, className = "" }: { percent: number; color: string; className?: string }) {
  return (
    <div className={`h-2 rounded-full bg-slate-100 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${clamp(percent, 0, 100)}%`, background: color }}
      />
    </div>
  );
}

function Legend({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 text-slate-500">
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      {children}
    </span>
  );
}

function InfoItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`text-sm text-slate-700 truncate ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function MiniRow({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "amber" }) {
  const color = tone === "amber" ? "text-amber-600" : "text-slate-700";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className={`font-medium ${color}`}>{value}</span>
    </div>
  );
}

function ViewAll({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-blue-600 hover:underline flex items-center gap-1 whitespace-nowrap"
    >
      查看全部 <ArrowUpRight size={12} />
    </button>
  );
}

function Placeholder() {
  return <p className="text-sm text-slate-400 py-4 text-center">{NO_STATS}</p>;
}

/* ─────────────────── 曲线时间范围（处理器 / 内存 / 网络共用） ─────────────────── */

const RANGES: { key: string; label: string; points: number }[] = [
  { key: "10s", label: "10 秒", points: 10 },
  { key: "30s", label: "30 秒", points: 30 },
  { key: "1m", label: "1 分钟", points: 60 },
  { key: "2m", label: "2 分钟", points: 120 },
  { key: "5m", label: "5 分钟", points: 300 },
];

/**
 * 曲线时间范围。服务端固定保留最近 5 分钟（1s 一个点），这里只在本地切片显示，
 * 因此切换范围**不产生额外请求**。选择按磁贴持久化到 localStorage。
 */
function useChartRange(id: string, initial = "30s") {
  const storageKey = `dm.chart.${id}.range`;
  const [range, setRange] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw && RANGES.some((r) => r.key === raw) ? raw : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, range);
    } catch {
      // 忽略：隐私模式 / 禁用存储
    }
  }, [storageKey, range]);

  const points = RANGES.find((r) => r.key === range)?.points || 30;
  return { range, setRange, points };
}

/** 时间范围下拉（放在磁贴头 actions 槽位） */
function RangeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="曲线时间范围"
      className="text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
    >
      {RANGES.map((r) => (
        <option key={r.key} value={r.key}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

/** 字符串偏好（持久化到 localStorage；隐私模式 / 禁用存储时静默退化为会话内状态） */
function useStoredString(storageKey: string, initial = "") {
  const [value, setValue] = useState<string>(() => {
    try {
      return localStorage.getItem(storageKey) ?? initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, value);
    } catch {
      // 忽略：隐私模式 / 禁用存储
    }
  }, [storageKey, value]);

  return [value, setValue] as const;
}

/**
 * 网口下拉（放在磁贴头 actions 槽位）：
 * 「全部（容器合计）」= 原先的合计口径；后面按 **网口 / Docker 虚拟网卡** 分组。
 * 列表来自 `GET /api/engines/:id/net-interfaces`（仅本机 socket 引擎有值）。
 */
function IfaceSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: NetInterfaceOption[];
}) {
  const host = options.filter((o) => o.kind === "host");
  const docker = options.filter((o) => o.kind === "docker");
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="网络接口"
      title="选择要绘制的网口 / Docker 虚拟网卡"
      className="max-w-[8.5rem] text-xs border border-slate-200 rounded-md px-1.5 py-1 bg-white text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
    >
      <option value="">全部（容器合计）</option>
      {host.length > 0 && (
        <optgroup label="网口">
          {host.map((o) => (
            <option key={o.name} value={o.name}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
      {docker.length > 0 && (
        <optgroup label="Docker 虚拟网卡">
          {docker.map((o) => (
            <option key={o.name} value={o.name}>
              {o.label}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

/* ────────────────────────────── 磁贴 ────────────────────────────── */

/** 系统概览：大号时钟 + 日期 + 引擎关键信息 */
function SystemTile({ stats, engineId }: { stats: EngineResourceStats | null; engineId?: string }) {
  const now = useClock();
  const time = now.toLocaleTimeString("zh-CN", { hour12: false });
  const date = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).replace("星期", " 星期");

  // 启动时间：bootTimeSec（秒级）→ 本地可读时间；远程引擎为 0 → 「—」
  const bootTime =
    stats && stats.bootTimeSec > 0 ? new Date(stats.bootTimeSec * 1000).toLocaleString("zh-CN", { hour12: false }) : "—";

  return (
    <Tile
      id="system"
      title="系统概览"
      icon={<Monitor size={32} />}
      subtitle={stats ? `Docker ${stats.serverVersion || "—"} · ${stats.ncpu} 逻辑核` : NO_STATS}
    >
      <p className="text-[40px] font-normal leading-none text-ink tabular-nums">{time}</p>
      <p className="text-[13px] text-slate-500 mt-1.5">{date}</p>

      {stats ? (
        <dl className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-x-4 gap-y-2.5">
          <InfoItem label="主机名称" value={stats.hostName || "—"} mono />
          <InfoItem label="发行版本" value={stats.osName || "—"} />
          <InfoItem label="内核版本" value={stats.kernelVersion || "—"} mono />
          <InfoItem label="系统类型" value={stats.arch || "—"} mono />
          <InfoItem label="主机地址" value={stats.hostAddress || "—"} mono />
          <InfoItem label="启动时间" value={bootTime} />
          {/* 运行时间取宿主机 /proc/uptime（远程引擎读不到 → 「—」），单独占满一行 */}
          <div className="col-span-2">
            <InfoItem label="运行时间" value={fmtUptime(stats.hostUptimeSec)} />
          </div>
        </dl>
      ) : (
        <Placeholder />
      )}
    </Tile>
  );
}

/**
 * 图标 hover 提示卡（**替代原生 `title`**）：原生提示是单色单行、长型号会被挤成一坨，此处改为
 * 卡片式圆角 + 阴影，首行加粗标题（CPU 型号 / 内存总量），次行是若干「标签 值」对（标签灰、值等宽）。
 * 位置钉在图标左下方（`left-0 top-full`），`group-hover` 淡入；`pointer-events-none` 保证不拦截鼠标。
 */
function IconTip({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  items: { label: string; value: React.ReactNode }[];
}) {
  return (
    <span className="group relative inline-flex">
      <span className="text-slate-400">{icon}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-30 mt-2 flex w-max max-w-[360px] flex-col gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100"
      >
        <span className="text-sm font-semibold leading-snug text-slate-800">{title}</span>
        <span className="flex flex-wrap gap-x-5 gap-y-1">
          {items.map((it) => (
            <span key={it.label} className="flex items-baseline gap-2">
              <span className="text-xs text-slate-400">{it.label}</span>
              <span className="text-xs font-mono text-slate-700">{it.value}</span>
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

/**
 * 处理器：整体负载横条（**常驻**）+ 各物理核横条（随磁贴折叠）+ 整体负载曲线（**常驻**、自己单独折叠）。
 * 折叠语义：磁贴折叠只收起「各核明细」，整体负载与曲线仍在——曲线可以折叠后单独显示。
 */
function CpuTile({ stats, history }: { stats: EngineResourceStats | null; history: ResourceSample[] }) {
  const { range, setRange, points } = useChartRange("cpu");
  // 曲线小节独立折叠：与磁贴整体折叠分开，各自持久化
  const [showChart, setShowChart] = useStoredFlag("dm.tile.cpu.chart", false);

  // 「整体负载」口径 = 运行容器 CPU 合计，按 0–100% 展示（不再用 ncpu×100 的总容量口径）
  const overallPct = stats ? clamp(stats.cpuPercent, 0, 100) : 0;
  const cores = stats?.cpuCores || [];

  const pts = history.slice(-points);
  // 与「整体负载」条同源（运行容器 CPU 合计）；量程固定 0–100%（与副标题「/ 100%」同一口径，
  // 也对齐 Unraid 参考图：纵轴恒为 100% / 0%）。
  const cpuSeries: LineSeries[] = [
    { name: "整体负载", color: "#3b82f6", values: pts.map((s) => s.cpuPercent), area: true },
  ];

  // 折叠后仍常驻的两段：top = 整体负载横条；bottom = 曲线小节（自带开关，磁贴折叠后也可单独显示）
  const persistent = stats
    ? {
        top: (
          <div className="flex items-center gap-3">
            <span className="w-14 flex-shrink-0 text-xs text-slate-500">整体负载</span>
            <Bar percent={overallPct} color="#3b82f6" className="flex-1" />
            <span className="w-12 flex-shrink-0 text-right text-xs font-mono text-slate-600">
              {round1(stats.cpuPercent)}%
            </span>
          </div>
        ),
        bottom: (
          <div className="pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowChart(!showChart)}
              aria-expanded={showChart}
              className="flex w-full items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>整体负载曲线</span>
              <ChevronUp size={14} className={`transition-transform ${showChart ? "" : "rotate-180"}`} />
            </button>
            {showChart && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mt-1.5 mb-1">
                  <Legend color="#3b82f6">当前 {round1(stats.cpuPercent)}%</Legend>
                </div>
                <LineChart
                  series={cpuSeries}
                  yMax={100}
                  formatMax={(v) => `${Math.round(v)}%`}
                  formatMin={() => "0"}
                  emptyText="正在采样处理器…"
                  labels={clockLabels(pts)}
                  formatValue={(v) => `${round1(v)}%`}
                />
              </>
            )}
          </div>
        ),
      }
    : undefined;

  return (
    <Tile
      id="cpu"
      title="处理器"
      icon={
        <IconTip
          icon={<Cpu size={32} />}
          title={stats?.cpuModel || "处理器"}
          items={
            stats?.cpuModel
              ? [
                  { label: "物理核心", value: stats.cpuPhysicalCores ?? "—" },
                  { label: "逻辑核心", value: stats.cpuLogicalCores ?? "—" },
                  { label: "CPU 频率", value: stats.cpuMhz ? `${stats.cpuMhz} MHz` : "—" },
                ]
              : [{ label: "逻辑核心", value: stats?.cpuLogicalCores || stats?.ncpu || "—" }]
          }
        />
      }
      subtitle={stats ? `整体负载 ${round1(stats.cpuPercent)}% / 100%` : NO_STATS}
      actions={<RangeSelect value={range} onChange={setRange} />}
      persistent={persistent}
    >
      {/* 可折叠区：各物理核明细 */}
      {stats ? (
        cores.length > 0 ? (
          <div className="pt-3 border-t border-slate-100 space-y-1.5">
            {cores.map((core) => (
              <div key={core.name} className="flex items-center gap-3" title={`${core.name} ${core.percent}%`}>
                <span className="w-14 flex-shrink-0 truncate text-xs text-slate-500">{core.name}</span>
                <Bar percent={core.percent} color={loadColor(core.percent)} className="flex-1" />
                <span className="w-12 flex-shrink-0 text-right text-xs font-mono text-slate-600">
                  {Math.round(core.percent)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">暂无各核数据（远程引擎不支持读取主机 /proc/stat）</p>
        )
      ) : (
        <Placeholder />
      )}
    </Tile>
  );
}

/** 内存：系统占用 / Docker 占用 双曲线（量程钉在已安装总量） */
function MemTile({ stats, history }: { stats: EngineResourceStats | null; history: ResourceSample[] }) {
  const { range, setRange, points } = useChartRange("memory");
  const pts = history.slice(-points);
  const memSeries: LineSeries[] = [
    { name: "系统占用", color: "#64748b", values: pts.map((s) => s.memSystemMB), area: true },
    { name: "Docker 占用", color: "#f59e0b", values: pts.map((s) => s.memDockerMB), area: true },
  ];
  const installed = stats ? stats.memInstalledMB || stats.memTotalMB || 0 : 0;
  const used = stats ? stats.memSystemMB + stats.memoryUsageMB : 0;

  return (
    <Tile
      id="memory"
      title="内存"
      icon={
        <IconTip
          icon={<MemoryStick size={32} />}
          title={stats ? `内存总量 ${installed > 0 ? fmtMB(installed) : "—"}` : "内存"}
          items={
            stats
              ? [
                  { label: "已用", value: fmtMB(used) },
                  { label: "系统占用", value: fmtMB(stats.memSystemMB) },
                  { label: "Docker 占用", value: fmtMB(stats.memoryUsageMB) },
                  ...(stats.memFreeMB > 0 ? [{ label: "剩余", value: fmtMB(stats.memFreeMB) }] : []),
                ]
              : [{ label: "总量", value: "—" }]
          }
        />
      }
      subtitle={
        stats
          ? `已用 ${fmtMB(used)} / 共 ${installed > 0 ? fmtMB(installed) : "—"}${
              stats.memFreeMB > 0 ? ` · 剩余 ${fmtMB(stats.memFreeMB)}` : ""
            }`
          : NO_STATS
      }
      actions={<RangeSelect value={range} onChange={setRange} />}
    >
      {stats ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mb-1.5">
            <Legend color="#64748b">系统占用 {fmtMB(stats.memSystemMB)}</Legend>
            <Legend color="#f59e0b">Docker 占用 {fmtMB(stats.memoryUsageMB)}</Legend>
          </div>
          {/* 曲线量程钉在「共多少」（已安装总量）：两条曲线直接与总内存对比 */}
          <LineChart
            series={memSeries}
            yMax={installed > 0 ? installed : undefined}
            formatMax={fmtMB}
            formatMin={() => "0"}
            emptyText="正在采样内存…"
            labels={clockLabels(pts)}
            formatValue={(v) => fmtMB(v)}
          />
        </>
      ) : (
        <Placeholder />
      )}
    </Tile>
  );
}

/** 容器筛选项（只列常见的三种状态；重启中 / 更新中归入「全部」） */
const CONTAINER_FILTERS = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "stopped", label: "已停止" },
  { key: "paused", label: "已暂停" },
] as const;
type ContainerFilter = (typeof CONTAINER_FILTERS)[number]["key"];

/** 容器：状态筛选 + 容器卡片（点图标打开 WebUI） */
function ContainersTile({
  containers,
  onNavigate,
}: {
  containers: Container[];
  onNavigate: (page: string) => void;
}) {
  const [filter, setFilter] = useState<ContainerFilter>("all");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" | "info" } | null>(null);

  const total = containers.length;
  const running = containers.filter((c) => c.status === "running").length;
  const stopped = containers.filter((c) => c.status === "stopped").length;
  const paused = containers.filter((c) => c.status === "paused").length;
  const hasUpdate = containers.filter((c) => c.hasUpdate).length;

  const shown = useMemo(
    () => (filter === "all" ? containers : containers.filter((c) => c.status === filter)),
    [containers, filter]
  );

  // 提示条 3s 自动消失
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  /**
   * 点容器图标：运行中且有 WebUI 地址 → 新标签打开；
   * 未运行 → 提示「该容器未运行」；运行中但没配地址 → 提示未配置。
   */
  const handleIconClick = (c: Container) => {
    if (c.status !== "running") {
      setToast({ message: `该容器未运行：${c.name}`, type: "info" });
      return;
    }
    if (!c.webuiUrl) {
      setToast({ message: `该容器未配置 WebUI 地址：${c.name}`, type: "info" });
      return;
    }
    window.open(c.webuiUrl, "_blank", "noopener,noreferrer");
  };

  const iconTitle = (c: Container) =>
    c.status !== "running"
      ? "该容器未运行"
      : c.webuiUrl
        ? `打开 WebUI：${c.webuiUrl}`
        : "该容器未配置 WebUI 地址";

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <Tile
        id="containers"
        title="容器"
        icon={<ContainerIcon size={32} />}
        subtitle={`运行中 ${running} · 已停止 ${stopped} · 已暂停 ${paused}${
          hasUpdate > 0 ? ` · 可更新 ${hasUpdate}` : ""
        }`}
        actions={<ViewAll onClick={() => onNavigate("containers")} />}
      >
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={CONTAINER_FILTERS.map((f) => ({
            ...f,
            count:
              f.key === "all"
                ? total
                : f.key === "running"
                  ? running
                  : f.key === "stopped"
                    ? stopped
                    : paused,
          }))}
        />

        <div className="mt-3">
          {shown.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              {total === 0 ? "暂无容器" : "没有符合筛选条件的容器"}
            </p>
          ) : (
            <NodeCardGrid>
              {shown.map((c) => (
                <NodeCard
                  key={c.id}
                  icon={c.icon}
                  name={c.name}
                  status={c.status}
                  onIconClick={() => handleIconClick(c)}
                  iconTitle={iconTitle(c)}
                  external={c.status === "running" && !!c.webuiUrl}
                />
              ))}
            </NodeCardGrid>
          )}
        </div>
      </Tile>
    </>
  );
}

/** 堆栈筛选项（部分运行 = 堆栈内部分容器在跑） */
const STACK_FILTERS = [
  { key: "all", label: "全部" },
  { key: "running", label: "运行中" },
  { key: "stopped", label: "已停止" },
  { key: "partial", label: "部分运行" },
] as const;
type StackFilter = (typeof STACK_FILTERS)[number]["key"];

/** 堆栈：运行中数量 + 状态筛选 + 堆栈卡片（点图标弹出容器子表） */
function StacksTile({
  stacks,
  defaultSubColumns,
  onNavigate,
}: {
  stacks: Stack[];
  defaultSubColumns?: string[];
  onNavigate: (page: string) => void;
}) {
  const [filter, setFilter] = useState<StackFilter>("all");
  const [modalStack, setModalStack] = useState<Stack | null>(null);

  const running = stacks.filter((s) => s.status === "running").length;
  const stopped = stacks.filter((s) => s.status === "stopped").length;
  const partial = stacks.filter((s) => s.status === "partial").length;

  const shown = useMemo(
    () => (filter === "all" ? stacks : stacks.filter((s) => s.status === filter)),
    [stacks, filter]
  );

  // 列表刷新后让弹窗继续指向最新快照（容器状态 / 操作中标记都是实时的）
  const current = modalStack ? stacks.find((s) => s.id === modalStack.id) || modalStack : null;

  return (
    <>
      <Tile
        id="stacks"
        title="堆栈"
        icon={<Layers size={32} />}
        subtitle={`运行中 ${running} / 共 ${stacks.length}`}
        actions={<ViewAll onClick={() => onNavigate("stacks")} />}
      >
        <FilterChips
          value={filter}
          onChange={setFilter}
          options={STACK_FILTERS.map((f) => ({
            ...f,
            count:
              f.key === "all"
                ? stacks.length
                : f.key === "running"
                  ? running
                  : f.key === "stopped"
                    ? stopped
                    : partial,
          }))}
        />

        <div className="mt-3">
          {shown.length === 0 ? (
            <p className="text-xs text-slate-400 py-3 text-center">
              {stacks.length === 0 ? "暂无堆栈" : "没有符合筛选条件的堆栈"}
            </p>
          ) : (
            <NodeCardGrid>
              {shown.map((stack) => (
                <NodeCard
                  key={stack.id}
                  icon={stack.icon}
                  name={stack.name}
                  status={stack.status}
                  extra={`${stack.runningContainers}/${stack.totalContainers}`}
                  fallback={<Layers size={16} />}
                  onIconClick={() => setModalStack(stack)}
                  iconTitle="查看容器子表"
                />
              ))}
            </NodeCardGrid>
          )}
        </div>
      </Tile>

      {/* 容器子表：与堆栈页共用同一组件 */}
      {current && (
        <StackContainersModal
          stack={current}
          onClose={() => setModalStack(null)}
          defaultVisibleColumns={defaultSubColumns}
        />
      )}
    </>
  );
}

/** 镜像：总数 / 未使用 / 悬空 */
function ImagesTile({
  total,
  unused,
  dangling,
  onNavigate,
}: {
  total: number;
  unused: number;
  dangling: number;
  onNavigate: (page: string) => void;
}) {
  return (
    <Tile
      id="images"
      title="镜像"
      icon={<ImageIcon size={32} />}
      subtitle={`共 ${total} 个 · 未使用 ${unused} 个`}
      actions={<ViewAll onClick={() => onNavigate("images")} />}
    >
      <div className="space-y-2.5">
        <MiniRow label="本地镜像" value={String(total)} />
        <MiniRow label="未使用（含悬空）" value={String(unused)} tone="amber" />
        <MiniRow label="悬空镜像" value={String(dangling)} tone="amber" />
      </div>
    </Tile>
  );
}

/**
 * 网络：下行 / 上行 双曲线 + **网口选择** + 时间范围选择（两个选择器都放在磁贴头右侧）。
 * 网口列表来自后端 /proc/net/dev（本机网口 + Docker 网桥虚拟网卡）；
 * 默认「全部（容器合计）」＝ 原先的合计口径，行为与改动前一致。
 */
function NetTile({
  stats,
  history,
  engineId,
}: {
  stats: EngineResourceStats | null;
  history: ResourceSample[];
  engineId?: string;
}) {
  const { range, setRange, points } = useChartRange("network");
  // 选中的网口：空串 = 全部（容器合计）；按磁贴持久化
  const [iface, setIface] = useStoredString("dm.chart.network.iface", "");
  const [ifaces, setIfaces] = useState<NetInterfaceOption[]>([]);

  // 接口列表：进页面拉一次，之后每 60s 刷新（新建 / 删除 Docker 网络会增减 br-xxxx 网桥）
  useEffect(() => {
    if (!engineId) return;
    let alive = true;
    const load = async () => {
      try {
        const list = await fetchNetInterfacesApi(engineId);
        if (alive) setIfaces(list || []);
      } catch {
        // 忽略：拿不到列表就只保留「全部（容器合计）」
      }
    };
    void load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [engineId]);

  // 选中的网口若已不存在（网络被删 / 换了引擎），自动回落到「全部」
  const active = iface && ifaces.some((o) => o.name === iface) ? iface : "";
  const usingAll = active === "";
  const ifaceStat = usingAll ? undefined : stats?.netIfaces?.find((n) => n.name === active);

  const pts = history.slice(-points);
  const netSeries: LineSeries[] = usingAll
    ? [
        { name: "下行速率", color: "#ef4444", values: pts.map((s) => s.netRxKBps), area: true },
        { name: "上行速率", color: "#f59e0b", values: pts.map((s) => s.netTxKBps), area: true },
      ]
    : [
        { name: "下行速率", color: "#ef4444", values: pts.map((s) => s.netIfaces?.[active]?.rx ?? 0), area: true },
        { name: "上行速率", color: "#f59e0b", values: pts.map((s) => s.netIfaces?.[active]?.tx ?? 0), area: true },
      ];

  const rxNow = usingAll ? stats?.netRxKBps ?? 0 : ifaceStat?.rxKBps ?? 0;
  const txNow = usingAll ? stats?.netTxKBps ?? 0 : ifaceStat?.txKBps ?? 0;

  return (
    <Tile
      id="network"
      title="网络"
      icon={<Activity size={32} />}
      subtitle={stats ? `下行 ${fmtRate(rxNow)} · 上行 ${fmtRate(txNow)}` : NO_STATS}
      actions={
        <>
          <IfaceSelect value={active} onChange={setIface} options={ifaces} />
          <RangeSelect value={range} onChange={setRange} />
        </>
      }
    >
      {stats ? (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mb-1.5">
            <span className="flex items-center gap-1 text-red-500">
              <ArrowDown size={12} /> 下行速率 <b className="font-semibold">{fmtRate(rxNow)}</b>
            </span>
            <span className="flex items-center gap-1 text-amber-500">
              <ArrowUp size={12} /> 上行速率 <b className="font-semibold">{fmtRate(txNow)}</b>
            </span>
          </div>
          <LineChart
            series={netSeries}
            formatMax={fmtRate}
            formatMin={() => "0"}
            emptyText="正在采样网络…"
            labels={clockLabels(pts)}
            formatValue={(v) => fmtRate(v)}
          />
        </>
      ) : (
        <Placeholder />
      )}
    </Tile>
  );
}

/**
 * 磁盘：读写速率 + 利用率曲线（常驻、可单独折叠）+ 各设备明细表。
 * 形态与处理器磁贴一致：曲线放在 `persistent.bottom`（磁贴折叠后仍显示），
 * 且**自己带一个折叠开关**（`dm.tile.disk.chart`），与磁贴折叠是两套状态。
 */
function DiskTile({ stats, history }: { stats: EngineResourceStats | null; history: ResourceSample[] }) {
  const { range, setRange, points } = useChartRange("disk");
  const [showChart, setShowChart] = useStoredFlag("dm.tile.disk.chart", false);
  const disks: DiskStat[] = stats?.disks || [];
  const avg = disks.length > 0 ? Math.round(disks.reduce((sum, d) => sum + d.busyPct, 0) / disks.length) : 0;

  // 全盘合计曲线（MB/s）。样本里的 disks 仅本机 socket 引擎有值，远程引擎为 undefined → 全 0。
  const pts = history.slice(-points);
  const hasDiskHistory = pts.some((s) => s.disks);
  const sumBy = (pick: (d: { read: number; write: number; busy: number }) => number) =>
    pts.map((s) => {
      const m = s.disks;
      if (!m) return 0;
      let sum = 0;
      for (const k in m) sum += pick(m[k]);
      return Math.round(sum * 100) / 100;
    });
  const readSeries = sumBy((d) => d.read);
  const writeSeries = sumBy((d) => d.write);
  // 平均利用率（%）：与副标题「平均利用率」同一口径
  const busySeries = pts.map((s) => {
    const m = s.disks;
    if (!m) return 0;
    const keys = Object.keys(m);
    if (keys.length === 0) return 0;
    let sum = 0;
    for (const k of keys) sum += m[k].busy;
    return Math.round((sum / keys.length) * 10) / 10;
  });

  const readNow = disks.reduce((s, d) => s + d.readMBps, 0);
  const writeNow = disks.reduce((s, d) => s + d.writeMBps, 0);
  const canChart = !!stats && (disks.length > 0 || hasDiskHistory);

  const diskSeries: LineSeries[] = [
    { name: "读速率", color: "#3b82f6", values: readSeries, area: true },
    { name: "写速率", color: "#f59e0b", values: writeSeries, area: true },
    // 利用率量纲是 %，必须走**右轴**（左轴是 MB/s）；共用一根轴会被大量纲压成贴底直线
    { name: "利用率", color: "#10b981", values: busySeries, axis: "right", dashed: true },
  ];

  const persistent = canChart
    ? {
        bottom: (
          <div className="pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setShowChart(!showChart)}
              aria-expanded={showChart}
              className="flex w-full items-center justify-between text-xs text-slate-500 hover:text-slate-700 transition-colors"
            >
              <span>磁盘速率曲线</span>
              <ChevronUp size={14} className={`transition-transform ${showChart ? "" : "rotate-180"}`} />
            </button>
            {showChart && (
              <>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] mt-1.5 mb-1">
                  <Legend color="#3b82f6">读速率 <b className="font-semibold">{fmtDiskRate(readNow)}</b></Legend>
                  <Legend color="#f59e0b">写速率 <b className="font-semibold">{fmtDiskRate(writeNow)}</b></Legend>
                  <Legend color="#10b981">平均利用率 <b className="font-semibold">{avg}%</b></Legend>
                </div>
                <LineChart
                  series={diskSeries}
                  yMaxRight={100}
                  formatMax={fmtDiskRate}
                  formatMaxRight={(v) => `${Math.round(v)}%`}
                  formatMin={() => "0"}
                  emptyText="正在采样磁盘…"
                  labels={clockLabels(pts)}
                  // 读/写走左轴（MB/s），利用率走右轴（%）
                  formatValue={(v, s) => (s.axis === "right" ? `${round1(v)}%` : fmtDiskRate(v))}
                />
              </>
            )}
          </div>
        ),
      }
    : undefined;

  return (
    <Tile
      id="disk"
      title="磁盘"
      icon={<HardDrive size={32} />}
      subtitle={
        disks.length > 0 ? `${disks.length} 块设备 · 平均利用率 ${avg}%` : "本机磁盘数据不可用"
      }
      actions={canChart ? <RangeSelect value={range} onChange={setRange} /> : undefined}
      persistent={persistent}
    >
      {!stats ? (
        <Placeholder />
      ) : disks.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">
          本机磁盘数据不可用（仅本机 socket 引擎可读取 /proc/diskstats）。
        </p>
      ) : (
        <div className="pt-3 border-t border-slate-100">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px]">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">设备</th>
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">文件系统</th>
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">温度</th>
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">状态</th>
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2 pr-4">读写速率</th>
                  <th className="text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider py-2">利用率</th>
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
                    <td className="py-2 pr-4 text-xs text-slate-500 whitespace-nowrap">
                      {d.fstypes && d.fstypes.length > 0 ? d.fstypes.join(" / ") : "—"}
                    </td>
                    <td className="py-2 pr-4 text-xs whitespace-nowrap">
                      {typeof d.tempC === "number" ? (
                        <span className={`font-mono ${tempTextColor(d.tempC)}`}>{fmtTemp(d.tempC)}</span>
                      ) : (
                        <span className="text-slate-400" title="无温度传感器，或 SATA 盘未加载 drivetemp 内核模块">
                          —
                        </span>
                      )}
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
                    <td className="py-2 text-xs font-mono text-slate-600 whitespace-nowrap">{d.busyPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Tile>
  );
}
