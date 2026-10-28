/**
 * 镜像管理「仓库名隐藏 registry 地址」门禁（v1.42.15）。
 *
 * 覆盖：
 *   ① stripRegistryHost 纯函数存在且行为正确（Docker 主机名判定规则，真实执行用例）；
 *   ② Images.tsx 接线：hideRepoRegistry prop（默认 true）+ 仓库名单元格条件缩短 + 悬停显示完整地址；
 *   ③ 搜索框同时匹配完整仓库名与缩短后的短名；
 *   ④ App.tsx 从 settings.imagesDisplay.hideRegistryPrefix 取数（缺省 true）；
 *   ⑤ Settings.tsx「列显隐 → 镜像管理」卡片开关接线（读写 imagesDisplay 段）；
 *   ⑥ 服务端默认值 + 二级合并（旧 settings.json 无该段时继承默认开启）；
 *   ⑦ src/types.ts ImagesDisplayConfig 定义；
 *   ⑧ 「仓库名」列常驻（v1.42.17）：设置列显隐镜像卡片与镜像页「列」下拉均不含该列勾选，
 *      初始 visibleColumns 强制补回 repository（旧设置里曾被取消勾选的自动恢复显示）。
 *   ⑨ 「仓库 registry 地址」进页内「列」下拉（v1.42.18）：新增独立开关项（勾选 = 显示完整地址），
 *      初始值取 hideRepoRegistryInit prop（settings 缺省 true），会话级切换不写服务端。
 *   ⑩ 「SHA-256」列默认不显示（v1.42.19）：镜像页全量默认分支剔除 sha256；设置页列显隐卡片
 *      无 stored 时 images 默认不含 sha256；列本身仍可手动勾选（allColumns 保留、渲染条件保留）。
 *
 * 运行：node scripts/check-images-repo-display.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const images = read("src/pages/Images.tsx");
const app = read("src/App.tsx");
const settings = read("src/pages/Settings.tsx");
const server = read("server/settings.ts");
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

/* ---------- ① stripRegistryHost 纯函数 ---------- */
console.log("\n── ① stripRegistryHost 纯函数 ──");
ok("函数存在（stripRegistryHost(repo: string): string）", /function stripRegistryHost\(repo: string\): string \{/.test(images));

const fm = images.match(/function stripRegistryHost\(repo: string\): string \{[\s\S]*?\n\}/);
ok("函数体可定位", !!fm);
if (fm) {
  // 剥 TS 类型标注后用 new Function 执行真实实现
  const body = fm[0]
    .replace(/\(repo: string\): string/, "(repo)")
    .replace(/^function stripRegistryHost/, "return function stripRegistryHost")
    .replace(/\}\s*$/, "}");
  let strip;
  try {
    strip = new Function(`${body}`)();
  } catch (e) {
    console.log("  ❌ 函数体编译失败:", e.message);
    fail++;
  }
  if (strip) {
    ok("★ docker.1panel.live/gitea/gitea ⇒ gitea/gitea（用户指定场景）", strip("docker.1panel.live/gitea/gitea") === "gitea/gitea");
    ok("registry:5000/foo/bar ⇒ foo/bar（端口型主机名）", strip("registry:5000/foo/bar") === "foo/bar");
    ok("localhost/foo ⇒ foo（localhost 特判）", strip("localhost/foo") === "foo");
    ok("hub.1panel.dev/xxx ⇒ xxx", strip("hub.1panel.dev/xxx") === "xxx");
    ok("gitea/gitea ⇒ 原样（无主机名）", strip("gitea/gitea") === "gitea/gitea");
    ok("nginx ⇒ 原样（无斜杠）", strip("nginx") === "nginx");
    ok("library/nginx ⇒ 原样（首段无点/冒号）", strip("library/nginx") === "library/nginx");
    ok("<none> 悬空镜像 ⇒ 原样", strip("<none>") === "<none>");
    ok("空串 ⇒ 空串", strip("") === "");
    ok("剥完为空（localhost/）⇒ 原样，绝不显示空仓库名", strip("localhost/") === "localhost/");
    ok("前后空格不敏感（ trim 后判定）", strip("  docker.1panel.live/gitea/gitea  ") === "gitea/gitea");
  }
}

/* ---------- ② Images.tsx 接线 ---------- */
console.log("\n── ② Images.tsx 接线 ──");
ok("★ ImagesProps 含 hideRepoRegistryInit?: boolean", /hideRepoRegistryInit\?: boolean;/.test(images));
ok("★ 解构默认值 hideRepoRegistryInit = true", /hideRepoRegistryInit = true/.test(images));
ok("★ 会话级状态 useState(hideRepoRegistryInit)", /useState\(hideRepoRegistryInit\)/.test(images));
ok("★ 仓库名单元格条件缩短", /hideRepoRegistry \? stripRegistryHost\(img\.repository\) : img\.repository/.test(images));
ok("★ 被缩短时悬停 title 显示完整地址", /title=\{hideRepoRegistry && stripRegistryHost\(img\.repository\) !== img\.repository \? img\.repository : undefined\}/.test(images));
ok("单元格仍显示悬空 / 已锁定标签", /\{img\.isDangling && <Tag text="悬空" color="amber" \/>\}/.test(images));

/* ---------- ③ 搜索匹配 ---------- */
console.log("\n── ③ 搜索匹配 ──");
ok("★ 搜索同时匹配完整名与短名（repoShort）", /const repoShort = hideRepoRegistry \? stripRegistryHost\(img\.repository\)\.toLowerCase\(\) : repo;/.test(images) && /matchSearch = repo\.includes\(kw\) \|\| repoShort\.includes\(kw\)/.test(images));
ok("useMemo 依赖含 hideRepoRegistry", /\}, \[images, search, filter, hideRepoRegistry\]\);/.test(images));

/* ---------- ④ App.tsx 取数 ---------- */
console.log("\n── ④ App.tsx 取数 ──");
ok("★ Images 收 hideRepoRegistryInit prop（缺省 true）", /hideRepoRegistryInit=\{settings\?\.imagesDisplay\?\.hideRegistryPrefix \?\? true\}/.test(app));

/* ---------- ⑤ Settings.tsx 开关 ---------- */
console.log("\n── ⑤ Settings.tsx 列显隐开关 ──");
ok("★ 镜像管理卡片有隐藏开关（page.key === \"images\"）", /page\.key === "images" && \(/.test(settings));
ok("★ checked 读 data.imagesDisplay?.hideRegistryPrefix ?? true", /checked=\{data\.imagesDisplay\?\.hideRegistryPrefix \?\? true\}/.test(settings));
ok("★ onChange 写 update(\"imagesDisplay\", \"hideRegistryPrefix\", …)", /update\("imagesDisplay", "hideRegistryPrefix", e\.target\.checked\)/.test(settings));
ok("开关文案「仓库名隐藏 registry 地址」", /仓库名隐藏 registry 地址/.test(settings));
ok("说明含用户指定示例 docker.1panel.live/gitea/gitea ⇒ gitea/gitea", /docker\.1panel\.live\/gitea\/gitea<\/span> 显示为 <span className="font-mono">gitea\/gitea/.test(settings));
ok("列显隐分区总说明提及该开关", /镜像管理卡片内另有「仓库名隐藏 registry 地址」开关/.test(settings));

/* ---------- ⑥ 服务端默认值 + 合并 ---------- */
console.log("\n── ⑥ 服务端设置 ──");
ok("★ DEFAULT_SETTINGS.imagesDisplay.hideRegistryPrefix = true", /imagesDisplay: \{\s*\n\s*hideRegistryPrefix: true,?\s*\n\s*\},/.test(server));
ok("★ getSettings 二级合并（旧配置无该段时继承默认）", /imagesDisplay: \{ \.\.\.DEFAULT_SETTINGS\.imagesDisplay, \.\.\.\(parsed\?\.imagesDisplay \|\| \{\}\) \},/.test(server));

/* ---------- ⑦ 类型定义 ---------- */
console.log("\n── ⑦ 类型定义 ──");
ok("types.ts 有 ImagesDisplayConfig 接口", /export interface ImagesDisplayConfig \{/.test(types));
ok("SystemSettings 含 imagesDisplay 字段", /imagesDisplay: ImagesDisplayConfig;/.test(types));

/* ---------- ⑧ 仓库名列常驻（v1.42.17） ---------- */
console.log("\n── ⑧ 仓库名列常驻（v1.42.17） ──");
const imagesPageBlock = settings.match(/key: "images",[\s\S]*?\n  \},/);
ok("★ 设置列显隐镜像卡片不含「仓库名」勾选（列常驻）", !!imagesPageBlock && !imagesPageBlock[0].includes('"repository"'));
const allColsBlock = images.match(/const allColumns: \{ key: ColumnKey; label: string \}\[\] = \[[\s\S]*?\];/);
ok("★ 镜像页「列」下拉不含「仓库名」项", !!allColsBlock && !allColsBlock[0].includes("repository"));
ok("★ 初始 visibleColumns 强制包含 repository（旧设置藏过的自动恢复）", /defaultSet\.add\("repository"\);/.test(images));
ok("仓库名列头/单元格渲染条件保留", /visibleColumns\.has\("repository"\) && <th/.test(images) && /visibleColumns\.has\("repository"\) && \(/.test(images));
ok("列显隐分区说明注明仓库名列常驻", /「仓库名」为镜像主标识列，常驻显示/.test(settings));

/* ---------- ⑨ 「仓库 registry 地址」进列下拉（v1.42.18） ---------- */
console.log("\n── ⑨ 列下拉「仓库 registry 地址」项（v1.42.18） ──");
ok("★ 「列」下拉内有「仓库 registry 地址」label", /仓库 registry 地址\s*<\/label>/.test(images));
ok("★ 该项勾选态 = 显示完整地址（checked={!hideRepoRegistry}）", /checked=\{!hideRepoRegistry\}/.test(images));
ok("★ onChange 切换会话级状态 setHideRepoRegistry", /onChange=\{\(\) => setHideRepoRegistry\(\(v\) => !v\)\}/.test(images));
ok("★ 该项悬停 title 说明两种形态", /勾选显示完整仓库地址（如 docker\.1panel\.live\/gitea\/gitea）；不勾选隐藏 registry 地址前缀（如 gitea\/gitea）/.test(images));
ok("★ 该项不在 allColumns 数组内（非列显隐项）", !!allColsBlock && !allColsBlock[0].includes("仓库 registry 地址"));
ok("设置页说明指向页内「列」下拉同名控制项", /镜像管理页工具栏「列」下拉内也有同名控制项「仓库 registry 地址」/.test(settings));

/* ---------- ⑩ SHA-256 列默认不显示（v1.42.19） ---------- */
console.log("\n── ⑩ SHA-256 列默认不显示（v1.42.19） ──");
ok("★ 镜像页全量默认分支剔除 sha256（filter c => c.key !== \"sha256\"）", /new Set\(allColumns\.filter\(c => c\.key !== "sha256"\)\.map\(c => c\.key\)\)/.test(images));
ok("★ stored 分支保留（已保存过列选择的用户尊重其勾选）", /const defaultSet = defaultVisibleColumns && defaultVisibleColumns\.length > 0\s*\n\s*\? new Set\(defaultVisibleColumns as ColumnKey\[\]\)/.test(images));
ok("★ allColumns 仍含 sha256 项（列可手动勾选，未被移除）", !!allColsBlock && /key: "sha256"/.test(allColsBlock[0]));
ok("★ SHA-256 列头渲染条件保留", /visibleColumns\.has\("sha256"\) && <th/.test(images));
ok("★ 设置页列显隐 images 无 stored 时默认不含 sha256", /const defaultKeys = page\.key === "images" \? allKeys\.filter\(k => k !== "sha256"\) : allKeys;/.test(settings) && /const visibleSet = stored && stored\.length > 0 \? new Set\(stored\) : new Set\(defaultKeys\);/.test(settings));
ok("设置页说明注明 SHA-256 默认不显示", /镜像管理「SHA-256」列默认不显示/.test(settings));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
