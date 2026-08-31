import React from "react";
import {
  LayoutDashboard,
  Container,
  Layers,
  Image,
  Database,
  Settings,
  Boxes,
  Bell,
  Wifi,
  WifiOff,
  AlertCircle,
} from "lucide-react";
import type { PageKey } from "../types";

interface SidebarProps {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
  stats: {
    runningContainers: number;
    totalContainers: number;
    totalStacks: number;
    totalImages: number;
    totalVolumes: number;
  };
  engineName?: string;
  engineStatus?: "connected" | "disconnected" | "error";
  dockerVersion?: string;
  notificationsCount?: number;
}

const navItems: { key: PageKey; label: string; icon: React.ReactNode }[] = [
  { key: "dashboard", label: "仪表盘", icon: <LayoutDashboard size={18} /> },
  { key: "containers", label: "容器管理", icon: <Container size={18} /> },
  { key: "stacks", label: "堆栈管理", icon: <Layers size={18} /> },
  { key: "images", label: "镜像管理", icon: <Image size={18} /> },
  { key: "volumes", label: "数据卷管理", icon: <Database size={18} /> },
  { key: "notifications", label: "通知中心", icon: <Bell size={18} /> },
  { key: "settings", label: "系统设置", icon: <Settings size={18} /> },
];

export function Sidebar({
  active,
  onNavigate,
  stats,
  engineName,
  engineStatus,
  dockerVersion,
  notificationsCount = 0,
}: SidebarProps) {
  const isConnected = engineStatus === "connected";
  const statusColor = isConnected
    ? "text-green-400"
    : engineStatus === "error"
      ? "text-red-400"
      : "text-slate-400";
  const dotColor = isConnected
    ? "bg-green-500"
    : engineStatus === "error"
      ? "bg-red-500"
      : "bg-slate-500";

  // 应用版本号：构建期注入（未注入时为空，不展示）
  const appVersion = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "";

  return (
    <aside className="w-56 bg-sidebar flex flex-col h-full flex-shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-slate-700/50">
        <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
          <Boxes size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-white font-bold text-sm leading-tight">Docker 管理</h1>
          <p className="text-slate-400 text-[10px] leading-tight">容器 & 堆栈平台</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 sidebar-scroll overflow-y-auto">
        <div className="text-slate-500 text-[10px] font-semibold uppercase tracking-wider px-3 mb-2">
          主菜单
        </div>
        <div className="space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                active === item.key
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "text-slate-300 hover:bg-sidebar-hover hover:text-white"
              }`}
            >
              {item.icon}
              <span className="flex-1 text-left">{item.label}</span>
              {item.key === "containers" && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active === item.key ? "bg-blue-400/30 text-blue-100" : "bg-slate-700 text-slate-400"
                }`}>
                  {stats.runningContainers}/{stats.totalContainers}
                </span>
              )}
              {item.key === "stacks" && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active === item.key ? "bg-blue-400/30 text-blue-100" : "bg-slate-700 text-slate-400"
                }`}>
                  {stats.totalStacks}
                </span>
              )}
              {item.key === "images" && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active === item.key ? "bg-blue-400/30 text-blue-100" : "bg-slate-700 text-slate-400"
                }`}>
                  {stats.totalImages}
                </span>
              )}
              {item.key === "volumes" && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active === item.key ? "bg-blue-400/30 text-blue-100" : "bg-slate-700 text-slate-400"
                }`}>
                  {stats.totalVolumes}
                </span>
              )}
              {item.key === "notifications" && notificationsCount > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                  active === item.key ? "bg-blue-400/30 text-blue-100" : "bg-red-500/20 text-red-300"
                }`}>
                  {notificationsCount}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* System Status */}
      <div className="px-4 py-3 border-t border-slate-700/50">
        <div className="flex items-center gap-2 text-xs">
          <div className={`w-2 h-2 rounded-full ${dotColor} ${isConnected ? "animate-pulse" : ""}`} />
          <span className="text-slate-400">Docker Engine</span>
          <span className={`${statusColor} font-medium ml-auto flex items-center gap-1`}>
            {!isConnected && engineStatus === "error" && <AlertCircle size={10} />}
            {!isConnected && engineStatus === "disconnected" && <WifiOff size={10} />}
            {isConnected && <Wifi size={10} />}
            {engineStatus === "connected" ? "已连接" : engineStatus === "error" ? "连接异常" : "未连接"}
          </span>
        </div>
        {engineName && (
          <div className="mt-1.5 px-4 text-[11px] text-slate-500 truncate" title={engineName}>
            {engineName}
            {dockerVersion && <span className="text-slate-600 ml-1">{dockerVersion}</span>}
          </div>
        )}
        {appVersion && (
          <div className="mt-1 px-4 text-[10px] text-slate-600 truncate" title="应用版本">
            v{appVersion}
          </div>
        )}
      </div>
    </aside>
  );
}
