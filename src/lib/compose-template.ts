import type { ComposeInsertPosition } from "../types";

/**
 * 一键填入模板的填入位置选项（数组顺序即 UI 展示顺序）。
 * 缩进说明以标准 2 空格缩进的 compose 为准；实际填入时会随文档现有缩进自适应。
 */
export const COMPOSE_INSERT_OPTIONS: {
  value: ComposeInsertPosition;
  label: string;
  hint: string;
}[] = [
  { value: "services", label: "services 下", hint: "services 下第一个服务内部（缩进 4 空格）" },
  { value: "environment", label: "environment 下", hint: "第一个服务的 environment 下（缩进 6 空格）" },
  { value: "volumes", label: "volumes 下", hint: "第一个服务的 volumes 下（缩进 6 空格）" },
  { value: "cursor", label: "指针处", hint: "编辑器光标所在行的下一行（需先点击定位）" },
  { value: "end", label: "末尾", hint: "追加到 compose 文本最后一行" },
];

/** 兼容旧配置：历史存过的 "service" 视为 "services"，其它未知值兜底为 services */
export function normalizeInsert(v: string): ComposeInsertPosition {
  if (v === "end" || v === "cursor" || v === "environment" || v === "volumes") return v;
  return "services";
}

/** 位置的中文短标签（模板按钮徽标、提示文案用） */
export function insertPositionLabel(v: string): string {
  return COMPOSE_INSERT_OPTIONS.find((o) => o.value === normalizeInsert(v))?.label ?? "services 下";
}
