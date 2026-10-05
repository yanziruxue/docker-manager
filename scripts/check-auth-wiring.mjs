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
const pwdInput = parse("src/components/PasswordInput.tsx", ts.ScriptKind.TSX);
const settings = parse("src/pages/Settings.tsx", ts.ScriptKind.TSX);
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

// ---------- 12. 密码框「小眼睛」（显示 / 隐藏明文） ----------
// 为什么单列一组：`renderToStaticMarkup` 只能验初始态（永远掩码），验不到「点一下变明文」。
// 本组用 AST 断言状态迁移链路 + **跨文件复用契约**，覆盖 SSR 渲不到的组件与全部 9 个调用点：
//   登录页 3（登录 / 新密码 / 确认新密码）+ 向导 2（密码 / 确认密码）+ 设置页 4（原 / 新 / 确认 / 当前）。
try {
  // ---- 12a. 共享组件本体 ----
  const pwFn = funcDecl(pwdInput, "PasswordInput");
  check("★ 抽出共享组件 PasswordInput（src/components/PasswordInput.tsx）", !!pwFn);
  const pwDecl = find(pwdInput, (n) =>
    ts.isFunctionDeclaration(n) && n.name && n.name.text === "PasswordInput")[0];
  check("★ 组件带 export 标记（供三个页面 import）",
    !!pwDecl && (pwDecl.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword));

  // type 必须由 visible 驱动 —— 否则小眼睛点了也不会变
  const inputEl = pwFn ? find(pwFn, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "Input")[0] : null;
  const typeExpr = inputEl ? String(attrValueText(attrOf(inputEl, "type")) || "") : "";
  check("★★ 密码框 type 由 visible 驱动（visible ? \"text\" : \"password\"）",
    typeExpr.includes("visible") && typeExpr.includes('"text"') && typeExpr.includes('"password"'), typeExpr);
  const cls = inputEl ? String(attrValueText(attrOf(inputEl, "className")) || "") : "";
  check("★ 内边距按 lockIcon 分支（有锁 pl-9 pr-9 / 无锁仅 pr-9）",
    cls.includes("lockIcon") && cls.includes("pl-9") && cls.includes("pr-9"), cls);
  // lockIcon 默认值必须为 true（登录页与向导保留锁图标；设置页显式传 false 保持原观感）
  const lockParam = pwFn && pwFn.parameters[0];
  const lockEl = lockParam && lockParam.name && lockParam.name.elements
    ? lockParam.name.elements.find((e) => e.name.getText() === "lockIcon") : null;
  check("★ lockIcon 默认 true（登录页 / 向导保留锁图标）",
    !!lockEl && !!lockEl.initializer && lockEl.initializer.getText() === "true",
    lockEl && lockEl.initializer ? lockEl.initializer.getText() : "(无默认值)");

  // ---- 12b. ★★ 小眼睛按钮必须是 type="button"（表单是原生 <form onSubmit>，默认 submit 会直接提交）----
  const eyeBtn = pwFn ? find(pwFn, (n) =>
    ts.isJsxOpeningElement(n) && n.tagName.getText() === "button" &&
    String(attrValueText(attrOf(n, "aria-label")) || "").includes("密码"))[0] : null;
  check("★ 小眼睛按钮带 aria-label（无障碍 + 悬浮提示）", !!eyeBtn);
  check("★★ 小眼睛按钮 type=\"button\"（★ 本项最关键不变量：漏写会一点就提交表单）",
    !!eyeBtn && attrValueText(attrOf(eyeBtn, "type")) === "button",
    eyeBtn ? String(attrValueText(attrOf(eyeBtn, "type"))) : "(未找到按钮)");
  const ariaExpr = eyeBtn ? String(attrValueText(attrOf(eyeBtn, "aria-label")) || "") : "";
  check("★ aria-label 随 visible 在「显示密码 / 隐藏密码」间切换",
    ariaExpr.includes("显示密码") && ariaExpr.includes("隐藏密码"), ariaExpr);
  check("★ 小眼睛按钮 onClick 指向 onToggle", !!eyeBtn && !!attrOf(eyeBtn, "onClick"));
  check("★★ onMouseDown 阻止默认（点按钮不抢焦点，可继续在输入框打字）",
    !!pwFn && /onMouseDown[\s\S]{0,80}preventDefault/.test(pwFn.getText()));
  check("★ 明文态图标切到 EyeOff、掩码态为 Eye",
    !!pwFn && /EyeOff[\s\S]{0,40}Eye/.test(pwFn.getText()));

  // ---- 12c. ★ 跨文件复用契约：全部调用点走共享组件 ----
  // ⚠️ 注意 `SecretField`（设置页的密钥行包装组件）内部那一个是**透传**：
  //    visible/onToggle 来自 props，真正的具体状态在它的调用点上。
  //    因此统计「绑定了具体状态」的调用点时要把它排除，另用专门断言覆盖它。
  const isInSecretField = (n) => {
    let p = n;
    while (p && !ts.isFunctionDeclaration(p)) p = p.parent;
    return !!(p && p.name && p.name.getText() === "SecretField");
  };
  const usesIn = (src, opts = {}) => find(src, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "PasswordInput"
    && !(opts.excludeWrapper && isInSecretField(n)));
  const importsIt = (src) => /import\s*\{[^}]*\bPasswordInput\b[^}]*\}/.test(src.text);
  const PLAN = [
    ["登录页 LoginPage", login, 3, ["showPassword", "showNew", "showConfirm"], {}],
    ["设置向导 SetupWizard", wizard, 2, ["showPassword", "showConfirm"], {}],
    // 设置页「绑定具体状态」的 4 个：原密码 / 新密码 / 确认新密码 / 当前密码
    //（SMTP 密码与 Webhook 密钥走 SecretField，见下方专门断言）
    ["设置页 Settings", settings, 4, ["showOld", "showNew", "showConfirm", "showPassword"], { excludeWrapper: true }],
  ];
  let totalUses = 0;
  for (const [name, src, want, flags, opts] of PLAN) {
    const uses = usesIn(src, opts);
    totalUses += uses.length;
    check(`★ ${name}：import 了共享组件`, importsIt(src));
    check(`★ ${name}：${want} 个密码框全部走 PasswordInput（实得 ${uses.length}）`, uses.length === want);

    const vis = uses.map((el) => String(attrValueText(attrOf(el, "visible")) || ""));
    const tog = uses.map((el) => String(attrValueText(attrOf(el, "onToggle")) || ""));
    check(`★ ${name}：每个调用点都传 visible 且绑定独立状态`,
      vis.length === want && vis.every((v) => flags.includes(v)) && new Set(vis).size === want, JSON.stringify(vis));
    check(`★ ${name}：每个调用点都传 onToggle 且指向对应 setter`,
      tog.length === want && tog.every((t) => /^(\(\) => )?setShow[A-Z]/.test(t)), JSON.stringify(tog));

    // ⚠️ 本项目写法是 `const [showX, setShowX] = useState(false)` —— 类型实参挂在**调用表达式**上，
    //    VariableDeclaration.name 是 ArrayBindingPattern 而非 Identifier（同第 1 组的坑），
    //    必须先按 BindingElement 找名字再上溯两级取 initializer。
    const flagDecl = (fname) => {
      const el = find(src, (n) => ts.isBindingElement(n) && n.name && n.name.getText() === fname)[0];
      return el && el.parent && el.parent.parent; // BindingElement → ArrayBindingPattern → VariableDeclaration
    };
    const decls = flags.map(flagDecl);
    const isFalseState = (d) => d && d.initializer && ts.isCallExpression(d.initializer) &&
      d.initializer.arguments[0] && d.initializer.arguments[0].kind === ts.SyntaxKind.FalseKeyword;
    check(`★ ${name}：显示状态 ${flags.join(" / ")} 齐备`, decls.every(Boolean),
      flags.filter((f, i) => !decls[i]).join(",") || "全部存在");
    check(`★ ${name}：显示状态初值均为 false（默认掩码，不默认亮明文）`, decls.every(isFalseState),
      decls.map((d) => (d && d.initializer ? d.initializer.getText() : "(无)")).join(" | "));
  }
  check("★★ 三个页面合计 9 个「绑定具体状态」的密码框调用点", totalUses === 9, "实得 " + totalUses);

  // ---- 12c-2. SecretField 包装组件（设置页密钥行）----
  const secretFn = funcDecl(settings, "SecretField");
  const wrapperUses = secretFn ? find(secretFn, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "PasswordInput") : [];
  check("★ SecretField 内部有且仅有 1 个 PasswordInput 透传", wrapperUses.length === 1, "实得 " + wrapperUses.length);
  check("★ 该透传的 visible / onToggle 来自 props（由调用点决定具体状态）",
    wrapperUses.length === 1
    && attrValueText(attrOf(wrapperUses[0], "visible")) === "visible"
    && attrValueText(attrOf(wrapperUses[0], "onToggle")) === "onToggle",
    wrapperUses.length === 1 ? `${attrValueText(attrOf(wrapperUses[0], "visible"))} / ${attrValueText(attrOf(wrapperUses[0], "onToggle"))}` : "");
  const secretCalls = find(settings, (n) =>
    (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) && n.tagName.getText() === "SecretField");
  const secretVis = secretCalls.map((el) => String(attrValueText(attrOf(el, "visible")) || ""));
  check("★★ SecretField 的 2 个调用点（Webhook 密钥 / SMTP 密码）各绑独立状态且互不相同",
    secretCalls.length === 2 && new Set(secretVis).size === 2
    && secretVis.includes("showWebhookSecret") && secretVis.includes("showEmailPassword"),
    JSON.stringify(secretVis));
  // ⚠️ 不能断言「9 个 visible 名字全局唯一」—— 它们是**组件内局部**状态，
  //    `showPassword` 在 LoginForm / RecoveryForm / SetupWizard 三处同名完全正常。
  //    真正的风险是「**同一组件内**两个密码框共用一个状态」⇒ 点一个眼睛另一个也跟着变。
  for (const [name, src] of PLAN) {
    const groups = new Map();
    for (const u of usesIn(src)) {
      let p = u;
      while (p && !ts.isFunctionDeclaration(p)) p = p.parent; // 上溯到最近的组件函数
      const key = p && p.name ? p.name.getText() : "(顶层)";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(String(attrValueText(attrOf(u, "visible")) || ""));
    }
    const bad = [...groups.entries()].filter(([, v]) => new Set(v).size !== v.length);
    check(`★ ${name}：同一组件内各密码框的 visible 状态互不相同（否则点一个眼睛连带影响其它框）`,
      bad.length === 0, bad.map(([k, v]) => `${k}→${v.join("/")}`).join("; ") || `${groups.size} 个组件均无冲突`);
  }

  // ---- 12d. ★ 负向：目标组件内不得再有硬编码 type="password" 的 Input（漏改的密码框会没有小眼睛）----
  const hardIn = (src, fnNames) => {
    const out = [];
    for (const fnName of fnNames) {
      const fn = funcDecl(src, fnName) || arrowFn(src, fnName);
      if (!fn) continue;
      out.push(...find(fn, (n) =>
        (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
        n.tagName.getText() === "Input" && attrValueText(attrOf(n, "type")) === "password"));
    }
    return out;
  };
  check("★ 负向：LoginPage 内无硬编码 type=\"password\" 的 Input", hardIn(login, ["LoginPage", "LoginForm", "RecoveryForm"]).length === 0);
  check("★ 负向：SetupWizard 内无硬编码 type=\"password\" 的 Input", hardIn(wizard, ["SetupWizard"]).length === 0);
  check("★ 负向：设置页改密码 / 找回码重设两组件内无硬编码 type=\"password\" 的 Input",
    hardIn(settings, ["ChangePasswordForm", "RecoveryCodeForm"]).length === 0,
    "实得 " + hardIn(settings, ["ChangePasswordForm", "RecoveryCodeForm"]).length);
  check("★ 设置页全部 PasswordInput（4 个具体字段 + SecretField 内 1 个透传）都显式传 lockIcon={false}",
    usesIn(settings).length === 5 && usesIn(settings).every((el) => attrValueText(attrOf(el, "lockIcon")) === "false"),
    `共 ${usesIn(settings).length} 处，其中 lockIcon={false} 的 ` + usesIn(settings).filter((el) => attrValueText(attrOf(el, "lockIcon")) === "false").length + " 处");
} catch (e) {
  check("密码框小眼睛接线", false, String(e && e.message));
}

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
console.log("说明：第 11 组为源码级断言（RecoveryForm 未导出，无法 SSR 渲染到），强度低于前 10 组");
console.log("说明：第 12 组同样是源码级断言 —— 小眼睛的「切态」需真实浏览器点击才能端到端验证（无 DOM 环境）");
process.exit(fail === 0 ? 0 : 1);
