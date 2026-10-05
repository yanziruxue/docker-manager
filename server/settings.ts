import fs from "node:fs";
import path from "node:path";
import { configPath } from "./paths.js";
import { decryptSecret, encryptSecret, isEncrypted } from "./secret-store.js";

const SETTINGS_FILE = configPath("settings.json");

/** 需要加密落盘、且**绝不回传前端**的密钥字段（都位于 `notifications` 段） */
export const SECRET_FIELDS = ["emailPassword", "webhookSecret"] as const;

/**
 * 密钥字段的「清除」哨兵值。
 *
 * 契约（提交配置时该字段的三种取值）：
 *   - `""`（空串）     ⇒ **保持原值不变** —— 前端拿不到明文，留空即「不改」；
 *   - `SECRET_CLEAR`   ⇒ 清空该密钥；
 *   - 其它任何字符串   ⇒ 作为新明文写入（落盘前自动加密）。
 *
 * ⚠️ 前端 `src/types.ts` 有同名常量，两边必须一致（`scripts/check-secrets.ts` 有跨文件断言）。
 */
export const SECRET_CLEAR = "__CLEAR__";

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
    menuLanguage: "zh",
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
    /** 可选：HMAC-SHA256 签名密钥。填写后每次推送带 `x-docker-manager-signature: sha256=…` 头，接收方可验签 */
    webhookSecret: "",
    emailEnabled: false,
    emailSmtp: "",
    emailPort: 587,
    emailUser: "",
    /** ⚠️ 明文存于 settings.json（本项目不提供密钥加密存储；仅本机文件可读） */
    emailPassword: "",
    /** 发件人；留空则用 emailUser（多数 SMTP 服务要求发件人与账号一致） */
    emailFrom: "",
    /** 收件人，多个用逗号或分号分隔 */
    emailTo: "",
    events: {
      containerDown: true,
      updateAvailable: true,
      updateComplete: false,
      /** ⚠️ 本项目没有镜像构建功能，此开关暂无触发源（保留仅为将来兼容） */
      buildFailed: true,
    },
  },
  backup: {
    mode: 1,
    autoBackupEnabled: false,
    /** @deprecated v1.18.2 起备份目录固定为 `<data>/backups`，此项不再生效（保留仅为兼容旧 settings.json） */
    backupPath: "",
    lastBackup: "",
    /** 备份遇 EACCES 时，对「属主是自己」的文件自动补属主读位后重试（只补 u+r，不扩大暴露面） */
    autoFixReadPerm: true,
    simpleFrequency: "0 3 * * 0",
    simpleRetentionCount: 5,
    weekly: { enabled: true, day: "Saturday", time: "23:00", retention: 6 },
    monthly: { enabled: true, dayOfMonth: 0, time: "23:00", retention: 8 },
    yearly: { enabled: true, date: "12-31", time: "23:00" },
  },
  /**
   * 目录镜像（系统设置 → 目录镜像）：把「备份目录」「Compose 目录」单向镜像到另一个路径，
   * 与源目录实时同步（fs.watch 递归监听 + 1 秒防抖，另有 60 秒全量对账兜底）。
   * 语义为**真镜像**：源里删除的文件 / 目录会同步从目标删除。
   * 两个目标各自独立开关与路径，target 留空即视为关闭。
   */
  mirror: {
    backups: { enabled: false, target: "" },
    compose: { enabled: false, target: "" },
  },
  /**
   * 应用日志保留策略（系统设置 → 应用日志）。
   * maxDays = 保留天数，0 = 不限；maxTotalMB = 日志目录总大小上限，0 = 不限。
   * 两条都命中时「先到先清」，**永不删除当天文件**（正在写入）。
   */
  logRetention: {
    enabled: true,
    maxDays: 30,
    maxTotalMB: 500,
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
    // 容器详情视图：drawer = 半页面（右侧抽屉，默认）；modal = 居中弹窗
    containerDetailStyle: "drawer",
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
   * 安装量 / 活跃度上报开关（系统设置 → 硬件信息）。
   * 默认开启；关闭后不再向远端发送任何数据（硬件信息标识卡片仍可正常查看）。
   * 上报内容仅为本机设备信息（硬件 6 维指纹 + 系统 + 应用版本），用于安装数量统计。
   */
  telemetry: {
    enabled: true,
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
      return decryptSecrets({
        ...DEFAULT_SETTINGS,
        ...parsed,
        backup: { ...DEFAULT_SETTINGS.backup, ...(parsed?.backup || {}) },
        // 目录镜像：两个子段各自二级合并，旧配置缺字段时继承默认（关闭）
        mirror: {
          backups: { ...DEFAULT_SETTINGS.mirror.backups, ...(parsed?.mirror?.backups || {}) },
          compose: { ...DEFAULT_SETTINGS.mirror.compose, ...(parsed?.mirror?.compose || {}) },
        },
        // 日志保留策略：旧配置无此段时继承默认（开启 / 30 天 / 500 MB）
        logRetention: { ...DEFAULT_SETTINGS.logRetention, ...(parsed?.logRetention || {}) },
        // 通知配置：二级合并。★ 缺这一段时旧 settings.json 会**整段**取不到新增字段
        // （webhookSecret / emailPassword / emailFrom / emailTo）⇒ 前端拿到 undefined、
        // 输入框失控、且通知模块读不到。events 再多合并一层以兼容将来新增事件键。
        notifications: {
          ...DEFAULT_SETTINGS.notifications,
          ...(parsed?.notifications || {}),
          events: { ...DEFAULT_SETTINGS.notifications.events, ...(parsed?.notifications?.events || {}) },
        },
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
        // 上报开关二级合并：旧配置没有 telemetry 段时继承默认值（开启）
        telemetry: { ...DEFAULT_SETTINGS.telemetry, ...(parsed?.telemetry || {}) },
        defaultsVersion: DEFAULTS_VERSION,
      });
    }
  } catch {
    // 文件损坏则用默认
  }
  return decryptSecrets(decodeSettings(DEFAULT_SETTINGS));
}

/** 落盘前加密密钥字段（幂等：空串保持空串、已加密不再加密） */
function encodeSettings(s: any): any {
  const n = { ...(s?.notifications || {}) };
  for (const k of SECRET_FIELDS) n[k] = encryptSecret(String(n[k] ?? ""));
  return { ...(s || {}), notifications: n };
}

/**
 * 读盘后解密密钥字段。非密文原样返回 ⇒ **历史明文配置无需迁移**。
 * 解密失败返回空串（不抛错），保证设置页仍能打开、用户能重新填写。
 */
function decodeSettings(s: any): any {
  const n = { ...(s?.notifications || {}) };
  for (const k of SECRET_FIELDS) n[k] = decryptSecret(String(n[k] ?? ""));
  return { ...(s || {}), notifications: n };
}

/** `getSettings()` 出口统一走这里：返回的永远是**明文**（供后端自己用，如发邮件） */
function decryptSecrets(s: any): any {
  return decodeSettings(s);
}

/** 读取磁盘原始配置（不合并默认值、不解密）—— 供「保持原值」语义取回原密文 */
function readStoredRaw(): any {
  try {
    if (fs.existsSync(SETTINGS_FILE)) return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
  } catch {
    /* 损坏则当作空 */
  }
  return null;
}

/**
 * 脱敏：把密钥换成空串，并附 `emailPasswordSet` / `webhookSecretSet` 标志。
 * ★ `GET /api/settings` 与 `PUT` 的**响应**都必须走这里 —— 密钥只写不读。
 * （`getSettings()` 本身返回明文，因为发邮件要用；**不要**把它直接塞进 HTTP 响应。）
 */
export function redactSettings(s: any): any {
  const n = { ...(s?.notifications || {}) };
  const flags: Record<string, boolean> = {};
  for (const k of SECRET_FIELDS) {
    flags[`${k}Set`] = String(n[k] ?? "").length > 0;
    n[k] = "";
  }
  return { ...(s || {}), notifications: { ...n, ...flags } };
}

/**
 * 磁盘上的密钥是否**已经是密文**（供状态接口展示，不解密、不碰明文）。
 * 只要有一个密钥字段是 `enc:v1:` 形态即为 true ⇒ 前端可显示「已加密存储」。
 */
export function secretsAreEncrypted(): boolean {
  const raw = readStoredRaw();
  const n = raw?.notifications || {};
  return SECRET_FIELDS.some((k) => isEncrypted(n[k]));
}

export function saveSettings(settings: any): any {
  const prevRaw = readStoredRaw();
  const next = { ...(settings || {}) };
  const n = { ...(next.notifications || {}) };
  // ★ 密钥三态：空串 = 保持磁盘原值、SECRET_CLEAR = 清除、其它 = 新明文
  for (const k of SECRET_FIELDS) {
    const incoming = n[k] == null ? "" : String(n[k]);
    if (incoming === SECRET_CLEAR) n[k] = "";
    // 保持语义直接把磁盘上的原值（通常是密文）放回去，由 encodeSettings 幂等跳过
    else if (incoming === "") n[k] = prevRaw?.notifications?.[k] ?? "";
    else n[k] = incoming;
  }
  next.notifications = n;

  const encoded = encodeSettings(next);
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
  // 0600：settings.json 内含密钥密文，仅服务运行账号可读（Windows/NTFS 上 mode 无效属正常）
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(encoded, null, 2), { encoding: "utf-8", mode: 0o600 });
  try {
    fs.chmodSync(SETTINGS_FILE, 0o600);
  } catch {
    /* Windows 无 POSIX 权限位 */
  }
  // 响应前脱敏：明文密钥绝不回传前端
  return redactSettings(decodeSettings(encoded));
}
