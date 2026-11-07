import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/**
 * 只读日志终端：用真实终端渲染器显示容器日志，行为对齐原生终端窗口。
 * - disableStdin：不可输入，仍可鼠标选中复制
 * - ANSI 转义由 xterm 原生解析，日志里的颜色原样呈现
 * - 长行按终端列宽换行（不再 break-all 强制折断），自带滚动缓冲
 * - 与交互式控制台 XTermTerminal 完全隔离：无 WebSocket、无 shell
 */
export function LogTerminal({ lines }: { lines: string[] }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    const term = new Terminal({
      disableStdin: true,
      cursorBlink: false,
      fontSize: 13,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#3b82f6",
        selectionBackground: "#334155",
        black: "#1e293b",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#f1f5f9",
        brightBlack: "#334155",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#ffffff",
      },
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(el);
    try {
      fitAddon.fit();
    } catch {
      /* 弹窗尚未完成布局，交给 ResizeObserver 兜底 */
    }
    termRef.current = term;

    // 弹窗尺寸变化 / 页签切换后重算列数，避免终端停在旧列宽
    const resizeObserver = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fitAddon.fit();
      } catch {
        /* 终端暂时不可见时忽略 */
      }
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // 每次重新拉取都是一批完整快照：清屏后整体重写并滚到最新一行
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.reset();
    for (const line of lines) term.writeln(line);
    term.scrollToBottom();
  }, [lines]);

  return <div ref={hostRef} className="h-full w-full overflow-hidden" />;
}
