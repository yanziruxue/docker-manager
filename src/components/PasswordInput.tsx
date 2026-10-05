import { Lock, Eye, EyeOff } from "lucide-react";
import { Input } from "./UI";

/**
 * 密码输入框：左侧锁图标 + 右侧「小眼睛」显示 / 隐藏明文。
 *
 * 全站唯一的密码输入实现（登录页 3 个 + 首次设置/账号重设向导 2 个 + 设置页改密码 4 个），
 * 统一走本组件 ⇒ 小眼睛的可用性不会「改一处漏两处」。
 *
 * ★ `type="button"` 必须显式给 —— 调用方多处于原生 `<form onSubmit>` 内，
 *   `<button>` 默认 `type` 就是 `submit`，漏写则「点小眼睛 = 立刻提交表单」
 *   （登录页会在密码还没输完时就发出去）。
 * ★ `onMouseDown` 阻止默认行为：避免点击时焦点被按钮抢走，用户可继续在输入框里打字（光标位置不丢）。
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  visible,
  onToggle,
  className = "",
  lockIcon = true,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  /** 是否显示明文（true = 明文，false = 掩码） */
  visible: boolean;
  onToggle: () => void;
  /** 追加到外层容器的类名 */
  className?: string;
  /**
   * 是否显示左侧锁图标。默认 true；
   * 设置页「改密码 / 找回码重设」等**原本就没有锁图标**的表单传 false，保持既有观感不变。
   */
  lockIcon?: boolean;
}) {
  return (
    <div className={`relative ${className}`.trim()}>
      {lockIcon && <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}
      <Input
        value={value}
        onChange={onChange}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        className={lockIcon ? "pl-9 pr-9" : "pr-9"}
      />
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={visible ? "隐藏密码" : "显示密码"}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
