import fs from "node:fs";
import { configPath } from "./paths.js";

const SETTINGS_FILE = configPath("settings.json");

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
    enabled: false,
    checkFrequency: "0 3 * * *",
    autoPull: false,
  },
  user: {
    username: "admin",
    sessionTimeout: 30,
  },
  update: {
    /** 是否自动检查更新（仓库地址已固定写死在 updater.ts，无需配置） */
    autoCheck: false,
  },
  columnVisibility: {
    containers: ["icon","name","status","image","ports","uptime","restartPolicy","actions"],
    images: ["repository","tag","id","size","createdAt","associatedContainers","sha256","actions"],
    volumes: ["name","driver","mountpoint","size","createdAt","associatedContainers","inUse","actions"],
  },
};

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
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        docker: mergedDocker,
        update: { ...DEFAULT_SETTINGS.update, ...(parsed?.update || {}) },
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
