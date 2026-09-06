import React from "react";

/** 加载中状态 */
export function LoadingState({ message = "正在加载数据..." }: { message?: string }) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}

/** 错误状态 */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center text-red-500 text-xl">
          ⚠
        </div>
        <div>
          <p className="text-sm font-medium text-slate-700">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-xs text-blue-500 hover:text-blue-600"
            >
              点击重试
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
