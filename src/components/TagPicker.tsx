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

/** 多选标签选择器（v1.49.2 combobox）：输入框即触发框——已选 chips 与 inline 输入同行，
 * 输入实时过滤标签库下拉；无匹配时显示「+ 新建」项，点选经 onCreateTag 落盘标签库并自动选中新标签 */
export function TagSelect({
  library,
  value,
  onChange,
  onCreateTag,
  placeholder = "添加标签",
}: {
  library: ResourceTag[];
  value: ResourceTag[];
  onChange: (next: ResourceTag[]) => void;
  /** 输入内容无匹配时的新建回调：落盘标签库并返回新标签（返回 null 表示失败）；未提供则不显示新建入口 */
  onCreateTag?: (name: string) => Promise<ResourceTag | null>;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  /** inline 输入：过滤标签库；非空且无同名命中时显示「+ 新建」 */
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 收起时清空过滤输入与错误提示
  useEffect(() => {
    if (!open) {
      setQuery("");
      setCreateError("");
    }
  }, [open]);

  // 点击外部 / Escape 关闭
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

  // 输入过滤（大小写不敏感子串匹配）
  const q = query.trim().toLowerCase();
  const filtered = q ? library.filter((t) => (t.name || "").toLowerCase().includes(q)) : library;
  // 「新建」条件：提供了回调 + 输入非空 + 标签库无同名标签（大小写不敏感）
  const canCreate = !!onCreateTag && q.length > 0 && !library.some((t) => (t.name || "").toLowerCase() === q);

  const handleCreate = async () => {
    if (!onCreateTag || !q || creating) return;
    setCreating(true);
    setCreateError("");
    try {
      const tag = await onCreateTag(query.trim());
      if (tag && tag.id) {
        onChange([...value, tag]);
        setQuery("");
      } else {
        setCreateError("新建失败，请重试");
      }
    } catch {
      setCreateError("新建失败，请重试");
    } finally {
      setCreating(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      {/* 触发框 = 输入框：chips 与 inline 输入同行，点击任意处聚焦输入 */}
      <div
        className="flex items-center flex-wrap gap-1.5 min-h-[36px] px-2 py-1.5 border border-slate-200 rounded-lg bg-white cursor-text hover:border-blue-300 focus-within:border-blue-400 transition-colors"
        onClick={() => inputRef.current?.focus()}
        title="输入筛选标签，无匹配可新建"
      >
        {value.map((t) => (
          <TagChip key={t.id} tag={t} onRemove={() => onChange(value.filter((x) => x.id !== t.id))} />
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setCreateError(""); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (canCreate) handleCreate();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          placeholder={value.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[90px] bg-transparent outline-none border-none text-sm text-slate-700 placeholder:text-slate-400 px-0.5 py-0"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white rounded-lg border border-slate-200 shadow-lg z-50 overflow-hidden">
          {/* 新建入口：输入非空且标签库无同名标签时显示 */}
          {canCreate && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                handleCreate();
              }}
              disabled={creating}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-60 border-b border-slate-100"
            >
              <Plus size={14} className="flex-shrink-0" />
              <span className="truncate">新建「{query.trim()}」</span>
            </button>
          )}
          {createError && (
            <div className="px-3 py-1.5 text-xs text-red-500 border-b border-slate-100">{createError}</div>
          )}

          {library.length === 0 && !canCreate ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">
              <TagsIcon size={14} className="mx-auto mb-1.5" />
              {onCreateTag ? "输入名称新建标签" : "暂无标签，请先到「系统设置 → 标签管理」创建"}
            </div>
          ) : filtered.length === 0 && !canCreate ? (
            <div className="px-3 py-4 text-xs text-slate-400 text-center">无匹配标签</div>
          ) : (
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.map((tag) => {
                const checked = value.some((t) => t.id === tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
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
