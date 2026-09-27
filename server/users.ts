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
  /**
   * 账号凭据版本。**老记录没有该字段 ⇒ 视为 1 ⇒ 需要重新初始化**
   * （重走「用户名 + 密码 + 找回码」设置流程）。
   */
  credentialVersion?: number;
  /** 最后一次「重新设置账号」的时间 */
  credentialUpdatedAt?: string;
}

/**
 * 当前要求的账号凭据版本。
 * v1.31.0 起为 **2**：找回码规则改为 **18~24 位且区分大小写**，老账号（版本 1）在升级后
 * **重新登录时必须重走一遍账号初始化流程**（用户名 + 密码 + 找回码），
 * 完成后写入版本 2，此后不再触发。
 */
export const CREDENTIAL_VERSION = 2;

/** 密码找回码长度下限（位）—— 仅字母与数字，**区分大小写** */
export const RECOVERY_MIN_CODE_LENGTH = 18;
/** 密码找回码长度上限（位） */
export const RECOVERY_MAX_CODE_LENGTH = 24;
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

/**
 * 归一化：**仅去首尾空白，保留大小写**（v1.31.0 起找回码区分大小写）。
 * ⚠️ 例外见 `legacyUpperVariants()`：历史记录是把找回码**转大写后**哈希的，
 * 为不让存量用户被规则变更锁死，校验时会额外尝试一次大写形式。
 */
export function normalizeRecoveryCode(code: string): string {
  return (code || "").trim();
}

/**
 * 历史兼容备选：老记录以「转大写」形式哈希。
 * 仅当输入确实含小写时才有意义 —— 直接匹配失败后再拿大写形式试一次。
 * 对新记录无副作用：新码按原始大小写哈希，输入正确则直接命中；
 * 输入大小写错误时备选形式等于原串本身（`up === c`，返回空数组）
 * ⇒ **区分大小写仍然生效**，不会被这条兼容逻辑削弱。
 */
function legacyUpperVariants(code: string): string[] {
  const c = normalizeRecoveryCode(code);
  const up = c.toUpperCase();
  return up === c ? [] : [up];
}

/**
 * 校验格式，合法返回 null，否则返回错误说明。
 * 判定顺序：先非法字符、再长度，保证提示与实际问题一致
 * （否则「含符号」会被误报成「长度不对」）。
 *
 * 规则（v1.31.0 起）：**长度 18~24 位、仅字母数字、区分大小写**。
 * 三个入口（首次初始化 / 设置重设 / 用码重置密码）共用同一判定，不再有严格与放宽之分
 * —— 18 位本身已在区间内，原先为兼容旧 18 位码而设的 `allowLegacy` 参数随之取消。
 */
export function validateRecoveryCode(code: string): string | null {
  const raw = (code || "").trim();
  if (!raw) return "请输入找回码";
  if (!ALNUM_RE.test(raw)) return "找回码仅支持字母和数字";
  if (raw.length < RECOVERY_MIN_CODE_LENGTH || raw.length > RECOVERY_MAX_CODE_LENGTH) {
    return `找回码需 ${RECOVERY_MIN_CODE_LENGTH}~${RECOVERY_MAX_CODE_LENGTH} 位`;
  }
  return null;
}

function hashRecoveryCode(code: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(normalizeRecoveryCode(code), salt, 64);
  return { hash: hash.toString("hex"), salt: salt.toString("hex") };
}

/** 防时序攻击的找回码校验（未设置找回码恒为 false；区分大小写，另含历史「转大写」记录兼容） */
export function verifyRecoveryCode(code: string, record: UserRecord): boolean {
  if (!record.recoveryHash || !record.recoverySalt) return false;
  try {
    const salt = Buffer.from(record.recoverySalt, "hex");
    const expected = Buffer.from(record.recoveryHash, "hex");
    const candidates = [normalizeRecoveryCode(code), ...legacyUpperVariants(code)];
    return candidates.some((c) => {
      const actual = crypto.scryptSync(c, salt, 64);
      return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
    });
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

// ============ 账号凭据版本 / 重新初始化 ============
// v1.31.0 起：老账号（credentialVersion < 2）升级后**重新登录时必须重走一遍**
// 「用户名 + 密码 + 找回码」设置流程，完成后写入版本 2，此后不再触发。

/** 该账号是否仍需要重新初始化（老记录无 credentialVersion ⇒ 需要） */
export function needsReinit(record: UserRecord): boolean {
  return (record.credentialVersion ?? 1) < CREDENTIAL_VERSION;
}

/**
 * 当前实例是否存在「待重新初始化」的账号（单管理员：取唯一账号判定）。
 * 用于「重新登录后强制重走初始化流程」的全局判定与业务接口拦截。
 */
export function requiresAccountReinit(): boolean {
  const users = loadUsers();
  return users.some(needsReinit);
}

export interface ReinitInput {
  username?: string;
  password?: string;
  /** **必填**：按 18~24 位校验（本次升级的核心目的就是让每个账号都换成新规则找回码） */
  recoveryCode?: string;
}

/**
 * 重新初始化账号：覆盖用户名 / 密码 / 找回码，并写入最新凭据版本。
 * - 保留 `id` 与 `createdAt`（设备侧统计与审计不因重设而漂移）；
 * - 找回码**必填**且按 18~24 位校验（区分大小写）；
 * - 清 `recoveryLastUsedAt`（重设后解除 10 分钟限流）；
 * - **不校验旧密码**：调用方（`POST /api/auth/reinit`）已要求先通过旧凭据登录。
 */
export function reinitUser(id: string, input: ReinitInput): UserRecord {
  const users = loadUsers();
  const idx = users.findIndex((u) => u.id === id);
  if (idx < 0) throw new Error("用户不存在");

  const name = (input.username || "").trim();
  if (!name) throw new Error("用户名不能为空");
  if (!input.password || input.password.length < 6) throw new Error("密码至少 6 位");
  if (
    users.some((u, i) => i !== idx && u.username.trim().toLowerCase() === name.toLowerCase())
  ) {
    throw new Error("用户名已存在");
  }
  const codeErr = validateRecoveryCode(input.recoveryCode || "");
  if (codeErr) throw new Error(codeErr);

  const { hash, salt } = hashPassword(input.password);
  const r = hashRecoveryCode(input.recoveryCode || "");
  const now = new Date().toISOString();
  users[idx] = {
    ...users[idx],
    username: name,
    passwordHash: hash,
    salt,
    recoveryHash: r.hash,
    recoverySalt: r.salt,
    recoverySetAt: now,
    recoveryLastUsedAt: undefined,
    credentialVersion: CREDENTIAL_VERSION,
    credentialUpdatedAt: now,
  };
  saveUsers(users);
  return users[idx];
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
    // 新账号直接标记为最新凭据版本（不会再触发「重新初始化」）
    credentialVersion: CREDENTIAL_VERSION,
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
