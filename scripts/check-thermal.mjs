/**
 * 温度采集门禁：跑 `server/docker.ts` 的**真实源码片段**（readDiskTempC / readCpuTempC /
 * isDrivetempLoaded / listWholeDisks / getThermalStatus），只把 `fs` 换成内存里的虚拟 sysfs 树。
 *
 * 为什么需要它：温度全部读 Linux `/sys`（hwmon / thermal_zone / module），而本仓库在 Windows 上
 * 开发，既没有 `/sys` 也没有 root ⇒ 采集逻辑在开发机上原本**完全无法验证**，改坏了只会「界面显示 —」，
 * 静默失败。本门禁把 sysfs 树构造出来，路径优先级、毫摄氏度换算、drivetemp 判定、缺温度盘清单
 * 全部可断言。
 *
 * 设计要点：用 `Object.create(fs)` 造影子 fs 注入 vm 的 `require`，**不改真实 fs 模块**（避免污染同进程其它检查）。
 * 负向自检：把源码里的 `Math.round(milli / 1000)` 改成 `/ 100` ⇒ PASS 由 15 掉到 7、FAIL=8（已实测）。
 *
 * 运行：node scripts/check-thermal.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCKER_TS = path.join(ROOT, "server", "docker.ts");
const requireFromHere = createRequire(import.meta.url);

/* ---------- 1. 抽取真实源码 ---------- */
const SRC = fs.readFileSync(DOCKER_TS, "utf8");
const from = SRC.indexOf("function readDiskTempC");
const to = SRC.indexOf("/** 单个网口的实时速率");
if (from < 0 || to < 0 || to <= from) {
  console.error("❌ 源码片段定位失败（锚点已失效：readDiskTempC / 单个网口的实时速率）");
  process.exit(1);
}
const chunk = SRC.slice(from, to).replace(/^export /gm, "");
for (const sym of [
  "readDiskTempC",
  "listWholeDisks",
  "readCpuTempC",
  "isDrivetempLoaded",
  "getThermalStatus",
]) {
  if (!chunk.includes(sym)) {
    console.error(`❌ 抽取片段缺少 ${sym}（函数被改名？）`);
    process.exit(1);
  }
}
const js = esbuild.transformSync(
  "const fs = require('fs');\nconst path = require('path');\n" +
    chunk +
    "\nmodule.exports = { getThermalStatus, readCpuTempC, isDrivetempLoaded, readDiskTempC, listWholeDisks };",
  { loader: "ts", format: "cjs" }
).code;

/* ---------- 2. 虚拟 sysfs ---------- */
let files = new Map();
let dirs = new Map();
const reset = () => {
  files = new Map();
  dirs = new Map();
};
/** 建目录，并把新目录登记到父目录 children（漏了这步 readdir 会永远返回空） */
function mkdirp(dir) {
  if (dir === "/" || dirs.has(dir)) return;
  const parent = path.posix.dirname(dir);
  mkdirp(parent);
  dirs.set(dir, []);
  const plist = dirs.get(parent);
  const name = path.posix.basename(dir);
  if (plist && !plist.includes(name)) plist.push(name);
}
function file(p, content) {
  mkdirp(path.posix.dirname(p));
  files.set(p, content);
  const parent = path.posix.dirname(p);
  const list = dirs.get(parent);
  const name = path.posix.basename(p);
  if (list && !list.includes(name)) list.push(name);
}
const dir = mkdirp;

/** Windows 的 path.join 产出反斜杠，归一化成 posix 形态 */
const norm = (p) => String(p).replace(/\\/g, "/");

/** 影子 fs：读接口全部改走内存；其余（writeFileSync 等）沿原型落到真实 fs */
const shadowFs = Object.create(fs);
shadowFs.readFileSync = (p) => {
  const key = norm(p);
  if (files.has(key)) return files.get(key);
  const err = new Error(`ENOENT: no such file, open '${key}'`);
  err.code = "ENOENT";
  throw err;
};
shadowFs.readdirSync = (p) => {
  const key = norm(p);
  if (dirs.has(key)) return dirs.get(key).slice();
  const err = new Error(`ENOENT: no such file or directory, scandir '${key}'`);
  err.code = "ENOENT";
  throw err;
};
shadowFs.existsSync = (p) => {
  const key = norm(p);
  return files.has(key) || dirs.has(key);
};

/* ---------- 3. 执行真实源码（影子 fs 只对本模块生效） ---------- */
const mod = { exports: {} };
const runModule = vm.compileFunction(
  js,
  ["require", "module", "exports", "__filename", "__dirname"],
  { filename: "check-thermal-real-src.js" }
);
runModule(
  (name) => (name === "fs" ? shadowFs : requireFromHere(name)),
  mod,
  mod.exports,
  DOCKER_TS,
  path.dirname(DOCKER_TS)
);
const { getThermalStatus, readDiskTempC } = mod.exports;

/* ---------- 4. 断言 ---------- */
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

// ① Intel coretemp
reset();
file("/sys/class/hwmon/hwmon0/name", "coretemp");
file("/sys/class/hwmon/hwmon0/temp1_input", "47000");
check("① CPU coretemp", getThermalStatus().cpu, { source: "coretemp", tempC: 47 });

// ② AMD k10temp 带 label（Tctl）
reset();
file("/sys/class/hwmon/hwmon1/name", "k10temp");
file("/sys/class/hwmon/hwmon1/temp1_label", "Tctl");
file("/sys/class/hwmon/hwmon1/temp1_input", "61500");
check("② CPU k10temp+Tctl", getThermalStatus().cpu, { source: "k10temp Tctl", tempC: 62 });

// ③ 优先级：coretemp 压过 k10temp（不受遍历顺序影响）
reset();
file("/sys/class/hwmon/hwmon5/name", "k10temp");
file("/sys/class/hwmon/hwmon5/temp1_input", "59000");
file("/sys/class/hwmon/hwmon9/name", "coretemp");
file("/sys/class/hwmon/hwmon9/temp1_input", "44000");
check("③ CPU 优先级 coretemp>k10temp", getThermalStatus().cpu, {
  source: "coretemp",
  tempC: 44,
});

// ④ 无 hwmon 芯片 → 回退 /sys/class/thermal 的 x86_pkg_temp
reset();
file("/sys/class/thermal/thermal_zone0/type", "acpitz");
file("/sys/class/thermal/thermal_zone0/temp", "30000");
file("/sys/class/thermal/thermal_zone1/type", "x86_pkg_temp");
file("/sys/class/thermal/thermal_zone1/temp", "52000");
check("④ CPU thermal zone 回退", getThermalStatus().cpu, {
  source: "x86_pkg_temp",
  tempC: 52,
});

// ⑤ 全无 → null（不抛异常）
reset();
check("⑤ CPU 无传感器 → null", getThermalStatus().cpu, null);

// ⑥ NVMe 温度（nvme 驱动自带 hwmon，无需 drivetemp）
reset();
file("/sys/class/nvme/nvme0/hwmon0/temp1_input", "38500");
check("⑥ NVMe 盘温度", readDiskTempC("nvme0n1"), 39);

// ⑦ SATA + drivetemp（/sys/block/sda/device/hwmon/）
reset();
file("/sys/block/sda/device/hwmon/hwmon2/temp1_input", "41300");
check("⑦ SATA 盘温度（drivetemp）", readDiskTempC("sda"), 41);

// ⑧ /sys/module/drivetemp 存在 ⇒ 已加载
reset();
dir("/sys/module/drivetemp");
check("⑧ drivetemp 模块目录判定", getThermalStatus().drivetempLoaded, true);

// ⑨ 只有 hwmon 芯片名 = drivetemp ⇒ 也算已加载
reset();
file("/sys/class/hwmon/hwmon3/name", "drivetemp");
check("⑨ drivetemp hwmon 芯片判定", getThermalStatus().drivetempLoaded, true);

// ⑩ 两者都无 ⇒ 未加载
reset();
file("/sys/class/hwmon/hwmon0/name", "coretemp");
file("/sys/class/hwmon/hwmon0/temp1_input", "45000");
check("⑩ drivetemp 未加载", getThermalStatus().drivetempLoaded, false);

// ⑪ 完整快照：分区 / loop / dm 必须被过滤掉
reset();
file("/sys/block/sda/device/hwmon/hwmon2/temp1_input", "41000");
for (const n of ["sda", "sdb", "nvme0n1", "loop0", "dm-0", "sda1"]) dir(`/sys/block/${n}`);
file("/sys/class/nvme/nvme0/hwmon0/temp1_input", "40000");
file("/sys/class/hwmon/hwmon0/name", "coretemp");
file("/sys/class/hwmon/hwmon0/temp1_input", "45000");
const full = getThermalStatus();
check("⑪ 完整快照 disks（过滤分区/loop/dm）", full.disks, [
  { name: "nvme0n1", tempC: 40 },
  { name: "sda", tempC: 41 },
  { name: "sdb", tempC: null },
]);
check("⑪ 完整快照 cpu", full.cpu, { source: "coretemp", tempC: 45 });
check("⑪ 完整快照 sataWithoutTemp", full.sataWithoutTemp, ["sdb"]);
check("⑪ 完整快照 drivetempLoaded", full.drivetempLoaded, false);

// ⑫ 空 /sys（远程引擎 / 容器）⇒ 全空结构，不抛
reset();
check("⑫ 空 sysfs 不抛异常", getThermalStatus(), {
  cpu: null,
  disks: [],
  drivetempLoaded: false,
  sataWithoutTemp: [],
});

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
