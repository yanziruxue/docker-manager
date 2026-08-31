import React, { useState, useCallback, useRef, useEffect } from "react";
import { Modal } from "./Modal";

/** 命令输出弹窗数据：title 操作名、name 目标名、output 文本、failed 是否失败 */
export interface CmdOutput {
  title: string;
  name: string;
  output: string;
  failed?: boolean;
}

/**
 * 终端风格命令输出弹窗（tail 文本）。
 * 所有会产生命令输出的操作（compose up/down、prune、备份/恢复、批量等）优先复用它。
 */
export function CmdOutputModal({ data, onClose }: { data: CmdOutput | null; onClose: () => void }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (data && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [data]);
  if (!data) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title={`${data.title}${data.name ? " — " + data.name : ""}${data.failed ? "（失败）" : ""}`}
      size="lg"
    >
      <pre
        ref={ref}
        className={`text-xs font-mono leading-relaxed bg-slate-900 rounded-lg p-4 overflow-auto max-h-[60vh] whitespace-pre-wrap break-all ${
          data.failed ? "text-red-300" : "text-green-300"
        }`}
      >
        {data.output}
      </pre>
      <div className="flex justify-end gap-2 mt-4">
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
          关闭
        </button>
      </div>
    </Modal>
  );
}

/** 管理命令输出弹窗状态的 hook，所有页面优先复用，避免重复实现 tail 文本弹窗 */
export function useCmdOutput() {
  const [cmdOutput, setCmdOutput] = useState<CmdOutput | null>(null);
  const showOutput = useCallback(
    (o: Omit<CmdOutput, "failed"> & { failed?: boolean }) => setCmdOutput(o),
    []
  );
  const closeOutput = useCallback(() => setCmdOutput(null), []);
  return { cmdOutput, showOutput, closeOutput };
}
