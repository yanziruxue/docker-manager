import React from "react";
import { ExternalLink, Play, Square, Pause, CircleDot, AlertCircle, Loader2 } from "lucide-react";

/** 状态 → 第二行「▶ 运行中」的图标与配色（色义沿用 Badge.tsx，形态沿用 Unraid 卡片） */
function stateStyle(status: string): { icon: React.ReactNode; className: string; label: string } {
  switch (status) {
    case "running":
      return { icon: <Play size={9} className="fill-current" />, className: "text-green-600", label: "运行中" };
    case "paused":
      return { icon: <Pause size={10} className="fill-current" />, className: "text-amber-600", label: "已暂停" };
    case "partial":
      return { icon: <CircleDot size={10} />, className: "text-amber-600", label: "部分运行" };
    case "restarting":
      return { icon: <Loader2 size={10} className="animate-spin" />, className: "text-blue-600", label: "重启中" };
    case "updating":
      return { icon: <Loader2 size={10} className="animate-spin" />, className: "text-blue-600", label: "更新中" };
    case "operating":
      return { icon: <Loader2 size={10} className="animate-spin" />, className: "text-blue-600", label: "执行中" };
    case "error":
      return { icon: <AlertCircle size={10} />, className: "text-red-600", label: "错误" };
    default:
      return { icon: <Square size={8} className="fill-current" />, className: "text-slate-400", label: "已停止" };
  }
}

interface NodeCardProps {
  /** 图标 URL（data URI / http）；缺省时用 fallback，未传 fallback 则用名称首字母 */
  icon?: string;
  /** 主标题（容器 / 堆栈名） */
  name: string;
  /** 状态：决定第二行「▶ 运行中 / ■ 已停止」的文案与配色 */
  status?: string;
  /** 第二行右侧的附加信息（堆栈卡片放「3/3」容器数） */
  extra?: React.ReactNode;
  /** 图标缺省时的替代内容（如 `<Layers size={16} />`）；缺省则渲染名称首字母 */
  fallback?: React.ReactNode;
  /**
   * 图标点击行为（卡片的主操作位）：容器 → 打开 WebUI；堆栈 → 弹出容器子表。
   * 不传则图标不可点（无 hover 高亮）。
   */
  onIconClick?: () => void;
  /** 图标悬停提示 */
  iconTitle?: string;
  /** 图标右上角是否画一个外链小箭头（容器卡打开 WebUI 时用） */
  external?: boolean;
}

/**
 * 卡片形态的节点名片（照搬 Unraid 仪表盘卡片：`[图标] [名称 / ▶ 运行中] [右侧计数]`）。
 * **唯一可点区是图标**（容器 → 打开 WebUI；堆栈 → 弹出容器子表，hover 有蓝色描边）；
 * 卡片其余区域（名称 / 状态行 / 右侧计数 / 空白）**不响应点击**（2026-09-25 按用户要求去掉整卡跳转）。
 */
export function NodeCard({
  icon,
  name,
  status,
  extra,
  fallback,
  onIconClick,
  iconTitle,
  external = false,
}: NodeCardProps) {
  const clickable = typeof onIconClick === "function";
  const state = status ? stateStyle(status) : null;

  const inner = (
    <>
      {icon ? (
        <img src={icon} alt="" className="w-7 h-7 rounded object-contain pointer-events-none" draggable={false} />
      ) : (
        <span className="pointer-events-none text-slate-400 text-sm font-semibold uppercase">
          {fallback ?? name.charAt(0)}
        </span>
      )}
      {clickable && external && (
        <ExternalLink size={10} className="absolute -top-0.5 -right-0.5 text-blue-500" />
      )}
    </>
  );

  const iconBase = "relative flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all";
  const iconClickable = "cursor-pointer bg-slate-100 hover:bg-blue-50 hover:ring-2 hover:ring-blue-400/70";
  const iconStatic = "bg-slate-100";

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-200 bg-white">
      {clickable ? (
        <button
          type="button"
          title={iconTitle}
          aria-label={iconTitle || name}
          onClick={(e) => {
            e.stopPropagation();
            onIconClick?.();
          }}
          className={`${iconBase} ${iconClickable}`}
        >
          {inner}
        </button>
      ) : (
        <div className={`${iconBase} ${iconStatic}`}>{inner}</div>
      )}

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate leading-tight" title={name}>
          {name}
        </p>
        {state && (
          <span className={`flex items-center gap-1 text-xs mt-0.5 ${state.className}`}>
            {state.icon}
            {state.label}
          </span>
        )}
      </div>

      {extra && <div className="flex-shrink-0 text-xs font-mono text-slate-500">{extra}</div>}
    </div>
  );
}
