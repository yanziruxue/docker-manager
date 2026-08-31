import React, { useEffect, useRef } from "react";
import { ChevronRight } from "lucide-react";

export interface MenuItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  // Adjust position to prevent overflow
  const adjustedX = Math.min(x, window.innerWidth - 220);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div
      ref={ref}
      className="context-menu fixed z-[9999] min-w-[200px] bg-slate-800 rounded-lg shadow-2xl border border-slate-700 py-1.5"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="my-1 border-t border-slate-700" />;
        }
        return (
          <button
            key={index}
            disabled={item.disabled}
            onClick={() => {
              if (!item.disabled && item.onClick) {
                item.onClick();
                onClose();
              }
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-sm text-left transition-colors ${
              item.disabled
                ? "text-slate-600 cursor-not-allowed"
                : item.danger
                ? "text-red-400 hover:bg-red-900/30"
                : "text-slate-200 hover:bg-slate-700"
            }`}
          >
            {item.icon && <span className="w-4 h-4 flex-shrink-0">{item.icon}</span>}
            <span className="flex-1">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
