/**
 * 导航页（v1.51.0，label 分支）：独立一级页面（顶部导航「导航」项，位于「仪表盘」左侧），
 * 承载原 Dashboard 内的「分组标签条 + 应用卡片墙 + 管理弹窗」。
 * 与原 Dashboard 分页解耦：不再是仪表盘的一个分页，而是顶部导航里的一个独立入口。
 * 每个分组是一个标签（FlatNas 风格），点击切换该分组的卡片墙；「管理」打开 NavEditor 整体编辑。
 * 图标解析 / 内外网分区复用 NavBoard（独立拉取 /api/custom-icons 与 /api/network-zone）。
 */
import React, { useState, useEffect, useCallback } from "react";
import { Compass, Settings2 } from "lucide-react";
import { NavBoard, useNavIconMap } from "../components/NavBoard";
import { NavEditor } from "../components/NavEditor";
import type { Container, NavGroup } from "../types";

interface NavPageProps {
  /** 导航分组（v1.51.0）：标签条 + 应用卡片墙；空 = 提示新建 */
  navGroups: NavGroup[];
  /** 导航分组整体落盘（管理弹窗保存回调） */
  onSaveNavGroups: (groups: NavGroup[]) => void;
  /** Docker 一键聚合用：当前引擎容器列表 */
  containers: Container[];
}

export function NavPage({ navGroups, onSaveNavGroups, containers }: NavPageProps) {
  const groups = navGroups || [];
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
  const navIconMap = useNavIconMap();
  // 打开管理弹窗：默认进入当前选中分组（不自动追加入口）
  const openEditor = useCallback(() => {
    setNavEditAdd(false);
    setNavEditing(true);
  }, []);
  // 「＋」：打开管理弹窗并自动给当前分组追加一个空白入口
  const addAppToActive = useCallback(() => {
    setNavEditAdd(true);
    setNavEditing(true);
  }, []);

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

  return (
    <div className="relative min-h-full bg-gradient-to-br from-rose-200 via-fuchsia-200 to-indigo-300 p-6">
      {/* 分组标签条 + 管理 */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
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
        <button
          onClick={openEditor}
          className="ml-auto flex items-center gap-1 px-3.5 py-1.5 rounded-full text-[13px] font-medium text-rose-600 bg-white/75 backdrop-blur-sm shadow-sm hover:bg-white transition-colors"
          title="管理导航分组与入口"
        >
          <Settings2 size={13} /> 管理
        </button>
      </div>

      {activeNavGroup ? (
        <NavBoard group={activeNavGroup} iconMap={navIconMap} onOpenEditor={openEditor} onAddApp={addAppToActive} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 rounded-2xl border border-white/40 bg-white/30 backdrop-blur-sm text-white">
          <Compass size={36} className="mb-3 opacity-90" />
          <p className="text-sm">还没有导航分组，点右上角「管理」新建一个分组并添加入口</p>
          <button
            onClick={openEditor}
            className="mt-4 px-4 py-2 text-sm text-white bg-rose-500 rounded-full hover:bg-rose-600 shadow-md transition-colors"
          >
            新建分组
          </button>
        </div>
      )}

      {/* 导航管理弹窗 */}
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
    </div>
  );
}
