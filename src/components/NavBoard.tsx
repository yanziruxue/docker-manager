/**
 * 导航仪表盘卡片墙（v1.51.0，label 分支）：渲染一个导航分组的应用卡片，
 * 点击按内外网分区解析地址后打开（复用 v1.50.36 的 zone 判定与解析器语义）。
 * 图标解析优先级：完整 URL（http(s)/data:/api/）原样 > 自定义图标库按名匹配 > 首字母色块。
 * 自包含：自行拉取 /api/custom-icons 与 /api/network-zone（失败分别回落空映射 / intranet）。
 * v1.51.7：支持分组级卡片布局/大小/间距/图标大小（参照 FlatNas）与 ext 外链直开、self 备用地址回退。
 * v1.51.11：卡片 hover 显示「✎」直达项目编辑弹窗（旧管理弹窗齿轮入口一并移除）。
 * v1.51.12：分组标题行「＋」右边恢复齿轮扳手，作为「分组设置」唯一入口（不再指向已删除的管理弹窗）。
 */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ExternalLink, Pencil, Settings } from "lucide-react";
import type { NavAppItem, NavCardStyle, NavGroup, NavIconShape, NavNetworkMode } from "../types";
import { getNetworkZoneApi, listCustomIconsApi } from "../api";
import { resolveNavAppUrl, type WebuiZone, type WebuiZoneMode } from "../webui-url";
import type { CustomIconsPayload } from "../custom-icons";

const EMPTY_ICONS: CustomIconsPayload = { bound: false, dir: "", error: "", entries: [], map: {} };

/** 图标字段 → 可直接作为 <img src> 的地址；空串 = 无图标（渲染首字母色块） */
export function resolveNavIconSrc(icon: string | undefined, map: Record<string, string>): string {
  const v = String(icon || "").trim();
  if (!v) return "";
  if (/^(https?:\/\/|data:|\/api\/)/i.test(v)) return v;
  return map[v.toLowerCase()] || "";
}

/** 任意地址归一化：http(s) 原样；`:端口` → 浏览器协议+地址栏host+端口；其余 → 协议+值 */
function normalizeAny(v: string, loc: { protocol: string; hostname: string }): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith(":")) return `${loc.protocol}//${loc.hostname}${s}`;
  return `${loc.protocol}//${s}`;
}

/** 解析卡片点击地址：ext=直接打开链接；self=内外网分区 + 主地址为空时回退备用地址 */
function resolveCardUrl(
  app: NavAppItem,
  mode: WebuiZoneMode,
  zone: WebuiZone,
  loc: { protocol: string; hostname: string },
): string {
  if (app.kind === "ext") return normalizeAny(app.url || "", loc);
  const primary = resolveNavAppUrl(app, mode, zone, loc);
  if (primary) return primary;
  // 自托管主地址为空 → 外网/内网备用地址按序回退
  const backups = [...(app.urlBackups || []), ...(app.lanBackups || [])].map((x) => normalizeAny(x, loc)).filter(Boolean);
  return backups[0] || "";
}

/** 卡片样式预设（v1.51.9，参照 FlatNas 卡片外观）：背景/描边/阴影/透明度 */
const CARD_STYLE_CLS: Record<NavCardStyle, string> = {
  solid: "bg-white/95 border border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5",
  glass: "bg-white/25 backdrop-blur-md border border-white/40 shadow-sm hover:bg-white/35",
  flat: "bg-white/70 border-0 shadow-none hover:bg-white/85",
  outline: "bg-transparent border border-white/70 shadow-none hover:bg-white/10",
  transparent: "bg-transparent border-0 shadow-none hover:bg-white/10",
};

/** 图标形状（v1.51.9，与 FlatNas iconShape 枚举对齐）：仅作用于背景层，图标本体不被裁切 */
const ICON_SHAPE_STYLE: Record<NavIconShape, CSSProperties> = {
  rounded: { borderRadius: 12 },
  circle: { borderRadius: "50%" },
  square: { borderRadius: 2 },
  leaf: { borderRadius: "50% 12% 50% 12%" },
  diamond: { clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" },
  pentagon: { clipPath: "polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)" },
  hexagon: { clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)" },
  octagon: { clipPath: "polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)" },
  none: {},
  hidden: {},
};

function AppCard({
  app,
  iconMap,
  url,
  layout,
  cardSize,
  iconSize,
  cardStyle,
  iconShape,
  groupForDnd,
  draggableCard,
  onCardDragStart,
  onCardDragEnd,
  onCardDrop,
}: {
  app: NavAppItem;
  iconMap: Record<string, string>;
  url: string;
  /** vertical=图标在上；horizontal=图标在左、文字在右 */
  layout: "vertical" | "horizontal";
  /** 卡片宽度 px */
  cardSize: number;
  /** 图标尺寸 px */
  iconSize: number;
  /** 分组卡片样式预设 */
  cardStyle: NavCardStyle;
  /** 分组图标形状 */
  iconShape: NavIconShape;
  /** 拖拽归属分组 id（全部视图下为真实分组，由 resolveGroupOf 解析） */
  groupForDnd?: string;
  /** 编辑态可拖拽（v1.51.19） */
  draggableCard?: boolean;
  onCardDragStart?: (appId: string, groupId: string) => void;
  onCardDragEnd?: () => void;
  onCardDrop?: (appId: string, groupId: string) => void;
}) {
  const src = resolveNavIconSrc(app.icon, iconMap);
  const open = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  };
  const titleColor = app.titleColor || "#334155";
  const box = iconSize;
  const inner = Math.round(iconSize * 0.74);
  // 描述（v1.51.9）：新数据用 description（卡片副标题）；旧数据无该字段时回落 remark
  const subtitle = app.description !== undefined ? app.description : app.remark || "";
  // 悬浮提示：第一行名称、第二行描述（长名称被截断时悬浮显示完整名+描述）；不再显示链接与备注（v1.51.19）
  const hoverTitle = `${app.name}${app.description ? "\n" + app.description : ""}`;
  const styleCls = CARD_STYLE_CLS[cardStyle] || CARD_STYLE_CLS.solid;
  const shapeHidden = iconShape === "hidden";
  // 默认 rounded 且已有图标时保持透明（与 v1.51.8 视觉一致）；其他形状给淡底让轮廓可见
  const shapeBg =
    shapeHidden || iconShape === "none"
      ? undefined
      : iconShape === "rounded"
        ? app.iconColor && !src
          ? app.iconColor
          : undefined
        : app.iconColor || "rgba(255,255,255,0.75)";

  const iconBlock = shapeHidden ? null : (
    <span
      className="relative flex items-center justify-center flex-shrink-0"
      style={{ width: box, height: box }}
    >
      {shapeBg && (
        <span
          className="absolute inset-0"
          style={{ background: shapeBg, ...(ICON_SHAPE_STYLE[iconShape] || {}) }}
          aria-hidden="true"
        />
      )}
      {src ? (
        <img src={src} alt={app.name} style={{ width: inner, height: inner }} className="relative object-contain" draggable={false} />
      ) : (
        <span className="relative font-bold text-white" style={{ fontSize: Math.round(iconSize * 0.4) }}>
          {(app.name || "?").slice(0, 1).toUpperCase()}
        </span>
      )}
    </span>
  );

  if (layout === "horizontal") {
    return (
      <button
        onClick={open}
        disabled={!url}
        title={hoverTitle}
        draggable={draggableCard}
        onDragStart={(e) => { if (onCardDragStart) { e.stopPropagation(); onCardDragStart(app.id, groupForDnd || ""); } }}
        onDragEnd={() => onCardDragEnd?.()}
        className={`group relative flex items-center gap-3 px-4 py-3 rounded-2xl ${styleCls} transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0`}
        style={{ width: cardSize + 56 }}
      >
        {iconBlock}
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate" style={{ color: titleColor }}>{app.name}</div>
          {subtitle && <div className="text-[11px] text-slate-400 truncate whitespace-pre-line">{subtitle}</div>}
        </div>
        {url && (
          <ExternalLink size={12} className="absolute top-2 right-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </button>
    );
  }

  return (
      <button
        onClick={open}
        disabled={!url}
        title={hoverTitle}
        draggable={draggableCard}
        onDragStart={(e) => { if (onCardDragStart) { e.stopPropagation(); onCardDragStart(app.id, groupForDnd || ""); } }}
        onDragEnd={() => onCardDragEnd?.()}
        className={`group relative flex flex-col items-center gap-2 p-4 rounded-2xl ${styleCls} transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0`}
      style={{ width: cardSize }}
    >
      {iconBlock}
      <span className="text-[13px] font-medium truncate w-full text-center" style={{ color: titleColor }}>{app.name}</span>
      {subtitle && <span className="text-[11px] text-slate-400 truncate w-full text-center -mt-1.5">{subtitle}</span>}
      {url && (
        <ExternalLink
          size={12}
          className="absolute top-2 right-2 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity"
        />
      )}
    </button>
  );
}

export function NavBoard({
  group,
  iconMap,
  editMode,
  onAddApp,
  onEditApp,
  onOpenGroupSettings,
  navNetworkMode,
  resolveGroupOf,
  onCardDragStart,
  onCardDragEnd,
  onCardDrop,
}: {
  group: NavGroup;
  iconMap: Record<string, string>;
  /** 编辑模式（v1.51.18，由导航页「编辑」按钮切换）：仅此态下渲染卡片 ✎ 编辑入口 */
  editMode?: boolean;
  onAddApp: () => void;
  /** 编辑单个项目（v1.51.11）：由 NavPage 打开独立 NavAppModal */
  onEditApp: (app: NavAppItem) => void;
  /** 打开「分组设置」弹窗（v1.51.12）：标题行「＋」右边的齿轮扳手入口 */
  onOpenGroupSettings: () => void;
  /** 内外网默认访问模式（v1.51.8，由导航页「页面设置」下传）：覆盖单卡自动判定 */
  navNetworkMode?: NavNetworkMode;
  /** 「全部」视图下，按 appId 解析其真实归属分组（v1.51.19） */
  resolveGroupOf?: (appId: string) => string | undefined;
  /** 编辑态拖拽：卡片开始拖动（v1.51.19） */
  onCardDragStart?: (appId: string, groupId: string) => void;
  /** 编辑态拖拽：卡片拖动结束（v1.51.19） */
  onCardDragEnd?: () => void;
  /** 编辑态拖拽：卡片落到另一卡片前（v1.51.19） */
  onCardDrop?: (appId: string, groupId: string) => void;
}) {
  const [zone, setZone] = useState<WebuiZone>("intranet");
  useEffect(() => {
    let alive = true;
    getNetworkZoneApi()
      .then((r) => alive && setZone(r.zone))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const apps = group.apps || [];
  // navNetworkMode：auto=按访问 IP 自动分区；lan=强制内网；wan=强制外网
  const mode: WebuiZoneMode =
    navNetworkMode === "lan" ? "intranet" : navNetworkMode === "wan" ? "internet" : "auto";
  const layout = group.cardLayout || "vertical";
  const cardSize = group.cardSize || 120;
  const gridGap = group.gridGap ?? 16;
  const iconSize = group.iconSize || 48;
  // v1.51.9：分组卡片样式 / 图标形状（参照 FlatNas），缺省回落与 v1.51.8 视觉一致
  const cardStyle: NavCardStyle = group.cardStyle || "solid";
  const iconShape: NavIconShape = group.iconShape || "rounded";
  const loc = { protocol: window.location.protocol, hostname: window.location.hostname };
  const urls = useMemo(() => apps.map((a) => resolveCardUrl(a, mode, zone, loc)), [apps, mode, zone, loc.protocol, loc.hostname]);

  return (
    <div>
      {/* 分组标题行：白色标题 + 圆形「＋」与其右侧「齿轮扳手」（FlatNas 风格，v1.51.12 齿轮 = 分组设置入口） */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-bold text-white drop-shadow-sm">{group.name}</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onAddApp}
            className="w-9 h-9 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm hover:bg-white hover:scale-105 transition-all"
            title="为该分组添加入口"
          >
            <PlusIcon />
          </button>
          <button
            onClick={onOpenGroupSettings}
            className="w-9 h-9 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm hover:bg-white hover:scale-105 transition-all"
            title="分组设置（新建/删除/改名分组、卡片布局/间距/大小/图标大小/样式/形状）"
          >
            <Settings size={17} />
          </button>
        </div>
      </div>
      {apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-white/85">
          <PlusIcon className="mb-2 opacity-80" />
          <p className="text-sm">该分组还没有入口，点上方「＋」添加</p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 snap-x" style={{ gap: gridGap }}>
          {apps.map((a, i) => {
            // 全部视图下卡片归属真实分组（由 resolveGroupOf 解析），用于拖拽跨组
            const cardGroupId = resolveGroupOf?.(a.id) || group.id;
            return (
            <div
              key={a.id}
              className="snap-start relative group/card"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onCardDrop?.(a.id, cardGroupId); }}
            >
              <AppCard
                app={a}
                iconMap={iconMap}
                url={urls[i]}
                layout={layout}
                cardSize={cardSize}
                iconSize={iconSize}
                cardStyle={cardStyle}
                iconShape={iconShape}
                groupForDnd={cardGroupId}
                draggableCard={!!editMode && !!onCardDragStart}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                onCardDrop={onCardDrop}
              />
              {/* 编辑按钮是卡片 <button> 的兄弟节点，绝不嵌套（保留 disabled={!url} 语义）。
                  v1.51.18：仅 editMode 态渲染，且常显（opacity-100）以提示可编辑。 */}
              {editMode && (
                <button
                  type="button"
                  onClick={() => onEditApp(a)}
                  title={`编辑「${a.name}」`}
                  className="absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded-full bg-white/90 text-fuchsia-600 flex items-center justify-center shadow-sm opacity-100 transition-opacity"
                >
                  <Pencil size={12} />
                </button>
              )}
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}

/** 便捷 hook：一次性拉取自定义图标映射（导航图标自动匹配用） */
export function useNavIconMap(): Record<string, string> {
  const [payload, setPayload] = useState<CustomIconsPayload>(EMPTY_ICONS);
  useEffect(() => {
    let alive = true;
    listCustomIconsApi()
      .then((r) => alive && setPayload(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  const map = useMemo(() => payload?.map || {}, [payload]);
  return map;
}

// 内联小图标（避免额外 import 干扰既有 lucide 引用）
function PlusIcon({ className = "" }: { className?: string }) {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1={12} y1={5} x2={12} y2={19} /><line x1={5} y1={12} x2={19} y2={12} />
    </svg>
  );
}
