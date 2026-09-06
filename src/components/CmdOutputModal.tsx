import React, { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Timer } from "lucide-react";
import { Modal } from "./Modal";

/** 命令输出弹窗数据：title 操作名、name 目标名、output 文本、failed 是否失败、streaming 是否执行中（SSE 实时推送） */
export interface CmdOutput {
  title: string;
  name: string;
  output: string;
  failed?: boolean;
  streaming?: boolean;
  /** 操作完成后自动关闭延迟（秒）；>0 时弹窗显示倒计时，到点自动关闭；0/未设 = 不自动关闭 */
  autoCloseDelay?: number;
}

/**
 * 终端风格命令输出弹窗（tail 文本）。
 * 所有会产生命令输出的操作（compose up/down、prune、备份/恢复、批量等）优先复用它。
 * streaming=true 时处于「执行中」状态：标题带转圈标识，正文白色文本实时滚动追加。
 * autoCloseDelay > 0 且操作已完成（streaming=false）时，弹窗显示倒计时并在到点后自动关闭；
 * 用户点击「取消自动关闭」可保持弹窗打开。
 */
export function CmdOutputModal({ data, onClose }: { data: CmdOutput | null; onClose: () => void }) {
  const ref = useRef<HTMLPreElement>(null);
  // 自动关闭倒计时状态
  const [remaining, setRemaining] = useState(0);
  const [countdownActive, setCountdownActive] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (data && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [data]);

  // 启动 / 重置自动关闭倒计时：操作执行中或尚未配置延迟时保持关闭
  useEffect(() => {
    // 新弹窗（无 data）或新操作开始（streaming）：清空倒计时并复位取消状态
    if (!data || data.streaming) {
      setCountdownActive(false);
      setRemaining(0);
      setDismissed(false);
      return;
    }
    // 未配置自动关闭，或已手动取消：不启动
    if (!data.autoCloseDelay || dismissed) {
      setCountdownActive(false);
      setRemaining(0);
      return;
    }
    setRemaining(data.autoCloseDelay);
    setCountdownActive(true);
    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(id);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [data, dismissed]);

  // 倒计时归零时关闭弹窗
  useEffect(() => {
    if (countdownActive && remaining <= 0) {
      setCountdownActive(false);
      onClose();
    }
  }, [remaining, countdownActive, onClose]);

  if (!data) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span>{`${data.title}${data.name ? " — " + data.name : ""}`}</span>
          {data.streaming ? (
            <span className="flex items-center gap-1 text-blue-500 text-sm font-normal">
              <Loader2 size={14} className="animate-spin" />
              执行中
            </span>
          ) : data.failed ? (
            <span className="text-red-500 text-sm font-normal">（失败）</span>
          ) : null}
        </span>
      }
      size="lg"
    >
      <pre
        ref={ref}
        className={`text-xs font-mono leading-relaxed bg-slate-900 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all ${
          data.failed ? "text-red-300" : data.streaming ? "text-slate-200" : "text-green-300"
        }`}
      >
        {data.output || (data.streaming ? "正在连接...\n" : "")}
      </pre>
      <div className="flex items-center justify-between gap-3 mt-4">
        {/* 左侧：自动关闭倒计时 + 取消按钮（仅操作完成且配置了延迟时显示） */}
        <div className="flex items-center gap-2 min-h-[36px]">
          {countdownActive && (
            <span className="flex items-center gap-2 text-sm text-slate-500">
              <Timer size={14} className="text-blue-500" />
              {remaining} 秒后自动关闭
              <button
                onClick={() => setDismissed(true)}
                className="px-2.5 py-1 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                取消自动关闭
              </button>
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => navigator.clipboard?.writeText(data.output)}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
          >
            复制输出
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
          >
            {data.streaming ? "后台运行" : "关闭"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** 管理命令输出弹窗状态的 hook，所有页面优先复用，避免重复实现 tail 文本弹窗 */
export function useCmdOutput() {
  const [cmdOutput, setCmdOutput] = useState<CmdOutput | null>(null);
  const showOutput = useCallback(
    (o: Omit<CmdOutput, "failed" | "streaming"> & { failed?: boolean; streaming?: boolean }) => setCmdOutput(o),
    []
  );
  /** 增量更新弹窗内容（SSE 流式输出时逐块追加/更新状态） */
  const patchOutput = useCallback(
    (patch: Partial<CmdOutput>) => setCmdOutput((prev) => (prev ? { ...prev, ...patch } : prev)),
    []
  );
  const closeOutput = useCallback(() => setCmdOutput(null), []);
  return { cmdOutput, showOutput, patchOutput, closeOutput };
}
