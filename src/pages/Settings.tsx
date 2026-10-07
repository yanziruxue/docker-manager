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
  Wifi,
  WifiOff,
  AlertCircle,
  AlertTriangle,
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
  Undo2,
  Info,
  FileText,
  FolderOpen,
  Eye,
} from "lucide-react";
import type { SystemSettings, DockerEngine, UpdateInfo, UpdateState, ResourceTag, ComposeTemplate, AppInfo, LogListResult, LogTailResult, MirrorRuntimeState, NotifyRuntimeStatus } from "../types";
// 值导入（不是 type）：密钥「清除」哨兵值
import { SECRET_CLEAR, LOG_CHANNEL_LABELS } from "../types";
import { Card, FormField, Input, Select, Toggle, IconButton } from "../components/UI";
import { PasswordInput } from "../components/PasswordInput";
import { ActivityPanel } from "../components/ActivityPanel";
import type { SchedulerStatus } from "../types";
import { COMPOSE_INSERT_OPTIONS, normalizeInsert } from "../lib/compose-template";
import {
  changeMyPassword,
  getRecoveryStatus,
  setRecoveryCode,
  clearRecoveryCode,
  type AuthUser,
  type RecoveryStatus,
} from "../api";
import {
  sanitizeRecoveryInput,
  validateRecoveryCode,
  RECOVERY_MIN_LENGTH,
  RECOVERY_MAX_LENGTH,
} from "../lib/recovery-code";
import { waitForRestartAndReload } from "../lib/restart-wait";
import { TAG_PALETTE, TagChip, normalizeTagColor, hexWithAlpha, randomTagColor, hexToRgb, rgbToHex } from "../components/TagPicker";
import { Modal, ConfirmDialog } from "../components/Modal";
import { JsonEditor } from "../components/JsonEditor";
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
  saveDaemonConfigContent,
  restartDockerApi,
  type DaemonConfigInfo,
  fetchAppVersion,
  checkUpdateApi,
  applyUpdateApi,
  cancelUpdateApi,
  uploadUpdateZipApi,
  fetchPendingUploadApi,
  applyLocalUpdateApi,
  discardPendingUploadApi,
  fetchUpdateStatusApi,
  fetchBackupsApi,
  createBackupApi,
  restoreBackupApi,
  restoreUploadedBackupApi,
  deleteBackupApi,
  downloadBackupApi,
  exportConfigApi,
  checkPermissionsApi,
  type BackupFileInfo,
  type PermIssue,
  type PermCheckResult,
  fetchTelemetryStatus,
  type TelemetryStatus,
  getSchedulerStatusApi,
  runSchedulerCheckApi,
  fetchAppInfoApi,
  fetchAppLogsApi,
  fetchAppLogTailApi,
  downloadAppLogApi,
  exportAppLogsApi,
  deleteAppLogApi,
  pruneAppLogsApi,
  fetchMirrorStatusApi,
  syncMirrorNowApi,
  testNotifyApi,
  fetchNotifyStatusApi,
} from "../api";
import { copyText, selectNodeText } from "../lib/clipboard";

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

/**
 * 推导 daemon.json 编辑器的初始文本：
 * ① 文件有内容 → 原文（即使 JSON 坏了也原样给出，让用户在编辑器里直接修）；
 * ② 文件不存在/为空 → 用应用设置里的加速源生成一份，没有则给空模板。
 */
function deriveDaemonText(info: DaemonConfigInfo, mirrors: string[]): string {
  if (info.raw.trim()) return info.raw;
  if (mirrors.length > 0) return JSON.stringify({ "registry-mirrors": mirrors }, null, 2) + "\n";
  return '{\n  "registry-mirrors": []\n}\n';
}

/** 「标签 : 值」一行（应用详情卡片用） */
function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-slate-500 flex-shrink-0 w-20">{label}</span>
      <span className="text-slate-800 break-all">{value}</span>
    </div>
  );
}

/** 字节数 -> 人类可读（应用详情 / 应用日志页用） */
function fmtSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

/** 秒 -> 中文时长（应用详情「已运行」用） */
function fmtUptimeCn(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} 天 ${h} 小时`;
  if (h > 0) return `${h} 小时 ${m} 分`;
  if (m > 0) return `${m} 分`;
  return `${Math.round(sec)} 秒`;
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
      menuLanguage: "zh",
      logLevel: "info",
      registryMirrors: [],
      rewriteImageNames: false,
    },
    notifications: {
      webhookEnabled: false,
      webhookUrl: "",
      webhookSecret: "",
      emailEnabled: false,
      emailSmtp: "",
      emailPort: 587,
      emailUser: "",
      emailPassword: "",
      emailFrom: "",
      emailTo: "",
      events: { containerDown: true, updateAvailable: true, updateComplete: false, buildFailed: true },
    },
    backup: {
      autoBackupEnabled: false,
      lastBackup: "",
      autoFixReadPerm: true,
      weekly: { day: "Sunday", time: "23:10", retention: 6 },
      monthly: { dayOfMonth: 0, time: "23:20", retention: 12 },
      yearly: { date: "12-31", time: "23:30" },
    },
    pathFavorites: [],
    updateScheduler: { enabled: true, mode: "daily", hour: 1, minute: 0, dayOfWeek: 1, dayOfMonth: 1, autoPull: false },
    user: { sessionTimeout: 30 },
    update: { autoCheck: false, autoUpdate: false, ignoredVersion: "" },
    // 列显隐不再由系统设置控制（v1.38.1）：空对象 ⇒ 各表格回落为「全部列可见」
    columnVisibility: {},
    tags: [],
    modal: {
      autoCloseDelay: 5,
      containerDetailStyle: "drawer",
    },
    compose: {
      templates: [
        { content: "network_mode: ", insert: "services" },
        { content: "restart: ", insert: "services" },
        { content: "container_name: ", insert: "services" },
      ],
    },
    // 默认开启上传安装数量统计（系统设置 → 硬件信息 可关闭）
    telemetry: { enabled: true },
    // 目录镜像：默认关闭，目标路径留空（用户按需开启）
    mirror: {
      backups: { enabled: false, target: "" },
      compose: { enabled: false, target: "" },
    },
    // 应用日志保留策略：默认开启（30 天 / 总上限 500 MB）
      // 顶层三项 ＝ 应用日志，同时是 notify / oplog 的继承来源（子段留空即跟随）
      logRetention: { enabled: true, maxDays: 365, maxTotalMB: 1024, notify: {}, oplog: {} },
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
  /** （OTA）更新信息：由 App 统一持有，进入本页即展示已检测到的更新（与侧边栏角标同源） */
  updateInfo?: UpdateInfo | null;
  /** 更新信息变化时回传（检查更新 / 忽略 / 更新完成），用于同步全局侧边栏「系统设置」角标 */
  onUpdateInfoChange?: (info: UpdateInfo | null) => void;
  /** 当前登录用户（用于「用户」区块展示与改密） */
  currentUser?: AuthUser | null;
}

/** 「用户」区块：修改当前登录账户密码（单管理员，需校验原密码） */
/**
 * 密钥输入行（Webhook 签名密钥 / SMTP 密码）。
 *
 * ★ 密钥**只写不读**：服务端 `GET /api/settings` 永远返回空串，靠 `isSet` 标志告诉界面
 *   「已设置」。因此：
 *   - 留空 ⇒ 后端保持原值不变（不会把已存的密钥清掉）；
 *   - 要清空必须点「清除」，它会写入哨兵值 `SECRET_CLEAR`；
 *   - 若该密钥被环境变量覆盖（`envVar` 非空），界面提示「只读」——因为 env 优先级更高，
 *     在这里改什么都不会生效。
 */
function SecretField({
  label,
  hint,
  value,
  placeholder,
  visible,
  onToggle,
  onChange,
  onClear,
  isSet,
  envVar,
}: {
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  visible: boolean;
  onToggle: () => void;
  onChange: (v: string) => void;
  onClear: () => void;
  isSet?: boolean;
  envVar?: string;
}) {
  const fromEnv = !!envVar;
  const effectiveHint = fromEnv
    ? `已由环境变量 ${envVar} 覆盖 —— 这里的设置会被忽略`
    : isSet
      ? "已设置（加密存储）· 留空 = 保持不变"
      : hint;
  return (
    <FormField label={label} hint={effectiveHint}>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <PasswordInput
            value={value}
            onChange={onChange}
            placeholder={fromEnv ? "（来自环境变量）" : isSet ? "••••••••（留空 = 不变）" : placeholder}
            visible={visible}
            onToggle={onToggle}
            lockIcon={false}
          />
        </div>
        {isSet && !fromEnv && (
          <button
            type="button"
            onClick={onClear}
            className="flex-shrink-0 px-2.5 py-2 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
          >
            清除
          </button>
        )}
      </div>
    </FormField>
  );
}

function ChangePasswordForm({ username }: { username?: string }) {
  const [oldPassword, setOldPassword] = useState("");
  const [showOld, setShowOld] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
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
          <PasswordInput
            value={oldPassword}
            onChange={setOldPassword}
            placeholder="••••••••"
            visible={showOld}
            onToggle={() => setShowOld((v) => !v)}
            lockIcon={false}
          />
        </FormField>
        <FormField label="新密码" required hint="至少 6 位">
          <PasswordInput
            value={newPassword}
            onChange={setNewPassword}
            placeholder="••••••••"
            visible={showNew}
            onToggle={() => setShowNew((v) => !v)}
            lockIcon={false}
          />
        </FormField>
        <FormField label="确认新密码" required>
          <PasswordInput
            value={confirm}
            onChange={setConfirm}
            placeholder="••••••••"
            visible={showConfirm}
            onToggle={() => setShowConfirm((v) => !v)}
            lockIcon={false}
          />
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

/** 「用户」区块：密码找回码管理（18~24 位、区分大小写；服务端仅存哈希，明文不可回显） */
function RecoveryCodeForm() {
  const [status, setStatus] = useState<RecoveryStatus | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
          label={`新找回码（${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位）`}
          required
          hint="仅字母和数字，区分大小写"
        >
          <div className="relative">
            <Input
              value={code}
              onChange={(v) => setCode(sanitizeRecoveryInput(v))}
              placeholder={`${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字`}
              className="pr-12 font-mono tracking-wider"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums pointer-events-none">
              {code.length}/{RECOVERY_MAX_LENGTH}
            </span>
          </div>
        </FormField>
        <FormField label="当前密码" required hint="敏感操作，需二次验证">
          <PasswordInput
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
            lockIcon={false}
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


// ============ 系统设置 → 列显隐（集中页） ============
// 与 App.tsx 读取 settings.columnVisibility.{containers,stackList,images,volumes} 完全一致：
// 数组为「可见列 key 列表」，留空（[] 或 undefined）⇒ 该表全部列可见。固定列（图标 / 操作）始终显示。
interface ColVisPageDef {
  key: "containers" | "stackList" | "images" | "volumes";
  label: string;
  fixed: string[];
  cols: Array<[string, string]>;
}
const COLVIS_PAGES: ColVisPageDef[] = [
  {
    key: "containers",
    label: "容器管理",
    fixed: ["icon", "actions"],
    cols: [
      ["name", "容器名称"], ["status", "状态"], ["tags", "标签"], ["image", "镜像"],
      ["ports", "端口映射"], ["network", "网络模式"], ["uptime", "运行时长"], ["restartPolicy", "重启策略"],
    ],
  },
  {
    key: "stackList",
    label: "堆栈管理",
    fixed: ["icon", "actions"],
    cols: [
      ["name", "堆栈名称"], ["status", "状态"], ["tags", "标签"], ["containers", "容器"],
      ["uptime", "运行时长"], ["update", "更新"],
    ],
  },
  {
    key: "images",
    label: "镜像管理",
    fixed: ["actions"],
    cols: [
      ["repository", "仓库名"], ["tag", "标签"], ["id", "镜像ID"], ["size", "大小"],
      ["createdAt", "创建时间"], ["updateStatus", "更新状态"], ["associatedContainers", "关联容器"], ["sha256", "SHA-256"],
    ],
  },
  {
    key: "volumes",
    label: "数据卷管理",
    fixed: ["actions"],
    cols: [
      ["name", "卷名称"], ["driver", "驱动"], ["mountpoint", "挂载点"], ["size", "大小"],
      ["associatedContainers", "关联容器"], ["createdAt", "创建时间"],
    ],
  },
];

export function Settings({ settings, activeEngineId, engines, onActiveEngineChange, onEnginesChange, onSaveSettings, updateInfo, onUpdateInfoChange, currentUser }: SettingsProps) {
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

  // 镜像更新（原「更新调度器」）状态：进入该页时轮询
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
  // 立即备份 / 导出 / 恢复 的运行态
  const [backupCreating, setBackupCreating] = useState(false);
  const [exportingConfig, setExportingConfig] = useState(false);
  /** 正在下载的备份文件名（用于列表项转圈与禁用） */
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null);
  /** 选中的待恢复备份文件名（null = 未打开恢复弹窗；"" = 已打开未选择） */
  const [restoringBackup, setRestoringBackup] = useState<string | null>(null);
  const [backupRestoring, setBackupRestoring] = useState(false);
  const [backupRestoreError, setBackupRestoreError] = useState<string | null>(null);
  /** 上传本地备份文件并直接恢复：隐藏 file input + 上传中态 */
  const backupUploadInputRef = useRef<HTMLInputElement>(null);
  const [backupUploading, setBackupUploading] = useState(false);
  /** 上次备份的权限跳过项（结构化诊断 → 展示原因 + 提供唯一修复命令） */
  const [backupIssues, setBackupIssues] = useState<{
    skipped: string[];
    details: PermIssue[];
    fixed: PermIssue[];
    fixCommand?: string;
  } | null>(null);
  /** 权限体检结果（只读扫描 compose 目录） */
  const [permCheck, setPermCheck] = useState<PermCheckResult | null>(null);
  const [permChecking, setPermChecking] = useState(false);
  /** 修复命令的复制反馈（成功 → 显示「已复制」，3 秒后复原） */
  const [copiedFixCmd, setCopiedFixCmd] = useState(false);
  const fixCmdRef = useRef<HTMLElement | null>(null);

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

  /** 权限体检（refresh=true 绕过服务端 60s 缓存） */
  const loadPermCheck = useCallback(async (refresh = false) => {
    setPermChecking(true);
    try {
      setPermCheck(await checkPermissionsApi(refresh));
    } catch {
      setPermCheck(null);
    } finally {
      setPermChecking(false);
    }
  }, []);

  /**
   * 复制「唯一的修复命令」。
   * 不静默失败：成功给出「已复制」，失败则选中命令文本并提示手动 Ctrl+C。
   */
  const handleCopyFixCmd = useCallback(async () => {
    const cmd = backupIssues?.fixCommand || permCheck?.fixCommand || "";
    if (!cmd) return;
    if (await copyText(cmd)) {
      setCopiedFixCmd(true);
      window.setTimeout(() => setCopiedFixCmd(false), 3000);
    } else {
      selectNodeText(fixCmdRef.current);
      setToast({ type: "error", message: "浏览器不允许自动复制，已帮你选中命令，请按 Ctrl+C 手动复制" });
    }
  }, [backupIssues?.fixCommand, permCheck?.fixCommand]);

  /** 复制任意文本并给出可见反馈（绝不静默失败） */
  const handleCopyText = async (text: string) => {
    if (!text) return;
    if (await copyText(text)) {
      setToast({ type: "success", message: "已复制" });
    } else {
      setToast({ type: "error", message: "浏览器不允许自动复制，请手动选中后按 Ctrl+C" });
    }
  };

  // 切到「备份管理」Section 时加载备份列表 + 权限体检
  useEffect(() => {
    if (activeSection === "backup") {
      loadBackups();
      loadPermCheck();
    }
  }, [activeSection, loadBackups, loadPermCheck]);

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

  /** 备份文件名 -> 展示标签 */
  const backupLabel = (name: string) => {
    const base = name.replace(/\.(zip|tar\.gz)$/i, "");
    if (base.startsWith("auto-")) return `自动备份（${base.split("_")[0].slice(5)}）`;
    if (base.startsWith("all_")) return "手动全量备份";
    if (base.startsWith("config-export")) return "配置导出";
    // 堆栈级备份：<stackName>_<timestamp>
    return base.replace(/_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, "");
  };

  /** 字节数 -> 人类可读（备份文件粒度用 1 位小数即可） */
  const fmtBackupSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  /** 最近一次备份时间（取列表最新一条，无则“从未备份”） */
  const lastBackupAt = backups && backups.length > 0 ? new Date(backups[0].mtime).toLocaleString() : "从未备份";

  // ============ 宿主机 Docker 守护进程配置（/etc/docker/daemon.json） ============
  // 「镜像加速源」以 daemon.json 代码形式展示与编辑：打开页面把文件内容读进编辑器，
  // 点「保存到 daemon.json」按编辑器内容整份写回（写前备份），内容有变化则询问是否重启 Docker。
  const [daemon, setDaemon] = useState<DaemonConfigInfo | null>(null);
  const [daemonLoading, setDaemonLoading] = useState(false);
  /** 编辑器文本 / 是否有未保存改动 / JSON 是否合法（由 JsonEditor 实时回调） */
  const [daemonText, setDaemonText] = useState("");
  const [daemonDirty, setDaemonDirty] = useState(false);
  const [daemonJsonOk, setDaemonJsonOk] = useState(true);
  const [savingDaemon, setSavingDaemon] = useState(false);
  /** 已落盘内容（判断脏与「重置」用）；ref 与 state 同步，供稳定回调读取最新值 */
  const daemonSavedTextRef = useRef("");
  const daemonDirtyRef = useRef(false);
  // 保存后询问是否重启 Docker
  const [askRestart, setAskRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // 有未保存改动时点「刷新」需先确认丢弃
  const [askReload, setAskReload] = useState(false);
  // 无权限时展示的修复建议（可直接复制到终端执行）
  const [privilegeHint, setPrivilegeHint] = useState<string | null>(null);
  const daemonSyncedRef = useRef(false);
  const { cmdOutput, showOutput, closeOutput } = useCmdOutput();

  const markDaemonDirty = (dirty: boolean) => {
    daemonDirtyRef.current = dirty;
    setDaemonDirty(dirty);
  };

  const loadDaemon = useCallback(async (syncToList = false) => {
    setDaemonLoading(true);
    try {
      const info = await fetchDaemonConfig();
      setDaemon(info);
      const text = deriveDaemonText(info, Array.isArray(info.registryMirrors) ? info.registryMirrors : []);
      // 未保存的编辑不被后台刷新覆盖（只有用户确认丢弃时才重读）
      if (!daemonDirtyRef.current) {
        daemonSavedTextRef.current = text;
        setDaemonText(text);
      }
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
   * 把编辑器内容整份写入 /etc/docker/daemon.json。
   * 「保存到 daemon.json」按钮与 APPLY（存在未保存改动时）共用此入口。
   * 成功且内容有变化 → 弹窗询问是否重启 Docker；失败 → 展示修复建议（不写坏原文件）。
   */
  const writeDaemonFromEditor = async (opts?: { quietNoChange?: boolean }): Promise<boolean> => {
    if (daemon && daemon.elevate === "none") {
      setToast({ type: "error", message: "当前没有写入 /etc/docker/daemon.json 的权限，请先按提示授权" });
      return false;
    }
    if (!daemonJsonOk) {
      setToast({ type: "error", message: "JSON 格式错误，请先修正后再保存" });
      return false;
    }
    if (!daemonText.trim()) {
      setToast({ type: "error", message: "内容为空，如需清空配置请填入 {}" });
      return false;
    }
    setSavingDaemon(true);
    try {
      const r = await saveDaemonConfigContent(daemonText);
      if (!r.ok) {
        if (r.hint) setPrivilegeHint(r.hint);
        setToast({ type: "error", message: r.error || "写入 /etc/docker/daemon.json 失败" });
        return false;
      }
      // 以落盘内容回读：编辑器文本对齐磁盘，并把 registry-mirrors 同步进应用设置
      // （「拉取时改写镜像名」仍以应用设置里的列表为准）
      const info = await fetchDaemonConfig();
      setDaemon(info);
      if (info.canRead && !info.parseError) {
        const text = info.raw.trim() ? info.raw : daemonText;
        daemonSavedTextRef.current = text;
        setDaemonText(text);
        setData((prev) => ({
          ...prev,
          docker: { ...prev.docker, registryMirrors: info.registryMirrors },
        }));
      }
      markDaemonDirty(false);
      if (r.changed) {
        setAskRestart(true);
      } else if (!opts?.quietNoChange) {
        setToast({ type: "success", message: "内容与当前一致，无需重启 Docker" });
      }
      return true;
    } catch (err: any) {
      setToast({
        type: "error",
        message: `写入 daemon.json 失败：${String(err?.message || err || "未知错误")}`,
      });
      return false;
    } finally {
      setSavingDaemon(false);
    }
  };

  /** 丢弃编辑器里未保存的修改，回到磁盘内容 */
  const resetDaemonText = () => {
    setDaemonText(daemonSavedTextRef.current);
    markDaemonDirty(false);
  };

  // ============ 系统更新（OTA）状态 ============
  const [appVersion, setAppVersion] = useState<{ version: string; installDir: string } | null>(null);
  // 说明：updateInfo 由父组件（App）以 prop 传入 —— 与侧边栏角标共用同一份状态，
  // 避免出现「侧边栏提示有更新、本页却空白（须手动点检查更新）」的不一致。
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** 「等重启 → 刷新页面」的取消函数（见 src/lib/restart-wait.ts），卸载时收掉 */
  const restartWaitRef = useRef<(() => void) | null>(null);
  // 上传更新包：隐藏的 file input + 应用中的禁用态
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // 上传进度（文件大小 + 百分比）：仅在上传中展示，完成后清空
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number } | null>(null);
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

  // 卸载时清理轮询定时器与「等重启」等待循环
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) clearInterval(statusTimerRef.current);
      restartWaitRef.current?.();
      restartWaitRef.current = null;
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
              onUpdateInfoChange?.(null);
              // 更新已完成：二进制已替换、进程即将退出并由 systemd 拉起新二进制，
              // 等待其重新上线后自动刷新页面，确保前端 bundle 同步到新版。
              // 此处只剩重启 ⇒ 允许兜底盲刷新（绝不卡死在旧前端）。
              // 判定逻辑见 src/lib/restart-wait.ts：**不再依赖状态码** —— 升级后
              // /system/version 会因「账号待重新设置」返回 403 REINIT_REQUIRED，
              // 旧实现把它当成「进程还没起来」⇒ 页面永不刷新。
              setUpdateState((prev) =>
                prev ? { ...prev, message: "升级完成，等待服务重启…" } : prev
              );
              // 重复触发时先取消上一个等待循环，避免叠出多个探测轮询
              restartWaitRef.current?.();
              restartWaitRef.current = waitForRestartAndReload({ blindReloadAfterMs: 60_000 });
            }
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
    // 不在此处清空 updateInfo：清空会连带侧边栏角标闪一下；保留旧结果，靠 checking 态提示进行中
    setUpdateState(null);
    try {
      const info = await checkUpdateApi();
      onUpdateInfoChange?.(info);
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

  /** 取消正在进行的升级：请求后端置取消标志，轮询会随之把状态收尾为 idle */
  const handleCancelUpdate = async () => {
    try {
      await cancelUpdateApi();
      setToast({ type: "success", message: "已请求取消升级，正在中止…" });
    } catch (err: any) {
      setToast({ type: "error", message: err?.message || "取消失败" });
    }
  };

  /** 忽略当前检测到的版本：写入 ignoredVersion，角标与提示立即消失 */
  const handleIgnoreUpdate = () => {
    if (!updateInfo) return;
    update("update", "ignoredVersion", updateInfo.latestVersion);
    onUpdateInfoChange?.(null);
  };

  /** 恢复被忽略版本的更新提示：清除 ignoredVersion */
  const handleRestoreUpdateNotice = () => {
    update("update", "ignoredVersion", "");
  };

  /** 上传本地 zip 更新包：仅保存为待应用包，不立即执行（执行需手动点击「更新」） */
  const handleUploadUpdate = async (file: File) => {
    if (updateInProgress) return;
    setUploading(true);
    setUploadFileName(file.name);
    setUploadProgress(null);
    // 清除旧进度显示，避免与待应用提示混淆
    setUpdateState(null);
    try {
      await uploadUpdateZipApi(file, {
        onProgress: (sent, total) => setUploadProgress({ sent, total }),
      });
      setUploadProgress(null);
      // 重新拉取完整 pending（含 expiresAt/ttlMs），保证倒计时起点准确
      const d = await fetchPendingUploadApi();
      if (d?.exists && d.fileName && d.size != null && d.uploadedAt) {
        setPendingUpload({ fileName: d.fileName, size: d.size, uploadedAt: d.uploadedAt, ttlMs: d.ttlMs, expiresAt: d.expiresAt });
      }
      setToast({ type: "success", message: "更新包已上传，2 分钟内点击「更新」应用，超时自动销毁" });
    } catch (err: any) {
      setUploadProgress(null);
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

  // ============ 备份操作（立即备份 / 恢复 / 导出） ============

  const handleCreateBackup = async () => {
    setBackupCreating(true);
    try {
      const r = await createBackupApi();
      const details = r.skippedDetails || [];
      const fixed = r.fixed || [];
      setBackupIssues(
        details.length || fixed.length
          ? { skipped: r.skipped || [], details, fixed, fixCommand: r.fixCommand }
          : null
      );
      if (r.skipped?.length) {
        setToast({ type: "error", message: `备份完成，但跳过 ${r.skipped.length} 项（原因见下方提示）` });
      } else if (fixed.length) {
        setToast({ type: "success", message: `备份完成：${r.backupName}（已自动修复 ${fixed.length} 项权限）` });
      } else {
        setToast({ type: "success", message: `备份完成：${r.backupName}` });
      }
      await loadBackups();
      // 备份可能已顺带自愈部分文件，刷新体检结果
      loadPermCheck(true);
    } catch (e: any) {
      setToast({ type: "error", message: e.message || "备份失败" });
    } finally {
      setBackupCreating(false);
    }
  };

  const handleRestoreBackup = async () => {
    if (!restoringBackup) return;
    setBackupRestoring(true);
    setBackupRestoreError(null);
    try {
      const r = await restoreBackupApi(restoringBackup);
      setRestoringBackup(null);
      setToast({ type: "success", message: `已恢复配置（堆栈 ${r.stacks} 个），刷新页面后生效` });
      await loadBackups();
    } catch (e: any) {
      setBackupRestoreError(e.message || "恢复失败");
    } finally {
      setBackupRestoring(false);
    }
  };

  /** 上传本地备份文件并直接恢复（无需先存入备份列表）。带确认，避免误覆盖当前配置 */
  const handleRestoreFromUpload = async (file: File) => {
    if (backupUploading || backupRestoring) return;
    if (!window.confirm(`确定用备份「${file.name}」恢复吗？\n将覆盖当前 Compose 堆栈与设置/引擎配置。`)) {
      return;
    }
    setBackupUploading(true);
    setBackupRestoreError(null);
    try {
      const r = await restoreUploadedBackupApi(file);
      setToast({ type: "success", message: `已从上传备份恢复（堆栈 ${r.stacks} 个），刷新页面后生效` });
      await loadBackups();
      loadPermCheck(true);
    } catch (e: any) {
      setToast({ type: "error", message: e.message || "恢复失败" });
    } finally {
      setBackupUploading(false);
    }
  };

  const handleExportConfig = async () => {
    setExportingConfig(true);
    try {
      const name = await exportConfigApi();
      setToast({ type: "success", message: `已下载配置导出包${name ? `：${name}` : ""}` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "导出失败" });
    } finally {
      setExportingConfig(false);
    }
  };

  const handleDownloadBackup = async (name: string) => {
    if (downloadingBackup) return;
    setDownloadingBackup(name);
    try {
      await downloadBackupApi(name);
      setToast({ type: "success", message: `已下载备份：${name}` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "下载失败" });
    } finally {
      setDownloadingBackup(null);
    }
  };

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

  /** 返回是否真正落盘成功（校验失败 / 保存失败均返回 false）——「发送测试通知」据此判断能否继续 */
  const handleSave = async (): Promise<boolean> => {
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

    // 通知配置校验
    if (data.notifications.webhookEnabled && !data.notifications.webhookUrl.trim()) {
      errors.push("通知配置：Webhook URL 不能为空");
    }
    if (data.notifications.emailEnabled) {
      if (!data.notifications.emailSmtp.trim()) errors.push("通知配置：SMTP 服务器不能为空");
      if (!data.notifications.emailUser.trim()) errors.push("通知配置：邮箱用户名不能为空");
      // 此前密码框是死输入框（value="" + 空 onChange），密码连保存都没保存 ⇒ 补上必填校验
      if (!data.notifications.emailPassword) errors.push("通知配置：邮箱密码不能为空");
      if (!data.notifications.emailTo.trim()) errors.push("通知配置：收件人不能为空");
    }

    // 备份配置：备份目录留空 / 相对路径表示使用默认 <data>/backups，无需校验（绝对路径才生效）

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
      return false;
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
      return false;
    }

    // 镜像加速源改由「daemon.json 编辑器」直接管理：若编辑器里有未保存的改动，
    // APPLY 顺手一起写入宿主文件（与「保存到 daemon.json」同一入口，含重启询问），
    // 避免用户以为 APPLY 已经写盘而丢失编辑内容。失败原因由该入口自行提示。
    if (daemonDirtyRef.current) {
      await writeDaemonFromEditor({ quietNoChange: true });
    }
    return true;
  };

  // ============ 应用详情（系统设置 → 应用详情） ============
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [appInfoLoading, setAppInfoLoading] = useState(false);
  const [appInfoError, setAppInfoError] = useState<string | null>(null);
  /** 刚复制成功的目录 key（2 秒后复原为「复制」） */
  const [copiedDirKey, setCopiedDirKey] = useState<string | null>(null);

  const loadAppInfo = useCallback(async () => {
    setAppInfoLoading(true);
    setAppInfoError(null);
    try {
      setAppInfo(await fetchAppInfoApi());
    } catch (e: any) {
      setAppInfoError(e?.message || "获取应用详情失败");
    } finally {
      setAppInfoLoading(false);
    }
  }, []);

  useEffect(() => {
    // 「目录镜像」已并入本页 ⇒ 一并加载其运行态
    if (activeSection === "backup") {
      void loadAppInfo();
      void loadMirror();
    }
  }, [activeSection, loadAppInfo]);

  const copyDirPath = async (key: string, p: string) => {
    const ok = await copyText(p);
    if (!ok) {
      setToast({ type: "error", message: "复制失败，请手动选中路径复制" });
      return;
    }
    setCopiedDirKey(key);
    setTimeout(() => setCopiedDirKey((k) => (k === key ? null : k)), 2000);
  };

  // ============ 应用日志（系统设置 → 应用日志） ============
  const [logsData, setLogsData] = useState<LogListResult | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  /** 正在查看尾部的文件名（非空即打开弹窗） */
  const [tailName, setTailName] = useState<string | null>(null);
  const [tailData, setTailData] = useState<LogTailResult | null>(null);
  const [tailLoading, setTailLoading] = useState(false);
  const [tailLines, setTailLines] = useState(500);
  const [exportingLogs, setExportingLogs] = useState(false);
  const [downloadingLog, setDownloadingLog] = useState<string | null>(null);
  const [deletingLog, setDeletingLog] = useState<string | null>(null);
  const [pruningLogs, setPruningLogs] = useState(false);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      setLogsData(await fetchAppLogsApi());
    } catch (e: any) {
      setLogsError(e?.message || "获取日志列表失败");
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection === "applogs") void loadLogs();
  }, [activeSection, loadLogs]);

  const openTail = async (name: string, lines = tailLines) => {
    setTailName(name);
    setTailLoading(true);
    try {
      setTailData(await fetchAppLogTailApi(name, lines));
    } catch (e: any) {
      setTailData(null);
      setToast({ type: "error", message: e?.message || "读取日志失败" });
    } finally {
      setTailLoading(false);
    }
  };

  const handleExportLogs = async () => {
    setExportingLogs(true);
    try {
      const name = await exportAppLogsApi();
      setToast({ type: "success", message: `已导出 ${name}` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "导出失败" });
    } finally {
      setExportingLogs(false);
    }
  };

  const handleDownloadLog = async (name: string) => {
    setDownloadingLog(name);
    try {
      await downloadAppLogApi(name);
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "下载失败" });
    } finally {
      setDownloadingLog(null);
    }
  };

  const handleDeleteLog = async (name: string) => {
    setDeletingLog(name);
    try {
      await deleteAppLogApi(name);
      setToast({ type: "success", message: `已删除 ${name}` });
      if (tailName === name) {
        setTailName(null);
        setTailData(null);
      }
      await loadLogs();
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "删除失败" });
    } finally {
      setDeletingLog(null);
    }
  };

  const handlePruneLogs = async () => {
    setPruningLogs(true);
    try {
      const r = await pruneAppLogsApi();
      if (r.skipped) {
        setToast({ type: "success", message: "保留策略未启用（或两条上限均为 0），未做清理" });
      } else if (r.removed.length === 0) {
        setToast({ type: "success", message: "没有需要清理的日志" });
      } else {
        setToast({ type: "success", message: `已清理 ${r.removed.length} 个文件，释放 ${fmtSize(r.freedBytes)}` });
      }
      await loadLogs();
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "清理失败" });
    } finally {
      setPruningLogs(false);
    }
  };

  // ============ 目录镜像（系统设置 → 目录镜像） ============
  const [mirrorStates, setMirrorStates] = useState<MirrorRuntimeState[]>([]);
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const [mirrorSyncing, setMirrorSyncing] = useState(false);
  // 通知测试（设置 → 通知配置 → 「发送测试通知」）
  const [notifTesting, setNotifTesting] = useState(false);
  const [notifTestResult, setNotifTestResult] = useState<string | null>(null);
  // SMTP 密码小眼睛（设置页原本无锁图标，故 lockIcon={false}）
  const [showEmailPassword, setShowEmailPassword] = useState(false);
  // Webhook 签名密钥小眼睛
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  /** 通知自检状态：密钥来源（env / 配置 / 未设）与是否已加密落盘 */
  const [notifyStatus, setNotifyStatus] = useState<NotifyRuntimeStatus | null>(null);

  // 进入「通知配置」时拉一次自检状态（密钥来源、加密状态、无源事件）
  useEffect(() => {
    if (activeSection !== "notifications") return;
    let alive = true;
    void (async () => {
      try {
        const st = await fetchNotifyStatusApi();
        if (alive) setNotifyStatus(st);
      } catch {
        /* 自检失败不阻塞设置页（只是少了「来自环境变量」这类提示） */
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeSection]);

  const loadMirror = useCallback(async () => {
    setMirrorLoading(true);
    setMirrorError(null);
    try {
      setMirrorStates(await fetchMirrorStatusApi());
    } catch (e: any) {
      setMirrorError(e?.message || "获取镜像状态失败");
    } finally {
      setMirrorLoading(false);
    }
  }, []);

  // 进入该分区时加载一次，并每 15 秒刷新运行态（同步结果 / 监听是否掉线）
  useEffect(() => {
    // 分区已由 "mirror" 并入 "appinfo"（v1.38.0）
    if (activeSection !== "backup") return () => {};
    void loadMirror();
    const t = setInterval(() => void loadMirror(), 15000);
    return () => clearInterval(t);
  }, [activeSection, loadMirror]);

  const handleMirrorSyncNow = async () => {
    setMirrorSyncing(true);
    try {
      const r = await syncMirrorNowApi();
      setMirrorStates(r);
      const bad = r.filter((s) => s.enabled && !s.valid);
      if (bad.length > 0) {
        setToast({ type: "error", message: `同步失败：${bad[0].invalidReason || "目标路径不可用"}` });
      } else {
        setToast({ type: "success", message: "已立即同步" });
      }
    } catch (e: any) {
      setToast({ type: "error", message: e?.message || "同步失败" });
    } finally {
      setMirrorSyncing(false);
    }
  };

  /**
   * 发送测试通知。
   * ★ 必须**先保存再发**：后端读的是 settings.json，页面上刚填的 URL / 密码还没落盘时
   *   直接发会拿旧（空）配置去发，表现为「测试失败」但其实配置是对的 —— 极易误判。
   */
  const handleTestNotify = async () => {
    setNotifTesting(true);
    setNotifTestResult(null);
    try {
      const saved = await handleSave();
      if (!saved) {
        setNotifTestResult("配置未通过校验或未能落盘，已中止发送（否则会拿旧配置去发）。");
        return;
      }
      const r = await testNotifyApi();
      const parts: string[] = [];
      parts.push(r.webhook === "sent" ? "Webhook 已发送" : r.webhook === "failed" ? "Webhook 失败" : "Webhook 未配置（跳过）");
      parts.push(r.email === "sent" ? "邮件已发送" : r.email === "failed" ? "邮件失败" : "邮件未配置完整（跳过）");
      const msg = parts.join("；");
      if (r.errors.length) {
        setNotifTestResult(`${msg}\n失败原因：${r.errors.join("；")}`);
        setToast({ type: "error", message: msg });
      } else {
        // 两个通道都是「跳过」＝ 什么都没发出去 ⇒ 用 error 色调提示用户去补配置
        const nothing = r.webhook === "skipped" && r.email === "skipped";
        const msg2 = nothing ? "两个通道都未配置完整，什么都没发出去" : msg;
        setNotifTestResult(nothing ? `${msg2}。请检查上方 Webhook URL / SMTP、收件人是否填全。` : msg2);
        setToast({ type: nothing ? "error" : "success", message: msg2 });
      }
    } catch (e: any) {
      setNotifTestResult(`发送失败：${e?.message || e}`);
      setToast({ type: "error", message: e?.message || "发送测试通知失败" });
    } finally {
      setNotifTesting(false);
    }
  };

  const sections = [
    { key: "docker", label: "引擎配置", icon: <Container size={16} /> },
    { key: "user", label: "用户", icon: <User size={16} /> },
    { key: "tags", label: "标签管理", icon: <TagsIcon size={16} /> },
    { key: "compose", label: "Compose 管理", icon: <FileCode2 size={16} /> },
    { key: "modal", label: "弹窗设置", icon: <Timer size={16} /> },
    { key: "notifications", label: "通知", icon: <Bell size={16} /> },
    { key: "backup", label: "备份管理", icon: <Package size={16} /> },
    { key: "scheduler", label: "镜像更新", icon: <Clock size={16} /> },
    { key: "activity", label: "硬件信息", icon: <Activity size={16} /> },
    { key: "update", label: "系统更新", icon: <Download size={16} /> },
    { key: "applogs", label: "日志", icon: <FileText size={16} /> },
    { key: "colvis", label: "列显隐", icon: <Columns size={16} /> },
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

  // 应用设置里的加速源列表：现仅作为「拉取时改写镜像名」与旧接口的输入，
  // 编辑入口已改为下面的 daemon.json 编辑器（保存时自动同步回此列表）
  const mirrors = Array.isArray(data.docker?.registryMirrors) ? data.docker.registryMirrors : [];
  // 实测可用的公益 Docker Hub 加速源（2026-08），用户可一键填入编辑器
  const RECOMMENDED_MIRRORS: { url: string; label: string }[] = [
    { url: "https://docker.xuanyuan.me", label: "轩辕镜像（公益免费，实测 ~12MB/s）" },
    { url: "https://docker.1ms.run", label: "毫秒镜像（稳定）" },
    { url: "https://docker.1panel.live", label: "1Panel 镜像（实测可用）" },
    { url: "https://hub.1panel.dev", label: "1Panel Hub 镜像（实测可用）" },
  ];
  /** 把推荐加速源合并进编辑器内容（保留其它配置键）；只改编辑区，仍需点保存才落盘 */
  const insertRecommendedMirrors = () => {
    let parsed: Record<string, unknown> = {};
    if (daemonText.trim()) {
      let v: unknown;
      try {
        v = JSON.parse(daemonText);
      } catch {
        setToast({ type: "error", message: "当前 JSON 无法解析，请先修正后再填入" });
        return;
      }
      if (!v || typeof v !== "object" || Array.isArray(v)) {
        setToast({ type: "error", message: "当前内容顶层不是 JSON 对象，无法填入" });
        return;
      }
      parsed = v as Record<string, unknown>;
    }
    const current = Array.isArray(parsed["registry-mirrors"])
      ? (parsed["registry-mirrors"] as unknown[]).map((x) => String(x)).filter((x) => x.trim())
      : mirrors.filter((m) => m.trim());
    const existing = new Set(current.map((m) => m.trim()));
    const toAdd = RECOMMENDED_MIRRORS.filter((r) => !existing.has(r.url)).map((r) => r.url);
    if (toAdd.length === 0) {
      setToast({ type: "success", message: "推荐加速源已存在" });
      return;
    }
    const text = JSON.stringify({ ...parsed, "registry-mirrors": [...current, ...toAdd] }, null, 2) + "\n";
    setDaemonText(text);
    markDaemonDirty(text !== daemonSavedTextRef.current);
    setToast({ type: "success", message: `已填入 ${toAdd.length} 个推荐加速源，点「保存到 daemon.json」写入` });
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
                        onClick={() =>
                          daemon?.elevate === "none"
                            ? handleRefreshPrivileges()
                            : daemonDirty
                            ? setAskReload(true)
                            : loadDaemon()
                        }
                        disabled={daemonLoading}
                        title={daemon?.elevate === "none" ? "重新检测写入权限" : "重新读取 daemon.json（丢弃未保存修改）"}
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
                    下方编辑器内即宿主机{" "}
                    <code className="px-1 py-0.5 bg-slate-100 rounded text-[11px]">
                      {daemon?.path || "/etc/docker/daemon.json"}
                    </code>{" "}
                    的完整内容（打开页面时以文件为准回读），可直接修改；点「保存到 daemon.json」整份写回，
                    写前自动备份到应用数据目录。
                    <span className="text-amber-600"> 保存后需重启 Docker 才会生效。</span>
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
                            onClick={() => handleCopyText(daemon.hint || "")}
                            className="mt-1.5 text-xs text-blue-600 hover:underline"
                          >
                            复制命令
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {/* daemon.json 编辑器：展示与编辑的就是文件内容本身 */}
                  <JsonEditor
                    value={daemonText}
                    onChange={(v) => {
                      setDaemonText(v);
                      markDaemonDirty(v !== daemonSavedTextRef.current);
                    }}
                    onValidChange={setDaemonJsonOk}
                    minHeight={300}
                    title="daemon.json（编辑内容即文件内容）"
                    readOnly={daemon?.elevate === "none"}
                    placeholder={'{\n  "registry-mirrors": []\n}'}
                  />

                  {/* 保存 / 重置：保存写入宿主文件，成功后询问是否重启 Docker */}
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => writeDaemonFromEditor()}
                      disabled={savingDaemon || daemon?.elevate === "none" || !daemonJsonOk}
                      title="把编辑器内容整份写入 /etc/docker/daemon.json（写前自动备份）"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingDaemon ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                      保存到 daemon.json
                    </button>
                    <button
                      type="button"
                      onClick={resetDaemonText}
                      disabled={!daemonDirty || savingDaemon}
                      title="放弃未保存的修改，恢复为磁盘上的内容"
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Undo2 size={13} /> 重置
                    </button>
                    {daemonDirty && (
                      <span className="text-[11px] text-amber-600">● 有未保存的修改</span>
                    )}
                  </div>

                  {/* 推荐加速源：实测可用的公益 Docker Hub 代理，一键填入 */}
                  <div className="mt-3 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-xs font-medium text-blue-800">推荐加速源（Docker Hub 代理，2026-08 实测可用）</p>
                      <button
                        type="button"
                        onClick={insertRecommendedMirrors}
                        disabled={daemon?.elevate === "none"}
                        className="shrink-0 flex items-center gap-1 px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Zap size={12} /> 填入编辑器
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
                      文件中还包含其它配置项（随编辑器内容一并写入 / 原样保留）：{daemon.otherKeys.join("、")}
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

        {activeSection === "notifications" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">通知</h2>
              <p className="text-sm text-slate-500">容器异常、更新完成等事件推送到 Webhook / 邮箱</p>
            </div>

            <Card title="Webhook 通知" icon={<Webhook size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用 Webhook 推送</span>
                  <Toggle active={data.notifications.webhookEnabled} onChange={(val) => update("notifications", "webhookEnabled", val)} />
                </div>
                {data.notifications.webhookEnabled && (
                  <>
                    <FormField label="Webhook URL" hint="支持钉钉 / 企业微信 / Slack / 飞书等机器人 Webhook">
                      <Input value={data.notifications.webhookUrl} onChange={(val) => update("notifications", "webhookUrl", val)} placeholder="https://oapi.dingtalk.com/robot/send?access_token=..." />
                    </FormField>
                    <SecretField
                      label="签名密钥（可选）"
                      hint="填写后每次推送带 x-docker-manager-signature: sha256=… 头，接收方可验签防伪造"
                      value={data.notifications.webhookSecret}
                      onChange={(val) => update("notifications", "webhookSecret", val)}
                      onClear={() => update("notifications", "webhookSecret", SECRET_CLEAR)}
                      placeholder="留空 = 不签名"
                      visible={showWebhookSecret}
                      onToggle={() => setShowWebhookSecret((v) => !v)}
                      isSet={data.notifications.webhookSecretSet}
                      envVar={notifyStatus?.secretSource?.webhookSecret === "env" ? "DMS_WEBHOOK_SECRET" : undefined}
                    />
                  </>
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
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField label="SMTP 服务器">
                        <Input value={data.notifications.emailSmtp} onChange={(val) => update("notifications", "emailSmtp", val)} placeholder="smtp.gmail.com" />
                      </FormField>
                      <FormField label="端口" hint="465 = 隐式 TLS；587 = STARTTLS">
                        <Input value={String(data.notifications.emailPort)} onChange={(val) => update("notifications", "emailPort", parseInt(val) || 587)} type="number" />
                      </FormField>
                      <FormField label="用户名">
                        <Input value={data.notifications.emailUser} onChange={(val) => update("notifications", "emailUser", val)} />
                      </FormField>
                      <SecretField
                        label="密码"
                        hint="多数云邮箱需用「授权码」而非登录密码"
                        value={data.notifications.emailPassword}
                        onChange={(val) => update("notifications", "emailPassword", val)}
                        onClear={() => update("notifications", "emailPassword", SECRET_CLEAR)}
                        placeholder="••••••••"
                        visible={showEmailPassword}
                        onToggle={() => setShowEmailPassword((v) => !v)}
                        isSet={data.notifications.emailPasswordSet}
                        envVar={notifyStatus?.secretSource?.smtpPassword === "env" ? "DMS_SMTP_PASSWORD" : undefined}
                      />
                      <FormField label="发件人" hint="留空 = 用用户名">
                        <Input value={data.notifications.emailFrom} onChange={(val) => update("notifications", "emailFrom", val)} placeholder="bot@example.com" />
                      </FormField>
                      <FormField label="收件人" hint="多个用逗号或分号分隔">
                        <Input value={data.notifications.emailTo} onChange={(val) => update("notifications", "emailTo", val)} placeholder="me@example.com" />
                      </FormField>
                    </div>
                    <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-100 rounded px-2.5 py-2 leading-relaxed">
                      部分云邮箱需先在邮箱设置里开启「SMTP 服务」并使用「授权码」而非登录密码；本工具不做 OAuth 登录。
                    </p>                  </>
                )}
              </div>
            </Card>

            <Card title="通知事件" icon={<Bell size={16} />}>
              <div className="space-y-3">
                {[
                  { key: "containerDown", label: "容器停止/异常", noSource: false },
                  { key: "updateAvailable", label: "检测到可用更新", noSource: false },
                  { key: "updateComplete", label: "更新完成（镜像拉取成功）", noSource: false },
                  { key: "buildFailed", label: "构建失败", noSource: true },
                ].map((evt) => (
                  <div key={evt.key} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">
                      {evt.label}
                      {evt.noSource && (
                        <span className="ml-2 text-[11px] text-slate-400">（本版本无镜像构建功能，暂无触发源）</span>
                      )}
                    </span>
                    <Toggle
                      active={data.notifications.events[evt.key as keyof typeof data.notifications.events]}
                      onChange={(val) => update("notifications", "events", { ...data.notifications.events, [evt.key]: val })}
                      size="sm"
                    />
                  </div>
                ))}
              </div>
            </Card>

            <Card title="测试" icon={<Send size={16} />}>
              <div className="space-y-3">
                <p className="text-xs text-slate-500 leading-relaxed">
                  点「发送测试通知」会<strong className="text-slate-700">先保存当前配置</strong>，再向两个通道各发一条测试消息。
                  两个通道都是「配置完整才发」，没配的那路会显示「跳过」。
                </p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleTestNotify()}
                    disabled={notifTesting}
                    className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
                  >
                    {notifTesting && <Loader2 size={14} className="animate-spin" />}
                    发送测试通知
                  </button>
                </div>
                {notifTestResult && (
                  <pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded px-2.5 py-2 text-slate-700">{notifTestResult}</pre>
                )}
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

            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">应用数据</h2>
              <p className="text-sm text-slate-500">
                应用运行态、安装位置与目录一览，以及「目录镜像」配置。目录路径可一键复制，便于排障、写脚本或在其它工具里挂载。
              </p>
            </div>

            <Card
              title="应用信息"
              icon={<Info size={16} />}
              actions={
                <IconButton
                  icon={<RefreshCw size={14} className={appInfoLoading ? "animate-spin" : ""} />}
                  onClick={() => void loadAppInfo()}
                  title="刷新"
                  disabled={appInfoLoading}
                />
              }
            >
              {appInfoError && <p className="text-xs text-red-500 mb-3">{appInfoError}</p>}
              {!appInfo ? (
                <p className="text-sm text-slate-400">{appInfoLoading ? "加载中…" : "暂无数据"}</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl font-bold text-blue-600 font-mono">v{appInfo.version}</span>
                    <span className="px-2 py-0.5 text-[11px] rounded-full bg-slate-100 text-slate-600 font-mono">
                      {appInfo.channel}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <InfoRow label="运行用户" value={appInfo.user} />
                    <InfoRow label="进程 PID" value={appInfo.pid} />
                    <InfoRow label="Node" value={appInfo.nodeVersion} />
                    <InfoRow label="平台" value={`${appInfo.platform} / ${appInfo.arch}`} />
                    <InfoRow label="启动时间" value={new Date(appInfo.startedAt).toLocaleString()} />
                    <InfoRow label="已运行" value={fmtUptimeCn(appInfo.uptimeSeconds)} />
                    <InfoRow label="活跃引擎" value={`${appInfo.engineName}（${appInfo.engineConnection}）`} />
                    <InfoRow label="引擎数量" value={`${appInfo.engineCount} 个`} />
                  </div>
                </div>
              )}
            </Card>

            <Card title="安装位置与目录" icon={<FolderOpen size={16} />}>
              {!appInfo ? (
                <p className="text-sm text-slate-400">{appInfoLoading ? "加载中…" : "暂无数据"}</p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {appInfo.dirs.map((d) => (
                    <div key={d.key} className="py-2.5 flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-slate-700">{d.label}</span>
                          {!d.exists && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-50 text-amber-600 border border-amber-200">
                              不存在
                            </span>
                          )}
                          {d.exists && (
                            <span className="text-[11px] text-slate-400">
                              {d.files} 个文件 · {d.truncated ? "≥ " : ""}
                              {fmtSize(d.sizeBytes)}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 font-mono break-all mt-0.5">{d.path}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">{d.note}</p>
                      </div>
                      <button
                        onClick={() => void copyDirPath(d.key, d.path)}
                        className="flex-shrink-0 flex items-center gap-1 px-2 py-1 text-[11px] text-slate-600 border border-slate-200 rounded hover:bg-slate-50"
                      >
                        {copiedDirKey === d.key ? <Check size={12} className="text-green-600" /> : <CopyIcon size={12} />}
                        {copiedDirKey === d.key ? "已复制" : "复制"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          


            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">目录镜像</h2>
              <p className="text-sm text-slate-500">
                把「备份目录」或「Compose 目录」在<b>另一个路径</b>再存一份，与原始目录实时同步。
                变更由文件监听即时触发（1 秒防抖合并），另有每 60 秒全量对账兜底。
              </p>
              <p className="text-xs text-amber-600 mt-1">
                ⚠️ 语义为<b>真镜像</b>：源目录里删除的文件 / 目录会同步从目标删除。因此目标路径不允许是源目录的上级或子目录。
              </p>
            </div>

            {mirrorError && <p className="text-xs text-red-500">{mirrorError}</p>}

            {mirrorStates.length === 0 && (
              <p className="text-sm text-slate-400">{mirrorLoading ? "加载中…" : "暂无镜像状态"}</p>
            )}

            {mirrorStates.map((s) => (
              <Card
                key={s.key}
                title={s.label}
                icon={<FolderOpen size={16} />}
                actions={
                  <Toggle
                    active={data.mirror?.[s.key]?.enabled ?? false}
                    onChange={(v) =>
                      update("mirror", s.key, { ...(data.mirror?.[s.key] ?? { target: "" }), enabled: v })
                    }
                  />
                }
              >
                <div className="space-y-3">
                  <div className="flex items-start gap-2 text-xs">
                    <span className="text-slate-400 flex-shrink-0 pt-0.5">源目录</span>
                    <span className="font-mono text-slate-600 break-all">{s.source}</span>
                  </div>

                  <FormField
                    label="目标路径（绝对路径）"
                    hint="留空 = 关闭该项镜像。示例：/mnt/user/backup-mirror/backups"
                  >
                    <Input
                      value={data.mirror?.[s.key]?.target ?? ""}
                      onChange={(v) =>
                        update("mirror", s.key, { ...(data.mirror?.[s.key] ?? { enabled: false }), target: v })
                      }
                      placeholder="/mnt/user/backup-mirror"
                    />
                  </FormField>

                  {(data.mirror?.[s.key]?.enabled ?? false) && (data.mirror?.[s.key]?.target ?? "").trim() !== "" && (
                    <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                      {!s.valid ? (
                        <p className="text-xs text-red-600">目标路径不可用：{s.invalidReason}</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-4 text-xs flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 ${
                                s.watcherActive ? "text-green-600" : "text-amber-600"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  s.watcherActive ? "bg-green-500" : "bg-amber-500"
                                }`}
                              />
                              {s.watcherActive ? "文件监听已生效（实时同步）" : "递归监听不可用，仅 60 秒轮询兜底"}
                            </span>
                            {s.syncing && <span className="text-blue-600">同步中…</span>}
                          </div>
                          <div className="text-xs text-slate-500">
                            上次同步：{s.lastSyncAt ? new Date(s.lastSyncAt).toLocaleString() : "尚未同步"} · 耗时{" "}
                            {s.lastDurationMs} ms · 源 {s.sourceFiles} 个文件 / 目标 {s.targetFiles} 个文件 · 上次复制{" "}
                            {s.copied} 个{s.deleted > 0 ? ` / 删除 ${s.deleted} 个` : ""}
                          </div>
                          {s.lastError && <p className="text-xs text-red-600">最近错误：{s.lastError}</p>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            ))}

            <div className="flex items-center gap-2">
              <button
                onClick={handleMirrorSyncNow}
                disabled={mirrorSyncing}
                className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
              >
                <RefreshCw size={14} className={mirrorSyncing ? "animate-spin" : ""} />
                {mirrorSyncing ? "同步中…" : "立即同步"}
              </button>
              <span className="text-xs text-slate-400">开关与路径需点 APPLY 保存后生效</span>
            </div>
          

            {/* 备份路径与开关 */}
            <Card title="备份设置" icon={<HardDrive size={16} />}>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-600">启用三级备份策略（周 / 月 / 年）</span>
                  <Toggle active={data.backup.autoBackupEnabled} onChange={(val) => update("backup", "autoBackupEnabled", val)} />
                </div>
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                  <ShieldCheck size={14} className="text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-600">备份时自动修复读权限</p>
                    <p className="text-xs text-slate-400">
                      遇 EACCES 时，仅对「属主是自己」的文件补属主读位后重试；不改动其他权限位、不改变归属
                    </p>
                  </div>
                  <Toggle
                    active={data.backup.autoFixReadPerm !== false}
                    onChange={(val) => update("backup", "autoFixReadPerm", val)}
                  />
                </div>
                <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-lg">
                  <Clock size={14} className="text-slate-400" />
                  <span className="text-xs text-slate-500">上次备份时间</span>
                  <span className="text-xs font-medium text-slate-600 ml-auto">{lastBackupAt}</span>
                </div>
              </div>
            </Card>

            {/* 三级备份策略（周 / 月 / 年）：只读列出，由总开关统一控制 */}
            <Card title="三级备份策略（周 / 月 / 年）" icon={<Calendar size={16} />}>
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50/60">
                  <Calendar size={16} className="text-blue-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">每周备份</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      每周 <b>{({ Sunday: "周日", Monday: "周一", Tuesday: "周二", Wednesday: "周三", Thursday: "周四", Friday: "周五", Saturday: "周六" } as Record<string, string>)[data.backup.weekly.day] ?? data.backup.weekly.day}</b>{" "}
                      {data.backup.weekly.time} 执行 1 次全量备份，保留 <b>{data.backup.weekly.retention}</b> 份，滚动式清理。
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50/60">
                  <Calendar size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">每月备份</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {data.backup.monthly.dayOfMonth <= 0 ? "每月最后一天" : `每月 ${data.backup.monthly.dayOfMonth} 日`}{" "}
                      {data.backup.monthly.time} 执行 1 次全量备份，保留 <b>{data.backup.monthly.retention}</b> 份，滚动式清理。
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50/60">
                  <InfinityIcon size={16} className="text-green-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-700">每年备份</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {data.backup.yearly.date === "12-31" ? "每年最后一天" : `每年 ${data.backup.yearly.date}`}{" "}
                      {data.backup.yearly.time} 执行 1 次全量备份，长期归档、<b>永久保存，不自动删除</b>。
                    </p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                由上方「启用三级备份策略」总开关统一控制三档的开启与关闭。
              </p>
            </Card>

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
                        <span className="text-blue-500">{backupLabel(b.name)}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleDownloadBackup(b.name)}
                      disabled={downloadingBackup !== null}
                      className="text-slate-400 hover:text-blue-500 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="下载此备份"
                    >
                      {downloadingBackup === b.name ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                    </button>
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
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleCreateBackup}
                  disabled={backupCreating}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                >
                  {backupCreating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {backupCreating ? "备份中…" : "立即备份"}
                </button>
                <button
                  onClick={() => { setBackupRestoreError(null); setRestoringBackup(backups && backups.length > 0 ? backups[0].name : ""); }}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
                >
                  <Upload size={14} /> 从备份恢复
                </button>
                <button
                  onClick={() => backupUploadInputRef.current?.click()}
                  disabled={backupUploading || backupRestoring}
                  title="选择本地 .zip 备份文件直接恢复（无需先存入备份列表）"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {backupUploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {backupUploading ? "恢复中…" : "上传备份并恢复"}
                </button>
                <input
                  ref={backupUploadInputRef}
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleRestoreFromUpload(file);
                    e.target.value = "";
                  }}
                />
                <button
                  onClick={handleExportConfig}
                  disabled={exportingConfig}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                >
                  {exportingConfig ? <Loader2 size={14} className="animate-spin" /> : <Package size={14} />}
                  导出全部配置
                </button>
              </div>

              {/* 权限提示：优先展示上次备份的跳过项，否则展示只读体检结果 */}
              {(() => {
                const details = backupIssues?.details?.length ? backupIssues.details : permCheck?.issues || [];
                const fixed = backupIssues?.fixed || [];
                if (!details.length && !fixed.length) return null;
                const fixCmd = backupIssues?.fixCommand || permCheck?.fixCommand || "";
                return (
                  <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg p-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={16} className="text-amber-500 mt-0.5 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-amber-800">
                          {backupIssues?.skipped?.length
                            ? `上次备份跳过 ${backupIssues.skipped.length} 项（权限不足）`
                            : `检测到 ${permCheck?.issues?.length ?? 0} 个文件权限异常，备份时会被跳过`}
                        </p>
                        {fixed.length > 0 && (
                          <p className="text-xs mt-1 text-emerald-700">
                            已自动补正属主读权限 {fixed.length} 项：{fixed.map((f) => f.relPath).join("、")}
                          </p>
                        )}
                        {details.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {details.slice(0, 5).map((i) => (
                              <div key={i.relPath} className="text-xs">
                                <p className="font-mono break-all text-amber-900">{i.relPath}</p>
                                <p className="text-amber-700">{i.reason}</p>
                              </div>
                            ))}
                            {details.length > 5 && (
                              <p className="text-xs text-amber-700">…另有 {details.length - 5} 项，下面的命令会一并处理</p>
                            )}
                          </div>
                        )}

                        {fixCmd && (
                          <div className="mt-3">
                            <p className="text-xs text-amber-800">在服务器执行这一条命令即可（先体检、再修正，一步完成）：</p>
                            <div className="mt-1.5 flex items-start gap-2">
                              <code
                                ref={fixCmdRef}
                                className="flex-1 min-w-0 px-2 py-1.5 text-xs font-mono bg-white/70 border border-amber-300 rounded-md text-amber-900 break-all select-all"
                              >
                                {fixCmd}
                              </code>
                              <button
                                onClick={handleCopyFixCmd}
                                className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-amber-800 border border-amber-300 rounded-md hover:bg-amber-100"
                              >
                                {copiedFixCmd ? <Check size={11} /> : <CopyIcon size={11} />}
                                {copiedFixCmd ? "已复制" : "复制"}
                              </button>
                            </div>
                            <p className="mt-1.5 text-xs text-amber-600">
                              默认只修正属主、不改动权限位，不会把 0600 的密钥文件放开成 0644。
                            </p>
                          </div>
                        )}

                        <div className="mt-3">
                          <button
                            onClick={() => loadPermCheck(true)}
                            disabled={permChecking}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs text-amber-800 border border-amber-300 rounded-md hover:bg-amber-100 disabled:opacity-50"
                          >
                            <RefreshCw size={11} className={permChecking ? "animate-spin" : ""} /> 重新检测
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </div>
        )}

        {activeSection === "scheduler" && (
          <div className="max-w-2xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">镜像更新</h2>
              <p className="text-sm text-slate-500">全局自动检查镜像版本更新（基于 SHA-256 digest 精确比较），并可在镜像管理页手动「检查更新」</p>
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
            <ActivityPanel
              telemetryEnabled={data.telemetry?.enabled ?? true}
              onTelemetryEnabledChange={(val) => update("telemetry", "enabled", val)}
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

                {uploading && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm font-medium text-slate-700">正在上传更新包</p>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {uploadFileName ? `${uploadFileName} · ` : ""}
                        {uploadProgress
                          ? `${(uploadProgress.sent / 1048576).toFixed(1)} / ${(uploadProgress.total / 1048576).toFixed(1)} MB · ${Math.round((uploadProgress.sent / uploadProgress.total) * 100)}%`
                          : "准备中..."}
                      </span>
                    </div>
                    <div className="w-full h-2 bg-blue-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 transition-all duration-150"
                        style={{
                          width:
                            uploadProgress && uploadProgress.total > 0
                              ? `${Math.min(100, (uploadProgress.sent / uploadProgress.total) * 100)}%`
                              : "0%",
                        }}
                      />
                    </div>
                  </div>
                )}

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
                        <p className="text-xs text-slate-400 mt-0.5">
                          更新源：{updateInfo.source === "gitea" ? "自建 Gitea（优先）" : "GitHub Releases（保底）"}
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
                      <div className="flex items-center gap-3">
                        {updateInProgress && (
                          <button
                            onClick={handleCancelUpdate}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <X size={13} /> 取消升级
                          </button>
                        )}
                        <span className="text-sm font-mono font-semibold text-slate-600">{updateState.percent}%</span>
                      </div>
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

        {activeSection === "applogs" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">日志</h2>
              <p className="text-sm text-slate-500">
                日志按<b>频道</b>分为三类、各自独立文件并<b>可分别设置保留策略</b>：
                <span className="font-mono">app-</span>（应用运行）、
                <span className="font-mono">notify-</span>（Webhook / 邮件通知）、
                <span className="font-mono">oplog-</span>（用户操作记录），均按天分文件。
                可查看列表、读取尾部内容、导出为 zip，并自动清理。
              </p>
            </div>

            <Card
              title="保留策略"
              icon={<Timer size={16} />}
              actions={
                <IconButton
                  icon={<RefreshCw size={14} className={logsLoading ? "animate-spin" : ""} />}
                  onClick={() => void loadLogs()}
                  title="刷新"
                  disabled={logsLoading}
                />
              }
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-slate-600">启用自动清理</span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      关闭后日志永久保留、不再自动删除（当天的日志文件始终不会删）
                    </p>
                  </div>
                  <Toggle
                    active={data.logRetention?.enabled ?? true}
                    onChange={(v) => update("logRetention", "enabled", v)}
                  />
                </div>

                {(data.logRetention?.enabled ?? true) && (
                  <div className="space-y-5 pl-4 border-l-2 border-slate-100">
                    {/* 应用日志 ＝ 顶层，同时是另外两类未填时的取值来源 */}
                    <div>
                      <div className="text-xs font-medium text-slate-600 mb-2">
                        {LOG_CHANNEL_LABELS.app} <span className="font-mono text-slate-400">app-*.log</span>
                        <span className="ml-2 text-[10px] text-slate-400">另外两类未填时跟随这里</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField label="保留天数" hint="0 = 不限；超期的最先清理">
                          <Input
                            type="number"
                            value={String(data.logRetention?.maxDays ?? 365)}
                            onChange={(v) => update("logRetention", "maxDays", Math.max(0, Math.floor(Number(v) || 0)))}
                          />
                        </FormField>
                        <FormField label="总大小上限（MB）" hint="0 = 不限；超出后从最旧开始删">
                          <Input
                            type="number"
                            value={String(data.logRetention?.maxTotalMB ?? 1024)}
                            onChange={(v) => update("logRetention", "maxTotalMB", Math.max(0, Math.floor(Number(v) || 0)))}
                          />
                        </FormField>
                      </div>
                    </div>

                    {(["notify", "oplog"] as const).map((ch) => {
                      const ov = (data.logRetention?.[ch] || {}) as { maxDays?: number; maxTotalMB?: number };
                      const setOv = (k: "maxDays" | "maxTotalMB", raw: string) => {
                        const cur = { ...ov };
                        if (raw.trim() === "") delete cur[k];
                        else cur[k] = Math.max(0, Math.floor(Number(raw) || 0));
                        update("logRetention", ch, cur);
                      };
                      return (
                        <div key={ch}>
                          <div className="text-xs font-medium text-slate-600 mb-2">
                            {LOG_CHANNEL_LABELS[ch]} <span className="font-mono text-slate-400">{ch}-*.log</span>
                            <span className="ml-2 text-[10px] text-slate-400">
                              {ov.maxDays === undefined && ov.maxTotalMB === undefined ? "跟随「应用日志」" : "已单独设置"}
                            </span>
                            {(ov.maxDays !== undefined || ov.maxTotalMB !== undefined) && (
                              <button
                                type="button"
                                onClick={() => update("logRetention", ch, {})}
                                className="ml-2 text-[10px] text-blue-600 hover:underline"
                              >
                                恢复跟随
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-4">
                            <FormField label="保留天数" hint={`留空 = 跟随（当前 ${data.logRetention?.maxDays ?? 365} 天）`}>
                              <Input
                                type="number"
                                value={ov.maxDays === undefined ? "" : String(ov.maxDays)}
                                onChange={(v) => setOv("maxDays", v)}
                              />
                            </FormField>
                            <FormField label="总大小上限（MB）" hint={`留空 = 跟随（当前 ${data.logRetention?.maxTotalMB ?? 1024} MB）`}>
                              <Input
                                type="number"
                                value={ov.maxTotalMB === undefined ? "" : String(ov.maxTotalMB)}
                                onChange={(v) => setOv("maxTotalMB", v)}
                              />
                            </FormField>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <button
                    onClick={handlePruneLogs}
                    disabled={pruningLogs}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                  >
                    <Trash2 size={13} /> {pruningLogs ? "清理中…" : "立即清理"}
                  </button>
                  <button
                    onClick={handleExportLogs}
                    disabled={exportingLogs || !logsData || logsData.files.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50"
                  >
                    <Archive size={13} /> {exportingLogs ? "导出中…" : "导出全部（zip）"}
                  </button>
                  <span className="text-[11px] text-slate-400">
                    当前 {logsData?.files.length ?? 0} 个文件 · 合计 {fmtSize(logsData?.totalBytes ?? 0)}
                  </span>
                </div>
              </div>
            </Card>

            <Card title="日志文件" icon={<FileText size={16} />}>
              {logsError && <p className="text-xs text-red-500 mb-3">{logsError}</p>}
              {!logsData || logsData.files.length === 0 ? (
                <p className="text-sm text-slate-400">{logsLoading ? "加载中…" : "暂无日志文件"}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-slate-500 border-b border-slate-100">
                        <th className="text-left font-medium py-2">频道</th>
                        <th className="text-left font-medium py-2">文件名</th>
                        <th className="text-right font-medium py-2">大小</th>
                        <th className="text-left font-medium py-2 pl-4">最后写入</th>
                        <th className="text-right font-medium py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logsData.files.map((f) => (
                        <tr key={f.name} className="border-b border-slate-50 hover:bg-slate-50/60">
                          <td className="py-2">
                            <span className="px-1.5 py-0.5 text-[10px] rounded bg-slate-100 text-slate-600">
                              {LOG_CHANNEL_LABELS[f.channel] || f.channel}
                            </span>
                          </td>
                          <td className="py-2 font-mono text-xs text-slate-700">
                            {f.name}
                            {f.current && (
                              <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-green-50 text-green-600 border border-green-200">
                                写入中
                              </span>
                            )}
                          </td>
                          <td className="py-2 text-right text-xs text-slate-600 tabular-nums">{fmtSize(f.sizeBytes)}</td>
                          <td className="py-2 pl-4 text-xs text-slate-500">{new Date(f.mtime).toLocaleString()}</td>
                          <td className="py-2">
                            <div className="flex items-center justify-end gap-1">
                              <IconButton
                                size="sm"
                                icon={<Eye size={13} />}
                                title="查看尾部内容"
                                onClick={() => void openTail(f.name)}
                              />
                              <IconButton
                                size="sm"
                                icon={<Download size={13} />}
                                title="下载该文件"
                                onClick={() => void handleDownloadLog(f.name)}
                                disabled={downloadingLog === f.name}
                              />
                              <IconButton
                                size="sm"
                                variant="danger"
                                icon={<Trash2 size={13} />}
                                title={f.current ? "当天日志正在写入，不可删除" : "删除该文件"}
                                onClick={() => void handleDeleteLog(f.name)}
                                disabled={f.current || deletingLog === f.name}
                              />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        )}

        {activeSection === "colvis" && (
          <div className="max-w-3xl space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 mb-1">列显隐</h2>
              <p className="text-sm text-slate-500">
                集中设置各列表的显示列。固定列（图标 / 操作）始终显示、不可隐藏；其余列可自由勾选。
                全部取消勾选时仅保留固定列。修改后点击页面底部「保存设置」生效，各页面会在重新进入时回落。
              </p>
            </div>

            {COLVIS_PAGES.map((page) => {
              const stored = (data.columnVisibility as any)?.[page.key] as string[] | undefined;
              const allKeys = [...page.fixed, ...page.cols.map((c) => c[0])];
              const visibleSet = stored && stored.length > 0 ? new Set(stored) : new Set(allKeys);
              const setVisible = (keys: string[]) => update("columnVisibility", page.key, keys);
              const toggleCol = (key: string, checked: boolean) => {
                const next = new Set(visibleSet);
                if (checked) next.add(key); else next.delete(key);
                setVisible([...page.fixed, ...page.cols.map((c) => c[0]).filter((k) => next.has(k))]);
              };
              const selectAll = () => setVisible([...allKeys]);
              const resetPage = () => setVisible([]);
              return (
                <Card
                  key={page.key}
                  title={page.label}
                  icon={<Columns size={16} />}
                  actions={
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={selectAll} className="text-xs text-blue-600 hover:underline">全选</button>
                      <button type="button" onClick={resetPage} className="text-xs text-slate-500 hover:underline">重置</button>
                    </div>
                  }
                >
                  <div className="space-y-3">
                    <p className="text-xs text-slate-400">
                      固定列（始终显示）：
                      {page.fixed.map((f) => (
                        <span key={f} className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                          {f === "icon" ? "图标" : f === "actions" ? "操作" : f}
                        </span>
                      ))}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                      {page.cols.map(([key, label]) => (
                        <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={visibleSet.has(key)}
                            onChange={(e) => toggleCol(key, e.target.checked)}
                            className="rounded border-slate-300 text-blue-500 focus:ring-blue-500/20"
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                </Card>
              );
            })}
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
              <p className="text-sm text-slate-500">配置操作结果弹窗的自动关闭行为，以及容器详情的展示形式</p>
            </div>

            <Card title="容器详情视图" icon={<Columns size={16} />}>
              <FormField
                label="容器详情展示形式"
                hint="打开容器详情（基本信息 / 日志 / 资源监控 / 终端 / 文件）时的布局。「半页面」＝从右侧滑入、覆盖约半屏的抽屉，左侧列表仍可见；「弹窗」＝居中浮层。保存后立即生效。"
              >
                <div className="flex items-center gap-2 max-w-md">
                  {([
                    { value: "drawer", label: "半页面", desc: "右侧抽屉，覆盖约半屏" },
                    { value: "modal", label: "弹窗", desc: "居中浮层" },
                  ] as const).map((opt) => {
                    const active = (data.modal?.containerDetailStyle ?? "drawer") === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => update("modal", "containerDetailStyle", opt.value)}
                        className={`flex-1 rounded-lg border px-4 py-3 text-left transition-colors ${
                          active ? "border-blue-400 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        <div className={`text-sm font-medium ${active ? "text-blue-600" : "text-slate-700"}`}>{opt.label}</div>
                        <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </FormField>
            </Card>

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

        {/* daemon.json 写回后询问是否重启 Docker（左「重启」/ 右「暂不重启」） */}
        <ConfirmDialog
          open={askRestart}
          onClose={() => setAskRestart(false)}
          onConfirm={doRestartDocker}
          title="重启 Docker 使配置生效"
          message="daemon.json 已写入，需要重启 Docker 才会生效。重启不会停止运行中的容器，但管理面板会有几秒无法连接。是否立即重启 Docker？"
          confirmText="重启"
          cancelText="暂不重启"
          primaryFirst
          loading={restarting}
        />

        {/* 有未保存改动时点「刷新」：先确认丢弃 */}
        <ConfirmDialog
          open={askReload}
          onClose={() => setAskReload(false)}
          onConfirm={() => { setAskReload(false); loadDaemon(); }}
          title="重新读取 daemon.json"
          message="编辑器里有未保存的修改，重新读取会丢弃这些修改，并用磁盘上的内容覆盖编辑器。是否继续？"
          confirmText="丢弃并重新读取"
          cancelText="取消"
          danger
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
                onClick={() => handleCopyText(privilegeHint)}
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

        {/* 从备份恢复：选择备份文件 */}
        <Modal
          open={restoringBackup !== null}
          onClose={() => { if (!backupRestoring) { setRestoringBackup(null); setBackupRestoreError(null); } }}
          title="从备份恢复"
          size="md"
        >
          <p className="text-sm text-slate-600 mb-3">
            选择要恢复的备份包。恢复会覆盖当前 Compose 堆栈与设置 / 引擎配置，请谨慎操作。
          </p>
          {backups && backups.length > 0 ? (
            <div className="space-y-2 max-h-[50vh] overflow-y-auto">
              {backups.map((b) => (
                <label
                  key={b.name}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    restoringBackup === b.name ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="restore-backup"
                    className="mt-1"
                    checked={restoringBackup === b.name}
                    onChange={() => setRestoringBackup(b.name)}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-slate-700 font-medium font-mono truncate" title={b.name}>{b.name}</span>
                    <span className="block text-xs text-slate-400">
                      {new Date(b.mtime).toLocaleString()} • {fmtBackupSize(b.size)} • {backupLabel(b.name)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400 py-2">暂无可用备份，请先执行「立即备份」。</p>
          )}
          {backupRestoreError && <p className="mt-3 text-sm text-red-600">{backupRestoreError}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={() => { setRestoringBackup(null); setBackupRestoreError(null); }}
              disabled={backupRestoring}
              className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
            >
              取消
            </button>
            <button
              onClick={handleRestoreBackup}
              disabled={backupRestoring || !restoringBackup}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-white bg-red-500 rounded-lg hover:bg-red-600 disabled:opacity-50"
            >
              {backupRestoring && <Loader2 size={14} className="animate-spin" />}
              确认恢复
            </button>
          </div>
        </Modal>

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

        {/* 应用日志：尾部内容查看（只读） */}
        <Modal
          open={!!tailName}
          onClose={() => {
            setTailName(null);
            setTailData(null);
          }}
          title={tailName ? `日志内容 · ${tailName}` : "日志内容"}
          size="lg"
          dismissable
          footer={
            <div className="flex items-center gap-2">
              <div className="w-40">
                <Select
                  value={String(tailLines)}
                  onChange={(v) => {
                    const n = Number(v);
                    setTailLines(n);
                    if (tailName) void openTail(tailName, n);
                  }}
                  options={[
                    { value: "200", label: "末 200 行" },
                    { value: "500", label: "末 500 行" },
                    { value: "2000", label: "末 2000 行" },
                    { value: "5000", label: "末 5000 行" },
                  ]}
                />
              </div>
              <button
                onClick={() => tailName && void openTail(tailName)}
                className="px-3 py-1.5 text-xs text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                刷新
              </button>
              <button
                onClick={() => tailName && void handleDownloadLog(tailName)}
                className="px-3 py-1.5 text-xs text-white bg-blue-500 rounded-lg hover:bg-blue-600"
              >
                下载该文件
              </button>
            </div>
          }
        >
          {tailLoading ? (
            <p className="text-sm text-slate-400">加载中…</p>
          ) : !tailData ? (
            <p className="text-sm text-slate-400">暂无内容</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                {tailData.headTruncated ? "仅显示文件末尾片段；" : ""}共 {tailData.lines.length} 行 · 文件大小{" "}
                {fmtSize(tailData.sizeBytes)}
              </p>
              <pre className="max-h-[60vh] overflow-auto rounded-lg bg-slate-900 text-slate-100 text-[11px] leading-relaxed p-3 font-mono whitespace-pre-wrap break-all">
                {tailData.lines.join("\n")}
              </pre>
            </div>
          )}
        </Modal>


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

