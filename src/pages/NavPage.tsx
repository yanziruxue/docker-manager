/**
 * 导航页（v1.51.0，label 分支）：独立一级页面（顶部导航「导航」项，位于「仪表盘」左侧），
 * 承载「分组标签条 + 应用卡片墙 + 三个独立弹窗」。与原 Dashboard 分页解耦。
 * 每个分组是一个标签（FlatNas 风格），点击切换该分组的卡片墙。
 * v1.51.11：移除「管理导航」（NavEditor）弹窗与全部入口，职责三分：
 *  - 「页面设置」→ NavPageSettingsModal（整页外观/环境，v1.51.8）；
 *  - 「分组设置」→ NavGroupSettingsModal（分组级卡片外观 + 分组新建/删除，v1.51.9 / v1.51.11）；
 *  - 「＋添加项目」/ 卡片 hover ✎ → NavAppModal（项目新增/编辑/删除，直接落盘）。
 * v1.51.12：顶栏只留「页面设置 / 添加项目」，「分组设置」唯一入口改为标题行「＋」右边的齿轮扳手。
 * 图标解析 / 内外网分区复用 NavBoard（独立拉取 /api/custom-icons 与 /api/network-zone）。
 */
import React, { useState, useEffect, useCallback } from "react";
import { Compass, Plus, SlidersHorizontal } from "lucide-react";
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
  /** 引用 Docker 容器图标用：当前引擎容器列表 */
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
  const navIconMap = useNavIconMap();
  // 打开页面设置弹窗（整页外观/环境）
  const openPageSettings = useCallback(() => setNavPageSettingsOpen(true), []);
  // 打开分组设置弹窗（分组外观 + 分组新建/删除）；v1.51.12 起由标题行齿轮扳手触发
  const openGroupSettings = useCallback(() => setNavGroupSettingsOpen(true), []);

  // 选中的分组被删除 / 列表变空时回落到第一个（保持始终有有效选中项）
  const effectiveTab = groups.some((g) => g.id === navTab) ? navTab : groups[0]?.id || "";
  const activeNavGroup = groups.find((g) => g.id === effectiveTab) || null;

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

      {/* 分组标签条 + 页面设置 / 添加项目（分组设置入口在标题行齿轮，v1.51.12） */}
      <div className="flex items-center gap-2 mb-5 flex-wrap relative">
        {groups.length === 0 && (
          <span className="text-[13px] text-white/80 px-1">还没有分组</span>
        )}
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setNavTab(g.id)}
            className={`px-4 py-1.5 rounded-full text-[13px] backdrop-blur-sm transition-all ${
              g.id === effectiveTab
                ? "bg-white text-fuchsia-600 font-semibold shadow-md"
                : "bg-white/60 text-slate-600 hover:bg-white/85"
            }`}
          >
            {g.name}
            <span className={`ml-1.5 text-[11px] ${g.id === effectiveTab ? "text-fuchsia-400" : "text-slate-400"}`}>
              {g.apps.length}
            </span>
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={openPageSettings}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-rose-600 bg-white/75 backdrop-blur-sm shadow-sm hover:bg-white transition-colors"
            title="页面设置（背景图片 / 环境天气 / 内外网默认模式 / 白昼模式）"
          >
            <SlidersHorizontal size={13} /> 页面设置
          </button>
          <button
            onClick={openAddApp}
            disabled={groups.length === 0}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-white bg-fuchsia-600/90 backdrop-blur-sm shadow-sm hover:bg-fuchsia-600 disabled:opacity-40 transition-colors"
            title={groups.length === 0 ? "请先用标题行右侧的齿轮新建一个分组" : "添加新项目（可引用 Docker 容器图标）"}
          >
            <Plus size={13} /> 添加项目
          </button>
        </div>
      </div>

      {activeNavGroup ? (
        <NavBoard
          group={activeNavGroup}
          iconMap={navIconMap}
          onAddApp={openAddApp}
          onEditApp={openEditApp}
          onOpenGroupSettings={openGroupSettings}
          navNetworkMode={navNetworkMode}
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
