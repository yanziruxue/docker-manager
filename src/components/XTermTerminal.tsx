import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

interface XTermTerminalProps {
  engineId?: string;
  containerId?: string;
  containerName?: string;
  /** 撑满父容器高度（父级须为 flex 列布局且有确定高度）；默认用 50vh 固定高度 */
  fill?: boolean;
}

export function XTermTerminal({ engineId, containerId, containerName, fill = false }: XTermTerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string>("");

  useEffect(() => {
    const el = terminalRef.current;
    if (!el || !engineId || !containerId) return;

    const term = new Terminal({
      cursorBlink: true,
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
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // 建立 WebSocket 连接
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/terminal?engineId=${encodeURIComponent(engineId)}&containerId=${encodeURIComponent(containerId)}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setStatus("connected");
    };

    ws.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "ready") {
            term.writeln(`\r\n\x1b[32m✓ 已连接到容器 ${containerName || containerId} 的终端\x1b[0m\r\n`);
          } else if (msg.type === "error") {
            setStatus("error");
            setErrorMsg(msg.message || "连接失败");
            term.writeln(`\r\n\x1b[31m✗ 错误: ${msg.message}\x1b[0m\r\n`);
          }
        } catch {
          term.write(event.data);
        }
      } else if (event.data instanceof ArrayBuffer) {
        const data = new Uint8Array(event.data);
        term.write(data);
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setErrorMsg("WebSocket 连接失败");
    };

    ws.onclose = () => {
      if (status !== "error") {
        setStatus("error");
        setErrorMsg("连接已关闭");
      }
      term.writeln(`\r\n\x1b[33m! 连接已关闭\x1b[0m\r\n`);
    };

    // 终端输入 -> WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // 窗口大小调整
    const handleResize = () => {
      fitAddon.fit();
      const { cols, rows } = term;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    };
    window.addEventListener("resize", handleResize);

    // 容器尺寸变化（抽屉拖动改宽 / 页签切换 / 布局变化）时重新 fit，避免终端停在旧列数
    const resizeObserver = new ResizeObserver(() => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return;
      try {
        fitAddon.fit();
        const { cols, rows } = term;
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      } catch {
        /* 终端暂时不可见（如页签切走）时忽略 */
      }
    });
    resizeObserver.observe(el);

    return () => {
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      wsRef.current = null;
    };
  }, [engineId, containerId, containerName]);

  return (
    <div className={fill ? "relative flex flex-col h-full min-h-0" : "relative"}>
      {status === "connecting" && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-900/80 rounded-lg">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-slate-400">正在连接终端...</p>
        </div>
      )}
      {status === "error" && (
        <div className="absolute top-2 left-2 right-2 z-10 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <span className="w-2 h-2 bg-red-500 rounded-full" />
          <span className="text-xs text-red-400">{errorMsg}</span>
        </div>
      )}
      <div
        ref={terminalRef}
        className={fill ? "bg-slate-900 rounded-lg p-2 flex-1 min-h-0" : "bg-slate-900 rounded-lg p-2"}
        style={fill ? { minHeight: "220px" } : { height: "50vh", minHeight: "300px" }}
      />
    </div>
  );
}
