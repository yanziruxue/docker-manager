/**
 * 仪表盘「磁盘速率曲线」磁盘选择门禁（v1.42.11，v1.42.12 增加指标下拉）。
 *
 * 覆盖：
 *   ① DiskSelect 组件存在，含「全部（合计）」option（默认，保留合计口径），平铺列盘；
 *   ② DiskTile 有磁盘选择持久化状态（dm.chart.disk.dev），activeDev 回落逻辑正确；
 *   ③ 曲线 / 当前值 / 图例按选中盘渲染（单盘取该盘，空串取合计 / 平均）；
 *   ④ DiskSelect 与 setDev 正确接线，且放在曲线折叠开关旁；
 *   ⑤ DiskMetricSelect 组件（全部 / 读 / 写 / 繁忙度）存在且「全部」在「读」上边，
 *      dm.chart.disk.metric 持久化；「全部」= 读/写/繁忙度三条曲线，单指标 = 每块盘各一条
 *      曲线（多盘配色板），单指标视图禁用选盘下拉；非法值回落 all。
 *
 * 运行：node scripts/check-disk-select.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dash = read("src/pages/Dashboard.tsx");

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
}

/* ---------- ① DiskSelect 组件 ---------- */
console.log("\n── ① DiskSelect 组件 ──");
ok("存在 DiskSelect 组件", /function DiskSelect\(/.test(dash));
ok("★ 含「全部（合计）」option（默认，保留合计口径）", /<option value="">全部（合计）<\/option>/.test(dash));
ok("平铺列出各磁盘（map options）", /options\.map\(\(name\) =>/.test(dash));
ok("aria-label 为「磁盘设备」", /aria-label="磁盘设备"/.test(dash));

/* ---------- ② 选择状态 + activeDev 回落 ---------- */
console.log("\n── ② 选择状态与回落 ──");
ok("★ DiskTile 持久化磁盘选择（dm.chart.disk.dev，默认空串）", /useStoredString\("dm\.chart\.disk\.dev", ""\)/.test(dash));

// 抽出 activeDev 逻辑跑真实用例（剥 TS 类型标注后用 new Function 执行）
const am = dash.match(/const activeDev = (dev && disks\.some\(\(d\) => d\.name === dev\) \? dev : "");/);
ok("activeDev 语句可定位", !!am);
if (am) {
  const resolveDev = new Function("dev", "disks", `return ${am[1]};`);
  const disks = [{ name: "sda" }, { name: "nvme0n1" }];
  ok("选中存在的盘 ⇒ 用它", resolveDev("sda", disks) === "sda");
  ok("选中不存在的盘（热插拔消失）⇒ 回落空串", resolveDev("sdz", disks) === "");
  ok("空串（全部合计）⇒ 空串", resolveDev("", disks) === "");
  ok("无盘列表 ⇒ 空串", resolveDev("sda", []) === "");
}

/* ---------- ③ 曲线 / 当前值 / 图例按选中盘 ---------- */
console.log("\n── ③ 曲线与图例 ──");
ok("★ seriesFor 有 activeDev 单盘分支", /const seriesFor = \(pick: "read" \| "write"\) =>/.test(dash) && /if \(activeDev\) return Math\.round/.test(dash));
ok("★ 合计分支仍保留（for k in m 求和）", /for \(const k in m\) sum \+= m\[k\]\[pick\]/.test(dash));
ok("★ 利用率：单盘取该盘、否则取平均", /if \(activeDev\) return Math\.round\(\(m\[activeDev\]\?\.busy/.test(dash));
ok("★ 图例标签随选中盘切换（繁忙度 / 平均繁忙度）", /\{activeDev \? "繁忙度" : "平均繁忙度"\}/.test(dash));
ok("★ 当前值按选中盘取（sel ? sel.xxx : 合计）", /const sel = activeDev \? disks\.find\(\(d\) => d\.name === activeDev\) : undefined;/.test(dash));
ok("★ 图例显示 round1(busyNow)", /\{round1\(busyNow\)\}%/.test(dash));

/* ---------- ④ 接线 ---------- */
console.log("\n── ④ 接线 ──");
ok("★ DiskSelect 绑定 activeDev + setDev", /<DiskSelect value=\{activeDev\} onChange=\{setDev\}/.test(dash));
ok("曲线折叠开关仍在（磁盘速率曲线）", /<span>磁盘速率曲线<\/span>/.test(dash));

/* ---------- ⑤ 指标下拉（v1.42.12：全部 / 读 / 写 / 繁忙度） ---------- */
console.log("\n── ⑤ 指标下拉（全部 / 读 / 写 / 繁忙度） ──");
ok("存在 DiskMetricSelect 组件", /function DiskMetricSelect\(/.test(dash));
ok("★「全部」option 在「读」上边（用户要求：放读的上边）", /<option value="all">全部<\/option>[\s\S]{0,120}<option value="read">读<\/option>/.test(dash));
ok("★ 含「读」「写」「繁忙度」单指标 option", /<option value="read">读<\/option>/.test(dash) && /<option value="write">写<\/option>/.test(dash) && /<option value="busy">繁忙度<\/option>/.test(dash));
ok("★ DiskTile 持久化指标选择（dm.chart.disk.metric，默认 all）", /useStoredString\("dm\.chart\.disk\.metric", "all"\)/.test(dash));

// 抽出 metric 归一化逻辑跑真实用例（read/write/busy 透传，旧值/脏数据回落 all）
const mm = dash.match(/const metric: DiskMetric\s*=\s*metricSel === "read" \|\| metricSel === "write" \|\| metricSel === "busy" \? metricSel : "all";/);
ok("metric 归一化语句可定位", !!mm);
if (mm) {
  const expr = mm[0].replace(/^const metric: DiskMetric\s*=\s*/, "").replace(/;\s*$/, "");
  const norm = new Function("metricSel", `return ${expr};`);
  ok("sel=read ⇒ read", norm("read") === "read");
  ok("sel=write ⇒ write", norm("write") === "write");
  ok("sel=busy ⇒ busy", norm("busy") === "busy");
  ok("★ 旧值 rw（上一版持久化数据）⇒ 回落 all", norm("rw") === "all");
  ok("★ 脏数据 ⇒ 回落 all", norm("xx") === "all");
  ok("★ 空串 ⇒ 回落 all", norm("") === "all");
}
ok("★ all 分支：读/写/繁忙度三条曲线（繁忙度右轴虚线）", /name: "读速率", color: "#3b82f6", values: readSeries, area: true/.test(dash) && /name: "写速率", color: "#f59e0b", values: writeSeries, area: true/.test(dash) && /values: busySeries,\s*axis: "right",\s*dashed: true,/.test(dash));
ok("★ 单指标分支：每块盘一条曲线（disks.map + perDiskSeries）", /: disks\.map\(\(d, i\) => \(\{[\s\S]{0,200}values: perDiskSeries\(d\.name, metric\)/.test(dash));
ok("★ perDiskSeries 按盘取历史值（read/write 2 位、busy 1 位小数）", /const perDiskSeries = \(dev: string, pick: "read" \| "write" \| "busy"\) =>/.test(dash) && /s\.disks\?\.\[dev\]\?\.\[pick\]/.test(dash) && /pick === "busy" \? Math\.round\(v \* 10\) \/ 10/.test(dash));
ok("★ 多盘配色板存在（DISK_LINE_COLORS + diskColor 循环取色）", /const DISK_LINE_COLORS = \[/.test(dash) && /const diskColor = \(i: number\) => DISK_LINE_COLORS\[i % DISK_LINE_COLORS\.length\];/.test(dash));
ok("★ 单指标视图禁用选盘下拉（perDisk → disabled）", /const perDisk = metric !== "all";/.test(dash) && /<DiskSelect value=\{activeDev\} onChange=\{setDev\} options=\{disks\.map\(\(d\) => d\.name\)\} disabled=\{perDisk\} \/>/.test(dash));
ok("DiskSelect 支持 disabled（禁用样式 + 说明 title）", /disabled = false,/.test(dash) && /disabled:cursor-not-allowed disabled:opacity-50/.test(dash) && /disabled \? "「读 \/ 写 \/ 繁忙度」视图固定展示所有硬盘/.test(dash));
ok("★ 图表轴参数按指标切换（all 才有右轴；busy 走 % 刻度）", /yMaxRight=\{metric === "all" \? 100 : undefined\}/.test(dash) && /formatMax=\{metric === "busy" \? \(v\) => `\$\{Math\.round\(v\)\}%` : fmtDiskRate\}/.test(dash));
ok("★ 图例：all 显示读/写/繁忙度；单指标按盘列当前值", /\{metric === "all" \? \(/.test(dash) && /disks\.map\(\(d, i\) => \(\s*\n\s*<Legend key=\{d\.name\} color=\{diskColor\(i\)\}>/.test(dash));
ok("★ DiskMetricSelect 绑定 metric + setMetric", /<DiskMetricSelect value=\{metric\} onChange=\{setMetric\} \/>/.test(dash));
ok("两个下拉并排放在折叠开关旁", /<div className="flex items-center gap-2">\s*\n\s*<DiskSelect/.test(dash));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
