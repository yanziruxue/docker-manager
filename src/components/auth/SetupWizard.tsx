import React, { useState } from "react";
import { User, Lock, ShieldCheck, Loader2, KeyRound } from "lucide-react";
import { Input, FormField } from "../UI";
import { initAccount, reinitAccount, type AuthUser } from "../../api";
import {
  sanitizeRecoveryInput,
  validateRecoveryCode,
  RECOVERY_MIN_LENGTH,
  RECOVERY_MAX_LENGTH,
} from "../../lib/recovery-code";

interface Props {
  onDone: (user: AuthUser) => void;
  /**
   * create（默认）＝首次部署创建管理员账号；
   * reinit＝账号凭据版本升级后**强制重走**一遍账号设置（用户名 + 密码 + 找回码），找回码**必填**。
   */
  mode?: "create" | "reinit";
  /** reinit 模式预填的当前用户名（便于沿用，可改） */
  initialUsername?: string;
}

/** 账号设置向导：首次部署创建 / 升级后重新设置（同一套表单，靠 mode 区分文案与校验） */
export function SetupWizard({ onDone, mode = "create", initialUsername }: Props) {
  const isReinit = mode === "reinit";
  const [username, setUsername] = useState(initialUsername || "admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recovery, setRecovery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    if (!username.trim()) {
      setError("用户名不能为空");
      return;
    }
    if (password.length < 6) {
      setError("密码至少 6 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    // 首次部署：找回码可选（留空可后续在「系统设置 → 用户」补设）
    // 重新设置：**必填** —— 本次升级的核心目的就是让每个账号都换成新规则找回码
    if (!recovery && isReinit) {
      setError(`请设置 ${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位密码找回码`);
      return;
    }
    if (recovery) {
      const err = validateRecoveryCode(recovery);
      if (err) {
        setError(err);
        return;
      }
    }
    setBusy(true);
    try {
      const user = isReinit
        ? await reinitAccount(username.trim(), password, recovery)
        : await initAccount(username.trim(), password, recovery || undefined);
      onDone(user);
    } catch (e: any) {
      setError(e?.message || (isReinit ? "重新设置账号失败" : "创建账户失败"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center text-white mb-3">
            <ShieldCheck size={24} />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">
            {isReinit ? "账号重新设置" : "初始设置"}
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            {isReinit ? "本次更新调整了账号与密码找回码规则，请重新设置一次" : "创建管理员账号以开始使用"}
          </p>
        </div>

        {isReinit && (
          <div className="mb-4 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            密码找回码规则已调整为{" "}
            <span className="font-semibold">
              {RECOVERY_MIN_LENGTH}~{RECOVERY_MAX_LENGTH} 位
            </span>
            字母与数字，且<span className="font-semibold">区分大小写</span>。请重设用户名 / 密码 /
            找回码，完成后需用新凭据重新登录。
          </div>
        )}

        {/* 原生表单：回车触发 submit（v1.15.5 兜底，不依赖 onKeyDown 透传） */}
        <form
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (!busy) submit(); }}
        >
          <FormField label="用户名" required>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={username}
                onChange={setUsername}
                placeholder="admin"
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField label="密码" required hint="至少 6 位">
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={password}
                onChange={setPassword}
                type="password"
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField label="确认密码" required>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={confirm}
                onChange={setConfirm}
                type="password"
                placeholder="••••••••"
                className="pl-9"
              />
            </div>
          </FormField>

          <FormField
            label="密码找回码"
            required={isReinit}
            hint={
              isReinit
                ? `${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字，区分大小写；忘记密码时可用它重置。必填`
                : `可选，${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字，区分大小写；忘记密码时可用它重置。留空可稍后在「系统设置 → 用户」补设`
            }
          >
            <div className="relative">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                value={recovery}
                onChange={(v) => setRecovery(sanitizeRecoveryInput(v))}
                placeholder={`${RECOVERY_MIN_LENGTH}~${RECOVERY_MAX_LENGTH} 位字母或数字`}
                className="pl-9 font-mono tracking-wider"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 tabular-nums">
                {recovery.length}/{RECOVERY_MAX_LENGTH}
              </span>
            </div>
          </FormField>

          {error && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-60"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            {isReinit ? "保存并继续" : "创建并进入"}
          </button>
        </form>

        <p className="text-center text-[11px] text-slate-400 mt-4">
          账户与找回码均仅以哈希形式存储，请妥善保管
        </p>
      </div>
    </div>
  );
}
