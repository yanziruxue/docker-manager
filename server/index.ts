import express from "express";
import cors from "cors";
import path from "path";
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { fileURLToPath } from "url";
import {
  getAllEngines,
  getActiveEngineId,
  setActiveEngineId,
  getEngine,
  addEngine,
  updateEngine,
  removeEngine,
  testConnection,
  testAllConnections,
} from "./engines.js";
import {
  getEngineInfo,
  getContainers,
  getImages,
  getVolumes,
  getStacks,
  getContainerLogs,
  getContainerStats,
  getEngineResourceStats,
  getActivityLogs,
  containerAction,
  removeContainer,
  removeImage,
  classifyImageRemoveError,
  pruneImages,
  startImagePull,
  listPullTasks,
  getPullTask,
  cancelImagePull,
  removeVolume,
  pruneVolumes,
  createVolume,
  createStack,
  stackAction,
  removeStack,
  saveStackCompose,
  saveStackEnv,
  saveStackSettings,
  checkStackUpdates,
  backupStack,
  restoreStack,
  attachContainerTerminal,
  resizeContainerTerminal,
  getComposeCmd,
  detectComposeModes,
} from "./docker.js";
import { getSettings, saveSettings } from "./settings.js";
import { readDaemonConfigInfo, writeDaemonConfig, restartDockerService, refreshPrivileges } from "./daemon-config.js";
import { CURRENT_VERSION, getInstallDir, checkForUpdate, performUpdate, getUpdateState, markUpdateError } from "./updater.js";
import { COMPOSE_DIR } from "./paths.js";
import { createEmbeddedStatic, type EmbeddedDist } from "./serve-embedded.js";
import { setLogLevel, getLogLevel, createLogger } from "./logger.js";
import { WebSocketServer } from "ws";

// 尝试加载嵌入式前端数据（仅二进制构建时可用）
// BUILD_BINARY 由 esbuild define 注入，仅二进制构建时为 true
declare const BUILD_BINARY: boolean | undefined;

let embeddedDist: EmbeddedDist | undefined;
if (typeof BUILD_BINARY !== "undefined" && BUILD_BINARY) {
  // 二进制 CJS 构建模式 — esbuild 插件在构建时解析虚拟模块
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  embeddedDist = (require("virtual:embedded-dist") as any).default;
} else {
  // 开发/非二进制模式 — 动态 import
  try {
    embeddedDist = (await import("virtual:embedded-dist")).default;
  } catch {
    // 非二进制模式 — 使用文件系统
  }
}

const app = express();
import { BACKEND_PORT } from "./config.js";

const PORT = BACKEND_PORT;

// 初始化日志级别（从已保存的设置中读取）
try {
  const savedSettings = getSettings();
  if (savedSettings?.docker?.logLevel) {
    setLogLevel(savedSettings.docker.logLevel);
  }
} catch {
  // 设置读取失败，使用默认 info 级别
}

const apiLog = createLogger("API");
// Node.js SEA 中 __filename/__dirname 不可用，用 process.execPath 替代
const __filename = BUILD_BINARY ? process.execPath : fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// ============ 引擎 API ============

/** 获取所有引擎 */
app.get("/api/engines", (_req, res) => {
  const engines = getAllEngines();
  res.json({ success: true, data: engines });
});

/** 获取当前活跃引擎 ID */
app.get("/api/engines/active", (_req, res) => {
  res.json({ success: true, data: { activeEngineId: getActiveEngineId() } });
});

/** 设置当前活跃引擎 */
app.put("/api/engines/active", (req, res) => {
  const { activeEngineId } = req.body;
  if (!activeEngineId) {
    res.status(400).json({ success: false, error: "缺少 activeEngineId" });
    return;
  }
  const ok = setActiveEngineId(activeEngineId);
  if (!ok) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  res.json({ success: true, data: { activeEngineId } });
});

/** 添加引擎 */
app.post("/api/engines", (req, res) => {
  const { name, connectionType, socketPath, tcpAddress, sshHost, sshPort, sshUsername, sshAuthType, sshPassword, sshKey, sshPassphrase } = req.body;
  if (!name || !connectionType) {
    res.status(400).json({ success: false, error: "缺少必要参数" });
    return;
  }
  const engine = addEngine({
    name,
    connectionType,
    socketPath: socketPath || "",
    tcpAddress: tcpAddress || "",
    sshHost: sshHost || "",
    sshPort: sshPort || 22,
    sshUsername: sshUsername || "",
    sshAuthType: sshAuthType || "password",
    sshPassword: sshPassword || "",
    sshKey: sshKey || "",
    sshPassphrase: sshPassphrase || "",
  } as any);
  res.json({ success: true, data: engine });
});

/** 重命名引擎 */
app.put("/api/engines/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: "缺少名称" });
    return;
  }
  const engine = updateEngine(id, { name });
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  res.json({ success: true, data: engine });
});

/** 删除引擎 */
app.delete("/api/engines/:id", (req, res) => {
  const { id } = req.params;
  const ok = removeEngine(id);
  if (!ok) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  res.json({ success: true });
});

/** 测试引擎连接 */
app.post("/api/engines/:id/connect", async (req, res) => {
  const { id } = req.params;
  const engine = await testConnection(id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  res.json({ success: true, data: engine });
});

/** 刷新所有引擎连接状态 */
app.post("/api/engines/refresh", async (_req, res) => {
  await testAllConnections();
  res.json({ success: true, data: getAllEngines() });
});

// ============ 引擎数据 API ============

/** 获取引擎系统信息 */
app.get("/api/engines/:id/info", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const info = await getEngineInfo(engine);
    res.json({ success: true, data: info });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取信息失败" });
  }
});

/** 获取容器列表 */
app.get("/api/engines/:id/containers", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const containers = await getContainers(engine);
    res.json({ success: true, data: containers });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取容器失败" });
  }
});

/** 获取镜像列表 */
app.get("/api/engines/:id/images", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const images = await getImages(engine);
    res.json({ success: true, data: images });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取镜像失败" });
  }
});

/** 获取数据卷列表 */
app.get("/api/engines/:id/volumes", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const volumes = await getVolumes(engine);
    res.json({ success: true, data: volumes });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取数据卷失败" });
  }
});

/** 获取堆栈列表 */
app.get("/api/engines/:id/stacks", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const stacks = await getStacks(engine);
    res.json({ success: true, data: stacks });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取堆栈失败" });
  }
});

/** 创建堆栈（写入 compose 文件 + docker compose up -d） */
app.post("/api/engines/:id/stacks", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  const { name, description, composeContent } = req.body || {};
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ success: false, error: "堆栈名称不能为空" });
    return;
  }
  if (!composeContent || typeof composeContent !== "string" || !composeContent.trim()) {
    res.status(400).json({ success: false, error: "compose 文件内容不能为空" });
    return;
  }
  try {
    const result = await createStack(engine, name.trim(), (description || "").trim(), composeContent);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "创建堆栈失败" });
  }
});

// ============ 堆栈操作 API ============

/**
 * 注意：`POST /stacks/:name/:action` 是通配路由，必须注册在所有
 * `/stacks/:name/xxx` 具体路由（backup / restore / icon）之后，
 * 否则会把它们全部拦截（曾导致备份报「不支持的操作: backup」）。
 * 该路由统一放在「堆栈操作 API」区块末尾，见文件下方。
 */

/** 删除堆栈 */
app.delete("/api/engines/:id/stacks/:name", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    const removeVolumes = req.query.removeVolumes === "true";
    const removeFiles = req.query.removeFiles !== "false"; // 默认删除文件
    const output = await removeStack(engine, req.params.name, removeVolumes, removeFiles);
    res.json({ success: true, data: output });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "删除失败" });
  }
});

/** 保存堆栈 compose 文件 */
app.put("/api/engines/:id/stacks/:name/compose", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { composeContent } = req.body || {};
  if (!composeContent) { res.status(400).json({ success: false, error: "compose 内容不能为空" }); return; }
  try {
    await saveStackCompose(engine, req.params.name, composeContent);
    res.json({ success: true, data: "Compose 文件已保存" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "保存失败" });
  }
});

/** 保存堆栈环境变量 */
app.put("/api/engines/:id/stacks/:name/env", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { envContent } = req.body || {};
  if (typeof envContent !== "string") { res.status(400).json({ success: false, error: "envContent 必须是字符串" }); return; }
  try {
    await saveStackEnv(engine, req.params.name, envContent);
    res.json({ success: true, data: "环境变量已保存" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "保存失败" });
  }
});

/** 保存堆栈设置 */
app.put("/api/engines/:id/stacks/:name/settings", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    await saveStackSettings(engine, req.params.name, req.body || {});
    res.json({ success: true, data: "设置已保存" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "保存失败" });
  }
});

/** 上传堆栈图标（本地图片） */
app.post("/api/engines/:id/stacks/:name/icon", express.raw({ type: "image/*", limit: "2mb" }), async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    const contentType = req.get("Content-Type") || "image/png";
    const extMap: Record<string, string> = {
      "image/png": ".png",
      "image/jpeg": ".jpg",
      "image/jpg": ".jpg",
      "image/gif": ".gif",
      "image/svg+xml": ".svg",
      "image/webp": ".webp",
      "image/x-icon": ".ico",
    };
    const ext = extMap[contentType] || ".png";

    // 查找堆栈目录
    const stackDir = path.join(COMPOSE_DIR, req.params.name);
    if (!existsSync(stackDir)) {
      // SSH 引擎无法本地写，回退到 URL 模式
      res.status(400).json({ success: false, error: "堆栈目录不存在，无法保存图标" });
      return;
    }

    // 删除旧图标文件
    const existingFiles = readdirSync(stackDir);
    for (const f of existingFiles) {
      if (f.startsWith("icon.")) {
        try { unlinkSync(path.join(stackDir, f)); } catch { /* ignore */ }
      }
    }

    // 保存新图标
    const iconFilename = `icon${ext}`;
    const iconPath = path.join(stackDir, iconFilename);
    writeFileSync(iconPath, req.body as Buffer);

    // 更新 meta 中的 icon 字段
    await saveStackSettings(engine, req.params.name, { iconUrl: `/api/stack-icons/${encodeURIComponent(req.params.name)}` });

    res.json({ success: true, data: { iconUrl: `/api/stack-icons/${encodeURIComponent(req.params.name)}` } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "图标上传失败" });
  }
});

/** 提供堆栈图标静态文件 */
app.get("/api/stack-icons/:name", (req, res) => {
  const stackDir = path.join(COMPOSE_DIR, req.params.name);
  if (!existsSync(stackDir)) {
    res.status(404).send("Not found");
    return;
  }
  // 查找 icon.* 文件
  const files = readdirSync(stackDir);
  const iconFile = files.find((f) => /^icon\.(png|jpe?g|gif|svg|webp|ico)$/i.test(f));
  if (!iconFile) {
    res.status(404).send("Not found");
    return;
  }
  const ext = path.extname(iconFile).toLowerCase();
  const ctMap: Record<string, string> = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon",
  };
  res.setHeader("Content-Type", ctMap[ext] || "image/png");
  res.setHeader("Cache-Control", "no-cache");
  res.send(readFileSync(path.join(stackDir, iconFile)));
});

/** 检查堆栈更新 */
app.post("/api/engines/:id/stacks/check-updates", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { stackName } = req.body || {};
  try {
    const results = await checkStackUpdates(engine, stackName || undefined);
    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "检查更新失败" });
  }
});

/** 备份堆栈 */
app.post("/api/engines/:id/stacks/:name/backup", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    const backupPath = await backupStack(engine, req.params.name);
    res.json({ success: true, data: { backupName: backupPath } });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "备份失败" });
  }
});

/** 恢复堆栈 */
app.post("/api/engines/:id/stacks/:name/restore", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { backupName } = req.body || {};
  if (!backupName) { res.status(400).json({ success: false, error: "备份文件名不能为空" }); return; }
  try {
    await restoreStack(engine, backupName);
    res.json({ success: true, data: "堆栈已恢复" });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "恢复失败" });
  }
});

/** 批量操作堆栈 */
app.post("/api/engines/:id/stacks/batch/:action", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { stackNames } = req.body || {};
  if (!Array.isArray(stackNames) || stackNames.length === 0) {
    res.status(400).json({ success: false, error: "请提供要操作的堆栈名称列表" });
    return;
  }
  const { action } = req.params;
  const validActions = ["up", "down", "restart", "pull", "delete"];
  if (!validActions.includes(action)) {
    res.status(400).json({ success: false, error: `不支持的批量操作: ${action}` });
    return;
  }
  try {
    const results: { stackName: string; success: boolean; output?: string; error?: string }[] = [];
    for (const name of stackNames) {
      try {
        let output: string | undefined;
        if (action === "delete") {
          output = await removeStack(engine, name, false, true);
        } else {
          output = await stackAction(engine, name, action as any);
        }
        results.push({ stackName: name, success: true, output });
      } catch (e: any) {
        results.push({ stackName: name, success: false, error: e.message });
      }
    }
    res.json({ success: true, data: results });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "批量操作失败" });
  }
});

/** 堆栈操作英文动作名 → 中文（错误提示展示用） */
const STACK_ACTION_ZH: Record<string, string> = {
  up: "启动",
  down: "关闭",
  pull: "拉取",
  restart: "重启",
  build: "构建",
};

/**
 * 堆栈操作（up/down/pull/restart/build）
 *
 * 这是 `POST /stacks/:name/xxx` 的通配路由，**必须注册在 backup / restore / icon /
 * batch 等具体路由之后**（因此放在本区块最末尾），否则会抢先匹配掉它们。
 */
app.post("/api/engines/:id/stacks/:name/:action", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { name, action } = req.params;
  const validActions = ["up", "down", "pull", "restart", "build"];
  if (!validActions.includes(action)) {
    const validZh = validActions.map((a) => `${STACK_ACTION_ZH[a]}(${a})`).join("、");
    res.status(400).json({ success: false, error: `不支持的操作: ${action}，有效操作: ${validZh}` });
    return;
  }
  try {
    const output = await stackAction(engine, name, action as any);
    res.json({ success: true, data: output });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "操作失败" });
  }
});

/** 获取容器日志 */
app.get("/api/engines/:id/containers/:cid/logs", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const tail = parseInt(req.query.tail as string) || 200;
    const logs = await getContainerLogs(engine, req.params.cid, tail);
    res.json({ success: true, data: logs });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取日志失败" });
  }
});

/** 获取容器资源监控 */
app.get("/api/engines/:id/containers/:cid/stats", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const stats = await getContainerStats(engine, req.params.cid);
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取资源监控失败" });
  }
});

/** 获取引擎资源汇总（仪表盘资源监控） */
app.get("/api/engines/:id/resource-stats", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const stats = await getEngineResourceStats(engine);
    res.json({ success: true, data: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取资源汇总失败" });
  }
});

// ============ 资源监控 SSE 流（仪表盘实时推送） ============

interface SseStream {
  clients: Set<express.Response>;
  timer: NodeJS.Timeout | null;
}

/** 按引擎共享一条聚合循环：同一引擎无论多少客户端，每秒只查一次 Docker */
const sseStreams = new Map<string, SseStream>();

function getSseStream(engineId: string): SseStream {
  let entry = sseStreams.get(engineId);
  if (!entry) {
    entry = { clients: new Set(), timer: null };
    sseStreams.set(engineId, entry);
  }
  return entry;
}

async function sseTick(engineId: string): Promise<void> {
  const entry = sseStreams.get(engineId);
  if (!entry || entry.clients.size === 0) return;
  const engine = getEngine(engineId);
  if (!engine) {
    const payload = `event: error\ndata: ${JSON.stringify({ error: "引擎不存在" })}\n\n`;
    for (const client of entry.clients) client.write(payload);
    return;
  }
  try {
    const stats = await getEngineResourceStats(engine);
    const payload = `data: ${JSON.stringify(stats)}\n\n`;
    for (const client of entry.clients) client.write(payload);
  } catch {
    // 引擎暂不可达：推送 error 事件但保持连接，客户端保留上次数据，恢复后自动继续
    const payload = `event: error\ndata: ${JSON.stringify({ error: "引擎暂不可达" })}\n\n`;
    for (const client of entry.clients) client.write(payload);
  }
}

/** 仪表盘资源监控 SSE 端点：服务端 1s 聚合推送（替代前端轮询） */
app.get("/api/engines/:id/resource-stats/stream", (req, res) => {
  const engineId = req.params.id;
  if (!getEngine(engineId)) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // 关闭反向代理缓冲，确保每帧立即送达
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const entry = getSseStream(engineId);
  entry.clients.add(res);

  // 第一个客户端到达时启动共享循环，立即推首帧
  if (!entry.timer) {
    void sseTick(engineId);
    entry.timer = setInterval(() => void sseTick(engineId), 1000);
  }

  req.on("close", () => {
    entry.clients.delete(res);
    // 最后一个客户端离开时停止循环，不留后台空转
    if (entry.clients.size === 0 && entry.timer) {
      clearInterval(entry.timer);
      entry.timer = null;
      sseStreams.delete(engineId);
    }
  });
});

/** 获取活动日志 */
app.get("/api/engines/:id/activity", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) {
    res.status(404).json({ success: false, error: "引擎不存在" });
    return;
  }
  try {
    const activities = await getActivityLogs(engine);
    res.json({ success: true, data: activities });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取活动日志失败" });
  }
});

// ============ 系统设置 API ============

/** 获取系统设置 */
app.get("/api/settings", (_req, res) => {
  res.json({ success: true, data: getSettings() });
});

/** 保存系统设置 */
app.put("/api/settings", (req, res) => {
  const settings = saveSettings(req.body);
  // 动态更新日志级别
  if (settings?.docker?.logLevel) {
    setLogLevel(settings.docker.logLevel);
    apiLog.info(`日志级别已更新: ${settings.docker.logLevel}`);
  }
  res.json({ success: true, data: settings });
});

/** 获取当前日志级别（运行时） */
app.get("/api/settings/log-level", (_req, res) => {
  res.json({ success: true, data: { logLevel: getLogLevel() } });
});

/** 检测服务器上可用的 Compose 命令 */
app.get("/api/compose-modes", (_req, res) => {
  const modes = detectComposeModes();
  res.json({ success: true, data: modes });
});

// ============ 宿主机 Docker 守护进程配置 /etc/docker/daemon.json ============

/**
 * 读取 daemon.json（含 registry-mirrors 与权限能力）。
 * 权限不足时不返回 500，而是把 canWrite=false 与修复建议一并返回，便于前端提示。
 */
app.get("/api/system/daemon-config", (_req, res) => {
  const info = readDaemonConfigInfo();
  apiLog.debug(`读取 ${info.path} | 存在=${info.exists} 加速源=${info.registryMirrors.length} 提权=${info.elevate}`);
  res.json({ success: true, data: info });
});

/** 重新探测提权能力（用户按提示配好 sudoers 后调用，避免重启服务） */
app.post("/api/system/daemon-config/refresh-privileges", (_req, res) => {
  const priv = refreshPrivileges();
  res.json({ success: true, data: { ...priv, info: readDaemonConfigInfo() } });
});

/**
 * 写回 registry-mirrors（保留其它配置项）。写成功且内容有变化时需要重启 Docker 才生效，
 * 是否重启由前端询问用户后调用 /api/system/docker/restart。
 */
app.put("/api/system/daemon-config", (req, res) => {
  const mirrors = (req as any).body?.registryMirrors;
  if (!Array.isArray(mirrors)) {
    res.status(400).json({ success: false, error: "registryMirrors 必须是字符串数组" });
    return;
  }
  const result = writeDaemonConfig(mirrors.map((m: unknown) => String(m ?? "")));
  apiLog.info(
    `写入 daemon.json | 成功=${result.ok} 变更=${result.changed} 提权=${result.elevate}${
      result.error ? ` 失败=${result.error}` : ""
    }`
  );
  res.json({ success: true, data: result });
});

/** 重启宿主机 Docker 服务（systemctl 优先，回退 service） */
app.post("/api/system/docker/restart", (_req, res) => {
  apiLog.info("重启 Docker 服务");
  const result = restartDockerService();
  apiLog.info(`重启 Docker | 成功=${result.ok}${result.command ? ` 命令=${result.command}` : ""}`);
  res.json({ success: true, data: result });
});

// ============ 静态文件托管 ============
// 二进制模式：从嵌入式数据提供服务（无需文件系统）
if (embeddedDist) {
  console.log("📦 二进制模式：从嵌入式数据托管前端 (" + Object.keys(embeddedDist).length + " 文件)");
  app.use(createEmbeddedStatic(embeddedDist));
} else {
  // 开发/传统部署模式：从磁盘读取 dist/
  const frontendDist = path.resolve(__dirname, "..", "..", "dist");
  if (existsSync(frontendDist)) {
    console.log("📁 文件系统模式：托管前端静态文件 " + frontendDist);
    app.use(express.static(frontendDist));
  }
}

// ============ 容器操作 API ============

app.post("/api/engines/:id/containers/:cid/:action", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { cid, action } = req.params;
  const allowedActions = ["start", "stop", "restart", "pause", "unpause"];
  if (!allowedActions.includes(action)) {
    res.status(400).json({ success: false, error: "不支持的操作" });
    return;
  }
  apiLog.info(`容器操作: ${action} | 引擎=${engine.name} 容器=${cid}`);
  try {
    await containerAction(engine, cid, action as any);
    apiLog.info(`容器操作完成: ${action} | 容器=${cid}`);
    res.json({ success: true });
  } catch (err: any) {
    apiLog.error(`容器操作失败: ${action} | 容器=${cid} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "操作失败" });
  }
});

app.delete("/api/engines/:id/containers/:cid", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const force = req.query.force === "true";
  apiLog.info(`删除容器 | 引擎=${engine.name} 容器=${req.params.cid} force=${force}`);
  try {
    await removeContainer(engine, req.params.cid, force);
    apiLog.info(`删除容器完成 | 容器=${req.params.cid}`);
    res.json({ success: true });
  } catch (err: any) {
    apiLog.error(`删除容器失败 | 容器=${req.params.cid} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "删除失败" });
  }
});

// ============ 镜像操作 API ============

app.delete("/api/engines/:id/images/:iid", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const force = req.query.force === "true";
  apiLog.info(`删除镜像 | 引擎=${engine.name} 镜像=${req.params.iid} force=${force}`);
  try {
    await removeImage(engine, req.params.iid, force);
    apiLog.info(`删除镜像完成 | 镜像=${req.params.iid}`);
    res.json({ success: true });
  } catch (err: any) {
    apiLog.error(`删除镜像失败 | 镜像=${req.params.iid} 错误=${err.message}`);
    // 409 冲突：返回结构化 code，前端据此提示「强制删除」或「先处理容器」
    const parsed = classifyImageRemoveError(err);
    if (parsed) {
      res.status(parsed.status).json({ success: false, error: parsed.message, code: parsed.code });
      return;
    }
    res.status(500).json({ success: false, error: err.message || "删除失败" });
  }
});

// ============ 系统信息与在线升级 ============

/** 当前应用版本与安装目录 */
app.get("/api/system/version", (_req, res) => {
  res.json({ success: true, data: { version: CURRENT_VERSION, installDir: getInstallDir() } });
});

/** 检查 GitHub Releases 是否有新版本 */
app.get("/api/system/update/check", async (_req, res) => {
  try {
    const info = await checkForUpdate();
    res.json({ success: true, data: info });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || "检查更新失败" });
  }
});

/** 下载并应用更新（替换二进制后进程退出，由 systemd 拉起新版本） */
app.post("/api/system/update/apply", (_req, res) => {
  // 已在更新中：直接返回，不重复触发
  const cur = getUpdateState();
  if (cur.phase === "downloading" || cur.phase === "extracting" || cur.phase === "replacing") {
    res.json({ success: true, data: { message: "更新正在进行中", inProgress: true } });
    return;
  }
  // 后台执行、立即返回：整段更新（下载 40MB + 解压 + 替换 + 重启）可能耗时数十秒。
  // 若在此 await，HTTP 请求会被长时间挂起，前端只有在请求返回后才启动轮询，
  // 导致点击「一键更新」后进度条迟迟不出现（刷新页面才因挂载逻辑而显示）。
  // 改为 fire-and-forget，状态变化由前端轮询 /system/update/status 获取。
  performUpdate().catch((err: any) => {
    // 已知失败路径 performUpdate 内部已 setState("error")；此处仅兜底极端异常
    markUpdateError("更新失败", err?.message || String(err));
  });
  res.json({ success: true, data: { message: "更新已开始" } });
});

/** 更新进度（供前端轮询） */
app.get("/api/system/update/status", (_req, res) => {
  res.json({ success: true, data: getUpdateState() });
});

app.post("/api/engines/:id/images/prune", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  apiLog.info(`清理悬空镜像 | 引擎=${engine.name}`);
  try {
    const result = await pruneImages(engine);
    apiLog.info(`清理悬空镜像完成 | 引擎=${engine.name} 结果=${JSON.stringify(result).slice(0, 200)}`);
    res.json({ success: true, data: result });
  } catch (err: any) {
    apiLog.error(`清理悬空镜像失败 | 引擎=${engine.name} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "清理失败" });
  }
});

// ============ 数据卷操作 API ============

// ============ 镜像拉取任务 API ============

/** 发起镜像拉取（后台任务，立即返回任务 ID） */
app.post("/api/engines/:id/images/pull", (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const image = (req.body?.image || "").trim();
  if (!image) { res.status(400).json({ success: false, error: "镜像名不能为空" }); return; }
  apiLog.info(`发起镜像拉取 | 引擎=${engine.name} 镜像=${image}`);
  try {
    const task = startImagePull(engine, image);
    res.json({ success: true, data: task });
  } catch (err: any) {
    apiLog.error(`发起镜像拉取失败 | 镜像=${image} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "发起拉取失败" });
  }
});

/** 获取引擎的全部拉取任务（含进行中与最近完成） */
app.get("/api/engines/:id/images/pull-tasks", (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    res.json({ success: true, data: listPullTasks(engine.id) });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "获取拉取任务失败" });
  }
});

/** 获取单个拉取任务详情（层进度 + 输出行） */
app.get("/api/engines/:id/images/pull-tasks/:taskId", (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  try {
    res.json({ success: true, data: getPullTask(req.params.taskId) });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message || "任务不存在" });
  }
});

/** 取消拉取任务 */
app.post("/api/engines/:id/images/pull-tasks/:taskId/cancel", (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  apiLog.info(`取消镜像拉取 | 引擎=${engine.name} 任务=${req.params.taskId}`);
  try {
    const task = cancelImagePull(req.params.taskId);
    res.json({ success: true, data: task });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message || "取消失败" });
  }
});

app.delete("/api/engines/:id/volumes/:vname", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const force = req.query.force === "true";
  apiLog.info(`删除数据卷 | 引擎=${engine.name} 卷=${req.params.vname} force=${force}`);
  try {
    await removeVolume(engine, req.params.vname, force);
    apiLog.info(`删除数据卷完成 | 卷=${req.params.vname}`);
    res.json({ success: true });
  } catch (err: any) {
    apiLog.error(`删除数据卷失败 | 卷=${req.params.vname} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "删除失败" });
  }
});

app.post("/api/engines/:id/volumes/prune", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  apiLog.info(`清理无用数据卷 | 引擎=${engine.name}`);
  try {
    const result = await pruneVolumes(engine);
    apiLog.info(`清理无用数据卷完成 | 引擎=${engine.name} 结果=${JSON.stringify(result).slice(0, 200)}`);
    res.json({ success: true, data: result });
  } catch (err: any) {
    apiLog.error(`清理无用数据卷失败 | 引擎=${engine.name} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "清理失败" });
  }
});

app.post("/api/engines/:id/volumes", async (req, res) => {
  const engine = getEngine(req.params.id);
  if (!engine) { res.status(404).json({ success: false, error: "引擎不存在" }); return; }
  const { name, driver } = req.body;
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ success: false, error: "卷名称不能为空" });
    return;
  }
  apiLog.info(`创建数据卷 | 引擎=${engine.name} 卷=${name} 驱动=${driver || "local"}`);
  try {
    const volume = await createVolume(engine, name.trim(), driver || "local");
    apiLog.info(`创建数据卷完成 | 卷=${name}`);
    res.json({ success: true, data: volume });
  } catch (err: any) {
    apiLog.error(`创建数据卷失败 | 卷=${name} 错误=${err.message}`);
    res.status(500).json({ success: false, error: err.message || "创建数据卷失败" });
  }
});

// ============ SPA 前端路由回退（必须在所有 API 路由之后） ============
if (!embeddedDist) {
  const frontendDist = path.resolve(__dirname, "..", "..", "dist");
  if (existsSync(frontendDist)) {
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }
}

// 启动服务
const server = app.listen(PORT, () => {
  console.log(`🚀 Backend running on http://localhost:${PORT}`);

  // 启动后自动检测所有引擎
  testAllConnections().then(() => {
    console.log("✅ 引擎状态检测完成");
    getAllEngines().forEach((e) => {
      console.log(`   ${e.name}: ${e.status}${e.dockerVersion ? " (" + e.dockerVersion + ")" : ""}`);
    });
    // 触发 compose 命令检测（会在日志中显示 docker compose 还是 docker-compose）
    getComposeCmd();
  });
});

// ============ WebSocket 终端 ============

const wss = new WebSocketServer({ server, path: "/ws/terminal" });

wss.on("connection", async (ws, req) => {
  // 解析 URL: /ws/terminal?engineId=xxx&containerId=yyy
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  const engineId = url.searchParams.get("engineId");
  const containerId = url.searchParams.get("containerId");

  if (!engineId || !containerId) {
    ws.close(1008, "Missing engineId or containerId");
    return;
  }

  const engine = getEngine(engineId);
  if (!engine) {
    ws.close(1008, "Engine not found");
    return;
  }

  let cleanup: (() => void) | null = null;
  let execId: string | null = null;

  try {
    const result = await attachContainerTerminal(engine, containerId);
    const stream = result.stream;
    cleanup = result.cleanup;
    execId = result.execId;

    // 发送就绪消息
    ws.send(JSON.stringify({ type: "ready" }));

    // Docker stream -> WebSocket
    stream.on("data", (chunk: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(chunk);
      }
    });

    stream.on("end", () => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, "Terminal session ended");
      }
    });

    stream.on("error", (err: any) => {
      console.error("Docker stream error:", err);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "error", message: err.message }));
      }
    });

    // WebSocket -> Docker stream
    ws.on("message", (data) => {
      if (Buffer.isBuffer(data)) {
        const text = data.toString("utf-8");
        // 检查是否为 resize 消息
        if (text.startsWith("{")) {
          try {
            const msg = JSON.parse(text);
            if (msg.type === "resize" && execId) {
              resizeContainerTerminal(engine, containerId, execId, msg.cols || 80, msg.rows || 24).catch((e) =>
                console.error("Resize failed:", e)
              );
              return;
            }
          } catch { /* not JSON, treat as raw input */ }
        }
        stream.write(data);
      } else {
        const text = data.toString();
        if (text.startsWith("{")) {
          try {
            const msg = JSON.parse(text);
            if (msg.type === "resize" && execId) {
              resizeContainerTerminal(engine, containerId, execId, msg.cols || 80, msg.rows || 24).catch((e) =>
                console.error("Resize failed:", e)
              );
              return;
            }
          } catch { /* not JSON, treat as raw input */ }
        }
        stream.write(Buffer.from(data as ArrayBuffer));
      }
    });

    ws.on("close", () => {
      if (cleanup) cleanup();
    });
  } catch (err: any) {
    console.error("Terminal attach failed:", err);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: err.message || "连接终端失败" }));
    }
    ws.close(1011, err.message);
  }
});
