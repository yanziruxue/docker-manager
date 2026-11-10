#!/usr/bin/env node
/**
 * 门禁：导航仪表盘（v1.51.0，label 分支）
 *  - 真模块断言：编译运行 src/webui-url.ts 的 resolveNavAppUrl / normalizeNavLanUrl，
 *    覆盖内外网优先级链、`:端口` / `host:端口` / 完整 URL 三种内网写法、auto 分区分派；
 *  - 源码接线断言：服务端 nav 段默认值 + normalizeNavGroups、NavPage 标签条与内容区切换、
 *    NavEditor 分组/应用 CRUD 与 Docker 聚合入口、App 落盘回调；
 *  - 负向自检：注入「内网缺 lanUrl 不回落 url」回归 → 重载模块应检出差异 → 还原 → 复核全绿。
 * 用法：node scripts/check-nav.mjs（退出码非 0 = 有回归）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
let okCount = 0;
let failCount = 0;
function ok(name, cond) {
  if (cond) {
    okCount++;
    console.log(`  ok    ${name}`);
  } else {
    failCount++;
    console.log(`  FAIL  ${name}`);
  }
}
function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

console.log("== ① 真模块断言（src/webui-url.ts 编译运行） ==");
// 用 esbuild 把 TS 编译成 CJS 临时文件再 require（与 check-webui-zone 同思路；
// 若 check-webui-zone 已有现成 loader 则直接复用其产物模式——这里独立编译保证自包含）
const { execFileSync } = await import("node:child_process");
const tmpDir = fs.mkdtempSync(path.join(ROOT, ".gate-nav-"));
const jsFile = path.join(tmpDir, "webui-url.cjs");
/** 每次编译 **当前** src/webui-url.ts（负向注入后重编即编译被破坏的版本）并清缓存 require */
function buildAndLoad() {
  execFileSync(process.execPath, [
    path.join(ROOT, "node_modules", "esbuild", "bin", "esbuild"),
    path.join(ROOT, "src", "webui-url.ts"),
    "--format=cjs",
    "--outfile=" + jsFile,
  ], { stdio: "pipe" });
  delete require.cache[require.resolve(jsFile)];
  return require(jsFile);
}
const mod = buildAndLoad();
const loc = { protocol: "http:", hostname: "192.168.24.10" };

// normalizeNavLanUrl 三种写法
ok("lanUrl 完整 URL 原样", mod.normalizeNavLanUrl("https://a.com:8080/x", loc) === "https://a.com:8080/x");
ok("lanUrl :端口 → 地址栏 host", mod.normalizeNavLanUrl(":8807", loc) === "http://192.168.24.10:8807");
ok("lanUrl host:端口 → 协议拼接", mod.normalizeNavLanUrl("192.168.24.2:9000", loc) === "http://192.168.24.2:9000");
ok("lanUrl 空 → 空串", mod.normalizeNavLanUrl("", loc) === "");

// resolveNavAppUrl 优先级链
const app = { url: "https://wan.example.com:8807", lanUrl: ":8807" };
ok("内网取 lanUrl", mod.resolveNavAppUrl(app, "intranet", "internet", loc) === "http://192.168.24.10:8807");
ok("外网取 url", mod.resolveNavAppUrl(app, "internet", "intranet", loc) === "https://wan.example.com:8807");
ok("auto+内网分区取 lanUrl", mod.resolveNavAppUrl(app, "auto", "intranet", loc) === "http://192.168.24.10:8807");
ok("auto+外网分区取 url", mod.resolveNavAppUrl(app, "auto", "internet", loc) === "https://wan.example.com:8807");
ok("内网缺 lanUrl 回落 url", mod.resolveNavAppUrl({ url: "https://w", lanUrl: "" }, "intranet", "intranet", loc) === "https://w");
ok("外网缺 url 回落 lanUrl", mod.resolveNavAppUrl({ url: "", lanUrl: ":80" }, "internet", "intranet", loc) === "http://192.168.24.10:80");
ok("双空 → 空串（调用方禁用卡片）", mod.resolveNavAppUrl({ url: "", lanUrl: " " }, "auto", "internet", loc) === "");

console.log("== ② 源码接线断言 ==");
const navPage = read("src/pages/NavPage.tsx");
ok("NavPage 接收 navGroups/onSaveNavGroups", navPage.includes("navGroups") && navPage.includes("onSaveNavGroups"));
ok("NavPage 顶部标签条渲染分组按钮", navPage.includes("groups.map((g) => (") && navPage.includes("setNavTab(g.id)"));
ok("选中分组渲染 NavBoard、无分组提示空状态", navPage.includes("<NavBoard") && navPage.includes("还没有导航分组"));
ok("导航管理弹窗挂载", navPage.includes("<NavEditor"));

const board = read("src/components/NavBoard.tsx");
ok("NavBoard 走 resolveNavAppUrl 解析地址", board.includes("resolveNavAppUrl"));
ok("NavBoard 拉取 /api/network-zone 分区", board.includes("getNetworkZoneApi"));
ok("NavBoard 图标三级解析（URL/图标库/首字母）", board.includes("resolveNavIconSrc"));
ok("无地址卡片禁用打开", board.includes("disabled={!url}"));

const editor = read("src/components/NavEditor.tsx");
ok("NavEditor 分组 CRUD（新增/删除/排序）", editor.includes("addGroup") && editor.includes("removeGroup") && editor.includes("moveGroup"));
ok("NavEditor 应用编辑（内外网地址/图标/底色/备注）", editor.includes("lanUrl") && editor.includes("iconColor") && editor.includes("remark"));
ok("NavEditor Docker 一键聚合", editor.includes("DockerImport") && editor.includes("从容器生成"));
ok("聚合入口内网地址自动取 WebUI 端口", editor.includes("webuiPort ? `:${c.webuiPort}`"));

const appSrc = read("src/App.tsx");
ok("App 提供 handleSaveNavGroups 并透传 NavPage", appSrc.includes("handleSaveNavGroups") && appSrc.includes("<NavPage"));

const sset = read("server/settings.ts");
ok("服务端 DEFAULT_SETTINGS 含 nav 空分组", sset.includes("nav: { groups: []"));
ok("服务端 getSettings 归一化 nav.groups", sset.includes("normalizeNavGroups(parsed?.nav?.groups)"));
ok("归一化钳制条目上限（50 组 / 200 应用）", sset.includes("slice(0, 50)") && sset.includes("slice(0, 200)"));

const typesSrc = read("src/types.ts");
ok("类型 NavGroup/NavAppItem/NavConfig 已定义", typesSrc.includes("interface NavGroup") && typesSrc.includes("interface NavAppItem") && typesSrc.includes("NavConfig"));

console.log("== ③ 负向自检（注入回归 → 检出 → 还原） ==");
// 注入「内网缺 lanUrl 不回落 url」回归：应被 ⑤ 号用例检出
const TARGET = "src/webui-url.ts";
const ORIGINAL = read(TARGET);
const BROKEN = ORIGINAL.replace("const intranetPick = () => lan || wan;", "const intranetPick = () => lan;");
if (BROKEN === ORIGINAL) {
  failCount++;
  console.log("  FAIL  负向自检锚点失效（resolveNavAppUrl 内网兜底链写法已变化，请更新门禁）");
} else {
  fs.writeFileSync(path.join(ROOT, TARGET), BROKEN, "utf8");
  try {
    const broken = buildAndLoad();
    const detected = broken.resolveNavAppUrl({ url: "https://w", lanUrl: "" }, "intranet", "intranet", loc) !== "https://w";
    ok("负向注入被检出（内网缺 lanUrl 必须回落 url）", detected);
  } finally {
    fs.writeFileSync(path.join(ROOT, TARGET), ORIGINAL, "utf8");
  }
  const restored = buildAndLoad();
  ok("还原后解析器恢复全绿", restored.resolveNavAppUrl({ url: "https://w", lanUrl: "" }, "intranet", "intranet", loc) === "https://w");
  ok("还原字节级一致", read(TARGET) === ORIGINAL);
}

// 清理临时目录
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n结果: ${okCount} ok / ${failCount} FAIL`);
process.exit(failCount === 0 ? 0 : 1);
