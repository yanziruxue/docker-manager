/**
 * 新建堆栈后自动打开「编辑堆栈」弹窗的数据类型门禁（v1.50.31）。
 *
 * 事故：fetchEngineStacks() 返回的是后端【原始】数组，后端 settings 里没有 name 等
 * 前端字段；旧代码直接 setEditStack(raw)，StackEditorModal 渲染期执行
 * settings.name.length → TypeError → 整页白屏。normal 列表走 App.tsx 的 transformStacks
 * 会补齐 settings.name，只有「新建后自动打开」这条路径绕过了转换层。
 *
 * 断言：
 *   ① handleStackCreated 必须把 fetchEngineStacks 的结果交给 transformStacks；
 *   ② StackEditorModal 初始化对 settings / webuiLabels / composeContent 做了兜底；
 *   ③ 真实 transformStacks 编译后跑一遍模拟后端 raw，settings.name 可用；
 *   ④ 负向证据：未经转换的 raw 直接访问 settings.name.length 必然抛错。
 *
 * 运行：node scripts/check-stack-create.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let pass = 0;
let fail = 0;
function eq(name, actual, expected) {
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
  eq(name, !!cond, true);
}

const src = fs.readFileSync(path.join(ROOT, "src", "pages", "Stacks.tsx"), "utf-8");
const xfSrc = fs.readFileSync(path.join(ROOT, "src", "transforms.ts"), "utf-8");

/* ---------- ① 源码接线：只取 handleStackCreated 函数体 ---------- */
const start = src.indexOf("const handleStackCreated");
const end = src.indexOf("const [logStack", start);
const body = start >= 0 && end > start ? src.slice(start, end) : "";

ok("handleStackCreated 函数体可定位", body.length > 0);
ok("从 transforms 引入 transformStacks", /import\s*\{[^}]*transformStacks[^}]*\}\s*from\s*"\.\.\/transforms"/.test(src));
ok("fetchEngineStacks 结果经 transformStacks 转换", /transformStacks\(\s*await\s+fetchEngineStacks\(engineId\)\s*\)/.test(body));
ok("setEditStack 使用转换后 list.find 的结果", /const\s+created\s*=\s*list\.find\(/.test(body) && /setEditStack\(created\)/.test(body));
ok("不存在把 raw 直接塞进 setEditStack 的回退写法", !/setEditStack\(\s*(list\.find|raw\b|await)/.test(body));

/* ---------- ② StackEditorModal 渲染期兜底 ---------- */
ok("settings 初始化为完整 StackSettings 对象", src.includes("useState<StackSettings>(() => ({"));
ok("settings.name 有 stack.name 兜底", src.includes('name: stack.settings?.name || stack.name || ""'));
ok("settings.tags 有空数组兜底", src.includes("tags: stack.settings?.tags || []"));
ok("webuiLabels 有数组类型兜底", src.includes("Array.isArray(stack.webuiLabels) ? stack.webuiLabels : []"));
ok("composeContent 有空值兜底", src.includes('useState(stack.composeContent ?? "")'));
ok("envContent 有空值兜底", src.includes('useState(stack.envContent ?? "")'));
ok("transformStacks 会补齐 settings.name", xfSrc.includes('name: s.name || ""'));

/* ---------- ③ 真实转换函数行为验证 ---------- */
const built = await esbuild.build({
  entryPoints: [path.join(ROOT, "src", "transforms.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "node20",
});
const { transformStacks } = await import(
  "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64")
);

/** 仿 server/docker.ts getStacks 对「刚创建、未启动」堆栈的返回：settings 里没有 name */
const raw = {
  id: "demo",
  name: "demo",
  description: "",
  status: "stopped",
  totalContainers: 0,
  runningContainers: 0,
  composeFilePath: "/stacks/demo/docker-compose.yaml",
  composeContent: "services:\n  web:\n    image: nginx\n",
  envContent: "",
  webuiLabels: [],
  containers: [],
  settings: { autoStart: false, forceRecreate: false, timeout: 60, autoUpdate: false },
  tags: [],
};
const st = transformStacks([raw])[0];
eq("转换后 settings.name = 堆栈名", st.settings.name, "demo");
eq("转换后 composeContent 原样保留", st.composeContent, raw.composeContent);
eq("转换后 webuiLabels 为数组", Array.isArray(st.webuiLabels), true);
ok("转换后 settings.name.length 不再抛错", (() => {
  try { return st.settings.name.length > 0; } catch { return false; }
})());

/* ---------- ④ 负向证据：证明这道门禁确实拦得住回归 ---------- */
ok("未经转换的 raw 访问 settings.name.length 必然抛错", (() => {
  try { return raw.settings.name.length > 0; } catch { return true; }
})());

console.log(`结果: PASS=${pass} FAIL=${fail}`);
if (fail) process.exit(1);
