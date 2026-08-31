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
  dockerDiskMB: number; // 镜像 + 数据卷磁盘占用（MB）
  netRxKB: number; // 累计接收（KB）
  netTxKB: number; // 累计发送（KB）
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
  username: string;
  sessionTimeout: number; // minutes
}

/** 系统更新（OTA）配置 */
export interface UpdateConfig {
  /** 是否自动检查更新（仓库地址已固定写死在后端，无需配置） */
  autoCheck: boolean;
}

/** 列可见性默认配置 */
export interface ColumnVisibility {
  containers: string[];  // 容器管理页面默认可见列
  images: string[];      // 镜像管理页面默认可见列
  volumes: string[];     // 数据卷管理页面默认可见列
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
