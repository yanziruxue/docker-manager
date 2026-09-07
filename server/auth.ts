import crypto from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import type { Request, Response, NextFunction } from "express";
import { findUserById } from "./users.js";
import { getSettings } from "./settings.js";

/**
 * 会话鉴权（单管理员模式）。
 * - 会话存内存 Map，服务重启即失效，需重新登录。
 * - Cookie httpOnly + sameSite=lax，降低 XSS 窃取与 CSRF 风险。
 * - TTL 取自 settings.user.sessionTimeout（分钟），默认 30。
 */

export const SESSION_COOKIE = "docker-manager-yanzi_session";

interface Session {
  userId: string;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function sessionTtlMs(): number {
  const mins = (getSettings()?.user?.sessionTimeout as number) ?? 30;
  return Math.max(1, Number(mins) || 30) * 60 * 1000;
}

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

/** 当前会话用户（无效/过期返回 null） */
export function getSessionUser(req: CookieCarrier): { id: string; username: string; role: string } | null {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const user = findUserById(s.userId);
  if (!user) {
    sessions.delete(token);
    return null;
  }
  return { id: user.id, username: user.username, role: user.role };
}

/** 创建会话并下发 Cookie */
export function createSession(res: Response, userId: string): void {
  const token = crypto.randomBytes(32).toString("hex");
  const ttl = sessionTtlMs();
  sessions.set(token, { userId, expiresAt: Date.now() + ttl });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: ttl,
    path: "/",
  });
}

/** 销毁会话（登出） */
export function destroySession(req: Request, res: Response): void {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) sessions.delete(token);
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/** 鉴权中间件：未登录返回 401 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ success: false, error: "未登录或会话已过期" });
    return;
  }
  (req as any).user = user;
  next();
}
