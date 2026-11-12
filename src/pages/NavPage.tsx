/**
 * 导航页（v1.51.0，label 分支）：独立一级页面（顶部导航「导航」项，位于「仪表盘」左侧），
 * 承载「分组标签条 + 应用卡片墙 + 三个独立弹窗」。与原 Dashboard 分页解耦。
 * 每个分组是一个标签（FlatNas 风格），点击切换该分组的卡片墙。
 * v1.51.11：移除「管理导航」（NavEditor）弹窗与全部入口，职责三分：
 *  - 「页面设置」→ NavPageSettingsModal（整页外观/环境，v1.51.8）；
 *  - 「分组设置」→ NavGroupSettingsModal（分组级卡片外观 + 分组新建/删除，v1.51.9 / v1.51.11）；
 *  - 「＋添加项目」/ 卡片 hover ✎ → NavAppModal（项目新增/编辑/删除，直接落盘）。
 * v1.51.12：顶栏只留「页面设置 / 添加项目」，「分组设置」唯一入口改为标题行「＋」右边的齿轮扳手。
 * v1.51.13：「添加新项目」只保留标题行「＋」圆形按钮一个入口，顶栏「＋添加项目」胶囊按钮删除。
 * v1.51.15：项目弹窗图标改用堆栈 IconAutoComplete。
 * v1.51.16：项目弹窗「容器列表」需要全局容器数据（含已停止的容器），NavPage 恢复下传 containers。
 * 图标解析 / 内外网分区复用 NavBoard（独立拉取 /api/custom-icons 与 /api/network-zone）。
 */
import React, { useState, useEffect, useCallback } from "react";
import { Compass, Pencil, SlidersHorizontal } from "lucide-react";
import { NavBoard, useNavIconMap } from "../components/NavBoard";
import { NavAppModal } from "../components/NavAppModal";
import { NavGroupSettingsModal } from "../components/NavGroupSettingsModal";
import { NavPageSettingsModal } from "../components/NavPageSettingsModal";
import { WeatherEffect } from "../components/WeatherEffect";
import type { Container, NavAppItem, NavGroup, NavPageSettings, NavNetworkMode, NavTheme } from "../types";

interface NavPageProps {
  /** 导航分组（v1.51.0）：标签条 + 应用卡片墙；空 = 提示新建 */
  navGroups: NavGroup[];
  /** 导航分组整体落盘（独立 /api/nav-groups 通道，不污染 main settings） */
  onSaveNavGroups: (groups: NavGroup[]) => void;
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

export function NavPage({ navGroups, onSaveNavGroups, containers, navPageSettings, onSaveNavPageSettings }: NavPageProps) {
  const groups = navGroups || [];
  const settings = navPageSettings || {};
  const [navTab, setNavTab] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const t = new URLSearchParams(window.location.search).get("navTab");
      // 仅接受真实存在的分组 id（不再有「__dashboard」回填项）
      if (t && groups.some((g) => g.id === t)) return t;
    }
    return groups[0]?.id || "";
  });
  const [appModal, setAppModal] = useState<AppModalState>(APP_MODAL_CLOSED);
  const [navPageSettingsOpen, setNavPageSettingsOpen] = useState(false);
  const [navGroupSettingsOpen, setNavGroupSettingsOpen] = useState(false);
  // v1.51.18：编辑模式开关。默认关闭（每次刷新回落关闭）；开启后卡片 ✎ 编辑入口才可见，
  // 仅用于「编辑已添加的项目」，不制约「＋ 添加项目」「齿轮 分组设置」（两者始终可用）。
  const [editMode, setEditMode] = useState(false);
  // v1.51.19：编辑态拖拽状态（被拖拽项目的 id 与来源分组）
  const [drag, setDrag] = useState<{ appId: string; fromGroupId: string } | null>(null);
  const navIconMap = useNavIconMap();
  // 打开页面设置弹窗（整页外观/环境）
  const openPageSettings = useCallback(() => setNavPageSettingsOpen(true), []);
  // 打开分组设置弹窗（分组外观 + 分组新建/删除）；v1.51.12 起由标题行齿轮扳手触发
  const openGroupSettings = useCallback(() => setNavGroupSettingsOpen(true), []);

  // 选中的分组被删除 / 列表变空时回落到第一个（保持始终有有效选中项）
  const isAll = navTab === "__all__";
  const effectiveTab = !isAll && !groups.some((g) => g.id === navTab) ? groups[0]?.id || "" : navTab;
  // 「全部」虚拟分组：合并全部分组的项目（v1.51.19）
  const allGroup: NavGroup = { id: "__all__", name: "全部", apps: groups.flatMap((g) => g.apps || []) };
  const activeNavGroup = isAll ? allGroup : groups.find((g) => g.id === effectiveTab) || null;

  // v1.51.11：项目 CRUD 直接对 groups 做不可变更新并落盘，不再经 NavEditor 中转
  const openAddApp = () => setAppModal({ open: true, initial: null, groupId: effectiveTab });
  const openEditApp = (app: NavAppItem) => setAppModal({ open: true, initial: app, groupId: effectiveTab });
  // 保留 NavEditor 时代的跨分组移动语义：编辑时切换分组，旧分组必须移除同 id 条目
  const handleSaveApp = (groupId: string, app: NavAppItem) => {
    const next = groups.map((g) => {
      const apps = g.apps || [];
      if (g.id === groupId) {
        const exists = apps.some((a) => a.id === app.id);
        return { ...g, apps: exists ? apps.map((a) => (a.id === app.id ? app : a)) : [...apps, app] };
      }
      return { ...g, apps: apps.filter((a) => a.id !== app.id) };
    });
    onSaveNavGroups(next);
    setAppModal(APP_MODAL_CLOSED);
  };
  // 编辑态删除项目：从所有分组移除同 id 条目并落盘
  const handleDeleteApp = (appId: string) => {
    onSaveNavGroups(groups.map((g) => ({ ...g, apps: (g.apps || []).filter((a) => a.id !== appId) })));
    setAppModal(APP_MODAL_CLOSED);
  };

  // v1.51.19：编辑态拖拽——移动项目到其他分组（拖到分组 tab=末尾追加）或排序（拖到卡片前=插入该位置）。
  // 先跨全分组移除被拖项目，再插入目标分组（beforeAppId 之前，缺省末尾），自然兼容同组重排。
  const moveApp = (appId: string, fromGroupId: string, toGroupId: string, beforeAppId?: string) => {
    let app: NavAppItem | undefined;
    const stripped = groups.map((g) => {
      const apps = g.apps || [];
      const idx = apps.findIndex((a) => a.id === appId);
      if (idx >= 0) {
        app = apps[idx];
        return { ...g, apps: apps.filter((a) => a.id !== appId) };
      }
      return g;
    });
    if (!app) return;
    const next = stripped.map((g) => {
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
    });
    onSaveNavGroups(next);
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
    for (const g of groups) if ((g.apps || []).some((a) => a.id === appId)) return g.id;
    return undefined;
  };

  // 进入页面 / 切换分组时把当前选中分组写回 URL（仅 replace，不新增历史），支持深链回看
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

      {/* 分组标签条 + 页面设置（分组设置=标题行齿轮、添加项目=标题行＋，v1.51.13） */}
      <div className="flex items-center gap-2 mb-5 flex-wrap relative">
        {groups.length === 0 && (
          <span className="text-[13px] text-white/80 px-1">还没有分组</span>
        )}
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setNavTab(g.id)}
            onDragOver={editMode ? (e) => e.preventDefault() : undefined}
            onDrop={
              editMode
                ? (e) => {
                    e.preventDefault();
                    if (drag) {
                      moveApp(drag.appId, drag.fromGroupId, g.id);
                      setDrag(null);
                    }
                  }
                : undefined
            }
            className={`px-4 py-1.5 rounded-full text-[13px] backdrop-blur-sm transition-all ${
              g.id === effectiveTab
                ? "bg-white text-fuchsia-600 font-semibold shadow-md"
                : "bg-white/60 text-slate-600 hover:bg-white/85"
            } ${drag ? "ring-2 ring-fuchsia-400/70" : ""}`}
          >
            {g.name}
            <span className={`ml-1.5 text-[11px] ${g.id === effectiveTab ? "text-fuchsia-400" : "text-slate-400"}`}>
              {g.apps.length}
            </span>
          </button>
        ))}
        {/* 全部：合并显示全部分组的项目（v1.51.19） */}
        <button
          key="__all__"
          onClick={() => setNavTab("__all__")}
          className={`px-4 py-1.5 rounded-full text-[13px] backdrop-blur-sm transition-all ${
            isAll
              ? "bg-white text-fuchsia-600 font-semibold shadow-md"
              : "bg-white/60 text-slate-600 hover:bg-white/85"
          }`}
          title="显示全部分组的项目"
        >
          全部
        </button>
        <div className="ml-auto flex items-center gap-2">
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
            onClick={openPageSettings}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-rose-600 bg-white/75 backdrop-blur-sm shadow-sm hover:bg-white transition-colors"
            title="页面设置（背景图片 / 环境天气 / 内外网默认模式 / 白昼模式）"
          >
            <SlidersHorizontal size={13} /> 页面设置
          </button>
        </div>
      </div>

      {activeNavGroup ? (
        <NavBoard
          group={activeNavGroup}
          iconMap={navIconMap}
          editMode={editMode}
          onAddApp={openAddApp}
          onEditApp={openEditApp}
          onOpenGroupSettings={openGroupSettings}
          navNetworkMode={navNetworkMode}
          resolveGroupOf={isAll ? resolveGroupOf : undefined}
          onCardDragStart={onCardDragStart}
          onCardDragEnd={onCardDragEnd}
          onCardDrop={onCardDrop}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white">
          <Compass size={36} className="mb-3 opacity-90" />
          <p className="text-sm">还没有导航分组，点下方「新建分组」按钮开始</p>
          <button
            onClick={openGroupSettings}
            className="mt-4 px-4 py-2 text-sm text-white bg-rose-500 rounded-full hover:bg-rose-600 shadow-md transition-colors"
          >
            新建分组
          </button>
        </div>
      )}

      {/* 添加 / 编辑项目弹窗（v1.51.11：不再经 NavEditor，直接落盘） */}
      {appModal.open && (
        <NavAppModal
          groups={groups}
          containers={containers}
          initial={appModal.initial}
          initialGroupId={appModal.groupId || effectiveTab}
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

      {/* 导航「分组设置」弹窗（v1.51.11 起接管分组新建/删除；v1.51.12 起由标题行齿轮打开） */}
      {navGroupSettingsOpen && (
        <NavGroupSettingsModal
          groups={groups}
          initialGroupId={effectiveTab}
          onSave={(next) => {
            onSaveNavGroups(next);
            setNavGroupSettingsOpen(false);
            // 当前选中的分组被删时回落第一个（原 NavEditor 保存时的回落语义）
            if (effectiveTab && !next.some((g) => g.id === effectiveTab)) setNavTab(next[0]?.id || "");
          }}
          onClose={() => setNavGroupSettingsOpen(false)}
        />
      )}
    </div>
  );
}
