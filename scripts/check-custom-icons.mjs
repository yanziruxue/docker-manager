/**
 * 自定义图标库目录门禁（v1.50.32）。
 *
 * 用**真实临时目录** + esbuild 编译后的真实模块，断言：
 *   ① 格式优先级 png > jpg/jpeg > ico > 其他（同名多格式只保留最优）；
 *   ② 目录校验：相对路径 / .. / 不存在 / 非目录 一律拒绝，留空 = 未绑定；
 *   ③ 文件枚举：只认普通文件 + 白名单扩展 + 2MB 以内，子目录与非图标文件排除；
 *   ④ 取图防穿越：.. / 子目录 / 非法扩展 / 不存在 / 未绑定 一律拒绝；
 *   ⑤ 名称自动匹配：compose 默认命名派生服务名、大小写不敏感、手工图标不被覆盖；
 *   ⑥ 源码接线：服务端三路由、设置持久化、App 装配、设置卡片、图库下拉合并。
 *
 * 运行：node scripts/check-custom-icons.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const server = await loadModule("server/custom-icons.ts", "node");
const client = await loadModule("src/custom-icons.ts", "neutral");
const {
  CUSTOM_ICON_MAX_BYTES,
  customIconExtRank,
  resolveCustomIconDir,
  listCustomIconEntries,
  buildCustomIconMap,
  resolveCustomIconFile,
} = server;
const { shouldAutoFillIcon, iconNameCandidates, pickCustomIcon } = client;

/* ---------- 真实临时图标目录 ---------- */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dmgr-custom-icons-"));
const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
for (const name of ["server.png", "server.jpg", "server.ico", "server.svg", "redis.webp", "notes.txt"]) {
  fs.writeFileSync(path.join(tmp, name), png);
}
fs.mkdirSync(path.join(tmp, "subdir"));
fs.writeFileSync(path.join(tmp, "subdir", "evil.png"), png);
fs.writeFileSync(path.join(tmp, "big.png"), Buffer.alloc(CUSTOM_ICON_MAX_BYTES + 1));

console.log("══ ① 格式优先级 png > jpg > ico > 其他 ══");
check("png 排名 0", customIconExtRank(".png"), 0);
check("jpg 排名 1", customIconExtRank(".jpg"), 1);
check("jpeg 排名 1", customIconExtRank(".jpeg"), 1);
check("ico 排名 2", customIconExtRank(".ico"), 2);
check("svg 排名 3（其他）", customIconExtRank(".svg"), 3);
check("webp 排名 3（其他）", customIconExtRank(".webp"), 3);
const entries = listCustomIconEntries(tmp);
const serverOrder = entries.filter((e) => e.stem === "server").map((e) => e.ext);
check("server.* 枚举顺序", serverOrder, [".png", ".jpg", ".ico", ".svg"]);
ok("非图标文件 notes.txt 被排除", !entries.some((e) => e.name === "notes.txt"));
ok("子目录 subdir/evil.png 被排除", !entries.some((e) => e.name === "evil.png"));
ok("超过 2MB 的 big.png 被排除", !entries.some((e) => e.name === "big.png"));
const map = buildCustomIconMap(entries);
check("同名映射选中 server.png", map.server, "/api/custom-icons/server.png");
check("单一格式 redis.webp 命中", map.redis, "/api/custom-icons/redis.webp");
check("映射键数量（server + redis）", Object.keys(map).length, 2);
ok("URL 均走同源 /api/custom-icons/", Object.values(map).every((u) => u.startsWith("/api/custom-icons/")));

console.log("══ ② 目录校验 ══");
check("留空 = 未绑定（合法）", resolveCustomIconDir(""), { dir: "", error: "" });
ok("相对路径被拒", resolveCustomIconDir("relative/icons").error.includes("绝对路径"));
// 字符串拼接保留字面 ".."（path.join 会把它规范化掉，测不到校验分支）
ok("含 .. 的路径被拒", resolveCustomIconDir(tmp + path.sep + ".." + path.sep + "etc").error.includes(".."));
ok("不存在的目录被拒", resolveCustomIconDir(path.join(tmp, "no-such-dir")).error.includes("目录不可读"));
ok("文件（非目录）被拒", resolveCustomIconDir(path.join(tmp, "server.png")).error.includes("不是目录"));
const resolved = resolveCustomIconDir(tmp);
check("真实目录解析无错误", resolved.error, "");
check("返回 realpath 绝对路径", path.isAbsolute(resolved.dir) && fs.realpathSync(resolved.dir).toLowerCase() === fs.realpathSync(tmp).toLowerCase(), true);

console.log("══ ③ 取图防穿越 ══");
const okFile = resolveCustomIconFile(resolved.dir, "server.png");
ok("正常文件可读取", !!okFile.file && fs.existsSync(okFile.file));
ok(".. 路径被拒", !!resolveCustomIconFile(resolved.dir, "../secret.png").error);
ok("子目录路径被拒", !!resolveCustomIconFile(resolved.dir, "subdir/evil.png").error);
ok("非白名单扩展被拒", !!resolveCustomIconFile(resolved.dir, "notes.txt").error);
ok("不存在的文件被拒", !!resolveCustomIconFile(resolved.dir, "nope.png").error);
ok("超大文件被拒", !!resolveCustomIconFile(resolved.dir, "big.png").error);
ok("未绑定目录时拒绝", resolveCustomIconFile("", "server.png").error.includes("未绑定"));
// 符号链接越界（Windows 无权限创建时跳过，不判失败）
try {
  const outside = path.join(os.tmpdir(), "dmgr-outside-icon.png");
  fs.writeFileSync(outside, png);
  fs.symlinkSync(outside, path.join(tmp, "link.png"));
  ok("符号链接指向目录外被拒", !!resolveCustomIconFile(resolved.dir, "link.png").error);
  fs.unlinkSync(outside);
} catch {
  console.log("  SKIP  符号链接越界（当前系统无创建权限）");
}

console.log("══ ④ 名称自动匹配与覆盖规则 ══");
check("空图标可自动填充", shouldAutoFillIcon(""), true);
check("icon.* 原图库自动回退可被自定义覆盖", shouldAutoFillIcon("/api/stack-icons/mystack"), true);
check("手工图库选择保留", shouldAutoFillIcon("/api/stack-icons/mystack/a.png"), false);
check("外链图标保留", shouldAutoFillIcon("https://example.com/a.png"), false);
check("内嵌 SVG 图标保留", shouldAutoFillIcon("data:image/svg+xml;base64,PHN2Zz4="), false);
check("自定义目录图标保留", shouldAutoFillIcon("/api/custom-icons/server.png"), false);
ok("compose 默认命名派生服务名 server", iconNameCandidates("mystack-server-1", "mystack").includes("server"));
ok("compose v1 下划线命名派生 server", iconNameCandidates("mystack_server_1").includes("server"));
ok("container_name=server 直接命中", iconNameCandidates("server").includes("server"));
ok("大小写归一化", iconNameCandidates("Server").includes("server"));
check("候选按优先级查表", pickCustomIcon({ server: "/api/custom-icons/server.png" }, iconNameCandidates("mystack-server-1", "mystack")), "/api/custom-icons/server.png");
check("大小写不敏感查表", pickCustomIcon({ server: "u" }, ["SERVER"]), "u");
check("空映射返回空串（回落原方案）", pickCustomIcon({}, iconNameCandidates("server")), "");
check("未定义映射返回空串", pickCustomIcon(undefined, ["server"]), "");

console.log("══ ⑤ 源码接线 ══");
const indexSrc = read("server/index.ts");
ok("服务端 GET /api/custom-icons 已注册", indexSrc.includes('app.get("/api/custom-icons"'));
ok("服务端 POST /api/custom-icons/check 已注册", indexSrc.includes('app.post("/api/custom-icons/check"'));
ok("服务端 GET /api/custom-icons/:file 已注册", indexSrc.includes('app.get("/api/custom-icons/:file"'));
ok("取图路由调用真实路径校验", indexSrc.includes("resolveCustomIconFile(dir, req.params.file)"));
ok("materializeLocalIcon 白名单含自定义图标引用", indexSrc.includes('url.startsWith("/api/custom-icons/")'));
ok("服务端默认 iconDir 为空", read("server/settings.ts").includes('iconDir: ""'));
ok("前端类型声明 iconDir", read("src/types.ts").includes("iconDir?: string"));
const apiSrc = read("src/api.ts");
ok("api.ts 暴露 listCustomIconsApi", apiSrc.includes("export function listCustomIconsApi"));
ok("api.ts 暴露 checkCustomIconDirApi", apiSrc.includes("export function checkCustomIconDirApi"));
const appSrc = read("src/App.tsx");
ok("App 装配层拉取图标映射", appSrc.includes("listCustomIconsApi().catch(() => EMPTY_CUSTOM_ICONS)"));
ok("App 装配层调用 shouldAutoFillIcon", appSrc.includes("shouldAutoFillIcon(st.icon)"));
ok("App 装配层调用 iconNameCandidates", appSrc.includes("iconNameCandidates(c.name"));
ok("App 装配层调用 pickCustomIcon", appSrc.includes("pickCustomIcon(customIconMap, candidates)"));
ok("设置保存后立即刷新数据", appSrc.includes("if (activeEngineId) void loadEngineData(activeEngineId)"));
const settingsSrc = read("src/pages/Settings.tsx");
ok("页面设置新增图标库目录卡片", settingsSrc.includes('title="图标库目录"'));
ok("卡片写入 modal.iconDir", settingsSrc.includes('update("modal", "iconDir", v)'));
ok("卡片调用检测接口", settingsSrc.includes("checkCustomIconDirApi("));
const stacksSrc = read("src/pages/Stacks.tsx");
ok("图库下拉拉取自定义目录", stacksSrc.includes("listCustomIconsApi().catch(() => null)"));
ok("图库下拉分组：共享图标库", stacksSrc.includes("共享图标库"));
ok("图库下拉分组：本堆栈图库", stacksSrc.includes("本堆栈图库"));
const pkg = JSON.parse(read("package.json"));
// 语义比较「不低于引入版」：避免后续升版本时硬编码断言假红
const verCmp = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};
ok(`版本号不低于 1.50.32（当前 ${pkg.version}）`, verCmp(pkg.version, "1.50.32") >= 0);
ok("门禁已接入 test:gates", (pkg.scripts["test:gates"] || "").includes("test:customicons"));

await fs.promises.rm(tmp, { recursive: true, force: true });
console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
