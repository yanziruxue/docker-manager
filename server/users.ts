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
}

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

/** 创建首个（也是唯一）管理员账号 */
export function createUser(username: string, password: string): UserRecord {
  const users = loadUsers();
  if (users.some((u) => u.username.trim().toLowerCase() === username.trim().toLowerCase())) {
    throw new Error("用户名已存在");
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
