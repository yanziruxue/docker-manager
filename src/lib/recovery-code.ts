/**
 * 密码找回码：共用校验逻辑（前端）
 *
 * 规则（v1.31.0 起）：
 * - 长度 **18 ~ 24 位**；
 * - **仅字母与数字**；
 * - **区分大小写**（不再统一转大写）。
 *
 * 三个入口共用同一套判定（首次初始化 / 设置重设 / 用找回码重置密码），
 * 因此不再需要「严格 / 放宽」两套长度参数。
 *
 * 注意：服务端（`server/users.ts`）有一份等价实现。**改规则必须两处同改**，
 * 否则会出现「前端通过、后端拒绝」的不一致。
 */

/** 找回码长度下限（位） */
export const RECOVERY_MIN_LENGTH = 18;
/** 找回码长度上限（位；输入期即按此截断） */
export const RECOVERY_MAX_LENGTH = 24;

const ALNUM_RE = /^[A-Za-z0-9]+$/;

/** 清洗输入：剔除所有非字母数字字符（**保留原有大小写**）、截断到上限位 */
export function sanitizeRecoveryInput(v: string): string {
  return (v || "").replace(/[^A-Za-z0-9]/g, "").slice(0, RECOVERY_MAX_LENGTH);
}

/**
 * 校验找回码格式。合法返回 `null`，否则返回错误说明。
 * 返回的错误文案与后端保持一致（同一套措辞）。
 */
export function validateRecoveryCode(v: string): string | null {
  const c = sanitizeRecoveryInput(v);
  if (!c) return "请输入找回码";
  if (!ALNUM_RE.test(c)) return "找回码仅支持字母和数字";
  if (c.length < RECOVERY_MIN_LENGTH || c.length > RECOVERY_MAX_LENGTH) {
    return `找回码需 ${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位`;
  }
  return null;
}
