/**
 * 全局弹窗 ESC 关闭栈（v1.53.4 起项目统一约定）：
 *  - 防误关：点击遮罩 / 弹窗外区域一律不关闭弹窗，只能点 X / 取消 / 确定关闭；
 *  - ESC 可关：键盘主动操作不会误触，作为唯一快捷关闭方式；
 *  - 仅「最上层」弹窗响应 Esc（后入栈优先，同优先级取最后入栈者），叠加弹窗不会同时被关。
 *
 * 通用 Modal / Drawer 与导航页自绘弹窗共用本栈，避免两套栈各自判定栈顶导致叠加误关。
 */
import { useEffect, useRef } from "react";

interface EscEntry {
  id: number;
  priority: number;
  close: () => void;
}

const stack: EscEntry[] = [];
let seq = 0;
let listening = false;
let prevOverflow = "";

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || stack.length === 0) return;
  let top = stack[0];
  for (const it of stack) {
    if (it.priority > top.priority || (it.priority === top.priority && it.id > top.id)) top = it;
  }
  e.preventDefault();
  top.close();
}

/** 栈非空时锁背景滚动并挂全局监听，栈空时还原 */
function sync() {
  if (stack.length > 0 && !listening) {
    prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    listening = true;
  } else if (stack.length === 0 && listening) {
    document.removeEventListener("keydown", onKeyDown);
    document.body.style.overflow = prevOverflow;
    listening = false;
  }
}

/**
 * @param close    按 Esc 时执行的关闭回调（内部走 ref，父组件重渲染不会重复注册）
 * @param priority 层级优先级，数值大者优先响应；默认 0（一般无需传）
 * @param enabled  false 时不入栈（如弹窗未打开、加载中禁止关闭、或先让下层菜单消费 Esc）
 */
export function useEscapeClose(close: () => void, priority = 0, enabled = true) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!enabled) return;
    const entry: EscEntry = { id: ++seq, priority, close: () => closeRef.current() };
    stack.push(entry);
    sync();
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
      sync();
    };
  }, [priority, enabled]);
}
