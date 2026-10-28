/**
 * 通知中心「清空」按钮门禁（v1.42.16）。
 *
 * 需求（用户原话）：
 *   ① 操作记录：「清空记录」改名「清空」，且只清空当前页面、不删除内容；
 *   ② 通知：新增「清空」按钮，同样只清空当前页面、不删除内容。
 *
 * 覆盖：
 *   ① Notifications.tsx 不再导入 / 调用 clearOpLogs（绝不删 localStorage 实际内容）；
 *   ② handleClearOps 只置空本地视图状态（setOpLogs([]) + setOpsCleared(true)）；
 *   ③ 操作记录按钮文案＝「清空」（旧文案「清空记录」零残留），带只清当前页的 title；
 *   ④ 通知 Tab 有「清空」按钮（handleClearNotifs），只写本地 clearedNotifIds；
 *   ⑤ visibleNotifs 按 clearedNotifIds 过滤，计数 / 未读 / 筛选均基于它；
 *   ⑥ 清空后的空状态提示（两个 Tab 各自的分支文案）；
 *   ⑦ 重进操作记录 Tab 时恢复显示（useEffect 里 setOpsCleared(false)）。
 *
 * 运行：node scripts/check-notifications-clear.mjs （已接入 npm run test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const nt = read("src/pages/Notifications.tsx");

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

/* ---------- ① 不删实际内容 ---------- */
console.log("\n── ① 绝不删除实际内容 ──");
ok("★ 不再导入 clearOpLogs", !/clearOpLogs/.test(nt));
ok("★ handleClearOps 不调用任何删除函数（仅 setState）", /const handleClearOps = \(\) => \{[\s\S]*?setOpLogs\(\[\]\);[\s\S]*?setOpsCleared\(true\);[\s\S]*?\};/.test(nt) && !/clearOpLogs\(\)/.test(nt));

/* ---------- ② 操作记录 Tab ---------- */
console.log("\n── ② 操作记录 Tab ──");
ok("★ 按钮文案为「清空」（Trash2 + 清空）", /<Trash2 size=\{14\} \/> 清空\n/.test(nt) || /<Trash2 size=\{14\} \/> 清空</.test(nt));
ok("★ 旧文案「清空记录」零残留", !/清空记录/.test(nt));
ok("按钮带 title「仅清空当前页面显示，不删除实际内容」", nt.split("title=\"仅清空当前页面显示，不删除实际内容\"").length - 1 >= 2);
ok("opsCleared 状态存在（清空标志）", /const \[opsCleared, setOpsCleared\] = useState\(false\);/.test(nt));
ok("★ 重进操作记录 Tab 时恢复显示（useEffect 里 setOpsCleared(false)）", /if \(tab === "operations"\) \{[\s\S]*?setOpLogs\(getOpLogs\(\)\);[\s\S]*?setOpsCleared\(false\);/.test(nt));
ok("★ 清空后空状态提示「当前页面显示已清空」+ 恢复说明", /\{opsCleared \? "当前页面显示已清空" : "暂无操作记录"\}/.test(nt) && /\{opsCleared \? "实际内容未删除，离开本页再进入即可恢复" : "执行容器\/堆栈操作后将自动记录"\}/.test(nt));

/* ---------- ③ 通知 Tab ---------- */
console.log("\n── ③ 通知 Tab ──");
ok("★ 新增「清空」按钮（handleClearNotifs）", /onClick=\{handleClearNotifs\}/.test(nt));
ok("★ handleClearNotifs 只写本地 clearedNotifIds（不碰 props）", /const handleClearNotifs = \(\) => \{[\s\S]*?setClearedNotifIds\(new Set\(notifications\.map\(\(n\) => n\.id\)\)\);[\s\S]*?\};/.test(nt));
ok("clearedNotifIds 状态存在", /const \[clearedNotifIds, setClearedNotifIds\] = useState<Set<string>>\(new Set\(\)\);/.test(nt));
ok("★ visibleNotifs 按 clearedNotifIds 过滤", /const visibleNotifs = notifications\.filter\(\(n\) => !clearedNotifIds\.has\(n\.id\)\);/.test(nt));
ok("★ 未读数基于 visibleNotifs（清空后角标同步）", /const unreadCount = visibleNotifs\.filter\(\(n\) => !isRead\(n\)\)\.length;/.test(nt));
ok("★ 列表筛选基于 visibleNotifs", /const filtered = visibleNotifs\.filter\(\(n\) => \{/.test(nt));
ok("★ 计数文案基于 visibleNotifs.length", /共 \{visibleNotifs\.length\} 条通知/.test(nt));
ok("★ 筛选后计数基于 visibleNotifs.length", /\{filtered\.length !== visibleNotifs\.length && `，筛选后 \$\{filtered\.length\} 条`\}/.test(nt));
ok("清空按钮在 visibleNotifs.length > 0 时才显示", /\{visibleNotifs\.length > 0 && \(\s*\n\s*<button\s*\n\s*onClick=\{handleClearNotifs\}/.test(nt));
ok("★ 通知清空后空状态提示「当前页面显示已清空」+ 新通知说明", /\{notifAllCleared \? "当前页面显示已清空" : "暂无匹配的通知"\}/.test(nt) && /实际内容未删除，新通知到达后仍会显示/.test(nt));
ok("notifAllCleared 判定（有通知但全部被清空）", /const notifAllCleared = notifications\.length > 0 && visibleNotifs\.length === 0;/.test(nt));
ok("两个 Tab 的清空按钮并排于标题行（通知 Tab 按钮组）", /<div className="flex items-center gap-2">[\s\S]*?onClick=\{handleClearNotifs\}[\s\S]*?onClick=\{onMarkAllRead\}/.test(nt));

console.log(`\n结果: PASS=${pass} FAIL=${fail}`);
process.exit(fail === 0 ? 0 : 1);
