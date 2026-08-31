import React, { useEffect } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  footer?: React.ReactNode;
  /** 是否允许点击遮罩 / ESC 关闭（默认 true）；表单类弹窗可设为 false 防误关丢失内容 */
  dismissable?: boolean;
}

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[95vw] h-[90vh]",
};

export function Modal({ open, onClose, title, children, size = "md", footer, dismissable = true }: ModalProps) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      // dismissable 为 false 时屏蔽 ESC 关闭，防止误触丢失编辑内容
      if (e.key === "Escape" && dismissable) onClose();
    };
    if (open) {
      document.addEventListener("keydown", handleEsc);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay fixed inset-0 z-[1000] flex items-center justify-center bg-black/40"
      onClick={() => { if (dismissable) onClose(); }}
    >
      <div
        className={`modal-content bg-white rounded-xl shadow-2xl w-full ${sizeMap[size]} flex flex-col max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 transition-colors">
              <X size={20} className="text-slate-500" />
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "确认",
  cancelText = "取消",
  danger = false,
  loading = false,
  errorMessage,
  extraAction,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  loading?: boolean;
  errorMessage?: string | null;
  /** 次要操作（如删除冲突后的「强制删除」），仅在提供时渲染 */
  extraAction?: { label: string; onClick: () => void; loading?: boolean };
}) {
  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="py-2">
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-2">{message}</p>
        {errorMessage && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{errorMessage}</p>
        )}
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {cancelText}
          </button>
          {extraAction && (
            <button
              onClick={extraAction.onClick}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {extraAction.loading ? "处理中..." : extraAction.label}
            </button>
          )}
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              danger ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"
            }`}
          >
            {loading ? "处理中..." : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
