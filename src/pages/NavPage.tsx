/**
 * 导航页（v1.51.0，label 分支）：独立一级页面（顶部导航「导航」项，位于「仪表盘」左侧），
 * 承载原 Dashboard 内的「分组标签条 + 应用卡片墙 + 管理弹窗」。
 * 与原 Dashboard 分页解耦：不再是仪表盘的一个分页，而是顶部导航里的一个独立入口。
 * 每个分组是一个标签（FlatNas 风格），点击切换该分组的卡片墙；「管理」打开 NavEditor 整体编辑。
 * 图标解析 / 内外网分区复用 NavBoard（独立拉取 /api/custom-icons 与 /api/network-zone）。
 */
import React, { useState, useEffect } from "react";
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
  const navIconMap = useNavIconMap();

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
    <div className="p-6">
      {/* 分组标签条 + 管理 */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {groups.length === 0 && (
          <span className="text-[13px] text-slate-400 px-1">还没有分组</span>
        )}
        {groups.map((g) => (
          <button
            key={g.id}
            onClick={() => setNavTab(g.id)}
            className={`px-3.5 py-1.5 rounded-full text-[13px] transition-colors ${
              g.id === effectiveTab
                ? "bg-blue-600 text-white font-medium shadow-sm"
                : "bg-white text-slate-600 border border-slate-200 hover:border-blue-300"
            }`}
          >
            {g.name}
            <span className={`ml-1 text-[11px] ${g.id === effectiveTab ? "text-blue-100" : "text-slate-400"}`}>
              {g.apps.length}
            </span>
          </button>
        ))}
        <button
          onClick={() => setNavEditing(true)}
          className="ml-1 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[12px] text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="管理导航分组与入口"
        >
          <Settings2 size={13} /> 管理
        </button>
      </div>

      {activeNavGroup ? (
        <NavBoard group={activeNavGroup} iconMap={navIconMap} onOpenEditor={() => setNavEditing(true)} />
      ) : (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-dashed border-slate-300 text-slate-400">
          <Compass size={32} className="mb-3" />
          <p className="text-sm">还没有导航分组，点右上角「管理」新建一个分组并添加入口</p>
        </div>
      )}

      {/* 导航管理弹窗 */}
      {navEditing && (
        <NavEditor
          groups={groups}
          containers={containers}
          onSave={(next) => {
            onSaveNavGroups(next);
            setNavEditing(false);
            // 当前选中的分组被删时回落第一个
            if (effectiveTab && !next.some((g) => g.id === effectiveTab)) setNavTab(next[0]?.id || "");
          }}
          onClose={() => setNavEditing(false)}
        />
      )}
    </div>
  );
}
