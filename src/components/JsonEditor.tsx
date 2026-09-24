/**
 * ============================================
 * JSON 编辑器（语法高亮 + 实时校验 + 格式化）
 * ============================================
 *
 * 与 YamlEditor 同源实现（textarea 透明文字 + 背后 <pre> 着色 + 行号列）：
 * - 高亮按 JSON token 着色：键（后跟冒号的字符串）/ 字符串 / 数字 / 布尔与 null / 标点
 * - 校验直接用原生 JSON.parse，无需第三方依赖
 * - 错误定位优先取新式消息里的 `(line X column Y)`（Node 20+ / 新版 V8），
 *   老式消息只有 `at position N`，则按字符偏移自行换算行列
 *
 * 布局约束（与 YamlEditor 完全一致，勿改）：
 * - 高亮层与 textarea 的 font / leading / padding / tabSize 必须逐字符对齐；
 * - 滚动同步用 CSS transform 平移，而不是给 <pre> 赋 scrollTop/scrollLeft ——
 *   后者会被 <pre> 自身更小的可滚动范围钳位，导致文字与光标横向/纵向错位；
 * - 所有 token 文本先 escapeHtml 再注入，用户内容无法注入 HTML。
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle, Wand2 } from "lucide-react";

/** 高亮配色：与 shell 控制台 / YAML 编辑器保持一致 */
const COLORS = {
  key: "#60a5fa",
  string: "#34d399",
  number: "#fbbf24",
  bool: "#f472b6",
  punctuation: "#94a3b8",
};

/** HTML 转义：内容直接注入 <pre>，必须先转义 <、>、& */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 单行高亮。匹配顺序即优先级：
 * ① 字符串（可选后跟 `\s*:` → 判定为键）② 数字 ③ true/false/null ④ 结构标点。
 * 未匹配部分（空白、以及非法 token 如未闭合引号）按原文输出。
 */
function highlightJsonLine(line: string): string {
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\],:])/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out += escapeHtml(line.slice(last, m.index));
    if (m[1] !== undefined) {
      if (m[2] !== undefined) {
        out += `<span style="color:${COLORS.key}">${escapeHtml(m[1])}</span>`;
        out += `<span style="color:${COLORS.punctuation}">${escapeHtml(m[2])}</span>`;
      } else {
        out += `<span style="color:${COLORS.string}">${escapeHtml(m[1])}</span>`;
      }
    } else if (m[3] !== undefined) {
      out += `<span style="color:${COLORS.number}">${escapeHtml(m[3])}</span>`;
    } else if (m[4] !== undefined) {
      out += `<span style="color:${COLORS.bool}">${escapeHtml(m[4])}</span>`;
    } else if (m[5] !== undefined) {
      out += `<span style="color:${COLORS.punctuation}">${escapeHtml(m[5])}</span>`;
    }
    last = m.index + m[0].length;
  }
  out += escapeHtml(line.slice(last));
  return out;
}

function highlight(code: string): string {
  if (!code) return "";
  return code.split("\n").map(highlightJsonLine).join("\n");
}

/** 去掉 V8 消息里冗长的位置后缀与上下文片段，只留一句人能读的结论 */
function cleanMessage(msg: string): string {
  const t = String(msg || "")
    .replace(/\s*in JSON at position[\s\S]*$/i, "")
    .replace(/\s*at position[\s\S]*$/i, "")
    .replace(/\s*\(line[\s\S]*$/i, "")
    .trim();
  return t || "JSON 格式错误";
}

/** 从 JSON.parse 抛出的错误里定位行列（1-based） */
function locateError(value: string, msg: string): { line: number; column: number } {
  const lc = /\(line (\d+) column (\d+)\)/.exec(msg);
  if (lc) return { line: Number(lc[1]) || 1, column: Number(lc[2]) || 1 };
  const pm = /at position (\d+)/.exec(msg);
  if (pm) {
    const pos = Math.max(0, Math.min(Number(pm[1]) || 0, value.length));
    const before = value.slice(0, pos);
    return { line: before.split("\n").length, column: pos - before.lastIndexOf("\n") };
  }
  return { line: 1, column: 1 };
}

/** 校验错误信息（行列均为 1-based） */
export interface JsonValidationError {
  line: number;
  column: number;
  message: string;
}

export interface JsonEditorProps {
  value: string;
  onChange: (val: string) => void;
  /** 每次校验结果变化时回调，便于父组件联动（禁用保存按钮等） */
  onValidChange?: (valid: boolean, error: JsonValidationError | null) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
  /** 设为 false 可隐藏工具栏「格式化」按钮 */
  showFormat?: boolean;
  /** 工具栏左侧说明文字 */
  title?: string;
  /** 只读（无写权限时展示内容但禁止编辑） */
  readOnly?: boolean;
}

export function JsonEditor({
  value,
  onChange,
  onValidChange,
  placeholder,
  minHeight = 320,
  className,
  showFormat = true,
  title = "JSON 编辑器（Tab = 2 空格）",
  readOnly = false,
}: JsonEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterInnerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<JsonValidationError | null>(null);
  const [valid, setValid] = useState(true);

  const highlighted = useMemo(() => highlight(value), [value]);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  // 回调装进 ref：避免父组件回调身份变化导致 useEffect 反复触发
  const cbRef = useRef(onValidChange);
  useEffect(() => {
    cbRef.current = onValidChange;
  }, [onValidChange]);

  // 内容变更后做一次实时校验
  useEffect(() => {
    if (!value.trim()) {
      setValid(true);
      setError(null);
      cbRef.current?.(true, null);
      return;
    }
    try {
      JSON.parse(value);
      setValid(true);
      setError(null);
      cbRef.current?.(true, null);
    } catch (e: any) {
      const raw = String(e?.message || "");
      const { line, column } = locateError(value, raw);
      const err: JsonValidationError = { line, column, message: cleanMessage(raw) };
      setValid(false);
      setError(err);
      cbRef.current?.(false, err);
    }
  }, [value]);

  /** 同步 textarea 滚动量到高亮层与行号列（transform 平移，不钳位） */
  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pre = preRef.current;
    if (pre) pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    const gutterInner = gutterInnerRef.current;
    if (gutterInner) gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  // 内容变化后重新对齐（换行/删除会改变 scrollTop，之前的 transform 已过期）
  useEffect(() => {
    const id = requestAnimationFrame(syncScroll);
    return () => cancelAnimationFrame(id);
  }, [value]);

  /** Tab 插入 2 个空格（与 YamlEditor 一致），避免焦点跳出编辑器 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || readOnly) return;
    e.preventDefault();
    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const insert = "  ";
    onChange(value.slice(0, start) + insert + value.slice(end));
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + insert.length;
    });
  };

  /** 格式化：2 空格缩进重新序列化（键顺序保持不动） */
  const format = () => {
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2) + "\n");
    } catch {
      // 非合法 JSON 时保持原样（状态栏已有红色提示）
    }
  };

  const isEmpty = value.trim() === "";

  return (
    <div
      className={`flex flex-col border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:border-blue-400 transition-colors ${className || ""}`}
    >
      {/* 工具栏：左侧标题 + 右侧格式化 */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-500">
          {title}
          {readOnly && <span className="ml-2 text-amber-600">（只读：当前无写入权限）</span>}
        </span>
        {showFormat && (
          <button
            type="button"
            onClick={format}
            disabled={isEmpty || readOnly}
            title="格式化 JSON（2 空格缩进，键顺序不变）"
            className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 border border-slate-200 rounded hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <Wand2 size={12} /> 格式化
          </button>
        )}
      </div>
      {/* 编辑区：行号列 + textarea（透明文字 + 可见光标）+ pre（高亮层） */}
      <div className="flex flex-1 overflow-hidden" style={{ minHeight }}>
        <div
          aria-hidden
          className="w-11 shrink-0 overflow-hidden bg-slate-50 border-r border-slate-100 text-right font-mono text-[13px] leading-[20px] text-slate-400 select-none pointer-events-none"
        >
          <div ref={gutterInnerRef} className="py-3 pr-2">
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden">
          <pre
            ref={preRef}
            aria-hidden
            className="absolute inset-0 m-0 px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre text-slate-700 overflow-visible pointer-events-none select-none"
            style={{ tabSize: 2, fontVariantLigatures: "none", fontKerning: "none" }}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            readOnly={readOnly}
            spellCheck={false}
            style={{
              tabSize: 2,
              WebkitTextFillColor: "transparent",
              fontVariantLigatures: "none",
              fontKerning: "none",
            }}
            className={`absolute inset-0 w-full h-full px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre bg-transparent caret-slate-700 border-0 focus:outline-none resize-none overscroll-contain ${
              readOnly ? "cursor-default" : ""
            }`}
          />
        </div>
      </div>
      {/* 状态栏：合法绿色 / 错误红色 + 行号 列号 原因 */}
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
          <div className={`text-xs font-medium ${valid ? "text-green-600" : "text-red-600"}`}>
            {isEmpty ? "（空）" : valid ? "JSON 格式正确" : "JSON 格式错误"}
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
