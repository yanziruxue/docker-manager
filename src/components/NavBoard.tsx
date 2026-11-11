/**
 * 导航仪表盘卡片墙（v1.51.0，label 分支）：渲染一个导航分组的应用卡片，
 * 点击按内外网分区解析地址后打开（复用 v1.50.36 的 zone 判定与解析器语义）。
 * 图标解析优先级：完整 URL（http(s)/data:/api/）原样 > 自定义图标库按名匹配 > 首字母色块。
 * 自包含：自行拉取 /api/custom-icons 与 /api/network-zone（失败分别回落空映射 / intranet）。
 */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Settings2, Plus } from "lucide-react";
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

function AppCard({
  app,
  iconMap,
  mode,
  zone,
}: {
  app: NavAppItem;
  iconMap: Record<string, string>;
  mode: WebuiZoneMode;
  zone: WebuiZone;
}) {
  const loc = { protocol: window.location.protocol, hostname: window.location.hostname };
  const url = resolveNavAppUrl(app, mode, zone, loc);
  const src = resolveNavIconSrc(app.icon, iconMap);
  const open = () => {
    if (!url) return;
    window.open(url, "_blank", "noopener");
  };
  return (
    <button
      onClick={open}
      disabled={!url}
      title={url ? `打开 ${url}${app.remark ? `（${app.remark}）` : ""}` : "未配置地址"}
      className="group relative flex flex-col items-center gap-2 p-4 rounded-2xl bg-white/95 border border-white shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed w-[120px] flex-shrink-0"
    >
      <span
        className="w-12 h-12 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
        style={{ background: app.iconColor && !src ? app.iconColor : undefined }}
      >
        {src ? (
          <img src={src} alt={app.name} className="w-9 h-9 object-contain" draggable={false} />
        ) : (
          <span className="text-lg font-bold text-white">{(app.name || "?").slice(0, 1).toUpperCase()}</span>
        )}
      </span>
      <span className="text-[13px] font-medium text-slate-700 truncate w-full text-center">{app.name}</span>
      {app.remark && <span className="text-[11px] text-slate-400 truncate w-full text-center -mt-1.5">{app.remark}</span>}
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
            <Plus size={16} />
          </button>
          <button
            onClick={onOpenEditor}
            className="w-9 h-9 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm hover:bg-white hover:scale-105 transition-all"
            title="管理分组"
          >
            <Settings2 size={16} />
          </button>
        </div>
      </div>
      {apps.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white/90">
          <Plus size={28} className="mb-2 opacity-90" />
          <p className="text-sm">该分组还没有入口，点上方「＋」或「⚙」添加</p>
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-3 snap-x">
          {apps.map((a) => (
            <div key={a.id} className="snap-start">
              <AppCard app={a} iconMap={iconMap} mode={mode} zone={zone} />
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
  // 刻意不写 `return useMemo(...)`：hooks 闸门会把「return 后置 hook 调用」计为顺序违规
  const map = useMemo(() => payload?.map || {}, [payload]);
  return map;
}
