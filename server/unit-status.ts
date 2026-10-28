/**
 * ============================================
 * systemd 服务单元一致性检查
 *
 * 背景（v1.23.5）：`deploy/linux/dockermanagementyanzi.service` 由 `install.sh`
 * 复制到 `/etc/systemd/system/`，而**在线升级（OTA）只替换二进制、从不碰这个文件**。
 * 于是任何「依赖新单元指令」的功能（如 `RuntimeDirectory` / `ExecStartPre`
 * 让 root 把 DMI 序列号镜像成世界可读副本）在旧部署上会**静默失效**，用户只看到「—」，
 * 无从判断是硬件没烧录、权限不足，还是服务单元没更新。
 *
 * 本模块把「构建期嵌入的单元模板」与「已安装单元 + drop-in」比对，列出缺失指令，
 * 并给出一条可直接粘贴的 root 修复命令，供前端在「硬件信息」卡片上提示。
 *
 * 纯只读，不影响硬件指纹与业务逻辑。
 * ============================================
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";

/** 单元文件名（与 deploy/linux/ 下同名） */
export const UNIT_NAME = "dockermanagementyanzi.service";
/** 应用名 = 二进制文件名（用于判断当前是否 SEA 二进制部署） */
const APP_NAME = "dockermanagementyanzi";
/** systemd 单元安装目录 */
const UNIT_DIR = "/etc/systemd/system";
/** 单元内 `RuntimeDirectory=` 对应的目录：DMI 镜像副本落在这里 */
export const DMI_MIRROR_DIR = "/run/dockermanagementyanzi";

// BUILD_BINARY 由 esbuild define 注入，仅二进制构建时为 true（与 index.ts 同款保护）
declare const BUILD_BINARY: boolean | undefined;

/**
 * 解析**实际安装目录**（v1.41.1 起安装目录可自定义，模板里是 `__INSTALL_DIR__` 占位符）。
 *
 * 为什么必须解析：单元模板里的路径占位符由 `install.sh` 安装期替换为实际安装目录，
 * 后端拿到的却是**未替换的模板**。若不还原，`WorkingDirectory=__INSTALL_DIR__` 与已安装
 * 单元里的真实路径永远对不上 ⇒ ① 前端一直误报「服务单元落后」；② 更糟的是「一键修复」
 * 会把未替换的占位符原样写进 `/etc/systemd/system/`，服务直接起不来。
 *
 * 取值口径：SEA 二进制部署时 `process.execPath` 就是安装目录内的二进制
 * （systemd 的 `WorkingDirectory` 也是这个目录）。
 * 开发模式（`npm run dev:server`，execPath 是 node）或非二进制构建 ⇒ 返回 null，
 * 调用方据此把 `applicable` 置为 false，**不做任何判定与修复提示** —— 宁可不提示，
 * 也绝不给出会把单元写坏的"修复命令"。
 */
function resolveInstallDir(): string | null {
  const isBinary = typeof BUILD_BINARY !== "undefined" && BUILD_BINARY === true;
  if (!isBinary) return null;
  if (path.basename(process.execPath) !== APP_NAME) return null;
  return path.dirname(process.execPath);
}

/** 构建期嵌入的单元模板；非二进制构建回退读仓库内的 deploy/linux/ */
function loadTemplate(): string | null {
  if (typeof BUILD_BINARY !== "undefined" && BUILD_BINARY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return (require("virtual:embedded-service") as { default: string }).default;
    } catch {
      return null;
    }
  }
  // 开发模式：相对 cwd（npm run dev:server 时为仓库根目录）
  try {
    return readFileSync(path.join(process.cwd(), "deploy", "linux", UNIT_NAME), "utf-8");
  } catch {
    return null;
  }
}

/**
 * 解析单元模板里服务账户 / 主组占位符的真实值。
 *
 * 为什么不能只靠 `os.userInfo()`：`fixCommand` 由**正在运行的服**务进程（以 SERVICE_USER
 * 身份）生成，此时 `os.userInfo().username` 就是服务运行账户 —— 本就正确；但若现场单元已被
 * 写成字面量（手工改过 / 历史残留 `User=__SERVICE_USER__`），以「已安装单元里当前生效的
 * `User=` / `Group=`」为准更稳妥，也能把**被错误写成占位符的单元**救回来（回退到进程身份）。
 *
 * 取值优先级（user / group 同款）：
 *   1) 已安装单元里**非占位符**、非空的 `User=` / `Group=` 行（最权威，反映当前配置）
 *   2) 否则：用户 = `os.userInfo().username`；组 = `id -gn <用户>`（拿不到则回退用户名）
 */
function resolveUnitUserGroup(installedText: string | null): { user: string; group: string } {
  let user = "";
  let group = "";
  if (installedText) {
    const um = installedText.match(/^User=(.*)$/m);
    if (um && um[1] && !um[1].includes("__")) user = um[1].trim();
    const gm = installedText.match(/^Group=(.*)$/m);
    if (gm && gm[1] && !gm[1].includes("__")) group = gm[1].trim();
  }
  if (!user) {
    try {
      user = os.userInfo().username;
    } catch {
      user = "";
    }
  }
  if (!group && user) {
    try {
      group = execSync(`id -gn ${user}`, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      group = user;
    }
  }
  if (!group) group = user;
  return { user, group };
}

/**
 * 把单元模板里的三类占位符全部还原为实际值，得到「与已安装单元可逐行比对」的版本。
 * - `__INSTALL_DIR__`：安装目录（SEA 二进制部署时取 `process.execPath` 所在目录）
 * - `__SERVICE_USER__` / `__SERVICE_GROUP__`：服务运行账户 / 主组（见 `resolveUnitUserGroup`）
 * 未解析（开发模式 / 安装目录取不到）时对应占位符保留原样，由调用方把 `applicable` 置 false。
 */
export function resolveUnitTemplate(raw: string, installDir: string | null, installedText: string | null): string {
  const withDir =
    installDir != null ? raw.replace(/__INSTALL_DIR__/g, installDir) : raw;
  const { user, group } = resolveUnitUserGroup(installedText);
  return withDir.replace(/__SERVICE_USER__/g, user).replace(/__SERVICE_GROUP__/g, group);
}

function readIfExists(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

/**
 * 解析单元文本中的指令行：合并反斜杠续行，忽略空行 / 注释 / `[Section]` 段头。
 * 只比对「指令集合」而非整文件 —— 运维若手工在单元里加了注释，不应被误判为落后。
 */
function directiveLines(text: string): string[] {
  const merged: string[] = [];
  let pending = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (pending) {
      pending += "\n" + line;
      if (!line.endsWith("\\")) {
        merged.push(pending);
        pending = "";
      }
      continue;
    }
    if (line.endsWith("\\")) {
      pending = line;
      continue;
    }
    merged.push(line);
  }
  if (pending) merged.push(pending);
  return merged
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith(";") && !l.startsWith("["));
}

/**
 * 模板中「已安装单元文本里没有」的指令（导出以便自测 / 复用）。
 * 子集判定：只要键值行原样存在即视为已覆盖。
 */
export function missingDirectives(template: string, installedText: string): string[] {
  const installed = new Set(directiveLines(installedText));
  return directiveLines(template).filter((d) => !installed.has(d));
}

/** 指令行的简短展示（`ExecStartPre=+…` → `ExecStartPre`），日志/提示用 */
export function shortDirective(directive: string): string {
  return directive.split("=")[0];
}

export interface ServiceUnitStatus {
  /** 是否适用：Linux 且存在已安装单元（Windows / 容器 / 未装服务时为 false） */
  applicable: boolean;
  unitName: string;
  unitPath: string;
  exists: boolean;
  /** 已安装单元 + drop-in 中**缺失**的指令（空数组 = 一致） */
  missing: string[];
  /** 已加载的 drop-in 文件名（`/etc/systemd/system/<unit>.d/*.conf`） */
  dropIns: string[];
  /** DMI 镜像目录及其中的文件（用于区分「单元没更新」与「服务未重启」） */
  mirrorDir: string;
  mirrorFiles: string[];
  /** 已安装单元是否覆盖了模板的全部指令 */
  upToDate: boolean;
  /** 一键修复命令（多行，含 sudo；空串表示不适用） */
  fixCommand: string;
}

/** 检查已安装的 systemd 单元是否与当前二进制内置模板一致 */
export function checkServiceUnit(): ServiceUnitStatus {
  const unitPath = path.join(UNIT_DIR, UNIT_NAME);
  const rawTemplate = loadTemplate();
  const installedUnit = readIfExists(unitPath);
  const installDir = resolveInstallDir();
  // 三类占位符全部还原：安装目录 + 服务账户/主组。唯有已还原的模板才能与已安装单元
  // 逐行比对（否则 `User=__SERVICE_USER__` 永远对不上 `User=yanzi` ⇒ 一直误报「落后」），
  // 也唯有已还原的模板才能作为**有效的**一键修复命令（否则会把占位符原样写进 systemd）。
  const template = rawTemplate ? resolveUnitTemplate(rawTemplate, installDir, installedUnit) : rawTemplate;

  // drop-in：`<unit>.d/*.conf` —— 现场只补差异的推荐做法，必须一并计入已安装指令
  const dropDir = `${unitPath}.d`;
  let dropIns: string[] = [];
  let dropInText = "";
  try {
    dropIns = readdirSync(dropDir)
      .filter((f) => f.endsWith(".conf"))
      .sort();
    for (const f of dropIns) dropInText += "\n" + (readIfExists(path.join(dropDir, f)) || "");
  } catch {
    /* 无 drop-in 目录 */
  }

  // DMI 镜像目录（RuntimeDirectory 若未声明则不存在）
  let mirrorFiles: string[] = [];
  try {
    mirrorFiles = readdirSync(DMI_MIRROR_DIR).sort();
  } catch {
    /* 目录不存在 */
  }

  // 非 systemd 部署（Windows 开发机 / 容器内）不做判定，避免误报；
  // ★ 开发模式（非 SEA 二进制）拿不到安装目录 ⇒ 同样不适用：
  //   此时模板里仍是未还原的 __INSTALL_DIR__，比对必然全不匹配、修复命令还会写坏单元。
  const applicable =
    process.platform === "linux" && !!installedUnit && !!template && installDir !== null;

  let missing: string[] = [];
  if (applicable && template && installedUnit) {
    missing = missingDirectives(template, installedUnit + dropInText);
  }

  const fixCommand =
    template && applicable
      ? [
          `sudo tee ${unitPath} >/dev/null <<'EOF'`,
          template.replace(/\s+$/, ""),
          "EOF",
          `sudo systemctl daemon-reload && sudo systemctl restart ${UNIT_NAME.replace(/\.service$/, "")}`,
        ].join("\n")
      : "";

  return {
    applicable,
    unitName: UNIT_NAME,
    unitPath,
    exists: !!installedUnit,
    missing,
    dropIns,
    mirrorDir: DMI_MIRROR_DIR,
    mirrorFiles,
    upToDate: applicable && missing.length === 0,
    fixCommand,
  };
}

/** 启动日志用的一行摘要（仅落后时输出） */
export function describeServiceUnitGap(s: ServiceUnitStatus): string {
  return s.missing.map(shortDirective).join("、");
}

/** 镜像目录是否存在（供诊断） */
export function dmiMirrorDirExists(): boolean {
  return existsSync(DMI_MIRROR_DIR);
}
