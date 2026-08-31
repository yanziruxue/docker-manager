import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { dataPath } from "./paths.js";

/**
 * 宿主机 Docker 守护进程配置读写。
 *
 * 目标：让「系统设置 → 镜像加速源」与 /etc/docker/daemon.json 的 registry-mirrors 双向同步，
 * 保存后提示是否重启 Docker，选「是」则执行 systemctl restart docker。
 *
 * 权限说明：服务默认以非 root 用户（docker-manager-yanzi）运行，写 /etc 与重启服务需要提权。
 * 提权优先级：root 直接执行 → sudo -n 免密 → 无能力（返回 hint 提示如何授权）。
 * install.sh 会写入 /etc/sudoers.d/docker-manager-yanzi 放开所需的最小命令集。
 */

/**
 * 守护进程配置文件路径。默认 /etc/docker/daemon.json；
 * 容器化部署若把配置挂载到别处，可用环境变量 DOCKER_DAEMON_JSON 覆盖（同时便于测试）。
 */
export const DAEMON_JSON = process.env.DOCKER_DAEMON_JSON || "/etc/docker/daemon.json";
const DAEMON_DIR = path.dirname(DAEMON_JSON);
const BACKUP_DIR = dataPath("daemon-json-backups");

/** 提权方式：root 直接执行 / sudo -n 免密 / 无能力 */
export type ElevateMode = "root" | "sudo" | "none";

export interface DaemonConfigInfo {
  /** 配置文件路径（固定 /etc/docker/daemon.json） */
  path: string;
  /** 文件是否存在 */
  exists: boolean;
  /** 运行本服务的系统用户 */
  runAs: string;
  isRoot: boolean;
  sudoAvailable: boolean;
  elevate: ElevateMode;
  /** 能否读取（直接或经 sudo） */
  canRead: boolean;
  /** 能否写入（静态判断：root 或 sudo -n 可用；实际写入仍可能因 ProtectSystem 等失败） */
  canWrite: boolean;
  /** 能否重启 Docker（静态判断） */
  canRestart: boolean;
  /** daemon.json 中的 registry-mirrors */
  registryMirrors: string[];
  /** 除 registry-mirrors 之外的其它配置键（写入时原样保留） */
  otherKeys: string[];
  /** 原始文件内容（未格式化） */
  raw: string;
  parseError?: string;
  /** 读取失败原因 */
  error?: string;
  /** 无权限/异常时的修复建议（可直接粘到终端执行） */
  hint?: string;
}

export interface WriteDaemonResult {
  ok: boolean;
  /** 内容是否发生变化（未变化则无需重启） */
  changed: boolean;
  /** 写入前的备份文件（应用数据目录内，始终可写） */
  backupPath?: string;
  /** 写入后的完整文件内容 */
  content?: string;
  /** 使用的提权方式 */
  elevate?: ElevateMode;
  output?: string;
  error?: string;
  hint?: string;
}

export interface RestartResult {
  ok: boolean;
  /** 实际执行成功的命令 */
  command?: string;
  output: string;
  error?: string;
}

// ---------------------------------------------------------------- 权限探测

let _privCache: { at: number; isRoot: boolean; sudo: boolean; user: string } | null = null;
const PRIV_TTL = 30_000;

function detectPrivileges(force = false) {
  if (!force && _privCache && Date.now() - _privCache.at < PRIV_TTL) return _privCache;
  const isRoot = typeof process.getuid === "function" ? process.getuid() === 0 : false;
  let sudo = false;
  if (!isRoot) {
    try {
      // 注意：不能用 `sudo -n true` 探测——最小授权的 sudoers 白名单里没有 true，
      // 会把已正确授权的环境误判为「无写权限」。`sudo -n -l` 只要存在 NOPASSWD
      // 规则即免密成功，且输出会列出放行的命令。
      const r = spawnSync("sudo", ["-n", "-l"], { encoding: "utf-8", stdio: "pipe", timeout: 10_000 });
      sudo = r.status === 0 && /NOPASSWD/.test(r.stdout || "");
    } catch {
      sudo = false;
    }
  }
  let user = "unknown";
  try {
    const u = spawnSync("id", ["-un"], { encoding: "utf-8", stdio: "pipe" });
    user = (u.stdout || "").trim() || "unknown";
  } catch { /* Windows / 无 id 命令时忽略 */ }
  _privCache = { at: Date.now(), isRoot, sudo, user };
  return _privCache;
}

/** 主动刷新权限探测缓存（安装 sudoers 后可用） */
export function refreshPrivileges() {
  return detectPrivileges(true);
}

/**
 * 无权限时回显给前端的修复建议：sudoers 授权 + systemd 放开 /etc/docker 可写。
 * 服务以非 root 运行且 systemd 开了 NoNewPrivileges=yes / ProtectSystem=strict 时，
 * sudo 会被 no_new_privs 拦截、/etc 只读，必须同时调整 service 才能写入。
 */
export function buildSudoersHint(user: string): string {
  return [
    `# 1) 放开最小命令集（运行用户：${user}）`,
    `sudo tee /etc/sudoers.d/docker-manager-yanzi >/dev/null <<'EOF'`,
    `${user} ALL=(root) NOPASSWD: \\`,
    `  /usr/bin/cat ${DAEMON_JSON}, \\`,
    `  /usr/bin/tee ${DAEMON_JSON}, \\`,
    `  /usr/bin/mkdir -p ${DAEMON_DIR}, \\`,
    `  /usr/bin/systemctl restart docker, \\`,
    `  /usr/sbin/service docker restart`,
    `EOF`,
    `sudo chmod 440 /etc/sudoers.d/docker-manager-yanzi`,
    ``,
    `# 2) 放开 systemd 限制（NoNewPrivileges 会拦截 sudo，ProtectSystem 会让 /etc 只读）`,
    `sudo sed -i 's/^NoNewPrivileges=.*/NoNewPrivileges=no/' /etc/systemd/system/docker-manager-yanzi.service`,
    `sudo sed -i 's|^ReadWritePaths=.*|ReadWritePaths=/opt/docker-manager-yanzi /run/docker.sock /var/run/docker.sock ${DAEMON_DIR}|' /etc/systemd/system/docker-manager-yanzi.service`,
    `sudo systemctl daemon-reload && sudo systemctl restart docker-manager-yanzi`,
  ].join("\n");
}

// ---------------------------------------------------------------- 读取

function readRaw(): { raw: string; exists: boolean; error?: string } {
  const priv = detectPrivileges();
  try {
    if (fs.existsSync(DAEMON_JSON)) {
      return { raw: fs.readFileSync(DAEMON_JSON, "utf-8"), exists: true };
    }
  } catch (e: any) {
    // 无读权限 → 走 sudo cat
    if (priv.sudo) {
      const r = spawnSync("sudo", ["-n", "cat", DAEMON_JSON], { encoding: "utf-8", stdio: "pipe" });
      if (r.status === 0) return { raw: r.stdout || "", exists: true };
      const err = String(r.stderr || "").trim();
      if (/No such file/i.test(err)) return { raw: "", exists: false };
      return { raw: "", exists: true, error: err || "无读取权限" };
    }
    return { raw: "", exists: true, error: e?.message || "无读取权限" };
  }

  // existsSync 为 false：可能因 /etc/docker 目录不可进入而误判，用 sudo 复核。
  // 注意只能用白名单内的 cat（test 不在 sudoers 白名单，会被拒）。
  if (priv.sudo) {
    const r = spawnSync("sudo", ["-n", "cat", DAEMON_JSON], { encoding: "utf-8", stdio: "pipe" });
    if (r.status === 0) return { raw: r.stdout || "", exists: true };
    const err = String(r.stderr || "").trim();
    if (/No such file/i.test(err)) return { raw: "", exists: false };
  }
  return { raw: "", exists: false };
}

/** 读取 /etc/docker/daemon.json 并返回结构化信息（供设置页展示与同步） */
export function readDaemonConfigInfo(): DaemonConfigInfo {
  const priv = detectPrivileges();
  const elevate: ElevateMode = priv.isRoot ? "root" : priv.sudo ? "sudo" : "none";
  const { raw, exists, error } = readRaw();

  const base: DaemonConfigInfo = {
    path: DAEMON_JSON,
    exists,
    runAs: priv.user,
    isRoot: priv.isRoot,
    sudoAvailable: priv.sudo,
    elevate,
    canRead: !error,
    canWrite: elevate !== "none",
    canRestart: elevate !== "none",
    registryMirrors: [],
    otherKeys: [],
    raw,
  };

  if (error) {
    return { ...base, error, hint: elevate === "none" ? buildSudoersHint(priv.user) : undefined };
  }

  if (!raw.trim()) {
    return {
      ...base,
      hint: elevate === "none" ? buildSudoersHint(priv.user) : undefined,
    };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...base, parseError: "daemon.json 顶层不是 JSON 对象，已停止解析" };
    }
    const mirrors = Array.isArray((parsed as any)["registry-mirrors"])
      ? ((parsed as any)["registry-mirrors"] as unknown[]).map((m) => String(m).trim()).filter(Boolean)
      : [];
    return {
      ...base,
      registryMirrors: mirrors,
      otherKeys: Object.keys(parsed as object).filter((k) => k !== "registry-mirrors"),
    };
  } catch (e: any) {
    return { ...base, parseError: `JSON 解析失败：${e?.message || "格式错误"}` };
  }
}

// ---------------------------------------------------------------- 写入

function ensureDir(): string | undefined {
  const priv = detectPrivileges();
  if (priv.isRoot) {
    try {
      fs.mkdirSync(DAEMON_DIR, { recursive: true });
      return undefined;
    } catch (e: any) {
      return e?.message || "创建 /etc/docker 失败";
    }
  }
  const r = spawnSync("sudo", ["-n", "mkdir", "-p", DAEMON_DIR], { encoding: "utf-8", stdio: "pipe" });
  return r.status === 0 ? undefined : String(r.stderr || r.stdout || "创建 /etc/docker 失败").trim();
}

function writeText(text: string): { ok: boolean; error?: string; output?: string } {
  const priv = detectPrivileges();
  if (priv.isRoot) {
    try {
      fs.writeFileSync(DAEMON_JSON, text, "utf-8");
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "写入失败" };
    }
  }
  // 非 root：sudo -n tee（stdout 会回显内容，仅用于排障）
  const r = spawnSync("sudo", ["-n", "tee", DAEMON_JSON], {
    input: text,
    encoding: "utf-8",
    stdio: "pipe",
  });
  if (r.status === 0) return { ok: true, output: (r.stderr || "").trim() };
  return { ok: false, error: String(r.stderr || r.stdout || "sudo tee 写入失败").trim() };
}

/** 写入前的备份：落在应用数据目录（始终可写），保留最近 10 份 */
function backupRaw(raw: string): string | undefined {
  if (!raw.trim()) return undefined;
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const file = path.join(BACKUP_DIR, `daemon.json.${Date.now()}.bak`);
    fs.writeFileSync(file, raw, "utf-8");
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("daemon.json.") && f.endsWith(".bak"))
      .sort();
    for (const old of files.slice(0, Math.max(0, files.length - 10))) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old)); } catch { /* 忽略清理失败 */ }
    }
    return file;
  } catch {
    return undefined;
  }
}

/**
 * 写回 registry-mirrors，保留 daemon.json 中的其它配置项。
 * 传空数组 → 删除 registry-mirrors 键（等价于「未配置加速源」）。
 * 内容无变化时不落盘，返回 changed=false（前端据此跳过重启提示）。
 */
export function writeDaemonConfig(registryMirrors: string[]): WriteDaemonResult {
  const priv = detectPrivileges();
  const elevate: ElevateMode = priv.isRoot ? "root" : priv.sudo ? "sudo" : "none";
  const hint = elevate === "none" ? buildSudoersHint(priv.user) : undefined;

  if (elevate === "none") {
    return { ok: false, changed: false, elevate, error: "当前进程既非 root，也没有可用的免密 sudo，无法写入 /etc/docker/daemon.json", hint };
  }

  const { raw, error } = readRaw();
  if (error) {
    return { ok: false, changed: false, elevate, error: `无法读取现有配置：${error}`, hint };
  }

  let config: Record<string, unknown> = {};
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, changed: false, elevate, error: "现有 daemon.json 顶层不是 JSON 对象，已中止写入以避免破坏配置" };
      }
      config = parsed as Record<string, unknown>;
    } catch (e: any) {
      return { ok: false, changed: false, elevate, error: `现有 daemon.json 解析失败，已中止写入：${e?.message || "格式错误"}` };
    }
  }

  const next: Record<string, unknown> = { ...config };
  const clean = (registryMirrors || []).map((m) => String(m).trim()).filter(Boolean);
  if (clean.length > 0) next["registry-mirrors"] = clean;
  else delete next["registry-mirrors"];

  // 文件不存在且没有要写入的加速源 → 什么都不做（避免凭空创建 {} 还提示重启）
  if (!raw.trim() && clean.length === 0 && Object.keys(next).length === 0) {
    return { ok: true, changed: false, elevate };
  }

  const text = JSON.stringify(next, null, 2) + "\n";
  // 与现有内容逐字符比较，避免无意义落盘与重启提示
  if (raw.trim() && raw.replace(/\s+$/, "") === text.replace(/\s+$/, "")) {
    return { ok: true, changed: false, elevate, content: raw };
  }

  const dirErr = ensureDir();
  if (dirErr) return { ok: false, changed: false, elevate, error: dirErr, hint };

  const backupPath = backupRaw(raw);
  const w = writeText(text);
  if (!w.ok) {
    return { ok: false, changed: false, elevate, backupPath, error: w.error || "写入失败", hint };
  }

  // 写后校验：重新读取并比对 registry-mirrors
  const verify = readDaemonConfigInfo();
  const same =
    verify.registryMirrors.length === clean.length &&
    verify.registryMirrors.every((m, i) => m === clean[i]);
  if (!same && !verify.parseError) {
    return {
      ok: false,
      changed: true,
      elevate,
      backupPath,
      error: "写入后校验不一致，请检查 /etc/docker/daemon.json（可能未真正生效）",
      hint,
    };
  }

  return { ok: true, changed: true, elevate, backupPath, content: text, output: w.output };
}

// ---------------------------------------------------------------- 重启

/** 重启宿主机 Docker 服务：systemctl 优先，回退 service */
export function restartDockerService(): RestartResult {
  const priv = detectPrivileges();
  const sudoPrefix = priv.isRoot ? "" : "sudo -n ";
  const commands = [
    `${sudoPrefix}systemctl restart docker`,
    `${sudoPrefix}service docker restart`,
  ];
  const chunks: string[] = [];
  for (const cmd of commands) {
    const r = spawnSync(cmd, { encoding: "utf-8", stdio: "pipe", shell: true, timeout: 180_000 });
    const out = `${(r.stdout || "").trim()}\n${(r.stderr || "").trim()}`.trim();
    chunks.push(`$ ${cmd}\n${out || "(无输出)"}`);
    if (r.status === 0) return { ok: true, command: cmd, output: chunks.join("\n\n") };
    // systemctl 不存在（如容器内）时继续尝试下一个
    if (/command not found|No such file/.test(out)) continue;
  }
  return {
    ok: false,
    output: chunks.join("\n\n"),
    error:
      priv.isRoot || priv.sudo
        ? "重启 Docker 失败，请查看输出（若运行在容器内则无法重启宿主机 Docker）"
        : "当前进程既非 root，也没有可用的免密 sudo，无法重启 Docker",
  };
}
