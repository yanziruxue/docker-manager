/**
 * 导航页「分区 / 分组设置」弹窗（v1.52.0 三级结构；v1.52.3 改为左右分区布局）：
 *  - 左侧分上下：左上=分区列表（分区名右侧 ✎ 改名 / 🗑 删除），左下=当前分区下的分组列表（分组名右侧 ✎ 改名 / 🗑 删除）；
 *  - 右侧=该分区的外观配置（卡片布局 / 间距 / 大小 / 图标大小 / 卡片样式 / 图标形状）；
 *  - 分组仅为分类容器（v1.52.3），外观统一在分区级配置，该分区下所有分组共享。
 * v1.52.6：移除弹窗内的示意卡小样；标题栏改为可拖动，拖开后直接观察导航页实时效果。
 * v1.52.12：右侧新增「应用到其他分区」按钮，把当前分区的外观配置一键复制到其他所有分区。
 * v1.52.9：新建分区自动带一个与分区同名的默认分组；分区下至少保留一个分组（禁止删最后一组）。
 * 草稿仍经 onPreview 上抛给背景页实时渲染，仅 onSave(zones) 整体落盘。
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, CopyPlus, Move, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import type { NavCardStyle, NavGroup, NavIconShape, NavZone } from "../types";

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

/** 分区级外观默认值（v1.52.3 起外观归属分区） */
const DEFAULT_APPEARANCE = {
  cardLayout: "vertical" as const,
  cardSize: 120,
  gridGap: 16,
  iconSize: 48,
  cardStyle: "solid" as NavCardStyle,
  iconShape: "rounded" as NavIconShape,
  // v1.52.4：分区级间距（与改动前视觉一致：标签条 20 / 标题下 20 / 组间 32）
  zoneFirstGroupGap: 20,
  groupCardGapTop: 20,
  groupCardGapBottom: 32,
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
      <span className="text-[12px] text-slate-500 w-20 flex-shrink-0">{label}</span>
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

/** 内联改名：点击 ✎ 后名字变为输入框，自动聚焦；回车/失焦提交，Esc 取消 */
function InlineEdit({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      autoFocus
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onCommit(v.trim() || value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        else if (e.key === "Escape") setV(value);
      }}
      className={className}
    />
  );
}

export function NavGroupSettingsModal({
  zones,
  initialGroupId,
  initialZoneId,
  onSave,
  onClose,
  onPreview,
}: {
  /** 导航分区（v1.52.0）：分区 → 分组 → 卡片三级 */
  zones: NavZone[];
  /** 默认聚焦的分组（由某分组齿轮打开时传入，自动定位其父分区） */
  initialGroupId?: string;
  /** 默认选中的分区（v1.52.1：顶栏齿轮 = 设置当前分区；无 initialGroupId 时生效） */
  initialZoneId?: string;
  onSave: (zones: NavZone[]) => void;
  onClose: () => void;
  /** v1.52.5：草稿实时上抛给导航页预览；null = 撤销预览（取消/关闭恢复原状） */
  onPreview: (zones: NavZone[] | null) => void;
}) {
  const [draft, setDraft] = useState<NavZone[]>(() =>
    (zones || []).map((z) => {
      const groups: NavGroup[] = (z.groups || []).map((g) => ({ ...g, apps: [...(g.apps || [])] }));
      // v1.52.9：分区下至少一个分组——旧数据缺组时补一个与分区同名的默认分组
      if (groups.length === 0) groups.push({ id: genId(), name: z.name, apps: [] });
      return { ...z, groups };
    }),
  );
  // v1.52.5 事务性预览：保存则保留预览直到真实数据落盘，取消/关闭立即撤销 → 页面恢复
  const committed = useRef(false);
  useEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);
  useEffect(() => () => {
    if (!committed.current) onPreview(null);
  }, [onPreview]);

  // v1.52.6：标题栏可拖动——把弹窗挪开即可观察导航页（草稿实时渲染）的真实效果。
  // 采用 transform 偏移而非 absolute 定位，保持遮罩居中布局与响应式尺寸不变。
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number; startY: number; baseX: number; baseY: number; w: number; h: number;
  } | null>(null);
  // 拖动结束后紧跟的 click 会冒泡到遮罩；用它抑制「拖完顺手把弹窗关掉」
  const dragMovedRef = useRef(false);
  const onDragHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 标题栏上的按钮（✕ 等）与输入控件不触发拖动
    if ((e.target as HTMLElement).closest("button, input, select, textarea, [data-no-drag]")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      baseX: dragOffset.x, baseY: dragOffset.y,
      w: rect.width, h: rect.height,
    };
    dragMovedRef.current = false;
    e.preventDefault(); // 阻止拖选文本
  };
  useEffect(() => {
    const clamp = (v: number, min: number, max: number) => (min > max ? 0 : Math.min(Math.max(v, min), max));
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragMovedRef.current = true;
      // 面板初始居中：允许偏移到「只留 80px 在视口内」，再远就拖不出去（避免找不回弹窗）
      const maxX = Math.max(0, (window.innerWidth - d.w) / 2 + 80);
      const maxY = Math.max(0, (window.innerHeight - d.h) / 2 + 80);
      setDragOffset({ x: clamp(d.baseX + dx, -maxX, maxX), y: clamp(d.baseY + dy, -maxY, maxY) });
    };
    const onUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
      // click 在 pointerup 后派发，留到下一轮再清除标记供遮罩消费
      window.setTimeout(() => { dragMovedRef.current = false; }, 0);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  // 由 initialGroupId 解析父分区；否则回落 initialZoneId；再回落首个分区
  const resolveInitialZoneId = (): string => {
    if (initialGroupId && (zones || []).some((z) => (z.groups || []).some((g) => g.id === initialGroupId))) {
      return (zones || []).find((z) => (z.groups || []).some((g) => g.id === initialGroupId))!.id;
    }
    if (initialZoneId && (zones || []).some((z) => z.id === initialZoneId)) return initialZoneId;
    return (zones || [])[0]?.id || "";
  };
  const [selectedZoneId, setSelectedZoneId] = useState<string>(resolveInitialZoneId);
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);

  const activeZone = draft.find((z) => z.id === selectedZoneId) || null;

  const patchZone = (p: Partial<NavZone>) =>
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, ...p } : z)));
  // v1.52.12：把当前分区的外观配置（仅 9 个外观字段）一键应用到其他所有分区；不动名称 / 分组 / 项目
  const applyAppearanceToOthers = () => {
    if (!activeZone) return;
    const { cardLayout, cardSize, gridGap, iconSize, cardStyle, iconShape, zoneFirstGroupGap, groupCardGapTop, groupCardGapBottom } = activeZone;
    const appearance = { cardLayout, cardSize, gridGap, iconSize, cardStyle, iconShape, zoneFirstGroupGap, groupCardGapTop, groupCardGapBottom };
    setDraft((prev) => prev.map((z) => (z.id === activeZone.id ? z : { ...z, ...appearance })));
  };
  const renameZone = (id: string, name: string) =>
    setDraft((prev) =>
      prev.map((z) => {
        if (z.id !== id) return z;
        // v1.52.9：自动创建的默认分组与分区同名，分区改名时同步（用户手动改过名的分组不受影响）
        const groups = z.groups.map((g) => (g.name === z.name ? { ...g, name } : g));
        return { ...z, name, groups };
      }),
    );
  const renameGroup = (groupId: string, name: string) =>
    setDraft((prev) =>
      prev.map((z) => ({ ...z, groups: z.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) })),
    );

  // v1.52.4：分区 / 分组位置调整——数组顺序即展示顺序（↑↓ 按钮，不与卡片拖拽冲突）
  const moveZone = (id: string, delta: number) =>
    setDraft((prev) => {
      const i = prev.findIndex((z) => z.id === id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const moveGroup = (id: string, delta: number) =>
    setDraft((prev) =>
      prev.map((z) => {
        if (z.id !== selectedZoneId) return z;
        const groups = [...z.groups];
        const i = groups.findIndex((g) => g.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= groups.length) return z;
        [groups[i], groups[j]] = [groups[j], groups[i]];
        return { ...z, groups };
      }),
    );

  // 分区新建 / 删除
  const addZone = () => {
    // v1.52.9：创建分区即自动创建一个与分区同名的默认分组，分区下永不出现 0 分组
    const name = `分区 ${draft.length + 1}`;
    const z: NavZone = { id: genId(), name, groups: [{ id: genId(), name, apps: [] }] };
    setDraft((prev) => [...prev, z]);
    setSelectedZoneId(z.id);
    setEditingZoneId(z.id); // 新建后立即进入改名，操作顺畅
  };
  const removeZone = (id: string) => {
    const zone = draft.find((z) => z.id === id);
    if (!zone) return;
    const count = (zone.groups || []).reduce((s, g) => s + (g.apps?.length || 0), 0);
    if (!window.confirm(`确定删除分区「${zone.name}」？该分区下的 ${count} 个入口也会一并删除。`)) return;
    const idx = draft.findIndex((z) => z.id === id);
    const next = draft.filter((z) => z.id !== id);
    setDraft(next);
    const fallback = next[Math.min(idx, next.length - 1)];
    if (selectedZoneId === id) setSelectedZoneId(fallback?.id || "");
    if (editingZoneId === id) setEditingZoneId(null);
  };

  // 分组新建 / 删除（在当前选中分区下）
  const addGroup = () => {
    if (!activeZone) return;
    const g = { id: genId(), name: `分组 ${(activeZone.groups.length + 1)}`, apps: [] };
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, groups: [...z.groups, g] } : z)));
    setEditingGroupId(g.id); // 新建后立即进入改名
  };
  const removeGroup = (groupId: string) => {
    if (!activeZone) return;
    // v1.52.9：分区下至少保留一个分组，最后一组不允许删除
    if (activeZone.groups.length <= 1) return;
    const g = activeZone.groups.find((x) => x.id === groupId);
    if (!g) return;
    const count = g.apps?.length || 0;
    if (!window.confirm(`确定删除分组「${g.name}」？该分组下的 ${count} 个入口也会一并删除。`)) return;
    setDraft((prev) => prev.map((z) => (z.id === selectedZoneId ? { ...z, groups: z.groups.filter((x) => x.id !== groupId) } : z)));
    if (editingGroupId === groupId) setEditingGroupId(null);
  };

  // v1.52.9：允许删到 0 分区，但每个分区至少一个分组；禁止保存空名分区或空名分组
  const canSave = draft.every(
    (z) => z.name.trim().length > 0 && z.groups.length > 0 && z.groups.every((g) => g.name.trim().length > 0),
  );

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        // 刚拖动过标题栏时，pointerup 派发的 click 不应被当成「点遮罩关闭」
        if (dragMovedRef.current) { dragMovedRef.current = false; return; }
        onClose();
      }}
    >
      <div
        ref={panelRef}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden"
        style={{ transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* v1.52.6：标题栏即拖动手柄，按住拖开弹窗可观察导航页实时效果 */}
        <div
          onPointerDown={onDragHandlePointerDown}
          className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 cursor-grab active:cursor-grabbing select-none"
          title="按住标题栏拖动弹窗，拖开即可观察导航页效果"
        >
          <Move size={14} className="text-slate-400 flex-shrink-0" />
          <h3 className="text-base font-semibold text-slate-800">分区与分组设置</h3>
          <span className="text-[11px] text-slate-400">按住可拖动</span>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600" title="关闭">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex">
          {/* 左侧：上=分区列表，下=当前分区下的分组列表 */}
          <div className="w-[42%] min-w-[260px] flex flex-col border-r border-slate-100 bg-slate-50/40">
            {/* 左上：分区列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5 border-b border-slate-100">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">分区（共 {draft.length} 个）</p>
                <button
                  type="button"
                  onClick={addZone}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 rounded-md"
                  title="新建分区"
                >
                  <Plus size={11} /> 新建分区
                </button>
              </div>
              {draft.length === 0 ? (
                <p className="text-[12px] text-slate-400 px-1 py-2">还没有分区，点左上「＋ 新建分区」开始</p>
              ) : (
                draft.map((z, idx) => {
                  const selected = z.id === selectedZoneId;
                  return (
                    <div
                      key={z.id}
                      onClick={() => {
                        setSelectedZoneId(z.id);
                        setEditingGroupId(null);
                      }}
                      className={`group/row flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer border transition-colors ${
                        selected ? "bg-rose-50 border-rose-200" : "border-transparent hover:bg-white"
                      }`}
                    >
                      {editingZoneId === z.id ? (
                        <InlineEdit
                          value={z.name}
                          onCommit={(v) => {
                            renameZone(z.id, v);
                            setEditingZoneId(null);
                          }}
                          className="flex-1 px-1.5 py-1 text-[13px] border border-rose-300 rounded-md bg-white text-slate-700 focus:outline-none"
                        />
                      ) : (
                        <span className="flex-1 text-[13px] font-medium text-slate-700 truncate">{z.name}</span>
                      )}
                      <span className="flex items-center gap-0.5 flex-shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveZone(z.id, -1);
                          }}
                          disabled={idx === 0}
                          className="p-1 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded disabled:opacity-25 disabled:hover:bg-transparent"
                          title="上移分区"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveZone(z.id, 1);
                          }}
                          disabled={idx === draft.length - 1}
                          className="p-1 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded disabled:opacity-25 disabled:hover:bg-transparent"
                          title="下移分区"
                        >
                          <ArrowDown size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingZoneId(z.id);
                          }}
                          className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-100/60 rounded"
                          title="重命名分区"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeZone(z.id);
                          }}
                          className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-100/60 rounded"
                          title="删除分区"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            {/* 左下：当前分区下的分组列表 */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase truncate">
                  分组（{activeZone?.name || "—"}）
                </p>
                <button
                  type="button"
                  onClick={addGroup}
                  disabled={!activeZone}
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[11px] text-rose-600 hover:bg-rose-50 rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
                  title="在当前分区下新建分组"
                >
                  <Plus size={11} /> 新建分组
                </button>
              </div>
              {!activeZone ? (
                <p className="text-[12px] text-slate-400 px-1 py-2">请先选择或新建一个分区</p>
              ) : activeZone.groups.length === 0 ? (
                <p className="text-[12px] text-slate-400 px-1 py-2">该分区下至少保留一个分组，请点右上「＋ 新建分组」</p>
              ) : (
                activeZone.groups.map((g, idx) => (
                  <div
                    key={g.id}
                    className="group/row flex items-center gap-2 px-2.5 py-2 rounded-lg border border-transparent hover:bg-white transition-colors"
                  >
                    {editingGroupId === g.id ? (
                      <InlineEdit
                        value={g.name}
                        onCommit={(v) => {
                          renameGroup(g.id, v);
                          setEditingGroupId(null);
                        }}
                        className="flex-1 px-1.5 py-1 text-[13px] border border-rose-300 rounded-md bg-white text-slate-700 focus:outline-none"
                      />
                    ) : (
                      <span className="flex-1 text-[13px] text-slate-600 truncate">{g.name}</span>
                    )}
                    <span className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => moveGroup(g.id, -1)}
                        disabled={idx === 0}
                        className="p-1 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded disabled:opacity-25 disabled:hover:bg-transparent"
                        title="上移分组"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => moveGroup(g.id, 1)}
                        disabled={idx === activeZone.groups.length - 1}
                        className="p-1 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-50 rounded disabled:opacity-25 disabled:hover:bg-transparent"
                        title="下移分组"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGroupId(g.id)}
                        className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-100/60 rounded"
                        title="重命名分组"
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeGroup(g.id)}
                        disabled={activeZone.groups.length <= 1}
                        className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-100/60 rounded disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent"
                        title={activeZone.groups.length <= 1 ? "分区下至少保留一个分组" : "删除分组"}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* 右侧：分区外观配置（v1.52.3 起外观归属分区，该分区下所有分组共享） */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {!activeZone ? (
              <p className="text-[12px] text-slate-400">请选择左侧分区以配置其卡片外观</p>
            ) : (
              <>
                {/* v1.52.6：移除示意卡小样——把弹窗拖开直接看导航页真实卡片，效果与保存后一致 */}
                <p className="text-[11px] text-slate-400">
                  改动即时作用于导航页；按住标题栏拖开弹窗即可观察，保存后生效 · 取消恢复
                </p>

                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">分区配置 · {activeZone.name}</p>
                  <div className="flex items-center gap-1.5">
                    {/* v1.52.12：把当前分区外观配置一键应用到其他所有分区（仅 1 个分区时无意义，禁用） */}
                    <button
                      type="button"
                      onClick={applyAppearanceToOthers}
                      disabled={draft.length <= 1}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-fuchsia-600 border border-fuchsia-200 rounded-lg hover:bg-fuchsia-50 disabled:opacity-40 disabled:cursor-not-allowed"
                      title="把该分区的卡片外观配置（布局/间距/大小/样式/形状）应用到其他所有分区"
                    >
                      <CopyPlus size={11} /> 应用到其他分区
                    </button>
                    <button
                      type="button"
                      onClick={() => patchZone({ ...DEFAULT_APPEARANCE })}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                      title="恢复该分区的外观默认设置"
                    >
                      <RotateCcw size={11} /> 恢复默认
                    </button>
                  </div>
                </div>

                <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">卡片布局</p>
                  <Segmented
                    value={activeZone.cardLayout || "vertical"}
                    options={[
                      { value: "vertical", label: "垂直" },
                      { value: "horizontal", label: "水平" },
                    ]}
                    onChange={(v) => patchZone({ cardLayout: v })}
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">垂直=图标在上；水平=图标在左、文字在右</p>
                </section>

                <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2.5">
                  <p className="text-xs font-medium text-slate-600">布局与间距（参照 FlatNas）</p>
                  <SliderRow
                    label="卡片间距"
                    value={activeZone.gridGap ?? 16}
                    min={0}
                    max={60}
                    unit="px"
                    onChange={(v) => patchZone({ gridGap: v })}
                  />
                  <SliderRow
                    label="卡片大小"
                    value={activeZone.cardSize ?? 120}
                    min={60}
                    max={240}
                    unit="px"
                    onChange={(v) => patchZone({ cardSize: v })}
                  />
                  <SliderRow
                    label="图标大小"
                    value={activeZone.iconSize ?? 48}
                    min={16}
                    max={96}
                    unit="px"
                    onChange={(v) => patchZone({ iconSize: v })}
                  />
                </section>

                {/* v1.52.4：分区级间距——首组距分区（仅第一个分组）+ 标题/卡片上下间距（全部分组） */}
                <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3 space-y-2.5">
                  <p className="text-xs font-medium text-slate-600">分组间距</p>
                  <SliderRow
                    label="首组距分区"
                    value={activeZone.zoneFirstGroupGap ?? 20}
                    min={0}
                    max={120}
                    unit="px"
                    onChange={(v) => patchZone({ zoneFirstGroupGap: v })}
                  />
                  <SliderRow
                    label="标题→卡片"
                    value={activeZone.groupCardGapTop ?? 20}
                    min={0}
                    max={120}
                    unit="px"
                    onChange={(v) => patchZone({ groupCardGapTop: v })}
                  />
                  <SliderRow
                    label="卡片→下组"
                    value={activeZone.groupCardGapBottom ?? 32}
                    min={0}
                    max={120}
                    unit="px"
                    onChange={(v) => patchZone({ groupCardGapBottom: v })}
                  />
                  <p className="text-[11px] text-slate-400">「首组距分区」仅作用于该分区下第一个分组；上下间距对该分区所有分组生效</p>
                </section>

                <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">卡片样式（参照 FlatNas）</p>
                  <Segmented
                    value={activeZone.cardStyle || "solid"}
                    options={CARD_STYLE_OPTIONS}
                    onChange={(v) => patchZone({ cardStyle: v })}
                  />
                  <p className="text-[11px] text-slate-400 mt-1.5">实色/玻璃/扁平/描边/透明，对应卡片背景与圆角外观</p>
                </section>

                <section className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">图标形状（全部形状平铺，参照 FlatNas）</p>
                  {/* v1.52.5：10 种形状一次性平铺，不再收进下拉框 */}
                  <Segmented
                    value={activeZone.iconShape || "rounded"}
                    options={ICON_SHAPE_OPTIONS}
                    onChange={(v) => patchZone({ iconShape: v })}
                  />
                </section>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100">
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            取消
          </button>
          <button
            onClick={() => {
              if (!canSave) return;
              committed.current = true;
              onSave(draft);
            }}
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
