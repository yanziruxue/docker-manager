/**
 * ============================================
 * YAML 编辑器（语法高亮 + 实时 Lint + 格式化）
 * ============================================
 *
 * 用 textarea + 高亮层叠（textarea 文字透明，光标可见，背后 <pre> 着色）
 * 实现轻量语法高亮；每次输入用 js-yaml 实时解析，捕获缩进/语法错误并在状态栏
 * 提示「YAML 格式错误」+ 行号 + 列号 + 原因。右上角「格式化」按钮重新序列化
 * 当前合法内容，等价于「自动修正缩进 + 格式化美化 + 转数组写法」。
 *
 * 设计取舍：
 * - 不用 CodeMirror/Monaco：体积大、构建链复杂；本组件 ~10KB，零依赖冲突；
 *   能覆盖 compose YAML 的 99% 用法（缩进、键值、列表、注释、字符串/数字/布尔）。
 * - white-space: pre（不换行）：textarea 与 <pre> 字符级对齐最简单，
 *   长行靠水平滚动，避免 wrap 导致高亮层错位。
 * - 滚动同步用 CSS transform 平移，**不用**给 <pre> 设 scrollTop/scrollLeft（v1.19.1）：
 *   textarea 与 <pre> 是两个独立滚动容器，只要两者可滚动范围不一致（textarea 出现占位
 *   竖向滚动条、或横向滚动条占了高度 → clientWidth/clientHeight 更小，但 <pre> 是
 *   overflow:hidden 不预留），赋值就会被钳位在 <pre> 更小的最大值上 → 高亮文字与光标/
 *   选区横向错开一个滚动条宽度、行号列在底部整行错位。平移量与 textarea 的滚动量严格
 *   相等，与两端可滚动范围无关，因此结构上不可能错位。
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
  // 列表项：缩进 / 短横 / 短横后空白 / 内容 分开捕获——
  // 短横后的空白必须原样拼回高亮层，否则 <pre> 显示比 textarea 原文少一个空格，
  // 导致「- TZ=...」显示成「-TZ=...」且高亮层与透明文字错位（v1.15.1 修复）
  const dashMatch = /^(\s*)(-)(\s*)(.*)$/.exec(codePart);
  let body = codePart;
  if (dashMatch) {
    html += escapeHtml(dashMatch[1]);
    html += `<span style="color:${COLORS.dash}">-</span>`;
    html += escapeHtml(dashMatch[3]);
    body = dashMatch[4];
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

/**
 * 是否「扁平无缩进」YAML：所有非空、非注释行都从列 0 起始。
 * 这类文本 js-yaml 无法直接 load（报 bad indentation），需要启发式补缩进后才能格式化。
 * 只要出现任意一行有前导空白，即视为已结构化，直接走正常 load→dump，不再自动补缩进。
 */
function isFlatYaml(text: string): boolean {
  const lines = text.split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    if (/^\s/.test(line)) return false;
  }
  return true;
}

/** Compose 中直接包含「命名条目 map」的顶层块（条目之间互为同级，如多个服务） */
const BLOCK_SECTIONS = new Set(["services", "volumes", "networks", "secrets", "configs"]);
/** 服务/卷下的常见子键：出现时一律视为「当前上下文的子节点」，不提升为同级 */
const CHILD_KEYS = new Set([
  "image", "restart", "container_name", "hostname", "ports", "environment", "volumes", "networks",
  "depends_on", "labels", "healthcheck", "deploy", "logging", "command", "entrypoint", "build",
  "user", "working_dir", "privileged", "read_only", "devices", "cap_add", "cap_drop", "dns",
  "dns_search", "tmpfs", "sysctls", "extra_hosts", "expose", "links", "network_mode", "pid", "ipc",
  "security_opt", "stop_signal", "stop_grace_period", "init", "scale", "mem_limit", "cpus",
  "cpu_shares", "cpu_quota", "cpuset", "platform", "shm_size", "ulimits", "runtime", "group_add",
  "mac_address", "secrets", "configs",
]);

/** 取值为序列的服务子键：其下 `- ` 项结束后出现的新 bare key 应回到父级作为同级子键 */
const LIST_KEYS = new Set([
  "ports", "environment", "volumes", "networks", "depends_on", "secrets", "configs", "labels",
  "devices", "expose", "external_links", "links", "dns", "dns_search", "tmpfs", "sysctls",
  "extra_hosts", "ulimits", "cap_add", "cap_drop", "group_add", "security_opt",
]);

/**
 * 启发式补缩进：把「扁平无缩进」YAML 还原成 2 空格嵌套结构，使其能被 js-yaml 正确解析。
 *
 * 栈模型：每个栈元素记录 { type:'map'|'seq', indent, isBlock }。
 * - bare `key:`（冒号后无值）开一个 map 上下文，子键缩进 +2；
 * - `key: value`（叶子）不新开上下文；
 * - `- item` 序列项：自身在 currentIndent；若 item 内容形如 `key:...` 则其后子键更深，
 *   下一个 `- ` 出现时回退到该序列项层级（避免列表项互相套叠）。
 * - compose 的 services/volumes/networks 块下：遇到未知 bare key（潜在新服务名）且下一行
 *   不是序列项时，判定为「同级命名条目」，回退到 block 层级 +1，避免多个服务被错误套进前一个服务。
 * 已知子键（CHILD_KEYS）与 block 之外的普通嵌套一律直接下钻，保证通用 YAML 不被误提。
 */
function autoIndentYaml(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  const stack: Array<{ type: "map" | "seq"; indent: number; isBlock: boolean; isList: boolean }> = [];
  let ci = 0; // current indent（空格数）
  const indentOf = (n: number) => " ".repeat(n);

  const nextStructural = (from: number): string => {
    for (let j = from + 1; j < lines.length; j++) {
      const t = lines[j].trim();
      if (t === "" || t.startsWith("#")) continue;
      return t;
    }
    return "";
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push("");
      continue;
    }
    if (trimmed.startsWith("#")) {
      out.push(indentOf(ci) + trimmed);
      continue;
    }

    const isSeq = /^-\s/.test(trimmed) || trimmed === "-";
    const isBareKey = !isSeq && /^[^#\s][^:]*:(\s*)$/.test(trimmed);
    const isLeafKey = !isSeq && /^[^#\s][^:]*:\s+\S/.test(trimmed);

    if (isSeq) {
      // 新序列项：若当前正处于某序列项的 map 内容中，先回到该序列项层级
      if (stack.length && stack[stack.length - 1].type === "seq") {
        ci = stack[stack.length - 1].indent;
        stack.pop();
      }
      const m = /^-\s?(.*)$/.exec(trimmed);
      const content = m ? m[1] : "";
      out.push(indentOf(ci) + "- " + content);
      const opensMap = content !== "" && /^[^:]+:/.test(content) && !/^-\s/.test(content);
      if (opensMap) {
        stack.push({ type: "seq", indent: ci, isBlock: false, isList: false });
        ci += 2;
      }
      continue;
    }

    if (isBareKey || isLeafKey) {
      const keyMatch = /^([^:]+):/.exec(trimmed);
      const key = keyMatch ? keyMatch[1].trim() : "";
      const bare = isBareKey;
      // 列表/序列项结束后出现的新 bare key → 回到父 map 作为同级子键
      // （端口列表后紧跟 deploy / 多服务之间等），避免子键被错误套进上一个列表项
      if (bare && stack.length) {
        while (stack.length && (stack[stack.length - 1].type === "seq" || stack[stack.length - 1].isList)) {
          ci = stack[stack.length - 1].indent;
          stack.pop();
        }
      }
      const insideBlock = stack.some((c) => c.isBlock);
      if (bare && !CHILD_KEYS.has(key) && insideBlock) {
        // 可能是 block 下的新命名条目（同级服务等）：下一行若不是序列项，则提升为同级
        const nxt = nextStructural(i);
        const nextIsSeq = /^-\s/.test(nxt);
        if (!nextIsSeq) {
          let blockIndent = 0;
          for (let s = stack.length - 1; s >= 0; s--) {
            if (stack[s].isBlock) {
              blockIndent = stack[s].indent;
              break;
            }
          }
          while (stack.length && stack[stack.length - 1].indent > blockIndent) stack.pop();
          ci = blockIndent + 2;
        }
      }
      out.push(indentOf(ci) + trimmed);
      if (bare) {
        const isBlock = BLOCK_SECTIONS.has(key);
        const isList = LIST_KEYS.has(key);
        stack.push({ type: "map", indent: ci, isBlock, isList });
        ci += 2;
      }
      continue;
    }

    // 其它无法识别的行：原样保留在 currentIndent
    out.push(indentOf(ci) + trimmed);
  }
  return out.join("\n");
}

/**
 * ============================================
 * 「数组写法」格式化（v1.24.0）
 * ============================================
 * 两条规则叠加，让格式化后的 compose 更紧凑：
 * 1) `environment` / `labels` 的**键值映射**折叠成 compose 的 `- K=V` 数组写法
 *    （Docker 对这两个键同时接受 map 与 array，语义完全等价）；
 * 2) 所有**纯标量序列**从块状写法折叠成行内流式数组 `[a, b]`。
 *
 * 结构化序列（序列项本身是映射 / 含块标量 `|` `>` / 项有续行）一律保持块状——
 * 强行行内化会产出非法 YAML，宁可难看也不能坏。
 */

/** compose 中 map / array 两种写法等价的键（仅在这些键上做「映射→数组」折叠） */
const KV_ARRAY_KEYS = new Set(["environment", "labels"]);

/** 值全为标量（含空值）的普通对象——只有这种才可能是 environment / labels 映射 */
function isScalarMap(v: unknown): v is Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => x === null || x === undefined || typeof x !== "object"
  );
}

/**
 * 把 `services.<名称>.environment|labels`（含 `deploy.labels`）的键值映射改成
 * `- K=V` 数组写法；值为 null 表示「从宿主机透传」，输出不带等号的裸 `K`。
 * 用 path 精确限定位置，避免把「名字恰好叫 environment 的服务」误判成映射。
 */
function toKvArrayForm(node: unknown, path: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((v) => toKvArrayForm(v, path));
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    const p = [...path, k];
    const isServiceField = p.length === 3 && p[0] === "services";
    const isDeployLabels = p.length === 4 && p[0] === "services" && p[2] === "deploy" && k === "labels";
    if (((isServiceField && KV_ARRAY_KEYS.has(k)) || isDeployLabels) && isScalarMap(v)) {
      obj[k] = Object.entries(v).map(([kk, vv]) =>
        vv === null || vv === undefined ? kk : `${kk}=${String(vv)}`
      );
      continue;
    }
    toKvArrayForm(v, p);
  }
}

/** 流式数组内的标量项：含流式结构字符（, [ ] { }）时补单引号；js-yaml 已引用的原样保留 */
function quoteFlowItem(item: string): string {
  if (item === "") return "''";
  const quoted =
    item.length > 1 &&
    ((item[0] === "'" && item.endsWith("'")) || (item[0] === '"' && item.endsWith('"')));
  if (quoted) return item;
  if (/[,[\]{}]/.test(item) || /:\s/.test(item)) return "'" + item.replace(/'/g, "''") + "'";
  return item;
}

/**
 * 把「块状纯标量序列」折叠成行内流式数组：`key:\n  - a\n  - b` → `key: [a, b]`。
 * 只要序列中出现「项本身是映射」「块标量（`|` / `>`）」「项有更深缩进的续行」之一，
 * 该键就整体保持块状写法。
 */
function foldSequencesToFlow(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    // 形如 `  key:`（冒号后无值）的键行；排除以 `-` 开头的序列项
    const keyLine = /^(\s*)([^#\s-][^:]*):\s*$/.exec(lines[i]);
    if (keyLine) {
      const itemRe = new RegExp("^" + " ".repeat(keyLine[1].length + 2) + "- (.*)$");
      const items: string[] = [];
      let j = i + 1;
      let allScalar = true;
      while (j < lines.length && itemRe.test(lines[j])) {
        const content = (itemRe.exec(lines[j]) as RegExpExecArray)[1].replace(/\s+$/, "");
        const isQuoted = /^['"]/.test(content);
        // 块标量 / 映射起始 → 该键整体保留块状
        if (!isQuoted && (/^[|>]/.test(content) || /^[^:]*:(\s|$)/.test(content))) {
          allScalar = false;
          break;
        }
        // 下一行缩进比「项所在列」更深 → 该项有续行（多行标量），必须保留块状
        const nxt = lines[j + 1];
        if (nxt !== undefined && nxt.trim() !== "" && /^\s*/.exec(nxt)![0].length > keyLine[1].length + 2) {
          allScalar = false;
          break;
        }
        items.push(content);
        j++;
      }
      if (allScalar && items.length > 0) {
        out.push(`${keyLine[1]}${keyLine[2]}: [${items.map(quoteFlowItem).join(", ")}]`);
        i = j;
        continue;
      }
    }
    out.push(lines[i]);
    i++;
  }
  return out.join("\n");
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
  /** 光标（鼠标指针）所在行变化时回调，0-based 行号 —— 供外部实现「插入到指针位置」 */
  onCursorLineChange?: (line: number) => void;
}

export function YamlEditor({
  value,
  onChange,
  onValidChange,
  placeholder,
  minHeight = 380,
  className,
  showFormat = true,
  onCursorLineChange,
}: YamlEditorProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  /** 行号列的内层容器：同样用 transform 平移，避免 scrollTop 被钳位导致行号与文字错行 */
  const gutterInnerRef = useRef<HTMLDivElement>(null);
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

  // 光标行回调同样装进 ref，避免父组件回调身份变化引发重复渲染
  const cursorCbRef = useRef(onCursorLineChange);
  useEffect(() => {
    cursorCbRef.current = onCursorLineChange;
  }, [onCursorLineChange]);

  /** 上报光标所在行（0-based），父组件据此实现「插入到指针位置」 */
  const reportCursorLine = (ta: HTMLTextAreaElement) => {
    const line = ta.value.slice(0, ta.selectionStart).split("\n").length - 1;
    cursorCbRef.current?.(line);
  };

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

  /**
   * 同步 textarea 的滚动到高亮层与行号列。
   * 用 transform 平移而非 scrollTop/scrollLeft：后者的可设置上限取决于元素自身的
   * 可滚动范围，两层范围一旦不一致就会被钳位（见文件头「设计取舍」），导致文字错位；
   * 平移量与 textarea 的滚动量严格相等，与可滚动范围无关。
   */
  const syncScroll = () => {
    const ta = taRef.current;
    if (!ta) return;
    const pre = preRef.current;
    if (pre) pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
    const gutterInner = gutterInnerRef.current;
    if (gutterInner) gutterInner.style.transform = `translateY(${-ta.scrollTop}px)`;
  };

  // 内容变化后重新对齐：换行/删除会改变 scrollTop，且此前的 transform 已过期
  useEffect(() => {
    const id = requestAnimationFrame(syncScroll);
    return () => cancelAnimationFrame(id);
  }, [value]);

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
   * 格式化（美化 + 修正缩进 + 转数组写法）：load 出的对象先做「数组写法」归一化
   * （environment / labels 映射 → `- K=V`），再 dump 成 2 空格缩进、无 refs、
   * 不自动换行的块状 YAML，最后把纯标量序列折叠成行内 `[a, b]`。
   *
   * dump 会把空值键（用户写的 `postgres:`）输出成 `postgres: null`——语义虽等价，
   * 但不符合书写习惯且容易误导；后处理把行尾裸 null 还原为空值（js-yaml 对字符串
   * "null" 会输出带引号的 'null'，因此裸 null 一定是真空值，可安全还原）。
   *
   * 扁平无缩进的 YAML（如用户从别处整段粘贴、所有行顶格）会被 js-yaml 直接报
   * bad indentation，此时先走 autoIndentYaml 启发式补缩进，再 load→dump 得到规范嵌套。
   */
  const dumpNormalized = (parsed: unknown): string => {
    toKvArrayForm(parsed, []);
    return foldSequencesToFlow(
      yaml
        .dump(parsed as object, { indent: 2, lineWidth: -1, noRefs: true, sortKeys: false })
        .replace(/^(\s*(?:-\s+)?[^#:\n]+):null(\s*)$/gm, "$1:$2")
        .replace(/^(\s*(?:-\s+)?[^#:\n]+):\s+null(\s*)$/gm, "$1:$2")
    );
  };

  const format = () => {
    // 整段顶格（无任何缩进）的 YAML 先启发式补缩进：纯顶格的 compose 其实是**合法**
    // YAML，js-yaml 会把它解析成「一堆同级键」的扁平映射，直接 dump 出来依旧扁平 ——
    // 得不到嵌套结构（Feature A 的补缩进分支原先挂在 catch 上，永远不触发）。
    // 补缩进失败再落回常规 load。
    if (isFlatYaml(value)) {
      try {
        const parsed = yaml.load(autoIndentYaml(value));
        if (parsed !== undefined) {
          onChange(dumpNormalized(parsed));
          return;
        }
      } catch {
        // 补缩进后仍不合法 → 尝试常规解析
      }
    }
    try {
      const parsed = yaml.load(value);
      if (parsed === undefined) return;
      onChange(dumpNormalized(parsed));
    } catch {
      // 不合法则不格式化（状态栏已有红色错误提示）
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
            title="格式化 YAML（规范化缩进 + environment / labels 转数组写法 + 序列行内化）"
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
            onSelect={(e) => reportCursorLine(e.currentTarget)}
            onKeyUp={(e) => reportCursorLine(e.currentTarget)}
            onClick={(e) => reportCursorLine(e.currentTarget)}
            placeholder={placeholder}
            spellCheck={false}
            style={{
              tabSize: 2,
              WebkitTextFillColor: "transparent",
              fontVariantLigatures: "none",
              fontKerning: "none",
            }}
            className="absolute inset-0 w-full h-full px-4 py-3 font-mono text-[13px] leading-[20px] whitespace-pre bg-transparent caret-slate-700 border-0 focus:outline-none resize-none overscroll-contain"
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