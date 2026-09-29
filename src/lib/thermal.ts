/**
 * 温度展示工具（磁盘卡片 / 硬件信息页温度卡片共用）。
 * 阈值：HDD 长期 >50℃ 需留意散热，≥60℃ 需排查；CPU 同口径沿用，仅作视觉提示。
 */

/** 温度文字色：≥60℃ 红加粗 / ≥50℃ 琥珀 / 其余常规 */
export function tempTextColor(c: number): string {
  if (c >= 60) return "text-red-600 font-semibold";
  if (c >= 50) return "text-amber-600";
  return "text-slate-600";
}

/** 温度文案：数值 → `37 °C`；null / undefined → `—` */
export function fmtTemp(c?: number | null): string {
  return typeof c === "number" ? `${c} °C` : "—";
}
