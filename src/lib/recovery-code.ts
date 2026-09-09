/**
 * 密码找回码：18 位，仅字母与数字，忽略大小写。
 *
 * 语义约定：
 * - 「仅支持字母和数字」→ 输入阶段即过滤，非字母数字字符直接剔除。
 * - 「忽略大小写」→ 保留用户输入的原始大小写（不强制转大写），
 *   大小写差异在服务端比对时消除（server/users.ts 的 normalizeRecoveryCode 统一转大写）。
 *   因此 abc… 与 ABC… 等价，但界面上不会篡改用户已输入的内容。
 *
 * 前端只做输入清洗与长度校验，真正的校验与哈希在服务端。
 */

export const RECOVERY_LENGTH = 18;
const ALNUM_RE = /^[A-Za-z0-9]+$/;

/** 清洗输入：剔除所有非字母数字字符（保留原有大小写）、截断到 18 位 */
export function sanitizeRecoveryInput(v: string): string {
  return (v || "")
    .replace(/[^A-Za-z0-9]/g, "")
    .slice(0, RECOVERY_LENGTH);
}

/** 校验（入参应为已清洗值）。合法返回 null，否则返回错误说明 */
export function validateRecoveryCode(v: string): string | null {
  const c = sanitizeRecoveryInput(v);
  if (!c) return "请输入找回码";
  if (!ALNUM_RE.test(c)) return "找回码仅支持字母和数字";
  if (c.length !== RECOVERY_LENGTH) return `找回码必须满 ${RECOVERY_LENGTH} 位`;
  return null;
}
