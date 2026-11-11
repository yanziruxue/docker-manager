/**
 * 导航仪表盘卡片墙（v1.51.0，label 分支）：渲染一个导航分组的应用卡片，
 * 点击按内外网分区解析地址后打开（复用 v1.50.36 的 zone 判定与解析器语义）。
 * 图标解析优先级：完整 URL（http(s)/data:/api/）原样 > 自定义图标库按名匹配 > 首字母色块。
 * 自包含：自行拉取 /api/custom-icons 与 /api/network-zone（失败分别回落空映射 / intranet）。
 * v1.51.7：支持分组级卡片布局/大小/间距/图标大小（参照 FlatNas）与 ext 外链直开、self 备用地址回退。
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { NavAppItem, NavGroup } from "../types";
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

function AppCard({
  app,
  iconMap,
  url,
  layout,
  cardSize,
  iconSize,
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
}) {
  const src = resolveNavIconSrc(app.icon, iconMap);
  const open = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  };
  const titleColor = app.titleColor || "#334155";
  const box = iconSize;
  const inner = Math.round(iconSize * 0.74);

  if (layout === "horizontal") {
    return (
      <button
        onClick={open}
        disabled={!url}
        title={url ? `打开 ${url}${app.remark ? `（${app.remark}）` : ""}` : "未配置地址"}
        className="group relative flex items-center gap-3 px-4 py-3 rounded-2xl bg-white/95 border border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
        style={{ width: cardSize + 56 }}
      >
        <span
          className="flex items-center justify-center overflow-hidden flex-shrink-0 rounded-xl"
          style={{ width: box, height: box, background: app.iconColor && !src ? app.iconColor : undefined }}
        >
          {src ? (
            <img src={src} alt={app.name} style={{ width: inner, height: inner }} className="object-contain" draggable={false} />
          ) : (
            <span className="font-bold text-white" style={{ fontSize: Math.round(iconSize * 0.4) }}>
              {(app.name || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium truncate" style={{ color: titleColor }}>{app.name}</div>
          {app.remark && (
            <div className="text-[11px] text-slate-400 truncate whitespace-pre-line">{app.remark}</div>
          )}
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
      title={url ? `打开 ${url}${app.remark ? `（${app.remark}）` : ""}` : "未配置地址"}
      className="group relative flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/95 border border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
      style={{ width: cardSize }}
    >
      <span
        className="flex items-center justify-center overflow-hidden flex-shrink-0 rounded-xl"
        style={{ width: box, height: box, background: app.iconColor && !src ? app.iconColor : undefined }}
      >
        {src ? (
          <img src={src} alt={app.name} style={{ width: inner, height: inner }} className="object-contain" draggable={false} />
        ) : (
          <span className="font-bold text-white" style={{ fontSize: Math.round(iconSize * 0.4) }}>
            {(app.name || "?").slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="text-[13px] font-medium truncate w-full text-center" style={{ color: titleColor }}>{app.name}</span>
      {app.remark && layout === "vertical" && (
        <span className="text-[11px] text-slate-400 truncate w-full text-center -mt-1.5">{app.remark}</span>
      )}
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
  onOpenEditor,
  onAddApp,
}: {
  group: NavGroup;
  iconMap: Record<string, string>;
  onOpenEditor: () => void;
  onAddApp: () => void;
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
  const mode: WebuiZoneMode = "auto";
  const layout = group.cardLayout || "vertical";
  const cardSize = group.cardSize || 120;
  const gridGap = group.gridGap ?? 16;
  const iconSize = group.iconSize || 48;
  const loc = { protocol: window.location.protocol, hostname: window.location.hostname };
  const urls = useMemo(() => apps.map((a) => resolveCardUrl(a, mode, zone, loc)), [apps, mode, zone, loc.protocol, loc.hostname]);

  return (
    <div>
      {/* 分组标题行：白色标题 + 圆形「＋」「⚙」按钮（FlatNas 风格） */}
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
            onClick={onOpenEditor}
            className="w-9 h-9 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm hover:bg-white hover:scale-105 transition-all"
            title="管理分组"
          >
            <GearIcon />
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
          {apps.map((a, i) => (
            <div key={a.id} className="snap-start">
              <AppCard app={a} iconMap={iconMap} url={urls[i]} layout={layout} cardSize={cardSize} iconSize={iconSize} />
            </div>
          ))}
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
function GearIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx={12} cy={12} r={3} />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
