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
 *   并持久化到 <data>/sessions.json —— 服务重启（含 OTA 重启）后自动恢复，无需重新登录。
 * - Cookie httpOnly + sameSite=lax，降低 XSS 窃取与 CSRF 风险。
 * - TTL 取自 settings.user.sessionTimeout（分钟），默认 30。
 * - **滑动过期**：命中有效会话即续期，使其表现为「空闲超时」——
 *   只要 TTL 分钟内有任意请求，就一直保持登录；停止访问满 TTL 分钟后才过期。
 */

export const SESSION_COOKIE = "docker-manager-yanzi_session";

interface Session {
  userId: string;
  expiresAt: number;
  /** 上次重下发 Cookie 的时间（节流用） */
  cookieAt?: number;
}

/** 键为 token 的 SHA-256 摘要 */
const sessions = new Map<string, Session>();

/** 会话落盘文件（含 token 摘要，不含明文 token） */
const SESSIONS_FILE = dataPath("sessions.json");
/** 落盘节流：滑动续期很频繁，避免每次请求都写磁盘 */
const PERSIST_INTERVAL_MS = 30 * 1000;
/** Cookie 重下发节流：避免每个 API 响应都带 Set-Cookie */
const COOKIE_REFRESH_MS = 60 * 1000;
let lastPersistAt = 0;

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

/** 设置页保存后调用：使 TTL 缓存立即失效（改「会话超时」后无需重启即生效） */
export function invalidateSessionTtlCache(): void {
  ttlCacheMs = 0;
  ttlCacheAt = 0;
}

// ---------- 持久化（跨重启恢复） ----------

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
        cookieAt: item.cookieAt,
      });
      alive++;
    }
    if (alive) console.log(`[auth] 已恢复 ${alive} 个会话（跨重启保持登录）`);
  } catch {
    /* 文件损坏则从空开始 */
  }
}

function persistSessions(force = false): void {
  const now = Date.now();
  if (!force && now - lastPersistAt < PERSIST_INTERVAL_MS) return;
  lastPersistAt = now;
  try {
    const arr = [...sessions.entries()].map(([tokenHash, s]) => ({
      tokenHash,
      userId: s.userId,
      expiresAt: s.expiresAt,
      cookieAt: s.cookieAt,
    }));
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify({ sessions: arr }, null, 2), "utf-8");
  } catch {
    /* 写失败忽略（内存会话仍可用） */
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
 * 当前会话用户（无效/过期返回 null）。
 * 命中有效会话时滑动续期（空闲超时语义），并节流写盘。
 */
export function getSessionUser(req: CookieCarrier): { id: string; username: string; role: string } | null {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (!raw) return null;
  const key = tokenHash(raw);
  const s = sessions.get(key);
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt < now) {
    sessions.delete(key);
    persistSessions(true);
    return null;
  }
  const user = findUserById(s.userId);
  if (!user) {
    sessions.delete(key);
    persistSessions(true);
    return null;
  }
  // 滑动续期：只要在 TTL 内活动，就持续保持登录
  s.expiresAt = now + sessionTtlMs();
  persistSessions();
  return { id: user.id, username: user.username, role: user.role };
}

/** 创建会话并下发 Cookie */
export function createSession(res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = sessionTtlMs();
  const now = Date.now();
  sessions.set(tokenHash(token), { userId, expiresAt: now + ttl, cookieAt: now });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ttl,
    path: "/",
  });
  persistSessions(true);
}

/** 销毁会话（登出） */
export function destroySession(req: Request, res: Response): void {
  const raw = parseCookies(req)[SESSION_COOKIE];
  if (raw) {
    sessions.delete(tokenHash(raw));
    persistSessions(true);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** 鉴权中间件：未登录返回 401；命中会话时同步刷新 Cookie 有效期 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: "未登录或会话已过期" });
    return;
  }
  const raw = parseCookies(req)[SESSION_COOKIE];
  const s = raw ? sessions.get(tokenHash(raw)) : undefined;
  if (raw && s) {
    const now = Date.now();
    // 节流重下发 Cookie，使其 maxAge 与服务端滑动过期保持同步
    if (!s.cookieAt || now - s.cookieAt > COOKIE_REFRESH_MS) {
      s.cookieAt = now;
      res.cookie(SESSION_COOKIE, raw, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: sessionTtlMs(),
        path: "/",
      });
      persistSessions(true);
    }
  }
  (req as any).user = user;
  next();
}
