import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { MoreVertical } from "lucide-react";

// Toggle Switch
export function Toggle({
  active,
  onChange,
  size = "md",
}: {
  active: boolean;
  onChange?: (val: boolean) => void;
  size?: "sm" | "md";
}) {
  const w = size === "sm" ? "w-8 h-[18px]" : "w-10 h-[22px]";
  const dotSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const translate = size === "sm" ? "translate-x-[14px]" : "translate-x-[18px]";

  return (
    <button
      onClick={() => onChange?.(!active)}
      className={`relative ${w} rounded-full transition-colors ${active ? "bg-blue-500" : "bg-slate-300"}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 left-0.5 ${dotSize} bg-white rounded-full shadow-sm transition-transform ${
          active ? translate : ""
        }`}
      />
    </button>
  );
}

// Progress Bar
export function ProgressBar({
  value,
  max = 100,
  color = "blue",
  showLabel = false,
  label,
  indeterminate = false,
}: {
  value?: number;
  max?: number;
  color?: "blue" | "green" | "amber" | "red" | "purple";
  showLabel?: boolean;
  label?: string;
  indeterminate?: boolean;
}) {
  const percent = value === undefined ? 0 : Math.min((value / max) * 100, 100);
  const colors: Record<string, string> = {
    blue: "bg-blue-500",
    green: "bg-green-500",
    amber: "bg-amber-500",
    red: "bg-red-500",
    purple: "bg-purple-500",
  };
  const barColor = percent > 90 ? "bg-red-500" : percent > 70 ? "bg-amber-500" : colors[color];

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${indeterminate ? colors[color] + " animate-progress-indeterminate" : barColor + " rounded-full transition-all duration-300"}`}
          style={indeterminate ? { width: "40%" } : { width: `${percent}%` }}
        />
      </div>
      {showLabel && (
        <span className="text-xs text-slate-500 font-mono min-w-[60px] text-right">
          {label || `${percent.toFixed(1)}%`}
        </span>
      )}
    </div>
  );
}

// Empty State
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 mb-4">{icon}</div>}
      <h3 className="text-base font-semibold text-slate-700 mb-1">{title}</h3>
      {description && <p className="text-sm text-slate-500 mb-4 max-w-md">{description}</p>}
      {action}
    </div>
  );
}

// Tooltip (simple)
export function Tooltip({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-xs text-white bg-slate-800 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
        {text}
      </span>
    </span>
  );
}

// IconButton
export function IconButton({
  icon,
  onClick,
  title,
  variant = "default",
  size = "md",
  disabled = false,
}: {
  icon: React.ReactNode;
  onClick?: () => void;
  title?: string;
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
}) {
  const sizes = {
    sm: "w-7 h-7",
    md: "w-8 h-8",
  };
  const variants = {
    default: "text-slate-600 hover:bg-slate-100",
    primary: "text-blue-600 hover:bg-blue-50",
    danger: "text-red-600 hover:bg-red-50",
    ghost: "text-slate-400 hover:bg-slate-100 hover:text-slate-600",
  };
  const iconSize = size === "sm" ? 14 : 16;

  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`${sizes[size]} flex items-center justify-center rounded-lg transition-colors ${disabled ? "text-slate-300 cursor-not-allowed" : variants[variant]}`}
    >
      {React.cloneElement(icon as React.ReactElement, { size: iconSize })}
    </button>
  );
}

// ActionDropdown — single button that opens a dropdown menu
export interface ActionItem {
  label?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
}

export function ActionDropdown({
  items,
  align = "right",
  size = "sm",
  trigger,
}: {
  items: ActionItem[];
  align?: "left" | "right";
  size?: "sm" | "md";
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (btnRef.current && !btnRef.current.contains(target) && menuRef.current && !menuRef.current.contains(target)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const menuHeight = Math.min(items.filter(i => !i.separator).length * 36 + items.filter(i => i.separator).length * 9 + 8, 400);
    const menuWidth = 180;

    let top = rect.bottom + 4;
    let left: number | undefined = rect.left;
    let right: number | undefined;

    // If menu would go off bottom of viewport, show above
    if (top + menuHeight > window.innerHeight - 8) {
      top = rect.top - menuHeight - 4;
    }

    if (align === "right") {
      left = undefined;
      right = window.innerWidth - rect.right;
      // Prevent going off left edge
      if (window.innerWidth - right - menuWidth < 8) {
        right = 8;
      }
    } else {
      // Prevent going off right edge
      if ((left || 0) + menuWidth > window.innerWidth - 8) {
        left = window.innerWidth - menuWidth - 8;
      }
    }

    setMenuPos({ top, left, right });
  }, [open, align, items]);

  const btnSize = size === "sm" ? "w-7 h-7" : "w-8 h-8";
  const iconSize = size === "sm" ? 14 : 16;

  const menuContent = (
    <div
      ref={menuRef}
      className="fixed z-[9999] min-w-[180px] bg-white rounded-lg border border-slate-200 shadow-lg py-1"
      style={menuPos ? { top: menuPos.top, left: menuPos.left, right: menuPos.right } : { visibility: "hidden" }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, index) => {
        if (item.separator) {
          return <div key={index} className="my-1 border-t border-slate-100" />;
        }
        return (
          <button
            key={index}
            disabled={item.disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled && item.onClick) {
                item.onClick();
                setOpen(false);
              }
            }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
              item.disabled
                ? "text-slate-300 cursor-not-allowed"
                : item.danger
                ? "text-red-600 hover:bg-red-50"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            {item.icon && <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="relative inline-block" ref={btnRef}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className={`${btnSize} flex items-center justify-center rounded-lg transition-colors text-slate-400 hover:bg-slate-100 hover:text-slate-600`}
        title="操作"
      >
        {trigger || React.cloneElement(<MoreVertical /> as React.ReactElement, { size: iconSize })}
      </button>
      {open && createPortal(menuContent, document.body)}
    </div>
  );
}

// Section Card
export function Card({
  title,
  icon,
  actions,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
          <div className="flex items-center gap-2">
            {icon && <span className="text-slate-500">{icon}</span>}
            {title && <h3 className="text-sm font-semibold text-slate-700">{title}</h3>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`px-5 py-4 ${bodyClassName}`}>{children}</div>
    </div>
  );
}

// Form Field
export function FormField({
  label,
  required,
  children,
  hint,
  className = "",
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-600 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

// Input
export function Input({
  value,
  onChange,
  placeholder,
  type = "text",
  disabled,
  className = "",
}: {
  value: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all disabled:bg-slate-50 disabled:text-slate-400 ${className}`}
    />
  );
}

// Select
export function Select({
  value,
  onChange,
  options,
  className = "",
}: {
  value: string;
  onChange?: (val: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-all bg-white ${className}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// Toast notification
export function Toast({ message, type, onClose }: { message: string; type: "success" | "error" | "info"; onClose: () => void }) {
  const colors = {
    success: "bg-green-600",
    error: "bg-red-600",
    info: "bg-blue-600",
  };
  return (
    <div className="fixed bottom-6 right-6 z-[2000] animate-slide-up">
      <div className={`${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-[280px]`}>
        <span className="text-sm font-medium flex-1">{message}</span>
        <button onClick={onClose} className="text-white/80 hover:text-white">
          ✕
        </button>
      </div>
    </div>
  );
}
