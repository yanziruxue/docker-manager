import crypto from "node:crypto";
import fs from "node:fs";
import type { IncomingHttpHeaders } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { findUserById } from "./users.js";
import { getSettings } from "./settings.js";
import { dataPath } from "./paths.js";

/**
 * 会话鉴权（单管理员模式）。
 * - 会话存内存 Map，键为 token 的 SHA-256 摘要（内存与落盘均不出现明文 token），
 *   并持久化到 <data>/sessions.json —— 服务重启（含 OTA 重启）从落盘快照恢复。
 * - Cookie httpOnly + sameSite=lax，降低 XSS 窃取与 CSRF 风险。
 * - TTL 取自 settings.user.sessionTimeout（分钟），默认 30。
 * - **空闲超时（仅真实用户活动续期）**：会话创建时固定初始 expiresAt = 创建时间 + TTL。
 *   **只有前端在真实用户活动（mousemove/keydown 等）时调用的 `renewSession`（对应 /api/auth/me）
 *   才会把 expiresAt 滑动刷新为「当前时间 + TTL」**；`getSessionUser`（requireAuth / 业务请求 /
 *   后台数据轮询 / WS 握手）一律**只读校验、不续期**。这样即便页面开着、Dashboard 每 3s 轮询，
 *   只要用户无操作满 TTL 仍会过期 → 空闲自动登出生效；而真实操作期间因活动节流每 ≤30s 续期，不会误踢。
 *   落盘按 5s 节流，重启最多丢失 5s 的滑动量。
 */

export const SESSION_COOKIE = "dockermanagementyanzi_session";

interface Session {
  userId: string;
  /** 绝对到期时间（创建时固定，不随请求延长） */
  expiresAt: number;
}

/** 键为 token 的 SHA-256 摘要 */
const sessions = new Map<string, Session>();

/** 会话落盘文件（含 token 摘要，不含明文 token） */
const SESSIONS_FILE = dataPath("sessions.json");

function tokenHash(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ---------- TTL（带缓存，避免每次请求同步读 settings.json） ----------

let ttlCacheMs = 0;
let ttlCacheAt = 0;
const TTL_CACHE_MS = 5000;

function sessionTtlMs(): number {
  const now = Date.now();
  if (ttlCacheMs && now - ttlCacheAt < TTL_CACHE_MS) return ttlCacheMs;
  const mins = (getSettings()?.user?.sessionTimeout as number) ?? 30;
  const ttl = Math.max(1, Number(mins) || 30) * 60 * 1000;
  ttlCacheMs = ttl;
  ttlCacheAt = now;
  return ttl;
}

/** 设置页保存后调用：使 TTL 缓存立即失效（改「会话超时」后无需重启即生效，对新登录的会话生效） */
export function invalidateSessionTtlCache(): void {
  ttlCacheMs = 0;
  ttlCacheAt = 0;
}

// ---------- 持久化（跨重启按原到期时间恢复） ----------

function loadSessions(): void {
  try {
    if (!fs.existsSync(SESSIONS_FILE)) return;
    const parsed = JSON.parse(fs.readFileSync(SESSIONS_FILE, "utf-8"));
    const arr = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    const now = Date.now();
    let alive = 0;
    for (const item of arr) {
      if (
        typeof item?.tokenHash !== "string" ||
        typeof item?.userId !== "string" ||
        typeof item?.expiresAt !== "number"
      ) {
        continue;
      }
      if (item.expiresAt <= now) continue; // 丢弃已过期
      sessions.set(item.tokenHash, {
        userId: item.userId,
        expiresAt: item.expiresAt,
      });
      alive++;
    }
    if (alive) console.log(`[auth] 已恢复 ${alive} 个会话（按原到期时间继续计时）`);
  } catch {
    /* 文件损坏则从空开始 */
  }
}

function persistSessions(): void {
  try {
    const arr = [...sessions.entries()].map(([tokenHash, s]) => ({
      tokenHash,
      userId: s.userId,
      expiresAt: s.expiresAt,
    }));
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: arr }, null, 2), "utf-8");
  } catch {
    /* 写失败忽略（内存会话仍可用） */
  }
}

// 滑动续期落盘节流：高频请求下避免每次都写盘
let lastPersistAt = 0;
const PERSIST_THROTTLE_MS = 5000;

function schedulePersistSessions(): void {
  const now = Date.now();
  if (now - lastPersistAt >= PERSIST_THROTTLE_MS) {
    lastPersistAt = now;
    persistSessions();
  }
}

loadSessions();

// ---------- Cookie 解析 ----------

/** 兼容 Express Request 与 Node IncomingMessage（WebSocket 握手请求） */
type CookieCarrier = { headers: IncomingHttpHeaders };

function parseCookies(req: CookieCarrier): Record<string, string> {
  const raw = req.headers.cookie || "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * 当前会话用户（无效/过期返回 null）。**只读校验、不刷新 expiresAt**。
 * 用于 requireAuth、业务请求、后台数据轮询、WS 握手等——这些都不应延长会话有效期，
 * 否则页面后台轮询会永久维持会话，空闲超时失效。
 * 会话续期只发生在 renewSession（前端真实用户活动触发）。
 */
export function getSessionUser(req: CookieCarrier): { id: string; username: string; role: string } | null {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const key = tokenHash(raw);
  const s = sessions.get(key);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  const user = findUserById(s.userId);
  if (!user) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  // 只读校验：命中有效会话即返回，不刷新到期时间（续期见 renewSession）。
  return { id: user.id, username: user.username, role: user.role };
}

/**
 * 滑动续期（**仅在真实用户活动时调用**，对应前端 /api/auth/me）。
 * 命中有效会话时把 expiresAt 刷新为「当前时间 + TTL」；其余逻辑与 getSessionUser 一致。
 * 与 getSessionUser 的区别：会延长会话有效期，使「持续有真实活动」的用户不被登出；
 * 后台数据轮询、WS 心跳等不得调用本函数，否则空闲超时失效。
 */
export function renewSession(req: CookieCarrier): { id: string; username: string; role: string } | null {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const key = tokenHash(raw);
  const s = sessions.get(key);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  const user = findUserById(s.userId);
  if (!user) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  // 空闲超时（滑动窗口）：仅在真实用户活动时刷新到期时间
  const ttl = sessionTtlMs();
  const newExpires = Date.now() + ttl;
  if (newExpires > s.expiresAt) {
    s.expiresAt = newExpires;
    schedulePersistSessions();
  }
  return { id: user.id, username: user.username, role: user.role };
}

/**
 * 只读会话检查（**不刷新** expiresAt）。用于前端「探活」心跳 /api/auth/ping：
 * 人离开页面开着时，前端每 60s 探一次，会话真过期则服务端返回 401，前端据此登出；
 * 该接口本身不参与滑动续期，不会维持会话。
 * （getSessionUser 现同为只读校验；renewSession 才是唯一会滑动续期的入口。）
 */
export function peekSessionUser(req: CookieCarrier): { id: string; username: string; role: string } | null {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const key = tokenHash(raw);
  const s = sessions.get(key);
  if (!s) return null;
  if (s.expiresAt <= Date.now()) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  const user = findUserById(s.userId);
  if (!user) {
    sessions.delete(key);
    persistSessions();
    return null;
  }
  return { id: user.id, username: user.username, role: user.role };
}

/** 创建会话并下发 Cookie（expiresAt 与 Cookie maxAge 均为绝对到期时间） */
export function createSession(res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = sessionTtlMs();
  sessions.set(tokenHash(token), { userId, expiresAt: Date.now() + ttl });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ttl,
    path: "/",
  });
  persistSessions();
}

/** 销毁会话（登出） */
export function destroySession(req: Request, res: Response): void {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) {
    sessions.delete(tokenHash(raw));
    persistSessions();
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * 销毁指定用户的**全部**会话（含当前浏览器与其他设备）。
 * 用于「账号重新初始化」完成后强制所有人重新登录（用户名/密码已变更）。
 * @returns 被清除的会话数量
 */
export function destroySessionsForUser(userId: string): number {
  let removed = 0;
  for (const [key, s] of sessions.entries()) {
    if (s.userId === userId) {
      sessions.delete(key);
      removed++;
    }
  }
  if (removed) persistSessions();
  return removed;
}

/** 鉴权中间件：未登录/已超时返回 401（不做任何续期） */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: "未登录或会话已过期" });
    return;
  }
  (req as any).user = user;
  next();
}
