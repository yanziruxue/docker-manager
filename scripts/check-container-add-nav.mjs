/**
 * 「容器右键 → 添加到导航页」门禁（v1.53.7）。
 *
 * 覆盖：
 *   ① 真实执行 src/nav-from-container.ts（esbuild data URL）：端口派生、`:端口` 内网简写、
 *      外网 URL、自托管卡片字段、图标留空、ID 唯一；
 *   ② 源码接线：右键菜单「添加到导航页」位于「详情」上方且仅导航页启用时出现、
 *      App 真实落盘回调（/api/nav-groups）、弹窗两级分区/分组与防误关 + 共享 Esc；
 *   ③ 进程级负向自检（3 类注入 → 子进程 exit 1 → 还原字节级一致）。
 *
 * 运行：node scripts/check-container-add-nav.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import esbuild from "esbuild";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const IS_CHILD = process.env.CONTAINER_ADD_NAV_GATE_NEGATIVE_CHILD === "1";

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}`);
  }
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(`${name} → ${a.length > 120 ? a.slice(0, 120) + "…" : a}`, a === e);
}

/** 编译真实 TS 模块（纯函数、无临时产物，data URL 直接 import） */
async function loadModule(rel) {
  const built = await esbuild.build({
    entryPoints: [path.join(ROOT, rel)],
    bundle: true,
    write: false,
    platform: "neutral",
    format: "esm",
    target: "node20",
  });
  return import("data:text/javascript;base64," + Buffer.from(built.outputFiles[0].text).toString("base64"));
}

const mod = await loadModule("src/nav-from-container.ts");
const { genNavAppId, deriveContainerWebuiPort, defaultNavFieldsFromContainer, buildNavAppFromContainer } = mod;
const containersSrc = read("src/pages/Containers.tsx");
const appSrc = read("src/App.tsx");
const modalSrc = read("src/components/AddToNavModal.tsx");
const pureSrc = read("src/nav-from-container.ts");
const pkg = JSON.parse(read("package.json"));

console.log("== ① 真实模块执行（容器 → 导航卡片派生） ==");

const base = { id: "c1", name: "beszel", image: "henrygd/beszel:latest", status: "running", ports: [], volumes: [], ip: "", uptime: "", autoStart: true, restartPolicy: "always", networkMode: "bridge", createdAt: "" };
eq("端口优先 LABELS webuiPort", deriveContainerWebuiPort({ ...base, webuiPort: "8090", ports: [{ host: 3000 }] }), "8090");
eq("无 LABELS 端口 → 回退宿主端口", deriveContainerWebuiPort({ ...base, ports: [{ host: 3000 }] }), "3000");
eq("无端口 → 空串", deriveContainerWebuiPort(base), "");
eq("预填：名称 / :端口 / 外网 URL", defaultNavFieldsFromContainer({ ...base, webuiPort: "8090", webuiUrl: "https://beszel.example.com" }), {
  name: "beszel", lanUrl: ":8090", url: "https://beszel.example.com",
});
eq("无外网 URL 时留空", defaultNavFieldsFromContainer({ ...base, webuiPort: "8090" }).url, "");

const built = buildNavAppFromContainer({ ...base, description: "监控面板" }, {
  id: "fixed-id", name: "  Beszel  ", lanUrl: " :8090 ", url: " https://beszel.example.com ",
});
eq("卡片 ID 可由调用方固定", built.id, "fixed-id");
eq("名称去空白", built.name, "Beszel");
eq("内网链接去空白", built.lanUrl, ":8090");
eq("外网链接去空白", built.url, "https://beszel.example.com");
eq("一律按自托管保存", built.kind, "self");
eq("图标留空由名称自动匹配", built.icon, "");
eq("备用地址为空数组", [built.urlBackups, built.lanBackups], [[], []]);
eq("描述透传容器 LABELS", built.description, "监控面板");
eq("公开/缩放默认值", [built.isPublic, built.iconZoom], [false, 100]);
ok("默认生成的卡片 ID 格式正确", /^n[0-9a-z]+$/.test(buildNavAppFromContainer(base, defaultNavFieldsFromContainer(base)).id));
ok("卡片 ID 不重复", genNavAppId() !== genNavAppId());

console.log("\n== ② 源码接线 ==");
ok("容器页导入 AddToNavModal", /import \{ AddToNavModal \} from "\.\.\/components\/AddToNavModal"/.test(containersSrc));
ok("容器页 Props 含 navEnabled / navZones / onAddToNav", /navEnabled\?: boolean/.test(containersSrc) && /navZones\?: NavZone\[\]/.test(containersSrc) && /onAddToNav\?: \(groupId: string, app: NavAppItem\) => Promise<void>/.test(containersSrc));
ok("右键菜单含「添加到导航页」", /label: "添加到导航页"/.test(containersSrc));
ok("右键菜单含「详情」", /label: "详情"/.test(containersSrc));
ok("★「添加到导航页」位于「详情」上方", containersSrc.indexOf('label: "添加到导航页"') < containersSrc.indexOf('label: "详情"'));
ok("★ 仅导航页启用时才渲染该入口", /\.\.\.\(navEnabled && onAddToNav/.test(containersSrc));
ok("点击后按 id 取最新容器对象", /setAddToNavContainer\(target\)/.test(containersSrc));
ok("弹窗挂载并接线", /<AddToNavModal/.test(containersSrc) && /zones=\{navZones\}/.test(containersSrc) && /onSave=\{onAddToNav\}/.test(containersSrc));
ok("App 定义落盘回调", /const handleAddContainerToNav = useCallback\(/.test(appSrc) && /Promise<void>/.test(appSrc));
ok("App 回调走 /api/nav-groups", /await saveNavGroupsApi\(next\)/.test(appSrc) && /setNavZones\(saved\)/.test(appSrc));
ok("App 回调先剥离同 id 再插入目标分组", /filter\(\(a\) => a\.id !== app\.id\)/.test(appSrc));
ok("App 校验目标分组存在", /目标分组不存在，请刷新后重试/.test(appSrc));
ok("★ App 按 hiddenPages 判定导航页启用", /navEnabled=\{!\(settings\?\.modal\?\.hiddenPages \|\| \[\]\)\.includes\("navigation"\)\}/.test(appSrc));
ok("App 传 navZones / onAddToNav", /navZones=\{navZones\}/.test(appSrc) && /onAddToNav=\{handleAddContainerToNav\}/.test(appSrc));
ok("弹窗使用共享 Esc 栈", /useEscapeClose\(onClose\)/.test(modalSrc));
ok("★ 弹窗遮罩无 onClick（防误关）", !/<div className="fixed inset-0[^>]*onClick/.test(modalSrc));
ok("弹窗有 X / 取消 / 确定三种关闭", /onClick=\{onClose\}/.test(modalSrc) && /取消/.test(modalSrc) && /添加到导航页/.test(modalSrc));
ok("弹窗两级归属：分区 → 分组", /changeZone\(/.test(modalSrc) && /zoneGroups\.map/.test(modalSrc) && /safeZones\.map/.test(modalSrc));
ok("切换分区回落首分组", /setGroupId\(safeZones\.find\(\(z\) => z\.id === nextZoneId\)\?\.groups\?\.\[0\]\?\.id \|\| ""\)/.test(modalSrc));
ok("名称全局唯一校验", /nameTaken/.test(modalSrc) && /existingNames\.has/.test(modalSrc));
ok("至少一个链接校验", /const hasUrl = !!lanUrl\.trim\(\) \|\| !!url\.trim\(\)/.test(modalSrc));
ok("保存 await 真实落盘并仅在成功后关闭", /await onSave\(groupId, app\)/.test(modalSrc) && /onClose\(\);/.test(modalSrc));
ok("保存失败弹窗内提示", /setErr\(e\?\.message \|\| "添加失败，请稍后重试"\)/.test(modalSrc));
ok("无分区/分组时给出指引", /导航页尚无分区或分组/.test(modalSrc));
ok("纯函数模块标记自托管且图标留空", /kind: "self"/.test(pureSrc) && /icon: ""/.test(pureSrc));
ok("门禁已接入 test:containeraddnav", (pkg.scripts["test:containeraddnav"] || "").includes("check-container-add-nav.mjs"));
ok("test:gates 已接入 test:containeraddnav", (pkg.scripts["test:gates"] || "").includes("test:containeraddnav"));

console.log("\n== ③ 负向自检（进程级注入 3 类回归 → 重跑本门禁应 exit 1） ==");
if (!IS_CHILD) {
  const cases = [
    {
      name: "注入导航页未启用仍显示入口回归",
      rel: "src/pages/Containers.tsx",
      inject: (s) => s.replace("...(navEnabled && onAddToNav", "...(false && onAddToNav"),
    },
    {
      name: "注入弹窗脱离共享 Esc 栈回归",
      rel: "src/components/AddToNavModal.tsx",
      inject: (s) => s.replace("  useEscapeClose(onClose);\n", ""),
    },
    {
      name: "注入容器卡片误存外链类型回归",
      rel: "src/nav-from-container.ts",
      inject: (s) => s.replace('kind: "self",', 'kind: "ext",'),
    },
  ];
  for (const c of cases) {
    const file = path.join(ROOT, c.rel);
    const orig = fs.readFileSync(file);
    const mutated = c.inject(orig.toString("utf8"));
    if (mutated === orig.toString("utf8")) {
      fail++;
      console.log(`  FAIL  负向自检锚点失效（${c.name}，请更新门禁）`);
      continue;
    }
    fs.writeFileSync(file, Buffer.from(mutated, "utf8"));
    let childFailed = false;
    try {
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        stdio: "pipe",
        env: { ...process.env, CONTAINER_ADD_NAV_GATE_NEGATIVE_CHILD: "1" },
      });
    } catch (e) {
      childFailed = e.status === 1;
    } finally {
      fs.writeFileSync(file, orig);
    }
    ok(`${c.name}被检出（子进程 exit 1）`, childFailed);
    ok(`${c.name}还原字节级一致`, fs.readFileSync(file).equals(orig));
  }
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
