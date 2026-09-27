#!/usr/bin/env node
/**
 * OTA 重启等待逻辑的回归断言（v1.31.1）
 *
 * 为什么存在：v1.31.0 上线后，升级完成的页面**永远不会自动刷新**（浏览器停在旧前端 bundle，
 * 界面看着仍是「已登录」但点任何功能都 403）。根因是两条更新链路都用 `request()` 封装的
 * `fetchAppVersion()` 当「新进程是否上线」判据，而非 2xx 会被抛成异常 —— 升级后
 * `/api/system/version` 恰好返回 **403 REINIT_REQUIRED**，于是被读成「进程还没起来」。
 *
 * 这类缺陷**静态看不出来、tsc/hooks 门禁也抓不到**，只有把探活序列喂进去才暴露。
 * 本脚本：esbuild 打包 `src/lib/restart-wait.ts`（纯逻辑，无 React）→ 桩 `fetch` / `window`
 * → 用 5ms 轮询跑完 5 种序列。
 *
 * 跑法：`npm run test:restart`
 */
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(ROOT, ".tmp-restart-wait");

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

try {
  await build({
    entryPoints: [path.join(ROOT, "src/lib/restart-wait.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: path.join(TMP, "mod.cjs"),
    logLevel: "warning",
  });

  const mod = createRequire(import.meta.url)(path.join(TMP, "mod.cjs"));
  if (typeof mod.waitForRestartAndReload !== "function") {
    throw new Error("restart-wait.ts 未导出 waitForRestartAndReload");
  }

  const OK = () => ({ status: 200, json: async () => ({}) });
  const REINIT = () => ({ status: 403, json: async () => ({ success: false, code: "REINIT_REQUIRED" }) });
  const OTHER_403 = () => ({ status: 403, json: async () => ({ success: false, code: "FORBIDDEN" }) });
  const DOWN = () => {
    throw new Error("ECONNREFUSED");
  };

  /** 桩：window.location.reload + fetch（按调用序号决定响应） */
  function env(impl) {
    const st = { calls: 0, reloads: 0 };
    globalThis.window = {
      location: {
        reload: () => {
          st.reloads++;
        },
      },
    };
    globalThis.fetch = async (url) => {
      st.calls++;
      st.lastUrl = String(url);
      return impl(st.calls, st);
    };
    return st;
  }

  // ⚠️ 每个场景跑完必须 `cancel()`：等待循环是全局的，泄漏出来的旧循环会继续调用
  //    `globalThis.fetch`（已被下一个场景换成新桩）⇒ 计数串台、假命中。
  //    （首次写本脚本时正是漏了 cancel，3 条用例被误报为 FAIL。）

  // ---------- A. 核心回归：新进程以 403 REINIT_REQUIRED 应答 ----------
  {
    const st = env(REINIT);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5 });
    await sleep(60);
    cancel();
    check("★ 探活得 403 REINIT_REQUIRED ⇒ 立即刷新（旧实现永不刷新）", st.reloads === 1, "reloads=" + st.reloads);
    check("  首次探测即刷新（不需要先等到失联）", st.calls === 1, "calls=" + st.calls);
    check("  探活打的是 /api/system/version", st.lastUrl === "/api/system/version", st.lastUrl);
  }

  // ---------- B. 常规两阶段：失联 → 恢复 ----------
  {
    const st = env((n) => (n <= 2 ? DOWN() : OK()));
    const cancel = mod.waitForRestartAndReload({ pollMs: 5 });
    await sleep(80);
    cancel();
    check("★ 前两次失联、之后恢复 ⇒ 刷新", st.reloads === 1, "reloads=" + st.reloads);
    check("  恢复后不再继续探测", st.calls === 3, "calls=" + st.calls);
  }

  // ---------- C. 自动更新路径：不做盲刷（否则会打断下载） ----------
  {
    const st = env(OK);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5, blindReloadAfterMs: null });
    await sleep(120);
    cancel();
    check(
      "★ blindReloadAfterMs:null + 一直在线 ⇒ 不刷新（避免下载中途刷新、丢掉重启监听）",
      st.reloads === 0,
      "reloads=" + st.reloads
    );
    check("  但仍在持续探测（没有提前退出）", st.calls >= 8, "calls=" + st.calls);
  }

  // ---------- D. 手动更新路径：二进制已替换，允许兜底盲刷 ----------
  {
    const st = env(OK);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5, blindReloadAfterMs: 20 });
    await sleep(90);
    cancel();
    check("★ blindReloadAfterMs:20 + 一直在线 ⇒ 到时兜底刷新（绝不卡死）", st.reloads === 1, "reloads=" + st.reloads);
  }

  // ---------- E. 总超时：静默放弃、不刷新、停止轮询 ----------
  {
    const st = env(DOWN);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5, giveUpAfterMs: 30, blindReloadAfterMs: null });
    await sleep(90);
    const atGiveUp = st.calls;
    await sleep(60);
    cancel();
    check("★ 一直失联且超过总超时 ⇒ 不刷新", st.reloads === 0, "reloads=" + st.reloads);
    check("★ 总超时后停止轮询（不再发起探测）", st.calls === atGiveUp, "calls=" + st.calls + " 冻结于 " + atGiveUp);
  }

  // ---------- F. 判据必须精确到 code，不是「见 403 就刷」 ----------
  {
    const st = env(OTHER_403);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5, blindReloadAfterMs: null });
    await sleep(90);
    cancel();
    check("★ 普通 403（非 REINIT_REQUIRED）不当作「新进程」⇒ 不刷新", st.reloads === 0, "reloads=" + st.reloads);
  }

  // ---------- G. 取消函数 ----------
  {
    const st = env(DOWN);
    const cancel = mod.waitForRestartAndReload({ pollMs: 5 });
    await sleep(20);
    cancel();
    await sleep(15);
    const atCancel = st.calls;
    await sleep(50);
    check("★ 取消后不再探测、不刷新", st.calls === atCancel && st.reloads === 0, "calls=" + st.calls + " reloads=" + st.reloads);
  }

  // ---------- H. 接线契约：两处调用点都必须走统一实现（防有人再抄回旧轮询） ----------
  {
    const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf-8");
    const settings = fs.readFileSync(path.join(ROOT, "src/pages/Settings.tsx"), "utf-8");
    const lib = fs.readFileSync(path.join(ROOT, "src/lib/restart-wait.ts"), "utf-8");

    check(
      "★ App.tsx 自动更新走统一实现且不盲刷",
      app.includes("waitForRestartAndReload({ blindReloadAfterMs: null })")
    );
    check(
      "★ Settings.tsx 手动更新走统一实现且允许兜底盲刷",
      settings.includes("waitForRestartAndReload({ blindReloadAfterMs: 60_000 })")
    );
    check(
      "★ 两处调用点均已无旧轮询残留（attempts 计数 / 自建 sawDown）",
      !app.includes("sawDown") && !settings.includes("sawDown") &&
        !app.includes("attempts > 40") && !settings.includes("attempts >= 30")
    );
    check(
      "★ 两处调用点都会取消上一个等待循环（防重复触发叠出多个轮询）",
      app.includes("restartWaitRef.current?.()") && settings.includes("restartWaitRef.current?.()")
    );
    check(
      "★ 两处调用点都在卸载时收掉等待循环",
      app.includes("restartWaitRef.current = null") && settings.includes("restartWaitRef.current = null")
    );
    check(
      "★ 实现侧显式识别 REINIT_REQUIRED 且用裸 fetch（不经过 request 封装）",
      lib.includes('"REINIT_REQUIRED"') && lib.includes("await fetch(")
    );
  }
} catch (e) {
  fail++;
  console.log("  FAIL  重启等待断言执行异常  <<< " + (e && e.message ? e.message : String(e)));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
console.log("未覆盖：真实 systemd 重启时序（本脚本用桩 fetch 模拟探活序列）");
process.exit(fail === 0 ? 0 : 1);
