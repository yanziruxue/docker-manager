import React, { useEffect, useState } from "react";

interface TileGridProps {
  /**
   * 每一列的内容（按顺序对应第 1/2/3 列）。
   * 断点：`lg`(1024) 起 2 列，`3xl`(1800，见 tailwind.config.js) 起 3 列；低于 `lg` 单列堆叠。
   *
   * ⚠️ **列元素个数不能超过当前列数**（`lg` 2 / `3xl` 3）。CSS 断点只能改 `grid-cols-*`，
   * 改不了子元素个数——2 列档塞 3 个元素时，第 3 个会被折到**第 2 行第 1 格**；
   * 而栅格**行高 = 该行最高单元**，折叠上方磁贴只让本列变矮，第 2 行纹丝不动，
   * 于是表现为「折叠后下方的磁贴不会上移」并留出大片空白。
   * 单列档不受此限：3 个元素各占一行、行内只有一格，堆叠即还原顺序。
   * 用 `useMinWidth(1800)` / `useMinWidth(1024)` 按断点决定分组（见 `Dashboard.tsx`）。
   */
  columns: React.ReactNode[];
  className?: string;
}

/**
 * 磁贴栅格（照搬 Unraid 仪表盘布局）：
 *  - 每列是一个独立的纵向 flex 容器，`gap-5`（=20px，与 Unraid `gap:2rem` 一致）
 *  - 列与列之间同宽（`1fr`），列内磁贴高度互不影响（`items-start`）
 *
 * 列内重排是自动的：磁贴折叠后自身高度收缩，同列下方的磁贴随即上移（纵向 flex 流）。
 */
export function TileGrid({ columns, className = "" }: TileGridProps) {
  return (
    <div className={`grid grid-cols-1 lg:grid-cols-2 3xl:grid-cols-3 gap-5 items-start ${className}`}>
      {columns.map((col, i) => (
        <div key={i} className="flex flex-col gap-5 min-w-0">
          {col}
        </div>
      ))}
    </div>
  );
}

/**
 * 视口宽度是否 ≥ `px`（tailwind `3xl` 等断点的 JS 版本，含 resize 监听）。
 * 用于按断点改变**列的构成**（哪几个磁贴放进哪一列）——纯 CSS 做不到这件事。
 * 初值在首帧同步取，避免先渲染一套再闪成另一套。
 */
export function useMinWidth(px: number) {
  const [matched, setMatched] = useState<boolean>(() =>
    typeof window === "undefined" ? false : window.matchMedia(`(min-width: ${px}px)`).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const sync = () => setMatched(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [px]);

  return matched;
}
