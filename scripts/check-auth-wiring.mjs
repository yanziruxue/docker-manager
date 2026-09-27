#!/usr/bin/env node
/**
 * 账号状态机「接线」断言（v1.31.0）
 *
 * 为什么存在：`renderToStaticMarkup` 能验「组件渲染成什么样」，但验不了
 * 「App.tsx 有没有把 reinit 这条链接对」—— 而「UI 未必接线」正是本项目栽过两次的坑
 * （装饰性 stub、前端从未接线的死代码）。本脚本用**已在装的 typescript 编译器 API**
 * 对源码做结构断言，覆盖渲染断言够不到的那一层。
 *
 * 覆盖：分支存在性 / 顺序 / 事件名 / 常量值 / props 透传。
 * 不覆盖：运行时行为（那由 check-auth-render.mjs 与实际冒烟补）。
 * 零新依赖、零网络。
 *
 * 跑法：`npm run test:auth`（或直接 `node scripts/check-auth-wiring.mjs`）
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

function parse(rel, kind) {
  const full = path.join(ROOT, rel);
  return {
    rel,
    text: fs.readFileSync(full, "utf8"),
    sf: ts.createSourceFile(full, fs.readFileSync(full, "utf8"), ts.ScriptTarget.Latest, true, kind),
  };
}
function walk(node, cb) {
  if (!node) return;
  cb(node);
  node.forEachChild((c) => walk(c, cb));
}
/** 兼容两种入参：`find(app, ...)` 传包装对象（取 .sf）、`find(fn, ...)` 传裸节点 */
function find(node, pred) {
  const root = node && node.sf ? node.sf : node;
  const out = [];
  walk(root, (n) => {
    if (pred(n)) out.push(n);
  });
  return out;
}
function funcDecl(src, name) {
  return find(src, (n) => ts.isFunctionDeclaration(n) && n.name && n.name.text === name)[0];
}
/** 箭头函数常量（如 `const handleReinitDone = () => {...}`）——本项目多用这种写法 */
function arrowFn(src, name) {
  const decl = find(src, (n) => ts.isVariableDeclaration(n) && n.name.getText() === name)[0];
  const init = decl && decl.initializer;
  if (!init) return null;
  if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) return init;
  return null;
}
/** 取函数体源码（兼容函数声明与箭头函数常量） */
function fnText(src, name) {
  const n = funcDecl(src, name) || arrowFn(src, name);
  return n ? n.getText() : "";
}
function interfaceDecl(src, name) {
  return find(src, (n) => ts.isInterfaceDeclaration(n) && n.name.text === name)[0];
}
function attrOf(el, name) {
  const props = el.attributes.properties.filter(ts.isJsxAttribute);
  return props.find((a) => a.name.getText() === name);
}
function attrValueText(a) {
  if (!a || !a.initializer) return null;
  if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
  if (ts.isJsxExpression(a.initializer) && a.initializer.expression) return a.initializer.expression.getText();
  return null;
}

const app = parse("src/App.tsx", ts.ScriptKind.TSX);
const api = parse("src/api.ts", ts.ScriptKind.TS);
const wizard = parse("src/components/auth/SetupWizard.tsx", ts.ScriptKind.TSX);
const login = parse("src/components/auth/LoginPage.tsx", ts.ScriptKind.TSX);
const recovery = parse("src/lib/recovery-code.ts", ts.ScriptKind.TS);

// ---------- 1. authState 联合必须恰好是这 5 态 ----------
// ⚠️ 类型实参挂在 `useState<...>()` 的**调用表达式**上，不在解构变量的声明上 —— 要找 BindingElement 再上溯
try {
  const el = find(app, (n) => ts.isBindingElement(n) && n.name && n.name.getText() === "authState")[0];
  const decl = el && el.parent && el.parent.parent; // BindingElement → ArrayBindingPattern → VariableDeclaration
  const call = decl && decl.initializer;
  const union = call && call.typeArguments && call.typeArguments[0];
  const states = union && union.types ? union.types.map((t) => t.literal && t.literal.text) : [];
  const want = ["loading", "setup", "login", "reinit", "authed"];
  check("App.tsx `authState` 联合恰为 loading/setup/login/reinit/authed",
    states.length === 5 && want.every((s) => states.includes(s)), "实得 " + JSON.stringify(states));
} catch (e) {
  check("App.tsx `authState` 联合恰为 5 态", false, String(e && e.message));
}

// ---------- 2. reinit 分支必须真的渲染 SetupWizard 且带 mode="reinit" ----------
try {
  const wizards = find(app, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "SetupWizard");
  check("App.tsx 渲染 SetupWizard（≥2 处：setup 与 reinit）", wizards.length >= 2, "实得 " + wizards.length);
  const reinitEl = wizards.find((el) => attrValueText(attrOf(el, "mode")) === "reinit");
  check("★ 存在 mode=\"reinit\" 的 SetupWizard", !!reinitEl);
  if (reinitEl) {
    check("★ 该元素透传 initialUsername", !!attrOf(reinitEl, "initialUsername"));
    check("★ 该元素 onDone 指向 handleReinitDone", attrValueText(attrOf(reinitEl, "onDone")) === "handleReinitDone",
      String(attrValueText(attrOf(reinitEl, "onDone"))));
  } else {
    check("★ 该元素透传 initialUsername", false);
    check("★ 该元素 onDone 指向 handleReinitDone", false);
  }
  const createEl = wizards.find((el) => attrValueText(attrOf(el, "mode")) !== "reinit");
  check("★ 首次初始化仍走无 mode 的 SetupWizard（默认 create）", !!createEl);
} catch (e) {
  check("App.tsx SetupWizard 接线", false, String(e && e.message));
}

// ---------- 3. 必须监听 auth:reinit-required（否则运行中撞 403 不会切态） ----------
try {
  const hasListener = find(app, (n) =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "addEventListener" &&
    n.arguments[0] && ts.isStringLiteral(n.arguments[0]) && n.arguments[0].text === "auth:reinit-required").length > 0;
  check("★ App.tsx 监听 `auth:reinit-required`", hasListener);
} catch (e) {
  check("★ App.tsx 监听 `auth:reinit-required`", false, String(e && e.message));
}

// ---------- 4. reinit 成功后必须回登录页（不是 authed） ----------
try {
  const fn = arrowFn(app, "handleReinitDone") || funcDecl(app, "handleReinitDone");
  const calls = fn ? find(fn, (n) => ts.isCallExpression(n) && n.expression.getText() === "setAuthState") : [];
  const args = calls.map((c) => c.arguments[0]).filter(Boolean)
    .map((a) => (ts.isStringLiteral(a) ? a.text : a.getText()));
  check("★ handleReinitDone → setAuthState(\"login\")", args.includes("login"), JSON.stringify(args));
  check("★ handleReinitDone 【不】直接进 authed（会话已作废）",
    args.length > 0 && !args.includes("authed"), JSON.stringify(args));
  const noticeCalls = fn ? find(fn, (n) =>
    ts.isCallExpression(n) && n.expression.getText() === "setLoginNotice" &&
    n.arguments[0] && ts.isStringLiteral(n.arguments[0])) : [];
  check("★ handleReinitDone 设置非空 loginNotice",
    noticeCalls.length > 0 && noticeCalls[0].arguments[0].text.length > 0, "命中 " + noticeCalls.length);
} catch (e) {
  check("★ handleReinitDone 分流", false, String(e && e.message));
}

// ---------- 5. 登录成功后按 needsReinit 分流 ----------
try {
  const text = fnText(app, "handleAuthDone");
  check("★ handleAuthDone 同时含 reinit 与 authed 两个去向",
    text.includes('"reinit"') && text.includes('"authed"'), text.slice(0, 140));
  check("★ handleAuthDone 依据 user.needsReinit 判定", text.includes("needsReinit"));
} catch (e) {
  check("★ handleAuthDone 分流", false, String(e && e.message));
}

// ---------- 6. api.ts：403 + REINIT_REQUIRED → 派发事件（外层 if 块） ----------
// ⚠️ 事件派发被 `if (typeof window !== "undefined")` 又包了一层 ⇒ 必须上溯**所有**祖先 if，不能只看最近一个
try {
  const lit = find(api, (n) => ts.isStringLiteral(n) && n.text === "auth:reinit-required")[0];
  check("★ api.ts 使用事件名 `auth:reinit-required`", !!lit);
  const conds = [];
  let p = lit ? lit.parent : null;
  while (p) {
    if (ts.isIfStatement(p)) conds.push(p.expression.getText());
    p = p.parent;
  }
  check("★ 该派发位于「403 + REINIT_REQUIRED」的 if 块内", conds.some((c) => c.includes("403") && c.includes("REINIT_REQUIRED")),
    JSON.stringify(conds));
} catch (e) {
  check("★ api.ts REINIT 派发", false, String(e && e.message));
}

// ---------- 6b. 跨文件契约：派发端与监听端必须是同一套事件名 ----------
// （单文件断言抓不到「两边各改一半」：api.ts 派发 A、App.tsx 监听 B ⇒ 运行时静默失联，无任何报错）
try {
  const dispatched = find(api, (n) =>
    ts.isNewExpression(n) && n.expression.getText() === "Event" &&
    n.arguments && n.arguments[0] && ts.isStringLiteral(n.arguments[0]) &&
    n.arguments[0].text.startsWith("auth:")).map((n) => n.arguments[0].text);
  const listened = find(app, (n) =>
    ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
    n.expression.name.text === "addEventListener" &&
    n.arguments[0] && ts.isStringLiteral(n.arguments[0]) &&
    n.arguments[0].text.startsWith("auth:")).map((n) => n.arguments[0].text);

  check("★ App.tsx 确实监听 `auth:reinit-required`", listened.includes("auth:reinit-required"), JSON.stringify(listened));
  check("★ api.ts 确实派发 `auth:reinit-required`", dispatched.includes("auth:reinit-required"), JSON.stringify(dispatched));
  const orphan = dispatched.filter((n) => !listened.includes(n));
  check("★ 派发端无「没人监听」的孤儿事件", orphan.length === 0, JSON.stringify(orphan));
} catch (e) {
  check("★ 事件名跨文件契约", false, String(e && e.message));
}

// ---------- 7. AuthUser 带可选 needsReinit ----------
try {
  const iface = interfaceDecl(api, "AuthUser");
  const member = iface && iface.members.find((m) => m.name && m.name.getText() === "needsReinit");
  check("api.ts `AuthUser.needsReinit?` 为可选字段", !!member && !!member.questionToken);
} catch (e) {
  check("api.ts `AuthUser.needsReinit?`", false, String(e && e.message));
}

// ---------- 8. SetupWizard：mode 联合与默认值 ----------
try {
  const props = interfaceDecl(wizard, "Props");
  const modeMember = props && props.members.find((m) => m.name && m.name.getText() === "mode");
  const union = modeMember && modeMember.type;
  const litVals = union && union.types ? union.types.map((t) => t.literal && t.literal.text) : [];
  check("SetupWizard `mode` 联合 = create | reinit",
    litVals.length === 2 && litVals.includes("create") && litVals.includes("reinit"), JSON.stringify(litVals));
  check("★ SetupWizard `mode` 为可选（缺省即 create）", !!modeMember && !!modeMember.questionToken);
  const fn = funcDecl(wizard, "SetupWizard");
  const param = fn && fn.parameters[0];
  const el = param && param.name && param.name.elements
    ? param.name.elements.find((e) => e.name.getText() === "mode") : null;
  check("★ SetupWizard 解构默认 mode = \"create\"",
    !!el && !!el.initializer && ts.isStringLiteral(el.initializer) && el.initializer.text === "create",
    el && el.initializer ? el.initializer.getText() : "(无初始值)");
  check("★ SetupWizard Props 声明 initialUsername", !!props &&
    props.members.some((m) => m.name && m.name.getText() === "initialUsername"));
} catch (e) {
  check("SetupWizard mode 声明", false, String(e && e.message));
}

// ---------- 9. LoginPage：notice 可选 + 向下透传 ----------
try {
  const props = interfaceDecl(login, "Props");
  const noticeMember = props && props.members.find((m) => m.name && m.name.getText() === "notice");
  check("LoginPage `notice?` 为可选字段", !!noticeMember && !!noticeMember.questionToken);
  const passthrough = find(login, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
    !!attrOf(n, "notice") && attrValueText(attrOf(n, "notice")) === "notice");
  check("★ LoginPage 将 notice 透传给内层表单", passthrough.length > 0);
} catch (e) {
  check("LoginPage notice 声明", false, String(e && e.message));
}

// ---------- 10. 找回码常量（前后端共用区间的前端侧） ----------
try {
  const num = (name) => {
    const d = find(recovery, (n) => ts.isVariableDeclaration(n) && n.name.getText() === name)[0];
    return d && d.initializer && ts.isNumericLiteral(d.initializer) ? Number(d.initializer.text) : null;
  };
  check("★ RECOVERY_MIN_LENGTH = 18", num("RECOVERY_MIN_LENGTH") === 18, String(num("RECOVERY_MIN_LENGTH")));
  check("★ RECOVERY_MAX_LENGTH = 24", num("RECOVERY_MAX_LENGTH") === 24, String(num("RECOVERY_MAX_LENGTH")));
  check("已无历史常量 RECOVERY_LEGACY_CODE_LENGTH / RECOVERY_LENGTH",
    !recovery.text.includes("RECOVERY_LEGACY_CODE_LENGTH") && !recovery.text.includes("RECOVERY_LENGTH ="));
} catch (e) {
  check("找回码常量", false, String(e && e.message));
}

// ---------- 11. 找回码「重置视图」文案（该视图不可 SSR 渲染，仅源码级断言） ----------
try {
  check("★ LoginPage 含「区分大小写」提示（源码级）",
    login.text.includes("找回码区分大小写，请按设置时的原始大小写输入"));
  check("★ LoginPage 重置入口文案走常量区间（源码级）",
    login.text.includes("位找回码重置登录密码") &&
    login.text.includes("RECOVERY_MIN_LENGTH}~{RECOVERY_MAX_LENGTH"));
} catch (e) {
  check("LoginPage 重置视图文案", false, String(e && e.message));
}

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
console.log("说明：第 11 组为源码级断言（RecoveryForm 未导出，无法 SSR 渲染到），强度低于前 10 组");
process.exit(fail === 0 ? 0 : 1);
