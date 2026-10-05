#!/usr/bin/env node
/**
 * 通知（Webhook / 邮件）接线断言
 *
 * 为什么存在：「设置 → 通知配置」里的 Webhook 与邮件曾长期是**装饰性 stub** ——
 * UI 有开关、有输入框、能存进 settings.json，但**后端没有任何一处读取它们去发请求**，
 * 邮件密码框甚至是 `value=""` + 空 onChange 的死输入框。本门禁把「有消费端」这件事钉死。
 *
 * 覆盖（全部源码级，零网络零依赖，秒级）：
 *   1. 消费端存在：server/notify.ts 及其关键导出
 *   2. 四个事件都有触发点（buildFailed 除外 ⇒ 必须显式标注无源）
 *   3. 事件开关真的被读（不是摆设）
 *   4. ★ 负向：设置页不得再有「死输入框」（value="" + 空 onChange）
 *   5. ★ 负向：SMTP 密码 / Webhook URL 不得是只读展示（必须绑真实 state）
 *   6. 安全：密钥不进日志、旁路失败不影响主流程
 *
 * 跑法：`npm run lint:notify`（已并入 test:gates）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

let pass = 0;
let fail = 0;
function check(name, ok, extra) {
  if (ok) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? "  <<< " + extra : ""));
  }
}

const notifySrc = read("server/notify.ts");
const settingsSrc = read("server/settings.ts");
const indexSrc = read("server/index.ts");
const dockerSrc = read("server/docker.ts");
const schedulerSrc = read("server/scheduler.ts");
const uiSrc = read("src/pages/Settings.tsx");
const typesSrc = read("src/types.ts");

// ---------- 1. 消费端存在 ----------
check("★ server/notify.ts 存在（通知消费端）", notifySrc.length > 0);
for (const fn of [
  "export function notify(",
  "export async function doNotify(",
  "export async function sendWebhook(",
  "export async function sendEmail(",
  "export function signPayload(",
  "export function diffContainerStates(",
  "export function startContainerWatch(",
  "export function sendTestNotify(",
]) {
  check(`  notify.ts 导出 ${fn.replace("export ", "").replace("(", "")}`, notifySrc.includes(fn));
}
check("★ 用了 nodemailer 发信（真发，不是残缺实现）", /from "nodemailer"/.test(notifySrc) && /createTransport/.test(notifySrc));
check("★ Webhook 走真实 HTTP（fetch + 超时）", /await fetch\(/.test(notifySrc) && /AbortSignal\.timeout/.test(notifySrc));
check("★ 签名用 node:crypto 内置（零额外依赖）", /createHmac\("sha256"/.test(notifySrc));

// ---------- 2. 四个事件的触发点 ----------
check("★ containerDown 有触发源（容器状态巡检已接线）",
  /startContainerWatch\(/.test(indexSrc) && /diffContainerStates/.test(notifySrc));
check("★ updateAvailable 有触发源（镜像更新检查）",
  /event: "updateAvailable"/.test(schedulerSrc) && /checkEngineImages/.test(schedulerSrc));
const pullFinish = (dockerSrc.match(/finishPullSuccess\(task, engine, originalImage\)/g) || []).length;
check("★ updateComplete 有触发源（三条拉取路径统一收口）",
  /event: "updateComplete"/.test(dockerSrc) && /function finishPullSuccess/.test(dockerSrc) && pullFinish === 3,
  `收口调用点 ${pullFinish} 处（期望 3：本地 CLI / 远程 CLI / dockerode API）`);
check("★ 拉取成功三行已统一收口（无遗漏的裸写）",
  (dockerSrc.match(/task\.status = "success";/g) || []).length === 1,
  `裸写 ${(dockerSrc.match(/task\.status = "success";/g) || []).length} 处（期望 1：仅 helper 内）`);
check("★ buildFailed 显式标注无触发源（后端声明 + 接口透出 + 前端说明）",
  /EVENTS_WITHOUT_SOURCE: NotifyEventKey\[\] = \["buildFailed"\]/.test(notifySrc)
  && /eventsWithoutSource: EVENTS_WITHOUT_SOURCE/.test(indexSrc)
  && /noSource: true/.test(uiSrc) && /无镜像构建功能/.test(uiSrc));

// ---------- 3. 事件开关真的被读 ----------
check("★ 事件开关被真正读取（events 不是摆设）", /cfg\.events\[p\.event\]/.test(notifySrc));
check("★ 去重逻辑存在（避免同一事件反复轰炸）", /DEDUP_TTL_MS/.test(notifySrc) && /claimDedupe/.test(notifySrc));

// ---------- 4. ★ 负向：死输入框 ----------
// 形如 <Input value="" onChange={() => {}} …/> —— 看得见、存不进、永远是空。
// ★ JSX 里两种写法都要覆盖：字符串字面量 `value=""` 与 表达式 `value={""}`。
const DEAD_INPUT = /<Input\b[^>]*value=(?:\{\s*""\s*\}|"")[^>]*onChange=\{\(\)\s*=>\s*\{\s*\}\}/g;
const deadInputs = [...uiSrc.matchAll(DEAD_INPUT)];
check("★ 负向：设置页无「死输入框」（value=\"\" + 空 onChange）", deadInputs.length === 0,
  `命中 ${deadInputs.length} 处：${deadInputs.map((m) => m[0].slice(0, 90)).join(" | ")}`);
const deadAny = [...uiSrc.matchAll(/value=(?:\{\s*""\s*\}|"")\s+onChange=\{\(\)\s*=>\s*\{\s*\}\}/g)];
check("★ 负向：全站无 value=\"\" + 空 onChange 的组合", deadAny.length === 0, `命中 ${deadAny.length} 处`);

// ---------- 5. ★ 负向：敏感字段必须绑真实 state ----------
check("★ SMTP 密码绑真实字段 emailPassword（不再是死框）",
  /emailPassword/.test(uiSrc) && /notifications\.emailPassword/.test(uiSrc));
check("★★ SMTP 密码经 SecretField → PasswordInput（小眼睛 + 不提交表单 + 带「清除」）",
  /<SecretField[\s\S]{0,400}?emailPassword/.test(uiSrc)
  && /function SecretField[\s\S]{0,1600}?<PasswordInput/.test(uiSrc)
  && /onClear=/.test(uiSrc));
check("★ Webhook 签名密钥也走 SecretField（同样只写不读 + 可清除）",
  /<SecretField[\s\S]{0,400}?webhookSecret/.test(uiSrc));
check("★ 收件人 / 发件人字段已接线", /notifications\.emailTo/.test(uiSrc) && /notifications\.emailFrom/.test(uiSrc));
check("★ Webhook 签名密钥已接线", /notifications\.webhookSecret/.test(uiSrc));
check("★ 配置结构含全部新字段（后端默认值）",
  ["webhookSecret:", "emailPassword:", "emailFrom:", "emailTo:"].every((k) => settingsSrc.includes(k)));
check("★ notifications 段做二级合并（旧 settings.json 缺字段时不失效）",
  /notifications:\s*\{[\s\S]{0,200}DEFAULT_SETTINGS\.notifications/.test(settingsSrc));
check("★ 前端类型同步（含通知自检结果类型）",
  /webhookSecret: string;/.test(typesSrc) && /interface NotifyTestResult/.test(typesSrc));

// ---------- 6. 安全与旁路 ----------
check("★ 密钥不进日志（无 password/secret 出现在日志调用里）",
  !/log\.(info|warn|error|debug)\([^)]*(emailPassword|webhookSecret|authPass)/.test(notifySrc));
check("★ notify() 永不抛错（旁路不影响主流程）",
  /export function notify\(p: NotifyPayload\): void \{\s*void doNotify\(p\);/.test(notifySrc));
check("★ 拉取成功收口对通知异常做了保护", /catch \{\s*\/\* 通知失败不影响拉取结果 \*\/\s*\}/.test(dockerSrc));
check("★ 有测试通知端点（用户可当场验证是否真能收到）",
  /app\.post\("\/api\/notify\/test"/.test(indexSrc) && /app\.get\("\/api\/notify\/status"/.test(indexSrc));
check("★ 测试通知按钮先保存再发（避免拿旧配置去发）",
  /handleTestNotify/.test(uiSrc) && /const saved = await handleSave\(\);/.test(uiSrc));
check("★ 依赖已登记进 package.json", /"nodemailer":/.test(read("package.json")));

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
process.exit(fail === 0 ? 0 : 1);
