import React, { useState } from "react";
import { RefreshCw, CheckCircle2, Tag as TagIcon } from "lucide-react";
import type { Stack, StackContainer } from "../types";
import { Modal } from "./Modal";
import { StatusBadge, Tag } from "./Badge";
import { shortImageRef } from "../transforms";

/** 容器子表可选列（列显隐来源：系统设置 → 列显隐 → 容器子表） */
export const STACK_SUB_COLUMNS: { key: string; label: string }[] = [
  { key: "name", label: "容器名称" },
  { key: "image", label: "镜像" },
  { key: "status", label: "状态" },
  { key: "network", label: "网络" },
  { key: "ip", label: "容器 IP" },
  { key: "ports", label: "端口" },
  { key: "update", label: "更新" },
];

const TH = "text-left text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-3 py-2";

interface StackContainersModalProps {
  /** 目标堆栈（含 containers 快照） */
  stack: Stack;
  onClose: () => void;
  /** 初始可见列；缺省或为空数组时全部显示 */
  defaultVisibleColumns?: string[];
  /** 操作中的容器 / 堆栈名集合：命中时状态显示为「执行中」 */
  operatingNames?: Set<string>;
  /** 右键容器行回调（堆栈页用于打开右键菜单）；不传则忽略右键 */
  onContainerContextMenu?: (e: React.MouseEvent, stack: Stack, container: StackContainer) => void;
  /** 标题语言（默认中文） */
  language?: "zh" | "en";
}

/**
 * 堆栈容器子表弹窗：查看某个堆栈下的容器明细。
 * 原本内联在 Stacks.tsx（堆栈页点击状态列弹出），仪表盘「堆栈」磁贴点图标也要复用同一张子表，
 * 故抽成共享组件；列显隐状态由组件自持，与原内联版本行为完全一致（Profiles / 列显隐 / 右键菜单）。
 */
export function StackContainersModal({
  stack,
  onClose,
  defaultVisibleColumns,
  operatingNames,
  onContainerContextMenu,
  language = "zh",
}: StackContainersModalProps) {
  const [visible, setVisible] = useState<Set<string>>(() =>
    defaultVisibleColumns && defaultVisibleColumns.length > 0
      ? new Set(defaultVisibleColumns)
      : new Set(STACK_SUB_COLUMNS.map((c) => c.key))
  );

  const toggle = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const has = (key: string) => visible.has(key);
  const title = `${language === "zh" ? "容器子表" : "Containers"} · ${stack.name}`;

  return (
    <Modal open onClose={onClose} title={title} size="lg" dismissable>
      <div className="space-y-3">
        {/* Profiles */}
        {stack.profiles.length > 0 && (
          <div className="flex items-center gap-2 py-2 border-b border-slate-100">
            <TagIcon size={12} className="text-slate-400" />
            <span className="text-xs text-slate-500">Profiles:</span>
            {stack.profiles.map((p) => (
              <Tag key={p} text={p} color={p === stack.settings.defaultProfiles[0] ? "blue" : "slate"} />
            ))}
            <span className="text-xs text-slate-400 ml-2">
              默认: {stack.settings.defaultProfiles.join(", ") || "无"}
            </span>
          </div>
        )}

        {/* 列显隐控制 */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-400">显示列:</span>
          {STACK_SUB_COLUMNS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => toggle(c.key)}
              className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                has(c.key)
                  ? "bg-blue-50 border-blue-200 text-blue-600"
                  : "bg-slate-50 border-slate-200 text-slate-400"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Container Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-50">
                {has("name") && <th className={TH}>容器名称</th>}
                {has("image") && <th className={TH}>镜像</th>}
                {has("status") && <th className={TH}>状态</th>}
                {has("network") && <th className={TH}>网络</th>}
                {has("ip") && <th className={TH}>容器 IP</th>}
                {has("ports") && <th className={TH}>端口</th>}
                {has("update") && <th className={TH}>更新</th>}
              </tr>
            </thead>
            <tbody>
              {stack.containers.length === 0 ? (
                <tr>
                  <td colSpan={visible.size || 1} className="px-3 py-8 text-center text-sm text-slate-400">
                    该堆栈暂无容器
                  </td>
                </tr>
              ) : (
                stack.containers.map((container) => (
                  <tr
                    key={container.name}
                    className={`hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${
                      onContainerContextMenu ? "cursor-context-menu" : ""
                    }`}
                    onContextMenu={
                      onContainerContextMenu
                        ? (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onContainerContextMenu(e, stack, container);
                          }
                        : undefined
                    }
                  >
                    {has("name") && (
                      <td className="px-3 py-2.5">
                        <span className="text-sm font-medium text-slate-700">{container.name}</span>
                        {container.isPinned && <Tag text="已固定" color="green" />}
                      </td>
                    )}
                    {has("image") && (
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono text-slate-600" title={`${container.image}:${container.tag}`}>
                          {shortImageRef(container.image)}
                        </span>
                        <span className="text-xs font-mono text-slate-400">:{container.tag}</span>
                      </td>
                    )}
                    {has("status") && (
                      <td className="px-3 py-2.5">
                        <StatusBadge
                          status={operatingNames?.has(container.name) ? "operating" : container.status}
                        />
                      </td>
                    )}
                    {has("network") && (
                      <td className="px-3 py-2.5">
                        <span className="text-xs text-slate-500">{container.network}</span>
                      </td>
                    )}
                    {has("ip") && (
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono text-slate-500">{container.ip}</span>
                      </td>
                    )}
                    {has("ports") && (
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-mono text-slate-500">{container.ports}</span>
                      </td>
                    )}
                    {has("update") && (
                      <td className="px-3 py-2.5">
                        {container.hasUpdate ? (
                          <>
                            <span className="flex items-center gap-1 text-xs text-amber-600">
                              <RefreshCw size={10} /> 可更新
                            </span>
                            <button type="button" className="text-xs text-blue-600 hover:underline ml-2">
                              强制更新
                            </button>
                          </>
                        ) : (
                          <CheckCircle2 size={14} className="text-green-400" />
                        )}
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
