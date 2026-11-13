#!/usr/bin/env node
/**
 * 门禁：导航仪表盘（v1.51.0 引入，v1.51.2 解耦至独立通道，v1.51.11 移除管理弹窗，
 *   v1.51.12 顶栏删除分组设置文字按钮、入口改为标题行「＋」右边齿轮扳手；
 *   v1.51.13 删除顶栏「＋添加项目」，添加新项目唯一入口 = 标题行「＋」；
 *   v1.51.14 弹窗移除底部高级字段折叠区，高级值从 initial 透传不丢数据；
 *   v1.51.15 项目弹窗图标统一改用堆栈 IconAutoComplete，移除智能匹配等自研图标功能；
 *   v1.51.16 勾选自托管后新增「容器列表」按钮，选容器一次填入名称/内网端口/外网链接/图标；
 *   v1.51.17 背景图上传上限提到 20MB、超限返回 JSON、前端预校验与友好兜底；
 *   v1.51.18 顶栏「页面设置」左侧新增「编辑」切换按钮，仅编辑态渲染卡片 ✎ 编辑入口，浏览态隐藏）
 *  - 真模块断言：编译运行 src/webui-url.ts 的 resolveNavAppUrl / normalizeNavLanUrl，
 *    覆盖内外网优先级链、`:端口` / `host:端口` / 完整 URL 三种内网写法、auto 分区分派；
 *  - 源码接线断言：导航配置完全收口在独立模块 server/nav-groups.ts（不污染 main settings.json），
 *    独立路由 GET/PUT /api/nav-groups、NavPage 标签条与内容区切换；
 *    v1.51.11 起 NavEditor 弹窗已删除，项目 CRUD 由 NavPage + NavAppModal 直接落盘、
 *    分组新建/删除由 NavGroupSettingsModal 接管、卡片 hover ✎ 由 NavBoard.onEditApp 直达；
 *  - 负向自检①：注入「内网缺 lanUrl 不回落 url」回归 → 重载模块应检出差异 → 还原 → 复核全绿；
 *  - 负向自检②：进程级注入 40 类回归（<NavEditor / 顶栏分组设置文字按钮 / 齿轮接线缺失 /
 *    顶栏添加项目按钮 / 高级字段折叠区 / 智能匹配 / 全局图库被 engineId 阻挡 /
 *    容器列表接线缺失 / 容器四字段映射缺失 / 背景图上限回退 2mb / 超限 JSON 中间件缺失 /
 *    上传兜底文案回退 / 前端体积预校验缺失 / 编辑按钮缺失 / editMode 未下传 NavBoard /
 *    卡片 ✎ 非编辑态即可见），
 *    支持跨文件注入 NavPage.tsx、NavAppModal.tsx、NavBoard.tsx 与 IconAutoComplete.tsx
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
ok("NavPage 接收 navZones/onSaveNavZones（v1.52.0 分区结构）", navPage.includes("navZones") && navPage.includes("onSaveNavZones"));
ok("NavPage 顶部分区标签条渲染分区按钮", navPage.includes("renderZones.map((z) => {") && navPage.includes("setNavTab(z.id)"));
ok("选中分区渲染 NavBoard、无分区提示空状态", navPage.includes("<NavBoard") && navPage.includes("还没有导航分区"));
ok("★ NavPage 不再挂载/导入 NavEditor 弹窗",
  !navPage.includes("<NavEditor") && !navPage.includes('from "../components/NavEditor"'));
ok("★ NavEditor.tsx 文件已删除", !fs.existsSync(path.join(ROOT, "src/components/NavEditor.tsx")));
ok("★ NavPage 无管理弹窗状态与入口", !navPage.includes("navEditing") && !navPage.includes("openEditor"));
// v1.52.1：入口收敛顶栏图标条「编辑 | ＋添加项目 | ⚙分区/分组设置 | 页面设置」，分组行不再带 ＋/齿轮
const topbarActions = (navPage.split('<div className="ml-auto flex items-center gap-2">')[1] || "").split("</div>")[0] || "";
ok("★ 顶栏四入口顺序锁定：编辑 → ＋添加项目 → ⚙分区与分组设置 → 页面设置",
  topbarActions.includes("编辑") && topbarActions.includes("添加项目") &&
  topbarActions.includes("分区与分组设置") && topbarActions.includes("页面设置") &&
  topbarActions.indexOf("编辑") < topbarActions.indexOf("添加项目") &&
  topbarActions.indexOf("添加项目") < topbarActions.indexOf("分区与分组设置") &&
  topbarActions.indexOf("分区与分组设置") < topbarActions.indexOf("页面设置"));
ok("★ 顶栏不渲染文字版分组设置/添加项目按钮（图标 + title 即可）",
  !navPage.includes("<LayoutGrid") && !navPage.includes("分组设置</button>") &&
  !navPage.includes("添加项目</button>"));
ok("★ 顶栏「＋添加项目」默认归属当前分区首分组（全部视图=首个有分组的分区）",
  navPage.includes("openAddApp(defaultAddGroupId() || \"\")") && navPage.includes("defaultAddGroupId"));
ok("★ 顶栏齿轮打开分区/分组设置并定位当前分区",
  navPage.includes("openGroupSettings(undefined, isAll ? undefined : effectiveTab)") &&
  navPage.includes("initialZoneId={groupSettings.initialZoneId}"));
ok("★ 独立挂载 NavAppModal 并接线项目 CRUD",
  navPage.includes("<NavAppModal") && navPage.includes("handleSaveApp") && navPage.includes("onDelete={handleDeleteApp}"));
ok("★ 项目保存保留跨分组移动语义（旧分组移除同 id）", navPage.includes("a.id !== app.id"));
ok("★ 分区被删后选中项回落第一个", navPage.includes("!next.some((z) => z.id === effectiveTab)"));

const board = read("src/components/NavBoard.tsx");
ok("NavBoard 走 resolveNavAppUrl 解析地址", board.includes("resolveNavAppUrl"));
ok("NavBoard 拉取 /api/network-zone 分区", board.includes("getNetworkZoneApi"));
ok("NavBoard 图标三级解析（URL/图标库/首字母）", board.includes("resolveNavIconSrc"));
ok("无地址卡片禁用打开", board.includes("disabled={!url}"));
ok("★ NavBoard 卡片编辑入口 onEditApp（v1.51.18：仅 editMode 渲染，不再 hover 才显）",
  board.includes("onEditApp") && board.includes("{editMode && (") && board.includes('title={`编辑「${a.name}」`}'));
ok("★ NavBoard 不再有旧管理弹窗齿轮入口", !board.includes("onOpenEditor") && !board.includes("GearIcon"));
ok("★ NavBoard 分组标题行不再渲染 ＋/齿轮（入口收敛顶栏，v1.52.1）",
  !board.includes("onOpenGroupSettings") && !board.includes("onAddApp") &&
  !board.includes('title="为该分组添加入口"') && !board.includes("分组设置"));

// v1.52.8：分区/分组都已建好、组内无项目时也能拖进去
ok("★ 整个分组容器接管拖放，空分组可追加到末尾",
  board.includes("onDragOver={dragActive") && board.includes('onCardDrop?.("", group.id)') &&
  board.includes("松手放到该分组") && board.includes("dragActive?: boolean"));
// v1.52.11：空分组占位常态完全空白（无 ＋ 图标 / 无文案 / 无虚线框），拖拽态才显示放置提示
ok("★ 空分组占位常态空白、拖拽态才出现虚线放置提示（v1.52.11）",
  !board.includes("PlusIcon") && !board.includes("该分组还没有入口") &&
  board.includes('{dragActive && <p className="text-sm">松手放到该分组</p>}') &&
  board.includes(': "py-2"') &&
  board.includes("border-2 border-dashed border-fuchsia-300"));
ok("★ 卡片落点 stopPropagation（不与容器追加重复搬移）",
  board.includes("e.stopPropagation(); onCardDrop?.(a.id, cardGroupId);"));
ok("★ NavPage 编辑态全局下传 dragActive（v1.52.10 不再按来源分区裁剪），0 分组分区给明确引导",
  navPage.includes("const dragActive = editMode && !!drag;") &&
  navPage.includes("dragActive={dragActive}") &&
  !navPage.includes("dragZoneId") &&
  navPage.includes("请先在分区与分组设置里新建分组后再拖入"));
ok("★ NavBoard 容器 / 卡片落点均受 dragActive 约束（仅编辑态拖拽才接管）",
  (board.match(/onDragOver=\{dragActive \? \(e\) => e\.preventDefault\(\) : undefined\}/g) || []).length >= 2);

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

// v1.52.7：项目归属两级「分区 → 该分区下的分组」
ok("★ 编辑项目归属两级：分区下拉 + 仅列该分区分组的下拉",
  ["value={zoneId}", "changeZone(e.target.value)", "zoneGroups.map((g) => (",
   "(zones || []).find((z) => (z.groups || []).some((g) => g.id === groupId))",
   "disabled={zoneGroups.length === 0}"].every((k) => appModal.includes(k)));
ok("★ 切换分区自动回落到该分区首分组（分组不跨分区残留）",
  appModal.includes('setGroupId(z?.groups?.[0]?.id || "")'));
ok("★ 分组下拉不再平铺全部分区（扁平 groups 仅用于名称唯一校验）",
  !appModal.includes("groups.map(") && appModal.includes("existingNames"));
ok("★ 无分组分区禁止保存并给出引导",
  appModal.includes("!!groupId") && appModal.includes("该分区下还没有分组"));

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
// v1.51.16：容器列表入口在「自托管」行，用于一次填入 4 个字段；图标区仍只有 IconAutoComplete
// 注意：appSrc 在下方才定义，这里直接 read 避免 TDZ
ok("★ 容器列表数据链路 App → NavPage → NavAppModal（含已停止的容器）",
  read("src/App.tsx").includes("containers={containers}") && navPage.includes("containers={containers}") &&
  navPage.includes("Container[]") && appModalCode.includes("containers: Container[]"));
ok("★ 「容器列表」按钮仅在勾选自托管后渲染，且位于图标区之前",
  appModalCode.includes("容器列表") && appModalCode.includes("selfHosted && (") &&
  appModalCode.indexOf("容器列表") < appModalCode.indexOf("<IconAutoComplete"));
ok("★ 选择容器一次填入 4 字段（名称/内网端口/外网 WebUI/按名匹配的图标）",
  appModalCode.includes("setName(c.name)") && appModalCode.includes("setLanUrl(port") &&
  appModalCode.includes("setUrl(c.webuiUrl") && appModalCode.includes("setIcon(iconMap["));
ok("★ 容器列表不再引用容器图标（v1.52.4：统一按项目名匹配图标库）",
  !appModalCode.includes("setIcon(c.icon") && appModalCode.includes("iconMap[c.name.trim().toLowerCase()]"));
ok("★ 保存时图标留空按项目名称自动匹配", appModalCode.includes("icon.trim() || iconMap["));
ok("★ 项目弹窗挂载「从链接下载」图标弹窗",
  appModalCode.includes("<NavIconDownloadModal") && appModalCode.includes("setIconDownloadOpen(true)"));
ok("★ 容器列表包含已停止容器（排序不排除 stopped，且有状态标识）",
  appModalCode.includes('c.status === "running" ? 0 : 1') && appModalCode.includes("已停止"));
ok("★ 图标区仍只有一个 IconAutoComplete（容器按钮不侵入图标区）",
  (appModalCode.match(/<IconAutoComplete/g) || []).length === 1 &&
  !appModalCode.includes("引用 Docker 容器图标"));

const gs = read("src/components/NavGroupSettingsModal.tsx");
ok("★ 分组设置接管分组新建/删除", gs.includes("addGroup") && gs.includes("removeGroup"));
ok("★ 分组设置可新建分组且强制每分区至少一组（v1.52.9 不再允许删到 0 组）",
  gs.includes("新建分组") && gs.includes("draft.every") && gs.includes("z.groups.length > 0"));
ok("★ 分组设置不再引导到管理分组", !gs.includes("请先到「管理分组」"));

const appSrc = read("src/App.tsx");
ok("App 提供 handleSaveNavZones 并透传 NavPage", appSrc.includes("handleSaveNavZones") && appSrc.includes("<NavPage"));
ok("App 导航分组走独立通道（fetchNavGroups/saveNavGroupsApi）", appSrc.includes("fetchNavGroups") && appSrc.includes("saveNavGroupsApi"));
ok("App 不再借道 settings.nav", !appSrc.includes("settings?.nav") && !appSrc.includes("settings?.nav?.groups"));

const navMod = read("server/nav-groups.ts");
ok("导航分区独立持久化模块存在", navMod.includes("getNavGroups") && navMod.includes("saveNavGroups") && navMod.includes("normalizeNavZones"));
ok("独立模块含一次性迁移（migrateFromSettings）", navMod.includes("migrateFromSettings"));
ok("独立模块钳制条目上限（50 组 / 200 应用）", navMod.includes("slice(0, 50)") && navMod.includes("slice(0, 200)"));

const sset = read("server/settings.ts");
ok("main settings 已剥离 nav（不含 nav: { groups）", !sset.includes("nav: { groups:"));
ok("main settings 不再归一化 nav.groups", !sset.includes("normalizeNavGroups(parsed?.nav?.groups)"));

const indexSrc = read("server/index.ts");
ok("服务端注册 GET /api/nav-groups", indexSrc.includes('app.get("/api/nav-groups"'));
ok("服务端注册 PUT /api/nav-groups", indexSrc.includes('app.put("/api/nav-groups"'));

// v1.51.17：导航背景图上传（20MB 上限 + 超限返回 JSON + 前端预校验 / 友好兜底）
const navSettingsModal = read("src/components/NavPageSettingsModal.tsx");
const navApiSrc = read("src/api.ts");
const uploadFn = navApiSrc.split("export async function uploadNavAssetApi")[1]?.split("\n}")[0] || "";
ok("★ 背景图上传上限 20MB（不再复用图标 2mb 限制）",
  indexSrc.includes("const NAV_ASSET_MAX_BYTES = 20 * 1024 * 1024") &&
  indexSrc.includes('express.raw({ type: "image/*", limit: NAV_ASSET_MAX_BYTES })'));
ok("★ 背景图超限返回 JSON 而非 HTML 错误页（局部错误中间件）",
  indexSrc.includes('app.use("/api/nav-assets"') && indexSrc.includes("entity.too.large") &&
  indexSrc.includes("背景图过大，请上传 ≤20MB 的图片"));
ok("★ 背景图写入前校验非空 Buffer", indexSrc.includes("Buffer.isBuffer(body)"));
ok("★ 上传 API 非 JSON 兜底附 HTTP 状态码（不再笼统报响应解析失败）",
  uploadFn.includes("HTTP ${res.status}") && !uploadFn.includes('"响应解析失败"'));
ok("★ 页面设置上传前预校验体积与图片类型",
  navSettingsModal.includes("const NAV_ASSET_MAX_BYTES = 20 * 1024 * 1024") &&
  navSettingsModal.includes("file.size > NAV_ASSET_MAX_BYTES") &&
  navSettingsModal.includes('file.type.startsWith("image/")'));
ok("★ 页面设置显示 ≤20MB 提示且超限给中文错误",
  navSettingsModal.includes("≤20MB") && navSettingsModal.includes("图片过大"));

// v1.51.18：顶栏「编辑」按钮（页面设置左侧）+ 仅编辑态渲染卡片 ✎ 编辑入口，浏览态隐藏
ok("★ NavPage 新增 editMode 状态（默认关闭，刷新回落关闭）", navPage.includes("const [editMode, setEditMode] = useState(false)"));
ok("★ 顶栏「编辑」在「页面设置」左侧且无其它文字按钮（图标条已含 ＋/⚙）",
  topbarActions.includes("编辑") && topbarActions.indexOf("编辑") < topbarActions.indexOf("页面设置") &&
  !topbarActions.includes("管理分组"));
ok("★ editMode 下传给 NavBoard", navPage.includes("editMode={editMode}"));
ok("★ NavBoard 接收 editMode prop", board.includes("editMode?: boolean"));
ok("★ 卡片 ✎ 编辑入口仅在 editMode 渲染且常显（浏览态隐藏，非 hover 才显）",
  board.includes("{editMode && (") &&
  board.includes('title={`编辑「${a.name}」`}') &&
  board.includes("opacity-100") &&
  !board.includes("group-hover/card:opacity-100"));
ok("★ 顶栏「＋添加项目」「⚙分区设置」不随 editMode 收起（始终可用）",
  topbarActions.includes("openAddApp(defaultAddGroupId() || \"\")") &&
  topbarActions.includes("openGroupSettings(undefined, isAll ? undefined : effectiveTab)"));

const typesSrc = read("src/types.ts");
ok("类型 NavZone/NavGroup/NavAppItem/NavConfig 已定义", typesSrc.includes("interface NavZone") && typesSrc.includes("interface NavGroup") && typesSrc.includes("interface NavAppItem") && typesSrc.includes("NavConfig"));
ok("SystemSettings 已移除 nav 字段", !typesSrc.includes("nav: NavConfig"));

// v1.52.0：分区 → 分组 → 卡片三级结构
ok("★ NavPage 分区角标 = 分区下应用总数", navPage.includes("reduce((s, g) => s + (g.apps?.length || 0), 0)"));
ok("★ 选中分区高亮放大（字号 ~1.5 倍 + 轻微 scale）", navPage.includes("text-[18px]") && navPage.includes("scale-[1.04]"));
ok("★ 「全部」标签合并所有分区", navPage.includes('"__all__"') && navPage.includes("显示全部分区的分组"));
ok("★ NavBoard 支持 zoneTag（全部视图标注所属分区）", board.includes("zoneTag") && navPage.includes("zoneTag={isAll ? zone.name : undefined}"));
ok("★ 分区下内联「添加分组」入口", navPage.includes("addGroupToZone") && navPage.includes("添加分组"));
ok("★ 分组设置弹窗升级为分区+分组管理（新建/删除分区）", gs.includes("addZone") && gs.includes("removeZone") && gs.includes("新建分区"));
ok("★ 服务端分区持久化：落盘 { zones } + 旧 {groups} 包裹默认分区迁移", navMod.includes("{ zones }") && navMod.includes("wrapLegacyAsZone") && navMod.includes("默认分区"));

// v1.52.9：自动默认分组 / 分区至少一组（保留）；v1.52.10：恢复跨分区拖放
ok("★ 新建分区自动创建一个与分区同名的默认分组（设置弹窗）",
  gs.includes("const name = `分区 ${draft.length + 1}`;") &&
  gs.includes("groups: [{ id: genId(), name, apps: [] }]"));
ok("★ 设置弹窗打开时为空组分区补齐同名默认分组",
  gs.includes("if (groups.length === 0) groups.push({ id: genId(), name: z.name, apps: [] });"));
ok("★ 分区改名时同名默认分组跟随（手动改过名的分组不受影响）",
  gs.includes("g.name === z.name ? { ...g, name } : g"));
ok("★ 分区下至少保留一个分组：删除按钮禁用 + removeGroup 兜底 + 保存校验",
  gs.includes("if (activeZone.groups.length <= 1) return;") &&
  gs.includes("disabled={activeZone.groups.length <= 1}") &&
  gs.includes("z.groups.length > 0") && gs.includes("分区下至少保留一个分组"));
ok("★ 服务端归一化兜底：空组分区自动补同名默认分组",
  navMod.includes('groups.push({ id: genId(), name, icon: "", apps: [] });'));
ok("★ 项目拖放不再限制同分区（全局剥离 + 按目标 groupId 插入）",
  !navPage.includes("fromZone.id !== toZone.id") &&
  !navPage.includes("const zoneOfApp = zones.find") &&
  navPage.includes("const next = stripped.map(") &&
  navPage.includes("onSaveNavZones(next);"));
ok("★ 分区标签恢复为跨分区放置目标（松手落到该分区首分组 + 拖拽高亮）",
  navPage.includes("onDragOver={editMode ? (e) => e.preventDefault() : undefined}") &&
  navPage.includes("if (firstGroup) moveApp(drag.appId, drag.fromGroupId, firstGroup.id);") &&
  navPage.includes('${dragActive ? "ring-2 ring-fuchsia-400/70" : ""}'));
ok("★ dragActive 全分区下传、dragZoneId 零残留（「全部」视图可跨分区落点）",
  !navPage.includes("dragZoneId") &&
  (navPage.match(/dragActive=\{dragActive\}/g) || []).length === 1);

// v1.52.4：分区级间距 / 分区与分组移动 / 导航页专属图标库（含链接下载）
const navIconsMod = read("server/nav-icons.ts");
const navIconDlModal = read("src/components/NavIconDownloadModal.tsx");
ok("★ NavZone 新增 3 个分区级间距字段",
  ["zoneFirstGroupGap", "groupCardGapTop", "groupCardGapBottom"].every((k) => typesSrc.includes(k)));
ok("★ 服务端归一化钳制 3 个间距（0–120 + 默认 20/20/32）",
  ["zoneFirstGroupGap", "groupCardGapTop", "groupCardGapBottom"].every((k) => navMod.includes(k)) &&
  navMod.includes("groupCardGapBottom: num(z?.groupCardGapBottom, 0, 120, 32)"));
ok("★ NavBoard 按分区级间距渲染首组/标题/组间距离",
  board.includes("firstGap") && board.includes("titleGap") && board.includes("bottomGap") &&
  board.includes("isFirstGroup ? firstGap : 0"));
ok("★ NavPage 下传 firstInZone 与 iconMap（容器层不再叠固定 space-y-8）",
  navPage.includes("firstInZone") && navPage.includes("isFirstGroup={firstInZone}") &&
  navPage.includes("iconMap={navIconMap}") && !navPage.includes("space-y-8"));
ok("★ 分区设置支持上移/下移分区与分组",
  gs.includes("const moveZone =") && gs.includes("const moveGroup =") &&
  gs.includes("ArrowUp") && gs.includes("ArrowDown"));
ok("★ 分区设置右侧配置区含 3 个间距滑块",
  ["首组距分区", "标题→卡片", "卡片→下组"].every((k) => gs.includes(k)));
ok("★ 分区设置已移除标题栏右侧「新建分区」按钮",
  (() => {
    const header = gs.split('分区与分组设置</h3>')[1]?.split("</div>")[0] || "";
    return !!header && !header.includes("新建分区");
  })());
ok("★ 卡片图标按项目名称优先查库（用户显式 URL 仍最高优先）",
  board.includes("resolveNavIconSrc(app.icon, iconMap, app.name)") &&
  board.includes("map[String(appName).trim().toLowerCase()]"));
ok("★ 图标映射合并导航专属库（同名优先）与 Docker 库（兜底）",
  board.includes("listNavIconsApi") && board.includes("...(custom?.map || {}), ...(nav?.map || {})"));
ok("★ IconAutoComplete 下拉并入导航专属图标库",
  iconAuto.includes("listNavIconsApi") && iconAuto.includes("(nav?.entries || []).forEach"));
ok("★ 服务端注册导航专属图标库 4 条路由",
  ['app.get("/api/nav-icons"', 'app.post("/api/nav-icons/bind"',
   'app.post("/api/nav-icons/download"', 'app.get("/api/nav-icons/:file"'].every((k) => indexSrc.includes(k)));
ok("★ 导航图标库独立配置文件（不借道 settings.json）",
  navIconsMod.includes('configPath("nav-icons.json")') && !navIconsMod.includes("getSettings()"));
ok("★ 下载 API 有 SSRF / 类型 / 体积 / 重定向 / 目录越界防护",
  ["assertSafeIconUrl", 'redirect: "manual"', "NAV_ICON_MAX_BYTES", "image/", "realpathSync"].every((k) => navIconsMod.includes(k)));
ok("★ 前端暴露导航图标库 3 个 API",
  ["listNavIconsApi", "bindNavIconDirApi", "downloadNavIconApi"].every((k) => navApiSrc.includes(k)));
ok("★ 下载弹窗未绑定时先绑定目录，成功可回填项目图标",
  ["检测并绑定", "bindNavIconDirApi", "downloadNavIconApi", "onDownloaded", "请先在上方绑定图标库目录"].every((k) => navIconDlModal.includes(k)));

// v1.52.5：卡片墙换行 / 实时预览事务链 / 天气与图标形状全部平铺
ok("★ 卡片墙自动换行且无横向滚动条（含水平布局）",
  board.includes('className="flex flex-wrap items-start"') &&
  !board.includes("overflow-x-auto") && !board.includes("snap-x") && !board.includes("snap-start"));
ok("★ 分区设置草稿实时上抛预览，保存提交 / 取消撤销恢复",
  gs.includes("onPreview: (zones: NavZone[] | null) => void") &&
  gs.includes("onPreview(draft)") && gs.includes("if (!committed.current) onPreview(null)") &&
  gs.includes("committed.current = true"));
ok("★ NavPage 渲染链走 renderZones、写操作仍走真实 zones",
  navPage.includes("const renderZones = previewZones ?? zones") &&
  navPage.includes("renderZones.flatMap") && navPage.includes("renderZones.map((z) => {") &&
  navPage.includes("onPreview={handlePreviewZones}") &&
  navPage.includes("onSaveNavZones(next)") &&
  navPage.includes("useEffect(() => { setPreviewZones(null); }, [navZones])"));
ok("★ 保存后由落盘数据撤销预览 + 请求挂起兜底回落",
  navPage.includes("setTimeout(() => setPreviewZones(null), 4000)") &&
  navPage.includes("if (previewZones === null || groupSettings.open) return;"));
// v1.52.6：移除弹窗内示意卡小样，改为标题栏可拖动 + 背景页实时渲染观察
ok("★ 弹窗内实时预览小样零残留（示意卡与预览区块均已移除）",
  !gs.includes("实时预览（未保存）") && !gs.includes("PREVIEW_APPS") &&
  !gs.includes('import { AppCard } from "./NavBoard"'));
ok("★ NavBoard 的 AppCard 不再导出（唯一外部消费方已删）",
  !board.includes("export function AppCard(") && board.includes("function AppCard({"));
ok("★ 分区设置弹窗标题栏可拖动（pointer + transform 偏移 + 视口边界 clamp）",
  ["onDragHandlePointerDown", "onPointerDown={onDragHandlePointerDown}", "pointermove",
   "pointerup", "dragOffset", "transform: `translate(", "cursor-grab",
   "Math.max(0, (window.innerWidth - d.w) / 2 + 80)"].every((k) => gs.includes(k)));
ok("★ 拖动后遮罩不会误关闭（取消 / 恢复不被打断）",
  gs.includes("if (dragMovedRef.current) { dragMovedRef.current = false; return; }"));
ok("★ 图标形状 10 项全部平铺（不再用下拉框）",
  gs.includes("options={ICON_SHAPE_OPTIONS}") && !gs.includes("<select") && !gs.includes('className={inputCls}'));
ok("★ 环境天气 5 项全部平铺（不再用下拉框）",
  navSettingsModal.includes("options={WEATHER_OPTIONS}") &&
  navSettingsModal.includes('value={draft.weather || "none"}') &&
  !navSettingsModal.includes("<select") && navSettingsModal.includes("flex flex-wrap gap-1.5"));

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

console.log("== ④ 负向自检（进程级注入 40 类回归 → 重跑本门禁应 exit 1） ==");
// 父进程注入 40 类回归文本，子进程跳过 ④（NAV_GATE_NEGATIVE_CHILD=1）只跑 ①②③，
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
      name: "注入齿轮定位当前分区缺失回归",
      inject: (s) => s.replace("initialZoneId={groupSettings.initialZoneId}", ""),
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
    {
      name: "注入容器列表接线缺失回归",
      inject: (s) => s.replace("containers={containers}", ""),
    },
    {
      name: "注入容器四字段映射缺失回归",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s.replace("setName(c.name)", "setName(name)"),
    },
    {
      name: "注入背景图上限回退 2mb 回归",
      rel: "server/index.ts",
      inject: (s) => s.replace("limit: NAV_ASSET_MAX_BYTES", 'limit: "2mb"'),
    },
    {
      name: "注入超限 HTML 错误页回归（删除局部错误中间件）",
      rel: "server/index.ts",
      inject: (s) => s.replace('app.use("/api/nav-assets"', 'app.use("/api/nav-assets-disabled"'),
    },
    {
      name: "注入上传兜底文案回退回归",
      rel: "src/api.ts",
      inject: (s) => s.replace("背景图上传失败（HTTP ${res.status}，服务端未返回 JSON）", "响应解析失败"),
    },
    {
      name: "注入前端体积预校验缺失回归",
      rel: "src/components/NavPageSettingsModal.tsx",
      inject: (s) => s.replace("if (file.size > NAV_ASSET_MAX_BYTES) {", "if (false) {"),
    },
    {
      name: "注入编辑按钮缺失回归（移除 editMode 下传）",
      inject: (s) => s.replace("editMode={editMode}", ""),
    },
    {
      name: "注入 NavBoard 不接收 editMode prop 回归",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace("editMode?: boolean;", "editModeProp?: boolean;"),
    },
    {
      name: "注入卡片 ✎ 非编辑态即可见回归（移除 editMode 门控）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace("{editMode && (", ""),
    },
    {
      name: "注入容器图标回归（重新引用 c.icon）",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s.replace('setIcon(iconMap[c.name.trim().toLowerCase()] || "");', 'setIcon(c.icon || "");'),
    },
    {
      name: "注入分区间距字段缺失回归",
      rel: "server/nav-groups.ts",
      inject: (s) => s.replace("zoneFirstGroupGap: num(z?.zoneFirstGroupGap, 0, 120, 20),", ""),
    },
    {
      name: "注入导航图标库路由缺失回归",
      rel: "server/index.ts",
      inject: (s) => s.replace('app.get("/api/nav-icons"', 'app.get("/api/nav-icons-disabled"'),
    },
    {
      name: "注入分区/分组移动缺失回归",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("const moveZone = (", "const moveZoneRemoved = ("),
    },
    {
      name: "注入卡片墙横向滚动回归（撤回自动换行）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace('className="flex flex-wrap items-start"', 'className="flex gap-3 overflow-x-auto snap-x"'),
    },
    {
      name: "注入预览事务标志缺失回归（保存被误判为取消）",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("committed.current = true;", ""),
    },
    {
      name: "注入渲染链不走预览草稿回归",
      inject: (s) => s.replace("renderZones.flatMap", "zones.flatMap"),
    },
    {
      name: "注入天气选项错配回归（不再全部平铺）",
      rel: "src/components/NavPageSettingsModal.tsx",
      inject: (s) => s.replace("options={WEATHER_OPTIONS}", "options={NETWORK_OPTIONS}"),
    },
    {
      name: "注入图标形状选项错配回归（不再全部平铺）",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("options={ICON_SHAPE_OPTIONS}", "options={CARD_STYLE_OPTIONS}"),
    },
    {
      name: "注入弹窗拖动缺失回归（标题栏不可拖）",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("onPointerDown={onDragHandlePointerDown}", ""),
    },
    {
      name: "注入弹窗内实时预览小样回归（重新引入预览区块）",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("function genId(): string {", 'const PREVIEW_MARKER = "实时预览（未保存）";\nfunction genId(): string {'),
    },
    {
      name: "注入项目归属两级缺失回归（分组下拉退回全部分区扁平列表）",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s.replace("zoneGroups.map((g) => (", "groups.map((g) => ("),
    },
    {
      name: "注入切换分区不回落分组回归（跨分区残留旧 groupId）",
      rel: "src/components/NavAppModal.tsx",
      inject: (s) => s.replace('setGroupId(z?.groups?.[0]?.id || "");', ""),
    },
    {
      name: "注入空分组拖放缺失回归（容器不再追加到末尾）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace('onCardDrop?.("", group.id)', 'onCardDrop?.("__no_append__", group.id)'),
    },
    {
      name: "注入卡片落点冒泡重复搬移回归（缺 stopPropagation）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace("e.stopPropagation(); onCardDrop?.(a.id, cardGroupId);", "onCardDrop?.(a.id, cardGroupId);"),
    },
    // v1.52.9：自动默认分组 / 至少一组（保留）；v1.52.10：跨分区拖放（负向 = 重新引入封锁 / 移除落点）
    {
      name: "注入新建分区不带默认分组回归",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("groups: [{ id: genId(), name, apps: [] }]", "groups: []"),
    },
    {
      name: "注入服务层空组兜底缺失回归",
      rel: "server/nav-groups.ts",
      inject: (s) => s.replace('groups.push({ id: genId(), name, icon: "", apps: [] });', ""),
    },
    {
      name: "注入允许删最后一个分组回归",
      rel: "src/components/NavGroupSettingsModal.tsx",
      inject: (s) => s.replace("if (activeZone.groups.length <= 1) return;", ""),
    },
    {
      name: "注入同分区硬校验回归（跨分区又被拒绝）",
      rel: "src/pages/NavPage.tsx",
      inject: (s) => s.replace(
        "  const moveApp = (appId: string, fromGroupId: string, toGroupId: string, beforeAppId?: string) => {",
        "  const moveApp = (appId: string, fromGroupId: string, toGroupId: string, beforeAppId?: string) => {\n    if (!fromZone || !toZone || fromZone.id !== toZone.id) return;"),
    },
    {
      name: "注入分区标签 drop 缺失回归（无法拖到其他分区）",
      rel: "src/pages/NavPage.tsx",
      inject: (s) => s.replace("if (firstGroup) moveApp(drag.appId, drag.fromGroupId, firstGroup.id);", ""),
    },
    {
      name: "注入 dragActive 按来源分区裁剪回归（跨分区卡片墙不接管）",
      rel: "src/pages/NavPage.tsx",
      inject: (s) => s.replace("dragActive={dragActive}", "dragActive={dragActive && zone.id === dragZoneId}"),
    },
    {
      name: "注入卡片落点不响应拖拽回归（非拖拽态也接管放置）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace("onDragOver={dragActive ? (e) => e.preventDefault() : undefined}", "onDragOver={(e) => e.preventDefault()}"),
    },
    // v1.52.11：空分组占位 ＋ 图标 / 引导文案
    {
      name: "注入空分组 ＋ 图标回归（重新显示占位图标）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace(
        '{dragActive && <p className="text-sm">松手放到该分组</p>}',
        '<PlusIcon className="mb-2 opacity-80" />\n          {dragActive && <p className="text-sm">松手放到该分组</p>}'),
    },
    {
      name: "注入空分组常态虚线回归（恢复 border-transparent 占位框）",
      rel: "src/components/NavBoard.tsx",
      inject: (s) => s.replace(': "py-2"', ': "py-10 border-2 border-dashed border-transparent text-white/85"'),
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
