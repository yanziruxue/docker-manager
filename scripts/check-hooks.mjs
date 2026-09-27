#!/usr/bin/env node
/**
 * React Hooks 调用顺序静态检查（Rules of Hooks）。
 *
 * 为什么需要它：这类违规**类型系统查不出、构建不报错、只有运行到特定时序才炸**。
 * v1.27.1 就因此把线上打挂过——`Dashboard.tsx` 的两个 `useMinWidth` 写在了
 * `if (loading) return <LoadingState/>` 之后：首次渲染走 Loading 分支（只调用了 2 个 hook），
 * 数据到达后再渲染多出 2 个 hook，React 抛
 * `Rendered more hooks than during the previous render` 并卸载整棵树 → **登录后白屏**。
 * 项目没有 eslint，故自带这个 AST 检查。
 *
 * ⚠️ 判断 A 必须**逐个 hook** 比对，不能只比「首个 hook」与「首个 return」：
 * 像 Dashboard 那样 `useState/useEffect` 在 return 之前、只有后面的 hook 越界，
 * 只比首尾会漏报。
 *
 * 报两类问题：
 *   A. 某个 hook 调用之前存在「可能导致提前退出的 return」（return 可嵌在 if/switch/try 里）
 *   B. hook 调用出现在条件分支 / 逻辑表达式 / 循环体内（可能不执行 → 同样违反规则）
 *
 * 用法：node scripts/check-hooks.mjs [srcDir]   （有违规时退出码 1，可作构建前门禁）
 */
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.argv[2] || "src");
const HOOK = /^use[A-Z]/;

function isFunctionLike(n) {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isArrowFunction(n) ||
    ts.isFunctionExpression(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

/** 该节点内的 hook 调用（**不进入嵌套函数体**——那里的 hook 属于另一个组件/hook 自己的作用域） */
function findHookCalls(node) {
  const out = [];
  const visit = (n) => {
    if (isFunctionLike(n) && n !== node) return;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && HOOK.test(n.expression.text)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** 该节点内是否有 return（**不进入嵌套函数体**，否则 `items.map(i => { return … })` 会误报） */
function hasReturn(node) {
  let found = false;
  const visit = (n) => {
    if (found) return;
    if (isFunctionLike(n) && n !== node) return;
    if (ts.isReturnStatement(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** 语句本身是否「条件执行」（hook 落在里面就可能不执行） */
function isConditionalContainer(n) {
  return (
    ts.isIfStatement(n) ||
    ts.isSwitchStatement(n) ||
    ts.isForStatement(n) ||
    ts.isForOfStatement(n) ||
    ts.isForInStatement(n) ||
    ts.isWhileStatement(n) ||
    ts.isDoStatement(n) ||
    ts.isConditionalExpression(n) ||
    // TS API 没有 isLogicalExpression：`a && useState()` / `a || useState()` 是 BinaryExpression
    (ts.isBinaryExpression(n) &&
      (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        n.operatorToken.kind === ts.SyntaxKind.BarBarToken))
  );
}

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
})(SRC);

const findings = [];

for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rel = path.relative(process.cwd(), file);
  const line = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const checkFn = (fn) => {
    if (fn.body && ts.isBlock(fn.body)) {
      const exits = []; // 可能提前退出的顶层语句
      const hooks = []; // 顶层 hook 调用
      const condHooks = []; // 落在条件容器里的 hook

      for (const stmt of fn.body.statements) {
        if (hasReturn(stmt)) exits.push(stmt);
        for (const c of findHookCalls(stmt)) hooks.push(c);
        if (isConditionalContainer(stmt)) {
          for (const c of findHookCalls(stmt)) condHooks.push({ node: c, at: stmt });
        }
      }

      // A 类：逐个 hook 检查其前面是否有 return
      for (const h of hooks) {
        const hp = h.getStart(sf);
        const before = exits.filter((e) => e.getStart(sf) < hp);
        if (before.length) {
          findings.push({ rel, line: line(h), kind: "A", sig: h.expression.text, at: line(before[0]) });
        }
      }
      // B 类
      for (const c of condHooks) {
        findings.push({ rel, line: line(c.node), kind: "B", sig: c.node.expression.text, at: line(c.at) });
      }
    }
    ts.forEachChild(fn, checkFn);
  };

  const walkNode = (n) => {
    if (isFunctionLike(n)) checkFn(n);
    ts.forEachChild(n, walkNode);
  };
  ts.forEachChild(sf, walkNode);
}

if (!findings.length) {
  console.log(`✅ Hooks 顺序检查通过（扫描 ${files.length} 个 tsx/ts 文件）`);
  process.exit(0);
}

console.log(`❌ 发现 ${findings.length} 处 React Hooks 顺序违规（扫描 ${files.length} 个文件）：\n`);
for (const f of findings) {
  const detail =
    f.kind === "A"
      ? `hook 之前存在提前 return（L${f.at}）→ 该 hook 可能不被执行，下次渲染 hook 数会变`
      : `hook 位于条件分支/循环内（L${f.at}）→ 可能不被执行`;
  console.log(`  ${f.rel}:${f.line}  ${f.sig}()\n      ${detail}\n`);
}
process.exit(1);
