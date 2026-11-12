#!/usr/bin/env node
/**
 * 门禁：导航仪表盘（v1.51.0 引入，v1.51.2 解耦至独立通道，v1.51.11 移除管理弹窗，
 *   v1.51.12 顶栏删除分组设置文字按钮、入口改为标题行「＋」右边齿轮扳手；
 *   v1.51.13 删除顶栏「＋添加项目」，添加新项目唯一入口 = 标题行「＋」；
 *   v1.51.14 弹窗移除底部高级字段折叠区，高级值从 initial 透传不丢数据；
 *   v1.51.15 项目弹窗图标统一改用堆栈 IconAutoComplete，移除智能匹配等自研图标功能）
 *  - 真模块断言：编译运行 src/webui-url.ts 的 resolveNavAppUrl / normalizeNavLanUrl，
 *    覆盖内外网优先级链、`:端口` / `host:端口` / 完整 URL 三种内网写法、auto 分区分派；
 *  - 源码接线断言：导航配置完全收口在独立模块 server/nav-groups.ts（不污染 main settings.json），
 *    独立路由 GET/PUT /api/nav-groups、NavPage 标签条与内容区切换；
 *    v1.51.11 起 NavEditor 弹窗已删除，项目 CRUD 由 NavPage + NavAppModal 直接落盘、
 *    分组新建/删除由 NavGroupSettingsModal 接管、卡片 hover ✎ 由 NavBoard.onEditApp 直达；
 *  - 负向自检①：注入「内网缺 lanUrl 不回落 url」回归 → 重载模块应检出差异 → 还原 → 复核全绿；
 *  - 负向自检②：进程级注入 7 类回归（<NavEditor / 顶栏分组设置文字按钮 / 齿轮接线缺失 /
 *    顶栏添加项目按钮 / 高级字段折叠区 / 智能匹配 / 全局图库被 engineId 阻挡），
 *    支持跨文件注入 NavPage.tsx、NavAppModal.tsx 与 IconAutoComplete.tsx
 *    → 重跑本门禁应 exit 1 → 还原 → 字节级一致。
 * 用法：node scripts/check-nav.mjs（退出码非 0 = 有回归）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
// 独立编译保证自包含，负向注入后重编即编译被破坏的版本）
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
ok("★ NavPage 不再挂载/导入 NavEditor 弹窗",
  !navPage.includes("<NavEditor") && !navPage.includes('from "../components/NavEditor"'));
ok("★ NavEditor.tsx 文件已删除", !fs.existsSync(path.join(ROOT, "src/components/NavEditor.tsx")));
ok("★ NavPage 无管理弹窗状态与入口", !navPage.includes("navEditing") && !navPage.includes("openEditor"));
// v1.51.12：分组设置唯一入口 = 标题行「＋」右边齿轮扳手；v1.51.13 起顶栏仅剩「页面设置」
const topbarActions = (navPage.split('<div className="ml-auto flex items-center gap-2">')[1] || "").split("</div>")[0] || "";
ok("★ 顶栏操作区仅「页面设置」（无管理分组、无分组设置/添加项目文字按钮，v1.51.13）",
  topbarActions.includes("页面设置") &&
  !topbarActions.includes("管理分组") && !topbarActions.includes("分组设置") && !topbarActions.includes("添加项目"));
ok("★ NavPage 不再渲染顶栏分组设置/添加项目文字按钮（LayoutGrid / Plus 已移除）",
  !navPage.includes("<LayoutGrid") && !navPage.includes("分组设置</button>") &&
  !navPage.includes("<Plus size=") && !navPage.includes("添加项目</button>"));
ok("★ NavPage 把分组设置打开器下传给 NavBoard（齿轮入口接线）",
  navPage.includes("onOpenGroupSettings={openGroupSettings}") && navPage.includes("openGroupSettings"));
ok("★ 独立挂载 NavAppModal 并接线项目 CRUD",
  navPage.includes("<NavAppModal") && navPage.includes("handleSaveApp") && navPage.includes("onDelete={handleDeleteApp}"));
ok("★ 项目保存保留跨分组移动语义（旧分组移除同 id）", navPage.includes("a.id !== app.id"));
ok("★ 分组被删后选中项回落第一个", navPage.includes("!next.some((g) => g.id === effectiveTab)"));

const board = read("src/components/NavBoard.tsx");
ok("NavBoard 走 resolveNavAppUrl 解析地址", board.includes("resolveNavAppUrl"));
ok("NavBoard 拉取 /api/network-zone 分区", board.includes("getNetworkZoneApi"));
ok("NavBoard 图标三级解析（URL/图标库/首字母）", board.includes("resolveNavIconSrc"));
ok("无地址卡片禁用打开", board.includes("disabled={!url}"));
ok("★ NavBoard 卡片 hover 编辑入口 onEditApp",
  board.includes("onEditApp") && board.includes("group-hover/card:opacity-100"));
ok("★ NavBoard 不再有旧管理弹窗齿轮入口", !board.includes("onOpenEditor") && !board.includes("GearIcon"));
ok("★ NavBoard「＋」右边齿轮扳手 = 分组设置唯一入口（顺序锁定）",
  board.includes("onOpenGroupSettings") && board.includes("<Settings") && board.includes("分组设置") &&
  board.indexOf("onClick={onAddApp}") < board.indexOf("onClick={onOpenGroupSettings}"));
ok("★ 添加新项目唯一入口 = NavBoard 标题行「＋」（顶栏不再有添加按钮，v1.51.13）",
  board.includes("onClick={onAddApp}") && navPage.includes("onAddApp={openAddApp}") &&
  !navPage.includes("添加项目</button>") && !navPage.includes("<Plus size="));

const appModal = read("src/components/NavAppModal.tsx");
ok("★ NavAppModal 编辑态支持删除项目", appModal.includes("onDelete") && appModal.includes("删除项目"));
ok("NavAppModal 单表单字段（自托管/内网/外网/备注）",
  appModal.includes("自托管") && appModal.includes("内网链接") && appModal.includes("外网链接") && appModal.includes("备注"));
ok("NavAppModal 注释不再引用 NavEditor", !appModal.includes("NavEditor"));
ok("★ NavAppModal 已移除底部高级字段折叠区（v1.51.14）",
  !appModal.includes("更多设置") && !appModal.includes("showMore") &&
  !appModal.includes("<ChevronDown") && !appModal.includes('type="range"') &&
  !appModal.includes('type="color"') && !appModal.includes("＋外网备用地址"));
ok("★ 主表单保持用户清单字段（分组/名称/描述/自托管/内网/外网/图标/备注）",
  ["分组", "名称", "描述", "自托管", "内网链接",
   "外网链接", "图标", "备注"].every((k) => appModal.includes(k)));
ok("★ 高级字段保存时从 initial 透传（编辑已有项目不丢数据）",
  (() => {
    const seg = appModal.split("const confirm = () => {")[1]?.split("onSave(groupId, app);")[0] || "";
    return !!seg && ["initial?.titleColor", "initial?.urlBackups", "initial?.lanBackups",
      "initial?.isPublic", "initial?.iconZoom"].every((k) => seg.includes(k));
  })());

// v1.51.15：图标统一改用堆栈 IconAutoComplete，导航页自研匹配功能全部移除
const iconAuto = read("src/components/IconAutoComplete.tsx");
ok("★ 导航弹窗图标接入堆栈 IconAutoComplete（输入自动匹配 / 点选写入 URL）",
  appModal.includes("<IconAutoComplete") && appModal.includes('from "./IconAutoComplete"') &&
  appModal.includes("onPick={(urlValue) => setIcon(urlValue)}") && appModal.includes("onChange={(val) => setIcon(val)}"));
// 只检查代码体：文件头注释会写明「移除了什么」，属文档文本，不应触发零残留断言
const headEnd = appModal.indexOf("*/");
ok("门禁锚点：NavAppModal 文件头块注释存在", headEnd > 0 && headEnd < 2000);
const appModalCode = headEnd > 0 ? appModal.slice(headEnd + 2) : appModal;
ok("★ 导航弹窗自研图标功能零残留（智能匹配/已缓存/Docker 引用/预览框）",
  !["smartMatch", "智能匹配", "已缓存", "未缓存", "引用 Docker 容器图标",
    "fillFromContainer", "useNavIconMap", "resolveNavIconSrc", "previewZoom", "cached"].some((k) => appModalCode.includes(k)));
ok("★ IconAutoComplete 无条件拉取全局自定义图标库（导航页无 engine 上下文）",
  iconAuto.includes("listCustomIconsApi().catch(() => null)") &&
  !iconAuto.includes("engineId ? listCustomIconsApi") &&
  iconAuto.includes("listStackIconsApi"));
ok("★ NavPage 不再向项目弹窗传 containers（图标不再引用 Docker 容器）",
  !navPage.includes("containers={containers}") && !navPage.includes("Container[]"));

const gs = read("src/components/NavGroupSettingsModal.tsx");
ok("★ 分组设置接管分组新建/删除", gs.includes("addGroup") && gs.includes("removeGroup"));
ok("★ 分组设置空态可新建且允许删到 0 组", gs.includes("新建分组") && gs.includes("draft.every"));
ok("★ 分组设置不再引导到管理分组", !gs.includes("请先到「管理分组」"));

const appSrc = read("src/App.tsx");
ok("App 提供 handleSaveNavGroups 并透传 NavPage", appSrc.includes("handleSaveNavGroups") && appSrc.includes("<NavPage"));
ok("App 导航分组走独立通道（fetchNavGroups/saveNavGroupsApi）", appSrc.includes("fetchNavGroups") && appSrc.includes("saveNavGroupsApi"));
ok("App 不再借道 settings.nav", !appSrc.includes("settings?.nav") && !appSrc.includes("settings?.nav?.groups"));

const navMod = read("server/nav-groups.ts");
ok("导航分组独立持久化模块存在", navMod.includes("getNavGroups") && navMod.includes("saveNavGroups") && navMod.includes("normalizeNavGroups"));
ok("独立模块含一次性迁移（migrateFromSettings）", navMod.includes("migrateFromSettings"));
ok("独立模块钳制条目上限（50 组 / 200 应用）", navMod.includes("slice(0, 50)") && navMod.includes("slice(0, 200)"));

const sset = read("server/settings.ts");
ok("main settings 已剥离 nav（不含 nav: { groups）", !sset.includes("nav: { groups:"));
ok("main settings 不再归一化 nav.groups", !sset.includes("normalizeNavGroups(parsed?.nav?.groups)"));

const indexSrc = read("server/index.ts");
ok("服务端注册 GET /api/nav-groups", indexSrc.includes('app.get("/api/nav-groups"'));
ok("服务端注册 PUT /api/nav-groups", indexSrc.includes('app.put("/api/nav-groups"'));

const typesSrc = read("src/types.ts");
ok("类型 NavGroup/NavAppItem/NavConfig 已定义", typesSrc.includes("interface NavGroup") && typesSrc.includes("interface NavAppItem") && typesSrc.includes("NavConfig"));
ok("SystemSettings 已移除 nav 字段", !typesSrc.includes("nav: NavConfig"));

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

console.log("== ④ 负向自检（进程级注入 7 类回归 → 重跑本门禁应 exit 1） ==");
// 父进程注入 7 类回归文本，子进程跳过 ④（NAV_GATE_NEGATIVE_CHILD=1）只跑 ①②③，
// 若 ② 的对应断言确实生效，子进程必因 FAIL 而 exit 1。
if (!process.env.NAV_GATE_NEGATIVE_CHILD) {
  const NAV_PAGE_REL = "src/pages/NavPage.tsx";
  const cases = [
    {
      name: "注入 <NavEditor 回归",
      inject: (s) => s + "\n{/* <NavEditor /> */}\n",
    },
    {
      name: "注入顶栏「分组设置」文字按钮回归",
      inject: (s) => s.replace(
        '<div className="ml-auto flex items-center gap-2">',
        '<div className="ml-auto flex items-center gap-2"><button>分组设置</button>',
      ),
    },
    {
      name: "注入齿轮入口接线缺失回归",
      inject: (s) => s.replace("onOpenGroupSettings={openGroupSettings}", ""),
    },
    {
      name: "注入顶栏「添加项目」文字按钮回归",
      inject: (s) => s.replace(
        '<div className="ml-auto flex items-center gap-2">',
        '<div className="ml-auto flex items-center gap-2"><button>添加项目</button>',
      ),
    },
    {
      name: "注入底部高级字段折叠区回归",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s + "\n{/* 更多设置 */}\n",
    },
    {
      name: "注入智能匹配按钮回归",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s + "\n{/* 智能匹配 */}\n",
    },
    {
      name: "注入全局图库被 engineId 阻挡回归",
      rel: "src/components/IconAutoComplete.tsx",
      inject: (s) => s.replace(
        "listCustomIconsApi().catch(() => null),",
        "engineId ? listCustomIconsApi().catch(() => null) : Promise.resolve(null),",
      ),
    },
  ];
  for (const c of cases) {
    const rel = c.rel || NAV_PAGE_REL;
    const orig = read(rel);
    const mutated = c.inject(orig);
    if (mutated === orig) {
      failCount++;
      console.log(`  FAIL  负向自检锚点失效（${c.name}，请更新门禁）`);
      continue;
    }
    fs.writeFileSync(path.join(ROOT, rel), mutated, "utf8");
    let childFailed = false;
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: "pipe",
        env: { ...process.env, NAV_GATE_NEGATIVE_CHILD: "1" },
      });
    } catch (e) {
      childFailed = e.status === 1;
    } finally {
      fs.writeFileSync(path.join(ROOT, rel), orig, "utf8");
    }
    ok(`${c.name}被检出（子进程 exit 1）`, childFailed);
    ok(`${c.name}还原字节级一致`, read(rel) === orig);
  }
}

// 清理临时目录
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n结果: ${okCount} ok / ${failCount} FAIL`);
process.exit(failCount === 0 ? 0 : 1);
