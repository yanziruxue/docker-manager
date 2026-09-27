#!/usr/bin/env node
/**
 * 账号 UI 渲染断言（v1.31.0）
 *
 * 为什么存在：`agent-browser` 拉起的 Chromium 启动时会去连 `clients2.google.com`
 * （组件更新 / 网络时间 / 域名可靠性上报）。该域在国内不可达，且沙箱会拦截并询问，
 * 会把整条验证命令 SIGTERM 掉 —— 于是「前端到底有没有接线」一度完全没验证。
 *
 * 做法：**不拉浏览器、不装 jsdom**（本机无 DOM 环境、npm 走官方源国内不稳），
 * 改用「已在装的 esbuild 打包临时入口 → Node 里 `react-dom/server` 渲染**真身组件**」。
 * `renderToStaticMarkup` 不执行 useEffect ⇒ 渲染期零网络请求，可离线跑。
 *
 * 覆盖：组件**接线**（mode 分支 / notice 提示条 / 预填 / 必填性 / 文案）—— 正是本项目
 *       栽过两次的「装饰性 stub、UI 未必接线」那类缺陷。
 * 不覆盖：状态**迁移**（无 DOM 无法触发交互）。那部分由 `check-auth-wiring.mjs` 的
 *       源码级断言兜底，真实浏览器交互回归仍需人工/后续补。
 *
 * 跑法：`npm run test:auth`（或直接 `node scripts/check-auth-render.mjs`）
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, ".tmp-auth-render");

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

/** 剥掉 HTML 注释 → 标签 → 折叠空白，得到可见文本（注释必须先去，否则 React SSR 的 `<!-- -->` 会把 18~24 拆断） */
function toText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// 临时入口：一次性渲染三种变体，供正负对照
const ENTRY = `
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupWizard } from "./src/components/auth/SetupWizard";
import { LoginPage } from "./src/components/auth/LoginPage";

const noop = () => {};

export function render() {
  const g = globalThis;
  g.__fetchCalls = 0;
  g.fetch = function () {
    g.__fetchCalls++;
    throw new Error("断言环境：渲染期不应发起任何网络请求");
  };
  const reinit = renderToStaticMarkup(
    React.createElement(SetupWizard, { mode: "reinit", initialUsername: "yanzi-admin", onDone: noop })
  );
  const create = renderToStaticMarkup(
    React.createElement(SetupWizard, { onDone: noop })
  );
  const loginNotice = renderToStaticMarkup(
    React.createElement(LoginPage, { onDone: noop, notice: "账号已重新设置，请使用新的用户名和密码登录" })
  );
  const loginPlain = renderToStaticMarkup(
    React.createElement(LoginPage, { onDone: noop })
  );
  return { reinit, create, loginNotice, loginPlain, fetchCalls: g.__fetchCalls };
}
`;

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

try {
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, loader: "tsx", sourcefile: "auth-render-entry.tsx" },
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    outfile: path.join(TMP, "out.cjs"),
    logLevel: "warning",
  });

  const outFile = path.join(TMP, "out.cjs");
  const { render } = createRequire(import.meta.url)(outFile);
  const r = render();

  const T = {
    reinit: toText(r.reinit),
    create: toText(r.create),
    loginNotice: toText(r.loginNotice),
    loginPlain: toText(r.loginPlain),
  };

  console.log("渲染长度: reinit=" + r.reinit.length + " create=" + r.create.length +
    " loginNotice=" + r.loginNotice.length + " loginPlain=" + r.loginPlain.length + "\n");

  // ---------- A. SetupWizard：两种模式必须可区分 ----------
  check("mode=reinit 标题为「账号重新设置」", T.reinit.includes("账号重新设置"));
  check("mode 缺省（create）标题为「初始设置」", T.create.includes("初始设置"));
  check("★ mode 缺省时【不含】「账号重新设置」（负向对照）", !T.create.includes("账号重新设置"));
  check("mode=reinit 按钮为「保存并继续」", T.reinit.includes("保存并继续"));
  check("mode 缺省按钮为「创建并进入」", T.create.includes("创建并进入"));
  check("★ mode=reinit 有琥珀升级提示条", T.reinit.includes("本次更新调整了账号与密码找回码规则"));
  check("★ mode 缺省【不含】该提示条（负向对照）", !T.create.includes("本次更新调整了账号与密码找回码规则"));
  check("★ mode=reinit 找回码 hint 标「必填」", T.reinit.includes("必填"));
  check("★ mode 缺省找回码 hint 标「可选」且可后补", T.create.includes("可选，") && T.create.includes("留空可稍后"));
  check("★ mode=reinit 预填 initialUsername", r.reinit.includes("yanzi-admin"));
  check("mode 缺省用户名默认 admin", r.create.includes('value="admin"'));
  check("★ 两种模式 hint 均含「区分大小写」", T.reinit.includes("区分大小写") && T.create.includes("区分大小写"));

  // ---------- B. 长度区间文案（不硬编码 24） ----------
  check("★ mode=reinit 渲染出「18~24 位」", T.reinit.includes("18~24 位"));
  check("★ mode 缺省渲染出「18~24 位」", T.create.includes("18~24 位"));
  check("★ 未出现旧文案「必须满 24 位」",
    !T.reinit.includes("必须满 24 位") && !T.create.includes("必须满 24 位"));
  check("计数器按上限 24 渲染（0/24）", /0\/24/.test(T.reinit));
  check("密码字段提示「至少 6 位」在位", T.reinit.includes("至少 6 位"));

  // ---------- C. LoginPage：notice 正负对照 ----------
  const NOTICE = "账号已重新设置，请使用新的用户名和密码登录";
  check("★ 传 notice → 渲染该文案", T.loginNotice.includes(NOTICE));
  check("★ 不传 notice → 不渲染该文案（负向对照）", !T.loginPlain.includes("账号已重新设置"));
  check("★ 传 notice → 绿色提示条 class 在位", r.loginNotice.includes("bg-green-50"));
  check("★ 不传 notice → 无绿色提示条（负向对照）", !r.loginPlain.includes("bg-green-50"));
  check("登录表单标题「登录」在位", T.loginPlain.includes("登录"));
  check("「重置密码」入口在位", T.loginPlain.includes("重置密码"));

  // ---------- D. 渲染期零网络 ----------
  check("★ 渲染期零网络请求", r.fetchCalls === 0, "fetchCalls=" + r.fetchCalls);
} catch (e) {
  fail++;
  console.log("  FAIL  渲染断言执行异常  <<< " + (e && e.message ? e.message : String(e)));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
console.log("未覆盖：状态迁移（点按钮切态）—— 无 DOM 环境，见 check-auth-wiring.mjs 的源码级断言");
process.exit(fail === 0 ? 0 : 1);
