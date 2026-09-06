/**
 * ============================================
 * YAML 编辑器（语法高亮 + 实时 Lint + 格式化）
 * ============================================
 *
 * 用 textarea + 高亮层叠（textarea 文字透明，光标可见，背后 <pre> 着色）
 * 实现轻量语法高亮；每次输入用 js-yaml 实时解析，捕获缩进/语法错误并在状态栏
 * 提示「YAML 格式错误」+ 行号 + 列号 + 原因。右上角「格式化」按钮重新序列化
 * 当前合法内容，等价于「自动修正缩进 + 格式化美化」。
 *
 * 设计取舍：
 * - 不用 CodeMirror/Monaco：体积大、构建链复杂；本组件 ~10KB，零依赖冲突；
 *   能覆盖 compose YAML 的 99% 用法（缩进、键值、列表、注释、字符串/数字/布尔）。
 * - white-space: pre（不换行）：textarea 与 <pre> 字符级对齐最简单，
 *   长行靠水平滚动，避免 wrap 导致高亮层错位。
 * - 所有 token 文本都过 escapeHtml 之后再注入 dangerouslySetInnerHTML，
 *   用户 YAML 不能注入 HTML（即使含 <script>）。
 * - lint 用 yaml.load 全量解析；compose 几 KB 文本下开销可忽略。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Wand2 } from "lucide-react";
import * as yaml from "js-yaml";

/** 高亮配色：与 shell 控制台风格一致（蓝键 / 绿串 / 黄数 / 粉布尔 / 橙列表项 / 灰注释） */
const COLORS = {
  comment: "#8a93a6",
  key: "#60a5fa",
  string: "#34d399",
  number: "#fbbf24",
  bool: "#f472b6",
  dash: "#f59e0b",
  punctuation: "#94a3b8",
};

/** HTML 转义：用户 YAML 内容直接注入 <pre>，必须先转义 <、>、& */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 定位行内注释起点：仅当 '#' 在单/双引号外、且前一位是空白（或行首）才算注释起点。
 * 这避免了 URL/颜色/带 # 的字符串被误判。YAML 注释规则简化版。
 */
function findCommentIndex(line: string): number {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble) {
      if (i === 0 || /\s/.test(line[i - 1])) return i;
    }
  }
  return -1;
}

/** 给一段「值」字符串上色（已识别到的冒号右侧或列表项 - 后内容） */
function highlightValue(v: string): string {
  const t = v.trim();
  if (t === "") return escapeHtml(v);
  // 引号字符串（含未闭合的引号 → 输入中，也染成字符串色以提示）
  if (/^["'].*["']$/.test(t) || /^["'].*$/.test(t)) {
    return `<span style="color:${COLORS.string}">${escapeHtml(v)}</span>`;
  }
  // 布尔/真假关键字
  if (/^(true|false|yes|no|null|on|off|~)$/i.test(t)) {
    return `<span style="color:${COLORS.bool}">${escapeHtml(v)}</span>`;
  }
  // 数字
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    return `<span style="color:${COLORS.number}">${escapeHtml(v)}</span>`;
  }
  return escapeHtml(v);
}

/** 单行高亮：拆出注释 / 前导空白 / 列表项短横 / 键值 / 值，分别着色 */
function highlightLine(line: string): string {
  // 整行注释
  if (/^\s*#/.test(line)) {
    return `<span style="color:${COLORS.comment}">${escapeHtml(line)}</span>`;
  }
  const hashIdx = findCommentIndex(line);
  let codePart = line;
  let commentPart = "";
  if (hashIdx >= 0) {
    codePart = line.slice(0, hashIdx);
    commentPart = line.slice(hashIdx);
  }
  let html = "";
  const dashMatch = /^(\s*)(-\s+)(.*)$/.exec(codePart);
  let body = codePart;
  if (dashMatch) {
    html += escapeHtml(dashMatch[1]);
    html += `<span style="color:${COLORS.dash}">-</span>`;
    body = dashMatch[3];
  } else {
    const ind = /^(\s*)/.exec(codePart);
    const ws = ind ? ind[1] : "";
    html += escapeHtml(ws);
    body = codePart.slice(ws.length);
  }
  // 键：字母/数字/_/./[]/- 组成；后跟英文冒号
  const kv = /^([A-Za-z0-9_.\[\]\/-]+)(:)(\s*)(.*)$/.exec(body);
  if (kv) {
    html += `<span style="color:${COLORS.key}">${escapeHtml(kv[1])}</span>`;
    html += `<span style="color:${COLORS.punctuation}">:</span>`;
    html += escapeHtml(kv[3]);
    html += highlightValue(kv[4]);
  } else {
    html += highlightValue(body);
  }
  if (commentPart) {
    html += `<span style="color:${COLORS.comment}">${escapeHtml(commentPart)}</span>`;
  }
  return html;
}

/** 整段高亮：逐行着色后用 \n 拼接 */
function highlight(code: string): string {
  if (!code) return "";
  return code.split("\n").map(highlightLine).join("\n");
}

/** Lint 错误信息（行/列均为 1-based） */
export interface YamlValidationError {
  line: number;
  column: number;
  message: string;
}

export interface YamlEditorProps {
  value: string;
  onChange: (val: string) => void;
  /** 每次校验结果变化时回调，便于父组件联动（禁用保存按钮等） */
  onValidChange?: (valid: boolean, error: YamlValidationError | null) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  /** 设为 false 可隐藏工具栏「格式化」按钮 */
  showFormat?: boolean;
}

export function YamlEditor({
  value,
  onChange,
  onValidChange,
  placeholder,
  minHeight = 380,
  className,
  showFormat = true,
}: YamlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<YamlValidationError | null>(null);
  const [valid, setValid] = useState(true);

  // 高亮是纯函数 + useMemo 缓存，避免每次按键重新生成
  const highlighted = useMemo(() => highlight(value), [value]);
  // 行号列表（1-based）
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  // 把 onValidChange 装进 ref，避免 useEffect 因回调身份变化反复触发 → 无限循环风险
  const cbRef = useRef(onValidChange);
  useEffect(() => {
    cbRef.current = onValidChange;
  }, [onValidChange]);

  // 每次 value 变更做一次实时 lint
  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setValid(true);
      setError(null);
      cbRef.current?.(true, null);
      return;
    }
    try {
      yaml.load(value);
      setValid(true);
      setError(null);
      cbRef.current?.(true, null);
    } catch (e: any) {
      const mark = e?.mark;
      let err: YamlValidationError;
      if (mark && typeof mark.line === "number") {
        err = {
          line: mark.line + 1,
          column: (mark.column ?? 0) + 1,
          message: stripYamlPrefix(e.message) || "YAML 格式错误",
        };
      } else {
        err = { line: 1, column: 1, message: stripYamlPrefix(e?.message) || "YAML 格式错误" };
      }
      setValid(false);
      setError(err);
      cbRef.current?.(false, err);
    }
  }, [value]);

  /** 同步 textarea 滚动到高亮层与行号列（pre/gutter 用 overflow:hidden，scrollTop 仍生效） */
  const syncScroll = () => {
    const ta = taRef.current;
    const pre = preRef.current;
    const gutter = gutterRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
    if (ta && gutter) gutter.scrollTop = ta.scrollTop;
  };

  /** Tab 键：插入 2 个空格，避免切出编辑器。Enter 维持默认（仍插入换行） */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const insert = "  ";
      const next = value.slice(0, start) + insert + value.slice(end);
      onChange(next);
      // 恢复光标到插入后位置（必须在 onChange 后下一帧）
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + insert.length;
      });
    }
  };

  /**
   * 格式化（美化 + 修正缩进）：先 load 再 dump，2 空格缩进、无 refs、自动换行关闭。
   * dump 会把空值键（用户写的 `postgres:`）输出成 `postgres: null`——语义虽等价，
   * 但不符合书写习惯且容易误导；后处理把行尾裸 null 还原为空值（js-yaml 对字符串
   * "null" 会输出带引号的 'null'，因此裸 null 一定是真空值，可安全还原）。
   */
  const format = () => {
    try {
      const parsed = yaml.load(value);
      if (parsed === undefined) return;
      const out = yaml
        .dump(parsed, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false })
        .replace(/^(\s*(?:-\s+)?[^#:\n]+):null(\s*)$/gm, "$1:$2")
        .replace(/^(\s*(?:-\s+)?[^#:\n]+):\s+null(\s*)$/gm, "$1:$2");
      onChange(out);
    } catch {
      // 内容不合法时不格式化（状态栏已有红色错误提示）
    }
  };

  const isEmpty = value.trim() === "";

  return (
    <div
      className={`flex flex-col border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:border-blue-400 transition-colors ${className || ""}`}
    >
      {/* 工具栏：左侧标题 + 右侧格式化 */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-500">YAML 编辑器（Tab = 2 空格）</span>
        {showFormat && (
          <button
            onClick={format}
            disabled={isEmpty}
            title="格式化 YAML（规范化缩进 / 清理引号与多余空白）"
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Wand2 size={12} /> 格式化
          </button>
        )}
      </div>
      {/* 编辑区域：行号列 + textarea（透明文字 + 可见光标）+ pre（高亮层） */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight }}>
        <div
          ref={gutterRef}
          aria-hidden
          className="w-11 shrink-0 overflow-hidden bg-slate-50 border-r border-slate-100 text-right font-mono text-[13px] leading-[20px] text-slate-400 select-none pointer-events-none"
        >
          <div className="py-3 pr-2">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <pre
            ref={preRef}
            aria-hidden
            className="absolute inset-0 m-0 px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre text-slate-700 overflow-hidden pointer-events-none select-none"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            style={{ tabSize: 2, WebkitTextFillColor: "transparent" }}
            className="absolute inset-0 w-full h-full px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre bg-transparent caret-slate-700 border-0 focus:outline-none resize-none"
          />
        </div>
      </div>
      {/* 状态栏：合法绿色、错误红色 + 行号/列号/原因 */}
      <div
        className={`flex items-start gap-2 px-4 py-1.5 border-t ${
          valid ? "border-slate-100 bg-green-50" : "border-red-100 bg-red-50"
        }`}
      >
        {valid ? (
          <CheckCircle2 size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div
            className={`text-xs font-medium ${
              valid ? "text-green-600" : "text-red-600"
            }`}
          >
            {isEmpty
              ? "（空）"
              : valid
              ? "YAML 格式正确"
              : "YAML 格式错误"}
          </div>
          {!valid && error && (
            <div className="text-xs text-red-500 mt-0.5 break-all">
              第 {error.line} 行 第 {error.column} 列：{error.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 去掉 js-yaml 错误信息开头的「bad indentation of a mapping entry at line X, column Y:」之类冗余前缀，只保留末尾有用部分 */
function stripYamlPrefix(msg?: string): string | null {
  if (!msg) return null;
  // 截取最后一个冒号后的内容（如 "... at line 3, column 5: <tab>"）
  const idx = msg.lastIndexOf(":");
  if (idx >= 0 && idx < msg.length - 1) {
    const tail = msg.slice(idx + 1).trim();
    if (tail) return tail;
  }
  return msg.trim();
}