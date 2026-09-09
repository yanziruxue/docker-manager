import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataPath } from "./paths.js";

/**
 * 用户存储（单管理员模式）。
 * 密码仅以 scrypt 哈希 + 随机 salt 落盘，明文不持久化。
 * 与 settings.json 分离，置于 <data>/users.json。
 */

export interface UserRecord {
  id: string;
  username: string;
  role: "admin";
  passwordHash: string; // hex
  salt: string; // hex
  createdAt: string;
  /** 密码找回码哈希（scrypt，hex）。未设置时为 undefined，明文不落盘 */
  recoveryHash?: string;
  /** 找回码 salt（hex） */
  recoverySalt?: string;
  /** 找回码最近一次设置时间 */
  recoverySetAt?: string;
  /** 找回码最近一次用于重置密码的时间（限流用） */
  recoveryLastUsedAt?: string;
}

/** 密码找回码长度（位）—— 仅字母与数字，忽略大小写 */
export const RECOVERY_CODE_LENGTH = 18;
/** 两次使用找回码之间的最小间隔 */
export const RECOVERY_MIN_INTERVAL_MS = 10 * 60 * 1000;
const ALNUM_RE = /^[A-Za-z0-9]+$/;

const USERS_FILE = dataPath("users.json");

function loadUsers(): UserRecord[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const raw = fs.readFileSync(USERS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UserRecord[]) : [];
  } catch {
    return [];
  }
}

function saveUsers(users: UserRecord[]): void {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), "utf-8");
  try {
    fs.chmodSync(USERS_FILE, 0o600);
  } catch {
    /* 权限调整失败不影响功能 */
  }
}

export function countUsers(): number {
  return loadUsers().length;
}

export function getUserByUsername(username: string): UserRecord | undefined {
  const target = username.trim().toLowerCase();
  return loadUsers().find((u) => u.username.trim().toLowerCase() === target);
}

export function findUserById(id: string): UserRecord | undefined {
  return loadUsers().find((u) => u.id === id);
}

/** scrypt 哈希：返回 hex 编码的 hash 与 salt */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

/** 防时序攻击的密码校验 */
export function verifyPassword(password: string, record: UserRecord): boolean {
  try {
    const salt = Buffer.from(record.salt, "hex");
    const expected = Buffer.from(record.passwordHash, "hex");
    const actual = crypto.scryptSync(password, salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ============ 密码找回码 ============
// 找回码等同「备用钥匙」，与密码同级保护：仅存 scrypt 哈希 + salt，明文不落盘。

/** 归一化：去空白并转大写，实现「忽略大小写」 */
export function normalizeRecoveryCode(code: string): string {
  return (code || "").trim().toUpperCase();
}

/**
 * 校验格式，合法返回 null，否则返回错误说明。
 * 判定顺序：先非法字符、再长度，保证提示与实际问题一致
 * （否则「18 位里含符号」会被误报成「未满 18 位」）。
 * 大小写不参与判定——由 normalizeRecoveryCode 在比对阶段统一。
 */
export function validateRecoveryCode(code: string): string | null {
  const raw = (code || "").trim();
  if (!raw) return "请输入找回码";
  if (!ALNUM_RE.test(raw)) return "找回码仅支持字母和数字";
  if (raw.length !== RECOVERY_CODE_LENGTH) return `找回码必须满 ${RECOVERY_CODE_LENGTH} 位`;
  return null;
}

function hashRecoveryCode(code: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeRecoveryCode(code), salt, 64);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

/** 防时序攻击的找回码校验（未设置找回码恒为 false） */
export function verifyRecoveryCode(code: string, record: UserRecord): boolean {
  if (!record.recoveryHash || !record.recoverySalt) return false;
  try {
    const salt = Buffer.from(record.recoverySalt, "hex");
    const expected = Buffer.from(record.recoveryHash, "hex");
    const actual = crypto.scryptSync(normalizeRecoveryCode(code), salt, 64);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function hasRecoveryCode(record: UserRecord): boolean {
  return !!(record.recoveryHash && record.recoverySalt);
}

/** 设置/重设找回码 */
export function setRecoveryCode(id: string, code: string): void {
  const err = validateRecoveryCode(code);
  if (err) throw new Error(err);
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("用户不存在");
  const { hash, salt } = hashRecoveryCode(code);
  users[idx] = {
    ...users[idx],
    recoveryHash: hash,
    recoverySalt: salt,
    recoverySetAt: new Date().toISOString(),
    recoveryLastUsedAt: undefined, // 重设后解除限流
  };
  saveUsers(users);
}

/** 清除找回码 */
export function clearRecoveryCode(id: string): void {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("用户不存在");
  const next: UserRecord = { ...users[idx] };
  delete next.recoveryHash;
  delete next.recoverySalt;
  delete next.recoverySetAt;
  delete next.recoveryLastUsedAt;
  users[idx] = next;
  saveUsers(users);
}

/** 记录本次使用时间（用于 10 分钟间隔限流） */
export function markRecoveryCodeUsed(id: string): void {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) return;
  users[idx] = { ...users[idx], recoveryLastUsedAt: new Date().toISOString() };
  saveUsers(users);
}

/** 距今尚需等待的毫秒数（0 = 立即可用） */
export function recoveryCooldownRemainingMs(record: UserRecord): number {
  if (!record.recoveryLastUsedAt) return 0;
  const last = Date.parse(record.recoveryLastUsedAt);
  if (Number.isNaN(last)) return 0;
  return Math.max(0, last + RECOVERY_MIN_INTERVAL_MS - Date.now());
}

/** 创建首个（也是唯一）管理员账号 */
export function createUser(username: string, password: string, recoveryCode?: string): UserRecord {
  const users = loadUsers();
  if (users.some((u) => u.username.trim().toLowerCase() === username.trim().toLowerCase())) {
    throw new Error("用户名已存在");
  }
  if (recoveryCode) {
    const err = validateRecoveryCode(recoveryCode);
    if (err) throw new Error(err);
  }
  const { hash, salt } = hashPassword(password);
  const user: UserRecord = {
    id: crypto.randomUUID(),
    username: username.trim(),
    role: "admin",
    passwordHash: hash,
    salt,
    createdAt: new Date().toISOString(),
  };
  if (recoveryCode) {
    const r = hashRecoveryCode(recoveryCode);
    user.recoveryHash = r.hash;
    user.recoverySalt = r.salt;
    user.recoverySetAt = new Date().toISOString();
  }
  users.push(user);
  saveUsers(users);
  return user;
}

/** 修改指定用户密码（重新哈希写入） */
export function updateUserPassword(id: string, newPassword: string): void {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("用户不存在");
  const { hash, salt } = hashPassword(newPassword);
  users[idx] = { ...users[idx], passwordHash: hash, salt };
  saveUsers(users);
}

/** 兼容旧布局：若 settings.json 中残留 admin 明文/账户，不读取——统一以 users.json 为准 */
export function ensureUsersDir(): void {
  // dataPath 目录已由 paths.ts 保证存在；此处确保文件存在
  if (!fs.existsSync(USERS_FILE)) {
    saveUsers([]);
  }
}
