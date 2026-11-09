/**
 * 内外网 WebUI 自动切换门禁（v1.50.36）。
 *
 * 用 esbuild 编译后的**真实模块**断言核心逻辑，再对源码接线做锚点断言，最后负向自检：
 *   ① CIDR 解析与归一化：逗号/分号/回车分隔、非法项丢弃、无有效项回落默认 8 段、去重；
 *   ② 命中判定：IPv4 前缀匹配、IPv6（::1 / fe80::/10 / fc00::/7）、v4-mapped 归一化；
 *   ③ 来源 IP 提取：X-Forwarded-For 优先、::ffff: 前缀剥离；
 *   ④ WebUI 解析器：内网 = 地址栏+端口（缺端口回落 URL）、外网 = URL（缺 URL 回落地址栏+端口）、自动按分区分派；
 *   ⑤ 三态循环与持久化归一化（auto → intranet → internet → auto）；
 *   ⑥ 源码接线：服务端路由/设置默认值、前端类型/api、App 透传 webuiPort、
 *      容器页切换按钮与两处 WebUI 按钮接线、设置卡片。
 *
 * 负向自检：向 src/webui-url.ts 注入回归（内网兜底链被破坏）→ 重载模块应检出 → 还原 → 全绿。
 *
 * 运行：node scripts/check-webui-zone.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    pass++;
    console.log(`  PASS  ${name}  →  ${a.length > 110 ? a.slice(0, 110) + "…" : a}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  期望 ${e.slice(0, 160)}  实际 ${a.slice(0, 160)}`);
  }
}
function ok(name, cond) {
  check(name, !!cond, true);
}

/** 编译真实 TS 模块（无临时产物，data URL 直接 import） */
async function loadModule(rel, platform) {
  const built = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    platform,
    format: "esm",
    target: "node20",
  });
  return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

const zone = await loadModule("server/network-zone.ts", "node");
const {
  DEFAULT_INTRANET_CIDRS,
  normalizeIntranetCidrs,
  ipInCidrs,
  clientIpFromRequest,
  resolveNetworkZone,
} = zone;

/* ---------- ① 归一化 ---------- */
console.log("══ ① 网段归一化 ══");
check("默认网段恰为 8 段", DEFAULT_INTRANET_CIDRS.length, 8);
check("默认含 RFC1918 三段 + 回环", ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"].every((c) => DEFAULT_INTRANET_CIDRS.includes(c)), true);
check("空串回落默认 8 段", normalizeIntranetCidrs(""), DEFAULT_INTRANET_CIDRS);
check("全空白回落默认", normalizeIntranetCidrs("  \n\t "), DEFAULT_INTRANET_CIDRS);
check("单网段", normalizeIntranetCidrs("192.168.24.0/24"), ["192.168.24.0/24"]);
check("英文逗号分隔", normalizeIntranetCidrs("192.168.24.0/24,10.0.0.0/8"), ["192.168.24.0/24", "10.0.0.0/8"]);
check("英文分号分隔", normalizeIntranetCidrs("192.168.24.0/24; 10.0.0.0/8"), ["192.168.24.0/24", "10.0.0.0/8"]);
check("回车换行分隔", normalizeIntranetCidrs("192.168.24.0/24\r\n10.0.0.0/8\n172.16.0.0/12"), ["192.168.24.0/24", "10.0.0.0/8", "172.16.0.0/12"]);
check("非法项丢弃（乱串/超范围段/越界前缀）", normalizeIntranetCidrs("abc,300.1.1.0/24,1.2.3.0/33,::zzz/128,192.168.24.0/24"), ["192.168.24.0/24"]);
check("全部非法回落默认", normalizeIntranetCidrs("abc,1.2.3.0/33"), DEFAULT_INTRANET_CIDRS);
check("重复去重保持顺序", normalizeIntranetCidrs("10.0.0.0/8, 10.0.0.0/8 ,192.168.0.0/16"), ["10.0.0.0/8", "192.168.0.0/16"]);
check("无前缀视为 /32", normalizeIntranetCidrs("192.168.24.5"), ["192.168.24.5"]);

/* ---------- ② 命中判定 ---------- */
console.log("══ ② IP 命中判定 ══");
ok("192.168.24.55 ∈ 192.168.24.0/24", ipInCidrs("192.168.24.55", ["192.168.24.0/24"]));
ok("192.168.25.5 ∉ 192.168.24.0/24", !ipInCidrs("192.168.25.5", ["192.168.24.0/24"]));
ok("10.1.2.3 ∈ 10.0.0.0/8", ipInCidrs("10.1.2.3", ["10.0.0.0/8"]));
ok("127.0.0.1 ∈ 默认（回环）", ipInCidrs("127.0.0.1", DEFAULT_INTRANET_CIDRS));
ok("192.168.24.10 ∈ 默认", ipInCidrs("192.168.24.10", DEFAULT_INTRANET_CIDRS));
ok("172.20.1.1 ∈ 默认（/12 段内）", ipInCidrs("172.20.1.1", DEFAULT_INTRANET_CIDRS));
ok("172.32.1.1 ∉ 默认（/12 段外）", !ipInCidrs("172.32.1.1", DEFAULT_INTRANET_CIDRS));
ok("8.8.8.8 ∉ 默认（公网）", !ipInCidrs("8.8.8.8", DEFAULT_INTRANET_CIDRS));
ok("::1 ∈ 默认（IPv6 回环）", ipInCidrs("::1", DEFAULT_INTRANET_CIDRS));
ok("fe80::1 ∈ 默认（链路本地）", ipInCidrs("fe80::1", DEFAULT_INTRANET_CIDRS));
ok("fd00::1234 ∈ 默认（ULA）", ipInCidrs("fd00::1234", DEFAULT_INTRANET_CIDRS));
ok("2001:db8::1 ∉ 默认（公网 v6）", !ipInCidrs("2001:db8::1", DEFAULT_INTRANET_CIDRS));
ok("::ffff:192.168.24.5 ∈ 默认（v4-mapped 归一化）", ipInCidrs("::ffff:192.168.24.5", DEFAULT_INTRANET_CIDRS));
ok("空 IP 不命中", !ipInCidrs("", DEFAULT_INTRANET_CIDRS));
check("分区判定：内网", resolveNetworkZone("192.168.24.10", DEFAULT_INTRANET_CIDRS), "intranet");
check("分区判定：外网", resolveNetworkZone("8.8.8.8", DEFAULT_INTRANET_CIDRS), "internet");

/* ---------- ③ 来源 IP 提取 ---------- */
console.log("══ ③ 来源 IP 提取 ══");
check("X-Forwarded-For 首个优先", clientIpFromRequest({ headers: { "x-forwarded-for": "192.168.24.7, 10.0.0.1" }, socket: { remoteAddress: "8.8.8.8" } }), "192.168.24.7");
check("无 XFF 取 socket 地址", clientIpFromRequest({ headers: {}, socket: { remoteAddress: "192.168.24.7" } }), "192.168.24.7");
check("v4-mapped socket 地址剥离前缀", clientIpFromRequest({ headers: {}, socket: { remoteAddress: "::ffff:192.168.24.7" } }), "192.168.24.7");
check("无来源返回空串", clientIpFromRequest({ headers: {}, socket: {} }), "");

/* ---------- ④⑤ WebUI 解析器 + 三态循环 ---------- */
console.log("══ ④⑤ WebUI 解析器 ══");
const client = await loadModule("src/webui-url.ts", "neutral");
const { resolveWebuiUrl, loadWebuiZoneMode, nextWebuiZoneMode, WEBUI_ZONE_MODE_KEY } = client;
const loc = { protocol: "http:", hostname: "192.168.24.10" };
const label = { webuiUrl: "https://app.example.com", webuiPort: "8807" };
check("内网 = 地址栏 + 端口", resolveWebuiUrl(label, "intranet", "internet", loc), "http://192.168.24.10:8807");
check("外网 = LABELS URL", resolveWebuiUrl(label, "internet", "intranet", loc), "https://app.example.com");
check("自动 + 内网分区 = 地址栏 + 端口", resolveWebuiUrl(label, "auto", "intranet", loc), "http://192.168.24.10:8807");
check("自动 + 外网分区 = LABELS URL", resolveWebuiUrl(label, "auto", "internet", loc), "https://app.example.com");
check("内网缺端口回落 URL", resolveWebuiUrl({ webuiUrl: "https://a.com" }, "intranet", "intranet", loc), "https://a.com");
check("外网缺 URL 回落地址栏 + 端口", resolveWebuiUrl({ webuiPort: "8807" }, "internet", "internet", loc), "http://192.168.24.10:8807");
check("两字段全缺 = 空串（按钮禁用）", resolveWebuiUrl({}, "auto", "intranet", loc), "");
check("空 URL 串按缺处理", resolveWebuiUrl({ webuiUrl: "  ", webuiPort: "80" }, "internet", "internet", loc), "http://192.168.24.10:80");
check("三态循环 auto→intranet", nextWebuiZoneMode("auto"), "intranet");
check("三态循环 intranet→internet", nextWebuiZoneMode("intranet"), "internet");
check("三态循环 internet→auto", nextWebuiZoneMode("internet"), "auto");
check("持久化归一化：auto 回落", loadWebuiZoneMode({ getItem: () => null }), "auto");
check("持久化归一化：非法值回落 auto", loadWebuiZoneMode({ getItem: () => "hack" }), "auto");
check("持久化归一化：internet 保留", loadWebuiZoneMode({ getItem: () => "internet" }), "internet");
check("localStorage 键名", WEBUI_ZONE_MODE_KEY, "webui-zone-mode");

/* ---------- ⑥ 源码接线 ---------- */
console.log("══ ⑥ 源码接线 ══");
const indexSrc = read("server/index.ts");
ok("服务端 GET /api/network-zone 已注册", indexSrc.includes('app.get("/api/network-zone"'));
ok("服务端引入网段归一化模块", indexSrc.includes('from "./network-zone.js"'));
const srvSettingsSrc = read("server/settings.ts");
ok("服务端默认 intranetCidrs 为空串", srvSettingsSrc.includes('intranetCidrs: ""'));
const typesSrc = read("src/types.ts");
ok("前端类型声明 ModalConfig.intranetCidrs", typesSrc.includes("intranetCidrs: string"));
ok("前端类型声明 Container.webuiPort", typesSrc.includes("webuiPort?: string"));
const apiSrc = read("src/api.ts");
ok("api.ts 暴露 getNetworkZoneApi", apiSrc.includes("export function getNetworkZoneApi"));
const appSrc = read("src/App.tsx");
ok("App 透传 LABELS 端口到容器", appSrc.includes("c.webuiPort = label.webuiPort"));
ok("App 跳过条件含 webuiPort（仅填端口也透传）", appSrc.includes("!label.webuiPort"));
const containersSrc = read("src/pages/Containers.tsx");
ok("容器页引入解析器", containersSrc.includes('from "../webui-url"'));
ok("容器页拉取访问分区", containersSrc.includes("getNetworkZoneApi()"));
ok("容器页切换按钮接入三态循环", containersSrc.includes("nextWebuiZoneMode(zoneMode)"));
ok("非自动选择持久化 / 自动清除", containersSrc.includes("WEBUI_ZONE_MODE_KEY"));
ok("列表行 WebUI 按钮走解析器（含禁用判定）", containersSrc.includes("resolveWebuiUrl(container, zoneMode, zone"));
ok("详情弹窗接收 zone/mode 透传", containersSrc.includes("webuiZoneMode={zoneMode}") && containersSrc.includes("webuiZone={zone}"));
ok("详情弹窗 WebUI 按钮走解析器", containersSrc.includes("resolveWebuiUrl(container, webuiZoneMode, webuiZone"));
const settingsSrc = read("src/pages/Settings.tsx");
ok("页面设置新增内外网自动切换卡片", settingsSrc.includes('title="内外网自动切换"'));
ok("卡片写入 modal.intranetCidrs", settingsSrc.includes('update("modal", "intranetCidrs"'));
ok("设置卡片列出默认网段", settingsSrc.includes("fc00::/7"));

/* ---------- ⑦ 门禁接线 + 负向自检 ---------- */
console.log("══ ⑦ 门禁接线 + 负向自检 ══");
const pkg = JSON.parse(read("package.json"));
// 语义比较「不低于引入版」：避免后续升版本时硬编码断言假红
const verCmp = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
ok(`版本号不低于 1.50.36（当前 ${pkg.version}）`, verCmp(pkg.version, "1.50.36") >= 0);
ok("门禁已接入 test:gates", (pkg.scripts["test:gates"] || "").includes("test:webuizone"));

// 负向自检：注入「内网兜底链被破坏」回归 → 重载模块应检出差异 → 还原 → 复核全绿
// （回归用例必须选「仅有 URL 没端口」：破坏 fallback 链后该场景由 URL 回落成空串，才能检出）
const TARGET = "src/webui-url.ts";
const ORIGINAL = read(TARGET);
const BROKEN = ORIGINAL.replace("const intranetPick = () => portUrl || full;", "const intranetPick = () => portUrl;");
if (BROKEN === ORIGINAL) {
  // 锚点没命中说明源码结构变了，直接失败提醒维护者更新门禁
  fail++;
  console.log("  FAIL  负向自检锚点失效（src/webui-url.ts 内网兜底链写法已变化）");
} else {
  fs.writeFileSync(path.join(ROOT, TARGET), BROKEN, "utf8");
  try {
    const broken = await loadModule(TARGET, "neutral");
    const detected = broken.resolveWebuiUrl({ webuiUrl: "https://a.com" }, "intranet", "intranet", loc) !== "https://a.com";
    ok("负向注入被检出（内网缺端口必须回落 URL）", detected);
  } finally {
    fs.writeFileSync(path.join(ROOT, TARGET), ORIGINAL, "utf8");
  }
  const restored = await loadModule(TARGET, "neutral");
  ok("还原后解析器恢复全绿", restored.resolveWebuiUrl({ webuiUrl: "https://a.com" }, "intranet", "intranet", loc) === "https://a.com");
  ok("还原后文件字节级一致", read(TARGET) === ORIGINAL);
}

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
