import React, { useState, useEffect } from "react";
import { Bell, Info, CheckCircle, AlertTriangle, AlertCircle, Filter, Search, CheckCircle2, History, Trash2, Activity } from "lucide-react";
import type { ActivityLog } from "../types";
import { getOpLogs, clearOpLogs, type OpLogEntry } from "../opLog";

interface NotificationsProps {
  notifications: ActivityLog[];
  readIds?: Set<string>;
  onMarkRead?: (id: string) => void;
  onMarkAllRead?: () => void;
}

const levelIcon: Record<ActivityLog["type"], React.ReactNode> = {
  info: <Info size={16} className="text-blue-500" />,
  success: <CheckCircle size={16} className="text-green-500" />,
  warning: <AlertTriangle size={16} className="text-amber-500" />,
  error: <AlertCircle size={16} className="text-red-500" />,
};

const levelBg: Record<ActivityLog["type"], string> = {
  info: "bg-blue-50",
  success: "bg-green-50",
  warning: "bg-amber-50",
  error: "bg-red-50",
};

const levelLabel: Record<ActivityLog["type"], string> = {
  info: "信息",
  success: "成功",
  warning: "警告",
  error: "错误",
};

const levelColor: Record<ActivityLog["type"], string> = {
  info: "bg-blue-100 text-blue-700",
  success: "bg-green-100 text-green-700",
  warning: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
};

const opStatusBg: Record<OpLogEntry["status"], string> = {
  success: "bg-green-50",
  failed: "bg-red-50",
  running: "bg-blue-50",
};

const opStatusIcon: Record<OpLogEntry["status"], React.ReactNode> = {
  success: <CheckCircle size={16} className="text-green-500" />,
  failed: <AlertCircle size={16} className="text-red-500" />,
  running: <Activity size={16} className="text-blue-500 animate-pulse" />,
};

const opStatusLabel: Record<OpLogEntry["status"], string> = {
  success: "成功",
  failed: "失败",
  running: "执行中",
};

const opStatusColor: Record<OpLogEntry["status"], string> = {
  success: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  running: "bg-blue-100 text-blue-700",
};

export function Notifications({ notifications, readIds = new Set(), onMarkRead, onMarkAllRead }: NotificationsProps) {
  const [tab, setTab] = useState<"notifications" | "operations">("notifications");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [opLogs, setOpLogs] = useState<OpLogEntry[]>([]);
  const [opFilter, setOpFilter] = useState<string>("all");
  const [opSearch, setOpSearch] = useState("");

  // 加载操作记录
  useEffect(() => {
    if (tab === "operations") {
      setOpLogs(getOpLogs());
    }
  }, [tab]);

  const isRead = (n: ActivityLog) => readIds.has(n.id);
  const unreadCount = notifications.filter((n) => !isRead(n)).length;

  const filtered = notifications.filter((n) => {
    if (typeFilter !== "all" && n.type !== typeFilter) return false;
    if (search && !n.message.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const filteredOps = opLogs.filter((op) => {
    if (opFilter !== "all" && op.status !== opFilter) return false;
    if (opSearch && !(`${op.action} ${op.target}`.toLowerCase().includes(opSearch.toLowerCase()))) return false;
    return true;
  });

  const handleClearOps = () => {
    clearOpLogs();
    setOpLogs([]);
  };

  return (
    <div className="p-6">
      {/* Tab 切换 */}
      <div className="flex items-center gap-1 mb-5 border-b border-slate-200">
        <button
          onClick={() => setTab("notifications")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "notifications"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Bell size={16} /> 通知
          {unreadCount > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-amber-100 text-amber-700">{unreadCount}</span>
          )}
        </button>
        <button
          onClick={() => setTab("operations")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "operations"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <History size={16} /> 操作记录
          {opLogs.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-slate-100 text-slate-600">{opLogs.length}</span>
          )}
        </button>
      </div>

      {/* === 通知 Tab === */}
      {tab === "notifications" && (
        <>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-500">
              共 {notifications.length} 条通知
              {unreadCount > 0 && <span className="ml-1 text-amber-600 font-medium">（{unreadCount} 条未读）</span>}
              {filtered.length !== notifications.length && `，筛选后 ${filtered.length} 条`}
            </p>
            {unreadCount > 0 && onMarkAllRead && (
              <button
                onClick={onMarkAllRead}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <CheckCircle2 size={14} /> 全部已读
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索通知..."
                className="w-56 pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">全部类型</option>
              <option value="info">信息</option>
              <option value="success">成功</option>
              <option value="warning">警告</option>
              <option value="error">错误</option>
            </select>
          </div>

          {filtered.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <Bell size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">暂无匹配的通知</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-slate-50">
                {filtered.map((item) => {
                  const read = isRead(item);
                  return (
                    <div key={item.id} className={`flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors ${read ? "opacity-60" : ""}`}>
                      <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${levelBg[item.type]}`}>
                        {levelIcon[item.type]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${levelColor[item.type]}`}>
                            {levelLabel[item.type]}
                          </span>
                          {!read && <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />}
                          <span className="text-xs text-slate-400">{item.timestamp}</span>
                        </div>
                        <p className="text-sm text-slate-700 leading-relaxed">{item.message}</p>
                      </div>
                      {!read && onMarkRead && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onMarkRead(item.id); }}
                          className="flex-shrink-0 px-2 py-1 text-xs text-blue-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors mt-0.5"
                        >
                          已读
                        </button>
                      )}
                      {read && (
                        <span className="flex-shrink-0 px-2 py-1 text-xs text-slate-400 mt-0.5">已读</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* === 操作记录 Tab === */}
      {tab === "operations" && (
        <>
          <div className="flex items-center justify-between mb-5">
            <p className="text-sm text-slate-500">
              共 {opLogs.length} 条操作记录
              {filteredOps.length !== opLogs.length && `，筛选后 ${filteredOps.length} 条`}
            </p>
            {opLogs.length > 0 && (
              <button
                onClick={handleClearOps}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} /> 清空记录
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 mb-5">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={opSearch}
                onChange={(e) => setOpSearch(e.target.value)}
                placeholder="搜索操作..."
                className="w-56 pl-8 pr-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400"
              />
            </div>
            <select
              value={opFilter}
              onChange={(e) => setOpFilter(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="all">全部状态</option>
              <option value="success">成功</option>
              <option value="failed">失败</option>
              <option value="running">执行中</option>
            </select>
          </div>

          {filteredOps.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <History size={32} className="mx-auto mb-3 text-slate-300" />
              <p className="text-sm text-slate-500">暂无操作记录</p>
              <p className="text-xs text-slate-400 mt-1">执行容器/堆栈操作后将自动记录</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="divide-y divide-slate-50">
                {filteredOps.map((op) => (
                  <div key={op.id} className="flex items-start gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">
                    <div className={`mt-0.5 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${opStatusBg[op.status]}`}>
                      {opStatusIcon[op.status]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${opStatusColor[op.status]}`}>
                          {opStatusLabel[op.status]}
                        </span>
                        <span className="text-sm font-medium text-slate-700">{op.action}</span>
                        <span className="text-xs text-slate-400">{op.timestamp}</span>
                      </div>
                      <p className="text-sm text-slate-600">
                        目标：<span className="font-mono text-slate-700">{op.target}</span>
                        {op.detail && <span className="ml-2 text-slate-400">— {op.detail}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
