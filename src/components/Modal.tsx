import React, { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  /**
   * 内容区容器样式。默认带 padding 且自身滚动；
   * 需要内部 flex 布局（如多页签 + 各自滚动）时传 "flex-1 min-h-0 flex flex-col overflow-hidden"。
   */
  bodyClassName?: string;
  footer?: React.ReactNode;
  /**
   * 是否允许点击遮罩 / ESC 关闭。
   * 默认 false：弹窗只能点右上角 X 或底部按钮关闭，避免误触遮罩丢失编辑内容；
   * 少数纯查看类弹窗可显式传 true 恢复「点外部关闭」。
   */
  dismissable?: boolean;
}

const sizeMap = {
  sm: "max-w-md",
  md: "max-w-2xl",
  lg: "max-w-4xl",
  xl: "max-w-6xl",
  full: "max-w-[95vw] h-[90vh]",
};

export function Modal({ open, onClose, title, children, size = "md", bodyClassName, footer, dismissable = false }: ModalProps) {
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
        <div className={bodyClassName ?? "flex-1 overflow-y-auto px-6 py-4"}>{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /**
   * 是否允许点击遮罩 / ESC 关闭。
   * 默认 true：半页面多为「查看类」，点外部关闭不易丢数据。
   */
  dismissable?: boolean;
  /** 面板宽度类：默认覆盖约半屏（小屏占满）。`resizable` 且拖动过宽度后此值失效 */
  panelClassName?: string;
  /** 是否允许拖动面板左缘调整宽度（默认否） */
  resizable?: boolean;
  /** 拖动时的最小宽度（px） */
  minWidth?: number;
  /** 拖动时的最大宽度占视口比例（0~1） */
  maxWidthRatio?: number;
}

/**
 * 半页面抽屉（1panel 风格容器详情）。
 *
 * 与 `Modal` 同为遮罩式浮层，区别在于：面板贴合屏幕**右缘**、铺满高度、
 * 覆盖约半屏（`md:w-1/2`），左侧列表仍可见；内容区自行滚动。
 *
 * `resizable` 打开后，面板左缘出现拖拽手柄，可左右拖动改变宽度（双击手柄复位半屏）。
 */
export function Drawer({
  open,
  onClose,
  children,
  dismissable = true,
  panelClassName = "w-full md:w-1/2",
  resizable = false,
  minWidth = 380,
  maxWidthRatio = 0.92,
}: DrawerProps) {
  /** null = 未拖动过，沿用 `panelClassName` 的响应式宽度 */
  const [width, setWidth] = useState<number | null>(null);
  const draggingRef = useRef(false);
  /** 拖动后紧跟的那次 click 若落在遮罩上，会被误判成「点外部关闭」，需吞掉 */
  const justDraggedRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
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

  // 拖动改宽：向左拖（clientX 变小）变宽，向右拖变窄
  useEffect(() => {
    if (!resizable) return;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const maxWidth = window.innerWidth * maxWidthRatio;
      const next = Math.round(Math.min(maxWidth, Math.max(minWidth, startWidthRef.current - (e.clientX - startXRef.current))));
      setWidth(next);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      window.setTimeout(() => { justDraggedRef.current = false; }, 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizable, minWidth, maxWidthRatio]);

  if (!open) return null;

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const panel = e.currentTarget.parentElement as HTMLElement | null;
    draggingRef.current = true;
    justDraggedRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = width ?? panel?.getBoundingClientRect().width ?? window.innerWidth / 2;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-[1000] flex justify-end bg-black/40"
      onClick={() => {
        if (justDraggedRef.current) { justDraggedRef.current = false; return; }
        if (dismissable) onClose();
      }}
    >
      <div
        className={`drawer-content relative bg-white h-full shadow-2xl flex flex-col overflow-hidden ${width == null ? panelClassName : ""}`}
        style={width == null ? undefined : { width: `${width}px`, minWidth: `${minWidth}px` }}
        onClick={(e) => e.stopPropagation()}
      >
        {resizable && (
          <div
            onMouseDown={handleDragStart}
            onDoubleClick={() => setWidth(null)}
            title="拖动调整宽度（双击复位）"
            className="group absolute left-0 top-0 z-20 flex h-full w-2.5 cursor-col-resize items-center justify-center"
          >
            <div className="h-10 w-[3px] rounded-full bg-slate-300 transition-colors group-hover:bg-blue-500" />
          </div>
        )}
        {children}
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
  primaryFirst = false,
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
  /** true 时主操作（确认）排左侧、取消排右侧；默认相反（取消在左、确认在右） */
  primaryFirst?: boolean;
}) {
  const cancelButton = (
    <button
      onClick={onClose}
      disabled={loading}
      className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {cancelText}
    </button>
  );
  const extraButton = extraAction ? (
    <button
      onClick={extraAction.onClick}
      disabled={loading}
      className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {extraAction.loading ? "处理中..." : extraAction.label}
    </button>
  ) : null;
  const confirmButton = (
    <button
      onClick={onConfirm}
      disabled={loading}
      className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        danger ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"
      }`}
    >
      {loading ? "处理中..." : confirmText}
    </button>
  );

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <div className="py-2">
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-sm text-slate-600 mb-2">{message}</p>
        {errorMessage && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{errorMessage}</p>
        )}
        <div className="flex justify-end gap-3 mt-6">
          {primaryFirst ? (
            <>
              {confirmButton}
              {extraButton}
              {cancelButton}
            </>
          ) : (
            <>
              {cancelButton}
              {extraButton}
              {confirmButton}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
