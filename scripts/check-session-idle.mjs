#!/usr/bin/env node
/**
 * 会话「空闲超时」链路门禁（v1.51.10）
 *
 * 为什么存在：本项目在这条链路上栽过两次 ——
 *  ① `getSessionUser` 曾顺手续期 ⇒ Dashboard 每 3s 轮询把会话永久续住 ⇒ 挂机永不登出；
 *  ② 401 派发曾用 `!url.startsWith("/auth/")` 把整个 /auth/ 前缀排除 ⇒ ping 的 401 被吞掉，
 *     会话过期了用户还停在页面上；
 *  ③ v1.51.10 新增：Cookie `maxAge` 只在登录下发一次、续期不重发 ⇒ 浏览器在登录后满一个 TTL
 *     删掉 Cookie，持续操作的用户也被登出，空闲超时退化成绝对超时。
 * 这三类回归都是「源码看起来对、运行时静默错」，靠渲染断言抓不到，故做结构断言。
 *
 * 覆盖：Cookie 同步滑动接线 / ping 与只读校验绝不续期 / 401 白名单 / 前端按 TTL 自适应节流探活。
 * 不覆盖：真实浏览器计时行为（由人工冒烟补）。零新依赖、零网络。
 *
 * 跑法：`npm run test:sessionidle`（或直接 `node scripts/check-session-idle.mjs`）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const auth = read("server/auth.ts");
const srv = read("server/index.ts");
const api = read("src/api.ts");
const app = read("src/App.tsx");

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

/** 截取一个路由处理函数（到下一个指定路由签名为止） */
function routeBody(text, sig, nextSig) {
  const i = text.indexOf(sig);
  if (i < 0) return null;
  const j = nextSig ? text.indexOf(nextSig, i + sig.length) : -1;
  return text.slice(i, j > i ? j : text.length);
}

/** 截取一个顶层函数（到下一个 JSDoc 注释块为止；本项目每个导出函数前都有 JSDoc） */
function fnBody(text, sig) {
  const i = text.indexOf(sig);
  if (i < 0) return null;
  const j = text.indexOf("\n/**", i + sig.length);
  return text.slice(i, j > i ? j : text.length);
}

const meRoute = routeBody(srv, 'app.get("/api/auth/me"', 'app.get("/api/auth/ping"');
const pingRoute = routeBody(srv, 'app.get("/api/auth/ping"', 'app.post("/api/auth/password"');
const heartbeat = routeBody(app, "  // 会话心跳", "  const handleAuthDone");
const getSessionUserBody = fnBody(auth, "export function getSessionUser(");
const renewSessionBody = fnBody(auth, "export function renewSession(");
const peekSessionUserBody = fnBody(auth, "export function peekSessionUser(");
const refreshCookieBody = fnBody(auth, "export function refreshSessionCookie(");
const cookieOptionsBody = fnBody(auth, "function sessionCookieOptions(");

// ---------- 0. 锚点必须存在（锚点失效直接判 FAIL，避免"取到空串"导致假绿） ----------
check("★ 锚点齐备：/auth/me、/auth/ping、心跳 effect、4 个会话函数全部可定位",
  !!meRoute && !!pingRoute && !!heartbeat && !!getSessionUserBody && !!renewSessionBody &&
  !!peekSessionUserBody && !!refreshCookieBody && !!cookieOptionsBody,
  [meRoute, pingRoute, heartbeat, getSessionUserBody, renewSessionBody,
    peekSessionUserBody, refreshCookieBody, cookieOptionsBody]
    .map((x, i) => (x ? "" : ["me", "ping", "heartbeat", "getSessionUser", "renewSession", "peekSessionUser", "refreshCookie", "cookieOptions"][i]))
    .filter(Boolean).join(",") || "全部命中");

// ---------- 1. Cookie maxAge 必须随服务端 expiresAt 同步滑动 ----------
check("★ auth.ts 定义 refreshSessionCookie（重发 Cookie 同步滑动 maxAge）",
  !!refreshCookieBody && refreshCookieBody.includes("res.cookie("));
check("★ refreshSessionCookie 复用 sessionCookieOptions(sessionTtlMs())",
  !!refreshCookieBody && refreshCookieBody.includes("sessionCookieOptions(sessionTtlMs())"));
check("★ sessionCookieOptions 带 maxAge: ttlMs（否则重发仍是绝对过期）",
  !!cookieOptionsBody && /maxAge:\s*ttlMs/.test(cookieOptionsBody));
check("★ createSession 复用同一份 Cookie 选项（登录与续期一致）",
  /res\.cookie\(SESSION_COOKIE,\s*token,\s*sessionCookieOptions\(ttl\)\)/.test(auth));
check("★★ /api/auth/me 续期成功后确实调用 refreshSessionCookie(req, res)",
  !!meRoute && /refreshSessionCookie\(req,\s*res\);/.test(meRoute));
check("★ /api/auth/me 仍走 renewSession(req)（唯一滑动续期入口）",
  !!meRoute && /renewSession\(req\)/.test(meRoute));
check("★ /api/auth/me 下发 sessionTimeout（供前端按设置值自适应）",
  !!meRoute && /sessionTimeout:\s*getSessionTimeoutMinutes\(\)/.test(meRoute));
check("★ auth.ts 导出 getSessionTimeoutMinutes",
  /export function getSessionTimeoutMinutes\(\)/.test(auth));

// ---------- 2. 探活与只读校验绝不续期（历史回归 ①） ----------
check("★★ /api/auth/ping 走 peekSessionUser(req)（只读）",
  !!pingRoute && /peekSessionUser\(req\)/.test(pingRoute));
check("★★ /api/auth/ping 绝不调用 renewSession / refreshSessionCookie",
  !!pingRoute && !/renewSession|refreshSessionCookie/.test(pingRoute));
check("★★ getSessionUser 函数体不含 expiresAt 赋值（后台轮询不得续期）",
  !!getSessionUserBody && !/expiresAt\s*=[^=]/.test(getSessionUserBody));
check("★★ peekSessionUser 函数体不含 expiresAt 赋值",
  !!peekSessionUserBody && !/expiresAt\s*=[^=]/.test(peekSessionUserBody));
check("★ renewSession 函数体含 expiresAt 赋值（滑动窗口）",
  !!renewSessionBody && /expiresAt\s*=[^=]/.test(renewSessionBody));

// ---------- 3. 401 派发白名单不得吞掉 me / ping 的 401（历史回归 ②） ----------
const whitelist = api.split("\n").find((l) => l.includes("PRE_LOGIN_401_ENDPOINTS =")) || "";
check("★ api.ts 存在 PRE_LOGIN_401_ENDPOINTS 白名单", whitelist.length > 0);
check("★★ 白名单不含 /auth/me 与 /auth/ping（否则过期后登不出去）",
  !!whitelist && !whitelist.includes("/auth/me") && !whitelist.includes("/auth/ping"));
check("★ api.ts 保留 4 个预登录端点",
  ["/auth/login", "/auth/logout", "/auth/init-status", "/auth/init"].every((p) => whitelist.includes(p)));

// ---------- 4. 前端契约：getMe 带回 TTL，心跳按 TTL 自适应（历史回归 ③ 的时间精度） ----------
check("★ api.ts 定义 SessionUser extends AuthUser 且带可选 sessionTimeout",
  /interface SessionUser extends AuthUser/.test(api) && /sessionTimeout\?:\s*number/.test(api));
check("★ getMe() 返回 Promise<SessionUser>（前端才能读到设置值）",
  /export function getMe\(\): Promise<SessionUser>/.test(api));
check("★ 负向：ping 注释不再声称「业务请求负责续期」（与只读实现矛盾）",
  !api.includes("续期由 /auth/me 与业务请求负责"));
check("★ App.tsx 存在 sessionTtlMs state 且默认 30 分钟",
  /const \[sessionTtlMs, setSessionTtlMs\] = useState\(30 \* 60 \* 1000\)/.test(app));
check("★★ 心跳 effect 按 TTL 计算续期节流与探活间隔",
  !!heartbeat && /renewThrottleMs\s*=\s*Math\.min\(30_000[\s\S]{0,140}ttl \/ 4/.test(heartbeat) &&
  /pingIntervalMs\s*=\s*Math\.min\(60_000[\s\S]{0,140}ttl \/ 6/.test(heartbeat));
check("★★ setInterval 使用 pingIntervalMs（不再硬编码 60s）",
  !!heartbeat && /setInterval\([\s\S]*?,\s*pingIntervalMs\s*\)/.test(heartbeat) &&
  !/setInterval\([\s\S]*?,\s*60 \* 1000\s*\)/.test(heartbeat));
check("★ 心跳 effect 依赖 [authState, sessionTtlMs]（改设置后重算间隔）",
  !!heartbeat && /\}, \[authState, sessionTtlMs\]\);/.test(heartbeat));
check("★ 活动续期成功后按 /auth/me 下发的 sessionTimeout 更新 TTL",
  !!heartbeat && /u\?\.sessionTimeout/.test(heartbeat) && /setSessionTtlMs\(/.test(heartbeat));
check("★ 仍监听 6 个真实用户活动事件（不靠后台轮询判定「有操作」）",
  !!heartbeat && ["mousemove", "mousedown", "keydown", "pointerdown", "wheel", "touchstart"]
    .every((e) => heartbeat.includes('"' + e + '"')));
check("★★ 心跳 effect 内不得出现 setAuthState（禁止前端本地计时主动登出）",
  !!heartbeat && !heartbeat.includes("setAuthState("));

console.log("\n结果: PASS=" + pass + " FAIL=" + fail);
console.log("说明：源码级结构断言；真实计时行为需人工冒烟（设置 1 分钟后挂机 / 持续操作两种场景）");
process.exit(fail === 0 ? 0 : 1);
