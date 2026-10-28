/**
 * 仪表盘网络曲线「默认网卡」门禁（v1.41.6，v1.42.10 移除「全部」选项）。
 *
 * 覆盖：
 *   ① `resolveIface()` 决策矩阵 —— 手动选择 > 系统设置 > 自动挑物理网卡 > 第一个虚拟网卡 > 容器合计回落；
 *   ② 自动挑选**跳过 lo / veth**（回环与容器 veth 恒无意义流量）；
 *   ③ 配置项 `modal.defaultNetIface` 在 settings / types / 前端默认值三处贯通；
 *   ④ 「页面设置」页确有该下拉，且**不再提供「全部（容器合计）」**（哨兵 `__all__` 已废弃）；
 *   ⑤ 磁贴下拉只按「物理网卡 / 虚拟网卡」两组分组。
 *
 * 运行：node scripts/check-net-iface.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const dash = read("src/pages/Dashboard.tsx");
const settingsTsx = read("src/pages/Settings.tsx");
const settingsSrv = read("server/settings.ts");
const types = read("src/types.ts");

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

/* ---------- ① 抽出 resolveIface 真实实现并跑决策矩阵 ---------- */
console.log("\n── ① resolveIface 决策矩阵 ──");

const fnStart = dash.indexOf("const resolveIface = (): string => {");
ok("Dashboard 内存在 resolveIface()", fnStart >= 0);
const fnEnd = dash.indexOf("\n  };", fnStart);
ok("resolveIface() 函数体可完整定位", fnEnd > fnStart);
// 拼一个可执行体：剥掉 TS 类型标注（`new Function` 是纯 JS，不能带 `: string`）
const body = dash
  .slice(fnStart, fnEnd)
  .replace("const resolveIface = (): string => {", "")
  // (n: string) => …  ⇒  (n) => …
  .replace(/\((\w+):\s*string\)/g, "($1)")
  .trim();
const resolveIface = new Function("ifaces", "userPicked", "iface", "defaultIface", body);

// 真实后端 isExposedNetIface(name) = name !== "lo" && !name.startsWith("veth")
// ⇒ 真实返回的列表不含 lo / veth*；另加一组「混入」的防御场景。
const REAL_LOCAL = [
  { name: "enp3s0", label: "enp3s0", kind: "host" },
  { name: "docker0", label: "bridge (bridge)", kind: "docker" },
  { name: "br-abc123def456", label: "iotdb-net (bridge)", kind: "docker" },
];
const WITH_LO = [{ name: "lo", label: "lo", kind: "host" }, ...REAL_LOCAL];
const ONLY_LO_VETH = [
  { name: "lo", label: "lo", kind: "host" },
  { name: "veth1234", label: "veth1234", kind: "host" },
];
const ONLY_DOCKER = [{ name: "docker0", label: "bridge (bridge)", kind: "docker" }];
const REMOTE = [];

const cases = [
  ["默认(空串) ⇒ 自动挑第一个物理网卡", REAL_LOCAL, false, "", "", "enp3s0"],
  ["★ 数据混入 lo ⇒ 跳过 lo", WITH_LO, false, "", "", "enp3s0"],
  ["★ 只有 lo/veth ⇒ 不选它们，回落容器合计(空串)", ONLY_LO_VETH, false, "", "", ""],
  ["设置指定 docker0 ⇒ 用它", REAL_LOCAL, false, "", "docker0", "docker0"],
  ["设置指定 br-xxx ⇒ 用它", REAL_LOCAL, false, "", "br-abc123def456", "br-abc123def456"],
  ["★ 设置 __all__（已废弃）⇒ 按「自动」挑物理网卡", REAL_LOCAL, false, "", "__all__", "enp3s0"],
  ["设置指定不存在的网卡 ⇒ 回落自动", REAL_LOCAL, false, "", "eth9", "enp3s0"],
  ["设置为 undefined（未拉到）⇒ 自动", REAL_LOCAL, false, "", undefined, "enp3s0"],
  ["手动选过 ⇒ 手动优先于设置", REAL_LOCAL, true, "docker0", "eth0", "docker0"],
  ["手动选的网卡已消失 ⇒ 用设置", REAL_LOCAL, true, "eth9", "docker0", "docker0"],
  ["手动选的已消失 ＋ 设置空 ⇒ 自动", REAL_LOCAL, true, "eth9", "", "enp3s0"],
  ["远程引擎(无列表) ⇒ 回落容器合计(空串)", REMOTE, false, "", "", ""],
  ["★ 只有 Docker 虚拟网卡 ⇒ 挑第一个虚拟网卡", ONLY_DOCKER, false, "", "", "docker0"],
  ["只有虚拟网卡 ＋ 指定 docker0 ⇒ 用它", ONLY_DOCKER, false, "", "docker0", "docker0"],
  ["★ 用户手动选了 lo ⇒ 尊重用户", WITH_LO, true, "lo", "", "lo"],
];
const actualCases = cases.map(([, ifaces, up, iface, def]) => resolveIface(ifaces, up, iface, def));
check(
  "决策矩阵全部符合预期",
  actualCases,
  cases.map((c) => c[5])
);
cases.forEach(([desc], i) => {
  if (actualCases[i] !== cases[i][5]) console.log(`      ↳ 失败用例：${desc}`);
});

/* ---------- ② 默认必须是物理网卡（不再是「全部」） ---------- */
console.log("\n── ② 默认展示物理网卡 ──");
ok("默认不再是「全部（容器合计）」", actualCases[0] !== "");
ok("默认取到的是 kind==='host' 的网卡", REAL_LOCAL.find((o) => o.name === actualCases[0])?.kind === "host");
ok("不再硬编码 eth0（网卡名因机器而异）", !/resolveIface[\s\S]{0,600}?"eth0"/.test(dash.slice(fnStart, fnEnd)));
ok("自动挑选跳过 lo", /isRealHost[\s\S]{0,200}n !== "lo"/.test(dash.slice(fnStart, fnEnd)));
ok("自动挑选跳过 veth", /isRealHost[\s\S]{0,200}!n\.startsWith\("veth"\)/.test(dash.slice(fnStart, fnEnd)));
ok("手动选择优先于系统设置（userPicked 先判定）", dash.indexOf("if (userPicked && exists(iface))") < dash.indexOf("const want = defaultIface"));
ok("从系统设置读取默认网卡（fetchSettings）", /fetchSettings\(\)/.test(dash) && /modal\?\.defaultNetIface/.test(dash));
ok("下拉展示的是解析后的 active（不是原始 iface）", /<IfaceSelect\s*\n?\s*value=\{active\}/.test(dash));

/* ---------- ③ 配置项三处贯通 ---------- */
console.log("\n── ③ modal.defaultNetIface 贯通 ──");
// ⚠️ 字段前有较长注释，窗口要放宽（否则 400 字符不够，会假红）
ok("server/settings.ts 默认值存在且为空串（=自动）", /modal:\s*\{[\s\S]{0,900}?defaultNetIface:\s*"",\s*\n\s*\}/.test(settingsSrv));
ok("src/types.ts ModalConfig 含该字段", /defaultNetIface:\s*string;/.test(types));
ok("Settings.tsx 本地默认值含该字段", /defaultNetIface:\s*"",/.test(settingsTsx));
ok("★ 默认空串而非硬编码某网卡名", !/defaultNetIface:\s*"[a-z]/.test(settingsSrv));
ok("★ modal 段二级合并已覆盖（旧 settings.json 生效）", /modal:\s*\{\s*\.\.\.DEFAULT_SETTINGS\.modal,\s*\.\.\.\(parsed\?\.modal \|\| \{\}\)/.test(settingsSrv));

/* ---------- ④ 页面设置页 UI ---------- */
console.log("\n── ④ 页面设置页 UI ──");
ok("存在「网络曲线默认网卡」卡片", /title="网络曲线默认网卡"/.test(settingsTsx));
ok("下拉绑定 modal.defaultNetIface", /update\("modal", "defaultNetIface", v\)/.test(settingsTsx));
ok("提供「自动（第一个物理网卡）」选项", /value: "", label: "自动（第一个物理网卡）"/.test(settingsTsx));
ok("★ v1.42.10 已移除「全部（容器合计）」选项（哨兵 __all__ 不再出现）", !/value: "__all__"/.test(settingsTsx));
ok("★ 设置项标签用「物理网卡 / 虚拟网卡」", /（物理网卡）/.test(settingsTsx) && /（虚拟网卡）/.test(settingsTsx));
ok("下拉按 host / docker 分组并标注", /kind === "host"/.test(settingsTsx) && /kind === "docker"/.test(settingsTsx));
ok("进入该分区时拉取网卡列表", /activeSection !== "modal"\) return;[\s\S]{0,400}fetchNetInterfacesApi/.test(settingsTsx));
ok("远程引擎无列表时给出说明", /远程 TCP \/ SSH 引擎读不到本机/.test(settingsTsx));
ok("提示手动选择优先", /手动选过网卡，则以下设置不生效/.test(settingsTsx));
// ④-补：v1.42.9「登录后默认显示页面」下拉
ok("★ 页面设置含「默认显示页面」卡片", /title="默认显示页面"/.test(settingsTsx));
ok("★ 默认显示页面绑定 modal.defaultPage", /update\("modal", "defaultPage", v\)/.test(settingsTsx));
ok("★ 默认显示页面提供 8 个导航页选项", /value: "dashboard", label: "仪表盘"/.test(settingsTsx) && /value: "settings", label: "设置中心"/.test(settingsTsx));
ok("★ 默认显示页面回落 dashboard", /data\.modal\?\.defaultPage \?\? "dashboard"/.test(settingsTsx));

/* ---------- ⑤ 磁贴 IfaceSelect（v1.42.10 移除「全部」+ 分组改名） ---------- */
console.log("\n── ⑤ 磁贴网口下拉 ──");
ok("★ 磁贴下拉已无「全部（容器合计）」option", !/<option value="">全部（容器合计）<\/option>/.test(dash));
ok("★ optgroup 改名为「物理网卡」", /<optgroup label="物理网卡">/.test(dash));
ok("★ optgroup 改名为「虚拟网卡」", /<optgroup label="虚拟网卡">/.test(dash));
ok("★ 无网卡时显示禁用占位「无可用网卡」", /<option value="" disabled>\s*无可用网卡\s*<\/option>/.test(dash));
ok("★ 无网卡时下拉整体禁用", /disabled=\{none\}/.test(dash));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
