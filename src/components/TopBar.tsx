import React from "react";
import {
  Bell, RefreshCw, UserCircle, LogOut, Boxes, LayoutDashboard, Container, Layers,
  Image as ImageIcon, Database, Network, Settings, Compass,
} from "lucide-react";
import type { PageKey } from "../types";
import type { AuthUser } from "../api";

interface TopBarProps {
  /** 当前激活页面（顶部导航高亮） */
  activePage: PageKey;
  onRefresh?: () => void;
  /** 是否正在刷新（驱动图标旋转 + 禁用） */
  refreshing?: boolean;
  onNavigate?: (page: string) => void;
  /** 未读通知数（驱动导航「通知中心」红标） */
  unreadCount?: number;
  actions?: React.ReactNode;
  /** 当前登录用户 */
  user?: AuthUser | null;
  /** 点击登出 */
  onLogout?: () => void;
  /** 各页面计数徽章（v1.47.0 自侧边栏迁入顶部导航） */
  stats: {
    runningContainers: number;
    totalContainers: number;
    totalStacks: number;
    totalImages: number;
    totalVolumes: number;
  };
  /** 引擎状态（原侧边栏左下角信息精简迁入左上角，详情进 title） */
  engineName?: string;
  engineStatus?: "connected" | "disconnected" | "error";
  dockerVersion?: string;
  /** 有可用系统更新时在「设置中心」项上显示角标 */
  updateAvailable?: boolean;
  /** 应用版本号（原侧边栏左下角迁此） */
  appVersion?: string;
  /** 被隐藏的一级页面 key 列表（v1.51.4，设置中心-页面设置 控制）；顶栏不渲染这些页签 */
  hiddenPages?: PageKey[];
}

/** 顶部导航项（v1.47.0 自 Sidebar 迁入） */
const navItems: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: "navigation", label: "导航", icon: <Compass size={16} /> },
  { key: "dashboard", label: "仪表盘", icon: <LayoutDashboard size={16} /> },
  { key: "containers", label: "容器管理", icon: <Container size={16} /> },
  { key: "stacks", label: "堆栈管理", icon: <Layers size={16} /> },
  { key: "images", label: "镜像管理", icon: <ImageIcon size={16} /> },
  { key: "volumes", label: "数据卷管理", icon: <Database size={16} /> },
  { key: "networks", label: "网络管理", icon: <Network size={16} /> },
  { key: "notifications", label: "通知中心", icon: <Bell size={16} /> },
  { key: "settings", label: "设置中心", icon: <Settings size={16} /> },
];

export function TopBar({
  activePage, onRefresh, refreshing = false, onNavigate,
  unreadCount = 0, actions, user, onLogout, stats,
  engineName, engineStatus, dockerVersion, updateAvailable = false, appVersion = "",
  hiddenPages = [],
}: TopBarProps) {
  // 引擎状态（原侧边栏左下角迁入左上角，精简为状态点 + 悬浮 title）
  const isConnected = engineStatus === "connected";
  const dotColor = isConnected ? "bg-green-500" : engineStatus === "error" ? "bg-red-500" : "bg-slate-400";
  const statusText = isConnected ? "已连接" : engineStatus === "error" ? "连接异常" : "未连接";
  const engineTitle = `${engineName ? engineName : "Docker Engine"}`
    + ` · 引擎${statusText}`
    + (dockerVersion ? ` · Docker ${dockerVersion}` : "")
    + (appVersion ? ` · 程序 v${appVersion}` : "");

  /** 导航项角标文案（title 用完整信息，角标用短数字） */
  const badgeFor = (key: PageKey): { text: string; cls: string; title: string } | null => {
    switch (key) {
      case "containers":
        return {
          text: `${stats.runningContainers}/${stats.totalContainers}`,
          cls: "bg-slate-200/90 text-slate-600",
          title: `运行中 ${stats.runningContainers} / 共 ${stats.totalContainers}`,
        };
      case "stacks":
        return { text: String(stats.totalStacks), cls: "bg-slate-200/90 text-slate-600", title: `共 ${stats.totalStacks} 个堆栈` };
      case "images":
        return { text: String(stats.totalImages), cls: "bg-slate-200/90 text-slate-600", title: `共 ${stats.totalImages} 个镜像` };
      case "volumes":
        return { text: String(stats.totalVolumes), cls: "bg-slate-200/90 text-slate-600", title: `共 ${stats.totalVolumes} 个数据卷` };
      case "notifications":
        return unreadCount > 0
          ? { text: String(unreadCount), cls: "bg-red-500 text-white", title: `${unreadCount} 条未读` }
          : null;
      case "settings":
        return updateAvailable
          ? { text: "1", cls: "bg-red-500 text-white", title: "有可用系统更新" }
          : null;
      default:
        return null;
    }
  };

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center gap-2 px-3 flex-shrink-0">
      {/* 左上角：Logo + 引擎状态点 + 双行版本（上行本地 Docker 版本 / 下行程序版本，详情悬浮 title） */}
      <div className="flex items-center gap-2 flex-shrink-0 cursor-default" title={engineTitle}>
        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Boxes size={18} className="text-white" />
        </div>
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${isConnected ? "animate-pulse" : ""}`} />
        <div className="leading-tight min-w-0">
          <div className="text-[11px] font-medium text-slate-600 whitespace-nowrap" title={`本地 Docker 版本：${dockerVersion || "未知"}`}>
            Docker {dockerVersion || "版本未知"}
          </div>
          <div className="text-[10px] text-slate-400 whitespace-nowrap" title={`程序版本：v${appVersion || "未知"}`}>
            v{appVersion || "未知"}
          </div>
        </div>
      </div>

      {/* 顶部导航（v1.47.0 自左侧边栏迁入：宽屏图标+文字，<1280px 只显图标悬浮可见） */}
      <nav className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto py-1">
        {navItems
          // 页面显示控制（v1.51.4）：被隐藏的页签不渲染；设置中心固定可见（确保可随时改回）
          .filter((item) => item.key === "settings" || !hiddenPages.includes(item.key))
          .map((item) => {
          const badge = badgeFor(item.key);
          return (
            <button
              key={item.key}
              onClick={() => onNavigate?.(item.key)}
              title={badge ? `${item.label}（${badge.title}）` : item.label}
              className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0 ${
                activePage === item.key
                  ? "bg-blue-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
              }`}
            >
              {item.icon}
              <span className="hidden xl:inline">{item.label}</span>
              {badge && (
                <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full text-[9px] font-semibold leading-none ${badge.cls}`}>
                  {badge.text}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* 右侧工具区（页面操作 / 刷新 / 用户；通知铃铛与搜索框已移除——未读数走导航「通知中心」红标） */}
      <div className="flex items-center gap-2 flex-shrink-0">
        {actions}
        {onRefresh && (
          <button
            onClick={onRefresh}
            disabled={refreshing}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title={refreshing ? "刷新中…" : "刷新"}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </button>
        )}

        {user && (
          <div className="flex items-center gap-1 pl-2 border-l border-slate-200">
            <span className="flex items-center gap-1.5 text-sm text-slate-600" title={user.username}>
              <UserCircle size={16} className="text-slate-400" />
              <span className="hidden lg:inline">{user.username}</span>
            </span>
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="退出登录"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
