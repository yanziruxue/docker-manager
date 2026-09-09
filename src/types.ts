// ============ 基础类型 ============

export type ContainerStatus = "running" | "stopped" | "paused" | "restarting" | "updating";
export type StackStatus = "running" | "stopped" | "partial" | "error" | "updating";
export type RestartPolicy = "always" | "unless-stopped" | "on-failure" | "no";
export type NetworkMode = "bridge" | "host" | "macvlan" | "custom";
export type PullPolicy = "always" | "ifnotpresent";

// ============ 容器相关 ============

export interface PortMapping {
  host: string;
  container: string;
  protocol: "tcp" | "udp";
}

export interface VolumeMapping {
  hostPath: string;
  containerPath: string;
  mode: "rw" | "ro";
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number; // MB
  memoryLimit: number; // MB
  netInput: number; // KB
  netOutput: number; // KB
  blockInput: number; // KB
  blockOutput: number; // KB
}

/** 引擎级资源汇总（仪表盘资源监控，真实数据） */
export interface EngineResourceStats {
  ncpu: number;
  memTotalMB: number;
  runningContainers: number;
  sampledContainers: number;
  cpuPercent: number; // 运行容器 CPU 合计（%）
  cpuMaxPercent: number; // ncpu * 100
  memoryUsageMB: number; // 运行容器内存合计（MB）
  imageDiskMB: number; // 镜像磁盘占用（MB）
  volumeDiskMB: number; // 数据卷磁盘占用（MB）
  netRxKBps: number; // 实时接收速率（KB/s，与上次采样差分）
  netTxKBps: number; // 实时发送速率（KB/s，与上次采样差分）
  blockReadKB: number;
  blockWriteKB: number;
  serverVersion: string;
}

/** 镜像拉取任务（后台任务系统） */
export interface PullTask {
  id: string;
  engineId: string;
  image: string;
  status: "pulling" | "success" | "error" | "canceled";
  startedAt: number;
  endedAt?: number;
  error?: string;
  /** 各镜像层进度（Downloading / Extracting / Pull complete ...） */
  layers: { id: string; status: string; progress?: string; current?: number; total?: number }[];
  /** 最近输出行（详情弹窗展示） */
  outputTail: string[];
}

/** 自定义彩色标签（系统设置「标签管理」维护的全局标签库条目）。
 * 标签挂载在堆栈编辑器的 LABELS 页每个服务条目上，交叉引用后同步到容器/堆栈列表展示。 */
export interface ResourceTag {
  id: string;
  name: string;
  /** 色板中的 6 位十六进制色值，如 "#ef4444" */
  color: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  imageId?: string; // 完整镜像 ID (sha256:...)，用于交叉引用解析镜像名
  status: ContainerStatus;
  ports: PortMapping[];
  ip: string;
  uptime: string;
  autoStart: boolean;
  restartPolicy: string; // always / unless-stopped / on-failure / no
  icon?: string;
  stackId?: string; // 所属堆栈
  networkMode: NetworkMode;
  createdAt: string;
  stats?: ContainerStats;
  hasUpdate?: boolean;
  webuiUrl?: string;
  /** 来自所属堆栈 LABELS 页的彩色标签（完整对象，直接带颜色渲染） */
  tags?: ResourceTag[];
}

// ============ 模板相关 ============

export interface ContainerTemplate {
  id: string;
  name: string;
  icon?: string;
  description: string;
  image: string;
  pullPolicy: PullPolicy;
  networkMode: NetworkMode;
  ports: PortMapping[];
  volumes: VolumeMapping[];
  env: EnvVar[];
  // 高级配置
  puid?: string;
  pgid?: string;
  memoryLimit?: number; // MB
  cpuLimit?: number;
  cpuShares?: number;
  restartPolicy: RestartPolicy;
  extraHosts?: string[];
  shmSize?: string;
  devices?: string[];
  privileged?: boolean;
  extraArgs?: string;
  category: string;
  createdAt: string;
}

export interface StackTemplate {
  id: string;
  name: string;
  icon?: string;
  description: string;
  composeContent: string;
  envContent: string;
  category: string;
  createdAt: string;
}

// ============ 堆栈相关 ============

export interface StackContainer {
  name: string;
  image: string;
  tag: string;
  status: ContainerStatus;
  network: string;
  ip: string;
  ports: string; // 合并格式：宿主机端口:容器端口/协议（如 8807:8080/tcp），逗号分隔多条
  hasUpdate: boolean;
  sha256?: string;
  isPinned?: boolean; // @sha256 引用
}

export interface StackWebUILabel {
  serviceName: string;
  iconUrl: string;
  webuiPort: string;
  webuiUrl: string;
  defaultShell: string;
  /** 该服务（对应实际容器）挂载的彩色标签（来自全局标签库的快照对象） */
  tags?: ResourceTag[];
}

export interface StackSettings {
  name: string;
  description: string;
  iconUrl: string;
  defaultProfiles: string[];
  externalComposePath: string;
  externalEnvPath: string;
  autoStart: boolean;
  forceRecreate: boolean;
  dockerTimeout: number;
  stopTimeout: number;
  autoUpdateEnabled: boolean;
  autoUpdateMode: "notify" | "auto";
  visible: boolean; // 是否在容器列表中显示
}

export interface Stack {
  id: string;
  name: string;
  status: StackStatus;
  totalContainers: number;
  runningContainers: number;
  uptime: string;
  description: string;
  composeFilePath: string;
  autoStart: boolean;
  restartPolicy?: string;
  icon?: string;
  containers: StackContainer[];
  hasBuild: boolean; // 是否检测到 build: 字段
  hasUpdate: boolean;
  locked: boolean; // 是否正在执行操作
  isIndirect: boolean; // 间接堆栈
  isGitSource: boolean;
  profiles: string[];
  settings: StackSettings;
  envContent: string;
  webuiLabels: StackWebUILabel[];
  composeContent: string;
}

// ============ 镜像相关 ============

export interface DockerImage {
  id: string;
  repository: string;
  tag: string;
  size: string;
  createdAt: string;
  associatedContainers: string[]; // 关联容器名称列表
  associatedCount: number;        // 关联容器数量
  isDangling: boolean;
  sha256: string;
}

// ============ 数据卷相关 ============

export interface DockerVolume {
  id: string;
  name: string;
  driver: string; // local, nfs, etc.
  mountpoint: string;
  size: string;
  createdAt: string;
  associatedContainers: string[];
  labels?: { key: string; value: string }[];
  options?: { key: string; value: string }[];
  inUse: boolean;
}

// ============ 系统设置 ============

/** 单个 Docker Engine 连接 */
export interface DockerEngine {
  id: string;
  name: string; // 用户自定义名称
  connectionType: "socket" | "tcp" | "ssh";
  socketPath: string;
  tcpAddress: string;
  // SSH 连接参数
  sshHost: string;
  sshPort: number;
  sshUsername: string;
  sshAuthType: "password" | "key";
  sshPassword: string;
  sshKey: string;
  sshPassphrase: string;
  status: "connected" | "disconnected" | "error";
  dockerVersion?: string; // 连接成功后获取，如 "v24.0.7"
  errorMessage?: string; // 连接失败时的错误信息
}

export interface DockerConfig {
  engines: DockerEngine[];
  activeEngineId: string; // 当前选中的引擎
  defaultRestartPolicy: RestartPolicy;
  defaultNetworkMode: NetworkMode;
  pollingInterval: number; // seconds
  // 默认环境变量（全局）
  puid: string;
  pgid: string;
  tz: string;
  // 存储路径
  composeStoragePath: string; // docker-compose.yml 默认存储目录
  // Compose 命令模式: "auto" | "plugin" | "standalone"
  composeMode: "auto" | "plugin" | "standalone";
  // 菜单显示语言: "en" | "zh"
  menuLanguage: "en" | "zh";
  // 日志级别: "debug" | "info" | "warn" | "error"
  logLevel: "debug" | "info" | "warn" | "error";
  // 镜像加速源列表，与宿主机 /etc/docker/daemon.json 的 registry-mirrors 双向同步
  registryMirrors: string[];
  // 拉取时是否把镜像名改写为 <加速源>/<仓库>（旧版兼容开关，默认 false，改由 daemon.json 生效）
  rewriteImageNames?: boolean;
}

export interface RegistryConfig {
  id: string;
  name: string;
  url: string;
  username: string;
  password: string;
  isMirror: boolean;
}

export interface NotificationConfig {
  webhookEnabled: boolean;
  webhookUrl: string;
  emailEnabled: boolean;
  emailSmtp: string;
  emailPort: number;
  emailUser: string;
  events: {
    containerDown: boolean;
    updateAvailable: boolean;
    updateComplete: boolean;
    buildFailed: boolean;
  };
}

// ============ 备份配置 ============

/** 备份模式：1 = 三级备份策略（周/月/年），2 = 简单备份 */
export type BackupMode = 1 | 2;

/** 周备份配置 */
export interface WeeklyBackupConfig {
  enabled: boolean;
  day: string; // 星期几，如 "Saturday"
  time: string; // 执行时间，如 "23:00"
  retention: number; // 保留份数，4-8
}

/** 月备份配置 */
export interface MonthlyBackupConfig {
  enabled: boolean;
  dayOfMonth: number; // 每月几号执行，0 = 最后一天
  time: string;
  retention: number; // 保留份数，6-12
}

/** 年备份配置（永久保存） */
export interface YearlyBackupConfig {
  enabled: boolean;
  date: string; // 日期，如 "12-31"
  time: string;
  // 年备份永久保存，不自动删除
}

export interface BackupConfig {
  mode: BackupMode;
  autoBackupEnabled: boolean;
  backupPath: string; // 备份存储路径
  lastBackup: string;
  // 模式 2：简单备份
  simpleFrequency: string; // cron 表达式
  simpleRetentionCount: number;
  // 模式 1：三级备份策略
  weekly: WeeklyBackupConfig;
  monthly: MonthlyBackupConfig;
  yearly: YearlyBackupConfig;
}

export interface PathFavorite {
  id: string;
  name: string;
  path: string;
}

export interface UpdateSchedulerConfig {
  enabled: boolean;
  checkFrequency: string; // e.g. "0 3 * * *"
  autoPull: boolean;
}

export interface UserConfig {
  /** 登录用户名（历史字段：已由鉴权账户体系接管，保留仅为兼容旧配置，不再展示/编辑） */
  username?: string;
  sessionTimeout: number; // minutes
}

/** 系统更新（OTA）配置 */
export interface UpdateConfig {
  /** 是否自动检查更新（仓库地址已固定写死在后端，无需配置） */
  autoCheck: boolean;
  /** 自动更新：自动检查到新版本后自动下载并应用（仅 autoCheck 开启时可启用） */
  autoUpdate: boolean;
  /** 忽略的版本号：等于该版本时不显示更新提示（空 = 不忽略） */
  ignoredVersion: string;
}

/** 弹窗设置（系统设置 → 弹窗设置 维护） */
export interface ModalConfig {
  /** 操作结果弹窗自动关闭延迟（秒）；0 = 不自动关闭 */
  autoCloseDelay: number;
}

/** 列可见性默认配置 */
export interface ColumnVisibility {
  containers: string[];  // 容器管理页面默认可见列
  images: string[];      // 镜像管理页面默认可见列
  volumes: string[];     // 数据卷管理页面默认可见列
  stackList: string[];   // 堆栈管理页面（主表格）默认可见列
  stacks: string[];      // 容器子表默认可见列（与 stackList 完全独立）
}

/** Compose 一键填入模板项 */
export interface ComposeTemplate {
  /** 模板内容（可多行 compose 文本，缩进由用户手动输入） */
  content: string;
  /** 填入位置：service = services 下第一个服务内部；end = 追加到 compose 文本最后一行 */
  insert: "service" | "end";
}

/** Compose 模板设置（系统设置 → Compose 管理 维护） */
export interface ComposeConfig {
  /** 一键填入模板项 */
  templates: ComposeTemplate[];
}

// ============ 系统更新（OTA）类型 ============

/** 更新阶段 */
export type UpdatePhase = "idle" | "downloading" | "extracting" | "replacing" | "done" | "error";

/** GitHub Releases 检查返回的最新版本信息 */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseName: string;
  releaseNotes: string;
  publishedAt: string;
  assetName: string;
  assetSize: number;
  downloadUrl: string;
  htmlUrl: string;
}

/** 更新进度（前端轮询） */
export interface UpdateState {
  phase: UpdatePhase;
  message: string;
  percent: number;
  error?: string;
  /** 已下载字节数（仅 downloading 阶段有意义） */
  bytesReceived?: number;
  /** 总字节数，Content-Length 缺失时为 0 */
  bytesTotal?: number;
  /** 当前下载速度，字节/秒 */
  speedBps?: number;
  /** 预计剩余秒数；未测出时为 null */
  etaSeconds?: number | null;
}

/** 安装量与活跃度遥测上报配置（仅上报端，不含聚合统计） */
export interface TelemetryConfig {
  /** 是否启用上报（默认开启，可在「活跃度」页关闭） */
  enabled: boolean;
  /** 统计服务端地址（上报与拉取出数的基址） */
  endpoint: string;
  /** 是否采集硬件指纹（仅风控用，不参与统计去重） */
  collectHwFingerprint: boolean;
}

export interface SystemSettings {
  docker: DockerConfig;
  notifications: NotificationConfig;
  backup: BackupConfig;
  pathFavorites: PathFavorite[];
  updateScheduler: UpdateSchedulerConfig;
  user: UserConfig;
  update: UpdateConfig;
  columnVisibility: ColumnVisibility;
  /** 全局彩色标签库（系统设置 → 标签管理维护） */
  tags: ResourceTag[];
  /** 弹窗设置（自动关闭延迟等） */
  modal: ModalConfig;
  /** Compose 模板（一键填入项） */
  compose: ComposeConfig;
  /** 安装量与活跃度遥测上报配置（服务端 defaultsVersion 迁移保证存在） */
  telemetry: TelemetryConfig;
  /** 默认值版本号：服务端据此判断是否需要把老配置重置为新默认值 */
  defaultsVersion?: number;
}

// ============ UI 类型 ============

export type PageKey =
  | "dashboard"
  | "containers"
  | "stacks"
  | "images"
  | "volumes"
  | "notifications"
  | "settings";

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

export interface ContextMenuItem {
  label: string;
  icon?: string;
  action?: () => void;
  separator?: boolean;
  disabled?: boolean;
  danger?: boolean;
  submenu?: ContextMenuItem[];
}

export interface ActivityLog {
  id: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
  read?: boolean;
}
