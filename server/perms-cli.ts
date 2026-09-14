/**
 * `fix-perms` / `permission-check` 的 CLI 实现。
 *
 * 单独成文件的原因：
 *   1. SEA 以 **CJS** 打包（`scripts/build-binary.mjs` 中 `format: "cjs"`），
 *      这里必须保持**全同步**，不能引入顶层 await；
 *   2. 让 `index.ts` 的 CLI 分支只剩几行，服务启动路径不受影响。
 *
 * 目标属主的判定（关键坑）：`sudo` 执行时 `process.getuid()` 是 **0**，
 * 若直接拿它当目标属主，会把整个数据目录 chown 给 root，服务反而彻底读不了。
 * 因此非 root 运行时用自己的 uid；root 运行时取 DATA_DIR / 安装目录的属主。
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, LOG_DIR, CONFIG_DIR, COMPOSE_DIR } from "./paths.js";
import { currentUser, userNameOf, fixPerms, scanPermIssues, formatIssue } from "./perms.js";

/** 读取路径属主 uid（失败返回 null） */
function tryUid(p: string): number | null {
  try {
    return fs.statSync(p).uid;
  } catch {
    return null;
  }
}

/** 修复目标属主 uid：见文件头注释的判定顺序 */
export function expectedUid(): number {
  const me = typeof process.getuid === "function" ? process.getuid() : -1;
  if (me > 0) return me; // 服务进程：就是自己
  for (const cand of [DATA_DIR, path.dirname(process.execPath), path.join(process.cwd(), "data")]) {
    const uid = tryUid(cand);
    if (uid !== null && uid > 0) return uid; // sudo：取数据/安装目录属主
  }
  return me;
}

/** 默认参与体检/修复的目录 */
export function defaultDirs(): string[] {
  return [DATA_DIR, CONFIG_DIR, LOG_DIR, COMPOSE_DIR].filter((d, i, arr) => arr.indexOf(d) === i);
}

function printHelp(): void {
  const lines = [
    "Docker Stack Manager · 权限修复工具",
    "",
    "用法：",
    "  docker-manager-yanzi fix-perms [选项]        递归修正数据目录属主/权限",
    "  docker-manager-yanzi permission-check        只体检并列出异常（只读）",
    "  docker-manager-yanzi --version               显示版本",
    "",
    "选项：",
    "  --dry-run            只列出将修改的项，不落盘（建议先跑一次）",
    "  --normalize-mode     额外把目录归一化为 0755、文件 0644（默认只改属主）",
    "  --path <目录>        指定目录（可重复；默认 data / config / logs / dockercompose）",
    "  --uid <数字>         指定目标属主 uid（默认为服务运行用户）",
    "  -h, --help           显示本帮助",
    "",
    "说明：默认**只修正属主，不改动权限位**，避免把 0600 的密钥文件放开成 0644。",
  ];
  for (const l of lines) console.log(l);
}

interface CliOpts {
  dryRun: boolean;
  normalizeMode: boolean;
  dirs: string[];
  uid: number | "auto";
  help: boolean;
}

function parseOpts(argv: string[]): CliOpts {
  const o: CliOpts = { dryRun: false, normalizeMode: false, dirs: [], uid: "auto", help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--normalize-mode") o.normalizeMode = true;
    else if (a === "--path") {
      const v = argv[++i];
      if (v) o.dirs.push(path.resolve(v));
    } else if (a === "--uid") {
      const v = Number(argv[++i]);
      if (Number.isInteger(v) && v >= 0) o.uid = v;
    } else if (a === "-h" || a === "--help") o.help = true;
  }
  return o;
}

function header(title: string, opts: CliOpts, targetUid: number): void {
  console.log(`Docker Stack Manager · ${title}`);
  console.log(`  目标属主: ${targetUid} (${userNameOf(targetUid)})`);
  console.log(`  扫描目录: ${(opts.dirs.length ? opts.dirs : defaultDirs()).join(", ")}`);
  console.log(`  模式: ${opts.dryRun ? "试运行（不会改动任何文件）" : opts.normalizeMode ? "执行（并归一化权限位）" : "执行（只改属主，不动权限位）"}`);
  console.log("");
}

const isWindows = process.platform === "win32";

/** `fix-perms` 入口，返回退出码 */
export function runFixPermsCli(argv: string[]): number {
  const opts = parseOpts(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (isWindows) {
    console.log("fix-perms 仅适用于 Linux 部署（Windows 无 POSIX 属主模型）。");
    return 0;
  }
  const targetUid = opts.uid === "auto" ? expectedUid() : opts.uid;
  const targetGid = targetUid;
  if (targetUid < 0) {
    console.error("无法判定目标属主，请用 --uid <数字> 显式指定。");
    return 2;
  }
  const dirs = opts.dirs.length ? opts.dirs : defaultDirs();
  header("权限修复", { ...opts, dirs }, targetUid);

  const stats = fixPerms({
    dirs,
    targetUid,
    targetGid,
    dryRun: opts.dryRun,
    normalizeMode: opts.normalizeMode,
    onLine: (l) => console.log(l),
  });

  console.log("");
  console.log(
    `检查 ${stats.checked} 项；${opts.dryRun ? "属主待修正" : "属主已修正"} ${stats.ownerFixed}；` +
      `${opts.dryRun ? "权限待修正" : "权限已修正"} ${stats.modeFixed}；无变化 ${stats.skipped}；失败 ${stats.failed}`
  );
  if (opts.dryRun) console.log("试运行结束：去掉 --dry-run 即可实际执行。");
  else if (stats.failed === 0) console.log("完成。若服务仍在运行，建议重启一次以便重新扫描。");
  return stats.failed > 0 ? 1 : 0;
}

/** `permission-check` 入口（只读），返回退出码：有异常 → 1 */
export function runPermissionCheckCli(argv: string[]): number {
  const opts = parseOpts(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  if (isWindows) {
    console.log("permission-check 仅适用于 Linux 部署（Windows 无 POSIX 属主模型）。");
    return 0;
  }
  const targetUid = opts.uid === "auto" ? expectedUid() : opts.uid;
  const dirs = opts.dirs.length ? opts.dirs : defaultDirs();
  console.log("Docker Stack Manager · 权限体检（只读）");
  console.log(`  运行用户: ${currentUser().name}(uid ${currentUser().uid})`);
  console.log(`  目标属主: ${targetUid} (${userNameOf(targetUid)})`);
  console.log("");

  const { checked, issues } = scanPermIssues(dirs, targetUid);
  if (!issues.length) {
    console.log(`检查 ${checked} 项，未发现权限异常。`);
    return 0;
  }
  console.log(`检查 ${checked} 项，发现 ${issues.length} 个异常：`);
  for (const i of issues) {
    console.log(`  ✗ ${formatIssue(i)}`);
    console.log(`    原因：${i.reason}`);
    console.log(`    修复：${i.advice}`);
  }
  console.log("");
  console.log("建议执行：sudo <安装目录>/docker-manager-yanzi fix-perms --dry-run");
  return 1;
}
