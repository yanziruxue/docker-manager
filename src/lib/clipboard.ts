/**
 * 剪贴板工具。
 *
 * 为什么不再用 `navigator.clipboard?.writeText(...)`：
 *   Clipboard API **只在安全上下文**（HTTPS，或 `localhost` / `127.0.0.1`）存在。
 *   本项目是纯 HTTP 部署（`http://<IP>:5024`），从局域网 IP 打开时
 *   `navigator.clipboard` 是 `undefined`，而可选链 `?.` 会把这种「能力缺失」
 *   当作正常情况**静默跳过** —— 表现为点了按钮毫无反应、控制台也没有任何报错。
 *
 * 因此这里显式分级降级，并且**一定返回布尔值**，由调用方给出可见反馈：
 *   ① `navigator.clipboard.writeText`（安全上下文，异步、需权限）
 *   ② 隐藏 `<textarea>` + `document.execCommand("copy")`（已废弃，但 HTTP 下仍可用）
 *   ③ 都失败 → 返回 false，调用方提示用户手动选中复制
 */

/** 一级：Clipboard API（安全上下文，异步、需权限，文档失焦也会失败） */
async function viaClipboardApi(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard || !navigator.clipboard.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 二级：隐藏 textarea + execCommand("copy") —— HTTP（非安全上下文）下依然可用 */
function viaExecCommand(text: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  // 必须留在视口内且可选中，execCommand 才生效；用 fixed + 1px + 透明规避页面滚动与闪烁
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.width = "1px";
  ta.style.height = "1px";
  ta.style.padding = "0";
  ta.style.border = "none";
  ta.style.outline = "none";
  ta.style.boxShadow = "none";
  ta.style.background = "transparent";
  ta.style.opacity = "0";
  const prevActive = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);
  let ok = false;
  try {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    if (ta.parentNode) ta.parentNode.removeChild(ta);
    // 把焦点还给原来的元素，避免键盘/焦点莫名丢失
    try {
      prevActive?.focus?.();
    } catch {
      /* 原元素已卸载，忽略 */
    }
  }
  return ok;
}

/**
 * 复制文本到剪贴板。
 *
 * @returns 是否成功。调用方**必须**据此给出反馈（成功提示「已复制」/ 失败提示手动复制），
 *          不要静默忽略返回值，否则又会退回「点了没反应」。
 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (await viaClipboardApi(text)) return true;
  return viaExecCommand(text);
}

/** 兜底展示：把整段文本选中，方便用户直接 Ctrl+C（复制链路全部失败时调用） */
export function selectNodeText(el: HTMLElement | null | undefined): void {
  if (!el || typeof window === "undefined" || !window.getSelection) return;
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* 选中失败不致命，用户仍可手动拖选 */
  }
}
