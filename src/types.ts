// ============ 基础类型 ============

export type ContainerStatus = "running" | "stopped" | "paused" | "restarting" | "updating";

/** 容器内单条文件/目录条目（容器文件浏览器用） */
export interface ContainerFileEntry {
  name: string;
  /** 容器内绝对路径 */
  path: string;
  size: number;
  /** mtime，ISO 字符串 */
  mtime: string;
  /** 10 位权限串，如 `drwxr-xr-x` */
  mode: string;
  isDir: boolean;
  isSymlink: boolean;
  /** 符号链接目标（仅 isSymlink 时有值） */
  target?: string;
}
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
  /** 各物理核实时使用率（仅本机 socket 引擎可读 /proc/stat；远程引擎为空数组） */
  cpuCores: { name: string; percent: number }[];
  /** 已安装内存（MB）：本机引擎取 /proc/meminfo，远程回退 Docker MemTotal */
  memInstalledMB: number;
  /** 宿主机空闲内存（MB）：仅本机引擎有值，否则 0 */
  memFreeMB: number;
  /** 系统占用（MB）= 宿主机已用 - Docker 已用；仅本机引擎有值，否则 0 */
  memSystemMB: number;
  /** 主板最大支持内存（MB）：非 root 通常读不到 DMI → 0（前端显示「—」） */
  memMaxSupportedMB: number;
  /** 宿主机磁盘利用率（仅本机引擎，远程为空数组） */
  disks: DiskStat[];
  /** 逐网口实时速率（仅本机 socket 引擎可读 /proc/net/dev；远程引擎为空数组） */
  netIfaces: NetIfaceStat[];
  /** 宿主机正常运行时间（秒）：读 /proc/uptime，读不到（远程引擎 / 非 Linux）为 0 → 前端显示「—」 */
  hostUptimeSec: number;
  // ───────── 宿主机库存（仪表盘「系统概览」+ 处理器/内存图标 tooltip） ─────────
  /** 主机名称：本机读 os.hostname()，远程回退 docker.info.Name */
  hostName: string;
  /** 发行版本：本机读 /etc/os-release PRETTY_NAME，远程回退 docker.info.OperatingSystem */
  osName: string;
  /** 内核版本：docker.info.KernelVersion（所有引擎可读） */
  kernelVersion: string;
  /** 系统类型/架构：本机 os.arch()（x64→x86_64），远程回退 docker.info.Architecture */
  arch: string;
  /** 主机地址：本机首个非回环 IPv4，远程为 "" */
  hostAddress: string;
  /** 启动时间（秒级时间戳）：本机 = now - uptime，否则 0 */
  bootTimeSec: number;
  /** CPU 型号（本机 /proc/cpuinfo，远程为 ""） */
  cpuModel: string;
  /** CPU 物理核心数（本机 /proc/cpuinfo，远程为 0） */
  cpuPhysicalCores: number;
  /** CPU 逻辑核心数（本机 /proc/cpuinfo，远程 = NCPU） */
  cpuLogicalCores: number;
  /** CPU 频率（MHz，本机 /proc/cpuinfo，远程为 0） */
  cpuMhz: number;
}

/** 资源时间序列单点（服务端 1s 采样，最多保留 5 分钟） */
export interface ResourceSample {
  ts: number;
  memSystemMB: number;
  memDockerMB: number;
  netRxKBps: number;
  netTxKBps: number;
  /** 运行容器 CPU 合计（%），与 EngineResourceStats.cpuPercent 同源 */
  cpuPercent: number;
  /**
   * 逐网口速率（KB/s）：键 = 网口名（含 Docker 网桥 docker0 / br-xxxx）。
   * 仅本机 socket 引擎有值；远程引擎缺省（前端回退到合计口径）。
   */
  netIfaces?: Record<string, { rx: number; tx: number }>;
  /**
   * 逐磁盘速率与利用率：键 = 设备名（`sda` / `nvme0n1` …）。
   * `read` / `write` 单位 **MB/s**，`busy` 单位 **%**。
   * 仅本机 socket 引擎有值；远程引擎缺省（磁盘磁贴显示「无曲线」）。
   */
  disks?: Record<string, { read: number; write: number; busy: number }>;
}

/** 宿主机磁盘统计（/proc/diskstats 差分） */
export interface DiskStat {
  name: string;
  readMBps: number;
  writeMBps: number;
  busyPct: number;
  active: boolean;
  /** 该盘各分区文件系统类型（远程引擎为空数组） */
  fstypes: string[];
  /** 整盘温度（℃）：读 sysfs hwmon，无需 root；无传感器 / 缺 drivetemp 模块为 null */
  tempC: number | null;
}

/** 单个网口的实时速率（/proc/net/dev 差分；仅本机 socket 引擎有值） */
export interface NetIfaceStat {
  name: string;
  rxKBps: number;
  txKBps: number;
}

/** 网络曲线的可选接口（本机网口 + Docker 网桥虚拟网卡） */
export interface NetInterfaceOption {
  /** 网口名（= /proc/net/dev 的键，前端据此在样本里取数） */
  name: string;
  /** 展示名：Docker 网桥带网络名（如 `iotdb-net (bridge)`），否则就是网口名 */
  label: string;
  kind: "host" | "docker";
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

/** 镜像锁定记录（服务端持久化于 config/image-locks.json） */
export interface ImageLock {
  /** 镜像 sha256（不含 `sha256:` 前缀） */
  id: string;
  /** `repo:tag`；悬空镜像为空字符串 */
  ref: string;
  /** 加锁时间戳（ms） */
  at: number;
}

/** 单个镜像的版本更新检查明细（后端 checkAllImageUpdates） */
export interface ImageUpdateDetail {
  engineId: string;
  image: string;        // repo:tag
  refs?: string[];      // 同一 digest 上的全部 repo:tag（多 tag 镜像逐行匹配用）
  hasUpdate: boolean;
  currentSha: string;   // 本地 RepoDigest 的 sha256
  latestSha: string;    // 远程 registry manifest digest 的 sha256
}

/** 某引擎镜像更新检查结果（手动检查返回 / 缓存读取） */
export interface ImageUpdateSummaryView {
  engineId: string;
  checked: number;
  updates: number;
  details: ImageUpdateDetail[];
  at: string; // ISO
}

/** 镜像管理页使用的检查结果视图：按 repo:tag 摊平，便于表格逐行匹配 */
export interface ImageUpdateStatusView {
  at: string;
  checked: number;
  updates: number;
  byRef: Record<string, boolean>;
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

// ============ 网络相关 ============

/** 网络下挂载的容器（含其在此网络内的 IP） */
export interface DockerNetworkContainer {
  id: string;
  name: string;
  ipv4?: string;
  ipv6?: string;
}

/** 单个 Docker 网络（含关联的容器与其累计收发字节） */
export interface DockerNetwork {
  id: string;
  name: string;
  driver: string; // bridge / overlay / macvlan / host / null ...
  scope: string; // local / swarm / global
  enableIPv6: boolean;
  internal: boolean; // 是否仅内部通信（不可访问外网）
  attachable: boolean;
  ingress: boolean; // 是否为 swarm 入口网络
  subnet?: string;
  gateway?: string;
  ipv6Subnet?: string;
  ipv6Gateway?: string;
  /** 关联容器（网络 ↔ 容器映射） */
  containers: DockerNetworkContainer[];
  /** 下行（接收）累计字节：关联容器在此网络上的 RxBytes 之和 */
  rxBytes: number;
  /** 上行（发送）累计字节：关联容器在此网络上的 TxBytes 之和 */
  txBytes: number;
  created: string;
  options: { key: string; value: string }[];
  labels: { key: string; value: string }[];
}

/** 创建 / 编辑网络的入参（Docker 不支持原地编辑，编辑 = 删除后用相同配置重建） */
export interface NetworkCreateOptions {
  name: string;
  driver?: string;
  subnet?: string;
  gateway?: string;
  options?: Record<string, string>;
  labels?: Record<string, string>;
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

/**
 * 密钥字段的「清除」哨兵值 —— ⚠️ 必须与后端 `server/settings.ts` 的 `SECRET_CLEAR` 完全一致
 *（`scripts/check-secrets.ts` 有跨文件断言）。
 *
 * 契约（提交设置时该字段的三种取值）：
 *   - `""`            ⇒ 保持原值不变（前端拿不到明文，留空即「不改」）
 *   - `SECRET_CLEAR`  ⇒ 清空该密钥
 *   - 其它字符串      ⇒ 作为新明文提交（后端落盘前会用 AES-256-GCM 加密）
 */
export const SECRET_CLEAR = "__CLEAR__";

export interface NotificationConfig {
  webhookEnabled: boolean;
  webhookUrl: string;
  /**
   * ⚠️ HMAC-SHA256 签名密钥。**只写不读**：`GET /api/settings` 永远返回空串，
   * 是否已设置看 `webhookSecretSet`。
   */
  webhookSecret: string;
  /** 服务端是否已存有该密钥（脱敏响应里给出） */
  webhookSecretSet?: boolean;
  emailEnabled: boolean;
  emailSmtp: string;
  emailPort: number;
  emailUser: string;
  /** ⚠️ SMTP 密码。同样**只写不读**，落盘为 AES-256-GCM 密文；是否已设置看 `emailPasswordSet` */
  emailPassword: string;
  /** 服务端是否已存有该密码（脱敏响应里给出） */
  emailPasswordSet?: boolean;
  /** 发件人；留空则用 emailUser */
  emailFrom: string;
  /** 收件人，多个用逗号或分号分隔 */
  emailTo: string;
  events: {
    containerDown: boolean;
    updateAvailable: boolean;
    updateComplete: boolean;
    /** ⚠️ 本项目没有镜像构建功能，此开关暂无触发源 */
    buildFailed: boolean;
  };
}

/** 密钥来源：环境变量 / 配置文件 / 未设置 */
export type SecretSource = "env" | "file" | "none";

/** 通知自检状态（GET /api/notify/status） */
export interface NotifyRuntimeStatus {
  webhookConfigured: boolean;
  webhookSigned: boolean;
  emailConfigured: boolean;
  /** 有开关但无触发源的事件键 */
  eventsWithoutSource: string[];
  /** 密钥各自来自哪里（`env` 表示被环境变量覆盖，界面上应显示为只读） */
  secretSource: { smtpPassword: SecretSource; webhookSecret: SecretSource };
  /** 磁盘上的密钥是否已是密文（AES-256-GCM） */
  secretsEncrypted: boolean;
}

/** 发送测试通知的结果（POST /api/notify/test） */
export interface NotifyTestResult {
  webhook: "skipped" | "sent" | "failed";
  email: "skipped" | "sent" | "failed";
  errors: string[];
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
  /** @deprecated v1.18.2 起备份目录固定为 `<data>/backups`，此项不再生效（保留仅为兼容旧配置） */
  backupPath?: string;
  lastBackup: string;
  /** 备份遇 EACCES 时自动补属主读位后重试（只补 u+r，不改动其他权限位与归属） */
  autoFixReadPerm?: boolean;
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
  /** 检查频率模式：每天 / 每周 / 每月（不使用 Cron 表达式） */
  mode: "daily" | "weekly" | "monthly";
  /** 检查时刻（24 小时制） */
  hour: number;
  minute: number;
  /** 每周模式下的星期几：0=周日 … 6=周六 */
  dayOfWeek: number;
  /** 每月模式下的日期：1-31 */
  dayOfMonth: number;
  /** 检查到更新后是否自动拉取镜像 */
  autoPull: boolean;
}

/** 单个引擎的检查结果（更新调度器状态用） */
export interface SchedulerEngineResult {
  engineId: string;
  name: string;
  checked: number;
  updates: number;
  skipped?: boolean;
  error?: string;
}

/** 最近一次检查汇总 */
export interface SchedulerLastResult {
  checked: number;
  updates: number;
  byEngine: SchedulerEngineResult[];
  at: string;
}

/** 更新调度器实时状态 */
export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  lastCheck: string | null;
  lastResult: SchedulerLastResult | null;
  nextCheck: string | null;
  config: UpdateSchedulerConfig;
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
  /**
   * 容器详情视图样式：
   * - `drawer` = 半页面（右侧抽屉，覆盖约半屏，列表仍可见；默认）
   * - `modal`  = 居中弹窗（原有样式）
   */
  containerDetailStyle: "drawer" | "modal";
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
  /** 模板内容（可多行 compose 文本；填入时会自动按目标层级重新缩进，无需手工对齐） */
  content: string;
  /**
   * 填入位置：
   * - services = services 下第一个服务内部（缩进 4 空格，随文档实际缩进自适应）
   * - environment = 第一个服务的 environment 下（缩进 6 空格）
   * - volumes = 第一个服务的 volumes 下（缩进 6 空格）
   * - cursor = 插入到编辑器光标（鼠标指针）所在行的下一行
   * - end = 追加到 compose 文本最后一行
   */
  insert: ComposeInsertPosition;
}

/** 一键填入模板的填入位置 */
export type ComposeInsertPosition =
  | "services"
  | "environment"
  | "volumes"
  | "cursor"
  | "end";

/** Compose 模板设置（系统设置 → Compose 管理 维护） */
export interface ComposeConfig {
  /** 一键填入模板项 */
  templates: ComposeTemplate[];
}

// ============ 系统更新（OTA）类型 ============

/** 更新阶段 */
export type UpdatePhase = "idle" | "downloading" | "extracting" | "replacing" | "done" | "error";

/** 更新信息来源：gitea = 自建 Gitea（优先），github = GitHub Releases（保底） */
export type UpdateSource = "gitea" | "github";

/** 更新检查返回的最新版本信息（自建 Gitea 优先，GitHub 保底） */
export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  /** 本条信息来自哪个源（决定下载候选与展示） */
  source?: UpdateSource;
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
  /**
   * 安装量 / 活跃度上报开关（系统设置 → 硬件信息）。
   * 默认开启；关闭后不再向远端发送任何数据。仅上报本机设备信息，用于安装数量统计。
   */
  telemetry: TelemetryConfig;
  /** 目录镜像（系统设置 → 目录镜像）：备份 / Compose 目录单向真镜像到另一个路径 */
  mirror: MirrorConfig;
  /** 应用日志保留策略（系统设置 → 应用日志） */
  logRetention: LogRetentionConfig;
  /** 默认值版本号：服务端据此判断是否需要把老配置重置为新默认值 */
  defaultsVersion?: number;
}

/** 安装量 / 活跃度上报配置（系统设置 → 硬件信息） */
export interface TelemetryConfig {
  /** 是否上传安装数量统计（默认 true；关闭后不再向远端发送任何数据） */
  enabled: boolean;
}

// ============ 应用详情 / 应用日志 / 目录镜像 ============

/** 目录镜像的单个目标（备份 或 Compose） */
export interface MirrorTargetConfig {
  enabled: boolean;
  /** 目标根路径（**绝对路径**）；留空即视为关闭 */
  target: string;
}

/**
 * 目录镜像配置（系统设置 → 目录镜像）。
 * 语义为**真镜像**：源目录里删除的文件 / 目录会同步从目标删除。
 */
export interface MirrorConfig {
  backups: MirrorTargetConfig;
  compose: MirrorTargetConfig;
}

/** 应用日志保留策略（系统设置 → 应用日志） */
export interface LogRetentionConfig {
  enabled: boolean;
  /** 保留天数；0 = 不限 */
  maxDays: number;
  /** 日志目录总大小上限（MB）；0 = 不限 */
  maxTotalMB: number;
}

/** 应用详情里的单个目录（GET /api/system/app-info） */
export interface AppDirInfo {
  key: string;
  label: string;
  /** 该目录来源说明（哪个环境变量可覆盖等） */
  note: string;
  path: string;
  exists: boolean;
  files: number;
  sizeBytes: number;
  /** 条目超过统计上限被截断（占用值仅代表已统计部分） */
  truncated: boolean;
}

/** 应用详情（GET /api/system/app-info） */
export interface AppInfo {
  version: string;
  /** 运行形态：sea-linux-x64 / dev */
  channel: string;
  nodeVersion: string;
  platform: string;
  arch: string;
  /** 运行用户 */
  user: string;
  pid: number;
  startedAt: string;
  uptimeSeconds: number;
  cwd: string;
  engineName: string;
  engineConnection: string;
  engineCount: number;
  dirs: AppDirInfo[];
}

/** 日志文件条目（GET /api/applogs） */
export interface LogFileInfo {
  name: string;
  sizeBytes: number;
  mtime: string;
  mtimeMs: number;
  /** 是否为「今天」的日志（正在被写入，不可删除） */
  current: boolean;
}

/** 日志列表响应 */
export interface LogListResult {
  files: LogFileInfo[];
  totalBytes: number;
  retention: LogRetentionConfig;
}

/** 日志尾部读取结果（GET /api/applogs/:name?tail=N） */
export interface LogTailResult {
  name: string;
  sizeBytes: number;
  mtime: string;
  lines: string[];
  /** 只读了文件末尾一段，前面还有内容未包含 */
  headTruncated: boolean;
}

/** 日志清理结果（POST /api/applogs/prune） */
export interface LogPruneResult {
  removed: string[];
  freedBytes: number;
  skipped: boolean;
}

/** 镜像运行态（GET /api/mirror/status） */
export interface MirrorRuntimeState {
  key: "backups" | "compose";
  label: string;
  /** 源目录（权威来源） */
  source: string;
  /** 配置里是否开启 */
  enabled: boolean;
  /** 目标路径（空 = 未配置） */
  target: string;
  /** 目标路径是否合法可写 */
  valid: boolean;
  invalidReason: string;
  /** 递归目录监听是否生效（false ⇒ 仅靠 60 秒轮询兜底） */
  watcherActive: boolean;
  syncing: boolean;
  lastSyncAt: string | null;
  lastDurationMs: number;
  lastError: string | null;
  copied: number;
  deleted: number;
  sourceFiles: number;
  targetFiles: number;
}

// ============ UI 类型 ============

export type PageKey =
  | "dashboard"
  | "containers"
  | "stacks"
  | "images"
  | "volumes"
  | "networks"
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
