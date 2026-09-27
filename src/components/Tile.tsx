import React, { useEffect, useState } from "react";
import { ChevronUp } from "lucide-react";

/** 折叠状态持久化前缀（按磁贴 id 存 localStorage） */
const STORAGE_PREFIX = "dm.tile.";

/**
 * 布尔偏好（持久化到 localStorage）。
 * 读取/写入都 try-catch：隐私模式、禁用存储、脏值一律退回默认值，不影响功能。
 */
export function useStoredFlag(storageKey: string, defaultValue: boolean) {
  const [on, setOn] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? defaultValue : raw === "1";
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, on ? "1" : "0");
    } catch {
      // 忽略：隐私模式 / 禁用存储时不可写，保持会话内状态即可
    }
  }, [storageKey, on]);

  return [on, setOn] as const;
}

interface TileProps {
  /** 磁贴唯一标识，用于持久化折叠状态（如 "cpu" / "memory"） */
  id: string;
  /** 标题（渲染为大写 16px/700，与 Unraid 磁贴头一致） */
  title: string;
  /** 左侧图标（建议 32px：`<Cpu size={32} />`） */
  icon?: React.ReactNode;
  /** 标题下方一行摘要（13px），如「运行中 12 · 已停止 3」 */
  subtitle?: React.ReactNode;
  /** 右上角额外控件（渲染在折叠按钮左侧） */
  actions?: React.ReactNode;
  /** 首次出现且本地无记录时的默认折叠态 */
  defaultCollapsed?: boolean;
  /**
   * 折叠后仍**持续显示**的内容，供「折叠只收起次要内容」的场景使用：
   *  - `top` 渲染在可折叠区之前（如处理器磁贴的「整体负载」横条）；
   *  - `bottom` 渲染在可折叠区之后（如可自己单独展开的曲线小节）。
   * 两者都不受磁贴折叠状态影响。
   */
  persistent?: { top?: React.ReactNode; bottom?: React.ReactNode };
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

/**
 * 磁贴壳（照搬 Unraid 仪表盘磁贴头）：
 *  - 头部：左「图标 32px + 竖排标题/摘要」，右「额外控件 + 折叠按钮」，`gap-2.5`
 *  - 标题 16px/700/大写、摘要 13px
 *  - **只支持折叠，不提供移除**——避免用户误删磁贴后找不回
 *  - 折叠状态按 id 存 localStorage；隐私模式写入失败时静默降级为会话内状态
 */
export function Tile({
  id,
  title,
  icon,
  subtitle,
  actions,
  defaultCollapsed = false,
  persistent,
  className = "",
  bodyClassName = "",
  children,
}: TileProps) {
  const storageKey = `${STORAGE_PREFIX}${id}.collapsed`;
  const [collapsed, setCollapsed] = useStoredFlag(storageKey, defaultCollapsed);

  return (
    <section className={`bg-white rounded-xl border border-slate-200 shadow-sm p-4 ${className}`}>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex items-start gap-2.5 min-w-0">
          {icon && <span className="flex-shrink-0 text-slate-400 mt-0.5">{icon}</span>}
          <div className="min-w-0">
            <h3 className="text-[16px] font-bold uppercase leading-none text-ink">{title}</h3>
            {subtitle && <p className="text-[13px] text-slate-500 mt-1.5 leading-snug">{subtitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {actions}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            title={collapsed ? "展开" : "折叠"}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ChevronUp size={16} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>
      {/* 折叠后仍显示的「常驻区」上段 */}
      {persistent?.top && <div className="mt-3">{persistent.top}</div>}
      {!collapsed && <div className={`mt-3 ${bodyClassName}`}>{children}</div>}
      {/* 折叠后仍显示的「常驻区」下段（如可单独展开的曲线） */}
      {persistent?.bottom && <div className="mt-3">{persistent.bottom}</div>}
    </section>
  );
}
