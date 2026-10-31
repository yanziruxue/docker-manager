import { Lock, Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { Input } from "./UI";

/**
 * 密码 / 敏感信息输入框：左侧图标 + 右侧「小眼睛」显示 / 隐藏明文（默认掩码）。
 *
 * 全站唯一的敏感输入实现（密码框 + v1.46.2 起找回码 / 邮箱 / 手机号等敏感信息框），
 * 统一走本组件 ⇒ 小眼睛的可用性不会「改一处漏两处」。
 *
 * ★ `type="button"` 必须显式给 —— 调用方多处于原生 `<form onSubmit>` 内，
 *   `<button>` 默认 `type` 就是 `submit`，漏写则「点小眼睛 = 立刻提交表单」
 *   （登录页会在密码还没输完时就发出去）。
 * ★ `onMouseDown` 阻止默认行为：避免点击时焦点被按钮抢走，用户可继续在输入框里打字（光标位置不丢）。
 * ★ v1.46.2 扩展（向后兼容）：`leftIcon` 自定义左图标（默认锁）、`rightExtra` 右侧附加节点
 *   （如找回码字数统计，排在眼睛左侧）、`ariaLabel` 无障碍文案（默认仍为显示/隐藏密码）。
 */
export function PasswordInput({
  value,
  onChange,
  placeholder,
  visible,
  onToggle,
  className = "",
  lockIcon = true,
  leftIcon,
  rightExtra,
  ariaLabel,
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
   * 与 leftIcon 互斥：传了 leftIcon 则以 leftIcon 为准（lockIcon 自动失效）。
   */
  lockIcon?: boolean;
  /** 自定义左侧图标（v1.46.2）：如找回码框的 KeyRound；不传且 lockIcon=true 时用锁 */
  leftIcon?: ReactNode;
  /** 右侧附加节点（v1.46.2）：如找回码字数统计，渲染在眼睛按钮左侧 */
  rightExtra?: ReactNode;
  /** 眼睛按钮的 aria-label / title（默认「显示/隐藏密码」，敏感非密码字段可自定义） */
  ariaLabel?: string;
}) {
  const eyeLabel = ariaLabel ? (visible ? `隐藏${ariaLabel}` : `显示${ariaLabel}`) : visible ? "隐藏密码" : "显示密码";
  return (
    <div className={`relative ${className}`.trim()}>
      {leftIcon ? (
        leftIcon
      ) : (
        lockIcon && <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      )}
      <Input
        value={value}
        onChange={onChange}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        className={leftIcon || lockIcon ? "pl-9 pr-9" : "pr-9"}
      />
      {rightExtra && (
        <span className="absolute right-9 top-1/2 -translate-y-1/2 pointer-events-none">{rightExtra}</span>
      )}
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={eyeLabel}
        title={eyeLabel}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded hover:bg-slate-100 transition-colors"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}
