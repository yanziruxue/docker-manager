/**
 * 导航页「分区 / 分组设置」弹窗（v1.52.0 升级为三级结构管理）：
 *  - 顶层管理「分区」（新建 / 改名 / 删除分区）；
 *  - 在所选分区下管理「分组」（新建 / 改名 / 删除分组 + 分组卡片外观）。
 * 分组卡片外观参数（布局 / 间距 / 大小 / 图标大小 / 样式 / 形状）参照 FlatNas。
 * 保存经 onSave(zones) 整体落盘（服务端 normalizeNavZones 白名单兜底）。
 * v1.51.11 起接管分组的新建 / 删除（允许删到 0 组 / 0 分区）。
 */
import { useState } from "react";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { NavCardStyle, NavGroup, NavIconShape, NavZone } from "../types";

const inputCls =
  "w-full px-2.5 py-1.5 text-[13px] border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/30 focus:border-rose-400 bg-white text-slate-700";

/** 随机 id（与项目弹窗同风格：时间戳 36 进制 + 随机尾） */
function genId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

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
  zones,
  initialGroupId,
  initialZoneId,
  onSave,
  onClose,
}: {
  /** 导航分区（v1.52.0）：分区 → 分组 → 卡片三级 */
  zones: NavZone[];
  /** 默认聚焦的分组（由某分组齿轮打开时传入，自动定位其父分区） */
  initialGroupId?: string;
  /** 默认选中的分区（v1.52.1：顶栏齿轮 = 设置当前分区；无 initialGroupId 时生效） */
  initialZoneId?: string;
  onSave: (zones: NavZone[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<NavZone[]>(() =>
    (zones || []).map((z) => ({ ...z, groups: (z.groups || []).map((g) => ({ ...g, apps: [...(g.apps || [])] })) })),
  );
  // 由 initialGroupId 解析父分区；否则回落 initialZoneId；再回落首个分区
  const resolveInitialZoneId = (): string => {
    if (initialGroupId && (zones || []).some((z) => (z.groups || []).some((g) => g.id === initialGroupId))) {
      return (zones || []).find((z) => (z.groups || []).some((g) => g.id === initialGroupId))!.id;
    }
    if (initialZoneId && (zones || []).some((z) => z.id === initialZoneId)) return initialZoneId;
    return (zones || [])[0]?.id || "";
  };
  const [selectedZoneId, setSelectedZoneId] = useState<string>(resolveInitialZoneId);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(() => {
    if (initialGroupId && (zones || []).some((z) => (z.groups || []).some((g) => g.id === initialGroupId))) {
      return initialGroupId;
    }
    const z = (zones || []).find((zz) => zz.id === resolveInitialZoneId());
    return z?.groups?.[0]?.id || "";
  });

  const activeZone = draft.find((z) => z.id === selectedZoneId) || null;
  const activeGroup = activeZone?.groups.find((g) => g.id === selectedGroupId) || null;

  const patchZone = (p: Partial<NavZone>) =>
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, ...p } : z)));
  const patchGroup = (p: Partial<NavGroup>) =>
    setDraft((prev) =>
      prev.map((z) =>
        z.id === selectedZoneId
          ? { ...z, groups: z.groups.map((g) => (g.id === selectedGroupId ? { ...g, ...p } : g)) }
          : z,
      ),
    );

  // 分区新建 / 删除
  const addZone = () => {
    const z: NavZone = { id: genId(), name: `分区 ${draft.length + 1}`, groups: [] };
    setDraft((prev) => [...prev, z]);
    setSelectedZoneId(z.id);
    setSelectedGroupId("");
  };
  const removeZone = () => {
    if (!activeZone) return;
    const count = (activeZone.groups || []).reduce((s, g) => s + (g.apps?.length || 0), 0);
    if (!window.confirm(`确定删除分区「${activeZone.name}」？该分区下的 ${count} 个入口也会一并删除。`)) return;
    const idx = draft.findIndex((z) => z.id === selectedZoneId);
    const next = draft.filter((z) => z.id !== selectedZoneId);
    setDraft(next);
    const z = next[Math.min(idx, next.length - 1)];
    setSelectedZoneId(z?.id || "");
    setSelectedGroupId(z?.groups?.[0]?.id || "");
  };

  // 分组新建 / 删除（在所选分区下）
  const addGroup = () => {
    if (!activeZone) return;
    const g: NavGroup = {
      id: genId(),
      name: `分组 ${(activeZone.groups.length + 1)}`,
      apps: [],
      ...DEFAULT_APPEARANCE,
    };
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, groups: [...z.groups, g] } : z)));
    setSelectedGroupId(g.id);
  };
  const removeGroup = () => {
    if (!activeZone || !activeGroup) return;
    const count = activeGroup.apps?.length || 0;
    if (!window.confirm(`确定删除分组「${activeGroup.name}」？该分组下的 ${count} 个入口也会一并删除。`)) return;
    const nextGroups = activeZone.groups.filter((g) => g.id !== selectedGroupId);
    const idx = activeZone.groups.findIndex((g) => g.id === selectedGroupId);
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, groups: nextGroups } : z)));
    setSelectedGroupId(nextGroups[Math.min(idx, nextGroups.length - 1)]?.id || "");
  };

  // 允许删到 0 分区 / 0 分组；禁止保存空名分区或空名分组
  const canSave = draft.every((z) => z.name.trim().length > 0 && z.groups.every((g) => g.name.trim().length > 0));

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
          <h3 className="text-base font-semibold text-slate-800">分区与分组设置</h3>
          <div className="flex-1" />
          <button
            type="button"
            onClick={addZone}
            className="flex items-center gap-1 px-2.5 py-1 text-[12px] text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
            title="新建一个导航分区"
          >
            <Plus size={12} /> 新建分区
          </button>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* 分区选择 */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">分区（顶部一级标签页）</p>
            {draft.length === 0 ? (
              <p className="text-[12px] text-slate-400">还没有分区，点右上角「新建分区」开始</p>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={selectedZoneId}
                  onChange={(e) => {
                    setSelectedZoneId(e.target.value);
                    const z = draft.find((zz) => zz.id === e.target.value);
                    setSelectedGroupId(z?.groups?.[0]?.id || "");
                  }}
                  className="flex-1 px-2 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                >
                  {draft.map((z) => (
                    <option key={z.id} value={z.id}>{z.name || "未命名"}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={removeZone}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  title="删除当前分区及其全部入口"
                >
                  <Trash2 size={11} /> 删除分区
                </button>
              </div>
            )}
            {activeZone && (
              <input
                className={`${inputCls} mt-2`}
                value={activeZone.name}
                onChange={(e) => patchZone({ name: e.target.value })}
                placeholder="分区名称，如：FNOS"
              />
            )}
          </section>

          {/* 分组选择（在所选分区下） */}
          <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
            <p className="text-xs font-medium text-slate-600 mb-2">分组（分区下的卡片区块）</p>
            {!activeZone ? (
              <p className="text-[12px] text-slate-400">请先选择或新建一个分区</p>
            ) : activeZone.groups.length === 0 ? (
              <button
                type="button"
                onClick={addGroup}
                className="flex items-center gap-1 px-3 py-1.5 text-[12px] text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
              >
                <Plus size={13} /> 新建分组
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <select
                  value={selectedGroupId}
                  onChange={(e) => setSelectedGroupId(e.target.value)}
                  className="flex-1 px-2 py-1 text-[12px] border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
                >
                  {activeZone.groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name || "未命名"}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={addGroup}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-rose-600 border border-rose-200 rounded-lg hover:bg-rose-50"
                  title="在当前分区下新建分组"
                >
                  <Plus size={11} /> 新建分组
                </button>
                <button
                  type="button"
                  onClick={removeGroup}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                  title="删除当前分组及其全部入口"
                >
                  <Trash2 size={11} /> 删除分组
                </button>
              </div>
            )}
          </section>

          {/* 分组外观（选中分组时显示） */}
          {activeGroup && (
            <>
              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">分组名称</p>
                <input
                  className={inputCls}
                  value={activeGroup.name}
                  onChange={(e) => patchGroup({ name: e.target.value })}
                  placeholder="例如：常用服务"
                />
              </section>

              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">卡片布局</p>
                <Segmented
                  value={activeGroup.cardLayout || "vertical"}
                  options={[
                    { value: "vertical", label: "垂直" },
                    { value: "horizontal", label: "水平" },
                  ]}
                  onChange={(v) => patchGroup({ cardLayout: v })}
                />
                <p className="text-[11px] text-slate-400 mt-1.5">垂直=图标在上；水平=图标在左、文字在右</p>
              </section>

              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-600">布局与间距（参照 FlatNas）</p>
                <SliderRow
                  label="卡片间距"
                  value={activeGroup.gridGap ?? 16}
                  min={0}
                  max={60}
                  unit="px"
                  onChange={(v) => patchGroup({ gridGap: v })}
                />
                <SliderRow
                  label="卡片大小"
                  value={activeGroup.cardSize ?? 120}
                  min={60}
                  max={240}
                  unit="px"
                  onChange={(v) => patchGroup({ cardSize: v })}
                />
                <SliderRow
                  label="图标大小"
                  value={activeGroup.iconSize ?? 48}
                  min={16}
                  max={96}
                  unit="px"
                  onChange={(v) => patchGroup({ iconSize: v })}
                />
              </section>

              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">卡片样式（参照 FlatNas）</p>
                <Segmented
                  value={activeGroup.cardStyle || "solid"}
                  options={CARD_STYLE_OPTIONS}
                  onChange={(v) => patchGroup({ cardStyle: v })}
                />
                <p className="text-[11px] text-slate-400 mt-1.5">实色/玻璃/扁平/描边/透明，对应卡片背景与圆角外观</p>
              </section>

              <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="text-xs font-medium text-slate-600 mb-2">图标形状（参照 FlatNas）</p>
                <select
                  className={inputCls}
                  value={activeGroup.iconShape || "rounded"}
                  onChange={(e) => patchGroup({ iconShape: e.target.value as NavIconShape })}
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
          {activeGroup && (
            <>
              <button
                type="button"
                onClick={() => patchGroup(DEFAULT_APPEARANCE)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                title="仅恢复当前分组的外观设置，不影响名称与入口"
              >
                <RotateCcw size={12} /> 恢复默认
              </button>
              <button
                type="button"
                onClick={removeGroup}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                title="删除当前分组及其全部入口"
              >
                <Trash2 size={12} /> 删除分组
              </button>
            </>
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
