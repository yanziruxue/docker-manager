/**
 * 导航页（v1.51.0，label 分支）：独立一级页面（顶部导航「导航」项，位于「仪表盘」左侧），
 * 承载原 Dashboard 内的「分组标签条 + 应用卡片墙 + 管理弹窗」。
 * 与原 Dashboard 分页解耦：不再是仪表盘的一个分页，而是顶部导航里的一个独立入口。
 * 每个分组是一个标签（FlatNas 风格），点击切换该分组的卡片墙；「管理分组」打开 NavEditor；
 * 「页面设置」打开 NavPageSettingsModal（整页外观/环境，v1.51.8）；
 * 「分组设置」打开 NavGroupSettingsModal（分组级卡片外观，v1.51.9）。
 * 图标解析 / 内外网分区复用 NavBoard（独立拉取 /api/custom-icons 与 /api/network-zone）。
 */
import React, { useState, useEffect, useCallback } from "react";
import { Compass, LayoutGrid, Settings2, SlidersHorizontal } from "lucide-react";
import { NavBoard, useNavIconMap } from "../components/NavBoard";
import { NavEditor } from "../components/NavEditor";
import { NavGroupSettingsModal } from "../components/NavGroupSettingsModal";
import { NavPageSettingsModal } from "../components/NavPageSettingsModal";
import { WeatherEffect } from "../components/WeatherEffect";
import type { Container, NavGroup, NavPageSettings, NavNetworkMode, NavTheme } from "../types";

interface NavPageProps {
  /** 导航分组（v1.51.0）：标签条 + 应用卡片墙；空 = 提示新建 */
  navGroups: NavGroup[];
  /** 导航分组整体落盘（管理弹窗保存回调） */
  onSaveNavGroups: (groups: NavGroup[]) => void;
  /** Docker 一键聚合用：当前引擎容器列表 */
  containers: Container[];
  /** 导航页「页面设置」（整页外观/环境，v1.51.8） */
  navPageSettings: NavPageSettings;
  /** 导航页「页面设置」落盘回调 */
  onSaveNavPageSettings: (s: NavPageSettings) => void;
}

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
  const [navEditing, setNavEditing] = useState(false);
  const [navEditAdd, setNavEditAdd] = useState(false);
  const [navPageSettingsOpen, setNavPageSettingsOpen] = useState(false);
  const [navGroupSettingsOpen, setNavGroupSettingsOpen] = useState(false);
  const navIconMap = useNavIconMap();
  // 打开分组管理弹窗：默认进入当前选中分组（不自动追加入口）
  const openEditor = useCallback(() => {
    setNavEditAdd(false);
    setNavEditing(true);
  }, []);
  // 「＋」：打开管理弹窗并自动给当前分组追加一个空白入口
  const addAppToActive = useCallback(() => {
    setNavEditAdd(true);
    setNavEditing(true);
  }, []);
  // 打开页面设置弹窗（整页外观/环境）
  const openPageSettings = useCallback(() => setNavPageSettingsOpen(true), []);
  // 打开分组设置弹窗（当前选中分组的卡片外观，v1.51.9）
  const openGroupSettings = useCallback(() => setNavGroupSettingsOpen(true), []);

  // 选中的分组被删除 / 列表变空时回落到第一个（保持始终有有效选中项）
  const effectiveTab = groups.some((g) => g.id === navTab) ? navTab : groups[0]?.id || "";
  const activeNavGroup = groups.find((g) => g.id === effectiveTab) || null;

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

      {/* 分组标签条 + 页面设置 / 分组设置 / 管理分组 */}
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
            onClick={openGroupSettings}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-rose-600 bg-white/75 backdrop-blur-sm shadow-sm hover:bg-white transition-colors"
            title="分组设置（分组名称 / 卡片布局 / 间距 / 大小 / 图标大小 / 卡片样式 / 图标形状）"
          >
            <LayoutGrid size={13} /> 分组设置
          </button>
          <button
            onClick={openEditor}
            className="flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-rose-600 bg-white/75 backdrop-blur-sm shadow-sm hover:bg-white transition-colors"
            title="管理导航分组与入口"
          >
            <Settings2 size={13} /> 管理分组
          </button>
        </div>
      </div>

      {activeNavGroup ? (
        <NavBoard
          group={activeNavGroup}
          iconMap={navIconMap}
          onOpenEditor={openEditor}
          onAddApp={addAppToActive}
          navNetworkMode={navNetworkMode}
        />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white">
          <Compass size={36} className="mb-3 opacity-90" />
          <p className="text-sm">还没有导航分组，点右上角「管理分组」新建一个分组并添加入口</p>
          <button
            onClick={openEditor}
            className="mt-4 px-4 py-2 text-sm text-white bg-rose-500 rounded-full hover:bg-rose-600 shadow-md transition-colors"
          >
            新建分组
          </button>
        </div>
      )}

      {/* 导航分组管理弹窗 */}
      {navEditing && (
        <NavEditor
          groups={groups}
          containers={containers}
          initialGroupId={effectiveTab}
          autoAddApp={navEditAdd}
          onSave={(next) => {
            onSaveNavGroups(next);
            setNavEditing(false);
            setNavEditAdd(false);
            // 当前选中的分组被删时回落第一个
            if (effectiveTab && !next.some((g) => g.id === effectiveTab)) setNavTab(next[0]?.id || "");
          }}
          onClose={() => { setNavEditing(false); setNavEditAdd(false); }}
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

      {/* 导航「分组设置」弹窗（v1.51.9）：作用于分组卡片外观，与「页面设置」解耦 */}
      {navGroupSettingsOpen && (
        <NavGroupSettingsModal
          groups={groups}
          initialGroupId={effectiveTab}
          onSave={(next) => {
            onSaveNavGroups(next);
            setNavGroupSettingsOpen(false);
          }}
          onClose={() => setNavGroupSettingsOpen(false)}
        />
      )}
    </div>
  );
}
