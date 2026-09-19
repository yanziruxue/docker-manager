/**
 * ============================================
 * systemd 服务单元一致性检查
 *
 * 背景（v1.23.5）：`deploy/linux/docker-manager-yanzi.service` 由 `install.sh`
 * 复制到 `/etc/systemd/system/`，而**在线升级（OTA）只替换二进制、从不碰这个文件**。
 * 于是任何「依赖新单元指令」的功能（如 `RuntimeDirectory` / `ExecStartPre`
 * 让 root 把 DMI 序列号镜像成世界可读副本）在旧部署上会**静默失效**，用户只看到「—」，
 * 无从判断是硬件没烧录、权限不足，还是服务单元没更新。
 *
 * 本模块把「构建期嵌入的单元模板」与「已安装单元 + drop-in」比对，列出缺失指令，
 * 并给出一条可直接粘贴的 root 修复命令，供前端在「本机设备」卡片上提示。
 *
 * 纯只读，不影响硬件指纹与业务逻辑。
 * ============================================
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";

/** 单元文件名（与 deploy/linux/ 下同名） */
export const UNIT_NAME = "docker-manager-yanzi.service";
/** systemd 单元安装目录 */
const UNIT_DIR = "/etc/systemd/system";
/** 单元内 `RuntimeDirectory=` 对应的目录：DMI 镜像副本落在这里 */
export const DMI_MIRROR_DIR = "/run/docker-manager-yanzi";

// BUILD_BINARY 由 esbuild define 注入，仅二进制构建时为 true（与 index.ts 同款保护）
declare const BUILD_BINARY: boolean | undefined;

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
  const template = loadTemplate();
  const installedUnit = readIfExists(unitPath);

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

  // 非 systemd 部署（Windows 开发机 / 容器内）不做判定，避免误报
  const applicable = process.platform === "linux" && !!installedUnit && !!template;

  let missing: string[] = [];
  if (template && installedUnit) {
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
