import React from "react";

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  /** 是否填充曲线下方区域 */
  area?: boolean;
  /** 是否为虚线（辅助线） */
  dashed?: boolean;
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
  emptyText = "正在采样…",
  grid = true,
  strokeWidth = 2,
}: LineChartProps) {
  const len = Math.max(0, ...series.map((s) => s.values.length));

  let dataMax = 0;
  for (const s of series) {
    for (const v of s.values) {
      if (isFinite(v) && v > dataMax) dataMax = v;
    }
  }
  if (typeof yMax === "number" && yMax > 0) dataMax = Math.max(dataMax, yMax);
  const maxVal = dataMax > 0 ? dataMax : 1;

  const padTop = 6;
  const padBottom = 6;
  const innerH = VB_H - padTop - padBottom;
  const x = (i: number) => (len <= 1 ? 0 : (i / (len - 1)) * VB_W);
  const y = (v: number) => padTop + innerH - (Math.max(0, Math.min(maxVal, v)) / maxVal) * innerH;

  return (
    <div className="relative w-full" style={{ height }}>
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
              .map((v, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`)
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
        </svg>
      )}
      {len >= 2 && formatMax && (
        <span className="absolute right-0 top-0 text-[10px] text-slate-400 bg-white/70 px-0.5">{formatMax(maxVal)}</span>
      )}
      {len >= 2 && formatMin && (
        <span className="absolute right-0 bottom-0 text-[10px] text-slate-400 bg-white/70 px-0.5">{formatMin(0)}</span>
      )}
    </div>
  );
}
