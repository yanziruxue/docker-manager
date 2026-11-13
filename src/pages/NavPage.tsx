/**
 * 导航页（v1.52.0 升级为三级结构：分区 → 分组 → 卡片）：
 *  - 顶部分区标签条（FNOS / 在线应用 / 管理平台…），选中分区高亮并放大、分区名仅作标签不另起大标题；
 *  - 选中分区下逐「分组」渲染为区块（分组标题 + ＋ + ⚙ + 卡片墙）；
 *  - 「全部」标签合并所有分区的全部分组；
 *  - 编辑态卡片可拖拽：v1.52.9 起仅允许同一分区内跨分组移动 + 排序，跨分区拖放一律拒绝；
 *    分区标签不再是放置目标（编辑项目弹窗内手动改归属分区不受此限制）。
 * v1.51.11：移除「管理导航」(NavEditor)，项目 CRUD 直达。
 * v1.52.1：入口全部收敛顶栏图标条「编辑 | ＋添加项目 | ⚙分区/分组设置 | 页面设置」；
 *          分组标题行不再渲染 ＋/齿轮；顶栏齿轮 = 设置当前分区（弹窗自动定位）。
 */
import React, { useState, useEffect, useCallback } from "react";
import { Compass, Pencil, Plus, Settings, SlidersHorizontal } from "lucide-react";
import { NavBoard, useNavIconMap } from "../components/NavBoard";
import { NavAppModal } from "../components/NavAppModal";
import { NavGroupSettingsModal } from "../components/NavGroupSettingsModal";
import { NavPageSettingsModal } from "../components/NavPageSettingsModal";
import { WeatherEffect } from "../components/WeatherEffect";
import type { Container, NavAppItem, NavGroup, NavZone, NavPageSettings, NavNetworkMode, NavTheme } from "../types";

interface NavPageProps {
  /** 导航分区（v1.52.0：分区 → 分组 → 卡片三级结构） */
  navZones: NavZone[];
  /** 导航分区整体落盘（独立 /api/nav-groups 通道，不污染 main settings） */
  onSaveNavZones: (zones: NavZone[]) => void;
  /** 全局容器列表（v1.51.16：项目弹窗「容器列表」一次填入 4 字段，含已停止的容器） */
  containers: Container[];
  /** 导航页「页面设置」（整页外观/环境，v1.51.8） */
  navPageSettings: NavPageSettings;
  /** 导航页「页面设置」落盘回调 */
  onSaveNavPageSettings: (s: NavPageSettings) => void;
}

/** 项目弹窗状态：initial=null 为新增，否则为编辑；groupId 为新增时默认归属分组 */
interface AppModalState {
  open: boolean;
  initial: NavAppItem | null;
  groupId?: string;
}

const APP_MODAL_CLOSED: AppModalState = { open: false, initial: null };
/** 分区下「添加分组」后用于聚焦到新建分组的占位（由分组设置弹窗承接） */
interface GroupSettingsState {
  open: boolean;
  initialGroupId?: string;
  /** 打开时定位的分区（v1.52.1：顶栏齿轮 = 设置当前分区，弹窗自动选中它） */
  initialZoneId?: string;
}

export function NavPage({ navZones, onSaveNavZones, containers, navPageSettings, onSaveNavPageSettings }: NavPageProps) {
  const zones = navZones || [];
  const settings = navPageSettings || {};
  // v1.52.5：分区设置弹窗草稿预览（null=不预览）。所有渲染取 renderZones，所有写操作仍取真实 zones。
  const [previewZones, setPreviewZones] = useState<NavZone[] | null>(null);
  const renderZones = previewZones ?? zones;
  const handlePreviewZones = useCallback((d: NavZone[] | null) => setPreviewZones(d), []);
  // 真实分区数据落盘成功后撤销预览（保存瞬间不闪回旧外观）
  useEffect(() => { setPreviewZones(null); }, [navZones]);
  const [navTab, setNavTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("navTab");
      // 仅接受真实存在的分区 id（旧链接指向 group id 时回落首个分区）
      if (t && zones.some((z) => z.id === t)) return t;
    }
    return zones[0]?.id || "";
  });
  const [appModal, setAppModal] = useState<AppModalState>(APP_MODAL_CLOSED);
  const [navPageSettingsOpen, setNavPageSettingsOpen] = useState(false);
  const [groupSettings, setGroupSettings] = useState<GroupSettingsState>({ open: false });
  // 兜底：保存请求挂起/失败时 4s 后撤销预览，回落到真实分区，不停留在「看似已生效但未落盘」的状态
  useEffect(() => {
    if (previewZones === null || groupSettings.open) return;
    const t = window.setTimeout(() => setPreviewZones(null), 4000);
    return () => window.clearTimeout(t);
  }, [previewZones, groupSettings.open]);
  // v1.51.18：编辑模式开关。默认关闭；开启后卡片 ✎ 编辑入口才可见（不制约 ＋ / 齿轮，两者始终可用）。
  const [editMode, setEditMode] = useState(false);
  // v1.51.19：编辑态拖拽状态（被拖拽项目的 id 与来源分组）
  const [drag, setDrag] = useState<{ appId: string; fromGroupId: string } | null>(null);
  // v1.52.8：仅编辑态且确实有卡片被拖拽时，才开启空分组 / 空白区放置目标
  const dragActive = editMode && !!drag;
  // v1.52.9：按 appId 反查被拖项目的来源分区（「全部」视图下 fromGroupId 可能为空），
  // 只有同分区的卡片墙才会收到 dragActive，跨分区连放置目标都不渲染。
  const dragZoneId = drag
    ? (zones.find((z) => (z.groups || []).some((g) => (g.apps || []).some((a) => a.id === drag.appId)))?.id || "")
    : "";
  const navIconMap = useNavIconMap();
  // 打开页面设置弹窗（整页外观/环境）
  const openPageSettings = useCallback(() => setNavPageSettingsOpen(true), []);
  // 打开分区/分组设置弹窗（v1.52.0：管理分区与分组；可聚焦到某分组；v1.52.1 支持定位某分区）
  const openGroupSettings = useCallback(
    (groupId?: string, zoneId?: string) => setGroupSettings({ open: true, initialGroupId: groupId, initialZoneId: zoneId }),
    [],
  );

  const isAll = navTab === "__all__";
  // v1.52.5：渲染链统一取 renderZones（预览草稿优先），故分区改名/排序/外观在弹窗中即时可见
  const effectiveTab = !isAll && renderZones.some((z) => z.id === navTab) ? navTab : renderZones[0]?.id || "";
  const activeZone = isAll ? null : renderZones.find((z) => z.id === effectiveTab) || null;

  // 渲染分区：全部视图合并所有分区；否则取当前分区的分组。
  // v1.52.4：firstInZone 标记各分区下第一个分组，用于「首组距分区」间距（其余分组靠前一组的下间距）。
  const sections: { zone: NavZone; group: NavGroup; firstInZone: boolean }[] = isAll
    ? renderZones.flatMap((z) => (z.groups || []).map((g, i) => ({ zone: z, group: g, firstInZone: i === 0 })))
    : (activeZone ? activeZone.groups.map((g, i) => ({ zone: activeZone, group: g, firstInZone: i === 0 })) : []);

  // v1.51.11：项目 CRUD 直接对 zones 做不可变更新并落盘，不再经 NavEditor 中转
  const openAddApp = (groupId: string) => setAppModal({ open: true, initial: null, groupId });
  // v1.52.1：顶栏「＋添加项目」默认归属分组 = 当前分区首分组；「全部」视图 = 首个有分组的分区首分组
  const defaultAddGroupId = (): string | undefined => {
    if (isAll) return zones.find((z) => (z.groups || []).length > 0)?.groups[0]?.id;
    return activeZone?.groups[0]?.id;
  };
  const openEditApp = (app: NavAppItem) => setAppModal({ open: true, initial: app, groupId: undefined });
  // 编辑时切换分组，旧分组必须移除同 id 条目（保留 NavEditor 时代的跨分组移动语义）
  const handleSaveApp = (groupId: string, app: NavAppItem) => {
    const next = zones.map((z) => ({
      ...z,
      groups: z.groups.map((g) => {
        if (g.id === groupId) {
          const apps = g.apps || [];
          const exists = apps.some((a) => a.id === app.id);
          return { ...g, apps: exists ? apps.map((a) => (a.id === app.id ? app : a)) : [...apps, app] };
        }
        return { ...g, apps: (g.apps || []).filter((a) => a.id !== app.id) };
      }),
    }));
    onSaveNavZones(next);
    setAppModal(APP_MODAL_CLOSED);
  };
  // 编辑态删除项目：从所有分区/分组移除同 id 条目并落盘
  const handleDeleteApp = (appId: string) => {
    onSaveNavZones(
      zones.map((z) => ({ ...z, groups: z.groups.map((g) => ({ ...g, apps: (g.apps || []).filter((a) => a.id !== appId) })) })),
    );
    setAppModal(APP_MODAL_CLOSED);
  };

  // v1.51.19：编辑态拖拽——同分区内移动到其他分组（拖到卡片=插到该卡前，落到空白=追加到末尾）。
  const moveApp = (appId: string, fromGroupId: string, toGroupId: string, beforeAppId?: string) => {
    // v1.52.9：项目无法拖动到其他分区——来源 / 目标必须属于同一分区，否则原样不动。
    // fromGroupId 在「全部」视图下可能为空，故额外按 appId 反查归属分区。
    const zoneOfGroup = (gid: string) => zones.find((z) => (z.groups || []).some((g) => g.id === gid));
    const zoneOfApp = zones.find((z) => (z.groups || []).some((g) => (g.apps || []).some((a) => a.id === appId)));
    const fromZone = zoneOfGroup(fromGroupId) || zoneOfApp;
    const toZone = zoneOfGroup(toGroupId);
    if (!fromZone || !toZone || fromZone.id !== toZone.id) return;
    let app: NavAppItem | undefined;
    const stripped = zones.map((z) => ({
      ...z,
      groups: z.groups.map((g) => {
        const apps = g.apps || [];
        const idx = apps.findIndex((a) => a.id === appId);
        if (idx >= 0) {
          app = apps[idx];
          return { ...g, apps: apps.filter((a) => a.id !== appId) };
        }
        return g;
      }),
    }));
    if (!app) return;
    const next = stripped.map((z) => ({
      ...z,
      groups: z.groups.map((g) => {
        if (g.id === toGroupId) {
          const apps = [...(g.apps || [])];
          let insertAt = apps.length;
          if (beforeAppId) {
            const bi = apps.findIndex((a) => a.id === beforeAppId);
            if (bi >= 0) insertAt = bi;
          }
          apps.splice(insertAt, 0, app as NavAppItem);
          return { ...g, apps };
        }
        return g;
      }),
    }));
    onSaveNavZones(next);
  };
  const onCardDragStart = (appId: string, fromGroupId: string) => setDrag({ appId, fromGroupId });
  const onCardDragEnd = () => setDrag(null);
  const onCardDrop = (targetAppId: string, targetGroupId: string) => {
    if (!drag) return;
    moveApp(drag.appId, drag.fromGroupId, targetGroupId, targetAppId);
    setDrag(null);
  };
  // 「全部」视图下按 appId 解析真实归属分组（拖拽跨组用）
  const resolveGroupOf = (appId: string): string | undefined => {
    for (const z of zones) for (const g of z.groups || []) if ((g.apps || []).some((a) => a.id === appId)) return g.id;
    return undefined;
  };

  // 分区下「添加分组」：在指定分区追加一个空分组（纯分类容器，外观继承所属分区）
  const addGroupToZone = (zoneId: string) => {
    const next = zones.map((z) =>
      z.id === zoneId
        ? { ...z, groups: [...z.groups, { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: `分组 ${(z.groups.length + 1)}`, apps: [] }] }
        : z,
    );
    onSaveNavZones(next);
    const newGroup = next.find((z) => z.id === zoneId)?.groups.slice(-1)[0];
    if (newGroup) openGroupSettings(newGroup.id);
  };

  // 进入页面 / 切换分区时把当前选中分区写回 URL（支持深链回看）
  useEffect(() => {
    if (typeof window === "undefined" || !effectiveTab) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("navTab") !== effectiveTab) {
      url.searchParams.set("navTab", effectiveTab);
      window.history.replaceState({}, "", url.toString());
    }
  }, [effectiveTab]);

  // 白昼模式：auto=跟随系统；light=强制白昼；dark=强制夜间
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemDark(mq.matches);
    const h = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  const resolvedTheme: NavTheme =
    (settings.theme || "auto") === "auto" ? (systemDark ? "dark" : "light") : settings.theme!;

  // 背景层：有背景图用图（含模糊），否则回落渐变（按白昼模式分亮/暗）
  const hasBg = !!settings.bgImage;
  const bgLayerStyle: React.CSSProperties = hasBg
    ? {
        backgroundImage: `url("${settings.bgImage}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        filter: (settings.bgBlur ?? 0) > 0 ? `blur(${settings.bgBlur}px)` : undefined,
      }
    : {};
  const fallbackBg = resolvedTheme === "dark"
    ? "bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700"
    : "bg-gradient-to-br from-rose-200 via-fuchsia-200 to-indigo-300";

  const navNetworkMode: NavNetworkMode = settings.navNetworkMode || "auto";

  return (
    <div className={`relative isolate min-h-full ${fallbackBg} p-6 overflow-hidden`}>
      {/* 背景图层（置于内容之下，模糊仅作用于背景图） */}
      {hasBg && <div className="absolute inset-[-24px] -z-20" style={bgLayerStyle} aria-hidden="true" />}
      {/* 环境天气效果（纯前端 canvas，置于内容之下、背景之上） */}
      <WeatherEffect weather={settings.weather || "none"} />

      {/* 分区标签条 + 顶栏图标条（v1.52.1：编辑 | ＋添加项目 | ⚙分区/分组设置 | 页面设置） */}
      {/* v1.52.4：标签条下不再固定 mb-5，首个分组距分区的距离由分区级 zoneFirstGroupGap 控制 */}
      <div className="flex items-center gap-2 flex-wrap relative">
        {renderZones.length === 0 && (
          <span className="text-[13px] text-white/80 px-1">还没有导航分区</span>
        )}
        {renderZones.map((z) => {
          // 角标 = 该分区下应用总数
          const count = (z.groups || []).reduce((s, g) => s + (g.apps?.length || 0), 0);
          const active = z.id === effectiveTab;
          return (
            <button
              key={z.id}
              onClick={() => setNavTab(z.id)}
              // v1.52.9：分区标签不再是放置目标，项目无法拖动到其他分区
              // 选中分区：高亮 + 字号放大(~1.5倍) + 轻微 scale；分区名仅作标签，不另起大标题
              className={`rounded-full backdrop-blur-sm transition-all ${
                active
                  ? "bg-white text-fuchsia-600 font-bold shadow-md text-[18px] scale-[1.04] py-2 px-5"
                  : "bg-white/60 text-slate-600 hover:bg-white/85 text-[13px] py-1.5 px-4"
              }`}
            >
              {z.name}
              <span className={`ml-1.5 text-[11px] ${active ? "text-fuchsia-400" : "text-slate-400"}`}>
                {count}
              </span>
            </button>
          );
        })}
        {/* 全部：合并显示所有分区的分组（v1.51.19） */}
        <button
          key="__all__"
          onClick={() => setNavTab("__all__")}
          className={`rounded-full backdrop-blur-sm transition-all ${
            isAll
              ? "bg-white text-fuchsia-600 font-bold shadow-md text-[18px] scale-[1.04] py-2 px-5"
              : "bg-white/60 text-slate-600 hover:bg-white/85 text-[13px] py-1.5 px-4"
          }`}
          title="显示全部分区的分组"
        >
          全部
        </button>
        <div className="ml-auto flex items-center gap-2">
          {/* v1.52.1：入口收敛为顶栏图标条（四入口顺序锁定见 check-nav），分组行不再带 ＋/齿轮 */}
          <button
            onClick={() => setEditMode((v) => !v)}
            className={`flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium shadow-sm backdrop-blur-sm transition-colors ${
              editMode
                ? "text-white bg-fuchsia-600 hover:bg-fuchsia-700"
                : "text-slate-600 bg-white/75 hover:bg-white"
            }`}
            title={editMode ? "退出编辑模式" : "进入编辑模式（开启后可编辑已添加的项目）"}
          >
            <Pencil size={13} /> {editMode ? "退出编辑" : "编辑"}
          </button>
          <button
            onClick={() => openAddApp(defaultAddGroupId() || "")}
            disabled={!defaultAddGroupId()}
            className="w-8 h-8 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm backdrop-blur-sm hover:bg-white hover:scale-105 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
            title="添加项目（默认加入当前分区首个分组，可在弹窗中改选分组）"
          >
            <Plus size={15} />
          </button>
          <button
            onClick={() => openGroupSettings(undefined, isAll ? undefined : effectiveTab)}
            className="w-8 h-8 rounded-full bg-white/85 text-fuchsia-600 flex items-center justify-center shadow-sm backdrop-blur-sm hover:bg-white hover:scale-105 transition-all"
            title="分区与分组设置（管理当前分区的分区/分组：新建/改名/删除与卡片外观）"
          >
            <Settings size={15} />
          </button>
          <button
            onClick={openPageSettings}
            className="w-8 h-8 rounded-full bg-white/85 text-rose-600 flex items-center justify-center shadow-sm backdrop-blur-sm hover:bg-white hover:scale-105 transition-all"
            title="页面设置（背景图片 / 环境天气 / 内外网默认模式 / 白昼模式）"
          >
            <SlidersHorizontal size={15} />
          </button>
        </div>
      </div>

      {activeZone || isAll ? (
        <div>
          {sections.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white">
              <Compass size={36} className="mb-3 opacity-90" />
              <p className="text-sm">
                {dragActive && !isAll
                  ? "该分区还没有分组，请先在分区与分组设置里新建分组后再拖入"
                  : isAll ? "还没有任何导航分组" : `分区「${activeZone?.name}」下还没有分组`}
              </p>
              <button
                onClick={() => (isAll ? openGroupSettings() : addGroupToZone(activeZone!.id))}
                className="mt-4 px-4 py-2 text-sm text-white bg-rose-500 rounded-full hover:bg-rose-600 shadow-md transition-colors"
              >
                {isAll ? "新建分区" : "添加分组"}
              </button>
            </div>
          ) : (
            sections.map(({ zone, group, firstInZone }) => (
              <NavBoard
                key={group.id}
                group={group}
                zoneCfg={zone}
                zoneTag={isAll ? zone.name : undefined}
                isFirstGroup={firstInZone}
                iconMap={navIconMap}
                editMode={editMode}
                // v1.52.9：只让来源分区的卡片墙成为放置目标，跨分区落点完全不启用
                dragActive={dragActive && zone.id === dragZoneId}
                onEditApp={openEditApp}
                navNetworkMode={navNetworkMode}
                resolveGroupOf={isAll ? resolveGroupOf : undefined}
                onCardDragStart={onCardDragStart}
                onCardDragEnd={onCardDragEnd}
                onCardDrop={onCardDrop}
              />
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white">
          <Compass size={36} className="mb-3 opacity-90" />
          <p className="text-sm">还没有导航分区，点下方「新建分区」按钮开始</p>
          <button
            onClick={() => openGroupSettings()}
            className="mt-4 px-4 py-2 text-sm text-white bg-rose-500 rounded-full hover:bg-rose-600 shadow-md transition-colors"
          >
            新建分区
          </button>
        </div>
      )}

      {/* 添加 / 编辑项目弹窗（v1.51.11：不再经 NavEditor，直接落盘） */}
      {appModal.open && (
        <NavAppModal
          zones={zones}
          containers={containers}
          iconMap={navIconMap}
          initial={appModal.initial}
          initialGroupId={appModal.groupId || effectiveTab || undefined}
          onSave={handleSaveApp}
          onDelete={handleDeleteApp}
          onClose={() => setAppModal(APP_MODAL_CLOSED)}
        />
      )}

      {/* 导航页「页面设置」弹窗 */}
      {navPageSettingsOpen && (
        <NavPageSettingsModal
          initial={settings}
          onSave={(s) => {
            onSaveNavPageSettings(s);
            setNavPageSettingsOpen(false);
          }}
          onClose={() => setNavPageSettingsOpen(false)}
        />
      )}

      {/* 导航「分区 / 分组设置」弹窗（v1.52.0：管理分区与分组） */}
      {groupSettings.open && (
        <NavGroupSettingsModal
          zones={zones}
          initialGroupId={groupSettings.initialGroupId}
          initialZoneId={groupSettings.initialZoneId}
          onPreview={handlePreviewZones}
          onSave={(next) => {
            onSaveNavZones(next);
            // v1.52.5：不清预览，交给 navZones 落盘后的 effect 撤销（保存瞬间无闪回）
            setGroupSettings({ open: false });
            // 当前选中的分区被删时回落第一个（原保存时的回落语义）
            if (effectiveTab && !next.some((z) => z.id === effectiveTab)) setNavTab(next[0]?.id || "");
          }}
          onClose={() => setGroupSettings({ open: false })}
        />
      )}
    </div>
  );
}
