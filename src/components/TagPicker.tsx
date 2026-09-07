import React, { useRef, useState, useEffect } from "react";
import { Check, Plus, Tags as TagsIcon } from "lucide-react";
import type { ResourceTag } from "../types";

/** 内置标签色板（6 位十六进制，红橙黄绿青蓝紫粉梯度），供「标签管理」与标签选择器复用 */
export const TAG_PALETTE: string[] = [
  "#ef4444", // 红
  "#f97316", // 橙
  "#f59e0b", // 琥珀
  "#eab308", // 黄
  "#22c55e", // 绿
  "#10b981", // 翡翠
  "#14b8a6", // 青
  "#0ea5e9", // 天蓝
  "#3b82f6", // 蓝
  "#6366f1", // 靛蓝
  "#a855f7", // 紫
  "#ec4899", // 粉
];

const FALLBACK_COLOR = "#64748b";

/** 校验并归一化十六进制颜色；非法值回退 slate */
export function normalizeTagColor(color?: string): string {
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : FALLBACK_COLOR;
}

/** 给 6 位 hex 追加透明度 → rgba(...)（用于 chip 的浅色底 / 描边） */
export function hexWithAlpha(color: string, alpha: number): string {
  const c = normalizeTagColor(color);
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 生成随机标签色（HSL→hex，固定饱和度/亮度，颜色鲜明且可读） */
export function randomTagColor(): string {
  const h = Math.floor(Math.random() * 360);
  const s = 0.68;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 6 位 hex → {r,g,b}（非法返回 null） */
export function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const c = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
  if (!c) return null;
  return {
    r: parseInt(c.slice(1, 3), 16),
    g: parseInt(c.slice(3, 5), 16),
    b: parseInt(c.slice(5, 7), 16),
  };
}

/** rgb(0-255) → 6 位 hex */
export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** 单颗彩色标签 chip：色点 + 名称，浅色半透明底与描边 */
export function TagChip({
  tag,
  onRemove,
  title,
}: {
  tag?: ResourceTag | null;
  onRemove?: () => void;
  title?: string;
}) {
  if (!tag || !tag.id) return null;
  const color = normalizeTagColor(tag.color);
  return (
    <span
      title={title ?? tag.name}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-700 border whitespace-nowrap max-w-[160px]"
      style={{ backgroundColor: hexWithAlpha(color, 0.12), borderColor: hexWithAlpha(color, 0.35) }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="truncate">{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 text-slate-400 hover:text-red-500 leading-none flex-shrink-0"
          title="移除标签"
        >
          <span className="text-[10px]">✕</span>
        </button>
      )}
    </span>
  );
}

/** 紧凑标签组：超限折叠为 +N（表格单元格用） */
export function TagGroup({ tags, max = 3 }: { tags?: ResourceTag[]; max?: number }) {
  const list = (tags || []).filter((t) => t && t.id);
  if (list.length === 0) return null;
  const shown = list.slice(0, max);
  const rest = list.length - shown.length;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {shown.map((t) => (
        <TagChip key={t.id} tag={t} />
      ))}
      {rest > 0 && (
        <span className="inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200">
          +{rest}
        </span>
      )}
    </div>
  );
}

/** 多选标签选择器：展示已选 chips，点开弹出标签库复选框面板 */
export function TagSelect({
  library,
  value,
  onChange,
  placeholder = "添加标签",
}: {
  library: ResourceTag[];
  value: ResourceTag[];
  onChange: (next: ResourceTag[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", handle);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handle);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const toggle = (tag: ResourceTag) => {
    const has = value.some((t) => t.id === tag.id);
    onChange(has ? value.filter((t) => t.id !== tag.id) : [...value, tag]);
  };

  return (
    <div className="relative" ref={rootRef}>
      <div
        className="flex items-center flex-wrap gap-1.5 min-h-[36px] px-2 py-1.5 border border-slate-200 rounded-lg bg-white cursor-pointer hover:border-blue-300 transition-colors"
        onClick={() => setOpen((o) => !o)}
        title="点击选择标签"
      >
        {value.length === 0 && (
          <span className="inline-flex items-center gap-1 text-slate-400 text-sm px-1">
            <Plus size={13} /> {placeholder}
          </span>
        )}
        {value.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((x) => x.id !== t.id))} />
        ))}
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 overflow-hidden">
          {library.length === 0 ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              <TagsIcon size={14} className="mx-auto mb-1.5" />
              暂无标签，请先到「系统设置 → 标签管理」创建
            </div>
          ) : (
            <div className="max-h-52 overflow-y-auto py-1">
              {library.map((tag) => {
                const checked = value.some((t) => t.id === tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(tag);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-slate-50 transition-colors ${
                      checked ? "text-blue-700" : "text-slate-600"
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                        checked ? "bg-blue-500 border-blue-500" : "border-slate-300"
                      }`}
                    >
                      {checked && <Check size={10} className="text-white" />}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: normalizeTagColor(tag.color) }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
