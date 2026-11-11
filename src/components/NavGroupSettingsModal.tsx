/**
 * 导航页「分组设置」弹窗（v1.51.9）：作用于单个分组的卡片外观，与「页面设置」（整页外观/环境）解耦。
 * 参照 FlatNas「分组设置详情」：分组名称 / 卡片布局 / 卡片间距 / 卡片大小 / 图标大小 / 卡片样式 / 图标形状。
 * 顶部「分组」下拉可切换要设置的分组；保存经 onSave(groups) 整体落盘（服务端 normalizeNavGroups 白名单兜底）。
 */
import { useState } from "react";
import { RotateCcw, X } from "lucide-react";
import type { NavCardStyle, NavGroup, NavIconShape } from "../types";

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400 bg-white text-slate-700";

/** 卡片样式预设（参照 FlatNas 卡片外观：背景色/透明度/背景显示状态/圆角） */
const CARD_STYLE_OPTIONS: { value: NavCardStyle; label: string }[] = [
  { value: "solid", label: "实色" },
  { value: "glass", label: "玻璃" },
  { value: "flat", label: "扁平" },
  { value: "outline", label: "描边" },
  { value: "transparent", label: "透明" },
];

/** 图标形状（与 FlatNas iconShape 枚举对齐） */
const ICON_SHAPE_OPTIONS: { value: NavIconShape; label: string }[] = [
  { value: "rounded", label: "圆角矩形" },
  { value: "circle", label: "圆形" },
  { value: "square", label: "方形" },
  { value: "leaf", label: "叶形" },
  { value: "diamond", label: "菱形" },
  { value: "pentagon", label: "五边形" },
  { value: "hexagon", label: "六边形" },
  { value: "octagon", label: "八边形" },
  { value: "none", label: "无形状（图标原样）" },
  { value: "hidden", label: "不使用图标" },
];

const DEFAULT_APPEARANCE = {
  cardLayout: "vertical" as const,
  cardSize: 120,
  gridGap: 16,
  iconSize: 48,
  cardStyle: "solid" as NavCardStyle,
  iconShape: "rounded" as NavIconShape,
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2.5 py-1 text-[12px] rounded-md border ${
            value === o.value
              ? "bg-rose-50 text-rose-600 border-rose-300"
              : "bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[12px] text-slate-500 w-16 flex-shrink-0">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-rose-500"
      />
      <span className="text-[11px] text-slate-500 w-12 text-right">{value}{unit}</span>
    </div>
  );
}

export function NavGroupSettingsModal({
  groups,
  initialGroupId,
  onSave,
  onClose,
}: {
  groups: NavGroup[];
  /** 默认聚焦的分组（导航页当前选中分组） */
  initialGroupId?: string;
  onSave: (groups: NavGroup[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavGroup[]>(() =>
    (groups || []).map((g) => ({ ...g, apps: [...(g.apps || [])] })),
  );
  const [selectedId, setSelectedId] = useState<string>(() =>
    initialGroupId && groups.some((g) => g.id === initialGroupId)
      ? initialGroupId
      : groups[0]?.id || "",
  );
  const active = draft.find((g) => g.id === selectedId) || null;

  const patch = (p: Partial<NavGroup>) =>
    setDraft((prev) => prev.map((g) => (g.id === selectedId ? { ...g, ...p } : g)));

  const canSave = !!active && !!active.name.trim();

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">分组设置</h3>
          <div className="flex-1" />
          {draft.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-400">分组</span>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className="px-2 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/30 max-w-[140px]"
              >
                {draft.map((g) => (
                  <option key={g.id} value={g.id}>{g.name || "未命名"}</option>
                ))}
              </select>
            </div>
          )}
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!active ? (
            <p className="text-[13px] text-slate-400 py-8 text-center">
              还没有分组，请先到「管理分组」新建一个分组
            </p>
          ) : (
            <>
              {/* 分组名称 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">分组名称</p>
                <input
                  className={inputCls}
                  value={active.name}
                  onChange={(e) => patch({ name: e.target.value })}
                  placeholder="例如：常用服务"
                />
              </section>

              {/* 卡片布局 */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">卡片布局</p>
                <Segmented
                  value={active.cardLayout || "vertical"}
                  options={[
                    { value: "vertical", label: "垂直" },
                    { value: "horizontal", label: "水平" },
                  ]}
                  onChange={(v) => patch({ cardLayout: v })}
                />
                <p className="text-[11px] text-slate-400 mt-1.5">垂直=图标在上；水平=图标在左、文字在右</p>
              </section>

              {/* 间距 / 大小 / 图标大小（参照 FlatNas） */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-600">布局与间距（参照 FlatNas）</p>
                <SliderRow
                  label="卡片间距"
                  value={active.gridGap ?? 16}
                  min={0}
                  max={60}
                  unit="px"
                  onChange={(v) => patch({ gridGap: v })}
                />
                <SliderRow
                  label="卡片大小"
                  value={active.cardSize ?? 120}
                  min={60}
                  max={240}
                  unit="px"
                  onChange={(v) => patch({ cardSize: v })}
                />
                <SliderRow
                  label="图标大小"
                  value={active.iconSize ?? 48}
                  min={16}
                  max={96}
                  unit="px"
                  onChange={(v) => patch({ iconSize: v })}
                />
              </section>

              {/* 卡片样式（参照 FlatNas 卡片外观） */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">卡片样式（参照 FlatNas）</p>
                <Segmented
                  value={active.cardStyle || "solid"}
                  options={CARD_STYLE_OPTIONS}
                  onChange={(v) => patch({ cardStyle: v })}
                />
                <p className="text-[11px] text-slate-400 mt-1.5">实色/玻璃/扁平/描边/透明，对应卡片背景与圆角外观</p>
              </section>

              {/* 图标形状（参照 FlatNas iconShape） */}
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">图标形状（参照 FlatNas）</p>
                <select
                  className={inputCls}
                  value={active.iconShape || "rounded"}
                  onChange={(e) => patch({ iconShape: e.target.value as NavIconShape })}
                >
                  {ICON_SHAPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
          {active && (
            <button
              type="button"
              onClick={() => patch(DEFAULT_APPEARANCE)}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
              title="仅恢复当前分组的外观设置，不影响名称与入口"
            >
              <RotateCcw size={12} /> 恢复默认
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={() => canSave && onSave(draft)}
            disabled={!canSave}
            className="px-4 py-1.5 text-sm text-white bg-rose-500 rounded-lg hover:bg-rose-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
