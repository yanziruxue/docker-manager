import React from "react";

interface BadgeProps {
  status: string;
}

const statusConfig: Record<string, { color: string; label: string; dot: string }> = {
  running: { color: "bg-green-100 text-green-700 border-green-200", label: "运行中", dot: "bg-green-500" },
  stopped: { color: "bg-slate-100 text-slate-500 border-slate-200", label: "已停止", dot: "bg-slate-400" },
  paused: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "已暂停", dot: "bg-amber-500" },
  restarting: { color: "bg-blue-100 text-blue-700 border-blue-200", label: "重启中", dot: "bg-blue-500" },
  updating: { color: "bg-purple-100 text-purple-700 border-purple-200", label: "更新中", dot: "bg-purple-500" },
  partial: { color: "bg-amber-100 text-amber-700 border-amber-200", label: "部分运行", dot: "bg-amber-500" },
  error: { color: "bg-red-100 text-red-700 border-red-200", label: "错误", dot: "bg-red-500" },
};

export function StatusBadge({ status }: BadgeProps) {
  const config = statusConfig[status] || statusConfig.stopped;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${config.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} ${status === "running" || status === "updating" || status === "restarting" ? "animate-pulse" : ""}`} />
      {config.label}
    </span>
  );
}

export function CountBadge({ count, color = "blue" }: { count: number; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-100 text-blue-600",
    green: "bg-green-100 text-green-600",
    red: "bg-red-100 text-red-600",
    amber: "bg-amber-100 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <span className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-semibold ${colors[color] || colors.blue}`}>
      {count}
    </span>
  );
}

export function Tag({ text, color = "slate" }: { text: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    green: "bg-green-50 text-green-600 border-green-100",
    red: "bg-red-50 text-red-600 border-red-100",
    amber: "bg-amber-50 text-amber-600 border-amber-100",
    purple: "bg-purple-50 text-purple-600 border-purple-100",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${colors[color] || colors.slate}`}>
      {text}
    </span>
  );
}
