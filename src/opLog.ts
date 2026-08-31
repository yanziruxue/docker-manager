/**
 * 前端操作日志工具 — 使用 localStorage 持久化用户操作记录。
 * 每条记录包含时间、操作类型、目标、状态和详情。
 */

export interface OpLogEntry {
  id: string;
  timestamp: string;
  action: string;       // 如 "启动容器"、"停止堆栈"、"删除镜像"
  target: string;       // 操作目标名称
  status: "success" | "failed" | "running";
  detail?: string;      // 附加信息（如错误消息）
  engineId?: string;
}

const STORAGE_KEY = "docker-manager-op-logs";
const MAX_ENTRIES = 500;

export function getOpLogs(): OpLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const logs = JSON.parse(raw) as OpLogEntry[];
    return Array.isArray(logs) ? logs : [];
  } catch {
    return [];
  }
}

export function addOpLog(entry: Omit<OpLogEntry, "id" | "timestamp">): void {
  try {
    const logs = getOpLogs();
    const full: OpLogEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toLocaleString("zh-CN", { hour12: false }),
    };
    logs.unshift(full);
    if (logs.length > MAX_ENTRIES) logs.length = MAX_ENTRIES;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // localStorage 满或不可用时静默跳过
  }
}

export function updateOpLog(id: string, patch: Partial<OpLogEntry>): void {
  try {
    const logs = getOpLogs();
    const idx = logs.findIndex((l) => l.id === id);
    if (idx < 0) return;
    logs[idx] = { ...logs[idx], ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // ignore
  }
}

export function clearOpLogs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
