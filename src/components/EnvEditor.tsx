/**
 * ============================================
 * .env 编辑器（语法高亮 + 语法检查 + 行号）
 * ============================================
 *
 * 与 YamlEditor 同一套「textarea 透明文字 + pre 高亮层」方案，规则按 dotenv 格式：
 * - 合法行：`KEY=VALUE`（KEY 以字母/下划线开头，仅字母数字下划线；值可为空）
 * - 允许 `export KEY=VALUE` 前缀、整行/行尾 # 注释（值内引号包裹的 # 不算注释）
 * - 语法错误在状态栏提示「ENV 格式错误」+ 行号 + 原因
 */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";

/** 高亮配色（与 YamlEditor 一致的风格） */
const COLORS = {
  comment: "#8a93a6",
  key: "#60a5fa",
  value: "#34d399",
  punctuation: "#94a3b8",
  error: "#ef4444",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 单行高亮：注释 / KEY=VALUE / 其它（非法行原样着灰并标红波浪由状态栏提示） */
function highlightEnvLine(line: string): string {
  if (/^\s*#/.test(line)) {
    return `<span style="color:${COLORS.comment}">${escapeHtml(line)}</span>`;
  }
  // 找值内引号外的行尾注释
  let commentIdx = -1;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inDouble) inSingle = !inSingle;
    else if (c === '"' && !inSingle) inDouble = !inDouble;
    else if (c === "#" && !inSingle && !inDouble && i > 0 && /\s/.test(line[i - 1])) { commentIdx = i; break; }
  }
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";
  const m = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*)(=)(.*)$/.exec(codePart);
  if (m) {
    let html = escapeHtml(m[1]);
    if (m[2]) html += `<span style="color:${COLORS.punctuation}">${escapeHtml(m[2])}</span>`;
    html += `<span style="color:${COLORS.key}">${escapeHtml(m[3])}</span>`;
    html += escapeHtml(m[4]);
    html += `<span style="color:${COLORS.punctuation}">=</span>`;
    const val = m[6];
    html = val.trim()
      ? html + `<span style="color:${COLORS.value}">${escapeHtml(val)}</span>`
      : html + escapeHtml(val);
    if (commentPart) html += `<span style="color:${COLORS.comment}">${escapeHtml(commentPart)}</span>`;
    return html;
  }
  // 非法行（状态栏会提示）：整体标红提示
  if (codePart.trim()) {
    return `<span style="color:${COLORS.error}">${escapeHtml(codePart)}</span>` +
      (commentPart ? `<span style="color:${COLORS.comment}">${escapeHtml(commentPart)}</span>` : "");
  }
  return escapeHtml(line);
}

export interface EnvValidationError {
  line: number;
  message: string;
}

export interface EnvEditorProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}

export function EnvEditor({ value, onChange, placeholder, minHeight = 320, className }: EnvEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);

  const highlighted = useMemo(() => value.split("\n").map(highlightEnvLine).join("\n"), [value]);
  const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);

  /** 语法检查：返回第一个不合法行（空 = 全部合法） */
  const error = useMemo<EnvValidationError | null>(() => {
    const lines = value.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      // 剥 export 前缀
      const body = line.replace(/^export\s+/, "");
      const m = body.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!m) {
        if (!body.includes("=")) {
          return { line: i + 1, message: "缺少 =（格式应为 KEY=VALUE）" };
        }
        return { line: i + 1, message: "变量名只能由字母、数字、下划线组成，且不能以数字开头" };
      }
    }
    return null;
  }, [value]);

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

  const isEmpty = value.trim() === "";

  return (
    <div
      className={`flex flex-col border border-slate-300 rounded-lg overflow-hidden bg-white focus-within:border-blue-400 transition-colors ${className || ""}`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-slate-100 bg-slate-50">
        <span className="text-xs text-slate-500">.env 编辑器（每行 KEY=VALUE，# 注释）</span>
      </div>
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
            placeholder={placeholder}
            spellCheck={false}
            style={{ tabSize: 2, WebkitTextFillColor: "transparent" }}
            className="absolute inset-0 w-full h-full px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre bg-transparent caret-slate-700 border-0 focus:outline-none resize-none"
          />
        </div>
      </div>
      <div
        className={`flex items-start gap-2 px-4 py-1.5 border-t ${
          isEmpty || !error ? "border-slate-100 bg-green-50" : "border-red-100 bg-red-50"
        }`}
      >
        {isEmpty || !error ? (
          <CheckCircle2 size={13} className="text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <AlertCircle size={13} className="text-red-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${isEmpty || !error ? "text-green-600" : "text-red-600"}`}>
            {isEmpty ? "（空）" : !error ? "ENV 格式正确" : "ENV 格式错误"}
          </div>
          {!isEmpty && error && (
            <div className="text-xs text-red-500 mt-0.5 break-all">
              第 {error.line} 行：{error.message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
