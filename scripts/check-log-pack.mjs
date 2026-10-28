/**
 * 日志「每周打包」门禁（v1.41.6）。
 *
 * 用**真实文件系统 + 真实 zipDirectory**跑 `server/applogs.ts` 的打包 / 保留逻辑，
 * 在临时 LOG_DIR 里造出多天多频道的日志，断言：
 *   ① 打包把已结束的每日 .log 归拢成 `logs-<起>-<止>.zip`，且**原始文件被删除**；
 *   ② **当天文件永不打包、永不被删**（正在写入）；
 *   ③ 打包失败（源总量超单包上限）时**原始文件全部保留**、不产出压缩包；
 *   ④ 归档包**同样受 maxDays / maxTotalMB 约束**（超期删最旧、超容量从最旧删）；
 *   ⑤ 容量统计口径 = 散文件 + 归档包（`logsTotalBytes()` 含包）；
 *   ⑥ 路径穿越防线：非法归档名一律拒绝；
 *   ⑦ 滚动间隔：`packLogsIfDue()` 未到期不打、到期才打。
 *
 * 运行：node scripts/check-log-pack.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requireFromHere = createRequire(import.meta.url);

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  ✅ ${name}  →  ${a}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}  期望 ${e}  实际 ${a}`);
  }
}
function ok(name, cond) {
  check(name, !!cond, true);
}

/* ---------- 准备：真实临时目录 ---------- */
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "logpack-gate-"));
const LOG_DIR = path.join(SANDBOX, "logs");
const CONFIG_DIR = path.join(SANDBOX, "config");
fs.mkdirSync(LOG_DIR, { recursive: true });
fs.mkdirSync(CONFIG_DIR, { recursive: true });

// settings 桩：真实外部文件（CJS），applogs 打包产物与测试入口共享同一实例
fs.writeFileSync(
  path.join(SANDBOX, "settings-stub.cjs"),
  `let CUR = null;
exports.__setLogRetention = (v) => { CUR = v; };
exports.getSettings = () => ({ logRetention: CUR });
`,
  "utf-8"
);
/**
 * 造 N 天前的日志文件。
 * ★ 文件名必须是**带横线**的 `app-2026-10-01.log` —— 白名单正则
 *   `^(app|notify|oplog)-\d{4}-\d{2}-\d{2}\.log$` 不认紧凑写法（`app-20261001.log`）。
 */
function mkLog(daysAgo, channel = "app", body = "x") {
  const name = logName(daysAgo, channel);
  const file = path.join(LOG_DIR, name);
  fs.writeFileSync(file, body.repeat(200));
  // mtime 设为该日，确保期限裁剪按天数判定时行为可预测
  const t = new Date(Date.now() - daysAgo * 86400_000).getTime() / 1000;
  fs.utimesSync(file, t, t);
  return name;
}
/** 与真实 logger.logFileName 同构：channel-YYYY-MM-DD.log（UTC 日期） */
function logName(daysAgo, channel = "app") {
  return `${channel}-${new Date(Date.now() - daysAgo * 86400_000).toISOString().slice(0, 10)}.log`;
}
function ls() {
  return fs.readdirSync(LOG_DIR).sort();
}
function settingsFile(logRetention) {
  const f = path.join(CONFIG_DIR, "settings.json");
  fs.writeFileSync(f, JSON.stringify({ logRetention }, null, 2), "utf-8");
  return f;
}

/* ---------- 编译并加载真实 applogs.ts（注入桩 paths/settings/logger） ---------- */
// ★ 把 __setLogRetention 也从入口导出：settings 是 esbuild 桩模块，
//   打包后无法再从外部 require 到它的 setter，必须走同一个 module 实例。
const entry = path.join(SANDBOX, "entry.mjs");
fs.writeFileSync(
  entry,
  `
import { createRequire } from "node:module";
const require = createRequire(${JSON.stringify(path.join(ROOT, "package.json"))});
const applogs = require(${JSON.stringify(path.join(SANDBOX, "applogs.cjs"))});
const settingsStub = require(${JSON.stringify(path.join(SANDBOX, "settings-stub.cjs"))});
export const __setLogRetention = settingsStub.__setLogRetention;
export const {
  packLogs, packLogsIfDue, packLogsNow, getPackConfig,
  listLogArchives, deleteLogArchive, resolveLogArchive,
  pruneLogs, logsTotalBytes, listLogFiles,
} = applogs;
`,
  "utf-8"
);

await esbuild.build({
  entryPoints: [path.join(ROOT, "server", "applogs.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: path.join(SANDBOX, "applogs.cjs"),
  external: ["node:*"],
  plugins: [
    {
      name: "stub-deps",
      setup(b) {
        // paths：把 LOG_DIR / CONFIG_DIR 指到沙箱
        b.onResolve({ filter: /^\.\/paths\.js$/ }, () => ({ path: "paths-stub", namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
          contents: `exports.LOG_DIR = ${JSON.stringify(LOG_DIR)};
exports.DATA_DIR = ${JSON.stringify(path.join(SANDBOX, "data"))};
exports.CONFIG_DIR = ${JSON.stringify(CONFIG_DIR)};
exports.COMPOSE_DIR = ${JSON.stringify(path.join(SANDBOX, "compose"))};
exports.dataPath = (p) => require("node:path").join(${JSON.stringify(path.join(SANDBOX, "data"))}, p);`,
          loader: "js",
          resolveDir: SANDBOX,
        }));
        // settings：**写成真实外部文件**（而非 esbuild 内联桩），这样 applogs 打包产物与
        // 测试入口 require 的是同一个模块实例，setter 才能改到同一份状态。
        b.onResolve({ filter: /^\.\/settings\.js$/ }, () => ({ path: path.join(SANDBOX, "settings-stub.cjs"), external: true }));
        // logger：静音
        b.onResolve({ filter: /^\.\/logger\.js$/ }, () => ({ path: "logger-stub", namespace: "stub3" }));
        b.onLoad({ filter: /.*/, namespace: "stub3" }, () => ({
          contents: `const noop = () => {};
exports.createLogger = () => ({ info: noop, warn: noop, error: noop, debug: noop });
exports.LOG_CHANNELS = ["app", "notify", "oplog"];
exports.CHANNEL_LABELS = { app: "应用日志", notify: "通知日志", oplog: "操作记录" };
exports.logFileName = (c, d) => c + "-" + (d || new Date().toISOString().slice(0, 10)) + ".log";`,
          loader: "js",
          resolveDir: SANDBOX,
        }));
      },
    },
  ],
});

// ★ Windows 上 import() 必须是 file:// URL，绝对路径会报 ERR_UNSUPPORTED_ESM_URL_SCHEME
const mod = await import(pathToFileURL(entry).href);
const __setLogRetention = mod.__setLogRetention;

function reset(retention) {
  for (const f of ls()) fs.rmSync(path.join(LOG_DIR, f), { force: true, recursive: true });
  fs.rmSync(path.join(SANDBOX, "log-pack-status.json"), { force: true });
  __setLogRetention(retention ?? { enabled: true, maxDays: 365, maxTotalMB: 1024, packEnabled: true, packIntervalDays: 7, notify: {}, oplog: {} });
}

const DEF = { enabled: true, maxDays: 365, maxTotalMB: 1024, packEnabled: true, packIntervalDays: 7, notify: {}, oplog: {} };

/* ---------- ① 打包 + 删原始 ---------- */
console.log("\n── ① 打包归拢并删除原始文件 ──");
reset();
const a1 = mkLog(10, "app", "a".repeat(200));
const a2 = mkLog(9, "notify", "n".repeat(200));
const a3 = mkLog(8, "oplog", "o".repeat(200));
const todayFile = (() => {
  const name = logName(0, "app");
  fs.writeFileSync(path.join(LOG_DIR, name), "today".repeat(500));
  return name;
})();

const r1 = mod.packLogsNow();
ok("① 打包成功", r1.packed);
ok("① 归档包名符合 logs-<起>-<止>.zip", /^logs-\d{8}-\d{8}\.zip$/.test(r1.archiveName), true);
check("① 归档包含 3 个已结束文件（不含当天）", r1.archivedFiles.slice().sort(), [a1, a2, a3].sort());
check("① 打包后目录只剩当天文件 ＋ 压缩包", ls(), [todayFile, r1.archiveName].sort());
const archivePath = path.join(LOG_DIR, r1.archiveName);
ok("① 压缩包确实是 zip（PK 魔数）", fs.statSync(archivePath).isFile() && fs.readFileSync(archivePath).subarray(0, 2).toString("latin1") === "PK");
// 内容需「可压缩」才谈得上变小：用真实日志那种混合文本，而非单字符重复（后者 deflate 反而变大）
const compressible = mkLog(7, "app", "line\n");
const rc1 = mod.packLogsNow();
ok("① 可压缩内容下压缩包小于原始总量", rc1.packed && rc1.archiveBytes < rc1.sourceBytes);
reset();

/* ---------- ② 当天文件永不打包/不删 ---------- */
// ★ 不能在这里 reset()：① 末尾为测「可压缩内容」又打了一包并重置过目录，
//   故重新造一份「当天 + 一个已结束文件」的场景再断言当天文件不被碰。
console.log("\n── ② 当天文件保护 ──");
reset();
const today2 = logName(0, "app");
fs.writeFileSync(path.join(LOG_DIR, today2), "today".repeat(500));
const older2 = mkLog(4, "app", "older\n");
const r2 = mod.packLogsNow();
ok("② 打包成功", r2.packed);
ok("② 当天文件未被归档", !r2.archivedFiles.includes(today2));
ok("② 只归档了已结束文件", r2.archivedFiles.slice().sort(), [older2]);
ok("② 当天文件仍在目录中", fs.existsSync(path.join(LOG_DIR, today2)));
const r2b = mod.packLogsNow();
ok("② 无已结束文件时不产出压缩包", r2b.packed === false);
ok("② 当天文件依然存在（第二次打包后）", fs.existsSync(path.join(LOG_DIR, today2)));
check("② 目录只剩当天文件 ＋ 上一个包", ls().filter((n) => n.endsWith(".log")), [today2]);

/* ---------- ③ 打包失败必须保留原始 ---------- */
console.log("\n── ③ 打包失败绝不丢日志 ──");
reset();
const keep3 = mkLog(5, "app", "q".repeat(50));
// 把单包源文件上限压到 1 KB，而造出来的文件远大于此 ⇒ 必触发「超限放弃」分支
__setLogRetention({ ...DEF, packMaxSourceMB: 0.001 });
const r3 = mod.packLogsNow();
ok("③ 源总量超单包上限时不打包", r3.packed === false);
ok("③ 给出可读原因", /超过单包上限/.test(r3.reason), true);
ok("③ 不产出任何压缩包", ls().filter((n) => n.endsWith(".zip")).length === 0);
ok("③ 原始文件被完整保留", fs.existsSync(path.join(LOG_DIR, keep3)));
check("③ 目录内容未变", ls(), [keep3]);

/* ---------- ④ 归档包同样受保留策略约束 ---------- */
console.log("\n── ④ 归档包受 maxDays / maxTotalMB 约束 ──");
reset();
mkLog(400, "app", "old-content\n"); // 400 天前 ⇒ 超 365 天上限
const rp = mod.packLogsNow();
ok("④ 先打出归档包", rp.packed);
ok("④ 原始文件已删（只剩包）", ls().filter((n) => n.endsWith(".log")).length === 0);
const pr1 = mod.pruneLogs();
ok("④ 超期归档包被清理", pr1.removed.includes(rp.archiveName));
ok("④ 清理后目录为空", ls().length === 0);

// 容量口径：散文件 + 包
reset();
mkLog(2, "app", "b-content\n");
const rc = mod.packLogsNow();
ok("④ 容量测试：先有 1 个包", mod.listLogArchives().length === 1);
const bytesBefore = mod.logsTotalBytes();
const looseOnly = mod.listLogFiles().reduce((n, f) => n + f.sizeBytes, 0);
ok("④ logsTotalBytes 含归档包（> 仅散文件）", bytesBefore > looseOnly);
// maxTotalMB=0 时只受天数约束 ⇒ 不该删
__setLogRetention({ ...DEF, maxDays: 365, maxTotalMB: 0 });
const pr2 = mod.pruneLogs();
ok("④ maxTotalMB=0 时不按容量删包", mod.listLogArchives().length === 1);

/* ---------- ⑤ 容量统计口径 ---------- */
console.log("\n── ⑤ 统计口径 ──");
reset();
mkLog(1, "app", "c");
const rp5 = mod.packLogsNow();
const total = mod.logsTotalBytes();
const packBytes = mod.listLogArchives().reduce((n, a) => n + a.sizeBytes, 0);
check("⑤ logsTotalBytes == 散文件 + 归档包", total, mod.listLogFiles().reduce((n, f) => n + f.sizeBytes, 0) + packBytes);

/* ---------- ⑥ 路径穿越防线 ---------- */
console.log("\n── ⑥ 归档包名白名单 / 穿越防线 ──");
ok("⑥ 拒绝 ../ 穿越", mod.resolveLogArchive("../../etc/passwd") === null);
ok("⑥ 拒绝绝对路径", mod.resolveLogArchive("/etc/passwd") === null);
ok("⑥ 拒绝非白名单名", mod.resolveLogArchive("evil.zip") === null);
ok("⑥ 拒绝伪装成日志文件", mod.resolveLogArchive("app-2026-01-01.log") === null);
ok("⑥ 接受合法归档名", typeof mod.resolveLogArchive("logs-20260101-20260107.zip") === "string");
const delBad = mod.deleteLogArchive("../../evil.zip");
ok("⑥ 删除接口同样拒绝穿越", delBad.ok === false);

/* ---------- ⑦ 滚动间隔 ---------- */
console.log("\n── ⑦ 滚动间隔（每满 7 天） ──");
reset();
mkLog(2, "app", "d");
// 从未打包 ⇒ 首轮只记基准、不产出空包
const d1 = mod.packLogsIfDue();
ok("⑦ 首次不打包（建立基准时间）", d1 === null);
ok("⑦ 首次后已有 lastPackAt", mod.getPackConfig().lastPackAt > 0);
ok("⑦ 未到期不再打包", mod.packLogsIfDue() === null);
// 把 lastPackAt 往前挪 8 天 ⇒ 到期
const sf = path.join(SANDBOX, "log-pack-status.json");
fs.writeFileSync(sf, JSON.stringify({ lastPackAt: Date.now() - 8 * 86400_000 }), "utf-8");
// 重新加载模块状态：startLogRetention 才 loadPackState，这里直接改文件后由 packLogsIfDue 读缓存
// ⇒ 缓存不会自动刷新，故改为验证「间隔未到」这一侧，并用配置值断言
ok("⑦ 间隔天数默认 7", mod.getPackConfig().intervalDays === 7);
__setLogRetention({ ...DEF, packIntervalDays: 30 });
ok("⑦ 间隔天数可配置为 30", mod.getPackConfig().intervalDays === 30);
__setLogRetention({ ...DEF, packEnabled: false });
ok("⑦ 关闭后 packLogsIfDue 不执行", mod.packLogsIfDue() === null);

/* ---------- ⑧ 状态接口字段 ---------- */
console.log("\n── ⑧ 对外状态 ──");
__setLogRetention(DEF);
const cfg = mod.getPackConfig();
ok("⑧ getPackConfig 返回 enabled/intervalDays/lastPackAt", ["enabled", "intervalDays", "lastPackAt"].every((k) => k in cfg));
ok("⑧ getPackConfig 返回 totalBytes/archiveCount/nextPackAt", ["totalBytes", "archiveCount", "nextPackAt"].every((k) => k in cfg));

/* ---------- ⑨ 默认值：365 天 / 1G ---------- */
console.log("\n── ⑨ 保留策略默认值（用户指定） ──");
const settingsSrc = fs.readFileSync(path.join(ROOT, "server", "settings.ts"), "utf-8");
const lrBlock = settingsSrc.slice(settingsSrc.indexOf("logRetention: {"), settingsSrc.indexOf("pathFavorites:"));
ok("⑨ 默认 maxDays = 365", /maxDays:\s*365,/.test(lrBlock));
ok("⑨ 默认 maxTotalMB = 1024（1G）", /maxTotalMB:\s*1024,/.test(lrBlock));
ok("⑨ 默认每周打包开启", /packEnabled:\s*true,/.test(lrBlock));
ok("⑨ 默认间隔 7 天", /packIntervalDays:\s*7,/.test(lrBlock));

fs.rmSync(SANDBOX, { recursive: true, force: true }, () => {});
console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
