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
  Gauge,
  Timer,
  EyeOff,
  Languages,
  Tags as TagsIcon,
  FileCode2,
  KeyRound,
  LogOut,
  ShieldCheck,
  ShieldAlert,
  Radio,
  Copy as CopyIcon,
  Send,
} from "lucide-react";
import type { SystemSettings, BackupMode, DockerEngine, UpdateInfo, UpdateState, ResourceTag, ComposeTemplate } from "../types";
import { Card, FormField, Input, Select, Toggle, IconButton } from "../components/UI";
import { ActivityPanel, DEFAULT_TELEMETRY } from "../components/ActivityPanel";
import type { TelemetryConfig, SchedulerStatus } from "../types";
import { COMPOSE_INSERT_OPTIONS, normalizeInsert } from "../lib/compose-template";
import {
  changeMyPassword,
  getRecoveryStatus,
  setRecoveryCode,
  clearRecoveryCode,
  type AuthUser,
  type RecoveryStatus,
} from "../api";
import { sanitizeRecoveryInput, validateRecoveryCode, RECOVERY_LENGTH } from "../lib/recovery-code";
import { Tag } from "../components/Badge";
import { TAG_PALETTE, TagChip, normalizeTagColor, hexWithAlpha, randomTagColor, hexToRgb, rgbToHex } from "../components/TagPicker";
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
  uploadUpdateZipApi,
  fetchPendingUploadApi,
  applyLocalUpdateApi,
  discardPendingUploadApi,
  fetchUpdateStatusApi,
  fetchBackupsApi,
  deleteBackupApi,
  type BackupFileInfo,
  fetchTelemetryStatus,
  type TelemetryStatus,
  getSchedulerStatusApi,
  runSchedulerCheckApi,
} from "../api";

/** 字节/秒 → 人类可读速度；0/无效值返回空串 */
function formatSpeed(bps?: number): string {
  if (!bps || bps <= 0) return "";
  if (bps >= 1024 * 1024) return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  return `${Math.round(bps / 1024)} KB/s`;
}

/** 剩余秒数 → 中文时长；未测出（null/undefined）返回空串 */
function formatEta(sec?: number | null): string {
  if (sec === undefined || sec === null) return "";
  if (sec < 1) return "即将完成";
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m} 分 ${s} 秒` : `${m} 分`;
}

/** ISO 时间 → 本地 "YYYY-MM-DD HH:mm" */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 剩余毫秒 → mm:ss 倒计时（如 09:59）；负数或无效值归零显示 00:00 */
function formatCountdown(ms: number): string {
  if (!isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

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
    updateScheduler: { enabled: true, mode: "daily", hour: 1, minute: 0, dayOfWeek: 1, dayOfMonth: 1, autoPull: false },
    user: { sessionTimeout: 30 },
    telemetry: {
      enabled: true,
      endpoint: "https://docker.yanziruxue.top/api/telemetry/ingest",
      collectHwFingerprint: true,
    },
    update: { autoCheck: false, autoUpdate: false, ignoredVersion: "" },
    columnVisibility: {
      containers: ["icon","name","status","tags","ports","actions"],
      images: ["repository","tag","id","size","createdAt","associatedContainers","actions"],
      volumes: ["name","mountpoint","size","createdAt","associatedContainers","actions"],
      stacks: ["name","status","network","ip","ports","update"],
      stackList: ["icon","name","status","tags","containers","uptime","update"],
    },
    tags: [],
    modal: {
      autoCloseDelay: 5,
    },
    compose: {
      templates: [
        { content: "network_mode: ", insert: "services" },
        { content: "restart: ", insert: "services" },
        { content: "container_name: ", insert: "services" },
      ],
    },
    defaultsVersion: 2,
  };
}

interface SettingsProps {
  settings?: SystemSettings;
  activeEngineId: string;
  engines: DockerEngine[];
  onActiveEngineChange: (engineId: string) => void;
  onEnginesChange: (engines: DockerEngine[]) => void;
  onSaveSettings?: (settings: SystemSettings) => Promise<void>;
  /** 更新可用状态变化时回传，用于同步全局侧边栏「系统设置」角标 */
  onUpdateAvailableChange?: (available: boolean) => void;
  /** 当前登录用户（用于「用户」区块展示与改密） */
  currentUser?: AuthUser | null;
}

/** 「用户」区块：修改当前登录账户密码（单管理员，需校验原密码） */
function ChangePasswordForm({ username }: { username?: string }) {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    setSuccess(false);
    if (!oldPassword) {
      setError("请输入原密码");
      return;
    }
    if (newPassword.length < 6) {
      setError("新密码至少 6 位");
      return;
    }
    if (newPassword !== confirm) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await changeMyPassword(oldPassword, newPassword);
      setSuccess(true);
      setOldPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (e: any) {
      setError(e?.message || "修改密码失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <FormField label="原密码" required>
          <Input value={oldPassword} onChange={setOldPassword} type="password" placeholder="••••••••" />
        </FormField>
        <FormField label="新密码" required hint="至少 6 位">
          <Input value={newPassword} onChange={setNewPassword} type="password" placeholder="••••••••" />
        </FormField>
        <FormField label="确认新密码" required>
          <Input value={confirm} onChange={setConfirm} type="password" placeholder="••••••••" />
        </FormField>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
      )}
      {success && (
        <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
          密码已更新
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} 修改密码
        </button>
      </div>
    </div>
  );
}

/** 「用户」区块：18 位密码找回码管理（服务端仅存哈希，明文不可回显） */
function RecoveryCodeForm() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getRecoveryStatus());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    setError(null);
    setSuccess(null);
    const fmtErr = validateRecoveryCode(code);
    if (fmtErr) {
      setError(fmtErr);
      return;
    }
    if (!password) {
      setError("请输入当前密码");
      return;
    }
    setBusy(true);
    try {
      await setRecoveryCode(code, password);
      setSuccess("找回码已更新，请妥善保存");
      setCode("");
      setPassword("");
      await load();
    } catch (e: any) {
      setError(e?.message || "设置找回码失败");
    } finally {
      setBusy(false);
    }
  };

  const doClear = async () => {
    setError(null);
    setSuccess(null);
    setBusy(true);
    try {
      await clearRecoveryCode();
      setSuccess("已清除找回码");
      setConfirmClear(false);
      await load();
    } catch (e: any) {
      setError(e?.message || "清除失败");
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("zh-CN") : "—");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {status?.hasRecovery ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-50 text-green-700 rounded-full border border-green-100">
            <ShieldCheck size={11} /> 已设置
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full border border-amber-100">
            <ShieldAlert size={11} /> 未设置
          </span>
        )}
        <span className="text-slate-400">设置时间：{fmt(status?.setAt ?? null)}</span>
        <span className="text-slate-400">上次使用：{fmt(status?.lastUsedAt ?? null)}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={`新找回码（${RECOVERY_LENGTH} 位）`}
          required
          hint="仅字母和数字，忽略大小写"
        >
          <div className="relative">
            <Input
              value={code}
              onChange={(v) => setCode(sanitizeRecoveryInput(v))}
              placeholder={`${RECOVERY_LENGTH} 位字母或数字`}
              className="pr-12 font-mono tracking-wider"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums pointer-events-none">
              {code.length}/{RECOVERY_LENGTH}
            </span>
          </div>
        </FormField>
        <FormField label="当前密码" required hint="敏感操作，需二次验证">
          <Input
            value={password}
            onChange={setPassword}
            type="password"
            placeholder="••••••••"
          />
        </FormField>
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {success && (
        <div className="text-xs text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
          {success}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={submit}
          disabled={busy}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
        >
          {busy && <Loader2 size={14} className="animate-spin" />} 保存找回码
        </button>
        {status?.hasRecovery && (
          <button
            onClick={() => setConfirmClear(true)}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-60"
          >
            <Trash2 size={14} /> 清除
          </button>
        )}
        <span className="text-xs text-slate-400">
          找回码仅以哈希存储，无法在此查看；忘记密码时可在登录页用它重置
        </span>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        onConfirm={doClear}
        title="清除找回码"
        message="清除后将无法通过找回码重置密码，只能重新设置。确认清除？"
        confirmText="清除"
        danger
        loading={busy}
      />
    </div>
  );
}

export function Settings({ settings, activeEngineId, engines, onActiveEngineChange, onEnginesChange, onSaveSettings, onUpdateAvailableChange, currentUser }: SettingsProps) {
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

  // 更新调度器状态（进入调度器页时轮询）
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const s = await getSchedulerStatusApi();
        if (alive) setSchedulerStatus(s);
      } catch {
        /* 忽略轮询错误 */
      }
    };
    if (activeSection === "scheduler") {
      load();
      const t = setInterval(load, 30000);
      return () => {
        alive = false;
        clearInterval(t);
      };
    }
    return () => {
      alive = false;
    };
  }, [activeSection]);

  const handleRunCheck = async () => {
    setCheckingNow(true);
    try {
      const r = await runSchedulerCheckApi();
      setSchedulerStatus((prev) => (prev ? { ...prev, lastResult: r, lastCheck: r.at, running: false } : prev));
      setToast({ type: "success", message: `检查完成：检查 ${r.checked} 个，发现 ${r.updates} 个有可用更新` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "检查失败" });
    } finally {
      setCheckingNow(false);
    }
  };

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

  // ============ 备份历史（DATA_DIR/backups 真实文件列表，可删除） ============
  const [backups, setBackups] = useState<BackupFileInfo[] | null>(null);
  const [backupsLoading, setBackupsLoading] = useState(false);
  // 待确认删除的备份文件名（非空即弹出确认框）
  const [deletingBackup, setDeletingBackup] = useState<string | null>(null);
  const [backupDeleting, setBackupDeleting] = useState(false);
  const [backupDeleteError, setBackupDeleteError] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    setBackupsLoading(true);
    try {
      setBackups(await fetchBackupsApi());
    } catch {
      setBackups([]);
    } finally {
      setBackupsLoading(false);
    }
  }, []);

  // 切到「备份管理」Section 时加载备份列表
  useEffect(() => {
    if (activeSection === "backup") loadBackups();
  }, [activeSection, loadBackups]);

  const handleDeleteBackup = async () => {
    if (!deletingBackup) return;
    setBackupDeleting(true);
    setBackupDeleteError(null);
    try {
      await deleteBackupApi(deletingBackup);
      setDeletingBackup(null);
      loadBackups();
    } catch (e: any) {
      setBackupDeleteError(e.message || "删除失败");
    } finally {
      setBackupDeleting(false);
    }
  };

  /** 备份文件名 -> 堆栈名（去掉末尾 _YYYY-MM-DDTHH-MM-SS 与 .tar.gz） */
  const backupStackName = (name: string) =>
    name.replace(/\.tar\.gz$/, "").replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, "");

  /** 字节数 -> 人类可读（备份文件粒度用 1 位小数即可） */
  const fmtBackupSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

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
  // 上传更新包：隐藏的 file input + 应用中的禁用态
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // 已上传、待应用的本地更新包（上传后仅保存，需手动点击「更新」按钮才执行）
  // expiresAt/ttlMs 来自后端，用于前端倒计时显示与到期自动丢弃
  const [pendingUpload, setPendingUpload] = useState<{ fileName: string; size: number; uploadedAt: string; ttlMs?: number; expiresAt?: string } | null>(null);
  // 每秒心跳，驱动待应用包倒计时刷新；仅当有待应用包时启动
  const [nowTick, setNowTick] = useState(() => Date.now());
  // 后台更新进行中（下载/解压/替换阶段）：按钮据此保持禁用并显示「升级中…」
  const updateInProgress =
    updateState?.phase === "downloading" ||
    updateState?.phase === "extracting" ||
    updateState?.phase === "replacing";

  // 进入页面时获取当前版本号；并查询是否已有上传待应用的更新包（刷新/重进后可恢复提示）
  useEffect(() => {
    fetchAppVersion().then(setAppVersion).catch(() => {});
    fetchPendingUploadApi()
      .then((d) => {
        if (d?.exists && d.fileName && d.size != null && d.uploadedAt) {
          setPendingUpload({ fileName: d.fileName, size: d.size, uploadedAt: d.uploadedAt, ttlMs: d.ttlMs, expiresAt: d.expiresAt });
        }
      })
      .catch(() => {});
  }, []);

  // 待应用包倒计时：每秒刷新 nowTick，驱动页面上 mm:ss 显示
  useEffect(() => {
    if (!pendingUpload?.expiresAt) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [pendingUpload]);

  // 倒计时归零（且未在更新中）→ 自动丢弃待应用包并清状态
  useEffect(() => {
    if (!pendingUpload?.expiresAt || updateInProgress) return;
    if (new Date(pendingUpload.expiresAt).getTime() - nowTick <= 0) {
      handleDiscardPending();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowTick, pendingUpload, updateInProgress]);

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
            // 更新完成：清除「系统更新」可用角标（含全局侧边栏）
            if (st.phase === "done") {
              setUpdateInfo(null);
              onUpdateAvailableChange?.(false);
              // 更新已完成：后端进程即将退出并由 systemd 拉起新二进制，
              // 等待其重新上线后自动刷新页面，确保前端 bundle 同步到新版。
              waitForRestartAndReload();
            }
          }
        })
        .catch(() => {
          // 进程已退出重启，忽略连接错误
        });
    }, 1500);
  };

  // 更新完成后自动刷新页面：两阶段监听 /system/version
  // 1) 先等其失联（旧进程已退出）2) 再等其恢复响应（新进程已起）→ 刷新加载新前端
  const waitForRestartAndReload = () => {
    setUpdateState((prev) =>
      prev ? { ...prev, message: "升级完成，等待服务重启…" } : prev
    );
    let sawDown = false; // 是否已观测到旧进程失联
    let attempts = 0; // 旧进程仍在线时的轮询次数上限
    const tick = () => {
      fetchAppVersion()
        .then(() => {
          if (sawDown) {
            // 新服务已重新响应 → 刷新加载新前端 bundle
            window.location.reload();
            return;
          }
          // 仍是旧进程在响应（尚未退出），继续等待
          attempts += 1;
          if (attempts >= 30) {
            // 30s 内旧进程仍未退出（异常），直接刷新尝试，避免卡死
            window.location.reload();
            return;
          }
          setTimeout(tick, 1000);
        })
        .catch(() => {
          // 旧进程已失联，进入「等待新进程上线」阶段
          sawDown = true;
          setTimeout(tick, 1000);
        });
    };
    setTimeout(tick, 1000);
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
      onUpdateAvailableChange?.(info.hasUpdate);
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

  /** 忽略当前检测到的版本：写入 ignoredVersion，角标与提示立即消失 */
  const handleIgnoreUpdate = () => {
    if (!updateInfo) return;
    update("update", "ignoredVersion", updateInfo.latestVersion);
    setUpdateInfo(null);
    onUpdateAvailableChange?.(false);
  };

  /** 恢复被忽略版本的更新提示：清除 ignoredVersion */
  const handleRestoreUpdateNotice = () => {
    update("update", "ignoredVersion", "");
  };

  /** 上传本地 zip 更新包：仅保存为待应用包，不立即执行（执行需手动点击「更新」） */
  const handleUploadUpdate = async (file: File) => {
    if (updateInProgress) return;
    setUploading(true);
    // 清除旧进度显示，避免与待应用提示混淆
    setUpdateState(null);
    try {
      await uploadUpdateZipApi(file);
      // 重新拉取完整 pending（含 expiresAt/ttlMs），保证倒计时起点准确
      const d = await fetchPendingUploadApi();
      if (d?.exists && d.fileName && d.size != null && d.uploadedAt) {
        setPendingUpload({ fileName: d.fileName, size: d.size, uploadedAt: d.uploadedAt, ttlMs: d.ttlMs, expiresAt: d.expiresAt });
      }
      setToast({ type: "success", message: "更新包已上传，2 分钟内点击「更新」应用，超时自动销毁" });
    } catch (err: any) {
      const msg = String(err?.message || err || "未知错误");
      setToast({ type: "error", message: msg });
    } finally {
      setUploading(false);
    }
  };

  /** 主动丢弃待应用包（手动「丢弃」按钮或倒计时归零触发）：通知后端删除并清本地状态 */
  const handleDiscardPending = async () => {
    if (!pendingUpload) return;
    setPendingUpload(null);
    setNowTick(Date.now());
    try {
      await discardPendingUploadApi();
    } catch {
      /* 忽略：本地状态已清空，最差情况是服务端文件残留，下次上传会覆盖 */
    }
  };

  /** 手动应用已上传的本地更新包（点击「更新」按钮触发），进度复用同一套轮询 UI */
  const handleApplyLocalUpdate = async () => {
    if (!pendingUpload || updateInProgress) return;
    // 立即给出乐观状态并启动轮询：后端 apply-local 接口 fire-and-forget、立即返回
    setUpdateState({ phase: "extracting", message: "正在应用本地更新包...", percent: 50 });
    startUpdatePolling();
    try {
      await applyLocalUpdateApi();
    } catch (err: any) {
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

    // 引擎配置校验
    if (data.docker.pollingInterval < 1) {
      errors.push("引擎配置：轮询间隔不能小于 1 秒");
    }
    if (!data.docker.composeStoragePath.trim()) {
      errors.push("引擎配置：Compose 文件存储路径不能为空");
    }

    // 用户配置校验（用户名由登录账户管理，此处仅校验会话超时）
    if (!(Number(data.user.sessionTimeout) > 0)) {
      errors.push("用户：会话超时必须大于 0 分钟");
    }

    // 活跃度配置校验
    if (data.telemetry?.enabled && !data.telemetry.endpoint?.trim()) {
      errors.push("活跃度：开启时上报地址不能为空");
    }
    if (data.telemetry?.endpoint?.trim()) {
      try {
        const u = new URL(data.telemetry.endpoint.trim());
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          errors.push("活跃度：上报地址必须是 http(s):// 开头");
        }
      } catch {
        errors.push("活跃度：上报地址格式不合法");
      }
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

    // 标签库校验
    const tagNames = (Array.isArray(data.tags) ? data.tags : []).map((t) => (t.name || "").trim());
    if (tagNames.some((n) => !n)) {
      errors.push("标签管理：标签名称不能为空");
    } else if (new Set(tagNames).size !== tagNames.length) {
      errors.push("标签管理：标签名称不能重复");
    }

    if (errors.length > 0) {
      setToast({ type: "error", message: errors[0] });
      // 跳转到第一个错误的分区
      const firstError = errors[0];
      if (firstError.includes("Docker")) setActiveSection("docker");
      else if (firstError.includes("用户")) setActiveSection("user");
      else if (firstError.includes("标签")) setActiveSection("tags");
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
    { key: "docker", label: "引擎配置", icon: <Container size={16} /> },
    { key: "user", label: "用户", icon: <User size={16} /> },
    { key: "columns", label: "列显隐默认值", icon: <Columns size={16} /> },
    { key: "tags", label: "标签管理", icon: <TagsIcon size={16} /> },
    { key: "compose", label: "Compose 管理", icon: <FileCode2 size={16} /> },
    { key: "modal", label: "弹窗设置", icon: <Timer size={16} /> },
    { key: "notifications", label: "通知配置", icon: <Bell size={16} /> },
    { key: "backup", label: "备份管理", icon: <Package size={16} /> },
    { key: "scheduler", label: "更新调度器", icon: <Clock size={16} /> },
    { key: "activity", label: "活跃度", icon: <Activity size={16} /> },
    { key: "update", label: "系统更新", icon: <Download size={16} /> },
  ];

  // ============ 标签库（设置 → 标签管理，全局 ResourceTag 列表） ============
  const tags = Array.isArray(data.tags) ? data.tags : [];
  const setTags = (next: ResourceTag[]) => setData({ ...data, tags: next });
  /** 新建空标签：默认随机色，名称聚焦由渲染端 input 完成 */
  const addTag = () => {
    const color = randomTagColor();
    setTags([...tags, { id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: "", color }]);
  };
  const patchTag = (id: string, patch: Partial<ResourceTag>) =>
    setTags(tags.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const removeTag = (id: string) => setTags(tags.filter((t) => t.id !== id));

  const update = (section: string, field: string, value: any) => {
    // section 只会取 docker / notifications 等对象段；defaultsVersion 等标量段不参与
    setData({ ...data, [section]: { ...(data as Record<string, any>)[section], [field]: value } });
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
    <div className="flex h-full min-h-0">
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
              {section.key === "update" && updateInfo?.hasUpdate && (
                <span className="ml-auto text-[10px] min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-red-500 text-white font-semibold leading-none">
                  1
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Settings Content */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="flex-1 min-h-0 overflow-y-auto p-6">
          {activeSection === "docker" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">引擎配置</h2>
              <p className="text-sm text-slate-500">管理 Docker Engine 连接与全局配置</p>
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
              </div>
            </Card>

            <Card title="菜单显示语言" icon={<Languages size={16} />}>
              <FormField label="语言选择" hint="堆栈右键菜单显示英文或中文标签">
                <Select
                  value={data.docker.menuLanguage || "zh"}
                  onChange={(val) => update("docker", "menuLanguage", val)}
                  options={[
                    { value: "en", label: "English" },
                    { value: "zh", label: "中文" },
                  ]}
                />
              </FormField>
            </Card>

            <Card title="镜像加速源" icon={<Globe size={16} />}>
              <div className="space-y-4">
                {/* 读写宿主机 /etc/docker/daemon.json */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
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
              <h2 className="text-lg font-semibold text-slate-800 mb-1">用户</h2>
            </div>

            <Card title="当前账户" icon={<User size={16} />}>
              <div className="space-y-4">
                <FormField label="用户名" hint="用户名不支持修改">
                  <Input value={currentUser?.username || ""} onChange={() => {}} disabled />
                </FormField>
                <FormField label="会话超时（分钟）" hint="空闲超过该时长后需重新登录；改动在下次登录时生效">
                  <Input
                    value={String(data.user.sessionTimeout)}
                    onChange={(val) => update("user", "sessionTimeout", parseInt(val, 10) || 0)}
                    type="number"
                  />
                </FormField>
              </div>
            </Card>

            <Card title="修改密码" icon={<KeyRound size={16} />}>
              <ChangePasswordForm username={currentUser?.username} />
            </Card>

            <Card title="密码找回码" icon={<ShieldCheck size={16} />}>
              <RecoveryCodeForm />
            </Card>
          </div>
        )}

        {activeSection === "columns" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">列显隐默认值</h2>
              <p className="text-sm text-slate-500">设置各页面表格的默认可见列</p>
            </div>

            {(["containers", "images", "volumes", "stackList", "stacks"] as const).map((page) => {
              const allColumns: Record<string, { key: string; label: string }[]> = {
                containers: [
                  { key: "icon", label: "图标" },
                  { key: "name", label: "容器名称" },
                  { key: "status", label: "状态" },
                  { key: "tags", label: "标签" },
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
                  { key: "actions", label: "操作" },
                ],
                stackList: [
                  { key: "icon", label: "图标" },
                  { key: "name", label: "堆栈名称" },
                  { key: "status", label: "状态" },
                  { key: "tags", label: "标签" },
                  { key: "containers", label: "容器" },
                  { key: "uptime", label: "运行时长" },
                  { key: "update", label: "更新" },
                ],
                stacks: [
                  { key: "name", label: "容器名称" },
                  { key: "image", label: "镜像" },
                  { key: "status", label: "状态" },
                  { key: "network", label: "网络" },
                  { key: "ip", label: "容器 IP" },
                  { key: "ports", label: "端口" },
                  { key: "update", label: "更新" },
                ],
              };

              const pageLabel: Record<string, string> = { containers: "容器管理", images: "镜像管理", volumes: "数据卷管理", stackList: "堆栈管理", stacks: "容器子表" };
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
                          className={`relative flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition-colors ${
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

            <Card
              title="备份历史"
              icon={<Package size={16} />}
              actions={
                <button
                  onClick={loadBackups}
                  disabled={backupsLoading}
                  className="text-slate-400 hover:text-blue-500 disabled:opacity-50"
                  title="刷新备份列表"
                >
                  <RefreshCw size={14} className={backupsLoading ? "animate-spin" : ""} />
                </button>
              }
            >
              <div className="space-y-2">
                {backupsLoading && backups === null && (
                  <p className="text-sm text-slate-400 py-2">正在加载备份列表...</p>
                )}
                {backups !== null && backups.length === 0 && (
                  <p className="text-sm text-slate-400 py-2">暂无备份文件（堆栈页右键「备份」生成）</p>
                )}
                {backups?.map((b) => (
                  <div key={b.name} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700 font-medium font-mono truncate" title={b.name}>{b.name}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(b.mtime).toLocaleString()} • {fmtBackupSize(b.size)} •{" "}
                        <span className="text-blue-500">{backupStackName(b.name)}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => { setBackupDeleteError(null); setDeletingBackup(b.name); }}
                      className="text-slate-400 hover:text-red-500 flex-shrink-0"
                      title="删除此备份"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
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
              <p className="text-sm text-slate-500">全局自动更新检查（基于 SHA-256 digest 精确比较镜像版本）</p>
            </div>

            <Card title="自动更新检查" icon={<RefreshCw size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-600">启用全局自动更新检查</span>
                    <p className="text-xs text-slate-400 mt-0.5">默认每天凌晨 1 点检查所有镜像版本</p>
                  </div>
                  <Toggle active={data.updateScheduler.enabled} onChange={(val) => update("updateScheduler", "enabled", val)} />
                </div>
                {data.updateScheduler.enabled && (
                  <>
                    <FormField label="检查频率" hint="不使用 Cron 表达式，按下方选项设置">
                      <div className="flex gap-2">
                        {(["daily", "weekly", "monthly"] as const).map((m) => (
                          <button
                            key={m}
                            onClick={() => update("updateScheduler", "mode", m)}
                            className={`flex-1 px-3 py-2 text-sm rounded-lg border transition-colors ${
                              data.updateScheduler.mode === m
                                ? "border-blue-500 bg-blue-50 text-blue-600 font-medium"
                                : "border-slate-200 text-slate-600 hover:bg-slate-50"
                            }`}
                          >
                            {m === "daily" ? "每天" : m === "weekly" ? "每周" : "每月"}
                          </button>
                        ))}
                      </div>
                    </FormField>

                    <div className="grid grid-cols-2 gap-3">
                      <FormField label="小时" hint="0-23">
                        <Select
                          value={String(data.updateScheduler.hour)}
                          onChange={(v) => update("updateScheduler", "hour", Number(v))}
                          options={Array.from({ length: 24 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }))}
                        />
                      </FormField>
                      <FormField label="分钟" hint="0-59">
                        <Select
                          value={String(data.updateScheduler.minute)}
                          onChange={(v) => update("updateScheduler", "minute", Number(v))}
                          options={Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: String(i).padStart(2, "0") }))}
                        />
                      </FormField>
                    </div>

                    {data.updateScheduler.mode === "weekly" && (
                      <FormField label="星期几" hint="0=周日 … 6=周六">
                        <Select
                          value={String(data.updateScheduler.dayOfWeek)}
                          onChange={(v) => update("updateScheduler", "dayOfWeek", Number(v))}
                          options={[
                            { value: "0", label: "周日" },
                            { value: "1", label: "周一" },
                            { value: "2", label: "周二" },
                            { value: "3", label: "周三" },
                            { value: "4", label: "周四" },
                            { value: "5", label: "周五" },
                            { value: "6", label: "周六" },
                          ]}
                        />
                      </FormField>
                    )}

                    {data.updateScheduler.mode === "monthly" && (
                      <FormField label="每月几号" hint="1-31">
                        <Select
                          value={String(data.updateScheduler.dayOfMonth)}
                          onChange={(v) => update("updateScheduler", "dayOfMonth", Number(v))}
                          options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: `${i + 1} 号` }))}
                        />
                      </FormField>
                    )}

                    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <span className="text-sm text-slate-600">检查到更新后自动拉取镜像</span>
                      <Toggle active={data.updateScheduler.autoPull} onChange={(val) => update("updateScheduler", "autoPull", val)} size="sm" />
                    </div>
                  </>
                )}
              </div>
            </Card>

            <Card title="检查状态" icon={<Clock size={16} />}>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-400">上次检查</p>
                    <p className="text-slate-700 mt-1">{schedulerStatus?.lastCheck ? fmtDateTime(schedulerStatus.lastCheck) : "尚未检查"}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg">
                    <p className="text-xs text-slate-400">下次检查</p>
                    <p className="text-slate-700 mt-1">{schedulerStatus?.nextCheck ? fmtDateTime(schedulerStatus.nextCheck) : "—"}</p>
                  </div>
                </div>
                {schedulerStatus?.lastResult && (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-blue-50 rounded-lg">
                      <p className="text-2xl font-bold text-blue-600">{schedulerStatus.lastResult.checked}</p>
                      <p className="text-xs text-slate-500">已检查镜像</p>
                    </div>
                    <div className="text-center p-3 bg-amber-50 rounded-lg">
                      <p className="text-2xl font-bold text-amber-600">{schedulerStatus.lastResult.updates}</p>
                      <p className="text-xs text-slate-500">有可用更新</p>
                    </div>
                    <div className="text-center p-3 bg-slate-50 rounded-lg">
                      <p className="text-2xl font-bold text-slate-600">{schedulerStatus.lastResult.byEngine.length}</p>
                      <p className="text-xs text-slate-500">引擎数</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRunCheck}
                    disabled={checkingNow || !!schedulerStatus?.running}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <RefreshCw size={14} className={checkingNow ? "animate-spin" : ""} /> 立即检查全部
                  </button>
                  {schedulerStatus?.running && <span className="text-xs text-slate-400">检查进行中…</span>}
                </div>
                {schedulerStatus?.lastResult?.byEngine?.filter((e) => e.error || e.skipped).length ? (
                  <div className="text-xs text-slate-400 space-y-1">
                    {schedulerStatus.lastResult.byEngine.filter((e) => e.error).map((e, i) => (
                      <p key={`err-${i}`}>⚠ {e.name}：{e.error}</p>
                    ))}
                    {schedulerStatus.lastResult.byEngine.filter((e) => e.skipped).map((e, i) => (
                      <p key={`skip-${i}`}>○ {e.name}：未连接，已跳过</p>
                    ))}
                  </div>
                ) : null}
              </div>
            </Card>
          </div>
        )}

        {activeSection === "activity" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">活跃度</h2>
              <p className="text-sm text-slate-500">设备标识、硬件指纹与上报配置（停用即不再发送任何数据）</p>
            </div>

            <ActivityPanel
              telemetry={data.telemetry}
              onPatch={async (patch) => { setData({ ...data, telemetry: { ...data.telemetry, ...patch } }); return true; }}
              onAfterSave={async () => {
                await handleSave();
              }}
            />
          </div>
        )}

        {activeSection === "update" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">系统更新</h2>
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

            {/* 检查更新 */}
            <Card title="检查更新" icon={<Globe size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-600">自动检查更新</span>
                  </div>
                  <Toggle active={data.update?.autoCheck ?? false} onChange={(val) => update("update", "autoCheck", val)} />
                </div>
                {data.update?.autoCheck && (
                  <div className="flex items-center justify-between pl-4 border-l-2 border-slate-100">
                    <div>
                      <span className="text-sm text-slate-600">自动更新</span>
                      <p className="text-xs text-slate-400 mt-0.5">检测到新版本后自动下载并应用（仅自动检查更新开启时可启用）</p>
                    </div>
                    <Toggle active={data.update?.autoUpdate ?? false} onChange={(val) => update("update", "autoUpdate", val)} />
                  </div>
                )}
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
                  <button
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={updateInProgress || uploading}
                    title="上传本地构建的更新包（.zip）仅保存，不立即升级；上传后点击「更新」按钮应用，无需联网"
                    className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    {uploading ? "上传中..." : "上传更新包"}
                  </button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    accept=".zip,application/zip"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadUpdate(file);
                      e.target.value = "";
                    }}
                  />
                  {updateInfo && !updateInfo.hasUpdate && (
                    <span className="flex items-center gap-1.5 text-sm text-green-600">
                      <Check size={14} /> 已是最新版本
                    </span>
                  )}
                </div>

                {pendingUpload && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-3">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-medium text-slate-700">已上传本地更新包（待应用）</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {pendingUpload.fileName}（{(pendingUpload.size / 1024 / 1024).toFixed(1)} MB）· 上传于 {new Date(pendingUpload.uploadedAt).toLocaleString()}
                        </p>
                        {pendingUpload.expiresAt && !updateInProgress && (
                          <p className="text-xs text-amber-600 mt-0.5 inline-flex items-center gap-1">
                            <Timer size={12} />
                            {formatCountdown(new Date(pendingUpload.expiresAt).getTime() - nowTick)} 后未更新将自动销毁
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={handleDiscardPending}
                          disabled={updateInProgress}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          丢弃
                        </button>
                        <button
                          onClick={handleApplyLocalUpdate}
                          disabled={updateInProgress || uploading}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {updateInProgress ? <Loader2 size={14} className="animate-spin" /> : null}
                          {updateInProgress ? "更新中..." : "更新"}
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={handleIgnoreUpdate}
                          disabled={updateInProgress}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <EyeOff size={14} /> 忽略此版本
                        </button>
                        <button
                          onClick={handleApplyUpdate}
                          disabled={updateInProgress}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                          {updateInProgress ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                          {updateInProgress ? "升级中..." : "一键升级"}
                        </button>
                      </div>
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

                {data.update?.ignoredVersion && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-500">
                      已忽略版本 v{data.update.ignoredVersion} 的更新提示
                    </span>
                    <button
                      onClick={handleRestoreUpdateNotice}
                      className="text-xs text-blue-500 hover:underline flex-shrink-0"
                    >
                      恢复提示
                    </button>
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
                    {/* 下载阶段：速度 + 剩余时间（bytesTotal 为 0 表示 Content-Length 缺失，无法预估） */}
                    {updateState.phase === "downloading" && (updateState.bytesTotal ?? 0) > 0 && (
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Gauge size={12} className={updateState.speedBps ? "text-blue-500" : "text-slate-400"} />
                          {formatSpeed(updateState.speedBps) || "测速中..."}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Timer size={12} className="text-slate-400" />
                          {updateState.etaSeconds != null
                            ? `剩余 ${formatEta(updateState.etaSeconds)}`
                            : "剩余时间计算中..."}
                        </span>
                      </div>
                    )}
                    {updateState.phase === "error" && updateState.error && (
                      <p className="text-xs text-red-500">{updateState.error}</p>
                    )}
                    {updateState.phase === "done" && (
                      <p className="text-xs text-green-600">升级完成，服务即将自动重启...</p>
                    )}
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {activeSection === "compose" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">Compose 管理</h2>
              <p className="text-sm text-slate-500">
                维护「编辑堆栈 → Compose」页右侧的一键填入模板。每项可填一行或多行 compose 内容（如 restart: unless-stopped），
                填入时会按目标层级<b>自动缩进</b>（无需手工对齐空格）；值留空的项填入时自动补全（restart→unless-stopped、network_mode→bridge、container_name→服务名 等）。
                每项可单独选择填入位置：<b>services 下</b>（第一个服务内部，缩进 4 空格）、<b>environment 下</b> / <b>volumes 下</b>（第一个服务对应键的子项，缩进 6 空格）、
                <b>指针处</b>（编辑器光标所在行的下一行）或 <b>末尾</b>（追加到 compose 文本最后一行）。缩进以标准 2 空格 compose 为基准，会随文档实际缩进自适应。
              </p>
            </div>

            <Card
              title="一键填入模板"
              icon={<FileCode2 size={16} />}
              actions={
                <button
                  onClick={() =>
                    update("compose", "templates", [
                      ...(data.compose?.templates || []),
                      { content: "", insert: "services" as const },
                    ])
                  }
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <Plus size={14} /> 新增模板项
                </button>
              }
            >
              {(data.compose?.templates || []).length === 0 ? (
                <div className="py-8 text-center">
                  <FileCode2 size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500">还没有模板项</p>
                  <p className="text-xs text-slate-400 mt-1">新增后可在堆栈编辑器里一键填入</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {(data.compose?.templates || []).map((tpl, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-slate-400 font-mono w-8 text-right shrink-0">{i + 1}.</span>
                        {/* 填入位置切换 */}
                        <div className="flex items-center flex-wrap rounded-md border border-slate-200 overflow-hidden text-xs shrink-0">
                          {COMPOSE_INSERT_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              title={opt.hint}
                              onClick={() => {
                                const next = [...(data.compose?.templates || [])];
                                next[i] = { ...next[i], insert: opt.value };
                                update("compose", "templates", next);
                              }}
                              className={`px-2 py-1 transition-colors ${
                                normalizeInsert(tpl.insert) === opt.value
                                  ? "bg-blue-500 text-white"
                                  : "bg-white text-slate-500 hover:bg-slate-50"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                        <div className="flex-1" />
                        <IconButton
                          icon={<Trash2 size={14} />}
                          title="删除该模板项"
                          onClick={() =>
                            update("compose", "templates", (data.compose?.templates || []).filter((_, j) => j !== i))
                          }
                        />
                      </div>
                      <textarea
                        value={tpl.content}
                        rows={tpl.content.split("\n").length > 1 ? tpl.content.split("\n").length : 2}
                        placeholder={"如: restart: unless-stopped\n    labels:\n      - traefik.enable=true"}
                        onChange={(e) => {
                          const next = [...(data.compose?.templates || [])];
                          next[i] = { ...next[i], content: e.target.value };
                          update("compose", "templates", next);
                        }}
                        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-blue-300"
                        spellCheck={false}
                      />
                    </div>
                  ))}
                </div>
              )}
              <p className="text-xs text-slate-400 mt-3">
                示例：network_mode: （留空自动补 bridge）、restart: unless-stopped、container_name: （留空自动补服务名）、- TZ=Asia/Shanghai（environment 下）、- /etc/localtime:/etc/localtime:ro（volumes 下）。
                「services 下」填到第一个服务内并缩进 4 空格，「environment 下」「volumes 下」填到对应键的子项并缩进 6 空格（键不存在时自动创建），
                「指针处」填到编辑器光标所在行的下一行（需先在编辑器中点击定位），「末尾」追加到文件最后一行。保存后立即生效。
              </p>
            </Card>
          </div>
        )}

        {activeSection === "modal" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">弹窗设置</h2>
              <p className="text-sm text-slate-500">配置操作结果弹窗的自动关闭行为</p>
            </div>

            <Card title="自动关闭" icon={<Timer size={16} />}>
              <FormField
                label="操作结果弹窗自动关闭时间（秒）"
                hint="启动堆栈等操作完成后，弹窗显示倒计时并在设定秒数后自动关闭；0 表示不自动关闭。弹窗内点击「取消自动关闭」可保持弹窗打开。"
              >
                <Input
                  type="number"
                  value={String(data.modal?.autoCloseDelay ?? 5)}
                  onChange={(v) => {
                    const n = Math.max(0, Math.floor(Number(v) || 0));
                    update("modal", "autoCloseDelay", n);
                  }}
                  className="max-w-[160px]"
                />
              </FormField>
            </Card>
          </div>
        )}

        {activeSection === "tags" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">标签管理</h2>
              <p className="text-sm text-slate-500">
                维护全局彩色标签库。标签挂在「堆栈管理 → 编辑 → LABELS」的每个服务条目上，容器管理 / 堆栈管理列表同步显示并支持按标签排序。
              </p>
            </div>

            <Card
              title="标签库"
              icon={<TagsIcon size={16} />}
              actions={
                <button
                  onClick={addTag}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <Plus size={14} /> 新建标签
                </button>
              }
            >
              {tags.length === 0 ? (
                <div className="py-10 text-center">
                  <TagsIcon size={32} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm text-slate-500 mb-1">还没有任何标签</p>
                  <p className="text-xs text-slate-400 mb-5">创建标签后，可在堆栈编辑器的 LABELS 页为每个服务打标签</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tags.map((tag) => {
                    const color = normalizeTagColor(tag.color);
                    const rgb = hexToRgb(tag.color) || { r: 100, g: 116, b: 139 };
                    const setRgb = (patch: Partial<{ r: number; g: number; b: number }>) => {
                      const next = { ...rgb, ...patch };
                      patchTag(tag.id, { color: rgbToHex(next.r, next.g, next.b) });
                    };
                    return (
                      <div
                        key={tag.id}
                        className="flex flex-wrap items-center gap-3 px-3 py-2.5 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors"
                      >
                        {/* 色板快速换色 */}
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {TAG_PALETTE.map((c) => (
                            <button
                              key={c}
                              type="button"
                              title={c}
                              onClick={() => patchTag(tag.id, { color: c })}
                              className={`w-5 h-5 rounded-full transition-all ${
                                color === c ? "ring-2 ring-offset-1 ring-slate-400" : "hover:scale-110"
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        {/* 手动 RGB：原生取色器 + R/G/B 数值输入 */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <input
                            type="color"
                            value={color}
                            onChange={(e) => patchTag(tag.id, { color: e.target.value })}
                            title="取色器"
                            className="w-7 h-7 rounded cursor-pointer border border-slate-200 bg-white p-0.5"
                          />
                          {(["r", "g", "b"] as const).map((ch) => (
                            <label key={ch} className="flex items-center gap-1 text-[10px] text-slate-400 uppercase">
                              {ch}
                              <input
                                type="number"
                                min={0}
                                max={255}
                                value={rgb[ch]}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(255, Math.floor(Number(e.target.value) || 0)));
                                  setRgb({ [ch]: v });
                                }}
                                className="w-12 px-1.5 py-1 text-xs text-slate-700 border border-slate-200 rounded focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                              />
                            </label>
                          ))}
                        </div>
                        {/* 名称编辑 */}
                        <Input
                          value={tag.name}
                          onChange={(val) => patchTag(tag.id, { name: val })}
                          placeholder="标签名称，如：媒体、下载、开发"
                          className="flex-1 min-w-[140px]"
                        />
                        {/* 实时预览 */}
                        <div className="w-28 flex-shrink-0 flex justify-center">
                          <TagChip tag={{ ...tag, name: tag.name || "预览" }} />
                        </div>
                        <IconButton
                          icon={<Trash2 size={14} />}
                          title="删除标签"
                          onClick={() => removeTag(tag.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {tags.length > 0 && (
                <div
                  className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-lg border border-dashed border-slate-200"
                >
                  <span className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: hexWithAlpha(normalizeTagColor(tags[0]?.color), 0.15) }}>
                    <TagsIcon size={12} style={{ color: normalizeTagColor(tags[0]?.color) }} />
                  </span>
                  <p className="text-xs text-slate-500">
                    标签保存在本机设置中。删除标签不会影响已部署的容器，但对应 chip 会从容器 / 堆栈列表消失。
                  </p>
                </div>
              )}
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

        {/* 删除备份文件确认 */}
        <ConfirmDialog
          open={!!deletingBackup}
          onClose={() => { setDeletingBackup(null); setBackupDeleteError(null); }}
          onConfirm={handleDeleteBackup}
          title="删除备份"
          message={`确定删除备份文件 ${deletingBackup || ""} 吗？删除后无法恢复，依赖该备份的堆栈将无法还原到此时点。`}
          confirmText="删除"
          danger
          loading={backupDeleting}
          errorMessage={backupDeleteError}
        />

        {/* 重启 Docker 的命令输出（tail 文本） */}
        <CmdOutputModal data={cmdOutput} onClose={closeOutput} />

        </div>

        {/* Save Button (Unraid-style status bar) */}
        <div className="flex-shrink-0 flex justify-end items-center gap-3 px-6 py-2.5 bg-slate-50 border-t border-slate-200">
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

