/**
 * 镜像锁定：让「清理未使用镜像」跳过被锁定的镜像。
 *
 * 为什么锁定状态必须存在服务端：清理由后端执行（socket/tcp 走 dockerode、ssh 走 docker CLI）。
 * 若锁定只存在浏览器里，换个浏览器 / 清掉 localStorage 后锁定即失效，镜像照样被清掉。
 *
 * 存储形态（config/image-locks.json）：
 *   { "<engineId>": [ { id: "<完整 sha256>", ref: "<repo:tag 或 ''>", at: 1690000000000 } ] }
 *
 * 匹配规则（`id` 或 `ref` 命中任一即视为锁定）：
 *   - `id`：镜像内容标识。Docker 删除镜像时按 **ID 整体删除**（该 ID 上的所有 tag 一起消失），
 *     所以只锁一个 tag 是不够的 —— 兄弟 tag 未锁则整个 ID 仍会被清，被锁的 tag 也跟着没了。
 *     用 ID 匹配才能覆盖「多 tag 镜像」这一场景。
 *   - `ref`：`repo:tag`。用于覆盖「同 tag 重新拉取」——此时镜像 ID 已变，但 ref 不变，
 *     锁定应继续生效（用户锁的是「这个镜像」，而非某个历史层）。
 *   两者并存，才能同时覆盖上述两种场景。
 */

import fs from "node:fs";
import { configPath } from "./paths.js";

const LOCKS_FILE = configPath("image-locks.json");

/** 单条锁定记录 */
export interface ImageLock {
  /** 镜像 sha256（不含 `sha256:` 前缀，完整 64 位） */
  id: string;
  /** `repo:tag`；悬空镜像无有效引用，为空字符串 */
  ref: string;
  /** 加锁时间戳（ms） */
  at: number;
}

/** 全量存储结构：engineId → 锁定列表 */
type LockStore = Record<string, ImageLock[]>;

/** 读取全量存储；文件缺失或损坏时返回空对象（不抛错，避免拖垮镜像列表） */
function readStore(): LockStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCKS_FILE, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: LockStore = {};
    for (const [engineId, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[engineId] = list
        .filter((it): it is ImageLock => !!it && typeof it === "object" && typeof (it as ImageLock).id === "string")
        .map((it) => ({
          id: normalizeId(it.id),
          ref: typeof it.ref === "string" ? it.ref : "",
          at: typeof it.at === "number" ? it.at : Date.now(),
        }))
        .filter((it) => it.id.length > 0);
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(store: LockStore): void {
  try {
    fs.writeFileSync(LOCKS_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch {
    // 写入失败（只读挂载等）：锁定仅在本次进程内可见，不阻断主流程
  }
}

/** 归一化镜像 ID：去掉 `sha256:` 前缀并转小写 */
export function normalizeId(raw: string): string {
  return String(raw || "").replace(/^sha256:/i, "").trim().toLowerCase();
}

/** 取某引擎的锁定列表（副本） */
export function getImageLocks(engineId: string): ImageLock[] {
  const store = readStore();
  return (store[engineId] || []).map((it) => ({ ...it }));
}

/**
 * 加锁 / 解锁。
 * @param locked true 加锁，false 解锁
 * @returns 该引擎最新的锁定列表
 */
export function setImageLock(
  engineId: string,
  target: { id: string; ref?: string },
  locked: boolean
): ImageLock[] {
  const store = readStore();
  const list = store[engineId] || [];
  const id = normalizeId(target.id);
  const ref = typeof target.ref === "string" ? target.ref : "";

  // 同一逻辑镜像去重：ID 或 ref 命中都算同一条（避免重复加锁堆积）
  const hit = (it: ImageLock) =>
    (id && it.id === id) || (!!ref && it.ref === ref);
  const rest = list.filter((it) => !hit(it));

  if (locked && id) {
    rest.unshift({ id, ref, at: Date.now() });
  }
  store[engineId] = rest;
  writeStore(store);
  return rest.map((it) => ({ ...it }));
}

/** 清空某引擎的全部锁定 */
export function clearImageLocks(engineId: string): void {
  const store = readStore();
  delete store[engineId];
  writeStore(store);
}

/**
 * 判断某镜像是否被锁定。
 * @param locks 该引擎的锁定列表
 * @param image 候选镜像：`id` 可为完整或短 sha256，`repoTags` 为该镜像的全部 `repo:tag`
 */
export function isImageLocked(
  locks: ImageLock[],
  image: { id: string; repoTags?: string[] }
): boolean {
  if (locks.length === 0) return false;
  const id = normalizeId(image.id);
  if (!id) return false;
  const tags = (image.repoTags || []).filter(Boolean);
  return locks.some((l) => {
    if (l.id && (l.id === id || id.startsWith(l.id) || l.id.startsWith(id))) return true;
    if (l.ref && tags.includes(l.ref)) return true;
    return false;
  });
}

/**
 * 清掉已不存在的锁定（镜像被手动删掉 / 换机后残留）。
 * 由 prune 调用（此时本就要枚举镜像，零额外开销）；返回被清理的条数。
 */
export function pruneStaleLocks(
  engineId: string,
  existing: { id: string; repoTags?: string[] }[]
): number {
  const store = readStore();
  const list = store[engineId];
  if (!list || list.length === 0) return 0;
  const kept = list.filter((l) => existing.some((img) => isImageLocked([l], img)));
  if (kept.length === list.length) return 0;
  store[engineId] = kept;
  writeStore(store);
  return list.length - kept.length;
}
