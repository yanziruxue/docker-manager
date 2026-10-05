/**
 * v1.38.0 日志分频道门禁（npm run test:logs，并入 test:gates）
 * 覆盖：三频道写文件 / 白名单（含穿越拒绝）/ 分频道保留策略（继承 + 独立 + 永不删当天）
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(".tmp-logchan-check");
const LOGS = path.join(ROOT, "logs");
const CFG = path.join(ROOT, "config");
const DATA = path.join(ROOT, "data");
for (const d of [LOGS, CFG, DATA]) fs.mkdirSync(d, { recursive: true });
// 起步清理：只删本 harness 已知的文件（不递归删目录 —— 本机删除垫片会路由到回收站并阻塞）
for (const f of ["app-2020-01-01.log", "notify-2020-01-01.log", "oplog-2020-01-01.log", "notify-2020-01-02.log", "oplog-2020-01-03.log"]) {
  try { fs.unlinkSync(path.join(LOGS, f)); } catch {}
}
try { fs.unlinkSync(path.join(CFG, "settings.json")); } catch {}

process.env.LOG_DIR = LOGS;
process.env.CONFIG_DIR = CFG;
process.env.DATA_DIR = DATA;

let pass = 0, fail = 0;
const ok = (n, c, x = "") => {
  if (c) { pass++; console.log("  PASS  " + n + (x ? " —— " + x : "")); }
  else { fail++; console.log("  FAIL  " + n + (x ? "  <<< " + x : "")); }
};
const sec = (t) => console.log(`\n══ ${t} ══`);
const today = new Date().toISOString().slice(0, 10);

try {
  const logger = await import("../server/logger.js");
  const applogs = await import("../server/applogs.js");

  sec("① 三频道常量与文件名");
  ok("LOG_CHANNELS = app/notify/oplog", JSON.stringify(logger.LOG_CHANNELS) === JSON.stringify(["app", "notify", "oplog"]));
  ok("logFileName 按频道拼名", logger.logFileName("notify", "2020-01-01") === "notify-2020-01-01.log");
  ok("三频道都有中文名", logger.LOG_CHANNELS.every((c) => !!logger.CHANNEL_LABELS[c]));

  sec("② 真写文件：各频道落到各自文件");
  logger.createLogger("Notify", "notify").info("通知已发送 webhook=1");
  logger.createLogger("API", "oplog").info("容器启动 abc123");
  logger.createLogger("Boot", "app").info("服务已启动");
  await new Promise((r) => setTimeout(r, 400)); // appendFile 异步
  const has = (f, needle) => {
    const p = path.join(LOGS, f);
    return fs.existsSync(p) && fs.readFileSync(p, "utf8").includes(needle);
  };
  ok("notify 频道写入 notify-<今日>.log", has(`notify-${today}.log`, "通知已发送"));
  ok("oplog 频道写入 oplog-<今日>.log", has(`oplog-${today}.log`, "容器启动"));
  ok("app 频道写入 app-<今日>.log", has(`app-${today}.log`, "服务已启动"));
  ok("★ 频道之间不串台（notify 文件里没有 oplog 的内容）",
    !has(`notify-${today}.log`, "容器启动") && !has(`oplog-${today}.log`, "通知已发送"));

  sec("③ 白名单：接受三频道、拒绝穿越");
  for (const c of ["app", "notify", "oplog"]) {
    ok(`resolveLogFile 接受 ${c}-2020-01-01.log`, applogs.resolveLogFile(`${c}-2020-01-01.log`) !== null);
  }
  for (const bad of ["../../etc/passwd", "app.log", "app-2020-1-1.log", "other-2020-01-01.log", "app-2020-01-01.log.bak", "", "../notify-2020-01-01.log"]) {
    ok(`resolveLogFile 拒绝 ${JSON.stringify(bad)}`, applogs.resolveLogFile(bad) === null);
  }

  sec("④ 列表带频道字段");
  const files = applogs.listLogFiles();
  ok("今天是 3 个文件（每频道一个）", files.length === 3, "实得 " + files.length);
  ok("★ 每条都带 channel 且覆盖三频道",
    files.map((f) => f.channel).sort().join(",") === "app,notify,oplog", files.map((f) => f.channel).join(","));
  ok("★ 只有今天的文件 current=true", files.every((f) => f.current === true), JSON.stringify(files.map((f) => [f.name, f.current])));

  sec("⑤ 分频道保留策略：继承 + 独立");
  const settings = await import("../server/settings.js");
  const base = settings.getSettings().logRetention;
  ok("默认含 notify / oplog 子段", !!base.notify && !!base.oplog, JSON.stringify(base));
  const cn = applogs.getRetentionConfig("notify");
  const cl = applogs.getRetentionConfig("oplog");
  const ca = applogs.getRetentionConfig("app");
  ok("★ app 用顶层（500MB）", ca.maxTotalMB === 500 && ca.maxDays === 30, JSON.stringify(ca));
  ok("★ notify 默认**继承顶层**（500MB，不是写死默认）", cn.maxTotalMB === 500 && cn.maxDays === 30, JSON.stringify(cn));
  ok("★ oplog 默认**继承顶层**（500MB）", cl.maxTotalMB === 500, JSON.stringify(cl));
  // 独立覆盖：只改 notify 的 maxDays，其余字段继承
  settings.saveSettings({ ...settings.getSettings(), logRetention: { ...base, notify: { maxDays: 7 } } });
  const cn2 = applogs.getRetentionConfig("notify");
  ok("★ notify.maxDays 覆盖为 7", cn2.maxDays === 7, JSON.stringify(cn2));
  ok("★★ 只写 maxDays ⇒ 其余字段继承顶层（maxTotalMB=500）", cn2.maxTotalMB === 500, JSON.stringify(cn2));

  sec("⑥ 分频道裁剪：永不删当天、按各自上限裁");
  // 造旧文件：notify 超期(2 天前) / oplog 超期 / app 未超期
  const mk = (name, daysAgo) => {
    const p = path.join(LOGS, name);
    fs.writeFileSync(p, "x".repeat(1024));
    const t = (Date.now() - daysAgo * 86400000) / 1000;
    fs.utimesSync(p, t, t);
  };
  mk("app-2020-01-01.log", 10);
  mk("notify-2020-01-01.log", 10);
  mk("oplog-2020-01-01.log", 10);
  settings.saveSettings({ ...settings.getSettings(), logRetention: { enabled: true, maxDays: 30, maxTotalMB: 500, notify: { enabled: true, maxDays: 3, maxTotalMB: 200 }, oplog: { enabled: false, maxDays: 3, maxTotalMB: 300 } } });
  const r = applogs.pruneLogs();
  ok("★ 通知日志（3 天）超期的被删", !fs.existsSync(path.join(LOGS, "notify-2020-01-01.log")) && r.removed.includes("notify-2020-01-01.log"), JSON.stringify(r.removed));
  ok("★ 操作记录已**禁用**保留策略 ⇒ 不删", fs.existsSync(path.join(LOGS, "oplog-2020-01-01.log")), JSON.stringify(r.removed));
  ok("★ 应用日志（30 天）10 天前的**不删**", fs.existsSync(path.join(LOGS, "app-2020-01-01.log")));
  ok("★ 当天文件一律保留（三频道）",
    fs.existsSync(path.join(LOGS, `app-${today}.log`)) && fs.existsSync(path.join(LOGS, `notify-${today}.log`)) && fs.existsSync(path.join(LOGS, `oplog-${today}.log`)));
} catch (e) {
  console.log("\n!! 异常：" + (e && e.message));
  fail++;
} finally {
  console.log(`\n结果: PASS=${pass}  FAIL=${fail}`);
  process.exit(fail > 0 ? 1 : 0);
}
