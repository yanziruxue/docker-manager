import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Container,
  User,
  Bell,
  Package,
  Clock,
  Server,
  Columns,
  Mail,
  Webhook,
  Save,
  Plus,
  Trash2,
  RefreshCw,
  Download,
  Upload,
  Globe,
  HardDrive,
  Calendar,
  Infinity as InfinityIcon,
  Archive,
  Database,
  Pencil,
  Check,
  X,
  GripVertical,
  Wifi,
  WifiOff,
  AlertCircle,
  Activity,
  Link2,
  Power,
  Loader2,
  Terminal,
  Zap,
} from "lucide-react";
import type { SystemSettings, BackupMode, DockerEngine, UpdateInfo, UpdateState } from "../types";
import { Card, FormField, Input, Select, Toggle, IconButton } from "../components/UI";
import { Tag } from "../components/Badge";
import { Modal, ConfirmDialog } from "../components/Modal";
import { CmdOutputModal, useCmdOutput } from "../components/CmdOutputModal";
import {
  createEngine,
  renameEngine,
  deleteEngine as apiDeleteEngine,
  testEngineConnection,
  refreshAllEngines,
  detectComposeModes,
  fetchDaemonConfig,
  refreshDaemonPrivileges,
  saveDaemonConfigApi,
  restartDockerApi,
  type DaemonConfigInfo,
  fetchAppVersion,
  checkUpdateApi,
  applyUpdateApi,
  fetchUpdateStatusApi,
} from "../api";

function getDefaultSettings(): SystemSettings {
  return {
    docker: {
      engines: [],
      activeEngineId: "",
      defaultRestartPolicy: "unless-stopped",
      defaultNetworkMode: "bridge",
      pollingInterval: 5,
      puid: "99",
      pgid: "100",
      tz: "Asia/Shanghai",
      composeStoragePath: "compose-manager",
      composeMode: "auto",
      menuLanguage: "en",
      logLevel: "info",
      registryMirrors: [],
      rewriteImageNames: false,
    },
    notifications: {
      webhookEnabled: false,
      webhookUrl: "",
      emailEnabled: false,
      emailSmtp: "",
      emailPort: 587,
      emailUser: "",
      events: { containerDown: true, updateAvailable: true, updateComplete: false, buildFailed: true },
    },
    backup: {
      mode: 1,
      autoBackupEnabled: false,
      backupPath: "docker-compose-backup-manager",
      lastBackup: "",
      simpleFrequency: "0 3 * * 0",
      simpleRetentionCount: 5,
      weekly: { enabled: true, day: "Saturday", time: "23:00", retention: 6 },
      monthly: { enabled: true, dayOfMonth: 0, time: "23:00", retention: 8 },
      yearly: { enabled: true, date: "12-31", time: "23:00" },
    },
    pathFavorites: [],
    updateScheduler: { enabled: false, checkFrequency: "0 3 * * *", autoPull: false },
    user: { username: "admin", sessionTimeout: 30 },
    update: { autoCheck: false },
    columnVisibility: {
      containers: ["icon","name","status","image","ports","uptime","restartPolicy","actions"],
      images: ["repository","tag","id","size","createdAt","associatedContainers","sha256","actions"],
      volumes: ["name","driver","mountpoint","size","createdAt","associatedContainers","inUse","actions"],
    },
  };
}

interface SettingsProps {
  settings?: SystemSettings;
  activeEngineId: string;
  engines: DockerEngine[];
  onActiveEngineChange: (engineId: string) => void;
  onEnginesChange: (engines: DockerEngine[]) => void;
  onSaveSettings?: (settings: SystemSettings) => Promise<void>;
}

export function Settings({ settings, activeEngineId, engines, onActiveEngineChange, onEnginesChange, onSaveSettings }: SettingsProps) {
  const [activeSection, setActiveSection] = useState("docker");
  const [data, setData] = useState<SystemSettings>(settings || getDefaultSettings());
  const [settingsLoaded, setSettingsLoaded] = useState(!!settings);

  // 当后端 settings 到达后同步
  useEffect(() => {
    if (settings) {
      setData(settings);
      setSettingsLoaded(true);
    }
  }, [settings]);

  // 引擎管理状态
  const [enginesLoading, setEnginesLoading] = useState(false);
  // App.tsx 还在加载引擎时显示加载中
  const enginesInitialLoading = engines.length === 0 && !activeEngineId;
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [editingEngineId, setEditingEngineId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showAddEngine, setShowAddEngine] = useState(false);
  const [addingEngine, setAddingEngine] = useState(false);
  const [newEngine, setNewEngine] = useState<{
    name: string;
    connectionType: "socket" | "tcp" | "ssh";
    socketPath: string;
    tcpAddress: string;
    sshHost: string;
    sshPort: number;
    sshUsername: string;
    sshAuthType: "password" | "key";
    sshPassword: string;
    sshKey: string;
    sshPassphrase: string;
  }>({
    name: "", connectionType: "socket", socketPath: "", tcpAddress: "",
    sshHost: "", sshPort: 22, sshUsername: "", sshAuthType: "password", sshPassword: "", sshKey: "", sshPassphrase: "",
  });

  // Compose 命令检测结果
  const [composeModes, setComposeModes] = useState<{ plugin: boolean; standalone: boolean } | null>(null);
  const [composeDetecting, setComposeDetecting] = useState(false);

  const handleDetectCompose = async () => {
    setComposeDetecting(true);
    try {
      const modes = await detectComposeModes();
      setComposeModes(modes);
    } catch {
      setComposeModes({ plugin: false, standalone: false });
    } finally {
      setComposeDetecting(false);
    }
  };

  // 首次加载时检测一次
  useEffect(() => { handleDetectCompose(); }, []);

  // ============ 宿主机 Docker 守护进程配置（/etc/docker/daemon.json） ============
  // 「镜像加速源」的真实来源：页面加载以文件内容为准回读，保存时写回文件（两侧同步）
  const [daemon, setDaemon] = useState<DaemonConfigInfo | null>(null);
  const [daemonLoading, setDaemonLoading] = useState(false);
  // 保存后询问是否重启 Docker
  const [askRestart, setAskRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // 无权限时展示的修复建议（可直接复制到终端执行）
  const [privilegeHint, setPrivilegeHint] = useState<string | null>(null);
  const daemonSyncedRef = useRef(false);
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  const loadDaemon = useCallback(async (syncToList = false) => {
    setDaemonLoading(true);
    try {
      const info = await fetchDaemonConfig();
      setDaemon(info);
      // 首次加载：以 daemon.json 为准回填列表，实现「两侧修改同步」
      if (syncToList && !daemonSyncedRef.current && info.canRead && !info.parseError) {
        daemonSyncedRef.current = true;
        setData((prev) => ({
          ...prev,
          docker: { ...prev.docker, registryMirrors: info.registryMirrors },
        }));
      }
    } catch {
      setDaemon(null);
    } finally {
      setDaemonLoading(false);
    }
  }, []);

  useEffect(() => { loadDaemon(true); }, [loadDaemon]);

  /** 重新探测提权能力（按提示配好 sudoers 后点「重新检测」） */
  const handleRefreshPrivileges = async () => {
    setDaemonLoading(true);
    try {
      const r = await refreshDaemonPrivileges();
      setDaemon(r.info);
      setToast({
        type: r.info.canWrite ? "success" : "error",
        message: r.info.canWrite
          ? `已获取写入权限（${r.info.elevate === "root" ? "root" : "sudo 免密"}）`
          : "仍然没有写入权限，请确认 sudoers 与 systemd 配置均已生效",
      });
    } catch {
      setToast({ type: "error", message: "检测失败：服务器错误" });
    } finally {
      setDaemonLoading(false);
    }
  };

  /** 重启 Docker 并展示 tail 输出 */
  const doRestartDocker = async () => {
    setRestarting(true);
    setAskRestart(false);
    try {
      const r = await restartDockerApi();
      showOutput({
        title: "重启 Docker",
        name: r.ok ? "完成" : "失败",
        output: [r.command ? `$ ${r.command}` : "", r.output || "", r.ok ? "" : `\n${r.error || ""}`]
          .filter(Boolean)
          .join("\n"),
        failed: !r.ok,
      });
      setToast({
        type: r.ok ? "success" : "error",
        message: r.ok ? "Docker 已重启，加速源生效" : r.error || "重启 Docker 失败",
      });
    } catch (err: any) {
      showOutput({
        title: "重启 Docker",
        name: "失败",
        output: String(err?.message || err || "未知错误"),
        failed: true,
      });
    } finally {
      setRestarting(false);
      loadDaemon().catch(() => {});
    }
  };

  /**
   * 保存设置后把加速源写回 daemon.json。
   * 内容有变化 → 弹窗询问是否重启 Docker；失败 → 展示修复建议（应用设置已保存，不受影响）。
   */
  const syncDaemonMirrors = async (list: string[]) => {
    // 明确无写权限时不打扰（页面已有常驻提示），配好 sudoers 后点「重新检测」即可
    if (daemon && daemon.elevate === "none") return;
    try {
      const r = await saveDaemonConfigApi(list.map((m) => (m || "").trim()).filter(Boolean));
      if (!r.ok) {
        if (r.hint) setPrivilegeHint(r.hint);
        setToast({ type: "error", message: r.error || "写入 /etc/docker/daemon.json 失败" });
        return;
      }
      loadDaemon().catch(() => {});
      if (r.changed) setAskRestart(true);
    } catch (err: any) {
      setToast({
        type: "error",
        message: `写入 daemon.json 失败：${String(err?.message || err || "未知错误")}`,
      });
    }
  };

  // ============ 系统更新（OTA）状态 ============
  const [appVersion, setAppVersion] = useState<{ version: string; installDir: string } | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 后台更新进行中（下载/解压/替换阶段）：按钮据此保持禁用并显示「升级中…」
  const updateInProgress =
    updateState?.phase === "downloading" ||
    updateState?.phase === "extracting" ||
    updateState?.phase === "replacing";

  // 进入页面时获取当前版本号
  useEffect(() => {
    fetchAppVersion().then(setAppVersion).catch(() => {});
  }, []);

  // 卸载时清理轮询定时器
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearInterval(statusTimerRef.current);
    };
  }, []);

  // 启动更新进度轮询（handleApplyUpdate 与「刷新后自动恢复」共用）
  const startUpdatePolling = () => {
    if (statusTimerRef.current) clearInterval(statusTimerRef.current);
    statusTimerRef.current = setInterval(() => {
      fetchUpdateStatusApi()
        .then((st) => {
          setUpdateState(st);
          if (st.phase === "done" || st.phase === "error") {
            if (statusTimerRef.current) clearInterval(statusTimerRef.current);
            statusTimerRef.current = null;
          }
        })
        .catch(() => {
          // 进程已退出重启，忽略连接错误
        });
    }, 1500);
  };

  // 页面刷新/重进后，若后端更新正在进行，自动接管进度显示
  useEffect(() => {
    fetchUpdateStatusApi()
      .then((st) => {
        if (st.phase === "downloading" || st.phase === "extracting" || st.phase === "replacing") {
          setUpdateState(st);
          startUpdatePolling();
        }
      })
      .catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setChecking(true);
    setUpdateInfo(null);
    setUpdateState(null);
    try {
      const info = await checkUpdateApi();
      setUpdateInfo(info);
      if (!info.hasUpdate) setToast({ type: "success", message: "已是最新版本" });
    } catch (err: any) {
      setToast({ type: "error", message: err?.message || "检查更新失败" });
    } finally {
      setChecking(false);
    }
  };

  const handleApplyUpdate = async () => {
    // 立即给出乐观状态并启动轮询：后端 apply 接口已改为后台执行、立即返回，
    // 绝不能在它返回之后才轮询（否则点击后进度条迟迟不出现）。
    setUpdateState({ phase: "downloading", message: "正在准备更新...", percent: 0 });
    startUpdatePolling();
    try {
      await applyUpdateApi();
    } catch (err: any) {
      // 正常路径下 apply 不会报错（后端已改为立即返回）；若请求本身失败，停止轮询并提示错误
      if (statusTimerRef.current) clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
      const msg = String(err?.message || err || "未知错误");
      setUpdateState({ phase: "error", message: "升级失败", percent: 0, error: msg });
    }
  };

  // 保存反馈状态
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string; field?: string } | null>(null);
  // 3 秒后自动消失
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // ============ 引擎操作 ============

  // 刷新所有引擎状态
  const handleRefreshAll = async () => {
    setEnginesLoading(true);
    try {
      const list = await refreshAllEngines();
      onEnginesChange(list);
    } catch (err) {
      console.error("刷新失败:", err);
    } finally {
      setEnginesLoading(false);
    }
  };

  // 测试单个引擎连接
  const handleTestConnection = async (engineId: string) => {
    setConnectingId(engineId);
    try {
      const updated = await testEngineConnection(engineId);
      onEnginesChange(engines.map((e) => (e.id === engineId ? updated : e)));
    } catch (err) {
      console.error("连接测试失败:", err);
    } finally {
      setConnectingId(null);
    }
  };

  // 切换活跃引擎
  const setActiveEngine = (engineId: string) => {
    onActiveEngineChange(engineId);
  };

  const startRename = (engine: DockerEngine) => {
    setEditingEngineId(engine.id);
    setRenameValue(engine.name);
  };

  const confirmRename = async () => {
    if (!editingEngineId || !renameValue.trim()) return;
    try {
      const updated = await renameEngine(editingEngineId, renameValue.trim());
      onEnginesChange(engines.map((e) => (e.id === editingEngineId ? updated : e)));
    } catch (err) {
      console.error("重命名失败:", err);
    }
    setEditingEngineId(null);
    setRenameValue("");
  };

  const cancelRename = () => {
    setEditingEngineId(null);
    setRenameValue("");
  };

  const handleDeleteEngine = async (engineId: string) => {
    try {
      await apiDeleteEngine(engineId);
      const filtered = engines.filter((e) => e.id !== engineId);
      onEnginesChange(filtered);
      // 如果删的是活跃引擎，切换到第一个
      if (activeEngineId === engineId && filtered.length > 0) {
        onActiveEngineChange(filtered[0].id);
      }
    } catch (err) {
      console.error("删除引擎失败:", err);
    }
  };

  const addEngine = async () => {
    if (!newEngine.name.trim()) return;
    setAddingEngine(true);
    try {
      const created = await createEngine(newEngine);
      onEnginesChange([...engines, created]);
      setShowAddEngine(false);
      setNewEngine({ name: "", connectionType: "socket", socketPath: "", tcpAddress: "", sshHost: "", sshPort: 22, sshUsername: "", sshAuthType: "password", sshPassword: "", sshKey: "", sshPassphrase: "" });
    } catch (err) {
      console.error("添加引擎失败:", err);
    } finally {
      setAddingEngine(false);
    }
  };

  // ============ 保存设置 ============

  const handleSave = async () => {
    const errors: string[] = [];

    // Docker 全局配置校验
    if (data.docker.pollingInterval < 1) {
      errors.push("Docker 全局配置：轮询间隔不能小于 1 秒");
    }
    if (!data.docker.composeStoragePath.trim()) {
      errors.push("Docker 全局配置：Compose 文件存储路径不能为空");
    }

    // 用户配置校验
    if (!data.user.username.trim()) {
      errors.push("用户与权限：用户名不能为空");
    }

    // 通知配置校验
    if (data.notifications.webhookEnabled && !data.notifications.webhookUrl.trim()) {
      errors.push("通知配置：Webhook URL 不能为空");
    }
    if (data.notifications.emailEnabled) {
      if (!data.notifications.emailSmtp.trim()) errors.push("通知配置：SMTP 服务器不能为空");
      if (!data.notifications.emailUser.trim()) errors.push("通知配置：邮箱用户名不能为空");
    }

    // 备份配置校验
    if (data.backup.autoBackupEnabled && !data.backup.backupPath.trim()) {
      errors.push("备份管理：备份存储路径不能为空");
    }

    if (errors.length > 0) {
      setToast({ type: "error", message: errors[0] });
      // 跳转到第一个错误的分区
      const firstError = errors[0];
      if (firstError.includes("Docker")) setActiveSection("docker");
      else if (firstError.includes("用户")) setActiveSection("user");
      else if (firstError.includes("通知")) setActiveSection("notifications");
      else if (firstError.includes("备份")) setActiveSection("backup");
      return;
    }

    // 保存到后端
    try {
      if (onSaveSettings) {
        await onSaveSettings(data);
      } else {
        localStorage.setItem("docker-settings", JSON.stringify(data));
      }
      setToast({ type: "success", message: "设置已保存" });
    } catch {
      setToast({ type: "error", message: "保存失败：服务器错误" });
      return;
    }

    // 同步写回宿主机 /etc/docker/daemon.json 的 registry-mirrors（两侧保持一致）
    await syncDaemonMirrors(data.docker.registryMirrors || []);
  };

  const sections = [
    { key: "docker", label: "Docker 全局配置", icon: <Container size={16} /> },
    { key: "user", label: "用户与权限", icon: <User size={16} /> },
    { key: "columns", label: "列显隐默认值", icon: <Columns size={16} /> },
    { key: "notifications", label: "通知配置", icon: <Bell size={16} /> },
    { key: "backup", label: "备份管理", icon: <Package size={16} /> },
    { key: "scheduler", label: "更新调度器", icon: <Clock size={16} /> },
    { key: "update", label: "系统更新", icon: <Download size={16} /> },
  ];

  const update = (section: string, field: string, value: any) => {
    setData({ ...data, [section]: { ...data[section as keyof SystemSettings], [field]: value } });
  };

  // 镜像加速源多源列表 + 拖拽排序
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const mirrors = Array.isArray(data.docker?.registryMirrors) ? data.docker.registryMirrors : [];
  const setMirrors = (next: string[]) => update("docker", "registryMirrors", next);
  const addMirror = () => setMirrors([...mirrors, ""]);
  const removeMirror = (i: number) => setMirrors(mirrors.filter((_, j) => j !== i));
  const updateMirrorAt = (i: number, val: string) => {
    const n = [...mirrors];
    n[i] = val;
    setMirrors(n);
  };
  const onMirrorDragOver = (i: number, e: React.DragEvent) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) return;
    const n = [...mirrors];
    const [m] = n.splice(dragIdx, 1);
    n.splice(i, 0, m);
    setMirrors(n);
    setDragIdx(i);
  };
  // 实测可用的公益 Docker Hub 加速源（2026-08），用户可一键填入
  const RECOMMENDED_MIRRORS: { url: string; label: string }[] = [
    { url: "https://docker.xuanyuan.me", label: "轩辕镜像（公益免费，实测 ~12MB/s）" },
    { url: "https://docker.1ms.run", label: "毫秒镜像（稳定）" },
  ];
  const addRecommendedMirrors = () => {
    const existing = new Set(mirrors.map((m) => m.trim()).filter(Boolean));
    const toAdd = RECOMMENDED_MIRRORS.filter((r) => !existing.has(r.url)).map((r) => r.url);
    if (toAdd.length === 0) {
      setToast({ type: "success", message: "推荐加速源已存在" });
      return;
    }
    setMirrors([...mirrors, ...toAdd]);
  };

  return (
    <div className="flex h-full">
      {/* Settings Sidebar */}
      <div className="w-56 border-r border-slate-200 bg-white p-3 flex-shrink-0">
        <div className="space-y-0.5">
          {sections.map((section) => (
            <button
              key={section.key}
              onClick={() => setActiveSection(section.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-semibold tracking-wider transition-colors border-l-2 ${
                activeSection === section.key ? "bg-blue-50 text-blue-600 border-blue-500" : "text-slate-500 hover:bg-slate-50 border-transparent"
              }`}
            >
              {section.icon}
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeSection === "docker" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Docker 全局配置</h2>
              <p className="text-sm text-slate-500">管理 Docker Engine 连接和默认参数</p>
            </div>

            {/* 多引擎列表 */}
            <Card title="Docker Engine 连接" icon={<Server size={16} />} actions={
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">{engines.length} 个引擎</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleRefreshAll(); }}
                  className="p-1 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                  title="刷新所有引擎状态"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            }>
              <div className="space-y-3">
                {(enginesLoading || enginesInitialLoading) && (
                  <div className="flex items-center justify-center py-8 text-slate-400">
                    <Loader2 size={20} className="animate-spin mr-2" />
                    <span className="text-sm">加载引擎列表...</span>
                  </div>
                )}

                {!enginesLoading && !enginesInitialLoading && engines.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                    <Server size={32} className="mb-2" />
                    <p className="text-sm">暂无 Docker Engine</p>
                    <p className="text-xs mt-1">点击下方按钮添加</p>
                  </div>
                )}

                {!enginesLoading && !enginesInitialLoading && engines.map((engine) => {
                  const isActive = engine.id === activeEngineId;
                  const isEditing = editingEngineId === engine.id;
                  const statusIcon = (() => {
                    switch (engine.status) {
                      case "connected": return <Activity size={14} className="text-green-500" />;
                      case "disconnected": return <WifiOff size={14} className="text-slate-400" />;
                      case "error": return <AlertCircle size={14} className="text-red-500" />;
                    }
                  })();
                  const statusText = (() => {
                    switch (engine.status) {
                      case "connected": return "已连接";
                      case "disconnected": return "未连接";
                      case "error": return "连接异常";
                    }
                  })();
                  const statusBg = (() => {
                    switch (engine.status) {
                      case "connected": return "bg-green-50 border-green-200";
                      case "disconnected": return "bg-slate-50 border-slate-200";
                      case "error": return "bg-red-50 border-red-200";
                    }
                  })();

                  return (
                    <div
                      key={engine.id}
                      onClick={() => setActiveEngine(engine.id)}
                      className={`flex items-center gap-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                        isActive ? "border-blue-500 bg-blue-50/50" : `${statusBg} hover:border-slate-300`
                      }`}
                    >
                      {/* 连接类型图标 */}
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        isActive ? "bg-blue-500 text-white" : "bg-white text-slate-500 border border-slate-200"
                      }`}>
                        {engine.connectionType === "socket" ? <HardDrive size={18} /> : engine.connectionType === "ssh" ? <Terminal size={18} /> : <Wifi size={18} />}
                      </div>

                      {/* 引擎信息 */}
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") confirmRename(); if (e.key === "Escape") cancelRename(); }}
                              className="flex-1 px-2 py-1 text-sm border border-blue-300 rounded focus:outline-none focus:border-blue-500"
                              autoFocus
                            />
                            <button onClick={confirmRename} className="p-1 text-green-500 hover:text-green-600 hover:bg-green-50 rounded">
                              <Check size={14} />
                            </button>
                            <button onClick={cancelRename} className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded">
                              <X size={14} />
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-slate-700">{engine.name}</p>
                              {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500 text-white font-medium">当前</span>}
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5">
                              {engine.connectionType === "socket" ? engine.socketPath : engine.connectionType === "ssh" ? `${engine.sshUsername}@${engine.sshHost}:${engine.sshPort}` : engine.tcpAddress}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* 状态 */}
                      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                        <div className="flex items-center gap-1.5">
                          {statusIcon}
                          <span className={`text-xs font-medium ${
                            engine.status === "connected" ? "text-green-600" :
                            engine.status === "error" ? "text-red-500" : "text-slate-400"
                          }`}>{statusText}</span>
                          {engine.dockerVersion && (
                            <span className="text-[10px] text-slate-400 ml-1">{engine.dockerVersion}</span>
                          )}
                        </div>
                        {engine.status === "error" && engine.errorMessage && (
                          <span className="text-[10px] text-red-400 max-w-[200px] truncate" title={engine.errorMessage}>
                            {engine.errorMessage}
                          </span>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      {!isEditing && (
                        <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleTestConnection(engine.id)}
                            disabled={connectingId === engine.id}
                            className="p-1.5 text-slate-400 hover:text-green-500 hover:bg-green-50 rounded-lg transition-colors"
                            title="测试连接"
                          >
                            {connectingId === engine.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Link2 size={14} />
                            )}
                          </button>
                          <button
                            onClick={() => startRename(engine)}
                            className="p-1.5 text-slate-400 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                            title="重命名"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDeleteEngine(engine.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                            title="删除引擎"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* 添加新引擎表单 */}
                {showAddEngine && (
                  <div className="p-4 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/30 space-y-3">
                    <p className="text-sm font-medium text-blue-600">添加新引擎</p>
                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="引擎名称">
                        <Input
                          value={newEngine.name}
                          onChange={(val) => setNewEngine({ ...newEngine, name: val })}
                          placeholder="如：开发环境 Docker"
                        />
                      </FormField>
                      <FormField label="连接方式">
                        <Select
                          value={newEngine.connectionType}
                          onChange={(val) => setNewEngine({ ...newEngine, connectionType: val as "socket" | "tcp" | "ssh" })}
                          options={[
                            { value: "socket", label: "本地 Socket" },
                            { value: "tcp", label: "远程 TCP" },
                            { value: "ssh", label: "SSH 连接" },
                          ]}
                        />
                      </FormField>
                      {newEngine.connectionType === "socket" ? (
                        <FormField label="Socket 路径">
                          <Input
                            value={newEngine.socketPath}
                            onChange={(val) => setNewEngine({ ...newEngine, socketPath: val })}
                            placeholder="/var/run/docker.sock"
                          />
                        </FormField>
                      ) : newEngine.connectionType === "ssh" ? (
                        <>
                          <FormField label="SSH 主机">
                            <Input
                              value={newEngine.sshHost}
                              onChange={(val) => setNewEngine({ ...newEngine, sshHost: val })}
                              placeholder="192.168.24.11"
                            />
                          </FormField>
                          <FormField label="SSH 端口">
                            <Input
                              value={String(newEngine.sshPort)}
                              onChange={(val) => setNewEngine({ ...newEngine, sshPort: parseInt(val) || 22 })}
                              placeholder="22"
                            />
                          </FormField>
                          <FormField label="用户名">
                            <Input
                              value={newEngine.sshUsername}
                              onChange={(val) => setNewEngine({ ...newEngine, sshUsername: val })}
                              placeholder="root"
                            />
                          </FormField>
                          <FormField label="认证方式">
                            <Select
                              value={newEngine.sshAuthType}
                              onChange={(val) => setNewEngine({ ...newEngine, sshAuthType: val as "password" | "key" })}
                              options={[
                                { value: "password", label: "密码" },
                                { value: "key", label: "私钥" },
                              ]}
                            />
                          </FormField>
                          {newEngine.sshAuthType === "password" ? (
                            <FormField label="SSH 密码">
                              <Input
                                value={newEngine.sshPassword}
                                onChange={(val) => setNewEngine({ ...newEngine, sshPassword: val })}
                                placeholder="输入 SSH 密码"
                              />
                            </FormField>
                          ) : (
                            <>
                              <FormField label="SSH 私钥">
                                <textarea
                                  value={newEngine.sshKey}
                                  onChange={(e) => setNewEngine({ ...newEngine, sshKey: e.target.value })}
                                  placeholder="粘贴私钥内容 (-----BEGIN RSA PRIVATE KEY-----...)"
                                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-colors resize-none"
                                  rows={4}
                                />
                              </FormField>
                              <FormField label="私钥密码（可选）">
                                <Input
                                  value={newEngine.sshPassphrase}
                                  onChange={(val) => setNewEngine({ ...newEngine, sshPassphrase: val })}
                                  placeholder="私钥设置了密码才需要填"
                                />
                              </FormField>
                            </>
                          )}
                        </>
                      ) : (
                        <FormField label="TCP 地址">
                          <Input
                            value={newEngine.tcpAddress}
                            onChange={(val) => setNewEngine({ ...newEngine, tcpAddress: val })}
                            placeholder="tcp://192.168.1.100:2376"
                          />
                        </FormField>
                      )}
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        onClick={addEngine}
                        disabled={!newEngine.name.trim() || addingEngine}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {addingEngine ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                        {addingEngine ? "添加中..." : "确认添加"}
                      </button>
                      <button
                        onClick={() => { setShowAddEngine(false); setNewEngine({ name: "", connectionType: "socket", socketPath: "", tcpAddress: "", sshHost: "", sshPort: 22, sshUsername: "", sshAuthType: "password", sshPassword: "", sshKey: "", sshPassphrase: "" }); }}
                        className="px-3 py-1.5 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}

                {!showAddEngine && (
                  <button
                    onClick={() => setShowAddEngine(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-400 hover:border-blue-400 hover:text-blue-500 transition-colors"
                  >
                    <Plus size={16} /> 添加 Docker Engine
                  </button>
                )}
              </div>
            </Card>

            <Card title="默认参数" icon={<Container size={16} />}>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField label="默认重启策略">
                    <Select
                      value={data.docker.defaultRestartPolicy}
                      onChange={(val) => update("docker", "defaultRestartPolicy", val)}
                      options={[
                        { value: "always", label: "always" },
                        { value: "unless-stopped", label: "unless-stopped" },
                        { value: "on-failure", label: "on-failure" },
                        { value: "no", label: "no" },
                      ]}
                    />
                  </FormField>
                  <FormField label="默认网络模式">
                    <Select
                      value={data.docker.defaultNetworkMode}
                      onChange={(val) => update("docker", "defaultNetworkMode", val)}
                      options={[
                        { value: "bridge", label: "Bridge" },
                        { value: "host", label: "Host" },
                        { value: "macvlan", label: "Macvlan" },
                      ]}
                    />
                  </FormField>
                  <FormField label="状态轮询间隔（秒）" hint="容器/堆栈状态刷新频率">
                    <Input value={String(data.docker.pollingInterval)} onChange={(val) => update("docker", "pollingInterval", parseInt(val) || 5)} type="number" />
                  </FormField>
                </div>

                {/* 全局默认环境变量 */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Server size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">全局默认环境变量</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="PUID" hint="LinuxServer.io 用户 ID，默认 99 (nobody)">
                      <Input value={data.docker.puid} onChange={(val) => update("docker", "puid", val)} placeholder="99" className="font-mono" />
                    </FormField>
                    <FormField label="PGID" hint="用户组 ID，默认 100 (users)">
                      <Input value={data.docker.pgid} onChange={(val) => update("docker", "pgid", val)} placeholder="100" className="font-mono" />
                    </FormField>
                    <FormField label="TZ" hint="时区，如 Asia/Shanghai">
                      <Input value={data.docker.tz} onChange={(val) => update("docker", "tz", val)} placeholder="Asia/Shanghai" className="font-mono" />
                    </FormField>
                  </div>
                </div>

              </div>
            </Card>

            <Card title="Compose 命令" icon={<Terminal size={16} />}>
              <div className="space-y-4">
                {/* Compose 命令模式 */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <Terminal size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Compose 命令模式</span>
                  </div>

                  <FormField label="模式选择" hint="设置执行 docker compose 命令时使用哪种方式">
                    <Select
                      value={data.docker.composeMode}
                      onChange={(val) => update("docker", "composeMode", val)}
                      options={[
                        { value: "auto", label: "自动识别" },
                        { value: "plugin", label: "插件模式 (docker compose)" },
                        { value: "standalone", label: "独立模式 (docker-compose)" },
                      ]}
                    />
                  </FormField>

                  {/* 说明区域 */}
                  <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700 leading-relaxed space-y-1">
                    <p><strong>三种模式说明：</strong></p>
                    <p><strong>自动识别</strong> — 优先使用 <code className="bg-blue-100 px-1 rounded">docker compose</code>（插件），不可用时回退 <code className="bg-blue-100 px-1 rounded">docker-compose</code>（独立二进制）</p>
                    <p><strong>插件模式</strong> — 强制使用 <code className="bg-blue-100 px-1 rounded">docker compose</code>，适用于安装了 Docker Compose Plugin 的系统</p>
                    <p><strong>独立模式</strong> — 强制使用 <code className="bg-blue-100 px-1 rounded">docker-compose</code>，适用于安装了独立 docker-compose 二进制的旧版系统</p>
                  </div>

                  {/* 检测当前可用模式 */}
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <button
                      onClick={handleDetectCompose}
                      disabled={composeDetecting}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded hover:border-blue-300 hover:text-blue-600 disabled:opacity-50 transition-colors"
                    >
                      {composeDetecting ? "检测中..." : "检测可用命令"}
                    </button>
                    {composeModes && (
                      <div className="flex items-center gap-4">
                        <span className={`flex items-center gap-1 ${composeModes.plugin ? "text-green-600" : "text-red-400"}`}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "currentColor" }} />
                          docker compose {composeModes.plugin ? "✓" : "✗"}
                        </span>
                        <span className={`flex items-center gap-1 ${composeModes.standalone ? "text-green-600" : "text-red-400"}`}>
                          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "currentColor" }} />
                          docker-compose {composeModes.standalone ? "✓" : "✗"}
                        </span>
                      </div>
                    )}
                    {composeModes && !composeModes.plugin && !composeModes.standalone && (
                      <span className="text-red-500 font-medium">未检测到任何 Compose 命令，请先安装</span>
                    )}
                  </div>

                  {/* 查看方法 */}
                  <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 leading-relaxed">
                    <p className="font-medium mb-1">💡 如何确认你的系统支持哪种模式？</p>
                    <p>SSH 登录服务器后执行以下命令：</p>
                    <code className="block mt-1 p-1.5 bg-slate-800 text-green-300 rounded text-[11px] whitespace-pre-wrap"># 检查插件模式
docker compose version
# 检查独立模式
docker-compose version</code>
                    <p className="mt-1">哪个命令能正常输出版本信息，就说明支持哪种模式。</p>
                  </div>
                </div>

                {/* 菜单显示语言 */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">菜单显示语言</span>
                  </div>
                  <FormField label="语言选择" hint="堆栈右键菜单显示英文或中文标签">
                    <Select
                      value={data.docker.menuLanguage || "en"}
                      onChange={(val) => update("docker", "menuLanguage", val)}
                      options={[
                        { value: "en", label: "English" },
                        { value: "zh", label: "中文" },
                      ]}
                    />
                  </FormField>
                </div>

                {/* 镜像加速源（读写宿主机 /etc/docker/daemon.json） */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center gap-2 mb-3">
                    <Globe size={14} className="text-slate-400" />
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">镜像加速源</span>
                    <div className="ml-auto flex items-center gap-2">
                      {daemon ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            daemon.elevate === "none"
                              ? "bg-red-100 text-red-700"
                              : daemon.elevate === "root"
                              ? "bg-green-100 text-green-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {daemon.elevate === "none"
                            ? "无写权限（只读）"
                            : daemon.elevate === "root"
                            ? "可读写 · root"
                            : `可读写 · sudo(${daemon.runAs})`}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-500">
                          未检测
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => (daemon?.elevate === "none" ? handleRefreshPrivileges() : loadDaemon())}
                        disabled={daemonLoading}
                        title={daemon?.elevate === "none" ? "重新检测写入权限" : "重新读取 daemon.json"}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50"
                      >
                        <RefreshCw size={12} className={daemonLoading ? "animate-spin" : ""} />
                        {daemon?.elevate === "none" ? "重新检测权限" : "刷新"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setAskRestart(true)}
                        disabled={restarting || !daemon?.canRestart}
                        title="重启 Docker 使 daemon.json 生效"
                        className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-amber-500 rounded hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Power size={12} /> 重启 Docker
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 mb-3">
                    直接读写宿主机{" "}
                    <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px]">
                      {daemon?.path || "/etc/docker/daemon.json"}
                    </code>{" "}
                    的 registry-mirrors：打开页面时以文件内容为准回读，点 APPLY 保存时写回文件（保留其它配置项）。
                    <span className="text-amber-600"> 修改后需重启 Docker 才会生效。</span>
                  </p>

                  {daemon?.error && (
                    <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                      读取失败：{daemon.error}
                    </div>
                  )}
                  {daemon?.parseError && (
                    <div className="mb-3 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                      {daemon.parseError}。为避免破坏配置，保存时将跳过该文件。
                    </div>
                  )}
                  {daemon && daemon.exists === false && daemon.elevate !== "none" && (
                    <div className="mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                      文件尚不存在，保存时会自动创建（需要 /etc/docker 目录可写）。
                    </div>
                  )}
                  {daemon?.elevate === "none" && (
                    <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-xs font-medium text-amber-800 mb-1">
                        当前无法写入 /etc/docker/daemon.json
                      </p>
                      <p className="text-xs text-amber-700">
                        服务以 <b>{daemon.runAs}</b> 运行，且没有可用的免密 sudo。应用设置本身仍可正常保存，仅 daemon.json 不会同步。授权后点「重新检测权限」：
                      </p>
                      {daemon.hint && (
                        <>
                          <pre className="mt-2 p-2 bg-white border border-amber-200 rounded text-[11px] font-mono text-slate-700 overflow-x-auto whitespace-pre">
                            {daemon.hint}
                          </pre>
                          <button
                            type="button"
                            onClick={() => navigator.clipboard?.writeText(daemon.hint || "")}
                            className="mt-1.5 text-xs text-blue-600 hover:underline"
                          >
                            复制命令
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {mirrors.map((m, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => onMirrorDragOver(i, e)}
                      onDragEnd={() => setDragIdx(null)}
                      className={`flex items-center gap-2 mb-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 ${dragIdx === i ? "opacity-50 ring-2 ring-blue-300" : ""}`}
                    >
                      <GripVertical size={16} className="cursor-move text-slate-300 shrink-0" />
                      <span className="text-[11px] text-slate-400 shrink-0 w-4 text-center select-none">{i + 1}</span>
                      <Input
                        value={m}
                        onChange={(val) => updateMirrorAt(i, val)}
                        placeholder="例如 docker.m.daocloud.io"
                        className="flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => removeMirror(i)}
                        className="shrink-0 p-1 text-slate-400 hover:text-red-500"
                        title="删除"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addMirror()}
                    className="mt-1 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <Plus size={14} /> 添加加速源
                  </button>

                  {/* 推荐加速源：实测可用的公益 Docker Hub 代理，一键填入 */}
                  <div className="mt-3 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-xs font-medium text-blue-800">推荐加速源（Docker Hub 代理，2026-08 实测可用）</p>
                      <button
                        type="button"
                        onClick={addRecommendedMirrors}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700"
                      >
                        <Zap size={12} /> 一键填入
                      </button>
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-blue-700 font-mono">
                      {RECOMMENDED_MIRRORS.map((r) => (
                        <li key={r.url}>
                          {r.url}
                          <span className="ml-1 font-sans text-blue-500">{r.label}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-blue-600 mt-1">
                      注：fnnas 等只镜像私有仓库的源不会代理 Docker Hub，请勿置于优先位；网易 hub-mirror.c.163.com 已于 2026 停止同步 Docker Hub。
                    </p>
                  </div>

                  {daemon && daemon.otherKeys.length > 0 && (
                    <p className="mt-2 text-[11px] text-slate-400">
                      daemon.json 中其它配置项（写入时原样保留）：{daemon.otherKeys.join("、")}
                    </p>
                  )}

                  {/* 旧版镜像名改写（可选） */}
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-medium text-slate-700">拉取时改写镜像名（旧版兼容）</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                          把 nginx:latest 改写成 &lt;加速源&gt;/library/nginx:latest 再拉取。默认关闭——加速源写入 daemon.json 后由守护进程自动生效。
                          仅当加速源确实是 Docker Hub 的 pull-through 代理（如 daocloud）且需要远程引擎也走该源时才开启；
                          <span className="text-amber-600">只镜像私有仓库的源（如 fnnas）开启会导致 404</span>。
                        </p>
                      </div>
                      <Toggle
                        active={data.docker.rewriteImageNames === true}
                        onChange={(val) => update("docker", "rewriteImageNames", val)}
                      />
                    </div>

                    {data.docker.rewriteImageNames === true && mirrors.filter((m) => m.trim()).length > 0 && (
                      <div className="mt-3 p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <p className="text-xs text-slate-500 mb-1">改写效果预览（按当前顺序尝试）：</p>
                        <div className="space-y-1 font-mono text-[11px] text-slate-600">
                          {mirrors.filter((m) => m.trim()).map((m) => {
                            const c = m.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
                            return (
                              <div key={c}>
                                <div>qdnas/flatnas:latest → {`${c}/qdnas/flatnas:latest`}</div>
                                <div>nginx:latest → {`${c}/library/nginx:latest`}</div>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-xs text-amber-600 mt-1.5">
                          注意：已自带仓库域名（如 ghcr.io/xxx）的镜像名不会被改写；所有源失败会回退到原镜像名。
                        </p>
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </Card>
          </div>
        )}

        {activeSection === "user" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">用户与权限</h2>
              <p className="text-sm text-slate-500">管理员账号配置</p>
            </div>

            <Card title="管理员账号" icon={<User size={16} />}>
              <div className="space-y-4">
                <FormField label="用户名" hint="管理员账号为系统内置，不可修改">
                  <Input value={data.user.username} onChange={() => {}} disabled />
                </FormField>
              </div>
            </Card>
          </div>
        )}

        {activeSection === "columns" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">列显隐默认值</h2>
              <p className="text-sm text-slate-500">设置各页面表格的默认可见列</p>
            </div>

            {(["containers", "images", "volumes"] as const).map((page) => {
              const allColumns: Record<string, { key: string; label: string }[]> = {
                containers: [
                  { key: "icon", label: "图标" },
                  { key: "name", label: "容器名称" },
                  { key: "status", label: "状态" },
                  { key: "image", label: "镜像" },
                  { key: "ports", label: "端口映射" },
                  { key: "uptime", label: "运行时长" },
                  { key: "restartPolicy", label: "重启策略" },
                  { key: "actions", label: "操作" },
                ],
                images: [
                  { key: "repository", label: "仓库名" },
                  { key: "tag", label: "标签" },
                  { key: "id", label: "镜像 ID" },
                  { key: "size", label: "大小" },
                  { key: "createdAt", label: "创建时间" },
                  { key: "associatedContainers", label: "关联容器" },
                  { key: "sha256", label: "SHA-256" },
                  { key: "actions", label: "操作" },
                ],
                volumes: [
                  { key: "name", label: "卷名称" },
                  { key: "driver", label: "驱动" },
                  { key: "mountpoint", label: "挂载点" },
                  { key: "size", label: "大小" },
                  { key: "createdAt", label: "创建时间" },
                  { key: "associatedContainers", label: "关联容器" },
                  { key: "inUse", label: "使用中" },
                  { key: "actions", label: "操作" },
                ],
              };

              const pageLabel: Record<string, string> = { containers: "容器管理", images: "镜像管理", volumes: "数据卷管理" };
              const current = data.columnVisibility?.[page] || allColumns[page].map(c => c.key);

              const toggleCol = (key: string) => {
                const next = current.includes(key)
                  ? current.filter((k: string) => k !== key)
                  : [...current, key];
                setData({
                  ...data,
                  columnVisibility: { ...data.columnVisibility, [page]: next },
                });
              };

              return (
                <Card key={page} title={pageLabel[page]} icon={<Columns size={16} />}>
                  <div className="grid grid-cols-4 gap-2">
                    {allColumns[page].map((col) => {
                      const checked = current.includes(col.key);
                      return (
                        <label
                          key={col.key}
                          className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition-colors ${
                            checked
                              ? "bg-blue-50 border-blue-200 text-blue-700"
                              : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCol(col.key)}
                            className="sr-only"
                          />
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                            checked ? "bg-blue-500 border-blue-500" : "border-slate-300"
                          }`}>
                            {checked && <Check size={10} className="text-white" />}
                          </div>
                          <span className="text-sm">{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {activeSection === "notifications" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">通知配置</h2>
              <p className="text-sm text-slate-500">容器异常、更新完成等事件推送通知</p>
            </div>

            <Card title="Webhook 通知" icon={<Webhook size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用 Webhook 推送</span>
                  <Toggle active={data.notifications.webhookEnabled} onChange={(val) => update("notifications", "webhookEnabled", val)} />
                </div>
                {data.notifications.webhookEnabled && (
                  <FormField label="Webhook URL">
                    <Input value={data.notifications.webhookUrl} onChange={(val) => update("notifications", "webhookUrl", val)} placeholder="https://hooks.slack.com/..." />
                  </FormField>
                )}
              </div>
            </Card>

            <Card title="邮件通知" icon={<Mail size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用邮件推送</span>
                  <Toggle active={data.notifications.emailEnabled} onChange={(val) => update("notifications", "emailEnabled", val)} />
                </div>
                {data.notifications.emailEnabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="SMTP 服务器">
                      <Input value={data.notifications.emailSmtp} onChange={(val) => update("notifications", "emailSmtp", val)} placeholder="smtp.gmail.com" />
                    </FormField>
                    <FormField label="端口">
                      <Input value={String(data.notifications.emailPort)} onChange={(val) => update("notifications", "emailPort", parseInt(val) || 587)} type="number" />
                    </FormField>
                    <FormField label="用户名">
                      <Input value={data.notifications.emailUser} onChange={(val) => update("notifications", "emailUser", val)} />
                    </FormField>
                    <FormField label="密码">
                      <Input value="" onChange={() => {}} type="password" placeholder="••••••••" />
                    </FormField>
                  </div>
                )}
              </div>
            </Card>

            <Card title="通知事件" icon={<Bell size={16} />}>
              <div className="space-y-3">
                {[
                  { key: "containerDown", label: "容器停止/异常" },
                  { key: "updateAvailable", label: "检测到可用更新" },
                  { key: "updateComplete", label: "更新完成" },
                  { key: "buildFailed", label: "构建失败" },
                ].map((evt) => (
                  <div key={evt.key} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{evt.label}</span>
                    <Toggle
                      active={data.notifications.events[evt.key as keyof typeof data.notifications.events]}
                      onChange={(val) => update("notifications", "events", { ...data.notifications.events, [evt.key]: val })}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {activeSection === "backup" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">备份管理</h2>
              <p className="text-sm text-slate-500">堆栈配置与数据卷的备份与恢复，支持三级备份策略</p>
            </div>

            {/* 备份模式选择 */}
            <Card title="备份模式" icon={<Archive size={16} />}>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => update("backup", "mode", 1)}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all ${
                    data.backup.mode === 1 ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${data.backup.mode === 1 ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    <Archive size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">模式 1：三级备份策略</p>
                    <p className="text-xs text-slate-400 mt-0.5">周备 + 月备 + 年备，全量备份</p>
                  </div>
                </button>
                <button
                  onClick={() => update("backup", "mode", 2)}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 text-left transition-all ${
                    data.backup.mode === 2 ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${data.backup.mode === 2 ? "bg-blue-500 text-white" : "bg-slate-100 text-slate-500"}`}>
                    <Clock size={20} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">模式 2：简单备份</p>
                    <p className="text-xs text-slate-400 mt-0.5">按 Cron 定时，固定保留份数</p>
                  </div>
                </button>
              </div>
            </Card>

            {/* 备份路径与开关 */}
            <Card title="备份设置" icon={<HardDrive size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用定时自动备份</span>
                  <Toggle active={data.backup.autoBackupEnabled} onChange={(val) => update("backup", "autoBackupEnabled", val)} />
                </div>
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-xs text-slate-500">上次备份时间</span>
                  <span className="text-xs font-medium text-slate-600 ml-auto">{data.backup.lastBackup}</span>
                </div>
              </div>
            </Card>

            {/* 模式 1：三级备份策略 */}
            {data.backup.mode === 1 && (
              <>
                <Card title="每周备份（周备）" icon={<Calendar size={16} />} actions={
                  <Toggle active={data.backup.weekly.enabled} onChange={(val) => update("backup", "weekly", { ...data.backup.weekly, enabled: val })} size="sm" />
                }>
                  {data.backup.weekly.enabled && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-500 bg-blue-50 rounded-lg p-3 border border-blue-100">
                        每周执行 1 次全量备份，用于近期数据误删、修改回滚。保留 {data.backup.weekly.retention} 份，到期自动清理。
                      </p>
                      <div className="grid grid-cols-3 gap-4">
                        <FormField label="执行日期">
                          <Select
                            value={data.backup.weekly.day}
                            onChange={(val) => update("backup", "weekly", { ...data.backup.weekly, day: val })}
                            options={[
                              { value: "Monday", label: "周一" },
                              { value: "Tuesday", label: "周二" },
                              { value: "Wednesday", label: "周三" },
                              { value: "Thursday", label: "周四" },
                              { value: "Friday", label: "周五" },
                              { value: "Saturday", label: "周六" },
                              { value: "Sunday", label: "周日" },
                            ]}
                          />
                        </FormField>
                        <FormField label="执行时间">
                          <Input value={data.backup.weekly.time} onChange={(val) => update("backup", "weekly", { ...data.backup.weekly, time: val })} placeholder="23:00" className="font-mono" />
                        </FormField>
                        <FormField label="保留份数" hint="4 ~ 8 份">
                          <Input
                            value={String(data.backup.weekly.retention)}
                            onChange={(val) => update("backup", "weekly", { ...data.backup.weekly, retention: Math.min(Math.max(parseInt(val) || 6, 4), 8) })}
                            type="number"
                            className="font-mono"
                          />
                        </FormField>
                      </div>
                    </div>
                  )}
                  {!data.backup.weekly.enabled && <p className="text-sm text-slate-400 py-2">已禁用</p>}
                </Card>

                <Card title="每月备份（月备）" icon={<Calendar size={16} />} actions={
                  <Toggle active={data.backup.monthly.enabled} onChange={(val) => update("backup", "monthly", { ...data.backup.monthly, enabled: val })} size="sm" />
                }>
                  {data.backup.monthly.enabled && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-500 bg-amber-50 rounded-lg p-3 border border-amber-100">
                        每月执行 1 次全量备份，跨月份数据恢复基准。保留 {data.backup.monthly.retention} 份。
                        <span className="font-medium text-amber-600">当月执行月备当天，自动跳过当周周备。</span>
                      </p>
                      <div className="grid grid-cols-3 gap-4">
                        <FormField label="执行日期" hint="0 = 每月最后一天">
                          <Input
                            value={String(data.backup.monthly.dayOfMonth)}
                            onChange={(val) => update("backup", "monthly", { ...data.backup.monthly, dayOfMonth: parseInt(val) || 0 })}
                            type="number"
                            className="font-mono"
                          />
                        </FormField>
                        <FormField label="执行时间">
                          <Input value={data.backup.monthly.time} onChange={(val) => update("backup", "monthly", { ...data.backup.monthly, time: val })} placeholder="23:00" className="font-mono" />
                        </FormField>
                        <FormField label="保留份数" hint="6 ~ 12 份">
                          <Input
                            value={String(data.backup.monthly.retention)}
                            onChange={(val) => update("backup", "monthly", { ...data.backup.monthly, retention: Math.min(Math.max(parseInt(val) || 8, 6), 12) })}
                            type="number"
                            className="font-mono"
                          />
                        </FormField>
                      </div>
                    </div>
                  )}
                  {!data.backup.monthly.enabled && <p className="text-sm text-slate-400 py-2">已禁用</p>}
                </Card>

                <Card title="每年备份（年备）" icon={<InfinityIcon size={16} />} actions={
                  <Toggle active={data.backup.yearly.enabled} onChange={(val) => update("backup", "yearly", { ...data.backup.yearly, enabled: val })} size="sm" />
                }>
                  {data.backup.yearly.enabled && (
                    <div className="space-y-4">
                      <p className="text-xs text-slate-500 bg-green-50 rounded-lg p-3 border border-green-100">
                        每年执行 1 次全量备份，长期归档。
                        <span className="font-medium text-green-600">永久保存，不自动删除。</span>
                        <span className="text-slate-500">执行年备当天，自动跳过当月月备。</span>
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField label="执行日期" hint="月-日格式，默认 12-31">
                          <Input value={data.backup.yearly.date} onChange={(val) => update("backup", "yearly", { ...data.backup.yearly, date: val })} placeholder="12-31" className="font-mono" />
                        </FormField>
                        <FormField label="执行时间">
                          <Input value={data.backup.yearly.time} onChange={(val) => update("backup", "yearly", { ...data.backup.yearly, time: val })} placeholder="23:00" className="font-mono" />
                        </FormField>
                      </div>
                    </div>
                  )}
                  {!data.backup.yearly.enabled && <p className="text-sm text-slate-400 py-2">已禁用</p>}
                </Card>

                {/* 三级策略时序总览 */}
                <Card title="执行时序总览" icon={<Clock size={16} />}>
                  <div className="space-y-2">
                    <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-lg">
                      <Calendar size={16} className="text-blue-500 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">周备份</span>
                        <span className="text-xs text-slate-500 ml-2">每周{data.backup.weekly.day === "Saturday" ? "六" : data.backup.weekly.day === "Sunday" ? "日" : data.backup.weekly.day}晚间 {data.backup.weekly.time}</span>
                      </div>
                      <Tag text={`保留 ${data.backup.weekly.retention} 份`} color="blue" />
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg">
                      <Calendar size={16} className="text-amber-500 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">月备份</span>
                        <span className="text-xs text-slate-500 ml-2">每月{data.backup.monthly.dayOfMonth === 0 ? "最后一天" : data.backup.monthly.dayOfMonth + "日"} {data.backup.monthly.time}</span>
                      </div>
                      <Tag text={`保留 ${data.backup.monthly.retention} 份`} color="amber" />
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-green-50 rounded-lg">
                      <InfinityIcon size={16} className="text-green-500 flex-shrink-0" />
                      <div className="flex-1">
                        <span className="text-sm font-medium text-slate-700">年备份</span>
                        <span className="text-xs text-slate-500 ml-2">每年 {data.backup.yearly.date} {data.backup.yearly.time}</span>
                      </div>
                      <Tag text="永久保存" color="green" />
                    </div>
                  </div>
                  <div className="mt-3 p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-500">
                      全量备份模式。当月备与周备冲突时，跳过当周周备；年备与月备冲突时，跳过当月月备，避免重复备份。
                    </p>
                  </div>
                </Card>
              </>
            )}

            {/* 模式 2：简单备份 */}
            {data.backup.mode === 2 && (
              <Card title="简单备份配置" icon={<Clock size={16} />}>
                {data.backup.autoBackupEnabled && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="备份频率" hint="Cron 表达式">
                      <Input value={data.backup.simpleFrequency} onChange={(val) => update("backup", "simpleFrequency", val)} placeholder="0 3 * * 0" className="font-mono" />
                    </FormField>
                    <FormField label="保留份数">
                      <Input value={String(data.backup.simpleRetentionCount)} onChange={(val) => update("backup", "simpleRetentionCount", parseInt(val) || 5)} type="number" className="font-mono" />
                    </FormField>
                  </div>
                )}
                {!data.backup.autoBackupEnabled && <p className="text-sm text-slate-400 py-2">自动备份已关闭</p>}
              </Card>
            )}

            <Card title="备份历史" icon={<Package size={16} />}>
              <div className="space-y-2">
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 font-medium">backup-2026-07-29-weekly.tar.gz</p>
                    <p className="text-xs text-slate-400">{data.backup.lastBackup} • 12.4 MB • <span className="text-blue-500">周备</span></p>
                  </div>
                  <button className="text-slate-400 hover:text-blue-500"><Download size={16} /></button>
                  <button className="text-slate-400 hover:text-green-500"><RefreshCw size={16} /></button>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 font-medium">backup-2026-07-22-weekly.tar.gz</p>
                    <p className="text-xs text-slate-400">2026-07-22 23:00:02 • 11.8 MB • <span className="text-blue-500">周备</span></p>
                  </div>
                  <button className="text-slate-400 hover:text-blue-500"><Download size={16} /></button>
                  <button className="text-slate-400 hover:text-green-500"><RefreshCw size={16} /></button>
                </div>
                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1">
                    <p className="text-sm text-slate-700 font-medium">backup-2026-06-30-monthly.tar.gz</p>
                    <p className="text-xs text-slate-400">2026-06-30 23:00:02 • 15.2 MB • <span className="text-amber-500">月备</span></p>
                  </div>
                  <button className="text-slate-400 hover:text-blue-500"><Download size={16} /></button>
                  <button className="text-slate-400 hover:text-green-500"><RefreshCw size={16} /></button>
                </div>
              </div>
            </Card>

            <Card title="手动操作" icon={<HardDrive size={16} />}>
              <div className="flex items-center gap-3">
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600">
                  <Download size={14} /> 立即备份
                </button>
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                  <Upload size={14} /> 从备份恢复
                </button>
                <button className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                  <Package size={14} /> 导出全部配置
                </button>
              </div>
            </Card>
          </div>
        )}

        {activeSection === "scheduler" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">更新调度器</h2>
              <p className="text-sm text-slate-500">全局自动更新检查频率配置</p>
            </div>

            <Card title="自动更新检查" icon={<RefreshCw size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-600">启用全局自动更新检查</span>
                    <p className="text-xs text-slate-400 mt-0.5">基于 SHA-256 digest 精确比较镜像版本</p>
                  </div>
                  <Toggle active={data.updateScheduler.enabled} onChange={(val) => update("updateScheduler", "enabled", val)} />
                </div>
                {data.updateScheduler.enabled && (
                  <>
                    <FormField label="检查频率" hint="Cron 表达式，默认每天凌晨 3 点">
                      <Input value={data.updateScheduler.checkFrequency} onChange={(val) => update("updateScheduler", "checkFrequency", val)} placeholder="0 3 * * *" />
                    </FormField>
                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <span className="text-sm text-slate-600">自动拉取镜像</span>
                      <Toggle active={data.updateScheduler.autoPull} onChange={(val) => update("updateScheduler", "autoPull", val)} size="sm" />
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
                        <RefreshCw size={14} /> 立即检查全部
                      </button>
                      <span className="text-xs text-slate-400">上次检查: 2026-07-29 03:00:12</span>
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card title="更新统计" icon={<Globe size={16} />}>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-3 bg-blue-50 rounded-lg">
                  <p className="text-2xl font-bold text-blue-600">12</p>
                  <p className="text-xs text-slate-500">已检查镜像</p>
                </div>
                <div className="text-center p-3 bg-amber-50 rounded-lg">
                  <p className="text-2xl font-bold text-amber-600">2</p>
                  <p className="text-xs text-slate-500">有可用更新</p>
                </div>
                <div className="text-center p-3 bg-green-50 rounded-lg">
                  <p className="text-2xl font-bold text-green-600">3</p>
                  <p className="text-xs text-slate-500">已固定 (SHA-256)</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeSection === "update" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">系统更新</h2>
              <p className="text-sm text-slate-500">应用内一键检查并升级到 GitHub Releases 最新版本（linux-x64 交付包）</p>
            </div>

            {/* 当前版本 */}
            <Card title="当前版本" icon={<Download size={16} />}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-600">当前安装版本</p>
                  <p className="text-xs text-slate-400 mt-0.5 break-all">安装目录：{appVersion?.installDir || "—"}</p>
                </div>
                <span className="text-2xl font-bold text-blue-600 font-mono">v{appVersion?.version ?? "..."}</span>
              </div>
            </Card>

            {/* 更新源配置 */}
            <Card title="更新源配置" icon={<Globe size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center gap-2 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                  <Globe size={14} className="text-slate-400 flex-shrink-0" />
                  <div className="text-xs text-slate-600">
                    <span className="text-slate-500">更新源（已固定写死，无需配置）：</span>
                    <span className="font-mono text-slate-700 ml-1">yanziruxue/docker-manager</span>
                    <span className="ml-2 text-green-600">● 公开仓库</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-600">自动检查更新</span>
                    <p className="text-xs text-slate-400 mt-0.5">启动后自动检查 GitHub Releases 是否有新版本</p>
                  </div>
                  <Toggle active={data.update?.autoCheck ?? false} onChange={(val) => update("update", "autoCheck", val)} />
                </div>
              </div>
            </Card>

            {/* 检查与升级 */}
            <Card title="检查更新" icon={<RefreshCw size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={checking}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {checking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {checking ? "检查中..." : "检查更新"}
                  </button>
                  {updateInfo && !updateInfo.hasUpdate && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <Check size={14} /> 已是最新版本
                    </span>
                  )}
                </div>

                {updateInfo && updateInfo.hasUpdate && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-700">
                          发现新版本 v{updateInfo.latestVersion}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          当前 v{updateInfo.currentVersion} → 最新 v{updateInfo.latestVersion}
                          {updateInfo.assetSize > 0 && `（${(updateInfo.assetSize / 1024 / 1024).toFixed(1)} MB）`}
                        </p>
                      </div>
                      <button
                        onClick={handleApplyUpdate}
                        disabled={updateInProgress}
                        className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed flex-shrink-0"
                      >
                        {updateInProgress ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                        {updateInProgress ? "升级中..." : "一键升级"}
                      </button>
                    </div>
                    {updateInfo.releaseNotes && (
                      <div>
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Release 说明</p>
                        <pre className="text-xs text-slate-600 whitespace-pre-wrap bg-white border border-slate-200 rounded-lg p-3 max-h-48 overflow-y-auto font-sans">
                          {updateInfo.releaseNotes}
                        </pre>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{updateInfo.publishedAt ? `发布于 ${updateInfo.publishedAt}` : ""}</span>
                      {updateInfo.htmlUrl && (
                        <a href={updateInfo.htmlUrl} target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">
                          查看发布页 ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {updateState && updateState.phase !== "idle" && (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {updateState.phase === "done" ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">完成</span>
                        ) : updateState.phase === "error" ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">失败</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">升级中</span>
                        )}
                        <span className={`text-sm ${updateState.phase === "error" ? "text-red-500" : updateState.phase === "done" ? "text-green-600" : "text-slate-700"}`}>
                          {updateState.message}
                        </span>
                      </div>
                      <span className="text-sm font-mono font-semibold text-slate-600">{updateState.percent}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${updateState.phase === "error" ? "bg-red-500" : "bg-blue-500"}`}
                        style={{ width: `${updateState.percent}%` }}
                      />
                    </div>
                    {updateState.phase === "error" && updateState.error && (
                      <p className="text-xs text-red-500">{updateState.error}</p>
                    )}
                    {updateState.phase === "done" && (
                      <p className="text-xs text-green-600">升级完成，服务即将自动重启...</p>
                    )}
                  </div>
                )}

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500 leading-relaxed">
                  <p className="font-medium mb-1">升级说明</p>
                  <p>升级会下载交付包、解压并用新二进制覆盖当前安装文件，随后服务自动重启（由 systemd 拉起新版本）。整个过程无需 root 权限，升级前会自动备份旧版本。</p>
                </div>
              </div>
            </Card>
          </div>
        )}

        {/* 加速源写回后询问是否重启 Docker */}
        <ConfirmDialog
          open={askRestart}
          onClose={() => setAskRestart(false)}
          onConfirm={doRestartDocker}
          title="重启 Docker 服务"
          message="镜像加速源已写入 /etc/docker/daemon.json，需要重启 Docker 才会生效。重启期间运行中的容器默认不会停止，但管理面板会有几秒无法连接。是否立即重启？"
          confirmText="是，立即重启"
          cancelText="稍后自行重启"
          loading={restarting}
        />

        {/* 无权限写入时的修复建议 */}
        {privilegeHint && (
          <Modal open onClose={() => setPrivilegeHint(null)} title="写入 /etc/docker/daemon.json 失败" size="md">
            <p className="text-sm text-slate-600 mb-3">
              应用设置已保存，但加速源未能写入 daemon.json。请按以下步骤授权后重试：
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-green-300 rounded-lg p-4 overflow-auto max-h-[50vh] whitespace-pre">
              {privilegeHint}
            </pre>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => navigator.clipboard?.writeText(privilegeHint)}
                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
              >
                复制命令
              </button>
              <button
                onClick={() => { setPrivilegeHint(null); handleRefreshPrivileges(); }}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
              >
                我已配置，重新检测
              </button>
            </div>
          </Modal>
        )}

        {/* 重启 Docker 的命令输出（tail 文本） */}
        <CmdOutputModal data={cmdOutput} onClose={closeOutput} />

        {/* Save Button (Unraid-style status bar) */}
        <div className="sticky bottom-0 flex justify-end items-center gap-3 -mx-6 px-6 py-2.5 mt-6 bg-slate-50 border-t border-slate-200">
          {toast && (
            <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm ${
              toast.type === "success"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}>
              {toast.type === "success" ? <Check size={16} /> : <AlertCircle size={16} />}
              <span>{toast.message}</span>
            </div>
          )}
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-5 py-1.5 text-xs font-semibold tracking-wider text-white bg-green-600 rounded hover:bg-green-700 transition-colors"
          >
            <Save size={14} /> APPLY
          </button>
        </div>
      </div>
    </div>
  );
}

