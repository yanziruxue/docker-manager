/**
 * 「清理未使用镜像」共享逻辑（v1.53.7）。
 *
 * 独立成模块的原因：不依赖 dockerode / SSH，门禁用假 docker 即可真实执行删除重试逻辑。
 * 历史 bug：有「不被清理」标记时逐个 `docker.getImage(id).remove()` 未带 force，
 * 多 RepoTag 镜像必然 409「must be forced」，异常被静默吞掉 ⇒ 返回空结果，
 * 前端统一显示「无需清理 / 释放空间 0 B」，用户看到「清理不掉」却无任何原因。
 */

/** 待清理镜像候选（一个镜像 ID 一条，repoTags 含该 ID 下全部引用） */
export interface PruneCandidate {
  id: string;
  repoTags: string[];
  size: number;
}

/** 单个删除失败项（ref 供前端展示，reason 为可直接展示的人话原因） */
export interface PruneFailure {
  ref: string;
  reason: string;
}

/** 逐个删除的结果 */
export interface PruneRemoveOutcome {
  deleted: any[];
  fallbackBytes: number;
  failures: PruneFailure[];
}

/**
 * 分类镜像删除的 409 冲突错误，返回前端可直接展示的中文提示与机器可读 code。
 * 返回 null 表示非冲突类错误（交由上层按 500 处理）。
 *
 * 区分两类 409，因为处置方式完全不同：
 * - IMAGE_REFERENCED：镜像被多个仓库标签引用 → force 可解决（会移除所有引用标签）
 * - IMAGE_IN_USE：镜像正被容器使用 → force 也无效，必须先处理容器
 */
export function classifyImageRemoveError(
  err: any
): { code: string; message: string; status: number } | null {
  const msg = String(err?.message || "");
  const statusCode = Number(err?.statusCode || 0);
  if (statusCode !== 409 && !/\(HTTP code 409\)/.test(msg)) return null;

  if (/must be forced|referenced in multiple repositories/.test(msg)) {
    return {
      code: "IMAGE_REFERENCED",
      status: 409,
      message: "该镜像被多个仓库标签引用，普通删除被拒绝。强制删除将移除此镜像 ID 下的所有引用标签。",
    };
  }
  if (/being used by (a )?(running|stopped|created) container|cannot be forced/.test(msg)) {
    return {
      code: "IMAGE_IN_USE",
      status: 409,
      message: "该镜像正在被容器使用，强制删除也无法移除。请先删除或更新使用此镜像的容器。",
    };
  }
  return {
    code: "IMAGE_CONFLICT",
    status: 409,
    message: msg.replace(/^\(HTTP code \d+\)\s*\w+\s*-\s*/, "") || "镜像删除冲突",
  };
}

/** 把删除异常转成人话原因（409 走分类，其余回退原始错误文本） */
export function describeImageRemoveError(err: any): string {
  const msg = String(err?.message || err || "");
  // dockerode 抛的是带 statusCode 的 HTTP 错误；SSH 分支拿到的是 CLI 文本
  // （"Error response from daemon: conflict: ... (must be forced)"），归一化为同一套中文提示。
  let classified = classifyImageRemoveError(err);
  if (!classified && /conflict:|must be forced|referenced in multiple repositories|being used by/i.test(msg)) {
    classified = classifyImageRemoveError({ statusCode: 409, message: msg });
  }
  if (classified) return classified.message;
  const raw = msg.replace(/^\(HTTP code \d+\)\s*\w+\s*-\s*/, "").trim();
  return raw || "未知错误";
}

/**
 * 逐个删除候选镜像，直到某一轮毫无进展（父子镜像依赖顺序需要多轮）。
 *
 * @param remove 真实删除回调；调用方必须带 `force: true`（dockerode）/ `-f`（CLI），
 *               否则多 RepoTag 镜像会被 Docker 拒绝。
 * @param maxRounds 最大轮数，防止异常环境下无限重试
 */
export async function removePruneCandidates(
  candidates: PruneCandidate[],
  remove: (id: string) => Promise<void>,
  maxRounds = 4
): Promise<PruneRemoveOutcome> {
  const deleted: any[] = [];
  const failures = new Map<string, PruneFailure>();
  let fallbackBytes = 0;
  let remaining = candidates.slice();

  for (let round = 0; round < maxRounds && remaining.length > 0; round++) {
    const next: PruneCandidate[] = [];
    let progressed = false;
    for (const cand of remaining) {
      const ref = cand.repoTags[0] || `sha256:${cand.id}`;
      try {
        await remove(cand.id);
        progressed = true;
        // 一个镜像对应一条记录（前端按条数统计「已删除 N 个镜像」，不能重复计数）
        deleted.push(
          cand.repoTags.length > 0 ? { Untagged: cand.repoTags[0] } : { Deleted: `sha256:${cand.id}` }
        );
        fallbackBytes += cand.size;
        failures.delete(cand.id);
      } catch (err) {
        failures.set(cand.id, { ref, reason: describeImageRemoveError(err) });
        next.push(cand);
      }
    }
    remaining = next;
    if (!progressed) break;
  }

  return { deleted, fallbackBytes, failures: [...failures.values()] };
}
