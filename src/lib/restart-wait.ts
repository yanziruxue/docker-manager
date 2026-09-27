/**
 * OTA 更新完成后的「等后端重启 → 刷新页面」统一实现。
 *
 * ## 为什么需要它（v1.31.1 修的缺陷）
 *
 * 原先两条更新链路各自用 `fetchAppVersion()`（走 `request()` 封装，非 2xx 会 **抛异常**）
 * 当作「新进程是否已上线」的判据：
 * - `src/App.tsx` 的自动更新（设置里开了 autoUpdate 时）
 * - `src/pages/Settings.tsx` 手动点「应用更新」/「应用本地更新包」
 *
 * v1.31.0 引入「账号待重新设置」拦截层后，`/api/system/version` **不在** REINIT 白名单内，
 * 于是升级后（老账号尚未重走账号初始化）该端点必然返回 **403 REINIT_REQUIRED** ⇒ 被
 * `request()` 抛成异常 ⇒ 更新链路把它读成「进程还没起来」⇒
 * **`window.location.reload()` 永远不会执行**，浏览器永久停在**旧前端 bundle**上：
 * 界面看着仍是「已登录」，但点任何业务功能都 403。
 *
 * ## 本模块的判据
 *
 * 用**裸 `fetch`** 探活，把「有没有拿到 HTTP 响应」与「状态码是什么」解耦：
 *
 * | 探活结果 | 含义 | 动作 |
 * |---|---|---|
 * | 403 + `code === "REINIT_REQUIRED"` | **新进程铁证**（带拦截层的版本才这么答，旧版本无此逻辑） | 立即刷新 |
 * | 任意其它响应 | 服务在线（可能是旧进程，也可能是已完成重设的新进程） | 结合阶段判断 |
 * | 网络错误 / 连接被拒 | 进程未上线（重启窗口内） | 记录「已失联」，继续等 |
 *
 * 两阶段：① 等旧进程失联 ② 失联后重新拿到响应 ⇒ 刷新。全程有硬超时，绝不无限轮询。
 */

/** 探活端点（与 `src/api.ts` 的 `fetchAppVersion` 同一端点） */
const VERSION_ENDPOINT = "/api/system/version";

/** 探活结果 */
type ProbeResult = "down" | "up" | "reinit-required";

export interface WaitForRestartOptions {
  /**
   * 全程**未观测到失联**时的兜底刷新时长（毫秒）。
   * - 传数字：到点即刷新。适用于「二进制已替换完成、只剩重启」的**手动更新**路径
   *   （此时刷新是安全的，宁可多刷一次也不卡死）。
   * - 传 `null`：**不盲刷**。适用于**自动更新**路径 —— `applyUpdateApi()` 刚被调用，
   *   二进制可能还在下载（旧进程会正常响应很久），此刻盲刷会打断下载进度并丢掉
   *   随后重启的监听，反而更容易卡死。
   * @default 60_000
   */
  blindReloadAfterMs?: number | null;
  /** 轮询总时长上限（毫秒），超过即静默放弃，不再刷新。@default 600_000 */
  giveUpAfterMs?: number;
  /** 轮询间隔（毫秒）。@default 1000 */
  pollMs?: number;
}

/**
 * 单次探活。**有意使用裸 `fetch` 而非 `request()`**：
 * 后者把非 2xx 抛成异常，会把「新进程已上线但返回 403」误判成「进程还没起来」。
 * 同时不派发 `auth:*` 事件，避免探活干扰鉴权状态机。
 */
async function probe(): Promise<ProbeResult> {
  try {
    const res = await fetch(VERSION_ENDPOINT, { credentials: "include", cache: "no-store" });
    if (res.status === 403) {
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === "REINIT_REQUIRED") return "reinit-required";
    }
    return "up";
  } catch {
    // 连接被拒 / 网络错误 ⇒ 旧进程已退出或新进程尚未监听
    return "down";
  }
}

/**
 * 等待后端重启完成后刷新页面。
 * @returns 取消函数：调用后不再刷新页面（组件卸载时使用）
 */
export function waitForRestartAndReload(options: WaitForRestartOptions = {}): () => void {
  const blindReloadAfterMs = options.blindReloadAfterMs === undefined ? 60_000 : options.blindReloadAfterMs;
  const giveUpAfterMs = options.giveUpAfterMs ?? 600_000;
  const pollMs = options.pollMs ?? 1000;

  let cancelled = false;
  let sawDown = false;
  const startedAt = Date.now();

  const reload = () => {
    window.location.reload();
  };

  const tick = async () => {
    if (cancelled) return;
    const state = await probe();
    if (cancelled) return;

    const elapsed = Date.now() - startedAt;

    // ① 新进程铁证：403 REINIT_REQUIRED（旧版本没有这层拦截，不可能这么答）
    if (state === "reinit-required") {
      reload();
      return;
    }

    if (state === "down") {
      // 旧进程已退出，进入「等新进程上线」阶段
      sawDown = true;
    } else if (sawDown) {
      // ② 失联后重新拿到响应 ⇒ 新进程已上线
      reload();
      return;
    } else if (blindReloadAfterMs != null && elapsed > blindReloadAfterMs) {
      // ③ 一直在线：重启太快没抓到失联窗口，或更新其实没生效 ⇒ 兜底刷新
      reload();
      return;
    }

    if (elapsed > giveUpAfterMs) return; // ④ 总超时：静默放弃，避免无限轮询
    setTimeout(tick, pollMs);
  };

  setTimeout(tick, pollMs);
  return () => {
    cancelled = true;
  };
}
