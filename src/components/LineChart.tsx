import React, { useState } from "react";

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  /** 是否填充曲线下方区域 */
  area?: boolean;
  /** 是否为虚线（辅助线） */
  dashed?: boolean;
  /**
   * 归属哪根 Y 轴，默认 `left`。
   * 同一张图要画**两种量纲**时（如磁盘的「读/写速率 MB/s」+「利用率 %」），
   * 给次要序列标 `right`，并配 `yMaxRight` / `formatMaxRight` 单独定标 ——
   * 两轴各自独立缩放，否则小量纲会被大量纲压成贴底直线。
   */
  axis?: "left" | "right";
}

interface LineChartProps {
  series: LineSeries[];
  /** 图表高度（px），默认 170 */
  height?: number;
  /** 固定 Y 轴上限；不传则按数据自动取最大值 */
  yMax?: number;
  /** 上限标签格式化（如 MB → "32 GB"） */
  formatMax?: (v: number) => string;
  /** 下限标签格式化（默认不显示） */
  formatMin?: (v: number) => string;
  /**
   * **右轴**上限（仅当有 `axis: "right"` 的序列时生效）；不传则按右轴序列自动取最大值。
   * 左右两轴各自独立缩放，用于同一张图里共存两种量纲。
   */
  yMaxRight?: number;
  /** 右轴上标签格式化（缺省时右轴不显示刻度） */
  formatMaxRight?: (v: number) => string;
  /**
   * 悬停提示里每条序列的取值格式化。第二参数是该序列，可据 `name` / `axis` 分别格式化
   * （如磁盘：速率走 MB/s、利用率走 %）。缺省保留两位小数。
   */
  formatValue?: (value: number, series: LineSeries) => string;
  /**
   * 悬停提示顶部的标签，与 `values` 一一对应（如时间 `HH:MM:SS`）。
   * 不传时显示「第 N 点」。
   */
  labels?: string[];
  /** 数据点不足 2 个时的占位文案 */
  emptyText?: string;
  /** 是否画水平网格线 */
  grid?: boolean;
  /** 线宽（非缩放，始终为屏幕像素） */
  strokeWidth?: number;
}

const VB_W = 600;
const VB_H = 170;

/**
 * 零依赖 SVG 折线图（多序列 + 可选面积填充 + 自动量程）。
 * 用 preserveAspectRatio="none" 横向铺满父容器，配合 vectorEffect="non-scaling-stroke"
 * 保证线宽与网格在任意宽度下都不变形。
 */
export function LineChart({
  series,
  height = 170,
  yMax,
  formatMax,
  formatMin,
  yMaxRight,
  formatMaxRight,
  formatValue,
  labels,
  emptyText = "正在采样…",
  grid = true,
  strokeWidth = 2,
}: LineChartProps) {
  const len = Math.max(0, ...series.map((s) => s.values.length));

  // 左右两轴各自独立定标：一张图里共存两种量纲（如磁盘「读/写速率 MB/s」+「利用率 %」）时，
  // 若共用一根轴，小量纲会被大量纲压成贴底直线，完全看不出趋势。
  const maxOf = (list: LineSeries[]) => {
    let m = 0;
    for (const s of list) for (const v of s.values) if (isFinite(v) && v > m) m = v;
    return m;
  };
  const leftSeries = series.filter((s) => (s.axis ?? "left") === "left");
  const rightSeries = series.filter((s) => s.axis === "right");
  const hasRight = rightSeries.length > 0;

  let leftMax = maxOf(leftSeries);
  if (typeof yMax === "number" && yMax > 0) leftMax = Math.max(leftMax, yMax);
  let rightMax = maxOf(rightSeries);
  if (typeof yMaxRight === "number" && yMaxRight > 0) rightMax = Math.max(rightMax, yMaxRight);
  const maxVal = leftMax > 0 ? leftMax : 1;
  const maxValRight = rightMax > 0 ? rightMax : 1;

  const padTop = 6;
  const padBottom = 6;
  const innerH = VB_H - padTop - padBottom;
  const x = (i: number) => (len <= 1 ? 0 : (i / (len - 1)) * VB_W);
  const yOn = (max: number) => (v: number) =>
    padTop + innerH - (Math.max(0, Math.min(max, v)) / max) * innerH;
  const yLeft = yOn(maxVal);
  const yRight = yOn(maxValRight);
  const y = (s: LineSeries, v: number) => (s.axis === "right" ? yRight(v) : yLeft(v));

  // 悬停取值：鼠标在图上移动时吸附到最近的数据点 → 竖向游标 + 各序列圆点 + 数值提示框。
  // ⚠️ svg 是 `preserveAspectRatio="none"` 横向拉伸的，所以索引要按**容器宽度比例**换算
  //（不是 viewBox 宽度）；圆点与提示框放在 **HTML 层用百分比定位** —— 若画在 viewBox 里，
  // 圆会被非等比缩放拉成椭圆。
  const [hover, setHover] = useState<number | null>(null);
  const hoverIdx = hover !== null && hover >= 0 && hover < len ? hover : null;
  const hoverRatio = hoverIdx !== null && len > 1 ? hoverIdx / (len - 1) : 0;
  const tipFlip = hoverRatio > 0.55; // 靠右侧时提示框翻到游标左边，避免溢出

  const handleMove = (clientX: number, el: HTMLElement) => {
    if (len < 2) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const i = Math.round(r * (len - 1));
    setHover((prev) => (prev === i ? prev : i));
  };

  return (
    <div
      className="relative w-full"
      style={{ height }}
      onMouseMove={(e) => handleMove(e.clientX, e.currentTarget)}
      onMouseLeave={() => setHover(null)}
    >
      {len < 2 ? (
        <div className="flex h-full items-center justify-center text-xs text-slate-400">{emptyText}</div>
      ) : (
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="none" className="w-full h-full">
          {grid &&
            [0.25, 0.5, 0.75, 1].map((g) => (
              <line
                key={g}
                x1={0}
                y1={padTop + innerH * (1 - g)}
                x2={VB_W}
                y2={padTop + innerH * (1 - g)}
                stroke="#eef2f7"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          {series.map((s) => {
            if (s.values.length < 2) return null;
            const d = s.values
              .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(s, v).toFixed(1)}`)
              .join(" ");
            const baseY = (padTop + innerH).toFixed(1);
            const areaD = `${d} L ${x(s.values.length - 1).toFixed(1)} ${baseY} L ${x(0).toFixed(1)} ${baseY} Z`;
            return (
              <g key={s.name}>
                {s.area && <path d={areaD} fill={s.color} opacity={0.12} />}
                <path
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={strokeWidth}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  strokeDasharray={s.dashed ? "4 4" : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {/* 悬停游标（竖线）：竖线方向不受横向拉伸影响，可安全画在 viewBox 里 */}
          {hoverIdx !== null && (
            <line
              x1={x(hoverIdx)}
              y1={padTop}
              x2={x(hoverIdx)}
              y2={padTop + innerH}
              stroke="#94a3b8"
              strokeWidth={1}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      )}
      {/* 悬停圆点 + 数值提示框（HTML 层，按百分比定位，避免被 viewBox 非等比缩放拉变形） */}
      {hoverIdx !== null &&
        series.map((s) => {
          const v = s.values[hoverIdx];
          if (v === undefined || !isFinite(v)) return null;
          return (
            <span
              key={`dot-${s.name}`}
              className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full border-2 pointer-events-none"
              style={{
                left: `${hoverRatio * 100}%`,
                top: `${(y(s, v) / VB_H) * 100}%`,
                borderColor: s.color,
                background: "#fff",
              }}
            />
          );
        })}
      {hoverIdx !== null && (
        <div
          className="absolute top-0 z-10 pointer-events-none rounded-md border border-slate-200 bg-white/95 px-2 py-1.5 shadow-sm"
          style={{
            left: `${hoverRatio * 100}%`,
            transform: tipFlip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <div className="text-[10px] text-slate-400 whitespace-nowrap leading-none">
            {labels?.[hoverIdx] ?? `第 ${hoverIdx + 1} 点`}
          </div>
          <div className="mt-1 space-y-0.5">
            {series.map((s) => {
              const v = s.values[hoverIdx];
              return (
                <div key={`tip-${s.name}`} className="flex items-center gap-1.5 text-[11px] whitespace-nowrap">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="text-slate-500">{s.name}</span>
                  <span className="ml-auto pl-3 font-mono font-semibold text-slate-700">
                    {v === undefined || !isFinite(v)
                      ? "—"
                      : formatValue
                        ? formatValue(v, s)
                        : String(Math.round(v * 100) / 100)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* 左轴刻度：有右轴时靠左显示（避免与右轴刻度重叠）；无右轴时保持原位置 —— 老图零回归 */}
      {len >= 2 && formatMax && (
        <span className={`absolute ${hasRight ? "left-0" : "right-0"} top-0 text-[10px] text-slate-400 bg-white/70 px-0.5`}>
          {formatMax(maxVal)}
        </span>
      )}
      {len >= 2 && formatMin && (
        <span className={`absolute ${hasRight ? "left-0" : "right-0"} bottom-0 text-[10px] text-slate-400 bg-white/70 px-0.5`}>
          {formatMin(0)}
        </span>
      )}
      {/* 右轴刻度（仅当存在 axis:"right" 的序列） */}
      {len >= 2 && hasRight && formatMaxRight && (
        <span className="absolute right-0 top-0 text-[10px] text-slate-400 bg-white/70 px-0.5">
          {formatMaxRight(maxValRight)}
        </span>
      )}
    </div>
  );
}
