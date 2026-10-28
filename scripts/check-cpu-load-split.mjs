/**
 * 处理器磁贴「宿主负载 / 容器负载」两段口径门禁（v1.42.20）。
 *
 * 覆盖：
 *   ① splitCpuLoad 纯函数真实执行（new Function，剥 TS 签名后跑用例）：
 *      容器负载 = Σ ÷ ncpu（cpuPercent 是占单核百分比，8 核跑满 = 800%）；
 *      宿主负载 = /proc/stat 聚合行差分；蓝段（不含容器）= max(0, host − container)；
 *      v1.42.21：host < container（轻载假零）时取容器值为下界，使宿主读数 ≥ 容器读数；
 *      hostPct 为 null ⇒ 回落旧展示；
 *   ② server/docker.ts sampleHostCpu：同一次读 /proc/stat，聚合行 `cpu ` + 逐核行都差分，
 *      首采无基线 hostPercent 为 null；
 *   ③ server getEngineResourceStats 接线：hostCpuPercent 字段 + recordResourceSample 记录
 *      + server 侧 ResourceSample 接口字段；
 *   ④ src/types.ts 两个接口字段（EngineResourceStats.hostCpuPercent / ResourceSample.hostCpuPercent?）；
 *   ⑤ Dashboard.tsx CpuTile：两段堆叠横条 + 副标题「宿主负载 X% / 容器负载 Y% / 100%」
 *      + 曲线双序列 + statsToSample 透传 + 远程引擎回落旧单条展示。
 *
 * 运行：node scripts/check-cpu-load-split.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const dash = read("src/pages/Dashboard.tsx");
const server = read("server/docker.ts");
const types = read("src/types.ts");

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

/* ---------- ① splitCpuLoad 纯函数（new Function 跑真实实现） ---------- */
console.log("\n── ① splitCpuLoad 纯函数 ──");
ok("存在 splitCpuLoad 函数", /function splitCpuLoad\(/.test(dash));
ok("存在 StackedBar 两段堆叠组件", /function StackedBar\(/.test(dash));
ok("两段固定配色常量（蓝=宿主 / 琥珀=容器）", /HOST_LOAD_COLOR = "#3b82f6"/.test(dash) && /CONTAINER_LOAD_COLOR = "#f59e0b"/.test(dash));

// 抽出函数体（返回类型注解 `| null {` 之后到行首 `}`），剥掉签名后用 new Function 执行
const fm = dash.match(/function splitCpuLoad\([\s\S]*?\| null \{\n([\s\S]*?)\n\}/);
ok("函数体可定位（含返回类型注解锚点）", !!fm);
if (fm) {
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const fn = new Function("containerSum", "hostPct", "ncpu", "clamp", fm[1]);
  const run = (c, h, n) => fn(c, h, n, clamp);
  const near = (a, b) => Math.abs(a - b) < 1e-9;

  // 用户给的样例口径：8 核，容器合计 101.6%（占单核）⇒ 容器负载 12.7%（占整机）
  const r1 = run(101.6, 16.7, 8);
  ok("★ 宿主 16.7% / 容器合计 101.6% ÷ 8 核 ⇒ 容器负载 12.7%", r1 && near(r1.containerPct, 12.7));
  ok("★ 蓝段（不含容器）= 16.7 − 12.7 = 4.0", r1 && near(r1.hostOnlyPct, 4.0));
  ok("★ hostPct 原样透传（16.7）", r1 && near(r1.hostPct, 16.7));

  const r2 = run(0, 100, 8);
  ok("无容器负载 ⇒ 容器段 0、蓝段 = 宿主全量", r2 && r2.containerPct === 0 && r2.hostOnlyPct === 100);
  const r3 = run(800, 30, 8);
  ok("容器折算超过宿主（8 核跑满 vs 宿主 30%）⇒ 蓝段钳 0、容器段 100", r3 && r3.hostOnlyPct === 0 && r3.containerPct === 100);
  const r4 = run(NaN, 42, 8);
  ok("容器合计 NaN（计数器回卷）⇒ 容器段 0", r4 && r4.containerPct === 0 && near(r4.hostOnlyPct, 42));
  const r5 = run(50, 42, 0);
  ok("ncpu=0（防御）⇒ 容器段 0，不除零", r5 && r5.containerPct === 0);
  const r6 = run(-5, 42, 8);
  ok("容器合计为负（异常）⇒ 钳 0", r6 && r6.containerPct === 0);
  const r7 = run(42, 150, 8);
  ok("宿主 150%（异常）⇒ hostPct 钳 100", r7 && r7.hostPct === 100);
  ok("★ hostPct=null（远程引擎）⇒ 返回 null（调用方回落旧展示）", run(50, null, 8) === null);
  ok("★ hostPct=undefined（首采无基线）⇒ 返回 null", run(50, undefined, 8) === null);

  // v1.42.21 采样伪影修正：host < c（轻载假零）时取容器值下界，正常 host>c 不误修
  const r8 = run(2.4, 0, 8); // Σ 2.4%（占单核）÷ 8 核 = 容器 0.3%，宿主被吞成 0%
  ok("★ v1.42.21 宿主假零 0% / 容器 0.3% ⇒ 宿主读数修正为 0.3%，蓝段归零", r8 && near(r8.hostPct, 0.3) && near(r8.containerPct, 0.3) && r8.hostOnlyPct === 0);
  const r9 = run(5, 0.2, 8); // 容器 0.625% > 宿主 0.2%
  ok("★ 宿主 0.2% < 容器 0.625% ⇒ 宿主修正为 0.625%（max 下界），蓝段 0", r9 && near(r9.hostPct, 0.625) && near(r9.containerPct, 0.625) && r9.hostOnlyPct === 0);
  const r10 = run(50, 42, 8); // 正常：宿主 42% > 容器 6.25%
  ok("★ 正常 host>c 不误修（宿主 42% / 容器 6.25% / 蓝段 35.75%）", r10 && near(r10.hostPct, 42) && near(r10.containerPct, 6.25) && near(r10.hostOnlyPct, 35.75));
}

/* ---------- ② server/docker.ts sampleHostCpu 聚合行采样 ---------- */
console.log("\n── ② sampleHostCpu 聚合行采样 ──");
ok("sampleHostCpuCores 已改名为 sampleHostCpu（返回 cores + hostPercent）", /function sampleHostCpu\(engineId: string\): \{ cores: \{ name: string; percent: number \}\[\]; hostPercent: number \| null \}/.test(server));
ok("★ 同时匹配聚合行「cpu 」与逐核行「cpuN 」", /if \(!\/\^cpu\(\\d\+\\s\|\\s\)\/\.test\(line\)\) continue;/.test(server));
ok("★ 聚合行入 agg（parts[0] === \"cpu\"）", /if \(parts\[0\] === "cpu"\) agg = snap;/.test(server));
ok("★ 快照结构含 total（聚合行上次值）", /lastCpuSnapshot = new Map<string, \{ ts: number; cores: Map<string, CpuCoreSnapshot>; total: CpuCoreSnapshot \| null \}>\(\)/.test(server));
ok("★ 聚合行差分且首采无基线为 null", /let hostPercent: number \| null = null;/.test(server) && /if \(agg && prev\?\.total\) \{/.test(server));
ok("★ 写回快照带上聚合行 total", /lastCpuSnapshot\.set\(engineId, \{ ts: Date\.now\(\), cores: cur, total: agg \}\)/.test(server));
ok("读不到 /proc/stat ⇒ cores 空 + hostPercent null", /\{\n    text = fs\.readFileSync\("\/proc\/stat", "utf8"\);\n  \} catch \{\n    return \{ cores: \[\], hostPercent: null \};/.test(server));

/* ---------- ③ server 接线 ---------- */
console.log("\n── ③ server 接线 ──");
ok("★ getEngineResourceStats 调 sampleHostCpu（远程引擎回落空 / null）", /const hostCpu = isLocal \? sampleHostCpu\(engine\.id\) : \{ cores: \[\] as \{ name: string; percent: number \}\[\], hostPercent: null as number \| null \};/.test(server));
ok("★ 取出 hostCpuPercent", /const hostCpuPercent = hostCpu\.hostPercent;/.test(server));
ok("★ recordResourceSample 记录 hostCpuPercent（无值为 undefined）", /hostCpuPercent: hostCpuPercent \?\? undefined,/.test(server));
ok("★ 返回值带 hostCpuPercent 字段", /\n {4}hostCpuPercent,\n/.test(server));
ok("server 侧 ResourceSample 接口含 hostCpuPercent?: number", /hostCpuPercent\?: number;/.test(server));

/* ---------- ④ src/types.ts 接口字段 ---------- */
console.log("\n── ④ src/types.ts 接口字段 ──");
ok("★ EngineResourceStats.hostCpuPercent: number | null（含文档注释）", /宿主机整机 CPU 使用率[\s\S]{0,200}hostCpuPercent: number \| null;/.test(types));
ok("★ ResourceSample.hostCpuPercent?: number", /宿主机整机 CPU 使用率[\s\S]{0,200}hostCpuPercent\?: number;/.test(types));

/* ---------- ⑤ Dashboard.tsx CpuTile 两段展示 ---------- */
console.log("\n── ⑤ CpuTile 两段展示 ──");
ok("★ split 由 splitCpuLoad 计算（hostCpuPercent ?? null 透传）", /const split = stats \? splitCpuLoad\(stats\.cpuPercent, stats\.hostCpuPercent \?\? null, stats\.ncpu \|\| 1\) : null;/.test(dash));
ok("★ 副标题两段格式「宿主负载 X% / 容器负载 Y% / 100%」", /宿主负载 \$\{round1\(split\.hostPct\)\}% \/ 容器负载 \$\{round1\(split\.containerPct\)\}% \/ 100%/.test(dash));
ok("★ 副标题回落旧格式（无整机数据时）", /`整体负载 \$\{round1\(stats\.cpuPercent\)\}% \/ 100%`/.test(dash));
ok("★ 横条两段：蓝 = hostOnlyPct、琥珀 = containerPct", /\{ percent: split\.hostOnlyPct, color: HOST_LOAD_COLOR \}/.test(dash) && /\{ percent: split\.containerPct, color: CONTAINER_LOAD_COLOR \}/.test(dash));
ok("★ 横条行标签「宿主负载」", /<span className="w-14 flex-shrink-0 text-xs text-slate-500">宿主负载<\/span>/.test(dash));
ok("★ 右侧双数字（宿主 / 容器）", /\{round1\(split\.hostPct\)\}% \/ \{round1\(split\.containerPct\)\}%/.test(dash));
ok("★ 曲线宿主负载序列应用 max(hv, 容器值) 同口径修正（NaN 占位）", /name: "宿主负载", color: HOST_LOAD_COLOR, values: pts\.map\(\(s\) => \{[\s\S]*?Math\.max\(hv, clamp/.test(dash));
ok("★ 曲线双序列：容器负载（Σ ÷ ncpu 整机口径，无 ×100）", /\{ name: "容器负载", color: CONTAINER_LOAD_COLOR, values: pts\.map\(\(s\) => clamp\(s\.cpuPercent \/ ncpu, 0, 100\)\), area: true \}/.test(dash));
ok("★ 曲线回落单序列（远程引擎：整体负载 = 容器合计）", /\{ name: "整体负载", color: HOST_LOAD_COLOR, values: pts\.map\(\(s\) => s\.cpuPercent\), area: true \}/.test(dash));
ok("曲线小节取 ncpu（容器序列折算用）", /const ncpu = stats\?\.ncpu \|\| 1;/.test(dash));
ok("曲线开关标题随口径切换（宿主负载曲线 / 整体负载曲线）", /\{split \? "宿主负载曲线" : "整体负载曲线"\}/.test(dash));
ok("图例两行（宿主 / 容器当前值）", /<Legend color=\{HOST_LOAD_COLOR\}>宿主负载 \{round1\(split\.hostPct\)\}%<\/Legend>/.test(dash) && /<Legend color=\{CONTAINER_LOAD_COLOR\}>容器负载 \{round1\(split\.containerPct\)\}%<\/Legend>/.test(dash));
ok("回落图例保留旧文案（当前 X%）", /<Legend color=\{HOST_LOAD_COLOR\}>当前 \{round1\(stats\.cpuPercent\)\}%<\/Legend>/.test(dash));
ok("★ statsToSample 透传 hostCpuPercent（无值不写）", /hostCpuPercent: st\.hostCpuPercent \?\? undefined,/.test(dash));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail > 0 ? 1 : 0);
