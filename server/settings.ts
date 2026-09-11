import fs from "node:fs";
import { configPath } from "./paths.js";

const SETTINGS_FILE = configPath("settings.json");

/** 默认值版本号：默认列 / 默认语言等「默认值」变更时 +1，触发一次性迁移覆盖老配置 */
const DEFAULTS_VERSION = 2;

const DEFAULT_SETTINGS = {
  docker: {
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
    /**
     * 镜像加速源（pull-through 型，如 docker.m.daocloud.io）列表。
     * v1.5.0 起与 /etc/docker/daemon.json 的 registry-mirrors 双向同步：
     * 设置页保存时写回 daemon.json，页面加载时以 daemon.json 内容为准回读。
     */
    registryMirrors: [],
    /**
     * 拉取时是否把镜像名改写为 `<加速源>/<仓库>`（v1.4.0 及更早的兼容行为）。
     * 默认 false：加速源写入 daemon.json 后由守护进程自行生效，不再改写镜像名——
     * 避免把「仅代理私有仓库 / fnnas 类」的源用于 Docker Hub 镜像名改写导致 404。
     * 旧配置（registryMirrors 非空）迁移时自动置 true，保持原有拉取行为不变。
     */
    rewriteImageNames: false,
  },
  notifications: {
    webhookEnabled: false,
    webhookUrl: "",
    emailEnabled: false,
    emailSmtp: "",
    emailPort: 587,
    emailUser: "",
    events: {
      containerDown: true,
      updateAvailable: true,
      updateComplete: false,
      buildFailed: true,
    },
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
  pathFavorites: [
    { id: "p1", name: "应用数据", path: "/mnt/user/appdata" },
    { id: "p2", name: "媒体库", path: "/mnt/user/media" },
    { id: "p3", name: "下载目录", path: "/mnt/user/downloads" },
    { id: "p4", name: "系统配置", path: "/mnt/user/system" },
  ],
  updateScheduler: {
    /** 是否启用全局自动更新检查（默认开启） */
    enabled: true,
    /** 检查频率模式：每天 / 每周 / 每月（不使用 Cron 表达式） */
    mode: "daily", // "daily" | "weekly" | "monthly"
    /** 检查时刻（24 小时制） */
    hour: 1,
    minute: 0,
    /** 每周模式下的星期几：0=周日 … 6=周六，默认周一 */
    dayOfWeek: 1,
    /** 每月模式下的日期：1-31，默认 1 号 */
    dayOfMonth: 1,
    /** 检查到更新后是否自动拉取镜像 */
    autoPull: false,
  },
  user: {
    sessionTimeout: 30,
  },
  update: {
    /** 是否自动检查更新（仓库地址已固定写死在 updater.ts，无需配置） */
    autoCheck: false,
  },
  /**
   * 各页面默认可见列（页面「列」下拉可临时调整，设置页「列显隐」保存为默认值）。
   * v1.9.2 收敛默认显示项：容器隐藏 镜像/运行时长/重启策略，镜像隐藏 SHA-256，
   * 数据卷隐藏 驱动；堆栈子表新增列控制，默认隐藏「镜像」。
   */
  columnVisibility: {
    containers: ["icon","name","status","tags","ports","actions"],
    images: ["repository","tag","id","size","createdAt","associatedContainers","actions"],
    volumes: ["name","mountpoint","size","createdAt","associatedContainers","actions"],
    stackList: ["icon","name","status","tags","containers","uptime","update"],
    stacks: ["name","status","network","ip","ports","update"],
  },
  /** 全局彩色标签库（设置页「标签管理」维护，可挂到堆栈 LABELS 服务条目） */
  tags: [],
  /**
   * 弹窗设置：操作结果弹窗的自动关闭延迟（秒）。
   * 启动堆栈等操作完成后，弹窗显示倒计时并在 autoCloseDelay 秒后自动关闭；
   * 0 = 不自动关闭。设置页「弹窗设置」可调整。
   */
  modal: {
    autoCloseDelay: 5,
  },
  /**
   * Compose 模板（系统设置 → Compose 管理 维护）：
   * 编辑堆栈时一键填入。
   * - insert=services：填到 services 下第一个服务内部（自动缩进到服务属性层级，标准文档 4 空格）
   * - insert=environment：填到第一个服务的 environment 下（缩进 6 空格）
   * - insert=volumes：填到第一个服务的 volumes 下（缩进 6 空格）
   * - insert=cursor：插到编辑器光标所在行的下一行
   * - insert=end：追加到文本末尾
   * content 为可多行 compose 文本；填入时会自动按目标层级重新缩进，无需手工对齐。
   */
  compose: {
    templates: [
      { content: "network_mode: ", insert: "services" },
      { content: "restart: ", insert: "services" },
      { content: "container_name: ", insert: "services" },
    ],
  },
  /**
   * 安装量与活跃度遥测（系统设置 → 活跃度）：
   * 仅上报 install / active 事件到统计服务端，不含聚合统计能力。
   */
  telemetry: {
    enabled: true,
    endpoint: "https://docker.yanziruxue.top",
    collectHwFingerprint: true,
  },
};

/**
 * 归一化模板填入位置：旧配置的 "service" 迁移为 "services"，
 * 其余合法值原样保留，未知值兜底为 services。
 */
function normalizeComposeInsert(v: any): string {
  if (v === "end" || v === "cursor" || v === "environment" || v === "volumes") return v;
  return "services";
}

export function getSettings(): any {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      // docker / update 段做二级合并：旧配置文件已存在对应段时，
      // 其中缺失的新增字段（如 docker.registryMirrors）能自动继承默认值
      const mergedDocker = { ...DEFAULT_SETTINGS.docker, ...(parsed?.docker || {}) };
      // 迁移旧版单一 registryMirror 字符串 → registryMirrors 数组（向后兼容）
      if (!Array.isArray(mergedDocker.registryMirrors)) {
        mergedDocker.registryMirrors =
          typeof (mergedDocker as any).registryMirror === "string" && (mergedDocker as any).registryMirror.trim()
            ? [(mergedDocker as any).registryMirror.trim()]
            : [];
        delete (mergedDocker as any).registryMirror;
      }
      // 迁移：旧配置若已填过加速源，说明依赖「改写镜像名」拉取，保持原行为（true）；
      // 新配置默认 false，改由 daemon.json registry-mirrors 生效
      if (typeof mergedDocker.rewriteImageNames !== "boolean") {
        mergedDocker.rewriteImageNames = mergedDocker.registryMirrors.length > 0;
      }
      // 迁移：容器列默认值补入「标签」列（旧配置无此列时插到「状态」之后）
      let mergedColumns = { ...DEFAULT_SETTINGS.columnVisibility, ...(parsed?.columnVisibility || {}) };
      if (Array.isArray(mergedColumns.containers) && !mergedColumns.containers.includes("tags")) {
        const arr = [...mergedColumns.containers];
        const statusIdx = arr.indexOf("status");
        if (statusIdx >= 0) arr.splice(statusIdx + 1, 0, "tags");
        else arr.push("tags");
        mergedColumns.containers = arr;
      }
      // 迁移（一次性，v1.9.2）：老配置沿用旧的默认列与英文菜单，升级后重置为新默认值
      // （容器隐藏 镜像/运行时长/重启策略、镜像隐藏 SHA、数据卷隐藏 驱动、菜单默认中文）
      if ((parsed as any).defaultsVersion !== DEFAULTS_VERSION) {
        mergedColumns = { ...DEFAULT_SETTINGS.columnVisibility };
        mergedDocker.menuLanguage = "zh";
      }
      // 迁移：旧版 updateScheduler 用 checkFrequency(Cron) 表达频率，新版本改用 mode/hour/minute/dayOfWeek/dayOfMonth
      let updateScheduler = { ...DEFAULT_SETTINGS.updateScheduler, ...(parsed?.updateScheduler || {}) };
      if ((parsed?.updateScheduler as any)?.checkFrequency && typeof (parsed.updateScheduler as any).checkFrequency === "string") {
        const old = parsed.updateScheduler as any;
        updateScheduler = {
          enabled: !!old.enabled,
          mode: "daily",
          hour: 3,
          minute: 0,
          dayOfWeek: 1,
          dayOfMonth: 1,
          autoPull: !!old.autoPull,
        };
      }
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        docker: mergedDocker,
        update: { ...DEFAULT_SETTINGS.update, ...(parsed?.update || {}) },
        modal: { ...DEFAULT_SETTINGS.modal, ...(parsed?.modal || {}) },
        compose: {
          templates: Array.isArray(parsed?.compose?.templates)
              ? parsed.compose.templates.map((x: any) =>
                  typeof x === "string"
                    ? { content: x, insert: "services" }
                    : {
                        content: String(x?.content ?? ""),
                        insert: normalizeComposeInsert(x?.insert),
                      }
                )
            : DEFAULT_SETTINGS.compose.templates,
        },
        columnVisibility: mergedColumns,
        defaultsVersion: DEFAULTS_VERSION,
      };
    }
  } catch {
    // 文件损坏则用默认
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: any): any {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  return settings;
}
