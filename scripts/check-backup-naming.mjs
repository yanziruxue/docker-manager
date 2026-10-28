/**
 * 备份命名规则 + 设置页卡片归属门禁（v1.41.5）。
 *
 * 覆盖三组改动：
 *   ① 备份文件命名：`dockermanagementyanzi_all_YYYYMMDD_HHMMSS.zip`（全量）
 *      / `dockermanagementyanzi_<堆栈名>_YYYYMMDD_HHMMSS.zip`（堆栈）/ auto 档位前缀保留；
 *   ② 前端 `backupLabel()` 必须能解析新命名（且兼容历史命名）；
 *   ③ 设置页卡片归属：「应用信息」并入「系统更新 → 当前版本」，
 *      「备份管理」页不得再出现 应用信息 / 安装位置与目录 / 目录镜像 三张卡片。
 *
 * 运行：node scripts/check-backup-naming.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const backupTs = read("server/backup.ts");
const dockerTs = read("server/docker.ts");
const schedulerTs = read("server/scheduler.ts");
const settingsTsx = read("src/pages/Settings.tsx");

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

/* ---------- ① 后端：命名规则 ---------- */
console.log("\n── ① 后端命名规则 ──");

ok("backup.ts 导出统一前缀常量 BACKUP_NAME_PREFIX", /export const BACKUP_NAME_PREFIX = "dockermanagementyanzi";/.test(backupTs));
ok(
  "backup.ts 全量备份名 = 前缀 + all + 时间戳",
  /`\$\{BACKUP_NAME_PREFIX\}_\$\{kind === "manual" \? "all" : "auto"\}\$\{tag \? "-" \+ tag : ""\}_\$\{tsCompact\(\)\}\.zip`/.test(
    backupTs
  )
);
ok(
  "tsCompact 产出 YYYYMMDD_HHMMSS（本地时间，非 ISO）",
  /getFullYear\(\).*getMonth\(\).*getDate\(\).*getHours\(\).*getMinutes\(\).*getSeconds\(\)/s.test(backupTs) &&
    !/toISOString/.test(backupTs.split("export function tsCompact")[1].slice(0, 400))
);
ok("backup.ts 不再出现旧的 `auto-<tag>_` 裸前缀名", !/`auto-\$\{tag/.test(backupTs));
ok(
  "config-export 亦带统一前缀",
  /const name = `\$\{BACKUP_NAME_PREFIX\}_config-export_\$\{tsCompact\(\)\}\.zip`/.test(backupTs)
);

ok(
  "docker.ts 堆栈备份名 = 前缀 + 堆栈名 + 时间戳",
  /const backupName = `\$\{BACKUP_NAME_PREFIX\}_\$\{stackName\}_\$\{tsCompact\(\)\}\.zip`;/.test(dockerTs)
);
ok(
  "docker.ts 从 backup.js 引入 BACKUP_NAME_PREFIX 与 tsCompact",
  /import \{[^}]*BACKUP_NAME_PREFIX[^}]*tsCompact[^}]*\} from "\.\/backup\.js"/.test(dockerTs)
);
ok("docker.ts 不再自行拼 ISO 时间戳", !/toISOString\(\)\.replace\(\/\[:\.\]\/g, "-"\)/.test(dockerTs));

// 分档保留清理必须跟着改前缀，否则自动备份永远清不掉（旧包名匹配不上）
ok(
  "scheduler.ts 分档清理前缀 = 前缀 + auto-<档位>_",
  /pruneBackups\(`\$\{BACKUP_NAME_PREFIX\}_auto-\$\{key\}_`, retention\)/.test(schedulerTs)
);
ok("scheduler.ts 引入 BACKUP_NAME_PREFIX", /import \{[^}]*BACKUP_NAME_PREFIX[^}]*\} from "\.\/backup\.js"/.test(schedulerTs));
ok("scheduler.ts 不再使用裸 `auto-${key}_` 前缀", !/pruneBackups\(`auto-\$\{key\}_`/.test(schedulerTs));

/* ---------- ② 前端：backupLabel 解析 ---------- */
console.log("\n── ② 前端 backupLabel 解析 ──");

ok("Settings.tsx 定义与后端一致的前缀常量", /const BACKUP_NAME_PREFIX = "dockermanagementyanzi";/.test(settingsTsx));
ok(
  "backupLabel 先剥统一前缀",
  /const body = base\.startsWith\(`\$\{BACKUP_NAME_PREFIX\}_`\)/.test(settingsTsx)
);
ok(
  "backupLabel 兼容新+旧两种时间戳（YYYYMMDD_HHMMSS / ISO）",
  /const stamp = [\s\S]{0,20}\\d\{8\}_\\d\{6\}/.test(settingsTsx) &&
    /T\\d\{2\}-\\d\{2\}-\\d\{2\}\)\$/.test(settingsTsx)
);
ok("backupLabel 保留手动全量 / 自动 / 配置导出 / 堆栈四类标签", [
  /手动全量备份/.test(settingsTsx),
  /自动备份（/.test(settingsTsx),
  /配置导出/.test(settingsTsx),
].every(Boolean));

/* ---------- ③ 设置页卡片归属 ---------- */
console.log("\n── ③ 设置页卡片归属 ──");

// 注意分区在 JSX 里的实际顺序：backup → scheduler → activity → update → applogs
const backupSectionStart = settingsTsx.indexOf('activeSection === "backup" && (');
const schedulerSectionStart = settingsTsx.indexOf('activeSection === "scheduler" && (');
const updateSectionStart = settingsTsx.indexOf('activeSection === "update" && (');
const applogsSectionStart = settingsTsx.indexOf('activeSection === "applogs" && (');
ok(
  "三个分区边界均可定位且顺序正确",
  backupSectionStart > 0 &&
    schedulerSectionStart > backupSectionStart &&
    updateSectionStart > schedulerSectionStart &&
    applogsSectionStart > updateSectionStart
);

const backupSection = settingsTsx.slice(backupSectionStart, schedulerSectionStart);
const updateSection = settingsTsx.slice(updateSectionStart, applogsSectionStart);

ok("备份管理页已移除「应用信息」卡片标题", !backupSection.includes('title="应用信息"'));
ok("备份管理页已移除「安装位置与目录」卡片", !backupSection.includes('title="安装位置与目录"'));
ok("备份管理页已移除「目录镜像」区块", !backupSection.includes("目录镜像"));
ok("备份管理页不再渲染 appInfo 运行态", !backupSection.includes("appInfo.user"));

ok("系统更新页的「当前版本」卡片已吸收应用信息", /title="当前版本"/.test(updateSection) && updateSection.includes("appInfo.user"));
ok("当前版本卡片带刷新按钮（复用原应用信息卡片能力）", /title="刷新"/.test(updateSection));

// appInfo 改在 update 分区加载
const appInfoEffect = settingsTsx.match(/useEffect\(\(\) => \{[\s\S]{0,300}?loadAppInfo\(\);[\s\S]{0,120}?\}, \[activeSection, loadAppInfo\]\);/);
ok("loadAppInfo 仍被 useEffect 驱动", !!appInfoEffect);
ok("loadAppInfo 改为在 update 分区触发", !!appInfoEffect && /activeSection === "update"/.test(appInfoEffect[0]));
ok("loadAppInfo 不再在 backup 分区触发", !/activeSection === "backup"\) \{\s*void loadAppInfo\(\)/.test(settingsTsx));

// 连带清理：被移除卡片专属的 state / handler / import 不得残留
ok("已清理 copiedDirKey（目录复制反馈）", !/copiedDirKey|setCopiedDirKey/.test(settingsTsx));
ok("已清理 copyDirPath（目录路径复制）", !/copyDirPath/.test(settingsTsx));
ok("已清理镜像运行态 state", !/mirrorStates|mirrorLoading|mirrorError|mirrorSyncing/.test(settingsTsx));
ok("已清理 loadMirror / handleMirrorSyncNow", !/loadMirror|handleMirrorSyncNow/.test(settingsTsx));
ok("已清理镜像 API import", !/fetchMirrorStatusApi|syncMirrorNowApi/.test(settingsTsx));
ok("已清理 MirrorRuntimeState 类型 import", !/MirrorRuntimeState/.test(settingsTsx));
ok("已清理随之失效的图标 import（FolderOpen / Info）", !/\bFolderOpen,/.test(settingsTsx) && !/^\s*Info,$/m.test(settingsTsx));

/* ---------- ④ 权限预检退役 ---------- */
console.log("\n── ④ 备份权限预检退役 ──");

ok("前端不再持有 permCheck state", !/permCheck\b|setPermCheck/.test(settingsTsx));
ok("前端不再调用 checkPermissionsApi", !/checkPermissionsApi/.test(settingsTsx));
ok("已移除推测性预检文案「检测到 N 个文件权限异常」", !/检测到 \$\{permCheck/.test(settingsTsx));
// 「重新检测」在别处仍合法存在（daemon.json 提权重探测、sudoers 引导），只断言备份卡片里没有
ok("备份卡片里的「重新检测」按钮已移除", !backupSection.includes("loadPermCheck") && !backupSection.includes("重新检测"));
ok("仍保留基于真实备份结果的跳过提示", /上次备份跳过 \$\{backupIssues\.skipped\.length\} 项（权限不足）/.test(settingsTsx));
ok("修复命令仅取自 backupIssues（不再回落体检）", /const cmd = backupIssues\?\.fixCommand \|\| "";/.test(settingsTsx));
ok("修复命令仍可一键复制", /handleCopyFixCmd/.test(settingsTsx) && /fixCmdRef/.test(settingsTsx));
// 服务端只读体检接口保留（CLI permission-check 与排障文档仍在用），只是前端不再自动调用
ok("服务端 permission-check 接口保留（排障/CLI 仍需要）", /api\/system\/permission-check/.test(read("server/index.ts")));

/* ---------- ⑤ 侧栏分区顺序（v1.41.6 用户指定） ---------- */
console.log("\n── ⑤ 系统设置侧栏分区顺序 ──");

// 从源码里抽出 sections 数组的 { key, label } 序列（按出现顺序）
const sectionsBlock = (() => {
  const i = settingsTsx.indexOf("const sections = [");
  if (i < 0) return "";
  const j = settingsTsx.indexOf("\n  ];", i);
  return j < 0 ? "" : settingsTsx.slice(i, j);
})();
ok("sections 数组可定位", sectionsBlock.length > 0);

const actualOrder = [...sectionsBlock.matchAll(/key:\s*"([a-z]+)",\s*label:\s*"([^"]+)"/g)].map((m) => m[2]);
// 用户指定顺序：用户 → 列显隐 → 引擎配置 → 标签管理 → 编辑堆栈（v1.44.0 由「Compose 管理」改名）→ 页面设置
//            → 镜像更新 → 备份管理 → 通知 → 日志 → 硬件信息 → 系统更新
const EXPECTED_ORDER = [
  "用户",
  "列显隐",
  "引擎配置",
  "标签管理",
  "编辑堆栈",
  "页面设置",
  "镜像更新",
  "备份管理",
  "通知",
  "日志",
  "硬件信息",
  "系统更新",
];
check("侧栏分区顺序与用户指定一致", actualOrder, EXPECTED_ORDER);
check("分区数量未变（12 个）", actualOrder.length, EXPECTED_ORDER.length);

// key 不得因排序而丢失/改名 —— 各分区 JSX 条件与数据加载都按 key 取
const actualKeys = [...sectionsBlock.matchAll(/key:\s*"([a-z]+)"/g)].map((m) => m[1]);
check("12 个 key 齐全且无重复", [...new Set(actualKeys)].length, 12);
const EXPECTED_KEYS = [
  "user",
  "colvis",
  "docker",
  "tags",
  "compose",
  "modal",
  "scheduler",
  "backup",
  "notifications",
  "applogs",
  "activity",
  "update",
];
check("key 集合未变（排序不等于改 key）", actualKeys.slice().sort(), [...EXPECTED_KEYS].sort());

// ★ 每个 key 都必须仍有一个对应的 JSX 分支，否则点了侧栏会是空白页
const missingBranch = EXPECTED_KEYS.filter((k) => !settingsTsx.includes(`activeSection === "${k}" && (`));
check("每个分区都有对应 JSX 分支（无空白页）", missingBranch, []);
// 默认落地分区仍存在
ok("默认 activeSection = docker 仍有效", /useState\("docker"\)/.test(settingsTsx));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
