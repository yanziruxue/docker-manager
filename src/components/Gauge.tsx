import React from "react";

type GaugeColor = "blue" | "green" | "amber" | "red" | "purple";

const RING_COLOR: Record<GaugeColor, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#a855f7",
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

interface GaugeProps {
  /** 当前值（有 max 时用于计算进度环占比；无 max 时画满圈彩环 + 居中大数字） */
  value?: number;
  /** 量程上限；不传则视为「信息型仪表」，画满圈彩环 + 居中大数字 */
  max?: number;
  label: string;
  /** 仪表中心主文本（不传则显示 value + unit） */
  mainText?: string;
  /** 仪表下方小字说明 */
  subText?: string;
  unit?: string;
  /** 主题色：blue / green / amber / red / purple */
  color?: GaugeColor;
}

/**
 * 环形仪表（圆形进度环 + 居中大数字）。用于仪表盘资源监控：
 * - 有 max（如内存）→ 按占比画彩环 + 居中数值；
 * - 无 max（镜像 / 数据卷 / 网络 I/O 等计数 / 速率）→ 满圈彩环 + 居中大数字。
 */
export function Gauge({ value, max, label, mainText, subText, unit, color = "blue" }: GaugeProps) {
  const hasMax = typeof max === "number" && max > 0 && isFinite(max);
  const safeValue = typeof value === "number" && isFinite(value) ? value : 0;
  const fraction = hasMax ? clamp(safeValue / max, 0, 1) : 1;
  const c = RING_COLOR[color] || RING_COLOR.blue;

  const size = 120;
  const stroke = 11;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const dash = fraction * C;
  const center =
    mainText ?? `${isFinite(safeValue) ? Math.round(safeValue * 10) / 10 : safeValue}${unit ? ` ${unit}` : ""}`;

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-[120px] h-[120px] -rotate-90" role="img" aria-label={label}>
          {/* 轨道 */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
          {/* 进度环 */}
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={c}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${C}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-bold text-slate-700 leading-tight">{center}</span>
          {unit && hasMax && <span className="text-[11px] text-slate-400 mt-0.5">{unit}</span>}
        </div>
      </div>
      <p className="text-xs font-medium text-slate-600 mt-1.5 text-center">{label}</p>
      {subText && <p className="text-[11px] text-slate-400 text-center mt-0.5">{subText}</p>}
    </div>
  );
}

interface CpuCoresGaugeProps {
  /** 各物理核实时使用率（name 如「核心1」） */
  cores: { name: string; percent: number }[];
  label: string;
  /** 合计使用率（可选，显示在标题右侧） */
  aggregatePercent?: number;
  subText?: string;
  color?: GaugeColor;
}

/** 按使用率取环色：<60 绿 / 60–85 琥珀 / ≥85 红 */
function coreColor(p: number): string {
  if (p >= 85) return RING_COLOR.red;
  if (p >= 60) return RING_COLOR.amber;
  return RING_COLOR.green;
}

/**
 * CPU 各核使用率环簇（参考图：每个物理核一个小环 + 居中百分比）。
 * 仅本机 socket 引擎可读到各核数据；远程引擎 cores 为空，给出提示。
 */
export function CpuCoresGauge({ cores, label, aggregatePercent, subText, color = "blue" }: CpuCoresGaugeProps) {
  const size = 56;
  const stroke = 6;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const C = 2 * Math.PI * r;
  const accent = RING_COLOR[color] || RING_COLOR.blue;

  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between mb-2.5">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        {typeof aggregatePercent === "number" && (
          <p className="text-sm font-bold" style={{ color: accent }}>
            合计 {Math.round(aggregatePercent * 10) / 10}%
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-3">
        {cores.length === 0 ? (
          <p className="text-xs text-slate-400 py-2">暂无各核数据（远程引擎不支持读取主机 /proc/stat）</p>
        ) : (
          cores.map((core) => {
            const f = clamp(core.percent / 100, 0, 1);
            const dash = f * C;
            const col = coreColor(core.percent);
            return (
              <div key={core.name} className="flex flex-col items-center" title={`${core.name} ${core.percent}%`}>
                <div className="relative" style={{ width: size, height: size }}>
                  <svg viewBox={`0 0 ${size} ${size}`} className="w-[56px] h-[56px] -rotate-90">
                    <circle cx={cx} cy={cy} r={r} fill="none" stroke="#eef2f7" strokeWidth={stroke} />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={r}
                      fill="none"
                      stroke={col}
                      strokeWidth={stroke}
                      strokeLinecap="round"
                      strokeDasharray={`${dash} ${C}`}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[11px] font-semibold text-slate-600">{Math.round(core.percent)}%</span>
                  </div>
                </div>
                <span className="text-[10px] text-slate-400 mt-1">{core.name}</span>
              </div>
            );
          })
        )}
      </div>
      {subText && <p className="text-[11px] text-slate-400 mt-3">{subText}</p>}
    </div>
  );
}
