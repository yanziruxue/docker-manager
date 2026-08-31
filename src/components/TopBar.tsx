import React, { useState } from "react";
import { Bell, Search, RefreshCw, ChevronRight, X, Info, CheckCircle, AlertTriangle, AlertCircle, ChevronsRight } from "lucide-react";
import type { ActivityLog } from "../types";

interface TopBarProps {
  title: string;
  breadcrumb?: string[];
  onRefresh?: () => void;
  onNavigate?: (page: string) => void;
  notifications?: ActivityLog[];
  unreadCount?: number;
  onMarkAllRead?: () => void;
  actions?: React.ReactNode;
}

const levelIcon: Record<ActivityLog["type"], React.ReactNode> = {
  info: <Info size={14} className="text-blue-500" />,
  success: <CheckCircle size={14} className="text-green-500" />,
  warning: <AlertTriangle size={14} className="text-amber-500" />,
  error: <AlertCircle size={14} className="text-red-500" />,
};

const levelBg: Record<ActivityLog["type"], string> = {
  info: "bg-blue-50",
  success: "bg-green-50",
  warning: "bg-amber-50",
  error: "bg-red-50",
};

export function TopBar({ title, breadcrumb, onRefresh, onNavigate, notifications = [], unreadCount = 0, onMarkAllRead, actions }: TopBarProps) {
  const [showNotifications, setShowNotifications] = useState(false);
  const recentNotifications = notifications.slice(0, 5);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-2">
        {breadcrumb && breadcrumb.length > 0 ? (
          <div className="flex items-center gap-2 text-sm">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight size={14} className="text-slate-400" />}
                <span className={i === breadcrumb.length - 1 ? "text-slate-800 font-semibold" : "text-slate-500"}>
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </div>
        ) : (
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
        )}
      </div>

      <div className="flex items-center gap-3">
        {actions}
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            title="刷新"
          >
            <RefreshCw size={16} />
          </button>
        )}
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="搜索..."
            className="w-48 pl-9 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all"
          />
        </div>
        <div className="relative">
          <button
            className="relative p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            onClick={() => setShowNotifications(!showNotifications)}
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>

          {showNotifications && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowNotifications(false)} />
              <div className="absolute right-0 top-full mt-1 w-80 bg-white rounded-xl shadow-lg border border-slate-200 z-20">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <span className="text-sm font-semibold text-slate-700">
                    通知
                    {notifications.length > 0 && (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">({notifications.length})</span>
                    )}
                    {unreadCount > 0 && (
                      <span className="ml-1 text-xs font-medium text-amber-600">{unreadCount} 条未读</span>
                    )}
                  </span>
                  <button
                    onClick={() => setShowNotifications(false)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                  >
                    <X size={14} />
                  </button>
                </div>

                {recentNotifications.length === 0 ? (
                  <div className="py-8 text-center text-sm text-slate-400">
                    <Bell size={24} className="mx-auto mb-2 text-slate-300" />
                    暂无通知
                  </div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {recentNotifications.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-start gap-3 px-4 py-3 border-b border-slate-50 hover:${levelBg[item.type]} transition-colors cursor-default`}
                      >
                        <div className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${levelBg[item.type]}`}>
                          {levelIcon[item.type]}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-700 leading-relaxed">{item.message}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{item.timestamp}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 查看更多通知 */}
                <button
                  onClick={() => {
                    setShowNotifications(false);
                    onNavigate?.("notifications");
                  }}
                  className="w-full flex items-center justify-center gap-1 px-4 py-2.5 text-sm text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded-b-xl transition-colors border-t border-slate-50"
                >
                  查看更多通知
                  <ChevronsRight size={14} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
