import React from "react";

/**
 * 卡片栅格：默认单列，`sm`(640) 起双列，`3xl`(1800，见 tailwind.config.js) 起三列。
 * 仪表盘每个磁贴可用宽度约 490–610px，双列时每卡约 240–300px，正好容纳「图标 + 名称 + 徽章」。
 */
export function NodeCardGrid({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 3xl:grid-cols-3 gap-2.5 ${className}`}>{children}</div>
  );
}

export interface FilterOption<T extends string> {
  key: T;
  label: string;
  /** 右侧计数（可选） */
  count?: number;
}

/**
 * 磁贴的筛选分段控件（与 NodeCardGrid 配套）。
 * 形态沿用堆栈子表的「列显隐」胶囊按钮，选中为蓝底，未选中为白底灰字。
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: FilterOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
              active
                ? "bg-blue-50 border-blue-200 text-blue-600 font-medium"
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {o.label}
            {typeof o.count === "number" && (
              <span className={`ml-1 ${active ? "text-blue-500" : "text-slate-400"}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
